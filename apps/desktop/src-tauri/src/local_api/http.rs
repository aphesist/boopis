//! The loopback endpoint (`ADR-0045`, `docs/LOCAL-API.md`): a small HTTP/1.1 server on `127.0.0.1`, written by hand (no new
//! dependency; the ChatGPT callback is the precedent). One request per connection, except the event stream. Every rule of
//! `wire` is applied here in the order that model fixes; routing starts only after the token has passed.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::Instant;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, watch};
use tokio_util::sync::CancellationToken;

use super::engine::Engine;
use super::feed::Subscription;
use super::model::{API_VERSION, Event, Stamped};
use super::owner::{self, OwnerCheck};
use super::service::{ApiError, Caller, Pick, Service};
use super::token::Token;
use super::wire::{self, Bucket, DoorGuard, Head, Method, Reject};
use crate::config::ApiLimits;

struct Limiters {
    reads: Bucket,
    writes: Bucket,
    door: DoorGuard,
}

struct Shared<E: Engine> {
    service: Arc<Service<E>>,
    token: RwLock<Token>,
    /// Bumped when the token is rotated: every open stream ends.
    epoch: watch::Sender<u64>,
    limits: ApiLimits,
    limiters: Mutex<Limiters>,
    connections: Arc<Semaphore>,
    streams: Semaphore,
    port: u16,
    /// Who holds a connection's client end: an owner-voice request from a bot's process is refused (B47, H4).
    owner: Arc<dyn OwnerCheck>,
}

/// A running endpoint.
pub struct Server<E: Engine> {
    shared: Arc<Shared<E>>,
    addr: SocketAddr,
    cancel: CancellationToken,
}

impl<E: Engine> Server<E> {
    /// Bind `127.0.0.1` (the preferred port, else any free one) and start serving. Never another address.
    ///
    /// # Errors
    /// The I/O error when no port can be had.
    pub async fn start(
        service: Arc<Service<E>>,
        token: Token,
        limits: ApiLimits,
        owner: Arc<dyn OwnerCheck>,
    ) -> std::io::Result<Self> {
        let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, limits.preferred_port)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?,
        };
        Self::serve(listener, service, token, limits, owner)
    }

    /// Serve on a listener the caller bound (the tests bind port 0).
    ///
    /// # Errors
    /// The I/O error of reading the listener's address.
    pub fn serve(
        listener: TcpListener,
        service: Arc<Service<E>>,
        token: Token,
        limits: ApiLimits,
        owner: Arc<dyn OwnerCheck>,
    ) -> std::io::Result<Self> {
        let addr = listener.local_addr()?;
        let now = Instant::now();
        let shared = Arc::new(Shared {
            service,
            token: RwLock::new(token),
            epoch: watch::channel(0).0,
            limiters: Mutex::new(Limiters {
                reads: Bucket::new(limits.read_rate, now),
                writes: Bucket::new(limits.write_rate, now),
                door: DoorGuard::default(),
            }),
            connections: Arc::new(Semaphore::new(limits.max_connections)),
            streams: Semaphore::new(limits.max_streams),
            limits,
            port: addr.port(),
            owner,
        });
        let cancel = CancellationToken::new();
        tokio::spawn(accept_loop(listener, shared.clone(), cancel.clone()));
        Ok(Self {
            shared,
            addr,
            cancel,
        })
    }

    /// Where it listens.
    #[must_use]
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Replace the token: the old one stops working at once and every open stream ends.
    pub fn rotate(&self, token: Token) {
        *self
            .shared
            .token
            .write()
            .unwrap_or_else(PoisonError::into_inner) = token;
        self.shared.epoch.send_modify(|e| *e += 1);
    }

    /// Streams open now.
    #[must_use]
    pub fn streams(&self) -> usize {
        self.shared.limits.max_streams - self.shared.streams.available_permits()
    }

    /// Stop: the listener closes and every stream ends.
    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

