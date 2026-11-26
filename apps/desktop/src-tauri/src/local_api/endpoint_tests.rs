//! The endpoint end to end, over a real loopback socket and a scripted engine: the security tests (`ADR-0045`). Each test
//! speaks raw HTTP, the way a hostile page, a stranger or a clumsy script would.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::audit::Audit;
use super::engine::scripted::Scripted;
use super::feed::Feed;
use super::http::Server;
use super::owner::{Fixed, OwnerCheck};
use super::service::Service;
use super::token::{Files, Token};
use crate::config::ApiLimits;
use crate::error::Error;

const TOKEN: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const CANARIES: [&str; 4] = [
    "sk-proj-CANARY0123456789abcdef",
    "hermes-gateway-ticket.CANARYticket0123456789",
    "Bearer CANARYbearer0123456789",
    "password: CANARYpassword1234",
];

/// The engine's stored transcript of a conversation, as the scripted engine keeps it: what `session.transcript` reads and
/// what `prompt.submit` adds to, the way the real engine's store is the one place the app and a client both write.
type Store = Arc<std::sync::Mutex<Vec<Value>>>;

fn engine() -> (Arc<Scripted>, Store) {
    let store: Store = Arc::default();
    let rows = store.clone();
    let scripted = Arc::new(Scripted::new(move |profile, method, params| match method {
        "profiles.list" => Ok(json!({"profiles": [
            {"name": "kai", "model": "opus", "provider": "p", "display_name": "Kai", "description": "editor"},
            {"name": "nina", "model": "", "provider": "", "display_name": "", "description": ""}
        ]})),
        "plugin.boopis.bots.read" => Ok(json!({"bots": []})),
        "profiles.describe" => Ok(json!({"model": {"provider": "p", "default": "sonnet"}})),
        "groups.list" => Ok(
            json!({"rooms": [{"room_id": "g-paper", "name": "paper past", "members": [{"profile": "kai"}]}]}),
        ),
        "session.create" => {
            Ok(json!({"session_id": "live-new", "stored_session_id": "stored-new"}))
        }
        "prompt.submit" => {
            let mut rows = rows.lock().unwrap();
            let n = i64::try_from(rows.len()).unwrap() + 1;
            rows.push(json!({"role": "user", "text": params["text"], "row_id": n, "timestamp": 1000 + n, "row_kind": "message"}));
            Ok(json!({"status": "started"}))
        }
        "session.transcript" => {
            if params["session_id"] == "nope" {
                return Err(Error::Unavailable("session.transcript: not_found".into()));
            }
            // newest first, the way a `latest` page comes
            let mut page: Vec<Value> = rows.lock().unwrap().clone();
            page.reverse();
            Ok(
                json!({"session_id": params["session_id"], "rows": page, "next_cursor": null, "reset": false}),
            )
        }
        // nina has a conversation to retry (B43); kai's list cannot be read, so kai has none
        "session.list" if profile == "nina" => {
            Ok(json!({"sessions": [{"id": "stored-n", "source": "gui"}]}))
        }
        "session.resume" => Ok(json!({"session_id": "live-n", "running": false})),
        "command.dispatch" => {
            assert_eq!(params["name"], "retry");
            Ok(json!({"type": "send", "message": "again, please"}))
        }
        "groups.send" => Ok(json!({"accepted": true})),
        "groups.log" => Ok(json!({"events": [
            {"seq": 1, "event_id": "e1", "kind": "message.user", "payload": {"thread_id": "main", "text": "go"}, "created_at": 1000.0},
            {"seq": 2, "event_id": "e2", "kind": "turn.cancelled", "payload": {"member_id": "kai", "reason": "superseded_by_newer_user_event"}, "created_at": 1001.0},
            {"seq": 3, "event_id": "e3", "kind": "message.member", "payload": {"member_id": "kai", "text": "@user done. sk-proj-CANARY0123456789abcdef"}, "created_at": 1002.0}
        ], "latest_seq": 3, "has_more": false})),
        "groups.state" => Ok(
            json!({"room": {}, "driver_status": {"working": false, "blocked": false, "pending_actions": [], "member_activity": []}}),
        ),
        "groups.stop" => Ok(json!({"cancelled": 1})),
        "session.active_list" => Ok(json!({"sessions": []})),
        "approval.respond" => {
            assert_eq!(profile, "kai");
            assert_eq!(params["choice"], "once");
            Ok(json!({"resolved": 1}))
        }
        _ => Err(Error::Unavailable(format!("unscripted {method}"))),
    }));
    (scripted, store)
}

struct Rig {
    server: Server<Scripted>,
    service: Arc<Service<Scripted>>,
    scripted: Arc<Scripted>,
    store: Store,
    _dir: tempfile::TempDir,
}

fn limits() -> ApiLimits {
    ApiLimits {
        read_timeout: Duration::from_millis(600),
        keepalive: Duration::from_millis(200),
        ..ApiLimits::default()
    }
}

async fn rig_with(limits: ApiLimits) -> Rig {
    rig_owned(limits, Arc::new(Fixed(boopis_peer::Verdict::Owner))).await
}

/// A rig whose connections `owner` judges (B47, H4): the other rigs' clients are the owner's.
async fn rig_owned(limits: ApiLimits, owner: Arc<dyn OwnerCheck>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let feed = Feed::new(Audit::under(dir.path()), limits.clone());
    let (scripted, store) = engine();
    let service = Service::new(
        feed,
        scripted.clone(),
        limits.clone(),
        crate::rooms::hold::Store::under(dir.path()),
        crate::config::RoomLimits::default(),
    );
    service.refresh_roster().await;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let server = Server::serve(
        listener,
        service.clone(),
        Token::from_text(TOKEN.into()),
        limits,
        owner,
    )
    .unwrap();
    service.feed().never_say(vec![TOKEN.to_owned()]);
    Rig {
        server,
        service,
        scripted,
        store,
        _dir: dir,
    }
}

async fn rig() -> Rig {
    rig_with(limits()).await
}

/// Speak raw bytes, read everything until the server closes.
async fn raw(addr: std::net::SocketAddr, request: &str) -> (u16, String, String) {
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(request.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(3), s.read_to_end(&mut buf)).await;
    let text = String::from_utf8_lossy(&buf).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head
        .split(' ')
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    (status, head.to_owned(), body.to_owned())
}

fn get(rig: &Rig, path: &str, extra: &str) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {TOKEN}\r\n{extra}\r\n",
        rig.server.addr().port()
    )
}

fn post(rig: &Rig, path: &str, body: &str, extra: &str) -> String {
    format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}\r\n{body}",
        rig.server.addr().port(),
        body.len()
    )
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or(Value::Null)
}

#[tokio::test]
async fn it_listens_on_loopback_only() {
    let r = rig().await;
    assert!(r.server.addr().ip().is_loopback());
    assert_eq!(r.server.addr().ip().to_string(), "127.0.0.1");
}

#[tokio::test]
async fn the_roster_has_looks_models_and_presence() {
    let r = rig().await;
    let (status, head, body) = raw(r.server.addr(), &get(&r, "/v1/bots", "")).await;
    assert_eq!(status, 200, "{head}");
    let v = json_of(&body);
    let bots = v["bots"].as_array().unwrap();
    assert_eq!(bots.len(), 2);
    assert_eq!(bots[0]["name"], "kai");
    assert!(
        bots[0]["look"]["shape"].is_string()
            && bots[0]["look"]["color"].as_str().unwrap().starts_with('#')
    );
    assert_eq!(
        bots[1]["model"], "p/sonnet",
        "B10: a bot whose row has no model"
    );
    assert_eq!(bots[0]["presence"]["state"], "idle");
    assert!(
        !head.to_ascii_lowercase().contains("access-control"),
        "no CORS header, ever: {head}"
    );
}

