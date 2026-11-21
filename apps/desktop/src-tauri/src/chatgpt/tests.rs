//! The ChatGPT sign-in against a scripted OpenAI and a real loopback listener: the program's flow's ends (approved, a returning
//! account, cancelled, timed out, declined, a stray request, refused, a bad ID token, plan use not allowed, another account),
//! what reaches the keychain, the refresh (renewed, rotated, revoked, client gone, rate-limited) on both routes, sign-out,
//! the migration of a sign-in made before the program, a locked keychain, and the real HTTPS transport against a loopback
//! server.
//!
//! The ID tokens are really signed (RS256) with a throwaway test key (`testdata/test-signing-key.p8.b64`, made for these tests
//! only; it signs nothing else) and checked against the key set the scripted service publishes.

#![allow(clippy::many_single_char_names)]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::oauth::{self, Endpoints, Reply, Transport};
use super::{
    ACCESS, BASE_URL, Browser, ChatGpt, ChatgptSigninEvent, ID_TOKEN, REFRESH, REGISTRATION, Route,
    State, Timing, due,
};
use crate::error::Error;
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;

const KEY: &str = include_str!("testdata/test-signing-key.p8.b64");

fn key_pair() -> ring::signature::RsaKeyPair {
    let der = oauth::b64url_decode(KEY.trim()).unwrap();
    ring::signature::RsaKeyPair::from_pkcs8(&der).unwrap()
}

fn json_b64(v: &Value) -> String {
    oauth::b64url_encode(v.to_string().as_bytes())
}

/// A JWT-shaped token whose payload is `claims` (no signature: nothing here checks one).
fn jwt(claims: &Value) -> String {
    format!(
        "{}.{}.sig",
        json_b64(&json!({"alg": "none"})),
        json_b64(claims)
    )
}

/// An ID token really signed with the test key.
fn id_token(claims: &Value) -> String {
    let head = json_b64(&json!({"alg": "RS256", "kid": "k1", "typ": "JWT"}));
    let signed = format!("{head}.{}", json_b64(claims));
    let pair = key_pair();
    let mut sig = vec![0u8; pair.public().modulus_len()];
    pair.sign(
        &ring::signature::RSA_PKCS1_SHA256,
        &ring::rand::SystemRandom::new(),
        signed.as_bytes(),
        &mut sig,
    )
    .unwrap();
    format!("{signed}.{}", oauth::b64url_encode(&sig))
}

fn jwks() -> Value {
    let pair = key_pair();
    let public = ring::rsa::PublicKeyComponents::<Vec<u8>>::from(pair.public());
    json!({"keys": [{
        "kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig",
        "n": oauth::b64url_encode(&public.n),
        "e": oauth::b64url_encode(&public.e),
    }]})
}

fn now() -> u64 {
    super::now()
}

/// An access token that expires `secs` from now, issued a day before its expiry (so it is "due" only by the margin).
fn access(secs: i64) -> String {
    let exp = now().cast_signed() + secs;
    jwt(
        &json!({"exp": exp, "iat": exp - 3600 * 24, "aud": "https://api.openai.com/v1",
        "scope": "chatgpt.tokens.use.direct openid", "https://api.openai.com/auth": {"opaque": "x"}}),
    )
}

/// The claims of a good ID token for the attempt whose nonce is `nonce`.
fn claims(client: &str, nonce: &str, sub: &str) -> Value {
    let t = now();
    json!({"iss": oauth::ISSUER, "aud": client, "sub": sub, "exp": t + 3600, "iat": t, "nonce": nonce,
        "email": "ada@example.com", "https://api.openai.com/auth": {"chatgpt_plan_type": "pro"}})
}

const PLAN_SCOPES: &str =
    "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";

type Seen = Vec<(String, String, String)>;

enum Reply1 {
    Post(String, std::result::Result<Reply, String>),
    Get(String, std::result::Result<Reply, String>),
}

#[derive(Default)]
struct Script {
    replies: Mutex<VecDeque<Reply1>>,
    seen: Mutex<Seen>,
}

impl Script {
    fn post(&self, url_end: &str, status: u16, body: &Value) -> &Self {
        self.replies.lock().unwrap().push_back(Reply1::Post(
            url_end.to_owned(),
            Ok(Reply {
                status,
                body: body.to_string(),
            }),
        ));
        self
    }
    fn get(&self, url_end: &str, status: u16, body: &Value) -> &Self {
        self.replies.lock().unwrap().push_back(Reply1::Get(
            url_end.to_owned(),
            Ok(Reply {
                status,
                body: body.to_string(),
            }),
        ));
        self
    }
    fn fail(&self, url_end: &str) -> &Self {
        self.replies.lock().unwrap().push_back(Reply1::Post(
            url_end.to_owned(),
            Err("connection refused".into()),
        ));
        self
    }
    fn seen(&self) -> Seen {
        self.seen.lock().unwrap().clone()
    }
    fn next(&self, url: &str, get: bool, body: &str) -> std::result::Result<Reply, String> {
        self.seen.lock().unwrap().push((
            url.to_owned(),
            if get { "GET" } else { "POST" }.to_owned(),
            body.to_owned(),
        ));
        let reply = self.replies.lock().unwrap().pop_front();
        let (want, reply, was_get) = match reply {
            Some(Reply1::Post(w, r)) => (w, r, false),
            Some(Reply1::Get(w, r)) => (w, r, true),
            None => return Err("no more replies scripted".into()),
        };
        assert!(
            url.ends_with(&want),
            "{url} was asked, the script expected …{want}"
        );
        assert_eq!(was_get, get, "{url}: GET and POST mixed up");
        reply
    }
}

