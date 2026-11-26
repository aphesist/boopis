//! Team plans the owner holds to apply (`docs/specs/team-ops.md` section 3, ADR-0061): a fragment merged over the team's
//! export and planned ([`propose`]), applied only by plan hash after the checks and a snapshot ([`apply_held`]), the way
//! back to the snapshot planned as a new plan ([`undo`]), and a refusal kept with the owner's words ([`reject`]).
//!
//! The files are `boopis_hostops::plans`'s (`<app data>/house/plans/`, `snapshots/`); this module reads the team through
//! [`Backend`] and plans with [`plan::plan`], the same functions `boopis team apply` uses. A plan is never applied partly
//! changed: the merged file is planned again against the team as it is now, and an apply goes ahead only when that gives
//! the very actions the stored hash names, over the very export it was made against.

use std::collections::BTreeMap;
use std::path::Path;

use boopis_hostops::Refusal;
use boopis_hostops::plans::{self, PlanStore, Proposal};
use serde_json::{Value, json};

use super::apply::{self, Backend};
use super::export;
use super::plan::{self, Current, Plan};
use super::spec::Team;

/// The fields of a team file that name another file: a fragment may not use them (a plan reads no file of the machine).
const FILE_FIELDS: &[&str] = &["soul", "purpose_file", "prompt_file"];

fn unreadable() -> Refusal {
    Refusal::new(
        "hx.team.unreadable",
        "boopis could not read the team just now. Try again in a moment.",
    )
}

/// The team as it is, written as a team file and as JSON.
fn exported(now: &Current) -> Result<(Team, Value), Refusal> {
    let team = export::export(now).team;
    let v = serde_json::to_value(&team).map_err(|_| unreadable())?;
    Ok((team, v))
}

/// A plan's actions as the plan file keeps them: `{mark, target, what, op}`.
#[must_use]
pub fn actions_json(p: &Plan) -> Vec<Value> {
    p.actions
        .iter()
        .map(|a| {
            json!({
                "mark": a.mark.to_string(),
                "target": a.target,
                "what": a.what,
                "op": serde_json::to_value(&a.op).unwrap_or(Value::Null),
            })
        })
        .collect()
}

fn names_a_file(v: &Value) -> bool {
    match v {
        Value::Object(m) => m
            .iter()
            .any(|(k, v)| FILE_FIELDS.contains(&k.as_str()) || names_a_file(v)),
        Value::Array(a) => a.iter().any(names_a_file),
        _ => false,
    }
}

/// Make a plan from `fragment` (YAML) over the team as it is (section 3.1), and store it as a proposal.
///
/// # Errors
/// `hx.team.unreadable` when the team cannot be read; `hx.invalid_params` with every problem when the merged file is not a
/// usable team; `hx.host.store_failed` when the plan cannot be written.
pub async fn propose(
    backend: &dyn Backend,
    house: &Path,
    fragment: &str,
    reason: &str,
    job_id: Option<&str>,
    now_ms: u64,
) -> Result<Value, Refusal> {
    let frag: Value = serde_norway::from_str(fragment).map_err(|_| {
        Refusal::new(
            "hx.invalid_params",
            "The fragment is not YAML. Write it as a part of a team file.",
        )
    })?;
    if names_a_file(&frag) {
        return Err(Refusal::new(
            "hx.invalid_params",
            "A plan's fragment writes text, not the name of a file (soul_text, purpose, prompt).",
        ));
    }
    let now = backend.read().await.map_err(|_| unreadable())?;
    let (_, export_v) = exported(&now)?;
    let base = plans::export_hash(&export_v);
    let merged_v = plans::merge(&export_v, &frag)?;
    let team: Team = serde_json::from_value(merged_v).map_err(|e| {
        Refusal::new(
            "hx.invalid_params",
            &format!("The fragment does not make a team file: {e}"),
        )
    })?;
    let problems = team.check();
    if !problems.is_empty() {
        return Err(Refusal::new(
            "hx.invalid_params",
            &format!("The team would not be usable:\n{}", problems.join("\n")),
        ));
    }
    let p = plan::plan(&team, &now, false);
    let merged = team.to_yaml().map_err(|_| unreadable())?;
    PlanStore::under(house).propose(
        &Proposal {
            base_export_hash: base,
            actions: actions_json(&p),
            problems: p.problems,
            notes: p.notes,
            reason: reason.trim().to_owned(),
            fragment: fragment.to_owned(),
            merged,
            job_id: job_id.map(str::to_owned),
            ..Proposal::default()
        },
        now_ms,
    )
}

/// The plan a stored file makes against `now`: its merged file planned again, with the file's prune, kept to its targets
/// for an undo.
fn replan(doc: &Value, now: &Current) -> Result<(Team, Plan), Refusal> {
    let tampered = || {
        Refusal::new(
            "hx.team.plan_tampered",
            "That plan's file was changed after it was made. Ask for a new one.",
        )
    };
    let merged = doc["merged"].as_str().ok_or_else(tampered)?;
    let team: Team = serde_norway::from_str(merged).map_err(|_| tampered())?;
    if !team.check().is_empty() {
        return Err(tampered());
    }
    let mut p = plan::plan(&team, now, doc["prune"].as_bool().unwrap_or(false));
    if let Some(only) = doc["only"].as_array() {
        let only: Vec<&str> = only.iter().filter_map(Value::as_str).collect();
        p.actions.retain(|a| only.contains(&a.target.as_str()));
    }
    Ok((team, p))
}

