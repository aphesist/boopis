//! The `endpoint` form (an endpoint of the person's own, or a runtime on this computer written as one) and what its commands
//! take and answer: `provider_test_endpoint`, `provider_add_endpoint`. The fields, the address rules, the slug rule and the
//! limits are data (`providers.json`, `endpoint`); this module has the typed requests and the form's schema builder.
//!
//! The key travels in the request, from the card to the host, once; it is never in a result, a log line or `Debug` output,
//! and never in text on the page.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;

use super::{ApiMode, EndpointField, catalogue};

/// The form kind of the endpoint card (`docs/FORMS.md`).
pub const KIND: &str = "endpoint";
/// The form's id.
pub const FORM_ID: &str = "provider.endpoint";

/// What Test asks: one address, one wire, an optional key.
#[derive(Deserialize, Type)]
pub struct EndpointTestRequest {
    /// The address typed.
    pub base_url: String,
    /// The wire the server speaks.
    pub api_mode: ApiMode,
    /// The key typed, when there is one. Sent only to `base_url`.
    pub key: Option<String>,
}

impl fmt::Debug for EndpointTestRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EndpointTestRequest")
            .field("base_url", &self.base_url)
            .field("api_mode", &self.api_mode)
            .field("key", &self.key.as_ref().map(|_| "<hidden>"))
            .finish()
    }
}

/// What Test found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EndpointOutcome {
    /// It listed models.
    Listed,
    /// It answered like a model server but lists none (add ids by hand).
    Empty,
    /// It refused: a key is needed, or the one given is wrong (401 or 403).
    NeedsKey,
    /// Nothing answered in time, or the connection failed.
    Unreachable,
    /// Something answered, but not like a model server (an HTML page, another shape).
    NotAModelServer,
}

/// The result of a Test. A dial that failed is an outcome here, not an error; an address that may not be dialled at all is
/// the error `hx.provider.endpoint_invalid` or `hx.provider.endpoint_blocked`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct EndpointTestResult {
    /// What happened.
    pub outcome: EndpointOutcome,
    /// The model ids found, at most `limits.max_models`.
    pub models: Vec<String>,
    /// The address that answered (no query), when one did.
    pub answered_at: Option<String>,
    /// The HTTP status, when there was one.
    pub status: Option<u16>,
    /// Whether the address is on this computer.
    pub loopback: bool,
    /// A stable code for a failed outcome (`hx.provider.key_rejected`, `unreachable`, `no_models`, `not_a_model_server`).
    pub code: Option<String>,
    /// One plain line, never the server's own text and never a secret.
    pub detail: Option<String>,
}

/// An endpoint to save.
#[derive(Deserialize, Type)]
pub struct EndpointRequest {
    /// What the person calls it; the slug is derived from it.
    pub name: String,
    /// The address.
    pub base_url: String,
    /// The wire.
    pub api_mode: ApiMode,
    /// The key, when there is one: kept in the keychain, wired as `key_env`.
    pub key: Option<String>,
    /// The ids to save (ticked from Test, and typed by hand).
    pub models: Vec<String>,
    /// Ask the server for its models whenever the list is needed (`discover_models`).
    pub discover: bool,
    /// Context length, when the person set one.
    pub context_length: Option<u32>,
    /// Request timeout in seconds; `None` is the catalogue's default (longer on this computer).
    pub request_timeout_s: Option<u32>,
    /// A model (one of `models`) to also set as the person's model, or `None` to leave the model alone.
    pub use_model: Option<String>,
    /// The profile.
    pub profile: Option<String>,
}

impl fmt::Debug for EndpointRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EndpointRequest")
            .field("name", &self.name)
            .field("base_url", &self.base_url)
            .field("api_mode", &self.api_mode)
            .field("key", &self.key.as_ref().map(|_| "<hidden>"))
            .field("models", &self.models)
            .field("discover", &self.discover)
            .finish_non_exhaustive()
    }
}

