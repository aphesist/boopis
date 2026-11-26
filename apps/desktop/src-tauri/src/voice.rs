//! Voice (talking to bots) as the host keeps it: which provider speaks, and for a server on this computer, its address.
//! Settings › Models › Voice writes it; live talking is not built yet, so nothing in the host reads it today.
//!
//! **No key lives here.** An ElevenLabs or Fish Audio key goes from its field to the OS keychain through `secret_set`
//! (service `boopis.voice.<provider>`, account `api_key`) and is never read back into the page, written to this file,
//! logged or sent in an event. This file holds only the choice and the local server's address, in the host's
//! `settings.json` under `voice`.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Error, Result};

/// The store key in `settings.json`.
pub const STORE_KEY: &str = "voice";

/// Who speaks to bots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceProvider {
    /// ElevenLabs, with the owner's API key in the keychain.
    Elevenlabs,
    /// Fish Audio, with the owner's API key in the keychain.
    FishAudio,
    /// An OpenAI-compatible speech server on this computer (a Kokoro or Piper server), at `local_url`.
    Local,
}

impl VoiceProvider {
    /// The keychain service of the provider's key; none for a local server.
    #[must_use]
    pub fn key_service(self) -> Option<&'static str> {
        match self {
            Self::Elevenlabs => Some("boopis.voice.elevenlabs"),
            Self::FishAudio => Some("boopis.voice.fish_audio"),
            Self::Local => None,
        }
    }
}

/// What the host keeps for voice. Versioned with the host's settings; unknown keys are dropped on the next write.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceSettings {
    /// The provider chosen; none until the owner picks one.
    #[serde(default)]
    pub provider: Option<VoiceProvider>,
    /// The local server's speech address (`http://127.0.0.1:8880/v1/audio/speech`); kept when another provider is chosen.
    #[serde(default)]
    pub local_url: Option<String>,
}

/// The longest address kept.
const MAX_URL: usize = 2048;

impl VoiceSettings {
    /// Read what the store holds; a missing or unreadable value is the defaults (nothing chosen).
    #[must_use]
    pub fn from_store(v: Option<&Value>) -> Self {
        v.and_then(|v| serde_json::from_value::<Self>(v.clone()).ok())
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default()
    }

    /// Check a value the window sends.
    ///
    /// # Errors
    /// `Config` naming the key: a local server without an address, or an address that is not `http` or `https` with a
    /// host, or longer than 2048 characters.
    pub fn validate(&self) -> Result<()> {
        if let Some(u) = &self.local_url {
            if u.len() > MAX_URL {
                return Err(Error::Config(format!(
                    "voice.local_url: expected at most {MAX_URL} characters"
                )));
            }
            let ok = url::Url::parse(u)
                .ok()
                .is_some_and(|p| matches!(p.scheme(), "http" | "https") && p.host_str().is_some());
            if !ok {
                return Err(Error::Config(
                    "voice.local_url: expected an http or https address, such as http://127.0.0.1:8880/v1/audio/speech"
                        .into(),
                ));
            }
        }
        if self.provider == Some(VoiceProvider::Local) && self.local_url.is_none() {
            return Err(Error::Config(
                "voice.local_url: a local server needs its address".into(),
            ));
        }
        Ok(())
    }

    /// What `voice_settings_get` answers: the choice and the address, never a key.
    #[must_use]
    pub fn view(&self) -> Value {
        json!({ "provider": self.provider, "local_url": self.local_url })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_server_needs_an_http_address() {
        let ok = VoiceSettings {
            provider: Some(VoiceProvider::Local),
            local_url: Some("http://127.0.0.1:8880/v1/audio/speech".into()),
        };
        assert!(ok.validate().is_ok());
        let none = VoiceSettings {
            provider: Some(VoiceProvider::Local),
            local_url: None,
        };
        assert!(none.validate().is_err());
        for bad in ["file:///etc/passwd", "not a url", "ftp://x/y"] {
            let s = VoiceSettings {
                provider: None,
                local_url: Some(bad.into()),
            };
            assert!(s.validate().is_err(), "{bad}");
        }
    }

    #[test]
    fn what_the_window_reads_holds_no_key_and_bad_store_values_read_as_nothing_chosen() {
        let s = VoiceSettings {
            provider: Some(VoiceProvider::FishAudio),
            local_url: None,
        };
        assert_eq!(
            s.view(),
            json!({"provider": "fish_audio", "local_url": null})
        );
        assert_eq!(
            VoiceProvider::Elevenlabs.key_service(),
            Some("boopis.voice.elevenlabs")
        );
        assert_eq!(VoiceProvider::Local.key_service(), None);
        let broken = json!({"provider": "local"});
        assert_eq!(
            VoiceSettings::from_store(Some(&broken)),
            VoiceSettings::default()
        );
        assert_eq!(VoiceSettings::from_store(None), VoiceSettings::default());
    }
}
