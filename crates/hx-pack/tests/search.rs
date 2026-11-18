//! `pack.search`: matching, windows, filters, limits, redaction.
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

use common::Tree;
use hx_pack::{
    CaseMode, PatternMode, SearchParams, SearchRequest, SearchResponse, Truncation, handle_search,
};

fn run(tree: &Tree, params: SearchParams) -> SearchResponse {
    handle_search(&SearchRequest {
        root: tree.root().to_owned(),
        params,
    })
    .unwrap()
}

fn find(tree: &Tree, pattern: &str) -> SearchResponse {
    run(tree, SearchParams::new(pattern))
}

fn numbered(n: usize) -> String {
    (1..=n).map(|i| format!("line {i}\n")).collect()
}

#[test]
fn matches_come_with_context_in_path_order() {
    let t = Tree::new();
    t.write("b.txt", "one\ntwo\nNEEDLE here\nfour\nfive\nsix\n");
    t.write("a/z.txt", "alpha\nNEEDLE too\nomega\n");
    let r = find(&t, "NEEDLE");
    assert_eq!(r.blocks.len(), 2);
    assert_eq!(r.blocks[0].path, "a/z.txt");
    assert_eq!(r.blocks[0].text, "1-alpha\n2:NEEDLE too\n3-omega\n");
    assert_eq!(r.blocks[1].path, "b.txt");
    assert_eq!(r.blocks[1].start_line, 1);
    assert_eq!(r.blocks[1].end_line, 5);
    assert_eq!(r.blocks[1].match_lines, vec![3]);
    assert_eq!(
        r.blocks[1].text,
        "1-one\n2-two\n3:NEEDLE here\n4-four\n5-five\n"
    );
    assert_eq!((r.matches, r.files_matched), (2, 2));
    assert!(r.truncated.is_empty());
    assert_eq!(
        r.bytes,
        r.blocks
            .iter()
            .map(|b| 32 + b.path.len() + b.text.len())
            .sum::<usize>()
    );
}

#[test]
fn overlapping_and_touching_windows_merge() {
    let t = Tree::new();
    let mut body = numbered(30);
    body = body
        .replace("line 5\n", "HIT 5\n")
        .replace("line 8\n", "HIT 8\n")
        .replace("line 13\n", "HIT 13\n")
        .replace("line 25\n", "HIT 25\n");
    t.write("f.txt", &body);
    let mut p = SearchParams::new("HIT");
    p.context_before = 2;
    p.context_after = 2;
    let r = run(&t, p);
    // 5 and 8: windows 3-7 and 6-10 overlap; 13: 11-15 touches 10; 25 stands alone.
    assert_eq!(r.blocks.len(), 2, "{:#?}", r.blocks);
    assert_eq!((r.blocks[0].start_line, r.blocks[0].end_line), (3, 15));
    assert_eq!(r.blocks[0].match_lines, vec![5, 8, 13]);
    assert_eq!((r.blocks[1].start_line, r.blocks[1].end_line), (23, 27));
    assert_eq!(r.matches, 4);
}

#[test]
fn windows_clamp_at_file_edges() {
    let t = Tree::new();
    t.write("f.txt", "HIT\nb\nc\nd\nHIT");
    let mut p = SearchParams::new("HIT");
    p.context_before = 5;
    p.context_after = 5;
    let r = run(&t, p);
    assert_eq!(r.blocks.len(), 1);
    assert_eq!((r.blocks[0].start_line, r.blocks[0].end_line), (1, 5));
    assert_eq!(r.blocks[0].text, "1:HIT\n2-b\n3-c\n4-d\n5:HIT\n");
}