#[tokio::test]
async fn no_token_and_a_wrong_token_are_refused_and_say_nothing_of_the_real_one() {
    let r = rig().await;
    let port = r.server.addr().port();
    let (status, head, body) = raw(
        r.server.addr(),
        &format!("GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 401);
    assert!(head.contains("WWW-Authenticate: Bearer"));
    assert!(!body.contains(TOKEN) && !head.contains(TOKEN));
    let (status, _, body) = raw(
        r.server.addr(),
        &format!("GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}x\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 401);
    assert!(!body.contains(TOKEN));
    // a token in the address is never read
    let (status, _, _) = raw(
        r.server.addr(),
        &format!("GET /v1/bots?token={TOKEN} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn five_wrong_tokens_shut_the_door_even_to_the_right_one_for_a_while() {
    let r = rig().await;
    let port = r.server.addr().port();
    for _ in 0..5 {
        let (s, _, _) = raw(r.server.addr(), &format!("GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer nope\r\n\r\n")).await;
        assert_eq!(s, 401);
    }
    let (status, _, body) = raw(r.server.addr(), &get(&r, "/v1/bots", "")).await;
    assert_eq!(status, 429, "{body}");
    assert_eq!(json_of(&body)["error"]["code"], "too_many_failures");
}

#[tokio::test]
async fn a_rebinding_host_is_refused_before_the_token_is_looked_at() {
    let r = rig().await;
    for host in [
        "evil.example:1",
        "evil.example",
        "127.0.0.1",
        "[::1]:1",
        "0.0.0.0:1",
    ] {
        let req = format!(
            "GET /v1/bots HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TOKEN}\r\n\r\n"
        );
        let (status, _, body) = raw(r.server.addr(), &req).await;
        assert_eq!(status, 403, "{host}");
        assert!(
            !body.contains("bots"),
            "nothing is served to a wrong host: {body}"
        );
    }
    let (status, _, _) = raw(
        r.server.addr(),
        &format!("GET /v1/bots HTTP/1.1\r\nAuthorization: Bearer {TOKEN}\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 400, "no Host at all");
    // a wrong host gets the same answer with or without a token: the check comes first
    let (a, _, _) = raw(
        r.server.addr(),
        "GET /v1/bots HTTP/1.1\r\nHost: evil.example\r\n\r\n",
    )
    .await;
    assert_eq!(a, 403);
}

#[tokio::test]
async fn a_browser_is_refused_even_with_the_right_token_and_there_is_no_preflight() {
    let r = rig().await;
    for extra in [
        "Origin: https://evil.example\r\n",
        "Origin: null\r\n",
        "Sec-Fetch-Site: cross-site\r\n",
        "Sec-Fetch-Mode: cors\r\n",
    ] {
        let (status, head, body) = raw(r.server.addr(), &get(&r, "/v1/bots", extra)).await;
        assert_eq!(status, 403, "{extra}");
        assert!(!head.to_ascii_lowercase().contains("access-control") && !body.contains("kai"));
    }
    let port = r.server.addr().port();
    let (status, head, _) = raw(
        r.server.addr(),
        &format!("OPTIONS /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\nAccess-Control-Request-Method: POST\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 405);
    assert!(
        !head.to_ascii_lowercase().contains("access-control-allow"),
        "{head}"
    );
    // a simple cross-site form post (no preflight) is refused by its content type and by its origin
    let (status, _, _) = raw(
        r.server.addr(),
        &format!("POST /v1/bots/kai/say HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nAuthorization: Bearer {TOKEN}\r\n\r\n{{}}"),
    )
    .await;
    assert_eq!(status, 415);
}

#[tokio::test]
async fn sizes_and_shapes_are_capped() {
    let r = rig().await;
    let port = r.server.addr().port();
    let big_head = format!(
        "GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Pad: {}\r\n\r\n",
        "a".repeat(9000)
    );
    assert_eq!(raw(r.server.addr(), &big_head).await.0, 431);
    let long_path = format!(
        "GET /{} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n",
        "a".repeat(600)
    );
    assert_eq!(raw(r.server.addr(), &long_path).await.0, 414);
    let body = "x".repeat(70_000);
    let req = format!(
        "POST /v1/bots/kai/say HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    assert_eq!(raw(r.server.addr(), &req).await.0, 413);
    let chunked = format!(
        "POST /v1/bots/kai/say HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
    );
    assert_eq!(raw(r.server.addr(), &chunked).await.0, 400);
    // a text longer than the cap for a message
    let long = json!({"text": "y".repeat(40_000)}).to_string();
    let (status, _, body) = raw(r.server.addr(), &post(&r, "/v1/bots/kai/say", &long, "")).await;
    assert_eq!(status, 413);
    assert_eq!(json_of(&body)["error"]["code"], "text_too_long");
}

#[tokio::test]
async fn a_client_that_sends_nothing_does_not_hold_a_connection() {
    let r = rig().await;
    let mut s = TcpStream::connect(r.server.addr()).await.unwrap();
    s.write_all(b"GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1")
        .await
        .unwrap();
    let mut buf = Vec::new();
    let done = tokio::time::timeout(Duration::from_secs(3), s.read_to_end(&mut buf)).await;
    assert!(done.is_ok(), "the server gave up on a stalled head");
    assert!(String::from_utf8_lossy(&buf).contains("400"));
}

#[tokio::test]
async fn too_many_connections_are_turned_away_with_a_sentence() {
    let r = rig_with(ApiLimits {
        max_connections: 2,
        read_timeout: Duration::from_secs(2),
        ..limits()
    })
    .await;
    let _a = TcpStream::connect(r.server.addr()).await.unwrap();
    let _b = TcpStream::connect(r.server.addr()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut c = TcpStream::connect(r.server.addr()).await.unwrap();
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(1), c.read_to_end(&mut buf)).await;
    assert!(
        String::from_utf8_lossy(&buf).starts_with("HTTP/1.1 503"),
        "{}",
        String::from_utf8_lossy(&buf)
    );
}

#[tokio::test]
async fn writes_are_rate_limited_more_strictly_than_reads() {
    let r = rig_with(ApiLimits {
        write_rate: (1, 2),
        ..limits()
    })
    .await;
    let body = json!({"text": "hi", "session": "new"}).to_string();
    let mut statuses = Vec::new();
    for _ in 0..4 {
        statuses.push(
            raw(r.server.addr(), &post(&r, "/v1/bots/kai/say", &body, ""))
                .await
                .0,
        );
    }
    assert_eq!(statuses, [200, 200, 429, 429]);
    assert_eq!(
        raw(r.server.addr(), &get(&r, "/v1/bots", "")).await.0,
        200,
        "reads have their own bucket"
    );
}

#[tokio::test]
async fn saying_to_a_bot_reaches_the_engine_as_the_app_would_start_the_conversation() {
    let r = rig().await;
    let body = json!({"text": "hello", "session": "new"}).to_string();
    let (status, _, resp) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/bots/nina/say",
            &body,
            // an old script's label is ignored: nothing in the contract reads it
            "X-Boopis-Client: panacea-island\r\n",
        ),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    assert_eq!(json_of(&resp)["said"]["session_id"], "stored-new");
    let created = r.scripted.of("session.create");
    assert_eq!(created[0].0, "nina");
    assert_eq!(
        created[0].1,
        json!({"source": "gui"}),
        "a conversation is started exactly as the app starts one"
    );
    let (status, _, _) = raw(r.server.addr(), &post(&r, "/v1/bots/nobody/say", &body, "")).await;
    assert_eq!(status, 404);
    let (status, _, _) = raw(
        r.server.addr(),
        &post(&r, "/v1/bots/nina/say", "{\"text\": 3}", ""),
    )
    .await;
    assert_eq!(status, 400);
    let (status, _, _) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/rooms/g-paper/say",
            &json!({"text": "go"}).to_string(),
            "",
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(r.scripted.of("groups.send").len(), 1);
}

fn ask(r: &Rig, prompt: &str, command: &str) {
    use crate::gateway::{Direction, FeedFrame};
    r.service.feed().on_frame(
        "kai",
        &FeedFrame {
            direction: Direction::In,
            name: "approval.request".into(),
            session_id: Some("s1".into()),
            generation: Some(2),
            payload: Some(json!({"prompt_id": prompt, "command": command, "description": CANARIES[3], "choices": ["once", "session", "always", "deny"], "tool_name": "terminal"})),
        },
    );
}

#[tokio::test]
async fn two_clients_answer_at_once_and_exactly_one_wins() {
    let r = rig().await;
    ask(&r, "p1", "rm -rf build");
    let body = json!({"choice": "once"}).to_string();
    let (req_a, req_b) = (
        post(&r, "/v1/approvals/p1", &body, ""),
        post(&r, "/v1/approvals/p1", &body, ""),
    );
    let (a, b) = (raw(r.server.addr(), &req_a), raw(r.server.addr(), &req_b));
    let (a, b) = tokio::join!(a, b);
    let mut got = [a.0, b.0];
    got.sort_unstable();
    assert_eq!(got, [200, 409], "{a:?} {b:?}");
    assert_eq!(r.scripted.of("approval.respond").len(), 1);
    let loser = if a.0 == 409 { &a } else { &b };
    assert_eq!(json_of(&loser.2)["error"]["code"], "already_answered");
    let (_, _, list) = raw(r.server.addr(), &get(&r, "/v1/approvals?all=1", "")).await;
    let row = &json_of(&list)["approvals"][0];
    assert_eq!(row["state"], "settled");
    assert_eq!(row["answered_by"]["surface"], "endpoint");
    assert!(
        row["answered_by"].get("client").is_none(),
        "no name is kept or shown"
    );
    assert!(
        json_of(&loser.2)["error"]["message"]
            .as_str()
            .unwrap()
            .contains("through the local API")
    );
}

#[tokio::test]
async fn a_standing_grant_and_a_missing_choice_are_refused_and_nothing_reaches_the_engine() {
    // Seven writes in a row: the rate limit has its own test, so this one is not held back by it.
    let r = rig_with(ApiLimits {
        write_rate: (100, 100),
        ..limits()
    })
    .await;
    ask(&r, "p1", "rm -rf build");
    for body in [
        json!({"choice": "always"}),
        json!({"choice": "session"}),
        json!({"choice": "approve"}),
        json!({}),
        json!({"choice": null}),
        json!({"choice": "once", "execution_generation": 99}),
    ] {
        let (status, _, resp) = raw(
            r.server.addr(),
            &post(&r, "/v1/approvals/p1", &body.to_string(), ""),
        )
        .await;
        assert!(
            [400, 403, 409].contains(&status),
            "{body} -> {status} {resp}"
        );
    }
    assert!(r.scripted.of("approval.respond").is_empty());
    let (_, _, list) = raw(r.server.addr(), &get(&r, "/v1/approvals", "")).await;
    assert_eq!(json_of(&list)["approvals"][0]["state"], "pending");
    let (status, _, _) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/approvals/nope",
            &json!({"choice": "once"}).to_string(),
            "",
        ),
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn no_secret_crosses_any_route_or_the_stream() {
    let r = rig().await;
    ask(
        &r,
        "p1",
        &format!(
            "curl -H '{}' -d {} {}",
            CANARIES[2], CANARIES[0], CANARIES[1]
        ),
    );
    let mut seen = String::new();
    for path in [
        "/v1",
        "/v1/bots",
        "/v1/presence",
        "/v1/notifications",
        "/v1/approvals?all=1",
        "/v1/rooms",
    ] {
        let (status, head, body) = raw(r.server.addr(), &get(&r, path, "")).await;
        assert_eq!(status, 200, "{path}");
        seen.push_str(&head);
        seen.push_str(&body);
    }
    let (_, head, body) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/bots/kai/say",
            &json!({"text": "hi", "session": "new"}).to_string(),
            "",
        ),
    )
    .await;
    seen.push_str(&head);
    seen.push_str(&body);
    let (_, head, body) = raw(r.server.addr(), &get(&r, "/v1/nothing", "")).await;
    seen.push_str(&head);
    seen.push_str(&body);
    let (_, head, body) = raw(
        r.server.addr(),
        "GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
    )
    .await;
    seen.push_str(&head);
    seen.push_str(&body);
    for secret in [
        TOKEN,
        "CANARY0123456789abcdef",
        "CANARYticket",
        "CANARYbearer",
        "CANARYpassword",
    ] {
        assert!(
            !seen.contains(secret),
            "{secret} crossed the endpoint: {seen}"
        );
    }
    let lower = seen.to_ascii_lowercase();
    for field in [
        "\"ticket\"",
        "\"token\"",
        "\"secret\"",
        "\"password\"",
        "\"api_key\"",
        "\"authorization\"",
    ] {
        assert!(!lower.contains(field), "a response has a {field} field");
    }
}

/// Read what a stream has sent so far (until `stop` appears or the time runs out).
async fn read_stream(s: &mut TcpStream, stop: &str, within: Duration) -> String {
    let mut out = String::new();
    let _ = tokio::time::timeout(within, async {
        let mut chunk = [0u8; 4096];
        while !out.contains(stop) {
            match s.read(&mut chunk).await {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&chunk[..n])),
                _ => break,
            }
        }
    })
    .await;
    out
}

#[tokio::test]
async fn the_stream_says_hello_carries_events_in_order_and_resumes_after_last_event_id() {
    use crate::gateway::{Direction, FeedFrame};
    let r = rig().await;
    let mut s = TcpStream::connect(r.server.addr()).await.unwrap();
    s.write_all(get(&r, "/v1/events", "").as_bytes())
        .await
        .unwrap();
    let first = read_stream(&mut s, "event: hello", Duration::from_secs(2)).await;
    assert!(
        first.starts_with("HTTP/1.1 200") && first.contains("text/event-stream"),
        "{first}"
    );
    assert!(first.contains("\"version\":1"));
    let frame = |name: &str| FeedFrame {
        direction: Direction::In,
        name: name.into(),
        session_id: Some("s1".into()),
        generation: None,
        payload: None,
    };
    r.service.feed().on_frame("kai", &frame("message.start"));
    r.service.feed().on_frame("kai", &frame("message.delta"));
    let got = read_stream(&mut s, "speaking", Duration::from_secs(2)).await;
    assert!(
        got.contains("event: bots.presence")
            && got.contains("\"state\":\"thinking\"")
            && got.contains("\"state\":\"speaking\""),
        "{got}"
    );
    let last_id: u64 = got
        .rsplit("id: ")
        .next()
        .unwrap()
        .split('\n')
        .next()
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    drop(s);
    r.service.feed().on_frame("kai", &frame("message.complete"));
    let mut again = TcpStream::connect(r.server.addr()).await.unwrap();
    again
        .write_all(get(&r, "/v1/events", &format!("Last-Event-ID: {last_id}\r\n")).as_bytes())
        .await
        .unwrap();
    let resumed = read_stream(&mut again, "\"state\":\"done\"", Duration::from_secs(2)).await;
    assert!(
        resumed.contains("\"state\":\"done\"") && !resumed.contains("\"state\":\"thinking\""),
        "{resumed}"
    );
}

#[tokio::test]
async fn a_quiet_stream_is_kept_alive_and_streams_are_capped() {
    let r = rig_with(ApiLimits {
        max_streams: 1,
        ..limits()
    })
    .await;
    let mut a = TcpStream::connect(r.server.addr()).await.unwrap();
    a.write_all(get(&r, "/v1/events", "").as_bytes())
        .await
        .unwrap();
    let text = read_stream(&mut a, ": keepalive", Duration::from_secs(2)).await;
    assert!(text.contains(": keepalive"), "{text}");
    let (status, _, body) = raw(r.server.addr(), &get(&r, "/v1/events", "")).await;
    assert_eq!(status, 503);
    assert_eq!(json_of(&body)["error"]["code"], "too_many_streams");
}

#[tokio::test]
async fn rotating_the_token_ends_every_stream_and_the_old_token_stops_working() {
    let r = rig().await;
    let mut s = TcpStream::connect(r.server.addr()).await.unwrap();
    s.write_all(get(&r, "/v1/events", "").as_bytes())
        .await
        .unwrap();
    read_stream(&mut s, "event: hello", Duration::from_secs(2)).await;
    r.server
        .rotate(Token::from_text("a-new-token-0123456789".into()));
    let mut rest = Vec::new();
    let ended = tokio::time::timeout(Duration::from_secs(2), s.read_to_end(&mut rest)).await;
    assert!(ended.is_ok(), "the stream was closed by the rotation");
    let (status, _, _) = raw(r.server.addr(), &get(&r, "/v1/bots", "")).await;
    assert_eq!(status, 401, "the old token no longer works");
    let port = r.server.addr().port();
    let (status, _, _) = raw(r.server.addr(), &format!("GET /v1/bots HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer a-new-token-0123456789\r\n\r\n")).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn an_unknown_address_and_a_wrong_method_are_told_apart() {
    let r = rig().await;
    assert_eq!(
        raw(r.server.addr(), &get(&r, "/v1/nothing", "")).await.0,
        404
    );
    assert_eq!(
        raw(r.server.addr(), &get(&r, "/v1/bots/kai/say", ""))
            .await
            .0,
        405
    );
    assert_eq!(
        raw(r.server.addr(), &post(&r, "/v1/bots", "{}", ""))
            .await
            .0,
        405
    );
    assert_eq!(
        raw(r.server.addr(), &get(&r, "/v1/bots/..%2f/say", ""))
            .await
            .0,
        400
    );
}

#[test]
fn the_token_file_is_private_and_the_endpoint_file_names_the_address() {
    let dir = tempfile::tempdir().unwrap();
    let files = Files::under(dir.path());
    files.write_token(&Token::mint().unwrap()).unwrap();
    assert!(files.token_is_private());
    files.write_endpoint("127.0.0.1:47821", 1).unwrap();
    assert!(
        std::fs::read_to_string(files.endpoint_path())
            .unwrap()
            .contains("127.0.0.1:47821")
    );
}

#[tokio::test]
#[allow(clippy::too_many_lines)] // one client, run end to end, call after call
async fn the_reference_client_reads_the_roster_follows_events_and_answers_an_approval() {
    use std::process::Stdio;
    use tokio::io::AsyncBufReadExt;
    use tokio::process::Command;

    let script = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/boopis-local-client.py"
    );
    if Command::new("python3")
        .arg("--version")
        .output()
        .await
        .is_err()
    {
        eprintln!("python3 is not installed; the reference client is not run here");
        return;
    }
    let r = rig().await;
    let dir = tempfile::tempdir().unwrap();
    let files = Files::under(dir.path());
    files.write_token(&Token::from_text(TOKEN.into())).unwrap();
    files
        .write_endpoint(&r.server.addr().to_string(), 1)
        .unwrap();
    let base = |extra: &[&str]| {
        let mut c = Command::new("python3");
        c.arg("-I")
            .arg(script)
            .arg("--endpoint-file")
            .arg(files.endpoint_path())
            .arg("--token-file")
            .arg(files.token_path());
        c.args(extra)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        c
    };
    // the roster
    let out = base(&["bots"]).output().await.unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["bots"][0]["name"], "kai");
    assert!(
        !String::from_utf8_lossy(&out.stdout).contains(TOKEN)
            && !String::from_utf8_lossy(&out.stderr).contains(TOKEN)
    );
    // the notifications kept (B42: a scheduled run's carries its words and when it runs next)
    let out = base(&["notifications", "--limit", "5"])
        .output()
        .await
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(v["notifications"].is_array(), "{v}");
    // a retry of nina's last turn (B43)
    let out = base(&["retry", "nina"]).output().await.unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["retried"]["session_id"], "stored-n", "{v}");
    // a refusal is a sentence and exit code 1
    let bad = base(&["answer", "nope", "once"]).output().await.unwrap();
    assert_eq!(bad.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&bad.stderr).contains("no such approval")
            || String::from_utf8_lossy(&bad.stderr).contains("There is no such approval")
    );
    // the stream, with an approval answered from the terminal
    let mut child = base(&["events", "--approve"]).spawn().unwrap();
    let mut lines = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    let hello = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        hello.contains("\"event\": \"hello\"") || hello.contains("\"event\":\"hello\""),
        "{hello}"
    );
    ask(&r, "pr1", "rm -rf build");
    let mut stdin = child.stdin.take().unwrap();
    let mut answered = false;
    for _ in 0..40 {
        let Ok(Ok(Some(line))) =
            tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await
        else {
            break;
        };
        if line.contains("approvals.changed") && line.contains("\"pending\"") {
            stdin.write_all(b"once\n").await.unwrap();
            stdin.flush().await.unwrap();
        }
        if line.contains("approvals.changed") && line.contains("\"settled\"") {
            answered = true;
            break;
        }
    }
    assert!(answered, "the client's answer settled the approval");
    assert_eq!(r.scripted.of("approval.respond").len(), 1);
    let (_, _, list) = raw(r.server.addr(), &get(&r, "/v1/approvals?all=1", "")).await;
    assert_eq!(
        json_of(&list)["approvals"][0]["answered_by"]["surface"],
        "endpoint"
    );
}

/// The worked example's commands (`docs/LOCAL-API.md`) are run as written, with `curl`, so the document is not a guess.
#[tokio::test]
async fn the_documented_curl_commands_work_and_an_expect_header_is_refused() {
    use tokio::process::Command;
    if Command::new("curl")
        .arg("--version")
        .output()
        .await
        .is_err()
    {
        eprintln!("curl is not installed; the documented commands are not run here");
        return;
    }
    let r = rig().await;
    ask(&r, "pc1", "rm -rf build");
    let url = format!("http://{}", r.server.addr());
    let auth = format!("Authorization: Bearer {TOKEN}");
    let curl = |extra: &[&str]| {
        let mut c = Command::new("curl");
        c.args(["-s", "--max-time", "5", "-H", &auth]);
        c.args(extra).kill_on_drop(true);
        c
    };
    let out = curl(&[&format!("{url}/v1/bots")]).output().await.unwrap();
    assert_eq!(
        json_of(&String::from_utf8_lossy(&out.stdout))["bots"][0]["name"],
        "kai"
    );
    let out = curl(&[
        "-H",
        "Content-Type: application/json",
        "-d",
        r#"{"choice":"once"}"#,
        &format!("{url}/v1/approvals/pc1"),
    ])
    .output()
    .await
    .unwrap();
    let answered = json_of(&String::from_utf8_lossy(&out.stdout));
    assert_eq!(answered["approval"]["state"], "settled", "{answered}");
    assert_eq!(answered["approval"]["answered_by"]["surface"], "endpoint");
    // the documented read of a conversation
    let out = curl(&[&format!("{url}/v1/bots/kai/conversation?session=stored-1")])
        .output()
        .await
        .unwrap();
    let read = json_of(&String::from_utf8_lossy(&out.stdout));
    assert!(read["messages"].is_array(), "{read}");
    // a long message goes through as it is; a client that sends `Expect: 100-continue` (older curl did for any body over
    // 1 KiB) is refused with a sentence, and `-H 'Expect:'` is the way round
    let long = json!({"text": "x".repeat(2000), "session": "new"}).to_string();
    let target = format!("{url}/v1/bots/nina/say");
    let say = |expect: &'static str| {
        let mut c = curl(&[
            "-H",
            "Content-Type: application/json",
            "-H",
            expect,
            "-d",
            &long,
            "-w",
            "%{http_code}",
            &target,
        ]);
        async move { String::from_utf8_lossy(&c.output().await.unwrap().stdout).into_owned() }
    };
    let refused = say("Expect: 100-continue").await;
    assert!(
        refused.contains("unsupported") && refused.ends_with("400"),
        "{refused}"
    );
    let said = say("Expect:").await;
    assert!(said.ends_with("200"), "{said}");
}

fn seed(r: &Rig, rows: &[Value]) {
    *r.store.lock().unwrap() = rows.to_vec();
}

fn row(id: i64, role: &str, text: &str) -> Value {
    json!({"role": role, "text": text, "row_id": id, "timestamp": 1000 + id, "row_kind": "message"})
}

#[tokio::test]
async fn a_conversation_is_read_as_the_app_shows_it() {
    let r = rig_with(ApiLimits {
        message_cap: 40,
        ..limits()
    })
    .await;
    seed(
        &r,
        &[
            row(1, "user", "how is the build?"),
            json!({"role": "tool", "name": "terminal", "row_id": 2, "row_kind": "message"}),
            row(
                3,
                "assistant",
                &format!("green\nand the key is {}", CANARIES[0]),
            ),
            json!({"role": "assistant", "text": "(hidden)", "display_kind": "hidden", "row_id": 4, "row_kind": "message"}),
            json!({"role": "system", "text": "a summary", "row_id": 5, "row_kind": "compaction"}),
            row(6, "user", &"long ".repeat(30)),
        ],
    );
    let (status, _, body) = raw(
        r.server.addr(),
        &get(
            &r,
            "/v1/bots/kai/conversation?session=stored-1&limit=999",
            "",
        ),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let v = json_of(&body);
    assert_eq!(
        (v["profile"].as_str(), v["session_id"].as_str()),
        (Some("kai"), Some("stored-1"))
    );
    let msgs = v["messages"].as_array().unwrap();
    let ids: Vec<&str> = msgs.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(
        ids,
        ["r1", "r3", "r6"],
        "oldest first; tools, hidden rows and summaries are not the thread"
    );
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[1]["role"], "assistant");
    assert!(
        msgs[1]["text"].as_str().unwrap().contains("green\nand"),
        "line breaks are kept"
    );
    assert!(!body.contains("CANARY"), "{body}");
    assert_eq!(
        msgs[2]["truncated"], true,
        "a long message is cut and says so"
    );
    assert!(msgs[2]["text"].as_str().unwrap().chars().count() <= 40);
    assert_eq!(msgs[0]["state"], "done");
    assert_eq!(
        v["last_event_id"].as_u64(),
        Some(r.service.feed().last_id())
    );
    let asked = r.scripted.of("session.transcript");
    assert_eq!(
        asked[0].1["limit"], 200,
        "the engine is asked for no more rows than the cap"
    );
    assert_eq!(asked[0].1["order"], "latest");
    assert!(
        r.scripted.of("session.resume").is_empty(),
        "reading never attaches to the session"
    );
}

#[tokio::test]
async fn reading_a_conversation_refuses_in_words() {
    let r = rig().await;
    for (path, status, code) in [
        ("/v1/bots/kai/conversation?session=new", 400, "bad_session"),
        ("/v1/bots/kai/conversation?session=a:b/c", 400, "bad_query"),
        (
            "/v1/bots/nobody/conversation?session=s1",
            404,
            "no_such_bot",
        ),
        (
            "/v1/bots/kai/conversation?session=nope",
            404,
            "no_such_session",
        ),
        ("/v1/bots/kai/conversation", 404, "no_conversation"),
    ] {
        let (got, _, body) = raw(r.server.addr(), &get(&r, path, "")).await;
        assert_eq!(got, status, "{path} {body}");
        assert_eq!(json_of(&body)["error"]["code"], code, "{path}");
    }
    let body = json!({}).to_string();
    let (status, _, _) = raw(
        r.server.addr(),
        &post(&r, "/v1/bots/kai/conversation", &body, ""),
    )
    .await;
    assert_eq!(status, 405, "a conversation is read, never written, here");
    let no_token = format!(
        "GET /v1/bots/kai/conversation?session=s1 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
        r.server.addr().port()
    );
    let (status, _, body) = raw(r.server.addr(), &no_token).await;
    assert_eq!(status, 401);
    assert!(
        !body.contains("kai"),
        "an unauthorised read says nothing of the conversation"
    );
}

#[tokio::test]
async fn a_message_said_by_a_client_is_in_the_apps_transcript() {
    let r = rig().await;
    let body = json!({"text": "from the island", "session": "new"}).to_string();
    let (status, _, said) = raw(r.server.addr(), &post(&r, "/v1/bots/kai/say", &body, "")).await;
    assert_eq!(status, 200, "{said}");
    let stored = json_of(&said)["said"]["session_id"]
        .as_str()
        .unwrap()
        .to_owned();
    // what the app reads for that conversation is the engine's transcript: the message is in it, as the owner's own
    let (_, _, read) = raw(
        r.server.addr(),
        &get(
            &r,
            &format!("/v1/bots/kai/conversation?session={stored}"),
            "",
        ),
    )
    .await;
    let msgs = json_of(&read)["messages"].clone();
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[0]["text"], "from the island");
    let created = r.scripted.of("session.create");
    assert_eq!(
        created[0].1,
        json!({"source": "gui"}),
        "started exactly as the app starts a conversation"
    );
    let rows = r.store.lock().unwrap().clone();
    assert_eq!(rows.len(), 1);
    assert!(
        rows[0].get("client").is_none(),
        "the message carries no name"
    );
}

