//! What a dictation does with the audio it hears, as a state machine with no thread, no clock and no model in it: audio
//! goes in ([`Segmenter::feed`]), requests to write a stretch down come out ([`Step::Transcribe`]), their answers come
//! back ([`Segmenter::transcribed`]), and events for the UI come out ([`Step::Emit`]). Time is counted in samples, so
//! the same audio always gives the same steps.
//!
//! - Speech is cut into **stretches** at pauses ([`Tuning::pause`]) and, with no pause, at [`Tuning::max_stretch`]. A
//!   finished stretch is written down for good (a `Final`); the audio of it is then dropped.
//! - While a stretch is being spoken it is written down again every [`Tuning::partial_every`] (a `Partial`), but only
//!   when the last request has come back: a slow computer gets fewer partials, never a queue of them.
//! - Quiet is never sent to the model (it invents words for silence): a stretch needs [`Tuning::min_speech`] of sound
//!   over the room's own level to count.
//! - At the cap ([`Tuning::cap`]) it stops like a stop, and says so after the last words.

use std::collections::VecDeque;

use crate::audio::{FRAME, MODEL_RATE, rms};
use crate::{Error, Event, Tuning};

/// A stretch of audio to write down.
#[derive(Clone, PartialEq)]
pub struct Job {
    /// Which request this is; answers come back with it.
    pub id: u64,
    /// The audio, mono at [`MODEL_RATE`].
    pub audio: Vec<f32>,
    /// The last words already written down, as context for the model.
    pub prompt: String,
    /// Whether these are the stretch's words for good. A partial may be given up when a final is waiting.
    pub last: bool,
    /// Which stretch of the dictation this audio is (0, 1, ...): requests for the same stretch hear the same language.
    pub stretch: u64,
}

/// A job prints as what it is, never as what was said: audio and words stay out of logs and test output.
impl std::fmt::Debug for Job {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Job")
            .field("id", &self.id)
            .field("samples", &self.audio.len())
            .field("prompt_chars", &self.prompt.chars().count())
            .field("last", &self.last)
            .field("stretch", &self.stretch)
            .finish()
    }
}

/// What the caller does next.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Tell the UI.
    Emit(Event),
    /// Write this stretch down and call [`Segmenter::transcribed`] with the answer. Requests are answered in order.
    Transcribe(Job),
    /// Stop reading the microphone: the dictation only waits for its last answers now.
    CloseSource,
    /// Everything is said: the dictation is over.
    Done,
}

/// Where the dictation is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Listening,
    /// No more audio is taken; the answers still out are awaited.
    Finishing,
    Over,
}

/// A request that is out.
#[derive(Debug, Clone, Copy)]
struct Pending {
    id: u64,
    last: bool,
    /// The stretch it was cut from; a partial of a stretch that has since ended is stale.
    stretch: u64,
}

/// The state machine of one dictation.
#[derive(Debug)]
pub struct Segmenter {
    tuning: Tuning,
    phase: Phase,
    /// Samples of the current stretch.
    stretch: Vec<f32>,
    /// A frame being filled, not yet measured.
    frame: Vec<f32>,
    stretch_no: u64,
    /// Samples of speech in the current stretch.
    speech: usize,
    /// Samples of quiet at the end of the current stretch.
    quiet: usize,
    /// Samples since the last partial was asked for.
    since_partial: usize,
    /// The room's own level, followed from below.
    noise: f32,
    /// Samples heard in all.
    heard: u64,
    /// Whether every sample so far was exactly zero.
    all_zero: bool,
    pending: VecDeque<Pending>,
    next_id: u64,
    /// The end of what was written down, for the model's context.
    context: String,
    last_partial: String,
    /// Said after the last words, before the end.
    closing: Option<Error>,
}

/// The longest context handed to the model, in characters.
const CONTEXT_CHARS: usize = 200;
/// Quiet kept before the first sound of a stretch, so a word's first consonant is not cut.
const LEAD_IN: usize = MODEL_RATE as usize * 3 / 10;
/// Quiet kept after the last sound of a stretch.
const TAIL: usize = MODEL_RATE as usize / 5;
/// The room's level is never taken to be louder than this, so someone who speaks from the first instant is heard.
const NOISE_CEILING: f32 = 0.01;

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)] // durations of seconds as sample counts
fn samples(d: std::time::Duration) -> usize {
    (d.as_secs_f64() * f64::from(MODEL_RATE)).round() as usize
}

