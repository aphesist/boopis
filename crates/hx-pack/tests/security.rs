//! Path discipline: nothing outside the root is ever read.
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

use std::fs;
use std::os::unix::fs::symlink;

use common::Tree;
use hx_pack::{
    OutlineParams, OutlineRequest, ReadParams, ReadRequest, RelPath, SearchParams, SearchRequest,
    SymbolParams, SymbolRequest, handle_outline, handle_read, handle_search, handle_symbol,
};

const SECRET: &str = "OUTSIDE_SECRET_VALUE";

/// `parent/outside.txt` holds the secret; `parent/root` is the root.
struct Jail {
    parent: Tree,
}

impl Jail {
    fn new() -> Self {
        let parent = Tree::new();
        parent.write("outside.txt", &format!("{SECRET}\n"));
        parent.write(
            "outside_dir/secret.rs",
            &format!("fn leak() {{ let _ = \"{SECRET}\"; }}\n"),
        );
        parent.write("root/inside.txt", "inside\n");
        parent.write("root/sub/deep.rs", "fn deep() {}\n");
        Self { parent }
    }

    fn root(&self) -> String {
        self.parent.path().join("root").to_str().unwrap().to_owned()
    }

    fn link(&self, name: &str, target: &str) {
        symlink(target, self.parent.path().join("root").join(name)).unwrap();
    }

    fn read(&self, path: &str) -> hx_pack::Result<hx_pack::ReadResponse> {
        handle_read(&ReadRequest {
            root: self.root(),
            params: ReadParams {
                path: path.into(),
                ranges: vec![],
                max_bytes: None,
                walk: Default::default(),
            },
        })
    }
}

#[test]
fn lexical_escapes_are_rejected() {
    let j = Jail::new();
    for p in [
        "../outside.txt",
        "sub/../../outside.txt",
        "/etc/passwd",
        "..",
        "sub/..\\..\\outside.txt",
        "a\0b",
        "C:\\Windows\\win.ini",
        "\\\\host\\share",
    ] {
        let e = j.read(p).unwrap_err();
        assert_eq!(e.code(), "hx.pack.path_escape", "{p:?}");
    }
    assert!(RelPath::parse("./sub//deep.rs").is_ok());
    assert_eq!(
        RelPath::parse("./sub//deep.rs").unwrap().as_str(),
        "sub/deep.rs"
    );
}

#[test]
fn symlinks_that_leave_the_root_are_refused() {
    let j = Jail::new();
    j.link("file_link", "../outside.txt");
    j.link("dir_link", "../outside_dir");
    j.link(
        "abs_link",
        &j.parent.path().join("outside.txt").to_string_lossy(),
    );
    for p in ["file_link", "abs_link", "dir_link/secret.rs"] {
        let e = j.read(p).unwrap_err();
        assert_eq!(e.code(), "hx.pack.path_escape", "{p}");
    }
}

#[test]
fn symlinks_that_stay_inside_are_followed_when_named() {
    let j = Jail::new();
    j.link("ok_link", "inside.txt");
    let r = j.read("ok_link").unwrap();
    assert!(r.segments[0].text.contains("inside"));
}

#[test]
fn walks_do_not_follow_symlinks() {
    let j = Jail::new();
    j.link("file_link", "../outside.txt");
    j.link("dir_link", "../outside_dir");
    j.link("inner_dir_link", "sub");
    let s = handle_search(&SearchRequest {
        root: j.root(),
        params: SearchParams::new(SECRET),
    })
    .unwrap();
    assert!(s.blocks.is_empty());
    // Not even the in-root directory link is walked: each file is listed once, by its real path.
    let s = handle_search(&SearchRequest {
        root: j.root(),
        params: SearchParams::new("fn deep"),
    })
    .unwrap();
    assert_eq!(s.blocks.len(), 1);
    assert_eq!(s.blocks[0].path, "sub/deep.rs");
    let o = handle_outline(&OutlineRequest {
        root: j.root(),
        params: OutlineParams {
            paths: vec![],
            max_bytes: None,
            max_files: 50,
            walk: Default::default(),
        },
    })
    .unwrap();
    assert!(o.files.iter().all(|f| !f.path.contains("outside")));
}

#[test]
fn escapes_are_rejected_by_every_method() {
    let j = Jail::new();
    j.link("dir_link", "../outside_dir");
    let o = handle_outline(&OutlineRequest {
        root: j.root(),
        params: OutlineParams {
            paths: vec!["dir_link".into()],
            max_bytes: None,
            max_files: 5,
            walk: Default::default(),
        },
    });
    assert_eq!(o.unwrap_err().code(), "hx.pack.path_escape");
    let o = handle_outline(&OutlineRequest {
        root: j.root(),
        params: OutlineParams {
            paths: vec!["../outside_dir".into()],
            max_bytes: None,
            max_files: 5,
            walk: Default::default(),
        },
    });
    assert_eq!(o.unwrap_err().code(), "hx.pack.path_escape");
    for path in ["../outside_dir", "dir_link"] {
        let s = handle_symbol(&SymbolRequest {
            root: j.root(),
            params: SymbolParams {
                name: "leak".into(),
                path: Some(path.into()),
                lang: None,
                max_definitions: 5,
                max_bytes: None,
                walk: Default::default(),
            },
        });
        assert_eq!(s.unwrap_err().code(), "hx.pack.path_escape", "{path}");
    }
    let mut p = SearchParams::new("x");
    p.globs = vec!["../outside_dir/*.rs".into()];
    assert_eq!(
        handle_search(&SearchRequest {
            root: j.root(),
            params: p
        })
        .unwrap_err()
        .code(),
        "hx.pack.path_escape"
    );
}

#[test]
fn the_root_itself_may_be_a_symlink() {
    let j = Jail::new();
    let link = j.parent.path().join("rootlink");
    symlink(j.parent.path().join("root"), &link).unwrap();
    let s = handle_search(&SearchRequest {
        root: link.to_str().unwrap().into(),
        params: SearchParams::new("inside"),
    })
    .unwrap();
    assert_eq!(s.blocks.len(), 1);
    assert!(fs::metadata(&link).is_ok());
}
