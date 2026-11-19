//! Directories held open and opened without following a symlink.
//!
//! `cap-std` keeps a path inside the root but follows symlinks that stay inside it. A symlink
//! swapped in between the check (`paths::resolve`) and the write could then send a write to a
//! protected file under another name. [`Parent`] closes that: every directory on the way is
//! opened with `O_NOFOLLOW`, one component at a time, and the descriptor stays open while the
//! caller works in it, so a later swap of a directory for a link changes nothing it holds.
//!
//! The paths handed in are already canonical (`paths::resolve` expanded every link), so a link
//! met here is a swap or a plant, never something to follow. Where the platform has no
//! `O_NOFOLLOW` (Windows) a component is checked with `lstat` first, which narrows the window
//! without closing it.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::path::{Component, Path};

use cap_std::fs::{Dir, Metadata};

/// A directory held open, and the name of one entry inside it.
#[derive(Debug)]
pub struct Parent {
    /// The directory, reached without following a symlink.
    pub dir: Dir,
    /// The entry's name in `dir`: one component, never `.` or `..`.
    pub name: OsString,
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, what.to_owned())
}

fn normal_components(rel: &Path) -> io::Result<Vec<&OsStr>> {
    rel.components()
        .map(|c| match c {
            Component::Normal(s) => Ok(s),
            Component::CurDir => Err(invalid("a `.` segment in a workspace path")),
            _ => Err(invalid("not a plain workspace-relative path")),
        })
        .collect()
}

#[cfg(unix)]
fn open_dir_nofollow(parent: &Dir, name: &OsStr) -> io::Result<Dir> {
    use rustix::fs::{Mode, OFlags, openat};
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let fd = openat(parent, name, flags, Mode::empty())?;
    Ok(Dir::from_std_file(File::from(fd)))
}

#[cfg(not(unix))]
fn open_dir_nofollow(parent: &Dir, name: &OsStr) -> io::Result<Dir> {
    if parent.symlink_metadata(name)?.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a symlink in the path",
        ));
    }
    parent.open_dir(name)
}

/// A fresh descriptor on `root` itself. cap-std's own handle on a directory is `O_PATH` on Linux,
/// which cannot be fsynced; this one can.
fn reopen(root: &Dir) -> io::Result<Dir> {
    #[cfg(unix)]
    {
        open_dir_nofollow(root, OsStr::new("."))
    }
    #[cfg(not(unix))]
    {
        root.try_clone()
    }
}

/// Opens the directory `rel` below `root`, refusing a symlink at any component. An empty `rel`
/// gives a handle on the root itself.
///
/// # Errors
/// A component is missing (`NotFound`), is not a directory, or is a symlink.
pub fn open_dir(root: &Dir, rel: &Path) -> io::Result<Dir> {
    let mut dir = reopen(root)?;
    for name in normal_components(rel)? {
        dir = open_dir_nofollow(&dir, name)?;
    }
    Ok(dir)
}

/// Creates `rel` and every missing parent, refusing a symlink at any component, and returns the
/// directory. A component that appears between the attempt and the open is used if it is a real
/// directory.
///
/// # Errors
/// A component is a symlink or not a directory, or a directory cannot be created.
pub fn create_dir_all(root: &Dir, rel: &Path) -> io::Result<Dir> {
    let mut dir = reopen(root)?;
    for name in normal_components(rel)? {
        dir = match open_dir_nofollow(&dir, name) {
            Ok(d) => d,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                match dir.create_dir(name) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(e) => return Err(e),
                }
                open_dir_nofollow(&dir, name)?
            }
            Err(e) => return Err(e),
        };
    }
    Ok(dir)
}

impl Parent {
    /// Holds the directory that contains `rel`, reached without following a symlink, and names
    /// the entry. The entry itself is not opened.
    ///
    /// # Errors
    /// `rel` is empty or not a plain relative path, or a parent is missing, not a directory or a
    /// symlink.
    pub fn open(root: &Dir, rel: &Path) -> io::Result<Self> {
        let name = rel
            .file_name()
            .ok_or_else(|| invalid("the path has no file name"))?
            .to_owned();
        let dir = open_dir(root, rel.parent().unwrap_or_else(|| Path::new("")))?;
        Ok(Self { dir, name })
    }

