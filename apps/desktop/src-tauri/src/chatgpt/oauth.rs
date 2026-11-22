//! The wire of the ChatGPT sign-in: OpenAI's **Sign in with ChatGPT** program for open-source apps (terms in force from
//! 4 November 2026). Each call
//! is one blocking HTTPS request through [`Transport`]; the caller runs it on `spawn_blocking`. Nothing here stores
//! anything, and no value it handles is ever logged or put in an error.
//!
//! What the program says (OpenAI's pages, read on 21 November 2026; `docs/DECISIONS.md` ADR-0030 cites them):
//! - **No application.** An open-source app registers itself: the first authorization carries `client_id=dynamic_agent_client`,
//!   the app's name as `agent_name_hint` and a stable `ext_agent_host_id`; the callback returns the issued `oaiapp_` client id,
//!   which is kept and used from then on. No client secret, no partner key
//!   (<https://developers.openai.com/siwc/token-sharing-open-source/sign-in>).
//! - **Authorization code with PKCE (S256) and `OpenID` Connect**, a loopback redirect `http://127.0.0.1:<port>/auth/callback`
//!   (only the port may vary), scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`,
//!   `resource=https://api.openai.com/v1`. There is no device-code route in the program, so the card opens the browser.
//! - Endpoints (`https://auth.openai.com/.well-known/openid-configuration`): authorize `/api/accounts/authorize`, token
//!   `/api/accounts/oauth/token`, revoke `/api/accounts/oauth/revoke`, keys `/.well-known/jwks.json` (RS256 ID tokens).
//! - The ID token is checked (signature against the keys, issuer, audience = the issued client id, expiry, nonce) and the
//!   granted scopes must include `chatgpt.tokens.use.direct`.
//! - **What the token calls:** `POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`, and
//!   `GET /v1/models`. Not ChatGPT's `backend-api` (<https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference>).
//! - Access tokens live one hour; refresh tokens 30 days and rotate on every refresh
//!   (<https://developers.openai.com/siwc/token-sharing-open-source/token-reference>). A refresh is
//!   `grant_type=refresh_token` with the issued client id, the refresh token and the `resource`, no `scope`.
//!
//! The older route (the Codex CLI's public client, which boopis used before the program) is cut off: it has no code here.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result, kept};

/// OpenAI's sign-in service.
pub const ISSUER: &str = "https://auth.openai.com";
/// The audience of the program's tokens, and the base the Responses API is called on.
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// The registration entry point of the program: the first authorization of a host and account.
pub const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
/// The app's name as the program wants it (`agent_name_hint`: the actual name, the same on every installation).
pub const AGENT_NAME: &str = "boopis";
/// The scope that lets a token use the person's ChatGPT plan.
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
/// Everything asked for: identity, a renewable session, and the plan.
pub const SCOPE: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The path of the loopback callback (the program fixes it; only the port may vary).
pub const CALLBACK_PATH: &str = "/auth/callback";
/// Allowed clock difference when checking an ID token's times, in seconds.
pub const CLOCK_SKEW_SECS: u64 = 60;

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

    /// The issuer the ID token must name.
    #[must_use]
    pub fn issuer(&self) -> &str {
        &self.issuer
    }
    fn authorize(&self) -> String {
        format!("{}/api/accounts/authorize", self.issuer)
    }
    fn token(&self) -> String {
        format!("{}/api/accounts/oauth/token", self.issuer)
    }
    fn revoke(&self) -> String {
        format!("{}/api/accounts/oauth/revoke", self.issuer)
    }
    fn jwks(&self) -> String {
        format!("{}/.well-known/jwks.json", self.issuer)
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

/// How a request leaves the computer. Blocking: run it on `spawn_blocking`. Shared by every host-owned sign-in
/// (`chatgpt/`, `copilot/`): the wire of each is its own, the way out is one.
pub trait Transport: Send + Sync + 'static {
    /// `POST url` with `content_type` and `body`. `Err` only when no answer came (network, TLS, timeout), with a message
    /// that carries no request data.
    ///
    /// # Errors
    /// The message of the failure.
    fn post(&self, url: &str, content_type: &str, body: &str)
    -> std::result::Result<Reply, String>;

    /// `GET url` with `headers`. The default answers that the transport cannot, so a double that only scripts POSTs fails
    /// loudly instead of silently dropping a header.
    ///
    /// # Errors
    /// The message of the failure.
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> std::result::Result<Reply, String> {
        let _ = (url, headers);
        Err("this transport cannot GET".to_owned())
    }
}

