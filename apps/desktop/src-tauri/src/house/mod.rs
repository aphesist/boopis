//! The host's side of team operations (`docs/specs/team-ops.md`, ADR-0061): the host-ops channel the plugin asks
//! (`hx-host-ops-v1`, served on the shared listener with `boopis_hostops::Dispatcher`), the verbs it does in the app
//! ([`LiveOps`]: rooms, bots and sessions through the local API's service, runs and plans through this same binary's
//! command line, which holds the one team implementation), the owner grants the window mints, and the plans the window
//! shows and the owner's hold applies.
//!
//! Nothing a bot can reach applies, undoes or rejects a plan: those are Tauri commands of the window only
//! (`team_plan_apply`, `team_plan_undo`, `team_plan_reject`), and the command line's `team apply --hash` and `team undo`
//! refuse a bot's process (H5).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use boopis_hostops::grants::Grants;
use boopis_hostops::listen::{self, Listener, Opts};
use boopis_hostops::plans::PlanStore;
use boopis_hostops::{Call, Dispatcher, OpFuture, Ops, Refusal, protocol};
use serde::Serialize;
use serde_json::{Value, json};
use specta::Type;

use crate::error::{Error, HostError, Result};
use crate::local_api::service::{ApiError, Caller};
use crate::rooms::hold::How;
use crate::secrets::PeerPolicy;

/// The channel's credentials: its socket (beside the secret channel's) and its own token. `Debug` never shows the token.
#[derive(Clone)]
pub struct Auth {
    socket: PathBuf,
    token: String,
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Auth")
            .field("socket", &self.socket)
            .finish_non_exhaustive()
    }
}

impl Auth {
    /// A fresh token and the socket in the secret channel's folder.
    ///
    /// # Errors
    /// `Io` when there is no folder for the socket or no random bytes.
    pub fn mint() -> Result<Self> {
        let dir = crate::secrets::channel::default_socket_dir()
            .ok_or_else(|| Error::Io("no directory for the host-ops channel".into()))?;
        Self::mint_in(&dir)
    }

    /// A fresh token and a socket in `dir`.
    ///
    /// # Errors
    /// `Io` when no random bytes are available.
    pub fn mint_in(dir: &Path) -> Result<Self> {
        Ok(Self {
            socket: dir.join(protocol::SOCKET_FILE),
            token: boopis_hostops::token().map_err(|r| Error::Io(r.message))?,
        })
    }

    /// What the gateway gets in its launch environment, beside the secret channel's: the socket and the token.
    #[must_use]
    pub fn launch_env(&self) -> Vec<(String, String)> {
        vec![
            (
                protocol::SOCKET_ENV.to_owned(),
                self.socket.display().to_string(),
            ),
            (protocol::TOKEN_ENV.to_owned(), self.token.clone()),
        ]
    }
}

/// A plan changed: proposed, applied, failed, rejected, expired, or an undo was planned. The plans list shows these.
#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
pub struct PlansChangedEvent {
    /// The plan.
    pub plan_hash: String,
    /// Its state now.
    pub state: String,
}

/// The host's team-ops state for this run.
pub struct House {
    dir: PathBuf,
    grants: Arc<Grants>,
    app: Option<tauri::AppHandle>,
}

impl std::fmt::Debug for House {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("House")
            .field("dir", &self.dir)
            .finish_non_exhaustive()
    }
}

impl House {
    /// The state over `<app data>/house`; `app` is told when a plan changes. Plans older than 30 days that were not
    /// applied are cleared now.
    #[must_use]
    pub fn new(app_data: &Path, app: Option<tauri::AppHandle>) -> Arc<Self> {
        let dir = app_data.join("house");
        let cleared = PlanStore::under(&dir).clear_old(boopis_hostops::now_ms());
        if cleared > 0 {
            tracing::info!(
                cleared,
                "old team plans that were never applied were cleared"
            );
        }
        Arc::new(Self {
            dir,
            grants: Arc::new(Grants::default()),
            app,
        })
    }

    /// `<app data>/house`.
    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The plans folder.
    #[must_use]
    pub fn plans(&self) -> PlanStore {
        PlanStore::under(&self.dir)
    }

    /// A one-time owner grant for `purpose` (H5), for the window to pass in a loosening plugin call.
    ///
    /// # Errors
    /// `hx.invalid_params` for a purpose that takes no grant.
    pub fn grant(&self, purpose: &str) -> std::result::Result<String, Refusal> {
        self.grants.mint(purpose, boopis_hostops::now_ms())
    }

