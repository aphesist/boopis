//! Bots: the named profiles boopis makes (ADR-0006, ADR-0042), and what each one's home needs to run like the root's.
//!
//! A bot's engine home is `<root>/profiles/<bot>`, and the engine gives every home its own plugins, configuration and
//! secret sources. A profile made with `profiles.create` starts with none of what setup gave the root, so before this a bot
//! could not reach the model the user signed in to ("Unknown provider"), ran without the boopis plugin (no governance, no
//! secret channel, no hand-over of the sign-ins), and no group could seat it. `prepare` gives one bot all of it, in this
//! order, each step only when something differs (so it is idempotent, and a home that already holds the owner's hand-made
//! fixes is left as it is where they are right):
//! 1. the plugins: boopis and every plugin the runtime carries, linked or copied into `<bot>/plugins/` (`links`);
//! 2. its configuration, through the engine's own CLI in the bot's home: the root's secret-source wiring
//!    (`secrets.boopis_host`), the three settings the user agreed to in setup, the plugin's `hx_path`, its mode (the bot's
//!    Governed switch, which is opt-in) and a ladder of the bot's own model when that model is frontier; on a new bot, its
//!    skills made for another OS switched off (`skills`);
//! 3. `plugins enable boopis` in the bot's home, which also makes the running gateway load it;
//! 4. in the root, `hosted_rooms.profiles.<bot>` = the bot's home, so a group can seat it (the engine's
//!    `session_hosted_members`; `release` removes it when the bot is archived or deleted).
//!
//! `repair` runs that for every bot once per start, after the first link to the gateway, and, once per install, makes every
//! existing bot ungoverned (its saved "governed" was the old default and never took effect) and switches off the skills made
//! for another OS. The host never edits the engine's files: everything goes through `hermes config`, `hermes plugins` and the
//! plugin's own `bots.*` methods (ADR-0014).

pub mod engine;
pub mod links;
pub mod skills;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Error, Result};
use crate::frontier;

pub use links::{Placed, Strategy};

/// The plugin every bot gets first.
pub const BOOPIS: &str = "boopis";
/// What an archived bot's profile is called: this, then its name (the plugin's rule, `bots/homes.py`).
pub const ARCHIVE_PREFIX: &str = "archived--";
/// Files that make a folder under `profiles/` a profile (the plugin's `IDENTITY`, the engine's markers).
const IDENTITY: &[&str] = &[
    "config.yaml",
    ".env",
    "SOUL.md",
    "profile.yaml",
    "auth.json",
    "state.db",
];
/// The settings the user agreed to in setup's consent form, carried to every bot the way the root has them.
pub const CONSENTED: &[&str] = &[
    "tools.tool_search.enabled",
    "delegation.backend",
    "plugins.entries.boopis.allow_gateway_injection",
];
const SETTINGS: &str = "plugins.entries.boopis.settings";
const ROOMS: &str = "hosted_rooms.profiles";

/// What `prepare` and `repair` ask of the engine, behind a trait so the tests run them over a temporary home.
#[async_trait]
pub trait Engine: Send + Sync {
    /// A value of `home`'s configuration (`hermes config get --json`), `None` when unset.
    async fn config_get(&self, home: &Path, key: &str) -> Result<Option<Value>>;
    /// Set one value in `home`'s configuration (`hermes config set`); JSON text for objects, lists and booleans.
    async fn config_set(&self, home: &Path, key: &str, value: &str) -> Result<()>;
    /// Remove one value (`hermes config unset`).
    async fn config_unset(&self, home: &Path, key: &str) -> Result<()>;
    /// `hermes plugins enable <name>` in `home` (it also asks the running gateway to load it).
    async fn enable_plugin(&self, home: &Path, name: &str) -> Result<()>;
    /// One request on a short link to the root's gateway (the plugin's `bots.*`, `profiles.*`).
    async fn call(&self, root: &Path, method: &str, params: Value) -> Result<Value>;
    /// Ask the root's gateway to discover `home`'s plugins again; an error means it could not (no socket on this OS, an
    /// older gateway), and the caller restarts instead.
    async fn reload_plugins(&self, root: &Path, home: &Path) -> Result<()>;
    /// Restart the root's gateway unless work is running; `false` when it was left running.
    async fn restart_when_idle(&self, root: &Path) -> Result<bool>;
}

