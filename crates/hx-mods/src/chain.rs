//! The event chain, across mods. Each mod runs in a worker of its own (`worker.rs`); the chain
//! runs here, in the parent, and only decides who is asked, in what order and what happens when a
//! hook passes, answers, throws or runs past its budget. No mod code runs in this process.
//!
//! The semantics are Claude Code's: tiers (`prepend`, user mods with dependencies first, `append`),
//! `next`, `next.to`, `.catch`, frozen events. A hook is a *frame* sent to its mod's worker as an
//! `invoke`; the worker answers with `settled`, and `next` calls arrive as `next` frames, which this
//! module runs against the remaining hooks (in other workers) and answers with `next_done`. The
//! budget of a hook is enforced by its worker, where the JavaScript runs, and a hook that overruns
//! settles as `timeout` here.
//!
//! A worker that dies fails only its own frames: the hook is skipped, as if it had thrown, and the
//! chain goes on without that mod's hooks until a new worker takes its place.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::Duration;

use serde_json::{Value as Json, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;

use crate::error::Result;
use crate::host::{HostError, HostRequest};
use crate::tree::validate;
use crate::types::{Answer, Budgets, Diagnostic, Render, RuntimeConfig, Tier, millis};

/// A boxed future, as the chain's traits spell it.
pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// The longest frame read from a worker. A worker is semi-trusted: a memory-safety bug in the engine
/// would make it hostile, so what it sends is bounded.
pub const MAX_WORKER_FRAME: usize = 16 * 1024 * 1024;

/// Where a worker's `$` calls and diagnostics go.
pub trait HostSink: Send + Sync + 'static {
    /// Starts one `$` call. The outer future resolves once the request is queued (so a mod's call
    /// reaches the host before the reply to the operation that made it); the inner one is the answer.
    fn begin(&self, request: HostRequest) -> BoxFut<BoxFut<std::result::Result<Json, HostError>>>;
    /// A hook was skipped, a tree refused, a worker misbehaved.
    fn diagnostic(&self, diagnostic: Diagnostic);
}

/// A failure of a request to a worker: the worker's own error, or its absence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerError {
    /// A stable code (`hx.mods.load_failed`, `hx.mods.worker_failed`, ...).
    pub code: String,
    /// What happened.
    pub message: String,
    /// What the worker attached (a load failure carries the typed error), or `null`.
    pub detail: Json,
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WorkerError {}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One hook a mod registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hook {
    /// The hook's id, `<mod>.k<n>`.
    pub id: String,
    /// The event.
    pub event: String,
    /// It has a `.catch` handler.
    pub has_catch: bool,
}

/// What a worker says about a frame in flight.
#[derive(Debug)]
enum FrameMsg {
    Next {
        call: String,
        e: String,
        tier: Option<String>,
    },
    Settled {
        status: String,
        value: Option<String>,
        tok: Option<String>,
        error: String,
    },
}

type Waiting = oneshot::Sender<std::result::Result<Json, WorkerError>>;

/// The parent's end of one mod's worker.
pub struct ModWorker {
    /// The mod's name. The worker is bound to it: every `$` call it makes is stamped with it here.
    pub name: String,
    /// The mod's slot in the chain.
    pub idx: usize,
    /// How many workers this mod has had; handler ids carry it, so a stale id never hits a new
    /// worker's handler.
    pub generation: u32,
    tx: mpsc::UnboundedSender<String>,
    alive: AtomicBool,
    next_id: AtomicU64,
    waiting: Mutex<HashMap<u64, Waiting>>,
    frames: Mutex<HashMap<String, mpsc::UnboundedSender<FrameMsg>>>,
    hooks: Mutex<Vec<Hook>>,
    sink: Arc<dyn HostSink>,
    kill: Box<dyn Fn() + Send + Sync>,
}

