//! The engine: one `QuickJS` runtime, one mod, and the loop that drives it with budgets. It is the
//! worker's half of the runtime; the event chain, which crosses mods, is `chain.rs` and runs in the
//! parent.
//!
//! A worker holds exactly one mod, so everything the heap limit, the interrupt budget and a crash
//! can touch is that mod's. The engine is single-threaded and not `Send`: the worker's loop owns it
//! and feeds it frames.
//!
//! **Budgets.** A hook is a *frame*. The engine does not know which frame the JavaScript is
//! running, so it charges time by cause: a slice of work is started for one frame (its invocation,
//! the answer to its `next`, the answer to a `$` call it made) and the time the slice takes is that
//! frame's. A frame waiting for `next` or for the host is not charged, so its budget does not run,
//! and a frame that overruns is interrupted by the engine and reported to the parent as timed
//! out. Frames of one mod run concurrently: a mod waiting on `$.ui.ask` in one hook can still run
//! another.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Function, Module, Object, Persistent, Runtime, Value};
use serde_json::{Value as Json, json};

use crate::error::{Error, Result};
use crate::files::{Bundle, Files};
use crate::host::{CallId, HostError, HostRequest};
use crate::manifest::{self, Manifest};
use crate::modules::{ModLoader, ModResolver, Shared, SharedRef};
use crate::natives::{self, NativeState, SendCall};
use crate::types::{Diagnostic, LoadedPlugin, Memory, RuntimeConfig, Tier, millis};

const WEBAPI_JS: &str = include_str!("js/webapi.js");
const AGENT_JS: &str = include_str!("js/agent.js");

/// Sends one frame to the parent. False when the channel is closed.
pub type Out = Rc<dyn Fn(&Json) -> bool>;

enum JobsEnd {
    Idle,
    Interrupted,
    TooLong,
}

/// What the engine knows about a frame in flight.
struct FrameState {
    budget: Duration,
    /// Time charged so far.
    used: Duration,
    /// `next` calls the parent has not answered.
    awaiting_next: u32,
    /// The frame is the engine's own (`register`), not the parent's.
    local: bool,
}

struct ModCtx {
    ctx: Context,
    agent: Persistent<Object<'static>>,
}

struct LoadState {
    reply: u64,
    manifest: Manifest,
    tier: Tier,
    remaining: VecDeque<String>,
    loaded: Vec<String>,
    hooks: usize,
    current: Option<(String, String)>,
    /// How the register frame in flight ended, waiting for the loop to act on it.
    ready: Option<std::result::Result<(), String>>,
}

/// One mod in one runtime.
pub struct Engine {
    modctx: Option<ModCtx>,
    shared: SharedRef,
    state: NativeState,
    config: RuntimeConfig,
    out: Out,
    frames: HashMap<String, FrameState>,
    loading: Option<LoadState>,
    loaded: Option<LoadedPlugin>,
    local_seq: u64,
    stop: Option<String>,
    name: String,
    /// Last, so it drops after the mod's context and the handles into it.
    rt: Runtime,
}

fn exception_text(ctx: &Ctx<'_>, e: &rquickjs::Error) -> String {
    if !matches!(e, rquickjs::Error::Exception) {
        return e.to_string();
    }
    let v = ctx.catch();
    value_text(&v)
}

fn value_text(v: &Value<'_>) -> String {
    if let Some(e) = v.as_exception() {
        return e.message().unwrap_or_else(|| "exception".to_owned());
    }
    v.as_string()
        .and_then(|s| s.to_string().ok())
        .unwrap_or_else(|| "unknown exception".to_owned())
}

fn script(e: rquickjs::Error) -> Error {
    Error::Script(e.to_string())
}

fn err_json(code: &str, message: impl Into<String>) -> Json {
    json!({ "code": code, "message": message.into() })
}

/// The error code a runtime failure travels under.
#[must_use]
pub fn error_code(e: &Error) -> &'static str {
    match e {
        Error::Crashed(_) => "hx.mods.crashed",
        Error::AlreadyLoaded(_) => "hx.mods.already_loaded",
        Error::NotAMod(_) => "hx.mods.not_a_mod",
        _ => "hx.mods.load_failed",
    }
}

