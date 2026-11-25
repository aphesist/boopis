//! Shared helpers for the integration tests: workspace fixtures and tree snapshots.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![allow(dead_code)] // Each test binary uses a different subset.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use hx_proto::txn::{ApplyParams, Edit, JournalRef};
use hx_txn::Engine;
use tokio_util::sync::CancellationToken;

/// One node of a snapshot. Directory mtimes are not compared: creating and removing temp files
/// moves them, and the journal does not claim to restore them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    File {
        bytes: Vec<u8>,
        mode: u32,
        mtime_ns: u128,
    },
    Dir {
        mode: u32,
    },
    Symlink {
        target: String,
    },
}

pub type Snapshot = BTreeMap<String, Node>;

#[cfg(unix)]
fn mode_of(md: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    md.permissions().mode() & 0o7777
}
#[cfg(not(unix))]
fn mode_of(_: &fs::Metadata) -> u32 {
    0
}

pub fn snapshot(root: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    walk(root, root, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Snapshot) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let md = fs::symlink_metadata(&path).unwrap();
        if md.file_type().is_symlink() {
            let target = fs::read_link(&path).unwrap().to_string_lossy().into_owned();
            out.insert(rel, Node::Symlink { target });
        } else if md.is_dir() {
            out.insert(rel, Node::Dir { mode: mode_of(&md) });
            walk(root, &path, out);
        } else {
            let mtime_ns = md
                .modified()
                .unwrap()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            out.insert(
                rel,
                Node::File {
                    bytes: fs::read(&path).unwrap(),
                    mode: mode_of(&md),
                    mtime_ns,
                },
            );
        }
    }
}

/// Writes a file, creating parents, and gives it a distinctive old mtime so that restoring the
/// mtime is observable.
pub fn put(root: &Path, rel: &str, content: &str, mode: u32) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, content).unwrap();
    // The time first, the mode last: a file made read-only (0o444) cannot be opened for writing by
    // an ordinary user (root ignores modes, which is how this passed in a root container).
    let seed = rel.bytes().map(u64::from).sum::<u64>();
    let f = fs::File::options().write(true).open(&path).unwrap();
    f.set_modified(UNIX_EPOCH + Duration::new(1_600_000_000 + seed, 123_456_789))
        .unwrap();
    drop(f);
    set_mode(&path, mode);
}

#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}
#[cfg(not(unix))]
pub fn set_mode(_: &Path, _: u32) {}

pub struct Fixture {
    pub _tmp: tempfile::TempDir,
    pub root: std::path::PathBuf,
    pub journals: std::path::PathBuf,
    pub outside: std::path::PathBuf,
}

/// A workspace `root`, a journal directory and an `outside` directory, all siblings.
pub fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let base = fs::canonicalize(tmp.path()).unwrap();
    let root = base.join("ws");
    let outside = base.join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    Fixture {
        journals: base.join("journals"),
        root,
        outside,
        _tmp: tmp,
    }
}

impl Fixture {
    pub fn apply_params(&self, edits: Vec<Edit>) -> ApplyParams {
        ApplyParams {
            root: self.root.to_string_lossy().into_owned(),
            journal_dir: self.journals.to_string_lossy().into_owned(),
            edits,
            allowed: None,
            protected: Some(vec![]),
        }
    }

    pub fn journal_ref(&self, id: &str) -> JournalRef {
        JournalRef {
            journal_dir: self.journals.to_string_lossy().into_owned(),
            journal_id: id.to_owned(),
            root: Some(self.root.to_string_lossy().into_owned()),
        }
    }

    pub fn journal_entries(&self) -> Vec<String> {
        match fs::read_dir(&self.journals) {
            Ok(rd) => rd
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| !n.starts_with(".workspace-"))
                .collect(),
            Err(_) => Vec::new(),
        }
    }
}

pub fn engine() -> Engine {
    Engine::new()
}

pub fn never() -> CancellationToken {
    CancellationToken::new()
}

pub fn replace(path: &str, old: &str, new: &str) -> Edit {
    Edit::Replace {
        path: path.into(),
        old: old.into(),
        new: new.into(),
        replace_all: false,
    }
}

pub fn create(path: &str, content: &str) -> Edit {
    Edit::Create {
        path: path.into(),
        content: content.into(),
        overwrite: false,
    }
}

pub fn delete(path: &str) -> Edit {
    Edit::Delete {
        path: path.into(),
        expect_sha256: None,
    }
}
