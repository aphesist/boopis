//! The rules list in the host (`docs/specs/rules-engine.md` sections 11 and 13, ADR-0060): the Tauri commands the
//! Settings screen will call, over `crates/boopis-rules`, the only writer of `<root>/boopis/rules.json`.
//!
//! - The host makes the file with the owner's defaults the first time it is read, and adds a default a newer boopis
//!   ships unless the owner removed it.
//! - Every change carries the revision the window read; a stale one is `hx.rules.conflict`.
//! - A remove keeps the rule 30 seconds for `rules_undo`.
//! - The digest of what the host last wrote is remembered: `rules_get` says `changed_outside` when the file's bytes are
//!   not those (a bot cannot write it, B47 H2; this catches the rest).
//! - Choosing the reviewer writes its route into every bot's own engine settings (`auxiliary.boopis_reviewer`), where
//!   the plugin's reviewer task reads it.
//!
//! These commands are reachable only from the window's own capability set (B47, H5); no bot, local API client or plugin
//! RPC writes the rules.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use boopis_rules::{RulesError, Store, now_text};
use serde_json::{Value, json};

use crate::error::Error;

/// How long a removed rule can be put back.
pub const UNDO_FOR: Duration = Duration::from_secs(30);

/// What the host remembers about the rules between commands.
#[derive(Default)]
pub struct RulesHost {
    /// The digest of the bytes the host last wrote or read and accepted.
    digest: Mutex<Option<String>>,
    /// The content those bytes held, so an outside change the owner discards can be put back ("Keep mine").
    kept: Mutex<Option<Value>>,
    /// Removed rules, by undo token, until [`UNDO_FOR`] passes.
    undo: Mutex<HashMap<String, (Instant, Value)>>,
    /// The digest of the last outside change the windows were told of, so each is said once.
    told: Mutex<Option<String>>,
}

/// The rules list was changed outside boopis (`rules-engine.md` 11: the content's digest is not the one the host wrote).
/// Settings reads `rules_get` (`changed_outside`) and offers to keep or discard it; further changes wait until then.
#[derive(Debug, Clone, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct RulesChangedOutsideEvent {
    /// The new content's digest (SHA-256 of the bytes).
    pub digest: String,
}

