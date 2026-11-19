//! The on-disk journal: the durable record that makes every transaction undoable.
//!
//! # Layout
//! ```text
//! <journal_dir>/                 0700, created if missing
//!   <journal_id>/                0700, a UUIDv7
//!     lock                       held (flock) while a live transaction owns the journal
//!     data.bin                   the original bytes of every touched file, concatenated
//!     manifest.json              versioned; what each entry was (existence, kind, mode, mtime)
//!     manifest.mac               the keyed tag that vouches for manifest.json (see [`crate::mac`])
//!     state                      append-only log of state names, one per line
//!   .workspace-<hash>.lock       serialises transactions on one workspace
//! <journal_dir's parent>/
//!   .hx-journal-key              the profile's 0600 key for the tags, shared by every journal dir
//!   .trash-<journal_id>/         a journal being deleted; recover finishes the delete
//! ```
//! Files are 0600 and everything is fsync'd before the next step depends on it.
//!
//! # State machine
//! ```text
//! (no manifest) --manifest renamed into place--> prepared --> applying --> applied
//!                                                   |            |           |
//!                                                   |            +-----+-----+
//!                                                   |                  v
//!                                                   |              restoring --> restored --> (journal removed)
//!                                                   |                                ^
//!                                                   +--------------------------------+  (nothing to undo)
//! ```
//! - **no manifest**: the crash came while the journal was being written. Nothing in the
//!   workspace was touched. Recovery deletes the directory.
//! - **prepared**: the journal is durable, the workspace untouched. Recovery deletes it.
//! - **applying**: workspace writes have started. Recovery restores, then deletes.
//! - **applied**: every write finished and was synced. The transaction is complete and waits
//!   for the caller's verdict. Recovery leaves it alone and reports it as pending; the caller
//!   restores it (the gate failed) or discards it (the gate passed).
//! - **restoring**: a restore started. Recovery finishes it. Restoring is idempotent.
//! - **restored**: the restore finished and only the deletion is left. Recovery just deletes the
//!   journal. Without this state a journal that survived a failed deletion would be restored
//!   again later, over work done in the meantime.
//!
//! A journal is opened only if its tag verifies under the profile's key: a directory somebody
//! planted, or a manifest edited after hx wrote it, is refused before anything in it is read as
//! a path to write.
//!
//! A journal owned by a live transaction holds an exclusive lock on its `lock` file, so a
//! second process running recovery skips it instead of rolling it back under its feet.
//!
//! The state file is an append-only log read up to its last complete line, so a torn write
//! can never turn `applied` into something else.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::faults::Faults;
use crate::fsops::Meta;
use crate::mac;

/// The manifest schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// Where a journal is in its life. See the module docs for the state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Durable, workspace untouched.
    Prepared,
    /// Workspace writes in progress.
    Applying,
    /// Complete, waiting for restore or discard.
    Applied,
    /// A restore is in progress.
    Restoring,
    /// The restore finished; only the deletion of the journal is left.
    Restored,
}

impl State {
    /// The name written to the state log.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            State::Prepared => "prepared",
            State::Applying => "applying",
            State::Applied => "applied",
            State::Restoring => "restoring",
            State::Restored => "restored",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        [
            State::Prepared,
            State::Applying,
            State::Applied,
            State::Restoring,
            State::Restored,
        ]
        .into_iter()
        .find(|st| st.as_str() == s)
    }
}

/// What a touched path was before the transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Prior {
    /// It did not exist; restore deletes it.
    Absent,
    /// A regular file; restore rewrites its bytes, mode and mtime.
    File,
    /// A symlink (only when the transaction deleted the link itself).
    Symlink,
}

/// One touched path in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Canonical workspace-relative path, `/`-separated.
    pub path: String,
    /// What it was.
    pub prior: Prior,
    /// Permission bits, for `file`.
    pub mode: Option<u32>,
    /// Modification time in nanoseconds since the epoch, for `file`.
    pub mtime_ns: Option<i64>,
    /// Offset of the bytes in `data.bin`, for `file`.
    pub offset: u64,
    /// Length of the bytes in `data.bin`, for `file`.
    pub len: u64,
    /// SHA-256 of the bytes, for `file`.
    pub sha256: Option<String>,
    /// The link target text, for `symlink`.
    pub symlink_target: Option<String>,
}

