//! The few Rust functions the isolate may call. They are handed to the bootstrap scripts as an
//! argument and never stored in a global, so a mod cannot reach them.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::function::Opt;
use rquickjs::{Ctx, Function, Object};
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha384, Sha512};

use crate::host::{CallId, HostRequest};
use crate::types::Diagnostic;

/// A `$` call the parent has not answered yet.
pub struct Pending {
    /// When the worker gives up on the parent.
    pub deadline: Instant,
    /// The request, kept so a `clock.every` can be registered when it succeeds.
    pub request: HostRequest,
}

/// A `clock.every` the worker keeps time for.
pub struct Timer {
    /// Its id (`<mod>.t<n>`), what a tick names.
    pub id: String,
    /// The interval.
    pub every: Duration,
    /// When it fires next.
    pub due: Instant,
}

/// Sends one `$` call to the parent. False when the channel is closed.
pub type SendCall = Rc<dyn Fn(CallId, &HostRequest) -> bool>;

/// State the natives of the mod's context share with the engine.
#[derive(Clone)]
pub struct NativeState {
    pub send_call: SendCall,
    pub deadline: Rc<Cell<Option<Instant>>>,
    pub diagnostics: Rc<RefCell<Vec<Diagnostic>>>,
    /// Messages the mod's agent sent up, as JSON text, oldest first.
    pub queue: Rc<RefCell<VecDeque<String>>>,
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
pub fn after_reply(state: &NativeState, request: &HostRequest, ok: bool) {
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

/// Starts one call: it goes to the parent as a frame, and the mod's promise stays pending until the
/// answer arrives. Every call is asynchronous, so the mod's agent only ever sees a pending id or an
/// error.
fn host_start(state: &NativeState, request: &HostRequest) -> Value {
    let id = state.next_call.get() + 1;
    state.next_call.set(id);
    if !(state.send_call)(id, request) {
        return json!({ "err": { "code": "hx.mods.host_failed", "message": "the channel to the host is closed" } });
    }
    state.pending.borrow_mut().insert(
        id,
        Pending {
            deadline: Instant::now() + state.host_timeout,
            request: request.clone(),
        },
    );
    json!({ "pending": id })
}

/// What a mod's agent needs. The plugin name is fixed here, in Rust, and the parent does not trust
/// it either: the worker is bound to one mod, and the parent stamps that name itself.
pub fn agent_natives<'js>(
    ctx: &Ctx<'js>,
    state: &NativeState,
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
            queue.borrow_mut().push_back(json);
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
