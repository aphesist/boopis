//! The macOS counterpart of `tests/linux.rs`, for a real Mac: the author could compile but not
//! run these. Each one asserts through the `probe` example what the Seatbelt profile allows.
//! Run with `cargo test -p hx-sandbox --test macos` on macOS 13 or newer.
#![cfg(target_os = "macos")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failing unwrap is a failing test"
)]

mod common;

use std::time::{Duration, Instant};

use common::*;
use hx_sandbox::{ExitOutcome, NetworkPolicy, Status, run};

fn seatbelt_available() -> bool {
    let caps = hx_sandbox::capabilities();
    if !caps.fs.available {
        eprintln!("SKIPPED: Seatbelt unavailable here: {}", caps.fs.detail);
    }
    caps.fs.available
}

#[tokio::test(flavor = "multi_thread")]
async fn ro_is_read_only_rw_is_writable_and_the_rest_is_unreadable() {
    if !seatbelt_available() {
        return;
    }
    let w = World::new();
    let denied = w.work.join("new.txt");
    let r = run(&probe(&["write", denied.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert!(!denied.exists());

    let allowed = w.scratch.join("new.txt");
    let r = run(&probe(&["write", allowed.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");

    let secret = w.outside.join("secret.txt");
    let r = run(&probe(&["read", secret.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert_eq!(r.enforcement.fs.status, Status::Enforced);
    assert_eq!(r.enforcement.fs.mechanisms, ["seatbelt"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn network_off_blocks_connects_and_on_allows_them() {
    if !seatbelt_available() {
        return;
    }
    let w = World::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let r = run(&probe(&["connect", &addr]), &w.policy()).await.unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    let r = run(
        &probe(&["connect", &addr]),
        &w.policy().with_network(NetworkPolicy::Loopback),
    )
    .await
    .unwrap();
    assert_eq!(
        code(&r),
        Some(0),
        "loopback should reach the host's listener on macOS: {r:?}"
    );
    let r = run(
        &probe(&["connect", "192.0.2.1:9"]),
        &w.policy().with_network(NetworkPolicy::Loopback),
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    let r = run(
        &probe(&["connect", &addr]),
        &w.policy().with_network(NetworkPolicy::On),
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn env_timeout_and_cap() {
    if !seatbelt_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    p.env_allowlist = vec!["PATH".into()];
    let r = run(&probe(&["env"]), &p).await.unwrap();
    let names: Vec<&str> = r
        .stdout
        .text
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, _)| k))
        .collect();
    assert_eq!(names, ["PATH"], "{}", r.stdout.text);

    p.timeout_ms = 1_000;
    p.kill_grace_ms = 200;
    let pidfile = w.scratch.join("pids");
    let started = Instant::now();
    let r = run(&probe(&["tree", pidfile.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
    tokio::time::sleep(Duration::from_millis(500)).await;
    for pid in read_pids(&pidfile) {
        assert!(is_dead(pid), "process {pid} survived the timeout");
    }

    p.timeout_ms = 30_000;
    p.output_cap_bytes = 1024;
    let r = run(&probe(&["flood", "1048576"]), &p).await.unwrap();
    assert_eq!(r.stdout.text.len(), 1024);
    assert!(r.stdout.truncated);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_missing_binary_is_spawn_failed() {
    let w = World::new();
    let r = run(&argv(&["/nonexistent/prog"]), &w.policy())
        .await
        .unwrap();
    assert!(matches!(r.exit, ExitOutcome::SpawnFailed { .. }), "{r:?}");
}
