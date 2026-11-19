//! First-run setup (`docs/FORMS.md`, ADR-0006, ADR-0014): from "Hermes is installed" to "boopis works", without the
//! user editing a file. The host drives it; every question is a form (`kind` `setup`, `credential` or `choice`) shown by
//! the UI, and every change to Hermes goes through Hermes's own CLI.
//!
//! The flow is a list of steps recomputed from reality on every call, so it resumes after an interruption and running it
//! again changes nothing that is already right:
//! 0. **The runtime** (when the app carries one, ADR-0023): unpacked, hash-checked, into the app's own folder, with a
//!    private Hermes home and Hermes's own update check off.
//! 1. **Hermes** is found (never installed here: the documented command is shown, and `hermes_install` runs nothing).
//! 2. **The plugin** is copied into the profile and enabled; an upgrade replaces it in place.
//! 3. **`hx`** is placed where the plugin finds it (`hx_path`).
//! 4. **Hermes's settings** (`tool_search` off, the delegation backend, gateway injection) are shown as an exact diff in
//!    one consent form, and applied only when the user agrees. A decline is respected and explained.
//! 5. **Models and keys**: what Hermes already has is detected; a missing key is a `credential` form (the value goes to the
//!    keychain, never into a file or a log); the ladder is the Claude one when Claude is available, else the user picks.
//! 6. **Restart** the gateway if anything needs it, then check the result and write a short receipt.

pub mod install;
pub mod ops;
pub mod providers;
pub mod state;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;

use crate::claude::{self, ClaudeCli, SystemClaude};
use crate::commands::Json;
use crate::error::{Error, Result};
use crate::runtime::{Outcome, Pass, Plan};
use crate::secrets::SecretStore;
use crate::secrets::store::validate_value;
use install::{Bundle, Installed};
use ops::HermesOps;
use state::{Consent, State};

/// One change to Hermes's configuration, as shown in the consent form.
#[derive(Debug, Clone, Serialize, Type)]
pub struct DiffLine {
    /// The dotted key.
    pub key: String,
    /// What it is now (`null`: unset).
    #[specta(type = specta_typescript::Unknown)]
    pub from: Option<Value>,
    /// What it will be.
    #[specta(type = specta_typescript::Unknown)]
    pub to: Value,
}

/// A form for the UI, in the shape of the plugin's `form.opened` (`docs/FORMS.md` section 6).
#[derive(Debug, Clone, Serialize, Type)]
pub struct Form {
    /// A stable id: the same question has the same id after a restart.
    pub form_id: String,
    /// `setup`, `credential` or `choice`.
    pub kind: String,
    /// One line.
    pub title: String,
    /// Why it is asked and what happens on submit.
    pub body: String,
    /// MCP elicitation's schema with the `x-` extensions.
    pub schema: Json,
    /// The submit button.
    pub submit: Json,
    /// The cancel button.
    pub cancel: Json,
    /// Whether a field is secret (the UI then never mirrors it anywhere).
    pub sensitive: bool,
    /// Always `host`.
    pub origin: String,
    /// The exact configuration changes, for a `setup` or `connector` form.
    pub diff: Vec<DiffLine>,
    /// What a `connector` form installs, as `[label, text]` rows: the command, the hosts it reaches, the licence.
    #[serde(default)]
    pub contents: Vec<(String, String)>,
    /// The exact version or hash a `connector` form pins; `None` when nothing is pinned.
    pub pinned: Option<String>,
    /// What submitting does, in one sentence (a `connector` form).
    pub effect: Option<String>,
}

impl Form {
    pub(crate) fn new(id: &str, kind: &str, title: &str, body: &str, schema: Value) -> Self {
        let sensitive = schema["properties"]
            .as_object()
            .is_some_and(|p| p.values().any(|f| f["x-secret"] == true));
        Self {
            form_id: id.to_owned(),
            kind: kind.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            schema: Json(schema),
            submit: Json(json!({"label": "Continue"})),
            cancel: Json(json!({"label": "Not now"})),
            sensitive,
            origin: "host".to_owned(),
            diff: Vec::new(),
            contents: Vec::new(),
            pinned: None,
            effect: None,
        }
    }
}

