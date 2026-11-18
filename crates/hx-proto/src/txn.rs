//! Wire types for the `txn.*` methods.
//!
//! Wire types ignore unknown fields on read, so new optional fields are additive.
//! Paths are workspace-relative, `/`-separated, and never absolute or containing `..`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One edit. Edits apply in order, each seeing the result of the previous ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Edit {
    /// Search and replace. `old` must match exactly once, tolerating CRLF and a uniform indent
    /// shift. A whitespace-only difference is reported, never applied.
    Replace {
        /// The file to edit; it must exist.
        path: String,
        /// The text to find.
        old: String,
        /// The replacement.
        new: String,
        /// Replace every exact occurrence instead of requiring exactly one.
        #[serde(default)]
        replace_all: bool,
    },
    /// Create a whole file, with parent directories.
    Create {
        /// The file to create.
        path: String,
        /// The full UTF-8 content.
        content: String,
        /// Replace the file if it already exists. Without it, an existing file is a failure.
        #[serde(default)]
        overwrite: bool,
    },
    /// Delete a file. A symlink is removed itself, not its target.
    Delete {
        /// The file to delete; it must exist.
        path: String,
    },
    /// Apply unified-diff hunks. The diff may carry file headers (`--- a/x`, `+++ b/x`,
    /// `/dev/null` for create or delete) and several files.
    Diff {
        /// The only file the hunks apply to. Required when the diff has no file headers.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// The unified diff text.
        diff: String,
    },
}

/// Why one edit failed validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The text was not found. See `closest`.
    NoMatch,
    /// The text matched in several places. See `candidate_lines`.
    Ambiguous,
    /// The file does not exist.
    NotFound,
    /// The file exists and the edit would create it.
    AlreadyExists,
    /// The file is not valid UTF-8, so it cannot take a text edit.
    NotUtf8,
    /// The diff text could not be parsed.
    InvalidDiff,
    /// The path is absolute, contains `..`, or escapes the workspace through a symlink.
    PathUnsafe,
    /// The path is a directory.
    IsDirectory,
    /// The path is not a regular file or symlink.
    NotRegular,
    /// The file or the transaction exceeds a size limit.
    TooLarge,
    /// The edit asks for something unsupported, such as a rename in a diff.
    Unsupported,
}

/// The closest place in the file to what an edit looked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ClosestMatch {
    /// First line of the closest region, 1-based.
    pub start_line: u32,
    /// Last line of the closest region, 1-based and inclusive.
    pub end_line: u32,
    /// The first line, 1-based, where the region differs from the request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_diff_line: Option<u32>,
    /// The region's text, capped in size.
    pub snippet: String,
    /// 0.0 to 1.0.
    pub similarity: f64,
    /// True when the region differs from the request only in whitespace. The edit is **not**
    /// applied in that case; resend it with the exact text.
    pub whitespace_only: bool,
}

/// One failed edit in an `hx.txn.aborted_before_write` error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EditFailure {
    /// Index into the request's `edits`.
    pub edit_index: u32,
    /// The path the edit named (or the diff section's path).
    pub path: String,
    /// What went wrong.
    pub kind: FailureKind,
    /// A human-readable explanation.
    pub message: String,
    /// For a diff edit, the zero-based hunk that failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk: Option<u32>,
    /// The closest region, for `no_match`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closest: Option<ClosestMatch>,
    /// For `ambiguous`, the first line of each candidate, 1-based.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidate_lines: Vec<u32>,
}

/// Parameters of `txn.validate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ValidateParams {
    /// The workspace root directory.
    pub root: String,
    /// The edits.
    pub edits: Vec<Edit>,
    /// If set, every touched path must match one of these globs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed: Option<Vec<String>>,
    /// Paths that may not be touched. Omitted means the built-in defaults
    /// (`crates/hx-txn/protected.default.json`); an explicit list, even an empty one, replaces them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected: Option<Vec<String>>,
}

