//! The `mods.*` methods of `hx-v1`: what the plugin asks of `hx` to run a session's mods, and the
//! one request `hx` sends back (`mods.call`) for every `$` call a mod makes.
//!
//! Wire types ignore unknown fields. The schema is generated from these types
//! (`cargo test -p hx -- --ignored bless_schema`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `mods.capabilities`.
pub const METHOD_CAPABILITIES: &str = "mods.capabilities";
/// `mods.load`.
pub const METHOD_LOAD: &str = "mods.load";
/// `mods.unload`.
pub const METHOD_UNLOAD: &str = "mods.unload";
/// `mods.list`.
pub const METHOD_LIST: &str = "mods.list";
/// `mods.dispatch`.
pub const METHOD_DISPATCH: &str = "mods.dispatch";
/// `mods.render`.
pub const METHOD_RENDER: &str = "mods.render";
/// `mods.press`.
pub const METHOD_PRESS: &str = "mods.press";
/// `mods.input`.
pub const METHOD_INPUT: &str = "mods.input";
/// `mods.select`.
pub const METHOD_SELECT: &str = "mods.select";
/// `mods.reach`.
pub const METHOD_REACH: &str = "mods.reach";
/// `mods.analyze`.
pub const METHOD_ANALYZE: &str = "mods.analyze";
/// `mods.call`: sent by `hx` to the plugin, once per `$` call.
pub const METHOD_CALL: &str = "mods.call";
/// `mods.diagnostic`: a notification from `hx` to the plugin.
pub const METHOD_DIAGNOSTIC: &str = "mods.diagnostic";
/// `mods.exited`: a notification from `hx` to the plugin when a session's worker is gone.
pub const METHOD_EXITED: &str = "mods.exited";

/// Result of `mods.capabilities`: whether mods can run here at all, and why not.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ModsCapabilities {
    /// True when a sandboxed worker can start on this machine.
    pub available: bool,
    /// Why it cannot, when `available` is false.
    #[serde(default)]
    pub reason: Option<String>,
    /// The platform.
    pub platform: String,
}

/// What one mod's worker is held to. Absent fields take the defaults (64 MiB, 10 s, one hour).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct ModLimits {
    /// The mod's own heap budget, in MiB. A mod that fills it fails alone.
    #[serde(default)]
    pub heap_mib: Option<u64>,
    /// How long one hook may run, in milliseconds.
    #[serde(default)]
    pub event_budget_ms: Option<u64>,
    /// How long the worker lives, in seconds, before the sandbox ends it (at most one hour, its
    /// ceiling). The plugin starts a replacement before then.
    #[serde(default)]
    pub lifetime_s: Option<u64>,
}

/// One plugin to load.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PluginRef {
    /// The plugin directory. `hx` reads it (through `cap_std`); the worker never can.
    pub dir: String,
    /// `prepend`, `user` (default) or `append`.
    #[serde(default)]
    pub tier: Option<String>,
    /// The worker's limits.
    #[serde(default)]
    pub limits: Option<ModLimits>,
}

/// Params of `mods.load`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoadParams {
    /// The session whose mods load. Each mod gets a worker of its own.
    pub session_id: String,
    /// The plugins, in any order; dependencies load first.
    pub plugins: Vec<PluginRef>,
    /// A mod that is already running is replaced: the new worker starts and loads first, takes the
    /// mod's place in the chain, and the old one is stopped after a short grace period. Without
    /// it, a running mod is `already_loaded`; a mod whose worker has exited is loaded again either way.
    #[serde(default)]
    pub replace: bool,
}

/// A mod that is loaded.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoadedMod {
    /// The plugin name.
    pub name: String,
    /// The tier it runs in.
    pub tier: String,
    /// The module files evaluated.
    pub modules: Vec<String>,
    /// How many hooks `register` added.
    pub hooks: u32,
    /// How many workers this mod has had in this session (0 for the first). Handler ids carry it.
    #[serde(default)]
    pub generation: u32,
    /// The worker's process id, when it runs as one.
    #[serde(default)]
    pub pid: Option<u32>,
    /// Seconds until the sandbox ends the worker, when it is running.
    #[serde(default)]
    pub expires_in_s: Option<u64>,
    /// Whether the mod's worker is running.
    #[serde(default)]
    pub running: bool,
    /// The directory it was loaded from.
    #[serde(default)]
    pub dir: Option<String>,
}

