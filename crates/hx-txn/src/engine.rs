//! The transaction engine: `validate`, `apply`, `restore`, `discard`, `recover`.
//!
//! Every method is synchronous and blocking; the async handler runs them on the blocking pool.
//!
//! # Guarantees
//! - Nothing is written until every edit has been validated in memory.
//! - Scope and protected checks run before the journal exists.
//! - The journal is durable before the first workspace write.
//! - Any failure after the first write restores from the journal before the error is returned
//!   (`hx.txn.apply_failed`). If even the restore fails, the journal is kept in `restoring`
//!   and `recover` finishes it (`hx.txn.restore_failed`).
//! - A crash at any point is recoverable; see the state machine in [`crate::journal`].

use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Instant;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use hx_proto::txn::{
    ApplyParams, ApplyResult, DiscardResult, JournalRef, RecoverFailure, RecoverParams,
    RecoverResult, RestoreResult, ValidateParams, ValidateResult,
};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::error::{Error, Result};
use crate::faults::Faults;
use crate::fsops;
use crate::journal::{self, Journal, LockOutcome, Saved, State};
use crate::limits::Limits;
use crate::plan::{self, Original, Outcome, Plan, PlanInput};
use crate::restore::{self, apply_tmp_name};
use crate::scope::{self, Scope};

/// The transaction engine. Cheap to clone; holds only limits.
#[derive(Debug, Clone, Default)]
pub struct Engine {
    limits: Limits,
}

struct Workspace {
    dir: Dir,
    canonical: String,
}

fn open_workspace(root: &str) -> Result<Workspace> {
    let invalid = |e: io::Error| Error::InvalidRoot {
        root: root.to_owned(),
        source: e,
    };
    if root.is_empty() {
        return Err(invalid(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the root is empty",
        )));
    }
    let canonical = std::fs::canonicalize(root).map_err(invalid)?;
    let dir = Dir::open_ambient_dir(&canonical, ambient_authority()).map_err(invalid)?;
    Ok(Workspace {
        dir,
        canonical: canonical.to_string_lossy().into_owned(),
    })
}

