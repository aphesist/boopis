//! The Hermes lifecycle: discover, `requires_hermes`, `ensure` (once per host run, with the `code_sha` check), and
//! `attach` for every connect (a fresh single-use ticket each time).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;

use super::attach::{Dial, EndpointInfo, Verdict};
use super::cli::Cli;
use super::control;
use super::discover::{self, Environment, HermesInfo, Version};
use crate::config::{Limits, REQUIRES_HERMES};
use crate::error::{Error, Result};
use crate::secrets::PeerPolicy;

/// What the UI is told about the gateway (`hermes_status`).
#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GatewayState {
    /// A gateway answers on the control socket.
    Running,
    /// None answers.
    Stopped,
    /// Hermes is installed but too old or otherwise not usable.
    Incompatible,
}

/// The `hermes_status` answer (`docs/PROTOCOL.md` section 1).
#[derive(Debug, Clone, Serialize, Type)]
pub struct HermesStatus {
    /// Whether a `hermes` binary was found.
    pub installed: bool,
    /// Its version, `None` when Hermes names none (a source checkout without a stamp).
    pub version: Option<String>,
    /// The commit the running gateway booted from.
    pub code_sha: Option<String>,
    /// The profile the host attaches to (`default` unless the settings name another).
    pub profile: String,
    /// The gateway's state.
    pub gateway: GatewayState,
    /// The requirement the plugin declares.
    pub requires: String,
    /// `Some(false)` when the version is older than required, `None` when the version is unknown.
    pub requirement_met: Option<bool>,
}

/// Who runs the gateway of a home, as far as stopping it goes (`Supervisor::gateway_owner`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayOwner {
    /// No gateway answers on the home's control socket.
    Nobody,
    /// A gateway this run of the host launched, with this run's environment (it was started with this run's secret-channel
    /// token).
    ThisRun,
    /// Any other: one a test stack, the user's own Hermes or an earlier run of the app started, or one whose start cannot be
    /// shown to be this run's (no process table to read, no control socket on this platform).
    Other,
}

/// Runs Hermes for the host. One per app; cheap to share.
pub struct Supervisor {
    env: Environment,
    limits: Limits,
    cli: Cli,
    requires: String,
    info: tokio::sync::Mutex<Option<HermesInfo>>,
    ensured: Mutex<HashSet<PathBuf>>,
    /// The secret channel's gateway policy.
    channel: Option<Arc<PeerPolicy>>,
}

impl Supervisor {
    /// A supervisor over `env`.
    #[must_use]
    pub fn new(env: Environment, limits: Limits) -> Self {
        let cli = match &env.bundled {
            // the bundled Hermes: the user's HERMES_* and UV_* stay out, Python's bytecode and the engine's per-user gateway
            // lock go to the app's own folder (no other Hermes, and no gateway an earlier build left, can hold boopis's)
            Some(b) => {
                if let Err(e) = std::fs::create_dir_all(&b.locks) {
                    tracing::warn!(error = %e, dir = %b.locks.display(), "could not make the engine's lock folder");
                }
                Cli::new(&limits).isolated().with_env(vec![
                    (
                        "PYTHONPYCACHEPREFIX".to_owned(),
                        b.pycache.display().to_string(),
                    ),
                    (
                        "HERMES_GATEWAY_LOCK_DIR".to_owned(),
                        b.locks.display().to_string(),
                    ),
                ])
            }
            None => Cli::new(&limits),
        };
        Self {
            env,
            limits,
            cli,
            requires: REQUIRES_HERMES.to_owned(),
            info: tokio::sync::Mutex::new(None),
            ensured: Mutex::new(HashSet::new()),
            channel: None,
        }
    }

    /// Hand the plugin secret channel to the gateways this supervisor starts: `env` (the socket and the token) reaches
    /// only the `gateway ensure|attach` calls, and `peers` is told which process the gateway is so the channel serves it
    /// and nothing else (`secrets::peer`).
    #[must_use]
    pub fn with_secret_channel(
        mut self,
        env: Vec<(String, String)>,
        peers: Arc<PeerPolicy>,
    ) -> Self {
        self.cli = self.cli.with_secret_channel(env, peers.clone());
        self.channel = Some(peers);
        self
    }

