//! Property tests for the invariants in `docs/STANDARDS.md` section 10:
//! apply then restore is the identity; no edit touches anything outside the root; a failure or
//! a crash at any step leaves the tree identical to before.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;

use common::{Fixture, Snapshot, engine, fixture, never, put, snapshot};
use hx_proto::txn::{ApplyParams, Edit, RecoverParams};
use hx_txn::{Error, Faults};
use proptest::prelude::*;

const DIRS: [&str; 4] = ["", "a/", "a/b/", "c/"];
const NAMES: [&str; 4] = ["f1", "f2.txt", "f3.rs", "f4"];
const WORDS: [&str; 5] = ["alpha", "beta", "gamma", "delta", "omega"];
const MODES: [u32; 4] = [0o644, 0o755, 0o600, 0o444];

fn pool_path() -> impl Strategy<Value = String> {
    (0..DIRS.len(), 0..NAMES.len()).prop_map(|(d, n)| format!("{}{}", DIRS[d], NAMES[n]))
}

fn content() -> impl Strategy<Value = String> {
    // Distinct words, so that a search matches exactly once.
    (
        prop::sample::subsequence(WORDS.to_vec(), 0..=WORDS.len()),
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(|(ws, trailing, crlf)| {
            let eol = if crlf { "\r\n" } else { "\n" };
            let mut s = ws.join(eol);
            if trailing && !s.is_empty() {
                s.push_str(eol);
            }
            s
        })
}

fn tree() -> impl Strategy<Value = Vec<(String, String, u32)>> {
    prop::collection::btree_map(pool_path(), (content(), 0..MODES.len()), 0..8)
        .prop_map(|m| m.into_iter().map(|(p, (c, m))| (p, c, MODES[m])).collect())
}

/// Every way to leave the root: symlinks out, `..`, absolute paths. `/ABS` is swapped for a real
/// absolute path outside the root by `params`.
fn escape_path() -> impl Strategy<Value = String> {
    prop_oneof![
        (0..NAMES.len()).prop_map(|n| format!("esc/{}", NAMES[n])),
        Just("../outside/new.txt".to_owned()),
        Just("a/../../outside/new.txt".to_owned()),
        Just("/ABS/abs.txt".to_owned()),
        Just("a/../f1".to_owned()),
    ]
}

fn edit(files: &[(String, String, u32)]) -> impl Strategy<Value = Edit> + use<> {
    let existing: Vec<String> = files.iter().map(|(p, _, _)| p.clone()).collect();
    let any_path = if existing.is_empty() {
        pool_path().boxed()
    } else {
        prop_oneof![3 => prop::sample::select(existing), 1 => pool_path()].boxed()
    };
    // A search that really occurs in some file, so replaces mostly apply.
    let searchable: Vec<(String, String)> = files
        .iter()
        .flat_map(|(p, c, _)| {
            c.split_whitespace()
                .map(|w| (p.clone(), w.to_owned()))
                .collect::<Vec<_>>()
        })
        .collect();
    let word = (0..WORDS.len()).prop_map(|i| WORDS[i].to_owned());
    let found = if searchable.is_empty() {
        (pool_path(), word.clone()).boxed()
    } else {
        prop::sample::select(searchable).boxed()
    };
    let link_path = (0..NAMES.len()).prop_map(|n| format!("link/{}", NAMES[n]));
    prop_oneof![
        8 => (found.clone(), word.clone()).prop_map(|((path, old), new)| Edit::Replace { path, old, new, replace_all: false }),
        2 => (any_path.clone(), word.clone(), word.clone())
            .prop_map(|(path, old, new)| Edit::Replace { path, old, new, replace_all: true }),
        4 => (any_path.clone(), content(), prop::bool::weighted(0.85))
            .prop_map(|(path, content, overwrite)| Edit::Create { path, content, overwrite }),
        2 => any_path.clone().prop_map(|path| Edit::Delete { path }),
        2 => (found, word.clone()).prop_map(|((path, old), new)| Edit::Diff {
            path: Some(path),
            diff: format!("@@ -1 +1 @@\n-{old}\n+{new}\n"),
        }),
        2 => (link_path, content(), prop::bool::weighted(0.85))
            .prop_map(|(path, content, overwrite)| Edit::Create { path, content, overwrite }),
        1 => (escape_path(), content()).prop_map(|(path, content)| Edit::Create { path, content, overwrite: true }),
        1 => escape_path().prop_map(|path| Edit::Delete { path }),
    ]
}

fn scenario() -> impl Strategy<Value = (Vec<(String, String, u32)>, Vec<Edit>, usize)> {
    tree().prop_flat_map(|files| {
        (
            Just(files.clone()),
            prop::collection::vec(edit(&files), 1..5),
            0usize..40,
        )
    })
}

struct World {
    fx: Fixture,
    outside_before: Snapshot,
    root_before: Snapshot,
}

fn world(files: &[(String, String, u32)]) -> World {
    let fx = fixture();
    for (p, c, m) in files {
        put(&fx.root, p, c, *m);
    }
    fs::create_dir_all(fx.root.join("a")).unwrap();
    fs::write(fx.outside.join("sentinel.txt"), "do not touch\n").unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("a", fx.root.join("link")).unwrap();
        std::os::unix::fs::symlink(&fx.outside, fx.root.join("esc")).unwrap();
    }
    World {
        outside_before: snapshot(&fx.outside),
        root_before: snapshot(&fx.root),
        fx,
    }
}

