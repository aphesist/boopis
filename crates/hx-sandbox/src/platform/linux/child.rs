//! What the forked child does between `fork` and `exec`.
//!
//! [`ChildPlan::run`] executes in the child, so it may only make raw syscalls and read memory
//! the parent prepared: no allocation, no formatting, no locks. Every value it needs is built
//! in the parent. A failing step reports its id on the status pipe and aborts the spawn, so a
//! child never reaches `exec` with part of its sandbox missing.

use std::io;
use std::os::fd::RawFd;

use seccompiler::BpfProgram;

use super::sys;
use crate::platform::rlimits::RlimitSpec;

/// Step ids written to the status pipe. Names are in [`step_name`].
pub(super) mod step {
    pub const SETSID: u8 = 1;
    pub const INHERIT_FD: u8 = 2;
    pub const UNSHARE_NS: u8 = 3;
    pub const USER_MAPS: u8 = 4;
    pub const LOOPBACK_UP: u8 = 5;
    pub const DROP_BOUNDING: u8 = 6;
    pub const CLEAR_CAPS: u8 = 7;
    pub const NO_NEW_PRIVS: u8 = 8;
    pub const LANDLOCK: u8 = 9;
    pub const SECCOMP: u8 = 10;
    pub const RLIMIT: u8 = 11;
    pub const PID_FORK: u8 = 12;
}

/// A setup step's name, for `Error::Setup`.
pub(super) fn step_name(id: u8) -> &'static str {
    match id {
        step::SETSID => "setsid",
        step::INHERIT_FD => "keep inherited descriptor",
        step::UNSHARE_NS => "unshare namespaces",
        step::USER_MAPS => "write user namespace id maps",
        step::LOOPBACK_UP => "bring loopback interface up",
        step::DROP_BOUNDING => "drop capability bounding set",
        step::CLEAR_CAPS => "clear capabilities",
        step::NO_NEW_PRIVS => "prctl(PR_SET_NO_NEW_PRIVS)",
        step::LANDLOCK => "landlock_restrict_self",
        step::SECCOMP => "seccomp filter install",
        step::RLIMIT => "setrlimit",
        step::PID_FORK => "fork into the PID namespace",
        _ => "sandbox setup",
    }
}

/// The namespaces the child enters before anything else is applied.
#[derive(Debug, Clone)]
pub(super) struct NamespacePlan {
    /// A private network namespace with only loopback up.
    pub net: bool,
    /// A PID namespace: the program becomes its init, and when it exits the kernel kills every
    /// descendant, including ones that left the process group with `setsid`.
    pub pid: bool,
    /// `Some` when the namespaces are created through a user namespace (an unprivileged
    /// caller); holds the id-map lines, formatted in the parent.
    pub userns: Option<UserMaps>,
}

/// The `uid_map` and `gid_map` contents mapping the caller's own ids to themselves.
#[derive(Debug, Clone)]
pub(super) struct UserMaps {
    pub uid_map: Vec<u8>,
    pub gid_map: Vec<u8>,
}

impl UserMaps {
    pub(super) fn identity(uid: u32, gid: u32) -> Self {
        Self {
            uid_map: format!("{uid} {uid} 1\n").into_bytes(),
            gid_map: format!("{gid} {gid} 1\n").into_bytes(),
        }
    }
}

/// Everything the child needs, prepared in the parent.
pub(super) struct ChildPlan {
    /// The descriptor that must survive into the program, or -1.
    pub inherit_fd: RawFd,
    /// The pipe the child writes a failed step id to, or -1.
    pub status_fd: RawFd,
    /// Namespaces to enter.
    pub namespaces: Option<NamespacePlan>,
    /// `setrlimit` calls, applied after the namespaces.
    pub rlimits: Vec<RlimitSpec>,
    /// Empty the bounding set up to this capability number (None: do not try).
    pub drop_bounding_to: Option<u32>,
    /// Set `no_new_privs`.
    pub no_new_privs: bool,
    /// The Landlock ruleset to enforce.
    pub landlock_fd: Option<RawFd>,
    /// The compiled seccomp program.
    pub seccomp: Option<BpfProgram>,
}

impl ChildPlan {
    fn fail(&self, id: u8, errno: i32) -> io::Error {
        crate::platform::unix_sys::child_report(self.status_fd, id);
        io::Error::from_raw_os_error(errno)
    }

    /// Applies the plan in the child. Returns the OS error of the first failing step.
    pub(super) fn run(&self) -> io::Result<()> {
        crate::platform::unix_sys::child_setsid().map_err(|e| self.fail(step::SETSID, e))?;
        sys::child_cloexec_all();
        if self.inherit_fd >= 0 {
            crate::platform::unix_sys::child_keep_fd(self.inherit_fd)
                .map_err(|e| self.fail(step::INHERIT_FD, e))?;
        }
        if let Some(ns) = &self.namespaces {
            setup_namespaces(ns).map_err(|(id, e)| self.fail(id, e))?;
        }
        for spec in &self.rlimits {
            crate::platform::unix_sys::child_setrlimit(spec.resource, spec.soft, spec.hard)
                .map_err(|e| self.fail(step::RLIMIT, e))?;
        }
        if let Some(last) = self.drop_bounding_to {
            sys::child_drop_bounding_set(last).map_err(|e| self.fail(step::DROP_BOUNDING, e))?;
        }
        sys::child_clear_capabilities().map_err(|e| self.fail(step::CLEAR_CAPS, e))?;
        if self.no_new_privs {
            sys::child_no_new_privs().map_err(|e| self.fail(step::NO_NEW_PRIVS, e))?;
        }
        if let Some(fd) = self.landlock_fd {
            sys::child_landlock_restrict(fd).map_err(|e| self.fail(step::LANDLOCK, e))?;
        }
        if let Some(program) = &self.seccomp {
            seccompiler::apply_filter(program).map_err(|e| match e {
                seccompiler::Error::Prctl(io) | seccompiler::Error::Seccomp(io) => {
                    crate::platform::unix_sys::child_report(self.status_fd, step::SECCOMP);
                    io
                }
                _ => self.fail(step::SECCOMP, libc::EINVAL),
            })?;
        }
        Ok(())
    }
}

/// Enters the namespaces. Used by the child and by the probe. With a PID namespace this
/// returns only in the namespace's init (the program); the original process stays behind as a
/// supervisor that mirrors the init's exit status and never returns.
pub(super) fn setup_namespaces(plan: &NamespacePlan) -> Result<(), (u8, i32)> {
    let mut flags = 0;
    if plan.userns.is_some() {
        flags |= libc::CLONE_NEWUSER;
    }
    if plan.net {
        flags |= libc::CLONE_NEWNET;
    }
    if plan.pid {
        flags |= libc::CLONE_NEWPID;
    }
    sys::child_unshare(flags).map_err(|e| (step::UNSHARE_NS, e))?;
    if let Some(maps) = &plan.userns {
        // An unprivileged process must forbid setgroups before it may write gid_map.
        sys::child_write_file(c"/proc/self/setgroups", b"deny")
            .and_then(|()| sys::child_write_file(c"/proc/self/uid_map", &maps.uid_map))
            .and_then(|()| sys::child_write_file(c"/proc/self/gid_map", &maps.gid_map))
            .map_err(|e| (step::USER_MAPS, e))?;
    }
    if plan.net {
        sys::child_loopback_up().map_err(|e| (step::LOOPBACK_UP, e))?;
    }
    if plan.pid {
        sys::child_become_pid_namespace_init().map_err(|e| (step::PID_FORK, e))?;
    }
    Ok(())
}
