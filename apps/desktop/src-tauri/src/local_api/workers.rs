//! Kanban workers (B31): a bot running a board task is a process of its own that the engine's live-session list never shows,
//! so it looked idle. The engine has it in two places, both read through its public surfaces:
//! - the profile's newest worker session (`worker_session` of the bot's own row in `profiles.list`, asked on the bot's own
//!   link; source `kanban`), which the worker keeps fresh while it runs (`last_active` is refreshed at least every minute):
//!   while it is fresh the bot is `working` with source `kanban` and the session's title as its summary;
//! - the board's task the worker ran, read with the engine's own `kanban` command when the worker stops: its status and the
//!   summary the worker handed off (`latest_summary`) make the notification.
//!
//! Nothing is guessed: no worker row means no worker, a task that cannot be found makes no notification, and a task still
//! running (the worker went quiet without finishing) makes none either.

use serde_json::{Value, json};

use super::engine::Engine;
use super::model::Source;
use super::presence::{Live, Status};
use super::service::{Service, text};

/// A bot's newest kanban worker session, as its own link said.
#[derive(Debug, Clone, PartialEq)]
pub struct Worker {
    /// The worker's session id.
    pub session_id: String,
    /// The session's title (the engine titles a worker's session after its task).
    pub title: String,
    /// When it last showed life, in seconds since 1970.
    pub last_active: f64,
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

/// The bot's own row's kanban worker from a `profiles.list` answer, or `None`.
#[must_use]
pub fn own_worker(list: &Value, profile: &str) -> Option<Worker> {
    let rows = list.get("profiles")?.as_array()?;
    let row = rows.iter().find(|r| text(r, "name") == profile)?;
    let w = row.get("worker_session").filter(|w| !w.is_null())?;
    if !text(w, "source").trim().eq_ignore_ascii_case("kanban") {
        return None;
    }
    let session_id = text(w, "id");
    (!session_id.is_empty()).then(|| Worker {
        session_id,
        title: text(w, "title").trim().to_owned(),
        last_active: w.get("last_active").and_then(Value::as_f64).unwrap_or(0.0),
    })
}

/// Whether a worker is running: it showed life within `window` seconds of `now` (the engine's own liveness rule for a
/// worker row, which the app's roster uses too).
#[must_use]
pub fn running(w: &Worker, now: f64, window: f64) -> bool {
    w.last_active > 0.0 && now - w.last_active <= window
}

/// The task a worker ran, from a board's `kanban list --json`: the one whose `session_id` is the worker's; `(id, title)`.
#[must_use]
pub fn task_of(tasks: &Value, session_id: &str) -> Option<(String, String)> {
    tasks.as_array()?.iter().find_map(|t| {
        (text(t, "session_id") == session_id && !text(t, "id").is_empty())
            .then(|| (text(t, "id"), text(t, "title").trim().to_owned()))
    })
}

/// What a finished task's notification says, from `kanban show --json`: `(title, body)`, or `None` while the task is not
/// finished (still running, or ready again).
#[must_use]
pub fn finished_words(who: &str, show: &Value) -> Option<(String, String)> {
    let task = show.get("task")?;
    let title = text(task, "title").trim().to_owned();
    let named = if title.is_empty() {
        "kanban task".to_owned()
    } else {
        format!("task \u{201c}{title}\u{201d}")
    };
    let head = match text(task, "status").as_str() {
        "done" => format!("{who} finished a {named}"),
        "review" => format!("{who}'s {named} is ready for review"),
        "blocked" => format!("{who}'s {named} is blocked"),
        _ => return None,
    };
    let summary = show
        .get("latest_summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| Some(text(task, "result").trim().to_owned()).filter(|s| !s.is_empty()))
        .unwrap_or_default();
    Some((head, summary))
}

impl<E: Engine> Service<E> {
    /// Ask each bot's own link for its newest kanban worker; a worker that stopped since the last read is looked up on its
    /// board and told as a notification.
    pub(super) async fn read_workers(&self) {
        let window = self.limits.worker_active.as_secs_f64();
        for profile in self.feed.bot_names() {
            let Ok(list) = self
                .engine
                .request(&profile, "profiles.list", json!({"include_sessions": true}))
                .await
            else {
                continue;
            };
            let now = own_worker(&list, &profile);
            let before = {
                let mut workers = self
                    .workers
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let before = workers.get(&profile).cloned();
                match &now {
                    Some(w) => workers.insert(profile.clone(), w.clone()),
                    None => workers.remove(&profile),
                };
                before
            };
            let t = now_secs();
            if let Some(old) = before.filter(|o| running(o, t, window + 30.0))
                && now
                    .as_ref()
                    .is_none_or(|n| n.session_id != old.session_id || !running(n, t, window))
            {
                self.worker_stopped(&profile, &old).await;
            }
        }
    }

    /// The bot's kanban worker, while it runs.
    pub(super) fn worker_of(&self, profile: &str) -> Option<Worker> {
        let w = self
            .workers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(profile)
            .cloned()?;
        running(&w, now_secs(), self.limits.worker_active.as_secs_f64()).then_some(w)
    }

    /// The poll's row for a running worker: the bot is working, source `kanban`.
    pub(super) fn worker_rows(&self, profile: &str) -> Vec<Live> {
        self.worker_of(profile)
            .map(|w| Live {
                session_id: w.session_id,
                status: Status::Working,
                source: Source::Kanban,
                summary: Some(w.title).filter(|t| !t.is_empty()),
            })
            .into_iter()
            .collect()
    }

    /// A worker stopped: find its task on the boards and say how it ended, with the engine's own summary.
    async fn worker_stopped(&self, profile: &str, w: &Worker) {
        let Ok(boards) = self
            .engine
            .kanban(&["kanban", "boards", "list", "--json"])
            .await
            .and_then(|out| crate::kanban::parse_boards(&out))
        else {
            return;
        };
        for board in boards
            .iter()
            .filter(|b| !b.archived && crate::kanban::slug_ok(&b.slug))
        {
            let Ok(list) = self
                .engine
                .kanban(&["kanban", "--board", &board.slug, "list", "--json"])
                .await
            else {
                continue;
            };
            let Some((task, _)) = serde_json::from_str::<Value>(&list)
                .ok()
                .and_then(|v| task_of(&v, &w.session_id))
            else {
                continue;
            };
            let Ok(show) = self
                .engine
                .kanban(&["kanban", "--board", &board.slug, "show", &task, "--json"])
                .await
            else {
                return;
            };
            let who = self
                .feed
                .bots()
                .into_iter()
                .find(|b| b.name == profile)
                .map_or_else(|| profile.to_owned(), |b| b.display_name);
            if let Some((title, body)) = serde_json::from_str::<Value>(&show)
                .ok()
                .and_then(|v| finished_words(&who, &v))
            {
                self.feed.notify_task(profile, &w.session_id, title, &body);
            }
            return;
        }
        tracing::debug!(
            profile,
            "a kanban worker stopped and no board names its task"
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::config::{ApiLimits, RoomLimits};
    use crate::error::Error;
    use crate::local_api::audit::Audit;
    use crate::local_api::engine::scripted::Scripted;
    use crate::local_api::feed::Feed;
    use crate::local_api::model::{Event, NoteKind, State};
    use crate::rooms::hold;

    #[tokio::test]
    async fn a_running_kanban_worker_shows_the_bot_working_and_its_end_is_told_with_the_engines_summary()
     {
        // B31: mira's worker is a process of its own; her own link's roster row has it, and the board has its summary.
        let active = Arc::new(Mutex::new(now_secs()));
        let seen = active.clone();
        let engine = Arc::new(Scripted::new(move |profile, method, params| match method {
            "profiles.list" if profile == "mira" => {
                Ok(json!({"profiles": [{"name": "mira", "worker_session":
                {"id": "w1", "source": "kanban", "title": "Script review", "last_active": *seen.lock().unwrap()}}]}))
            }
            "profiles.list" => Ok(
                json!({"profiles": [{"name": "default"}, {"name": "mira", "display_name": "Mira"}]}),
            ),
            "plugin.boopis.bots.read" => Ok(json!({"bots": []})),
            "groups.list" => Ok(json!({"rooms": []})),
            "session.active_list" => Ok(json!({"sessions": []})),
            "kanban" => {
                let args: Vec<&str> = params
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| a.as_str().unwrap())
                    .collect();
                match args.as_slice() {
                    ["kanban", "boards", "list", "--json"] => {
                        Ok(json!(r#"[{"slug": "paper-past", "name": "paper past"}]"#))
                    }
                    ["kanban", "--board", "paper-past", "list", "--json"] => Ok(json!(
                        r#"[{"id": "t_566252aa", "title": "Script review", "session_id": "w1", "status": "done"}]"#
                    )),
                    [
                        "kanban",
                        "--board",
                        "paper-past",
                        "show",
                        "t_566252aa",
                        "--json",
                    ] => Ok(json!(
                        r#"{"task": {"title": "Script review", "status": "done"}, "latest_summary": "Script review done: CHANGES (2 blocking, 9 low)"}"#
                    )),
                    other => Err(Error::Unavailable(format!("unscripted kanban {other:?}"))),
                }
            }
            _ => Err(Error::Unavailable(format!("unscripted {method}"))),
        }));
        let dir = tempfile::tempdir().unwrap();
        let feed = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        let s = Service::new(
            feed,
            engine.clone(),
            ApiLimits::default(),
            hold::Store::under(dir.path()),
            RoomLimits::default(),
        );
        let mut rx = s.feed().subscribe(None).rx;
        s.refresh_roster().await;
        s.poll_once().await;
        let mira = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "mira")
            .unwrap();
        assert_eq!(
            (mira.state, mira.source),
            (State::Working, Some(Source::Kanban)),
            "not idle while her worker runs"
        );
        assert_eq!(mira.summary.as_deref(), Some("Script review"));
        assert!(
            engine.of("kanban").is_empty(),
            "the board is read only when a worker stops"
        );
        *active.lock().unwrap() -= 600.0;
        s.refresh_roster().await;
        s.poll_once().await;
        let notes: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|e| match &e.event {
                Event::Notification(n) => Some(n.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_eq!(
            (notes[0].kind, notes[0].source),
            (NoteKind::Task, Source::Kanban)
        );
        assert_eq!(
            notes[0].title,
            "Mira finished a task \u{201c}Script review\u{201d}"
        );
        assert_eq!(
            notes[0].body,
            "Script review done: CHANGES (2 blocking, 9 low)"
        );
        let mira = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "mira")
            .unwrap();
        assert_eq!(mira.state, State::Idle);
    }

    #[test]
    fn only_the_bots_own_kanban_worker_counts() {
        let list = json!({"profiles": [
            {"name": "default", "worker_session": {"id": "w0", "source": "kanban", "title": "x", "last_active": 10.0}},
            {"name": "mira", "worker_session": {"id": "w1", "source": "kanban", "title": "Script review", "last_active": 100.0}},
            {"name": "kai", "worker_session": {"id": "w2", "source": "tool", "title": "t", "last_active": 100.0}},
            {"name": "nina", "worker_session": null}
        ]});
        let w = own_worker(&list, "mira").unwrap();
        assert_eq!(
            (w.session_id.as_str(), w.title.as_str()),
            ("w1", "Script review")
        );
        assert!(
            own_worker(&list, "kai").is_none(),
            "a tool worker is not a kanban task"
        );
        assert!(own_worker(&list, "nina").is_none());
        assert!(own_worker(&list, "moss").is_none());
        assert!(running(&w, 150.0, 90.0) && !running(&w, 200.0, 90.0));
    }

    #[test]
    fn a_finished_task_is_told_with_the_engines_summary_and_a_running_one_is_not() {
        let tasks = json!([{"id": "t_1", "title": "a", "session_id": "w9"}, {"id": "t_566252aa", "title": "Script review", "session_id": "w1"}]);
        assert_eq!(
            task_of(&tasks, "w1"),
            Some(("t_566252aa".into(), "Script review".into()))
        );
        assert_eq!(task_of(&tasks, "w7"), None);
        let show = json!({"task": {"title": "Script review", "status": "done", "result": null},
            "latest_summary": "Script review done: CHANGES (2 blocking, 9 low)"});
        assert_eq!(
            finished_words("mira", &show),
            Some((
                "mira finished a task \u{201c}Script review\u{201d}".into(),
                "Script review done: CHANGES (2 blocking, 9 low)".into()
            ))
        );
        let review = json!({"task": {"title": "", "status": "review"}, "latest_summary": null});
        assert_eq!(
            finished_words("mira", &review),
            Some((
                "mira's kanban task is ready for review".into(),
                String::new()
            ))
        );
        assert_eq!(
            finished_words("mira", &json!({"task": {"status": "running"}})),
            None
        );
    }
}
