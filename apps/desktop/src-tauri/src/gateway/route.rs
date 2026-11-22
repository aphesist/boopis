//! Routing a frame that arrived from the gateway: responses go back to whoever asked (under their own id), events go
//! to every UI connection, server requests go to the connection that attached last. Everything the host learns on
//! the way (session cursors for replay) comes from the envelope only.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;

use serde_json::value::RawValue;

use super::frame::{self, Id, Kind, Meta};
use super::hub::{Cursor, Owner, Shared, State};

/// Swap the top-level `id` of a frame without parsing the rest of it: every other member is copied as raw text.
fn rewrite_id(text: &str, id: &Id) -> Option<String> {
    let mut map: BTreeMap<&str, &RawValue> = serde_json::from_str(text).ok()?;
    let raw = RawValue::from_string(id.to_value().to_string()).ok()?;
    map.insert("id", &raw);
    serde_json::to_string(&map).ok()
}

impl Shared {
    /// Handle one text frame from the gateway. Returns frames to send back to the gateway (error answers to server
    /// requests nobody can take). Never fails: a frame the host cannot read is logged and dropped, since the link
    /// itself is still healthy.
    pub(super) fn route_inbound(&self, text: String, received: Instant) -> Vec<String> {
        self.metrics.frames_in.fetch_add(1, Ordering::Relaxed);
        let meta = match frame::classify(&text, self.limits.max_inbound_frame) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(error = %e, "dropped a gateway frame that is not valid JSON-RPC");
                return Vec::new();
            }
        };
        let mut back = Vec::new();
        let mut st = self.lock();
        match &meta.kind {
            Kind::Response {
                id: Some(Id::Num(n)),
            } => {
                if let Some(pending) = u64::try_from(*n).ok().and_then(|k| st.pending.remove(&k)) {
                    match pending.owner {
                        Owner::Ui { conn, orig } => {
                            let reply = rewrite_id(&text, &orig).unwrap_or_else(|| {
                                frame::error_response(
                                    &orig,
                                    "hx.internal_error",
                                    "the host could not relay the answer",
                                )
                            });
                            self.deliver(&mut st, conn, reply.into());
                        }
                        Owner::Replay(session) => self.replay_answer(&mut st, &session, &text),
                        Owner::Host(tx) => {
                            let _ = tx.send(host_answer(&text, &pending.method));
                        }
                    }
                } else {
                    tracing::debug!(
                        id = n,
                        "a response nobody waits for (its UI connection closed)"
                    );
                }
            }
            Kind::Response { .. } => {
                tracing::debug!("a response with an id the host did not issue");
            }
            Kind::Request { id, .. } => {
                // A server request (clarify, secret, ...): the UI that attached last answers it. With none attached
                // the request is declined, never left to hang a turn.
                let primary = st
                    .conns
                    .iter()
                    .max_by_key(|(_, c)| c.order)
                    .map(|(k, _)| *k);
                match primary {
                    Some(conn) => self.deliver(&mut st, conn, text.into()),
                    None => back.push(frame::error_response(
                        id,
                        "hx.host.no_ui",
                        "no UI is attached to answer",
                    )),
                }
            }
            Kind::Notification { .. } => self.route_event(&mut st, text, &meta),
        }
        self.metrics.route_in.record(received.elapsed());
        back
    }

    fn route_event(&self, st: &mut State, text: String, meta: &Meta) {
        if let (Some(sess), Some(seq)) = (&meta.session_id, meta.seq) {
            if let Some((epoch, floor)) = st.floors.get(sess) {
                if *epoch == meta.replay_epoch && seq <= *floor {
                    return; // already delivered by a replay
                }
                st.floors.remove(sess);
            }
            st.tick += 1;
            let tick = st.tick;
            let cursor = st.cursors.entry(sess.clone()).or_insert(Cursor {
                seq: 0,
                epoch: None,
                touched: tick,
            });
            if cursor.epoch != meta.replay_epoch {
                cursor.epoch.clone_from(&meta.replay_epoch);
                cursor.seq = 0;
            }
            cursor.seq = cursor.seq.max(seq);
            cursor.touched = tick;
            if st.cursors.len() > self.limits.replay_sessions * 2 {
                trim_cursors(st, self.limits.replay_sessions);
            }
        }
        if let Some(kind) = meta
            .event_type
            .as_deref()
            .filter(|k| k.starts_with(super::hub::TAPPED_PREFIX))
            && let Ok(v) = serde_json::from_str::<serde_json::Value>(&text)
        {
            // Nobody listening is fine: the UI still gets the frame.
            let _ = self.taps.send(super::hub::TapEvent {
                event_type: kind.to_owned(),
                payload: v["params"]["payload"].clone(),
            });
        }
        if let Some(kind) = meta.event_type.as_deref() {
            self.feed_event(&text, kind, meta.session_id.as_deref());
        }
        let delta = (meta.event_type.as_deref() == Some("message.delta"))
            .then(|| meta.session_id.clone().unwrap_or_default());
        let text: Arc<str> = text.into();
        self.broadcast(st, &text, delta.as_deref());
    }

    fn replay_answer(&self, st: &mut State, session: &str, text: &str) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        let Some(result) = v.get("result") else {
            tracing::debug!(
                session,
                "replay refused (the session is not live on this gateway)"
            );
            return;
        };
        if let Some(events) = result.get("events").and_then(|e| e.as_array()) {
            for ev in events {
                let frame: Arc<str> =
                    serde_json::json!({"jsonrpc": "2.0", "method": "event", "params": ev})
                        .to_string()
                        .into();
                self.broadcast(st, &frame, None);
            }
        }
        // The ring cannot carry "a question still waiting": Hermes reports those apart, as `open_requests`. The UI is told
        // (it draws the ones it has not drawn); a request Hermes withdrew meanwhile is a `request.cancel` in the events above.
        if let Some(open) = result
            .get("open_requests")
            .filter(|o| o.as_array().is_some_and(|a| !a.is_empty()))
        {
            let frame: Arc<str> = frame::host_session_event(
                "connection.open_requests",
                session,
                &serde_json::json!({"open_requests": open}),
            )
            .into();
            self.broadcast(st, &frame, None);
        }
        let epoch = result
            .get("epoch")
            .and_then(|e| e.as_str())
            .map(str::to_owned);
        if let Some(latest) = result.get("latest_seq").and_then(serde_json::Value::as_u64) {
            st.floors
                .insert(session.to_owned(), (epoch.clone(), latest));
            st.cursors.insert(
                session.to_owned(),
                Cursor {
                    seq: latest,
                    epoch,
                    touched: st.tick,
                },
            );
        }
        if result.get("truncated").and_then(serde_json::Value::as_bool) == Some(true) {
            let gap: Arc<str> = frame::host_event(
                "connection.replay_gap",
                &serde_json::json!({"session_id": session}),
            )
            .into();
            self.broadcast(st, &gap, None);
        }
    }
}

