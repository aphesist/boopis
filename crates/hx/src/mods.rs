//! `mods.*`: Claude Code mods, one sandboxed worker per session.
//!
//! The runtime (`hx-mods`) does not run in this process. `mods.load` starts `hx mods-worker`
//! inside `hx-sandbox`, with no files, network or processes of its own, and with one private
//! channel: a connected socket pair whose child end the sandbox passes as an inherited
//! descriptor. Everything crosses that channel as `hx-mods-v1` frames (`hx_mods::worker`).
//!
//! `hx` reads each plugin's sources through `cap_std` and sends them over the channel, because the
//! worker cannot read the plugin directory. A `$` call from a mod reaches `hx` as a `call` frame
//! and goes to the plugin as a `mods.call` request, answered by the policy there; nothing a mod
//! does leaves the worker any other way.
//!
//! Where the sandbox cannot be built (no private channel on Windows, or a kernel without Landlock
//! and seccomp), every method but `mods.capabilities` answers `hx.mods.unavailable` with the
//! reason. There is no unsandboxed fallback.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use hx_mods::wire::{
    self, CallParams, DispatchParams, HandlerParams, ListParams, LoadParams, ModsCapabilities,
    ReachParams, RenderParams, UnloadParams,
};
use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::{AppError, codes};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex as AsyncMutex, oneshot};

use crate::outbound::Link;

/// The environment variable that names the worker's channel descriptor.
pub const CHANNEL_ENV: &str = "HX_MODS_FD";

/// The longest one operation may take, which includes every `$` call it waits on (a form the
/// user has to answer, for one). Past it the worker is killed: a hook that waits forever must not
/// hold the session's mods for ever.
const OP_TIMEOUT: Duration = Duration::from_mins(30);
/// The longest `hx` waits for the plugin to answer one `$` call.
const CALL_TIMEOUT: Duration = Duration::from_mins(25);
/// The longest frame read from a worker. A worker is semi-trusted: a memory-safety bug in the
/// engine would make it hostile, so what it sends is bounded.
const MAX_WORKER_FRAME: usize = 16 * 1024 * 1024;
/// How much of the worker's error output is kept.
const STDERR_KEEP: usize = 8 * 1024;

const METHODS: &[&str] = &[
    wire::METHOD_CAPABILITIES,
    wire::METHOD_LOAD,
    wire::METHOD_UNLOAD,
    wire::METHOD_LIST,
    wire::METHOD_DISPATCH,
    wire::METHOD_RENDER,
    wire::METHOD_PRESS,
    wire::METHOD_INPUT,
    wire::METHOD_SELECT,
    wire::METHOD_REACH,
    wire::METHOD_ANALYZE,
];

type Waiting = oneshot::Sender<Result<Value, Value>>;
type Sessions = Arc<Mutex<HashMap<String, Arc<Session>>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One session's worker.
struct Session {
    id: String,
    writer: AsyncMutex<Box<dyn AsyncWrite + Send + Unpin>>,
    waiting: Mutex<HashMap<u64, Waiting>>,
    next: AtomicU64,
    alive: AtomicBool,
    kill: Box<dyn Fn() + Send + Sync>,
    stderr: Arc<Mutex<String>>,
    plugins: Mutex<Vec<Value>>,
}

fn worker_failed(message: impl Into<String>, stderr: &str) -> AppError {
    let mut e = AppError::new(codes::HX_MODS_WORKER_FAILED, message);
    e.details.insert("stderr".to_owned(), json!(stderr));
    e
}

fn app_error(code: &str, message: String) -> AppError {
    let known = match code {
        "hx.mods.load_failed" => codes::HX_MODS_LOAD_FAILED,
        "hx.mods.not_a_mod" => codes::HX_MODS_NOT_A_MOD,
        "hx.mods.already_loaded" => codes::HX_MODS_ALREADY_LOADED,
        "hx.mods.crashed" => codes::HX_MODS_CRASHED,
        "hx.invalid_params" => codes::HX_INVALID_PARAMS,
        _ => codes::HX_INTERNAL_ERROR,
    };
    AppError::new(known, message)
}

impl Session {
    fn stderr_text(&self) -> String {
        lock(&self.stderr).clone()
    }

