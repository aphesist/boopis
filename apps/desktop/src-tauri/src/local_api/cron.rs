//! Scheduled runs' results (B42). The engine's scheduler builds its own agent for a run (`cron/scheduler.py`), so a run is
//! never a live session of a link and the poll of `session.active_list` cannot tell when one ends. The engine says it in
//! two places, both read through its public surfaces on the bot's own link:
//! - `cron.manage {action: "list"}`: each job's `last_run_at`, `last_status` (`ok`, `error`, `delivery_failed`,
//!   `cancelled`), `last_error` (already redacted by the engine) and `next_run_at`. A job whose `last_run_at` moved has
//!   finished a run;
//! - the run's stored session, which `session.list` lists with source `cron`: the scheduler names it after the job when
//!   the run ends (`<job name> · <date>`, else `cron <job id>`), and its id is `cron_<job id>_<time>` when the scheduler
//!   ran it itself. Its transcript holds the words the run ended on.
//!
//! The list is read every `cron_every` while somebody listens; the first read is the baseline (a run that ended while
//! nobody listened is no news). Nothing is guessed: no session found means no words, and the notification says only what
//! the list said.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::engine::Engine;
use super::model::Role;
use super::service::{ROOT, Service, text};

/// The longest job name the scheduler puts in a run's session title (`cron/scheduler.py`: `[:60]`).
const TITLE_NAME_CHARS: usize = 60;
/// The longest prompt `cron.manage` shows as the name of a job that has none (`cron/job_args.py`: `prompt[:50]`).
const LISTED_PROMPT_CHARS: usize = 50;
/// Rows of a bot's session list read to find a run's session.
const SESSIONS_READ: u64 = 30;
/// Rows of a run's transcript read for its last words.
const TRANSCRIPT_ROWS: u64 = 20;

/// One job of a bot's cron list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    /// The job's id.
    pub job_id: String,
    /// Its name as the list gives it (the name, else the start of its prompt, else its id).
    pub name: String,
    /// When its last run ended, as the engine wrote it.
    pub last_run_at: Option<String>,
    /// How the last run ended.
    pub last_status: Option<String>,
    /// Why it failed, redacted by the engine.
    pub last_error: Option<String>,
    /// When it runs next, as the engine wrote it.
    pub next_run_at: Option<String>,
}

fn opt(v: &Value, key: &str) -> Option<String> {
    Some(text(v, key)).filter(|s| !s.trim().is_empty())
}

