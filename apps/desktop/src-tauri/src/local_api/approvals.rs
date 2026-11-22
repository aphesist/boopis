//! The approvals inbox: every approval the engine asked for, across every bot and session, answered from any client, with
//! boopis's own rules kept (`ADR-0045`):
//! - a row exists only because the engine asked (an event on a link of the host, or the poll of a waiting session);
//! - **first answer wins**: a row moves from pending to answering under the inbox's lock before the engine is called, so a
//!   second client is told who was first; a failed delivery puts the row back so someone else can answer;
//! - the boopis window answers `once` or `deny` only, so every other client does too: a standing grant (`session`,
//!   `always`) is made in the window, never remotely;
//! - the choice must be one the engine offered, and an answer that names a generation must name the row's;
//! - nothing is auto-approved: no default choice, no "all", no timeout that approves.
//!
//! The inbox is pure (the time is an argument) and holds no I/O; the service delivers the answer and reports back.

use std::collections::BTreeMap;

use super::model::{Answered, Approval, ApprovalState};

/// The choices boopis accepts from outside its window.
pub const REMOTE_CHOICES: [&str; 2] = ["once", "deny"];
/// Rows kept at most.
pub const MAX_ROWS: usize = 256;
/// How long an answered or expired row is kept for `GET /v1/approvals?all=1`.
pub const KEEP_MS: i64 = 10 * 60 * 1000;

/// Why an answer was refused. Each has a sentence that says what to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// There is no such approval.
    Unknown,
    /// Someone answered first (or is answering now).
    AlreadyAnswered(Option<Answered>),
    /// The time ran out, or the engine no longer holds it.
    Expired,
    /// The choice is not one of boopis's remote choices (a standing grant, or nonsense).
    Policy(String),
    /// The choice is not one the engine offered for this approval.
    NotOffered(String),
    /// The answer names another generation of the execution.
    Generation {
        /// The row's.
        expected: u64,
    },
}

impl Refusal {
    /// The code a client reads.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unknown => "not_found",
            Self::AlreadyAnswered(_) => "already_answered",
            Self::Expired => "expired",
            Self::Policy(_) => "policy_refused",
            Self::NotOffered(_) => "choice_not_offered",
            Self::Generation { .. } => "stale_generation",
        }
    }

    /// What it says, and what to do.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Unknown => "There is no such approval. It may have been answered or have expired.".into(),
            Self::AlreadyAnswered(Some(by)) => format!(
                "Already answered by {} ({}). The first answer stands.",
                by.client, by.surface
            ),
            Self::AlreadyAnswered(None) => "Already answered. The first answer stands.".into(),
            Self::Expired => "This approval has expired. Ask the bot to try again.".into(),
            Self::Policy(c) => format!(
                "boopis accepts only once or deny from outside its window, not {c:?}. Grant a standing permission in boopis."
            ),
            Self::NotOffered(c) => format!("The engine did not offer {c:?} for this approval."),
            Self::Generation { expected } => format!(
                "The answer names another generation of this turn; this approval is generation {expected}."
            ),
        }
    }
}

/// How the delivery to the engine ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// The engine took the answer.
    Delivered,
    /// The engine refused or could not be reached: the row goes back to pending.
    Failed,
    /// The engine says it was already settled (another client, or its own timeout).
    AlreadySettled,
}

/// The inbox.
#[derive(Debug, Default)]
pub struct Inbox {
    rows: BTreeMap<String, Approval>,
}

fn key(profile: &str, id: &str) -> String {
    format!("{profile}\u{1f}{id}")
}

impl Inbox {
    /// An empty inbox.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Add what the engine asked for, or refresh a row it already asked: returns the row when it is new or changed.
    /// A row that was answered stays answered.
    pub fn upsert(&mut self, mut row: Approval) -> Option<Approval> {
        row.answerable_with = REMOTE_CHOICES
            .iter()
            .filter(|c| row.choices.iter().any(|o| o == *c))
            .map(|c| (*c).to_owned())
            .collect();
        let k = key(&row.profile, &row.id);
        match self.rows.get(&k) {
            Some(old) if old.state != ApprovalState::Pending => None,
            Some(old) if *old == row => None,
            _ => {
                if self.rows.len() >= MAX_ROWS
                    && !self.rows.contains_key(&k)
                    && let Some(oldest) = self
                        .rows
                        .iter()
                        .filter(|(_, r)| r.state == ApprovalState::Settled || r.state == ApprovalState::Expired)
                        .min_by_key(|(_, r)| r.asked_at)
                        .map(|(k, _)| k.clone())
                {
                    self.rows.remove(&oldest);
                }
                if self.rows.len() >= MAX_ROWS && !self.rows.contains_key(&k) {
                    return None; // full of live approvals: never drop one the owner has not answered
                }
                self.rows.insert(k, row.clone());
                Some(row)
            }
        }
    }

