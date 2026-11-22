//! A scripted gateway for the room tests: one room whose bots hand off for a set number of rounds, pausing at the engine's
//! limit and going on when asked, the way the engine's discussion does (`hosted_room_discussion.py`). Test code only.

use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::Rpc;
use crate::error::{Error, Result};

/// What the room's bots do.
#[derive(Debug, Clone)]
pub struct Script {
    /// How many rounds the bots want in all.
    pub rounds: u32,
    /// The engine's rounds per budget.
    pub per_budget: u32,
    /// A bot fails its turn in this round.
    pub fail_at: Option<u32>,
    /// An approval is pending from this round on.
    pub approval_at: Option<u32>,
    /// The room never writes anything after the user's message.
    pub silent: bool,
}

impl Default for Script {
    fn default() -> Self {
        Self {
            rounds: 3,
            per_budget: 3,
            fail_at: None,
            approval_at: None,
            silent: false,
        }
    }
}

/// The fake gateway.
pub struct Fake {
    inner: Mutex<Inner>,
}

#[allow(clippy::struct_excessive_bools)] // independent switches of one scripted discussion
struct Inner {
    script: Script,
    rooms: Vec<Value>,
    events: Vec<Value>,
    capabilities: Value,
    discussion: Option<String>,
    next_round: u32,
    continues: u32,
    paused: bool,
    finished: bool,
    pending: bool,
    stopped: bool,
    /// Every call, `(method, params)`, in order.
    pub calls: Vec<(String, Value)>,
    context: Value,
}

impl Fake {
    /// A gateway with these two bots in a room called `paper past`.
    #[must_use]
    pub fn new(script: Script) -> Self {
        let members = json!([
            {"member_id": "kai", "profile": "kai", "handle": "kai", "display_name": "Kai"},
            {"member_id": "nina", "profile": "nina", "handle": "nina", "display_name": "Nina"}
        ]);
        Self {
            inner: Mutex::new(Inner {
                script,
                rooms: vec![
                    json!({"room_id": "g-paper-past-", "name": "paper past", "members": members}),
                ],
                events: Vec::new(),
                capabilities: json!({"seatable_profiles": ["kai", "nina", "moss"]}),
                discussion: None,
                next_round: 0,
                continues: 0,
                paused: false,
                finished: false,
                pending: false,
                stopped: false,
                calls: Vec::new(),
                context: json!({"purpose": "", "notes": "", "routing": "everyone", "lead_member_id": ""}),
            }),
        }
    }

    /// The calls made so far.
    ///
    /// # Panics
    /// When the lock was poisoned by another test thread.
    #[must_use]
    pub fn calls(&self) -> Vec<(String, Value)> {
        self.inner.lock().unwrap().calls.clone()
    }

    /// How many times `method` was called.
    #[must_use]
    pub fn count(&self, method: &str) -> usize {
        self.calls().iter().filter(|(m, _)| m == method).count()
    }
}

fn event(seq: usize, kind: &str, actor: &str, payload: &Value) -> Value {
    json!({"room_id": "g-paper-past-", "seq": seq, "event_id": format!("e{seq}"), "kind": kind,
           "actor": {"kind": "member", "id": actor}, "payload": payload, "created_at": 1_000.0 + f64::from(u32::try_from(seq).unwrap_or(u32::MAX))})
}

impl Inner {
    fn push(&mut self, kind: &str, actor: &str, payload: &Value) -> Value {
        let ev = event(self.events.len() + 1, kind, actor, payload);
        self.events.push(ev.clone());
        ev
    }

