//! The service: it asks the engine what the feed needs (while somebody listens) and does what clients ask (say something to a
//! bot or a room, answer an approval). Every engine question goes through [`Engine`]; every answer is cut into the feed's
//! own types before it goes anywhere (`ADR-0045`).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::approvals::{Delivery, Refusal};
use super::engine::Engine;
use super::feed::Feed;
use super::model::{
    Answered, Approval, ApprovalState, Conversation, Message, MessageState, Origin, Role, RoomRow,
    Source,
};
use super::presence::{Live, Status};
use super::roster;
use crate::config::{ApiLimits, RoomLimits};
use crate::error::Error;
use crate::rooms::hold;

/// The profile whose link holds the roster, the rooms and the plugin: the root.
pub(super) const ROOT: &str = "default";

/// A refusal or a failure, in the words a client reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    /// The HTTP status.
    pub status: u16,
    /// A short code, stable.
    pub code: &'static str,
    /// What happened and what to do. Never holds a token, a path or the engine's raw words.
    pub message: String,
}

impl ApiError {
    pub(super) fn new(status: u16, code: &'static str, message: &str) -> Self {
        Self {
            status,
            code,
            message: message.to_owned(),
        }
    }
}

impl From<Refusal> for ApiError {
    fn from(r: Refusal) -> Self {
        let status = match r {
            Refusal::Unknown => 404,
            Refusal::AlreadyAnswered(_) | Refusal::Expired | Refusal::Generation { .. } => 409,
            Refusal::Policy(_) => 403,
            Refusal::NotOffered(_) => 400,
        };
        Self {
            status,
            code: r.code(),
            message: r.message(),
        }
    }
}

/// Which session a message goes to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pick {
    /// The bot's newest conversation (the engine's `last_session`), else a new one.
    Latest,
    /// A new session.
    New,
    /// A stored session by id.
    Id(String),
}

impl Pick {
    /// Read the `session` field of a request: absent is `latest`.
    ///
    /// # Errors
    /// A word that is not `latest`, `new` or a plausible id.
    pub fn parse(word: Option<&str>) -> Result<Self, ApiError> {
        match word.map(str::trim) {
            None | Some("" | "latest") => Ok(Self::Latest),
            Some("new") => Ok(Self::New),
            Some(id)
                if id.len() <= 128
                    && id.bytes().all(|b| {
                        b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-')
                    }) =>
            {
                Ok(Self::Id(id.to_owned()))
            }
            Some(_) => Err(ApiError::new(
                400,
                "bad_session",
                "session is latest, new or the id of one of the bot's sessions.",
            )),
        }
    }
}

/// What a message to a bot did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Said {
    /// The bot.
    pub profile: String,
    /// The session's stored id, when the engine named one (what `session` accepts next time).
    pub session_id: String,
    /// Whether a new session was made.
    pub created: bool,
}

/// Where a call came from. Never who: the contract does not tell clients apart, so this is only the surface the call came
/// through, for the security record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// `endpoint` (the local API) or `gui`.
    pub surface: &'static str,
}

impl Caller {
    /// A call through `surface`.
    #[must_use]
    pub const fn through(surface: &'static str) -> Self {
        Self { surface }
    }
}

/// The service.
pub struct Service<E: Engine> {
    pub(super) feed: Arc<Feed>,
    pub(super) engine: Arc<E>,
    pub(super) limits: ApiLimits,
    described: tokio::sync::Mutex<HashMap<String, Value>>,
    /// The room hold's file (`rooms/hold.rs`) and its rules: the app's room, the command line and this API send through it.
    pub(super) holds: hold::Store,
    pub(super) room_limits: RoomLimits,
    /// The rooms the hold's pump reads, by id.
    pub(super) watches: tokio::sync::Mutex<HashMap<String, hold::Watch>>,
}

pub(super) fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

pub(super) fn failed(what: &str, e: &Error) -> ApiError {
    tracing::debug!(error = %e, "the local API could not {what}");
    ApiError::new(
        502,
        "engine_unavailable",
        &format!("boopis could not {what}: its engine did not answer. Try again in a moment."),
    )
}

impl<E: Engine> Service<E> {
    /// A service over `engine` that feeds `feed`, with the room hold kept in `holds`.
    pub fn new(
        feed: Arc<Feed>,
        engine: Arc<E>,
        limits: ApiLimits,
        holds: hold::Store,
        room_limits: RoomLimits,
    ) -> Arc<Self> {
        Arc::new(Self {
            feed,
            engine,
            limits,
            described: tokio::sync::Mutex::new(HashMap::new()),
            holds,
            room_limits,
            watches: tokio::sync::Mutex::new(HashMap::new()),
        })
    }

    /// The feed.
    #[must_use]
    pub fn feed(&self) -> &Arc<Feed> {
        &self.feed
    }

    // ───────────────────────── reading the engine ─────────────────────────

