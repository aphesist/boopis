//! The OS sandbox for hypotaxis: where the exec kernel and the gate commands run.
//!
//! A [`SandboxPolicy`] says what a child may read and write, whether it has a network, which
//! environment it sees, and how long and how loud it may be. [`run`] executes one command to
//! completion; [`spawn`] starts a long-lived child (the exec kernel) with streams and a kill
//! handle. Both report an [`Enforcement`]: what was actually enforced, per dimension, and by
//! which OS mechanism.
//!
//! The rule that matters most: **the sandbox never silently runs a command unsandboxed.** If
//! the platform cannot enforce a requested dimension, the call fails with
//! `hx.sandbox.unavailable` ([`Error::Unavailable`]) unless the policy explicitly allows
//! [`Degraded`] for that dimension, and then the report says so.
//!
//! Mechanisms: Landlock + seccomp (+ a network namespace for loopback) on Linux, Seatbelt on
//! macOS, `AppContainer` + a job object on Windows. See the README for the threat model and
//! the gaps.
//!
//! - [`policy`]: the policy types and limit defaults.
//! - [`normalize`]: canonicalising and validating a policy ([`SandboxPolicy::resolve`]).
//! - [`report`]: results and the enforcement report.
//! - [`wire`]: the `sandbox.run` and `sandbox.describe` method types.

mod capabilities;
mod capture;
mod defaults;
mod error;
pub mod normalize;
mod platform;
pub mod policy;
mod process;
mod program;
pub mod report;
#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(
        dead_code,
        reason = "only the macOS backend runs the generator; it is compiled and tested everywhere"
    )
)]
mod seatbelt;
#[cfg_attr(
    not(any(windows, test)),
    allow(
        dead_code,
        reason = "only the Windows backend applies these; they are compiled and tested everywhere"
    )
)]
mod winpolicy;
pub mod wire;

pub use capabilities::{Capabilities, Capability};
pub use capture::StreamStats;
pub use error::{
    CODE_DENIED, CODE_INVALID_POLICY, CODE_SPAWN_FAILED, CODE_UNAVAILABLE, Dimension, Error, Result,
};
pub use normalize::{ResolvedPath, ResolvedPolicy};
pub use policy::{DEFAULT_ENV_ALLOWLIST, Degraded, NetworkPolicy, SandboxPolicy, limits};
pub use process::{ChildReader, ChildWriter, Handle, InheritedHandle, SpawnOptions, run, spawn};
pub use report::{Captured, DimensionReport, Enforcement, ExitOutcome, RunResult, Status};

/// What this host can enforce, from live probes. The first call may take a few milliseconds on
/// Linux (it forks short-lived probe children); the result is cached. Call it once at start-up
/// and publish it in `hx.describe`.
#[must_use]
pub fn capabilities() -> Capabilities {
    platform::capabilities()
}
