//! The one door to dictation: [`Dictation::start`] begins one, [`Dictation::stop`] ends it. There is at most one at a
//! time, nothing here starts by itself, and whoever holds no [`Dictation`] cannot reach the microphone.
//!
//! A dictation, on its own thread:
//! 1. makes sure the speech model is on disk, fetching it once ([`crate::fetch`]) while it reports `Preparing`. The fetch
//!    belongs to the service, not the dictation: stopping the dictation lets it finish, so the next press finds the model;
//! 2. opens the microphone, and only then says `Listening` (the model is read into memory meanwhile, on the speech
//!    thread, so the first words are not lost to the load);
//! 3. runs the [`crate::session`] until it is stopped, capped or fails.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::capture::Microphone;
use crate::fetch::{self, Transport};
use crate::model::ModelSpec;
use crate::session::{self, Warm, Worker};
use crate::transcribe::Recognizer;
use crate::{Error, Event, Result, Sink, Tuning};

/// What a [`Dictation`] is made of.
pub struct Parts {
    /// The speech model in use.
    pub spec: &'static ModelSpec,
    /// The app's speech folder, where the model lives.
    pub dir: PathBuf,
    /// The numbers.
    pub tuning: Tuning,
    /// The fetch's numbers.
    pub policy: fetch::Policy,
    /// The microphone.
    pub microphone: Arc<dyn Microphone>,
    /// Who loads the model.
    pub recognizer: Arc<dyn Recognizer>,
    /// How the model is fetched.
    pub transport: Arc<dyn Transport>,
}

/// The dictation service.
#[derive(Clone)]
pub struct Dictation {
    inner: Arc<Inner>,
}

struct Inner {
    parts: Parts,
    /// The dictation that runs, if one does.
    active: Mutex<Option<Active>>,
    next_id: AtomicU32,
    warm: Arc<Warm>,
    /// The model fetch in progress, shared by every dictation that waits for it.
    fetching: Mutex<Option<Arc<Fetching>>>,
}

struct Active {
    id: u32,
    stop: Arc<AtomicBool>,
    over: Arc<AtomicBool>,
}

/// A model fetch: how far it is and how it ended.
struct Fetching {
    done: AtomicU64,
    result: Mutex<Option<Result<()>>>,
}

impl Dictation {
    /// A service over `parts`. Nothing is opened, read or fetched until a dictation starts.
    #[must_use]
    pub fn new(parts: Parts) -> Self {
        Self {
            inner: Arc::new(Inner {
                parts,
                active: Mutex::new(None),
                next_id: AtomicU32::new(1),
                warm: Arc::new(Warm::default()),
                fetching: Mutex::new(None),
            }),
        }
    }

    /// Start a dictation whose events go to `sink`, and answer its id. While another one listens the new one gets `busy`
    /// and ends at once, and the one that listens is not disturbed. One that was stopped and still writes down its last
    /// words is no obstacle: the new one opens the microphone at once and its words follow the other's (the model is
    /// handed over, [`crate::session::Warm`]).
    pub fn start(&self, sink: &Sink) -> u32 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let refuse = |e: Error| {
            sink(e.event());
            sink(Event::Ended);
            id
        };
        let Ok(mut active) = self.inner.active.lock() else {
            return refuse(Error::Failed("the dictation state is poisoned".to_owned()));
        };
        if active
            .as_ref()
            .is_some_and(|a| !a.over.load(Ordering::Relaxed) && !a.stop.load(Ordering::Relaxed))
        {
            drop(active);
            return refuse(Error::Busy);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let over = Arc::new(AtomicBool::new(false));
        // `over` is set before `Ended` is handed on, so a press that answers the end is never told `busy`
        let (ended, to) = (over.clone(), sink.clone());
        let thread_sink: Sink = Arc::new(move |event| {
            if event == Event::Ended {
                ended.store(true, Ordering::Relaxed);
            }
            to(event)
        });
        let (inner, thread_stop, thread_over) = (self.inner.clone(), stop.clone(), over.clone());
        let spawned = std::thread::Builder::new()
            .name("boopis-dictation".into())
            .spawn(move || {
                inner.dictate(&thread_stop, &thread_sink);
                thread_over.store(true, Ordering::Relaxed);
            });
        match spawned {
            Ok(_) => {
                *active = Some(Active { id, stop, over });
                id
            }
            Err(e) => {
                drop(active);
                refuse(Error::Failed(format!("starting the dictation thread: {e}")))
            }
        }
    }

