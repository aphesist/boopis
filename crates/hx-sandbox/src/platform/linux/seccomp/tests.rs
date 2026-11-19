//! The filters are checked by running the compiled programs through a small classic-BPF
//! interpreter, so every syscall number, flag and type is exercised without a kernel and on
//! every host that can compile them. The real kernel is checked by `tests/linux.rs`.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::decimal_bitwise_operands,
    reason = "the interpreter and the tables mirror kernel structures: 32-bit words from 64-bit \
              arguments, syscall numbers as unsigned words, flags written the way the man pages write them"
)]

use super::*;
use seccompiler::sock_filter;

const ALLOW: u32 = 0x7fff_0000;
const ERRNO: u32 = 0x0005_0000;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Verdict {
    Allow,
    Errno(i32),
    Other(u32),
}

#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH: u32 = 62 | 0x8000_0000 | 0x4000_0000;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH: u32 = 183 | 0x8000_0000 | 0x4000_0000;

/// Runs one program over a `seccomp_data` made of the arguments given.
fn run_one(program: &[sock_filter], nr: u32, args: [u64; 6]) -> u32 {
    let load = |offset: u32| -> u32 {
        match offset {
            0 => nr,
            4 => AUDIT_ARCH,
            16..=63 => {
                let word = ((offset - 16) / 8) as usize;
                let value = args[word];
                if (offset - 16).is_multiple_of(8) {
                    value as u32
                } else {
                    (value >> 32) as u32
                }
            }
            other => panic!("the filter read offset {other}, which this interpreter lacks"),
        }
    };
    let (mut acc, mut pc) = (0u32, 0usize);
    loop {
        let i = &program[pc];
        pc += 1;
        match i.code {
            0x20 => acc = load(i.k),
            0x54 => acc &= i.k,
            0x05 => pc += i.k as usize,
            0x15 => pc += if acc == i.k { i.jt } else { i.jf } as usize,
            0x25 => pc += if acc > i.k { i.jt } else { i.jf } as usize,
            0x35 => pc += if acc >= i.k { i.jt } else { i.jf } as usize,
            0x06 => return i.k,
            other => panic!("opcode {other:#x} is not implemented by the test interpreter"),
        }
    }
}

/// What the kernel would do with the stack of programs: the first that does not allow wins
/// (the kernel takes the strictest; here at most one program disagrees with the others).
fn check(mode: SocketMode, nr: i64, args: [u64; 6]) -> Verdict {
    for program in build(mode).unwrap() {
        match run_one(&program, nr as u32, args) {
            ALLOW => {}
            v if v & 0xffff_0000 == ERRNO => return Verdict::Errno((v & 0xffff) as i32),
            v => return Verdict::Other(v),
        }
    }
    Verdict::Allow
}

fn call(mode: SocketMode, nr: i64) -> Verdict {
    check(mode, nr, [0; 6])
}

const EPERM: Verdict = Verdict::Errno(libc::EPERM);
const NONBLOCK: u64 = 0x800;
const CLOEXEC: u64 = 0x8_0000;

fn sock(mode: SocketMode, nr: i64, domain: i32, kind: u64) -> Verdict {
    check(mode, nr, [domain as u64, kind, 0, 0, 0, 0])
}

#[test]
fn every_mode_compiles() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        let programs = build(mode).unwrap();
        assert_eq!(programs.len(), 2, "{mode:?}");
        for prog in &programs {
            assert!(!prog.is_empty(), "{mode:?}");
            // The kernel rejects programs over 4096 instructions.
            assert!(
                prog.len() < 4096,
                "{mode:?} produced {} instructions",
                prog.len()
            );
        }
    }
}

#[test]
fn off_is_the_largest_filter() {
    let size = |m| build(m).unwrap().iter().map(Vec::len).sum::<usize>();
    assert!(size(SocketMode::Off) > size(SocketMode::Open));
}

