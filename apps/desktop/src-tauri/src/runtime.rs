//! The Hermes runtime the app carries (ADR-0023): a relocatable Python and a pinned, unmodified Hermes in one archive
//! (`hermes-runtime-<os>-<arch>.tar.zst`, built by `scripts/build-runtime.sh`) with a `runtime.json` beside it.
//!
//! On first run the host unpacks it into `<app data>/runtime/<hermes version>-<sha8>/`:
//! - the archive is **hashed before anything is extracted** (`unpack`): only a file whose SHA-256 is the manifest's is opened
//!   as a tar. The bytes are hashed a second time as they extract, from the same open file, so a file changed in place
//!   between the passes is a mismatch too. The tree is built in a temporary directory that a mismatch or any other
//!   failure removes, and nothing in it is run or put in place before both hashes agree. The unpack is bounded by the
//!   manifest's size and entry count plus a margin, makes no device node or FIFO, and drops setuid, setgid and sticky;
//! - the tree is built in `.unpack-<id>-<pid>/` and moved into place with one `rename`, so the final directory is either
//!   complete or absent, and a crash leaves only a temporary directory the next run removes;
//! - running it again is a no-op (the marker file, written last, names the archive's hash);
//! - older versions are removed by [`remove_old`], which the setup calls only after the gateway runs on the new one,
//!   and which only ever removes directories this module made (they hold the marker file).
//!
//! The archive is also a Tauri resource, so the installer carries it once, already compressed.

use std::cell::RefCell;
use std::fs::File;
use std::io::{self, Read, Seek};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::hermes::discover::Bundled;

mod unpack;

/// The manifest's file name, beside the archive.
pub const MANIFEST_FILE: &str = "runtime.json";
/// Written last inside an unpacked runtime: its presence and hash say the unpack finished.
const MARKER_FILE: &str = ".hx-runtime.json";
const TMP_PREFIX: &str = ".unpack-";
const LOCK_FILE: &str = ".lock";
/// The manifest schema this host reads.
pub const SCHEMA: u32 = 1;

/// The archive's entry in the manifest.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Archive {
    /// The file name, beside `runtime.json`.
    pub name: String,
    /// Lowercase hex SHA-256 of the file.
    pub sha256: String,
    /// Its size in bytes.
    pub size: u64,
}

/// `runtime.json`, as `scripts/build-runtime.sh` writes it.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Manifest {
    /// The schema version.
    pub schema: u32,
    /// Hermes's release, `0.23.2`.
    pub hermes_version: String,
    /// The interpreter's build, `3.14.9+20261021`.
    pub python_version: String,
    /// Hermes's name for the platform, `linux-x64`.
    pub target: String,
    /// Hermes's launcher, relative to the unpacked root.
    pub hermes: String,
    /// The bundled interpreter, relative to the unpacked root.
    pub python: String,
    /// The archive.
    pub archive: Archive,
    /// Bytes on disk once unpacked (about, from `du`). Required: it bounds the unpack.
    #[serde(default)]
    pub unpacked_size: u64,
    /// How many entries the archive holds. Optional: without it the cap is derived from `unpacked_size`.
    #[serde(default)]
    pub entries: u64,
    /// The plugins the runtime carries (`plugins/<name>/` in the archive, ADR-0030), each by the name the engine lists it by.
    /// Every bot gets them too (ADR-0042). Optional: an older `runtime.json` names none.
    #[serde(default)]
    pub plugins: Vec<CarriedPlugin>,
}

/// One plugin a runtime carries, as `runtime.json` names it (the rest of its entry, the source and licence, is for people).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct CarriedPlugin {
    /// The directory name, which is the name the engine lists it by.
    pub name: String,
}

fn bad_manifest(m: impl Into<String>) -> Error {
    Error::Setup("hx.setup.runtime_manifest_invalid", m.into())
}

/// A plain relative path: no root, no `..`, no empty parts.
fn plain_relative(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').all(|c| !c.is_empty() && c != "." && c != "..")
}

