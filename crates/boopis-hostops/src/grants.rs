//! Owner grants (`host-protections.md` H5): a one-time permission the window asks the host for (`owner_grant {purpose}`)
//! and passes in a plugin RPC that loosens a rule; the plugin redeems it over host-ops (`grant.redeem`). A grant lives 60
//! seconds, serves one purpose, and is used once. They are kept in memory only: a restart forgets them.

use std::collections::HashMap;
use std::sync::Mutex;

use subtle::ConstantTimeEq;

use crate::Refusal;

/// How long a grant lives.
pub const TTL_MS: u64 = 60_000;

/// What a grant may be for: the plugin RPCs that loosen a rule.
pub const PURPOSES: &[&str] = &["bots.write.approvals", "bots.write.cap", "budget.set"];

/// The grants not yet used.
#[derive(Debug, Default)]
pub struct Grants {
    open: Mutex<HashMap<String, (String, u64)>>,
}

impl Grants {
    /// A new grant for `purpose` at `now`.
    ///
    /// # Errors
    /// `hx.invalid_params` for a purpose that takes no grant; `hx.host.store_failed` with no random bytes.
    pub fn mint(&self, purpose: &str, now: u64) -> Result<String, Refusal> {
        if !PURPOSES.contains(&purpose) {
            return Err(Refusal::new(
                "hx.invalid_params",
                "Nothing of that kind needs your permission.",
            ));
        }
        let grant = crate::token()?;
        let mut open = self
            .open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        open.retain(|_, (_, until)| *until > now);
        open.insert(grant.clone(), (purpose.to_owned(), now + TTL_MS));
        Ok(grant)
    }

    /// Use `grant` for `purpose` at `now`. A grant is gone after its first use, also when the purpose was wrong.
    #[must_use]
    pub fn redeem(&self, grant: &str, purpose: &str, now: u64) -> bool {
        let mut open = self
            .open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let found = open
            .keys()
            .find(|k| bool::from(k.as_bytes().ct_eq(grant.as_bytes())))
            .cloned();
        let Some(key) = found else { return false };
        let Some((what, until)) = open.remove(&key) else {
            return false;
        };
        what == purpose && until > now
    }
}
