//! The Copilot sign-in against a scripted GitHub: the device flow's ends (approved, cancelled, timed out, denied, expired, slowed
//! down, refused, rate-limited, no Copilot on the account, an expiring token), what reaches the keychain, a locked keychain,
//! sign-out, and the real HTTPS transport's request shapes against a loopback server.

#![allow(clippy::many_single_char_names)]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::oauth::{self, Endpoints};
use super::{ACCOUNT, Copilot, State, TOKEN, Timing, now};
use crate::chatgpt::oauth::{Https, Reply, Transport};
use crate::error::Error;
use crate::providers::ProviderSigninEvent;
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;

enum Step {
    Post(String, std::result::Result<Reply, String>),
    Get(String, std::result::Result<Reply, String>),
}

#[derive(Default)]
struct Script {
    steps: Mutex<VecDeque<Step>>,
    seen: Mutex<Vec<(String, String, Vec<String>)>>,
}

impl Script {
    fn post(&self, end: &str, status: u16, body: &Value) -> &Self {
        self.steps.lock().unwrap().push_back(Step::Post(
            end.to_owned(),
            Ok(Reply {
                status,
                body: body.to_string(),
            }),
        ));
        self
    }
    fn get(&self, end: &str, status: u16, body: &Value) -> &Self {
        self.steps.lock().unwrap().push_back(Step::Get(
            end.to_owned(),
            Ok(Reply {
                status,
                body: body.to_string(),
            }),
        ));
        self
    }
    fn fail(&self, end: &str) -> &Self {
        self.steps
            .lock()
            .unwrap()
            .push_back(Step::Post(end.to_owned(), Err("connection refused".into())));
        self
    }
    fn seen(&self) -> Vec<(String, String, Vec<String>)> {
        self.seen.lock().unwrap().clone()
    }
    fn next(
        &self,
        url: &str,
        get: bool,
        body: &str,
        headers: Vec<String>,
    ) -> std::result::Result<Reply, String> {
        self.seen
            .lock()
            .unwrap()
            .push((url.to_owned(), body.to_owned(), headers));
        let (want, reply, was_get) = match self.steps.lock().unwrap().pop_front() {
            Some(Step::Post(w, r)) => (w, r, false),
            Some(Step::Get(w, r)) => (w, r, true),
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
        self.next(url, false, body, vec![])
    }
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> std::result::Result<Reply, String> {
        self.next(
            url,
            true,
            "",
            headers.iter().map(|(k, v)| format!("{k}: {v}")).collect(),
        )
    }
}

type Events = Arc<Mutex<Vec<ProviderSigninEvent>>>;

fn service(script: &Arc<Script>, store: &Arc<MemoryStore>) -> (Arc<Copilot>, Events) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let svc = Copilot::new(
        store.clone(),
        script.clone(),
        Timing {
            signin: Duration::from_mins(15),
        },
    )
    .with_sink(Arc::new(move |e| sink.lock().unwrap().push(e)));
    (Arc::new(svc), events)
}

