//! The error catalog and [`AppError`], the one error type handlers return.
//!
//! The catalog is the data file `errors.json`, shared with the Python plugin. The string
//! constants in [`codes`] are generated from it at build time, so a code is typed once.

use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::jsonrpc::RpcError;

/// Stable string codes, generated from `errors.json`.
#[allow(missing_docs)] // The generated constants carry the catalog description as rustdoc.
pub mod codes {
    include!(concat!(env!("OUT_DIR"), "/codes.rs"));
}

/// The numeric JSON-RPC code for application errors.
pub const APPLICATION_ERROR: i64 = -32000;

/// The raw text of `errors.json`, for tools that want to print or re-export it.
pub const CATALOG_JSON: &str = include_str!("../errors.json");

/// One row of the catalog.
#[derive(Debug, Clone, Deserialize)]
pub struct CatalogEntry {
    /// The stable string code.
    pub code: String,
    /// The numeric JSON-RPC code.
    pub rpc_code: i64,
    /// What the code means.
    pub description: String,
}

#[derive(Debug, Deserialize)]
struct Catalog {
    errors: Vec<CatalogEntry>,
}

fn catalog() -> &'static [CatalogEntry] {
    static CATALOG: OnceLock<Vec<CatalogEntry>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        // A parse failure is caught by `catalog_parses` in the tests; at run time an empty
        // catalog degrades every code to -32000 rather than aborting.
        serde_json::from_str::<Catalog>(CATALOG_JSON)
            .map(|c| c.errors)
            .unwrap_or_default()
    })
}

/// Every catalog entry, in file order.
#[must_use]
pub fn entries() -> &'static [CatalogEntry] {
    catalog()
}

/// Looks up the numeric JSON-RPC code for a string code. Unknown codes map to `-32603`.
#[must_use]
pub fn rpc_code_for(code: &str) -> i64 {
    catalog()
        .iter()
        .find(|e| e.code == code)
        .map_or(-32603, |e| e.rpc_code)
}

/// A failure a handler reports: a catalog code, a message, and structured details.
///
/// Converts to the wire's [`RpcError`] with `data = {code, ...details}`.
#[derive(Debug, Clone, PartialEq)]
pub struct AppError {
    /// A constant from [`codes`].
    pub code: &'static str,
    /// A human-readable summary. Clients never parse it.
    pub message: String,
    /// Extra fields merged into `data` next to `code`.
    pub details: Map<String, Value>,
}

impl AppError {
    /// An error with no details.
    #[must_use]
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: Map::new(),
        }
    }

    /// Adds one detail field.
    #[must_use]
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.details.insert(key.to_owned(), value.into());
        self
    }

    /// `hx.invalid_params` for a params value that does not deserialise.
    #[must_use]
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(codes::HX_INVALID_PARAMS, message)
    }

    /// `hx.internal_error`, for infrastructure failures.
    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(codes::HX_INTERNAL_ERROR, message)
    }

    /// `hx.cancelled`.
    #[must_use]
    pub fn cancelled() -> Self {
        Self::new(codes::HX_CANCELLED, "request cancelled")
    }

    /// The wire form.
    #[must_use]
    pub fn to_rpc_error(&self) -> RpcError {
        let mut data = Map::new();
        data.insert("code".to_owned(), Value::from(self.code));
        for (k, v) in &self.details {
            if k != "code" {
                data.insert(k.clone(), v.clone());
            }
        }
        RpcError {
            code: rpc_code_for(self.code),
            message: self.message.clone(),
            data: Some(Value::Object(data)),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses() {
        assert!(!entries().is_empty());
    }

    #[test]
    fn generated_constants_match_the_catalog() {
        let from_file: Vec<&str> = entries().iter().map(|e| e.code.as_str()).collect();
        assert_eq!(codes::ALL, from_file.as_slice());
    }

    #[test]
    fn codes_are_unique_namespaced_and_documented() {
        let mut seen = std::collections::HashSet::new();
        for e in entries() {
            assert!(seen.insert(&e.code), "duplicate {}", e.code);
            assert!(e.code.starts_with("hx."), "{}", e.code);
            assert!(!e.description.is_empty(), "{}", e.code);
            assert!(
                e.rpc_code == APPLICATION_ERROR || (-32700..=-32600).contains(&e.rpc_code),
                "{}",
                e.code
            );
        }
    }

    #[test]
    fn application_errors_use_32000_with_data_code() {
        let rpc = AppError::new(codes::HX_TXN_SCOPE_VIOLATION, "no")
            .with("paths", vec!["a"])
            .to_rpc_error();
        assert_eq!(rpc.code, -32000);
        assert_eq!(rpc.string_code(), Some("hx.txn.scope_violation"));
        assert_eq!(rpc.data.unwrap()["paths"][0], "a");
    }

    #[test]
    fn protocol_errors_keep_the_spec_codes() {
        assert_eq!(rpc_code_for(codes::HX_METHOD_NOT_FOUND), -32601);
        assert_eq!(rpc_code_for(codes::HX_INVALID_PARAMS), -32602);
        assert_eq!(rpc_code_for("hx.unknown"), -32603);
    }

    #[test]
    fn details_cannot_override_the_code() {
        let rpc = AppError::new(codes::HX_CANCELLED, "x")
            .with("code", "evil")
            .to_rpc_error();
        assert_eq!(rpc.string_code(), Some("hx.cancelled"));
    }
}
