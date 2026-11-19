//! The connector flow: install, test, switch on and off, remove, and sign in. Every change to Hermes goes through
//! [`McpOps`] (Hermes's own gateway methods and CLI); every key goes to the keychain and reaches Hermes by reference, through
//! the secret source the host already runs. Nothing here writes a file of Hermes's or a file of its own.
//!
//! Sign-in has two shapes. **A remote server with OAuth** is Hermes's own flow: Hermes starts it, listens on a loopback
//! address of its own (one request, the `state` checked, then closed), runs discovery, registration, PKCE and the token
//! exchange, and writes the tokens to its own store (`<hermes home>/mcp-tokens/`). The host only opens the page Hermes
//! names (after checking it), asks how the flow stands, and cancels it on request or at the timeout. **A provider's own
//! `login` command** is run exactly as shown, as an argument vector with no shell, and its result is reported.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::process::Stdio;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use super::logins::{CLAUDE_PROGRAM, HERMES_PROGRAM, LoginTable};
use super::ops::{Installed, McpOps, TestReport};
use super::plan::{self, Request, Review};
use super::validate;
use crate::config::Limits;
use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::refs::{SOURCE, SecretRef};
use crate::secrets::store::validate_value;
use crate::setup::{Step, StepState};

/// Opens a page in the user's browser. The real one is the OS opener behind `open_external`'s checks; tests record the call.
pub trait Opener: Send + Sync {
    /// Open `url`.
    ///
    /// # Errors
    /// `Os` when the system refuses.
    fn open(&self, url: &str) -> Result<()>;
}

/// When Hermes restarts to read a key that was just given.
#[derive(Debug, Clone, Copy, serde::Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case", rename = "ConnectorRestart")]
pub enum RestartWhen {
    /// At once, ending any turn that is running in an open session.
    Now,
    /// When no session has a turn running; the host waits and then restarts.
    WhenIdle,
}

/// A restart that waited for the sessions to be idle, and how it went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestartDone {
    /// The connectors that were waiting for it.
    pub names: Vec<String>,
    /// Hermes restarted and read their keys.
    pub ok: bool,
    /// What to tell the user.
    pub message: String,
}

/// Told when a deferred restart ends (the app shows it as a notice).
pub type Notifier = Arc<dyn Fn(RestartDone) + Send + Sync>;

/// What an install did.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorInstall")]
pub struct InstallReport {
    /// The name it was installed under.
    pub name: String,
    /// What happened, step by step.
    pub steps: Vec<Step>,
    /// The connection test Hermes ran; `None` when the install stopped before it.
    pub test: Option<TestReport>,
    /// The server needs the user to sign in (OAuth); the UI shows the sign-in form next.
    pub signin_needed: bool,
    /// Hermes was restarted to read the keys.
    pub restarted: bool,
    /// The restart waits until no session has a turn running; the host does it then and says so.
    pub restart_pending: bool,
    /// Plain lines the user should know.
    pub notes: Vec<String>,
}

/// What a removal did.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorRemoval")]
pub struct RemoveReport {
    /// The name removed.
    pub name: String,
    /// Keychain entries deleted (references, never values).
    pub deleted_credentials: Vec<String>,
    /// Keychain entries kept, because the user did not agree to delete them.
    pub kept_credentials: Vec<String>,
    /// Plain lines.
    pub notes: Vec<String>,
}

/// What a sign-in did.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorSignIn")]
pub struct SignInReport {
    /// The server.
    pub name: String,
    /// Where the tokens are: Hermes's own store.
    pub stored: String,
    /// The tools Hermes found once signed in.
    pub tools: Vec<String>,
    /// The connection test afterwards.
    pub test: Option<TestReport>,
}

/// What a provider's `login` command did.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorLogin")]
pub struct LoginReport {
    /// The command line exactly as it ran (display only: it ran as a vector).
    pub command_line: String,
    /// It exited with 0.
    pub ok: bool,
    /// The exit code; `None` when it was stopped by a signal or the timeout.
    pub code: Option<i32>,
    /// It was stopped for running too long.
    pub timed_out: bool,
    /// The last lines of its output, with anything that reads as a credential masked.
    pub output: Vec<String>,
}

