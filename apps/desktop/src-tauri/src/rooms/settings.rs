//! boopis's own settings for a room: today, how many rounds `boopis run` and the app let a discussion take.
//!
//! The engine has one pair of discussion limits for every room (`hosted_rooms.discussion.max_rounds` and `max_messages`,
//! read once when its gateway starts) and no per-room value anywhere in a room's own state, so a per-room cap cannot be
//! written where the engine reads it. It is boopis's: a small file in the app's own folder (`rooms.json`), read by the
//! command line and the app alike, and enforced by `boopis run` (`run.rs`), which keeps a discussion going with
//! `groups.continue` only while the room's total rounds are under it. The engine's own pause at its cap stays as it is.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The file's name, in the app's data folder.
pub const FILE: &str = "rooms.json";
/// The cap when neither the room nor the command says: thirty rounds, ten engine budgets of three.
pub const DEFAULT_MAX_ROUNDS: u32 = 30;
/// The largest cap a room may have.
pub const LIMIT_MAX_ROUNDS: u32 = 1_000;
const VERSION: u32 = 1;

/// What is kept for one room.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct One {
    /// The most rounds a discussion in this room may take through `boopis run`, or none set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_rounds: Option<u32>,
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSettings {
    version: u32,
    #[serde(default)]
    rooms: BTreeMap<String, One>,
}

impl Default for RoomSettings {
    fn default() -> Self {
        Self {
            version: VERSION,
            rooms: BTreeMap::new(),
        }
    }
}

/// `<app data>/rooms.json`, the same folder the app keeps its own files in.
#[must_use]
pub fn default_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(crate::gpu::APP_IDENTIFIER).join(FILE))
}

/// A room id is the engine's: letters, digits, `-` and `_`.
fn check_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidInput(format!("{id:?} is not a group id")))
    }
}

/// Check a cap.
///
/// # Errors
/// `InvalidInput` outside `1..=1000`.
pub fn check_rounds(n: u32) -> Result<u32> {
    if (1..=LIMIT_MAX_ROUNDS).contains(&n) {
        Ok(n)
    } else {
        Err(Error::InvalidInput(format!(
            "max rounds is 1 to {LIMIT_MAX_ROUNDS}, not {n}"
        )))
    }
}

impl RoomSettings {
    /// Read the file at `path`; a missing one is empty.
    ///
    /// # Errors
    /// `Config` when the file is there and is not this version's shape; nothing is overwritten then.
    pub fn load(path: &Path) -> Result<Self> {
        let text = match std::fs::read_to_string(path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(Error::Io(format!("{}: {e}", path.display()))),
        };
        let found: Self = serde_json::from_str(&text)
            .map_err(|e| Error::Config(format!("{}: {e}", path.display())))?;
        if found.version > VERSION {
            return Err(Error::Config(format!(
                "{}: this build reads version {VERSION}, found {}",
                path.display(),
                found.version
            )));
        }
        Ok(found)
    }

    /// The cap kept for a room.
    #[must_use]
    pub fn max_rounds(&self, room_id: &str) -> Option<u32> {
        self.rooms.get(room_id).and_then(|r| r.max_rounds)
    }

    /// Keep (or, with `None`, forget) a room's cap.
    ///
    /// # Errors
    /// `InvalidInput` for a bad id or cap.
    pub fn set_max_rounds(&mut self, room_id: &str, rounds: Option<u32>) -> Result<()> {
        check_id(room_id)?;
        match rounds {
            Some(n) => {
                self.rooms.entry(room_id.to_owned()).or_default().max_rounds =
                    Some(check_rounds(n)?);
            }
            None => {
                if let Some(r) = self.rooms.get_mut(room_id) {
                    r.max_rounds = None;
                }
                self.rooms.retain(|_, r| *r != One::default());
            }
        }
        Ok(())
    }

    /// Write the file: a temporary file in the same folder, then one rename.
    ///
    /// # Errors
    /// `Io` when it cannot be written.
    pub fn save(&self, path: &Path) -> Result<()> {
        let io = |e: std::io::Error| Error::Io(format!("{}: {e}", path.display()));
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(self).map_err(|e| Error::Config(e.to_string()))?;
        std::fs::write(&tmp, text + "\n").map_err(io)?;
        std::fs::rename(&tmp, path).map_err(io)
    }
}

/// The cap a run uses: the command's own, else the room's, else the default.
#[must_use]
pub fn effective(flag: Option<u32>, room: Option<u32>) -> u32 {
    flag.or(room).unwrap_or(DEFAULT_MAX_ROUNDS)
}
