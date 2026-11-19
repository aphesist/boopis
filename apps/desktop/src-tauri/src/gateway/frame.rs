//! Frame validation: shape and size, never content. A frame is a JSON-RPC 2.0 message; the host reads only the
//! envelope (`id`, `method`, and for events `type`, `session_id`, `seq`, `replay_epoch`) and forwards the original
//! text. The one thing it ever rewrites is the top-level `id` of a UI request, to keep ids unique across windows.

use serde::Deserialize;
use serde_json::value::RawValue;

use crate::error::{Error, Result};

/// A JSON-RPC id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(untagged)]
pub enum Id {
    /// An integer id.
    Num(i64),
    /// A string id.
    Str(String),
}

impl Id {
    /// The id as JSON.
    #[must_use]
    pub fn to_value(&self) -> serde_json::Value {
        match self {
            Self::Num(n) => serde_json::Value::from(*n),
            Self::Str(s) => serde_json::Value::from(s.clone()),
        }
    }
}

#[derive(Deserialize)]
struct Envelope<'a> {
    jsonrpc: &'a str,
    #[serde(default)]
    id: Option<Id>,
    #[serde(default, borrow)]
    method: Option<&'a str>,
    #[serde(default, borrow)]
    params: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct EventMeta<'a> {
    #[serde(default, rename = "type", borrow)]
    kind: Option<&'a str>,
    #[serde(default, borrow)]
    session_id: Option<&'a str>,
    #[serde(default)]
    seq: Option<u64>,
    #[serde(default, borrow)]
    replay_epoch: Option<&'a str>,
}

/// What a frame is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    /// A call that expects a response.
    Request {
        /// Its id.
        id: Id,
        /// The method.
        method: String,
    },
    /// A call with no response (`method: "event"` carries the gateway's events).
    Notification {
        /// The method.
        method: String,
    },
    /// An answer (result or error) to a request. `id` is `None` for an error to an unparseable request.
    Response {
        /// The id of the request it answers.
        id: Option<Id>,
    },
}

/// The envelope facts of a validated frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Meta {
    /// What it is.
    pub kind: Kind,
    /// For an `event` notification: the event type (`message.delta`, ...).
    pub event_type: Option<String>,
    /// For an event: the session it belongs to (empty for global events).
    pub session_id: Option<String>,
    /// For an event: the replay sequence number.
    pub seq: Option<u64>,
    /// For an event: the replay epoch.
    pub replay_epoch: Option<String>,
}

/// Validate a frame's text and read its envelope.
///
/// # Errors
/// `FrameTooLarge` over the cap; `InvalidFrame` when it is not a JSON-RPC 2.0 message.
pub fn classify(text: &str, limit: usize) -> Result<Meta> {
    if text.len() > limit {
        return Err(Error::FrameTooLarge {
            size: text.len(),
            limit,
        });
    }
    let env: Envelope<'_> =
        serde_json::from_str(text).map_err(|e| Error::InvalidFrame(e.to_string()))?;
    if env.jsonrpc != "2.0" {
        return Err(Error::InvalidFrame("jsonrpc must be \"2.0\"".into()));
    }
    let kind = match (env.method, env.id) {
        (Some(m), _) if !valid_method(m) => {
            return Err(Error::InvalidFrame("bad method name".into()));
        }
        (Some(m), Some(id)) => Kind::Request {
            id,
            method: m.to_owned(),
        },
        (Some(m), None) => Kind::Notification {
            method: m.to_owned(),
        },
        (None, id) => Kind::Response { id },
    };
    let mut meta = Meta {
        kind,
        event_type: None,
        session_id: None,
        seq: None,
        replay_epoch: None,
    };
    if matches!(&meta.kind, Kind::Notification { method } if method == "event")
        && let Some(p) = env.params
    {
        let ev: EventMeta<'_> = serde_json::from_str(p.get())
            .map_err(|e| Error::InvalidFrame(format!("event params: {e}")))?;
        meta.event_type = ev.kind.map(str::to_owned);
        meta.session_id = ev.session_id.filter(|s| !s.is_empty()).map(str::to_owned);
        meta.seq = ev.seq;
        meta.replay_epoch = ev.replay_epoch.map(str::to_owned);
    }
    Ok(meta)
}

