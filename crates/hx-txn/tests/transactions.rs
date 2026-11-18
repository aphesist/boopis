//! End-to-end behaviour of the engine against real directories.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;

use common::{create, delete, engine, fixture, never, put, replace, snapshot};
use hx_proto::txn::{Edit, FailureKind};
use hx_txn::Error;
use sha2::{Digest, Sha256};

fn sha(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn failures(err: Error) -> Vec<hx_proto::txn::EditFailure> {
    match err {
        Error::AbortedBeforeWrite { failures } => failures,
        other => panic!("expected aborted_before_write, got {other:?}"),
    }
}

#[test]
fn apply_reports_hashes_and_what_changed() {
    let fx = fixture();
    put(&fx.root, "src/a.txt", "one\ntwo\n", 0o644);
    put(&fx.root, "src/gone.txt", "bye\n", 0o644);
    let result = engine()
        .apply(
            &fx.apply_params(vec![
                replace("src/a.txt", "two", "TWO"),
                create("src/new/deep.txt", "fresh\n"),
                delete("src/gone.txt"),
            ]),
            &never(),
        )
        .unwrap();

    assert_eq!(
        fs::read_to_string(fx.root.join("src/a.txt")).unwrap(),
        "one\nTWO\n"
    );
    assert_eq!(
        fs::read_to_string(fx.root.join("src/new/deep.txt")).unwrap(),
        "fresh\n"
    );
    assert!(!fx.root.join("src/gone.txt").exists());

    let by_path = |p: &str| result.files.iter().find(|f| f.path == p).unwrap();
    let a = by_path("src/a.txt");
    assert_eq!(a.sha256_before.as_deref(), Some(sha("one\ntwo\n").as_str()));
    assert_eq!(a.sha256_after.as_deref(), Some(sha("one\nTWO\n").as_str()));
    assert!(!a.created && !a.deleted);
    let n = by_path("src/new/deep.txt");
    assert_eq!((n.sha256_before.as_deref(), n.created), (None, true));
    assert_eq!(n.sha256_after.as_deref(), Some(sha("fresh\n").as_str()));
    let g = by_path("src/gone.txt");
    assert_eq!((g.sha256_after.as_deref(), g.deleted), (None, true));
    assert!(g.sha256_before.is_some());
    assert!(hx_txn::journal::is_valid_id(&result.journal_id));
}

#[test]
fn restore_is_the_identity_on_bytes_modes_and_mtimes() {
    let fx = fixture();
    put(&fx.root, "bin/run.sh", "#!/bin/sh\necho hi\n", 0o755);
    put(&fx.root, "keep/ro.txt", "read only\n", 0o444);
    put(&fx.root, "src/gone.txt", "bye\n", 0o640);
    let before = snapshot(&fx.root);

    let applied = engine()
        .apply(
            &fx.apply_params(vec![
                replace("bin/run.sh", "hi", "bye"),
                replace("keep/ro.txt", "only", "ONLY"),
                delete("src/gone.txt"),
                create("brand/new/file.txt", "x"),
            ]),
            &never(),
        )
        .unwrap();
    assert_ne!(snapshot(&fx.root), before);
    // The mode survives the atomic write.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &str| fs::metadata(fx.root.join(p)).unwrap().permissions().mode() & 0o7777;
        assert_eq!(mode("bin/run.sh"), 0o755);
        assert_eq!(mode("keep/ro.txt"), 0o444);
    }

    let restored = engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(
        snapshot(&fx.root),
        before,
        "bytes, modes, mtimes and the directory tree are exact"
    );
    assert_eq!(restored.removed, vec!["brand/new/file.txt"]);
    assert_eq!(restored.restored.len(), 3);
    assert!(fx.journal_entries().is_empty(), "the journal is removed");
    assert!(matches!(
        engine().restore(&fx.journal_ref(&applied.journal_id), &never()),
        Err(Error::JournalNotFound(_))
    ));
}

