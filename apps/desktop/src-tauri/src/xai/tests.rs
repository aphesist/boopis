//! The SuperGrok sign-in against a scripted xAI: the device flow's ends (approved, cancelled, timed out, refused, rate-limited,
//! denied), what reaches the keychain, the refresh (renewed, rotated, revoked, denied, rate-limited), a locked keychain, the
//! secrets that must never show, the real HTTPS transport against a loopback server, the three ways' states and the `grok`
//! program's detection.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::cli::{self, GrokCli, Probe};
use super::oauth::{self, Endpoints};
use super::{ACCESS, EXPIRES, REFRESH, State, Timing, Xai, due};
use crate::chatgpt::oauth::{Reply, Transport};
use crate::error::Error;
use crate::providers::{OfferedWhen, ProviderSigninEvent, ProviderState, ProviderStatus, WayKind};
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;

/// A JWT-shaped token whose payload is `claims` (no signature: nothing here checks one).
fn jwt(claims: &Value) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bytes = claims.to_string().into_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |a, b| (a << 8) | u32::from(*b)) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(char::from(T[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    format!("eyJhbGciOiJub25lIn0.{out}.sig")
}

fn now() -> u64 {
    super::now()
}

/// A token that expires `secs` from now, issued 15 minutes before it lapses (xAI's device-code tokens live about that long).
fn access(secs: i64) -> String {
    let exp = now().cast_signed() + secs;
    jwt(&json!({"exp": exp, "iat": exp - 900, "sub": "user-1"}))
}

#[derive(Default)]
struct Script {
    replies: Mutex<VecDeque<(String, std::result::Result<Reply, String>)>>,
    seen: Mutex<Vec<(String, String, String)>>,
}

impl Script {
    fn then(&self, url_end: &str, status: u16, body: &Value) -> &Self {
        self.replies.lock().unwrap().push_back((
            url_end.to_owned(),
            Ok(Reply {
                status,
                body: body.to_string(),
            }),
        ));
        self
    }
    fn fail(&self, url_end: &str) -> &Self {
        self.replies
            .lock()
            .unwrap()
            .push_back((url_end.to_owned(), Err("connection refused".into())));
        self
    }
    fn seen(&self) -> Vec<(String, String, String)> {
        self.seen.lock().unwrap().clone()
    }
}

impl Transport for Script {
    fn post(
        &self,
        url: &str,
        content_type: &str,
        body: &str,
    ) -> std::result::Result<Reply, String> {
        self.seen
            .lock()
            .unwrap()
            .push((url.to_owned(), content_type.to_owned(), body.to_owned()));
        let (want, reply) = self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| (String::new(), Err("no more replies scripted".into())));
        assert!(
            url.ends_with(&want),
            "{url} was asked, the script expected …{want}"
        );
        reply
    }
}

fn timing() -> Timing {
    Timing::app()
}

type Events = Arc<Mutex<Vec<ProviderSigninEvent>>>;

fn service(script: &Arc<Script>, store: &Arc<MemoryStore>) -> (Arc<Xai>, Events) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let svc = Xai::new(store.clone(), script.clone(), timing())
        .with_sink(Arc::new(move |e| sink.lock().unwrap().push(e)));
    (Arc::new(svc), events)
}

fn code_reply() -> Value {
    json!({
        "device_code": "dev-secret-1", "user_code": "QMJM-H3XJ",
        "verification_uri": "https://accounts.x.ai/oauth2/device",
        "verification_uri_complete": "https://accounts.x.ai/oauth2/device?user_code=QMJM-H3XJ",
        "expires_in": 1800, "interval": 5
    })
}

fn pending() -> Value {
    json!({"error": "authorization_pending", "error_description": "User has not yet authorized"})
}

fn kept(store: &MemoryStore, name: &str) -> Option<String> {
    store.get("boopis.xai", name).unwrap()
}

