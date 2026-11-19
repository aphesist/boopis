//! The child's side of an inherited channel: a program started with `SpawnOptions::with_inherit`
//! finds the descriptor's number in an environment variable and turns it into a stream.

#![allow(
    unsafe_code,
    reason = "wrapping the one descriptor the parent passed on purpose; see `inherited_stream`"
)]

use std::io;
use std::os::fd::{FromRawFd, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;

/// The stream on the descriptor named by the environment variable `var`.
///
/// # Errors
/// The variable is unset or not a descriptor number of 3 or more, or the descriptor is not a
/// socket.
pub fn inherited_stream(var: &str) -> io::Result<UnixStream> {
    let invalid =
        |what: &str| io::Error::new(io::ErrorKind::InvalidInput, format!("{var}: {what}"));
    let raw: RawFd = std::env::var(var)
        .map_err(|_| invalid("not set"))?
        .parse()
        .map_err(|_| invalid("not a descriptor number"))?;
    if raw < 3 {
        return Err(invalid("a channel is never stdin, stdout or stderr"));
    }
    // SAFETY: the parent put exactly this descriptor in the child for this purpose and nothing else
    // in this process owns it, so taking ownership closes it once, here, when the stream drops.
    let fd = unsafe { OwnedFd::from_raw_fd(raw) };
    Ok(UnixStream::from(fd))
}
