//! The service with a scripted microphone, model and server: start, stop, the cap, busy, and every way it fails.

use std::collections::VecDeque;
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use super::*;
use crate::audio::{AudioSource, Read};
use crate::fetch::testing::{Scripted, Step as ServerStep, quick, serve, status};
use crate::model::testing::spec_for;
use crate::segment::Job;
use crate::transcribe::{Moot, Transcriber};
use crate::{Reason, model};

const RATE: u32 = 48_000;

/// A sound a person could make, as a 48 kHz microphone would give it, in 10 ms blocks.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn speech(seconds: f64) -> Vec<Read> {
    let n = (seconds * f64::from(RATE)) as usize;
    let all: Vec<f32> = (0..n)
        .map(|i| {
            (0.2 * (2.0 * std::f64::consts::PI * 200.0 * i as f64 / f64::from(RATE)).sin()) as f32
        })
        .collect();
    all.chunks(480).map(|c| Read::Samples(c.to_vec())).collect()
}

/// A quiet room, never exactly zero.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn room(seconds: f64) -> Vec<Read> {
    let n = (seconds * f64::from(RATE)) as usize;
    let all: Vec<f32> = (0..n)
        .map(|i| if i % 2 == 0 { 0.0004 } else { -0.0004 })
        .collect();
    all.chunks(480).map(|c| Read::Samples(c.to_vec())).collect()
}

/// A microphone that plays a script and then stays open and quiet, like a real one nobody speaks into.
struct Tape {
    reads: VecDeque<Read>,
    closed: Arc<AtomicUsize>,
}

impl AudioSource for Tape {
    fn rate(&self) -> u32 {
        RATE
    }
    fn read(&mut self, wait: Duration) -> Read {
        self.reads.pop_front().unwrap_or_else(|| {
            std::thread::sleep(wait.min(Duration::from_millis(2)));
            Read::Idle
        })
    }
}

impl Drop for Tape {
    fn drop(&mut self) {
        self.closed.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Default)]
struct Mic {
    tapes: Mutex<VecDeque<Result<Vec<Read>>>>,
    opened: AtomicUsize,
    closed: Arc<AtomicUsize>,
}

impl Mic {
    fn with(tapes: Vec<Result<Vec<Read>>>) -> Arc<Self> {
        Arc::new(Self {
            tapes: Mutex::new(tapes.into()),
            ..Self::default()
        })
    }
}

impl Microphone for Mic {
    fn open(&self) -> Result<Box<dyn AudioSource>> {
        self.opened.fetch_add(1, Ordering::Relaxed);
        let reads = self
            .tapes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok(Vec::new()))?;
        Ok(Box::new(Tape {
            reads: reads.into(),
            closed: self.closed.clone(),
        }))
    }
}

/// A model that "hears" how long each stretch was.
#[derive(Default)]
struct Model {
    loads: AtomicUsize,
    broken: Option<Error>,
}

struct Scribe;

impl Transcriber for Scribe {
    #[allow(clippy::cast_precision_loss)]
    fn transcribe(&mut self, job: &Job, _moot: &Moot) -> Result<String> {
        let seconds = job.audio.len() as f64 / 16_000.0;
        Ok(format!(
            "{} of {seconds:.1} s",
            if job.last { "words" } else { "so far" }
        ))
    }
}

impl Recognizer for Model {
    fn load(&self) -> Result<Box<dyn Transcriber>> {
        self.loads.fetch_add(1, Ordering::Relaxed);
        match &self.broken {
            Some(e) => Err(e.clone()),
            None => Ok(Box::new(Scribe)),
        }
    }
}

struct Rig {
    dictation: Dictation,
    mic: Arc<Mic>,
    model: Arc<Model>,
    server: Arc<Scripted>,
    spec: &'static ModelSpec,
    dir: tempfile::TempDir,
}