fn property(f: &EndpointField) -> Value {
    let mut p = serde_json::Map::new();
    p.insert("type".into(), f.r#type.clone().into());
    p.insert("title".into(), f.title.clone().into());
    p.insert("description".into(), f.description.clone().into());
    if let Some(v) = &f.format {
        p.insert("format".into(), v.clone().into());
    }
    if let Some(v) = &f.placeholder {
        p.insert("placeholder".into(), v.clone().into());
    }
    if let Some(v) = &f.r#enum {
        p.insert("enum".into(), json!(v));
    }
    if let Some(v) = &f.enum_names {
        p.insert("enumNames".into(), json!(v));
    }
    if let Some(v) = &f.default {
        p.insert("default".into(), v.clone());
    }
    for (on, key) in [
        (f.secret, "x-secret"),
        (f.multi, "x-multi"),
        (f.multiline, "x-multiline"),
        (f.mono, "x-mono"),
    ] {
        if on {
            p.insert(key.into(), true.into());
        }
    }
    Value::Object(p)
}

/// The schema of the `endpoint` form. `found` is what Test listed: `None` before Test (the model checklist is absent), `Some`
/// after (the checklist offers exactly those ids, all ticked). The secret field never has a default, a value or a reference.
#[must_use]
pub fn form_schema(found: Option<&[String]>) -> Value {
    let rules = &catalogue().endpoint;
    let mut props = serde_json::Map::new();
    let mut required = Vec::new();
    for f in &rules.fields {
        if f.after_test && found.is_none_or(<[String]>::is_empty) {
            continue;
        }
        let mut p = property(f);
        if f.after_test
            && let Some(ids) = found
        {
            p["enum"] = json!(ids);
            p["enumNames"] = json!(ids);
            p["default"] = json!(ids);
        }
        props.insert(f.name.clone(), p);
        if f.required {
            required.push(f.name.clone());
        }
    }
    json!({"type": "object", "required": required, "properties": props})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_form_has_the_five_parts_and_the_checklist_only_after_a_test() {
        let before = form_schema(None);
        let names: Vec<&str> = before["properties"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        for want in ["base_url", "key", "api_mode", "extra_models", "discover"] {
            assert!(names.contains(&want), "{want}");
        }
        assert!(!names.contains(&"picks"));
        let after = form_schema(Some(&["a".to_owned(), "b".to_owned()]));
        assert_eq!(after["properties"]["picks"]["enum"], json!(["a", "b"]));
        assert_eq!(after["properties"]["picks"]["x-multi"], true);
        assert_eq!(form_schema(Some(&[]))["properties"].get("picks"), None);
        assert_eq!(before["required"], json!(["name", "base_url", "api_mode"]));
    }

    #[test]
    fn the_key_field_is_secret_and_carries_no_value_or_reference() {
        let s = form_schema(None);
        let key = &s["properties"]["key"];
        assert_eq!(key["x-secret"], true);
        for bad in ["default", "enum", "x-secret-ref"] {
            assert!(key.get(bad).is_none(), "{bad}");
        }
        let only: Vec<_> = s["properties"]
            .as_object()
            .unwrap()
            .iter()
            .filter(|(_, v)| v["x-secret"] == true)
            .collect();
        assert_eq!(only.len(), 1);
    }

    #[test]
    fn a_key_never_shows_in_debug_output() {
        let t = EndpointTestRequest {
            base_url: "http://127.0.0.1:1/v1".into(),
            api_mode: ApiMode::ChatCompletions,
            key: Some("sk-secret-123".into()),
        };
        let r = EndpointRequest {
            name: "x".into(),
            base_url: "http://127.0.0.1:1/v1".into(),
            api_mode: ApiMode::ChatCompletions,
            key: Some("sk-secret-123".into()),
            models: vec![],
            discover: true,
            context_length: None,
            request_timeout_s: None,
            use_model: None,
            profile: None,
        };
        assert!(!format!("{t:?}{r:?}").contains("sk-secret"));
    }
}
