//! The audit's findings against `hx-txn`: file modes (L1), races between the check and the write
//! (L2), Windows path aliases (M5) and what restore and recovery will trust (M6).
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::path::Path;

use common::{create, delete, engine, fixture, never, put, replace, snapshot};
use hx_proto::txn::{FailureKind, RecoverParams};
use hx_txn::journal::{Journal, Saved, Spec};
use hx_txn::{Error, Faults};

fn aborted(err: Error) -> Vec<hx_proto::txn::EditFailure> {
    match err {
        Error::AbortedBeforeWrite { failures } => failures,
        other => panic!("expected aborted_before_write, got {other:?}"),
    }
}

fn recover(fx: &common::Fixture, root: Option<&Path>) -> hx_proto::txn::RecoverResult {
    engine()
        .recover(
            &RecoverParams {
                journal_dir: fx.journals.to_string_lossy().into_owned(),
                root: root.map(|r| r.to_string_lossy().into_owned()),
            },
            &never(),
        )
        .unwrap()
}

// ---------------------------------------------------------------- M5: Windows aliases

#[test]
fn a_path_that_windows_would_alias_is_refused_for_every_edit_kind() {
    let fx = fixture();
    put(&fx.root, ".git/hooks/pre-commit", "#!/bin/sh\n", 0o755);
    put(&fx.root, "src/a.txt", "one\n", 0o644);
    let before = snapshot(&fx.root);
    for path in [
        "GIT~1/hooks/pre-commit",
        ".git./hooks/pre-commit",
        "src/a.txt.",
        "src/a.txt ",
        "src/NUL.txt",
        "docs/com1",
        "docs/Lpt9.md",
    ] {
        for edit in [create(path, "x"), replace(path, "a", "b"), delete(path)] {
            let failures = aborted(
                engine()
                    .apply(&fx.apply_params(vec![edit]), &never())
                    .unwrap_err(),
            );
            assert_eq!(failures[0].kind, FailureKind::PathUnsafe, "{path}");
        }
    }
    assert_eq!(snapshot(&fx.root), before);
    assert!(fx.journal_entries().is_empty());
}

#[cfg(unix)]
#[test]
fn a_symlink_that_leads_through_an_alias_is_refused_for_writes() {
    let fx = fixture();
    put(&fx.root, ".git/hooks/pre-commit", "old\n", 0o755);
    std::os::unix::fs::symlink("GIT~1", fx.root.join("hooks")).unwrap();
    let failures = aborted(
        engine()
            .apply(&fx.apply_params(vec![create("hooks/x", "x")]), &never())
            .unwrap_err(),
    );
    assert_eq!(failures[0].kind, FailureKind::PathUnsafe);
}

// ---------------------------------------------------------------- L1: modes

#[cfg(unix)]
mod modes {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn mode(p: &Path) -> u32 {
        fs::metadata(p).unwrap().permissions().mode() & 0o7777
    }

    #[test]
    fn setuid_setgid_and_sticky_never_reach_an_edited_file() {
        let fx = fixture();
        for (name, original, expected) in [
            ("suid", 0o4755, 0o755),
            ("sgid", 0o2755, 0o755),
            ("sticky", 0o1777, 0o777),
            ("all", 0o7700, 0o700),
            ("private", 0o600, 0o600),
            ("plain", 0o644, 0o644),
        ] {
            put(&fx.root, name, "old\n", original);
            engine()
                .apply(
                    &fx.apply_params(vec![replace(name, "old", "new")]),
                    &never(),
                )
                .unwrap();
            assert_eq!(fs::read_to_string(fx.root.join(name)).unwrap(), "new\n");
            assert_eq!(mode(&fx.root.join(name)), expected, "{name}");
        }
    }

    #[test]
    fn restore_does_not_bring_back_a_setuid_bit_either() {
        let fx = fixture();
        put(&fx.root, "tool", "old\n", 0o4755);
        let applied = engine()
            .apply(
                &fx.apply_params(vec![replace("tool", "old", "new")]),
                &never(),
            )
            .unwrap();
        engine()
            .restore(&fx.journal_ref(&applied.journal_id), &never())
            .unwrap();
        assert_eq!(fs::read_to_string(fx.root.join("tool")).unwrap(), "old\n");
        assert_eq!(mode(&fx.root.join("tool")), 0o755);
    }

    #[test]
    fn a_new_file_follows_the_umask_as_before() {
        let fx = fixture();
        engine()
            .apply(&fx.apply_params(vec![create("new.txt", "x")]), &never())
            .unwrap();
        assert_eq!(mode(&fx.root.join("new.txt")) & 0o7000, 0);
    }
}