struct Setup {
    tapes: Vec<Result<Vec<Read>>>,
    server: Vec<ServerStep>,
    /// Whether the model file is already in the speech folder.
    model_present: bool,
    broken_model: Option<Error>,
    tuning: Tuning,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            tapes: Vec::new(),
            server: Vec::new(),
            model_present: true,
            broken_model: None,
            tuning: quick_tuning(),
        }
    }
}

/// The defaults, with a short tick and a partial every second of speech.
fn quick_tuning() -> Tuning {
    Tuning {
        tick: Duration::from_millis(2),
        partial_every: Duration::from_secs(1),
        ..Tuning::default()
    }
}

fn content() -> Vec<u8> {
    #[allow(clippy::cast_possible_truncation)]
    (0..200_000_u32).map(|i| (i % 253) as u8).collect()
}

fn rig(setup: Setup) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let spec: &'static ModelSpec = Box::leak(Box::new(spec_for(&content())));
    if setup.model_present {
        std::fs::write(spec.path(dir.path()), content()).unwrap();
    }
    let mic = Mic::with(setup.tapes);
    let model = Arc::new(Model {
        broken: setup.broken_model,
        ..Model::default()
    });
    let server = Arc::new(Scripted::new(setup.server));
    let dictation = Dictation::new(Parts {
        spec,
        dir: dir.path().to_owned(),
        tuning: setup.tuning,
        policy: quick(),
        microphone: mic.clone(),
        recognizer: model.clone(),
        transport: server.clone(),
    });
    Rig {
        dictation,
        mic,
        model,
        server,
        spec,
        dir,
    }
}

/// A sink that keeps what it is told.
fn listener() -> (Sink, Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (Arc::new(move |e| tx.lock().unwrap().send(e).is_ok()), rx)
}

/// Everything up to and including `Ended`.
fn to_the_end(rx: &Receiver<Event>) -> Vec<Event> {
    let mut all = Vec::new();
    loop {
        let e = rx
            .recv_timeout(Duration::from_secs(20))
            .unwrap_or_else(|_| panic!("no Ended after {all:?}"));
        let ended = e == Event::Ended;
        all.push(e);
        if ended {
            return all;
        }
    }
}

/// Wait for the first event that matches, keeping the ones before it.
fn until(rx: &Receiver<Event>, seen: &mut Vec<Event>, what: impl Fn(&Event) -> bool) {
    loop {
        let e = rx
            .recv_timeout(Duration::from_secs(20))
            .unwrap_or_else(|_| panic!("it never came; so far {seen:?}"));
        let hit = what(&e);
        seen.push(e);
        if hit {
            return;
        }
    }
}

fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !check() {
        assert!(Instant::now() < deadline, "never: {what}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn finals(events: &[Event]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Final { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn reasons(events: &[Event]) -> Vec<Reason> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Error { reason, .. } => Some(*reason),
            _ => None,
        })
        .collect()
}

#[test]
fn a_dictation_listens_writes_down_each_stretch_and_ends_when_stopped() {
    let mut tape = room(0.3);
    tape.extend(speech(1.0));
    tape.extend(room(1.0));
    tape.extend(speech(2.0));
    let r = rig(Setup {
        tapes: vec![Ok(tape)],
        ..Setup::default()
    });
    let (sink, rx) = listener();
    let id = r.dictation.start(&sink);
    let mut seen = Vec::new();
    // the first stretch is final at its pause, while the dictation goes on
    until(&rx, &mut seen, |e| matches!(e, Event::Final { .. }));
    assert_eq!(seen[0], Event::Listening, "{seen:?}");
    assert!(r.dictation.active());
    // the second stretch is still being spoken: its words so far come as a partial
    until(&rx, &mut seen, |e| matches!(e, Event::Partial { .. }));
    r.dictation.stop(id + 100); // not this dictation: nothing happens
    assert!(r.dictation.active());
    r.dictation.stop(id);
    seen.extend(to_the_end(&rx));
    let said = finals(&seen);
    assert_eq!(said.len(), 2, "{seen:?}");
    // the first stretch is its second of speech with a little quiet around it
    assert_eq!(said[0], "words of 1.5 s", "{said:?}");
    assert!(said[1].starts_with("words of "), "{said:?}");
    assert!(reasons(&seen).is_empty());
    assert_eq!(seen.iter().filter(|e| **e == Event::Ended).count(), 1);
    assert_eq!(seen.last(), Some(&Event::Ended));
    eventually("the dictation is over", || !r.dictation.active());
    assert_eq!(r.mic.opened.load(Ordering::Relaxed), 1);
    assert_eq!(
        r.mic.closed.load(Ordering::Relaxed),
        1,
        "the microphone is closed"
    );
    assert!(
        r.server.asked().is_empty(),
        "the model was there: nothing is fetched"
    );
}

