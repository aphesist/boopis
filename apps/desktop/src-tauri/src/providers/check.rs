//! What a model listing says: the Test step of an endpoint and the check that follows a saved key (ADR-0039). One `GET` of `/models`
//! (then `/v1/models`) through [`Transport`], classified into an outcome. The answer's own text is never shown or kept (it may echo
//! a key): only the model ids, the status and one plain line made here.

use std::fmt::Write as _;

use serde_json::Value;

use super::ApiMode;
use super::endpoint::{EndpointOutcome, EndpointTestResult};
use super::http::{Address, Reply, Transport, get};
use crate::error::Result;

/// What one listing held.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Listing {
    /// A model server's list (possibly empty): the ids.
    Models(Vec<String>),
    /// Something else: an HTML page, an error object, another shape.
    Other,
}

fn id_of(v: &Value) -> Option<String> {
    let text = match v {
        Value::String(s) => s.as_str(),
        Value::Object(o) => ["id", "name", "model"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_str))?,
        _ => return None,
    };
    // Google lists `models/gemini-...`; the engine and the ladder name the model without it
    Some(text.strip_prefix("models/").unwrap_or(text).to_owned())
}

/// Read a listing in the shapes servers use: `{"data": [{"id"}]}` (OpenAI, Anthropic, `OpenRouter`, vLLM, LM Studio),
/// `{"models": [{"name"} | {"model"}]}` (Ollama, Google), or a bare array. Ids are de-duplicated in order, an id with a control
/// character or over `max_chars` is dropped, and at most `max` are kept.
#[must_use]
pub fn parse_listing(body: &str, max: usize, max_chars: usize) -> Listing {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return Listing::Other;
    };
    let list = match &v {
        Value::Array(a) => Some(a),
        Value::Object(o) => ["data", "models"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_array)),
        _ => None,
    };
    let Some(list) = list else {
        return Listing::Other;
    };
    let mut ids: Vec<String> = Vec::new();
    for id in list.iter().filter_map(id_of) {
        let ok = !id.trim().is_empty()
            && id.chars().count() <= max_chars
            && !id.chars().any(char::is_control);
        if ok && !ids.contains(&id) {
            ids.push(id);
        }
        if ids.len() == max {
            break;
        }
    }
    Listing::Models(ids)
}

/// The headers a listing is asked with: the key as the wire says (a bearer token for the OpenAI modes, `x-api-key` and the version
/// for Anthropic's), plus Google's own header for a Google address, whose listing refuses a bearer key. Only the address typed ever
/// sees them.
#[must_use]
pub fn auth_headers(mode: ApiMode, key: Option<&str>, host: &str) -> Vec<(String, String)> {
    let mut h = Vec::new();
    if mode == ApiMode::AnthropicMessages {
        h.push(("anthropic-version".to_owned(), "2023-06-01".to_owned()));
    }
    let Some(key) = key.filter(|k| !k.is_empty()) else {
        return h;
    };
    if mode == ApiMode::AnthropicMessages {
        h.push(("x-api-key".to_owned(), key.to_owned()));
    } else {
        h.push(("Authorization".to_owned(), format!("Bearer {key}")));
        if host.ends_with("googleapis.com") {
            h.push(("x-goog-api-key".to_owned(), key.to_owned()));
        }
    }
    h
}

/// How one attempt came out.
enum Attempt {
    Answered(EndpointOutcome, Vec<String>, u16),
    Silent,
}

/// Whether an answer refuses the key: 401 or 403, or a 400 whose error is about the key. A listing is a bare `GET` whose only
/// variable is the key, and some providers (xAI) answer a wrong one with 400 and "Incorrect API key provided"; the words stay here.
#[must_use]
pub fn refuses_key(reply: &Reply) -> bool {
    match reply.status {
        401 | 403 => true,
        400 => {
            let lower = reply
                .body
                .chars()
                .take(2048)
                .collect::<String>()
                .to_ascii_lowercase();
            [
                "api key",
                "api_key",
                "apikey",
                "authenticat",
                "unauthorized",
                "credential",
            ]
            .iter()
            .any(|w| lower.contains(w))
        }
        _ => false,
    }
}

fn classify(reply: &Reply, max: usize, max_chars: usize) -> Attempt {
    let status = reply.status;
    let outcome_models = match status {
        _ if refuses_key(reply) => (EndpointOutcome::NeedsKey, Vec::new()),
        200..=299 => match parse_listing(&reply.body, max, max_chars) {
            Listing::Models(m) if m.is_empty() => (EndpointOutcome::Empty, m),
            Listing::Models(m) => (EndpointOutcome::Listed, m),
            Listing::Other => (EndpointOutcome::NotAModelServer, Vec::new()),
        },
        _ => (EndpointOutcome::NotAModelServer, Vec::new()),
    };
    Attempt::Answered(outcome_models.0, outcome_models.1, status)
}

