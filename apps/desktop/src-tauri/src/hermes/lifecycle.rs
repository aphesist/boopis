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
        self.ensure(home).await
    }

    /// Run [`Supervisor::ensure`] unless it is not needed: it already succeeded for `home` in this run, or the running
    /// gateway cannot be older than Hermes (it names no code identity, or it names the one the install stamp names).
    /// That check is a socket round trip instead of a Python start, which is what lets the first attach of a run meet
    /// its 300 ms budget when a gateway is already up. A bot's home is answered for by the root's gateway (`identify_for`), so
    /// it costs the same.
    ///
    /// # Errors
    /// Whatever [`Supervisor::ensure`] returns when it runs.
    pub async fn ensure_if_needed(&self, home: &Path) -> Result<()> {
        if self.is_ensured(home) {
            return Ok(());
        }
        let info = self.info().await?;
        if let Ok((identity, socket)) = self.identify_for(home).await {
            if socket == home
                && let Some(theirs) = identity.stale_home(home)
            {
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

    /// Whether [`Supervisor::ensure`] already succeeded for `home` in this run.
    #[must_use]
    pub fn is_ensured(&self, home: &Path) -> bool {
        self.ensured.lock().is_ok_and(|d| d.contains(home))
    }

    /// A fresh dial for `home`: the control socket first (about 2 ms; the root's for a bot's home it serves), `hermes gateway
    /// attach --json --start` when none answers (about 500 ms, and it starts a gateway that is gone).
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
        let (identity, socket) = self.identify_for(home).await?;
        self.note_gateway(&identity);
        if identity.state != "ready" {
            return Err(Error::Unavailable(format!(
                "the gateway is {}",
                identity.state
            )));
        }
        let profile = if socket == home {
            identity.profile_id_for(home)
        } else {
            identity.served_id(home)
        }
        .ok_or_else(|| Error::Unavailable("the gateway does not serve this home".into()))?
        .to_owned();
        let ticket = control::session_ticket(&socket, &identity, &profile).await?;
        Dial::from_control(identity.endpoint, &ticket)
    }

    /// Who answers for `home`, and the home whose control socket that is: `home`'s own socket, or, for a profile home that has
    /// none, the root's, when the root's gateway names `home` among the profiles it serves. That is the engine's own rule for a
    /// served profile (`hermes gateway attach` asks the multiplexer's socket and mints a ticket bound to the profile's home), done
    /// as two socket round trips instead of a Python start, so a bot's link costs what the root's does. A profile home the root
    /// does not name (not served yet, or a gateway of its own that is down) gets the own socket's error, and the callers fall
    /// back to the engine's command line as before.
    async fn identify_for(&self, home: &Path) -> Result<(control::Identify, PathBuf)> {
        let own = match control::identify(home).await {
            Ok(identity) => return Ok((identity, home.to_path_buf())),
            Err(e) => e,
        };
        let root = self.env.hermes_root();
        if root.as_path() == home {
            return Err(own);
        }
        match control::identify(&root).await {
            Ok(identity) if identity.served_id(home).is_some() => Ok((identity, root)),
            _ => Err(own),
        }
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

    /// A fake root gateway's control socket: `identify` names `served` homes, `session-ticket` records the profile id it was
    /// asked for. Returns what it was asked for.
    #[cfg(unix)]
    fn serve_root_socket(root: &Path, served: Vec<String>) -> Arc<Mutex<Vec<String>>> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let asked = Arc::new(Mutex::new(Vec::new()));
        let listener = tokio::net::UnixListener::bind(root.join("gateway.sock")).unwrap();
        let seen = asked.clone();
        tokio::spawn(async move {
            loop {
                let Ok((s, _)) = listener.accept().await else {
                    return;
                };
                let (r, mut w) = s.into_split();
                let mut line = String::new();
                BufReader::new(r).read_line(&mut line).await.unwrap();
                let req: serde_json::Value = serde_json::from_str(&line).unwrap();
                let result = if req["verb"] == "identify" {
                    let rows: Vec<_> = served
                        .iter()
                        .map(|h| serde_json::json!({"profile_id": h, "home": h}))
                        .collect();
                    serde_json::json!({"state":"ready","instance_id":"inst","api_origin":"http://127.0.0.1:7","served_profiles":rows})
                } else {
                    let id = req["params"]["profile_id"].as_str().unwrap().to_owned();
                    seen.lock().unwrap().push(id);
                    serde_json::json!({"ticket":"abc_DEF-123"})
                };
                let answer = serde_json::json!({"ok":true,"protocol":1,"result":result,"id":1});
                w.write_all(format!("{answer}\n").as_bytes()).await.unwrap();
            }
        });
        asked
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_bots_home_the_roots_gateway_serves_is_reached_through_its_socket_without_starting_the_engine()
     {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        // the engine's command line writes down every call it gets
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let calls = dir.path().join("calls");
        std::fs::write(
            bin.join("hermes"),
            format!(
                "#!/bin/sh\necho \"$*\" >> '{}'\ncase \"$1\" in --version) echo 'Hermes Agent v0.23.2 (x)';; esac\n",
                calls.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(bin.join("hermes"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let root = dir.path().join("home");
        let (kai, nina) = (root.join("profiles/kai"), root.join("profiles/nina"));
        for d in [&root, &kai, &nina] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::set_permissions(d, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let env = Environment {
            hermes_home: Some(root.display().to_string()),
            home_dir: Some(dir.path().to_path_buf()),
            path: Some(bin.into_os_string()),
            ..Environment::default()
        };
        // the multiplexer serves the root and kai; nina is not served (yet)
        let asked = serve_root_socket(
            &root,
            vec![root.display().to_string(), kai.display().to_string()],
        );
        let sup = Supervisor::new(env, Limits::default());

        sup.ensure_if_needed(&kai).await.unwrap();
        assert!(sup.is_ensured(&kai));
        let dial = sup.attach(&kai).await.unwrap();
        assert_eq!(dial.url.as_str(), "ws://127.0.0.1:7/api/ws");
        // the ticket is bound to kai's home, never the root's, and minted on the root's socket
        assert_eq!(*asked.lock().unwrap(), [kai.display().to_string()]);
        let ran = std::fs::read_to_string(&calls).unwrap();
        assert!(
            ran.lines().all(|l| l == "--version"),
            "no engine start for a served bot: {ran}"
        );

        // a home the root does not name gets no ticket of the root's: the engine's own attach is asked, as before
        assert!(sup.attach(&nina).await.is_err());
        assert_eq!(asked.lock().unwrap().len(), 1, "no ticket for nina");
        let ran = std::fs::read_to_string(&calls).unwrap();
        assert!(ran.contains("gateway attach --json --start"), "{ran}");
    }

    #[test]
    fn only_the_entry_that_names_a_home_serves_it() {
        let id: control::Identify = serde_json::from_str(
            r#"{"state":"ready","served_profiles":[{"profile_id":"/e","home":"/e"},{"profile_id":"/e/profiles/kai","home":"/e/profiles/kai"}]}"#,
        )
        .unwrap();
        assert_eq!(
            id.served_id(Path::new("/e/profiles/kai")),
            Some("/e/profiles/kai")
        );
        assert_eq!(id.served_id(Path::new("/e")), Some("/e"));
        assert_eq!(id.served_id(Path::new("/e/profiles/nina")), None);
        // the only entry is never a stand-in for a bot's home
        let alone: control::Identify =
            serde_json::from_str(r#"{"served_profiles":[{"profile_id":"/e","home":"/e"}]}"#)
                .unwrap();
        assert_eq!(alone.served_id(Path::new("/e/profiles/kai")), None);
    }
}
