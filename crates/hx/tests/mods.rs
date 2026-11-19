//! `mods.*` through the real `hx serve` binary and a fake plugin: the runtime runs in a sandboxed
//! worker, its `$` calls arrive as `mods.call` requests, and a test answers them.
//!
//! Tests that need the sandbox skip, saying why, on a machine that cannot enforce it: mods never
//! run unsandboxed, so there is nothing to test there but the refusal.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{Value, json};

type Answer = Box<dyn FnMut(&Value) -> Result<Value, (String, String)>>;

/// The plugin's side: starts `hx serve`, sends requests, and answers what `hx` asks.
struct Fake {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Value>,
    next: u64,
    /// Every `mods.call` seen, in order: `{plugin, call, args}`.
    calls: Vec<Value>,
    notes: Vec<Value>,
    /// What to answer a call with; default `null`.
    answer: Answer,
}

impl Fake {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_hx"))
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<Value>(&line)
                    && tx.send(v).is_err()
                {
                    return;
                }
            }
        });
        Self {
            child,
            stdin,
            rx,
            next: 0,
            calls: Vec::new(),
            notes: Vec::new(),
            answer: Box::new(|call| {
                Ok(match call["call"].as_str().unwrap() {
                    "ui.open" => json!({ "isPlaced": true }),
                    _ => Value::Null,
                })
            }),
        }
    }

    fn send(&mut self, frame: &Value) {
        writeln!(self.stdin, "{frame}").unwrap();
        self.stdin.flush().unwrap();
    }

    /// One request; answers `mods.call`s while waiting.
    #[allow(clippy::needless_pass_by_value)] // the tests build each params inline
    fn request(&mut self, method: &str, params: Value) -> Result<Value, Value> {
        self.next += 1;
        let id = self.next;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        loop {
            let frame = self
                .rx
                .recv_timeout(Duration::from_mins(1))
                .expect("hx stopped answering");
            if frame["method"] == "mods.call" {
                let params = frame["params"].clone();
                let verdict = (self.answer)(&params);
                self.calls.push(params);
                let reply = match verdict {
                    Ok(v) => json!({ "jsonrpc": "2.0", "id": frame["id"], "result": v }),
                    Err((code, message)) => json!({ "jsonrpc": "2.0", "id": frame["id"],
                        "error": { "code": -32000, "message": message, "data": { "code": code } } }),
                };
                self.send(&reply);
            } else if frame["method"].is_string() {
                self.notes.push(frame);
            } else if frame["id"] == json!(id) {
                return match frame.get("error") {
                    Some(e) => Err(e.clone()),
                    None => Ok(frame["result"].clone()),
                };
            }
        }
    }

    fn ok(&mut self, method: &str, params: Value) -> Value {
        self.request(method, params)
            .unwrap_or_else(|e| panic!("{method} failed: {e}"))
    }

    fn calls_to(&self, call: &str) -> Vec<Value> {
        self.calls
            .iter()
            .filter(|c| c["call"] == call)
            .cloned()
            .collect()
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn example(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../hx-mods/tests/mods")
        .join(name)
        .canonicalize()
        .unwrap()
}

/// A started server, or None (with the reason printed) when mods cannot run here.
fn available() -> Option<Fake> {
    let mut hx = Fake::start();
    let caps = hx.ok("mods.capabilities", Value::Null);
    if caps["available"] == true {
        Some(hx)
    } else {
        eprintln!("skipped: mods are unavailable here: {}", caps["reason"]);
        None
    }
}

fn texts(tree: &Value) -> String {
    let mut out = Vec::new();
    let mut stack = vec![tree];
    while let Some(n) = stack.pop() {
        for c in n["children"].as_array().into_iter().flatten().rev() {
            match c {
                Value::String(s) => out.push(s.clone()),
                other => stack.push(other),
            }
        }
    }
    out.join("|")
}

fn handler(tree: &Value, kind: &str, prop: &str) -> String {
    let mut stack = vec![tree];
    while let Some(n) = stack.pop() {
        if n["type"] == kind
            && let Some(id) = n["props"][prop]["$handler"].as_str()
        {
            return id.to_owned();
        }
        stack.extend(
            n["children"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|c| c.is_object()),
        );
    }
    panic!("no {kind}.{prop}");
}

fn load_all(hx: &mut Fake, session: &str) -> Value {
    let plugins: Vec<Value> = ["counter-pane", "hello-command", "prompt-band"]
        .iter()
        .map(|n| json!({ "dir": example(n) }))
        .collect();
    hx.ok(
        "mods.load",
        json!({ "session_id": session, "plugins": plugins }),
    )
}

#[test]
fn the_three_example_mods_run_in_a_sandboxed_worker_and_every_effect_is_a_mods_call() {
    let Some(mut hx) = available() else { return };
    let loaded = load_all(&mut hx, "s1");
    let names: Vec<_> = loaded["loaded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["counter-pane", "hello-command", "prompt-band"]);

    hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "session.start", "payload": {} }),
    );
    assert_eq!(hx.calls_to("ui.open").len(), 1);
    assert_eq!(hx.calls_to("ui.open")[0]["plugin"], "counter-pane");
    assert_eq!(hx.calls_to("ui.open")[0]["session_id"], "s1");
    assert_eq!(hx.calls_to("command.register").len(), 2);
    assert_eq!(hx.calls_to("clock.every").len(), 1);

    // A pane with state, a press, and the redraw it asks for.
    let r = hx.ok(
        "mods.render",
        json!({ "session_id": "s1", "component": "Pane", "id": "counter", "props": {} }),
    );
    assert_eq!(r["kind"], "tree");
    assert_eq!(texts(&r["tree"]), "Count: 0|Ticks: 0|Increment");
    let button = handler(&r["tree"], "Button", "onPress");
    let before = hx.calls_to("ui.invalidate").len();
    assert_eq!(
        hx.ok(
            "mods.press",
            json!({ "session_id": "s1", "handler": button })
        )["handled"],
        true
    );
    assert_eq!(hx.calls_to("ui.invalidate").len(), before + 1);
    let r = hx.ok(
        "mods.render",
        json!({ "session_id": "s1", "component": "Pane", "id": "counter", "props": {} }),
    );
    assert_eq!(texts(&r["tree"]), "Count: 1|Ticks: 0|Increment");

    // A command, and a band that is drawn from props.
    let a = hx.ok("mods.dispatch", json!({ "session_id": "s1", "event": "command.run", "payload": { "name": "hello", "args": " Ada " } }));
    assert_eq!(a["value"], json!({ "text": "Hello, Ada!" }));
    let band = hx.ok(
        "mods.render",
        json!({ "session_id": "s1", "component": "AbovePrompt", "props": { "isWorking": true } }),
    );
    assert_eq!(texts(&band["tree"]), "Working");

    // Nothing but `$` left the worker: every call this run produced is one of the documented ones.
    for c in &hx.calls {
        assert!(
            [
                "ui.open",
                "ui.invalidate",
                "command.register",
                "clock.every"
            ]
            .contains(&c["call"].as_str().unwrap()),
            "{c}"
        );
    }
    let listed = hx.ok("mods.list", json!({ "session_id": "s1" }));
    assert_eq!(
        listed["sessions"][0]["plugins"].as_array().unwrap().len(),
        3
    );
}

