//! Linux: Landlock for the filesystem, seccomp for the network and hardening, a private network
//! namespace for loopback, `setsid` plus `killpg` for the process tree. No setuid helpers, no
//! bubblewrap: every mechanism is a syscall the unprivileged child makes on itself.

mod child;
mod landlock;
mod plan;
mod probe;
mod seccomp;
mod spawn;
mod sys;

use std::os::fd::AsRawFd;

use seccompiler::BpfProgram;
use tokio::process::Command;

use super::rlimits::{self, RlimitContext, RlimitSpec};
use super::unix::{StatusPipe, start};
use super::{Launch, LaunchSpec};
use crate::capabilities::{Capabilities, Capability};
use crate::error::{Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::report::{DimensionReport, Enforcement};
use child::{ChildPlan, NamespacePlan, UserMaps, step_name};
use probe::{NsAccess, Probe};

pub(crate) use super::unix::{Child, TreeKiller};

/// A policy the host can enforce, with its pieces built and ready to apply in the child.
pub(crate) struct Prepared {
    enforcement: Enforcement,
    policy: ResolvedPolicy,
    ruleset: Option<landlock::Built>,
    seccomp: Option<BpfProgram>,
    namespaces: Option<NamespacePlan>,
    rlimits: Vec<RlimitSpec>,
    drop_bounding_to: Option<u32>,
}

impl Prepared {
    /// The report for the child this will start.
    pub(crate) fn enforcement(&self) -> &Enforcement {
        &self.enforcement
    }

    /// Starts the program with the sandbox applied. See the module contract in `platform`.
    pub(crate) fn spawn(self, spec: LaunchSpec<'_>) -> Result<Launch> {
        let status = StatusPipe::new()?;
        let inherit_fd = match &spec.inherit {
            Some(fd) if fd.as_raw_fd() < 3 => {
                return Err(Error::invalid(
                    "the inherited descriptor must be numbered 3 or higher (0-2 are stdio)",
                ));
            }
            Some(fd) => fd.as_raw_fd(),
            None => -1,
        };
        let plan = ChildPlan {
            inherit_fd,
            status_fd: status.write.as_raw_fd(),
            namespaces: self.namespaces,
            rlimits: self.rlimits,
            drop_bounding_to: self.drop_bounding_to,
            no_new_privs: self.ruleset.is_some() || self.seccomp.is_some(),
            landlock_fd: self.ruleset.as_ref().map(|b| b.ruleset.raw_fd()),
            seccomp: self.seccomp,
        };

        let mut cmd = Command::new(spec.program);
        cmd.args(spec.args)
            .env_clear()
            .current_dir(&self.policy.cwd);
        for (key, value) in &self.policy.env {
            cmd.env(key, value);
        }
        spawn::install(&mut cmd, plan);
        let launch = start(cmd, spec.stdin, Some(status), step_name);
        // `spec.inherit` and the ruleset stay open in the parent until the child has exec'd.
        drop(spec.inherit);
        drop(self.ruleset);
        launch
    }
}

fn probe_error(step: &str, source: std::io::Error) -> Error {
    Error::Setup {
        step: step.to_owned(),
        source,
    }
}

/// Decides what can be enforced for `policy` and builds the pieces. Fails with
/// `Error::Unavailable` when a requested dimension cannot be held and may not be degraded.
pub(crate) fn prepare(policy: &ResolvedPolicy) -> Result<Prepared> {
    let probe = probe::get();
    let plan = plan::make(probe, policy)?;

    let ruleset = match plan.landlock_abi {
        Some(abi) => Some(
            landlock::build(policy, abi).map_err(|e| probe_error("build landlock ruleset", e))?,
        ),
        None => None,
    };
    let seccomp = match plan.socket_mode {
        Some(mode) => Some(
            seccomp::build(mode)
                .map_err(|e| probe_error("compile seccomp filter", std::io::Error::other(e)))?,
        ),
        None => None,
    };

    let mut fs = plan.fs;
    if let (Some(abi), Some(built)) = (plan.landlock_abi, &ruleset) {
        fs.detail = Some(fs_detail(abi, built));
    }

    // Emptying the bounding set needs CAP_SETPCAP, which a user namespace also grants.
    let use_userns =
        plan.netns == Some(NsAccess::ViaUserns) || plan.pidns == Some(NsAccess::ViaUserns);
    let can_drop = probe.can_drop_bounding || use_userns;
    let drop_bounding_to = can_drop.then_some(probe.cap_last);

    let namespaces = (plan.netns.is_some() || plan.pidns.is_some()).then(|| {
        let (uid, gid, _) = sys::ids();
        NamespacePlan {
            net: plan.netns.is_some(),
            pid: plan.pidns.is_some(),
            userns: use_userns.then(|| UserMaps::identity(uid, gid)),
        }
    });
    // A fresh user namespace counts processes from zero; otherwise RLIMIT_NPROC counts every
    // task the user already has.
    let context = RlimitContext {
        baseline_tasks: if use_userns { 0 } else { task_count() },
        enforces_address_space: true,
        enforces_process_count: !probe.is_root,
    };
    let rlimits = rlimits::plan(&policy.resources, policy.kill_grace, context);

    let enforcement = Enforcement {
        platform: "linux".to_owned(),
        fs,
        network: plan.network,
        env: env_report(policy),
        process: process_report(&ProcessFacts {
            probe,
            mode: plan.socket_mode,
            landlocked: ruleset.is_some(),
            bounding: drop_bounding_to.is_some(),
            pid_namespace: plan.pidns,
            rlimits: rlimits::describe(&rlimits, &policy.resources, context),
        }),
    };
    Ok(Prepared {
        enforcement,
        policy: policy.clone(),
        ruleset,
        seccomp,
        namespaces,
        rlimits,
        drop_bounding_to,
    })
}

fn fs_detail(abi: u32, built: &landlock::Built) -> String {
    let scoped = if abi >= 6 {
        "abstract Unix sockets and signals to outside processes are scoped out"
    } else {
        "abstract Unix sockets and signals to outside processes are NOT scoped (needs ABI 6)"
    };
    format!(
        "Landlock ABI {abi}: {ro} read-only and {rw} read-write grants plus {dev} device nodes; \
         every other open, create, write, remove, rename, truncate and exec is denied; {scoped}. \
         Not covered: stat/readlink of unlisted paths, reading /proc/<pid>/environ of same-user \
         processes if /proc is granted, connecting to pathname Unix sockets when network is on",
        ro = built.ro_grants,
        rw = built.rw_grants,
        dev = built.implicit.len(),
    )
}

fn env_report(policy: &ResolvedPolicy) -> DimensionReport {
    DimensionReport::enforced(
        &["env_clear+allowlist"],
        format!(
            "the child sees exactly {} variable(s): the allowlist that is set here plus env_set",
            policy.env.len()
        ),
    )
}

/// Everything the process report states.
struct ProcessFacts<'a> {
    probe: &'a Probe,
    mode: Option<seccomp::SocketMode>,
    landlocked: bool,
    bounding: bool,
    pid_namespace: Option<NsAccess>,
    rlimits: String,
}