impl Manifest {
    /// Check what the host relies on: a directory name made of it is a plain name, the paths stay inside the root.
    ///
    /// # Errors
    /// `hx.setup.runtime_manifest_invalid` saying which field.
    pub fn validate(&self) -> Result<()> {
        if self.schema != SCHEMA {
            return Err(bad_manifest(format!(
                "runtime.json schema {} is not the {SCHEMA} this app reads",
                self.schema
            )));
        }
        let name_ok = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-' | '_'))
                && !s.starts_with('.')
        };
        if !name_ok(&self.hermes_version) {
            return Err(bad_manifest("hermes_version is not a plain version"));
        }
        let sha = &self.archive.sha256;
        if sha.len() != 64 || !sha.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
            return Err(bad_manifest(
                "archive.sha256 is not 64 lowercase hex digits",
            ));
        }
        if !plain_relative(&self.archive.name) || self.archive.name.contains('/') {
            return Err(bad_manifest("archive.name is not a plain file name"));
        }
        if self.unpacked_size == 0 {
            return Err(bad_manifest(
                "unpacked_size is missing: the unpack has to be bounded",
            ));
        }
        if !plain_relative(&self.hermes) || !plain_relative(&self.python) {
            return Err(bad_manifest(
                "hermes and python must be paths inside the archive",
            ));
        }
        Ok(())
    }

    /// The directory name of this runtime: `<hermes version>-<first 8 of the hash>`.
    #[must_use]
    pub fn id(&self) -> String {
        format!(
            "{}-{}",
            self.hermes_version,
            self.archive.sha256.get(..8).unwrap_or(&self.archive.sha256)
        )
    }
}

/// Where an unpacked runtime's files are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    /// `<runtime dir>/<id>/`.
    pub root: PathBuf,
    /// Hermes's launcher.
    pub hermes: PathBuf,
    /// The bundled interpreter.
    pub python: PathBuf,
}

/// Which pass over the archive a [`Progress`] belongs to. The archive is read twice: once to hash it before anything is
/// opened, once to extract it (hashed again as it goes), and each pass runs from 0 to the archive's size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Pass {
    /// Hashing the whole archive against the manifest. Nothing is written yet.
    Verify,
    /// Extracting into the temporary directory.
    Unpack,
}

/// How far a pass over the archive has come.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// Which pass.
    pub phase: Pass,
    /// Bytes of the archive read so far in this pass.
    pub read: u64,
    /// The archive's size, from the manifest (and checked against the file before the first byte is read).
    pub total: u64,
}

impl Progress {
    /// Whole percent, 0 to 100.
    #[must_use]
    pub fn percent(self) -> u8 {
        if self.total == 0 {
            return 0;
        }
        u8::try_from((self.read.saturating_mul(100) / self.total).min(100)).unwrap_or(100)
    }
}

/// What [`Runtime::install`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// This runtime was already unpacked; nothing was read or written.
    Current,
    /// It was unpacked now.
    Unpacked,
}

/// The runtime the app carries: its manifest and the directory that holds it and the archive.
#[derive(Debug, Clone)]
pub struct Runtime {
    dir: PathBuf,
    manifest: Manifest,
}

impl Runtime {
    /// Read and validate `<dir>/runtime.json`.
    ///
    /// # Errors
    /// `hx.setup.runtime_manifest_invalid` when it is unreadable or not valid.
    pub fn read(dir: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(dir.join(MANIFEST_FILE))
            .map_err(|e| bad_manifest(format!("cannot read {MANIFEST_FILE}: {e}")))?;
        let manifest: Manifest = serde_json::from_str(&text)
            .map_err(|e| bad_manifest(format!("{MANIFEST_FILE} is not valid: {e}")))?;
        manifest.validate()?;
        Ok(Self {
            dir: dir.to_path_buf(),
            manifest,
        })
    }

    /// The runtime the app carries, if this build does: `<resource dir>/runtime/runtime.json`. A debug or source build
    /// carries none and so uses the Hermes it finds (`BOOPIS_HERMES`).
    ///
    /// # Errors
    /// A manifest that is there but invalid is an error (a broken build must not look like a build without one).
    pub fn locate(resource_dir: Option<&Path>) -> Result<Option<Self>> {
        let Some(dir) = resource_dir.map(|r| r.join("runtime")) else {
            return Ok(None);
        };
        if !dir.join(MANIFEST_FILE).is_file() {
            return Ok(None);
        }
        Self::read(&dir).map(Some)
    }