    /// The bots do one thing: say the next round, pause at the limit, or settle.
    fn tick(&mut self) {
        let Some(d) = self.discussion.clone() else {
            return;
        };
        if self.paused || self.finished || self.stopped || self.pending || self.script.silent {
            return;
        }
        let round = self.next_round;
        if self.script.approval_at == Some(round) {
            self.pending = true;
            return;
        }
        if self.script.fail_at == Some(round) {
            self.push(
                "turn.failed",
                "nina",
                &json!({"member_id": "nina", "discussion_event_id": d, "round_index": round, "error": "The model x is not set up.", "reason_code": "model_unavailable"}),
            );
            self.finished = true;
            return;
        }
        if round >= self.script.rounds {
            self.push(
                "room.activity",
                "gateway",
                &json!({"status": "settled", "reason_code": "silent_round", "thread_id": "main", "discussion_event_id": d}),
            );
            self.finished = true;
            return;
        }
        let who = if round.is_multiple_of(2) {
            "kai"
        } else {
            "nina"
        };
        self.push(
            "message.member",
            who,
            &json!({"member_id": who, "text": format!("step {round}"), "round_index": round, "discussion_event_id": d}),
        );
        self.next_round += 1;
        if self.next_round == (self.continues + 1) * self.script.per_budget
            && self.next_round < self.script.rounds
        {
            self.push(
                "room.activity",
                "gateway",
                &json!({"status": "bounded", "reason_code": "max_rounds", "thread_id": "main", "discussion_event_id": d}),
            );
            self.paused = true;
        }
    }
}

#[async_trait]
impl Rpc for Fake {
    #[allow(clippy::too_many_lines)]
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let mut g = self.inner.lock().unwrap();
        g.calls.push((method.to_owned(), params.clone()));
        match method {
            "groups.list" => Ok(json!({"rooms": g.rooms})),
            "groups.capabilities" => Ok(g.capabilities.clone()),
            "groups.create" => {
                let room = json!({"room_id": params["room_id"], "name": params["name"], "members": params["members"]});
                g.rooms.push(room.clone());
                Ok(json!({"room": room}))
            }
            "groups.context" => {
                g.context = json!({"purpose": params["purpose"], "notes": params["notes"], "routing": params["routing"],
                    "lead_member_id": params.get("lead_member_id").cloned().unwrap_or(json!(""))});
                Ok(json!({"context": g.context}))
            }
            "groups.state" => {
                g.tick();
                let pending = if g.pending {
                    json!([{"kind": "approval", "member_id": "kai"}])
                } else {
                    json!([])
                };
                let working = g.discussion.is_some()
                    && !g.paused
                    && !g.finished
                    && !g.stopped
                    && !g.script.silent
                    && !g.pending;
                Ok(json!({"room": g.rooms[0], "context": g.context,
                    "driver_status": {"running": true, "working": working, "blocked": g.pending, "counts": {},
                        "pending_actions": pending, "max_rounds": g.script.per_budget}}))
            }
            "groups.send" => {
                let id = params["event_id"].as_str().unwrap_or("x").to_owned();
                let seq = g.events.len() + 1;
                let mut ev = event(seq, "message.user", "user", &params["payload"]);
                ev["event_id"] = json!(id);
                g.events.push(ev.clone());
                g.discussion = Some(id);
                g.next_round = 0;
                g.continues = 0;
                g.paused = false;
                g.finished = false;
                g.pending = false;
                g.stopped = false;
                Ok(json!({"event": ev, "accepted": true}))
            }
            "groups.log" => {
                g.tick();
                let since = params["since_seq"].as_u64().unwrap_or(0);
                let events: Vec<Value> = g
                    .events
                    .iter()
                    .filter(|e| e["seq"].as_u64().unwrap_or(0) > since)
                    .cloned()
                    .collect();
                Ok(
                    json!({"events": events, "cursor": g.events.len(), "latest_seq": g.events.len(), "has_more": false}),
                )
            }
            "groups.continue" => {
                if !g.paused {
                    return Err(Error::Unavailable("the discussion is not paused".into()));
                }
                g.paused = false;
                g.continues += 1;
                Ok(json!({"continued": true}))
            }
            "groups.stop" => {
                g.stopped = true;
                Ok(json!({"cancelled": 1}))
            }
            other => Err(Error::Unavailable(format!("the fake has no {other}"))),
        }
    }
}
