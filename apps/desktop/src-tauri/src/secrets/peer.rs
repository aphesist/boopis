//! Who may use the host's secret channel: the gateway the host started, and nothing else.
//!
//! The channel's token only proves that a process was *handed* it; any same-user process can read a variable out of
//! `/proc/<pid>/environ`, so the token is a second factor at best. The first is the kernel's own answer to "who is on the
//! other end": `SO_PEERCRED` gives the connecting process's pid, and this module decides whether that process is the
//! gateway. A tool the agent runs is a *child* of the gateway, so a descendant of the gateway is refused, and only the
//! gateway itself passes.
//!
//! Two rules admit a peer, both from what the host itself saw:
//! - **A, the running gateway.** After the host starts or attaches to a gateway it records that process (its pid, the
//!   time it started, so a recycled pid is not it, and its executable). A peer passes when it is that very process: same
//!   pid, same start time, same executable. The pid comes from the kernel's report on the gateway's control socket, and a
//!   process is recorded only if it was started with the token this run handed out in its environment (so a gateway an
//!   earlier run left behind, which could not authenticate anyway, is not recorded).
//! - **B, the launch window.** The gateway reads its secrets while it starts, before the host has seen it. The host
//!   notes the `hermes gateway ensure` or `attach --start` process it spawned (a [`LaunchGuard`], alive for the call), and
//!   a peer passes when it descends from that process and was started with the token: the daemon that call is starting.
//!   The window closes when the call returns, before any session, so no tool child can exist in it. (The command line is
//!   deliberately not part of either rule: Hermes may retitle its process, and a command line is the peer's to choose.)
//!   On macOS Hermes does not start the daemon as its own child: it hands it to launchd as a one-off job run through
//!   `/usr/bin/osascript` (so macOS lets it reach the local network after the app that asked for it quits;
//!   `hermes_cli/gateway_launchd_runtime.py`), so the daemon's parent is that `osascript` and its parent launchd, never the
//!   launcher. There the daemon passes instead when its parent is `osascript` directly under launchd, it was created after
//!   a launcher in flight began, and it was started with this run's token: the token is required outright (a process the
//!   platform cannot read is refused), which is what stands in for the descent no launchd job can show.
//!
//! Linux reads `/proc` for the start time, the executable, the parent and the environment it started with, and refuses a
//! process it cannot read. macOS asks the kernel the same four questions (`proc_pidinfo`, `proc_pidpath` and
//! `KERN_PROCARGS2`, in [`super::macos`]). Other Unix systems have neither here: the pid alone is compared and rule B is
//! never met, so a gateway's first read at start-up is refused there until a launch is known by pid (documented in
//! `AGENTS.md`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// A process, pinned: its pid, when it started (a recycled pid starts later) and its executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    /// The process id (the kernel's thread-group id).
    pub pid: u32,
    /// When the process was created, only ever compared with itself: clock ticks since boot on Linux (`/proc/<pid>/stat`
    /// field 22), microseconds since the epoch on macOS (`pbi_start`). Neither changes at `exec`. `None` elsewhere.
    pub start: Option<u64>,
    /// The executable the kernel runs (`/proc/<pid>/exe`, macOS's `proc_pidpath`). `None` elsewhere.
    pub exe: Option<PathBuf>,
}

/// What the host can ask the operating system about a process. A trait so the rules are tested over a made-up process
/// table, and the real thing over real processes.
pub trait Procs: Send + Sync {
    /// The process, or `None` when it is gone or cannot be read (a process that cannot be pinned is never admitted).
    fn describe(&self, pid: u32) -> Option<Proc>;
    /// Its parent's pid.
    fn parent(&self, pid: u32) -> Option<u32>;
    /// Whether the environment the process was started with holds exactly `entry` (`NAME=value`). Only where the platform
    /// can say; otherwise `None`.
    fn started_with(&self, pid: u32, entry: &str) -> Option<bool>;
}

/// The operating system's answer.
#[derive(Debug, Default, Clone, Copy)]
pub struct Os;

#[cfg(target_os = "linux")]
impl Os {
    /// The fields of `/proc/<pid>/stat` after the command name (which may hold spaces and `)`), from field 3 on.
    fn stat_tail(pid: u32) -> Option<Vec<String>> {
        let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let after = text.get(text.rfind(')')? + 1..)?;
        Some(after.split_whitespace().map(str::to_owned).collect())
    }
}

