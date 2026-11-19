//! What the proxy measures about itself: the budgets of `docs/STANDARDS.md` section 6 (attach under 300 ms, proxy
//! overhead under 1 ms p95) are read from here, in the integration test and in the app's diagnostics.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::Serialize;
use specta::Type;

const RING: usize = 8192;

/// A ring of the last durations, in nanoseconds.
#[derive(Debug, Default)]
pub struct Samples {
    ring: Mutex<(Vec<u32>, usize)>,
}

impl Samples {
    /// Record one duration.
    pub fn record(&self, d: Duration) {
        let ns = u32::try_from(d.as_nanos()).unwrap_or(u32::MAX);
        if let Ok(mut g) = self.ring.lock() {
            let (buf, next) = &mut *g;
            if buf.len() < RING {
                buf.push(ns);
            } else {
                buf[*next % RING] = ns;
            }
            *next = (*next + 1) % RING;
        }
    }

    /// The percentile `p` (0..=100) of the recorded durations.
    #[must_use]
    pub fn percentile(&self, p: usize) -> Option<Duration> {
        let g = self.ring.lock().ok()?;
        let mut v = g.0.clone();
        if v.is_empty() {
            return None;
        }
        v.sort_unstable();
        let idx = ((v.len() * p).div_ceil(100))
            .saturating_sub(1)
            .min(v.len() - 1);
        v.get(idx).map(|ns| Duration::from_nanos(u64::from(*ns)))
    }

    /// How many are recorded.
    #[must_use]
    pub fn count(&self) -> usize {
        self.ring.lock().map_or(0, |g| g.0.len())
    }
}

/// The proxy's counters and timings.
#[derive(Debug, Default)]
pub struct Metrics {
    /// Gateway frame in, until it is routed and queued for every UI connection.
    pub route_in: Samples,
    /// UI frame in, until it is validated and handed to the link.
    pub route_out: Samples,
    /// A queued frame, until the UI's sink took it.
    pub sink: Samples,
    /// The socket write of a UI frame.
    pub write: Samples,
    /// Frames from the gateway.
    pub frames_in: AtomicU32,
    /// Frames from the UI.
    pub frames_out: AtomicU32,
    /// Deltas merged because a queue overflowed.
    pub coalesced: AtomicU32,
    /// UI connections closed for being too slow.
    pub slow_closed: AtomicU32,
    /// The last attach, in milliseconds (`u32::MAX` when none yet).
    pub attach_ms: AtomicU32,
}

fn us(d: Option<Duration>) -> Option<u32> {
    d.map(|d| u32::try_from(d.as_micros()).unwrap_or(u32::MAX))
}

/// A snapshot for the UI's diagnostics.
#[derive(Debug, Clone, Serialize, Type)]
pub struct ProxyStats {
    /// Frames from the gateway.
    pub frames_in: u32,
    /// Frames from the UI.
    pub frames_out: u32,
    /// Deltas merged because a queue overflowed.
    pub coalesced: u32,
    /// UI connections closed for being too slow.
    pub slow_closed: u32,
    /// The last attach to the gateway, in milliseconds.
    pub attach_ms: Option<u32>,
    /// p95 of routing a gateway frame, in microseconds.
    pub route_in_p95_us: Option<u32>,
    /// p95 of routing a UI frame, in microseconds.
    pub route_out_p95_us: Option<u32>,
    /// p95 of handing a frame to the UI, in microseconds.
    pub sink_p95_us: Option<u32>,
    /// p95 of writing a frame to the gateway socket, in microseconds.
    pub write_p95_us: Option<u32>,
}

impl Metrics {
    /// Take a snapshot.
    #[must_use]
    pub fn snapshot(&self) -> ProxyStats {
        let attach = self.attach_ms.load(Ordering::Relaxed);
        ProxyStats {
            frames_in: self.frames_in.load(Ordering::Relaxed),
            frames_out: self.frames_out.load(Ordering::Relaxed),
            coalesced: self.coalesced.load(Ordering::Relaxed),
            slow_closed: self.slow_closed.load(Ordering::Relaxed),
            attach_ms: (attach != u32::MAX).then_some(attach),
            route_in_p95_us: us(self.route_in.percentile(95)),
            route_out_p95_us: us(self.route_out.percentile(95)),
            sink_p95_us: us(self.sink.percentile(95)),
            write_p95_us: us(self.write.percentile(95)),
        }
    }

    /// A fresh set.
    #[must_use]
    pub fn new() -> Self {
        let m = Self::default();
        m.attach_ms.store(u32::MAX, Ordering::Relaxed);
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_of_a_known_set() {
        let s = Samples::default();
        assert!(s.percentile(95).is_none());
        for i in 1..=100u64 {
            s.record(Duration::from_micros(i));
        }
        assert_eq!(s.percentile(95), Some(Duration::from_micros(95)));
        assert_eq!(s.percentile(100), Some(Duration::from_micros(100)));
        assert_eq!(s.percentile(50), Some(Duration::from_micros(50)));
        assert_eq!(s.count(), 100);
    }

    #[test]
    fn the_ring_keeps_only_the_latest() {
        let s = Samples::default();
        for _ in 0..RING {
            s.record(Duration::from_secs(1));
        }
        for _ in 0..RING {
            s.record(Duration::from_micros(1));
        }
        assert_eq!(s.count(), RING);
        assert_eq!(s.percentile(100), Some(Duration::from_micros(1)));
    }

    #[test]
    fn a_fresh_snapshot_has_no_attach() {
        let m = Metrics::new();
        assert!(m.snapshot().attach_ms.is_none());
        m.attach_ms.store(12, Ordering::Relaxed);
        assert_eq!(m.snapshot().attach_ms, Some(12));
    }
}
