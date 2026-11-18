//! File-system primitives, all through a [`cap_std::fs::Dir`] so nothing can leave the root.

use std::collections::BTreeSet;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cap_std::fs::{Dir, Metadata, OpenOptions};

/// The metadata the journal preserves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Meta {
    /// Unix permission bits (`0o7777`), `None` where the platform has none.
    pub mode: Option<u32>,
    /// Modification time as nanoseconds since the epoch.
    pub mtime_ns: Option<i64>,
    /// Size in bytes.
    pub len: u64,
}

/// Reads the preserved metadata out of a `Metadata`.
#[must_use]
pub fn meta_of(md: &Metadata) -> Meta {
    #[cfg(unix)]
    let mode = {
        use cap_std::fs::MetadataExt;
        Some(md.mode() & 0o7777)
    };
    #[cfg(not(unix))]
    let mode = None;
    let mtime_ns = md
        .modified()
        .ok()
        .map(cap_std::time::SystemTime::into_std)
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_nanos()).ok());
    Meta {
        mode,
        mtime_ns,
        len: md.len(),
    }
}

fn system_time(ns: i64) -> SystemTime {
    let d = Duration::from_nanos(ns.unsigned_abs());
    if ns >= 0 {
        UNIX_EPOCH + d
    } else {
        UNIX_EPOCH - d
    }
}

/// Opens a regular file, refuses it if larger than `max`, and returns its bytes and metadata.
///
/// # Errors
/// The open or read fails, or the file is too large (`InvalidData`).
pub fn read_file(root: &Dir, rel: &Path, max: u64) -> io::Result<(Vec<u8>, Meta)> {
    let mut file = root.open(rel)?;
    let md = file.metadata()?;
    if md.len() > max {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file is {} bytes, limit is {max}", md.len()),
        ));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(md.len()).unwrap_or(0));
    Read::take(&mut file, max + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file grew past the limit while reading",
        ));
    }
    let meta = meta_of(&md);
    Ok((bytes, meta))
}

/// Writes `bytes` to `rel` atomically: a temp file in the same directory, fsync, rename.
///
/// With `mode` the permission bits are set exactly (so an executable stays executable); without
/// it the process umask decides. With `mtime_ns` the modification time is set before the rename
/// (used by restore).
///
/// # Errors
/// Any step fails. The temp file is removed on failure.
pub fn write_atomic(
    root: &Dir,
    rel: &Path,
    tmp_name: &str,
    bytes: &[u8],
    mode: Option<u32>,
    mtime_ns: Option<i64>,
) -> io::Result<()> {
    let tmp = rel.parent().unwrap_or_else(|| Path::new("")).join(tmp_name);
    let result =
        write_tmp(root, &tmp, bytes, mode, mtime_ns).and_then(|()| root.rename(&tmp, root, rel));
    if result.is_err() {
        let _ = root.remove_file(&tmp);
    }
    result
}

fn write_tmp(
    root: &Dir,
    tmp: &Path,
    bytes: &[u8],
    mode: Option<u32>,
    mtime_ns: Option<i64>,
) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o666);
    }
    let mut file = root.open_with(tmp, &options)?;
    file.write_all(bytes)?;
    #[cfg(unix)]
    if let Some(m) = mode {
        use cap_std::fs::PermissionsExt;
        file.set_permissions(cap_std::fs::Permissions::from_mode(m))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    let std_file = file.into_std();
    if let Some(ns) = mtime_ns {
        std_file.set_modified(system_time(ns))?;
    }
    std_file.sync_all()
}

/// Removes a file or symlink if it is there. A directory is an error.
///
/// # Errors
/// Anything but "not found".
pub fn remove_if_exists(root: &Dir, rel: &Path) -> io::Result<bool> {
    match root.remove_file(rel) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// Fsyncs each directory so the renames and unlinks in it are durable.
///
/// # Errors
/// A directory cannot be opened or synced. Directory fsync is skipped on Windows, which has no
/// equivalent.
pub fn sync_dirs(root: &Dir, dirs: &BTreeSet<PathBuf>) -> io::Result<()> {
    #[cfg(unix)]
    for d in dirs {
        // Opened as a plain read-only file: a directory handle from `open_dir` is `O_PATH` on
        // Linux, and fsync on it fails with EBADF.
        let target = if d.as_os_str().is_empty() {
            Path::new(".")
        } else {
            d.as_path()
        };
        root.open(target)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = (root, dirs);
    Ok(())
}

/// Recreates a symlink with the exact stored target text.
///
/// # Errors
/// The link cannot be created, or the platform does not support it here.
pub fn make_symlink(root: &Dir, target: &Path, rel: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        root.symlink_contents(target, rel)
    }
    #[cfg(windows)]
    {
        let _ = (root, target, rel);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "symlinks are not restored on Windows",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;

    fn open(p: &Path) -> Dir {
        Dir::open_ambient_dir(p, ambient_authority()).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_mode_and_sets_mtime() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("f"), "old").unwrap();
        let root = open(t.path());
        let ns = 1_700_000_000_123_456_789_i64;
        write_atomic(&root, Path::new("f"), ".tmp", b"new", Some(0o754), Some(ns)).unwrap();
        let md = std::fs::metadata(t.path().join("f")).unwrap();
        assert_eq!(md.permissions().mode() & 0o7777, 0o754);
        assert_eq!(std::fs::read(t.path().join("f")).unwrap(), b"new");
        let (_, meta) = read_file(&root, Path::new("f"), 100).unwrap();
        assert_eq!(meta.mtime_ns, Some(ns));
        assert!(!t.path().join(".tmp").exists());
    }

    #[test]
    fn atomic_write_cleans_up_when_rename_fails() {
        let t = tempfile::tempdir().unwrap();
        let root = open(t.path());
        // The parent directory does not exist, so creating the temp file fails.
        assert!(write_atomic(&root, Path::new("missing/f"), ".tmp", b"x", None, None).is_err());
        // The target is a directory, so the rename fails after the temp file was written.
        std::fs::create_dir(t.path().join("d")).unwrap();
        assert!(write_atomic(&root, Path::new("d"), ".tmp", b"x", None, None).is_err());
        assert!(!t.path().join(".tmp").exists());
    }

    #[test]
    fn read_file_enforces_the_limit() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("f"), "0123456789").unwrap();
        let root = open(t.path());
        assert!(read_file(&root, Path::new("f"), 9).is_err());
        assert_eq!(read_file(&root, Path::new("f"), 10).unwrap().0.len(), 10);
    }

    #[test]
    fn negative_times_convert() {
        assert!(system_time(-5) < UNIX_EPOCH);
        assert!(system_time(5) > UNIX_EPOCH);
    }
}
