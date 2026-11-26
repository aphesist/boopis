//! The service's side of the room hold (`rooms/hold.rs`, B30): the app's window and this API send to a room through it, and
//! its pump sends what it holds when the room is free, for as long as the app runs, whoever held the message (the window,
//! this API, a command that stopped waiting, an earlier run of the app). Every engine question goes through [`Engine`].

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::engine::Engine;
use super::service::{ApiError, Caller, ROOT, Service, failed};
use crate::error::{Error, Result};
use crate::rooms::hold::{self, Held, How, Outcome, Watch};
use crate::rooms::{self, Room};

/// The engine's root link as the rooms' one door ([`rooms::Rpc`]).
pub struct RootRpc<'a, E: Engine>(&'a E);

#[async_trait]
impl<E: Engine> rooms::Rpc for RootRpc<'_, E> {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.0.request(ROOT, method, params).await
    }
}

/// What a message to a room did.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename = "RoomSendResult")]
pub struct RoomSent {
    /// `sent` (it is in the room) or `held` (it waits for the members to finish).
    pub status: &'static str,
    /// The event id it has, or will have, in the room's log.
    pub event_id: String,
    /// The messages the room holds now, oldest first.
    pub held: Vec<Held>,
}

/// What taking a held message back did.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename = "RoomUnholdResult")]
pub struct Unheld {
    /// Its words, when it was still held (it never went out); null when it had already gone, or was taken back elsewhere.
    pub text: Option<String>,
    /// The messages the room holds now.
    pub held: Vec<Held>,
}

fn from_room(e: &Error) -> ApiError {
    match e {
        Error::InvalidInput(m) if m.contains("already waiting") => {
            ApiError::new(409, "hold_full", m)
        }
        Error::InvalidInput(m) if m.contains("too long") => ApiError::new(413, "text_too_long", m),
        Error::InvalidInput(_) => {
            ApiError::new(400, "empty_text", "There is nothing to say: text is empty.")
        }
        other => failed("reach the group", other),
    }
}

