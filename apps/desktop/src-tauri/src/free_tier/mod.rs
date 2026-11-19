//! Nous's free tier as the host sees it (`docs/research/free-tier.md`): the state Hermes reports (`FreeTier`) and the
//! browser challenge the account service may put in front of a token exchange (`challenge`), run in a hidden window.

pub mod challenge;
pub mod serve;
pub mod windows;

#[cfg(test)]
pub(crate) mod tests;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What `free_tier.status` (and `free_tier.provision`) answers, as Hermes sends it. Nothing is added or guessed: a field
/// Hermes did not send is absent.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct FreeTier {
    /// An identity exists.
    #[serde(default)]
    pub has_guest: bool,
    /// Available, or claimable now.
    #[serde(default)]
    pub enabled: bool,
    /// An identity that carries inference exists.
    #[serde(default)]
    pub available: bool,
    /// The one model the tier serves, as Hermes names it (`nous/welcome`).
    #[serde(default)]
    pub model: String,
    /// Hermes's label for the tier (`Nous · free tier`).
    #[serde(default)]
    pub label: String,
    /// Why the last claim failed, in Hermes's words.
    #[serde(default)]
    pub error: Option<String>,
    /// The stable code of that failure.
    #[serde(default)]
    pub error_code: Option<String>,
    /// Whether trying again can help.
    #[serde(default)]
    pub retryable: Option<bool>,
    /// Seconds Hermes says to wait.
    #[serde(default)]
    pub retry_after: Option<u64>,
    /// A browser challenge the service is waiting on.
    #[serde(default)]
    pub challenge: Option<Value>,
}
