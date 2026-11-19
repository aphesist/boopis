// Derived in part from OpenAI Codex, `codex-rs/linux-sandbox/src/seccomp.rs`
// (Copyright 2025 OpenAI, Apache License 2.0; see NOTICE and LICENSE-APACHE in this crate).
// What was taken: the idea of a deny-list filter over `socket`/`socketpair` domains, the x32
// syscall-number handling on x86_64, and the list of syscalls that bypass socket-family
// rules (io_uring) or the sandbox itself (ptrace, process_vm_*).
// What changed: the filter is built from a mode enum (off / loopback / open) instead of
// Codex's proxy-routing modes; with the network off only `AF_UNIX` stream sockets exist and
// `connect`, `bind` and `listen` are closed; x32 is denied wholesale by a hand-written prefix
// instead of per-syscall aliases; namespace creation (`unshare`, `setns`, `clone` with
// `CLONE_NEW*`) is denied and `clone3` answers `ENOSYS`; the list of always-denied syscalls is
// larger; the code is rewritten around this crate's error and policy types.

//! The seccomp-bpf programs that back the network dimension and harden every child.
//!
//! [`build`] returns two programs, installed one after the other: the main one answers
//! `EPERM`, the second only turns `clone3` into `ENOSYS`. They are separate because a
//! `seccompiler` filter has a single action for everything it matches, and `clone3` has to
//! look like a kernel without it so that libc falls back to `clone`, whose flags a filter can
//! read (`clone3` passes them behind a pointer, which seccomp cannot follow).

use std::collections::BTreeMap;

use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};

#[cfg(test)]
mod tests;

/// How much of the socket API the filter leaves open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SocketMode {
    /// Network off: `socket` makes only `AF_UNIX` `SOCK_STREAM` sockets, and `socketpair` makes
    /// `SOCK_STREAM` or `SOCK_SEQPACKET` pairs (`SOCK_NONBLOCK` and `SOCK_CLOEXEC` ignored).
    /// Creating inet sockets fails, and so does every other Unix socket type, because
    /// `SOCK_DGRAM` and `SOCK_RAW` (which the kernel turns into a datagram socket) can address a
    /// host socket by path, even a connected datagram socketpair end; `connect`, `bind` and
    /// `listen` are denied as well. See [`socket_rules`] for why a seqpacket pair is safe.
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
    // A new namespace gives its creator a full set of capabilities inside it, which is what
    // turns kernel bugs in netfilter and friends into a privilege escalation. The sandbox
    // enters its own namespaces before this filter loads, so it never needs these afterwards.
    libc::SYS_unshare,
    libc::SYS_setns,
    // Taking a descriptor out of another process, comparing kernel objects across processes,
    // and opening a file by handle (which skips path resolution, and with it Landlock's view of
    // the path) are not things a sandboxed program does.
    libc::SYS_pidfd_getfd,
    libc::SYS_kcmp,
    libc::SYS_open_by_handle_at,
    // The new mount API: the same attack surface as `mount`, through other doors.
    libc::SYS_fsopen,
    libc::SYS_fsconfig,
    libc::SYS_fsmount,
    libc::SYS_fspick,
    libc::SYS_move_mount,
    libc::SYS_open_tree,
    libc::SYS_mount_setattr,
];

/// Denied only when the network is off: every way to reach a Unix socket by path.
const UNIX_ADDRESSING: &[i64] = &[libc::SYS_connect, libc::SYS_bind, libc::SYS_listen];

/// The `clone` flags that create a namespace: `CLONE_NEWNS`, `NEWCGROUP`, `NEWUTS`, `NEWIPC`,
/// `NEWUSER`, `NEWPID`, `NEWNET` and `NEWTIME`.
const CLONE_NEW_FLAGS: &[u64] = &[
    0x0002_0000,
    0x0200_0000,
    0x0400_0000,
    0x0800_0000,
    0x1000_0000,
    0x2000_0000,
    0x4000_0000,
    0x0000_0080,
];

/// `SOCK_STREAM`, the `AF_UNIX` type `socket` keeps with the network off.
const SOCK_STREAM: u64 = 1;
/// `SOCK_SEQPACKET`, which `socketpair` keeps as well (Rust's `Command::spawn` reports the exec
/// status of a child through such a pair, so cargo and every Rust program that spawns need it).
const SOCK_SEQPACKET: u64 = 5;
/// The `type` argument of `socket(2)` carries the kind in its low four bits and flags above.
const SOCK_TYPE_MASK: u64 = 0xf;

