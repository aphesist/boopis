//! Run a task through a room to its end, headless (`boopis run --group`).
//!
//! The engine runs one *discussion* per user message: the members answer in rounds, and when the engine's own limit is
//! reached (3 rounds or 10 messages by default) the discussion pauses and the log says so (`room.activity`, `bounded`).
//! The app shows a Continue button for that; `groups.continue` grants one more budget. A pipeline of six hand-offs needs
//! several, so this keeps calling it while the bots are still handing off, up to boopis's own cap on rounds (the room's
//! setting, `settings.rs`, or a flag). It stops cleanly and says why: [`Stop`].
//!
//! It only reads the log and the room's state and calls `groups.send` (through the room hold, `hold.rs`: a task written while
//! the members work waits for them, as it does in the app), `groups.continue` and (after a failed turn) `groups.stop`. A bot's
//! approval is never answered here: it stops with [`Stop::NeedsOwner`].

use std::time::Duration;

use serde_json::Value;
use tokio::time::Instant;

use super::hold::{self, Delivered, Store};
use super::{Event, Room, Rpc};
use crate::config::RoomLimits;
use crate::error::Result;

/// The hold a run sends through: the file, its rules, and the surface named in the event id.
pub struct Via<'a> {
    /// The held messages' file.
    pub store: &'a Store,
    /// The hold's rules.
    pub limits: &'a RoomLimits,
    /// `cli` for the command line.
    pub prefix: &'a str,
}

/// How a run behaves.
#[derive(Debug, Clone)]
pub struct Opts {
    /// The most rounds, in all, the discussion may take (counted as the engine's budgets: a continue adds one).
    pub max_rounds: u32,
    /// Keep going past the engine's pause. `false` stops at the pause (`groups send --wait`).
    pub auto_continue: bool,
    /// How often the room is read.
    pub poll: Duration,
    /// The longest the whole run may take.
    pub timeout: Duration,
    /// How many reads in a row may find the room idle with no end written before the run gives up on it.
    pub quiet_polls: u32,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            max_rounds: super::settings::DEFAULT_MAX_ROUNDS,
            auto_continue: true,
            poll: Duration::from_secs(2),
            timeout: Duration::from_hours(1),
            quiet_polls: 5,
        }
    }
}

/// Something worth telling while the run goes on.
#[derive(Debug, Clone, PartialEq)]
pub enum Progress {
    /// The members are at work, so the task is held until they finish (their names; empty when the room only shows an
    /// open discussion).
    Held(Vec<String>),
    /// The task was sent; the discussion's id.
    Sent(String),
    /// A bot said something.
    Message {
        /// Its place in the log.
        seq: u64,
        /// The bot's name.
        who: String,
        /// What it said.
        text: String,
        /// When, in seconds since 1970.
        at: f64,
    },
    /// The engine paused at its limit and the run asked for another budget.
    Continued {
        /// How many continues so far.
        count: u32,
        /// The rounds the discussion may now take.
        rounds: u32,
    },
    /// Anything else the person should know (a bot that was unavailable).
    Note(String),
}

/// Why a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    /// The bots stopped handing off: the engine wrote that the discussion settled.
    Done,
    /// The engine paused and boopis's cap on rounds is reached.
    CapReached,
    /// The engine paused and the run was not allowed to continue it.
    Paused,
    /// A bot waits for the owner (an approval, a retry).
    NeedsOwner(String),
    /// A bot's turn failed, or the room went quiet without finishing. The work was stopped.
    Failed(String),
    /// The run's own time ran out. The room is left as it is.
    TimedOut,
}

impl Stop {
    /// The exit code: 0 done, 1 failed or timed out, 3 a cap, 4 needs the owner.
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Done => 0,
            Self::Failed(_) | Self::TimedOut => 1,
            Self::CapReached | Self::Paused => 3,
            Self::NeedsOwner(_) => 4,
        }
    }

    /// A short stable word for `--json` and scripts.
    #[must_use]
    pub fn word(&self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::CapReached => "cap_reached",
            Self::Paused => "paused",
            Self::NeedsOwner(_) => "needs_owner",
            Self::Failed(_) => "error",
            Self::TimedOut => "timed_out",
        }
    }
}

