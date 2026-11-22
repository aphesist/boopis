//! The store (ADR-0038, `docs/STORE.md`): one place to find, review, install, update and remove everything installable.
//!
//! - [`types`]: the shapes of `apps/shared/data/store.schema.json` (the contract).
//! - [`net`]: the one place the store touches the network: caps, https only, a host list, redirects checked hop by hop.
//! - [`stage`]: bytes to a folder under the same rules as the runtime unpack, the tree hash the plugin's trust store uses, and a
//!   pattern scan. Nothing staged runs.
//! - [`servers`]: registry `server.json` and MCP bundle manifests as connector specs.
//! - [`normalize`]: each source's shape to a `StoreItem`.

// The store's flows are long and linear (one step per route, one row per plan line) and its tests build byte-level fixtures; the
// lints below ask for shapes that would hide that. Everything else of the workspace's set applies.
#![allow(
    clippy::too_many_lines,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::large_enum_variant,
    clippy::case_sensitive_file_extension_comparisons,
    clippy::cast_possible_truncation,
    clippy::many_single_char_names,
    clippy::unused_self,
    clippy::unused_async,
    clippy::unnecessary_wraps,
    clippy::format_push_string,
    clippy::items_after_statements
)]

pub mod backend;
pub mod cache;
pub mod discover;
pub mod github;
pub mod install;
pub mod net;
pub mod normalize;
pub mod plan;
pub mod reasons;
pub mod recommended;
pub mod search;
pub mod servers;
pub mod service;
pub mod stage;
pub mod time;
pub mod types;

pub use service::Store;

#[cfg(test)]
mod golden_tests;
#[cfg(test)]
mod net_tests;
#[cfg(test)]
mod service_tests;
#[cfg(test)]
mod stage_tests;
