//! The ChatGPT subscription's sign-in (ADR-0030, moved onto OpenAI's Sign in with ChatGPT program): boopis's own flow, run by
//! the host. The host opens the browser at OpenAI's authorization page with a loopback redirect it listens on, the person signs
//! in and allows boopis to use their ChatGPT plan, and OpenAI returns to the host with a code. The first sign-in of an
//! installation **registers boopis itself** (`dynamic_agent_client`, no application and no secret: the program is for
//! open-source apps) and keeps the issued client id; later sign-ins reuse it. The tokens go to the OS keychain and nowhere else
//! (`secret://chatgpt/access_token`, `refresh_token`, `id_token`, and `registration`, the issued client id and this
//! installation's host id).
//!
//! **Refresh stays here.** The refresh token rotates on every use, so exactly one program may hold it: the host. A background
//! task renews the access token before its hour is up ([`ChatGpt::run_refresher`]); the engine is only ever handed the access
//! token and the address to call it on, through the plugin's secret channel (`plugins/boopis/signins/chatgpt.py` gives them to
//! the runtime's credential pool, as a key it never tries to refresh).
//!
//! **People who signed in before the program** hold tokens of the Codex CLI's client. That older route is cut off (the owner's
//! decision of 21 November 2026, ADR-0030): at the next launch or check [`ChatGpt::retire_older`] takes those tokens out of the
//! keychain, and [`Status::notice`] says why and the card offers Sign in. Nothing renews them and nothing calls the address they
//! used.

pub mod callback;
pub mod oauth;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;
use tokio_util::sync::CancellationToken;

use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::refs::SecretRef;
use oauth::{Attempt, Endpoints, Exchange, Refreshed, Tokens, Transport};

/// The keychain scope of the sign-in.
pub const SCOPE: &str = "chatgpt";
/// The access token's name in the scope.
pub const ACCESS: &str = "access_token";
/// The refresh token's name in the scope.
pub const REFRESH: &str = "refresh_token";
/// The retained ID token's name in the scope (it names the account to the next sign-in).
pub const ID_TOKEN: &str = "id_token";
/// The registration's name in the scope: the issued client id and this installation's host id, as JSON.
pub const REGISTRATION: &str = "registration";
/// The address the engine calls the access token on, written beside it with the program's tokens. The plugin reads it. A
/// token with no address and no issued client is a sign-in of the older route, which is cut off.
pub const BASE_URL: &str = "base_url";

/// Where the sign-in stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "ChatgptState")]
pub enum State {
    /// No ChatGPT account is signed in.
    SignedOut,
    /// A sign-in is waiting for the person to finish in the browser.
    SigningIn,
    /// Signed in.
    SignedIn,
}

/// Where to go, and (for a flow that has one) the code to type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "ChatgptCode")]
pub struct CodeView {
    /// OpenAI's own page, free of any token: the card shows it and opens it again when the browser did not open.
    pub verification_url: String,
    /// A one-time code to type there. Empty for this flow: the page does everything, and there is nothing to type.
    pub user_code: String,
    /// When the attempt lapses, in milliseconds since the Unix epoch.
    #[specta(type = f64)]
    pub expires_at: u64,
}

/// What the Models tab and setup show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "ChatgptStatus")]
pub struct Status {
    /// Where it stands.
    pub state: State,
    /// The ChatGPT plan the account's token names (`plus`, `pro`), when it names one.
    pub plan: Option<String>,
    /// While signing in: the page to open.
    pub code: Option<CodeView>,
    /// The account's email, when OpenAI said one.
    pub account: Option<String>,
    /// One plain sentence the person should read, when there is one: why the last sign-in ended (the older route's cut-off
    /// included).
    pub notice: Option<String>,
}

/// What signing out did at OpenAI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "ChatgptSignedOut")]
pub struct SignedOut {
    /// OpenAI confirmed that it ended the renewable session. When false, the tokens are gone from this computer all the same,
    /// and the person can disconnect boopis in ChatGPT's settings.
    pub revoked: bool,
}

/// How a sign-in ended, pushed to every window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, tauri_specta::Event)]
pub struct ChatgptSigninEvent {
    /// `signed_in`, `failed`, `cancelled`, `timed_out`, or `signed_out` (OpenAI stopped accepting the saved sign-in).
    pub outcome: String,
    /// What to tell the user, in plain words; empty when signed in.
    pub message: String,
}