    /// The row for an approval.
    #[must_use]
    pub fn get(&self, profile: &str, id: &str) -> Option<&Approval> {
        self.rows.get(&key(profile, id))
    }

    /// The row of an id across profiles (a prompt id is unique per run, so at most one).
    #[must_use]
    pub fn find(&self, id: &str) -> Option<&Approval> {
        self.rows.values().find(|r| r.id == id)
    }

    /// Whether a session has an approval waiting.
    #[must_use]
    pub fn session_waits(&self, profile: &str, session_id: &str) -> bool {
        self.rows.values().any(|r| {
            r.profile == profile
                && r.session_id == session_id
                && matches!(r.state, ApprovalState::Pending | ApprovalState::Answering)
        })
    }

    /// The approvals still waiting (pending or being answered), oldest first.
    #[must_use]
    pub fn waiting(&self) -> Vec<Approval> {
        let mut rows: Vec<Approval> = self
            .rows
            .values()
            .filter(|r| matches!(r.state, ApprovalState::Pending | ApprovalState::Answering))
            .cloned()
            .collect();
        rows.sort_by_key(|r| r.asked_at);
        rows
    }

    /// Every row kept, oldest first.
    #[must_use]
    pub fn all(&self) -> Vec<Approval> {
        let mut rows: Vec<Approval> = self.rows.values().cloned().collect();
        rows.sort_by_key(|r| r.asked_at);
        rows
    }

    /// Check an answer against the rules without changing anything.
    ///
    /// # Errors
    /// The refusal, in the order a client should fix them.
    pub fn check(row: &Approval, choice: &str, generation: Option<u64>, now: i64) -> Result<(), Refusal> {
        match row.state {
            ApprovalState::Settled | ApprovalState::Answering => {
                return Err(Refusal::AlreadyAnswered(row.answered_by.clone()));
            }
            ApprovalState::Expired => return Err(Refusal::Expired),
            ApprovalState::Pending => {}
        }
        if row.timeout_s.is_some_and(|t| now > row.asked_at + i64::try_from(t).unwrap_or(i64::MAX).saturating_mul(1000)) {
            return Err(Refusal::Expired);
        }
        if !REMOTE_CHOICES.contains(&choice) {
            return Err(Refusal::Policy(choice.to_owned()));
        }
        if !row.choices.iter().any(|c| c == choice) {
            return Err(Refusal::NotOffered(choice.to_owned()));
        }
        if let Some(g) = generation
            && g != row.execution_generation
        {
            return Err(Refusal::Generation { expected: row.execution_generation });
        }
        Ok(())
    }

    /// The first step of an answer: check it and take the row (pending to answering). The caller then delivers it and
    /// calls [`Inbox::finish`].
    ///
    /// # Errors
    /// The refusal.
    pub fn begin(
        &mut self,
        profile: &str,
        id: &str,
        choice: &str,
        generation: Option<u64>,
        by: Answered,
        now: i64,
    ) -> Result<Approval, Refusal> {
        let row = self.rows.get_mut(&key(profile, id)).ok_or(Refusal::Unknown)?;
        Self::check(row, choice, generation, now)?;
        row.state = ApprovalState::Answering;
        row.answered_by = Some(Answered { choice: Some(choice.to_owned()), ..by });
        Ok(row.clone())
    }

