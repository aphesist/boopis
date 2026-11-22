//! The engine's Kanban boards, read only, for a group's board view (`docs/ARCHITECTURE.md` section 10a: the board is where a
//! hand-off that must survive lives). The gateway has no method that lists a board, and the board is a SQLite file the engine
//! owns, so the host asks the engine's own command, `kanban boards list --json` and `kanban --board <slug> list --json`, and
//! reads what it prints. It never opens a board file and never writes to one: the view has no way to move a task.
//!
//! A board is shared by every profile (it lives under the engine's root), so the root home is the one asked.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::error::{Error, Result};
use crate::hermes::Supervisor;

/// One board.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
#[serde(rename = "KanbanBoard")]
pub struct Board {
    /// Its slug, the name the engine's command takes.
    pub slug: String,
    /// What the board is called.
    pub name: String,
    /// It was put away.
    pub archived: bool,
    /// Tasks by state.
    pub counts: BTreeMap<String, u32>,
}

/// One task as the board shows it.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
#[serde(rename = "KanbanTask")]
pub struct Task {
    /// Its id.
    pub id: String,
    /// Its title.
    pub title: String,
    /// The column it is in: `triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`, `review`, `done`.
    pub status: String,
    /// The profile it is assigned to; `None` when nobody is.
    pub assignee: Option<String>,
    /// Higher goes first.
    pub priority: i32,
    /// Seconds since the Unix epoch; `None` when the engine has none.
    pub created_at: Option<f64>,
    /// When it was claimed.
    pub started_at: Option<f64>,
    /// When it was completed.
    pub completed_at: Option<f64>,
    /// Why it stopped, when the engine says.
    pub problem: Option<String>,
}

/// A board and its tasks.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
#[serde(rename = "KanbanView")]
pub struct View {
    /// The board.
    pub board: Board,
    /// Its tasks, newest first.
    pub tasks: Vec<Task>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Epoch seconds, from a number in seconds or in milliseconds.
fn epoch(v: &Value) -> Option<f64> {
    let n = v.as_f64()?;
    if n <= 0.0 {
        return None;
    }
    Some(if n > 1.0e11 { (n / 1000.0).floor() } else { n })
}

fn counts(v: &Value) -> BTreeMap<String, u32> {
    v.as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, n)| Some((k.clone(), u32::try_from(n.as_u64()?).ok()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// The rows of `kanban boards list --json`.
///
/// # Errors
/// `Unavailable` when the output is not a list of boards.
pub fn parse_boards(out: &str) -> Result<Vec<Board>> {
    let v: Value = serde_json::from_str(out)
        .map_err(|_| Error::Unavailable("the boards list was not understood".into()))?;
    let rows = v
        .as_array()
        .ok_or_else(|| Error::Unavailable("the boards list was not a list".into()))?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let slug = text(r, "slug")?;
            Some(Board {
                name: text(r, "name").unwrap_or_else(|| slug.clone()),
                archived: r["archived"] == true,
                counts: counts(&r["counts"]),
                slug,
            })
        })
        .collect())
}

/// The rows of `kanban list --json`, newest first.
///
/// # Errors
/// `Unavailable` when the output is not a list of tasks.
pub fn parse_tasks(out: &str) -> Result<Vec<Task>> {
    let v: Value = serde_json::from_str(out)
        .map_err(|_| Error::Unavailable("the task list was not understood".into()))?;
    let rows = v
        .as_array()
        .ok_or_else(|| Error::Unavailable("the task list was not a list".into()))?;
    let mut tasks: Vec<Task> = rows
        .iter()
        .filter_map(|r| {
            Some(Task {
                id: text(r, "id")?,
                title: text(r, "title").unwrap_or_default(),
                status: text(r, "status").unwrap_or_else(|| "todo".into()),
                assignee: text(r, "assignee"),
                priority: r["priority"]
                    .as_i64()
                    .and_then(|n| i32::try_from(n).ok())
                    .unwrap_or(0),
                created_at: epoch(&r["created_at"]),
                started_at: epoch(&r["started_at"]),
                completed_at: epoch(&r["completed_at"]),
                problem: text(r, "last_failure_error"),
            })
        })
        .collect();
    tasks.sort_by(|a, b| {
        b.created_at
            .partial_cmp(&a.created_at)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(tasks)
}

/// A board slug the engine's command takes: what it makes itself.
#[must_use]
pub fn slug_ok(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

async fn ask(sup: &Supervisor, args: &[&str]) -> Result<String> {
    let info = sup.info().await?;
    let home = sup.environment().hermes_root();
    let out = sup
        .cli()
        .run(&info.binary, &home, args, sup.limits().cli_timeout)
        .await?;
    if out.code == 0 {
        Ok(out.stdout)
    } else {
        let why: String = out
            .stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .chars()
            .take(300)
            .collect();
        Err(Error::Unavailable(if why.is_empty() {
            "the board could not be read".into()
        } else {
            why
        }))
    }
}

/// Every board (archived ones too: the view says which).
///
/// # Errors
/// What the engine's command says, or that it could not run.
pub async fn boards(sup: &Supervisor) -> Result<Vec<Board>> {
    parse_boards(&ask(sup, &["kanban", "boards", "list", "--all", "--json"]).await?)
}

/// One board with its tasks.
///
/// # Errors
/// `InvalidInput` for a slug the engine does not make, `Unavailable` for what the engine says.
pub async fn view(sup: &Supervisor, slug: &str) -> Result<View> {
    if !slug_ok(slug) {
        return Err(Error::InvalidInput(format!("{slug:?} is not a board name")));
    }
    let all = boards(sup).await?;
    let board = all
        .into_iter()
        .find(|b| b.slug == slug)
        .ok_or_else(|| Error::InvalidInput(format!("there is no board called {slug}")))?;
    let tasks = parse_tasks(&ask(sup, &["kanban", "--board", slug, "list", "--json"]).await?)?;
    Ok(View { board, tasks })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boards_are_read_with_their_counts() {
        let b = parse_boards(r#"[{"slug":"default","name":"Default","counts":{"todo":2,"done":1}},{"slug":"paper-past","archived":true},{"name":"no slug"}]"#).unwrap();
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].counts["todo"], 2);
        assert_eq!(b[1].name, "paper-past");
        assert!(b[1].archived);
        assert!(parse_boards("nope").is_err());
        assert!(parse_boards("{}").is_err());
    }

    #[test]
    fn tasks_are_read_newest_first_with_seconds_or_milliseconds() {
        let t = parse_tasks(r#"[{"id":"t_a","title":"old","status":"done","assignee":"kai","created_at":1700000000,"completed_at":1700000100},{"id":"t_b","title":"new","status":"running","assignee":" ","created_at":1700000500000,"started_at":1700000600,"priority":3,"last_failure_error":"boom"},{"title":"no id"}]"#).unwrap();
        assert_eq!(
            t.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            ["t_b", "t_a"]
        );
        assert_eq!(t[0].created_at, Some(1_700_000_500.0));
        assert_eq!(t[0].assignee, None);
        assert_eq!(t[0].problem.as_deref(), Some("boom"));
        assert_eq!(t[1].assignee.as_deref(), Some("kai"));
        assert_eq!(t[1].completed_at, Some(1_700_000_100.0));
    }

    #[test]
    fn a_slug_is_what_the_engine_makes() {
        for ok in ["default", "paper-past", "a_1"] {
            assert!(slug_ok(ok), "{ok}");
        }
        for bad in ["", "-x", "Paper", "a b", "../x", "x/y"] {
            assert!(!slug_ok(bad), "{bad}");
        }
    }
}
