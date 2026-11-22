//! The team file: one YAML document that holds a whole team (bots, rooms, boards, cron jobs). `docs/CLI.md` documents it and
//! `docs/team.schema.json` is its schema; this is the reader that checks it. Everything in it is untrusted: every problem is
//! found and listed before anything is changed.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// The version this build reads and writes.
pub const VERSION: u32 = 1;

/// The shapes a bot's orb can have (the app's `SHAPES`, `ui/src/data/looks.ts`; a test keeps the two lists one).
pub const SHAPES: &[&str] = &[
    "circle", "squircle", "soft", "wide", "tall", "bean", "drop", "ghost", "triangle", "hexagon",
    "diamond", "cloud", "clover", "flower", "star",
];

/// A whole team.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Team {
    /// The format's version (1).
    pub version: u32,
    /// What the team is called (a label; nothing reads it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The bots, by name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub bots: BTreeMap<String, Bot>,
    /// The group rooms, by name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rooms: BTreeMap<String, Room>,
    /// The kanban boards, by slug.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub boards: BTreeMap<String, Board>,
    /// The scheduled jobs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cron: Vec<Cron>,
}

/// One bot.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bot {
    /// What the bot is for (its description).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// A file with its instructions (SOUL.md), relative to the team file. Read when the file is loaded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soul: Option<String>,
    /// Its instructions, written in the file. Export writes this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soul_text: Option<String>,
    /// Its model, as the Bots form names it (`opus`, or `provider/model`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Its orb.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub look: Option<Look>,
    /// Skills it must have, by name. They are checked, and switched on when they are off; a skill the bot does not have is
    /// reported (installing is the store's job).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<String>,
    /// MCP servers it must have.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connectors: Vec<Connector>,
    /// Its Governed switch (off when not said, for a new bot).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub governed: Option<bool>,
    /// The most turns `boopis run --bot` lets one task take with this bot: the engine's goal budget (`goals.max_turns`) in the
    /// bot's own configuration. Not said: left as it is (a new bot has none, so the default applies).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
}

/// An orb.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Look {
    /// One of [`SHAPES`].
    pub shape: String,
    /// `#rrggbb`.
    pub color: String,
}

/// An MCP server for one bot.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connector {
    /// Its name in the bot's configuration.
    pub name: String,
    /// The program of a local server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Its arguments.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Plain environment variables. Never a key: keys belong in Settings > Connectors, which keeps them in the keychain.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// The address of a remote server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// A group room.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Room {
    /// Its id, when the room already exists under one (otherwise `g-<name>` is used for a new one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Who sits in it, two to six bots. A room's roster is frozen when it is made.
    pub members: Vec<String>,
    /// Who answers a message that names nobody.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead: Option<String>,
    /// What the room is for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// A file with the purpose, relative to the team file. Read when the file is loaded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose_file: Option<String>,
    /// The most rounds `boopis run` lets a discussion take in this room.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_rounds: Option<u32>,
}

/// A kanban board.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Board {
    /// The name shown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The folder its tasks work in (`~` is the home folder).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
}

/// A scheduled job of one bot.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cron {
    /// The bot that runs it.
    pub bot: String,
    /// Its name (unique for the bot).
    pub name: String,
    /// When: a cron expression, `every 2h`, or a delay.
    pub schedule: String,
    /// What it asks the bot to do.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// A file with the prompt, relative to the team file. Read when the file is loaded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_file: Option<String>,
    /// A room (by name) its result is posted to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    /// Who it posts as in that room (the job's bot when not said).
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub post_as: Option<String>,
    /// A delivery target as the engine writes it, for one that is not a room of this file (`local`, `room:<id>@<bot>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliver: Option<String>,
    /// Paused until the owner resumes it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub paused: bool,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde's skip_serializing_if hands a reference
fn is_false(b: &bool) -> bool {
    !*b
}

/// Everything wrong with a file, one line each, each naming where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecError(pub Vec<String>);

impl std::fmt::Display for SpecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0.join("\n"))
    }
}

impl Team {
    /// Read a team from YAML text. `base` is the folder the file's own paths (`soul`, `purpose_file`, `prompt_file`) are
    /// relative to; those files are read here and kept as text, so a team is one value from then on.
    ///
    /// # Errors
    /// Every problem found, listed.
    pub fn parse(text: &str, base: &Path) -> Result<Self, SpecError> {
        let mut team: Self = serde_norway::from_str(text)
            .map_err(|e| SpecError(vec![format!("the file is not a team: {e}")]))?;
        let mut problems = Vec::new();
        team.load_files(base, &mut problems);
        problems.extend(team.check());
        if problems.is_empty() {
            Ok(team)
        } else {
            Err(SpecError(problems))
        }
    }