impl std::fmt::Debug for ModWorker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModWorker")
            .field("name", &self.name)
            .field("idx", &self.idx)
            .field("generation", &self.generation)
            .field("alive", &self.alive.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

async fn read_line<R: AsyncRead + Unpin>(reader: &mut BufReader<R>, max: usize) -> Option<String> {
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

/// What to do when a worker's tick arrives: the chain runs `clock.tick`.
type OnTick = Box<dyn Fn(String) + Send + Sync>;

impl ModWorker {
    /// Attaches to a worker's channel. Must be called inside a Tokio runtime: it starts the tasks
    /// that read and write the channel. `kill` stops the worker's process (or thread).
    pub fn attach<R, W>(
        reader: R,
        writer: W,
        info: (&str, usize, u32),
        sink: Arc<dyn HostSink>,
        kill: Box<dyn Fn() + Send + Sync>,
        on_tick: OnTick,
    ) -> Arc<Self>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let (tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let worker = Arc::new(Self {
            name: info.0.to_owned(),
            idx: info.1,
            generation: info.2,
            tx,
            alive: AtomicBool::new(true),
            next_id: AtomicU64::new(0),
            waiting: Mutex::default(),
            frames: Mutex::default(),
            hooks: Mutex::default(),
            sink,
            kill,
        });
        let w = worker.clone();
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(line) = out_rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() || writer.flush().await.is_err()
                {
                    break;
                }
            }
            w.closed();
        });
        let w = worker.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            while let Some(line) = read_line(&mut reader, MAX_WORKER_FRAME).await {
                if let Ok(frame) = serde_json::from_str::<Json>(line.trim_end()) {
                    w.on_frame(&frame, &on_tick).await;
                }
            }
            w.closed();
        });
        worker
    }

    /// Whether the worker's channel is open.
    #[must_use]
    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// The hooks the mod has registered.
    #[must_use]
    pub fn hooks(&self) -> Vec<Hook> {
        lock(&self.hooks).clone()
    }

    /// Stops the worker.
    pub fn kill(&self) {
        (self.kill)();
    }

    fn closed(&self) {
        self.alive.store(false, Ordering::SeqCst);
        lock(&self.frames).clear();
        let doomed: Vec<_> = lock(&self.waiting).drain().collect();
        for (_, w) in doomed {
            let _ = w.send(Err(WorkerError {
                code: "hx.mods.worker_failed".into(),
                message: "the worker stopped".into(),
                detail: Json::Null,
            }));
        }
    }

    fn write(&self, frame: &Json) -> bool {
        let mut line = frame.to_string();
        line.push('\n');
        self.tx.send(line).is_ok()
    }

    async fn on_frame(self: &Arc<Self>, frame: &Json, on_tick: &OnTick) {
        if let Some(id) = frame.get("re").and_then(Json::as_u64) {
            let waiter = lock(&self.waiting).remove(&id);
            if let Some(w) = waiter {
                let _ = w.send(match frame.get("err") {
                    Some(e) => Err(WorkerError {
                        code: e["code"].as_str().unwrap_or("hx.internal_error").to_owned(),
                        message: e["message"].as_str().unwrap_or_default().to_owned(),
                        detail: e.get("error").cloned().unwrap_or(Json::Null),
                    }),
                    None => Ok(frame.get("ok").cloned().unwrap_or(Json::Null)),
                });
            }
        } else if let Some(cid) = frame.get("call").and_then(Json::as_u64) {
            let request = HostRequest {
                plugin: self.name.clone(),
                call: frame["name"].as_str().unwrap_or_default().to_owned(),
                args: frame.get("args").cloned().unwrap_or(Json::Null),
            };
            // Queue the request before reading the next frame, so the host sees a mod's call before
            // the reply to the operation that made it.
            let answer = self.sink.begin(request).await;
            let w = self.clone();
            tokio::spawn(async move {
                let reply = match answer.await {
                    Ok(v) => json!({ "ret": cid, "ok": v }),
                    Err(e) => {
                        json!({ "ret": cid, "err": { "code": e.code, "message": e.message } })
                    }
                };
                w.write(&reply);
            });
        } else if let Some(d) = frame.get("diag") {
            self.sink.diagnostic(Diagnostic {
                level: d["level"].as_str().unwrap_or("warn").to_owned(),
                plugin: self.name.clone(),
                message: d["message"].as_str().unwrap_or_default().to_owned(),
            });
        } else if let Some(ev) = frame.get("ev").and_then(Json::as_str) {
            self.on_event(ev, frame, on_tick);
        }
    }

    fn on_event(&self, ev: &str, frame: &Json, on_tick: &OnTick) {
        match ev {
            "reg" => lock(&self.hooks).push(Hook {
                id: frame["hook"].as_str().unwrap_or_default().to_owned(),
                event: frame["event"].as_str().unwrap_or_default().to_owned(),
                has_catch: false,
            }),
            "catch" => {
                let id = frame["hook"].as_str().unwrap_or_default();
                if let Some(h) = lock(&self.hooks).iter_mut().find(|h| h.id == id) {
                    h.has_catch = true;
                }
            }
            "tick" => on_tick(frame["id"].as_str().unwrap_or_default().to_owned()),
            "settled" | "next" => {
                let fid = frame["frame"].as_str().unwrap_or_default();
                let text = |k: &str| frame[k].as_str().map(str::to_owned);
                let msg = if ev == "next" {
                    FrameMsg::Next {
                        call: text("call").unwrap_or_default(),
                        e: text("e").unwrap_or_default(),
                        tier: text("tier"),
                    }
                } else {
                    FrameMsg::Settled {
                        status: text("status").unwrap_or_default(),
                        value: text("value"),
                        tok: text("tok"),
                        error: text("error").unwrap_or_default(),
                    }
                };
                let settled = matches!(msg, FrameMsg::Settled { .. });
                let mut frames = lock(&self.frames);
                if let Some(tx) = frames.get(fid) {
                    let _ = tx.send(msg);
                }
                if settled {
                    frames.remove(fid);
                }
            }
            _ => {}
        }
    }

    /// Sends an operation and waits for its reply.
    ///
    /// # Errors
    /// The worker's own error, or `hx.mods.worker_failed` when it is gone or silent past `timeout`.
    pub async fn request(
        &self,
        mut frame: Json,
        timeout: Duration,
    ) -> std::result::Result<Json, WorkerError> {
        let failed = |message: &str| WorkerError {
            code: "hx.mods.worker_failed".into(),
            message: message.into(),
            detail: Json::Null,
        };
        if !self.alive() {
            return Err(failed("the worker is not running"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        frame["id"] = json!(id);
        let (done, answer) = oneshot::channel();
        lock(&self.waiting).insert(id, done);
        if !self.write(&frame) {
            lock(&self.waiting).remove(&id);
            return Err(failed("the worker's channel is closed"));
        }
        match tokio::time::timeout(timeout, answer).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(failed("the worker stopped answering")),
            Err(_) => {
                lock(&self.waiting).remove(&id);
                self.kill();
                Err(failed("the worker did not answer in time and was stopped"))
            }
        }
    }

    /// Starts a hook in the worker. The receiver gets what the worker says about it.
    fn invoke(&self, frame: &str, m: Json) -> Option<mpsc::UnboundedReceiver<FrameMsg>> {
        if !self.alive() {
            return None;
        }
        let (tx, rx) = mpsc::unbounded_channel();
        lock(&self.frames).insert(frame.to_owned(), tx);
        if !self.write(&json!({ "op": "invoke", "m": m })) {
            lock(&self.frames).remove(frame);
            return None;
        }
        Some(rx)
    }

    fn release(&self, frame: &str) {
        lock(&self.frames).remove(frame);
    }

    fn next_done(&self, frame: &str, call: &str, value: Option<String>) {
        self.write(&json!({ "op": "next_done", "frame": frame, "call": call, "value": value }));
    }

    fn commit(&self, site: &str, ok: bool, tokens: &[String]) {
        self.write(&json!({ "op": "commit", "site": site, "ok": ok, "tokens": tokens }));
    }
}

/// One mod's place in the chain. A slot outlives its workers: a restarted mod keeps its place.
#[derive(Debug, Clone)]
pub struct Slot {
    /// The slot's index; handler ids start with it.
    pub idx: usize,
    /// The mod.
    pub name: String,
    /// Its tier.
    pub tier: Tier,
    /// The budgets its hooks run under.
    pub budgets: Budgets,
    /// The running worker, when there is one.
    pub worker: Option<Arc<ModWorker>>,
}

/// What a draw produced, and which mod drew it.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderOutcome {
    /// The drawing.
    pub render: Render,
    /// The mod whose hook drew it (the first hook to answer), when one did.
    pub plugin: Option<String>,
}