#[test]
fn with_the_network_off_socket_makes_only_unix_streams_and_socketpair_adds_seqpacket() {
    for nr in [libc::SYS_socket, libc::SYS_socketpair] {
        // The types each call keeps: socket only stream, socketpair stream and seqpacket.
        let kept: &[u64] = if nr == libc::SYS_socket {
            &[1]
        } else {
            &[1, 5]
        };
        for kind in (0..=15u64).filter(|k| kept.contains(k)) {
            // plain, and with the two flags libc and Python add
            for flags in [0, NONBLOCK, CLOEXEC, NONBLOCK | CLOEXEC] {
                assert_eq!(
                    sock(SocketMode::Off, nr, libc::AF_UNIX, kind | flags),
                    Verdict::Allow,
                    "nr {nr} type {kind} flags {flags:#x}"
                );
            }
        }
        // Every other type of Unix socket: 2 dgram, 3 raw (a datagram socket in the kernel),
        // 4 rdm, and every other value of the type field (5 seqpacket too, for `socket`).
        for kind in (0..=15u64).filter(|k| !kept.contains(k)) {
            for flags in [0, NONBLOCK | CLOEXEC] {
                assert_eq!(
                    sock(SocketMode::Off, nr, libc::AF_UNIX, kind | flags),
                    EPERM,
                    "nr {nr} type {kind} flags {flags:#x}"
                );
            }
        }
        // Other families, whatever the type.
        for domain in [
            libc::AF_INET,
            libc::AF_INET6,
            libc::AF_NETLINK,
            libc::AF_PACKET,
            libc::AF_VSOCK,
            libc::AF_UNSPEC,
        ] {
            for kind in [1u64, 2, 3, 5] {
                assert_eq!(
                    sock(SocketMode::Off, nr, domain, kind),
                    EPERM,
                    "nr {nr} domain {domain} type {kind}"
                );
            }
        }
    }
    // The two calls differ in exactly one place: a seqpacket pair, not a seqpacket socket.
    assert_eq!(
        sock(SocketMode::Off, libc::SYS_socketpair, libc::AF_UNIX, 5),
        Verdict::Allow
    );
    assert_eq!(
        sock(SocketMode::Off, libc::SYS_socket, libc::AF_UNIX, 5),
        EPERM
    );
    // A datagram pair is denied: a connected datagram end can still `sendto` a path.
    for kind in [2u64, 3] {
        assert_eq!(
            sock(SocketMode::Off, libc::SYS_socketpair, libc::AF_UNIX, kind),
            EPERM
        );
    }
}

#[test]
fn the_high_half_of_the_arguments_does_not_matter() {
    // The registers of an int argument can carry garbage above bit 31.
    let args = [
        (7u64 << 32) | libc::AF_UNIX as u64,
        (9u64 << 32) | 1,
        0,
        0,
        0,
        0,
    ];
    assert_eq!(
        check(SocketMode::Off, libc::SYS_socket, args),
        Verdict::Allow
    );
}

#[test]
fn unix_socket_addressing_is_closed_only_with_the_network_off() {
    for nr in [libc::SYS_connect, libc::SYS_bind, libc::SYS_listen] {
        assert_eq!(call(SocketMode::Off, nr), EPERM, "nr {nr}");
        assert_eq!(call(SocketMode::Loopback, nr), Verdict::Allow);
        assert_eq!(call(SocketMode::Open, nr), Verdict::Allow);
    }
}

#[test]
fn loopback_keeps_inet_unix_and_netlink_and_open_denies_only_vsock() {
    for domain in [
        libc::AF_UNIX,
        libc::AF_INET,
        libc::AF_INET6,
        libc::AF_NETLINK,
    ] {
        assert_eq!(
            sock(SocketMode::Loopback, libc::SYS_socket, domain, 2),
            Verdict::Allow
        );
    }
    for domain in [libc::AF_VSOCK, libc::AF_PACKET, libc::AF_BLUETOOTH] {
        assert_eq!(
            sock(SocketMode::Loopback, libc::SYS_socket, domain, 1),
            EPERM
        );
    }
    assert_eq!(
        sock(SocketMode::Loopback, libc::SYS_socketpair, libc::AF_UNIX, 2),
        Verdict::Allow
    );
    assert_eq!(
        sock(SocketMode::Open, libc::SYS_socket, libc::AF_VSOCK, 1),
        EPERM
    );
    for domain in [libc::AF_INET, libc::AF_UNIX, libc::AF_PACKET] {
        assert_eq!(
            sock(SocketMode::Open, libc::SYS_socket, domain, 2),
            Verdict::Allow
        );
    }
}

fn clone_with(mode: SocketMode, flags: u64) -> Verdict {
    check(mode, libc::SYS_clone, [flags, 0, 0, 0, 0, 0])
}

