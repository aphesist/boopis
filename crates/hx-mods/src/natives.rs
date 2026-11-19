//! The few Rust functions the isolate may call. They are handed to the bootstrap scripts as an
//! argument and never stored in a global, so a mod cannot reach them.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::function::Opt;
use rquickjs::{Ctx, Function, Object};
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha384, Sha512};

use crate::host::{HostCalls, HostRequest};
use crate::runtime::Diagnostic;

/// State the natives share with the runtime.
#[derive(Clone)]
pub struct NativeState {
    pub host: Rc<RefCell<Box<dyn HostCalls>>>,
    pub deadline: Rc<Cell<Option<Instant>>>,
    pub diagnostics: Rc<RefCell<Vec<Diagnostic>>>,
    pub started: Instant,
}

/// What the web API polyfills need: URL parsing, digests, randomness.
pub fn web_natives<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    o.set("urlParse", Function::new(ctx.clone(), |href: String, base: Opt<String>| url_parse(&href, base.0.as_deref().unwrap_or("")))?)?;
    o.set("digest", Function::new(ctx.clone(), |alg: String, hex_in: String| digest(&alg, &hex_in))?)?;
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

/// What the kernel needs: `$` calls out, the clock, the deadline, diagnostics.
pub fn kernel_natives<'js>(ctx: &Ctx<'js>, state: &NativeState) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    let host = state.host.clone();
    o.set(
        "host",
        Function::new(ctx.clone(), move |plugin: String, call: String, args: String| -> String {
            let reply = match serde_json::from_str::<Value>(&args) {
                Ok(args) => match host.borrow_mut().call(&HostRequest { plugin, call, args }) {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "err": { "code": e.code, "message": e.message } }),
                },
                Err(e) => json!({ "err": { "code": "hx.invalid_params", "message": e.to_string() } }),
            };
            reply.to_string()
        })?,
    )?;
    let started = state.started;
    o.set("now", Function::new(ctx.clone(), move || started.elapsed().as_secs_f64() * 1000.0)?)?;
    let deadline = state.deadline.clone();
    o.set(
        "setDeadline",
        Function::new(ctx.clone(), move |ms: f64| {
            deadline.set(if ms.is_finite() { Some(Instant::now() + Duration::from_secs_f64(ms.max(0.0) / 1000.0)) } else { None });
        })?,
    )?;
    let sink = state.diagnostics.clone();
    o.set(
        "diag",
        Function::new(ctx.clone(), move |level: String, plugin: String, message: String| {
            sink.borrow_mut().push(Diagnostic { level, plugin, message });
        })?,
    )?;
    Ok(o)
}

fn url_parse(href: &str, base: &str) -> String {
    let parsed = if base.is_empty() { url::Url::parse(href) } else { url::Url::parse(base).and_then(|b| b.join(href)) };
    let Ok(u) = parsed else { return String::new() };
    let port = u.port().map(|p| p.to_string()).unwrap_or_default();
    let hostname = u.host_str().unwrap_or("").to_owned();
    let host = if port.is_empty() { hostname.clone() } else { format!("{hostname}:{port}") };
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
    let Ok(bytes) = hex::decode(hex_in) else { return String::new() };
    match algorithm {
        "SHA-256" => hex::encode(Sha256::digest(&bytes)),
        "SHA-384" => hex::encode(Sha384::digest(&bytes)),
        "SHA-512" => hex::encode(Sha512::digest(&bytes)),
        _ => String::new(),
    }
}