/// The answer to a `$` call: `ok` or `err` in a frame from the parent.
#[must_use]
pub fn ret_result(frame: &Json) -> std::result::Result<Json, HostError> {
    match frame.get("err") {
        Some(e) => Err(HostError {
            code: e["code"]
                .as_str()
                .unwrap_or("hx.mods.host_failed")
                .to_owned(),
            message: e["message"].as_str().unwrap_or_default().to_owned(),
        }),
        None => Ok(frame.get("ok").cloned().unwrap_or(Json::Null)),
    }
}

impl Engine {
    /// Starts a runtime with no mod. `out` sends frames to the parent.
    ///
    /// # Errors
    /// [`Error::Script`] if the engine cannot start.
    pub fn new(out: Out, config: RuntimeConfig) -> Result<Self> {
        let rt = Runtime::new().map_err(script)?;
        rt.set_memory_limit(config.memory_limit);
        rt.set_max_stack_size(config.stack_limit);
        let deadline: Rc<Cell<Option<Instant>>> = Rc::default();
        let interrupt = deadline.clone();
        rt.set_interrupt_handler(Some(Box::new(move || {
            interrupt.get().is_some_and(|d| Instant::now() >= d)
        })));
        let shared: SharedRef = Rc::new(RefCell::new(Shared::default()));
        rt.set_loader(ModResolver(shared.clone()), ModLoader(shared.clone()));
        let sender = out.clone();
        let send_call: SendCall = Rc::new(move |id: CallId, request: &HostRequest| {
            sender(&json!({ "call": id, "name": request.call, "args": request.args }))
        });
        let state = NativeState {
            send_call,
            deadline,
            diagnostics: Rc::default(),
            queue: Rc::default(),
            pending: Rc::default(),
            timers: Rc::default(),
            next_call: Rc::default(),
            host_timeout: config.host_timeout,
            min_timer: config.min_timer,
        };
        Ok(Self {
            modctx: None,
            shared,
            state,
            config,
            out,
            frames: HashMap::new(),
            loading: None,
            loaded: None,
            local_seq: 0,
            stop: None,
            name: String::new(),
            rt,
        })
    }

    /// Why the worker should end now, when it should: a load failed, or the engine cannot go on.
    #[must_use]
    pub fn stopped(&self) -> Option<&str> {
        self.stop.as_deref()
    }

    /// Sends the diagnostics recorded so far to the parent. Called before a frame's outcome is sent,
    /// so what a hook said about itself arrives before the answer.
    fn flush_diagnostics(&self) {
        let list: Vec<Diagnostic> = std::mem::take(&mut *self.state.diagnostics.borrow_mut());
        for d in list {
            (self.out)(
                &json!({ "diag": { "level": d.level, "plugin": d.plugin, "message": d.message } }),
            );
        }
    }

    /// How long the loop may sleep: until the next timer or the oldest `$` call's deadline.
    #[must_use]
    pub fn next_wakeup(&self) -> Duration {
        let now = Instant::now();
        let timer = self.state.timers.borrow().iter().map(|t| t.due).min();
        let call = self
            .state
            .pending
            .borrow()
            .values()
            .map(|p| p.deadline)
            .min();
        [timer, call]
            .into_iter()
            .flatten()
            .min()
            .map_or(Duration::from_hours(1), |d| {
                d.saturating_duration_since(now)
            })
    }

    fn reply(&self, id: u64, outcome: std::result::Result<Json, Json>) {
        let frame = match outcome {
            Ok(v) => json!({ "re": id, "ok": v }),
            Err(e) => json!({ "re": id, "err": e }),
        };
        (self.out)(&frame);
    }

    // ---- frames from the parent ---------------------------------------------------------------