#[test]
fn a_second_dictation_is_busy_and_the_first_goes_on() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(3.0))],
        ..Setup::default()
    });
    let (first, first_rx) = listener();
    let id = r.dictation.start(&first);
    let mut seen = Vec::new();
    until(&first_rx, &mut seen, |e| matches!(e, Event::Partial { .. }));
    assert_eq!(seen[0], Event::Listening);

    let (second, second_rx) = listener();
    let other = r.dictation.start(&second);
    assert_ne!(other, id);
    let refused = to_the_end(&second_rx);
    assert_eq!(reasons(&refused), vec![Reason::Busy]);
    assert_eq!(refused.len(), 2, "busy, then the end: {refused:?}");
    assert_eq!(
        r.mic.opened.load(Ordering::Relaxed),
        1,
        "the microphone was not opened twice"
    );
    // stopping the refused one does not stop the running one
    r.dictation.stop(other);
    assert!(r.dictation.active());

    r.dictation.stop(id);
    seen.extend(to_the_end(&first_rx));
    assert_eq!(finals(&seen).len(), 1, "{seen:?}");
    // the end was said: a press that answers it starts at once, with no wait for the thread behind it
    let (third, third_rx) = listener();
    let id = r.dictation.start(&third);
    let mut seen = Vec::new();
    until(&third_rx, &mut seen, |e| *e == Event::Listening);
    assert_eq!(seen, vec![Event::Listening]);
    r.dictation.stop(id);
    to_the_end(&third_rx);
}

/// A model that takes its time over each stretch, as a real one does.
struct SlowModel {
    loads: AtomicUsize,
}

struct SlowScribe;

impl Transcriber for SlowScribe {
    fn transcribe(&mut self, job: &Job, _moot: &Moot) -> Result<String> {
        std::thread::sleep(Duration::from_millis(150));
        Ok(format!(
            "stretch {}",
            if job.last { "done" } else { "so far" }
        ))
    }
}

impl Recognizer for SlowModel {
    fn load(&self) -> Result<Box<dyn Transcriber>> {
        self.loads.fetch_add(1, Ordering::Relaxed);
        Ok(Box::new(SlowScribe))
    }
}

#[test]
fn a_press_right_after_a_stop_listens_at_once_and_its_words_follow_the_others() {
    let dir = tempfile::tempdir().unwrap();
    let spec: &'static ModelSpec = Box::leak(Box::new(spec_for(&content())));
    std::fs::write(spec.path(dir.path()), content()).unwrap();
    let mic = Mic::with(vec![Ok(speech(1.0)), Ok(speech(1.0))]);
    let model = Arc::new(SlowModel {
        loads: AtomicUsize::new(0),
    });
    let dictation = Dictation::new(Parts {
        spec,
        dir: dir.path().to_owned(),
        tuning: quick_tuning(),
        policy: quick(),
        microphone: mic.clone(),
        recognizer: model.clone(),
        transport: Arc::new(Scripted::new(vec![])),
    });
    // talk, let go, and talk again before the first words are written down
    let (first, first_rx) = listener();
    let one = dictation.start(&first);
    let mut seen = Vec::new();
    until(&first_rx, &mut seen, |e| *e == Event::Listening);
    std::thread::sleep(Duration::from_millis(400)); // the tape's second of speech is taken in a few milliseconds
    dictation.stop(one);
    let (second, second_rx) = listener();
    let two = dictation.start(&second);
    let mut again = Vec::new();
    until(&second_rx, &mut again, |e| *e == Event::Listening);
    assert_eq!(again, vec![Event::Listening], "not busy");
    std::thread::sleep(Duration::from_millis(400));
    dictation.stop(two);
    seen.extend(to_the_end(&first_rx));
    again.extend(to_the_end(&second_rx));
    assert_eq!(finals(&seen), vec!["stretch done"], "{seen:?}");
    assert_eq!(finals(&again), vec!["stretch done"], "{again:?}");
    assert!(reasons(&seen).is_empty() && reasons(&again).is_empty());
    assert_eq!(
        model.loads.load(Ordering::Relaxed),
        1,
        "the model was handed over, not loaded twice"
    );
    assert_eq!(mic.opened.load(Ordering::Relaxed), 2);
    eventually("both microphones are closed", || {
        mic.closed.load(Ordering::Relaxed) == 2
    });
}

