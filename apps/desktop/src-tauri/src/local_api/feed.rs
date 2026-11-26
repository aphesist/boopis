//! The feed: the one place the local API's state lives and its events are made (`ADR-0045`). It holds the roster, every
//! bot's presence, the notifications and the approvals inbox, stamps each event with a counter, keeps the last few for a
//! stream that resumes, and broadcasts them. It does no I/O: the service tells it what the engine said and asks it what
//! to say next, so every rule here is tested with scripted frames.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::Value;
use tokio::sync::{broadcast, watch};

use super::approvals::{Delivery, Inbox, Refusal};
use super::audit::{Audit, Line};
use super::model::{
    Answered, Approval, ApprovalState, BotRow, ConversationMessage, Event, LineFrom, Message,
    MessageState, NoteKind, Notification, Origin, Presence, Progress, Role, RoomHeldEvent,
    RoomLine, RoomLineEvent, RoomRow, RoomStateEvent, Source, Stamped, State, now_ms,
};
use super::presence::{Facts, Live, Table};
use super::roster::{self, Entry};
use super::scrub;
use crate::config::ApiLimits;
use crate::gateway::{Direction, FeedFrame};

/// What the feed remembers of a session it did not create.
#[derive(Debug, Clone, Default)]
struct Meta {
    source: Option<Source>,
    /// The stored session id (what `say` returns), when known.
    stored: Option<String>,
    model: Option<String>,
    /// Whether the host's own link carries the session's events (then a push of the plugin's adds nothing).
    linked: bool,
}

/// A push for a session the poll has not listed yet (B45): applied when it does, if it is still fresh.
#[derive(Debug, Clone)]
struct PendingPush {
    event: &'static str,
    tool: Option<String>,
    detail: Option<String>,
    call: Option<String>,
    failed: bool,
    at: i64,
}

/// A reply that is being written, as the app's own conversation shows it.
struct Reply {
    id: String,
    text: String,
    at: i64,
    last_sent: i64,
    dirty: bool,
}

struct Inner {
    seq: u64,
    msg_seq: u64,
    replies: HashMap<(String, String), Reply>,
    note_seq: u64,
    ring: VecDeque<Arc<Stamped>>,
    presence: Table,
    inbox: Inbox,
    notes: VecDeque<Notification>,
    roster: Vec<Entry>,
    rooms: Vec<RoomRow>,
    meta: HashMap<(String, String), Meta>,
    gui_answers: HashMap<(String, String), (String, i64)>,
    last_note: HashMap<(String, String, u8), i64>,
    /// Who was last said to be at work in each room (a `room.state` goes out when it changes).
    room_working: HashMap<String, Vec<String>>,
    /// Pushes for sessions the poll has not listed yet (B45).
    pending: HashMap<(String, String), PendingPush>,
    /// The session the plugin last pushed for each scheduled job, by `(profile, job id)` (B45).
    cron_runs: HashMap<(String, String), String>,
}

/// Where a notification belongs: a session, or a room's message.
#[derive(Debug, Clone, Copy, Default)]
struct Where<'a> {
    session_id: Option<&'a str>,
    room_id: Option<&'a str>,
    /// The room message's place in the room's log.
    seq: Option<u64>,
    /// The room message's event id.
    message_id: Option<&'a str>,
    /// A scheduled job's id, when a run's notification has no session to belong to (two jobs are two notifications).
    job: Option<&'a str>,
    /// A scheduled job's next run, in milliseconds since the epoch.
    next_run_at: Option<i64>,
}

impl<'a> Where<'a> {
    fn session(id: &'a str) -> Self {
        Self {
            session_id: Some(id),
            ..Self::default()
        }
    }
}

/// A turn the poll saw end in a session the host's link does not run: the service reads its words and makes the
/// notification ([`Feed::notify_finished`]), or none when there are no words (B22).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
    /// The bot.
    pub profile: String,
    /// The engine's live id of the session.
    pub session_id: String,
    /// Where the session came from.
    pub source: Source,
}

/// The feed. Cheap to share.
pub struct Feed {
    inner: Mutex<Inner>,
    tx: broadcast::Sender<Arc<Stamped>>,
    wanted: watch::Sender<usize>,
    text_wanted: watch::Sender<usize>,
    followers: AtomicUsize,
    /// The pace each follower asked for, in milliseconds, counted (B46): replies are sent again at the fastest.
    paces: Mutex<BTreeMap<u64, usize>>,
    listeners: AtomicUsize,
    poke: AtomicBool,
    audit: Audit,
    limits: ApiLimits,
    secrets: Mutex<Vec<String>>,
}

/// A reader of the feed. While one exists the engine is polled; dropping it lets the polling stop.
pub struct Consumer {
    feed: Arc<Feed>,
}

impl Drop for Consumer {
    fn drop(&mut self) {
        let n = self
            .feed
            .listeners
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1);
        self.feed.wanted.send_replace(n);
    }
}

/// A reader that follows conversations. While one exists the host copies the words of replies and of the owner's messages.
pub struct Follower {
    feed: Arc<Feed>,
    pace: u64,
}

impl Drop for Follower {
    fn drop(&mut self) {
        {
            let mut paces = lock(&self.feed.paces);
            if let Some(n) = paces.get_mut(&self.pace) {
                *n -= 1;
                if *n == 0 {
                    paces.remove(&self.pace);
                }
            }
        }
        let n = self
            .feed
            .followers
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1);
        self.feed.text_wanted.send_replace(n);
    }
}

/// What a new stream gets: the events it missed (when it resumes), and the live receiver.
pub struct Subscription {
    /// Events after the id the stream resumed from, oldest first.
    pub backlog: Vec<Arc<Stamped>>,
    /// Whether the ring no longer holds events the stream asked for.
    pub gap: bool,
    /// New events.
    pub rx: broadcast::Receiver<Arc<Stamped>>,
    /// Keeps the feed polling for as long as the stream lives.
    pub consumer: Consumer,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Whether a session id is the engine scheduler's name for a run's session: `cron_<job id>_<YYYYmmdd>_<HHMMSS>`
/// (`hermes_state_ids.py` recognises the same shape).
#[must_use]
pub fn is_cron_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("cron_") else {
        return false;
    };
    let mut tail = rest.rsplitn(3, '_');
    let (Some(time), Some(day), Some(job)) = (tail.next(), tail.next(), tail.next()) else {
        return false;
    };
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    digits(time, 6) && digits(day, 8) && !job.is_empty()
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

impl Feed {
    /// An empty feed.
    #[must_use]
    pub fn new(audit: Audit, limits: ApiLimits) -> Arc<Self> {
        let (tx, _) = broadcast::channel(limits.ring.max(16));
        Arc::new(Self {
            inner: Mutex::new(Inner {
                seq: 0,
                msg_seq: 0,
                replies: HashMap::new(),
                note_seq: 0,
                ring: VecDeque::new(),
                presence: Table::new(),
                inbox: Inbox::new(),
                notes: VecDeque::new(),
                roster: Vec::new(),
                rooms: Vec::new(),
                meta: HashMap::new(),
                gui_answers: HashMap::new(),
                last_note: HashMap::new(),
                room_working: HashMap::new(),
                pending: HashMap::new(),
                cron_runs: HashMap::new(),
            }),
            tx,
            wanted: watch::channel(0).0,
            text_wanted: watch::channel(0).0,
            followers: AtomicUsize::new(0),
            paces: Mutex::new(BTreeMap::new()),
            listeners: AtomicUsize::new(0),
            poke: AtomicBool::new(false),
            audit,
            limits,
            secrets: Mutex::new(Vec::new()),
        })
    }

    /// Add a line to the security record (a stop asked through this API, `rooms.rs`).
    pub fn record(&self, line: &Line) {
        self.audit.record(line);
    }

    /// Values that must never leave in any text (the endpoint's token, a ticket the host holds). Replaces the list.
    pub fn never_say(&self, values: Vec<String>) {
        *lock(&self.secrets) = values;
    }

    fn clip(&self, text: &str) -> String {
        let secrets = lock(&self.secrets);
        let exact: Vec<&str> = secrets.iter().map(String::as_str).collect();
        scrub::clip(text, self.limits.text_cap, &exact)
    }

    /// Count a reader. The feed polls the engine while at least one exists.
    #[must_use]
    pub fn consumer(self: &Arc<Self>) -> Consumer {
        let n = self.listeners.fetch_add(1, Ordering::SeqCst) + 1;
        self.wanted.send_replace(n);
        Consumer { feed: self.clone() }
    }

    /// Count a reader that follows conversations, at the default pace.
    #[must_use]
    pub fn follower(self: &Arc<Self>) -> Follower {
        self.follower_at(self.limits.stream_every)
    }

    /// Count a reader that follows conversations and wants a growing reply sent again at most every `pace` (B46).
    #[must_use]
    pub fn follower_at(self: &Arc<Self>, pace: std::time::Duration) -> Follower {
        let pace = u64::try_from(pace.as_millis()).unwrap_or(u64::MAX);
        *lock(&self.paces).entry(pace).or_insert(0) += 1;
        let n = self.followers.fetch_add(1, Ordering::SeqCst) + 1;
        self.text_wanted.send_replace(n);
        Follower {
            feed: self.clone(),
            pace,
        }
    }

    /// How often a growing reply is sent again: the fastest pace any follower asked for, else the default.
    #[must_use]
    pub fn stream_every(&self) -> std::time::Duration {
        lock(&self.paces)
            .keys()
            .next()
            .map_or(self.limits.stream_every, |ms| {
                std::time::Duration::from_millis(*ms)
            })
    }

    /// How many readers follow conversations, as a watch (the links copy words only while it is above zero).
    #[must_use]
    pub fn text_wanted(&self) -> watch::Receiver<usize> {
        self.text_wanted.subscribe()
    }

    fn following(&self) -> bool {
        self.followers.load(Ordering::SeqCst) > 0
    }

