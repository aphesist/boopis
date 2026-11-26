//! The owner's rules list for every bot, `<root>/boopis/rules.json`, as the desktop host writes it
//! (`docs/specs/rules-engine.md` section 11, ADR-0060).
//!
//! The host is the **only writer**: the plugin reads the file (`plugins/boopis/rules/store.py`), and a bot's session
//! cannot write it (B47, H2). Every change here is checked against the revision the caller read (a stale one is
//! [`RulesError::Conflict`]), validated (one line of at most 200 characters, a known type, known kinds), written
//! atomically (a private temporary file, fsync, rename, mode `0600`) under `rules.json.lock`, and bumps the revision.
//! Unknown keys are kept, at the top and in each rule.
//!
//! The owner's defaults are `apps/shared/data/default-rules.json` (the plugin reads a copy). A default the owner removed
//! stays removed (`removed_defaults`); one whose text the owner changed is `edited` (its patterns stop applying in the
//! plugin). A file this boopis cannot read is never overwritten by a guess: every change is refused until the owner
//! restores it.

use std::fmt;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

pub mod cards;
pub use cards::{RuleCard, card_draft, rule_card};

/// The owner's default rules, shared with the plugin.
pub const DEFAULTS_JSON: &str = include_str!("../../../apps/shared/data/default-rules.json");
/// The file's schema this build writes and reads.
pub const SCHEMA_VERSION: u64 = 1;
/// The longest rule text.
pub const MAX_TEXT: usize = 200;
/// A lock left by a writer that died is taken over after this long.
const STALE_LOCK: Duration = Duration::from_secs(10);
const MAX_LIST: usize = 64;
const MAX_MATCH: usize = 512;

/// Why a change was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RulesError {
    /// The revision the caller read is not the file's (another window, the CLI, or an outside change wrote since).
    Conflict {
        /// The file's revision now.
        current: u64,
    },
    /// The change is not a rule this list can hold; the words say why.
    Invalid(String),
    /// No rule has that id.
    NotFound,
    /// The file cannot be read, is not a rules file, or a newer boopis wrote it: nothing is changed until it is fixed.
    Unreadable(String),
    /// Another writer holds the lock.
    Busy,
    /// The file system refused.
    Io(String),
}

impl fmt::Display for RulesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict { current } => write!(
                f,
                "the rules changed since they were read (now revision {current}); read them again"
            ),
            Self::Invalid(why) => write!(f, "{why}"),
            Self::NotFound => write!(f, "there is no rule with that id"),
            Self::Unreadable(why) => write!(f, "the rules can't be read: {why}"),
            Self::Busy => write!(f, "the rules are being changed elsewhere; try again"),
            Self::Io(why) => write!(f, "the rules could not be saved: {why}"),
        }
    }
}

impl std::error::Error for RulesError {}