#[test]
fn no_microphone_and_a_refused_one_say_so_and_leave_the_service_free() {
    let r = rig(Setup {
        tapes: vec![
            Err(Error::NoMicrophone("no default input device".into())),
            Err(Error::PermissionDenied("0x80070005".into())),
        ],
        ..Setup::default()
    });
    for expected in [Reason::NoMicrophone, Reason::PermissionDenied] {
        let (sink, rx) = listener();
        r.dictation.start(&sink);
        let seen = to_the_end(&rx);
        assert_eq!(reasons(&seen), vec![expected]);
        assert!(!seen.contains(&Event::Listening), "{seen:?}");
        eventually("free again", || !r.dictation.active());
    }
    assert_eq!(
        r.model.loads.load(Ordering::Relaxed),
        0,
        "no model is loaded for a dictation that cannot hear"
    );
}

#[test]
fn the_model_is_fetched_on_first_use_before_the_microphone_opens() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(1.0)), Ok(speech(1.0))],
        server: vec![serve(&content())],
        model_present: false,
        ..Setup::default()
    });
    let (sink, rx) = listener();
    let id = r.dictation.start(&sink);
    let mut seen = Vec::new();
    until(&rx, &mut seen, |e| *e == Event::Listening);
    // only progress came before listening, it never went back, and it is in bytes of the model
    let progress: Vec<(u64, u64)> = seen
        .iter()
        .filter_map(|e| match e {
            Event::Preparing { done, total } => Some((*done, *total)),
            _ => None,
        })
        .collect();
    assert_eq!(progress.len(), seen.len() - 1, "{seen:?}");
    assert!(!progress.is_empty());
    assert!(
        progress.windows(2).all(|w| w[0].0 <= w[1].0),
        "{progress:?}"
    );
    assert!(progress.iter().all(|p| p.1 == r.spec.size && p.0 <= p.1));
    assert_eq!(std::fs::read(r.spec.path(r.dir.path())).unwrap(), content());
    r.dictation.stop(id);
    to_the_end(&rx);
    eventually("free again", || !r.dictation.active());

    // the next dictation finds it: no progress, no request
    let (sink, rx) = listener();
    let id = r.dictation.start(&sink);
    let mut seen = Vec::new();
    until(&rx, &mut seen, |e| *e == Event::Listening);
    assert_eq!(seen, vec![Event::Listening]);
    r.dictation.stop(id);
    to_the_end(&rx);
    assert_eq!(r.server.asked().len(), 1);
}

#[test]
fn a_model_that_cannot_be_fetched_is_reported_and_the_microphone_stays_closed() {
    let mut wrong = content();
    wrong[7] ^= 0xff;
    for (server, why) in [
        (vec![status(404)], "not there"),
        (vec![serve(&wrong)], "the wrong bytes"),
        (vec![], "no network"),
    ] {
        let r = rig(Setup {
            server,
            model_present: false,
            ..Setup::default()
        });
        let (sink, rx) = listener();
        r.dictation.start(&sink);
        let seen = to_the_end(&rx);
        assert_eq!(
            reasons(&seen),
            vec![Reason::ModelDownloadFailed],
            "{why}: {seen:?}"
        );
        assert!(!seen.contains(&Event::Listening), "{why}");
        assert_eq!(
            r.mic.opened.load(Ordering::Relaxed),
            0,
            "{why}: the microphone was opened"
        );
        assert!(
            !r.spec.path(r.dir.path()).exists(),
            "{why}: a model is in place"
        );
        eventually("free again", || !r.dictation.active());
    }
}

