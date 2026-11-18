//! The one error type of this crate.
//!
//! Every variant maps to a stable string code in the `hx.pack.*` namespace
//! ([`Error::code`]). The listing lives in `error_codes.json` for
//! `crates/hx-proto/errors.json`, and a test keeps the two in step.
//!
//! Tool *outcomes* are not errors: a file that was withheld, a binary file or
//! a symbol that matched nothing are fields of a successful result
//! (`docs/STANDARDS.md` section 3).

use std::io;

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
    /// Every code this crate can produce, in the order of `error_codes.json`.
    pub const ALL_CODES: &'static [&'static str] = &[
        "hx.pack.invalid_request",
        "hx.pack.invalid_pattern",
        "hx.pack.invalid_root",
        "hx.pack.path_escape",
        "hx.pack.not_found",
        "hx.pack.unsupported_language",
        "hx.pack.parse_failed",
        "hx.pack.git_failed",
        "hx.pack.timeout",
        "hx.pack.cancelled",
        "hx.pack.config_invalid",
        "hx.pack.io",
    ];

    /// The stable wire code, `hx.pack.<snake_case>`.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "hx.pack.invalid_request",
            Self::InvalidPattern(_) => "hx.pack.invalid_pattern",
            Self::InvalidRoot(_) => "hx.pack.invalid_root",
            Self::PathEscape(_) => "hx.pack.path_escape",
            Self::NotFound(_) => "hx.pack.not_found",
            Self::UnsupportedLanguage(_) => "hx.pack.unsupported_language",
            Self::ParseFailed(_) => "hx.pack.parse_failed",
            Self::GitFailed(_) => "hx.pack.git_failed",
            Self::Timeout => "hx.pack.timeout",
            Self::Cancelled => "hx.pack.cancelled",
            Self::ConfigInvalid(_) => "hx.pack.config_invalid",
            Self::Io { .. } => "hx.pack.io",
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
    fn codes_are_namespaced_unique_and_match_the_shared_listing() {
        let listing: serde_json::Value =
            serde_json::from_str(include_str!("../error_codes.json")).unwrap();
        let listed: Vec<&str> = listing["codes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["code"].as_str().unwrap())
            .collect();
        assert_eq!(listed, Error::ALL_CODES);
        let mut seen = std::collections::BTreeSet::new();
        for code in Error::ALL_CODES {
            assert!(code.starts_with("hx.pack."), "{code}");
            assert!(
                code[8..]
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{code}"
            );
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
