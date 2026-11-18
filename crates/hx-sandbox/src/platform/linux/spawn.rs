//! Installing the pre-exec hook on a command. Kept apart so the single `unsafe` call that
//! `Command::pre_exec` requires is in one small, commented place.
#![allow(
    unsafe_code,
    reason = "Command::pre_exec is an unsafe fn; the contract is met by ChildPlan::run"
)]

use tokio::process::Command;

use super::child::ChildPlan;

/// Makes `cmd` run `plan` in the child between `fork` and `exec`.
pub(super) fn install(cmd: &mut Command, plan: ChildPlan) {
    // SAFETY: the hook runs in the forked child of a possibly multithreaded process, so it
    // must be async-signal-safe. `ChildPlan::run` makes only raw syscalls over memory the
    // parent allocated before the fork, and returns an `io::Error` built from an errno
    // (no allocation). It never touches locks, the allocator, or the runtime.
    unsafe {
        cmd.pre_exec(move || plan.run());
    }
}