impl<E: Engine> Service<E> {
    pub(super) fn rpc(&self) -> RootRpc<'_, E> {
        RootRpc(&*self.engine)
    }

    /// The room with this id, as the engine lists it now.
    pub(super) async fn room(&self, id: &str) -> std::result::Result<Room, ApiError> {
        if !self.feed.rooms().iter().any(|r| r.id == id) {
            self.refresh_roster().await;
        }
        if !self.feed.rooms().iter().any(|r| r.id == id) {
            return Err(ApiError::new(
                404,
                "no_such_room",
                "There is no room with that id.",
            ));
        }
        let all = rooms::list(&self.rpc(), false)
            .await
            .map_err(|e| failed("read the room", &e))?;
        all.into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ApiError::new(404, "no_such_room", "There is no room with that id."))
    }

    async fn tell_held(&self, room_id: &str) -> Vec<Held> {
        let held = self.holds.held_now(room_id).await.unwrap_or_default();
        self.feed.on_room_held(room_id, held.clone());
        self.engine.held_changed(room_id, &held);
        held
    }

    /// Send to a room through the hold (the app's window and this API). `now` stops the running turns first.
    ///
    /// # Errors
    /// A refusal in words (no such room, nothing to say, a full hold), or the engine's failure.
    pub async fn room_send(
        &self,
        room_id: &str,
        message: &str,
        now: bool,
        by: &Caller,
    ) -> std::result::Result<RoomSent, ApiError> {
        if message.trim().is_empty() {
            return Err(ApiError::new(
                400,
                "empty_text",
                "There is nothing to say: text is empty.",
            ));
        }
        let prefix = if by.surface == "gui" { "ui" } else { "api" };
        let how = if now { How::Now } else { How::WhenDone };
        self.room_send_as(room_id, message, how, &crate::rooms::new_event_id(prefix))
            .await
    }

    /// Send `message` to a room through the hold under the event id `id` (the host-ops channel's `room.say`, whose id comes
    /// from its idempotency key; the text already carries the host's label).
    ///
    /// # Errors
    /// As `room_send`.
    pub async fn room_send_as(
        &self,
        room_id: &str,
        message: &str,
        how: How,
        id: &str,
    ) -> std::result::Result<RoomSent, ApiError> {
        if message.trim().is_empty() {
            return Err(ApiError::new(
                400,
                "empty_text",
                "There is nothing to say: text is empty.",
            ));
        }
        self.room(room_id).await?;
        let mut watches = self.watches.lock().await;
        let watch = watches
            .entry(room_id.to_owned())
            .or_insert_with(|| Watch::new(room_id));
        let out = hold::submit_as(
            &self.rpc(),
            &self.holds,
            watch,
            message,
            how,
            id,
            &self.room_limits,
        )
        .await
        .map_err(|e| from_room(&e))?;
        drop(watches);
        Ok(match out {
            Outcome::Sent(ev) => RoomSent {
                status: "sent",
                event_id: ev.id,
                held: self.holds.held_now(room_id).await.unwrap_or_default(),
            },
            Outcome::Held(h, _) => RoomSent {
                status: "held",
                event_id: h.id,
                held: self.tell_held(room_id).await,
            },
        })
    }

    /// Take a held message back before it goes out.
    ///
    /// # Errors
    /// The file's failure, in words.
    pub async fn room_unhold(
        &self,
        room_id: &str,
        id: &str,
    ) -> std::result::Result<Unheld, ApiError> {
        let gone = self
            .holds
            .remove_now(room_id, id)
            .await
            .map_err(|e| failed("read the held messages", &e))?;
        Ok(Unheld {
            text: gone.map(|h| h.text),
            held: self.tell_held(room_id).await,
        })
    }

    /// Send a held message now, stopping the running turns first.
    ///
    /// # Errors
    /// `404 not_held` when it is no longer held; the engine's failure otherwise.
    pub async fn room_send_now(
        &self,
        room_id: &str,
        id: &str,
    ) -> std::result::Result<RoomSent, ApiError> {
        let mut watches = self.watches.lock().await;
        let watch = watches
            .entry(room_id.to_owned())
            .or_insert_with(|| Watch::new(room_id));
        let sent = hold::send_now(&self.rpc(), &self.holds, watch, id, &self.room_limits)
            .await
            .map_err(|e| from_room(&e))?;
        drop(watches);
        let held = self.tell_held(room_id).await;
        let ev = sent.ok_or_else(|| {
            ApiError::new(
                404,
                "not_held",
                "That message is no longer held: it went out, or was taken back.",
            )
        })?;
        Ok(RoomSent {
            status: "sent",
            event_id: ev.id,
            held,
        })
    }

    /// The messages a room holds.
    pub async fn room_held(&self, room_id: &str) -> Vec<Held> {
        self.holds.held_now(room_id).await.unwrap_or_default()
    }

    /// The hold's pump, for as long as the app runs: every few seconds, each room that holds a message is read, and its
    /// oldest held message goes out when the room is free. Held messages a command left (it stopped waiting, or the app was
    /// closed) go out here too; a change any process made to the hold reaches the windows and the streams.
    pub async fn run_holds(self: Arc<Self>, cancel: CancellationToken) {
        let mut seen: std::collections::BTreeMap<String, Vec<Held>> =
            std::collections::BTreeMap::new();
        let mut beat = tokio::time::interval(self.room_limits.hold_every);
        loop {
            tokio::select! {
                () = cancel.cancelled() => return,
                _ = beat.tick() => {}
            }
            let Ok(all) = self.holds.all_now().await else {
                continue;
            };
            for (room, held) in &all {
                if seen.get(room) != Some(held) {
                    self.feed.on_room_held(room, held.clone());
                    self.engine.held_changed(room, held);
                }
            }
            for room in seen.keys().filter(|r| !all.contains_key(*r)) {
                self.feed.on_room_held(room, Vec::new());
                self.engine.held_changed(room, &[]);
            }
            seen.clone_from(&all);
            for room in all.keys() {
                let mut watches = self.watches.lock().await;
                let watch = watches
                    .entry(room.clone())
                    .or_insert_with(|| Watch::new(room));
                match hold::pump(&self.rpc(), &self.holds, watch, &self.room_limits).await {
                    Ok(Some(_)) => {
                        drop(watches);
                        let now = self.tell_held(room).await;
                        if now.is_empty() {
                            seen.remove(room);
                        } else {
                            seen.insert(room.clone(), now);
                        }
                    }
                    Ok(None) => {}
                    Err(e) => tracing::debug!(error = %e, "a held message could not be sent yet"),
                }
            }
            let mut watches = self.watches.lock().await;
            watches.retain(|room, _| all.contains_key(room));
        }
    }
}