#[test]
fn discard_keeps_the_changes_and_removes_the_journal() {
    let fx = fixture();
    put(&fx.root, "a.txt", "old\n", 0o644);
    let applied = engine()
        .apply(
            &fx.apply_params(vec![replace("a.txt", "old", "new")]),
            &never(),
        )
        .unwrap();
    engine()
        .discard(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(fs::read_to_string(fx.root.join("a.txt")).unwrap(), "new\n");
    assert!(fx.journal_entries().is_empty());
}

#[cfg(unix)]
#[test]
fn journals_are_private_and_hold_the_exact_original_bytes() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture();
    put(&fx.root, "secret.txt", "s3cret\n", 0o600);
    let applied = engine()
        .apply(
            &fx.apply_params(vec![replace("secret.txt", "s3cret", "x")]),
            &never(),
        )
        .unwrap();
    let mode = |p: &std::path::Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
    let jdir = fx.journals.join(&applied.journal_id);
    assert_eq!(mode(&fx.journals), 0o700);
    assert_eq!(mode(&jdir), 0o700);
    for f in ["data.bin", "manifest.json", "state", "lock"] {
        assert_eq!(mode(&jdir.join(f)), 0o600, "{f}");
    }
    assert_eq!(fs::read(jdir.join("data.bin")).unwrap(), b"s3cret\n");
    assert_eq!(
        fs::read_to_string(jdir.join("state")).unwrap(),
        "prepared\napplying\napplied\n"
    );
}

#[test]
fn a_miss_aborts_everything_and_lists_each_failure_with_the_closest_match() {
    let fx = fixture();
    put(
        &fx.root,
        "a.rs",
        "fn alpha() {\n    let x = 1;\n    let y = 2;\n}\n",
        0o644,
    );
    put(&fx.root, "b.rs", "fn beta() {}\n", 0o644);
    let before = snapshot(&fx.root);

    let err = engine()
        .apply(
            &fx.apply_params(vec![
                replace("b.rs", "beta", "gamma"), // valid
                replace(
                    "a.rs",
                    "fn alpha() {\n    let x = 1;\n    let y = 999;\n}",
                    "x",
                ),
                replace("missing.rs", "a", "b"),
                create("b.rs", "already there"),
            ]),
            &never(),
        )
        .unwrap_err();
    let f = failures(err);
    assert_eq!(
        f.iter().map(|f| (f.edit_index, f.kind)).collect::<Vec<_>>(),
        vec![
            (1, FailureKind::NoMatch),
            (2, FailureKind::NotFound),
            (3, FailureKind::AlreadyExists),
        ]
    );
    let closest = f[0].closest.as_ref().unwrap();
    assert_eq!(
        (
            closest.start_line,
            closest.end_line,
            closest.first_diff_line
        ),
        (1, 4, Some(3))
    );
    assert!(closest.snippet.contains("let y = 2;"));
    assert_eq!(
        snapshot(&fx.root),
        before,
        "the valid edit was not applied either"
    );
    assert!(fx.journal_entries().is_empty(), "no journal was created");
}

#[test]
fn whitespace_only_misses_are_reported_never_applied() {
    let fx = fixture();
    put(&fx.root, "app.py", "if x:\n    run()\n", 0o644);
    let before = snapshot(&fx.root);
    let err = engine()
        .apply(
            &fx.apply_params(vec![replace("app.py", "if x:\n  run()", "if x:\n  stop()")]),
            &never(),
        )
        .unwrap_err();
    let f = failures(err);
    assert!(f[0].closest.as_ref().unwrap().whitespace_only);
    assert_eq!(snapshot(&fx.root), before);
}

#[test]
fn later_edits_see_earlier_ones() {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\n", 0o644);
    engine()
        .apply(
            &fx.apply_params(vec![
                replace("a.txt", "one", "two"),
                replace("a.txt", "two", "three"),
                create("b.txt", "x"),
            ]),
            &never(),
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(fx.root.join("a.txt")).unwrap(),
        "three\n"
    );
}

