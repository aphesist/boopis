//! The root directory handle, and the bridge to the shared safe-path module.
//!
//! Path parsing and symlink resolution live in `hx_txn::paths` (one implementation per
//! concern, `docs/STANDARDS.md` section 9). This module adds what pack needs on top: a
//! `cap-std` directory handle to open files through, and the mapping of path errors to
//! pack's `hx.pack.*` codes. Paths inside the crate are `/`-separated strings relative to
//! the root; the empty string is the root itself.
//!
//! A request's path goes through [`Root::target`], which parses it, resolves inner symlinks
//! and rejects anything that leaves the root. It returns the *canonical* path, so the
//! never-pack check sees the real file even when a request names it through a link. Paths
//! found by a walk come from the file system and cannot hold `..`; they are opened through
//! the same handle, which refuses to leave the root.

use std::io;
use std::path::{Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, File};
use hx_txn::paths::{self, Kind, PathError, RelPath};

use crate::error::{Error, Result};

/// A directory that all reads are confined to.
#[derive(Debug)]
pub struct Root {
    dir: Dir,
    path: PathBuf,
}

/// A request path after parsing and symlink resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    /// Canonical path relative to the root; empty for the root.
    pub rel: String,
    /// What it is.
    pub kind: Kind,
}

impl Target {
    pub(crate) fn is_dir(&self) -> bool {
        self.kind == Kind::Dir
    }

    pub(crate) fn is_file(&self) -> bool {
        self.kind == Kind::File
    }
}

