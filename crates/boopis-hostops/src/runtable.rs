//! The run table, `<app data>/house/ops.json` (section 4.3): each idempotency key and the answer its verb gave, for 7 days
//! (at most 10,000 keys, the oldest out first), so a repeated key returns the same answer and acts once.
//!
//! A key is written as `pending` **before** the verb acts: when that write fails the verb is refused (`hx.host.store_failed`),
//! because without it a retry could act twice. A verb that fails is taken back out, so a retry may act; a key found
//! `pending` is a call still running (or one whose host stopped mid-way) and is refused, never acted on a second time.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value, json};

use crate::{Refusal, write_private};

/// How long a key is kept.
pub const KEEP_MS: u64 = 7 * 24 * 3600 * 1000;
/// The most keys kept.
pub const MAX_KEYS: usize = 10_000;

/// What a key holds now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    /// Never used (or forgotten after 7 days).
    New,
    /// A call with this key is running, or stopped half way.
    Pending,
    /// The answer the first call gave.
    Done(Value),
}

/// The table.
#[derive(Debug)]
pub struct RunTable {
    path: PathBuf,
    lock: Mutex<()>,
}

impl RunTable {
    /// The table at `path`.
    #[must_use]
    pub fn at(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            lock: Mutex::new(()),
        }
    }

    fn read(&self) -> Map<String, Value> {
        std::fs::read(&self.path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.get("entries").and_then(Value::as_object).cloned())
            .unwrap_or_default()
    }

    fn write(&self, mut entries: Map<String, Value>, now: u64) -> Result<(), Refusal> {
        let at = |v: &Value| v.get("at").and_then(Value::as_u64).unwrap_or(0);
        entries.retain(|_, v| now.saturating_sub(at(v)) < KEEP_MS);
        if entries.len() > MAX_KEYS {
            let mut ages: Vec<(u64, String)> =
                entries.iter().map(|(k, v)| (at(v), k.clone())).collect();
            ages.sort();
            for (_, k) in ages.into_iter().take(entries.len() - MAX_KEYS) {
                entries.remove(&k);
            }
        }
        let doc = json!({"schema_version": 1, "entries": entries});
        write_private(&self.path, doc.to_string().as_bytes())
    }

    /// What `key` holds for `op`. A key used for another verb is refused.
    ///
    /// # Errors
    /// `hx.invalid_params` when the key was used for another operation.
    pub fn seen(&self, key: &str, op: &str, now: u64) -> Result<Seen, Refusal> {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(e) = self.read().get(key).cloned() else {
            return Ok(Seen::New);
        };
        if now.saturating_sub(e.get("at").and_then(Value::as_u64).unwrap_or(0)) >= KEEP_MS {
            return Ok(Seen::New);
        }
        if e.get("op").and_then(Value::as_str) != Some(op) {
            return Err(Refusal::new(
                "hx.invalid_params",
                "That key was used for another operation. Use a new key.",
            ));
        }
        Ok(match e.get("result") {
            Some(r) if e.get("state").and_then(Value::as_str) == Some("done") => {
                Seen::Done(r.clone())
            }
            _ => Seen::Pending,
        })
    }

    /// Hold `key` for `op` before the verb acts. `false` when another call holds it already.
    ///
    /// # Errors
    /// `hx.host.store_failed` when the table cannot be written: the verb must not act.
    pub fn reserve(&self, key: &str, op: &str, now: u64) -> Result<bool, Refusal> {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut entries = self.read();
        if let Some(e) = entries.get(key)
            && now.saturating_sub(e.get("at").and_then(Value::as_u64).unwrap_or(0)) < KEEP_MS
        {
            return Ok(false);
        }
        entries.insert(
            key.to_owned(),
            json!({"op": op, "at": now, "state": "pending"}),
        );
        self.write(entries, now).map(|()| true)
    }

    /// Keep the answer `key`'s verb gave.
    ///
    /// # Errors
    /// `hx.host.store_failed` when the table cannot be written.
    pub fn finish(&self, key: &str, op: &str, result: &Value, now: u64) -> Result<(), Refusal> {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut entries = self.read();
        entries.insert(
            key.to_owned(),
            json!({"op": op, "at": now, "state": "done", "result": result}),
        );
        self.write(entries, now)
    }

    /// Take `key` back out after its verb failed, so a retry may act.
    pub fn release(&self, key: &str, now: u64) {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut entries = self.read();
        if entries.remove(key).is_some() && self.write(entries, now).is_err() {
            tracing::warn!("the host-ops run table could not take back a failed call's key");
        }
    }
}
