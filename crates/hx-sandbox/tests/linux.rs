//! Real-process tests of the Linux backend: every assertion is made by a program running inside
//! the sandbox and reporting what it could and could not do.
#![cfg(target_os = "linux")]
#![allow(
    unsafe_code,
    reason = "one test clears FD_CLOEXEC on purpose to prove the sandbox re-marks it"
)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failing unwrap is a failing test"
)]

mod common;

use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::time::{Duration, Instant};

use common::*;
use hx_sandbox::{
    Degraded, Dimension, Error, ExitOutcome, NetworkPolicy, SpawnOptions, Status, run, spawn,
};

// ---- filesystem ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn writing_in_a_ro_path_fails_and_in_a_rw_path_succeeds() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    let ro_target = w.work.join("new.txt");
    let r = run(&probe(&["write", ro_target.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert!(
        r.stdout.text.contains("Permission denied"),
        "{}",
        r.stdout.text
    );
    assert!(!ro_target.exists());

    let rw_target = w.scratch.join("new.txt");
    let r = run(&probe(&["write", rw_target.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(std::fs::read_to_string(rw_target).unwrap(), "probe");
}

#[tokio::test(flavor = "multi_thread")]
async fn existing_files_in_a_ro_tree_cannot_be_changed_in_any_way() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    let file = w.work.join("source.txt");
    let f = file.to_str().unwrap();
    for args in [
        vec!["write", f],
        vec!["remove", f],
        vec!["truncate", f],
        vec!["rename", f, w.scratch.join("moved.txt").to_str().unwrap()],
    ] {
        let r = run(&probe(&args), &w.policy()).await.unwrap();
        assert_eq!(code(&r), Some(3), "{args:?}: {r:?}");
    }
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "workspace file");
    // Reading is fine.
    let r = run(&probe(&["read", f]), &w.policy()).await.unwrap();
    assert_eq!(code(&r), Some(0));
    assert!(r.stdout.text.contains("workspace file"));
}

#[tokio::test(flavor = "multi_thread")]
async fn reading_outside_the_grants_fails() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    let secret = w.outside.join("secret.txt");
    let r = run(&probe(&["read", secret.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert!(
        r.stdout.text.contains("Permission denied"),
        "{}",
        r.stdout.text
    );
    let r = run(&probe(&["list", w.outside.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3));
    // The home directory and /etc are not granted either.
    let r = run(&probe(&["read", "/etc/hostname"]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");

    // Control: granting the directory makes the same read succeed, so the denial was the sandbox.
    let mut p = w.policy();
    p.ro_paths.push(w.outside.clone());
    let r = run(&probe(&["read", secret.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_symlink_in_scratch_does_not_grant_its_target() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    // scratch/link -> work (read-only): writing through it must still fail.
    std::os::unix::fs::symlink(&w.work, w.scratch.join("link_to_work")).unwrap();
    // scratch/to_outside -> outside (not granted at all).
    std::os::unix::fs::symlink(&w.outside, w.scratch.join("link_to_outside")).unwrap();
    for link in ["link_to_work", "link_to_outside"] {
        let target = w.scratch.join(link).join("pwned.txt");
        let r = run(&probe(&["write", target.to_str().unwrap()]), &w.policy())
            .await
            .unwrap();
        assert_eq!(code(&r), Some(3), "{link}: {r:?}");
    }
    assert!(!w.work.join("pwned.txt").exists());
    assert!(!w.outside.join("pwned.txt").exists());
    let r = run(
        &probe(&[
            "read",
            w.scratch
                .join("link_to_outside/secret.txt")
                .to_str()
                .unwrap(),
        ]),
        &w.policy(),
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_symlinked_policy_path_grants_the_target_not_the_link() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    // The policy lists scratch/alias as rw, but it is a link to `outside`: the grant lands on
    // `outside` (what the link points at), and the resolved policy shows that.
    std::os::unix::fs::symlink(&w.outside, w.scratch.join("alias")).unwrap();
    let mut p = w.policy();
    p.rw_paths = vec![w.scratch.join("alias")];
    let resolved = p.resolve().unwrap();
    assert_eq!(resolved.rw[0].path, w.outside);
    assert!(
        resolved
            .ensure_rw_within(std::slice::from_ref(&w.scratch))
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_program_outside_the_grants_cannot_start_and_says_why() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    p.ro_paths.retain(|r| r != probe_path().parent().unwrap());
    let r = run(&probe(&["exit", "0"]), &p).await.unwrap();
    match &r.exit {
        ExitOutcome::SpawnFailed { reason } => {
            assert!(reason.contains("not inside ro_paths"), "{reason}");
        }
        other => panic!("expected SpawnFailed, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_program_under_a_runtime_root_starts_even_through_a_venv_style_symlink() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    let mut p = w.policy();
    let probe_dir = probe_path().parent().unwrap().to_path_buf();
    p.ro_paths.retain(|r| r != &probe_dir);
    // An interpreter outside every grant: the probe, copied in as `python3`, so that the
    // directories look like what a runtime root must look like (bin/python3).
    let root = w.scratch.parent().unwrap();
    let real_dir = root.join("interpreter").join("bin");
    std::fs::create_dir_all(&real_dir).unwrap();
    let real = real_dir.join("python3");
    std::fs::copy(probe_path(), &real).unwrap();
    // a venv-style launcher: `venv/bin/python3` is a symlink into the interpreter's real directory
    let venv = root.join("venv");
    std::fs::create_dir_all(venv.join("bin")).unwrap();
    let launcher = venv.join("bin").join("python3");
    std::os::unix::fs::symlink(&real, &launcher).unwrap();
    let argv: Vec<String> = std::iter::once(launcher.to_string_lossy().into_owned())
        .chain(["exit", "0"].map(str::to_owned))
        .collect();

    // without the roots the program is outside every grant, and the sandbox says so
    let denied = run(&argv, &p).await.unwrap();
    assert!(
        matches!(denied.exit, ExitOutcome::SpawnFailed { .. }),
        "{:?}",
        denied.exit
    );

    // with the venv and the real directory as runtime roots it starts and runs
    p.runtime_ro_paths = vec![venv.clone(), real_dir];
    let ok = run(&argv, &p).await.unwrap();
    assert_eq!(code(&ok), Some(0), "{:?} {}", ok.exit, ok.stderr.text);

    // the roots grant reading and nothing else: the runtime directory cannot be written
    let target = venv.join("written");
    let write = run(&probe(&["write", &target.to_string_lossy()]), &p)
        .await
        .unwrap();
    assert_ne!(code(&write), Some(0));
    assert!(!target.exists());

    // and a directory that holds no interpreter is not accepted as a runtime at all
    p.runtime_ro_paths = vec![w.outside.clone()];
    let err = run(&argv, &p).await.unwrap_err();
    assert!(
        matches!(&err, Error::InvalidPolicy(m) if m.contains("not an interpreter or toolchain prefix")),
        "{err}"
    );
}

// ---- network ------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn network_off_blocks_tcp_connects_and_on_allows_them() {
    let w = World::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let local = listener.local_addr().unwrap().to_string();

    // Off: the loopback listener, an external address (TEST-NET-1, never routed) and UDP all fail
    // at socket creation with EPERM, before any packet could leave.
    for target in [local.as_str(), "192.0.2.1:9"] {
        let r = run(&probe(&["connect", target]), &w.policy())
            .await
            .unwrap();
        assert_eq!(code(&r), Some(3), "{target}: {r:?}");
        assert!(
            r.stdout.text.contains("Operation not permitted"),
            "{target}: {}",
            r.stdout.text
        );
        assert_eq!(r.enforcement.network.status, Status::Enforced);
    }
    let r = run(&probe(&["udp", "192.0.2.1:9"]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");

    // Control: with the network on the very same connect succeeds, so the failure above was the
    // sandbox and not a broken test.
    let p = w.policy().with_network(NetworkPolicy::On);
    let r = run(&probe(&["connect", &local]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Unrestricted);
}

#[tokio::test(flavor = "multi_thread")]
async fn network_off_closes_unix_socket_paths_too() {
    let w = World::new();
    let sock = w.scratch.join("host.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&sock).unwrap();
    let r = run(&probe(&["unix", sock.to_str().unwrap()]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert!(
        r.stdout.text.contains("Operation not permitted"),
        "{}",
        r.stdout.text
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn loopback_mode_is_a_private_namespace_with_only_loopback() {
    if !hx_sandbox::capabilities().network_loopback.available {
        eprintln!("SKIPPED: no network namespace available here");
        return;
    }
    let w = World::new();
    let host_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let host_addr = host_listener.local_addr().unwrap().to_string();
    let p = w.policy().with_network(NetworkPolicy::Loopback);

    // The child has a working loopback of its own...
    let r = run(&probe(&["selfconnect"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Enforced);
    assert!(
        r.enforcement
            .network
            .mechanisms
            .contains(&"netns".to_owned())
    );
    // ...but not the host's loopback, and no route out.
    let r = run(&probe(&["connect", &host_addr]), &p).await.unwrap();
    assert_eq!(
        code(&r),
        Some(3),
        "host loopback must be unreachable: {r:?}"
    );
    let r = run(&probe(&["connect", "192.0.2.1:9"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(3), "{r:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allowlist_of_loopback_names_is_loopback() {
    if !hx_sandbox::capabilities().network_loopback.available {
        eprintln!("SKIPPED: no network namespace available here");
        return;
    }
    let w = World::new();
    let p = w.policy().with_network(NetworkPolicy::Allowlist(vec![
        "localhost".into(),
        "127.0.0.1".into(),
    ]));
    let r = run(&probe(&["selfconnect"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert!(
        r.enforcement
            .network
            .mechanisms
            .contains(&"netns".to_owned())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_allowlist_fails_closed_and_degrades_to_network_off() {
    let w = World::new();
    let al = NetworkPolicy::Allowlist(vec!["pypi.org".into()]);
    let err = run(&probe(&["exit", "0"]), &w.policy().with_network(al.clone()))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "hx.sandbox.unavailable");
    assert!(
        matches!(
            err,
            Error::Unavailable {
                dimension: Dimension::Network,
                ..
            }
        ),
        "{err}"
    );

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let mut p = w.policy().with_network(al);
    p.degraded = Degraded {
        network: true,
        ..Degraded::default()
    };
    let r = run(&probe(&["connect", &addr]), &p).await.unwrap();
    // Degraded means network OFF, not on: even the host's loopback listener is unreachable.
    assert_eq!(code(&r), Some(3), "{r:?}");
    assert!(
        r.stdout.text.contains("Operation not permitted"),
        "{}",
        r.stdout.text
    );
    assert_eq!(r.enforcement.network.status, Status::Degraded);
    assert_eq!(r.enforcement.network.mechanisms, ["seccomp"]);
    let detail = r.enforcement.network.detail.as_deref().unwrap();
    assert!(
        detail.contains("network: off (allowlist of 1 host(s) unavailable"),
        "{detail}"
    );
    assert!(r.enforcement.is_degraded());
}
// ---- environment --------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn only_allowlisted_and_set_variables_reach_the_child() {
    let w = World::new();
    assert!(
        std::env::var_os("HOME").is_some()
            || std::env::var_os("USER").is_some()
            || std::env::var_os("CARGO_TARGET_DIR").is_some(),
        "the test needs some host variable to filter"
    );
    let mut p = w.policy();
    p.env_allowlist = vec!["PATH".into(), "NOT_SET_ANYWHERE".into()];
    p.env_set.insert("FROM_POLICY".into(), "yes".into());
    let r = run(&probe(&["env"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let mut names: Vec<&str> = r
        .stdout
        .text
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, _)| k))
        .collect();
    names.sort_unstable();
    // PATH comes from env_set here (it wins over the host's), FROM_POLICY from env_set; nothing
    // from the host environment (HOME, CARGO_*, tokens) leaks.
    assert_eq!(names, ["FROM_POLICY", "PATH"], "{}", r.stdout.text);
    assert!(r.stdout.text.contains("PATH=/usr/bin:/bin"));
    assert_eq!(r.enforcement.env.status, Status::Enforced);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allowlisted_host_variable_is_copied_and_others_are_not() {
    let w = World::new();
    let mut p = w.policy();
    p.env_set.clear();
    p.env_allowlist = vec!["PATH".into()];
    let r = run(&probe(&["env"]), &p).await.unwrap();
    // The probe is found through the absolute path, so no PATH is needed for it; the child
    // sees the host's PATH and nothing else.
    let names: Vec<&str> = r
        .stdout
        .text
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, _)| k))
        .collect();
    assert_eq!(names, ["PATH"], "{}", r.stdout.text);
}

// ---- process tree, timeout, output ---------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn a_timeout_kills_the_whole_tree_including_grandchildren() {
    let w = World::new();
    let base = w.scratch.join("beat");
    let beats = beat_files(&base, &["top", "mid", "leaf"]);
    let mut p = w.policy();
    // The deadline has to outlast three nested process starts, each of which sets up its own
    // sandbox, on a runner that may be busy with other tests; the timeout is what ends the
    // tree, so a start that has not happened by then would fail the "all started" check below
    // for a reason that has nothing to do with the kill.
    p.timeout_ms = 5_000;
    p.kill_grace_ms = 200;
    let started = Instant::now();
    let r = run(&probe(&["tree", base.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "took {:?}",
        started.elapsed()
    );
    assert!(
        all_started(&beats),
        "tree, mid and leaf should all have started within the {} ms deadline",
        p.timeout_ms
    );
    assert!(
        heartbeats_stopped(&beats),
        "a process of the tree survived the timeout"
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn a_term_ignoring_process_is_killed_after_the_grace() {
    let w = World::new();
    let mut p = w.policy();
    p.timeout_ms = 500;
    p.kill_grace_ms = 300;
    p.ro_paths.push("/usr".into());
    let started = Instant::now();
    let r = run(
        &argv(&["/bin/sh", "-c", "trap '' TERM; while :; do sleep 1; done"]),
        &p,
    )
    .await
    .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "took {:?}",
        started.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn background_processes_do_not_outlive_their_parent() {
    let w = World::new();
    let beat = w.scratch.join("bg.beat");
    let script = format!(
        "{} heartbeat {} & echo started",
        probe_path().display(),
        beat.display()
    );
    let started = Instant::now();
    let r = run(&argv(&["/bin/sh", "-c", &script]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert!(r.stdout.text.contains("started"));
    // The background process held the output pipes open; run() must still return promptly.
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "took {:?}",
        started.elapsed()
    );
    assert!(
        heartbeats_stopped(std::slice::from_ref(&beat)),
        "the background process survived"
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn the_process_tree_has_the_shape_the_report_names() {
    let w = World::new();
    let r = run(&probe(&["ids"]), &w.policy()).await.unwrap();
    let ids: Vec<i64> = r
        .stdout
        .text
        .split_whitespace()
        .map(|s| s.parse().unwrap())
        .collect();
    assert_ne!(ids[0], i64::from(std::process::id()));
    let mechanisms = &r.enforcement.process.mechanisms;
    if mechanisms.contains(&"pid-namespace".to_owned()) {
        // Inside a PID namespace the program is pid 1; its group id belongs to the parent
        // namespace and reads as 0 from in here.
        assert_eq!(ids[0], 1, "{ids:?}");
    } else if mechanisms.contains(&"subreaper".to_owned()) {
        // The leader is the supervisor; the program is its child, in the supervisor's group and
        // session.
        assert_ne!(ids[0], ids[1], "pid should differ from pgid: {ids:?}");
        assert_eq!(ids[1], ids[2], "pgid and sid are the supervisor's: {ids:?}");
    } else {
        // A cgroup run has no supervisor: the program leads its own session and group.
        assert_eq!(ids[0], ids[1], "pgid should equal pid: {ids:?}");
        assert_eq!(ids[0], ids[2], "sid should equal pid: {ids:?}");
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn output_is_capped_without_blocking_the_child() {
    let w = World::new();
    let mut p = w.policy();
    p.output_cap_bytes = 1024;
    let total: u64 = 10 * 1024 * 1024;
    let started = Instant::now();
    let r = run(&probe(&["flood", &total.to_string()]), &p)
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(r.stdout.text.len(), 1024);
    assert!(r.stdout.truncated);
    assert_eq!(r.stdout.total_bytes, total);
    assert!(!r.stderr.truncated);
    assert!(started.elapsed() < Duration::from_secs(20));

    let r = run(&probe(&["flood", "5000", "stderr"]), &p).await.unwrap();
    assert_eq!(r.stderr.text.len(), 1024);
    assert!(r.stderr.truncated);
    assert_eq!(r.stderr.total_bytes, 5000);

    p.output_cap_bytes = 4096;
    let r = run(&probe(&["flood", "4096"]), &p).await.unwrap();
    assert!(!r.stdout.truncated, "exactly at the cap is not truncated");
}

#[tokio::test(flavor = "multi_thread")]
async fn exit_codes_and_signals_are_reported() {
    let w = World::new();
    let r = run(&probe(&["exit", "7"]), &w.policy()).await.unwrap();
    assert_eq!(r.exit, ExitOutcome::Exited { code: 7 });
    // A real fault kills even a PID namespace's init, and the supervisor mirrors the signal.
    let r = run(&probe(&["crash"]), &w.policy()).await.unwrap();
    assert_eq!(r.exit, ExitOutcome::Signaled { signal: 11 }, "{r:?}");
}
#[tokio::test(flavor = "multi_thread")]
async fn a_missing_program_is_spawn_failed_not_an_error() {
    let w = World::new();
    let r = run(&argv(&["/nonexistent/prog"]), &w.policy())
        .await
        .unwrap();
    assert!(matches!(r.exit, ExitOutcome::SpawnFailed { .. }), "{r:?}");
    let r = run(&argv(&["definitely-not-a-program"]), &w.policy())
        .await
        .unwrap();
    match r.exit {
        ExitOutcome::SpawnFailed { reason } => assert!(reason.contains("not found"), "{reason}"),
        other => panic!("{other:?}"),
    }
    // A file that exists but is not executable.
    let r = run(
        &argv(&[w.work.join("source.txt").to_str().unwrap()]),
        &w.policy(),
    )
    .await
    .unwrap();
    assert!(matches!(r.exit, ExitOutcome::SpawnFailed { .. }), "{r:?}");
    // An empty argv is a policy error, not an outcome.
    assert!(matches!(
        run(&[], &w.policy()).await,
        Err(Error::InvalidPolicy(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_the_run_future_kills_the_tree() {
    let w = World::new();
    let base = w.scratch.join("cancel");
    let beats = beat_files(&base, &["top", "mid", "leaf"]);
    let policy = w.policy();
    let args = probe(&["tree", base.to_str().unwrap()]);
    let task = tokio::spawn(async move { run(&args, &policy).await });
    for _ in 0..100 {
        if all_started(&beats) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(all_started(&beats));
    task.abort();
    let _ = task.await;
    assert!(
        heartbeats_stopped(&beats),
        "the tree outlived the cancelled run"
    );
}
// ---- the report matches what the child can observe -----------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn the_enforcement_report_matches_the_child_s_own_view() {
    if !fs_available() {
        return;
    }
    let w = World::new();
    // /proc is not granted by default (it exposes other processes' environments); this one
    // test grants it so the child can read its own status.
    let mut policy = w.policy();
    policy.ro_paths.push("/proc".into());
    let r = run(&probe(&["status"]), &policy).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let seen = &r.stdout.text;
    let e = &r.enforcement;
    assert_eq!(e.platform, "linux");
    assert_eq!(e.fs.status, Status::Enforced);
    assert_eq!(e.fs.mechanisms, ["landlock"]);
    assert_eq!(e.network.mechanisms, ["seccomp"]);
    // seccomp-hardening in the report <=> the kernel says a filter is active in the child.
    assert!(
        e.process
            .mechanisms
            .contains(&"seccomp-hardening".to_owned())
    );
    assert!(seen.contains("Seccomp:\t2"), "{seen}");
    assert!(e.process.mechanisms.contains(&"no_new_privs".to_owned()));
    assert!(seen.contains("NoNewPrivs:\t1"), "{seen}");
    assert!(
        e.process
            .mechanisms
            .contains(&"capabilities-cleared".to_owned())
    );
    for line in seen
        .lines()
        .filter(|l| l.starts_with("CapEff") || l.starts_with("CapPrm") || l.starts_with("CapInh"))
    {
        assert!(
            line.ends_with("0000000000000000"),
            "capabilities should be empty: {line}"
        );
    }
    if e.process
        .mechanisms
        .contains(&"bounding-set-cleared".to_owned())
    {
        let bnd = seen.lines().find(|l| l.starts_with("CapBnd")).unwrap();
        assert!(
            bnd.ends_with("0000000000000000"),
            "bounding set should be empty: {bnd}"
        );
    }
    // The probe ran with Landlock really enforcing: the report's claim is the same one the
    // read test above makes by trying.
    let denied = run(&probe(&["read", "/etc/hostname"]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&denied), Some(3));
}

#[tokio::test(flavor = "multi_thread")]
async fn dangerous_syscalls_are_denied() {
    let w = World::new();
    let r = run(&probe(&["ptrace"]), &w.policy()).await.unwrap();
    assert!(
        r.stdout.text.contains("errno 1"),
        "ptrace should fail with EPERM: {}",
        r.stdout.text
    );
    let r = run(&probe(&["io_uring"]), &w.policy()).await.unwrap();
    assert!(
        r.stdout.text.contains("errno 1"),
        "io_uring_setup should fail with EPERM: {}",
        r.stdout.text
    );
}

// ---- sockets: with the network off only AF_UNIX streams exist ---------------------------------

const EPERM_TEXT: &str = "errno 1";

async fn out(w: &World, net: NetworkPolicy, args: &[&str]) -> (Option<i32>, String) {
    let r = run(&probe(args), &w.policy().with_network(net))
        .await
        .unwrap();
    (code(&r), r.stdout.text)
}

#[tokio::test(flavor = "multi_thread")]
async fn with_the_network_off_only_unix_stream_sockets_can_be_created() {
    let w = World::new();
    for call in ["socket", "socketpair"] {
        // The one type that stays: plain, and with the flags libc and Python add.
        for kind in [
            "stream",
            "stream,nonblock",
            "stream,cloexec",
            "stream,nonblock,cloexec",
        ] {
            let (c, text) = out(&w, NetworkPolicy::Off, &[call, "unix", kind]).await;
            assert_eq!((c, text.trim()), (Some(0), "ok"), "{call} {kind}");
        }
        // Every other AF_UNIX type: DGRAM and RDM, SEQPACKET, and RAW (a datagram socket in
        // the kernel), with and without the flags.
        for kind in [
            "dgram",
            "raw",
            "seqpacket",
            "rdm",
            "dgram,nonblock,cloexec",
            "raw,cloexec",
        ] {
            let (c, text) = out(&w, NetworkPolicy::Off, &[call, "unix", kind]).await;
            assert_eq!(c, Some(3), "{call} {kind} must be denied: {text}");
            assert!(text.contains(EPERM_TEXT), "{call} {kind}: {text}");
        }
        for domain in ["inet", "inet6", "netlink"] {
            let (c, text) = out(&w, NetworkPolicy::Off, &[call, domain, "stream"]).await;
            assert_eq!(c, Some(3), "{call} {domain}: {text}");
            assert!(text.contains(EPERM_TEXT), "{call} {domain}: {text}");
        }
        // Control: with the network on the same datagram and seqpacket sockets are created, so
        // the denials above were the sandbox and not the kernel.
        for kind in ["dgram", "raw", "seqpacket"] {
            let (c, text) = out(&w, NetworkPolicy::On, &[call, "unix", kind]).await;
            assert_eq!((c, text.trim()), (Some(0), "ok"), "control {call} {kind}");
        }
    }
}

/// A host datagram socket, the way journald and `/dev/log` are: addressed by a path the sandbox
/// has no grant for. It answers whoever writes to it. Returns what it received, as a list.
fn datagram_server(path: &std::path::Path) -> std::thread::JoinHandle<Vec<String>> {
    let server = std::os::unix::net::UnixDatagram::bind(path).unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(4)))
        .unwrap();
    std::thread::spawn(move || {
        let mut seen = Vec::new();
        let mut buf = [0u8; 128];
        while let Ok((n, from)) = server.recv_from(&mut buf) {
            seen.push(String::from_utf8_lossy(&buf[..n]).into_owned());
            let _ = server.send_to_addr(b"reply-from-host", &from);
        }
        seen
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sandboxed_child_cannot_reach_a_host_datagram_socket() {
    // The review's proof of concept: socket(AF_UNIX, SOCK_RAW) became a datagram socket that
    // could write to any path-addressed datagram socket and read the reply.
    let w = World::new();
    for kind in ["raw", "dgram"] {
        let sock = w.outside.join(format!("{kind}.sock"));
        let server = datagram_server(&sock);
        let r = run(
            &probe(&["datagram", sock.to_str().unwrap(), kind]),
            &w.policy(),
        )
        .await
        .unwrap();
        assert_eq!(code(&r), Some(3), "{kind}: {r:?}");
        assert!(
            r.stdout.text.contains(EPERM_TEXT),
            "{kind}: {}",
            r.stdout.text
        );
        let seen = server.join().unwrap();
        assert!(seen.is_empty(), "{kind}: the host socket received {seen:?}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_datagram_proof_of_concept_works_when_the_network_is_on() {
    // The control for the test above: the same child, the same socket, network on. If this does
    // not reach the server, the test above proves nothing.
    let w = World::new();
    let sock = w.outside.join("control.sock");
    let server = datagram_server(&sock);
    let r = run(
        &probe(&["datagram", sock.to_str().unwrap(), "raw"]),
        &w.policy().with_network(NetworkPolicy::On),
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert!(
        r.stdout.text.contains("reply-from-host"),
        "{}",
        r.stdout.text
    );
    let seen = server.join().unwrap();
    assert_eq!(seen, ["hello from inside the sandbox"]);
}

// ---- namespaces and the rest of the hardening list ------------------------------------------

const ENOSYS_TEXT: &str = "errno 38";
const NEW_FLAGS: [(&str, &str); 6] = [
    ("user", "10000000"),
    ("net", "40000000"),
    ("pid", "20000000"),
    ("mount", "00020000"),
    ("uts", "04000000"),
    ("ipc", "08000000"),
];

#[tokio::test(flavor = "multi_thread")]
async fn namespaces_cannot_be_created_or_entered() {
    let w = World::new();
    for net in [NetworkPolicy::Off, NetworkPolicy::On] {
        // unshare is denied outright: even unshare(0), which does nothing and succeeds without
        // the filter.
        for flags in ["0", "10000000", "40000000"] {
            let (c, text) = out(&w, net.clone(), &["unshare", flags]).await;
            assert_eq!(c, Some(3), "unshare {flags}: {text}");
            assert!(text.contains(EPERM_TEXT), "unshare {flags}: {text}");
        }
        // setns(-1, 0) answers EBADF (errno 9) when it reaches the kernel.
        let (_, text) = out(
            &w,
            net.clone(),
            &["raw", &libc::SYS_setns.to_string(), "-1", "0"],
        )
        .await;
        assert!(text.contains(EPERM_TEXT), "setns: {text}");
        // clone with any namespace flag is denied...
        for (name, flags) in NEW_FLAGS {
            let (c, text) = out(&w, net.clone(), &["clone", flags]).await;
            assert_eq!(c, Some(3), "clone CLONE_NEW{name}: {text}");
            assert!(text.contains(EPERM_TEXT), "clone CLONE_NEW{name}: {text}");
        }
        // ...and a plain clone, the fork that libc makes, is not.
        let (c, text) = out(&w, net.clone(), &["clone", "0"]).await;
        assert_eq!(
            (c, text.trim().starts_with("ret ")),
            (Some(0), true),
            "{text}"
        );
        // clone3 looks like a kernel without it, so that libc falls back to clone.
        let (c, text) = out(&w, net.clone(), &["raw", &libc::SYS_clone3.to_string()]).await;
        assert_eq!(c, Some(3));
        assert!(text.contains(ENOSYS_TEXT), "clone3: {text}");
        // Threads and processes still start, which needs that fallback.
        let (c, text) = out(&w, net.clone(), &["threads", "8"]).await;
        assert_eq!((c, text.trim()), (Some(0), "ok 56"));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_other_escape_syscalls_are_denied() {
    let w = World::new();
    let nr = |n: i64| n.to_string();
    // Each call answers something else when it reaches the kernel: pidfd_getfd(-1, -1, 0) EBADF,
    // kcmp(self, self, KCMP_VM) 0, and so on. EPERM is the filter.
    // `self` is the probe's own pid, which it can compare with itself.
    let pid = "self".to_string();
    let cases: Vec<(&str, Vec<String>)> = vec![
        (
            "pidfd_getfd",
            vec![
                nr(libc::SYS_pidfd_getfd),
                "-1".into(),
                "-1".into(),
                "0".into(),
            ],
        ),
        ("fsopen", vec![nr(libc::SYS_fsopen), "0".into(), "0".into()]),
        (
            "fsmount",
            vec![nr(libc::SYS_fsmount), "-1".into(), "0".into(), "0".into()],
        ),
        (
            "fspick",
            vec![nr(libc::SYS_fspick), "-1".into(), "0".into(), "0".into()],
        ),
        (
            "move_mount",
            vec![
                nr(libc::SYS_move_mount),
                "-1".into(),
                "0".into(),
                "-1".into(),
                "0".into(),
                "0".into(),
            ],
        ),
        (
            "open_tree",
            vec![nr(libc::SYS_open_tree), "-1".into(), "0".into(), "0".into()],
        ),
        (
            "mount_setattr",
            vec![
                nr(libc::SYS_mount_setattr),
                "-1".into(),
                "0".into(),
                "0".into(),
                "0".into(),
                "0".into(),
            ],
        ),
        (
            "open_by_handle_at",
            vec![
                nr(libc::SYS_open_by_handle_at),
                "-1".into(),
                "0".into(),
                "0".into(),
            ],
        ),
        (
            "kcmp",
            vec![
                nr(libc::SYS_kcmp),
                pid.clone(),
                pid,
                "1".into(),
                "0".into(),
                "0".into(),
            ],
        ),
    ];
    for (name, args) in cases {
        let mut argv_: Vec<&str> = vec!["raw"];
        argv_.extend(args.iter().map(String::as_str));
        for net in [
            NetworkPolicy::Off,
            NetworkPolicy::Loopback,
            NetworkPolicy::On,
        ] {
            if net == NetworkPolicy::Loopback
                && !hx_sandbox::capabilities().network_loopback.available
            {
                continue;
            }
            let (c, text) = out(&w, net.clone(), &argv_).await;
            assert_eq!(c, Some(3), "{name} {net:?}: {text}");
            assert!(text.contains(EPERM_TEXT), "{name} {net:?}: {text}");
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[tokio::test(flavor = "multi_thread")]
async fn x32_system_calls_are_denied() {
    // getpid through the x32 table: a kernel without x32 says ENOSYS, one with it answers with a
    // pid. Only the filter makes it EPERM.
    let w = World::new();
    let x32_getpid = (0x4000_0000_i64 | libc::SYS_getpid).to_string();
    for net in [NetworkPolicy::Off, NetworkPolicy::On] {
        let (c, text) = out(&w, net, &["raw", &x32_getpid]).await;
        assert_eq!(c, Some(3), "{text}");
        assert!(text.contains(EPERM_TEXT), "{text}");
    }
    let (c, text) = out(
        &w,
        NetworkPolicy::Off,
        &["raw", &libc::SYS_getpid.to_string()],
    )
    .await;
    assert_eq!(c, Some(0), "the native table still works: {text}");
}

#[tokio::test(flavor = "multi_thread")]
async fn capabilities_report_is_consistent_with_behaviour() {
    let caps = hx_sandbox::capabilities();
    assert_eq!(caps.platform, "linux");
    assert!(caps.os_version.is_some());
    assert!(caps.process_tree_kill.available);
    assert!(!caps.network_allowlist.available);
    // If it says fs is available a ro-only run must start; if not, it must be Unavailable.
    let w = World::new();
    let result = run(&probe(&["exit", "0"]), &w.policy()).await;
    match (caps.fs.available, result) {
        (true, Ok(r)) => assert_eq!(code(&r), Some(0)),
        (false, Err(e)) => assert_eq!(e.code(), "hx.sandbox.unavailable"),
        (a, other) => panic!("capabilities said fs.available={a} but run gave {other:?}"),
    }
}

// ---- spawn ----------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn spawn_streams_stdio_and_can_be_killed() {
    let w = World::new();
    let mut h = spawn(
        &argv(&["/bin/cat"]),
        &w.policy(),
        SpawnOptions::new().with_piped_stdin(),
    )
    .await
    .unwrap();
    let mut stdin = h.take_stdin().unwrap();
    let mut stdout = h.take_stdout().unwrap();
    {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stdin.write_all(b"ping").await.unwrap();
        let mut buf = [0u8; 4];
        stdout.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ping");
    }
    assert!(
        h.enforcement()
            .network
            .mechanisms
            .contains(&"seccomp".to_owned())
    );
    h.kill();
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::Signaled { signal: 9 });
}

#[tokio::test(flavor = "multi_thread")]
async fn spawn_passes_one_socket_to_the_child_under_the_same_number() {
    let w = World::new();
    let (parent_end, child_end) = std::os::unix::net::UnixStream::pair().unwrap();
    let fd = child_end.as_raw_fd();
    let mut h = spawn(
        &probe(&["fd", &fd.to_string()]),
        &w.policy(),
        SpawnOptions::new().with_inherit(child_end.into()),
    )
    .await
    .unwrap();
    let mut parent_end = parent_end;
    parent_end
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut greeting = [0u8; 16];
    parent_end.read_exact(&mut greeting).unwrap();
    assert_eq!(&greeting, b"hello-from-child");
    parent_end.write_all(b"howdy").unwrap();
    let mut out = String::new();
    {
        use tokio::io::AsyncReadExt;
        h.take_stdout()
            .unwrap()
            .read_to_string(&mut out)
            .await
            .unwrap();
    }
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::Exited { code: 0 });
    assert!(out.contains("reply howdy"), "{out}");
}

#[tokio::test(flavor = "multi_thread")]
async fn spawn_reports_a_missing_program_as_an_error() {
    let w = World::new();
    let r = spawn(
        &argv(&["/nonexistent/prog"]),
        &w.policy(),
        SpawnOptions::new(),
    )
    .await;
    assert!(matches!(r, Err(Error::Spawn(_))), "{r:?}");
    assert_eq!(r.unwrap_err().code(), "hx.sandbox.spawn_failed");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_spawn_watchdog_enforces_the_lifetime() {
    let w = World::new();
    let mut p = w.policy();
    p.timeout_ms = 400;
    p.kill_grace_ms = 200;
    let mut h = spawn(&probe(&["sleep", "300"]), &p, SpawnOptions::new())
        .await
        .unwrap();
    let started = Instant::now();
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(8));
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_a_handle_kills_the_tree() {
    let w = World::new();
    let base = w.scratch.join("drop");
    let beats = beat_files(&base, &["top", "mid", "leaf"]);
    let h = spawn(
        &probe(&["tree", base.to_str().unwrap()]),
        &w.policy(),
        SpawnOptions::new(),
    )
    .await
    .unwrap();
    for _ in 0..100 {
        if all_started(&beats) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(all_started(&beats));
    drop(h);
    assert!(
        heartbeats_stopped(&beats),
        "the tree outlived the dropped handle"
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn spawn_output_streams_are_capped_too() {
    let w = World::new();
    let mut p = w.policy();
    p.output_cap_bytes = 100;
    let mut h = spawn(&probe(&["flood", "100000"]), &p, SpawnOptions::new())
        .await
        .unwrap();
    let mut out = Vec::new();
    {
        use tokio::io::AsyncReadExt;
        h.take_stdout()
            .unwrap()
            .read_to_end(&mut out)
            .await
            .unwrap();
    }
    assert_eq!(out.len(), 100);
    let stats = h.stdout_stats();
    assert!(stats.truncated());
    assert_eq!(stats.total_bytes(), 100_000);
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::Exited { code: 0 });
}

#[tokio::test(flavor = "multi_thread")]
async fn descriptors_leaked_by_the_host_do_not_reach_the_child() {
    // Simulate a C library that opened a descriptor without close-on-exec: clear the flag on
    // purpose. The sandbox must mark it close-on-exec before the program starts.
    let w = World::new();
    let leaked = std::fs::File::open(w.work.join("source.txt")).unwrap();
    let leaked_fd = leaked.as_raw_fd();
    // SAFETY: fcntl on a descriptor this test owns and keeps open for the whole test.
    let flags = unsafe { libc::fcntl(leaked_fd, libc::F_GETFD) };
    assert!(flags >= 0);
    // SAFETY: as above.
    assert_eq!(
        unsafe { libc::fcntl(leaked_fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) },
        0
    );

    let mut policy = w.policy();
    policy.ro_paths.push("/proc".into());
    let r = run(&probe(&["fds"]), &policy).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let seen: Vec<(i32, &str)> = r
        .stdout
        .text
        .lines()
        .filter_map(|l| l.split_once(' '))
        .map(|(n, target)| (n.parse().unwrap(), target))
        .collect();
    for std_fd in 0..=2 {
        assert!(seen.iter().any(|(n, _)| *n == std_fd), "{seen:?}");
    }
    // Judge by what the descriptor points at: the child's own directory listing may reuse the
    // number the host leaked.
    assert!(
        !seen
            .iter()
            .any(|(_, target)| target.ends_with("source.txt")),
        "descriptor {leaked_fd} leaked into the sandbox: {seen:?}"
    );
    drop(leaked);
}

// ---- ending the whole tree, setsid escapees included -----------------------------------------

/// Whatever ends the tree on this host: a PID namespace, a cgroup, or a subreaper. The tests
/// below do not care which; the report and the capabilities have to name it, and the escapee
/// has to die. `src/platform/linux/tree/tests.rs` forces each mechanism by name.
fn tree_mechanism() -> String {
    let caps = hx_sandbox::capabilities();
    assert!(
        caps.process_tree_kill.available,
        "no mechanism ends a setsid escapee here: {}",
        caps.process_tree_kill.detail
    );
    caps.process_tree_kill.mechanism.unwrap()
}

fn assert_report_names(r: &hx_sandbox::RunResult) {
    let mechanism = tree_mechanism();
    let process = &r.enforcement.process;
    assert_eq!(process.status, Status::Enforced, "{process:?}");
    let named = ["pid-namespace", "cgroup-kill", "subreaper"]
        .into_iter()
        .filter(|m| process.mechanisms.contains(&(*m).to_owned()))
        .collect::<Vec<_>>();
    assert_eq!(named.len(), 1, "exactly one tree mechanism: {process:?}");
    assert!(
        mechanism.starts_with(named[0]),
        "capabilities say {mechanism}, the run says {named:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_grandchild_that_calls_setsid_dies_on_timeout() {
    let w = World::new();
    let base = w.scratch.join("esc");
    let beats = beat_files(&base, &["top", "escaped"]);
    let mut p = w.policy();
    p.timeout_ms = 5_000;
    p.kill_grace_ms = 200;
    let r = run(&probe(&["escape", base.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert_report_names(&r);
    assert!(
        all_started(&beats),
        "the escaping grandchild should have started"
    );
    assert!(
        heartbeats_stopped(&beats),
        "a process that left the group with setsid survived"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_setsid_escapee_does_not_outlive_a_normal_exit_either() {
    let w = World::new();
    let beat = w.scratch.join("late.beat");
    // The leader starts a session-leading background process and exits at once.
    let script = format!(
        "setsid {probe} heartbeat {beat} </dev/null >/dev/null 2>&1 & sleep 0.3; echo done",
        probe = probe_path().display(),
        beat = beat.display()
    );
    let mut p = w.policy();
    p.ro_paths.push("/usr".into());
    let r = run(&argv(&["/bin/sh", "-c", &script]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_report_names(&r);
    assert!(
        heartbeats_stopped(std::slice::from_ref(&beat)),
        "the setsid process survived the leader's exit"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_setsid_escapee_dies_when_a_spawned_child_is_killed() {
    let w = World::new();
    let base = w.scratch.join("spawned");
    let beats = beat_files(&base, &["top", "escaped"]);
    let mut h = spawn(
        &probe(&["escape", base.to_str().unwrap()]),
        &w.policy(),
        SpawnOptions::new(),
    )
    .await
    .unwrap();
    for _ in 0..200 {
        if all_started(&beats) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(all_started(&beats));
    h.kill();
    assert_eq!(h.wait().await.unwrap(), ExitOutcome::Signaled { signal: 9 });
    assert!(
        heartbeats_stopped(&beats),
        "the escapee outlived the killed child"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_capability_is_claimed_only_with_a_mechanism_behind_it() {
    let caps = hx_sandbox::capabilities();
    let advertised = caps
        .capability_strings()
        .contains(&"sandbox.process_tree_kill".to_owned());
    assert_eq!(advertised, caps.process_tree_kill.available);
    let mechanism = caps.process_tree_kill.mechanism.as_deref().unwrap_or("");
    if caps.process_tree_kill.available {
        assert!(
            ["pid-namespace", "cgroup-kill", "subreaper"]
                .iter()
                .any(|m| mechanism.starts_with(m)),
            "{mechanism}"
        );
    } else {
        // Only the process group is left, and the capability says so by not being claimed.
        assert_eq!(mechanism, "setsid+killpg");
    }
}

// ---- resource limits ------------------------------------------------------------------------

fn limited(
    w: &World,
    f: impl FnOnce(&mut hx_sandbox::ResourceLimits),
) -> hx_sandbox::SandboxPolicy {
    let mut p = w.policy();
    f(&mut p.resources);
    p
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fork_bomb_is_capped_and_a_control_is_not() {
    let w = World::new();
    let capped = limited(&w, |r| r.max_processes = Some(20));
    let r = run(&probe(&["forkbomb", "200"]), &capped).await.unwrap();
    if r.enforcement
        .process
        .detail
        .as_deref()
        .is_some_and(|d| d.contains("process count NOT limited"))
    {
        // uid 0 is exempt from RLIMIT_NPROC and the report says so. The cap is exercised when the
        // suite runs as an ordinary user: setpriv --reuid=65534 --regid=65534 --clear-groups <bin>.
        eprintln!("SKIPPED: running as uid 0, which RLIMIT_NPROC does not bind");
        return;
    }
    assert_eq!(code(&r), Some(0), "{r:?}");
    let started: usize = r
        .stdout
        .text
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    assert!(
        started < 200,
        "the limit did not stop the bomb: {}",
        r.stdout.text
    );
    assert!(
        r.stdout.text.contains("Resource temporarily unavailable"),
        "{}",
        r.stdout.text
    );

    let free = limited(&w, |r| r.max_processes = None);
    let r = run(&probe(&["forkbomb", "200"]), &free).await.unwrap();
    assert!(
        r.stdout.text.starts_with("started 200"),
        "control must start them all: {}",
        r.stdout.text
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_oversized_file_write_fails() {
    let w = World::new();
    let target = w.scratch.join("big.bin");
    let capped = limited(&w, |r| r.max_file_bytes = Some(1 << 20));
    let r = run(
        &probe(&["bigwrite", target.to_str().unwrap(), &(4 << 20).to_string()]),
        &capped,
    )
    .await
    .unwrap();
    // Either the write returns EFBIG (exit 3) or SIGXFSZ ends the process (signal 25).
    assert!(
        code(&r) == Some(3) || matches!(r.exit, ExitOutcome::Signaled { signal: 25 }),
        "{r:?}"
    );
    assert!(std::fs::metadata(&target).unwrap().len() <= 1 << 20);

    let free = limited(&w, |r| r.max_file_bytes = None);
    let r = run(
        &probe(&["bigwrite", target.to_str().unwrap(), &(4 << 20).to_string()]),
        &free,
    )
    .await
    .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(std::fs::metadata(&target).unwrap().len(), 4 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_memory_limit_stops_a_large_allocation() {
    let w = World::new();
    let capped = limited(&w, |r| r.memory_bytes = Some(256 << 20));
    let r = run(&probe(&["alloc", "1024"]), &capped).await.unwrap();
    assert_eq!(
        code(&r),
        Some(3),
        "a 1 GiB allocation must fail under a 256 MiB limit: {r:?}"
    );
    let r = run(&probe(&["alloc", "64"]), &capped).await.unwrap();
    assert_eq!(code(&r), Some(0), "a small allocation still works: {r:?}");
    let free = limited(&w, |r| r.memory_bytes = None);
    let r = run(&probe(&["alloc", "1024"]), &free).await.unwrap();
    assert_eq!(
        code(&r),
        Some(0),
        "control: unlimited memory allows it: {r:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_cpu_limit_ends_a_spinner_before_the_wall_clock_timeout() {
    let w = World::new();
    let mut p = limited(&w, |r| r.cpu = hx_sandbox::CpuLimit::Seconds(1));
    p.timeout_ms = 60_000;
    let started = Instant::now();
    let r = run(&probe(&["spin"]), &p).await.unwrap();
    // SIGXCPU (24) at the soft limit, SIGKILL (9) at the hard one.
    assert!(
        matches!(r.exit, ExitOutcome::Signaled { signal: 24 | 9 }),
        "{r:?}"
    );
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "took {:?}",
        started.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_cpu_limit_defaults_to_the_timeout() {
    let w = World::new();
    let mut p = w.policy();
    p.timeout_ms = 2_000;
    let resolved = p.resolve().unwrap();
    assert_eq!(resolved.resources.cpu_seconds, Some(2));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_report_states_the_limits_the_child_actually_has() {
    let w = World::new();
    let mut p = limited(&w, |r| {
        r.memory_bytes = Some(512 << 20);
        r.max_file_bytes = Some(8 << 20);
        r.cpu = hx_sandbox::CpuLimit::Seconds(77);
    });
    p.ro_paths.push("/proc".into());
    let r = run(&probe(&["limits"]), &p).await.unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    let seen = &r.stdout.text;
    assert!(
        seen.contains("Max address space") && seen.contains("536870912"),
        "{seen}"
    );
    assert!(
        seen.contains("Max file size") && seen.contains("8388608"),
        "{seen}"
    );
    assert!(
        seen.contains("Max cpu time") && seen.contains(" 77 "),
        "{seen}"
    );
    let core = seen
        .lines()
        .find(|l| l.starts_with("Max core file size"))
        .unwrap();
    assert!(
        core.split_whitespace().skip(4).take(2).all(|v| v == "0"),
        "core dumps must be off: {core}"
    );
    let detail = r.enforcement.process.detail.as_deref().unwrap();
    assert!(
        r.enforcement
            .process
            .mechanisms
            .contains(&"rlimits".to_owned())
    );
    assert!(
        detail.contains("as=536870912")
            && detail.contains("fsize=8388608")
            && detail.contains("cpu=77s")
            && detail.contains("core=0"),
        "{detail}"
    );
}
