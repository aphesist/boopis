//! The SuperGrok sign-in (ADR-0039): boopis's own flow, run by the host, mirroring the ChatGPT sign-in (ADR-0030). The user
//! signs in with their X or xAI account through xAI's device-code sign-in (the one the `grok` CLI offers with `--device-auth`,
//! same service and public client): the host asks for a code, the card shows the page to open and the code, and the host waits
//! for xAI to approve it. Both tokens go to the OS keychain (`secret://xai/access_token`, `secret://xai/refresh_token`, and
//! `secret://xai/expires_at` for a token that does not say when it lapses) and nowhere else.
//!
//! **Refresh stays here.** The refresh token is single-use (xAI rotates it on every refresh), so exactly one program may hold
//! it: the host. A background task renews the access token before it expires ([`Xai::run_refresher`]); the engine is only ever
//! handed the access token, through the plugin's secret channel (`plugins/boopis/signins/xai.py` gives it to the runtime's
//! credential pool as a key it never tries to refresh). xAI's device-code tokens live about 15 minutes, so the host looks every
//! minute and the plugin every minute (the numbers are in [`Timing`] and the plugin's constants).
//!
//! Three ways reach Grok (`apps/shared/data/providers.json`): this sign-in (`xai.signin`), an API key (`xai.key`, the key
//! wiring of `providers`), and the user's own `grok` program (`xai.cli`, [`cli`]), offered only when this sign-in is not in
//! use (`offered_when: signin_unused`).

pub mod cli;
pub mod oauth;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;

use crate::chatgpt::oauth::Transport;
use crate::error::{Error, Result};
use crate::providers::{ProviderSigninEvent, ProviderState, ProviderStatus, SigninCode, WayKind};
use crate::secrets::SecretStore;
use crate::secrets::refs::SecretRef;
use oauth::{DeviceCode, Endpoints, Poll, Refreshed, Tokens};

/// The keychain scope of the sign-in.
pub const SCOPE: &str = "xai";
/// The access token's name in the scope.
pub const ACCESS: &str = "access_token";
/// The refresh token's name in the scope.
pub const REFRESH: &str = "refresh_token";
/// When the access token lapses, as seconds since the epoch in text (not a secret; it rides with the tokens).
pub const EXPIRES: &str = "expires_at";
/// The catalogue entry.
pub const PROVIDER: &str = "xai";
/// The way of this sign-in.
pub const WAY_SIGNIN: &str = "xai.signin";
/// The way of the API key.
pub const WAY_KEY: &str = "xai.key";
/// The way of the user's own `grok` program.
pub const WAY_CLI: &str = "xai.cli";

/// Where the sign-in stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "XaiSigninState")]
pub enum State {
    /// No xAI account is signed in.
    SignedOut,
    /// A sign-in is waiting for the user to approve it.
    SigningIn,
    /// Signed in.
    SignedIn,
}

/// The page and code the user sees, and when they lapse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeView {
    /// The page to open (xAI's own, the code in its address).
    pub verification_url: String,
    /// The one-time code, for the page that asks for it.
    pub user_code: String,
    /// When the code lapses, in milliseconds since the epoch.
    pub expires_at: u64,
}

impl From<CodeView> for SigninCode {
    fn from(c: CodeView) -> Self {
        Self {
            verification_url: c.verification_url,
            user_code: c.user_code,
            expires_at: c.expires_at,
        }
    }
}

/// Something that went wrong that the person should still see after the event is gone: a refusal of the account, or a
/// sign-in xAI ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    /// The stable code (`hx.provider.*`).
    pub code: &'static str,
    /// One plain sentence.
    pub message: String,
    /// Whether it makes the way an error (the account was refused) rather than only signed out (xAI ended the sign-in).
    pub error: bool,
}

/// What a look at the sign-in found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    /// Where it stands.
    pub state: State,
    /// While signing in: the code and its page.
    pub code: Option<CodeView>,
    /// What last went wrong, until the next sign-in starts.
    pub problem: Option<Problem>,
}