async fn follow(r: &Rig, query: &str) -> TcpStream {
    let mut s = TcpStream::connect(r.server.addr()).await.unwrap();
    s.write_all(get(r, &format!("/v1/events{query}"), "").as_bytes())
        .await
        .unwrap();
    let first = read_stream(&mut s, "event: hello", Duration::from_secs(2)).await;
    assert!(first.starts_with("HTTP/1.1 200"), "{first}");
    s
}

fn from_the_app(r: &Rig, bot: &str, session: &str, reply: &[&str]) {
    use crate::gateway::{Direction, FeedFrame};
    let frame = |direction, name: &str, payload: Option<Value>| FeedFrame {
        direction,
        name: name.into(),
        session_id: Some(session.into()),
        generation: None,
        payload,
    };
    let feed = r.service.feed();
    feed.on_frame(
        bot,
        &frame(
            Direction::Out,
            "prompt.submit",
            Some(json!({"session_id": session, "text": "typed in the app", "submission_id": "sub-1"})),
        ),
    );
    feed.on_frame(bot, &frame(Direction::In, "message.start", None));
    for piece in reply {
        feed.on_frame(
            bot,
            &frame(Direction::In, "message.delta", Some(json!({"text": piece}))),
        );
    }
    let whole: String = reply.concat();
    feed.on_frame(
        bot,
        &frame(
            Direction::In,
            "message.complete",
            Some(json!({"text": whole, "outcome": "completed"})),
        ),
    );
}

