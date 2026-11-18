//! Types shared by every pack method: budgets, deadlines, truncation notes,
//! redaction counts and the walk options.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Default per-file cap: larger files are skipped, never read.
pub const DEFAULT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Default longest line kept in output; the rest of the line is cut and marked.
pub const DEFAULT_MAX_LINE_BYTES: usize = 512;
/// Default output budget for one call.
pub const DEFAULT_MAX_BYTES: usize = 64 * 1024;
/// Bytes charged for each output item on top of its text (path, header, gutter).
pub const ITEM_OVERHEAD: usize = 32;
/// Directories skipped by every walk unless the request overrides the list.
pub const DEFAULT_SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".next",
    ".nuxt",
    ".gradle",
    ".idea",
];

/// Options for every call that walks a tree.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct WalkOptions {
    /// Directory names to skip. `None` means [`DEFAULT_SKIP_DIRS`]; `Some([])` skips nothing.
    pub skip_dirs: Option<Vec<String>>,
    /// Files larger than this are skipped. `None` means [`DEFAULT_MAX_FILE_BYTES`].
    pub max_file_bytes: Option<u64>,
}

impl WalkOptions {
    /// The skip list in force.
    #[must_use]
    pub fn skip_dirs(&self) -> Vec<String> {
        self.skip_dirs
            .clone()
            .unwrap_or_else(|| DEFAULT_SKIP_DIRS.iter().map(|s| (*s).to_owned()).collect())
    }

    /// The per-file cap in force.
    #[must_use]
    pub fn max_file_bytes(&self) -> u64 {
        self.max_file_bytes.unwrap_or(DEFAULT_MAX_FILE_BYTES)
    }
}

/// Cancellation and deadline, checked between files.
#[derive(Debug, Clone, Default)]
pub struct Control {
    cancel: Option<Arc<AtomicBool>>,
    deadline: Option<Instant>,
}

impl Control {
    /// No cancellation, no deadline.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// Cancel when `flag` becomes true.
    #[must_use]
    pub fn with_cancel(mut self, flag: Arc<AtomicBool>) -> Self {
        self.cancel = Some(flag);
        self
    }

    /// Fail with [`Error::Timeout`] once `deadline` has passed.
    #[must_use]
    pub fn with_deadline(mut self, deadline: Instant) -> Self {
        self.deadline = Some(deadline);
        self
    }

    /// `Ok` while the call may continue.
    ///
    /// # Errors
    /// [`Error::Cancelled`] or [`Error::Timeout`].
    pub fn check(&self) -> Result<()> {
        if self
            .cancel
            .as_ref()
            .is_some_and(|f| f.load(Ordering::Relaxed))
        {
            return Err(Error::Cancelled);
        }
        if self.deadline.is_some_and(|d| Instant::now() >= d) {
            return Err(Error::Timeout);
        }
        Ok(())
    }
}

/// A byte budget. Output is charged before it is added, so the total can
/// never pass the limit; nothing is built and then cut.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    limit: usize,
    used: usize,
}

impl Budget {
    /// A budget of `limit` bytes.
    #[must_use]
    pub fn new(limit: usize) -> Self {
        Self { limit, used: 0 }
    }

    /// Bytes left.
    #[must_use]
    pub fn remaining(&self) -> usize {
        self.limit - self.used
    }

    /// Bytes charged so far.
    #[must_use]
    pub fn used(&self) -> usize {
        self.used
    }

    /// The limit this budget was made with.
    #[must_use]
    pub fn limit(&self) -> usize {
        self.limit
    }

    /// Charges `n` bytes if they fit. Returns whether they did.
    pub fn try_take(&mut self, n: usize) -> bool {
        if n <= self.remaining() {
            self.used += n;
            true
        } else {
            false
        }
    }
}

/// Why a result is incomplete.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Truncation {
    /// The byte budget ran out.
    MaxBytes,
    /// `max_matches` was reached.
    MaxMatches,
    /// A file or definition limit was reached.
    MaxItems,
    /// At least one line was longer than the line cap and was cut.
    LineClipped,
}

/// Adds `t` to `list` once.
pub(crate) fn note(list: &mut Vec<Truncation>, t: Truncation) {
    if !list.contains(&t) {
        list.push(t);
        list.sort();
    }
}