impl<E: Engine> Drop for Server<E> {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

async fn accept_loop<E: Engine>(
    listener: TcpListener,
    shared: Arc<Shared<E>>,
    cancel: CancellationToken,
) {
    loop {
        let accepted = tokio::select! {
            () = cancel.cancelled() => return,
            a = listener.accept() => a,
        };
        let Ok((mut stream, peer)) = accepted else {
            continue;
        };
        if peer.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
            continue; // the listener is loopback only; this is belt and braces
        }
        let Ok(permit) = shared.connections.clone().try_acquire_owned() else {
            let _ = write_json(
                &mut stream,
                503,
                &error_body("busy", "Too many connections. Try again in a moment."),
                &[],
            )
            .await;
            continue;
        };
        let (shared, cancel) = (shared.clone(), cancel.clone());
        tokio::spawn(async move {
            let _permit = permit;
            serve_one(stream, peer, &shared, &cancel).await;
        });
    }
}

fn error_body(code: &str, message: &str) -> Value {
    json!({"error": {"code": code, "message": message}})
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        414 => "URI Too Long",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        505 => "HTTP Version Not Supported",
        _ => "Error",
    }
}

const COMMON: &str = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n";

async fn write_json(
    stream: &mut TcpStream,
    status: u16,
    body: &Value,
    extra: &[(&str, String)],
) -> std::io::Result<()> {
    let text = body.to_string();
    let mut head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n{COMMON}",
        reason(status),
        text.len()
    );
    for (k, v) in extra {
        let _ = write!(head, "{k}: {v}\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(text.as_bytes()).await?;
    stream.shutdown().await
}

async fn refuse(stream: &mut TcpStream, r: &Reject) {
    let mut extra: Vec<(&str, String)> = Vec::new();
    if r.status == 401 {
        extra.push(("WWW-Authenticate", "Bearer".to_owned()));
    }
    if r.status == 405 {
        extra.push(("Allow", "GET, POST".to_owned()));
    }
    let _ = write_json(stream, r.status, &error_body(r.code, r.message), &extra).await;
}

/// Read the head, and the body the head declares.
async fn read_request<E: Engine>(
    stream: &mut TcpStream,
    shared: &Shared<E>,
) -> Result<(Head, Vec<u8>), Reject> {
    let limits = &shared.limits;
    let slow = Reject {
        status: 400,
        code: "timeout",
        message: "The request took too long to arrive.",
    };
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let deadline = tokio::time::Instant::now() + limits.read_timeout;
    let end = loop {
        if let Some(end) = wire::head_end(&buf) {
            break end;
        }
        if buf.len() > limits.max_head {
            return Err(Reject {
                status: 431,
                code: "head_too_large",
                message: "The request's headers are too large.",
            });
        }
        let mut chunk = [0u8; 1024];
        let n = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(Ok(n)) if n > 0 => n,
            Ok(_) => {
                return Err(Reject {
                    status: 400,
                    code: "bad_request",
                    message: "The request ended too soon.",
                });
            }
            Err(_) => return Err(slow),
        };
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = wire::parse_head(&buf[..end], limits)?;
    // Everything before the token: the Host, the Origin, the shape.
    wire::check_origin(&head, shared.port)?;
    let want = wire::body_length(&head, limits)?;
    // The token, before a body is read at all.
    authenticate(&head, shared)?;
    let mut body = buf[end..].to_vec();
    if body.len() > want {
        body.truncate(want); // anything after the body is a second request; there is one per connection
    }
    while body.len() < want {
        let mut chunk = [0u8; 4096];
        let n = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(Ok(n)) if n > 0 => n,
            Ok(_) => {
                return Err(Reject {
                    status: 400,
                    code: "bad_request",
                    message: "The request ended too soon.",
                });
            }
            Err(_) => return Err(slow),
        };
        body.extend_from_slice(&chunk[..n.min(want - body.len())]);
    }
    Ok((head, body))
}