#[tokio::test]
async fn what_the_owner_types_in_the_app_and_the_reply_streams_reach_a_following_client() {
    let r = rig_with(ApiLimits {
        stream_every: Duration::ZERO,
        ..limits()
    })
    .await;
    let mut s = follow(&r, "?conversations=1&bot=kai").await;
    assert_eq!(
        *r.service.feed().text_wanted().borrow(),
        1,
        "the links copy words only while someone follows"
    );
    from_the_app(
        &r,
        "kai",
        "live-9",
        &["Hello, ", "the key is ", CANARIES[0]],
    );
    let got = read_stream(&mut s, "\"state\":\"done\"", Duration::from_secs(3)).await;
    assert!(got.contains("event: conversation.message"), "{got}");
    assert!(
        got.contains("typed in the app"),
        "the app's own message reaches the client: {got}"
    );
    assert!(got.contains("\"role\":\"user\""), "{got}");
    assert!(
        got.contains("\"state\":\"streaming\""),
        "the reply streams: {got}"
    );
    assert!(
        got.contains("Hello, the key is"),
        "the text so far grows: {got}"
    );
    assert!(
        !got.contains("CANARY"),
        "the scrubber runs on streamed text too: {got}"
    );
    // the reply is one message that finished, under the id it streamed with
    let ids: Vec<&str> = got
        .lines()
        .filter(|l| l.starts_with("data: ") && l.contains("\"role\":\"assistant\""))
        .filter_map(|l| l.split("\"id\":\"").nth(1)?.split('"').next())
        .collect();
    assert!(
        ids.len() >= 2 && ids.iter().all(|i| *i == ids[0]),
        "{ids:?}"
    );
    drop(s);
    // the server notices the closed connection at its next write (the keepalive)
    let mut wanted = r.service.feed().text_wanted();
    let _ = tokio::time::timeout(Duration::from_secs(3), wanted.wait_for(|n| *n == 0)).await;
    assert_eq!(
        *wanted.borrow(),
        0,
        "nobody follows: the links stop copying words"
    );
}

