//! Presence: what each bot is doing, across every client. Two inputs are merged (`ADR-0045`):
//! - the events on the host's own links (the boopis window's sessions) give fine states: thinking, working with a tool's
//!   name, speaking, needs, done, error;
//! - a poll of `session.active_list` on each profile's link gives the rest (the island's sessions, a cron run, a room
//!   turn), at the engine's own grain: `working`, `waiting`, `starting`, `idle`.
//!
//! A fine state wins for [`FINE_HOLD_MS`] after its event, and a poll never invents a fine word. The reducer is pure: it
//! takes the time as an argument and returns the presences that changed, so a table of cases tests it.

use std::collections::HashMap;

use super::model::{Presence, Source, State};

/// How long an event's state outranks a poll that says something coarser.
pub const FINE_HOLD_MS: i64 = 3_000;
/// How long a finished turn shows as done before the bot is idle again.
pub const DONE_HOLD_MS: i64 = 6_000;
/// How long a failed turn shows as an error.
pub const ERROR_HOLD_MS: i64 = 20_000;

/// What the engine says of a live session (`session.active_list`'s `status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// A turn is running.
    Working,
    /// A turn waits for an answer (an approval or a question).
    Waiting,
    /// A turn is admitted and its agent has not started.
    Starting,
    /// Nothing is running.
    Idle,
}

impl Status {
    /// Read the engine's word; an unknown word is idle (nothing is invented).
    #[must_use]
    pub fn parse(word: &str) -> Self {
        match word {
            "working" | "running" | "streaming" => Self::Working,
            "waiting" => Self::Waiting,
            "starting" | "resuming" => Self::Starting,
            _ => Self::Idle,
        }
    }
}

/// One live session as the poll reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Live {
    /// The session's id.
    pub session_id: String,
    /// The engine's status word.
    pub status: Status,
    /// Where the session came from, as the feed resolved it (what the host knows first, then what the engine says).
    pub source: Source,
    /// What it is about (its title, else the first line of what it was asked), when the engine says.
    pub summary: Option<String>,
}

#[derive(Debug, Clone)]
struct Session {
    state: State,
    activity: String,
    attention: Option<String>,
    source: Source,
    summary: Option<String>,
    /// Tool steps of the running turn, counted from its events; `None` when only the poll sees the session.
    steps: Option<u32>,
    since: i64,
    /// Until when a state that came from an event stands against the poll.
    fine_until: i64,
    /// Until when a `done` or `error` shows.
    hold_until: i64,
}

/// Every bot's sessions and the presence last published for it.
#[derive(Debug, Default)]
pub struct Table {
    sessions: HashMap<(String, String), Session>,
    published: HashMap<String, Presence>,
    sleeping: HashMap<String, bool>,
}

/// A tool whose work is code running.
#[allow(clippy::case_sensitive_file_extension_comparisons)] // a tool's name, lowercased here: not a file
fn is_compute(tool: &str) -> bool {
    let t = tool.to_ascii_lowercase();
    matches!(
        t.as_str(),
        "exec"
            | "execute_code"
            | "terminal"
            | "bash"
            | "shell"
            | "run_command"
            | "python"
            | "code_execution"
    ) || t.ends_with(".exec")
}

impl Table {
    /// An empty table.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark a bot as paused by its owner (it shows as `sleeping` while nothing else is happening).
    pub fn set_sleeping(&mut self, profile: &str, asleep: bool, now: i64) -> Vec<Presence> {
        self.sleeping.insert(profile.to_owned(), asleep);
        self.changed(&[profile.to_owned()], now)
    }

