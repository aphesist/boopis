//! Failures and crashes at every step of a transaction: the tree is never left half-applied, and
//! recovery after a crash gives the tree back exactly.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;

use common::{Fixture, Snapshot, create, delete, engine, fixture, never, put, replace, snapshot};
use hx_proto::txn::{ApplyParams, RecoverParams};
use hx_txn::journal::Journal;
use hx_txn::{Error, Faults};

fn setup() -> (Fixture, Snapshot, ApplyParams) {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\ntwo\n", 0o644);
    put(&fx.root, "bin/run.sh", "#!/bin/sh\necho hi\n", 0o755);
    put(&fx.root, "ro/locked.txt", "locked\n", 0o444);
    put(&fx.root, "gone.txt", "bye\n", 0o640);
    #[cfg(unix)]
    std::os::unix::fs::symlink("a.txt", fx.root.join("link")).unwrap();
    let before = snapshot(&fx.root);
    let mut edits = vec![
        replace("a.txt", "two", "TWO"),
        replace("bin/run.sh", "hi", "bye"),
        replace("ro/locked.txt", "locked", "LOCKED"),
        delete("gone.txt"),
        create("new/deep/er/file.txt", "fresh\n"),
        create("top.txt", "top\n"),
    ];
    if cfg!(unix) {
        edits.push(delete("link"));
    }
    let params = fx.apply_params(edits);
    (fx, before, params)
}

fn recover(fx: &Fixture) -> hx_proto::txn::RecoverResult {
    engine()
        .recover(
            &RecoverParams {
                journal_dir: fx.journals.to_string_lossy().into_owned(),
            },
            &never(),
        )
        .unwrap()
}

#[test]
fn a_failure_at_any_step_leaves_the_tree_identical() {
    let mut failed_steps = 0;
    for k in 0..200 {
        let (fx, before, params) = setup();
        match engine().apply_with(&params, &never(), &Faults::fail_at(k)) {
            Ok(_) => {
                assert!(
                    failed_steps > 10,
                    "the loop exercised too few steps ({failed_steps})"
                );
                return;
            }
            Err(e) => {
                assert!(
                    matches!(e, Error::ApplyFailed { .. } | Error::Io { .. }),
                    "step {k}: {e:?}"
                );
                assert_eq!(
                    snapshot(&fx.root),
                    before,
                    "step {k}: the tree must be exactly as before"
                );
                assert!(
                    fx.journal_entries().is_empty(),
                    "step {k}: no journal is left behind"
                );
                failed_steps += 1;
            }
        }
    }
    panic!("apply never succeeded; the step counter is broken");
}

#[test]
fn a_crash_at_any_step_is_recoverable() {
    let mut classes = std::collections::BTreeSet::new();
    for k in 0..200 {
        let (fx, before, params) = setup();
        match engine().apply_with(&params, &never(), &Faults::crash_at(k)) {
            Ok(_) => {
                assert!(k > 10, "the loop exercised too few steps ({k})");
                // Every durable state was seen: unfinished, prepared, applying, applied.
                assert!(
                    classes
                        .is_superset(&["discarded", "restored", "pending"].into_iter().collect()),
                    "{classes:?}"
                );
                return;
            }
            Err(Error::InjectedCrash) => {}
            Err(e) => panic!("step {k}: {e:?}"),
        }
        let r = recover(&fx);
        assert!(r.failed.is_empty() && r.busy.is_empty(), "step {k}: {r:?}");
        if !r.discarded.is_empty() {
            classes.insert("discarded");
        }
        if !r.restored.is_empty() {
            classes.insert("restored");
        }
        // A crash right after the last write leaves a complete transaction waiting for a verdict.
        for id in &r.pending {
            classes.insert("pending");
            engine().restore(&fx.journal_ref(id), &never()).unwrap();
        }
        assert_eq!(
            snapshot(&fx.root),
            before,
            "step {k}: recovery must give the tree back exactly"
        );
        assert!(
            fx.journal_entries().is_empty(),
            "step {k}: no journal is left"
        );
    }
    panic!("apply never succeeded");
}

#[test]
fn a_failed_restore_keeps_the_journal_and_recover_finishes_it() {
    let mut kept = 0;
    for k in 0..200 {
        let (fx, before, params) = setup();
        let faults = Faults::fail_at(k).fail_restore_at(1);
        match engine().apply_with(&params, &never(), &faults) {
            Ok(_) => {
                assert!(kept > 3);
                return;
            }
            Err(Error::RestoreFailed { id, .. }) => {
                kept += 1;
                assert!(
                    fx.journals.join(&id).exists(),
                    "step {k}: the journal is kept"
                );
                let r = recover(&fx);
                assert_eq!(r.restored, vec![id], "step {k}");
            }
            Err(_) => {} // Failed while preparing: nothing to restore.
        }
        assert_eq!(snapshot(&fx.root), before, "step {k}");
        assert!(fx.journal_entries().is_empty(), "step {k}");
    }
    panic!("apply never succeeded");
}

