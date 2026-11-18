//! Ordered parallel scan with early stop.
//!
//! Workers take files in sorted order and run in parallel, but results are
//! consumed as a strictly ordered prefix. Scanning stops as soon as that
//! prefix alone can fill the match or byte limit, so the answer is the first
//! N matches in path order no matter how the threads interleave, and a common
//! pattern does not read the whole tree.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;

use crate::error::{Error, Result};
use crate::types::Control;

/// Threads for walking and scanning: the core count, capped at 8.
pub(crate) fn worker_count() -> usize {
    thread::available_parallelism()
        .map_or(2, usize::from)
        .clamp(1, 8)
}

/// Files a worker claims at once.
const CHUNK: usize = 32;

/// Prefix weights: when either limit is reached by the finished prefix, stop.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Weight {
    pub matches: usize,
    pub bytes: usize,
}

struct State<T> {
    slots: Vec<Option<T>>,
    frontier: usize,
    acc: Weight,
}

/// Runs `work` over `items` in parallel and returns one slot per item.
/// Slots past the early-stop point are `None`.
pub(crate) fn ordered<I, T, S, W>(
    items: &[I],
    ctl: &Control,
    limit: Weight,
    scratch: impl Fn() -> S + Sync,
    work: W,
    weigh: impl Fn(&T) -> Weight + Sync,
) -> Result<Vec<Option<T>>>
where
    I: Sync,
    T: Send,
    S: Send,
    W: Fn(&I, &mut S) -> Result<T> + Sync,
{
    let n = items.len();
    let state = Mutex::new(State {
        slots: (0..n).map(|_| None).collect(),
        frontier: 0,
        acc: Weight::default(),
    });
    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let failure: Mutex<Option<Error>> = Mutex::new(None);
    let threads = worker_count().min(n.max(1));
    thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut sc = scratch();
                let mut done: Vec<(usize, T)> = Vec::with_capacity(CHUNK);
                loop {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    // Work is claimed in chunks: one atomic and one lock per
                    // CHUNK files instead of per file.
                    let first = next.fetch_add(CHUNK, Ordering::Relaxed);
                    if first >= n {
                        return;
                    }
                    if let Err(e) = ctl.check() {
                        fail(&failure, &stop, e);
                        return;
                    }
                    for (i, item) in items.iter().enumerate().skip(first).take(CHUNK) {
                        if stop.load(Ordering::Relaxed) {
                            break;
                        }
                        match work(item, &mut sc) {
                            Ok(out) => done.push((i, out)),
                            Err(e) => {
                                fail(&failure, &stop, e);
                                return;
                            }
                        }
                    }
                    let Ok(mut st) = state.lock() else { return };
                    for (i, out) in done.drain(..) {
                        st.slots[i] = Some(out);
                    }
                    // Advance over the finished prefix and add its weight.
                    while st.frontier < n {
                        let f = st.frontier;
                        let Some(w) = st.slots[f].as_ref().map(&weigh) else {
                            break;
                        };
                        st.acc.matches += w.matches;
                        st.acc.bytes += w.bytes;
                        st.frontier += 1;
                    }
                    if st.acc.matches >= limit.matches || st.acc.bytes >= limit.bytes {
                        stop.store(true, Ordering::Relaxed);
                    }
                }
            });
        }
    });
    if let Some(e) = failure
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        return Err(e);
    }
    let st = state
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(st.slots)
}

fn fail(slot: &Mutex<Option<Error>>, stop: &AtomicBool, e: Error) {
    if let Ok(mut s) = slot.lock() {
        s.get_or_insert(e);
    }
    stop.store(true, Ordering::Relaxed);
}