    /// The manifest.
    #[must_use]
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// Where the runtime goes under `runtimes_dir`, without touching the disk.
    #[must_use]
    pub fn layout(&self, runtimes_dir: &Path) -> Layout {
        let root = runtimes_dir.join(self.manifest.id());
        Layout {
            hermes: root.join(&self.manifest.hermes),
            python: root.join(&self.manifest.python),
            root,
        }
    }

    /// Whether the runtime is already unpacked under `runtimes_dir` (read-only).
    #[must_use]
    pub fn is_installed(&self, runtimes_dir: &Path) -> bool {
        self.is_current(&self.layout(runtimes_dir))
    }

    fn is_current(&self, layout: &Layout) -> bool {
        let marker = std::fs::read(layout.root.join(MARKER_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<Marker>(&b).ok());
        marker.is_some_and(|m| m.archive_sha256 == self.manifest.archive.sha256)
            && layout.hermes.is_file()
            && layout.python.is_file()
    }

    /// Unpack into `<runtimes_dir>/<id>/` unless it is already there. `progress` is called as the archive is read.
    ///
    /// # Errors
    /// `hx.setup.runtime_missing` (no archive, or not the size the manifest says), `hx.setup.runtime_hash_mismatch`,
    /// `hx.setup.runtime_corrupt` (an entry outside the root, no launcher in it) and `hx.setup.runtime_unpack_failed`
    /// (the disk). Nothing is left in place on any of them.
    pub fn install(
        &self,
        runtimes_dir: &Path,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<(Layout, Outcome)> {
        let io_err =
            |what: &str, e: &io::Error| unpack_failed(what, e, &self.manifest, runtimes_dir);
        std::fs::create_dir_all(runtimes_dir).map_err(|e| io_err("create", &e))?;
        let _lock = lock(runtimes_dir).map_err(|e| io_err("lock", &e))?;
        let layout = self.layout(runtimes_dir);
        if self.is_current(&layout) {
            return Ok((layout, Outcome::Current));
        }
        // Not complete (or not there): whatever is at the final path was not made by a finished unpack.
        if layout.root.exists() {
            std::fs::remove_dir_all(&layout.root).map_err(|e| io_err("clear", &e))?;
        }
        remove_stale_temporaries(runtimes_dir);

        let tmp = runtimes_dir.join(format!(
            "{TMP_PREFIX}{}-{}",
            self.manifest.id(),
            std::process::id()
        ));
        let result = self.unpack_into(&tmp, progress).and_then(|()| {
            check_launchers(&self.manifest, &tmp)?;
            write_marker(&tmp, &self.manifest).map_err(|e| io_err("finish", &e))?;
            std::fs::rename(&tmp, &layout.root).map_err(|e| io_err("switch", &e))?;
            sync_dir(runtimes_dir);
            Ok(())
        });
        if let Err(e) = result {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e);
        }
        Ok((layout, Outcome::Unpacked))
    }

    fn unpack_into(&self, tmp: &Path, progress: &mut dyn FnMut(Progress)) -> Result<()> {
        let archive_path = self.dir.join(&self.manifest.archive.name);
        let expected = &self.manifest.archive;
        let missing = |why: String| Error::Setup("hx.setup.runtime_missing", why);
        let meta = std::fs::metadata(&archive_path).map_err(|e| {
            missing(format!(
                "this app is missing its Hermes runtime ({}: {e}); reinstall the app",
                archive_path.display()
            ))
        })?;
        if meta.len() != expected.size {
            return Err(missing(format!(
                "the Hermes runtime is {} bytes, the manifest says {}; reinstall the app",
                meta.len(),
                expected.size
            )));
        }
        let io_err = |what: &str, e: &io::Error| {
            unpack_failed(what, e, &self.manifest, tmp.parent().unwrap_or(tmp))
        };
        let mut file = File::open(&archive_path).map_err(|e| io_err("open", &e))?;
        // Verify first: nothing is extracted from a file that does not hash to the manifest's value.
        let mut last = u8::MAX;
        let first = unpack::hash_file(&mut file, &mut |read| {
            let p = Progress {
                phase: Pass::Verify,
                read,
                total: expected.size,
            };
            if p.percent() != last {
                last = p.percent();
                progress(p);
            }
        })
        .map_err(|e| io_err("read", &e))?;
        if first != expected.sha256 {
            return Err(hash_mismatch(&expected.sha256, &first));
        }
        file.rewind().map_err(|e| io_err("read", &e))?;
        let tally = Rc::new(RefCell::new(Tally::default()));
        let decoder = zstd::stream::read::Decoder::new(Hashing {
            inner: file,
            tally: Rc::clone(&tally),
        })
        .map_err(|e| io_err("read", &e))?;
        let _ = std::fs::remove_dir_all(tmp);
        std::fs::create_dir_all(tmp).map_err(|e| io_err("create", &e))?;
        let mut tar = tar::Archive::new(decoder);
        // Not "preserve": the extractor then keeps only the 0o777 bits of an entry's mode, so setuid, setgid and sticky
        // never reach the disk (the tests pin it). Owners are the user's own.
        tar.set_preserve_permissions(false);
        tar.set_preserve_ownerships(false);
        tar.set_unpack_xattrs(false);
        let mut caps = unpack::Caps::for_manifest(&self.manifest);
        let mut last = u8::MAX;
        for entry in tar.entries().map_err(|e| corrupt_or_io(&e, &io_err))? {
            let mut entry = entry.map_err(|e| corrupt_or_io(&e, &io_err))?;
            caps.admit(&entry)?;
            let inside = entry
                .unpack_in(tmp)
                .map_err(|e| corrupt_or_io(&e, &io_err))?;
            if !inside {
                return Err(Error::Setup(
                    "hx.setup.runtime_corrupt",
                    "the Hermes runtime has an entry outside its own folder; reinstall the app"
                        .into(),
                ));
            }
            let p = Progress {
                phase: Pass::Unpack,
                read: tally.borrow().bytes,
                total: expected.size,
            };
            if p.percent() != last {
                last = p.percent();
                progress(p);
            }
        }
        // The tar ends before the compressed stream does: read the rest so the hash covers every byte.
        let mut rest = tar.into_inner().finish();
        io::copy(&mut rest, &mut io::sink()).map_err(|e| io_err("read", &e))?;
        if last != 100 {
            progress(Progress {
                phase: Pass::Unpack,
                read: expected.size,
                total: expected.size,
            });
        }
        // The bytes that were extracted are the bytes that were verified (the caller removes the tree on an error).
        let found = hex::encode(tally.borrow().hasher.clone().finalize());
        if found != expected.sha256 {
            return Err(hash_mismatch(&expected.sha256, &found));
        }
        Ok(())
    }
}

fn hash_mismatch(expected: &str, found: &str) -> Error {
    Error::Setup(
        "hx.setup.runtime_hash_mismatch",
        format!(
            "the bundled Hermes runtime failed its integrity check (expected {}, found {}); nothing was installed. Reinstall the app",
            short(expected),
            short(found)
        ),
    )
}

fn short(hash: &str) -> &str {
    hash.get(..12).unwrap_or(hash)
}

/// A tar or zstd failure on a stream that hashes wrong anyway reads as "corrupt"; a disk failure as itself.
fn corrupt_or_io(e: &io::Error, io_err: &dyn Fn(&str, &io::Error) -> Error) -> Error {
    match e.kind() {
        io::ErrorKind::StorageFull
        | io::ErrorKind::PermissionDenied
        | io::ErrorKind::ReadOnlyFilesystem
        | io::ErrorKind::QuotaExceeded => io_err("write", e),
        _ => Error::Setup(
            "hx.setup.runtime_corrupt",
            format!("the bundled Hermes runtime cannot be read ({e}); reinstall the app"),
        ),
    }
}

fn unpack_failed(what: &str, e: &io::Error, m: &Manifest, dir: &Path) -> Error {
    let detail = if matches!(
        e.kind(),
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded
    ) {
        format!(
            "there is not enough disk space: the runtime needs about {} MB in {}",
            m.unpacked_size / 1_000_000,
            dir.display()
        )
    } else {
        format!("could not {what} in {}: {e}", dir.display())
    };
    Error::Setup(
        "hx.setup.runtime_unpack_failed",
        format!("unpacking Hermes failed: {detail}"),
    )
}

#[derive(Default)]
struct Tally {
    hasher: Sha256,
    bytes: u64,
}

/// A reader that hashes what passes through it.
struct Hashing<R> {
    inner: R,
    tally: Rc<RefCell<Tally>>,
}

impl<R: Read> Read for Hashing<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        let mut t = self.tally.borrow_mut();
        t.hasher.update(&buf[..n]);
        t.bytes += n as u64;
        Ok(n)
    }
}