    /// Tell the channel's policy which process the gateway is: the pid the kernel reported on its control socket.
    fn note_gateway(&self, identity: &control::Identify) {
        let (Some(peers), Some(pid)) = (&self.channel, identity.pid) else {
            return;
        };
        if identity.state == "ready" && !peers.record_gateway(pid) {
            tracing::debug!(
                pid,
                "the gateway was not started by this run: the secret channel will not serve it"
            );
        }
    }

    /// Give every `hermes` child these variables too (for tests that run a scratch install).
    #[must_use]
    pub fn with_child_env(mut self, extra: Vec<(String, String)>) -> Self {
        self.cli = self.cli.with_env(extra);
        self
    }

    /// The `hermes` runner (allowlisted environment, timeout, output cap).
    #[must_use]
    pub fn cli(&self) -> &Cli {
        &self.cli
    }

    /// The limits this supervisor runs under.
    #[must_use]
    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    /// The environment this supervisor reads.
    #[must_use]
    pub fn environment(&self) -> &Environment {
        &self.env
    }

    /// Discover Hermes (cached after the first success) and check `requires_hermes`.
    ///
    /// # Errors
    /// `HermesMissing`, `HermesTooOld`, or `Unavailable` when the binary cannot run. An unknown version passes with a
    /// warning: the gateway's own `runtime.describe` capabilities gate features.
    pub async fn info(&self) -> Result<HermesInfo> {
        let mut cached = self.info.lock().await;
        if let Some(i) = cached.as_ref() {
            return Ok(i.clone());
        }
        let info = discover::discover(&self.env, &self.cli).await?;
        if let Some(v) = info.version.as_deref().and_then(Version::parse) {
            discover::check_requirement(v, &self.requires)?;
        } else {
            tracing::warn!(
                "Hermes names no version; the requirement {} cannot be checked",
                self.requires
            );
        }
        *cached = Some(info.clone());
        Ok(info)
    }

    /// The status for `hermes_status`. Never fails: a missing Hermes is `installed: false`.
    pub async fn status(&self, profile: Option<&str>) -> HermesStatus {
        let requires = self.requires.clone();
        let profile_name = profile
            .filter(|p| !p.is_empty())
            .unwrap_or("default")
            .to_owned();
        let found = discover::discover(&self.env, &self.cli).await;
        let (installed, version) = match &found {
            Ok(i) => (true, i.version.clone()),
            Err(Error::HermesMissing) => (false, None),
            Err(_) => (true, None),
        };
        let requirement_met = version
            .as_deref()
            .and_then(Version::parse)
            .map(|v| discover::check_requirement(v, &requires).is_ok());
        let home = self
            .env
            .profile_home(profile)
            .unwrap_or_else(|_| self.env.hermes_root());
        let identity = control::identify(&home)
            .await
            .ok()
            .filter(|i| i.state == "ready");
        if let Some(i) = &identity {
            self.note_gateway(i);
        }
        let gateway = match (&identity, requirement_met) {
            (_, Some(false)) => GatewayState::Incompatible,
            (Some(_), _) => GatewayState::Running,
            (None, _) => GatewayState::Stopped,
        };
        HermesStatus {
            installed,
            version,
            code_sha: identity.and_then(|i| i.endpoint.code_sha),
            profile: profile_name,
            gateway,
            requires,
            requirement_met,
        }
    }

