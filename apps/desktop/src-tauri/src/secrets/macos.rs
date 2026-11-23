//! The secret channel's process table on macOS: what [`super::peer`] asks the operating system about a process, answered
//! by the kernel the way Linux answers it from `/proc`.
//!
//! - **Start time and parent**: `proc_pidinfo(PROC_PIDTBSDINFO)`, the kernel's own record of the process (`pbi_start_*`, the
//!   moment the process was created, which an `exec` does not reset, and `pbi_ppid`). The start is kept as microseconds since
//!   the epoch; it is only ever compared with itself, so a recycled pid (created later) is told apart.
//! - **Executable**: `proc_pidpath`, the path of the file the kernel maps as the process's executable.
//! - **The environment it started with**: `sysctl(KERN_PROCARGS2)`, the argument and environment block the kernel copied
//!   when the program was executed (the same area `ps -E` reads). The kernel serves it for this user's own processes only.
//!
//! Without these, macOS compared the pid alone and never met rule B, so a gateway's first read at start-up (its keys, the
//! sign-ins it hands to the engine) was refused there. Every call is bounded and fails to `None`, which the policy treats
//! as a process it cannot pin: refused.

use std::ffi::{OsStr, c_int, c_void};
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;

use super::peer::{Os, Proc, Procs};

/// The largest argument and environment block read (the kernel's own `ARG_MAX` on current macOS is 1 MiB).
const MAX_ARGS: usize = 4 * 1024 * 1024;

/// The kernel's record of `pid`, or `None` when it is gone or cannot be read.
fn bsd_info(pid: u32) -> Option<libc::proc_bsdinfo> {
    let pid = c_int::try_from(pid).ok()?;
    let size = c_int::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).ok()?;
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    // SAFETY: `info` is a writable buffer of exactly `size` bytes, and the kernel writes at most that many; the result is
    // read only when the kernel says it filled all of them.
    #[allow(
        unsafe_code,
        reason = "the libproc call that reads a process's record; see the SAFETY note"
    )]
    let (written, info) = unsafe {
        let n = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast::<c_void>(),
            size,
        );
        (n, info.assume_init())
    };
    (written == size && info.pbi_pid == pid.unsigned_abs()).then_some(info)
}

/// The executable the kernel runs as `pid`.
fn executable(pid: u32) -> Option<PathBuf> {
    let pid = c_int::try_from(pid).ok()?;
    let mut buf = vec![0u8; usize::try_from(libc::PROC_PIDPATHINFO_MAXSIZE).ok()?];
    let cap = u32::try_from(buf.len()).ok()?;
    // SAFETY: `buf` is writable for `cap` bytes and the kernel writes at most that many, returning how many it wrote.
    #[allow(
        unsafe_code,
        reason = "the libproc call that names a process's executable; see the SAFETY note"
    )]
    let n = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast::<c_void>(), cap) };
    let n = usize::try_from(n)
        .ok()
        .filter(|n| *n > 0 && *n <= buf.len())?;
    buf.truncate(n);
    Some(PathBuf::from(OsStr::from_bytes(&buf)))
}

/// The argument and environment block of `pid` as the kernel copied it at `exec` (`KERN_PROCARGS2`).
fn procargs(pid: u32) -> Option<Vec<u8>> {
    let pid = c_int::try_from(pid).ok()?;
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut len: libc::size_t = 0;
    // SAFETY: a size query (null buffer): the kernel writes only `len`.
    #[allow(unsafe_code, reason = "the sysctl size query; see the SAFETY note")]
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            std::ptr::null_mut(),
            &raw mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || len == 0 || len > MAX_ARGS {
        return None;
    }
    let mut buf = vec![0u8; len];
    // SAFETY: `buf` is writable for `len` bytes; the kernel writes at most `len` and stores how many it wrote in `len`.
    #[allow(
        unsafe_code,
        reason = "the sysctl read of the block; see the SAFETY note"
    )]
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr().cast::<c_void>(),
            &raw mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || len > buf.len() {
        return None;
    }
    buf.truncate(len);
    Some(buf)
}

/// The environment entries of a `KERN_PROCARGS2` block: `argc` (a native `int`), the executable's path, padding NULs,
/// `argc` arguments, then the environment, each NUL-terminated, up to an empty string or the end. `None` when the block is
/// not that shape.
pub(crate) fn environment_of(block: &[u8]) -> Option<Vec<&[u8]>> {
    let argc = usize::try_from(i32::from_ne_bytes(block.get(..4)?.try_into().ok()?)).ok()?;
    let mut rest = block.get(4..)?;
    // the executable's path, then the NULs that pad it
    let end = rest.iter().position(|b| *b == 0)?;
    rest = &rest[end..];
    let start = rest.iter().position(|b| *b != 0)?;
    rest = &rest[start..];
    let mut strings = rest.split(|b| *b == 0);
    for _ in 0..argc {
        strings.next()?;
    }
    Some(strings.take_while(|s| !s.is_empty()).collect())
}

impl Procs for Os {
    fn describe(&self, pid: u32) -> Option<Proc> {
        let info = bsd_info(pid)?;
        let start = info
            .pbi_start_tvsec
            .checked_mul(1_000_000)?
            .checked_add(info.pbi_start_tvusec)?;
        Some(Proc {
            pid,
            start: Some(start),
            exe: Some(executable(pid)?),
        })
    }

    fn parent(&self, pid: u32) -> Option<u32> {
        bsd_info(pid).map(|i| i.pbi_ppid)
    }

    fn started_with(&self, pid: u32, entry: &str) -> Option<bool> {
        let block = procargs(pid)?;
        let env = environment_of(&block)?;
        Some(env.contains(&entry.as_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(count: i32, exe: &str, pad: usize, args: &[&str], env: &[&str]) -> Vec<u8> {
        let mut b = count.to_ne_bytes().to_vec();
        b.extend_from_slice(exe.as_bytes());
        b.extend(std::iter::repeat_n(0u8, 1 + pad));
        for s in args.iter().chain(env) {
            b.extend_from_slice(s.as_bytes());
            b.push(0);
        }
        b.push(0);
        b
    }

    #[test]
    fn the_environment_follows_the_arguments_and_ends_at_an_empty_string() {
        let b = block(
            2,
            "/usr/bin/python3",
            5,
            &["python3", "-c"],
            &["A=1", "TOKEN=x"],
        );
        assert_eq!(environment_of(&b).unwrap(), vec![&b"A=1"[..], b"TOKEN=x"]);
        // an argument that looks like an entry is still an argument
        let b = block(2, "/bin/sh", 0, &["sh", "TOKEN=x"], &["A=1"]);
        assert_eq!(environment_of(&b).unwrap(), vec![&b"A=1"[..]]);
        // no environment at all
        let b = block(1, "/bin/sh", 2, &["sh"], &[]);
        assert!(environment_of(&b).unwrap().is_empty());
    }

    #[test]
    fn a_block_of_another_shape_is_not_read() {
        assert!(environment_of(&[]).is_none());
        assert!(environment_of(&[1, 0, 0]).is_none());
        // more arguments announced than the block holds
        let b = block(9, "/bin/sh", 0, &["sh"], &[]);
        assert!(environment_of(&b).is_none());
        // a negative count
        let b = block(-1, "/bin/sh", 0, &["sh"], &[]);
        assert!(environment_of(&b).is_none());
    }
}