#[cfg(target_os = "linux")]
impl Procs for Os {
    fn describe(&self, pid: u32) -> Option<Proc> {
        // Field 22 is index 19 of the tail (which starts at field 3).
        let start = Self::stat_tail(pid)?.get(19)?.parse().ok()?;
        let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
        Some(Proc {
            pid,
            start: Some(start),
            exe: Some(exe),
        })
    }

    fn parent(&self, pid: u32) -> Option<u32> {
        Self::stat_tail(pid)?.get(1)?.parse().ok()
    }

    fn started_with(&self, pid: u32, entry: &str) -> Option<bool> {
        let raw = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
        Some(raw.split(|b| *b == 0).any(|e| e == entry.as_bytes()))
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Procs for Os {
    fn describe(&self, pid: u32) -> Option<Proc> {
        Some(Proc {
            pid,
            start: None,
            exe: None,
        })
    }
    fn parent(&self, _pid: u32) -> Option<u32> {
        None
    }
    fn started_with(&self, _pid: u32, _entry: &str) -> Option<bool> {
        None
    }
}

/// Why a peer was refused. Logged by the host, never sent to the peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The kernel gave no pid for the connection.
    NoPid,
    /// The process is gone or cannot be read.
    Unreadable,
    /// It is neither the recorded gateway nor a daemon being launched.
    NotTheGateway,
}

/// How far up the parent chain rule B looks for the launcher: the launcher, a wrapper, the CLI, the daemon.
const MAX_HOPS: usize = 6;
/// The program a macOS launchd job of Hermes's gateway runs, and whose only child the daemon is (rule B, macOS). Only ever
/// a parent here, under launchd; on another system no process has it as a parent and the rule never applies.
const LAUNCHD_WRAPPER: &str = "/usr/bin/osascript";
/// launchd's pid on macOS (and init's elsewhere).
const LAUNCHD_PID: u32 = 1;
/// Recorded gateways kept: a restart leaves the old one behind until it is replaced.
const MAX_GATEWAYS: usize = 4;

#[derive(Default)]
struct State {
    gateways: Vec<Proc>,
    launchers: Vec<Proc>,
}

/// The rules, and what the host has recorded to apply them to.
pub struct PeerPolicy {
    procs: Arc<dyn Procs>,
    /// The `NAME=value` entry of the token this run handed out; a process must have been started with it.
    holds: Option<String>,
    state: Mutex<State>,
}

impl std::fmt::Debug for PeerPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PeerPolicy").finish_non_exhaustive()
    }
}

impl Default for PeerPolicy {
    fn default() -> Self {
        Self::with_procs(Arc::new(Os))
    }
}

impl PeerPolicy {
    /// A policy over the real operating system.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A policy over any process table (the tests').
    #[must_use]
    pub fn with_procs(procs: Arc<dyn Procs>) -> Self {
        Self {
            procs,
            holds: None,
            state: Mutex::new(State::default()),
        }
    }

    /// Require every process admitted to have been started with `entry` (`NAME=value`) in its environment, where the
    /// platform can say: the token this run hands to the gateway it starts and to nothing else.
    #[must_use]
    pub fn holding(mut self, entry: String) -> Self {
        self.holds = Some(entry);
        self
    }

    /// Whether `pid` fails the token requirement (it can be read, and it was not started with the token).
    fn lacks_token(&self, pid: u32) -> bool {
        self.holds
            .as_deref()
            .is_some_and(|entry| self.procs.started_with(pid, entry) == Some(false))
    }

    /// Records the gateway the host is talking to (rule A). Called with the pid the kernel reported on the gateway's own
    /// control socket, so it is the process that listens there, not a guess. Where the platform can say, the process must
    /// have been started with this run's token ([`PeerPolicy::holding`]). `false` when the process cannot be pinned or
    /// does not qualify.
    pub fn record_gateway(&self, pid: u32) -> bool {
        let Some(proc) = self.procs.describe(pid) else {
            return false;
        };
        if self.lacks_token(pid) {
            return false;
        }
        let Ok(mut s) = self.state.lock() else {
            return false;
        };
        s.gateways.retain(|g| g.pid != pid);
        s.gateways.push(proc);
        let extra = s.gateways.len().saturating_sub(MAX_GATEWAYS);
        s.gateways.drain(..extra);
        true
    }