impl Segmenter {
    /// A dictation that has heard nothing yet.
    #[must_use]
    pub fn new(tuning: Tuning) -> Self {
        Self {
            tuning,
            phase: Phase::Listening,
            stretch: Vec::new(),
            frame: Vec::with_capacity(FRAME),
            stretch_no: 0,
            speech: 0,
            quiet: 0,
            since_partial: 0,
            noise: NOISE_CEILING,
            heard: 0,
            all_zero: true,
            pending: VecDeque::new(),
            next_id: 1,
            context: String::new(),
            last_partial: String::new(),
            closing: None,
        }
    }

    /// Whether audio is still taken.
    #[must_use]
    pub fn listening(&self) -> bool {
        self.phase == Phase::Listening
    }

    /// Whether the dictation is over.
    #[must_use]
    pub fn over(&self) -> bool {
        self.phase == Phase::Over
    }

    /// How much has been heard.
    #[must_use]
    pub fn heard(&self) -> std::time::Duration {
        #[allow(clippy::cast_precision_loss)]
        std::time::Duration::from_secs_f64(self.heard as f64 / f64::from(MODEL_RATE))
    }

    /// The next audio, mono at [`MODEL_RATE`].
    pub fn feed(&mut self, audio: &[f32]) -> Vec<Step> {
        let mut steps = Vec::new();
        let cap = samples(self.tuning.cap) as u64;
        for sample in audio {
            if self.phase != Phase::Listening {
                break;
            }
            self.heard += 1;
            self.all_zero &= *sample == 0.0;
            self.frame.push(*sample);
            if self.frame.len() == FRAME {
                self.take_frame(&mut steps);
            }
            if self.phase == Phase::Listening && self.heard >= cap {
                self.finish(Some(Error::TooLong(self.tuning.cap)), &mut steps);
            }
        }
        if self.phase == Phase::Listening
            && self.all_zero
            && self.heard >= samples(self.tuning.silence_probe) as u64
        {
            self.finish(Some(Error::Silent), &mut steps);
        }
        steps
    }

    /// The person stopped, or the source ended: write down what is left and end.
    pub fn stop(&mut self) -> Vec<Step> {
        let mut steps = Vec::new();
        self.finish(None, &mut steps);
        steps
    }

    /// The source failed: write down what was heard, then say why it stopped.
    pub fn fail(&mut self, error: Error) -> Vec<Step> {
        let mut steps = Vec::new();
        self.finish(Some(error), &mut steps);
        steps
    }

    /// The answer to the request `id`: the words, or why there are none. An answer to a request that is not the oldest
    /// one out is ignored (answers come in order).
    pub fn transcribed(&mut self, id: u64, answer: Result<String, Error>) -> Vec<Step> {
        let mut steps = Vec::new();
        if self.pending.front().is_none_or(|p| p.id != id) {
            return steps;
        }
        let Some(asked) = self.pending.pop_front() else {
            return steps;
        };
        match answer {
            Ok(text) => {
                let text = text.trim();
                if asked.last {
                    self.last_partial.clear();
                    if !text.is_empty() {
                        self.remember(text);
                        steps.push(Step::Emit(Event::Final {
                            text: text.to_owned(),
                        }));
                    }
                } else if asked.stretch == self.stretch_no
                    && self.phase == Phase::Listening
                    && !text.is_empty()
                    && text != self.last_partial
                {
                    text.clone_into(&mut self.last_partial);
                    steps.push(Step::Emit(Event::Partial {
                        text: text.to_owned(),
                    }));
                }
            }
            // a partial that failed or was given up is only a missing partial
            Err(e) if asked.last => {
                if self.phase == Phase::Listening {
                    steps.push(Step::CloseSource);
                }
                self.phase = Phase::Finishing;
                self.pending.clear();
                self.closing = Some(e);
            }
            Err(_) => {}
        }
        self.end_if_done(&mut steps);
        steps
    }