#[test]
fn literal_regex_and_case_modes() {
    let t = Tree::new();
    t.write("f.txt", "a.b\naxb\nFoo\nfoo\n");
    let mut lit = SearchParams::new("a.b");
    lit.mode = PatternMode::Literal;
    lit.context_before = 0;
    lit.context_after = 0;
    assert_eq!(run(&t, lit).matches, 1);
    let mut re = SearchParams::new("a.b");
    re.context_before = 0;
    re.context_after = 0;
    assert_eq!(run(&t, re).matches, 2);
    let mut smart = SearchParams::new("foo");
    smart.context_before = 0;
    smart.context_after = 0;
    assert_eq!(
        run(&t, smart.clone()).matches,
        2,
        "all-lowercase is insensitive"
    );
    smart.pattern = "Foo".into();
    assert_eq!(
        run(&t, smart.clone()).matches,
        1,
        "an uppercase letter makes it exact"
    );
    smart.pattern = "foo".into();
    smart.case = CaseMode::Sensitive;
    assert_eq!(run(&t, smart).matches, 1);
}

#[test]
fn globs_narrow_the_walk() {
    let t = Tree::new();
    t.write("src/a.rs", "needle\n");
    t.write("src/deep/b.rs", "needle\n");
    t.write("src/c.ts", "needle\n");
    t.write("docs/d.md", "needle\n");
    t.write("top.rs", "needle\n");
    let with = |globs: &[&str]| {
        let mut p = SearchParams::new("needle");
        p.globs = globs.iter().map(|s| (*s).to_owned()).collect();
        run(&t, p)
    };
    let paths = |r: &SearchResponse| r.blocks.iter().map(|b| b.path.clone()).collect::<Vec<_>>();
    assert_eq!(
        paths(&with(&["*.rs"])),
        ["src/a.rs", "src/deep/b.rs", "top.rs"]
    );
    assert_eq!(
        paths(&with(&["src/**/*.rs"])),
        ["src/a.rs", "src/deep/b.rs"]
    );
    assert_eq!(paths(&with(&["src/*.rs"])), ["src/a.rs"]);
    assert_eq!(
        paths(&with(&["src"])),
        ["src/a.rs", "src/c.ts", "src/deep/b.rs"]
    );
    assert_eq!(paths(&with(&["top.rs", "docs"])), ["docs/d.md", "top.rs"]);
    assert_eq!(paths(&with(&["*.rs", "!src/deep"])), ["src/a.rs", "top.rs"]);
    // A glob anchored in a directory only visits that directory.
    assert_eq!(with(&["docs/**"]).files_walked, 1);
    assert_eq!(with(&["src/deep/*.rs"]).files_walked, 1);
    assert_eq!(with(&["*.rs"]).files_walked, 3);
}

#[test]
fn ignored_and_skipped_directories_are_not_walked() {
    let t = Tree::new();
    t.write(".gitignore", "build/\n*.gen.rs\n");
    t.write("build/out.rs", "needle\n");
    t.write("x.gen.rs", "needle\n");
    t.write("node_modules/p/i.js", "needle\n");
    t.write("target/debug/t.rs", "needle\n");
    t.write(".git/HEAD", "needle\n");
    t.write("src/ok.rs", "needle\n");
    t.write(".hidden/ok.txt", "needle\n");
    let r = find(&t, "needle");
    let paths: Vec<_> = r.blocks.iter().map(|b| b.path.as_str()).collect();
    assert_eq!(paths, [".hidden/ok.txt", "src/ok.rs"]);
    // The skip list is configurable.
    let mut p = SearchParams::new("needle");
    p.walk.skip_dirs = Some(vec!["src".into(), "build".into()]);
    let paths: Vec<_> = run(&t, p).blocks.iter().map(|b| b.path.clone()).collect();
    assert!(
        paths.contains(&"node_modules/p/i.js".to_owned())
            && !paths.contains(&"src/ok.rs".to_owned())
    );
}

