//! `mods.*` through the real `hx serve` binary and a fake plugin: the runtime runs in a sandboxed
//! worker, its `$` calls arrive as `mods.call` requests, and a test answers them.
//!
//! Tests that need the sandbox skip, saying why, on a machine that cannot enforce it: mods never
//! run unsandboxed, so there is nothing to test there but the refusal.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![cfg(unix)]

use std::collections::HashMap;
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
    /// Calls named here are held: the reply waits for `release`.
    hold: Vec<String>,
    /// The ids of the held `mods.call` requests, in order.
    held: Vec<Value>,
    /// Replies read while waiting for another request's.
    done: HashMap<u64, Result<Value, Value>>,
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
            hold: Vec::new(),
            held: Vec::new(),
            done: HashMap::new(),
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

    /// Sends a request and does not wait for it.
    #[allow(clippy::needless_pass_by_value)]
    fn begin(&mut self, method: &str, params: Value) -> u64 {
        self.next += 1;
        let id = self.next;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        id
    }

    /// Files one frame from hx: a `$` call is answered (or held), a notification is kept, a reply is
    /// put by its id.
    fn take(&mut self, frame: Value) {
        if frame["method"] == "mods.call" {
            let params = frame["params"].clone();
            if self
                .hold
                .iter()
                .any(|h| params["call"].as_str() == Some(h.as_str()))
            {
                self.calls.push(params);
                self.held.push(frame["id"].clone());
                return;
            }
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
        } else if let Some(n) = frame["id"].as_u64() {
            let r = match frame.get("error") {
                Some(e) => Err(e.clone()),
                None => Ok(frame["result"].clone()),
            };
            self.done.insert(n, r);
        }
    }

    /// Reads frames, answering `mods.call`s, until the reply to `id` is in.
    fn finish(&mut self, id: u64) -> Result<Value, Value> {
        loop {
            if let Some(r) = self.done.remove(&id) {
                return r;
            }
            let frame = self
                .rx
                .recv_timeout(Duration::from_mins(1))
                .expect("hx stopped answering");
            self.take(frame);
        }
    }

    /// Waits for a notification named `method` whose params satisfy `pred`, and takes it.
    fn note(&mut self, method: &str, wait: Duration, pred: impl Fn(&Value) -> bool) -> Value {
        let end = std::time::Instant::now() + wait;
        loop {
            if let Some(i) = self
                .notes
                .iter()
                .position(|n| n["method"] == method && pred(&n["params"]))
            {
                return self.notes.remove(i);
            }
            let left = end.saturating_duration_since(std::time::Instant::now());
            assert!(!left.is_zero(), "no `{method}` notification arrived");
            if let Ok(frame) = self.rx.recv_timeout(left.min(Duration::from_millis(100))) {
                self.take(frame);
            }
        }
    }

    /// Answers every held call with `value`.
    fn release(&mut self, value: &Value) {
        for id in std::mem::take(&mut self.held) {
            self.send(&json!({ "jsonrpc": "2.0", "id": id, "result": value }));
        }
    }

    /// One request; answers `mods.call`s while waiting.
    fn request(&mut self, method: &str, params: Value) -> Result<Value, Value> {
        let id = self.begin(method, params);
        self.finish(id)
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
    // A plugin that cannot load is reported by name and code; it does not fail the call, so the
    // others in the same call still load.
    write_mod(
        &dir,
        "bad",
        "export function register() { throw new Error('nope'); }",
    );
    write_mod(
        &dir,
        "good",
        "export function register(on) { on('go', async () => 'fine'); }",
    );
    let r = hx.ok(
        "mods.load",
        json!({ "session_id": "s", "plugins": [
            { "dir": dir.join("plain") }, { "dir": dir.join("bad") }, { "dir": dir.join("good") },
        ] }),
    );
    let failed = r["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 2, "{r}");
    let by = |name: &str| {
        failed
            .iter()
            .find(|f| f["plugin"] == name || f["dir"].as_str().unwrap().ends_with(name))
            .unwrap()
    };
    assert_eq!(by("plain")["code"], "hx.mods.not_a_mod", "{r}");
    assert_eq!(by("bad")["code"], "hx.mods.load_failed");
    assert!(
        by("bad")["message"].as_str().unwrap().contains("nope"),
        "{r}"
    );
    assert_eq!(r["loaded"].as_array().unwrap().len(), 1);
    let a = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s", "event": "go", "payload": {} }),
    );
    assert_eq!(a["value"], "fine");
    // A session whose only mod failed to load leaves nothing behind.
    let r = hx.ok(
        "mods.load",
        json!({ "session_id": "t", "plugins": [{ "dir": dir.join("bad") }] }),
    );
    assert_eq!(r["loaded"], json!([]));
    let sessions = hx.ok("mods.list", json!({ "session_id": "t" }));
    assert_eq!(sessions["sessions"], json!([]));
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

fn pid_of(hx: &mut Fake, session: &str, plugin: &str) -> u32 {
    let list = hx.ok("mods.list", json!({ "session_id": session }));
    let p = list["sessions"][0]["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == plugin)
        .unwrap()
        .clone();
    u32::try_from(p["pid"].as_u64().expect("a running worker has a pid")).unwrap()
}

fn alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
        && std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|s| !s.contains(") Z "))
}

