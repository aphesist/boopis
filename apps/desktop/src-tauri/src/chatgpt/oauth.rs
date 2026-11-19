//! The wire of the ChatGPT sign-in: the device-code flow of OpenAI's own Codex sign-in, with the same service and client,
//! and the token refresh. Each call is one blocking HTTPS request through [`Transport`]; the caller runs it on
//! `spawn_blocking`. Nothing here stores anything, and no value it handles is ever logged or put in an error.
//!
//! The endpoints (read in the official Codex CLI's `codex-rs/login/src/device_code_auth.rs` and in Hermes's
//! `hermes_cli/auth_codex.py`, which agree):
//! 1. `POST {issuer}/api/accounts/deviceauth/usercode` `{"client_id"}` answers `{device_auth_id, user_code, interval}`
//!    (`interval` is a string of seconds);
//! 2. the user opens `{issuer}/codex/device` and types the code;
//! 3. `POST {issuer}/api/accounts/deviceauth/token` `{device_auth_id, user_code}` answers 403 or 404 while the user has not
//!    finished, and 200 `{authorization_code, code_verifier}` once they have;
//! 4. `POST {issuer}/oauth/token` (form) `grant_type=authorization_code`, the code, `redirect_uri={issuer}/deviceauth/callback`,
//!    the client id and the verifier answers `{access_token, refresh_token, id_token}`;
//! 5. a refresh is `POST {issuer}/oauth/token` (form) `grant_type=refresh_token`, the refresh token and the client id. The
//!    refresh token is single-use: the answer may carry the next one, which replaces it.

use serde_json::{Value, json};

use crate::error::{Error, Result};

/// OpenAI's sign-in service.
pub const ISSUER: &str = "https://auth.openai.com";
/// The public client of OpenAI's Codex sign-in (`CODEX_OAUTH_CLIENT_ID` in Hermes, `CLIENT_ID` in the Codex CLI).
pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
/// The shortest wait between two polls, whatever the service asks (Hermes's floor).
pub const MIN_INTERVAL_SECS: u64 = 3;
/// The wait between polls when the service names none.
pub const DEFAULT_INTERVAL_SECS: u64 = 5;

/// Where each call goes. Production uses [`Endpoints::openai`]; tests point it at a local server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    issuer: String,
}

impl Endpoints {
    /// OpenAI's own service.
    #[must_use]
    pub fn openai() -> Self {
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

    fn usercode(&self) -> String {
        format!("{}/api/accounts/deviceauth/usercode", self.issuer)
    }
    fn poll(&self) -> String {
        format!("{}/api/accounts/deviceauth/token", self.issuer)
    }
    fn token(&self) -> String {
        format!("{}/oauth/token", self.issuer)
    }
    fn redirect(&self) -> String {
        format!("{}/deviceauth/callback", self.issuer)
    }
    /// The page the user opens to type the code.
    #[must_use]
    pub fn verification(&self) -> String {
        format!("{}/codex/device", self.issuer)
    }
}

/// One HTTP answer: the status and the body (read up to a cap).
#[derive(Debug, Clone)]
pub struct Reply {
    /// The HTTP status.
    pub status: u16,
    /// The body as text.
    pub body: String,
}

/// How a request leaves the computer. Blocking: run it on `spawn_blocking`.
pub trait Transport: Send + Sync + 'static {
    /// `POST url` with `content_type` and `body`. `Err` only when no answer came (network, TLS, timeout), with a message
    /// that carries no request data.
    ///
    /// # Errors
    /// The message of the failure.
    fn post(&self, url: &str, content_type: &str, body: &str)
    -> std::result::Result<Reply, String>;
}

/// The real transport: `ureq` over rustls, with the operating system's trust store, a whole-request timeout and a cap on
/// the body (Hermes caps the same answers at 1 MiB).
pub struct Https {
    agent: ureq::Agent,
}

/// The largest answer body read.
const MAX_BODY: u64 = 1024 * 1024;

