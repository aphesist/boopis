//! The microphone: the system's default input device, through its own audio API (ALSA on Linux, where `PipeWire` and
//! `PulseAudio` answer as the default device; WASAPI on Windows; Core Audio on macOS).
//!
//! It is open only while a dictation holds the [`AudioSource`] that [`Microphone::open`] returned: dropping that closes the
//! device. What it hears goes to the dictation as blocks of samples in memory and nowhere else.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, SyncSender, TrySendError};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, Sample, SampleFormat, SizedSample};

use crate::audio::{AudioSource, Read, downmix};
use crate::{Error, Result};

/// Something that can be opened to listen. The real one is [`SystemMicrophone`]; the tests open a file.
pub trait Microphone: Send + Sync + 'static {
    /// Open it. The device is in use until the returned source is dropped.
    ///
    /// # Errors
    /// [`Error::NoMicrophone`] when there is none, [`Error::PermissionDenied`] when the system refuses it,
    /// [`Error::Failed`] otherwise.
    fn open(&self) -> Result<Box<dyn AudioSource>>;
}

/// The system's default input device.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemMicrophone;

/// Blocks the device may deliver before the dictation takes them (a block is about 10 ms): a dictation that stalls
/// longer than this loses audio instead of growing without bound.
const QUEUE: usize = 1024;
/// How long opening the device may take.
const OPEN_WAIT: Duration = Duration::from_secs(10);

/// What the device's thread sends.
enum Message {
    Samples(Vec<f32>),
    Failed(Error),
}

impl Microphone for SystemMicrophone {
    fn open(&self) -> Result<Box<dyn AudioSource>> {
        // The stream is not `Send` on every system, so it lives and dies on a thread of its own, which waits until the
        // source is dropped.
        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32>>();
        let (audio_tx, audio_rx) = mpsc::sync_channel::<Message>(QUEUE);
        let (close_tx, close_rx) = mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("boopis-microphone".into())
            .spawn(move || hold(&ready_tx, audio_tx, &close_rx))
            .map_err(|e| Error::Failed(format!("starting the microphone thread: {e}")))?;
        match ready_rx.recv_timeout(OPEN_WAIT) {
            Ok(Ok(rate)) => Ok(Box::new(Open {
                rate,
                audio: audio_rx,
                failed: None,
                _close: close_tx,
            })),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(Error::Failed(
                "the microphone did not open in time".to_owned(),
            )),
        }
    }
}

/// The device thread: open the stream, say how it went, keep it until the source is dropped.
fn hold(ready: &Sender<Result<u32>>, audio: SyncSender<Message>, close: &Receiver<()>) {
    match start(audio) {
        Ok((stream, rate)) => {
            if ready.send(Ok(rate)).is_ok() {
                // nothing is ever sent: this returns when the source, which holds the sender, is dropped
                let _ = close.recv();
            }
            drop(stream);
            tracing::debug!("the microphone is closed");
        }
        Err(e) => {
            let _ = ready.send(Err(e));
        }
    }
}

/// Open the default input device with its own default format and start it.
fn start(audio: SyncSender<Message>) -> Result<(cpal::Stream, u32)> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| Error::NoMicrophone("the system has no default input device".to_owned()))?;
    let supported = device.default_input_config().map_err(|e| classify(&e))?;
    let format = supported.sample_format();
    let config = supported.config();
    let (rate, channels) = (config.sample_rate, usize::from(config.channels));
    let stream = match format {
        SampleFormat::F32 => listen::<f32>(&device, config, channels, audio),
        SampleFormat::I16 => listen::<i16>(&device, config, channels, audio),
        SampleFormat::U16 => listen::<u16>(&device, config, channels, audio),
        SampleFormat::I32 => listen::<i32>(&device, config, channels, audio),
        SampleFormat::I24 => listen::<cpal::I24>(&device, config, channels, audio),
        SampleFormat::I8 => listen::<i8>(&device, config, channels, audio),
        SampleFormat::U8 => listen::<u8>(&device, config, channels, audio),
        SampleFormat::U24 => listen::<cpal::U24>(&device, config, channels, audio),
        SampleFormat::U32 => listen::<u32>(&device, config, channels, audio),
        SampleFormat::I64 => listen::<i64>(&device, config, channels, audio),
        SampleFormat::U64 => listen::<u64>(&device, config, channels, audio),
        SampleFormat::F64 => listen::<f64>(&device, config, channels, audio),
        other => {
            return Err(Error::Failed(format!(
                "the microphone's sample format {other} is not one boopis reads"
            )));
        }
    }
    .map_err(|e| classify(&e))?;
    stream.play().map_err(|e| classify(&e))?;
    tracing::info!(rate, channels, %format, "the microphone is open");
    Ok((stream, rate))
}