/// Where the bots live and what each gets.
#[derive(Debug, Clone)]
pub struct Layout {
    /// The engine's root home (the private `<app data>/engine`, or the user's own with `--engine existing`).
    pub root: PathBuf,
    /// The plugins every bot gets: boopis, then those the runtime carries (`runtime.json`'s `plugins`).
    pub plugins: Vec<String>,
    /// How they get there on this OS.
    pub strategy: Strategy,
    /// This system, as the engine names it, for the skills (`skills::this_system`).
    pub system: String,
}

impl Layout {
    /// The layout of `root` on this machine, giving bots boopis and `carried`.
    #[must_use]
    pub fn new(root: PathBuf, carried: &[String]) -> Self {
        let mut plugins = vec![BOOPIS.to_owned()];
        plugins.extend(carried.iter().filter(|p| p.as_str() != BOOPIS).cloned());
        Self {
            root,
            plugins,
            strategy: Strategy::here(),
            system: skills::this_system().to_owned(),
        }
    }

    /// The `hx` the root's plugin uses, which every bot's plugin uses too.
    #[must_use]
    pub fn hx(&self) -> PathBuf {
        crate::setup::install::hx_target(&self.root)
    }

    /// Whether setup has placed the boopis plugin in the root (before that there is nothing to give a bot).
    #[must_use]
    pub fn ready(&self) -> bool {
        links::is_plugin(&self.root.join("plugins").join(BOOPIS))
    }

    /// The home of the bot called `name`: an existing folder under `profiles/` that is no link and resolves inside it.
    ///
    /// # Errors
    /// `InvalidInput` for a name that is not a profile name, the default profile or an archived bot; `hx.bots.not_found`
    /// when there is no such bot.
    pub fn home(&self, name: &str) -> Result<PathBuf> {
        check_name(name)?;
        if name.starts_with(ARCHIVE_PREFIX) {
            return Err(Error::InvalidInput(format!(
                "{name} is archived; restore it first"
            )));
        }
        let parent = self.root.join("profiles");
        let path = parent.join(name);
        let meta = std::fs::symlink_metadata(&path).map_err(|_| {
            Error::Bots(
                "hx.bots.not_found",
                format!("there is no bot called {name}"),
            )
        })?;
        let inside = std::fs::canonicalize(&path)
            .ok()
            .zip(std::fs::canonicalize(&parent).ok())
            .is_some_and(|(p, root)| p.parent() == Some(root.as_path()));
        if meta.file_type().is_symlink() || !meta.is_dir() || !inside {
            return Err(Error::Bots(
                "hx.bots.not_found",
                format!("there is no bot called {name}"),
            ));
        }
        Ok(path)
    }

    /// Every bot that is not archived, by name.
    #[must_use]
    pub fn bots(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.root.join("profiles")) else {
            return Vec::new();
        };
        let mut out: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| check_name(n).is_ok() && !n.starts_with(ARCHIVE_PREFIX))
            .filter(|n| {
                let p = self.root.join("profiles").join(n);
                IDENTITY.iter().any(|m| p.join(m).exists())
            })
            .collect();
        out.sort();
        out
    }
}

/// The engine's profile-name rule, and never the default profile (the user's own home is not a bot).
///
/// # Errors
/// `InvalidInput` saying what a bot's name may be.
pub fn check_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !ok || name == "default" {
        return Err(Error::InvalidInput(format!(
            "{name:?} is not a bot's name: lower case letters, digits, '-' and '_', 64 at most, and not 'default'"
        )));
    }
    Ok(())
}

