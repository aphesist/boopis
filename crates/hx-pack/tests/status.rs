//! `pack.status`: git status, branch and HEAD, through the git CLI.
// Test code: a failing unwrap is the failure report, and these pedantic style
// lints (casts in assertions, `Default::default()` in fixtures, `format!` in
// iterator chains) add noise without protecting anything.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::default_trait_access,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::format_collect,
    clippy::too_many_lines
)]

mod common;

use std::path::Path;
use std::process::Command;

use common::Tree;
use hx_pack::{EntryKind, StatusParams, StatusRequest, StatusResponse, Truncation, handle_status};

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn status_at(root: &str, max_entries: usize) -> StatusResponse {
    handle_status(&StatusRequest {
        root: root.to_owned(),
        params: StatusParams {
            max_entries,
            timeout_ms: 20_000,
        },
    })
    .unwrap()
}

fn repo() -> Tree {
    let t = Tree::new();
    git(t.path(), &["init", "-q", "-b", "main"]);
    t.write("tracked.txt", "one\n");
    t.write("sub/inner.txt", "inner\n");
    git(t.path(), &["add", "."]);
    git(t.path(), &["commit", "-q", "-m", "first"]);
    t
}

#[test]
fn not_a_repository_is_an_outcome_not_an_error() {
    let t = Tree::new();
    t.write("a.txt", "x");
    let r = status_at(t.root(), 10);
    assert!(!r.is_repo && r.entries.is_empty() && r.head.is_none());
}

#[test]
fn a_repository_without_commits_has_a_branch_and_no_head() {
    let t = Tree::new();
    git(t.path(), &["init", "-q", "-b", "trunk"]);
    t.write("new.txt", "x");
    let r = status_at(t.root(), 10);
    assert!(r.is_repo);
    assert_eq!(
        (r.branch.as_deref(), r.head.as_deref()),
        (Some("trunk"), None)
    );
    assert_eq!(r.entries.len(), 1);
    assert_eq!(r.entries[0].kind, EntryKind::Untracked);
}

#[test]
fn clean_tree_reports_branch_and_head() {
    let t = repo();
    let r = status_at(t.root(), 10);
    assert_eq!(r.branch.as_deref(), Some("main"));
    let head = r.head.unwrap();
    assert_eq!(head.len(), 40);
    assert!(head.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(r.entries.is_empty() && !r.detached);
}

#[test]
fn staged_unstaged_untracked_renamed_and_deleted() {
    let t = repo();
    t.write("tracked.txt", "one\ntwo\n"); // unstaged modification
    t.write("staged.txt", "s\n");
    git(t.path(), &["add", "staged.txt"]);
    git(t.path(), &["mv", "sub/inner.txt", "sub/moved name.txt"]);
    t.write("untracked.txt", "u\n");
    let r = status_at(t.root(), 50);
    let by = |p: &str| {
        r.entries
            .iter()
            .find(|e| e.path == p)
            .unwrap_or_else(|| panic!("{p} missing in {:#?}", r.entries))
    };
    assert_eq!(
        (
            by("tracked.txt").index.as_str(),
            by("tracked.txt").worktree.as_str()
        ),
        (".", "M")
    );
    assert_eq!(
        (by("staged.txt").index.as_str(), by("staged.txt").kind),
        ("A", EntryKind::Changed)
    );
    let moved = by("sub/moved name.txt");
    assert_eq!(
        (moved.kind, moved.orig_path.as_deref()),
        (EntryKind::Renamed, Some("sub/inner.txt"))
    );
    assert_eq!(by("untracked.txt").kind, EntryKind::Untracked);
    assert_eq!(
        (r.counts.staged, r.counts.unstaged, r.counts.untracked),
        (2, 1, 1)
    );
}

#[test]
fn a_subdirectory_root_sees_paths_relative_to_itself() {
    let t = repo();
    t.write("sub/inner.txt", "changed\n");
    t.write("top.txt", "u\n");
    let r = status_at(t.path().join("sub").to_str().unwrap(), 10);
    assert!(r.is_repo);
    assert_eq!(r.entries.len(), 1, "{:#?}", r.entries);
    assert_eq!(r.entries[0].path, "inner.txt");
}

#[test]
fn detached_head_and_upstream_counts() {
    let t = repo();
    git(t.path(), &["checkout", "-q", "--detach"]);
    let r = status_at(t.root(), 10);
    assert!(r.detached && r.branch.is_none() && r.head.is_some());
    // A branch with an upstream.
    let origin = Tree::new();
    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
    let t = repo();
    git(t.path(), &["remote", "add", "origin", origin.root()]);
    git(t.path(), &["push", "-q", "-u", "origin", "main"]);
    t.write("more.txt", "m\n");
    git(t.path(), &["add", "."]);
    git(t.path(), &["commit", "-q", "-m", "second"]);
    let r = status_at(t.root(), 10);
    assert_eq!(
        (r.upstream.as_deref(), r.ahead, r.behind),
        (Some("origin/main"), Some(1), Some(0))
    );
}

#[test]
fn the_entry_cap_truncates_the_list_but_not_the_counts() {
    let t = repo();
    for i in 0..30 {
        t.write(&format!("u{i:02}.txt"), "x");
    }
    let r = status_at(t.root(), 10);
    assert_eq!((r.entries.len(), r.counts.untracked), (10, 30));
    assert!(r.truncated.contains(&Truncation::MaxItems));
}

#[test]
fn a_repository_cannot_run_a_program_through_status() {
    let t = repo();
    let marker = t.path().join("ran-marker");
    let hook = t.write(
        "evil.sh",
        &format!("#!/bin/sh\ntouch {}\n", marker.display()),
    );
    Command::new("chmod").arg("+x").arg(&hook).status().unwrap();
    git(
        t.path(),
        &["config", "core.fsmonitor", hook.to_str().unwrap()],
    );
    t.write("a.txt", "dirty\n");
    let r = status_at(t.root(), 10);
    assert!(r.is_repo);
    assert!(!marker.exists(), "fsmonitor hook ran");
}