#[derive(Serialize, Deserialize)]
struct Marker {
    archive_sha256: String,
    hermes_version: String,
    python_version: String,
}

fn write_marker(root: &Path, m: &Manifest) -> io::Result<()> {
    let marker = Marker {
        archive_sha256: m.archive.sha256.clone(),
        hermes_version: m.hermes_version.clone(),
        python_version: m.python_version.clone(),
    };
    let file = File::create(root.join(MARKER_FILE))?;
    serde_json::to_writer_pretty(&file, &marker).map_err(io::Error::other)?;
    file.sync_all()
}

fn check_launchers(m: &Manifest, root: &Path) -> Result<()> {
    for rel in [&m.hermes, &m.python] {
        if !root.join(rel).is_file() {
            return Err(Error::Setup(
                "hx.setup.runtime_corrupt",
                format!("the Hermes runtime has no {rel}; reinstall the app"),
            ));
        }
    }
    Ok(())
}

fn lock(runtimes_dir: &Path) -> io::Result<File> {
    let file = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(runtimes_dir.join(LOCK_FILE))?;
    file.lock()?;
    Ok(file)
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn remove_stale_temporaries(runtimes_dir: &Path) {
    let Ok(rd) = std::fs::read_dir(runtimes_dir) else {
        return;
    };
    for entry in rd.flatten() {
        if entry.file_name().to_string_lossy().starts_with(TMP_PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Remove every runtime this module unpacked except `keep`, and any abandoned temporary directory. A directory without
/// the marker file is not ours and is left alone. Call it once the gateway runs on `keep`: a gateway of an older
/// runtime may still be loading modules from its own folder until then.
///
/// Returns the directories removed.
#[must_use]
pub fn remove_old(runtimes_dir: &Path, keep: &Path) -> Vec<PathBuf> {
    let Ok(_lock) = lock(runtimes_dir) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    let Ok(rd) = std::fs::read_dir(runtimes_dir) else {
        return removed;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path == keep || !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let ours = entry.file_name().to_string_lossy().starts_with(TMP_PREFIX)
            || path.join(MARKER_FILE).is_file();
        if ours && std::fs::remove_dir_all(&path).is_ok() {
            removed.push(path);
        }
    }
    removed
}

/// The private Hermes home inside the app's data folder: `engine`, because the user may see the path (a bot's folder
/// is `<data dir>/engine/profiles/<name>`) and boopis's engine is never named to them (ADR-0031). Builds before that
/// called it [`OLD_HOME_DIR`]; `migrate::engine_home` moves it once.
pub const HOME_DIR: &str = "engine";

/// What the private home was called before ADR-0031. Read only by the one-time move.
pub const OLD_HOME_DIR: &str = "hermes-home";

/// The runtime this build carries and where the app keeps its data: everything first-run setup needs to put it in place.
#[derive(Debug, Clone)]
pub struct Plan {
    /// The bundled runtime.
    pub runtime: Runtime,
    /// The app's data directory (`~/.local/share/dev.aphesist.boopis`).
    pub data_dir: PathBuf,
}

impl Plan {
    /// Where unpacked runtimes live: `<data dir>/runtime`.
    #[must_use]
    pub fn runtimes_dir(&self) -> PathBuf {
        self.data_dir.join("runtime")
    }

    /// The private `HERMES_HOME`: `<data dir>/engine`. Never the user's `~/.hermes`. The one exception is a start where
    /// the one-time move could not run yet (`migrate::engine_home` found a gateway that would not stop): the old folder
    /// is then used as it is, and moved on the next start.
    #[must_use]
    pub fn home(&self) -> PathBuf {
        let (new, old) = (
            self.data_dir.join(HOME_DIR),
            self.data_dir.join(OLD_HOME_DIR),
        );
        if !new.exists() && old.is_dir() {
            old
        } else {
            new
        }
    }

    /// The environment that makes this runtime the only Hermes (its launcher path is known before it is unpacked).
    #[must_use]
    pub fn bundled(&self) -> Bundled {
        Bundled {
            binary: self.runtime.layout(&self.runtimes_dir()).hermes,
            home: self.home(),
            pycache: self.data_dir.join("cache").join("pycache"),
            locks: self.data_dir.join("locks"),
        }
    }
}

/// Which Hermes the app runs: the one it carries, or one the user already has (`boopis --engine existing`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// The bundled runtime, in a private home (the default).
    #[default]
    Bundled,
    /// The `hermes` found on the machine, in the user's own home (`HERMES_HOME`, else `~/.hermes`).
    Existing,
}

impl Source {
    /// `bundled` or `existing`, in any case.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "bundled" => Some(Self::Bundled),
            "existing" => Some(Self::Existing),
            _ => None,
        }
    }

    /// The choice from `BOOPIS_HERMES` (wins), else the saved one, else the bundled runtime.
    #[must_use]
    pub fn resolve(from_env: Option<&str>, saved: Option<&str>) -> Self {
        from_env
            .and_then(Self::parse)
            .or_else(|| saved.and_then(Self::parse))
            .unwrap_or_default()
    }

    /// The choice for this process: `boopis --engine <word>` (wins), else `BOOPIS_HERMES`, else the bundled runtime.
    /// Neither is named in the app (ADR-0031); `docs/ENGINE.md` documents both.
    #[must_use]
    pub fn from_process() -> Self {
        CLI_CHOICE
            .get()
            .copied()
            .unwrap_or_else(|| Self::resolve(std::env::var("BOOPIS_HERMES").ok().as_deref(), None))
    }
}

/// What `boopis --engine <word>` chose for this run.
static CLI_CHOICE: std::sync::OnceLock<Source> = std::sync::OnceLock::new();

/// Record `boopis --engine <word>` for this process (the first call wins).
pub fn choose_for_this_run(choice: Source) {
    let _ = CLI_CHOICE.set(choice);
}

impl Source {
    /// The word `--engine` and `BOOPIS_HERMES` take.
    #[must_use]
    pub fn word(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::Existing => "existing",
        }
    }
}

