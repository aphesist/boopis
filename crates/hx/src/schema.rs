//! The full `hx-v1` JSON Schema: every handler crate's methods in one document.
//!
//! The committed copy lives in `hx-proto/schema/hx-v1.schema.json` (the Python plugin
//! generates its types from it). A test fails if it is stale. To update it after changing a
//! wire type:
//!
//! ```text
//! cargo test -p hx -- --ignored bless_schema
//! ```

use hx_proto::schema::{SchemaBuilder, add_core};
use serde_json::Value;

/// Builds the schema document from `hx-proto`'s methods and every handler crate's.
#[must_use]
pub fn schema_document() -> Value {
    let mut b = SchemaBuilder::new();
    add_core(&mut b);
    hx_sandbox::add_schema(&mut b);
    b.finish()
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
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../hx-proto/schema/hx-v1.schema.json")
    }

    #[test]
    fn committed_schema_is_current() {
        let expected = schema_text().unwrap();
        let actual = std::fs::read_to_string(committed_path()).unwrap_or_default();
        assert!(
            actual == expected,
            "hx-proto/schema/hx-v1.schema.json is stale; run `cargo test -p hx -- --ignored bless_schema`"
        );
    }

    /// Rewrites the committed schema. Run it after changing a wire type.
    #[test]
    #[ignore = "writes hx-proto/schema/hx-v1.schema.json"]
    fn bless_schema() {
        std::fs::write(committed_path(), schema_text().unwrap()).unwrap();
    }

    #[test]
    fn every_registered_method_has_a_schema_and_every_error_a_catalog_code() {
        let doc = schema_document();
        let methods = doc["methods"].as_object().unwrap();
        for name in crate::build_dispatcher().methods() {
            assert!(methods[name].get("result").is_some(), "{name}");
        }
        assert_eq!(methods.len(), crate::build_dispatcher().methods().len());
        for code in doc["errors"].as_object().unwrap().keys() {
            assert!(hx_proto::codes::ALL.contains(&code.as_str()), "{code}");
        }
    }
}
