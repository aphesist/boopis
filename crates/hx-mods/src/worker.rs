//! The worker: a [`ModRuntime`] driven over a byte channel by a parent that holds the plugin's
//! files and the authority to decide a `$` call. In production it is the `hx mods-worker`
//! subcommand, started by `hx` inside `hx-sandbox` with no files, network or processes of its own;
//! the channel is the one descriptor the parent passed it. Tests drive it over a socket pair
//! in-process.
//!
//! Protocol `hx-mods-v1`, one JSON object per line, both ways:
//!
//! | Direction | Frame |
//! |---|---|
//! | parent to worker | `{"id": n, "op": "load" \| "unload" \| "dispatch" \| "render" \| "press" \| "input" \| "select" \| "plugins" \| "reach" \| "memory", ...}` |
//! | worker to parent | `{"re": n, "ok": value}` or `{"re": n, "err": {"code", "message"}}` |
//! | worker to parent | `{"call": cid, "plugin", "name", "args"}`: a `$` call to decide |
//! | parent to worker | `{"ret": cid, "ok": value}` or `{"ret": cid, "err": {"code", "message"}}` |
//! | worker to parent | `{"diag": {"level", "plugin", "message"}}` |
//!
//! The worker is single-threaded for the mods: it runs one operation at a time, and while one
//! waits for the host's answer to a `$` call, a new request from the parent queues behind it.
//! A reader thread only moves frames off the channel, so a frame is never half-read.

use std::cell::RefCell;
use std::collections::{HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::files::Bundle;
use crate::host::{CallId, Completion, HostCalls, HostError, HostReply, HostRequest};
use crate::runtime::{LoadedPlugin, Render, Tier};
use crate::{Error, ModRuntime, RuntimeConfig};

/// The longest frame the worker accepts from the parent.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

type Out = Rc<RefCell<Box<dyn Write>>>;

struct Inbox {
    rx: mpsc::Receiver<Value>,
    backlog: VecDeque<Value>,
    closed: bool,
}

type SharedInbox = Rc<RefCell<Inbox>>;

fn send(out: &Out, frame: &Value) -> bool {
    let mut w = out.borrow_mut();
    let mut line = frame.to_string();
    line.push('\n');
    w.write_all(line.as_bytes())
        .and_then(|()| w.flush())
        .is_ok()
}

/// The host the runtime owns, shared with the main loop, which needs its bookkeeping.
struct SharedHost(Rc<RefCell<ChannelHost>>);

impl HostCalls for SharedHost {
    fn call(&mut self, id: CallId, request: &HostRequest) -> HostReply {
        self.0.borrow_mut().call(id, request)
    }
    fn wait(&mut self, timeout: Duration) -> Option<Completion> {
        self.0.borrow_mut().wait(timeout)
    }
}

fn ret_result(frame: &Value) -> Result<Value, HostError> {
    match frame.get("err") {
        Some(e) => Err(HostError {
            code: e["code"]
                .as_str()
                .unwrap_or("hx.mods.host_failed")
                .to_owned(),
            message: e["message"].as_str().unwrap_or_default().to_owned(),
        }),
        None => Ok(frame.get("ok").cloned().unwrap_or(Value::Null)),
    }
}

/// The runtime's host: every `$` call becomes a frame to the parent, and its answer arrives in
/// [`HostCalls::wait`].
struct ChannelHost {
    out: Out,
    inbox: SharedInbox,
    outstanding: HashSet<CallId>,
}

impl HostCalls for ChannelHost {
    fn call(&mut self, id: CallId, request: &HostRequest) -> HostReply {
        let frame = json!({ "call": id, "plugin": request.plugin, "name": request.call, "args": request.args });
        if !send(&self.out, &frame) {
            return HostReply::Ready(Err(HostError {
                code: "hx.mods.host_failed".into(),
                message: "the channel to the host is closed".into(),
            }));
        }
        self.outstanding.insert(id);
        HostReply::Pending
    }

    fn wait(&mut self, timeout: Duration) -> Option<Completion> {
        let deadline = Instant::now() + timeout;
        loop {
            let mut inbox = self.inbox.borrow_mut();
            if inbox.closed {
                // The parent is gone: nothing will answer, so fail what is outstanding.
                let id = *self.outstanding.iter().next()?;
                self.outstanding.remove(&id);
                return Some((
                    id,
                    Err(HostError {
                        code: "hx.mods.host_failed".into(),
                        message: "the channel to the host closed".into(),
                    }),
                ));
            }
            let left = deadline.saturating_duration_since(Instant::now());
            match inbox.rx.recv_timeout(left) {
                Ok(frame) => {
                    if let Some(id) = frame.get("ret").and_then(Value::as_u64) {
                        self.outstanding.remove(&id);
                        return Some((id, ret_result(&frame)));
                    }
                    inbox.backlog.push_back(frame);
                }
                Err(RecvTimeoutError::Timeout) => return None,
                Err(RecvTimeoutError::Disconnected) => inbox.closed = true,
            }
        }
    }
}

fn err(code: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into() })
}

