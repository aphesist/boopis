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
    }
}