/// Where a [`ChatgptSigninEvent`] goes.
pub type Sink = Arc<dyn Fn(ChatgptSigninEvent) + Send + Sync>;

/// Opens a page in the person's browser (the host's opener; a recorder in tests). True when it was asked to.
pub trait Browser: Send + Sync + 'static {
    /// Open `url`.
    fn open(&self, url: &str) -> bool;
}

/// The numbers the flow runs by (from `config::Limits`).
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// How long the person has to finish in the browser.
    pub signin: Duration,
    /// Renew the access token when it has less than this left (or half its life, if that is shorter).
    pub refresh_ahead: Duration,
    /// How often the refresher looks.
    pub refresh_every: Duration,
}

/// What stays in the keychain across a sign-out: who this installation is to OpenAI, and which account it registered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Registration {
    /// The issued `oaiapp_` client id; `None` before the first sign-in (and after OpenAI forgot the client).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    client_id: Option<String>,
    /// This installation's host id (`urn:uuid:…`), chosen before the first sign-in and kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    host_id: Option<String>,
    /// The account the registration belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    /// The account's email, a hint for the next sign-in's account selector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    /// Why the last sign-in ended without the person asking: `revoked`, `client_gone` or `plan_not_allowed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ended: Option<String>,
}

struct Flow {
    code: CodeView,
    cancel: CancellationToken,
}

/// The sign-in service. One per app; it holds at most one sign-in at a time.
pub struct ChatGpt {
    store: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
    endpoints: Endpoints,
    timing: Timing,
    preferred_port: u16,
    flow: Mutex<Option<Flow>>,
    /// One refresh at a time: the refresh token rotates.
    refreshing: tokio::sync::Mutex<()>,
    sink: Option<Sink>,
    browser: Option<Arc<dyn Browser>>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Whether `access` should be renewed now: it has less than `ahead` (or half its life, if shorter) left, or it does not say.
#[must_use]
pub fn due(access: &str, ahead: Duration, at: u64) -> bool {
    let Some((exp, iat)) = oauth::lifetime(access) else {
        return true;
    };
    let mut margin = ahead.as_secs();
    if let Some(iat) = iat.filter(|i| *i < exp) {
        margin = margin.min((exp - iat) / 2);
    }
    exp <= at.saturating_add(margin)
}

fn reference(name: &str) -> SecretRef {
    SecretRef {
        scope: SCOPE.to_owned(),
        name: name.to_owned(),
    }
}

fn get(store: &dyn SecretStore, name: &str) -> Result<Option<String>> {
    let r = reference(name);
    store.get(&r.service(), &r.name)
}

fn put(store: &dyn SecretStore, name: &str, value: &str) -> Result<()> {
    let r = reference(name);
    store.set(&r.service(), &r.name, value)
}

fn del(store: &dyn SecretStore, name: &str) -> Result<()> {
    let r = reference(name);
    store.delete(&r.service(), &r.name)
}

fn read_tokens(store: &dyn SecretStore) -> Result<Option<Tokens>> {
    Ok(match (get(store, ACCESS)?, get(store, REFRESH)?) {
        (Some(access), Some(refresh)) => Some(Tokens {
            access,
            refresh,
            id: get(store, ID_TOKEN)?,
        }),
        _ => None,
    })
}

fn read_registration(store: &dyn SecretStore) -> Result<Registration> {
    // an unreadable record reads as none: the next sign-in registers anew, which is always safe
    Ok(get(store, REGISTRATION)?
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default())
}

fn write_registration(store: &dyn SecretStore, r: &Registration) -> Result<()> {
    let text = serde_json::to_string(r).map_err(|e| Error::Io(e.to_string()))?;
    put(store, REGISTRATION, &text)
}

/// The refresh token first, the access token last: a crash between the writes leaves the new refresh token, which still
/// renews, and the access token (which the plugin reads) changes only once everything it depends on is in place.
fn save_tokens(store: &dyn SecretStore, t: &Tokens) -> Result<()> {
    put(store, REFRESH, &t.refresh)?;
    if let Some(id) = &t.id {
        put(store, ID_TOKEN, id)?;
    }
    put(store, ACCESS, &t.access)
}

/// Both tokens, the retained ID token and the address leave the keychain. The registration stays (the program asks a host to
/// keep its client and host id across a sign-out).
fn forget_tokens(store: &dyn SecretStore) -> Result<()> {
    del(store, ACCESS)?;
    del(store, REFRESH)?;
    del(store, ID_TOKEN)?;
    del(store, BASE_URL)
}

/// What marks the older route: tokens in the keychain that no registration of boopis's own issued (the program's sign-in
/// writes the issued client first and the address with the tokens).
fn is_older(has_tokens: bool, reg: &Registration, has_address: bool) -> bool {
    has_tokens && reg.client_id.is_none() && !has_address
}

/// The `ended` mark of an older sign-in that was cut off.
const ENDED_OLDER: &str = "older_route";
const NOTICE_OLDER_CUT: &str = "OpenAI's Sign in with ChatGPT program replaced the older sign-in that boopis used before it, so that sign-in was ended on this computer. Sign in with ChatGPT again to use your plan.";
const NOTICE_ENDED: &str = "OpenAI no longer accepts the saved ChatGPT sign-in (it was disconnected, or it expired). Sign in again to keep using your ChatGPT plan.";
const NOTICE_PLAN: &str = "You signed in last time without letting boopis use your ChatGPT plan. Sign in again and allow it.";

impl ChatGpt {
    /// A service that keeps the tokens in `store` and reaches OpenAI through `transport`.
    #[must_use]
    pub fn new(store: Arc<dyn SecretStore>, transport: Arc<dyn Transport>, timing: Timing) -> Self {
        Self {
            store,
            transport,
            endpoints: Endpoints::openai(),
            timing,
            preferred_port: callback::PREFERRED_PORT,
            flow: Mutex::new(None),
            refreshing: tokio::sync::Mutex::new(()),
            sink: None,
            browser: None,
        }
    }

