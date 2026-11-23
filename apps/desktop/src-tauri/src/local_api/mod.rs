//! The local API for other clients (`ADR-0045`, `docs/LOCAL-API.md`): presence, notifications and approvals across every bot
//! and every client, a way to say something to a bot or a room, and an opt-in loopback endpoint that serves them to the
//! owner's own tools. The host computes all of it from what the engine already says; nothing in the engine or the plugin
//! changes, and nothing that is a secret has a place in any type here.
//!
//! - [`model`]: the contract's values; [`presence`], [`approvals`], [`roster`], [`feed`]: the rules, pure and tested;
//! - [`service`]: asks the engine (through [`engine`]) and acts for clients; [`rooms`]: the room hold's side (the app's
//!   window and this API send through it, and its pump); [`room_log`]: rooms' logs read and followed, and stops;
//!   [`workers`]: kanban workers; [`cron`]: scheduled runs' results;
//! - [`wire`], [`http`], [`token`]: the endpoint, its checks and its token file;
//! - [`activity`]: what the plugin pushes from the engine's tool hooks (B45);
//! - [`audit`], [`scrub`], [`look`]: the record of who answered, the secret scrubber, the default look.

pub mod activity;
pub mod approvals;
pub mod audit;
pub mod connect;
pub mod cron;
#[cfg(test)]
mod endpoint_tests;
pub mod engine;
pub mod feed;
pub mod http;
pub mod look;
pub mod model;
pub mod presence;
pub mod room_log;
pub mod rooms;
pub mod roster;
pub mod scrub;
pub mod service;
pub mod token;
pub mod toolwords;
pub mod wire;
pub mod workers;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;
use tokio_util::sync::CancellationToken;

use self::engine::Hubbed;
use self::feed::Feed;
use self::http::Server;
use self::service::{ApiError, Caller, Service};
use crate::config::{ApiLimits, RoomLimits};
use crate::gateway::Hub;

/// The file that remembers the owner's switch. Off until the owner turns it on.
const SWITCH_FILE: &str = "local-api.json";

#[derive(Serialize, Deserialize, Default)]
struct Switch {
    #[serde(default)]
    enabled: bool,
}

/// What Settings shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct LocalApiStatus {
    /// The owner's switch.
    pub enabled: bool,
    /// Whether the endpoint is listening now.
    pub running: bool,
    /// Its address (`http://127.0.0.1:<port>`), when it is.
    pub url: Option<String>,
    /// The token file's path (the path, never the token), when the endpoint is on.
    pub token_file: Option<String>,
    /// How many event streams are open.
    pub streams: u32,
    /// The contract's version.
    pub version: u32,
    /// Why the endpoint is off though the switch is on, in words.
    pub problem: Option<String>,
}

struct Running {
    server: Server<Hubbed>,
}

/// The local API of this app run.
pub struct LocalApi {
    feed: Arc<Feed>,
    service: Arc<Service<Hubbed>>,
    dir: PathBuf,
    limits: ApiLimits,
    running: tokio::sync::Mutex<Option<Running>>,
    problem: std::sync::Mutex<Option<String>>,
    cancel: CancellationToken,
    /// The engine's root home, where the plugin reads where the activity socket is (B45); `None` when unknown.
    engine_root: Option<PathBuf>,
    /// The socket the plugin pushes to, while the app runs (B45).
    #[cfg(unix)]
    activity: std::sync::Mutex<Option<activity::Listener>>,
}

/// Read the owner's switch.
fn read_switch(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(SWITCH_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Switch>(&t).ok())
        .is_some_and(|s| s.enabled)
}

fn write_switch(dir: &Path, enabled: bool) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string(&Switch { enabled }).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(SWITCH_FILE), text)
}

impl LocalApi {
    /// The local API over the app's engine links. Nothing listens and nothing is polled until the owner turns it on or a
    /// reader of the feed exists; the room hold's pump runs whenever a message is held.
    #[must_use]
    pub fn new(
        handle: tauri::AppHandle,
        dir: PathBuf,
        limits: &ApiLimits,
        rooms: &RoomLimits,
        engine_root: Option<PathBuf>,
    ) -> Arc<Self> {
        let feed = Feed::new(audit::Audit::under(&dir), limits.clone());
        let engine = Arc::new(Hubbed::new(handle, limits.engine_wait));
        let service = Service::new(
            feed.clone(),
            engine,
            limits.clone(),
            crate::rooms::hold::Store::under(&dir),
            rooms.clone(),
        );
        Arc::new(Self {
            feed,
            service,
            dir,
            limits: limits.clone(),
            running: tokio::sync::Mutex::new(None),
            problem: std::sync::Mutex::new(None),
            cancel: CancellationToken::new(),
            engine_root,
            #[cfg(unix)]
            activity: std::sync::Mutex::new(None),
        })
    }