/// The connector flow over Hermes, the keychain and the browser.
pub struct Engine {
    ops: Arc<dyn McpOps>,
    secrets: Arc<dyn SecretStore>,
    opener: Arc<dyn Opener>,
    limits: Limits,
    flows: Mutex<HashMap<String, CancellationToken>>,
    logins: LoginTable,
    notify: Option<Notifier>,
    /// Connectors whose keys wait for a restart that waits for idle sessions (one waiter for all of them).
    waiting: Arc<Mutex<Vec<String>>>,
}

fn step(id: &str, title: &str, state: StepState, detail: impl Into<String>) -> Step {
    Step {
        id: id.to_owned(),
        title: title.to_owned(),
        state,
        detail: detail.into(),
        code: None,
    }
}

/// `text` with every given secret value replaced, so a message built from Hermes's or a process's words can never carry one
/// the host just handled.
#[must_use]
pub fn scrub(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_owned();
    for s in secrets.iter().filter(|s| s.len() >= 4) {
        out = out.replace(s, "***");
    }
    out
}

impl Engine {
    /// An engine over `ops`, the keychain `secrets` and `opener`.
    #[must_use]
    pub fn new(
        ops: Arc<dyn McpOps>,
        secrets: Arc<dyn SecretStore>,
        opener: Arc<dyn Opener>,
        limits: Limits,
    ) -> Self {
        Self {
            ops,
            secrets,
            opener,
            limits,
            flows: Mutex::new(HashMap::new()),
            logins: LoginTable::shared(),
            notify: None,
            waiting: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Use `logins` as the table of sign-in commands (the shipped one by default).
    #[must_use]
    pub fn with_logins(mut self, logins: LoginTable) -> Self {
        self.logins = logins;
        self
    }

    /// Tell `notify` when a restart that waited for idle sessions ends.
    #[must_use]
    pub fn with_notifier(mut self, notify: Notifier) -> Self {
        self.notify = Some(notify);
        self
    }

    /// Every server Hermes has, with the keychain references boopis holds for each.
    ///
    /// # Errors
    /// Hermes's, or the host's if it cannot reach it.
    pub async fn list(&self) -> Result<Vec<Installed>> {
        let mut all = self.ops.list().await?;
        let wired = self.wired().await.unwrap_or_default();
        for i in &mut all {
            let scope = format!("connector.{}", i.name);
            i.secrets = wired
                .values()
                .filter(|r| SecretRef::parse(r).is_ok_and(|p| p.scope == scope))
                .cloned()
                .collect();
            i.secrets.sort();
        }
        Ok(all)
    }

    /// The `secrets.boopis_host.env` map: variable to reference.
    async fn wired(&self) -> Result<BTreeMap<String, String>> {
        let v = self
            .ops
            .config_get(&format!("secrets.{SOURCE}.env"))
            .await?;
        Ok(v.and_then(|v| v.as_object().cloned())
            .map(|o| {
                o.into_iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_owned())))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// The review of a request: the form with everything that will be added, and the hash the install must name. When the
    /// install would restart Hermes (a key is given), the form says so and how many sessions have a turn running, and offers
    /// the choice of when when any do (or when Hermes could not say).
    ///
    /// # Errors
    /// `InvalidInput`, in words, for anything the validators refuse.
    pub async fn review(&self, request: &Request) -> Result<Review> {
        let plan = plan::build(request, None)?;
        let restart = if plan.wires.is_empty() {
            None
        } else {
            Some(plan::RestartInfo {
                running: self.ops.running_turns().await.ok(),
            })
        };
        Ok(Review {
            form: plan::review_form(&plan, restart),
            plan_hash: plan.hash,
            name: plan.name,
        })
    }

    async fn store(
        &self,
        op: impl FnOnce(&dyn SecretStore) -> Result<()> + Send + 'static,
    ) -> Result<()> {
        let store = self.secrets.clone();
        tokio::task::spawn_blocking(move || op(store.as_ref()))
            .await
            .map_err(|e| Error::Secrets(e.to_string()))?
    }

    /// Install what the review showed. `plan_hash` is the review's; `secrets` are the key fields' values, which go to the
    /// keychain and nowhere else. Then Hermes tests the connection and the report says what it found.
    ///
    /// Order, so a failure leaves nothing behind: Hermes adds the server first (it validates it again), then the keys go to
    /// the keychain, then they are wired to Hermes's secret source; a failure after the add removes the server again and
    /// deletes the keys this call saved.
    ///
    /// # Errors
    /// `InvalidInput` for a plan that changed or a missing key, `hx.connectors.exists` for a name taken, Hermes's refusals,
    /// the keychain's.
    #[allow(clippy::too_many_lines)] // one linear install: check, add, keys, wires, restart, test
    pub async fn install(
        &self,
        request: &Request,
        plan_hash: &str,
        secrets: &BTreeMap<String, String>,
        restart: Option<RestartWhen>,
    ) -> Result<InstallReport> {
        let shown = plan::build(request, None)?;
        if shown.hash != plan_hash {
            return Err(Error::Connector(
                "hx.connectors.plan_changed",
                "What would be installed is not what the form showed. Review it again.".into(),
            ));
        }
        let given: BTreeSet<String> = secrets
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, _)| k.clone())
            .collect();
        for k in &given {
            if !shown.secrets.iter().any(|s| s.field == *k) {
                return Err(Error::InvalidInput(format!(
                    "{k} is not a key this connector takes"
                )));
            }
        }
        if let Some(s) = shown
            .secrets
            .iter()
            .find(|s| !s.optional && !given.contains(&s.field))
        {
            return Err(Error::Connector(
                "hx.connectors.secret_missing",
                format!("{} is needed", s.title),
            ));
        }
        let values: Vec<&str> = secrets.values().map(String::as_str).collect();
        for v in &values {
            validate_value(v)?;
        }
        let plan = plan::build(request, Some(&given))?;
        let mut steps = Vec::new();
        // A key means a restart of Hermes, which ends a turn that is running in any open session. Never silently: unless no
        // turn is running (or the user chose when), nothing is changed at all and the caller is asked to choose.
        let running = if plan.wires.is_empty() {
            Some(0)
        } else {
            self.ops.running_turns().await.ok()
        };
        if !plan.wires.is_empty() && running != Some(0) && restart.is_none() {
            return Err(Error::Connector(
                "hx.connectors.restart_choice",
                match running {
                    Some(n) => format!("{n} session{} {} a turn running. Installing the key needs a restart, which would end it: choose to restart now, or when no turn is running.", if n == 1 { "" } else { "s" }, if n == 1 { "has" } else { "have" }),
                    None => "boopis could not tell whether a turn is running. Installing the key needs a restart: choose to restart now, or when no turn is running.".to_owned(),
                },
            ));
        }

        if self.ops.list().await?.iter().any(|i| i.name == plan.name) {
            return Err(Error::Connector(
                "hx.connectors.exists",
                format!(
                    "{} is already a connector. Remove it first, or pick another name",
                    plan.name
                ),
            ));
        }
        self.ops
            .add(&plan.name, &plan.config)
            .await
            .map_err(|e| match e {
                Error::Connector(c, m) => Error::Connector(c, scrub(&m, &values)),
                other => other,
            })?;
        steps.push(step(
            "add",
            "Added",
            StepState::Done,
            format!("as {}, with boopis's connectors", plan.name),
        ));

        let mut saved: Vec<SecretRef> = Vec::new();
        for need in plan.secrets.iter().filter(|s| given.contains(&s.field)) {
            let r = SecretRef::parse(&need.reference)?;
            let value = secrets.get(&need.field).cloned().unwrap_or_default();
            let (service, account) = (r.service(), r.name.clone());
            let result = self.store(move |s| s.set(&service, &account, &value)).await;
            if let Err(e) = result {
                self.rollback(&plan.name, &saved).await;
                return Err(e);
            }
            saved.push(r);
        }
        if !saved.is_empty() {
            steps.push(step(
                "keys",
                "Keys saved",
                StepState::Done,
                "in your keychain; boopis reads them from there when the connector starts",
            ));
        }
        for (k, v) in &plan.wires {
            if let Err(e) = self.ops.config_set(k, v).await {
                self.rollback(&plan.name, &saved).await;
                return Err(e);
            }
        }

        let mut notes = Vec::new();
        let mut restarted = false;
        let mut restart_pending = false;
        if !plan.wires.is_empty() {
            // Hermes reads its secret sources once per process, so a key saved now is read when it next starts.
            let at_once = match restart {
                Some(RestartWhen::Now) => Some(true),
                _ if running == Some(0) => Some(false),
                _ => None,
            };
            let outcome = match at_once {
                Some(interrupt) => match self.ops.restart_gateway(interrupt).await {
                    Err(Error::Connector("hx.connectors.busy", _)) => None,
                    other => Some(other),
                },
                None => None,
            };
            match outcome {
                Some(Ok(())) => {
                    restarted = true;
                    steps.push(step(
                        "restart",
                        "Restarted",
                        StepState::Done,
                        "so the key is read",
                    ));
                }
                Some(Err(e)) => {
                    steps.push(step(
                        "restart",
                        "Restart",
                        StepState::Blocked,
                        crate::error::user_message(e.code(), &scrub(&e.to_string(), &values)),
                    ));
                    notes.push("boopis could not restart, so the key is not read yet. Restart boopis, then test the connector.".to_owned());
                }
                None => {
                    restart_pending = true;
                    self.wait_for_idle(&plan.name);
                    steps.push(step("restart", "Restart", StepState::Pending, "waits until no session has a turn running; boopis restarts then and tells you"));
                    notes.push("The key is saved and wired. It is read at the next restart, which boopis does when no turn is running. The connection is tested then.".to_owned());
                }
            }
        }

        let test = if restart_pending {
            None
        } else {
            match self.ops.test(&plan.name).await {
                Ok(mut t) => {
                    t.error = t.error.map(|e| scrub(&e, &values));
                    Some(t)
                }
                Err(e) => {
                    steps.push(step(
                        "test",
                        "Connection test",
                        StepState::Blocked,
                        scrub(&e.to_string(), &values),
                    ));
                    None
                }
            }
        };
        let mut signin_needed = false;
        if let Some(t) = &test {
            signin_needed = t.signin_needed || (plan.oauth && !t.ok);
            let detail = if t.ok {
                format!(
                    "connected, {} tool{}",
                    t.tools.len(),
                    if t.tools.len() == 1 { "" } else { "s" }
                )
            } else {
                t.error
                    .clone()
                    .unwrap_or_else(|| "it did not connect".into())
            };
            let state = if t.ok {
                StepState::Done
            } else if signin_needed {
                StepState::NeedsInput
            } else {
                StepState::Blocked
            };
            steps.push(step("test", "Connection test", state, detail));
        }
        notes.push(
            "New sessions use it. A session that is already open keeps the tools it started with: reloading MCP inside it resets the prompt cache, so boopis does not do that for you."
                .to_owned(),
        );
        Ok(InstallReport {
            name: plan.name,
            steps,
            test,
            signin_needed,
            restarted,
            restart_pending,
            notes,
        })
    }

    /// Queue `name` for the restart that waits until no session has a turn running; start the one waiter when none runs.
    fn wait_for_idle(&self, name: &str) {
        let first = {
            let mut w = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
            w.push(name.to_owned());
            w.len() == 1
        };
        if !first {
            return;
        }
        let (ops, notify, waiting) = (self.ops.clone(), self.notify.clone(), self.waiting.clone());
        let (every, longest) = (self.limits.restart_poll_every, self.limits.restart_wait_max);
        tokio::spawn(async move {
            let give_up = tokio::time::Instant::now() + longest;
            let outcome: std::result::Result<(), String> = loop {
                if tokio::time::Instant::now() >= give_up {
                    break Err("no moment came when no session had a turn running".to_owned());
                }
                tokio::time::sleep(every).await;
                // Only an answer that says nothing is running counts: when Hermes cannot say, the wait goes on.
                if !matches!(ops.running_turns().await, Ok(0)) {
                    continue;
                }
                // Without `--yes`, Hermes itself refuses if a turn started since the check.
                match ops.restart_gateway(false).await {
                    Ok(()) => break Ok(()),
                    Err(Error::Connector("hx.connectors.busy", _)) => {}
                    Err(e) => break Err(e.to_string()),
                }
            };
            let names =
                std::mem::take(&mut *waiting.lock().unwrap_or_else(PoisonError::into_inner));
            let message = match &outcome {
                Ok(()) => {
                    let mut lines = Vec::new();
                    for n in &names {
                        lines.push(match ops.test(n).await {
                            Ok(t) if t.ok => format!(
                                "{n} connected, {} tool{}",
                                t.tools.len(),
                                if t.tools.len() == 1 { "" } else { "s" }
                            ),
                            Ok(t) => format!(
                                "{n}: {}",
                                crate::error::unless_engine(
                                    "hx.connectors.failed",
                                    &t.error.unwrap_or_else(|| "it did not connect".into())
                                )
                            ),
                            Err(e) => format!(
                                "{n}: {}",
                                crate::error::user_message(e.code(), &e.to_string())
                            ),
                        });
                    }
                    format!("Restarted to read the key. {}", lines.join(". "))
                }
                Err(why) => {
                    crate::error::keep("hx.engine.unavailable", why);
                    "Not restarted. The key is saved; restart boopis to use it.".to_owned()
                }
            };
            if let Some(n) = notify {
                n(RestartDone {
                    names,
                    ok: outcome.is_ok(),
                    message,
                });
            }
        });
    }

    /// Undo an install that failed part of the way: the server and the keys this call saved.
    async fn rollback(&self, name: &str, saved: &[SecretRef]) {
        if let Err(e) = self.ops.remove(name).await {
            tracing::warn!(error = %e, "could not remove a connector after a failed install");
        }
        for r in saved {
            let (service, account) = (r.service(), r.name.clone());
            if let Err(e) = self.store(move |s| s.delete(&service, &account)).await {
                tracing::warn!(error = %e, "could not delete a key after a failed install");
            }
        }
    }

    async fn find(&self, name: &str) -> Result<Installed> {
        validate::existing_name(name, false)?;
        self.ops
            .list()
            .await?
            .into_iter()
            .find(|i| i.name == name)
            .ok_or_else(|| {
                Error::Connector(
                    "hx.connectors.not_found",
                    format!("there is no connector named {name}"),
                )
            })
    }

    /// Ask Hermes to connect to the server and list its tools.
    ///
    /// # Errors
    /// `hx.connectors.not_found`, or Hermes's.
    pub async fn test(&self, name: &str) -> Result<TestReport> {
        self.find(name).await?;
        self.ops.test(name).await
    }

    /// Switch a server on or off, through Hermes's own configuration command.
    ///
    /// # Errors
    /// `hx.connectors.not_found`, `hx.connectors.plugin_owned` for a plugin's server, or Hermes's.
    pub async fn set_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        validate::existing_name(name, true)?;
        let found = self.find(name).await?;
        if let Some(p) = found.plugin {
            return Err(Error::Connector(
                "hx.connectors.plugin_owned",
                format!("{name} comes from the plugin {p}; switch the plugin instead"),
            ));
        }
        self.ops.set_enabled(name, enabled).await
    }

