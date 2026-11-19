//! `mods.*`: Claude Code mods, one sandboxed worker process per mod.
//!
//! The runtime (`hx-mods`) does not run in this process. Every mod gets its own `hx mods-worker`
//! inside `hx-sandbox`, with no files, network or processes of its own, its own heap budget, and
//! one private channel: a connected socket pair whose child end the sandbox passes as an inherited
//! descriptor. Everything crosses that channel as `hx-mods-v2` frames (`hx_mods::worker`). The
//! event chain, which crosses mods, runs here (`hx_mods::chain`), so a mod that runs out of memory,
//! loops, waits for a form or dies takes down only itself.
//!
//! `hx` reads each plugin's sources through `cap_std` and sends them over the channel, because the
//! worker cannot read the plugin directory. A `$` call from a mod reaches `hx` as a `call` frame
//! and goes to the plugin as a `mods.call` request, answered by the policy there. Each worker is
//! bound to one mod name, and `hx` stamps that name on its calls itself: a worker that went rogue
//! could not speak for another mod.
//!
//! A worker that exits (a crash, the sandbox's one-hour ceiling, the kernel's memory limit) is
//! reported to the plugin with `mods.exited`; its place in the chain is kept, and `mods.load` puts a
//! new worker there (`replace` starts the new one before stopping the old).
//!
//! Where the sandbox cannot be built (no private channel on Windows, or a kernel without Landlock
//! and seccomp), every method but `mods.capabilities` answers `hx.mods.unavailable` with the
//! reason. There is no unsandboxed fallback.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use hx_mods::chain::{BoxFut, Chain, HostSink, ModWorker};
use hx_mods::wire::{
    self, CallParams, DispatchParams, ExitedParams, FailedMod, HandlerParams, ListParams,
    LoadParams, ModLimits, ModsCapabilities, ReachParams, RenderParams, UnloadParams,
};
use hx_mods::{Budgets, Bundle, Diagnostic, Files, HostError, HostRequest, Manifest, Tier};
use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::{AppError, codes};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

use crate::outbound::Link;

/// The environment variable that names the worker's channel descriptor.
pub const CHANNEL_ENV: &str = "HX_MODS_FD";
/// The environment variable that carries the worker's limits (`wire::ModLimits` as JSON).
pub const LIMITS_ENV: &str = "HX_MODS_LIMITS";

/// The longest `hx` waits for the plugin to answer one `$` call.
const CALL_TIMEOUT: Duration = Duration::from_mins(25);
/// The longest a worker may take to load a mod.
const LOAD_TIMEOUT: Duration = Duration::from_mins(5);
/// The longest a probe (`reach`) may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a replaced worker keeps running, so hooks already in flight in it can finish.
const RETIRE_GRACE: Duration = Duration::from_secs(5);
/// How much of the worker's error output is kept.
const STDERR_KEEP: usize = 8 * 1024;
/// A mod's default heap budget, in MiB.
const DEFAULT_HEAP_MIB: u64 = 64;
/// The most a hook may run by default, in milliseconds.
const DEFAULT_EVENT_MS: u64 = 10_000;
/// Address space the worker may map besides the engine's heap: the binary, thread stacks, the
/// allocator's arenas.
const WORKER_OVERHEAD_MIB: u64 = 768;

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

type Sessions = Arc<Mutex<HashMap<String, Arc<Session>>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
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
        "hx.mods.worker_failed" => codes::HX_MODS_WORKER_FAILED,
        "hx.invalid_params" => codes::HX_INVALID_PARAMS,
        _ => codes::HX_INTERNAL_ERROR,
    };
    AppError::new(known, message)
}

/// Where a session's workers send their `$` calls and diagnostics: to the plugin.
struct SessionSink {
    id: String,
    link: Arc<Link>,
    diagnostics: mpsc::UnboundedSender<Diagnostic>,
}

impl HostSink for SessionSink {
    fn begin(&self, request: HostRequest) -> BoxFut<BoxFut<Result<Value, HostError>>> {
        let (link, session_id) = (self.link.clone(), self.id.clone());
        Box::pin(async move {
            let params = serde_json::to_value(CallParams {
                session_id,
                plugin: request.plugin,
                call: request.call,
                args: request.args,
            })
            .unwrap_or(Value::Null);
            let sent = link.begin(wire::METHOD_CALL, params).await;
            let inner: BoxFut<Result<Value, HostError>> = Box::pin(async move {
                let outcome = match sent {
                    Ok(sent) => sent.wait(CALL_TIMEOUT).await,
                    Err(e) => Err(e),
                };
                outcome.map_err(|e| HostError {
                    code: e.code,
                    message: e.message,
                })
            });
            inner
        })
    }