    /// Stop the dictation `id`: the microphone closes, what was said is written down, then it ends. An id that is not
    /// the running one does nothing.
    pub fn stop(&self, id: u32) {
        if let Ok(active) = self.inner.active.lock()
            && let Some(a) = active.as_ref()
            && a.id == id
        {
            a.stop.store(true, Ordering::Relaxed);
        }
    }

    /// Stop whatever runs (the window that asked is gone).
    pub fn stop_all(&self) {
        if let Ok(active) = self.inner.active.lock()
            && let Some(a) = active.as_ref()
        {
            a.stop.store(true, Ordering::Relaxed);
        }
    }

    /// Whether the latest dictation runs or is still writing down its last words.
    #[must_use]
    pub fn active(&self) -> bool {
        self.inner
            .active
            .lock()
            .is_ok_and(|a| a.as_ref().is_some_and(|a| !a.over.load(Ordering::Relaxed)))
    }

    /// Whether the speech model is in memory and free (between dictations, before it idles out).
    #[must_use]
    pub fn model_loaded(&self) -> bool {
        self.inner.warm.loaded()
    }

    /// The speech model as Settings shows it: which one, its size, and whether it is on disk, being fetched (how far), or
    /// not there (with why the last fetch failed, when one did). Reads the folder; opens and fetches nothing.
    #[must_use]
    pub fn model(&self) -> ModelInfo {
        let spec = self.inner.parts.spec;
        let running = self
            .inner
            .fetching
            .lock()
            .ok()
            .and_then(|slot| slot.clone());
        let (fetching, failed) = match running {
            Some(f) => match f.result.lock().ok().and_then(|r| r.clone()) {
                None => (Some(f.done.load(Ordering::Relaxed)), None),
                Some(Err(e)) => (None, Some(e.sentence())),
                Some(Ok(())) => (None, None),
            },
            None => (None, None),
        };
        let state = if spec.present(&self.inner.parts.dir) {
            ModelState::Ready
        } else if let Some(done) = fetching {
            ModelState::Fetching { done }
        } else {
            ModelState::Absent
        };
        ModelInfo {
            id: spec.id,
            size: spec.size,
            state,
            failed: if state == ModelState::Absent {
                failed
            } else {
                None
            },
        }
    }

    /// Fetch the speech model now (Settings' Download), as a first press of the mic would: the fetch runs on its own
    /// thread and [`Dictation::model`] says how far it is. Does nothing when the model is on disk or a fetch runs.
    ///
    /// # Errors
    /// [`Error::Failed`] when the fetch thread cannot start.
    pub fn fetch_model(&self) -> Result<()> {
        if self.inner.parts.spec.present(&self.inner.parts.dir) {
            return Ok(());
        }
        self.inner.fetching().map(|_| ())
    }

    /// Delete the speech model from disk (Settings' Delete), with a fetch's partial file. The next press of the mic
    /// fetches it again.
    ///
    /// # Errors
    /// [`Error::Busy`] while a dictation runs or the model is being fetched; [`Error::Failed`] when the file cannot be
    /// removed.
    pub fn delete_model(&self) -> Result<()> {
        if self.active() || matches!(self.model().state, ModelState::Fetching { .. }) {
            return Err(Error::Busy);
        }
        let parts = &self.inner.parts;
        for path in [
            parts.spec.path(&parts.dir),
            parts.spec.part_path(&parts.dir),
        ] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(Error::Failed(format!("removing the speech model: {e}"))),
            }
        }
        tracing::info!(model = parts.spec.id, "the speech model was deleted");
        Ok(())
    }
}

/// Where the speech model is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelState {
    /// Not on this computer: the first press of the mic (or Download) fetches it.
    Absent,
    /// Being fetched: `done` bytes on disk so far.
    Fetching {
        /// Bytes fetched so far.
        done: u64,
    },
    /// On disk, of the expected size (its content is checked when it is read).
    Ready,
}

