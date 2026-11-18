//! Runtime probing of what this kernel and this process can enforce. Each mechanism is
//! exercised in a forked child, not inferred from a version number: a container can expose a
//! syscall and still forbid it.

use std::sync::OnceLock;

use super::child::{NamespacePlan, UserMaps, setup_namespaces};
use super::landlock::{MIN_ABI, handled_fs, scopes};
use super::seccomp::{SocketMode, build};
use super::sys;

/// How a namespace can be had.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NsAccess {
    /// Not at all.
    None,
    /// Directly (the caller has `CAP_SYS_ADMIN`).
    Direct,
    /// Through an unprivileged user namespace.
    ViaUserns,
}

/// The probe result, computed once per process.
#[derive(Debug, Clone)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "a flat record of independent probe results; a state machine would hide them"
)]
pub(super) struct Probe {
    pub kernel: String,
    /// The Landlock ABI the kernel reports, or the reason it does not.
    pub landlock_abi: Result<u32, String>,
    /// A ruleset was created, restricted a child, and denied a write.
    pub landlock_enforces: bool,
    /// A seccomp filter was installed in a child and denied an inet socket.
    pub seccomp_enforces: bool,
    /// How a network namespace with a working loopback can be created.
    pub netns: NsAccess,
    /// How a PID namespace (with a forked init) can be created.
    pub pidns: NsAccess,
    /// Highest capability number the kernel knows.
    pub cap_last: u32,
    /// The process holds `CAP_SETPCAP`, so the bounding set can be emptied.
    pub can_drop_bounding: bool,
    /// Effective uid is 0.
    pub is_root: bool,
}

impl Probe {
    /// The Landlock ABI when it is new enough and verified to enforce.
    pub(super) fn usable_landlock_abi(&self) -> Option<u32> {
        match self.landlock_abi {
            Ok(abi) if abi >= MIN_ABI && self.landlock_enforces => Some(abi),
            _ => None,
        }
    }
}

/// The cached probe.
pub(super) fn get() -> &'static Probe {
    static PROBE: OnceLock<Probe> = OnceLock::new();
    PROBE.get_or_init(run)
}

/// The capability bit for `CAP_SETPCAP`.
const CAP_SETPCAP: u64 = 1 << 8;

fn errno_text(errno: i32) -> String {
    match errno {
        libc::ENOSYS => "the kernel was built without Landlock (ENOSYS)".to_owned(),
        libc::EOPNOTSUPP => "Landlock is built in but disabled at boot (EOPNOTSUPP)".to_owned(),
        other => format!(
            "landlock_create_ruleset failed: {}",
            std::io::Error::from_raw_os_error(other)
        ),
    }
}

fn status_field(name: &str) -> Option<String> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status
        .lines()
        .find_map(|l| l.strip_prefix(name).and_then(|r| r.strip_prefix(':')))
        .map(|v| v.trim().to_owned())
}

fn run() -> Probe {
    let (uid, gid, euid) = sys::ids();
    let landlock_abi = sys::landlock_abi().map_err(errno_text);
    let landlock_enforces = landlock_abi.as_ref().is_ok_and(|abi| probe_landlock(*abi));
    let seccomp_enforces = probe_seccomp();
    let netns = probe_ns(uid, gid, true, false);
    let pidns = probe_ns(uid, gid, false, true);
    let cap_last = std::fs::read_to_string("/proc/sys/kernel/cap_last_cap")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(40);
    let cap_eff = status_field("CapEff")
        .and_then(|h| u64::from_str_radix(&h, 16).ok())
        .unwrap_or(0);
    Probe {
        kernel: std::fs::read_to_string("/proc/sys/kernel/osrelease")
            .map_or_else(|_| "unknown".to_owned(), |s| s.trim().to_owned()),
        landlock_abi,
        landlock_enforces,
        seccomp_enforces,
        netns,
        pidns,
        cap_last,
        can_drop_bounding: cap_eff & CAP_SETPCAP != 0,
        is_root: euid == 0,
    }
}

fn probe_landlock(abi: u32) -> bool {
    let Ok(ruleset) = sys::Ruleset::new(handled_fs(abi), scopes(abi)) else {
        return false;
    };
    let fd = ruleset.raw_fd();
    sys::fork_probe(|| {
        sys::child_no_new_privs().is_ok()
            && sys::child_landlock_restrict(fd).is_ok()
            && sys::child_write_dev_null_denied()
    })
}

fn probe_seccomp() -> bool {
    let Ok(program) = build(SocketMode::Off) else {
        return false;
    };
    sys::fork_probe(|| {
        seccompiler::apply_filter(&program).is_ok() && sys::child_inet_socket_denied()
    })
}

/// Tries to enter the namespaces in a forked child: directly, then through a user namespace.
fn probe_ns(uid: u32, gid: u32, net: bool, pid: bool) -> NsAccess {
    let direct = NamespacePlan {
        net,
        pid,
        userns: None,
    };
    // With a PID namespace the body continues only in the init, which then reports success;
    // the supervisor mirrors that exit status back to this probe.
    if sys::fork_probe(|| setup_namespaces(&direct).is_ok()) {
        return NsAccess::Direct;
    }
    let via_user = NamespacePlan {
        net,
        pid,
        userns: Some(UserMaps::identity(uid, gid)),
    };
    if sys::fork_probe(|| setup_namespaces(&via_user).is_ok()) {
        return NsAccess::ViaUserns;
    }
    NsAccess::None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_is_consistent() {
        let p = get();
        assert!(!p.kernel.is_empty());
        if p.usable_landlock_abi().is_some() {
            assert!(p.landlock_enforces);
        }
        // Cached: a second call returns the same object.
        assert!(std::ptr::eq(p, get()));
    }
}
