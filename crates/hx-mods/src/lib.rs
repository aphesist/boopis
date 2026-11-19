//! The runtime that runs Claude Code mods unchanged inside hypotaxis.
//!
//! A mod is a plugin whose `hooks/hooks.json` names JavaScript or TypeScript modules. This crate
//! loads them into one `QuickJS` isolate (TypeScript and JSX are compiled on load, no build step),
//! runs Claude Code's event chain over their hooks, and gives them a `$` whose every effect leaves
//! the isolate as a [`HostRequest`] for the embedder to decide. The isolate itself has no access
//! to files, the network or processes.
//!
//! See `docs/MODS.md` for the plan and `docs/research/mods.md` for the mod API this implements.
//! The crate is a library with tests; it is not wired into `hx` yet.

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
pub mod wire;
pub mod worker;

pub use error::{Error, Result};
pub use files::Bundle;
pub use host::{CallId, Completion, HostCalls, HostError, HostReply, HostRequest};
pub use manifest::Manifest;
pub use runtime::{
    Answer, Budgets, Diagnostic, LoadedPlugin, Memory, ModRuntime, Render, RuntimeConfig, Tier,
};
