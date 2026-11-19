//! Requests `hx` sends to its peer, the plugin: the one thing `hx` asks that nobody asked it first.
//!
//! `hx serve` answers requests, and that stays true. The mod runtime is the exception: a mod makes
//! a `$` call whenever it likes (a clock tick, a handler), and the plugin must decide it. So `serve`
//! binds a [`Link`] to its writer and routes the responses it reads to the requests waiting here.
//! Without a bound link (a one-shot run) a request fails at once with `hx.mods.no_host`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

/// An error the peer answered with: a stable code and a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerError {
    /// `data.code` when the peer set one, otherwise `rpc.<code>`.
    pub code: String,
    /// The message.
    pub message: String,
}

type Waiting = oneshot::Sender<Result<Value, PeerError>>;

/// The connection to the peer. Cheap to share.
#[derive(Default)]
pub struct Link {
    tx: Mutex<Option<mpsc::Sender<String>>>,
    waiting: Mutex<HashMap<String, Waiting>>,
    next: AtomicU64,
}

impl std::fmt::Debug for Link {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Link").finish_non_exhaustive()
    }
}

/// Whether the key is there at all: `"result": null` is a result, and `Option` would read it as
/// absent.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    IgnoredAny::deserialize(d).map(|_| true)
}

#[derive(Deserialize)]
struct Probe {
    #[serde(default, deserialize_with = "present")]
    method: bool,
    #[serde(default, deserialize_with = "present")]
    result: bool,
    #[serde(default, deserialize_with = "present")]
    error: bool,
}

impl Link {
    /// A link with no peer yet.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Connects the link to the writer of the stdio server.
    pub fn bind(&self, tx: mpsc::Sender<String>) {
        *self.tx.lock().unwrap_or_else(PoisonError::into_inner) = Some(tx);
    }

    /// Disconnects the link and fails everything waiting.
    pub fn unbind(&self) {
        *self.tx.lock().unwrap_or_else(PoisonError::into_inner) = None;
        let doomed: Vec<_> = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain()
            .collect();
        for (_, w) in doomed {
            let _ = w.send(Err(PeerError {
                code: "hx.mods.host_failed".to_owned(),
                message: "the connection to the plugin closed".to_owned(),
            }));
        }
    }

    fn sender(&self) -> Option<mpsc::Sender<String>> {
        self.tx
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Whether a peer is connected.
    #[must_use]
    pub fn is_bound(&self) -> bool {
        self.sender().is_some()
    }

    /// Sends a request and waits for the answer, up to `timeout`.
    ///
    /// # Errors
    /// The peer's error, `hx.mods.no_host` with no peer, or `hx.mods.host_timeout`.
    pub async fn request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, PeerError> {
        self.begin(method, params).await?.wait(timeout).await
    }

    /// Queues a request on the connection now and returns what to wait on. Frames reach the peer
    /// in the order `begin` is awaited, so a caller that must keep two things in order (a mod's
    /// `$` call and the reply to the operation that made it) awaits `begin` before the second.
    ///
    /// # Errors
    /// `hx.mods.no_host` with no peer, or `hx.mods.host_failed` when the connection is closed.
    pub async fn begin(self: &Arc<Self>, method: &str, params: Value) -> Result<Sent, PeerError> {
        let Some(tx) = self.sender() else {
            return Err(PeerError {
                code: "hx.mods.no_host".to_owned(),
                message: "hx is not connected to the plugin".to_owned(),
            });
        };
        let id = format!("hx-{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let (done, answer) = oneshot::channel();
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), done);
        let frame =
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        if tx.send(frame).await.is_err() {
            self.forget(&id);
            return Err(PeerError {
                code: "hx.mods.host_failed".to_owned(),
                message: "the connection to the plugin closed".to_owned(),
            });
        }
        Ok(Sent {
            link: Arc::clone(self),
            id,
            method: method.to_owned(),
            answer,
        })
    }

    /// Sends a notification. Best effort: a closed connection drops it.
    pub async fn notify(&self, method: &str, params: Value) {
        if let Some(tx) = self.sender() {
            let frame = json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string();
            let _ = tx.send(frame).await;
        }
    }

    fn forget(&self, id: &str) {
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id);
    }

    /// If `line` is a response to one of our requests, completes it and returns true. Anything
    /// else (a request, a malformed frame) returns false and is left to the server.
    pub fn handle_response(&self, line: &[u8]) -> bool {
        let Ok(probe) = serde_json::from_slice::<Probe>(line) else {
            return false;
        };
        if probe.method || !(probe.result || probe.error) {
            return false;
        }
        let Ok(frame) = serde_json::from_slice::<Value>(line) else {
            return false;
        };
        let Some(id) = frame.get("id").and_then(Value::as_str) else {
            return false;
        };
        let waiter = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id);
        let Some(waiter) = waiter else { return true };
        let outcome = match frame.get("error") {
            Some(e) => Err(PeerError {
                code: e["data"]["code"]
                    .as_str()
                    .map_or_else(|| format!("rpc.{}", e["code"]), str::to_owned),
                message: e["message"].as_str().unwrap_or_default().to_owned(),
            }),
            None => Ok(frame.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = waiter.send(outcome);
        true
    }
}

/// A request that is on the wire.
pub struct Sent {
    link: Arc<Link>,
    id: String,
    method: String,
    answer: oneshot::Receiver<Result<Value, PeerError>>,
}

impl Sent {
    /// Waits for the peer's answer, up to `timeout`.
    ///
    /// # Errors
    /// The peer's error, `hx.mods.host_failed` if the connection closed, or `hx.mods.host_timeout`.
    pub async fn wait(self, timeout: Duration) -> Result<Value, PeerError> {
        match tokio::time::timeout(timeout, self.answer).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(PeerError {
                code: "hx.mods.host_failed".to_owned(),
                message: "the connection to the plugin closed".to_owned(),
            }),
            Err(_) => {
                self.link.forget(&self.id);
                Err(PeerError {
                    code: "hx.mods.host_timeout".to_owned(),
                    message: format!("the plugin did not answer `{}` in time", self.method),
                })
            }
        }
    }
}