#[test]
fn binary_and_oversized_files_are_skipped_and_counted() {
    let t = Tree::new();
    t.write_bytes("bin.dat", b"needle\0\x01\x02");
    t.write("big.txt", &format!("needle\n{}", "x".repeat(5000)));
    t.write("ok.txt", "needle\n");
    let mut p = SearchParams::new("needle");
    p.walk.max_file_bytes = Some(1000);
    let r = run(&t, p);
    assert_eq!(r.blocks.len(), 1);
    assert_eq!((r.skipped.binary, r.skipped.too_large), (1, 1));
}

#[test]
fn never_pack_files_are_withheld_and_reported() {
    let t = Tree::new();
    t.write(".env", "API_KEY=needle\n");
    t.write("config/server.pem", "needle\n");
    t.write("src/ok.rs", "needle\n");
    let r = find(&t, "needle");
    assert_eq!(r.blocks.len(), 1);
    assert_eq!(r.withheld.count, 2);
    let names: Vec<_> = r.withheld.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(names, [".env", "config/server.pem"]);
    assert!(!serde_json::to_string(&r).unwrap().contains("API_KEY"));
}

#[test]
fn secrets_are_redacted_and_cannot_be_probed_by_pattern() {
    let t = Tree::new();
    t.write(
        "cfg.rs",
        "let a = 1;\nlet token = \"sk-ant-api03-abcdefghijklmnopqrstuv\";\nlet b = 2;\n",
    );
    let r = find(&t, "let token");
    assert_eq!(
        r.blocks[0].text,
        "1-let a = 1;\n2:let token = \"[REDACTED:anthropic_key]\";\n3-let b = 2;\n"
    );
    assert_eq!(r.redactions.total, 1);
    assert_eq!(r.redactions.by_rule["anthropic_key"], 1);
    // A pattern that only the hidden secret can satisfy finds nothing.
    for probe in ["sk-ant-api03-abc", "abcdefghijklmnopqrstuv", "api03-a"] {
        let r = find(&t, probe);
        assert!(r.blocks.is_empty(), "{probe} leaked: {:?}", r.blocks);
        assert_eq!(r.matches, 0);
    }
    // Candidate files are found on the raw text, so the placeholder text itself
    // is not searchable. That is the price of closing the probing channel.
    assert_eq!(find(&t, "REDACTED:anthropic_key").matches, 0);
}

#[test]
fn line_numbers_survive_multiline_redaction() {
    let t = Tree::new();
    t.write(
        "k.txt",
        "a\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\nTARGET\n",
    );
    let mut p = SearchParams::new("TARGET");
    p.context_before = 0;
    p.context_after = 0;
    let r = run(&t, p);
    assert_eq!(r.blocks[0].match_lines, vec![6]);
    assert_eq!(r.blocks[0].text, "6:TARGET\n");
}

#[test]
fn max_matches_stops_early_and_says_so() {
    let t = Tree::new();
    for i in 0..20 {
        t.write(&format!("f{i:02}.txt"), "hit\nhit\nhit\n");
    }
    let mut p = SearchParams::new("hit");
    p.max_matches = 7;
    p.context_before = 0;
    p.context_after = 0;
    let r = run(&t, p);
    assert_eq!(r.matches, 7);
    assert!(r.truncated.contains(&Truncation::MaxMatches));
    assert_eq!(r.blocks.last().unwrap().path, "f02.txt");
    assert!(r.files_scanned < 20 || r.files_walked == 20);
}

#[test]
fn max_bytes_is_a_hard_cap_with_a_partial_last_block() {
    let t = Tree::new();
    t.write("a.txt", &"hit\n".repeat(50));
    t.write("b.txt", &"hit\n".repeat(50));
    for limit in [1usize, 40, 100, 300, 1000, 100_000] {
        let mut p = SearchParams::new("hit");
        p.max_bytes = Some(limit);
        let r = run(&t, p);
        assert!(r.bytes <= limit, "limit {limit}: used {}", r.bytes);
        let sum: usize = r
            .blocks
            .iter()
            .map(|b| 32 + b.path.len() + b.text.len())
            .sum();
        assert_eq!(sum, r.bytes);
        if limit < 400 {
            assert!(r.truncated.contains(&Truncation::MaxBytes), "limit {limit}");
        }
    }
}

