//! The crate's one error type.
//!
//! Failures here are *infrastructure* failures (STANDARDS section 3): the sandbox could not be
//! built or could not hold. A command that ran and failed, timed out or was never found is a
//! *tool outcome* and travels in [`crate::RunResult`] instead.

use serde::{Deserialize, Serialize};

/// Result alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Stable wire code: the platform cannot enforce a requested dimension.
pub const CODE_UNAVAILABLE: &str = "hx.sandbox.unavailable";
/// Stable wire code: the sandbox was built but refused or could not complete the request.
pub const CODE_DENIED: &str = "hx.sandbox.denied";
/// Stable wire code: a long-lived child could not be started (`spawn`).
pub const CODE_SPAWN_FAILED: &str = "hx.sandbox.spawn_failed";
/// Stable wire code: the policy is malformed (the dispatcher maps it to `hx.invalid_params`).
pub const CODE_INVALID_POLICY: &str = "hx.invalid_params";

/// A policy dimension, for error reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Dimension {
    /// Filesystem confinement (`ro_paths`, `rw_paths`).
    Fs,
    /// Network access.
    Network,
    /// Environment filtering.
    Env,
    /// Process limits: timeout, output cap, process-tree kill.
    Process,
}

impl Dimension {
    /// The lowercase name used on the wire and in messages.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Dimension::Fs => "fs",
            Dimension::Network => "network",
            Dimension::Env => "env",
            Dimension::Process => "process",
        }
    }
}

impl std::fmt::Display for Dimension {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Everything this crate can fail with.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The platform cannot enforce a requested dimension and the policy did not allow
    /// degrading it. Nothing was run.
    #[error("sandbox unavailable: cannot enforce {dimension}: {reason}")]
    Unavailable {
        /// The dimension that cannot be enforced.
        dimension: Dimension,
        /// Why, with the mechanism that was tried and what the host offers.
        reason: String,
    },
    /// The policy is malformed or unsafe to apply (relative path, missing path, a read-only path
    /// inside a writable tree, an empty argv, and so on). Nothing was run.
    #[error("invalid sandbox policy: {0}")]
    InvalidPolicy(String),
    /// The OS refused while the sandbox was being built or applied. The command did not run,
    /// because running it without the sandbox would be unsafe.
    #[error("sandbox setup failed at {step}: {source}")]
    Setup {
        /// The setup step that failed, for example `landlock_restrict_self`.
        step: String,
        /// The OS error.
        #[source]
        source: std::io::Error,
    },
    /// [`crate::spawn`] could not start the program (not found, not executable). [`crate::run`]
    /// reports the same condition as `ExitOutcome::SpawnFailed` instead.
    #[error("could not start the program: {0}")]
    Spawn(String),
    /// An I/O failure outside setup (pipes, waiting, reading output).
    #[error("sandbox i/o: {0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// The stable string code for the wire (`data.code`).
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Error::Unavailable { .. } => CODE_UNAVAILABLE,
            Error::InvalidPolicy(_) => CODE_INVALID_POLICY,
            Error::Spawn(_) => CODE_SPAWN_FAILED,
            Error::Setup { .. } | Error::Io(_) => CODE_DENIED,
        }
    }

    /// Structured details for `data`, when there are any.
    #[must_use]
    pub fn data(&self) -> Option<serde_json::Value> {
        match self {
            Error::Unavailable { dimension, reason } => {
                Some(serde_json::json!({"dimension": dimension, "reason": reason}))
            }
            Error::Setup { step, source } => {
                Some(serde_json::json!({"step": step, "os_error": source.to_string()}))
            }
            Error::InvalidPolicy(_) | Error::Spawn(_) | Error::Io(_) => None,
        }
    }

    pub(crate) fn unavailable(dimension: Dimension, reason: impl Into<String>) -> Self {
        Error::Unavailable {
            dimension,
            reason: reason.into(),
        }
    }

    pub(crate) fn invalid(reason: impl Into<String>) -> Self {
        Error::InvalidPolicy(reason.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_the_documented_strings() {
        let e = Error::unavailable(Dimension::Fs, "no landlock");
        assert_eq!(e.code(), "hx.sandbox.unavailable");
        assert_eq!(e.data().unwrap()["dimension"], "fs");
        assert_eq!(Error::invalid("x").code(), "hx.invalid_params");
        let s = Error::Setup {
            step: "seccomp".into(),
            source: std::io::Error::from_raw_os_error(1),
        };
        assert_eq!(s.code(), "hx.sandbox.denied");
        assert_eq!(s.data().unwrap()["step"], "seccomp");
    }
}