/// What a run did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    /// Why it ended.
    pub stop: Stop,
    /// The discussion's id (the id of the message that started it).
    pub discussion: String,
    /// The most rounds the discussion has reached.
    pub rounds: u32,
    /// How many times the engine's pause was lifted.
    pub continues: u32,
    /// How many bot messages were written.
    pub messages: u32,
    /// The log's last event number seen, to read on from.
    pub last_seq: u64,
}

/// A failed turn in boopis's words (the app's `turnFailedWords`): the bot, what happened and the next step.
#[must_use]
pub fn turn_failed_words(name: &str, raw: &str, reason: Option<&str>) -> String {
    let lower = raw.to_ascii_lowercase();
    let reaching = matches!(
        reason,
        Some("provider_auth_or_access" | "missing_config" | "model_unavailable")
    ) || (reason.is_none_or(|r| r == "unknown")
        && [
            "unknown provider",
            "api key",
            "not signed in",
            "unauthorized",
            "credential",
            "forbidden",
            "no such model",
        ]
        .iter()
        .any(|w| lower.contains(w)));
    let limited = matches!(reason, Some("provider_quota_limit" | "provider_rate_limit"))
        || (reason.is_none_or(|r| r == "unknown")
            && [
                "rate limit",
                "rate-limit",
                "429",
                "too many requests",
                "usage limit",
                "quota",
            ]
            .iter()
            .any(|w| lower.contains(w)));
    if reaching {
        format!(
            "{name} can't reach its model. {}",
            crate::error::sentence("hx.bots.model_unreachable")
        )
    } else if limited {
        format!(
            "{name}'s model is asking it to slow down. {}",
            crate::error::sentence("hx.provider.rate_limited")
        )
    } else {
        format!(
            "{name} could not reply. {}",
            crate::error::sentence("hx.bots.turn_failed")
        )
    }
}

/// Send `text` to `room` through the hold and follow the discussion it starts to its end. While the members work the task
/// waits for them (it never cuts their turns short), within the run's own time.
///
/// # Errors
/// The gateway's, when a call fails (the run itself ending badly is an [`Outcome`], not an error).
pub async fn run(
    rpc: &dyn Rpc,
    room: &Room,
    text: &str,
    opts: &Opts,
    via: &Via<'_>,
    on: &mut dyn FnMut(Progress),
) -> Result<Outcome> {
    let mut watch = hold::Watch::new(&room.id);
    let delivered = hold::deliver(
        rpc,
        via.store,
        &mut watch,
        text,
        via.prefix,
        via.limits,
        opts.poll,
        opts.timeout,
        &mut |_, working| {
            on(Progress::Held(
                working
                    .iter()
                    .map(|id| room.name_of(id).to_owned())
                    .collect(),
            ));
        },
    )
    .await?;
    let ended = |stop: Stop| Outcome {
        stop,
        discussion: String::new(),
        rounds: 0,
        continues: 0,
        messages: 0,
        last_seq: watch.cursor(),
    };
    match delivered {
        Delivered::Sent(sent) => {
            on(Progress::Sent(sent.id.clone()));
            follow(rpc, room, &sent.id, sent.seq, opts, on).await
        }
        Delivered::TakenBack => Ok(ended(Stop::Failed(
            "the task was taken back before it went out".into(),
        ))),
        Delivered::StillHeld(_) => {
            on(Progress::Note(
                "the task is still held: boopis sends it when the group has finished".into(),
            ));
            Ok(ended(Stop::TimedOut))
        }
    }
}