    /// Tell the windows that a plan changed.
    pub fn changed(&self, plan_hash: &str, state: &str) {
        let Some(app) = &self.app else { return };
        let event = PlansChangedEvent {
            plan_hash: plan_hash.to_owned(),
            state: state.to_owned(),
        };
        if let Err(e) = tauri_specta::Event::emit(&event, app) {
            tracing::debug!(error = %e, "could not tell the windows a plan changed");
        }
    }
}

/// A refusal as the window reads it.
#[must_use]
pub fn host_error(r: Refusal) -> HostError {
    HostError {
        code: r.code.to_owned(),
        message: r.message,
    }
}

/// The verbs the app does.
pub struct LiveOps {
    api: Arc<crate::local_api::LocalApi>,
    house: Arc<House>,
    /// This binary, for the verbs its command line holds (`team plan`, `run`); `None` when it cannot be found.
    exe: Option<PathBuf>,
    /// The name the host's label gives the owner.
    owner: String,
}

impl LiveOps {
    /// The verbs over the local API's service and this binary's command line.
    #[must_use]
    pub fn new(api: Arc<crate::local_api::LocalApi>, house: Arc<House>) -> Self {
        let owner = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .ok()
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| "the owner".to_owned());
        Self {
            api,
            house,
            exe: std::env::current_exe().ok(),
            owner,
        }
    }

    fn label(&self, text: &str) -> String {
        protocol::labelled(&self.owner, text)
    }
}

/// The local API's refusal as a host-ops refusal: its words already say what to do and never echo input.
fn from_api(e: &ApiError) -> Refusal {
    let code = match e.status {
        409 => "hx.rooms.busy",
        502 => "hx.engine.unavailable",
        _ => "hx.invalid_params",
    };
    Refusal {
        code,
        message: e.message.clone(),
    }
}

fn str_of<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or_default()
}

/// What this binary's command line answers for `args`, with `stdin` written to it: its last JSON line on standard output.
async fn run_cli(
    exe: &Path,
    args: &[String],
    envs: &[(&str, &str)],
    stdin: &str,
    wait: Duration,
) -> std::result::Result<Value, Refusal> {
    use tokio::io::AsyncWriteExt;
    let failed = || {
        Refusal::new(
            "hx.host.unavailable",
            "boopis could not do that just now. Try again in a moment.",
        )
    };
    let mut child = tokio::process::Command::new(exe)
        .args(args)
        .env_remove(protocol::TOKEN_ENV)
        .env_remove(crate::secrets::channel::TOKEN_ENV)
        .envs(envs.iter().copied())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failed())?;
    if let Some(mut input) = child.stdin.take() {
        input
            .write_all(stdin.as_bytes())
            .await
            .map_err(|_| failed())?;
    }
    let out = tokio::time::timeout(wait, child.wait_with_output())
        .await
        .map_err(|_| failed())?
        .map_err(|_| failed())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let last = text
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(failed)?;
    let v: Value = serde_json::from_str(last).map_err(|_| failed())?;
    if v.get("ok") == Some(&Value::Bool(false)) {
        let code = v["code"].as_str().unwrap_or_default();
        let code: &'static str = match code {
            "hx.team.unreadable" => "hx.team.unreadable",
            "hx.team.plan_not_found" => "hx.team.plan_not_found",
            "hx.team.plan_not_open" => "hx.team.plan_not_open",
            "hx.team.plan_expired" => "hx.team.plan_expired",
            "hx.team.plan_stale" => "hx.team.plan_stale",
            "hx.team.plan_tampered" => "hx.team.plan_tampered",
            "hx.team.plan_problems" => "hx.team.plan_problems",
            "hx.host.store_failed" => "hx.host.store_failed",
            _ => "hx.invalid_params",
        };
        return Err(Refusal {
            code,
            message: v["message"]
                .as_str()
                .unwrap_or("That could not be done.")
                .to_owned(),
        });
    }
    Ok(v)
}

/// Start `args` on this binary's command line in the background, its output kept in `log`. The child is reaped when it
/// ends; it is not tied to the request.
fn start_cli(exe: &Path, args: &[String], log: &Path) -> std::result::Result<(), Refusal> {
    let failed = |_| {
        Refusal::new(
            "hx.host.store_failed",
            "boopis could not start that run. Try again in a moment.",
        )
    };
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir).map_err(failed)?;
    }
    let out = std::fs::File::create(log).map_err(failed)?;
    let mut child = tokio::process::Command::new(exe)
        .args(args)
        .env_remove(protocol::TOKEN_ENV)
        .env_remove(crate::secrets::channel::TOKEN_ENV)
        .stdin(std::process::Stdio::null())
        .stdout(out)
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(failed)?;
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(())
}