/// The journal's manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    /// Always [`SCHEMA_VERSION`] when written by this build.
    pub schema_version: u32,
    /// The journal id.
    pub id: String,
    /// RFC 3339 creation time.
    pub created: String,
    /// The canonical absolute workspace root.
    pub root: String,
    /// Every touched path.
    pub entries: Vec<Entry>,
    /// Directories the transaction creates, shallowest first. Restore removes them if empty.
    pub created_dirs: Vec<String>,
    /// The protected globs the transaction ran under (the defaults, spelled out, when the caller
    /// gave none). Restore checks every entry against them again.
    #[serde(default)]
    pub protected: Vec<String>,
    /// The size `data.bin` must have.
    pub data_len: u64,
}

/// What a new journal records.
#[derive(Debug)]
pub struct Spec<'a> {
    /// The canonical absolute workspace root.
    pub root: &'a str,
    /// The touched paths with what each was before the transaction.
    pub entries: &'a [(String, Saved<'a>)],
    /// Directories the transaction creates, shallowest first.
    pub created_dirs: Vec<String>,
    /// The effective protected globs.
    pub protected: Vec<String>,
}

/// A path's state before the transaction, as handed to [`Journal::create`].
#[derive(Debug)]
pub enum Saved<'a> {
    /// Did not exist.
    Absent,
    /// A regular file.
    File {
        /// Its exact bytes.
        bytes: &'a [u8],
        /// Its metadata.
        meta: Meta,
    },
    /// A symlink.
    Symlink {
        /// The link's target text.
        target: String,
    },
}

/// An open journal. Holds the lock while it owns the transaction.
#[derive(Debug)]
pub struct Journal {
    parent: PathBuf,
    dir: PathBuf,
    manifest: Manifest,
    lock: Option<File>,
}

#[cfg(unix)]
fn private_options(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}
#[cfg(not(unix))]
fn private_options(_: &mut OpenOptions) {}

fn create_private(path: &Path) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.write(true).create_new(true);
    private_options(&mut o);
    o.open(path)
}

fn create_private_dir(path: &Path) -> io::Result<()> {
    #[cfg_attr(not(unix), allow(unused_mut))] // Only Unix sets a mode.
    let mut b = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(path)
}

fn sync_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Creates the journal directory (0700) if needed, and tightens it if it is too open.
///
/// # Errors
/// The directory cannot be created or is not a directory.
pub fn ensure_journal_dir(path: &Path) -> Result<()> {
    let ctx = || format!("preparing journal directory {}", path.display());
    if !path.exists() {
        if let Some(parent) = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty() && !p.exists())
        {
            fs::create_dir_all(parent).map_err(|e| Error::io(ctx(), e))?;
        }
        match create_private_dir(path) {
            Ok(()) => {}
            // Another transaction created it between the check and the call.
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(Error::io(ctx(), e)),
        }
    }
    let md = fs::metadata(path).map_err(|e| Error::io(ctx(), e))?;
    if !md.is_dir() {
        return Err(Error::io(
            ctx(),
            io::Error::new(io::ErrorKind::NotADirectory, "not a directory"),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if md.permissions().mode() & 0o077 != 0 {
            tracing::warn!(dir = %path.display(), "journal directory was group/world accessible; tightening to 0700");
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .map_err(|e| Error::io(ctx(), e))?;
        }
    }
    Ok(())
}

/// Whether `id` is a canonical hyphenated UUID, which also rules out path tricks.
#[must_use]
pub fn is_valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|u| u.hyphenated().to_string() == id)
}

#[cfg(feature = "dev-fixtures")]
fn is_crash(e: &Error) -> bool {
    matches!(e, Error::InjectedCrash)
}
#[cfg(not(feature = "dev-fixtures"))]
fn is_crash(_: &Error) -> bool {
    false
}