// ---------------------------------------------------------------- L2: races

#[cfg(unix)]
mod races {
    use super::*;
    use std::os::unix::fs::symlink;

    /// The tick of the first workspace write: the journal's four, nothing created before it.
    const FIRST_WRITE: usize = 4;

    #[test]
    fn a_directory_swapped_for_a_symlink_mid_apply_is_not_written_through() {
        let fx = fixture();
        put(&fx.root, "src/a.txt", "one\n", 0o644);
        put(&fx.root, ".git/hooks/pre-commit", "#!/bin/sh\n", 0o755);
        let before = snapshot(&fx.root);
        let mut params = fx.apply_params(vec![replace("src/a.txt", "one", "two")]);
        params.protected = Some(vec!["**/.git/**".into()]);

        let root = fx.root.clone();
        let faults = Faults::none().interfere_at(FIRST_WRITE, move || {
            // After every check passed: `src` becomes a link to a protected directory.
            fs::rename(root.join("src"), root.join("src.real")).unwrap();
            symlink(".git/hooks", root.join("src")).unwrap();
        });
        let err = engine().apply_with(&params, &never(), &faults).unwrap_err();
        // The swap happened (`src` is a link now), the write refused to go through it, and the
        // rollback refused to restore through it too: the journal is kept for the owner.
        assert!(
            fs::symlink_metadata(fx.root.join("src"))
                .unwrap()
                .is_symlink()
        );
        assert!(matches!(err, Error::RestoreFailed { .. }), "{err:?}");
        // Nothing went through the link: the protected directory is untouched.
        let hooks: Vec<_> = fs::read_dir(fx.root.join(".git/hooks"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(hooks, ["pre-commit"], "{hooks:?}");
        assert_eq!(
            fs::read_to_string(fx.root.join(".git/hooks/pre-commit")).unwrap(),
            "#!/bin/sh\n"
        );
        assert_eq!(
            fs::read_to_string(fx.root.join("src.real/a.txt")).unwrap(),
            "one\n"
        );

        // Once the tree is healed, recovery finishes the job and the tree is as it was.
        fs::remove_file(fx.root.join("src")).unwrap();
        fs::rename(fx.root.join("src.real"), fx.root.join("src")).unwrap();
        assert_eq!(recover(&fx, Some(&fx.root)).restored.len(), 1);
        assert_eq!(snapshot(&fx.root), before);
    }

    #[test]
    fn a_file_swapped_for_a_symlink_after_planning_is_a_conflict_and_the_target_is_untouched() {
        let fx = fixture();
        put(&fx.root, "a.txt", "one\n", 0o644);
        put(&fx.root, "target.txt", "target\n", 0o644);
        let root = fx.root.clone();
        // The file itself becomes a link before the writes; the last check sees it.
        let faults = Faults::none().interfere_at(2, move || {
            fs::remove_file(root.join("a.txt")).unwrap();
            symlink("target.txt", root.join("a.txt")).unwrap();
        });
        let err = engine()
            .apply_with(
                &fx.apply_params(vec![replace("a.txt", "one", "two")]),
                &never(),
                &faults,
            )
            .unwrap_err();
        assert!(matches!(err, Error::Conflict { .. }), "{err:?}");
        assert_eq!(
            fs::read_to_string(fx.root.join("target.txt")).unwrap(),
            "target\n"
        );
    }

    #[test]
    fn a_fifo_in_place_of_a_file_is_refused_without_hanging() {
        use rustix::fs::{CWD, FileType, Mode, mknodat};
        let fx = fixture();
        mknodat(
            CWD,
            fx.root.join("pipe"),
            FileType::Fifo,
            Mode::RUSR | Mode::WUSR,
            0,
        )
        .unwrap();
        for edit in [replace("pipe", "a", "b"), create("pipe", "x")] {
            let failures = aborted(
                engine()
                    .apply(&fx.apply_params(vec![edit]), &never())
                    .unwrap_err(),
            );
            assert!(
                matches!(
                    failures[0].kind,
                    FailureKind::NotRegular | FailureKind::AlreadyExists
                ),
                "{:?}",
                failures[0].kind
            );
        }
    }
}

// ---------------------------------------------------------------- M6: restore and recovery

#[test]
fn restore_without_a_root_or_with_another_one_is_refused() {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\n", 0o644);
    let other = fx.outside.clone();
    put(&other, "a.txt", "mine\n", 0o644);
    let applied = engine()
        .apply(
            &fx.apply_params(vec![replace("a.txt", "one", "two")]),
            &never(),
        )
        .unwrap();

    let mut no_root = fx.journal_ref(&applied.journal_id);
    no_root.root = None;
    assert!(matches!(
        engine().restore(&no_root, &never()),
        Err(Error::InvalidRoot { .. })
    ));
    let mut wrong = fx.journal_ref(&applied.journal_id);
    wrong.root = Some(other.to_string_lossy().into_owned());
    assert!(matches!(
        engine().restore(&wrong, &never()),
        Err(Error::JournalCorrupt { .. })
    ));
    assert_eq!(fs::read_to_string(fx.root.join("a.txt")).unwrap(), "two\n");
    assert_eq!(fs::read_to_string(other.join("a.txt")).unwrap(), "mine\n");

    // The right root still works, and the journal survived the refusals.
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(fs::read_to_string(fx.root.join("a.txt")).unwrap(), "one\n");
}

#[test]
fn recovery_with_an_expected_root_leaves_another_workspaces_journal_alone() {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\n", 0o644);
    let crashed = engine().apply_with(
        &fx.apply_params(vec![replace("a.txt", "one", "two")]),
        &never(),
        &Faults::crash_at(5),
    );
    assert!(crashed.is_err());
    let id = fx.journal_entries().pop().unwrap();

    let elsewhere = recover(&fx, Some(&fx.outside));
    assert!(elsewhere.restored.is_empty());
    assert_eq!(elsewhere.failed.len(), 1);
    assert_eq!(elsewhere.failed[0].journal_id, id);
    assert_eq!(fs::read_to_string(fx.root.join("a.txt")).unwrap(), "two\n");

    let here = recover(&fx, Some(&fx.root));
    assert_eq!(here.restored, [id]);
    assert_eq!(fs::read_to_string(fx.root.join("a.txt")).unwrap(), "one\n");
}

/// Applies an edit and crashes after the last write, before `applied` is recorded: the journal is
/// `applying`, so recovery would roll it back.
fn crashed_journal(fx: &common::Fixture) -> String {
    put(&fx.root, "a.txt", "one\n", 0o644);
    let _ = engine().apply_with(
        &fx.apply_params(vec![replace("a.txt", "one", "two")]),
        &never(),
        &Faults::crash_at(5),
    );
    fx.journal_entries().pop().unwrap()
}

fn assert_refused_and_untouched(fx: &common::Fixture, id: &str, victim: &Path, expected: &str) {
    let r = recover(fx, None);
    assert!(r.restored.is_empty(), "{r:?}");
    assert_eq!(r.failed.len(), 1, "{r:?}");
    assert_eq!(r.failed[0].journal_id, id);
    assert_eq!(r.failed[0].code, "hx.txn.journal_corrupt");
    assert!(fx.journals.join(id).is_dir(), "a refused journal is kept");
    assert_eq!(fs::read_to_string(victim).unwrap(), expected);
}

#[test]
fn a_journal_with_an_edited_manifest_is_never_replayed() {
    let fx = fixture();
    let id = crashed_journal(&fx);
    // The attacker points the journal at another root and path, keeping its own bytes valid.
    put(&fx.outside, "victim.txt", "precious\n", 0o644);
    let manifest = fx.journals.join(&id).join("manifest.json");
    let text = fs::read_to_string(&manifest)
        .unwrap()
        .replace(fx.root.to_str().unwrap(), fx.outside.to_str().unwrap())
        .replace("a.txt", "victim.txt");
    fs::write(&manifest, text).unwrap();
    assert_refused_and_untouched(&fx, &id, &fx.outside.join("victim.txt"), "precious\n");
}

#[test]
fn a_planted_journal_without_a_tag_or_with_a_foreign_one_is_never_replayed() {
    // A journal written by another profile's hx (another key) and dropped into this one.
    let fx = fixture();
    let foreign = fixture();
    let id = crashed_journal(&foreign);
    put(&fx.root, "a.txt", "mine\n", 0o644);
    // This profile has a key (it ran a transaction of its own), the foreign one has another.
    engine()
        .apply(&fx.apply_params(vec![create("note.txt", "x")]), &never())
        .unwrap();
    fs::create_dir_all(&fx.journals).unwrap();
    let planted = fx.journals.join(&id);
    copy_dir(&foreign.journals.join(&id), &planted);
    // Its manifest names the *foreign* root; make it name ours, to be the worst case it can be.
    let manifest = planted.join("manifest.json");
    let text = fs::read_to_string(&manifest)
        .unwrap()
        .replace(foreign.root.to_str().unwrap(), fx.root.to_str().unwrap());
    fs::write(&manifest, text).unwrap();
    assert_refused_and_untouched_in(&fx, &id, &fx.root.join("a.txt"), "mine\n");

    // And the same journal with its tag removed.
    fs::remove_file(planted.join("manifest.mac")).unwrap();
    assert_refused_and_untouched_in(&fx, &id, &fx.root.join("a.txt"), "mine\n");
}

fn assert_refused_and_untouched_in(fx: &common::Fixture, id: &str, victim: &Path, expected: &str) {
    let r = recover(fx, None);
    assert!(r.restored.is_empty(), "{r:?}");
    assert!(
        r.failed
            .iter()
            .any(|f| f.journal_id == id && f.code == "hx.txn.journal_corrupt")
    );
    assert!(fx.journals.join(id).is_dir());
    assert_eq!(fs::read_to_string(victim).unwrap(), expected);
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap().flatten() {
        fs::copy(e.path(), to.join(e.file_name())).unwrap();
    }
}

#[test]
fn a_profile_with_no_key_trusts_no_journal() {
    let fx = fixture();
    let id = crashed_journal(&fx);
    fs::remove_file(fx.journals.parent().unwrap().join(".hx-journal-key")).unwrap();
    assert_refused_and_untouched(&fx, &id, &fx.root.join("a.txt"), "two\n");
}

#[cfg(unix)]
#[test]
fn the_key_is_private_and_sits_beside_the_journal_directory() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture();
    crashed_journal(&fx);
    let key = fx.journals.parent().unwrap().join(".hx-journal-key");
    assert_eq!(
        fs::metadata(&key).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::metadata(&key).unwrap().len(), 32);
}

#[cfg(unix)]
#[test]
fn restore_refuses_a_parent_that_became_a_symlink_and_finishes_once_it_is_healed() {
    let fx = fixture();
    put(&fx.root, "src/a.txt", "one\n", 0o644);
    put(&fx.root, "other/keep.txt", "keep\n", 0o644);
    let applied = engine()
        .apply(
            &fx.apply_params(vec![replace("src/a.txt", "one", "two")]),
            &never(),
        )
        .unwrap();
    // `src` is swapped for a link to a directory inside the root.
    fs::rename(fx.root.join("src"), fx.root.join("src.real")).unwrap();
    std::os::unix::fs::symlink("other", fx.root.join("src")).unwrap();

    let err = engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap_err();
    assert!(matches!(err, Error::JournalCorrupt { .. }), "{err:?}");
    assert!(!fx.root.join("other/a.txt").exists());
    assert_eq!(
        fs::read_to_string(fx.root.join("other/keep.txt")).unwrap(),
        "keep\n"
    );
    assert!(fx.journals.join(&applied.journal_id).is_dir());

    // Heal the tree and the same journal restores.
    fs::remove_file(fx.root.join("src")).unwrap();
    fs::rename(fx.root.join("src.real"), fx.root.join("src")).unwrap();
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(
        fs::read_to_string(fx.root.join("src/a.txt")).unwrap(),
        "one\n"
    );
}

#[test]
fn restore_rechecks_protected_paths_the_transaction_ran_under() {
    // Built directly through the journal API: a manifest that names a protected path (what a
    // genuine apply can never produce), restored with the journal's own protected list.
    let fx = fixture();
    put(
        &fx.root,
        ".git/hooks/pre-commit",
        "#!/bin/sh\necho mine\n",
        0o755,
    );
    let saved = vec![(
        ".git/hooks/pre-commit".to_owned(),
        Saved::File {
            bytes: b"#!/bin/sh\necho theirs\n",
            meta: hx_txn::fsops::Meta {
                mode: Some(0o755),
                mtime_ns: Some(1),
                len: 22,
            },
        },
    )];
    let root = fs::canonicalize(&fx.root).unwrap();
    let spec = Spec {
        root: root.to_str().unwrap(),
        entries: &saved,
        created_dirs: vec![],
        protected: vec!["**/.git/**".into()],
    };
    let journal = Journal::create(&fx.journals, &spec, &Faults::none()).unwrap();
    let dir = cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap();
    let err = hx_txn::restore::restore(&journal, &dir, &Faults::none()).unwrap_err();
    assert!(matches!(err, Error::JournalCorrupt { .. }), "{err:?}");
    assert_eq!(
        fs::read_to_string(fx.root.join(".git/hooks/pre-commit")).unwrap(),
        "#!/bin/sh\necho mine\n"
    );
}
