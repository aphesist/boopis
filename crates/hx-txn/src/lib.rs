//! Capability-safe file transactions: the engine behind `ship`.
//!
//! See the README for the journal state machine. In short: validate every edit in memory,
//! journal the originals durably, apply each write atomically, and restore on any failure.
//!
//! - [`paths`]: the shared safe-path module (`cap-std` plus symlink resolution).
//! - [`edit`]: search/replace and unified-diff matching, in memory.
//! - [`held`]: directories held open and opened without following a symlink.
//! - [`scope`]: allowed and protected globs.
//! - [`engine`]: `validate`, `apply`, `restore`, `discard`, `recover`.
//! - [`journal`], [`restore`]: the durable journal and its state machine.
//! - [`mac`]: the profile's journal key and the tag that vouches for a manifest.
//! - [`handler`]: the `txn.*` methods for the dispatcher.

// In production `Faults` is a zero-sized no-op, so clippy wants it passed by value. The same
// signatures serve the fault-injecting build (feature `dev-fixtures`), where it holds counters
// and must be borrowed.
#![cfg_attr(
    not(feature = "dev-fixtures"),
    allow(clippy::trivially_copy_pass_by_ref)
)]

pub mod edit;
pub mod engine;
pub mod error;
pub mod faults;
pub mod fsops;
pub mod handler;
pub mod held;
pub mod journal;
pub mod limits;
pub mod mac;
pub mod paths;
pub mod plan;
pub mod restore;
pub mod scope;

pub use engine::Engine;
pub use error::{Error, Result};
pub use faults::Faults;
pub use handler::TxnHandler;
pub use limits::Limits;
