//! The real thing, end to end, without a microphone: a recording is played to a dictation as a microphone would give it,
//! the real speech model writes it down, and the words are checked. The same service, session, resampler, segmenter and
//! whisper.cpp the app runs; only the source of the audio is a file.
//!
//! It needs the speech model, which is not in the repository. Point `HX_DICTATION_MODEL` at `ggml-base-q5_1.bin` (the
//! file of `model::DEFAULT`; its hash is checked here before anything loads it):
//!
//! ```sh
//! HX_DICTATION_MODEL=/path/to/ggml-base-q5_1.bin cargo test -p boopis-dictation --test speech -- --nocapture
//! ```
//!
//! Without the variable every test here **skips** and says so. CI sets it, and sets `HX_DICTATION_REQUIRE_MODEL=1`, which
//! turns a skip into a failure, so the job cannot pass without having heard the recording.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::cast_precision_loss,
    clippy::unchecked_time_subtraction
)] // a test: a failure is a panic with its reason

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use boopis_dictation::audio::{AudioSource, MODEL_RATE, Read, Resampler, downmix};
use boopis_dictation::capture::Microphone;
use boopis_dictation::fetch::{self, Reply, Transport};
use boopis_dictation::model;
use boopis_dictation::service::{Dictation, Parts};
use boopis_dictation::transcribe::{Recognizer, Whisper, WhisperOptions};
use boopis_dictation::{Event, Result, Sink, Tuning};

const RECORDING: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jfk.wav");

/// The speech folder that holds the model, or `None` (after saying why) when the test should skip.
fn speech_folder() -> Option<PathBuf> {
    let required = std::env::var_os("HX_DICTATION_REQUIRE_MODEL").is_some_and(|v| v == "1");
    let Some(path) = std::env::var_os("HX_DICTATION_MODEL").map(PathBuf::from) else {
        assert!(
            !required,
            "HX_DICTATION_REQUIRE_MODEL=1 but HX_DICTATION_MODEL is not set"
        );
        println!(
            "SKIPPED: the speech model is not here. Set HX_DICTATION_MODEL to {} (sha256 {}) to run this test.",
            model::DEFAULT.file,
            model::DEFAULT.sha256
        );
        return None;
    };
    assert!(
        path.is_file(),
        "HX_DICTATION_MODEL names {}, which is not a file",
        path.display()
    );
    assert_eq!(
        path.file_name().and_then(|n| n.to_str()),
        Some(model::DEFAULT.file),
        "the model file keeps the name the repository gives it"
    );
    // checked here first, so a wrong file fails the test with its hash instead of being deleted by the loader
    let found = model::sha256_file(&path).unwrap();
    assert_eq!(
        found,
        model::DEFAULT.sha256,
        "{} is not the pinned model",
        path.display()
    );
    Some(path.parent().unwrap().to_owned())
}

/// A 16-bit PCM WAV file as mono floats and its sample rate.
fn read_wav(path: &Path) -> (Vec<f32>, u32) {
    let mut reader = hound::WavReader::open(path).unwrap();
    let spec = reader.spec();
    assert_eq!(
        (spec.sample_format, spec.bits_per_sample),
        (hound::SampleFormat::Int, 16),
        "16-bit PCM only"
    );
    let pcm: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
    let mut mono = Vec::new();
    downmix(
        &pcm,
        usize::from(spec.channels),
        |s| f32::from(s) / 32_768.0,
        &mut mono,
    );
    (mono, spec.sample_rate)
}

/// A recording played as a microphone gives audio: in 10 ms blocks, at once or in real time, and then over.
struct Playback {
    samples: Vec<f32>,
    rate: u32,
    at: usize,
    /// When it started, for playback in real time.
    paced: Option<Instant>,
    /// Told when the last block was handed over (the moment a person would let go of the mic).
    ended: Arc<Mutex<Option<Instant>>>,
}

impl AudioSource for Playback {
    fn rate(&self) -> u32 {
        self.rate
    }

