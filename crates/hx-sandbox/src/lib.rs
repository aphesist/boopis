//! The OS sandbox for hypotaxis: where the exec kernel and the gate commands run.
//!
//! A [`SandboxPolicy`] says what a child may read and write, whether it has a network, which
//! environment it sees, and how long and how loud it may be. This first step holds the policy,
//! its normalisation, the report types and the wire types; the platform backends follow.

mod capabilities;
mod defaults;
mod error;
pub mod normalize;
pub mod policy;
pub mod report;
pub mod wire;

pub use capabilities::{Capabilities, Capability};
pub use error::{CODE_DENIED, CODE_INVALID_POLICY, CODE_SPAWN_FAILED, CODE_UNAVAILABLE, Dimension, Error, Result};
pub use normalize::{ResolvedPath, ResolvedPolicy};
pub use policy::{DEFAULT_ENV_ALLOWLIST, Degraded, NetworkPolicy, SandboxPolicy, limits};
pub use report::{Captured, DimensionReport, Enforcement, ExitOutcome, RunResult, Status};
