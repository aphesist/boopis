//! Safe paths: the one place workspace-relative paths are parsed and resolved.
//!
//! Every access to the workspace goes through a [`cap_std::fs::Dir`] opened on the root, so the
//! kernel refuses any path that leaves it. On top of that, [`resolve`] walks the path one
//! component at a time, following symlinks itself, so that:
//!
//! - a symlink that escapes the root is reported as [`PathError::Escape`] (the audit's
//!   `link/pwned.txt` case);
//! - two spellings of one file (`a/link/x` and `a/real/x`) resolve to one canonical path, so a
//!   transaction never treats them as two files;
//! - scope and protected globs are checked against the real target, not just the spelling.
//!
//! Hard links are out of scope: an atomic rename gives the edited path a new inode and leaves
//! other links to the old one unchanged.

use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};

use cap_std::fs::Dir;

/// How many symlinks one resolution may follow before it gives up.
pub const MAX_SYMLINK_HOPS: usize = 40;

/// Why a path was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum PathError {
    /// The path is empty or names the root itself.
    #[error("the path is empty")]
    Empty,
    /// The path is absolute or has a drive prefix.
    #[error("absolute paths are not allowed")]
    Absolute,
    /// The path contains a `..` segment.
    #[error("`..` segments are not allowed")]
    ParentDir,
    /// A segment holds a character no workspace path may contain.
    #[error("the path contains an invalid character")]
    InvalidChar,
    /// A segment that Windows resolves to another name: a trailing dot or space, an 8.3 short
    /// name (`GIT~1`) or a device name (`NUL`, `COM1`). Refused on every platform, so a
    /// repository cannot carry one anywhere.
    #[error(
        "`{0}` can alias another file on Windows (trailing dot or space, 8.3 name or device name)"
    )]
    WindowsAlias(String),
    /// A symlink or `..` inside a symlink target leads outside the workspace.
    #[error("the path leaves the workspace through `{0}`")]
    Escape(String),
    /// Too many symlinks, probably a loop.
    #[error("too many levels of symbolic links")]
    SymlinkLoop,
    /// A parent component exists and is not a directory.
    #[error("`{0}` is not a directory")]
    NotADirectory(String),
    /// The file system refused to answer.
    #[error("cannot inspect `{path}`: {message}")]
    Io {
        /// The path being inspected.
        path: String,
        /// The operating system's message.
        message: String,
    },
}

/// A lexically clean, workspace-relative path: no `.`, no `..`, no empty segments.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RelPath {
    components: Vec<String>,
}

impl RelPath {
    /// Parses a wire path. Segments are separated by `/`.
    ///
    /// # Errors
    /// Empty, absolute, `..`, backslash, NUL, or (on Windows) a `:` in a segment.
    pub fn parse(raw: &str) -> Result<Self, PathError> {
        if raw.starts_with('/') || raw.starts_with('\\') {
            return Err(PathError::Absolute);
        }
        let mut components = Vec::new();
        for seg in raw.split('/') {
            match seg {
                "" | "." => {}
                ".." => return Err(PathError::ParentDir),
                s if s.contains(['\\', '\0']) => return Err(PathError::InvalidChar),
                s if cfg!(windows) && s.contains(':') => return Err(PathError::Absolute),
                s => components.push(s.to_owned()),
            }
        }
        if components.is_empty() {
            return Err(PathError::Empty);
        }
        Ok(Self { components })
    }

    /// [`RelPath::parse`], and no segment may be a Windows alias ([`check_segment`]). The path of
    /// anything a transaction writes, deletes or restores goes through this one; reads keep
    /// [`RelPath::parse`], because a Linux tree may hold an `aux.c` that is fine to read.
    ///
    /// # Errors
    /// As [`RelPath::parse`], plus [`PathError::WindowsAlias`].
    pub fn parse_for_write(raw: &str) -> Result<Self, PathError> {
        let rel = Self::parse(raw)?;
        rel.components.iter().try_for_each(|s| check_segment(s))?;
        Ok(rel)
    }

    /// The segments.
    #[must_use]
    pub fn components(&self) -> &[String] {
        &self.components
    }

    /// The `/`-joined form, used for globs and on the wire.
    #[must_use]
    pub fn to_wire(&self) -> String {
        self.components.join("/")
    }
}

