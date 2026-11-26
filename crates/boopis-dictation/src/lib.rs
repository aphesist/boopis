//! Dictation for the boopis desktop host (ADR-0059): the microphone, and speech to text on this computer.
//!
//! - **Local.** Audio is read from the system's own audio API ([`capture`]), turned into text by whisper.cpp in this
//!   process ([`transcribe`]) and dropped. It is never written to disk and never sent anywhere. The only network request
//!   of this crate is the one-time fetch of the speech model ([`fetch`]), through a [`fetch::Transport`] the host gives it.
//! - **The model is untrusted until its hash matches.** It is fetched to a `.part` file, hashed, and only then given its
//!   name; and every time it is loaded its bytes are hashed again first, and those same bytes are what whisper.cpp
//!   reads ([`model`]).
//! - **One dictation at a time, started only by a call to [`service::Dictation::start`].** Nothing here listens on its
//!   own, and nothing reads the microphone but a running [`session`].
//! - **The same code runs on a microphone and on a file.** A session reads an [`audio::AudioSource`]; the tests give it
//!   a WAV file.
//!
//! What a caller sees is a stream of [`Event`]s: `Preparing` while the model is fetched, `Listening`, `Partial` words
//! while the person speaks, a `Final` for each stretch of speech (at a pause, and at the end), an `Error` with one of a
//! few [`Reason`]s, and `Ended`, always last.

pub mod audio;
pub mod capture;
pub mod fetch;
pub mod model;
pub mod segment;
pub mod service;
pub mod session;
pub mod transcribe;

use std::sync::Arc;
use std::time::Duration;

/// Why a dictation could not start or stopped by itself: the small set the UI knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Reason {
    /// There is no microphone, or it went away.
    NoMicrophone,
    /// The system does not let boopis use the microphone, or the microphone gives no sound at all.
    PermissionDenied,
    /// The speech model could not be fetched, or what arrived was not the model.
    ModelDownloadFailed,
    /// Another dictation is listening.
    Busy,
    /// The dictation reached its time cap.
    TooLong,
    /// Anything else.
    Failed,
}

impl Reason {
    /// The reason as the UI reads it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoMicrophone => "no-microphone",
            Self::PermissionDenied => "permission-denied",
            Self::ModelDownloadFailed => "model-download-failed",
            Self::Busy => "busy",
            Self::TooLong => "too-long",
            Self::Failed => "failed",
        }
    }
}

/// Everything this crate can fail with. `Display` is the raw text, for the log; a person reads [`Error::sentence`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// No input device, or the one in use went away.
    #[error("no microphone: {0}")]
    NoMicrophone(String),
    /// The system refused the microphone.
    #[error("the microphone was refused: {0}")]
    PermissionDenied(String),
    /// The microphone opened and gave only digital silence: on Windows that is how a privacy setting that is off looks
    /// to an app; elsewhere it is a muted input.
    #[error("the microphone gives no sound")]
    Silent,
    /// The model could not be fetched (the network, the server, the disk).
    #[error("the speech model could not be fetched: {0}")]
    ModelFetch(String),
    /// What was fetched, or what is on disk, is not the model: its size or hash differs. The file was deleted.
    #[error("the speech model is not the expected file: {0}")]
    ModelMismatch(String),
    /// Another dictation is listening.
    #[error("another dictation is listening")]
    Busy,
    /// The time cap was reached.
    #[error("the dictation reached its cap of {} s", .0.as_secs())]
    TooLong(Duration),
    /// This processor lacks the instructions the speech model was compiled for.
    #[error("this processor cannot run the speech model: {0}")]
    Processor(String),
    /// Anything else: the model did not load, a transcription failed, a thread could not start.
    #[error("{0}")]
    Failed(String),
}

/// A specialised `Result`.
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Which of the UI's reasons this is.
    #[must_use]
    pub fn reason(&self) -> Reason {
        match self {
            Self::NoMicrophone(_) => Reason::NoMicrophone,
            Self::PermissionDenied(_) => Reason::PermissionDenied,
            // On Windows a privacy setting that is off gives silence, and there is nothing to ask. macOS is asked for its
            // authorization before the device opens (`capture::access`), so silence there is a muted input, as on Linux.
            Self::Silent => {
                if cfg!(target_os = "windows") {
                    Reason::PermissionDenied
                } else {
                    Reason::NoMicrophone
                }
            }
            Self::ModelFetch(_) | Self::ModelMismatch(_) => Reason::ModelDownloadFailed,
            Self::Busy => Reason::Busy,
            Self::TooLong(_) => Reason::TooLong,
            Self::Processor(_) | Self::Failed(_) => Reason::Failed,
        }
    }

    /// Whether pressing the mic again can help.
    #[must_use]
    pub fn retry(&self) -> bool {
        !matches!(self, Self::Processor(_))
    }

    /// What a person reads: what happened and what to do, in plain words, with nothing a library or a server said.
    #[must_use]
    pub fn sentence(&self) -> String {
        match self {
            Self::NoMicrophone(_) => "boopis found no microphone. Plug one in, or choose an input in your system's sound settings, then press the mic again.".to_owned(),
            Self::PermissionDenied(_) => format!("boopis is not allowed to use the microphone. {} Then press the mic again.", where_to_allow()),
            Self::Silent => format!("boopis hears nothing from the microphone. Check that it is not muted. {}", where_to_allow()),
            Self::ModelFetch(_) => "boopis could not get its speech model, which it fetches once. Check the connection and press the mic again: it goes on from where it stopped.".to_owned(),
            Self::ModelMismatch(_) => "The speech model on this computer was not the file boopis expects, so it was deleted. Press the mic to fetch it again.".to_owned(),
            Self::Busy => "boopis is already listening for another message. Stop that dictation, then press the mic again.".to_owned(),
            Self::TooLong(cap) => format!("Dictation stops after {}. Press the mic to go on.", plain_duration(*cap)),
            Self::Processor(_) => "Dictation needs a processor with AVX2, which this computer does not have.".to_owned(),
            Self::Failed(_) => "Dictation stopped working. Press the mic to try again.".to_owned(),
        }
    }

    /// This error as the event a caller gets.
    #[must_use]
    pub fn event(&self) -> Event {
        Event::Error {
            reason: self.reason(),
            message: self.sentence(),
            retry: self.retry(),
        }
    }
}