impl Ops for LiveOps {
    #[allow(clippy::too_many_lines)] // one arm per verb
    fn call<'a>(&'a self, call: Call<'a>) -> OpFuture<'a> {
        Box::pin(async move {
            let p = call.params;
            let key = call.key.unwrap_or_default();
            let service = self.api.service();
            let by = Caller::through("house");
            match call.op {
                "room.say" => {
                    let room = str_of(p, "room_id");
                    if call.dry_run {
                        let log = service
                            .room_log(room, None, 1)
                            .await
                            .map_err(|e| from_api(&e))?;
                        let would = if log.working.is_empty() && log.held.is_empty() {
                            "send"
                        } else {
                            "hold"
                        };
                        return Ok(json!({"would": would, "working": log.working}));
                    }
                    let text = self.label(str_of(p, "text"));
                    let sent = service
                        .room_send_as(room, &text, How::WhenDone, &protocol::event_id(key))
                        .await
                        .map_err(|e| from_api(&e))?;
                    Ok(json!({"status": sent.status, "event_id": sent.event_id, "held": sent.held}))
                }
                "room.log" => {
                    let after = p.get("after").and_then(Value::as_u64);
                    let limit = p
                        .get("limit")
                        .and_then(Value::as_u64)
                        .and_then(|n| usize::try_from(n).ok())
                        .unwrap_or(50);
                    let log = service
                        .room_log(str_of(p, "room_id"), after, limit)
                        .await
                        .map_err(|e| from_api(&e))?;
                    serde_json::to_value(&log).map_err(|_| {
                        Refusal::new("hx.host.unavailable", "The log could not be read.")
                    })
                }
                "room.stop" => {
                    let room = str_of(p, "room_id");
                    if call.dry_run {
                        let log = service
                            .room_log(room, None, 1)
                            .await
                            .map_err(|e| from_api(&e))?;
                        return Ok(json!({"would": "stop", "working": log.working}));
                    }
                    service.room_stop(room, &by).await.map_err(|e| from_api(&e))
                }
                "bot.say" => {
                    if call.dry_run {
                        return Ok(json!({"would": "start"}));
                    }
                    let text = self.label(str_of(p, "text"));
                    let said = service
                        .say_as_house(str_of(p, "bot"), &text, &protocol::submission_id(key))
                        .await
                        .map_err(|e| from_api(&e))?;
                    Ok(json!({"session_id": said.session_id, "created": said.created}))
                }
                "session.stop" => {
                    if call.dry_run {
                        return Ok(json!({"would": "stop"}));
                    }
                    service
                        .bot_stop(str_of(p, "bot"), Some(str_of(p, "session_id")), &by)
                        .await
                        .map_err(|e| from_api(&e))
                }
                "room.run" | "bot.run" => {
                    if call.dry_run {
                        return Ok(json!({"would": "start"}));
                    }
                    let exe = self.exe.as_deref().ok_or_else(|| {
                        Refusal::new(
                            "hx.host.unavailable",
                            "boopis cannot start a run from here.",
                        )
                    })?;
                    let run_id = format!("run-{}", boopis_hostops::key_digest(key));
                    let mut args: Vec<String> = vec!["run".into()];
                    if call.op == "room.run" {
                        args.extend([
                            "--group".into(),
                            str_of(p, "room_id").to_owned(),
                            self.label(str_of(p, "task")),
                        ]);
                        if let Some(n) = p.get("max_rounds").and_then(Value::as_u64) {
                            args.extend(["--max-rounds".into(), n.to_string()]);
                        }
                        if let Some(b) = p.get("to_board").and_then(Value::as_str) {
                            args.extend(["--to-board".into(), b.to_owned()]);
                        }
                    } else {
                        args.extend([
                            "--bot".into(),
                            str_of(p, "bot").to_owned(),
                            self.label(str_of(p, "goal")),
                        ]);
                        if let Some(n) = p.get("max_turns").and_then(Value::as_u64) {
                            args.extend(["--max-turns".into(), n.to_string()]);
                        }
                    }
                    args.push("--json".into());
                    let log = self
                        .house
                        .dir()
                        .join("runs")
                        .join(format!("{run_id}.jsonl"));
                    start_cli(exe, &args, &log)?;
                    // The run's session is said by the run itself, in its log, once it has one: unknown here.
                    Ok(json!({"run_id": run_id, "status": "started", "session_id": Value::Null}))
                }
                "team.plan" => {
                    if call.dry_run {
                        return Ok(json!({"would": "plan"}));
                    }
                    let exe = self.exe.as_deref().ok_or_else(|| {
                        Refusal::new("hx.host.unavailable", "boopis cannot plan from here.")
                    })?;
                    let mut args: Vec<String> = vec![
                        "team".into(),
                        "plan".into(),
                        "-".into(),
                        "--json".into(),
                        "--reason".into(),
                        str_of(p, "reason").to_owned(),
                    ];
                    if let Some(j) = p.get("job_id").and_then(Value::as_str) {
                        args.extend(["--job".into(), j.to_owned()]);
                    }
                    let made = run_cli(
                        exe,
                        &args,
                        &[],
                        str_of(p, "fragment"),
                        Duration::from_secs(9),
                    )
                    .await?;
                    if let Some(h) = made["plan_hash"].as_str()
                        && made["state"] == "proposed"
                    {
                        self.house.changed(h, "proposed");
                    }
                    Ok(made)
                }
                _ => Err(Refusal::new(
                    "hx.method_not_found",
                    "There is no such operation.",
                )),
            }
        })
    }
}