/// How many redactions the returned text contains, in total and per rule.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Redactions {
    /// All redactions in the returned text.
    pub total: usize,
    /// The same, by rule id.
    pub by_rule: BTreeMap<String, usize>,
}

impl Redactions {
    /// Adds the counts of `other`.
    pub fn merge(&mut self, other: &Redactions) {
        self.total += other.total;
        for (rule, n) in &other.by_rule {
            *self.by_rule.entry(rule.clone()).or_insert(0) += n;
        }
    }
}

/// A file pack refused to return, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct WithheldFile {
    /// Path relative to the root.
    pub path: String,
    /// Why it was withheld, from `never_pack.json`.
    pub reason: String,
}

/// Files withheld by the never-pack list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Withheld {
    /// How many files were withheld.
    pub count: usize,
    /// The first few, by path.
    pub files: Vec<WithheldFile>,
}

/// How many withheld files are listed by name.
pub(crate) const WITHHELD_LISTED: usize = 20;

impl Withheld {
    pub(crate) fn push(&mut self, file: WithheldFile) {
        self.count += 1;
        if self.files.len() < WITHHELD_LISTED {
            self.files.push(file);
        }
    }

    pub(crate) fn merge(&mut self, other: Withheld) {
        self.count += other.count;
        for f in other.files {
            if self.files.len() < WITHHELD_LISTED {
                self.files.push(f);
            }
        }
        self.files.sort_by(|a, b| a.path.cmp(&b.path));
    }
}

/// Files that were looked at and left out, by reason.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Skipped {
    /// Binary files (a NUL byte in the first 8 KiB).
    pub binary: usize,
    /// Files over the per-file cap.
    pub too_large: usize,
    /// Files that could not be opened or read.
    pub unreadable: usize,
}

impl Skipped {
    /// Counts one skipped file.
    pub(crate) fn count(&mut self, skip: crate::files::Skip) {
        use crate::files::Skip;
        match skip {
            Skip::Binary => self.binary += 1,
            Skip::TooLarge => self.too_large += 1,
            Skip::Unreadable => self.unreadable += 1,
        }
    }
}

/// Cuts `line` to `max` bytes on a char boundary and marks the cut.
/// Returns the text and whether it was cut.
pub(crate) fn clip_line(line: &str, max: usize) -> (String, bool) {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() <= max {
        return (line.to_owned(), false);
    }
    let mut end = max;
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    let cut = line.len() - end;
    (format!("{}…[+{cut} bytes]", &line[..end]), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_charges_before_adding_and_never_overspends() {
        let mut b = Budget::new(10);
        assert!(b.try_take(4));
        assert!(!b.try_take(7));
        assert_eq!((b.used(), b.remaining()), (4, 6));
        assert!(b.try_take(6));
        assert!(!b.try_take(1));
        assert_eq!(b.used(), b.limit());
    }

    #[test]
    fn clip_line_cuts_on_a_char_boundary_and_marks_the_cut() {
        assert_eq!(clip_line("short\r\n", 10), ("short".to_owned(), false));
        let (out, clipped) = clip_line("ééééé", 5);
        assert!(clipped && out.starts_with("éé…[+"), "{out}");
        let (out, _) = clip_line(&"x".repeat(20), 8);
        assert_eq!(out, "xxxxxxxx…[+12 bytes]");
    }

    #[test]
    fn control_reports_cancel_and_deadline() {
        assert!(Control::none().check().is_ok());
        let flag = Arc::new(AtomicBool::new(false));
        let ctl = Control::none().with_cancel(Arc::clone(&flag));
        assert!(ctl.check().is_ok());
        flag.store(true, Ordering::Relaxed);
        assert_eq!(ctl.check().unwrap_err().code(), "hx.pack.cancelled");
        let past = Control::none().with_deadline(Instant::now());
        assert_eq!(past.check().unwrap_err().code(), "hx.pack.timeout");
    }

    #[test]
    fn walk_options_defaults_and_overrides() {
        let d = WalkOptions::default();
        assert!(d.skip_dirs().contains(&"node_modules".to_owned()));
        assert_eq!(d.max_file_bytes(), DEFAULT_MAX_FILE_BYTES);
        let o = WalkOptions {
            skip_dirs: Some(vec![]),
            max_file_bytes: Some(7),
        };
        assert!(o.skip_dirs().is_empty());
        assert_eq!(o.max_file_bytes(), 7);
    }
}
