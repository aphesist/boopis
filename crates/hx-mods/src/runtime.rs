//! The isolate: one QuickJS runtime shared by all of a session's mods, the event chain running
//! inside it, and the loop that drives it with budgets.
//!
//! The isolate is single-threaded and synchronous from the outside: [`ModRuntime::dispatch`]
//! starts an event, runs the engine's job queue until the chain answers, and returns. A hook that
//! runs past its budget is interrupted by the engine and skipped by the chain; see
//! `js/kernel.js` for why the skip is driven from here.

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Function, Module, Object, Persistent, Runtime, Value};
use serde_json::{Value as Json, json};

use crate::error::{Error, Result};
use crate::files::PluginDir;
use crate::host::HostCalls;
use crate::manifest::{self, Manifest};
use crate::modules::{ModLoader, ModResolver, Shared, SharedRef};
use crate::natives::{self, NativeState};
use crate::tree::{TreeLimits, TreeStats, validate};

const WEBAPI_JS: &str = include_str!("js/webapi.js");
const KERNEL_JS: &str = include_str!("js/kernel.js");

/// Where a mod sits in the chain: `prependPlugins` run first, `appendPlugins` last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tier {
    /// Before user mods.
    Prepend,
    /// User mods, dependencies first.
    #[default]
    User,
    /// After user mods.
    Append,
}

impl Tier {
    const fn name(self) -> &'static str {
        match self {
            Self::Prepend => "prepend",
            Self::User => "user",
            Self::Append => "append",
        }
    }
}

/// How long a hook may run. A hook past its budget is interrupted and skipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budgets {
    /// Per hook, for most events.
    pub event: Duration,
    /// Per hook for `prompt.edit`, which runs on the keystroke path.
    pub prompt_edit: Duration,
    /// Per `.catch` handler.
    pub catch: Duration,
}

impl Default for Budgets {
    fn default() -> Self {
        Self { event: Duration::from_secs(10), prompt_edit: Duration::from_millis(50), catch: Duration::from_secs(1) }
    }
}

/// Everything configurable about an isolate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeConfig {
    /// Hook budgets.
    pub budgets: Budgets,
    /// Heap limit in bytes. An allocation past it throws inside the hook.
    pub memory_limit: usize,
    /// Native stack limit in bytes; deep recursion throws a `RangeError` inside the hook.
    pub stack_limit: usize,
    /// Element tree limits.
    pub tree: TreeLimits,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self { budgets: Budgets::default(), memory_limit: 64 * 1024 * 1024, stack_limit: 512 * 1024, tree: TreeLimits::default() }
    }
}

/// Something worth telling the mod author or the log: a hook threw, timed out, or drew an
/// invalid tree. Never an answer to the event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// `warn` for a skipped hook.
    pub level: String,
    /// The plugin concerned, empty when none is.
    pub plugin: String,
    /// What happened.
    pub message: String,
}

/// What loading a plugin registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedPlugin {
    /// The plugin name.
    pub name: String,
    /// The tier it was loaded into.
    pub tier: Tier,
    /// The module files that were evaluated.
    pub modules: Vec<String>,
    /// How many hooks `register` added.
    pub hooks: usize,
}

/// The chain's answer to an event.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// A hook (or the default behaviour) returned something. False when every hook passed or was skipped.
    pub answered: bool,
    /// What it returned; `null` when not answered.
    pub value: Json,
}

/// What a `ui.render` produced.
#[derive(Debug, Clone, PartialEq)]
pub enum Render {
    /// A valid element tree, as JSON with handlers replaced by `{"$handler": id}`.
    Tree {
        /// The tree.
        tree: Json,
        /// What it measured.
        stats: TreeStats,
    },
    /// No mod drew it: the site keeps its own drawing, with these props (changed or not).
    Default {
        /// The props the last hook passed on, when any.
        props: Option<Json>,
    },
    /// A mod drew something invalid; the site keeps its own drawing and a diagnostic was recorded.
    Skipped {
        /// Why.
        reason: String,
    },
}

/// Memory the engine holds, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Memory {
    /// Bytes in use by the heap.
    pub used: i64,
    /// Bytes requested from the allocator.
    pub allocated: i64,
}