async fn ended(events: &Events) -> ProviderSigninEvent {
    // virtual time (the tests start paused): up to 40 minutes, past the 30 the code lives
    for _ in 0..48_000 {
        if let Some(e) = events.lock().unwrap().first().cloned() {
            return e;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the sign-in never ended");
}

fn tokens_reply(a: &str, r: &str) -> Value {
    json!({"access_token": a, "refresh_token": r, "id_token": "id-secret", "expires_in": 900, "token_type": "Bearer"})
}

fn form_of(body: &str) -> Vec<(String, String)> {
    url::form_urlencoded::parse(body.as_bytes())
        .into_owned()
        .collect()
}

// ---------------------------------------------------------------- the device flow

#[tokio::test(start_paused = true)]
async fn a_device_sign_in_shows_the_page_waits_slows_down_and_keeps_the_tokens_in_the_keychain() {
    let script = Arc::new(Script::default());
    let a = access(900);
    script
        .then("/oauth2/device/code", 200, &code_reply())
        .then("/oauth2/token", 400, &pending())
        .then("/oauth2/token", 400, &json!({"error": "slow_down"}))
        .then("/oauth2/token", 400, &pending())
        .then("/oauth2/token", 200, &tokens_reply(&a, "rt-1"));
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);

    let code = svc.start().await.unwrap();
    assert_eq!(code.user_code, "QMJM-H3XJ");
    assert_eq!(
        code.verification_url,
        "https://accounts.x.ai/oauth2/device?user_code=QMJM-H3XJ"
    );
    // a second start while it waits shows the same code and asks xAI for nothing
    assert_eq!(svc.start().await.unwrap(), code);
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.code.as_ref()),
        (State::SigningIn, Some(&code))
    );
    let ps = svc.provider_state().await.unwrap();
    assert_eq!(ps.status, ProviderStatus::SigningIn);
    assert_eq!(ps.way, "xai.signin");
    assert!(ps.is_consistent());
    assert_eq!(ps.signin.unwrap().user_code, "QMJM-H3XJ");

    let e = ended(&events).await;
    assert_eq!(e.outcome, "signed_in", "{}", e.message);
    assert_eq!(e.way, "xai.signin");
    assert_eq!(kept(&store, ACCESS).as_deref(), Some(a.as_str()));
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-1"));
    assert!(
        kept(&store, EXPIRES).is_some(),
        "expires_in is kept beside the tokens"
    );
    assert_eq!(svc.status().await.unwrap().state, State::SignedIn);
    let ps = svc.provider_state().await.unwrap();
    assert_eq!(
        (ps.status, ps.kind),
        (ProviderStatus::Connected, WayKind::Signin)
    );

    // the requests: the client and scope, then the polls with the grant, the client and the device code
    let seen = script.seen();
    assert_eq!(seen.len(), 5);
    assert!(
        seen.iter()
            .all(|s| s.1 == "application/x-www-form-urlencoded")
    );
    let first = form_of(&seen[0].2);
    assert!(first.contains(&("client_id".into(), oauth::CLIENT_ID.into())));
    assert!(first.contains(&("scope".into(), oauth::SCOPE.into())));
    let poll = form_of(&seen[1].2);
    assert!(poll.contains(&("grant_type".into(), oauth::DEVICE_GRANT.into())));
    assert!(poll.contains(&("device_code".into(), "dev-secret-1".into())));
    assert!(poll.contains(&("client_id".into(), oauth::CLIENT_ID.into())));
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_sign_in_stores_nothing() {
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply());
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    svc.cancel();
    assert_eq!(ended(&events).await.outcome, "cancelled");
    assert_eq!(kept(&store, ACCESS), None);
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);
    assert_eq!(script.seen().len(), 1, "no poll after the cancel");
}

#[tokio::test(start_paused = true)]
async fn a_code_nobody_approves_times_out_when_the_host_stops_waiting_or_xai_says_so() {
    // the host stops at the code's own life (here 60 s, shorter than the host's 30 minutes)
    let script = Arc::new(Script::default());
    let mut short = code_reply();
    short["expires_in"] = json!(60);
    script.then("/oauth2/device/code", 200, &short);
    for _ in 0..40 {
        script.then("/oauth2/token", 400, &pending());
    }
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "timed_out");
    assert!(e.message.contains("Start again"), "{}", e.message);
    assert_eq!(kept(&store, REFRESH), None);
    assert!(script.seen().len() <= 14, "polls are paced by the interval");

    // xAI says the code lapsed
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply()).then(
        "/oauth2/token",
        400,
        &json!({"error": "expired_token"}),
    );
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    assert_eq!(ended(&events).await.outcome, "timed_out");
}

