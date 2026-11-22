//! The real [`Engine`](super::Engine): the engine's own CLI in each home (`hermes config`, `hermes plugins`, through setup's
//! `CliOps`), a short link to the root's gateway for the plugin's `bots.*` and the engine's `profiles.*`, and the control
//! socket's `reload-plugins` (POSIX; elsewhere the caller restarts the gateway when idle).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::endpoint::Local;
use crate::error::{Error, Result};
use crate::gateway::oneshot::Link;
use crate::hermes::Supervisor;
use crate::setup::ops::{CliOps, HermesOps};

/// The engine the supervisor runs.
pub struct CliEngine {
    sup: Arc<Supervisor>,
}

impl CliEngine {
    /// The engine of `sup`.
    #[must_use]
    pub fn new(sup: Arc<Supervisor>) -> Self {
        Self { sup }
    }

    fn ops(&self, home: &Path) -> CliOps {
        CliOps::new(self.sup.clone(), home.to_path_buf())
    }
}

#[async_trait]
impl super::Engine for CliEngine {
    async fn config_get(&self, home: &Path, key: &str) -> Result<Option<Value>> {
        self.ops(home).config_get(key).await
    }

    async fn config_set(&self, home: &Path, key: &str, value: &str) -> Result<()> {
        self.ops(home).config_set(key, value).await
    }

    async fn config_unset(&self, home: &Path, key: &str) -> Result<()> {
        self.ops(home).config_unset(key).await
    }

    async fn enable_plugin(&self, home: &Path, name: &str) -> Result<()> {
        self.ops(home).enable_plugin(name).await
    }

    async fn call(&self, root: &Path, method: &str, params: Value) -> Result<Value> {
        let limits = self.sup.limits();
        let endpoint = Local::new(self.sup.clone(), PathBuf::from(root), limits.clone());
        let mut link = Link::open(
            &endpoint,
            false,
            limits.max_inbound_frame,
            limits.ensure_timeout + limits.cli_timeout,
        )
        .await?;
        link.call(method, &params).await
    }

    async fn reload_plugins(&self, root: &Path, home: &Path) -> Result<()> {
        let loaded = crate::hermes::control::reload_plugins(root, home).await?;
        if loaded.iter().any(|p| p == super::BOOPIS) {
            Ok(())
        } else {
            Err(Error::Unavailable(format!(
                "the gateway reloaded {} without boopis",
                home.display()
            )))
        }
    }

    async fn restart_when_idle(&self, root: &Path) -> Result<bool> {
        match self.sup.restart(root, false).await {
            Ok(_) => Ok(true),
            Err(Error::Connector("hx.connectors.busy", _)) => Ok(false),
            Err(e) => Err(e),
        }
    }
}

/// The bots' side of the app: one operation at a time (two `hermes config set` in one home must not race), and the repair once
/// per run.
pub struct Service {
    engine: Arc<dyn super::Engine>,
    lock: tokio::sync::Mutex<()>,
    repaired: std::sync::atomic::AtomicBool,
}

impl Service {
    /// The service over the supervisor's engine.
    #[must_use]
    pub fn new(sup: Arc<Supervisor>) -> Self {
        Self::with_engine(Arc::new(CliEngine::new(sup)))
    }

    /// The service over any engine (tests, the command line).
    #[must_use]
    pub fn with_engine(engine: Arc<dyn super::Engine>) -> Self {
        Self {
            engine,
            lock: tokio::sync::Mutex::new(()),
            repaired: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// The engine it runs.
    #[must_use]
    pub fn engine(&self) -> &dyn super::Engine {
        self.engine.as_ref()
    }

    /// Prepare the bot `name` (made just now when `fresh`), with its Governed switch as its record says.
    ///
    /// # Errors
    /// As [`super::prepare`], and when the records or the root cannot be read.
    pub async fn prepare(
        &self,
        layout: &super::Layout,
        name: &str,
        fresh: bool,
    ) -> Result<super::Prepared> {
        let _one = self.lock.lock().await;
        let records = self
            .engine
            .call(
                &layout.root,
                "plugin.boopis.bots.read",
                serde_json::json!({}),
            )
            .await?;
        let governed = super::governed_of(&records)
            .get(name)
            .copied()
            .unwrap_or(false);
        let mut view = super::RootView::read(self.engine.as_ref(), &layout.root).await?;
        let done = super::prepare(
            self.engine.as_ref(),
            layout,
            &mut view,
            name,
            super::Ask { governed, fresh },
        )
        .await?;
        if done.needs_restart && self.engine.restart_when_idle(&layout.root).await? {
            tracing::info!(bot = name, "restarted the engine to load the bot's plugins");
        }
        Ok(done)
    }

    /// Take the bot `name` out of the root's groups.
    ///
    /// # Errors
    /// As [`super::release`].
    pub async fn release(&self, root: &Path, name: &str) -> Result<bool> {
        let _one = self.lock.lock().await;
        super::release(self.engine.as_ref(), root, name).await
    }

    /// Run the repair once in this run, in the background, once setup has placed the plugin in the root.
    pub fn repair_once(self: &Arc<Self>, layout: super::Layout) {
        use std::sync::atomic::Ordering;
        if !layout.ready() || self.repaired.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let _one = me.lock.lock().await;
            match super::repair(me.engine.as_ref(), &layout).await {
                Ok(done) => {
                    let changed: Vec<&str> = done
                        .bots
                        .iter()
                        .filter(|b| b.changed())
                        .map(|b| b.name.as_str())
                        .collect();
                    tracing::info!(?changed, released = ?done.released, ungoverned = ?done.ungoverned, restarted = done.restarted, "the bots were checked");
                    for p in &done.problems {
                        tracing::warn!(problem = %p, "a bot could not be repaired");
                    }
                    for b in &done.bots {
                        for p in &b.problems {
                            tracing::warn!(bot = %b.name, problem = %p, "a bot could not be repaired");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "the bots could not be checked; trying again next start");
                    me.repaired.store(false, Ordering::SeqCst);
                }
            }
        });
    }
}