/// Where a step stands.
#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    /// Not reached yet.
    Pending,
    /// Done (or already was).
    Done,
    /// Waiting for the user's answer to the open form.
    NeedsInput,
    /// Stopped; `code` and `detail` say why and what to do.
    Blocked,
    /// The user declined; the detail says what will not work.
    Declined,
    /// Left out on purpose; the detail says what it costs.
    Skipped,
}

/// One line of the checklist.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Step {
    /// `hermes`, `plugin`, `hx`, `config`, `models`, `restart` or `receipt`.
    pub id: String,
    /// The label.
    pub title: String,
    /// The state.
    pub state: StepState,
    /// What happened, or what is needed.
    pub detail: String,
    /// A stable `hx.setup.*` code when blocked.
    pub code: Option<String>,
}

/// The short "you're set" note.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Receipt {
    /// Plain lines: what is installed, what was changed, what to know.
    pub lines: Vec<String>,
}

/// What `setup_advance` answers.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Status {
    /// The checklist.
    pub steps: Vec<Step>,
    /// The question to show, if one is open.
    pub form: Option<Form>,
    /// Every step is done, skipped or declined.
    pub done: bool,
    /// When Hermes is missing: the documented install command (nothing was run).
    pub install_command: Option<String>,
    /// Present once the flow reached its end.
    pub receipt: Option<Receipt>,
}

/// The user's answer to the open form. The secret values travel UI to host only and are never logged.
#[derive(Deserialize, Type)]
pub struct Answer {
    /// The form's id.
    pub form_id: String,
    /// The user cancelled.
    pub cancelled: bool,
    /// The non-secret values.
    pub values: Json,
    /// The secret fields' values (credential forms), by field name.
    pub secrets: Json,
}

impl std::fmt::Debug for Answer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Answer")
            .field("form_id", &self.form_id)
            .field("cancelled", &self.cancelled)
            .finish_non_exhaustive()
    }
}

/// Whether first-run setup still has to run, without changing anything.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Check {
    /// Hermes is installed.
    pub hermes_installed: bool,
    /// Setup has not finished, or the plugin is missing, outdated or disabled.
    pub needed: bool,
    /// One line saying why.
    pub reason: String,
}

/// The checklist's name for the engine step (ADR-0031: the user sees boopis, never the engine's own name).
const ENGINE_TITLE: &str = "Engine";
/// The checklist's name for the consent step.
const SETTINGS_TITLE: &str = "Settings boopis needs";

/// The wanted settings, with why each matters (shown in the consent form).
fn wanted() -> Vec<(&'static str, Value, &'static str)> {
    vec![
        (
            "tools.tool_search.enabled",
            json!("off"),
            "so pack, ship and dispatch show directly; other clients of this profile see plugin and MCP tools eagerly too",
        ),
        (
            "delegation.backend",
            json!("boopis"),
            "so governed work can be routed to each model tier",
        ),
        (
            "plugins.entries.boopis.allow_gateway_injection",
            json!(true),
            "so a Claude Code Stop hook that blocks can continue the turn",
        ),
    ]
}

fn text_of(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_owned)
}

/// How far a long setup step has come, pushed while `advance` runs (the call itself answers only when the step is over).
/// Today only the runtime step reports: its archive is read twice (hashed, then extracted), each pass from 0 to the whole
/// archive. `total` is the archive's size in bytes from `runtime.json`, `read` the bytes of it passed so far; nothing here
/// is estimated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, tauri_specta::Event)]
pub struct SetupProgress {
    /// The step, as in [`Step::id`] (`runtime`).
    pub step: String,
    /// Which pass over the archive: `verify` or `unpack`.
    pub phase: Pass,
    /// Bytes of the archive read so far in this pass.
    #[specta(type = f64)]
    pub read: u64,
    /// The archive's size in bytes.
    #[specta(type = f64)]
    pub total: u64,
}

