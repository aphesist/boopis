//! Helpers shared by the integration tests.
#![allow(dead_code)] // each test binary uses a different subset

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

/// A temporary tree under which tests create files.
pub struct Tree {
    dir: TempDir,
}

impl Tree {
    pub fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
        }
    }

    pub fn root(&self) -> &str {
        self.dir.path().to_str().unwrap()
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn write(&self, rel: &str, content: &str) -> PathBuf {
        let p = self.dir.path().join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, content).unwrap();
        p
    }

    pub fn write_bytes(&self, rel: &str, content: &[u8]) {
        let p = self.dir.path().join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    /// Copies a fixture file from `tests/fixtures`.
    pub fn fixture(&self, from: &str, to: &str) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(from);
        self.write(to, &fs::read_to_string(src).unwrap());
    }
}

pub fn fixture_text(rel: &str) -> String {
    let src = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel);
    fs::read_to_string(src).unwrap()
}
