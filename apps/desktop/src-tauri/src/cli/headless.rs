//! The host without a window, for the commands that talk to the engine (`groups`, `run`, `team`).
//!
//! It builds what the app builds, from the same functions: the engine's plan (bundled or existing, `runtime::plan_for`), the
//! environment, the supervisor, and a short link to a gateway (`gateway::oneshot::Link`, a fresh ticket from the control
//! socket, the same dial the app's proxy makes). Nothing here is a second implementation of any of them.
//!
//! When the app is running, its gateway answers on the control socket and this attaches to it. When nothing does, the
//! command starts one the way the app would, with the plugin's secret channel served from this process for as long as the
//! command runs, so the bots can reach the keychain. It never takes the channel from a running app.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::config::Limits;
use crate::endpoint::Local;
use crate::error::{Error, Result};
use crate::gateway::oneshot::Link;
use crate::hermes::{self, Supervisor};
use crate::rooms::Rpc;
use crate::{runtime, secrets};

/// The host for one command.
pub struct Host {
    sup: Arc<Supervisor>,
    root: PathBuf,
    data_dir: PathBuf,
    limits: Limits,
    _channel: Option<secrets::SecretChannel>,
}

impl Host {
    /// Build the host the way the app does. Must run inside a Tokio runtime.
    ///
    /// # Errors
    /// `Setup` when the engine the build carries is unusable or not unpacked yet (the app unpacks it at its first start).
    pub async fn open(resource_dir: Option<&Path>) -> Result<Self> {
        let limits = Limits::default();
        let data_dir = dirs::data_dir()
            .map(|d| d.join(crate::gpu::APP_IDENTIFIER))
            .ok_or_else(|| Error::Io("this machine has no data folder".into()))?;
        let (plan, broken) = runtime::plan_for(
            runtime::Source::from_process(),
            resource_dir,
            Ok(data_dir.clone()),
        );
        if let Some(why) = broken {
            let shown = if crate::error::names_engine(&why) {
                crate::error::sentence("hx.setup.runtime_corrupt")
            } else {
                why
            };
            return Err(Error::Setup("hx.setup.runtime_corrupt", shown));
        }
        let mut environment = hermes::Environment::from_process();
        if let Some(plan) = &plan {
            if !plan.runtime.is_installed(&plan.runtimes_dir()) {
                return Err(Error::Unavailable(
                    "boopis has not finished setting up yet. Open the app once, then run this again.".into(),
                ));
            }
            environment = environment.with_bundled(plan.bundled());
        }
        let root = environment.hermes_root();
        let serving = hermes::control::identify(&root).await.is_ok();
        let mut supervisor = Supervisor::new(environment, limits.clone());
        let mut channel = None;
        if !serving && let Ok(auth) = secrets::Auth::mint() {
            let peers = Arc::new(secrets::PeerPolicy::new().holding(auth.token_entry()));
            supervisor = supervisor.with_secret_channel(auth.launch_env(), peers.clone());
            match secrets::channel::start(Arc::new(secrets::Keychain), &auth, peers).await {
                Ok(c) => channel = Some(c),
                Err(e) => tracing::debug!(error = %e, "no secret channel for this command"),
            }
        }
        Ok(Self {
            sup: Arc::new(supervisor),
            root,
            data_dir,
            limits,
            _channel: channel,
        })
    }

    /// The engine's root home.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The app's data folder (where boopis keeps its own files, `rooms.json`).
    #[must_use]
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// The supervisor, for the commands that run the engine's own CLI.
    #[must_use]
    pub fn supervisor(&self) -> &Arc<Supervisor> {
        &self.sup
    }

    /// The gateway of the root home.
    #[must_use]
    pub fn rpc(&self) -> GatewayRpc {
        GatewayRpc::new(self.sup.clone(), self.root.clone(), self.limits.clone())
    }

    /// The gateway of a bot's own home (its cron jobs live there).
    ///
    /// # Errors
    /// `InvalidInput` for a name that is not a profile name.
    pub fn rpc_for(&self, bot: &str) -> Result<GatewayRpc> {
        let home = self.sup.environment().profile_home(Some(bot))?;
        Ok(GatewayRpc::new(self.sup.clone(), home, self.limits.clone()))
    }

    /// Run the engine's CLI in the root home.
    ///
    /// # Errors
    /// The runner's.
    pub async fn engine_cli(&self, args: &[&str]) -> Result<hermes::cli::Output> {
        let info = self.sup.info().await?;
        self.sup
            .cli()
            .run(&info.binary, &self.root, args, self.limits.ensure_timeout)
            .await
    }
}

/// One gateway, asked over a link that is opened when first needed and again when it breaks.
pub struct GatewayRpc {
    sup: Arc<Supervisor>,
    home: PathBuf,
    limits: Limits,
    link: Mutex<Option<Link>>,
}

impl GatewayRpc {
    fn new(sup: Arc<Supervisor>, home: PathBuf, limits: Limits) -> Self {
        Self {
            sup,
            home,
            limits,
            link: Mutex::new(None),
        }
    }

    async fn open(&self) -> Result<Link> {
        let endpoint = Local::new(self.sup.clone(), self.home.clone(), self.limits.clone());
        Link::open(
            &endpoint,
            false,
            self.limits.max_inbound_frame,
            self.limits.ensure_timeout + self.limits.cli_timeout,
        )
        .await
    }
}

#[async_trait]
impl Rpc for GatewayRpc {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let mut slot = self.link.lock().await;
        // A link that broke since the last call is replaced once; a refusal from the gateway is its answer, not a break.
        for attempt in 0..2 {
            if slot.is_none() {
                *slot = Some(self.open().await?);
            }
            let link = slot.as_mut().expect("opened above");
            match link.call_rpc(method, &params).await {
                Ok(Ok(v)) => return Ok(v),
                Ok(Err(refused)) => return Err(Error::Unavailable(refused.message)),
                Err(e) if attempt == 0 => {
                    tracing::debug!(error = %e, method, "the link broke; opening another");
                    *slot = None;
                }
                Err(e) => return Err(e),
            }
        }
        Err(Error::Unavailable(format!("{method} could not be asked")))
    }
}