    fn fail_all(&self, why: &AppError) {
        let doomed: Vec<_> = lock(&self.waiting).drain().collect();
        for (_, w) in doomed {
            let _ = w.send(Err(json!({ "code": why.code, "message": why.message })));
        }
    }

    async fn write(&self, frame: &Value) -> std::io::Result<()> {
        let mut line = frame.to_string();
        line.push('\n');
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes()).await?;
        w.flush().await
    }

    /// Sends one op and waits for its reply.
    async fn request(&self, mut frame: Value) -> Result<Value, AppError> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(worker_failed(
                "the worker is not running",
                &self.stderr_text(),
            ));
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        frame["id"] = json!(id);
        let (done, answer) = oneshot::channel();
        lock(&self.waiting).insert(id, done);
        if self.write(&frame).await.is_err() {
            lock(&self.waiting).remove(&id);
            return Err(worker_failed(
                "the worker's channel is closed",
                &self.stderr_text(),
            ));
        }
        match tokio::time::timeout(OP_TIMEOUT, answer).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(app_error(
                e["code"].as_str().unwrap_or("hx.internal_error"),
                e["message"].as_str().unwrap_or_default().to_owned(),
            )),
            Ok(Err(_)) => Err(worker_failed(
                "the worker stopped answering",
                &self.stderr_text(),
            )),
            Err(_) => {
                lock(&self.waiting).remove(&id);
                (self.kill)();
                Err(worker_failed(
                    "the worker did not answer in time and was stopped",
                    &self.stderr_text(),
                ))
            }
        }
    }
}

/// The handler of the `mods` namespace.
pub struct ModsHandler {
    link: Arc<Link>,
    sessions: Sessions,
}

impl ModsHandler {
    /// A handler whose workers send their `$` calls through `link`.
    #[must_use]
    pub fn new(link: Arc<Link>) -> Self {
        Self {
            link,
            sessions: Arc::default(),
        }
    }

    fn capabilities() -> ModsCapabilities {
        let platform = std::env::consts::OS.to_owned();
        match availability() {
            Ok(()) => ModsCapabilities {
                available: true,
                reason: None,
                platform,
            },
            Err(reason) => ModsCapabilities {
                available: false,
                reason: Some(reason),
                platform,
            },
        }
    }

