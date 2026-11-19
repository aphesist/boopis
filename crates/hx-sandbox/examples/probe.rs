//! A small program the integration tests run inside the sandbox to observe what it allows.
//!
//! Every subcommand prints what it saw on stdout and exits 0 on success, 3 on an expected
//! failure (so a test can tell "blocked" from "crashed"). It is also handy by hand:
//! `cargo run -p hx-sandbox --example probe -- env`.
#![allow(
    unsafe_code,
    reason = "a test helper that makes raw syscalls (ptrace, io_uring_setup) to see whether the sandbox denies them"
)]
#![allow(missing_docs, reason = "an example binary, not a public API")]
#![allow(
    clippy::too_many_lines,
    reason = "one flat dispatch table of independent probes reads better than many functions"
)]
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::decimal_bitwise_operands,
    reason = "raw socket and syscall structures: sizes, families and flags as the C interfaces take them"
)]
#![allow(
    clippy::duration_suboptimal_units,
    reason = "seconds are the unit the tests reason in"
)]

use std::io::Write;
use std::path::Path;

fn fail(msg: impl std::fmt::Display) -> ! {
    println!("err: {msg}");
    std::process::exit(3)
}

/// Writes an ever-increasing counter to `path` every 50 ms, forever. Each beat goes to a
/// temporary file that is renamed over `path`, so a reader never sees the empty file that a
/// truncate-then-write leaves for a moment.
fn heartbeat(path: &str) -> ! {
    let tmp = format!("{path}.tmp");
    let mut n = 0u64;
    loop {
        if std::fs::write(&tmp, n.to_string()).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
        n += 1;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// `TYPE[,nonblock][,cloexec]` as the `type` argument of `socket(2)`.
#[cfg(target_os = "linux")]
fn socket_type(spec: &str) -> libc::c_int {
    let mut parts = spec.split(',');
    let mut kind = match parts.next().unwrap_or("") {
        "stream" => libc::SOCK_STREAM,
        "dgram" => libc::SOCK_DGRAM,
        "raw" => libc::SOCK_RAW,
        "seqpacket" => libc::SOCK_SEQPACKET,
        "rdm" => libc::SOCK_RDM,
        other => fail(format!("unknown socket type {other}")),
    };
    for flag in parts {
        kind |= match flag {
            "nonblock" => libc::SOCK_NONBLOCK,
            "cloexec" => libc::SOCK_CLOEXEC,
            other => fail(format!("unknown socket flag {other}")),
        };
    }
    kind
}

/// Prints the result of a raw syscall the way the tests read it: `ret N` or `errno N`, exit 3
/// when the call failed.
#[cfg(target_os = "linux")]
fn report_syscall(rc: i64) {
    if rc < 0 {
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
        println!("errno {errno}");
        std::process::exit(3);
    }
    println!("ret {rc}");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| {
        args.get(i)
            .map_or_else(|| fail("missing argument"), String::as_str)
    };
    match arg(0) {
        "write" => match std::fs::write(arg(1), b"probe") {
            Ok(()) => println!("ok"),
            Err(e) => fail(e),
        },
        "read" => match std::fs::read_to_string(arg(1)) {
            Ok(s) => println!("ok {s}"),
            Err(e) => fail(e),
        },
        "list" => match std::fs::read_dir(arg(1)) {
            Ok(rd) => println!("ok {}", rd.count()),
            Err(e) => fail(e),
        },
        "remove" => match std::fs::remove_file(arg(1)) {
            Ok(()) => println!("ok"),
            Err(e) => fail(e),
        },
        "rename" => match std::fs::rename(arg(1), arg(2)) {
            Ok(()) => println!("ok"),
            Err(e) => fail(e),
        },
        "truncate" => match std::fs::OpenOptions::new()
            .write(true)
            .open(arg(1))
            .and_then(|f| f.set_len(0))
        {
            Ok(()) => println!("ok"),
            Err(e) => fail(e),
        },
        #[cfg(unix)]
        "exec" => {
            use std::os::unix::process::CommandExt;
            let e = std::process::Command::new(arg(1)).exec();
            fail(e)
        }
        "connect" => match std::net::TcpStream::connect(arg(1)) {
            Ok(_) => println!("ok"),
            Err(e) => fail(e),
        },
        "udp" => {
            let r = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| s.send_to(b"x", arg(1)));
            match r {
                Ok(_) => println!("ok"),
                Err(e) => fail(e),
            }
        }
        #[cfg(unix)]
        "unix" => match std::os::unix::net::UnixStream::connect(arg(1)) {
            Ok(_) => println!("ok"),
            Err(e) => fail(e),
        },
        #[cfg(unix)]
        "unixread" => {
            // probe unixread PATH: connect to a Unix socket and say what the other side does:
            // `data` (it talks to us), `eof` (it closed on us), or an error. A channel that
            // refuses this process closes the connection without a word.
            use std::io::Read;
            let mut stream = std::os::unix::net::UnixStream::connect(arg(1))
                .unwrap_or_else(|e| fail(format!("connect: {e}")));
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
            let mut byte = [0u8; 1];
            match stream.read(&mut byte) {
                Ok(0) => println!("eof"),
                Ok(_) => println!("data"),
                Err(e) => println!("err {e}"),
            }
        }
        "selfconnect" => {
            let r = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| {
                let addr = l.local_addr()?;
                let _c = std::net::TcpStream::connect(addr)?;
                l.accept().map(|_| ())
            });
            match r {
                Ok(()) => println!("ok"),
                Err(e) => fail(e),
            }
        }
        "env" => {
            let mut vars: Vec<_> = std::env::vars().collect();
            vars.sort();
            for (k, v) in vars {
                println!("{k}={v}");
            }
        }
        "status" => {
            // The lines of /proc/self/status that show the sandbox from the inside.
            let s = std::fs::read_to_string("/proc/self/status").unwrap_or_else(|e| fail(e));
            for l in s.lines().filter(|l| {
                [
                    "NoNewPrivs",
                    "Seccomp:",
                    "CapEff",
                    "CapBnd",
                    "CapPrm",
                    "CapInh",
                ]
                .iter()
                .any(|p| l.starts_with(p))
            }) {
                println!("{l}");
            }
        }
        #[cfg(unix)]
        "ids" => {
            // SAFETY: getsid/getpgid/getpid have no preconditions.
            let ids = unsafe { [libc::getpid(), libc::getpgid(0), libc::getsid(0)] };
            println!("{} {} {}", ids[0], ids[1], ids[2]);
        }
        "flood" => {
            let n: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            let to_err = args.get(2).is_some_and(|s| s == "stderr");
            let chunk = vec![b'a'; 8192];
            let mut left = n;
            while left > 0 {
                let k = left.min(chunk.len());
                let r = if to_err {
                    std::io::stderr().write_all(&chunk[..k])
                } else {
                    std::io::stdout().write_all(&chunk[..k])
                };
                if r.is_err() {
                    fail("write failed");
                }
                left -= k;
            }
        }
        "exit" => std::process::exit(arg(1).parse().unwrap_or(1)),
        "sleep" => std::thread::sleep(std::time::Duration::from_secs(arg(1).parse().unwrap_or(1))),
        "tree" => {
            // probe tree BASE: this process, a child and a grandchild, each writing a heartbeat
            // file (BASE.top, BASE.mid, BASE.leaf). The tests judge liveness by the heartbeat
            // stopping, because pids inside a PID namespace mean nothing outside it.
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            let base = arg(1).to_owned();
            let top = format!("{base}.top");
            std::thread::spawn(move || heartbeat(&top));
            let mut mid = std::process::Command::new(me)
                .args(["mid", &base])
                .spawn()
                .unwrap_or_else(|e| fail(e));
            let _ = mid.wait();
        }
        "mid" => {
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            let base = arg(1).to_owned();
            let path = format!("{base}.mid");
            std::thread::spawn(move || heartbeat(&path));
            let mut leaf = std::process::Command::new(me)
                .args(["leaf", &base])
                .spawn()
                .unwrap_or_else(|e| fail(e));
            let _ = leaf.wait();
        }
        "leaf" => heartbeat(&format!("{}.leaf", arg(1))),
        "heartbeat" => heartbeat(arg(1)),
        "escape" => {
            // probe escape BASE: a child that leaves the process group with setsid, then lives on.
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            let base = arg(1).to_owned();
            let top = format!("{base}.top");
            std::thread::spawn(move || heartbeat(&top));
            let mut child = std::process::Command::new(me)
                .args(["detached", &base])
                .spawn()
                .unwrap_or_else(|e| fail(e));
            let _ = child.wait();
        }
        #[cfg(unix)]
        "detached" => {
            // SAFETY: setsid has no arguments.
            unsafe { libc::setsid() };
            heartbeat(&format!("{}.escaped", arg(1)));
        }
        #[cfg(unix)]
        "forkbomb" => {
            // probe forkbomb N: start up to N sleeping children and say how many started.
            //
            // Raw `fork`, not `Command::spawn`: with a `pre_exec` hook (which glibc 2.35's
            // `posix_spawn` needs avoided, because it reports any clone failure as EPERM and so
            // hides the EAGAIN the kernel gave when RLIMIT_NPROC stopped the bomb) the standard
            // library reports the child's exec status through a `SOCK_SEQPACKET` socket pair,
            // which the sandbox denies by design when the network is off.
            let n: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            let mut kids: Vec<libc::pid_t> = Vec::new();
            let mut error = String::new();
            for _ in 0..n {
                // SAFETY: fork has no arguments; the child only sleeps and leaves with _exit.
                let pid = unsafe { libc::fork() };
                if pid == 0 {
                    // SAFETY: sleep and _exit take integers only.
                    unsafe {
                        libc::sleep(30);
                        libc::_exit(0)
                    }
                }
                if pid < 0 {
                    error = std::io::Error::last_os_error().to_string();
                    break;
                }
                kids.push(pid);
            }
            println!("started {} error {error}", kids.len());
            for k in &kids {
                // SAFETY: kill and waitpid take integers and a null status pointer.
                unsafe {
                    libc::kill(*k, libc::SIGKILL);
                    libc::waitpid(*k, std::ptr::null_mut(), 0);
                }
            }
        }
        "bigwrite" => {
            // probe bigwrite PATH BYTES: write BYTES of data and say how far it got.
            let n: usize = arg(2).parse().unwrap_or_else(|e| fail(e));
            let mut f = std::fs::File::create(arg(1)).unwrap_or_else(|e| fail(e));
            let chunk = vec![b'z'; 65536];
            let mut written = 0usize;
            while written < n {
                let k = chunk.len().min(n - written);
                if let Err(e) = f.write_all(&chunk[..k]) {
                    println!("stopped at {written}: {e}");
                    std::process::exit(3);
                }
                written += k;
            }
            println!("wrote {written}");
        }
        "alloc" => {
            // probe alloc MIB: try to reserve that much memory.
            let mib: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            let mut v: Vec<u8> = Vec::new();
            match v.try_reserve_exact(mib << 20) {
                Ok(()) => println!("ok {mib}"),
                Err(e) => fail(e),
            }
        }
        "spin" => {
            let mut x = 0u64;
            loop {
                x = std::hint::black_box(x.wrapping_add(1));
            }
        }
        "crash" => {
            // A real hardware fault, which the kernel cannot ignore even for a PID namespace's init.
            // SAFETY: deliberately invalid; the point is to die with SIGSEGV.
            unsafe { std::ptr::null_mut::<u8>().write_volatile(1) };
        }
        "limits" => {
            let s = std::fs::read_to_string("/proc/self/limits").unwrap_or_else(|e| fail(e));
            for l in s.lines().filter(|l| {
                [
                    "Max address space",
                    "Max processes",
                    "Max file size",
                    "Max cpu time",
                    "Max core file size",
                ]
                .iter()
                .any(|p| l.starts_with(p))
            }) {
                println!("{l}");
            }
        }
        #[cfg(unix)]
        "fd" => {
            // probe fd N: write a greeting to the inherited descriptor N, read the reply.
            use std::io::Read;
            use std::os::fd::FromRawFd;
            let n: i32 = arg(1).parse().unwrap_or_else(|e| fail(e));
            // SAFETY: the test passes a descriptor it opened for us under this number.
            let mut f = unsafe { std::fs::File::from_raw_fd(n) };
            f.write_all(b"hello-from-child").unwrap_or_else(|e| fail(e));
            let mut reply = [0u8; 5];
            f.read_exact(&mut reply).unwrap_or_else(|e| fail(e));
            println!("reply {}", String::from_utf8_lossy(&reply));
        }
        "fds" => {
            // Open descriptors of this process as "N target" lines, from /proc/self/fd. The
            // listing's own directory descriptor shows up too, with a /proc target.
            let mut fds: Vec<(u32, String)> = std::fs::read_dir("/proc/self/fd")
                .unwrap_or_else(|e| fail(e))
                .filter_map(|e| {
                    let e = e.ok()?;
                    let n = e.file_name().to_str()?.parse().ok()?;
                    let target = std::fs::read_link(e.path()).ok()?;
                    Some((n, target.display().to_string()))
                })
                .collect();
            fds.sort();
            for (n, target) in fds {
                println!("{n} {target}");
            }
        }
        #[cfg(unix)]
        "fdenv" => {
            // probe fdenv NAME: like `fd`, but the descriptor number comes from the environment,
            // which is how sandbox.spawn tells the child about its channel.
            use std::io::Read;
            use std::os::fd::FromRawFd;
            let n: i32 = std::env::var(arg(1))
                .unwrap_or_else(|e| fail(e))
                .parse()
                .unwrap_or_else(|e| fail(e));
            // SAFETY: hx-sandbox passes a descriptor it opened for us under this number.
            let mut f = unsafe { std::fs::File::from_raw_fd(n) };
            f.write_all(b"hello-from-child").unwrap_or_else(|e| fail(e));
            let mut reply = [0u8; 5];
            f.read_exact(&mut reply).unwrap_or_else(|e| fail(e));
            println!("reply {}", String::from_utf8_lossy(&reply));
        }
        #[cfg(windows)]
        "handle" => {
            // probe handle N: write a greeting to the inherited pipe handle whose value is N.
            use std::os::windows::io::FromRawHandle;
            let n: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            // SAFETY: the test passes a pipe handle it opened for us under this value.
            let mut f = unsafe { std::fs::File::from_raw_handle(n as *mut std::ffi::c_void) };
            f.write_all(b"hello-from-child").unwrap_or_else(|e| fail(e));
        }
        #[cfg(target_os = "linux")]
        "ptrace" => {
            // SAFETY: PTRACE_TRACEME takes no pointers.
            let rc = unsafe { libc::ptrace(libc::PTRACE_TRACEME, 0, 0, 0) };
            println!(
                "{}",
                if rc == 0 {
                    "ok".to_owned()
                } else {
                    format!(
                        "errno {}",
                        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
                    )
                }
            );
        }
        #[cfg(target_os = "linux")]
        "io_uring" => {
            // SAFETY: a null params pointer makes the kernel return EFAULT or EPERM, never write.
            let rc =
                unsafe { libc::syscall(libc::SYS_io_uring_setup, 8, std::ptr::null_mut::<u8>()) };
            println!(
                "{}",
                if rc >= 0 {
                    "ok".to_owned()
                } else {
                    format!(
                        "errno {}",
                        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
                    )
                }
            );
        }
        #[cfg(target_os = "linux")]
        "socket" | "socketpair" => {
            // probe socket|socketpair DOMAIN TYPE[,nonblock][,cloexec]: create one and say how it went.
            let domain = match arg(1) {
                "unix" => libc::AF_UNIX,
                "inet" => libc::AF_INET,
                "inet6" => libc::AF_INET6,
                "netlink" => libc::AF_NETLINK,
                other => fail(format!("unknown domain {other}")),
            };
            let kind = socket_type(arg(2));
            let mut fds = [-1i32; 2];
            // SAFETY: plain integers, and a two-element array that socketpair fills.
            let rc = unsafe {
                if arg(0) == "socket" {
                    libc::socket(domain, kind, 0)
                } else {
                    libc::socketpair(domain, kind, 0, fds.as_mut_ptr())
                }
            };
            if rc < 0 {
                fail(format!(
                    "errno {}",
                    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
                ));
            }
            println!("ok");
        }
        #[cfg(target_os = "linux")]
        "datagram" => {
            // probe datagram PATH TYPE: the way to a host datagram socket (journald, /dev/log):
            // make an AF_UNIX socket of TYPE, bind it to an automatic address so the server can
            // answer, send one message to PATH and print what comes back.
            let kind = socket_type(arg(2));
            // SAFETY: plain integers.
            let fd = unsafe { libc::socket(libc::AF_UNIX, kind, 0) };
            if fd < 0 {
                fail(format!(
                    "errno {}",
                    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
                ));
            }
            // SAFETY: an all-zero sockaddr_un is valid; only its family is set. Binding with just
            // the family asks the kernel for an abstract address of its own.
            let (bound, sent, reply) = unsafe {
                let mut me: libc::sockaddr_un = std::mem::zeroed();
                me.sun_family = libc::AF_UNIX as libc::sa_family_t;
                let bound = libc::bind(
                    fd,
                    (&raw const me).cast(),
                    std::mem::size_of::<libc::sa_family_t>() as libc::socklen_t,
                );
                let mut to: libc::sockaddr_un = std::mem::zeroed();
                to.sun_family = libc::AF_UNIX as libc::sa_family_t;
                for (slot, byte) in to.sun_path.iter_mut().zip(arg(1).bytes()) {
                    *slot = byte as libc::c_char;
                }
                let msg = b"hello from inside the sandbox";
                let sent = libc::sendto(
                    fd,
                    msg.as_ptr().cast(),
                    msg.len(),
                    0,
                    (&raw const to).cast(),
                    std::mem::size_of::<libc::sockaddr_un>() as libc::socklen_t,
                );
                let timeout = libc::timeval {
                    tv_sec: 3,
                    tv_usec: 0,
                };
                libc::setsockopt(
                    fd,
                    libc::SOL_SOCKET,
                    libc::SO_RCVTIMEO,
                    (&raw const timeout).cast(),
                    std::mem::size_of::<libc::timeval>() as libc::socklen_t,
                );
                let mut buf = [0u8; 64];
                let n = libc::recv(fd, buf.as_mut_ptr().cast(), buf.len(), 0);
                (bound, sent, (n > 0).then(|| buf[..n as usize].to_vec()))
            };
            if bound < 0 || sent < 0 {
                fail(format!(
                    "errno {}",
                    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
                ));
            }
            match reply {
                Some(r) => println!("reply {}", String::from_utf8_lossy(&r)),
                None => fail("no reply"),
            }
        }
        #[cfg(target_os = "linux")]
        "unshare" => {
            // probe unshare HEXFLAGS
            let flags = i32::from_str_radix(arg(1), 16).unwrap_or_else(|e| fail(e));
            // SAFETY: unshare takes only flags.
            let rc = unsafe { libc::unshare(flags) };
            report_syscall(i64::from(rc));
        }
        #[cfg(target_os = "linux")]
        "clone" => {
            // probe clone HEXFLAGS: the raw clone syscall with a fork's signal added; a child that
            // gets created leaves at once.
            let flags = i64::from_str_radix(arg(1), 16).unwrap_or_else(|e| fail(e));
            // SAFETY: clone with no stack behaves like fork; the child only calls _exit.
            let rc = unsafe { libc::syscall(libc::SYS_clone, flags | 17, 0, 0, 0, 0) };
            if rc == 0 {
                // SAFETY: the child of a raw clone must not return into Rust code.
                unsafe { libc::_exit(0) };
            }
            if rc > 0 {
                let mut status = 0;
                // SAFETY: waits for the child just created.
                unsafe { libc::waitpid(rc as libc::pid_t, &raw mut status, 0) };
            }
            report_syscall(rc);
        }
        #[cfg(target_os = "linux")]
        "raw" => {
            // probe raw NR [ARG...]: any syscall, with integer arguments (decimal or 0x hex, or
            // `self` for this process's own pid).
            let num = |i: usize| -> i64 {
                args.get(i).map_or(0, |a| {
                    if a == "self" {
                        return i64::from(std::process::id());
                    }
                    a.strip_prefix("0x")
                        .map_or_else(|| a.parse(), |h| i64::from_str_radix(h, 16))
                        .unwrap_or_else(|e| fail(e))
                })
            };
            // SAFETY: only used with calls whose integer arguments cannot make the kernel touch
            // memory (bad descriptors, zero pointers).
            let rc = unsafe { libc::syscall(num(1), num(2), num(3), num(4), num(5), num(6)) };
            report_syscall(rc);
        }
        "threads" => {
            // probe threads N: start and join N threads (glibc asks for clone3 first).
            let n: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            let handles: Vec<_> = (0..n).map(|i| std::thread::spawn(move || i * 2)).collect();
            let sum: usize = handles.into_iter().filter_map(|h| h.join().ok()).sum();
            println!("ok {sum}");
        }
        "pathexists" => println!("{}", Path::new(arg(1)).exists()),
        other => fail(format!("unknown subcommand {other}")),
    }
}