#[test]
fn restore_can_fail_midway_and_be_retried() {
    for j in 0..50 {
        let (fx, before, params) = setup();
        let applied = engine().apply(&params, &never()).unwrap();
        let r = fx.journal_ref(&applied.journal_id);
        match engine().restore_with(&r, &never(), &Faults::none().fail_restore_at(j)) {
            Ok(_) => {
                assert!(j > 3);
                assert_eq!(snapshot(&fx.root), before);
                return;
            }
            Err(Error::RestoreFailed { .. }) => {
                // The journal is still there and a second attempt finishes the job.
                engine().restore(&r, &never()).unwrap();
                assert_eq!(snapshot(&fx.root), before, "restore step {j}");
                assert!(fx.journal_entries().is_empty());
            }
            Err(e) => panic!("{e:?}"),
        }
    }
    panic!("restore never succeeded");
}

#[test]
fn recover_leaves_completed_transactions_pending() {
    let (fx, before, params) = setup();
    let applied = engine().apply(&params, &never()).unwrap();
    let after = snapshot(&fx.root);
    let r = recover(&fx);
    assert_eq!(r.pending, vec![applied.journal_id.clone()]);
    assert!(r.restored.is_empty() && r.discarded.is_empty());
    assert_eq!(
        snapshot(&fx.root),
        after,
        "a completed transaction is not rolled back by recovery"
    );
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(snapshot(&fx.root), before);
}

#[test]
fn recover_skips_a_journal_a_live_transaction_holds() {
    let (fx, before, params) = setup();
    // Crash mid-apply, then pretend another process still owns the journal.
    let crash = Faults::crash_at(8);
    assert!(matches!(
        engine().apply_with(&params, &never(), &crash),
        Err(Error::InjectedCrash)
    ));
    let id = fx.journal_entries().pop().unwrap();
    let mut live = Journal::open(&fx.journals, &id).unwrap();
    live.lock().unwrap();

    let r = recover(&fx);
    assert_eq!(r.busy, vec![id.clone()]);
    assert_ne!(
        snapshot(&fx.root),
        before,
        "the live transaction's work is untouched"
    );

    drop(live);
    let r = recover(&fx);
    assert_eq!(r.restored, vec![id]);
    assert_eq!(snapshot(&fx.root), before);
}

#[test]
fn recover_deletes_half_written_and_half_deleted_journals() {
    let (fx, before, params) = setup();
    // Crash while the journal is being written (before the manifest exists).
    assert!(matches!(
        engine().apply_with(&params, &never(), &Faults::crash_at(1)),
        Err(Error::InjectedCrash)
    ));
    fs::create_dir_all(fx.journals.join(".trash-leftover/x")).unwrap();
    let r = recover(&fx);
    assert_eq!(r.discarded.len(), 1);
    assert!(fx.journal_entries().is_empty());
    assert_eq!(snapshot(&fx.root), before);
}

#[test]
fn a_corrupt_journal_is_reported_and_kept_and_changes_nothing() {
    let (fx, _, params) = setup();
    assert!(matches!(
        engine().apply_with(&params, &never(), &Faults::crash_at(8)),
        Err(Error::InjectedCrash)
    ));
    let id = fx.journal_entries().pop().unwrap();
    let during = snapshot(&fx.root);
    let data = fx.journals.join(&id).join("data.bin");
    let mut bytes = fs::read(&data).unwrap();
    bytes[0] ^= 0xff;
    fs::write(&data, bytes).unwrap();

    let r = recover(&fx);
    assert_eq!(r.failed.len(), 1);
    assert_eq!(r.failed[0].code, "hx.txn.journal_corrupt");
    assert_eq!(
        snapshot(&fx.root),
        during,
        "a corrupt journal is verified before anything is touched"
    );
    assert!(fx.journals.join(&id).exists(), "kept for inspection");
    assert!(matches!(
        engine().restore(&fx.journal_ref(&id), &never()),
        Err(Error::JournalCorrupt { .. })
    ));
}

#[test]
fn discard_refuses_an_unfinished_transaction() {
    let (fx, _, params) = setup();
    assert!(matches!(
        engine().apply_with(&params, &never(), &Faults::crash_at(8)),
        Err(Error::InjectedCrash)
    ));
    let id = fx.journal_entries().pop().unwrap();
    assert!(matches!(
        engine().discard(&fx.journal_ref(&id), &never()),
        Err(Error::InvalidState { .. })
    ));
}

#[test]
fn restoring_while_the_transaction_is_live_is_refused() {
    let (fx, _, params) = setup();
    assert!(matches!(
        engine().apply_with(&params, &never(), &Faults::crash_at(8)),
        Err(Error::InjectedCrash)
    ));
    let id = fx.journal_entries().pop().unwrap();
    let mut live = Journal::open(&fx.journals, &id).unwrap();
    live.lock().unwrap();
    assert!(matches!(
        engine().restore(&fx.journal_ref(&id), &never()),
        Err(Error::JournalBusy(_))
    ));
}
