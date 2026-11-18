//! Running and spawning sandboxed children: the generic layer over the platform backends.
//!
//! This is the "process spawn" shared module of STANDARDS section 9: allowlisted environment,
//! group kill, timeout, output cap. [`run`] is the one-shot form for gate commands; [`spawn`]
//! is the long-lived form for the exec kernel.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::capture::{CappedReader, Collector, StreamStats, collect};
use crate::error::{Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::platform::{self, BoxRead, BoxWrite, Child, Launch, LaunchSpec, StdinMode, TreeKiller};
use crate::policy::SandboxPolicy;
use crate::report::{Captured, Enforcement, ExitOutcome, RunResult};

pub use crate::platform::InheritedHandle;

/// A readable stream of a spawned child.
pub type ChildReader = BoxRead;
/// A writable stream of a spawned child.
pub type ChildWriter = BoxWrite;

/// How long, at most, [`run`] waits for output to finish after the process tree is gone. A
/// process that escaped the group can hold the pipes open; the output read so far is returned.
const DRAIN_GRACE: Duration = Duration::from_millis(500);

/// Extra wiring for [`spawn`].
#[derive(Debug, Default)]
pub struct SpawnOptions {
    /// Give the child a pipe on stdin (otherwise stdin is the null device).
    pub piped_stdin: bool,
    /// One extra descriptor (Unix) or handle (Windows) for the child: the exec kernel's RPC
    /// socket or pipe. The child sees it under the **same number or value** it has in this
    /// process, so read `as_raw_fd()` / `as_raw_handle()` before passing it and tell the
    /// child that number through `argv` or `env_set`. Unix numbers below 3 are rejected.
    ///
    /// The object bypasses the filesystem and network confinement by design: it is a channel
    /// the host opened on purpose.
    pub inherit: Option<InheritedHandle>,
}

impl SpawnOptions {
    /// No stdin pipe, no extra handle.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Gives the child a stdin pipe.
    #[must_use]
    pub fn with_piped_stdin(mut self) -> Self {
        self.piped_stdin = true;
        self
    }

    /// Passes one descriptor or handle to the child.
    #[must_use]
    pub fn with_inherit(mut self, handle: InheritedHandle) -> Self {
        self.inherit = Some(handle);
        self
    }
}

#[allow(
    clippy::large_enum_variant,
    reason = "one short-lived value per spawn; boxing would add an allocation for nothing"
)]
enum Begun {
    Started(Child, Enforcement),
    Failed(String, Enforcement),
}

async fn begin(
    argv: &[String],
    policy: &SandboxPolicy,
    stdin: StdinMode,
    inherit: Option<InheritedHandle>,
) -> Result<Begun> {
    let Some(argv0) = argv.first() else {
        return Err(Error::invalid("argv is empty"));
    };
    let policy = policy.clone();
    // Resolving paths and building the sandbox touch the file system, so they stay off the
    // executor threads.
    let (resolved, prepared) =
        tokio::task::spawn_blocking(move || -> Result<(ResolvedPolicy, platform::Prepared)> {
            let resolved = policy.resolve()?;
            let prepared = platform::prepare(&resolved)?;
            Ok((resolved, prepared))
        })
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e)))??;

    let enforcement = prepared.enforcement().clone();
    let program = match crate::program::resolve(argv0, &resolved) {
        Ok(p) => p,
        Err(reason) => return Ok(Begun::Failed(reason, enforcement)),
    };
    let launch = prepared.spawn(LaunchSpec {
        program: &program,
        args: &argv[1..],
        stdin,
        inherit,
    })?;
    Ok(match launch {
        Launch::Started(child) => Begun::Started(child, enforcement),
        Launch::Failed(reason) => {
            Begun::Failed(with_hint(reason, &program, &resolved), enforcement)
        }
    })
}

/// A failed start inside a confined filesystem is most often a program outside the grants.
fn with_hint(reason: String, program: &std::path::Path, policy: &ResolvedPolicy) -> String {
    let covered = policy
        .ro
        .iter()
        .chain(&policy.rw)
        .any(|g| program.starts_with(&g.path));
    if covered {
        reason
    } else {
        format!(
            "{reason} (note: {} is not inside ro_paths or rw_paths)",
            program.display()
        )
    }
}

