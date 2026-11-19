//! The isolate has no files, network or processes of its own. This test runs alone in its
//! process so the counts it takes are not disturbed by other tests: it loads and drives the three
//! example mods, each in a bare engine, and checks that the process gained no descriptor, socket,
//! thread or child.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![cfg(target_os = "linux")]

mod common;

use std::fs;

use std::cell::RefCell;
use std::rc::Rc;

use common::example;
use hx_mods::engine::Engine;
use hx_mods::{Bundle, RuntimeConfig};
use serde_json::{Value, json};

#[derive(Debug, PartialEq, Eq)]
struct Footprint {
    descriptors: usize,
    sockets: usize,
    threads: usize,
    children: usize,
}

fn footprint() -> Footprint {
    let fds: Vec<_> = fs::read_dir("/proc/self/fd")
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    let sockets = fds
        .iter()
        .filter(|e| {
            fs::read_link(e.path()).is_ok_and(|t| t.to_string_lossy().starts_with("socket:"))
        })
        .count();
    let own_pid = std::process::id().to_string();
    let children = fs::read_dir("/proc")
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|e| fs::read_to_string(e.path().join("stat")).ok())
        .filter(|stat| {
            stat.rsplit_once(')')
                .and_then(|(_, rest)| rest.split_whitespace().nth(1))
                .is_some_and(|ppid| ppid == own_pid)
        })
        .count();
    Footprint {
        descriptors: fds.len(),
        sockets,
        threads: fs::read_dir("/proc/self/task").unwrap().count(),
        children,
    }
}

/// Loads one example into a bare engine and runs its `session.start` hook, returning every frame the
/// engine sent to its parent.
fn run_example(name: &str) -> Vec<Value> {
    let sent: Rc<RefCell<Vec<Value>>> = Rc::default();
    let sink = sent.clone();
    let mut engine = Engine::new(
        Rc::new(move |f: &Value| {
            sink.borrow_mut().push(f.clone());
            true
        }),
        RuntimeConfig::default(),
    )
    .unwrap();
    let bundle = Bundle::read(&example(name)).unwrap();
    engine.handle(
        &json!({ "id": 1, "op": "load", "bundle": bundle, "tier": "user", "idx": 0, "gen": 0 }),
    );
    let hook = sent
        .borrow()
        .iter()
        .find(|f| f["ev"] == "reg" && f["event"] == "session.start")
        .map(|f| f["hook"].as_str().unwrap().to_owned());
    if let Some(hook) = hook {
        engine.handle(&json!({ "op": "invoke", "m": {
            "k": "invoke", "frame": "f1", "hook": hook, "kind": "hook", "e": "{}", "budget": 1000,
            "event": "session.start", "tier": "user", "run": 1,
        }}));
    }
    let frames = sent.borrow().clone();
    frames
}

#[test]
fn running_the_example_mods_opens_nothing_and_starts_nothing() {
    // Warm anything the standard library or the allocator opens lazily, so the baseline is steady.
    let _ = fs::read_dir("/proc/self/fd").unwrap().count();
    let before = footprint();
    let mut calls = Vec::new();
    for name in ["counter-pane", "hello-command", "prompt-band"] {
        let frames = run_example(name);
        assert!(frames.iter().any(|f| f["re"] == 1), "{name} did not load");
        calls.extend(frames.into_iter().filter(|f| f.get("call").is_some()));
        // The files the loader read were closed again; nothing is held open while the engine lives.
        assert_eq!(footprint(), before, "{name}");
    }
    assert!(!calls.is_empty());
    // Everything the mods did that was not computation left as a `$` call frame.
    assert!(
        calls.iter().all(|c| [
            "ui.open",
            "clock.every",
            "command.register",
            "ui.invalidate"
        ]
        .contains(&c["name"].as_str().unwrap())),
        "{calls:?}"
    );
    assert_eq!(footprint(), before);
}