/// Tasks (processes and threads) on the system, from `/proc/loadavg` ("running/total"). This
/// over-counts the user's own tasks, which only makes the process allowance more generous.
fn task_count() -> u64 {
    std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().nth(3)?.split_once('/')?.1.parse().ok())
        .unwrap_or(0)
}

fn process_report(f: &ProcessFacts<'_>) -> DimensionReport {
    let mut notes = Vec::new();
    let mut mechanisms = Vec::new();
    if f.pid_namespace.is_some() {
        mechanisms.push("pid-namespace");
        notes.push("the program is init of a PID namespace, so when it exits (or the tree is killed) the kernel kills every descendant, including ones that called setsid or setpgid; SIGTERM does not reach an init without a handler, so the polite stop is cut short".to_owned());
    } else {
        notes.push("no PID namespace is available here, so the tree is killed through its process group and a descendant that calls setsid or setpgid can outlive a kill".to_owned());
    }
    mechanisms.extend(["setsid+killpg", "timeout", "output-cap", "rlimits"]);
    notes.push(format!("rlimits: {}", f.rlimits));
    if f.landlocked || f.mode.is_some() {
        mechanisms.push("no_new_privs");
    }
    if f.mode.is_some() {
        mechanisms.push("seccomp-hardening");
        notes.push("ptrace, process_vm_*, io_uring, bpf, mount, kexec, keyrings and module loading are denied".to_owned());
    } else {
        notes.push("seccomp is unavailable: hardening syscall denials are NOT applied".to_owned());
    }
    mechanisms.push("capabilities-cleared");
    if f.bounding {
        mechanisms.push("bounding-set-cleared");
    } else if f.probe.is_root {
        notes.push("running as root without CAP_SETPCAP: the capability bounding set is retained, so exec of a root program can regain those capabilities".to_owned());
    }
    DimensionReport::enforced(&mechanisms, notes.join("; "))
}