fn authenticate<E: Engine>(head: &Head, shared: &Shared<E>) -> Result<(), Reject> {
    let now = Instant::now();
    let mut lim = shared
        .limiters
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if lim.door.shut(now) {
        return Err(Reject {
            status: 429,
            code: "too_many_failures",
            message: "Too many wrong tokens. Wait a few seconds and try again.",
        });
    }
    let good = wire::authorized(
        head,
        &shared.token.read().unwrap_or_else(PoisonError::into_inner),
    );
    if !good {
        lim.door.failed(now, &shared.limits);
        return Err(Reject {
            status: 401,
            code: "unauthorized",
            message: "A valid token is needed: send the contents of the client-token file as a Bearer token.",
        });
    }
    lim.door.succeeded();
    let bucket = if head.method == Method::Post {
        &mut lim.writes
    } else {
        &mut lim.reads
    };
    if !bucket.take(now) {
        return Err(Reject {
            status: 429,
            code: "rate_limited",
            message: "Too many requests. Slow down.",
        });
    }
    Ok(())
}

async fn serve_one<E: Engine>(
    mut stream: TcpStream,
    peer: SocketAddr,
    shared: &Arc<Shared<E>>,
    cancel: &CancellationToken,
) {
    let (head, body) = match read_request(&mut stream, shared).await {
        Ok(r) => r,
        Err(r) => {
            tracing::debug!(code = r.code, "the local API refused a request");
            refuse(&mut stream, &r).await;
            return;
        }
    };
    // B47, H4: after the token and the Host, before the body is acted on, an answer or a message in the owner's voice is
    // refused when any holder of the client's end is a bot's process, or cannot be shown not to be.
    if owner::owner_voice(head.method, &head.path) {
        let server = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), shared.port);
        let verdict = owner::judge_within(
            shared.owner.clone(),
            peer,
            server,
            owner::OWNER_LOOKUP_DEADLINE,
        )
        .await;
        if !verdict.is_owner() {
            refuse_owner_voice(&head, verdict, shared);
            let _ = write_json(
                &mut stream,
                403,
                &error_body(owner::REFUSAL_CODE, owner::REFUSAL_MESSAGE),
                &[],
            )
            .await;
            return;
        }
    }
    let caller = Caller::through("endpoint");
    if head.method == Method::Get && head.path == "/v1/events" {
        events(stream, shared, &head, cancel).await;
        return;
    }
    let (status, value) = match route(shared, &head, &body, &caller).await {
        Ok(v) => (200, v),
        Err(e) => (e.status, error_body(e.code, &e.message)),
    };
    let _ = write_json(&mut stream, status, &value, &[]).await;
}

/// Record a refused owner-voice request: the route's subject (the approval, the bot or the room), the rule that matched or
/// why the client could not be proved the owner's. Never a pid (that goes to the log at `debug`).
fn refuse_owner_voice<E: Engine>(head: &Head, verdict: boopis_peer::Verdict, shared: &Shared<E>) {
    let parts: Vec<&str> = head.path.trim_start_matches('/').split('/').collect();
    let (profile, prompt_id, choice) = match parts.as_slice() {
        ["v1", "approvals", id] => (String::new(), (*id).to_owned(), "answer"),
        ["v1", "bots" | "rooms", subject, what] => ((*subject).to_owned(), String::new(), *what),
        _ => (String::new(), String::new(), ""),
    };
    let outcome = owner::refusal_outcome(verdict);
    tracing::info!(path = %head.path, outcome = %outcome, "the local API refused an owner-voice request (B47)");
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    shared.service.feed().record(&super::audit::Line {
        at,
        profile: profile.chars().take(128).collect(),
        session_id: String::new(),
        prompt_id: prompt_id.chars().take(128).collect(),
        choice: choice.to_owned(),
        outcome,
        surface: "endpoint".to_owned(),
    });
}

fn segment_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

fn not_found() -> ApiError {
    ApiError {
        status: 404,
        code: "not_found",
        message: "There is nothing at that address.".into(),
    }
}

fn bad_json() -> ApiError {
    ApiError {
        status: 400,
        code: "bad_json",
        message: "The body must be a JSON object with the fields the call names.".into(),
    }
}

fn object(body: &[u8]) -> Result<serde_json::Map<String, Value>, ApiError> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err(bad_json()),
    }
}

