//! The room hold: the one place a message written while a room's members work waits, for every client (the app's room, the
//! command line, the local API). A message sent into a running discussion ends it and drops the answers still being written
//! (`discussion.rs`), so a message is held while the room is busy and sent when the discussion is over. "Send now" stops the
//! running turns first, and says so where it is offered.
//!
//! Held messages live in one small file in the app's data folder (`room-holds.json`), so they survive the app closing and a
//! command that stops waiting: whoever next sees the room free sends them (the app's pump, `local_api::service`, every few
//! seconds while anything is held; a command that waits for its own message). Two processes may pump the same room at once:
//! each held message carries the event id it is sent with, minted when it was held, and the engine's `groups.send` is
//! idempotent by event id, so a message sent twice is one message. The file is changed under an exclusive lock, never held
//! across a call to the engine, and written by one rename.

use std::collections::{BTreeMap, VecDeque};
use std::io::Read as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use super::discussion::{self, Discussions};
use super::{Event, Rpc};
use crate::config::RoomLimits;
use crate::error::{Error, Result};

/// The file's name, in the app's data folder.
pub const FILE: &str = "room-holds.json";
const VERSION: u32 = 1;

/// A message waiting for a room to finish.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename = "HeldMessage")]
pub struct Held {
    /// The event id the engine is given when it is sent (`ui-`, `cli-` or `api-` and 12 hex characters, so the log shows where
    /// it came from). It is also the message's id while it is held.
    pub id: String,
    /// What it says.
    pub text: String,
    /// When it was held, in whole seconds since 1970.
    pub at: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct Book {
    version: u32,
    #[serde(default)]
    rooms: BTreeMap<String, Vec<Held>>,
}

/// The file of held messages.
#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

impl Store {
    /// The file under `dir` (the app's data folder).
    #[must_use]
    pub fn under(dir: &Path) -> Self {
        Self {
            path: dir.join(FILE),
        }
    }

    /// The file's path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Read and change the book under the file's lock; written back only when `f` changed it.
    fn edit<T>(&self, f: impl FnOnce(&mut BTreeMap<String, Vec<Held>>) -> T) -> Result<T> {
        let io = |e: std::io::Error| Error::Io(format!("{}: {e}", self.path.display()));
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.path.with_extension("json.lock"))
            .map_err(io)?;
        lock.lock().map_err(io)?;
        let mut text = String::new();
        let read = match std::fs::File::open(&self.path) {
            Ok(mut file) => file.read_to_string(&mut text).map(|_| true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e),
        }
        .map_err(io)?;
        let mut book = if read && !text.trim().is_empty() {
            serde_json::from_str::<Book>(&text)
                .map_err(|e| Error::Config(format!("{}: {e}", self.path.display())))?
        } else {
            Book {
                version: VERSION,
                rooms: BTreeMap::new(),
            }
        };
        if book.version > VERSION {
            return Err(Error::Config(format!(
                "{}: this build reads version {VERSION}, found {}",
                self.path.display(),
                book.version
            )));
        }
        let before = book.rooms.clone();
        let out = f(&mut book.rooms);
        book.rooms.retain(|_, held| !held.is_empty());
        if book.rooms != before {
            let tmp = self.path.with_extension("json.tmp");
            let body =
                serde_json::to_string_pretty(&book).map_err(|e| Error::Config(e.to_string()))?;
            std::fs::write(&tmp, body + "\n").map_err(io)?;
            std::fs::rename(&tmp, &self.path).map_err(io)?;
        }
        // The lock file is kept (an empty marker); the lock ends when it closes here.
        drop(lock);
        Ok(out)
    }

    /// The messages held for a room, oldest first.
    ///
    /// # Errors
    /// `Io` or `Config` when the file cannot be read.
    pub fn held(&self, room_id: &str) -> Result<Vec<Held>> {
        self.edit(|rooms| rooms.get(room_id).cloned().unwrap_or_default())
    }

    /// Every room's held messages.
    ///
    /// # Errors
    /// As [`Store::held`].
    pub fn all(&self) -> Result<BTreeMap<String, Vec<Held>>> {
        self.edit(|rooms| rooms.clone())
    }