    /// Read the roster and the rooms.
    pub async fn refresh_roster(&self) {
        let profiles = self
            .engine
            .request(ROOT, "profiles.list", json!({"include_sessions": false}))
            .await;
        let Ok(profiles) = profiles else {
            return;
        };
        let plugin = self
            .engine
            .request(ROOT, "plugin.boopis.bots.read", json!({}))
            .await
            .ok();
        let mut described = self.described.lock().await;
        for name in roster::needs_describe(&profiles).into_iter().take(16) {
            if described.contains_key(&name) {
                continue;
            }
            if let Ok(d) = self
                .engine
                .request(ROOT, "profiles.describe", json!({"name": name}))
                .await
            {
                let has_model = d
                    .get("model")
                    .and_then(|m| m.get("default"))
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty());
                if has_model {
                    described.insert(name, d);
                }
            }
        }
        self.feed
            .set_roster(roster::build(&profiles, plugin.as_ref(), &described));
        drop(described);
        if let Ok(rooms) = self
            .engine
            .request(ROOT, "groups.list", json!({"limit": 500}))
            .await
        {
            self.feed.set_rooms(rooms_from(&rooms));
        }
    }

    /// Ask every bot's link which sessions are live, and what is waiting on the owner.
    pub async fn poll_once(&self) {
        let mut names = self.feed.bot_names();
        if !names.iter().any(|n| n == ROOT) {
            names.push(ROOT.to_owned());
        }
        for profile in names {
            self.poll_profile(&profile).await;
        }
        self.feed.tick();
    }

    async fn poll_profile(&self, profile: &str) {
        let Ok(list) = self
            .engine
            .request(profile, "session.active_list", json!({}))
            .await
        else {
            return;
        };
        let rows = list
            .get("sessions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut live = Vec::new();
        let mut models = HashMap::new();
        let mut waiting = Vec::new();
        for row in &rows {
            let sid = text(row, "id");
            if sid.is_empty() {
                continue;
            }
            if !self.feed.session_known(profile, &sid) {
                let model = Some(text(row, "model")).filter(|m| !m.is_empty());
                self.feed.note_session(
                    profile,
                    &sid,
                    super::model::source_of(&text(row, "source")),
                    Some(text(row, "session_key")).as_deref(),
                    model.as_deref(),
                );
            }
            let status = Status::parse(&text(row, "status"));
            if status == Status::Waiting {
                waiting.push(sid.clone());
            }
            let model = text(row, "model");
            if !model.is_empty() {
                models.insert(sid.clone(), model);
            }
            live.push(Live {
                session_id: sid,
                status,
                source: text(row, "source"),
            });
        }
        self.feed.on_poll(profile, &live, &models);
        for sid in waiting {
            self.read_pending(profile, &sid).await;
        }
    }

    /// `approval.pending` for a waiting session, with each new approval's generation read off the session's ring.
    async fn read_pending(&self, profile: &str, sid: &str) {
        let Ok(pending) = self
            .engine
            .request(profile, "approval.pending", json!({"session_id": sid}))
            .await
        else {
            return;
        };
        let rows = pending
            .get("approvals")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut found = Vec::new();
        let mut ring: Option<Vec<Value>> = None;
        for row in &rows {
            let id = text(row, "request_id");
            if id.is_empty() {
                continue;
            }
            if self.feed.knows_approval(profile, &id) {
                found.push(self.known_row(profile, &id));
                continue;
            }
            if ring.is_none() {
                let since = self
                    .engine
                    .request(
                        profile,
                        "session.events.since",
                        json!({"session_id": sid, "last_seen": 0}),
                    )
                    .await
                    .ok();
                ring = Some(
                    since
                        .and_then(|s| s.get("events").and_then(Value::as_array).cloned())
                        .unwrap_or_default(),
                );
            }
            let ask = ring.iter().flatten().rev().find(|e| {
                text(e, "type") == "approval.request"
                    && e.get("payload")
                        .is_some_and(|p| text(p, "prompt_id") == id || text(p, "request_id") == id)
            });
            let Some(ask) = ask else { continue };
            let Some(generation) = ask.get("execution_generation").and_then(Value::as_u64) else {
                continue;
            };
            let payload = ask.get("payload").cloned().unwrap_or(Value::Null);
            let choices: Vec<String> = row
                .get("choices")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            found.push(Some(Approval {
                id: id.clone(),
                profile: profile.to_owned(),
                session_id: sid.to_owned(),
                prompt_id: id,
                execution_generation: generation,
                command: text(row, "command"),
                description: text(row, "description"),
                choices,
                answerable_with: Vec::new(),
                timeout_s: payload.get("timeout_s").and_then(Value::as_u64),
                origin: Origin {
                    model: None,
                    tool: Some(text(&payload, "tool_name"))
                        .filter(|t| !t.is_empty())
                        .or_else(|| Some(text(row, "tool_name")).filter(|t| !t.is_empty())),
                },
                governed: false,
                state: ApprovalState::Pending,
                answered_by: None,
                asked_at: super::model::now_ms(),
            }));
        }
        let rows: Vec<Approval> = found.into_iter().flatten().collect();
        self.feed.on_pending(profile, sid, rows);
    }

    fn known_row(&self, _profile: &str, id: &str) -> Option<Approval> {
        self.feed.approval(id)
    }

    // ───────────────────────── what clients ask ─────────────────────────

    /// Say something to a bot.
    ///
    /// # Errors
    /// A refusal in words, or the engine's failure.
    #[allow(clippy::too_many_lines)] // one call: check, pick the conversation, start it, send
    pub async fn say(
        &self,
        profile: &str,
        message: &str,
        pick: &Pick,
        by: &Caller,
    ) -> Result<Said, ApiError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(ApiError::new(
                400,
                "empty_text",
                "There is nothing to say: text is empty.",
            ));
        }
        if message.len() > self.limits.max_say || message.contains('\0') {
            return Err(ApiError::new(
                413,
                "text_too_long",
                "The text is too long to send in one message.",
            ));
        }
        if !self.feed.has_bot(profile) && profile != ROOT {
            return Err(ApiError::new(
                404,
                "no_such_bot",
                "There is no bot with that name.",
            ));
        }
        let _ = by;
        let stored = match pick {
            Pick::New => None,
            Pick::Id(id) => Some(id.clone()),
            Pick::Latest => self.latest_of(profile).await,
        };
        let create = || async {
            let res = self
                .engine
                .request(profile, "session.create", json!({"source": "gui"}))
                .await
                .map_err(|e| failed("start a conversation", &e))?;
            let live = text(&res, "session_id");
            let kept = Some(text(&res, "stored_session_id"))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| live.clone());
            if live.is_empty() {
                return Err(ApiError::new(
                    502,
                    "engine_unavailable",
                    "The engine started no conversation. Try again.",
                ));
            }
            Ok::<_, ApiError>((live, kept, true))
        };
        let (live, kept, created) = match stored {
            None => create().await?,
            Some(id) => {
                let res = self
                    .engine
                    .request(
                        profile,
                        "session.resume",
                        json!({"session_id": id, "omit_messages": true}),
                    )
                    .await
                    .map_err(|e| failed("open that conversation", &e))?;
                if res.get("running").and_then(Value::as_bool) == Some(true) {
                    return Err(ApiError::new(
                        409,
                        "bot_busy",
                        "The bot is answering in that conversation. Wait for it to finish, or say it in a new one.",
                    ));
                }
                let live = text(&res, "session_id");
                if live.is_empty() {
                    return Err(ApiError::new(
                        404,
                        "no_such_session",
                        "That conversation could not be opened.",
                    ));
                }
                (live, id, false)
            }
        };
        self.feed
            .note_session(profile, &live, Source::Gui, Some(&kept), None);
        // The windows hear it before the engine does: the engine starts the reply at once and sends a window nothing for a
        // message another surface submits, so a chat that has this conversation open draws it first, as the owner's own.
        self.engine
            .said(
                profile,
                &live,
                json!({"text": message, "stored_session_id": kept}),
                false,
            )
            .await;
        if let Err(e) = self
            .engine
            .request(
                profile,
                "prompt.submit",
                json!({"session_id": live, "text": message, "submission_id": format!("api-{}", uuid::Uuid::now_v7())}),
            )
            .await
        {
            let refused = failed("deliver the message", &e);
            self.engine
                .said(
                    profile,
                    &live,
                    json!({"reason": refused.message, "stored_session_id": kept}),
                    true,
                )
                .await;
            return Err(refused);
        }
        self.feed.on_user_message(profile, &live, message);
        self.feed.on_frame(
            profile,
            &crate::gateway::FeedFrame {
                direction: crate::gateway::Direction::In,
                name: "host.prompt".into(),
                session_id: Some(live),
                generation: None,
                payload: None,
            },
        );
        Ok(Said {
            profile: profile.to_owned(),
            session_id: kept,
            created,
        })
    }

    /// Read a conversation: the words the app shows for a stored session of `profile`, oldest first. It is the engine's own
    /// stored transcript, read without attaching to the session, so what the owner typed in the app is in it and what a
    /// client said is too.
    ///
    /// # Errors
    /// A refusal in words (no such bot, no conversation, a `new` pick), or the engine's failure.
    pub async fn conversation(
        &self,
        profile: &str,
        pick: &Pick,
        limit: usize,
    ) -> Result<Conversation, ApiError> {
        if !self.feed.has_bot(profile) && profile != ROOT {
            return Err(ApiError::new(
                404,
                "no_such_bot",
                "There is no bot with that name.",
            ));
        }
        let stored = match pick {
            Pick::New => {
                return Err(ApiError::new(
                    400,
                    "bad_session",
                    "session is latest or the id of one of the bot's sessions; there is nothing to read in a new one.",
                ));
            }
            Pick::Id(id) => id.clone(),
            Pick::Latest => self.latest_of(profile).await.ok_or_else(|| {
                ApiError::new(404, "no_conversation", "That bot has no conversation yet.")
            })?,
        };
        let rows = limit.clamp(1, self.limits.conversation_rows);
        let last_event_id = self.feed.last_id();
        let page = self
            .engine
            .request(
                profile,
                "session.transcript",
                json!({"session_id": stored, "limit": rows, "order": "latest"}),
            )
            .await
            .map_err(|e| {
                let said = e.to_string().to_ascii_lowercase();
                if said.contains("not_found") || said.contains("not found") {
                    ApiError::new(404, "no_such_session", "That conversation does not exist.")
                } else {
                    failed("read that conversation", &e)
                }
            })?;
        let mut found: Vec<&Value> = page
            .get("rows")
            .and_then(Value::as_array)
            .map(|r| r.iter().collect())
            .unwrap_or_default();
        // The page's order is the engine's; the row ids say which came first.
        if found
            .iter()
            .all(|r| r.get("row_id").and_then(Value::as_i64).is_some())
        {
            found.sort_by_key(|r| r.get("row_id").and_then(Value::as_i64));
        }
        let messages = found
            .iter()
            .enumerate()
            .filter_map(|(i, row)| self.stored_message(row, i))
            .collect();
        Ok(Conversation {
            profile: profile.to_owned(),
            session_id: stored,
            messages,
            older: page.get("next_cursor").is_some_and(|c| !c.is_null()),
            last_event_id,
        })
    }

    /// One stored row as the app's thread draws it: the user's and the bot's words, no tool row, nothing hidden.
    fn stored_message(&self, row: &Value, index: usize) -> Option<Message> {
        let role = match text(row, "role").as_str() {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            _ => return None,
        };
        if text(row, "display_kind") == "hidden" || text(row, "row_kind") == "compaction" {
            return None;
        }
        let words = Some(text(row, "text"))
            .filter(|t| !t.trim().is_empty())
            .or_else(|| {
                row.get("content")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })?;
        if words.trim().is_empty() {
            return None;
        }
        let (words, truncated) = self.feed.message_text(&words);
        let id = row
            .get("row_id")
            .and_then(Value::as_i64)
            .map_or_else(|| format!("i{index}"), |n| format!("r{n}"));
        #[allow(clippy::cast_possible_truncation)] // a time in seconds, read as milliseconds
        let at = row
            .get("timestamp")
            .and_then(Value::as_f64)
            .map_or(0, |t| (t * 1000.0) as i64);
        Some(Message {
            id,
            role,
            text: words,
            truncated,
            at,
            state: MessageState::Done,
        })
    }

    /// The bot's latest conversation (B23): the newest row of `session.list` on the bot's own link, the call the app's bot
    /// view makes for the bot's recent sessions (`host/live/bots.ts`), so "latest" is the conversation the app lists first
    /// for that bot. The engine's roster (`profiles.list` on the root link) leaves a named bot's `canonical_session` and
    /// `last_session` out, so it is not read for this.
    pub(super) async fn latest_of(&self, profile: &str) -> Option<String> {
        let list = self
            .engine
            .request(
                profile,
                "session.list",
                json!({"limit": 1, "include_hidden": false}),
            )
            .await
            .ok()?;
        let row = list.get("sessions")?.as_array()?.first()?;
        Some(text(row, "resolved_id"))
            .filter(|x| !x.is_empty())
            .or_else(|| Some(text(row, "id")).filter(|x| !x.is_empty()))
    }

    /// Say something in a room, through the room hold: while its members work the message waits for them, as one written in
    /// the app does (B30). `now` stops the running turns first.
    ///
    /// # Errors
    /// A refusal in words, or the engine's failure.
    pub async fn say_room(
        &self,
        room: &str,
        message: &str,
        now: bool,
        by: &Caller,
    ) -> Result<super::rooms::RoomSent, ApiError> {
        if message.len() > self.limits.max_say {
            return Err(ApiError::new(
                413,
                "text_too_long",
                "The text is too long to send in one message.",
            ));
        }
        self.room_send(room, message, now, by).await
    }

    /// Answer an approval from outside the window.
    ///
    /// # Errors
    /// The refusal (first answer wins; once and deny only), or the engine's failure.
    pub async fn answer(
        &self,
        id: &str,
        choice: &str,
        generation: Option<u64>,
        by: &Caller,
    ) -> Result<Approval, ApiError> {
        let who = Answered {
            surface: by.surface.to_owned(),
            choice: None,
            at: super::model::now_ms(),
        };
        let row = self.feed.begin_answer(id, choice, generation, who)?;
        let result = self
            .engine
            .request(
                &row.profile,
                "approval.respond",
                json!({"session_id": row.session_id, "execution_generation": row.execution_generation, "prompt_id": row.prompt_id, "choice": choice}),
            )
            .await;
        let delivery = match &result {
            Ok(v) if v.get("resolved").and_then(Value::as_u64) == Some(0) => {
                Delivery::AlreadySettled
            }
            Ok(_) => Delivery::Delivered,
            Err(e) => {
                let t = e.to_string().to_ascii_lowercase();
                if t.contains("already")
                    || t.contains("settled")
                    || t.contains("not pending")
                    || t.contains("unknown prompt")
                {
                    Delivery::AlreadySettled
                } else {
                    Delivery::Failed
                }
            }
        };
        self.feed.finish_answer(&row, &delivery);
        match delivery {
            Delivery::Delivered => self
                .feed
                .approval(id)
                .ok_or_else(|| ApiError::new(404, "not_found", "The approval is gone.")),
            Delivery::AlreadySettled => Err(Refusal::AlreadyAnswered(None).into()),
            Delivery::Failed => Err(result.err().map_or_else(
                || {
                    ApiError::new(
                        502,
                        "engine_unavailable",
                        "The engine did not take the answer. Try again.",
                    )
                },
                |e| failed("deliver the answer", &e),
            )),
        }
    }

    // ───────────────────────── the loop ─────────────────────────

    /// Run until cancelled: while at least one reader listens, read the roster and poll the sessions.
    pub async fn run(self: Arc<Self>, cancel: CancellationToken) {
        let mut wanted = self.feed.wanted();
        loop {
            while *wanted.borrow_and_update() == 0 {
                tokio::select! {
                    () = cancel.cancelled() => return,
                    changed = wanted.changed() => if changed.is_err() { return },
                }
            }
            self.refresh_roster().await;
            let mut roster_at = tokio::time::Instant::now();
            let mut poll_at = tokio::time::Instant::now() - self.limits.poll_every;
            let mut beat = tokio::time::interval(Duration::from_millis(500));
            while *wanted.borrow() > 0 {
                tokio::select! {
                    () = cancel.cancelled() => return,
                    _ = beat.tick() => {}
                }
                let now = tokio::time::Instant::now();
                if now.duration_since(roster_at) >= self.limits.roster_every {
                    roster_at = now;
                    self.refresh_roster().await;
                }
                if self.feed.take_poke() || now.duration_since(poll_at) >= self.limits.poll_every {
                    poll_at = now;
                    self.poll_once().await;
                }
            }
        }
    }
}