enum JobsEnd {
    Idle,
    Interrupted,
    TooLong,
}

/// The isolate and the chain.
pub struct ModRuntime {
    kernel: Persistent<Object<'static>>,
    ctx: Context,
    rt: Runtime,
    shared: SharedRef,
    deadline: Rc<Cell<Option<Instant>>>,
    diagnostics: Rc<RefCell<Vec<Diagnostic>>>,
    config: RuntimeConfig,
    next_run: u64,
    crashed: Option<String>,
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
    v.as_string().and_then(|s| s.to_string().ok()).unwrap_or_else(|| "unknown exception".to_owned())
}

impl ModRuntime {
    /// Starts an isolate with the web APIs and the chain installed and no mods loaded.
    ///
    /// # Errors
    /// [`Error::Script`] if the engine cannot start.
    pub fn new(host: Box<dyn HostCalls>, config: RuntimeConfig) -> Result<Self> {
        let script = |e: rquickjs::Error| Error::Script(e.to_string());
        let rt = Runtime::new().map_err(script)?;
        rt.set_memory_limit(config.memory_limit);
        rt.set_max_stack_size(config.stack_limit);
        let deadline: Rc<Cell<Option<Instant>>> = Rc::default();
        let interrupt = deadline.clone();
        rt.set_interrupt_handler(Some(Box::new(move || interrupt.get().is_some_and(|d| Instant::now() >= d))));
        let shared: SharedRef = Rc::new(RefCell::new(Shared::default()));
        rt.set_loader(ModResolver(shared.clone()), ModLoader(shared.clone()));
        let ctx = Context::full(&rt).map_err(script)?;
        let state = NativeState { host: Rc::new(RefCell::new(host)), deadline: deadline.clone(), diagnostics: Rc::default(), started: Instant::now() };
        let diagnostics = state.diagnostics.clone();
        let kernel = ctx
            .with(|ctx| -> rquickjs::Result<_> {
                let globals = ctx.globals();
                let web: Function = ctx.eval(WEBAPI_JS)?;
                web.call::<_, ()>((natives::web_natives(&ctx)?, globals))?;
                let make: Function = ctx.eval(KERNEL_JS)?;
                let kernel: Object = make.call((natives::kernel_natives(&ctx, &state)?,))?;
                let b = &config.budgets;
                let cfg = json!({ "default": millis(b.event), "promptEdit": millis(b.prompt_edit), "catch": millis(b.catch) });
                kernel.get::<_, Function>("configure")?.call::<_, ()>((cfg.to_string(),))?;
                Ok(Persistent::save(&ctx, kernel))
            })
            .map_err(script)?;
        Ok(Self { kernel, ctx, rt, shared, deadline, diagnostics, config, next_run: 0, crashed: None })
    }

    /// Loads one plugin: reads its manifests, evaluates its modules and calls each `register`.
    ///
    /// # Errors
    /// Anything [`Error`] describes. A failed load leaves hooks the plugin registered before the
    /// failure in place; the caller should discard the runtime or not rely on that plugin.
    pub fn load_plugin(&mut self, dir: &Path, tier: Tier) -> Result<LoadedPlugin> {
        self.ensure_usable()?;
        let plugin_dir = PluginDir::open(dir)?;
        let manifest = manifest::read(&plugin_dir)?;
        self.register_plugin(plugin_dir, &manifest, tier)
    }

    /// Loads several plugins in dependency order (dependencies first), each into its tier.
    ///
    /// # Errors
    /// [`Error::DependencyCycle`] or the first plugin that fails to load.
    pub fn load_plugins(&mut self, plugins: &[(&Path, Tier)]) -> Result<Vec<LoadedPlugin>> {
        self.ensure_usable()?;
        let mut opened = Vec::with_capacity(plugins.len());
        for (path, tier) in plugins {
            let dir = PluginDir::open(path)?;
            let manifest = manifest::read(&dir)?;
            opened.push((dir, manifest, *tier));
        }
        let graph: Vec<_> = opened.iter().map(|(_, m, _)| (m.name.clone(), m.dependencies.clone())).collect();
        let order = manifest::load_order(&graph)?;
        let mut slots: Vec<_> = opened.into_iter().map(Some).collect();
        let mut loaded = Vec::with_capacity(slots.len());
        for i in order {
            if let Some((dir, manifest, tier)) = slots[i].take() {
                loaded.push(self.register_plugin(dir, &manifest, tier)?);
            }
        }
        Ok(loaded)
    }

