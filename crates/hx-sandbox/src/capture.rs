//! Output capture with a hard cap. The child is never blocked by the cap: bytes beyond it are
//! still read, counted and dropped, so a chatty program cannot deadlock on a full pipe or
//! grow memory without bound.

use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncReadExt, ReadBuf};

use crate::report::Captured;

const CHUNK: usize = 16 * 1024;

/// Collected bytes shared between a reader task and whoever reads the result, so a partial
/// capture survives a cancelled read.
#[derive(Debug, Default)]
pub(crate) struct Collector {
    inner: Mutex<(Vec<u8>, u64)>,
}

impl Collector {
    pub(crate) fn snapshot(&self, cap: usize) -> Captured {
        let guard = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (bytes, total) = &*guard;
        Captured {
            text: String::from_utf8_lossy(bytes).into_owned(),
            truncated: *total > cap as u64,
            total_bytes: *total,
        }
    }

    fn push(&self, chunk: &[u8], cap: usize) {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (bytes, total) = &mut *guard;
        *total += chunk.len() as u64;
        let room = cap.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
    }
}

/// Reads `reader` to the end into `collector`, keeping at most `cap` bytes.
pub(crate) async fn collect(
    mut reader: impl AsyncRead + Unpin,
    collector: Arc<Collector>,
    cap: usize,
) {
    let mut chunk = vec![0u8; CHUNK];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => collector.push(&chunk[..n], cap),
        }
    }
}

/// How much a capped stream has seen.
#[derive(Debug, Clone, Default)]
pub struct StreamStats {
    total: Arc<AtomicU64>,
    truncated: Arc<AtomicBool>,
}

impl StreamStats {
    /// Bytes the child has written to this stream so far, including dropped ones.
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }

    /// Whether bytes beyond the cap were dropped.
    #[must_use]
    pub fn truncated(&self) -> bool {
        self.truncated.load(Ordering::Relaxed)
    }
}

/// A reader that passes through the first `cap` bytes and swallows the rest.
pub(crate) struct CappedReader<R> {
    inner: R,
    remaining: usize,
    stats: StreamStats,
    scratch: Box<[u8; CHUNK]>,
}

impl<R> CappedReader<R> {
    pub(crate) fn new(inner: R, cap: usize) -> (Self, StreamStats) {
        let stats = StreamStats::default();
        let reader = Self {
            inner,
            remaining: cap,
            stats: stats.clone(),
            scratch: Box::new([0; CHUNK]),
        };
        (reader, stats)
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for CappedReader<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        out: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        loop {
            // Below the cap, never read more than fits in `out` and the budget, so every byte
            // read is delivered. Past the cap, read full chunks and drop them.
            let limit = if this.remaining > 0 {
                out.remaining().min(this.remaining).min(CHUNK)
            } else {
                CHUNK
            };
            if limit == 0 {
                return Poll::Ready(Ok(()));
            }
            let mut tmp = ReadBuf::new(&mut this.scratch[..limit]);
            match Pin::new(&mut this.inner).poll_read(cx, &mut tmp) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(())) => {}
            }
            let got = tmp.filled();
            if got.is_empty() {
                return Poll::Ready(Ok(())); // EOF
            }
            this.stats
                .total
                .fetch_add(got.len() as u64, Ordering::Relaxed);
            if this.remaining > 0 {
                out.put_slice(got);
                this.remaining -= got.len();
                return Poll::Ready(Ok(()));
            }
            this.stats.truncated.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn collect_keeps_the_cap_and_counts_everything() {
        let data = vec![b'x'; 100_000];
        let c = Arc::new(Collector::default());
        collect(&data[..], c.clone(), 10).await;
        let s = c.snapshot(10);
        assert_eq!(s.text.len(), 10);
        assert!(s.truncated);
        assert_eq!(s.total_bytes, 100_000);
    }

    #[tokio::test]
    async fn collect_under_the_cap_is_not_truncated() {
        let c = Arc::new(Collector::default());
        collect(&b"hello"[..], c.clone(), 10).await;
        let s = c.snapshot(10);
        assert_eq!(s.text, "hello");
        assert!(!s.truncated);
    }

    #[tokio::test]
    async fn exact_cap_is_not_truncated() {
        let c = Arc::new(Collector::default());
        collect(&b"0123456789"[..], c.clone(), 10).await;
        assert!(!c.snapshot(10).truncated);
    }

    #[tokio::test]
    async fn capped_reader_swallows_the_excess() {
        let data = vec![b'y'; 50_000];
        let (mut r, stats) = CappedReader::new(&data[..], 100);
        let mut out = Vec::new();
        r.read_to_end(&mut out).await.unwrap();
        assert_eq!(out.len(), 100);
        assert_eq!(stats.total_bytes(), 50_000);
        assert!(stats.truncated());
    }
}