/// What the root has that every bot gets, read once per `repair` (or per `prepare` on its own).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RootView {
    /// `secrets.boopis_host` of the root: which provider keys the host's keychain gives, and that the source is on.
    pub secrets: Option<Value>,
    /// The consented settings the root has, by key.
    pub consented: BTreeMap<String, Value>,
    /// `hosted_rooms.profiles` of the root.
    pub rooms: BTreeMap<String, Value>,
    /// `providers` of the root (the user's named providers and endpoints).
    pub providers: BTreeMap<String, Value>,
}

impl RootView {
    /// Read it.
    ///
    /// # Errors
    /// The engine's, when its CLI cannot run.
    pub async fn read(engine: &dyn Engine, root: &Path) -> Result<Self> {
        let mut consented = BTreeMap::new();
        for key in CONSENTED {
            if let Some(v) = engine.config_get(root, key).await? {
                consented.insert((*key).to_owned(), v);
            }
        }
        let map = |v: Option<Value>| -> BTreeMap<String, Value> {
            v.and_then(|v| v.as_object().cloned())
                .map(|m| m.into_iter().collect())
                .unwrap_or_default()
        };
        Ok(Self {
            secrets: engine
                .config_get(root, "secrets.boopis_host")
                .await?
                .filter(Value::is_object),
            consented,
            rooms: map(engine.config_get(root, ROOMS).await?),
            providers: map(engine.config_get(root, "providers").await?),
        })
    }

    /// A short fingerprint of everything here a bot copies, so a bot that already has it is not read again at every start.
    #[must_use]
    pub fn fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let text = json!({"s": self.secrets, "c": self.consented, "p": self.providers}).to_string();
        hex::encode(&Sha256::digest(text.as_bytes())[..8])
    }
}

/// What `prepare` was asked to do beyond the usual.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Ask {
    /// The bot's Governed switch, as its record says (opt-in: `false` when the record says nothing).
    pub governed: bool,
    /// A bot made just now, or the first repair of this install: its skills for another OS are switched off.
    pub fresh: bool,
}

/// What `prepare` did to one bot.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Prepared {
    /// The bot.
    pub name: String,
    /// The plugins that reached its folder now (added or replaced).
    pub placed: Vec<String>,
    /// `plugins enable boopis` ran in its home.
    pub enabled: bool,
    /// The configuration keys written in its home.
    pub written: Vec<String>,
    /// Its skills that were switched off as made for another OS.
    pub skills_off: Vec<String>,
    /// The root's `hosted_rooms.profiles.<bot>` was written.
    pub seated: bool,
    /// Its plugins could not be reloaded in the running gateway: the gateway must restart for them.
    pub needs_restart: bool,
    /// What went wrong, in plain words (each step goes on without the one that failed).
    pub problems: Vec<String>,
}

impl Prepared {
    /// Whether anything changed.
    #[must_use]
    pub fn changed(&self) -> bool {
        !self.placed.is_empty()
            || self.enabled
            || !self.written.is_empty()
            || !self.skills_off.is_empty()
            || self.seated
    }
}

fn as_text(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_owned)
}

