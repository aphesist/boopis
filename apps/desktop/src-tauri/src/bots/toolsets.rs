//! A bot's toolsets (ADR-0048): the engine toolsets its role needs, set once, and `kanban` for a bot on a board.
//!
//! The engine sends every tool schema of a session's toolsets with every request, so each toolset a bot does not use is paid
//! for on every fresh prompt. boopis switches the toolsets `apps/shared/data/bot-toolsets.json` names on and off once per bot:
//! when it makes the bot, and once for every bot made before (`<root>/boopis/bot-toolsets.json` remembers which), so a toolset
//! the owner switches on later stays on. The change goes through the plugin's `bots.toolsets`, the one place that writes a
//! bot's toolsets: the engine's own `tools enable|disable`, the same for the bot's chats and kanban workers (platform `cli`)
//! and its group-room turns (`api_server`). Toolsets are fixed when a session is created, so a change applies from the bot's
//! next new session.
//!
//! **On a board.** `kanban` goes to a bot on a board: one that a card on a live board is assigned to, or a member of a group
//! whose board exists (the board named like the group, as the group's board view finds it). It is given once, when boopis
//! first finds the bot on a board, and never taken away by boopis. A kanban worker needs none of this: the engine adds the
//! `kanban` tools to the card's session whatever the profile says (`gateway/session_kanban.py`).

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};

/// The defaults, compiled in.
pub const DEFAULT_JSON: &str = include_str!("../../../../shared/data/bot-toolsets.json");

#[derive(Deserialize)]
struct File {
    every_bot: Lists,
    on_a_board: Lists,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Lists {
    on: Vec<Named>,
    off: Vec<Named>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

/// The defaults as names: every bot's on and off, and what a bot on a board gets on top.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Defaults {
    /// Switched on for every bot.
    pub on: Vec<String>,
    /// Switched off for every bot.
    pub off: Vec<String>,
    /// Switched on for a bot on a board.
    pub on_a_board: Vec<String>,
}

/// The defaults (`bot-toolsets.json`); empty lists when the file cannot be read, which a test rules out, so nothing is
/// switched on a list nobody wrote.
#[must_use]
pub fn defaults() -> &'static Defaults {
    static D: OnceLock<Defaults> = OnceLock::new();
    D.get_or_init(|| {
        let names = |l: Vec<Named>| l.into_iter().map(|n| n.name).collect::<Vec<_>>();
        serde_json::from_str::<File>(DEFAULT_JSON)
            .map(|f| Defaults {
                on: names(f.every_bot.on),
                off: names(f.every_bot.off),
                on_a_board: names(f.on_a_board.on),
            })
            .unwrap_or_default()
    })
}

/// What to switch for one bot: `(on, off)`. `defaults` is its first time (the role's lists); `board` is whether it is on a
/// board and has not had `kanban` from boopis yet. Empty when there is nothing to do.
#[must_use]
pub fn switch(defaults: &Defaults, first: bool, board: bool) -> (Vec<String>, Vec<String>) {
    let mut on: BTreeSet<String> = BTreeSet::new();
    let mut off: BTreeSet<String> = BTreeSet::new();
    if first {
        on.extend(defaults.on.iter().cloned());
        off.extend(defaults.off.iter().cloned());
    }
    if board {
        for t in &defaults.on_a_board {
            off.remove(t);
            on.insert(t.clone());
        }
    }
    (on.into_iter().collect(), off.into_iter().collect())
}

/// The bots boopis gave their toolsets (`<root>/boopis/bot-toolsets.json`, boopis's own file): the role's defaults once, and
/// `kanban` once when it found them on a board.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Given {
    /// The schema version.
    pub version: u32,
    /// Bots that had the role's defaults.
    pub defaults: BTreeSet<String>,
    /// Bots that had `kanban` for being on a board.
    pub kanban: BTreeSet<String>,
}

impl Given {
    fn path(root: &Path) -> std::path::PathBuf {
        root.join("boopis").join("bot-toolsets.json")
    }

    /// Read it; a missing or unreadable file gives no bot.
    #[must_use]
    pub fn load(root: &Path) -> Self {
        std::fs::read_to_string(Self::path(root))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Whether the bot `name` still has something coming: its defaults, or `kanban` should it be on a board.
    #[must_use]
    pub fn pending(&self, name: &str) -> bool {
        !self.defaults.contains(name) || !self.kanban.contains(name)
    }

    /// Keep only the bots in `live`.
    pub fn retain(&mut self, live: &[String]) {
        self.defaults.retain(|n| live.contains(n));
        self.kanban.retain(|n| live.contains(n));
    }

    /// Write it atomically (a temporary file, then a rename).
    ///
    /// # Errors
    /// `Io` when the write fails.
    pub fn save(&self, root: &Path) -> Result<()> {
        let path = Self::path(root);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&Self {
            version: 1,
            ..self.clone()
        })
        .map_err(|e| Error::Io(e.to_string()))?;
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }
}

