//! The private channel between the plugin and a spawned child (the exec kernel).
//!
//! The kernel must not talk over stdout, and with the network off it cannot connect to anything.
//! So `hx` makes a connected socket pair, gives the child one end (an inherited descriptor, no
//! path and no network needed), and binds a Unix socket in a private directory for the plugin.
//! The first connection to that socket is bridged, byte for byte, onto the other end. The
//! bytes never pass through JSON-RPC, so the kernel's own protocol (`hx-kernel-v1`) runs
//! unframed and unbuffered between the plugin and the kernel.
//!
//! The socket's directory is the one thing keeping other users out, so it is checked rather than
//! trusted: mode 0700, owned by the current user, never a symlink. Who among the same user's
//! processes gets the single connection is the "first acceptable connector" rule documented on
//! [`open`].

#[cfg(unix)]
pub(crate) use unix::{Channel, open};

#[cfg(not(unix))]
pub(crate) use other::{Channel, open};

#[cfg(unix)]
mod unix {
    use std::fs::File;
    use std::os::fd::{AsRawFd, OwnedFd};
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use tokio::net::UnixStream;
    use tokio::task::JoinHandle;
    use tokio::time::Instant;

    use crate::error::{Error, Result};
    use crate::wire::{ChannelInfo, ChannelRequest, DEFAULT_CHANNEL_ACCEPT_MS};

    /// An open channel. Dropping it closes the listener and removes the socket (and the
    /// directory, when `hx` created it).
    pub(crate) struct Channel {
        /// What the plugin needs to connect.
        pub info: ChannelInfo,
        child_end: Option<OwnedFd>,
        dir: PathBuf,
        owns_dir: bool,
        child_pid: Arc<AtomicU32>,
        bridge: JoinHandle<()>,
    }

    impl Drop for Channel {
        fn drop(&mut self) {
            self.bridge.abort();
            let _ = std::fs::remove_file(&self.info.path);
            if self.owns_dir {
                let _ = std::fs::remove_dir(&self.dir);
            }
        }
    }

