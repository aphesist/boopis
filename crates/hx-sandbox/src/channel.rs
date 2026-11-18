//! The private channel between the plugin and a spawned child (the exec kernel).
//!
//! The kernel must not talk over stdout, and with the network off it cannot connect to anything.
//! So `hx` makes a connected socket pair, gives the child one end (an inherited descriptor, no
//! path and no network needed), and binds a Unix socket in a private directory for the plugin.
//! The first connection to that socket is bridged, byte for byte, onto the other end. The
//! bytes never pass through JSON-RPC, so the kernel's own protocol (`hx-kernel-v1`) runs
//! unframed and unbuffered between the plugin and the kernel.

#[cfg(unix)]
pub(crate) use unix::{Channel, open};

#[cfg(not(unix))]
pub(crate) use other::{Channel, open};

#[cfg(unix)]
mod unix {
    use std::os::fd::{AsRawFd, OwnedFd};
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::path::PathBuf;
    use std::time::Duration;

    use tokio::task::JoinHandle;

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
    }

    /// Creates the pair, the socket directory and the listener, and starts the bridge. Must be
    /// called inside a Tokio runtime.
    pub(crate) fn open(request: &ChannelRequest) -> Result<Channel> {
        let (host_end, child_end) = std::os::unix::net::UnixStream::pair()?;
        host_end.set_nonblocking(true)?;
        let host_end = tokio::net::UnixStream::from_std(host_end)?;

        let (dir, owns_dir) = match &request.dir {
            Some(dir) => (dir.clone(), false),
            None => (
                std::env::temp_dir().join(format!("hx-sandbox-{}", uuid::Uuid::now_v7())),
                true,
            ),
        };
        match std::fs::metadata(&dir) {
            Ok(meta) if meta.is_dir() => {
                if meta.permissions().mode() & 0o077 != 0 {
                    return Err(Error::invalid(format!(
                        "channel directory {} must not be accessible to group or others (mode 0700)",
                        dir.display()
                    )));
                }
            }
            Ok(_) => {
                return Err(Error::invalid(format!(
                    "channel path {} is not a directory",
                    dir.display()
                )));
            }
            Err(_) => std::fs::DirBuilder::new()
                .mode(0o700)
                .recursive(true)
                .create(&dir)?,
        }
        let socket = dir.join("channel.sock");
        let listener = tokio::net::UnixListener::bind(&socket)?;
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;

        let accept_for = Duration::from_millis(
            request
                .accept_timeout_ms
                .unwrap_or(DEFAULT_CHANNEL_ACCEPT_MS),
        );
        let socket_for_task = socket.clone();
        let bridge = tokio::spawn(async move {
            let mut host_end = host_end;
            let accepted = tokio::time::timeout(accept_for, listener.accept()).await;
            drop(listener);
            let _ = std::fs::remove_file(&socket_for_task);
            let Ok(Ok((mut plugin, _))) = accepted else {
                return; // nobody connected in time: dropping `host_end` shows the child EOF
            };
            // Only the same user may be on the other end.
            let me = crate::platform::current_uid();
            if plugin.peer_cred().map(|c| c.uid()).ok() != Some(me) {
                tracing::warn!("a different user connected to a sandbox channel; closing it");
                return;
            }
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
            bridge,
        })
    }
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

    impl Channel {
        pub(crate) fn take_child_end(&mut self) -> InheritedHandle {
            unreachable!("channel::open never succeeds on this platform")
        }
    }

    pub(crate) fn open(_request: &ChannelRequest) -> Result<Channel> {
        Err(Error::invalid(
            "sandbox channels are not implemented on this platform yet (the library can still pass one handle with SpawnOptions::with_inherit)",
        ))
    }
}
