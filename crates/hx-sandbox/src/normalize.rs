//! Turning a [`SandboxPolicy`] into something safe to apply: absolute, canonical, de-duplicated
//! paths, a validated network mode, a computed child environment, validated limits.
//!
//! Everything here is pure policy logic over the file system's *current* state. Platform
//! backends consume only the resolved form, so a path is canonicalised exactly once and the
//! sandbox grants exactly the object that was checked.

use std::ffi::{OsStr, OsString};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::{Error, Result};
use crate::policy::{CpuLimit, Degraded, NetworkPolicy, ResourceLimits, SandboxPolicy, limits};

/// One policy path after resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPath {
    /// The path as the policy spelled it.
    pub requested: PathBuf,
    /// The canonical path: absolute, no `.` or `..`, no symlink components. This is what the
    /// platform sandbox grants.
    pub path: PathBuf,
    /// Whether it is a directory (grants on a directory cover everything beneath it).
    pub is_dir: bool,
}

/// A validated, canonicalised policy, ready for a platform backend.
#[derive(Debug, Clone)]
pub struct ResolvedPolicy {
    /// Read-only grants, without anything already covered by another grant.
    pub ro: Vec<ResolvedPath>,
    /// Read-write grants, without anything already covered by another read-write grant.
    pub rw: Vec<ResolvedPath>,
    /// The network mode after normalisation (an allowlist of loopback names is `Loopback`, an
    /// empty allowlist is `Off`).
    pub network: NetworkPolicy,
    /// The child's whole environment, in the order it will be set.
    pub env: Vec<(OsString, OsString)>,
    /// The canonical working directory.
    pub cwd: PathBuf,
    /// Wall-clock limit.
    pub timeout: Duration,
    /// Per-stream output cap in bytes.
    pub output_cap: usize,
    /// Grace between the polite and the forced kill.
    pub kill_grace: Duration,
    /// Which dimensions may degrade.
    pub degraded: Degraded,
    /// Resource limits with the CPU limit worked out.
    pub resources: ResolvedLimits,
}

/// [`ResourceLimits`] with the CPU limit turned into seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ResolvedLimits {
    /// Address space (Unix) or tree memory (Windows), in bytes.
    pub memory_bytes: Option<u64>,
    /// Processes and threads the tree may add.
    pub max_processes: Option<u64>,
    /// Largest file a process may write.
    pub max_file_bytes: Option<u64>,
    /// CPU seconds.
    pub cpu_seconds: Option<u64>,
}

fn resolve_limits(r: &ResourceLimits, timeout_ms: u64) -> Result<ResolvedLimits> {
    if let Some(m) = r.memory_bytes
        && m < limits::MIN_MEMORY_BYTES
    {
        return Err(Error::invalid(format!(
            "memory_bytes must be at least {} (below that nothing can start)",
            limits::MIN_MEMORY_BYTES
        )));
    }
    if r.max_processes == Some(0) || r.max_file_bytes == Some(0) {
        return Err(Error::invalid(
            "max_processes and max_file_bytes must be at least 1",
        ));
    }
    let cpu_seconds = match r.cpu {
        CpuLimit::TiedToTimeout => Some(timeout_ms.div_ceil(1000).max(1)),
        CpuLimit::Seconds(0) => return Err(Error::invalid("cpu seconds must be at least 1")),
        CpuLimit::Seconds(s) => Some(s),
        CpuLimit::Unlimited => None,
    };
    Ok(ResolvedLimits {
        memory_bytes: r.memory_bytes,
        max_processes: r.max_processes,
        max_file_bytes: r.max_file_bytes,
        cpu_seconds,
    })
}

impl ResolvedPolicy {
    /// Checks that every read-write grant lies inside one of `roots`, after symlink
    /// resolution of both sides. Use it to prove that a policy built from untrusted pieces
    /// (for instance a scratch directory that an agent could have replaced with a symlink)
    /// cannot write anywhere else.
    pub fn ensure_rw_within(&self, roots: &[PathBuf]) -> Result<()> {
        let roots: Vec<PathBuf> = roots
            .iter()
            .map(|r| canonicalize(r))
            .collect::<Result<_>>()?;
        for grant in &self.rw {
            if !roots.iter().any(|root| grant.path.starts_with(root)) {
                return Err(Error::invalid(format!(
                    "writable path {} (from {}) resolves outside the allowed roots",
                    grant.path.display(),
                    grant.requested.display()
                )));
            }
        }
        Ok(())
    }

    /// Whether `path` (canonical) is covered by a read-write grant.
    #[must_use]
    pub fn is_writable(&self, path: &Path) -> bool {
        self.rw.iter().any(|g| path.starts_with(&g.path))
    }
}

impl SandboxPolicy {
    /// Validates and canonicalises the policy against the file system and this process's
    /// environment.
    pub fn resolve(&self) -> Result<ResolvedPolicy> {
        self.resolve_with_env(&|name| std::env::var_os(name))
    }

