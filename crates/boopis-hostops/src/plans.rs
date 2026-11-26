//! Team plans as files, `<app data>/house/plans/<plan_hash>.json` (`docs/specs/team-ops.md` section 3 and 7).
//!
//! A plan is made from a fragment merged over the team's export ([`merge`]); its hash ([`plan_hash`]) is over its actions'
//! operations and the export's hash, so two plans of the same actions against the same team are one plan. The host plans
//! (`team::plan`, in the app) and this keeps the file: [`PlanStore::propose`] stores it `proposed` for 24 hours;
//! [`PlanStore::begin_apply`] runs the checks the owner's hold runs before anything changes (expired, stale, tampered,
//! problems); [`PlanStore::hold`] writes the snapshot and marks it `held`; [`PlanStore::finish`] keeps the report.
//!
//! States: `proposed` → `held` → `applied` | `failed`; `proposed` → `rejected` | `expired`; a tampered file → `failed`.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

use crate::{Refusal, canonical, rfc3339, sha256_hex, write_private};

/// How long a proposal waits for the owner.
pub const TTL_MS: u64 = 24 * 3600 * 1000;
/// Plans not applied are deleted this long after they were made.
pub const CLEAR_AFTER_MS: u64 = 30 * 24 * 3600 * 1000;
/// The most open plans one job may have.
pub const OPEN_PER_JOB: usize = 4;
/// The most plans a listing returns.
pub const LIST_MAX: usize = 50;

/// The sections of a team file that are maps by key.
const MAPS: &[&str] = &["bots", "rooms", "boards"];

fn invalid(what: &str) -> Refusal {
    Refusal::new("hx.invalid_params", what)
}

/// Merge `fragment` over `export` (section 3.1 step 2): maps by key (bots by name, rooms by name, boards by slug, jobs by
/// bot and name), a fragment's field replaces the export's field, and nothing is removed.
///
/// # Errors
/// `hx.invalid_params` when the fragment is not a team-file shape.
pub fn merge(export: &Value, fragment: &Value) -> Result<Value, Refusal> {
    let frag = fragment
        .as_object()
        .ok_or_else(|| invalid("The fragment is not a team file: it must be a map."))?;
    let mut out = export.as_object().cloned().unwrap_or_default();
    for (key, value) in frag {
        if MAPS.contains(&key.as_str()) {
            let items = value
                .as_object()
                .ok_or_else(|| invalid(&format!("{key} in the fragment must be a map by name.")))?;
            let section = out
                .entry(key.clone())
                .or_insert_with(|| Value::Object(Map::new()));
            if !section.is_object() {
                *section = Value::Object(Map::new());
            }
            if let Some(section) = section.as_object_mut() {
                for (name, fields) in items {
                    merge_entry(section.entry(name.clone()).or_insert(Value::Null), fields)
                        .map_err(|()| {
                            invalid(&format!("{key}.{name} in the fragment must be a map."))
                        })?;
                }
            }
        } else if key == "cron" {
            let jobs = value
                .as_array()
                .ok_or_else(|| invalid("cron in the fragment must be a list."))?;
            let list = out
                .entry("cron")
                .or_insert_with(|| Value::Array(Vec::new()));
            if !list.is_array() {
                *list = Value::Array(Vec::new());
            }
            if let Some(list) = list.as_array_mut() {
                for job in jobs {
                    let id = |j: &Value| (j.get("bot").cloned(), j.get("name").cloned());
                    if !job.is_object() || job.get("bot").is_none() || job.get("name").is_none() {
                        return Err(invalid(
                            "Each cron job in the fragment names its bot and its name.",
                        ));
                    }
                    match list.iter_mut().find(|j| id(j) == id(job)) {
                        Some(have) => merge_entry(have, job)
                            .map_err(|()| invalid("A cron job must be a map."))?,
                        None => list.push(job.clone()),
                    }
                }
            }
        } else {
            out.insert(key.clone(), value.clone());
        }
    }
    Ok(Value::Object(out))
}

fn merge_entry(have: &mut Value, want: &Value) -> Result<(), ()> {
    let want = want.as_object().ok_or(())?;
    if !have.is_object() {
        *have = Value::Object(Map::new());
    }
    if let Some(have) = have.as_object_mut() {
        for (k, v) in want {
            have.insert(k.clone(), v.clone());
        }
    }
    Ok(())
}

