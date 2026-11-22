//! The loopback endpoint (`ADR-0045`, `docs/LOCAL-API.md`): a small HTTP/1.1 server on `127.0.0.1`, written by hand (no new
//! dependency; the ChatGPT callback is the precedent). One request per connection, except the event stream. Every rule of
//! `wire` is applied here in the order that model fixes; routing starts only after the token has passed.

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
    ) -> std::io::Result<Self> {
        let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, limits.preferred_port)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?,
        };
        Self::serve(listener, service, token, limits)
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
            serve_one(stream, &shared, &cancel).await;
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
    let caller = Caller::labelled(wire::client_label(&head), "endpoint");
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
                          "POST /v1/bots/<name>/say", "GET /v1/rooms", "POST /v1/rooms/<id>/say", "GET /v1/events"]
        })),
        (Method::Get, ["v1", "bots"]) => {
            Ok(json!({"bots": feed.bots(), "last_event_id": feed.last_id()}))
        }
        (Method::Get, ["v1", "presence"]) => {
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
        (Method::Get, ["v1", "rooms"]) => Ok(json!({"rooms": feed.rooms()})),
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
        (Method::Post, ["v1", "bots", name, "say"]) if segment_ok(name) => {
            let m = object(body)?;
            let text = m.get("text").and_then(Value::as_str).ok_or_else(bad_json)?;
            let pick = Pick::parse(m.get("session").and_then(Value::as_str))?;
            let said = shared.service.say(name, text, &pick, caller).await?;
            Ok(json!({"said": said}))
        }
        (Method::Post, ["v1", "rooms", id, "say"]) if segment_ok(id) => {
            let m = object(body)?;
            let text = m.get("text").and_then(Value::as_str).ok_or_else(bad_json)?;
            shared.service.say_room(id, text, caller).await?;
            Ok(json!({"ok": true}))
        }
        (Method::Get, ["v1", "approvals", _] | ["v1", "bots" | "rooms", _, "say"])
        | (
            Method::Post,
            ["v1"]
            | [
                "v1",
                "bots" | "presence" | "notifications" | "approvals" | "rooms" | "events",
            ],
        ) => Err(method_not_allowed()),
        _ => Err(not_found()),
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
    let since = head
        .header("last-event-id")
        .and_then(|v| v.trim().parse::<u64>().ok());
    let sub = shared.service.feed().subscribe(since);
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
    for e in &sub.backlog {
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
        tokio::select! {
            () = cancel.cancelled() => return,
            _ = epoch.changed() => return,
            _ = beat.tick() => {
                if !put(&mut stream, ": keepalive\n\n", limit).await { return; }
            }
            got = rx.recv() => match got {
                Ok(e) => {
                    if !put(&mut stream, &sse(&e), limit).await { return; }
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
