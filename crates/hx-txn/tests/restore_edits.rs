//! The byte-exact restore edits the plugin's rewind uses (`put`, and `expect_sha256` on `delete`):
//! exact bytes (not only UTF-8), the executable bit, and the hash each path must still have,
//! checked under the workspace lock before anything is written (docs/specs/checkpoint-rewind.md
//! section 5).
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;

use common::{engine, fixture, never, put, snapshot};
use hx_proto::txn::{Edit, FailureKind};
use hx_txn::Error;
use sha2::{Digest, Sha256};

fn sha(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= c.len() {
                out.push(char::from(T[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn put_edit(path: &str, bytes: &[u8], mode: &str, expect: &str) -> Edit {
    Edit::Put {
        path: path.into(),
        content_b64: b64(bytes),
        mode: mode.into(),
        expect_sha256: expect.into(),
    }
}

#[cfg(unix)]
fn mode_of(p: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(p).unwrap().permissions().mode() & 0o7777
}

#[test]
fn put_recreates_a_file_that_is_not_utf8_byte_for_byte() {
    let fx = fixture();
    let bytes: Vec<u8> = vec![0xff, 0x00, 0xfe, b'\n', 0x80, 0x81];
    engine()
        .apply(
            &fx.apply_params(vec![put_edit("bin/b.bin", &bytes, "100644", "absent")]),
            &never(),
        )
        .unwrap();
    assert_eq!(fs::read(fx.root.join("bin/b.bin")).unwrap(), bytes);
}

#[cfg(unix)]
#[test]
fn put_sets_and_clears_the_executable_bit() {
    let fx = fixture();
    put(&fx.root, "run.sh", "echo old\n", 0o644);
    put(&fx.root, "tool.sh", "echo t\n", 0o755);
    let r = engine()
        .apply(
            &fx.apply_params(vec![
                put_edit("run.sh", b"echo new\n", "100755", &sha(b"echo old\n")),
                put_edit("tool.sh", b"echo t\n", "100644", &sha(b"echo t\n")),
                put_edit("fresh.sh", b"echo f\n", "100755", "absent"),
            ]),
            &never(),
        )
        .unwrap();
    assert_eq!(fs::read(fx.root.join("run.sh")).unwrap(), b"echo new\n");
    assert_eq!(mode_of(&fx.root.join("run.sh")), 0o755);
    assert_eq!(mode_of(&fx.root.join("tool.sh")), 0o644);
    assert_eq!(mode_of(&fx.root.join("fresh.sh")), 0o755);
    // the same bytes with another mode is still a change
    assert!(r.files.iter().any(|f| f.path == "tool.sh"));
}

#[test]
fn a_path_that_is_not_as_expected_fails_the_whole_transaction_and_writes_nothing() {
    let fx = fixture();
    put(&fx.root, "a.txt", "mine\n", 0o644);
    put(&fx.root, "b.txt", "theirs, edited since\n", 0o644);
    let before = snapshot(&fx.root);
    let err = engine()
        .apply(
            &fx.apply_params(vec![
                put_edit("a.txt", b"back\n", "100644", &sha(b"mine\n")),
                put_edit(
                    "b.txt",
                    b"back\n",
                    "100644",
                    &sha(b"what the session left\n"),
                ),
                put_edit("c.txt", b"new\n", "100644", &sha(b"was here\n")),
            ]),
            &never(),
        )
        .unwrap_err();
    match err {
        Error::ChangedSince { paths } => {
            assert_eq!(paths, vec!["b.txt".to_owned(), "c.txt".to_owned()]);
        }
        other => panic!("expected changed_since, got {other:?}"),
    }
    assert_eq!(snapshot(&fx.root), before);
    assert!(fx.journal_entries().is_empty());
}

#[test]
fn absent_means_absent() {
    let fx = fixture();
    put(&fx.root, "a.txt", "here\n", 0o644);
    let err = engine()
        .apply(
            &fx.apply_params(vec![put_edit("a.txt", b"x", "100644", "absent")]),
            &never(),
        )
        .unwrap_err();
    assert!(matches!(err, Error::ChangedSince { .. }));
    assert_eq!(err.code(), "hx.txn.changed_since");
}

#[test]
fn delete_with_an_expected_hash() {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\n", 0o644);
    put(&fx.root, "b.txt", "two\n", 0o644);
    let wrong = engine()
        .apply(
            &fx.apply_params(vec![Edit::Delete {
                path: "a.txt".into(),
                expect_sha256: Some(sha(b"other\n")),
            }]),
            &never(),
        )
        .unwrap_err();
    assert!(matches!(wrong, Error::ChangedSince { .. }));
    assert!(fx.root.join("a.txt").exists());
    engine()
        .apply(
            &fx.apply_params(vec![Edit::Delete {
                path: "a.txt".into(),
                expect_sha256: Some(sha(b"one\n")),
            }]),
            &never(),
        )
        .unwrap();
    assert!(!fx.root.join("a.txt").exists());
}

#[test]
fn bad_base64_or_mode_is_an_edit_failure() {
    let fx = fixture();
    let err = engine()
        .apply(
            &fx.apply_params(vec![
                Edit::Put {
                    path: "a".into(),
                    content_b64: "!!!".into(),
                    mode: "100644".into(),
                    expect_sha256: "absent".into(),
                },
                Edit::Put {
                    path: "b".into(),
                    content_b64: "eA==".into(),
                    mode: "120000".into(),
                    expect_sha256: "absent".into(),
                },
            ]),
            &never(),
        )
        .unwrap_err();
    match err {
        Error::AbortedBeforeWrite { failures } => {
            assert_eq!(failures.len(), 2);
            assert!(failures.iter().all(|f| f.kind == FailureKind::Unsupported));
        }
        other => panic!("expected aborted_before_write, got {other:?}"),
    }
}

#[test]
fn put_and_restore_round_trip() {
    let fx = fixture();
    put(&fx.root, "a.txt", "one\n", 0o644);
    let before = snapshot(&fx.root);
    let applied = engine()
        .apply(
            &fx.apply_params(vec![
                put_edit("a.txt", &[0xc3, 0x28], "100755", &sha(b"one\n")),
                put_edit("d/new.bin", &[1, 2, 3], "100644", "absent"),
            ]),
            &never(),
        )
        .unwrap();
    engine()
        .restore(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    assert_eq!(snapshot(&fx.root), before);
}