/// The bot's model, `(provider, model)`, from its `model` section (`{provider, default}`, or a bare string).
#[must_use]
pub fn model_of(section: Option<&Value>) -> (String, String) {
    match section {
        Some(Value::String(m)) => (String::new(), m.clone()),
        Some(v) => (
            v.get("provider")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            v.get("default")
                .or_else(|| v.get("model"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        ),
        None => (String::new(), String::new()),
    }
}

/// The plugin settings a bot should have: `(key, value)` for each that differs from `current` (its
/// `plugins.entries.boopis.settings`). The ladder is the bot's own model when that model is frontier (governed mode runs
/// only on one, ADR-0037); otherwise it is left as it is, because a governed bot on another model is refused at its first
/// prompt anyway.
#[must_use]
pub fn settings_writes(
    current: Option<&Value>,
    hx: Option<&Path>,
    governed: bool,
    model: &(String, String),
) -> Vec<(String, Value)> {
    let have = |k: &str| current.and_then(|c| c.get(k));
    let mut out = Vec::new();
    if let Some(hx) = hx {
        let want = Value::String(hx.display().to_string());
        if have("hx_path") != Some(&want) {
            out.push((format!("{SETTINGS}.hx_path"), want));
        }
    }
    let mode = Value::String(if governed { "governed" } else { "ungoverned" }.to_owned());
    if have("mode") != Some(&mode) {
        out.push((format!("{SETTINGS}.mode"), mode));
    }
    let (provider, id) = model;
    if !id.is_empty() && frontier::is_frontier(provider, id) {
        let full = if provider.is_empty() {
            id.clone()
        } else {
            format!("{provider}/{id}")
        };
        let ladder = json!({"tiers": [{"name": tier_name(id), "model": full}]});
        if have("ladder") != Some(&ladder) {
            out.push((format!("{SETTINGS}.ladder"), ladder));
        }
    }
    out
}

/// A ladder tier's name from a model id: its part after the last `/`, in the characters a tier name takes.
fn tier_name(id: &str) -> String {
    let tail = id.rsplit('/').next().unwrap_or(id);
    let name: String = tail
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if name.is_empty() {
        "model".to_owned()
    } else {
        name
    }
}

/// The root's secret-source wiring a bot lacks: `(key, value)` per leaf of `root` (`enabled`, `env.<VAR>`) that `bot`
/// does not have the same. Leaves the bot's own extra variables alone.
#[must_use]
pub fn secrets_writes(root: Option<&Value>, bot: Option<&Value>) -> Vec<(String, Value)> {
    let Some(root) = root else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let base = "secrets.boopis_host";
    if let Some(on) = root.get("enabled")
        && bot.and_then(|b| b.get("enabled")) != Some(on)
    {
        out.push((format!("{base}.enabled"), on.clone()));
    }
    if let Some(env) = root.get("env").and_then(Value::as_object) {
        for (var, reference) in env {
            if bot.and_then(|b| b.get("env")).and_then(|e| e.get(var)) != Some(reference) {
                out.push((format!("{base}.env.{var}"), reference.clone()));
            }
        }
    }
    out
}

/// The root's named provider a bot's model uses, when the bot lacks it: `(key, value)` per field. An entry that holds a key
/// inline (`api_key`) is not copied: keys reach a bot through the keychain and the secret source, never as text in its
/// configuration.
#[must_use]
pub fn provider_writes(
    root: &BTreeMap<String, Value>,
    provider: &str,
    bot: Option<&Value>,
) -> Vec<(String, Value)> {
    let Some(entry) = root.get(provider).and_then(Value::as_object) else {
        return Vec::new();
    };
    if entry.contains_key("api_key") || entry.contains_key("key") {
        return Vec::new();
    }
    entry
        .iter()
        .filter(|(k, v)| bot.and_then(|b| b.get(k.as_str())) != Some(*v))
        .map(|(k, v)| (format!("providers.{provider}.{k}"), v.clone()))
        .collect()
}

/// Whether the plugin is enabled in a home whose `plugins` section is `section`.
#[must_use]
pub fn is_enabled(section: Option<&Value>, name: &str) -> bool {
    let has = |list: &str| {
        section
            .and_then(|s| s.get(list))
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(name)))
    };
    has("enabled") && !has("disabled")
}

/// The resolved spelling of a bot's home, which is what the engine accepts as a room entry (`must be an absolute, resolved
/// home`).
fn resolved(home: &Path) -> String {
    std::fs::canonicalize(home)
        .unwrap_or_else(|_| home.to_path_buf())
        .display()
        .to_string()
}