    fn diagnostic(&self, diagnostic: Diagnostic) {
        let _ = self.diagnostics.send(diagnostic);
    }
}

/// One worker, from the parent's side.
struct Running {
    worker: Arc<ModWorker>,
    pid: u32,
    started: Instant,
    lifetime: Duration,
    generation: u32,
    stderr: Arc<Mutex<String>>,
    /// What loaded: the module files and how many hooks `register` added.
    loaded: Mutex<(Vec<String>, u64)>,
    /// Replaced or unloaded on purpose: its exit is not news.
    retired: AtomicBool,
}

impl Running {
    fn stderr_text(&self) -> String {
        lock(&self.stderr).clone()
    }

    fn retire(&self) {
        self.retired.store(true, Ordering::SeqCst);
    }
}

/// One mod of one session. It outlives its workers: the slot, the tier and the generation count stay.
struct ModEntry {
    idx: usize,
    name: String,
    tier: Tier,
    generation: AtomicU32,
    running: Mutex<Option<Arc<Running>>>,
    /// The directory it was last loaded from.
    dir: Mutex<String>,
}

impl ModEntry {
    fn current(&self) -> Option<Arc<Running>> {
        lock(&self.running).clone()
    }

    fn view(&self) -> Value {
        let r = self.current();
        let (modules, hooks) = r
            .as_ref()
            .map(|r| lock(&r.loaded).clone())
            .unwrap_or_default();
        json!({
            "name": self.name,
            "dir": lock(&self.dir).clone(),
            "tier": self.tier.name(),
            "modules": modules,
            "hooks": hooks,
            "generation": r.as_ref().map_or_else(|| self.generation.load(Ordering::SeqCst).saturating_sub(1), |r| r.generation),
            "pid": r.as_ref().map(|r| r.pid),
            "expires_in_s": r.as_ref().map(|r| r.lifetime.saturating_sub(r.started.elapsed()).as_secs()),
            "running": r.as_ref().is_some_and(|r| r.worker.alive()),
        })
    }
}

/// One session: its chain and its mods.
struct Session {
    id: String,
    chain: Arc<Chain>,
    link: Arc<Link>,
    sink: Arc<SessionSink>,
    mods: Mutex<HashMap<String, Arc<ModEntry>>>,
    /// Loads of one session run one at a time.
    loading: AsyncMutex<()>,
}

impl Session {
    fn new(id: &str, link: &Arc<Link>) -> Arc<Self> {
        let (tx, mut rx) = mpsc::unbounded_channel::<Diagnostic>();
        let sink = Arc::new(SessionSink {
            id: id.to_owned(),
            link: link.clone(),
            diagnostics: tx,
        });
        let (forward, session_id) = (link.clone(), id.to_owned());
        tokio::spawn(async move {
            while let Some(d) = rx.recv().await {
                forward
                    .notify(
                        wire::METHOD_DIAGNOSTIC,
                        json!({ "session_id": session_id, "level": d.level, "plugin": d.plugin, "message": d.message }),
                    )
                    .await;
            }
        });
        Arc::new(Self {
            id: id.to_owned(),
            chain: Chain::new(sink.clone(), hx_mods::RuntimeConfig::default()),
            link: link.clone(),
            sink,
            mods: Mutex::default(),
            loading: AsyncMutex::new(()),
        })
    }

    fn entry(&self, name: &str) -> Option<Arc<ModEntry>> {
        lock(&self.mods).get(name).cloned()
    }

    fn stop(&self) {
        let entries: Vec<_> = lock(&self.mods).drain().map(|(_, e)| e).collect();
        for e in entries {
            if let Some(r) = lock(&e.running).take() {
                r.retire();
                r.worker.kill();
            }
            self.chain.retire(e.idx);
        }
    }
}

/// The handler of the `mods` namespace.
pub struct ModsHandler {
    link: Arc<Link>,
    sessions: Sessions,
}