/// What this host can enforce, from live probes.
pub(crate) fn capabilities() -> Capabilities {
    let p = probe::get();
    let fs = match (&p.landlock_abi, p.usable_landlock_abi()) {
        (_, Some(abi)) => Capability::yes(
            "landlock",
            format!("Landlock ABI {abi} verified by a forked probe"),
        ),
        (Ok(abi), None) => Capability::no(
            Some("landlock"),
            format!(
                "Landlock ABI {abi}: needs {}+ and a successful enforcement probe (probe enforced: {})",
                landlock::MIN_ABI,
                p.landlock_enforces
            ),
        ),
        (Err(why), None) => Capability::no(Some("landlock"), why.clone()),
    };
    let off = if p.seccomp_enforces {
        Capability::yes(
            "seccomp",
            "inet sockets denied; Unix sockets limited to connected stream pairs",
        )
    } else {
        Capability::no(
            Some("seccomp"),
            "a forked probe could not install a seccomp filter",
        )
    };
    let loopback = match p.netns {
        NsAccess::Direct => {
            Capability::yes("netns", "unshare(CLONE_NEWNET) works (CAP_SYS_ADMIN held)")
        }
        NsAccess::ViaUserns => Capability::yes(
            "netns",
            "unprivileged user namespace + network namespace works",
        ),
        NsAccess::None => Capability::no(
            Some("netns"),
            "neither CAP_SYS_ADMIN nor unprivileged user namespaces are available",
        ),
    };
    Capabilities {
        platform: "linux".to_owned(),
        os_version: Some(p.kernel.clone()),
        fs,
        network_off: off,
        network_loopback: loopback,
        network_allowlist: Capability::no(
            None,
            "host-name filtering needs an egress proxy; no OS mechanism here does it",
        ),
        process_tree_kill: if p.pidns == NsAccess::None {
            Capability::yes(
                "setsid+killpg",
                "descendants that leave the process group are not reached (no PID namespace here)",
            )
        } else {
            Capability::yes(
                "pid-namespace+killpg",
                "a PID namespace reaps every descendant when its init exits, setsid included",
            )
        },
        inherited_handle: Capability::yes(
            "fd",
            "one descriptor numbered 3 or higher keeps its number in the child",
        ),
    }
}

/// Forbids this process, and everything it starts, from executing any file from now on: a
/// Landlock ruleset that handles `EXECUTE` and grants it nowhere. Used by a worker that has no
/// reason to start a program, once it is running.
pub(crate) fn forbid_exec() -> std::io::Result<()> {
    let ruleset = sys::Ruleset::new(sys::access::EXECUTE, 0)?;
    sys::child_no_new_privs().map_err(std::io::Error::from_raw_os_error)?;
    sys::child_landlock_restrict(ruleset.raw_fd()).map_err(std::io::Error::from_raw_os_error)
}