/// Step 1 of `prepare`: every plugin boopis manages into the bot's folder. True when one was placed now.
fn place_plugins(layout: &Layout, home: &Path, done: &mut Prepared) -> bool {
    let mut placed = false;
    for plugin in &layout.plugins {
        let source = layout.root.join("plugins").join(plugin);
        match links::place(&source, home, plugin, layout.strategy) {
            Ok(p) if p.changed() => {
                placed = true;
                done.placed.push(plugin.clone());
            }
            Ok(_) => {}
            Err(e) => done
                .problems
                .push(done_problem(&format!("the {plugin} plugin"), &e)),
        }
    }
    placed
}

/// What the bot's home is read for once: its `plugins` section, its model and its secret-source section.
struct BotConfig {
    plugins: Option<Value>,
    model: (String, String),
    secrets: Option<Value>,
}

/// Step 2 of `prepare`: the keys the bot's home lacks, the root's first (secrets, consent, its named provider), then the
/// plugin's settings. The second value says whether any of the root's changed (the gateway must then reload the bot).
async fn config_writes(
    engine: &dyn Engine,
    home: &Path,
    view: &RootView,
    have: &BotConfig,
    hx: Option<&Path>,
    governed: bool,
    done: &mut Prepared,
) -> (Vec<(String, Value)>, bool) {
    let mut writes = secrets_writes(view.secrets.as_ref(), have.secrets.as_ref());
    for (key, value) in &view.consented {
        match engine.config_get(home, key).await {
            Ok(got) if got.as_ref() == Some(value) => {}
            Ok(_) => writes.push((key.clone(), value.clone())),
            Err(e) => done.problems.push(done_problem(key, &e)),
        }
    }
    let provider = &have.model.0;
    if !provider.is_empty() && view.providers.contains_key(provider) {
        let mine = engine
            .config_get(home, &format!("providers.{provider}"))
            .await
            .unwrap_or(None);
        writes.extend(provider_writes(&view.providers, provider, mine.as_ref()));
    }
    let roots = !writes.is_empty();
    let settings = have
        .plugins
        .as_ref()
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get(BOOPIS))
        .and_then(|b| b.get("settings"));
    writes.extend(settings_writes(settings, hx, governed, &have.model));
    (writes, roots)
}

/// The skills of the bot made for another OS that its `skills.disabled` does not list yet, and the list with them.
async fn skills_write(
    engine: &dyn Engine,
    home: &Path,
    system: &str,
) -> Option<(Vec<String>, Value)> {
    let off = skills::for_other_systems(home, system);
    if off.is_empty() {
        return None;
    }
    let mut list: Vec<String> = engine
        .config_get(home, "skills.disabled")
        .await
        .ok()
        .flatten()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    let new: Vec<String> = off.into_iter().filter(|s| !list.contains(s)).collect();
    if new.is_empty() {
        return None;
    }
    list.extend(new.iter().cloned());
    Some((new, json!(list)))
}

