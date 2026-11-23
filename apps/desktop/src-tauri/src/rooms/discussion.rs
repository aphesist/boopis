//! Whether a room is busy: whether a message sent now would cut a running discussion short.
//!
//! The engine runs one discussion per thread, and a newer user message in the thread ends it: a member still working has its
//! answer dropped (`turn.cancelled`, `superseded_by_newer_user_event`, `gateway/hosted_room_discussion.py plan_publication`).
//! The engine has no queue, steer or interjection for a room, so boopis holds a message written meanwhile (`hold.rs`). This
//! is the one rule that decides when: members are at work (`groups.state`), or the log holds a discussion the engine has not
//! finished (its own `_pending_discussion` reading: the oldest newest-per-thread user message that is not stopped and not
//! closed by a `room.activity` settled or bounded after its last `room.continued`) and that showed life lately. A discussion
//! open but silent for longer than the grace is taken as stuck (the engine's router waits 20 s at most and its worker polls
//! every 5 s, so a healthy gap is far shorter), so a held message never waits on it forever.

use std::collections::HashMap;

use super::{Event, THREAD};

/// What a room's log says of its discussions, read incrementally from a cursor.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Discussions {
    cursor: u64,
    /// thread -> (event id, seq) of its newest user message
    latest: HashMap<String, (String, u64)>,
    /// discussion id -> seq of its last `room.activity` settled or bounded
    done: HashMap<String, u64>,
    /// discussion id -> seq of its last `room.continued`
    continued: HashMap<String, u64>,
    stopped: u64,
    /// The newest event's time, in seconds since 1970.
    last_at: f64,
}

impl Discussions {
    /// Read events after the cursor (an event already read is skipped).
    pub fn ingest(&mut self, events: &[Event]) {
        for e in events {
            if e.seq <= self.cursor {
                continue;
            }
            self.cursor = e.seq;
            self.last_at = self.last_at.max(e.at);
            let id = e.text("discussion_event_id").unwrap_or("").to_owned();
            match e.kind.as_str() {
                "message.user" => {
                    let thread = e.text("thread_id").unwrap_or(THREAD).to_owned();
                    self.latest.insert(thread, (e.id.clone(), e.seq));
                }
                "room.activity"
                    if !id.is_empty()
                        && matches!(e.text("status"), Some("settled" | "bounded")) =>
                {
                    let at = self.done.entry(id).or_default();
                    *at = (*at).max(e.seq);
                }
                "room.continued" if !id.is_empty() => {
                    let at = self.continued.entry(id).or_default();
                    *at = (*at).max(e.seq);
                }
                "room.stop_requested" => self.stopped = self.stopped.max(e.seq),
                _ => {}
            }
        }
    }

    /// The discussion the engine would run next: its id, or `None` when every one is finished.
    #[must_use]
    pub fn open(&self) -> Option<&str> {
        let mut by_seq: Vec<&(String, u64)> = self.latest.values().collect();
        by_seq.sort_by_key(|(_, seq)| *seq);
        by_seq
            .into_iter()
            .find(|(id, seq)| {
                *seq > self.stopped
                    && self.done.get(id).copied().unwrap_or(0)
                        <= self.continued.get(id).copied().unwrap_or(0)
            })
            .map(|(id, _)| id.as_str())
    }

    /// The last event read.
    #[must_use]
    pub fn cursor(&self) -> u64 {
        self.cursor
    }

    /// The newest event's time (seconds since 1970; 0 before any).
    #[must_use]
    pub fn last_at(&self) -> f64 {
        self.last_at
    }
}

/// The rule: members are working, or a discussion is open and showed life (`alive_at`, seconds) within `grace` of `now`.
#[must_use]
pub fn busy(working: bool, d: &Discussions, alive_at: f64, now: f64, grace: f64) -> bool {
    working || (d.open().is_some() && now - alive_at.max(d.last_at()) < grace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(seq: u64, kind: &str, id: &str, payload: serde_json::Value, at: f64) -> Event {
        Event {
            seq,
            id: id.into(),
            kind: kind.into(),
            actor: String::new(),
            payload,
            at,
        }
    }

    #[test]
    fn a_user_message_opens_a_discussion_and_settled_closes_it() {
        let mut d = Discussions::default();
        d.ingest(&[ev(
            1,
            "message.user",
            "u1",
            json!({"thread_id": "main", "text": "go"}),
            100.0,
        )]);
        assert_eq!(d.open(), Some("u1"));
        d.ingest(&[ev(
            2,
            "message.member",
            "m1",
            json!({"discussion_event_id": "u1"}),
            110.0,
        )]);
        assert_eq!(d.open(), Some("u1"));
        d.ingest(&[ev(
            3,
            "room.activity",
            "a1",
            json!({"discussion_event_id": "u1", "status": "settled"}),
            120.0,
        )]);
        assert_eq!(d.open(), None);
        assert_eq!((d.cursor(), d.last_at()), (3, 120.0));
    }

    #[test]
    fn a_continue_reopens_a_bounded_discussion_and_a_stop_ends_every_one() {
        let mut d = Discussions::default();
        d.ingest(&[
            ev(1, "message.user", "u1", json!({"thread_id": "main"}), 1.0),
            ev(
                2,
                "room.activity",
                "a",
                json!({"discussion_event_id": "u1", "status": "bounded"}),
                2.0,
            ),
        ]);
        assert_eq!(d.open(), None);
        d.ingest(&[ev(
            3,
            "room.continued",
            "c",
            json!({"discussion_event_id": "u1"}),
            3.0,
        )]);
        assert_eq!(d.open(), Some("u1"), "continued after the pause");
        d.ingest(&[ev(4, "room.stop_requested", "s", json!({}), 4.0)]);
        assert_eq!(d.open(), None);
        d.ingest(&[ev(2, "message.user", "old", json!({}), 9.0)]);
        assert_eq!(d.cursor(), 4, "an event already read is skipped");
    }

    #[test]
    fn busy_is_work_or_an_open_discussion_with_life_in_it() {
        let mut d = Discussions::default();
        assert!(!busy(false, &d, 0.0, 1000.0, 45.0));
        assert!(busy(true, &d, 0.0, 1000.0, 45.0), "members at work");
        d.ingest(&[ev(1, "message.user", "u1", json!({}), 1000.0)]);
        assert!(
            busy(false, &d, 0.0, 1010.0, 45.0),
            "open and the log moved 10 s ago"
        );
        assert!(
            !busy(false, &d, 0.0, 1050.0, 45.0),
            "open but silent past the grace: stuck"
        );
        assert!(
            busy(false, &d, 1040.0, 1050.0, 45.0),
            "a turn was seen running 10 s ago"
        );
    }
}
