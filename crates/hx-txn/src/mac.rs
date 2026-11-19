//! The profile's journal key and the tag that vouches for a journal's manifest.
//!
//! # Why a keyed tag, and not a list of ids
//! `txn.recover` runs at every start and writes to whatever paths a journal names, so a journal
//! somebody else planted would be a write anywhere in the workspace the next time the plugin
//! starts. Two ways to tell a journal this profile's hx wrote from a planted one:
//!
//! - **a record of ids** that hx appends to: it only says an id was once seen, so a genuine
//!   journal whose manifest was edited afterwards (a new root, a new path) still passes;
//! - **a tag** over the manifest under a per-profile key: it binds the id, the root, every path,
//!   every hash and the protected list, so an edited manifest fails as surely as a planted one.
//!
//! The tag is the one chosen. Its weakness is the same as the record's: whoever can read the key
//! (a same-user process) can forge a tag, just as whoever can write the record can add an id. So
//! the key is a 0600 file, and the plugin's policy denies agent tools reading it (the key sits
//! beside the journals: `<profile home>/boopis/journals/.hx-journal-key`).
//!
//! # Where the key lives
//! In the **parent** of the journal directory, so it is per profile: the plugin gives every
//! session its own journal directory under one `journals/`, and a directory somebody creates
//! there has no key of its own to forge a tag with. Only `txn.apply` creates the key (a recovery
//! that finds none refuses every journal), and it refuses a key that is not a private regular
//! file of 32 bytes.
//!
//! A journal written before this build has no tag and is refused: it stays on disk, reported in
//! `failed`, never replayed.

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The key's file name, in the journal directory's parent.
pub const KEY_FILE: &str = ".hx-journal-key";

/// The tag's file name, inside each journal directory.
pub const TAG_FILE: &str = "manifest.mac";

const KEY_LEN: usize = 32;
const BLOCK: usize = 64;

/// A journal key. Never printed.
#[derive(Clone)]
pub struct Key([u8; KEY_LEN]);

impl std::fmt::Debug for Key {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key(<redacted>)")
    }
}

/// Where the key for `journal_dir` lives.
#[must_use]
pub fn key_path(journal_dir: &Path) -> PathBuf {
    let parent = journal_dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    parent.join(KEY_FILE)
}

fn unusable(path: &Path, why: &str) -> Error {
    Error::io(
        format!("the journal key {}", path.display()),
        io::Error::new(io::ErrorKind::InvalidData, why.to_owned()),
    )
}

/// Reads the key and checks it is a private regular file of the right size.
fn read_key(path: &Path) -> Result<Option<Key>> {
    let md = match fs::symlink_metadata(path) {
        Ok(md) => md,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(Error::io("reading the journal key", e)),
    };
    if !md.is_file() {
        return Err(unusable(path, "not a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if md.permissions().mode() & 0o077 != 0 {
            return Err(unusable(path, "readable by others"));
        }
        if md.uid() != rustix::process::geteuid().as_raw() {
            return Err(unusable(path, "owned by another user"));
        }
    }
    let mut bytes = Vec::with_capacity(KEY_LEN);
    fs::File::open(path)
        .and_then(|f| f.take(KEY_LEN as u64 + 1).read_to_end(&mut bytes))
        .map_err(|e| Error::io("reading the journal key", e))?;
    let key: [u8; KEY_LEN] = bytes
        .try_into()
        .map_err(|_| unusable(path, "not 32 bytes"))?;
    Ok(Some(Key(key)))
}

/// The key of the profile `journal_dir` belongs to, or `None` when it has none yet.
///
/// # Errors
/// The key exists but is not a private regular file of 32 bytes, or cannot be read.
pub fn load(journal_dir: &Path) -> Result<Option<Key>> {
    read_key(&key_path(journal_dir))
}

/// The key, created (0600, from the operating system's random source) if the profile has none.
///
/// # Errors
/// As [`load`], or the key cannot be created.
pub fn load_or_create(journal_dir: &Path) -> Result<Key> {
    let path = key_path(journal_dir);
    if let Some(key) = read_key(&path)? {
        return Ok(key);
    }
    let mut bytes = [0u8; KEY_LEN];
    getrandom::fill(&mut bytes)
        .map_err(|e| Error::io("drawing a journal key", io::Error::other(e.to_string())))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut f) => f
            .write_all(&bytes)
            .and_then(|()| f.sync_all())
            .map_err(|e| Error::io("writing the journal key", e))?,
        // Another transaction made it first: use theirs.
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            return read_key(&path)?.ok_or_else(|| unusable(&path, "vanished"));
        }
        Err(e) => return Err(Error::io("creating the journal key", e)),
    }
    Ok(Key(bytes))
}

