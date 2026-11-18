// Derived in part from OpenAI Codex, `codex-rs/linux-sandbox/src/seccomp.rs`
// (Copyright 2025 OpenAI, Apache License 2.0; see NOTICE and LICENSE-APACHE in this crate).
// What was taken: the idea of a deny-list filter over `socket`/`socketpair` domains, the x32
// syscall-number duplication on x86_64, and the list of syscalls that bypass socket-family
// rules (io_uring) or the sandbox itself (ptrace, process_vm_*).
// What changed: the filter is built from a mode enum (off / loopback / open) instead of
// Codex's proxy-routing modes; AF_UNIX path-addressing (`connect`, `bind`, `listen`, datagram
// sockets) is closed in `Off`; the list of always-denied syscalls is larger; the code is
// rewritten around this crate's error and policy types.

//! The seccomp-bpf program that backs the network dimension and hardens every child.

use std::collections::BTreeMap;

use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};

/// How much of the socket API the filter leaves open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SocketMode {
    /// Network off: only connected `AF_UNIX` stream sockets and socket pairs. Creating inet
    /// sockets fails, and so does anything that addresses a Unix socket by name
    /// (`connect`, `bind`, `listen`, datagram sockets).
    Off,
    /// Inside a private network namespace with only loopback: inet, inet6, Unix and netlink
    /// sockets are fine, every other family (vsock, packet, bluetooth, ...) is not.
    Loopback,
    /// Network unrestricted: only `AF_VSOCK`, which reaches the host outside any namespace,
    /// is denied.
    Open,
}

/// Syscalls no sandboxed child needs and that either escape the sandbox, widen it, or are
/// large kernel attack surface. All of them fail with `EPERM` in every mode.
const ALWAYS_DENIED: &[i64] = &[
    libc::SYS_ptrace,
    libc::SYS_process_vm_readv,
    libc::SYS_process_vm_writev,
    // io_uring can open sockets and files without the syscalls the filter watches.
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
    libc::SYS_bpf,
    libc::SYS_userfaultfd,
    libc::SYS_perf_event_open,
    libc::SYS_kexec_load,
    libc::SYS_init_module,
    libc::SYS_finit_module,
    libc::SYS_delete_module,
    libc::SYS_reboot,
    libc::SYS_add_key,
    libc::SYS_request_key,
    libc::SYS_keyctl,
    libc::SYS_mount,
    libc::SYS_umount2,
    libc::SYS_pivot_root,
    libc::SYS_swapon,
    libc::SYS_swapoff,
];

/// Denied only when the network is off: every way to reach a Unix socket by path.
const UNIX_ADDRESSING: &[i64] = &[libc::SYS_connect, libc::SYS_bind, libc::SYS_listen];

#[cfg(target_arch = "x86_64")]
const X32_SYSCALL_BIT: i64 = 0x4000_0000;

type Rules = BTreeMap<i64, Vec<SeccompRule>>;

fn cond(arg: u8, op: SeccompCmpOp, value: i32) -> Result<SeccompCondition, String> {
    // The domain and type arguments of socket(2) are C ints; compare the low 32 bits.
    let value = u64::from(value.unsigned_abs());
    SeccompCondition::new(arg, SeccompCmpArgLen::Dword, op, value).map_err(|e| e.to_string())
}

fn rule(conds: Vec<SeccompCondition>) -> Result<SeccompRule, String> {
    SeccompRule::new(conds).map_err(|e| e.to_string())
}

/// Registers `rules` for syscall `nr` and, on `x86_64`, for its x32 alias: x32 shares the
/// architecture tag with x86-64, so without the alias a caller could use the x32 number to
/// slip past the filter.
fn insert(map: &mut Rules, nr: i64, rules: Vec<SeccompRule>) {
    #[cfg(target_arch = "x86_64")]
    {
        map.insert(nr | X32_SYSCALL_BIT, rules.clone());
        // These calls have their own, different x32 numbers.
        let x32_nr = match nr {
            libc::SYS_ptrace => Some(521),
            libc::SYS_process_vm_readv => Some(539),
            libc::SYS_process_vm_writev => Some(540),
            _ => None,
        };
        if let Some(x32_nr) = x32_nr {
            map.insert(x32_nr | X32_SYSCALL_BIT, rules.clone());
            map.insert(x32_nr, rules.clone());
        }
    }
    map.insert(nr, rules);
}