    /// Handles one frame from the parent: an operation, or the answer to a `$` call.
    pub fn handle(&mut self, frame: &Json) {
        if let Some(cid) = frame.get("ret").and_then(Json::as_u64) {
            self.complete_call(cid, ret_result(frame));
        } else {
            let id = frame.get("id").and_then(Json::as_u64);
            match frame.get("op").and_then(Json::as_str).unwrap_or_default() {
                "load" => {
                    if let Some(id) = id {
                        self.op_load(id, frame);
                    }
                }
                "invoke" => self.op_invoke(frame),
                "next_done" => self.op_next_done(frame),
                "abort" => self.agent_receive(
                    &json!({ "k": "abort", "frame": frame["frame"], "message": frame["message"] })
                        .to_string(),
                ),
                "commit" => {
                    self.agent_receive(
                        &json!({ "k": "commit", "site": frame["site"], "ok": frame["ok"], "tokens": frame["tokens"] })
                            .to_string(),
                    );
                }
                "memory" => {
                    if let Some(id) = id {
                        self.rt.run_gc();
                        let m = self.memory();
                        self.reply(id, Ok(json!({ "used": m.used, "allocated": m.allocated })));
                    }
                }
                "plugins" => {
                    if let Some(id) = id {
                        let list: Vec<Json> = self.loaded.iter().map(loaded_json).collect();
                        self.reply(id, Ok(json!({ "plugins": list })));
                    }
                }
                other => {
                    if let Some(id) = id {
                        self.reply(
                            id,
                            Err(err_json(
                                "hx.invalid_params",
                                format!("unknown op `{other}`"),
                            )),
                        );
                    }
                }
            }
        }
        self.continue_load();
        self.flush_diagnostics();
    }

    /// Runs what is due: timers fire (the parent runs `clock.tick` through the chain), and a `$`
    /// call the parent never answered is failed.
    pub fn on_wakeup(&mut self) {
        let now = Instant::now();
        let due: Vec<String> = {
            let mut timers = self.state.timers.borrow_mut();
            timers
                .iter_mut()
                .filter(|t| t.due <= now)
                .map(|t| {
                    t.due = now + t.every;
                    t.id.clone()
                })
                .collect()
        };
        for id in due {
            (self.out)(&json!({ "ev": "tick", "id": id }));
        }
        let overdue: Vec<CallId> = self
            .state
            .pending
            .borrow()
            .iter()
            .filter(|(_, p)| p.deadline <= now)
            .map(|(id, _)| *id)
            .collect();
        for id in overdue {
            self.complete_call(
                id,
                Err(HostError {
                    code: "hx.mods.host_timeout".into(),
                    message: "the host did not answer this call in time".into(),
                }),
            );
        }
        self.continue_load();
        self.flush_diagnostics();
    }

    /// The engine's memory use.
    #[must_use]
    pub fn memory(&self) -> Memory {
        let m = self.rt.memory_usage();
        Memory {
            used: m.memory_used_size,
            allocated: m.malloc_size,
        }
    }

    fn op_invoke(&mut self, frame: &Json) {
        let m = &frame["m"];
        let Some(fid) = m["frame"].as_str() else {
            return;
        };
        let budget = Duration::from_secs_f64(m["budget"].as_f64().unwrap_or(0.0).max(0.0) / 1000.0);
        self.frames.insert(
            fid.to_owned(),
            FrameState {
                budget,
                used: Duration::ZERO,
                awaiting_next: 0,
                local: false,
            },
        );
        self.agent_receive(&m.to_string());
        self.slice(Some(fid));
    }

    fn op_next_done(&mut self, frame: &Json) {
        let Some(fid) = frame["frame"].as_str() else {
            return;
        };
        if let Some(f) = self.frames.get_mut(fid) {
            f.awaiting_next = f.awaiting_next.saturating_sub(1);
        }
        self.agent_receive(
            &json!({ "k": "nextDone", "frame": fid, "call": frame["call"], "value": frame["value"] })
                .to_string(),
        );
        self.slice(Some(fid));
    }

    // ---- loading ------------------------------------------------------------------------------