/// Give the bot `name` what it needs (the module's list). `view` is the root as `RootView::read` gave it; the root's room
/// entry is updated in it too, so a repair across many bots reads the root once.
///
/// # Errors
/// `InvalidInput` or `hx.bots.not_found` for a name that is not a live bot. Anything that fails after that is a `problems`
/// line, and the other steps still run.
pub async fn prepare(
    engine: &dyn Engine,
    layout: &Layout,
    view: &mut RootView,
    name: &str,
    ask: Ask,
) -> Result<Prepared> {
    let home = layout.home(name)?;
    let mut done = Prepared {
        name: name.to_owned(),
        ..Prepared::default()
    };
    // 1. the plugins
    let placed = place_plugins(layout, &home, &mut done);
    // 2. its configuration
    let read = (
        engine.config_get(&home, "plugins").await,
        engine.config_get(&home, "model").await,
        engine.config_get(&home, "secrets.boopis_host").await,
    );
    let have = match read {
        (Ok(plugins), Ok(model), Ok(secrets)) => BotConfig {
            plugins,
            model: model_of(model.as_ref()),
            secrets,
        },
        (Err(e), ..) | (_, Err(e), _) | (.., Err(e)) => {
            done.problems
                .push(done_problem("its configuration could not be read", &e));
            return Ok(done);
        }
    };
    let hx = layout.hx();
    let (mut writes, roots) = config_writes(
        engine,
        &home,
        view,
        &have,
        hx.is_file().then_some(hx.as_path()),
        ask.governed,
        &mut done,
    )
    .await;
    if ask.fresh
        && let Some((new, list)) = skills_write(engine, &home, &layout.system).await
    {
        writes.push(("skills.disabled".to_owned(), list));
        done.skills_off = new;
    }
    for (key, value) in writes {
        match engine.config_set(&home, &key, &as_text(&value)).await {
            Ok(()) => done.written.push(key),
            Err(e) => {
                if key == "skills.disabled" {
                    done.skills_off.clear();
                }
                done.problems.push(done_problem(&key, &e));
            }
        }
    }
    // 3. the plugin itself, enabled after its settings so the gateway loads it with them
    if is_enabled(have.plugins.as_ref(), BOOPIS) {
        if placed || roots {
            done.needs_restart = engine.reload_plugins(&layout.root, &home).await.is_err();
        }
    } else {
        match engine.enable_plugin(&home, BOOPIS).await {
            Ok(()) => done.enabled = true,
            Err(e) => done.problems.push(done_problem("enabling boopis", &e)),
        }
    }
    // 4. its seat in the root's groups
    let want = Value::String(resolved(&home));
    if view.rooms.get(name) != Some(&want) {
        match engine
            .config_set(&layout.root, &format!("{ROOMS}.{name}"), &as_text(&want))
            .await
        {
            Ok(()) => {
                view.rooms.insert(name.to_owned(), want);
                done.seated = true;
            }
            Err(e) => done.problems.push(done_problem("its place in groups", &e)),
        }
    }
    Ok(done)
}

fn done_problem(what: &str, e: &Error) -> String {
    format!(
        "{what}: {}",
        crate::error::user_message(e.code(), &e.to_string())
    )
}

/// Take the bot `name` out of the root's groups (archived or deleted): its `hosted_rooms.profiles` entry goes. Nothing to do
/// when it has none.
///
/// # Errors
/// The engine's, when its CLI cannot run.
pub async fn release(engine: &dyn Engine, root: &Path, name: &str) -> Result<bool> {
    check_name(name)?;
    let rooms = engine.config_get(root, ROOMS).await?;
    if rooms.as_ref().and_then(|r| r.get(name)).is_none() {
        return Ok(false);
    }
    engine
        .config_unset(root, &format!("{ROOMS}.{name}"))
        .await?;
    Ok(true)
}