/// Windows device names that stand alone. `COM` and `LPT` take a digit, see [`is_device_name`].
const DEVICE_NAMES: &[&str] = &["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];

/// Whether the part of `segment` before its first dot is a Windows device name, ignoring case
/// (`nul.txt` is `NUL`). `COM1` to `COM9` and `LPT1` to `LPT9` also take the superscript digits
/// Windows reserves.
fn is_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment).to_uppercase();
    if DEVICE_NAMES.contains(&stem.as_str()) {
        return true;
    }
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix).is_some_and(|rest| {
            let mut digits = rest.chars();
            matches!(
                (digits.next(), digits.next()),
                (Some('1'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'), None)
            )
        })
    };
    numbered("COM") || numbered("LPT")
}

/// Rejects a path segment that Windows would resolve to a different name, whatever the platform
/// the path is checked on: a repository cannot carry one to a Windows machine through here.
///
/// - a trailing `.` or space (Windows strips it, so `.git.` is `.git`);
/// - a `~` followed by a digit (an 8.3 short name such as `GIT~1`);
/// - a device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`) with any
///   extension.
///
/// # Errors
/// [`PathError::WindowsAlias`].
pub fn check_segment(segment: &str) -> Result<(), PathError> {
    let short_name = segment
        .match_indices('~')
        .any(|(i, _)| segment[i + 1..].starts_with(|c: char| c.is_ascii_digit()));
    if segment.ends_with(['.', ' ']) || short_name || is_device_name(segment) {
        Err(PathError::WindowsAlias(segment.to_owned()))
    } else {
        Ok(())
    }
}

/// What lives at the end of a resolved path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A regular file.
    File,
    /// A directory.
    Dir,
    /// A symbolic link (only when the final component was not followed).
    Symlink,
    /// A socket, device or FIFO.
    Other,
}

/// A path resolved inside the workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// The canonical components: no symlinks left, except possibly the final one.
    pub components: Vec<String>,
    /// How many leading components exist. Equal to `components.len()` when the path exists.
    pub existing: usize,
    /// The kind of the final component, when it exists.
    pub kind: Option<Kind>,
}

impl Resolved {
    /// The canonical `/`-joined path.
    #[must_use]
    pub fn to_wire(&self) -> String {
        self.components.join("/")
    }

    /// The path as a [`PathBuf`] for use with a [`Dir`].
    #[must_use]
    pub fn to_path(&self) -> PathBuf {
        self.components.iter().collect()
    }

    /// [`check_segment`] on every canonical component: a symlink's target can bring in a name the
    /// request did not spell.
    ///
    /// # Errors
    /// [`PathError::WindowsAlias`].
    pub fn check_for_write(&self) -> Result<(), PathError> {
        self.components.iter().try_for_each(|s| check_segment(s))
    }

    /// Whether the final component exists.
    #[must_use]
    pub fn exists(&self) -> bool {
        self.existing == self.components.len()
    }

    /// Ancestor directories above the final component that do not exist yet, shallowest first.
    #[must_use]
    pub fn missing_dirs(&self) -> Vec<String> {
        let last = self.components.len().saturating_sub(1);
        (self.existing.min(last)..last)
            .map(|i| self.components[..=i].join("/"))
            .collect()
    }
}

