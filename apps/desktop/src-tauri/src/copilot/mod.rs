//! The GitHub Copilot subscription's sign-in (ADR-0039), mirroring `chatgpt/` (ADR-0030): boopis's own flow, run by the host.
//! The person signs in with GitHub's device flow (the host asks for a code, the card shows GitHub's page and the code, the host
//! waits for the approval), the host checks once that the account has Copilot, and the GitHub token goes to the OS keychain
//! (`secret://copilot/github_token`) and nowhere else. The engine's Copilot provider gets that token over the plugin's secret
//! channel (`plugins/boopis/signins/copilot.py` keeps one credential-pool row equal to it) and does the rest itself: it
//! exchanges the GitHub token for a short-lived Copilot token and calls the Copilot API.
//!
//! There is nothing to refresh: a token of VS Code's Copilot app does not expire. If GitHub ever sends an expiry with one it is
//! kept, and the account is signed out with a notice when it passes ([`Copilot::expire_if_due`]).

pub mod oauth;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::chatgpt::oauth::Transport;
use crate::error::{Error, Result};
use crate::providers::ProviderSigninEvent;
use crate::secrets::SecretStore;
use crate::secrets::refs::SecretRef;
use oauth::{DeviceCode, Endpoints, Entitlement, Poll};

/// The keychain scope of the sign-in.
pub const SCOPE: &str = "copilot";
/// The GitHub token's name in the scope.
pub const TOKEN: &str = "github_token";
/// The account's name in the scope: the login and the expiry, as JSON.
pub const ACCOUNT: &str = "account";
/// The way this sign-in answers to, in `providers.json`.
pub const WAY: &str = "github-copilot.signin";

/// Where the sign-in stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// No GitHub account is signed in.
    SignedOut,
    /// A sign-in is waiting for the person to type the code.
    SigningIn,
    /// Signed in.
    SignedIn,
}

/// The page to open and the code to type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeView {
    /// GitHub's own page.
    pub verification_url: String,
    /// The one-time code to type there.
    pub user_code: String,
    /// When the code lapses, in milliseconds since the Unix epoch.
    pub expires_at: u64,
}

/// What Settings shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    /// Where it stands.
    pub state: State,
    /// The GitHub login of the signed-in account, when GitHub said it.
    pub account: Option<String>,
    /// While signing in: the code and its page.
    pub code: Option<CodeView>,
    /// One plain sentence the person should read, when there is one (why the last sign-in ended).
    pub notice: Option<String>,
}

/// Where a [`ProviderSigninEvent`] goes.
pub type Sink = Arc<dyn Fn(ProviderSigninEvent) + Send + Sync>;

/// The numbers the flow runs by.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// The longest the person has to type the code (GitHub's own window is 15 minutes; the code's own `expires_in` wins when
    /// shorter).
    pub signin: Duration,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Account {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    login: Option<String>,
    /// When the token stops working, in seconds since the epoch, if GitHub said it expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
}

struct Flow {
    code: CodeView,
    cancel: CancellationToken,
}

/// The sign-in service. One per app; it holds at most one sign-in at a time.
pub struct Copilot {
    store: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
    endpoints: Endpoints,
    timing: Timing,
    flow: Mutex<Option<Flow>>,
    sink: Option<Sink>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
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

fn read(store: &dyn SecretStore) -> Result<Option<(String, Account)>> {
    let Some(token) = get(store, TOKEN)? else {
        return Ok(None);
    };
    let account = get(store, ACCOUNT)?
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    Ok(Some((token, account)))
}

/// The account first, the token last: the plugin reads the token, and finds the sign-in only once everything is in place.
fn save(store: &dyn SecretStore, token: &str, account: &Account) -> Result<()> {
    let text = serde_json::to_string(account).map_err(|e| Error::Io(e.to_string()))?;
    put(store, ACCOUNT, &text)?;
    put(store, TOKEN, token)
}

fn forget(store: &dyn SecretStore) -> Result<()> {
    del(store, TOKEN)?;
    del(store, ACCOUNT)
}

const NOTICE_EXPIRED: &str = "GitHub no longer accepts the saved Copilot sign-in (it expired). Sign in again to keep using Copilot.";

impl Copilot {
    /// A service that keeps the token in `store` and reaches GitHub through `transport`.
    #[must_use]
    pub fn new(store: Arc<dyn SecretStore>, transport: Arc<dyn Transport>, timing: Timing) -> Self {
        Self {
            store,
            transport,
            endpoints: Endpoints::github(),
            timing,
            flow: Mutex::new(None),
            sink: None,
        }
    }

