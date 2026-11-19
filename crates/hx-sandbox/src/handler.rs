//! The `sandbox.*` handler for the `hx` dispatcher.
//!
//! `sandbox.run` and `sandbox.capabilities` are stateless. `sandbox.spawn`, `sandbox.wait` and
//! `sandbox.kill` share a registry of running children, keyed by an opaque `UUIDv7` handle.
//!
//! **How the plugin receives a spawned child's streams.** The kernel's own protocol runs over
//! the private channel (a Unix socket the plugin connects to; see [`crate::channel`]), not over
//! `hx`'s stdio: the bytes are binary-safe, unframed by JSON-RPC, and never queue behind other
//! requests. The child's stdout and stderr are captured (each capped) and returned by
//! `sandbox.wait`, which doubles as a poll with `timeout_ms: 0`. `hx` sends no unsolicited
//! notifications for them: the dispatcher has no notification path and the kernel's output is
//! diagnostics, not data the plugin must react to as it arrives.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::{AppError, codes};
use serde_json::Value;
use tokio::task::JoinHandle;

use crate::capture::{Collector, StreamStats, collect};
use crate::channel::{self, Channel};
use crate::error::Error;
use crate::process::{Handle, KillSwitch, SpawnOptions};
use crate::wire::{
    METHOD_CAPABILITIES, METHOD_KILL, METHOD_RUN, METHOD_SPAWN, METHOD_WAIT, SandboxKillParams,
    SandboxKillResult, SandboxRunParams, SandboxSpawnParams, SandboxSpawnResult, SandboxWaitParams,
    SandboxWaitResult,
};

/// Most spawned children alive at once. Each holds a process tree and a channel.
const MAX_CHILDREN: usize = 32;
/// How long `sandbox.wait` gives the output readers to finish after the child has exited.
const READER_DRAIN: Duration = Duration::from_millis(500);

const METHODS: &[&str] = &[
    METHOD_RUN,
    METHOD_CAPABILITIES,
    METHOD_SPAWN,
    METHOD_WAIT,
    METHOD_KILL,
];

struct Running {
    handle: tokio::sync::Mutex<Handle>,
    kill: KillSwitch,
    stdout: Arc<Collector>,
    stderr: Arc<Collector>,
    out_stats: StreamStats,
    err_stats: StreamStats,
    readers: Mutex<Vec<JoinHandle<()>>>,
    cap: usize,
    started: Instant,
    // Dropped with the entry: closes the channel listener and removes the socket.
    _channel: Option<Channel>,
}

impl Running {
    /// The collected text, with the truncation facts from the capped stream (which swallows the
    /// excess before the collector sees it).
    fn snapshot(&self, collector: &Collector, stats: &StreamStats) -> crate::report::Captured {
        let mut captured = collector.snapshot(self.cap);
        captured.truncated = stats.truncated();
        captured.total_bytes = stats.total_bytes();
        captured
    }
}

/// Serves `sandbox.run`, `sandbox.capabilities`, `sandbox.spawn`, `sandbox.wait` and
/// `sandbox.kill`.
#[derive(Default)]
pub struct SandboxHandler {
    children: Mutex<HashMap<String, Arc<Running>>>,
}

impl std::fmt::Debug for SandboxHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SandboxHandler").finish_non_exhaustive()
    }
}

/// Maps a sandbox error to the wire error: the stable code, the message, and the details.
#[must_use]
pub fn app_error(e: &Error) -> AppError {
    let code = match e {
        Error::Unavailable { .. } => codes::HX_SANDBOX_UNAVAILABLE,
        Error::InvalidPolicy(_) => codes::HX_INVALID_PARAMS,
        Error::Spawn(_) => codes::HX_SANDBOX_SPAWN_FAILED,
        Error::Setup { .. } | Error::Io(_) => codes::HX_SANDBOX_DENIED,
    };
    let mut err = AppError::new(code, e.to_string());
    if let Some(Value::Object(map)) = e.data() {
        for (k, v) in map {
            err = err.with(&k, v);
        }
    }
    err
}

impl SandboxHandler {
    /// A handler with no children.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Running>>> {
        self.children.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn entry(&self, handle: &str) -> Result<Arc<Running>, AppError> {
        self.lock().get(handle).cloned().ok_or_else(|| {
            AppError::new(
                codes::HX_SANDBOX_UNKNOWN_HANDLE,
                format!("no running sandbox child `{handle}`"),
            )
        })
    }

    async fn run(&self, params: Value, ctx: &CallContext) -> HandlerResult {
        let (argv, policy) = parse_params::<SandboxRunParams>(params)?.into_policy();
        // Dropping the run future kills the whole process tree, so cancelling is safe and
        // changes nothing in the workspace.
        tokio::select! {
            () = ctx.cancel.cancelled() => Err(AppError::cancelled()),
            result = crate::run(&argv, &policy) => result.map_err(|e| app_error(&e)).and_then(|r| to_result(&r)),
        }
    }

