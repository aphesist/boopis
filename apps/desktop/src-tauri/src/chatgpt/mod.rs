//! The ChatGPT subscription's sign-in (ADR-0030): boopis's own flow, run by the host. The user signs in with their ChatGPT
//! account through OpenAI's device-code sign-in (the one the official Codex CLI uses, same service and client): the host
//! asks for a code, the card shows the page to open and the code to type, and the host waits for OpenAI to approve it. The
//! tokens go to the OS keychain (`secret://chatgpt/access_token` and `secret://chatgpt/refresh_token`) and nowhere else.
//!
//! Why the device code and not the browser's redirect: the Codex client's redirect is fixed at `localhost:1455`, which a
//! running Codex CLI sign-in may hold, and it needs a listener in the host; the code needs neither, works in any browser on
//! any device, and is the flow OpenAI's own CLI offers for exactly this case.
//!
//! **Refresh stays here.** The refresh token is single-use, so exactly one program may hold it: the host. A background task
//! renews the access token before it expires ([`ChatGpt::run_refresher`]); the engine is only ever handed the access token,
//! through the plugin's secret channel (`plugins/boopis/signins/chatgpt.py` gives it to the runtime's credential pool, as a
//! key it never tries to refresh).

pub mod oauth;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;

use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::refs::SecretRef;
use oauth::{DeviceCode, Endpoints, Poll, Refreshed, Tokens, Transport};

/// The keychain scope of the sign-in.
pub const SCOPE: &str = "chatgpt";
/// The access token's name in the scope.
pub const ACCESS: &str = "access_token";
/// The refresh token's name in the scope.
pub const REFRESH: &str = "refresh_token";

/// Where the sign-in stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "ChatgptState")]
pub enum State {
    /// No ChatGPT account is signed in.
    SignedOut,
    /// A sign-in is waiting for the user to type the code.
    SigningIn,
    /// Signed in.
    SignedIn,
}

/// The code the user types, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "ChatgptCode")]
pub struct CodeView {
    /// The page to open (OpenAI's own).
    pub verification_url: String,
    /// The one-time code to type there.
    pub user_code: String,
}

/// What the Models tab and setup show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "ChatgptStatus")]
pub struct Status {
    /// Where it stands.
    pub state: State,
    /// The ChatGPT plan the account's token names (`plus`, `pro`), when it names one.
    pub plan: Option<String>,
    /// While signing in: the code and its page.
    pub code: Option<CodeView>,
}

/// How a sign-in ended, pushed to every window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, tauri_specta::Event)]
pub struct ChatgptSigninEvent {
    /// `signed_in`, `failed`, `cancelled` or `timed_out`.
    pub outcome: String,
    /// What to tell the user, in plain words; empty when signed in.
    pub message: String,
}

/// Where a [`ChatgptSigninEvent`] goes.
pub type Sink = Arc<dyn Fn(ChatgptSigninEvent) + Send + Sync>;

/// The numbers the flow runs by (from `config::Limits`).
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// How long the user has to type the code (OpenAI's own window is 15 minutes).
    pub signin: Duration,
    /// Renew the access token when it has less than this left (or half its life, if that is shorter).
    pub refresh_ahead: Duration,
    /// How often the refresher looks.
    pub refresh_every: Duration,
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
    flow: Mutex<Option<Flow>>,
    /// One refresh at a time: the refresh token is single-use.
    refreshing: tokio::sync::Mutex<()>,
    sink: Option<Sink>,
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

