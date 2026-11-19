//! File-system primitives, all through a [`cap_std::fs::Dir`] so nothing can leave the root.

use std::collections::BTreeSet;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cap_std::fs::{Dir, Metadata, OpenOptions};

use crate::held::{self, Parent};

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
/// No symlink is followed, at any component or at the file itself, and a FIFO or device swapped
/// in after the path was checked is refused (`InvalidInput`) instead of hanging the read.
///
/// # Errors
/// The open or read fails, the file is not regular, or it is too large (`InvalidData`).
pub fn read_file(root: &Dir, rel: &Path, max: u64) -> io::Result<(Vec<u8>, Meta)> {
    let (mut file, md) = Parent::open(root, rel)?.open_regular()?;
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

/// The permission bits an edited file may carry: setuid, setgid and sticky never survive a write.
#[cfg(unix)]
const MODE_MASK: u32 = 0o777;

/// Writes `bytes` to `rel` atomically: a temp file in the same directory, fsync, rename.
///
/// With `mode` the permission bits are set exactly (so an executable stays executable), minus
/// setuid, setgid and sticky: an edited file never gains them. Without it the process umask
/// decides. With `mtime_ns` the modification time is set before the rename (used by restore).
///
/// The directory is opened once, without following a symlink, and held until the rename, so the
/// temp file and the rename always meet in the same directory. When there is a mode to keep, the
/// temp file starts at 0600 and takes that mode before the first byte goes in: the contents of a
/// private file are never readable by anyone else, not even for an instant.
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
    let parent = Parent::open(root, rel)?;
    let tmp = Path::new(tmp_name);
    let result = write_tmp(&parent.dir, tmp, bytes, mode, mtime_ns)
        .and_then(|()| parent.dir.rename(tmp, &parent.dir, &parent.name));
    if result.is_err() {
        let _ = parent.dir.remove_file(tmp);
    }
    result
}

/// Creates the temp file, exclusively and never through a symlink. With a mode to keep it is
/// private (0600) until [`write_tmp`] sets that mode; a new file has no prior mode to protect,
/// so the umask decides, as it does for any file the user creates.
fn create_tmp(dir: &Dir, tmp: &Path, private: bool) -> io::Result<cap_std::fs::File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(if private { 0o600 } else { 0o666 });
    }
    #[cfg(not(unix))]
    let _ = private;
    dir.open_with(tmp, &options)
}