fn limits() -> (usize, usize, u64) {
    let c = &super::catalogue().endpoint;
    let timeout = c.test["timeout_ms"].as_u64().unwrap_or(10_000);
    (
        c.limits.max_models as usize,
        c.limits.max_model_id_chars as usize,
        timeout,
    )
}

/// The timeout of a listing, from the data (`endpoint.test.timeout_ms`).
#[must_use]
pub fn timeout() -> std::time::Duration {
    std::time::Duration::from_millis(limits().2)
}

/// The paths a listing is asked at, from the data (`endpoint.test.paths`).
fn paths() -> Vec<String> {
    super::catalogue().endpoint.test["paths"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_str().map(str::to_owned))
                .collect()
        })
        .filter(|p: &Vec<String>| !p.is_empty())
        .unwrap_or_else(|| vec!["/models".to_owned(), "/v1/models".to_owned()])
}

/// Test an endpoint: one `GET` per path, the first that answers like a model server (a list, an empty list, or a refusal for a key)
/// wins; a path that answers otherwise (404, an HTML page) hands over to the next. Saves and changes nothing.
///
/// # Errors
/// `hx.provider.endpoint_blocked` when the server redirects to another origin. A failed dial is an outcome.
pub fn test_endpoint(
    t: &dyn Transport,
    address: &Address,
    mode: ApiMode,
    key: Option<&str>,
) -> Result<EndpointTestResult> {
    let (max, max_chars, _) = limits();
    let host = url::Url::parse(&address.text())
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    let headers = auth_headers(mode, key, &host);
    let mut last: Option<(Attempt, String)> = None;
    for path in paths() {
        let url = address.join(&path);
        let attempt = match get(t, address, &url, &headers)? {
            Ok(reply) => classify(&reply, max, max_chars),
            Err(e) => {
                crate::error::keep("hx.provider.unreachable", &format!("{url}: {e}"));
                Attempt::Silent
            }
        };
        let done = matches!(
            attempt,
            Attempt::Answered(
                EndpointOutcome::Listed | EndpointOutcome::Empty | EndpointOutcome::NeedsKey,
                ..
            )
        );
        let silent = matches!(attempt, Attempt::Silent);
        last = Some((attempt, url));
        if done || silent {
            break; // nothing answered: the same host will not answer the second path either
        }
    }
    Ok(result_of(last, address.loopback))
}

fn result_of(last: Option<(Attempt, String)>, loopback: bool) -> EndpointTestResult {
    let mut r = EndpointTestResult {
        outcome: EndpointOutcome::Unreachable,
        models: Vec::new(),
        answered_at: None,
        status: None,
        loopback,
        code: Some("hx.provider.unreachable".into()),
        detail: Some(if loopback {
            "Nothing answered. Check the address, and that the server is running.".into()
        } else {
            "Nothing answered. Check the address, and your internet connection or proxy.".into()
        }),
    };
    let Some((Attempt::Answered(outcome, models, status), url)) = last else {
        return r;
    };
    r.outcome = outcome;
    r.status = Some(status);
    r.answered_at = Some(url);
    r.code = None;
    r.detail = None;
    match outcome {
        EndpointOutcome::Listed => {
            let mut line = format!("Found {} model", models.len());
            if models.len() != 1 {
                line.push('s');
            }
            let _ = write!(line, ".");
            r.detail = Some(line);
        }
        EndpointOutcome::Empty => {
            r.code = Some("hx.provider.no_models".into());
            r.detail =
                Some("The server answered but lists no models. Add the model ids by hand.".into());
        }
        EndpointOutcome::NeedsKey => {
            r.code = Some("hx.provider.key_rejected".into());
            r.detail = Some(
                "The server wants a key, or did not accept the one given. Add its key, or check the one you gave.".into(),
            );
        }
        EndpointOutcome::NotAModelServer => {
            r.code = Some("hx.provider.not_a_model_server".into());
            r.detail = Some("That address answered, but not like a model server. Check the address and the wire.".into());
        }
        EndpointOutcome::Unreachable => {}
    }
    r.models = models;
    r
}

/// What the check of a saved key found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyCheck {
    /// The provider listed models for the key.
    Accepted(u32),
    /// The provider answered (this status), but not with a listing the check can read: the key is saved and not verified.
    Unverified(u16),
    /// 401 or 403 (or a 400 about the key: [`refuses_key`]).
    Rejected,
    /// No answer.
    Unreachable,
    /// The listing is open to anyone: it listed models without the key too, so it cannot tell a wrong key from a right one. The key
    /// is saved and checked when it is first used.
    Public,
}

