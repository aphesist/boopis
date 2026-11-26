//! Speech to text: the trait a dictation asks ([`Transcriber`]), who makes one ([`Recognizer`]), and the real one,
//! whisper.cpp on this computer's processor ([`Whisper`]).
//!
//! Loading is the only place a model file is opened: its bytes are read, hashed and checked against the pinned hash
//! ([`crate::model::read_verified`]) and whisper.cpp is then given those bytes, not the path.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use crate::audio::MODEL_RATE;
use crate::model::{self, ModelSpec};
use crate::segment::Job;
use crate::{Error, Result};

/// Which partial requests are no longer wanted: every one up to an id, once words for good are waiting behind it. Shared
/// between the dictation, which raises it, and the speech thread, which skips such a request instead of starting it.
#[derive(Debug, Clone, Default)]
pub struct Moot(Arc<AtomicU64>);

impl Moot {
    /// Partials up to request `id` are moot.
    pub fn upto(&self, id: u64) {
        self.0.fetch_max(id, Ordering::Relaxed);
    }

    /// Whether `job` may be given up: it is a partial and a later request made it moot.
    #[must_use]
    pub fn is(&self, job: &Job) -> bool {
        !job.last && job.id <= self.0.load(Ordering::Relaxed)
    }
}

/// Turns stretches of speech into words. Used by one thread at a time.
pub trait Transcriber: Send {
    /// The words of `job`'s audio (empty when there are none). The words of a partial that became `moot` meanwhile are
    /// not wanted and may be answered with an error.
    ///
    /// # Errors
    /// [`Error::Failed`] when the model could not do it, or the job was given up.
    fn transcribe(&mut self, job: &Job, moot: &Moot) -> Result<String>;

    /// A new dictation begins: forget what was learned about the last one (which language it was in).
    fn begin(&mut self) {}
}

/// Makes a [`Transcriber`]: the step that reads the model into memory, off any UI thread, only when a dictation needs it.
pub trait Recognizer: Send + Sync + 'static {
    /// Load the model.
    ///
    /// # Errors
    /// [`Error::ModelMismatch`] when the file on disk is not the model (it was deleted), [`Error::Processor`] when this
    /// computer cannot run it, [`Error::Failed`] otherwise.
    fn load(&self) -> Result<Box<dyn Transcriber>>;
}

/// How whisper.cpp is asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperOptions {
    /// Threads of one transcription.
    pub threads: usize,
    /// The spoken language as whisper names it (`en`, `pt`), or `None` to let the model hear which it is, per stretch.
    pub language: Option<String>,
    /// Whether a stretch under about 13 s is read through half of the model's 30 s window, which halves the work.
    /// (A window cut closer to the audio than that makes the small models repeat themselves.)
    pub short_window: bool,
}

impl Default for WhisperOptions {
    fn default() -> Self {
        Self {
            // whisper.cpp's own default: more threads than four bring little on the small models
            threads: std::thread::available_parallelism().map_or(1, |n| n.get().min(4)),
            language: None,
            short_window: true,
        }
    }
}

/// whisper.cpp with one of the models of [`crate::model`], read from the app's speech folder.
#[derive(Debug, Clone)]
pub struct Whisper {
    spec: &'static ModelSpec,
    dir: PathBuf,
    options: WhisperOptions,
}

impl Whisper {
    /// whisper.cpp over `spec`, whose file is in `dir`.
    #[must_use]
    pub fn new(spec: &'static ModelSpec, dir: PathBuf, options: WhisperOptions) -> Self {
        Self { spec, dir, options }
    }
}

/// Whether this processor has the instructions whisper.cpp was compiled for (`.cargo/config.toml`). Without them the
/// first transcription would end the whole app with an illegal instruction, so the model is not even loaded.
///
/// # Errors
/// [`Error::Processor`], naming what is missing.
pub fn check_processor() -> Result<()> {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        let missing: Vec<&str> = [
            ("sse4.2", std::is_x86_feature_detected!("sse4.2")),
            ("avx", std::is_x86_feature_detected!("avx")),
            ("avx2", std::is_x86_feature_detected!("avx2")),
            ("fma", std::is_x86_feature_detected!("fma")),
            ("f16c", std::is_x86_feature_detected!("f16c")),
            ("bmi2", std::is_x86_feature_detected!("bmi2")),
        ]
        .into_iter()
        .filter_map(|(name, has)| (!has).then_some(name))
        .collect();
        if !missing.is_empty() {
            return Err(Error::Processor(format!("no {}", missing.join(", "))));
        }
    }
    Ok(())
}

