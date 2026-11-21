//! The wire of the GitHub Copilot sign-in: GitHub's OAuth **device flow** with the GitHub App VS Code's Copilot uses, and one
//! check that the account has Copilot. Each call is one blocking HTTPS request through the shared [`Transport`]; the caller
//! runs it on `spawn_blocking`. Nothing here stores anything, and no value it handles is ever logged or put in an error.
//!
//! What other harnesses do, and what this does (read on 21 November 2026; ADR-0039 cites the sources):
//! - **The device flow** (GitHub's documented one): `POST https://github.com/login/device/code` (`client_id`, `scope=read:user`)
//!   answers `{device_code, user_code, verification_uri, expires_in, interval}`; the person types the code at
//!   `https://github.com/login/device`; `POST https://github.com/login/oauth/access_token` (`client_id`, `device_code`,
//!   `grant_type=urn:ietf:params:oauth:grant-type:device_code`) answers `200` with `{error: authorization_pending}`,
//!   `slow_down` (five more seconds), `expired_token`, `access_denied`, … until it answers `{access_token}`.
//! - **The client id** is `Iv1.b507a08c87ecfe98`, the GitHub App of VS Code's Copilot, as the engine's own Copilot plugin
//!   (NousResearch/hermes-labs-plugins, `github-copilot`), Zed and the community tools use. It mints `ghu_` user tokens that
//!   the Copilot API exchanges for a short-lived Copilot token (the exchange is the engine plugin's: the host never holds a
//!   Copilot token). `OpenCode` runs its own OAuth app instead, under GitHub's published partnership with it; boopis has no such
//!   grant, so it uses the editor's app, as the engine does, and says so.
//! - **The check**: `GET https://api.github.com/copilot_internal/v2/token` answers 200 for an account whose plan includes
//!   Copilot and 401, 403 or 404 for one that does not. Its token is thrown away; the answer is the point.
//!
//! A GitHub token from this app does not expire and has no refresh token. If GitHub ever sends `expires_in` with one, the
//! expiry is kept and the account is signed out with a notice when it passes (renewing it would need the app's secret, which
//! boopis does not have).

use serde_json::Value;

use crate::chatgpt::oauth::{Reply, Transport};
use crate::error::{Error, Result};

/// GitHub's web host (the device flow).
pub const GITHUB: &str = "https://github.com";
/// GitHub's API host.
pub const API: &str = "https://api.github.com";
/// The GitHub App of VS Code's Copilot.
pub const CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
/// What the token may read: the profile, and nothing else (Copilot access is the plan's, not a scope).
pub const SCOPE: &str = "read:user";
/// The wait between polls when GitHub names none, and its floor.
pub const DEFAULT_INTERVAL_SECS: u64 = 5;
/// How much `slow_down` adds.
pub const SLOW_DOWN_SECS: u64 = 5;
/// GitHub's documented lifetime of a device code when the answer omits it.
pub const DEFAULT_EXPIRES_SECS: u64 = 900;
/// The editor identity the Copilot API asks of a client (the engine's plugin sends the same).
const EDITOR_VERSION: &str = "vscode/1.104.1";
const USER_AGENT: &str = "GitHubCopilotChat/0.26.7";

/// Where each call goes. Production uses [`Endpoints::github`]; tests point both at a local server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    web: String,
    api: String,
}

impl Endpoints {
    /// GitHub's own hosts.
    #[must_use]
    pub fn github() -> Self {
        Self {
            web: GITHUB.to_owned(),
            api: API.to_owned(),
        }
    }

    /// Another address for both hosts: a loopback `http` one (a test server) or an `https` one.
    ///
    /// # Errors
    /// `InvalidInput` for anything else, so a sign-in never goes to a plain-text remote address.
    pub fn at(base: &str) -> Result<Self> {
        let url = url::Url::parse(base)
            .map_err(|e| Error::InvalidInput(format!("not a sign-in address: {e}")))?;
        let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        if !(url.scheme() == "https" || (url.scheme() == "http" && loopback)) {
            return Err(Error::InvalidInput(
                "a sign-in address is https, or http on this computer".into(),
            ));
        }
        let base = base.trim_end_matches('/').to_owned();
        Ok(Self {
            web: base.clone(),
            api: base,
        })
    }