#[derive(Clone)]
struct Entry {
    idx: usize,
    name: String,
    worker: Arc<ModWorker>,
    hook: String,
    has_catch: bool,
    tier: Tier,
    budgets: Budgets,
    kind: &'static str,
}

enum Bottom {
    Nothing,
    /// `ui.render`: no mod drew it, so the app's own drawing stays.
    Render,
    /// A handler of the mod that drew the tree (or set the timer). `value` reads the event's value.
    Callback {
        handler: String,
        value: bool,
    },
}

struct Run {
    id: u64,
    name: String,
    entries: Vec<Entry>,
    bottom: Bottom,
    site: Option<String>,
    tokens: Mutex<Vec<(usize, String)>>,
    answered_by: Mutex<Option<usize>>,
}

type LastDown = watch::Receiver<Option<Option<String>>>;

struct HookFrame {
    run: Arc<Run>,
    i: usize,
    e: String,
    next_called: bool,
    last_down: Option<LastDown>,
}

struct CatchCtx {
    kind: &'static str,
    message: String,
    called: bool,
    last_down: Option<LastDown>,
}

enum Outcome {
    Settled(Option<String>),
    NoMatch,
    Failed { timeout: bool, error: String },
}

/// What one event produced.
struct RunResult {
    value: Option<String>,
    site: Option<String>,
    tokens: Vec<(usize, String)>,
    answered_by: Option<usize>,
}