    /// The feed (the app's own readers and the hubs' forwarders use it).
    #[must_use]
    pub fn feed(&self) -> &Arc<Feed> {
        &self.feed
    }

    /// Start the service's loop and the room hold's pump, and the endpoint when the owner's switch is on. Called once, at
    /// start.
    pub async fn start(self: &Arc<Self>) {
        tokio::spawn(self.service.clone().run(self.cancel.clone()));
        tokio::spawn(self.service.clone().run_holds(self.cancel.clone()));
        self.listen_for_activity();
        if read_switch(&self.dir) {
            if let Err(e) = self.listen().await {
                tracing::warn!(error = %e, "the local API did not start");
                *self
                    .problem
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(e);
            }
        } else {
            // A token file left by a crash of a run that had it on is not left lying about.
            token::Files::under(&self.dir).remove();
        }
    }

    /// Listen with a fresh token and write the files that tell a local client where and how.
    async fn listen(&self) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if running.is_some() {
            return Ok(());
        }
        let tok =
            token::Token::mint().map_err(|e| format!("boopis could not make a token: {e}"))?;
        let files = token::Files::under(&self.dir);
        files
            .write_token(&tok)
            .map_err(|e| format!("boopis could not write the token file: {e}"))?;
        if !files.token_is_private() {
            files.remove();
            return Err(
                "The token file would be readable by other users, so the endpoint stays off."
                    .to_owned(),
            );
        }
        self.feed.never_say(vec![tok.expose().to_owned()]);
        let server = Server::start(self.service.clone(), tok, self.limits.clone())
            .await
            .map_err(|e| {
                files.remove();
                format!("boopis could not open the endpoint: {e}")
            })?;
        if let Err(e) = files.write_endpoint(&server.addr().to_string(), model::API_VERSION) {
            server.stop();
            files.remove();
            return Err(format!("boopis could not write the endpoint file: {e}"));
        }
        tracing::info!(addr = %server.addr(), "the local API is listening");
        *running = Some(Running { server });
        *self
            .problem
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        Ok(())
    }

    /// The status, as Settings shows it.
    pub async fn status(&self) -> LocalApiStatus {
        let running = self.running.lock().await;
        let files = token::Files::under(&self.dir);
        LocalApiStatus {
            enabled: read_switch(&self.dir),
            running: running.is_some(),
            url: running
                .as_ref()
                .map(|r| format!("http://{}", r.server.addr())),
            token_file: running
                .as_ref()
                .map(|_| files.token_path().display().to_string()),
            streams: running
                .as_ref()
                .map_or(0, |r| u32::try_from(r.server.streams()).unwrap_or(u32::MAX)),
            version: model::API_VERSION,
            problem: self
                .problem
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        }
    }

    /// The owner's switch.
    ///
    /// # Errors
    /// The words that say why the endpoint did not start.
    pub async fn set_enabled(&self, enabled: bool) -> Result<LocalApiStatus, String> {
        write_switch(&self.dir, enabled)
            .map_err(|e| format!("boopis could not save the setting: {e}"))?;
        if enabled {
            if let Err(e) = self.listen().await {
                *self
                    .problem
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(e.clone());
                return Err(e);
            }
        } else {
            let mut running = self.running.lock().await;
            if let Some(r) = running.take() {
                r.server.stop();
            }
            token::Files::under(&self.dir).remove();
            self.feed.never_say(Vec::new());
            *self
                .problem
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        }
        Ok(self.status().await)
    }

    /// Replace the token: the old one stops working at once, and every open stream ends.
    ///
    /// # Errors
    /// The endpoint is off, or the file could not be written.
    pub async fn rotate(&self) -> Result<LocalApiStatus, String> {
        {
            let running = self.running.lock().await;
            let Some(r) = running.as_ref() else {
                return Err("The endpoint is off; there is no token to rotate.".to_owned());
            };
            let tok =
                token::Token::mint().map_err(|e| format!("boopis could not make a token: {e}"))?;
            let files = token::Files::under(&self.dir);
            files
                .write_token(&tok)
                .map_err(|e| format!("boopis could not write the token file: {e}"))?;
            self.feed.never_say(vec![tok.expose().to_owned()]);
            r.server.rotate(tok);
        }
        Ok(self.status().await)
    }

    /// Bind the socket the plugin pushes what a bot is doing to (B45), in the host's private socket folder. Without it the
    /// presence of the turns the host's links do not run comes from the poll alone, as before.
    fn listen_for_activity(&self) {
        #[cfg(unix)]
        {
            let (Some(root), Some(dir)) = (
                self.engine_root.as_deref(),
                crate::secrets::channel::default_socket_dir(),
            ) else {
                return;
            };
            match activity::Listener::start(self.feed.clone(), &dir, root) {
                Ok(l) => {
                    *self
                        .activity
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(l);
                }
                Err(e) => tracing::warn!(
                    error = %e,
                    "the activity socket did not start; room turns, scheduled runs and kanban workers show at the poll's grain"
                ),
            }
        }
    }

    /// Stop everything (the app is closing).
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        #[cfg(unix)]
        self.activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(r) = self.running.lock().await.take() {
            r.server.stop();
        }
        token::Files::under(&self.dir).remove();
    }
}

