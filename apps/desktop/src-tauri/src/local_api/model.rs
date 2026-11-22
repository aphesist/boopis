//! The contract's values (`docs/LOCAL-API.md`, version 1). Every field is chosen one by one: no engine object is ever
//! forwarded, and no type here can hold a ticket, a token or a key. A new field is a decision, not a convenience.

use serde::{Deserialize, Serialize};

use super::look::Look;

/// The contract's version: it changes only when a field's meaning does; a new field is not a new version.
pub const API_VERSION: u32 = 1;

/// How a bot looks to a person, in orb2's own words (`design-system`: idle listening thinking working compute speaking
/// needs done error sleeping).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Nothing is happening.
    Idle,
    /// A message was delivered and the bot has not begun.
    Listening,
    /// Reasoning, before any word or tool.
    Thinking,
    /// Using a tool.
    Working,
    /// Running code (the `exec` kernel or a terminal).
    Compute,
    /// Writing the reply.
    Speaking,
    /// Waiting for the owner (an approval or a question).
    Needs,
    /// A turn just finished.
    Done,
    /// A turn failed.
    Error,
    /// Paused by the owner.
    Sleeping,
}

impl State {
    /// How much a state matters when one bot has several sessions: the highest is the bot's.
    #[must_use]
    pub fn rank(self) -> u8 {
        match self {
            Self::Needs => 9,
            Self::Error => 8,
            Self::Speaking => 7,
            Self::Compute => 6,
            Self::Working => 5,
            Self::Thinking => 4,
            Self::Listening => 3,
            Self::Done => 2,
            Self::Idle => 1,
            Self::Sleeping => 0,
        }
    }

    /// Whether the bot is busy (a turn is under way).
    #[must_use]
    pub fn busy(self) -> bool {
        matches!(
            self,
            Self::Listening | Self::Thinking | Self::Working | Self::Compute | Self::Speaking
        )
    }
}

/// Where a session came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// The boopis window.
    Gui,
    /// A scheduled run.
    Cron,
    /// A turn in a team room.
    Room,
    /// The owner's island.
    Island,
    /// Another client (the command line, another extension).
    Other,
}

/// A client's self-declared name: lowercase letters, digits, `.`, `_`, `-`, starting with a letter or digit, at most 64
/// characters (the engine's own rule for a session's `client`). A label, never an identity.
#[must_use]
pub fn valid_client_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 64
        && name.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
        })
}

/// The island's own label.
pub const ISLAND_CLIENT: &str = "panacea-island";

/// The source word of a session from what the engine says of it: its `source` and the creating client's label.
#[must_use]
pub fn source_of(engine_source: &str, client: Option<&str>) -> Source {
    if client.is_some_and(|c| c == ISLAND_CLIENT || c.starts_with("panacea-")) {
        return Source::Island;
    }
    match engine_source.trim().to_ascii_lowercase().as_str() {
        "gui" | "desktop" => Source::Gui,
        "cron" | "scheduled" => Source::Cron,
        "bot_room" | "room" | "hosted_room" | "group" => Source::Room,
        _ => Source::Other,
    }
}

/// One bot's presence: what it is doing now, and where that is happening.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Presence {
    /// The bot's profile name.
    pub profile: String,
    /// The orb2 word.
    pub state: State,
    /// What it is doing in a few words (a tool's name); empty when nothing says.
    pub activity: String,
    /// `approval` or `input` while the bot waits for the owner, else null.
    pub attention: Option<String>,
    /// The session the state comes from.
    pub session_id: Option<String>,
    /// Where that session came from.
    pub source: Source,
    /// The creating client's label, when it declared one.
    pub client: Option<String>,
    /// When the state began, in milliseconds since the epoch.
    pub at: i64,
}

impl Presence {
    /// The row of a bot with nothing going on.
    #[must_use]
    pub fn idle(profile: &str, at: i64) -> Self {
        Self {
            profile: profile.to_owned(),
            state: State::Idle,
            activity: String::new(),
            attention: None,
            session_id: None,
            source: Source::Gui,
            client: None,
            at,
        }
    }
}

/// One bot of the roster.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotRow {
    /// The profile name (the bot's id everywhere).
    pub name: String,
    /// The name a person reads: the display name, else the profile name.
    pub display_name: String,
    /// What the bot is for, as its owner wrote it.
    pub role: String,
    /// The model, as `provider/model` when the engine names both, else the model alone; null when it names none.
    pub model: Option<String>,
    /// The provider, null when unknown.
    pub provider: Option<String>,
    /// The look the owner chose, or the default for the name.
    pub look: Look,
    /// Whether boopis has a record of its own for this bot (a bot made outside boopis has none).
    pub known_to_boopis: bool,
    /// What it is doing now.
    pub presence: Presence,
}

/// A room of the roster.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomRow {
    /// The room's id.
    pub id: String,
    /// Its name.
    pub name: String,
    /// The profile names seated in it.
    pub members: Vec<String>,
}

/// What kind of thing a notification is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum NoteKind {
    /// A bot needs an approval.
    Approval,
    /// A bot finished a turn in a session the boopis window does not run.
    Reply,
    /// A scheduled run finished.
    Cron,
    /// A turn failed.
    Error,
}

/// "A bot did something you should see."
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notification {
    /// A counter, unique for the run of the app.
    pub id: u64,
    /// What it is about.
    pub kind: NoteKind,
    /// The bot.
    pub profile: String,
    /// A short line.
    pub title: String,
    /// The text, scrubbed and cut.
    pub body: String,
    /// The session it belongs to, when there is one.
    pub session_id: Option<String>,
    /// The room it belongs to, when there is one.
    pub room_id: Option<String>,
    /// Where the session came from, so a client can leave out what it already shows.
    pub source: Source,
    /// When, in milliseconds since the epoch.
    pub at: i64,
    /// Whether it should interrupt (an approval does).
    pub urgent: bool,
}