    fn unavailable(reason: &str) -> AppError {
        let mut e = AppError::new(
            codes::HX_MODS_UNAVAILABLE,
            format!("mods are off: {reason}"),
        );
        e.details.insert("reason".to_owned(), json!(reason));
        e
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, AppError> {
        lock(&self.sessions).get(id).cloned().ok_or_else(|| {
            AppError::new(
                codes::HX_MODS_NO_SESSION,
                format!("no mod worker runs for session `{id}`"),
            )
        })
    }

    fn drop_session(&self, id: &str) {
        if let Some(s) = lock(&self.sessions).remove(id) {
            s.alive.store(false, Ordering::SeqCst);
            (s.kill)();
        }
    }

    async fn load(&self, params: Value) -> HandlerResult {
        let p: LoadParams = parse_params(params)?;
        availability().map_err(|r| Self::unavailable(&r))?;
        let mut set = Vec::new();
        for plugin in &p.plugins {
            let dir = std::path::PathBuf::from(&plugin.dir);
            let bundle = tokio::task::spawn_blocking(move || hx_mods::Bundle::read(&dir))
                .await
                .map_err(|e| AppError::internal(e.to_string()))?
                .map_err(|e| AppError::new(codes::HX_MODS_LOAD_FAILED, e.to_string()))?;
            set.push(json!({ "bundle": bundle, "tier": plugin.tier.clone().unwrap_or_else(|| "user".into()) }));
        }
        let existing = lock(&self.sessions).get(&p.session_id).cloned();
        let (session, fresh) = match existing {
            Some(s) if s.alive.load(Ordering::SeqCst) => (s, false),
            _ => (
                start_worker(&p.session_id, &self.link, &self.sessions).await?,
                true,
            ),
        };
        let result = session
            .request(json!({ "op": "load", "plugins": set }))
            .await;
        match result {
            Ok(v) => {
                let loaded = v["loaded"].as_array().cloned().unwrap_or_default();
                lock(&session.plugins).extend(loaded.iter().cloned());
                Ok(json!({ "loaded": loaded }))
            }
            Err(e) => {
                if fresh {
                    self.drop_session(&p.session_id);
                }
                Err(e)
            }
        }
    }

    /// Reads a plugin and says what it registers and calls, without running any of it. This needs
    /// no worker: the files are read through `cap_std` and parsed by the (memory-safe) transform.
    async fn analyze(params: Value) -> HandlerResult {
        let p: wire::AnalyzeParams = parse_params(params)?;
        let dir = std::path::PathBuf::from(p.dir);
        let report = tokio::task::spawn_blocking(move || -> Result<Value, AppError> {
            let load = |e: hx_mods::Error| AppError::new(codes::HX_MODS_LOAD_FAILED, e.to_string());
            let bundle = hx_mods::Bundle::read(&dir).map_err(load)?;
            let files = hx_mods::Files::Memory(bundle.clone());
            let manifest = hx_mods::Manifest::read(&files).map_err(|e| match e {
                hx_mods::Error::NotAMod(_) => AppError::new(codes::HX_MODS_NOT_A_MOD, e.to_string()),
                other => load(other),
            })?;
            let analysis = hx_mods::analyze::analyze(&bundle).map_err(load)?;
            Ok(json!({
                "plugin": manifest.name,
                "version": manifest.version,
                "entry_modules": manifest.modules,
                "modules": analysis.modules,
                "events": analysis.events(),
                "namespaces": analysis.namespaces(),
                "dynamic": analysis.dynamic(),
            }))
        })
        .await
        .map_err(|e| AppError::internal(e.to_string()))??;
        Ok(report)
    }

    async fn unload(&self, params: Value) -> HandlerResult {
        let p: UnloadParams = parse_params(params)?;
        let Some(plugin) = p.plugin else {
            let had = lock(&self.sessions).contains_key(&p.session_id);
            self.drop_session(&p.session_id);
            return to_result(&json!({ "unloaded": had }));
        };
        let session = self.session(&p.session_id)?;
        let v = session
            .request(json!({ "op": "unload", "name": plugin }))
            .await?;
        lock(&session.plugins).retain(|l| l["name"] != json!(plugin));
        Ok(v)
    }

    fn list(&self, params: Value) -> HandlerResult {
        let p: ListParams = parse_params(params)?;
        let sessions: Vec<Value> = lock(&self.sessions)
            .values()
            .filter(|s| p.session_id.as_deref().is_none_or(|id| id == s.id))
            .map(|s| {
                json!({
                    "session_id": s.id,
                    "running": s.alive.load(Ordering::SeqCst),
                    "plugins": lock(&s.plugins).clone(),
                })
            })
            .collect();
        Ok(json!({ "sessions": sessions }))
    }

    async fn forward(&self, session_id: &str, frame: Value) -> HandlerResult {
        self.session(session_id)?.request(frame).await
    }
}

impl Handler for ModsHandler {
    fn namespace(&self) -> Namespace {
        Namespace::Mods
    }

    fn methods(&self) -> &'static [&'static str] {
        METHODS
    }

    fn capabilities(&self) -> Vec<String> {
        let mut caps = vec!["mods.runtime".to_owned()];
        if availability().is_ok() {
            caps.push("mods.sandboxed_worker".to_owned());
        }
        caps
    }

    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        _ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        Box::pin(async move {
            match method {
                wire::METHOD_CAPABILITIES => to_result(&Self::capabilities()),
                wire::METHOD_LOAD => self.load(params).await,
                wire::METHOD_UNLOAD => self.unload(params).await,
                wire::METHOD_ANALYZE => Self::analyze(params).await,
                wire::METHOD_LIST => self.list(params),
                wire::METHOD_DISPATCH => {
                    let p: DispatchParams = parse_params(params)?;
                    self.forward(
                        &p.session_id,
                        json!({ "op": "dispatch", "event": p.event, "payload": p.payload }),
                    )
                    .await
                }
                wire::METHOD_RENDER => {
                    let p: RenderParams = parse_params(params)?;
                    self.forward(
                        &p.session_id,
                        json!({ "op": "render", "component": p.component, "pane": p.id, "props": p.props }),
                    )
                    .await
                }
                wire::METHOD_PRESS | wire::METHOD_INPUT | wire::METHOD_SELECT => {
                    let p: HandlerParams = parse_params(params)?;
                    let op = method.trim_start_matches("mods.");
                    let mut frame = json!({ "op": op, "handler": p.handler });
                    if op != "press" {
                        frame["value"] = json!(p.value.unwrap_or_default());
                    }
                    self.forward(&p.session_id, frame).await
                }
                wire::METHOD_REACH => {
                    let p: ReachParams = parse_params(params)?;
                    self.forward(&p.session_id, json!({ "op": "reach" })).await
                }
                other => Err(AppError::new(
                    codes::HX_METHOD_NOT_FOUND,
                    format!("no handler for `{other}`"),
                )),
            }
        })
    }
}