    /// Hold one more message for a room. Returns the room's held messages.
    ///
    /// # Errors
    /// `InvalidInput` when the room already holds `cap` messages; as [`Store::held`] otherwise.
    pub fn push(&self, room_id: &str, held: Held, cap: usize) -> Result<Vec<Held>> {
        self.edit(|rooms| {
            let list = rooms.entry(room_id.to_owned()).or_default();
            if list.len() >= cap {
                return Err(Error::InvalidInput(format!(
                    "{cap} messages are already waiting for this group: send one now, or take one back"
                )));
            }
            if !list.iter().any(|h| h.id == held.id) {
                list.push(held);
            }
            Ok(list.clone())
        })?
    }

    /// Take a held message out. `None` when it is not held (it was sent, or taken back elsewhere).
    ///
    /// # Errors
    /// As [`Store::held`].
    pub fn remove(&self, room_id: &str, id: &str) -> Result<Option<Held>> {
        self.edit(|rooms| {
            let list = rooms.get_mut(room_id)?;
            let at = list.iter().position(|h| h.id == id)?;
            Some(list.remove(at))
        })
    }

    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Self) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let me = self.clone();
        tokio::task::spawn_blocking(move || f(&me))
            .await
            .map_err(|e| crate::error::joined(&e))?
    }

    /// [`Store::held`], off the async workers.
    ///
    /// # Errors
    /// As [`Store::held`].
    pub async fn held_now(&self, room_id: &str) -> Result<Vec<Held>> {
        let room = room_id.to_owned();
        self.blocking(move |s| s.held(&room)).await
    }

    /// [`Store::all`], off the async workers.
    ///
    /// # Errors
    /// As [`Store::held`].
    pub async fn all_now(&self) -> Result<BTreeMap<String, Vec<Held>>> {
        self.blocking(Self::all).await
    }

    /// [`Store::remove`], off the async workers.
    ///
    /// # Errors
    /// As [`Store::held`].
    pub async fn remove_now(&self, room_id: &str, id: &str) -> Result<Option<Held>> {
        let (room, id) = (room_id.to_owned(), id.to_owned());
        self.blocking(move |s| s.remove(&room, &id)).await
    }

    async fn push_now(&self, room_id: &str, held: Held, cap: usize) -> Result<Vec<Held>> {
        let room = room_id.to_owned();
        self.blocking(move |s| s.push(&room, held, cap)).await
    }
}

/// A room as the hold reads it: its log from a cursor, and who is at work.
#[derive(Debug, Clone)]
pub struct Watch {
    room_id: String,
    discussions: Discussions,
    working: Vec<String>,
    /// When a turn was last seen running (seconds).
    alive_at: f64,
    /// The newest user messages' ids and places, to find a held message once it was sent.
    users: VecDeque<(String, u64)>,
}

impl Watch {
    /// A room not read yet.
    #[must_use]
    pub fn new(room_id: &str) -> Self {
        Self {
            room_id: room_id.to_owned(),
            discussions: Discussions::default(),
            working: Vec::new(),
            alive_at: 0.0,
            users: VecDeque::new(),
        }
    }

    /// The room's id.
    #[must_use]
    pub fn room_id(&self) -> &str {
        &self.room_id
    }

    /// Read what is new in the log, and who is at work now. Returns the new events.
    ///
    /// # Errors
    /// The gateway's.
    pub async fn read(&mut self, rpc: &dyn Rpc) -> Result<Vec<Event>> {
        let events = super::log_since(rpc, &self.room_id, self.discussions.cursor()).await?;
        self.discussions.ingest(&events);
        for e in events.iter().filter(|e| e.kind == "message.user") {
            self.users.push_back((e.id.clone(), e.seq));
            while self.users.len() > 256 {
                self.users.pop_front();
            }
        }
        let state = super::state(rpc, &self.room_id).await?;
        self.working = if state.working {
            state.at_work
        } else {
            Vec::new()
        };
        if state.working {
            self.alive_at = now_secs();
        }
        Ok(events)
    }

