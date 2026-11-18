//! The generated JSON Schema for the `hx-v1` wire contract.
//!
//! Each crate that serves methods adds them to a [`SchemaBuilder`]. The binary's library
//! (`hx::schema`) builds the full document, commits it as `schema/hx-v1.schema.json` in this
//! crate, and a test fails if it is stale. Python types are generated from it. To update it
//! after changing a wire type:
//!
//! ```text
//! cargo test -p hx -- --ignored bless_schema
//! ```

use schemars::JsonSchema;
use schemars::generate::{SchemaGenerator, SchemaSettings};
use serde_json::{Map, Value, json};

use crate::describe::{DescribeResult, PROTOCOL};
use crate::error::codes;
use crate::method;
use crate::txn::{
    AbortedBeforeWriteData, ApplyFailedData, ApplyParams, ApplyResult, DiscardResult, JournalData,
    JournalRef, PathsData, RecoverParams, RecoverResult, RestoreResult, ValidateParams,
    ValidateResult,
};

/// Collects methods and error data types from every crate that serves methods, then builds
/// the schema document. One generator is shared, so a type used by two methods appears once
/// in `$defs`.
pub struct SchemaBuilder {
    generator: SchemaGenerator,
    methods: Map<String, Value>,
    errors: Map<String, Value>,
}

impl Default for SchemaBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for SchemaBuilder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SchemaBuilder")
            .field("methods", &self.methods.keys().collect::<Vec<_>>())
            .finish_non_exhaustive()
    }
}

impl SchemaBuilder {
    /// An empty builder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            generator: SchemaSettings::draft2020_12().into_generator(),
            methods: Map::new(),
            errors: Map::new(),
        }
    }

    /// Adds a method with typed params and result.
    pub fn method<P: JsonSchema, R: JsonSchema>(&mut self, name: &str) -> &mut Self {
        let params = self.generator.subschema_for::<P>().to_value();
        let result = self.generator.subschema_for::<R>().to_value();
        self.methods.insert(
            name.to_owned(),
            json!({ "params": params, "result": result }),
        );
        self
    }

    /// Adds a method that takes no params.
    pub fn method_without_params<R: JsonSchema>(&mut self, name: &str) -> &mut Self {
        let result = self.generator.subschema_for::<R>().to_value();
        self.methods
            .insert(name.to_owned(), json!({ "params": null, "result": result }));
        self
    }

    /// Types the extra fields of `error.data` for a catalog code.
    pub fn error_data<D: JsonSchema>(&mut self, code: &str) -> &mut Self {
        let data = self.generator.subschema_for::<D>().to_value();
        self.errors.insert(code.to_owned(), json!({ "data": data }));
        self
    }

    /// The finished document:
    /// `{ $schema, title, protocol, methods: {name: {params, result}}, errors: {code: {data}}, $defs }`.
    ///
    /// Output is deterministic (sorted keys), so it diffs cleanly.
    #[must_use]
    pub fn finish(mut self) -> Value {
        let defs = self.generator.take_definitions(true);
        json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "hx-v1",
            "protocol": PROTOCOL,
            "methods": self.methods,
            "errors": self.errors,
            "$defs": defs,
        })
    }
}

/// Adds the methods this crate defines: `hx.describe` and `txn.*`.
pub fn add_core(b: &mut SchemaBuilder) {
    b.method_without_params::<DescribeResult>(method::DESCRIBE);
    b.method::<ValidateParams, ValidateResult>(method::TXN_VALIDATE);
    b.method::<ApplyParams, ApplyResult>(method::TXN_APPLY);
    b.method::<JournalRef, RestoreResult>(method::TXN_RESTORE);
    b.method::<JournalRef, DiscardResult>(method::TXN_DISCARD);
    b.method::<RecoverParams, RecoverResult>(method::TXN_RECOVER);
    b.error_data::<AbortedBeforeWriteData>(codes::HX_TXN_ABORTED_BEFORE_WRITE);
    b.error_data::<PathsData>(codes::HX_TXN_SCOPE_VIOLATION);
    b.error_data::<PathsData>(codes::HX_TXN_PROTECTED_PATH);
    b.error_data::<ApplyFailedData>(codes::HX_TXN_APPLY_FAILED);
    for code in [
        codes::HX_TXN_JOURNAL_NOT_FOUND,
        codes::HX_TXN_JOURNAL_CORRUPT,
        codes::HX_TXN_JOURNAL_BUSY,
        codes::HX_TXN_INVALID_STATE,
        codes::HX_TXN_RESTORE_FAILED,
    ] {
        b.error_data::<JournalData>(code);
    }
}

/// The schema of this crate's own methods only. The full `hx-v1` document, which adds the
/// methods of every handler crate, is built by the `hx` binary's library (`hx::schema`)
/// because `hx-proto` cannot depend on the crates that depend on it.
#[must_use]
pub fn core_document() -> Value {
    let mut b = SchemaBuilder::new();
    add_core(&mut b);
    b.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_method_has_params_and_result() {
        let doc = core_document();
        let methods = doc["methods"].as_object().unwrap();
        for name in [
            "hx.describe",
            "txn.validate",
            "txn.apply",
            "txn.restore",
            "txn.discard",
            "txn.recover",
        ] {
            assert!(methods[name].get("result").is_some(), "{name}");
        }
        assert!(doc["$defs"].get("Edit").is_some());
        // The failure types ride in error data, so they must be in the schema too.
        for def in ["EditFailure", "FailureKind", "ClosestMatch"] {
            assert!(doc["$defs"].get(def).is_some(), "{def}");
        }
        assert!(doc["errors"]["hx.txn.aborted_before_write"]["data"].is_object());
        // Every key is a real catalog code.
        for code in doc["errors"].as_object().unwrap().keys() {
            assert!(codes::ALL.contains(&code.as_str()), "{code}");
        }
    }
}