#[tokio::test(start_paused = true)]
async fn refusals_end_the_sign_in_with_words_and_store_nothing() {
    let store = Arc::new(MemoryStore::default());
    // xAI will not give a code (429 and 403): the start itself fails, nothing waits
    let script = Arc::new(Script::default());
    script
        .then("/oauth2/device/code", 429, &json!({}))
        .then("/oauth2/device/code", 403, &json!({}))
        .then("/oauth2/device/code", 500, &json!({}))
        .fail("/oauth2/device/code");
    let (svc, _) = service(&script, &store);
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.signin_rate_limited");
    assert!(e.to_string().contains("Wait a minute"));
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.signin_denied");
    assert!(e.to_string().contains("API key"), "the way out is named");
    assert_eq!(
        svc.start().await.unwrap_err().code(),
        "hx.provider.signin_failed"
    );
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.unreachable");
    assert!(
        !e.to_string().contains("connection refused"),
        "the transport's words stay in Diagnostics: {e}"
    );
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);

    // a bot check's page at 403 is the network answering, not xAI refusing an account (no account is known yet)
    let script = Arc::new(Script::default());
    script.replies.lock().unwrap().push_back((
        "/oauth2/device/code".to_owned(),
        Ok(Reply {
            status: 403,
            body: "<!DOCTYPE html><html><title>Attention Required! | Cloudflare</title></html>"
                .into(),
        }),
    ));
    let (svc, _) = service(&script, &store);
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.signin_blocked");
    assert!(e.to_string().contains("Something on your network"), "{e}");
    assert!(!e.to_string().contains("403"), "{e}");

    // the user declines on xAI's page
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply()).then(
        "/oauth2/token",
        400,
        &json!({"error": "access_denied"}),
    );
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "failed");
    assert!(e.message.contains("declined"), "{}", e.message);
    assert_eq!(kept(&store, ACCESS), None);

    // the approval comes back without a refresh token: nothing is kept (a sign-in that could not be renewed is not stored)
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply()).then(
        "/oauth2/token",
        200,
        &json!({"access_token": access(900)}),
    );
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    assert_eq!(ended(&events).await.outcome, "failed");
    assert_eq!(kept(&store, ACCESS), None);
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_while_waiting_slows_the_polls_and_a_403_marks_the_way_as_an_error() {
    let store = Arc::new(MemoryStore::default());
    let script = Arc::new(Script::default());
    let a = access(900);
    script
        .then("/oauth2/device/code", 200, &code_reply())
        .then("/oauth2/token", 429, &json!({}))
        .then("/oauth2/token", 200, &tokens_reply(&a, "rt"));
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    assert_eq!(ended(&events).await.outcome, "signed_in");

    // the tier gate: the account is refused at the token endpoint
    let store = Arc::new(MemoryStore::default());
    let script = Arc::new(Script::default());
    script
        .then("/oauth2/device/code", 200, &code_reply())
        .then("/oauth2/token", 403, &json!({}));
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "failed");
    assert!(e.message.contains("API key"));
    let ps = svc.provider_state().await.unwrap();
    assert_eq!(ps.status, ProviderStatus::Error);
    assert_eq!(ps.code.as_deref(), Some("hx.provider.signin_denied"));
    assert!(ps.is_consistent());
    // the next sign-in clears it
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply());
    let svc = Arc::new(Xai::new(store.clone(), script.clone(), timing()));
    svc.start().await.unwrap();
    assert_eq!(
        svc.provider_state().await.unwrap().status,
        ProviderStatus::SigningIn
    );
}

#[test]
fn the_code_answer_is_read_as_the_service_sends_it() {
    let script = Script::default();
    let ep = Endpoints::xai();
    let mut other_host = code_reply();
    other_host["verification_uri_complete"] = json!("https://evil.example.com/device");
    other_host["verification_uri"] = json!("https://evil.example.com/device");
    let mut bare = code_reply();
    bare["verification_uri_complete"] = Value::Null;
    bare["interval"] = json!("0");
    bare["expires_in"] = Value::Null;
    script
        .then("device/code", 200, &bare)
        .then("device/code", 200, &other_host)
        .then("device/code", 200, &json!({"user_code": "C"}))
        .then("device/code", 200, &json!(["not", "an", "object"]));
    let c = oauth::request_code(&script, &ep).unwrap();
    assert_eq!(c.verification_url, "https://accounts.x.ai/oauth2/device");
    assert_eq!(c.interval, 1, "a floor of one second");
    assert_eq!(c.expires_in, 300, "the default life");
    assert_eq!(
        oauth::request_code(&script, &ep).unwrap_err().code(),
        "hx.provider.signin_failed",
        "a page on another host is not offered"
    );
    for _ in 0..2 {
        assert_eq!(
            oauth::request_code(&script, &ep).unwrap_err().code(),
            "hx.provider.signin_failed"
        );
    }
}

// ---------------------------------------------------------------- the refresh

fn store_signed_in(store: &MemoryStore, access: &str, refresh: &str) {
    store.set("boopis.xai", ACCESS, access).unwrap();
    store.set("boopis.xai", REFRESH, refresh).unwrap();
}