    async fn spawn(&self, params: Value) -> HandlerResult {
        let p: SandboxSpawnParams = parse_params(params)?;
        if self.lock().len() >= MAX_CHILDREN {
            return Err(AppError::new(
                codes::HX_SANDBOX_TOO_MANY,
                format!("{MAX_CHILDREN} sandbox children are already running"),
            ));
        }
        let (argv, mut policy) = p.run.into_policy();
        let mut options = SpawnOptions::new();
        let mut channel: Option<Channel> = None;
        if let Some(request) = &p.channel {
            let mut open = channel::open(request).map_err(|e| app_error(&e))?;
            // The child learns its descriptor number from the environment.
            policy
                .env_set
                .insert(request.env.clone(), open.info.fd.to_string());
            options = options.with_inherit(open.take_child_end());
            channel = Some(open);
        }
        let mut child = crate::spawn(&argv, &policy, options)
            .await
            .map_err(|e| app_error(&e))?;

        if let Some(open) = &channel {
            // From here the bridge can tell the plugin from the program it started.
            open.set_child_pid(child.pid());
        }
        let cap = policy.output_cap_bytes;
        let (stdout, stderr) = (
            Arc::new(Collector::default()),
            Arc::new(Collector::default()),
        );
        let mut readers = Vec::new();
        if let Some(out) = child.take_stdout() {
            readers.push(tokio::spawn(collect(out, stdout.clone(), cap)));
        }
        if let Some(err) = child.take_stderr() {
            readers.push(tokio::spawn(collect(err, stderr.clone(), cap)));
        }
        let id = uuid::Uuid::now_v7().to_string();
        let child_stats = (child.stdout_stats(), child.stderr_stats());
        let result = SandboxSpawnResult {
            handle: id.clone(),
            pid: child.pid(),
            enforcement: child.enforcement().clone(),
            channel: channel.as_ref().map(|c| c.info.clone()),
        };
        let running = Running {
            kill: child.kill_switch(),
            handle: tokio::sync::Mutex::new(child),
            stdout,
            stderr,
            out_stats: child_stats.0,
            err_stats: child_stats.1,
            readers: Mutex::new(readers),
            cap,
            started: Instant::now(),
            _channel: channel,
        };
        self.lock().insert(id, Arc::new(running));
        to_result(&result)
    }

    async fn wait(&self, params: Value, ctx: &CallContext) -> HandlerResult {
        let p: SandboxWaitParams = parse_params(params)?;
        let entry = self.entry(&p.handle)?;
        let exited = tokio::select! {
            () = ctx.cancel.cancelled() => return Err(AppError::cancelled()),
            r = async {
                let mut handle = entry.handle.lock().await;
                tokio::time::timeout(Duration::from_millis(p.timeout_ms), handle.wait()).await
            } => r,
        };
        let exit = match exited {
            Ok(Ok(exit)) => Some(exit),
            Ok(Err(e)) => return Err(app_error(&e)),
            Err(_elapsed) => None,
        };
        if exit.is_some() {
            self.lock().remove(&p.handle);
            // Let the readers see end-of-file so the last output is in the result.
            let readers: Vec<_> =
                std::mem::take(&mut *entry.readers.lock().unwrap_or_else(PoisonError::into_inner));
            let _ = tokio::time::timeout(READER_DRAIN, async {
                for r in readers {
                    let _ = r.await;
                }
            })
            .await;
        }
        to_result(&SandboxWaitResult {
            running: exit.is_none(),
            exit,
            stdout: entry.snapshot(&entry.stdout, &entry.out_stats),
            stderr: entry.snapshot(&entry.stderr, &entry.err_stats),
            duration_ms: u64::try_from(entry.started.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    }

    fn kill(&self, params: Value) -> HandlerResult {
        let p: SandboxKillParams = parse_params(params)?;
        self.entry(&p.handle)?.kill.kill();
        to_result(&SandboxKillResult { killed: true })
    }
}

impl Handler for SandboxHandler {
    fn namespace(&self) -> Namespace {
        Namespace::Sandbox
    }

    fn methods(&self) -> &'static [&'static str] {
        METHODS
    }

    fn capabilities(&self) -> Vec<String> {
        // Live probes; the first call forks short-lived probe children on Linux (a few ms).
        let mut caps = crate::capabilities().capability_strings();
        caps.push("sandbox.wait".to_owned());
        caps.push("sandbox.kill".to_owned());
        if cfg!(unix) {
            caps.push("sandbox.channel.unix_socket".to_owned());
        }
        caps.sort();
        caps
    }

    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        Box::pin(async move {
            match method {
                METHOD_RUN => self.run(params, &ctx).await,
                METHOD_CAPABILITIES => to_result(&crate::capabilities()),
                METHOD_SPAWN => self.spawn(params).await,
                METHOD_WAIT => self.wait(params, &ctx).await,
                METHOD_KILL => self.kill(params),
                other => Err(AppError::new(
                    codes::HX_METHOD_NOT_FOUND,
                    format!("no handler for `{other}`"),
                )),
            }
        })
    }
}
