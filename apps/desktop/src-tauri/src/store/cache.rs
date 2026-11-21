//! What the store keeps on disk under `<app data>/store/`: each source's normalised catalogue with its `ETag` and the time it was
//! read (`catalog/<source>.json`), the sources the user added and which are switched off (`sources.json`), and the host's record
//! of what it installed itself (`installed.json`: connectors and hub skills). Writes are atomic (a temporary file, then a
//! rename), so a crash leaves the last good copy. A file that does not parse is treated as absent, never as an error: the
//! cache is a copy, and the source is the truth.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::normalize::Entry;
use super::types::{InstallPlan, InstallReceipt, StoreSource};
use crate::error::{Error, Result};

/// One source's cached catalogue.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SourceCache {
    /// When it was read (RFC 3339, UTC).
    pub fetched_at: Option<String>,
    /// The `ETag` of the last answer, for a conditional request.
    pub etag: Option<String>,
    /// The items.
    pub entries: Vec<Entry>,
    /// Why the last refresh failed, in words; `None` when it worked.
    pub error: Option<String>,
    /// The last refresh could not reach the source.
    pub offline: bool,
}

/// The user's choices about sources.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct UserSources {
    /// Sources the user added.
    pub added: Vec<StoreSource>,
    /// Built-in and added sources switched on or off, by id. A source not here has its default.
    pub enabled: std::collections::BTreeMap<String, bool>,
}

/// What the host installed itself, for one bot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HostRecord {
    /// The bot (an engine profile).
    pub bot: String,
    /// The receipt.
    pub receipt: InstallReceipt,
    /// The plan that was accepted.
    pub plan: InstallPlan,
    /// What the layer needs to remove it again (a bundle folder, an engine name).
    pub extra: Value,
}

/// `installed.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Installed {
    /// The records.
    pub items: Vec<HostRecord>,
}

/// The store's folder.
#[derive(Debug, Clone)]
pub struct Cache {
    root: PathBuf,
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| Error::Io(format!("cannot make the store folder: {e}")))?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| Error::Io(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        Error::Io(e.to_string())
    })
}

fn read<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// A source id is a file name, so it is checked: lowercase letters, digits and `-`.
fn id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl Cache {
    /// The cache at `root` (`<app data>/store`).
    #[must_use]
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_owned(),
        }
    }

    /// The store's folder.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn source_path(&self, id: &str) -> Option<PathBuf> {
        id_ok(id).then(|| self.root.join("catalog").join(format!("{id}.json")))
    }

    /// A source's cached catalogue.
    #[must_use]
    pub fn source(&self, id: &str) -> Option<SourceCache> {
        read(&self.source_path(id)?)
    }

    /// Save a source's catalogue.
    ///
    /// # Errors
    /// `Io`; `InvalidInput` for an id that is not one.
    pub fn save_source(&self, id: &str, c: &SourceCache) -> Result<()> {
        let p = self
            .source_path(id)
            .ok_or_else(|| Error::InvalidInput("not a source id".into()))?;
        atomic_write(
            &p,
            &serde_json::to_vec(c).map_err(|e| Error::Io(e.to_string()))?,
        )
    }

    /// Delete a source's catalogue.
    pub fn remove_source(&self, id: &str) {
        if let Some(p) = self.source_path(id) {
            let _ = fs::remove_file(p);
        }
    }

    /// The user's source choices.
    #[must_use]
    pub fn user_sources(&self) -> UserSources {
        read(&self.root.join("sources.json")).unwrap_or_default()
    }

    /// Save them.
    ///
    /// # Errors
    /// `Io`.
    pub fn save_user_sources(&self, u: &UserSources) -> Result<()> {
        atomic_write(
            &self.root.join("sources.json"),
            &serde_json::to_vec_pretty(u).map_err(|e| Error::Io(e.to_string()))?,
        )
    }

    /// What the host installed itself.
    #[must_use]
    pub fn installed(&self) -> Installed {
        read(&self.root.join("installed.json")).unwrap_or_default()
    }

    /// Save it.
    ///
    /// # Errors
    /// `Io`.
    pub fn save_installed(&self, i: &Installed) -> Result<()> {
        atomic_write(
            &self.root.join("installed.json"),
            &serde_json::to_vec_pretty(i).map_err(|e| Error::Io(e.to_string()))?,
        )
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_catalogue_reads_back_and_a_damaged_file_is_absent() {
        let d = tempfile::tempdir().unwrap();
        let c = Cache::new(d.path());
        assert!(c.source("boopis").is_none());
        let s = SourceCache {
            fetched_at: Some("2026-11-21T09:30:00Z".into()),
            etag: Some("\"v1\"".into()),
            ..SourceCache::default()
        };
        c.save_source("boopis", &s).unwrap();
        assert_eq!(c.source("boopis").unwrap(), s);
        std::fs::write(d.path().join("catalog/boopis.json"), b"{ not json").unwrap();
        assert!(
            c.source("boopis").is_none(),
            "a copy that does not parse is no copy"
        );
        assert!(c.user_sources().added.is_empty());
        assert!(c.installed().items.is_empty());
    }

    #[test]
    fn a_source_id_that_is_a_path_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let c = Cache::new(d.path());
        for bad in ["../x", "a/b", "", "UPPER", "a.b"] {
            assert!(c.source(bad).is_none(), "{bad}");
            assert!(
                c.save_source(bad, &SourceCache::default()).is_err(),
                "{bad}"
            );
        }
        assert!(!d.path().join("x.json").exists());
    }
}