/// The bot `name`'s toolsets were chosen by the owner (a team file): boopis gives it neither its role's defaults nor `kanban`
/// from now on.
///
/// # Errors
/// `Io` when the record cannot be written.
pub fn chosen(root: &Path, name: &str) -> Result<()> {
    let mut given = Given::load(root);
    given.defaults.insert(name.to_owned());
    given.kanban.insert(name.to_owned());
    given.save(root)
}

/// The bots on a board: assigned a card on a live board (`assignees`, per board slug), or members of a group (`groups`, the
/// engine's `groups.list` answer) whose board exists, the board named like the group (`boards`: live slugs and their names).
#[must_use]
pub fn on_boards(
    boards: &[(String, String)],
    assignees: &[String],
    groups: &Value,
) -> BTreeSet<String> {
    let mut out: BTreeSet<String> = assignees
        .iter()
        .filter(|a| !a.is_empty())
        .cloned()
        .collect();
    let rooms = groups.get("rooms").and_then(Value::as_array);
    for room in rooms.into_iter().flatten() {
        if room.get("disbanded_at").is_some_and(|d| !d.is_null()) {
            continue;
        }
        let name = room.get("name").and_then(Value::as_str).unwrap_or("");
        let want = crate::rooms::slug(name);
        let has_board = !want.is_empty()
            && boards
                .iter()
                .any(|(slug, title)| *slug == want || crate::rooms::slug(title) == want);
        if !has_board {
            continue;
        }
        let members = room.get("members").and_then(Value::as_array);
        for m in members.into_iter().flatten() {
            if let Some(p) = m
                .get("profile")
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty())
            {
                out.insert(p.to_owned());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_defaults_read_and_kanban_goes_only_to_a_bot_on_a_board() {
        let d = defaults();
        assert!(
            !d.on.is_empty() && !d.off.is_empty(),
            "bot-toolsets.json must parse"
        );
        for must in ["file", "skills"] {
            assert!(d.on.iter().any(|t| t == must), "{must}");
        }
        assert!(d.off.iter().any(|t| t == "kanban"));
        assert_eq!(d.on_a_board, vec!["kanban".to_owned()]);
        assert!(
            d.on.iter().all(|t| !d.off.contains(t)),
            "a toolset is on or off, never both"
        );
        let (on, off) = switch(d, true, false);
        assert!(off.contains(&"kanban".to_owned()) && !on.contains(&"kanban".to_owned()));
        let (on, off) = switch(d, true, true);
        assert!(on.contains(&"kanban".to_owned()) && !off.contains(&"kanban".to_owned()));
        assert_eq!(switch(d, false, true), (vec!["kanban".to_owned()], vec![]));
        assert_eq!(switch(d, false, false), (vec![], vec![]));
    }

    #[test]
    fn a_bot_is_on_a_board_by_a_card_or_by_a_group_named_like_a_board() {
        let boards = vec![
            ("paper-past".to_owned(), "Paper Past".to_owned()),
            ("ops".to_owned(), "Night Shift".to_owned()),
        ];
        let groups = json!({"rooms": [
            {"name": "paper past", "members": [{"profile": "kai"}, {"profile": "nina"}]},
            {"name": "paper past qa", "members": [{"profile": "kai"}, {"profile": "mira"}]},
            {"name": "Night Shift!", "members": [{"profile": "hex"}]},
            {"name": "ops", "disbanded_at": 1.0, "members": [{"profile": "moss"}]},
        ]});
        let on = on_boards(&boards, &["mira".to_owned(), String::new()], &groups);
        assert_eq!(
            on.into_iter().collect::<Vec<_>>(),
            ["hex", "kai", "mira", "nina"],
            "mira by her card, hex by the board's name, moss's group is disbanded"
        );
        assert!(on_boards(&[], &[], &json!({})).is_empty());
    }

    #[test]
    fn the_record_keeps_live_bots_only() {
        let tmp = tempfile::tempdir().unwrap();
        let mut g = Given::load(tmp.path());
        assert!(g.pending("kai"));
        g.defaults.insert("kai".into());
        g.kanban.insert("kai".into());
        g.defaults.insert("gone".into());
        assert!(!g.pending("kai"));
        g.retain(&["kai".to_owned()]);
        g.save(tmp.path()).unwrap();
        let back = Given::load(tmp.path());
        assert_eq!(back.defaults.len(), 1);
        assert_eq!(back.version, 1);
    }
}