/// The result of a response to a request the host made, or its error.
fn host_answer(text: &str, method: &str) -> crate::error::Result<serde_json::Value> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| crate::error::Error::InvalidFrame(e.to_string()))?;
    match v.get("error") {
        Some(err) => Err(crate::error::Error::Unavailable(format!("{method}: {err}"))),
        None => Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null)),
    }
}

fn trim_cursors(st: &mut State, keep: usize) {
    let mut by_age: Vec<(u64, String)> = st
        .cursors
        .iter()
        .map(|(k, c)| (c.touched, k.clone()))
        .collect();
    by_age.sort_unstable();
    let drop_n = by_age.len().saturating_sub(keep);
    for (_, k) in by_age.into_iter().take(drop_n) {
        st.cursors.remove(&k);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewriting_an_id_keeps_every_other_member_byte_for_byte() {
        let text = r#"{"jsonrpc":"2.0","id":77,"result":{"n":1.0,"s":"héllo","big":18446744073709551615,"deep":[1,{"a":null}]}}"#;
        let out = rewrite_id(text, &Id::Str("ui-1".into())).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["id"], "ui-1");
        assert!(
            out.contains(
                r#""result":{"n":1.0,"s":"héllo","big":18446744073709551615,"deep":[1,{"a":null}]}"#
            ),
            "{out}"
        );
        assert_eq!(v["jsonrpc"], "2.0");
    }

    #[test]
    fn a_null_result_survives() {
        let out = rewrite_id(r#"{"jsonrpc":"2.0","id":5,"result":null}"#, &Id::Num(2)).unwrap();
        assert!(
            out.contains(r#""result":null"#) && out.contains(r#""id":2"#),
            "{out}"
        );
    }
}