    fn register_plugin(&mut self, dir: PluginDir, manifest: &Manifest, tier: Tier) -> Result<LoadedPlugin> {
        let idx = {
            let mut shared = self.shared.borrow_mut();
            shared.roots.push(dir);
            shared.roots.len() - 1
        };
        let options = Json::Object(manifest.options.clone()).to_string();
        let mut modules = Vec::new();
        for rel in &manifest.modules {
            let path = self.shared.borrow().roots[idx].file(rel)?.ok_or_else(|| Error::Read { path: rel.clone(), message: "no such file".into() })?;
            let name = format!("{idx}:{path}");
            let namespace = self.import(&name)?;
            let run = self.new_run();
            let name_for_js = manifest.name.clone();
            let options = options.clone();
            let tier_name = tier.name();
            self.call_kernel::<_, ()>("loadPlugin", move |ctx: &Ctx<'_>, f: &Function<'_>| {
                let ns = namespace.restore(ctx)?;
                let register: Value = ns.get("register")?;
                if !register.is_function() {
                    return Err(rquickjs::Error::new_from_js("undefined", "function"));
                }
                f.call((run, name_for_js, tier_name, options, register))
            })
            .map_err(|e| match e {
                Error::Script(_) => Error::NoRegister(path.clone()),
                other => other,
            })?;
            self.drive(run, self.config.budgets.event)?;
            modules.push(path);
        }
        let state: Json = serde_json::from_str(&self.call_kernel::<_, String>("pluginState", |_: &Ctx<'_>, f: &Function<'_>| f.call((manifest.name.clone(),)))?)?;
        if state["loaded"] != Json::Bool(true) {
            let reason = self.take_diagnostics_for(&manifest.name).unwrap_or_else(|| "register did not finish".to_owned());
            return Err(Error::LoadFailed { plugin: manifest.name.clone(), reason });
        }
        let hooks = state["hooks"].as_u64().and_then(|n| usize::try_from(n).ok()).unwrap_or(0);
        Ok(LoadedPlugin { name: manifest.name.clone(), tier, modules, hooks })
    }

    fn take_diagnostics_for(&self, plugin: &str) -> Option<String> {
        self.diagnostics.borrow().iter().rev().find(|d| d.plugin == plugin).map(|d| d.message.clone())
    }

    /// Sends one event through the chain and returns the answer.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven; hooks that throw or time out are skipped, not errors.
    pub fn dispatch(&mut self, event: &str, payload: &Json) -> Result<Answer> {
        let raw = self.run_event(event, Some(payload))?;
        let v: Json = serde_json::from_str(&raw)?;
        if let Some(e) = v.get("error").and_then(Json::as_str) {
            return Err(Error::Script(e.to_owned()));
        }
        Ok(Answer { answered: v["answered"].as_bool().unwrap_or(false), value: v.get("value").cloned().unwrap_or(Json::Null) })
    }