/// HMAC-SHA256 (RFC 2104). Hand-written over `sha2`, which the crate already has, rather than
/// a new dependency for twenty lines; the test below pins it to RFC 4231.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| block.map(|b| b ^ byte);
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

/// The tag for journal `id` with this manifest text: bound to the id as well, so a manifest and
/// its tag cannot be moved to another journal directory.
#[must_use]
pub fn tag(key: &Key, id: &str, manifest: &[u8]) -> String {
    let mut message = Vec::with_capacity(manifest.len() + id.len() + 32);
    message.extend_from_slice(b"hx-txn journal v1\0");
    message.extend_from_slice(id.as_bytes());
    message.push(0);
    message.extend_from_slice(manifest);
    hex::encode(hmac_sha256(&key.0, &message))
}

/// Whether `claimed` is the tag of this journal, compared without an early exit.
#[must_use]
pub fn verify(key: &Key, id: &str, manifest: &[u8], claimed: &str) -> bool {
    let expected = tag(key, id, manifest);
    let (a, b) = (expected.as_bytes(), claimed.trim().as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc_4231() {
        // Test case 2 (key "Jefe"), and test case 6 (a key longer than the block).
        assert_eq!(
            hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        assert_eq!(
            hex::encode(hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn a_tag_binds_the_id_and_the_manifest() {
        let key = Key([7; KEY_LEN]);
        let t = tag(&key, "id-1", b"{}");
        assert!(verify(&key, "id-1", b"{}", &t));
        assert!(verify(&key, "id-1", b"{}", &format!("{t}\n")));
        assert!(!verify(&key, "id-2", b"{}", &t));
        assert!(!verify(&key, "id-1", b"{ }", &t));
        assert!(!verify(&Key([8; KEY_LEN]), "id-1", b"{}", &t));
        assert!(!verify(&key, "id-1", b"{}", ""));
        assert!(!verify(&key, "id-1", b"{}", &t[..t.len() - 1]));
    }

    #[test]
    fn the_key_is_created_once_private_and_found_beside_the_journal_dir() {
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("journals").join("session");
        fs::create_dir_all(&jd).unwrap();
        assert!(load(&jd).unwrap().is_none());
        let a = load_or_create(&jd).unwrap();
        let b = load_or_create(&jd).unwrap();
        assert_eq!(a.0, b.0);
        assert_eq!(load(&jd).unwrap().unwrap().0, a.0);
        // Per profile: another session's directory finds the same key.
        let other = t.path().join("journals").join("other");
        assert_eq!(load(&other).unwrap().unwrap().0, a.0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(key_path(&jd)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_key_that_is_not_private_or_not_32_bytes_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("journals").join("s");
        fs::create_dir_all(&jd).unwrap();
        let path = key_path(&jd);
        fs::write(&path, [1u8; KEY_LEN]).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load(&jd).is_err(), "readable by others");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(load(&jd).unwrap().is_some());
        fs::write(&path, [1u8; 5]).unwrap();
        assert!(load(&jd).is_err(), "wrong size");
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("elsewhere", &path).unwrap();
        assert!(load(&jd).is_err(), "a symlink is not a key");
    }
}