    /// The last step: the delivery's outcome. Returns the row as it now stands.
    pub fn finish(&mut self, profile: &str, id: &str, delivery: &Delivery, now: i64) -> Option<Approval> {
        let row = self.rows.get_mut(&key(profile, id))?;
        if row.state != ApprovalState::Answering {
            return None;
        }
        match delivery {
            Delivery::Delivered => row.state = ApprovalState::Settled,
            Delivery::Failed => {
                row.state = ApprovalState::Pending;
                row.answered_by = None;
            }
            Delivery::AlreadySettled => {
                row.state = ApprovalState::Settled;
                row.answered_by = Some(Answered {
                    client: "another client".into(),
                    surface: "unknown".into(),
                    choice: None,
                    at: now,
                });
            }
        }
        Some(row.clone())
    }

    /// The engine settled an approval (an `approval.settled` event, or the boopis window's own answer seen on the
    /// proxy). `by` names who when it is known. Returns the row when it changed.
    pub fn settled_elsewhere(&mut self, profile: &str, id: &str, by: Option<Answered>) -> Option<Approval> {
        let row = self.rows.get_mut(&key(profile, id))?;
        match row.state {
            ApprovalState::Settled | ApprovalState::Expired => None,
            ApprovalState::Answering => None, // our own delivery's `finish` closes it
            ApprovalState::Pending => {
                row.state = ApprovalState::Settled;
                row.answered_by = by;
                Some(row.clone())
            }
        }
    }

    /// The poll of one session says which approvals the engine still holds: a pending row it no longer holds is closed.
    pub fn retain_held(&mut self, profile: &str, session_id: &str, held: &[String]) -> Vec<Approval> {
        let mut closed = Vec::new();
        for row in self.rows.values_mut() {
            if row.profile == profile
                && row.session_id == session_id
                && row.state == ApprovalState::Pending
                && !held.iter().any(|h| *h == row.id)
            {
                row.state = ApprovalState::Expired;
                closed.push(row.clone());
            }
        }
        closed
    }

    /// Let time pass: a pending row whose limit ran out expires, and old closed rows go.
    pub fn sweep(&mut self, now: i64) -> Vec<Approval> {
        let mut closed = Vec::new();
        for row in self.rows.values_mut() {
            let due = row
                .timeout_s
                .is_some_and(|t| now > row.asked_at + i64::try_from(t).unwrap_or(i64::MAX).saturating_mul(1000));
            if row.state == ApprovalState::Pending && due {
                row.state = ApprovalState::Expired;
                closed.push(row.clone());
            }
        }
        self.rows.retain(|_, r| {
            matches!(r.state, ApprovalState::Pending | ApprovalState::Answering) || r.asked_at + KEEP_MS > now
        });
        closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_api::model::Origin;

    fn row(id: &str) -> Approval {
        Approval {
            id: id.into(),
            profile: "kai".into(),
            session_id: "s1".into(),
            prompt_id: id.into(),
            execution_generation: 4,
            command: "rm -rf build".into(),
            description: "delete the build folder".into(),
            choices: vec!["once".into(), "session".into(), "always".into(), "deny".into()],
            answerable_with: vec![],
            timeout_s: Some(60),
            origin: Origin { model: Some("opus".into()), tool: Some("terminal".into()) },
            governed: false,
            state: ApprovalState::Pending,
            answered_by: None,
            asked_at: 1_000,
        }
    }

    fn who(client: &str) -> Answered {
        Answered { client: client.into(), surface: "endpoint".into(), choice: None, at: 2_000 }
    }

    #[test]
    fn the_first_answer_wins_and_the_second_is_told_who() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        inbox.begin("kai", "p1", "once", None, who("panacea-island"), 2_000).unwrap();
        let second = inbox.begin("kai", "p1", "deny", None, who("boopis-cli"), 2_001).unwrap_err();
        assert_eq!(second.code(), "already_answered");
        assert!(second.message().contains("panacea-island"), "{}", second.message());
        inbox.finish("kai", "p1", &Delivery::Delivered, 2_002).unwrap();
        let third = inbox.begin("kai", "p1", "once", None, who("x"), 2_003).unwrap_err();
        assert!(matches!(third, Refusal::AlreadyAnswered(Some(a)) if a.client == "panacea-island"));
    }