    /// Remove a server (Hermes drops an OAuth server's tokens with it). With `delete_credentials` the keys boopis holds for it
    /// go too, from the keychain and from Hermes's secret-source wiring; without it they are kept and the report names them.
    ///
    /// # Errors
    /// `hx.connectors.not_found`, `hx.connectors.plugin_owned`, or Hermes's.
    pub async fn remove(&self, name: &str, delete_credentials: bool) -> Result<RemoveReport> {
        let found = self.find(name).await?;
        if let Some(p) = found.plugin {
            return Err(Error::Connector(
                "hx.connectors.plugin_owned",
                format!("{name} comes from the plugin {p}; remove the plugin instead"),
            ));
        }
        let scope = format!("connector.{name}");
        let held: Vec<(String, SecretRef)> = self
            .wired()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(var, r)| {
                SecretRef::parse(&r)
                    .ok()
                    .filter(|p| p.scope == scope)
                    .map(|p| (var, p))
            })
            .collect();
        self.ops.remove(name).await?;
        let mut report = RemoveReport {
            name: name.to_owned(),
            deleted_credentials: Vec::new(),
            kept_credentials: Vec::new(),
            notes: Vec::new(),
        };
        for (var, r) in held {
            if delete_credentials {
                let (service, account) = (r.service(), r.name.clone());
                self.store(move |s| s.delete(&service, &account)).await?;
                self.ops
                    .config_unset(&format!("secrets.{SOURCE}.env.{var}"))
                    .await?;
                report.deleted_credentials.push(r.text());
            } else {
                report.kept_credentials.push(r.text());
            }
        }
        if !report.kept_credentials.is_empty() {
            report.notes.push("Its keys are still in your keychain. Remove the connector again with the keys, or delete them there.".to_owned());
        }
        report.notes.push("An open session keeps the tools it started with; sessions you start now see the change.".to_owned());
        Ok(report)
    }

    fn flow_slot(&self, name: &str) -> Result<CancellationToken> {
        let mut flows = self.flows.lock().unwrap_or_else(PoisonError::into_inner);
        if flows.get(name).is_some_and(|t| !t.is_cancelled()) {
            return Err(Error::Connector(
                "hx.connectors.failed",
                format!("a sign-in to {name} is already open"),
            ));
        }
        let t = CancellationToken::new();
        flows.insert(name.to_owned(), t.clone());
        Ok(t)
    }

    fn flow_done(&self, name: &str) {
        self.flows
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(name);
    }

    /// Cancel the sign-in to `name`, if one is open.
    pub fn cancel_signin(&self, name: &str) {
        if let Some(t) = self
            .flows
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(name)
        {
            t.cancel();
        }
    }

    /// Sign in to a remote server with OAuth, through Hermes's own flow: Hermes starts it and listens for the redirect on a
    /// loopback address of its own, the host opens the page Hermes names and waits, and the tokens land in Hermes's store.
    /// The host never sees a code or a token. Ends when Hermes says the flow is approved, failed or cancelled, when the user
    /// cancels (`cancel_signin`), or at the timeout (the flow is cancelled, which closes Hermes's listener).
    ///
    /// # Errors
    /// `hx.connectors.not_oauth`, `.signin_failed` with Hermes's reason, `.signin_cancelled`, `.signin_timeout`.
    pub async fn signin(&self, name: &str) -> Result<SignInReport> {
        let found = self.find(name).await?;
        if found.url.is_none() || found.auth.as_deref() != Some("oauth") {
            return Err(Error::Connector(
                "hx.connectors.not_oauth",
                format!(
                    "{name} does not sign in with OAuth. A local program reads its key from its environment; a key goes in the connector's key field"
                ),
            ));
        }
        let cancel = self.flow_slot(name)?;
        let result = self.run_signin(name, &cancel).await;
        self.flow_done(name);
        let tools = result?;
        let test = self.ops.test(name).await.ok();
        Ok(SignInReport {
            name: name.to_owned(),
            stored: "boopis's own token store".to_owned(),
            tools,
            test,
        })
    }

    /// Begin Hermes's flow. A flow the user just cancelled is still "in progress" for a moment (Hermes's worker ends after the
    /// cancel), so that answer is retried for `Limits::connector_start_wait` instead of shown.
    async fn start_flow(
        &self,
        name: &str,
        cancel: &CancellationToken,
    ) -> Result<super::ops::OAuthStart> {
        let give_up = tokio::time::Instant::now() + self.limits.connector_start_wait;
        loop {
            match self.ops.oauth_start(name).await {
                Err(Error::Connector(_, m))
                    if m.contains("already in progress")
                        && tokio::time::Instant::now() < give_up =>
                {
                    tokio::select! {
                        () = cancel.cancelled() => return Err(Error::Connector("hx.connectors.signin_cancelled", "The sign-in was cancelled.".into())),
                        () = tokio::time::sleep(self.limits.connector_poll_every) => {}
                    }
                }
                other => return other,
            }
        }
    }

    async fn run_signin(&self, name: &str, cancel: &CancellationToken) -> Result<Vec<String>> {
        let started = self.start_flow(name, cancel).await?;
        let session = started.session_id.clone();
        let abort = |why: Error| async {
            let _ = self.ops.oauth_cancel(name, &session).await;
            Err::<Vec<String>, Error>(why)
        };
        let url = match validate::auth_url(&started.auth_url) {
            Ok(u) => u,
            Err(e) => return abort(e).await,
        };
        if let Err(e) = self.opener.open(url.as_str()) {
            return abort(e).await;
        }
        let deadline = tokio::time::Instant::now() + self.limits.connector_signin_timeout;
        loop {
            tokio::select! {
                () = cancel.cancelled() => {
                    return abort(Error::Connector("hx.connectors.signin_cancelled", "The sign-in was cancelled.".into())).await;
                }
                () = tokio::time::sleep_until(deadline) => {
                    return abort(Error::Connector("hx.connectors.signin_timeout", format!("The browser did not finish signing in to {name} in time. Try again."))).await;
                }
                () = tokio::time::sleep(self.limits.connector_poll_every) => {}
            }
            match self.ops.oauth_poll(name, &session).await? {
                super::ops::OAuthPoll::Pending => {}
                super::ops::OAuthPoll::Approved(tools) => return Ok(tools),
                super::ops::OAuthPoll::Failed(why) => {
                    let why: String = why.chars().filter(|c| !c.is_control()).take(400).collect();
                    return Err(Error::Connector("hx.connectors.signin_failed", why));
                }
            }
        }
    }

    /// Run a provider's own sign-in command. The caller names a **provider id**, never a command: the host looks it up in its
    /// own table (`apps/shared/data/logins.json`, or the named collection entry's reviewed `login`) and runs exactly that
    /// program and argument vector, as a vector with no shell, in an allowlisted environment, with a timeout and an output cap.
    /// A form's schema, written by an agent, a teammate or a mod, cannot choose what runs. The result is the exit status and
    /// the last lines of output, masked where they read as a credential.
    ///
    /// # Errors
    /// `hx.connectors.unknown_login` for a provider outside the table, `hx.connectors.command_failed` when it cannot start.
    pub async fn login(&self, provider: &str, connector: Option<&str>) -> Result<LoginReport> {
        let entry = match connector {
            Some(c) => super::catalog::load()?
                .connectors
                .iter()
                .find(|x| x.id == c)
                .and_then(|x| {
                    x.variants
                        .iter()
                        .filter_map(|v| v.login.as_ref())
                        .find(|l| l.id == provider)
                })
                .cloned(),
            None => self.logins.find(provider).cloned(),
        }
        .ok_or_else(|| {
            Error::Connector(
                "hx.connectors.unknown_login",
                "This sign-in is not one boopis knows.".into(),
            )
        })?;
        entry.check()?;
        let (program, env) = if entry.program == HERMES_PROGRAM {
            let (bin, home) = self.ops.hermes_program().await?.ok_or_else(|| {
                Error::Connector(
                    "hx.connectors.command_failed",
                    "boopis's engine is not available to run this sign-in.".into(),
                )
            })?;
            (
                bin.display().to_string(),
                vec![("HERMES_HOME".to_owned(), home.display().to_string())],
            )
        } else if entry.program == CLAUDE_PROGRAM {
            // the `claude` the Claude subscription plugin would run (its own lookup), not whichever one a bare PATH names
            let found = crate::claude::resolve(&crate::claude::child_env()).ok_or_else(|| {
                Error::Connector(
                    "hx.connectors.command_failed",
                    format!(
                        "Claude Code is not installed. Install it with `{}`, then try again.",
                        crate::claude::INSTALL_COMMAND
                    ),
                )
            })?;
            (found.display().to_string(), Vec::new())
        } else {
            (entry.program.clone(), Vec::new())
        };
        let mut report = run_login(&program, &entry.args, &env, &self.limits).await?;
        report.command_line = entry.line();
        Ok(report)
    }
}