#[allow(clippy::too_many_lines)] // one table of routes
async fn route<E: Engine>(
    shared: &Shared<E>,
    head: &Head,
    body: &[u8],
    caller: &Caller,
) -> Result<Value, ApiError> {
    let feed = shared.service.feed();
    let parts: Vec<&str> = head.path.trim_start_matches('/').split('/').collect();
    let method_not_allowed = || ApiError {
        status: 405,
        code: "method_not_allowed",
        message: "That address does not take this method.".into(),
    };
    match (head.method, parts.as_slice()) {
        (Method::Get, ["v1"]) => Ok(json!({
            "name": "boopis", "api": API_VERSION,
            "endpoints": ["GET /v1/bots", "GET /v1/presence", "GET /v1/notifications", "GET /v1/approvals", "POST /v1/approvals/<id>",
                          "POST /v1/bots/<name>/say", "GET /v1/bots/<name>/conversation", "POST /v1/bots/<name>/stop",
                          "POST /v1/bots/<name>/retry",
                          "GET /v1/rooms", "GET /v1/rooms/<id>/log", "POST /v1/rooms/<id>/say", "POST /v1/rooms/<id>/stop",
                          "GET /v1/events"]
        })),
        (Method::Get, ["v1", "bots"]) => {
            shared.service.ensure_fresh().await;
            Ok(json!({"bots": feed.bots(), "last_event_id": feed.last_id()}))
        }
        (Method::Get, ["v1", "presence"]) => {
            shared.service.ensure_fresh().await;
            Ok(json!({"presence": feed.presence(), "last_event_id": feed.last_id()}))
        }
        (Method::Get, ["v1", "notifications"]) => {
            let after = head.param("after").and_then(|a| a.parse::<u64>().ok());
            let limit = head
                .param("limit")
                .and_then(|a| a.parse::<usize>().ok())
                .unwrap_or(50)
                .clamp(1, 200);
            Ok(json!({"notifications": feed.notifications(after, limit)}))
        }
        (Method::Get, ["v1", "approvals"]) => Ok(
            json!({"approvals": feed.approvals(head.param("all").is_some_and(|v| v == "1" || v == "true"))}),
        ),
        (Method::Get, ["v1", "rooms"]) => {
            shared.service.ensure_fresh().await;
            Ok(json!({"rooms": feed.rooms()}))
        }
        (Method::Get, ["v1", "rooms", id, "log"]) if segment_ok(id) => {
            let after = head.param("after").and_then(|a| a.parse::<u64>().ok());
            let limit = head
                .param("limit")
                .and_then(|a| a.parse::<usize>().ok())
                .unwrap_or(100);
            let log = shared.service.room_log(id, after, limit).await?;
            Ok(serde_json::to_value(log).unwrap_or(Value::Null))
        }
        (Method::Post, ["v1", "rooms", id, "stop"]) if segment_ok(id) => {
            object(body)?;
            shared.service.room_stop(id, caller).await
        }
        (Method::Post, ["v1", "bots", name, "stop"]) if segment_ok(name) => {
            let m = object(body)?;
            let session = match m.get("session_id") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) if segment_ok(s) => Some(s.clone()),
                Some(_) => return Err(bad_json()),
            };
            shared
                .service
                .bot_stop(name, session.as_deref(), caller)
                .await
        }
        (Method::Post, ["v1", "approvals", id]) if segment_ok(id) => {
            let m = object(body)?;
            let choice = m
                .get("choice")
                .and_then(Value::as_str)
                .ok_or_else(|| ApiError {
                    status: 400,
                    code: "choice_required",
                    message: "Say what to do: choice is once or deny. There is no default.".into(),
                })?;
            let generation = m.get("execution_generation").and_then(Value::as_u64);
            let row = shared
                .service
                .answer(id, choice, generation, caller)
                .await?;
            Ok(json!({"approval": row}))
        }
        (Method::Get, ["v1", "bots", name, "conversation"]) if segment_ok(name) => {
            let pick = Pick::parse(head.param("session"))?;
            let limit = head
                .param("limit")
                .and_then(|a| a.parse::<usize>().ok())
                .unwrap_or(100);
            let read = shared.service.conversation(name, &pick, limit).await?;
            Ok(serde_json::to_value(read).unwrap_or(Value::Null))
        }
        (Method::Post, ["v1", "bots", name, "say"]) if segment_ok(name) => {
            let m = object(body)?;
            let text = m.get("text").and_then(Value::as_str).ok_or_else(bad_json)?;
            let pick = Pick::parse(m.get("session").and_then(Value::as_str))?;
            let said = shared.service.say(name, text, &pick, caller).await?;
            Ok(json!({"said": said}))
        }
        (Method::Post, ["v1", "bots", name, "retry"]) if segment_ok(name) => {
            let m = object(body)?;
            let pick = match m.get("session") {
                None | Some(Value::Null) => Pick::Latest,
                Some(Value::String(s)) => Pick::parse(Some(s))?,
                Some(_) => return Err(bad_json()),
            };
            let retried = shared.service.retry(name, &pick, caller).await?;
            Ok(json!({"retried": retried}))
        }
        (Method::Post, ["v1", "rooms", id, "say"]) if segment_ok(id) => {
            let m = object(body)?;
            let text = m.get("text").and_then(Value::as_str).ok_or_else(bad_json)?;
            let now = match m.get("now") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(bad_json()),
            };
            let sent = shared.service.say_room(id, text, now, caller).await?;
            Ok(
                json!({"ok": true, "status": sent.status, "event_id": sent.event_id, "held": sent.held}),
            )
        }
        (
            Method::Get,
            ["v1", "approvals", _]
            | ["v1", "bots" | "rooms", _, "say" | "stop"]
            | ["v1", "bots", _, "retry"],
        )
        | (
            Method::Post,
            ["v1"]
            | [
                "v1",
                "bots" | "presence" | "notifications" | "approvals" | "rooms" | "events",
            ]
            | ["v1", "bots", _, "conversation"]
            | ["v1", "rooms", _, "log"],
        ) => Err(method_not_allowed()),
        _ => Err(not_found()),
    }
}

