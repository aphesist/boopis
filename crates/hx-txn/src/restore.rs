//! Putting a journal's contents back into the workspace. Idempotent: running it twice, or
//! finishing a restore that crashed halfway, gives the same result.

use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};

use cap_std::fs::Dir;

use crate::error::{Error, Result};
use crate::faults::Faults;
use crate::fsops;
use crate::journal::{Entry, Journal, Prior, State};
use crate::paths::{self, RelPath};
use crate::scope::{Scope, Verdict};

/// What a restore did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Report {
    /// Paths whose bytes and metadata were put back.
    pub restored: Vec<String>,
    /// Paths the transaction created, now removed.
    pub removed: Vec<String>,
}

/// The temp-file name `txn.apply` uses for entry `idx` of a journal.
#[must_use]
pub fn apply_tmp_name(id: &str, idx: usize) -> String {
    format!(".hx-tmp-{id}-{idx}")
}

fn restore_tmp_name(id: &str, idx: usize) -> String {
    format!(".hx-tmp-{id}-r{idx}")
}

/// Restores every touched path from the journal, then removes directories the transaction
/// created (if empty). The journal itself is left for the caller to remove.
///
/// The saved bytes are all read and verified **before** the first workspace change, so a
/// corrupt journal changes nothing. So is every path: each entry is parsed and resolved again
/// against the workspace as it is now, and refused if a parent has become a symlink, if the path
/// is a Windows alias, or if it matches the protected globs the transaction ran under. The
/// journal's authenticity (its tag) and its root were checked by the caller, before this.
///
/// # Errors
/// - [`Error::JournalCorrupt`] before any change;
/// - [`Error::RestoreFailed`] if a write fails midway. The journal stays in `restoring`, and
///   running the restore again finishes it.
pub fn restore(journal: &Journal, root: &Dir, faults: &Faults) -> Result<Report> {
    let id = journal.id().to_owned();
    let entries = &journal.manifest().entries;

    // Verify first.
    check_paths(journal, root)?;
    let mut saved: Vec<Option<Vec<u8>>> = Vec::with_capacity(entries.len());
    for e in entries {
        saved.push(if e.prior == Prior::File {
            Some(journal.read_saved(e)?)
        } else {
            None
        });
    }

    journal.set_state(State::Restoring)?;
    let fail = |e: Error| match e {
        Error::RestoreFailed { .. } => e,
        other => Error::RestoreFailed {
            id: id.clone(),
            cause: other.to_string(),
        },
    };

    let mut report = Report::default();
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for (idx, (entry, bytes)) in entries.iter().zip(&saved).enumerate() {
        faults.restore_tick().map_err(fail)?;
        restore_entry(
            root,
            &id,
            idx,
            entry,
            bytes.as_deref(),
            &mut report,
            &mut dirs,
        )
        .map_err(|e| fail(Error::io(format!("restoring `{}`", entry.path), e)))?;
    }

    for dir in journal.manifest().created_dirs.iter().rev() {
        faults.restore_tick().map_err(fail)?;
        match fsops::remove_dir(root, Path::new(dir)) {
            Ok(()) => {}
            // Gone already, or holding something that is not ours: leave it.
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(e) => return Err(fail(Error::io(format!("removing directory `{dir}`"), e))),
        }
        if let Some(parent) = Path::new(dir).parent() {
            dirs.insert(parent.to_owned());
        }
    }
    dirs.retain(|d| d.as_os_str().is_empty() || fsops::lstat(root, d).is_ok_and(|m| m.is_dir()));
    fsops::sync_dirs(root, &dirs).map_err(|e| fail(Error::io("syncing directories", e)))?;
    Ok(report)
}

/// Re-resolves every path the journal names and re-checks it, before anything is written.
///
/// The manifest recorded canonical paths, so a path that resolves to anything else has a symlink
/// in it now: a swapped parent, or a plant. The entry itself may be a symlink (a deleted link
/// is restored as one), so the last component is not followed.
fn check_paths(journal: &Journal, root: &Dir) -> Result<()> {
    let manifest = journal.manifest();
    let corrupt = |path: &str, why: String| Error::JournalCorrupt {
        id: journal.id().to_owned(),
        reason: format!("`{path}` {why}"),
    };
    let scope = Scope::new(None, Some(&manifest.protected))?;
    let paths = manifest
        .entries
        .iter()
        .map(|e| &e.path)
        .chain(&manifest.created_dirs);
    for path in paths {
        let rel = RelPath::parse_for_write(path).map_err(|e| corrupt(path, e.to_string()))?;
        let resolved =
            paths::resolve(root, &rel, false).map_err(|e| corrupt(path, e.to_string()))?;
        if rel.to_wire() != *path || resolved.to_wire() != *path {
            return Err(corrupt(
                path,
                format!(
                    "now resolves to `{}`: a parent is a symlink",
                    resolved.to_wire()
                ),
            ));
        }
        if scope.verdict(path, path) != Verdict::Ok {
            return Err(corrupt(path, "is protected".to_owned()));
        }
    }
    Ok(())
}

fn restore_entry(
    root: &Dir,
    id: &str,
    idx: usize,
    entry: &Entry,
    bytes: Option<&[u8]>,
    report: &mut Report,
    dirs: &mut BTreeSet<PathBuf>,
) -> io::Result<()> {
    let path = Path::new(&entry.path);
    let parent = path.parent().unwrap_or_else(|| Path::new("")).to_owned();
    // Leftovers of a crashed apply or restore.
    for tmp in [apply_tmp_name(id, idx), restore_tmp_name(id, idx)] {
        fsops::remove_if_exists(root, &parent.join(tmp))?;
    }
    match entry.prior {
        Prior::Absent => {
            if fsops::remove_if_exists(root, path)? {
                report.removed.push(entry.path.clone());
                dirs.insert(parent);
            }
        }
        Prior::File => {
            if !parent.as_os_str().is_empty() {
                fsops::create_dir_all(root, &parent)?;
            }
            let data = bytes.ok_or_else(|| io::Error::other("journal bytes missing"))?;
            fsops::write_atomic(
                root,
                path,
                &restore_tmp_name(id, idx),
                data,
                entry.mode,
                entry.mtime_ns,
            )?;
            report.restored.push(entry.path.clone());
            dirs.insert(parent);
        }
        Prior::Symlink => {
            let target = entry
                .symlink_target
                .as_deref()
                .ok_or_else(|| io::Error::other("journal symlink target missing"))?;
            if !parent.as_os_str().is_empty() {
                fsops::create_dir_all(root, &parent)?;
            }
            fsops::remove_if_exists(root, path)?;
            fsops::make_symlink(root, Path::new(target), path)?;
            report.restored.push(entry.path.clone());
            dirs.insert(parent);
        }
    }
    Ok(())
}