#[test]
fn the_workers_own_clock_ticks_without_the_plugin_asking() {
    let Some(mut hx) = available() else { return };
    load_all(&mut hx, "s1");
    hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "session.start", "payload": {} }),
    );
    // A pane that has been drawn reads its atoms, so a tick that changes one asks for a redraw.
    hx.ok(
        "mods.render",
        json!({ "session_id": "s1", "component": "Pane", "id": "counter", "props": {} }),
    );
    let before = hx.calls_to("ui.invalidate").len();
    // The pane's 1 s timer redraws it through `$.state`; the next frame from hx is that call.
    let frame = hx
        .rx
        .recv_timeout(Duration::from_secs(10))
        .expect("no tick");
    assert_eq!(frame["method"], "mods.call");
    assert_eq!(frame["params"]["call"], "ui.invalidate");
    assert_eq!(hx.calls_to("ui.invalidate").len(), before);
}

#[test]
fn the_worker_can_reach_no_file_network_or_process_of_its_own() {
    let Some(mut hx) = available() else { return };
    load_all(&mut hx, "s1");
    let reach = hx.ok("mods.reach", json!({ "session_id": "s1" }));
    eprintln!("{reach:#}");
    let denied = |section: &str, key: &str| {
        let v = reach[section][key].as_str().unwrap();
        assert!(v.starts_with("denied"), "{section}.{key}: {v}");
    };
    for key in [
        "read_etc_passwd",
        "list_root",
        "list_home",
        "create_in_tmp",
        "create_in_cwd",
    ] {
        denied("files", key);
    }
    for key in [
        "tcp_connect_loopback",
        "tcp_connect_external",
        "udp_bind",
        "unix_connect",
    ] {
        denied("network", key);
    }
    for key in ["spawn_true", "spawn_self"] {
        denied("processes", key);
    }
    // It is a different process from hx itself.
    assert_ne!(reach["pid"].as_u64().unwrap(), u64::from(hx.child.id()));
}

