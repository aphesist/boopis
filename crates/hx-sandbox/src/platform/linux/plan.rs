//! Deciding, from what the probe found, how each requested dimension will be enforced.
//! Pure over [`Probe`] and the resolved policy, so it is tested with synthetic probes.

use super::landlock::MIN_ABI;
use super::probe::{NsAccess, Probe};
use super::seccomp::SocketMode;
use crate::error::{Dimension, Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::policy::NetworkPolicy;
use crate::report::DimensionReport;

/// How the whole process tree is ended, setsid escapees included. Chosen in this order: the
/// kernel's own PID namespace reaping, a cgroup per run, a child subreaper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TreeMethod {
    /// The program is init of a PID namespace (entered this way).
    PidNamespace(NsAccess),
    /// Every process of the run is in a cgroup v2 subtree that is ended with `cgroup.kill`.
    Cgroup,
    /// A supervisor that is a child subreaper kills everything it inherits.
    Subreaper,
    /// Nothing reaches a descendant that left the process group. Only chosen when the policy
    /// allows a degraded process dimension.
    GroupOnly,
}

/// The decisions for one run.
#[derive(Debug)]
pub(super) struct Plan {
    /// Enforce the filesystem with Landlock at this ABI.
    pub landlock_abi: Option<u32>,
    /// Install a seccomp program in this mode (None: seccomp is not usable here).
    pub socket_mode: Option<SocketMode>,
    /// Put the child in a private network namespace (how it is entered).
    pub netns: Option<NsAccess>,
    /// Put the child in a PID namespace (how it is entered).
    pub pidns: Option<NsAccess>,
    /// How the tree is ended.
    pub tree: TreeMethod,
    /// The filesystem report.
    pub fs: DimensionReport,
    /// The network report.
    pub network: DimensionReport,
}

fn fs_reason(probe: &Probe) -> String {
    match &probe.landlock_abi {
        Err(why) => format!("Landlock is not available: {why}"),
        Ok(abi) if *abi < MIN_ABI => format!(
            "Landlock ABI {abi} is too old (need {MIN_ABI}+: earlier ABIs cannot stop renames out of, or truncation of files in, a read-only tree)"
        ),
        Ok(abi) => format!(
            "Landlock ABI {abi} is reported by the kernel but a forked probe could not restrict itself (blocked by a container or LSM policy)"
        ),
    }
}

/// The requested network mode cannot be enforced and the policy allows degrading: fall back to
/// network off, the strictest mode, when seccomp can hold it. Only when even that is
/// impossible does the run go ahead unrestricted.
fn degrade_network(
    why: &str,
    requested: &str,
    seccomp_ok: bool,
) -> (DimensionReport, Option<SocketMode>) {
    if seccomp_ok {
        (
            DimensionReport::degraded(
                &["seccomp"],
                format!(
                    "network: off ({requested} unavailable: {why}); seccomp denies inet sockets and Unix socket paths"
                ),
            ),
            Some(SocketMode::Off),
        )
    } else {
        (
            DimensionReport::degraded(
                &[],
                format!(
                    "requested network {requested} cannot be enforced ({why}) and neither can network off (no seccomp); running with unrestricted network because the policy allows degrading it"
                ),
            ),
            None,
        )
    }
}

/// The best way this host has to end the whole tree, or `Unavailable` when it has none and the
/// policy does not allow running without.
fn choose_tree(probe: &Probe, policy: &ResolvedPolicy) -> Result<TreeMethod> {
    if probe.pidns != NsAccess::None {
        Ok(TreeMethod::PidNamespace(probe.pidns))
    } else if probe.cgroup.is_ok() {
        Ok(TreeMethod::Cgroup)
    } else if probe.subreaper.is_ok() {
        Ok(TreeMethod::Subreaper)
    } else if policy.degraded.process {
        Ok(TreeMethod::GroupOnly)
    } else {
        Err(Error::unavailable(
            Dimension::Process,
            format!(
                "nothing here can end a descendant that calls setsid: no PID namespace (needs \
                 CAP_SYS_ADMIN or unprivileged user namespaces), no cgroup ({}), no child subreaper ({})",
                probe.cgroup.as_ref().err().map_or("", String::as_str),
                probe.subreaper.as_ref().err().map_or("", String::as_str),
            ),
        ))
    }
}