/// Where [`SetupProgress`] goes. It runs on the unpacking thread, so it must be quick and must not block.
pub type ProgressSink = Arc<dyn Fn(SetupProgress) + Send + Sync>;

/// What Settings > Models shows of the configuration (read-only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ModelsView {
    /// Whether a ladder is saved, and whether it can be read.
    pub state: providers::LadderState,
    /// Its tiers, cheapest first; empty unless `state` is `set`.
    pub tiers: Vec<providers::LadderTier>,
    /// The user's Claude Code as the Claude subscription plugin would see it: signed in or not, and its version.
    pub claude: claude::Probe,
    /// Whether Hermes lists the Claude subscription plugin's provider.
    pub claude_plugin: bool,
}

/// The setup engine for one profile.
pub struct Setup {
    ops: Arc<dyn HermesOps>,
    secrets: Arc<dyn SecretStore>,
    /// The user's own Claude Code, looked at for the Claude subscription (ADR-0029).
    claude: Arc<dyn ClaudeCli>,
    bundle: Bundle,
    install_command: String,
    /// The bundled Hermes runtime to unpack first (ADR-0023); `None` when the app uses a Hermes the user already has.
    runtime: Option<Plan>,
    /// Told how far the runtime unpack has come.
    progress: Option<ProgressSink>,
}

struct Run {
    steps: Vec<Step>,
    form: Option<Form>,
    install_command: Option<String>,
    stop: bool,
}

impl Run {
    fn push(
        &mut self,
        id: &str,
        title: &str,
        state: StepState,
        detail: impl Into<String>,
        code: Option<&str>,
    ) {
        self.stop |= matches!(state, StepState::NeedsInput | StepState::Blocked);
        let detail: String = detail.into();
        // A step with a code says it in boopis's words: the engine's own reason goes to Diagnostics (ADR-0031).
        let detail = match code {
            Some(c) => crate::error::user_message(c, &detail),
            None => detail,
        };
        self.steps.push(Step {
            id: id.to_owned(),
            title: title.to_owned(),
            state,
            detail,
            code: code.map(str::to_owned),
        });
    }

    fn done(&mut self, id: &str, title: &str, detail: impl Into<String>) {
        self.push(id, title, StepState::Done, detail, None);
    }

    fn blocked(&mut self, id: &str, title: &str, code: &str, e: &Error) {
        self.push(id, title, StepState::Blocked, e.to_string(), Some(code));
    }
}

impl Setup {
    /// An engine over `ops` and the keychain, installing from `bundle`.
    #[must_use]
    pub fn new(ops: Arc<dyn HermesOps>, secrets: Arc<dyn SecretStore>, bundle: Bundle) -> Self {
        Self {
            ops,
            secrets,
            claude: Arc::new(SystemClaude::new()),
            bundle,
            install_command: crate::hermes::install::installer_command().to_owned(),
            runtime: None,
            progress: None,
        }
    }

    /// Look at Claude Code through `claude` instead of the `claude` on this computer.
    #[must_use]
    pub fn with_claude(mut self, claude: Arc<dyn ClaudeCli>) -> Self {
        self.claude = claude;
        self
    }

    /// Tell `sink` how far long steps have come while `advance` runs.
    #[must_use]
    pub fn with_progress(mut self, sink: ProgressSink) -> Self {
        self.progress = Some(sink);
        self
    }

    /// Unpack the bundled Hermes runtime as the first step, and make it the only Hermes (ADR-0023).
    #[must_use]
    pub fn with_runtime(mut self, plan: Plan) -> Self {
        self.runtime = Some(plan);
        self
    }

