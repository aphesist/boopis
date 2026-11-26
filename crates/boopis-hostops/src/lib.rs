//! The host-ops channel (`hx-host-ops-v1`, `docs/specs/team-ops.md` section 4, ADR-0061): how the plugin, running in the
//! gateway, asks the desktop host for team operations it may not do itself. It holds every part that does not need the app:
//!
//! - [`listen`]: the one local-socket listener both host channels use (the secret channel and this one): a `0600` socket in a
//!   `0700` folder, the kernel's peer check taken before the request is read, one line in and one out, caps and timeouts;
//! - [`protocol`]: the verbs (the whole list, pinned by a test), the request envelope and each verb's parameters;
//! - [`dispatch`]: one request line to one answer: the token, the verb, the idempotency key, the rate limit, the run table,
//!   the audit line, and the verbs this crate answers itself (`jobs.*`, `grant.redeem`); the rest go to the host's [`Ops`];
//! - [`runtable`], [`limits`], [`audit`], [`grants`], [`jobs`]: the stores and checks behind it;
//! - [`plans`]: team plans as files (`house/plans/<plan_hash>.json`): the fragment's merge, the hashes, the states, the checks
//!   an apply runs before anything is changed, and the snapshot.
//!
//! Nothing here applies, undoes, approves or answers anything: those are the owner's, in the window (section 3.2).

pub mod audit;
pub mod dispatch;
pub mod grants;
pub mod jobs;
pub mod limits;
pub mod listen;
pub mod plans;
pub mod protocol;
pub mod runtable;

#[cfg(test)]
mod tests;

use std::path::Path;

use serde_json::Value;
use sha2::{Digest, Sha256};

pub use dispatch::{Call, Dispatcher, OpFuture, Ops};
pub use protocol::{PROTOCOL, SOCKET_ENV, TOKEN_ENV};

/// A refusal: an `hx.*` code and a sentence that says what to do and never echoes the input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    /// The code (`crates/hx-proto/errors.json`).
    pub code: &'static str,
    /// What to do, in words.
    pub message: String,
}

impl Refusal {
    /// A refusal with `code` and `message`.
    #[must_use]
    pub fn new(code: &'static str, message: &str) -> Self {
        Self {
            code,
            message: message.to_owned(),
        }
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// The JSON of `v` with every object's keys sorted and no whitespace (contraprova's `canonical_json` rules, as
/// `store::plan::canonical` in the host writes them).
#[must_use]
pub fn canonical(v: &Value) -> String {
    fn go(v: &Value, out: &mut String) {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&Value::String(k.clone()).to_string());
                    out.push(':');
                    go(&m[k], out);
                }
                out.push('}');
            }
            Value::Array(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    go(x, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut s = String::new();
    go(v, &mut s);
    s
}

/// SHA-256 of `bytes`, in lowercase hex.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The first 12 hex of SHA-256 of an idempotency key: what the audit trail and event ids carry instead of the key.
#[must_use]
pub fn key_digest(key: &str) -> String {
    sha256_hex(key.as_bytes())[..12].to_owned()
}

/// A fresh 256-bit token, hex (a channel's per-launch token, an owner grant).
///
/// # Errors
/// When the system has no random bytes.
pub fn token() -> Result<String, Refusal> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| Refusal::new("hx.host.store_failed", "The system gave no random bytes."))?;
    Ok(hex::encode(bytes))
}

/// Milliseconds since the Unix epoch, now.
#[must_use]
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// `ms` since the epoch as an RFC 3339 UTC time with milliseconds (`2026-11-26T09:30:00.000Z`).
#[must_use]
pub fn rfc3339(ms: u64) -> String {
    let secs = ms / 1000;
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        ms % 1000
    )
}

/// Write `bytes` to `path` atomically and privately: a temporary file beside it (mode `0600`), fsync, rename, then the
/// folder's fsync. The folder is made (`0700`) when missing.
///
/// # Errors
/// `hx.host.store_failed` when any step fails; nothing is half written.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), Refusal> {
    use std::io::Write;
    let failed = |_| {
        Refusal::new(
            "hx.host.store_failed",
            "boopis could not save its record of this. Try again; nothing was done.",
        )
    };
    let dir = path
        .parent()
        .ok_or_else(|| failed(std::io::Error::other("no folder")))?;
    make_private_dir(dir).map_err(failed)?;
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(failed)?;
    file.write_all(bytes).map_err(failed)?;
    file.sync_all().map_err(failed)?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        failed(e)
    })?;
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

/// Append one line to `path` (made `0600` when new), rotating it to `<path>.1` past `cap` bytes.
///
/// # Errors
/// `hx.host.store_failed` when the line cannot be written.
pub fn append_private(path: &Path, line: &str, cap: u64) -> Result<(), Refusal> {
    use std::io::Write;
    let failed = |_| {
        Refusal::new(
            "hx.host.store_failed",
            "boopis could not save its record of this. Try again; nothing was done.",
        )
    };
    if let Some(dir) = path.parent() {
        make_private_dir(dir).map_err(failed)?;
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() > cap) {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        std::fs::rename(path, rotated).map_err(failed)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(failed)?;
    file.write_all(format!("{line}\n").as_bytes())
        .map_err(failed)?;
    file.sync_data().map_err(failed)
}

fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(dir)
}