#[tokio::test]
async fn a_message_a_client_says_reaches_every_following_client() {
    let r = rig().await;
    let mut a = follow(&r, "?conversations=1").await;
    let mut b = follow(&r, "?conversations=1&bot=nina").await;
    let mut c = follow(&r, "").await;
    let body = json!({"text": "hello from the island", "session": "new"}).to_string();
    let (status, _, _) = raw(r.server.addr(), &post(&r, "/v1/bots/kai/say", &body, "")).await;
    assert_eq!(status, 200);
    let got = read_stream(&mut a, "hello from the island", Duration::from_secs(2)).await;
    assert!(
        got.contains("event: conversation.message") && got.contains("\"role\":\"user\""),
        "{got}"
    );
    assert!(
        got.contains("\"profile\":\"kai\"") && got.contains("stored-new"),
        "{got}"
    );
    let other = read_stream(&mut b, "hello from the island", Duration::from_millis(500)).await;
    assert!(
        !other.contains("hello from the island"),
        "a stream narrowed to nina does not get kai's words: {other}"
    );
    let none = read_stream(&mut c, "hello from the island", Duration::from_millis(500)).await;
    assert!(
        !none.contains("conversation.message"),
        "a stream that did not ask gets no words: {none}"
    );
}

#[tokio::test]
async fn nothing_of_a_conversation_is_copied_when_nobody_follows() {
    let r = rig().await;
    let mut s = follow(&r, "").await;
    from_the_app(&r, "kai", "live-9", &["secret words"]);
    let got = read_stream(&mut s, "\"state\":\"done\"", Duration::from_secs(1)).await;
    assert!(
        !got.contains("secret words") && !got.contains("typed in the app"),
        "{got}"
    );
}

