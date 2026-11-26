//! One running dictation: it reads the source, resamples to the model's rate, feeds the [`Segmenter`], hands its requests
//! to the [`Worker`] (a thread that owns the speech model) and its events to the caller. It runs on a thread of its own
//! and returns when the dictation is over; the source is dropped (the microphone closed) as soon as listening ends.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use crate::audio::{AudioSource, MODEL_RATE, Read, Resampler};
use crate::segment::{Job, Segmenter, Step};
use crate::transcribe::{Moot, Recognizer, Transcriber};
use crate::{Error, Event, Result, Sink, Tuning};

/// The speech model kept in memory between dictations, and dropped when none has used it for a while
/// ([`Tuning::model_idle`]): loaded it holds about 150 MB.
#[derive(Default)]
pub struct Warm {
    /// A count that changes with every take and put, and the model while no dictation holds it.
    slot: Mutex<(u64, Option<Box<dyn Transcriber>>)>,
}

impl Warm {
    /// The model, if it is in memory and free.
    fn take(&self) -> Option<Box<dyn Transcriber>> {
        let mut slot = self.slot.lock().ok()?;
        slot.0 += 1;
        slot.1.take()
    }

    /// Give the model back, to be dropped after `idle` unless a dictation takes it first.
    fn put(self: &Arc<Self>, transcriber: Box<dyn Transcriber>, idle: Duration) {
        let Ok(mut slot) = self.slot.lock() else {
            return;
        };
        slot.0 += 1;
        slot.1 = Some(transcriber);
        let stamp = slot.0;
        drop(slot);
        let warm = self.clone();
        let spawned = std::thread::Builder::new()
            .name("boopis-speech-idle".into())
            .spawn(move || {
                std::thread::sleep(idle);
                if let Ok(mut slot) = warm.slot.lock()
                    && slot.0 == stamp
                    && slot.1.take().is_some()
                {
                    tracing::info!(
                        "the speech model left memory after a while without a dictation"
                    );
                }
            });
        if spawned.is_err()
            && let Ok(mut slot) = self.slot.lock()
        {
            // nobody would drop it later: drop it now
            slot.1 = None;
        }
    }

    /// Whether the model is in memory and free.
    #[must_use]
    pub fn loaded(&self) -> bool {
        self.slot.lock().is_ok_and(|s| s.1.is_some())
    }
}

/// An answer of the worker: the request's id and its words. Id 0 is the model itself failing to load.
type Answer = (u64, Result<String>);

/// The thread that owns the speech model for one dictation: it loads it at once (the person is already speaking),
/// answers requests in order, and gives the model back to [`Warm`] at the end.
pub struct Worker {
    jobs: Sender<Job>,
    answers: Receiver<Answer>,
    moot: Moot,
}

impl Worker {
    /// Start the thread.
    ///
    /// # Errors
    /// [`Error::Failed`] when the system starts no thread.
    pub fn start(recognizer: Arc<dyn Recognizer>, warm: Arc<Warm>, idle: Duration) -> Result<Self> {
        let (jobs, todo) = mpsc::channel::<Job>();
        let (done, answers) = mpsc::channel::<Answer>();
        let moot = Moot::default();
        let watching = moot.clone();
        std::thread::Builder::new()
            .name("boopis-speech".into())
            .spawn(move || {
                let mut transcriber = warm.take();
                if let Some(t) = transcriber.as_mut() {
                    t.begin();
                }
                let mut broken = None;
                if transcriber.is_none() {
                    match recognizer.load() {
                        Ok(t) => transcriber = Some(t),
                        Err(e) => {
                            tracing::warn!(error = %e, "the speech model did not load");
                            let _ = done.send((0, Err(e.clone())));
                            broken = Some(e);
                        }
                    }
                }
                while let Ok(job) = todo.recv() {
                    let started = Instant::now();
                    let answer = match (&mut transcriber, &broken) {
                        _ if watching.is(&job) => {
                            Err(Error::Failed("a partial was given up".to_owned()))
                        }
                        (Some(t), _) => t.transcribe(&job, &watching),
                        (None, Some(e)) => Err(e.clone()),
                        (None, None) => Err(Error::Failed("no speech model".to_owned())),
                    };
                    #[allow(clippy::cast_precision_loss)]
                    let audio_s = job.audio.len() as f64 / f64::from(MODEL_RATE);
                    tracing::debug!(
                        id = job.id,
                        last = job.last,
                        audio_s,
                        took_ms = started.elapsed().as_millis(),
                        ok = answer.is_ok(),
                        "a stretch was written down"
                    );
                    if done.send((job.id, answer)).is_err() {
                        break;
                    }
                }
                if let Some(t) = transcriber {
                    warm.put(t, idle);
                }
            })
            .map_err(|e| Error::Failed(format!("starting the speech thread: {e}")))?;
        Ok(Self {
            jobs,
            answers,
            moot,
        })
    }
}