impl Recognizer for Whisper {
    fn load(&self) -> Result<Box<dyn Transcriber>> {
        check_processor()?;
        // whisper.cpp's own lines go to `tracing` (target `whisper_rs`), never straight to stderr
        whisper_rs::install_logging_hooks();
        let started = std::time::Instant::now();
        let bytes = model::read_verified(self.spec, &self.dir)?;
        let verified = started.elapsed();
        let mut params = WhisperContextParameters::default();
        params.use_gpu(false);
        let context = WhisperContext::new_from_buffer_with_params(&bytes, params)
            .map_err(|e| Error::Failed(format!("loading {}: {e}", self.spec.file)))?;
        drop(bytes);
        let state = context
            .create_state()
            .map_err(|e| Error::Failed(format!("preparing {}: {e}", self.spec.file)))?;
        tracing::info!(
            model = self.spec.id,
            verify_ms = verified.as_millis(),
            load_ms = started.elapsed().as_millis(),
            threads = self.options.threads,
            "the speech model is loaded"
        );
        Ok(Box::new(Loaded {
            state,
            options: self.options.clone(),
            heard: None,
        }))
    }
}

/// A model in memory. The state keeps its context alive.
struct Loaded {
    state: WhisperState,
    options: WhisperOptions,
    /// The language the model last heard in this dictation, when it was asked to hear it.
    heard: Option<Heard>,
}

/// One hearing of the language.
struct Heard {
    language: &'static str,
    stretch: u64,
    /// How much audio it was heard on.
    samples: usize,
}

/// Audio enough to be sure of the language: a stretch's language is heard once on at least this much of it (or on its
/// last request, whatever its length), and its other requests take that.
const SURE: usize = MODEL_RATE as usize * 4;
/// Half the model's window, in encoder frames of 20 ms (15.36 s), and how much audio fits it with a margin.
const SHORT_WINDOW: usize = 768;
const SHORT_FITS: usize = MODEL_RATE as usize * 13;

impl Loaded {
    /// The language to ask for: the caller's, else what this stretch was surely heard in, else (for a partial that is
    /// too short to tell) what the dictation was last heard in, else `auto`, which makes the model listen for it at the
    /// cost of reading the audio twice.
    fn language_for(&self, job: &Job) -> &str {
        if let Some(fixed) = self.options.language.as_deref() {
            return fixed;
        }
        match &self.heard {
            Some(h) if h.stretch == job.stretch && h.samples >= SURE => h.language,
            Some(h) if !job.last && job.audio.len() < SURE => h.language,
            _ => "auto",
        }
    }
}

/// The model is given at least this much audio; shorter stretches are padded with silence.
const SHORTEST: usize = MODEL_RATE as usize + MODEL_RATE as usize / 10;

impl Transcriber for Loaded {
    fn transcribe(&mut self, job: &Job, moot: &Moot) -> Result<String> {
        let mut padded;
        let audio: &[f32] = if job.audio.len() < SHORTEST {
            padded = job.audio.clone();
            padded.resize(SHORTEST, 0.0);
            &padded
        } else {
            &job.audio
        };
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
        // a handful of threads
        params.set_n_threads(self.options.threads.max(1) as i32);
        let language = self.language_for(job).to_owned();
        params.set_language(Some(&language));
        params.set_translate(false);
        // each stretch stands alone: the words before it come as the prompt, not as the model's own memory
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if !job.prompt.is_empty() {
            params.set_initial_prompt(&job.prompt);
        }
        if !job.last {
            // a partial is replaced in a moment: no second try at a higher temperature
            params.set_temperature_inc(0.0);
        }
        if self.options.short_window && audio.len() <= SHORT_FITS {
            #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)] // 768
            params.set_audio_ctx(SHORT_WINDOW as i32);
        }
        // No abort callback: whisper-rs 0.16.0's safe wrapper for it hands whisper.cpp a pointer to one type and reads it
        // back as another, so the callback answers from memory that is not its own (a final was aborted that way once
        // in CI). A partial that became moot is skipped before it starts (`session::Worker`) and dropped when it ends.
        if let Err(e) = self.state.full(params, audio) {
            return Err(Error::Failed(if moot.is(job) {
                "a partial was given up for the words that follow it".to_owned()
            } else {
                format!("the speech model failed: {e}")
            }));
        }
        if moot.is(job) {
            return Err(Error::Failed(
                "a partial was given up for the words that follow it".to_owned(),
            ));
        }
        if language == "auto"
            && let Some(heard) = whisper_rs::get_lang_str(self.state.full_lang_id_from_state())
        {
            self.heard = Some(Heard {
                language: heard,
                stretch: job.stretch,
                samples: job.audio.len(),
            });
        }
        let mut text = String::new();
        for segment in self.state.as_iter() {
            if let Ok(words) = segment.to_str_lossy() {
                text.push_str(&words);
            }
        }
        Ok(tidy(&text))
    }

