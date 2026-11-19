//! The isolate has no files, network or processes of its own. This test runs alone in its
//! process so the counts it takes are not disturbed by other tests: it loads and drives the three
//! example mods and checks that the process gained no descriptor, socket, thread or child.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![cfg(target_os = "linux")]

mod common;

use std::fs;

use common::{example, runtime};
use hx_mods::Tier;
use serde_json::json;

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

#[test]
fn running_the_example_mods_opens_nothing_and_starts_nothing() {
    // Warm anything the standard library or the allocator opens lazily, so the baseline is steady.
    let _ = fs::read_dir("/proc/self/fd").unwrap().count();
    let before = footprint();
    {
        let (mut rt, host) = runtime();
        let a = example("counter-pane");
        let b = example("hello-command");
        let c = example("prompt-band");
        rt.load_plugins(&[(&a, Tier::User), (&b, Tier::User), (&c, Tier::User)])
            .unwrap();
        rt.dispatch("session.start", &json!({})).unwrap();
        rt.render("Pane", Some("counter"), &json!({})).unwrap();
        rt.render("AbovePrompt", None, &json!({ "isWorking": true }))
            .unwrap();
        rt.run_command("fingerprint", "x").unwrap();
        assert!(!host.calls().is_empty());
        // Everything the mods did that was not computation went through the host trait.
        assert!(
            host.calls().iter().all(|c| [
                "ui.open",
                "clock.every",
                "command.register",
                "ui.invalidate"
            ]
            .contains(&c.call.as_str())),
            "{:?}",
            host.calls()
        );
        // The files the loader read were closed again; nothing is held open while the runtime lives.
        assert_eq!(footprint(), before);
    }
    assert_eq!(footprint(), before);
}