/// The bit that marks an x32 syscall number on `x86_64`. x32 shares the architecture tag with
/// native `x86_64`, so a filter keyed by syscall number never sees an x32 call under the name
/// it expects.
#[cfg(target_arch = "x86_64")]
const X32_SYSCALL_BIT: u32 = 0x4000_0000;

type Rules = BTreeMap<i64, Vec<SeccompRule>>;

/// A condition on a 32-bit argument. The arguments of `socket(2)` and the flags of `clone(2)`
/// that matter here are C `int`s and `unsigned long`s whose meaningful bits are in the low half,
/// which is what the kernel reads too.
fn cond(arg: u8, op: SeccompCmpOp, value: u64) -> Result<SeccompCondition, String> {
    SeccompCondition::new(arg, SeccompCmpArgLen::Dword, op, value).map_err(|e| e.to_string())
}

fn rule(conds: Vec<SeccompCondition>) -> Result<SeccompRule, String> {
    SeccompRule::new(conds).map_err(|e| e.to_string())
}

fn domain_is_not(domain: i32) -> Result<SeccompRule, String> {
    rule(vec![cond(
        0,
        SeccompCmpOp::Ne,
        u64::from(domain.unsigned_abs()),
    )?])
}

fn deny(map: &mut Rules, nr: i64) {
    // An empty rule list matches every call of this syscall.
    map.insert(nr, Vec::new());
}

/// Deny rules for the network-off mode: any domain but `AF_UNIX`, and every value of the four
/// type bits that is not in `allowed`. The filter language has no "masked not equal", so each
/// refused value is a rule of its own; the flags above the type bits (`SOCK_NONBLOCK`,
/// `SOCK_CLOEXEC`) never take part, and the kernel rejects any other flag with EINVAL by itself.
fn off_rules(allowed: &[u64]) -> Result<Vec<SeccompRule>, String> {
    let mut rules = vec![domain_is_not(libc::AF_UNIX)?];
    for kind in (0..=SOCK_TYPE_MASK).filter(|k| !allowed.contains(k)) {
        rules.push(rule(vec![cond(
            1,
            SeccompCmpOp::MaskedEq(SOCK_TYPE_MASK),
            kind,
        )?])?);
    }
    Ok(rules)
}

/// The rules of `socket` for `mode`. A rule that matches means "deny".
///
/// With the network off `socket` makes only `AF_UNIX` `SOCK_STREAM` sockets: an unconnected
/// seqpacket or datagram socket is a step toward a host socket, and `connect` is denied anyway.
fn socket_rules(mode: SocketMode) -> Result<Vec<SeccompRule>, String> {
    match mode {
        SocketMode::Off => off_rules(&[SOCK_STREAM]),
        SocketMode::Loopback => {
            let denied = rule(
                [
                    libc::AF_UNIX,
                    libc::AF_INET,
                    libc::AF_INET6,
                    libc::AF_NETLINK,
                ]
                .into_iter()
                .map(|d| cond(0, SeccompCmpOp::Ne, u64::from(d.unsigned_abs())))
                .collect::<Result<_, _>>()?,
            )?;
            Ok(vec![denied])
        }
        SocketMode::Open => Ok(vec![rule(vec![cond(
            0,
            SeccompCmpOp::Eq,
            u64::from(libc::AF_VSOCK.unsigned_abs()),
        )?])?]),
    }
}

/// `clone` with any namespace flag. Rules in one list are alternatives, so one rule per flag.
fn clone_rules() -> Result<Vec<SeccompRule>, String> {
    CLONE_NEW_FLAGS
        .iter()
        .map(|flag| rule(vec![cond(0, SeccompCmpOp::MaskedEq(*flag), *flag)?]))
        .collect()
}

fn target_arch() -> Result<TargetArch, String> {
    if cfg!(target_arch = "x86_64") {
        Ok(TargetArch::x86_64)
    } else if cfg!(target_arch = "aarch64") {
        Ok(TargetArch::aarch64)
    } else {
        Err("seccomp filters are built for x86_64 and aarch64 only".to_owned())
    }
}