    #[test]
    fn a_failed_delivery_gives_the_row_back_to_the_next_client() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        inbox.begin("kai", "p1", "once", None, who("a"), 2_000).unwrap();
        let back = inbox.finish("kai", "p1", &Delivery::Failed, 2_001).unwrap();
        assert_eq!((back.state, back.answered_by), (ApprovalState::Pending, None));
        inbox.begin("kai", "p1", "deny", None, who("b"), 2_002).unwrap();
    }

    #[test]
    fn the_engine_saying_it_was_settled_closes_the_row_as_someone_elses() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        inbox.begin("kai", "p1", "once", None, who("a"), 2_000).unwrap();
        let done = inbox.finish("kai", "p1", &Delivery::AlreadySettled, 2_001).unwrap();
        assert_eq!(done.state, ApprovalState::Settled);
        assert_eq!(done.answered_by.unwrap().client, "another client");
    }

    #[test]
    fn a_standing_grant_is_never_taken_from_outside_the_window() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        for choice in ["session", "always", "yes", "approve", "", "ONCE"] {
            let e = inbox.begin("kai", "p1", choice, None, who("a"), 2_000).unwrap_err();
            assert_eq!(e.code(), "policy_refused", "{choice:?}");
        }
        assert_eq!(inbox.get("kai", "p1").unwrap().state, ApprovalState::Pending, "a refusal takes nothing");
    }

    #[test]
    fn the_choice_must_be_one_the_engine_offered_and_the_generation_the_rows() {
        let mut inbox = Inbox::new();
        let mut only_deny = row("p1");
        only_deny.choices = vec!["deny".into()];
        inbox.upsert(only_deny);
        assert_eq!(inbox.begin("kai", "p1", "once", None, who("a"), 2_000).unwrap_err().code(), "choice_not_offered");
        inbox.upsert(row("p2"));
        assert_eq!(inbox.begin("kai", "p2", "once", Some(3), who("a"), 2_000).unwrap_err().code(), "stale_generation");
        inbox.begin("kai", "p2", "once", Some(4), who("a"), 2_000).unwrap();
        assert_eq!(inbox.begin("kai", "zz", "once", None, who("a"), 2_000).unwrap_err().code(), "not_found");
    }

    #[test]
    fn what_may_be_answered_remotely_is_listed_on_the_row() {
        let mut inbox = Inbox::new();
        let shown = inbox.upsert(row("p1")).unwrap();
        assert_eq!(shown.answerable_with, ["once", "deny"]);
        let mut deny_only = row("p2");
        deny_only.choices = vec!["deny".into(), "always".into()];
        assert_eq!(inbox.upsert(deny_only).unwrap().answerable_with, ["deny"]);
    }

    #[test]
    fn time_never_approves_it_expires() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        let e = inbox.begin("kai", "p1", "once", None, who("a"), 1_000 + 61_000).unwrap_err();
        assert_eq!(e, Refusal::Expired);
        let closed = inbox.sweep(1_000 + 61_000);
        assert_eq!(closed[0].state, ApprovalState::Expired);
        assert!(inbox.waiting().is_empty());
        assert!(inbox.sweep(1_000 + KEEP_MS + 61_000).is_empty());
        assert!(inbox.all().is_empty(), "old closed rows go");
    }

    #[test]
    fn the_windows_own_answer_and_the_engines_settle_close_a_row() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        let by = Answered { client: "boopis".into(), surface: "gui".into(), choice: Some("once".into()), at: 3_000 };
        assert_eq!(inbox.settled_elsewhere("kai", "p1", Some(by)).unwrap().state, ApprovalState::Settled);
        assert!(inbox.settled_elsewhere("kai", "p1", None).is_none());
        assert!(inbox.upsert(row("p1")).is_none(), "an answered row stays answered");
    }

    #[test]
    fn a_row_the_engine_no_longer_holds_is_closed_by_the_poll() {
        let mut inbox = Inbox::new();
        inbox.upsert(row("p1"));
        inbox.upsert(row("p2"));
        let closed = inbox.retain_held("kai", "s1", &["p2".to_owned()]);
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].id, "p1");
        assert!(inbox.session_waits("kai", "s1"));
    }

    #[test]
    fn a_full_inbox_never_drops_an_approval_nobody_answered() {
        let mut inbox = Inbox::new();
        for i in 0..MAX_ROWS {
            assert!(inbox.upsert(row(&format!("p{i}"))).is_some());
        }
        assert!(inbox.upsert(row("overflow")).is_none());
        assert_eq!(inbox.waiting().len(), MAX_ROWS);
    }
}