// ---------------------------------------------------------------------------------------------
// The platform part: starting the worker.

#[cfg(unix)]
fn availability() -> Result<(), String> {
    let caps = hx_sandbox::capabilities();
    for (cap, what) in [
        (&caps.fs, "file confinement"),
        (&caps.network_off, "network off"),
        (&caps.inherited_handle, "a private channel"),
    ] {
        if !cap.available {
            return Err(format!(
                "this machine's sandbox cannot enforce {what} ({}), and mods never run unsandboxed",
                cap.detail
            ));
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn availability() -> Result<(), String> {
    Err("there is no private channel for the sandboxed worker on this platform yet (hx-sandbox has it on Unix only), and mods never run unsandboxed".to_owned())
}

#[cfg(not(unix))]
async fn start_worker(
    _id: &str,
    _link: &Arc<Link>,
    _sessions: &Sessions,
) -> Result<Arc<Session>, AppError> {
    Err(ModsHandler::unavailable(
        &availability().err().unwrap_or_default(),
    ))
}

#[cfg(unix)]
async fn start_worker(
    id: &str,
    link: &Arc<Link>,
    sessions: &Sessions,
) -> Result<Arc<Session>, AppError> {
    use std::os::fd::{AsRawFd, OwnedFd};
    use std::os::unix::fs::DirBuilderExt;

    use hx_sandbox::{NetworkPolicy, SandboxPolicy, SpawnOptions};

    let internal =
        |what: &str, e: &dyn std::fmt::Display| AppError::internal(format!("{what}: {e}"));
    let (host_end, child_end) =
        std::os::unix::net::UnixStream::pair().map_err(|e| internal("socket pair", &e))?;
    host_end
        .set_nonblocking(true)
        .map_err(|e| internal("socket", &e))?;
    let host_end =
        tokio::net::UnixStream::from_std(host_end).map_err(|e| internal("socket", &e))?;
    let child_fd: OwnedFd = child_end.into();
    let fd_number = child_fd.as_raw_fd();

    let exe = std::env::current_exe().map_err(|e| internal("current_exe", &e))?;
    // A private, empty directory to stand in as the worker's working directory: it is granted
    // read-only, and holds nothing.
    let scratch = std::env::temp_dir().join(format!("hx-mods-{}", uuid::Uuid::now_v7()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .recursive(true)
        .create(&scratch)
        .map_err(|e| internal("scratch directory", &e))?;

    let mut policy = SandboxPolicy::new(&scratch)
        .with_ro(
            worker_read_paths()
                .into_iter()
                .chain([exe.clone(), scratch.clone()]),
        )
        .with_network(NetworkPolicy::Off)
        .with_env(CHANNEL_ENV, fd_number.to_string());
    policy.env_allowlist.clear();
    policy.timeout_ms = hx_sandbox::limits::MAX_TIMEOUT_MS;
    policy.resources.memory_bytes = Some(2 * 1024 * 1024 * 1024);
    // The worker has one thread besides its main one (the channel reader) and no reason to start a
    // process: any fork or exec past that is refused by the kernel.
    policy.resources.max_processes = Some(1);
    let argv = vec![exe.to_string_lossy().into_owned(), "mods-worker".to_owned()];
    let spawned =
        hx_sandbox::spawn(&argv, &policy, SpawnOptions::new().with_inherit(child_fd)).await;
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&scratch);
            return Err(match e {
                hx_sandbox::Error::Unavailable { .. } => ModsHandler::unavailable(&e.to_string()),
                other => AppError::new(
                    codes::HX_MODS_WORKER_FAILED,
                    format!("the sandboxed worker did not start: {other}"),
                ),
            });
        }
    };
    let stderr: Arc<Mutex<String>> = Arc::default();
    if let Some(r) = child.take_stderr() {
        tokio::spawn(keep_tail(r, stderr.clone()));
    }
    if let Some(r) = child.take_stdout() {
        tokio::spawn(keep_tail(r, Arc::default()));
    }
    let killer = child.kill_switch();
    let (read_half, write_half) = host_end.into_split();
    let session = Arc::new(Session {
        id: id.to_owned(),
        writer: AsyncMutex::new(Box::new(write_half)),
        waiting: Mutex::default(),
        next: AtomicU64::new(0),
        alive: AtomicBool::new(true),
        kill: Box::new(move || killer.kill()),
        stderr,
        plugins: Mutex::default(),
    });
    lock(sessions).insert(id.to_owned(), session.clone());

    tokio::spawn(read_channel(read_half, session.clone(), link.clone()));
    let (s, l, map) = (session.clone(), link.clone(), sessions.clone());
    tokio::spawn(async move {
        let outcome = child.wait().await;
        let _ = std::fs::remove_dir_all(&scratch);
        s.alive.store(false, Ordering::SeqCst);
        let reason = match outcome {
            Ok(o) => format!("the worker exited: {o:?}"),
            Err(e) => format!("the worker could not be waited for: {e}"),
        };
        s.fail_all(&worker_failed(reason.clone(), &s.stderr_text()));
        {
            let mut map = lock(&map);
            if map.get(&s.id).is_some_and(|m| Arc::ptr_eq(m, &s)) {
                map.remove(&s.id);
            }
        }
        l.notify(
            wire::METHOD_EXITED,
            json!({ "session_id": s.id, "reason": reason, "stderr": s.stderr_text() }),
        )
        .await;
    });
    Ok(session)
}

/// What the worker may read besides its own binary: the dynamic loader and the system libraries
/// it links, and nothing else. Not `/bin`, not `/etc/passwd`: the sandbox's general read list
/// would let the worker read host files and run any program on the system.
#[cfg(unix)]
fn worker_read_paths() -> Vec<std::path::PathBuf> {
    if cfg!(target_os = "linux") {
        [
            "/lib",
            "/lib32",
            "/lib64",
            "/libx32",
            "/usr/lib",
            "/usr/lib32",
            "/usr/lib64",
            "/usr/libx32",
            "/etc/ld.so.cache",
        ]
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect()
    } else {
        hx_sandbox::SandboxPolicy::system_read_paths()
            .into_iter()
            .filter(|p| {
                let s = p.to_string_lossy();
                !s.ends_with("passwd") && !s.ends_with("group")
            })
            .collect()
    }
}

/// Keeps the last [`STDERR_KEEP`] bytes of a stream.
async fn keep_tail<R: AsyncRead + Unpin>(mut r: R, into: Arc<Mutex<String>>) {
    let mut buf = [0u8; 2048];
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                let mut t = lock(&into);
                t.push_str(&String::from_utf8_lossy(&buf[..n]));
                if t.len() > STDERR_KEEP {
                    let mut cut = t.len() - STDERR_KEEP;
                    while !t.is_char_boundary(cut) {
                        cut += 1;
                    }
                    t.drain(..cut);
                }
            }
        }
    }
}

