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
    /// A kanban worker running one of the board's tasks (a process of its own, seen through the profile's sessions).
    Kanban,
    /// Anything else the engine runs (the command line, another program).
    Other,
}

/// The kind of a session from what the engine says of it: its `source`. A session started through this API is the app's
/// own kind (`gui`): where a conversation was started is never told apart.
#[must_use]
pub fn source_of(engine_source: &str) -> Source {
    match engine_source.trim().to_ascii_lowercase().as_str() {
        "gui" | "desktop" => Source::Gui,
        "cron" | "scheduled" => Source::Cron,
        "bot_room" | "room" | "hosted_room" | "group" => Source::Room,
        "kanban" => Source::Kanban,
        _ => Source::Other,
    }
}

/// How far a running tool says it has come (0.2.0): exactly what it reported (an MCP server's progress notification, as
/// the engine relays it in `tool.progress`), never an estimate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    /// How much is done, from 0 to 1, when the tool said out of how much; null otherwise.
    pub fraction: Option<f64>,
    /// How far it is, in the tool's own count (the step it is on, the items or bytes it has done).
    pub step: f64,
    /// Out of how much, when the tool said; null otherwise.
    pub of: Option<f64>,
    /// What it is doing, in its own words, scrubbed and cut; null when it said nothing.
    pub label: Option<String>,
}

/// One bot's presence: what it is doing now, and where that is happening.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Presence {
    /// The bot's profile name.
    pub profile: String,
    /// The orb2 word.
    pub state: State,
    /// What it is doing in a few words (a tool's name); empty when nothing says.
    pub activity: String,
    /// What the running tool touches, in a few safe words ("Read a file · shots/03.json"): a file's last two parts, a
    /// command's program and subcommand, a page's host, never more; scrubbed and capped. Null when the tool names none of
    /// these, and when no tool runs (0.2.0).
    pub detail: Option<String>,
    /// How far the running tool says it has come, when it reports it; null otherwise (0.2.0).
    pub progress: Option<Progress>,
    /// `approval` or `input` while the bot waits for the owner, else null.
    pub attention: Option<String>,
    /// The session the state comes from.
    pub session_id: Option<String>,
    /// Where that session came from; null when no session is behind the state (idle, sleeping).
    pub source: Option<Source>,
    /// What the running session is about: its title as the engine keeps it, else the first line of what it was asked; null
    /// when the engine says neither, and while idle.
    pub summary: Option<String>,
    /// How many tool steps the running turn has taken, counted from the turn's own events; null where only a poll sees the
    /// turn (it cannot count them), and while idle.
    pub steps: Option<u32>,
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
            detail: None,
            progress: None,
            attention: None,
            session_id: None,
            source: None,
            summary: None,
            steps: None,
            at,
        }
    }
}

/// One bot of the roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// A member of a room addressed the owner (`@user`, the engine's name for the human: `rooms/mentions.rs`).
    Mention,
    /// A kanban task the bot was running finished (its summary is the body).
    Task,
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
    /// For a room's message (a reply, a mention, a failed turn): its place in the room's log, to read it whole with
    /// `GET /v1/rooms/<id>/log` (0.2.0).
    pub seq: Option<u64>,
    /// For a room's message: its event id in the room's log (0.2.0).
    pub message_id: Option<String>,
    /// For a scheduled run: when the job runs next, in milliseconds since the epoch, as the engine's scheduler has it;
    /// null when it will not run again (paused, or done repeating) or the engine does not say (0.2.0).
    pub next_run_at: Option<i64>,
    /// The kind of session it came from.
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

/// Where an answer came from: the surface it came through. Never a name: the contract does not tell clients apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answered {
    /// `gui` (the app's own window) or `endpoint` (this API).
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

/// Who said a message of a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// The owner, from the app or through this API: never told apart.
    User,
    /// The bot.
    Assistant,
}

/// Whether a message may still grow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageState {
    /// The reply is being written: `text` is what there is so far.
    Streaming,
    /// Finished.
    Done,
}

/// One message of a conversation: the words the app shows, and nothing else (no tool row, no reasoning).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    /// Stable for the message in an event stream (`l<n>`); `r<row>` for a stored one.
    pub id: String,
    /// Who said it.
    pub role: Role,
    /// The text, scrubbed and cut to the message cap; line breaks are kept.
    pub text: String,
    /// Whether the text was cut.
    pub truncated: bool,
    /// When, in milliseconds since the epoch (0 when the engine gave no time).
    pub at: i64,
    /// Whether it may still grow.
    pub state: MessageState,
}

/// A message was added to a conversation, or a reply grew or finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationMessage {
    /// The bot.
    pub profile: String,
    /// The conversation: the stored id (what `say` returns) once the host has seen the session listed, else the engine's
    /// live id.
    pub session_id: String,
    /// The message; an id seen again replaces the earlier text.
    pub message: Message,
}