#[tokio::test]
async fn following_conversations_refuses_what_it_does_not_understand() {
    let r = rig().await;
    for (query, code) in [
        ("?bot=kai", "bot_without_conversations"),
        (
            "?conversations=1&bot=a&bot=b&bot=c&bot=d&bot=e&bot=f&bot=g",
            "bad_bot",
        ),
        ("?conversations=1&bot=a:b/c", "bad_query"),
    ] {
        let (status, _, body) =
            raw(r.server.addr(), &get(&r, &format!("/v1/events{query}"), "")).await;
        assert_eq!(status, 400, "{query} {body}");
        assert_eq!(json_of(&body)["error"]["code"], code, "{query}");
    }
}

#[tokio::test]
async fn the_snapshots_are_full_from_the_first_request_without_a_stream() {
    // B24: no reader has opened a stream and nothing read the roster yet
    let dir = tempfile::tempdir().unwrap();
    let limits = limits();
    let feed = Feed::new(Audit::under(dir.path()), limits.clone());
    let (scripted, _store) = engine();
    let service = Service::new(
        feed,
        scripted,
        limits.clone(),
        crate::rooms::hold::Store::under(dir.path()),
        crate::config::RoomLimits::default(),
    );
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let server = Server::serve(
        listener,
        service.clone(),
        Token::from_text(TOKEN.into()),
        limits,
        Arc::new(Fixed(boopis_peer::Verdict::Owner)),
    )
    .unwrap();
    let port = server.addr().port();
    let req = |path: &str| {
        format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}\r\n\r\n"
        )
    };
    let (status, _, body) = raw(server.addr(), &req("/v1/bots")).await;
    assert_eq!(status, 200);
    assert_eq!(
        json_of(&body)["bots"].as_array().unwrap().len(),
        2,
        "{body}"
    );
    let (_, _, body) = raw(server.addr(), &req("/v1/rooms")).await;
    assert_eq!(json_of(&body)["rooms"][0]["id"], "g-paper", "{body}");
    let (_, _, body) = raw(server.addr(), &req("/v1/presence")).await;
    let presence = json_of(&body);
    assert_eq!(presence["presence"][0]["state"], "idle");
    assert!(
        presence["presence"][0]["source"].is_null(),
        "B25: idle names no source: {body}"
    );
}