impl Journal {
    /// Writes a new journal and leaves it `prepared`, locked by the caller. The first journal of
    /// a profile also creates the profile's key.
    ///
    /// # Errors
    /// Any write fails. A half-written journal is removed (unless a crash was injected).
    pub fn create(journal_dir: &Path, spec: &Spec<'_>, faults: &Faults) -> Result<Self> {
        ensure_journal_dir(journal_dir)?;
        let key = mac::load_or_create(journal_dir)?;
        let id = uuid::Uuid::now_v7().hyphenated().to_string();
        let dir = journal_dir.join(&id);
        let ctx = |what: &str| format!("writing journal {id}: {what}");
        create_private_dir(&dir).map_err(|e| Error::io(ctx("mkdir"), e))?;
        let outcome = Self::write_all(journal_dir, &dir, &id, spec, &key, faults, &ctx);
        match outcome {
            Ok(j) => Ok(j),
            Err(e) => {
                if !is_crash(&e) {
                    let _ = fs::remove_dir_all(&dir);
                }
                Err(e)
            }
        }
    }

    fn write_all(
        journal_dir: &Path,
        dir: &Path,
        id: &str,
        spec: &Spec<'_>,
        key: &mac::Key,
        faults: &Faults,
        ctx: &dyn Fn(&str) -> String,
    ) -> Result<Self> {
        let io = |what: &str| {
            let msg = ctx(what);
            move |e: io::Error| Error::io(msg, e)
        };
        let lock = create_private(&dir.join("lock")).map_err(io("lock"))?;
        lock.try_lock()
            .map_err(|_| Error::JournalBusy(id.to_owned()))?;
        faults.tick()?;

        let mut data = create_private(&dir.join("data.bin")).map_err(io("data"))?;
        let mut offset = 0u64;
        let mut manifest_entries = Vec::with_capacity(spec.entries.len());
        for (path, saved) in spec.entries {
            let mut entry = Entry {
                path: path.clone(),
                prior: Prior::Absent,
                mode: None,
                mtime_ns: None,
                offset: 0,
                len: 0,
                sha256: None,
                symlink_target: None,
            };
            match saved {
                Saved::Absent => {}
                Saved::File { bytes, meta } => {
                    data.write_all(bytes).map_err(io("data"))?;
                    entry.prior = Prior::File;
                    entry.mode = meta.mode;
                    entry.mtime_ns = meta.mtime_ns;
                    entry.offset = offset;
                    entry.len = bytes.len() as u64;
                    entry.sha256 = Some(hex::encode(Sha256::digest(bytes)));
                    offset += bytes.len() as u64;
                }
                Saved::Symlink { target } => {
                    entry.prior = Prior::Symlink;
                    entry.symlink_target = Some(target.clone());
                }
            }
            manifest_entries.push(entry);
        }
        data.sync_all().map_err(io("data sync"))?;
        faults.tick()?;

        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            id: id.to_owned(),
            created: hx_proto::time::now_rfc3339(),
            root: spec.root.to_owned(),
            entries: manifest_entries,
            created_dirs: spec.created_dirs.clone(),
            protected: spec.protected.clone(),
            data_len: offset,
        };
        let text = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| Error::io(ctx("manifest"), io::Error::other(e)))?;
        // The tag first: a crash between the two leaves no manifest, and recovery deletes the
        // directory. The other order would leave a manifest nobody can vouch for.
        let mut tag = create_private(&dir.join(mac::TAG_FILE)).map_err(io("tag"))?;
        tag.write_all(mac::tag(key, id, &text).as_bytes())
            .map_err(io("tag"))?;
        tag.sync_all().map_err(io("tag sync"))?;
        let tmp = dir.join("manifest.json.tmp");
        let mut f = create_private(&tmp).map_err(io("manifest"))?;
        f.write_all(&text).map_err(io("manifest"))?;
        f.sync_all().map_err(io("manifest sync"))?;
        fs::rename(&tmp, dir.join("manifest.json")).map_err(io("manifest rename"))?;
        faults.tick()?;

        let mut state = create_private(&dir.join("state")).map_err(io("state"))?;
        state.write_all(b"prepared\n").map_err(io("state"))?;
        state.sync_all().map_err(io("state sync"))?;
        sync_dir(dir).map_err(io("sync"))?;
        sync_dir(journal_dir).map_err(io("sync"))?;
        faults.tick()?;

        Ok(Self {
            parent: journal_dir.to_owned(),
            dir: dir.to_owned(),
            manifest,
            lock: Some(lock),
        })
    }

    /// Opens an existing journal without locking it.
    ///
    /// # Errors
    /// - [`Error::JournalNotFound`] if the id is malformed or the directory is absent;
    /// - [`Error::JournalCorrupt`] if the manifest or data fail verification.
    pub fn open(journal_dir: &Path, id: &str) -> Result<Self> {
        if !is_valid_id(id) {
            return Err(Error::JournalNotFound(id.to_owned()));
        }
        let dir = journal_dir.join(id);
        let corrupt = |reason: String| Error::JournalCorrupt {
            id: id.to_owned(),
            reason,
        };
        let bytes = match fs::read(dir.join("manifest.json")) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return if dir.is_dir() {
                    Err(corrupt("no manifest".to_owned()))
                } else {
                    Err(Error::JournalNotFound(id.to_owned()))
                };
            }
            Err(e) => return Err(Error::io(format!("reading journal {id}"), e)),
        };
        // Nothing in the manifest is read as a path before its tag verifies.
        let key = mac::load(journal_dir)?.ok_or_else(|| {
            corrupt("this profile has no journal key, so no journal here is its own".to_owned())
        })?;
        let claimed = fs::read_to_string(dir.join(mac::TAG_FILE)).unwrap_or_default();
        if !mac::verify(&key, id, &bytes, &claimed) {
            return Err(corrupt(
                "the manifest has no valid tag: it was not written by this profile's hx, or was edited since"
                    .to_owned(),
            ));
        }
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|e| corrupt(format!("manifest: {e}")))?;
        if manifest.schema_version != SCHEMA_VERSION {
            return Err(corrupt(format!(
                "unsupported schema version {}",
                manifest.schema_version
            )));
        }
        if manifest.id != id {
            return Err(corrupt(
                "manifest id does not match its directory".to_owned(),
            ));
        }
        let data_len = fs::metadata(dir.join("data.bin"))
            .map_err(|e| corrupt(format!("data.bin: {e}")))?
            .len();
        if data_len != manifest.data_len
            || manifest
                .entries
                .iter()
                .any(|e| e.offset.saturating_add(e.len) > manifest.data_len)
        {
            return Err(corrupt("data.bin does not match the manifest".to_owned()));
        }
        Ok(Self {
            parent: journal_dir.to_owned(),
            dir,
            manifest,
            lock: None,
        })
    }

    /// Takes the journal's lock. A live transaction holding it makes this fail.
    ///
    /// # Errors
    /// [`Error::JournalBusy`] or an I/O failure opening the lock file.
    pub fn lock(&mut self) -> Result<()> {
        if self.lock.is_some() {
            return Ok(());
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.dir.join("lock"))
            .map_err(|e| Error::io(format!("opening lock of journal {}", self.manifest.id), e))?;
        file.try_lock()
            .map_err(|_| Error::JournalBusy(self.manifest.id.clone()))?;
        self.lock = Some(file);
        Ok(())
    }

    /// Adopts a lock already taken with [`try_lock_dir`].
    #[must_use]
    pub fn with_lock(mut self, lock: File) -> Self {
        self.lock = Some(lock);
        self
    }

    /// The journal id.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.manifest.id
    }

    /// The manifest.
    #[must_use]
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// The journal's current state: the last complete line of the state log.
    ///
    /// # Errors
    /// The state file cannot be read.
    pub fn state(&self) -> Result<State> {
        let text = match fs::read_to_string(self.dir.join("state")) {
            Ok(t) => t,
            Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
            Err(e) => {
                return Err(Error::io(
                    format!("reading state of journal {}", self.manifest.id),
                    e,
                ));
            }
        };
        let complete = text.rfind('\n').map_or("", |i| &text[..=i]);
        Ok(complete
            .lines()
            .filter_map(State::parse)
            .next_back()
            .unwrap_or(State::Prepared))
    }

    /// Appends a state and fsyncs it.
    ///
    /// # Errors
    /// The write fails.
    pub fn set_state(&self, state: State) -> Result<()> {
        let ctx = || format!("recording state of journal {}", self.manifest.id);
        let mut o = OpenOptions::new();
        o.append(true).create(true);
        private_options(&mut o);
        let mut f = o
            .open(self.dir.join("state"))
            .map_err(|e| Error::io(ctx(), e))?;
        f.write_all(format!("{}\n", state.as_str()).as_bytes())
            .map_err(|e| Error::io(ctx(), e))?;
        f.sync_all().map_err(|e| Error::io(ctx(), e))
    }

    /// Reads and verifies one file's saved bytes.
    ///
    /// # Errors
    /// [`Error::JournalCorrupt`] if the bytes do not match their hash.
    pub fn read_saved(&self, entry: &Entry) -> Result<Vec<u8>> {
        let id = &self.manifest.id;
        let io = |e: io::Error| Error::io(format!("reading data of journal {id}"), e);
        let mut f = File::open(self.dir.join("data.bin")).map_err(io)?;
        f.seek(SeekFrom::Start(entry.offset)).map_err(io)?;
        let mut buf = vec![0u8; usize::try_from(entry.len).unwrap_or(0)];
        f.read_exact(&mut buf).map_err(io)?;
        if entry.sha256.as_deref() != Some(hex::encode(Sha256::digest(&buf)).as_str()) {
            return Err(Error::JournalCorrupt {
                id: id.clone(),
                reason: format!("saved bytes of `{}` fail their checksum", entry.path),
            });
        }
        Ok(buf)
    }

    /// Deletes the journal: rename out of sight, fsync, then remove. A crash in between leaves
    /// a `.trash-*` directory that [`list`] cleans up.
    ///
    /// # Errors
    /// The rename or the removal fails.
    pub fn remove(mut self) -> Result<()> {
        let id = self.manifest.id.clone();
        let trash = self.parent.join(format!(".trash-{id}"));
        let ctx = |e: io::Error| Error::io(format!("removing journal {id}"), e);
        fs::rename(&self.dir, &trash).map_err(ctx)?;
        sync_dir(&self.parent).map_err(ctx)?;
        self.lock = None; // Windows cannot delete a directory holding an open handle.
        fs::remove_dir_all(&trash).map_err(ctx)
    }
}