impl Https {
    /// An agent whose every request ends within `timeout`.
    #[must_use]
    pub fn new(timeout: std::time::Duration) -> Self {
        let tls = ureq::tls::TlsConfig::builder()
            .provider(ureq::tls::TlsProvider::Rustls)
            .root_certs(ureq::tls::RootCerts::PlatformVerifier)
            .build();
        let agent = ureq::Agent::config_builder()
            .tls_config(tls)
            .http_status_as_error(false)
            .timeout_global(Some(timeout))
            .user_agent(concat!("boopis/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        Self { agent }
    }
}

impl Transport for Https {
    fn post(
        &self,
        url: &str,
        content_type: &str,
        body: &str,
    ) -> std::result::Result<Reply, String> {
        let mut resp = self
            .agent
            .post(url)
            .header("Content-Type", content_type)
            .header("Accept", "application/json")
            .send(body)
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let body = resp
            .body_mut()
            .with_config()
            .limit(MAX_BODY)
            .read_to_string()
            .map_err(|e| e.to_string())?;
        Ok(Reply { status, body })
    }
}

/// What step 1 answers: what the user sees, and what the poll needs. `Debug` leaves the poll's id out.
#[derive(Clone)]
pub struct DeviceCode {
    /// The page to open.
    pub verification_url: String,
    /// The code to type there.
    pub user_code: String,
    device_auth_id: String,
    /// Seconds between polls.
    pub interval: u64,
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
    /// The user approved: what the exchange needs. `Debug` is not derived, so it cannot be printed.
    Approved {
        /// The authorization code.
        code: String,
        /// The PKCE verifier the service made for this flow.
        verifier: String,
    },
}

/// The tokens of a signed-in account. `Debug` shows none of them.
#[derive(Clone, PartialEq, Eq)]
pub struct Tokens {
    /// The bearer the model service takes.
    pub access: String,
    /// The single-use token that gets the next access token.
    pub refresh: String,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Tokens(<redacted>)")
    }
}

fn failed(code: &'static str, message: impl Into<String>) -> Error {
    Error::Setup(code, message.into())
}

fn send(t: &dyn Transport, url: &str, content_type: &str, body: &str) -> Result<Reply> {
    t.post(url, content_type, body).map_err(|e| {
        failed(
            "hx.signin.unreachable",
            format!(
                "could not reach OpenAI's sign-in service ({e}); check your internet connection"
            ),
        )
    })
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
        "hx.signin.rate_limited",
        format!(
            "OpenAI is limiting sign-in requests right now{during}. Wait a minute and try again."
        ),
    )
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Step 1: ask for a code.
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited` (429), `hx.signin.unsupported` (404: the service has no device sign-in
/// for this client), or `hx.signin.failed`.
pub fn request_code(t: &dyn Transport, ep: &Endpoints) -> Result<DeviceCode> {
    let body = json!({"client_id": CLIENT_ID}).to_string();
    let r = send(t, &ep.usercode(), "application/json", &body)?;
    match r.status {
        200 => {}
        429 => return Err(rate_limited("")),
        404 => {
            return Err(failed(
                "hx.signin.unsupported",
                "OpenAI's sign-in service does not offer sign-in with a code here",
            ));
        }
        s => {
            return Err(failed(
                "hx.signin.failed",
                format!("OpenAI's sign-in service answered {s} when asked for a code"),
            ));
        }
    }
    let v: Value = serde_json::from_str(&r.body).map_err(|_| {
        failed(
            "hx.signin.failed",
            "OpenAI's sign-in service sent an answer that is not JSON",
        )
    })?;
    let (Some(user_code), Some(device_auth_id)) = (
        str_field(&v, "user_code").or_else(|| str_field(&v, "usercode")),
        str_field(&v, "device_auth_id"),
    ) else {
        return Err(failed(
            "hx.signin.failed",
            "OpenAI's sign-in service did not send a code",
        ));
    };
    let interval = match &v["interval"] {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_u64(),
        _ => None,
    }
    .unwrap_or(DEFAULT_INTERVAL_SECS)
    .max(MIN_INTERVAL_SECS);
    Ok(DeviceCode {
        verification_url: ep.verification(),
        user_code,
        device_auth_id,
        interval,
    })
}

/// Step 3: ask once whether the user has finished.
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited`, or `hx.signin.failed` for any other answer.
pub fn poll(t: &dyn Transport, ep: &Endpoints, code: &DeviceCode) -> Result<Poll> {
    let body =
        json!({"device_auth_id": code.device_auth_id, "user_code": code.user_code}).to_string();
    let r = send(t, &ep.poll(), "application/json", &body)?;
    match r.status {
        403 | 404 => Ok(Poll::Pending),
        429 => Err(rate_limited(" while waiting for you")),
        200 => {
            let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
            match (
                str_field(&v, "authorization_code"),
                str_field(&v, "code_verifier"),
            ) {
                (Some(code), Some(verifier)) => Ok(Poll::Approved { code, verifier }),
                _ => Err(failed(
                    "hx.signin.failed",
                    "OpenAI approved the sign-in but sent no code to finish it",
                )),
            }
        }
        s => Err(failed(
            "hx.signin.failed",
            format!("OpenAI's sign-in service answered {s} while waiting for you"),
        )),
    }
}

fn tokens_of(r: &Reply, previous_refresh: Option<&str>, what: &str) -> Result<Tokens> {
    let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
    let Some(access) = str_field(&v, "access_token") else {
        return Err(failed(
            "hx.signin.failed",
            format!("OpenAI's {what} answer carried no access token"),
        ));
    };
    let Some(refresh) =
        str_field(&v, "refresh_token").or_else(|| previous_refresh.map(str::to_owned))
    else {
        return Err(failed(
            "hx.signin.failed",
            format!("OpenAI's {what} answer carried no refresh token"),
        ));
    };
    Ok(Tokens { access, refresh })
}

/// Step 4: trade the approved code for tokens.
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited`, or `hx.signin.failed`.
pub fn exchange(t: &dyn Transport, ep: &Endpoints, code: &str, verifier: &str) -> Result<Tokens> {
    let redirect = ep.redirect();
    let body = form(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &redirect),
        ("client_id", CLIENT_ID),
        ("code_verifier", verifier),
    ]);
    let r = send(t, &ep.token(), "application/x-www-form-urlencoded", &body)?;
    match r.status {
        200 => tokens_of(&r, None, "sign-in"),
        429 => Err(rate_limited(" while finishing the sign-in")),
        s => Err(failed(
            "hx.signin.failed",
            format!("OpenAI's sign-in service answered {s} when finishing the sign-in"),
        )),
    }
}

/// What a refresh found.
pub enum Refreshed {
    /// New tokens (the refresh token is the next one when the service sent one, else the same).
    Tokens(Tokens),
    /// The service refused the refresh token for good (revoked, expired or already used): the user signs in again.
    Revoked,
}

/// Step 5: the next access token.
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited` (the token is still good: try later), or `hx.signin.failed`.
pub fn refresh(t: &dyn Transport, ep: &Endpoints, refresh_token: &str) -> Result<Refreshed> {
    let body = form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
    ]);
    let r = send(t, &ep.token(), "application/x-www-form-urlencoded", &body)?;
    match r.status {
        200 => tokens_of(&r, Some(refresh_token), "refresh").map(Refreshed::Tokens),
        429 => Err(rate_limited(" while renewing the sign-in")),
        // OAuth's `invalid_grant` comes as 400; a revoked or reused token as 401
        400 | 401 => Ok(Refreshed::Revoked),
        s => Err(failed(
            "hx.signin.failed",
            format!("OpenAI's sign-in service answered {s} when renewing the sign-in"),
        )),
    }
}

fn b64url(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in input.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(u8::try_from((acc >> bits) & 0xff).ok()?);
        }
    }
    Some(out)
}

/// The claims of a JWT, read without checking its signature: only to schedule the refresh and to show the plan. The token
/// is never trusted for anything else here; the model service checks it.
#[must_use]
pub fn claims(jwt: &str) -> Option<Value> {
    let payload = jwt.split('.').nth(1)?;
    serde_json::from_slice(&b64url(payload)?).ok()
}

/// When the token expires (`exp`, seconds since the epoch), and when it was issued (`iat`).
#[must_use]
pub fn lifetime(jwt: &str) -> Option<(u64, Option<u64>)> {
    let c = claims(jwt)?;
    Some((c["exp"].as_u64()?, c["iat"].as_u64()))
}

/// The ChatGPT plan the token names (`plus`, `pro`, `team`), when it names one.
#[must_use]
pub fn plan(jwt: &str) -> Option<String> {
    claims(jwt)?["https://api.openai.com/auth"]["chatgpt_plan_type"]
        .as_str()
        .map(str::to_owned)
        .filter(|p| !p.is_empty())
}
