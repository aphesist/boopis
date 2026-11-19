//! The sandbox policy: what a child may read, write, reach and consume.
//!
//! These types are wire types (STANDARDS section 8): unknown fields are ignored on read and new
//! fields are optional. The defaults for limits live in [`limits`], in one place.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Defaults and hard ceilings for the numeric limits. Data, not scattered literals.
pub mod limits {
    /// Default wall-clock timeout: two minutes.
    pub const DEFAULT_TIMEOUT_MS: u64 = 120_000;
    /// Largest timeout a policy may ask for: one hour.
    pub const MAX_TIMEOUT_MS: u64 = 3_600_000;
    /// Default per-stream output cap: 1 MiB.
    pub const DEFAULT_OUTPUT_CAP_BYTES: usize = 1 << 20;
    /// Largest per-stream output cap a policy may ask for: 64 MiB.
    pub const MAX_OUTPUT_CAP_BYTES: usize = 64 << 20;
    /// Default grace between the polite kill and the forced kill.
    pub const DEFAULT_KILL_GRACE_MS: u64 = 2_000;
    /// Largest kill grace a policy may ask for.
    pub const MAX_KILL_GRACE_MS: u64 = 60_000;
    /// Default address-space limit per process: 4 GiB.
    pub const DEFAULT_MEMORY_BYTES: u64 = 4 << 30;
    /// Smallest address-space limit a policy may ask for: below this nothing starts.
    pub const MIN_MEMORY_BYTES: u64 = 16 << 20;
    /// Default number of processes the child tree may add.
    pub const DEFAULT_MAX_PROCESSES: u64 = 512;
    /// Default largest file a process may write: 1 GiB.
    pub const DEFAULT_MAX_FILE_BYTES: u64 = 1 << 30;
}

/// CPU time limit for the child tree.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum CpuLimit {
    /// As many CPU seconds as the wall-clock timeout allows, rounded up. A busy multi-threaded
    /// child burns CPU faster than the clock, so this ends it sooner than the timeout would.
    #[default]
    TiedToTimeout,
    /// This many CPU seconds.
    Seconds(u64),
    /// No CPU limit beyond the timeout.
    Unlimited,
}

/// Resource limits, all overridable. `None` means no limit for that resource.
///
/// - Linux and macOS use `setrlimit` in the child (`RLIMIT_AS`, `RLIMIT_NPROC`, `RLIMIT_FSIZE`,
///   `RLIMIT_CPU`, and `RLIMIT_CORE` always 0). macOS does not enforce `RLIMIT_AS`.
/// - Windows uses job-object limits (job memory, active processes, job user time). It has no
///   file-size limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default)]
pub struct ResourceLimits {
    /// Address space (virtual memory) per process on Unix, committed memory of the whole tree
    /// on Windows.
    pub memory_bytes: Option<u64>,
    /// How many processes and threads the child tree may add. Linux counts relative to the
    /// number of tasks already running when the sandbox is built, because `RLIMIT_NPROC` counts
    /// every task of the user.
    pub max_processes: Option<u64>,
    /// The largest file any process in the tree may write or grow to.
    pub max_file_bytes: Option<u64>,
    /// CPU time.
    pub cpu: CpuLimit,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            memory_bytes: Some(limits::DEFAULT_MEMORY_BYTES),
            max_processes: Some(limits::DEFAULT_MAX_PROCESSES),
            max_file_bytes: Some(limits::DEFAULT_MAX_FILE_BYTES),
            cpu: CpuLimit::default(),
        }
    }
}

impl ResourceLimits {
    /// No limits at all (core dumps are still disabled where `setrlimit` exists).
    #[must_use]
    pub fn unlimited() -> Self {
        Self {
            memory_bytes: None,
            max_processes: None,
            max_file_bytes: None,
            cpu: CpuLimit::Unlimited,
        }
    }
}

/// Environment variable names copied from the parent by default. Nothing else is inherited, so
/// API keys and tokens never reach the child unless a caller lists them.
#[cfg(not(windows))]
pub const DEFAULT_ENV_ALLOWLIST: &[&str] = &["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ"];
/// Environment variable names copied from the parent by default (Windows).
#[cfg(windows)]
pub const DEFAULT_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "ComSpec",
    "LANG",
    "TERM",
    "TZ",
];

