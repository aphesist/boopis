//! The Windows counterpart of `tests/linux.rs`, for a real Windows 10 or 11 machine: the author
//! could compile but not run these. Each asserts through the `probe` example what the
//! `AppContainer` allows. Run with `cargo test -p hx-sandbox --test windows`.
//!
//! The loopback test needs an elevated terminal and is `#[ignore]`d otherwise; run it with
//! `cargo test -p hx-sandbox --test windows -- --ignored` from an administrator shell.
#![cfg(windows)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failing unwrap is a failing test"
)]

mod common;

use std::io::Read;
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::time::{Duration, Instant};

use common::*;
use hx_sandbox::{Degraded, Error, ExitOutcome, NetworkPolicy, SpawnOptions, Status, run, spawn};

fn appcontainer_available() -> bool {
    let caps = hx_sandbox::capabilities();
    if !caps.fs.available {
        eprintln!("SKIPPED: AppContainer unavailable here: {}", caps.fs.detail);
    }
    caps.fs.available
}

#[tokio::test(flavor = "multi_thread")]
async fn ro_is_read_only_rw_is_writable_and_the_rest_is_unreadable() {
    if !appcontainer_available() {
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
    assert_eq!(std::fs::read_to_string(allowed).unwrap(), "probe");

    let secret = w.outside.join("secret.txt");
    let r = run(&probe(&["read", secret.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert_eq!(r.enforcement.fs.status, Status::Enforced);
    assert_eq!(r.enforcement.fs.mechanisms, ["appcontainer", "acl"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn grants_are_revoked_when_the_run_ends() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let before = std::process::Command::new("icacls")
        .arg(&w.scratch)
        .output()
        .unwrap();
    let r = run(&probe(&["exit", "0"]), &w.policy()).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let after = std::process::Command::new("icacls")
        .arg(&w.scratch)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&before.stdout),
        String::from_utf8_lossy(&after.stdout),
        "the container's access entries must be removed after the run"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn network_off_blocks_connects_and_on_allows_them() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let r = run(&probe(&["connect", &addr]), &w.policy()).await.unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    let r = run(&probe(&["connect", "192.0.2.1:9"]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Enforced);
    // `on` grants the internet capabilities; loopback stays isolated for an AppContainer unless
    // exempted, so the external-address attempt is the meaningful check of the capability and
    // is allowed to fail with a timeout or unreachable error rather than a permission error.
    let r = run(
        &probe(&["connect", "192.0.2.1:9"]),
        &w.policy().with_network(NetworkPolicy::On),
    )
    .await
    .unwrap();
    assert!(!r.stdout.text.contains("denied"), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Unrestricted);
}

#[tokio::test(flavor = "multi_thread")]
async fn loopback_without_elevation_is_unavailable_and_degrades_only_when_allowed() {
    if !appcontainer_available() || hx_sandbox::capabilities().network_loopback.available {
        eprintln!("SKIPPED: needs a non-elevated shell");
        return;
    }
    let w = World::new();
    let p = w.policy().with_network(NetworkPolicy::Loopback);
    let err = run(&probe(&["exit", "0"]), &p).await.unwrap_err();
    assert_eq!(err.code(), "hx.sandbox.unavailable");
    let mut p = p;
    p.degraded = Degraded {
        network: true,
        ..Degraded::default()
    };
    let r = run(&probe(&["exit", "0"]), &p).await.unwrap();
    assert_eq!(r.enforcement.network.status, Status::Degraded);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs an elevated (administrator) shell to edit the loopback exemption list"]
async fn loopback_reaches_the_host_listener_when_elevated() {
    let w = World::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let p = w.policy().with_network(NetworkPolicy::Loopback);
    let r = run(&probe(&["connect", &addr]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn only_allowlisted_variables_reach_the_child() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    p.env_allowlist = vec!["SystemRoot".into()];
    p.env_set.insert("FROM_POLICY".into(), "yes".into());
    let r = run(&probe(&["env"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let mut names: Vec<String> = r
        .stdout
        .text
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, _)| k.to_uppercase()))
        .collect();
    names.sort();
    assert!(names.contains(&"FROM_POLICY".to_owned()), "{names:?}");
    assert!(
        !names.contains(&"USERPROFILE".to_owned()) && !names.contains(&"PATH".to_owned()),
        "{names:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn arguments_with_quotes_and_spaces_arrive_intact() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    // `env` ignores extra arguments, so use `read` on a path with spaces and an `&` in it.
    let dir = w.scratch.join("a b & c");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("x y.txt"), "spaced").unwrap();
    let r = run(
        &probe(&["read", dir.join("x y.txt").to_str().unwrap()]),
        &w.policy(),
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert!(r.stdout.text.contains("spaced"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_timeout_kills_the_whole_tree_through_the_job() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let pidfile = w.scratch.join("pids");
    let mut p = w.policy();
    p.timeout_ms = 1_500;
    let started = Instant::now();
    let r = run(&probe(&["tree", pidfile.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(15));
    tokio::time::sleep(Duration::from_millis(500)).await;
    let pids = read_pids(&pidfile);
    assert_eq!(pids.len(), 3, "{pids:?}");
    for pid in pids {
        assert!(is_dead(pid), "process {pid} survived the job kill");
    }
    assert!(
        r.enforcement
            .process
            .mechanisms
            .contains(&"job-object".to_owned())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn output_is_capped() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    p.output_cap_bytes = 1024;
    let r = run(&probe(&["flood", "1048576"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(r.stdout.text.len(), 1024);
    assert!(r.stdout.truncated);
    assert_eq!(r.stdout.total_bytes, 1_048_576);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_missing_binary_is_spawn_failed() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let r = run(&["C:\\nonexistent\\prog.exe".to_owned()], &w.policy())
        .await
        .unwrap();
    assert!(matches!(r.exit, ExitOutcome::SpawnFailed { .. }), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn spawn_passes_one_pipe_handle_to_the_child() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let (mut reader, writer) = std::io::pipe().unwrap();
    let value = writer.as_raw_handle() as usize;
    let mut h = spawn(
        &probe(&["handle", &value.to_string()]),
        &w.policy(),
        SpawnOptions::new().with_inherit(OwnedHandle::from(writer)),
    )
    .await
    .unwrap();
    let mut greeting = String::new();
    reader.read_to_string(&mut greeting).unwrap();
    assert_eq!(greeting, "hello-from-child");
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::Exited { code: 0 });
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_allowlist_fails_closed() {
    let w = World::new();
    let al = NetworkPolicy::Allowlist(vec!["pypi.org".into()]);
    let err = run(&probe(&["exit", "0"]), &w.policy().with_network(al))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Unavailable { .. }), "{err}");

    // Degraded means network off, reported as such.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut p = w
        .policy()
        .with_network(NetworkPolicy::Allowlist(vec!["pypi.org".into()]));
    p.degraded = Degraded {
        network: true,
        ..Degraded::default()
    };
    let r = run(
        &probe(&["connect", &listener.local_addr().unwrap().to_string()]),
        &p,
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Degraded);
    assert!(
        r.enforcement
            .network
            .detail
            .unwrap()
            .contains("network: off (allowlist")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_job_limits_cap_the_process_count() {
    if !appcontainer_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    p.resources.max_processes = Some(5);
    let r = run(&probe(&["forkbomb", "100"]), &p).await.unwrap();
    let started: usize = r
        .stdout
        .text
        .split_whitespace()
        .nth(1)
        .unwrap_or("100")
        .parse()
        .unwrap();
    assert!(
        started < 100,
        "the active-process limit did not stop the bomb: {r:?}"
    );
    assert!(
        r.enforcement
            .process
            .mechanisms
            .contains(&"job-limits".to_owned())
    );
}