/// Which conversations a stream follows: none unless it asks (`conversations=1`), then every bot's, or only the bots it
/// names (`bot=<name>`, a few at most). Rooms the same way: none unless it asks (`rooms=1`), then every room's lines, state
/// and held messages, or only the rooms it names (`room=<id>`).
struct Follow {
    on: bool,
    bots: Vec<String>,
    rooms_on: bool,
    rooms: Vec<String>,
    /// The stream's own pace for a growing reply (`stream_ms`, B46).
    pace: Option<std::time::Duration>,
}

impl Follow {
    fn from_query(head: &Head, limits: &ApiLimits) -> Result<Self, ApiError> {
        let max_bots = limits.follow_bots;
        let on = head
            .param("conversations")
            .is_some_and(|v| v == "1" || v == "true");
        let bots: Vec<String> = head
            .query
            .iter()
            .filter(|(k, _)| k == "bot")
            .map(|(_, v)| v.clone())
            .collect();
        if !bots.is_empty() && !on {
            return Err(ApiError {
                status: 400,
                code: "bot_without_conversations",
                message: "bot narrows the conversations a stream follows: ask for conversations=1 as well.".into(),
            });
        }
        if bots.len() > max_bots || bots.iter().any(|b| !segment_ok(b)) {
            return Err(ApiError {
                status: 400,
                code: "bad_bot",
                message: format!("Name at most {max_bots} bots, each by its profile name."),
            });
        }
        let rooms_on = head.param("rooms").is_some_and(|v| v == "1" || v == "true");
        let rooms: Vec<String> = head
            .query
            .iter()
            .filter(|(k, _)| k == "room")
            .map(|(_, v)| v.clone())
            .collect();
        if !rooms.is_empty() && !rooms_on {
            return Err(ApiError {
                status: 400,
                code: "room_without_rooms",
                message: "room narrows the rooms a stream follows: ask for rooms=1 as well.".into(),
            });
        }
        if rooms.len() > max_bots || rooms.iter().any(|r| !segment_ok(r)) {
            return Err(ApiError {
                status: 400,
                code: "bad_room",
                message: format!("Name at most {max_bots} rooms, each by its id."),
            });
        }
        let (fastest, slowest) = limits.stream_pace;
        let pace = match head.param("stream_ms") {
            None => None,
            Some(v) => {
                let ms = v
                    .parse::<u64>()
                    .ok()
                    .map(std::time::Duration::from_millis)
                    .filter(|d| (fastest..=slowest).contains(d));
                if ms.is_none() {
                    return Err(ApiError {
                        status: 400,
                        code: "bad_stream_ms",
                        message: format!(
                            "stream_ms is how often a growing reply is sent again, in milliseconds from {} to {}.",
                            fastest.as_millis(),
                            slowest.as_millis()
                        ),
                    });
                }
                ms
            }
        };
        if pace.is_some() && !on {
            return Err(ApiError {
                status: 400,
                code: "stream_ms_without_conversations",
                message:
                    "stream_ms paces the words of conversations: ask for conversations=1 as well."
                        .into(),
            });
        }
        Ok(Self {
            on,
            bots,
            rooms_on,
            rooms,
            pace,
        })
    }