/// How much network the child gets.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkPolicy {
    /// No network at all (Unix-domain sockets inside the machine still work on Unix).
    #[default]
    Off,
    /// Only the loopback interface.
    Loopback,
    /// Only these hosts. No OS in scope can filter by host name, so this is enforceable only
    /// when every host is a loopback name (it then becomes [`NetworkPolicy::Loopback`]).
    /// Anything else is `unavailable`, or with `degraded.network` falls back to network off.
    /// A real allowlist needs a host-side proxy (see the README).
    Allowlist(Vec<String>),
    /// Unrestricted network.
    On,
}

/// Which dimensions may run with less enforcement than requested, instead of failing with
/// `hx.sandbox.unavailable`. Everything defaults to false: the sandbox fails closed.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(default)]
pub struct Degraded {
    /// Run without filesystem confinement if the platform has none.
    pub fs: bool,
    /// Fall back to **network off** when the requested mode (a host allowlist, or loopback
    /// without the privilege for it) cannot be enforced. Only if even off is impossible does
    /// the run go ahead with an unrestricted network, and the report says so.
    pub network: bool,
    /// Run without the OS-level process-tree guarantee (the timeout and output cap still apply).
    pub process: bool,
}

/// What a sandboxed child may do.
///
/// Paths are absolute. `ro_paths` are readable and executable; `rw_paths` are also writable.
/// Everything not listed is unreadable where the platform can enforce reads (Landlock, Seatbelt,
/// `AppContainer`), so the list must include whatever the program itself needs: the interpreter,
/// its libraries, the workspace. [`SandboxPolicy::system_read_paths`] gives a conservative
/// starting set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SandboxPolicy {
    /// Directories or files the child may read and execute.
    #[serde(default)]
    pub ro_paths: Vec<PathBuf>,
    /// Directories or files the child may also write, create and delete in. A path that is also
    /// in `ro_paths` is treated as writable. A read-only path inside a writable one is rejected
    /// (Landlock cannot subtract a grant).
    #[serde(default)]
    pub rw_paths: Vec<PathBuf>,
    /// Read-only roots of the program's own runtime: the interpreter's prefix and its virtual
    /// environment, when they live outside the system directories (a managed Python under a
    /// user's home). Unlike `ro_paths` they are **vetted**: each must be an existing directory, and
    /// its canonical path (after every symlink) must not be `/`, `$HOME` or a parent of it, the
    /// working directory, a path inside it, or a parent of it. They only ever add read access.
    #[serde(default)]
    pub runtime_ro_paths: Vec<PathBuf>,
    /// Network access.
    #[serde(default)]
    pub network: NetworkPolicy,
    /// Names copied from this process's environment, when set there.
    #[serde(default = "default_env_allowlist")]
    pub env_allowlist: Vec<String>,
    /// Variables set explicitly. These win over the allowlist.
    #[serde(default)]
    pub env_set: BTreeMap<String, String>,
    /// The child's working directory. It must lie inside `ro_paths` or `rw_paths`.
    pub cwd: PathBuf,
    /// Wall-clock limit. On expiry the whole process tree is killed.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    /// The most bytes kept from each of stdout and stderr. The child is never blocked by it:
    /// the excess is read and dropped.
    #[serde(default = "default_output_cap")]
    pub output_cap_bytes: usize,
    /// Time between the polite termination request and the forced kill, in milliseconds.
    #[serde(default = "default_kill_grace_ms")]
    pub kill_grace_ms: u64,
    /// Dimensions that may run degraded.
    #[serde(default)]
    pub degraded: Degraded,
    /// Memory, process, file-size and CPU limits.
    #[serde(default)]
    pub resources: ResourceLimits,
}

