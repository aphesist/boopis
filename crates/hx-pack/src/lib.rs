//! The engine behind boopis's `pack` tool.
//!
//! One call returns what a model needs to read: search hits with surrounding
//! code, whole files, line ranges, single symbols, outlines and git status.
//! Output is byte-capped, secrets are redacted, and `.env` and key files are
//! never returned.
//!
//! This is a pure library. Each method has a request type, a response type
//! and a `handle_*` function; a dispatcher (the `hx` binary) wires them to
//! the `pack` namespace through [`PackHandler`]. See `INTEGRATION.md`.
//!
//! | method | request | handler |
//! |---|---|---|
//! | `pack.search` | [`SearchRequest`] | [`handle_search`] |
//! | `pack.read` | [`ReadRequest`] | [`handle_read`] |
//! | `pack.symbol` | [`SymbolRequest`] | [`handle_symbol`] |
//! | `pack.outline` | [`OutlineRequest`] | [`handle_outline`] |
//! | `pack.status` | [`StatusRequest`] | [`handle_status`] |
//! | `pack.bundle` | [`BundleRequest`] | [`handle_bundle`] |
//!
//! The `handle_*` functions block; `PackHandler` runs them on the blocking pool. Pass a
//! [`Control`] (the `*_with` variants) to cancel or set a deadline.

mod files;
mod proc;
mod render;
mod scan;
mod symbols;
mod walk;

pub mod bundle;
pub mod cache;
pub mod error;
pub mod handler;
pub mod languages;
pub mod never_pack;
pub mod outline;
pub mod read;
pub mod redact;
pub mod redact_handler;
pub mod root;
pub mod search;
pub mod status;
pub mod symbol;
pub mod types;

pub use bundle::{
    BundleEntry, BundleItem, BundleParams, BundleRequest, BundleResponse, handle_bundle,
    handle_bundle_with,
};
pub use cache::{CacheStats, WalkCache};
pub use error::{Error, ErrorBody, Result};
pub use handler::{PackHandler, add_schema};
pub use languages::{Language, LanguageSpec, Registry};
pub use outline::{
    FileOutline, OutlineParams, OutlineRequest, OutlineResponse, OutlineStatus, handle_outline,
    handle_outline_with, outline_with,
};
pub use read::{
    LineRange, ReadParams, ReadRequest, ReadResponse, ReadStatus, Segment, handle_read,
};
pub use redact::{LogRedactor, Redactor, redact};
pub use redact_handler::{RedactHandler, RedactRequest, RedactResponse, add_redact_schema};
pub use root::Root;
pub use search::{
    Block, CaseMode, PatternMode, SearchParams, SearchRequest, SearchResponse, handle_search,
    handle_search_with,
};
pub use status::{
    EntryKind, StatusCounts, StatusEntry, StatusParams, StatusRequest, StatusResponse,
    handle_status,
};
pub use symbol::{
    Found, SymbolParams, SymbolRequest, SymbolResponse, handle_symbol, handle_symbol_with,
    symbol_with,
};
pub use symbols::Symbol;
pub use types::{
    Budget, Control, Redactions, Skipped, Truncation, WalkOptions, Withheld, WithheldFile,
};