fn wait_gone(pid: u32) {
    let end = std::time::Instant::now() + Duration::from_secs(20);
    while alive(pid) {
        assert!(
            std::time::Instant::now() < end,
            "worker {pid} is still running"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn every_mod_has_a_worker_of_its_own_and_a_stopped_one_is_not_news() {
    let Some(mut hx) = available() else { return };
    load_all(&mut hx, "s1");
    let pids: Vec<u32> = ["counter-pane", "hello-command", "prompt-band"]
        .iter()
        .map(|n| pid_of(&mut hx, "s1", n))
        .collect();
    assert_eq!(
        pids.iter().collect::<std::collections::BTreeSet<_>>().len(),
        3,
        "three mods, three processes: {pids:?}"
    );
    assert_eq!(
        hx.ok(
            "mods.unload",
            json!({ "session_id": "s1", "plugin": "hello-command" })
        )["unloaded"],
        true
    );
    wait_gone(pids[1]);
    assert!(alive(pids[0]) && alive(pids[2]), "the others keep running");
    // Stopping on purpose is not reported as an exit.
    std::thread::sleep(Duration::from_millis(300));
    while let Ok(f) = hx.rx.try_recv() {
        hx.take(f);
    }
    assert!(
        hx.notes.iter().all(|n| n["method"] != "mods.exited"),
        "{:?}",
        hx.notes
    );
    hx.ok("mods.unload", json!({ "session_id": "s1" }));
    for pid in [pids[0], pids[2]] {
        wait_gone(pid);
    }
}

#[test]
fn a_worker_that_dies_is_reported_for_that_mod_alone_and_can_be_loaded_again_in_its_place() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "a",
        "export function register(on) { on('go', async () => 'a'); }",
    );
    write_mod(
        &dir,
        "b",
        "export function register(on) { on('go', async (_$, e, next) => { const r = await next(e); return 'b>' + r; }); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("b") }, { "dir": dir.join("a") }] }),
    );
    let (pa, pb) = (pid_of(&mut hx, "s1", "a"), pid_of(&mut hx, "s1", "b"));
    let r = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "go", "payload": {} }),
    );
    assert_eq!(r["value"], "b>a");
    assert!(
        std::process::Command::new("kill")
            .arg("-9")
            .arg(pa.to_string())
            .status()
            .unwrap()
            .success()
    );
    let note = hx.note("mods.exited", Duration::from_secs(20), |p| {
        p["plugin"] == "a"
    });
    assert_eq!(note["params"]["session_id"], "s1");
    assert_eq!(note["params"]["cause"], "crash");
    assert!(
        note["params"]["reason"]
            .as_str()
            .unwrap()
            .contains("signal 9"),
        "{note}"
    );
    // b is untouched, and the chain goes on without a's hooks.
    assert!(alive(pb));
    let r = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "go", "payload": {} }),
    );
    assert_eq!(r["value"], "b>undefined", "{r}");
    let list = hx.ok("mods.list", json!({ "session_id": "s1" }));
    let a = list["sessions"][0]["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "a")
        .unwrap()
        .clone();
    assert_eq!(a["running"], false);
    // Loading it again puts it back in its place (a runs below b, as before), as a new generation.
    let r = hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("a") }] }),
    );
    assert_eq!(r["loaded"][0]["generation"], 1, "{r}");
    let r = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "go", "payload": {} }),
    );
    assert_eq!(r["value"], "b>a");
    hx.ok("mods.unload", json!({ "session_id": "s1" }));
}

#[test]
fn a_worker_that_reaches_its_lifetime_is_reported_as_the_ceiling() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "m",
        "export function register(on) { on('go', async () => 1); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("m"), "limits": { "lifetime_s": 2 } }] }),
    );
    let list = hx.ok("mods.list", json!({}));
    assert!(
        list["sessions"][0]["plugins"][0]["expires_in_s"]
            .as_u64()
            .unwrap()
            <= 2
    );
    let note = hx.note("mods.exited", Duration::from_secs(20), |p| {
        p["plugin"] == "m"
    });
    assert_eq!(note["params"]["cause"], "ceiling", "{note}");
}

