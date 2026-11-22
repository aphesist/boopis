//! Run a task through one bot, headless (`boopis run --bot`).
//!
//! A single bot has no rounds. The engine has a goal mode for this: a goal is a task that stays active across turns, and after
//! every turn a judge decides whether it is satisfied; when it is not, a continuation prompt takes the session through another
//! turn, until the judge says done, the turn budget is spent, or the goal is paused (`hermes_cli/goals.py`). A client of the
//! gateway drives it the way the engine's own command-line client does (`gateway/session_viewer_automation.py`): it asks the
//! engine to keep the goal (`session.automation`, `goal.set`, with the turn budget), submits the turns itself, and after each
//! one asks the engine's judge (`goal.evaluate_after_turn`), which answers with the verdict and the goal's new state. A session
//! driven this way is skipped by the gateway's own judging, so no turn is judged twice.
//!
//! Where each signal comes from, and nothing is made up:
//! - **done**: the judge's `done` (the goal's status is `done`);
//! - **cap reached**: the goal is paused and its turns used have reached its budget;
//! - **needs the owner**: an approval is pending in the session (`approval.pending`), or the judge ruled the task blocked on
//!   something only a person can give (verdict `blocked`). An approval is never answered here;
//! - **failed**: the turn's own receipt says it failed or was interrupted (`prompt.receipt`), it ended with no answer, or the
//!   judge could not run (the goal paused without reaching its budget);
//! - a goal **parked** by the judge (waiting on a process or a delay) is waited out and judged again, within the run's time.
//!
//! The budget is the number of turns in all, the task's own included. The run passes the number it resolved
//! ([`super::limit::effective`]: the flag, else the bot's `goals.max_turns`, else ten) to the goal, so the engine enforces it.

use std::time::Duration;

use serde_json::{Value, json};
use tokio::time::Instant;

use crate::error::{Error, Result};
use crate::rooms::run::{Stop, turn_failed_words};
use crate::rooms::{Rpc, new_event_id};

/// How a run behaves.
#[derive(Debug, Clone)]
pub struct Opts {
    /// The goal's budget: the most turns, in all, the task may take.
    pub max_turns: u32,
    /// How often a turn that is running is read.
    pub poll: Duration,
    /// The longest the whole run may take.
    pub timeout: Duration,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            max_turns: super::limit::DEFAULT_MAX_TURNS,
            poll: Duration::from_secs(2),
            timeout: Duration::from_hours(1),
        }
    }
}

/// Something worth telling while the run goes on.
#[derive(Debug, Clone, PartialEq)]
pub enum Progress {
    /// The session the task runs in was made.
    Started(String),
    /// The bot finished a turn with this answer.
    Message {
        /// Which turn it was (the task's own is the first).
        turn: u32,
        /// What it said.
        text: String,
        /// When, in seconds since 1970.
        at: f64,
    },
    /// The judge ruled the task not done and the run goes on with another turn.
    Continued {
        /// The turns used so far.
        used: u32,
        /// The budget.
        of: u32,
    },
    /// The judge parked the task: it waits for something to finish before the next turn.
    Parked(String),
}

/// What a run did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    /// Why it ended.
    pub stop: Stop,
    /// The session the task ran in (the bot's recent sessions list it).
    pub session: String,
    /// The turns the task used.
    pub turns: u32,
    /// The budget it ran under.
    pub max_turns: u32,
    /// How many answers the bot gave.
    pub messages: u32,
}

/// The goal as the engine keeps it (the fields this reads of `GoalState`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Goal {
    status: String,
    turns_used: u32,
    max_turns: u32,
    paused_reason: String,
}

impl Goal {
    fn parse(state: &Value) -> Option<Self> {
        let raw = state.as_str()?;
        let v: Value = serde_json::from_str(raw).ok()?;
        let num = |k: &str| {
            v.get(k)
                .and_then(Value::as_u64)
                .map_or(0, |n| u32::try_from(n).unwrap_or(u32::MAX))
        };
        let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
        Some(Self {
            status: text("status"),
            turns_used: num("turns_used"),
            max_turns: num("max_turns"),
            paused_reason: text("paused_reason"),
        })
    }
}

/// The judge's verdict after a turn (`GoalManager.evaluate_after_turn`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Decision {
    status: String,
    should_continue: bool,
    prompt: String,
    verdict: String,
    reason: String,
}

impl Decision {
    fn parse(v: &Value) -> Self {
        let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
        Self {
            status: text("status"),
            should_continue: v
                .get("should_continue")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            prompt: text("continuation_prompt"),
            verdict: text("verdict"),
            reason: text("reason"),
        }
    }
}

/// What to do after a verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    /// The task is done.
    Done,
    /// Another turn, with this prompt.
    Continue(String),
    /// Wait for the barrier the judge set, then judge again.
    Park(String),
    /// The budget is spent; the engine paused the goal.
    Cap,
    /// The judge ruled the task blocked on something only the owner can give.
    Blocked(String),
    /// The goal was paused for another reason (the judge could not run), or is not active any more.
    Stopped(String),
}