    /// Make sure a gateway runs for `home`: `hermes gateway ensure --json`, and restart it once when it runs older
    /// code than the installed Hermes (`client_code_sha` against `endpoint.code_sha`). Done once per host run and
    /// home; a later reconnect only attaches (and attaching starts a gateway that idle-exited).
    ///
    /// # Errors
    /// `Incompatible` when the gateway cannot be made compatible; `Unavailable` when it cannot start.
    pub async fn ensure(&self, home: &Path) -> Result<EndpointInfo> {
        let info = self.info().await?;
        let mut verdict = self
            .run_verdict(&info, home, &["gateway", "ensure", "--json"])
            .await?;
        if let Some((client, gateway)) = verdict
            .code_mismatch()
            .map(|(c, g)| (c.to_owned(), g.to_owned()))
        {
            tracing::info!(
                client,
                gateway,
                "the gateway runs older code than Hermes; restarting it"
            );
            self.cli
                .run(
                    &info.binary,
                    home,
                    &["gateway", "stop", "--yes"],
                    self.limits.cli_timeout,
                )
                .await?;
            verdict = self
                .run_verdict(&info, home, &["gateway", "ensure", "--json"])
                .await?;
            if verdict.code_mismatch().is_some() {
                return Err(Error::Incompatible(
                    "the Hermes gateway still runs older code after a restart".into(),
                ));
            }
        }
        if verdict.state != "ready" {
            return Err(verdict.refusal());
        }
        self.note_started_gateway(home).await;
        if let Ok(mut done) = self.ensured.lock() {
            done.insert(home.to_path_buf());
        }
        Ok(verdict.endpoint.unwrap_or_default())
    }

    /// Stop the gateway of `home` if one runs, wait until nothing answers on its control socket, then start a fresh one with
    /// [`Supervisor::ensure`]. `gateway stop` returns while the old gateway may still be shutting down, and an `ensure` must
    /// not meet it: the new gateway has to be the host's own launch, so its first read of the keychain (a connector's key,
    /// read when Hermes connects its MCP servers at start-up) is served. The wait is bounded by
    /// `Limits::gateway_stop_wait`; when it passes, `ensure` runs anyway. `interrupt` passes `--yes`, which ends live work; without
    /// it a gateway with live work is left alone (`hx.connectors.busy`).
    ///
    /// # Errors
    /// As [`Supervisor::ensure`].
    pub async fn restart(&self, home: &Path, interrupt: bool) -> Result<EndpointInfo> {
        self.stop(home, interrupt).await?;
        self.ensure(home).await
    }

    /// Stop the gateway of `home` if one runs and wait, bounded by `Limits::gateway_stop_wait`, until nothing answers on its
    /// control socket; the next [`Supervisor::ensure`] then starts a fresh one. `interrupt` passes `--yes`, which ends live
    /// work; without it a gateway with live work is left alone (`hx.connectors.busy`). `true` when nothing answers any more.
    ///
    /// # Errors
    /// `hx.connectors.busy` as above; what [`Supervisor::info`] returns.
    pub async fn stop(&self, home: &Path, interrupt: bool) -> Result<bool> {
        let info = self.info().await?;
        // It fails when no gateway runs, which is fine: `ensure` then starts one. Without `--yes` Hermes itself refuses to stop
        // a gateway that has live work (a turn, a cron job, a delegation), which is the host's safety net for a restart it
        // meant to do only when idle: the gateway is then left running and the answer is `hx.connectors.busy`.
        let args: &[&str] = if interrupt {
            &["gateway", "stop", "--yes"]
        } else {
            &["gateway", "stop"]
        };
        let stopped = self
            .cli
            .run(&info.binary, home, args, self.limits.cli_timeout)
            .await;
        if !interrupt && stopped.is_ok_and(|o| o.code != 0) && control::identify(home).await.is_ok()
        {
            return Err(Error::Connector(
                "hx.connectors.busy",
                "a turn is still running, so boopis did not restart".into(),
            ));
        }
        let deadline = tokio::time::Instant::now() + self.limits.gateway_stop_wait;
        while control::identify(home).await.is_ok() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        if let Ok(mut done) = self.ensured.lock() {
            done.remove(home);
        }
        Ok(control::identify(home).await.is_err())
    }

