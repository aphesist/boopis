//! The update an install that has been set up gets by itself (owner decision, 23 November 2026): when the only thing setup
//! would do is put this app's code in place for the engine (a newer plugin, or a newer `hx`), there is nothing to ask, so
//! there is no setup screen. `Setup::assess` says when; the host runs this once per start, and the app shows one line when
//! it is done (`commands::EngineUpdateEvent`).
//!
//! **Order.** The app's own links wait at a gate (`endpoint::Gate`) that the host closes before its answer to `setup_check`
//! reaches the UI, so the app's first link cannot reach a gateway still running the old plugin: the start-up repair that
//! link starts (`bots::repair`) would ask `plugin.boopis.bots.guide` of a plugin that does not have it. The window opens and
//! draws meanwhile; only the link waits. The gate opens again however the update ends. An update that waits (for the bots,
//! or for a gateway this run did not start; both below) opens the gate meanwhile, so once it is done the host repairs the
//! bots again (`commands::setup_check`, `bots::engine::Service::repair_again`).
//!
//! **Never over running work** (owner decision, 23 November 2026). The gateway is stopped only when nothing is working, by
//! the engine's own accounts (`HermesOps::working`: the gateway's live work, which covers chat, room and cron turns and
//! background delegations, and the kanban workers, which are separate processes), and without `--yes`, so the engine itself
//! refuses if work started since the look. While anything works the gate is open and the app runs on the earlier plugin;
//! the app says "Updating once the bots are done", and the one "when idle" wait (`hermes::idle`, the same one a connector's
//! key uses) updates as soon as nothing is. A wait that never sees such a moment ends after `Limits::restart_wait_max`
//! without touching anything, and the next start tries again.
//!
//! **Only a gateway this run started.** The update never stops a gateway the app did not start in this run
//! (`Supervisor::gateway_owner`: the gateway must have been launched with this run's secret-channel token): not the
//! end-to-end stack's, not the user's own with `--engine existing`, not one an earlier run left running with that run's
//! environment. It leaves such a gateway running and its files as they are, says so, and keeps looking: if this run starts
//! the engine meanwhile (the old one ended), or none runs at the next start, the code is put in place then.
//!
//! **Fail closed.** A copy that cannot be replaced is put back (`install::install_named`), the gateway is started on what is
//! in place, the failure is recorded (`State::update_failed`) so the next check shows the setup screen, and the app says so
//! and offers that screen's Set up now.

use std::path::PathBuf;
use std::time::Duration;

use super::ops::Stop;
use super::{Setup, install, state};
use crate::endpoint::Closed;
use crate::error::{Error, Result};
use crate::hermes::GatewayOwner;
use crate::hermes::idle::{Waited, when_idle};

/// The line while the update waits for the bots.
pub const WAITING_LINE: &str = "Updating once the bots are done.";
/// The line while the gateway that runs is not one this run of the app started (the end-to-end stack's, the user's own
/// Hermes with `--engine existing`, or one an earlier run left running with that run's environment).
pub const NOT_OURS_LINE: &str = "The engine running now was started outside this boopis window, so boopis leaves it running and updates its code the next time it starts the engine.";
/// The line when the gateway that ran was never one this run of the app started, the whole time the update could wait.
pub const NOT_OURS_LATER_LINE: &str = "The engine was started outside this boopis window and kept running, so boopis left it as it was and updates its code the next time it starts the engine.";
/// The line when the bots worked the whole time the update could wait.
pub const LATER_LINE: &str = "The bots were working the whole time, so boopis keeps the earlier engine code for now and updates it when it next starts.";

/// What an automatic update came to, as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    /// Something is working, so the update waits and the app runs on the earlier code meanwhile: the line to show.
    Waiting(String),
    /// Something worked the whole time the update could wait: nothing was touched, and the next start tries again.
    Later(String),
    /// The code is in place and the gateway runs on it: the line to show.
    Done(String),
    /// It did not happen and the earlier code is still in use: the line to show, with Set up offered.
    Failed(String),
}

/// How often the update looks whether anything works, and how long it waits at most (`Limits::update_poll_every`,
/// `Limits::restart_wait_max`).
#[derive(Debug, Clone, Copy)]
pub struct Waits {
    /// Between two looks.
    pub every: Duration,
    /// In all.
    pub longest: Duration,
}

