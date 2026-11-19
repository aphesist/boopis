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
/// Starts a long-lived sandboxed child (the exec kernel): [`SandboxSpawnParams`] to
/// [`SandboxSpawnResult`].
pub const METHOD_SPAWN: &str = "sandbox.spawn";
/// Waits for a spawned child: [`SandboxWaitParams`] to [`SandboxWaitResult`].
pub const METHOD_WAIT: &str = "sandbox.wait";
/// Kills a spawned child's process tree: [`SandboxKillParams`] to [`SandboxKillResult`].
pub const METHOD_KILL: &str = "sandbox.kill";

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
    /// Also grant `ro` the platform's own system read paths ([`SandboxPolicy::system_read_paths`]:
    /// the libraries and the few small files under `/etc` a program needs), so a caller need not
    /// copy that list. Default: false.
    #[serde(default)]
    pub system_read: bool,
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
        let mut ro = self.ro;
        if self.system_read {
            for path in SandboxPolicy::system_read_paths() {
                if !ro.contains(&path) {
                    ro.push(path);
                }
            }
        }
        let mut policy = SandboxPolicy::new(self.cwd)
            .with_ro(ro)
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

/// Default environment variable that tells the child which descriptor is its channel.
pub const DEFAULT_CHANNEL_ENV: &str = "HX_CHANNEL_FD";
/// Default time the host waits for the plugin to connect to the channel socket.
pub const DEFAULT_CHANNEL_ACCEPT_MS: u64 = 60_000;

/// Asks `sandbox.spawn` for a private channel between the plugin and the child.
///
/// `hx` creates a connected socket pair, gives the child one end under a descriptor number it
/// learns from the environment variable `env`, binds a Unix socket in a private directory
/// (mode 0700, the socket 0600), and bridges the first connection to it onto the other end.
/// The child needs no network and no path access to use it, so it works with `net: false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ChannelRequest {
    /// Name of the environment variable that receives the descriptor number in the child.
    #[serde(default = "default_channel_env")]
    pub env: String,
    /// A directory for the socket. Created with mode 0700 if missing; default: a fresh one
    /// under the system temporary directory.
    #[serde(default)]
    pub dir: Option<PathBuf>,
    /// How long to wait for the plugin to connect before closing the child's end.
    #[serde(default)]
    pub accept_timeout_ms: Option<u64>,
}

fn default_channel_env() -> String {
    DEFAULT_CHANNEL_ENV.to_owned()
}

/// Params of `sandbox.spawn`: everything `sandbox.run` takes, plus the channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxSpawnParams {
    /// The same fields as `sandbox.run`. `timeout_ms` is the child's maximum lifetime.
    #[serde(flatten)]
    pub run: SandboxRunParams,
    /// Ask for a private channel to the child. Unix only for now.
    #[serde(default)]
    pub channel: Option<ChannelRequest>,
}

/// Where the plugin connects to reach the child's channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ChannelInfo {
    /// `unix_socket`.
    pub kind: String,
    /// The socket path. Connect once; the first connection is bridged to the child and the
    /// socket is removed.
    pub path: String,
    /// The environment variable the child reads its descriptor number from.
    pub env: String,
    /// The descriptor number the child sees.
    pub fd: i32,
}

/// Result of `sandbox.spawn`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxSpawnResult {
    /// Opaque id (`UUIDv7`) for `sandbox.wait` and `sandbox.kill`.
    pub handle: String,
    /// The child's process id.
    pub pid: u32,
    /// What was enforced.
    pub enforcement: crate::report::Enforcement,
    /// The channel, when one was requested.
    pub channel: Option<ChannelInfo>,
}

/// Params of `sandbox.wait`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxWaitParams {
    /// From `sandbox.spawn`.
    pub handle: String,
    /// How long to wait for the exit. `0` (the default) polls: it returns at once.
    #[serde(default)]
    pub timeout_ms: u64,
}

/// Result of `sandbox.wait`. While the child runs, `running` is true and the output is what it
/// has written so far (each stream capped). After the exit the handle is gone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxWaitResult {
    /// Whether the child is still running.
    pub running: bool,
    /// How it ended, once it has.
    pub exit: Option<crate::report::ExitOutcome>,
    /// Standard output so far.
    pub stdout: crate::report::Captured,
    /// Standard error so far.
    pub stderr: crate::report::Captured,
    /// Milliseconds since `sandbox.spawn`.
    pub duration_ms: u64,
}

/// Params of `sandbox.kill`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxKillParams {
    /// From `sandbox.spawn`.
    pub handle: String,
}

/// Result of `sandbox.kill`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxKillResult {
    /// The kill was sent. Call `sandbox.wait` to collect the exit.
    pub killed: bool,
}

/// `error.data` of `hx.sandbox.unavailable`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct UnavailableData {
    /// The dimension that cannot be enforced.
    pub dimension: crate::error::Dimension,
    /// Why.
    pub reason: String,
}

/// `error.data` of `hx.sandbox.denied`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DeniedData {
    /// The setup step that failed.
    pub step: String,
    /// The OS error.
    pub os_error: String,
}

/// Adds the `sandbox.*` methods and error data types to the `hx-v1` schema.
pub fn add_schema(b: &mut hx_proto::schema::SchemaBuilder) {
    b.method::<SandboxRunParams, SandboxRunResult>(METHOD_RUN);
    b.method_without_params::<crate::Capabilities>(METHOD_CAPABILITIES);
    b.method::<SandboxSpawnParams, SandboxSpawnResult>(METHOD_SPAWN);
    b.method::<SandboxWaitParams, SandboxWaitResult>(METHOD_WAIT);
    b.method::<SandboxKillParams, SandboxKillResult>(METHOD_KILL);
    b.error_data::<UnavailableData>(hx_proto::codes::HX_SANDBOX_UNAVAILABLE);
    b.error_data::<DeniedData>(hx_proto::codes::HX_SANDBOX_DENIED);
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
    fn system_read_adds_the_platform_paths_once() {
        let params: SandboxRunParams = serde_json::from_str(
            r#"{"argv": ["true"], "cwd": "/usr", "ro": ["/usr"], "system_read": true}"#,
        )
        .unwrap();
        let (_, policy) = params.into_policy();
        let system = SandboxPolicy::system_read_paths();
        for path in &system {
            assert_eq!(
                policy.ro_paths.iter().filter(|p| *p == path).count(),
                1,
                "{path:?}"
            );
        }
        let plain: SandboxRunParams =
            serde_json::from_str(r#"{"argv": ["true"], "cwd": "/tmp", "ro": ["/tmp"]}"#).unwrap();
        assert_eq!(plain.into_policy().1.ro_paths.len(), 1, "off unless asked");
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
