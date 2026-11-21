//! Setup's progress, kept at `<profile home>/boopis/setup.json` so the flow resumes after an interruption. It holds
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
#[allow(clippy::struct_excessive_bools)] // one flag per once-per-install check, as the file always had
pub struct State {
    /// The schema version.
    pub schema_version: u32,
    /// The configuration consent.
    pub consent: Consent,
    /// The ladder choice (`provider/model`), when the user made one.
    pub choice: Option<String>,
    /// The models the user picked from a catalogue (`OpenRouter`'s free ones), in the order they were offered.
    /// Added without a version bump: a file from before has none.
    pub picks: Vec<String>,
    /// Why the free tier is not offered on this machine, in Hermes's terms, once it said so.
    pub free_note: Option<String>,
    /// The user asked to choose the models again (from a limit notice): the models step asks even when something is set.
    pub reopen_models: bool,
    /// The form the host last showed, so an answer is checked against it.
    pub pending_form: Option<String>,
    /// Hermes has changes (a new plugin, new configuration, a new key) that need a gateway restart to take effect.
    pub restart_pending: bool,
    /// When setup last finished (seconds since the Unix epoch).
    pub done_at: Option<u64>,
    /// The engine's default model was checked against the ladder once (setups before 0.1.4 wrote only the ladder, and a
    /// session with no default model cannot be read back by the engine). Added without a version bump: a file from
    /// before has none, so the check runs once on the first start of this build.
    pub route_checked: bool,
    /// The saved ladder was checked for frontier models once (ADR-0037): one that setup wrote with tiers governed mode will not
    /// use is rewritten, and a hand-written one is only reported. Added without a version bump, like `route_checked`.
    pub frontier_checked: bool,
    /// The heavy models the user turned on in Settings > Models (`fable`, `grok`, `carbon`: the `heavy_switches` of `providers.json`; ADR-0037, ADR-0039). A heavy model is token-heavy or costly
    /// (Fable bills usage credits from the first request on a Claude Pro plan), so no ladder setup writes has one until its id is
    /// here, and setup run again keeps it. Added without a version bump: a file from before has none.
    pub heavy: Vec<String>,
    /// What the Fable opt-in was called before it covered every heavy model: read once into `heavy`, never written again.
    pub subscription_fable: bool,
    /// The saved ladder was checked once for what ADR-0037 says about heavy models and the Sol, Neon and Hydrogen ladders (the
    /// 0.1.6 candidate's opus-and-fable, astra-only and carbon-only ladders are rewritten if setup wrote them). Added without a
    /// version bump, like `frontier_checked`.
    pub ladders_checked: bool,
    /// The saved ladder was checked once for what ADR-0039 says about Terra: a ChatGPT ladder that setup wrote (Sol and Astra, the
    /// 0.1.6 shape) is rewritten to Terra, then Sol, then Astra, from what the account lists. Added without a version bump: a file
    /// from before has none, so the check runs once on the first start of this build.
    pub terra_checked: bool,
}

/// The heavy models the user opted in to (ADR-0037, ADR-0039): the ids of the `heavy_switches` in `providers.json` that are on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Optins(Vec<String>);

impl Optins {
    /// The opt-ins with these switch ids on.
    #[must_use]
    pub fn of(ids: &[&str]) -> Self {
        Self(ids.iter().map(|i| (*i).to_owned()).collect())
    }

    /// Whether the switch `id` (`fable`, `grok`, `carbon`) is on.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.0.iter().any(|h| h == id)
    }

    /// Whether a ladder setup writes may carry `provider`/`model`: any model that is not heavy, and a heavy one only when the
    /// switch of its family is on.
    #[must_use]
    pub fn allows(&self, provider: &str, model: &str) -> bool {
        if !crate::frontier::is_heavy(provider, model) {
            return true;
        }
        let family = crate::frontier::family_of(provider, model);
        crate::providers::catalogue()
            .heavy_switches
            .iter()
            .any(|sw| Some(&sw.family) == family.as_ref() && self.has(&sw.id))
    }
}

impl State {
    /// The heavy opt-ins as the ladders read them.
    #[must_use]
    pub fn optins(&self) -> Optins {
        Optins(self.heavy.clone())
    }

    /// Turn one heavy model's opt-in on or off.
    pub fn set_heavy(&mut self, id: &str, on: bool) {
        self.heavy.retain(|h| h != id);
        if on {
            self.heavy.push(id.to_owned());
        }
    }
}

/// Where the file lives.
#[must_use]
pub fn path(home: &Path) -> PathBuf {
    home.join("boopis").join("setup.json")
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
    let state: State = serde_json::from_str(&raw).map_err(|e| {
        Error::Setup(
            "hx.setup.state_invalid",
            format!("{} is not valid: {e}", p.display()),
        )
    })?;
    if state.schema_version > VERSION {
        return Err(Error::Setup(
            "hx.setup.state_invalid",
            format!(
                "{} was written by a newer boopis (version {})",
                p.display(),
                state.schema_version
            ),
        ));
    }
    let mut state = State {
        schema_version: VERSION,
        ..state
    };
    if std::mem::take(&mut state.subscription_fable) {
        state.set_heavy("fable", true);
    }
    Ok(state)
}

/// Whether the user chose Nous's free tier and it is still the choice: the host then declares its gateway link the Desktop
/// on this machine (the only way Hermes lets the free tier work, `docs/research/free-tier.md` section 2). A progress file
/// that cannot be read counts as no.
#[must_use]
pub fn free_tier_chosen(home: &Path) -> bool {
    crate::config::FREE_TIER_ENABLED
        && load(home).is_ok_and(|s| s.choice.as_deref() == Some(super::providers::FREE))
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
