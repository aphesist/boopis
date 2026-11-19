//! Raw Linux calls: Landlock, namespaces, capabilities, descriptor hygiene, fork probes.
//!
//! This is the only place in the Linux backend with `unsafe`. Everything here is either a thin
//! call whose arguments are valid by construction (commented at each block) or runs in the
//! forked child before `exec`, where only async-signal-safe calls are allowed: no allocation,
//! no locks, no formatting. Functions meant for the child are marked `child_`.
#![allow(
    unsafe_code,
    reason = "syscalls with no safe std wrapper (landlock, unshare, capset, close_range, fork); every block is commented"
)]

use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

/// Landlock access bits (see `include/uapi/linux/landlock.h`).
pub(super) mod access {
    pub const EXECUTE: u64 = 1 << 0;
    pub const WRITE_FILE: u64 = 1 << 1;
    pub const READ_FILE: u64 = 1 << 2;
    pub const READ_DIR: u64 = 1 << 3;
    pub const REMOVE_DIR: u64 = 1 << 4;
    pub const REMOVE_FILE: u64 = 1 << 5;
    pub const MAKE_CHAR: u64 = 1 << 6;
    pub const MAKE_DIR: u64 = 1 << 7;
    pub const MAKE_REG: u64 = 1 << 8;
    pub const MAKE_SOCK: u64 = 1 << 9;
    pub const MAKE_FIFO: u64 = 1 << 10;
    pub const MAKE_BLOCK: u64 = 1 << 11;
    pub const MAKE_SYM: u64 = 1 << 12;
    /// ABI 2.
    pub const REFER: u64 = 1 << 13;
    /// ABI 3.
    pub const TRUNCATE: u64 = 1 << 14;
    /// ABI 5.
    pub const IOCTL_DEV: u64 = 1 << 15;

    /// Scope flags (ABI 6).
    pub const SCOPE_ABSTRACT_UNIX_SOCKET: u64 = 1 << 0;
    /// Scope flag (ABI 6): no signals to processes outside the domain.
    pub const SCOPE_SIGNAL: u64 = 1 << 1;
}

const LANDLOCK_CREATE_RULESET_VERSION: libc::c_ulong = 1;
const LANDLOCK_RULE_PATH_BENEATH: libc::c_int = 1;

#[repr(C)]
struct RulesetAttr {
    handled_access_fs: u64,
    handled_access_net: u64,
    scoped: u64,
}

// The kernel declares this struct packed.
#[repr(C, packed)]
struct PathBeneathAttr {
    allowed_access: u64,
    parent_fd: i32,
}

fn errno() -> i32 {
    io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or(libc::EIO)
}

/// The Landlock ABI version the kernel offers, or the errno explaining why it offers none
/// (`ENOSYS`: not built; `EOPNOTSUPP`: built but disabled at boot).
pub(super) fn landlock_abi() -> Result<u32, i32> {
    // SAFETY: a null attribute with size 0 and the VERSION flag is the documented way to ask
    // for the ABI version; the kernel reads no memory.
    let rc = unsafe {
        libc::syscall(
            libc::SYS_landlock_create_ruleset,
            std::ptr::null::<RulesetAttr>(),
            0usize,
            LANDLOCK_CREATE_RULESET_VERSION,
        )
    };
    if rc < 0 {
        Err(errno())
    } else {
        Ok(u32::try_from(rc).unwrap_or(0))
    }
}

/// A Landlock ruleset fd, created in the parent and enforced in the child.
pub(super) struct Ruleset {
    fd: OwnedFd,
}

