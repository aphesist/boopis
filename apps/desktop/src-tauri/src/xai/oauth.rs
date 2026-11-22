//! The wire of the SuperGrok sign-in: the device-code flow (RFC 8628) of xAI's own `grok` CLI, with the same public client,
//! and the token refresh. Each call is one blocking HTTPS request through the ChatGPT sign-in's [`Transport`] (one HTTPS
//! client for every sign-in); the caller runs it on `spawn_blocking`. Nothing here stores anything, and no value it handles is
//! ever logged or put in an error.
//!
//! The endpoints (read in Hermes's `hermes_cli/auth_xai.py` and `auth_constants.py` at v0.23.2 and in the `pi-xai` package's
//! `xai-oauth.ts`, which agree; xAI documents the `grok` CLI's own sign-in at `auth.x.ai` and `grok login --device-auth`):
//! 1. `POST {issuer}/oauth2/device/code` (form) `client_id`, `scope` answers `{device_code, user_code, verification_uri,
//!    verification_uri_complete, expires_in, interval}`;
//! 2. the user opens the page and approves (the code is in `verification_uri_complete`, and is also shown to type);
//! 3. `POST {issuer}/oauth2/token` (form) `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `device_code`
//!    answers 400 `{"error": "authorization_pending" | "slow_down" | "expired_token" | "access_denied"}` while the user has not
//!    finished, and 200 `{access_token, refresh_token, id_token, expires_in}` once they have;
//! 4. a refresh is `POST {issuer}/oauth2/token` (form) `grant_type=refresh_token`, the refresh token and the client id. The
//!    refresh token is single-use: the answer carries the next one, which replaces it.
//!
//! A 403 anywhere is xAI's tier gate (an account whose plan may not use the OAuth surface), which signing in again cannot fix.

use serde_json::Value;

use crate::chatgpt::oauth::{BLOCKED, Reply, Transport, answered_by_network};
use crate::error::{Error, Result, kept};

pub use crate::chatgpt::oauth::{claims, lifetime};

/// xAI's sign-in service.
pub const ISSUER: &str = "https://auth.x.ai";
/// The public client of xAI's own `grok` CLI sign-in (`XAI_OAUTH_CLIENT_ID` in Hermes). Public clients have no secret; Hermes,
/// OpenCode-style plugins and `pi-xai` use this one, and xAI offers no registration for others.
pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
/// What the sign-in asks for (Hermes's `XAI_OAUTH_SCOPE`): the API, and a refresh token.
pub const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
/// The device-code grant's name.
pub const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// The shortest wait between two polls, whatever the service asks.
pub const MIN_INTERVAL_SECS: u64 = 1;
/// The wait between polls when the service names none (the `grok` CLI's own default).
pub const DEFAULT_INTERVAL_SECS: u64 = 5;
/// What `slow_down` adds to the wait (RFC 8628, section 3.5).
pub const SLOW_DOWN_SECS: u64 = 5;
/// How long a code lives when the service names no time.
pub const DEFAULT_EXPIRES_SECS: u64 = 300;

/// Where each call goes. Production uses [`Endpoints::xai`]; tests point it at a local server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    issuer: String,
}

impl Endpoints {
    /// xAI's own service.
    #[must_use]
    pub fn xai() -> Self {
        Self {
            issuer: ISSUER.to_owned(),
        }
    }

    /// Another issuer: a loopback `http` address (a test server) or an `https` one.
    ///
    /// # Errors
    /// `InvalidInput` for anything else, so a sign-in never goes to a plain-text remote address.
    pub fn at(issuer: &str) -> Result<Self> {
        let url = url::Url::parse(issuer)
            .map_err(|e| Error::InvalidInput(format!("not a sign-in address: {e}")))?;
        let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        if !(url.scheme() == "https" || (url.scheme() == "http" && loopback)) {
            return Err(Error::InvalidInput(
                "a sign-in address is https, or http on this computer".into(),
            ));
        }
        Ok(Self {
            issuer: issuer.trim_end_matches('/').to_owned(),
        })
    }

    fn device(&self) -> String {
        format!("{}/oauth2/device/code", self.issuer)
    }
    fn token(&self) -> String {
        format!("{}/oauth2/token", self.issuer)
    }
    fn revoke(&self) -> String {
        format!("{}/oauth2/revoke", self.issuer)
    }
}

/// The tokens of a signed-in account. `Debug` shows none of them.
#[derive(Clone, PartialEq, Eq)]
pub struct Tokens {
    /// The bearer the model service takes.
    pub access: String,
    /// The single-use token that gets the next access token.
    pub refresh: String,
    /// When the access token lapses (seconds since the epoch), from the answer's `expires_in`, when it named one. A token that
    /// is a JWT says so itself; this is for one that is not.
    pub expires_at: Option<u64>,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Tokens(<redacted>)")
    }
}

