//! The generated JSON Schema for the whole `hx-v1` wire contract.
//!
//! `schema/hx-v1.schema.json` is committed. A test fails if it is stale. Python types are
//! generated from it. To update it after changing a wire type:
//!
//! ```text
//! cargo test -p hx-proto -- --ignored bless_schema
//! ```

use schemars::generate::SchemaSettings;
use serde_json::{Map, Value, json};

use crate::describe::{DescribeResult, PROTOCOL};
use crate::error::codes;
use crate::method;
use crate::txn::{
    AbortedBeforeWriteData, ApplyFailedData, ApplyParams, ApplyResult, DiscardResult, JournalData,
    JournalRef, PathsData, RecoverParams, RecoverResult, RestoreResult, ValidateParams,
    ValidateResult,
};

/// Builds the schema document:
/// `{ $schema, title, protocol, methods: {name: {params, result}}, errors: {code: {data}}, $defs }`.
///
/// `errors` types the extra fields of `error.data` for the codes that carry any.
///
/// Output is deterministic (sorted keys), so it diffs cleanly.
#[must_use]
pub fn schema_document() -> Value {
    let mut generator = SchemaSettings::draft2020_12().into_generator();
    let mut methods = Map::new();

    macro_rules! method {
        ($name:expr, $params:ty, $result:ty) => {{
            let params = generator.subschema_for::<$params>().to_value();
            let result = generator.subschema_for::<$result>().to_value();
            methods.insert($name.to_owned(), json!({ "params": params, "result": result }));
        }};
    }

    methods.insert(
        method::DESCRIBE.to_owned(),
        json!({ "params": null, "result": generator.subschema_for::<DescribeResult>().to_value() }),
    );
    method!(method::TXN_VALIDATE, ValidateParams, ValidateResult);
    method!(method::TXN_APPLY, ApplyParams, ApplyResult);
    method!(method::TXN_RESTORE, JournalRef, RestoreResult);
    method!(method::TXN_DISCARD, JournalRef, DiscardResult);
    method!(method::TXN_RECOVER, RecoverParams, RecoverResult);

    let mut errors = Map::new();
    macro_rules! error_data {
        ($code:expr, $data:ty) => {{
            let data = generator.subschema_for::<$data>().to_value();
            errors.insert($code.to_owned(), json!({ "data": data }));
        }};
    }
    error_data!(codes::HX_TXN_ABORTED_BEFORE_WRITE, AbortedBeforeWriteData);
    error_data!(codes::HX_TXN_SCOPE_VIOLATION, PathsData);
    error_data!(codes::HX_TXN_PROTECTED_PATH, PathsData);
    error_data!(codes::HX_TXN_APPLY_FAILED, ApplyFailedData);
    for code in [
        codes::HX_TXN_JOURNAL_NOT_FOUND,
        codes::HX_TXN_JOURNAL_CORRUPT,
        codes::HX_TXN_JOURNAL_BUSY,
        codes::HX_TXN_INVALID_STATE,
        codes::HX_TXN_RESTORE_FAILED,
    ] {
        error_data!(code, JournalData);
    }

    let defs = generator.take_definitions(true);
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "hx-v1",
        "protocol": PROTOCOL,
        "methods": methods,
        "errors": errors,
        "$defs": defs,
    })
}

/// The schema as committed: pretty-printed with a trailing newline.
///
/// # Errors
/// Never in practice; serialising a `Value` cannot fail.
pub fn schema_text() -> Result<String, serde_json::Error> {
    let mut text = serde_json::to_string_pretty(&schema_document())?;
    text.push('\n');
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn committed_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schema/hx-v1.schema.json")
    }

    #[test]
    fn committed_schema_is_current() {
        let expected = schema_text().unwrap();
        let actual = std::fs::read_to_string(committed_path()).unwrap_or_default();
        assert!(
            actual == expected,
            "schema/hx-v1.schema.json is stale; run `cargo test -p hx-proto -- --ignored bless_schema`"
        );
    }

    /// Rewrites the committed schema. Run it after changing a wire type.
    #[test]
    #[ignore = "writes schema/hx-v1.schema.json"]
    fn bless_schema() {
        std::fs::write(committed_path(), schema_text().unwrap()).unwrap();
    }

    #[test]
    fn every_method_has_params_and_result() {
        let doc = schema_document();
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
