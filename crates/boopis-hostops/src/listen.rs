//! The one listener both host channels use (STANDARDS rule 1): the secret channel (`hx-host-secrets-v1`) and host-ops
//! (`hx-host-ops-v1`) are handlers on it.
//!
//! * A Unix socket in a `0700` folder, mode `0600`. A leftover socket from a crashed run is removed; one a live host still
//!   answers is not taken.
//! * Each connection: the kernel's `SO_PEERCRED` uid must be the folder's owner (else the connection is closed unanswered);
//!   the peer's pid goes to `admit`, **before** the request is read, and the handler is told the verdict, so a refused peer
//!   can be given the same answer as a wrong token and neither factor can be probed apart.
//! * One line in (at most `max_line` bytes), one line out, then close; the whole exchange within `timeout`; at most `conns`
//!   connections at once.
//! * Windows has no named-pipe server yet: [`serve`] answers `Unsupported` there.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

/// A connection's limits.
#[derive(Debug, Clone, Copy)]
pub struct Opts {
    /// The longest request line read.
    pub max_line: usize,
    /// The whole exchange's time.
    pub timeout: Duration,
    /// Connections served at once.
    pub conns: usize,
}

/// Decides, from the peer's pid (the kernel's word, `None` when it gave none), whether the peer may be served.
pub type Admit = Arc<dyn Fn(Option<u32>) -> bool + Send + Sync>;
/// Answers one line, told whether the peer was admitted. The answer is written as it is (it ends with a newline).
pub type Handle =
    Arc<dyn Fn(String, bool) -> Pin<Box<dyn Future<Output = String> + Send>> + Send + Sync>;

/// A running listener. Dropping it stops it and removes the socket.
#[derive(Debug)]
pub struct Listener {
    socket: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl Listener {
    /// The socket's path.
    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
    }
}

/// Listen on `socket` (its folder is made `0700`).
///
/// # Errors
/// When the folder or the socket cannot be made, or another live host answers on it.
#[cfg(unix)]
pub async fn serve(
    socket: &Path,
    opts: Opts,
    admit: Admit,
    handle: Handle,
) -> std::io::Result<Listener> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let dir = socket
        .parent()
        .ok_or_else(|| std::io::Error::other("the socket has no folder"))?;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    let owner = std::fs::metadata(dir)?.uid();
    if socket.exists() {
        if tokio::net::UnixStream::connect(socket).await.is_ok() {
            return Err(std::io::Error::other("another boopis host already runs"));
        }
        std::fs::remove_file(socket)?;
    }
    let listener = tokio::net::UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    let gate = Arc::new(tokio::sync::Semaphore::new(opts.conns));
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let Ok(permit) = gate.clone().acquire_owned().await else {
                return;
            };
            let (admit, handle) = (admit.clone(), handle.clone());
            tokio::spawn(async move {
                let _permit = permit;
                let work = async {
                    let cred = stream.peer_cred()?;
                    if cred.uid() != owner {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "wrong peer",
                        ));
                    }
                    let admitted = admit(cred.pid().and_then(|p| u32::try_from(p).ok()));
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    while !buf.contains(&b'\n') && buf.len() <= opts.max_line {
                        let n = stream.read(&mut chunk).await?;
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let first = buf.split(|b| *b == b'\n').next().unwrap_or_default();
                    // A line past the cap is cut, so it is no request: the handler refuses it as one.
                    let line = if first.len() > opts.max_line {
                        String::new()
                    } else {
                        String::from_utf8_lossy(first).into_owned()
                    };
                    let answer = handle(line, admitted).await;
                    stream.write_all(answer.as_bytes()).await?;
                    stream.shutdown().await
                };
                if let Ok(Err(e)) = tokio::time::timeout(opts.timeout, work).await {
                    tracing::debug!(error = %e, "a host channel connection ended");
                }
            });
        }
    });
    Ok(Listener {
        socket: socket.to_path_buf(),
        task,
    })
}

/// Windows needs a named pipe with a user-only ACL, not written yet.
///
/// # Errors
/// Always `Unsupported`.
#[cfg(not(unix))]
#[allow(clippy::unused_async, reason = "the same signature as on Unix")]
pub async fn serve(
    _socket: &Path,
    _opts: Opts,
    _admit: Admit,
    _handle: Handle,
) -> std::io::Result<Listener> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "a host channel needs a named pipe on this OS, which is not implemented yet",
    ))
}