    fn device_code(&self) -> String {
        format!("{}/login/device/code", self.web)
    }
    fn access_token(&self) -> String {
        format!("{}/login/oauth/access_token", self.web)
    }
    fn copilot_token(&self) -> String {
        format!("{}/copilot_internal/v2/token", self.api)
    }
    fn user(&self) -> String {
        format!("{}/user", self.api)
    }
    /// The page the person opens to type the code, when GitHub names none.
    #[must_use]
    pub fn verification(&self) -> String {
        format!("{}/login/device", self.web)
    }
}

/// What the first step answers: what the person sees, and what the poll needs. `Debug` leaves the device code out.
#[derive(Clone)]
pub struct DeviceCode {
    /// The page to open.
    pub verification_url: String,
    /// The code to type there.
    pub user_code: String,
    grant_code: String,
    /// Seconds between polls.
    pub interval: u64,
    /// Seconds the code lives.
    pub expires_in: u64,
}

impl std::fmt::Debug for DeviceCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceCode")
            .field("verification_url", &self.verification_url)
            .field("user_code", &self.user_code)
            .field("interval", &self.interval)
            .finish_non_exhaustive()
    }
}

/// What one poll found.
pub enum Poll {
    /// The person has not finished yet.
    Pending,
    /// GitHub asked to be polled less often: the new interval.
    SlowDown(u64),
    /// The person approved. `Debug` is not derived, so the token cannot be printed.
    Approved {
        /// The GitHub token (`ghu_…`).
        token: String,
        /// Seconds it lives, when GitHub says it expires.
        expires_in: Option<u64>,
    },
    /// The person declined on GitHub's page.
    Denied,
    /// The code lapsed.
    Expired,
}

fn failed(code: &'static str, message: impl Into<String>) -> Error {
    Error::Setup(code, message.into())
}

fn unreachable_error(e: &str) -> Error {
    Error::Provider(
        "hx.provider.unreachable",
        format!("could not reach GitHub ({e}); check your internet connection"),
    )
}

