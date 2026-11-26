//! Who is on the other end of a loopback connection to the boopis host, and whether any of them is a bot (B47, H4;
//! `docs/specs/host-protections.md` section 6, ADR-0062).
//!
//! The local API's token proves only that a client read a file. A bot runs as the owner's user, so a tool it runs could
//! read that file and answer an approval, or speak in the owner's voice. Before the host acts on such a request it asks
//! this crate who holds the client's end of the TCP connection, and refuses the request when **any** holder is a bot's
//! process:
//!
//! 1. **Ancestry**: a gateway the host identified (pid and start time, from the kernel's report on the engine's control
//!    socket) is the holder itself or on its parent chain, up to [`MAX_HOPS`] hops or pid 1.
//! 2. **Environment**: the holder was started with [`ENGINE_LAUNCH_ENV`] in its environment, whatever its value. The host
//!    puts it in the gateway's launch environment; the plugin does not remove it, so every child of the engine inherits
//!    it, across `setsid` and a double fork.
//! 3. **Group** (Linux): the holder sits in the gateway's own cgroup, when that cgroup is not the host's own and not a
//!    login session's scope (then it says nothing and is skipped).
//!
//! **Fail closed.** No gateway identified yet, a connection the table cannot find, a holder whose parent or environment
//! cannot be read, and a platform that cannot say are all [`Verdict::Unproven`], which the host refuses like a bot.
//!
//! Only Linux can say today (`/proc/net/tcp`, `/proc/<pid>/fd`, `stat`, `environ`, `cgroup`). macOS and Windows answer
//! [`Unproven::Unsupported`]: the owner answers and speaks there through the app until the lookup exists. This is
//! defence in depth, not a sandbox: a program that double-forks, clears its environment and leaves the gateway's cgroup
//! passes all three rules (section 6.4 of the spec).

use std::net::SocketAddr;

/// The variable a gateway the host launches carries, and every process the engine starts inherits.
pub const ENGINE_LAUNCH_ENV: &str = "BOOPIS_ENGINE_LAUNCH";
/// How far up a parent chain rule 1 looks.
pub const MAX_HOPS: usize = 64;

/// A gateway the host identified: its pid, and when it started (a recycled pid starts later), where the platform says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pinned {
    /// The process id.
    pub pid: u32,
    /// Its start time, only ever compared with itself (clock ticks since boot on Linux).
    pub start: Option<u64>,
}

/// Which rule found a bot's process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    /// A recorded gateway is the holder or one of its ancestors.
    Ancestry,
    /// The holder was started with the engine's launch marker.
    Environment,
    /// The holder sits in the gateway's own cgroup.
    Group,
}

impl Rule {
    /// The word the audit records.
    #[must_use]
    pub fn word(self) -> &'static str {
        match self {
            Self::Ancestry => "ancestry",
            Self::Environment => "environment",
            Self::Group => "group",
        }
    }
}

/// Why the holder could not be shown to be the owner's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unproven {
    /// The host has not identified a gateway yet, so rule 1 cannot clear anyone.
    NoGateway,
    /// The connection is not in the table, or nothing holds it.
    NotFound,
    /// A holder's parent or environment cannot be read.
    Unreadable,
    /// This platform cannot say who holds a connection.
    Unsupported,
    /// The lookup took too long (the host's own deadline).
    Timeout,
}

impl Unproven {
    /// The word the audit records.
    #[must_use]
    pub fn word(self) -> &'static str {
        match self {
            Self::NoGateway => "no_gateway",
            Self::NotFound => "not_found",
            Self::Unreadable => "unreadable",
            Self::Unsupported => "unsupported",
            Self::Timeout => "lookup_timeout",
        }
    }
}

/// The answer for one connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Every holder is clear of all three rules: an owner surface.
    Owner,
    /// A holder is a bot's process.
    Bot(Rule),
    /// It could not be shown either way: refused like a bot.
    Unproven(Unproven),
}

impl Verdict {
    /// Whether the request may be acted on.
    #[must_use]
    pub fn is_owner(self) -> bool {
        self == Self::Owner
    }
}

/// What the lookup asks the operating system. A trait so the rules are tested over a made-up table, and the real one over
/// real processes.
pub trait Table {
    /// Every process that holds the client's end of the TCP connection from `client` to `server`.
    ///
    /// # Errors
    /// Why the platform cannot say.
    fn holders(&self, client: SocketAddr, server: SocketAddr) -> Result<Vec<u32>, Unproven>;
    /// When the process started, `None` when it is gone or cannot be read.
    fn start(&self, pid: u32) -> Option<u64>;
    /// Its parent's pid, `None` when it cannot be read.
    fn parent(&self, pid: u32) -> Option<u32>;
    /// Whether it was started with a variable of this name, `None` when its environment cannot be read.
    fn has_var(&self, pid: u32, name: &str) -> Option<bool>;
    /// Its control group, `None` where there is none or it cannot be read.
    fn cgroup(&self, pid: u32) -> Option<String>;
}