#[test]
fn stopping_while_the_model_is_fetched_never_opens_the_microphone_and_the_fetch_finishes() {
    let (release, gate) = mpsc::channel::<()>();
    let gate = Mutex::new(gate);
    let bytes = content();
    let held: ServerStep = Box::new(move |url, from| {
        // the server answers only when the test lets it
        let _ = gate.lock().unwrap().recv_timeout(Duration::from_secs(20));
        serve(&bytes)(url, from)
    });
    let r = rig(Setup {
        server: vec![held],
        model_present: false,
        ..Setup::default()
    });
    let (sink, rx) = listener();
    let id = r.dictation.start(&sink);
    let mut seen = Vec::new();
    until(&rx, &mut seen, |e| matches!(e, Event::Preparing { .. }));
    r.dictation.stop(id);
    seen.extend(to_the_end(&rx));
    assert!(
        seen.iter()
            .all(|e| matches!(e, Event::Preparing { .. } | Event::Ended)),
        "{seen:?}"
    );
    assert_eq!(r.mic.opened.load(Ordering::Relaxed), 0);
    eventually("free again", || !r.dictation.active());

    // the fetch was not cancelled with the dictation: once the server answers, the model is in place
    release.send(()).unwrap();
    eventually("the model is in place", || r.spec.present(r.dir.path()));
    assert_eq!(r.server.asked().len(), 1, "one fetch, shared");
}

#[test]
fn the_cap_ends_a_dictation_with_its_words_and_a_plain_message() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(4.0))],
        tuning: Tuning {
            cap: Duration::from_secs(2),
            ..quick_tuning()
        },
        ..Setup::default()
    });
    let (sink, rx) = listener();
    r.dictation.start(&sink);
    let seen = to_the_end(&rx);
    assert_eq!(finals(&seen), vec!["words of 2.0 s"], "{seen:?}");
    let n = seen.len();
    assert!(
        matches!(&seen[n - 2], Event::Error { reason: Reason::TooLong, message, retry: true } if message == "Dictation stops after 2 seconds. Press the mic to go on."),
        "{seen:?}"
    );
    assert!(
        matches!(seen[n - 3], Event::Final { .. }),
        "the words come before the reason"
    );
    eventually("the microphone is closed", || {
        r.mic.closed.load(Ordering::Relaxed) == 1
    });
}

#[test]
fn a_microphone_that_goes_away_keeps_what_was_said() {
    let mut tape = speech(1.0);
    tape.push(Read::Failed(Error::NoMicrophone(
        "the device was unplugged".into(),
    )));
    let r = rig(Setup {
        tapes: vec![Ok(tape)],
        ..Setup::default()
    });
    let (sink, rx) = listener();
    r.dictation.start(&sink);
    let seen = to_the_end(&rx);
    assert_eq!(finals(&seen).len(), 1, "{seen:?}");
    assert_eq!(reasons(&seen), vec![Reason::NoMicrophone]);
}

#[test]
fn a_model_that_does_not_load_ends_the_dictation_with_its_reason() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(1.0))],
        broken_model: Some(Error::ModelMismatch("sha256".into())),
        ..Setup::default()
    });
    let (sink, rx) = listener();
    r.dictation.start(&sink);
    let seen = to_the_end(&rx);
    assert_eq!(
        reasons(&seen),
        vec![Reason::ModelDownloadFailed],
        "{seen:?}"
    );
    assert!(finals(&seen).is_empty());
    eventually("the microphone is closed", || {
        r.mic.closed.load(Ordering::Relaxed) == 1
    });
}