    /// Notes a `hermes` process the host spawned to start a gateway (rule B), until the guard is dropped.
    #[must_use]
    pub fn begin_launch(self: &Arc<Self>, pid: u32) -> LaunchGuard {
        if let (Some(proc), Ok(mut s)) = (self.procs.describe(pid), self.state.lock()) {
            s.launchers.push(proc);
        }
        LaunchGuard {
            policy: Arc::clone(self),
            pid,
        }
    }

    /// Decides one connection from the pid the kernel reported for it.
    ///
    /// # Errors
    /// Why the peer is not the gateway.
    pub fn admit(&self, peer: Option<u32>) -> Result<(), Refusal> {
        let pid = peer.ok_or(Refusal::NoPid)?;
        let now = self.procs.describe(pid).ok_or(Refusal::Unreadable)?;
        let s = self.state.lock().map_err(|_| Refusal::Unreadable)?;
        if s.gateways.contains(&now) {
            return Ok(());
        }
        if !s.launchers.is_empty() && self.in_launch_window(pid, &s.launchers) {
            return Ok(());
        }
        Err(Refusal::NotTheGateway)
    }

    /// Rule B: the peer holds the token and sits below a launcher the host still has in flight, or, on macOS, is the
    /// launchd job such a launcher started (see [`PeerPolicy::launched_by_launchd`]).
    fn in_launch_window(&self, pid: u32, launchers: &[Proc]) -> bool {
        if self.lacks_token(pid) {
            return false;
        }
        self.descends_from_launcher(pid, launchers) || self.launched_by_launchd(pid, launchers)
    }

    /// Rule B as the daemon's ancestry shows it: a launcher in flight is up its parent chain, within [`MAX_HOPS`].
    fn descends_from_launcher(&self, pid: u32, launchers: &[Proc]) -> bool {
        let mut at = pid;
        for _ in 0..MAX_HOPS {
            let Some(parent) = self.procs.parent(at) else {
                return false;
            };
            // The same pid *and* the same start time: a recycled pid is not the launcher. The executable is not compared:
            // Hermes's launcher is a shell script that `exec`s Python, so the process the host noted as `sh` is `python` by
            // the time its daemon asks, with the same pid and start time. (Rule A still pins the executable.)
            if launchers.iter().any(|l| {
                l.pid == parent
                    && self
                        .procs
                        .describe(parent)
                        .is_some_and(|now| now.pid == l.pid && now.start == l.start)
            }) {
                return true;
            }
            if parent <= 1 {
                return false;
            }
            at = parent;
        }
        false
    }

    /// Rule B for a daemon launchd started (macOS): its parent is [`LAUNCHD_WRAPPER`] and that wrapper's parent is
    /// launchd, it was created after a launcher in flight began (same pid and start time as when the host noted it), and
    /// it was started with this run's token, which must be readable and present: with no token required, or one the
    /// platform cannot read, the rule admits nothing.
    fn launched_by_launchd(&self, pid: u32, launchers: &[Proc]) -> bool {
        let Some(entry) = self.holds.as_deref() else {
            return false;
        };
        if self.procs.started_with(pid, entry) != Some(true) {
            return false;
        }
        let Some(born) = self.procs.describe(pid).and_then(|p| p.start) else {
            return false;
        };
        let Some(wrapper) = self.procs.parent(pid) else {
            return false;
        };
        let is_wrapper = self
            .procs
            .describe(wrapper)
            .and_then(|w| w.exe)
            .is_some_and(|exe| exe == std::path::Path::new(LAUNCHD_WRAPPER));
        if !is_wrapper || self.procs.parent(wrapper) != Some(LAUNCHD_PID) {
            return false;
        }
        launchers.iter().any(|l| {
            l.start.is_some_and(|began| born >= began)
                && self
                    .procs
                    .describe(l.pid)
                    .is_some_and(|now| now.start == l.start)
        })
    }
}