/// Reads one line of at most `max` bytes. `None` at the end of input or past the cap.
async fn read_line<R: AsyncRead + Unpin>(reader: &mut BufReader<R>, max: usize) -> Option<String> {
    use tokio::io::AsyncBufReadExt;
    let mut buf = Vec::new();
    let n = AsyncReadExt::take(&mut *reader, max as u64 + 1)
        .read_until(b'\n', &mut buf)
        .await
        .ok()?;
    if n == 0 || buf.len() > max {
        return None;
    }
    String::from_utf8(buf).ok()
}

#[cfg(unix)]
async fn read_channel(
    half: tokio::net::unix::OwnedReadHalf,
    session: Arc<Session>,
    link: Arc<Link>,
) {
    let mut reader = BufReader::new(half);
    while let Some(line) = read_line(&mut reader, MAX_WORKER_FRAME).await {
        let Ok(frame) = serde_json::from_str::<Value>(line.trim_end()) else {
            continue;
        };
        if let Some(id) = frame.get("re").and_then(Value::as_u64) {
            let waiter = lock(&session.waiting).remove(&id);
            if let Some(w) = waiter {
                let outcome = match frame.get("err") {
                    Some(e) => Err(e.clone()),
                    None => Ok(frame.get("ok").cloned().unwrap_or(Value::Null)),
                };
                let _ = w.send(outcome);
            }
        } else if let Some(cid) = frame.get("call").and_then(Value::as_u64) {
            // Queue the request before reading the next frame, so the plugin sees a mod's call
            // before the reply to the operation that made it.
            forward_call(&session, &link, cid, &frame).await;
        } else if let Some(d) = frame.get("diag") {
            link.notify(
                wire::METHOD_DIAGNOSTIC,
                json!({ "session_id": session.id, "level": d["level"], "plugin": d["plugin"], "message": d["message"] }),
            )
            .await;
        }
    }
    // The channel closed: the child's exit task says why.
    session.alive.store(false, Ordering::SeqCst);
}