#[test]
fn a_denied_call_reaches_the_mod_as_an_error_with_the_plugins_code() {
    let Some(mut hx) = available() else { return };
    hx.answer = Box::new(|_| Err(("hx.policy.denied".into(), "no".into())));
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "asker",
        "export function register(on) { on('go', async ($) => { try { await $.fs.read('/x'); return 'read'; } catch (e) { return [e.code, e.message]; } }); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("asker") }] }),
    );
    let a = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "go", "payload": {} }),
    );
    assert_eq!(a["value"], json!(["hx.policy.denied", "no"]));
    assert_eq!(hx.calls_to("fs.read")[0]["args"], json!({ "path": "/x" }));
}

#[test]
fn errors_name_what_went_wrong() {
    let Some(mut hx) = available() else { return };
    let e = hx
        .request(
            "mods.dispatch",
            json!({ "session_id": "none", "event": "x", "payload": {} }),
        )
        .unwrap_err();
    assert_eq!(e["data"]["code"], "hx.mods.no_session");
    let dir = tempfile_dir();
    std::fs::create_dir_all(dir.join("plain/.claude-plugin")).unwrap();
    std::fs::write(
        dir.join("plain/.claude-plugin/plugin.json"),
        r#"{"name":"plain"}"#,
    )
    .unwrap();
    let e = hx
        .request(
            "mods.load",
            json!({ "session_id": "s", "plugins": [{ "dir": dir.join("plain") }] }),
        )
        .unwrap_err();
    assert_eq!(e["data"]["code"], "hx.mods.not_a_mod", "{e}");
    // The failed first load left no worker behind.
    assert_eq!(hx.ok("mods.list", json!({}))["sessions"], json!([]));
    write_mod(
        &dir,
        "bad",
        "export function register() { throw new Error('nope'); }",
    );
    let e = hx
        .request(
            "mods.load",
            json!({ "session_id": "s", "plugins": [{ "dir": dir.join("bad") }] }),
        )
        .unwrap_err();
    assert_eq!(e["data"]["code"], "hx.mods.load_failed");
    assert!(e["message"].as_str().unwrap().contains("nope"), "{e}");
}

#[test]
fn unloading_and_stopping_a_session() {
    let Some(mut hx) = available() else { return };
    load_all(&mut hx, "s1");
    assert_eq!(
        hx.ok(
            "mods.unload",
            json!({ "session_id": "s1", "plugin": "hello-command" })
        )["unloaded"],
        true
    );
    let a = hx.ok("mods.dispatch", json!({ "session_id": "s1", "event": "command.run", "payload": { "name": "hello", "args": "" } }));
    assert_eq!(a["answered"], false);
    assert_eq!(
        hx.ok("mods.unload", json!({ "session_id": "s1" }))["unloaded"],
        true
    );
    let e = hx
        .request(
            "mods.render",
            json!({ "session_id": "s1", "component": "Pane", "props": {} }),
        )
        .unwrap_err();
    assert_eq!(e["data"]["code"], "hx.mods.no_session");
}

#[test]
fn a_stopped_worker_is_reported_to_the_plugin() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "m",
        "export function register(on) { on('go', async () => 1); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("m") }] }),
    );
    assert_eq!(
        hx.ok("mods.unload", json!({ "session_id": "s1" }))["unloaded"],
        true
    );
    // The worker's exit is reported to the plugin as a notification, so it can mark the session's
    // mods gone.
    let note = loop {
        let f = hx
            .rx
            .recv_timeout(Duration::from_secs(20))
            .expect("no exit notification");
        if f["method"] == "mods.exited" {
            break f;
        }
    };
    assert_eq!(note["params"]["session_id"], "s1");
}

fn tempfile_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "hx-mods-test-{}-{}",
        std::process::id(),
        rand_suffix()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn rand_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn write_mod(root: &Path, name: &str, source: &str) {
    let dir = root.join(name);
    std::fs::create_dir_all(dir.join(".claude-plugin")).unwrap();
    std::fs::create_dir_all(dir.join("hooks")).unwrap();
    std::fs::write(
        dir.join(".claude-plugin/plugin.json"),
        format!("{{\"name\":\"{name}\"}}"),
    )
    .unwrap();
    std::fs::write(
        dir.join("hooks/hooks.json"),
        r#"{"modules":["./register.js"]}"#,
    )
    .unwrap();
    std::fs::write(dir.join("register.js"), source).unwrap();
}