fn valid_method(m: &str) -> bool {
    !m.is_empty()
        && m.len() <= 128
        && m.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/' | b'$'))
}

/// A frame from the UI, validated and ready to forward.
#[derive(Debug)]
pub struct Outgoing {
    /// What it is.
    pub kind: Kind,
    /// The frame as JSON. For a request its `id` has been replaced by the host's.
    pub value: serde_json::Value,
}

/// Validate a UI frame (a JSON value) and, when it is a request, swap its id for `host_id`.
/// A request's own id is returned in `kind` so the answer can be given back under it.
///
/// # Errors
/// `FrameTooLarge` over the cap; `InvalidFrame` when it is not a JSON-RPC 2.0 message.
pub fn prepare_outgoing(
    mut value: serde_json::Value,
    limit: usize,
    host_id: impl FnOnce() -> u64,
) -> Result<Outgoing> {
    let text = serde_json::to_string(&value).map_err(|e| Error::InvalidFrame(e.to_string()))?;
    let meta = classify(&text, limit)?;
    if let Kind::Request { .. } = &meta.kind
        && let Some(obj) = value.as_object_mut()
    {
        obj.insert("id".to_owned(), serde_json::Value::from(host_id()));
    }
    Ok(Outgoing {
        kind: meta.kind,
        value,
    })
}

/// A synthetic frame the host sends the UI about itself: a JSON-RPC `event` notification of type `connection.state`
/// or `connection.backpressure`, marked by its type namespace `connection.`.
#[must_use]
pub fn host_event(kind: &str, payload: &serde_json::Value) -> String {
    serde_json::json!({"jsonrpc": "2.0", "method": "event", "params": {"type": kind, "session_id": "", "payload": payload}}).to_string()
}

/// A host-made event about one session (type namespace `connection.`): like [`host_event`], with the session's id in the envelope
/// so the UI routes it to that session.
#[must_use]
pub fn host_session_event(kind: &str, session: &str, payload: &serde_json::Value) -> String {
    serde_json::json!({"jsonrpc": "2.0", "method": "event", "params": {"type": kind, "session_id": session, "payload": payload}}).to_string()
}

