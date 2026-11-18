//! The engine behind hypotaxis's `pack` tool.
//!
//! One call returns what a model needs to read: search hits with surrounding
//! code, whole files, line ranges, single symbols, outlines and git status.
//! Output is byte-capped, secrets are redacted, and `.env` and key files are
//! never returned.
//!
//! This is a pure library. Each method has a request type, a response type
//! and a `handle_*` function; a dispatcher (the `hx` binary) wires them to
//! the method names in [`METHODS`]. See `INTEGRATION.md`.
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
//! The handlers block. Call them from `spawn_blocking`, and pass a
//! [`Control`] (the `*_with` variants) to cancel or set a deadline.

mod files;
mod proc;
mod render;
mod scan;
mod symbols;
mod walk;

pub mod bundle;
pub mod error;
pub mod languages;
pub mod never_pack;
pub mod outline;
pub mod paths;
pub mod read;
pub mod redact;
pub mod search;
pub mod status;
pub mod symbol;
pub mod types;

pub use bundle::{
    BundleEntry, BundleItem, BundleParams, BundleRequest, BundleResponse, handle_bundle,
    handle_bundle_with,
};
pub use error::{Error, ErrorBody, Result};
pub use languages::{Language, LanguageSpec, Registry};
pub use outline::{
    FileOutline, OutlineParams, OutlineRequest, OutlineResponse, OutlineStatus, handle_outline,
    handle_outline_with, outline_with,
};
pub use paths::{RelPath, Root};
pub use read::{
    LineRange, ReadParams, ReadRequest, ReadResponse, ReadStatus, Segment, handle_read,
};
pub use redact::{Redactor, redact};
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

/// The method names a dispatcher registers, in the order of the table above.
pub const METHODS: &[&str] = &[
    "pack.search",
    "pack.read",
    "pack.symbol",
    "pack.outline",
    "pack.status",
    "pack.bundle",
];

/// The JSON Schema of one method's request and response.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MethodSchema {
    /// Method name, one of [`METHODS`].
    pub method: &'static str,
    /// Schema of the request (params).
    pub params: serde_json::Value,
    /// Schema of the result.
    pub result: serde_json::Value,
}

/// JSON Schemas for every method, for the generated `OpenRPC` contract.
///
/// # Panics
/// Never: schemas are plain data; a failure to serialise one is turned into `null`.
#[must_use]
pub fn method_schemas() -> Vec<MethodSchema> {
    fn schema<T: schemars::JsonSchema>() -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(T)).unwrap_or(serde_json::Value::Null)
    }
    vec![
        MethodSchema {
            method: "pack.search",
            params: schema::<SearchRequest>(),
            result: schema::<SearchResponse>(),
        },
        MethodSchema {
            method: "pack.read",
            params: schema::<ReadRequest>(),
            result: schema::<ReadResponse>(),
        },
        MethodSchema {
            method: "pack.symbol",
            params: schema::<SymbolRequest>(),
            result: schema::<SymbolResponse>(),
        },
        MethodSchema {
            method: "pack.outline",
            params: schema::<OutlineRequest>(),
            result: schema::<OutlineResponse>(),
        },
        MethodSchema {
            method: "pack.status",
            params: schema::<StatusRequest>(),
            result: schema::<StatusResponse>(),
        },
        MethodSchema {
            method: "pack.bundle",
            params: schema::<BundleRequest>(),
            result: schema::<BundleResponse>(),
        },
    ]
}