fn code_reply() -> Value {
    json!({"device_code": "dev-1", "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 5})
}

fn kept(store: &MemoryStore, name: &str) -> Option<String> {
    store.get("boopis.copilot", name).unwrap()
}

async fn ended(events: &Events) -> ProviderSigninEvent {
    // virtual time (the tests start paused): up to 40 minutes, past the 15 the code lives
    for _ in 0..48_000 {
        if let Some(e) = events.lock().unwrap().first().cloned() {
            return e;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the sign-in never ended");
}

const TOKEN_ANSWER: &str = "ghu_secrettokenvalue";

#[tokio::test(start_paused = true)]
async fn a_device_sign_in_shows_the_code_waits_checks_copilot_and_keeps_the_token_in_the_keychain()
{
    let script = Arc::new(Script::default());
    script
        .post("/login/device/code", 200, &code_reply())
        .post(
            "/login/oauth/access_token",
            200,
            &json!({"error": "authorization_pending"}),
        )
        .post(
            "/login/oauth/access_token",
            200,
            &json!({"error": "slow_down", "interval": 10}),
        )
        .post(
            "/login/oauth/access_token",
            200,
            &json!({"access_token": TOKEN_ANSWER, "token_type": "bearer", "scope": "read:user"}),
        )
        .get(
            "/copilot_internal/v2/token",
            200,
            &json!({"token": "tid=1;exp=2", "expires_at": 1}),
        )
        .get("/user", 200, &json!({"login": "octocat"}));
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);

    let view = svc.start().await.unwrap();
    assert_eq!(view.user_code, "WDJB-MJHT");
    assert_eq!(view.verification_url, "https://github.com/login/device");
    assert_eq!(
        svc.start().await.unwrap(),
        view,
        "a second start shows the same code and asks GitHub for nothing"
    );
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.code.as_ref()),
        (State::SigningIn, Some(&view))
    );

    let e = ended(&events).await;
    assert_eq!(
        (e.outcome.as_str(), e.way.as_str()),
        ("signed_in", "github-copilot.signin"),
        "{}",
        e.message
    );
    assert_eq!(kept(&store, TOKEN).as_deref(), Some(TOKEN_ANSWER));
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.account.as_deref(), st.notice),
        (State::SignedIn, Some("octocat"), None)
    );

    // the requests: the editor app's client id and the least scope; the poll names the grant; the check carries the token only
    // to GitHub's API, with the editor identity the Copilot API asks for
    let seen = script.seen();
    assert_eq!(seen.len(), 6);
    let first: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(seen[0].1.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(first["client_id"], "Iv1.b507a08c87ecfe98");
    assert_eq!(first["scope"], "read:user");
    let poll: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(seen[1].1.as_bytes())
            .into_owned()
            .collect();
    assert_eq!(poll["device_code"], "dev-1");
    assert_eq!(
        poll["grant_type"],
        "urn:ietf:params:oauth:grant-type:device_code"
    );
    assert!(
        seen[4]
            .2
            .contains(&format!("Authorization: token {TOKEN_ANSWER}"))
    );
    assert!(
        seen[4]
            .2
            .iter()
            .any(|h| h.starts_with("Editor-Version: vscode/"))
    );
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_denied_expired_or_forgotten_code_stores_nothing() {
    // cancelled
    let script = Arc::new(Script::default());
    script.post("/login/device/code", 200, &code_reply());
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    svc.cancel();
    assert_eq!(ended(&events).await.outcome, "cancelled");
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);
    assert_eq!(script.seen().len(), 1, "no poll after the cancel");

    // denied on GitHub's page, and an expired code
    for (answer, outcome) in [
        ("access_denied", "cancelled"),
        ("expired_token", "timed_out"),
    ] {
        let script = Arc::new(Script::default());
        script.post("/login/device/code", 200, &code_reply()).post(
            "/login/oauth/access_token",
            200,
            &json!({"error": answer}),
        );
        let (svc, events) = service(&script, &store);
        svc.start().await.unwrap();
        assert_eq!(ended(&events).await.outcome, outcome, "{answer}");
        assert_eq!(kept(&store, TOKEN), None);
    }

    // nobody types the code: the window closes
    let script = Arc::new(Script::default());
    script.post("/login/device/code", 200, &code_reply());
    for _ in 0..400 {
        script.post(
            "/login/oauth/access_token",
            200,
            &json!({"error": "authorization_pending"}),
        );
    }
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert_eq!(e.outcome, "timed_out");
    assert!(e.message.contains("Start again"), "{}", e.message);
}