fn deny(map: &mut Rules, nr: i64) {
    // An empty rule list matches every call of this syscall.
    insert(map, nr, Vec::new());
}

fn socket_rules(mode: SocketMode) -> Result<(Vec<SeccompRule>, Vec<SeccompRule>), String> {
    let unix = libc::AF_UNIX;
    // socket(domain, type, protocol): type carries flags in the high bits, the kind in the low 4.
    let is_dgram = cond(1, SeccompCmpOp::MaskedEq(0xf), libc::SOCK_DGRAM)?;
    match mode {
        SocketMode::Off => {
            let not_unix = || cond(0, SeccompCmpOp::Ne, unix);
            let unix_dgram = || -> Result<SeccompRule, String> {
                rule(vec![cond(0, SeccompCmpOp::Eq, unix)?, is_dgram.clone()])
            };
            Ok((
                vec![rule(vec![not_unix()?])?, unix_dgram()?],
                vec![rule(vec![not_unix()?])?, unix_dgram()?],
            ))
        }
        SocketMode::Loopback => {
            let denied = rule(
                [
                    libc::AF_UNIX,
                    libc::AF_INET,
                    libc::AF_INET6,
                    libc::AF_NETLINK,
                ]
                .into_iter()
                .map(|d| cond(0, SeccompCmpOp::Ne, d))
                .collect::<Result<_, _>>()?,
            )?;
            // socketpair only ever creates Unix sockets; anything else would be an error anyway.
            Ok((vec![denied], Vec::new()))
        }
        SocketMode::Open => {
            let vsock = rule(vec![cond(0, SeccompCmpOp::Eq, libc::AF_VSOCK)?])?;
            Ok((vec![vsock], Vec::new()))
        }
    }
}

/// Compiles the filter for `mode`. Runs in the parent; the child only installs the result.
pub(super) fn build(mode: SocketMode) -> Result<BpfProgram, String> {
    let mut map: Rules = BTreeMap::new();
    for nr in ALWAYS_DENIED {
        deny(&mut map, *nr);
    }
    if mode == SocketMode::Off {
        for nr in UNIX_ADDRESSING {
            deny(&mut map, *nr);
        }
    }
    let (socket, socketpair) = socket_rules(mode)?;
    insert(&mut map, libc::SYS_socket, socket);
    if !socketpair.is_empty() {
        insert(&mut map, libc::SYS_socketpair, socketpair);
    }

    let arch = if cfg!(target_arch = "x86_64") {
        TargetArch::x86_64
    } else if cfg!(target_arch = "aarch64") {
        TargetArch::aarch64
    } else {
        return Err("seccomp filters are built for x86_64 and aarch64 only".to_owned());
    };
    let filter = SeccompFilter::new(
        map,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM.unsigned_abs()),
        arch,
    )
    .map_err(|e| e.to_string())?;
    filter
        .try_into()
        .map_err(|e: seccompiler::BackendError| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mode_compiles() {
        for mode in [SocketMode::Off, SocketMode::Loopback, SocketMode::Open] {
            let prog = build(mode).unwrap();
            assert!(!prog.is_empty(), "{mode:?}");
            // The kernel rejects programs over 4096 instructions.
            assert!(
                prog.len() < 4096,
                "{mode:?} produced {} instructions",
                prog.len()
            );
        }
    }

    #[test]
    fn off_is_the_largest_filter() {
        let off = build(SocketMode::Off).unwrap().len();
        let open = build(SocketMode::Open).unwrap().len();
        assert!(off > open);
    }
}