/// Parameters of `txn.apply`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ApplyParams {
    /// The workspace root directory.
    pub root: String,
    /// Where journals live, under the Hermes profile. Created 0700 if missing.
    pub journal_dir: String,
    /// The edits.
    pub edits: Vec<Edit>,
    /// If set, every touched path must match one of these globs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed: Option<Vec<String>>,
    /// Paths that may not be touched. Omitted means the built-in defaults; an explicit list,
    /// even an empty one, replaces them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected: Option<Vec<String>>,
}

/// One touched file in a result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FileChange {
    /// The real path, workspace-relative, after resolving symlinks inside the workspace.
    pub path: String,
    /// SHA-256 of the content before, or null if the file did not exist.
    pub sha256_before: Option<String>,
    /// SHA-256 of the content after, or null if the file was deleted.
    pub sha256_after: Option<String>,
    /// The transaction created the file.
    pub created: bool,
    /// The transaction deleted the file.
    pub deleted: bool,
}

/// Result of `txn.validate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ValidateResult {
    /// What `txn.apply` would change. Nothing was written.
    pub files: Vec<FileChange>,
}

/// Result of `txn.apply`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ApplyResult {
    /// The journal to pass to `txn.restore` or `txn.discard`. A `UUIDv7`.
    pub journal_id: String,
    /// What changed. Files whose content is unchanged are listed with equal hashes.
    pub files: Vec<FileChange>,
}

/// Parameters of `txn.restore` and `txn.discard`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct JournalRef {
    /// The journal directory the transaction used.
    pub journal_dir: String,
    /// The id `txn.apply` returned.
    pub journal_id: String,
}

/// Result of `txn.restore`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RestoreResult {
    /// The journal that was consumed.
    pub journal_id: String,
    /// Paths whose bytes and metadata were put back (including recreated deletions).
    pub restored: Vec<String>,
    /// Paths the transaction had created, now removed.
    pub removed: Vec<String>,
}

/// Result of `txn.discard`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DiscardResult {
    /// The journal that was removed.
    pub journal_id: String,
}

/// Parameters of `txn.recover`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RecoverParams {
    /// The journal directory to scan.
    pub journal_dir: String,
}

/// A journal `txn.recover` could not finish.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RecoverFailure {
    /// The journal id (the directory name when the manifest is unreadable).
    pub journal_id: String,
    /// The stable error code.
    pub code: String,
    /// What happened.
    pub message: String,
}

/// Result of `txn.recover`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RecoverResult {
    /// Interrupted transactions that were rolled back.
    pub restored: Vec<String>,
    /// Journals that never reached the workspace and were just removed.
    pub discarded: Vec<String>,
    /// Completed transactions still waiting for `txn.restore` or `txn.discard`. Left alone.
    pub pending: Vec<String>,
    /// Journals held by a live transaction. Left alone.
    pub busy: Vec<String>,
    /// Journals that could not be recovered; they are kept.
    pub failed: Vec<RecoverFailure>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edits_parse_by_op_and_default_flags() {
        let e: Edit =
            serde_json::from_value(json!({"op":"replace","path":"a","old":"x","new":"y"})).unwrap();
        assert_eq!(
            e,
            Edit::Replace {
                path: "a".into(),
                old: "x".into(),
                new: "y".into(),
                replace_all: false
            }
        );
        let e: Edit =
            serde_json::from_value(json!({"op":"create","path":"a","content":""})).unwrap();
        assert!(matches!(
            e,
            Edit::Create {
                overwrite: false,
                ..
            }
        ));
    }

    #[test]
    fn unknown_fields_are_ignored_but_unknown_ops_are_not() {
        let ok = serde_json::from_value::<Edit>(json!({"op":"delete","path":"a","future":1}));
        assert!(ok.is_ok());
        assert!(serde_json::from_value::<Edit>(json!({"op":"chmod","path":"a"})).is_err());
    }

    #[test]
    fn protected_distinguishes_absent_from_empty() {
        let p: ValidateParams = serde_json::from_value(json!({"root":"/r","edits":[]})).unwrap();
        assert_eq!(p.protected, None);
        let p: ValidateParams =
            serde_json::from_value(json!({"root":"/r","edits":[],"protected":[]})).unwrap();
        assert_eq!(p.protected, Some(vec![]));
    }
}