/// The shipped defaults: `(defaults_version, kinds, rules)`.
///
/// # Errors
/// [`RulesError::Unreadable`] when the embedded file is not the defaults (a build mistake, caught by the tests).
pub fn shipped() -> Result<(u64, Vec<String>, Vec<Value>), RulesError> {
    let doc: Value = serde_json::from_str(DEFAULTS_JSON)
        .map_err(|e| RulesError::Unreadable(format!("the defaults: {e}")))?;
    let version = doc["defaults_version"]
        .as_u64()
        .ok_or_else(|| RulesError::Unreadable("the defaults have no version".into()))?;
    let kinds = doc["kinds"]
        .as_array()
        .map(|k| {
            k.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let rules = doc["rules"].as_array().cloned().unwrap_or_default();
    Ok((version, kinds, rules))
}

fn default_rule(d: &Value, now: &str) -> Value {
    json!({
        "id": d["id"], "type": "ask", "text": d["text"], "enabled": true, "source": "default", "edited": false,
        "bots": null, "kinds": d["kinds"], "created_at": now, "updated_at": now,
    })
}

/// The time as the file writes it (RFC 3339, UTC, milliseconds).
#[must_use]
pub fn now_text() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, day) = civil(i64::try_from(days).unwrap_or(0));
    format!(
        "{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

/// A route's part: trimmed, not empty, not too long.
fn clean(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty() && s.len() <= 200)
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let m = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    (era * 400 + yoe + i64::from(m <= 2), m, d)
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A new id: `r_` for a rule, `x_` for an exception, then the time and a counter (unique within a file; checked).
fn mint(kind: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let prefix = if kind == "exception" { "x" } else { "r" };
    format!(
        "{prefix}_{:012x}{:04x}",
        nanos & 0xffff_ffff_ffff,
        n & 0xffff
    )
}

/// The rules file of one engine root.
#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    /// `<root>/boopis/rules.json`.
    #[must_use]
    pub fn under(root: &Path) -> Self {
        Self {
            path: root.join("boopis").join("rules.json"),
        }
    }

    /// The file's path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The file as it is, and the SHA-256 of its bytes (the host compares it with what it last wrote to see a change from
    /// outside). `None` when there is no file yet.
    ///
    /// # Errors
    /// [`RulesError::Unreadable`].
    pub fn read(&self) -> Result<Option<(Value, String)>, RulesError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(RulesError::Unreadable(e.to_string())),
        };
        let doc: Value =
            serde_json::from_slice(&bytes).map_err(|e| RulesError::Unreadable(e.to_string()))?;
        check_doc(&doc)?;
        Ok(Some((doc, hex::encode(Sha256::digest(&bytes)))))
    }

    /// The file, made with the owner's defaults when there is none, and given any default a newer boopis ships that the
    /// owner did not remove. Returns the content and its digest.
    ///
    /// # Errors
    /// As [`Store::read`], and the write's.
    pub fn ensure(&self, now: &str) -> Result<(Value, String), RulesError> {
        self.change(None, now, |doc| {
            let (version, _, defaults) = shipped()?;
            let have = doc["defaults_version"].as_u64().unwrap_or(0);
            if have >= version {
                return Ok(false);
            }
            let removed = strings(&doc["removed_defaults"]);
            let rules = rules_mut(doc)?;
            for d in &defaults {
                let id = d["id"].as_str().unwrap_or_default();
                if !removed.iter().any(|r| r == id)
                    && !rules.iter().any(|r| r["id"].as_str() == Some(id))
                {
                    rules.push(default_rule(d, now));
                }
            }
            doc["defaults_version"] = json!(version);
            Ok(true)
        })
    }

    /// Add a rule or change one (by `id`): its text, whether it is on, who it applies to, its kinds, and for an exception
    /// what it excepts, its `match` and its state. Returns the new revision and the rule's id.
    ///
    /// # Errors
    /// [`RulesError::Conflict`] on a stale revision, [`RulesError::Invalid`] for a rule this list cannot hold.
    pub fn put(
        &self,
        rule: &Value,
        expected_revision: u64,
        now: &str,
    ) -> Result<(u64, String), RulesError> {
        let incoming = rule
            .as_object()
            .ok_or_else(|| RulesError::Invalid("a rule is an object".into()))?;
        let mut id_out = String::new();
        let (doc, _) = self.change(Some(expected_revision), now, |doc| {
            let (_, kinds, defaults) = shipped()?;
            let rules = rules_mut(doc)?;
            let wanted = incoming.get("id").and_then(Value::as_str);
            let at = wanted.and_then(|id| rules.iter().position(|r| r["id"].as_str() == Some(id)));
            let mut merged: Map<String, Value> = match at {
                Some(i) => rules[i].as_object().cloned().unwrap_or_default(),
                None if wanted.is_some_and(|id| id.starts_with("default.")) => {
                    return Err(RulesError::NotFound);
                }
                None => Map::new(),
            };
            for (k, v) in incoming {
                if !matches!(k.as_str(), "created_at" | "updated_at" | "edited") {
                    merged.insert(k.clone(), v.clone());
                }
            }
            if at.is_none() {
                let kind = merged
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("ask")
                    .to_owned();
                let mut id = wanted.map_or_else(|| mint(&kind), str::to_owned);
                while rules.iter().any(|r| r["id"].as_str() == Some(id.as_str())) {
                    id = mint(&kind);
                }
                merged.insert("id".into(), json!(id));
                merged.insert("created_at".into(), json!(now));
                merged.entry("source").or_insert_with(|| json!("owner"));
                merged.entry("enabled").or_insert(Value::Bool(true));
            }
            let id = merged["id"].as_str().unwrap_or_default().to_owned();
            if let Some(d) = defaults
                .iter()
                .find(|d| d["id"].as_str() == Some(id.as_str()))
            {
                merged.insert("source".into(), json!("default"));
                merged.insert("edited".into(), json!(merged.get("text") != d.get("text")));
            } else if merged.get("source").and_then(Value::as_str) == Some("default") {
                return Err(RulesError::Invalid(
                    "only a shipped default has the source default".into(),
                ));
            }
            merged.insert("updated_at".into(), json!(now));
            let checked = validate(Value::Object(merged), &kinds)?;
            match at {
                Some(i) => rules[i] = checked,
                None => rules.push(checked),
            }
            id_out = id;
            Ok(true)
        })?;
        Ok((revision(&doc), id_out))
    }

    /// Switch a rule on or off.
    ///
    /// # Errors
    /// As [`Store::put`]; [`RulesError::NotFound`].
    pub fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
        expected_revision: u64,
        now: &str,
    ) -> Result<u64, RulesError> {
        let (doc, _) = self.change(Some(expected_revision), now, |doc| {
            let rule = rules_mut(doc)?
                .iter_mut()
                .find(|r| r["id"].as_str() == Some(id))
                .ok_or(RulesError::NotFound)?;
            rule["enabled"] = json!(enabled);
            rule["updated_at"] = json!(now);
            Ok(true)
        })?;
        Ok(revision(&doc))
    }

    /// Remove a rule; a default is remembered in `removed_defaults` so a newer boopis does not bring it back. Returns the
    /// new revision and the rule as it was (the host keeps it a while for Undo, [`Store::reinsert`]).
    ///
    /// # Errors
    /// As [`Store::put`]; [`RulesError::NotFound`].
    pub fn remove(
        &self,
        id: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<(u64, Value), RulesError> {
        let mut removed = Value::Null;
        let (doc, _) = self.change(Some(expected_revision), now, |doc| {
            let rules = rules_mut(doc)?;
            let at = rules
                .iter()
                .position(|r| r["id"].as_str() == Some(id))
                .ok_or(RulesError::NotFound)?;
            removed = rules.remove(at);
            if id.starts_with("default.") {
                let mut list = strings(&doc["removed_defaults"]);
                if !list.iter().any(|r| r == id) {
                    list.push(id.to_owned());
                }
                doc["removed_defaults"] = json!(list);
            }
            Ok(true)
        })?;
        Ok((revision(&doc), removed))
    }

    /// Put back a rule [`Store::remove`] took out (Undo). A rule with that id already there is left as it is.
    ///
    /// # Errors
    /// As [`Store::put`].
    pub fn reinsert(&self, rule: &Value, now: &str) -> Result<u64, RulesError> {
        let (_, kinds, _) = shipped()?;
        let checked = validate(rule.clone(), &kinds)?;
        let id = checked["id"].as_str().unwrap_or_default().to_owned();
        let (doc, _) = self.change(None, now, |doc| {
            if id.starts_with("default.") {
                let list: Vec<String> = strings(&doc["removed_defaults"])
                    .into_iter()
                    .filter(|r| *r != id)
                    .collect();
                doc["removed_defaults"] = json!(list);
            }
            let rules = rules_mut(doc)?;
            if rules.iter().any(|r| r["id"].as_str() == Some(id.as_str())) {
                return Ok(false);
            }
            rules.push(checked.clone());
            Ok(true)
        })?;
        Ok(revision(&doc))
    }

    /// Put defaults back to their shipped text, on, for every bot; removed ones are added again. `ids` names some; `None`
    /// is all of them.
    ///
    /// # Errors
    /// As [`Store::put`].
    pub fn restore_defaults(&self, ids: Option<&[String]>, now: &str) -> Result<u64, RulesError> {
        let (_, _, defaults) = shipped()?;
        let (doc, _) = self.change(None, now, |doc| {
            let wanted = |id: &str| ids.is_none_or(|list| list.iter().any(|i| i == id));
            let removed: Vec<String> = strings(&doc["removed_defaults"])
                .into_iter()
                .filter(|r| !wanted(r))
                .collect();
            doc["removed_defaults"] = json!(removed);
            let rules = rules_mut(doc)?;
            for d in &defaults {
                let id = d["id"].as_str().unwrap_or_default();
                if !wanted(id) {
                    continue;
                }
                let fresh = default_rule(d, now);
                match rules.iter().position(|r| r["id"].as_str() == Some(id)) {
                    Some(i) => rules[i] = fresh,
                    None => rules.push(fresh),
                }
            }
            Ok(true)
        })?;
        Ok(revision(&doc))
    }

    /// Choose the reviewer: `auto` (the cheapest connected model, chosen by the caller) or `pinned`, with its route.
    ///
    /// # Errors
    /// [`RulesError::Invalid`] for another mode or a route that is half given.
    pub fn set_reviewer(
        &self,
        mode: &str,
        provider: Option<&str>,
        model: Option<&str>,
        now: &str,
    ) -> Result<Value, RulesError> {
        if !matches!(mode, "auto" | "pinned") {
            return Err(RulesError::Invalid("the reviewer is auto or pinned".into()));
        }
        let (provider, model) = (clean(provider), clean(model));
        if provider.is_some() != model.is_some() || (mode == "pinned" && provider.is_none()) {
            return Err(RulesError::Invalid(
                "a reviewer is a provider and a model".into(),
            ));
        }
        let reviewer =
            json!({"mode": mode, "provider": provider, "model": model, "chosen_at": now});
        self.change(None, now, |doc| {
            doc["reviewer"] = reviewer.clone();
            Ok(true)
        })?;
        Ok(reviewer)
    }

    /// Read, change under the lock and write back. `edit` returns whether it changed anything (the revision goes up only
    /// then). A missing file starts from the defaults.
    fn change<F>(
        &self,
        expected: Option<u64>,
        now: &str,
        edit: F,
    ) -> Result<(Value, String), RulesError>
    where
        F: FnOnce(&mut Value) -> Result<bool, RulesError>,
    {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| RulesError::Io(e.to_string()))?;
        let _lock = Lock::take(&self.path.with_extension("json.lock"))?;
        let (mut doc, digest, fresh) = match self.read()? {
            Some((doc, digest)) => (doc, digest, false),
            None => (initial(now)?, String::new(), true),
        };
        let current = revision(&doc);
        if let Some(want) = expected
            && want != current
        {
            return Err(RulesError::Conflict { current });
        }
        let changed = edit(&mut doc)?;
        if !changed && !fresh {
            return Ok((doc, digest));
        }
        if changed {
            doc["revision"] = json!(current + 1);
        }
        doc["updated_at"] = json!(now);
        let digest = write_atomic(&self.path, &doc)?;
        Ok((doc, digest))
    }
}