/// Follow the discussion that the event `discussion` started, reading the log after `from_seq`.
///
/// # Errors
/// The gateway's.
#[allow(clippy::too_many_lines)] // one loop: read, decide, wait
pub async fn follow(
    rpc: &dyn Rpc,
    room: &Room,
    discussion: &str,
    from_seq: u64,
    opts: &Opts,
    on: &mut dyn FnMut(Progress),
) -> Result<Outcome> {
    let started = Instant::now();
    let initial = super::state(rpc, &room.id).await?;
    let per_budget = initial.engine_rounds.filter(|n| *n > 0).unwrap_or(3);
    let mut out = Outcome {
        stop: Stop::TimedOut,
        discussion: discussion.to_owned(),
        rounds: 0,
        continues: 0,
        messages: 0,
        last_seq: from_seq,
    };
    let mut quiet = 0u32;
    loop {
        let events = super::log_since(rpc, &room.id, out.last_seq).await?;
        let progressed = !events.is_empty();
        for e in &events {
            out.last_seq = out.last_seq.max(e.seq);
            if let Some(stop) =
                read_event(rpc, room, e, discussion, per_budget, opts, &mut out, on).await?
            {
                out.stop = stop;
                return Ok(out);
            }
        }
        let state = super::state(rpc, &room.id).await?;
        if let Some(what) = waiting_on(&state) {
            out.stop = Stop::NeedsOwner(what);
            return Ok(out);
        }
        if state.working || progressed {
            quiet = 0;
        } else {
            quiet += 1;
            if quiet >= opts.quiet_polls {
                let why = state.last_error.map_or_else(
                    || "the group went quiet before the bots finished".to_owned(),
                    |e| crate::error::unless_engine("hx.bots.turn_failed", &e),
                );
                // Nothing is running, so there is nothing to stop; say so and leave the room as it is.
                out.stop = Stop::Failed(why);
                return Ok(out);
            }
        }
        if started.elapsed() >= opts.timeout {
            out.stop = Stop::TimedOut;
            return Ok(out);
        }
        tokio::time::sleep(opts.poll).await;
    }
}

/// What a pending action of the room means for the owner, or `None` when nothing waits on them.
fn waiting_on(state: &super::State) -> Option<String> {
    if state.pending.is_empty() && !state.blocked {
        return None;
    }
    let approvals = state
        .pending
        .iter()
        .filter(|p| p.get("kind").and_then(Value::as_str) == Some("approval"))
        .count();
    Some(if approvals > 0 {
        format!(
            "{approvals} approval{} waiting in the group: answer in the app, then run again",
            if approvals == 1 { " is" } else { "s are" }
        )
    } else {
        "the group is waiting for you (open it in the app to see what)".to_owned()
    })
}

#[allow(clippy::too_many_arguments)]
async fn read_event(
    rpc: &dyn Rpc,
    room: &Room,
    e: &Event,
    discussion: &str,
    per_budget: u32,
    opts: &Opts,
    out: &mut Outcome,
    on: &mut dyn FnMut(Progress),
) -> Result<Option<Stop>> {
    let ours = |e: &Event| {
        e.text("discussion_event_id")
            .is_none_or(|d| d == discussion)
    };
    match e.kind.as_str() {
        "message.member" if ours(e) => {
            out.messages += 1;
            if let Some(r) = e.payload.get("round_index").and_then(Value::as_u64) {
                out.rounds = out.rounds.max(u32::try_from(r + 1).unwrap_or(u32::MAX));
            }
            let id = e.text("member_id").unwrap_or(&e.actor);
            on(Progress::Message {
                seq: e.seq,
                who: room.name_of(id).to_owned(),
                text: e.text("text").unwrap_or("").trim().to_owned(),
                at: e.at,
            });
        }
        "member.unavailable" => {
            let id = e.text("member_id").unwrap_or("a bot");
            on(Progress::Note(format!(
                "{} is not available.",
                room.name_of(id)
            )));
        }
        "turn.failed" if ours(e) => {
            let id = e.text("member_id").unwrap_or("a bot");
            let words = turn_failed_words(
                room.name_of(id),
                e.text("error").unwrap_or(""),
                e.text("reason_code"),
            );
            if let Some(raw) = e.text("error") {
                crate::error::keep("hx.bots.turn_failed", raw);
            }
            // The rest of the group would go on without that bot: stop it, so a run that failed has nothing left running.
            let _ = super::stop(rpc, &room.id).await;
            return Ok(Some(Stop::Failed(words)));
        }
        "room.activity" if e.text("discussion_event_id") == Some(discussion) => {
            match e.text("status") {
                Some("settled") => return Ok(Some(Stop::Done)),
                Some("bounded") => {
                    let granted = (out.continues + 1) * per_budget;
                    if !opts.auto_continue {
                        return Ok(Some(Stop::Paused));
                    }
                    if granted >= opts.max_rounds {
                        out.rounds = granted;
                        return Ok(Some(Stop::CapReached));
                    }
                    super::continue_discussion(rpc, &room.id, discussion).await?;
                    out.continues += 1;
                    on(Progress::Continued {
                        count: out.continues,
                        rounds: (out.continues + 1) * per_budget,
                    });
                }
                _ => {}
            }
        }
        _ => {}
    }
    Ok(None)
}