    fn read(&mut self, wait: Duration) -> Read {
        let block = self.rate as usize / 100;
        if self.at >= self.samples.len() {
            self.ended.lock().unwrap().get_or_insert_with(Instant::now);
            return Read::End;
        }
        if let Some(started) = self.paced {
            // a real microphone gives a block only once it has been spoken
            let due = Duration::from_secs_f64((self.at + block) as f64 / f64::from(self.rate));
            let now = started.elapsed();
            if now < due {
                std::thread::sleep((due - now).min(wait));
                if started.elapsed() < due {
                    return Read::Idle;
                }
            }
        }
        let end = (self.at + block).min(self.samples.len());
        let out = self.samples[self.at..end].to_vec();
        self.at = end;
        Read::Samples(out)
    }
}

struct Recording {
    samples: Vec<f32>,
    rate: u32,
    real_time: bool,
    ended: Arc<Mutex<Option<Instant>>>,
}

impl Microphone for Recording {
    fn open(&self) -> Result<Box<dyn AudioSource>> {
        Ok(Box::new(Playback {
            samples: self.samples.clone(),
            rate: self.rate,
            at: 0,
            paced: self.real_time.then(Instant::now),
            ended: self.ended.clone(),
        }))
    }
}

/// The model is on disk: a request for it is a bug in the test.
struct NoNetwork;

impl Transport for NoNetwork {
    fn get(&self, url: &url::Url, _from: u64) -> std::result::Result<Reply, String> {
        Err(format!("the test asked the network for {url}"))
    }
}

/// One dictation over `recording`: every event with when it came, and when the recording ended.
fn dictate(folder: &Path, recording: Recording) -> (Vec<(Duration, Event)>, Option<Duration>) {
    let ended = recording.ended.clone();
    let dictation = Dictation::new(Parts {
        spec: model::DEFAULT,
        dir: folder.to_owned(),
        tuning: Tuning::default(),
        policy: fetch::Policy::default(),
        microphone: Arc::new(recording),
        recognizer: Arc::new(Whisper::new(
            model::DEFAULT,
            folder.to_owned(),
            WhisperOptions::default(),
        )),
        transport: Arc::new(NoNetwork),
    });
    let (tx, rx): (_, Receiver<Event>) = mpsc::channel();
    let tx = Mutex::new(tx);
    let sink: Sink = Arc::new(move |e| tx.lock().unwrap().send(e).is_ok());
    let started = Instant::now();
    dictation.start(&sink);
    let mut events = Vec::new();
    loop {
        let event = rx
            .recv_timeout(Duration::from_mins(5))
            .unwrap_or_else(|_| panic!("the dictation did not end; so far {events:?}"));
        let over = event == Event::Ended;
        events.push((started.elapsed(), event));
        if over {
            break;
        }
    }
    let ended = ended.lock().unwrap().map(|at| at.duration_since(started));
    (events, ended)
}