/// Environment variables a login command may see: the allowlist Hermes's CLI runs with, plus what a browser or a terminal
/// helper needs to open the sign-in page.
pub(super) fn login_env(name: &str) -> bool {
    (crate::hermes::cli::passes_isolated(name))
        || matches!(
            name,
            "BROWSER" | "XAUTHORITY" | "DESKTOP_SESSION" | "XDG_CURRENT_DESKTOP"
        )
}

/// Mask what reads as a credential on one output line, strip escape sequences and control characters.
#[must_use]
pub fn clean_line(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // an ANSI sequence: ESC [ ... final byte
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            continue;
        }
        if !c.is_control() || c == '\t' {
            out.push(c);
        }
    }
    let low = out.to_ascii_lowercase();
    if let Some(at) = low.find("bearer ") {
        out.truncate(at + "bearer ".len());
        out.push_str("***");
        return out;
    }
    for marker in [
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "api-key",
        "authorization",
    ] {
        let mut from = 0;
        while let Some(rel) = low[from..].find(marker) {
            let end = from + rel + marker.len();
            let after = out[end..].trim_start_matches(['"', '\'', ' ']);
            if after.starts_with([':', '=']) {
                out.truncate(end);
                out.push_str(": ***");
                return out;
            }
            from = end;
        }
    }
    out
}

