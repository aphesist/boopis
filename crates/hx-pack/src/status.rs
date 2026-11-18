//! `pack.status`: git status, the current branch and HEAD.
//!
//! This runs the `git` CLI (`status --porcelain=v2 --branch -z`) rather than
//! linking `gix`. Reasons: `git` is already a hard requirement of the product
//! (ship's checkpoint refs are written with it), its status is the reference
//! other tools compare against, and `gix`'s status support would add a large
//! dependency tree and compile time for a call that takes a few milliseconds.
//! The child gets an allowlisted environment, a timeout and an output cap, and
//! `core.fsmonitor` is forced off so a repository's own config cannot run a
//! program through this call.

use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::paths::Root;
use crate::proc;
use crate::types::{Truncation, note};

const OUTPUT_CAP: usize = 8 * 1024 * 1024;

fn d_entries() -> usize {
    500
}
fn d_timeout() -> u64 {
    10_000
}

/// The parameters of `pack.status` apart from the root.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StatusParams {
    /// List at most this many entries (default 500). Counts are always complete.
    #[serde(default = "d_entries")]
    pub max_entries: usize,
    /// Give up after this many milliseconds (default 10000).
    #[serde(default = "d_timeout")]
    pub timeout_ms: u64,
}

impl Default for StatusParams {
    fn default() -> Self {
        Self {
            max_entries: d_entries(),
            timeout_ms: d_timeout(),
        }
    }
}

/// The request of `pack.status`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StatusRequest {
    /// The root directory (the repository or a directory inside it).
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: StatusParams,
}

/// The kind of a status entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    /// Modified, added, deleted or type-changed.
    Changed,
    /// Renamed or copied; `orig_path` says from where.
    Renamed,
    /// An unresolved merge conflict.
    Conflicted,
    /// Not tracked.
    Untracked,
}

/// One changed path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StatusEntry {
    /// Path relative to the root.
    pub path: String,
    /// What kind of entry this is.
    pub kind: EntryKind,
    /// Index (staged) state letter: `M A D R C T U`, or `.` for none, `?` for untracked.
    pub index: String,
    /// Working-tree state letter, same alphabet.
    pub worktree: String,
    /// The old path of a rename or copy.
    pub orig_path: Option<String>,
}

/// Counts over all entries, not only the listed ones.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StatusCounts {
    /// Entries with a staged change.
    pub staged: usize,
    /// Entries with an unstaged change.
    pub unstaged: usize,
    /// Untracked paths.
    pub untracked: usize,
    /// Conflicted paths.
    pub conflicted: usize,
}

/// The response of `pack.status`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StatusResponse {
    /// False when the root is not inside a git repository; every other field is then empty.
    pub is_repo: bool,
    /// The branch name; `None` when detached or unborn without a name.
    pub branch: Option<String>,
    /// The full commit hash of HEAD; `None` on a repository with no commits.
    pub head: Option<String>,
    /// HEAD is detached.
    pub detached: bool,
    /// The upstream branch, if one is set.
    pub upstream: Option<String>,
    /// Commits ahead of the upstream, when known.
    pub ahead: Option<u32>,
    /// Commits behind the upstream, when known.
    pub behind: Option<u32>,
    /// Changed paths, in path order.
    pub entries: Vec<StatusEntry>,
    /// Counts over every entry.
    pub counts: StatusCounts,
    /// Why the listing is incomplete.
    pub truncated: Vec<Truncation>,
    /// Bytes of path text in the listing.
    pub bytes: usize,
}

const GIT_ENV: &[(&str, &str)] = &[
    ("LC_ALL", "C"),
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GIT_CONFIG_NOSYSTEM", "1"),
    ("GIT_PAGER", "cat"),
];

