//! The update an install that has been set up gets by itself (owner decision, 23 November 2026): when the only thing setup
//! would do is put this app's code in place for the engine (a newer plugin, or a newer `hx`), there is nothing to ask, so
//! there is no setup screen. `Setup::assess` says when; the host runs this once per start, and the app shows one line when
//! it is done (`commands::EngineUpdateEvent`).
//!
//! **Order.** The app's own links wait at a gate (`endpoint::Gate`) that the host closes before its answer to `setup_check`
//! reaches the UI, so the UI's first link cannot reach a gateway still running the old plugin: on a link to it, the UI's
//! first roster read would ask `plugin.boopis.bots.guide` of a plugin that does not have it, and nothing would ask again in
//! that run. The window opens and draws meanwhile; only the link waits. The gate opens again however the update ends.
//!
//! **Fail closed.** A copy that cannot be replaced is put back (`install::install_named`), the gateway is started on what is
//! in place, the failure is recorded (`State::update_failed`) so the next check shows the setup screen, and the app says so
//! and offers that screen's Set up now.

use std::path::PathBuf;

use super::{Setup, install, state};
use crate::endpoint::Closed;
use crate::error::{Error, Result};

/// What an automatic update came to, as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    /// The code is in place and the gateway runs on it: the line to show.
    Done(String),
    /// It did not happen and the earlier code is still in use: the line to show, with Set up offered.
    Failed(String),
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
                .is_some_and(|hx| install::hx_differs(hx, &home)),
        })
        .await
        .unwrap_or_default()
    }

    /// Put this app's plugins and `hx` in place and start the gateway on them, without the setup screen (see the module).
    /// `closed` holds the app's link gate shut from before the UI could dial; it opens when the code is in place, or when
    /// this fails. `None` when there turned out to be nothing to do.
    pub async fn update(&self, closed: Closed) -> Option<Notice> {
        let outdated = self.outdated().await;
        if outdated.is_empty() {
            return None;
        }
        let replaced = self.replace(&outdated).await;
        drop(closed); // the app's links dial again; the first one finds the code now in place
        let home = self.ops.home();
        match state::load(&home) {
            Ok(mut st) => {
                st.update_failed = replaced.is_err();
                if let Err(e) = state::save(&home, &st) {
                    tracing::warn!(error = %e, "could not record how the update ended");
                }
            }
            Err(e) => tracing::warn!(error = %e, "could not record how the update ended"),
        }
        if let Err(e) = self.ops.start_gateway().await {
            tracing::warn!(error = %e, "the gateway did not start after the update; the next link starts it");
        }
        Some(match replaced {
            Ok(()) => {
                tracing::info!(?outdated, "the engine's code was updated to this app's");
                Notice::Done(outdated.done_line())
            }
            Err(e) => {
                crate::error::keep(e.code(), &e.to_string());
                tracing::warn!(error = %e, ?outdated, "the engine's code was not updated; the earlier code stays");
                Notice::Failed(outdated.failed_line())
            }
        })
    }

    /// Stop the gateway (it loaded the code being replaced), then put each outdated piece in place: the boopis plugin first,
    /// then the plugins the runtime carries, then `hx`. A copy that fails is put back; one already replaced stays replaced.
    async fn replace(&self, outdated: &Outdated) -> Result<()> {
        if !self.ops.stop_gateway().await? {
            return Err(Error::Setup(
                "hx.setup.plugin_install_failed",
                "the engine did not stop, so the code it runs was not replaced".into(),
            ));
        }
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