    /// Reach `endpoints` instead of OpenAI (tests).
    #[must_use]
    pub fn with_endpoints(mut self, endpoints: Endpoints) -> Self {
        self.endpoints = endpoints;
        self
    }

    /// Tell `sink` how each sign-in ended.
    #[must_use]
    pub fn with_sink(mut self, sink: Sink) -> Self {
        self.sink = Some(sink);
        self
    }

    /// Open the authorization page with `browser`.
    #[must_use]
    pub fn with_browser(mut self, browser: Arc<dyn Browser>) -> Self {
        self.browser = Some(browser);
        self
    }

    /// Listen for the redirect on `port` when it is free (tests use 0: any free port).
    #[must_use]
    pub fn with_port(mut self, port: u16) -> Self {
        self.preferred_port = port;
        self
    }

    fn emit(&self, outcome: &str, message: impl Into<String>) {
        if let Some(sink) = &self.sink {
            sink(ChatgptSigninEvent {
                outcome: outcome.to_owned(),
                message: message.into(),
            });
        }
    }

    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&dyn SecretStore, &dyn Transport) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (store, transport) = (self.store.clone(), self.transport.clone());
        tokio::task::spawn_blocking(move || f(store.as_ref(), transport.as_ref()))
            .await
            .map_err(|e| crate::error::joined(&e))?
    }

    fn waiting(&self) -> Option<CodeView> {
        self.flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(|f| f.code.clone())
    }

    /// Where the sign-in stands, from the keychain and the flow in progress. The only thing it changes is the cut-off of an
    /// older sign-in ([`ChatGpt::retire_older`]).
    ///
    /// # Errors
    /// `hx.secrets.*` when the keychain cannot be read.
    pub async fn status(&self) -> Result<Status> {
        let code = self.waiting();
        self.retire_older().await?;
        let (tokens, reg) = self
            .blocking(|s, _| Ok((read_tokens(s)?, read_registration(s)?)))
            .await?;
        let ended = match reg.ended.as_deref() {
            Some("plan_not_allowed") => Some(NOTICE_PLAN.to_owned()),
            Some(ENDED_OLDER) => Some(NOTICE_OLDER_CUT.to_owned()),
            Some(_) => Some(NOTICE_ENDED.to_owned()),
            None => None,
        };
        Ok(match (tokens, code) {
            (_, Some(code)) => Status {
                state: State::SigningIn,
                plan: None,
                code: Some(code),
                account: None,
                notice: None,
            },
            (Some(t), None) => Status {
                state: State::SignedIn,
                plan: t
                    .id
                    .as_deref()
                    .and_then(oauth::plan)
                    .or_else(|| oauth::plan(&t.access)),
                code: None,
                account: reg.email.clone(),
                notice: None,
            },
            (None, None) => Status {
                state: State::SignedOut,
                plan: None,
                code: None,
                account: None,
                notice: ended,
            },
        })
    }

    /// Cut off the older route: tokens that boopis made with the Codex CLI's client, before OpenAI's program, are removed from
    /// the keychain and the registration records why, so the next status says it once. True when it removed any. It runs at
    /// launch (the refresher's first look), at every status and before every check, so no older sign-in outlives the next
    /// look. A sign-in of the program is never touched.
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn retire_older(&self) -> Result<bool> {
        let _held = self.refreshing.lock().await;
        let retired = self
            .blocking(|s, _| {
                let tokens = read_tokens(s)?;
                let mut reg = read_registration(s)?;
                if !is_older(tokens.is_some(), &reg, get(s, BASE_URL)?.is_some()) {
                    return Ok(false);
                }
                forget_tokens(s)?;
                reg.ended = Some(ENDED_OLDER.to_owned());
                write_registration(s, &reg)?;
                Ok(true)
            })
            .await?;
        if retired {
            tracing::info!("the older ChatGPT sign-in was ended on this computer");
            self.emit("signed_out", NOTICE_OLDER_CUT);
        }
        Ok(retired)
    }

    /// Whether an account is signed in (both tokens are in the keychain).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn signed_in(&self) -> Result<bool> {
        self.retire_older().await?;
        Ok(self.blocking(|s, _| read_tokens(s)).await?.is_some())
    }

    /// Start a sign-in: listen for OpenAI's redirect, open the browser at the authorization page, and return the page's
    /// address (for the card's button); the wait runs in the background and ends with a [`ChatgptSigninEvent`]. A sign-in
    /// already waiting is returned as it is (one at a time).
    ///
    /// # Errors
    /// `hx.secrets.*`, or `hx.signin.failed` when nothing on this computer can listen for the answer.
    pub async fn start(self: &Arc<Self>) -> Result<CodeView> {
        if let Some(view) = self.waiting() {
            return Ok(view);
        }
        // the host id is chosen and kept before the first sign-in; a returning account brings its client and hints
        let (reg, id_token) = self
            .blocking(|s, _| {
                let mut reg = read_registration(s)?;
                if reg.host_id.is_none() {
                    reg.host_id = Some(oauth::new_host_id()?);
                    write_registration(s, &reg)?;
                }
                Ok((reg, get(s, ID_TOKEN)?))
            })
            .await?;
        let listener = callback::Listener::bind(self.preferred_port)
            .await
            .map_err(|e| {
                crate::error::kept(
                    Error::Setup(
                        "hx.signin.failed",
                        "boopis could not open the page your browser comes back to after signing in. Restart boopis and try again.".into(),
                    ),
                    format!("could not listen on 127.0.0.1 for OpenAI's answer: {e}"),
                )
            })?;
        let mut attempt = Attempt::new(
            listener.redirect_uri(),
            reg.host_id.clone().unwrap_or_default(),
            reg.client_id.clone(),
        )?;
        attempt.id_token_hint = id_token;
        attempt.login_hint.clone_from(&reg.email);
        attempt.force_consent = reg.ended.as_deref() == Some("plan_not_allowed");
        let opens = oauth::authorize_url(&self.endpoints, &attempt, true);
        let view = CodeView {
            verification_url: oauth::authorize_url(&self.endpoints, &attempt, false),
            user_code: String::new(),
            expires_at: (now() + self.timing.signin.as_secs()) * 1000,
        };
        let cancel = CancellationToken::new();
        {
            let mut flow = self
                .flow
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(f) = flow.as_ref() {
                return Ok(f.code.clone()); // another call won the race
            }
            *flow = Some(Flow {
                code: view.clone(),
                cancel: cancel.clone(),
            });
        }
        if let Some(browser) = &self.browser
            && !browser.open(&opens)
        {
            tracing::info!(
                "the browser was not opened for the ChatGPT sign-in; the card offers the page"
            );
        }
        let me = self.clone();
        tokio::spawn(async move {
            let (outcome, message) = me.finish(&listener, attempt, reg, &cancel).await;
            me.flow
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if outcome == "signed_in" {
                tracing::info!("signed in with ChatGPT");
            } else {
                tracing::info!(outcome, "the ChatGPT sign-in ended");
            }
            me.emit(outcome, message);
        });
        Ok(view)
    }

    /// Wait for the redirect, then finish: exchange the code, check the ID token and the granted scopes, and keep what is
    /// checked. Nothing is kept for an attempt that fails any step.
    async fn finish(
        &self,
        listener: &callback::Listener,
        attempt: Attempt,
        reg: Registration,
        cancel: &CancellationToken,
    ) -> (&'static str, String) {
        let params = match listener
            .wait(&attempt.state, self.timing.signin, cancel)
            .await
        {
            callback::Wait::Cancelled => return ("cancelled", "The sign-in was cancelled.".into()),
            callback::Wait::TimedOut => {
                return (
                    "timed_out",
                    "Your browser did not come back to boopis in time, so nothing was signed in. Start again, and finish signing in on OpenAI's page."
                        .into(),
                );
            }
            callback::Wait::Got(p) => p,
        };
        if let Some(error) = params.error.as_deref() {
            return if error == "access_denied" {
                (
                    "failed",
                    "You did not allow boopis to use your ChatGPT plan, so nothing was signed in."
                        .into(),
                )
            } else {
                (
                    "failed",
                    "OpenAI ended the sign-in without finishing it.".into(),
                )
            };
        }
        let Some(code) = params.code else {
            return (
                "failed",
                "OpenAI's answer carried no code to finish the sign-in.".into(),
            );
        };
        // a registered account keeps its client; a new registration must come back with one
        let client_id = match (attempt.client_id.as_deref(), params.client_id) {
            (Some(saved), Some(back)) if saved != back => {
                return (
                    "failed",
                    "OpenAI answered for another registration than boopis's own. Nothing was signed in.".into(),
                );
            }
            (Some(saved), _) => saved.to_owned(),
            (None, Some(issued)) => issued,
            (None, None) => {
                return (
                    "failed",
                    "OpenAI did not finish registering boopis. Nothing was signed in. Try again."
                        .into(),
                );
            }
        };
        let (ep, was_registered) = (self.endpoints.clone(), attempt.client_id.is_some());
        let work = self
            .blocking(move |s, t| complete(s, t, &ep, &client_id, &code, &attempt, &reg))
            .await;
        match work {
            Ok(Completed::Signed) => ("signed_in", String::new()),
            Ok(Completed::Refused(message)) => ("failed", message),
            Ok(Completed::Rejected) => {
                if was_registered {
                    // OpenAI does not accept the saved registration: drop it so the next try registers anew
                    let _ = self
                        .blocking(|s, _| {
                            let mut reg = read_registration(s)?;
                            reg.client_id = None;
                            reg.subject = None;
                            write_registration(s, &reg)
                        })
                        .await;
                }
                (
                    "failed",
                    "OpenAI did not accept the sign-in code. Try again.".into(),
                )
            }
            Err(e) => ("failed", crate::error::shown(e)),
        }
    }

    /// Cancel the sign-in that is waiting, if any.
    pub fn cancel(&self) {
        if let Some(f) = self
            .flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            f.cancel.cancel();
        }
    }

    /// Sign out: OpenAI is asked to end the renewable session (twice at most), then both tokens leave the keychain whatever
    /// it answered. The plugin drops the runtime's copy the next time it looks (`signins/chatgpt.py`).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn sign_out(&self) -> Result<SignedOut> {
        self.cancel();
        let _held = self.refreshing.lock().await;
        let ep = self.endpoints.clone();
        self.blocking(move |s, t| {
            let tokens = read_tokens(s)?;
            let reg = read_registration(s)?;
            let mut revoked = false;
            if let (Some(tokens), Some(client)) = (&tokens, reg.client_id.as_deref()) {
                for attempt in 0..2 {
                    match oauth::revoke(t, &ep, client, &tokens.refresh) {
                        Ok(done) => {
                            revoked = done;
                            break;
                        }
                        Err(_) if attempt == 0 => std::thread::sleep(Duration::from_millis(400)),
                        Err(_) => {}
                    }
                }
            }
            forget_tokens(s)?;
            let mut reg = reg;
            if reg.ended.take().is_some() {
                write_registration(s, &reg)?;
            }
            Ok(SignedOut { revoked })
        })
        .await
    }

    /// Renew the access token if it is due. True when it renewed. A refresh token OpenAI refuses for good signs the account
    /// out with a notice (both tokens are removed), so the Models tab says why instead of failing at every turn.
    ///
    /// # Errors
    /// `hx.secrets.*`, or `hx.signin.*` for a refresh that could not run (the tokens are kept: it is tried again later).
    pub async fn refresh_if_due(&self) -> Result<bool> {
        self.retire_older().await?;
        let _held = self.refreshing.lock().await;
        let (ep, ahead) = (self.endpoints.clone(), self.timing.refresh_ahead);
        let (renewed, ended) = self
            .blocking(move |s, t| {
                let Some(tokens) = read_tokens(s)? else {
                    return Ok((false, false));
                };
                if !due(&tokens.access, ahead, now()) {
                    return Ok((false, false));
                }
                let mut reg = read_registration(s)?;
                let Some(client) = reg.client_id.as_deref() else {
                    return Ok((false, false)); // no client of boopis's own: `retire_older` ends it
                };
                let next = oauth::refresh(t, &ep, client, &tokens.refresh, tokens.id.as_deref())?;
                match next {
                    Refreshed::Tokens(next) => {
                        save_tokens(s, &next)?;
                        Ok((true, false))
                    }
                    Refreshed::Revoked | Refreshed::ClientGone => {
                        tracing::warn!(
                            "OpenAI refused the ChatGPT refresh token; the account is signed out"
                        );
                        forget_tokens(s)?;
                        if matches!(next, Refreshed::ClientGone) {
                            reg.client_id = None;
                            reg.subject = None;
                        }
                        reg.ended = Some("revoked".into());
                        write_registration(s, &reg)?;
                        Ok((false, true))
                    }
                }
            })
            .await?;
        if ended {
            self.emit("signed_out", NOTICE_ENDED);
        }
        Ok(renewed)
    }

    /// Keep the access token fresh for as long as the app runs: look at once (the app may have been closed past its expiry),
    /// then every `refresh_every`.
    pub async fn run_refresher(self: Arc<Self>) {
        loop {
            match self.refresh_if_due().await {
                Ok(true) => tracing::info!("renewed the ChatGPT access token"),
                Ok(false) => {}
                Err(e) => tracing::warn!(
                    code = e.code(),
                    "could not renew the ChatGPT access token yet"
                ),
            }
            tokio::time::sleep(self.timing.refresh_every).await;
        }
    }
}