/// An input stream of sample type `T`, mixed down to mono floats.
fn listen<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    audio: SyncSender<Message>,
) -> std::result::Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let errors = audio.clone();
    let lost = Arc::new(AtomicU64::new(0));
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let mut mono = Vec::new();
            downmix(data, channels, f32::from_sample, &mut mono);
            if let Err(TrySendError::Full(_)) = audio.try_send(Message::Samples(mono)) {
                // the dictation is not taking audio fast enough: say so once in a while, never block the device
                let n = lost.fetch_add(1, Ordering::Relaxed);
                if n.is_multiple_of(100) {
                    tracing::warn!(
                        blocks = n + 1,
                        "the dictation fell behind the microphone; audio was dropped"
                    );
                }
            }
        },
        move |e: cpal::Error| match e.kind() {
            // the stream goes on by itself after these
            ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied => {
                tracing::debug!(error = %e, "the microphone hiccuped");
            }
            _ => {
                let _ = errors.try_send(Message::Failed(classify(&e)));
            }
        },
        None,
    )
}

/// What the audio API said, as one of this crate's errors. The raw words stay in the error for the log.
fn classify(e: &cpal::Error) -> Error {
    let raw = e.to_string();
    match e.kind() {
        ErrorKind::PermissionDenied => Error::PermissionDenied(raw),
        ErrorKind::DeviceNotAvailable | ErrorKind::HostUnavailable => Error::NoMicrophone(raw),
        _ if refused_in_words(&raw) => Error::PermissionDenied(raw),
        _ => Error::Failed(format!("the microphone: {raw}")),
    }
}

/// Whether an error the audio API did not classify is a refusal: Windows answers `E_ACCESSDENIED` when the privacy
/// setting keeps desktop apps from the microphone.
fn refused_in_words(raw: &str) -> bool {
    let raw = raw.to_ascii_lowercase();
    raw.contains("0x80070005") || raw.contains("access is denied") || raw.contains("e_accessdenied")
}

/// An open microphone.
struct Open {
    rate: u32,
    audio: Receiver<Message>,
    /// A failure that arrived behind audio: the audio was handed over first, this is the next read.
    failed: Option<Error>,
    /// Dropped with the source, which lets the device thread close the stream.
    _close: Sender<()>,
}

impl AudioSource for Open {
    fn rate(&self) -> u32 {
        self.rate
    }

    fn read(&mut self, wait: Duration) -> Read {
        if let Some(e) = self.failed.take() {
            return Read::Failed(e);
        }
        let first = match self.audio.recv_timeout(wait) {
            Ok(Message::Samples(s)) => s,
            Ok(Message::Failed(e)) => return Read::Failed(e),
            Err(RecvTimeoutError::Timeout) => return Read::Idle,
            Err(RecvTimeoutError::Disconnected) => {
                return Read::Failed(Error::NoMicrophone(
                    "the microphone's stream ended".to_owned(),
                ));
            }
        };
        // take what else is already waiting, so a reader that was busy catches up in one read
        let mut samples = first;
        while let Ok(more) = self.audio.try_recv() {
            match more {
                Message::Samples(s) => samples.extend_from_slice(&s),
                Message::Failed(e) => {
                    // the audio heard before it is handed over first
                    self.failed = Some(e);
                    break;
                }
            }
        }
        Read::Samples(samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_is_recognised_in_the_words_windows_uses() {
        assert!(refused_in_words("WASAPI: Access is denied. (0x80070005)"));
        assert!(refused_in_words("HRESULT(0x80070005)"));
        assert!(!refused_in_words("The device is busy"));
        assert!(matches!(
            classify(&cpal::Error::from(ErrorKind::PermissionDenied)),
            Error::PermissionDenied(_)
        ));
        assert!(matches!(
            classify(&cpal::Error::from(ErrorKind::DeviceNotAvailable)),
            Error::NoMicrophone(_)
        ));
        assert!(matches!(
            classify(&cpal::Error::from(ErrorKind::HostUnavailable)),
            Error::NoMicrophone(_)
        ));
        assert!(matches!(
            classify(&cpal::Error::from(ErrorKind::UnsupportedConfig)),
            Error::Failed(_)
        ));
    }

    /// The real device, wherever this runs. A build machine has no microphone: the answer must then be one of the
    /// crate's errors, in time, never a panic or a hang. A machine with one gives audio, and closing it is clean.
    #[test]
    fn the_system_microphone_opens_or_says_why_not() {
        match SystemMicrophone.open() {
            Ok(mut source) => {
                assert!(source.rate() >= 8_000, "rate {}", source.rate());
                let mut heard = 0;
                for _ in 0..20 {
                    match source.read(Duration::from_millis(50)) {
                        Read::Samples(s) => heard += s.len(),
                        Read::Idle => {}
                        Read::End => panic!("a microphone does not end"),
                        Read::Failed(e) => {
                            println!("the microphone opened and then failed: {e}");
                            return;
                        }
                    }
                }
                println!(
                    "a microphone at {} Hz gave {heard} samples in a second",
                    source.rate()
                );
            }
            Err(e) => {
                println!("no usable microphone here ({}): {e}", e.reason().as_str());
                assert!(
                    matches!(
                        e,
                        Error::NoMicrophone(_) | Error::PermissionDenied(_) | Error::Failed(_)
                    ),
                    "{e:?}"
                );
            }
        }
    }
}
