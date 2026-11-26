//! Where a dictation's audio comes from, and the two things done to it before the speech model: resampling to the model's
//! 16 kHz, and measuring how loud a short frame is.

use std::time::Duration;

use rubato::{FftFixedIn, Resampler as _};

use crate::Error;

/// The rate the speech model reads, in Hz.
pub const MODEL_RATE: u32 = 16_000;
/// One frame of the level meter: 20 ms at [`MODEL_RATE`].
pub const FRAME: usize = 320;

/// One read of an [`AudioSource`].
#[derive(Debug, Clone, PartialEq)]
pub enum Read {
    /// The next samples, mono, in -1.0 to 1.0, at the source's rate.
    Samples(Vec<f32>),
    /// Nothing arrived within the wait; the source is still open.
    Idle,
    /// The source is over (a file ended). A microphone never says this.
    End,
    /// The source failed and gives nothing more.
    Failed(Error),
}

/// Mono audio, read in blocks: a microphone ([`crate::capture`]) or, in the tests, a file. Dropping it closes it.
pub trait AudioSource: Send {
    /// The sample rate of what [`AudioSource::read`] returns, in Hz.
    fn rate(&self) -> u32;
    /// The next block, waiting at most `wait` for one.
    fn read(&mut self, wait: Duration) -> Read;
}

/// The root mean square of `frame` (0.0 for an empty one).
#[must_use]
pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum: f64 = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    // a frame is a few hundred samples; the level is a small float
    let level = (sum / frame.len() as f64).sqrt() as f32;
    level
}

/// Average interleaved `channels` into mono, appended to `out`. A block that is not a whole number of frames loses its
/// last partial frame (a device never sends one).
pub fn downmix<T: Copy>(
    interleaved: &[T],
    channels: usize,
    to_f32: impl Fn(T) -> f32,
    out: &mut Vec<f32>,
) {
    let channels = channels.max(1);
    out.reserve(interleaved.len() / channels);
    #[allow(clippy::cast_precision_loss)] // a channel count
    let scale = 1.0 / channels as f32;
    for frame in interleaved.chunks_exact(channels) {
        out.push(frame.iter().map(|s| to_f32(*s)).sum::<f32>() * scale);
    }
}

/// Input frames handed to rubato per conversion step: small enough that the tail padded at the end is a few
/// milliseconds, large enough that the FFT is not all overhead.
const CHUNK: usize = 1024;

/// A streaming resampler from one rate to another, mono. The conversion is rubato's FFT resampler (band-limited, so a
/// 48 kHz microphone's content above 8 kHz does not fold into the speech band); this wrapper carries its state across
/// blocks of any size and gives back the tail at the end.
///
/// Feed blocks with [`Resampler::push`]; call [`Resampler::finish`] once for the tail.
///
/// Adapted from voxtype's `src/audio/resampler.rs` (`StreamResampler`), MIT License, Copyright (c) 2025 Peter Jackson
/// (`LICENSE-voxtype` beside this crate's manifest): the chunking, the count of frames in and out, and the flush that
/// pads the last chunk and returns exactly what is still owed are its design.
pub struct Resampler {
    /// rubato's resampler; `None` when both rates are the same and samples pass through untouched.
    inner: Option<FftFixedIn<f32>>,
    /// Input not yet a whole chunk.
    pending: Vec<f32>,
    /// Output samples per input sample.
    ratio: f64,
    /// Input frames taken and output frames given so far: the difference is what the end still owes.
    frames_in: u64,
    frames_out: u64,
}

impl std::fmt::Debug for Resampler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Resampler")
            .field("ratio", &self.ratio)
            .field("pending", &self.pending.len())
            .finish_non_exhaustive()
    }
}

impl Resampler {
    /// A resampler from `from` Hz to `to` Hz. A rate of 0 is taken as 1; a pair rubato cannot serve passes the audio
    /// through unconverted and says so in the log.
    #[must_use]
    pub fn new(from: u32, to: u32) -> Self {
        let (from, to) = (from.max(1), to.max(1));
        let inner = if from == to {
            None
        } else {
            FftFixedIn::<f32>::new(from as usize, to as usize, CHUNK, 1, 1)
                .inspect_err(|e| tracing::error!(from, to, error = %e, "no resampler for these rates; the audio passes unconverted"))
                .ok()
        };
        Self {
            inner,
            pending: Vec::with_capacity(CHUNK * 2),
            ratio: f64::from(to) / f64::from(from),
            frames_in: 0,
            frames_out: 0,
        }
    }

    /// Feed `input`; the output of every whole chunk it completes is appended to `out`.
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let Some(inner) = self.inner.as_mut() else {
            out.extend_from_slice(input);
            return;
        };
        self.pending.extend_from_slice(input);
        self.frames_in += input.len() as u64;
        let before = out.len();
        while self.pending.len() >= CHUNK {
            let chunk: Vec<f32> = self.pending.drain(..CHUNK).collect();
            match inner.process(&[chunk], None) {
                Ok(mut converted) => out.extend(converted.pop().unwrap_or_default()),
                // a lost chunk is 1024 frames of audio; the next one recovers by itself
                Err(e) => {
                    tracing::warn!(error = %e, "a resampling step failed; a chunk was dropped");
                }
            }
        }
        self.frames_out += (out.len() - before) as u64;
    }

    /// The tail: what is still in the last partial chunk and in the filter's delay, padded with silence and cut to
    /// exactly what the input accounts for.
    pub fn finish(&mut self, out: &mut Vec<f32>) {
        let Some(inner) = self.inner.as_mut() else {
            return;
        };
        #[allow(
            clippy::cast_precision_loss,
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss
        )] // frame counts of minutes of audio
        let expected = (self.frames_in as f64 * self.ratio).round() as u64;
        let owed = usize::try_from(expected.saturating_sub(self.frames_out)).unwrap_or(0);
        let mut tail = Vec::with_capacity(owed);
        let mut pending = std::mem::take(&mut self.pending);
        // the bound is a safety stop: the filter's delay is about one chunk
        for _ in 0..3 {
            if tail.len() >= owed {
                break;
            }
            pending.resize(CHUNK, 0.0);
            match inner.process(&[std::mem::take(&mut pending)], None) {
                Ok(mut converted) => tail.extend(converted.pop().unwrap_or_default()),
                Err(e) => {
                    tracing::warn!(error = %e, "the resampler's tail was dropped");
                    break;
                }
            }
        }
        tail.truncate(owed);
        self.frames_out += tail.len() as u64;
        out.extend(tail);
    }
}

