//! An engine in memory for `run --bot` (test code only): a session whose goal mode behaves as the engine's does (the judge's
//! verdicts, the budget that pauses a goal, the pause that follows `blocked`), and whose turns settle the way the gateway's
//! receipts say.

use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::error::{Error, Result};
use crate::rooms::Rpc;

/// What the bot and the judge do.
#[derive(Debug, Clone, Default)]
pub(crate) struct Script {
    /// The judge says done after this many turns (never, when `None`).
    pub(crate) done_after: Option<u32>,
    /// The judge rules the task blocked after this many turns.
    pub(crate) blocked_after: Option<u32>,
    /// The judge cannot run: the goal pauses at once, below its budget.
    pub(crate) judge_broken: bool,
    /// This turn (1-based) fails, with a reason.
    pub(crate) fail_turn: Option<(u32, &'static str)>,
    /// This turn (1-based) is stopped by someone.
    pub(crate) interrupt_turn: Option<u32>,
    /// An approval is pending during this turn (1-based), and the turn never ends.
    pub(crate) approval_turn: Option<u32>,
    /// This turn's answer is empty.
    pub(crate) blank_turn: Option<u32>,
    /// After this turn the judge parks the goal for two reads.
    pub(crate) park_after: Option<u32>,
    /// The turn never ends.
    pub(crate) hang: bool,
}

struct Inner {
    script: Script,
    goal: Option<Value>,
    submitted: Vec<String>,
    polls: u32,
    waits: u32,
    parked: bool,
    calls: Vec<(String, Value)>,
}

pub(crate) struct Bot(Mutex<Inner>);

impl Bot {
    pub(crate) fn new(script: Script) -> Self {
        Self(Mutex::new(Inner {
            script,
            goal: None,
            submitted: Vec::new(),
            polls: 0,
            waits: 0,
            parked: false,
            calls: Vec::new(),
        }))
    }
    pub(crate) fn calls(&self) -> Vec<(String, Value)> {
        self.0.lock().unwrap().calls.clone()
    }
    pub(crate) fn submitted(&self) -> Vec<String> {
        self.0.lock().unwrap().submitted.clone()
    }
    pub(crate) fn automation_calls(&self, call: &str) -> Vec<Value> {
        self.calls()
            .into_iter()
            .filter(|(m, p)| m == "session.automation" && p["call"] == call)
            .map(|(_, p)| p)
            .collect()
    }
    pub(crate) fn count(&self, method: &str) -> usize {
        self.calls().iter().filter(|(m, _)| m == method).count()
    }
}

fn decision(status: &str, cont: bool, prompt: Option<&str>, verdict: &str, reason: &str) -> Value {
    json!({"status": status, "should_continue": cont, "continuation_prompt": prompt,
        "verdict": verdict, "reason": reason, "message": ""})
}

impl Inner {
    fn turns(&self) -> u32 {
        u32::try_from(self.submitted.len()).unwrap()
    }
    fn state(&self) -> Value {
        self.goal
            .as_ref()
            .map_or(Value::Null, |g| json!(g.to_string()))
    }
    fn set_status(&mut self, status: &str, why: Option<&str>) {
        if let Some(g) = self.goal.as_mut() {
            g["status"] = json!(status);
            g["paused_reason"] = json!(why);
        }
    }

    /// `GoalManager.evaluate_after_turn`, in the order the engine checks: parked, count the turn, the judge (done, blocked, broken),
    /// then the budget, else continue.
    fn evaluate(&mut self) -> Value {
        let (used, max) = {
            let g = self.goal.as_mut().unwrap();
            if g["status"] != "active" {
                return decision("paused", false, None, "inactive", "no active goal");
            }
            if self.parked && self.waits < 2 {
                return decision("active", false, None, "waiting", "waiting on a build");
            }
            let used = g["turns_used"].as_u64().unwrap() + 1;
            g["turns_used"] = json!(used);
            (used, g["max_turns"].as_u64().unwrap())
        };
        let s = self.script.clone();
        let used32 = u32::try_from(used).unwrap();
        if s.park_after == Some(used32) && !self.parked {
            self.parked = true;
            return decision("active", false, None, "wait", "waiting on a build");
        }
        if s.done_after == Some(used32) {
            self.set_status("done", None);
            return decision("done", false, None, "done", "it is finished");
        }
        if s.blocked_after == Some(used32) {
            self.set_status("paused", Some("judged unachievable"));
            return decision("paused", false, None, "blocked", "it needs a password");
        }
        if s.judge_broken {
            self.set_status("paused", Some("the judge could not run"));
            return decision("paused", false, None, "continue", "no verdict");
        }
        if used >= max {
            self.set_status("paused", Some("turn budget exhausted"));
            return decision("paused", false, None, "continue", "not yet");
        }
        decision(
            "active",
            true,
            Some(&format!("[Continuing toward your standing goal] {used}")),
            "continue",
            "not yet",
        )
    }
}

#[async_trait]
impl Rpc for Bot {
    #[allow(clippy::too_many_lines)]
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let mut g = self.0.lock().unwrap();
        g.calls.push((method.to_owned(), params.clone()));
        match method {
            "session.create" => Ok(json!({"session_id": "s1", "stored_session_id": "s1"})),
            "session.automation" => {
                let call = params["call"].as_str().unwrap().to_owned();
                let value = match call.as_str() {
                    "set" => {
                        g.goal = Some(
                            json!({"goal": params["args"][0], "status": "active", "turns_used": 0,
                            "max_turns": params["kwargs"]["max_turns"]}),
                        );
                        Value::Null
                    }
                    "evaluate_after_turn" => g.evaluate(),
                    "pause" => {
                        g.set_status("paused", Some("user-paused"));
                        Value::Null
                    }
                    "is_waiting" => {
                        g.waits += 1;
                        json!(g.waits < 2)
                    }
                    other => {
                        return Err(Error::Unavailable(format!("the fake has no {other}")));
                    }
                };
                Ok(json!({"state": g.state(), "value": value}))
            }
            "prompt.submit" => {
                g.submitted
                    .push(params["text"].as_str().unwrap().to_owned());
                g.polls = 0;
                Ok(json!({"admission_id": format!("a{}", g.submitted.len()), "status": "queued"}))
            }
            "prompt.receipt" => {
                g.polls += 1;
                let turn = g.turns();
                if g.script.hang || g.script.approval_turn == Some(turn) || g.polls < 2 {
                    return Ok(json!({"status": "started", "outcome": null}));
                }
                let s = g.script.clone();
                if s.fail_turn.is_some_and(|(t, _)| t == turn) {
                    let reason = s.fail_turn.unwrap().1;
                    return Ok(json!({"status": "terminal", "outcome": "failed",
                        "result": {"final_response": "", "failed": true, "completed": false,
                            "error": "The model x is not set up.", "failure_reason": reason}}));
                }
                if s.interrupt_turn == Some(turn) {
                    return Ok(json!({"status": "terminal", "outcome": "interrupted",
                        "result": {"final_response": "", "interrupted": true}}));
                }
                let said = if s.blank_turn == Some(turn) {
                    "  ".to_owned()
                } else {
                    format!("answer {turn}")
                };
                Ok(json!({"status": "terminal", "outcome": "completed",
                    "result": {"final_response": said}}))
            }
            "approval.pending" => {
                let turn = g.turns();
                Ok(if g.script.approval_turn == Some(turn) {
                    json!({"approvals": [{"request_id": "p1", "command": "rm -rf build"}]})
                } else {
                    json!({"approvals": []})
                })
            }
            other => Err(Error::Unavailable(format!("the fake has no {other}"))),
        }
    }
}