#[tokio::test]
async fn the_refresh_renews_a_token_that_is_due_and_keeps_the_rotated_refresh_token() {
    let store = Arc::new(MemoryStore::default());
    store_signed_in(&store, &access(60), "rt-old");
    let fresh = access(900);
    let script = Arc::new(Script::default());
    script.then("/oauth2/token", 200, &tokens_reply(&fresh, "rt-new"));
    let (svc, _) = service(&script, &store);
    assert!(svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&store, ACCESS).as_deref(), Some(fresh.as_str()));
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-new"));
    let form = form_of(&script.seen()[0].2);
    assert!(form.contains(&("grant_type".into(), "refresh_token".into())));
    assert!(form.contains(&("refresh_token".into(), "rt-old".into())));
    assert!(form.contains(&("client_id".into(), oauth::CLIENT_ID.into())));
    // fresh now: nothing is asked
    assert!(!svc.refresh_if_due().await.unwrap());
    assert_eq!(script.seen().len(), 1);

    // an answer without a new refresh token keeps the old one
    store.set("boopis.xai", ACCESS, &access(10)).unwrap();
    script.then("/oauth2/token", 200, &json!({"access_token": fresh}));
    assert!(svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-new"));
}

#[tokio::test]
async fn a_revoked_refresh_token_signs_out_with_a_note_a_denied_account_is_an_error_and_a_rate_limit_keeps_the_tokens()
 {
    let store = Arc::new(MemoryStore::default());
    store_signed_in(&store, &access(-10), "rt");
    let script = Arc::new(Script::default());
    script
        .then("/oauth2/token", 429, &json!({}))
        .then("/oauth2/token", 500, &json!({}))
        .fail("/oauth2/token")
        .then(
            "/oauth2/token",
            400,
            &json!({"error": "invalid_grant", "error_description": "Invalid or unknown refresh token"}),
        );
    let (svc, _) = service(&script, &store);
    assert_eq!(
        svc.refresh_if_due().await.unwrap_err().code(),
        "hx.provider.signin_rate_limited"
    );
    assert_eq!(
        svc.refresh_if_due().await.unwrap_err().code(),
        "hx.provider.signin_failed"
    );
    assert_eq!(
        svc.refresh_if_due().await.unwrap_err().code(),
        "hx.provider.unreachable"
    );
    assert_eq!(
        kept(&store, REFRESH).as_deref(),
        Some("rt"),
        "none of those is a revocation"
    );
    assert!(!svc.refresh_if_due().await.unwrap());
    assert_eq!((kept(&store, ACCESS), kept(&store, REFRESH)), (None, None));
    let ps = svc.provider_state().await.unwrap();
    assert_eq!(ps.status, ProviderStatus::SignedOut);
    assert!(ps.detail.unwrap().contains("Sign in again"));

    // the tier gate on renewal: an error that signing in again cannot fix
    store_signed_in(&store, &access(-10), "rt2");
    script.then("/oauth2/token", 403, &json!({}));
    assert!(!svc.refresh_if_due().await.unwrap());
    let ps = svc.provider_state().await.unwrap();
    assert_eq!(ps.status, ProviderStatus::Error);
    assert_eq!(ps.code.as_deref(), Some("hx.provider.signin_denied"));
    assert_eq!(kept(&store, REFRESH), None);
}

#[tokio::test]
async fn signing_out_removes_every_token_and_asks_xai_to_forget_the_refresh_token_without_waiting_on_it()
 {
    let store = Arc::new(MemoryStore::default());
    store_signed_in(&store, &access(3600), "rt-out");
    store.set("boopis.xai", EXPIRES, "123").unwrap();
    let script = Arc::new(Script::default());
    script.then("/oauth2/revoke", 200, &json!({}));
    let (svc, _) = service(&script, &store);
    assert!(svc.signed_in().await.unwrap());
    svc.sign_out().await.unwrap();
    assert!(!svc.signed_in().await.unwrap());
    assert_eq!(kept(&store, EXPIRES), None);
    let seen = script.seen();
    assert_eq!(seen.len(), 1);
    let form = form_of(&seen[0].2);
    assert!(form.contains(&("token".into(), "rt-out".into())));
    assert!(form.contains(&("token_type_hint".into(), "refresh_token".into())));

    // a revocation that fails changes nothing: the tokens are already gone
    store_signed_in(&store, &access(3600), "rt-2");
    script.fail("/oauth2/revoke");
    svc.sign_out().await.unwrap();
    assert!(!svc.signed_in().await.unwrap());
    // signed out already: nothing is asked
    let n = script.seen().len();
    svc.sign_out().await.unwrap();
    assert_eq!(script.seen().len(), n);
}

#[test]
fn a_token_is_due_inside_the_margin_or_half_its_life_and_when_nothing_says_when_it_lapses() {
    let t = 1_000_000;
    let ahead = Duration::from_mins(10);
    let tok = |exp: u64, iat: u64| jwt(&json!({"exp": exp, "iat": iat}));
    assert!(!due(&tok(t + 3600, t - 600), None, ahead, t));
    assert!(due(&tok(t + 500, t - 3000), None, ahead, t));
    // a token that lives 15 minutes is renewed at half its life, not 10 minutes early (which would be most of it)
    assert!(!due(&tok(t + 600, t - 300), None, ahead, t));
    assert!(due(&tok(t + 440, t - 460), None, ahead, t));
    // a token that is not a JWT: the expiry kept beside it, else due
    assert!(due("opaque", Some(t + 100), ahead, t));
    assert!(!due("opaque", Some(t + 5000), ahead, t));
    assert!(due("opaque", None, ahead, t));
}