    /// Text from a conversation for another client: secrets removed, line breaks kept, cut to the message cap. The
    /// second value says whether it was cut.
    pub fn message_text(&self, text: &str) -> (String, bool) {
        let secrets = lock(&self.secrets);
        let exact: Vec<&str> = secrets.iter().map(String::as_str).collect();
        let clean = scrub::scrub(text, &exact);
        let cap = self.limits.message_cap;
        if clean.chars().count() <= cap {
            return (clean, false);
        }
        (clean.chars().take(cap).collect(), true)
    }

    /// How many readers there are, as a watch (the poller waits on it).
    #[must_use]
    pub fn wanted(&self) -> watch::Receiver<usize> {
        self.wanted.subscribe()
    }

    /// Whether the engine said something changed since last asked (a `sessions.changed` event).
    #[must_use]
    pub fn take_poke(&self) -> bool {
        self.poke.swap(false, Ordering::SeqCst)
    }

    /// A reader of the events. `since` is a `Last-Event-ID`: the events after it that the ring still holds come first.
    #[must_use]
    pub fn subscribe(self: &Arc<Self>, since: Option<u64>) -> Subscription {
        let consumer = self.consumer();
        let inner = lock(&self.inner);
        // Subscribe under the lock events are sent under, so nothing falls between the backlog and the live receiver.
        let rx = self.tx.subscribe();
        let first = inner.ring.front().map_or(inner.seq + 1, |e| e.id);
        let (backlog, gap) = match since {
            Some(id) => (
                inner.ring.iter().filter(|e| e.id > id).cloned().collect(),
                id + 1 < first && id < inner.seq,
            ),
            None => (Vec::new(), false),
        };
        Subscription {
            backlog,
            gap,
            rx,
            consumer,
        }
    }

    fn emit(&self, inner: &mut Inner, event: Event) -> Arc<Stamped> {
        inner.seq += 1;
        let stamped = Arc::new(Stamped {
            id: inner.seq,
            at: now_ms(),
            event,
        });
        inner.ring.push_back(stamped.clone());
        while inner.ring.len() > self.limits.ring {
            inner.ring.pop_front();
        }
        let _ = self.tx.send(stamped.clone());
        stamped
    }

    /// The id of the last event made (0 before any).
    #[must_use]
    pub fn last_id(&self) -> u64 {
        lock(&self.inner).seq
    }

    // ───────────────────────── the roster ─────────────────────────

    /// A new roster from the engine. Emits `bots.changed` for what moved.
    pub fn set_roster(&self, entries: Vec<Entry>) {
        let mut inner = lock(&self.inner);
        let moved = roster::changed(&inner.roster, &entries);
        let gone: Vec<String> = inner
            .roster
            .iter()
            .filter(|o| !entries.iter().any(|n| n.name == o.name))
            .map(|o| o.name.clone())
            .collect();
        for g in &gone {
            inner.presence.forget(g);
        }
        let first = inner.roster.is_empty() && !moved.is_empty() && inner.seq == 0;
        inner.roster = entries;
        if !moved.is_empty() && !first {
            self.emit(&mut inner, Event::BotsChanged { names: moved });
        }
    }

    /// The names of the bots the feed knows.
    #[must_use]
    pub fn bot_names(&self) -> Vec<String> {
        lock(&self.inner)
            .roster
            .iter()
            .map(|e| e.name.clone())
            .collect()
    }

    /// The rooms, as the engine lists them.
    pub fn set_rooms(&self, rooms: Vec<RoomRow>) {
        lock(&self.inner).rooms = rooms;
    }

    /// The rooms.
    #[must_use]
    pub fn rooms(&self) -> Vec<RoomRow> {
        lock(&self.inner).rooms.clone()
    }

    /// The roster with each bot's presence.
    #[must_use]
    pub fn bots(&self) -> Vec<BotRow> {
        let inner = lock(&self.inner);
        let now = now_ms();
        inner
            .roster
            .iter()
            .map(|e| BotRow {
                name: e.name.clone(),
                display_name: e.display_name.clone(),
                role: e.role.clone(),
                model: e.model.clone(),
                provider: e.provider.clone(),
                look: e.look.clone(),
                known_to_boopis: e.known_to_boopis,
                presence: inner.presence.presence(&e.name, now),
            })
            .collect()
    }

    /// Whether `name` is a bot of the roster.
    #[must_use]
    pub fn has_bot(&self, name: &str) -> bool {
        lock(&self.inner).roster.iter().any(|e| e.name == name)
    }

    /// Every bot's presence.
    #[must_use]
    pub fn presence(&self) -> Vec<Presence> {
        self.bots().into_iter().map(|b| b.presence).collect()
    }

    // ───────────────────────── sessions the feed was told of ─────────────────────────

    /// A session boopis made for a client, or one the poll found: its kind, its stored id and its model.
    pub fn note_session(
        &self,
        profile: &str,
        session_id: &str,
        source: Source,
        stored: Option<&str>,
        model: Option<&str>,
    ) {
        let mut inner = lock(&self.inner);
        if inner.meta.len() >= 512 {
            inner.meta.clear();
        }
        // whether the host's own link carries it is the link's to say, so it is kept
        let m = inner
            .meta
            .entry((profile.to_owned(), session_id.to_owned()))
            .or_default();
        m.source = Some(source);
        m.stored = stored.filter(|s| !s.is_empty()).map(str::to_owned);
        m.model = model.map(str::to_owned);
    }

    /// Whether the feed already knows a session's stored id, so the poller notes it once.
    #[must_use]
    pub fn session_known(&self, profile: &str, session_id: &str) -> bool {
        lock(&self.inner)
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .is_some_and(|m| m.stored.is_some())
    }

    /// What the poll learned of a session: its stored id and model, and its kind when the feed has none yet. A kind the
    /// host knows from its own link is never replaced by the poll's (B25).
    pub fn learn_session(
        &self,
        profile: &str,
        session_id: &str,
        source: Source,
        stored: Option<&str>,
        model: Option<&str>,
    ) {
        let mut inner = lock(&self.inner);
        if inner.meta.len() >= 512 {
            inner.meta.clear();
        }
        let m = inner
            .meta
            .entry((profile.to_owned(), session_id.to_owned()))
            .or_default();
        m.source.get_or_insert(source);
        if let Some(s) = stored.filter(|s| !s.is_empty()) {
            m.stored = Some(s.to_owned());
        }
        if let Some(model) = model {
            m.model = Some(model.to_owned());
        }
    }

    /// Where a live session the poll lists came from: what the host knows of it first (its own link runs the app's kind,
    /// `gui`), then the engine's own `source` when the row carries one (`session.active_list` rows usually do not), then the
    /// engine's own name for a room member's session (`Group: <room id>`, `hosted_room_driver.py`, which the engine itself
    /// reads back in `methods_prompt.py`), or the scheduler's own name for a run's session (`cron_<job id>_<time>`,
    /// `cron/scheduler.py`; `stored` is the row's stored id), else `other`.
    #[must_use]
    pub fn resolve_source(
        &self,
        profile: &str,
        session_id: &str,
        stored: &str,
        engine_source: &str,
        title: &str,
    ) -> Source {
        let known = lock(&self.inner)
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .and_then(|m| m.source);
        known.unwrap_or_else(|| {
            if is_cron_id(session_id) || is_cron_id(stored) {
                Source::Cron
            } else if !engine_source.trim().is_empty() {
                super::model::source_of(engine_source)
            } else if title.starts_with("Group: ") {
                Source::Room
            } else {
                Source::Other
            }
        })
    }

    fn origin(inner: &Inner, profile: &str, session_id: &str) -> Source {
        inner
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .and_then(|m| m.source)
            .unwrap_or(Source::Gui)
    }

    // ───────────────────────── conversations ─────────────────────────

    /// The id a client knows the conversation by: the stored id once the host has seen the session listed, else the live id.
    fn conversation_id(inner: &Inner, profile: &str, session_id: &str) -> String {
        inner
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .and_then(|m| m.stored.clone())
            .unwrap_or_else(|| session_id.to_owned())
    }

    fn next_message_id(inner: &mut Inner) -> String {
        inner.msg_seq += 1;
        format!("l{}", inner.msg_seq)
    }

    fn emit_message(&self, inner: &mut Inner, profile: &str, session_id: &str, message: Message) {
        let session = Self::conversation_id(inner, profile, session_id);
        // A session the feed has not seen listed: ask the poll to name it, so the next message carries the stored id.
        if inner
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .is_none_or(|m| m.stored.is_none())
        {
            self.poke.store(true, Ordering::SeqCst);
        }
        self.emit(
            inner,
            Event::Conversation(ConversationMessage {
                profile: profile.to_owned(),
                session_id: session,
                message,
            }),
        );
    }

    fn message(&self, id: String, role: Role, text: &str, at: i64, state: MessageState) -> Message {
        let (text, truncated) = self.message_text(text);
        Message {
            id,
            role,
            text,
            truncated,
            at,
            state,
        }
    }

    /// A message the owner sent, from a window (seen on the proxy) or through this API: the same message, either way.
    pub fn on_user_message(&self, profile: &str, session_id: &str, text: &str) {
        if !self.following() || text.trim().is_empty() {
            return;
        }
        let mut inner = lock(&self.inner);
        let id = Self::next_message_id(&mut inner);
        let message = self.message(id, Role::User, text, now_ms(), MessageState::Done);
        self.emit_message(&mut inner, profile, session_id, message);
    }