/// The real transport: `ureq` over rustls, with the operating system's trust store, a whole-request timeout, a cap on
/// the body (the engine caps the same answers at 1 MiB) and **no redirects**: a token never follows a redirect to another
/// host.
pub struct Https {
    agent: ureq::Agent,
}

/// The largest answer body read.
const MAX_BODY: u64 = 1024 * 1024;

impl Https {
    /// An agent whose every request ends within `timeout`.
    #[must_use]
    pub fn new(timeout: std::time::Duration) -> Self {
        let agent = ureq::Agent::config_builder()
            .tls_config(crate::tls::config())
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_global(Some(timeout))
            .user_agent(concat!("boopis/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        Self { agent }
    }
}

fn read(mut resp: ureq::http::Response<ureq::Body>) -> std::result::Result<Reply, String> {
    let status = resp.status().as_u16();
    let body = resp
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .map_err(|e| e.to_string())?;
    Ok(Reply { status, body })
}

impl Transport for Https {
    fn post(
        &self,
        url: &str,
        content_type: &str,
        body: &str,
    ) -> std::result::Result<Reply, String> {
        let resp = self
            .agent
            .post(url)
            .header("Content-Type", content_type)
            .header("Accept", "application/json")
            .send(body)
            .map_err(|e| e.to_string())?;
        read(resp)
    }

    fn get(&self, url: &str, headers: &[(&str, &str)]) -> std::result::Result<Reply, String> {
        let mut req = self.agent.get(url).header("Accept", "application/json");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        read(req.call().map_err(|e| e.to_string())?)
    }
}

/// The tokens of a signed-in account. `Debug` shows none of them.
#[derive(Clone, PartialEq, Eq)]
pub struct Tokens {
    /// The bearer the model service takes.
    pub access: String,
    /// The token that gets the next access token (it rotates: each refresh may send the next one).
    pub refresh: String,
    /// The ID token, kept so a later sign-in can name the account (`id_token_hint`).
    pub id: Option<String>,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Tokens(<redacted>)")
    }
}

fn failed(code: &'static str, message: impl Into<String>) -> Error {
    Error::Setup(code, message.into())
}

/// What the card says when OpenAI could not be reached; the transport's own words go to Diagnostics.
pub const UNREACHABLE: &str = "boopis could not reach OpenAI to sign you in. Check your internet connection or proxy, then try again. Nothing was saved.";
/// What the card says when OpenAI's sign-in service answered with a server error.
const TROUBLE: &str = "OpenAI's sign-in service is having trouble right now. Try again in a few minutes. Nothing was saved.";
/// What the card says for an answer boopis could not use (an unexpected status, a missing field).
const UNUSABLE: &str = "OpenAI's sign-in service sent an answer boopis could not use. Try again; if it happens again, the details are in Settings, General, Diagnostics. Nothing was saved.";

fn send(t: &dyn Transport, url: &str, content_type: &str, body: &str) -> Result<Reply> {
    t.post(url, content_type, body)
        .map_err(|e| unreachable(url, &e))
}

fn fetch(t: &dyn Transport, url: &str) -> Result<Reply> {
    t.get(url, &[]).map_err(|e| unreachable(url, &e))
}

fn unreachable(url: &str, e: &str) -> Error {
    kept(
        failed("hx.signin.unreachable", UNREACHABLE),
        format!("{url}: {e}"),
    )
}

/// An answer that is not the one the step expects, in plain words: something on the network answered in OpenAI's place (a web
/// page where JSON belongs, or a proxy's refusal), a server error, or anything else. What OpenAI actually sent is kept for
/// Diagnostics, never shown.
fn unexpected(r: &Reply, step: &str) -> Error {
    let raw = format!(
        "{step}: HTTP {}: {}",
        r.status,
        r.body.chars().take(300).collect::<String>()
    );
    let e = if answered_by_network(r) {
        Error::Provider("hx.provider.signin_blocked", BLOCKED.to_owned())
    } else if r.status >= 500 {
        failed("hx.signin.failed", TROUBLE)
    } else {
        failed("hx.signin.failed", UNUSABLE)
    };
    kept(e, raw)
}

/// What the card says when something on the network answered in place of the sign-in service.
pub const BLOCKED: &str = "Something on your network answered in place of the sign-in service (a firewall, a proxy or a security check). Check your proxy settings, or try again on another network. Nothing was saved.";

/// Whether an answer came from something on the network rather than the sign-in service: these services answer JSON, so a web
/// page (a firewall's, a captive portal's, a bot check's) or a proxy's refusal (407) is not theirs. Shared by every host-run
/// sign-in (`copilot/`, `xai/`).
#[must_use]
pub fn answered_by_network(r: &Reply) -> bool {
    let head = r
        .body
        .trim_start()
        .get(..256)
        .unwrap_or(r.body.trim_start());
    let lower = head.to_ascii_lowercase();
    r.status == 407
        || (r.status >= 400 && (lower.starts_with("<!doctype html") || lower.starts_with("<html")))
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

// ---------------------------------------------------------------- random values, base64url, PKCE

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Base64url without padding.
#[must_use]
pub fn b64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |a, b| (a << 8) | u32::from(*b)) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(char::from(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

/// Base64url (or standard base64) to bytes; padding and the two alphabets are accepted.
#[must_use]
pub fn b64url_decode(input: &str) -> Option<Vec<u8>> {
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

/// `n` random bytes from the operating system.
///
/// # Errors
/// `hx.signin.failed` when the system has no randomness (never expected).
pub fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| {
        kept(
            failed(
                "hx.signin.failed",
                "boopis could not start the sign-in on this computer. Restart boopis and try again.",
            ),
            format!("the system's random source failed: {e}"),
        )
    })?;
    Ok(buf)
}

/// A new random value, as base64url text, for a `state`, a `nonce` or a PKCE verifier (`N` bytes of randomness).
///
/// # Errors
/// As [`random_bytes`].
pub fn random_text<const N: usize>() -> Result<String> {
    Ok(b64url_encode(&random_bytes::<N>()?))
}

/// A new host id, `urn:uuid:` and a version-4 UUID: what the program asks one installation to keep.
///
/// # Errors
/// As [`random_bytes`].
pub fn new_host_id() -> Result<String> {
    let mut b = random_bytes::<16>()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    Ok(format!(
        "urn:uuid:{}",
        uuid::Uuid::from_bytes(b).hyphenated()
    ))
}

/// The PKCE challenge for `verifier` (S256: the base64url of its SHA-256, no padding).
#[must_use]
pub fn challenge(verifier: &str) -> String {
    b64url_encode(&Sha256::digest(verifier.as_bytes()))
}

// ---------------------------------------------------------------- the authorization request

/// One authorization attempt: what must come back, and what the exchange needs. `Debug` prints none of it.
#[derive(Clone)]
pub struct Attempt {
    /// Binds the callback to this attempt.
    pub state: String,
    /// Must be in the ID token.
    pub nonce: String,
    /// The PKCE verifier.
    pub verifier: String,
    /// The exact callback address, including its port.
    pub redirect_uri: String,
    /// The issued client id of a registered account; `None` for the first sign-in (dynamic registration).
    pub client_id: Option<String>,
    /// This installation's host id.
    pub host_id: String,
    /// The ID token retained from the last sign-in of the account (skips the account selector), when there is one.
    pub id_token_hint: Option<String>,
    /// The account's email, as a hint for the selector.
    pub login_hint: Option<String>,
    /// Ask for the consent screen again (`prompt=consent`): the person once signed in without allowing plan use and now
    /// chose to allow it.
    pub force_consent: bool,
}

impl std::fmt::Debug for Attempt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Attempt")
            .field("redirect_uri", &self.redirect_uri)
            .field("registered", &self.client_id.is_some())
            .finish_non_exhaustive()
    }
}