    fn op_load(&mut self, id: u64, frame: &Json) {
        if self.modctx.is_some() || self.loading.is_some() {
            self.reply(
                id,
                Err(err_json(
                    "hx.mods.already_loaded",
                    "this worker already holds a mod",
                )),
            );
            return;
        }
        let started = (|| -> Result<LoadState> {
            let bundle: Bundle = serde_json::from_value(frame["bundle"].clone())?;
            let tier = Tier::parse(frame["tier"].as_str().unwrap_or("user"))
                .ok_or_else(|| Error::Script("tier must be prepend, user or append".into()))?;
            let files = Files::Memory(bundle);
            let manifest = manifest::read(&files)?;
            self.shared.borrow_mut().roots = vec![Some(files)];
            let idx = frame["idx"].as_u64().unwrap_or(0);
            let generation = frame["gen"].as_u64().unwrap_or(0);
            self.name.clone_from(&manifest.name);
            self.modctx = Some(self.new_mod_context(idx, generation, &manifest, tier)?);
            Ok(LoadState {
                reply: id,
                remaining: manifest.modules.iter().cloned().collect(),
                manifest,
                tier,
                loaded: Vec::new(),
                hooks: 0,
                current: None,
                ready: None,
            })
        })();
        match started {
            Ok(load) => {
                self.loading = Some(load);
                self.advance_load();
            }
            Err(e) => self.fail_load(id, &e),
        }
    }

    fn fail_load(&mut self, id: u64, e: &Error) {
        let mut why = err_json(error_code(e), e.to_string());
        // The typed error travels with it, so the parent can give the same error back.
        why["error"] = serde_json::to_value(e).unwrap_or(Json::Null);
        self.reply(id, Err(why));
        self.loading = None;
        self.stop = Some(format!("the mod failed to load: {e}"));
    }

    /// A fresh context for the mod: the web APIs, the agent, intrinsics frozen.
    fn new_mod_context(
        &self,
        idx: u64,
        generation: u64,
        manifest: &Manifest,
        tier: Tier,
    ) -> Result<ModCtx> {
        let ctx = Context::full(&self.rt).map_err(script)?;
        let info = json!({
            "idx": idx,
            "gen": generation,
            "name": manifest.name,
            "tier": tier.name(),
            "options": Json::Object(manifest.options.clone()),
        })
        .to_string();
        let state = self.state.clone();
        let name = manifest.name.clone();
        let agent = ctx
            .with(|ctx| -> rquickjs::Result<_> {
                let globals = ctx.globals();
                let web: Function = ctx.eval(WEBAPI_JS)?;
                web.call::<_, ()>((natives::web_natives(&ctx)?, globals))?;
                let make: Function = ctx.eval(AGENT_JS)?;
                let info = ctx.json_parse(info)?;
                let agent: Object =
                    make.call((natives::agent_natives(&ctx, &state, &name)?, info))?;
                Ok(Persistent::save(&ctx, agent))
            })
            .map_err(script)?;
        Ok(ModCtx { ctx, agent })
    }

    /// Imports the next module and starts its `register`, or finishes the load.
    fn advance_load(&mut self) {
        loop {
            let Some(load) = self.loading.as_mut() else {
                return;
            };
            let id = load.reply;
            let Some(rel) = load.remaining.pop_front() else {
                self.finish_load();
                return;
            };
            let outcome = self.start_module(&rel);
            match outcome {
                Ok((fid, path)) => {
                    if let Some(l) = self.loading.as_mut() {
                        l.current = Some((fid.clone(), path));
                    }
                    self.slice(Some(&fid));
                    return;
                }
                Err(e) => {
                    self.fail_load(id, &e);
                    return;
                }
            }
        }
    }

    fn start_module(&mut self, rel: &str) -> Result<(String, String)> {
        let path = self.shared.borrow().roots[0]
            .as_ref()
            .ok_or_else(|| Error::Read {
                path: rel.to_owned(),
                message: "the plugin directory is closed".into(),
            })?
            .file(rel)?
            .ok_or_else(|| Error::Read {
                path: rel.to_owned(),
                message: "no such file".into(),
            })?;
        let namespace = self.import(&format!("0:{path}"))?;
        self.give_register(&namespace, &path)?;
        self.local_seq += 1;
        let fid = format!("r{}", self.local_seq);
        let budget = self.config.budgets.event;
        self.frames.insert(
            fid.clone(),
            FrameState {
                budget,
                used: Duration::ZERO,
                awaiting_next: 0,
                local: true,
            },
        );
        let (options, tier) = {
            let load = self.loading.as_ref();
            (
                load.map_or_else(
                    || "{}".to_owned(),
                    |l| Json::Object(l.manifest.options.clone()).to_string(),
                ),
                load.map_or(Tier::User, |l| l.tier),
            )
        };
        self.agent_receive(
            &json!({
                "k": "invoke", "frame": fid, "hook": "register", "kind": "register", "e": options,
                "budget": millis(budget), "event": "plugin.register", "tier": tier.name(), "run": 0,
            })
            .to_string(),
        );
        Ok((fid, path))
    }

