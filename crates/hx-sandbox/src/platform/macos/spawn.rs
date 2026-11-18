//! The pre-exec hook for macOS children: new session, descriptor hygiene, one inherited
//! descriptor. The sandbox itself is applied by `sandbox-exec` after this runs.
#![allow(
    unsafe_code,
    reason = "Command::pre_exec is an unsafe fn; the hook makes only async-signal-safe libc calls"
)]

use std::io;
use std::os::fd::RawFd;

use tokio::process::Command;

use crate::platform::unix_sys::{child_cloexec_all, child_keep_fd, child_report, child_setsid};

const STEP_SETSID: u8 = 1;
const STEP_INHERIT: u8 = 2;

/// A setup step's name, for `Error::Setup`.
pub(super) fn step_name(id: u8) -> &'static str {
    match id {
        STEP_SETSID => "setsid",
        STEP_INHERIT => "keep inherited descriptor",
        _ => "sandbox setup",
    }
}

/// Makes `cmd` run the hook between `fork` and `exec`.
pub(super) fn install(cmd: &mut Command, inherit_fd: RawFd, status_fd: RawFd) {
    // SAFETY: the hook runs in the forked child of a possibly multithreaded process, so it must
    // be async-signal-safe: it calls setsid and fcntl only, over integers captured by value,
    // and returns an `io::Error` built from an errno (no allocation).
    unsafe {
        cmd.pre_exec(move || {
            let fail = |step: u8, errno: i32| {
                child_report(status_fd, step);
                io::Error::from_raw_os_error(errno)
            };
            child_setsid().map_err(|e| fail(STEP_SETSID, e))?;
            child_cloexec_all();
            if inherit_fd >= 0 {
                child_keep_fd(inherit_fd).map_err(|e| fail(STEP_INHERIT, e))?;
            }
            Ok(())
        });
    }
}
