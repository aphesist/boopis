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
    clippy::duration_suboptimal_units,
    reason = "seconds are the unit the tests reason in"
)]

#[cfg(unix)]
use std::io::{Read, Write};
#[cfg(unix)]
use std::path::Path;

#[cfg(unix)]
fn fail(msg: impl std::fmt::Display) -> ! {
    println!("err: {msg}");
    std::process::exit(3)
}

#[cfg(unix)]
fn record(pidfile: &str, pid: u32) {
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(pidfile)
        .unwrap_or_else(|e| fail(e));
    writeln!(f, "{pid}").unwrap_or_else(|e| fail(e));
}

#[cfg(unix)]
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
        "unix" => match std::os::unix::net::UnixStream::connect(arg(1)) {
            Ok(_) => println!("ok"),
            Err(e) => fail(e),
        },
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
            // probe tree PIDFILE: this process, a child and a grandchild, all sleeping.
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            record(arg(1), std::process::id());
            let mut mid = std::process::Command::new(me)
                .args(["mid", arg(1)])
                .spawn()
                .unwrap_or_else(|e| fail(e));
            let _ = mid.wait();
        }
        "mid" => {
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            record(arg(1), std::process::id());
            let mut leaf = std::process::Command::new(me)
                .args(["leaf", arg(1)])
                .spawn()
                .unwrap_or_else(|e| fail(e));
            let _ = leaf.wait();
        }
        "leaf" => {
            record(arg(1), std::process::id());
            std::thread::sleep(std::time::Duration::from_secs(300));
        }
        "fd" => {
            // probe fd N: write a greeting to the inherited descriptor N, read the reply.
            use std::os::fd::FromRawFd;
            let n: i32 = arg(1).parse().unwrap_or_else(|e| fail(e));
            // SAFETY: the test passes a descriptor it opened for us under this number.
            let mut f = unsafe { std::fs::File::from_raw_fd(n) };
            f.write_all(b"hello-from-child").unwrap_or_else(|e| fail(e));
            let mut reply = [0u8; 5];
            f.read_exact(&mut reply).unwrap_or_else(|e| fail(e));
            println!("reply {}", String::from_utf8_lossy(&reply));
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
        "pathexists" => println!("{}", Path::new(arg(1)).exists()),
        other => fail(format!("unknown subcommand {other}")),
    }
}

#[cfg(not(unix))]
fn main() {}