/// One directory in the journal directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listed {
    /// The directory name (a journal id).
    pub id: String,
}

/// Lists journal directories and finishes deleting half-deleted ones.
///
/// # Errors
/// The journal directory cannot be read. A missing directory lists as empty.
pub fn list(journal_dir: &Path) -> Result<Vec<Listed>> {
    let rd = match fs::read_dir(journal_dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::io(format!("listing {}", journal_dir.display()), e)),
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".trash-") {
            let _ = fs::remove_dir_all(entry.path());
        } else if is_valid_id(&name) && entry.path().is_dir() {
            out.push(Listed { id: name });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Deletes a directory that never got a manifest (a crash while the journal was written).
/// The caller must hold its lock.
///
/// # Errors
/// The removal fails.
pub fn remove_unfinished(journal_dir: &Path, id: &str) -> Result<()> {
    fs::remove_dir_all(journal_dir.join(id))
        .map_err(|e| Error::io(format!("removing unfinished journal {id}"), e))
}

/// The result of trying to lock a journal directory that may be unfinished.
#[derive(Debug)]
pub enum LockOutcome {
    /// The lock is ours; hold the file to keep it.
    Acquired(File),
    /// A live transaction holds it.
    Busy,
    /// There is no lock file: the writer died before creating it.
    NoLockFile,
}

/// Tries to take the lock of a journal directory that may lack a manifest.
///
/// # Errors
/// The lock file exists but cannot be opened.
pub fn try_lock_dir(journal_dir: &Path, id: &str) -> Result<LockOutcome> {
    match OpenOptions::new()
        .read(true)
        .write(true)
        .open(journal_dir.join(id).join("lock"))
    {
        Ok(f) => Ok(match f.try_lock() {
            Ok(()) => LockOutcome::Acquired(f),
            Err(_) => LockOutcome::Busy,
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(LockOutcome::NoLockFile),
        Err(e) => Err(Error::io(format!("opening lock of journal {id}"), e)),
    }
}

/// Whether the journal directory has a manifest, that is, whether it ever became durable.
#[must_use]
pub fn has_manifest(journal_dir: &Path, id: &str) -> bool {
    journal_dir.join(id).join("manifest.json").exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> Meta {
        Meta {
            mode: Some(0o644),
            mtime_ns: Some(42),
            len: 3,
        }
    }

    fn sample(dir: &Path) -> Journal {
        let entries = vec![
            (
                "a.txt".to_owned(),
                Saved::File {
                    bytes: b"abc",
                    meta: meta(),
                },
            ),
            ("new.txt".to_owned(), Saved::Absent),
            (
                "link".to_owned(),
                Saved::Symlink {
                    target: "a.txt".into(),
                },
            ),
        ];
        let spec = Spec {
            root: "/ws",
            entries: &entries,
            created_dirs: vec!["d".into()],
            protected: vec!["**/.git/**".into()],
        };
        Journal::create(dir, &spec, &Faults::none()).unwrap()
    }

    #[test]
    fn create_open_round_trip() {
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("journals");
        let j = sample(&jd);
        assert_eq!(j.state().unwrap(), State::Prepared);
        let opened = Journal::open(&jd, j.id()).unwrap();
        assert_eq!(opened.manifest(), j.manifest());
        let e = &opened.manifest().entries[0];
        assert_eq!(opened.read_saved(e).unwrap(), b"abc");
        assert_eq!(opened.manifest().entries[1].prior, Prior::Absent);
        assert_eq!(
            opened.manifest().entries[2].symlink_target.as_deref(),
            Some("a.txt")
        );
    }

    #[cfg(unix)]
    #[test]
    fn everything_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("journals");
        let j = sample(&jd);
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&jd), 0o700);
        let dir = jd.join(j.id());
        assert_eq!(mode(&dir), 0o700);
        for f in ["lock", "data.bin", "manifest.json", "manifest.mac", "state"] {
            assert_eq!(mode(&dir.join(f)), 0o600, "{f}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_open_journal_directory_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        fs::set_permissions(t.path(), fs::Permissions::from_mode(0o755)).unwrap();
        ensure_journal_dir(t.path()).unwrap();
        assert_eq!(
            fs::metadata(t.path()).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn state_is_the_last_complete_line() {
        let t = tempfile::tempdir().unwrap();
        let j = sample(&t.path().join("j"));
        j.set_state(State::Applying).unwrap();
        j.set_state(State::Applied).unwrap();
        assert_eq!(j.state().unwrap(), State::Applied);
        // A torn append is ignored.
        let mut f = OpenOptions::new()
            .append(true)
            .open(t.path().join("j").join(j.id()).join("state"))
            .unwrap();
        f.write_all(b"restor").unwrap();
        assert_eq!(j.state().unwrap(), State::Applied);
    }

    #[test]
    fn tampered_data_is_detected() {
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("j");
        let j = sample(&jd);
        fs::write(jd.join(j.id()).join("data.bin"), b"xyz").unwrap();
        let opened = Journal::open(&jd, j.id()).unwrap();
        assert!(matches!(
            opened.read_saved(&opened.manifest().entries[0]),
            Err(Error::JournalCorrupt { .. })
        ));
        fs::write(jd.join(j.id()).join("data.bin"), b"xy").unwrap();
        assert!(matches!(
            Journal::open(&jd, j.id()),
            Err(Error::JournalCorrupt { .. })
        ));
    }

    #[test]
    fn ids_are_validated() {
        assert!(!is_valid_id("../x"));
        assert!(!is_valid_id("x"));
        assert!(!is_valid_id(&uuid::Uuid::nil().simple().to_string()));
        assert!(is_valid_id(&uuid::Uuid::now_v7().hyphenated().to_string()));
        let t = tempfile::tempdir().unwrap();
        assert!(matches!(
            Journal::open(t.path(), "../etc"),
            Err(Error::JournalNotFound(_))
        ));
    }

    #[test]
    fn a_second_holder_of_the_lock_is_refused() {
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("j");
        let live = sample(&jd);
        let mut again = Journal::open(&jd, live.id()).unwrap();
        assert!(matches!(again.lock(), Err(Error::JournalBusy(_))));
        assert!(matches!(
            try_lock_dir(&jd, live.id()).unwrap(),
            LockOutcome::Busy
        ));
        drop(live);
        again.lock().unwrap();
    }

    #[test]
    fn remove_and_list_clean_up() {
        let t = tempfile::tempdir().unwrap();
        let jd = t.path().join("j");
        let a = sample(&jd);
        let b = sample(&jd);
        let b_id = b.id().to_owned();
        a.remove().unwrap();
        assert_eq!(list(&jd).unwrap(), vec![Listed { id: b_id }]);
        // A half-deleted journal is finished off by list.
        fs::create_dir_all(jd.join(".trash-x")).unwrap();
        list(&jd).unwrap();
        assert!(!jd.join(".trash-x").exists());
        assert_eq!(list(&t.path().join("absent")).unwrap(), vec![]);
    }
}