fn params(w: &World, edits: &[Edit]) -> ApplyParams {
    // Replace the placeholder with a real absolute path outside the root.
    let abs = w.fx.outside.to_string_lossy().into_owned();
    let edits = edits
        .iter()
        .map(|e| match e.clone() {
            Edit::Replace {
                path,
                old,
                new,
                replace_all,
            } => Edit::Replace {
                path: path.replace("/ABS", &abs),
                old,
                new,
                replace_all,
            },
            Edit::Create {
                path,
                content,
                overwrite,
            } => Edit::Create {
                path: path.replace("/ABS", &abs),
                content,
                overwrite,
            },
            Edit::Delete { path } => Edit::Delete {
                path: path.replace("/ABS", &abs),
            },
            Edit::Diff { path, diff } => Edit::Diff {
                path: path.map(|p| p.replace("/ABS", &abs)),
                diff,
            },
        })
        .collect();
    w.fx.apply_params(edits)
}

fn config() -> ProptestConfig {
    ProptestConfig {
        cases: 96,
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

proptest! {
    #![proptest_config(config())]

    /// Apply then restore is the identity on bytes, modes, mtimes and the tree; and a failed
    /// apply changes nothing. Neither ever touches anything outside the root.
    #[test]
    fn apply_then_restore_is_the_identity((files, edits, _) in scenario()) {
        let w = world(&files);
        let p = params(&w, &edits);
        match engine().apply(&p, &never()) {
            Ok(applied) => {
                prop_assert_eq!(snapshot(&w.fx.outside), w.outside_before.clone(), "outside the root changed");
                engine().restore(&w.fx.journal_ref(&applied.journal_id), &never()).unwrap();
                prop_assert_eq!(snapshot(&w.fx.root), w.root_before.clone());
            }
            Err(e) => {
                prop_assert!(!matches!(e, Error::ApplyFailed { .. } | Error::RestoreFailed { .. } | Error::Io { .. }), "{e:?}");
                prop_assert_eq!(snapshot(&w.fx.root), w.root_before.clone(), "a rejected transaction wrote something");
            }
        }
        prop_assert_eq!(snapshot(&w.fx.outside), w.outside_before.clone(), "outside the root changed");
        prop_assert!(w.fx.journal_entries().is_empty());
    }

    /// A failure injected at the k-th step leaves the tree identical to before.
    #[test]
    fn a_failure_at_the_kth_step_leaves_the_tree_identical((files, edits, k) in scenario()) {
        let w = world(&files);
        let p = params(&w, &edits);
        let result = engine().apply_with(&p, &never(), &Faults::fail_at(k));
        if result.is_err() {
            prop_assert_eq!(snapshot(&w.fx.root), w.root_before.clone());
            prop_assert!(w.fx.journal_entries().is_empty());
        }
        prop_assert_eq!(snapshot(&w.fx.outside), w.outside_before.clone());
    }

    /// A crash at the k-th step is recoverable to the identical tree.
    #[test]
    fn a_crash_at_the_kth_step_recovers_to_the_identical_tree((files, edits, k) in scenario()) {
        let w = world(&files);
        let p = params(&w, &edits);
        let result = engine().apply_with(&p, &never(), &Faults::crash_at(k));
        if matches!(result, Err(Error::InjectedCrash)) {
            let r = engine()
                .recover(&RecoverParams { journal_dir: w.fx.journals.to_string_lossy().into_owned() }, &never())
                .unwrap();
            prop_assert!(r.failed.is_empty() && r.busy.is_empty());
            for id in &r.pending {
                engine().restore(&w.fx.journal_ref(id), &never()).unwrap();
            }
            prop_assert_eq!(snapshot(&w.fx.root), w.root_before.clone());
            prop_assert!(w.fx.journal_entries().is_empty());
        }
        prop_assert_eq!(snapshot(&w.fx.outside), w.outside_before.clone());
    }
}

/// The generators must reach the interesting cases, or the properties above prove little.
#[test]
fn the_generators_reach_successful_and_failing_transactions() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, TestRunner};
    let mut runner = TestRunner::new(Config {
        failure_persistence: None,
        ..Config::default()
    });
    let (mut ok_with_changes, mut aborted, mut security) = (0, 0, 0);
    for _ in 0..300 {
        let (files, edits, _) = scenario().new_tree(&mut runner).unwrap().current();
        let w = world(&files);
        match engine().apply(&params(&w, &edits), &never()) {
            Ok(r) if r.files.iter().any(|f| f.sha256_before != f.sha256_after) => {
                ok_with_changes += 1;
            }
            Ok(_) => {}
            Err(Error::AbortedBeforeWrite { failures }) => {
                aborted += 1;
                if failures
                    .iter()
                    .any(|f| f.kind == hx_proto::txn::FailureKind::PathUnsafe)
                {
                    security += 1;
                }
            }
            Err(e) => panic!("{e:?}"),
        }
    }
    eprintln!("ok_with_changes={ok_with_changes} aborted={aborted} path_unsafe={security}");
    assert!(
        ok_with_changes >= 40,
        "too few successful transactions: {ok_with_changes}"
    );
    assert!(aborted >= 20, "too few rejected transactions: {aborted}");
    assert!(security >= 8, "too few escape attempts: {security}");
}