impl ChatGpt {
    /// A service that keeps the tokens in `store` and reaches OpenAI through `transport`.
    #[must_use]
    pub fn new(store: Arc<dyn SecretStore>, transport: Arc<dyn Transport>, timing: Timing) -> Self {
        Self {
            store,
            transport,
            endpoints: Endpoints::openai(),
            timing,
            flow: Mutex::new(None),
            refreshing: tokio::sync::Mutex::new(()),
            sink: None,
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

    fn emit(&self, outcome: &str, message: impl Into<String>) {
        if let Some(sink) = &self.sink {
            sink(ChatgptSigninEvent {
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

    fn read(store: &dyn SecretStore) -> Result<Option<Tokens>> {
        let (a, r) = (Self::reference(ACCESS), Self::reference(REFRESH));
        Ok(
            match (
                store.get(&a.service(), &a.name)?,
                store.get(&r.service(), &r.name)?,
            ) {
                (Some(access), Some(refresh)) => Some(Tokens { access, refresh }),
                _ => None,
            },
        )
    }

    /// The refresh token first: a crash between the two writes leaves the new refresh token, which still renews.
    fn save(store: &dyn SecretStore, t: &Tokens) -> Result<()> {
        let (a, r) = (Self::reference(ACCESS), Self::reference(REFRESH));
        store.set(&r.service(), &r.name, &t.refresh)?;
        store.set(&a.service(), &a.name, &t.access)
    }

    fn forget(store: &dyn SecretStore) -> Result<()> {
        let (a, r) = (Self::reference(ACCESS), Self::reference(REFRESH));
        store.delete(&a.service(), &a.name)?;
        store.delete(&r.service(), &r.name)
    }

    /// Where the sign-in stands, from the keychain and the flow in progress. Changes nothing.
    ///
    /// # Errors
    /// `hx.secrets.*` when the keychain cannot be read.
    pub async fn status(&self) -> Result<Status> {
        let code = self
            .flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(|f| f.code.clone());
        let tokens = self.blocking(|s, _| Self::read(s)).await?;
        Ok(match (tokens, code) {
            (_, Some(code)) => Status {
                state: State::SigningIn,
                plan: None,
                code: Some(code),
            },
            (Some(t), None) => Status {
                state: State::SignedIn,
                plan: oauth::plan(&t.access),
                code: None,
            },
            (None, None) => Status {
                state: State::SignedOut,
                plan: None,
                code: None,
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

    /// Start a sign-in and return the code to show; the wait for the user runs in the background and ends with a
    /// [`ChatgptSigninEvent`]. A sign-in already waiting is returned as it is (one at a time).
    ///
    /// # Errors
    /// `hx.signin.*` when OpenAI gave no code.
    pub async fn start(self: &Arc<Self>) -> Result<CodeView> {
        if let Some(f) = self
            .flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            return Ok(f.code.clone());
        }
        let ep = self.endpoints.clone();
        let code = self
            .blocking(move |_, t| oauth::request_code(t, &ep))
            .await?;
        let view = CodeView {
            verification_url: code.verification_url.clone(),
            user_code: code.user_code.clone(),
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
        let me = self.clone();
        tokio::spawn(async move {
            let (outcome, message) = me.wait(code, &cancel).await;
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

    async fn wait(&self, code: DeviceCode, cancel: &CancellationToken) -> (&'static str, String) {
        let deadline = tokio::time::Instant::now() + self.timing.signin;
        let every = Duration::from_secs(code.interval);
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
            let (auth_code, verifier) = match polled {
                Ok(Poll::Pending) => continue,
                Ok(Poll::Approved { code, verifier }) => (code, verifier),
                // a rate limit while waiting is OpenAI asking to slow down: keep waiting, more slowly
                Err(Error::Setup("hx.signin.rate_limited", _)) => {
                    tokio::time::sleep(every).await;
                    continue;
                }
                Err(e) => return ("failed", e.to_string()),
            };
            if cancel.is_cancelled() {
                return ("cancelled", "The sign-in was cancelled.".into());
            }
            let ep = self.endpoints.clone();
            let saved = self
                .blocking(move |s, t| {
                    let tokens = oauth::exchange(t, &ep, &auth_code, &verifier)?;
                    Self::save(s, &tokens)
                })
                .await;
            return match saved {
                Ok(()) => ("signed_in", String::new()),
                Err(e) => ("failed", e.to_string()),
            };
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

    /// Sign out: both tokens leave the keychain. The plugin drops the runtime's copy of the access token the next time it
    /// looks (`signins/chatgpt.py`).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn sign_out(&self) -> Result<()> {
        self.cancel();
        let _held = self.refreshing.lock().await;
        self.blocking(|s, _| Self::forget(s)).await
    }

    /// Renew the access token if it is due. True when it renewed. A refresh token OpenAI refuses for good signs the account
    /// out (both tokens are removed), so the Models tab says "Not signed in" instead of failing at every turn.
    ///
    /// # Errors
    /// `hx.secrets.*`, or `hx.signin.*` for a refresh that could not run (the tokens are kept: it is tried again later).
    pub async fn refresh_if_due(&self) -> Result<bool> {
        let _held = self.refreshing.lock().await;
        let (ep, ahead) = (self.endpoints.clone(), self.timing.refresh_ahead);
        self.blocking(move |s, t| {
            let Some(tokens) = Self::read(s)? else {
                return Ok(false);
            };
            if !due(&tokens.access, ahead, now()) {
                return Ok(false);
            }
            match oauth::refresh(t, &ep, &tokens.refresh)? {
                Refreshed::Tokens(next) => {
                    Self::save(s, &next)?;
                    Ok(true)
                }
                Refreshed::Revoked => {
                    tracing::warn!(
                        "OpenAI refused the ChatGPT refresh token; the account is signed out"
                    );
                    Self::forget(s)?;
                    Ok(false)
                }
            }
        })
        .await
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
