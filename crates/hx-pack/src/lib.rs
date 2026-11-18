//! The engine behind hypotaxis's `pack` tool.
//!
//! A pure library: request and response types, one error enum with
//! `hx.pack.*` codes, and a handler per method.

mod files;
mod render;
mod scan;
mod walk;

pub mod error;
pub mod never_pack;
pub mod paths;
pub mod read;
pub mod redact;
pub mod search;
pub mod types;

pub use error::{Error, ErrorBody, Result};
pub use paths::{RelPath, Root};
pub use read::{LineRange, ReadParams, ReadRequest, ReadResponse, ReadStatus, Segment, handle_read};
pub use redact::{Redactor, redact};
pub use search::{
    Block, CaseMode, PatternMode, SearchParams, SearchRequest, SearchResponse, handle_search,
    handle_search_with,
};
pub use types::{
    Budget, Control, Redactions, Skipped, Truncation, WalkOptions, Withheld, WithheldFile,
};