impl Ruleset {
    /// Creates a ruleset that handles (denies by default) the given accesses and scopes.
    pub(super) fn new(handled_fs: u64, scoped: u64) -> io::Result<Self> {
        let attr = RulesetAttr {
            handled_access_fs: handled_fs,
            handled_access_net: 0,
            scoped,
        };
        // SAFETY: `attr` is a live, correctly laid out struct and the size passed is its size.
        let rc = unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                &raw const attr,
                std::mem::size_of::<RulesetAttr>(),
                0 as libc::c_ulong,
            )
        };
        if rc < 0 {
            return Err(io::Error::last_os_error());
        }
        let raw = RawFd::try_from(rc).map_err(|_| io::Error::other("landlock fd out of range"))?;
        // SAFETY: the syscall just returned this fd; nothing else owns it. The kernel sets
        // O_CLOEXEC on it.
        Ok(Self {
            fd: unsafe { OwnedFd::from_raw_fd(raw) },
        })
    }

    /// Grants `access` beneath `path`. The caller has already masked `access` to what the
    /// object kind allows. `expect_dir` guards against the object having changed kind since
    /// the policy was resolved.
    pub(super) fn allow_path(&self, path: &Path, access: u64, expect_dir: bool) -> io::Result<()> {
        let c = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
        // SAFETY: `c` is a valid NUL-terminated string. O_NOFOLLOW makes a swapped-in symlink
        // fail rather than grant its target.
        let raw = unsafe {
            libc::open(
                c.as_ptr(),
                libc::O_PATH | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: open succeeded, so `raw` is a fresh descriptor we own.
        let parent = unsafe { OwnedFd::from_raw_fd(raw) };

        // SAFETY: zeroed `stat` is a valid output buffer for fstat on an open fd.
        let mut st: libc::stat = unsafe { std::mem::zeroed() };
        // SAFETY: `parent` is open and `st` is a valid, writable stat.
        if unsafe { libc::fstat(parent.as_raw_fd(), &raw mut st) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let is_dir = (st.st_mode & libc::S_IFMT) == libc::S_IFDIR;
        if is_dir != expect_dir {
            return Err(io::Error::other(format!(
                "{} changed kind (directory/file) since the policy was resolved",
                path.display()
            )));
        }

        let attr = PathBeneathAttr {
            allowed_access: access,
            parent_fd: parent.as_raw_fd(),
        };
        // SAFETY: `attr` has the kernel's packed layout, `self.fd` is a ruleset fd and
        // `parent` an open O_PATH fd, both alive for the call.
        let rc = unsafe {
            libc::syscall(
                libc::SYS_landlock_add_rule,
                self.fd.as_raw_fd(),
                LANDLOCK_RULE_PATH_BENEATH,
                &raw const attr,
                0 as libc::c_uint,
            )
        };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub(super) fn raw_fd(&self) -> RawFd {
        self.fd.as_raw_fd()
    }
}

// ------------------------------------------------------------------------------------------
// Child-side helpers. Async-signal-safe: raw syscalls only.
// ------------------------------------------------------------------------------------------

pub(super) fn child_unshare(flags: libc::c_int) -> Result<(), i32> {
    // SAFETY: unshare takes only flags.
    if unsafe { libc::unshare(flags) } < 0 {
        Err(errno())
    } else {
        Ok(())
    }
}

/// After `unshare(CLONE_NEWPID)`: forks. The child (the namespace's init, pid 1 inside) gets
/// `Ok(())` and goes on to become the program. The parent becomes a supervisor: it closes every
/// descriptor it does not need (the standard library's exec-status pipe among them, so the
/// host's spawn is not held up), waits for the init, and ends the same way the init did.
pub(super) fn child_become_pid_namespace_init() -> Result<(), i32> {
    // SAFETY: fork has no arguments; the supervisor branch below calls only
    // async-signal-safe functions and never returns.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(errno());
    }
    if pid == 0 {
        return Ok(());
    }
    // SAFETY: close_range takes integers only. Descriptors 0-2 stay (the output pipes).
    unsafe {
        libc::syscall(
            libc::SYS_close_range,
            3 as libc::c_uint,
            u32::MAX,
            0 as libc::c_uint,
        );
    }
    let mut status = 0;
    loop {
        // SAFETY: waits for our own child; `status` is a valid out-pointer.
        let r = unsafe { libc::waitpid(pid, &raw mut status, 0) };
        if r == pid {
            break;
        }
        if r < 0 && errno() != libc::EINTR {
            // SAFETY: `_exit` skips destructors, as a forked child must.
            unsafe { libc::_exit(127) }
        }
    }
    mirror_exit(status)
}

/// Ends this process the way a child that returned `status` from `waitpid` ended: the same
/// exit code, or the same fatal signal, so the host sees the program's outcome and not the
/// supervisor's. Never returns.
fn mirror_exit(status: libc::c_int) -> ! {
    if libc::WIFSIGNALED(status) {
        let sig = libc::WTERMSIG(status);
        // SAFETY: restore the default action then raise the same signal, so the host sees the
        // same "killed by signal" outcome the init had.
        unsafe {
            libc::signal(sig, libc::SIG_DFL);
            libc::kill(libc::getpid(), sig);
        }
        // SAFETY: only reached if the signal was ignored or blocked.
        unsafe { libc::_exit(128 + sig) }
    }
    // SAFETY: `_exit` skips destructors, as a forked child must.
    unsafe { libc::_exit(libc::WEXITSTATUS(status)) }
}

/// The signal the host sends a subreaper supervisor to say "end everything now". `SIGKILL`
/// cannot be used: it would kill the supervisor first, and its orphans with it gone would
/// belong to `init`, out of reach.
pub(super) const SUPERVISOR_KILL_SIGNAL: libc::c_int = libc::SIGUSR1;

/// Makes this process the supervisor of a tree on a host without PID namespaces. It becomes a
/// child subreaper (every orphaned descendant is reparented to it instead of `init`, even one
/// that called `setsid`), forks the program, and watches. The program continues in the child
/// (this returns `Ok(())` there, with the original signal mask restored). The supervisor never
/// returns: when the program exits, or the host sends [`SUPERVISOR_KILL_SIGNAL`], it kills every
/// process it parents, again and again until none is left, and ends like the program did.
///
/// Like the PID-namespace supervisor it closes every descriptor above 2, which includes the
/// standard library's exec-status pipe, so the host's spawn is not held up.
pub(super) fn child_become_subreaper_supervisor() -> Result<(), i32> {
    // SAFETY: prctl with integer arguments.
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1 as libc::c_ulong, 0, 0, 0) } < 0 {
        return Err(errno());
    }
    // SAFETY: sigset_t is plain data; the set functions only write into the buffers given.
    let (wait_set, block, mut old) = unsafe {
        let mut wait: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&raw mut wait);
        libc::sigaddset(&raw mut wait, libc::SIGCHLD);
        libc::sigaddset(&raw mut wait, SUPERVISOR_KILL_SIGNAL);
        // The polite stop is a SIGTERM to the whole group, which includes this process: it has
        // to survive it, and the others a terminal or a stray `kill` could send.
        let mut block = wait;
        for sig in [
            libc::SIGTERM,
            libc::SIGHUP,
            libc::SIGINT,
            libc::SIGQUIT,
            libc::SIGUSR2,
        ] {
            libc::sigaddset(&raw mut block, sig);
        }
        (wait, block, std::mem::zeroed::<libc::sigset_t>())
    };
    // SAFETY: both sets are valid; single-threaded after fork, so sigprocmask is the right call.
    if unsafe { libc::sigprocmask(libc::SIG_BLOCK, &raw const block, &raw mut old) } < 0 {
        return Err(errno());
    }
    // SAFETY: fork has no arguments; the supervisor branch calls only async-signal-safe
    // functions and never returns.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(errno());
    }
    if pid == 0 {
        // SAFETY: `old` is the mask this process had before; restoring it is always valid.
        unsafe { libc::sigprocmask(libc::SIG_SETMASK, &raw const old, std::ptr::null_mut()) };
        return Ok(());
    }
    // SAFETY: close_range takes integers only. Descriptors 0-2 stay (the output pipes).
    unsafe {
        libc::syscall(
            libc::SYS_close_range,
            3 as libc::c_uint,
            u32::MAX,
            0 as libc::c_uint,
        );
    }
    supervise(pid, &wait_set)
}