    /// Like [`SandboxPolicy::resolve`], reading parent environment variables through `lookup`.
    /// Tests use it to avoid touching the real environment.
    pub fn resolve_with_env(
        &self,
        lookup: &dyn Fn(&OsStr) -> Option<OsString>,
    ) -> Result<ResolvedPolicy> {
        check_limits(self)?;
        let cwd = canonicalize(&self.cwd)?;
        let home = lookup(OsStr::new("HOME")).and_then(|h| std::fs::canonicalize(h).ok());
        let mut ro_given = self
            .ro_paths
            .iter()
            .map(|p| resolve_path(p))
            .collect::<Result<Vec<_>>>()?;
        for root in &self.runtime_ro_paths {
            ro_given.push(resolve_runtime_root(root, &cwd, home.as_deref())?);
        }
        let writable_given = self
            .rw_paths
            .iter()
            .map(|p| resolve_path(p))
            .collect::<Result<Vec<_>>>()?;

        for rw in &writable_given {
            if rw.path.parent().is_none() {
                return Err(Error::invalid(
                    "the file system root cannot be a writable path".to_owned(),
                ));
            }
        }
        let (ro, rw) = prune(ro_given.clone(), writable_given.clone())?;

        if !cwd.is_dir() {
            return Err(Error::invalid(format!(
                "cwd {} is not a directory",
                cwd.display()
            )));
        }
        if !ro_given
            .iter()
            .chain(&writable_given)
            .any(|g| cwd.starts_with(&g.path))
        {
            return Err(Error::invalid(format!(
                "cwd {} is not inside any ro_paths or rw_paths entry",
                cwd.display()
            )));
        }

        Ok(ResolvedPolicy {
            ro,
            rw,
            network: normalize_network(&self.network)?,
            env: build_env(&self.env_allowlist, &self.env_set, lookup)?,
            cwd,
            timeout: Duration::from_millis(self.timeout_ms),
            output_cap: self.output_cap_bytes,
            kill_grace: Duration::from_millis(self.kill_grace_ms),
            degraded: self.degraded,
            resources: resolve_limits(&self.resources, self.timeout_ms)?,
        })
    }
}

fn check_limits(p: &SandboxPolicy) -> Result<()> {
    if p.timeout_ms == 0 || p.timeout_ms > limits::MAX_TIMEOUT_MS {
        return Err(Error::invalid(format!(
            "timeout_ms must be 1..={}",
            limits::MAX_TIMEOUT_MS
        )));
    }
    if p.output_cap_bytes == 0 || p.output_cap_bytes > limits::MAX_OUTPUT_CAP_BYTES {
        return Err(Error::invalid(format!(
            "output_cap_bytes must be 1..={}",
            limits::MAX_OUTPUT_CAP_BYTES
        )));
    }
    if p.kill_grace_ms > limits::MAX_KILL_GRACE_MS {
        return Err(Error::invalid(format!(
            "kill_grace_ms must be at most {}",
            limits::MAX_KILL_GRACE_MS
        )));
    }
    Ok(())
}

/// Canonicalises `path`, which must be absolute and must exist.
pub(crate) fn canonicalize(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err(Error::invalid(format!(
            "path {} is not absolute; a relative path would depend on the host's working directory",
            path.display()
        )));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| Error::invalid(format!("path {} cannot be resolved: {e}", path.display())))?;
    #[cfg(windows)]
    let canonical = simplify_verbatim(&canonical);
    Ok(canonical)
}

fn resolve_path(requested: &Path) -> Result<ResolvedPath> {
    let path = canonicalize(requested)?;
    let is_dir = path.is_dir();
    Ok(ResolvedPath {
        requested: requested.to_path_buf(),
        path,
        is_dir,
    })
}

/// Vets one runtime root and resolves it. Every check is on the **canonical** path, so a symlink cannot
/// carry `/`, the home directory or the workspace past it; the sandbox grants the canonical path only.
fn resolve_runtime_root(requested: &Path, cwd: &Path, home: Option<&Path>) -> Result<ResolvedPath> {
    let resolved = resolve_path(requested)?;
    let path = &resolved.path;
    let refuse = |why: &str| {
        Err(Error::invalid(format!(
            "runtime root {} (resolves to {}) {why}",
            requested.display(),
            path.display()
        )))
    };
    if !resolved.is_dir {
        return refuse("is not a directory");
    }
    if path.parent().is_none() {
        return refuse("is the file system root");
    }
    if home.is_some_and(|h| path == h || h.starts_with(path)) {
        return refuse("is the home directory or one of its parents");
    }
    if path.starts_with(cwd) {
        return refuse("is inside the working directory, which is granted already");
    }
    if cwd.starts_with(path) {
        return refuse("contains the working directory");
    }
    Ok(resolved)
}