/// One try at putting the code in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tried {
    /// Done.
    Replaced,
    /// Something works (or the engine refused to stop): not now.
    Busy,
    /// The gateway that runs is not one this run of the app started: never stopped, so not now either.
    NotOurs,
}

/// What is outdated, by content (`install::needs_install`, `install::hx_differs`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outdated {
    /// The boopis plugin.
    pub plugin: bool,
    /// The plugins the runtime carries whose copy differs.
    pub carried: Vec<String>,
    /// `hx`.
    pub hx: bool,
}

impl Outdated {
    /// Nothing differs.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        !self.plugin && self.carried.is_empty() && !self.hx
    }

    /// The done line: what was updated, in the app's words.
    #[must_use]
    pub fn done_line(&self) -> String {
        let plugins = usize::from(self.plugin) + self.carried.len();
        let what = match (plugins, self.hx) {
            (0, _) => "the hx tool".to_owned(),
            (1, false) => "the engine's plugin".to_owned(),
            (_, false) => "the engine's plugins".to_owned(),
            (1, true) => "the engine's plugin and the hx tool".to_owned(),
            (_, true) => "the engine's plugins and the hx tool".to_owned(),
        };
        format!("Updated {what} to this version.")
    }

    /// The failure line: what could not be updated, that the earlier code is still in use, and the way out.
    #[must_use]
    pub fn failed_line(&self) -> String {
        let what = if self.plugin || !self.carried.is_empty() {
            "the engine's plugin"
        } else {
            "the hx tool"
        };
        format!(
            "boopis could not update {what}, so it keeps using the earlier one. Choose Set up to try again."
        )
    }
}

impl Setup {
    /// What differs from this app's code now.
    async fn outdated(&self) -> Outdated {
        let (bundle, home) = (self.bundle.clone(), self.ops.home());
        let root = self
            .runtime
            .as_ref()
            .map(|plan| plan.runtime.layout(&plan.runtimes_dir()).root);
        tokio::task::spawn_blocking(move || Outdated {
            plugin: bundle
                .plugin_dir
                .as_deref()
                .is_some_and(|dir| install::needs_install(dir, &home, "boopis")),
            carried: root
                .map(|r| install::runtime_plugins_pending(&r, &home))
                .unwrap_or_default(),
            hx: bundle
                .hx
                .as_deref()
                .is_some_and(|hx| install::hx_outdated(hx, &home)),
        })
        .await
        .unwrap_or_default()
    }

    /// Put this app's plugins and `hx` in place and start the gateway on them, without the setup screen (see the module).
    /// `closed` holds the app's link gate shut from before the UI could dial. It opens as soon as it is clear that something
    /// works (the app then runs on the earlier code, and `said` is told [`Notice::Waiting`]), and when the code is in place
    /// or this fails. `None` when there turned out to be nothing to do.
    pub async fn update(
        &self,
        closed: Closed,
        waits: Waits,
        said: &(dyn Fn(Notice) + Send + Sync),
    ) -> Option<Notice> {
        let outdated = self.outdated().await;
        if outdated.is_empty() {
            return None;
        }
        let gate = closed.gate().clone();
        let first = self.try_now(&outdated, closed).await;
        let last = std::sync::Mutex::new(first.as_ref().ok().copied());
        let result = match first {
            Ok(Tried::Replaced) => Ok(Waited::Done),
            Ok(blocked) => {
                let line = if blocked == Tried::NotOurs {
                    tracing::info!(
                        "the engine's code is outdated and the gateway is not one this run started; it is left running"
                    );
                    NOT_OURS_LINE
                } else {
                    tracing::info!(
                        "the engine's code is outdated and something is working; updating once nothing is"
                    );
                    WAITING_LINE
                };
                said(Notice::Waiting(line.to_owned()));
                when_idle(
                    waits.every,
                    waits.longest,
                    || async { self.ready().await },
                    || async {
                        let tried = self.try_now(&outdated, gate.close()).await?;
                        *last
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(tried);
                        Ok(tried == Tried::Replaced)
                    },
                )
                .await
            }
            Err(e) => Err(e),
        };
        let not_ours = *last
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            == Some(Tried::NotOurs);
        Some(self.finish(&outdated, result, not_ours).await)
    }

    /// Whether a try may succeed now: the gateway, if one runs, is this run's own, and nothing works. The owner is asked
    /// first because it costs a socket round trip, while a look at the work may cost an engine command.
    async fn ready(&self) -> bool {
        self.ops.gateway_owner().await != GatewayOwner::Other
            && matches!(self.ops.working().await, Ok(0))
    }