/// A plugin that did not load. The others did.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FailedMod {
    /// The directory it was asked for.
    pub dir: String,
    /// Its name, when its manifest could be read.
    #[serde(default)]
    pub plugin: Option<String>,
    /// A stable code (`hx.mods.load_failed`, `hx.mods.not_a_mod`, `hx.mods.already_loaded`, ...).
    pub code: String,
    /// Why.
    pub message: String,
}

/// Result of `mods.load`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoadResult {
    /// What loaded, in load order.
    pub loaded: Vec<LoadedMod>,
    /// What did not, each with its reason. One mod failing does not stop the others.
    #[serde(default)]
    pub failed: Vec<FailedMod>,
}

/// Params of `mods.unload`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnloadParams {
    /// The session.
    pub session_id: String,
    /// One plugin to unload; absent stops every worker of the session.
    #[serde(default)]
    pub plugin: Option<String>,
}

/// Result of `mods.unload`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnloadResult {
    /// False when there was nothing to unload.
    pub unloaded: bool,
}

/// Params of `mods.list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct ListParams {
    /// One session, or every session with a worker.
    #[serde(default)]
    pub session_id: Option<String>,
}

/// One session's mods.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SessionMods {
    /// The session.
    pub session_id: String,
    /// Whether any of its workers is alive.
    pub running: bool,
    /// What is loaded in it.
    pub plugins: Vec<LoadedMod>,
}

/// Result of `mods.list`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListResult {
    /// The sessions.
    pub sessions: Vec<SessionMods>,
}

/// Params of `mods.dispatch`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DispatchParams {
    /// The session.
    pub session_id: String,
    /// The event name (`session.start`, `prompt.submit`, `tool.check`, `command.run`, ...).
    pub event: String,
    /// The event's fields.
    #[serde(default)]
    pub payload: Value,
    /// Run the event through this mod's hooks only (a restarted mod gets its own `session.start`).
    #[serde(default)]
    pub plugin: Option<String>,
}

/// Result of `mods.dispatch`: the chain's answer.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DispatchResult {
    /// A hook answered (false when every hook passed or was skipped).
    pub answered: bool,
    /// What it returned; `null` when not answered.
    pub value: Value,
    /// The mod whose hook answered, when one did.
    #[serde(default)]
    pub answered_by: Option<String>,
}

/// Params of `mods.render`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RenderParams {
    /// The session.
    pub session_id: String,
    /// The site: `Pane`, `AbovePrompt`, ...
    pub component: String,
    /// The pane id, for a pane.
    #[serde(default)]
    pub id: Option<String>,
    /// The site's props.
    #[serde(default)]
    pub props: Value,
}

/// Result of `mods.render`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RenderResult {
    /// `tree`, `default` (no mod drew it: keep the app's own drawing) or `skipped` (a mod drew
    /// something invalid, and the reason was logged).
    pub kind: String,
    /// The element tree, handlers as `{"$handler": id}`. Present for `tree`.
    #[serde(default)]
    pub tree: Option<Value>,
    /// The props the last hook passed on. Present for `default` when a hook changed them.
    #[serde(default)]
    pub props: Option<Value>,
    /// Why, for `skipped`.
    #[serde(default)]
    pub reason: Option<String>,
    /// The mod whose hook drew it (the first hook to answer): which mod a band row belongs to when
    /// several are loaded. Absent for `default`.
    #[serde(default)]
    pub plugin: Option<String>,
}

/// Params of `mods.press`, `mods.input` and `mods.select`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HandlerParams {
    /// The session.
    pub session_id: String,
    /// The handler id from a drawn tree.
    pub handler: String,
    /// The text (`input`) or the chosen value (`select`).
    #[serde(default)]
    pub value: Option<String>,
}

/// Result of `mods.press`, `mods.input` and `mods.select`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HandledResult {
    /// True when a handler ran (false for a handler id that is gone).
    pub handled: bool,
}

/// Params of `mods.reach`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReachParams {
    /// The session whose worker is probed.
    pub session_id: String,
    /// The mod whose worker is probed; absent probes the first running one.
    #[serde(default)]
    pub plugin: Option<String>,
}

