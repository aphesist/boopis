//! What the store asks of the engine and of the plugin, behind two small traits so the whole flow is tested against a scripted
//! one and runs against the real gateway in the app.
//!
//! - [`Backend`]: one gateway call (`plugin.boopis.store.*`, `plugins.manage`, `skills.manage`, `session.active_list`) and the
//!   engine's CLI (the verbs the gateway has no action for: `skills uninstall`, `skills update`).
//! - [`Host`]: what the app supplies per bot (an engine profile): its connector engine and its backend.
//!
//! A plugin refusal carries `error.data.code` (`hx.store.*`); it becomes the same code here. Any other refusal of a store call is
//! `hx.store.install_failed`, with the engine's words kept for Diagnostics by the error mapper (ADR-0031).

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::connectors::Engine;
use crate::endpoint::Local;
use crate::error::{Error, Result};
use crate::gateway::oneshot::Link;
use crate::hermes::Supervisor;
use crate::hermes::cli::Output;

/// The engine and the plugin, as the store needs them, for one bot.
#[async_trait]
pub trait Backend: Send + Sync {
    /// One gateway call. `Err` for a refusal and for an unreachable gateway.
    async fn rpc(&self, method: &str, params: &Value) -> Result<Value>;
    /// The engine's CLI with `args` (no shell).
    async fn cli(&self, args: &[&str]) -> Result<Output>;
}

/// What the app supplies per bot.
pub trait Host: Send + Sync {
    /// The bot's name for `profile` (the attached one when `None`).
    ///
    /// # Errors
    /// `InvalidInput` for a name that is not one.
    fn bot(&self, profile: Option<String>) -> Result<String>;
    /// The connector engine of `bot`.
    ///
    /// # Errors
    /// The engine's.
    fn connectors(&self, bot: &str) -> Result<Arc<Engine>>;
    /// The gateway and CLI of `bot`.
    ///
    /// # Errors
    /// The engine's.
    fn backend(&self, bot: &str) -> Result<Arc<dyn Backend>>;
}

/// The real backend: a short gateway link per call, and the supervisor's CLI.
pub struct GatewayBackend {
    sup: Arc<Supervisor>,
    home: PathBuf,
}

impl GatewayBackend {
    /// A backend for the bot whose home is `home`.
    #[must_use]
    pub fn new(sup: Arc<Supervisor>, home: PathBuf) -> Self {
        Self { sup, home }
    }
}

/// A refusal's `data.code`, when it is one of the store's.
fn store_refusal(method: &str, raw: &Value, message: &str) -> Error {
    let msg: String = message.chars().filter(|c| !c.is_control()).take(400).collect();
    if let Some(code) = raw.pointer("/data/code").and_then(Value::as_str)
        && let Some(e) = Error::store_code(code, msg.clone())
    {
        return e;
    }
    Error::Store("hx.store.install_failed", format!("{method}: {msg}"))
}

#[async_trait]
impl Backend for GatewayBackend {
    async fn rpc(&self, method: &str, params: &Value) -> Result<Value> {
        let limits = self.sup.limits();
        let endpoint = Local::new(self.sup.clone(), self.home.clone(), limits.clone());
        let mut link = Link::open(&endpoint, false, limits.max_inbound_frame, limits.ensure_timeout + limits.cli_timeout).await?;
        match link.call_rpc(method, params).await? {
            Ok(v) => Ok(v),
            Err(f) => Err(store_refusal(method, &f.raw, &f.message)),
        }
    }

    async fn cli(&self, args: &[&str]) -> Result<Output> {
        let info = self.sup.info().await?;
        self.sup.cli().run(&info.binary, &self.home, args, self.sup.limits().ensure_timeout).await
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_plugin_refusal_keeps_its_store_code_and_any_other_is_an_install_failure() {
        let e = store_refusal("plugin.boopis.store.confirm", &json!({"code": -32000, "data": {"code": "hx.store.plan_changed"}}), "changed");
        assert_eq!(e.code(), "hx.store.plan_changed");
        let e = store_refusal("plugins.manage", &json!({"code": 5026}), "boom");
        assert_eq!(e.code(), "hx.store.install_failed");
        let e = store_refusal("m", &json!({"data": {"code": "hx.policy.denied"}}), "x");
        assert_eq!(e.code(), "hx.store.install_failed", "a code that is not the store's is not carried");
    }
}
