//! The runtime: one `QuickJS` runtime per session, with one context for the event chain and one
//! context per mod, and the loop that drives them with budgets.
//!
//! No object is shared between contexts. The chain (`js/chain.js`) and each mod's agent
//! (`js/agent.js`) exchange JSON messages that Rust routes, so a mod cannot reach another mod, or
//! the chain, through a shared primitive. The runtime is single-threaded and blocking from the
//! outside: [`ModRuntime::dispatch`] starts an event and drives the engine until the chain
//! answers, waiting for the host when a `$` call is pending. A hook that runs past its budget is
//! interrupted by the engine and skipped by the chain; see `js/chain.js` for why the skip is
//! driven from here.
//!
//! The heap limit is the runtime's, shared by every context: `QuickJS` accounts memory per
//! runtime, not per context, so one mod that fills it makes other mods' allocations throw too.

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Function, Module, Object, Persistent, Runtime, Value};
use serde_json::{Value as Json, json};

use crate::error::{Error, Result};
use crate::files::{Bundle, Files, PluginDir};
use crate::host::{CallId, HostCalls, HostError};
use crate::manifest::{self, Manifest};
use crate::modules::{ModLoader, ModResolver, Shared, SharedRef};
use crate::natives::{self, Msg, NativeState};
use crate::tree::{TreeLimits, TreeStats, validate};

const WEBAPI_JS: &str = include_str!("js/webapi.js");
const CHAIN_JS: &str = include_str!("js/chain.js");
const AGENT_JS: &str = include_str!("js/agent.js");

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
    /// The tier named `name` (`prepend`, `user` or `append`).
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "prepend" => Some(Self::Prepend),
            "user" => Some(Self::User),
            "append" => Some(Self::Append),
            _ => None,
        }
    }

    /// The tier's name, as the chain and the wire spell it.
    #[must_use]
    pub const fn name(self) -> &'static str {
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
        Self {
            event: Duration::from_secs(10),
            prompt_edit: Duration::from_millis(50),
            catch: Duration::from_secs(1),
        }
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
    /// The longest a `$` call may stay pending before the mod's promise rejects.
    pub host_timeout: Duration,
    /// The shortest `clock.every` interval; a shorter one is raised to it.
    pub min_timer: Duration,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            budgets: Budgets::default(),
            memory_limit: 64 * 1024 * 1024,
            stack_limit: 512 * 1024,
            tree: TreeLimits::default(),
            host_timeout: Duration::from_mins(10),
            min_timer: Duration::from_millis(50),
        }
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

/// One mod's context and the handle on its agent.
struct ModCtx {
    ctx: Context,
    agent: Persistent<Object<'static>>,
}

/// The runtime: the chain and the mods' contexts.
pub struct ModRuntime {
    chain: Persistent<Object<'static>>,
    chain_ctx: Context,
    mods: Vec<Option<ModCtx>>,
    loaded: Vec<Option<LoadedPlugin>>,
    rt: Runtime,
    shared: SharedRef,
    state: NativeState,
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
    v.as_string()
        .and_then(|s| s.to_string().ok())
        .unwrap_or_else(|| "unknown exception".to_owned())
}

fn is_interrupt(e: &Error) -> bool {
    matches!(e, Error::Script(t) if t.contains("interrupted"))
}