/// Where this system lets a person allow the microphone.
fn where_to_allow() -> &'static str {
    if cfg!(target_os = "macos") {
        "Allow boopis in System Settings, Privacy & Security, Microphone."
    } else if cfg!(target_os = "windows") {
        "In Windows Settings, Privacy & security, Microphone, turn on \"Let desktop apps access your microphone\"."
    } else {
        "Check the input in your system's sound settings."
    }
}

/// `5 minutes`, `90 seconds`.
fn plain_duration(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 60 && s.is_multiple_of(60) {
        let m = s / 60;
        format!("{m} minute{}", if m == 1 { "" } else { "s" })
    } else {
        format!("{s} second{}", if s == 1 { "" } else { "s" })
    }
}

/// What a dictation says of itself, in order. `Ended` is always the last event and comes exactly once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// The speech model is being fetched, once: bytes so far of the whole.
    Preparing {
        /// Bytes on disk so far.
        done: u64,
        /// The model's size in bytes.
        total: u64,
    },
    /// The microphone is open and what is said is heard.
    Listening,
    /// The words of the stretch being spoken, so far. Each one replaces the last.
    Partial {
        /// The words so far.
        text: String,
    },
    /// The words of a finished stretch of speech (a pause ended it, or the dictation did). They stay; the next
    /// `Partial` starts a new stretch.
    Final {
        /// The words.
        text: String,
    },
    /// The dictation could not start, or stopped by itself.
    Error {
        /// One of the UI's reasons.
        reason: Reason,
        /// What to tell the person, in plain words.
        message: String,
        /// Whether pressing the mic again can help.
        retry: bool,
    },
    /// The dictation is over: nothing follows.
    Ended,
}

/// Where a dictation's events go. It answers `false` when nobody is there to read them any more (the window closed),
/// which stops the dictation. It is called from the dictation's own thread and must not block.
pub type Sink = Arc<dyn Fn(Event) -> bool + Send + Sync>;

/// Every number of a dictation, as data (`docs/STANDARDS.md` section 1, rule 6).
#[derive(Debug, Clone, PartialEq)]
pub struct Tuning {
    /// The longest one dictation may listen. At the cap it stops, writes down what it heard and says so.
    pub cap: Duration,
    /// Quiet this long after speech ends a stretch: it is written down for good and the next words start a new one.
    pub pause: Duration,
    /// While someone speaks, the stretch so far is written down this often (when the last attempt has come back).
    pub partial_every: Duration,
    /// A stretch is cut at this length even with no pause (the model reads 30 s at a time).
    pub max_stretch: Duration,
    /// Speech shorter than this in a stretch is taken for a noise and not written down.
    pub min_speech: Duration,
    /// A microphone that gives only digital silence for this long, from the start, is reported and closed.
    pub silence_probe: Duration,
    /// The level (RMS of a 20 ms frame, full scale 1.0) under which a frame is never speech.
    pub speech_floor: f32,
    /// A frame is speech when it is this many times louder than the room's own noise.
    pub speech_ratio: f32,
    /// How long the speech model stays in memory after the last dictation (about 150 MB while it is loaded).
    pub model_idle: Duration,
    /// How often a waiting dictation looks at the model fetch, and how long a read of the microphone waits.
    pub tick: Duration,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            cap: Duration::from_mins(5),
            pause: Duration::from_millis(700),
            partial_every: Duration::from_secs(2),
            max_stretch: Duration::from_secs(24),
            min_speech: Duration::from_millis(160),
            silence_probe: Duration::from_secs(3),
            speech_floor: 0.003,
            speech_ratio: 3.0,
            model_idle: Duration::from_mins(2),
            tick: Duration::from_millis(50),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_error_has_one_of_the_reasons_and_a_plain_sentence() {
        let all = [
            Error::NoMicrophone("ALSA lib pcm.c: Unknown PCM default".into()),
            Error::PermissionDenied("0x80070005".into()),
            Error::Silent,
            Error::ModelFetch("https://cdn.example/x: connection reset by peer".into()),
            Error::ModelMismatch("sha256 abc".into()),
            Error::Busy,
            Error::TooLong(Duration::from_mins(5)),
            Error::Processor("avx2".into()),
            Error::Failed("whisper_full_with_state returned 7".into()),
        ];
        let known = [
            "no-microphone",
            "permission-denied",
            "model-download-failed",
            "busy",
            "too-long",
            "failed",
        ];
        for e in &all {
            assert!(known.contains(&e.reason().as_str()), "{e:?}");
            let s = e.sentence();
            // what a library, a server or a system call said never reaches a person
            for raw in [
                "ALSA",
                "0x8007",
                "https://",
                "sha256",
                "whisper_full",
                "connection reset",
            ] {
                assert!(!s.contains(raw), "{s:?} quotes {raw:?}");
            }
            assert!(s.ends_with('.'), "{s:?}");
        }
        assert_eq!(
            Error::TooLong(Duration::from_mins(5)).sentence(),
            "Dictation stops after 5 minutes. Press the mic to go on."
        );
        assert!(!Error::Processor(String::new()).retry());
        assert!(Error::Busy.retry());
    }
}
