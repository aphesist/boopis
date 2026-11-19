//! What the host will extract from the runtime archive, and what it will not (ADR-0023).
//!
//! The archive is verified before anything is extracted from it: [`hash_file`] reads the whole file, and only a file
//! whose hash is the manifest's is opened as a tar. While it extracts, the same bytes are hashed again (they come from
//! the same open file, so a file changed in place between the two passes shows up as a mismatch) and the tree is built
//! in a temporary directory that is discarded on any failure. Nothing in it is run, linked or renamed into place before
//! both hashes agree.
//!
//! An archive that matches its hash is still bounded: a bug in the build or a wrong archive would otherwise fill the disk
//! or the inode table. [`Caps`] limits the total size and the entry count to the manifest's own figures plus a margin, and
//! admits only the four entry types a runtime has (file, directory, symlink, hard link): a device node or a FIFO is
//! refused, never created. Permission bits are stripped of setuid, setgid and sticky by the extractor's own setting (see
//! `Runtime::unpack_into`), and the tests pin it.

use std::fs::File;
use std::io::{self, Read};

use sha2::{Digest, Sha256};

use super::Manifest;
use crate::error::{Error, Result};

/// Extra room over the manifest's unpacked size: a quarter, and never less than this. `unpacked_size` is the build's
/// `du` figure (disk blocks), so the real byte total is normally under it; the margin is for rounding, not for growth.
const MIN_BYTES_MARGIN: u64 = 16 << 20;
/// Entries over the recorded count: an eighth and this many.
const ENTRIES_MARGIN: u64 = 64;
/// With no recorded count, the cap is derived from the size: one entry per this many bytes, plus a floor.
const BYTES_PER_ENTRY_FLOOR: u64 = 1024;
const MIN_ENTRIES: u64 = 10_000;

fn corrupt(why: &str) -> Error {
    Error::Setup(
        "hx.setup.runtime_corrupt",
        format!("the bundled Hermes runtime {why}; reinstall the app"),
    )
}

/// SHA-256 of everything left in `file`, as lowercase hex.
///
/// # Errors
/// A read fails.
pub(super) fn hash_file(file: &mut File) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(hex::encode(hasher.finalize()));
        }
        hasher.update(&buf[..n]);
    }
}

/// The most an unpack may produce, and a running count of what it has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Caps {
    max_bytes: u64,
    max_entries: u64,
    bytes: u64,
    entries: u64,
}

impl Caps {
    /// The caps for this manifest: its recorded size and count plus a margin. Without a recorded count the entry cap is
    /// derived from the size.
    pub(super) fn for_manifest(m: &Manifest) -> Self {
        let size = m.unpacked_size;
        let max_bytes = size.saturating_add((size / 4).max(MIN_BYTES_MARGIN));
        let max_entries = if m.entries > 0 {
            m.entries.saturating_add(m.entries / 8 + ENTRIES_MARGIN)
        } else {
            (size / BYTES_PER_ENTRY_FLOOR).saturating_add(MIN_ENTRIES)
        };
        Self {
            max_bytes,
            max_entries,
            bytes: 0,
            entries: 0,
        }
    }

    /// Counts `entry` and refuses it when it is of a type a runtime does not have, or takes the total past a cap. Called
    /// before the entry is extracted, so nothing past a cap is ever written.
    ///
    /// # Errors
    /// `hx.setup.runtime_corrupt`.
    pub(super) fn admit<R: Read>(&mut self, entry: &tar::Entry<'_, R>) -> Result<()> {
        let kind = entry.header().entry_type();
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink() || kind.is_hard_link()) {
            return Err(corrupt(
                "holds a device, a pipe or another special file, which the host never creates",
            ));
        }
        self.entries += 1;
        if self.entries > self.max_entries {
            return Err(corrupt(&format!(
                "holds more than the {} entries its manifest allows",
                self.max_entries
            )));
        }
        self.bytes = self.bytes.saturating_add(entry.size());
        if self.bytes > self.max_bytes {
            return Err(corrupt(&format!(
                "unpacks to more than the {} MB its manifest allows",
                self.max_bytes / 1_000_000
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(unpacked_size: u64, entries: u64) -> Manifest {
        let mut m = super::super::tests::manifest_for("0.23.2", "0".repeat(64), 1);
        m.unpacked_size = unpacked_size;
        m.entries = entries;
        m
    }

    #[test]
    fn the_caps_are_the_manifest_plus_a_margin() {
        let c = Caps::for_manifest(&manifest(400_000_000, 50_000));
        assert_eq!(c.max_bytes, 500_000_000, "a quarter over");
        assert_eq!(c.max_entries, 50_000 + 6_250 + ENTRIES_MARGIN);
        // A small runtime still gets the floor margin, and an unrecorded count is derived from the size.
        let c = Caps::for_manifest(&manifest(1_000_000, 0));
        assert_eq!(c.max_bytes, 1_000_000 + MIN_BYTES_MARGIN);
        assert_eq!(
            c.max_entries,
            1_000_000 / BYTES_PER_ENTRY_FLOOR + MIN_ENTRIES
        );
        // Nothing overflows.
        let c = Caps::for_manifest(&manifest(u64::MAX, u64::MAX));
        assert_eq!((c.max_bytes, c.max_entries), (u64::MAX, u64::MAX));
    }
}