/// The numbers the flow runs by.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// The longest the host waits for the user, whatever the code's own life (xAI's code lives 30 minutes).
    pub signin: Duration,
    /// Renew the access token when it has less than this left (or half its life, if that is shorter).
    pub refresh_ahead: Duration,
    /// How often the refresher looks.
    pub refresh_every: Duration,
}

impl Timing {
    /// What the app runs by: renew ten minutes ahead (or at half a 15-minute token's life) and look every minute.
    #[must_use]
    pub const fn app() -> Self {
        Self {
            signin: Duration::from_mins(30),
            refresh_ahead: Duration::from_mins(10),
            refresh_every: Duration::from_mins(1),
        }
    }
}

/// What a due refresh did, once the tokens are kept or forgotten.
enum Renewal {
    Renewed,
    Revoked,
    Denied,
}

struct Flow {
    code: CodeView,
    cancel: CancellationToken,
}

/// The sign-in service. One per app; it holds at most one sign-in at a time.
pub struct Xai {
    store: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
    endpoints: Endpoints,
    timing: Timing,
    flow: Mutex<Option<Flow>>,
    problem: Mutex<Option<Problem>>,
    /// One refresh at a time: the refresh token is single-use.
    refreshing: tokio::sync::Mutex<()>,
    sink: Option<Arc<dyn Fn(ProviderSigninEvent) + Send + Sync>>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Whether the token should be renewed now: it has less than `ahead` (or half its life, if shorter) left. The expiry is the
/// token's own (`exp`, when it is a JWT) or the `expires_at` kept beside it; a token that says neither is due, because nothing
/// can say when it lapses.
#[must_use]
pub fn due(access: &str, expires_at: Option<u64>, ahead: Duration, at: u64) -> bool {
    let (exp, iat) = match oauth::lifetime(access) {
        Some((exp, iat)) => (exp, iat),
        None => match expires_at {
            Some(e) => (e, None),
            None => return true,
        },
    };
    let mut margin = ahead.as_secs();
    if let Some(iat) = iat.filter(|i| *i < exp) {
        margin = margin.min((exp - iat) / 2);
    }
    exp <= at.saturating_add(margin)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Xai {
    /// A service that keeps the tokens in `store` and reaches xAI through `transport`.
    #[must_use]
    pub fn new(store: Arc<dyn SecretStore>, transport: Arc<dyn Transport>, timing: Timing) -> Self {
        Self {
            store,
            transport,
            endpoints: Endpoints::xai(),
            timing,
            flow: Mutex::new(None),
            problem: Mutex::new(None),
            refreshing: tokio::sync::Mutex::new(()),
            sink: None,
        }
    }

    /// Reach `endpoints` instead of xAI (tests).
    #[must_use]
    pub fn with_endpoints(mut self, endpoints: Endpoints) -> Self {
        self.endpoints = endpoints;
        self
    }

    /// Tell `sink` how each sign-in ended.
    #[must_use]
    pub fn with_sink(mut self, sink: Arc<dyn Fn(ProviderSigninEvent) + Send + Sync>) -> Self {
        self.sink = Some(sink);
        self
    }

    fn emit(&self, outcome: &str, message: impl Into<String>) {
        if let Some(sink) = &self.sink {
            sink(ProviderSigninEvent {
                way: WAY_SIGNIN.to_owned(),
                outcome: outcome.to_owned(),
                message: message.into(),
            });
        }
    }

    fn reference(name: &str) -> SecretRef {
        SecretRef {
            scope: SCOPE.to_owned(),
            name: name.to_owned(),
        }
    }

    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&dyn SecretStore, &dyn Transport) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (store, transport) = (self.store.clone(), self.transport.clone());
        tokio::task::spawn_blocking(move || f(store.as_ref(), transport.as_ref()))
            .await
            .map_err(|e| Error::Io(e.to_string()))?
    }

    fn get(store: &dyn SecretStore, name: &str) -> Result<Option<String>> {
        let r = Self::reference(name);
        store.get(&r.service(), &r.name)
    }

