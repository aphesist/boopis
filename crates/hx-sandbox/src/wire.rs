//! The `sandbox.*` method types, as the dispatcher serves them (PROTOCOL section 4).
//!
//! Wire types ignore unknown fields on read (STANDARDS section 8) and carry JSON Schemas for the
//! generated contract. The functions that implement the methods are [`crate::run`] and
//! [`crate::capabilities`]; [`SandboxRunParams::into_policy`] turns the wire shape into a
//! [`SandboxPolicy`].

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::policy::{CpuLimit, Degraded, NetworkPolicy, ResourceLimits, SandboxPolicy, limits};

/// The method name of [`SandboxRunParams`] / [`SandboxRunResult`].
pub const METHOD_RUN: &str = "sandbox.run";
/// The method name for [`crate::Capabilities`]: no params, `Capabilities` result.
pub const METHOD_CAPABILITIES: &str = "sandbox.capabilities";

/// Named network modes for [`Net`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetMode {
    /// No network.
    Off,
    /// Loopback only.
    Loopback,
    /// Unrestricted.
    On,
}

/// The `net` parameter: `false` (off), `true` (unrestricted), `"loopback"`, or a list of hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum Net {
    /// `false` is off, `true` is unrestricted.
    Flag(bool),
    /// A named mode.
    Mode(NetMode),
    /// An allowlist of hosts. Only loopback names can be enforced; see
    /// [`NetworkPolicy::Allowlist`].
    Hosts(Vec<String>),
}

impl Default for Net {
    fn default() -> Self {
        Net::Flag(false)
    }
}

impl From<Net> for NetworkPolicy {
    fn from(net: Net) -> Self {
        match net {
            Net::Flag(false) | Net::Mode(NetMode::Off) => NetworkPolicy::Off,
            Net::Flag(true) | Net::Mode(NetMode::On) => NetworkPolicy::On,
            Net::Mode(NetMode::Loopback) => NetworkPolicy::Loopback,
            Net::Hosts(hosts) => NetworkPolicy::Allowlist(hosts),
        }
    }
}

/// Params of `sandbox.run`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxRunParams {
    /// The program and its arguments. Never a shell string.
    pub argv: Vec<String>,
    /// Working directory; must lie inside `ro` or `rw`.
    pub cwd: PathBuf,
    /// Readable and executable paths.
    #[serde(default)]
    pub ro: Vec<PathBuf>,
    /// Readable, writable and executable paths.
    #[serde(default)]
    pub rw: Vec<PathBuf>,
    /// Network mode. Default: off.
    #[serde(default)]
    pub net: Net,
    /// Variables to set in the child, on top of the allowlisted ones.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Names to copy from the host environment. Default: `PATH`, locale and terminal names only.
    #[serde(default)]
    pub env_allowlist: Option<Vec<String>>,
    /// Wall-clock limit in milliseconds. Default: two minutes.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Per-stream output cap in bytes. Default: 1 MiB.
    #[serde(default)]
    pub output_cap: Option<usize>,
    /// Grace between the polite and the forced kill. Default: two seconds.
    #[serde(default)]
    pub kill_grace_ms: Option<u64>,
    /// Dimensions that may run degraded instead of failing with `hx.sandbox.unavailable`. A
    /// degraded network is network **off**.
    #[serde(default)]
    pub degraded: Degraded,
    /// Memory limit in bytes. Default 4 GiB; send `0` for no limit.
    #[serde(default)]
    pub memory_bytes: Option<u64>,
    /// Processes the tree may add. Default 512; send `0` for no limit.
    #[serde(default)]
    pub max_processes: Option<u64>,
    /// Largest file a process may write, in bytes. Default 1 GiB; send `0` for no limit.
    #[serde(default)]
    pub max_file_bytes: Option<u64>,
    /// CPU seconds. Default: as many as the timeout; send `0` for no limit.
    #[serde(default)]
    pub cpu_seconds: Option<u64>,
}

