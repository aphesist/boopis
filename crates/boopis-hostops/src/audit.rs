//! The host-ops audit trail, `<app data>/audit/house-ops.jsonl` (section 8): one line per call, mode `0600`, rotated by
//! size. A line never holds message text, a fragment, a task, a key or a token: the key is its digest.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::{append_private, key_digest, rfc3339};

/// The file's size past which it is rotated to `.1`.
pub const ROTATE_AT: u64 = 1024 * 1024;

/// How a call ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Answered.
    Ok,
    /// Refused before anything was done.
    Refused,
    /// Tried, and failed.
    Failed,
}

impl Outcome {
    fn word(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Refused => "refused",
            Self::Failed => "failed",
        }
    }
}

/// One call, as the trail keeps it.
#[derive(Debug, Clone)]
pub struct Entry<'a> {
    /// The verb.
    pub op: &'a str,
    /// What it was about (`room g-1`, `bot kai`, `team`).
    pub target: String,
    /// The job it was for.
    pub job_id: Option<&'a str>,
    /// The idempotency key (only its digest is written).
    pub key: Option<&'a str>,
    /// A dry run.
    pub dry_run: bool,
    /// How it ended.
    pub outcome: Outcome,
    /// The refusal's code.
    pub code: Option<&'a str>,
}

/// The line `entry` is written as at `now` (milliseconds).
#[must_use]
pub fn line(entry: &Entry<'_>, now: u64) -> Value {
    let mut v = json!({
        "at": rfc3339(now),
        "op": entry.op,
        "target": entry.target,
        "dry_run": entry.dry_run,
        "outcome": entry.outcome.word(),
    });
    if let Some(j) = entry.job_id {
        v["job_id"] = j.into();
    }
    if let Some(k) = entry.key {
        v["key_digest"] = key_digest(k).into();
    }
    if let Some(c) = entry.code {
        v["code"] = c.into();
    }
    v
}

/// The trail.
#[derive(Debug, Clone)]
pub struct Audit {
    path: Option<PathBuf>,
}

impl Audit {
    /// The trail at `path`.
    #[must_use]
    pub fn at(path: &Path) -> Self {
        Self {
            path: Some(path.to_path_buf()),
        }
    }

    /// A trail that writes nowhere (tests that do not read it).
    #[must_use]
    pub fn none() -> Self {
        Self { path: None }
    }

    /// Write `entry`. A trail that cannot be written is logged, and the call's answer stands.
    pub fn write(&self, entry: &Entry<'_>, now: u64) {
        let Some(p) = &self.path else { return };
        if append_private(p, &line(entry, now).to_string(), ROTATE_AT).is_err() {
            tracing::warn!(
                op = entry.op,
                "the host-ops audit trail could not be written"
            );
        }
    }
}