/// What was written down for good, as bare lowercase words.
fn words(events: &[(Duration, Event)]) -> String {
    let all: Vec<&str> = events
        .iter()
        .filter_map(|(_, e)| match e {
            Event::Final { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    all.join(" ")
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn assert_the_speech(events: &[(Duration, Event)]) {
    assert!(
        !events.iter().any(|(_, e)| matches!(e, Event::Error { .. })),
        "the dictation failed: {events:?}"
    );
    assert_eq!(
        events.first().map(|(_, e)| e),
        Some(&Event::Listening),
        "{events:?}"
    );
    let said = words(events);
    for phrase in [
        "my fellow americans",
        "ask not what your country can do for you",
        "ask what you can do for your country",
    ] {
        assert!(said.contains(phrase), "{phrase:?} is not in {said:?}");
    }
}

#[test]
fn the_fixture_is_the_recording_the_readme_names() {
    assert_eq!(
        model::sha256_file(Path::new(RECORDING)).unwrap(),
        "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"
    );
    let (samples, rate) = read_wav(Path::new(RECORDING));
    assert_eq!(rate, MODEL_RATE);
    assert_eq!(samples.len(), 176_000, "eleven seconds");
}

#[test]
fn a_recording_is_written_down_by_the_real_model() {
    let Some(folder) = speech_folder() else {
        return;
    };
    let (samples, rate) = read_wav(Path::new(RECORDING));

    // how long the model takes to come into memory, hash check included (a dictation does this while it listens)
    let loading = Instant::now();
    let loaded = Whisper::new(model::DEFAULT, folder.clone(), WhisperOptions::default()).load();
    println!(
        "TIMING model verify and load: {} ms",
        loading.elapsed().as_millis()
    );
    assert!(loaded.is_ok(), "the model did not load: {:?}", loaded.err());
    drop(loaded);

    let (events, _) = dictate(
        &folder,
        Recording {
            samples,
            rate,
            real_time: false,
            ended: Arc::default(),
        },
    );
    println!("heard: {:?}", words(&events));
    assert_the_speech(&events);
}

#[test]
fn a_48_khz_microphone_is_heard_the_same() {
    let Some(folder) = speech_folder() else {
        return;
    };
    let (samples, rate) = read_wav(Path::new(RECORDING));
    // the recording as a 48 kHz device would give it; the dictation brings it back to the model's rate
    let mut up = Vec::new();
    let mut resampler = Resampler::new(rate, 48_000);
    resampler.push(&samples, &mut up);
    resampler.finish(&mut up);
    assert_eq!(up.len(), samples.len() * 3);
    let (events, _) = dictate(
        &folder,
        Recording {
            samples: up,
            rate: 48_000,
            real_time: false,
            ended: Arc::default(),
        },
    );
    println!("heard at 48 kHz: {:?}", words(&events));
    assert_the_speech(&events);
}

/// The recording at the speed it was spoken, as a person at a microphone: words appear while it plays, and the last ones
/// soon after it ends. The timings are printed (`--nocapture`); the bounds asserted are loose, for a busy CI runner. On a
/// machine whose processors are all taken by something else this test can fail: whisper.cpp then runs many times slower.
#[test]
fn words_appear_while_speaking_and_the_last_ones_soon_after() {
    let Some(folder) = speech_folder() else {
        return;
    };
    let (samples, rate) = read_wav(Path::new(RECORDING));
    let length = Duration::from_secs_f64(samples.len() as f64 / f64::from(rate));
    let (events, ended) = dictate(
        &folder,
        Recording {
            samples,
            rate,
            real_time: true,
            ended: Arc::default(),
        },
    );
    assert_the_speech(&events);
    let ended = ended.expect("the recording ended");
    let done = events.last().unwrap().0;
    let partials: Vec<Duration> = events
        .iter()
        .filter_map(|(at, e)| matches!(e, Event::Partial { .. }).then_some(*at))
        .collect();
    let finals: Vec<Duration> = events
        .iter()
        .filter_map(|(at, e)| matches!(e, Event::Final { .. }).then_some(*at))
        .collect();
    for (at, e) in &events {
        println!("{:>7} ms  {e:?}", at.as_millis());
    }
    println!("TIMING recording: {} ms of speech", length.as_millis());
    println!("TIMING listening after: {} ms", events[0].0.as_millis());
    println!(
        "TIMING first words after: {} ms",
        partials.first().or(finals.first()).unwrap().as_millis()
    );
    println!(
        "TIMING partials: {} while speaking, finals: {}",
        partials.iter().filter(|p| **p < ended).count(),
        finals.len()
    );
    println!(
        "TIMING last words after the recording ended: {} ms",
        done.saturating_sub(ended).as_millis()
    );
    assert!(
        partials.first().is_some_and(|p| *p < ended),
        "no words appeared while the recording played"
    );
    assert!(
        done.saturating_sub(ended) < Duration::from_secs(30),
        "the last words took {:?} after the end",
        done.saturating_sub(ended)
    );
}