impl ModRuntime {
    /// Starts a runtime with the chain installed and no mods loaded.
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
        rt.set_interrupt_handler(Some(Box::new(move || {
            interrupt.get().is_some_and(|d| Instant::now() >= d)
        })));
        let shared: SharedRef = Rc::new(RefCell::new(Shared::default()));
        rt.set_loader(ModResolver(shared.clone()), ModLoader(shared.clone()));
        let state = NativeState {
            host: Rc::new(RefCell::new(host)),
            deadline,
            diagnostics: Rc::default(),
            started: Instant::now(),
            queue: Rc::default(),
            pending: Rc::default(),
            timers: Rc::default(),
            next_call: Rc::default(),
            host_timeout: config.host_timeout,
            min_timer: config.min_timer,
        };
        let chain_ctx = Context::full(&rt).map_err(script)?;
        let chain = chain_ctx
            .with(|ctx| -> rquickjs::Result<_> {
                let make: Function = ctx.eval(CHAIN_JS)?;
                let chain: Object = make.call((natives::chain_natives(&ctx, &state)?,))?;
                let b = &config.budgets;
                let cfg = json!({ "default": millis(b.event), "promptEdit": millis(b.prompt_edit), "catch": millis(b.catch) });
                chain
                    .get::<_, Function>("configure")?
                    .call::<_, ()>((cfg.to_string(),))?;
                Ok(Persistent::save(&ctx, chain))
            })
            .map_err(script)?;
        Ok(Self {
            chain,
            chain_ctx,
            mods: Vec::new(),
            loaded: Vec::new(),
            rt,
            shared,
            state,
            config,
            next_run: 0,
            crashed: None,
        })
    }

    /// Loads one plugin from a directory: reads its manifests, evaluates its modules and calls
    /// each `register`.
    ///
    /// # Errors
    /// Anything [`Error`] describes. A failed load unloads the plugin again.
    pub fn load_plugin(&mut self, dir: &Path, tier: Tier) -> Result<LoadedPlugin> {
        self.ensure_usable()?;
        let files = Files::Disk(PluginDir::open(dir)?);
        let manifest = manifest::read(&files)?;
        self.register_plugin(files, &manifest, tier)
    }

    /// Loads one plugin from sources the parent already read (a sandboxed worker cannot read the
    /// plugin directory).
    ///
    /// # Errors
    /// As [`Self::load_plugin`].
    pub fn load_bundle(&mut self, bundle: Bundle, tier: Tier) -> Result<LoadedPlugin> {
        self.ensure_usable()?;
        let files = Files::Memory(bundle);
        let manifest = manifest::read(&files)?;
        self.register_plugin(files, &manifest, tier)
    }

    /// Loads several plugins in dependency order (dependencies first), each into its tier.
    ///
    /// # Errors
    /// [`Error::DependencyCycle`] or the first plugin that fails to load.
    pub fn load_plugins(&mut self, plugins: &[(&Path, Tier)]) -> Result<Vec<LoadedPlugin>> {
        self.ensure_usable()?;
        let mut opened = Vec::with_capacity(plugins.len());
        for (path, tier) in plugins {
            opened.push((Files::Disk(PluginDir::open(path)?), *tier));
        }
        self.load_set(opened)
    }

    /// Loads several bundles in dependency order, each into its tier.
    ///
    /// # Errors
    /// As [`Self::load_plugins`].
    pub fn load_bundles(&mut self, bundles: Vec<(Bundle, Tier)>) -> Result<Vec<LoadedPlugin>> {
        self.ensure_usable()?;
        self.load_set(
            bundles
                .into_iter()
                .map(|(b, t)| (Files::Memory(b), t))
                .collect(),
        )
    }

    fn load_set(&mut self, plugins: Vec<(Files, Tier)>) -> Result<Vec<LoadedPlugin>> {
        let mut opened = Vec::with_capacity(plugins.len());
        for (files, tier) in plugins {
            let manifest = manifest::read(&files)?;
            opened.push((files, manifest, tier));
        }
        let graph: Vec<_> = opened
            .iter()
            .map(|(_, m, _)| (m.name.clone(), m.dependencies.clone()))
            .collect();
        let order = manifest::load_order(&graph)?;
        let mut slots: Vec<_> = opened.into_iter().map(Some).collect();
        let mut loaded = Vec::with_capacity(slots.len());
        for i in order {
            if let Some((files, manifest, tier)) = slots[i].take() {
                loaded.push(self.register_plugin(files, &manifest, tier)?);
            }
        }
        Ok(loaded)
    }

    /// The plugins loaded now, in load order.
    #[must_use]
    pub fn plugins(&self) -> Vec<LoadedPlugin> {
        self.loaded.iter().flatten().cloned().collect()
    }

    /// Unloads a plugin: its hooks leave the chain, its timers stop, and its context is dropped
    /// with everything in it.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven. Unloading a name that is not loaded is `Ok(false)`.
    pub fn unload_plugin(&mut self, name: &str) -> Result<bool> {
        self.ensure_usable()?;
        let Some(idx) = self
            .loaded
            .iter()
            .position(|l| l.as_ref().is_some_and(|l| l.name == name))
        else {
            return Ok(false);
        };
        self.call_chain::<_, ()>("removePlugin", |_: &Ctx<'_>, f: &Function<'_>| {
            f.call((idx,))
        })?;
        self.loaded[idx] = None;
        self.mods[idx] = None;
        self.shared.borrow_mut().roots[idx] = None;
        self.state.timers.borrow_mut().retain(|t| t.idx != idx);
        self.state.pending.borrow_mut().retain(|_, p| p.idx != idx);
        // Messages addressed to it are dropped on delivery.
        Ok(true)
    }

    fn register_plugin(
        &mut self,
        files: Files,
        manifest: &Manifest,
        tier: Tier,
    ) -> Result<LoadedPlugin> {
        if self
            .loaded
            .iter()
            .flatten()
            .any(|l| l.name == manifest.name)
        {
            return Err(Error::AlreadyLoaded(manifest.name.clone()));
        }
        let idx = self.mods.len();
        self.shared.borrow_mut().roots.push(Some(files));
        self.mods.push(None);
        self.loaded.push(None);
        let result = self.register_modules(idx, manifest, tier);
        // Whether or not it loaded, nothing reads the sources again.
        self.shared.borrow_mut().roots[idx] = None;
        match result {
            Ok(loaded) => {
                self.loaded[idx] = Some(loaded.clone());
                Ok(loaded)
            }
            Err(e) => {
                if self.mods[idx].is_some() && self.crashed.is_none() {
                    let _ = self
                        .call_chain::<_, ()>("removePlugin", |_: &Ctx<'_>, f: &Function<'_>| {
                            f.call((idx,))
                        });
                }
                self.mods[idx] = None;
                self.state.timers.borrow_mut().retain(|t| t.idx != idx);
                self.state.pending.borrow_mut().retain(|_, p| p.idx != idx);
                Err(e)
            }
        }
    }

    /// A fresh context for one mod: the web APIs, the agent, intrinsics frozen.
    fn new_mod_context(&self, idx: usize, manifest: &Manifest, tier: Tier) -> Result<ModCtx> {
        let script = |e: rquickjs::Error| Error::Script(e.to_string());
        let ctx = Context::full(&self.rt).map_err(script)?;
        let info = json!({
            "idx": idx,
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
                    make.call((natives::agent_natives(&ctx, &state, idx, &name)?, info))?;
                Ok(Persistent::save(&ctx, agent))
            })
            .map_err(script)?;
        Ok(ModCtx { ctx, agent })
    }

    fn register_modules(
        &mut self,
        idx: usize,
        manifest: &Manifest,
        tier: Tier,
    ) -> Result<LoadedPlugin> {
        let modctx = self.new_mod_context(idx, manifest, tier)?;
        self.mods[idx] = Some(modctx);
        self.call_chain::<_, ()>("addPlugin", |_: &Ctx<'_>, f: &Function<'_>| {
            f.call((idx, manifest.name.clone(), tier.name()))
        })?;
        let mut modules = Vec::new();
        for rel in &manifest.modules {
            let path = self.shared.borrow().roots[idx]
                .as_ref()
                .ok_or_else(|| Error::Read {
                    path: rel.clone(),
                    message: "the plugin directory is closed".into(),
                })?
                .file(rel)?
                .ok_or_else(|| Error::Read {
                    path: rel.clone(),
                    message: "no such file".into(),
                })?;
            let name = format!("{idx}:{path}");
            let namespace = self.import(idx, &name)?;
            self.give_register(idx, &namespace, &path)?;
            let run = self.new_run();
            let options = Json::Object(manifest.options.clone()).to_string();
            self.call_chain::<_, ()>("register", |_: &Ctx<'_>, f: &Function<'_>| {
                f.call((run, idx, options))
            })?;
            let raw = self.drive(run, self.config.budgets.event)?;
            let v: Json = serde_json::from_str(&raw)?;
            if let Some(e) = v.get("error").and_then(Json::as_str) {
                return Err(Error::LoadFailed {
                    plugin: manifest.name.clone(),
                    reason: e.to_owned(),
                });
            }
            modules.push(path);
        }
        let state: Json = serde_json::from_str(
            &self.call_chain::<_, String>("pluginState", |_: &Ctx<'_>, f: &Function<'_>| {
                f.call((idx,))
            })?,
        )?;
        if state["loaded"] != Json::Bool(true) {
            let reason = self
                .take_diagnostics_for(&manifest.name)
                .unwrap_or_else(|| "register did not finish".to_owned());
            return Err(Error::LoadFailed {
                plugin: manifest.name.clone(),
                reason,
            });
        }
        let hooks = state["hooks"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(0);
        Ok(LoadedPlugin {
            name: manifest.name.clone(),
            tier,
            modules,
            hooks,
        })
    }

    /// Hands the module's `register` export to the mod's agent.
    fn give_register(
        &self,
        idx: usize,
        namespace: &Persistent<Object<'static>>,
        path: &str,
    ) -> Result<()> {
        let m = self.mods[idx]
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

    fn take_diagnostics_for(&self, plugin: &str) -> Option<String> {
        self.state
            .diagnostics
            .borrow()
            .iter()
            .rev()
            .find(|d| d.plugin == plugin)
            .map(|d| d.message.clone())
    }

    /// Sends one event through the chain and returns the answer.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven; hooks that throw or time out are skipped, not errors.
    pub fn dispatch(&mut self, event: &str, payload: &Json) -> Result<Answer> {
        let v = self.run_event(event, Some(payload))?;
        let value = match v["value"].as_str() {
            Some(text) => serde_json::from_str(text)?,
            None => Json::Null,
        };
        Ok(Answer {
            answered: v["answered"].as_bool().unwrap_or(false),
            value,
        })
    }

    /// Asks the chain to draw `component` (with `id` for a pane) and validates the tree.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn render(&mut self, component: &str, id: Option<&str>, props: &Json) -> Result<Render> {
        let mut payload = json!({ "component": component, "props": props, "surface": "desktop" });
        if let Some(id) = id {
            // A site with no id has no `id` field, so a hook sees `undefined`, not `null`.
            payload["id"] = json!(id);
        }
        let v = self.run_event("ui.render", Some(&payload))?;
        let site = v["site"].as_str().unwrap_or_default().to_owned();
        let tokens = v["tokens"].clone();
        let value: Json = match v["value"].as_str() {
            Some(text) => serde_json::from_str(text)?,
            None => Json::Null,
        };
        if value.is_null() {
            return Ok(Render::Default { props: None });
        }
        if value["$default"] == Json::Bool(true) {
            return Ok(Render::Default {
                props: value["event"]
                    .get("props")
                    .filter(|p| !p.is_null())
                    .cloned(),
            });
        }
        if let Some(reason) = value.get("$invalid").and_then(Json::as_str) {
            self.commit(&site, &tokens, false)?;
            return Ok(self.skipped(component, id, reason.to_owned()));
        }
        let Some(tree) = value.get("$el") else {
            self.commit(&site, &tokens, false)?;
            return Ok(self.skipped(
                component,
                id,
                "a ui.render hook must return an element tree or call next".to_owned(),
            ));
        };
        match validate(tree, &self.config.tree) {
            Ok(stats) => {
                self.commit(&site, &tokens, true)?;
                Ok(Render::Tree {
                    tree: tree.clone(),
                    stats,
                })
            }
            Err(e) => {
                self.commit(&site, &tokens, false)?;
                Ok(self.skipped(component, id, e.to_string()))
            }
        }
    }

    fn skipped(&self, component: &str, id: Option<&str>, reason: String) -> Render {
        let site = id.map_or_else(|| component.to_owned(), |i| format!("{component} {i}"));
        self.state.diagnostics.borrow_mut().push(Diagnostic {
            level: "warn".into(),
            plugin: String::new(),
            message: format!("ui.render {site}: tree skipped: {reason}"),
        });
        Render::Skipped { reason }
    }

    /// Tells every mod whether the tree it staged handlers for was accepted. A mod drops the old
    /// handlers of the site on any commit, so a replaced tree's buttons stop working.
    fn commit(&mut self, site: &str, tokens: &Json, ok: bool) -> Result<()> {
        for idx in 0..self.mods.len() {
            if self.mods[idx].is_none() {
                continue;
            }
            let mine: Vec<&str> = tokens
                .as_array()
                .into_iter()
                .flatten()
                .filter(|t| t[0].as_u64().and_then(|n| usize::try_from(n).ok()) == Some(idx))
                .filter_map(|t| t[1].as_str())
                .collect();
            let msg = json!({ "k": "commit", "site": site, "ok": ok, "tokens": mine }).to_string();
            self.deliver(Msg::ToMod(idx, msg))?;
        }
        Ok(())
    }

    /// Delivers `ui.press` for a handler id from a drawn tree. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn press(&mut self, handler: &str) -> Result<bool> {
        self.callback("ui.press", &json!({ "handler": handler }))
    }

    /// Delivers `ui.input` (`onInput`, `onSubmit`) with the text. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn input(&mut self, handler: &str, value: &str) -> Result<bool> {
        self.callback("ui.input", &json!({ "handler": handler, "value": value }))
    }

    /// Delivers `ui.select` (`onSelect`) with the chosen value. True when a handler ran.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn select(&mut self, handler: &str, value: &str) -> Result<bool> {
        self.callback("ui.select", &json!({ "handler": handler, "value": value }))
    }

    /// Fires a `$.clock.every` timer.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn tick(&mut self, timer: &str) -> Result<bool> {
        self.callback("clock.tick", &json!({ "id": timer }))
    }

    /// When the next `clock.every` timer is due, if any is set. The embedder sleeps until then.
    #[must_use]
    pub fn next_timer_due(&self) -> Option<Instant> {
        self.state.timers.borrow().iter().map(|t| t.due).min()
    }

    /// Fires every timer due at `now` once, and schedules each from `now`.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn fire_due_timers(&mut self, now: Instant) -> Result<usize> {
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
        for id in &due {
            self.tick(id)?;
        }
        Ok(due.len())
    }

    /// Delivers `command.run` for a command a mod registered.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn run_command(&mut self, name: &str, args: &str) -> Result<Answer> {
        self.dispatch("command.run", &json!({ "name": name, "args": args }))
    }

    fn callback(&mut self, event: &str, payload: &Json) -> Result<bool> {
        Ok(self.dispatch(event, payload)?.value.get("handled") == Some(&Json::Bool(true)))
    }

    /// Delivers the host's answer to a `$` call nobody was waiting on (a fire-and-forget call, such
    /// as `clock.every`, whose answer arrives after the event that made it is over), and runs
    /// whatever that wakes up.
    ///
    /// # Errors
    /// [`Error::Crashed`] if the runtime cannot be driven.
    pub fn host_completed(
        &mut self,
        id: CallId,
        result: std::result::Result<Json, HostError>,
    ) -> Result<()> {
        self.ensure_usable()?;
        self.complete_call(id, result)?;
        self.settle()
    }

    /// Runs the engine until it is idle, interrupting a hook that overruns.
    fn settle(&mut self) -> Result<()> {
        let slack = self.config.budgets.event * 2 + Duration::from_millis(250);
        self.state.deadline.set(None);
        for _ in 0..1000 {
            let end = self.pump(Instant::now() + slack)?;
            if matches!(end, JobsEnd::Idle) {
                return Ok(());
            }
            if matches!(end, JobsEnd::TooLong) {
                return Err(self.crash(0, "jobs kept running with nothing to interrupt"));
            }
            self.state.deadline.set(None);
            let _ = self.call_chain("recover", |_: &Ctx<'_>, f: &Function<'_>| {
                f.call::<_, bool>(())
            })?;
        }
        Err(self.crash(0, "too many hooks timed out while settling"))
    }

    /// Takes the diagnostics recorded since the last call.
    pub fn take_diagnostics(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut *self.state.diagnostics.borrow_mut())
    }

    /// Runs the engine's cycle collector now. Measuring memory after it separates a leak from
    /// garbage the collector has not got to yet.
    pub fn collect_garbage(&mut self) {
        self.rt.run_gc();
    }

    /// The engine's memory use, for the whole runtime (every context shares one heap).
    #[must_use]
    pub fn memory(&self) -> Memory {
        let m = self.rt.memory_usage();
        Memory {
            used: m.memory_used_size,
            allocated: m.malloc_size,
        }
    }

    // ---- driving ---------------------------------------------------------------------------

    fn ensure_usable(&self) -> Result<()> {
        self.crashed
            .as_ref()
            .map_or(Ok(()), |why| Err(Error::Crashed(why.clone())))
    }

    fn new_run(&mut self) -> u64 {
        self.next_run += 1;
        self.next_run
    }

    fn budget_for(&self, event: &str) -> Duration {
        if event == "prompt.edit" {
            self.config.budgets.prompt_edit
        } else {
            self.config.budgets.event
        }
    }

    fn run_event(&mut self, event: &str, payload: Option<&Json>) -> Result<Json> {
        self.ensure_usable()?;
        let run = self.new_run();
        let body = payload.map(Json::to_string).unwrap_or_default();
        self.call_chain::<_, ()>("dispatch", |_: &Ctx<'_>, f: &Function<'_>| {
            f.call((run, event.to_owned(), body))
        })?;
        let raw = self.drive(run, self.budget_for(event))?;
        let v: Json = serde_json::from_str(&raw)?;
        if let Some(e) = v.get("error").and_then(Json::as_str) {
            return Err(Error::Script(e.to_owned()));
        }
        Ok(v)
    }

    /// Calls a function of the chain object.
    fn call_chain<A, R>(&self, name: &str, call: A) -> Result<R>
    where
        A: for<'js> FnOnce(&Ctx<'js>, &Function<'js>) -> rquickjs::Result<R>,
    {
        self.chain_ctx.with(|ctx| {
            let chain = self
                .chain
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let f: Function = chain.get(name).map_err(|e| Error::Script(e.to_string()))?;
            call(&ctx, &f).map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    /// Calls `receive` on a mod's agent. A mod that was unloaded has nobody to call.
    fn call_agent(&self, idx: usize, name: &str, arg: String) -> Result<()> {
        let Some(m) = self.mods.get(idx).and_then(Option::as_ref) else {
            return Ok(());
        };
        m.ctx.with(|ctx| {
            let agent = m
                .agent
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let f: Function = agent.get(name).map_err(|e| Error::Script(e.to_string()))?;
            f.call::<_, ()>((arg,))
                .map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    /// Delivers one message to the context it is addressed to.
    fn deliver(&self, msg: Msg) -> Result<()> {
        match msg {
            Msg::ToChain(idx, json) => self
                .call_chain::<_, ()>("receive", |_: &Ctx<'_>, f: &Function<'_>| {
                    f.call((idx, json))
                }),
            Msg::ToMod(idx, json) => self.call_agent(idx, "receive", json),
        }
    }

    fn poll(&self, run: u64) -> Result<Option<String>> {
        self.call_chain("poll", |_: &Ctx<'_>, f: &Function<'_>| {
            f.call::<_, Option<String>>((run,))
        })
    }

    fn pending_calls(&self) -> usize {
        self.state.pending.borrow().len()
    }

    /// Routes messages and runs the engine's jobs until both are exhausted.
    fn pump(&self, hard: Instant) -> Result<JobsEnd> {
        loop {
            loop {
                let next = self.state.queue.borrow_mut().pop_front();
                let Some(msg) = next else { break };
                match self.deliver(msg) {
                    Ok(()) => {}
                    Err(e) if is_interrupt(&e) => return Ok(JobsEnd::Interrupted),
                    Err(e) => return Err(e),
                }
            }
            match self.rt.execute_pending_job() {
                Ok(true) => {
                    if Instant::now() >= hard {
                        return Ok(JobsEnd::TooLong);
                    }
                }
                Ok(false) => {
                    if self.state.queue.borrow().is_empty() {
                        return Ok(JobsEnd::Idle);
                    }
                }
                Err(job) => {
                    // The exception must be taken to clear it. The interrupt handler raises it.
                    job.0.with(|c| drop(c.catch()));
                    return Ok(JobsEnd::Interrupted);
                }
            }
        }
    }

    /// Blocks for the host's next answer to a pending call (or for the oldest call's deadline),
    /// delivers it, and returns how long it waited, in milliseconds.
    fn wait_host(&self) -> Result<f64> {
        let started = Instant::now();
        let nearest = self
            .state
            .pending
            .borrow()
            .values()
            .map(|p| p.deadline)
            .min()
            .unwrap_or(started);
        let timeout = nearest.saturating_duration_since(started);
        let answer = {
            let mut host = self.state.host.borrow_mut();
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| host.wait(timeout)))
                .unwrap_or(None)
        };
        if let Some((id, result)) = answer {
            self.complete_call(id, result)?;
        } else {
            let now = Instant::now();
            let overdue: Vec<CallId> = self
                .state
                .pending
                .borrow()
                .iter()
                .filter(|(_, p)| p.deadline <= now)
                .map(|(id, _)| *id)
                .collect();
            if overdue.is_empty() && started.elapsed() < Duration::from_millis(1) {
                // A host that has nothing and does not block: do not spin.
                std::thread::sleep(Duration::from_millis(1));
            }
            for id in overdue {
                self.complete_call(
                    id,
                    Err(HostError {
                        code: "hx.mods.host_timeout".into(),
                        message: "the host did not answer this call in time".into(),
                    }),
                )?;
            }
        }
        Ok(started.elapsed().as_secs_f64() * 1000.0)
    }

    fn complete_call(
        &self,
        id: CallId,
        result: std::result::Result<Json, HostError>,
    ) -> Result<()> {
        let Some(p) = self.state.pending.borrow_mut().remove(&id) else {
            return Ok(());
        };
        natives::after_reply(&self.state, p.idx, &p.request, result.is_ok());
        let reply = match result {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": { "code": e.code, "message": e.message } }),
        };
        let Some(m) = self.mods.get(p.idx).and_then(Option::as_ref) else {
            return Ok(());
        };
        m.ctx.with(|ctx| {
            let agent = m
                .agent
                .clone()
                .restore(&ctx)
                .map_err(|e| Error::Script(e.to_string()))?;
            let f: Function = agent
                .get("complete")
                .map_err(|e| Error::Script(e.to_string()))?;
            f.call::<_, ()>((id, reply.to_string()))
                .map_err(|e| Error::Script(exception_text(&ctx, &e)))
        })
    }

    /// Runs the engine until the run has an answer. A hook that overruns its budget is
    /// interrupted; the chain then skips it. While every hook waits on a pending `$` call the
    /// driver waits for the host, and the hook's budget does not run. Gives up, and poisons the
    /// runtime, only when the chain stalls with no hook to blame and no call pending, or a
    /// microtask storm outlives every frame.
    fn drive(&mut self, run: u64, budget: Duration) -> Result<String> {
        let slack = budget * 2 + Duration::from_millis(250);
        let mut hard = Instant::now() + slack;
        self.state.deadline.set(None);
        for _ in 0..10_000 {
            let end = self.pump(hard)?;
            if let Some(answer) = self.poll(run)? {
                return Ok(answer);
            }
            if matches!(end, JobsEnd::TooLong) {
                return Err(self.crash(
                    run,
                    "jobs kept running past the event's budget with no hook to interrupt",
                ));
            }
            if matches!(end, JobsEnd::Idle) && self.pending_calls() > 0 {
                let waited = self.wait_host()?;
                self.call_chain::<_, ()>("advance", |_: &Ctx<'_>, f: &Function<'_>| {
                    f.call((waited,))
                })?;
                hard = Instant::now() + slack;
                continue;
            }
            // Interrupted, or idle with the run unanswered and nothing pending (a hook awaits
            // something that can never settle). Either way the innermost running hook has used up
            // its budget. The expired deadline must be cleared first or it would interrupt this call.
            self.state.deadline.set(None);
            let blamed = self.call_chain("recover", |_: &Ctx<'_>, f: &Function<'_>| {
                f.call::<_, bool>(())
            })?;
            if !blamed {
                return Err(self.crash(run, "the chain stalled and no hook was running"));
            }
            hard = Instant::now() + slack;
        }
        Err(self.crash(run, "too many hooks timed out in one event"))
    }

    fn crash(&mut self, run: u64, why: &str) -> Error {
        self.state.deadline.set(None);
        // Best effort: the runtime is abandoned either way.
        let _ = self.call_chain::<_, ()>("abort", |_: &Ctx<'_>, f: &Function<'_>| f.call((run,)));
        self.state.deadline.set(None);
        self.crashed = Some(why.to_owned());
        tracing::error!(reason = why, "mod runtime crashed");
        Error::Crashed(why.to_owned())
    }

    /// Imports a module of a plugin, in that plugin's context, and returns its namespace.
    fn import(&mut self, idx: usize, name: &str) -> Result<Persistent<Object<'static>>> {
        self.shared.borrow_mut().last_error = None;
        self.state
            .deadline
            .set(Some(Instant::now() + self.config.budgets.event));
        let ctx = self.mods[idx]
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
}

fn millis(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