    /// Like [`Parent::open`], creating the missing parent directories.
    ///
    /// # Errors
    /// As [`Parent::open`], or a directory cannot be created.
    pub fn create(root: &Dir, rel: &Path) -> io::Result<Self> {
        let name = rel
            .file_name()
            .ok_or_else(|| invalid("the path has no file name"))?
            .to_owned();
        let dir = create_dir_all(root, rel.parent().unwrap_or_else(|| Path::new("")))?;
        Ok(Self { dir, name })
    }

    /// Opens the entry for reading if it is a regular file, never following a symlink and never
    /// blocking: a FIFO swapped in after the check is refused instead of hanging the read.
    ///
    /// # Errors
    /// The entry is missing, a symlink, or anything but a regular file (`InvalidInput`).
    pub fn open_regular(&self) -> io::Result<(cap_std::fs::File, Metadata)> {
        let file = self.open_file_nofollow()?;
        let file = cap_std::fs::File::from_std(file);
        let md = file.metadata()?;
        if !md.is_file() {
            return Err(invalid("not a regular file"));
        }
        Ok((file, md))
    }

    #[cfg(unix)]
    fn open_file_nofollow(&self) -> io::Result<File> {
        use rustix::fs::{Mode, OFlags, openat};
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
        Ok(File::from(openat(
            &self.dir,
            &self.name,
            flags,
            Mode::empty(),
        )?))
    }

    #[cfg(not(unix))]
    fn open_file_nofollow(&self) -> io::Result<File> {
        if !self.dir.symlink_metadata(&self.name)?.is_file() {
            return Err(invalid("not a regular file"));
        }
        Ok(self.dir.open(&self.name)?.into_std())
    }
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;
    use std::os::unix::fs::symlink;

    fn open(p: &Path) -> Dir {
        Dir::open_ambient_dir(p, ambient_authority()).unwrap()
    }

    #[test]
    fn a_symlinked_directory_is_refused_even_inside_the_root() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("real")).unwrap();
        symlink("real", t.path().join("alias")).unwrap();
        let root = open(t.path());
        assert!(open_dir(&root, Path::new("real")).is_ok());
        assert!(open_dir(&root, Path::new("alias")).is_err());
        assert!(Parent::open(&root, Path::new("alias/x")).is_err());
        assert!(Parent::create(&root, Path::new("alias/deeper/x")).is_err());
        assert!(!t.path().join("real/deeper").exists());
    }

    #[test]
    fn a_symlinked_file_and_a_fifo_are_refused_without_blocking() {
        use rustix::fs::{CWD, FileType, Mode, mknodat};
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("f"), "x").unwrap();
        symlink("f", t.path().join("link")).unwrap();
        mknodat(
            CWD,
            t.path().join("fifo"),
            FileType::Fifo,
            Mode::RUSR | Mode::WUSR,
            0,
        )
        .unwrap();
        let root = open(t.path());
        assert!(
            Parent::open(&root, Path::new("f"))
                .unwrap()
                .open_regular()
                .is_ok()
        );
        assert!(
            Parent::open(&root, Path::new("link"))
                .unwrap()
                .open_regular()
                .is_err()
        );
        let err = Parent::open(&root, Path::new("fifo"))
            .unwrap()
            .open_regular()
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn create_makes_missing_directories_and_dots_are_refused() {
        let t = tempfile::tempdir().unwrap();
        let root = open(t.path());
        let p = Parent::create(&root, Path::new("a/b/c.txt")).unwrap();
        assert_eq!(p.name, "c.txt");
        assert!(t.path().join("a/b").is_dir());
        assert!(Parent::open(&root, Path::new("a/../x")).is_err());
        assert!(Parent::open(&root, Path::new("/abs/x")).is_err());
        assert!(Parent::open(&root, Path::new("")).is_err());
    }
}