#[test]
fn huge_lines_are_clipped_and_marked() {
    let t = Tree::new();
    t.write("min.js", &format!("var a=1;{}\nneedle\n", "x".repeat(3000)));
    let mut p = SearchParams::new("needle");
    p.context_before = 1;
    let r = run(&t, p);
    assert!(r.truncated.contains(&Truncation::LineClipped));
    assert!(r.blocks[0].text.len() < 700 && r.blocks[0].text.contains("…[+"));
}

#[test]
fn results_are_deterministic_across_runs() {
    let t = Tree::new();
    for i in 0..120 {
        t.write(
            &format!("d{}/f{i:03}.txt", i % 7),
            &format!("x\nhit {i}\ny\n"),
        );
    }
    let mut p = SearchParams::new("hit");
    p.max_matches = 50;
    let first = run(&t, p.clone());
    for _ in 0..10 {
        assert_eq!(run(&t, p.clone()), first);
    }
}

#[test]
fn bad_requests_are_errors_with_codes() {
    let t = Tree::new();
    t.write("a.txt", "x");
    let err = |p: SearchParams| {
        handle_search(&SearchRequest {
            root: t.root().to_owned(),
            params: p,
        })
        .unwrap_err()
        .code()
    };
    assert_eq!(err(SearchParams::new("(")), "hx.pack.invalid_pattern");
    assert_eq!(err(SearchParams::new("")), "hx.pack.invalid_request");
    assert_eq!(err(SearchParams::new("a\nb")), "hx.pack.invalid_pattern");
    let mut p = SearchParams::new("a");
    p.max_matches = 0;
    assert_eq!(err(p), "hx.pack.invalid_request");
    let mut p = SearchParams::new("a");
    p.globs = vec!["../*.rs".into()];
    assert_eq!(err(p), "hx.pack.path_escape");
    let e = handle_search(&SearchRequest {
        root: "/definitely/not/here".into(),
        params: SearchParams::new("a"),
    })
    .unwrap_err();
    assert_eq!(e.code(), "hx.pack.invalid_root");
}

#[test]
fn request_json_matches_the_documented_shape() {
    let req: SearchRequest = serde_json::from_str(
        r#"{"root":"/tmp","pattern":"foo","mode":"literal","case":"insensitive","globs":["*.rs"],
            "context_before":1,"context_after":3,"max_matches":5,"max_bytes":1000,"future_field":true}"#,
    )
    .unwrap();
    assert_eq!(req.params.mode, PatternMode::Literal);
    assert_eq!(req.params.max_bytes(), 1000);
    let minimal: SearchRequest = serde_json::from_str(r#"{"root":"/tmp","pattern":"x"}"#).unwrap();
    assert_eq!(
        (minimal.params.context_before, minimal.params.max_matches),
        (2, 200)
    );
}

#[test]
fn cancellation_and_deadlines_abort_the_call() {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::time::Instant;

    let t = Tree::new();
    for i in 0..50 {
        t.write(&format!("f{i}.txt"), "needle\n");
    }
    let req = SearchRequest {
        root: t.root().to_owned(),
        params: SearchParams::new("needle"),
    };
    let flag = Arc::new(AtomicBool::new(true));
    let ctl = hx_pack::Control::none().with_cancel(flag);
    let e = hx_pack::handle_search_with(&req, &ctl).unwrap_err();
    assert_eq!(e.code(), "hx.pack.cancelled");
    let ctl = hx_pack::Control::none().with_deadline(Instant::now());
    let e = hx_pack::handle_search_with(&req, &ctl).unwrap_err();
    assert_eq!(e.code(), "hx.pack.timeout");
    // A control that never fires changes nothing.
    let ok = hx_pack::handle_search_with(&req, &hx_pack::Control::none()).unwrap();
    assert_eq!(ok.matches, 50);
}