    fn read(store: &dyn SecretStore) -> Result<Option<Tokens>> {
        Ok(
            match (Self::get(store, ACCESS)?, Self::get(store, REFRESH)?) {
                (Some(access), Some(refresh)) => Some(Tokens {
                    access,
                    refresh,
                    expires_at: Self::get(store, EXPIRES)?.and_then(|t| t.trim().parse().ok()),
                }),
                _ => None,
            },
        )
    }

    /// The refresh token first: a crash between the writes leaves the new refresh token, which still renews. The expiry goes
    /// before the access token for the same reason, so a token is never kept with the previous token's expiry.
    fn save(store: &dyn SecretStore, t: &Tokens) -> Result<()> {
        let set = |name: &str, value: &str| {
            let r = Self::reference(name);
            store.set(&r.service(), &r.name, value)
        };
        set(REFRESH, &t.refresh)?;
        match t.expires_at {
            Some(e) => set(EXPIRES, &e.to_string())?,
            None => Self::delete(store, EXPIRES)?,
        }
        set(ACCESS, &t.access)
    }

    fn delete(store: &dyn SecretStore, name: &str) -> Result<()> {
        let r = Self::reference(name);
        store.delete(&r.service(), &r.name)
    }

    fn forget(store: &dyn SecretStore) -> Result<()> {
        Self::delete(store, ACCESS)?;
        Self::delete(store, REFRESH)?;
        Self::delete(store, EXPIRES)
    }

    fn set_problem(&self, p: Option<Problem>) {
        *lock(&self.problem) = p;
    }

    /// Where the sign-in stands, from the keychain and the flow in progress. Changes nothing.
    ///
    /// # Errors
    /// `hx.secrets.*` when the keychain cannot be read (a locked keychain is never read as "signed out").
    pub async fn status(&self) -> Result<Status> {
        let code = lock(&self.flow).as_ref().map(|f| f.code.clone());
        let problem = lock(&self.problem).clone();
        let tokens = self.blocking(|s, _| Self::read(s)).await?;
        let state = match (&tokens, &code) {
            (_, Some(_)) => State::SigningIn,
            (Some(_), None) => State::SignedIn,
            (None, None) => State::SignedOut,
        };
        Ok(Status {
            state,
            code,
            problem: if state == State::SignedIn {
                None
            } else {
                problem
            },
        })
    }