/// Which engine this run uses, for the first-run screen's words (`engine_source_get`). The choice itself is made on the
/// command line or in the environment only (ADR-0031), so there is nothing to save here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct EngineView {
    /// Which engine this run started with.
    pub running: Source,
    /// Whether this build carries an engine at all (a source build does not, and always uses the machine's).
    pub carries_runtime: bool,
}

/// The Hermes this run uses, from the choice, the build and the app's data folder: the plan to unpack and run the bundled
/// runtime, or the reason it cannot be used (`runtime_error`, shown by setup). `(None, None)` is the user's own Hermes:
/// chosen, or because this build carries no runtime.
#[must_use]
pub fn plan_for(
    source: Source,
    resource_dir: Option<&Path>,
    data_dir: std::result::Result<PathBuf, String>,
) -> (Option<Plan>, Option<String>) {
    match (source, data_dir) {
        (Source::Existing, _) => (None, None),
        (Source::Bundled, Err(e)) => (
            None,
            Some(format!(
                "the app has no data folder to unpack Hermes into: {e}"
            )),
        ),
        (Source::Bundled, Ok(data_dir)) => match Runtime::locate(resource_dir) {
            Ok(Some(runtime)) => (Some(Plan { runtime, data_dir }), None),
            Ok(None) => {
                tracing::info!(
                    "this build carries no Hermes runtime; using the Hermes on this machine"
                );
                (None, None)
            }
            Err(e) => {
                tracing::error!(error = %e, "the bundled Hermes runtime is unusable");
                (None, Some(e.to_string()))
            }
        },
    }
}

#[cfg(test)]
pub(crate) mod tests;