impl Attempt {
    /// A fresh attempt: new state, nonce and verifier.
    ///
    /// # Errors
    /// As [`random_bytes`].
    pub fn new(redirect_uri: String, host_id: String, client_id: Option<String>) -> Result<Self> {
        Ok(Self {
            state: random_text::<32>()?,
            nonce: random_text::<32>()?,
            verifier: random_text::<48>()?,
            redirect_uri,
            client_id,
            host_id,
            id_token_hint: None,
            login_hint: None,
            force_consent: false,
        })
    }
}

/// The address to open in the browser. With `hints`, the retained ID token and the email go in (the browser is opened by
/// the host with this one); without, it is the address the card may show and open again, free of any token (the program asks
/// that an ID token in an address never reaches logs or a page).
#[must_use]
pub fn authorize_url(ep: &Endpoints, a: &Attempt, hints: bool) -> String {
    let registered = a.client_id.as_deref();
    let mut pairs: Vec<(&str, &str)> = vec![
        ("client_id", registered.unwrap_or(DYNAMIC_CLIENT)),
        ("response_type", "code"),
        ("redirect_uri", &a.redirect_uri),
        ("scope", SCOPE),
        ("resource", RESOURCE),
        ("state", &a.state),
        ("nonce", &a.nonce),
        ("code_challenge_method", "S256"),
        ("ext_agent_host_id", &a.host_id),
    ];
    let challenge = challenge(&a.verifier);
    pairs.push(("code_challenge", &challenge));
    if registered.is_none() {
        // the name goes only on the first registration, never on a reauthorization
        pairs.push(("agent_name_hint", AGENT_NAME));
    }
    if a.force_consent {
        pairs.push(("prompt", "consent"));
    }
    if registered.is_some() && hints {
        if let Some(t) = a.id_token_hint.as_deref() {
            pairs.push(("id_token_hint", t));
        }
        if let Some(e) = a.login_hint.as_deref() {
            pairs.push(("login_hint", e));
        }
    }
    format!("{}?{}", ep.authorize(), form(&pairs))
}

