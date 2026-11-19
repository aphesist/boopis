//! The two mechanisms that end a tree without a PID namespace, run for real: each test asks
//! `prepare_with` for the mechanism by hiding the better ones from a copy of the probe, spawns a
//! shell whose grandchild leaves the process group with `setsid`, and looks at what survives.

use std::path::Path;
use std::time::{Duration, Instant};

use super::super::plan::TreeMethod;
use super::super::prepare_with;
use super::super::probe::{self, NsAccess, Probe};
use super::*;
use crate::error::{Dimension, Error};
use crate::platform::unix::TreeKiller;
use crate::platform::{Child, Launch, LaunchSpec, StdinMode};
use crate::policy::SandboxPolicy;
use crate::report::{ExitOutcome, Status};

#[test]
fn mountinfo_fields_are_unescaped() {
    assert_eq!(
        unescape_mountinfo("/sys/fs/cgroup/with\\040space"),
        PathBuf::from("/sys/fs/cgroup/with space")
    );
    assert_eq!(
        unescape_mountinfo("/plain/path"),
        PathBuf::from("/plain/path")
    );
    // an incomplete escape is kept as written
    assert_eq!(unescape_mountinfo("/a\\04"), PathBuf::from("/a\\04"));
}

/// Which mechanism a test forces. The probe is copied and the better mechanisms are hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Forced {
    Cgroup,
    Subreaper,
}

impl Forced {
    fn probe(self) -> Option<Probe> {
        let mut p = probe::get().clone();
        p.pidns = NsAccess::None;
        match self {
            Forced::Cgroup if p.cgroup.is_err() => {
                eprintln!("SKIPPED: no usable cgroup here: {:?}", p.cgroup);
                return None;
            }
            Forced::Subreaper => {
                if p.subreaper.is_err() {
                    eprintln!("SKIPPED: no subreaper here: {:?}", p.subreaper);
                    return None;
                }
                p.cgroup = Err("hidden by the test".to_owned());
            }
            Forced::Cgroup => {}
        }
        Some(p)
    }

    fn mechanism(self) -> &'static str {
        match self {
            Forced::Cgroup => "cgroup-kill",
            Forced::Subreaper => "subreaper",
        }
    }
}

struct Run {
    child: Child,
    killer: TreeKiller,
    /// The directory the shell works in (and writes its pid files to).
    dir: PathBuf,
    _tmp: tempfile::TempDir,
}

fn policy(dir: &Path) -> SandboxPolicy {
    let mut ro = SandboxPolicy::system_read_paths();
    ro.extend(["/usr", "/bin"].map(PathBuf::from));
    let mut p = SandboxPolicy::new(dir)
        .with_ro(ro)
        .with_rw([dir.to_path_buf()]);
    p.env_set
        .insert("PATH".to_owned(), "/usr/bin:/bin".to_owned());
    // Only the process tree is under test; the host may lack Landlock or seccomp.
    p.degraded.fs = true;
    p.degraded.network = true;
    p
}

/// Starts `/bin/sh -c script(dir)` under the forced mechanism, or `None` (skipped) when this host
/// lacks it.
fn start(forced: Forced, script: impl FnOnce(&Path) -> String) -> Option<Run> {
    let probe = forced.probe()?;
    let tmp = tempfile::tempdir().unwrap();
    let dir = std::fs::canonicalize(tmp.path()).unwrap();
    let resolved = policy(&dir).resolve().unwrap();
    let prepared = prepare_with(&probe, &resolved).unwrap();
    let process = &prepared.enforcement().process;
    assert_eq!(process.status, Status::Enforced, "{process:?}");
    assert!(
        process.mechanisms.contains(&forced.mechanism().to_owned()),
        "{process:?}"
    );
    let args = ["-c".to_owned(), script(&dir)];
    let launch = prepared
        .spawn(LaunchSpec {
            program: Path::new("/bin/sh"),
            args: &args,
            stdin: StdinMode::Null,
            inherit: None,
        })
        .unwrap();
    let Launch::Started(child) = launch else {
        panic!("the shell did not start: {launch:?}");
    };
    let killer = child.killer();
    Some(Run {
        child,
        killer,
        dir,
        _tmp: tmp,
    })
}

fn pid_from(file: &Path) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(pid) = std::fs::read_to_string(file)
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            return pid;
        }
        assert!(
            Instant::now() < deadline,
            "{} never appeared",
            file.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The process group and session ids of `pid`, from `/proc/<pid>/stat` (fields 5 and 6).
fn group_and_session(pid: i32) -> (i32, i32) {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let after_comm = stat.rsplit_once(')').unwrap().1;
    let fields: Vec<i32> = after_comm
        .split_whitespace()
        .skip(2)
        .take(2)
        .map(|f| f.parse().unwrap())
        .collect();
    (fields[0], fields[1])
}

/// Gone, or a zombie nobody reaps (a container often has no init to do it).
fn is_dead(pid: i32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Err(_) => true,
        Ok(stat) => stat
            .rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
    }
}