/// Run a program the host chose (from the table), never one a form named. `env` is added on top of the allowlist.
async fn run_login(
    command: &str,
    args: &[String],
    env: &[(String, String)],
    limits: &Limits,
) -> Result<LoginReport> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .env_clear()
        .envs(std::env::vars_os().filter(|(k, _)| k.to_str().is_some_and(login_env)))
        .envs(env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let command_line = validate::display_command(command, args);
    let mut child = cmd.spawn().map_err(|e| {
        Error::Connector(
            "hx.connectors.command_failed",
            format!("cannot run {command}: {e}. Is it installed and on your PATH?"),
        )
    })?;
    let mut out = child
        .stdout
        .take()
        .ok_or_else(|| Error::Io("no stdout".into()))?;
    let mut err = child
        .stderr
        .take()
        .ok_or_else(|| Error::Io("no stderr".into()))?;
    let cap = u64::try_from(limits.login_output_cap).unwrap_or(u64::MAX);
    let work = async {
        let (mut o, mut e) = (Vec::new(), Vec::new());
        let mut out = (&mut out).take(cap);
        let mut err = (&mut err).take(cap);
        let (ro, re) = tokio::join!(out.read_to_end(&mut o), err.read_to_end(&mut e));
        ro?;
        re?;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, o, e))
    };
    let timeout: Duration = limits.login_timeout;
    let result = tokio::time::timeout(timeout, work).await;
    let lines = |o: &[u8]| {
        String::from_utf8_lossy(o)
            .lines()
            .map(clean_line)
            .filter(|l| !l.trim().is_empty())
            .collect::<Vec<_>>()
    };
    match result {
        Err(_) => Ok(LoginReport {
            command_line,
            ok: false,
            code: None,
            timed_out: true,
            output: vec![format!(
                "It was stopped after {} minutes without finishing.",
                timeout.as_secs() / 60
            )],
        }),
        Ok(Err(e)) => Err(Error::from(e)),
        Ok(Ok((status, o, e))) => {
            let mut all = lines(&o);
            all.extend(lines(&e));
            let keep = all.len().saturating_sub(limits.login_output_lines);
            Ok(LoginReport {
                command_line,
                ok: status.success(),
                code: status.code(),
                timed_out: false,
                output: all.split_off(keep),
            })
        }
    }
}