    /// An event on a link of the host. `tool` is the tool's name for a tool event, `failed` is true for a completion that
    /// failed. Returns the presences that changed.
    #[allow(clippy::too_many_arguments)] // one event's facts, read by one caller
    pub fn on_event(
        &mut self,
        profile: &str,
        session_id: &str,
        event: &str,
        tool: Option<&str>,
        failed: bool,
        source: Source,
        now: i64,
    ) -> Vec<Presence> {
        let key = (profile.to_owned(), session_id.to_owned());
        let fresh = || Session {
            state: State::Idle,
            activity: String::new(),
            attention: None,
            source,
            summary: None,
            steps: None,
            since: now,
            fine_until: 0,
            hold_until: 0,
        };
        let s = self.sessions.entry(key).or_insert_with(fresh);
        s.source = source;
        // The turn's tool steps, counted from its own events: a new turn starts at zero.
        match event {
            "host.prompt" => s.steps = Some(0),
            "message.start" if !s.state.busy() => s.steps = Some(0),
            "tool.start" => s.steps = Some(s.steps.unwrap_or(0) + 1),
            _ => {}
        }
        let (state, activity, attention) = match event {
            "host.prompt" => (State::Listening, String::new(), None),
            "message.start"
            | "thinking.delta"
            | "reasoning.delta"
            | "reasoning.available"
            | "tool.complete" => (State::Thinking, String::new(), None),
            "tool.start" | "tool.generating" | "tool.progress" => {
                let name = tool.unwrap_or_default().to_owned();
                let state = if is_compute(&name) {
                    State::Compute
                } else {
                    State::Working
                };
                (state, name, None)
            }
            "message.delta" | "message.interim" => (State::Speaking, String::new(), None),
            "message.complete" if failed => (State::Error, String::new(), None),
            "message.complete" => (State::Done, String::new(), None),
            "error" | "turn.failed" => (State::Error, String::new(), None),
            "approval.request" => (State::Needs, String::new(), Some("approval".to_owned())),
            "approval.settled" | "approval.cancelled" => (State::Working, String::new(), None),
            _ => return Vec::new(),
        };
        if s.state == State::Needs
            && !matches!(
                event,
                "approval.settled"
                    | "approval.cancelled"
                    | "message.complete"
                    | "error"
                    | "turn.failed"
            )
        {
            // A bot that waits for the owner keeps waiting until the question is settled, whatever else streams.
            return Vec::new();
        }
        if s.state != state || s.activity != activity {
            s.since = now;
        }
        s.state = state;
        s.activity = activity;
        s.attention = attention;
        s.fine_until = now + FINE_HOLD_MS;
        s.hold_until = match state {
            State::Done => now + DONE_HOLD_MS,
            State::Error => now + ERROR_HOLD_MS,
            _ => 0,
        };
        self.changed(&[profile.to_owned()], now)
    }

    /// The poll of one profile's link: the sessions it holds live. A session no longer listed has ended.
    /// `approvals` says which sessions have an approval pending (so a waiting session is told apart from a question).
    pub fn on_poll(
        &mut self,
        profile: &str,
        rows: &[Live],
        approvals: &dyn Fn(&str) -> bool,
        now: i64,
    ) -> Vec<Presence> {
        let listed: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        self.sessions.retain(|(p, sid), s| {
            p != profile || listed.contains(&sid.as_str()) || s.hold_until > now
        });
        for row in rows {
            let key = (profile.to_owned(), row.session_id.clone());
            let s = self.sessions.entry(key).or_insert_with(|| Session {
                state: State::Idle,
                activity: String::new(),
                attention: None,
                source: row.source,
                summary: None,
                steps: None,
                since: now,
                fine_until: 0,
                hold_until: 0,
            });
            // The source a session started with stands (B25): the poll never turns the host's own `gui` into a guess.
            if row.summary.is_some() {
                s.summary.clone_from(&row.summary);
            }
            if s.fine_until > now && s.state != State::Idle && row.status != Status::Idle {
                continue; // a fine word from an event stands for a moment
            }
            if s.hold_until > now && row.status == Status::Idle {
                continue; // done and error show their time out
            }
            let (state, attention) = match row.status {
                Status::Waiting => (
                    State::Needs,
                    Some(
                        if approvals(&row.session_id) {
                            "approval"
                        } else {
                            "input"
                        }
                        .to_owned(),
                    ),
                ),
                Status::Working => (
                    if s.state.busy() {
                        s.state
                    } else {
                        State::Working
                    },
                    None,
                ),
                Status::Starting => (State::Thinking, None),
                Status::Idle => (State::Idle, None),
            };
            if s.state != state || s.attention != attention {
                s.since = now;
                if state != State::Working {
                    s.activity.clear();
                }
            }
            s.state = state;
            s.attention = attention;
            s.hold_until = 0;
        }
        self.changed(&[profile.to_owned()], now)
    }