    /// One 20 ms frame is full: measure it and decide.
    fn take_frame(&mut self, steps: &mut Vec<Step>) {
        let level = rms(&self.frame);
        // the room's level: down at once, up slowly
        self.noise = if level < self.noise {
            level
        } else {
            (self.noise * 1.003).min(NOISE_CEILING)
        };
        let loud = level
            > self
                .tuning
                .speech_floor
                .max(self.noise * self.tuning.speech_ratio);
        if loud && self.speech == 0 {
            // the first sound of a stretch: the quiet before it is cut to a lead-in
            let drop = self.stretch.len().saturating_sub(LEAD_IN);
            self.stretch.drain(..drop);
        }
        self.stretch.append(&mut self.frame);
        self.since_partial += FRAME;
        if loud {
            self.speech += FRAME;
            self.quiet = 0;
        } else {
            self.quiet += FRAME;
        }
        let spoken = self.speech >= samples(self.tuning.min_speech);
        if !spoken {
            // nothing said yet: partials are counted from the first words, and only a lead-in is kept, so quiet does not
            // pile up and a noise is forgotten
            self.since_partial = 0;
            if self.quiet >= LEAD_IN * 2 {
                let drop = self.stretch.len().saturating_sub(LEAD_IN);
                self.stretch.drain(..drop);
                self.speech = 0;
            }
            return;
        }
        if self.quiet >= samples(self.tuning.pause)
            || self.stretch.len() >= samples(self.tuning.max_stretch)
        {
            self.cut(steps);
        } else if self.pending.is_empty()
            && self.quiet < TAIL
            && self.since_partial >= samples(self.tuning.partial_every)
        {
            // not in the quiet that may be the stretch's end: its words for good are about to be asked for
            self.since_partial = 0;
            self.ask(false, self.stretch.clone(), steps);
        }
    }

    /// End the current stretch: ask for its words for good and start a new one.
    fn cut(&mut self, steps: &mut Vec<Step>) {
        let keep = self
            .stretch
            .len()
            .saturating_sub(self.quiet.saturating_sub(TAIL));
        let mut audio = std::mem::take(&mut self.stretch);
        audio.truncate(keep);
        self.ask(true, audio, steps);
        self.stretch_no += 1;
        self.speech = 0;
        self.quiet = 0;
        self.since_partial = 0;
    }

    fn ask(&mut self, last: bool, audio: Vec<f32>, steps: &mut Vec<Step>) {
        let id = self.next_id;
        self.next_id += 1;
        self.pending.push_back(Pending {
            id,
            last,
            stretch: self.stretch_no,
        });
        steps.push(Step::Transcribe(Job {
            id,
            audio,
            prompt: self.context.clone(),
            last,
            stretch: self.stretch_no,
        }));
    }

    /// Stop taking audio, ask for the words of what is left, and end once every answer is in.
    fn finish(&mut self, closing: Option<Error>, steps: &mut Vec<Step>) {
        if self.phase != Phase::Listening {
            return;
        }
        self.phase = Phase::Finishing;
        self.closing = closing;
        steps.push(Step::CloseSource);
        self.stretch.append(&mut self.frame);
        if self.speech >= samples(self.tuning.min_speech) {
            self.cut(steps);
        } else {
            self.stretch.clear();
        }
        self.end_if_done(steps);
    }

    fn end_if_done(&mut self, steps: &mut Vec<Step>) {
        if self.phase != Phase::Finishing || self.pending.iter().any(|p| p.last) {
            return;
        }
        self.phase = Phase::Over;
        self.pending.clear();
        if let Some(e) = self.closing.take() {
            steps.push(Step::Emit(e.event()));
        }
        steps.push(Step::Emit(Event::Ended));
        steps.push(Step::Done);
    }