/// Apply the stored plan `hash` (section 3.2): only the owner's hold calls this (`team_plan_apply`, or `boopis team apply
/// --hash` in the owner's terminal). The checks first, then the snapshot, then the actions; the report is kept in the plan.
///
/// # Errors
/// The checks' refusals (`hx.team.plan_*`), `hx.team.unreadable`, `hx.host.store_failed`. An action that fails is not an
/// error: it is in the report, and the plan is `failed`.
pub async fn apply_held(
    backend: &dyn Backend,
    house: &Path,
    hash: &str,
    surface: &str,
    now_ms: u64,
) -> Result<Value, Refusal> {
    let store = PlanStore::under(house);
    let doc = store.get(hash).ok_or_else(|| {
        Refusal::new(
            "hx.team.plan_not_found",
            "There is no such plan. Make a new one.",
        )
    })?;
    let now = backend.read().await.map_err(|_| unreadable())?;
    let (current, export_v) = exported(&now)?;
    let (team, live) = replan(&doc, &now)?;
    let live_ops: Vec<Value> = actions_json(&live)
        .into_iter()
        .map(|a| a["op"].clone())
        .collect();
    store.begin_apply(hash, &plans::export_hash(&export_v), &live_ops, now_ms)?;
    let snapshot = current.to_yaml().map_err(|_| unreadable())?;
    store.hold(hash, &snapshot, now_ms)?;
    let wanted: BTreeMap<String, Vec<String>> = team
        .bots
        .iter()
        .filter(|(_, b)| !b.skills.is_empty())
        .map(|(n, b)| (n.clone(), b.skills.clone()))
        .collect();
    let (report, all_ok) = match apply::apply(backend, &live, &wanted).await {
        Ok(r) => {
            let ok = r.all_ok();
            (serde_json::to_value(&r).unwrap_or(Value::Null), ok)
        }
        Err(e) => (
            json!({"done": [], "warnings": [], "error": e.to_string()}),
            false,
        ),
    };
    let done = store.finish(hash, &report, all_ok, surface, now_ms)?;
    answer_line(
        house,
        "apply",
        hash,
        done["state"].as_str().unwrap_or("failed"),
        surface,
        now_ms,
    );
    Ok(store.public(hash, now_ms).unwrap_or(done))
}

/// Plan the way back from an applied plan (section 3.3): its snapshot planned over the team as it is, with prune, kept to
/// what the plan touched. The result is a new proposal, applied by the same hold.
///
/// # Errors
/// `hx.team.plan_not_found`; `hx.team.plan_not_open` when the plan was not applied; `hx.team.unreadable`;
/// `hx.host.store_failed`.
pub async fn undo(
    backend: &dyn Backend,
    house: &Path,
    hash: &str,
    surface: &str,
    now_ms: u64,
) -> Result<Value, Refusal> {
    let store = PlanStore::under(house);
    let doc = store.get(hash).ok_or_else(|| {
        Refusal::new(
            "hx.team.plan_not_found",
            "There is no such plan. Make a new one.",
        )
    })?;
    if doc["state"] != "applied" && doc["state"] != "failed" {
        return Err(Refusal::new(
            "hx.team.plan_not_open",
            "Only a plan that was applied can be undone.",
        ));
    }
    let snapshot = store.snapshot(hash).ok_or_else(unreadable)?;
    let back: Team = serde_norway::from_str(&snapshot).map_err(|_| unreadable())?;
    let touched: Vec<String> = doc["plan"]["actions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["target"].as_str().map(str::to_owned))
        .collect();
    let now = backend.read().await.map_err(|_| unreadable())?;
    let (_, export_v) = exported(&now)?;
    let p = plan::plan(&back, &now, true);
    let (kept, mut notes) = plans::undo_filter(actions_json(&p), &touched);
    notes.extend(p.notes);
    let title = doc["title"].as_str().unwrap_or("the plan");
    let made = store.propose(
        &Proposal {
            base_export_hash: plans::export_hash(&export_v),
            actions: kept,
            problems: p.problems,
            notes,
            reason: format!("Undo {title}"),
            fragment: String::new(),
            merged: snapshot,
            job_id: None,
            prune: true,
            only: Some(touched),
            undoes: Some(hash.to_owned()),
        },
        now_ms,
    )?;
    answer_line(
        house,
        "undo",
        hash,
        made["state"].as_str().unwrap_or(""),
        surface,
        now_ms,
    );
    Ok(made)
}

/// The owner says no to a plan; `words` are kept for the bot to read with `jobs.get`.
///
/// # Errors
/// `hx.team.plan_not_found`, `hx.team.plan_not_open`, `hx.host.store_failed`.
pub fn reject(
    house: &Path,
    hash: &str,
    words: Option<&str>,
    surface: &str,
    now_ms: u64,
) -> Result<Value, Refusal> {
    let store = PlanStore::under(house);
    store.reject(hash, words, surface, now_ms)?;
    answer_line(house, "reject", hash, "rejected", surface, now_ms);
    store.public(hash, now_ms).ok_or_else(|| {
        Refusal::new(
            "hx.team.plan_not_found",
            "There is no such plan. Make a new one.",
        )
    })
}

/// One line in `audit/client-answers.jsonl` for an apply, an undo or a reject (section 3.2 step 6). `house` is
/// `<app data>/house`; the trail is beside it.
fn answer_line(house: &Path, choice: &str, hash: &str, outcome: &str, surface: &str, now_ms: u64) {
    let Some(data) = house.parent() else { return };
    let line = json!({
        "at": boopis_hostops::rfc3339(now_ms),
        "route": "team_plan",
        "choice": choice,
        "plan_hash": hash,
        "outcome": outcome,
        "surface": surface,
    });
    if boopis_hostops::append_private(
        &data.join("audit").join("client-answers.jsonl"),
        &line.to_string(),
        boopis_hostops::audit::ROTATE_AT,
    )
    .is_err()
    {
        tracing::warn!("the answers trail could not record a team plan's answer");
    }
}