    /// Reach `endpoints` instead of GitHub (tests).
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
            sink(ProviderSigninEvent {
                way: WAY.to_owned(),
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

    /// Where the sign-in stands, from the keychain and the flow in progress. Changes nothing.
    ///
    /// # Errors
    /// `hx.secrets.*` when the keychain cannot be read.
    pub async fn status(&self) -> Result<Status> {
        let code = self.waiting();
        let saved = self.blocking(|s, _| read(s)).await?;
        Ok(match (saved, code) {
            (_, Some(code)) => Status {
                state: State::SigningIn,
                account: None,
                code: Some(code),
                notice: None,
            },
            (Some((_, account)), None) if account.expires_at.is_none_or(|e| e > now()) => Status {
                state: State::SignedIn,
                account: account.login,
                code: None,
                notice: None,
            },
            (Some(_), None) => Status {
                state: State::SignedOut,
                account: None,
                code: None,
                notice: Some(NOTICE_EXPIRED.to_owned()),
            },
            (None, None) => Status {
                state: State::SignedOut,
                account: None,
                code: None,
                notice: None,
            },
        })
    }

    /// Start a sign-in and return the code to show; the wait runs in the background and ends with a [`ProviderSigninEvent`]. A
    /// sign-in already waiting is returned as it is (one at a time).
    ///
    /// # Errors
    /// `hx.secrets.*`, or `hx.provider.*` when GitHub gave no code.
    pub async fn start(self: &Arc<Self>) -> Result<CodeView> {
        if let Some(view) = self.waiting() {
            return Ok(view);
        }
        // a locked keychain stops here, before GitHub is asked for anything
        self.blocking(|s, _| read(s).map(|_| ())).await?;
        let ep = self.endpoints.clone();
        let code = self
            .blocking(move |_, t| oauth::request_code(t, &ep))
            .await?;
        let window = self.timing.signin.min(Duration::from_secs(code.expires_in));
        let view = CodeView {
            verification_url: code.verification_url.clone(),
            user_code: code.user_code.clone(),
            expires_at: (now() + window.as_secs()) * 1000,
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
            let (outcome, message) = me.wait(code, window, &cancel).await;
            me.flow
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if outcome == "signed_in" {
                tracing::info!("signed in with GitHub for Copilot");
            } else {
                tracing::info!(outcome, "the Copilot sign-in ended");
            }
            me.emit(outcome, message);
        });
        Ok(view)
    }

    async fn wait(
        &self,
        code: DeviceCode,
        window: Duration,
        cancel: &CancellationToken,
    ) -> (&'static str, String) {
        let deadline = tokio::time::Instant::now() + window;
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
            let (ep, c, secs) = (self.endpoints.clone(), code.clone(), every.as_secs());
            let polled = self
                .blocking(move |_, t| oauth::poll(t, &ep, &c, secs))
                .await;
            let (token, expires_in) = match polled {
                Ok(Poll::Pending) => continue,
                Ok(Poll::SlowDown(secs)) => {
                    every = Duration::from_secs(secs);
                    continue;
                }
                Ok(Poll::Approved { token, expires_in }) => (token, expires_in),
                Ok(Poll::Denied) => {
                    return ("cancelled", "You declined the sign-in on GitHub.".into());
                }
                Ok(Poll::Expired) => {
                    return (
                        "timed_out",
                        "The code expired before the sign-in finished. Start again for a new code."
                            .into(),
                    );
                }
                // a rate limit while waiting is GitHub asking to slow down: keep waiting, more slowly
                Err(Error::Provider("hx.provider.rate_limited", _)) => {
                    every += Duration::from_secs(oauth::SLOW_DOWN_SECS);
                    continue;
                }
                Err(e) => return ("failed", crate::error::shown(e)),
            };
            if cancel.is_cancelled() {
                return ("cancelled", "The sign-in was cancelled.".into());
            }
            let ep = self.endpoints.clone();
            let saved = self
                .blocking(move |s, t| finish(s, t, &ep, &token, expires_in))
                .await;
            return match saved {
                Ok(None) => ("signed_in", String::new()),
                Ok(Some(message)) => ("failed", message),
                Err(e) => ("failed", crate::error::shown(e)),
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

    /// Sign out: the token leaves the keychain. The plugin drops the engine's copy the next time it looks
    /// (`signins/copilot.py`). GitHub keeps the app's authorization until the person removes it at
    /// `github.com/settings/applications` (ending it from here would need the app's secret, which boopis does not have).
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn sign_out(&self) -> Result<()> {
        self.cancel();
        self.blocking(|s, _| forget(s)).await
    }

    /// Sign the account out, with a notice, if the token's expiry has passed. True when it did.
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn expire_if_due(&self) -> Result<bool> {
        let expired = self
            .blocking(|s, _| {
                let due = read(s)?.is_some_and(|(_, a)| a.expires_at.is_some_and(|e| e <= now()));
                Ok(due)
            })
            .await?;
        if expired {
            self.emit("signed_out", NOTICE_EXPIRED);
        }
        Ok(expired)
    }
}

/// The blocking half of finishing a sign-in: check what GitHub sent, check Copilot, keep. `Ok(Some(message))` is a refusal the
/// person can act on; nothing is kept for it.
fn finish(
    store: &dyn SecretStore,
    t: &dyn Transport,
    ep: &Endpoints,
    token: &str,
    expires_in: Option<u64>,
) -> Result<Option<String>> {
    if !oauth::supported_token(token) {
        return Ok(Some(
            "GitHub sent a kind of token that Copilot does not take. Nothing was signed in.".into(),
        ));
    }
    if oauth::entitlement(t, ep, token)? == Entitlement::No {
        return Ok(Some(
            "You are signed in to GitHub, but this account has no GitHub Copilot plan. Nothing was saved. Sign in with an account that has one.".into(),
        ));
    }
    let account = Account {
        login: oauth::login(t, ep, token),
        expires_at: expires_in.map(|s| now() + s),
    };
    save(store, token, &account)?;
    Ok(None)
}

impl Copilot {
    /// Keep an expiry honest for as long as the app runs: look every `every`.
    pub async fn run_watcher(self: Arc<Self>, every: Duration) {
        loop {
            if let Err(e) = self.expire_if_due().await {
                tracing::warn!(
                    code = e.code(),
                    "could not check the Copilot sign-in's expiry yet"
                );
            }
            tokio::time::sleep(every).await;
        }
    }
}
