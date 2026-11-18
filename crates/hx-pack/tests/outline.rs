//! Outline snapshots, one per language, plus registry behaviour.
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

use std::fmt::Write as _;

use common::Tree;
use hx_pack::{OutlineParams, OutlineRequest, OutlineResponse, handle_outline};

fn outline_of(tree: &Tree, paths: &[&str]) -> OutlineResponse {
    handle_outline(&OutlineRequest {
        root: tree.root().to_owned(),
        params: OutlineParams {
            paths: paths.iter().map(|s| (*s).to_owned()).collect(),
            max_bytes: None,
            max_files: 200,
            walk: hx_pack::WalkOptions::default(),
        },
    })
    .unwrap()
}

/// One row per symbol: `start-end kind parent.name | signature (decl line)`.
fn render(resp: &OutlineResponse) -> String {
    let mut out = String::new();
    for f in &resp.files {
        writeln!(out, "{} [{:?}]", f.path, f.status).unwrap();
        for s in &f.symbols {
            let name = s
                .parent
                .as_ref()
                .map_or_else(|| s.name.clone(), |p| format!("{p}.{}", s.name));
            writeln!(
                out,
                "  {:>3}-{:<3} {:<9} {} | {} (@{})",
                s.start_line, s.end_line, s.kind, name, s.signature, s.line
            )
            .unwrap();
        }
    }
    out
}

fn snapshot(file: &str) -> String {
    let tree = Tree::new();
    let name = file.rsplit('/').next().unwrap();
    tree.fixture(file, name);
    render(&outline_of(&tree, &[name]))
}

#[test]
fn rust_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.rs"));
}

#[test]
fn typescript_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.ts"));
}

#[test]
fn tsx_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.tsx"));
}

#[test]
fn javascript_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.js"));
}

#[test]
fn python_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.py"));
}

#[test]
fn go_outline() {
    insta::assert_snapshot!(snapshot("lang/sample.go"));
}