#[tokio::test]
async fn a_rooms_log_and_its_stop_and_a_bots_stop_are_served_behind_the_same_checks() {
    let r = rig().await;
    let port = r.server.addr().port();
    let (status, _, body) = raw(
        r.server.addr(),
        &get(&r, "/v1/rooms/g-paper/log?limit=10", ""),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let log = json_of(&body);
    let kinds: Vec<&str> = log["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        ["message.user", "turn.cancelled", "message.member"],
        "B30: the cancelled turn is a line"
    );
    assert_eq!(log["lines"][2]["mentions_you"], true);
    for canary in CANARIES {
        assert!(!body.contains(canary), "scrubbed: {body}");
    }
    let (status, _, _) = raw(r.server.addr(), &get(&r, "/v1/rooms/g-nope/log", "")).await;
    assert_eq!(status, 404);
    // the new routes are behind the token, the Host check and the browser refusal like every other
    let (status, _, _) = raw(
        r.server.addr(),
        &format!("GET /v1/rooms/g-paper/log HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 401);
    let (status, _, _) = raw(
        r.server.addr(),
        &get(
            &r,
            "/v1/rooms/g-paper/log",
            "Origin: https://evil.example\r\n",
        ),
    )
    .await;
    assert_eq!(status, 403);
    let (status, _, body) = raw(
        r.server.addr(),
        &post(&r, "/v1/rooms/g-paper/stop", "{}", ""),
    )
    .await;
    assert_eq!(
        (status, json_of(&body)["stopped"].as_bool()),
        (200, Some(true)),
        "{body}"
    );
    let (status, _, body) = raw(r.server.addr(), &post(&r, "/v1/bots/kai/stop", "{}", "")).await;
    assert_eq!(
        (status, json_of(&body)["error"]["code"].as_str()),
        (409, Some("not_running")),
        "{body}"
    );
    let (status, _, _) = raw(r.server.addr(), &get(&r, "/v1/rooms/g-paper/stop", "")).await;
    assert_eq!(status, 405);
    let (status, _, body) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/rooms/g-paper/say",
            r#"{"text": "go", "now": "yes"}"#,
            "",
        ),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    let (status, _, body) = raw(
        r.server.addr(),
        &post(&r, "/v1/rooms/g-paper/say", r#"{"text": "go"}"#, ""),
    )
    .await;
    assert_eq!(
        (status, json_of(&body)["status"].as_str()),
        (200, Some("sent")),
        "{body}"
    );
    let (status, _, body) = raw(r.server.addr(), &get(&r, "/v1/events?room=g-paper", "")).await;
    assert_eq!(
        (status, json_of(&body)["error"]["code"].as_str()),
        (400, Some("room_without_rooms"))
    );
}

#[tokio::test]
async fn a_retry_is_served_behind_the_same_checks_and_refused_in_words() {
    // B43
    let r = rig().await;
    let (status, _, body) = raw(r.server.addr(), &post(&r, "/v1/bots/nina/retry", "{}", "")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(json_of(&body)["retried"]["session_id"], "stored-n");
    assert_eq!(r.scripted.of("prompt.submit")[0].1["text"], "again, please");
    for (path, body, status, code) in [
        ("/v1/bots/kai/retry", "{}", 404, "no_conversation"),
        (
            "/v1/bots/nina/retry",
            r#"{"session": "new"}"#,
            400,
            "bad_session",
        ),
        ("/v1/bots/nina/retry", r#"{"session": 5}"#, 400, "bad_json"),
        ("/v1/bots/nobody/retry", "{}", 404, "no_such_bot"),
    ] {
        let (got, _, answer) = raw(r.server.addr(), &post(&r, path, body, "")).await;
        assert_eq!(
            (got, json_of(&answer)["error"]["code"].as_str()),
            (status, Some(code)),
            "{path} {body}"
        );
    }
    let (status, _, _) = raw(r.server.addr(), &get(&r, "/v1/bots/nina/retry", "")).await;
    assert_eq!(status, 405);
    let no_token = format!(
        "POST /v1/bots/nina/retry HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}",
        r.server.addr().port()
    );
    let (status, _, _) = raw(r.server.addr(), &no_token).await;
    assert_eq!(status, 401);
    assert_eq!(
        r.scripted.of("command.dispatch").len(),
        1,
        "nothing refused reached the engine's retry"
    );
}

#[tokio::test]
async fn each_stream_gets_a_growing_reply_at_its_own_pace_and_the_words_never_stall() {
    // B46: one stream asks for 50 ms, one for a second; the feed sends at the fastest and each stream thins to its own
    use crate::gateway::{Direction, FeedFrame};
    let r = rig().await;
    let cancel = tokio_util::sync::CancellationToken::new();
    tokio::spawn(r.service.clone().run_flush(cancel.clone()));
    let mut fast = follow(&r, "?conversations=1&stream_ms=50").await;
    let mut slow = follow(&r, "?conversations=1&stream_ms=1000").await;
    assert_eq!(r.service.feed().stream_every(), Duration::from_millis(50));
    let frame = |name: &str, payload: Option<Value>| FeedFrame {
        direction: Direction::In,
        name: name.into(),
        session_id: Some("live-7".into()),
        generation: None,
        payload,
    };
    let feed = r.service.feed();
    feed.on_frame("kai", &frame("message.start", None));
    let mut whole = String::new();
    for i in 0..20 {
        let piece = format!("w{i} ");
        whole.push_str(&piece);
        feed.on_frame("kai", &frame("message.delta", Some(json!({"text": piece}))));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    // the deltas stop; the last words still arrive on each stream's own time
    let last = whole.trim_end().to_owned();
    let got_fast = read_stream(&mut fast, &last, Duration::from_secs(2)).await;
    let got_slow = read_stream(&mut slow, &last, Duration::from_secs(3)).await;
    let streaming = |text: &str| text.matches("\"state\":\"streaming\"").count();
    assert!(
        got_slow.contains(&last),
        "a held update is sent when its time comes: {got_slow}"
    );
    assert!(
        streaming(&got_fast) >= streaming(&got_slow) + 3,
        "fast {} slow {}",
        streaming(&got_fast),
        streaming(&got_slow)
    );
    assert!(streaming(&got_slow) <= 3, "{got_slow}");
    feed.on_frame(
        "kai",
        &frame(
            "message.complete",
            Some(json!({"text": whole, "outcome": "completed"})),
        ),
    );
    for s in [&mut fast, &mut slow] {
        let done = read_stream(s, "\"state\":\"done\"", Duration::from_secs(2)).await;
        assert!(
            done.contains("\"state\":\"done\""),
            "a finished message is sent at once: {done}"
        );
    }
    for (query, code) in [
        ("?conversations=1&stream_ms=10", "bad_stream_ms"),
        ("?conversations=1&stream_ms=5000", "bad_stream_ms"),
        ("?conversations=1&stream_ms=fast", "bad_stream_ms"),
        ("?stream_ms=100", "stream_ms_without_conversations"),
    ] {
        let (status, _, body) =
            raw(r.server.addr(), &get(&r, &format!("/v1/events{query}"), "")).await;
        assert_eq!(
            (status, json_of(&body)["error"]["code"].as_str()),
            (400, Some(code)),
            "{query}"
        );
    }
    cancel.cancel();
}

/// ADR-0059: another client reads the bots and answers approvals; it can never start, stop or read the microphone. The API
/// lists no such address, none that a client might guess answers with either method, and no event of the feed is about it.
/// (That the service itself is out of this module's reach is `dictation.rs`'s `nothing_but_the_command_reaches_the_microphone`.)
#[tokio::test]
async fn nothing_reaches_the_microphone() {
    const WORDS: [&str; 9] = [
        "dictat",
        "microphone",
        "mic",
        "audio",
        "speech",
        "transcri",
        "voice",
        "listen",
        "record",
    ];
    let r = rig_with(ApiLimits {
        read_rate: (1000, 1000),
        write_rate: (1000, 1000),
        ..limits()
    })
    .await;
    let addr = r.server.addr();
    let (status, _, body) = raw(addr, &get(&r, "/v1", "")).await;
    assert_eq!(status, 200);
    let listed: Vec<String> = json_of(&body)["endpoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e.as_str().unwrap().to_lowercase())
        .collect();
    assert!(listed.len() > 5, "the API lists its addresses: {listed:?}");
    for address in &listed {
        for word in WORDS {
            // `mic` alone would match nothing else an address says; the others are whole notions
            assert!(!address.contains(word), "{address:?} names {word:?}");
        }
    }
    for path in [
        "/v1/dictation",
        "/v1/dictation/start",
        "/v1/dictation/stop",
        "/v1/dictate",
        "/v1/microphone",
        "/v1/mic",
        "/v1/audio",
        "/v1/speech",
        "/v1/transcribe",
        "/v1/transcription",
        "/v1/voice",
        "/v1/listen",
        "/v1/record",
        "/v1/bots/kai/dictation",
        "/v1/bots/kai/listen",
        "/v1/rooms/r1/dictation",
    ] {
        assert_eq!(raw(addr, &get(&r, path, "")).await.0, 404, "GET {path}");
        assert_eq!(
            raw(addr, &post(&r, path, "{}", "")).await.0,
            404,
            "POST {path}"
        );
    }
    // the feed's own vocabulary (`model.rs`): no event of the stream is about audio
    let model = include_str!("model.rs").to_lowercase();
    assert!(
        model.contains("bots.changed"),
        "the feed's model was not read"
    );
    for word in ["dictat", "microphone", "audio", "transcri"] {
        assert!(!model.contains(word), "the feed's model names {word:?}");
    }
}

// ---------------------------------------------------------------- B47, H4: owner-voice routes from a bot's process

/// What a client the host refuses learns: one code, no detail of the check.
fn assert_owner_surface_unproven(status: u16, body: &str) {
    assert_eq!(status, 403, "{body}");
    let v = json_of(body);
    assert_eq!(v["error"]["code"], "owner_surface_unproven", "{body}");
    assert_eq!(v["error"]["message"], "Answer this in boopis.");
    for word in ["ancestry", "environment", "cgroup", "gateway", "pid"] {
        assert!(!body.contains(word), "{word} in {body}");
    }
}

fn audit_text(r: &Rig) -> String {
    std::fs::read_to_string(r._dir.path().join("audit").join("client-answers.jsonl"))
        .unwrap_or_default()
}

/// Every owner-voice route, refused from a bot's process (by each rule) and from a client that cannot be proved the
/// owner's (each reason), with nothing reaching the engine and the row still pending.
#[tokio::test]
async fn an_owner_voice_request_from_a_bot_s_process_is_refused_and_nothing_reaches_the_engine() {
    use boopis_peer::{Rule, Unproven, Verdict};
    for verdict in [
        Verdict::Bot(Rule::Ancestry),
        Verdict::Bot(Rule::Environment),
        Verdict::Bot(Rule::Group),
        Verdict::Unproven(Unproven::NoGateway),
        Verdict::Unproven(Unproven::NotFound),
        Verdict::Unproven(Unproven::Unreadable),
        Verdict::Unproven(Unproven::Unsupported),
        Verdict::Unproven(Unproven::Timeout),
    ] {
        let r = rig_owned(
            ApiLimits {
                write_rate: (100, 100),
                ..limits()
            },
            Arc::new(Fixed(verdict)),
        )
        .await;
        ask(&r, "p1", "rm -rf build");
        for (path, body) in [
            ("/v1/approvals/p1", json!({"choice": "once"})),
            ("/v1/approvals/p1", json!({"choice": "deny"})),
            ("/v1/bots/kai/say", json!({"text": "approve it"})),
            ("/v1/bots/nina/retry", json!({})),
            ("/v1/rooms/g-paper/say", json!({"text": "go"})),
        ] {
            let (status, _, resp) =
                raw(r.server.addr(), &post(&r, path, &body.to_string(), "")).await;
            assert_owner_surface_unproven(status, &resp);
        }
        for method in [
            "approval.respond",
            "prompt.submit",
            "groups.send",
            "command.dispatch",
        ] {
            assert!(
                r.scripted.of(method).is_empty(),
                "{verdict:?} reached {method}"
            );
        }
        let (_, _, list) = raw(r.server.addr(), &get(&r, "/v1/approvals", "")).await;
        assert_eq!(json_of(&list)["approvals"][0]["state"], "pending");
        let audit = audit_text(&r);
        let expected = super::owner::refusal_outcome(verdict);
        assert!(audit.contains(&expected), "{verdict:?}: {audit}");
        assert!(audit.contains("\"prompt_id\":\"p1\""), "{audit}");
        assert!(
            !audit.contains("approve it"),
            "never the message text: {audit}"
        );
    }
}

#[tokio::test]
async fn stops_and_reads_stay_open_to_a_bot_s_process() {
    let r = rig_owned(
        limits(),
        Arc::new(Fixed(boopis_peer::Verdict::Bot(
            boopis_peer::Rule::Ancestry,
        ))),
    )
    .await;
    for path in [
        "/v1",
        "/v1/bots",
        "/v1/presence",
        "/v1/approvals",
        "/v1/rooms",
    ] {
        let (status, _, body) = raw(r.server.addr(), &get(&r, path, "")).await;
        assert_eq!(status, 200, "{path} {body}");
    }
    let (status, _, body) = raw(
        r.server.addr(),
        &post(&r, "/v1/rooms/g-paper/stop", "{}", ""),
    )
    .await;
    assert_ne!(status, 403, "{body}");
    assert_ne!(
        json_of(&body)["error"]["code"],
        "owner_surface_unproven",
        "{body}"
    );
}

#[tokio::test]
async fn the_owner_s_own_client_still_answers() {
    let r = rig().await;
    ask(&r, "p1", "rm -rf build");
    let (status, _, body) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/approvals/p1",
            &json!({"choice": "once"}).to_string(),
            "",
        ),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(r.scripted.of("approval.respond").len(), 1);
}

/// The real check over this machine (Linux): the test process is the client, and no gateway is identified yet, so an
/// answer is refused (the spec's test 12); once a gateway that is not this process's ancestor is identified, it passes.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn the_system_check_refuses_until_a_gateway_is_identified_and_then_answers_the_owner() {
    let peers = Arc::new(crate::secrets::PeerPolicy::new());
    let r = rig_owned(
        limits(),
        Arc::new(super::owner::SystemCheck::new(peers.clone())),
    )
    .await;
    ask(&r, "p1", "rm -rf build");
    let answer = post(
        &r,
        "/v1/approvals/p1",
        &json!({"choice": "once"}).to_string(),
        "",
    );
    let (status, _, body) = raw(r.server.addr(), &answer).await;
    assert_owner_surface_unproven(status, &body);
    let mut unrelated = std::process::Command::new("sleep")
        .arg("20")
        .spawn()
        .unwrap();
    peers.note_engine(unrelated.id());
    let (status, _, body) = raw(r.server.addr(), &answer).await;
    let _ = unrelated.kill();
    let _ = unrelated.wait();
    assert_eq!(status, 200, "{body}");
}
