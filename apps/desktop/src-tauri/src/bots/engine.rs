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

    async fn boards(&self, _root: &Path) -> Result<Vec<(String, String)>> {
        Ok(crate::kanban::boards(&self.sup)
            .await?
            .into_iter()
            .filter(|b| !b.archived)
            .map(|b| (b.slug, b.name))
            .collect())
    }

    async fn board_assignees(&self, _root: &Path, slug: &str) -> Result<Vec<String>> {
        Ok(crate::kanban::view(&self.sup, slug)
            .await?
            .tasks
            .into_iter()
            .filter_map(|t| t.assignee)
            .collect())
    }
}

/// The bots' side of the app: one operation at a time (two `hermes config set` in one home must not race), and the repair once
/// per run.
pub struct Service {
    engine: Arc<dyn super::Engine>,
    lock: tokio::sync::Mutex<()>,
    repaired: std::sync::atomic::AtomicBool,
    /// A restart is waiting for the bots being prepared one after another to be done (`restart_after_batch`).
    restart_pending: std::sync::atomic::AtomicBool,
    /// When the last bot was prepared, so the restart waits for a quiet moment.
    last_prepared: std::sync::Mutex<std::time::Instant>,
    /// How long nothing is prepared before the restart runs.
    quiet: std::time::Duration,
}

/// How long the bots' preparation is quiet before a restart it needs runs: the app prepares several new bots one after
/// another, and they share one restart.
pub const RESTART_QUIET: std::time::Duration = std::time::Duration::from_secs(3);

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
            restart_pending: std::sync::atomic::AtomicBool::new(false),
            last_prepared: std::sync::Mutex::new(std::time::Instant::now()),
            quiet: RESTART_QUIET,
        }
    }

    /// The same, with another quiet time before a batch's restart (tests).
    #[must_use]
    pub fn with_quiet(mut self, quiet: std::time::Duration) -> Self {
        self.quiet = quiet;
        self
    }

    /// The engine it runs.
    #[must_use]
    pub fn engine(&self) -> &dyn super::Engine {
        self.engine.as_ref()
    }

    /// Prepare the bot `name` (made just now when `fresh`: it gets the default skill index unless it had it), with its Governed
    /// switch as its record says.
    ///
    /// # Errors
    /// As [`super::prepare`], and when the records or the root cannot be read.
    pub async fn prepare(
        self: &Arc<Self>,
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
        // A bot gets the default skill index and its role's toolsets once: one made by `boopis team apply` and then seen by
        // the app keeps the skills and toolsets the team file switched on.
        let mut given = super::Records::load(&layout.root);
        let members = if given.tools.pending(name) {
            super::board_members(self.engine.as_ref(), &layout.root)
                .await
                .ok()
        } else {
            None
        };
        let mut ask = given.ask(name, governed, members.as_ref());
        ask.fresh = fresh && ask.fresh;
        let mut done = super::prepare(self.engine.as_ref(), layout, &mut view, name, ask).await?;
        done.problems.extend(super::project_problem(&records, name));
        given.note(&done);
        if done.skills_given || done.toolsets_given || done.kanban_given {
            given.save(&layout.root, &mut done.problems);
        }
        if let Ok(mut at) = self.last_prepared.lock() {
            *at = std::time::Instant::now();
        }
        if done.needs_restart {
            self.restart_after_batch(layout.root.clone());
        }
        Ok(done)
    }

    /// Make `asked` the model of the bot `name`, the one way a bot's model is set (`super::model`): refused when the bot cannot
    /// reach it, written by the engine, read back, an alias kept as asked. `link` is a link to the root's gateway the caller
    /// keeps (the command line's); `None` uses a short link per call (the app). One operation at a time with the others on the
    /// bot's home. Returns the model read back; the caller prepares the bot afterwards, as its ladder follows its model.
    ///
    /// # Errors
    /// `hx.bots.not_found` for a bot that is not there; as `super::model::check` and `super::model::write` otherwise.
    pub async fn set_model(
        &self,
        link: Option<&dyn crate::rooms::Rpc>,
        layout: &super::Layout,
        name: &str,
        asked: &(String, String),
        confirm: bool,
    ) -> Result<(String, String)> {
        let home = layout.home(name)?;
        let _one = self.lock.lock().await;
        let own = super::model::RootLink {
            engine: self.engine.as_ref(),
            root: &layout.root,
        };
        let rpc = link.unwrap_or(&own);
        super::model::check(rpc, name, asked, true).await?;
        super::model::write(rpc, self.engine.as_ref(), &home, name, asked, confirm).await
    }

    /// One gateway restart for the bots prepared one after another (bots that appeared together, made elsewhere): it runs
    /// once nothing has been prepared for the quiet time, and never while work runs (`restart_when_idle`).
    fn restart_after_batch(self: &Arc<Self>, root: std::path::PathBuf) {
        use std::sync::atomic::Ordering;
        if self.restart_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let since = me.last_prepared.lock().map_or(me.quiet, |at| at.elapsed());
                match me.quiet.checked_sub(since) {
                    Some(left) if !left.is_zero() => tokio::time::sleep(left).await,
                    _ => break,
                }
            }
            let _one = me.lock.lock().await;
            me.restart_pending.store(false, Ordering::SeqCst);
            match me.engine.restart_when_idle(&root).await {
                Ok(true) => tracing::info!("restarted the engine to load the new bots' plugins"),
                Ok(false) => {
                    tracing::info!("work is running: the new bots' plugins load at the next start");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "the engine could not be restarted for the new bots");
                }
            }
        });
    }

    /// The cap the bot `name` keeps for `boopis run --bot`, `None` when it keeps none ([`super::limit`]).
    ///
    /// # Errors
    /// `hx.bots.not_found` for a bot that is not there; `Config` or `Io` for a configuration that cannot be read.
    pub fn run_limit(&self, layout: &super::Layout, name: &str) -> Result<Option<u32>> {
        super::limit::read(&layout.home(name)?)
    }

    /// Keep (or, with `None`, forget) the cap of the bot `name`, in the bot's own configuration where the engine reads it, one
    /// operation at a time with the others on that home. Returns whether anything was written.
    ///
    /// # Errors
    /// `hx.bots.not_found` for a bot that is not there, `InvalidInput` for a cap outside 1 to 1000, the engine's otherwise.
    pub async fn set_run_limit(
        &self,
        layout: &super::Layout,
        name: &str,
        turns: Option<u32>,
    ) -> Result<bool> {
        let home = layout.home(name)?;
        let _one = self.lock.lock().await;
        super::limit::write(self.engine.as_ref(), &home, turns).await
    }

    /// Take the bot `name` out of the root's groups.
    ///
    /// # Errors
    /// As [`super::release`].
    pub async fn release(&self, root: &Path, name: &str) -> Result<bool> {
        let _one = self.lock.lock().await;
        super::release(self.engine.as_ref(), root, name).await
    }

    /// Run the repair again in this run, in the background. The automatic update replaced the engine's code under the running
    /// app after it waited for the bots (`setup::update`), so the app's links ran on the earlier plugin meanwhile and a repair
    /// made then asked that plugin: one without `bots.guide` left every bot without the hand-off skill (a problem on the bot,
    /// so its preparation is due again). The update restarted the engine, which is a new start for what the repair gives.
    pub fn repair_again(self: &Arc<Self>, layout: super::Layout) {
        self.repaired
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.repair_once(layout);
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
                    for (bot, paths) in &done.soul_missing {
                        tracing::warn!(%bot, missing = ?paths, "a bot's instructions name paths that are not there");
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