    /// One try, holding the gate shut through it (`closed`, dropped on every way out). A gateway this run did not start is
    /// never stopped (`GatewayOwner::Other`: the test stack's, the user's own, an earlier run's). With none running the code
    /// is put in place at once; with this run's own, once nothing works, it is stopped without ending anything first.
    async fn try_now(&self, outdated: &Outdated, closed: Closed) -> Result<Tried> {
        let owner = self.ops.gateway_owner().await;
        if owner == GatewayOwner::Other {
            return Ok(Tried::NotOurs);
        }
        // only an answer that says nothing works counts; one that cannot tell is "not now"
        if !matches!(self.ops.working().await, Ok(0)) {
            return Ok(Tried::Busy);
        }
        if owner == GatewayOwner::Nobody {
            self.replace(outdated).await?;
            drop(closed);
            return Ok(Tried::Replaced);
        }
        match self.ops.stop_gateway_when_idle().await? {
            Stop::Busy => Ok(Tried::Busy),
            Stop::StillUp => Err(Error::Setup(
                "hx.setup.plugin_install_failed",
                "the engine did not stop, so the code it runs was not replaced".into(),
            )),
            Stop::Gone => {
                self.replace(outdated).await?;
                drop(closed); // the app's links dial again; the first one finds the code now in place
                Ok(Tried::Replaced)
            }
        }
    }

    /// Record how it ended, start the gateway on what is in place (one that runs is left as it is), and say it. `not_ours`:
    /// the last try found a gateway this run did not start.
    async fn finish(&self, outdated: &Outdated, result: Result<Waited>, not_ours: bool) -> Notice {
        let home = self.ops.home();
        if !matches!(result, Ok(Waited::GaveUp)) {
            match state::load(&home) {
                Ok(mut st) => {
                    st.update_failed = result.is_err();
                    if let Err(e) = state::save(&home, &st) {
                        tracing::warn!(error = %e, "could not record how the update ended");
                    }
                }
                Err(e) => tracing::warn!(error = %e, "could not record how the update ended"),
            }
        }
        // only after a try that may have stopped this run's gateway: a wait that never got that far leaves the engine as it is
        if !matches!(result, Ok(Waited::GaveUp))
            && let Err(e) = self.ops.start_gateway().await
        {
            tracing::warn!(error = %e, "the gateway did not start after the update; the next link starts it");
        }
        match result {
            Ok(Waited::Done) => {
                tracing::info!(?outdated, "the engine's code was updated to this app's");
                Notice::Done(outdated.done_line())
            }
            Ok(Waited::GaveUp) if not_ours => {
                tracing::info!(
                    ?outdated,
                    "the gateway was never one this run started; the next start tries again"
                );
                Notice::Later(NOT_OURS_LATER_LINE.to_owned())
            }
            Ok(Waited::GaveUp) => {
                tracing::info!(
                    ?outdated,
                    "no moment came when nothing was working; the next start tries again"
                );
                Notice::Later(LATER_LINE.to_owned())
            }
            Err(e) => {
                crate::error::keep(e.code(), &e.to_string());
                tracing::warn!(error = %e, ?outdated, "the engine's code was not updated; the earlier code stays");
                Notice::Failed(outdated.failed_line())
            }
        }
    }

    /// Put each outdated piece in place, with the gateway stopped (it loaded the code being replaced): the boopis plugin
    /// first, then the plugins the runtime carries, then `hx`. A copy that fails is put back; one already replaced stays.
    async fn replace(&self, outdated: &Outdated) -> Result<()> {
        let (bundle, home, outdated) = (self.bundle.clone(), self.ops.home(), outdated.clone());
        let root: Option<PathBuf> = self
            .runtime
            .as_ref()
            .map(|plan| plan.runtime.layout(&plan.runtimes_dir()).root);
        tokio::task::spawn_blocking(move || -> Result<()> {
            if outdated.plugin
                && let Some(dir) = &bundle.plugin_dir
            {
                install::install_plugin(dir, &home)?;
            }
            if !outdated.carried.is_empty()
                && let Some(root) = &root
            {
                install::install_runtime_plugins(root, &home)?;
            }
            if outdated.hx
                && let Some(hx) = &bundle.hx
            {
                install::place_hx(hx, &home)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| crate::error::joined(&e))?
    }
}