fn runtime_error(e: &Error) -> Value {
    let code = match e {
        Error::Crashed(_) => "hx.mods.crashed",
        Error::AlreadyLoaded(_) => "hx.mods.already_loaded",
        Error::NotAMod(_) => "hx.mods.not_a_mod",
        _ => "hx.mods.load_failed",
    };
    err(code, e.to_string())
}

fn loaded_json(l: &LoadedPlugin) -> Value {
    json!({ "name": l.name, "tier": l.tier.name(), "modules": l.modules, "hooks": l.hooks })
}

fn str_of<'a>(v: &'a Value, key: &str) -> Result<&'a str, Value> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| err("hx.invalid_params", format!("`{key}` must be a string")))
}

fn render_json(r: Render) -> Value {
    match r {
        Render::Tree { tree, stats } => json!({
            "kind": "tree", "tree": tree,
            "stats": { "elements": stats.elements, "chars": stats.chars, "depth": stats.depth },
        }),
        Render::Default { props } => json!({ "kind": "default", "props": props }),
        Render::Skipped { reason } => json!({ "kind": "skipped", "reason": reason }),
    }
}

fn op(rt: &mut ModRuntime, frame: &Value) -> Result<Value, Value> {
    let name = str_of(frame, "op")?;
    let rt_err = |e: Error| runtime_error(&e);
    match name {
        "load" => {
            let mut set = Vec::new();
            for p in frame["plugins"].as_array().into_iter().flatten() {
                let bundle: Bundle = serde_json::from_value(p["bundle"].clone())
                    .map_err(|e| err("hx.invalid_params", e.to_string()))?;
                let tier = Tier::parse(p["tier"].as_str().unwrap_or("user")).ok_or_else(|| {
                    err("hx.invalid_params", "tier must be prepend, user or append")
                })?;
                set.push((bundle, tier));
            }
            let loaded = rt.load_bundles(set).map_err(rt_err)?;
            Ok(json!({ "loaded": loaded.iter().map(loaded_json).collect::<Vec<_>>() }))
        }
        "unload" => {
            Ok(json!({ "unloaded": rt.unload_plugin(str_of(frame, "name")?).map_err(rt_err)? }))
        }
        "dispatch" => {
            let a = rt
                .dispatch(str_of(frame, "event")?, &frame["payload"])
                .map_err(rt_err)?;
            Ok(json!({ "answered": a.answered, "value": a.value, "answered_by": a.answered_by }))
        }
        "render" => {
            let r = rt
                .render(
                    str_of(frame, "component")?,
                    frame.get("pane").and_then(Value::as_str),
                    &frame["props"],
                )
                .map_err(rt_err)?;
            Ok(render_json(r))
        }
        "press" => Ok(json!({ "handled": rt.press(str_of(frame, "handler")?).map_err(rt_err)? })),
        "input" => Ok(
            json!({ "handled": rt.input(str_of(frame, "handler")?, str_of(frame, "value")?).map_err(rt_err)? }),
        ),
        "select" => Ok(
            json!({ "handled": rt.select(str_of(frame, "handler")?, str_of(frame, "value")?).map_err(rt_err)? }),
        ),
        "plugins" => {
            Ok(json!({ "plugins": rt.plugins().iter().map(loaded_json).collect::<Vec<_>>() }))
        }
        "memory" => {
            rt.collect_garbage();
            let m = rt.memory();
            Ok(json!({ "used": m.used, "allocated": m.allocated }))
        }
        "reach" => Ok(reach()),
        other => Err(err("hx.invalid_params", format!("unknown op `{other}`"))),
    }
}

#[cfg(unix)]
fn unix_connect() -> String {
    match std::os::unix::net::UnixStream::connect("/run/user/0/bus") {
        Ok(_) => "allowed".to_owned(),
        Err(e) => format!("denied: {e}"),
    }
}

#[cfg(not(unix))]
fn unix_connect() -> String {
    "not applicable".to_owned()
}