impl SandboxRunParams {
    /// Splits the request into the argv and the policy for [`crate::run`].
    #[must_use]
    pub fn into_policy(self) -> (Vec<String>, SandboxPolicy) {
        let mut policy = SandboxPolicy::new(self.cwd)
            .with_ro(self.ro)
            .with_rw(self.rw)
            .with_network(self.net.into());
        policy.env_set = self.env;
        if let Some(allow) = self.env_allowlist {
            policy.env_allowlist = allow;
        }
        policy.timeout_ms = self.timeout_ms.unwrap_or(limits::DEFAULT_TIMEOUT_MS);
        policy.output_cap_bytes = self.output_cap.unwrap_or(limits::DEFAULT_OUTPUT_CAP_BYTES);
        policy.kill_grace_ms = self.kill_grace_ms.unwrap_or(limits::DEFAULT_KILL_GRACE_MS);
        policy.degraded = self.degraded;
        // A value overrides the default; 0 turns that limit off.
        let over = |given: Option<u64>, default: Option<u64>| match given {
            None => default,
            Some(0) => None,
            Some(n) => Some(n),
        };
        let defaults = ResourceLimits::default();
        policy.resources = ResourceLimits {
            memory_bytes: over(self.memory_bytes, defaults.memory_bytes),
            max_processes: over(self.max_processes, defaults.max_processes),
            max_file_bytes: over(self.max_file_bytes, defaults.max_file_bytes),
            cpu: match self.cpu_seconds {
                None => CpuLimit::TiedToTimeout,
                Some(0) => CpuLimit::Unlimited,
                Some(n) => CpuLimit::Seconds(n),
            },
        };
        (self.argv, policy)
    }
}

/// Result of `sandbox.run`: a tool outcome. A non-zero exit is still a successful call.
pub type SandboxRunResult = crate::report::RunResult;

/// The JSON Schemas of the `sandbox.*` methods, for the generated contract:
/// `{"sandbox.run": {"params": .., "result": ..}, "sandbox.capabilities": {"result": ..}}`.
#[must_use]
pub fn json_schemas() -> serde_json::Value {
    let schema = |s: schemars::Schema| serde_json::to_value(s).unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        METHOD_RUN: {
            "params": schema(schemars::schema_for!(SandboxRunParams)),
            "result": schema(schemars::schema_for!(SandboxRunResult)),
        },
        METHOD_CAPABILITIES: {
            "result": schema(schemars::schema_for!(crate::Capabilities)),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn net_accepts_every_documented_shape() {
        for (json, want) in [
            ("false", NetworkPolicy::Off),
            ("true", NetworkPolicy::On),
            (r#""loopback""#, NetworkPolicy::Loopback),
            (r#""off""#, NetworkPolicy::Off),
            (
                r#"["pypi.org"]"#,
                NetworkPolicy::Allowlist(vec!["pypi.org".into()]),
            ),
        ] {
            let net: Net = serde_json::from_str(json).unwrap();
            assert_eq!(NetworkPolicy::from(net), want, "{json}");
        }
    }

    #[test]
    fn schemas_describe_the_documented_fields() {
        let schemas = json_schemas();
        let params = &schemas[METHOD_RUN]["params"]["properties"];
        for field in [
            "argv",
            "cwd",
            "ro",
            "rw",
            "net",
            "env",
            "timeout_ms",
            "output_cap",
            "degraded",
        ] {
            assert!(params.get(field).is_some(), "params schema lacks {field}");
        }
        let result = &schemas[METHOD_RUN]["result"]["properties"];
        for field in ["exit", "stdout", "stderr", "duration_ms", "enforcement"] {
            assert!(result.get(field).is_some(), "result schema lacks {field}");
        }
        assert!(
            schemas[METHOD_CAPABILITIES]["result"]["properties"]
                .get("fs")
                .is_some()
        );
    }

    #[test]
    fn run_params_map_to_a_closed_policy() {
        let p: SandboxRunParams = serde_json::from_value(serde_json::json!({
            "argv": ["pytest", "-q"],
            "cwd": "/work",
            "ro": ["/work"],
            "rw": ["/scratch"],
            "env": {"CI": "1"},
            "unknown_future_field": true
        }))
        .unwrap();
        let (argv, policy) = p.into_policy();
        assert_eq!(argv, ["pytest", "-q"]);
        assert_eq!(policy.network, NetworkPolicy::Off);
        assert_eq!(policy.env_set["CI"], "1");
        assert_eq!(policy.timeout_ms, limits::DEFAULT_TIMEOUT_MS);
        assert!(policy.env_allowlist.contains(&"PATH".to_owned()));
        assert_eq!(policy.degraded, Degraded::default());
        assert_eq!(policy.resources, ResourceLimits::default());
    }

    #[test]
    fn resource_overrides_and_zero_meaning_unlimited() {
        let p: SandboxRunParams = serde_json::from_value(serde_json::json!({
            "argv": ["x"], "cwd": "/w", "memory_bytes": 0, "max_processes": 9, "cpu_seconds": 30
        }))
        .unwrap();
        let (_, policy) = p.into_policy();
        assert_eq!(policy.resources.memory_bytes, None);
        assert_eq!(policy.resources.max_processes, Some(9));
        assert_eq!(
            policy.resources.max_file_bytes,
            Some(limits::DEFAULT_MAX_FILE_BYTES)
        );
        assert_eq!(policy.resources.cpu, CpuLimit::Seconds(30));
    }
}