/// The instructions that deny every x32 syscall (`nr & 0x40000000`) before anything else runs.
/// `seccompiler` starts its own program by loading the architecture, so the accumulator these
/// leave behind does not matter. Hand-written because a rule table is keyed by exact numbers.
#[cfg(target_arch = "x86_64")]
fn x32_prefix() -> Vec<seccompiler::sock_filter> {
    use seccompiler::sock_filter;
    const BPF_LD_W_ABS: u16 = 0x20;
    const BPF_ALU_AND_K: u16 = 0x54;
    const BPF_JEQ_K: u16 = 0x15;
    const BPF_RET_K: u16 = 0x06;
    const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;
    let stmt = |code, k| sock_filter {
        code,
        jt: 0,
        jf: 0,
        k,
    };
    vec![
        // A = seccomp_data.nr
        stmt(BPF_LD_W_ABS, 0),
        // A &= X32_SYSCALL_BIT
        stmt(BPF_ALU_AND_K, X32_SYSCALL_BIT),
        // if A == 0 skip the denial
        sock_filter {
            code: BPF_JEQ_K,
            jt: 1,
            jf: 0,
            k: 0,
        },
        stmt(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM.unsigned_abs()),
    ]
}

#[cfg(not(target_arch = "x86_64"))]
fn x32_prefix() -> Vec<seccompiler::sock_filter> {
    // Only x86_64 has a second syscall table behind the same architecture tag.
    Vec::new()
}

/// The main program: every denial that answers `EPERM`.
fn main_program(mode: SocketMode, arch: TargetArch) -> Result<BpfProgram, String> {
    let mut map: Rules = BTreeMap::new();
    for nr in ALWAYS_DENIED {
        deny(&mut map, *nr);
    }
    if mode == SocketMode::Off {
        for nr in UNIX_ADDRESSING {
            deny(&mut map, *nr);
        }
    }
    map.insert(libc::SYS_socket, socket_rules(mode)?);
    let pair = socketpair_rules(mode)?;
    if !pair.is_empty() {
        map.insert(libc::SYS_socketpair, pair);
    }
    map.insert(libc::SYS_clone, clone_rules()?);

    let filter = SeccompFilter::new(
        map,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM.unsigned_abs()),
        arch,
    )
    .map_err(|e| e.to_string())?;
    let compiled: BpfProgram = filter
        .try_into()
        .map_err(|e: seccompiler::BackendError| e.to_string())?;
    let mut program = x32_prefix();
    program.extend(compiled);
    Ok(program)
}

/// The second program: `clone3` looks unimplemented.
fn clone3_program(arch: TargetArch) -> Result<BpfProgram, String> {
    let mut map: Rules = BTreeMap::new();
    deny(&mut map, libc::SYS_clone3);
    SeccompFilter::new(
        map,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::ENOSYS.unsigned_abs()),
        arch,
    )
    .map_err(|e| e.to_string())?
    .try_into()
    .map_err(|e: seccompiler::BackendError| e.to_string())
}

/// The rules of `socketpair` with the network off: `SOCK_STREAM` and `SOCK_SEQPACKET`.
///
/// Why a seqpacket pair cannot reach a host socket (Linux `net/unix/af_unix.c`, v6.12):
/// - `unix_socketpair` joins the two ends back to back and marks both `TCP_ESTABLISHED`;
///   neither end is bound, and `connect`, `bind` and `listen` are denied here, so the pair
///   stays what it is.
/// - `unix_seqpacket_sendmsg` answers `ENOTCONN` unless the socket is `TCP_ESTABLISHED`, and
///   then does `if (msg->msg_namelen) msg->msg_namelen = 0;` before handing over to
///   `unix_dgram_sendmsg`, so a destination address given to `sendto` or `sendmsg` is thrown
///   away and the message goes to the peer.
/// - `unix_dgram_sendmsg`, the `SOCK_DGRAM` entry point, does the opposite: with
///   `msg_namelen` set it validates the address and looks the receiver up by path
///   (`unix_find_other`), connected or not. That is why `SOCK_DGRAM` (and `SOCK_RAW`, which the
///   kernel turns into `SOCK_DGRAM`) stays denied for `socketpair`.
/// - `unix_stream_sendmsg` refuses an address outright (`EISCONN` when established).
fn socketpair_rules(mode: SocketMode) -> Result<Vec<SeccompRule>, String> {
    match mode {
        SocketMode::Off => off_rules(&[SOCK_STREAM, SOCK_SEQPACKET]),
        // socketpair only ever makes Unix sockets; elsewhere there is nothing to add to what
        // `socket` already closes.
        SocketMode::Loopback | SocketMode::Open => Ok(Vec::new()),
    }
}

/// Compiles the filters for `mode`, in the order they are installed. Runs in the parent; the
/// child only installs the result.
pub(super) fn build(mode: SocketMode) -> Result<Vec<BpfProgram>, String> {
    let arch = target_arch()?;
    Ok(vec![main_program(mode, arch)?, clone3_program(arch)?])
}