/// The step a verdict and the goal's state call for. Pure.
fn step_of(d: &Decision, g: &Goal) -> Step {
    if d.status == "done" || g.status == "done" {
        return Step::Done;
    }
    if d.should_continue && !d.prompt.trim().is_empty() {
        return Step::Continue(d.prompt.clone());
    }
    match d.status.as_str() {
        "active" if matches!(d.verdict.as_str(), "wait" | "waiting") => {
            Step::Park(d.reason.clone())
        }
        "paused" if d.verdict == "blocked" => Step::Blocked(d.reason.clone()),
        "paused" if g.max_turns > 0 && g.turns_used >= g.max_turns => Step::Cap,
        "paused" => Step::Stopped(g.paused_reason.clone()),
        other => Step::Stopped(format!("the goal is {other:?}, not active")),
    }
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

/// One call of the engine's goal manager on the session (`session.automation`).
async fn automation(
    rpc: &dyn Rpc,
    session: &str,
    call: &str,
    args: Vec<Value>,
    kwargs: Value,
) -> Result<(Option<Goal>, Value)> {
    let res = rpc
        .call(
            "session.automation",
            json!({"session_id": session, "kind": "goal", "call": call, "args": args, "kwargs": kwargs}),
        )
        .await?;
    if let Some(e) = res.get("error").filter(|e| !e.is_null()) {
        let why = e
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the goal could not be kept");
        return Err(Error::Unavailable(why.to_owned()));
    }
    Ok((
        res.get("state").and_then(Goal::parse),
        res.get("value").cloned().unwrap_or(Value::Null),
    ))
}

/// How one turn ended.
enum Turn {
    /// It answered.
    Answered(String),
    /// Its receipt says it failed: the engine's error text and reason code.
    Failed(String, Option<String>),
    /// Someone stopped it.
    Interrupted,
    /// An approval waits for the owner.
    Approval(usize),
    /// The run's time ran out first.
    TimedOut,
}

/// Wait for the admission to settle, reading it every `poll`.
async fn finish_turn(
    rpc: &dyn Rpc,
    session: &str,
    admission: &str,
    started: Instant,
    opts: &Opts,
) -> Result<Turn> {
    loop {
        let r = rpc
            .call(
                "prompt.receipt",
                json!({"session_id": session, "admission_id": admission, "include_result": true}),
            )
            .await?;
        match r.get("status").and_then(Value::as_str) {
            Some("terminal") => return Ok(read_result(&r)),
            Some("unknown") => {
                return Ok(Turn::Failed(
                    "the turn was lost when the engine restarted".to_owned(),
                    None,
                ));
            }
            _ => {}
        }
        let pending = rpc
            .call("approval.pending", json!({"session_id": session}))
            .await?;
        let n = pending
            .get("approvals")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if n > 0 {
            return Ok(Turn::Approval(n));
        }
        if started.elapsed() >= opts.timeout {
            return Ok(Turn::TimedOut);
        }
        tokio::time::sleep(opts.poll).await;
    }
}

/// The settled receipt: the structured result the turn committed (`final_response`, `failed`, `interrupted`, `error`).
fn read_result(r: &Value) -> Turn {
    let outcome = r.get("outcome").and_then(Value::as_str).unwrap_or("");
    let res = r.get("result").cloned().unwrap_or(Value::Null);
    let flag = |k: &str| res.get(k).and_then(Value::as_bool) == Some(true);
    let text = |k: &str| {
        res.get(k)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|s| !s.is_empty())
    };
    if flag("interrupted") || matches!(outcome, "interrupted" | "cancelled") {
        return Turn::Interrupted;
    }
    if flag("failed") || outcome == "failed" {
        return Turn::Failed(text("error").unwrap_or_default(), text("failure_reason"));
    }
    Turn::Answered(text("final_response").unwrap_or_default())
}

/// Pause the goal so nothing goes on after the run has ended (best effort: the run's own end does not depend on it).
async fn pause(rpc: &dyn Rpc, session: &str) {
    let _ = automation(rpc, session, "pause", Vec::new(), json!({})).await;
}

async fn ended(rpc: &dyn Rpc, session: &str, stop: Stop, pause_goal: bool, o: Outcome) -> Outcome {
    if pause_goal {
        pause(rpc, session).await;
    }
    Outcome { stop, ..o }
}

fn approval_words(bot: &str, n: usize, session: &str) -> String {
    format!(
        "{} for you to answer in the app: open {bot}, then its recent session {session}. The task is paused; run it again afterwards",
        if n == 1 {
            format!("{bot} has an approval waiting")
        } else {
            format!("{bot} has {n} approvals waiting")
        }
    )
}