fn write_tmp(
    dir: &Dir,
    tmp: &Path,
    bytes: &[u8],
    mode: Option<u32>,
    mtime_ns: Option<i64>,
) -> io::Result<()> {
    let mut file = create_tmp(dir, tmp, mode.is_some())?;
    #[cfg(unix)]
    if let Some(m) = mode {
        use cap_std::fs::PermissionsExt;
        // Before the contents: the final mode (which may be 0444) cannot block the write, as the
        // file is already open for writing.
        file.set_permissions(cap_std::fs::Permissions::from_mode(m & MODE_MASK))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    file.write_all(bytes)?;
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
    let parent = match Parent::open(root, rel) {
        Ok(p) => p,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    match parent.dir.remove_file(&parent.name) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// `lstat` of `rel`: the entry itself, through parents that are not symlinks.
///
/// # Errors
/// `NotFound`, or a parent that is a symlink or not a directory.
pub fn lstat(root: &Dir, rel: &Path) -> io::Result<Metadata> {
    let parent = Parent::open(root, rel)?;
    parent.dir.symlink_metadata(&parent.name)
}

/// The target text of the symlink at `rel`, through parents that are not symlinks.
///
/// # Errors
/// `rel` is not a symlink, or a parent is a symlink or missing.
pub fn read_link(root: &Dir, rel: &Path) -> io::Result<PathBuf> {
    let parent = Parent::open(root, rel)?;
    parent.dir.read_link_contents(&parent.name)
}

/// Creates the directory `rel` (its parent must exist), through parents that are not symlinks.
///
/// # Errors
/// `AlreadyExists`, or a parent that is a symlink or missing.
pub fn create_dir(root: &Dir, rel: &Path) -> io::Result<()> {
    let parent = Parent::open(root, rel)?;
    parent.dir.create_dir(&parent.name)
}

/// Creates `rel` and its missing parents; a symlink anywhere on the way is an error.
///
/// # Errors
/// A component is a symlink or not a directory, or a directory cannot be created.
pub fn create_dir_all(root: &Dir, rel: &Path) -> io::Result<()> {
    held::create_dir_all(root, rel).map(|_| ())
}

/// Removes the empty directory `rel`, through parents that are not symlinks.
///
/// # Errors
/// As `remove_dir`, or a parent that is a symlink or missing.
pub fn remove_dir(root: &Dir, rel: &Path) -> io::Result<()> {
    let parent = Parent::open(root, rel)?;
    parent.dir.remove_dir(&parent.name)
}

/// Fsyncs each directory so the renames and unlinks in it are durable.
///
/// # Errors
/// A directory cannot be opened or synced. Directory fsync is skipped on Windows, which has no
/// equivalent.
pub fn sync_dirs(root: &Dir, dirs: &BTreeSet<PathBuf>) -> io::Result<()> {
    #[cfg(unix)]
    for d in dirs {
        // `held::open_dir` opens a plain read-only descriptor: a handle from cap-std's `open_dir`
        // is `O_PATH` on Linux, and fsync on it fails with EBADF.
        held::open_dir(root, d)?.into_std_file().sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = (root, dirs);
    Ok(())
}

/// Recreates a symlink with the exact stored target text.
///
/// # Errors
/// The link cannot be created (a parent that is a symlink is refused), or the platform does not
/// support it here.
pub fn make_symlink(root: &Dir, target: &Path, rel: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        let parent = Parent::open(root, rel)?;
        parent.dir.symlink_contents(target, &parent.name)
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

    #[cfg(unix)]
    #[test]
    fn the_temp_file_of_a_kept_mode_starts_private_and_a_write_never_keeps_setuid() {
        use cap_std::fs::MetadataExt;
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let root = open(t.path());
        // Private from the first instant, whatever the umask.
        let file = create_tmp(&root, Path::new(".tmp"), true).unwrap();
        assert_eq!(file.metadata().unwrap().mode() & 0o777, 0o600);
        drop(file);
        root.remove_file(".tmp").unwrap();

        for (given, kept) in [
            (0o4755, 0o755),
            (0o2750, 0o750),
            (0o1777, 0o777),
            (0o7000, 0),
        ] {
            write_atomic(&root, Path::new("f"), ".tmp", b"x", Some(given), None).unwrap();
            let md = std::fs::metadata(t.path().join("f")).unwrap();
            assert_eq!(md.permissions().mode() & 0o7777, kept, "{given:o}");
            // A kept mode of 0 leaves a file nobody may read, root excepted (so it passed as root and
            // failed for everyone else): open it up before reading it back.
            std::fs::set_permissions(t.path().join("f"), std::fs::Permissions::from_mode(0o600))
                .unwrap();
            assert_eq!(std::fs::read(t.path().join("f")).unwrap(), b"x");
        }
    }

    #[cfg(unix)]
    #[test]
    fn writes_reads_and_removals_refuse_a_symlinked_parent_and_leave_its_target_alone() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("real")).unwrap();
        std::fs::write(t.path().join("real/x"), "keep").unwrap();
        std::os::unix::fs::symlink("real", t.path().join("alias")).unwrap();
        let root = open(t.path());
        let via = Path::new("alias/x");
        assert!(write_atomic(&root, via, ".tmp", b"pwn", None, None).is_err());
        assert!(read_file(&root, via, 100).is_err());
        assert!(remove_if_exists(&root, via).is_err());
        assert!(make_symlink(&root, Path::new("t"), Path::new("alias/l")).is_err());
        assert!(lstat(&root, via).is_err());
        assert!(create_dir_all(&root, Path::new("alias/new")).is_err());
        assert_eq!(std::fs::read(t.path().join("real/x")).unwrap(), b"keep");
        assert_eq!(std::fs::read_dir(t.path().join("real")).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_or_fifo_is_not_a_file_to_read() {
        use rustix::fs::{CWD, FileType, Mode, mknodat};
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("f"), "x").unwrap();
        std::os::unix::fs::symlink("f", t.path().join("link")).unwrap();
        mknodat(
            CWD,
            t.path().join("pipe"),
            FileType::Fifo,
            Mode::RUSR | Mode::WUSR,
            0,
        )
        .unwrap();
        let root = open(t.path());
        assert!(read_file(&root, Path::new("f"), 10).is_ok());
        assert!(read_file(&root, Path::new("link"), 10).is_err());
        // Returns at once instead of blocking for a writer.
        assert!(read_file(&root, Path::new("pipe"), 10).is_err());
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
