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
async fn a_host_allowlist_fails_closed_and_degrades_only_when_allowed() {
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
    let mut p = w.policy().with_network(al);
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
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert_eq!(r.enforcement.network.status, Status::Degraded);
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
    let pidfile = w.scratch.join("pids");
    let mut p = w.policy();
    p.timeout_ms = 1_000;
    p.kill_grace_ms = 200;
    let started = Instant::now();
    let r = run(&probe(&["tree", pidfile.to_str().unwrap()]), &p)
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::TimedOut, "{r:?}");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "took {:?}",
        started.elapsed()
    );
    let pids = read_pids(&pidfile);
    assert_eq!(
        pids.len(),
        3,
        "tree, mid and leaf should all have started: {pids:?}"
    );
    for pid in pids {
        assert!(is_dead(pid), "process {pid} survived the timeout");
    }
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
    let pidfile = w.scratch.join("bg.pid");
    let script = format!("sleep 300 & echo $! > {}; echo started", pidfile.display());
    let started = Instant::now();
    let r = run(&argv(&["/bin/sh", "-c", &script]), &w.policy())
        .await
        .unwrap();
    assert_eq!(code(&r), Some(0), "{r:?}");
    assert!(r.stdout.text.contains("started"));
    // The sleeper held the output pipes open; run() must still return promptly.
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "took {:?}",
        started.elapsed()
    );
    let pid: u32 = std::fs::read_to_string(&pidfile)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(is_dead(pid), "the background sleeper survived");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_child_leads_its_own_session_and_group() {
    let w = World::new();
    let r = run(&probe(&["ids"]), &w.policy()).await.unwrap();
    let ids: Vec<i64> = r
        .stdout
        .text
        .split_whitespace()
        .map(|s| s.parse().unwrap())
        .collect();
    assert_eq!(ids[0], ids[1], "pgid should equal pid: {ids:?}");
    assert_eq!(ids[0], ids[2], "sid should equal pid: {ids:?}");
    assert_ne!(ids[0], i64::from(std::process::id()));
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
    let r = run(&argv(&["/bin/sh", "-c", "kill -9 $$"]), &w.policy())
        .await
        .unwrap();
    assert_eq!(r.exit, ExitOutcome::Signaled { signal: 9 });
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
    let pidfile = w.scratch.join("cancel.pids");
    let pf = pidfile.clone();
    let policy = w.policy();
    let args = probe(&["tree", pf.to_str().unwrap()]);
    let task = tokio::spawn(async move { run(&args, &policy).await });
    for _ in 0..100 {
        if read_pids(&pidfile).len() == 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let pids = read_pids(&pidfile);
    assert_eq!(pids.len(), 3, "{pids:?}");
    task.abort();
    let _ = task.await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    for pid in pids {
        assert!(is_dead(pid), "{pid} outlived the cancelled run");
    }
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
    let pidfile = w.scratch.join("drop.pids");
    let h = spawn(
        &probe(&["tree", pidfile.to_str().unwrap()]),
        &w.policy(),
        SpawnOptions::new(),
    )
    .await
    .unwrap();
    for _ in 0..100 {
        if read_pids(&pidfile).len() == 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let pids = read_pids(&pidfile);
    assert_eq!(pids.len(), 3);
    drop(h);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(pids.into_iter().all(is_dead));
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
