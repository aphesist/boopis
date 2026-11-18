//! Running a child process with an allowlisted environment, a timeout and an
//! output cap (`docs/STANDARDS.md` section 5). A local stand-in for
//! `hx-sandbox::process`; fold it into that module when the crates meet.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};

/// What a finished child printed.
#[derive(Debug)]
pub(crate) struct Output {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
    /// The stdout cap was hit and the child was stopped.
    pub capped: bool,
}

/// Environment variables passed through to the child; nothing else is.
const PASS_THROUGH: &[&str] = &[
    "PATH",
    "SYSTEMROOT",
    "TMPDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
];

/// Builds `program args...` with a cleared environment plus the allowlist.
pub(crate) fn command(program: &str, args: &[&str], extra_env: &[(&str, &str)]) -> Command {
    let mut c = Command::new(program);
    c.args(args).env_clear();
    for k in PASS_THROUGH {
        if let Some(v) = std::env::var_os(k) {
            c.env(k, v);
        }
    }
    for (k, v) in extra_env {
        c.env(k, v);
    }
    c
}

/// Runs `cmd`, killing it after `timeout` or once stdout passes `cap` bytes.
///
/// # Errors
/// [`Error::GitFailed`] when the program cannot start, [`Error::Timeout`] on timeout.
pub(crate) fn run(mut cmd: Command, timeout: Duration, cap: usize) -> Result<Output> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| Error::GitFailed(format!("cannot start git: {e}")))?;
    let (Some(mut out), Some(mut err)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(Error::GitFailed("no pipes".into()));
    };
    let over_cap = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&over_cap);
    let reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut out).take(cap as u64 + 1).read_to_end(&mut buf);
        if buf.len() > cap {
            flag.store(true, Ordering::Relaxed);
        }
        buf
    });
    let err_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut err).take(16 * 1024).read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {}
            Err(e) => return Err(Error::GitFailed(e.to_string())),
        }
        if Instant::now() >= deadline || over_cap.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(2));
    };
    let stdout = reader.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned();
    let capped = stdout.len() > cap;
    match status {
        Some(st) => Ok(Output {
            success: st.success(),
            stdout: truncated(stdout, cap),
            stderr,
            capped,
        }),
        None if capped => Ok(Output {
            success: true,
            stdout: truncated(stdout, cap),
            stderr,
            capped,
        }),
        None => Err(Error::Timeout),
    }
}

fn truncated(mut v: Vec<u8>, cap: usize) -> Vec<u8> {
    v.truncate(cap);
    v
}