/// Start the channel on `auth`'s socket: only the recorded gateway is served (`peers`), with `auth`'s token.
///
/// # Errors
/// `Io` when the socket cannot be made; `Unavailable` on a platform without a Unix socket.
pub async fn start(
    house: &Arc<House>,
    auth: &Auth,
    peers: Arc<PeerPolicy>,
    ops: Arc<dyn Ops>,
    app_data: &Path,
) -> Result<Listener> {
    let dispatcher = Arc::new(Dispatcher::new(
        auth.token.clone(),
        house.dir(),
        boopis_hostops::audit::Audit::at(&app_data.join("audit").join("house-ops.jsonl")),
        house.grants.clone(),
    ));
    let admit: listen::Admit = Arc::new(move |pid| match peers.admit(pid) {
        Ok(()) => true,
        Err(why) => {
            tracing::warn!(
                ?pid,
                ?why,
                "the host-ops channel refused a process that is not the gateway"
            );
            false
        }
    });
    let handle: listen::Handle = Arc::new(move |line, admitted| {
        let (dispatcher, ops) = (dispatcher.clone(), ops.clone());
        Box::pin(async move {
            dispatcher
                .handle(
                    ops.as_ref(),
                    &line,
                    admitted,
                    std::time::Instant::now(),
                    boopis_hostops::now_ms(),
                )
                .await
        })
    });
    listen::serve(
        &auth.socket,
        Opts {
            max_line: protocol::MAX_LINE,
            timeout: Duration::from_secs(10),
            conns: 8,
        },
        admit,
        handle,
    )
    .await
    .map_err(|e| {
        if e.kind() == std::io::ErrorKind::Unsupported {
            Error::Unavailable(e.to_string())
        } else {
            Error::Io(e.to_string())
        }
    })
}

/// Run `team apply --hash <plan_hash>` or `team undo <plan_hash>` on this binary's command line for the owner's hold, as
/// the window's surface (`BOOPIS_SURFACE=gui`). `args` are the command's words after `team`; `--json` is added.
///
/// # Errors
/// The command's refusal (`hx.team.*`), or `hx.host.unavailable`.
pub async fn held_cli(house: &House, args: &[&str]) -> std::result::Result<Value, Refusal> {
    let exe = std::env::current_exe().map_err(|_| {
        Refusal::new(
            "hx.host.unavailable",
            "boopis cannot find itself to do that.",
        )
    })?;
    let mut words: Vec<String> = vec!["team".into()];
    words.extend(args.iter().map(|a| (*a).to_owned()));
    words.push("--json".into());
    // A whole team can take a while to make: bots are made one at a time, each with its engine settings.
    let v = run_cli(
        &exe,
        &words,
        &[("BOOPIS_SURFACE", "gui")],
        "",
        Duration::from_secs(600),
    )
    .await?;
    if let Some(h) = v["plan_hash"].as_str() {
        house.changed(h, v["state"].as_str().unwrap_or_default());
    }
    Ok(v)
}
