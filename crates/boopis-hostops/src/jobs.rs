//! The house bot's jobs, `<app data>/house/jobs.jsonl` (section 7): one line per change, `{schema_version, job_id, at,
//! kind, …}`. The plugin writes only through `jobs.put` (kinds `opened`, `step`, `note`, `state`); the host adds `started`
//! lines for the sessions and runs it began for a job, which is how `bot.say` knows a session is this job's, and how a
//! job's stop knows what to stop.
//!
//! A job that spent money is never closed by a bot (Part C 2.5): `state: done` on it is written `done_suggested`, and only
//! the owner closes it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value, json};

use crate::{Refusal, append_private, rfc3339};

/// The kinds `jobs.put` takes.
pub const PUT_KINDS: &[&str] = &["opened", "step", "note", "state"];
/// The states a job may be put in.
pub const STATES: &[&str] = &["open", "waiting", "done", "failed", "cancelled"];
/// The longest line `jobs.put` takes.
pub const MAX_LINE: usize = 4096;
/// The states that end a job (`jobs.get` without an id lists the others).
const ENDED: &[&str] = &["done", "failed", "cancelled", "closed"];

/// The jobs file.
#[derive(Debug)]
pub struct Jobs {
    path: PathBuf,
    lock: Mutex<()>,
}

fn bad(what: &str) -> Refusal {
    Refusal::new("hx.invalid_params", what)
}

impl Jobs {
    /// The file at `path`.
    #[must_use]
    pub fn at(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            lock: Mutex::new(()),
        }
    }

    fn lines(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.path)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }

    fn append(&self, job_id: &str, mut line: Map<String, Value>, now: u64) -> Result<(), Refusal> {
        line.insert("schema_version".into(), 1.into());
        line.insert("job_id".into(), job_id.into());
        line.insert("at".into(), rfc3339(now).into());
        append_private(&self.path, &Value::Object(line).to_string(), u64::MAX)
    }

    /// Add the plugin's `line` to `job_id` and answer the job as it is after it.
    ///
    /// # Errors
    /// `hx.invalid_params` for a line of another kind, an unknown state or one too long; `hx.host.store_failed`.
    pub fn put(&self, job_id: &str, line: &Value, now: u64) -> Result<Value, Refusal> {
        let mut line = line
            .as_object()
            .cloned()
            .ok_or_else(|| bad("Give the line to add, as an object."))?;
        if Value::Object(line.clone()).to_string().len() > MAX_LINE {
            return Err(bad("The line is too long."));
        }
        let kind = line
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !PUT_KINDS.contains(&kind.as_str()) {
            return Err(bad("A job's line is opened, step, note or state."));
        }
        for k in ["schema_version", "job_id", "at", "started"] {
            line.remove(k);
        }
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let known = self.job_locked(job_id);
        match (kind.as_str(), &known) {
            ("opened", Some(_)) => return Err(bad("That job is open already.")),
            ("opened", None) => {}
            (_, None) => return Err(bad("There is no such job. Open it first.")),
            _ => {}
        }
        if kind == "state" {
            let state = line
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !STATES.contains(&state) {
                return Err(bad(
                    "A job's state is open, waiting, done, failed or cancelled.",
                ));
            }
            if state == "done" && known.as_ref().is_some_and(spent) {
                line.insert("state".into(), "done_suggested".into());
            }
        }
        self.append(job_id, line, now)?;
        Ok(self.job_locked(job_id).unwrap_or(Value::Null))
    }

    /// Note that the host began `what` (`{session_id, bot}` or `{run_id, …}`) for `job_id`.
    ///
    /// # Errors
    /// `hx.host.store_failed`.
    pub fn started(&self, job_id: &str, what: &Value, now: u64) -> Result<(), Refusal> {
        let mut line = Map::new();
        line.insert("kind".into(), "started".into());
        line.insert("what".into(), what.clone());
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.append(job_id, line, now)
    }

    /// Whether `session_id` of `bot` is one the host began for `job_id`.
    #[must_use]
    pub fn owns_session(&self, job_id: &str, bot: &str, session_id: &str) -> bool {
        self.job(job_id).is_some_and(|j| {
            j["started"].as_array().is_some_and(|s| {
                s.iter().any(|w| {
                    w.get("bot").and_then(Value::as_str) == Some(bot)
                        && w.get("session_id").and_then(Value::as_str) == Some(session_id)
                })
            })
        })
    }

    /// One job, folded from its lines.
    #[must_use]
    pub fn job(&self, job_id: &str) -> Option<Value> {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.job_locked(job_id)
    }

    fn job_locked(&self, job_id: &str) -> Option<Value> {
        fold(
            job_id,
            self.lines().iter().filter(|l| l["job_id"] == job_id),
        )
    }

    /// `job_id`'s job, or every job not ended.
    #[must_use]
    pub fn get(&self, job_id: Option<&str>) -> Vec<Value> {
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(id) = job_id {
            return self.job_locked(id).into_iter().collect();
        }
        let lines = self.lines();
        let mut ids: Vec<&str> = lines.iter().filter_map(|l| l["job_id"].as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        ids.into_iter()
            .filter_map(|id| fold(id, lines.iter().filter(|l| l["job_id"] == id)))
            .filter(|j| !ENDED.contains(&j["state"].as_str().unwrap_or_default()))
            .collect()
    }
}

fn spent(job: &Value) -> bool {
    job["spend"]["usd_est"].as_f64().is_some_and(|u| u > 0.0)
        || job["spend"]["turns"].as_u64().is_some_and(|t| t > 0)
}

fn fold<'a>(job_id: &str, lines: impl Iterator<Item = &'a Value>) -> Option<Value> {
    let mut job: Option<Value> = None;
    for l in lines {
        let j = job.get_or_insert_with(|| {
            json!({"id": job_id, "title": "", "state": "open", "steps": [], "spend": {"usd_est": 0.0, "turns": 0},
                   "started": [], "at": l["at"].clone()})
        });
        match l["kind"].as_str().unwrap_or_default() {
            "opened" => {
                if let Some(t) = l.get("title").and_then(Value::as_str) {
                    j["title"] = t.into();
                }
            }
            "state" => j["state"] = l["state"].clone(),
            "step" => {
                if let Some(a) = j["steps"].as_array_mut() {
                    a.push(json!({"bot": l.get("bot").cloned().unwrap_or(Value::Null),
                                  "state": l.get("state").cloned().unwrap_or(Value::Null)}));
                }
            }
            "started" => {
                if let Some(a) = j["started"].as_array_mut() {
                    a.push(l["what"].clone());
                }
            }
            _ => {}
        }
        if let Some(s) = l.get("spend") {
            let usd = j["spend"]["usd_est"].as_f64().unwrap_or(0.0)
                + s["usd_est"].as_f64().unwrap_or(0.0);
            let turns =
                j["spend"]["turns"].as_u64().unwrap_or(0) + s["turns"].as_u64().unwrap_or(0);
            j["spend"] = json!({"usd_est": usd, "turns": turns});
        }
        j["at"] = l["at"].clone();
    }
    job
}
