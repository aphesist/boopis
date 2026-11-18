//! The per-root walk cache: when it serves, when it must not.
//!
//! Directory times are back-dated by an hour so that the settle window (which refuses to
//! cache a walk of a tree changed in the last two seconds) does not apply, without sleeping.
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

use std::fs::{self, File};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use common::Tree;
use hx_pack::search::search;
use hx_pack::{
    CacheStats, Control, OutlineParams, Root, SearchParams, SearchResponse, WalkCache,
    outline::outline,
};

/// Sets every file and directory under `dir` to one hour ago.
fn age(dir: &Path) {
    let then = SystemTime::now() - Duration::from_hours(1);
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            age(&path);
        }
        File::open(&path).unwrap().set_modified(then).unwrap();
    }
    File::open(dir).unwrap().set_modified(then).unwrap();
}

fn tree() -> Tree {
    let t = Tree::new();
    t.write("src/a.rs", "fn needle() {}\n");
    t.write("src/deep/b.rs", "// needle\n");
    t.write("docs/c.md", "needle\n");
    t.write(".gitignore", "ignored/\n");
    t.write("ignored/x.rs", "needle\n");
    t.write(".env", "needle\n");
    age(t.path());
    t
}

fn find(t: &Tree, ctl: &Control, globs: &[&str]) -> SearchResponse {
    let mut p = SearchParams::new("needle");
    p.globs = globs.iter().map(|s| (*s).to_owned()).collect();
    search(&Root::open(t.root()).unwrap(), &p, ctl).unwrap()
}

fn paths(r: &SearchResponse) -> Vec<&str> {
    r.blocks.iter().map(|b| b.path.as_str()).collect()
}

fn stats(c: &WalkCache) -> (u64, u64) {
    let CacheStats { hits, misses } = c.stats();
    (hits, misses)
}

#[test]
fn the_second_whole_tree_search_is_served_from_the_cache() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    let first = find(&t, &ctl, &[]);
    assert_eq!((stats(&cache), cache.len()), ((0, 1), 1));
    let second = find(&t, &ctl, &[]);
    assert_eq!(stats(&cache), (1, 1));
    assert_eq!(first, second);
    assert_eq!(paths(&first), ["docs/c.md", "src/a.rs", "src/deep/b.rs"]);
    assert_eq!(
        first.withheld.count, 1,
        "the .env is set aside, and counted on a hit too"
    );
}

#[test]
fn cached_and_uncached_answers_are_identical_for_every_filter() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let cached = Control::none().with_cache(cache);
    let plain = Control::none();
    find(&t, &cached, &[]); // populate
    for globs in [
        &[][..],
        &["*.rs"],
        &["src"],
        &["!docs"],
        &["*.md", "*.rs"],
        &["src/deep/*.rs"],
        &["nothing"],
    ] {
        assert_eq!(
            find(&t, &cached, globs),
            find(&t, &plain, globs),
            "{globs:?}"
        );
    }
    let root = Root::open(t.root()).unwrap();
    let op = OutlineParams {
        paths: vec![],
        max_bytes: None,
        max_files: 50,
        walk: Default::default(),
    };
    assert_eq!(
        outline(&root, &op, &cached).unwrap(),
        outline(&root, &op, &plain).unwrap()
    );
}

#[test]
fn a_new_file_a_removed_file_and_a_rename_are_noticed() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    find(&t, &ctl, &[]);
    // New file in a deep directory.
    t.write("src/deep/new.rs", "needle\n");
    let r = find(&t, &ctl, &[]);
    assert!(paths(&r).contains(&"src/deep/new.rs"));
    assert_eq!(
        stats(&cache).1,
        2,
        "the changed directory rejected the entry"
    );
    age(t.path());
    find(&t, &ctl, &[]); // cached again
    assert_eq!(stats(&cache), (0, 3), "too fresh at first, so not stored");
    // Removal.
    fs::remove_file(t.path().join("docs/c.md")).unwrap();
    assert!(!paths(&find(&t, &ctl, &[])).contains(&"docs/c.md"));
    age(t.path());
    find(&t, &ctl, &[]);
    find(&t, &ctl, &[]);
    assert_eq!(cache.stats().hits, 1);
    // Rename.
    fs::rename(t.path().join("src/a.rs"), t.path().join("src/renamed.rs")).unwrap();
    let r = find(&t, &ctl, &[]);
    assert!(paths(&r).contains(&"src/renamed.rs") && !paths(&r).contains(&"src/a.rs"));
}

#[test]
fn an_edited_gitignore_is_noticed_although_no_directory_changed() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    assert!(!paths(&find(&t, &ctl, &[])).contains(&"ignored/x.rs"));
    // Rewrite in place: the directory entry list is unchanged, the file's mtime is not.
    fs::write(t.path().join(".gitignore"), "# nothing ignored now\n").unwrap();
    assert!(paths(&find(&t, &ctl, &[])).contains(&"ignored/x.rs"));
}

#[test]
fn mutation_ttl_and_the_settle_window_each_reject_an_entry() {
    let t = tree();
    // Explicit invalidation.
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    find(&t, &ctl, &[]);
    find(&t, &ctl, &[]);
    assert_eq!(cache.stats().hits, 1);
    cache.invalidate_root(Root::open(t.root()).unwrap().path());
    assert!(cache.is_empty());
    find(&t, &ctl, &[]);
    cache.invalidate_all();
    assert!(cache.is_empty());
    // A zero TTL never serves.
    let cache = Arc::new(WalkCache::new(Duration::ZERO));
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    find(&t, &ctl, &[]);
    find(&t, &ctl, &[]);
    assert_eq!(stats(&cache), (0, 2));
    // A tree changed a moment ago is not stored at all.
    let fresh = Tree::new();
    fresh.write("a.txt", "needle\n");
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    find(&fresh, &ctl, &[]);
    assert!(cache.is_empty());
}

#[test]
fn skip_lists_and_roots_are_separate_entries_and_the_cache_is_bounded() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    let root = Root::open(t.root()).unwrap();
    let mut p = SearchParams::new("needle");
    search(&root, &p, &ctl).unwrap();
    p.walk.skip_dirs = Some(vec!["docs".into()]);
    let r = search(&root, &p, &ctl).unwrap();
    assert!(!paths(&r).contains(&"docs/c.md"));
    assert_eq!(cache.len(), 2);
    let others: Vec<Tree> = (0..6).map(|_| tree()).collect();
    for o in &others {
        find(o, &ctl, &[]);
    }
    assert!(cache.len() <= 4, "at most four roots are kept");
}

#[test]
fn globs_anchored_in_a_directory_skip_the_cache_and_stay_cheap() {
    let t = tree();
    let cache = Arc::new(WalkCache::default());
    let ctl = Control::none().with_cache(Arc::clone(&cache));
    let r = find(&t, &ctl, &["src/**"]);
    assert_eq!(paths(&r), ["src/a.rs", "src/deep/b.rs"]);
    assert_eq!(
        stats(&cache),
        (0, 0),
        "a directory walk is not a whole-tree walk"
    );
}