/// A plugin read from disk, ready to load.
struct Item {
    dir: String,
    tier: Tier,
    limits: ModLimits,
    bundle: Bundle,
    manifest: Manifest,
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

    fn drop_session(&self, id: &str) -> bool {
        let session = lock(&self.sessions).remove(id);
        session.is_some_and(|s| {
            s.stop();
            true
        })
    }

    /// Reads one plugin: its sources and its manifest. Failures are per plugin.
    async fn read_item(plugin: &wire::PluginRef) -> Result<Item, FailedMod> {
        let failed = |plugin_name: Option<String>, code: &str, message: String| FailedMod {
            dir: plugin.dir.clone(),
            plugin: plugin_name,
            code: code.to_owned(),
            message,
        };
        let Some(tier) = Tier::parse(plugin.tier.as_deref().unwrap_or("user")) else {
            return Err(failed(
                None,
                "hx.invalid_params",
                "tier must be prepend, user or append".to_owned(),
            ));
        };
        let dir = std::path::PathBuf::from(&plugin.dir);
        let read =
            tokio::task::spawn_blocking(move || -> Result<(Bundle, Manifest), hx_mods::Error> {
                let bundle = Bundle::read(&dir)?;
                let manifest = Manifest::read(&Files::Memory(bundle.clone()))?;
                Ok((bundle, manifest))
            })
            .await;
        match read {
            Ok(Ok((bundle, manifest))) => Ok(Item {
                dir: plugin.dir.clone(),
                tier,
                limits: plugin.limits.clone().unwrap_or_default(),
                bundle,
                manifest,
            }),
            Ok(Err(e)) => Err(failed(
                None,
                match e {
                    hx_mods::Error::NotAMod(_) => "hx.mods.not_a_mod",
                    _ => "hx.mods.load_failed",
                },
                e.to_string(),
            )),
            Err(e) => Err(failed(None, "hx.internal_error", e.to_string())),
        }
    }