    impl Channel {
        /// The child's end, to pass as the inherited descriptor. Call once.
        #[allow(
            clippy::expect_used,
            reason = "called exactly once by the handler, right after open"
        )]
        pub(crate) fn take_child_end(&mut self) -> OwnedFd {
            self.child_end
                .take()
                .expect("the child's end is taken once")
        }

        /// Tells the bridge which process the sandboxed program is, so that a connection from it
        /// or from anything in its tree is refused. Until this is called, where the platform can
        /// tell connectors apart (Linux), every connection is refused: nobody legitimate knows
        /// the path before `sandbox.spawn` has answered.
        pub(crate) fn set_child_pid(&self, pid: u32) {
            self.child_pid.store(pid, Ordering::SeqCst);
        }
    }

    /// The directory as it was checked: the open descriptor pins the object, and its device and
    /// inode are compared again after the socket is bound.
    struct CheckedDir {
        _handle: File,
        identity: (u64, u64),
    }

    /// Makes (mode 0700) or accepts the channel directory, and checks what a path alone cannot
    /// promise: it is not a symlink (a link planted by someone else would send the socket where
    /// they choose), it is a directory, the current user owns it (any other owner can rename or
    /// replace the socket in it), and no group or other bit is set. A directory this crate
    /// created gets its mode forced to 0700 whatever the umask; one the caller supplied is never
    /// changed, only refused.
    fn check_dir(dir: &Path) -> Result<CheckedDir> {
        match std::fs::symlink_metadata(dir) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(Error::invalid(format!(
                    "channel directory {} is a symbolic link; give the real directory",
                    dir.display()
                )));
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(Error::invalid(format!(
                    "channel path {} is not a directory",
                    dir.display()
                )));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::DirBuilder::new()
                    .mode(0o700)
                    .recursive(true)
                    .create(dir)?;
                // The umask can only have removed bits, but a restrictive one must not make a
                // directory we are about to use unusable.
                std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
            }
            Err(e) => return Err(e.into()),
        }
        // Check the object that is open, not the name: O_NOFOLLOW fails if the name was swapped
        // for a link since the lstat above.
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(dir)
            .map_err(|e| {
                Error::invalid(format!(
                    "channel directory {} cannot be opened as a plain directory: {e}",
                    dir.display()
                ))
            })?;
        let meta = handle.metadata()?;
        if meta.uid() != crate::platform::current_uid() {
            return Err(Error::invalid(format!(
                "channel directory {} is owned by uid {}, not by the current user; a directory \
                 someone else owns lets them replace the socket",
                dir.display(),
                meta.uid()
            )));
        }
        let mode = meta.permissions().mode();
        if mode & 0o077 != 0 || mode & 0o700 != 0o700 {
            return Err(Error::invalid(format!(
                "channel directory {} must have mode 0700 (it is {:04o})",
                dir.display(),
                mode & 0o7777
            )));
        }
        Ok(CheckedDir {
            identity: (meta.dev(), meta.ino()),
            _handle: handle,
        })
    }

    /// Why a connection may not take the channel, or `Ok` when it may.
    ///
    /// The peer must be the same user. On Linux it must also not be the sandboxed program or
    /// anything below it (see [`in_tree`]); a connection with no readable pid is refused there
    /// too, since it cannot be shown to be somebody else.
    fn vet(stream: &UnixStream, child_pid: &AtomicU32) -> std::result::Result<(), String> {
        let cred = stream
            .peer_cred()
            .map_err(|e| format!("no credentials: {e}"))?;
        if cred.uid() != crate::platform::current_uid() {
            return Err(format!("a different user (uid {}) connected", cred.uid()));
        }
        #[cfg(target_os = "linux")]
        {
            let child = child_pid.load(Ordering::SeqCst);
            let peer = cred.pid().filter(|p| *p > 0);
            match (peer, child) {
                (_, 0) => return Err("it connected before the child was started".to_owned()),
                (None, _) => return Err("its process id is not readable".to_owned()),
                (Some(peer), child) => {
                    if in_tree(peer, child, proc_relations) {
                        return Err(format!(
                            "process {peer} belongs to the sandboxed program's tree (pid {child})"
                        ));
                    }
                }
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = child_pid;
        Ok(())
    }

    /// Whether `peer` is `child` or a descendant of it, or shares its session (the program
    /// leads one, so even a process that was orphaned to `init` is still in it unless it called
    /// `setsid` itself). `relations(pid)` gives `(parent, session)`, or `None` when the process
    /// is gone. Pure, so the walk is tested with a made-up process table.
    #[cfg(any(target_os = "linux", test))]
    pub(super) fn in_tree(
        peer: i32,
        child: u32,
        relations: impl Fn(i32) -> Option<(i32, i32)>,
    ) -> bool {
        let Ok(child) = i32::try_from(child) else {
            return false;
        };
        if peer == child {
            return true;
        }
        if relations(peer).is_some_and(|(_, session)| session == child) {
            return true;
        }
        let mut at = peer;
        // A bounded walk up the parents: a cycle in a made-up table cannot hang it.
        for _ in 0..64 {
            let Some((parent, _)) = relations(at) else {
                return false;
            };
            if parent == child {
                return true;
            }
            if parent <= 1 {
                return false;
            }
            at = parent;
        }
        false
    }

    /// `(parent, session)` of `pid` from `/proc/<pid>/stat`.
    #[cfg(target_os = "linux")]
    fn proc_relations(pid: i32) -> Option<(i32, i32)> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // The command name is in parentheses and may contain anything, so split after the last.
        let rest = stat.rsplit_once(')')?.1;
        let mut fields = rest.split_whitespace().skip(1);
        let parent = fields.next()?.parse().ok()?;
        let session = fields.nth(1)?.parse().ok()?;
        Some((parent, session))
    }

    /// Creates the pair, the socket directory and the listener, and starts the bridge. Must be
    /// called inside a Tokio runtime.
    ///
    /// **Who gets the channel.** The bridge serves exactly one connection, and it is the first
    /// *acceptable* one: same user, and (Linux) not the sandboxed program's tree. A connection
    /// that fails those checks is closed and the listener keeps waiting until
    /// `accept_timeout_ms`, so a program in the sandbox cannot use up the single slot. Beyond
    /// that there is no secret: any other process of the same user that connects before the
    /// plugin takes the channel, which is why the directory is private (0700, owned by the
    /// user, never a symlink) and why the path is only handed to the plugin.
    pub(crate) fn open(request: &ChannelRequest) -> Result<Channel> {
        let (dir, owns_dir) = match &request.dir {
            Some(dir) => (dir.clone(), false),
            None => (
                std::env::temp_dir().join(format!("hx-sandbox-{}", uuid::Uuid::now_v7())),
                true,
            ),
        };
        let checked = check_dir(&dir)?;
        let (host_end, child_end) = std::os::unix::net::UnixStream::pair()?;
        host_end.set_nonblocking(true)?;
        let host_end = tokio::net::UnixStream::from_std(host_end)?;
        let socket = dir.join("channel.sock");
        let listener = tokio::net::UnixListener::bind(&socket)?;
        // The name must still lead to the directory that was checked; if it was swapped in
        // between, the socket is in the wrong place and nothing may use it.
        let same =
            std::fs::symlink_metadata(&dir).is_ok_and(|m| (m.dev(), m.ino()) == checked.identity);
        if !same {
            drop(listener);
            return Err(Error::invalid(format!(
                "channel directory {} was replaced while the channel was being opened",
                dir.display()
            )));
        }
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;

        let accept_for = Duration::from_millis(
            request
                .accept_timeout_ms
                .unwrap_or(DEFAULT_CHANNEL_ACCEPT_MS),
        );
        let child_pid = Arc::new(AtomicU32::new(0));
        let socket_for_task = socket.clone();
        let pid_for_task = child_pid.clone();
        let bridge = tokio::spawn(async move {
            let mut host_end = host_end;
            let deadline = Instant::now() + accept_for;
            let mut plugin = loop {
                let left = deadline.saturating_duration_since(Instant::now());
                let Ok(Ok((stream, _))) = tokio::time::timeout(left, listener.accept()).await
                else {
                    // Nobody acceptable connected in time: dropping `host_end` shows the child EOF.
                    drop(listener);
                    let _ = std::fs::remove_file(&socket_for_task);
                    return;
                };
                match vet(&stream, &pid_for_task) {
                    Ok(()) => break stream,
                    Err(why) => {
                        tracing::warn!("a connection to a sandbox channel was refused: {why}");
                    }
                }
            };
            drop(listener);
            let _ = std::fs::remove_file(&socket_for_task);
            let _ = tokio::io::copy_bidirectional(&mut plugin, &mut host_end).await;
        });

        let info = ChannelInfo {
            kind: "unix_socket".to_owned(),
            path: socket.to_string_lossy().into_owned(),
            env: request.env.clone(),
            fd: child_end.as_raw_fd(),
        };
        Ok(Channel {
            info,
            child_end: Some(child_end.into()),
            dir,
            owns_dir,
            child_pid,
            bridge,
        })
    }

    #[cfg(test)]
    mod tests;
}

#[cfg(not(unix))]
mod other {
    use crate::error::{Error, Result};
    use crate::platform::InheritedHandle;
    use crate::wire::{ChannelInfo, ChannelRequest};

    /// Never constructed: the channel exists on Unix only for now.
    pub(crate) struct Channel {
        pub info: ChannelInfo,
    }

    #[allow(
        clippy::unused_self,
        reason = "keeps the signatures of the Unix channel, which the handler calls"
    )]
    impl Channel {
        pub(crate) fn take_child_end(&mut self) -> InheritedHandle {
            unreachable!("channel::open never succeeds on this platform")
        }

        pub(crate) fn set_child_pid(&self, _pid: u32) {}
    }

    pub(crate) fn open(_request: &ChannelRequest) -> Result<Channel> {
        Err(Error::invalid(
            "sandbox channels are not implemented on this platform yet (the library can still pass one handle with SpawnOptions::with_inherit)",
        ))
    }
}