impl Root {
    /// Opens `path` as a root.
    ///
    /// # Errors
    /// [`Error::InvalidRoot`] when `path` is not an existing directory.
    pub fn open(path: &str) -> Result<Self> {
        if path.is_empty() || path.contains('\0') {
            return Err(Error::InvalidRoot(path.to_owned()));
        }
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|_| Error::InvalidRoot(path.to_owned()))?;
        let dir = Dir::open_ambient_dir(&canonical, ambient_authority())
            .map_err(|_| Error::InvalidRoot(path.to_owned()))?;
        Ok(Self {
            dir,
            path: canonical,
        })
    }

    /// The canonical path of the root, for walking and for `git`.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Parses and resolves a path named by a request.
    ///
    /// An empty path, `.` and a link that resolves to the root all mean the root.
    ///
    /// # Errors
    /// [`Error::PathEscape`] for absolute paths, `..`, NUL and symlinks leaving the root;
    /// [`Error::NotFound`] when nothing is there.
    pub(crate) fn target(&self, raw: &str) -> Result<Target> {
        let rel = match RelPath::parse(raw) {
            Ok(rel) => rel,
            Err(PathError::Empty) => return Ok(Self::root_target()),
            Err(e) => return Err(map_path_error(raw, e)),
        };
        let resolved = match paths::resolve(&self.dir, &rel, true) {
            Ok(r) => r,
            Err(PathError::Empty) => return Ok(Self::root_target()),
            Err(e) => return Err(map_path_error(raw, e)),
        };
        if !resolved.exists() {
            return Err(Error::NotFound(raw.to_owned()));
        }
        Ok(Target {
            rel: resolved.to_wire(),
            kind: resolved.kind.unwrap_or(Kind::Other),
        })
    }

    fn root_target() -> Target {
        Target {
            rel: String::new(),
            kind: Kind::Dir,
        }
    }

    /// Like [`Root::target`], but a missing path is `None` rather than an error.
    pub(crate) fn target_if_exists(&self, raw: &str) -> Result<Option<Target>> {
        match self.target(raw) {
            Ok(t) => Ok(Some(t)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Opens a file under the root. `rel` is a clean relative path (from [`Root::target`]
    /// or from a walk). The handle refuses to leave the root even if `rel` was tampered with.
    ///
    /// # Errors
    /// [`Error::PathEscape`], [`Error::NotFound`] or [`Error::Io`].
    pub(crate) fn open_file(&self, rel: &str) -> Result<File> {
        self.dir.open(rel).map_err(|e| map_open_error(rel, e))
    }

    /// The modification time of `rel` (a directory or file), `None` if it is gone.
    pub(crate) fn modified(&self, rel: &str) -> Option<std::time::SystemTime> {
        let md = if rel.is_empty() {
            self.dir.dir_metadata()
        } else {
            self.dir.symlink_metadata(rel)
        };
        md.ok()?
            .modified()
            .ok()
            .map(cap_std::time::SystemTime::into_std)
    }

    /// The absolute path of `rel` for walking.
    pub(crate) fn abs(&self, rel: &str) -> PathBuf {
        if rel.is_empty() {
            self.path.clone()
        } else {
            self.path.join(rel)
        }
    }
}

fn map_path_error(raw: &str, e: PathError) -> Error {
    match e {
        PathError::SymlinkLoop => Error::InvalidRequest(format!("too many symlinks in {raw:?}")),
        PathError::NotADirectory(p) => Error::NotFound(p),
        PathError::Io { path, message } => Error::Io {
            path,
            source: io::Error::other(message),
        },
        // Empty is handled by the caller; the rest all mean the path is not allowed.
        _ => Error::PathEscape(raw.escape_debug().to_string()),
    }
}

fn map_open_error(rel: &str, e: io::Error) -> Error {
    match e.kind() {
        // cap-std reports a path that leaves the directory as a synthetic
        // PermissionDenied (no OS error number); a real EACCES carries one.
        io::ErrorKind::PermissionDenied if e.raw_os_error().is_none() => {
            Error::PathEscape(rel.to_owned())
        }
        _ => Error::from_io(rel, e),
    }
}

/// The last component of a `/`-separated path.
pub(crate) fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or("")
}

/// The extension of the last component, without the dot. A leading dot is not one.
pub(crate) fn extension(path: &str) -> Option<&str> {
    let (stem, ext) = file_name(path).rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then_some(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_requires_an_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Root::open(dir.path().to_str().unwrap()).is_ok());
        assert_eq!(Root::open("").unwrap_err().code(), "hx.pack.invalid_root");
        let file = dir.path().join("f");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            Root::open(file.to_str().unwrap()).unwrap_err().code(),
            "hx.pack.invalid_root"
        );
        assert_eq!(
            Root::open("/no/such/dir").unwrap_err().code(),
            "hx.pack.invalid_root"
        );
    }

    #[test]
    fn targets_are_canonical_and_confined() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("real")).unwrap();
        std::fs::write(dir.path().join("real/a.txt"), "x").unwrap();
        std::os::unix::fs::symlink("real", dir.path().join("alias")).unwrap();
        std::os::unix::fs::symlink(".", dir.path().join("self")).unwrap();
        let root = Root::open(dir.path().to_str().unwrap()).unwrap();
        let t = root.target("./alias//a.txt").unwrap();
        assert_eq!(t.rel, "real/a.txt");
        assert!(t.is_file() && !t.is_dir());
        for raw in ["", ".", "./", "self"] {
            let t = root.target(raw).unwrap();
            assert!(t.rel.is_empty() && t.is_dir(), "{raw:?}");
        }
        assert_eq!(root.target("nope").unwrap_err().code(), "hx.pack.not_found");
        assert!(root.target_if_exists("nope").unwrap().is_none());
        for bad in ["/etc/passwd", "../x", "a/..", "a\0b", "\\\\h\\s"] {
            assert_eq!(
                root.target(bad).unwrap_err().code(),
                "hx.pack.path_escape",
                "{bad:?}"
            );
        }
    }

    #[test]
    fn name_and_extension() {
        assert_eq!(
            (file_name("src/lib.rs"), extension("src/lib.rs")),
            ("lib.rs", Some("rs"))
        );
        assert_eq!(extension(".env"), None);
        assert_eq!(extension("a/Makefile"), None);
        assert_eq!(extension("a.tar.gz"), Some("gz"));
    }
}