    fn room(&self, id: &str) -> bool {
        self.rooms_on && (self.rooms.is_empty() || self.rooms.iter().any(|r| r == id))
    }

    /// Whether an event is for this stream: a conversation's and a room's only to a stream that asked for them, every other
    /// event to every stream.
    fn wants(&self, stamped: &Stamped) -> bool {
        match &stamped.event {
            Event::Conversation(c) => {
                self.on && (self.bots.is_empty() || self.bots.contains(&c.profile))
            }
            Event::RoomLine(r) => self.room(&r.room_id),
            Event::RoomState(r) => self.room(&r.room_id),
            Event::RoomHeld(r) => self.room(&r.room_id),
            _ => true,
        }
    }
}

fn sse(stamped: &Stamped) -> String {
    let data = serde_json::to_string(stamped).unwrap_or_default();
    format!(
        "id: {}\nevent: {}\ndata: {data}\n\n",
        stamped.id,
        stamped.event.name()
    )
}

fn sse_plain(event: &str, data: &Value) -> String {
    format!("event: {event}\ndata: {data}\n\n")
}

/// Write to a stream within the write limit; false when the client is gone or too slow (the stream then ends).
async fn put(stream: &mut TcpStream, text: &str, limit: std::time::Duration) -> bool {
    matches!(
        tokio::time::timeout(limit, stream.write_all(text.as_bytes())).await,
        Ok(Ok(()))
    )
}

/// A stream's own pace for a growing reply (B46): the feed sends a reply again at the fastest pace any stream asked for, and
/// each stream thins those updates to its own. The latest update it held back is sent when its time comes, so the words
/// never stall; a finished message is sent at once and drops what was held of it.
struct Pace {
    every: std::time::Duration,
    /// Per message: when it was last sent, and the newest update held back since.
    held: HashMap<String, (tokio::time::Instant, Option<Arc<Stamped>>)>,
}

/// Messages a stream keeps a pace for at most (a reply that never finishes is forgotten past this).
const PACED_MAX: usize = 64;

impl Pace {
    fn new(every: std::time::Duration) -> Self {
        Self {
            every,
            held: HashMap::new(),
        }
    }

    /// Whether to send an event now; an update that comes too soon is held instead.
    fn admit(&mut self, e: &Arc<Stamped>, now: tokio::time::Instant) -> bool {
        let Event::Conversation(c) = &e.event else {
            return true;
        };
        if c.message.state == super::model::MessageState::Done {
            self.held.remove(&c.message.id);
            return true;
        }
        match self.held.get_mut(&c.message.id) {
            Some((sent, pending)) if now.duration_since(*sent) < self.every => {
                *pending = Some(e.clone());
                false
            }
            Some((sent, pending)) => {
                *sent = now;
                *pending = None;
                true
            }
            None => {
                if self.held.len() >= PACED_MAX {
                    self.held.clear();
                }
                self.held.insert(c.message.id.clone(), (now, None));
                true
            }
        }
    }