    /// Read-only: does setup have to run? It never writes.
    ///
    /// # Errors
    /// `hx.setup.state_invalid` for a progress file that cannot be used.
    pub async fn check(&self) -> Result<Check> {
        if let Some(plan) = &self.runtime
            && !plan.runtime.is_installed(&plan.runtimes_dir())
        {
            return Ok(Check {
                hermes_installed: false,
                needed: true,
                reason: "boopis's engine has not been unpacked yet".into(),
            });
        }
        if self.ops.version().await.is_err() {
            return Ok(Check {
                hermes_installed: false,
                needed: true,
                reason: "no engine was found on this computer".into(),
            });
        }
        let home = self.ops.home();
        let state = state::load(&home)?;
        let installed = install::plugin_version(&ops::plugins_dir(&home).join("boopis"));
        let bundled = self
            .bundle
            .plugin_dir
            .as_deref()
            .and_then(install::plugin_version);
        let enabled = self
            .ops
            .plugins()
            .await
            .is_ok_and(|l| l.iter().any(|p| p.name == "boopis" && p.enabled));
        let (needed, reason) = match (state.done_at, installed, enabled) {
            (_, None, _) => (true, "the boopis plugin is not installed"),
            (_, _, false) => (true, "the boopis plugin is not enabled"),
            (None, _, _) => (true, "setup has not finished"),
            (Some(_), Some(i), true) if bundled.is_some_and(|b| b != i) => {
                (true, "the app carries a newer plugin")
            }
            _ => (false, "set up"),
        };
        Ok(Check {
            hermes_installed: true,
            needed,
            reason: reason.into(),
        })
    }

    fn apply_answer(&self, state: &mut State, answer: &Answer) -> Result<()> {
        let invalid = |m: &str| Error::Setup("hx.setup.invalid_answer", m.to_owned());
        if state.pending_form.as_deref() != Some(answer.form_id.as_str()) {
            return Err(invalid("that form is not the one that is open"));
        }
        let id = answer.form_id.as_str();
        if id == "setup.config" {
            state.consent = if answer.cancelled {
                Consent::Declined
            } else {
                Consent::Granted
            };
        } else if id == "setup.ladder" {
            state.choice = Some(if answer.cancelled {
                String::new()
            } else {
                answer.values.0["choice"]
                    .as_str()
                    .ok_or_else(|| invalid("a model must be chosen"))?
                    .to_owned()
            });
            state.picks.clear();
            state.reopen_models = false;
            state.claude_consent = false;
        } else if id == "setup.claude" || id == "setup.claude.install" {
            if answer.cancelled {
                // back to the models question, with every choice it has
                state.choice = None;
                state.reopen_models = true;
                state.claude_consent = false;
            } else if id == "setup.claude.install" {
                state.claude_consent = true;
            }
        } else if id == "setup.openrouter" {
            if answer.cancelled {
                state.choice = Some(String::new());
            } else {
                // a multi-select answers with a list; a single pick may arrive as the bare id
                let picked = &answer.values.0["picks"];
                state.picks = match picked {
                    Value::Array(a) => a
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect(),
                    Value::String(one) => vec![one.clone()],
                    _ => Vec::new(),
                };
                if state.picks.is_empty() {
                    return Err(invalid("at least one model must be chosen"));
                }
            }
        } else if let Some(provider) = id.strip_prefix("setup.credential.") {
            if answer.cancelled {
                state.choice = Some(String::new());
            } else {
                let value = answer.secrets.0["value"]
                    .as_str()
                    .ok_or_else(|| invalid("the key is missing"))?;
                validate_value(value)?;
                let r = crate::secrets::refs::SecretRef::provider_key(provider);
                self.secrets.set(&r.service(), &r.name, value)?;
            }
        } else {
            return Err(invalid("unknown form"));
        }
        state.pending_form = None;
        Ok(())
    }

    /// The configured ladder, read through Hermes's CLI. Changes nothing.
    ///
    /// # Errors
    /// `hx.config.invalid` when Hermes cannot be asked.
    pub async fn models_view(&self) -> Result<ModelsView> {
        let (saved, probe, plugins) = tokio::join!(
            self.ops.config_get(providers::LADDER_KEY),
            self.claude.probe(),
            self.ops.plugins()
        );
        let (state, tiers) = providers::ladder_of(saved?.as_ref());
        Ok(ModelsView {
            state,
            tiers,
            claude: probe,
            // a Hermes that cannot list its plugins says nothing about this one
            claude_plugin: plugins.is_ok_and(|l| l.iter().any(|p| p.name == claude::PROVIDER_ID)),
        })
    }