#[test]
fn diff_edits_apply_with_headers_and_with_an_explicit_path() {
    let fx = fixture();
    put(&fx.root, "a.txt", "a\nb\nc\n", 0o644);
    put(&fx.root, "b.txt", "x\ny\n", 0o644);
    let multi = "--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n--- /dev/null\n+++ b/made.txt\n@@ -0,0 +1 @@\n+hello\n";
    engine()
        .apply(
            &fx.apply_params(vec![
                Edit::Diff {
                    path: None,
                    diff: multi.into(),
                },
                Edit::Diff {
                    path: Some("b.txt".into()),
                    diff: "@@ -1,2 +1,2 @@\n x\n-y\n+Y\n".into(),
                },
            ]),
            &never(),
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(fx.root.join("a.txt")).unwrap(),
        "a\nB\nc\n"
    );
    assert_eq!(
        fs::read_to_string(fx.root.join("made.txt")).unwrap(),
        "hello\n"
    );
    assert_eq!(fs::read_to_string(fx.root.join("b.txt")).unwrap(), "x\nY\n");
}

#[test]
fn a_diff_that_does_not_match_fails_with_the_hunk_and_closest_region() {
    let fx = fixture();
    put(&fx.root, "a.txt", "a\nb\nc\n", 0o644);
    let err = engine()
        .validate(
            &hx_proto::txn::ValidateParams {
                root: fx.root.to_string_lossy().into_owned(),
                edits: vec![Edit::Diff {
                    path: Some("a.txt".into()),
                    diff: "@@ -1,3 +1,3 @@\n a\n-X\n+B\n c\n".into(),
                }],
                allowed: None,
                protected: Some(vec![]),
            },
            &never(),
        )
        .unwrap_err();
    let f = failures(err);
    assert_eq!(f[0].hunk, Some(0));
    assert_eq!(f[0].closest.as_ref().unwrap().first_diff_line, Some(2));
}

#[test]
fn validate_writes_nothing_and_matches_what_apply_reports() {
    let fx = fixture();
    put(&fx.root, "a.txt", "old\n", 0o644);
    let edits = vec![replace("a.txt", "old", "new"), create("sub/b.txt", "b")];
    let before = snapshot(&fx.root);
    let validated = engine()
        .validate(
            &hx_proto::txn::ValidateParams {
                root: fx.root.to_string_lossy().into_owned(),
                edits: edits.clone(),
                allowed: None,
                protected: Some(vec![]),
            },
            &never(),
        )
        .unwrap();
    assert_eq!(snapshot(&fx.root), before);
    assert!(!fx.journals.exists());
    let applied = engine().apply(&fx.apply_params(edits), &never()).unwrap();
    assert_eq!(validated.files, applied.files);
}

#[test]
fn an_unchanged_result_is_listed_but_not_written() {
    let fx = fixture();
    put(&fx.root, "a.txt", "same\n", 0o644);
    let before = snapshot(&fx.root);
    let r = engine()
        .apply(
            &fx.apply_params(vec![replace("a.txt", "same", "same")]),
            &never(),
        )
        .unwrap();
    assert_eq!(r.files[0].sha256_before, r.files[0].sha256_after);
    assert_eq!(snapshot(&fx.root), before, "not even the mtime moved");
}

// ---- path safety -------------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn the_audits_symlink_escape_is_refused() {
    let fx = fixture();
    std::os::unix::fs::symlink(&fx.outside, fx.root.join("link")).unwrap();
    let outside_before = snapshot(&fx.outside);
    let root_before = snapshot(&fx.root);

    let err = engine()
        .apply(
            &fx.apply_params(vec![create("link/pwned.txt", "owned")]),
            &never(),
        )
        .unwrap_err();
    let f = failures(err);
    assert_eq!(f[0].kind, FailureKind::PathUnsafe);
    assert_eq!(
        snapshot(&fx.outside),
        outside_before,
        "nothing was written outside the root"
    );
    assert!(!fx.outside.join("pwned.txt").exists());
    assert_eq!(snapshot(&fx.root), root_before);
}