    /// A waiting session's approval became known (or went away) after the poll that found it waiting: say which it is.
    pub fn set_attention(
        &mut self,
        profile: &str,
        session_id: &str,
        approval: bool,
        now: i64,
    ) -> Vec<Presence> {
        let Some(s) = self
            .sessions
            .get_mut(&(profile.to_owned(), session_id.to_owned()))
        else {
            return Vec::new();
        };
        if s.state != State::Needs {
            return Vec::new();
        }
        s.attention = Some(if approval { "approval" } else { "input" }.to_owned());
        self.changed(&[profile.to_owned()], now)
    }

    /// Let time pass: a `done` that was shown long enough becomes idle again.
    pub fn tick(&mut self, now: i64) -> Vec<Presence> {
        let mut touched = Vec::new();
        for ((profile, _), s) in &mut self.sessions {
            if matches!(s.state, State::Done | State::Error)
                && s.hold_until != 0
                && s.hold_until <= now
            {
                s.state = State::Idle;
                s.activity.clear();
                s.hold_until = 0;
                s.since = now;
                touched.push(profile.clone());
            }
        }
        touched.sort();
        touched.dedup();
        self.sessions
            .retain(|_, s| s.state != State::Idle || s.fine_until > now);
        self.changed(&touched, now)
    }

    fn derive(&self, profile: &str, now: i64) -> Presence {
        let best = self
            .sessions
            .iter()
            .filter(|((p, _), _)| p == profile)
            .max_by_key(|(_, s)| (s.state.rank(), s.since));
        match best {
            Some(((_, sid), s)) if s.state != State::Idle => Presence {
                profile: profile.to_owned(),
                state: s.state,
                activity: s.activity.clone(),
                attention: s.attention.clone(),
                session_id: Some(sid.clone()),
                source: Some(s.source),
                summary: s.summary.clone(),
                steps: s.steps,
                at: s.since,
            },
            _ => {
                let mut idle = Presence::idle(profile, now);
                if self.sleeping.get(profile).copied().unwrap_or(false) {
                    idle.state = State::Sleeping;
                }
                if let Some(old) = self
                    .published
                    .get(profile)
                    .filter(|o| o.state == idle.state)
                {
                    idle.at = old.at; // the same rest, since when it began
                }
                idle
            }
        }
    }

    fn changed(&mut self, profiles: &[String], now: i64) -> Vec<Presence> {
        let mut out = Vec::new();
        for p in profiles {
            let now_row = self.derive(p, now);
            let same = self.published.get(p).is_some_and(|old| {
                old.state == now_row.state
                    && old.activity == now_row.activity
                    && old.attention == now_row.attention
                    && old.session_id == now_row.session_id
                    && old.source == now_row.source
                    && old.summary == now_row.summary
                    && old.steps == now_row.steps
            });
            if !same {
                self.published.insert(p.clone(), now_row.clone());
                out.push(now_row);
            }
        }
        out
    }

    /// The presence of `profile` now (idle when nothing is known).
    #[must_use]
    pub fn presence(&self, profile: &str, now: i64) -> Presence {
        self.derive(profile, now)
    }

    /// A session's last known state, for the notification rules.
    #[must_use]
    pub fn session_state(&self, profile: &str, session_id: &str) -> Option<State> {
        self.sessions
            .get(&(profile.to_owned(), session_id.to_owned()))
            .map(|s| s.state)
    }