    /// Whether a message sent now would cut a discussion short.
    #[must_use]
    pub fn busy(&self, limits: &RoomLimits) -> bool {
        discussion::busy(
            !self.working.is_empty(),
            &self.discussions,
            self.alive_at,
            now_secs(),
            limits.quiet_grace.as_secs_f64(),
        )
    }

    /// The members at work now (member ids), as the room last said.
    #[must_use]
    pub fn working(&self) -> &[String] {
        &self.working
    }

    /// The last event read.
    #[must_use]
    pub fn cursor(&self) -> u64 {
        self.discussions.cursor()
    }

    /// Where the user message with this event id is in the log, when it has been read.
    #[must_use]
    pub fn placed(&self, event_id: &str) -> Option<u64> {
        self.users
            .iter()
            .rev()
            .find(|(id, _)| id == event_id)
            .map(|(_, seq)| *seq)
    }
}

/// How a message goes to a room.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum How {
    /// Held while the room is busy, sent when it is done (the default everywhere).
    WhenDone,
    /// Sent at once: the running turns are stopped first.
    Now,
}

/// What a send did.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// It is in the room: the event the engine wrote.
    Sent(Event),
    /// It waits: the message held, and every message the room holds now (oldest first).
    Held(Held, Vec<Held>),
}

fn check_text(text: &str, limits: &RoomLimits) -> Result<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::InvalidInput("there is nothing to send".into()));
    }
    if text.len() > limits.max_text || text.contains('\0') {
        return Err(Error::InvalidInput(
            "the message is too long to send in one go".into(),
        ));
    }
    Ok(text.to_owned())
}

/// Send `text` to the room `watch` reads, through the hold: sent at once when the room is free and nothing waits before it;
/// held otherwise. `prefix` names the surface in the event id (`ui`, `cli`, `api`).
///
/// # Errors
/// `InvalidInput` for an empty or too long text or a full hold; the gateway's or the file's otherwise.
pub async fn submit(
    rpc: &dyn Rpc,
    store: &Store,
    watch: &mut Watch,
    text: &str,
    how: How,
    prefix: &str,
    limits: &RoomLimits,
) -> Result<Outcome> {
    submit_as(
        rpc,
        store,
        watch,
        text,
        how,
        &super::new_event_id(prefix),
        limits,
    )
    .await
}

/// [`submit`] with the event id given: the host-ops channel's `room.say` derives it from its idempotency key, so the
/// engine's `groups.send` (idempotent by event id) makes one message for one key.
///
/// # Errors
/// As [`submit`].
pub async fn submit_as(
    rpc: &dyn Rpc,
    store: &Store,
    watch: &mut Watch,
    text: &str,
    how: How,
    id: &str,
    limits: &RoomLimits,
) -> Result<Outcome> {
    let text = check_text(text, limits)?;
    let id = id.to_owned();
    watch.read(rpc).await?;
    if how == How::Now {
        if watch.busy(limits) {
            super::stop(rpc, &watch.room_id).await?;
        }
        let sent = super::send_as(rpc, &watch.room_id, &id, &text).await?;
        return Ok(Outcome::Sent(sent));
    }
    let waiting = store.held_now(&watch.room_id).await?;
    if waiting.is_empty() && !watch.busy(limits) {
        let sent = super::send_as(rpc, &watch.room_id, &id, &text).await?;
        return Ok(Outcome::Sent(sent));
    }
    // Whole seconds: an integer is exact in the file's JSON, so a held message read back is the one that was written.
    let held = Held {
        id,
        text,
        at: now_secs().floor(),
    };
    store
        .push_now(&watch.room_id, held.clone(), limits.held_per_room)
        .await?;
    // Something held before it may be due now; it goes first, and this one waits for the discussion it starts.
    pump(rpc, store, watch, limits).await?;
    let now = store.held_now(&watch.room_id).await?;
    Ok(Outcome::Held(held, now))
}