    /// The words of a reply, from the frames of a link: it starts, it grows, it ends.
    fn conversation_frame(
        &self,
        inner: &mut Inner,
        profile: &str,
        sid: &str,
        f: &FeedFrame,
        payload: &Value,
        now: i64,
    ) {
        let key = (profile.to_owned(), sid.to_owned());
        match f.name.as_str() {
            "message.start" | "message.delta" => {
                if !inner.replies.contains_key(&key) {
                    if inner.replies.len() >= 64 {
                        inner.replies.clear();
                    }
                    let id = Self::next_message_id(inner);
                    inner.replies.insert(
                        key.clone(),
                        Reply {
                            id,
                            text: String::new(),
                            at: now,
                            last_sent: 0,
                            dirty: false,
                        },
                    );
                    let reply = &inner.replies[&key];
                    let message = self.message(
                        reply.id.clone(),
                        Role::Assistant,
                        "",
                        now,
                        MessageState::Streaming,
                    );
                    self.emit_message(inner, profile, sid, message);
                    if let Some(r) = inner.replies.get_mut(&key) {
                        r.last_sent = now;
                    }
                }
                if f.name == "message.delta" {
                    let delta = str_of(payload, "text");
                    if let Some(r) = inner.replies.get_mut(&key)
                        && !delta.is_empty()
                    {
                        // Held a little past the cap, so the cut text still says it was cut.
                        if r.text.chars().count() <= self.limits.message_cap {
                            r.text.push_str(&delta);
                        }
                        r.dirty = true;
                    }
                    self.flush_reply(inner, profile, sid, now);
                }
            }
            "message.complete" => {
                let reply = inner.replies.remove(&key);
                let (id, held, at) = reply.map_or_else(
                    || (Self::next_message_id(inner), String::new(), now),
                    |r| (r.id, r.text, r.at),
                );
                let full = str_of(payload, "text");
                let text = if full.is_empty() { held } else { full };
                if text.trim().is_empty() {
                    return;
                }
                let message = self.message(id, Role::Assistant, &text, at, MessageState::Done);
                self.emit_message(inner, profile, sid, message);
            }
            _ => {}
        }
    }

    /// Send a growing reply again when it has changed and has not been sent for the stream interval.
    fn flush_reply(&self, inner: &mut Inner, profile: &str, sid: &str, now: i64) {
        let every = i64::try_from(self.stream_every().as_millis()).unwrap_or(i64::MAX);
        let key = (profile.to_owned(), sid.to_owned());
        let Some(r) = inner.replies.get_mut(&key) else {
            return;
        };
        if !r.dirty || now - r.last_sent < every {
            return;
        }
        r.dirty = false;
        r.last_sent = now;
        let (id, text, at) = (r.id.clone(), r.text.clone(), r.at);
        let message = self.message(id, Role::Assistant, &text, at, MessageState::Streaming);
        self.emit_message(inner, profile, sid, message);
    }

    // ───────────────────────── notifications ─────────────────────────

    /// Make a notification, unless the same kind for the same session (or room) was made a moment ago.
    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        inner: &mut Inner,
        kind: NoteKind,
        profile: &str,
        at: &Where<'_>,
        source: Source,
        title: String,
        body: String,
        urgent: bool,
    ) {
        let now = now_ms();
        // A room's message is its own news (two in a row are two notifications); a session's turn ends once.
        let place = match (at.session_id, at.room_id, at.seq, at.job) {
            (Some(s), _, _, _) => s.to_owned(),
            (None, Some(r), Some(seq), _) => format!("{r}#{seq}"),
            (None, None, _, Some(job)) => format!("cron:{job}"),
            (None, room, _, _) => room.unwrap_or_default().to_owned(),
        };
        let key = (profile.to_owned(), place, kind as u8);
        if inner.last_note.get(&key).is_some_and(|t| now - t < 3_000) {
            return;
        }
        inner.last_note.insert(key, now);
        if inner.last_note.len() > 512 {
            inner.last_note.clear();
        }
        inner.note_seq += 1;
        let note = Notification {
            id: inner.note_seq,
            kind,
            profile: profile.to_owned(),
            title,
            body,
            session_id: at.session_id.map(str::to_owned),
            room_id: at.room_id.map(str::to_owned),
            seq: at.seq,
            message_id: at.message_id.map(str::to_owned),
            next_run_at: at.next_run_at,
            source,
            at: now,
            urgent,
        };
        inner.notes.push_back(note.clone());
        while inner.notes.len() > self.limits.notes_kept {
            inner.notes.pop_front();
        }
        self.emit(inner, Event::Notification(note));
    }

    /// The notifications kept, newest last, those after `after` (an id) when given.
    #[must_use]
    pub fn notifications(&self, after: Option<u64>, limit: usize) -> Vec<Notification> {
        let inner = lock(&self.inner);
        let mut rows: Vec<Notification> = inner
            .notes
            .iter()
            .filter(|n| after.is_none_or(|a| n.id > a))
            .cloned()
            .collect();
        let drop = rows.len().saturating_sub(limit);
        rows.drain(..drop);
        rows
    }

    fn display(inner: &Inner, profile: &str) -> String {
        inner
            .roster
            .iter()
            .find(|e| e.name == profile)
            .map_or_else(|| profile.to_owned(), |e| e.display_name.clone())
    }

    fn publish(&self, inner: &mut Inner, changed: Vec<Presence>) {
        for p in changed {
            self.emit(inner, Event::Presence(p));
        }
    }

    // ───────────────────────── frames from the host's own links ─────────────────────────

    /// A frame the host's link to `profile` carried.
    #[allow(clippy::too_many_lines)] // one table of events
    pub fn on_frame(&self, profile: &str, f: &FeedFrame) {
        let now = now_ms();
        let mut inner = lock(&self.inner);
        let payload = f.payload.clone().unwrap_or(Value::Null);
        if f.direction == Direction::Out {
            if f.name == "approval.respond" {
                let key = (
                    str_of(&payload, "session_id"),
                    str_of(&payload, "prompt_id"),
                );
                if !key.1.is_empty() {
                    inner
                        .gui_answers
                        .insert(key, (str_of(&payload, "choice"), now));
                    if inner.gui_answers.len() > 128 {
                        inner.gui_answers.clear();
                    }
                }
            }
            if f.name == "prompt.submit" {
                let (sid, text) = (str_of(&payload, "session_id"), str_of(&payload, "text"));
                drop(inner);
                if !sid.is_empty() {
                    self.on_user_message(profile, &sid, &text);
                }
            }
            return;
        }
        if f.name == "sessions.changed" {
            self.poke.store(true, Ordering::SeqCst);
            return;
        }
        let Some(sid) = f.session_id.as_deref() else {
            return;
        };
        // A session that runs on the host's own link is the app's kind (the window's, or one `say` started): noted once, so
        // the poll, which cannot tell, never names it otherwise (B25).
        if inner.meta.len() >= 512 {
            inner.meta.clear();
        }
        let m = inner
            .meta
            .entry((profile.to_owned(), sid.to_owned()))
            .or_default();
        m.source.get_or_insert(Source::Gui);
        m.linked = true;
        let origin = Self::origin(&inner, profile, sid);
        let held_reply = inner
            .replies
            .get(&(profile.to_owned(), sid.to_owned()))
            .map(|r| r.text.clone())
            .unwrap_or_default();
        if self.following() {
            self.conversation_frame(&mut inner, profile, sid, f, &payload, now);
        }
        match f.name.as_str() {
            "approval.request" => {
                self.approval_asked(&mut inner, profile, sid, f, &payload, origin, now);
            }
            "approval.settled" | "approval.cancelled" => {
                let prompt = str_of(&payload, "prompt_id");
                let by = inner
                    .gui_answers
                    .remove(&(sid.to_owned(), prompt.clone()))
                    .map(|(choice, at)| Answered {
                        surface: "gui".into(),
                        choice: Some(choice),
                        at,
                    });
                if let Some(row) = inner.inbox.settled_elsewhere(profile, &prompt, by.clone()) {
                    self.audit_gui(profile, &row, by.as_ref());
                    self.emit(&mut inner, Event::Approvals(row));
                }
                let changed =
                    inner
                        .presence
                        .on_event(profile, sid, &f.name, &Facts::default(), origin, now);
                self.publish(&mut inner, changed);
            }
            "tool.start" | "tool.generating" | "tool.progress" => {
                let tool = ["name", "tool_name", "tool"]
                    .iter()
                    .map(|k| str_of(&payload, k))
                    .find(|s| !s.is_empty());
                let tool = tool.map(|t| self.clip(&t));
                // What the call touches (B40): from the arguments `tool.start` carries, safe words only, then scrubbed.
                let detail = (f.name == "tool.start")
                    .then(|| {
                        super::toolwords::detail(
                            tool.as_deref().unwrap_or_default(),
                            payload.get("args"),
                        )
                    })
                    .flatten()
                    .map(|d| self.clip(&d));
                // How far it says it has come (B44): only what the engine relayed, never an estimate.
                let progress = (f.name == "tool.progress")
                    .then(|| self.progress_of(&payload))
                    .flatten();
                let facts = Facts {
                    tool: tool.as_deref(),
                    detail: detail.as_deref(),
                    progress: progress.as_ref(),
                    ..Facts::default()
                };
                let changed = inner
                    .presence
                    .on_event(profile, sid, &f.name, &facts, origin, now);
                self.publish(&mut inner, changed);
            }
            "message.complete" => {
                let outcome = str_of(&payload, "outcome");
                let failed = matches!(outcome.as_str(), "failed" | "error");
                let changed = inner.presence.on_event(
                    profile,
                    sid,
                    &f.name,
                    &Facts {
                        failed,
                        ..Facts::default()
                    },
                    origin,
                    now,
                );
                self.publish(&mut inner, changed);
                let who = Self::display(&inner, profile);
                if failed {
                    self.notify(
                        &mut inner,
                        NoteKind::Error,
                        profile,
                        &Where::session(sid),
                        origin,
                        format!("{who} hit an error"),
                        String::new(),
                        false,
                    );
                } else {
                    // The reply's own words, else what streamed of it; a reply with no words is no notification (B22).
                    let full = str_of(&payload, "text");
                    let text = self.clip(if full.trim().is_empty() {
                        &held_reply
                    } else {
                        &full
                    });
                    if !text.trim().is_empty() {
                        self.notify(
                            &mut inner,
                            NoteKind::Reply,
                            profile,
                            &Where::session(sid),
                            origin,
                            format!("{who} replied"),
                            text,
                            false,
                        );
                    }
                }
            }
            "error" | "turn.failed" => {
                let changed = inner.presence.on_event(
                    profile,
                    sid,
                    &f.name,
                    &Facts {
                        failed: true,
                        ..Facts::default()
                    },
                    origin,
                    now,
                );
                self.publish(&mut inner, changed);
                let who = Self::display(&inner, profile);
                let why = self.clip(
                    &["message", "error", "reason"]
                        .iter()
                        .map(|k| str_of(&payload, k))
                        .find(|s| !s.is_empty())
                        .unwrap_or_default(),
                );
                self.notify(
                    &mut inner,
                    NoteKind::Error,
                    profile,
                    &Where::session(sid),
                    origin,
                    format!("{who} hit an error"),
                    why,
                    false,
                );
            }
            _ => {
                let changed =
                    inner
                        .presence
                        .on_event(profile, sid, &f.name, &Facts::default(), origin, now);
                self.publish(&mut inner, changed);
            }
        }
    }