impl std::fmt::Debug for RulesHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RulesHost").finish_non_exhaustive()
    }
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "the store's errors are mapped with map_err(host_error)"
)]
fn host_error(e: RulesError) -> Error {
    let code = match &e {
        RulesError::Conflict { .. } => "hx.rules.conflict",
        RulesError::Invalid(_) => "hx.rules.invalid",
        RulesError::NotFound => "hx.rules.not_found",
        RulesError::Unreadable(_) => "hx.rules.unreadable",
        RulesError::Busy => "hx.rules.busy",
        RulesError::Io(_) => return Error::Io(e.to_string()),
    };
    Error::Rules(code, e.to_string())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl RulesHost {
    fn remember(&self, digest: String, doc: Value) {
        *lock(&self.digest) = Some(digest);
        *lock(&self.kept) = Some(doc);
    }

    /// A change made outside boopis since the host last wrote or read the file, not yet said: its digest, once. Nothing is
    /// said before the host has read the file at least once (it then knows what it accepted).
    #[must_use]
    pub fn outside_change(&self, root: &Path) -> Option<String> {
        let known = lock(&self.digest).clone()?;
        let (_, now) = Store::under(root).read().ok()??;
        let mut told = lock(&self.told);
        if now == known || told.as_deref() == Some(now.as_str()) {
            return None;
        }
        *told = Some(now.clone());
        Some(now)
    }

    /// Watch `root`'s rules file every `every` and tell the windows of each outside change, once.
    pub async fn watch(
        self: std::sync::Arc<Self>,
        root: std::path::PathBuf,
        app: tauri::AppHandle,
        every: Duration,
    ) {
        loop {
            tokio::time::sleep(every).await;
            if let Some(digest) = self.outside_change(&root)
                && let Err(e) =
                    tauri_specta::Event::emit(&RulesChangedOutsideEvent { digest }, &app)
            {
                tracing::debug!(error = %e, "could not tell the windows the rules changed outside boopis");
            }
        }
    }

    /// The file's content (made with the defaults when there is none), with what Settings shows beside it:
    /// `reviewer_status` (`ok` when a route is set, `none` when not; whether it fails is the plugin's to say) and
    /// `changed_outside` (the bytes are not what the host last wrote).
    ///
    /// # Errors
    /// `hx.rules.unreadable` and the file system's.
    pub fn get(&self, root: &Path) -> Result<Value, Error> {
        let store = Store::under(root);
        let known = lock(&self.digest).clone();
        let (doc, digest) = store.ensure(&now_text()).map_err(host_error)?;
        let changed_outside = known.as_ref().is_some_and(|k| *k != digest);
        if known.is_none() {
            self.remember(digest, doc.clone());
        }
        let configured = doc["reviewer"]["provider"]
            .as_str()
            .is_some_and(|p| !p.is_empty())
            && doc["reviewer"]["model"]
                .as_str()
                .is_some_and(|m| !m.is_empty());
        Ok(json!({
            "rules": doc,
            "reviewer_status": if configured { "ok" } else { "none" },
            "changed_outside": changed_outside,
        }))
    }

    /// Accept the file as it is now (the owner looked at an outside change and kept it).
    ///
    /// # Errors
    /// As [`RulesHost::get`].
    pub fn accept_outside(&self, root: &Path) -> Result<Value, Error> {
        if let Some((doc, digest)) = Store::under(root).read().map_err(host_error)? {
            self.remember(digest, doc);
        }
        self.get(root)
    }

    /// Discard a change made to the rules outside boopis ("Keep mine"): the content the host last wrote or accepted is
    /// written back, with a revision past the file's. Returns what `rules_get` returns.
    ///
    /// # Errors
    /// `hx.rules.not_found` when the host has nothing of its own to put back (it never read the file in this run); the
    /// store's.
    pub fn discard_outside(&self, root: &Path) -> Result<Value, Error> {
        let Some(mine) = lock(&self.kept).clone() else {
            return Err(host_error(RulesError::NotFound));
        };
        Store::under(root)
            .replace(&mine, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        self.get(root)
    }

    fn after_write(&self, root: &Path) {
        if let Ok(Some((doc, digest))) = Store::under(root).read() {
            self.remember(digest, doc);
        }
    }

    /// Refuse a change while the file holds an outside change the owner has not looked at.
    fn guard(&self, root: &Path) -> Result<(), Error> {
        let known = lock(&self.digest).clone();
        let now = Store::under(root).read().map_err(host_error)?;
        match (known, now) {
            (Some(k), Some((_, d))) if k != d => Err(Error::Rules(
                "hx.rules.conflict",
                "the rules were changed outside boopis; look at the change and keep or discard it first".into(),
            )),
            _ => Ok(()),
        }
    }

    /// Keep an exception drafted from a card's "Always" answer outside the window (H6) as a **draft**: `rule` is
    /// `boopis_rules::card_draft`'s, so it is never applied until the owner finishes it in Settings. Returns `{revision, id}`.
    ///
    /// # Errors
    /// As [`RulesHost::put`]: a change made outside boopis that the owner has not looked at keeps it out (fail closed).
    pub fn keep_draft(&self, root: &Path, rule: &Value) -> Result<Value, Error> {
        if rule["state"] != "draft" {
            return Err(Error::Rules(
                "hx.rules.invalid",
                "only a draft is kept this way".into(),
            ));
        }
        let now = self.get(root)?;
        let revision = now["rules"]["revision"].as_u64().unwrap_or(0);
        self.put(root, rule, revision)
    }

    /// Add or edit a rule. Returns `{revision, id}`.
    ///
    /// # Errors
    /// `hx.rules.conflict`, `hx.rules.invalid`, `hx.rules.unreadable`, `hx.rules.busy`.
    pub fn put(&self, root: &Path, rule: &Value, expected_revision: u64) -> Result<Value, Error> {
        self.guard(root)?;
        let (revision, id) = Store::under(root)
            .put(rule, expected_revision, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        Ok(json!({"revision": revision, "id": id}))
    }

    /// Switch a rule on or off. Returns `{revision}`.
    ///
    /// # Errors
    /// As [`RulesHost::put`], and `hx.rules.not_found`.
    pub fn set_enabled(
        &self,
        root: &Path,
        id: &str,
        enabled: bool,
        expected_revision: u64,
    ) -> Result<Value, Error> {
        self.guard(root)?;
        let revision = Store::under(root)
            .set_enabled(id, enabled, expected_revision, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        Ok(json!({"revision": revision}))
    }

    /// Remove a rule. Returns `{revision, undo_token}`; the token puts it back for [`UNDO_FOR`].
    ///
    /// # Errors
    /// As [`RulesHost::set_enabled`].
    pub fn remove(&self, root: &Path, id: &str, expected_revision: u64) -> Result<Value, Error> {
        self.guard(root)?;
        let (revision, rule) = Store::under(root)
            .remove(id, expected_revision, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        let token = undo_token()?;
        let mut undo = lock(&self.undo);
        undo.retain(|_, (at, _)| at.elapsed() < UNDO_FOR);
        undo.insert(token.clone(), (Instant::now(), rule));
        Ok(json!({"revision": revision, "undo_token": token}))
    }

    /// Put back a removed rule. Returns `{revision}`.
    ///
    /// # Errors
    /// `hx.rules.not_found` for a token that is unknown or too old; the store's.
    pub fn undo(&self, root: &Path, token: &str) -> Result<Value, Error> {
        let kept = lock(&self.undo).remove(token);
        let Some((_, rule)) = kept.filter(|(at, _)| at.elapsed() < UNDO_FOR) else {
            return Err(host_error(RulesError::NotFound));
        };
        self.guard(root)?;
        let revision = Store::under(root)
            .reinsert(&rule, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        Ok(json!({"revision": revision}))
    }

    /// Put defaults back. Returns `{revision}`.
    ///
    /// # Errors
    /// The store's.
    pub fn restore_defaults(&self, root: &Path, ids: Option<&[String]>) -> Result<Value, Error> {
        let revision = Store::under(root)
            .restore_defaults(ids, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        Ok(json!({"revision": revision}))
    }

    /// Choose the reviewer. Returns the reviewer as saved; the route still has to reach the bots
    /// ([`write_route`]).
    ///
    /// # Errors
    /// `hx.rules.invalid` and the store's.
    pub fn set_reviewer(
        &self,
        root: &Path,
        mode: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<Value, Error> {
        let reviewer = Store::under(root)
            .set_reviewer(mode, provider, model, &now_text())
            .map_err(host_error)?;
        self.after_write(root);
        Ok(reviewer)
    }
}

fn undo_token() -> Result<String, Error> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| Error::Os(format!("no random bytes: {e}")))?;
    Ok(hex::encode(bytes))
}

/// The homes of the bots under `root` (`profiles/*`, an archived one included: it keeps its settings for its return).
#[must_use]
pub fn bot_homes(root: &Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(root.join("profiles")) else {
        return Vec::new();
    };
    let mut homes: Vec<_> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .collect();
    homes.sort();
    homes
}

/// Write the reviewer's route into every bot's own engine settings, through the engine's own `config set`. Returns the
/// bots it could not be written for, with why (the others are written).
pub async fn write_route(
    engine: &dyn crate::bots::Engine,
    root: &Path,
    provider: Option<&str>,
    model: Option<&str>,
) -> Vec<String> {
    let mut problems = Vec::new();
    for home in bot_homes(root) {
        let name = home
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        for (key, value) in [
            ("auxiliary.boopis_reviewer.provider", provider.unwrap_or("")),
            ("auxiliary.boopis_reviewer.model", model.unwrap_or("")),
        ] {
            if let Err(e) = engine.config_set(&home, key, value).await {
                problems.push(format!("{name}: {e}"));
                break;
            }
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_revision_and_a_two_line_text_are_refused_with_their_codes() {
        let dir = tempfile::tempdir().unwrap();
        let host = RulesHost::default();
        let got = host.get(dir.path()).unwrap();
        assert_eq!(got["reviewer_status"], "none");
        assert_eq!(got["changed_outside"], false);
        let rule = json!({"type": "ask", "text": "Ask before emailing anyone at example.com."});
        assert_eq!(host.put(dir.path(), &rule, 0).unwrap()["revision"], 1);
        let stale = host.put(dir.path(), &rule, 0).unwrap_err();
        assert_eq!(stale.code(), "hx.rules.conflict");
        let two = host
            .put(dir.path(), &json!({"type": "ask", "text": "a\nb"}), 1)
            .unwrap_err();
        assert_eq!(two.code(), "hx.rules.invalid");
    }

    #[test]
    fn a_change_from_outside_is_said_and_holds_changes_until_the_owner_keeps_it() {
        let dir = tempfile::tempdir().unwrap();
        let host = RulesHost::default();
        host.get(dir.path()).unwrap();
        let path = Store::under(dir.path()).path().to_owned();
        let mut doc: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        doc["rules"] = json!([]);
        std::fs::write(&path, serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(host.get(dir.path()).unwrap()["changed_outside"], true);
        let held = host
            .set_enabled(dir.path(), "default.secrets", false, 0)
            .unwrap_err();
        assert_eq!(held.code(), "hx.rules.conflict");
        assert_eq!(
            host.accept_outside(dir.path()).unwrap()["changed_outside"],
            false
        );
    }

    #[test]
    fn keep_mine_puts_back_what_boopis_wrote_and_lets_changes_through_again() {
        let dir = tempfile::tempdir().unwrap();
        let host = RulesHost::default();
        let before = host.get(dir.path()).unwrap();
        let count = before["rules"]["rules"].as_array().unwrap().len();
        let path = Store::under(dir.path()).path().to_owned();
        let mut doc: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        doc["rules"] = json!([]);
        std::fs::write(&path, serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(host.get(dir.path()).unwrap()["changed_outside"], true);
        let back = host.discard_outside(dir.path()).unwrap();
        assert_eq!(back["changed_outside"], false);
        assert_eq!(back["rules"]["rules"].as_array().unwrap().len(), count);
        let revision = back["rules"]["revision"].as_u64().unwrap();
        assert!(
            host.set_enabled(dir.path(), "default.secrets", false, revision)
                .is_ok()
        );
        assert_eq!(
            RulesHost::default()
                .discard_outside(dir.path())
                .unwrap_err()
                .code(),
            "hx.rules.not_found"
        );
    }

    #[test]
    fn undo_puts_a_removed_rule_back_once() {
        let dir = tempfile::tempdir().unwrap();
        let host = RulesHost::default();
        host.get(dir.path()).unwrap();
        let removed = host.remove(dir.path(), "default.messages", 0).unwrap();
        let token = removed["undo_token"].as_str().unwrap().to_owned();
        assert_eq!(host.undo(dir.path(), &token).unwrap()["revision"], 2);
        assert_eq!(
            host.undo(dir.path(), &token).unwrap_err().code(),
            "hx.rules.not_found"
        );
    }

    #[test]
    fn every_bot_home_is_found() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["kai", "nina"] {
            std::fs::create_dir_all(dir.path().join("profiles").join(name)).unwrap();
        }
        std::fs::write(dir.path().join("profiles").join("stray.txt"), "").unwrap();
        let homes = bot_homes(dir.path());
        assert_eq!(homes.len(), 2);
        assert!(homes[0].ends_with("profiles/kai"));
    }
}