    /// Acts on how the register frame in flight ended.
    fn continue_load(&mut self) {
        let Some(load) = self.loading.as_mut() else {
            return;
        };
        let Some(ready) = load.ready.take() else {
            return;
        };
        let id = load.reply;
        match ready {
            Ok(()) => {
                if let Some((_, path)) = load.current.take() {
                    load.loaded.push(path);
                }
                self.advance_load();
                // A module that registers nothing asynchronous finishes inside `advance_load`'s slice.
                self.continue_load();
            }
            Err(reason) => {
                let e = Error::LoadFailed {
                    plugin: load.manifest.name.clone(),
                    reason,
                };
                self.fail_load(id, &e);
            }
        }
    }

    fn finish_load(&mut self) {
        let Some(load) = self.loading.take() else {
            return;
        };
        let loaded = LoadedPlugin {
            name: load.manifest.name,
            tier: load.tier,
            modules: load.loaded,
            hooks: load.hooks,
        };
        self.reply(load.reply, Ok(json!({ "loaded": loaded_json(&loaded) })));
        self.loaded = Some(loaded);
    }

    /// Hands the module's `register` export to the mod's agent.
    fn give_register(&self, namespace: &Persistent<Object<'static>>, path: &str) -> Result<()> {
        let m = self
            .modctx
            .as_ref()
            .ok_or_else(|| Error::Crashed("no context".into()))?;
        m.ctx.with(|ctx| {
            let ns = namespace
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let register: Value = ns
                .get("register")
                .map_err(|e| Error::Script(exception_text(&ctx, &e)))?;
            if !register.is_function() {
                return Err(Error::NoRegister(path.to_owned()));
            }
            let agent = m
                .agent
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let load: Function = agent
                .get("load")
                .map_err(|e| Error::Script(e.to_string()))?;
            load.call::<_, ()>((register,))
                .map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    /// Imports a module of the plugin, in its context, and returns its namespace.
    fn import(&mut self, name: &str) -> Result<Persistent<Object<'static>>> {
        self.shared.borrow_mut().last_error = None;
        self.state
            .deadline
            .set(Some(Instant::now() + self.config.budgets.event));
        let ctx = self
            .modctx
            .as_ref()
            .ok_or_else(|| Error::Crashed("no context".into()))?
            .ctx
            .clone();
        let started = ctx.with(|ctx| match Module::import(&ctx, name) {
            Ok(p) => Ok(Persistent::save(&ctx, p)),
            Err(e) => Err(exception_text(&ctx, &e)),
        });
        let promise = match started {
            Ok(p) => p,
            Err(text) => {
                self.state.deadline.set(None);
                return Err(self.load_error(name, text));
            }
        };
        let end = self.run_import_jobs(Instant::now() + self.config.budgets.event * 2);
        self.state.deadline.set(None);
        let outcome = ctx.with(|ctx| {
            let p = promise.restore(&ctx).map_err(|e| e.to_string())?;
            match p.state() {
                PromiseState::Resolved => {
                    let ns: Object = p
                        .result::<Object>()
                        .ok_or("no namespace")?
                        .map_err(|e| exception_text(&ctx, &e))?;
                    Ok(Persistent::save(&ctx, ns))
                }
                PromiseState::Rejected => {
                    let text = match p.result::<Value>() {
                        Some(Err(e)) => exception_text(&ctx, &e),
                        _ => "rejected".to_owned(),
                    };
                    Err(text)
                }
                PromiseState::Pending => Err("the module never finished evaluating".to_owned()),
            }
        });
        outcome.map_err(|text| {
            let text = if matches!(end, JobsEnd::Interrupted) {
                "ran past its budget while loading".to_owned()
            } else {
                text
            };
            self.load_error(name, text)
        })
    }

    fn run_import_jobs(&self, hard: Instant) -> JobsEnd {
        loop {
            match self.rt.execute_pending_job() {
                Ok(true) => {
                    if Instant::now() >= hard {
                        return JobsEnd::TooLong;
                    }
                }
                Ok(false) => return JobsEnd::Idle,
                Err(job) => {
                    job.0.with(|c| drop(c.catch()));
                    return JobsEnd::Interrupted;
                }
            }
        }
    }

    fn load_error(&self, module: &str, text: String) -> Error {
        self.shared
            .borrow_mut()
            .last_error
            .take()
            .unwrap_or_else(|| {
                if text.contains("interrupted") {
                    Error::LoadFailed {
                        plugin: module.to_owned(),
                        reason: "ran past its budget while loading".to_owned(),
                    }
                } else {
                    Error::Script(text)
                }
            })
    }

    // ---- driving ------------------------------------------------------------------------------

    /// Calls a method of the mod's agent with one string. Nothing to call is not an error: the mod
    /// may not be loaded yet.
    fn agent_receive(&self, text: &str) {
        let _ = self.call_agent("receive", text);
    }

    fn call_agent(&self, name: &str, arg: &str) -> Result<()> {
        let Some(m) = self.modctx.as_ref() else {
            return Ok(());
        };
        m.ctx.with(|ctx| {
            let agent = m
                .agent
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let f: Function = agent.get(name).map_err(|e| Error::Script(e.to_string()))?;
            f.call::<_, ()>((arg.to_owned(),))
                .map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    /// Reports a diagnostic about this mod.
    fn warn(&self, message: String) {
        self.state.diagnostics.borrow_mut().push(Diagnostic {
            level: "warn".into(),
            plugin: self.name.clone(),
            message,
        });
    }

    /// Handles the messages the agent sent up: which hooks it registered, which frames settled or
    /// want the chain's `next`.
    fn drain(&mut self) {
        loop {
            let next = self.state.queue.borrow_mut().pop_front();
            let Some(text) = next else { return };
            self.flush_diagnostics();
            let Ok(m) = serde_json::from_str::<Json>(&text) else {
                continue;
            };
            match m["k"].as_str().unwrap_or_default() {
                "reg" => {
                    if let Some(l) = self.loading.as_mut() {
                        l.hooks += 1;
                    }
                    (self.out)(&json!({ "ev": "reg", "event": m["event"], "hook": m["hook"] }));
                }
                "catch" => {
                    (self.out)(&json!({ "ev": "catch", "hook": m["hook"] }));
                }
                "settled" => self.on_settled(&m),
                "next" => {
                    if let Some(f) = m["frame"].as_str().and_then(|f| self.frames.get_mut(f)) {
                        f.awaiting_next += 1;
                    }
                    (self.out)(&json!({
                        "ev": "next", "frame": m["frame"], "call": m["call"], "e": m["e"], "tier": m["tier"],
                    }));
                }
                _ => {}
            }
        }
    }

    fn on_settled(&mut self, m: &Json) {
        let Some(fid) = m["frame"].as_str() else {
            return;
        };
        // A frame the engine already gave up on (timed out) may still settle later: ignored.
        let Some(f) = self.frames.remove(fid) else {
            return;
        };
        if f.local {
            if let Some(l) = self.loading.as_mut() {
                l.ready = Some(if m["status"] == "ok" {
                    Ok(())
                } else {
                    Err(m["error"].as_str().unwrap_or("register failed").to_owned())
                });
            }
            return;
        }
        let mut frame = m.clone();
        frame["ev"] = json!("settled");
        frame.as_object_mut().map(|o| o.remove("k"));
        (self.out)(&frame);
    }

    /// Runs the engine's jobs until they are exhausted, handling the agent's messages between
    /// them.
    fn pump(&mut self, hard: Instant) -> JobsEnd {
        loop {
            self.drain();
            match self.rt.execute_pending_job() {
                Ok(true) => {
                    if Instant::now() >= hard {
                        return JobsEnd::TooLong;
                    }
                }
                Ok(false) => {
                    if self.state.queue.borrow().is_empty() {
                        return JobsEnd::Idle;
                    }
                }
                Err(job) => {
                    // The exception must be taken to clear it. The interrupt handler raises it.
                    job.0.with(|c| drop(c.catch()));
                    return JobsEnd::Interrupted;
                }
            }
        }
    }

    fn allowance(&self, attr: Option<&str>) -> Duration {
        attr.and_then(|a| self.frames.get(a))
            .map_or(self.config.budgets.event, |f| {
                f.budget.saturating_sub(f.used)
            })
    }

    /// Runs the work a cause started (`attr` is the frame it belongs to), charging the time it
    /// takes to that frame. A frame that overruns is interrupted and reported as timed out.
    fn slice(&mut self, attr: Option<&str>) {
        let mut attr = attr.map(str::to_owned);
        for _ in 0..1000 {
            let started = Instant::now();
            let remaining = self.allowance(attr.as_deref());
            self.state.deadline.set(Some(started + remaining));
            let end = self.pump(started + remaining * 2 + Duration::from_millis(250));
            self.state.deadline.set(None);
            let spent = started.elapsed();
            if let Some(f) = attr.as_deref().and_then(|a| self.frames.get_mut(a)) {
                f.used += spent;
            }
            match end {
                JobsEnd::Idle => {
                    self.fail_stalled();
                    return;
                }
                JobsEnd::TooLong => {
                    self.stop = Some(
                        "jobs kept running past the budget with nothing to interrupt".to_owned(),
                    );
                    return;
                }
                JobsEnd::Interrupted => match attr.take() {
                    Some(a) if self.frames.contains_key(&a) => self.fail_frame(&a),
                    _ => self.warn(
                        "work with no hook to blame ran past its budget and was stopped".to_owned(),
                    ),
                },
            }
        }
        self.stop = Some("too many hooks timed out in one slice".to_owned());
    }

    /// Gives up on a frame that ran past its budget: the parent skips the hook.
    fn fail_frame(&mut self, fid: &str) {
        let Some(f) = self.frames.remove(fid) else {
            return;
        };
        let why = format!("over its budget of {} ms", f.budget.as_millis());
        if f.local {
            if let Some(l) = self.loading.as_mut() {
                l.ready = Some(Err(format!("timed out: {why}")));
            }
        } else {
            (self.out)(
                &json!({ "ev": "settled", "frame": fid, "status": "timeout", "error": why }),
            );
        }
        self.agent_receive(&json!({ "k": "abort", "frame": fid, "message": why }).to_string());
    }

    /// When nothing can make progress (no `$` call pending, no `next` outstanding), every frame
    /// still open will never settle: it is blamed, as a hook that overran.
    fn fail_stalled(&mut self) {
        if self.frames.is_empty()
            || !self.state.pending.borrow().is_empty()
            || self.frames.values().any(|f| f.awaiting_next > 0)
        {
            return;
        }
        let stalled: Vec<String> = self.frames.keys().cloned().collect();
        for fid in stalled {
            self.fail_frame(&fid);
        }
    }

    /// Delivers the parent's answer to a `$` call, and runs what it wakes up.
    fn complete_call(&mut self, id: CallId, result: std::result::Result<Json, HostError>) {
        let Some(p) = self.state.pending.borrow_mut().remove(&id) else {
            return;
        };
        natives::after_reply(&self.state, &p.request, result.is_ok());
        let reply = match result {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": { "code": e.code, "message": e.message } }),
        };
        let frame = self.agent_complete(id, &reply.to_string());
        self.slice(frame.as_deref());
    }

    fn agent_complete(&self, id: CallId, reply: &str) -> Option<String> {
        let m = self.modctx.as_ref()?;
        m.ctx
            .with(|ctx| {
                let agent = m.agent.clone().restore(&ctx).ok()?;
                let f: Function = agent.get("complete").ok()?;
                f.call::<_, String>((id, reply.to_owned())).ok()
            })
            .filter(|f| !f.is_empty())
    }
}

fn loaded_json(l: &LoadedPlugin) -> Json {
    json!({ "name": l.name, "tier": l.tier.name(), "modules": l.modules, "hooks": l.hooks })
}