#[cfg(test)]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap
)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f64, seconds: f64) -> Vec<f32> {
        let n = (f64::from(rate) * seconds) as usize;
        (0..n)
            .map(|i| (2.0 * std::f64::consts::PI * hz * i as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn resample(input: &[f32], from: u32, to: u32, block: usize) -> Vec<f32> {
        let mut r = Resampler::new(from, to);
        let mut out = Vec::new();
        for chunk in input.chunks(block) {
            r.push(chunk, &mut out);
        }
        r.finish(&mut out);
        out
    }

    /// The middle of a signal, away from the edges where the kernel sees silence.
    fn middle(x: &[f32]) -> &[f32] {
        &x[x.len() / 4..x.len() * 3 / 4]
    }

    #[test]
    fn a_second_of_any_common_rate_is_a_second_at_16_khz() {
        for from in [8_000, 11_025, 22_050, 44_100, 48_000, 96_000, 16_000] {
            let out = resample(&sine(from, 440.0, 1.0), from, MODEL_RATE, 480);
            let n = out.len() as i64;
            assert!((n - 16_000).abs() <= 1, "{from} Hz gave {n} samples");
        }
    }

    #[test]
    fn a_tone_in_the_speech_band_keeps_its_pitch_and_its_level() {
        for from in [44_100_u32, 48_000, 8_000] {
            let out = resample(&sine(from, 1_000.0, 1.0), from, MODEL_RATE, 441);
            let mid = middle(&out);
            let level = rms(mid);
            // a full-scale sine has an RMS of 0.707
            assert!(
                (level - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.02,
                "{from} Hz: level {level}"
            );
            // pitch: zero crossings per second, two per cycle
            let crossings = mid.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
            let hz = crossings as f64 / (mid.len() as f64 / 16_000.0);
            assert!((hz - 1_000.0).abs() < 5.0, "{from} Hz: pitch {hz}");
        }
    }

    #[test]
    fn what_16_khz_cannot_carry_is_removed_not_folded_into_speech() {
        // 11 kHz at 48 kHz would land on 5 kHz at 16 kHz if it were only decimated
        let out = resample(&sine(48_000, 11_000.0, 1.0), 48_000, MODEL_RATE, 480);
        let level = rms(middle(&out));
        assert!(level < 0.01, "an 11 kHz tone came through at {level}");
    }

    #[test]
    fn a_steady_level_stays_what_it_was() {
        let out = resample(&vec![0.5_f32; 48_000], 48_000, MODEL_RATE, 1024);
        for s in middle(&out) {
            assert!((s - 0.5).abs() < 0.005, "{s}");
        }
    }

    #[test]
    fn the_block_size_does_not_change_a_sample() {
        let input = sine(44_100, 700.0, 0.5);
        let whole = resample(&input, 44_100, MODEL_RATE, input.len());
        for block in [1, 7, 160, 4096] {
            let parts = resample(&input, 44_100, MODEL_RATE, block);
            assert_eq!(parts.len(), whole.len(), "block {block}");
            for (a, b) in parts.iter().zip(&whole) {
                assert!((a - b).abs() < 1e-6, "block {block}: {a} vs {b}");
            }
        }
    }

    #[test]
    fn sixteen_khz_passes_through_untouched() {
        let input = sine(16_000, 300.0, 0.1);
        assert_eq!(resample(&input, 16_000, MODEL_RATE, 100), input);
    }

    #[test]
    fn it_keeps_only_the_input_it_still_needs() {
        let mut r = Resampler::new(48_000, MODEL_RATE);
        let mut out = Vec::new();
        for _ in 0..500 {
            r.push(&[0.1; 480], &mut out);
        }
        assert!(r.pending.len() < CHUNK, "kept {}", r.pending.len());
    }

    #[test]
    fn stereo_and_integers_become_mono_floats() {
        let mut out = Vec::new();
        downmix(
            &[i16::MAX, 0, 0, i16::MIN, 100],
            2,
            |s: i16| f32::from(s) / 32_768.0,
            &mut out,
        );
        assert_eq!(out.len(), 2, "the odd sample at the end is dropped");
        assert!((out[0] - 0.5).abs() < 0.001 && (out[1] + 0.5).abs() < 0.001);
        let mut mono = Vec::new();
        downmix(&[0.25_f32, -0.25], 1, |s| s, &mut mono);
        assert_eq!(mono, vec![0.25, -0.25]);
        assert!(rms(&[]).abs() < f32::EPSILON);
        assert!((rms(&[0.5, -0.5, 0.5, -0.5]) - 0.5).abs() < 1e-6);
    }
}
