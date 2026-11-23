//! Presence: what each bot is doing, across every client. Two inputs are merged (`ADR-0045`):
//! - the events on the host's own links (the boopis window's sessions) give fine states: thinking, working with a tool's
//!   name, speaking, needs, done, error;
//! - a poll of `session.active_list` on each profile's link gives the rest (the island's sessions, a cron run, a room
//!   turn), at the engine's own grain: `working`, `waiting`, `starting`, `idle`.
//!
//! A third input is what the plugin pushes from the engine's own tool hooks (B45, `activity.rs`): a tool's start and end
//! and a turn's end for the sessions the host's links do not run. It is as fine as a link's event but counts no steps
//! (the host did not see the turn begin). A session the poll lists keeps the poll as the judge of whether it is alive; a
//! session no poll lists (a scheduled run) lives until its turn ends or its hold runs out.
//!
//! A fine state wins for [`FINE_HOLD_MS`] after its event, and a poll never invents a fine word. The reducer is pure: it
//! takes the time as an argument and returns the presences that changed, so a table of cases tests it.

use std::collections::HashMap;

use super::model::{Presence, Progress, Source, State};

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

/// What one event of a link says beyond its type.
#[derive(Debug, Clone, Copy, Default)]
pub struct Facts<'a> {
    /// The tool's name, for a tool event.
    pub tool: Option<&'a str>,
    /// What the tool call touches, in safe words (`toolwords.rs`), for a `tool.start`.
    pub detail: Option<&'a str>,
    /// How far the running tool says it has come, for a `tool.progress` that carries it (B44).
    pub progress: Option<&'a Progress>,
    /// The tool call's id, for a pushed start or end (B45): an end of another call than the one shown changes nothing.
    pub call: Option<&'a str>,
    /// A completion that failed.
    pub failed: bool,
}

#[derive(Debug, Clone)]
struct Session {
    state: State,
    activity: String,
    /// What the running tool touches (B40), while `activity` names it.
    detail: Option<String>,
    /// How far the running tool says it has come (B44), while `activity` names it.
    progress: Option<Progress>,
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
    /// Whether a poll listed it (the poll then judges whether it is alive).
    polled: bool,
    /// For a session only pushes tell of (B45): until when it stands without another push.
    alive_until: i64,
    /// The pushed tool call shown now (B45).
    call: Option<String>,
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

    /// An event on a link of the host, with what it says (`facts`). Returns the presences that changed.
    pub fn on_event(
        &mut self,
        profile: &str,
        session_id: &str,
        event: &str,
        facts: &Facts<'_>,
        source: Source,
        now: i64,
    ) -> Vec<Presence> {
        self.apply(profile, session_id, event, facts, source, now, true)
    }

    /// What the plugin pushed for a session (B45), as the link event it stands for (`tool.start`, `tool.complete`,
    /// `message.complete`). It counts no steps. `alive_until` is for a session no poll lists: it stands until then.
    #[allow(clippy::too_many_arguments)]
    pub fn on_push(
        &mut self,
        profile: &str,
        session_id: &str,
        event: &str,
        facts: &Facts<'_>,
        source: Source,
        alive_until: Option<i64>,
        now: i64,
    ) -> Vec<Presence> {
        let changed = self.apply(profile, session_id, event, facts, source, now, false);
        if let Some(until) = alive_until
            && let Some(s) = self
                .sessions
                .get_mut(&(profile.to_owned(), session_id.to_owned()))
            && !s.polled
        {
            s.alive_until = until;
        }
        changed
    }

    /// The kind of a session the table holds.
    #[must_use]
    pub fn source_of(&self, profile: &str, session_id: &str) -> Option<Source> {
        self.sessions
            .get(&(profile.to_owned(), session_id.to_owned()))
            .map(|s| s.source)
    }

    /// Whether the table holds a session (from a poll, a worker's row, or a push).
    #[must_use]
    pub fn knows(&self, profile: &str, session_id: &str) -> bool {
        self.sessions
            .contains_key(&(profile.to_owned(), session_id.to_owned()))
    }

