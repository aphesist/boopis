//! Staging: bytes from a source become a folder under `<app data>/store/staging/<id>/`, and nothing in it runs (`docs/STORE.md`
//! 5.5 step 2). The rules are the runtime unpack's (`runtime/unpack.rs`), made stricter for bytes nobody at boopis built:
//!
//! - a **path** is relative, has no `..`, no empty or `.` part, no NUL, no backslash and stays under the root;
//! - **no link leaves the tree**: a symlink or hard link whose target is outside the root is refused; a symlink that stays inside
//!   is not kept (the plugin copies with links off, and the tree hash must see what it sees) and is noted as a finding;
//! - **no device node, FIFO or socket**, and **no setuid, setgid or sticky bit**: each is refused, never stripped;
//! - **caps**: entries, depth, one file, and the total expanded size (a bomb is stopped as it expands, not after);
//! - **digests**: the caller checks the archive's sha256 or the commit before it unpacks anything ([`sha256_hex`]);
//! - **the tree hash** ([`tree_sha256`]) is the compat trust store's `tree_hash` (`plugins/boopis/compat/trust.py`), byte for
//!   byte: golden vectors in the tests pin both sides.
//!
//! Zip files are read by a small reader here (stored and deflate, no zip64, no encryption), bounded the same way.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use flate2::read::{DeflateDecoder, GzDecoder};
use sha2::{Digest, Sha256};

use super::types::{FindingLevel, Scan, ScanFinding, ScanVerdict};
use crate::config::StoreLimits;
use crate::error::{Error, Result};

/// The name of the scanner that wrote a [`Scan`] here.
pub const SCANNER: &str = "boopis host check (patterns only)";

fn unsafe_archive(why: impl Into<String>) -> Error {
    Error::Store("hx.store.unsafe_archive", why.into())
}

fn too_large(why: impl Into<String>) -> Error {
    Error::Store("hx.store.too_large", why.into())
}

/// SHA-256 of `bytes`, lowercase hex.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// What an unpack produced.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Stats {
    /// Regular files written.
    pub files: u32,
    /// Bytes written.
    pub bytes: u64,
    /// Links inside the tree that were not kept.
    pub skipped_links: Vec<String>,
    /// The commit a GitHub tarball says it was made from (its pax header's `comment`), lowercase.
    pub commit: Option<String>,
}

/// The place an unpack writes to, and the running caps.
struct Sink {
    root: PathBuf,
    limits: StoreLimits,
    entries: u64,
    stats: Stats,
    seen: std::collections::BTreeSet<String>,
}

/// A path inside an archive, checked and split.
///
/// # Errors
/// `hx.store.unsafe_archive`.
fn clean(raw: &str, max_depth: usize) -> Result<Vec<String>> {
    if raw.contains('\0') || raw.contains('\\') {
        return Err(unsafe_archive("a path with a NUL or a backslash in it"));
    }
    let trimmed = raw.strip_suffix('/').unwrap_or(raw);
    let mut parts = Vec::new();
    for c in Path::new(trimmed).components() {
        match c {
            Component::Normal(p) => parts.push(p.to_string_lossy().into_owned()),
            Component::CurDir if parts.is_empty() && trimmed == "." => {}
            _ => return Err(unsafe_archive(format!("the path {raw:?} leaves the folder"))),
        }
    }
    if parts.iter().any(String::is_empty) {
        return Err(unsafe_archive("a path with an empty part"));
    }
    if parts.len() > max_depth {
        return Err(too_large("a path nested deeper than boopis accepts"));
    }
    Ok(parts)
}

/// Whether a link at `at` (the parts of its own path) pointing to `target` stays inside the root. Lexical: a link is never
/// followed here, so this is all there is to decide.
pub(super) fn link_stays_inside(at: &[String], target: &str) -> bool {
    if target.is_empty() || target.starts_with('/') || target.contains(['\0', '\\']) {
        return false;
    }
    let mut depth = i64::try_from(at.len().saturating_sub(1)).unwrap_or(i64::MAX);
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => depth += 1,
        }
    }
    true
}

