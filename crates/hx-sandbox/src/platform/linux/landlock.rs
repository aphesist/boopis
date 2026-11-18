//! Building the Landlock ruleset from a resolved policy.

use std::io;
use std::path::PathBuf;

use super::sys::{Ruleset, access};
use crate::normalize::{ResolvedPath, ResolvedPolicy};

/// The oldest Landlock ABI that is enough to call the filesystem confined. ABI 1 lacks
/// `REFER` (renaming a file out of a directory you may not write to) and `TRUNCATE`
/// (shortening a file you may only read), so a read-only tree could be altered.
pub(super) const MIN_ABI: u32 = 3;

const FILE_ONLY: u64 =
    access::EXECUTE | access::WRITE_FILE | access::READ_FILE | access::TRUNCATE | access::IOCTL_DEV;

/// Device nodes every program expects to open; harmless to write to.
const IMPLICIT_DEVICES: &[&str] = &[
    "/dev/null",
    "/dev/zero",
    "/dev/full",
    "/dev/random",
    "/dev/urandom",
];

/// Every filesystem access this crate knows about, limited to what `abi` supports. Whatever is
/// handled and not granted is denied.
pub(super) fn handled_fs(abi: u32) -> u64 {
    let mut handled = access::EXECUTE
        | access::WRITE_FILE
        | access::READ_FILE
        | access::READ_DIR
        | access::REMOVE_DIR
        | access::REMOVE_FILE
        | access::MAKE_CHAR
        | access::MAKE_DIR
        | access::MAKE_REG
        | access::MAKE_SOCK
        | access::MAKE_FIFO
        | access::MAKE_BLOCK
        | access::MAKE_SYM;
    if abi >= 2 {
        handled |= access::REFER;
    }
    if abi >= 3 {
        handled |= access::TRUNCATE;
    }
    if abi >= 5 {
        handled |= access::IOCTL_DEV;
    }
    handled
}

/// What ABI 6 scopes: abstract Unix sockets and signals leaving the domain.
pub(super) fn scopes(abi: u32) -> u64 {
    if abi >= 6 {
        access::SCOPE_ABSTRACT_UNIX_SOCKET | access::SCOPE_SIGNAL
    } else {
        0
    }
}

fn grant_for(handled: u64, writable: bool, is_dir: bool) -> u64 {
    let wanted = if writable {
        handled
    } else {
        access::EXECUTE | access::READ_FILE | access::READ_DIR
    };
    let masked = wanted & handled;
    if is_dir { masked } else { masked & FILE_ONLY }
}

/// A built ruleset and what it contains, for the report.
pub(super) struct Built {
    pub ruleset: Ruleset,
    pub ro_grants: usize,
    pub rw_grants: usize,
    pub implicit: Vec<PathBuf>,
}

/// Creates the ruleset and adds one grant per resolved path plus the implicit devices.
pub(super) fn build(policy: &ResolvedPolicy, abi: u32) -> io::Result<Built> {
    let handled = handled_fs(abi);
    let ruleset = Ruleset::new(handled, scopes(abi))?;
    let add = |entry: &ResolvedPath, writable: bool| {
        ruleset
            .allow_path(
                &entry.path,
                grant_for(handled, writable, entry.is_dir),
                entry.is_dir,
            )
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", entry.path.display())))
    };
    for entry in &policy.ro {
        add(entry, false)?;
    }
    for entry in &policy.rw {
        add(entry, true)?;
    }
    let mut implicit = Vec::new();
    for dev in IMPLICIT_DEVICES {
        let Ok(path) = std::fs::canonicalize(dev) else {
            continue;
        };
        let access =
            (access::READ_FILE | access::WRITE_FILE | access::TRUNCATE | access::IOCTL_DEV)
                & handled;
        if ruleset.allow_path(&path, access, false).is_ok() {
            implicit.push(path);
        }
    }
    Ok(Built {
        ruleset,
        ro_grants: policy.ro.len(),
        rw_grants: policy.rw.len(),
        implicit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handled_grows_with_the_abi() {
        assert_eq!(handled_fs(1) & access::REFER, 0);
        assert!(handled_fs(2) & access::REFER != 0);
        assert_eq!(handled_fs(2) & access::TRUNCATE, 0);
        assert!(handled_fs(3) & access::TRUNCATE != 0);
        assert!(handled_fs(5) & access::IOCTL_DEV != 0);
        assert_eq!(scopes(5), 0);
        assert_ne!(scopes(6), 0);
    }

    #[test]
    fn read_only_grants_never_write() {
        let h = handled_fs(7);
        let ro_dir = grant_for(h, false, true);
        assert_eq!(
            ro_dir
                & (access::WRITE_FILE
                    | access::MAKE_REG
                    | access::REMOVE_FILE
                    | access::TRUNCATE
                    | access::REFER),
            0
        );
        assert_ne!(ro_dir & access::READ_DIR, 0);
        assert_ne!(ro_dir & access::EXECUTE, 0);
    }

    #[test]
    fn file_grants_drop_directory_bits() {
        let h = handled_fs(7);
        let rw_file = grant_for(h, true, false);
        assert_eq!(
            rw_file & (access::READ_DIR | access::MAKE_DIR | access::REMOVE_FILE),
            0
        );
        assert_ne!(rw_file & access::WRITE_FILE, 0);
        // A grant never carries a bit the ruleset does not handle.
        assert_eq!(grant_for(handled_fs(1), true, true) & access::TRUNCATE, 0);
    }
}