    async fn load(&self, params: Value) -> HandlerResult {
        let p: LoadParams = parse_params(params)?;
        availability().map_err(|r| Self::unavailable(&r))?;
        let mut items = Vec::new();
        let mut failed = Vec::new();
        for plugin in &p.plugins {
            match Self::read_item(plugin).await {
                Ok(item) => items.push(item),
                Err(f) => failed.push(f),
            }
        }
        let graph: Vec<_> = items
            .iter()
            .map(|i| (i.manifest.name.clone(), i.manifest.dependencies.clone()))
            .collect();
        let order = hx_mods::load_order(&graph)
            .map_err(|e| AppError::new(codes::HX_MODS_LOAD_FAILED, e.to_string()))?;
        let existing = lock(&self.sessions).get(&p.session_id).cloned();
        let created = existing.is_none();
        let session = existing.unwrap_or_else(|| Session::new(&p.session_id, &self.link));
        lock(&self.sessions).insert(p.session_id.clone(), session.clone());
        let _one_at_a_time = session.loading.lock().await;
        let mut slots: Vec<_> = items.into_iter().map(Some).collect();
        let mut loaded = Vec::new();
        for i in order {
            let Some(item) = slots[i].take() else {
                continue;
            };
            match start_mod(&session, &item, p.replace).await {
                Ok(entry) => loaded.push(entry.view()),
                Err(e) => failed.push(FailedMod {
                    dir: item.dir.clone(),
                    plugin: Some(item.manifest.name.clone()),
                    code: e.code.to_owned(),
                    message: e.message,
                }),
            }
        }
        if created && lock(&session.mods).is_empty() {
            lock(&self.sessions).remove(&p.session_id);
        }
        Ok(json!({ "loaded": loaded, "failed": failed }))
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
                hx_mods::Error::NotAMod(_) => {
                    AppError::new(codes::HX_MODS_NOT_A_MOD, e.to_string())
                }
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

    fn unload(&self, params: Value) -> HandlerResult {
        let p: UnloadParams = parse_params(params)?;
        let Some(plugin) = p.plugin else {
            return to_result(&json!({ "unloaded": self.drop_session(&p.session_id) }));
        };
        let session = self.session(&p.session_id)?;
        let entry = lock(&session.mods).remove(&plugin);
        let Some(entry) = entry else {
            return Ok(json!({ "unloaded": false }));
        };
        if let Some(r) = lock(&entry.running).take() {
            r.retire();
            r.worker.kill();
        }
        session.chain.retire(entry.idx);
        Ok(json!({ "unloaded": true }))
    }

    fn list(&self, params: Value) -> HandlerResult {
        let p: ListParams = parse_params(params)?;
        let sessions: Vec<Value> = lock(&self.sessions)
            .values()
            .filter(|s| p.session_id.as_deref().is_none_or(|id| id == s.id))
            .map(|s| {
                let mut entries: Vec<_> = lock(&s.mods).values().cloned().collect();
                entries.sort_by_key(|e| e.idx);
                let plugins: Vec<Value> = entries.iter().map(|e| e.view()).collect();
                json!({
                    "session_id": s.id,
                    "running": plugins.iter().any(|v| v["running"] == json!(true)),
                    "plugins": plugins,
                })
            })
            .collect();
        Ok(json!({ "sessions": sessions }))
    }

    async fn reach(&self, params: Value) -> HandlerResult {
        let p: ReachParams = parse_params(params)?;
        let session = self.session(&p.session_id)?;
        let mut entries: Vec<_> = lock(&session.mods).values().cloned().collect();
        entries.sort_by_key(|e| e.idx);
        let running = entries
            .iter()
            .filter(|e| p.plugin.as_deref().is_none_or(|n| n == e.name))
            .find_map(|e| e.current());
        let Some(running) = running else {
            return Err(worker_failed("no worker is running for that mod", ""));
        };
        running
            .worker
            .request(json!({ "op": "reach" }), PROBE_TIMEOUT)
            .await
            .map_err(|e| app_error(&e.code, e.message))
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
            caps.push("mods.worker_per_mod".to_owned());
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
            let internal = |e: hx_mods::Error| AppError::internal(e.to_string());
            match method {
                wire::METHOD_CAPABILITIES => to_result(&Self::capabilities()),
                wire::METHOD_LOAD => self.load(params).await,
                wire::METHOD_UNLOAD => self.unload(params),
                wire::METHOD_ANALYZE => Self::analyze(params).await,
                wire::METHOD_LIST => self.list(params),
                wire::METHOD_REACH => self.reach(params).await,
                wire::METHOD_DISPATCH => {
                    let p: DispatchParams = parse_params(params)?;
                    let session = self.session(&p.session_id)?;
                    let a = session
                        .chain
                        .dispatch(&p.event, &p.payload, p.plugin.as_deref())
                        .await
                        .map_err(internal)?;
                    Ok(
                        json!({ "answered": a.answered, "value": a.value, "answered_by": a.answered_by }),
                    )
                }
                wire::METHOD_RENDER => {
                    let p: RenderParams = parse_params(params)?;
                    let session = self.session(&p.session_id)?;
                    let r = session
                        .chain
                        .render(&p.component, p.id.as_deref(), &p.props)
                        .await
                        .map_err(internal)?;
                    Ok(render_json(r.render, r.plugin))
                }
                wire::METHOD_PRESS | wire::METHOD_INPUT | wire::METHOD_SELECT => {
                    let p: HandlerParams = parse_params(params)?;
                    let session = self.session(&p.session_id)?;
                    let event = match method {
                        wire::METHOD_PRESS => "ui.press",
                        wire::METHOD_INPUT => "ui.input",
                        _ => "ui.select",
                    };
                    let value =
                        (method != wire::METHOD_PRESS).then(|| p.value.clone().unwrap_or_default());
                    let handled = session
                        .chain
                        .callback(event, &p.handler, value.as_deref())
                        .await
                        .map_err(internal)?;
                    Ok(json!({ "handled": handled }))
                }
                other => Err(AppError::new(
                    codes::HX_METHOD_NOT_FOUND,
                    format!("no handler for `{other}`"),
                )),
            }
        })
    }
}

fn render_json(r: hx_mods::Render, plugin: Option<String>) -> Value {
    let mut v = match r {
        hx_mods::Render::Tree { tree, stats } => json!({
            "kind": "tree", "tree": tree,
            "stats": { "elements": stats.elements, "chars": stats.chars, "depth": stats.depth },
        }),
        hx_mods::Render::Default { props } => json!({ "kind": "default", "props": props }),
        hx_mods::Render::Skipped { reason } => json!({ "kind": "skipped", "reason": reason }),
    };
    if let Some(p) = plugin {
        v["plugin"] = json!(p);
    }
    v
}