/// Serialises transactions on one workspace, across threads and processes.
#[derive(Debug)]
struct WorkspaceLock(#[allow(dead_code)] File); // Held for its Drop: closing the file releases the lock.

fn lock_workspace(
    journal_dir: &Path,
    root: &str,
    limits: &Limits,
    cancel: &CancellationToken,
) -> Result<WorkspaceLock> {
    let name = format!(
        ".workspace-{}.lock",
        &hex::encode(Sha256::digest(root.as_bytes()))[..16]
    );
    let path = journal_dir.join(name);
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|e| Error::io("opening the workspace lock", e))?;
    let start = Instant::now();
    loop {
        if file.try_lock().is_ok() {
            return Ok(WorkspaceLock(file));
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if start.elapsed() > limits.lock_timeout {
            return Err(Error::WorkspaceBusy);
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<()> {
    if cancel.is_cancelled() {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}

#[cfg(feature = "dev-fixtures")]
fn is_crash(e: &Error) -> bool {
    matches!(e, Error::InjectedCrash)
}
#[cfg(not(feature = "dev-fixtures"))]
fn is_crash(_: &Error) -> bool {
    false
}

impl Engine {
    /// An engine with the default limits.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// An engine with explicit limits.
    #[must_use]
    pub fn with_limits(limits: Limits) -> Self {
        Self { limits }
    }

    fn plan(
        &self,
        ws: &Workspace,
        edits: &[hx_proto::txn::Edit],
        allowed: Option<&[String]>,
        protected: Option<&[String]>,
        cancel: &CancellationToken,
    ) -> Result<Plan> {
        let scope = Scope::new(allowed, protected)?;
        plan::build(&PlanInput {
            root: &ws.dir,
            edits,
            scope: &scope,
            limits: &self.limits,
            cancel,
        })
    }

    /// Checks every edit in memory and reports what `apply` would change. Writes nothing.
    ///
    /// # Errors
    /// See [`plan::build`].
    pub fn validate(
        &self,
        p: &ValidateParams,
        cancel: &CancellationToken,
    ) -> Result<ValidateResult> {
        let ws = open_workspace(&p.root)?;
        let plan = self.plan(
            &ws,
            &p.edits,
            p.allowed.as_deref(),
            p.protected.as_deref(),
            cancel,
        )?;
        Ok(ValidateResult {
            files: plan.changes(),
        })
    }

    /// Validates, journals and applies a transaction.
    ///
    /// # Errors
    /// Everything [`Engine::validate`] reports, plus `Conflict`, `WorkspaceBusy`, `ApplyFailed`
    /// (the workspace was restored) and `RestoreFailed` (the journal was kept).
    pub fn apply(&self, p: &ApplyParams, cancel: &CancellationToken) -> Result<ApplyResult> {
        self.apply_with(p, cancel, &Faults::none())
    }

    /// [`Engine::apply`] with a fault plan, for tests.
    ///
    /// # Errors
    /// As [`Engine::apply`], plus the injected failures.
    pub fn apply_with(
        &self,
        p: &ApplyParams,
        cancel: &CancellationToken,
        faults: &Faults,
    ) -> Result<ApplyResult> {
        let ws = open_workspace(&p.root)?;
        let journal_dir = PathBuf::from(&p.journal_dir);
        journal::ensure_journal_dir(&journal_dir)?;
        let _lock = lock_workspace(&journal_dir, &ws.canonical, &self.limits, cancel)?;
        let plan = self.plan(
            &ws,
            &p.edits,
            p.allowed.as_deref(),
            p.protected.as_deref(),
            cancel,
        )?;
        check_cancel(cancel)?;

        let saved: Vec<(String, Saved<'_>)> = plan
            .changed()
            .map(|f| (f.path.clone(), saved_of(&f.original)))
            .collect();
        let spec = journal::Spec {
            root: &ws.canonical,
            entries: &saved,
            created_dirs: plan.created_dirs.clone(),
            protected: match &p.protected {
                Some(list) => list.clone(),
                None => scope::default_protected()?,
            },
        };
        let journal = Journal::create(&journal_dir, &spec, faults)?;

        // Last cheap checks, still before the first write: the files must be as planned.
        let before_write = verify_unchanged(&ws.dir, &plan).and_then(|()| check_cancel(cancel));
        if let Err(e) = before_write {
            let _ = journal.remove();
            return Err(e);
        }

        // From `applying` on, any failure restores.
        let run = journal
            .set_state(State::Applying)
            .and_then(|()| execute(&ws.dir, &journal, &plan, faults))
            .and_then(|()| journal.set_state(State::Applied))
            .and_then(|()| faults.tick());
        if let Err(cause) = run {
            return Err(if is_crash(&cause) {
                cause
            } else {
                rollback(&ws.dir, journal, &cause, faults)
            });
        }
        tracing::debug!(
            journal = journal.id(),
            files = plan.files.len(),
            "transaction applied"
        );
        Ok(ApplyResult {
            journal_id: journal.id().to_owned(),
            files: plan.changes(),
        })
    }

    /// Restores bytes and metadata exactly, deletes files the transaction created, removes the journal.
    ///
    /// The caller names the workspace it expects (`r.root`); a journal that recorded another one
    /// is refused, so a journal moved or edited to point elsewhere never writes there.
    ///
    /// # Errors
    /// `InvalidRoot` (no root given), `JournalNotFound`, `JournalBusy`, `JournalCorrupt` (also
    /// for another workspace's journal, or one whose tag does not verify), `WorkspaceBusy`,
    /// `RestoreFailed`.
    pub fn restore(&self, r: &JournalRef, cancel: &CancellationToken) -> Result<RestoreResult> {
        self.restore_with(r, cancel, &Faults::none())
    }

    /// [`Engine::restore`] with a fault plan, for tests.
    ///
    /// # Errors
    /// As [`Engine::restore`], plus the injected failures.
    pub fn restore_with(
        &self,
        r: &JournalRef,
        cancel: &CancellationToken,
        faults: &Faults,
    ) -> Result<RestoreResult> {
        check_cancel(cancel)?;
        let Some(expected) = r.root.as_deref() else {
            return Err(Error::InvalidRoot {
                root: String::new(),
                source: io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "txn.restore needs the workspace root it expects",
                ),
            });
        };
        let journal_dir = PathBuf::from(&r.journal_dir);
        let mut journal = Journal::open(&journal_dir, &r.journal_id)?;
        journal.lock()?;
        let report = restore_locked(
            &journal_dir,
            &journal,
            Some(expected),
            &self.limits,
            cancel,
            faults,
        )?;
        journal.remove()?;
        Ok(RestoreResult {
            journal_id: r.journal_id.clone(),
            restored: report.restored,
            removed: report.removed,
        })
    }

    /// Keeps the transaction's changes and removes its journal.
    ///
    /// # Errors
    /// `JournalNotFound`, `JournalBusy`, `InvalidState` (the transaction is still running or a
    /// restore is unfinished).
    pub fn discard(&self, r: &JournalRef, cancel: &CancellationToken) -> Result<DiscardResult> {
        check_cancel(cancel)?;
        let journal_dir = PathBuf::from(&r.journal_dir);
        let mut journal = Journal::open(&journal_dir, &r.journal_id)?;
        journal.lock()?;
        match journal.state()? {
            State::Applied | State::Prepared | State::Restored => {}
            other => {
                return Err(Error::InvalidState {
                    id: r.journal_id.clone(),
                    state: other.as_str().to_owned(),
                });
            }
        }
        journal.remove()?;
        Ok(DiscardResult {
            journal_id: r.journal_id.clone(),
        })
    }

    /// Restores every interrupted transaction in a journal directory.
    ///
    /// Journals held by a live transaction are skipped, completed ones are reported as pending
    /// and left alone, and half-written ones are deleted. A journal whose tag does not verify
    /// under the profile's key (planted, edited, or from before tags) is never replayed: it is
    /// reported in `failed` and kept. With `p.root`, a journal of another workspace is too.
    ///
    /// # Errors
    /// Only if the directory cannot be listed. A journal that cannot be recovered is reported in
    /// `failed` and kept.
    pub fn recover(&self, p: &RecoverParams, cancel: &CancellationToken) -> Result<RecoverResult> {
        check_cancel(cancel)?;
        let journal_dir = PathBuf::from(&p.journal_dir);
        let mut result = RecoverResult::default();
        for listed in journal::list(&journal_dir)? {
            let id = listed.id;
            match self.recover_one(&journal_dir, &id, p.root.as_deref(), cancel) {
                Ok(Recovered::Restored) => result.restored.push(id),
                Ok(Recovered::Discarded) => result.discarded.push(id),
                Ok(Recovered::Pending) => result.pending.push(id),
                Ok(Recovered::Busy) => result.busy.push(id),
                Err(e) => {
                    tracing::warn!(journal = %id, code = e.code(), "journal could not be recovered");
                    result.failed.push(RecoverFailure {
                        journal_id: id,
                        code: e.code().to_owned(),
                        message: e.to_string(),
                    });
                }
            }
        }
        Ok(result)
    }

    fn recover_one(
        &self,
        journal_dir: &Path,
        id: &str,
        expected_root: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<Recovered> {
        let lock = match journal::try_lock_dir(journal_dir, id)? {
            LockOutcome::Busy => return Ok(Recovered::Busy),
            LockOutcome::NoLockFile => {
                journal::remove_unfinished(journal_dir, id)?;
                return Ok(Recovered::Discarded);
            }
            LockOutcome::Acquired(f) => f,
        };
        if !journal::has_manifest(journal_dir, id) {
            // The crash came while the journal was being written: the workspace was never touched.
            journal::remove_unfinished(journal_dir, id)?;
            return Ok(Recovered::Discarded);
        }
        let journal = Journal::open(journal_dir, id)?.with_lock(lock);
        match journal.state()? {
            State::Prepared | State::Restored => {
                journal.remove()?;
                Ok(Recovered::Discarded)
            }
            State::Applied => Ok(Recovered::Pending),
            State::Applying | State::Restoring => {
                restore_locked(
                    journal_dir,
                    &journal,
                    expected_root,
                    &self.limits,
                    cancel,
                    &Faults::none(),
                )?;
                journal.remove()?;
                Ok(Recovered::Restored)
            }
        }
    }
}

enum Recovered {
    Restored,
    Discarded,
    Pending,
    Busy,
}

/// Restores a locked journal under the workspace lock and marks it `restored`.
/// The caller removes the journal.
///
/// `expected_root`, when given, must be the workspace the journal recorded.
fn restore_locked(
    journal_dir: &Path,
    journal: &Journal,
    expected_root: Option<&str>,
    limits: &Limits,
    cancel: &CancellationToken,
    faults: &Faults,
) -> Result<restore::Report> {
    let state = journal.state()?;
    if matches!(state, State::Prepared | State::Restored) {
        return Ok(restore::Report::default());
    }
    let ws = open_workspace(&journal.manifest().root)?;
    if let Some(expected) = expected_root
        && open_workspace(expected)?.canonical != ws.canonical
    {
        return Err(Error::JournalCorrupt {
            id: journal.id().to_owned(),
            reason: "the journal belongs to another workspace than the one expected".to_owned(),
        });
    }
    let _lock = lock_workspace(journal_dir, &ws.canonical, limits, cancel)?;
    let report = restore::restore(journal, &ws.dir, faults)?;
    journal
        .set_state(State::Restored)
        .map_err(|e| Error::RestoreFailed {
            id: journal.id().to_owned(),
            cause: e.to_string(),
        })?;
    Ok(report)
}

/// Undoes a failed apply. Returns the error to hand back to the caller.
fn rollback(root: &Dir, journal: Journal, cause: &Error, faults: &Faults) -> Error {
    let id = journal.id().to_owned();
    tracing::warn!(journal = %id, %cause, "write failed; restoring from the journal");
    let restored = restore::restore(&journal, root, faults).and_then(|_| {
        journal
            .set_state(State::Restored)
            .map_err(|e| Error::RestoreFailed {
                id: id.clone(),
                cause: e.to_string(),
            })
    });
    match restored {
        Ok(()) => {
            if let Err(e) = journal.remove() {
                // Harmless: the journal is `restored`, so recovery only deletes it.
                tracing::warn!(journal = %id, error = %e, "could not delete a restored journal");
            }
            Error::ApplyFailed {
                cause: cause.to_string(),
            }
        }
        Err(e) => Error::RestoreFailed {
            id,
            cause: format!("{cause}; then restoring failed: {e}"),
        },
    }
}

fn saved_of(original: &Original) -> Saved<'_> {
    match original {
        Original::Absent => Saved::Absent,
        Original::File { bytes, meta } => Saved::File { bytes, meta: *meta },
        Original::Symlink { target } => Saved::Symlink {
            target: target.clone(),
        },
    }
}

/// Fails with `Conflict` if a file that will change is no longer what the plan read.
fn verify_unchanged(root: &Dir, plan: &Plan) -> Result<()> {
    for f in plan.changed() {
        let path = Path::new(&f.path);
        let conflict = || Error::Conflict {
            path: f.path.clone(),
        };
        let now = fsops::lstat(root, path);
        match (&f.original, now) {
            (Original::Absent, Err(e)) if e.kind() == io::ErrorKind::NotFound => {}
            (Original::File { meta, .. }, Ok(md))
                if md.is_file() && fsops::meta_of(&md) == *meta => {}
            (Original::Symlink { target }, Ok(md)) if md.file_type().is_symlink() => {
                let current =
                    fsops::read_link(root, path).map_err(|e| Error::io("checking a symlink", e))?;
                if current.to_string_lossy() != target.as_str() {
                    return Err(conflict());
                }
            }
            (_, Err(e)) if e.kind() != io::ErrorKind::NotFound => {
                return Err(Error::io(format!("checking `{}`", f.path), e));
            }
            _ => return Err(conflict()),
        }
    }
    Ok(())
}

/// Performs the workspace writes. Runs only after the journal is `applying`.
fn execute(root: &Dir, journal: &Journal, plan: &Plan, faults: &Faults) -> Result<()> {
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for d in &plan.created_dirs {
        faults.tick()?;
        match fsops::create_dir(root, Path::new(d)) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(Error::io(format!("creating directory `{d}`"), e)),
        }
        dirs.insert(
            Path::new(d)
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_owned(),
        );
    }
    for (idx, f) in plan.changed().enumerate() {
        faults.tick()?;
        let path = Path::new(&f.path);
        let ctx = |what: &str| format!("{what} `{}`", f.path);
        match &f.outcome {
            Outcome::Write(bytes) => {
                let mode = match &f.original {
                    Original::File { meta, .. } => meta.mode,
                    _ => None,
                };
                fsops::write_atomic(
                    root,
                    path,
                    &apply_tmp_name(journal.id(), idx),
                    bytes,
                    mode,
                    None,
                )
                .map_err(|e| Error::io(ctx("writing"), e))?;
            }
            Outcome::Delete => {
                fsops::remove_if_exists(root, path).map_err(|e| Error::io(ctx("deleting"), e))?;
            }
            Outcome::Unchanged => {}
        }
        dirs.insert(path.parent().unwrap_or_else(|| Path::new("")).to_owned());
    }
    faults.tick()?;
    fsops::sync_dirs(root, &dirs).map_err(|e| Error::io("syncing directories", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use hx_proto::txn::Edit;

    fn plan_for(root: &Dir, edits: &[Edit]) -> Plan {
        let scope = Scope::new(None, Some(&[])).unwrap();
        let cancel = CancellationToken::new();
        plan::build(&PlanInput {
            root,
            edits,
            scope: &scope,
            limits: &Limits::default(),
            cancel: &cancel,
        })
        .unwrap()
    }

    #[test]
    fn a_stale_plan_is_a_conflict() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("a.txt"), "one\n").unwrap();
        let root = Dir::open_ambient_dir(t.path(), ambient_authority()).unwrap();
        let plan = plan_for(
            &root,
            &[
                Edit::Replace {
                    path: "a.txt".into(),
                    old: "one".into(),
                    new: "two".into(),
                    replace_all: false,
                },
                Edit::Create {
                    path: "new.txt".into(),
                    content: "x".into(),
                    overwrite: false,
                },
            ],
        );
        verify_unchanged(&root, &plan).unwrap();

        // Someone else creates the file the plan wanted to create.
        std::fs::write(t.path().join("new.txt"), "theirs").unwrap();
        assert!(
            matches!(verify_unchanged(&root, &plan), Err(Error::Conflict { path }) if path == "new.txt")
        );
        std::fs::remove_file(t.path().join("new.txt")).unwrap();
        verify_unchanged(&root, &plan).unwrap();

        // Someone else edits the file the plan wanted to change.
        std::fs::write(t.path().join("a.txt"), "one and more\n").unwrap();
        assert!(
            matches!(verify_unchanged(&root, &plan), Err(Error::Conflict { path }) if path == "a.txt")
        );
        std::fs::remove_file(t.path().join("a.txt")).unwrap();
        assert!(matches!(
            verify_unchanged(&root, &plan),
            Err(Error::Conflict { .. })
        ));
    }
}