#[test]
fn a_replacement_starts_before_the_old_worker_stops_and_takes_its_place() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "m",
        "export function register(on) { on('go', async () => 'v'); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("m") }] }),
    );
    let old = pid_of(&mut hx, "s1", "m");
    // Without `replace`, a running mod is already loaded.
    let r = hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("m") }] }),
    );
    assert_eq!(r["failed"][0]["code"], "hx.mods.already_loaded", "{r}");
    assert_eq!(pid_of(&mut hx, "s1", "m"), old);
    // With it, the new worker is running and answering before the old one is stopped.
    let r = hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("m") }], "replace": true }),
    );
    let new = u32::try_from(r["loaded"][0]["pid"].as_u64().unwrap()).unwrap();
    assert_ne!(new, old);
    assert_eq!(r["loaded"][0]["generation"], 1);
    assert!(alive(old), "the old worker gets a grace period");
    let a = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "go", "payload": {} }),
    );
    assert_eq!(a["value"], "v");
    wait_gone(old);
    // Its stop was planned: no exit is reported, and the new worker is still there.
    std::thread::sleep(Duration::from_millis(300));
    while let Ok(f) = hx.rx.try_recv() {
        hx.take(f);
    }
    assert!(
        hx.notes.iter().all(|n| n["method"] != "mods.exited"),
        "{:?}",
        hx.notes
    );
    assert!(alive(new));
    hx.ok("mods.unload", json!({ "session_id": "s1" }));
}

#[test]
fn a_mod_that_fills_its_heap_or_spins_fails_alone_and_the_log_says_why() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    write_mod(
        &dir,
        "hog",
        "export function register(on) { on('hog', async () => { const keep = []; for (;;) keep.push(new Array(100000).fill(1)); }); }",
    );
    write_mod(
        &dir,
        "spin",
        "export function register(on) { on('spin', async () => { for (;;) {} }); }",
    );
    write_mod(
        &dir,
        "calm",
        "export function register(on) { on('calm', async () => 'still here'); on('hog', async () => 'unused'); }",
    );
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [
            { "dir": dir.join("hog"), "limits": { "heap_mib": 8 } },
            { "dir": dir.join("spin"), "limits": { "event_budget_ms": 300 } },
            { "dir": dir.join("calm") },
        ] }),
    );
    let calm = pid_of(&mut hx, "s1", "calm");
    hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "hog", "payload": {} }),
    );
    let d = hx.note("mods.diagnostic", Duration::from_secs(10), |p| {
        p["plugin"] == "hog"
    });
    assert!(
        d["params"]["message"]
            .as_str()
            .unwrap()
            .contains("out of memory"),
        "{d}"
    );
    hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "spin", "payload": {} }),
    );
    let d = hx.note("mods.diagnostic", Duration::from_secs(10), |p| {
        p["plugin"] == "spin"
    });
    assert!(
        d["params"]["message"]
            .as_str()
            .unwrap()
            .contains("timed out"),
        "{d}"
    );
    // The others were not touched, and the mods that failed still answer.
    let a = hx.ok(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "calm", "payload": {} }),
    );
    assert_eq!(a["value"], "still here");
    assert!(alive(calm));
    assert_eq!(
        hx.ok("mods.list", json!({}))["sessions"][0]["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["running"] == true)
            .count(),
        3
    );
    hx.ok("mods.unload", json!({ "session_id": "s1" }));
}

#[test]
fn a_mod_waiting_for_a_form_blocks_only_itself() {
    let Some(mut hx) = available() else { return };
    let dir = tempfile_dir();
    // `asker` hooks `ui.render` too: a redraw of someone else's pane passes through its hook.
    write_mod(
        &dir,
        "asker",
        "export function register(on) {
           on('ask', async ($) => ({ answer: await $.ui.ask('Sure?') }));
           on('ui.render', { component: 'Elsewhere' }, async (_$, e, next) => next(e));
         }",
    );
    write_mod(
        &dir,
        "painter",
        "import { Text } from 'claude-code';
         export function register(on) {
           let n = 0;
           on('ui.render', { component: 'Pane' }, async () => Text('frame ' + (++n)));
         }",
    );
    hx.hold = vec!["ui.ask".to_owned()];
    hx.ok(
        "mods.load",
        json!({ "session_id": "s1", "plugins": [{ "dir": dir.join("asker") }, { "dir": dir.join("painter") }] }),
    );
    let asking = hx.begin(
        "mods.dispatch",
        json!({ "session_id": "s1", "event": "ask", "payload": {} }),
    );
    // Wait until the form is open (the ask reached the plugin).
    let end = std::time::Instant::now() + Duration::from_secs(10);
    while hx.held.is_empty() {
        assert!(std::time::Instant::now() < end, "the ask never arrived");
        if let Ok(f) = hx.rx.recv_timeout(Duration::from_millis(50)) {
            hx.take(f);
        }
    }
    // The asker's form is open. The painter redraws, again and again, and is not held up.
    let started = std::time::Instant::now();
    for i in 1..=15 {
        let r = hx.ok(
            "mods.render",
            json!({ "session_id": "s1", "component": "Pane", "id": "p", "props": {} }),
        );
        assert_eq!(r["kind"], "tree", "{r}");
        assert_eq!(texts(&r["tree"]), format!("frame {i}"));
        assert_eq!(r["plugin"], "painter");
    }
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "redraws waited for the form: {:?}",
        started.elapsed()
    );
    // The asker's own pending dispatch is still open until the form is answered.
    assert!(!hx.done.contains_key(&asking));
    hx.release(&json!("Yes"));
    let a = hx.finish(asking).unwrap();
    assert_eq!(a["value"], json!({ "answer": "Yes" }));
    hx.ok("mods.unload", json!({ "session_id": "s1" }));
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