/// The export's hash: SHA-256 over its canonical JSON.
#[must_use]
pub fn export_hash(export: &Value) -> String {
    sha256_hex(canonical(export).as_bytes())
}

/// The plan's hash: SHA-256 over the canonical JSON of `{"actions": [each action's op], "base_export_hash": …}`.
#[must_use]
pub fn plan_hash(ops: &[Value], base_export_hash: &str) -> String {
    sha256_hex(canonical(&json!({"actions": ops, "base_export_hash": base_export_hash})).as_bytes())
}

fn ops_of(actions: &[Value]) -> Vec<Value> {
    actions
        .iter()
        .map(|a| a.get("op").cloned().unwrap_or(Value::Null))
        .collect()
}

/// How many bots, rooms, boards and jobs `actions` touch.
#[must_use]
pub fn counts(actions: &[Value]) -> Value {
    let n = |kind: &str| {
        actions
            .iter()
            .filter(|a| {
                a["target"]
                    .as_str()
                    .is_some_and(|t| t.starts_with(&format!("{kind} ")))
            })
            .count()
    };
    json!({"bots": n("bot"), "rooms": n("room"), "boards": n("board"), "jobs": n("job")})
}

/// A plan's title, from what it does (`Add 1 bot and 1 room`, `Change 2 bots`).
#[must_use]
pub fn title(actions: &[Value]) -> String {
    let mut parts = Vec::new();
    for (mark, verb) in [("+", "Add"), ("~", "Change"), ("-", "Remove")] {
        let mut kinds: Vec<(String, usize)> = Vec::new();
        for a in actions.iter().filter(|a| a["mark"].as_str() == Some(mark)) {
            let kind = a["target"]
                .as_str()
                .and_then(|t| t.split(' ').next())
                .unwrap_or("thing")
                .to_owned();
            match kinds.iter_mut().find(|(k, _)| *k == kind) {
                Some((_, n)) => *n += 1,
                None => kinds.push((kind, 1)),
            }
        }
        if kinds.is_empty() {
            continue;
        }
        let said: Vec<String> = kinds
            .into_iter()
            .map(|(k, n)| {
                if n == 1 {
                    format!("1 {k}")
                } else {
                    format!("{n} {k}s")
                }
            })
            .collect();
        parts.push(format!("{verb} {}", said.join(" and ")));
    }
    if parts.is_empty() {
        "Nothing to change".to_owned()
    } else {
        parts.join("; ")
    }
}

/// Keep only the undo's actions whose target the applied plan touched (section 3.3); the rest become notes. Disbanding a
/// room is permanent and a note says so.
#[must_use]
pub fn undo_filter(actions: Vec<Value>, touched: &[String]) -> (Vec<Value>, Vec<String>) {
    let mut kept = Vec::new();
    let mut notes = Vec::new();
    for a in actions {
        let target = a["target"].as_str().unwrap_or_default().to_owned();
        if touched.contains(&target) {
            if a["mark"] == "-" && target.starts_with("room ") {
                notes.push(format!(
                    "Disbanding {target} is permanent: it cannot be undone."
                ));
            }
            kept.push(a);
        } else {
            notes.push(format!("{target} changed after this plan; left as it is."));
        }
    }
    (kept, notes)
}

/// What the host planned, for the store to keep.
#[derive(Debug, Clone, Default)]
pub struct Proposal {
    /// The export's hash the plan was made against.
    pub base_export_hash: String,
    /// Each action: `{mark, target, what, op}`.
    pub actions: Vec<Value>,
    /// What cannot be done.
    pub problems: Vec<String>,
    /// What is left alone, and why.
    pub notes: Vec<String>,
    /// The bot's (or the owner's) reason, one line.
    pub reason: String,
    /// The fragment, as given (YAML).
    pub fragment: String,
    /// The merged team file (YAML), what an apply plans again.
    pub merged: String,
    /// The job it was made for.
    pub job_id: Option<String>,
    /// Planned with prune (only the owner's undo).
    pub prune: bool,
    /// For an undo: the targets the actions are kept to.
    pub only: Option<Vec<String>>,
    /// For an undo: the plan it undoes.
    pub undoes: Option<String>,
}

