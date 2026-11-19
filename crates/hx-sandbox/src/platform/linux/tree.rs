//! Ending a process tree on a host without a PID namespace.
//!
//! The process group only reaches descendants that stayed in it; one that called `setsid` or
//! `setpgid` is out of reach. Two mechanisms close that gap, chosen by [`super::plan`] in this
//! order: a cgroup v2 subtree per run, ended with `cgroup.kill` ([`CgroupTree`]), and a
//! supervisor that is a child subreaper and kills everything it inherits ([`Supervisor`]). Both
//! are verified by a forked probe, not assumed.

use std::ffi::CString;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use super::sys;
use crate::platform::unix::TreeBackend;
use crate::platform::unix_sys;

/// The prefix of every cgroup this crate creates, followed by the creator's pid and a unique
/// suffix, so a leftover from a crashed `hx` can be recognised and removed.
const CGROUP_PREFIX: &str = "hx-sandbox-";

/// A cgroup v2 directory of one run. Every process of the run is a member, wherever it moved
/// in the session or process-group tree. Dropping it ends the members and removes the
/// directory.
#[derive(Debug)]
pub(super) struct CgroupTree {
    dir: PathBuf,
}

impl CgroupTree {
    /// Makes a fresh cgroup under `base`. Fails when the kernel offers no `cgroup.kill`.
    pub(super) fn create(base: &Path) -> io::Result<Arc<Self>> {
        let name = format!(
            "{CGROUP_PREFIX}{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7().simple()
        );
        let dir = base.join(name);
        std::fs::create_dir(&dir)?;
        let tree = Self { dir };
        // `Drop` removes the directory if one of the files is missing.
        for file in ["cgroup.kill", "cgroup.procs"] {
            if !tree.dir.join(file).exists() {
                return Err(io::Error::other(format!(
                    "{} has no {file} (cgroup.kill needs Linux 5.14)",
                    tree.dir.display()
                )));
            }
        }
        Ok(Arc::new(tree))
    }

    /// The directory of the cgroup.
    pub(super) fn dir(&self) -> &Path {
        &self.dir
    }

    /// The file a process writes `0` to, to move itself in. NUL-terminated for the child.
    pub(super) fn procs_file(&self) -> io::Result<CString> {
        CString::new(self.dir.join("cgroup.procs").as_os_str().as_bytes())
            .map_err(|_| io::Error::other("cgroup path contains NUL"))
    }

    fn kill_members(&self) {
        // Best effort: a cgroup that is already gone has nothing left to kill.
        let _ = std::fs::write(self.dir.join("cgroup.kill"), "1");
    }
}

impl TreeBackend for CgroupTree {
    fn kill(&self, pgid: libc::pid_t) {
        self.kill_members();
        // The group too, in case the leader has not been moved in yet (a spawn that failed
        // part-way); a group id that no longer exists answers ESRCH.
        unix_sys::killpg(pgid, libc::SIGKILL);
    }
}

impl Drop for CgroupTree {
    fn drop(&mut self) {
        self.kill_members();
        if std::fs::remove_dir(&self.dir).is_ok() {
            return;
        }
        // Killed processes leave the cgroup a moment later; an rmdir while one is still
        // dying says EBUSY. Retry off this thread, which may be an executor worker.
        let dir = self.dir.clone();
        let _ = std::thread::Builder::new()
            .name("hx-cgroup-cleanup".to_owned())
            .spawn(move || {
                for _ in 0..300 {
                    std::thread::sleep(Duration::from_millis(10));
                    if std::fs::remove_dir(&dir).is_ok() || !dir.exists() {
                        return;
                    }
                }
            });
    }
}

/// The kill backend of a subreaper supervisor: ask it to end everything. The supervisor is the
/// leader, so `pgid` is its pid. If it is gone (something killed it from inside), only the
/// group kill is left.
#[derive(Debug)]
pub(super) struct Supervisor;

impl TreeBackend for Supervisor {
    fn kill(&self, pgid: libc::pid_t) {
        // A stopped supervisor would never see the request: wake it first.
        unix_sys::kill_pid(pgid, libc::SIGCONT);
        if !unix_sys::kill_pid(pgid, sys::SUPERVISOR_KILL_SIGNAL) {
            unix_sys::killpg(pgid, libc::SIGKILL);
        }
    }
}

/// Whether a child subreaper supervisor works here, checked by a forked probe.
pub(super) fn probe_subreaper() -> Result<(), String> {
    if sys::fork_probe(sys::child_probe_subreaper) {
        Ok(())
    } else {
        Err("a forked probe could not make an orphaned grandchild come back as a child it \
             can list (PR_SET_CHILD_SUBREAPER, or /proc/<pid>/task/<tid>/children, is not available)"
            .to_owned())
    }
}