// ---------------------------------------------------------------- the exchange

/// What the exchange found.
pub enum Exchange {
    /// The tokens, with the scopes OpenAI says it granted.
    Tokens {
        /// The tokens.
        tokens: Tokens,
        /// The granted scopes (from the token answer, else the access token's own claim).
        scopes: Vec<String>,
    },
    /// OpenAI refused the code or the client (`invalid_grant`, `invalid_client`): start a new authorization.
    Rejected,
}

fn oauth_error(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    str_field(&v, "error")
        .or_else(|| str_field(&v["error"], "code"))
        .unwrap_or_default()
}

fn scopes_of(v: &Value, access: &str) -> Vec<String> {
    let text =
        str_field(v, "scope").or_else(|| claims(access).and_then(|c| str_field(&c, "scope")));
    let mut out: Vec<String> = text
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    out.sort();
    out.dedup();
    out
}

fn tokens_of(v: &Value, previous_refresh: Option<&str>, what: &str) -> Result<Tokens> {
    let Some(access) = str_field(v, "access_token") else {
        return Err(kept(
            failed("hx.signin.failed", UNUSABLE),
            format!("OpenAI's {what} answer carried no access token"),
        ));
    };
    let Some(refresh) =
        str_field(v, "refresh_token").or_else(|| previous_refresh.map(str::to_owned))
    else {
        return Err(kept(
            failed("hx.signin.failed", UNUSABLE),
            format!("OpenAI's {what} answer carried no refresh token"),
        ));
    };
    Ok(Tokens {
        access,
        refresh,
        id: str_field(v, "id_token"),
    })
}