#[test]
fn a_window_that_is_gone_stops_the_dictation() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(1.0))],
        ..Setup::default()
    });
    // a sink nobody reads: the first event already cannot be delivered
    let nobody: Sink = Arc::new(|_| false);
    r.dictation.start(&nobody);
    eventually("it stopped by itself", || !r.dictation.active());
    assert_eq!(r.mic.closed.load(Ordering::Relaxed), 1);

    // stop_all is what the host calls when the window closes or its page loads again
    let (sink, rx) = listener();
    r.dictation.start(&sink);
    let mut seen = Vec::new();
    until(&rx, &mut seen, |e| *e == Event::Listening);
    r.dictation.stop_all();
    to_the_end(&rx);
    eventually("it stopped", || !r.dictation.active());
}

#[test]
fn the_model_stays_in_memory_between_dictations_and_leaves_after_a_while() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(1.0)), Ok(speech(1.0))],
        tuning: Tuning {
            model_idle: Duration::from_millis(300),
            ..quick_tuning()
        },
        ..Setup::default()
    });
    assert!(
        !r.dictation.model_loaded(),
        "nothing is loaded before the first dictation"
    );
    assert_eq!(r.model.loads.load(Ordering::Relaxed), 0);
    for _ in 0..2 {
        let (sink, rx) = listener();
        let id = r.dictation.start(&sink);
        let mut seen = Vec::new();
        until(&rx, &mut seen, |e| *e == Event::Listening);
        r.dictation.stop(id);
        to_the_end(&rx);
        eventually("free again", || !r.dictation.active());
    }
    assert_eq!(
        r.model.loads.load(Ordering::Relaxed),
        1,
        "loaded once for both"
    );
    eventually("the model left memory", || !r.dictation.model_loaded());
    assert_eq!(model::DEFAULT.id, "base-q5_1");
}

#[test]
fn settings_sees_the_model_absent_fetched_ready_and_deleted() {
    let r = rig(Setup {
        server: vec![serve(&content())],
        model_present: false,
        ..Setup::default()
    });
    let info = r.dictation.model();
    assert_eq!(info.state, ModelState::Absent);
    assert_eq!(info.size, r.spec.size);
    assert!(info.failed.is_none());
    r.dictation.fetch_model().unwrap();
    eventually("the model is in place", || {
        r.dictation.model().state == ModelState::Ready
    });
    assert!(r.spec.present(r.dir.path()));
    // a second Download does nothing: the model is there
    r.dictation.fetch_model().unwrap();
    assert_eq!(r.server.asked().len(), 1);
    r.dictation.delete_model().unwrap();
    assert_eq!(r.dictation.model().state, ModelState::Absent);
    assert!(!r.spec.path(r.dir.path()).exists());
    // deleting a model that is not there is no error
    r.dictation.delete_model().unwrap();
}

#[test]
fn the_model_is_not_deleted_while_a_dictation_listens() {
    let r = rig(Setup {
        tapes: vec![Ok(speech(1.0))],
        ..Setup::default()
    });
    let (sink, rx) = listener();
    let id = r.dictation.start(&sink);
    let mut seen = Vec::new();
    until(&rx, &mut seen, |e| *e == Event::Listening);
    assert_eq!(r.dictation.delete_model(), Err(Error::Busy));
    assert!(r.spec.present(r.dir.path()));
    r.dictation.stop(id);
    to_the_end(&rx);
    eventually("free again", || !r.dictation.active());
    r.dictation.delete_model().unwrap();
}

#[test]
fn a_failed_download_is_said_in_plain_words() {
    let r = rig(Setup {
        server: vec![status(404)],
        model_present: false,
        ..Setup::default()
    });
    r.dictation.fetch_model().unwrap();
    eventually("the fetch gave up", || r.dictation.model().failed.is_some());
    let info = r.dictation.model();
    assert_eq!(info.state, ModelState::Absent);
    assert!(info.failed.unwrap().contains("speech model"));
}