    /// A session only pushes told of ended without saying so (its scheduled run is over): it shows as done, or as an error.
    pub fn end_push(
        &mut self,
        profile: &str,
        session_id: &str,
        failed: bool,
        now: i64,
    ) -> Vec<Presence> {
        let open = self
            .sessions
            .get(&(profile.to_owned(), session_id.to_owned()))
            .is_some_and(|s| !s.polled && (s.state.busy() || s.state == State::Needs));
        if !open {
            return Vec::new();
        }
        let facts = Facts {
            failed,
            ..Facts::default()
        };
        let source = self.sessions[&(profile.to_owned(), session_id.to_owned())].source;
        self.apply(
            profile,
            session_id,
            "message.complete",
            &facts,
            source,
            now,
            false,
        )
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)] // one table of events
    fn apply(
        &mut self,
        profile: &str,
        session_id: &str,
        event: &str,
        facts: &Facts<'_>,
        source: Source,
        now: i64,
        count: bool,
    ) -> Vec<Presence> {
        let (tool, failed) = (facts.tool, facts.failed);
        let key = (profile.to_owned(), session_id.to_owned());
        let fresh = || Session {
            state: State::Idle,
            activity: String::new(),
            detail: None,
            progress: None,
            attention: None,
            source,
            summary: None,
            steps: None,
            since: now,
            fine_until: 0,
            hold_until: 0,
            polled: false,
            alive_until: 0,
            call: None,
        };
        let s = self.sessions.entry(key).or_insert_with(fresh);
        s.source = source;
        // A pushed end of another call than the one shown: that one still runs.
        if event == "tool.complete"
            && let (Some(shown), Some(ended)) = (s.call.as_deref(), facts.call)
            && shown != ended
        {
            return Vec::new();
        }
        // The turn's tool steps, counted from its own events: a new turn starts at zero. A push counts none.
        if count {
            match event {
                "host.prompt" => s.steps = Some(0),
                "message.start" if !s.state.busy() => s.steps = Some(0),
                "tool.start" => s.steps = Some(s.steps.unwrap_or(0) + 1),
                _ => {}
            }
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
        // The detail is the call's: set by its start, kept while the same tool streams progress, gone with it. Progress is
        // what the tool last reported, kept until the call ends; nothing reported is none (B44).
        let same = s.activity == activity;
        s.detail = match event {
            "tool.start" => facts.detail.map(str::to_owned),
            "tool.generating" | "tool.progress" if same => s.detail.take(),
            _ => None,
        };
        s.progress = match event {
            "tool.progress" => facts
                .progress
                .cloned()
                .or_else(|| if same { s.progress.take() } else { None }),
            "tool.generating" if same => s.progress.take(),
            _ => None,
        };
        s.call = (event == "tool.start")
            .then(|| facts.call.map(str::to_owned))
            .flatten();
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
            p != profile
                || listed.contains(&sid.as_str())
                || s.hold_until > now
                || (!s.polled && s.alive_until > now)
        });
        for row in rows {
            let key = (profile.to_owned(), row.session_id.clone());
            let s = self.sessions.entry(key).or_insert_with(|| Session {
                state: State::Idle,
                activity: String::new(),
                detail: None,
                progress: None,
                attention: None,
                source: row.source,
                summary: None,
                steps: None,
                since: now,
                fine_until: 0,
                hold_until: 0,
                polled: true,
                alive_until: 0,
                call: None,
            });
            s.polled = true;
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
                    s.detail = None;
                    s.progress = None;
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
            // a session only pushes told of, silent past its hold, is no longer known to run
            let lapsed = !s.polled && s.alive_until != 0 && s.alive_until <= now;
            if lapsed && s.state != State::Idle && s.hold_until == 0 {
                s.state = State::Idle;
                s.activity.clear();
                s.detail = None;
                s.progress = None;
                s.call = None;
                s.since = now;
                touched.push(profile.clone());
                continue;
            }
            if matches!(s.state, State::Done | State::Error)
                && s.hold_until != 0
                && s.hold_until <= now
            {
                s.state = State::Idle;
                s.activity.clear();
                s.detail = None;
                s.progress = None;
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
                detail: s.detail.clone(),
                progress: s.progress.clone(),
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
                    && old.detail == now_row.detail
                    && old.progress == now_row.progress
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
        let facts = Facts {
            tool,
            ..Facts::default()
        };
        t.on_event("kai", "s1", e, &facts, Source::Gui, now)
    }

    #[test]
    fn a_tools_detail_shows_while_it_runs_and_goes_with_it() {
        let mut t = Table::new();
        let facts = Facts {
            tool: Some("read_file"),
            detail: Some("Read a file · shots/03.json"),
            ..Facts::default()
        };
        let p = t.on_event("kai", "s1", "tool.start", &facts, Source::Gui, 0);
        assert_eq!(p[0].detail.as_deref(), Some("Read a file · shots/03.json"));
        ev(&mut t, "tool.progress", Some("read_file"), 10);
        assert_eq!(
            t.presence("kai", 10).detail.as_deref(),
            Some("Read a file · shots/03.json"),
            "progress keeps it"
        );
        let p = ev(&mut t, "tool.complete", None, 20);
        assert_eq!(
            (p[0].state, p[0].detail.as_deref()),
            (State::Thinking, None)
        );
        ev(&mut t, "tool.start", Some("terminal"), 30);
        assert_eq!(
            t.presence("kai", 30).detail,
            None,
            "a call that touches nothing named has none"
        );
    }

    #[test]
    fn a_tools_progress_is_what_it_reported_and_goes_with_the_call() {
        let mut t = Table::new();
        ev(&mut t, "tool.start", Some("render"), 0);
        assert_eq!(
            t.presence("kai", 0).progress,
            None,
            "nothing reported: none"
        );
        let two_of_three = Progress {
            fraction: Some(0.67),
            step: 2.0,
            of: Some(3.0),
            label: Some("Rendering French".into()),
        };
        let facts = Facts {
            tool: Some("render"),
            progress: Some(&two_of_three),
            ..Facts::default()
        };
        let p = t.on_event("kai", "s1", "tool.progress", &facts, Source::Gui, 10);
        assert_eq!(p[0].progress.as_ref(), Some(&two_of_three));
        ev(&mut t, "tool.progress", Some("render"), 20);
        assert_eq!(
            t.presence("kai", 20).progress.as_ref(),
            Some(&two_of_three),
            "an update without numbers keeps the last"
        );
        let p = ev(&mut t, "tool.complete", None, 30);
        assert_eq!(p[0].progress, None, "the call ended");
        ev(&mut t, "tool.start", Some("render"), 40);
        assert_eq!(
            t.presence("kai", 40).progress,
            None,
            "a new call starts with none"
        );
        let json = serde_json::to_value(Presence::idle("kai", 0)).unwrap();
        assert!(json["progress"].is_null(), "{json}");
    }

    #[test]
    #[allow(clippy::too_many_lines)] // one story, every source in turn
    fn a_pushed_tool_shows_on_a_polled_session_and_an_unpolled_one_lives_until_its_hold() {
        // B45: a room member's turn the poll lists, and a scheduled run no poll lists
        let mut t = Table::new();
        let none = |_: &str| false;
        let room = Live {
            session_id: "r1".into(),
            status: Status::Working,
            source: Source::Room,
            summary: Some("In paper past".into()),
        };
        t.on_poll("kai", std::slice::from_ref(&room), &none, 0);
        let start = Facts {
            tool: Some("read_file"),
            detail: Some("Read a file · shots/03.json"),
            call: Some("c1"),
            ..Facts::default()
        };
        let p = t.on_push("kai", "r1", "tool.start", &start, Source::Room, None, 100);
        assert_eq!(
            (
                p[0].state,
                p[0].activity.as_str(),
                p[0].detail.as_deref(),
                p[0].steps
            ),
            (
                State::Working,
                "read_file",
                Some("Read a file · shots/03.json"),
                None
            ),
            "fine, but a push counts no steps"
        );
        let other = Facts {
            call: Some("c0"),
            ..Facts::default()
        };
        assert!(
            t.on_push(
                "kai",
                "r1",
                "tool.complete",
                &other,
                Source::Room,
                None,
                150
            )
            .is_empty(),
            "another call's end: the shown one still runs"
        );
        let mine = Facts {
            call: Some("c1"),
            ..Facts::default()
        };
        assert_eq!(
            t.on_push("kai", "r1", "tool.complete", &mine, Source::Room, None, 200)[0].state,
            State::Thinking
        );
        t.on_poll("kai", &[], &none, 5_000);
        assert_eq!(
            t.presence("kai", 5_000).state,
            State::Idle,
            "the poll judges a polled session"
        );
        let p = t.on_push(
            "moss",
            "c9",
            "tool.start",
            &start,
            Source::Cron,
            Some(60_000),
            0,
        );
        assert_eq!(
            (p[0].state, p[0].source),
            (State::Working, Some(Source::Cron))
        );
        t.on_poll("moss", &[], &none, 2_000);
        assert_eq!(
            t.presence("moss", 2_000).state,
            State::Working,
            "no poll lists a scheduled run: it stands on its pushes"
        );
        let p = t.tick(60_001);
        assert_eq!(
            p[0].state,
            State::Idle,
            "silent past its hold: no longer known to run"
        );
        t.on_push(
            "moss",
            "c9",
            "tool.start",
            &start,
            Source::Cron,
            Some(200_000),
            100_000,
        );
        let p = t.end_push("moss", "c9", true, 100_010);
        assert_eq!(
            p[0].state,
            State::Error,
            "its run ended badly, as the cron list says"
        );
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
        let failed = Facts {
            failed: true,
            ..Facts::default()
        };
        let p = t.on_event("kai", "s1", "message.complete", &failed, Source::Gui, 0);
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