/// What this process can reach, tried for real. The sandbox is what makes every line `denied`;
/// a line that is `allowed` is a finding, reported as it is.
#[must_use]
pub fn reach() -> Value {
    fn outcome<T, E: std::fmt::Display>(r: Result<T, E>) -> String {
        match r {
            Ok(_) => "allowed".to_owned(),
            Err(e) => format!("denied: {e}"),
        }
    }
    let exe = std::env::current_exe().ok();
    json!({
        "pid": std::process::id(),
        "files": {
            "read_etc_passwd": outcome(std::fs::read_to_string("/etc/passwd")),
            "list_root": outcome(std::fs::read_dir("/").map(Iterator::count)),
            "list_home": outcome(std::fs::read_dir(std::env::var("HOME").unwrap_or_else(|_| "/root".into())).map(Iterator::count)),
            "create_in_tmp": outcome(std::fs::File::create("/tmp/hx-mods-reach-probe")),
            "create_in_cwd": outcome(std::fs::File::create("hx-mods-reach-probe")),
        },
        "network": {
            "tcp_connect_loopback": outcome(std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], 9)), Duration::from_millis(500))),
            "tcp_connect_external": outcome(std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([203, 0, 113, 1], 80)), Duration::from_millis(500))),
            "udp_bind": outcome(std::net::UdpSocket::bind("127.0.0.1:0")),
            "unix_connect": unix_connect(),
        },
        "processes": {
            "spawn_true": outcome(std::process::Command::new("/bin/true").spawn().map(|mut c| { let _ = c.wait(); })),
            "spawn_self": outcome(exe.as_ref().map(|e| std::process::Command::new(e).arg("--version").output()).transpose()),
        },
    })
}

fn flush_diagnostics(rt: &mut ModRuntime, out: &Out) {
    for d in rt.take_diagnostics() {
        send(
            out,
            &json!({ "diag": { "level": d.level, "plugin": d.plugin, "message": d.message } }),
        );
    }
}

/// Reads frames until the end of input, forwarding them to `tx`.
fn read_frames<R: Read>(reader: R, tx: &mpsc::Sender<Value>) {
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        let mut limited = (&mut reader).take(MAX_FRAME_BYTES as u64 + 1);
        match limited.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line.len() > MAX_FRAME_BYTES {
            return;
        }
        if let Ok(v) = serde_json::from_str::<Value>(line.trim_end())
            && tx.send(v).is_err()
        {
            return;
        }
    }
}

/// Serves the protocol until the parent closes the channel.
///
/// # Errors
/// The runtime could not start.
pub fn serve<R, W>(reader: R, writer: W, config: RuntimeConfig) -> Result<(), Error>
where
    R: Read + Send + 'static,
    W: Write + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("hx-mods-reader".into())
        .spawn(move || read_frames(reader, &tx))
        .map_err(|e| Error::Script(format!("cannot start the reader thread: {e}")))?;
    let out: Out = Rc::new(RefCell::new(Box::new(writer)));
    let inbox: SharedInbox = Rc::new(RefCell::new(Inbox {
        rx,
        backlog: VecDeque::new(),
        closed: false,
    }));
    let host = Rc::new(RefCell::new(ChannelHost {
        out: out.clone(),
        inbox: inbox.clone(),
        outstanding: HashSet::new(),
    }));
    let mut rt = ModRuntime::new(Box::new(SharedHost(host.clone())), config)?;
    loop {
        let next = inbox.borrow_mut().backlog.pop_front();
        let frame = if let Some(f) = next {
            f
        } else {
            let wait = rt.next_timer_due().map_or(Duration::from_hours(1), |d| {
                d.saturating_duration_since(Instant::now())
            });
            let got = inbox.borrow().rx.recv_timeout(wait);
            match got {
                Ok(f) => f,
                Err(RecvTimeoutError::Timeout) => {
                    if let Err(e) = rt.fire_due_timers(Instant::now()) {
                        tracing::error!(error = %e, "a timer could not fire");
                    }
                    flush_diagnostics(&mut rt, &out);
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
            }
        };
        if let Some(cid) = frame.get("ret").and_then(Value::as_u64) {
            // The answer to a call no event was waiting on: deliver it, so the promise settles.
            host.borrow_mut().outstanding.remove(&cid);
            if let Err(e) = rt.host_completed(cid, ret_result(&frame)) {
                tracing::error!(error = %e, "a late host answer could not be delivered");
            }
            flush_diagnostics(&mut rt, &out);
            continue;
        }
        let Some(id) = frame.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let reply = match op(&mut rt, &frame) {
            Ok(v) => json!({ "re": id, "ok": v }),
            Err(e) => json!({ "re": id, "err": e }),
        };
        flush_diagnostics(&mut rt, &out);
        if !send(&out, &reply) {
            return Ok(());
        }
        if inbox.borrow().closed {
            return Ok(());
        }
    }
}