/// The supervisor's loop. See [`child_become_subreaper_supervisor`].
fn supervise(program: libc::pid_t, wait_set: &libc::sigset_t) -> ! {
    let mut program_status: Option<libc::c_int> = None;
    let mut sweeping = false;
    loop {
        // Collect every child that has already ended.
        loop {
            let mut status = 0;
            // SAFETY: `status` is a valid out-pointer.
            let r = unsafe { libc::waitpid(-1, &raw mut status, libc::WNOHANG) };
            if r > 0 {
                if r == program {
                    program_status = Some(status);
                    sweeping = true;
                }
                continue;
            }
            if r == 0 {
                break;
            }
            if errno() == libc::EINTR {
                continue;
            }
            // ECHILD: nothing is left, so the tree is over.
            match program_status {
                Some(status) => mirror_exit(status),
                // SAFETY: `_exit` skips destructors, as a forked child must.
                None => unsafe { libc::_exit(127) },
            }
        }
        if sweeping {
            if !child_kill_children() {
                // No way to list the orphans (the probe checked this works, so only a vanished
                // /proc gets here): end the program itself and let the host's group kill do the rest.
                // SAFETY: kill takes two integers.
                unsafe { libc::kill(program, libc::SIGKILL) };
            }
            let pause = libc::timespec {
                tv_sec: 0,
                tv_nsec: 1_000_000,
            };
            // SAFETY: `pause` is a valid timespec; a null remainder is allowed.
            unsafe { libc::nanosleep(&raw const pause, std::ptr::null_mut()) };
            continue;
        }
        // Nothing to do until a child changes state or the host asks for the end. The timeout
        // is only a backstop; signals are not lost while they are blocked.
        let timeout = libc::timespec {
            tv_sec: 0,
            tv_nsec: 200_000_000,
        };
        // SAFETY: an all-zero siginfo is a valid out-buffer; the set and timeout are valid.
        let got = unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            libc::sigtimedwait(wait_set, &raw mut info, &raw const timeout)
        };
        if got == SUPERVISOR_KILL_SIGNAL {
            sweeping = true;
        }
    }
}