fn initial(now: &str) -> Result<Value, RulesError> {
    let (version, _, defaults) = shipped()?;
    Ok(json!({
        "schema_version": SCHEMA_VERSION, "revision": 0, "defaults_version": version, "updated_at": now,
        "reviewer": {"mode": "auto", "provider": null, "model": null},
        "rules": defaults.iter().map(|d| default_rule(d, now)).collect::<Vec<_>>(),
        "removed_defaults": [],
    }))
}

fn revision(doc: &Value) -> u64 {
    doc["revision"].as_u64().unwrap_or(0)
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn rules_mut(doc: &mut Value) -> Result<&mut Vec<Value>, RulesError> {
    if doc.get("rules").is_none() {
        doc["rules"] = json!([]);
    }
    doc["rules"]
        .as_array_mut()
        .ok_or_else(|| RulesError::Unreadable("rules is not a list".into()))
}

fn check_doc(doc: &Value) -> Result<(), RulesError> {
    let version = doc["schema_version"]
        .as_u64()
        .ok_or_else(|| RulesError::Unreadable("it is not a rules file".into()))?;
    if version > SCHEMA_VERSION {
        return Err(RulesError::Unreadable(format!(
            "a newer boopis wrote it (schema {version})"
        )));
    }
    if !doc["rules"].is_array() && !doc["rules"].is_null() {
        return Err(RulesError::Unreadable("rules is not a list".into()));
    }
    Ok(())
}

fn name_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn list_of(v: Option<&Value>, what: &str, limit: usize) -> Result<Vec<String>, RulesError> {
    let Some(v) = v else {
        return Ok(Vec::new());
    };
    let items = v
        .as_array()
        .ok_or_else(|| RulesError::Invalid(format!("{what} is a list")))?;
    if items.len() > MAX_LIST {
        return Err(RulesError::Invalid(format!("{what} is too long")));
    }
    items
        .iter()
        .map(|i| match i.as_str() {
            Some(s) if !s.is_empty() && s.len() <= limit && !s.contains(['\n', '\r']) => {
                Ok(s.to_owned())
            }
            _ => Err(RulesError::Invalid(format!(
                "{what} holds something that is not a short line"
            ))),
        })
        .collect()
}

/// A rule as the list holds it, or why not.
fn validate(rule: Value, kinds: &[String]) -> Result<Value, RulesError> {
    let Value::Object(mut r) = rule else {
        return Err(RulesError::Invalid("a rule is an object".into()));
    };
    let kind = r
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if !matches!(kind.as_str(), "ask" | "exception") {
        return Err(RulesError::Invalid(
            "a rule's type is ask or exception".into(),
        ));
    }
    let text = r
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    if text.is_empty() || text.chars().count() > MAX_TEXT || text.contains(['\n', '\r']) {
        return Err(RulesError::Invalid(format!(
            "a rule is one line of 1 to {MAX_TEXT} characters"
        )));
    }
    r.insert("text".into(), json!(text));
    let id = r.get("id").and_then(Value::as_str).unwrap_or("");
    if !name_ok(id) {
        return Err(RulesError::Invalid("a rule's id is a short name".into()));
    }
    if !matches!(r.get("enabled"), Some(Value::Bool(_))) {
        r.insert("enabled".into(), Value::Bool(true));
    }
    let source = r.get("source").and_then(Value::as_str).unwrap_or("owner");
    if !matches!(source, "default" | "owner" | "card" | "chat") {
        return Err(RulesError::Invalid(
            "a rule's source is default, owner, card or chat".into(),
        ));
    }
    match r.get("bots") {
        None | Some(Value::Null) => {
            r.insert("bots".into(), Value::Null);
        }
        Some(v) => {
            let bots = list_of(Some(v), "bots", 64)?;
            if bots.iter().any(|b| !name_ok(b)) || bots.is_empty() {
                return Err(RulesError::Invalid(
                    "bots is every bot (null) or a list of bot names".into(),
                ));
            }
        }
    }
    let rule_kinds = list_of(r.get("kinds"), "kinds", 32)?;
    if rule_kinds.iter().any(|k| !kinds.contains(k)) {
        return Err(RulesError::Invalid(format!(
            "kinds are some of: {}",
            kinds.join(", ")
        )));
    }
    if rule_kinds.is_empty() {
        r.insert("kinds".into(), json!(kinds));
    }
    if kind == "exception" {
        let excepts = list_of(r.get("excepts"), "excepts", 128)?;
        if excepts.is_empty() {
            return Err(RulesError::Invalid(
                "an exception names the rules it excepts".into(),
            ));
        }
        list_of(r.get("match"), "match", MAX_MATCH)?;
        match r.get("state").and_then(Value::as_str) {
            None => {
                r.insert("state".into(), json!("active"));
            }
            Some("active" | "draft") => {}
            Some(_) => {
                return Err(RulesError::Invalid(
                    "an exception's state is active or draft".into(),
                ));
            }
        }
        if let Some(cwd) = r.get("match_cwd")
            && !cwd.is_null()
            && !cwd
                .as_str()
                .is_some_and(|s| s.len() <= 1024 && !s.contains(['\n', '\r']))
        {
            return Err(RulesError::Invalid("match_cwd is a folder".into()));
        }
    }
    Ok(Value::Object(r))
}

/// `rules.json.lock`, held while a change is read and written. A lock older than [`STALE_LOCK`] is a dead writer's.
struct Lock(PathBuf);

impl Lock {
    fn take(path: &Path) -> Result<Self, RulesError> {
        for _ in 0..2 {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
            {
                Ok(_) => return Ok(Self(path.to_owned())),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let old = std::fs::metadata(path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .is_some_and(|age| age > STALE_LOCK);
                    if !old {
                        return Err(RulesError::Busy);
                    }
                    let _ = std::fs::remove_file(path);
                }
                Err(e) => return Err(RulesError::Io(e.to_string())),
            }
        }
        Err(RulesError::Busy)
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Write `doc` beside `path` in a private temporary file, fsync it, rename it into place; returns the digest of the bytes.
fn write_atomic(path: &Path, doc: &Value) -> Result<String, RulesError> {
    let io = |e: std::io::Error| RulesError::Io(e.to_string());
    let mut bytes = serde_json::to_vec_pretty(doc).map_err(|e| RulesError::Io(e.to_string()))?;
    bytes.push(b'\n');
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(io)?;
    file.write_all(&bytes).map_err(io)?;
    file.sync_all().map_err(io)?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        io(e)
    })?;
    if let Some(dir) = path.parent()
        && let Ok(d) = std::fs::File::open(dir)
    {
        let _ = d.sync_all();
    }
    Ok(hex::encode(Sha256::digest(&bytes)))
}

#[cfg(test)]
mod tests;