/// Starts a worker for one mod, loads it, and puts it in its place in the chain.
async fn start_mod(
    session: &Arc<Session>,
    item: &Item,
    replace: bool,
) -> Result<Arc<ModEntry>, AppError> {
    let name = item.manifest.name.clone();
    let existing = session.entry(&name);
    if let Some(e) = &existing
        && e.current().is_some_and(|r| r.worker.alive())
        && !replace
    {
        return Err(AppError::new(
            codes::HX_MODS_ALREADY_LOADED,
            format!("`{name}` is already loaded"),
        ));
    }
    let fresh = existing.is_none();
    let entry = existing.unwrap_or_else(|| {
        let budgets = Budgets {
            event: Duration::from_millis(item.limits.event_budget_ms.unwrap_or(DEFAULT_EVENT_MS)),
            ..Budgets::default()
        };
        let idx = session.chain.add_slot(&name, item.tier, budgets);
        let entry = Arc::new(ModEntry {
            idx,
            name: name.clone(),
            tier: item.tier,
            generation: AtomicU32::new(0),
            running: Mutex::default(),
            dir: Mutex::default(),
        });
        lock(&session.mods).insert(name.clone(), entry.clone());
        entry
    });
    let generation = entry.generation.fetch_add(1, Ordering::SeqCst);
    let started = spawn_worker(session, &entry, item, generation).await;
    let running = match started {
        Ok(r) => r,
        Err(e) => {
            if fresh {
                lock(&session.mods).remove(&name);
                session.chain.retire(entry.idx);
            }
            return Err(e);
        }
    };
    item.dir.clone_into(&mut lock(&entry.dir));
    let old = lock(&entry.running).replace(running.clone());
    session
        .chain
        .set_worker(entry.idx, Some(running.worker.clone()));
    if let Some(old) = old {
        // The new worker already holds the mod's place; the old one finishes what it was doing.
        old.retire();
        tokio::spawn(async move {
            tokio::time::sleep(RETIRE_GRACE).await;
            old.worker.kill();
        });
    }
    Ok(entry)
}

// ---------------------------------------------------------------------------------------------
// The platform part: starting the worker.

#[cfg(not(unix))]
async fn spawn_worker(
    _session: &Arc<Session>,
    _entry: &Arc<ModEntry>,
    _item: &Item,
    _generation: u32,
) -> Result<Arc<Running>, AppError> {
    Err(ModsHandler::unavailable(
        &availability().err().unwrap_or_default(),
    ))
}

/// Says how a worker's process ended, in words, and whether that was the sandbox's ceiling.
#[cfg(unix)]
fn exit_reason(outcome: &hx_sandbox::Result<hx_sandbox::ExitOutcome>) -> (&'static str, String) {
    use hx_sandbox::ExitOutcome;
    match outcome {
        Ok(ExitOutcome::TimedOut) => (
            "ceiling",
            "the worker reached the sandbox's lifetime limit".to_owned(),
        ),
        Ok(ExitOutcome::Exited { code }) => {
            ("crash", format!("the worker exited with status {code}"))
        }
        Ok(ExitOutcome::Signaled { signal }) => {
            ("crash", format!("the worker was killed by signal {signal}"))
        }
        Ok(ExitOutcome::SpawnFailed { reason }) => {
            ("crash", format!("the worker did not start: {reason}"))
        }
        Err(e) => ("crash", format!("the worker could not be waited for: {e}")),
    }
}