impl LocalApi {
    /// A message from the app's room, through the room hold (B30): held while the members work, sent when they are done;
    /// `now` stops them first.
    ///
    /// # Errors
    /// The refusal, in words.
    pub async fn room_send(
        &self,
        room_id: &str,
        text: &str,
        now: bool,
    ) -> Result<rooms::RoomSent, ApiError> {
        self.service
            .room_send(room_id, text, now, &Caller::through("gui"))
            .await
    }

    /// Take a held message back.
    ///
    /// # Errors
    /// The refusal, in words.
    pub async fn room_unhold(&self, room_id: &str, id: &str) -> Result<rooms::Unheld, ApiError> {
        self.service.room_unhold(room_id, id).await
    }

    /// Send a held message now (the running turns stop first).
    ///
    /// # Errors
    /// The refusal, in words.
    pub async fn room_send_now(
        &self,
        room_id: &str,
        id: &str,
    ) -> Result<rooms::RoomSent, ApiError> {
        self.service.room_send_now(room_id, id).await
    }

    /// The messages a room holds.
    pub async fn room_held(&self, room_id: &str) -> Vec<crate::rooms::hold::Held> {
        self.service.room_held(room_id).await
    }
}

/// Forward what a link carries to the feed, while somebody listens (nothing is copied from a link otherwise).
pub fn forward(feed: &Arc<Feed>, profile: &str, hub: &Arc<Hub>) {
    let (feed, profile, hub) = (feed.clone(), profile.to_owned(), hub.clone());
    // The words of replies and of the owner's messages are copied off the link only while a reader follows conversations.
    let (text_feed, text_hub) = (feed.clone(), hub.clone());
    tokio::spawn(async move {
        let mut text = text_feed.text_wanted();
        loop {
            text_hub.set_feed_text(*text.borrow_and_update() > 0);
            if text.changed().await.is_err() {
                return;
            }
        }
    });
    tokio::spawn(async move {
        let mut wanted = feed.wanted();
        loop {
            while *wanted.borrow_and_update() == 0 {
                if wanted.changed().await.is_err() {
                    return;
                }
            }
            let mut rx = hub.feed();
            loop {
                tokio::select! {
                    got = rx.recv() => match got {
                        Ok(frame) => feed.on_frame(&profile, &frame),
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    },
                    changed = wanted.changed() => {
                        if changed.is_err() { return; }
                        if *wanted.borrow() == 0 { break; }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_endpoint_is_off_when_nothing_says_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!read_switch(dir.path()), "no setting file: off");
        assert!(!read_switch(&dir.path().join("missing")), "no folder: off");
        std::fs::write(dir.path().join(SWITCH_FILE), "not json").unwrap();
        assert!(
            !read_switch(dir.path()),
            "a setting that cannot be read is off, never on"
        );
        std::fs::write(dir.path().join(SWITCH_FILE), "{}").unwrap();
        assert!(!read_switch(dir.path()), "a setting with no switch is off");
        std::fs::write(dir.path().join(SWITCH_FILE), r#"{"enabled": "yes"}"#).unwrap();
        assert!(!read_switch(dir.path()), "only a real true turns it on");
    }

    #[test]
    fn the_owners_switch_is_kept_and_turned_off_again() {
        let dir = tempfile::tempdir().unwrap();
        write_switch(dir.path(), true).unwrap();
        assert!(read_switch(dir.path()));
        write_switch(dir.path(), false).unwrap();
        assert!(!read_switch(dir.path()));
    }

    #[test]
    fn the_status_never_has_a_field_for_the_token() {
        let status = LocalApiStatus {
            enabled: true,
            running: true,
            url: Some("http://127.0.0.1:47821".into()),
            token_file: Some("/data/client-token".into()),
            streams: 1,
            version: model::API_VERSION,
            problem: None,
        };
        let json = serde_json::to_value(&status).unwrap();
        let keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert!(
            keys.iter()
                .all(|k| !k.contains("token") || *k == "token_file"),
            "{keys:?}"
        );
    }
}