/// The jobs of a `cron.manage {action: "list"}` answer.
#[must_use]
pub fn jobs(list: &Value) -> Vec<Job> {
    list.get("jobs")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|j| {
                    let job_id = opt(j, "job_id")?;
                    Some(Job {
                        name: opt(j, "name").unwrap_or_else(|| job_id.clone()),
                        last_run_at: opt(j, "last_run_at"),
                        last_status: opt(j, "last_status"),
                        last_error: opt(j, "last_error"),
                        next_run_at: opt(j, "next_run_at"),
                        job_id,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A name as the scheduler writes it into a session title: its words joined by one space, cut at `max` characters.
fn title_words(name: &str, max: usize) -> String {
    let joined = name.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .chars()
        .take(max)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Whether a stored session row is a run of `job`: a `cron` session the scheduler named after the job, or whose id names
/// it. A job with no name of its own is listed by the start of its prompt, which the title holds a little more of.
#[must_use]
pub fn is_run_of(row: &Value, job: &Job) -> bool {
    if !text(row, "source").trim().eq_ignore_ascii_case("cron") {
        return false;
    }
    let id = text(row, "id");
    if id.starts_with(&format!("cron_{}_", job.job_id)) {
        return true;
    }
    let title = text(row, "title");
    let named = title_words(&job.name, TITLE_NAME_CHARS);
    let fallback = format!("cron {}", job.job_id);
    let cut_prompt = job.name.chars().count() == LISTED_PROMPT_CHARS && title.starts_with(&named);
    (!named.is_empty() && title.starts_with(&format!("{named} \u{b7} ")))
        || title == fallback
        || title.starts_with(&format!("{fallback} "))
        || cut_prompt
}

/// A scheduled run that finished, for its notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
    /// The bot.
    pub profile: String,
    /// The job.
    pub job_id: String,
    /// The job's name.
    pub name: String,
    /// How it ended (`ok`, `error`, `delivery_failed`, `cancelled`).
    pub status: String,
    /// The words the run ended on, else the engine's error for a failure, else empty.
    pub body: String,
    /// The run's stored session, when it was found.
    pub session_id: Option<String>,
    /// When the job runs next, in milliseconds since the epoch.
    pub next_run_at: Option<i64>,
}

/// An engine time (`isoformat()`, with its zone) in milliseconds since the epoch.
fn millis(t: Option<&str>) -> Option<i64> {
    t.and_then(crate::store::time::parse)
        .and_then(|s| i64::try_from(s).ok())
        .map(|s| s * 1000)
}

impl<E: Engine> Service<E> {
    /// Read every bot's cron list and tell each run that finished since the last read. The first read of a job is its
    /// baseline.
    pub(super) async fn read_cron(&self) {
        let mut names = self.feed.bot_names();
        if !names.iter().any(|n| n == ROOT) {
            names.push(ROOT.to_owned());
        }
        for profile in names {
            let Ok(list) = self
                .engine
                .request(
                    &profile,
                    "cron.manage",
                    json!({"action": "list", "include_disabled": true}),
                )
                .await
            else {
                continue;
            };
            if list.get("success").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let now = jobs(&list);
            let moved = self.cron_moved(&profile, &now);
            for (job, before) in moved {
                self.cron_finished(&profile, &job, before.as_deref()).await;
            }
        }
    }

    /// Note each job's last run; return the jobs whose last run moved since the last read, with the one before.
    fn cron_moved(&self, profile: &str, now: &[Job]) -> Vec<(Job, Option<String>)> {
        let mut seen = self
            .cron_seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut moved = Vec::new();
        for job in now {
            let key = (profile.to_owned(), job.job_id.clone());
            match seen.insert(key, job.last_run_at.clone()) {
                Some(before) if before != job.last_run_at && job.last_run_at.is_some() => {
                    moved.push((job.clone(), before));
                }
                _ => {}
            }
        }
        seen.retain(|(p, j), _| p != profile || now.iter().any(|x| &x.job_id == j));
        moved
    }

    /// Forget every job's baseline (nobody listens any more, so the next read starts again).
    pub(super) fn forget_cron(&self) {
        self.cron_seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    async fn cron_finished(&self, profile: &str, job: &Job, before: Option<&str>) {
        let status = job.last_status.clone().unwrap_or_else(|| "ok".to_owned());
        let session = self.run_session(profile, job, before).await;
        let words = match &session {
            Some(sid) => self.last_reply(profile, sid).await,
            None => None,
        };
        let body = words
            .or_else(|| {
                (status == "error")
                    .then(|| job.last_error.clone())
                    .flatten()
            })
            .unwrap_or_default();
        self.feed.notify_cron(&Finished {
            profile: profile.to_owned(),
            job_id: job.job_id.clone(),
            name: title_words(&job.name, TITLE_NAME_CHARS),
            status,
            body,
            session_id: session,
            next_run_at: millis(job.next_run_at.as_deref()),
        });
    }

    /// The stored session of the run that just ended: the newest `cron` session of the bot's list that is a run of the job
    /// and started after the run before it ended.
    async fn run_session(&self, profile: &str, job: &Job, before: Option<&str>) -> Option<String> {
        let list = self
            .engine
            .request(
                profile,
                "session.list",
                json!({"limit": SESSIONS_READ, "include_hidden": true}),
            )
            .await
            .ok()?;
        #[allow(clippy::cast_precision_loss)] // seconds since 1970 fit an f64's integer range
        let after = before.and_then(crate::store::time::parse).map(|s| s as f64);
        list.get("sessions")?
            .as_array()?
            .iter()
            .find_map(|row| {
                let started = row.get("started_at").and_then(Value::as_f64).unwrap_or(0.0);
                // the clocks are the engine's own; a second of slack for a stamp rounded the other way
                let fresh = after.is_none_or(|a| started + 1.0 >= a);
                (fresh && is_run_of(row, job)).then(|| {
                    opt(row, "resolved_id")
                        .or_else(|| opt(row, "id"))
                        .unwrap_or_default()
                })
            })
            .filter(|s| !s.is_empty())
    }

    /// The last words the bot wrote in a stored session, read from its transcript.
    async fn last_reply(&self, profile: &str, sid: &str) -> Option<String> {
        let page = self
            .engine
            .request(
                profile,
                "session.transcript",
                json!({"session_id": sid, "limit": TRANSCRIPT_ROWS, "order": "latest"}),
            )
            .await
            .ok()?;
        let mut rows: Vec<&Value> = page.get("rows")?.as_array()?.iter().collect();
        rows.sort_by_key(|r| r.get("row_id").and_then(Value::as_i64));
        rows.iter()
            .enumerate()
            .filter_map(|(i, r)| self.stored_message(r, i))
            .rfind(|m| m.role == Role::Assistant)
            .map(|m| m.text)
    }
}

/// What the service remembers of each job: its last run, by `(profile, job id)`.
pub(super) type Seen = HashMap<(String, String), Option<String>>;

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::config::{ApiLimits, RoomLimits};
    use crate::error::Error;
    use crate::local_api::audit::Audit;
    use crate::local_api::engine::scripted::Scripted;
    use crate::local_api::feed::Feed;
    use crate::local_api::model::{Event, NoteKind, Notification, Source};
    use crate::rooms::hold;

    fn job(name: &str, id: &str) -> Job {
        Job {
            job_id: id.into(),
            name: name.into(),
            last_run_at: None,
            last_status: None,
            last_error: None,
            next_run_at: None,
        }
    }

    #[test]
    fn a_run_is_found_by_the_name_the_scheduler_gives_its_session_or_by_its_id() {
        let digest = job("Nightly  digest", "a1b2c3");
        let row = |id: &str, title: &str, source: &str| json!({"id": id, "title": title, "source": source});
        assert!(is_run_of(
            &row("local-9f", "Nightly digest \u{b7} Nov 23 03:00", "cron"),
            &digest
        ));
        assert!(is_run_of(
            &row("local-9f", "Nightly digest \u{b7} Nov 23 03:00 #2", "cron"),
            &digest
        ));
        assert!(is_run_of(
            &row("cron_a1b2c3_20261123_030000", "", "cron"),
            &digest
        ));
        assert!(is_run_of(&row("x", "cron a1b2c3", "cron"), &digest));
        assert!(
            !is_run_of(
                &row("local-1", "Nightly digest weekly \u{b7} Nov 23", "cron"),
                &digest
            ),
            "another job whose name starts the same"
        );
        assert!(
            !is_run_of(
                &row("local-2", "Nightly digest \u{b7} Nov 23", "gui"),
                &digest
            ),
            "only the scheduler's sessions"
        );
        let unnamed = job(&"p".repeat(50), "u1");
        assert!(is_run_of(
            &row(
                "local-3",
                &format!("{} \u{b7} Nov 23", "p".repeat(60)),
                "cron"
            ),
            &unnamed
        ));
        assert_eq!(
            jobs(
                &json!({"jobs": [{"job_id": "j1", "name": "", "last_run_at": "2026-11-23T03:00:05+00:00", "last_status": "ok"}, {"name": "no id"}]})
            ),
            vec![Job {
                job_id: "j1".into(),
                name: "j1".into(),
                last_run_at: Some("2026-11-23T03:00:05+00:00".into()),
                last_status: Some("ok".into()),
                last_error: None,
                next_run_at: None
            }]
        );
    }

    /// moss has one job; its list's last run is what the test sets. Its session list holds an older run of the job, the
    /// new one, another job's run and a conversation of the app's.
    fn engine(state: Arc<Mutex<Value>>) -> Scripted {
        Scripted::new(move |profile, method, params| match (profile, method) {
            (_, "profiles.list") => Ok(
                json!({"profiles": [{"name": "default"}, {"name": "moss", "display_name": "Moss"}]}),
            ),
            (_, "plugin.boopis.bots.read") => Ok(json!({"bots": []})),
            (_, "groups.list") => Ok(json!({"rooms": []})),
            ("moss", "cron.manage") => {
                assert_eq!(params["action"], "list");
                Ok(json!({"success": true, "jobs": [state.lock().unwrap().clone()]}))
            }
            (_, "cron.manage") => Ok(json!({"success": true, "jobs": []})),
            ("moss", "session.list") => Ok(json!({"sessions": [
                {"id": "20261123_090000_ab12cd", "title": "hi", "source": "gui", "started_at": 1_795_424_400.0},
                {"id": "local-new", "title": "Nightly digest \u{b7} Nov 23 03:00", "source": "cron", "started_at": 1_795_402_800.0},
                {"id": "local-other", "title": "Weekly \u{b7} Nov 23 02:00", "source": "cron", "started_at": 1_795_399_200.0},
                {"id": "local-old", "title": "Nightly digest \u{b7} Nov 22 03:00", "source": "cron", "started_at": 1_795_316_400.0}
            ]})),
            ("moss", "session.transcript") => {
                assert_eq!(params["session_id"], "local-new");
                Ok(json!({"rows": [
                    {"row_id": 3, "role": "assistant", "text": "Digest: 3 new papers. token=abcdef0123456789secret"},
                    {"row_id": 2, "role": "tool", "text": "raw"},
                    {"row_id": 1, "role": "user", "text": "make the digest"}
                ]}))
            }
            _ => Err(Error::Unavailable(format!("unscripted {profile} {method}"))),
        })
    }

    fn notes(
        rx: &mut tokio::sync::broadcast::Receiver<Arc<crate::local_api::model::Stamped>>,
    ) -> Vec<Notification> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|e| match &e.event {
                Event::Notification(n) => Some(n.clone()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn a_finished_run_is_told_with_its_words_its_job_and_when_it_runs_next() {
        let state = Arc::new(Mutex::new(
            json!({"job_id": "a1b2c3", "name": "Nightly digest",
            "last_run_at": "2026-11-22T03:00:41+00:00", "last_status": "ok",
            "next_run_at": "2026-11-23T03:00:00+00:00"}),
        ));
        let dir = tempfile::tempdir().unwrap();
        let feed = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        let s = Service::new(
            feed,
            Arc::new(engine(state.clone())),
            ApiLimits::default(),
            hold::Store::under(dir.path()),
            RoomLimits::default(),
        );
        s.refresh_roster().await;
        let mut rx = s.feed().subscribe(None).rx;
        s.read_cron().await;
        assert!(notes(&mut rx).is_empty(), "the first read is the baseline");
        *state.lock().unwrap() = json!({"job_id": "a1b2c3", "name": "Nightly digest",
            "last_run_at": "2026-11-23T03:01:12.5+00:00", "last_status": "ok",
            "next_run_at": "2026-11-24T03:00:00+00:00"});
        s.read_cron().await;
        let got = notes(&mut rx);
        assert_eq!(got.len(), 1, "{got:?}");
        let n = &got[0];
        assert_eq!((n.kind, n.source), (NoteKind::Cron, Source::Cron));
        assert_eq!(
            n.title,
            "Moss's scheduled run \u{201c}Nightly digest\u{201d} finished"
        );
        assert!(n.body.starts_with("Digest: 3 new papers."), "{}", n.body);
        assert!(
            !n.body.contains("abcdef0123456789secret"),
            "scrubbed: {}",
            n.body
        );
        assert_eq!(
            n.session_id.as_deref(),
            Some("local-new"),
            "the new run's session, not the run before it"
        );
        assert_eq!(n.next_run_at, Some(1_795_489_200_000));
        s.read_cron().await;
        assert!(notes(&mut rx).is_empty(), "a run is told once");
    }

    #[tokio::test]
    async fn a_failed_run_with_no_session_says_the_engines_own_error() {
        let state = Arc::new(Mutex::new(json!({"job_id": "zz9", "name": "Backup",
            "last_run_at": "2026-11-22T01:00:00+00:00", "last_status": "ok"})));
        let dir = tempfile::tempdir().unwrap();
        let s = Service::new(
            Feed::new(Audit::under(dir.path()), ApiLimits::default()),
            Arc::new(engine(state.clone())),
            ApiLimits::default(),
            hold::Store::under(dir.path()),
            RoomLimits::default(),
        );
        s.refresh_roster().await;
        let mut rx = s.feed().subscribe(None).rx;
        s.read_cron().await;
        *state.lock().unwrap() = json!({"job_id": "zz9", "name": "Backup",
            "last_run_at": "2026-11-23T01:00:09+00:00", "last_status": "error",
            "last_error": "Unknown provider 'x'", "next_run_at": null});
        s.read_cron().await;
        let got = notes(&mut rx);
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(
            got[0].title,
            "Moss's scheduled run \u{201c}Backup\u{201d} failed"
        );
        assert_eq!(got[0].body, "Unknown provider 'x'");
        assert_eq!(
            (got[0].session_id.as_deref(), got[0].next_run_at),
            (None, None)
        );
        s.forget_cron();
        *state.lock().unwrap() = json!({"job_id": "zz9", "name": "Backup",
            "last_run_at": "2026-11-23T02:00:00+00:00", "last_status": "ok"});
        s.read_cron().await;
        assert!(
            notes(&mut rx).is_empty(),
            "after a pause in listening, the next read is a baseline again"
        );
    }
}
