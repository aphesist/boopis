//! The runtime that runs Claude Code mods unchanged inside boopis.
//!
//! A mod is a plugin whose `hooks/hooks.json` names JavaScript or TypeScript modules. Each mod runs
//! in a worker of its own, in its own `QuickJS` runtime with its own heap budget (TypeScript and JSX
//! are compiled on load, no build step). The event chain, which crosses mods, runs in the parent
//! ([`chain`]) over the workers' channels, and a mod's `$` leaves its worker as a [`HostRequest`]
//! for the embedder to decide. A worker has no access to files, the network or processes.
//!
//! - [`engine`] and [`worker`]: one mod's runtime and the loop that serves it over a channel.
//! - [`chain`]: Claude Code's event chain across the workers.
//! - [`ModRuntime`]: both in one process, for tests and benchmarks (`hx` runs workers sandboxed).
//!
//! See `docs/MODS.md` for the plan and `docs/research/mods.md` for the mod API this implements.

pub mod analyze;
pub mod chain;
pub mod engine;
mod error;
mod files;
#[cfg(feature = "dev-fixtures")]
pub mod fixtures;
mod host;
mod manifest;
mod modules;
mod natives;
mod runtime;
pub mod transform;
pub mod tree;
mod types;
pub mod wire;
pub mod worker;

pub use error::{Error, Result};
pub use files::{Bundle, Files};
pub use host::{CallId, Completion, HostCalls, HostError, HostReply, HostRequest};
pub use manifest::Manifest;
pub use manifest::load_order;
pub use runtime::ModRuntime;
pub use types::{Answer, Budgets, Diagnostic, LoadedPlugin, Memory, Render, RuntimeConfig, Tier};