/// Finds a cgroup v2 directory in which this user can create a subtree and move into it, and
/// proves it with a forked child that moves itself in and is killed through `cgroup.kill`.
///
/// Candidates are the process's own cgroup and then each ancestor up to the mount: a systemd
/// user manager delegates its own subtree to the user, and a session's app scope lives below it.
/// The error says why the first candidate failed, for the capability report.
pub(super) fn probe_cgroup() -> Result<PathBuf, String> {
    let mount = cgroup2_mount().ok_or("no cgroup v2 hierarchy is mounted")?;
    let own = own_cgroup().ok_or("the process's cgroup v2 path is unknown")?;
    let mut dir = mount.join(own.trim_start_matches('/'));
    let mut first_failure: Option<String> = None;
    loop {
        match try_base(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) => {
                first_failure.get_or_insert_with(|| format!("{}: {e}", dir.display()));
            }
        }
        if dir == mount || !dir.pop() || !dir.starts_with(&mount) {
            break;
        }
    }
    Err(format!(
        "no cgroup under {} lets this user create a subtree and move into it ({}); a systemd \
         user manager's delegated cgroup would",
        mount.display(),
        first_failure.unwrap_or_default()
    ))
}

/// Tries `base`: make a cgroup, move a forked child in, kill it through `cgroup.kill`.
fn try_base(base: &Path) -> io::Result<()> {
    sweep_stale(base);
    let tree = CgroupTree::create(base)?;
    let procs = tree.procs_file()?;
    let pid = sys::fork_cgroup_member(&procs)?;
    let listed = || {
        std::fs::read_to_string(tree.dir.join("cgroup.procs"))
            .is_ok_and(|s| s.split_whitespace().any(|p| p == pid.to_string()))
    };
    let mut moved = false;
    for _ in 0..200 {
        if listed() {
            moved = true;
            break;
        }
        if sys::try_wait_status(pid).is_some() {
            // The child ended by itself: its move was refused.
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "a process could not move into the new cgroup",
            ));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    tree.kill_members();
    let status = sys::wait_status(pid);
    if !moved {
        return Err(io::Error::other(
            "the probe never appeared in the new cgroup",
        ));
    }
    match status {
        Some(s) if libc::WIFSIGNALED(s) && libc::WTERMSIG(s) == libc::SIGKILL => Ok(()),
        other => Err(io::Error::other(format!(
            "cgroup.kill did not end the member (wait status {other:?})"
        ))),
    }
}

/// Removes cgroups a crashed `hx` left behind: ours by name, whose creator no longer exists.
fn sweep_stale(base: &Path) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(rest) = name.to_str().and_then(|n| n.strip_prefix(CGROUP_PREFIX)) else {
            continue;
        };
        let Some(pid) = rest.split('-').next().and_then(|p| p.parse::<u32>().ok()) else {
            continue;
        };
        if !Path::new(&format!("/proc/{pid}")).exists() {
            let _ = std::fs::write(entry.path().join("cgroup.kill"), "1");
            let _ = std::fs::remove_dir(entry.path());
        }
    }
}

/// The mount point of the cgroup v2 hierarchy, from `/proc/self/mountinfo`.
fn cgroup2_mount() -> Option<PathBuf> {
    let info = std::fs::read_to_string("/proc/self/mountinfo").ok()?;
    info.lines().find_map(|line| {
        let (before, after) = line.split_once(" - ")?;
        (after.split_whitespace().next()? == "cgroup2")
            .then(|| before.split_whitespace().nth(4).map(unescape_mountinfo))
            .flatten()
    })
}

/// mountinfo writes space, tab, newline and backslash as three-digit octal escapes.
fn unescape_mountinfo(field: &str) -> PathBuf {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let octal = (bytes[i] == b'\\')
            .then(|| bytes.get(i + 1..i + 4))
            .flatten()
            .and_then(|d| std::str::from_utf8(d).ok())
            .and_then(|d| u8::from_str_radix(d, 8).ok());
        if let Some(byte) = octal {
            out.push(byte);
            i += 4;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    PathBuf::from(std::ffi::OsString::from(
        String::from_utf8_lossy(&out).into_owned(),
    ))
}

/// This process's path in the unified hierarchy: the `0::` line of `/proc/self/cgroup`.
fn own_cgroup() -> Option<String> {
    let text = std::fs::read_to_string("/proc/self/cgroup").ok()?;
    let path = text.lines().find_map(|l| l.strip_prefix("0::"))?;
    Some(path.trim_end_matches(" (deleted)").to_owned())
}

#[cfg(test)]
mod tests;
