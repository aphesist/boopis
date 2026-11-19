//! Linux: Landlock for the filesystem, seccomp for the network and hardening, a private network
//! namespace for loopback, and for the process tree a PID namespace, else a cgroup per run, else a
//! child subreaper (all of them on top of `setsid` plus `killpg`). No setuid helpers, no
//! bubblewrap: every mechanism is a syscall the unprivileged child makes on itself.

mod child;
mod landlock;
mod plan;
mod probe;
mod seccomp;
mod spawn;
mod sys;
mod tree;

use std::os::fd::AsRawFd;
use std::sync::Arc;

use seccompiler::BpfProgram;
use tokio::process::Command;

use super::rlimits::{self, RlimitContext, RlimitSpec};
use super::unix::{StatusPipe, TreeBackend, start};
use super::{Launch, LaunchSpec};
use crate::capabilities::{Capabilities, Capability};
use crate::error::{Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::report::{DimensionReport, Enforcement};
use child::{ChildPlan, NamespacePlan, TreePlan, UserMaps, step_name};
use plan::TreeMethod;
use probe::{NsAccess, Probe};
use tree::{CgroupTree, Supervisor};

pub(crate) use super::unix::{Child, TreeKiller};

/// A policy the host can enforce, with its pieces built and ready to apply in the child.
pub(crate) struct Prepared {
    enforcement: Enforcement,
    policy: ResolvedPolicy,
    ruleset: Option<landlock::Built>,
    seccomp: Vec<BpfProgram>,
    namespaces: Option<NamespacePlan>,
    /// The run's cgroup, when that is how its tree is ended. Dropping it (a spawn that never
    /// happened, or the last handle on the child) ends the members and removes the directory.
    cgroup: Option<Arc<CgroupTree>>,
    tree: TreeMethod,
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
        let (tree_plan, backend): (TreePlan, Option<Arc<dyn TreeBackend>>) =
            match (&self.cgroup, self.tree) {
                (Some(cgroup), _) => (
                    TreePlan::Cgroup(
                        cgroup
                            .procs_file()
                            .map_err(|e| probe_error("locate the cgroup", e))?,
                    ),
                    Some(cgroup.clone()),
                ),
                (None, TreeMethod::Subreaper) => (TreePlan::Subreaper, Some(Arc::new(Supervisor))),
                (None, _) => (TreePlan::None, None),
            };
        let plan = ChildPlan {
            inherit_fd,
            status_fd: status.write.as_raw_fd(),
            namespaces: self.namespaces,
            tree: tree_plan,
            rlimits: self.rlimits,
            drop_bounding_to: self.drop_bounding_to,
            no_new_privs: self.ruleset.is_some() || !self.seccomp.is_empty(),
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
        let launch = start(cmd, spec.stdin, Some(status), step_name, backend);
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
    prepare_with(probe::get(), policy)
}

/// [`prepare`] over a given probe result, so tests can ask for a mechanism this host has not.
fn prepare_with(probe: &Probe, policy: &ResolvedPolicy) -> Result<Prepared> {
    let mut plan = plan::make(probe, policy)?;
    // The cgroup is made here, in the parent, so the report can only say "cgroup" for a run
    // that has one. If the directory cannot be made after all (the delegation went away), plan
    // again without it, which picks the next mechanism or fails.
    let mut cgroup = None;
    if plan.tree == TreeMethod::Cgroup {
        let made = probe
            .cgroup
            .as_ref()
            .map_err(Clone::clone)
            .and_then(|base| {
                CgroupTree::create(base).map_err(|e| format!("{}: {e}", base.display()))
            });
        match made {
            Ok(tree) => cgroup = Some(tree),
            Err(why) => {
                let mut without = probe.clone();
                without.cgroup = Err(why);
                plan = plan::make(&without, policy)?;
            }
        }
    }

    let ruleset = match plan.landlock_abi {
        Some(abi) => Some(
            landlock::build(policy, abi).map_err(|e| probe_error("build landlock ruleset", e))?,
        ),
        None => None,
    };
    let seccomp = match plan.socket_mode {
        Some(mode) => seccomp::build(mode)
            .map_err(|e| probe_error("compile seccomp filter", std::io::Error::other(e)))?,
        None => Vec::new(),
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
            landlock_abi: plan.landlock_abi,
            landlocked: ruleset.is_some(),
            bounding: drop_bounding_to.is_some(),
            tree: plan.tree,
            cgroup: cgroup.as_ref().map(|c| c.dir()),
            rlimits: rlimits::describe(&rlimits, &policy.resources, context),
        }),
    };
    Ok(Prepared {
        enforcement,
        policy: policy.clone(),
        ruleset,
        seccomp,
        namespaces,
        cgroup,
        tree: plan.tree,
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

/// Tasks (processes and threads) on the system, from `/proc/loadavg` ("running/total"). This
/// over-counts the user's own tasks, which only makes the process allowance more generous.
fn task_count() -> u64 {
    std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().nth(3)?.split_once('/')?.1.parse().ok())
        .unwrap_or(0)
}

/// Everything the process report states.
struct ProcessFacts<'a> {
    probe: &'a Probe,
    mode: Option<seccomp::SocketMode>,
    /// The Landlock ABI in force, if any.
    landlock_abi: Option<u32>,
    landlocked: bool,
    bounding: bool,
    tree: TreeMethod,
    /// The directory of this run's cgroup, when it has one.
    cgroup: Option<&'a std::path::Path>,
    rlimits: String,
}

/// The mechanism name and the sentence that says how the tree ends.
fn tree_report(f: &ProcessFacts<'_>) -> (Option<&'static str>, String) {
    // A supervisor can be killed from inside by a process of the same user, which leaves its
    // orphans to `init`; Landlock's signal scoping (ABI 6) is what forbids that.
    let signals_scoped = f.landlock_abi.is_some_and(|abi| abi >= 6);
    match f.tree {
        TreeMethod::PidNamespace(_) => (
            Some("pid-namespace"),
            "the program is init of a PID namespace, so when it exits (or the tree is killed) the kernel kills every descendant, including ones that called setsid or setpgid; SIGTERM does not reach an init without a handler, so the polite stop is cut short".to_owned(),
        ),
        TreeMethod::Cgroup => (
            Some("cgroup-kill"),
            format!(
                "no PID namespace is available here, so every process of the run is a member of its own cgroup v2 subtree ({}) and the kill writes cgroup.kill, which ends every member, including ones that called setsid or setpgid; {}",
                f.cgroup.map_or_else(String::new, |p| p.display().to_string()),
                if f.landlocked {
                    "the program cannot move itself out because Landlock denies it the cgroup files"
                } else {
                    "without Landlock nothing stops a program from writing another cgroup's cgroup.procs to leave"
                }
            ),
        ),
        TreeMethod::Subreaper => (
            Some("subreaper"),
            format!(
                "no PID namespace or usable cgroup is available here, so the leader is a supervisor that is a child subreaper: a descendant that calls setsid or setpgid and is orphaned comes back to it, and when the program exits or the kill is requested the supervisor kills everything it inherited until none is left; {}",
                if signals_scoped {
                    "Landlock scopes signals to the sandbox, so the program cannot kill the supervisor"
                } else {
                    "a program that kills the supervisor itself (same user, and this Landlock ABI does not scope signals) leaves its setsid descendants to init"
                }
            ),
        ),
        TreeMethod::GroupOnly => (
            None,
            format!(
                "NOT ENFORCED: no PID namespace, cgroup ({}) or child subreaper is available here, so the tree is killed through its process group and a descendant that calls setsid or setpgid can outlive a kill; running this way because the policy allows a degraded process dimension",
                f.probe.cgroup.as_ref().err().map_or("", String::as_str)
            ),
        ),
    }
}

fn process_report(f: &ProcessFacts<'_>) -> DimensionReport {
    let (method, tree_note) = tree_report(f);
    let mut mechanisms: Vec<&str> = method.into_iter().collect();
    let mut notes = vec![tree_note];
    mechanisms.extend(["setsid+killpg", "timeout", "output-cap", "rlimits"]);
    notes.push(format!("rlimits: {}", f.rlimits));
    if f.landlocked || f.mode.is_some() {
        mechanisms.push("no_new_privs");
    }
    if f.mode.is_some() {
        mechanisms.push("seccomp-hardening");
        notes.push("ptrace, process_vm_*, pidfd_getfd, kcmp, io_uring, bpf, mount and the new mount API, open_by_handle_at, kexec, keyrings, module loading, unshare, setns, clone with CLONE_NEW* flags and every x32 syscall are denied; clone3 reports ENOSYS so libc falls back to clone".to_owned());
    } else {
        notes.push("seccomp is unavailable: hardening syscall denials are NOT applied".to_owned());
    }
    mechanisms.push("capabilities-cleared");
    if f.bounding {
        mechanisms.push("bounding-set-cleared");
    } else if f.probe.is_root {
        notes.push("running as root without CAP_SETPCAP: the capability bounding set is retained, so exec of a root program can regain those capabilities".to_owned());
    }
    let detail = notes.join("; ");
    if f.tree == TreeMethod::GroupOnly {
        DimensionReport::degraded(&mechanisms, detail)
    } else {
        DimensionReport::enforced(&mechanisms, detail)
    }
}

/// Whether the tree can be ended with setsid escapees included, and by which mechanism. This is
/// what `sandbox.process_tree_kill` stands for: a host where only the process group is left does
/// not claim it.
fn tree_capability(p: &Probe) -> Capability {
    if p.pidns != NsAccess::None {
        Capability::yes(
            "pid-namespace+killpg",
            "a PID namespace reaps every descendant when its init exits, setsid included",
        )
    } else if let Ok(base) = &p.cgroup {
        Capability::yes(
            "cgroup-kill+killpg",
            format!(
                "one cgroup v2 subtree per run under {}, ended with cgroup.kill, setsid included",
                base.display()
            ),
        )
    } else if p.subreaper.is_ok() {
        Capability::yes(
            "subreaper+killpg",
            format!(
                "a child subreaper supervisor kills every orphan, setsid included (no PID namespace; no usable cgroup: {})",
                p.cgroup.as_ref().err().map_or("", String::as_str)
            ),
        )
    } else {
        Capability::no(
            Some("setsid+killpg"),
            format!(
                "only the process group is available, so a descendant that calls setsid escapes a kill: no PID namespace, no cgroup ({}), no child subreaper ({})",
                p.cgroup.as_ref().err().map_or("", String::as_str),
                p.subreaper.as_ref().err().map_or("", String::as_str)
            ),
        )
    }
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
            "inet sockets denied; only AF_UNIX SOCK_STREAM sockets (and SOCK_STREAM or SOCK_SEQPACKET socket pairs) exist, no datagram or raw, and connect, bind and listen are denied",
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
        process_tree_kill: tree_capability(p),
        inherited_handle: Capability::yes(
            "fd",
            "one descriptor numbered 3 or higher keeps its number in the child",
        ),
    }
}