/// Sends SIGKILL to every child of this (single-threaded) process, from
/// `/proc/thread-self/children`. Returns false when that file cannot be read.
pub(super) fn child_kill_children() -> bool {
    // SAFETY: NUL-terminated literal path.
    let fd = unsafe {
        libc::open(
            c"/proc/thread-self/children".as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return false;
    }
    let mut buf = [0u8; 512];
    let (mut pid, mut inside) = (0i32, false);
    loop {
        // SAFETY: `buf` is a valid writable buffer of the length passed.
        let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
        if n < 0 && errno() == libc::EINTR {
            continue;
        }
        let Ok(n) = usize::try_from(n) else { break };
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte.is_ascii_digit() {
                pid = pid
                    .saturating_mul(10)
                    .saturating_add(i32::from(byte - b'0'));
                inside = true;
            } else {
                if inside && pid > 1 {
                    // SAFETY: kill takes two integers.
                    unsafe { libc::kill(pid, libc::SIGKILL) };
                }
                (pid, inside) = (0, false);
            }
        }
    }
    if inside && pid > 1 {
        // SAFETY: kill takes two integers.
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    // SAFETY: `fd` is ours.
    unsafe { libc::close(fd) };
    true
}

/// Writes `data` to the file at `path` (used for the `/proc/self/*_map` files).
pub(super) fn child_write_file(path: &std::ffi::CStr, data: &[u8]) -> Result<(), i32> {
    // SAFETY: `path` is NUL-terminated.
    let fd = unsafe { libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC) };
    if fd < 0 {
        return Err(errno());
    }
    // SAFETY: `data` is a valid buffer of the stated length; `fd` is open.
    let n = unsafe { libc::write(fd, data.as_ptr().cast(), data.len()) };
    let err = errno();
    // SAFETY: `fd` is ours.
    unsafe { libc::close(fd) };
    if usize::try_from(n).is_ok_and(|n| n == data.len()) {
        Ok(())
    } else {
        Err(err)
    }
}

/// Brings the loopback interface up inside a fresh network namespace.
pub(super) fn child_loopback_up() -> Result<(), i32> {
    // SAFETY: no pointers.
    let sock = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, 0) };
    if sock < 0 {
        return Err(errno());
    }
    // SAFETY: an all-zero ifreq is valid.
    let mut ifr: libc::ifreq = unsafe { std::mem::zeroed() };
    for (slot, byte) in ifr.ifr_name.iter_mut().zip(b"lo") {
        #[allow(
            clippy::cast_possible_wrap,
            reason = "ASCII bytes fit c_char on every target"
        )]
        {
            *slot = *byte as libc::c_char;
        }
    }
    let result = (|| {
        // SAFETY: `ifr` is a valid ifreq for SIOCGIFFLAGS, `sock` is open.
        if unsafe { libc::ioctl(sock, libc::SIOCGIFFLAGS, &raw mut ifr) } < 0 {
            return Err(errno());
        }
        let up =
            libc::c_short::try_from(libc::IFF_UP | libc::IFF_RUNNING).map_err(|_| libc::EINVAL)?;
        // SAFETY: the kernel just filled the flags member of the union.
        unsafe {
            ifr.ifr_ifru.ifru_flags |= up;
        }
        // SAFETY: as above, for SIOCSIFFLAGS.
        if unsafe { libc::ioctl(sock, libc::SIOCSIFFLAGS, &raw mut ifr) } < 0 {
            return Err(errno());
        }
        Ok(())
    })();
    // SAFETY: `sock` is ours.
    unsafe { libc::close(sock) };
    result
}