/// Resolves `rel` inside `root`, following symlinks that stay inside it.
///
/// With `follow_final` false the last component is not followed: it names a symlink itself
/// (used by delete). Components that do not exist yet are accepted, so a path can name a file
/// to create.
///
/// # Errors
/// See [`PathError`].
pub fn resolve(root: &Dir, rel: &RelPath, follow_final: bool) -> Result<Resolved, PathError> {
    let mut pending: VecDeque<String> = rel.components().iter().cloned().collect();
    let mut done: Vec<String> = Vec::new();
    let mut missing = false;
    let mut existing = 0usize;
    let mut kind = None;
    let mut hops = 0usize;

    while let Some(seg) = pending.pop_front() {
        if seg == "." {
            continue;
        }
        if seg == ".." {
            // Only a symlink target can bring a `..` here; the lexical path had none.
            if done.pop().is_none() {
                return Err(PathError::Escape(rel.to_wire()));
            }
            existing = existing.min(done.len());
            missing = existing < done.len();
            kind = Some(Kind::Dir);
            continue;
        }
        if missing {
            done.push(seg);
            continue;
        }
        let is_last = pending.is_empty();
        let candidate: PathBuf = done.iter().chain(std::iter::once(&seg)).collect();
        match root.symlink_metadata(&candidate) {
            Ok(md) if md.file_type().is_symlink() && (!is_last || follow_final) => {
                hops += 1;
                if hops > MAX_SYMLINK_HOPS {
                    return Err(PathError::SymlinkLoop);
                }
                let target = root
                    .read_link_contents(&candidate)
                    .map_err(|e| io_err(&candidate, &e))?;
                for part in target_components(&target, &candidate)?.into_iter().rev() {
                    pending.push_front(part);
                }
            }
            Ok(md) => {
                if !is_last && !md.is_dir() {
                    return Err(PathError::NotADirectory(candidate.display().to_string()));
                }
                done.push(seg);
                existing = done.len();
                kind = Some(kind_of(&md));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                missing = true;
                kind = None;
                done.push(seg);
            }
            Err(e) => return Err(io_err(&candidate, &e)),
        }
    }
    if done.is_empty() {
        return Err(PathError::Empty);
    }
    if missing {
        kind = None;
    }
    Ok(Resolved {
        components: done,
        existing,
        kind,
    })
}