/// The speech model as Settings shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelInfo {
    /// The model's name (`base-q5_1`).
    pub id: &'static str,
    /// Its size in bytes.
    pub size: u64,
    /// Where it is.
    pub state: ModelState,
    /// When it is absent because the last fetch failed: what a person reads about it.
    pub failed: Option<String>,
}

impl Inner {
    /// One dictation, start to end. The last thing the sink gets is `Ended`.
    fn dictate(self: &Arc<Self>, stop: &Arc<AtomicBool>, sink: &Sink) {
        let end = |error: Option<Error>| {
            if let Some(e) = error {
                tracing::warn!(error = %e, reason = e.reason().as_str(), "the dictation did not start");
                sink(e.event());
            }
            sink(Event::Ended);
        };
        let parts = &self.parts;
        if !parts.spec.present(&parts.dir)
            && let Err(e) = self.prepare(stop, sink)
        {
            return end(Some(e));
        }
        // stopped while the model was fetched: the microphone is never opened
        if stop.load(Ordering::Relaxed) {
            return end(None);
        }
        let source = match parts.microphone.open() {
            Ok(source) => source,
            Err(e) => return end(Some(e)),
        };
        let worker = match Worker::start(
            parts.recognizer.clone(),
            self.warm.clone(),
            parts.tuning.model_idle,
        ) {
            Ok(worker) => worker,
            Err(e) => return end(Some(e)),
        };
        if !sink(Event::Listening) {
            stop.store(true, Ordering::Relaxed);
        }
        session::run(source, &worker, &parts.tuning, stop, sink);
    }

    /// Wait for the model to be on disk, starting its fetch if none runs, and report how far it is. Returns early,
    /// without an error, when the dictation is stopped; the fetch goes on.
    fn prepare(self: &Arc<Self>, stop: &AtomicBool, sink: &Sink) -> Result<()> {
        let fetching = self.fetching()?;
        let total = self.parts.spec.size;
        let mut told = None;
        loop {
            let done = fetching.done.load(Ordering::Relaxed);
            if told != Some(done) {
                told = Some(done);
                if !sink(Event::Preparing { done, total }) {
                    stop.store(true, Ordering::Relaxed);
                    return Ok(());
                }
            }
            if let Ok(result) = fetching.result.lock()
                && let Some(result) = result.as_ref()
            {
                return result.clone();
            }
            if stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            std::thread::sleep(self.parts.tuning.tick);
        }
    }

    /// The fetch in progress, or a new one.
    fn fetching(self: &Arc<Self>) -> Result<Arc<Fetching>> {
        let mut slot = self
            .fetching
            .lock()
            .map_err(|_| Error::Failed("the fetch state is poisoned".to_owned()))?;
        if let Some(running) = slot.as_ref()
            && running.result.lock().is_ok_and(|r| r.is_none())
        {
            return Ok(running.clone());
        }
        let fetching = Arc::new(Fetching {
            done: AtomicU64::new(0),
            result: Mutex::new(None),
        });
        let (inner, shared) = (self.clone(), fetching.clone());
        std::thread::Builder::new()
            .name("boopis-speech-fetch".into())
            .spawn(move || {
                let parts = &inner.parts;
                tracing::info!(model = parts.spec.id, bytes = parts.spec.size, "fetching the speech model");
                let result = fetch::fetch(
                    parts.spec,
                    &parts.dir,
                    parts.transport.as_ref(),
                    &parts.policy,
                    &|done, _| shared.done.store(done, Ordering::Relaxed),
                );
                match &result {
                    Ok(()) => tracing::info!(model = parts.spec.id, "the speech model is in place"),
                    Err(e) => tracing::warn!(model = parts.spec.id, error = %e, "the speech model was not fetched"),
                }
                if let Ok(mut slot) = shared.result.lock() {
                    *slot = Some(result);
                }
            })
            .map_err(|e| Error::Failed(format!("starting the fetch thread: {e}")))?;
        *slot = Some(fetching.clone());
        Ok(fetching)
    }
}

#[cfg(test)]
mod tests;