#[test]
fn due_is_called_with_the_stored_expiry() {
    // the fallback reads `expires_at` as the answer's expires_in turned into a time
    assert!(!due(
        "opaque",
        Some(now() + 3600),
        Duration::from_mins(10),
        now()
    ));
}

// ---------------------------------------------------------------- a locked keychain, and secrets that never show

#[tokio::test]
async fn a_locked_keychain_fails_closed_and_xai_is_asked_nothing() {
    let store = Arc::new(MemoryStore::default());
    store_signed_in(&store, &access(-10), "rt");
    store
        .unavailable
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let script = Arc::new(Script::default());
    let (svc, _) = service(&script, &store);
    // never read as "signed out"
    assert!(svc.status().await.is_err());
    assert!(svc.signed_in().await.is_err());
    assert!(svc.provider_state().await.is_err());
    // no code is asked for, because the tokens could not be kept
    let e = svc.start().await.unwrap_err();
    assert!(e.code().starts_with("hx.secrets."), "{}", e.code());
    // no refresh is spent (it is single-use) when the new token could not be saved
    assert!(svc.refresh_if_due().await.is_err());
    assert!(svc.sign_out().await.is_err());
    assert!(script.seen().is_empty(), "xAI was not dialled");
    store
        .unavailable
        .store(false, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(
        kept(&store, REFRESH).as_deref(),
        Some("rt"),
        "nothing was lost"
    );
}

#[test]
fn tokens_and_codes_never_print() {
    let t = oauth::Tokens {
        access: "secret-a".into(),
        refresh: "secret-r".into(),
        expires_at: Some(1),
    };
    assert_eq!(format!("{t:?}"), "Tokens(<redacted>)");
    let script = Script::default();
    script.then("device/code", 200, &code_reply());
    let c = oauth::request_code(&script, &Endpoints::xai()).unwrap();
    let shown = format!("{c:?}");
    assert!(!shown.contains("dev-secret-1"), "{shown}");
}

/// A writer into a buffer, to read what the app logged.
#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<u8>>>);

impl Write for Log {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test(start_paused = true, flavor = "current_thread")]
async fn no_secret_reaches_a_log_or_an_error_whatever_the_flow_does() {
    let log = Log::default();
    let sink = log.clone();
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .finish(),
    );
    let (a, id) = (access(900), "id-secret");
    let secrets = [a.as_str(), "rt-secret", "dev-secret-1", id];
    let mut errors = Vec::new();

    // a sign-in that ends well, one the user declines, a refresh that renews, one that is revoked, one that is denied
    let store = Arc::new(MemoryStore::default());
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply()).then(
        "/oauth2/token",
        200,
        &tokens_reply(&a, "rt-secret"),
    );
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    errors.push(ended(&events).await.message);
    store.set("boopis.xai", ACCESS, &access(-5)).unwrap();
    script.then(
        "/oauth2/token",
        200,
        &tokens_reply(&access(900), "rt-secret-2"),
    );
    svc.refresh_if_due().await.unwrap();
    store.set("boopis.xai", ACCESS, &access(-5)).unwrap();
    script.then(
        "/oauth2/token",
        400,
        &json!({"error": "invalid_grant", "refresh_token": "rt-secret"}),
    );
    svc.refresh_if_due().await.unwrap();
    store_signed_in(&store, &access(-5), "rt-secret");
    script.then("/oauth2/token", 403, &json!({"detail": "rt-secret"}));
    svc.refresh_if_due().await.unwrap();
    store_signed_in(&store, &access(3600), "rt-secret");
    script.fail("/oauth2/revoke");
    svc.sign_out().await.unwrap();
    for body in [
        json!({"user_code": "x", "device_code": "dev-secret-1"}),
        json!({"access_token": "rt-secret"}),
    ] {
        let s = Script::default();
        s.then("device/code", 500, &body).then("token", 500, &body);
        errors.push(
            oauth::request_code(&s, &Endpoints::xai())
                .unwrap_err()
                .to_string(),
        );
        let code = {
            let ok = Script::default();
            ok.then("device/code", 200, &code_reply());
            oauth::request_code(&ok, &Endpoints::xai()).unwrap()
        };
        errors.push(match oauth::poll(&s, &Endpoints::xai(), &code) {
            Err(e) => e.to_string(),
            Ok(_) => String::new(),
        });
    }
    let logged = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
    assert!(logged.contains("xAI"), "the app did log: {logged}");
    for s in secrets {
        assert!(!logged.contains(s), "a secret reached the log: {s}");
        assert!(
            errors.iter().all(|e| !e.contains(s)),
            "a secret reached an error: {s}"
        );
    }
    let ps = svc.provider_state().await.unwrap();
    assert!(format!("{ps:?}").contains("SignedOut"));
    assert!(secrets.iter().all(|s| !format!("{ps:?}").contains(s)));
}