/// Result of `mods.reach`: what the sandboxed worker could actually do, tried for real.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReachResult {
    /// The worker's process id.
    pub pid: u32,
    /// File access attempts, each `allowed` or `denied: <why>`.
    pub files: Value,
    /// Network attempts.
    pub network: Value,
    /// Process attempts.
    pub processes: Value,
}

/// Params of `mods.call`: one `$` call from a mod, for the plugin to decide and perform.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CallParams {
    /// The session.
    pub session_id: String,
    /// The mod. Set by `hx` from the worker's own context, so a mod cannot name another.
    pub plugin: String,
    /// The call: `ui.open`, `fs.read`, `http.fetch`, ...
    pub call: String,
    /// Its single argument (`null` when none).
    #[serde(default)]
    pub args: Value,
}

/// Params of `mods.analyze`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyzeParams {
    /// The plugin directory. `hx` reads it, compiles each module and reads the result; nothing runs.
    pub dir: String,
}

/// What one module registers and calls.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ModuleReport {
    /// The plugin-relative path.
    pub path: String,
    /// The events it registers hooks for.
    pub hooks: Vec<String>,
    /// The `$` members it uses (`ui.open`, `fs.read`).
    pub calls: Vec<String>,
    /// True when `$` escapes or is indexed by a variable, so `calls` may be incomplete.
    pub dynamic: bool,
}

/// Result of `mods.analyze`: what the install prompt shows before consent.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyzeResult {
    /// The plugin name from its manifest.
    pub plugin: String,
    /// The version, when the manifest has one.
    #[serde(default)]
    pub version: Option<String>,
    /// The module files named in `hooks/hooks.json`.
    pub entry_modules: Vec<String>,
    /// Per module.
    pub modules: Vec<ModuleReport>,
    /// Every distinct event, sorted.
    pub events: Vec<String>,
    /// Every distinct `$` namespace, sorted.
    pub namespaces: Vec<String>,
    /// True when any module could not be listed completely.
    pub dynamic: bool,
}

/// Params of `mods.exited`, the notification `hx` sends when one mod's worker is gone. The mod's
/// slot stays in the chain, so loading it again (`mods.load`) puts it back in its place.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ExitedParams {
    /// The session.
    pub session_id: String,
    /// The mod.
    pub plugin: String,
    /// Which of its workers it was.
    pub generation: u32,
    /// `ceiling` (the sandbox's one-hour limit), or `crash` (anything else, memory included).
    pub cause: String,
    /// Why, in words.
    pub reason: String,
    /// The last of the worker's error output.
    #[serde(default)]
    pub stderr: String,
}

/// Data of `hx.mods.unavailable`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnavailableData {
    /// Why mods cannot run.
    pub reason: String,
}

/// Data of `hx.mods.worker_failed`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WorkerFailedData {
    /// The last of the worker's error output.
    #[serde(default)]
    pub stderr: String,
}

/// Adds the `mods.*` methods and error data types to the `hx-v1` schema.
pub fn add_schema(b: &mut hx_proto::schema::SchemaBuilder) {
    b.method_without_params::<ModsCapabilities>(METHOD_CAPABILITIES);
    b.method::<LoadParams, LoadResult>(METHOD_LOAD);
    b.method::<UnloadParams, UnloadResult>(METHOD_UNLOAD);
    b.method::<ListParams, ListResult>(METHOD_LIST);
    b.method::<DispatchParams, DispatchResult>(METHOD_DISPATCH);
    b.method::<RenderParams, RenderResult>(METHOD_RENDER);
    b.method::<HandlerParams, HandledResult>(METHOD_PRESS);
    b.method::<HandlerParams, HandledResult>(METHOD_INPUT);
    b.method::<HandlerParams, HandledResult>(METHOD_SELECT);
    b.method::<ReachParams, ReachResult>(METHOD_REACH);
    b.method::<AnalyzeParams, AnalyzeResult>(METHOD_ANALYZE);
    b.peer_method::<CallParams, Value>(METHOD_CALL);
    b.error_data::<UnavailableData>("hx.mods.unavailable");
    b.error_data::<WorkerFailedData>("hx.mods.worker_failed");
}