#[repr(C)]
struct CapHeader {
    version: u32,
    pid: i32,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CapData {
    effective: u32,
    permitted: u32,
    inheritable: u32,
}
const LINUX_CAPABILITY_VERSION_3: u32 = 0x2008_0522;

/// Empties the effective, permitted and inheritable capability sets of this thread.
pub(super) fn child_clear_capabilities() -> Result<(), i32> {
    let header = CapHeader {
        version: LINUX_CAPABILITY_VERSION_3,
        pid: 0,
    };
    let data = [CapData {
        effective: 0,
        permitted: 0,
        inheritable: 0,
    }; 2];
    // SAFETY: header and a two-element data array are what capset(2) v3 expects.
    let rc = unsafe { libc::syscall(libc::SYS_capset, &raw const header, data.as_ptr()) };
    if rc < 0 { Err(errno()) } else { Ok(()) }
}

/// Drops every capability from the bounding set, so `exec` of a root-owned or setuid program
/// cannot bring any back. Needs `CAP_SETPCAP`; the caller decides whether that is expected.
pub(super) fn child_drop_bounding_set(last_cap: u32) -> Result<(), i32> {
    for cap in 0..=libc::c_ulong::from(last_cap) {
        // SAFETY: prctl with integer arguments.
        if unsafe { libc::prctl(libc::PR_CAPBSET_DROP, cap, 0, 0, 0) } < 0 {
            let e = errno();
            if e != libc::EINVAL {
                return Err(e);
            }
        }
    }
    Ok(())
}

pub(super) fn child_no_new_privs() -> Result<(), i32> {
    // SAFETY: prctl with integer arguments.
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1 as libc::c_ulong, 0, 0, 0) } < 0 {
        Err(errno())
    } else {
        Ok(())
    }
}

pub(super) fn child_landlock_restrict(fd: RawFd) -> Result<(), i32> {
    // SAFETY: the fd is a ruleset fd owned by the parent; flags are zero.
    let rc = unsafe { libc::syscall(libc::SYS_landlock_restrict_self, fd, 0 as libc::c_uint) };
    if rc < 0 { Err(errno()) } else { Ok(()) }
}

/// Marks every descriptor from 3 up close-on-exec, so nothing opened by other code in this
/// process (a C library, say) leaks into the program. Descriptors are *marked*, not closed,
/// because the standard library's own exec-failure pipe is open at this point and closing it
/// would hide a failed `exec`. The one descriptor meant to be inherited is un-marked afterwards.
pub(super) fn child_cloexec_all() {
    const CLOSE_RANGE_CLOEXEC: libc::c_uint = 1 << 2;
    // SAFETY: close_range takes integers only.
    let rc = unsafe {
        libc::syscall(
            libc::SYS_close_range,
            3 as libc::c_uint,
            u32::MAX,
            CLOSE_RANGE_CLOEXEC,
        )
    };
    if rc == 0 {
        return;
    }
    // Kernels before 5.11: walk a bounded range.
    for fd in 3..4096 {
        // SAFETY: fcntl on an arbitrary descriptor number is memory-safe; EBADF is ignored.
        unsafe {
            libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
        }
    }
}

// ------------------------------------------------------------------------------------------
// Probes.
// ------------------------------------------------------------------------------------------

/// Runs `body` in a forked child and reports whether it returned `true`. The body must be
/// async-signal-safe (no allocation): the parent may have other threads, and the child owns
/// only a copy of the calling thread.
pub(super) fn fork_probe(body: impl FnOnce() -> bool) -> bool {
    // SAFETY: fork has no arguments. In the child we call only `body` (async-signal-safe by
    // contract) and `_exit`, never returning into the caller's frames.
    let pid = unsafe { libc::fork() };
    match pid {
        0 => {
            let ok = body();
            // SAFETY: `_exit` skips atexit handlers and destructors, which is what a
            // forked child of a multithreaded process must do.
            unsafe { libc::_exit(i32::from(!ok)) }
        }
        p if p < 0 => false,
        p => {
            let mut status = 0;
            loop {
                // SAFETY: waits for our own child; `status` is a valid out-pointer.
                let r = unsafe { libc::waitpid(p, &raw mut status, 0) };
                if r == p {
                    break;
                }
                if r < 0 && errno() != libc::EINTR {
                    return false;
                }
            }
            libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0
        }
    }
}