    fn load_files(&mut self, base: &Path, problems: &mut Vec<String>) {
        let mut read = |what: String, file: &Option<String>, text: &mut Option<String>| {
            let Some(f) = file else { return };
            if text.is_some() {
                problems.push(format!("{what}: give the text or the file, not both"));
                return;
            }
            match read_inside(base, f) {
                Ok(t) => *text = Some(t),
                Err(e) => problems.push(format!("{what}: {e}")),
            }
        };
        for (n, b) in &mut self.bots {
            let file = b.soul.take();
            read(format!("bots.{n}.soul"), &file, &mut b.soul_text);
        }
        for (n, r) in &mut self.rooms {
            let file = r.purpose_file.take();
            read(format!("rooms.{n}.purpose_file"), &file, &mut r.purpose);
        }
        for (i, c) in self.cron.iter_mut().enumerate() {
            let file = c.prompt_file.take();
            read(format!("cron[{i}].prompt_file"), &file, &mut c.prompt);
        }
    }

    /// The problems with what is written (not with the files).
    #[must_use]
    #[allow(clippy::too_many_lines)] // one check per field of the file
    pub fn check(&self) -> Vec<String> {
        let mut p = Vec::new();
        if self.version != VERSION {
            p.push(format!(
                "version: this build reads version {VERSION}, the file says {}",
                self.version
            ));
        }
        for (n, b) in &self.bots {
            if crate::bots::check_name(n).is_err() {
                p.push(format!("bots.{n}: not a bot's name (lower case letters, digits, '-' and '_', and not 'default')"));
            }
            if let Some(l) = &b.look {
                if !SHAPES.contains(&l.shape.as_str()) {
                    p.push(format!(
                        "bots.{n}.look.shape: {:?} is not a shape (one of {})",
                        l.shape,
                        SHAPES.join(", ")
                    ));
                }
                if !is_color(&l.color) {
                    p.push(format!(
                        "bots.{n}.look.color: {:?} is not a colour like #4fc9a8",
                        l.color
                    ));
                }
            }
            if b.model.as_ref().is_some_and(|m| m.trim().is_empty()) {
                p.push(format!("bots.{n}.model: empty"));
            }
            if let Some(t) = b.max_turns
                && crate::bots::limit::check_turns(t).is_err()
            {
                p.push(format!(
                    "bots.{n}.max_turns: 1 to {}",
                    crate::bots::limit::LIMIT_MAX_TURNS
                ));
            }
            let mut seen = BTreeSet::new();
            for (i, c) in b.connectors.iter().enumerate() {
                let at = format!("bots.{n}.connectors[{i}]");
                if c.name.is_empty()
                    || !c.name.chars().all(|ch| {
                        ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_'
                    })
                {
                    p.push(format!(
                        "{at}.name: lower case letters, digits, '-' and '_'"
                    ));
                }
                if !seen.insert(&c.name) {
                    p.push(format!("{at}.name: {:?} is listed twice", c.name));
                }
                match (&c.command, &c.url) {
                    (Some(_), Some(_)) => {
                        p.push(format!("{at}: give a command or a url, not both"));
                    }
                    (None, None) => p.push(format!("{at}: give a command or a url")),
                    (Some(cmd), None) if cmd.trim().is_empty() => {
                        p.push(format!("{at}.command: empty"));
                    }
                    (None, Some(u))
                        if !(u.starts_with("https://")
                            || u.starts_with("http://127.0.0.1")
                            || u.starts_with("http://localhost")) =>
                    {
                        p.push(format!("{at}.url: use https (or a local address)"));
                    }
                    _ => {}
                }
                if c.url.is_some() && (!c.args.is_empty() || !c.env.is_empty()) {
                    p.push(format!("{at}: a url server takes no args or env"));
                }
            }
        }
        for (n, r) in &self.rooms {
            let at = format!("rooms.{n}");
            if n.trim().is_empty() {
                p.push("rooms: a room needs a name".to_owned());
            }
            if !(crate::rooms::MIN_MEMBERS..=crate::rooms::MAX_MEMBERS).contains(&r.members.len()) {
                p.push(format!(
                    "{at}.members: {} to {} bots, not {}",
                    crate::rooms::MIN_MEMBERS,
                    crate::rooms::MAX_MEMBERS,
                    r.members.len()
                ));
            }
            let mut seen = BTreeSet::new();
            for m in &r.members {
                if !seen.insert(m) {
                    p.push(format!("{at}.members: {m} is listed twice"));
                }
            }
            if let Some(l) = &r.lead
                && !r.members.contains(l)
            {
                p.push(format!("{at}.lead: {l} is not one of the room's members"));
            }
            if let Some(n) = r.max_rounds
                && crate::rooms::settings::check_rounds(n).is_err()
            {
                p.push(format!(
                    "{at}.max_rounds: 1 to {}",
                    crate::rooms::settings::LIMIT_MAX_ROUNDS
                ));
            }
            if let Some(id) = &r.id
                && !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                p.push(format!("{at}.id: letters, digits, '-' and '_'"));
            }
        }
        for (slug, b) in &self.boards {
            let ok = !slug.is_empty()
                && slug.len() <= 63
                && slug.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                && slug
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !ok {
                p.push(format!(
                    "boards.{slug}: a slug is lower case letters, digits and '-'"
                ));
            }
            if let Some(w) = &b.workdir
                && !(w.starts_with('/') || w.starts_with("~/") || w == "~" || is_windows_path(w))
            {
                p.push(format!(
                    "boards.{slug}.workdir: an absolute path, or one starting with ~/"
                ));
            }
        }
        let mut jobs = BTreeSet::new();
        for (i, c) in self.cron.iter().enumerate() {
            let at = format!("cron[{i}]");
            if crate::bots::check_name(&c.bot).is_err() {
                p.push(format!("{at}.bot: {:?} is not a bot's name", c.bot));
            }
            if c.name.trim().is_empty() {
                p.push(format!("{at}.name: empty"));
            }
            if !jobs.insert((&c.bot, c.name.trim())) {
                p.push(format!(
                    "{at}.name: {} already has a job called {:?}",
                    c.bot, c.name
                ));
            }
            if c.schedule.trim().is_empty() {
                p.push(format!("{at}.schedule: empty"));
            }
            if c.prompt.as_ref().is_none_or(|t| t.trim().is_empty()) {
                p.push(format!("{at}.prompt: what the job asks the bot to do"));
            }
            if c.room.is_some() && c.deliver.is_some() {
                p.push(format!("{at}: give a room or a deliver target, not both"));
            }
            if c.post_as.is_some() && c.room.is_none() {
                p.push(format!("{at}.as: only with a room"));
            }
        }
        p
    }

    /// The text of a bot's instructions, when the file gives them.
    #[must_use]
    pub fn soul_of(&self, bot: &str) -> Option<&str> {
        self.bots.get(bot).and_then(|b| b.soul_text.as_deref())
    }

    /// The file as YAML (what `team export` writes), under a header that says what it is.
    ///
    /// # Errors
    /// `SpecError` when it cannot be written (it never fails for a team that was read or exported).
    pub fn to_yaml(&self) -> Result<String, SpecError> {
        let body = serde_norway::to_string(self).map_err(|e| SpecError(vec![e.to_string()]))?;
        Ok(format!(
            "# A boopis team: `boopis team apply <this file>` makes it, `boopis team export` writes it. See docs/CLI.md.\n{body}"
        ))
    }
}

fn is_windows_path(w: &str) -> bool {
    let b = w.as_bytes();
    b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

/// Whether `c` is a `#rrggbb` colour.
#[must_use]
pub fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit())
}

/// Read a file the team names, inside the team file's own folder (or below it): an absolute path or `..` is refused, so a
/// file shared from elsewhere cannot make `apply` read an arbitrary file into a bot's instructions.
fn read_inside(base: &Path, rel: &str) -> Result<String, String> {
    let p = Path::new(rel);
    if p.is_absolute()
        || p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!(
            "{rel:?} must be a path inside the team file's folder"
        ));
    }
    let full = base.join(p);
    let meta = std::fs::metadata(&full).map_err(|e| format!("{rel}: {e}"))?;
    if meta.len() > 1_000_000 {
        return Err(format!("{rel}: larger than 1 MB"));
    }
    std::fs::read_to_string(&full).map_err(|e| format!("{rel}: {e}"))
}
