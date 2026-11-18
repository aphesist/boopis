//! What a run produced and what the sandbox actually enforced.

use serde::{Deserialize, Serialize};

/// How a child ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExitOutcome {
    /// The process exited by itself with this status code.
    Exited {
        /// The exit status.
        code: i32,
    },
    /// The process was ended by a signal (Unix only).
    Signaled {
        /// The signal number.
        signal: i32,
    },
    /// The timeout fired and the sandbox killed the process tree.
    TimedOut,
    /// The process never started: the program was not found or could not be executed. The
    /// sandbox itself was fine, otherwise the call returns an [`crate::Error`] instead.
    SpawnFailed {
        /// Why, from the OS.
        reason: String,
    },
}

/// One captured output stream.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Captured {
    /// The first `output_cap_bytes` bytes, decoded as UTF-8 with replacement characters.
    pub text: String,
    /// More output was produced than the cap, and the rest was discarded.
    pub truncated: bool,
    /// How many bytes the child wrote in total, counting the discarded ones.
    pub total_bytes: u64,
}

/// The result of [`crate::run`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct RunResult {
    /// How the child ended.
    pub exit: ExitOutcome,
    /// Captured standard output.
    pub stdout: Captured,
    /// Captured standard error.
    pub stderr: Captured,
    /// Wall-clock time from spawn to exit, in milliseconds.
    pub duration_ms: u64,
    /// What was enforced. When `exit` is `spawn_failed`, this is what was applied up to the
    /// point the program failed to start.
    pub enforcement: Enforcement,
}

/// Whether a dimension was held, loosened with permission, or not restricted by request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Everything requested for this dimension is enforced by `mechanisms`.
    Enforced,
    /// The platform cannot enforce what was requested, the policy allowed degrading, and the
    /// run went ahead with less. `detail` says what is missing.
    Degraded,
    /// The policy asked for no restriction in this dimension (for example `network: on`).
    Unrestricted,
}

/// The enforcement of one dimension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DimensionReport {
    /// Whether the dimension is held.
    pub status: Status,
    /// The OS mechanisms that hold it, such as `landlock` or `appcontainer`.
    pub mechanisms: Vec<String>,
    /// What the mechanisms cover, what they miss, versions and ABIs.
    pub detail: Option<String>,
}

impl DimensionReport {
    pub(crate) fn enforced(mechanisms: &[&str], detail: impl Into<String>) -> Self {
        Self {
            status: Status::Enforced,
            mechanisms: mechanisms.iter().map(|m| (*m).to_owned()).collect(),
            detail: Some(detail.into()),
        }
    }

    pub(crate) fn degraded(mechanisms: &[&str], detail: impl Into<String>) -> Self {
        Self {
            status: Status::Degraded,
            ..Self::enforced(mechanisms, detail)
        }
    }

    pub(crate) fn unrestricted(detail: impl Into<String>) -> Self {
        Self {
            status: Status::Unrestricted,
            mechanisms: Vec::new(),
            detail: Some(detail.into()),
        }
    }
}

/// What the sandbox enforced, per dimension, and by which mechanism. Built from what the setup
/// code actually applied, never from the policy alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Enforcement {
    /// The platform backend: `linux`, `macos`, `windows` or `unsupported`.
    pub platform: String,
    /// Filesystem confinement.
    pub fs: DimensionReport,
    /// Network access.
    pub network: DimensionReport,
    /// Environment filtering: the child sees the allowlist and `env_set` only.
    pub env: DimensionReport,
    /// Process limits: timeout, output cap and killing the whole process tree.
    pub process: DimensionReport,
}

impl Enforcement {
    /// Whether any dimension ran degraded.
    #[must_use]
    pub fn is_degraded(&self) -> bool {
        [&self.fs, &self.network, &self.env, &self.process]
            .iter()
            .any(|d| d.status == Status::Degraded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_outcome_is_tagged() {
        let json = serde_json::to_value(ExitOutcome::Exited { code: 3 }).unwrap();
        assert_eq!(json, serde_json::json!({"kind": "exited", "code": 3}));
        let json = serde_json::to_value(ExitOutcome::TimedOut).unwrap();
        assert_eq!(json, serde_json::json!({"kind": "timed_out"}));
    }

    #[test]
    fn degraded_is_detected() {
        let ok = DimensionReport::enforced(&["x"], "d");
        let bad = DimensionReport::degraded(&[], "d");
        let mk = |fs| Enforcement {
            platform: "t".into(),
            fs,
            network: DimensionReport::unrestricted("on"),
            env: ok.clone(),
            process: ok.clone(),
        };
        assert!(!mk(ok.clone()).is_degraded());
        assert!(mk(bad).is_degraded());
    }
}
