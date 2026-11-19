//! The few Rust functions the isolate may call. They are handed to the bootstrap scripts as an
//! argument and never stored in a global, so a mod cannot reach them.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::panic::AssertUnwindSafe;
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::function::Opt;
use rquickjs::{Ctx, Function, Object};
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha384, Sha512};

use crate::host::{CallId, HostCalls, HostReply, HostRequest};
use crate::runtime::Diagnostic;

/// A message between contexts. Rust routes them; no object ever crosses.
#[derive(Debug)]
pub enum Msg {
    /// From a mod's context (the index) to the chain.
    ToChain(usize, String),
    /// From the chain to a mod's context.
    ToMod(usize, String),
}

/// A `$` call the host has not answered yet.
pub struct Pending {
    /// The mod that made it.
    pub idx: usize,
    /// When the driver gives up on the host.
    pub deadline: Instant,
    /// The request, kept so a `clock.every` can be registered when it succeeds.
    pub request: HostRequest,
}

/// A `clock.every` the runtime keeps time for.
pub struct Timer {
    /// The mod that set it.
    pub idx: usize,
    /// Its id (`<mod>.t<n>`), what `tick` takes.
    pub id: String,
    /// The interval.
    pub every: Duration,
    /// When it fires next.
    pub due: Instant,
}

/// State the natives of every context share with the runtime.
#[derive(Clone)]
pub struct NativeState {
    pub host: Rc<RefCell<Box<dyn HostCalls>>>,
    pub deadline: Rc<Cell<Option<Instant>>>,
    pub diagnostics: Rc<RefCell<Vec<Diagnostic>>>,
    pub started: Instant,
    pub queue: Rc<RefCell<VecDeque<Msg>>>,
    pub pending: Rc<RefCell<HashMap<CallId, Pending>>>,
    pub timers: Rc<RefCell<Vec<Timer>>>,
    pub next_call: Rc<Cell<CallId>>,
    pub host_timeout: Duration,
    pub min_timer: Duration,
}

/// What the web API polyfills need: URL parsing, digests, randomness.
pub fn web_natives<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    o.set(
        "urlParse",
        Function::new(ctx.clone(), |href: String, base: Opt<String>| {
            url_parse(&href, base.0.as_deref().unwrap_or(""))
        })?,
    )?;
    o.set(
        "digest",
        Function::new(ctx.clone(), |alg: String, hex_in: String| {
            digest(&alg, &hex_in)
        })?,
    )?;
    o.set(
        "randomHex",
        Function::new(ctx.clone(), |n: usize| -> rquickjs::Result<String> {
            let mut buf = vec![0u8; n.min(65_536)];
            getrandom::fill(&mut buf).map_err(|_| rquickjs::Error::Unknown)?;
            Ok(hex::encode(buf))
        })?,
    )?;
    Ok(o)
}

/// Registers or cancels a timer when the call that asked for it succeeded.
pub fn after_reply(state: &NativeState, idx: usize, request: &HostRequest, ok: bool) {
    if !ok {
        return;
    }
    match request.call.as_str() {
        "clock.every" => {
            let (Some(id), Some(ms)) = (
                request.args.get("id").and_then(Value::as_str),
                request.args.get("ms").and_then(Value::as_f64),
            ) else {
                return;
            };
            let every = Duration::from_secs_f64(ms.max(0.0) / 1000.0).max(state.min_timer);
            state.timers.borrow_mut().push(Timer {
                idx,
                id: id.to_owned(),
                every,
                due: Instant::now() + every,
            });
        }
        "clock.cancel" => {
            if let Some(id) = request.args.get("id").and_then(Value::as_str) {
                state.timers.borrow_mut().retain(|t| t.id != id);
            }
        }
        _ => {}
    }
}

/// Starts one call and shapes what the mod's agent reads back. A panic in the host must not
/// unwind through the engine's C frames, which aborts the process: it becomes an error the
/// calling hook sees.
fn host_start(state: &NativeState, idx: usize, request: &HostRequest) -> Value {
    let id = state.next_call.get() + 1;
    state.next_call.set(id);
    let reply = std::panic::catch_unwind(AssertUnwindSafe(|| {
        state.host.borrow_mut().call(id, request)
    }));
    match reply {
        Ok(HostReply::Ready(Ok(v))) => {
            after_reply(state, idx, request, true);
            json!({ "ok": v })
        }
        Ok(HostReply::Ready(Err(e))) => {
            json!({ "err": { "code": e.code, "message": e.message } })
        }
        Ok(HostReply::Pending) => {
            state.pending.borrow_mut().insert(
                id,
                Pending {
                    idx,
                    deadline: Instant::now() + state.host_timeout,
                    request: request.clone(),
                },
            );
            json!({ "pending": id })
        }
        Err(_) => {
            json!({ "err": { "code": "hx.internal", "message": "the host panicked while performing the call" } })
        }
    }
}