fn git(root: &Root, args: &[&str], timeout: Duration, cap: usize) -> Result<proc::Output> {
    let mut full = vec![
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=off",
        "--no-pager",
    ];
    full.extend_from_slice(args);
    let mut cmd = proc::command("git", &full, GIT_ENV);
    cmd.current_dir(root.path());
    proc::run(cmd, timeout, cap)
}

fn not_a_repo(stderr: &str) -> bool {
    stderr.contains("not a git repository")
}

/// Runs `pack.status` against an open root.
///
/// # Errors
/// [`Error::GitFailed`] when git is missing or fails; [`Error::Timeout`].
pub fn status(root: &Root, p: &StatusParams) -> Result<StatusResponse> {
    let timeout = Duration::from_millis(p.timeout_ms.max(1));
    // Paths in porcelain output are relative to the repository top; the root may be a subdirectory.
    let prefix = git(root, &["rev-parse", "--show-prefix"], timeout, 4096)?;
    if !prefix.success {
        return if not_a_repo(&prefix.stderr) {
            Ok(StatusResponse::default())
        } else {
            Err(Error::GitFailed(prefix.stderr.trim().to_owned()))
        };
    }
    let prefix = String::from_utf8_lossy(&prefix.stdout).trim().to_owned();
    let out = git(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=normal",
            "--",
            ".",
        ],
        timeout,
        OUTPUT_CAP,
    )?;
    if !out.success {
        return Err(Error::GitFailed(out.stderr.trim().to_owned()));
    }
    let mut resp = parse(&out.stdout, &prefix, p.max_entries);
    if out.capped {
        note(&mut resp.truncated, Truncation::MaxBytes);
    }
    Ok(resp)
}

/// Parses `status --porcelain=v2 --branch -z` output.
pub(crate) fn parse(raw: &[u8], prefix: &str, max_entries: usize) -> StatusResponse {
    let text = String::from_utf8_lossy(raw);
    let mut resp = StatusResponse {
        is_repo: true,
        ..StatusResponse::default()
    };
    let mut records = text.split('\0');
    while let Some(rec) = records.next() {
        if rec.is_empty() {
            continue;
        }
        if let Some(h) = rec.strip_prefix("# ") {
            header(&mut resp, h);
            continue;
        }
        let entry = match rec.as_bytes().first() {
            Some(b'1') => ordinary(rec, prefix),
            Some(b'2') => renamed(rec, records.next().unwrap_or(""), prefix),
            Some(b'u') => unmerged(rec, prefix),
            Some(b'?') => rec.strip_prefix("? ").map(|p| StatusEntry {
                path: rel(p, prefix),
                kind: EntryKind::Untracked,
                index: "?".into(),
                worktree: "?".into(),
                orig_path: None,
            }),
            _ => None,
        };
        let Some(e) = entry else { continue };
        match e.kind {
            EntryKind::Untracked => resp.counts.untracked += 1,
            EntryKind::Conflicted => resp.counts.conflicted += 1,
            _ => {
                resp.counts.staged += usize::from(e.index != ".");
                resp.counts.unstaged += usize::from(e.worktree != ".");
            }
        }
        if resp.entries.len() < max_entries {
            resp.bytes += e.path.len() + e.orig_path.as_ref().map_or(0, String::len) + 16;
            resp.entries.push(e);
        } else {
            note(&mut resp.truncated, Truncation::MaxItems);
        }
    }
    resp
}

fn rel(path: &str, prefix: &str) -> String {
    path.strip_prefix(prefix).unwrap_or(path).to_owned()
}

fn header(resp: &mut StatusResponse, h: &str) {
    if let Some(oid) = h.strip_prefix("branch.oid ") {
        resp.head = (oid != "(initial)").then(|| oid.to_owned());
    } else if let Some(head) = h.strip_prefix("branch.head ") {
        resp.detached = head == "(detached)";
        resp.branch = (!resp.detached).then(|| head.to_owned());
    } else if let Some(up) = h.strip_prefix("branch.upstream ") {
        resp.upstream = Some(up.to_owned());
    } else if let Some(ab) = h.strip_prefix("branch.ab ") {
        let mut it = ab.split(' ');
        resp.ahead = it
            .next()
            .and_then(|a| a.strip_prefix('+'))
            .and_then(|a| a.parse().ok());
        resp.behind = it
            .next()
            .and_then(|b| b.strip_prefix('-'))
            .and_then(|b| b.parse().ok());
    }
}

