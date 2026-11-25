//! The crate's one error type, and its mapping onto the wire's error catalog.

use hx_proto::error::{AppError, codes};
use hx_proto::txn::EditFailure;

/// Everything that can go wrong in a transaction.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// At least one edit failed validation. Nothing was written.
    #[error("{} edit(s) failed validation; nothing was written", failures.len())]
    AbortedBeforeWrite {
        /// Each failed edit, with its closest match.
        failures: Vec<EditFailure>,
    },
    /// An edit targets a path outside the allowed globs.
    #[error("{} path(s) are outside the allowed scope", paths.len())]
    ScopeViolation {
        /// The offending paths, as the caller spelled them.
        paths: Vec<String>,
    },
    /// An edit targets a protected path.
    #[error("{} path(s) are protected", paths.len())]
    ProtectedPath {
        /// The offending paths, as the caller spelled them.
        paths: Vec<String>,
    },
    /// A glob in `allowed` or `protected` does not parse.
    #[error("invalid glob `{pattern}`: {reason}")]
    InvalidGlob {
        /// The pattern.
        pattern: String,
        /// Why it failed.
        reason: String,
    },
    /// The workspace root cannot be opened as a directory.
    #[error("cannot open workspace root `{root}`: {source}")]
    InvalidRoot {
        /// The root as given.
        root: String,
        /// The operating system's error.
        source: std::io::Error,
    },
    /// The transaction exceeds a size or count limit.
    #[error("{0}")]
    LimitExceeded(String),
    /// A touched file changed between validation and write.
    #[error("`{path}` changed while the transaction was being prepared")]
    Conflict {
        /// The file that changed.
        path: String,
    },
    /// A file an edit expected by its hash is not as expected (`expect_sha256`).
    #[error("{} path(s) changed since the caller looked: {}", paths.len(), paths.join(", "))]
    ChangedSince {
        /// The paths, as the caller spelled them.
        paths: Vec<String>,
    },
    /// Another transaction holds the workspace lock.
    #[error("another transaction holds the workspace lock")]
    WorkspaceBusy,
    /// A write failed after the transaction started; the workspace was restored.
    #[error("a write failed and the workspace was restored: {cause}")]
    ApplyFailed {
        /// What failed.
        cause: String,
    },
    /// No journal with that id.
    #[error("journal `{0}` not found")]
    JournalNotFound(String),
    /// The journal failed verification.
    #[error("journal `{id}` is corrupt: {reason}")]
    JournalCorrupt {
        /// The journal id.
        id: String,
        /// What is wrong.
        reason: String,
    },
    /// The journal belongs to a live transaction.
    #[error("journal `{0}` is in use by a live transaction")]
    JournalBusy(String),
    /// The journal's state does not allow the operation.
    #[error("journal `{id}` is {state}; this operation needs another state")]
    InvalidState {
        /// The journal id.
        id: String,
        /// The state it is in.
        state: String,
    },
    /// Restoring failed. The journal is kept.
    #[error("restoring journal `{id}` failed: {cause}")]
    RestoreFailed {
        /// The journal id.
        id: String,
        /// What failed.
        cause: String,
    },
    /// The request was cancelled before anything changed.
    #[error("cancelled")]
    Cancelled,
    /// An I/O failure before any workspace write.
    #[error("{context}: {source}")]
    Io {
        /// What was being done.
        context: String,
        /// The operating system's error.
        source: std::io::Error,
    },
    /// A simulated crash from the fault injector: stop without cleaning up.
    #[cfg(feature = "dev-fixtures")]
    #[error("injected crash")]
    InjectedCrash,
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// An I/O error with context.
    pub fn io(context: impl Into<String>, source: std::io::Error) -> Self {
        Error::Io {
            context: context.into(),
            source,
        }
    }

    /// The stable catalog code for this error.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Error::AbortedBeforeWrite { .. } => codes::HX_TXN_ABORTED_BEFORE_WRITE,
            Error::ScopeViolation { .. } => codes::HX_TXN_SCOPE_VIOLATION,
            Error::ProtectedPath { .. } => codes::HX_TXN_PROTECTED_PATH,
            Error::InvalidGlob { .. } => codes::HX_INVALID_PARAMS,
            Error::InvalidRoot { .. } => codes::HX_TXN_INVALID_ROOT,
            Error::LimitExceeded(_) => codes::HX_TXN_LIMIT_EXCEEDED,
            Error::Conflict { .. } => codes::HX_TXN_CONFLICT,
            Error::ChangedSince { .. } => codes::HX_TXN_CHANGED_SINCE,
            Error::WorkspaceBusy => codes::HX_TXN_WORKSPACE_BUSY,
            Error::ApplyFailed { .. } => codes::HX_TXN_APPLY_FAILED,
            Error::JournalNotFound(_) => codes::HX_TXN_JOURNAL_NOT_FOUND,
            Error::JournalCorrupt { .. } => codes::HX_TXN_JOURNAL_CORRUPT,
            Error::JournalBusy(_) => codes::HX_TXN_JOURNAL_BUSY,
            Error::InvalidState { .. } => codes::HX_TXN_INVALID_STATE,
            Error::RestoreFailed { .. } => codes::HX_TXN_RESTORE_FAILED,
            Error::Cancelled => codes::HX_CANCELLED,
            Error::Io { .. } => codes::HX_TXN_IO_ERROR,
            #[cfg(feature = "dev-fixtures")]
            Error::InjectedCrash => codes::HX_INTERNAL_ERROR,
        }
    }
}

impl From<Error> for AppError {
    fn from(err: Error) -> Self {
        let app = AppError::new(err.code(), err.to_string());
        match err {
            Error::AbortedBeforeWrite { failures } => app.with(
                "failures",
                serde_json::to_value(failures).unwrap_or_default(),
            ),
            Error::ScopeViolation { paths }
            | Error::ProtectedPath { paths }
            | Error::ChangedSince { paths } => app.with("paths", paths),
            Error::ApplyFailed { .. } => app.with("restored", true),
            Error::Conflict { path } => app.with("path", path),
            Error::JournalNotFound(id)
            | Error::JournalBusy(id)
            | Error::JournalCorrupt { id, .. }
            | Error::InvalidState { id, .. }
            | Error::RestoreFailed { id, .. } => app.with("journal_id", id),
            _ => app,
        }
    }
}