/// Kills the process tree when dropped unless disarmed, so cancelling a [`run`] future never
/// leaves a sandboxed tree behind.
struct TreeGuard(Option<TreeKiller>);

impl TreeGuard {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for TreeGuard {
    fn drop(&mut self) {
        if let Some(killer) = self.0.take() {
            killer.kill();
        }
    }
}

fn millis(since: Instant) -> u64 {
    u64::try_from(since.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Runs `argv` under `policy` to completion and returns its exit, captured output and the
/// enforcement report.
///
/// - A program that is missing or cannot start is `ExitOutcome::SpawnFailed`, a normal result.
/// - A platform that cannot enforce the policy is `Err(Error::Unavailable)` and nothing runs.
/// - When the timeout fires the process tree gets a polite stop, then after `kill_grace_ms` a
///   kill, and the result is `TimedOut` with whatever output arrived.
/// - When the leader exits, any processes it left behind in its group are killed: a command
///   does not get to leave daemons running in the sandbox.
/// - Dropping the returned future kills the tree.
pub async fn run(argv: &[String], policy: &SandboxPolicy) -> Result<RunResult> {
    let started = Instant::now();
    let (mut child, enforcement) = match begin(argv, policy, StdinMode::Null, None).await? {
        Begun::Failed(reason, enforcement) => {
            return Ok(RunResult {
                exit: ExitOutcome::SpawnFailed { reason },
                stdout: Captured::default(),
                stderr: Captured::default(),
                duration_ms: millis(started),
                enforcement,
            });
        }
        Begun::Started(child, enforcement) => (child, enforcement),
    };
    let killer = child.killer();
    let mut guard = TreeGuard(Some(killer.clone()));
    let (timeout, grace, cap) = (
        Duration::from_millis(policy.timeout_ms),
        Duration::from_millis(policy.kill_grace_ms),
        policy.output_cap_bytes,
    );

    let streams = child.take_streams();
    let (out, err) = (
        Arc::new(Collector::default()),
        Arc::new(Collector::default()),
    );
    let mut readers = tokio::task::JoinSet::new();
    readers.spawn(collect(streams.stdout, out.clone(), cap));
    readers.spawn(collect(streams.stderr, err.clone(), cap));
    drop(streams.stdin);

    let exit = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => status?,
        Err(_elapsed) => {
            let polite = killer.terminate();
            if !polite || tokio::time::timeout(grace, child.wait()).await.is_err() {
                killer.kill();
                child.wait().await?;
            }
            ExitOutcome::TimedOut
        }
    };
    // The leader is gone; end whatever it left running, which also closes the pipes.
    killer.kill();
    guard.disarm();
    let drained = tokio::time::timeout(DRAIN_GRACE.max(grace), async {
        while readers.join_next().await.is_some() {}
    })
    .await;
    if drained.is_err() {
        readers.abort_all();
        tracing::warn!(
            "output pipes stayed open after the process tree was killed; returning partial output"
        );
    }

    Ok(RunResult {
        exit,
        stdout: out.snapshot(cap),
        stderr: err.snapshot(cap),
        duration_ms: millis(started),
        enforcement,
    })
}

/// A long-lived sandboxed child.
///
/// Its output streams are capped like [`run`]'s: the child is never blocked, the excess is
/// dropped, and [`Handle::stdout_stats`] says whether that happened. The timeout in the policy
/// is the child's maximum lifetime, enforced by a watchdog: after it, the tree is stopped and
/// then killed, and [`Handle::wait`] reports `TimedOut`. Dropping the handle kills the tree.
pub struct Handle {
    pid: u32,
    stdin: Option<BoxWrite>,
    stdout: Option<BoxRead>,
    stderr: Option<BoxRead>,
    stdout_stats: StreamStats,
    stderr_stats: StreamStats,
    child: Child,
    killer: TreeKiller,
    enforcement: Enforcement,
    watchdog: CancellationToken,
    timed_out: Arc<AtomicBool>,
    reaped: bool,
}

impl std::fmt::Debug for Handle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Handle")
            .field("pid", &self.pid)
            .field("reaped", &self.reaped)
            .finish_non_exhaustive()
    }
}

