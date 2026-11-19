//! The ChatGPT sign-in against a scripted OpenAI: the device flow's ends (approved, cancelled, timed out, refused), what
//! reaches the keychain, the refresh (renewed, rotated, revoked, rate-limited), and the real HTTPS transport's request shapes
//! against a loopback server.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::oauth::{self, Endpoints, Reply, Transport};
use super::{ACCESS, ChatGpt, ChatgptSigninEvent, REFRESH, State, Timing, due};
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

/// A token that expires `secs` from now, issued an hour ago, on the Plus plan.
fn access(secs: i64) -> String {
    let exp = now().cast_signed() + secs;
    jwt(
        &json!({"exp": exp, "iat": exp - 3600 * 24, "https://api.openai.com/auth": {"chatgpt_plan_type": "plus", "chatgpt_account_id": "acct"}}),
    )
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
    Timing {
        signin: Duration::from_mins(15),
        refresh_ahead: Duration::from_mins(30),
        refresh_every: Duration::from_mins(5),
    }
}

type Events = Arc<Mutex<Vec<ChatgptSigninEvent>>>;

fn service(script: &Arc<Script>, store: &Arc<MemoryStore>) -> (Arc<ChatGpt>, Events) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let svc = ChatGpt::new(store.clone(), script.clone(), timing())
        .with_sink(Arc::new(move |e| sink.lock().unwrap().push(e)));
    (Arc::new(svc), events)
}

fn code_reply() -> Value {
    json!({"device_auth_id": "dev-1", "user_code": "ABCD-1234", "interval": "5"})
}

fn kept(store: &MemoryStore, name: &str) -> Option<String> {
    store.get("boopis.chatgpt", name).unwrap()
}

async fn ended(events: &Events) -> ChatgptSigninEvent {
    // virtual time (the tests start paused): up to 40 minutes, past the 15 the code lives
    for _ in 0..48_000 {
        if let Some(e) = events.lock().unwrap().first().cloned() {
            return e;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the sign-in never ended");
}

#[tokio::test(start_paused = true)]
async fn a_device_sign_in_shows_the_code_waits_and_keeps_the_tokens_in_the_keychain() {
    let script = Arc::new(Script::default());
    let (a, r) = (access(3600 * 24), "rt-1".to_owned());
    script
        .then("/api/accounts/deviceauth/usercode", 200, &code_reply())
        .then("/api/accounts/deviceauth/token", 403, &json!({}))
        .then("/api/accounts/deviceauth/token", 404, &json!({}))
        .then(
            "/api/accounts/deviceauth/token",
            200,
            &json!({"authorization_code": "ac-1", "code_verifier": "ver-1", "code_challenge": "ch"}),
        )
        .then("/oauth/token", 200, &json!({"access_token": a, "refresh_token": r, "id_token": "id"}));
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);

    let code = svc.start().await.unwrap();
    assert_eq!(code.user_code, "ABCD-1234");
    assert_eq!(
        code.verification_url,
        "https://auth.openai.com/codex/device"
    );
    // a second start while it waits shows the same code and asks OpenAI for nothing
    assert_eq!(svc.start().await.unwrap(), code);
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.code.as_ref()),
        (State::SigningIn, Some(&code))
    );

    let e = ended(&events).await;
    assert_eq!(e.outcome, "signed_in", "{}", e.message);
    assert_eq!(kept(&store, ACCESS).as_deref(), Some(a.as_str()));
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-1"));
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.plan.as_deref()),
        (State::SignedIn, Some("plus"))
    );

    // the requests: the client id, the poll's id and code, then the exchange with the verifier and the fixed redirect
    let seen = script.seen();
    assert_eq!(seen.len(), 5);
    let first: Value = serde_json::from_str(&seen[0].2).unwrap();
    assert_eq!(first, json!({"client_id": oauth::CLIENT_ID}));
    let poll: Value = serde_json::from_str(&seen[1].2).unwrap();
    assert_eq!(
        poll,
        json!({"device_auth_id": "dev-1", "user_code": "ABCD-1234"})
    );
    assert_eq!(seen[4].1, "application/x-www-form-urlencoded");
    let form: Vec<(String, String)> = url::form_urlencoded::parse(seen[4].2.as_bytes())
        .into_owned()
        .collect();
    assert!(form.contains(&("grant_type".into(), "authorization_code".into())));
    assert!(form.contains(&("code".into(), "ac-1".into())));
    assert!(form.contains(&("code_verifier".into(), "ver-1".into())));
    assert!(form.contains(&(
        "redirect_uri".into(),
        "https://auth.openai.com/deviceauth/callback".into()
    )));
    assert!(form.contains(&("client_id".into(), oauth::CLIENT_ID.into())));
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_sign_in_stores_nothing() {
    let script = Arc::new(Script::default());
    script.then("/api/accounts/deviceauth/usercode", 200, &code_reply());
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
async fn a_code_nobody_types_times_out() {
    let script = Arc::new(Script::default());
    script.then("/api/accounts/deviceauth/usercode", 200, &code_reply());
    for _ in 0..400 {
        script.then("/api/accounts/deviceauth/token", 403, &json!({}));
    }
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "timed_out");
    assert!(e.message.contains("Start again"), "{}", e.message);
    assert_eq!(kept(&store, REFRESH), None);
}

