//! Host settings: versioned, validated at load, never half-applied (`docs/STANDARDS.md` sections 1 and 2). They are
//! persisted with the Tauri store (`settings.json` in the app's config directory). Secrets never live here.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{Error, Result};

/// The current schema version.
pub const SCHEMA_VERSION: u32 = 1;

/// What the host remembers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppSettings {
    /// The schema version of this value.
    pub version: u32,
    /// A dedicated Hermes profile to attach to; `None` is the user's active profile (ADR-0006).
    pub profile: Option<String>,
    /// Whether the host may show desktop notifications.
    pub notifications: bool,
    /// Which GPU the webview renders on (`BOOPIS_GPU` overrides it). Read at startup, so a change needs a restart.
    /// Added without a version bump: a file from before has none and gets `auto`.
    #[serde(default)]
    pub gpu: crate::gpu::Policy,
    /// Which speech model dictation uses, by its name in `boopis_dictation::model::MODELS`; `None` is the default
    /// (`base-q5_1`). Read at startup, so a change needs a restart. There is no control for it in the app yet: it is the
    /// seam for a larger model (ADR-0059). Added without a version bump: a file from before has none.
    #[serde(default)]
    pub speech_model: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            profile: None,
            notifications: true,
            gpu: crate::gpu::Policy::Auto,
            speech_model: None,
        }
    }
}

impl AppSettings {
    /// Check a value the UI sends.
    ///
    /// # Errors
    /// `Config` with the key, what was expected and what was found.
    pub fn validate(&self) -> Result<()> {
        if self.version != SCHEMA_VERSION {
            return Err(Error::Config(format!(
                "settings.version: expected {SCHEMA_VERSION}, found {}",
                self.version
            )));
        }
        if let Some(p) = &self.profile {
            let ok = p == "default"
                || (!p.is_empty()
                    && p.len() <= 64
                    && p.chars().all(|c| {
                        c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_'
                    }));
            if !ok {
                return Err(Error::Config(format!(
                    "settings.profile: expected [a-z0-9_-]{{1,64}}, found {p:?}"
                )));
            }
        }
        if let Some(m) = &self.speech_model
            && !boopis_dictation::model::MODELS.iter().any(|k| k.id == m)
        {
            let known: Vec<&str> = boopis_dictation::model::MODELS
                .iter()
                .map(|k| k.id)
                .collect();
            return Err(Error::Config(format!(
                "settings.speech_model: expected one of {}, found {m:?}",
                known.join(", ")
            )));
        }
        Ok(())
    }

    /// Read what the store holds: an older version is migrated, a newer one is refused, a bad one is an error.
    ///
    /// # Errors
    /// `Config` when the stored value is from a newer version or does not validate.
    pub fn migrate(stored: Option<&serde_json::Value>) -> Result<Self> {
        let Some(v) = stored else {
            return Ok(Self::default());
        };
        let version = v
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        if version > u64::from(SCHEMA_VERSION) {
            return Err(Error::Config(format!(
                "settings.version: this build reads up to {SCHEMA_VERSION}, found {version}"
            )));
        }
        // v0 had no version field and only `profile` and `notifications`; v1 adds the version.
        let settings = Self {
            version: SCHEMA_VERSION,
            profile: v.get("profile").and_then(|p| p.as_str()).map(str::to_owned),
            notifications: v
                .get("notifications")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true),
            gpu: v
                .get("gpu")
                .and_then(|g| g.as_str())
                .and_then(crate::gpu::Policy::parse)
                .unwrap_or_default(),
            // a name this build does not know (a file a newer build wrote) is the default, not an error at start
            speech_model: v
                .get("speech_model")
                .and_then(|m| m.as_str())
                .filter(|m| boopis_dictation::model::MODELS.iter().any(|k| k.id == *m))
                .map(str::to_owned),
        };
        settings.validate()?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nothing_stored_gives_the_defaults() {
        assert_eq!(AppSettings::migrate(None).unwrap(), AppSettings::default());
    }

    #[test]
    fn version_zero_migrates_to_one() {
        let s = AppSettings::migrate(Some(&json!({"profile": "work", "notifications": false})))
            .unwrap();
        assert_eq!(
            s,
            AppSettings {
                version: 1,
                profile: Some("work".into()),
                notifications: false,
                gpu: crate::gpu::Policy::Auto,
                speech_model: None,
            }
        );
    }

    #[test]
    fn the_speech_model_is_one_the_build_knows_or_the_default() {
        let s = AppSettings::migrate(Some(&json!({"version": 1, "speech_model": "base-q5_1"})))
            .unwrap();
        assert_eq!(s.speech_model.as_deref(), Some("base-q5_1"));
        // a file from before, and a name from a newer build, read as the default
        let old = AppSettings::migrate(Some(&json!({"version": 1}))).unwrap();
        assert_eq!(old.speech_model, None);
        let newer =
            AppSettings::migrate(Some(&json!({"version": 1, "speech_model": "large-v9"}))).unwrap();
        assert_eq!(newer.speech_model, None);
        // what the UI sends is checked, and the error names the key and the names that exist
        let wrong = AppSettings {
            speech_model: Some("../../etc/passwd".into()),
            ..AppSettings::default()
        };
        let e = wrong.validate().unwrap_err();
        assert!(
            e.to_string().contains("settings.speech_model") && e.to_string().contains("base-q5_1")
        );
    }

    #[test]
    fn the_gpu_choice_is_stored_and_an_old_file_gets_auto() {
        let s = AppSettings::migrate(Some(&json!({"version": 1, "gpu": "dedicated"}))).unwrap();
        assert_eq!(s.gpu, crate::gpu::Policy::Dedicated);
        let old = AppSettings::migrate(Some(&json!({"version": 1, "profile": "work"}))).unwrap();
        assert_eq!(old.gpu, crate::gpu::Policy::Auto);
        let typo = AppSettings::migrate(Some(&json!({"version": 1, "gpu": "turbo"}))).unwrap();
        assert_eq!(typo.gpu, crate::gpu::Policy::Auto);
        // The UI's value round-trips, and the host reads the same file at startup.
        let text =
            serde_json::to_string(&json!({"app": serde_json::to_value(&s).unwrap()})).unwrap();
        assert_eq!(
            crate::gpu::stored_policy(&text),
            Some(crate::gpu::Policy::Dedicated)
        );
    }

    #[test]
    fn a_newer_version_is_refused_not_half_read() {
        let e = AppSettings::migrate(Some(&json!({"version": 2, "profile": "x"}))).unwrap_err();
        assert_eq!(e.code(), "hx.config.invalid");
        assert!(e.to_string().contains("settings.version"));
    }

    #[test]
    fn bad_values_say_which_key() {
        let e =
            AppSettings::migrate(Some(&json!({"version": 1, "profile": "../etc"}))).unwrap_err();
        assert!(e.to_string().contains("settings.profile") && e.to_string().contains("../etc"));
        let ok = AppSettings {
            profile: Some("nina".into()),
            ..AppSettings::default()
        };
        assert!(ok.validate().is_ok());
        let wrong = AppSettings {
            version: 7,
            ..AppSettings::default()
        };
        assert!(wrong.validate().is_err());
    }
}
