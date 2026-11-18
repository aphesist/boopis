//! Text edits, in memory: search and replace, and unified-diff hunks.
//!
//! Nothing here touches the file system. The planner feeds it file contents and gets back new
//! contents or a [`Failure`].

pub mod closest;
pub mod diff;
pub mod replace;
pub mod text;

use hx_proto::txn::{ClosestMatch, FailureKind};

/// Why one edit could not be applied, before the planner attaches the edit's index and path.
#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    /// The category.
    pub kind: FailureKind,
    /// A human-readable explanation.
    pub message: String,
    /// For a diff, the zero-based hunk that failed.
    pub hunk: Option<u32>,
    /// The closest region of the file.
    pub closest: Option<ClosestMatch>,
    /// For an ambiguous match, the first line of each candidate.
    pub candidate_lines: Vec<u32>,
}

impl Failure {
    /// A failure with no hunk, closest match or candidates.
    #[must_use]
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            hunk: None,
            closest: None,
            candidate_lines: Vec::new(),
        }
    }
}
