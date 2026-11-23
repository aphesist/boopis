//! What the service needs of the engine: ask a profile's link one question. The real one goes through the host's own
//! proxy (`Hubs`, so the same links the window uses and the same ticket path); tests script it.

use async_trait::async_trait;
use serde_json::Value;

use crate::error::Result;

/// The engine, as the local API sees it.
#[async_trait]
pub trait Engine: Send + Sync + 'static {
    /// Ask `profile`'s link (`default` is the root) `method`, starting the link if it is not up. An error answer from the
    /// engine is an `Err` whose text carries the engine's words (the caller never shows them).
    async fn request(&self, profile: &str, method: &str, params: Value) -> Result<Value>;

    /// Tell the windows that a message was said into `session` of `profile` through this API (`failed` when the engine did not
    /// take it), so a chat that has the conversation open shows it as the owner's own. `payload` is `{text, stored_session_id}`
    /// or, when it failed, `{reason}`. Nothing to do where there is no window.
    async fn said(&self, _profile: &str, _session: &str, _payload: Value, _failed: bool) {}

    /// Tell the windows that the messages a room holds changed (`rooms/hold.rs`). Nothing to do where there is no window.
    fn held_changed(&self, _room_id: &str, _held: &[crate::rooms::hold::Held]) {}
}

/// The engine through the host's proxies.
pub struct Hubbed {
    handle: tauri::AppHandle,
    wait: std::time::Duration,
}

impl Hubbed {
    /// The engine of this app.
    #[must_use]
    pub fn new(handle: tauri::AppHandle, wait: std::time::Duration) -> Self {
        Self { handle, wait }
    }
}

#[async_trait]
impl Engine for Hubbed {
    async fn request(&self, profile: &str, method: &str, params: Value) -> Result<Value> {
        use tauri::Manager as _;
        let state = self.handle.state::<crate::commands::AppState>();
        let (_, hub) = state.hubs.hub_for(Some(profile))?;
        hub.ensure_ready(self.wait).await?;
        hub.request(method, params, self.wait).await
    }

    async fn said(&self, profile: &str, session: &str, payload: Value, failed: bool) {
        use tauri::Manager as _;
        let state = self.handle.state::<crate::commands::AppState>();
        if let Ok((_, hub)) = state.hubs.hub_for(Some(profile)) {
            hub.announce_said(session, &payload, failed);
        }
    }

    fn held_changed(&self, room_id: &str, held: &[crate::rooms::hold::Held]) {
        let event = crate::commands::RoomHeldEvent {
            room_id: room_id.to_owned(),
            held: held.to_vec(),
        };
        if let Err(e) = tauri_specta::Event::emit(&event, &self.handle) {
            tracing::debug!(error = %e, "could not tell the windows what a room holds");
        }
    }
}

#[cfg(test)]
pub mod scripted {
    //! A scripted engine for the service's tests.

    use std::sync::Mutex;

    use super::{Engine, Result, async_trait};
    use serde_json::Value;

    type Responder = Box<dyn Fn(&str, &str, &Value) -> Result<Value> + Send + Sync>;

    /// Records every call and answers from a closure.
    pub struct Scripted {
        /// `(profile, method, params)`, in order.
        pub calls: Mutex<Vec<(String, String, Value)>>,
        respond: Responder,
    }

    impl Scripted {
        /// An engine that answers with `respond(profile, method, params)`.
        pub fn new(
            respond: impl Fn(&str, &str, &Value) -> Result<Value> + Send + Sync + 'static,
        ) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                respond: Box::new(respond),
            }
        }

        /// The calls of one method.
        pub fn of(&self, method: &str) -> Vec<(String, Value)> {
            self.calls
                .lock()
                .map(|c| {
                    c.iter()
                        .filter(|(_, m, _)| m == method)
                        .map(|(p, _, v)| (p.clone(), v.clone()))
                        .collect()
                })
                .unwrap_or_default()
        }
    }

    #[async_trait]
    impl Engine for Scripted {
        async fn request(&self, profile: &str, method: &str, params: Value) -> Result<Value> {
            if let Ok(mut c) = self.calls.lock() {
                c.push((profile.to_owned(), method.to_owned(), params.clone()));
            }
            (self.respond)(profile, method, &params)
        }

        async fn said(&self, profile: &str, session: &str, payload: Value, failed: bool) {
            if let Ok(mut c) = self.calls.lock() {
                let method = if failed {
                    "window.said_failed"
                } else {
                    "window.said"
                };
                c.push((
                    profile.to_owned(),
                    method.to_owned(),
                    serde_json::json!({"session_id": session, "payload": payload}),
                ));
            }
        }
    }
}