impl Transport for Script {
    fn post(&self, url: &str, _ct: &str, body: &str) -> std::result::Result<Reply, String> {
        self.next(url, false, body)
    }
    fn get(&self, url: &str, _headers: &[(&str, &str)]) -> std::result::Result<Reply, String> {
        self.next(url, true, "")
    }
}

/// Records the address the host opened, as the browser would.
#[derive(Default)]
struct Recorder(Mutex<Vec<String>>);

impl Browser for Recorder {
    fn open(&self, url: &str) -> bool {
        self.0.lock().unwrap().push(url.to_owned());
        true
    }
}

impl Recorder {
    fn last(&self) -> Option<String> {
        self.0.lock().unwrap().last().cloned()
    }
}

fn timing() -> Timing {
    Timing {
        signin: Duration::from_secs(20),
        refresh_ahead: Duration::from_mins(30),
        refresh_every: Duration::from_mins(5),
    }
}

type Events = Arc<Mutex<Vec<ChatgptSigninEvent>>>;

struct Rig {
    svc: Arc<ChatGpt>,
    events: Events,
    browser: Arc<Recorder>,
    script: Arc<Script>,
    store: Arc<MemoryStore>,
}

fn rig_with(store: Arc<MemoryStore>, signin: Duration) -> Rig {
    let script = Arc::new(Script::default());
    let events: Events = Arc::default();
    let sink = events.clone();
    let browser = Arc::new(Recorder::default());
    let svc = ChatGpt::new(store.clone(), script.clone(), Timing { signin, ..timing() })
        .with_port(0)
        .with_browser(browser.clone())
        .with_sink(Arc::new(move |e| sink.lock().unwrap().push(e)));
    Rig {
        svc: Arc::new(svc),
        events,
        browser,
        script,
        store,
    }
}

fn rig() -> Rig {
    rig_with(Arc::new(MemoryStore::default()), Duration::from_secs(20))
}

fn kept(store: &MemoryStore, name: &str) -> Option<String> {
    store.get("boopis.chatgpt", name).unwrap()
}

fn registration(store: &MemoryStore) -> Value {
    kept(store, REGISTRATION).map_or(Value::Null, |t| serde_json::from_str(&t).unwrap())
}

async fn ended(events: &Events) -> ChatgptSigninEvent {
    for _ in 0..1000 {
        if let Some(e) = events.lock().unwrap().first().cloned() {
            return e;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the sign-in never ended");
}

fn query(url: &str) -> std::collections::HashMap<String, String> {
    url::Url::parse(url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

/// What a browser does after the person signs in: a `GET` of the redirect address. Returns the page it was answered with.
async fn browse(redirect: &str, params: &[(&str, &str)]) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let url = url::Url::parse(redirect).unwrap();
    let port = url.port().unwrap();
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in params {
        q.append_pair(k, v);
    }
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let req = format!(
        "GET {}?{} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/html\r\n\r\n",
        url.path(),
        q.finish()
    );
    s.write_all(req.as_bytes()).await.unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).await.unwrap();
    out
}

/// Script the service's side of a good sign-in for the attempt that opened `url`, and answer it as the browser would.
async fn approve(r: &Rig, url: &str, issued: &str, sub: &str, scope: &str) -> String {
    let q = query(url);
    let id = id_token(&claims(issued, &q["nonce"], sub));
    r.script
        .post(
            "/api/accounts/oauth/token",
            200,
            &json!({"access_token": access(3600), "refresh_token": "rt-1", "id_token": id,
                "token_type": "Bearer", "expires_in": 3600, "scope": scope}),
        )
        .get("/.well-known/jwks.json", 200, &jwks());
    let mut params = vec![("code", "ac-1"), ("state", q["state"].as_str())];
    if q["client_id"] == oauth::DYNAMIC_CLIENT {
        params.push(("client_id", issued));
    }
    browse(&q["redirect_uri"], &params).await
}

#[tokio::test]
async fn a_first_sign_in_registers_boopis_and_keeps_what_is_checked_in_the_keychain() {
    let r = rig();
    let view = r.svc.start().await.unwrap();
    let url = r.browser.last().expect("the browser was opened");
    let q = query(&url);

    // the authorization request, as the program specifies it
    assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
    assert_eq!(q["client_id"], "dynamic_agent_client");
    assert_eq!(q["agent_name_hint"], "boopis");
    assert_eq!(q["response_type"], "code");
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["resource"], "https://api.openai.com/v1");
    assert_eq!(q["scope"], oauth::SCOPE);
    assert!(q["redirect_uri"].starts_with("http://127.0.0.1:"));
    assert!(q["redirect_uri"].ends_with("/auth/callback"));
    assert!(q["ext_agent_host_id"].starts_with("urn:uuid:"));
    assert!(!q.contains_key("id_token_hint") && !q.contains_key("prompt"));
    // the card gets an address with no token in it, nothing to type, and the same attempt
    assert_eq!(view.user_code, "");
    assert_eq!(query(&view.verification_url)["state"], q["state"]);
    // a second start while it waits is the same attempt: nothing new is opened
    assert_eq!(r.svc.start().await.unwrap(), view);
    assert_eq!(r.browser.0.lock().unwrap().len(), 1);
    let st = r.svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.code.as_ref()),
        (State::SigningIn, Some(&view))
    );
    // the host id is kept before the first sign-in finishes
    assert_eq!(registration(&r.store)["host_id"], q["ext_agent_host_id"]);

    let page = approve(&r, &url, "oaiapp_1", "user-1", PLAN_SCOPES).await;
    assert!(page.contains("signed in to ChatGPT"), "{page}");
    let e = ended(&r.events).await;
    assert_eq!(e.outcome, "signed_in", "{}", e.message);

    let reg = registration(&r.store);
    assert_eq!(reg["client_id"], "oaiapp_1");
    assert_eq!(reg["subject"], "user-1");
    assert_eq!(reg["email"], "ada@example.com");
    assert!(kept(&r.store, ACCESS).is_some() && kept(&r.store, ID_TOKEN).is_some());
    assert_eq!(kept(&r.store, REFRESH).as_deref(), Some("rt-1"));
    assert_eq!(
        kept(&r.store, BASE_URL).as_deref(),
        Some("https://api.openai.com/v1")
    );
    let st = r.svc.status().await.unwrap();
    assert_eq!(
        (
            st.state,
            st.route,
            st.plan.as_deref(),
            st.account.as_deref(),
            st.notice
        ),
        (
            State::SignedIn,
            Some(Route::Program),
            Some("pro"),
            Some("ada@example.com"),
            None
        )
    );

    // the exchange: the issued client, the verifier that matches the challenge, the same redirect, the resource, no secret
    let seen = r.script.seen();
    assert_eq!(seen.len(), 2);
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(seen[0].2.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["client_id"], "oaiapp_1");
    assert_eq!(form["redirect_uri"], q["redirect_uri"]);
    assert_eq!(form["resource"], "https://api.openai.com/v1");
    assert_eq!(
        oauth::challenge(&form["code_verifier"]),
        q["code_challenge"]
    );
    assert!(!form.contains_key("client_secret"));
}

