//! `pack.symbol`: full source of named definitions.
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
use hx_pack::{SymbolParams, SymbolRequest, SymbolResponse, Truncation, handle_symbol};

fn params(name: &str) -> SymbolParams {
    SymbolParams {
        name: name.to_owned(),
        path: None,
        lang: None,
        max_definitions: 20,
        max_bytes: None,
        walk: hx_pack::WalkOptions::default(),
    }
}

fn run(t: &Tree, p: SymbolParams) -> hx_pack::Result<SymbolResponse> {
    handle_symbol(&SymbolRequest {
        root: t.root().to_owned(),
        params: p,
    })
}

fn tree() -> Tree {
    let t = Tree::new();
    t.fixture("lang/sample.rs", "src/sample.rs");
    t.fixture("lang/sample.py", "py/sample.py");
    t.fixture("lang/sample.ts", "web/sample.ts");
    t.fixture("lang/sample.go", "go/sample.go");
    t
}

#[test]
fn returns_the_full_source_with_docs_and_attributes() {
    let t = tree();
    let r = run(&t, params("Point")).unwrap();
    let structs: Vec<_> = r
        .definitions
        .iter()
        .filter(|d| d.kind == "struct")
        .collect();
    assert_eq!(structs.len(), 1);
    let s = structs[0];
    assert_eq!(
        (s.path.as_str(), s.start_line, s.end_line),
        ("src/sample.rs", 5, 10)
    );
    assert_eq!(
        s.text,
        "5|/// A point in the plane.\n6|#[derive(Debug, Clone)]\n7|pub struct Point {\n8|    pub x: f64,\n9|    pub y: f64,\n10|}\n"
    );
    // The two impl blocks are definitions named Point as well.
    assert_eq!(r.definitions.iter().filter(|d| d.kind == "impl").count(), 2);
}

#[test]
fn qualified_names_select_by_parent() {
    let t = tree();
    let r = run(&t, params("Account.deposit")).unwrap();
    assert_eq!(r.definitions.len(), 1);
    assert_eq!(r.definitions[0].kind, "method");
    assert!(r.definitions[0].text.contains("async def deposit("));
    assert_eq!(
        run(&t, params("Account::deposit"))
            .unwrap()
            .definitions
            .len(),
        1
    );
    assert_eq!(
        run(&t, params("Other.deposit")).unwrap().definitions.len(),
        0
    );
    let r = run(&t, params("Server.Start")).unwrap();
    assert_eq!(r.definitions.len(), 1);
    assert_eq!(r.definitions[0].path, "go/sample.go");
    // The same name in two files comes back for both, in path order.
    let r = run(&t, params("find")).unwrap();
    assert_eq!(
        r.definitions
            .iter()
            .map(|d| d.parent.clone().unwrap())
            .collect::<Vec<_>>(),
        ["Repo", "UserRepo"]
    );
}

#[test]
fn path_and_lang_restrict_the_search() {
    let t = tree();
    let mut p = params("area");
    p.path = Some("src/sample.rs".into());
    assert_eq!(run(&t, p).unwrap().definitions.len(), 1);
    let mut p = params("area");
    p.path = Some("py".into());
    assert_eq!(run(&t, p).unwrap().definitions.len(), 0);
    let mut p = params("greet");
    p.lang = Some("rs".into());
    assert_eq!(run(&t, p).unwrap().definitions.len(), 0);
    let mut p = params("greet");
    p.lang = Some("typescript".into());
    assert_eq!(run(&t, p).unwrap().definitions.len(), 1);
    let mut p = params("greet");
    p.lang = Some("cobol".into());
    assert_eq!(
        run(&t, p).unwrap_err().code(),
        "hx.pack.unsupported_language"
    );
    let mut p = params("x");
    p.path = Some("missing.rs".into());
    assert_eq!(run(&t, p).unwrap_err().code(), "hx.pack.not_found");
}

#[test]
fn a_name_that_is_only_a_substring_or_a_local_is_not_a_match() {
    let t = tree();
    assert!(run(&t, params("distanc")).unwrap().definitions.is_empty());
    assert!(
        run(&t, params("square")).unwrap().definitions.is_empty(),
        "locals are not outlined"
    );
    assert!(
        run(&t, params("nothing_here"))
            .unwrap()
            .definitions
            .is_empty()
    );
    assert_eq!(
        run(&t, params("")).unwrap_err().code(),
        "hx.pack.invalid_request"
    );
}

#[test]
fn secrets_inside_a_definition_are_redacted() {
    let t = Tree::new();
    t.write(
        "a.py",
        "def connect():\n    token = \"sk-ant-api03-abcdefghijklmnopqrstuv\"\n    return token\n",
    );
    let r = run(&t, params("connect")).unwrap();
    assert!(r.definitions[0].text.contains("[REDACTED:anthropic_key]"));
    assert!(!r.definitions[0].text.contains("abcdefghij"));
    assert_eq!(r.redactions.total, 1);
}

#[test]
fn definition_and_byte_limits() {
    let t = Tree::new();
    // Ten files each define `dup`; the cap stops after three, in path order.
    for i in 0..10 {
        t.write(&format!("m{i}.py"), "def dup():\n    return 1\n");
    }
    let mut p = params("dup");
    p.max_definitions = 3;
    let r = run(&t, p).unwrap();
    assert_eq!(
        r.definitions
            .iter()
            .map(|d| d.path.as_str())
            .collect::<Vec<_>>(),
        ["m0.py", "m1.py", "m2.py"]
    );
    assert!(r.truncated.contains(&Truncation::MaxItems));
    let t = Tree::new();
    t.write(
        "big.py",
        &format!("def big():\n{}", "    x = 1\n".repeat(200)),
    );
    let mut p = params("big");
    p.max_bytes = Some(300);
    let r = run(&t, p).unwrap();
    assert!(r.bytes <= 300 && r.truncated.contains(&Truncation::MaxBytes));
    let d = &r.definitions[0];
    assert!(d.end_line < 201 && d.text.lines().count() as u32 == d.end_line - d.start_line + 1);
}

#[test]
fn never_packed_files_are_withheld_by_symbol_too() {
    let t = Tree::new();
    t.write("server.key", "def leak(): pass\n");
    let mut p = params("leak");
    p.path = Some("server.key".into());
    let r = run(&t, p).unwrap();
    assert!(r.definitions.is_empty() && r.withheld.count == 1);
}
