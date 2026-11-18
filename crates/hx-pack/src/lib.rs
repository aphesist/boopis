//! The engine behind hypotaxis's `pack` tool.
//!
//! A pure library: request and response types, one error enum with
//! `hx.pack.*` codes, and a handler per method.

mod files;

pub mod error;
pub mod never_pack;
pub mod paths;
pub mod redact;
pub mod types;

pub use error::{Error, ErrorBody, Result};
pub use paths::{RelPath, Root};
pub use redact::{Redactor, redact};
pub use types::{
    Budget, Control, Redactions, Skipped, Truncation, WalkOptions, Withheld, WithheldFile,
};