fn dies_soon(pid: i32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if is_dead(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// A grandchild in a session of its own writes its pid (atomically) and sleeps; `then` is what
/// the leader does after that.
fn escaping(dir: &Path, then: &str) -> String {
    let p = dir.join("gc.pid");
    format!(
        "setsid sh -c 'echo $$ > {p}.tmp; mv {p}.tmp {p}; exec sleep 300' & \
         while [ ! -s {p} ]; do sleep 0.02; done; {then}",
        p = p.display()
    )
}

const BOTH: [Forced; 2] = [Forced::Cgroup, Forced::Subreaper];

#[tokio::test(flavor = "multi_thread")]
async fn a_kill_reaches_a_grandchild_that_called_setsid() {
    for forced in BOTH {
        let Some(mut run) = start(forced, |d| escaping(d, "sleep 300")) else {
            continue;
        };
        let grandchild = pid_from(&run.dir.join("gc.pid"));
        assert!(!is_dead(grandchild), "{forced:?}: it should be running");
        // The process group is not enough: the grandchild is in another session.
        let (pgid, sid) = group_and_session(grandchild);
        assert_eq!(pgid, grandchild, "{forced:?}: its own group");
        assert_eq!(sid, grandchild, "{forced:?}: its own session");
        run.killer.kill();
        let exit = run.child.wait().await.unwrap();
        assert_eq!(exit, ExitOutcome::Signaled { signal: 9 }, "{forced:?}");
        assert!(
            dies_soon(grandchild),
            "{forced:?}: the setsid grandchild survived"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_setsid_grandchild_does_not_outlive_the_leader() {
    for forced in BOTH {
        let Some(mut run) = start(forced, |d| escaping(d, "exit 7")) else {
            continue;
        };
        let grandchild = pid_from(&run.dir.join("gc.pid"));
        let exit = run.child.wait().await.unwrap();
        // The exit status of the program is what the host sees, not the supervisor's own.
        assert_eq!(exit, ExitOutcome::Exited { code: 7 }, "{forced:?}");
        if forced == Forced::Subreaper {
            // The supervisor does not leave until everything it inherited is gone.
            assert!(
                is_dead(grandchild),
                "{forced:?}: left running by the supervisor"
            );
        }
        // What `run` and `Handle::wait` do once the leader is gone.
        run.killer.kill();
        assert!(
            dies_soon(grandchild),
            "{forced:?}: the setsid grandchild survived"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_polite_stop_reaches_the_program_and_spares_the_supervisor() {
    for forced in BOTH {
        let script = |d: &Path| {
            format!(
                "trap 'exit 5' TERM; : > {r}; while :; do sleep 0.02; done",
                r = d.join("ready").display()
            )
        };
        let Some(mut run) = start(forced, script) else {
            continue;
        };
        pid_free_wait(&run.dir.join("ready"));
        assert!(run.killer.terminate());
        let exit = run.child.wait().await.unwrap();
        // Had the supervisor died of the SIGTERM it would read as `Signaled { signal: 15 }`.
        assert_eq!(exit, ExitOutcome::Exited { code: 5 }, "{forced:?}");
    }
}

fn pid_free_wait(file: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !file.exists() {
        assert!(
            Instant::now() < deadline,
            "{} never appeared",
            file.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_double_forked_orphan_is_found_by_the_supervisor() {
    // The grandchild is orphaned twice over: its parent exits, and it left the session.
    let Some(mut run) = start(Forced::Subreaper, |d| {
        let p = d.join("gc.pid");
        format!(
            "(setsid sh -c 'echo $$ > {p}.tmp; mv {p}.tmp {p}; exec sleep 300' &) ; \
             while [ ! -s {p} ]; do sleep 0.02; done; exit 0",
            p = p.display()
        )
    }) else {
        return;
    };
    let grandchild = pid_from(&run.dir.join("gc.pid"));
    let exit = run.child.wait().await.unwrap();
    assert_eq!(exit, ExitOutcome::Exited { code: 0 });
    assert!(is_dead(grandchild), "the orphan was left running");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_cgroup_is_removed_once_the_child_is_gone() {
    let Some(mut run) = start(Forced::Cgroup, |_| "exit 0".to_owned()) else {
        return;
    };
    let base = probe::get().cgroup.clone().unwrap();
    let ours = |base: &Path| {
        std::fs::read_dir(base)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(&format!("{CGROUP_PREFIX}{}-", std::process::id()))
            })
            .count()
    };
    let before = ours(&base);
    assert!(before >= 1, "the run should have a cgroup");
    run.child.wait().await.unwrap();
    run.killer.kill();
    drop(run);
    let deadline = Instant::now() + Duration::from_secs(5);
    // Other tests of this binary have runs of their own; this one's must be gone.
    while ours(&base) >= before && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(ours(&base) < before, "the cgroup directory was left behind");
}

#[test]
fn with_no_mechanism_the_process_dimension_is_unavailable_unless_degraded() {
    let mut probe = probe::get().clone();
    probe.pidns = NsAccess::None;
    probe.cgroup = Err("none here".to_owned());
    probe.subreaper = Err("none here either".to_owned());
    let dir = tempfile::tempdir().unwrap();
    let work = std::fs::canonicalize(dir.path()).unwrap();
    let mut policy = policy(&work);
    let resolved = policy.resolve().unwrap();
    let err = prepare_with(&probe, &resolved).err().unwrap();
    assert!(
        matches!(
            err,
            Error::Unavailable {
                dimension: Dimension::Process,
                ..
            }
        ),
        "{err}"
    );
    policy.degraded.process = true;
    let prepared = prepare_with(&probe, &policy.resolve().unwrap()).unwrap();
    let report = &prepared.enforcement().process;
    assert_eq!(report.status, Status::Degraded);
    assert!(
        !report
            .mechanisms
            .iter()
            .any(|m| ["pid-namespace", "cgroup-kill", "subreaper"].contains(&m.as_str())),
        "{report:?}"
    );
    assert!(
        report.detail.as_deref().unwrap().contains("NOT ENFORCED"),
        "{report:?}"
    );
    assert_eq!(prepared.tree, TreeMethod::GroupOnly);
}
