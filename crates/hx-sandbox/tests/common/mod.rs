//! Shared helpers for the integration tests: a work tree, a scratch dir, and the probe program.
#![allow(dead_code, reason = "each test file uses a different subset")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failing unwrap is a failing test"
)]

use std::path::{Path, PathBuf};

use hx_sandbox::{ExitOutcome, RunResult, SandboxPolicy};

/// A scratch universe: `work` (will be read-only), `scratch` (read-write), `outside` (granted
/// to nobody), all under one temp dir.
pub struct World {
    pub _tmp: tempfile::TempDir,
    pub work: PathBuf,
    pub scratch: PathBuf,
    pub outside: PathBuf,
}

impl World {
    pub fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let (work, scratch, outside) = (
            root.join("work"),
            root.join("scratch"),
            root.join("outside"),
        );
        for dir in [&work, &scratch, &outside] {
            std::fs::create_dir(dir).unwrap();
        }
        std::fs::write(work.join("source.txt"), "workspace file").unwrap();
        std::fs::write(outside.join("secret.txt"), "top secret").unwrap();
        Self {
            _tmp: tmp,
            work,
            scratch,
            outside,
        }
    }

    /// A policy that lets the probe start: system libraries, the probe's directory and the
    /// work tree read-only, the scratch dir writable, network off.
    pub fn policy(&self) -> SandboxPolicy {
        let mut ro = SandboxPolicy::system_read_paths();
        ro.push(probe_path().parent().unwrap().to_path_buf());
        ro.push(self.work.clone());
        let mut p = SandboxPolicy::new(&self.work)
            .with_ro(ro)
            .with_rw([self.scratch.clone()]);
        p.timeout_ms = 30_000;
        p.env_set
            .insert("PATH".to_owned(), "/usr/bin:/bin".to_owned());
        p
    }
}

/// The compiled `examples/probe` binary. `cargo test -p hx-sandbox` builds it.
pub fn probe_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    // target/<profile>/deps/<test> -> target/<profile>/examples/probe
    let p = exe
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("examples")
        .join("probe");
    assert!(
        p.exists(),
        "{} is missing; run `cargo build -p hx-sandbox --examples` first",
        p.display()
    );
    p
}

/// `[probe, args...]` as an argv.
pub fn probe(args: &[&str]) -> Vec<String> {
    std::iter::once(probe_path().to_string_lossy().into_owned())
        .chain(args.iter().map(|a| (*a).to_owned()))
        .collect()
}

pub fn argv(args: &[&str]) -> Vec<String> {
    args.iter().map(|a| (*a).to_owned()).collect()
}

pub fn code(r: &RunResult) -> Option<i32> {
    match r.exit {
        ExitOutcome::Exited { code } => Some(code),
        _ => None,
    }
}

/// Whether process `pid` is gone or a zombie (zombies are dead; nobody reaps orphans in a
/// container without an init).
#[cfg(target_os = "linux")]
pub fn is_dead(pid: u32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Err(_) => true,
        Ok(stat) => stat
            .rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
    }
}

/// Whether process `pid` is gone, asked of `kill -0`. A zombie still answers, so a caller
/// on macOS must give the tree a moment to be reaped.
#[cfg(not(target_os = "linux"))]
pub fn is_dead(pid: u32) -> bool {
    std::process::Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .output()
        .is_ok_and(|o| !o.status.success())
}

pub fn read_pids(path: &Path) -> Vec<u32> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect()
}

/// Whether this host can enforce the filesystem dimension; tests that need Landlock skip
/// (loudly) when it cannot.
pub fn fs_available() -> bool {
    let caps = hx_sandbox::capabilities();
    if !caps.fs.available {
        eprintln!(
            "SKIPPED: filesystem confinement unavailable here: {}",
            caps.fs.detail
        );
    }
    caps.fs.available
}