// ---------------------------------------------------------------- the real transport against a loopback server

/// What the loopback server was sent: the path, the content type and the body of each request.
type Seen = Vec<(String, String, String)>;

/// A loopback HTTP server that answers each request from `answers` in order and records what it was sent.
fn server(answers: Vec<(u16, Value)>) -> (String, std::thread::JoinHandle<Seen>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for (status, body) in answers {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let (mut len, mut ctype) = (0usize, String::new());
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let l = line.trim_end();
                if l.is_empty() {
                    break;
                }
                let lower = l.to_ascii_lowercase();
                if let Some(v) = lower.strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
                if let Some(v) = lower.strip_prefix("content-type:") {
                    ctype = v.trim().to_owned();
                }
            }
            let mut buf = vec![0u8; len];
            reader.read_exact(&mut buf).unwrap();
            seen.push((
                first
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or_default()
                    .to_owned(),
                ctype,
                String::from_utf8(buf).unwrap(),
            ));
            let text = body.to_string();
            let mut stream = reader.into_inner();
            write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len()).unwrap();
        }
        seen
    });
    (base, handle)
}

#[test]
fn the_real_transport_sends_the_flow_s_requests_to_the_issuer() {
    let (base, handle) = server(vec![
        (
            200,
            json!({
                "device_code": "d", "user_code": "U-1", "verification_uri": format!("http://127.0.0.1:1/device"),
                "expires_in": 600, "interval": 2
            }),
        ),
        (400, pending()),
        (400, json!({"error": "slow_down"})),
        (200, tokens_reply("a", "r")),
        (200, tokens_reply("a2", "r2")),
        (400, json!({"error": "invalid_grant"})),
        (200, json!({})),
    ]);
    let ep = Endpoints::at(&base).unwrap();
    let t = crate::chatgpt::oauth::Https::new(Duration::from_secs(10));
    let code = oauth::request_code(&t, &ep).unwrap();
    assert_eq!((code.user_code.as_str(), code.interval), ("U-1", 2));
    assert!(matches!(
        oauth::poll(&t, &ep, &code).unwrap(),
        oauth::Poll::Pending
    ));
    assert!(matches!(
        oauth::poll(&t, &ep, &code).unwrap(),
        oauth::Poll::SlowDown
    ));
    let oauth::Poll::Approved(got) = oauth::poll(&t, &ep, &code).unwrap() else {
        panic!("approved");
    };
    assert_eq!((got.access.as_str(), got.refresh.as_str()), ("a", "r"));
    assert!(got.expires_at.is_some());
    let oauth::Refreshed::Tokens(next) = oauth::refresh(&t, &ep, "r").unwrap() else {
        panic!("renewed");
    };
    assert_eq!(next.refresh, "r2");
    assert!(matches!(
        oauth::refresh(&t, &ep, "r2").unwrap(),
        oauth::Refreshed::Revoked
    ));
    oauth::revoke(&t, &ep, "r2").unwrap();
    let seen = handle.join().unwrap();
    let paths: Vec<&str> = seen.iter().map(|s| s.0.as_str()).collect();
    assert_eq!(
        paths,
        [
            "/oauth2/device/code",
            "/oauth2/token",
            "/oauth2/token",
            "/oauth2/token",
            "/oauth2/token",
            "/oauth2/token",
            "/oauth2/revoke"
        ]
    );
    assert!(
        seen.iter()
            .all(|s| s.1 == "application/x-www-form-urlencoded")
    );
    assert!(form_of(&seen[6].2).contains(&("token".into(), "r2".into())));
}

#[test]
fn an_issuer_must_be_https_or_this_computer() {
    assert!(Endpoints::at("https://auth.example.com/").is_ok());
    assert!(Endpoints::at("http://127.0.0.1:9/").is_ok());
    assert!(Endpoints::at("http://auth.x.ai").is_err());
    assert!(Endpoints::at("file:///etc").is_err());
}

// ---------------------------------------------------------------- the three ways, and the offered-when rule

struct Fake(Probe);

#[async_trait]
impl GrokCli for Fake {
    async fn probe(&self) -> Probe {
        self.0.clone()
    }
}

