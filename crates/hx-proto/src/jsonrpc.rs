//! JSON-RPC 2.0 framing: newline-delimited JSON over stdio.
//!
//! One frame is one line of JSON terminated by `\n`. A frame never contains a raw newline
//! (`serde_json` escapes them), so the framing is unambiguous.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, codes};

/// The only protocol version string accepted and produced.
pub const JSONRPC_VERSION: &str = "2.0";

/// A request or response id: a number or a string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    /// A numeric id.
    Num(i64),
    /// A string id.
    Str(String),
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Id::Num(n) => write!(f, "{n}"),
            Id::Str(s) => f.write_str(s),
        }
    }
}

/// A request, or a notification when `id` is absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    /// Always `"2.0"`.
    pub jsonrpc: String,
    /// Absent for notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Id>,
    /// The method name, `area.verb`.
    pub method: String,
    /// The method's parameters, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    /// Builds a request that expects a response.
    #[must_use]
    pub fn new(id: Id, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id: Some(id),
            method: method.into(),
            params,
        }
    }

    /// True when the sender expects no response.
    #[must_use]
    pub fn is_notification(&self) -> bool {
        self.id.is_none()
    }
}

/// A notification sent by `hx` to the client (never answered).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    /// Always `"2.0"`.
    pub jsonrpc: String,
    /// The notification name, `area.noun_or_past_participle`.
    pub method: String,
    /// The payload, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Notification {
    /// Builds a notification.
    #[must_use]
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            method: method.into(),
            params,
        }
    }
}

/// The JSON-RPC error object. Application errors use `-32000` and put the stable string code
/// in `data.code`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    /// Numeric code: the spec's for protocol errors, `-32000` for application errors.
    pub code: i64,
    /// A human-readable summary. Never parsed by clients.
    pub message: String,
    /// `{code: "<stable string>", ...details}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    /// The stable string code from `data.code`, if present.
    #[must_use]
    pub fn string_code(&self) -> Option<&str> {
        self.data.as_ref()?.get("code")?.as_str()
    }
}

/// A response: exactly one of `result` and `error` is set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    /// Always `"2.0"`.
    pub jsonrpc: String,
    /// The request's id, or `null` when it could not be read.
    pub id: Option<Id>,
    /// The success value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// The failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    /// A success response.
    #[must_use]
    pub fn ok(id: Option<Id>, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// A failure response.
    #[must_use]
    pub fn err(id: Option<Id>, error: &AppError) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            result: None,
            error: Some(error.to_rpc_error()),
        }
    }

    /// Serialises to one frame, without the trailing newline.
    ///
    /// # Errors
    /// Fails only if a `result` value cannot be serialised, which `serde_json::Value` never does.
    pub fn to_frame(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// Parses one incoming frame into a [`Request`].
///
/// Returns the protocol error to send back, with the id when it could be read.
///
/// # Errors
/// - invalid JSON: `hx.parse_error`;
/// - a batch, a non-object, a missing method or a wrong version: `hx.invalid_request`.
pub fn parse_request(frame: &str) -> Result<Request, (Option<Id>, AppError)> {
    let value: Value = serde_json::from_str(frame)
        .map_err(|e| (None, AppError::new(codes::HX_PARSE_ERROR, e.to_string())))?;
    let invalid = |id: Option<Id>, why: &str| (id, AppError::new(codes::HX_INVALID_REQUEST, why));
    let Value::Object(map) = &value else {
        let why = if value.is_array() {
            "batch requests are not supported"
        } else {
            "a request must be a JSON object"
        };
        return Err(invalid(None, why));
    };
    let id = map
        .get("id")
        .and_then(|v| serde_json::from_value::<Id>(v.clone()).ok());
    if map.get("jsonrpc").and_then(Value::as_str) != Some(JSONRPC_VERSION) {
        return Err(invalid(id, "jsonrpc must be \"2.0\""));
    }
    if map.get("id").is_some_and(|v| !v.is_null()) && id.is_none() {
        return Err(invalid(None, "id must be a number or a string"));
    }
    if !map.get("method").is_some_and(Value::is_string) {
        return Err(invalid(id, "method must be a string"));
    }
    serde_json::from_value::<Request>(value).map_err(|e| invalid(id, &e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips() {
        let req = Request::new(Id::Num(7), "txn.apply", Some(json!({"a": 1})));
        let frame = serde_json::to_string(&req).unwrap();
        assert!(!frame.contains('\n'));
        assert_eq!(parse_request(&frame).unwrap(), req);
    }

    #[test]
    fn notification_has_no_id() {
        let req =
            parse_request(r#"{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":1}}"#)
                .unwrap();
        assert!(req.is_notification());
    }

    #[test]
    fn string_ids_are_kept() {
        let req = parse_request(r#"{"jsonrpc":"2.0","id":"abc","method":"x.y"}"#).unwrap();
        assert_eq!(req.id, Some(Id::Str("abc".into())));
    }

    #[test]
    fn bad_json_is_a_parse_error() {
        let (id, err) = parse_request("{not json").unwrap_err();
        assert_eq!(id, None);
        assert_eq!(err.code, codes::HX_PARSE_ERROR);
    }

    #[test]
    fn batches_and_scalars_are_invalid_requests() {
        for frame in ["[]", "[{}]", "42", "\"x\"", "null"] {
            let (_, err) = parse_request(frame).unwrap_err();
            assert_eq!(err.code, codes::HX_INVALID_REQUEST, "{frame}");
        }
    }

    #[test]
    fn wrong_version_keeps_the_id() {
        let (id, err) = parse_request(r#"{"jsonrpc":"1.0","id":3,"method":"a.b"}"#).unwrap_err();
        assert_eq!(id, Some(Id::Num(3)));
        assert_eq!(err.code, codes::HX_INVALID_REQUEST);
    }

    #[test]
    fn missing_method_is_invalid() {
        let (_, err) = parse_request(r#"{"jsonrpc":"2.0","id":3}"#).unwrap_err();
        assert_eq!(err.code, codes::HX_INVALID_REQUEST);
    }

    #[test]
    fn error_response_carries_the_string_code() {
        let resp = Response::err(
            Some(Id::Num(1)),
            &AppError::new(codes::HX_CANCELLED, "stop"),
        );
        let rpc = resp.error.unwrap();
        assert_eq!(rpc.code, -32000);
        assert_eq!(rpc.string_code(), Some("hx.cancelled"));
        assert!(resp.result.is_none());
    }
}