/// What the chain needs: the clock, the deadline, diagnostics, and a way to message a mod.
pub fn chain_natives<'js>(ctx: &Ctx<'js>, state: &NativeState) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    let started = state.started;
    o.set(
        "now",
        Function::new(ctx.clone(), move || {
            started.elapsed().as_secs_f64() * 1000.0
        })?,
    )?;
    let deadline = state.deadline.clone();
    o.set(
        "setDeadline",
        Function::new(ctx.clone(), move |ms: f64| {
            deadline.set(if ms.is_finite() {
                Some(Instant::now() + Duration::from_secs_f64(ms.max(0.0) / 1000.0))
            } else {
                None
            });
        })?,
    )?;
    let sink = state.diagnostics.clone();
    o.set(
        "diag",
        Function::new(
            ctx.clone(),
            move |level: String, plugin: String, message: String| {
                sink.borrow_mut().push(Diagnostic {
                    level,
                    plugin,
                    message,
                });
            },
        )?,
    )?;
    let queue = state.queue.clone();
    o.set(
        "send",
        Function::new(ctx.clone(), move |idx: usize, json: String| {
            queue.borrow_mut().push_back(Msg::ToMod(idx, json));
        })?,
    )?;
    Ok(o)
}

/// What a mod's agent needs. The plugin name and index are fixed here, in Rust, so no mod can
/// speak for another.
pub fn agent_natives<'js>(
    ctx: &Ctx<'js>,
    state: &NativeState,
    idx: usize,
    plugin: &str,
) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    let st = state.clone();
    let name = plugin.to_owned();
    o.set(
        "host",
        Function::new(ctx.clone(), move |call: String, args: String| -> String {
            let reply = match serde_json::from_str::<Value>(&args) {
                Ok(args) => host_start(
                    &st,
                    idx,
                    &HostRequest {
                        plugin: name.clone(),
                        call,
                        args,
                    },
                ),
                Err(e) => {
                    json!({ "err": { "code": "hx.invalid_params", "message": e.to_string() } })
                }
            };
            reply.to_string()
        })?,
    )?;
    let queue = state.queue.clone();
    o.set(
        "send",
        Function::new(ctx.clone(), move |json: String| {
            queue.borrow_mut().push_back(Msg::ToChain(idx, json));
        })?,
    )?;
    let sink = state.diagnostics.clone();
    let name = plugin.to_owned();
    o.set(
        "diag",
        Function::new(ctx.clone(), move |level: String, message: String| {
            sink.borrow_mut().push(Diagnostic {
                level,
                plugin: name.clone(),
                message,
            });
        })?,
    )?;
    Ok(o)
}

fn url_parse(href: &str, base: &str) -> String {
    let parsed = if base.is_empty() {
        url::Url::parse(href)
    } else {
        url::Url::parse(base).and_then(|b| b.join(href))
    };
    let Ok(u) = parsed else { return String::new() };
    let port = u.port().map(|p| p.to_string()).unwrap_or_default();
    let hostname = u.host_str().unwrap_or("").to_owned();
    let host = if port.is_empty() {
        hostname.clone()
    } else {
        format!("{hostname}:{port}")
    };
    json!({
        "href": u.as_str(),
        "origin": u.origin().ascii_serialization(),
        "protocol": format!("{}:", u.scheme()),
        "username": u.username(),
        "password": u.password().unwrap_or(""),
        "host": host,
        "hostname": hostname,
        "port": port,
        "pathname": u.path(),
        "search": u.query().filter(|q| !q.is_empty()).map(|q| format!("?{q}")).unwrap_or_default(),
        "hash": u.fragment().filter(|f| !f.is_empty()).map(|f| format!("#{f}")).unwrap_or_default(),
    })
    .to_string()
}

/// Hex in, hex out. Empty for an algorithm this isolate does not have.
fn digest(algorithm: &str, hex_in: &str) -> String {
    let Ok(bytes) = hex::decode(hex_in) else {
        return String::new();
    };
    match algorithm {
        "SHA-256" => hex::encode(Sha256::digest(&bytes)),
        "SHA-384" => hex::encode(Sha384::digest(&bytes)),
        "SHA-512" => hex::encode(Sha512::digest(&bytes)),
        _ => String::new(),
    }
}