fn probe(state: cli::State) -> Probe {
    Probe {
        state,
        version: Some("1.0.41".into()),
        plan: Some("SuperGrok".into()),
        detail: "grok 1.0.41 is signed in (SuperGrok).".into(),
    }
}

#[tokio::test]
async fn the_three_ways_show_coherent_states_and_the_program_is_offered_only_while_the_sign_in_is_not_in_use()
 {
    let store = Arc::new(MemoryStore::default());
    let (svc, _) = service(&Arc::new(Script::default()), &store);
    let key = ProviderState::needs_key("xai", "xai.key");
    let grok = Fake(probe(cli::State::SignedIn));

    // signed out: all three, in the catalogue's order, each consistent
    let all = svc.way_states(key.clone(), &grok).await.unwrap();
    let ways: Vec<&str> = all.iter().map(|s| s.way.as_str()).collect();
    assert_eq!(ways, ["xai.signin", "xai.key", "xai.cli"]);
    assert!(all.iter().all(ProviderState::is_consistent));
    assert!(all.iter().all(|s| s.provider == "xai"));
    assert_eq!(all[0].status, ProviderStatus::SignedOut);
    assert_eq!(all[2].status, ProviderStatus::Connected);
    assert_eq!(all[2].plan.as_deref(), Some("SuperGrok"));

    // signed in: the program is not offered (and not even run)
    store_signed_in(&store, &access(900), "rt");
    let all = svc.way_states(key.clone(), &grok).await.unwrap();
    let ways: Vec<&str> = all.iter().map(|s| s.way.as_str()).collect();
    assert_eq!(ways, ["xai.signin", "xai.key"]);
    assert_eq!(all[0].status, ProviderStatus::Connected);

    // the rule itself, as the catalogue words it
    assert!(OfferedWhen::Always.offered(true) && OfferedWhen::Always.offered(false));
    assert!(OfferedWhen::SigninUnused.offered(false));
    assert!(!OfferedWhen::SigninUnused.offered(true));
    assert!(cli::offered(false) && !cli::offered(true));
    // and the catalogue marks exactly the program's way with it
    let cat = crate::providers::catalogue();
    let (_, way) = cat.way("xai.cli").unwrap();
    assert_eq!(way.offered_when, OfferedWhen::SigninUnused);
    assert_eq!(
        cat.way("xai.signin").unwrap().1.offered_when,
        OfferedWhen::Always
    );
    assert_eq!(
        cat.way("xai.key").unwrap().1.offered_when,
        OfferedWhen::Always
    );
}

#[tokio::test(start_paused = true)]
async fn a_waiting_sign_in_counts_as_in_use_and_a_refused_one_does_not() {
    let store = Arc::new(MemoryStore::default());
    let script = Arc::new(Script::default());
    script.then("/oauth2/device/code", 200, &code_reply());
    let (svc, _) = service(&script, &store);
    svc.start().await.unwrap();
    let key = ProviderState::needs_key("xai", "xai.key");
    let grok = Fake(probe(cli::State::SignedOut));
    let ways = svc.way_states(key.clone(), &grok).await.unwrap();
    assert_eq!(
        ways.len(),
        2,
        "while a code waits the program is not offered"
    );
    svc.cancel();

    let store = Arc::new(MemoryStore::default());
    let script = Arc::new(Script::default());
    script
        .then("/oauth2/device/code", 200, &code_reply())
        .then("/oauth2/token", 403, &json!({}));
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    ended(&events).await;
    let ways = svc.way_states(key, &grok).await.unwrap();
    assert_eq!(ways.len(), 3, "a refused account is offered the program");
    assert_eq!(ways[0].status, ProviderStatus::Error);
    assert_eq!(ways[2].status, ProviderStatus::SignedOut);
}

// ---------------------------------------------------------------- the grok program