    /// Run [`Supervisor::ensure`] unless it is not needed: it already succeeded for `home` in this run, or the running
    /// gateway cannot be older than Hermes (it names no code identity, or it names the one the install stamp names).
    /// That check is a socket round trip instead of a Python start, which is what lets the first attach of a run meet
    /// its 300 ms budget when a gateway is already up.
    ///
    /// # Errors
    /// Whatever [`Supervisor::ensure`] returns when it runs.
    pub async fn ensure_if_needed(&self, home: &Path) -> Result<()> {
        if self.is_ensured(home) {
            return Ok(());
        }
        let info = self.info().await?;
        if let Ok(identity) = control::identify(home).await {
            if let Some(theirs) = identity.stale_home(home) {
                tracing::warn!(home = %home.display(), serves = %theirs, "the gateway on this home's socket serves a folder that no longer exists; restarting it");
                return self.restart(home, true).await.map(|_| ());
            }
            self.note_gateway(&identity);
            let settled = identity.state == "ready"
                && match (
                    identity.endpoint.code_sha.as_deref(),
                    info.stamp.as_ref().and_then(|s| s.commit.as_deref()),
                ) {
                    (None, _) => true,
                    (Some(g), Some(c)) => g.starts_with(c) || c.starts_with(g),
                    (Some(_), None) => false,
                };
            if settled {
                if let Ok(mut done) = self.ensured.lock() {
                    done.insert(home.to_path_buf());
                }
                return Ok(());
            }
        }
        self.ensure(home).await.map(|_| ())
    }

    /// Who runs the gateway of `home`: nobody, this run, or anyone else ([`GatewayOwner`]). The evidence is the pid the kernel
    /// reports on the gateway's control socket and that process's start environment, which holds this run's token only when
    /// this run launched it (`PeerPolicy::started_by_this_run`). Without a socket (Windows) or a token, nothing can be shown
    /// to be this run's, so it is `Other`.
    pub async fn gateway_owner(&self, home: &Path) -> GatewayOwner {
        if !cfg!(unix) {
            return GatewayOwner::Other;
        }
        let Ok(identity) = control::identify(home).await else {
            return GatewayOwner::Nobody;
        };
        match (identity.pid, &self.channel) {
            (Some(pid), Some(peers)) if peers.started_by_this_run(pid) => GatewayOwner::ThisRun,
            _ => GatewayOwner::Other,
        }
    }

    /// Whether [`Supervisor::ensure`] already succeeded for `home` in this run.
    #[must_use]
    pub fn is_ensured(&self, home: &Path) -> bool {
        self.ensured.lock().is_ok_and(|d| d.contains(home))
    }

    /// A fresh dial for `home`: the control socket first (about 2 ms), `hermes gateway attach --json --start` when it
    /// does not answer (about 500 ms, and it starts a gateway that is gone).
    ///
    /// # Errors
    /// Whatever the CLI verdict says when both routes fail.
    pub async fn attach(&self, home: &Path) -> Result<Dial> {
        match self.attach_fast(home).await {
            Ok(dial) => return Ok(dial),
            Err(e) => {
                tracing::debug!(error = %e, "the control socket did not give a ticket; using the CLI");
            }
        }
        let info = self.info().await?;
        let verdict = self
            .run_verdict(&info, home, &["gateway", "attach", "--json", "--start"])
            .await?;
        let dial = Dial::from_attach(&verdict)?;
        self.note_started_gateway(home).await;
        Ok(dial)
    }

    async fn attach_fast(&self, home: &Path) -> Result<Dial> {
        let identity = control::identify(home).await?;
        self.note_gateway(&identity);
        if identity.state != "ready" {
            return Err(Error::Unavailable(format!(
                "the gateway is {}",
                identity.state
            )));
        }
        let profile = identity
            .profile_id_for(home)
            .ok_or_else(|| Error::Unavailable("the gateway does not serve this home".into()))?
            .to_owned();
        let ticket = control::session_ticket(home, &identity, &profile).await?;
        Dial::from_control(identity.endpoint, &ticket)
    }

    /// A gateway a launch just made ready: ask its control socket who it is and record that.
    async fn note_started_gateway(&self, home: &Path) {
        if self.channel.is_some()
            && let Ok(identity) = control::identify(home).await
        {
            self.note_gateway(&identity);
        }
    }