/// Where an approval stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    /// Waiting for an answer.
    Pending,
    /// An answer is on its way to the engine.
    Answering,
    /// Answered.
    Settled,
    /// The time ran out, or the engine no longer holds it.
    Expired,
}

/// Who gave an answer: a label and the surface it came through.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answered {
    /// The client's self-declared label (`boopis` for the window).
    pub client: String,
    /// `gui`, `endpoint` or `cli`.
    pub surface: String,
    /// What was chosen, when known (`once`, `deny`).
    pub choice: Option<String>,
    /// When, in milliseconds since the epoch.
    pub at: i64,
}

/// What asked.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Origin {
    /// The model of the session, when known.
    pub model: Option<String>,
    /// The tool that wants approval.
    pub tool: Option<String>,
}

/// One approval the engine asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    /// The prompt's id (the key everywhere).
    pub id: String,
    /// The bot.
    pub profile: String,
    /// The session.
    pub session_id: String,
    /// The prompt's id, as the engine names it (the same as `id`).
    pub prompt_id: String,
    /// The execution this prompt belongs to; an answer must name it.
    pub execution_generation: u64,
    /// What it wants to do, scrubbed.
    pub command: String,
    /// Why, scrubbed.
    pub description: String,
    /// The choices the engine offered.
    pub choices: Vec<String>,
    /// The choices boopis accepts from outside its window (`once`, `deny`).
    pub answerable_with: Vec<String>,
    /// How long the engine waits, in seconds.
    pub timeout_s: Option<u64>,
    /// What asked.
    pub origin: Origin,
    /// Whether the bot runs governed.
    pub governed: bool,
    /// Where it stands.
    pub state: ApprovalState,
    /// Who answered, once someone has.
    pub answered_by: Option<Answered>,
    /// When it was asked, in milliseconds since the epoch.
    pub asked_at: i64,
}

/// The events of the feed. Each is stamped by the feed with a counter and the time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum Event {
    /// The first event of a stream: the contract and the counter.
    #[serde(rename = "hello")]
    Hello {
        /// The contract's version.
        version: u32,
    },
    /// A look, a name, a model or the set of bots changed; read `GET /v1/bots`.
    #[serde(rename = "bots.changed")]
    BotsChanged {
        /// The bots whose row moved (empty: the set moved).
        names: Vec<String>,
    },
    /// One bot's presence changed.
    #[serde(rename = "bots.presence")]
    Presence(Presence),
    /// A notification.
    #[serde(rename = "notifications.new")]
    Notification(Notification),
    /// An approval appeared or moved.
    #[serde(rename = "approvals.changed")]
    Approvals(Approval),
    /// The stream fell behind and events were dropped: read the snapshots again.
    #[serde(rename = "lagged")]
    Lagged {
        /// How many were dropped.
        skipped: u64,
    },
}

impl Event {
    /// The event's type name, as it is on the wire.
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Hello { .. } => "hello",
            Self::BotsChanged { .. } => "bots.changed",
            Self::Presence(_) => "bots.presence",
            Self::Notification(_) => "notifications.new",
            Self::Approvals(_) => "approvals.changed",
            Self::Lagged { .. } => "lagged",
        }
    }
}

/// An event with its place in the feed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stamped {
    /// A counter, rising by one with each event of the run (`Last-Event-ID` resumes after it).
    pub id: u64,
    /// When, in milliseconds since the epoch.
    pub at: i64,
    /// The event.
    #[serde(flatten)]
    pub event: Event,
}

/// The current time in milliseconds since the epoch.
#[must_use]
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_use_the_design_systems_words() {
        let words: Vec<String> = [
            State::Idle, State::Listening, State::Thinking, State::Working, State::Compute,
            State::Speaking, State::Needs, State::Done, State::Error, State::Sleeping,
        ]
        .iter()
        .map(|s| serde_json::to_value(s).unwrap().as_str().unwrap().to_owned())
        .collect();
        assert_eq!(
            words,
            ["idle", "listening", "thinking", "working", "compute", "speaking", "needs", "done", "error", "sleeping"]
        );
    }

    #[test]
    fn needs_outranks_everything_a_bot_does() {
        assert!(State::Needs.rank() > State::Error.rank());
        assert!(State::Error.rank() > State::Speaking.rank());
        assert!(State::Speaking.rank() > State::Idle.rank());
        assert!(State::Working.busy() && !State::Done.busy() && !State::Needs.busy());
    }

    #[test]
    fn a_session_is_told_apart_by_its_client_before_its_source() {
        assert_eq!(source_of("cli", Some("panacea-island")), Source::Island);
        assert_eq!(source_of("gui", None), Source::Gui);
        assert_eq!(source_of("cron", None), Source::Cron);
        assert_eq!(source_of("bot_room", None), Source::Room);
        assert_eq!(source_of("acp", Some("some-tool")), Source::Other);
    }

    #[test]
    fn client_names_follow_the_engines_rule() {
        assert!(valid_client_name("panacea-island") && valid_client_name("a") && valid_client_name("x.y_z-1"));
        for bad in ["", "-x", "Panacea", "has space", "a/b", &"a".repeat(65)] {
            assert!(!valid_client_name(bad), "{bad}");
        }
    }

    #[test]
    fn an_event_is_flat_on_the_wire() {
        let s = Stamped {
            id: 7,
            at: 1,
            event: Event::BotsChanged { names: vec!["kai".into()] },
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], 7);
        assert_eq!(v["type"], "bots.changed");
        assert_eq!(v["data"]["names"][0], "kai");
    }
}
