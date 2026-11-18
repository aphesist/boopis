//! The typed commands and events of the UI-to-host seam (`docs/PROTOCOL.md` section 1). Every command validates its
//! input as untrusted, and none returns a ticket, a token or a secret.

// Tauri hands command arguments over by value (`AppHandle`, `State`, owned `String`s): the signature is not ours to change.
#![allow(clippy::needless_pass_by_value)]

use std::sync::Arc;

use serde::Serialize;
use serde_json::value::RawValue;
use specta::Type;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::config::Limits;
use crate::error::{Error, HostError, Result};
use crate::gateway::reconnect::Phase;
use crate::gateway::{ConnectionId, FrameSink, ProxyStats};
use crate::hermes::install::{self, InstallReport};
use crate::hermes::{HermesStatus, Supervisor};
use crate::os::{self, PickedFolder};
use crate::secrets::SecretStore;
use crate::secrets::store::{validate_name, validate_value};
use crate::settings::AppSettings;
use crate::state::Hubs;

/// A gateway frame, as JSON, exactly as the gateway sent it.
#[derive(Clone, Serialize, Type)]
#[serde(transparent)]
pub struct Frame(#[specta(type = specta_typescript::Unknown)] Box<RawValue>);

/// Any JSON value, typed `unknown` on the TypeScript side (the UI narrows it with the generated gateway contract).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(transparent)]
pub struct Json(#[specta(type = specta_typescript::Unknown)] pub serde_json::Value);

/// What the host holds for the commands.
pub struct AppState {
    /// Hermes discovery and lifecycle.
    pub supervisor: Arc<Supervisor>,
    /// The gateway proxies.
    pub hubs: Hubs,
    /// The OS keychain.
    pub secrets: Arc<dyn SecretStore>,
    /// Tunable numbers.
    pub limits: Limits,
}

struct ChannelSink(Channel<Frame>);

impl FrameSink for ChannelSink {
    fn send(&self, frame: &str) -> Result<()> {
        let raw = RawValue::from_string(frame.to_owned())
            .map_err(|e| Error::InvalidFrame(e.to_string()))?;
        self.0
            .send(Frame(raw))
            .map_err(|e| Error::Io(e.to_string()))
    }
}

/// The app-wide link-state event (`connecting`, `ready`, `degraded`, `incompatible`), for windows that have no
/// connection yet. A connection also gets the same news as a `connection.state` frame.
#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
pub struct ConnectionStateEvent {
    /// The profile the link belongs to.
    pub profile: String,
    /// The phase.
    pub state: Phase,
    /// Consecutive failed dials.
    pub attempts: u32,
    /// The last failure, when not ready.
    pub error: Option<HostError>,
}

/// The `gateway_connect` answer.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Connected {
    /// The id to use for `gateway_send` and `gateway_disconnect`.
    pub connection_id: u32,
    /// The result of `runtime.describe`.
    pub describe: Json,
}

fn settings(app: &AppHandle) -> Result<AppSettings> {
    let store = app
        .store("settings.json")
        .map_err(|e| Error::Io(e.to_string()))?;
    AppSettings::migrate(store.get("app").as_ref())
}

fn profile_of(app: &AppHandle, asked: Option<String>) -> Result<Option<String>> {
    Ok(asked.or(settings(app)?.profile))
}

/// Where Hermes is, whether it is new enough, and whether a gateway runs.
#[tauri::command]
#[specta::specta]
pub async fn hermes_status(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<HermesStatus, HostError> {
    let profile = profile_of(&app, profile)?;
    Ok(state.supervisor.status(profile.as_deref()).await)
}

/// Report the documented Hermes installer command. Needs `consent: true`; never runs an installer.
#[tauri::command]
#[specta::specta]
pub fn hermes_install(consent: bool) -> std::result::Result<InstallReport, HostError> {
    Ok(install::plan(consent)?)
}

/// Ask a gateway link that gave up (`incompatible`) to try again, after the user fixed Hermes.
#[tauri::command]
#[specta::specta]
pub fn hermes_retry(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<(), HostError> {
    let profile = profile_of(&app, profile)?;
    let (_, hub) = state.hubs.hub_for(profile.as_deref())?;
    hub.retry();
    Ok(())
}

/// Open a UI connection to the gateway of a profile. Frames arrive on `frames`.
#[tauri::command]
#[specta::specta]
pub async fn gateway_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    frames: Channel<Frame>,
) -> std::result::Result<Connected, HostError> {
    let profile = profile_of(&app, profile)?;
    let (key, hub) = state.hubs.hub_for(profile.as_deref())?;
    let id: ConnectionId = state.hubs.next_id();
    state.hubs.register(id, key);
    let wait = state.limits.ensure_timeout + state.limits.cli_timeout;
    match hub.open(id, Arc::new(ChannelSink(frames)), wait).await {
        Ok(opened) => Ok(Connected {
            connection_id: id,
            describe: Json(opened.describe),
        }),
        Err(e) => {
            state.hubs.forget(id);
            Err(e.into())
        }
    }
}

/// Send a JSON-RPC frame to the gateway. The host validates shape and size and never alters `params`.
#[tauri::command]
#[specta::specta]
pub async fn gateway_send(
    state: State<'_, AppState>,
    connection_id: u32,
    frame: Json,
) -> std::result::Result<(), HostError> {
    let hub = state.hubs.route(connection_id)?;
    Ok(hub.send(connection_id, frame.0).await?)
}

/// Close a UI connection. The link to the gateway stays up for the others.
#[tauri::command]
#[specta::specta]
pub fn gateway_disconnect(
    state: State<'_, AppState>,
    connection_id: u32,
) -> std::result::Result<(), HostError> {
    if let Some(hub) = state.hubs.forget(connection_id) {
        hub.close(connection_id);
    }
    Ok(())
}

/// The proxy's counters and timings, for diagnostics.
#[tauri::command]
#[specta::specta]
pub fn gateway_stats(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<ProxyStats, HostError> {
    let profile = profile_of(&app, profile)?;
    let (_, hub) = state.hubs.hub_for(profile.as_deref())?;
    Ok(hub.stats())
}

/// Store a secret in the OS keychain. There is no command that reads one back.
#[tauri::command]
#[specta::specta]
pub async fn secret_set(
    state: State<'_, AppState>,
    service: String,
    account: String,
    value: String,
) -> std::result::Result<(), HostError> {
    validate_name(&service, &account)?;
    validate_value(&value)?;
    let store = state.secrets.clone();
    tokio::task::spawn_blocking(move || store.set(&service, &account, &value))
        .await
        .map_err(|e| Error::Secrets(e.to_string()))??;
    Ok(())
}

/// Delete a secret from the OS keychain (deleting a missing one succeeds).
#[tauri::command]
#[specta::specta]
pub async fn secret_delete(
    state: State<'_, AppState>,
    service: String,
    account: String,
) -> std::result::Result<(), HostError> {
    validate_name(&service, &account)?;
    let store = state.secrets.clone();
    tokio::task::spawn_blocking(move || store.delete(&service, &account))
        .await
        .map_err(|e| Error::Secrets(e.to_string()))??;
    Ok(())
}

/// Whether a secret exists, for the form's "provided" state. Never returns the value.
#[tauri::command]
#[specta::specta]
pub async fn secret_exists(
    state: State<'_, AppState>,
    service: String,
    account: String,
) -> std::result::Result<bool, HostError> {
    validate_name(&service, &account)?;
    let store = state.secrets.clone();
    let found = tokio::task::spawn_blocking(move || store.get(&service, &account))
        .await
        .map_err(|e| Error::Secrets(e.to_string()))??;
    Ok(found.is_some())
}

/// The host's settings (migrated when old).
#[tauri::command]
#[specta::specta]
pub fn app_settings_get(app: AppHandle) -> std::result::Result<AppSettings, HostError> {
    Ok(settings(&app)?)
}

/// Replace the host's settings. The value is validated; nothing is half-applied.
#[tauri::command]
#[specta::specta]
pub fn app_settings_set(
    app: AppHandle,
    settings: AppSettings,
) -> std::result::Result<(), HostError> {
    settings.validate()?;
    let store = app
        .store("settings.json")
        .map_err(|e| Error::Io(e.to_string()))?;
    store.set(
        "app",
        serde_json::to_value(&settings).map_err(|e| Error::Config(e.to_string()))?,
    );
    store.save().map_err(|e| Error::Io(e.to_string()))?;
    Ok(())
}

/// Show a desktop notification.
#[tauri::command]
#[specta::specta]
pub fn notify(
    app: AppHandle,
    title: String,
    body: String,
    action: Option<String>,
) -> std::result::Result<(), HostError> {
    use tauri_plugin_notification::NotificationExt;
    os::validate_notification(&title, &body)?;
    if let Some(a) = &action {
        if a.is_empty()
            || a.len() > 64
            || !a
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        {
            return Err(Error::InvalidInput(
                "a notification action is 1 to 64 of [A-Za-z0-9._-]".into(),
            )
            .into());
        }
        // Desktop notifications carry no action buttons; the action is accepted so callers need no per-OS code.
        tracing::debug!(action = %a, "notification action ignored on desktop");
    }
    if !settings(&app)?.notifications {
        return Ok(());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| Error::Os(e.to_string()))?;
    Ok(())
}

/// Ask the user for a folder. Returns it home-relative when it is under the user's home; `None` when cancelled.
#[tauri::command]
#[specta::specta]
pub async fn pick_folder(app: AppHandle) -> std::result::Result<Option<PickedFolder>, HostError> {
    use tauri_plugin_dialog::DialogExt;
    let home = app
        .path()
        .home_dir()
        .map_err(|e| Error::Os(e.to_string()))?;
    let start = home.clone();
    let picked = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(start)
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| Error::Os(e.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| Error::Os(e.to_string()))?;
    Ok(Some(os::to_home_relative(&path, &home)))
}

/// Open an `http` or `https` link in the user's browser.
#[tauri::command]
#[specta::specta]
pub fn open_external(app: AppHandle, url: String) -> std::result::Result<(), HostError> {
    use tauri_plugin_opener::OpenerExt;
    let url = os::validate_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| Error::Os(e.to_string()))?;
    Ok(())
}