fn default_env_allowlist() -> Vec<String> {
    DEFAULT_ENV_ALLOWLIST
        .iter()
        .map(|s| (*s).to_owned())
        .collect()
}
fn default_timeout_ms() -> u64 {
    limits::DEFAULT_TIMEOUT_MS
}
fn default_output_cap() -> usize {
    limits::DEFAULT_OUTPUT_CAP_BYTES
}
fn default_kill_grace_ms() -> u64 {
    limits::DEFAULT_KILL_GRACE_MS
}

impl SandboxPolicy {
    /// A closed policy: no paths, network off, the default environment allowlist, default
    /// limits. Add paths with the `with_*` methods or by assigning the fields.
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self {
            ro_paths: Vec::new(),
            rw_paths: Vec::new(),
            runtime_ro_paths: Vec::new(),
            network: NetworkPolicy::Off,
            env_allowlist: default_env_allowlist(),
            env_set: BTreeMap::new(),
            cwd: cwd.into(),
            timeout_ms: default_timeout_ms(),
            output_cap_bytes: default_output_cap(),
            kill_grace_ms: default_kill_grace_ms(),
            degraded: Degraded::default(),
            resources: ResourceLimits::default(),
        }
    }

    /// Adds read-only paths.
    #[must_use]
    pub fn with_ro(mut self, paths: impl IntoIterator<Item = impl Into<PathBuf>>) -> Self {
        self.ro_paths.extend(paths.into_iter().map(Into::into));
        self
    }

    /// Adds vetted read-only runtime roots (see [`SandboxPolicy::runtime_ro_paths`]).
    #[must_use]
    pub fn with_runtime_ro(mut self, paths: impl IntoIterator<Item = impl Into<PathBuf>>) -> Self {
        self.runtime_ro_paths
            .extend(paths.into_iter().map(Into::into));
        self
    }

    /// Adds writable paths.
    #[must_use]
    pub fn with_rw(mut self, paths: impl IntoIterator<Item = impl Into<PathBuf>>) -> Self {
        self.rw_paths.extend(paths.into_iter().map(Into::into));
        self
    }

    /// Sets the network mode.
    #[must_use]
    pub fn with_network(mut self, network: NetworkPolicy) -> Self {
        self.network = network;
        self
    }

    /// Sets one environment variable in the child.
    #[must_use]
    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env_set.insert(key.into(), value.into());
        self
    }

    /// The system directories a typical program needs to start (libraries, interpreters,
    /// certificates), limited to the ones that exist on this machine. A convenience for
    /// building `ro_paths`; it is never applied implicitly.
    #[must_use]
    pub fn system_read_paths() -> Vec<PathBuf> {
        crate::defaults::system_read_paths()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_json_gets_safe_defaults() {
        let p: SandboxPolicy = serde_json::from_str(r#"{"cwd": "/work"}"#).unwrap();
        assert_eq!(p.network, NetworkPolicy::Off);
        assert!(p.ro_paths.is_empty() && p.rw_paths.is_empty());
        assert_eq!(p.timeout_ms, limits::DEFAULT_TIMEOUT_MS);
        assert_eq!(p.output_cap_bytes, limits::DEFAULT_OUTPUT_CAP_BYTES);
        assert_eq!(p.degraded, Degraded::default());
        assert!(p.env_allowlist.iter().any(|n| n == "PATH"));
        assert!(
            !p.env_allowlist
                .iter()
                .any(|n| n.contains("KEY") || n.contains("TOKEN"))
        );
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let p: SandboxPolicy =
            serde_json::from_str(r#"{"cwd": "/w", "future_field": {"a": 1}}"#).unwrap();
        assert_eq!(p.cwd, PathBuf::from("/w"));
    }

    #[test]
    fn network_modes_round_trip() {
        for (json, want) in [
            (r#""off""#, NetworkPolicy::Off),
            (r#""loopback""#, NetworkPolicy::Loopback),
            (r#""on""#, NetworkPolicy::On),
            (
                r#"{"allowlist":["pypi.org"]}"#,
                NetworkPolicy::Allowlist(vec!["pypi.org".into()]),
            ),
        ] {
            let got: NetworkPolicy = serde_json::from_str(json).unwrap();
            assert_eq!(got, want);
            assert_eq!(serde_json::to_string(&got).unwrap(), json);
        }
    }
}