#[cfg(unix)]
#[test]
fn symlinked_files_pointing_outside_cannot_be_edited_or_deleted_through() {
    let fx = fixture();
    fs::write(fx.outside.join("victim.txt"), "keep me\n").unwrap();
    std::os::unix::fs::symlink(fx.outside.join("victim.txt"), fx.root.join("abs-link")).unwrap();
    std::os::unix::fs::symlink("../outside/victim.txt", fx.root.join("rel-link")).unwrap();
    for p in ["abs-link", "rel-link"] {
        let err = engine()
            .apply(&fx.apply_params(vec![replace(p, "keep", "lose")]), &never())
            .unwrap_err();
        assert_eq!(failures(err)[0].kind, FailureKind::PathUnsafe, "{p}");
    }
    assert_eq!(
        fs::read_to_string(fx.outside.join("victim.txt")).unwrap(),
        "keep me\n"
    );
}

#[test]
fn absolute_and_parent_paths_are_refused() {
    let fx = fixture();
    let target = fx.outside.join("x.txt");
    let abs = target.to_string_lossy().into_owned();
    for p in [
        abs.as_str(),
        "../outside/x.txt",
        "a/../../outside/x.txt",
        "a/../b",
        "",
    ] {
        let err = engine()
            .apply(&fx.apply_params(vec![create(p, "x")]), &never())
            .unwrap_err();
        assert_eq!(failures(err)[0].kind, FailureKind::PathUnsafe, "{p:?}");
    }
    assert!(!target.exists());
}