/// A conversation as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conversation {
    /// The bot.
    pub profile: String,
    /// The stored session's id.
    pub session_id: String,
    /// Oldest first: the user's and the bot's words.
    pub messages: Vec<Message>,
    /// Whether the conversation holds older rows than these.
    pub older: bool,
    /// The feed's last event id before the read, to follow from.
    pub last_event_id: u64,
}

/// Who a room line is from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineFrom {
    /// The owner, from any client.
    User,
    /// A member of the room.
    Member,
    /// boopis, saying what happened (a turn failed or was cancelled, a stop, a pause).
    Boopis,
}

/// One line of a room's log, as `boopis groups log` prints it and the app's room draws it (`rooms/lines.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomLine {
    /// Its place in the room's log (the engine's `seq`).
    pub seq: u64,
    /// Its event id in the room's log (0.2.0).
    pub id: String,
    /// When, in milliseconds since the epoch.
    pub at: i64,
    /// The engine's event kind (`message.user`, `message.member`, `turn.failed`, `turn.cancelled`, ...).
    pub kind: String,
    /// Who it is from.
    pub from: LineFrom,
    /// The member it is from, or the member a boopis line is about; null otherwise.
    pub member: Option<String>,
    /// That member's name as people read it; empty when there is no member.
    pub name: String,
    /// The text, scrubbed, line breaks kept, cut to the message cap.
    pub text: String,
    /// Whether the text was cut.
    pub truncated: bool,
    /// Whether a member's message addresses the owner (`@user`, by the engine's own rule).
    pub mentions_you: bool,
}

/// A room's log, read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoomLog {
    /// The room.
    pub room_id: String,
    /// Its name.
    pub name: String,
    /// The lines, oldest first.
    pub lines: Vec<RoomLine>,
    /// The newest event in the room's log (read on from here with `after`).
    pub latest_seq: u64,
    /// Whether more events follow the last one read.
    pub more: bool,
    /// The members at work now.
    pub working: Vec<String>,
    /// The messages the room holds until its members finish (`rooms/hold.rs`).
    pub held: Vec<crate::rooms::hold::Held>,
    /// The feed's last event id before the read, to follow from.
    pub last_event_id: u64,
}

/// A line added to a room's log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomLineEvent {
    /// The room.
    pub room_id: String,
    /// The line.
    pub line: RoomLine,
}

/// Who is at work in a room now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomStateEvent {
    /// The room.
    pub room_id: String,
    /// The members at work.
    pub working: Vec<String>,
}

/// The messages a room holds now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoomHeldEvent {
    /// The room.
    pub room_id: String,
    /// Held, oldest first (empty: nothing waits any more).
    pub held: Vec<crate::rooms::hold::Held>,
}

/// The events of the feed. Each is stamped by the feed with a counter and the time.
#[allow(clippy::large_enum_variant)] // an event is built once and shared behind an `Arc`; boxing buys nothing
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// A message was added to a conversation, or a reply grew or finished. Only to streams that asked for conversations.
    #[serde(rename = "conversation.message")]
    Conversation(ConversationMessage),
    /// A line was added to a room's log. Only to streams that asked for rooms.
    #[serde(rename = "room.line")]
    RoomLine(RoomLineEvent),
    /// Who is at work in a room changed. Only to streams that asked for rooms.
    #[serde(rename = "room.state")]
    RoomState(RoomStateEvent),
    /// The messages a room holds changed (one was held, sent or taken back). Only to streams that asked for rooms.
    #[serde(rename = "room.held")]
    RoomHeld(RoomHeldEvent),
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
            Self::Conversation(_) => "conversation.message",
            Self::RoomLine(_) => "room.line",
            Self::RoomState(_) => "room.state",
            Self::RoomHeld(_) => "room.held",
            Self::Lagged { .. } => "lagged",
        }
    }
}

/// An event with its place in the feed.
#[derive(Debug, Clone, PartialEq, Serialize)]
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
            State::Idle,
            State::Listening,
            State::Thinking,
            State::Working,
            State::Compute,
            State::Speaking,
            State::Needs,
            State::Done,
            State::Error,
            State::Sleeping,
        ]
        .iter()
        .map(|s| {
            serde_json::to_value(s)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
        assert_eq!(
            words,
            [
                "idle",
                "listening",
                "thinking",
                "working",
                "compute",
                "speaking",
                "needs",
                "done",
                "error",
                "sleeping"
            ]
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
    fn a_session_is_told_by_its_engine_source_alone() {
        assert_eq!(source_of("gui"), Source::Gui);
        assert_eq!(source_of("cron"), Source::Cron);
        assert_eq!(source_of("bot_room"), Source::Room);
        assert_eq!(source_of("cli"), Source::Other);
        assert_eq!(source_of("kanban"), Source::Kanban, "B31");
        assert_eq!(source_of("acp"), Source::Other);
    }

    #[test]
    fn an_event_is_flat_on_the_wire() {
        let s = Stamped {
            id: 7,
            at: 1,
            event: Event::BotsChanged {
                names: vec!["kai".into()],
            },
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], 7);
        assert_eq!(v["type"], "bots.changed");
        assert_eq!(v["data"]["names"][0], "kai");
    }
}