    fn begin(&mut self) {
        self.heard = None;
    }
}

/// What whisper wrote, as a person would have typed it: one line, single spaces, and none of the notes it writes for
/// sounds that are not words (`[BLANK_AUDIO]`, `(music)`, `*sighs*`).
#[must_use]
pub fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0_u32;
    for c in text.chars() {
        match c {
            '[' => depth += 1,
            ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => {}
            _ => out.push(c),
        }
    }
    let line = out.split_whitespace().collect::<Vec<_>>().join(" ");
    // a whole line in one pair of parentheses or asterisks is a note; a person's own parentheses sit inside a sentence
    let one_pair = |open: char, close: char, opens: usize| {
        line.len() > 1
            && line.starts_with(open)
            && line.ends_with(close)
            && line.matches(open).count() == opens
    };
    if one_pair('(', ')', 1) || one_pair('*', '*', 2) {
        return String::new();
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: u64, last: bool) -> Job {
        Job {
            id,
            audio: Vec::new(),
            prompt: String::new(),
            last,
            stretch: 0,
        }
    }

    #[test]
    fn only_partials_up_to_the_mark_are_moot() {
        let moot = Moot::default();
        assert!(!moot.is(&job(1, false)));
        moot.upto(3);
        assert!(moot.is(&job(1, false)) && moot.is(&job(3, false)));
        assert!(!moot.is(&job(4, false)), "a later partial is not");
        assert!(!moot.is(&job(2, true)), "words for good are never given up");
        moot.upto(2);
        assert!(moot.is(&job(3, false)), "the mark never goes back");
    }

    #[test]
    fn what_the_model_writes_is_tidied() {
        assert_eq!(
            tidy(" And so, my fellow Americans,\n ask not. "),
            "And so, my fellow Americans, ask not."
        );
        assert_eq!(tidy(" [BLANK_AUDIO]"), "");
        assert_eq!(tidy("[ Silence ]  "), "");
        assert_eq!(tidy("(music)"), "");
        assert_eq!(tidy("*sighs*"), "");
        assert_eq!(tidy("Olá [risos] mundo"), "Olá mundo");
        assert_eq!(
            tidy("the call (the second one) failed"),
            "the call (the second one) failed",
            "a person's own parentheses stay"
        );
        assert_eq!(tidy("(one) and (two)"), "(one) and (two)");
        assert_eq!(tidy(""), "");
    }

    #[test]
    fn this_machine_can_or_cannot_run_the_model_and_says_which() {
        match check_processor() {
            Ok(()) => {}
            Err(e) => {
                assert_eq!(e.reason().as_str(), "failed");
                assert!(!e.retry());
            }
        }
    }

    #[test]
    fn a_missing_model_is_an_error_not_a_crash() {
        if check_processor().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let whisper = Whisper::new(
            model::DEFAULT,
            dir.path().to_owned(),
            WhisperOptions::default(),
        );
        assert!(matches!(whisper.load(), Err(Error::Failed(_))));
        // a file of the right name that is not the model is refused before whisper.cpp sees it, and deleted
        std::fs::write(model::DEFAULT.path(dir.path()), b"GGML but not really").unwrap();
        assert!(matches!(whisper.load(), Err(Error::ModelMismatch(_))));
        assert!(!model::DEFAULT.path(dir.path()).exists());
    }
}
