//! Property tests: no path escapes, budgets are never exceeded.
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

use std::os::unix::fs::symlink;

use common::Tree;
use hx_pack::{
    BundleItem, BundleParams, BundleRequest, LineRange, OutlineParams, OutlineRequest, ReadParams,
    ReadRequest, RelPath, SearchParams, SearchRequest, SymbolParams, SymbolRequest, handle_bundle,
    handle_outline, handle_read, handle_search, handle_symbol,
};
use proptest::prelude::*;

const SECRET: &str = "OUTSIDE_SECRET_VALUE";

fn path_piece() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just(".."),
        Just("."),
        Just(""),
        Just("/"),
        Just("\\"),
        Just("link"),
        Just("dirlink"),
        Just("inside.txt"),
        Just("outside.txt"),
        Just("sub"),
        Just("root"),
        Just("a"),
        Just("...")
    ]
}

fn path_string() -> impl Strategy<Value = String> {
    proptest::collection::vec(path_piece(), 0..6).prop_map(|v| v.join("/"))
}

/// A jail whose root holds links that lead outside it.
fn jail() -> Tree {
    let parent = Tree::new();
    parent.write("outside.txt", &format!("{SECRET}\n"));
    parent.write("outdir/x.txt", &format!("{SECRET}\n"));
    parent.write("root/inside.txt", "inside\n");
    parent.write("root/sub/a", "inside too\n");
    let root = parent.path().join("root");
    symlink("../outside.txt", root.join("link")).unwrap();
    symlink("../outdir", root.join("dirlink")).unwrap();
    parent
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::with_cases(400) })]

    #[test]
    fn parsed_paths_are_clean_and_relative(s in path_string()) {
        if let Ok(p) = RelPath::parse(&s) {
            let text = p.as_str();
            prop_assert!(!text.starts_with('/'));
            prop_assert!(text.is_empty() || text.split('/').all(|c| !c.is_empty() && c != "." && c != ".."));
        }
    }

    #[test]
    fn arbitrary_strings_never_parse_into_an_escape(s in "\\PC{0,24}") {
        if let Ok(p) = RelPath::parse(&s) {
            prop_assert!(p.as_str().split('/').all(|c| c != ".."));
            prop_assert!(!p.as_str().starts_with('/'));
        }
    }

    #[test]
    fn no_method_returns_content_from_outside_the_root(path in path_string(), glob in path_string()) {
        let parent = jail();
        let root = parent.path().join("root").to_str().unwrap().to_owned();
        let mut leaked = Vec::new();
        if let Ok(r) = handle_read(&ReadRequest { root: root.clone(), params: ReadParams { path: path.clone(), ranges: vec![], max_bytes: None, walk: Default::default() } }) {
            leaked.push(serde_json::to_string(&r).unwrap());
        }
        let mut sp = SearchParams::new(SECRET);
        sp.globs = vec![glob.clone()];
        if let Ok(r) = handle_search(&SearchRequest { root: root.clone(), params: sp }) {
            leaked.push(serde_json::to_string(&r).unwrap());
        }
        let op = OutlineParams { paths: vec![path.clone()], max_bytes: None, max_files: 10, walk: Default::default() };
        if let Ok(r) = handle_outline(&OutlineRequest { root: root.clone(), params: op }) {
            leaked.push(serde_json::to_string(&r).unwrap());
        }
        let sy = SymbolParams { name: "x".into(), path: Some(path), lang: None, max_definitions: 5, max_bytes: None, walk: Default::default() };
        if let Ok(r) = handle_symbol(&SymbolRequest { root, params: sy }) {
            leaked.push(serde_json::to_string(&r).unwrap());
        }
        for l in leaked {
            prop_assert!(!l.contains(SECRET), "leaked: {l}");
        }
    }
}

fn corpus(files: &[Vec<String>]) -> Tree {
    let t = Tree::new();
    for (i, lines) in files.iter().enumerate() {
        t.write(&format!("d{}/f{i}.py", i % 3), &lines.join("\n"));
    }
    t.write("keep.py", "def target():\n    return 1\n");
    t
}