fn send(t: &dyn Transport, url: &str, body: &str) -> Result<Reply> {
    t.post(url, "application/x-www-form-urlencoded", body)
        .map_err(|e| unreachable_error(&e))
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn json(r: &Reply) -> Value {
    serde_json::from_str(&r.body).unwrap_or(Value::Null)
}

/// Step 1: ask for a code.
///
/// # Errors
/// `hx.provider.unreachable`, `hx.provider.rate_limited` (429), or `hx.provider.signin_failed`.
pub fn request_code(t: &dyn Transport, ep: &Endpoints) -> Result<DeviceCode> {
    let r = send(
        t,
        &ep.device_code(),
        &form(&[("client_id", CLIENT_ID), ("scope", SCOPE)]),
    )?;
    if r.status == 429 {
        return Err(rate_limited(""));
    }
    let v = json(&r);
    if r.status != 200 || v["error"].is_string() {
        let why = match str_field(&v, "error").as_deref() {
            Some("device_flow_disabled") => {
                "GitHub says the device sign-in is turned off for this app".to_owned()
            }
            Some(e) if e.chars().all(|c| c.is_ascii_lowercase() || c == '_') => {
                format!("GitHub refused to start the sign-in ({e})")
            }
            _ => format!("GitHub answered {} when asked for a code", r.status),
        };
        return Err(failed("hx.provider.signin_failed", why));
    }
    let (Some(user_code), Some(device_code)) =
        (str_field(&v, "user_code"), str_field(&v, "device_code"))
    else {
        return Err(failed(
            "hx.provider.signin_failed",
            "GitHub did not send a code",
        ));
    };
    Ok(DeviceCode {
        verification_url: str_field(&v, "verification_uri").unwrap_or_else(|| ep.verification()),
        user_code,
        grant_code: device_code,
        interval: v["interval"]
            .as_u64()
            .unwrap_or(DEFAULT_INTERVAL_SECS)
            .max(DEFAULT_INTERVAL_SECS),
        expires_in: v["expires_in"].as_u64().unwrap_or(DEFAULT_EXPIRES_SECS),
    })
}

fn rate_limited(during: &str) -> Error {
    Error::Provider(
        "hx.provider.rate_limited",
        format!(
            "GitHub is limiting sign-in requests right now{during}. Wait a minute and try again."
        ),
    )
}

/// Step 2: ask once whether the person has finished. GitHub answers `200` for every outcome; the body says which.
///
/// # Errors
/// `hx.provider.unreachable`, `hx.provider.rate_limited`, or `hx.provider.signin_failed` for an answer that is none of the
/// documented ones.
pub fn poll(t: &dyn Transport, ep: &Endpoints, code: &DeviceCode, interval: u64) -> Result<Poll> {
    let r = send(
        t,
        &ep.access_token(),
        &form(&[
            ("client_id", CLIENT_ID),
            ("device_code", &code.grant_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ]),
    )?;
    if r.status == 429 {
        return Err(rate_limited(" while waiting for you"));
    }
    let v = json(&r);
    if let Some(token) = str_field(&v, "access_token") {
        return Ok(Poll::Approved {
            token,
            expires_in: v["expires_in"].as_u64(),
        });
    }
    match str_field(&v, "error").as_deref() {
        Some("authorization_pending") => Ok(Poll::Pending),
        Some("slow_down") => Ok(Poll::SlowDown(
            v["interval"]
                .as_u64()
                .unwrap_or(interval + SLOW_DOWN_SECS)
                .max(interval + SLOW_DOWN_SECS),
        )),
        Some("access_denied") => Ok(Poll::Denied),
        Some("expired_token") => Ok(Poll::Expired),
        _ => Err(failed(
            "hx.provider.signin_failed",
            format!("GitHub answered {} while waiting for you", r.status),
        )),
    }
}

/// Whether the account has Copilot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entitlement {
    /// GitHub issued a Copilot token: the plan includes Copilot.
    Has,
    /// GitHub refused (401, 403 or 404): signed in, but no Copilot on this account.
    No,
}

fn headers(token: &str) -> [(&str, &str); 4] {
    [
        ("Authorization", token),
        ("User-Agent", USER_AGENT),
        ("Editor-Version", EDITOR_VERSION),
        ("X-GitHub-Api-Version", "2022-11-28"),
    ]
}

/// The one check: does this GitHub token get a Copilot token? The Copilot token itself is dropped unread.
///
/// # Errors
/// `hx.provider.unreachable`, or `hx.provider.signin_failed` for a 5xx or an answer that is none of the documented ones.
pub fn entitlement(t: &dyn Transport, ep: &Endpoints, token: &str) -> Result<Entitlement> {
    let auth = format!("token {token}");
    let r = t
        .get(&ep.copilot_token(), &headers(&auth))
        .map_err(|e| unreachable_error(&e))?;
    match r.status {
        200 => Ok(Entitlement::Has),
        401 | 403 | 404 => Ok(Entitlement::No),
        429 => Err(rate_limited("")),
        s => Err(failed(
            "hx.provider.signin_failed",
            format!("GitHub answered {s} when checking for Copilot"),
        )),
    }
}

/// The account's login name, for the card (`None` when GitHub does not say: it is only a label).
#[must_use]
pub fn login(t: &dyn Transport, ep: &Endpoints, token: &str) -> Option<String> {
    let auth = format!("Bearer {token}");
    let r = t.get(&ep.user(), &headers(&auth)).ok()?;
    if r.status != 200 {
        return None;
    }
    str_field(&json(&r), "login").filter(|l| l.len() <= 64)
}

/// Whether `token` is a kind the Copilot API takes (the engine's Copilot plugin refuses any other): an OAuth or GitHub App
/// user token, or a fine-grained token.
#[must_use]
pub fn supported_token(token: &str) -> bool {
    ["gho_", "ghu_", "github_pat_"]
        .iter()
        .any(|p| token.starts_with(p))
}