    /// A `tool.progress` payload as the contract's progress (`agent/tool_progress_relay.py`: `progress`, `total`, and
    /// `percent` from 0 to 100 when there is a total; `message`): `None` when it carries no count.
    fn progress_of(&self, payload: &Value) -> Option<Progress> {
        let number = |k: &str| {
            payload
                .get(k)
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite() && *v >= 0.0)
        };
        let step = number("progress")?;
        let of = number("total").filter(|t| *t > 0.0);
        let fraction = number("percent")
            .map(|p| (p / 100.0).min(1.0))
            .or_else(|| of.map(|t| (step / t).min(1.0)));
        let label = Some(str_of(payload, "message"))
            .filter(|m| !m.trim().is_empty())
            .map(|m| {
                self.clip(&m)
                    .chars()
                    .take(super::toolwords::MAX_DETAIL)
                    .collect::<String>()
            })
            .filter(|m| !m.trim().is_empty());
        Some(Progress {
            fraction,
            step,
            of,
            label,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn approval_asked(
        &self,
        inner: &mut Inner,
        profile: &str,
        sid: &str,
        f: &FeedFrame,
        payload: &Value,
        source: Source,
        now: i64,
    ) {
        let prompt = ["prompt_id", "request_id"]
            .iter()
            .map(|k| str_of(payload, k))
            .find(|s| !s.is_empty());
        let generation = f
            .generation
            .or_else(|| payload.get("execution_generation").and_then(Value::as_u64));
        let (Some(prompt), Some(generation)) = (prompt, generation) else {
            tracing::debug!(
                "an approval request named no prompt or generation; it cannot be answered from outside"
            );
            return;
        };
        let choices: Vec<String> = payload
            .get("choices")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let model = inner
            .meta
            .get(&(profile.to_owned(), sid.to_owned()))
            .and_then(|m| m.model.clone());
        let governed = inner
            .roster
            .iter()
            .find(|e| e.name == profile)
            .is_some_and(|e| e.governed);
        let row = Approval {
            id: prompt.clone(),
            profile: profile.to_owned(),
            session_id: sid.to_owned(),
            prompt_id: prompt,
            execution_generation: generation,
            command: self.clip(&str_of(payload, "command")),
            description: self.clip(&str_of(payload, "description")),
            choices,
            answerable_with: Vec::new(),
            timeout_s: payload.get("timeout_s").and_then(Value::as_u64),
            origin: Origin {
                model,
                tool: Some(str_of(payload, "tool_name"))
                    .filter(|t| !t.is_empty())
                    .map(|t| self.clip(&t)),
            },
            governed,
            state: ApprovalState::Pending,
            answered_by: None,
            asked_at: now,
        };
        self.add_approval(inner, row, source, now);
        let origin = Self::origin(inner, profile, sid);
        let changed = inner.presence.on_event(
            profile,
            sid,
            "approval.request",
            &Facts::default(),
            origin,
            now,
        );
        self.publish(inner, changed);
    }

    fn add_approval(&self, inner: &mut Inner, row: Approval, source: Source, _now: i64) {
        let (profile, sid) = (row.profile.clone(), row.session_id.clone());
        let what = if row.command.is_empty() {
            row.description.clone()
        } else {
            row.command.clone()
        };
        if let Some(shown) = inner.inbox.upsert(row) {
            let who = Self::display(inner, &profile);
            self.emit(inner, Event::Approvals(shown));
            self.notify(
                inner,
                NoteKind::Approval,
                &profile,
                &Where::session(&sid),
                source,
                format!("{who} needs your approval"),
                what,
                true,
            );
        }
    }

    fn audit_gui(&self, profile: &str, row: &Approval, by: Option<&Answered>) {
        if let Some(by) = by {
            self.audit.record(&Line {
                at: by.at,
                profile: profile.to_owned(),
                session_id: row.session_id.clone(),
                prompt_id: row.prompt_id.clone(),
                choice: by.choice.clone().unwrap_or_default(),
                outcome: "delivered".into(),
                surface: by.surface.clone(),
            });
        }
    }

    // ───────────────────────── the poll ─────────────────────────

    /// The live sessions of one profile's link. Returns the turns that ended in a session of another program (`other`):
    /// the service reads their words and makes the notification. A room's turn is told from the room's log, a kanban
    /// worker's from the board, and a scheduled run from the engine's own cron list (B42), so none of those is returned.
    pub fn on_poll(
        &self,
        profile: &str,
        rows: &[Live],
        models: &HashMap<String, String>,
    ) -> Vec<Finished> {
        let now = now_ms();
        let mut inner = lock(&self.inner);
        let previous: HashMap<String, State> = rows
            .iter()
            .filter_map(|r| {
                inner
                    .presence
                    .session_state(profile, &r.session_id)
                    .map(|s| (r.session_id.clone(), s))
            })
            .collect();
        for r in rows {
            if let Some(model) = models.get(&r.session_id) {
                let m = inner
                    .meta
                    .entry((profile.to_owned(), r.session_id.clone()))
                    .or_default();
                m.model = Some(model.clone());
            }
        }
        let waiting: Vec<String> = rows
            .iter()
            .filter(|r| r.status == super::presence::Status::Waiting)
            .map(|r| r.session_id.clone())
            .collect();
        let inbox_waits: Vec<String> = waiting
            .iter()
            .filter(|s| inner.inbox.session_waits(profile, s))
            .cloned()
            .collect();
        let changed =
            inner
                .presence
                .on_poll(profile, rows, &|s| inbox_waits.iter().any(|w| w == s), now);
        self.publish(&mut inner, changed);
        self.apply_pending(&mut inner, profile, rows, now);
        let mut finished = Vec::new();
        for r in rows {
            let was = previous.get(&r.session_id).copied();
            let now_state = inner.presence.session_state(profile, &r.session_id);
            let ended =
                was.is_some_and(State::busy) && matches!(now_state, Some(State::Idle) | None);
            if ended && r.source == Source::Other {
                finished.push(Finished {
                    profile: profile.to_owned(),
                    session_id: r.session_id.clone(),
                    source: r.source,
                });
            }
        }
        // A session the poll no longer lists has ended: a turn that was busy in it was finished or cut off.
        let ended = inner.presence.tick(now);
        self.publish(&mut inner, ended);
        finished
    }

    /// What the plugin pushed from the engine's tool hooks (B45, `activity.rs`): a tool's start or end, or a turn's end, for
    /// a session the host's own link does not run. Kept only while someone listens, for a bot of the roster. A scheduled
    /// run's session (no poll lists one) is taken at once and stands on its pushes; any other session the table does not
    /// hold yet waits for the poll to list it (it is asked at once), so a delegated child or a stray id never shows.
    pub fn on_push(&self, p: &super::activity::Pushed) {
        use super::activity::Kind;
        if self.listeners.load(Ordering::SeqCst) == 0 {
            return;
        }
        let now = now_ms();
        let tool = Some(p.tool.trim())
            .filter(|t| !t.is_empty())
            .map(|t| self.clip(t));
        // What the call touches, in the one set of safe words (B40), then scrubbed like every engine text.
        let detail = (p.kind == Kind::ToolStart)
            .then(|| super::toolwords::detail(tool.as_deref().unwrap_or_default(), p.args.as_ref()))
            .flatten()
            .map(|d| self.clip(&d));
        if p.kind == Kind::RuleRefused {
            self.on_rule_refused(p);
            return;
        }
        let event = match p.kind {
            Kind::ToolStart => "tool.start",
            Kind::ToolEnd => "tool.complete",
            Kind::TurnEnd | Kind::RuleRefused => "message.complete",
        };
        let mut inner = lock(&self.inner);
        if p.profile != "default" && !inner.roster.iter().any(|e| e.name == p.profile) {
            return;
        }
        let key = (p.profile.clone(), p.session_id.clone());
        if inner.meta.get(&key).is_some_and(|m| m.linked) {
            return;
        }
        if let Some(job) = &p.cron {
            if inner.cron_runs.len() >= 128 {
                inner.cron_runs.clear();
            }
            inner
                .cron_runs
                .insert((p.profile.clone(), job.clone()), p.session_id.clone());
            if inner.meta.len() >= 512 {
                inner.meta.clear();
            }
            inner
                .meta
                .entry(key.clone())
                .or_default()
                .source
                .get_or_insert(Source::Cron);
        }
        // the kind a session started with stands (B25): what the table holds, then what the feed was told
        let source = inner
            .presence
            .source_of(&p.profile, &p.session_id)
            .or_else(|| inner.meta.get(&key).and_then(|m| m.source))
            .unwrap_or(if is_cron_id(&p.session_id) {
                Source::Cron
            } else {
                Source::Other
            });
        let call = Some(p.call.as_str()).filter(|c| !c.is_empty());
        if source != Source::Cron && !inner.presence.knows(&p.profile, &p.session_id) {
            let grace = i64::try_from(self.limits.push_pending.as_millis()).unwrap_or(i64::MAX);
            inner.pending.retain(|_, w| now - w.at <= grace);
            if inner.pending.len() >= 64 {
                inner.pending.clear();
            }
            inner.pending.insert(
                key,
                PendingPush {
                    event,
                    tool,
                    detail,
                    call: call.map(str::to_owned),
                    failed: p.failed,
                    at: now,
                },
            );
            self.poke.store(true, Ordering::SeqCst);
            return;
        }
        let facts = Facts {
            tool: tool.as_deref(),
            detail: detail.as_deref(),
            call,
            failed: p.failed,
            progress: None,
        };
        let alive = (source == Source::Cron).then(|| {
            now.saturating_add(i64::try_from(self.limits.push_hold.as_millis()).unwrap_or(i64::MAX))
        });
        let changed =
            inner
                .presence
                .on_push(&p.profile, &p.session_id, event, &facts, source, alive, now);
        self.publish(&mut inner, changed);
    }

    /// The pushes that waited for the poll to list their session: applied to a session it lists busy, while fresh.
    fn apply_pending(&self, inner: &mut Inner, profile: &str, rows: &[Live], now: i64) {
        let grace = i64::try_from(self.limits.push_pending.as_millis()).unwrap_or(i64::MAX);
        for r in rows {
            let Some(w) = inner
                .pending
                .remove(&(profile.to_owned(), r.session_id.clone()))
            else {
                continue;
            };
            if now - w.at > grace || r.status == super::presence::Status::Idle {
                continue;
            }
            let facts = Facts {
                tool: w.tool.as_deref(),
                detail: w.detail.as_deref(),
                call: w.call.as_deref(),
                failed: w.failed,
                progress: None,
            };
            let changed = inner.presence.on_push(
                profile,
                &r.session_id,
                w.event,
                &facts,
                r.source,
                None,
                now,
            );
            self.publish(inner, changed);
        }
    }

    /// A scheduled job's run ended, as its cron list says (B42): the session the plugin pushed for it, if any, shows as done
    /// (or failed) when its own end never came, and its id is handed back (the run's session, when the list names none).
    pub fn cron_run_ended(&self, profile: &str, job: &str, failed: bool) -> Option<String> {
        let mut inner = lock(&self.inner);
        let sid = inner
            .cron_runs
            .remove(&(profile.to_owned(), job.to_owned()))?;
        let changed = inner.presence.end_push(profile, &sid, failed, now_ms());
        self.publish(&mut inner, changed);
        Some(sid)
    }

    /// A finished turn's notification, with the words its session ended on (`body`; empty when none could be read). A
    /// reply with no words is not sent (B22).
    pub fn notify_finished(&self, done: &Finished, body: &str) {
        let mut inner = lock(&self.inner);
        let who = Self::display(&inner, &done.profile);
        let body = self.clip(body);
        if body.trim().is_empty() {
            return;
        }
        self.notify(
            &mut inner,
            NoteKind::Reply,
            &done.profile,
            &Where::session(&done.session_id),
            done.source,
            format!("{who} finished a turn"),
            body,
            false,
        );
    }

    /// A scheduled run finished (B42): the engine's cron list saw the job's last run move. The title says the job and how
    /// it ended, the body is the words the run ended on (else, for a failure, the engine's own redacted error; else
    /// nothing), and `next_run_at` when the job runs next. `session_id` is the run's stored session when it was found.
    pub fn notify_cron(&self, run: &super::cron::Finished) {
        let mut inner = lock(&self.inner);
        let who = Self::display(&inner, &run.profile);
        let ended = match run.status.as_str() {
            "error" => "failed",
            "cancelled" => "was stopped",
            "delivery_failed" => "finished, but its delivery failed",
            _ => "finished",
        };
        let title = format!("{who}'s scheduled run \u{201c}{}\u{201d} {ended}", run.name);
        let body = self.clip(&run.body);
        let at = Where {
            session_id: run.session_id.as_deref(),
            job: Some(&run.job_id),
            next_run_at: run.next_run_at,
            ..Where::default()
        };
        self.notify(
            &mut inner,
            NoteKind::Cron,
            &run.profile,
            &at,
            Source::Cron,
            title,
            body,
            false,
        );
    }

    /// A scheduled run's step was refused by a rule and parked (`rules-engine.md` 8.3): a notification that the owner can
    /// approve it from boopis. The datagram is unauthenticated, so it only ever says what the plugin said; the card itself is
    /// read from the parked file by the host.
    fn on_rule_refused(&self, p: &super::activity::Pushed) {
        let mut inner = lock(&self.inner);
        if p.profile != "default" && !inner.roster.iter().any(|e| e.name == p.profile) {
            return;
        }
        let who = Self::display(&inner, &p.profile);
        let title = format!(
            "{who}'s scheduled run stopped before a step: {}",
            self.clip(p.tool.trim())
        );
        self.notify(
            &mut inner,
            NoteKind::Approval,
            &p.profile,
            &Where::session(&p.session_id),
            Source::Cron,
            title,
            "It needs your OK. Approve it in boopis and it runs again.".to_owned(),
            true,
        );
    }

    /// The name a person reads for a bot: its display name, else the profile name.
    #[must_use]
    pub fn display_name(&self, profile: &str) -> String {
        Self::display(&lock(&self.inner), profile)
    }

    /// A kanban task the bot was running finished: the engine's own summary of it is the body.
    pub fn notify_task(&self, profile: &str, session_id: &str, title: String, body: &str) {
        let mut inner = lock(&self.inner);
        let body = self.clip(body);
        self.notify(
            &mut inner,
            NoteKind::Task,
            profile,
            &Where::session(session_id),
            Source::Kanban,
            title,
            body,
            false,
        );
    }

    // ───────────────────────── rooms ─────────────────────────

    /// A line added to a room's log: a `room.line` event, and for a member's message a notification with its words and the
    /// room (B22), loud when it addresses the owner (B26); a failed turn is an error notification in boopis's words.
    pub fn on_room_line(
        &self,
        room_id: &str,
        room_name: &str,
        line: RoomLine,
        profile: Option<&str>,
    ) {
        let mut inner = lock(&self.inner);
        let note = match (line.from, line.kind.as_str(), profile) {
            (LineFrom::Member, _, Some(p)) if line.mentions_you => Some((
                NoteKind::Mention,
                p,
                format!("{} mentioned you in {room_name}", line.name),
                true,
            )),
            (LineFrom::Member, _, Some(p)) => Some((
                NoteKind::Reply,
                p,
                format!("{} replied in {room_name}", line.name),
                false,
            )),
            (LineFrom::Boopis, "turn.failed", Some(p)) => Some((
                NoteKind::Error,
                p,
                format!("{} hit an error in {room_name}", line.name),
                false,
            )),
            _ => None,
        };
        if let Some((kind, p, title, urgent)) = note {
            let body = self.clip(&line.text);
            let at = Where {
                room_id: Some(room_id),
                seq: Some(line.seq),
                message_id: Some(line.id.as_str()),
                ..Where::default()
            };
            self.notify(&mut inner, kind, p, &at, Source::Room, title, body, urgent);
        }
        self.emit(
            &mut inner,
            Event::RoomLine(RoomLineEvent {
                room_id: room_id.to_owned(),
                line,
            }),
        );
    }

    /// Who is at work in a room: a `room.state` event when it changed.
    pub fn on_room_state(&self, room_id: &str, working: &[String]) {
        let mut inner = lock(&self.inner);
        if inner.room_working.get(room_id).map(Vec::as_slice) == Some(working) {
            return;
        }
        inner
            .room_working
            .insert(room_id.to_owned(), working.to_vec());
        self.emit(
            &mut inner,
            Event::RoomState(RoomStateEvent {
                room_id: room_id.to_owned(),
                working: working.to_vec(),
            }),
        );
    }

    /// The messages a room holds changed.
    pub fn on_room_held(&self, room_id: &str, held: Vec<crate::rooms::hold::Held>) {
        let mut inner = lock(&self.inner);
        self.emit(
            &mut inner,
            Event::RoomHeld(RoomHeldEvent {
                room_id: room_id.to_owned(),
                held,
            }),
        );
    }

    /// A room line's text for another client: scrubbed, cut to the message cap.
    #[must_use]
    pub fn line_text(&self, text: &str) -> (String, bool) {
        self.message_text(text)
    }

    /// The approvals the engine holds for one waiting session (from `approval.pending`, with the generation the session's
    /// ring named): add the new ones, close the ones the engine no longer holds.
    pub fn on_pending(&self, profile: &str, session_id: &str, rows: Vec<Approval>) {
        let mut inner = lock(&self.inner);
        let held: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        let origin = Self::origin(&inner, profile, session_id);
        let governed = inner
            .roster
            .iter()
            .find(|e| e.name == profile)
            .is_some_and(|e| e.governed);
        let model = inner
            .meta
            .get(&(profile.to_owned(), session_id.to_owned()))
            .and_then(|m| m.model.clone());
        for mut row in rows {
            row.governed = governed;
            row.command = self.clip(&row.command);
            row.description = self.clip(&row.description);
            row.origin.tool = row.origin.tool.take().map(|t| self.clip(&t));
            if row.origin.model.is_none() {
                row.origin.model.clone_from(&model);
            }
            let known = inner.inbox.get(profile, &row.id).is_some();
            if !known {
                self.add_approval(&mut inner, row, origin, now_ms());
            }
        }
        for closed in inner.inbox.retain_held(profile, session_id, &held) {
            self.emit(&mut inner, Event::Approvals(closed));
        }
        let waits = inner.inbox.session_waits(profile, session_id);
        let changed = inner
            .presence
            .set_attention(profile, session_id, waits, now_ms());
        self.publish(&mut inner, changed);
    }

    /// Whether the inbox already knows an approval (so the poller does not look its generation up again).
    #[must_use]
    pub fn knows_approval(&self, profile: &str, id: &str) -> bool {
        lock(&self.inner).inbox.get(profile, id).is_some()
    }

    /// Let time pass: finished turns rest, unanswered approvals expire.
    pub fn tick(&self) {
        let now = now_ms();
        let mut inner = lock(&self.inner);
        let changed = inner.presence.tick(now);
        self.publish(&mut inner, changed);
        for row in inner.inbox.sweep(now) {
            self.emit(&mut inner, Event::Approvals(row));
        }
        self.flush_growing(&mut inner, now);
    }

    /// Send again every reply that grew and was not sent for the pace (B46: the service does this at the fastest pace a
    /// follower asked for, so the words of a reply whose deltas stopped do not wait for the next one).
    pub fn flush_replies(&self) {
        let mut inner = lock(&self.inner);
        self.flush_growing(&mut inner, now_ms());
    }

    fn flush_growing(&self, inner: &mut Inner, now: i64) {
        let growing: Vec<(String, String)> = inner
            .replies
            .iter()
            .filter(|(_, r)| r.dirty)
            .map(|(k, _)| k.clone())
            .collect();
        for (profile, sid) in growing {
            self.flush_reply(inner, &profile, &sid, now);
        }
    }

    // ───────────────────────── approvals ─────────────────────────

    /// The approvals: those waiting, or every one kept.
    #[must_use]
    pub fn approvals(&self, all: bool) -> Vec<Approval> {
        let inner = lock(&self.inner);
        if all {
            inner.inbox.all()
        } else {
            inner.inbox.waiting()
        }
    }

    /// The profile and session of an approval by its id.
    #[must_use]
    pub fn approval(&self, id: &str) -> Option<Approval> {
        lock(&self.inner).inbox.find(id).cloned()
    }

    /// Take an approval for an answer (first answer wins). The caller delivers the answer, then calls
    /// [`Feed::finish_answer`].
    ///
    /// # Errors
    /// The refusal; it is recorded in the audit file with the surface that asked.
    pub fn begin_answer(
        &self,
        id: &str,
        choice: &str,
        generation: Option<u64>,
        by: Answered,
    ) -> Result<Approval, Refusal> {
        let mut inner = lock(&self.inner);
        let Some(row) = inner.inbox.find(id).cloned() else {
            return Err(Refusal::Unknown);
        };
        let now = now_ms();
        match inner
            .inbox
            .begin(&row.profile, id, choice, generation, by.clone(), now)
        {
            Ok(taken) => {
                self.emit(&mut inner, Event::Approvals(taken.clone()));
                Ok(taken)
            }
            Err(refusal) => {
                self.audit.record(&Line {
                    at: now,
                    profile: row.profile,
                    session_id: row.session_id,
                    prompt_id: row.prompt_id,
                    choice: choice.chars().take(16).collect(),
                    outcome: format!("refused:{}", refusal.code()),
                    surface: by.surface,
                });
                Err(refusal)
            }
        }
    }

    /// The delivery's outcome: settle the row, record who answered, tell the streams.
    pub fn finish_answer(&self, row: &Approval, delivery: &Delivery) {
        let now = now_ms();
        let mut inner = lock(&self.inner);
        let Some(done) = inner.inbox.finish(&row.profile, &row.id, delivery, now) else {
            return;
        };
        let by = row.answered_by.clone();
        self.audit.record(&Line {
            at: now,
            profile: row.profile.clone(),
            session_id: row.session_id.clone(),
            prompt_id: row.prompt_id.clone(),
            choice: by
                .as_ref()
                .and_then(|b| b.choice.clone())
                .unwrap_or_default(),
            outcome: match delivery {
                Delivery::Delivered => "delivered",
                Delivery::Failed => "failed",
                Delivery::AlreadySettled => "already_settled",
            }
            .into(),
            surface: by.as_ref().map(|b| b.surface.clone()).unwrap_or_default(),
        });
        self.emit(&mut inner, Event::Approvals(done));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ApiLimits;
    use crate::local_api::look::look_for;
    use serde_json::json;

    fn feed() -> (Arc<Feed>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let f = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        f.set_roster(vec![Entry {
            name: "kai".into(),
            display_name: "Kai".into(),
            role: String::new(),
            model: Some("opus".into()),
            provider: None,
            look: look_for("Kai"),
            known_to_boopis: true,
            governed: true,
        }]);
        (f, dir)
    }

    fn frame(name: &str, sid: &str, payload: Option<Value>, generation: Option<u64>) -> FeedFrame {
        FeedFrame {
            direction: Direction::In,
            name: name.into(),
            session_id: Some(sid.into()),
            generation,
            payload,
        }
    }

    fn drain(rx: &mut broadcast::Receiver<Arc<Stamped>>) -> Vec<Arc<Stamped>> {
        let mut out = Vec::new();
        while let Ok(e) = rx.try_recv() {
            out.push(e);
        }
        out
    }

    fn ask(f: &Feed, prompt: &str) {
        f.on_frame(
            "kai",
            &frame(
                "approval.request",
                "s1",
                Some(json!({"prompt_id": prompt, "command": "rm -rf build", "description": "clean", "choices": ["once", "session", "always", "deny"], "timeout_s": 120, "tool_name": "terminal"})),
                Some(5),
            ),
        );
    }

    fn who(surface: &str) -> Answered {
        Answered {
            surface: surface.into(),
            choice: None,
            at: 0,
        }
    }

    #[tokio::test]
    async fn a_turn_on_the_hosts_link_becomes_presence_events_in_order() {
        let (f, _d) = feed();
        let sub = f.subscribe(None);
        let mut rx = sub.rx;
        for (e, p) in [
            ("message.start", None),
            ("tool.start", Some(json!({"name": "read_file"}))),
            ("message.delta", None),
            (
                "message.complete",
                Some(json!({"text": "hello", "outcome": "completed"})),
            ),
        ] {
            f.on_frame("kai", &frame(e, "s1", p, None));
        }
        let events = drain(&mut rx);
        let states: Vec<(State, String)> = events
            .iter()
            .filter_map(|e| match &e.event {
                Event::Presence(p) => Some((p.state, p.activity.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(
            states,
            [
                (State::Thinking, String::new()),
                (State::Working, "read_file".into()),
                (State::Speaking, String::new()),
                (State::Done, String::new())
            ]
        );
        let ids: Vec<u64> = events.iter().map(|e| e.id).collect();
        assert!(ids.windows(2).all(|w| w[1] == w[0] + 1), "{ids:?}");
        assert!(events.iter().any(|e| matches!(&e.event, Event::Notification(n) if n.kind == NoteKind::Reply && n.body == "hello")));
    }

    #[tokio::test]
    async fn a_tool_start_says_what_it_touches_in_safe_scrubbed_words() {
        // B40: the engine's tool.start carries the call's full arguments; only the touched thing leaves, scrubbed
        let (f, _d) = feed();
        let kai = |f: &Feed| {
            f.presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
        };
        f.on_frame(
            "kai",
            &frame(
                "tool.start",
                "s1",
                Some(json!({"name": "terminal", "args": {"command": "API_KEY=sk-proj-abc123456789xyz cargo test --all"}})),
                None,
            ),
        );
        assert_eq!(
            kai(&f).detail.as_deref(),
            Some("Run a command · cargo test")
        );
        f.on_frame(
            "kai",
            &frame(
                "tool.start",
                "s1",
                Some(json!({"name": "read_file", "args": {"path": "/x/ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789/secret.txt"}})),
                None,
            ),
        );
        let d = kai(&f).detail.unwrap();
        assert!(!d.contains("ghp_") && d.ends_with("/secret.txt"), "{d}");
        f.on_frame("kai", &frame("tool.complete", "s1", None, None));
        assert_eq!(kai(&f).detail, None);
    }

    #[tokio::test]
    async fn a_tool_that_reports_its_progress_shows_how_far_in_its_own_scrubbed_words() {
        // B44: the engine relays an MCP server's progress as tool.progress; nothing else makes progress
        let (f, _d) = feed();
        let kai = |f: &Feed| {
            f.presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
        };
        f.on_frame(
            "kai",
            &frame("tool.start", "s1", Some(json!({"name": "render"})), None),
        );
        assert_eq!(kai(&f).progress, None);
        f.on_frame(
            "kai",
            &frame(
                "tool.progress",
                "s1",
                Some(json!({"tool_id": "c1", "name": "render", "progress": 2.0, "total": 3.0, "percent": 67, "message": "Rendering French token=abcdef0123456789zz"})),
                None,
            ),
        );
        let p = kai(&f).progress.unwrap();
        assert_eq!((p.fraction, p.step, p.of), (Some(0.67), 2.0, Some(3.0)));
        let label = p.label.unwrap();
        assert!(
            label.starts_with("Rendering French") && !label.contains("abcdef0123456789zz"),
            "{label}"
        );
        f.on_frame(
            "kai",
            &frame(
                "tool.progress",
                "s1",
                Some(json!({"name": "render", "progress": 5.0, "total": null, "percent": null, "message": null})),
                None,
            ),
        );
        let p = kai(&f).progress.unwrap();
        assert_eq!(
            (p.fraction, p.step, p.of, p.label),
            (None, 5.0, None, None),
            "no total: no fraction is made up"
        );
        f.on_frame("kai", &frame("tool.complete", "s1", None, None));
        assert_eq!(kai(&f).progress, None);
    }

    fn push(kind: &str, profile: &str, sid: &str, extra: &Value) -> super::super::activity::Pushed {
        let mut v = json!({"v": 1, "kind": kind, "profile": profile, "session_id": sid, "tool": "read_file", "call": "c1"});
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        super::super::activity::parse(v.to_string().as_bytes()).unwrap()
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)] // one story, every source in turn
    async fn the_plugins_pushes_move_presence_for_turns_the_hosts_links_never_see() {
        // B45
        use crate::local_api::presence::Status::Working;
        let (f, _d) = feed();
        let kai = |f: &Feed| {
            f.presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
        };
        let path = json!({"args": {"path": "/x/ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789/secret.txt"}});
        f.on_push(&push("tool.start", "kai", "r1", &path));
        assert_eq!(
            kai(&f).state,
            State::Idle,
            "nobody listens: nothing is kept"
        );
        let _reader = f.consumer();
        let room = Live {
            session_id: "r1".into(),
            status: Working,
            source: Source::Room,
            summary: None,
        };
        f.on_poll("kai", std::slice::from_ref(&room), &HashMap::new());
        f.on_push(&push("tool.start", "kai", "r1", &path));
        let p = kai(&f);
        assert_eq!(
            (p.state, p.activity.as_str(), p.source),
            (State::Working, "read_file", Some(Source::Room))
        );
        let d = p.detail.unwrap();
        assert!(
            !d.contains("ghp_") && d.ends_with("/secret.txt"),
            "the one set of words, scrubbed: {d}"
        );
        assert_eq!(p.steps, None, "a push counts no steps");
        f.on_push(&push("tool.end", "kai", "r1", &json!({})));
        assert_eq!(kai(&f).state, State::Thinking);
        f.on_push(&push("turn.end", "kai", "r1", &json!({"tool": ""})));
        assert_eq!(kai(&f).state, State::Done);
        // a session the poll has not listed waits for it; then the push stands
        f.on_push(&push(
            "tool.start",
            "kai",
            "r2",
            &json!({"tool": "terminal", "args": {"command": "cargo test"}}),
        ));
        assert!(f.take_poke(), "the poll is asked to list it");
        assert_ne!(
            kai(&f).activity,
            "terminal",
            "not shown before the poll lists it"
        );
        let r1_done = Live {
            status: crate::local_api::presence::Status::Idle,
            ..room.clone()
        };
        let r2 = Live {
            session_id: "r2".into(),
            ..room.clone()
        };
        f.on_poll("kai", &[r1_done, r2], &HashMap::new());
        let p = kai(&f);
        assert_eq!(
            (p.detail.as_deref(), p.source),
            (Some("Run a command · cargo test"), Some(Source::Room)),
            "the poll's kind stands"
        );
        f.on_push(&push("turn.end", "kai", "r2", &json!({"tool": ""})));
        // a scheduled run no poll lists stands on its pushes
        f.on_push(&push(
            "tool.start",
            "kai",
            "local-9f",
            &json!({"cron": "a1b2c3"}),
        ));
        let p = kai(&f);
        assert_eq!((p.state, p.source), (State::Working, Some(Source::Cron)));
        f.on_poll("kai", &[], &HashMap::new());
        assert_eq!(
            kai(&f).source,
            Some(Source::Cron),
            "no poll lists it, and it stands"
        );
        assert_eq!(
            f.cron_run_ended("kai", "a1b2c3", false).as_deref(),
            Some("local-9f")
        );
        assert_eq!(
            kai(&f).state,
            State::Done,
            "its run is over, as the cron list says"
        );
        assert_eq!(
            f.cron_run_ended("kai", "a1b2c3", false),
            None,
            "handed back once"
        );
        // the host's own link says it finer; a bot not on the roster says nothing
        f.on_frame("kai", &frame("message.start", "s1", None, None));
        f.on_push(&push(
            "tool.start",
            "kai",
            "s1",
            &json!({"tool": "web_fetch"}),
        ));
        f.on_push(&push("tool.start", "stranger", "x1", &json!({"cron": "j"})));
        assert!(
            f.presence()
                .iter()
                .all(|p| p.activity != "web_fetch" && p.profile != "stranger")
        );
    }

    #[tokio::test]
    async fn an_approval_is_a_row_an_urgent_notification_and_a_needs_state() {
        let (f, _d) = feed();
        let mut rx = f.subscribe(None).rx;
        ask(&f, "p1");
        let rows = f.approvals(false);
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(
            (
                r.profile.as_str(),
                r.session_id.as_str(),
                r.execution_generation
            ),
            ("kai", "s1", 5)
        );
        assert!(r.governed, "Kai runs governed");
        assert_eq!(r.answerable_with, ["once", "deny"]);
        assert_eq!(r.origin.tool.as_deref(), Some("terminal"));
        let events = drain(&mut rx);
        assert!(events.iter().any(|e| matches!(&e.event, Event::Notification(n) if n.kind == NoteKind::Approval && n.urgent)));
        assert_eq!(f.presence()[0].state, State::Needs);
        assert_eq!(f.presence()[0].attention.as_deref(), Some("approval"));
    }

    #[tokio::test]
    async fn two_clients_answer_at_once_and_exactly_one_is_delivered() {
        let (f, dir) = feed();
        ask(&f, "p1");
        let first = f
            .begin_answer("p1", "once", Some(5), who("endpoint"))
            .unwrap();
        let second = f
            .begin_answer("p1", "deny", None, who("endpoint"))
            .unwrap_err();
        assert!(matches!(second, Refusal::AlreadyAnswered(Some(ref a)) if a.surface == "endpoint"));
        f.finish_answer(&first, &Delivery::Delivered);
        let after = f.approval("p1").unwrap();
        assert_eq!(after.state, ApprovalState::Settled);
        assert_eq!(after.answered_by.unwrap().surface, "endpoint");
        let lines = std::fs::read_to_string(Audit::under(dir.path()).path()).unwrap();
        let rows: Vec<Value> = lines
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["outcome"], "refused:already_answered");
        assert!(rows[0].get("client").is_none());
        assert_eq!(rows[1]["outcome"], "delivered");
        assert_eq!(rows[1]["surface"], "endpoint");
        assert_eq!(rows[1]["choice"], "once");
    }

    #[tokio::test]
    async fn the_windows_own_answer_is_seen_on_the_proxy_and_recorded_as_the_windows() {
        let (f, dir) = feed();
        ask(&f, "p1");
        f.on_frame(
            "kai",
            &FeedFrame {
                direction: Direction::Out,
                name: "approval.respond".into(),
                session_id: Some("s1".into()),
                generation: None,
                payload: Some(json!({"session_id": "s1", "prompt_id": "p1", "choice": "once", "execution_generation": 5})),
            },
        );
        f.on_frame(
            "kai",
            &frame(
                "approval.settled",
                "s1",
                Some(json!({"prompt_id": "p1"})),
                None,
            ),
        );
        let row = f.approval("p1").unwrap();
        assert_eq!(row.state, ApprovalState::Settled);
        let by = row.answered_by.unwrap();
        assert_eq!(by.surface.as_str(), "gui");
        let text = std::fs::read_to_string(Audit::under(dir.path()).path()).unwrap();
        assert!(text.contains("\"surface\":\"gui\""));
        assert!(
            f.begin_answer("p1", "once", None, who("endpoint")).is_err(),
            "a settled approval takes no answer"
        );
    }

    #[tokio::test]
    async fn a_request_with_no_generation_is_never_offered_for_answer() {
        let (f, _d) = feed();
        f.on_frame(
            "kai",
            &frame(
                "approval.request",
                "s1",
                Some(json!({"prompt_id": "p9", "choices": ["once", "deny"]})),
                None,
            ),
        );
        assert!(f.approvals(false).is_empty());
    }

    #[tokio::test]
    async fn text_from_the_engine_is_scrubbed_before_it_leaves() {
        let (f, _d) = feed();
        f.never_say(vec!["f00dfeedbeef1234cafe".into()]);
        let mut rx = f.subscribe(None).rx;
        f.on_frame(
            "kai",
            &frame(
                "approval.request",
                "s1",
                Some(json!({"prompt_id": "p1", "command": "curl -H 'Authorization: Bearer abcDEF1234567890' f00dfeedbeef1234cafe", "description": "password: hunter2hunter2", "choices": ["once", "deny"]})),
                Some(1),
            ),
        );
        let all = format!(
            "{:?}{}",
            f.approvals(true),
            serde_json::to_string(
                &drain(&mut rx)
                    .iter()
                    .map(|e| (**e).clone())
                    .collect::<Vec<_>>()
            )
            .unwrap()
        );
        for secret in ["abcDEF1234567890", "f00dfeedbeef1234cafe", "hunter2"] {
            assert!(!all.contains(secret), "{secret} leaked: {all}");
        }
    }

    #[tokio::test]
    async fn a_stream_that_resumes_gets_what_it_missed_and_is_told_of_a_gap() {
        let (f, _d) = feed();
        f.on_frame("kai", &frame("message.start", "s1", None, None));
        let mark = f.last_id();
        f.on_frame("kai", &frame("message.delta", "s1", None, None));
        f.on_frame(
            "kai",
            &frame("message.complete", "s1", Some(json!({"text": "x"})), None),
        );
        let sub = f.subscribe(Some(mark));
        assert!(sub.backlog.iter().all(|e| e.id > mark) && !sub.backlog.is_empty() && !sub.gap);
        let small = Feed::new(
            Audit::under(tempfile::tempdir().unwrap().path()),
            ApiLimits {
                ring: 16,
                ..ApiLimits::default()
            },
        );
        for i in 0..40 {
            small.on_frame(
                "kai",
                &frame(
                    if i % 2 == 0 {
                        "message.delta"
                    } else {
                        "tool.start"
                    },
                    "s1",
                    Some(json!({"name": format!("t{i}")})),
                    None,
                ),
            );
        }
        assert!(
            small.subscribe(Some(1)).gap,
            "the ring no longer holds event 2"
        );
    }

    #[tokio::test]
    async fn consumers_are_counted_so_the_poll_runs_only_while_someone_listens() {
        let (f, _d) = feed();
        let watch = f.wanted();
        assert_eq!(*watch.borrow(), 0);
        let a = f.consumer();
        let sub = f.subscribe(None);
        assert_eq!(*watch.borrow(), 2);
        drop(a);
        drop(sub);
        assert_eq!(*watch.borrow(), 0);
    }

    #[tokio::test]
    async fn a_poll_of_another_programs_session_gives_presence_and_a_waiting_session_gives_needs() {
        let (f, _d) = feed();
        f.set_roster(vec![Entry {
            name: "nina".into(),
            display_name: "Nina".into(),
            role: String::new(),
            model: None,
            provider: None,
            look: look_for("Nina"),
            known_to_boopis: false,
            governed: false,
        }]);
        let none = HashMap::new();
        let live = |status| Live {
            session_id: "i1".into(),
            status,
            source: Source::Other,
            summary: None,
        };
        f.on_poll(
            "nina",
            &[live(crate::local_api::presence::Status::Working)],
            &none,
        );
        let p = &f.presence()[0];
        assert_eq!((p.state, p.source), (State::Working, Some(Source::Other)));
        f.on_poll(
            "nina",
            &[live(crate::local_api::presence::Status::Waiting)],
            &none,
        );
        assert_eq!(f.presence()[0].state, State::Needs);
        assert_eq!(
            f.presence()[0].attention.as_deref(),
            Some("input"),
            "no approval is known, so it is a question"
        );
    }

    #[tokio::test]
    async fn only_another_programs_finished_turn_is_handed_on_by_the_poll() {
        use crate::local_api::presence::Status::{Idle, Working};
        let (f, _d) = feed();
        let mut rx = f.subscribe(None).rx;
        let none = HashMap::new();
        let live = |sid: &str, status, source: &str| Live {
            session_id: sid.into(),
            status,
            source: crate::local_api::model::source_of(source),
            summary: None,
        };
        f.on_poll(
            "kai",
            &[
                live("c1", Working, "cron"),
                live("i1", Working, "gui"),
                live("o1", Working, "cli"),
            ],
            &none,
        );
        let finished = f.on_poll(
            "kai",
            &[
                live("c1", Idle, "cron"),
                live("i1", Idle, "gui"),
                live("o1", Idle, "cli"),
            ],
            &none,
        );
        assert_eq!(
            finished
                .iter()
                .map(|d| d.session_id.as_str())
                .collect::<Vec<_>>(),
            ["o1"],
            "the app's own turn is told on its link and a scheduled run from the cron list (B42)"
        );
        f.notify_finished(&finished[0], "");
        let notes: Vec<Notification> = drain(&mut rx)
            .iter()
            .filter_map(|e| match &e.event {
                Event::Notification(n) => Some(n.clone()),
                _ => None,
            })
            .collect();
        assert!(
            notes.is_empty(),
            "B22: a reply with no words is not sent: {notes:?}"
        );
    }

    #[test]
    fn a_session_the_scheduler_named_is_a_scheduled_runs() {
        let (f, _d) = feed();
        assert!(is_cron_id("cron_a1b2c3d4e5f6_20261123_030000"));
        assert!(is_cron_id("cron_job-1_20261123_030000"));
        for not in [
            "cron_20261123_030000",
            "cron_x_2026_030000",
            "20261123_030000_ab12cd",
            "cronjob",
        ] {
            assert!(!is_cron_id(not), "{not}");
        }
        assert_eq!(
            f.resolve_source("kai", "live-1", "cron_j1_20261123_030000", "", ""),
            Source::Cron,
            "by its stored id"
        );
        assert_eq!(f.resolve_source("kai", "live-2", "", "", ""), Source::Other);
    }

    #[tokio::test]
    async fn a_look_or_a_model_that_changes_is_a_bots_changed_event() {
        let (f, _d) = feed();
        let mut rx = f.subscribe(None).rx;
        let mut e = Entry {
            name: "kai".into(),
            display_name: "Kai".into(),
            role: String::new(),
            model: Some("sonnet".into()),
            provider: None,
            look: look_for("Kai"),
            known_to_boopis: true,
            governed: true,
        };
        f.set_roster(vec![e.clone()]);
        e.look.color = "#f23b5a".into();
        f.set_roster(vec![e]);
        let moved: Vec<Vec<String>> = drain(&mut rx)
            .iter()
            .filter_map(|e| match &e.event {
                Event::BotsChanged { names } => Some(names.clone()),
                _ => None,
            })
            .collect();
        // The first roster is the baseline a snapshot reads, not a change; the new colour is the one event.
        assert_eq!(moved, [vec!["kai".to_owned()]]);
    }

    fn messages(rx: &mut broadcast::Receiver<Arc<Stamped>>) -> Vec<(String, String, MessageState)> {
        drain(rx)
            .iter()
            .filter_map(|e| match &e.event {
                Event::Conversation(c) => Some((
                    c.message.id.clone(),
                    c.message.text.clone(),
                    c.message.state,
                )),
                _ => None,
            })
            .collect()
    }

    fn out(name: &str, sid: &str, payload: Value) -> FeedFrame {
        FeedFrame {
            direction: Direction::Out,
            name: name.into(),
            session_id: Some(sid.into()),
            generation: None,
            payload: Some(payload),
        }
    }

    #[tokio::test]
    async fn a_conversation_is_made_only_for_a_reader_that_follows_it() {
        let (f, _d) = feed();
        let mut rx = f.subscribe(None).rx;
        f.on_frame(
            "kai",
            &out(
                "prompt.submit",
                "s1",
                json!({"session_id": "s1", "text": "hi"}),
            ),
        );
        f.on_frame("kai", &frame("message.start", "s1", None, None));
        f.on_frame(
            "kai",
            &frame("message.delta", "s1", Some(json!({"text": "x"})), None),
        );
        assert!(
            messages(&mut rx).is_empty(),
            "nobody follows: nothing is kept"
        );
        let _follower = f.follower();
        f.on_frame(
            "kai",
            &out(
                "prompt.submit",
                "s1",
                json!({"session_id": "s1", "text": "hi"}),
            ),
        );
        assert_eq!(messages(&mut rx).len(), 1);
    }

    #[tokio::test]
    async fn a_reply_streams_in_steps_and_finishes_under_one_id() {
        let dir = tempfile::tempdir().unwrap();
        let f = Feed::new(
            Audit::under(dir.path()),
            ApiLimits {
                stream_every: std::time::Duration::from_millis(40),
                ..ApiLimits::default()
            },
        );
        let _follower = f.follower();
        let mut rx = f.subscribe(None).rx;
        f.on_frame("kai", &frame("message.start", "s1", None, None));
        for piece in ["a", "b", "c"] {
            f.on_frame(
                "kai",
                &frame("message.delta", "s1", Some(json!({"text": piece})), None),
            );
        }
        let first = messages(&mut rx);
        assert_eq!(
            first.len(),
            1,
            "deltas inside the interval make no event of their own: {first:?}"
        );
        assert_eq!(first[0].2, MessageState::Streaming);
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        f.tick();
        let grown = messages(&mut rx);
        assert_eq!(grown.len(), 1);
        assert_eq!(
            (grown[0].0.as_str(), grown[0].1.as_str()),
            (first[0].0.as_str(), "abc"),
            "a tick sends what grew"
        );
        f.on_frame(
            "kai",
            &frame(
                "message.complete",
                "s1",
                Some(json!({"text": "abcd", "outcome": "completed"})),
                None,
            ),
        );
        let done = messages(&mut rx);
        assert_eq!(
            done,
            [(first[0].0.clone(), "abcd".to_owned(), MessageState::Done)]
        );
        f.on_frame("kai", &frame("message.start", "s1", None, None));
        assert_ne!(
            messages(&mut rx)[0].0,
            first[0].0,
            "the next reply is another message"
        );
    }

    #[tokio::test]
    async fn replies_are_sent_again_at_the_fastest_pace_any_follower_asked_for() {
        // B46
        let (f, _d) = feed();
        let ms = std::time::Duration::from_millis;
        assert_eq!(f.stream_every(), ms(250), "nobody asked: the default");
        let slow = f.follower_at(ms(1000));
        assert_eq!(f.stream_every(), ms(1000));
        let fast = f.follower_at(ms(50));
        let also = f.follower_at(ms(50));
        assert_eq!(f.stream_every(), ms(50));
        drop(fast);
        assert_eq!(f.stream_every(), ms(50), "one still asks for 50");
        drop(also);
        assert_eq!(f.stream_every(), ms(1000));
        assert_eq!(*f.text_wanted().borrow(), 1);
        drop(slow);
        assert_eq!((f.stream_every(), *f.text_wanted().borrow()), (ms(250), 0));
    }

    #[tokio::test]
    async fn a_conversation_names_the_stored_session_once_it_is_known_and_asks_to_be_told_before() {
        let (f, _d) = feed();
        let _follower = f.follower();
        let mut rx = f.subscribe(None).rx;
        f.on_frame(
            "kai",
            &out(
                "prompt.submit",
                "live-1",
                json!({"session_id": "live-1", "text": "hi"}),
            ),
        );
        let ids = |rx: &mut broadcast::Receiver<Arc<Stamped>>| -> Vec<String> {
            drain(rx)
                .iter()
                .filter_map(|e| match &e.event {
                    Event::Conversation(c) => Some(c.session_id.clone()),
                    _ => None,
                })
                .collect()
        };
        assert_eq!(ids(&mut rx), ["live-1"]);
        assert!(f.take_poke(), "an unseen session asks the poll to list it");
        f.note_session("kai", "live-1", Source::Gui, Some("stored-1"), None);
        f.on_frame(
            "kai",
            &out(
                "prompt.submit",
                "live-1",
                json!({"session_id": "live-1", "text": "again"}),
            ),
        );
        assert_eq!(ids(&mut rx), ["stored-1"]);
    }

    #[tokio::test]
    async fn a_long_message_is_cut_and_its_secrets_removed_before_it_leaves() {
        let dir = tempfile::tempdir().unwrap();
        let f = Feed::new(
            Audit::under(dir.path()),
            ApiLimits {
                message_cap: 30,
                ..ApiLimits::default()
            },
        );
        f.never_say(vec!["f00dfeedbeef1234cafe".into()]);
        let _follower = f.follower();
        let mut rx = f.subscribe(None).rx;
        f.on_user_message(
            "kai",
            "s1",
            "line one\nf00dfeedbeef1234cafe and then a very long tail of words",
        );
        let got = drain(&mut rx);
        let Event::Conversation(c) = &got[0].event else {
            panic!("{got:?}")
        };
        assert!(
            c.message.truncated && c.message.text.chars().count() <= 30,
            "{:?}",
            c.message
        );
        assert!(
            c.message.text.contains('\n') && !c.message.text.contains("f00dfeed"),
            "{:?}",
            c.message
        );
    }
}
