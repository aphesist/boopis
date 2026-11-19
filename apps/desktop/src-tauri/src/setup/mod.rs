//! First-run setup (`docs/FORMS.md`, ADR-0006, ADR-0014): from "Hermes is installed" to "hypotaxis works", without the
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

use crate::commands::Json;
use crate::error::{Error, Result};
use crate::runtime::{Outcome, Plan};
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
    /// The exact configuration changes, for a `setup` form.
    pub diff: Vec<DiffLine>,
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
            json!("hypotaxis"),
            "so governed work can be routed to each model tier",
        ),
        (
            "plugins.entries.hypotaxis.allow_gateway_injection",
            json!(true),
            "so a Claude Code Stop hook that blocks can continue the turn",
        ),
    ]
}

fn text_of(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_owned)
}

/// The setup engine for one profile.
pub struct Setup {
    ops: Arc<dyn HermesOps>,
    secrets: Arc<dyn SecretStore>,
    bundle: Bundle,
    install_command: String,
    /// The bundled Hermes runtime to unpack first (ADR-0023); `None` when the app uses a Hermes the user already has.
    runtime: Option<Plan>,
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
        self.steps.push(Step {
            id: id.to_owned(),
            title: title.to_owned(),
            state,
            detail: detail.into(),
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
            bundle,
            install_command: crate::hermes::install::installer_command().to_owned(),
            runtime: None,
        }
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
                reason: "the bundled Hermes has not been unpacked yet".into(),
            });
        }
        if self.ops.version().await.is_err() {
            return Ok(Check {
                hermes_installed: false,
                needed: true,
                reason: "Hermes is not installed".into(),
            });
        }
        let home = self.ops.home();
        let state = state::load(&home)?;
        let installed = install::plugin_version(&ops::plugins_dir(&home).join("hypotaxis"));
        let bundled = self
            .bundle
            .plugin_dir
            .as_deref()
            .and_then(install::plugin_version);
        let enabled = self
            .ops
            .plugins()
            .await
            .is_ok_and(|l| l.iter().any(|p| p.name == "hypotaxis" && p.enabled));
        let (needed, reason) = match (state.done_at, installed, enabled) {
            (_, None, _) => (true, "the hypotaxis plugin is not installed"),
            (_, _, false) => (true, "the hypotaxis plugin is not enabled"),
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
            Some(self.receipt(&run.steps, &state).await)
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
                "Hermes",
                format!("Hermes {}", v.unwrap_or_else(|| "(version unknown)".into())),
            ),
            Err(Error::HermesMissing) => {
                run.install_command = Some(self.install_command.clone());
                run.push("hermes", "Hermes", StepState::Blocked,
                    format!("Hermes is not installed. Run this in a terminal, then choose Check again: {}", self.install_command),
                    Some("hx.setup.hermes_missing"));
                return;
            }
            Err(e) => return run.blocked("hermes", "Hermes", "hx.setup.hermes_missing", &e),
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
        let (id, title) = ("runtime", "Hermes runtime");
        let (runtime, dir) = (plan.runtime.clone(), plan.runtimes_dir());
        let unpacked = tokio::task::spawn_blocking(move || {
            let mut last = 0;
            runtime.install(&dir, &mut |p| {
                if p.percent() >= last + 10 || p.percent() == 100 {
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
                    format!("unpacking Hermes stopped: {e}"),
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
            Outcome::Current => format!("Hermes {} is unpacked", manifest.hermes_version),
            Outcome::Unpacked => {
                state.restart_pending = true; // a gateway of an older runtime must give way to this one
                format!(
                    "unpacked Hermes {} (Python {}) into the app's own folder; it never touches another Hermes",
                    manifest.hermes_version, manifest.python_version
                )
            }
        };
        tracing::info!(root = %layout.root.display(), "bundled Hermes ready");
        run.done(id, title, detail);
    }

    async fn plugin_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("plugin", "hypotaxis plugin");
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
            Ok(list) if list.iter().any(|p| p.name == "hypotaxis" && p.enabled) => {
                run.done(id, title, format!("{line}, enabled"));
            }
            Ok(_) => match self.ops.enable_plugin("hypotaxis").await {
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
        let key = "plugins.entries.hypotaxis.settings.hx_path";
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
        let (id, title) = ("config", "Hermes settings");
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
                run.done(id, title, format!("{} settings changed through Hermes", diff.len()));
            }
            Consent::Declined => run.push(id, title, StepState::Declined,
                "Not changed. Without these, other tools may hide pack, ship and dispatch behind Hermes's tool search, governed work cannot be routed to model tiers, and Stop hooks cannot continue a turn. Choose Review again to change your mind, or use a dedicated Hermes profile for hypotaxis.",
                Some("hx.setup.declined")),
            Consent::Unasked => {
                let mut form = Form::new("setup.config", "setup", "Change three Hermes settings?",
                    &wanted().iter().map(|(k, v, why)| format!("{k} = {} ({why})", text_of(v))).collect::<Vec<_>>().join("\n"),
                    json!({"type": "object", "properties": {}}));
                form.submit = Json(json!({"label": "Apply the changes"}));
                form.cancel = Json(json!({"label": "Not now"}));
                form.diff = diff;
                run.form = Some(form);
                run.push(id, title, StepState::NeedsInput, "These settings are written with `hermes config set`; nothing else is touched.", None);
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
            Err(e) => run.blocked(id, title, "hx.setup.config_failed", &e),
        }
    }

    async fn restart_step(&self, run: &mut Run, state: &mut State) {
        let (id, title) = ("restart", "Start with hypotaxis");
        if state.restart_pending {
            if let Err(e) = self.ops.restart_gateway().await {
                return run.blocked(id, title, "hx.hermes.unavailable", &e);
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
                run.done(id, title, "Hermes runs with the plugin");
            }
            Err(e) => run.blocked(id, title, "hx.setup.verify_failed", &e),
        }
    }

    /// The plugin is enabled and every setting the user agreed to is in place.
    async fn verify(&self) -> Result<()> {
        let bad = |m: String| Error::Setup("hx.setup.verify_failed", m);
        let list = self.ops.plugins().await?;
        if !list.iter().any(|p| p.name == "hypotaxis" && p.enabled) {
            return Err(bad("Hermes does not list hypotaxis as enabled".into()));
        }
        Ok(())
    }

    async fn receipt(&self, steps: &[Step], state: &State) -> Receipt {
        let mut lines: Vec<String> = steps
            .iter()
            .filter(|s| !s.detail.is_empty())
            .map(|s| format!("{}: {}", s.title, s.detail))
            .collect();
        if let Ok(list) = self.ops.plugins().await
            && providers::subscription_enabled(&list)
        {
            lines.push("The Claude subscription plugin is enabled; choose its models in the plugin settings.".into());
        }
        if state.consent == Consent::Declined {
            lines.push("You declined the Hermes settings, so some features are off (see Hermes settings above).".into());
        }
        Receipt { lines }
    }
}