impl Sink {
    fn new(root: &Path, limits: &StoreLimits) -> Result<Self> {
        fs::create_dir_all(root).map_err(|e| Error::Io(format!("cannot make the staging folder: {e}")))?;
        Ok(Self {
            root: root.to_owned(),
            limits: limits.clone(),
            entries: 0,
            stats: Stats::default(),
            seen: std::collections::BTreeSet::new(),
        })
    }

    fn count(&mut self) -> Result<()> {
        self.entries += 1;
        if self.entries > self.limits.max_entries {
            return Err(too_large(format!(
                "more than the {} entries boopis accepts",
                self.limits.max_entries
            )));
        }
        Ok(())
    }

    fn unique(&mut self, parts: &[String]) -> Result<()> {
        if !self.seen.insert(parts.join("/")) {
            return Err(unsafe_archive(format!("the path {:?} appears twice", parts.join("/"))));
        }
        Ok(())
    }

    fn mkdir(&mut self, parts: &[String]) -> Result<()> {
        self.count()?;
        if parts.is_empty() {
            return Ok(());
        }
        fs::create_dir_all(self.root.join(parts.join("/"))).map_err(|e| Error::Io(e.to_string()))
    }

    fn file(&mut self, parts: &[String], declared: u64, exec: bool, mut data: impl Read) -> Result<()> {
        self.count()?;
        if parts.is_empty() {
            return Err(unsafe_archive("a file with no name"));
        }
        self.unique(parts)?;
        if declared > self.limits.max_file_bytes {
            return Err(too_large(format!("a file larger than the {} MB boopis accepts", self.limits.max_file_bytes >> 20)));
        }
        let path = self.root.join(parts.join("/"));
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| Error::Io(e.to_string()))?;
        }
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(if exec { 0o755 } else { 0o644 });
        }
        let mut out = opts
            .open(&path)
            .map_err(|e| unsafe_archive(format!("a file boopis could not create ({e})")))?;
        // What is read is capped by the file cap, whatever the header said: a header that lies cannot expand past it.
        let mut limited = (&mut data).take(self.limits.max_file_bytes + 1);
        let mut buf = vec![0u8; 64 * 1024];
        let mut written = 0u64;
        loop {
            let n = limited.read(&mut buf).map_err(|e| unsafe_archive(format!("a damaged entry ({e})")))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > self.limits.max_file_bytes {
                return Err(too_large("a file expands past the size boopis accepts"));
            }
            if self.stats.bytes + written > self.limits.max_archive_bytes {
                return Err(too_large(format!(
                    "the archive expands past the {} MB boopis accepts",
                    self.limits.max_archive_bytes >> 20
                )));
            }
            out.write_all(&buf[..n]).map_err(|e| Error::Io(e.to_string()))?;
        }
        self.stats.bytes += written;
        self.stats.files += 1;
        Ok(())
    }

    fn symlink(&mut self, parts: &[String], target: &str) -> Result<()> {
        self.count()?;
        if !link_stays_inside(parts, target) {
            return Err(unsafe_archive(format!(
                "the link {:?} points outside the folder",
                parts.join("/")
            )));
        }
        self.stats.skipped_links.push(parts.join("/"));
        Ok(())
    }
}

/// Where in an archive to read from: its single top folder is dropped (GitHub's `owner-repo-sha/`), then `subdir` is entered.
#[derive(Debug, Clone, Default)]
pub struct Select {
    /// Drop the first path part of every entry.
    pub strip_top: bool,
    /// Keep only what is under this folder (after the strip), and root it.
    pub subdir: Option<String>,
}