fn xy(field: &str) -> (String, String) {
    let mut c = field.chars();
    let a = c.next().unwrap_or('.');
    let b = c.next().unwrap_or('.');
    (a.to_string(), b.to_string())
}

fn ordinary(rec: &str, prefix: &str) -> Option<StatusEntry> {
    let f: Vec<&str> = rec.splitn(9, ' ').collect();
    let (index, worktree) = xy(f.get(1)?);
    Some(StatusEntry {
        path: rel(f.get(8)?, prefix),
        kind: EntryKind::Changed,
        index,
        worktree,
        orig_path: None,
    })
}

fn renamed(rec: &str, orig: &str, prefix: &str) -> Option<StatusEntry> {
    let f: Vec<&str> = rec.splitn(10, ' ').collect();
    let (index, worktree) = xy(f.get(1)?);
    Some(StatusEntry {
        path: rel(f.get(9)?, prefix),
        kind: EntryKind::Renamed,
        index,
        worktree,
        orig_path: Some(rel(orig, prefix)),
    })
}

fn unmerged(rec: &str, prefix: &str) -> Option<StatusEntry> {
    let f: Vec<&str> = rec.splitn(11, ' ').collect();
    let (index, worktree) = xy(f.get(1)?);
    Some(StatusEntry {
        path: rel(f.get(10)?, prefix),
        kind: EntryKind::Conflicted,
        index,
        worktree,
        orig_path: None,
    })
}

/// `pack.status`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`status`].
pub fn handle_status(req: &StatusRequest) -> Result<StatusResponse> {
    status(&Root::open(&req.root)?, &req.params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_record_kind() {
        let raw =
            b"# branch.oid 0123456789abcdef0123456789abcdef01234567\0# branch.head feature/x\0\
# branch.upstream origin/feature/x\0# branch.ab +3 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/a file.rs\0\
2 R. N... 100644 100644 100644 aaa bbb R100 new name.rs\0old name.rs\0\
u UU N... 100644 100644 100644 100644 a b c conflict.rs\0\
? untracked.txt\0";
        let r = parse(raw, "", 10);
        assert_eq!(r.branch.as_deref(), Some("feature/x"));
        assert_eq!((r.ahead, r.behind), (Some(3), Some(1)));
        assert_eq!(r.upstream.as_deref(), Some("origin/feature/x"));
        let paths: Vec<_> = r.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "src/a file.rs",
                "new name.rs",
                "conflict.rs",
                "untracked.txt"
            ]
        );
        assert_eq!(r.entries[1].orig_path.as_deref(), Some("old name.rs"));
        assert_eq!(r.entries[1].index, "R");
        assert_eq!(
            (
                r.counts.staged,
                r.counts.unstaged,
                r.counts.conflicted,
                r.counts.untracked
            ),
            (1, 1, 1, 1)
        );
    }

    #[test]
    fn prefix_is_stripped_and_detached_and_initial_are_understood() {
        let raw = b"# branch.oid (initial)\0# branch.head (detached)\0? sub/x.txt\0? other/y.txt\0";
        let r = parse(raw, "sub/", 10);
        assert!(r.detached && r.branch.is_none() && r.head.is_none());
        assert_eq!(r.entries[0].path, "x.txt");
        assert_eq!(r.entries[1].path, "other/y.txt");
    }

    #[test]
    fn garbage_records_are_skipped() {
        let r = parse(b"\0zzz\0? ok.txt\0", "", 10);
        assert_eq!(r.entries.len(), 1);
    }
}