#[tokio::test(start_paused = true)]
async fn refusals_end_the_sign_in_with_words_and_store_nothing() {
    // OpenAI refuses to hand out a code (429): the start itself fails, nothing waits
    let script = Arc::new(Script::default());
    script.then("/api/accounts/deviceauth/usercode", 429, &json!({}));
    let store = Arc::new(MemoryStore::default());
    let (svc, _) = service(&script, &store);
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.signin.rate_limited");
    assert!(e.to_string().contains("Wait a minute"));
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);

    // no network
    let script = Arc::new(Script::default());
    script.fail("/api/accounts/deviceauth/usercode");
    let (svc, _) = service(&script, &store);
    assert_eq!(
        svc.start().await.unwrap_err().code(),
        "hx.signin.unreachable"
    );

    // the exchange is refused after the approval
    let script = Arc::new(Script::default());
    script
        .then("/api/accounts/deviceauth/usercode", 200, &code_reply())
        .then(
            "/api/accounts/deviceauth/token",
            200,
            &json!({"authorization_code": "ac", "code_verifier": "v"}),
        )
        .then("/oauth/token", 400, &json!({"error": "invalid_grant"}));
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "failed");
    assert!(e.message.contains("400"), "{}", e.message);
    assert_eq!(kept(&store, ACCESS), None);
}

#[test]
fn the_code_answer_is_read_as_the_service_sends_it() {
    let script = Script::default();
    let ep = Endpoints::openai();
    // a number, a floor of 3 seconds, a missing interval
    script
        .then(
            "usercode",
            200,
            &json!({"device_auth_id": "d", "user_code": "C", "interval": 1}),
        )
        .then(
            "usercode",
            200,
            &json!({"device_auth_id": "d", "usercode": "C"}),
        )
        .then("usercode", 200, &json!({"device_auth_id": "d"}))
        .then("usercode", 404, &json!({}));
    assert_eq!(oauth::request_code(&script, &ep).unwrap().interval, 3);
    assert_eq!(oauth::request_code(&script, &ep).unwrap().interval, 5);
    assert_eq!(
        oauth::request_code(&script, &ep).unwrap_err().code(),
        "hx.signin.failed"
    );
    assert_eq!(
        oauth::request_code(&script, &ep).unwrap_err().code(),
        "hx.signin.unsupported"
    );
}