/// Removes redundant grants and rejects the one combination no backend can honour.
fn prune(
    ro: Vec<ResolvedPath>,
    rw: Vec<ResolvedPath>,
) -> Result<(Vec<ResolvedPath>, Vec<ResolvedPath>)> {
    // A read-only path strictly inside a writable directory would need a "subtract" rule, which
    // Landlock does not have. Refuse rather than silently make it writable.
    for r in &ro {
        if let Some(w) = rw
            .iter()
            .find(|w| r.path != w.path && r.path.starts_with(&w.path))
        {
            return Err(Error::invalid(format!(
                "read-only path {} lies inside writable path {}; a grant cannot be narrowed \
                 inside a writable tree. Make the writable path smaller instead",
                r.path.display(),
                w.path.display()
            )));
        }
    }
    let rw = dedupe_covered(rw);
    // A read-only entry equal to or inside a read-write one adds nothing.
    let ro = dedupe_covered(ro)
        .into_iter()
        .filter(|r| !rw.iter().any(|w| r.path.starts_with(&w.path)))
        .collect();
    Ok((ro, rw))
}

/// Drops entries equal to or beneath another entry, keeping a stable order.
fn dedupe_covered(mut items: Vec<ResolvedPath>) -> Vec<ResolvedPath> {
    items.sort_by(|a, b| a.path.cmp(&b.path));
    let mut out: Vec<ResolvedPath> = Vec::new();
    for item in items {
        let covered = out
            .iter()
            .any(|kept| kept.is_dir && item.path.starts_with(&kept.path))
            || out.iter().any(|kept| kept.path == item.path);
        if !covered {
            out.push(item);
        }
    }
    out
}

fn normalize_network(network: &NetworkPolicy) -> Result<NetworkPolicy> {
    let NetworkPolicy::Allowlist(hosts) = network else {
        return Ok(network.clone());
    };
    let mut clean: Vec<String> = Vec::new();
    for host in hosts {
        let host = validate_host(host)?;
        if !clean.contains(&host) {
            clean.push(host);
        }
    }
    clean.sort();
    if clean.is_empty() {
        return Ok(NetworkPolicy::Off);
    }
    if clean.iter().all(|h| is_loopback_host(h)) {
        return Ok(NetworkPolicy::Loopback);
    }
    Ok(NetworkPolicy::Allowlist(clean))
}

fn validate_host(raw: &str) -> Result<String> {
    let host = raw
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host.is_empty() || host.len() > 253 {
        return Err(Error::invalid(format!(
            "network host {raw:?} is empty or too long"
        )));
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(host);
    }
    let label_ok = |label: &str| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    };
    if host.split('.').all(label_ok) {
        Ok(host)
    } else {
        Err(Error::invalid(format!(
            "network host {raw:?} is not a host name or IP address (no schemes, ports, paths or wildcards)"
        )))
    }
}

fn is_loopback_host(host: &str) -> bool {
    host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// The comparison key for a variable name: Windows names are case-insensitive.
fn env_key(name: &OsStr) -> OsString {
    let mut key = name.to_os_string();
    if cfg!(windows) {
        key.make_ascii_uppercase();
    }
    key
}

fn check_env_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains(['=', '\0']) {
        return Err(Error::invalid(format!(
            "environment variable name {name:?} must be non-empty and contain no '=' or NUL"
        )));
    }
    Ok(())
}

fn build_env(
    allowlist: &[String],
    set: &std::collections::BTreeMap<String, String>,
    lookup: &dyn Fn(&OsStr) -> Option<OsString>,
) -> Result<Vec<(OsString, OsString)>> {
    let mut out: Vec<(OsString, OsString)> = Vec::new();
    let mut push = |name: OsString, value: OsString| {
        let key = env_key(&name);
        if let Some(slot) = out.iter_mut().find(|(n, _)| env_key(n) == key) {
            *slot = (name, value);
        } else {
            out.push((name, value));
        }
    };
    for name in allowlist {
        check_env_name(name)?;
        if let Some(value) = lookup(OsStr::new(name)) {
            push(OsString::from(name), value);
        }
    }
    for (name, value) in set {
        check_env_name(name)?;
        if value.contains('\0') {
            return Err(Error::invalid(format!("value of {name} contains NUL")));
        }
        push(OsString::from(name), OsString::from(value));
    }
    Ok(out)
}

/// Strips the Windows verbatim prefix that `canonicalize` adds, because ACL and token APIs and
/// most programs expect the plain form. Pure text logic, tested on every platform.
#[cfg(any(windows, test))]
pub(crate) fn simplify_verbatim_str(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        // Only drive-letter forms are safe to simplify; `\\?\Volume{..}` must stay verbatim.
        let b = rest.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            return rest.to_owned();
        }
    }
    path.to_owned()
}

#[cfg(windows)]
fn simplify_verbatim(path: &Path) -> PathBuf {
    PathBuf::from(simplify_verbatim_str(&path.to_string_lossy()))
}

#[cfg(test)]
#[cfg(unix)]
mod tests;