    /// Whether an account is signed in (both tokens are in the keychain).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn signed_in(&self) -> Result<bool> {
        Ok(self.blocking(|s, _| Self::read(s)).await?.is_some())
    }

    /// The state of the `xai.signin` way, as setup and Settings draw it.
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn provider_state(&self) -> Result<ProviderState> {
        let st = self.status().await?;
        Ok(match (st.state, st.code, st.problem) {
            (State::SigningIn, Some(code), _) => {
                ProviderState::signing_in(PROVIDER, WAY_SIGNIN, code.into())
            }
            (State::SignedIn, _, _) => {
                ProviderState::connected(PROVIDER, WAY_SIGNIN, WayKind::Signin)
            }
            (_, _, Some(p)) if p.error => {
                ProviderState::error(PROVIDER, WAY_SIGNIN, WayKind::Signin, p.code, &p.message)
            }
            (_, _, p) => {
                let mut s = ProviderState::signed_out(PROVIDER, WAY_SIGNIN);
                s.detail = p.map(|p| p.message);
                s
            }
        })
    }

    /// The three ways of the lab as one coherent answer: the sign-in's state, the key's (`key`, read by the key wiring), and the
    /// user's own `grok` program's, which is left out while the sign-in is in use (`offered_when: signin_unused`, so the
    /// program is not even looked at then). Always in the catalogue's order.
    ///
    /// # Errors
    /// `hx.secrets.*` when the keychain cannot be read.
    pub async fn way_states(
        &self,
        key: ProviderState,
        grok: &dyn cli::GrokCli,
    ) -> Result<Vec<ProviderState>> {
        let signin = self.provider_state().await?;
        let in_use = matches!(
            signin.status,
            ProviderStatus::Connected | ProviderStatus::SigningIn
        );
        let mut out = vec![signin, key];
        if cli::offered(in_use) {
            out.push(cli::provider_state(&grok.probe().await));
        }
        Ok(out)
    }

    /// Start a sign-in and return the code to show; the wait for the user runs in the background and ends with a
    /// [`ProviderSigninEvent`]. A sign-in already waiting is returned as it is (one at a time).
    ///
    /// # Errors
    /// `hx.provider.unreachable`, `hx.provider.signin_*` when xAI gave no code, `hx.secrets.*` when the keychain cannot be
    /// read (no sign-in starts that could not be kept).
    pub async fn start(self: &Arc<Self>) -> Result<CodeView> {
        if let Some(f) = lock(&self.flow).as_ref() {
            return Ok(f.code.clone());
        }
        // fail closed: a keychain that cannot be read cannot keep the tokens either, so no code is asked for
        self.blocking(|s, _| Self::get(s, ACCESS).map(|_| ()))
            .await?;
        let ep = self.endpoints.clone();
        let code = self
            .blocking(move |_, t| oauth::request_code(t, &ep))
            .await?;
        let life = Duration::from_secs(code.expires_in).min(self.timing.signin);
        let view = CodeView {
            verification_url: code.verification_url.clone(),
            user_code: code.user_code.clone(),
            expires_at: (now() + life.as_secs()).saturating_mul(1000),
        };
        let cancel = CancellationToken::new();
        {
            let mut flow = lock(&self.flow);
            if let Some(f) = flow.as_ref() {
                return Ok(f.code.clone()); // another call won the race
            }
            *flow = Some(Flow {
                code: view.clone(),
                cancel: cancel.clone(),
            });
        }
        self.set_problem(None);
        let me = self.clone();
        tokio::spawn(async move {
            let (outcome, message) = me.wait(code, life, &cancel).await;
            lock(&me.flow).take();
            if outcome == "signed_in" {
                tracing::info!("signed in with xAI");
            } else {
                tracing::info!(outcome, "the xAI sign-in ended");
            }
            me.emit(outcome, message);
        });
        Ok(view)
    }

    async fn wait(
        &self,
        code: DeviceCode,
        life: Duration,
        cancel: &CancellationToken,
    ) -> (&'static str, String) {
        let deadline = tokio::time::Instant::now() + life;
        let mut every = Duration::from_secs(code.interval);
        let code = Arc::new(code);
        loop {
            tokio::select! {
                () = cancel.cancelled() => return ("cancelled", "The sign-in was cancelled.".into()),
                () = tokio::time::sleep_until(deadline) => {
                    return ("timed_out", "The code expired before the sign-in finished. Start again for a new code.".into());
                }
                () = tokio::time::sleep(every) => {}
            }
            let (ep, c) = (self.endpoints.clone(), code.clone());
            let polled = self.blocking(move |_, t| oauth::poll(t, &ep, &c)).await;
            let tokens = match polled {
                Ok(Poll::Pending) => continue,
                Ok(Poll::Approved(tokens)) => tokens,
                // `slow_down`, or a rate limit while waiting (also xAI asking for a slower pace): keep waiting, more slowly
                Ok(Poll::SlowDown) | Err(Error::Provider("hx.provider.signin_rate_limited", _)) => {
                    every += Duration::from_secs(oauth::SLOW_DOWN_SECS);
                    continue;
                }
                Err(Error::Provider("hx.provider.signin_expired", m)) => {
                    return ("timed_out", m);
                }
                Err(Error::Provider("hx.provider.signin_refused", m)) => {
                    return ("failed", m);
                }
                Err(e) => {
                    if e.code() == "hx.provider.signin_denied" {
                        self.set_problem(Some(Problem {
                            code: "hx.provider.signin_denied",
                            message: e.to_string(),
                            error: true,
                        }));
                    }
                    return ("failed", e.to_string());
                }
            };
            if cancel.is_cancelled() {
                return ("cancelled", "The sign-in was cancelled.".into());
            }
            let saved = self.blocking(move |s, _| Self::save(s, &tokens)).await;
            return match saved {
                Ok(()) => ("signed_in", String::new()),
                Err(e) => ("failed", e.to_string()),
            };
        }
    }

    /// Cancel the sign-in that is waiting, if any.
    pub fn cancel(&self) {
        if let Some(f) = lock(&self.flow).as_ref() {
            f.cancel.cancel();
        }
    }

    /// Sign out: the tokens leave the keychain, then xAI is asked to forget the refresh token (best effort: a failure is
    /// logged without any value and changes nothing). The plugin drops the runtime's copy of the access token the next time it
    /// looks (`signins/xai.py`).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn sign_out(&self) -> Result<()> {
        self.cancel();
        let _held = self.refreshing.lock().await;
        self.set_problem(None);
        let ep = self.endpoints.clone();
        self.blocking(move |s, t| {
            let held = Self::read(s)?;
            Self::forget(s)?;
            if let Some(tokens) = held
                && let Err(e) = oauth::revoke(t, &ep, &tokens.refresh)
            {
                tracing::debug!(
                    code = e.code(),
                    "xAI was not told to forget the refresh token"
                );
            }
            Ok(())
        })
        .await
    }

    /// Renew the access token if it is due. True when it renewed. A refresh token xAI refuses for good signs the account out
    /// (the tokens are removed and the way says so), and so does a refusal of the account itself (403, the tier gate), which
    /// shows as an error until the next sign-in starts.
    ///
    /// # Errors
    /// `hx.secrets.*` (nothing is asked of xAI while the keychain cannot be read), or `hx.provider.*` for a refresh that could
    /// not run (the tokens are kept: it is tried again later).
    pub async fn refresh_if_due(&self) -> Result<bool> {
        let _held = self.refreshing.lock().await;
        let (ep, ahead) = (self.endpoints.clone(), self.timing.refresh_ahead);
        let outcome = self
            .blocking(move |s, t| {
                let Some(tokens) = Self::read(s)? else {
                    return Ok(None);
                };
                if !due(&tokens.access, tokens.expires_at, ahead, now()) {
                    return Ok(None);
                }
                Ok(Some(match oauth::refresh(t, &ep, &tokens.refresh)? {
                    Refreshed::Tokens(next) => {
                        Self::save(s, &next)?;
                        Renewal::Renewed
                    }
                    Refreshed::Revoked => {
                        Self::forget(s)?;
                        Renewal::Revoked
                    }
                    Refreshed::Denied => {
                        Self::forget(s)?;
                        Renewal::Denied
                    }
                }))
            })
            .await?;
        Ok(match outcome {
            None => false,
            Some(Renewal::Renewed) => true,
            Some(Renewal::Revoked) => {
                tracing::warn!("xAI refused the refresh token; the account is signed out");
                self.set_problem(Some(Problem {
                    code: "hx.provider.signin_revoked",
                    message: "xAI ended this sign-in. Sign in again.".into(),
                    error: false,
                }));
                false
            }
            Some(Renewal::Denied) => {
                tracing::warn!("xAI refused the account on renewal (HTTP 403); signed out");
                self.set_problem(Some(Problem {
                    code: "hx.provider.signin_denied",
                    message: "xAI no longer allows this account to use the SuperGrok sign-in. An xAI API key works instead.".into(),
                    error: true,
                }));
                false
            }
        })
    }

    /// Keep the access token fresh for as long as the app runs: look at once (the app may have been closed past its expiry),
    /// then every `refresh_every`.
    pub async fn run_refresher(self: Arc<Self>) {
        loop {
            match self.refresh_if_due().await {
                Ok(true) => tracing::info!("renewed the xAI access token"),
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!(code = e.code(), "could not renew the xAI access token yet");
                }
            }
            tokio::time::sleep(self.timing.refresh_every).await;
        }
    }
}
