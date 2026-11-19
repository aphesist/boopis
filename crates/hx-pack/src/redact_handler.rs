//! `redact.apply`: the plugin redacts free text through `hx`, so the rules keep one implementation
//! (docs/DECISIONS.md ADR-0016). The text is the plugin's own (an exec cell's output, a ledger
//! note, a log line), so there is no file name: only the entropy and pattern rules apply.

use hx_proto::AppError;
use hx_proto::method::{self, Namespace};
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::schema::SchemaBuilder;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::redact::redact;

/// The request of `redact.apply`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RedactRequest {
    /// The text to redact.
    pub text: String,
}

/// The answer of `redact.apply`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RedactResponse {
    /// The text with each secret replaced by `[REDACTED:<rule>]`. Line count is preserved.
    pub text: String,
    /// How many redactions the returned text contains.
    pub count: usize,
}

/// Redacts `req.text` with the embedded rules.
///
/// # Errors
/// `hx.pack.config_invalid` if the embedded rules do not load.
pub fn handle_redact(req: &RedactRequest) -> crate::error::Result<RedactResponse> {
    let (text, found) = redact("", &req.text)?;
    Ok(RedactResponse {
        text: text.into_owned(),
        count: found.total,
    })
}

/// Serves `redact.apply`.
#[derive(Debug, Clone, Copy, Default)]
pub struct RedactHandler;

/// Adds `redact.apply` to the schema.
pub fn add_redact_schema(b: &mut SchemaBuilder) {
    b.method::<RedactRequest, RedactResponse>(method::REDACT_APPLY);
}

impl Handler for RedactHandler {
    fn namespace(&self) -> Namespace {
        Namespace::Redact
    }

    fn methods(&self) -> &'static [&'static str] {
        &[method::REDACT_APPLY]
    }

    fn capabilities(&self) -> Vec<String> {
        vec!["redact.apply".to_owned()]
    }

    fn call<'a>(
        &'a self,
        _method: &'a str,
        params: Value,
        _ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        Box::pin(async move {
            // Redaction is CPU-bound and fast; a large text still must not stall the reactor.
            tokio::task::spawn_blocking(move || -> HandlerResult {
                to_result(&handle_redact(&parse_params(params)?)?)
            })
            .await
            .unwrap_or_else(|e| Err(AppError::internal(format!("the redact task failed: {e}"))))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_a_key_and_counts_it() {
        let req = RedactRequest {
            text: "token sk-live-0123456789abcdefghijklmnopqrstuv\nsecond line".to_owned(),
        };
        let out = handle_redact(&req).unwrap();
        assert!(out.text.contains("[REDACTED:"), "{}", out.text);
        assert!(!out.text.contains("0123456789abcdef"));
        assert_eq!(out.count, 1);
        assert_eq!(out.text.lines().count(), 2);
    }

    #[test]
    fn plain_text_is_unchanged() {
        let out = handle_redact(&RedactRequest {
            text: "nothing secret here".to_owned(),
        })
        .unwrap();
        assert_eq!((out.text.as_str(), out.count), ("nothing secret here", 0));
    }
}
