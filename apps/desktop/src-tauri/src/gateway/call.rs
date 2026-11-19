//! One request and its answer on a link that is not yet served: the handshake's calls and the one-shot link's calls.
//! Frames that are not the answer are handed back to the caller (the hub routes them once it serves; a one-shot link
//! drops them).

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};

use super::frame::{self, Id, Kind};
use super::link::{GatewayConn, Inbound, Outbound};
use crate::error::{Error, Result};

/// Read until the gateway's first `gateway.ready` event; everything before it goes to `buffered`. Returns the frame.
///
/// # Errors
/// `Unavailable` when the link closes first.
pub(super) async fn wait_ready(
    conn: &mut GatewayConn,
    max_frame: usize,
    buffered: &mut Vec<String>,
) -> Result<String> {
    loop {
        match conn.rx.next().await {
            Some(Ok(Inbound::Text(t))) => {
                let is_ready = frame::classify(&t, max_frame)
                    .is_ok_and(|m| m.event_type.as_deref() == Some("gateway.ready"));
                if is_ready {
                    return Ok(t);
                }
                buffered.push(t);
            }
            Some(Ok(Inbound::Alive)) => {}
            Some(Ok(Inbound::Closed)) | None => {
                return Err(Error::Unavailable(
                    "the gateway closed before gateway.ready".into(),
                ));
            }
            Some(Err(e)) => return Err(e),
        }
    }
}

/// Send `method` with `params` under `id` and wait for its answer.
///
/// # Errors
/// `Unavailable` for an error answer or a closed link; whatever the transport reports.
pub(super) async fn exchange(
    conn: &mut GatewayConn,
    max_frame: usize,
    id: u64,
    method: &str,
    params: &Value,
    buffered: &mut Vec<String>,
) -> Result<Value> {
    let text = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
    conn.tx.send(Outbound::Text(text)).await?;
    loop {
        match conn.rx.next().await {
            Some(Ok(Inbound::Text(t))) => match frame::classify(&t, max_frame) {
                Ok(m) if matches!(&m.kind, Kind::Response { id: Some(Id::Num(n)) } if u64::try_from(*n) == Ok(id)) =>
                {
                    let v: Value =
                        serde_json::from_str(&t).map_err(|e| Error::InvalidFrame(e.to_string()))?;
                    if let Some(err) = v.get("error") {
                        return Err(Error::Unavailable(format!("{method}: {err}")));
                    }
                    return Ok(v.get("result").cloned().unwrap_or(Value::Null));
                }
                _ => buffered.push(t),
            },
            Some(Ok(Inbound::Alive)) => {}
            Some(Ok(Inbound::Closed)) | None => {
                return Err(Error::Unavailable(format!(
                    "the gateway closed during {method}"
                )));
            }
            Some(Err(e)) => return Err(e),
        }
    }
}