#[tokio::test]
async fn the_refresh_renews_a_token_that_is_due_and_keeps_the_rotated_refresh_token() {
    let store = Arc::new(MemoryStore::default());
    store.set("boopis.chatgpt", ACCESS, &access(60)).unwrap();
    store.set("boopis.chatgpt", REFRESH, "rt-old").unwrap();
    let fresh = access(3600 * 24);
    let script = Arc::new(Script::default());
    script.then(
        "/oauth/token",
        200,
        &json!({"access_token": fresh, "refresh_token": "rt-new"}),
    );
    let (svc, _) = service(&script, &store);
    assert!(svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&store, ACCESS).as_deref(), Some(fresh.as_str()));
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-new"));
    let form: Vec<(String, String)> = url::form_urlencoded::parse(script.seen()[0].2.as_bytes())
        .into_owned()
        .collect();
    assert!(form.contains(&("grant_type".into(), "refresh_token".into())));
    assert!(form.contains(&("refresh_token".into(), "rt-old".into())));
    // fresh now: nothing is asked
    assert!(!svc.refresh_if_due().await.unwrap());
    assert_eq!(script.seen().len(), 1);

    // an answer without a new refresh token keeps the old one
    store.set("boopis.chatgpt", ACCESS, &access(10)).unwrap();
    script.then("/oauth/token", 200, &json!({"access_token": fresh}));
    assert!(svc.refresh_if_due().await.unwrap());
    assert_eq!(kept(&store, REFRESH).as_deref(), Some("rt-new"));
}

#[tokio::test]
async fn a_revoked_refresh_token_signs_out_and_a_rate_limit_keeps_the_tokens() {
    let store = Arc::new(MemoryStore::default());
    store.set("boopis.chatgpt", ACCESS, &access(-10)).unwrap();
    store.set("boopis.chatgpt", REFRESH, "rt").unwrap();
    let script = Arc::new(Script::default());
    script.then("/oauth/token", 429, &json!({})).then(
        "/oauth/token",
        401,
        &json!({"error": "refresh_token_reused"}),
    );
    let (svc, _) = service(&script, &store);
    assert_eq!(
        svc.refresh_if_due().await.unwrap_err().code(),
        "hx.signin.rate_limited"
    );
    assert_eq!(
        kept(&store, REFRESH).as_deref(),
        Some("rt"),
        "a rate limit is not a revocation"
    );
    assert!(!svc.refresh_if_due().await.unwrap());
    assert_eq!((kept(&store, ACCESS), kept(&store, REFRESH)), (None, None));
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);
}

#[tokio::test]
async fn signing_out_removes_both_tokens() {
    let store = Arc::new(MemoryStore::default());
    store.set("boopis.chatgpt", ACCESS, &access(3600)).unwrap();
    store.set("boopis.chatgpt", REFRESH, "rt").unwrap();
    let (svc, _) = service(&Arc::new(Script::default()), &store);
    assert!(svc.signed_in().await.unwrap());
    svc.sign_out().await.unwrap();
    assert!(!svc.signed_in().await.unwrap());
}

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
fn tokens_never_print() {
    let t = oauth::Tokens {
        access: "secret-a".into(),
        refresh: "secret-r".into(),
    };
    assert_eq!(format!("{t:?}"), "Tokens(<redacted>)");
}

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
    let tokens = json!({"access_token": "a", "refresh_token": "r"});
    let (base, handle) = server(vec![
        (200, code_reply()),
        (403, json!({})),
        (
            200,
            json!({"authorization_code": "ac", "code_verifier": "v"}),
        ),
        (200, tokens),
    ]);
    let ep = Endpoints::at(&base).unwrap();
    let t = oauth::Https::new(Duration::from_secs(10));
    let code = oauth::request_code(&t, &ep).unwrap();
    assert_eq!(code.verification_url, format!("{base}/codex/device"));
    assert!(matches!(
        oauth::poll(&t, &ep, &code).unwrap(),
        oauth::Poll::Pending
    ));
    let oauth::Poll::Approved { code: ac, verifier } = oauth::poll(&t, &ep, &code).unwrap() else {
        panic!("approved");
    };
    let got = oauth::exchange(&t, &ep, &ac, &verifier).unwrap();
    assert_eq!((got.access.as_str(), got.refresh.as_str()), ("a", "r"));
    let seen = handle.join().unwrap();
    let paths: Vec<&str> = seen.iter().map(|s| s.0.as_str()).collect();
    assert_eq!(
        paths,
        [
            "/api/accounts/deviceauth/usercode",
            "/api/accounts/deviceauth/token",
            "/api/accounts/deviceauth/token",
            "/oauth/token"
        ]
    );
    assert_eq!(seen[0].1, "application/json");
    assert_eq!(seen[3].1, "application/x-www-form-urlencoded");
}
