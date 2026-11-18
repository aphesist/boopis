//! Child handling shared by the Linux and macOS backends: starting a configured command,
//! reading the setup-failure pipe, waiting, and killing the process group.

use std::io;
use std::os::fd::OwnedFd;
use std::os::unix::process::ExitStatusExt;

use tokio::process::Command;

use super::{BoxRead, BoxWrite, Launch, StdinMode, Streams, unix_sys};
use crate::error::{Error, Result};
use crate::report::ExitOutcome;

/// Ends a whole process tree. Cheap to copy; valid for as long as the tree has a live member,
/// so callers use it only while they still hold the [`Child`] or right after it was reaped.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TreeKiller {
    pgid: libc::pid_t,
}

impl TreeKiller {
    /// Asks the tree to stop (SIGTERM to the group).
    pub(crate) fn terminate(self) {
        unix_sys::killpg(self.pgid, libc::SIGTERM);
    }

    /// Kills the tree (SIGKILL to the group).
    pub(crate) fn kill(self) {
        unix_sys::killpg(self.pgid, libc::SIGKILL);
    }
}

/// A running child that leads its own session and process group.
pub(crate) struct Child {
    inner: tokio::process::Child,
    killer: TreeKiller,
    streams: Option<Streams>,
}

impl Child {
    /// The process id, which is also the process group id.
    pub(crate) fn pid(&self) -> u32 {
        self.inner.id().unwrap_or(0)
    }

    pub(crate) fn killer(&self) -> TreeKiller {
        self.killer
    }

    /// Hands out the pipes. Call once.
    pub(crate) fn take_streams(&mut self) -> Streams {
        self.streams.take().unwrap_or_else(|| Streams {
            stdin: None,
            stdout: Box::new(tokio::io::empty()),
            stderr: Box::new(tokio::io::empty()),
        })
    }

    /// Waits for the leader to exit.
    pub(crate) async fn wait(&mut self) -> io::Result<ExitOutcome> {
        let status = self.inner.wait().await?;
        Ok(match (status.code(), status.signal()) {
            (Some(code), _) => ExitOutcome::Exited { code },
            (None, Some(signal)) => ExitOutcome::Signaled { signal },
            (None, None) => ExitOutcome::Exited { code: -1 },
        })
    }
}

/// The write end of the pipe on which the pre-exec hook reports which setup step failed.
pub(super) struct StatusPipe {
    pub read: OwnedFd,
    pub write: OwnedFd,
}

impl StatusPipe {
    pub(super) fn new() -> io::Result<Self> {
        let (read, write) = unix_sys::pipe_cloexec()?;
        Ok(Self { read, write })
    }
}

/// Spawns `cmd` (already configured with environment, cwd, hooks). A setup failure reported
/// through `status` becomes `Error::Setup`; any other spawn failure is `Launch::Failed`.
pub(super) fn start(
    mut cmd: Command,
    stdin: StdinMode,
    status: Option<StatusPipe>,
    step_name: fn(u8) -> &'static str,
) -> Result<Launch> {
    cmd.stdin(match stdin {
        StdinMode::Null => std::process::Stdio::null(),
        StdinMode::Piped => std::process::Stdio::piped(),
    });
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // The group is killed explicitly; tokio's own kill-on-drop would only hit the leader.
    cmd.kill_on_drop(false);

    match cmd.spawn() {
        Ok(mut child) => {
            let pid = child
                .id()
                .ok_or_else(|| Error::Io(io::Error::other("spawned child has no pid")))?;
            let stdin: Option<BoxWrite> = child.stdin.take().map(|s| Box::new(s) as BoxWrite);
            let stdout: BoxRead = match child.stdout.take() {
                Some(s) => Box::new(s),
                None => Box::new(tokio::io::empty()),
            };
            let stderr: BoxRead = match child.stderr.take() {
                Some(s) => Box::new(s),
                None => Box::new(tokio::io::empty()),
            };
            let group = libc::pid_t::try_from(pid)
                .map_err(|_| Error::Io(io::Error::other("pid out of range for a process group")))?;
            Ok(Launch::Started(Child {
                inner: child,
                killer: TreeKiller { pgid: group },
                streams: Some(Streams {
                    stdin,
                    stdout,
                    stderr,
                }),
            }))
        }
        Err(err) => {
            // The hook writes one byte naming its step before it returns an error.
            let failed_step = status.and_then(|s| {
                drop(s.write);
                unix_sys::read_byte(&s.read)
            });
            match failed_step {
                Some(step) => Err(Error::Setup {
                    step: step_name(step).to_owned(),
                    source: err,
                }),
                None => Ok(Launch::Failed(err.to_string())),
            }
        }
    }
}