/// The body of the subreaper probe, run in a forked child: become a subreaper, let a grandchild
/// be orphaned, and check that it comes back as a child that can be listed and killed.
pub(super) fn child_probe_subreaper() -> bool {
    // SAFETY: alarm takes an integer; it ends this probe if anything below blocks.
    unsafe { libc::alarm(5) };
    // SAFETY: prctl with integer arguments.
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1 as libc::c_ulong, 0, 0, 0) } < 0 {
        return false;
    }
    // SAFETY: fork has no arguments; the branches below call only async-signal-safe functions
    // and end in `_exit` or `pause`.
    let middle = unsafe { libc::fork() };
    if middle < 0 {
        return false;
    }
    if middle == 0 {
        // SAFETY: as above; the grandchild waits (alarm bounds it) and the middle one leaves.
        unsafe {
            if libc::fork() == 0 {
                libc::alarm(10);
                loop {
                    libc::pause();
                }
            }
            libc::_exit(0)
        }
    }
    let mut status = 0;
    // SAFETY: waits for our own child; `status` is a valid out-pointer.
    if unsafe { libc::waitpid(middle, &raw mut status, 0) } != middle {
        return false;
    }
    if !child_kill_children() {
        return false;
    }
    // SAFETY: `status` is a valid out-pointer; this reaps the orphan that came back to us.
    let reaped = unsafe { libc::waitpid(-1, &raw mut status, 0) };
    reaped > 0 && libc::WIFSIGNALED(status) && libc::WTERMSIG(status) == libc::SIGKILL
}

/// Forks a probe child that moves itself into the cgroup whose `cgroup.procs` is `procs`, then
/// waits (at most five seconds) to be killed. It exits with status 3 when the move fails.
pub(super) fn fork_cgroup_member(procs: &std::ffi::CStr) -> io::Result<libc::pid_t> {
    // SAFETY: fork has no arguments; the child makes only async-signal-safe calls and ends in
    // `_exit`.
    let pid = unsafe { libc::fork() };
    match pid {
        0 => {
            if child_write_file(procs, b"0").is_err() {
                // SAFETY: `_exit` skips destructors, as a forked child must.
                unsafe { libc::_exit(3) }
            }
            // SAFETY: alarm and pause take no pointers; `_exit` as above.
            unsafe {
                libc::alarm(5);
                libc::pause();
                libc::_exit(4)
            }
        }
        p if p < 0 => Err(io::Error::last_os_error()),
        p => Ok(p),
    }
}

/// The wait status of `pid` if it has ended, without blocking.
pub(super) fn try_wait_status(pid: libc::pid_t) -> Option<libc::c_int> {
    let mut status = 0;
    // SAFETY: waits for our own child; `status` is a valid out-pointer.
    (unsafe { libc::waitpid(pid, &raw mut status, libc::WNOHANG) } == pid).then_some(status)
}

/// The wait status of `pid`, waiting for it to end.
pub(super) fn wait_status(pid: libc::pid_t) -> Option<libc::c_int> {
    let mut status = 0;
    loop {
        // SAFETY: waits for our own child; `status` is a valid out-pointer.
        let r = unsafe { libc::waitpid(pid, &raw mut status, 0) };
        if r == pid {
            return Some(status);
        }
        if r < 0 && errno() != libc::EINTR {
            return None;
        }
    }
}

/// Whether opening `/dev/null` for writing fails with EACCES (the Landlock probe's check).
pub(super) fn child_write_dev_null_denied() -> bool {
    // SAFETY: NUL-terminated literal path.
    let fd = unsafe { libc::open(c"/dev/null".as_ptr(), libc::O_WRONLY) };
    if fd >= 0 {
        // SAFETY: `fd` is ours.
        unsafe { libc::close(fd) };
        return false;
    }
    errno() == libc::EACCES
}

/// Whether creating a TCP socket fails with EPERM (the seccomp probe's check).
pub(super) fn child_inet_socket_denied() -> bool {
    // SAFETY: no pointers.
    let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    if fd >= 0 {
        // SAFETY: `fd` is ours.
        unsafe { libc::close(fd) };
        return false;
    }
    errno() == libc::EPERM
}

/// The calling process's real and effective ids.
pub(super) fn ids() -> (u32, u32, u32) {
    // SAFETY: no arguments, cannot fail.
    unsafe { (libc::getuid(), libc::getgid(), libc::geteuid()) }
}