#[cfg(unix)]
#[test]
fn symlinks_inside_the_root_are_followed_to_one_canonical_file() {
    let fx = fixture();
    put(&fx.root, "real/x.txt", "v1\n", 0o644);
    std::os::unix::fs::symlink("real", fx.root.join("alias")).unwrap();
    std::os::unix::fs::symlink("real/x.txt", fx.root.join("file-link")).unwrap();
    let r = engine()
        .apply(
            &fx.apply_params(vec![
                replace("alias/x.txt", "v1", "v2"),
                replace("file-link", "v2", "v3"),
            ]),
            &never(),
        )
        .unwrap();
    assert_eq!(r.files.len(), 1, "both spellings are one file");
    assert_eq!(r.files[0].path, "real/x.txt");
    assert_eq!(
        fs::read_to_string(fx.root.join("real/x.txt")).unwrap(),
        "v3\n"
    );
    assert!(
        fs::symlink_metadata(fx.root.join("file-link"))
            .unwrap()
            .file_type()
            .is_symlink(),
        "the link is still a link"
    );
    assert!(
        fs::symlink_metadata(fx.root.join("alias"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[cfg(unix)]
#[test]
fn deleting_a_symlink_removes_the_link_not_the_target_and_restore_recreates_it() {
    let fx = fixture();
    put(&fx.root, "real.txt", "data\n", 0o644);
    std::os::unix::fs::symlink("real.txt", fx.root.join("link")).unwrap();
    let before = snapshot(&fx.root);
    let applied = engine()
        .apply(&fx.apply_params(vec![delete("link")]), &never())
        .unwrap();
    assert!(!fx.root.join("link").exists() && fs::symlink_metadata(fx.root.join("link")).is_err());
    assert_eq!(
        fs::read_to_string(fx.root.join("real.txt")).unwrap(),
        "data\n"
    );
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(snapshot(&fx.root), before);
    assert_eq!(
        snapshot(&fx.root)["link"],
        common::Node::Symlink {
            target: "real.txt".into()
        }
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_cannot_launder_a_protected_or_out_of_scope_path() {
    let fx = fixture();
    put(&fx.root, ".env", "KEY=1\n", 0o600);
    put(&fx.root, "src/lib.rs", "x\n", 0o644);
    std::os::unix::fs::symlink(".env", fx.root.join("notes.txt")).unwrap();
    std::os::unix::fs::symlink("src/lib.rs", fx.root.join("docs-link")).unwrap();
    let before = snapshot(&fx.root);

    let mut p = fx.apply_params(vec![replace("notes.txt", "KEY", "K")]);
    p.protected = None; // the defaults
    let err = engine().apply(&p, &never()).unwrap_err();
    assert!(
        matches!(err, Error::ProtectedPath { ref paths } if paths == &["notes.txt"]),
        "{err:?}"
    );

    let mut p = fx.apply_params(vec![replace("docs-link", "x", "y")]);
    p.allowed = Some(vec!["docs-link".into()]);
    let err = engine().apply(&p, &never()).unwrap_err();
    assert!(matches!(err, Error::ScopeViolation { .. }), "{err:?}");
    assert_eq!(snapshot(&fx.root), before);
}

// ---- scope and protected -----------------------------------------------------------------------

#[test]
fn protected_and_scope_violations_are_checked_before_anything_is_journaled() {
    let fx = fixture();
    put(&fx.root, "src/a.rs", "a\n", 0o644);
    put(&fx.root, "tests/t.rs", "t\n", 0o644);
    put(&fx.root, "docs/d.md", "d\n", 0o644);
    let before = snapshot(&fx.root);

    let mut p = fx.apply_params(vec![
        replace("src/a.rs", "a", "A"),
        replace("tests/t.rs", "t", "T"),
        delete("docs/d.md"),
    ]);
    p.protected = None;
    let err = engine().apply(&p, &never()).unwrap_err();
    assert!(
        matches!(&err, Error::ProtectedPath { paths } if paths == &["tests/t.rs"]),
        "{err:?}"
    );
    let app: hx_proto::AppError = err.into();
    assert_eq!(
        app.to_rpc_error().string_code(),
        Some("hx.txn.protected_path")
    );
    assert_eq!(app.details["paths"][0], "tests/t.rs");

    let mut p = fx.apply_params(vec![replace("src/a.rs", "a", "A"), delete("docs/d.md")]);
    p.allowed = Some(vec!["src/**".into()]);
    let err = engine().apply(&p, &never()).unwrap_err();
    assert!(
        matches!(&err, Error::ScopeViolation { paths } if paths == &["docs/d.md"]),
        "{err:?}"
    );
    let app: hx_proto::AppError = err.into();
    assert_eq!(
        app.to_rpc_error().string_code(),
        Some("hx.txn.scope_violation")
    );

    assert_eq!(snapshot(&fx.root), before);
    assert!(
        !fx.journals.exists() || fx.journal_entries().is_empty(),
        "no journal: the checks ran first"
    );
}

#[test]
fn the_legacy_false_positives_can_be_edited_under_the_default_protection() {
    let fx = fixture();
    for p in [
        "src/latest.rs",
        "src/inspector.rs",
        "docs/contest.md",
        "src/aspect.rs",
        "src/protest.py",
    ] {
        put(&fx.root, p, "old\n", 0o644);
    }
    let mut params = fx.apply_params(
        [
            "src/latest.rs",
            "src/inspector.rs",
            "docs/contest.md",
            "src/aspect.rs",
            "src/protest.py",
        ]
        .iter()
        .map(|p| replace(p, "old", "new"))
        .collect(),
    );
    params.protected = None;
    engine().apply(&params, &never()).unwrap();
}

#[test]
fn bad_globs_are_rejected_before_anything_happens() {
    let fx = fixture();
    let mut p = fx.apply_params(vec![create("a", "x")]);
    p.allowed = Some(vec!["[".into()]);
    assert!(matches!(
        engine().apply(&p, &never()),
        Err(Error::InvalidGlob { .. })
    ));
    assert!(!fx.root.join("a").exists());
}

// ---- limits, cancellation, roots ---------------------------------------------------------------

#[test]
fn cancellation_before_the_write_changes_nothing() {
    let fx = fixture();
    put(&fx.root, "a.txt", "x\n", 0o644);
    let before = snapshot(&fx.root);
    let cancel = never();
    cancel.cancel();
    let err = engine()
        .apply(&fx.apply_params(vec![replace("a.txt", "x", "y")]), &cancel)
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled));
    assert_eq!(snapshot(&fx.root), before);
}

#[test]
fn limits_are_enforced() {
    let fx = fixture();
    put(&fx.root, "big.txt", &"x".repeat(100), 0o644);
    let tiny = hx_txn::Engine::with_limits(hx_txn::Limits {
        max_file_bytes: 50,
        ..hx_txn::Limits::default()
    });
    let err = tiny
        .apply(
            &fx.apply_params(vec![replace("big.txt", "x", "y")]),
            &never(),
        )
        .unwrap_err();
    assert_eq!(failures(err)[0].kind, FailureKind::TooLarge);
    let few = hx_txn::Engine::with_limits(hx_txn::Limits {
        max_edits: 1,
        ..hx_txn::Limits::default()
    });
    let err = few
        .apply(
            &fx.apply_params(vec![create("a", ""), create("b", "")]),
            &never(),
        )
        .unwrap_err();
    assert!(matches!(err, Error::LimitExceeded(_)));
}

#[test]
fn binary_files_refuse_text_edits_but_can_be_deleted() {
    let fx = fixture();
    fs::write(fx.root.join("blob.bin"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
    let err = engine()
        .apply(
            &fx.apply_params(vec![replace("blob.bin", "a", "b")]),
            &never(),
        )
        .unwrap_err();
    assert_eq!(failures(err)[0].kind, FailureKind::NotUtf8);
    let applied = engine()
        .apply(&fx.apply_params(vec![delete("blob.bin")]), &never())
        .unwrap();
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(
        fs::read(fx.root.join("blob.bin")).unwrap(),
        [0xff, 0xfe, 0x00, 0x01]
    );
}

#[test]
fn directories_and_missing_roots_are_reported() {
    let fx = fixture();
    fs::create_dir(fx.root.join("d")).unwrap();
    let err = engine()
        .apply(&fx.apply_params(vec![replace("d", "a", "b")]), &never())
        .unwrap_err();
    assert_eq!(failures(err)[0].kind, FailureKind::IsDirectory);
    let mut p = fx.apply_params(vec![]);
    p.root = fx.root.join("nope").to_string_lossy().into_owned();
    assert!(matches!(
        engine().apply(&p, &never()),
        Err(Error::InvalidRoot { .. })
    ));
}

#[test]
fn concurrent_transactions_on_one_workspace_serialise() {
    let fx = fixture();
    for i in 0..4 {
        put(&fx.root, &format!("f{i}.txt"), "0\n", 0o644);
    }
    std::thread::scope(|s| {
        for i in 0..4 {
            let fx = &fx;
            s.spawn(move || {
                for round in 1..=5 {
                    let r = engine().apply(
                        &fx.apply_params(vec![replace(
                            &format!("f{i}.txt"),
                            &format!("{}\n", round - 1),
                            &format!("{round}\n"),
                        )]),
                        &never(),
                    );
                    let applied = r.unwrap();
                    engine()
                        .discard(&fx.journal_ref(&applied.journal_id), &never())
                        .unwrap();
                }
            });
        }
    });
    for i in 0..4 {
        assert_eq!(
            fs::read_to_string(fx.root.join(format!("f{i}.txt"))).unwrap(),
            "5\n"
        );
    }
    assert!(fx.journal_entries().is_empty());
}