fn tier_rank(t: Tier) -> u8 {
    match t {
        Tier::Prepend => 0,
        Tier::User => 1,
        Tier::Append => 2,
    }
}

async fn last_down_value(mut rx: LastDown) -> Option<String> {
    match rx.wait_for(Option::is_some).await {
        Ok(v) => v.clone().flatten(),
        Err(_) => None,
    }
}

/// The chain of one session: its mods' slots and the machinery that runs events through them.
pub struct Chain {
    slots: Mutex<Vec<Slot>>,
    sink: Arc<dyn HostSink>,
    config: RuntimeConfig,
    next_run: AtomicU64,
    next_frame: AtomicU64,
    me: Weak<Chain>,
}

impl Chain {
    /// An empty chain. Diagnostics and `$` calls go to `sink`.
    #[must_use]
    pub fn new(sink: Arc<dyn HostSink>, config: RuntimeConfig) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            slots: Mutex::default(),
            sink,
            config,
            next_run: AtomicU64::new(0),
            next_frame: AtomicU64::new(0),
            me: me.clone(),
        })
    }

    /// The configuration the chain runs under.
    #[must_use]
    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    /// Reserves a place for a mod. Slots run in the order they are added within a tier.
    pub fn add_slot(&self, name: &str, tier: Tier, budgets: Budgets) -> usize {
        let mut slots = lock(&self.slots);
        let idx = slots.len();
        slots.push(Slot {
            idx,
            name: name.to_owned(),
            tier,
            budgets,
            worker: None,
        });
        idx
    }

    /// Puts a worker in (or takes it out of) a slot.
    pub fn set_worker(&self, idx: usize, worker: Option<Arc<ModWorker>>) {
        if let Some(s) = lock(&self.slots).get_mut(idx) {
            s.worker = worker;
        }
    }

    /// Frees a slot's worker and forgets the mod: it no longer takes part in any event.
    pub fn retire(&self, idx: usize) {
        if let Some(s) = lock(&self.slots).get_mut(idx) {
            s.worker = None;
            s.name.clear();
        }
    }

    /// The slots, in order. Retired slots have an empty name.
    #[must_use]
    pub fn slots(&self) -> Vec<Slot> {
        lock(&self.slots).clone()
    }

    /// The slot of a mod.
    #[must_use]
    pub fn slot_named(&self, name: &str) -> Option<Slot> {
        lock(&self.slots).iter().find(|s| s.name == name).cloned()
    }

    /// A callback for [`ModWorker::attach`]: a worker's timer fired, so run `clock.tick`.
    #[must_use]
    pub fn tick_handler(&self) -> OnTick {
        let me = self.me.clone();
        Box::new(move |id: String| {
            if let Some(chain) = me.upgrade() {
                tokio::spawn(async move {
                    chain.tick(&id).await;
                });
            }
        })
    }

    fn diag(&self, plugin: &str, message: String) {
        self.sink.diagnostic(Diagnostic {
            level: "warn".into(),
            plugin: plugin.to_owned(),
            message,
        });
    }

    fn entries(&self, event: &str, only: Option<&str>) -> Vec<Entry> {
        let slots = lock(&self.slots);
        let mut out: Vec<(u8, usize, usize, Entry)> = Vec::new();
        for s in slots.iter() {
            let Some(w) = s.worker.as_ref().filter(|w| w.alive()) else {
                continue;
            };
            if only.is_some_and(|o| o != s.name) {
                continue;
            }
            for (n, h) in w.hooks().into_iter().enumerate() {
                if h.event == event {
                    out.push((
                        tier_rank(s.tier),
                        s.idx,
                        n,
                        Entry {
                            idx: s.idx,
                            name: s.name.clone(),
                            worker: w.clone(),
                            hook: h.id,
                            has_catch: h.has_catch,
                            tier: s.tier,
                            budgets: s.budgets,
                            kind: "hook",
                        },
                    ));
                }
            }
        }
        out.sort_by_key(|(rank, idx, n, _)| (*rank, *idx, *n));
        out.into_iter().map(|(_, _, _, e)| e).collect()
    }

    fn budget_for(&self, event: &str, budgets: &Budgets) -> Duration {
        if event == "prompt.edit" {
            budgets.prompt_edit
        } else {
            budgets.event
        }
    }

    // ---- running an event ---------------------------------------------------------------------

    async fn run_event(
        self: &Arc<Self>,
        name: &str,
        payload: Option<&Json>,
        only: Option<&str>,
    ) -> RunResult {
        let site = (name == "ui.render").then(|| {
            let p = payload.cloned().unwrap_or(Json::Null);
            format!(
                "{}:{}",
                p["component"].as_str().unwrap_or_default(),
                p["id"].as_str().unwrap_or_default()
            )
        });
        let bottom = match name {
            "ui.render" => Bottom::Render,
            "ui.press" => Bottom::Callback {
                handler: payload.map_or_else(String::new, |p| {
                    p["handler"].as_str().unwrap_or_default().to_owned()
                }),
                value: true,
            },
            "ui.input" | "ui.select" => Bottom::Callback {
                handler: payload.map_or_else(String::new, |p| {
                    p["handler"].as_str().unwrap_or_default().to_owned()
                }),
                value: true,
            },
            "clock.tick" => Bottom::Callback {
                handler: payload.map_or_else(String::new, |p| {
                    p["id"].as_str().unwrap_or_default().to_owned()
                }),
                value: false,
            },
            _ => Bottom::Nothing,
        };
        let run = Arc::new(Run {
            id: self.next_run.fetch_add(1, Ordering::Relaxed) + 1,
            name: name.to_owned(),
            entries: self.entries(name, only),
            bottom,
            site: site.clone(),
            tokens: Mutex::default(),
            answered_by: Mutex::default(),
        });
        let e = payload.map_or_else(|| "null".to_owned(), Json::to_string);
        let value = self.dispatch_from(&run, 0, e).await;
        let tokens = lock(&run.tokens).clone();
        let answered_by = *lock(&run.answered_by);
        RunResult {
            value,
            site,
            tokens,
            answered_by,
        }
    }

    fn dispatch_from(
        self: &Arc<Self>,
        run: &Arc<Run>,
        i: usize,
        e: String,
    ) -> BoxFut<Option<String>> {
        let (this, run) = (self.clone(), run.clone());
        Box::pin(async move {
            if i >= run.entries.len() {
                return this.bottom(&run, &e).await;
            }
            this.run_hook(&run, i, e).await
        })
    }

    async fn bottom(self: &Arc<Self>, run: &Arc<Run>, e: &str) -> Option<String> {
        match &run.bottom {
            Bottom::Nothing => None,
            Bottom::Render => {
                let event: Json = serde_json::from_str(e).unwrap_or(Json::Null);
                Some(json!({ "$default": true, "event": event }).to_string())
            }
            Bottom::Callback { handler, value } => {
                let owner = handler
                    .split('.')
                    .next()
                    .and_then(|n| n.parse::<usize>().ok())
                    .and_then(|n| lock(&self.slots).get(n).cloned());
                let Some(slot) = owner.filter(|s| s.worker.as_ref().is_some_and(|w| w.alive()))
                else {
                    self.diag("", format!("handler {handler} is gone"));
                    return None;
                };
                let Some(worker) = slot.worker.clone() else {
                    return None;
                };
                let arg = if *value {
                    serde_json::from_str::<Json>(e)
                        .ok()
                        .and_then(|v| v.get("value").cloned())
                } else {
                    None
                };
                let mut body = json!({ "handler": handler });
                if let Some(v) = arg {
                    body["value"] = v;
                }
                let entry = Entry {
                    idx: slot.idx,
                    name: slot.name.clone(),
                    worker,
                    hook: handler.clone(),
                    has_catch: false,
                    tier: slot.tier,
                    budgets: slot.budgets,
                    kind: "callback",
                };
                let mini = Arc::new(Run {
                    id: self.next_run.fetch_add(1, Ordering::Relaxed) + 1,
                    name: "callback".into(),
                    entries: vec![entry],
                    bottom: Bottom::Nothing,
                    site: None,
                    tokens: Mutex::default(),
                    answered_by: Mutex::default(),
                });
                self.dispatch_from(&mini, 0, body.to_string()).await
            }
        }
    }

    async fn run_hook(self: &Arc<Self>, run: &Arc<Run>, i: usize, e: String) -> Option<String> {
        let mut hf = HookFrame {
            run: run.clone(),
            i,
            e: e.clone(),
            next_called: false,
            last_down: None,
        };
        let entry = run.entries[i].clone();
        match self.exec(&mut hf, None).await {
            Outcome::Settled(v) => v,
            Outcome::NoMatch => self.dispatch_from(run, i + 1, e).await,
            Outcome::Failed { timeout, error } => {
                let what = if timeout { "timed out" } else { "threw" };
                self.diag(&entry.name, format!("{}: hook {what}: {error}", run.name));
                if entry.has_catch {
                    let ctx = CatchCtx {
                        kind: if timeout { "timeout" } else { "throw" },
                        message: error,
                        called: hf.next_called,
                        last_down: hf.last_down.clone(),
                    };
                    match self.exec(&mut hf, Some(ctx)).await {
                        Outcome::Settled(v) => return v,
                        Outcome::NoMatch => {}
                        Outcome::Failed { timeout, error } => {
                            let what = if timeout { "timed out" } else { "threw" };
                            self.diag(
                                &entry.name,
                                format!("{}: .catch handler {what}: {error}", run.name),
                            );
                        }
                    }
                }
                self.skip(&hf).await
            }
        }
    }

    /// The hook failed: its downstream answer stands if it had called `next`, else the chain goes on
    /// past it.
    async fn skip(self: &Arc<Self>, hf: &HookFrame) -> Option<String> {
        if hf.next_called {
            return match hf.last_down.clone() {
                Some(rx) => last_down_value(rx).await,
                None => None,
            };
        }
        self.dispatch_from(&hf.run, hf.i + 1, hf.e.clone()).await
    }

    /// Runs one hook (or its `.catch` handler) in its worker and waits for it to settle, running
    /// the `next` calls it makes.
    async fn exec(self: &Arc<Self>, hf: &mut HookFrame, catch: Option<CatchCtx>) -> Outcome {
        let run = hf.run.clone();
        let entry = run.entries[hf.i].clone();
        let fid = format!("f{}", self.next_frame.fetch_add(1, Ordering::Relaxed) + 1);
        let budget = if catch.is_some() {
            entry.budgets.catch
        } else {
            self.budget_for(&run.name, &entry.budgets)
        };
        let kind = if catch.is_some() { "catch" } else { entry.kind };
        let mut m = json!({
            "k": "invoke", "frame": fid, "hook": entry.hook, "kind": kind, "e": hf.e,
            "budget": millis(budget), "event": run.name, "tier": entry.tier.name(),
            "site": run.site, "run": run.id,
        });
        if let Some(c) = &catch {
            m["failure"] = json!({ "kind": c.kind, "message": c.message, "called": c.called });
        }
        let Some(mut rx) = entry.worker.invoke(&fid, m) else {
            return Outcome::Failed {
                timeout: false,
                error: "the mod's worker is not running".into(),
            };
        };
        let limit = Instant::now() + self.config.frame_limit;
        loop {
            let msg = match tokio::time::timeout_at(limit, rx.recv()).await {
                Ok(m) => m,
                Err(_) => {
                    entry.worker.release(&fid);
                    entry.worker.kill();
                    return Outcome::Failed {
                        timeout: true,
                        error: "the hook did not finish in time and its worker was stopped".into(),
                    };
                }
            };
            match msg {
                None => {
                    return Outcome::Failed {
                        timeout: false,
                        error: "the mod's worker stopped".into(),
                    };
                }
                Some(FrameMsg::Next { call, e, tier }) => {
                    self.on_next(hf, &entry, catch.as_ref(), &fid, call, e, tier);
                }
                Some(FrameMsg::Settled {
                    status,
                    value,
                    tok,
                    error,
                }) => {
                    entry.worker.release(&fid);
                    return match status.as_str() {
                        "nomatch" => Outcome::NoMatch,
                        "threw" => Outcome::Failed {
                            timeout: false,
                            error,
                        },
                        "timeout" => Outcome::Failed {
                            timeout: true,
                            error,
                        },
                        _ => {
                            if let Some(t) = tok {
                                lock(&run.tokens).push((entry.idx, t));
                            }
                            if value.is_some() {
                                lock(&run.answered_by).get_or_insert(entry.idx);
                            }
                            Outcome::Settled(value)
                        }
                    };
                }
            }
        }
    }

    /// `next(e)` from a hook: run everything below this frame and hand its answer back.
    #[allow(clippy::too_many_arguments)] // one frame message, spelled out
    fn on_next(
        self: &Arc<Self>,
        hf: &mut HookFrame,
        entry: &Entry,
        catch: Option<&CatchCtx>,
        fid: &str,
        call: String,
        e: String,
        tier: Option<String>,
    ) {
        let worker = entry.worker.clone();
        let fid = fid.to_owned();
        // A catch handler calling `next` after the hook already did gets the same downstream answer.
        if let Some(c) = catch
            && c.called
        {
            let last = c.last_down.clone();
            tokio::spawn(async move {
                let v = match last {
                    Some(rx) => last_down_value(rx).await,
                    None => None,
                };
                worker.next_done(&fid, &call, v);
            });
            return;
        }
        let mut from = hf.i + 1;
        if let Some(t) = tier.as_deref().and_then(Tier::parse) {
            while from < hf.run.entries.len() && tier_rank(hf.run.entries[from].tier) < tier_rank(t)
            {
                from += 1;
            }
        }
        hf.next_called = true;
        let (tx, rx) = watch::channel(None);
        hf.last_down = Some(rx);
        let (this, run) = (self.clone(), hf.run.clone());
        tokio::spawn(async move {
            let v = this.dispatch_from(&run, from, e).await;
            let _ = tx.send(Some(v.clone()));
            worker.next_done(&fid, &call, v);
        });
    }

    // ---- the API ------------------------------------------------------------------------------

    /// Sends one event through the chain. `only` restricts it to one mod's hooks.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub async fn dispatch(
        self: &Arc<Self>,
        event: &str,
        payload: &Json,
        only: Option<&str>,
    ) -> Result<Answer> {
        let r = self.run_event(event, Some(payload), only).await;
        let value = match r.value.as_deref() {
            Some(text) => serde_json::from_str(text)?,
            None => Json::Null,
        };
        Ok(Answer {
            answered: r.value.is_some(),
            value,
            answered_by: self.name_of(r.answered_by),
        })
    }

    fn name_of(&self, idx: Option<usize>) -> Option<String> {
        idx.and_then(|i| lock(&self.slots).get(i).map(|s| s.name.clone()))
            .filter(|n| !n.is_empty())
    }

    /// Asks the chain to draw `component` (with `id` for a pane) and validates the tree.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub async fn render(
        self: &Arc<Self>,
        component: &str,
        id: Option<&str>,
        props: &Json,
    ) -> Result<RenderOutcome> {
        let mut payload = json!({ "component": component, "props": props, "surface": "desktop" });
        if let Some(id) = id {
            // A site with no id has no `id` field, so a hook sees `undefined`, not `null`.
            payload["id"] = json!(id);
        }
        let r = self.run_event("ui.render", Some(&payload), None).await;
        let site = r.site.clone().unwrap_or_default();
        let drawer = self.name_of(r.answered_by);
        let value: Json = match r.value.as_deref() {
            Some(text) => serde_json::from_str(text)?,
            None => Json::Null,
        };
        let outcome = |render: Render, plugin: Option<String>| RenderOutcome { render, plugin };
        if value.is_null() {
            return Ok(outcome(Render::Default { props: None }, None));
        }
        if value["$default"] == Json::Bool(true) {
            return Ok(outcome(
                Render::Default {
                    props: value["event"]
                        .get("props")
                        .filter(|p| !p.is_null())
                        .cloned(),
                },
                None,
            ));
        }
        if let Some(reason) = value.get("$invalid").and_then(Json::as_str) {
            self.commit(&site, &r.tokens, false);
            return Ok(outcome(
                self.skipped(component, id, reason.to_owned()),
                drawer,
            ));
        }
        let Some(tree) = value.get("$el") else {
            self.commit(&site, &r.tokens, false);
            return Ok(outcome(
                self.skipped(
                    component,
                    id,
                    "a ui.render hook must return an element tree or call next".to_owned(),
                ),
                drawer,
            ));
        };
        match validate(tree, &self.config.tree) {
            Ok(stats) => {
                self.commit(&site, &r.tokens, true);
                Ok(outcome(
                    Render::Tree {
                        tree: tree.clone(),
                        stats,
                    },
                    drawer,
                ))
            }
            Err(e) => {
                self.commit(&site, &r.tokens, false);
                Ok(outcome(self.skipped(component, id, e.to_string()), drawer))
            }
        }
    }

    fn skipped(&self, component: &str, id: Option<&str>, reason: String) -> Render {
        let site = id.map_or_else(|| component.to_owned(), |i| format!("{component} {i}"));
        self.diag("", format!("ui.render {site}: tree skipped: {reason}"));
        Render::Skipped { reason }
    }

    /// Tells every mod whether the tree it staged handlers for was accepted. A mod drops the old
    /// handlers of the site on any commit, so a replaced tree's buttons stop working.
    fn commit(&self, site: &str, tokens: &[(usize, String)], ok: bool) {
        let workers: Vec<(usize, Arc<ModWorker>)> = lock(&self.slots)
            .iter()
            .filter_map(|s| {
                s.worker
                    .as_ref()
                    .filter(|w| w.alive())
                    .map(|w| (s.idx, w.clone()))
            })
            .collect();
        for (idx, w) in workers {
            let mine: Vec<String> = tokens
                .iter()
                .filter(|(i, _)| *i == idx)
                .map(|(_, t)| t.clone())
                .collect();
            w.commit(site, ok, &mine);
        }
    }

    /// Delivers `ui.press`, `ui.input` or `ui.select` for a handler id from a drawn tree. True when
    /// a handler ran.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub async fn callback(
        self: &Arc<Self>,
        event: &str,
        handler: &str,
        value: Option<&str>,
    ) -> Result<bool> {
        let mut payload = json!({ "handler": handler });
        if let Some(v) = value {
            payload["value"] = json!(v);
        }
        Ok(self
            .dispatch(event, &payload, None)
            .await?
            .value
            .get("handled")
            == Some(&Json::Bool(true)))
    }

    /// Fires a `$.clock.every` timer: `clock.tick` through the chain, ending in the owner's callback.
    pub async fn tick(self: &Arc<Self>, timer: &str) {
        let _ = self
            .dispatch("clock.tick", &json!({ "id": timer }), None)
            .await;
    }

    /// Asks every worker for its memory use and adds it up.
    pub async fn memory(&self) -> crate::types::Memory {
        let workers: Vec<Arc<ModWorker>> = lock(&self.slots)
            .iter()
            .filter_map(|s| s.worker.clone())
            .collect();
        let mut total = crate::types::Memory {
            used: 0,
            allocated: 0,
        };
        for w in workers {
            if let Ok(v) = w
                .request(json!({ "op": "memory" }), Duration::from_secs(30))
                .await
            {
                total.used += v["used"].as_i64().unwrap_or(0);
                total.allocated += v["allocated"].as_i64().unwrap_or(0);
            }
        }
        total
    }
}