/// Keeps a launch noted for rule B while the call that started the gateway runs.
#[derive(Debug)]
pub struct LaunchGuard {
    policy: Arc<PeerPolicy>,
    pid: u32,
}

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = self.policy.state.lock() {
            s.launchers.retain(|l| l.pid != self.pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// One made-up process: start time, executable, parent.
    type Entry = (u64, &'static str, u32);

    /// A made-up process table, and the entries some of its processes were started with.
    #[derive(Default)]
    struct Table {
        procs: Mutex<HashMap<u32, Entry>>,
        env: Mutex<HashMap<u32, Vec<&'static str>>>,
    }

    impl Table {
        fn put(&self, pid: u32, start: u64, exe: &'static str, parent: u32) {
            self.procs.lock().unwrap().insert(pid, (start, exe, parent));
        }
        fn started_with_env(&self, pid: u32, entries: &[&'static str]) {
            self.env.lock().unwrap().insert(pid, entries.to_vec());
        }
        fn kill(&self, pid: u32) {
            self.procs.lock().unwrap().remove(&pid);
        }
    }

    impl Procs for Table {
        fn describe(&self, pid: u32) -> Option<Proc> {
            self.procs
                .lock()
                .unwrap()
                .get(&pid)
                .map(|(start, exe, _)| Proc {
                    pid,
                    start: Some(*start),
                    exe: Some(PathBuf::from(exe)),
                })
        }
        fn parent(&self, pid: u32) -> Option<u32> {
            self.procs.lock().unwrap().get(&pid).map(|p| p.2)
        }
        fn started_with(&self, pid: u32, entry: &str) -> Option<bool> {
            Some(
                self.env
                    .lock()
                    .unwrap()
                    .get(&pid)
                    .is_some_and(|e| e.contains(&entry)),
            )
        }
    }

    const PY: &str = "/rt/python";
    const HOLDS: &str = "BOOPIS_HOST_SECRETS_TOKEN=abc";

    /// init, the app, and a policy that wants the token.
    fn world() -> (Arc<Table>, Arc<PeerPolicy>) {
        let t = Arc::new(Table::default());
        t.put(1, 0, "/sbin/init", 0);
        t.put(100, 10, "/app/boopis", 1);
        let policy = PeerPolicy::with_procs(t.clone()).holding(HOLDS.to_owned());
        (t, Arc::new(policy))
    }

    /// A process of the gateway's kind: it was started with the token.
    fn gateway(t: &Table, pid: u32, start: u64, parent: u32) {
        t.put(pid, start, PY, parent);
        t.started_with_env(pid, &[HOLDS]);
    }

    #[test]
    fn the_recorded_gateway_is_admitted_and_nothing_else_is() {
        let (t, p) = world();
        gateway(&t, 200, 20, 1);
        assert!(p.record_gateway(200));
        assert_eq!(p.admit(Some(200)), Ok(()));
        // A tool the agent runs is a child of the gateway, with the token in its environment if it read one: not the gateway.
        t.put(300, 30, "/bin/sh", 200);
        t.started_with_env(300, &[HOLDS]);
        assert_eq!(p.admit(Some(300)), Err(Refusal::NotTheGateway));
        // Another process of the same user, the app itself, a pid that is gone, no pid.
        t.put(400, 40, "/usr/bin/python3", 1);
        assert_eq!(p.admit(Some(400)), Err(Refusal::NotTheGateway));
        assert_eq!(p.admit(Some(100)), Err(Refusal::NotTheGateway));
        assert_eq!(p.admit(Some(999)), Err(Refusal::Unreadable));
        assert_eq!(p.admit(None), Err(Refusal::NoPid));
    }

    #[test]
    fn a_launcher_that_execs_another_program_is_still_the_launcher() {
        let (t, p) = world();
        // The host notes the `hermes` launcher it spawned while it is the shell script, and the script then execs Python.
        t.put(150, 15, "/bin/sh", 100);
        let _guard = p.begin_launch(150);
        t.put(150, 15, PY, 100);
        gateway(&t, 200, 20, 150);
        assert_eq!(p.admit(Some(200)), Ok(()));
        // A recycled pid (a later start time) in the launcher's place is still not it.
        t.put(150, 99, PY, 100);
        assert_eq!(p.admit(Some(200)), Err(Refusal::NotTheGateway));
    }

    #[test]
    fn only_a_gateway_started_with_this_runs_token_is_recorded() {
        let (t, p) = world();
        // One an earlier run left behind: another token in its environment, or none.
        t.put(200, 20, PY, 1);
        t.started_with_env(200, &["BOOPIS_HOST_SECRETS_TOKEN=old"]);
        assert!(!p.record_gateway(200));
        t.put(201, 21, PY, 1);
        assert!(!p.record_gateway(201));
        assert_eq!(p.admit(Some(200)), Err(Refusal::NotTheGateway));
        gateway(&t, 202, 22, 1);
        assert!(p.record_gateway(202));
        assert_eq!(p.admit(Some(202)), Ok(()));
        assert_eq!(p.admit(Some(201)), Err(Refusal::NotTheGateway));
        // A process the host cannot pin is never recorded.
        assert!(!p.record_gateway(555));
    }

    #[test]
    fn a_recycled_pid_or_a_replaced_executable_is_not_the_gateway() {
        let (t, p) = world();
        gateway(&t, 200, 20, 1);
        p.record_gateway(200);
        // The gateway exits and an unrelated process gets its pid.
        t.kill(200);
        gateway(&t, 200, 99, 1);
        assert_eq!(
            p.admit(Some(200)),
            Err(Refusal::NotTheGateway),
            "later start time"
        );
        // Same pid and start time, but it exec'd something else.
        t.put(200, 20, "/usr/bin/python3", 1);
        assert_eq!(
            p.admit(Some(200)),
            Err(Refusal::NotTheGateway),
            "another executable"
        );
    }

    #[test]
    fn the_daemon_a_launch_is_starting_is_admitted_only_while_the_launch_runs() {
        let (t, p) = world();
        // The host spawns `hermes gateway ensure` (pid 210); it starts the daemon (pid 211), which inherits the token.
        gateway(&t, 210, 21, 100);
        let guard = p.begin_launch(210);
        gateway(&t, 211, 22, 210);
        assert_eq!(
            p.admit(Some(211)),
            Ok(()),
            "the gateway reading its secrets as it starts"
        );
        // The launcher itself is not below itself, and a helper that was not given the token is not the daemon.
        assert_eq!(p.admit(Some(210)), Err(Refusal::NotTheGateway));
        t.put(212, 23, "/bin/sh", 210);
        assert_eq!(
            p.admit(Some(212)),
            Err(Refusal::NotTheGateway),
            "no token in its environment"
        );
        // The call returns: the window closes, and the daemon is admitted only as a recorded gateway.
        drop(guard);
        assert_eq!(p.admit(Some(211)), Err(Refusal::NotTheGateway));
        assert!(p.record_gateway(211));
        assert_eq!(p.admit(Some(211)), Ok(()));
    }

    #[test]
    fn a_process_that_is_not_below_a_launch_the_host_started_is_refused() {
        let (t, p) = world();
        gateway(&t, 210, 21, 100);
        let _guard = p.begin_launch(210);
        // Holding the token, but its parent chain does not meet the launcher (an agent that read it and ran its own).
        gateway(&t, 500, 50, 1);
        assert_eq!(p.admit(Some(500)), Err(Refusal::NotTheGateway));
        // A chain that does reach it is fine (a wrapper in between); one past the hop limit is not.
        gateway(&t, 501, 51, 210);
        gateway(&t, 502, 52, 501);
        assert_eq!(p.admit(Some(502)), Ok(()));
        let mut parent = 210;
        for pid in 600..608 {
            gateway(&t, pid, 60, parent);
            parent = pid;
        }
        gateway(&t, 700, 70, parent);
        assert_eq!(p.admit(Some(700)), Err(Refusal::NotTheGateway));
        // A launcher whose pid was recycled no longer opens the window.
        t.kill(210);
        t.put(210, 999, PY, 100);
        assert_eq!(p.admit(Some(502)), Err(Refusal::NotTheGateway));
    }

    /// macOS: Hermes hands the daemon to launchd, which runs it under `/usr/bin/osascript`; it never descends from the
    /// launcher, so it passes only as that job, while the launch runs, created after it began, holding the token.
    #[test]
    fn the_launchd_job_a_launch_started_is_admitted_with_the_token_only() {
        let (t, p) = world();
        t.put(1, 0, "/sbin/launchd", 0);
        gateway(&t, 210, 21, 100);
        let guard = p.begin_launch(210);
        t.put(220, 22, LAUNCHD_WRAPPER, 1);
        gateway(&t, 221, 23, 220);
        assert_eq!(
            p.admit(Some(221)),
            Ok(()),
            "the job's daemon reading its secrets as it starts"
        );
        // the wrapper itself, and a daemon of the same shape without the token or with another one
        assert_eq!(p.admit(Some(220)), Err(Refusal::NotTheGateway));
        t.put(222, 23, PY, 220);
        assert_eq!(p.admit(Some(222)), Err(Refusal::NotTheGateway), "no token");
        t.put(223, 23, PY, 220);
        t.started_with_env(223, &["BOOPIS_HOST_SECRETS_TOKEN=old"]);
        assert_eq!(
            p.admit(Some(223)),
            Err(Refusal::NotTheGateway),
            "another run's token"
        );
        // created before the launch began: not the job this launch started
        t.put(230, 5, LAUNCHD_WRAPPER, 1);
        gateway(&t, 231, 6, 230);
        assert_eq!(
            p.admit(Some(231)),
            Err(Refusal::NotTheGateway),
            "older than the launch"
        );
        // the token under another parent, or a wrapper that is not directly under launchd
        t.put(240, 24, "/bin/sh", 1);
        gateway(&t, 241, 25, 240);
        assert_eq!(
            p.admit(Some(241)),
            Err(Refusal::NotTheGateway),
            "not osascript"
        );
        t.put(250, 24, LAUNCHD_WRAPPER, 100);
        gateway(&t, 251, 25, 250);
        assert_eq!(
            p.admit(Some(251)),
            Err(Refusal::NotTheGateway),
            "osascript not under launchd"
        );
        // a launcher whose pid was recycled opens no window
        t.put(210, 999, PY, 100);
        assert_eq!(
            p.admit(Some(221)),
            Err(Refusal::NotTheGateway),
            "recycled launcher"
        );
        t.put(210, 21, PY, 100);
        // the call returns: the window closes, and the daemon is admitted only once it is recorded
        drop(guard);
        assert_eq!(p.admit(Some(221)), Err(Refusal::NotTheGateway));
        assert!(p.record_gateway(221));
        assert_eq!(p.admit(Some(221)), Ok(()));
    }

    /// With no token required (or none the platform can read), the launchd rule admits nothing: it has no descent to rely on.
    #[test]
    fn the_launchd_rule_needs_a_token_to_check() {
        let t = Arc::new(Table::default());
        t.put(1, 0, "/sbin/launchd", 0);
        t.put(100, 10, "/app/boopis", 1);
        let p = Arc::new(PeerPolicy::with_procs(t.clone()));
        t.put(210, 21, PY, 100);
        let _guard = p.begin_launch(210);
        t.put(220, 22, LAUNCHD_WRAPPER, 1);
        gateway(&t, 221, 23, 220);
        assert_eq!(p.admit(Some(221)), Err(Refusal::NotTheGateway));
        // the descent rule is unchanged without a token requirement
        gateway(&t, 211, 22, 210);
        assert_eq!(p.admit(Some(211)), Ok(()));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn the_real_process_table_is_read_and_a_child_is_not_its_parent() {
        let os = Os;
        let me = std::process::id();
        let mine = os.describe(me).unwrap();
        assert_eq!(
            mine.exe,
            std::env::current_exe()
                .ok()
                .and_then(|e| std::fs::canonicalize(e).ok())
        );
        assert!(mine.start.is_some());
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .env("HX_PEER_CHILD_ONLY", "1")
            .spawn()
            .unwrap();
        let kid = os.describe(child.id()).unwrap();
        assert_ne!(kid, mine);
        assert_eq!(os.parent(child.id()), Some(me));
        // The environment a process started with is the kernel's (Linux /proc, macOS KERN_PROCARGS2): a variable only the
        // child was given is there.
        let hold = "HX_PEER_CHILD_ONLY=1";
        assert_eq!(os.started_with(child.id(), "HX_NO_SUCH=1"), Some(false));
        assert_eq!(os.started_with(me, hold), Some(false));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while os.started_with(child.id(), hold) != Some(true)
            && std::time::Instant::now() < deadline
        {
            std::thread::yield_now(); // between fork and exec it still shows this binary's environment
        }
        assert_eq!(os.started_with(child.id(), hold), Some(true));
        // and once it runs `sleep`, the kernel names that executable, not this one
        assert_ne!(os.describe(child.id()).unwrap().exe, mine.exe);
        // The policy over the real table: this process is the gateway (no token required), its child is not.
        let p = PeerPolicy::new();
        assert!(p.record_gateway(me));
        assert_eq!(p.admit(Some(me)), Ok(()));
        assert_eq!(
            p.admit(Some(child.id())),
            Err(Refusal::NotTheGateway),
            "a child of the gateway"
        );
        // With a token required that this process was not started with, it is not recorded.
        let strict = PeerPolicy::new().holding("HX_NO_SUCH=1".to_owned());
        assert!(!strict.record_gateway(me));
        child.kill().unwrap();
        child.wait().unwrap();
    }
}
