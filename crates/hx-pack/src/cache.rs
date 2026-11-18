//! A per-root cache of the file list, so a whole-tree search does not walk the tree again.
//!
//! The walk of a large tree costs tens of milliseconds even when nothing changed. The cache
//! keeps the sorted list of walkable files (with the never-pack files set aside) for a root
//! and a skip list. File *contents* are never cached; every search still reads the files.
//!
//! **Invalidation rule**, all of which must hold for an entry to be used:
//! 1. *Mutation:* [`WalkCache::invalidate_all`] and [`WalkCache::invalidate_root`] drop
//!    entries. `hx` calls them after every `txn.apply`, `txn.restore`, `txn.recover` and
//!    `txn.discard`, successful or not.
//! 2. *Directory mtimes:* a directory's modification time changes when an entry is added,
//!    removed or renamed in it. The walk records the mtime of every directory it visited and of
//!    every `.gitignore`, `.ignore` and `.rgignore` (and `.git/info/exclude`). On access
//!    each one is stat-ed again; any difference rejects the entry. That check costs one
//!    stat per directory, about a millisecond for a thousand directories.
//! 3. *TTL:* an entry older than the TTL is rejected, which bounds the damage from changes
//!    the stamps cannot see (ignore files outside the root, clock steps, file systems that
//!    do not update directory mtimes).
//!
//! An entry is not stored if any recorded time is within the settle window of the walk's
//! start: a change made in the same clock tick as the walk could leave an unchanged stamp.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use crate::root::Root;
use crate::types::WithheldFile;

/// Default time to live of an entry.
pub const DEFAULT_TTL: Duration = Duration::from_mins(1);
/// Default window before the walk's start in which a recorded time makes the walk unsafe to cache.
pub const DEFAULT_SETTLE: Duration = Duration::from_secs(2);
/// Roots kept; the least recently used is dropped first.
const MAX_ROOTS: usize = 4;

/// What a whole-root walk found.
#[derive(Debug, Default, Clone)]
pub(crate) struct Snapshot {
    /// Walkable files, sorted.
    pub files: Vec<String>,
    /// Files the never-pack list set aside.
    pub withheld: Vec<WithheldFile>,
    /// `(path, mtime)` of every directory and ignore file seen; `None` for a path that was absent.
    pub stamps: Vec<(String, Option<SystemTime>)>,
}

struct Entry {
    root: PathBuf,
    skip: Vec<String>,
    built: Instant,
    used: u64,
    snapshot: Arc<Snapshot>,
}

/// Hit and miss counts, for tests and for reporting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    /// Lookups served from an entry.
    pub hits: u64,
    /// Lookups that had to walk (no entry, or the entry failed validation).
    pub misses: u64,
}

/// The cache. Share one between handlers with `Arc`.
#[derive(Debug)]
pub struct WalkCache {
    ttl: Duration,
    settle: Duration,
    entries: Mutex<Vec<Entry>>,
    clock: AtomicU64,
    hits: AtomicU64,
    misses: AtomicU64,
}

impl std::fmt::Debug for Entry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Entry")
            .field("root", &self.root)
            .field("files", &self.snapshot.files.len())
            .finish_non_exhaustive()
    }
}

impl Default for WalkCache {
    fn default() -> Self {
        Self::new(DEFAULT_TTL)
    }
}

impl WalkCache {
    /// A cache whose entries live at most `ttl`.
    #[must_use]
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            settle: DEFAULT_SETTLE,
            entries: Mutex::new(Vec::new()),
            clock: AtomicU64::new(0),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    /// Changes the settle window (tests use zero with back-dated times).
    #[must_use]
    pub fn with_settle(mut self, settle: Duration) -> Self {
        self.settle = settle;
        self
    }

    /// Drops every entry. Call after anything that changes the workspace.
    pub fn invalidate_all(&self) {
        self.lock().clear();
    }

    /// Drops the entries of one root.
    pub fn invalidate_root(&self, root: &std::path::Path) {
        self.lock().retain(|e| e.root != root);
    }

    /// Hits and misses so far.
    #[must_use]
    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Entry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The entry for `root` and `skip` if it is still valid.
    pub(crate) fn get(&self, root: &Root, skip: &[String]) -> Option<Arc<Snapshot>> {
        let candidate = {
            let mut entries = self.lock();
            let tick = self.clock.fetch_add(1, Ordering::Relaxed);
            entries
                .iter_mut()
                .find(|e| e.root == root.path() && e.skip == skip)
                .map(|e| {
                    e.used = tick;
                    (e.built, Arc::clone(&e.snapshot))
                })
        };
        let valid = candidate.filter(|(built, snap)| {
            built.elapsed() < self.ttl
                && snap
                    .stamps
                    .iter()
                    .all(|(rel, stamp)| root.modified(rel) == *stamp)
        });
        if let Some((_, snap)) = valid {
            self.hits.fetch_add(1, Ordering::Relaxed);
            Some(snap)
        } else {
            self.misses.fetch_add(1, Ordering::Relaxed);
            self.lock()
                .retain(|e| !(e.root == root.path() && e.skip == skip));
            None
        }
    }

    /// Stores a snapshot unless the walk was too recent to trust.
    pub(crate) fn put(
        &self,
        root: &Root,
        skip: &[String],
        snap: &Arc<Snapshot>,
        started: SystemTime,
    ) {
        let too_fresh = started.checked_sub(self.settle).is_some_and(|limit| {
            snap.stamps
                .iter()
                .any(|(_, m)| m.is_some_and(|m| m > limit))
        });
        if too_fresh {
            return;
        }
        let mut entries = self.lock();
        entries.retain(|e| !(e.root == root.path() && e.skip == skip));
        if entries.len() >= MAX_ROOTS
            && let Some(oldest) = entries
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| e.used)
                .map(|(i, _)| i)
        {
            entries.remove(oldest);
        }
        entries.push(Entry {
            root: root.path().to_path_buf(),
            skip: skip.to_vec(),
            built: Instant::now(),
            used: self.clock.fetch_add(1, Ordering::Relaxed),
            snapshot: Arc::clone(snap),
        });
    }
}

impl WalkCache {
    /// How many roots are cached.
    #[must_use]
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// Whether nothing is cached.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