    /// Keep the end of what was written down as the model's context.
    fn remember(&mut self, text: &str) {
        if !self.context.is_empty() {
            self.context.push(' ');
        }
        self.context.push_str(text);
        let chars = self.context.chars().count();
        if chars > CONTEXT_CHARS {
            self.context = self.context.chars().skip(chars - CONTEXT_CHARS).collect();
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::Reason;

    const RATE: usize = MODEL_RATE as usize;

    /// The numbers these tests are written against, whatever the defaults become.
    fn tuning() -> Tuning {
        Tuning {
            cap: Duration::from_mins(5),
            pause: Duration::from_millis(700),
            partial_every: Duration::from_millis(1500),
            max_stretch: Duration::from_secs(24),
            min_speech: Duration::from_millis(160),
            silence_probe: Duration::from_secs(3),
            speech_floor: 0.003,
            speech_ratio: 3.0,
            ..Tuning::default()
        }
    }

    /// A sound a person could make: a 200 Hz tone at a speaking level.
    fn speech(seconds: f64) -> Vec<f32> {
        (0..(seconds * RATE as f64) as usize)
            .map(|i| {
                (0.2 * (2.0 * std::f64::consts::PI * 200.0 * i as f64 / RATE as f64).sin()) as f32
            })
            .collect()
    }

    /// A quiet room: a faint hum, never exactly zero.
    fn room(seconds: f64) -> Vec<f32> {
        (0..(seconds * RATE as f64) as usize)
            .map(|i| if i % 2 == 0 { 0.0004 } else { -0.0004 })
            .collect()
    }

    fn jobs(steps: &[Step]) -> Vec<&Job> {
        steps
            .iter()
            .filter_map(|s| match s {
                Step::Transcribe(j) => Some(j),
                _ => None,
            })
            .collect()
    }

    fn events(steps: &[Step]) -> Vec<Event> {
        steps
            .iter()
            .filter_map(|s| match s {
                Step::Emit(e) => Some(e.clone()),
                _ => None,
            })
            .collect()
    }

    fn seconds(job: &Job) -> f64 {
        job.audio.len() as f64 / RATE as f64
    }

    #[test]
    fn a_pause_ends_a_stretch_and_its_words_are_final() {
        let mut s = Segmenter::new(tuning());
        assert!(s.feed(&room(0.5)).is_empty());
        // one second of speech is under the partial interval: nothing is asked while it is spoken
        assert!(s.feed(&speech(1.0)).is_empty());
        let steps = s.feed(&room(1.0));
        let asked = jobs(&steps);
        assert_eq!(asked.len(), 1, "{steps:?}");
        assert!(asked[0].last);
        // the speech with a little quiet around it, not the whole second of quiet after it
        assert!(
            (1.2..1.7).contains(&seconds(asked[0])),
            "{}",
            seconds(asked[0])
        );
        assert_eq!(
            events(&s.transcribed(asked[0].id, Ok("  hello there ".into()))),
            vec![Event::Final {
                text: "hello there".into()
            }]
        );
        assert!(s.listening(), "a pause does not end the dictation");

        // the next stretch gets the last words as context
        let _ = s.feed(&speech(1.0));
        let steps = s.feed(&room(1.0));
        assert_eq!(jobs(&steps)[0].prompt, "hello there");
    }

    #[test]
    fn partials_come_while_speaking_and_never_queue_up() {
        let mut s = Segmenter::new(tuning());
        let steps = s.feed(&speech(1.8));
        let first = jobs(&steps);
        assert_eq!(first.len(), 1);
        assert!(!first[0].last);
        let first_id = first[0].id;

        // the answer is slow: six more seconds of speech ask for nothing new
        assert!(jobs(&s.feed(&speech(6.0))).is_empty(), "partials queued");
        assert_eq!(
            events(&s.transcribed(first_id, Ok("and so".into()))),
            vec![Event::Partial {
                text: "and so".into()
            }]
        );
        // answered: the next frame asks again, with everything said so far
        let steps = s.feed(&speech(0.1));
        let second = jobs(&steps);
        assert_eq!(second.len(), 1);
        assert!(
            (7.8..7.95).contains(&seconds(second[0])),
            "{}",
            seconds(second[0])
        );
        // the same words again are not a new partial
        let second_id = second[0].id;
        let _ = s.transcribed(second_id, Ok("and so".into()));
        let steps = s.feed(&speech(1.6));
        let third = jobs(&steps)[0].id;
        assert!(events(&s.transcribed(third, Ok("and so".into()))).is_empty());
    }

    #[test]
    fn a_partial_of_a_stretch_that_has_ended_is_dropped() {
        let mut s = Segmenter::new(tuning());
        let steps = s.feed(&speech(1.8));
        let partial = jobs(&steps)[0].id;
        let steps = s.feed(&room(1.0));
        let last = jobs(&steps)[0].id;
        assert!(jobs(&steps)[0].last);
        // the partial comes back after the pause: its stretch is over, the final follows
        assert!(events(&s.transcribed(partial, Ok("and".into()))).is_empty());
        assert_eq!(
            events(&s.transcribed(last, Ok("and so my fellow Americans".into()))),
            vec![Event::Final {
                text: "and so my fellow Americans".into()
            }]
        );
        // an answer out of order, or twice, changes nothing
        assert!(s.transcribed(last, Ok("again".into())).is_empty());
        assert!(s.transcribed(999, Ok("never asked".into())).is_empty());
    }

    #[test]
    fn stop_writes_down_what_is_left_and_then_ends() {
        let mut s = Segmenter::new(tuning());
        let _ = s.feed(&speech(1.0));
        let steps = s.stop();
        assert_eq!(steps[0], Step::CloseSource);
        let asked = jobs(&steps);
        assert_eq!(asked.len(), 1);
        assert!(asked[0].last);
        assert!(!s.over() && !s.listening());
        // nothing more is taken
        assert!(s.feed(&speech(1.0)).is_empty());
        assert!(s.stop().is_empty(), "a second stop is nothing");
        let steps = s.transcribed(asked[0].id, Ok("ask not".into()));
        assert_eq!(
            steps,
            vec![
                Step::Emit(Event::Final {
                    text: "ask not".into()
                }),
                Step::Emit(Event::Ended),
                Step::Done
            ]
        );
        assert!(s.over());
    }

    #[test]
    fn stop_does_not_wait_for_a_partial_and_ends_at_once_when_nothing_was_said() {
        let mut s = Segmenter::new(tuning());
        let _ = s.feed(&room(2.0));
        assert_eq!(
            s.stop(),
            vec![Step::CloseSource, Step::Emit(Event::Ended), Step::Done],
            "quiet is never sent to the model"
        );

        let mut s = Segmenter::new(tuning());
        let steps = s.feed(&speech(1.8));
        let partial = jobs(&steps)[0].id;
        let steps = s.stop();
        let last = jobs(&steps)[0].id;
        // the partial's answer (given up, or late) is not shown and does not end anything
        assert!(
            s.transcribed(partial, Err(Error::Failed("given up".into())))
                .is_empty()
        );
        assert!(!s.over());
        let steps = s.transcribed(last, Ok("the words".into()));
        assert_eq!(steps.last(), Some(&Step::Done));
    }

    #[test]
    fn a_noise_and_silence_ask_for_nothing() {
        let mut s = Segmenter::new(tuning());
        let mut all = Vec::new();
        all.extend(s.feed(&room(1.0)));
        all.extend(s.feed(&speech(0.06))); // a click, shorter than speech
        all.extend(s.feed(&room(3.0)));
        assert!(jobs(&all).is_empty(), "{all:?}");
        // and the quiet does not pile up in memory
        assert!(
            s.stretch.len() <= LEAD_IN * 2 + FRAME,
            "{}",
            s.stretch.len()
        );
    }

    #[test]
    fn a_long_stretch_without_a_pause_is_cut() {
        let tuning = Tuning {
            max_stretch: Duration::from_secs(5),
            ..tuning()
        };
        let mut s = Segmenter::new(tuning);
        let mut finals = Vec::new();
        for _ in 0..120 {
            // 12 s of speech in 100 ms blocks, every request answered at once
            for step in s.feed(&speech(0.1)) {
                if let Step::Transcribe(j) = step {
                    if j.last {
                        finals.push(seconds(&j));
                    }
                    let _ = s.transcribed(j.id, Ok("words".into()));
                }
            }
        }
        assert_eq!(finals.len(), 2, "{finals:?}");
        assert!(finals.iter().all(|f| (4.9..5.1).contains(f)), "{finals:?}");
    }

    #[test]
    fn the_cap_stops_it_with_the_words_first_and_the_reason_after() {
        let tuning = Tuning {
            cap: Duration::from_secs(3),
            ..tuning()
        };
        let mut s = Segmenter::new(tuning);
        let mut steps = Vec::new();
        for _ in 0..40 {
            steps.extend(s.feed(&speech(0.1)));
        }
        assert!(steps.contains(&Step::CloseSource));
        assert!(
            (s.heard().as_secs_f64() - 3.0).abs() < 0.001,
            "nothing past the cap is heard"
        );
        let last: Vec<&Job> = jobs(&steps).into_iter().filter(|j| j.last).collect();
        assert_eq!(last.len(), 1);
        // the partial that was out is answered first (answers come in order), then the final
        let mut said = Vec::new();
        for j in jobs(&steps) {
            said.extend(events(&s.transcribed(j.id, Ok("three seconds".into()))));
        }
        assert_eq!(said.len(), 3, "{said:?}");
        assert_eq!(
            said[0],
            Event::Final {
                text: "three seconds".into()
            }
        );
        assert!(
            matches!(&said[1], Event::Error { reason: Reason::TooLong, message, retry: true } if message == "Dictation stops after 3 seconds. Press the mic to go on."),
            "{:?}",
            said[1]
        );
        assert_eq!(said[2], Event::Ended);
    }

    #[test]
    fn a_microphone_that_gives_only_zeros_is_reported() {
        let mut s = Segmenter::new(tuning());
        assert!(s.feed(&vec![0.0; RATE * 2]).is_empty());
        let steps = s.feed(&vec![0.0; RATE]);
        assert_eq!(steps[0], Step::CloseSource);
        let said = events(&steps);
        assert!(
            matches!(&said[0], Event::Error { reason, .. } if *reason == Error::Silent.reason())
        );
        assert_eq!(said[1], Event::Ended);

        // a quiet room is not zeros, and neither is one sample of sound
        let mut s = Segmenter::new(tuning());
        assert!(s.feed(&room(4.0)).is_empty());
        assert!(s.listening());
    }

    #[test]
    fn a_source_that_fails_keeps_the_words_and_says_why() {
        let mut s = Segmenter::new(tuning());
        let _ = s.feed(&speech(1.0));
        let steps = s.fail(Error::NoMicrophone("unplugged".into()));
        let last = jobs(&steps)[0].id;
        let said = events(&s.transcribed(last, Ok("before it went".into())));
        assert_eq!(
            said[0],
            Event::Final {
                text: "before it went".into()
            }
        );
        assert!(matches!(
            &said[1],
            Event::Error {
                reason: Reason::NoMicrophone,
                ..
            }
        ));
        assert_eq!(said[2], Event::Ended);
    }

    #[test]
    fn a_final_that_cannot_be_written_down_ends_the_dictation_with_the_reason() {
        let mut s = Segmenter::new(tuning());
        let _ = s.feed(&speech(1.0));
        let steps = s.feed(&room(1.0));
        let last = jobs(&steps)[0].id;
        let steps = s.transcribed(last, Err(Error::ModelMismatch("sha".into())));
        assert_eq!(steps[0], Step::CloseSource);
        let said = events(&steps);
        assert!(matches!(
            &said[0],
            Event::Error {
                reason: Reason::ModelDownloadFailed,
                ..
            }
        ));
        assert_eq!(said.last(), Some(&Event::Ended));
        assert!(s.over());
    }

    #[test]
    fn someone_who_speaks_from_the_first_instant_is_heard() {
        let mut s = Segmenter::new(tuning());
        let _ = s.feed(&speech(0.8));
        let steps = s.stop();
        assert_eq!(jobs(&steps).len(), 1);
    }

    #[test]
    fn the_context_stays_short() {
        let mut s = Segmenter::new(tuning());
        for _ in 0..30 {
            let _ = s.feed(&speech(1.0));
            for step in s.feed(&room(1.0)) {
                if let Step::Transcribe(j) = step {
                    assert!(j.prompt.chars().count() <= CONTEXT_CHARS);
                    let _ = s.transcribed(j.id, Ok("ação e coração, twenty words or so".into()));
                }
            }
        }
        assert_eq!(s.context.chars().count(), CONTEXT_CHARS);
    }
}