    /// Forget a bot that is gone.
    pub fn forget(&mut self, profile: &str) {
        self.sessions.retain(|(p, _), _| p != profile);
        self.published.remove(profile);
        self.sleeping.remove(profile);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(t: &mut Table, e: &str, tool: Option<&str>, now: i64) -> Vec<Presence> {
        t.on_event("kai", "s1", e, tool, false, Source::Gui, now)
    }

    #[test]
    fn a_turn_walks_through_the_states_in_order() {
        let mut t = Table::new();
        let mut seen = Vec::new();
        for (e, tool, at) in [
            ("host.prompt", None, 0),
            ("message.start", None, 100),
            ("tool.start", Some("read_file"), 200),
            ("tool.complete", None, 300),
            ("tool.start", Some("exec"), 400),
            ("tool.complete", None, 500),
            ("message.delta", None, 600),
            ("message.complete", None, 700),
        ] {
            for p in ev(&mut t, e, tool, at) {
                seen.push((p.state, p.activity));
            }
        }
        let states: Vec<State> = seen.iter().map(|(s, _)| *s).collect();
        assert_eq!(
            states,
            [
                State::Listening,
                State::Thinking,
                State::Working,
                State::Thinking,
                State::Compute,
                State::Thinking,
                State::Speaking,
                State::Done
            ]
        );
        assert_eq!(seen[2].1, "read_file");
        assert_eq!(seen[4].1, "exec");
    }

    #[test]
    fn the_same_state_is_published_once() {
        let mut t = Table::new();
        assert_eq!(ev(&mut t, "message.delta", None, 0).len(), 1);
        for at in 1..50 {
            assert!(
                ev(&mut t, "message.delta", None, at).is_empty(),
                "a delta stream is one event"
            );
        }
    }

    #[test]
    fn an_approval_holds_the_bot_until_it_is_settled() {
        let mut t = Table::new();
        ev(&mut t, "tool.start", Some("terminal"), 0);
        let p = ev(&mut t, "approval.request", None, 10);
        assert_eq!(p[0].state, State::Needs);
        assert_eq!(p[0].attention.as_deref(), Some("approval"));
        assert!(
            ev(&mut t, "message.delta", None, 20).is_empty(),
            "streaming does not hide the question"
        );
        let p = ev(&mut t, "approval.settled", None, 30);
        assert_eq!(p[0].state, State::Working);
        assert_eq!(p[0].attention, None);
    }

    #[test]
    fn a_failure_shows_as_an_error_and_a_finished_turn_rests_after_its_time() {
        let mut t = Table::new();
        let p = t.on_event("kai", "s1", "message.complete", None, true, Source::Gui, 0);
        assert_eq!(p[0].state, State::Error);
        assert!(t.tick(ERROR_HOLD_MS - 1).is_empty());
        let p = t.tick(ERROR_HOLD_MS + 1);
        assert_eq!(p[0].state, State::Idle);
        let mut t = Table::new();
        ev(&mut t, "message.complete", None, 0);
        assert!(t.tick(DONE_HOLD_MS - 1).is_empty());
        assert_eq!(t.tick(DONE_HOLD_MS + 1)[0].state, State::Idle);
    }

    fn live(id: &str, status: Status, source: &str) -> Live {
        Live {
            session_id: id.into(),
            status,
            source: super::super::model::source_of(source),
            summary: None,
        }
    }

    #[test]
    fn a_poll_sees_another_programs_session_and_a_cron_run_at_the_engines_grain() {
        let mut t = Table::new();
        let none = |_: &str| false;
        let p = t.on_poll("nina", &[live("i1", Status::Working, "cli")], &none, 0);
        assert_eq!(
            (p[0].state, p[0].source),
            (State::Working, Some(Source::Other))
        );
        let p = t.on_poll("moss", &[live("c1", Status::Working, "cron")], &none, 0);
        assert_eq!(p[0].source, Some(Source::Cron));
        let p = t.on_poll(
            "nina",
            &[live("i1", Status::Waiting, "cli")],
            &|s| s == "i1",
            1,
        );
        assert_eq!(
            (p[0].state, p[0].attention.as_deref()),
            (State::Needs, Some("approval"))
        );
        let p = t.on_poll("nina", &[live("i1", Status::Waiting, "cli")], &none, 2);
        assert!(p.is_empty() || p[0].attention.as_deref() == Some("input"));
        assert_eq!(t.presence("nina", 2).attention.as_deref(), Some("input"));
        let p = t.on_poll("nina", &[], &none, 3);
        assert_eq!(
            p[0].state,
            State::Idle,
            "a session that is no longer listed has ended"
        );
    }

    #[test]
    fn a_fine_word_stands_against_a_coarser_poll_for_a_moment_only() {
        let mut t = Table::new();
        let none = |_: &str| false;
        ev(&mut t, "message.delta", None, 0);
        let row = [live("s1", Status::Working, "gui")];
        assert!(
            t.on_poll("kai", &row, &none, 1_000).is_empty(),
            "speaking is finer than working"
        );
        assert_eq!(t.presence("kai", 1_000).state, State::Speaking);
        t.on_poll("kai", &row, &none, FINE_HOLD_MS + 10);
        assert_eq!(
            t.presence("kai", FINE_HOLD_MS + 10).state,
            State::Speaking,
            "a busy word stays while the engine says working"
        );
        let idle = [live("s1", Status::Idle, "gui")];
        let p = t.on_poll("kai", &idle, &none, FINE_HOLD_MS + 20);
        assert_eq!(
            p[0].state,
            State::Idle,
            "the engine's idle ends a state its events never closed"
        );
    }

    #[test]
    fn the_busiest_session_is_the_bots_and_needs_beats_all() {
        let mut t = Table::new();
        let none = |_: &str| false;
        t.on_poll(
            "kai",
            &[
                live("a", Status::Working, "gui"),
                live("b", Status::Waiting, "cron"),
            ],
            &none,
            0,
        );
        let p = t.presence("kai", 0);
        assert_eq!(
            (p.state, p.session_id.as_deref(), p.source),
            (State::Needs, Some("b"), Some(Source::Cron))
        );
    }

    #[test]
    fn the_source_a_session_started_with_stands_and_idle_has_none() {
        // B25: a turn the host ran on its own link (gui) ends; the poll, which cannot tell, never turns it into `other`, and
        // the rest after it names no source at all.
        let mut t = Table::new();
        let none = |_: &str| false;
        ev(&mut t, "host.prompt", None, 0);
        ev(&mut t, "message.complete", None, 100);
        let p = t.on_poll("kai", &[live("s1", Status::Idle, "")], &none, 200);
        assert!(p.is_empty(), "done holds and keeps its source: {p:?}");
        assert_eq!(t.presence("kai", 200).source, Some(Source::Gui));
        let p = t.tick(DONE_HOLD_MS + 200);
        assert_eq!((p[0].state, p[0].source), (State::Idle, None));
        assert_eq!(Presence::idle("kai", 0).source, None);
    }

    #[test]
    fn a_turns_tool_steps_are_counted_from_its_events_and_a_poll_cannot_count() {
        let mut t = Table::new();
        ev(&mut t, "host.prompt", None, 0);
        assert_eq!(t.presence("kai", 0).steps, Some(0));
        for (i, tool) in ["read_file", "read_file", "exec"].iter().enumerate() {
            ev(
                &mut t,
                "tool.start",
                Some(tool),
                10 + i64::try_from(i).unwrap(),
            );
            ev(
                &mut t,
                "tool.progress",
                Some(tool),
                20 + i64::try_from(i).unwrap(),
            );
        }
        assert_eq!(
            t.presence("kai", 30).steps,
            Some(3),
            "a progress event is not a step"
        );
        let none = |_: &str| false;
        let polled = Live {
            session_id: "c1".into(),
            status: Status::Working,
            source: Source::Cron,
            summary: Some("Nightly digest".into()),
        };
        t.on_poll("moss", &[polled], &none, 0);
        let p = t.presence("moss", 0);
        assert_eq!(
            (p.steps, p.summary.as_deref()),
            (None, Some("Nightly digest"))
        );
    }

    #[test]
    fn a_paused_bot_sleeps_only_while_it_is_otherwise_idle() {
        let mut t = Table::new();
        assert_eq!(t.set_sleeping("kai", true, 0)[0].state, State::Sleeping);
        assert_eq!(
            ev(&mut t, "message.start", None, 1)[0].state,
            State::Thinking
        );
        t.forget("kai");
        assert_eq!(t.presence("kai", 5).state, State::Idle);
    }
}
