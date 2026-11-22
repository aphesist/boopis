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

fn engine() -> Arc<Scripted> {
    Arc::new(Scripted::new(|profile, method, params| match method {
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
        "prompt.submit" => Ok(json!({"status": "started"})),
        "groups.send" => Ok(json!({"accepted": true})),
        "approval.respond" => {
            assert_eq!(profile, "kai");
            assert_eq!(params["choice"], "once");
            Ok(json!({"resolved": 1}))
        }
        _ => Err(Error::Unavailable(format!("unscripted {method}"))),
    }))
}

struct Rig {
    server: Server<Scripted>,
    service: Arc<Service<Scripted>>,
    scripted: Arc<Scripted>,
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
    let dir = tempfile::tempdir().unwrap();
    let feed = Feed::new(Audit::under(dir.path()), limits.clone());
    let scripted = engine();
    let service = Service::new(feed, scripted.clone(), limits.clone());
    service.refresh_roster().await;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let server = Server::serve(
        listener,
        service.clone(),
        Token::from_text(TOKEN.into()),
        limits,
    )
    .unwrap();
    service.feed().never_say(vec![TOKEN.to_owned()]);
    Rig {
        server,
        service,
        scripted,
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
            raw(
                r.server.addr(),
                &post(
                    &r,
                    "/v1/bots/kai/say",
                    &body,
                    "X-Boopis-Client: panacea-island\r\n",
                ),
            )
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
async fn saying_to_a_bot_reaches_the_engine_with_the_callers_label() {
    let r = rig().await;
    let body = json!({"text": "hello", "session": "new"}).to_string();
    let (status, _, resp) = raw(
        r.server.addr(),
        &post(
            &r,
            "/v1/bots/nina/say",
            &body,
            "X-Boopis-Client: panacea-island\r\n",
        ),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    assert_eq!(json_of(&resp)["said"]["session_id"], "stored-new");
    let created = r.scripted.of("session.create");
    assert_eq!(created[0].0, "nina");
    assert_eq!(created[0].1["client"]["name"], "panacea-island");
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
        post(
            &r,
            "/v1/approvals/p1",
            &body,
            "X-Boopis-Client: panacea-island\r\n",
        ),
        post(
            &r,
            "/v1/approvals/p1",
            &body,
            "X-Boopis-Client: boopis-cli\r\n",
        ),
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
    assert!(
        ["panacea-island", "boopis-cli"].contains(&row["answered_by"]["client"].as_str().unwrap())
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
        json_of(&list)["approvals"][0]["answered_by"]["client"],
        "boopis-reference"
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
        c.args([
            "-s",
            "--max-time",
            "5",
            "-H",
            &auth,
            "-H",
            "X-Boopis-Client: panacea-island",
        ]);
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
    assert_eq!(
        answered["approval"]["answered_by"]["client"],
        "panacea-island"
    );
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