fn rooms_from(v: &Value) -> Vec<RoomRow> {
    v.get("rooms")
        .and_then(Value::as_array)
        .map(|rooms| {
            rooms
                .iter()
                .filter(|r| r.get("disbanded_at").is_none_or(Value::is_null))
                .filter_map(|r| {
                    let id = text(r, "room_id");
                    (!id.is_empty()).then(|| RoomRow {
                        name: Some(text(r, "name"))
                            .filter(|n| !n.is_empty())
                            .unwrap_or_else(|| id.clone()),
                        members: r
                            .get("members")
                            .and_then(Value::as_array)
                            .map(|m| {
                                m.iter()
                                    .map(|x| text(x, "profile"))
                                    .filter(|p| !p.is_empty())
                                    .collect()
                            })
                            .unwrap_or_default(),
                        id,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_api::audit::Audit;
    use crate::local_api::engine::scripted::Scripted;
    use crate::local_api::model::State;

    type Calls = Arc<std::sync::Mutex<Vec<(String, String, Value)>>>;

    fn service(
        respond: impl Fn(&str, &str, &Value) -> crate::error::Result<Value> + Send + Sync + 'static,
    ) -> (Arc<Service<Scripted>>, Arc<Scripted>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let feed = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        let engine = Arc::new(Scripted::new(respond));
        (
            Service::new(
                feed,
                engine.clone(),
                ApiLimits::default(),
                hold::Store::under(dir.path()),
                RoomLimits::default(),
            ),
            engine,
            dir,
        )
    }

    fn roster_answer(method: &str) -> Option<Value> {
        match method {
            "profiles.list" => Some(json!({"profiles": [
                {"name": "default", "model": "opus", "provider": "p", "display_name": "", "description": ""},
                {"name": "kai", "model": "", "provider": "", "display_name": "Kai", "description": "editor"},
                {"name": "nina", "model": "sonnet", "provider": "p", "display_name": "", "description": ""}
            ]})),
            "plugin.boopis.bots.read" => Some(
                json!({"bots": [{"name": "kai", "record": {"look": {"shape": "star", "color": "#f23b5a"}}, "archived": null}]}),
            ),
            "profiles.describe" => Some(json!({"model": {"provider": "p", "default": "haiku"}})),
            "groups.list" => Some(json!({"rooms": [
                {"room_id": "g-paper", "name": "paper past", "members": [{"profile": "kai"}, {"profile": "nina"}]},
                {"room_id": "g-old", "name": "old", "members": [], "disbanded_at": 5}
            ]})),
            _ => None,
        }
    }

    #[tokio::test]
    async fn the_roster_has_the_look_the_model_the_rooms_and_nothing_archived() {
        let (s, _e, _d) =
            service(|_, m, _| roster_answer(m).ok_or_else(|| Error::Unavailable("no".into())));
        s.refresh_roster().await;
        let bots = s.feed().bots();
        assert_eq!(
            bots.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
            ["default", "kai", "nina"]
        );
        let kai = &bots[1];
        assert_eq!(kai.look.shape, "star");
        assert_eq!(
            kai.model.as_deref(),
            Some("p/haiku"),
            "B10: the model comes from the description"
        );
        assert_eq!(kai.display_name, "Kai");
        let rooms = s.feed().rooms();
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].members, ["kai", "nina"]);
    }

    fn poll_engine() -> impl Fn(&str, &str, &Value) -> crate::error::Result<Value> + Send + Sync {
        |profile, method, _params| {
            if let Some(v) = roster_answer(method) {
                return Ok(v);
            }
            match (profile, method) {
                ("kai", "session.active_list") => Ok(json!({"sessions": [
                    {"id": "isl-1", "status": "waiting", "source": "cli", "model": "opus"},
                    {"id": "cron-1", "status": "working", "source": "cron", "model": "opus"}
                ]})),
                (_, "session.active_list") => Ok(json!({"sessions": []})),
                ("kai", "approval.pending") => Ok(json!({"approvals": [
                    {"request_id": "pp1", "command": "rm -rf build", "description": "clean", "choices": ["once", "deny", "always"]}
                ]})),
                ("kai", "session.events.since") => Ok(json!({"events": [
                    {"type": "message.start", "payload": {}, "seq": 1, "execution_generation": 3},
                    {"type": "approval.request", "payload": {"prompt_id": "pp1", "timeout_s": 90, "tool_name": "terminal"}, "seq": 2, "execution_generation": 3}
                ]})),
                _ => Err(Error::Unavailable("unscripted".into())),
            }
        }
    }

    #[tokio::test]
    async fn a_poll_finds_a_waiting_session_its_approval_and_a_cron_run() {
        let (s, e, _d) = service(poll_engine());
        s.refresh_roster().await;
        s.poll_once().await;
        let kai = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "kai")
            .unwrap();
        assert_eq!(
            (kai.state, kai.source),
            (State::Needs, Source::Other),
            "needs outranks the cron run"
        );
        let rows = s.feed().approvals(false);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].execution_generation, rows[0].timeout_s),
            (3, Some(90))
        );
        assert_eq!(rows[0].answerable_with, ["once", "deny"]);
        assert_eq!(rows[0].origin.tool.as_deref(), Some("terminal"));
        assert_eq!(
            s.feed()
                .presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
                .attention
                .as_deref(),
            Some("approval")
        );
        s.poll_once().await;
        assert!(
            e.of("session.info").is_empty(),
            "no session is asked who made it: the contract does not tell clients apart"
        );
        assert_eq!(
            e.of("session.events.since").len(),
            1,
            "a known approval is not looked up again"
        );
    }

    #[tokio::test]
    async fn an_answer_through_the_api_reaches_the_engine_with_the_rows_own_generation() {
        let (s, e, dir) = service(|p, m, params| {
            if m == "approval.respond" {
                assert_eq!(
                    (
                        p,
                        params["session_id"].as_str(),
                        params["execution_generation"].as_u64()
                    ),
                    ("kai", Some("isl-1"), Some(3))
                );
                return Ok(json!({"resolved": 1}));
            }
            poll_engine()(p, m, params)
        });
        s.refresh_roster().await;
        s.poll_once().await;
        let by = Caller::through("endpoint");
        let done = s.answer("pp1", "once", None, &by).await.unwrap();
        assert_eq!(done.state, ApprovalState::Settled);
        assert_eq!(done.answered_by.unwrap().surface, "endpoint");
        let sent = e.of("approval.respond");
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].1["choice"], "once");
        let again = s
            .answer("pp1", "deny", None, &Caller::through("gui"))
            .await
            .unwrap_err();
        assert_eq!((again.status, again.code), (409, "already_answered"));
        assert_eq!(
            e.of("approval.respond").len(),
            1,
            "the second answer never reached the engine"
        );
        let audit = std::fs::read_to_string(Audit::under(dir.path()).path()).unwrap();
        assert!(audit.contains("endpoint") && audit.contains("refused:already_answered"));
        assert!(!audit.contains("\"client\""), "a line holds no name");
    }

    #[tokio::test]
    async fn a_standing_grant_is_refused_before_the_engine_is_asked() {
        let (s, e, _d) = service(poll_engine());
        s.refresh_roster().await;
        s.poll_once().await;
        for choice in ["always", "session", "yes", ""] {
            let err = s
                .answer("pp1", choice, None, &Caller::through("endpoint"))
                .await
                .unwrap_err();
            assert_eq!(
                (err.status, err.code),
                (403, "policy_refused"),
                "{choice:?}"
            );
        }
        assert!(e.of("approval.respond").is_empty());
        assert_eq!(s.feed().approvals(false)[0].state, ApprovalState::Pending);
    }

    #[tokio::test]
    async fn an_engine_that_fails_gives_the_approval_back_and_says_so_plainly() {
        let (s, _e, _d) = service(|p, m, params| {
            if m == "approval.respond" {
                return Err(Error::Unavailable(
                    "approval.respond: {'code': 5004, 'message': 'boom with /home/x/secret'}"
                        .into(),
                ));
            }
            poll_engine()(p, m, params)
        });
        s.refresh_roster().await;
        s.poll_once().await;
        let err = s
            .answer("pp1", "once", None, &Caller::through("endpoint"))
            .await
            .unwrap_err();
        assert_eq!((err.status, err.code), (502, "engine_unavailable"));
        assert!(
            !err.message.contains("secret") && !err.message.contains("5004"),
            "{}",
            err.message
        );
        assert_eq!(
            s.feed().approvals(false)[0].state,
            ApprovalState::Pending,
            "another client may answer"
        );
    }

    #[tokio::test]
    async fn an_engine_that_says_it_was_settled_closes_the_row_as_someone_elses() {
        let (s, _e, _d) = service(|p, m, params| {
            if m == "approval.respond" {
                return Ok(json!({"resolved": 0}));
            }
            poll_engine()(p, m, params)
        });
        s.refresh_roster().await;
        s.poll_once().await;
        let err = s
            .answer("pp1", "once", None, &Caller::through("endpoint"))
            .await
            .unwrap_err();
        assert_eq!(err.code, "already_answered");
        assert_eq!(
            s.feed().approval("pp1").unwrap().state,
            ApprovalState::Settled
        );
    }

    fn say_engine(
        running: bool,
    ) -> impl Fn(&str, &str, &Value) -> crate::error::Result<Value> + Send + Sync {
        move |p, m, params| {
            if let Some(v) = roster_answer(m) {
                return Ok(v);
            }
            match m {
                "session.create" => {
                    assert_eq!(
                        params,
                        &json!({"source": "gui"}),
                        "a conversation is started exactly as the app starts one"
                    );
                    Ok(json!({"session_id": "live-new", "stored_session_id": "stored-new"}))
                }
                "session.resume" => Ok(
                    json!({"session_id": "live-1", "stored_session_id": params["session_id"], "running": running}),
                ),
                // B23: the bot's own link lists its sessions, newest first, as the app's bot view reads them
                "session.list" if p == "kai" => {
                    assert_eq!(params["limit"], 1);
                    Ok(json!({"sessions": [{"id": "stored-1", "title": "", "source": "gui"}]}))
                }
                "session.list" => Ok(json!({"sessions": []})),
                "prompt.submit" => Ok(json!({"status": "started"})),
                _ => Err(Error::Unavailable(format!("unscripted {p} {m}"))),
            }
        }
    }

    #[tokio::test]
    async fn saying_to_a_bot_continues_its_latest_session_when_asked_for_latest() {
        let (s, e, _d) = service(say_engine(false));
        s.refresh_roster().await;
        let said = s
            .say(
                "kai",
                "  hello kai  ",
                &Pick::Latest,
                &Caller::through("endpoint"),
            )
            .await
            .unwrap();
        assert_eq!(
            (said.session_id.as_str(), said.created),
            ("stored-1", false)
        );
        let resume = e.of("session.resume");
        assert_eq!(resume[0].0, "kai");
        assert_eq!(resume[0].1["session_id"], "stored-1");
        let submit = e.of("prompt.submit");
        assert_eq!(submit[0].1["session_id"], "live-1");
        assert_eq!(submit[0].1["text"], "hello kai", "trimmed");
        assert!(
            submit[0].1["submission_id"]
                .as_str()
                .unwrap()
                .starts_with("api-")
        );
        assert_eq!(
            s.feed()
                .presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
                .state,
            State::Listening
        );
    }

    #[tokio::test]
    async fn the_windows_hear_a_said_message_before_the_engine_does_and_a_refusal_after() {
        let (s, e, _d) = service(say_engine(false));
        s.refresh_roster().await;
        s.say(
            "kai",
            "hello kai",
            &Pick::Latest,
            &Caller::through("endpoint"),
        )
        .await
        .unwrap();
        let calls = e.calls.lock().unwrap().clone();
        let order: Vec<&str> = calls
            .iter()
            .map(|(_, m, _)| m.as_str())
            .filter(|m| m.starts_with("window.") || *m == "prompt.submit")
            .collect();
        assert_eq!(
            order,
            ["window.said", "prompt.submit"],
            "the window draws it before the reply can start"
        );
        let said = e.of("window.said");
        assert_eq!(said[0].1["session_id"], "live-1");
        assert_eq!(
            said[0].1["payload"],
            json!({"text": "hello kai", "stored_session_id": "stored-1"})
        );
        // the engine does not take it: the windows are told, in words, and the caller gets the refusal
        let (s, e, _d) = service(|p, m, params| {
            if m == "prompt.submit" {
                return Err(Error::Unavailable("boom with /home/x/secret".into()));
            }
            say_engine(false)(p, m, params)
        });
        s.refresh_roster().await;
        let err = s
            .say("kai", "hi", &Pick::Latest, &Caller::through("endpoint"))
            .await
            .unwrap_err();
        assert_eq!(err.code, "engine_unavailable");
        let failed = e.of("window.said_failed");
        assert_eq!(failed.len(), 1);
        let reason = failed[0].1["payload"]["reason"].as_str().unwrap();
        assert!(
            !reason.contains("secret") && !reason.contains("boom"),
            "{reason}"
        );
        // nothing is announced for a message the API refused before it tried
        let (s, e, _d) = service(say_engine(true));
        s.refresh_roster().await;
        assert!(
            s.say("kai", "hi", &Pick::Latest, &Caller::through("endpoint"))
                .await
                .is_err()
        );
        assert!(e.of("window.said").is_empty());
    }

    #[tokio::test]
    async fn saying_in_a_new_session_starts_it_as_the_app_does() {
        let (s, e, _d) = service(say_engine(false));
        s.refresh_roster().await;
        let said = s
            .say("nina", "hi", &Pick::New, &Caller::through("endpoint"))
            .await
            .unwrap();
        assert!(said.created);
        assert_eq!(said.session_id, "stored-new");
        assert!(e.of("session.resume").is_empty());
        assert_eq!(e.of("prompt.submit")[0].1["session_id"], "live-new");
        let p = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "nina")
            .unwrap();
        assert_eq!(p.source, Source::Gui);
    }

    #[tokio::test]
    async fn a_busy_bot_is_not_talked_over_and_bad_input_is_refused_in_words() {
        let (s, e, _d) = service(say_engine(true));
        s.refresh_roster().await;
        let by = Caller::through("endpoint");
        let busy = s.say("kai", "hi", &Pick::Latest, &by).await.unwrap_err();
        assert_eq!((busy.status, busy.code), (409, "bot_busy"));
        assert!(e.of("prompt.submit").is_empty());
        for (bot, text, code) in [
            ("kai", "   ", "empty_text"),
            ("nobody", "hi", "no_such_bot"),
            ("kai", &"x".repeat(40_000), "text_too_long"),
            ("kai", "a\0b", "text_too_long"),
        ] {
            assert_eq!(
                s.say(bot, text, &Pick::New, &by).await.unwrap_err().code,
                code
            );
        }
        assert!(Pick::parse(Some("../../x")).is_err());
        assert_eq!(
            Pick::parse(Some("20261122_abc")).unwrap(),
            Pick::Id("20261122_abc".into())
        );
        assert_eq!(Pick::parse(None).unwrap(), Pick::Latest);
    }

    #[tokio::test]
    async fn latest_is_the_conversation_the_bots_own_link_lists_first_and_new_when_it_has_none() {
        // B23: the engine's roster names no latest session for a named bot; the bot's own session list does.
        let (s, e, _d) = service(say_engine(false));
        s.refresh_roster().await;
        assert_eq!(s.latest_of("kai").await.as_deref(), Some("stored-1"));
        let asked = e.of("session.list");
        assert_eq!(asked[0].0, "kai", "asked on the bot's own link");
        assert_eq!(asked[0].1["include_hidden"], false);
        assert_eq!(s.latest_of("nina").await, None);
        let said = s
            .say("nina", "hi", &Pick::Latest, &Caller::through("endpoint"))
            .await
            .unwrap();
        assert!(said.created, "no conversation yet: a new one, as before");
    }

    fn room_engine(
        working: bool,
    ) -> impl Fn(&str, &str, &Value) -> crate::error::Result<Value> + Send + Sync {
        move |_, m, params| {
            if let Some(v) = roster_answer(m) {
                return Ok(v);
            }
            match m {
                "groups.log" => Ok(json!({"events": [], "latest_seq": 0, "has_more": false})),
                "groups.state" => Ok(
                    json!({"room": {}, "driver_status": {"working": working, "blocked": false,
                    "pending_actions": [], "member_activity": [{"member_id": "kai", "status": "running"}]}}),
                ),
                "groups.send" => {
                    assert_eq!(params["payload"]["text"], "go");
                    Ok(
                        json!({"event": {"seq": 1, "event_id": params["event_id"], "kind": "message.user", "payload": params["payload"]}}),
                    )
                }
                "groups.stop" => Ok(json!({"cancelled": 1})),
                _ => Err(Error::Unavailable(format!("unscripted {m}"))),
            }
        }
    }

    #[tokio::test]
    async fn saying_in_a_room_goes_through_the_hold_and_only_to_a_room_that_exists() {
        let (s, e, _d) = service(room_engine(false));
        s.refresh_roster().await;
        let sent = s
            .say_room("g-paper", "go", false, &Caller::through("endpoint"))
            .await
            .unwrap();
        assert_eq!((sent.status, sent.held.len()), ("sent", 0));
        assert!(sent.event_id.starts_with("api-"));
        assert_eq!(e.of("groups.send").len(), 1);
        assert_eq!(
            s.say_room("g-nope", "go", false, &Caller::through("endpoint"))
                .await
                .unwrap_err()
                .code,
            "no_such_room"
        );
        let _ = Calls::default();
    }

    #[tokio::test]
    async fn a_room_message_while_a_member_works_is_held_for_every_client_alike() {
        // B30: the local API holds as the app's room does, through the same hold
        let (s, e, _d) = service(room_engine(true));
        s.refresh_roster().await;
        let held = s
            .say_room("g-paper", "go", false, &Caller::through("endpoint"))
            .await
            .unwrap();
        assert_eq!(held.status, "held");
        assert_eq!(held.held.len(), 1);
        assert!(
            e.of("groups.send").is_empty(),
            "kai's turn is not cut short"
        );
        let from_app = s
            .room_send("g-paper", "go", false, &Caller::through("gui"))
            .await
            .unwrap();
        assert!(from_app.event_id.starts_with("ui-"));
        assert_eq!(from_app.held.len(), 2, "one queue, whoever wrote it");
        let back = s.room_unhold("g-paper", &held.event_id).await.unwrap();
        assert_eq!(back.text.as_deref(), Some("go"));
        assert_eq!(back.held.len(), 1);
        let now = s
            .room_send_now("g-paper", &from_app.event_id)
            .await
            .unwrap();
        assert_eq!(now.status, "sent");
        assert_eq!(
            e.of("groups.stop").len(),
            1,
            "send now stops the running turn first"
        );
        assert_eq!(
            s.room_send_now("g-paper", &from_app.event_id)
                .await
                .unwrap_err()
                .code,
            "not_held"
        );
    }
}