/// What step 1 answers: what the user sees, and what the poll needs. `Debug` leaves the poll's id out.
#[derive(Clone)]
pub struct DeviceCode {
    /// The page to open, with the code in it.
    pub verification_url: String,
    /// The code to type there when the page asks for it.
    pub user_code: String,
    secret: String,
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
    /// The user has not finished yet.
    Pending,
    /// The service asks for a slower pace.
    SlowDown,
    /// The user approved: the tokens. `Debug` shows none of them.
    Approved(Tokens),
}

fn failed(code: &'static str, message: impl Into<String>) -> Error {
    Error::Provider(code, message.into())
}

fn send(t: &dyn Transport, url: &str, body: &str) -> Result<Reply> {
    t.post(url, "application/x-www-form-urlencoded", body)
        .map_err(|e| {
            kept(
                failed(
                    "hx.provider.unreachable",
                    "boopis could not reach xAI to sign you in. Check your internet connection or proxy, then try again.",
                ),
                format!("{url}: {e}"),
            )
        })
}

/// An answer that is not the one the step expects, in plain words; what xAI actually sent goes to Diagnostics.
fn unexpected(r: &Reply, step: &str) -> Error {
    let raw = format!(
        "xAI, {step}: HTTP {}: {}",
        r.status,
        r.body.chars().take(300).collect::<String>()
    );
    let e = if answered_by_network(r) {
        failed("hx.provider.signin_blocked", BLOCKED)
    } else if r.status >= 500 {
        failed(
            "hx.provider.signin_failed",
            "xAI's sign-in service is having trouble right now. Try again in a few minutes. Nothing was saved.",
        )
    } else {
        failed(
            "hx.provider.signin_failed",
            "xAI's sign-in service sent an answer boopis could not use. Try again; if it happens again, the details are in Settings, General, Diagnostics. Nothing was saved.",
        )
    };
    kept(e, raw)
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

fn rate_limited(during: &str) -> Error {
    failed(
        "hx.provider.signin_rate_limited",
        format!("xAI is limiting sign-in requests right now{during}. Wait a minute and try again."),
    )
}

fn denied() -> Error {
    failed(
        "hx.provider.signin_denied",
        "xAI did not allow this account to use the SuperGrok sign-in. It does this for some plans whatever the subscription says. Use an xAI API key instead.",
    )
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn secs(v: &Value) -> Option<u64> {
    match v {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_u64(),
        _ => None,
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Step 1: ask for a code.
///
/// # Errors
/// `hx.provider.unreachable`, `hx.provider.signin_rate_limited` (429), `hx.provider.signin_denied` (403) or
/// `hx.provider.signin_failed`.
pub fn request_code(t: &dyn Transport, ep: &Endpoints) -> Result<DeviceCode> {
    let body = form(&[("client_id", CLIENT_ID), ("scope", SCOPE)]);
    let r = send(t, &ep.device(), &body)?;
    match r.status {
        // a web page in place of the service's JSON is the network (a firewall, a bot check), not xAI refusing an account
        _ if answered_by_network(&r) => return Err(unexpected(&r, "asking for a code")),
        200 => {}
        429 => return Err(rate_limited("")),
        403 => return Err(denied()),
        _ => return Err(unexpected(&r, "asking for a code")),
    }
    let Ok(v) = serde_json::from_str::<Value>(&r.body) else {
        return Err(unexpected(&r, "asking for a code (not JSON)"));
    };
    let (Some(device_code), Some(user_code)) =
        (str_field(&v, "device_code"), str_field(&v, "user_code"))
    else {
        return Err(unexpected(&r, "asking for a code (no code)"));
    };
    let Some(verification_url) = str_field(&v, "verification_uri_complete")
        .or_else(|| str_field(&v, "verification_uri"))
        .filter(|u| page_ok(u))
    else {
        return Err(unexpected(
            &r,
            "asking for a code (no page on x.ai to open)",
        ));
    };
    Ok(DeviceCode {
        verification_url,
        user_code,
        secret: device_code,
        interval: secs(&v["interval"])
            .unwrap_or(DEFAULT_INTERVAL_SECS)
            .max(MIN_INTERVAL_SECS),
        expires_in: secs(&v["expires_in"])
            .unwrap_or(DEFAULT_EXPIRES_SECS)
            .max(1),
    })
}

/// A page the card may offer to open: https on x.ai or one of its subdomains, or (in tests) this computer. A sign-in service
/// that names another host is not trusted to send the user there.
fn page_ok(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else {
        return false;
    };
    match (u.scheme(), u.host_str()) {
        ("https", Some(h)) => h == "x.ai" || h.ends_with(".x.ai"),
        ("http", Some("127.0.0.1" | "localhost" | "[::1]")) => true,
        _ => false,
    }
}

fn tokens_of(r: &Reply, previous_refresh: Option<&str>, what: &str) -> Result<Tokens> {
    let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
    let Some(access) = str_field(&v, "access_token") else {
        return Err(unexpected(
            r,
            &format!("the {what} answer (no access token)"),
        ));
    };
    let Some(refresh) =
        str_field(&v, "refresh_token").or_else(|| previous_refresh.map(str::to_owned))
    else {
        return Err(unexpected(
            r,
            &format!("the {what} answer (no refresh token)"),
        ));
    };
    Ok(Tokens {
        access,
        refresh,
        expires_at: secs(&v["expires_in"]).map(|s| now().saturating_add(s)),
    })
}

/// Step 3: ask once whether the user has finished.
///
/// # Errors
/// `hx.provider.unreachable`, `hx.provider.signin_rate_limited`, `hx.provider.signin_denied`, `hx.provider.signin_expired`
/// (the code lapsed), `hx.provider.signin_refused` (the user declined), or `hx.provider.signin_failed`.
pub fn poll(t: &dyn Transport, ep: &Endpoints, code: &DeviceCode) -> Result<Poll> {
    let body = form(&[
        ("grant_type", DEVICE_GRANT),
        ("client_id", CLIENT_ID),
        ("device_code", &code.secret),
    ]);
    let r = send(t, &ep.token(), &body)?;
    match r.status {
        _ if answered_by_network(&r) => Err(unexpected(&r, "waiting for you")),
        200 => tokens_of(&r, None, "sign-in").map(Poll::Approved),
        429 => Err(rate_limited(" while waiting for you")),
        403 => Err(denied()),
        400 | 401 => {
            let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
            match v["error"].as_str().unwrap_or_default() {
                "authorization_pending" => Ok(Poll::Pending),
                "slow_down" => Ok(Poll::SlowDown),
                "expired_token" => Err(failed(
                    "hx.provider.signin_expired",
                    "The code expired before the sign-in finished. Start again for a new code.",
                )),
                "access_denied" => Err(failed(
                    "hx.provider.signin_refused",
                    "The sign-in was declined on xAI's page.",
                )),
                _ => Err(unexpected(&r, "waiting for you")),
            }
        }
        _ => Err(unexpected(&r, "waiting for you")),
    }
}

/// What a refresh found.
pub enum Refreshed {
    /// New tokens (the refresh token is the next one when the service sent one, else the same).
    Tokens(Tokens),
    /// The service refused the refresh token for good (revoked, expired or already used): the user signs in again.
    Revoked,
    /// The service refused the account (403, the tier gate): signing in again cannot fix it.
    Denied,
}

/// Step 4: the next access token.
///
/// # Errors
/// `hx.provider.unreachable`, `hx.provider.signin_rate_limited` (the token is still good: try later), or
/// `hx.provider.signin_failed`.
pub fn refresh(t: &dyn Transport, ep: &Endpoints, refresh_token: &str) -> Result<Refreshed> {
    let body = form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
    ]);
    let r = send(t, &ep.token(), &body)?;
    match r.status {
        // a firewall's page is not xAI ending the sign-in: keep it, and try again later
        _ if answered_by_network(&r) => Err(unexpected(&r, "renewing the sign-in")),
        200 => tokens_of(&r, Some(refresh_token), "refresh").map(Refreshed::Tokens),
        429 => Err(rate_limited(" while renewing the sign-in")),
        403 => Ok(Refreshed::Denied),
        // OAuth's `invalid_grant` comes as 400; a revoked or reused token as 401
        400 | 401 => Ok(Refreshed::Revoked),
        _ => Err(unexpected(&r, "renewing the sign-in")),
    }
}

/// Tell xAI to forget a refresh token (RFC 7009; `revocation_endpoint` of xAI's own discovery document). Best effort: signing
/// out does not wait for it, and a token that cannot be revoked is already out of the keychain. The answer is 200 with no
/// body for any token, so it says nothing about whether it was known.
///
/// # Errors
/// `hx.provider.unreachable` when no answer came, `hx.provider.signin_failed` for any status but 200.
pub fn revoke(t: &dyn Transport, ep: &Endpoints, refresh_token: &str) -> Result<()> {
    let body = form(&[
        ("token", refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", CLIENT_ID),
    ]);
    let r = send(t, &ep.revoke(), &body)?;
    if r.status == 200 {
        Ok(())
    } else {
        Err(unexpected(&r, "ending the sign-in"))
    }
}