#[cfg(unix)]
async fn spawn_worker(
    session: &Arc<Session>,
    entry: &Arc<ModEntry>,
    item: &Item,
    generation: u32,
) -> Result<Arc<Running>, AppError> {
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

    let heap_mib = item.limits.heap_mib.unwrap_or(DEFAULT_HEAP_MIB).max(1);
    let lifetime = Duration::from_secs(
        item.limits
            .lifetime_s
            .unwrap_or(hx_sandbox::limits::MAX_TIMEOUT_MS / 1000)
            .clamp(1, hx_sandbox::limits::MAX_TIMEOUT_MS / 1000),
    );
    let limits = json!({
        "heap_mib": heap_mib,
        "event_budget_ms": item.limits.event_budget_ms.unwrap_or(DEFAULT_EVENT_MS),
    });
    let mut policy = SandboxPolicy::new(&scratch)
        .with_ro(
            worker_read_paths()
                .into_iter()
                .chain([exe.clone(), scratch.clone()]),
        )
        .with_network(NetworkPolicy::Off)
        .with_env(CHANNEL_ENV, fd_number.to_string())
        .with_env(LIMITS_ENV, limits.to_string());
    policy.env_allowlist.clear();
    policy.timeout_ms = u64::try_from(lifetime.as_millis()).unwrap_or(u64::MAX);
    // The mod's heap budget is the engine's own limit; this is the process's, a second wall for a
    // mod that finds memory the engine does not count.
    policy.resources.memory_bytes = Some((heap_mib + WORKER_OVERHEAD_MIB) * 1024 * 1024);
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
    let pid = child.pid();
    let killer = child.kill_switch();
    let (read_half, write_half) = host_end.into_split();
    let worker = ModWorker::attach(
        read_half,
        write_half,
        (&entry.name, entry.idx, generation),
        session.sink.clone(),
        Box::new(move || killer.kill()),
        session.chain.tick_handler(),
    );
    let running = Arc::new(Running {
        worker: worker.clone(),
        pid,
        started: Instant::now(),
        lifetime,
        generation,
        stderr,
        loaded: Mutex::default(),
        retired: AtomicBool::new(false),
    });

    // Reports the worker's end, once, whatever it was.
    let watcher = (session.clone(), entry.clone(), running.clone());
    tokio::spawn(async move {
        let (session, entry, running) = watcher;
        let outcome = child.wait().await;
        let _ = std::fs::remove_dir_all(&scratch);
        if running.retired.load(Ordering::SeqCst) {
            return;
        }
        let (cause, reason) = exit_reason(&outcome);
        let current = {
            let mut slot = lock(&entry.running);
            if slot.as_ref().is_some_and(|c| Arc::ptr_eq(c, &running)) {
                *slot = None;
                true
            } else {
                false
            }
        };
        if current {
            session.chain.set_worker(entry.idx, None);
            session
                .link
                .notify(
                    wire::METHOD_EXITED,
                    serde_json::to_value(ExitedParams {
                        session_id: session.id.clone(),
                        plugin: entry.name.clone(),
                        generation: running.generation,
                        cause: cause.to_owned(),
                        reason,
                        stderr: running.stderr_text(),
                    })
                    .unwrap_or(Value::Null),
                )
                .await;
        }
    });

    // Load the mod. A failure stops this worker and nothing else.
    let bundle = serde_json::to_value(&item.bundle).unwrap_or(Value::Null);
    let loaded = worker
        .request(
            json!({
                "op": "load", "bundle": bundle, "tier": item.tier.name(),
                "idx": entry.idx, "gen": generation,
            }),
            LOAD_TIMEOUT,
        )
        .await;
    match loaded {
        Ok(v) => {
            let info = &v["loaded"];
            *lock(&running.loaded) = (
                info["modules"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m.as_str().map(str::to_owned))
                    .collect(),
                info["hooks"].as_u64().unwrap_or(0),
            );
            Ok(running)
        }
        Err(e) => {
            running.retire();
            worker.kill();
            let stderr = running.stderr_text();
            Err(match e.code.as_str() {
                "hx.mods.worker_failed" => worker_failed(e.message, &stderr),
                code => app_error(code, e.message),
            })
        }
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

/// The limits the parent put in the worker's environment, as a runtime configuration.
fn worker_config() -> hx_mods::RuntimeConfig {
    let limits: wire::ModLimits = std::env::var(LIMITS_ENV)
        .ok()
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    let mut config = hx_mods::RuntimeConfig::default();
    if let Some(mib) = limits.heap_mib {
        config.memory_limit =
            usize::try_from(mib.saturating_mul(1024 * 1024)).unwrap_or(config.memory_limit);
    }
    if let Some(ms) = limits.event_budget_ms {
        config.budgets.event = Duration::from_millis(ms);
    }
    config
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
    hx_mods::worker::serve(stream, writer, worker_config()).map_err(|e| anyhow::anyhow!("{e}"))
}

/// The worker's entry point. Mods are off on this platform, so there is nothing to run.
///
/// # Errors
/// Always: there is no channel to serve on.
#[cfg(not(unix))]
pub fn run_worker() -> anyhow::Result<()> {
    anyhow::bail!("mods are off on this platform")
}