/// Whether `hash` is a plan hash (64 lowercase hex).
#[must_use]
pub fn is_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn no_plan() -> Refusal {
    Refusal::new(
        "hx.team.plan_not_found",
        "There is no such plan. Make a new one.",
    )
}

/// The plans folder.
#[derive(Debug, Clone)]
pub struct PlanStore {
    house: PathBuf,
}

impl PlanStore {
    /// The store under `house` (`<app data>/house`).
    #[must_use]
    pub fn under(house: &Path) -> Self {
        Self {
            house: house.to_path_buf(),
        }
    }

    fn file(&self, hash: &str) -> PathBuf {
        self.house.join("plans").join(format!("{hash}.json"))
    }

    /// A plan's file, as stored.
    #[must_use]
    pub fn get(&self, hash: &str) -> Option<Value> {
        if !is_hash(hash) {
            return None;
        }
        std::fs::read(self.file(hash))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
    }

    fn save(&self, doc: &Value) -> Result<(), Refusal> {
        let hash = doc["plan_hash"].as_str().unwrap_or_default();
        if !is_hash(hash) {
            return Err(no_plan());
        }
        let bytes = serde_json::to_vec_pretty(doc).map_err(|_| no_plan())?;
        write_private(&self.file(hash), &bytes)
    }

    fn set_state(&self, doc: &mut Value, state: &str) -> Result<(), Refusal> {
        doc["state"] = state.into();
        self.save(doc)
    }

    /// Store `p` as a proposal (idempotent by its hash) and answer it as section 3.1 step 7 says. A plan with nothing to do
    /// is answered `nothing_to_do` and not stored.
    ///
    /// # Errors
    /// `hx.host.store_failed` when the file cannot be written.
    pub fn propose(&self, p: &Proposal, now: u64) -> Result<Value, Refusal> {
        let hash = plan_hash(&ops_of(&p.actions), &p.base_export_hash);
        let shown: Vec<Value> = p
            .actions
            .iter()
            .map(|a| json!({"mark": a["mark"], "target": a["target"], "what": a["what"]}))
            .collect();
        let mut answer = json!({
            "plan_hash": hash,
            "base_export_hash": p.base_export_hash,
            "plan": {"actions": shown, "problems": p.problems, "notes": p.notes},
            "state": "nothing_to_do",
            "expires_at": Value::Null,
        });
        if p.actions.is_empty() {
            return Ok(answer);
        }
        let doc = if let Some(d) = self.get(&hash) {
            d
        } else {
            let mut doc = json!({
                "schema_version": 1,
                "plan_hash": hash,
                "base_export_hash": p.base_export_hash,
                "reason": p.reason,
                "title": title(&p.actions),
                "fragment": p.fragment,
                "merged": p.merged,
                "prune": p.prune,
                "plan": {"actions": p.actions, "problems": p.problems, "notes": p.notes},
                "lints": [],
                "estimate": Value::Null,
                "state": "proposed",
                "created_ms": now,
                "created_at": rfc3339(now),
                "expires_ms": now + TTL_MS,
                "expires_at": rfc3339(now + TTL_MS),
            });
            if let Some(j) = &p.job_id {
                doc["job_id"] = j.as_str().into();
            }
            if let Some(o) = &p.only {
                doc["only"] = json!(o);
            }
            if let Some(u) = &p.undoes {
                doc["undoes"] = u.as_str().into();
            }
            self.save(&doc)?;
            doc
        };
        answer["state"] = doc["state"].clone();
        answer["expires_at"] = doc["expires_at"].clone();
        Ok(answer)
    }