#[tokio::test(start_paused = true)]
async fn refusals_end_the_sign_in_with_words_and_store_nothing() {
    let store = Arc::new(MemoryStore::default());
    // GitHub will not hand out a code (429), the device flow is off, no network
    let script = Arc::new(Script::default());
    script.post("/login/device/code", 429, &json!({}));
    let (svc, _) = service(&script, &store);
    let e = svc.start().await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.rate_limited");
    assert!(e.to_string().contains("Wait a minute"));
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);

    let script = Arc::new(Script::default());
    script.post(
        "/login/device/code",
        200,
        &json!({"error": "device_flow_disabled"}),
    );
    let (svc, _) = service(&script, &store);
    assert_eq!(
        svc.start().await.unwrap_err().code(),
        "hx.provider.signin_failed"
    );

    let script = Arc::new(Script::default());
    script.fail("/login/device/code");
    let (svc, _) = service(&script, &store);
    assert_eq!(
        svc.start().await.unwrap_err().code(),
        "hx.provider.unreachable"
    );

    // an account with no Copilot, and a token of a kind the Copilot API does not take
    for (token, check, want) in [
        (TOKEN_ANSWER, Some(404u16), "no GitHub Copilot plan"),
        ("ghp_classic", None, "does not take"),
    ] {
        let script = Arc::new(Script::default());
        script.post("/login/device/code", 200, &code_reply()).post(
            "/login/oauth/access_token",
            200,
            &json!({"access_token": token}),
        );
        if let Some(status) = check {
            script.get("/copilot_internal/v2/token", status, &json!({}));
        }
        let (svc, events) = service(&script, &store);
        svc.start().await.unwrap();
        let e = ended(&events).await;
        assert_eq!(e.outcome, "failed");
        assert!(e.message.contains(want), "{}", e.message);
        assert_eq!(kept(&store, TOKEN), None, "{want}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_token_that_comes_with_an_expiry_is_signed_out_with_a_notice_when_it_passes() {
    let script = Arc::new(Script::default());
    script
        .post("/login/device/code", 200, &code_reply())
        .post(
            "/login/oauth/access_token",
            200,
            &json!({"access_token": TOKEN_ANSWER, "expires_in": 28800}),
        )
        .get("/copilot_internal/v2/token", 200, &json!({}))
        .get("/user", 500, &json!({}));
    let store = Arc::new(MemoryStore::default());
    let (svc, events) = service(&script, &store);
    svc.start().await.unwrap();
    assert_eq!(ended(&events).await.outcome, "signed_in");
    let st = svc.status().await.unwrap();
    assert_eq!(
        (st.state, st.account),
        (State::SignedIn, None),
        "the login is only a label"
    );
    assert!(!svc.expire_if_due().await.unwrap());

    store
        .set(
            "boopis.copilot",
            ACCOUNT,
            &json!({"expires_at": now() - 1}).to_string(),
        )
        .unwrap();
    let st = svc.status().await.unwrap();
    assert_eq!(st.state, State::SignedOut);
    assert!(st.notice.unwrap().contains("Sign in again"));
    events.lock().unwrap().clear();
    assert!(svc.expire_if_due().await.unwrap());
    assert_eq!(
        events.lock().unwrap()[0].outcome,
        "signed_out",
        "never silent"
    );
}

#[tokio::test]
async fn signing_out_removes_the_token_and_says_where_the_rest_is() {
    let store = Arc::new(MemoryStore::default());
    store.set("boopis.copilot", TOKEN, TOKEN_ANSWER).unwrap();
    store
        .set(
            "boopis.copilot",
            ACCOUNT,
            &json!({"login": "octocat"}).to_string(),
        )
        .unwrap();
    let (svc, _) = service(&Arc::new(Script::default()), &store);
    assert_eq!(svc.status().await.unwrap().state, State::SignedIn);
    svc.sign_out().await.unwrap();
    assert_eq!((kept(&store, TOKEN), kept(&store, ACCOUNT)), (None, None));
    assert_eq!(svc.status().await.unwrap().state, State::SignedOut);
}

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
async fn a_locked_keychain_fails_closed_before_github_is_asked_for_anything() {
    let script = Arc::new(Script::default());
    let svc = Arc::new(Copilot::new(
        Arc::new(Locked),
        script.clone(),
        Timing {
            signin: Duration::from_mins(15),
        },
    ));
    for e in [
        svc.status().await.map(|_| ()).unwrap_err(),
        svc.start().await.map(|_| ()).unwrap_err(),
        svc.sign_out().await.unwrap_err(),
        svc.expire_if_due().await.map(|_| ()).unwrap_err(),
    ] {
        assert_eq!(e.code(), "hx.secrets.unavailable");
    }
    assert!(script.seen().is_empty(), "nothing was asked of GitHub");
}

#[tokio::test(start_paused = true)]
async fn no_token_reaches_a_message_an_error_or_a_debug_print() {
    // GitHub's body, with a secret in it, is never echoed
    let script = Arc::new(Script::default());
    script.post("/login/device/code", 200, &code_reply()).post(
        "/login/oauth/access_token",
        500,
        &json!({"access_token": "LEAK-token", "device_code": "LEAK-device"}),
    );
    let (svc, events) = service(&script, &Arc::new(MemoryStore::default()));
    svc.start().await.unwrap();
    let e = ended(&events).await;
    assert!(!e.message.contains("LEAK"), "{}", e.message);

    let script = Arc::new(Script::default());
    script.post("/login/device/code", 200, &code_reply());
    let code = oauth::request_code(script.as_ref(), &Endpoints::github()).unwrap();
    assert!(
        !format!("{code:?}").contains("dev-1"),
        "the device code is not printed"
    );
    // the status the webview gets carries no token
    let store = MemoryStore::default();
    store.set("boopis.copilot", TOKEN, "LEAK-github").unwrap();
    let (svc, _) = service(&Arc::new(Script::default()), &Arc::new(store));
    let st = svc.status().await.unwrap();
    assert!(!format!("{st:?}").contains("LEAK"));
}

#[test]
fn the_device_code_answer_is_read_as_github_sends_it() {
    let script = Script::default();
    let ep = Endpoints::github();
    // a floor of five seconds, a missing expiry, no page named (GitHub's own is used)
    script
        .post(
            "code",
            200,
            &json!({"device_code": "d", "user_code": "C", "interval": 1}),
        )
        .post("code", 200, &json!({"device_code": "d"}))
        .post("code", 500, &json!({}));
    let c = oauth::request_code(&script, &ep).unwrap();
    assert_eq!(
        (c.interval, c.expires_in, c.verification_url.as_str()),
        (5, 900, "https://github.com/login/device")
    );
    assert_eq!(
        oauth::request_code(&script, &ep).unwrap_err().code(),
        "hx.provider.signin_failed"
    );
    assert_eq!(
        oauth::request_code(&script, &ep).unwrap_err().code(),
        "hx.provider.signin_failed"
    );
}

#[test]
fn an_address_must_be_https_or_this_computer_and_a_token_must_be_a_kind_copilot_takes() {
    assert!(Endpoints::at("https://github.example.com").is_ok());
    assert!(Endpoints::at("http://127.0.0.1:9").is_ok());
    assert!(Endpoints::at("http://github.example.com").is_err());
    for ok in ["ghu_x", "gho_x", "github_pat_x"] {
        assert!(oauth::supported_token(ok));
    }
    for bad in ["ghp_x", "ghs_x", "x", ""] {
        assert!(!oauth::supported_token(bad));
    }
}

/// A loopback HTTP server that answers each request from `answers` in order and records the request line, headers and body.
type Wire = Vec<(String, Vec<String>, String)>;

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
            let mut stream = reader.into_inner();
            write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len()).unwrap();
        }
        seen
    });
    (base, handle)
}

