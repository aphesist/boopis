//! The store (ADR-0038, `docs/STORE.md`): one place to find, review, install, update and remove everything installable.
//!
//! - [`types`]: the shapes of `apps/shared/data/store.schema.json` (the contract).
//! - [`net`]: the one place the store touches the network: caps, https only, a host list, redirects checked hop by hop.
//! - [`stage`]: bytes to a folder under the same rules as the runtime unpack, the tree hash the plugin's trust store uses, and a
//!   pattern scan. Nothing staged runs.
//! - [`servers`]: registry `server.json` and MCP bundle manifests as connector specs.
//! - [`normalize`]: each source's shape to a `StoreItem`.

pub mod discover;
pub mod github;
pub mod net;
pub mod normalize;
pub mod servers;
pub mod stage;
pub mod types;

#[cfg(test)]
mod net_tests;
#[cfg(test)]
mod stage_tests;