/// Starts `argv` under `policy` and returns immediately with streams and controls.
///
/// A program that cannot start is an [`Error::Spawn`] here, because there is no
/// [`RunResult`] to carry it.
pub async fn spawn(
    argv: &[String],
    policy: &SandboxPolicy,
    options: SpawnOptions,
) -> Result<Handle> {
    let stdin = if options.piped_stdin {
        StdinMode::Piped
    } else {
        StdinMode::Null
    };
    let (mut child, enforcement) = match begin(argv, policy, stdin, options.inherit).await? {
        Begun::Failed(reason, _) => return Err(Error::Spawn(reason)),
        Begun::Started(child, enforcement) => (child, enforcement),
    };
    let killer = child.killer();
    let streams = child.take_streams();
    let cap = policy.output_cap_bytes;
    let (stdout, stdout_stats) = CappedReader::new(streams.stdout, cap);
    let (stderr, stderr_stats) = CappedReader::new(streams.stderr, cap);

    let watchdog = CancellationToken::new();
    let timed_out = Arc::new(AtomicBool::new(false));
    tokio::spawn(watch(
        killer.clone(),
        watchdog.clone(),
        timed_out.clone(),
        Duration::from_millis(policy.timeout_ms),
        Duration::from_millis(policy.kill_grace_ms),
    ));
    Ok(Handle {
        pid: child.pid(),
        stdin: streams.stdin,
        stdout: Some(Box::new(stdout)),
        stderr: Some(Box::new(stderr)),
        stdout_stats,
        stderr_stats,
        child,
        killer,
        enforcement,
        watchdog,
        timed_out,
        reaped: false,
    })
}

async fn watch(
    killer: TreeKiller,
    done: CancellationToken,
    timed_out: Arc<AtomicBool>,
    timeout: Duration,
    grace: Duration,
) {
    if tokio::time::timeout(timeout, done.cancelled())
        .await
        .is_ok()
    {
        return; // the child ended (or the handle was dropped) first
    }
    timed_out.store(true, Ordering::SeqCst);
    let polite = killer.terminate();
    if !polite || tokio::time::timeout(grace, done.cancelled()).await.is_err() {
        killer.kill();
    }
}

impl Handle {
    /// The child's process id.
    #[must_use]
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// What was enforced for this child.
    #[must_use]
    pub fn enforcement(&self) -> &Enforcement {
        &self.enforcement
    }

    /// Takes the stdin pipe (present only with [`SpawnOptions::piped_stdin`]). Call once.
    pub fn take_stdin(&mut self) -> Option<ChildWriter> {
        self.stdin.take()
    }

    /// Takes the capped standard output stream. Call once.
    pub fn take_stdout(&mut self) -> Option<ChildReader> {
        self.stdout.take()
    }

    /// Takes the capped standard error stream. Call once.
    pub fn take_stderr(&mut self) -> Option<ChildReader> {
        self.stderr.take()
    }

    /// Counters for standard output (total bytes, whether the cap dropped any).
    #[must_use]
    pub fn stdout_stats(&self) -> StreamStats {
        self.stdout_stats.clone()
    }

    /// Counters for standard error.
    #[must_use]
    pub fn stderr_stats(&self) -> StreamStats {
        self.stderr_stats.clone()
    }

    /// Kills the whole process tree now. Safe to call more than once and after exit.
    pub fn kill(&self) {
        if !self.reaped {
            self.killer.kill();
        }
    }

    /// Waits for the leader to exit, then kills anything it left behind. Reports `TimedOut`
    /// if the watchdog fired.
    pub async fn wait(&mut self) -> Result<ExitOutcome> {
        let exit = self.child.wait().await?;
        if !self.reaped {
            self.killer.kill();
        }
        self.reaped = true;
        self.watchdog.cancel();
        Ok(if self.timed_out.load(Ordering::SeqCst) {
            ExitOutcome::TimedOut
        } else {
            exit
        })
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        self.kill();
        self.watchdog.cancel();
    }
}