impl Select {
    /// The parts of an entry's path under the selection, `None` when it is outside it.
    fn apply(&self, mut parts: Vec<String>) -> Option<Vec<String>> {
        if self.strip_top {
            if parts.is_empty() {
                return None;
            }
            parts.remove(0);
        }
        if let Some(sub) = &self.subdir {
            let want: Vec<&str> = sub.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() < want.len() || parts.iter().zip(&want).any(|(a, b)| a != b) {
                return None;
            }
            parts.drain(..want.len());
        }
        Some(parts)
    }
}

/// Unpack a gzip tar into `dest`.
///
/// # Errors
/// `hx.store.unsafe_archive`, `hx.store.too_large`, `hx.store.invalid_manifest` when it is not a tar.
pub fn unpack_tar_gz(bytes: &[u8], dest: &Path, select: &Select, limits: &StoreLimits) -> Result<Stats> {
    let mut sink = Sink::new(dest, limits)?;
    let decoder = GzDecoder::new(bytes).take(limits.max_archive_bytes.saturating_mul(2));
    let mut tar = tar::Archive::new(decoder);
    let entries = tar
        .entries()
        .map_err(|e| unsafe_archive(format!("not a readable archive ({e})")))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| unsafe_archive(format!("a damaged archive ({e})")))?;
        let kind = entry.header().entry_type();
        if kind.is_pax_global_extensions() {
            if let Ok(Some(ext)) = entry.pax_extensions() {
                for e in ext.flatten() {
                    if e.key() == Ok("comment")
                        && let Ok(v) = e.value()
                        && v.len() == 40
                        && v.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        sink.stats.commit = Some(v.to_ascii_lowercase());
                    }
                }
            }
            continue;
        }
        if kind.is_pax_local_extensions() || kind.is_gnu_longname() || kind.is_gnu_longlink() {
            continue;
        }
        let raw = entry
            .path()
            .map_err(|e| unsafe_archive(format!("an unreadable path ({e})")))?
            .to_string_lossy()
            .into_owned();
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink() || kind.is_hard_link()) {
            return Err(unsafe_archive(format!(
                "{raw:?} is a device, a pipe or another special file, which boopis never creates"
            )));
        }
        let mode = entry.header().mode().unwrap_or(0o644);
        if mode & 0o7000 != 0 {
            return Err(unsafe_archive(format!(
                "{raw:?} has a setuid, setgid or sticky bit, which boopis never keeps"
            )));
        }
        let parts = clean(&raw, limits.max_depth + 2)?;
        if kind.is_hard_link() {
            return Err(unsafe_archive(format!("{raw:?} is a hard link, which boopis does not unpack")));
        }
        let Some(rel) = select.apply(parts) else {
            sink.count()?;
            continue;
        };
        if rel.len() > limits.max_depth {
            return Err(too_large("a path nested deeper than boopis accepts"));
        }
        if kind.is_dir() {
            sink.mkdir(&rel)?;
        } else if kind.is_symlink() {
            let target = entry
                .link_name()
                .map_err(|e| unsafe_archive(format!("an unreadable link ({e})")))?
                .map(|t| t.to_string_lossy().into_owned())
                .unwrap_or_default();
            // The link's place is checked from the archive's root, so a link that climbs out of the selection is refused too.
            sink.symlink(&rel, &target)?;
        } else {
            let size = entry.size();
            sink.file(&rel, size, mode & 0o111 != 0, &mut entry)?;
        }
    }
    Ok(sink.stats)
}

// ---------------------------------------------------------------- zip

fn le16(b: &[u8], at: usize) -> Result<u16> {
    b.get(at..at + 2)
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or_else(|| unsafe_archive("a zip cut short"))
}

