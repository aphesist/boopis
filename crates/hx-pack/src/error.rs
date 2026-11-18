//! The one error type of this crate.
//!
//! Every variant maps to a stable string code from the catalog in
//! `crates/hx-proto/errors.json` ([`Error::code`]): the `hx.pack.*` codes, plus the shared
//! `hx.cancelled`. A test keeps this list and the catalog in step.
//!
//! Tool *outcomes* are not errors: a file that was withheld, a binary file or
//! a symbol that matched nothing are fields of a successful result
//! (`docs/STANDARDS.md` section 3).

use std::io;

use hx_proto::{AppError, codes};
use serde::Serialize;

/// A `Result` whose error is [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can make a pack call fail as a whole.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A parameter is out of range or malformed.
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    /// The search pattern does not compile.
    #[error("invalid pattern: {0}")]
    InvalidPattern(String),
    /// `root` is not an existing directory.
    #[error("invalid root: {0}")]
    InvalidRoot(String),
    /// A path would leave the root.
    #[error("path escapes the root: {0}")]
    PathEscape(String),
    /// A named path does not exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// No grammar is registered for the requested language.
    #[error("unsupported language: {0}")]
    UnsupportedLanguage(String),
    /// tree-sitter produced no tree.
    #[error("parse failed: {0}")]
    ParseFailed(String),
    /// The git CLI failed.
    #[error("git failed: {0}")]
    GitFailed(String),
    /// The deadline passed.
    #[error("deadline exceeded")]
    Timeout,
    /// The caller cancelled.
    #[error("cancelled")]
    Cancelled,
    /// An embedded data file or query does not load.
    #[error("config invalid: {0}")]
    ConfigInvalid(String),
    /// An unexpected operating-system error.
    #[error("io error on {path}: {source}")]
    Io {
        /// The path, relative to the root where possible.
        path: String,
        /// The underlying error.
        #[source]
        source: io::Error,
    },
}

impl Error {
    /// Every code this crate can produce, in the catalog's order. `Cancelled` uses the
    /// catalog's shared `hx.cancelled`; pack changes nothing, so the contract holds.
    pub const ALL_CODES: &'static [&'static str] = &[
        codes::HX_PACK_INVALID_REQUEST,
        codes::HX_PACK_INVALID_PATTERN,
        codes::HX_PACK_INVALID_ROOT,
        codes::HX_PACK_PATH_ESCAPE,
        codes::HX_PACK_NOT_FOUND,
        codes::HX_PACK_UNSUPPORTED_LANGUAGE,
        codes::HX_PACK_PARSE_FAILED,
        codes::HX_PACK_GIT_FAILED,
        codes::HX_PACK_TIMEOUT,
        codes::HX_CANCELLED,
        codes::HX_PACK_CONFIG_INVALID,
        codes::HX_PACK_IO,
    ];

    /// The stable wire code from the catalog (`crates/hx-proto/errors.json`).
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => codes::HX_PACK_INVALID_REQUEST,
            Self::InvalidPattern(_) => codes::HX_PACK_INVALID_PATTERN,
            Self::InvalidRoot(_) => codes::HX_PACK_INVALID_ROOT,
            Self::PathEscape(_) => codes::HX_PACK_PATH_ESCAPE,
            Self::NotFound(_) => codes::HX_PACK_NOT_FOUND,
            Self::UnsupportedLanguage(_) => codes::HX_PACK_UNSUPPORTED_LANGUAGE,
            Self::ParseFailed(_) => codes::HX_PACK_PARSE_FAILED,
            Self::GitFailed(_) => codes::HX_PACK_GIT_FAILED,
            Self::Timeout => codes::HX_PACK_TIMEOUT,
            Self::Cancelled => codes::HX_CANCELLED,
            Self::ConfigInvalid(_) => codes::HX_PACK_CONFIG_INVALID,
            Self::Io { .. } => codes::HX_PACK_IO,
        }
    }

    /// Wraps an I/O error, mapping "not found" to [`Error::NotFound`].
    pub(crate) fn from_io(path: &str, source: io::Error) -> Self {
        match source.kind() {
            io::ErrorKind::NotFound => Self::NotFound(path.to_owned()),
            _ => Self::Io {
                path: path.to_owned(),
                source,
            },
        }
    }

    /// The error as `{code, message}`, the shape of the wire error object.
    #[must_use]
    pub fn to_body(&self) -> ErrorBody {
        ErrorBody {
            code: self.code().to_owned(),
            message: self.to_string(),
        }
    }
}

impl From<Error> for AppError {
    fn from(e: Error) -> Self {
        AppError::new(e.code(), e.to_string())
    }
}

/// The `{code, message}` pair a bundle item carries when it fails.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct ErrorBody {
    /// Stable string code, `hx.pack.*`.
    pub code: String,
    /// Human-readable message.
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_the_catalogs_pack_codes_plus_the_shared_cancel() {
        let catalog: Vec<&str> = hx_proto::error::entries()
            .iter()
            .map(|e| e.code.as_str())
            .filter(|c| c.starts_with("hx.pack."))
            .collect();
        let mine: Vec<&str> = Error::ALL_CODES
            .iter()
            .copied()
            .filter(|c| c.starts_with("hx.pack."))
            .collect();
        assert_eq!(catalog, mine);
        assert!(Error::ALL_CODES.contains(&"hx.cancelled"));
        let mut seen = std::collections::BTreeSet::new();
        for code in Error::ALL_CODES {
            assert!(seen.insert(*code), "duplicate {code}");
        }
    }

    #[test]
    fn every_variant_has_a_listed_code() {
        let all = [
            Error::InvalidRequest(String::new()),
            Error::InvalidPattern(String::new()),
            Error::InvalidRoot(String::new()),
            Error::PathEscape(String::new()),
            Error::NotFound(String::new()),
            Error::UnsupportedLanguage(String::new()),
            Error::ParseFailed(String::new()),
            Error::GitFailed(String::new()),
            Error::Timeout,
            Error::Cancelled,
            Error::ConfigInvalid(String::new()),
            Error::Io {
                path: String::new(),
                source: io::Error::other("x"),
            },
        ];
        let codes: Vec<&str> = all.iter().map(Error::code).collect();
        assert_eq!(codes, Error::ALL_CODES);
        assert_eq!(all[3].to_body().code, "hx.pack.path_escape");
    }

    #[test]
    fn missing_files_become_not_found() {
        let e = Error::from_io("a/b", io::Error::from(io::ErrorKind::NotFound));
        assert_eq!(e.code(), "hx.pack.not_found");
        let e = Error::from_io("a/b", io::Error::from(io::ErrorKind::PermissionDenied));
        assert_eq!(e.code(), "hx.pack.io");
    }
}
