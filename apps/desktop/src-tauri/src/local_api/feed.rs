//! The feed: the one place the local API's state lives and its events are made (`ADR-0045`). It holds the roster, every
//! bot's presence, the notifications and the approvals inbox, stamps each event with a counter, keeps the last few for a
//! stream that resumes, and broadcasts them. It does no I/O: the service tells it what the engine said and asks it what
//! to say next, so every rule here is tested with scripted frames.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::Value;
use tokio::sync::{broadcast, watch};

use super::approvals::{Delivery, Inbox, Refusal};
use super::audit::{Audit, Line};
use super::model::{
    Answered, Approval, ApprovalState, BotRow, ConversationMessage, Event, Message, MessageState,
    NoteKind, Notification, Origin, Presence, Role, RoomHeldEvent, RoomRow, Source, Stamped, State,
    now_ms,
};
use super::presence::{Live, Table};
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
}

/// The feed. Cheap to share.
pub struct Feed {
    inner: Mutex<Inner>,
    tx: broadcast::Sender<Arc<Stamped>>,
    wanted: watch::Sender<usize>,
    text_wanted: watch::Sender<usize>,
    followers: AtomicUsize,
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
}

impl Drop for Follower {
    fn drop(&mut self) {
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
            }),
            tx,
            wanted: watch::channel(0).0,
            text_wanted: watch::channel(0).0,
            followers: AtomicUsize::new(0),
            listeners: AtomicUsize::new(0),
            poke: AtomicBool::new(false),
            audit,
            limits,
            secrets: Mutex::new(Vec::new()),
        })
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

    /// Count a reader that follows conversations.
    #[must_use]
    pub fn follower(self: &Arc<Self>) -> Follower {
        let n = self.followers.fetch_add(1, Ordering::SeqCst) + 1;
        self.text_wanted.send_replace(n);
        Follower { feed: self.clone() }
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
        inner.meta.insert(
            (profile.to_owned(), session_id.to_owned()),
            Meta {
                source: Some(source),
                stored: stored.filter(|s| !s.is_empty()).map(str::to_owned),
                model: model.map(str::to_owned),
            },
        );
    }

    /// Whether the feed already knows a session's kind, so the poller notes it once.
    #[must_use]
    pub fn session_known(&self, profile: &str, session_id: &str) -> bool {
        lock(&self.inner)
            .meta
            .contains_key(&(profile.to_owned(), session_id.to_owned()))
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
        if !inner
            .meta
            .contains_key(&(profile.to_owned(), session_id.to_owned()))
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
        let every = i64::try_from(self.limits.stream_every.as_millis()).unwrap_or(250);
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

    /// Make a notification, unless the same kind for the same session was made a moment ago.
    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        inner: &mut Inner,
        kind: NoteKind,
        profile: &str,
        session_id: Option<&str>,
        source: Source,
        title: String,
        body: String,
        urgent: bool,
    ) {
        let now = now_ms();
        let key = (
            profile.to_owned(),
            session_id.unwrap_or_default().to_owned(),
            kind as u8,
        );
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
            session_id: session_id.map(str::to_owned),
            room_id: None,
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
        let origin = Self::origin(&inner, profile, sid);
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
                let changed = inner
                    .presence
                    .on_event(profile, sid, &f.name, None, false, origin, now);
                self.publish(&mut inner, changed);
            }
            "tool.start" | "tool.generating" | "tool.progress" => {
                let tool = ["name", "tool_name", "tool"]
                    .iter()
                    .map(|k| str_of(&payload, k))
                    .find(|s| !s.is_empty());
                let tool = tool.map(|t| self.clip(&t));
                let changed = inner.presence.on_event(
                    profile,
                    sid,
                    &f.name,
                    tool.as_deref(),
                    false,
                    origin,
                    now,
                );
                self.publish(&mut inner, changed);
            }
            "message.complete" => {
                let outcome = str_of(&payload, "outcome");
                let failed = matches!(outcome.as_str(), "failed" | "error");
                let changed = inner
                    .presence
                    .on_event(profile, sid, &f.name, None, failed, origin, now);
                self.publish(&mut inner, changed);
                let who = Self::display(&inner, profile);
                if failed {
                    self.notify(
                        &mut inner,
                        NoteKind::Error,
                        profile,
                        Some(sid),
                        origin,
                        format!("{who} hit an error"),
                        String::new(),
                        false,
                    );
                } else {
                    let text = self.clip(&str_of(&payload, "text"));
                    self.notify(
                        &mut inner,
                        NoteKind::Reply,
                        profile,
                        Some(sid),
                        origin,
                        format!("{who} replied"),
                        text,
                        false,
                    );
                }
            }
            "error" | "turn.failed" => {
                let changed = inner
                    .presence
                    .on_event(profile, sid, &f.name, None, true, origin, now);
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
                    Some(sid),
                    origin,
                    format!("{who} hit an error"),
                    why,
                    false,
                );
            }
            _ => {
                let changed = inner
                    .presence
                    .on_event(profile, sid, &f.name, None, false, origin, now);
                self.publish(&mut inner, changed);
            }
        }
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
        let changed =
            inner
                .presence
                .on_event(profile, sid, "approval.request", None, false, origin, now);
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
                Some(&sid),
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

    /// The live sessions of one profile's link.
    pub fn on_poll(&self, profile: &str, rows: &[Live], models: &HashMap<String, String>) {
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
        let rows: Vec<Live> = rows.to_vec();
        for r in &rows {
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
                .on_poll(profile, &rows, &|s| inbox_waits.iter().any(|w| w == s), now);
        self.publish(&mut inner, changed);
        // A turn that ran and is now idle, in a session another surface runs: someone may want to know.
        let who = Self::display(&inner, profile);
        for r in &rows {
            let was = previous.get(&r.session_id).copied();
            let now_state = inner.presence.session_state(profile, &r.session_id);
            let finished =
                was.is_some_and(State::busy) && matches!(now_state, Some(State::Idle) | None);
            let source = super::model::source_of(&r.source);
            if finished && source != Source::Gui {
                let (kind, title) = if source == Source::Cron {
                    (NoteKind::Cron, format!("{who}'s scheduled run finished"))
                } else {
                    (NoteKind::Reply, format!("{who} finished a turn"))
                };
                self.notify(
                    &mut inner,
                    kind,
                    profile,
                    Some(&r.session_id),
                    source,
                    title,
                    String::new(),
                    false,
                );
            }
        }
        // A session the poll no longer lists has ended: a turn that was busy in it was finished or cut off.
        let ended = inner.presence.tick(now);
        self.publish(&mut inner, ended);
    }

    // ───────────────────────── rooms ─────────────────────────

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
        let growing: Vec<(String, String)> = inner
            .replies
            .iter()
            .filter(|(_, r)| r.dirty)
            .map(|(k, _)| k.clone())
            .collect();
        for (profile, sid) in growing {
            self.flush_reply(&mut inner, &profile, &sid, now);
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
            source: "cli".into(),
        };
        f.on_poll(
            "nina",
            &[live(crate::local_api::presence::Status::Working)],
            &none,
        );
        let p = &f.presence()[0];
        assert_eq!((p.state, p.source), (State::Working, Source::Other));
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
    async fn a_cron_run_that_finishes_is_a_notification_and_a_turn_in_the_app_is_not() {
        use crate::local_api::presence::Status::{Idle, Working};
        let (f, _d) = feed();
        let mut rx = f.subscribe(None).rx;
        let none = HashMap::new();
        let live = |sid: &str, status, source: &str| Live {
            session_id: sid.into(),
            status,
            source: source.into(),
        };
        f.on_poll(
            "kai",
            &[live("c1", Working, "cron"), live("i1", Working, "gui")],
            &none,
        );
        f.on_poll(
            "kai",
            &[live("c1", Idle, "cron"), live("i1", Idle, "gui")],
            &none,
        );
        let notes: Vec<Notification> = drain(&mut rx)
            .iter()
            .filter_map(|e| match &e.event {
                Event::Notification(n) => Some(n.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_eq!(
            (notes[0].kind, notes[0].source),
            (NoteKind::Cron, Source::Cron)
        );
        assert_eq!(notes[0].session_id.as_deref(), Some("c1"));
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