fn lines() -> impl Strategy<Value = Vec<Vec<String>>> {
    proptest::collection::vec(
        proptest::collection::vec(
            prop_oneof![
                "[a-z ]{0,30}",
                Just("def target(): pass".to_owned()),
                Just("needle needle".to_owned()),
                "x{0,300}needle"
            ],
            0..40,
        ),
        1..8,
    )
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::with_cases(120) })]

    #[test]
    fn search_never_exceeds_its_budget(files in lines(), max_bytes in 1usize..4000, before in 0usize..4, after in 0usize..4, max_matches in 1usize..60) {
        let t = corpus(&files);
        let mut p = SearchParams::new("needle");
        p.max_bytes = Some(max_bytes);
        p.context_before = before;
        p.context_after = after;
        p.max_matches = max_matches;
        let r = handle_search(&SearchRequest { root: t.root().into(), params: p }).unwrap();
        let charged: usize = r.blocks.iter().map(|b| 32 + b.path.len() + b.text.len()).sum();
        prop_assert_eq!(charged, r.bytes);
        prop_assert!(r.bytes <= max_bytes);
        prop_assert!(r.matches <= max_matches);
        prop_assert_eq!(r.matches, r.blocks.iter().map(|b| b.match_lines.len()).sum::<usize>());
        // Blocks are ordered and disjoint.
        for w in r.blocks.windows(2) {
            prop_assert!((&w[0].path, w[0].start_line) < (&w[1].path, w[1].start_line));
            if w[0].path == w[1].path {
                prop_assert!(w[0].end_line < w[1].start_line);
            }
        }
    }

    #[test]
    fn read_symbol_and_outline_never_exceed_their_budget(files in lines(), max_bytes in 1usize..3000, start in 1u32..30, len in 0u32..40) {
        let t = corpus(&files);
        let rp = ReadParams { path: "d0/f0.py".into(), ranges: vec![LineRange { start, end: Some(start + len) }], max_bytes: Some(max_bytes), walk: Default::default() };
        if let Ok(r) = handle_read(&ReadRequest { root: t.root().into(), params: rp }) {
            prop_assert!(r.bytes <= max_bytes);
            prop_assert!(r.segments.iter().map(|s| 32 + r.path.len() + s.text.len()).sum::<usize>() <= max_bytes);
        }
        let sp = SymbolParams { name: "target".into(), path: None, lang: None, max_definitions: 50, max_bytes: Some(max_bytes), walk: Default::default() };
        let r = handle_symbol(&SymbolRequest { root: t.root().into(), params: sp }).unwrap();
        prop_assert!(r.bytes <= max_bytes);
        let op = OutlineParams { paths: vec![], max_bytes: Some(max_bytes), max_files: 100, walk: Default::default() };
        let r = handle_outline(&OutlineRequest { root: t.root().into(), params: op }).unwrap();
        prop_assert!(r.bytes <= max_bytes);
    }

    #[test]
    fn bundles_never_exceed_their_budget(files in lines(), total in 1usize..6000, n in 1usize..6) {
        let t = corpus(&files);
        let items: Vec<BundleItem> = (0..n)
            .map(|i| match i % 3 {
                0 => BundleItem::Search(SearchParams::new("needle")),
                1 => BundleItem::Read(ReadParams { path: "keep.py".into(), ranges: vec![], max_bytes: None, walk: Default::default() }),
                _ => BundleItem::Outline(OutlineParams { paths: vec![], max_bytes: None, max_files: 50, walk: Default::default() }),
            })
            .collect();
        let r = handle_bundle(&BundleRequest { root: t.root().into(), params: BundleParams { requests: items, max_bytes: total } }).unwrap();
        prop_assert!(r.bytes <= total, "{} > {}", r.bytes, total);
        prop_assert_eq!(r.bytes, r.results.iter().map(|e| e.bytes).sum::<usize>());
    }
}
