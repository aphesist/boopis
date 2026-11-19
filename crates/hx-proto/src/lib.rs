//! The wire contract between the boopis plugin (Python) and `hx` (Rust).
//!
//! - [`jsonrpc`]: JSON-RPC 2.0 framing, newline-delimited over stdio.
//! - [`error`]: the error catalog (`errors.json`, shared with Python) and [`AppError`].
//! - [`describe`], [`txn`]: request and response types, with JSON Schema derived by `schemars`.
//! - [`schema`]: the generated `schema/hx-v1.schema.json`.
//! - [`registry`]: the [`Handler`] trait and the [`Dispatcher`] every crate registers into.
//! - [`log`]: `tracing` setup with a redaction hook.
//!
//! `pack.*` and `sandbox.*` are reserved namespaces ([`method::Namespace`]); the crates that
//! own them add their types and handlers.

pub mod describe;
pub mod error;
pub mod jsonrpc;
pub mod log;
pub mod method;
pub mod registry;
pub mod schema;
pub mod time;
pub mod txn;

pub use error::{AppError, codes};
pub use jsonrpc::{Id, Notification, Request, Response, RpcError};
pub use registry::{BoxFuture, CallContext, Dispatcher, Handler, HandlerResult};