    async fn run_verdict(&self, info: &HermesInfo, home: &Path, args: &[&str]) -> Result<Verdict> {
        // Only `ensure` and `attach --start` come here, the two calls that may start a gateway.
        let out = self
            .cli
            .run_launching(&info.binary, home, args, self.limits.ensure_timeout)
            .await?;
        Verdict::parse(&out.stdout).map_err(|e| {
            let tail: String = out
                .stderr
                .lines()
                .last()
                .unwrap_or("")
                .chars()
                .take(200)
                .collect();
            Error::Unavailable(format!("{e} (exit {}, {tail})", out.code))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_missing_hermes_is_a_status_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let env = Environment {
            hermes_home: Some(dir.path().display().to_string()),
            home_dir: Some(dir.path().to_path_buf()),
            path: Some(dir.path().as_os_str().to_owned()),
            ..Environment::default()
        };
        let sup = Supervisor::new(env, Limits::default());
        let st = sup.status(None).await;
        assert!(!st.installed);
        assert_eq!(st.gateway, GatewayState::Stopped);
        assert_eq!(st.requires, REQUIRES_HERMES);
        assert!(matches!(sup.info().await, Err(Error::HermesMissing)));
    }

    #[cfg(unix)]
    fn fake_hermes(dir: &Path, version_line: &str, ensure_json: &str) -> Environment {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let script = format!(
            "#!/bin/sh\ncase \"$1 $2\" in\n  \"--version \") echo '{version_line}';;\n  \"gateway ensure\") echo '{ensure_json}';;\n  \"gateway stop\") echo stopped >> \"$HERMES_HOME/stops\";;\nesac\n"
        );
        std::fs::write(bin.join("hermes"), script).unwrap();
        std::fs::set_permissions(bin.join("hermes"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();
        Environment {
            hermes_home: Some(home.display().to_string()),
            home_dir: Some(dir.to_path_buf()),
            path: Some(bin.into_os_string()),
            ..Environment::default()
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_old_hermes_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let env = fake_hermes(dir.path(), "Hermes Agent v0.22.0 (x)", "{}");
        let sup = Supervisor::new(env, Limits::default());
        assert_eq!(
            sup.info().await.unwrap_err().code(),
            "hx.engine.incompatible"
        );
        let st = sup.status(None).await;
        assert!(st.installed);
        assert_eq!(st.gateway, GatewayState::Incompatible);
        assert_eq!(st.requirement_met, Some(false));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_code_sha_mismatch_restarts_the_gateway_once() {
        let dir = tempfile::tempdir().unwrap();
        let mismatch = r#"{"state":"ready","client_code_sha":"new","endpoint":{"code_sha":"old"}}"#;
        let env = fake_hermes(dir.path(), "Hermes Agent v0.23.2 (x)", mismatch);
        let sup = Supervisor::new(env, Limits::default());
        let err = sup.ensure(&dir.path().join("home")).await.unwrap_err();
        assert_eq!(
            err.code(),
            "hx.engine.incompatible",
            "still stale after the restart"
        );
        let stops = std::fs::read_to_string(dir.path().join("home").join("stops")).unwrap();
        assert_eq!(stops.lines().count(), 1, "one restart, not a loop");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ensure_marks_the_home_when_ready() {
        let dir = tempfile::tempdir().unwrap();
        let ready = r#"{"state":"ready","client_code_sha":"same","endpoint":{"code_sha":"same","instance_id":"i"}}"#;
        let env = fake_hermes(dir.path(), "Hermes Agent v0.23.2 (x)", ready);
        let sup = Supervisor::new(env, Limits::default());
        let home = dir.path().join("home");
        assert!(!sup.is_ensured(&home));
        let ep = sup.ensure(&home).await.unwrap();
        assert_eq!(ep.instance_id.as_deref(), Some("i"));
        assert!(sup.is_ensured(&home));
    }
}
