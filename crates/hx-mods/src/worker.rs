//! The worker: one mod's [`Engine`] driven over a byte channel by a parent that holds the plugin's
//! files, runs the event chain across mods and decides every `$` call. In production it is the
//! `hx mods-worker` subcommand, one process per mod, started by `hx` inside `hx-sandbox` with no
//! files, network or processes of its own; the channel is the one descriptor the parent passed it.
//! Tests drive it over a socket pair in-process.
//!
//! Protocol `hx-mods-v2`, one JSON object per line, both ways:
//!
//! | Direction | Frame |
//! |---|---|
//! | parent to worker | `{"id": n, "op": "load", "bundle", "tier", "idx", "gen"}`, `{"id": n, "op": "memory" \| "plugins" \| "reach"}` |
//! | parent to worker | `{"op": "invoke", "m": {frame, hook, kind, e, budget, event, tier, site, run, failure}}` (no reply: the hook's outcome comes as `ev` frames) |
//! | parent to worker | `{"op": "next_done", "frame", "call", "value"}`, `{"op": "abort", "frame", "message"}`, `{"op": "commit", "site", "ok", "tokens"}` |
//! | worker to parent | `{"re": n, "ok": value}` or `{"re": n, "err": {"code", "message"}}` |
//! | worker to parent | `{"ev": "reg", "event", "hook"}`, `{"ev": "catch", "hook"}`: a hook was registered |
//! | worker to parent | `{"ev": "settled", "frame", "status": "ok" \| "nomatch" \| "threw" \| "timeout", "value", "tok", "error"}` |
//! | worker to parent | `{"ev": "next", "frame", "call", "e", "tier"}`: the hook called `next`; `next_done` answers |
//! | worker to parent | `{"ev": "tick", "id"}`: a `clock.every` timer fired |
//! | worker to parent | `{"call": cid, "name", "args"}`: a `$` call to decide; the parent stamps the mod's name itself |
//! | parent to worker | `{"ret": cid, "ok": value}` or `{"ret": cid, "err": {"code", "message"}}` |
//! | worker to parent | `{"diag": {"level", "plugin", "message"}}` |
//!
//! The worker is single-threaded for the mod. Frames run concurrently inside it: while a hook waits
//! for the host's answer to a `$` call, the next request from the parent runs. A reader thread only
//! moves frames off the channel, so a frame is never half-read.

use std::cell::RefCell;
use std::io::{BufRead, BufReader, Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use serde_json::{Value, json};

use crate::engine::Engine;
use crate::{Error, RuntimeConfig};

/// The longest frame the worker accepts from the parent.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

type Out = Rc<RefCell<Box<dyn Write>>>;

fn send(out: &Out, frame: &Value) -> bool {
    let mut w = out.borrow_mut();
    let mut line = frame.to_string();
    line.push('\n');
    w.write_all(line.as_bytes())
        .and_then(|()| w.flush())
        .is_ok()
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
/// The runtime could not start, or the engine cannot go on (the reason is the error).
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
    let sender = out.clone();
    let mut engine = Engine::new(Rc::new(move |f: &Value| send(&sender, f)), config)?;
    loop {
        match rx.recv_timeout(engine.next_wakeup()) {
            Ok(frame) => {
                if frame.get("op").and_then(Value::as_str) == Some("reach") {
                    if let Some(id) = frame.get("id").and_then(Value::as_u64) {
                        send(&out, &json!({ "re": id, "ok": reach() }));
                    }
                } else {
                    engine.handle(&frame);
                }
            }
            Err(RecvTimeoutError::Timeout) => engine.on_wakeup(),
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
        if let Some(why) = engine.stopped() {
            let _ = out.borrow_mut().flush();
            return Err(Error::Crashed(why.to_owned()));
        }
    }
}