enum Completed {
    Signed,
    /// A step failed in a way the person can act on; nothing was kept.
    Refused(String),
    Rejected,
}

/// The blocking half of finishing a sign-in: exchange, check, keep.
fn complete(
    store: &dyn SecretStore,
    t: &dyn Transport,
    ep: &Endpoints,
    client_id: &str,
    code: &str,
    attempt: &Attempt,
    reg: &Registration,
) -> Result<Completed> {
    let (tokens, scopes) = match oauth::exchange(t, ep, client_id, code, attempt)? {
        Exchange::Tokens { tokens, scopes } => (tokens, scopes),
        Exchange::Rejected => return Ok(Completed::Rejected),
    };
    let Some(id_token) = tokens.id.as_deref() else {
        return Ok(Completed::Refused(
            "OpenAI did not send the ID token that proves who signed in. Nothing was signed in."
                .into(),
        ));
    };
    let identity = oauth::verify_id_token(t, ep, id_token, client_id, &attempt.nonce, now())?;
    if let Some(saved) = reg.subject.as_deref()
        && saved != identity.subject
    {
        // the saved registration belongs to another account: forget it, so the next sign-in registers this account
        let mut fresh = reg.clone();
        fresh.client_id = None;
        fresh.subject = None;
        write_registration(store, &fresh)?;
        return Ok(Completed::Refused(
            "That is a different ChatGPT account than the one boopis was registered with. Nothing was signed in; try again to register this account.".into(),
        ));
    }
    let mut kept = Registration {
        client_id: Some(client_id.to_owned()),
        subject: Some(identity.subject),
        email: identity.email.or_else(|| reg.email.clone()),
        ended: None,
        ..reg.clone()
    };
    if !scopes.iter().any(|s| s == oauth::PLAN_SCOPE) {
        // signed in, but the plan was not allowed: keep the registration, not the tokens, and ask for consent next time
        kept.ended = Some("plan_not_allowed".into());
        write_registration(store, &kept)?;
        return Ok(Completed::Refused(
            "You signed in, but did not allow boopis to use your ChatGPT plan, so there is nothing to use. Sign in again and allow it.".into(),
        ));
    }
    write_registration(store, &kept)?;
    put(store, BASE_URL, oauth::RESOURCE)?;
    save_tokens(store, &tokens)?;
    Ok(Completed::Signed)
}