/// Hand `task` to the bot `bot` (the gateway `rpc` is the bot's own) and keep it working until the judge says it is done, the
/// budget is spent, or something needs the owner.
///
/// # Errors
/// The gateway's, when a call fails (the run ending badly is an [`Outcome`], not an error).
#[allow(clippy::too_many_lines)] // one loop: submit, wait, judge, decide
pub async fn run(
    rpc: &dyn Rpc,
    bot: &str,
    task: &str,
    opts: &Opts,
    on: &mut dyn FnMut(Progress),
) -> Result<Outcome> {
    let started = Instant::now();
    let made = rpc.call("session.create", json!({"source": "gui"})).await?;
    let session = made
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Error::Unavailable("the engine made no session".into()))?
        .to_owned();
    on(Progress::Started(session.clone()));
    let (goal, _) = automation(
        rpc,
        &session,
        "set",
        vec![json!(task)],
        json!({"max_turns": opts.max_turns}),
    )
    .await?;
    let mut out = Outcome {
        stop: Stop::TimedOut,
        session: session.clone(),
        turns: goal.as_ref().map_or(0, |g| g.turns_used),
        max_turns: goal.as_ref().map_or(opts.max_turns, |g| g.max_turns),
        messages: 0,
    };
    let mut text = task.to_owned();
    loop {
        let sub = rpc
            .call(
                "prompt.submit",
                json!({"session_id": session, "text": text, "submission_id": new_event_id("run")}),
            )
            .await?;
        let admission = sub
            .get("admission_id")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Unavailable("the engine did not take the turn".into()))?
            .to_owned();
        let response = match finish_turn(rpc, &session, &admission, started, opts).await? {
            Turn::Answered(r) => r,
            Turn::Failed(raw, reason) => {
                crate::error::keep("hx.bots.turn_failed", &raw);
                let why = turn_failed_words(bot, &raw, reason.as_deref());
                return Ok(ended(rpc, &session, Stop::Failed(why), true, out).await);
            }
            Turn::Interrupted => {
                let why = format!("{bot} was stopped before it finished the task");
                return Ok(ended(rpc, &session, Stop::Failed(why), true, out).await);
            }
            Turn::Approval(n) => {
                let why = approval_words(bot, n, &session);
                return Ok(ended(rpc, &session, Stop::NeedsOwner(why), true, out).await);
            }
            Turn::TimedOut => return Ok(ended(rpc, &session, Stop::TimedOut, true, out).await),
        };
        out.messages += 1;
        on(Progress::Message {
            turn: out.messages,
            text: response.trim().to_owned(),
            at: now(),
        });
        if response.trim().is_empty() {
            let why = format!("{bot} ended its turn without an answer");
            return Ok(ended(rpc, &session, Stop::Failed(why), true, out).await);
        }
        // The judge, until it says what to do next (a parked goal is waited out and judged again).
        loop {
            let (state, value) = automation(
                rpc,
                &session,
                "evaluate_after_turn",
                vec![json!(response)],
                json!({}),
            )
            .await?;
            let goal = state.unwrap_or_default();
            out.turns = goal.turns_used;
            if goal.max_turns > 0 {
                out.max_turns = goal.max_turns;
            }
            match step_of(&Decision::parse(&value), &goal) {
                Step::Done => return Ok(ended(rpc, &session, Stop::Done, false, out).await),
                Step::Continue(prompt) => {
                    on(Progress::Continued {
                        used: goal.turns_used,
                        of: out.max_turns,
                    });
                    text = prompt;
                    break;
                }
                Step::Park(reason) => {
                    on(Progress::Parked(reason));
                    loop {
                        if started.elapsed() >= opts.timeout {
                            return Ok(ended(rpc, &session, Stop::TimedOut, true, out).await);
                        }
                        tokio::time::sleep(opts.poll).await;
                        let (_, waiting) =
                            automation(rpc, &session, "is_waiting", Vec::new(), json!({})).await?;
                        if waiting.as_bool() != Some(true) {
                            break;
                        }
                    }
                }
                Step::Cap => return Ok(ended(rpc, &session, Stop::CapReached, false, out).await),
                Step::Blocked(why) => {
                    let why = if why.trim().is_empty() {
                        format!("{bot} cannot go on without you")
                    } else {
                        format!("{bot} cannot go on without you: {}", why.trim())
                    };
                    return Ok(ended(rpc, &session, Stop::NeedsOwner(why), false, out).await);
                }
                Step::Stopped(raw) => {
                    crate::error::keep("hx.bots.turn_failed", &raw);
                    let why = format!(
                        "the check that decides whether {bot}'s task is done could not run, after {} of {} turns. Try again in a moment; if it keeps happening, check {bot}'s model in the app",
                        out.turns, out.max_turns
                    );
                    return Ok(ended(rpc, &session, Stop::Failed(why), false, out).await);
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod tests;