fn le32(b: &[u8], at: usize) -> Result<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or_else(|| unsafe_archive("a zip cut short"))
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, slot) in table.iter_mut().enumerate() {
        let mut c = u32::try_from(i).unwrap_or(0);
        for _ in 0..8 {
            c = if c & 1 == 1 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    !data.iter().fold(!0u32, |c, b| table[usize::from((c as u8) ^ *b)] ^ (c >> 8))
}

/// Unpack a zip into `dest`. Entries are read from the central directory; a stored or deflated entry is read up to its
/// declared size and checked against its CRC.
///
/// # Errors
/// `hx.store.unsafe_archive`, `hx.store.too_large`.
pub fn unpack_zip(bytes: &[u8], dest: &Path, select: &Select, limits: &StoreLimits) -> Result<Stats> {
    let mut sink = Sink::new(dest, limits)?;
    let tail_from = bytes.len().saturating_sub(22 + 65_535);
    let eocd = bytes[tail_from..]
        .windows(4)
        .rposition(|w| w == [0x50, 0x4b, 0x05, 0x06])
        .map(|p| p + tail_from)
        .ok_or_else(|| unsafe_archive("not a zip file"))?;
    let (total, cd_size, cd_off) = (le16(bytes, eocd + 10)?, le32(bytes, eocd + 12)?, le32(bytes, eocd + 16)?);
    if total == 0xFFFF || cd_size == 0xFFFF_FFFF || cd_off == 0xFFFF_FFFF {
        return Err(unsafe_archive("a zip64 file, which boopis does not read"));
    }
    if u64::from(total) > limits.max_entries {
        return Err(too_large("a zip with more entries than boopis accepts"));
    }
    let mut at = cd_off as usize;
    for _ in 0..total {
        if le32(bytes, at)? != 0x0201_4b50 {
            return Err(unsafe_archive("a damaged zip directory"));
        }
        let made_by = le16(bytes, at + 4)?;
        let flags = le16(bytes, at + 8)?;
        let method = le16(bytes, at + 10)?;
        let crc = le32(bytes, at + 16)?;
        let csize = le32(bytes, at + 20)? as usize;
        let usize_ = le32(bytes, at + 24)?;
        let (nlen, elen, clen) = (
            usize::from(le16(bytes, at + 28)?),
            usize::from(le16(bytes, at + 30)?),
            usize::from(le16(bytes, at + 32)?),
        );
        let eattr = le32(bytes, at + 38)?;
        let local = le32(bytes, at + 42)? as usize;
        let name = std::str::from_utf8(
            bytes
                .get(at + 46..at + 46 + nlen)
                .ok_or_else(|| unsafe_archive("a zip cut short"))?,
        )
        .map_err(|_| unsafe_archive("a path that is not UTF-8"))?
        .to_owned();
        at += 46 + nlen + elen + clen;
        if flags & 1 != 0 {
            return Err(unsafe_archive("an encrypted zip entry"));
        }
        let unix = made_by >> 8 == 3;
        let mode = if unix { eattr >> 16 } else { 0 };
        let ftype = mode & 0o170_000;
        if unix && matches!(ftype, 0o020_000 | 0o060_000 | 0o010_000 | 0o140_000) {
            return Err(unsafe_archive(format!("{name:?} is a device, a pipe or a socket")));
        }
        if unix && mode & 0o7000 != 0 {
            return Err(unsafe_archive(format!("{name:?} has a setuid, setgid or sticky bit")));
        }
        let parts = clean(&name, limits.max_depth + 2)?;
        let Some(rel) = select.apply(parts) else {
            sink.count()?;
            continue;
        };
        if name.ends_with('/') || ftype == 0o040_000 {
            sink.mkdir(&rel)?;
            continue;
        }
        if u64::from(usize_) > limits.max_file_bytes {
            return Err(too_large("a file larger than boopis accepts"));
        }
        if le32(bytes, local)? != 0x0403_4b50 {
            return Err(unsafe_archive("a damaged zip entry"));
        }
        let start = local + 30 + usize::from(le16(bytes, local + 26)?) + usize::from(le16(bytes, local + 28)?);
        let raw = bytes
            .get(start..start + csize)
            .ok_or_else(|| unsafe_archive("a zip entry cut short"))?;
        let mut data = Vec::new();
        let cap = u64::from(usize_) + 1;
        match method {
            0 => data.extend_from_slice(raw),
            8 => {
                DeflateDecoder::new(raw)
                    .take(cap)
                    .read_to_end(&mut data)
                    .map_err(|e| unsafe_archive(format!("a damaged entry ({e})")))?;
            }
            m => return Err(unsafe_archive(format!("a zip entry compressed with method {m}, which boopis does not read"))),
        }
        if data.len() as u64 != u64::from(usize_) || crc32(&data) != crc {
            return Err(unsafe_archive(format!("{name:?} does not match its recorded size or checksum")));
        }
        if ftype == 0o120_000 {
            sink.symlink(&rel, &String::from_utf8_lossy(&data))?;
        } else {
            sink.file(&rel, u64::from(usize_), unix && mode & 0o111 != 0, data.as_slice())?;
        }
    }
    Ok(sink.stats)
}

// ---------------------------------------------------------------- the tree hash

/// The compat trust store's `tree_hash` (`plugins/boopis/compat/trust.py`): SHA-256 over `relative/path\0sha256(content)` for every
/// regular file under `root`, paths in POSIX form sorted part by part (as Python sorts `Path`s), joined with `\n`, skipping any
/// path with a `.git` part. An unreadable file hashes as `unreadable`.
///
/// # Errors
/// `Io` when the folder cannot be read.
pub fn tree_sha256(root: &Path) -> Result<String> {
    let mut files: Vec<(Vec<String>, PathBuf)> = Vec::new();
    walk(root, &mut Vec::new(), &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut lines = Vec::with_capacity(files.len());
    for (parts, path) in &files {
        let digest = fs::read(path).map_or_else(|_| "unreadable".to_owned(), |b| sha256_hex(&b));
        lines.push(format!("{}\0{digest}", parts.join("/")));
    }
    Ok(sha256_hex(lines.join("\n").as_bytes()))
}

fn walk(dir: &Path, prefix: &mut Vec<String>, out: &mut Vec<(Vec<String>, PathBuf)>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(|e| Error::Io(e.to_string()))? {
        let entry = entry.map_err(|e| Error::Io(e.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let ft = entry.file_type().map_err(|e| Error::Io(e.to_string()))?;
        prefix.push(name);
        if ft.is_dir() {
            walk(&entry.path(), prefix, out)?;
        } else if ft.is_file() {
            out.push((prefix.clone(), entry.path()));
        }
        prefix.pop();
    }
    Ok(())
}

/// The relative paths of every regular file under `root`, sorted.
///
/// # Errors
/// `Io`.
pub fn list_files(root: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    walk(root, &mut Vec::new(), &mut files)?;
    let mut names: Vec<String> = files.into_iter().map(|(p, _)| p.join("/")).collect();
    names.sort();
    Ok(names)
}

// ---------------------------------------------------------------- the check

const DANGEROUS: &[(&str, &str)] = &[
    ("/dev/tcp/", "opens a raw network connection from the shell (a reverse shell)"),
    ("bash -i >&", "starts an interactive shell on a network connection"),
    ("nc -e ", "hands a shell to a network connection"),
    ("rm -rf /\n", "deletes the whole file system"),
    ("rm -rf / ", "deletes the whole file system"),
    ("rm -rf ~", "deletes the home folder"),
    (":(){ :|:& };:", "a fork bomb"),
    ("curl -d @", "uploads a file to a server"),
    ("curl --data-binary @", "uploads a file to a server"),
    ("wget --post-file", "uploads a file to a server"),
];

const CAUTION: &[(&str, &str)] = &[
    ("| sh", "pipes a download into a shell"),
    ("|sh", "pipes a download into a shell"),
    ("| bash", "pipes a download into a shell"),
    ("|bash", "pipes a download into a shell"),
    ("base64 -d", "decodes hidden text to run it"),
    ("base64 --decode", "decodes hidden text to run it"),
    ("eval $(", "runs text built at run time as a command"),
    ("ignore previous instructions", "tries to override the assistant's instructions"),
    ("ignore all previous instructions", "tries to override the assistant's instructions"),
    ("disregard your instructions", "tries to override the assistant's instructions"),
    (".ssh/id_", "mentions a private key"),
    (".aws/credentials", "mentions cloud credentials"),
];

const MAX_SCAN_FILE: u64 = 1024 * 1024;
const MAX_FINDINGS: usize = 50;

/// A pattern check over a staged tree: text files for what [`DANGEROUS`] and [`CAUTION`] name, and compiled programs. It is a
/// list of patterns and says so; it is not a review. The verdict is the highest level found.
///
/// # Errors
/// `Io`.
pub fn scan(root: &Path) -> Result<Scan> {
    let mut findings = Vec::new();
    for rel in list_files(root)? {
        if findings.len() >= MAX_FINDINGS {
            break;
        }
        let path = root.join(&rel);
        let Ok(meta) = fs::metadata(&path) else { continue };
        let mut head = Vec::new();
        if File::open(&path)
            .and_then(|f| f.take(meta.len().min(MAX_SCAN_FILE)).read_to_end(&mut head))
            .is_err()
        {
            continue;
        }
        if head.starts_with(b"\x7fELF") || head.starts_with(b"MZ") || head.starts_with(&[0xCF, 0xFA, 0xED, 0xFE]) {
            findings.push(ScanFinding {
                level: FindingLevel::Caution,
                text: "contains a compiled program, which boopis cannot read".into(),
                path: Some(rel.clone()),
            });
            continue;
        }
        let text = String::from_utf8_lossy(&head).to_ascii_lowercase();
        let mut hit = |level: FindingLevel, why: &str, list: &[(&str, &str)]| {
            for (needle, what) in list {
                if text.contains(needle) && !findings.iter().any(|f: &ScanFinding| f.path.as_deref() == Some(rel.as_str()) && f.text.ends_with(what)) {
                    findings.push(ScanFinding {
                        level,
                        text: format!("{why} {what}"),
                        path: Some(rel.clone()),
                    });
                }
            }
        };
        hit(FindingLevel::Dangerous, "this file", DANGEROUS);
        hit(FindingLevel::Caution, "this file", CAUTION);
        if rel.starts_with("scripts/") || rel.ends_with(".sh") || rel.ends_with(".py") || rel.ends_with(".js") {
            findings.push(ScanFinding {
                level: FindingLevel::Info,
                text: "is a script that can run once the item is active".into(),
                path: Some(rel.clone()),
            });
        }
    }
    findings.truncate(MAX_FINDINGS);
    let verdict = if findings.iter().any(|f| f.level == FindingLevel::Dangerous) {
        ScanVerdict::Dangerous
    } else if findings.iter().any(|f| f.level == FindingLevel::Caution) {
        ScanVerdict::Caution
    } else {
        ScanVerdict::Safe
    };
    Ok(Scan {
        verdict,
        scanner: SCANNER.to_owned(),
        findings,
    })
}

// ---------------------------------------------------------------- the staging folder

/// The staging area under the store's folder.
#[derive(Debug, Clone)]
pub struct Staging {
    root: PathBuf,
}

impl Staging {
    /// The area at `<store>/staging`.
    #[must_use]
    pub fn new(store_root: &Path) -> Self {
        Self {
            root: store_root.join("staging"),
        }
    }

    /// A staging id is `stg-` and 32 hex characters; anything else is not one (it is a path component, so it is checked).
    #[must_use]
    pub fn valid_id(id: &str) -> bool {
        id.strip_prefix("stg-")
            .is_some_and(|h| h.len() == 32 && h.bytes().all(|b| b.is_ascii_hexdigit()))
    }

    /// The folder of `id`.
    ///
    /// # Errors
    /// `hx.store.stage_missing` for an id that is not one or has no folder.
    pub fn dir(&self, id: &str) -> Result<PathBuf> {
        let missing = || Error::Store("hx.store.stage_missing", "the downloaded copy is gone".into());
        if !Self::valid_id(id) {
            return Err(missing());
        }
        let d = self.root.join(id);
        d.is_dir().then_some(d).ok_or_else(missing)
    }

    /// A new empty folder and its id.
    ///
    /// # Errors
    /// `Io`.
    pub fn create(&self) -> Result<(String, PathBuf)> {
        let id = format!("stg-{}", uuid::Uuid::now_v7().simple());
        let d = self.root.join(&id);
        fs::create_dir_all(&d).map_err(|e| Error::Io(e.to_string()))?;
        Ok((id, d))
    }

    /// Delete the folder of `id`; one that is not there is not an error.
    pub fn remove(&self, id: &str) {
        if Self::valid_id(id) {
            let _ = fs::remove_dir_all(self.root.join(id));
        }
    }

    /// Delete every folder older than `ttl`.
    pub fn sweep(&self, ttl: std::time::Duration) {
        let Ok(rd) = fs::read_dir(&self.root) else { return };
        for e in rd.flatten() {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > ttl);
            if old {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

// ---------------------------------------------------------------- a local folder

/// Copy the folder `src` into `dst` under the same caps. A symlink is never followed or copied: one that leaves the folder is
/// refused, one that stays inside is skipped (and counted in [`Stats::skipped_links`]); a file is copied as it is, with its exec bit.
///
/// # Errors
/// `hx.store.unsafe_archive`, `hx.store.too_large`, `Io`.
pub fn copy_tree(src: &Path, dst: &Path, limits: &StoreLimits) -> Result<Stats> {
    let mut sink = Sink::new(dst, limits)?;
    let root = fs::canonicalize(src).map_err(|e| Error::Io(format!("cannot read that folder: {e}")))?;
    copy_dir(&root, &root, &mut Vec::new(), &mut sink)?;
    Ok(sink.stats)
}

fn copy_dir(root: &Path, dir: &Path, parts: &mut Vec<String>, sink: &mut Sink) -> Result<()> {
    let mut names: Vec<_> = fs::read_dir(dir).map_err(|e| Error::Io(e.to_string()))?.flatten().collect();
    names.sort_by_key(std::fs::DirEntry::file_name);
    for e in names {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let ft = e.file_type().map_err(|e| Error::Io(e.to_string()))?;
        parts.push(name);
        if parts.len() > sink.limits.max_depth {
            return Err(too_large("a folder nested deeper than boopis accepts"));
        }
        if ft.is_symlink() {
            let target = fs::canonicalize(e.path()).ok();
            if !target.is_some_and(|t| t.starts_with(root)) {
                return Err(unsafe_archive(format!("the link {:?} points outside the folder", parts.join("/"))));
            }
            sink.count()?;
            sink.stats.skipped_links.push(parts.join("/"));
        } else if ft.is_dir() {
            sink.mkdir(parts)?;
            copy_dir(root, &e.path(), parts, sink)?;
        } else if ft.is_file() {
            #[cfg(unix)]
            let exec = {
                use std::os::unix::fs::PermissionsExt;
                e.metadata().map(|m| m.permissions().mode()).unwrap_or(0)
            };
            #[cfg(not(unix))]
            let exec = 0u32;
            if exec & 0o7000 != 0 {
                return Err(unsafe_archive(format!("{:?} has a setuid, setgid or sticky bit", parts.join("/"))));
            }
            let size = e.metadata().map_or(0, |m| m.len());
            let f = File::open(e.path()).map_err(|e| Error::Io(e.to_string()))?;
            sink.file(parts, size, exec & 0o111 != 0, f)?;
        } else {
            return Err(unsafe_archive(format!("{:?} is a device, a pipe or a socket", parts.join("/"))));
        }
        parts.pop();
    }
    Ok(())
}