    /// When the next held update is due.
    fn due(&self) -> Option<tokio::time::Instant> {
        self.held
            .values()
            .filter(|(_, p)| p.is_some())
            .map(|(sent, _)| *sent + self.every)
            .min()
    }

    /// The held updates whose time has come, oldest first.
    fn take_due(&mut self, now: tokio::time::Instant) -> Vec<Arc<Stamped>> {
        let mut out = Vec::new();
        for (sent, pending) in self.held.values_mut() {
            if pending.is_some() && now.duration_since(*sent) >= self.every {
                *sent = now;
                out.extend(pending.take());
            }
        }
        out.sort_by_key(|e| e.id);
        out
    }
}

async fn events<E: Engine>(
    mut stream: TcpStream,
    shared: &Arc<Shared<E>>,
    head: &Head,
    cancel: &CancellationToken,
) {
    let Ok(_permit) = shared.streams.try_acquire() else {
        let _ = write_json(
            &mut stream,
            503,
            &error_body(
                "too_many_streams",
                "Too many event streams are open. Close one first.",
            ),
            &[],
        )
        .await;
        return;
    };
    let limit = shared.limits.read_timeout;
    let follow = match Follow::from_query(head, &shared.limits) {
        Ok(f) => f,
        Err(e) => {
            let _ = write_json(&mut stream, e.status, &error_body(e.code, &e.message), &[]).await;
            return;
        }
    };
    let since = head
        .header("last-event-id")
        .and_then(|v| v.trim().parse::<u64>().ok());
    let sub = shared.service.feed().subscribe(since);
    let every = follow.pace.unwrap_or(shared.limits.stream_every);
    let _follower = follow.on.then(|| shared.service.feed().follower_at(every));
    let mut pace = Pace::new(every);
    let mut epoch = shared.epoch.subscribe();
    epoch.borrow_and_update();
    let preamble = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nX-Accel-Buffering: no\r\n{COMMON}\r\nretry: 3000\n\n"
    );
    let hello = sse_plain(
        "hello",
        &json!({"version": API_VERSION, "last_event_id": shared.service.feed().last_id()}),
    );
    if !put(&mut stream, &preamble, limit).await || !put(&mut stream, &hello, limit).await {
        return;
    }
    if sub.gap {
        let gap = sse_plain(
            "lagged",
            &json!({"skipped": 0, "reason": "the last id the stream sent is older than the events kept"}),
        );
        if !put(&mut stream, &gap, limit).await {
            return;
        }
    }
    for e in sub.backlog.iter().filter(|e| follow.wants(e)) {
        if !put(&mut stream, &sse(e), limit).await {
            return;
        }
    }
    let Subscription {
        mut rx, consumer, ..
    } = sub;
    let _consumer = consumer; // the feed polls the engine for as long as this stream lives
    let mut beat = tokio::time::interval(shared.limits.keepalive);
    beat.tick().await;
    loop {
        let due = pace.due();
        tokio::select! {
            () = cancel.cancelled() => return,
            _ = epoch.changed() => return,
            _ = beat.tick() => {
                if !put(&mut stream, ": keepalive\n\n", limit).await { return; }
            }
            () = async { if let Some(at) = due { tokio::time::sleep_until(at).await } }, if due.is_some() => {
                for e in pace.take_due(tokio::time::Instant::now()) {
                    if !put(&mut stream, &sse(&e), limit).await { return; }
                }
            }
            got = rx.recv() => match got {
                Ok(e) => {
                    let send = follow.wants(&e) && pace.admit(&e, tokio::time::Instant::now());
                    if send && !put(&mut stream, &sse(&e), limit).await { return; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    let lagged = Event::Lagged { skipped: n };
                    let _ = put(&mut stream, &sse_plain(lagged.name(), &json!({"skipped": n})), limit).await;
                    return;
                }
                Err(_) => return,
            },
        }
    }
}