/// The room entries that name a home under `<root>/profiles/` that is no live bot's (archived, deleted or renamed by hand):
/// their names. An entry for another place (another engine's home) is not boopis's and stays.
#[must_use]
pub fn stale_entries(layout: &Layout, rooms: &BTreeMap<String, Value>) -> Vec<String> {
    let live = layout.bots();
    let profiles = std::fs::canonicalize(layout.root.join("profiles"))
        .unwrap_or_else(|_| layout.root.join("profiles"));
    let raw_profiles = layout.root.join("profiles");
    rooms
        .iter()
        .filter(|(name, value)| {
            let Some(path) = value.as_str().map(Path::new) else {
                return false;
            };
            let ours = path.starts_with(&profiles) || path.starts_with(&raw_profiles);
            ours && !live.contains(name)
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// What boopis keeps about its bots, once per install: `<root>/boopis/bots.json`. Decisions and fingerprints, never a secret.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Marker {
    /// The schema version.
    pub version: u32,
    /// Every bot made before governance was opt-in was made ungoverned (ADR-0042), once.
    pub governance_opt_in: bool,
    /// The skills made for another OS were switched off in every bot, once.
    pub other_os_skills: bool,
    /// The one notice the repair left for the app to show, taken once (`take_notice`).
    pub notice: Option<String>,
    /// Per bot, the fingerprint of what it was last given (`fingerprint`): a bot whose fingerprint still matches and whose
    /// plugins are all in place is not read again.
    pub prepared: BTreeMap<String, String>,
}

impl Marker {
    fn path(root: &Path) -> PathBuf {
        root.join("boopis").join("bots.json")
    }

    /// Read it; a missing or unreadable file is a fresh one.
    #[must_use]
    pub fn load(root: &Path) -> Self {
        std::fs::read_to_string(Self::path(root))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Write it atomically (a temporary file, then a rename).
    ///
    /// # Errors
    /// `Io` when the write fails.
    pub fn save(&self, root: &Path) -> Result<()> {
        let path = Self::path(root);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&Self {
            version: 1,
            ..self.clone()
        })
        .map_err(|e| Error::Io(e.to_string()))?;
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }
}

/// The notice the last repair left, taken: the app shows it once.
///
/// # Errors
/// `Io` when the file cannot be written back.
pub fn take_notice(root: &Path) -> Result<Option<String>> {
    let mut marker = Marker::load(root);
    let notice = marker.notice.take();
    if notice.is_some() {
        marker.save(root)?;
    }
    Ok(notice)
}

/// What a bot's fingerprint is made of: the boopis version that prepared it, the root's view and its Governed switch.
fn fingerprint(view: &RootView, governed: bool) -> String {
    format!(
        "{}:{}:{}",
        env!("CARGO_PKG_VERSION"),
        view.fingerprint(),
        u8::from(governed)
    )
}

/// The bots' records as the plugin reads them (`plugin.boopis.bots.read`): name to whether its Governed switch is on.
#[must_use]
pub fn governed_of(records: &Value) -> BTreeMap<String, bool> {
    records
        .get("bots")
        .and_then(Value::as_array)
        .map(|bots| {
            bots.iter()
                .filter_map(|b| {
                    let name = b.get("name")?.as_str()?.to_owned();
                    let gov = b
                        .get("record")
                        .and_then(|r| r.get("settings"))
                        .and_then(|s| s.get("gov"))
                        .and_then(Value::as_str);
                    Some((name, gov == Some("governed")))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The names in a list of plain words: "kai", "kai and nina", "kai, nina and moss".
#[must_use]
pub fn and_list(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// The one notice of the governance change, naming the bots that were switched.
#[must_use]
pub fn governance_notice(switched: &[String]) -> String {
    let (who, verb) = if switched.len() == 1 {
        (switched[0].clone(), "stays")
    } else {
        (and_list(switched), "stay")
    };
    format!(
        "Governed mode now really applies to a bot when you turn it on. {who} {verb} ungoverned, as {} ran until now. \
         Turn Governed on in a bot's settings to govern it; it needs a frontier model such as opus.",
        if switched.len() == 1 { "it" } else { "they" }
    )
}

/// What a repair did.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Repaired {
    /// Each bot that was looked at, and what it got.
    pub bots: Vec<Prepared>,
    /// Room entries removed because their bot is gone or archived.
    pub released: Vec<String>,
    /// Bots made ungoverned by the one-time change.
    pub ungoverned: Vec<String>,
    /// The gateway was restarted to load what changed.
    pub restarted: bool,
    /// What could not be done, in plain words.
    pub problems: Vec<String>,
}

/// Once per install: every bot whose record says governed (the old default, which never applied) is made ungoverned through
/// the plugin's own `bots.write`, and the notice names them. Done when every write went through.
async fn opt_in_governance(
    engine: &dyn Engine,
    layout: &Layout,
    bots: &[String],
    governed: &mut BTreeMap<String, bool>,
    marker: &mut Marker,
    out: &mut Repaired,
) {
    for name in bots {
        if !governed.get(name).copied().unwrap_or(false) {
            continue;
        }
        let wrote = engine
            .call(
                &layout.root,
                "plugin.boopis.bots.write",
                json!({"name": name, "settings": {"gov": "ungoverned"}}),
            )
            .await;
        match wrote {
            Ok(_) => {
                governed.insert(name.clone(), false);
                out.ungoverned.push(name.clone());
            }
            Err(e) => out
                .problems
                .push(done_problem(&format!("{name}'s governance"), &e)),
        }
    }
    if out.problems.is_empty() {
        marker.governance_opt_in = true;
        if !out.ungoverned.is_empty() {
            marker.notice = Some(governance_notice(&out.ungoverned));
        }
    }
}

/// Whether a bot already has everything its fingerprint says it was given: its plugins in place and its seat in groups.
fn still_prepared(
    layout: &Layout,
    view: &RootView,
    marker: &Marker,
    name: &str,
    print: &str,
) -> bool {
    let home = layout.root.join("profiles").join(name);
    let placed = layout.plugins.iter().all(|p| {
        let source = layout.root.join("plugins").join(p);
        !links::is_plugin(&source) || links::is_plugin(&home.join("plugins").join(p))
    });
    placed
        && view.rooms.get(name) == Some(&Value::String(resolved(&home)))
        && marker.prepared.get(name).map(String::as_str) == Some(print)
}

/// Give every bot what it needs (see the module's comment). Safe to run at every start: a bot that already has everything
/// costs a look at its folder.
///
/// # Errors
/// `Unavailable` when the plugin's records cannot be read (the repair then waits for the next start); everything after that is
/// a `problems` line.
pub async fn repair(engine: &dyn Engine, layout: &Layout) -> Result<Repaired> {
    let mut out = Repaired::default();
    if !layout.ready() {
        return Ok(out);
    }
    let mut marker = Marker::load(&layout.root);
    let records = engine
        .call(&layout.root, "plugin.boopis.bots.read", json!({}))
        .await?;
    let mut governed = governed_of(&records);
    let bots = layout.bots();
    if !marker.governance_opt_in {
        opt_in_governance(engine, layout, &bots, &mut governed, &mut marker, &mut out).await;
    }
    let mut view = RootView::read(engine, &layout.root).await?;
    let skills_once = !marker.other_os_skills;
    let mut needs_restart = false;
    for name in &bots {
        let gov = governed.get(name).copied().unwrap_or(false);
        let print = fingerprint(&view, gov);
        if !skills_once && still_prepared(layout, &view, &marker, name, &print) {
            continue;
        }
        let ask = Ask {
            governed: gov,
            fresh: skills_once,
        };
        match prepare(engine, layout, &mut view, name, ask).await {
            Ok(done) => {
                needs_restart |= done.needs_restart;
                if done.problems.is_empty() {
                    marker.prepared.insert(name.clone(), print);
                }
                out.bots.push(done);
            }
            Err(e) => out.problems.push(done_problem(name, &e)),
        }
    }
    if skills_once && out.bots.iter().all(|b| b.problems.is_empty()) {
        marker.other_os_skills = true;
    }
    for name in stale_entries(layout, &view.rooms) {
        match engine
            .config_unset(&layout.root, &format!("{ROOMS}.{name}"))
            .await
        {
            Ok(()) => out.released.push(name),
            Err(e) => out
                .problems
                .push(done_problem(&format!("the old group seat of {name}"), &e)),
        }
    }
    marker.prepared.retain(|n, _| bots.contains(n));
    if needs_restart {
        match engine.restart_when_idle(&layout.root).await {
            Ok(r) => out.restarted = r,
            Err(e) => out.problems.push(done_problem("restarting the engine", &e)),
        }
        if !out.restarted {
            // Work was running: the bots whose plugins could not be reloaded are looked at again next start.
            for b in out.bots.iter().filter(|b| b.needs_restart) {
                marker.prepared.remove(&b.name);
            }
        }
    }
    marker.save(&layout.root)?;
    Ok(out)
}