/// An error response to a UI request that cannot be forwarded.
#[must_use]
pub fn error_response(id: &Id, code: &str, message: &str) -> String {
    serde_json::json!({"jsonrpc": "2.0", "id": id.to_value(), "error": {"code": -32000, "message": message, "data": {"code": code}}}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAP: usize = 1 << 20;

    #[test]
    fn classifies_the_four_shapes() {
        let m = classify(
            r#"{"jsonrpc":"2.0","id":3,"method":"session.list","params":{}}"#,
            CAP,
        )
        .unwrap();
        assert_eq!(
            m.kind,
            Kind::Request {
                id: Id::Num(3),
                method: "session.list".into()
            }
        );
        let m = classify(r#"{"jsonrpc":"2.0","id":"a-1","method":"x"}"#, CAP).unwrap();
        assert_eq!(
            m.kind,
            Kind::Request {
                id: Id::Str("a-1".into()),
                method: "x".into()
            }
        );
        let m = classify(r#"{"jsonrpc":"2.0","id":3,"result":{"ok":true}}"#, CAP).unwrap();
        assert_eq!(
            m.kind,
            Kind::Response {
                id: Some(Id::Num(3))
            }
        );
        let m = classify(
            r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"x"}}"#,
            CAP,
        )
        .unwrap();
        assert_eq!(m.kind, Kind::Response { id: None });
        let m = classify(r#"{"jsonrpc":"2.0","method":"x"}"#, CAP).unwrap();
        assert_eq!(m.kind, Kind::Notification { method: "x".into() });
    }

    #[test]
    fn reads_the_event_envelope_from_a_real_gateway_frame() {
        let text = r#"{"jsonrpc":"2.0","method":"event","params":{"authority_epoch":10,"type":"message.delta","session_id":"local-7531","payload":{"text":null},"replay_epoch":"ed50","seq":9}}"#;
        let m = classify(text, CAP).unwrap();
        assert_eq!(m.event_type.as_deref(), Some("message.delta"));
        assert_eq!(m.session_id.as_deref(), Some("local-7531"));
        assert_eq!(m.seq, Some(9));
        assert_eq!(m.replay_epoch.as_deref(), Some("ed50"));
        let global = classify(r#"{"jsonrpc":"2.0","method":"event","params":{"type":"sessions.changed","session_id":"","payload":{}}}"#, CAP).unwrap();
        assert_eq!(global.session_id, None);
        assert_eq!(global.seq, None);
    }

    #[test]
    fn rejects_what_is_not_json_rpc() {
        for bad in [
            "not json",
            "[]",
            r#"{"id":1,"method":"x"}"#,
            r#"{"jsonrpc":"1.0","id":1,"method":"x"}"#,
            r#"{"jsonrpc":"2.0","id":1.5,"method":"x"}"#,
            r#"{"jsonrpc":"2.0","id":true,"method":"x"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":""}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"a b"}"#,
            r#"{"jsonrpc":"2.0","method":"event","params":"nope"}"#,
        ] {
            assert!(classify(bad, CAP).is_err(), "{bad}");
        }
    }

    #[test]
    fn enforces_the_size_cap() {
        let big = format!(
            r#"{{"jsonrpc":"2.0","method":"x","params":{{"t":"{}"}}}}"#,
            "a".repeat(200)
        );
        assert_eq!(
            classify(&big, 100).unwrap_err().code(),
            "hx.host.invalid_frame"
        );
        assert!(matches!(
            classify(&big, 100),
            Err(Error::FrameTooLarge { limit: 100, .. })
        ));
        assert!(classify(&big, 1000).is_ok());
    }

    #[test]
    fn outgoing_requests_get_a_host_id_and_params_are_untouched() {
        let v = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"prompt.submit","params":{"session_id":"s","text":"héllo","n":1.0,"big":[1,2,{"a":null}]}});
        let out = prepare_outgoing(v.clone(), CAP, || 77).unwrap();
        assert_eq!(
            out.kind,
            Kind::Request {
                id: Id::Num(1),
                method: "prompt.submit".into()
            }
        );
        assert_eq!(out.value["id"], 77);
        assert_eq!(out.value["params"], v["params"]);
    }

    #[test]
    fn outgoing_responses_and_notifications_keep_their_ids() {
        let resp = serde_json::json!({"jsonrpc":"2.0","id":"srv-9","result":{"choice":"once"}});
        let out = prepare_outgoing(resp.clone(), CAP, unreachable_id).unwrap();
        assert_eq!(out.value, resp);
        let note = serde_json::json!({"jsonrpc":"2.0","method":"ping"});
        assert_eq!(
            prepare_outgoing(note.clone(), CAP, unreachable_id)
                .unwrap()
                .value,
            note
        );
    }

    fn unreachable_id() -> u64 {
        // A response or a notification must never ask for a host id.
        u64::MAX
    }

    #[test]
    fn outgoing_rejects_garbage_and_oversize() {
        assert!(prepare_outgoing(serde_json::json!("x"), CAP, || 1).is_err());
        assert!(prepare_outgoing(serde_json::json!({"method":"x"}), CAP, || 1).is_err());
        let big =
            serde_json::json!({"jsonrpc":"2.0","id":1,"method":"x","params":{"t":"a".repeat(500)}});
        assert!(prepare_outgoing(big, 100, || 1).is_err());
    }

    #[test]
    fn host_frames_are_events_in_the_connection_namespace() {
        let t = host_event("connection.state", &serde_json::json!({"state":"ready"}));
        let m = classify(&t, CAP).unwrap();
        assert_eq!(m.event_type.as_deref(), Some("connection.state"));
        let e = error_response(&Id::Num(4), "hx.hermes.unavailable", "gone");
        let v: serde_json::Value = serde_json::from_str(&e).unwrap();
        assert_eq!(v["id"], 4);
        assert_eq!(v["error"]["data"]["code"], "hx.hermes.unavailable");
    }
}
