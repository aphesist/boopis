//! `team apply`: run a plan through a [`Backend`], one operation at a time, in the plan's order. An operation that fails is
//! reported and everything that needed what it was making is skipped; the rest goes on, so a second run finishes the job.

use async_trait::async_trait;
use serde::Serialize;

use super::plan::{Action, Current, Op, Plan};
use crate::error::Result;

/// What `apply` reads and changes: the live engine in the app, a model in the tests.
#[async_trait]
pub trait Backend: Send + Sync {
    /// Everything the plan compares with.
    async fn read(&self) -> Result<Current>;
    /// Do one thing.
    async fn run(&self, op: &Op) -> Result<()>;
    /// Check a bot's skills once it exists (a new bot's, after it is made): the names that are not installed for it.
    async fn missing_skills(&self, bot: &str, wanted: &[String]) -> Result<Vec<String>>;
}

/// How one action went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Done {
    /// The action.
    pub mark: char,
    /// What it was about.
    pub target: String,
    /// What it did.
    pub what: String,
    /// `ok`, `failed` or `skipped`.
    pub result: &'static str,
    /// Why it failed or was skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What `apply` did.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct Report {
    /// Each action's outcome.
    pub done: Vec<Done>,
    /// Things worth saying after (a new bot's skill that is not installed).
    pub warnings: Vec<String>,
}

impl Report {
    /// Whether every action went well.
    #[must_use]
    pub fn all_ok(&self) -> bool {
        self.done.iter().all(|d| d.result == "ok")
    }
}

/// Run `plan`. `wanted_skills` are a new bot's skills, checked after it is made.
///
/// # Errors
/// Never for an action that fails (that is in the report); only the plan's own problems are an error.
pub async fn apply(
    backend: &dyn Backend,
    plan: &Plan,
    wanted_skills: &std::collections::BTreeMap<String, Vec<String>>,
) -> Result<Report> {
    if !plan.problems.is_empty() {
        return Err(crate::error::Error::InvalidInput(plan.problems.join("\n")));
    }
    let mut report = Report::default();
    let mut failed: Vec<String> = Vec::new();
    for a in &plan.actions {
        let blocked = a.needs.as_ref().filter(|n| failed.contains(n));
        if let Some(n) = blocked {
            report
                .done
                .push(done(a, "skipped", Some(format!("{n} could not be made"))));
            continue;
        }
        match backend.run(&a.op).await {
            Ok(()) => {
                report.done.push(done(a, "ok", None));
                if let Op::CreateBot { name, .. } = &a.op
                    && let Some(skills) = wanted_skills.get(name)
                    && !skills.is_empty()
                {
                    match backend.missing_skills(name, skills).await {
                        Ok(missing) if !missing.is_empty() => report.warnings.push(format!(
                            "bot {name}: the skill {} is not installed for it. Install it from the store, then apply again",
                            missing.join(", ")
                        )),
                        Ok(_) => {}
                        Err(e) => report.warnings.push(format!("bot {name}: its skills could not be checked: {e}")),
                    }
                }
                if let Op::CreateBot { name, .. } = &a.op
                    && let Some(skills) = wanted_skills.get(name)
                {
                    switch_on_wanted(backend, name, skills, &mut report).await;
                }
            }
            Err(e) => {
                if let Op::CreateBot { name, .. } = &a.op {
                    failed.push(name.clone());
                }
                if let Op::CreateRoom { name, .. } = &a.op {
                    failed.push(name.clone());
                }
                report.done.push(done(
                    a,
                    "failed",
                    Some(crate::error::unless_engine(
                        "hx.engine.refused",
                        &e.to_string(),
                    )),
                ));
            }
        }
    }
    Ok(report)
}

/// A new bot starts with the bots' default skill index (ADR-0047), so the skills the file names are switched on once it exists;
/// one that is not installed is left to the check above.
async fn switch_on_wanted(
    backend: &dyn Backend,
    name: &str,
    wanted: &[String],
    report: &mut Report,
) {
    if wanted.is_empty() {
        return;
    }
    let op = Op::EnableSkills {
        bot: name.to_owned(),
        skills: wanted.to_vec(),
    };
    if let Err(e) = backend.run(&op).await {
        report.warnings.push(format!(
            "bot {name}: its skills ({}) could not be switched on: {}",
            wanted.join(", "),
            crate::error::unless_engine("hx.engine.refused", &e.to_string())
        ));
    }
}

fn done(a: &Action, result: &'static str, error: Option<String>) -> Done {
    Done {
        mark: a.mark,
        target: a.target.clone(),
        what: a.what.clone(),
        result,
        error,
    }
}