/// Trade the callback's code for tokens (`authorization_code`, PKCE, no secret).
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited`, or `hx.signin.failed`.
pub fn exchange(
    t: &dyn Transport,
    ep: &Endpoints,
    client_id: &str,
    code: &str,
    a: &Attempt,
) -> Result<Exchange> {
    let body = form(&[
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", &a.verifier),
        ("redirect_uri", &a.redirect_uri),
        ("resource", RESOURCE),
    ]);
    let r = send(t, &ep.token(), "application/x-www-form-urlencoded", &body)?;
    match r.status {
        200 => {
            let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
            let tokens = tokens_of(&v, None, "sign-in")?;
            let scopes = scopes_of(&v, &tokens.access);
            Ok(Exchange::Tokens { tokens, scopes })
        }
        429 => Err(rate_limited(" while finishing the sign-in")),
        400 | 401
            if matches!(
                oauth_error(&r.body).as_str(),
                "invalid_grant" | "invalid_client"
            ) =>
        {
            Ok(Exchange::Rejected)
        }
        _ => Err(unexpected(&r, "finishing the sign-in")),
    }
}

// ---------------------------------------------------------------- the ID token

/// Who signed in, from a checked ID token.
#[derive(Clone, PartialEq, Eq)]
pub struct Identity {
    /// The stable account identifier.
    pub subject: String,
    /// The account's email, when the token says one (for the selector's hint and the card).
    pub email: Option<String>,
    /// The ChatGPT plan the token names, when it names one.
    pub plan: Option<String>,
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Identity(<redacted>)")
    }
}

fn bad_id(why: &str) -> Error {
    kept(
        failed(
            "hx.signin.failed",
            "boopis could not confirm that the answer came from OpenAI, so nothing was saved. Try again; if it happens again, a proxy or security program may be changing the connection.",
        ),
        format!("OpenAI's ID token was not accepted: {why}"),
    )
}

/// An ID token whose times are off: almost always this computer's clock.
fn bad_clock(why: &str) -> Error {
    kept(
        failed(
            "hx.signin.failed",
            "Your computer's clock looks wrong, so boopis could not check OpenAI's answer. Set the date and time to update automatically, then try again. Nothing was saved.",
        ),
        format!("OpenAI's ID token was not accepted: {why}"),
    )
}

fn audience_has(v: &Value, client_id: &str) -> bool {
    match v {
        Value::String(s) => s == client_id,
        Value::Array(a) => a.iter().any(|x| x.as_str() == Some(client_id)),
        _ => false,
    }
}

/// OpenAI's published RSA signing keys (`/.well-known/jwks.json`), fetched now.
///
/// # Errors
/// `hx.signin.unreachable` when they cannot be fetched, `hx.signin.failed` for an answer that is not 200.
pub fn signing_keys(transport: &dyn Transport, ep: &Endpoints) -> Result<Vec<Value>> {
    let published = fetch(transport, &ep.jwks())?;
    if published.status != 200 {
        return Err(unexpected(&published, "reading OpenAI's signing keys"));
    }
    let keys: Value = serde_json::from_str(&published.body).unwrap_or(Value::Null);
    Ok(keys["keys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|jwk| jwk["kty"].as_str() == Some("RSA"))
        .cloned()
        .collect())
}

/// Check `id_token` as the program asks: an RS256 signature against OpenAI's published keys (fetched now), the issuer, the
/// audience (the issued client id), the times and the nonce.
///
/// # Errors
/// `hx.signin.unreachable` when the keys cannot be fetched, else `hx.signin.failed` with the reason.
pub fn verify_id_token(
    transport: &dyn Transport,
    ep: &Endpoints,
    id_token: &str,
    client_id: &str,
    nonce: &str,
    at: u64,
) -> Result<Identity> {
    use subtle::ConstantTimeEq;
    let mut parts = id_token.split('.');
    let (Some(head), Some(payload), Some(sig), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(bad_id("it is not a signed token"));
    };
    let header: Value = b64url_decode(head)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| bad_id("its header is unreadable"))?;
    if header["alg"].as_str() != Some("RS256") {
        return Err(bad_id("it is not signed with RS256"));
    }
    let kid = header["kid"].as_str();
    let keys = signing_keys(transport, ep)?;
    let key = keys
        .iter()
        .find(|jwk| kid.is_none() || jwk["kid"].as_str() == kid)
        .ok_or_else(|| bad_id("no published key matches it"))?;
    let (Some(modulus), Some(exponent)) = (
        key["n"].as_str().and_then(b64url_decode),
        key["e"].as_str().and_then(b64url_decode),
    ) else {
        return Err(bad_id("the published key is unreadable"));
    };
    let signature = b64url_decode(sig).ok_or_else(|| bad_id("its signature is unreadable"))?;
    let signed = format!("{head}.{payload}");
    ring::signature::RsaPublicKeyComponents {
        n: &modulus,
        e: &exponent,
    }
    .verify(
        &ring::signature::RSA_PKCS1_2048_8192_SHA256,
        signed.as_bytes(),
        &signature,
    )
    .map_err(|_| bad_id("its signature does not match OpenAI's keys"))?;

    let body: Value = b64url_decode(payload)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| bad_id("its claims are unreadable"))?;
    if body["iss"].as_str() != Some(ep.issuer()) {
        return Err(bad_id("it names another issuer"));
    }
    if !audience_has(&body["aud"], client_id) {
        return Err(bad_id("it is for another client"));
    }
    let exp = body["exp"]
        .as_u64()
        .ok_or_else(|| bad_id("it has no expiry"))?;
    if exp.saturating_add(CLOCK_SKEW_SECS) < at {
        return Err(bad_clock("it has expired"));
    }
    if body["iat"]
        .as_u64()
        .is_some_and(|iat| iat > at.saturating_add(CLOCK_SKEW_SECS))
    {
        return Err(bad_clock("it is dated in the future"));
    }
    let seen = body["nonce"].as_str().unwrap_or_default();
    if seen.is_empty() || !bool::from(seen.as_bytes().ct_eq(nonce.as_bytes())) {
        return Err(bad_id("its nonce is not this sign-in's"));
    }
    let Some(subject) = str_field(&body, "sub") else {
        return Err(bad_id("it names no account"));
    };
    Ok(Identity {
        subject,
        email: str_field(&body, "email"),
        plan: plan_of(&body),
    })
}

// ---------------------------------------------------------------- the refresh and the revocation

/// What a refresh found.
pub enum Refreshed {
    /// New tokens (the refresh token is the next one when the service sent one, else the same).
    Tokens(Tokens),
    /// The service refused the refresh token for good (revoked in ChatGPT's settings, expired, already used): the person
    /// signs in again with the same registration.
    Revoked,
    /// The service no longer knows the client (the person removed the app): the registration is dropped and the next
    /// sign-in registers anew.
    ClientGone,
}

/// The next access token of a sign-in made through the program.
///
/// # Errors
/// `hx.signin.unreachable`, `hx.signin.rate_limited` (the token is still good: try later), or `hx.signin.failed` for an
/// answer that is neither a success nor a refusal of the token.
pub fn refresh(
    t: &dyn Transport,
    ep: &Endpoints,
    client_id: &str,
    refresh_token: &str,
    previous_id: Option<&str>,
) -> Result<Refreshed> {
    let body = form(&[
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("resource", RESOURCE),
    ]);
    let r = send(t, &ep.token(), "application/x-www-form-urlencoded", &body)?;
    refreshed(&r, refresh_token, previous_id)
}

fn refreshed(r: &Reply, refresh_token: &str, previous_id: Option<&str>) -> Result<Refreshed> {
    match r.status {
        // a firewall's or a portal's page is not OpenAI ending the session: keep the tokens and try again later
        _ if answered_by_network(r) => Err(unexpected(r, "renewing the sign-in")),
        200 => {
            let v: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
            let mut tokens = tokens_of(&v, Some(refresh_token), "refresh")?;
            if tokens.id.is_none() {
                tokens.id = previous_id.map(str::to_owned);
            }
            Ok(Refreshed::Tokens(tokens))
        }
        429 => Err(rate_limited(" while renewing the sign-in")),
        // OAuth's `invalid_grant` comes as 400, a revoked or reused token as 401: unusable for good
        400 | 401 => Ok(if oauth_error(&r.body) == "invalid_client" {
            Refreshed::ClientGone
        } else {
            Refreshed::Revoked
        }),
        _ => Err(unexpected(r, "renewing the sign-in")),
    }
}

/// End the renewable session at OpenAI (RFC 7009): true when OpenAI answered that it is done (an empty 200, also for a
/// token that was already invalid).
///
/// # Errors
/// `hx.signin.unreachable` or `hx.signin.failed` (a 5xx): the caller retries once, then signs out locally and says that the
/// revocation was not confirmed.
pub fn revoke(
    t: &dyn Transport,
    ep: &Endpoints,
    client_id: &str,
    refresh_token: &str,
) -> Result<bool> {
    let body = form(&[
        ("token", refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", client_id),
    ]);
    let r = send(t, &ep.revoke(), "application/x-www-form-urlencoded", &body)?;
    match r.status {
        200 => Ok(true),
        s if s >= 500 || s == 429 => Err(kept(
            failed("hx.signin.failed", TROUBLE),
            format!("OpenAI's sign-in service answered {s} when ending the sign-in"),
        )),
        _ => Ok(false),
    }
}

// ---------------------------------------------------------------- reading a token's claims

/// The claims of a JWT, read without checking its signature: only to schedule the refresh and to show the plan. The token
/// is never trusted for anything else here; the model service checks it.
#[must_use]
pub fn claims(jwt: &str) -> Option<Value> {
    let payload = jwt.split('.').nth(1)?;
    serde_json::from_slice(&b64url_decode(payload)?).ok()
}

/// When the token expires (`exp`, seconds since the epoch), and when it was issued (`iat`).
#[must_use]
pub fn lifetime(jwt: &str) -> Option<(u64, Option<u64>)> {
    let c = claims(jwt)?;
    Some((c["exp"].as_u64()?, c["iat"].as_u64()))
}

fn plan_of(c: &Value) -> Option<String> {
    c["https://api.openai.com/auth"]["chatgpt_plan_type"]
        .as_str()
        .map(str::to_owned)
        .filter(|p| !p.is_empty())
}

/// The ChatGPT plan a token names (`plus`, `pro`, `team`), when it names one.
#[must_use]
pub fn plan(jwt: &str) -> Option<String> {
    plan_of(&claims(jwt)?)
}