/// Run one dictation to its end. `stop` ends it from outside (the person, the window going away); the last event the
/// sink gets is [`Event::Ended`].
pub fn run(
    source: Box<dyn AudioSource>,
    worker: &Worker,
    tuning: &Tuning,
    stop: &AtomicBool,
    sink: &Sink,
) {
    let mut run = Run {
        segmenter: Segmenter::new(tuning.clone()),
        resampler: Resampler::new(source.rate(), MODEL_RATE),
        source: Some(source),
        worker,
        stop,
        sink,
        block: Vec::new(),
    };
    // audio time is the dictation's clock; the wall clock only catches a device that opened and then gives nothing
    let deadline = Instant::now() + tuning.cap + tuning.silence_probe.max(Duration::from_secs(5));
    while !run.segmenter.over() {
        loop {
            match worker.answers.try_recv() {
                Ok(answer) => run.answered(answer),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return run.worker_gone(),
            }
        }
        if run.segmenter.over() {
            break;
        }
        if stop.load(Ordering::Relaxed) {
            let steps = run.segmenter.stop();
            run.apply(steps);
        } else if Instant::now() >= deadline {
            let steps = run.segmenter.fail(Error::TooLong(tuning.cap));
            run.apply(steps);
        }
        if run.source.is_some() {
            run.listen(tuning.tick);
        } else if !run.segmenter.over() {
            // finishing: only the last answers are awaited
            match worker.answers.recv_timeout(tuning.tick) {
                Ok(answer) => run.answered(answer),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return run.worker_gone(),
            }
        }
    }
}

struct Run<'a> {
    segmenter: Segmenter,
    resampler: Resampler,
    /// The open source; `None` once listening is over, which closes the microphone.
    source: Option<Box<dyn AudioSource>>,
    worker: &'a Worker,
    stop: &'a AtomicBool,
    sink: &'a Sink,
    block: Vec<f32>,
}

impl Run<'_> {
    /// One read of the source.
    fn listen(&mut self, wait: Duration) {
        let Some(source) = self.source.as_mut() else {
            return;
        };
        let steps = match source.read(wait) {
            Read::Samples(samples) => {
                self.block.clear();
                self.resampler.push(&samples, &mut self.block);
                self.segmenter.feed(&self.block)
            }
            Read::Idle => Vec::new(),
            Read::End => {
                self.block.clear();
                self.resampler.finish(&mut self.block);
                let mut steps = self.segmenter.feed(&self.block);
                steps.extend(self.segmenter.stop());
                steps
            }
            Read::Failed(e) => {
                tracing::warn!(error = %e, "the microphone stopped");
                self.segmenter.fail(e)
            }
        };
        self.apply(steps);
    }

    fn answered(&mut self, (id, answer): Answer) {
        let steps = match (id, answer) {
            // the model itself: nothing can be written down, so the dictation ends with that reason
            (0, Err(e)) => self.segmenter.fail(e),
            (0, Ok(_)) => Vec::new(),
            (id, answer) => self.segmenter.transcribed(id, answer),
        };
        self.apply(steps);
    }

    fn apply(&mut self, steps: Vec<Step>) {
        for step in steps {
            match step {
                Step::Emit(event) => {
                    if let Event::Error { reason, .. } = &event {
                        tracing::info!(
                            reason = reason.as_str(),
                            heard_s = self.segmenter.heard().as_secs_f32(),
                            "the dictation stopped by itself"
                        );
                    }
                    if !(self.sink)(event) {
                        // nobody reads the events any more: the dictation has no one to listen for
                        self.stop.store(true, Ordering::Relaxed);
                    }
                }
                Step::Transcribe(job) => {
                    if job.last {
                        // words for good wait behind any partial still being worked on: give that one up
                        self.worker.moot.upto(job.id);
                    }
                    let _ = self.worker.jobs.send(job);
                }
                Step::CloseSource => self.source = None,
                Step::Done => {}
            }
        }
    }

    /// The speech thread ended with answers still owed (it panicked): say so and end, instead of waiting for ever.
    fn worker_gone(&mut self) {
        self.source = None;
        tracing::error!("the speech thread ended before the dictation did");
        (self.sink)(Error::Failed("the speech thread ended".to_owned()).event());
        (self.sink)(Event::Ended);
    }
}
