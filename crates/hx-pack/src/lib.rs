//! The engine behind hypotaxis's `pack` tool.
//!
//! A pure library: request and response types, one error enum with
//! `hx.pack.*` codes, and a handler per method.

mod files;
mod render;
mod scan;
mod symbols;
mod walk;

pub mod error;
pub mod languages;
pub mod never_pack;
pub mod outline;
pub mod paths;
pub mod read;
pub mod redact;
pub mod search;
pub mod symbol;
pub mod types;

pub use error::{Error, ErrorBody, Result};
pub use languages::{Language, LanguageSpec, Registry};
pub use outline::{
    FileOutline, OutlineParams, OutlineRequest, OutlineResponse, OutlineStatus, handle_outline,
    handle_outline_with, outline_with,
};
pub use paths::{RelPath, Root};
pub use read::{LineRange, ReadParams, ReadRequest, ReadResponse, ReadStatus, Segment, handle_read};
pub use redact::{Redactor, redact};
pub use search::{
    Block, CaseMode, PatternMode, SearchParams, SearchRequest, SearchResponse, handle_search,
    handle_search_with,
};
pub use symbol::{
    Found, SymbolParams, SymbolRequest, SymbolResponse, handle_symbol, handle_symbol_with,
    symbol_with,
};
pub use symbols::Symbol;
pub use types::{
    Budget, Control, Redactions, Skipped, Truncation, WalkOptions, Withheld, WithheldFile,
};