fn target_components(target: &Path, link: &Path) -> Result<Vec<String>, PathError> {
    let mut out = Vec::new();
    for c in target.components() {
        match c {
            Component::Normal(s) => out.push(s.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => out.push("..".to_owned()),
            Component::RootDir | Component::Prefix(_) => {
                return Err(PathError::Escape(link.display().to_string()));
            }
        }
    }
    Ok(out)
}

fn kind_of(md: &cap_std::fs::Metadata) -> Kind {
    let ft = md.file_type();
    if ft.is_symlink() {
        Kind::Symlink
    } else if ft.is_dir() {
        Kind::Dir
    } else if ft.is_file() {
        Kind::File
    } else {
        Kind::Other
    }
}

fn io_err(path: &Path, e: &std::io::Error) -> PathError {
    PathError::Io {
        path: path.display().to_string(),
        message: e.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;

    fn open(dir: &Path) -> Dir {
        Dir::open_ambient_dir(dir, ambient_authority()).unwrap()
    }

    #[test]
    fn parse_normalises_and_rejects() {
        assert_eq!(
            RelPath::parse("./a//b/./c.txt").unwrap().to_wire(),
            "a/b/c.txt"
        );
        assert_eq!(RelPath::parse(""), Err(PathError::Empty));
        assert_eq!(RelPath::parse("./."), Err(PathError::Empty));
        assert_eq!(RelPath::parse("/etc/passwd"), Err(PathError::Absolute));
        assert_eq!(RelPath::parse("\\\\server\\x"), Err(PathError::Absolute));
        assert_eq!(RelPath::parse("a/../b"), Err(PathError::ParentDir));
        assert_eq!(RelPath::parse(".."), Err(PathError::ParentDir));
        assert_eq!(RelPath::parse("a\\b"), Err(PathError::InvalidChar));
        assert_eq!(RelPath::parse("a\0b"), Err(PathError::InvalidChar));
    }

    #[test]
    fn windows_aliases_are_refused_on_every_platform() {
        let alias =
            |p: &str| matches!(RelPath::parse_for_write(p), Err(PathError::WindowsAlias(_)));
        // Trailing dot or space: Windows strips them, so these name `.git` and `a`.
        for p in [".git.", ".git ", "a/b. ", "a. /b", "x/.git..", "c "] {
            assert!(alias(p), "{p:?}");
        }
        // 8.3 short names.
        for p in [
            "GIT~1",
            "git~1/hooks/pre-commit",
            "PROGRA~1/x",
            "a/B~2.TXT",
            "~1",
        ] {
            assert!(alias(p), "{p:?}");
        }
        // Device names, any case, any extension.
        for p in [
            "CON",
            "con",
            "Prn",
            "AUX",
            "nul",
            "NUL.txt",
            "a/nul.tar.gz",
            "COM1",
            "com9.log",
            "LPT1",
            "lpt9.x",
            "CONIN$",
            "conout$",
            "COM\u{b9}",
            "lpt\u{b2}.txt",
        ] {
            assert!(alias(p), "{p:?}");
        }
        // Ordinary names that only look close.
        for p in [
            "COM",
            "COM0",
            "COM10",
            "LPT0",
            "console.log",
            "nullable.rs",
            "auxiliary",
            "a~b",
            "tilde~",
            "~backup",
            "x.git",
            ".gitignore",
            "...a",
            "a.b",
            "NUL_x",
            "communication.txt",
        ] {
            assert!(RelPath::parse_for_write(p).is_ok(), "{p:?}");
        }
        // Reading keeps the lenient parser: a Linux tree may hold an `aux.c`.
        assert!(RelPath::parse("src/aux.c").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_target_with_a_windows_alias_is_refused_for_writes() {
        let t = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("GIT~1/hooks", t.path().join("l")).unwrap();
        let root = open(t.path());
        let resolved = resolve(&root, &RelPath::parse("l").unwrap(), true).unwrap();
        assert!(matches!(
            resolved.check_for_write(),
            Err(PathError::WindowsAlias(_))
        ));
    }

    #[test]
    fn plain_and_missing_paths() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("src")).unwrap();
        std::fs::write(t.path().join("src/a.rs"), "x").unwrap();
        let root = open(t.path());

        let r = resolve(&root, &RelPath::parse("src/a.rs").unwrap(), true).unwrap();
        assert!(r.exists());
        assert_eq!(r.kind, Some(Kind::File));

        let r = resolve(&root, &RelPath::parse("src/deep/er/new.rs").unwrap(), true).unwrap();
        assert!(!r.exists());
        assert_eq!(r.kind, None);
        assert_eq!(r.missing_dirs(), vec!["src/deep", "src/deep/er"]);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_inside_the_root_resolve_to_one_canonical_path() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("real")).unwrap();
        std::fs::write(t.path().join("real/x"), "x").unwrap();
        std::os::unix::fs::symlink("real", t.path().join("alias")).unwrap();
        std::os::unix::fs::symlink("real/x", t.path().join("link-to-x")).unwrap();
        let root = open(t.path());

        let via_dir = resolve(&root, &RelPath::parse("alias/x").unwrap(), true).unwrap();
        assert_eq!(via_dir.to_wire(), "real/x");
        let via_file = resolve(&root, &RelPath::parse("link-to-x").unwrap(), true).unwrap();
        assert_eq!(via_file.to_wire(), "real/x");
        let itself = resolve(&root, &RelPath::parse("link-to-x").unwrap(), false).unwrap();
        assert_eq!(itself.to_wire(), "link-to-x");
        assert_eq!(itself.kind, Some(Kind::Symlink));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_that_escape_are_rejected() {
        let outside = tempfile::tempdir().unwrap();
        let t = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), t.path().join("link")).unwrap();
        std::os::unix::fs::symlink("../../etc/passwd", t.path().join("up")).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", t.path().join("abs")).unwrap();
        let root = open(t.path());

        for p in ["link/pwned.txt", "up", "abs", "link"] {
            let err = resolve(&root, &RelPath::parse(p).unwrap(), true).unwrap_err();
            assert!(matches!(err, PathError::Escape(_)), "{p}: {err:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn loops_and_dangling_links() {
        let t = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("b", t.path().join("a")).unwrap();
        std::os::unix::fs::symlink("a", t.path().join("b")).unwrap();
        std::os::unix::fs::symlink("not-there", t.path().join("dangling")).unwrap();
        let root = open(t.path());

        assert_eq!(
            resolve(&root, &RelPath::parse("a").unwrap(), true),
            Err(PathError::SymlinkLoop)
        );
        let r = resolve(&root, &RelPath::parse("dangling").unwrap(), true).unwrap();
        assert_eq!(r.to_wire(), "not-there");
        assert!(!r.exists());
    }

    #[test]
    fn a_file_in_the_middle_is_not_a_directory() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("f"), "x").unwrap();
        let root = open(t.path());
        let err = resolve(&root, &RelPath::parse("f/g").unwrap(), true).unwrap_err();
        assert!(matches!(err, PathError::NotADirectory(_)));
    }
}