/// Judge one connection: the gateways the host identified, and the host's own pid (whose cgroup a gateway may share).
#[must_use]
pub fn judge(
    table: &dyn Table,
    gateways: &[Pinned],
    host_pid: u32,
    client: SocketAddr,
    server: SocketAddr,
) -> Verdict {
    if gateways.is_empty() {
        return Verdict::Unproven(Unproven::NoGateway);
    }
    let holders = match table.holders(client, server) {
        Ok(h) if !h.is_empty() => h,
        Ok(_) => return Verdict::Unproven(Unproven::NotFound),
        Err(why) => return Verdict::Unproven(why),
    };
    let groups = gateway_groups(table, gateways, host_pid);
    for pid in holders {
        match judge_one(table, gateways, &groups, pid) {
            Verdict::Owner => {}
            other => return other,
        }
    }
    Verdict::Owner
}

/// The gateways' cgroups that say something: not the host's own and not a login session's scope.
fn gateway_groups(table: &dyn Table, gateways: &[Pinned], host_pid: u32) -> Vec<String> {
    let host = table.cgroup(host_pid);
    gateways
        .iter()
        .filter(|g| table.start(g.pid).is_some() && table.start(g.pid) == g.start)
        .filter_map(|g| table.cgroup(g.pid))
        .filter(|c| Some(c) != host.as_ref() && !is_shared_group(c))
        .collect()
}

/// A cgroup many unrelated processes share: the root, a login session's scope, a user's own slice.
fn is_shared_group(group: &str) -> bool {
    let last = group.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    group.trim().is_empty()
        || last.is_empty()
        || (last.starts_with("session-") && has_suffix(last, ".scope"))
        || has_suffix(last, ".slice")
}

/// A systemd unit's kind, by its suffix (systemd names are case-sensitive; compared as written, no file extension).
fn has_suffix(name: &str, suffix: &str) -> bool {
    name.len() > suffix.len() && name.get(name.len() - suffix.len()..) == Some(suffix)
}

fn judge_one(table: &dyn Table, gateways: &[Pinned], groups: &[String], pid: u32) -> Verdict {
    // 1. ancestry: the holder itself or any ancestor is a recorded gateway (the same pid and the same start time)
    let mut at = pid;
    for _ in 0..MAX_HOPS {
        if gateways
            .iter()
            .any(|g| g.pid == at && table.start(at).is_some() && table.start(at) == g.start)
        {
            return Verdict::Bot(Rule::Ancestry);
        }
        if at <= 1 {
            break;
        }
        match table.parent(at) {
            Some(0) => break, // the kernel's own tasks have no parent process
            Some(parent) if parent != at => at = parent,
            _ => return Verdict::Unproven(Unproven::Unreadable),
        }
    }
    // 2. environment: started with the engine's launch marker
    match table.has_var(pid, ENGINE_LAUNCH_ENV) {
        Some(true) => return Verdict::Bot(Rule::Environment),
        Some(false) => {}
        None => return Verdict::Unproven(Unproven::Unreadable),
    }
    // 3. group: in a gateway's own cgroup
    if let Some(group) = table.cgroup(pid)
        && groups.contains(&group)
    {
        return Verdict::Bot(Rule::Group);
    }
    Verdict::Owner
}

/// Whether the calling process is a bot's (an owner-only command's self-check, H5): its own environment holds the
/// engine's launch marker (`own_marker`), or an ancestor was started with it (every gateway the host launches carries it,
/// so a process under a gateway has one even after clearing its own environment). An ancestor that cannot be read ends
/// the walk without a verdict: the command has no host state, so only what it can see says bot.
#[must_use]
pub fn bot_caller(table: &dyn Table, own_marker: bool, own_pid: u32) -> Option<Rule> {
    if own_marker {
        return Some(Rule::Environment);
    }
    let mut at = own_pid;
    for _ in 0..MAX_HOPS {
        match table.parent(at) {
            Some(parent) if parent > 1 && parent != at => at = parent,
            _ => return None,
        }
        if table.has_var(at, ENGINE_LAUNCH_ENV) == Some(true) {
            return Some(Rule::Ancestry);
        }
    }
    None
}

/// [`bot_caller`] for this very process, over the operating system's table.
#[must_use]
pub fn this_process_is_a_bot() -> Option<Rule> {
    bot_caller(
        &Os,
        std::env::var_os(ENGINE_LAUNCH_ENV).is_some(),
        std::process::id(),
    )
}

/// The operating system's table.
#[derive(Debug, Default, Clone, Copy)]
pub struct Os;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(not(target_os = "linux"))]
impl Table for Os {
    fn holders(&self, _client: SocketAddr, _server: SocketAddr) -> Result<Vec<u32>, Unproven> {
        Err(Unproven::Unsupported)
    }
    fn start(&self, _pid: u32) -> Option<u64> {
        None
    }
    fn parent(&self, _pid: u32) -> Option<u32> {
        None
    }
    fn has_var(&self, _pid: u32, _name: &str) -> Option<bool> {
        None
    }
    fn cgroup(&self, _pid: u32) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests;
