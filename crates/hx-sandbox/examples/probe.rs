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

use std::io::Write;
use std::path::Path;

fn fail(msg: impl std::fmt::Display) -> ! {
    println!("err: {msg}");
    std::process::exit(3)
}

/// Writes an ever-increasing counter to `path` every 50 ms, forever.
fn heartbeat(path: &str) -> ! {
    let mut n = 0u64;
    loop {
        let _ = std::fs::write(path, n.to_string());
        n += 1;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
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
        "forkbomb" => {
            // probe forkbomb N: start up to N sleeping children and say how many started.
            let n: usize = arg(1).parse().unwrap_or_else(|e| fail(e));
            let me = std::env::current_exe().unwrap_or_else(|e| fail(e));
            let mut kids = Vec::new();
            let mut error = String::new();
            for _ in 0..n {
                match std::process::Command::new(&me)
                    .args(["sleep", "30"])
                    .spawn()
                {
                    Ok(k) => kids.push(k),
                    Err(e) => {
                        error = e.to_string();
                        break;
                    }
                }
            }
            println!("started {} error {error}", kids.len());
            for k in &mut kids {
                let _ = k.kill();
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
        "pathexists" => println!("{}", Path::new(arg(1)).exists()),
        other => fail(format!("unknown subcommand {other}")),
    }
}