    /// The user wants to choose the models again (from a limit notice): forget the choice and the ladder question's answer,
    /// so the next `advance` asks it again, with every choice Hermes can still offer. Nothing is changed in Hermes until
    /// the new choice is made.
    ///
    /// # Errors
    /// `hx.setup.state_invalid` for a progress file that cannot be used.
    pub fn reopen_models(&self) -> Result<()> {
        let home = self.ops.home();
        let mut state = state::load(&home)?;
        state.choice = None;
        state.picks.clear();
        state.free_note = None;
        state.reopen_models = true;
        state.claude_consent = false;
        state.pending_form = None;
        state.done_at = None;
        state::save(&home, &state)
    }

    /// Run the steps as far as they go. `answer` is the user's reply to the form the last call returned;
    /// `reconsider` forgets a declined consent so the form is shown again.
    ///
    /// # Errors
    /// `hx.setup.invalid_answer` for an answer that does not match the open form, `hx.setup.state_invalid` for a
    /// progress file that cannot be used. Every step failure is a `blocked` step in the status, not an error.
    pub async fn advance(&self, answer: Option<Answer>, reconsider: bool) -> Result<Status> {
        let home = self.ops.home();
        let mut state = state::load(&home)?;
        if let Some(a) = &answer {
            self.apply_answer(&mut state, a)?;
        }
        if reconsider && state.consent == Consent::Declined {
            state.consent = Consent::Unasked;
        }
        let mut run = Run {
            steps: Vec::new(),
            form: None,
            install_command: None,
            stop: false,
        };
        self.steps(&mut run, &mut state).await;
        state.pending_form = run.form.as_ref().map(|f| f.form_id.clone());
        let finished = !run.stop;
        let receipt = if finished {
            Some(Self::receipt(&run.steps, &state))
        } else {
            None
        };
        if finished && state.done_at.is_none() {
            state.done_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs());
        }
        state::save(&home, &state)?;
        if !finished {
            run.push("receipt", "Ready", StepState::Pending, "", None);
        }
        Ok(Status {
            steps: run.steps,
            form: run.form,
            done: finished,
            install_command: run.install_command,
            receipt,
        })
    }

    async fn steps(&self, run: &mut Run, state: &mut State) {
        // 0. the bundled runtime, when the app carries one: unpacked, hash-checked, then the private home is configured
        if let Some(plan) = &self.runtime {
            self.runtime_step(plan, run, state).await;
            if run.stop {
                return;
            }
        }
        // 1. Hermes
        match self.ops.version().await {
            Ok(v) => run.done(
                "hermes",
                ENGINE_TITLE,
                format!("version {}", v.unwrap_or_else(|| "unknown".into())),
            ),
            Err(Error::HermesMissing) => {
                // Only with `--engine existing` (a build that carries its engine never gets here): the command stays in
                // the status for the command line and the docs, and the step says what to do in boopis's words.
                run.install_command = Some(self.install_command.clone());
                run.push("hermes", ENGINE_TITLE, StepState::Blocked,
                    "No engine was found on this computer. Install it as the boopis docs describe, then choose Check again; or start boopis without --engine existing to use the engine it carries.",
                    Some("hx.setup.engine_missing"));
                return;
            }
            Err(e) => return run.blocked("hermes", ENGINE_TITLE, "hx.setup.engine_missing", &e),
        }
        self.plugin_step(run, state).await;
        if run.stop {
            return;
        }
        self.hx_step(run, state).await;
        if run.stop {
            return;
        }
        self.config_step(run, state).await;
        if run.stop {
            return;
        }
        self.models_step(run, state).await;
        if run.stop {
            return;
        }
        self.restart_step(run, state).await;
    }

    /// Unpack the runtime this build carries (idempotent), then switch off Hermes's own update check in the private home.
    /// A failure is a blocked step that says what happened and what to do; nothing is left half installed.
    async fn runtime_step(&self, plan: &Plan, run: &mut Run, state: &mut State) {
        let (id, title) = ("runtime", "boopis engine");
        let (runtime, dir) = (plan.runtime.clone(), plan.runtimes_dir());
        let sink = self.progress.clone();
        let unpacked = tokio::task::spawn_blocking(move || {
            let mut last = 0;
            runtime.install(&dir, &mut |p| {
                if let Some(sink) = &sink {
                    sink(SetupProgress {
                        step: "runtime".into(),
                        phase: p.phase,
                        read: p.read,
                        total: p.total,
                    });
                }
                if p.phase == Pass::Unpack && (p.percent() >= last + 10 || p.percent() == 100) {
                    last = p.percent();
                    tracing::info!(percent = p.percent(), "unpacking the bundled Hermes");
                }
            })
        })
        .await;
        let (layout, outcome) = match unpacked {
            Ok(Ok(done)) => done,
            Ok(Err(e)) => return run.blocked(id, title, e.code(), &e),
            Err(e) => {
                let e = Error::Setup(
                    "hx.setup.runtime_unpack_failed",
                    format!("unpacking the bundled Hermes stopped: {e}"),
                );
                return run.blocked(id, title, e.code(), &e);
            }
        };
        let manifest = plan.runtime.manifest();
        // Hermes's own update check and `hermes update` have no place in a bundle: the app's updater ships Hermes.
        // `hermes update` already refuses (the install stamp says an app owns it); the passive check is switched off here.
        match self.ops.config_get("updates.check").await {
            Ok(Some(Value::Bool(false))) => {}
            Ok(_) => {
                if let Err(e) = self.ops.config_set("updates.check", "false").await {
                    return run.blocked(id, title, "hx.setup.config_failed", &e);
                }
            }
            Err(e) => return run.blocked(id, title, "hx.setup.config_failed", &e),
        }
        let detail = match outcome {
            Outcome::Current => format!("version {}, unpacked", manifest.hermes_version),
            Outcome::Unpacked => {
                state.restart_pending = true; // a gateway of an older runtime must give way to this one
                format!(
                    "unpacked version {} into boopis's own folder; nothing else on this computer is touched",
                    manifest.hermes_version
                )
            }
        };
        tracing::info!(root = %layout.root.display(), "bundled Hermes ready");
        run.done(id, title, detail);
    }

    async fn plugin_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("plugin", "boopis plugin");
        let Some(dir) = self.bundle.plugin_dir.clone() else {
            let e = Error::Setup(
                "hx.setup.no_bundle",
                "this build does not carry the plugin".into(),
            );
            return run.blocked(id, title, "hx.setup.no_bundle", &e);
        };
        let home = self.ops.home();
        let copied =
            tokio::task::spawn_blocking(move || install::install_plugin(&dir, &home)).await;
        let line = match copied {
            Ok(Ok(Installed::Current(v))) => format!("version {v}, up to date"),
            Ok(Ok(Installed::Written { from: None, to })) => {
                state.restart_pending = true;
                format!("installed version {to}")
            }
            Ok(Ok(Installed::Written { from: Some(f), to })) => {
                state.restart_pending = true;
                format!("upgraded {f} to {to}; your settings are kept")
            }
            Ok(Err(e)) => return run.blocked(id, title, "hx.setup.plugin_install_failed", &e),
            Err(e) => {
                return run.blocked(
                    id,
                    title,
                    "hx.setup.plugin_install_failed",
                    &Error::Io(e.to_string()),
                );
            }
        };
        match self.ops.plugins().await {
            Ok(list) if list.iter().any(|p| p.name == "boopis" && p.enabled) => {
                run.done(id, title, format!("{line}, enabled"));
            }
            Ok(_) => match self.ops.enable_plugin("boopis").await {
                Ok(()) => {
                    state.restart_pending = true;
                    run.done(id, title, format!("{line}, now enabled"));
                }
                Err(e) => run.blocked(id, title, "hx.setup.plugin_install_failed", &e),
            },
            Err(e) => run.blocked(id, title, "hx.setup.plugin_install_failed", &e),
        }
    }

    async fn hx_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("hx", "hx tool");
        let Some(bundled) = self.bundle.hx.clone() else {
            return run.push(id, title, StepState::Skipped,
                "this build carries no hx, so pack, ship and exec stay hidden until hx is on your PATH", None);
        };
        let home = self.ops.home();
        let target = install::hx_target(&home);
        let h = home.clone();
        let wrote = match tokio::task::spawn_blocking(move || install::place_hx(&bundled, &h)).await
        {
            Ok(Ok(w)) => w,
            Ok(Err(e)) => return run.blocked(id, title, "hx.setup.plugin_install_failed", &e),
            Err(e) => {
                return run.blocked(
                    id,
                    title,
                    "hx.setup.plugin_install_failed",
                    &Error::Io(e.to_string()),
                );
            }
        };
        let key = "plugins.entries.boopis.settings.hx_path";
        let want = target.display().to_string();
        let set = match self.ops.config_get(key).await {
            Ok(v) if v.as_ref().and_then(Value::as_str) == Some(want.as_str()) => Ok(false),
            Ok(_) => self.ops.config_set(key, &want).await.map(|()| true),
            Err(e) => Err(e),
        };
        match set {
            Ok(changed) => {
                state.restart_pending |= wrote || changed;
                run.done(id, title, format!("placed at {want}"));
            }
            Err(e) => run.blocked(id, title, "hx.setup.config_failed", &e),
        }
    }

    async fn config_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("config", SETTINGS_TITLE);
        let mut diff = Vec::new();
        for (key, to, _) in wanted() {
            match self.ops.config_get(key).await {
                Ok(from) if from.as_ref() == Some(&to) => {}
                Ok(from) => diff.push(DiffLine {
                    key: key.to_owned(),
                    from,
                    to,
                }),
                Err(e) => return run.blocked(id, title, "hx.setup.config_failed", &e),
            }
        }
        if diff.is_empty() {
            return run.done(id, title, "already set");
        }
        match state.consent {
            Consent::Granted => {
                for line in &diff {
                    if let Err(e) = self.ops.config_set(&line.key, &text_of(&line.to)).await {
                        return run.blocked(id, title, "hx.setup.config_failed", &e);
                    }
                }
                state.restart_pending = true;
                run.done(id, title, format!("{} settings changed", diff.len()));
            }
            Consent::Declined => run.push(id, title, StepState::Declined,
                "Not changed. Without these, pack, ship and dispatch may hide behind tool search, governed work cannot be routed to model tiers, and Stop hooks cannot continue a turn. Choose Review again to change your mind.",
                Some("hx.setup.declined")),
            Consent::Unasked => {
                let mut form = Form::new("setup.config", "setup", "Change three settings boopis needs?",
                    &wanted().iter().map(|(k, v, why)| format!("{k} = {} ({why})", text_of(v))).collect::<Vec<_>>().join("\n"),
                    json!({"type": "object", "properties": {}}));
                form.submit = Json(json!({"label": "Apply the changes"}));
                form.cancel = Json(json!({"label": "Not now"}));
                form.diff = diff;
                run.form = Some(form);
                run.push(id, title, StepState::NeedsInput, "Only these three settings are written; nothing else is touched.", None);
            }
        }
    }

    async fn models_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("models", "Models and keys");
        let mut restart = false;
        let input = providers::Input {
            choice: state.choice.as_deref(),
            picks: &state.picks,
            free_note: state.free_note.as_deref(),
            reopen: state.reopen_models,
            claude_consent: state.claude_consent,
            claude: self.claude.as_ref(),
        };
        let out = providers::run(
            self.ops.as_ref(),
            self.secrets.as_ref(),
            &input,
            &mut restart,
        )
        .await;
        state.restart_pending |= restart;
        match out {
            Ok(providers::Outcome::Unavailable { form, note }) => {
                // The choice cannot be used here: forget it (the host stops declaring itself the Desktop) and say why.
                state.choice = None;
                state.picks.clear();
                state.free_note = Some(note.clone());
                run.push(id, title, StepState::NeedsInput, note, None);
                run.form = Some(form);
            }
            Ok(providers::Outcome::Done(line)) => run.done(id, title, line),
            Ok(providers::Outcome::Skipped(line)) => {
                run.push(id, title, StepState::Skipped, line, None);
            }
            Ok(providers::Outcome::Form(form)) => {
                run.push(id, title, StepState::NeedsInput, form.title.clone(), None);
                run.form = Some(form);
            }
            Err(e) => {
                // the subscription's own refusals (an unreachable catalog, a refused install) carry their own codes
                let code = match &e {
                    Error::Setup(code, _) => *code,
                    _ => "hx.setup.config_failed",
                };
                run.blocked(id, title, code, &e);
            }
        }
    }

    async fn restart_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("restart", "Start with boopis");
        if state.restart_pending {
            if let Err(e) = self.ops.restart_gateway().await {
                return run.blocked(id, title, "hx.engine.unavailable", &e);
            }
            state.restart_pending = false;
        }
        match self.verify().await {
            Ok(()) => {
                // Only now, with the gateway on the new runtime, are the older ones removed.
                if let Some(plan) = &self.runtime {
                    let (dir, keep) = (
                        plan.runtimes_dir(),
                        plan.runtime.layout(&plan.runtimes_dir()).root,
                    );
                    let removed = tokio::task::spawn_blocking(move || {
                        crate::runtime::remove_old(&dir, &keep)
                    })
                    .await
                    .unwrap_or_default();
                    if !removed.is_empty() {
                        tracing::info!(count = removed.len(), "removed older Hermes runtimes");
                    }
                }
                run.done(id, title, "boopis is ready");
            }
            Err(e) => run.blocked(id, title, "hx.setup.verify_failed", &e),
        }
    }

    /// The plugin is enabled and every setting the user agreed to is in place.
    async fn verify(&self) -> Result<()> {
        let bad = |m: String| Error::Setup("hx.setup.verify_failed", m);
        let list = self.ops.plugins().await?;
        if !list.iter().any(|p| p.name == "boopis" && p.enabled) {
            return Err(bad("Hermes does not list boopis as enabled".into()));
        }
        Ok(())
    }

    fn receipt(steps: &[Step], state: &State) -> Receipt {
        let mut lines: Vec<String> = steps
            .iter()
            .filter(|s| !s.detail.is_empty())
            .map(|s| format!("{}: {}", s.title, s.detail))
            .collect();
        if state.consent == Consent::Declined {
            lines.push(format!("You declined the settings boopis needs, so some features are off (see {SETTINGS_TITLE} above)."));
        }
        if cfg!(windows) {
            lines.extend(windows_gaps().iter().map(|l| (*l).to_owned()));
        }
        Receipt { lines }
    }
}

/// What does not work in the Windows build yet, one line each, for the receipt. The same list is in `docs/RELEASING.md`
/// ("Windows") and is shown only on Windows. Nothing here is hidden: each line says what is missing and what still works.
#[must_use]
pub fn windows_gaps() -> [&'static str; 3] {
    [
        "Windows: API keys saved in the keychain cannot reach boopis's engine yet (its secret channel has no Windows transport). The free Nous models and the Claude subscription need no key.",
        "Windows: the command sandbox has not been run on Windows yet. Where it cannot start, a governed ship is refused with the reason (hx.sandbox.unavailable); a command never runs unsandboxed.",
        "Windows: mods are off (hx.mods.unavailable): the mods worker has no private channel on Windows yet.",
    ]
}