/// Check a key with one model listing at `listing_url` (a fixed address from the data, https), following no redirect to another origin.
///
/// # Errors
/// `hx.provider.endpoint_blocked` for a redirect to another origin (a provider that did so would be sent no key).
pub fn check_key(
    t: &dyn Transport,
    address: &Address,
    listing_url: &str,
    mode: ApiMode,
    key: &str,
) -> Result<KeyCheck> {
    let (max, max_chars, _) = limits();
    let host = url::Url::parse(listing_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    let headers = auth_headers(mode, Some(key), &host);
    Ok(match get(t, address, listing_url, &headers)? {
        Err(e) => {
            crate::error::keep("hx.provider.unreachable", &format!("{listing_url}: {e}"));
            KeyCheck::Unreachable
        }
        Ok(reply) => match classify(&reply, max, max_chars) {
            Attempt::Answered(EndpointOutcome::NeedsKey, ..) => KeyCheck::Rejected,
            Attempt::Answered(EndpointOutcome::Listed, m, _) => {
                KeyCheck::Accepted(u32::try_from(m.len()).unwrap_or(u32::MAX))
            }
            Attempt::Answered(EndpointOutcome::Empty, ..) => KeyCheck::Accepted(0),
            Attempt::Answered(_, _, status) => KeyCheck::Unverified(status),
            Attempt::Silent => KeyCheck::Unreachable,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shapes_servers_use() {
        let p = |b: &str| parse_listing(b, 50, 200);
        let m = |v: &[&str]| Listing::Models(v.iter().map(|s| (*s).to_owned()).collect());
        assert_eq!(
            p(r#"{"object":"list","data":[{"id":"gpt-x"},{"id":"gpt-y"}]}"#),
            m(&["gpt-x", "gpt-y"])
        );
        assert_eq!(
            p(r#"{"models":[{"name":"llama3:8b","model":"llama3:8b"},{"name":"qwen"}]}"#),
            m(&["llama3:8b", "qwen"])
        );
        assert_eq!(
            p(r#"{"models":[{"name":"models/gemini-4-neon"}]}"#),
            m(&["gemini-4-neon"])
        );
        assert_eq!(p(r#"["a","b","a"]"#), m(&["a", "b"]));
        assert_eq!(p(r#"{"data":[]}"#), m(&[]));
        assert_eq!(p("<html><body>hi</body></html>"), Listing::Other);
        assert_eq!(p(r#"{"error":{"message":"no"}}"#), Listing::Other);
        assert_eq!(p("42"), Listing::Other);
        assert_eq!(p(""), Listing::Other);
        // an id with a control character, an empty one and one over the limit are dropped
        assert_eq!(
            parse_listing(
                r#"{"data":[{"id":"a\u0007b"},{"id":""},{"id":"abcdef"},{"id":"ok"}]}"#,
                50,
                5
            ),
            m(&["ok"])
        );
        // the list is cut at the most the form keeps
        let many = format!(
            "{{\"data\":[{}]}}",
            (0..80)
                .map(|i| format!("{{\"id\":\"m{i}\"}}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        match parse_listing(&many, 50, 200) {
            Listing::Models(v) => assert_eq!(v.len(), 50),
            Listing::Other => panic!(),
        }
    }

    #[test]
    fn the_key_travels_as_the_wire_says() {
        let get = |m, k, h| auth_headers(m, k, h);
        assert_eq!(
            get(ApiMode::ChatCompletions, Some("k"), "api.example.com"),
            [("Authorization".to_owned(), "Bearer k".to_owned())]
        );
        let a = get(ApiMode::AnthropicMessages, Some("k"), "api.anthropic.com");
        assert!(
            a.contains(&("x-api-key".into(), "k".into()))
                && !a.iter().any(|(n, _)| n == "Authorization")
        );
        assert!(a.contains(&("anthropic-version".into(), "2023-06-01".into())));
        assert!(get(ApiMode::CodexResponses, None, "x").is_empty());
        assert!(get(ApiMode::ChatCompletions, Some(""), "x").is_empty());
        let g = get(
            ApiMode::ChatCompletions,
            Some("k"),
            "generativelanguage.googleapis.com",
        );
        assert!(g.contains(&("x-goog-api-key".into(), "k".into())));
        let other = get(ApiMode::ChatCompletions, Some("k"), "api.example.com");
        assert!(!other.iter().any(|(n, _)| n == "x-goog-api-key"));
    }
}