#[test]
fn each_state_of_the_program_has_its_own_words_and_the_install_command() {
    let missing = cli::assess(false, None, None);
    assert_eq!(missing.state, cli::State::NotInstalled);
    assert!(
        missing.detail.contains("https://x.ai/cli/install.sh")
            || missing.detail.contains("install.ps1")
    );
    assert!(missing.detail.contains("grok login"));
    assert!(missing.version.is_none() && !missing.usable());

    let old = cli::assess(true, Some("grok 1.0.40 (abc)"), Some("You are logged in"));
    assert_eq!(old.state, cli::State::OldVersion);
    assert!(old.detail.contains("1.0.41"));
    let unreadable = cli::assess(true, Some("no version here"), Some("You are logged in"));
    assert_eq!(unreadable.state, cli::State::OldVersion);

    for text in [
        "You are not authenticated",
        "authentication required\nYou are logged in",
        "",
    ] {
        let out = cli::assess(true, Some("grok 1.0.41"), Some(text));
        assert_eq!(out.state, cli::State::SignedOut, "{text:?}");
        assert!(out.detail.contains("grok login"));
    }
    assert_eq!(
        cli::assess(true, Some("grok 1.0.41"), None).state,
        cli::State::SignedOut
    );

    let ok = cli::assess(
        true,
        Some("grok 1.0.70 (4220f3b224a6)"),
        Some("Models:\n  grok-4.7\nYou are logged in with SuperGrok.\n"),
    );
    assert_eq!(ok.state, cli::State::SignedIn);
    assert!(ok.usable());
    assert_eq!(ok.plan.as_deref(), Some("SuperGrok"));
    assert_eq!(ok.version.as_deref(), Some("1.0.70"));
    let no_plan = cli::assess(true, Some("1.0.41"), Some("You are logged in"));
    assert_eq!((no_plan.state, no_plan.plan), (cli::State::SignedIn, None));

    // the way's state is never an error, and says what to do
    let s = cli::provider_state(&missing);
    assert!(s.is_consistent() && s.status == ProviderStatus::SignedOut && s.way == "xai.cli");
    assert!(s.detail.unwrap().contains("not installed"));
    assert_eq!(cli::provider_state(&ok).status, ProviderStatus::Connected);
}

#[cfg(unix)]
#[tokio::test]
async fn the_program_is_found_the_way_the_plugin_finds_it_and_asked_only_its_own_two_questions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let script = |name: &str, body: &str| {
        let p = dir.path().join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    };
    let fake = script(
        "grok",
        "case \"$1\" in --version) echo 'grok 1.0.41 (abc)';; models) echo 'You are logged in with SuperGrok'; echo \"$XAI_API_KEY$HOME_SECRET\";; *) exit 3;; esac",
    );
    let env = |extra: &[(&str, &str)]| -> HashMap<String, String> {
        let mut e: HashMap<String, String> =
            [("PATH".to_owned(), dir.path().display().to_string())].into();
        e.extend(
            extra
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned())),
        );
        e
    };
    // on PATH
    assert_eq!(cli::resolve(&env(&[])), Some(fake.clone()));
    // an override wins, and is never second-guessed
    let other = script("my-grok", "echo other");
    assert_eq!(
        cli::resolve(&env(&[("GROK_CLI_PATH", other.to_str().unwrap())])),
        Some(other.clone())
    );
    assert_eq!(
        cli::resolve(&env(&[("HERMES_GROK_ACP_COMMAND", "/nonexistent/grok")])),
        None
    );
    // the installer's own directory, when it is not on PATH
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".grok/bin")).unwrap();
    let installed = home.path().join(".grok/bin/grok");
    std::fs::copy(&fake, &installed).unwrap();
    let e: HashMap<String, String> =
        [("HOME".to_owned(), home.path().display().to_string())].into();
    assert_eq!(cli::resolve(&e), Some(installed));
    // a relative HOME gives nothing
    let e: HashMap<String, String> = [("HOME".to_owned(), "relative/home".to_owned())].into();
    assert!(
        !cli::install_dirs(&e)
            .iter()
            .any(|p| p.starts_with("relative"))
    );

    // the probe runs only `--version` and `models`, with a clean environment: a key in the host's never reaches it
    let p = cli::SystemGrok::with_env(env(&[])).probe().await;
    assert_eq!(p.state, cli::State::SignedIn);
    assert_eq!(p.plan.as_deref(), Some("SuperGrok"));
    let child = cli::child_env_from([
        ("PATH".to_owned(), "/bin".to_owned()),
        ("XAI_API_KEY".to_owned(), "sk-secret".to_owned()),
        ("GROK_HOME".to_owned(), "/home/u/.grok".to_owned()),
        ("GROK_CLI_PATH".to_owned(), "/x/grok".to_owned()),
        ("HERMES_GROK_ACP_COMMAND".to_owned(), "/y/grok".to_owned()),
    ]);
    assert!(!child.contains_key("XAI_API_KEY"));
    assert!(child.contains_key("GROK_HOME") && child.contains_key("HERMES_GROK_ACP_COMMAND"));

    let none = cli::SystemGrok::with_env(HashMap::from([(
        "PATH".to_owned(),
        "/nonexistent".to_owned(),
    )]))
    .probe()
    .await;
    assert_eq!(none.state, cli::State::NotInstalled);
}

#[test]
fn not_a_secret_reaches_the_error_type_of_a_wrong_way() {
    let e = Error::Provider(
        "hx.provider.unsupported",
        "xai.cli has no sign-in that boopis runs".into(),
    );
    assert_eq!(e.code(), "hx.provider.unsupported");
}