/// Queues one `$` call for the plugin and, in a task, sends its answer back to the worker.
async fn forward_call(session: &Arc<Session>, link: &Arc<Link>, cid: u64, frame: &Value) {
    let plugin = frame["plugin"].as_str().unwrap_or_default().to_owned();
    let known = lock(&session.plugins)
        .iter()
        .any(|l| l["name"] == json!(plugin));
    // The name comes from the worker. A call naming a mod that is not loaded in this session is
    // refused here: it never reaches the plugin's policy.
    if !known {
        let reply = json!({ "ret": cid, "err": { "code": "hx.policy.denied", "message": "a call named a mod that is not loaded in this session" } });
        let _ = session.write(&reply).await;
        return;
    }
    let params = serde_json::to_value(CallParams {
        session_id: session.id.clone(),
        plugin,
        call: frame["name"].as_str().unwrap_or_default().to_owned(),
        args: frame.get("args").cloned().unwrap_or(Value::Null),
    })
    .unwrap_or(Value::Null);
    let sent = link.begin(wire::METHOD_CALL, params).await;
    let session = session.clone();
    tokio::spawn(async move {
        let outcome = match sent {
            Ok(sent) => sent.wait(CALL_TIMEOUT).await,
            Err(e) => Err(e),
        };
        let reply = match outcome {
            Ok(v) => json!({ "ret": cid, "ok": v }),
            Err(e) => json!({ "ret": cid, "err": { "code": e.code, "message": e.message } }),
        };
        let _ = session.write(&reply).await;
    });
}

/// The worker's entry point: serves `hx-mods-v1` on the inherited channel until it closes.
///
/// # Errors
/// The channel is missing, or the runtime cannot start.
#[cfg(unix)]
pub fn run_worker() -> anyhow::Result<()> {
    use anyhow::Context;
    let stream = hx_sandbox::inherited_stream(CHANNEL_ENV).context("no channel to the parent")?;
    let writer = stream.try_clone().context("cloning the channel")?;
    // From here the worker never starts a program. If this machine cannot say so, the worker's
    // `reach` report shows it; the sandbox's own limits still hold.
    if let Err(e) = hx_sandbox::forbid_exec() {
        eprintln!("hx mods-worker: could not forbid exec: {e}");
    }
    hx_mods::worker::serve(stream, writer, hx_mods::RuntimeConfig::default())
        .map_err(|e| anyhow::anyhow!("{e}"))
}

/// The worker's entry point. Mods are off on this platform, so there is nothing to run.
///
/// # Errors
/// Always: there is no channel to serve on.
#[cfg(not(unix))]
pub fn run_worker() -> anyhow::Result<()> {
    anyhow::bail!("mods are off on this platform")
}