/// Send the oldest held message of the room `watch` reads, when the room is free. Returns the event it became, or `None`
/// when nothing is held or the room is busy. At most one message goes per call: the one sent starts a discussion.
///
/// # Errors
/// The gateway's or the file's.
pub async fn pump(
    rpc: &dyn Rpc,
    store: &Store,
    watch: &mut Watch,
    limits: &RoomLimits,
) -> Result<Option<Event>> {
    let Some(first) = store.held_now(&watch.room_id).await?.into_iter().next() else {
        return Ok(None);
    };
    watch.read(rpc).await?;
    if watch.busy(limits) {
        return Ok(None);
    }
    let sent = super::send_as(rpc, &watch.room_id, &first.id, &first.text).await?;
    store.remove_now(&watch.room_id, &first.id).await?;
    watch.read(rpc).await?;
    Ok(Some(sent))
}

/// Send one held message now, stopping the running turns first. `None` when it is no longer held.
///
/// # Errors
/// The gateway's or the file's.
pub async fn send_now(
    rpc: &dyn Rpc,
    store: &Store,
    watch: &mut Watch,
    id: &str,
    limits: &RoomLimits,
) -> Result<Option<Event>> {
    let Some(held) = store.remove_now(&watch.room_id, id).await? else {
        return Ok(None);
    };
    watch.read(rpc).await?;
    if watch.busy(limits) {
        super::stop(rpc, &watch.room_id).await?;
    }
    let sent = super::send_as(rpc, &watch.room_id, &held.id, &held.text).await?;
    Ok(Some(sent))
}

/// Where a message given to [`deliver`] ended up.
#[derive(Debug, Clone, PartialEq)]
pub enum Delivered {
    /// It is in the room (sent here, or by another client's pump): the event the engine wrote.
    Sent(Event),
    /// It was held, and someone took it back before it went out (the app's room offers that).
    TakenBack,
    /// It is still held when the wait ran out; whoever next sees the room free sends it.
    StillHeld(Held),
}

/// Send through the hold and wait until the message is in the room: what a command does, since it has no window to show a
/// held message in. `on_held` is told once, when the message is held, with the members at work. While it waits this process
/// pumps the room itself, so the message goes out even when the app is not running; if the wait ends first (or the command
/// is interrupted) the message stays held for the app, or the next command, to send.
///
/// # Errors
/// As [`submit`] and [`pump`].
#[allow(clippy::too_many_arguments)] // one call: the room, the message, the surface, the rules and the wait
pub async fn deliver(
    rpc: &dyn Rpc,
    store: &Store,
    watch: &mut Watch,
    text: &str,
    prefix: &str,
    limits: &RoomLimits,
    poll: std::time::Duration,
    wait: std::time::Duration,
    on_held: &mut dyn FnMut(&Held, &[String]),
) -> Result<Delivered> {
    let held = match submit(rpc, store, watch, text, How::WhenDone, prefix, limits).await? {
        Outcome::Sent(event) => return Ok(Delivered::Sent(event)),
        Outcome::Held(held, _) => held,
    };
    on_held(&held, watch.working());
    let until = tokio::time::Instant::now() + wait;
    loop {
        if let Some(seq) = watch.placed(&held.id) {
            return Ok(Delivered::Sent(Event {
                seq,
                id: held.id.clone(),
                kind: "message.user".into(),
                actor: "user".into(),
                payload: serde_json::json!({"thread_id": super::THREAD, "text": held.text}),
                at: now_secs(),
            }));
        }
        if !store
            .held_now(&watch.room_id)
            .await?
            .iter()
            .any(|h| h.id == held.id)
        {
            // Gone from the hold: another pump sent it (the log says so) or the owner took it back.
            watch.read(rpc).await?;
            if watch.placed(&held.id).is_some() {
                continue;
            }
            return Ok(Delivered::TakenBack);
        }
        if tokio::time::Instant::now() >= until {
            return Ok(Delivered::StillHeld(held));
        }
        tokio::time::sleep(poll).await;
        if let Some(event) = pump(rpc, store, watch, limits).await?
            && event.id == held.id
        {
            return Ok(Delivered::Sent(event));
        }
    }
}

#[cfg(test)]
mod tests;
