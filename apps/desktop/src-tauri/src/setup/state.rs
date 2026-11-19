//! Setup's progress, kept at `<profile home>/hypotaxis/setup.json` so the flow resumes after an interruption. It holds
//! only decisions (consent, a choice) and what is still to do, never a secret. Versioned and written atomically.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The file's schema version.
pub const VERSION: u32 = 1;

/// The user's answer to the Hermes configuration form.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Consent {
    /// Not asked yet, or asked again.
    #[default]
    Unasked,
    /// The user accepted the diff.
    Granted,
    /// The user declined.
    Declined,
}

/// Everything setup remembers between calls.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct State {
    /// The schema version.
    pub schema_version: u32,
    /// The configuration consent.
    pub consent: Consent,
    /// The ladder choice (`provider/model`), when the user made one.
    pub choice: Option<String>,
    /// The form the host last showed, so an answer is checked against it.
    pub pending_form: Option<String>,
    /// Hermes has changes (a new plugin, new configuration, a new key) that need a gateway restart to take effect.
    pub restart_pending: bool,
    /// When setup last finished (seconds since the Unix epoch).
    pub done_at: Option<u64>,
}

/// Where the file lives.
#[must_use]
pub fn path(home: &Path) -> PathBuf {
    home.join("hypotaxis").join("setup.json")
}

/// Read the state. A missing file is a fresh state; an unreadable or newer file is `hx.setup.state_invalid`, and is
/// left as it was.
///
/// # Errors
/// `Config` for a file that cannot be used.
pub fn load(home: &Path) -> Result<State> {
    let p = path(home);
    let raw = match std::fs::read_to_string(&p) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(State {
                schema_version: VERSION,
                ..State::default()
            });
        }
        Err(e) => return Err(Error::Io(e.to_string())),
    };
    let state: State = serde_json::from_str(&raw)
        .map_err(|e| Error::Setup("hx.setup.state_invalid", format!("{} is not valid: {e}", p.display())))?;
    if state.schema_version > VERSION {
        return Err(Error::Setup(
            "hx.setup.state_invalid",
            format!("{} was written by a newer hypotaxis (version {})", p.display(), state.schema_version),
        ));
    }
    Ok(State {
        schema_version: VERSION,
        ..state
    })
}

/// Write the state atomically (a temp file, then a rename).
///
/// # Errors
/// `Io` when the file cannot be written.
pub fn save(home: &Path, state: &State) -> Result<()> {
    let p = path(home);
    let dir = p.parent().ok_or_else(|| Error::Io("no directory".into()))?;
    std::fs::create_dir_all(dir)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(state).map_err(|e| Error::Io(e.to_string()))?,
    )?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_a_missing_file_is_fresh() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).unwrap().consent, Consent::Unasked);
        let s = State {
            consent: Consent::Granted,
            choice: Some("main/fake".into()),
            restart_pending: true,
            ..State::default()
        };
        save(dir.path(), &s).unwrap();
        let back = load(dir.path()).unwrap();
        assert_eq!(back.consent, Consent::Granted);
        assert_eq!(back.choice.as_deref(), Some("main/fake"));
        assert_eq!(back.schema_version, VERSION);
    }

    #[test]
    fn a_newer_or_broken_file_is_refused_and_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let p = path(dir.path());
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, r#"{"schema_version": 99}"#).unwrap();
        assert!(load(dir.path()).is_err());
        std::fs::write(&p, "not json").unwrap();
        assert!(load(dir.path()).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "not json");
    }
}