#[test]
fn clone_with_a_namespace_flag_is_denied_in_every_mode() {
    assert_eq!(CLONE_NEW_FLAGS.len(), 8);
    for (flag, libc_flag) in [
        (CLONE_NEW_FLAGS[0], libc::CLONE_NEWNS),
        (CLONE_NEW_FLAGS[1], libc::CLONE_NEWCGROUP),
        (CLONE_NEW_FLAGS[2], libc::CLONE_NEWUTS),
        (CLONE_NEW_FLAGS[3], libc::CLONE_NEWIPC),
        (CLONE_NEW_FLAGS[4], libc::CLONE_NEWUSER),
        (CLONE_NEW_FLAGS[5], libc::CLONE_NEWPID),
        (CLONE_NEW_FLAGS[6], libc::CLONE_NEWNET),
    ] {
        assert_eq!(flag, libc_flag as u64);
    }
    // What a thread or a fork carries, which must keep working.
    let thread =
        0x100 | 0x200 | 0x400 | 0x800 | 0x1_0000 | 0x4_0000 | 0x8_0000 | 0x10_0000 | 0x20_0000;
    let fork = 17 | 0x100_0000 | 0x20_0000;
    let vfork = 0x100 | 0x4000 | 17;
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        for flags in [thread, fork, vfork, 0, 0x8000_0000, 0x8000_0000 | thread] {
            assert_eq!(clone_with(mode, flags), Verdict::Allow, "{flags:#x}");
        }
        for flag in CLONE_NEW_FLAGS {
            // alone, with the signal of a fork, with thread flags, and with garbage above bit 31
            for flags in [*flag, flag | 17, flag | thread, flag | (5 << 32)] {
                assert_eq!(clone_with(mode, flags), EPERM, "{mode:?} {flags:#x}");
            }
        }
    }
}

#[test]
fn clone3_looks_like_a_kernel_without_it() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        assert_eq!(
            call(mode, libc::SYS_clone3),
            Verdict::Errno(libc::ENOSYS),
            "{mode:?}"
        );
    }
}

#[test]
fn namespaces_cannot_be_entered_or_created_afterwards() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        assert_eq!(call(mode, libc::SYS_unshare), EPERM);
        assert_eq!(call(mode, libc::SYS_setns), EPERM);
    }
}

#[test]
fn the_hardening_list_is_denied_in_every_mode() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        for nr in [
            libc::SYS_ptrace,
            libc::SYS_process_vm_readv,
            libc::SYS_io_uring_setup,
            libc::SYS_bpf,
            libc::SYS_mount,
            libc::SYS_pidfd_getfd,
            libc::SYS_kcmp,
            libc::SYS_open_by_handle_at,
            libc::SYS_fsopen,
            libc::SYS_fsconfig,
            libc::SYS_fsmount,
            libc::SYS_fspick,
            libc::SYS_move_mount,
            libc::SYS_open_tree,
            libc::SYS_mount_setattr,
        ] {
            assert_eq!(call(mode, nr), EPERM, "{mode:?} nr {nr}");
        }
    }
}

#[test]
fn ordinary_syscalls_stay_open() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        for nr in [
            libc::SYS_read,
            libc::SYS_write,
            libc::SYS_getpid,
            libc::SYS_execve,
            libc::SYS_openat,
            libc::SYS_mmap,
            libc::SYS_futex,
            libc::SYS_wait4,
            libc::SYS_kill,
            libc::SYS_pidfd_open,
            libc::SYS_prctl,
        ] {
            assert_eq!(call(mode, nr), Verdict::Allow, "{mode:?} nr {nr}");
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[test]
fn every_x32_syscall_number_is_denied() {
    for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
        for nr in 0..1024u32 {
            let x32 = i64::from(nr | X32_SYSCALL_BIT);
            assert_eq!(call(mode, x32), EPERM, "{mode:?} nr {x32:#x}");
        }
        // Numbers with the x32 bit and more, and the native twins of a few of them.
        for nr in [0x4000_0000u32, 0x4000_0000 | 0x8000_0000, 0x7fff_ffff] {
            assert_eq!(call(mode, i64::from(nr)), EPERM, "{nr:#x}");
        }
        assert_eq!(call(mode, libc::SYS_getpid), Verdict::Allow);
    }
}