/// The filesystem decision: the Landlock ABI to enforce at and the report, or `Unavailable`.
fn plan_fs(probe: &Probe, policy: &ResolvedPolicy) -> Result<(Option<u32>, DimensionReport)> {
    let landlock_abi = probe.usable_landlock_abi();
    let fs = if landlock_abi.is_some() {
        // Filled in with counts by the caller once the ruleset exists.
        DimensionReport::enforced(&["landlock"], String::new())
    } else if policy.degraded.fs {
        DimensionReport::degraded(
            &[],
            format!(
                "{}; running without filesystem confinement because the policy allows degrading it",
                fs_reason(probe)
            ),
        )
    } else {
        return Err(Error::unavailable(Dimension::Fs, fs_reason(probe)));
    };
    Ok((landlock_abi, fs))
}

/// Makes the plan or fails with `Unavailable`.
pub(super) fn make(probe: &Probe, policy: &ResolvedPolicy) -> Result<Plan> {
    let (landlock_abi, fs) = plan_fs(probe, policy)?;

    let seccomp_ok = probe.seccomp_enforces;
    let need_seccomp = |why: &str| -> Result<()> {
        if seccomp_ok {
            Ok(())
        } else {
            Err(Error::unavailable(Dimension::Network, why.to_owned()))
        }
    };

    let (network, socket_mode, netns) = match &policy.network {
        NetworkPolicy::Off => {
            match need_seccomp("seccomp-bpf is not available or a probe could not install it") {
                Ok(()) => (
                    DimensionReport::enforced(
                        &["seccomp"],
                        "socket() is limited to AF_UNIX stream sockets (socketpair() also allows seqpacket pairs); connect, bind and listen are denied, so nothing is reachable over the network or by Unix socket path",
                    ),
                    Some(SocketMode::Off),
                    None,
                ),
                Err(e) if policy.degraded.network => {
                    let (report, mode) = degrade_network(&e.to_string(), "off", false);
                    (report, mode, None)
                }
                Err(e) => return Err(e),
            }
        }
        NetworkPolicy::Loopback => {
            if probe.netns == NsAccess::None {
                let why = "no network namespace can be created here (needs CAP_SYS_ADMIN or unprivileged user namespaces)";
                if policy.degraded.network {
                    let (report, mode) = degrade_network(why, "loopback", seccomp_ok);
                    (report, mode, None)
                } else {
                    return Err(Error::unavailable(Dimension::Network, why));
                }
            } else {
                let how = match probe.netns {
                    NsAccess::Direct => "direct unshare(CLONE_NEWNET)",
                    _ => "unprivileged user namespace",
                };
                (
                    DimensionReport::enforced(
                        &["netns", "seccomp"],
                        format!(
                            "a private network namespace ({how}) with only a loopback interface; other socket families are denied by seccomp"
                        ),
                    ),
                    seccomp_ok.then_some(SocketMode::Loopback),
                    Some(probe.netns),
                )
            }
        }
        NetworkPolicy::Allowlist(hosts) => {
            let why = "no OS mechanism here filters by host name; that needs an egress proxy outside hx-sandbox";
            if policy.degraded.network {
                let (report, mode) = degrade_network(
                    why,
                    &format!("allowlist of {} host(s)", hosts.len()),
                    seccomp_ok,
                );
                (report, mode, None)
            } else {
                return Err(Error::unavailable(Dimension::Network, why));
            }
        }
        NetworkPolicy::On => (
            DimensionReport::unrestricted(if seccomp_ok {
                "network unrestricted by request; AF_VSOCK (host bridge) is still denied"
            } else {
                "network unrestricted by request"
            }),
            seccomp_ok.then_some(SocketMode::Open),
            None,
        ),
    };

    let tree = choose_tree(probe, policy)?;
    let pidns = match tree {
        TreeMethod::PidNamespace(how) => Some(how),
        _ => None,
    };
    Ok(Plan {
        landlock_abi,
        socket_mode,
        netns,
        pidns,
        tree,
        fs,
        network,
    })
}

#[cfg(test)]
mod tests;
