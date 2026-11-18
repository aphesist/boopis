//! The few raw Unix calls shared by the Linux and macOS backends.
#![allow(
    unsafe_code,
    reason = "thin wrappers over libc calls with no safe std equivalent; each block is commented"
)]

use std::io;
use std::os::fd::AsRawFd;
#[cfg(not(target_os = "linux"))]
use std::os::fd::BorrowedFd;

/// Sends `sig` to every process in group `pgid`. A group that no longer exists is not an error.
pub(super) fn killpg(pgid: libc::pid_t, sig: libc::c_int) {
    if pgid <= 1 {
        // Never signal "the caller's group" (0) or init's (1) because of a bad pid.
        return;
    }
    // SAFETY: killpg takes two integers and touches no memory. A stale group id at worst
    // returns ESRCH, which we ignore on purpose.
    unsafe {
        libc::killpg(pgid, sig);
    }
}

/// Sets or clears FD_CLOEXEC on `fd`.
#[cfg(not(target_os = "linux"))]
pub(super) fn set_cloexec(fd: BorrowedFd<'_>, on: bool) -> io::Result<()> {
    let raw = fd.as_raw_fd();
    // SAFETY: fcntl on a descriptor that `BorrowedFd` guarantees is open; no memory is passed.
    let flags = unsafe { libc::fcntl(raw, libc::F_GETFD) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let new = if on {
        flags | libc::FD_CLOEXEC
    } else {
        flags & !libc::FD_CLOEXEC
    };
    // SAFETY: as above.
    if unsafe { libc::fcntl(raw, libc::F_SETFD, new) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Creates a close-on-exec pipe: `(read_end, write_end)`.
pub(super) fn pipe_cloexec() -> io::Result<(std::os::fd::OwnedFd, std::os::fd::OwnedFd)> {
    use std::os::fd::FromRawFd;
    let mut fds = [0 as libc::c_int; 2];
    #[cfg(target_os = "linux")]
    // SAFETY: `fds` is a valid array of two ints, which is what pipe2 writes into.
    let rc = unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) };
    #[cfg(not(target_os = "linux"))]
    // SAFETY: `fds` is a valid array of two ints, which is what pipe writes into.
    let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: pipe/pipe2 succeeded, so both descriptors are open and owned by nobody else.
    let (r, w) = unsafe {
        (
            std::os::fd::OwnedFd::from_raw_fd(fds[0]),
            std::os::fd::OwnedFd::from_raw_fd(fds[1]),
        )
    };
    #[cfg(not(target_os = "linux"))]
    {
        set_cloexec(r.as_fd_ref(), true)?;
        set_cloexec(w.as_fd_ref(), true)?;
        set_nonblocking(&r)?;
    }
    Ok((r, w))
}

#[cfg(not(target_os = "linux"))]
trait AsFdRef {
    fn as_fd_ref(&self) -> BorrowedFd<'_>;
}
#[cfg(not(target_os = "linux"))]
impl AsFdRef for std::os::fd::OwnedFd {
    fn as_fd_ref(&self) -> BorrowedFd<'_> {
        std::os::fd::AsFd::as_fd(self)
    }
}

#[cfg(not(target_os = "linux"))]
fn set_nonblocking(fd: &std::os::fd::OwnedFd) -> io::Result<()> {
    // SAFETY: fcntl on an open descriptor; no memory is passed.
    let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) };
    if flags < 0
        || unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Reads one byte from a non-blocking pipe, if one is there.
pub(super) fn read_byte(fd: &std::os::fd::OwnedFd) -> Option<u8> {
    let mut byte = 0u8;
    // SAFETY: the buffer is one valid, writable byte and the length passed is 1.
    let n = unsafe { libc::read(fd.as_raw_fd(), std::ptr::addr_of_mut!(byte).cast(), 1) };
    (n == 1).then_some(byte)
}
