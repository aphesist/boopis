//! Safe paths under a root (`docs/STANDARDS.md` section 5).
//!
//! A [`Root`] holds a capability handle to the root directory. Every file the
//! crate reads is opened through it with [`cap_std`], which refuses `..`,
//! absolute paths and symlinks that leave the directory. A [`RelPath`] is a
//! path that has already been checked lexically, so the two layers back each
//! other up. This is a local copy of what `hx-txn::paths` will provide; fold
//! it into that module when the crates meet.

use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, File};

use crate::error::{Error, Result};

/// A relative path with `/` separators, no `.`, no `..`, no empty parts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RelPath(String);

impl RelPath {
    /// The root itself (the empty path).
    #[must_use]
    pub fn root() -> Self {
        Self(String::new())
    }

    /// Checks and normalises `raw`.
    ///
    /// # Errors
    /// [`Error::PathEscape`] for absolute paths, drive prefixes, `..` and NUL bytes.
    pub fn parse(raw: &str) -> Result<Self> {
        let escape = || Error::PathEscape(raw.escape_debug().to_string());
        if raw.contains('\0') || raw.starts_with('/') || raw.starts_with('\\') {
            return Err(escape());
        }
        let bytes = raw.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return Err(escape());
        }
        let mut parts: Vec<&str> = Vec::new();
        for comp in Path::new(raw).components() {
            match comp {
                Component::Normal(s) => parts.push(s.to_str().ok_or_else(escape)?),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(escape());
                }
            }
        }
        // A backslash is a separator on Windows and a legal name byte elsewhere.
        // Refusing `..` hidden behind one keeps the answer the same everywhere.
        if parts.iter().any(|p| p.split('\\').any(|q| q == "..")) {
            return Err(escape());
        }
        Ok(Self(parts.join("/")))
    }

    /// The path as `/`-separated text. Empty for the root.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether this is the root.
    #[must_use]
    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    /// The last component.
    #[must_use]
    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or("")
    }

    /// The extension of the last component, without the dot.
    #[must_use]
    pub fn extension(&self) -> Option<&str> {
        let name = self.file_name();
        let (stem, ext) = name.rsplit_once('.')?;
        (!stem.is_empty() && !ext.is_empty()).then_some(ext)
    }
}

impl fmt::Display for RelPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A directory that all reads are confined to.
#[derive(Debug)]
pub struct Root {
    dir: Dir,
    path: PathBuf,
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

    /// Opens a file under the root. Symlinks are followed only while they
    /// stay inside it.
    ///
    /// # Errors
    /// [`Error::PathEscape`], [`Error::NotFound`] or [`Error::Io`].
    pub fn open_file(&self, rel: &RelPath) -> Result<File> {
        self.dir
            .open(rel.as_str())
            .map_err(|e| map_open_error(rel, e))
    }

    /// Whether `rel` is a directory inside the root (following inner symlinks).
    ///
    /// # Errors
    /// [`Error::PathEscape`], [`Error::NotFound`] or [`Error::Io`].
    pub fn is_dir(&self, rel: &RelPath) -> Result<bool> {
        if rel.is_root() {
            return Ok(true);
        }
        self.dir
            .metadata(rel.as_str())
            .map(|m| m.is_dir())
            .map_err(|e| map_open_error(rel, e))
    }

    /// Whether `rel` is a regular file inside the root.
    ///
    /// # Errors
    /// As [`Root::is_dir`].
    pub fn is_file(&self, rel: &RelPath) -> Result<bool> {
        if rel.is_root() {
            return Ok(false);
        }
        self.dir
            .metadata(rel.as_str())
            .map(|m| m.is_file())
            .map_err(|e| map_open_error(rel, e))
    }

    /// The absolute path of `rel` for walking. Call [`Root::is_dir`] first.
    pub(crate) fn abs(&self, rel: &RelPath) -> PathBuf {
        if rel.is_root() {
            self.path.clone()
        } else {
            self.path.join(rel.as_str())
        }
    }
}

fn map_open_error(rel: &RelPath, e: io::Error) -> Error {
    match e.kind() {
        // cap-std reports a path that leaves the directory as a synthetic
        // PermissionDenied (no OS error number); a real EACCES carries one.
        io::ErrorKind::PermissionDenied if e.raw_os_error().is_none() => {
            Error::PathEscape(rel.to_string())
        }
        _ => Error::from_io(rel.as_str(), e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_normalises_and_rejects() {
        assert_eq!(RelPath::parse("a//b/./c").unwrap().as_str(), "a/b/c");
        assert!(RelPath::parse("").unwrap().is_root());
        assert!(RelPath::parse(".").unwrap().is_root());
        for bad in [
            "/a", "a/../b", "..", "a/..", "\\a", "C:x", "a\0", "a\\..\\b",
        ] {
            assert!(RelPath::parse(bad).is_err(), "{bad:?}");
        }
        assert!(
            RelPath::parse("a..b/...").is_ok(),
            "dots inside names are fine"
        );
    }

    #[test]
    fn name_and_extension() {
        let p = RelPath::parse("src/lib.rs").unwrap();
        assert_eq!((p.file_name(), p.extension()), ("lib.rs", Some("rs")));
        assert_eq!(RelPath::parse(".env").unwrap().extension(), None);
        assert_eq!(RelPath::parse("a/Makefile").unwrap().extension(), None);
        assert_eq!(RelPath::parse("a.tar.gz").unwrap().extension(), Some("gz"));
    }

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
}