    /// Every stored plan, newest first.
    fn all(&self) -> Vec<Value> {
        let mut out: Vec<Value> = std::fs::read_dir(self.house.join("plans"))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                name.strip_suffix(".json")
                    .filter(|h| is_hash(h))
                    .and_then(|h| self.get(h))
            })
            .collect();
        out.sort_by_key(|d| std::cmp::Reverse(d["created_ms"].as_u64().unwrap_or(0)));
        out
    }

    /// How many plans of `job_id` wait for the owner.
    #[must_use]
    pub fn open_for_job(&self, job_id: &str, now: u64) -> usize {
        self.all()
            .iter()
            .filter(|d| d["job_id"] == job_id && d["state"] == "proposed" && !expired(d, now))
            .count()
    }

    /// The plans as a listing shows them (`GET /v1/plans`, the window's list): the proposals waiting, or every plan.
    #[must_use]
    pub fn list(&self, all: bool, now: u64) -> Vec<Value> {
        self.all()
            .into_iter()
            .filter(|d| all || (d["state"] == "proposed" && !expired(d, now)))
            .take(LIST_MAX)
            .map(|d| {
                let actions = d["plan"]["actions"].as_array().cloned().unwrap_or_default();
                json!({
                    "plan_hash": d["plan_hash"], "title": d["title"], "reason": d["reason"],
                    "counts": counts(&actions), "state": shown_state(&d, now),
                    "created_at": d["created_at"], "expires_at": d["expires_at"],
                    "undoes": d.get("undoes").cloned().unwrap_or(Value::Null),
                })
            })
            .collect()
    }

    /// One plan as the window and the local API show it: never the fragment or the merged file.
    #[must_use]
    pub fn public(&self, hash: &str, now: u64) -> Option<Value> {
        let d = self.get(hash)?;
        let actions: Vec<Value> = d["plan"]["actions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| json!({"mark": a["mark"], "target": a["target"], "what": a["what"]}))
            .collect();
        Some(json!({
            "plan_hash": d["plan_hash"], "title": d["title"], "reason": d["reason"],
            "job_id": d.get("job_id").cloned().unwrap_or(Value::Null),
            "actions": actions, "problems": d["plan"]["problems"], "notes": d["plan"]["notes"],
            "counts": counts(d["plan"]["actions"].as_array().map_or(&[][..], Vec::as_slice)),
            "state": shown_state(&d, now), "created_at": d["created_at"], "expires_at": d["expires_at"],
            "report": d.get("report").cloned().unwrap_or(Value::Null),
            "answered_by": d.get("answered_by").cloned().unwrap_or(Value::Null),
            "undoes": d.get("undoes").cloned().unwrap_or(Value::Null),
            "words": d.get("words").cloned().unwrap_or(Value::Null),
            "permanent": d["plan"]["actions"].as_array().is_some_and(|a| a.iter().any(|x| x["mark"] == "-" && x["target"].as_str().is_some_and(|t| t.starts_with("room ")))),
        }))
    }

    /// The checks the owner's hold runs before anything changes (section 3.2 steps 1 to 3). `export_hash` is the team's
    /// export now; `live_ops` are the operations the stored merged file plans against the team now. The stored plan, when
    /// it may be applied.
    ///
    /// # Errors
    /// `hx.team.plan_not_found`; `hx.team.plan_not_open` for a plan that is not `proposed`; `hx.team.plan_expired` (the
    /// plan becomes `expired`); `hx.team.plan_problems`; `hx.team.plan_stale` (it becomes `expired`); `hx.team.plan_tampered`
    /// (it becomes `failed`).
    pub fn begin_apply(
        &self,
        hash: &str,
        export_hash: &str,
        live_ops: &[Value],
        now: u64,
    ) -> Result<Value, Refusal> {
        let mut doc = self.get(hash).ok_or_else(no_plan)?;
        if doc["state"] != "proposed" {
            return Err(Refusal::new(
                "hx.team.plan_not_open",
                "That plan was answered already.",
            ));
        }
        if expired(&doc, now) {
            self.set_state(&mut doc, "expired")?;
            return Err(Refusal::new(
                "hx.team.plan_expired",
                "That plan is more than a day old. Ask for a new one.",
            ));
        }
        let stored = doc["plan"]["actions"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let base = doc["base_export_hash"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        if doc["plan_hash"] != hash || plan_hash(&ops_of(&stored), &base) != hash {
            self.set_state(&mut doc, "failed")?;
            return Err(Refusal::new(
                "hx.team.plan_tampered",
                "That plan's file was changed after it was made. Ask for a new one.",
            ));
        }
        if doc["plan"]["problems"]
            .as_array()
            .is_some_and(|p| !p.is_empty())
        {
            return Err(Refusal::new(
                "hx.team.plan_problems",
                "That plan has problems, so it cannot be applied.",
            ));
        }
        if export_hash != base || plan_hash(live_ops, export_hash) != hash {
            self.set_state(&mut doc, "expired")?;
            return Err(Refusal::new(
                "hx.team.plan_stale",
                "The team changed since this plan was made. Ask for a new one.",
            ));
        }
        Ok(doc)
    }

    /// Write the snapshot (the export just before the apply, YAML) and mark the plan `held`. The snapshot's path.
    ///
    /// # Errors
    /// `hx.host.store_failed`: then nothing is applied.
    pub fn hold(&self, hash: &str, snapshot_yaml: &str, now: u64) -> Result<PathBuf, Refusal> {
        let mut doc = self.get(hash).ok_or_else(no_plan)?;
        let at = rfc3339(now).replace(':', "-");
        let path = self
            .house
            .join("snapshots")
            .join(format!("{at}-{hash}.yaml"));
        write_private(&path, snapshot_yaml.as_bytes())?;
        doc["snapshot"] = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .into();
        self.set_state(&mut doc, "held")?;
        Ok(path)
    }

    /// The snapshot a plan was applied over, as YAML.
    #[must_use]
    pub fn snapshot(&self, hash: &str) -> Option<String> {
        let doc = self.get(hash)?;
        let name = doc["snapshot"].as_str()?;
        if name.contains('/') || name.contains('\\') {
            return None;
        }
        std::fs::read_to_string(self.house.join("snapshots").join(name)).ok()
    }

    /// Keep an apply's report: `applied` when every action went well, else `failed`.
    ///
    /// # Errors
    /// `hx.host.store_failed`.
    pub fn finish(
        &self,
        hash: &str,
        report: &Value,
        all_ok: bool,
        surface: &str,
        now: u64,
    ) -> Result<Value, Refusal> {
        let mut doc = self.get(hash).ok_or_else(no_plan)?;
        doc["report"] = report.clone();
        doc["answered_by"] = json!({"surface": surface, "at": rfc3339(now)});
        self.set_state(&mut doc, if all_ok { "applied" } else { "failed" })?;
        Ok(doc)
    }

    /// The owner says no; `words` are kept for the bot to read.
    ///
    /// # Errors
    /// `hx.team.plan_not_found`, `hx.team.plan_not_open`, `hx.host.store_failed`.
    pub fn reject(
        &self,
        hash: &str,
        words: Option<&str>,
        surface: &str,
        now: u64,
    ) -> Result<Value, Refusal> {
        let mut doc = self.get(hash).ok_or_else(no_plan)?;
        if doc["state"] != "proposed" {
            return Err(Refusal::new(
                "hx.team.plan_not_open",
                "That plan was answered already.",
            ));
        }
        if let Some(w) = words.map(str::trim).filter(|w| !w.is_empty()) {
            doc["words"] = w.chars().take(2000).collect::<String>().into();
        }
        doc["answered_by"] = json!({"surface": surface, "at": rfc3339(now)});
        self.set_state(&mut doc, "rejected")?;
        Ok(doc)
    }

    /// Delete plans older than 30 days that were not applied (at start). How many went.
    #[must_use = "how many plans were deleted"]
    pub fn clear_old(&self, now: u64) -> usize {
        let mut n = 0;
        for d in self.all() {
            let old = now.saturating_sub(d["created_ms"].as_u64().unwrap_or(0)) > CLEAR_AFTER_MS;
            if old
                && d["state"] != "applied"
                && d["state"] != "failed"
                && let Some(h) = d["plan_hash"].as_str().filter(|h| is_hash(h))
                && std::fs::remove_file(self.file(h)).is_ok()
            {
                n += 1;
            }
        }
        n
    }
}

fn expired(doc: &Value, now: u64) -> bool {
    doc["expires_ms"].as_u64().is_none_or(|e| now >= e)
}

fn shown_state(doc: &Value, now: u64) -> Value {
    if doc["state"] == "proposed" && expired(doc, now) {
        "expired".into()
    } else {
        doc["state"].clone()
    }
}