#[test]
fn the_real_transport_sends_the_flow_s_requests_with_the_headers_github_needs() {
    let (base, handle) = server(vec![
        (200, code_reply()),
        (200, json!({"error": "authorization_pending"})),
        (200, json!({"access_token": TOKEN_ANSWER})),
        (200, json!({"token": "t"})),
        (200, json!({"login": "octocat"})),
    ]);
    let ep = Endpoints::at(&base).unwrap();
    let t = Https::new(Duration::from_secs(10));
    let code = oauth::request_code(&t, &ep).unwrap();
    assert!(matches!(
        oauth::poll(&t, &ep, &code, 5).unwrap(),
        oauth::Poll::Pending
    ));
    let oauth::Poll::Approved { token, .. } = oauth::poll(&t, &ep, &code, 5).unwrap() else {
        panic!("approved");
    };
    assert_eq!(token, TOKEN_ANSWER);
    assert_eq!(
        oauth::entitlement(&t, &ep, &token).unwrap(),
        oauth::Entitlement::Has
    );
    assert_eq!(oauth::login(&t, &ep, &token).as_deref(), Some("octocat"));

    let seen = handle.join().unwrap();
    let lines: Vec<&str> = seen.iter().map(|s| s.0.as_str()).collect();
    assert_eq!(
        lines,
        [
            "POST /login/device/code HTTP/1.1",
            "POST /login/oauth/access_token HTTP/1.1",
            "POST /login/oauth/access_token HTTP/1.1",
            "GET /copilot_internal/v2/token HTTP/1.1",
            "GET /user HTTP/1.1",
        ]
    );
    assert!(
        seen[0]
            .1
            .contains(&"content-type: application/x-www-form-urlencoded".to_owned())
    );
    assert!(
        seen[0].1.contains(&"accept: application/json".to_owned()),
        "GitHub answers JSON only when asked"
    );
    assert!(
        seen[3]
            .1
            .contains(&format!("authorization: token {TOKEN_ANSWER}"))
    );
    assert!(
        seen[3]
            .1
            .iter()
            .any(|h| h.starts_with("editor-version: vscode/"))
    );
}