#[tokio::test]
async fn a_returning_account_reuses_its_client_and_host_id_and_names_nothing_twice() {
    let r = rig();
    r.svc.start().await.unwrap();
    let first = query(&r.browser.last().unwrap());
    approve(
        &r,
        &r.browser.last().unwrap(),
        "oaiapp_1",
        "user-1",
        PLAN_SCOPES,
    )
    .await;
    ended(&r.events).await;
    r.events.lock().unwrap().clear();

    // sign out: OpenAI is asked to end the session with the issued client; the registration stays
    r.script.post("/api/accounts/oauth/revoke", 200, &json!({}));
    let out = r.svc.sign_out().await.unwrap();
    assert!(out.revoked);
    let revoke = r.script.seen().last().unwrap().clone();
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(revoke.2.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(
        (form["token"].as_str(), form["client_id"].as_str()),
        ("rt-1", "oaiapp_1")
    );
    assert_eq!(form["token_type_hint"], "refresh_token");
    assert_eq!(kept(&r.store, ACCESS), None);
    assert_eq!(kept(&r.store, ID_TOKEN), None);
    assert_eq!(kept(&r.store, BASE_URL), None);
    assert_eq!(registration(&r.store)["client_id"], "oaiapp_1");

    // the next sign-in: the saved client, the same host id, the email as a hint, and no name (that goes on registration only)
    r.svc.start().await.unwrap();
    let again = query(&r.browser.last().unwrap());
    assert_eq!(again["client_id"], "oaiapp_1");
    assert_eq!(again["ext_agent_host_id"], first["ext_agent_host_id"]);
    assert_eq!(again["login_hint"], "ada@example.com");
    assert!(!again.contains_key("agent_name_hint"));
    // the callback of a returning account may carry no client id
    approve(
        &r,
        &r.browser.last().unwrap(),
        "oaiapp_1",
        "user-1",
        PLAN_SCOPES,
    )
    .await;
    assert_eq!(ended(&r.events).await.outcome, "signed_in");
    assert_eq!(r.svc.status().await.unwrap().state, State::SignedIn);
}

#[tokio::test]
async fn cancelling_and_waiting_too_long_end_the_sign_in_and_store_nothing() {
    let r = rig();
    r.svc.start().await.unwrap();
    r.svc.cancel();
    assert_eq!(ended(&r.events).await.outcome, "cancelled");
    assert_eq!(kept(&r.store, ACCESS), None);
    assert_eq!(r.svc.status().await.unwrap().state, State::SignedOut);
    assert!(r.script.seen().is_empty(), "nothing was asked of OpenAI");

    let r = rig_with(Arc::new(MemoryStore::default()), Duration::from_millis(250));
    r.svc.start().await.unwrap();
    let e = ended(&r.events).await;
    assert_eq!(e.outcome, "timed_out");
    assert!(e.message.contains("Start again"), "{}", e.message);
    assert_eq!(kept(&r.store, REFRESH), None);
    // the listener is gone with the attempt: a late browser finds nobody
    let redirect = query(&r.browser.last().unwrap())["redirect_uri"].clone();
    let port = url::Url::parse(&redirect).unwrap().port().unwrap();
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn declining_in_the_browser_says_so_and_a_stray_request_does_not_end_the_wait() {
    let r = rig();
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    // a request with the wrong state (another page, a probe) is answered and ignored
    let page = browse(
        &q["redirect_uri"],
        &[("code", "stolen"), ("state", "not-mine")],
    )
    .await;
    assert!(page.starts_with("HTTP/1.1 400"), "{page}");
    assert!(
        r.events.lock().unwrap().is_empty(),
        "the sign-in is still waiting"
    );
    assert_eq!(r.svc.status().await.unwrap().state, State::SigningIn);

    let page = browse(
        &q["redirect_uri"],
        &[("error", "access_denied"), ("state", &q["state"])],
    )
    .await;
    assert!(page.contains("did not finish"), "{page}");
    let e = ended(&r.events).await;
    assert_eq!(e.outcome, "failed");
    assert!(
        e.message
            .contains("did not allow boopis to use your ChatGPT plan"),
        "{}",
        e.message
    );
    assert!(
        r.script.seen().is_empty(),
        "a declined sign-in exchanges nothing"
    );
    assert_eq!(kept(&r.store, ACCESS), None);
}

#[tokio::test]
async fn a_sign_in_without_plan_use_keeps_no_token_and_asks_for_consent_next_time() {
    let r = rig();
    r.svc.start().await.unwrap();
    let url = r.browser.last().unwrap();
    approve(
        &r,
        &url,
        "oaiapp_1",
        "user-1",
        "email openid profile offline_access",
    )
    .await;
    let e = ended(&r.events).await;
    assert_eq!(e.outcome, "failed");
    assert!(e.message.contains("allow it"), "{}", e.message);
    assert_eq!(
        (kept(&r.store, ACCESS), kept(&r.store, REFRESH)),
        (None, None)
    );
    let st = r.svc.status().await.unwrap();
    assert_eq!(st.state, State::SignedOut);
    assert!(
        st.notice
            .unwrap()
            .contains("without letting boopis use your ChatGPT plan")
    );

    r.events.lock().unwrap().clear();
    r.svc.start().await.unwrap();
    let again = query(&r.browser.last().unwrap());
    assert_eq!(again["client_id"], "oaiapp_1");
    assert_eq!(again["prompt"], "consent");
}

#[tokio::test]
async fn an_id_token_that_does_not_check_out_ends_the_sign_in_and_keeps_nothing() {
    for flaw in [
        "signature",
        "audience",
        "nonce",
        "issuer",
        "expired",
        "other account",
    ] {
        let store = Arc::new(MemoryStore::default());
        if flaw == "other account" {
            store
                .set(
                    "boopis.chatgpt",
                    REGISTRATION,
                    &json!({"client_id": "oaiapp_1", "subject": "user-0"}).to_string(),
                )
                .unwrap();
        }
        let r = rig_with(store, Duration::from_secs(20));
        r.svc.start().await.unwrap();
        let url = r.browser.last().unwrap();
        let q = query(&url);
        let mut c = claims("oaiapp_1", &q["nonce"], "user-1");
        match flaw {
            "audience" => c["aud"] = json!("oaiapp_other"),
            "nonce" => c["nonce"] = json!("replayed"),
            "issuer" => c["iss"] = json!("https://evil.example"),
            "expired" => c["exp"] = json!(now() - 3600),
            _ => {}
        }
        let mut id = id_token(&c);
        if flaw == "signature" {
            let (head, rest) = id.split_once('.').unwrap();
            let forged = json_b64(&claims("oaiapp_1", &q["nonce"], "someone-else"));
            id = format!("{head}.{forged}.{}", rest.rsplit('.').next().unwrap());
        }
        r.script
            .post(
                "/api/accounts/oauth/token",
                200,
                &json!({"access_token": access(3600), "refresh_token": "rt-1", "id_token": id, "scope": PLAN_SCOPES}),
            )
            .get("/.well-known/jwks.json", 200, &jwks());
        browse(
            &q["redirect_uri"],
            &[
                ("code", "c"),
                ("state", &q["state"]),
                ("client_id", "oaiapp_1"),
            ],
        )
        .await;
        let e = ended(&r.events).await;
        assert_eq!(e.outcome, "failed", "{flaw}");
        assert!(!e.message.contains("rt-1"), "{flaw}: {}", e.message);
        assert_eq!(
            (kept(&r.store, ACCESS), kept(&r.store, REFRESH)),
            (None, None),
            "{flaw}"
        );
        assert_eq!(
            r.svc.status().await.unwrap().state,
            State::SignedOut,
            "{flaw}"
        );
    }
}

#[tokio::test]
async fn a_refused_code_and_a_registration_openai_no_longer_knows_start_over_plainly() {
    // a first sign-in whose code OpenAI refuses
    let r = rig();
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    r.script.post(
        "/api/accounts/oauth/token",
        400,
        &json!({"error": "invalid_grant"}),
    );
    browse(
        &q["redirect_uri"],
        &[
            ("code", "c"),
            ("state", &q["state"]),
            ("client_id", "oaiapp_1"),
        ],
    )
    .await;
    let e = ended(&r.events).await;
    assert_eq!(e.outcome, "failed");
    assert!(e.message.contains("did not accept"), "{}", e.message);

    // a saved registration that is refused is dropped, so the next sign-in registers anew
    let store = Arc::new(MemoryStore::default());
    store
        .set(
            "boopis.chatgpt",
            REGISTRATION,
            &json!({"client_id": "oaiapp_gone", "host_id": "urn:uuid:h"}).to_string(),
        )
        .unwrap();
    let r = rig_with(store, Duration::from_secs(20));
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    assert_eq!(q["client_id"], "oaiapp_gone");
    r.script.post(
        "/api/accounts/oauth/token",
        400,
        &json!({"error": "invalid_client"}),
    );
    browse(&q["redirect_uri"], &[("code", "c"), ("state", &q["state"])]).await;
    assert_eq!(ended(&r.events).await.outcome, "failed");
    let reg = registration(&r.store);
    assert_eq!(
        (reg.get("client_id"), reg["host_id"].as_str()),
        (None, Some("urn:uuid:h"))
    );

    // OpenAI's callback answers for another client than the saved one
    let store = Arc::new(MemoryStore::default());
    store
        .set(
            "boopis.chatgpt",
            REGISTRATION,
            &json!({"client_id": "oaiapp_1"}).to_string(),
        )
        .unwrap();
    let r = rig_with(store, Duration::from_secs(20));
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    browse(
        &q["redirect_uri"],
        &[
            ("code", "c"),
            ("state", &q["state"]),
            ("client_id", "oaiapp_2"),
        ],
    )
    .await;
    let e = ended(&r.events).await;
    assert!(e.message.contains("another registration"), "{}", e.message);
    assert!(r.script.seen().is_empty());
}

#[tokio::test]
async fn unreachable_and_rate_limited_services_fail_with_words_and_keep_nothing() {
    let r = rig();
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    r.script.post("/api/accounts/oauth/token", 429, &json!({}));
    browse(
        &q["redirect_uri"],
        &[
            ("code", "c"),
            ("state", &q["state"]),
            ("client_id", "oaiapp_1"),
        ],
    )
    .await;
    let e = ended(&r.events).await;
    assert!(e.message.contains("Wait a minute"), "{}", e.message);

    let r = rig();
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    r.script.fail("/api/accounts/oauth/token");
    browse(
        &q["redirect_uri"],
        &[
            ("code", "c"),
            ("state", &q["state"]),
            ("client_id", "oaiapp_1"),
        ],
    )
    .await;
    let e = ended(&r.events).await;
    assert!(
        e.message.contains("could not reach OpenAI"),
        "{}",
        e.message
    );
    assert_eq!(kept(&r.store, ACCESS), None);
}

// ---------------------------------------------------------------- the refresh, on both routes

fn signed_in_on_the_program(store: &MemoryStore, access_token: &str) {
    store.set("boopis.chatgpt", ACCESS, access_token).unwrap();
    store.set("boopis.chatgpt", REFRESH, "rt-old").unwrap();
    store.set("boopis.chatgpt", ID_TOKEN, "id-old").unwrap();
    store
        .set("boopis.chatgpt", BASE_URL, oauth::RESOURCE)
        .unwrap();
    store
        .set("boopis.chatgpt", REGISTRATION, &json!({"client_id": "oaiapp_1", "host_id": "urn:uuid:h", "subject": "user-1", "email": "ada@example.com"}).to_string())
        .unwrap();
}

#[tokio::test]
async fn the_program_s_refresh_renews_a_token_that_is_due_and_keeps_the_rotated_refresh_token() {
    let r = rig();
    signed_in_on_the_program(&r.store, &access(60));
    let fresh = access(3600);
    r.script.post(
        "/api/accounts/oauth/token",
        200,
        &json!({"access_token": fresh, "refresh_token": "rt-new", "earliest_refresh_at": 1}),
    );
    assert!(r.svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&r.store, ACCESS).as_deref(), Some(fresh.as_str()));
    assert_eq!(kept(&r.store, REFRESH).as_deref(), Some("rt-new"));
    assert_eq!(
        kept(&r.store, ID_TOKEN).as_deref(),
        Some("id-old"),
        "the retained ID token stays"
    );
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(r.script.seen()[0].2.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(form["grant_type"], "refresh_token");
    assert_eq!(
        form["client_id"], "oaiapp_1",
        "the issued client, not the registration entry point"
    );
    assert_eq!(form["refresh_token"], "rt-old");
    assert_eq!(form["resource"], "https://api.openai.com/v1");
    assert!(
        !form.contains_key("scope"),
        "the grant is kept, not re-asked"
    );
    // fresh now: nothing is asked
    assert!(!r.svc.refresh_if_due().await.unwrap());
    assert_eq!(r.script.seen().len(), 1);

    // an answer without a new refresh token keeps the old one
    r.store.set("boopis.chatgpt", ACCESS, &access(10)).unwrap();
    r.script.post(
        "/api/accounts/oauth/token",
        200,
        &json!({"access_token": fresh}),
    );
    assert!(r.svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&r.store, REFRESH).as_deref(), Some("rt-new"));
}

#[tokio::test]
async fn a_revoked_session_signs_out_with_a_notice_and_a_rate_limit_keeps_the_tokens() {
    let r = rig();
    signed_in_on_the_program(&r.store, &access(-10));
    r.script
        .post("/api/accounts/oauth/token", 429, &json!({}))
        .post(
            "/api/accounts/oauth/token",
            400,
            &json!({"error": "refresh_token_reused"}),
        );
    assert_eq!(
        r.svc.refresh_if_due().await.unwrap_err().code(),
        "hx.signin.rate_limited"
    );
    assert_eq!(
        kept(&r.store, REFRESH).as_deref(),
        Some("rt-old"),
        "a rate limit is not a revocation"
    );
    assert!(!r.svc.refresh_if_due().await.unwrap());
    assert_eq!(
        (
            kept(&r.store, ACCESS),
            kept(&r.store, REFRESH),
            kept(&r.store, ID_TOKEN)
        ),
        (None, None, None)
    );
    let st = r.svc.status().await.unwrap();
    assert_eq!(st.state, State::SignedOut);
    assert!(st.notice.unwrap().contains("no longer accepts"));
    let e = r.events.lock().unwrap().first().cloned().unwrap();
    assert_eq!(e.outcome, "signed_out", "never silent");
    assert_eq!(
        registration(&r.store)["client_id"],
        "oaiapp_1",
        "the same client signs in again"
    );

    // OpenAI forgot the client (the person removed the app): the registration goes too
    let r = rig();
    signed_in_on_the_program(&r.store, &access(-10));
    r.script.post(
        "/api/accounts/oauth/token",
        401,
        &json!({"error": "invalid_client"}),
    );
    assert!(!r.svc.refresh_if_due().await.unwrap());
    assert_eq!(registration(&r.store).get("client_id"), None);
}

// ---------------------------------------------------------------- the sign-in from before the program

fn signed_in_before_the_program(store: &MemoryStore, access_token: &str) {
    store.set("boopis.chatgpt", ACCESS, access_token).unwrap();
    store.set("boopis.chatgpt", REFRESH, "rt-legacy").unwrap();
}

#[tokio::test]
async fn a_sign_in_from_before_the_program_keeps_working_says_so_and_moves_when_the_person_signs_in_again()
 {
    let r = rig();
    let old = access(60);
    signed_in_before_the_program(&r.store, &old);
    let st = r.svc.status().await.unwrap();
    assert_eq!((st.state, st.route), (State::SignedIn, Some(Route::Older)));
    assert!(st.notice.unwrap().contains("Sign in again"));
    assert!(r.svc.signed_in().await.unwrap());

    // it renews on the old route: the Codex client, at the old address
    let fresh = access(3600);
    r.script.post(
        "/oauth/token",
        200,
        &json!({"access_token": fresh, "refresh_token": "rt-legacy-2"}),
    );
    assert!(r.svc.refresh_if_due().await.unwrap());
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(r.script.seen()[0].2.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(form["client_id"], oauth::LEGACY_CLIENT_ID);
    assert!(!r.script.seen()[0].0.contains("/api/accounts/"));
    assert_eq!(kept(&r.store, REFRESH).as_deref(), Some("rt-legacy-2"));
    assert_eq!(
        kept(&r.store, BASE_URL),
        None,
        "the engine keeps the old address for it"
    );

    // the person signs in again: the program's tokens replace the old ones, and the address moves with them
    r.svc.start().await.unwrap();
    let url = r.browser.last().unwrap();
    assert_eq!(
        query(&url)["client_id"],
        "dynamic_agent_client",
        "a registration of its own, not the Codex client"
    );
    approve(&r, &url, "oaiapp_9", "user-1", PLAN_SCOPES).await;
    assert_eq!(ended(&r.events).await.outcome, "signed_in");
    let st = r.svc.status().await.unwrap();
    assert_eq!((st.route, st.notice), (Some(Route::Program), None));
    assert_eq!(
        kept(&r.store, BASE_URL).as_deref(),
        Some("https://api.openai.com/v1")
    );
    assert_ne!(kept(&r.store, REFRESH).as_deref(), Some("rt-legacy-2"));
}

#[tokio::test]
async fn an_older_sign_in_that_openai_refuses_is_signed_out_with_a_notice() {
    let r = rig();
    signed_in_before_the_program(&r.store, &access(-5));
    r.script.post(
        "/oauth/token",
        401,
        &json!({"error": "refresh_token_reused"}),
    );
    assert!(!r.svc.refresh_if_due().await.unwrap());
    let st = r.svc.status().await.unwrap();
    assert_eq!(st.state, State::SignedOut);
    assert!(
        st.notice.is_some(),
        "the person is told, not left with a sign-in that fails"
    );
    assert_eq!(r.events.lock().unwrap()[0].outcome, "signed_out");
}

#[tokio::test]
async fn signing_out_tells_when_openai_did_not_confirm_and_still_removes_the_tokens() {
    let r = rig();
    signed_in_on_the_program(&r.store, &access(3600));
    r.script
        .post("/api/accounts/oauth/revoke", 503, &json!({}))
        .post("/api/accounts/oauth/revoke", 503, &json!({}));
    assert!(r.svc.signed_in().await.unwrap());
    let out = r.svc.sign_out().await.unwrap();
    assert!(!out.revoked, "OpenAI never said it was done");
    assert!(!r.svc.signed_in().await.unwrap());

    // an older sign-in is ended with its own client
    let r = rig();
    signed_in_before_the_program(&r.store, &access(3600));
    r.script.post("/api/accounts/oauth/revoke", 200, &json!({}));
    assert!(r.svc.sign_out().await.unwrap().revoked);
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(r.script.seen()[0].2.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(form["client_id"], oauth::LEGACY_CLIENT_ID);
    assert_eq!(r.svc.status().await.unwrap().state, State::SignedOut);
}

// ---------------------------------------------------------------- a locked keychain, and no secret anywhere it should not be

/// A keychain that is locked: every call fails, as the Secret Service does before it is unlocked.
struct Locked;

impl SecretStore for Locked {
    fn set(&self, _: &str, _: &str, _: &str) -> crate::error::Result<()> {
        Err(Error::SecretsUnavailable("locked".into()))
    }
    fn get(&self, _: &str, _: &str) -> crate::error::Result<Option<String>> {
        Err(Error::SecretsUnavailable("locked".into()))
    }
    fn delete(&self, _: &str, _: &str) -> crate::error::Result<()> {
        Err(Error::SecretsUnavailable("locked".into()))
    }
}

#[tokio::test]
async fn a_locked_keychain_fails_closed_before_anything_is_opened_or_asked() {
    let script = Arc::new(Script::default());
    let browser = Arc::new(Recorder::default());
    let svc = Arc::new(
        ChatGpt::new(Arc::new(Locked), script.clone(), timing())
            .with_port(0)
            .with_browser(browser.clone()),
    );
    for e in [
        svc.status().await.map(|_| ()).unwrap_err(),
        svc.start().await.map(|_| ()).unwrap_err(),
        svc.refresh_if_due().await.map(|_| ()).unwrap_err(),
        svc.sign_out().await.map(|_| ()).unwrap_err(),
        svc.signed_in().await.map(|_| ()).unwrap_err(),
    ] {
        assert_eq!(e.code(), "hx.secrets.unavailable");
    }
    assert!(browser.0.lock().unwrap().is_empty(), "no page was opened");
    assert!(script.seen().is_empty(), "nothing was asked of OpenAI");
}

#[tokio::test]
async fn no_token_reaches_a_message_an_error_or_a_debug_print() {
    // OpenAI's body, with the secrets in it, is never echoed
    let r = rig();
    r.svc.start().await.unwrap();
    let q = query(&r.browser.last().unwrap());
    r.script.post(
        "/api/accounts/oauth/token",
        500,
        &json!({"access_token": "LEAK-access", "refresh_token": "LEAK-refresh", "detail": "LEAK-body"}),
    );
    browse(
        &q["redirect_uri"],
        &[
            ("code", "LEAK-code"),
            ("state", &q["state"]),
            ("client_id", "oaiapp_1"),
        ],
    )
    .await;
    let e = ended(&r.events).await;
    assert!(!e.message.contains("LEAK"), "{}", e.message);

    let t = oauth::Tokens {
        access: "LEAK-a".into(),
        refresh: "LEAK-r".into(),
        id: Some("LEAK-i".into()),
    };
    assert_eq!(format!("{t:?}"), "Tokens(<redacted>)");
    let a = oauth::Attempt::new(
        "http://127.0.0.1:1/auth/callback".into(),
        "urn:uuid:h".into(),
        None,
    )
    .unwrap();
    assert!(!format!("{a:?}").contains(&a.verifier) && !format!("{a:?}").contains(&a.state));
    let id = oauth::Identity {
        subject: "LEAK-sub".into(),
        email: Some("LEAK-mail".into()),
        plan: None,
    };
    assert!(!format!("{id:?}").contains("LEAK"));

    // the status the webview gets carries no token
    let r = rig();
    signed_in_on_the_program(&r.store, &access(3600));
    let status = serde_json::to_string(&r.svc.status().await.unwrap()).unwrap();
    assert!(
        !status.contains("rt-old") && !status.contains("id-old"),
        "{status}"
    );
    assert!(!status.contains(&kept(&r.store, ACCESS).unwrap()));
}

// ---------------------------------------------------------------- the pure parts

#[test]
fn a_token_is_due_inside_the_margin_or_half_its_life_and_when_it_names_no_expiry() {
    let t = 1_000_000;
    let ahead = Duration::from_mins(30);
    let tok = |exp: u64, iat: u64| jwt(&json!({"exp": exp, "iat": iat}));
    assert!(!due(&tok(t + 3600, t - 3600 * 23), ahead, t));
    assert!(due(&tok(t + 1000, t - 3600 * 23), ahead, t));
    // a token that lives 20 minutes is renewed at half its life, not 30 minutes early (which would be always)
    assert!(!due(&tok(t + 900, t - 300), ahead, t));
    assert!(due(&tok(t + 500, t - 700), ahead, t));
    assert!(due("not-a-jwt", ahead, t));
    assert_eq!(oauth::plan(&tok(1, 0)), None);
}

#[test]
fn an_issuer_must_be_https_or_this_computer() {
    assert!(Endpoints::at("https://auth.example.com/").is_ok());
    assert!(Endpoints::at("http://127.0.0.1:9/").is_ok());
    assert!(Endpoints::at("http://auth.example.com").is_err());
    assert!(Endpoints::at("file:///etc").is_err());
}

#[test]
fn the_pkce_challenge_is_the_rfc_s_and_host_ids_are_uuids() {
    // RFC 7636 appendix B
    assert_eq!(
        oauth::challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    let id = oauth::new_host_id().unwrap();
    let u = id.strip_prefix("urn:uuid:").unwrap();
    assert_eq!(uuid::Uuid::parse_str(u).unwrap().get_version_num(), 4);
    assert_ne!(oauth::new_host_id().unwrap(), id);
    assert_eq!(
        oauth::b64url_decode(&oauth::b64url_encode(b"\xff\xfe\x00ab")).unwrap(),
        b"\xff\xfe\x00ab"
    );
}

// ---------------------------------------------------------------- the real HTTPS transport, against a loopback server

/// What the loopback server was sent: the request line, the headers (lower-cased) and the body of each request.
type Wire = Vec<(String, Vec<String>, String)>;

/// A loopback HTTP server that answers each request from `answers` in order and records what it was sent.
fn server(answers: Vec<(u16, Value)>) -> (String, std::thread::JoinHandle<Wire>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for (status, body) in answers {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let (mut len, mut headers) = (0usize, Vec::new());
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
                headers.push(lower);
            }
            let mut buf = vec![0u8; len];
            reader.read_exact(&mut buf).unwrap();
            seen.push((
                first.trim_end().to_owned(),
                headers,
                String::from_utf8(buf).unwrap(),
            ));
            let text = body.to_string();
            let extra = if status == 302 {
                "Location: http://127.0.0.1:1/elsewhere\r\n"
            } else {
                ""
            };
            let mut stream = reader.into_inner();
            write!(stream, "HTTP/1.1 {status} X\r\n{extra}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len()).unwrap();
        }
        seen
    });
    (base, handle)
}

#[test]
fn the_real_transport_sends_the_program_s_requests_to_the_issuer_and_follows_no_redirect() {
    let a = oauth::Attempt::new(
        "http://127.0.0.1:9/auth/callback".into(),
        "urn:uuid:h".into(),
        None,
    )
    .unwrap();
    let claims = claims("oaiapp_1", &a.nonce, "user-1");
    let tokens = json!({"access_token": "a", "refresh_token": "r", "id_token": id_token(&claims), "scope": PLAN_SCOPES});
    let (base, handle) = server(vec![
        (200, tokens),
        (200, jwks()),
        (200, json!({"access_token": "a2"})),
        (200, json!({})),
        (302, json!({})),
    ]);
    let ep = Endpoints::at(&base).unwrap();
    let t = oauth::Https::new(Duration::from_secs(10));
    let oauth::Exchange::Tokens { tokens, scopes } =
        oauth::exchange(&t, &ep, "oaiapp_1", "ac", &a).unwrap()
    else {
        panic!("tokens");
    };
    assert_eq!(
        (tokens.access.as_str(), tokens.refresh.as_str()),
        ("a", "r")
    );
    assert!(scopes.iter().any(|s| s == oauth::PLAN_SCOPE));
    // the keys are fetched with a GET; the issuer in the token is the real one, so against this server it is refused
    let refused = oauth::verify_id_token(
        &t,
        &ep,
        tokens.id.as_deref().unwrap(),
        "oaiapp_1",
        &a.nonce,
        now(),
    )
    .unwrap_err();
    assert!(refused.to_string().contains("another issuer"), "{refused}");
    let oauth::Refreshed::Tokens(next) = oauth::refresh(&t, &ep, "oaiapp_1", "r", None).unwrap()
    else {
        panic!("renewed");
    };
    assert_eq!((next.access.as_str(), next.refresh.as_str()), ("a2", "r"));
    assert!(oauth::revoke(&t, &ep, "oaiapp_1", "r").unwrap());
    // a redirect is an answer, not a place to send a token
    let r = t
        .get(&format!("{base}/anything"), &[("authorization", "token t")])
        .unwrap();
    assert_eq!(r.status, 302);

    let seen = handle.join().unwrap();
    let lines: Vec<&str> = seen.iter().map(|s| s.0.as_str()).collect();
    assert_eq!(
        lines,
        [
            "POST /api/accounts/oauth/token HTTP/1.1",
            "GET /.well-known/jwks.json HTTP/1.1",
            "POST /api/accounts/oauth/token HTTP/1.1",
            "POST /api/accounts/oauth/revoke HTTP/1.1",
            "GET /anything HTTP/1.1",
        ]
    );
    assert!(
        seen[0]
            .1
            .contains(&"content-type: application/x-www-form-urlencoded".to_owned())
    );
    assert!(seen[4].1.contains(&"authorization: token t".to_owned()));
    assert!(seen[0].2.contains("grant_type=authorization_code") && seen[0].2.contains("resource="));
}