    /// Asks the chain to draw `component` (with `id` for a pane) and validates the tree.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn render(&mut self, component: &str, id: Option<&str>, props: &Json) -> Result<Render> {
        let payload = json!({ "component": component, "id": id, "props": props, "surface": "desktop" });
        let raw = self.run_event("ui.render", Some(&payload))?;
        let v: Json = serde_json::from_str(&raw)?;
        if let Some(e) = v.get("error").and_then(Json::as_str) {
            return Err(Error::Script(e.to_owned()));
        }
        let r = &v["render"];
        match r["kind"].as_str() {
            Some("tree") => {
                let token = r["token"].as_str().unwrap_or_default().to_owned();
                let tree: Json = serde_json::from_str(r["json"].as_str().unwrap_or("null"))?;
                match validate(&tree, &self.config.tree) {
                    Ok(stats) => {
                        self.commit(&token, true)?;
                        Ok(Render::Tree { tree, stats })
                    }
                    Err(e) => {
                        self.commit(&token, false)?;
                        Ok(self.skipped(component, id, e.to_string()))
                    }
                }
            }
            Some("invalid") => Ok(self.skipped(component, id, r["reason"].as_str().unwrap_or("invalid tree").to_owned())),
            _ => Ok(Render::Default { props: r.get("props").filter(|p| !p.is_null()).cloned() }),
        }
    }

    fn skipped(&self, component: &str, id: Option<&str>, reason: String) -> Render {
        let site = id.map_or_else(|| component.to_owned(), |i| format!("{component} {i}"));
        self.diagnostics.borrow_mut().push(Diagnostic { level: "warn".into(), plugin: String::new(), message: format!("ui.render {site}: tree skipped: {reason}") });
        Render::Skipped { reason }
    }

    fn commit(&self, token: &str, ok: bool) -> Result<()> {
        self.call_kernel::<_, ()>("commit", |_: &Ctx<'_>, f: &Function<'_>| f.call((token.to_owned(), ok)))
    }

    /// Delivers `ui.press` for a handler id from a drawn tree. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn press(&mut self, handler: &str) -> Result<bool> {
        self.callback("ui.press", &json!({ "handler": handler }))
    }

    /// Delivers `ui.input` (`onInput`, `onSubmit`) with the text. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn input(&mut self, handler: &str, value: &str) -> Result<bool> {
        self.callback("ui.input", &json!({ "handler": handler, "value": value }))
    }

    /// Delivers `ui.select` (`onSelect`) with the chosen value. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn select(&mut self, handler: &str, value: &str) -> Result<bool> {
        self.callback("ui.select", &json!({ "handler": handler, "value": value }))
    }

    /// Fires a `$.clock.every` timer. The host owns the clock and calls this on each tick.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn tick(&mut self, timer: &str) -> Result<bool> {
        self.callback("clock.tick", &json!({ "id": timer }))
    }

    /// Delivers `command.run` for a command a mod registered.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the isolate cannot be driven.
    pub fn run_command(&mut self, name: &str, args: &str) -> Result<Answer> {
        self.dispatch("command.run", &json!({ "name": name, "args": args }))
    }

    fn callback(&mut self, event: &str, payload: &Json) -> Result<bool> {
        Ok(self.dispatch(event, payload)?.value.get("handled") == Some(&Json::Bool(true)))
    }

    /// Takes the diagnostics recorded since the last call.
    pub fn take_diagnostics(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut *self.diagnostics.borrow_mut())
    }

    /// The engine's memory use.
    #[must_use]
    pub fn memory(&self) -> Memory {
        let m = self.rt.memory_usage();
        Memory { used: m.memory_used_size, allocated: m.malloc_size }
    }

    // ---- driving ---------------------------------------------------------------------------

    fn ensure_usable(&self) -> Result<()> {
        self.crashed.as_ref().map_or(Ok(()), |why| Err(Error::Crashed(why.clone())))
    }

    fn new_run(&mut self) -> u64 {
        self.next_run += 1;
        self.next_run
    }

    fn budget_for(&self, event: &str) -> Duration {
        if event == "prompt.edit" { self.config.budgets.prompt_edit } else { self.config.budgets.event }
    }

    fn run_event(&mut self, event: &str, payload: Option<&Json>) -> Result<String> {
        self.ensure_usable()?;
        let run = self.new_run();
        let body = payload.map(Json::to_string).unwrap_or_default();
        self.call_kernel::<_, ()>("dispatch", |_: &Ctx<'_>, f: &Function<'_>| f.call((run, event.to_owned(), body)))?;
        self.drive(run, self.budget_for(event))
    }

    /// Calls a function of the chain object.
    fn call_kernel<A, R>(&self, name: &str, call: A) -> Result<R>
    where
        A: for<'js> FnOnce(&Ctx<'js>, &Function<'js>) -> rquickjs::Result<R>,
    {
        self.ctx.with(|ctx| {
            let kernel = self.kernel.clone().restore(&ctx).map_err(|e| Error::Script(e.to_string()))?;
            let f: Function = kernel.get(name).map_err(|e| Error::Script(e.to_string()))?;
            call(&ctx, &f).map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    fn poll(&self, run: u64) -> Result<Option<String>> {
        self.call_kernel("poll", |_: &Ctx<'_>, f: &Function<'_>| f.call::<_, Option<String>>((run,)))
    }

    fn run_jobs(&self, hard: Instant) -> JobsEnd {
        loop {
            match self.rt.execute_pending_job() {
                Ok(true) => {
                    if Instant::now() >= hard {
                        return JobsEnd::TooLong;
                    }
                }
                Ok(false) => return JobsEnd::Idle,
                Err(job) => {
                    // The exception must be taken to clear it. The interrupt handler raises it.
                    job.0.with(|c| drop(c.catch()));
                    return JobsEnd::Interrupted;
                }
            }
        }
    }

    /// Runs the engine until the run has an answer. A hook that overruns its budget is
    /// interrupted; the chain then skips it. Gives up, and poisons the isolate, only when the
    /// chain stalls with no hook to blame or a microtask storm outlives every frame.
    fn drive(&mut self, run: u64, budget: Duration) -> Result<String> {
        let slack = budget * 2 + Duration::from_millis(250);
        let mut hard = Instant::now() + slack;
        for _ in 0..10_000 {
            self.deadline.set(None);
            let end = self.run_jobs(hard);
            if let Some(answer) = self.poll(run)? {
                return Ok(answer);
            }
            if matches!(end, JobsEnd::TooLong) {
                return Err(self.crash(run, "jobs kept running past the event's budget with no hook to interrupt"));
            }
            // Interrupted, or idle with the run unanswered (a hook awaits something that can never
            // settle). Either way the innermost running hook has used up its budget.
            let blamed = self.call_kernel("recover", |_: &Ctx<'_>, f: &Function<'_>| f.call::<_, bool>(()))?;
            if !blamed {
                return Err(self.crash(run, "the chain stalled and no hook was running"));
            }
            hard = Instant::now() + slack;
        }
        Err(self.crash(run, "too many hooks timed out in one event"))
    }

    fn crash(&mut self, run: u64, why: &str) -> Error {
        // Best effort: the isolate is abandoned either way.
        let _ = self.call_kernel::<_, ()>("abort", |_: &Ctx<'_>, f: &Function<'_>| f.call((run,)));
        self.deadline.set(None);
        self.crashed = Some(why.to_owned());
        tracing::error!(reason = why, "mod isolate crashed");
        Error::Crashed(why.to_owned())
    }

    /// Imports a module of a plugin and returns its namespace.
    fn import(&mut self, name: &str) -> Result<Persistent<Object<'static>>> {
        self.shared.borrow_mut().last_error = None;
        self.deadline.set(Some(Instant::now() + self.config.budgets.event));
        let started = self.ctx.with(|ctx| match Module::import(&ctx, name) {
            Ok(p) => Ok(Persistent::save(&ctx, p)),
            Err(e) => Err(exception_text(&ctx, &e)),
        });
        let promise = match started {
            Ok(p) => p,
            Err(text) => return Err(self.load_error(name, text)),
        };
        let end = self.run_jobs(Instant::now() + self.config.budgets.event * 2);
        self.deadline.set(None);
        let outcome = self.ctx.with(|ctx| {
            let p = promise.restore(&ctx).map_err(|e| e.to_string())?;
            match p.state() {
                PromiseState::Resolved => {
                    let ns: Object = p.result::<Object>().ok_or("no namespace")?.map_err(|e| exception_text(&ctx, &e))?;
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
            let text = if matches!(end, JobsEnd::Interrupted) { "ran past its budget while loading".to_owned() } else { text };
            self.load_error(name, text)
        })
    }

    fn load_error(&self, module: &str, text: String) -> Error {
        self.shared.borrow_mut().last_error.take().unwrap_or_else(|| {
            if text.contains("interrupted") {
                Error::LoadFailed { plugin: module.to_owned(), reason: "ran past its budget while loading".to_owned() }
            } else {
                Error::Script(text)
            }
        })
    }
}

fn millis(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
