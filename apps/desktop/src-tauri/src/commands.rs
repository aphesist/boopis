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
use crate::connectors::catalog::{self, CatalogEntry};
use crate::connectors::{
    Engine, GatewayMcp, InstallReport as ConnectorInstallReport, Installed, LoginReport, Opener,
    RemoveReport, Request, RestartWhen, Review, SignInReport, SourceKind, TestReport,
    plan as connector_plan,
};
use crate::error::{Error, HostError, Result};
use crate::gateway::reconnect::Phase;
use crate::gateway::{ConnectionId, FrameSink, ProxyStats};
use crate::hermes::install::{self, InstallReport};
use crate::hermes::{HermesStatus, Supervisor};
use crate::os::{self, PickedFolder};
use crate::renderer::RendererReport;
use crate::runtime::{EngineView, Plan, Source};
use crate::secrets::SecretStore;
use crate::secrets::store::{validate_name, validate_value};
use crate::settings::AppSettings;
use crate::setup::install::Bundle;
use crate::setup::ops::CliOps;
use crate::setup::{Answer, Check, ModelsView, Setup, Status};
use crate::state::Hubs;
use crate::window::{Attachment, Detected, describe_all};

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
    /// The local API for other clients (`ADR-0045`): presence, approvals, notifications and the opt-in endpoint.
    pub local_api: Arc<crate::local_api::LocalApi>,
    /// Hermes discovery and lifecycle.
    pub supervisor: Arc<Supervisor>,
    /// The gateway proxies.
    pub hubs: Hubs,
    /// The OS keychain.
    pub secrets: Arc<dyn SecretStore>,
    /// Tunable numbers.
    pub limits: Limits,
    /// The plugin and `hx` this app carries, for first-run setup.
    pub bundle: Bundle,
    /// The Hermes runtime this build carries and will unpack on first run (ADR-0023); `None` uses the user's own Hermes.
    pub runtime: Option<Plan>,
    /// Why a runtime this build should carry cannot be used (a broken manifest): setup says so instead of quietly
    /// falling back to another Hermes.
    pub runtime_error: Option<String>,
    /// Which Hermes this run started with (the advanced setting, `BOOPIS_HERMES`).
    pub source: Source,
    /// Whether this build carries a Hermes runtime.
    pub carries_runtime: bool,
    /// boopis's own ChatGPT sign-in (ADR-0030).
    pub chatgpt: Arc<crate::chatgpt::ChatGpt>,
    /// The store: catalogue, sources, staging and installs (ADR-0038).
    pub store: Arc<crate::store::Store>,
    /// boopis's own GitHub Copilot sign-in (ADR-0039).
    pub copilot: Arc<crate::copilot::Copilot>,
    /// boopis's own SuperGrok sign-in (ADR-0039).
    pub xai: Arc<crate::xai::Xai>,
    /// The connector engine of each profile home, kept so a sign-in started by one command can be cancelled by another.
    pub connectors: std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, Arc<Engine>>>,
    /// The bots: what each one's home needs, and the repair once per run (ADR-0042).
    pub bots: Arc<crate::bots::engine::Service>,
}

/// Where the bots live and what each gets: the root home, and boopis plus the plugins the bundled runtime carries.
#[must_use]
pub fn bots_layout(state: &AppState) -> crate::bots::Layout {
    let carried: Vec<String> = state
        .runtime
        .as_ref()
        .map(|p| {
            p.runtime
                .manifest()
                .plugins
                .iter()
                .map(|c| c.name.clone())
                .collect()
        })
        .unwrap_or_default();
    crate::bots::Layout::new(state.supervisor.environment().hermes_root(), &carried)
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

    /// One message holding a JSON array of the frames: one script run in the web view for the lot, where one per
    /// frame queued thousands of scripts while the window was out of sight.
    fn send_batch(&self, frames: &[Arc<str>]) -> Result<()> {
        if let [one] = frames {
            return self.send(one);
        }
        let mut text = String::with_capacity(frames.iter().map(|f| f.len() + 1).sum::<usize>() + 2);
        text.push('[');
        for (i, f) in frames.iter().enumerate() {
            if i > 0 {
                text.push(',');
            }
            text.push_str(f);
        }
        text.push(']');
        self.send(&text)
    }

    fn acks(&self) -> bool {
        true
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

pub(crate) fn profile_of(app: &AppHandle, asked: Option<String>) -> Result<Option<String>> {
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

fn setup_engine(app: &AppHandle, state: &AppState, profile: Option<String>) -> Result<Setup> {
    let profile = profile_of(app, profile)?;
    let home = state
        .supervisor
        .environment()
        .profile_home(profile.as_deref())?;
    if let Some(why) = &state.runtime_error {
        return Err(Error::Setup(
            "hx.setup.runtime_manifest_invalid",
            format!("{why}; reinstall the app"),
        ));
    }
    let ops = CliOps::new(state.supervisor.clone(), home);
    // The unpack runs for a while inside one `setup_advance` call; its progress reaches every window as an event meanwhile.
    let events = app.clone();
    let setup = Setup::new(Arc::new(ops), state.secrets.clone(), state.bundle.clone())
        .with_chatgpt(state.chatgpt.clone())
        .with_xai(state.xai.clone())
        .with_progress(Arc::new(move |p| {
            if let Err(e) = tauri_specta::Event::emit(&p, &events) {
                tracing::debug!(error = %e, "could not emit the setup progress");
            }
        }));
    Ok(match &state.runtime {
        Some(plan) => setup.with_runtime(plan.clone()),
        None => setup,
    })
}

/// Whether first-run setup still has to run. Read-only: it changes nothing.
#[tauri::command]
#[specta::specta]
pub async fn setup_check(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<Check, HostError> {
    Ok(setup_engine(&app, &state, profile)?.check().await?)
}

/// Run first-run setup as far as it goes. `answer` replies to the form the last call returned (secret values go to the
/// keychain here and nowhere else); `reconsider` asks again about a declined consent. Calling it with neither is
/// "Check again". It never runs an installer.
#[tauri::command]
#[specta::specta]
pub async fn setup_advance(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    answer: Option<Answer>,
    reconsider: bool,
) -> std::result::Result<Status, HostError> {
    Ok(setup_engine(&app, &state, profile)?
        .advance(answer, reconsider)
        .await?)
}

/// Choose the models again, from a notice that the free tier's limit was hit or at any time: forgets the earlier choice so
/// the next `setup_advance` asks it with every choice Hermes can still offer. It changes nothing in Hermes by itself.
#[tauri::command]
#[specta::specta]
pub fn setup_reopen_models(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<(), HostError> {
    Ok(setup_engine(&app, &state, profile)?.reopen_models()?)
}

/// What Settings > Models shows of the configuration: the ladder (which model at which tier) as it is in Hermes's
/// configuration, read through Hermes's own CLI. Read-only. The plan's status is a question for the live gateway, which
/// the UI asks itself (`free_tier.status`).
#[tauri::command]
#[specta::specta]
pub async fn setup_models_view(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<ModelsView, HostError> {
    Ok(setup_engine(&app, &state, profile)?.models_view().await?)
}

/// Turn a heavy model (`fable`, `grok`) on or off for the saved ladder (Settings > Models): on adds it as the top tier, off takes
/// it away, and the choice is remembered. Returns the models view as it is after.
#[tauri::command]
#[specta::specta]
pub async fn setup_set_heavy(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    on: bool,
    profile: Option<String>,
) -> std::result::Result<ModelsView, HostError> {
    Ok(setup_engine(&app, &state, profile)?
        .set_heavy(&id, on)
        .await?)
}

/// Which engine this run uses (the bundled one or the machine's), so the first-run screen says what setup is about to
/// do. Read-only: the choice is `boopis --engine existing` or `BOOPIS_HERMES`, never a setting (ADR-0031).
#[tauri::command]
#[specta::specta]
#[must_use]
pub fn engine_source_get(state: State<'_, AppState>) -> EngineView {
    EngineView {
        running: state.source,
        carries_runtime: state.carries_runtime,
    }
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
        Ok(opened) => {
            // The first link of a run to the root's gateway: every bot is given what its home needs (ADR-0042), in the
            // background, once.
            if matches!(profile.as_deref(), None | Some("" | "default")) {
                state.bots.repair_once(bots_layout(&state));
            }
            Ok(Connected {
                connection_id: id,
                describe: Json(opened.describe),
            })
        }
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

/// The page took one delivery of frames on this connection (`FrameSink::acks`): the host may send the next.
#[tauri::command]
#[specta::specta]
pub fn gateway_ack(
    state: State<'_, AppState>,
    connection_id: u32,
) -> std::result::Result<(), HostError> {
    state.hubs.route(connection_id)?.ack(connection_id);
    Ok(())
}

/// What the host answers the page's heartbeat: the plain notice to show once after the host recovered the page.
#[derive(Debug, Clone, Serialize, Type)]
pub struct HeartbeatReply {
    /// The sentence to show, once, when the host reloaded the page to recover the window.
    pub notice: Option<String>,
}

/// The page's heartbeat (every few seconds): whether it is visible and the longest main-thread stall it measured since
/// the last one, in milliseconds. Kept for Diagnostics with the proxy's outbox peak (`webview_health`).
#[tauri::command]
#[specta::specta]
#[must_use]
pub fn webview_heartbeat(
    state: State<'_, AppState>,
    health: State<'_, Arc<crate::webview_health::Health>>,
    visible: bool,
    stall_ms: u32,
) -> HeartbeatReply {
    let peak = state.hubs.outbox_peak();
    HeartbeatReply {
        notice: health
            .heartbeat(visible, stall_ms, peak)
            .map(|why| why.notice().to_owned()),
    }
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
        .map_err(|e| crate::error::joined(&e))??;
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
        .map_err(|e| crate::error::joined(&e))??;
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
        .map_err(|e| crate::error::joined(&e))??;
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

/// The window as the title bar needs it: the desktop the host found at start, and the window's state now.
#[derive(Debug, Clone, Serialize, Type)]
pub struct WindowFacts {
    /// What the host detected once at start.
    pub detected: Detected,
    /// Whether the window is maximised.
    pub maximized: bool,
    /// Whether the window is full screen.
    pub fullscreen: bool,
}

/// What a title-bar button asks of the window.
#[derive(Debug, Clone, Copy, serde::Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WindowAction {
    /// Minimise.
    Minimize,
    /// Maximise, or restore (leaves full screen first).
    ToggleMaximize,
    /// Full screen on or off.
    ToggleFullscreen,
    /// Close the window (the app quits with its last window).
    Close,
}

/// The window's state, pushed when it changes so the maximise button's icon follows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, tauri_specta::Event)]
pub struct WindowStateEvent {
    /// Whether the window is maximised.
    pub maximized: bool,
    /// Whether the window is full screen.
    pub fullscreen: bool,
}

/// A file being dragged over the window, or dropped on it.
#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
pub struct FileDragEvent {
    /// `enter`, `over`, `leave` or `drop`.
    pub phase: String,
    /// The pointer, in CSS pixels from the page's top left.
    pub x: f64,
    /// The pointer, in CSS pixels from the page's top left.
    pub y: f64,
    /// What was dropped (empty unless `phase` is `drop`).
    pub attachments: Vec<Attachment>,
}

/// The desktop detected at start (managed state).
pub struct WindowDetected(pub Detected);

fn main_window(app: &AppHandle) -> std::result::Result<tauri::WebviewWindow, Error> {
    app.get_webview_window("main")
        .ok_or_else(|| Error::Os("the main window is not there".into()))
}

/// The desktop's kind and the window's state.
#[tauri::command]
#[specta::specta]
pub fn window_facts(
    app: AppHandle,
    detected: State<'_, WindowDetected>,
) -> std::result::Result<WindowFacts, HostError> {
    let w = main_window(&app)?;
    Ok(WindowFacts {
        detected: detected.0.clone(),
        maximized: w.is_maximized().unwrap_or(false),
        fullscreen: w.is_fullscreen().unwrap_or(false),
    })
}

/// Minimise, maximise or restore, full screen, or close the main window.
#[tauri::command]
#[specta::specta]
pub fn window_control(app: AppHandle, action: WindowAction) -> std::result::Result<(), HostError> {
    let w = main_window(&app)?;
    let done = match action {
        WindowAction::Minimize => w.minimize(),
        WindowAction::ToggleMaximize => {
            if w.is_fullscreen().unwrap_or(false) {
                w.set_fullscreen(false)
            } else if w.is_maximized().unwrap_or(false) {
                w.unmaximize()
            } else {
                w.maximize()
            }
        }
        WindowAction::ToggleFullscreen => {
            let on = w.is_fullscreen().unwrap_or(false);
            w.set_fullscreen(!on)
        }
        WindowAction::Close => w.close(),
    };
    done.map_err(|e| Error::Os(e.to_string()).into())
}

/// Ask for files or folders to attach to a message, in the system's own dialog. Empty when cancelled.
#[tauri::command]
#[specta::specta]
pub async fn pick_attachments(
    app: AppHandle,
    kind: String,
) -> std::result::Result<Vec<Attachment>, HostError> {
    use tauri_plugin_dialog::DialogExt;
    let folders = match kind.as_str() {
        "file" => false,
        "folder" => true,
        other => {
            return Err(
                Error::InvalidInput(format!("attach a file or a folder, not {other:?}")).into(),
            );
        }
    };
    let start = app
        .path()
        .home_dir()
        .map_err(|e| Error::Os(e.to_string()))?;
    let picked = tokio::task::spawn_blocking(move || {
        let d = app.dialog().file().set_directory(start);
        if folders {
            d.blocking_pick_folders()
        } else {
            d.blocking_pick_files()
        }
    })
    .await
    .map_err(|e| Error::Os(e.to_string()))?;
    let paths: Vec<std::path::PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    Ok(describe_all(paths.iter().map(std::path::PathBuf::as_path)))
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

/// Which of the paths a message names exist: inside one of `roots` (the session's or the bot's workspace) or absolute and
/// there. Nothing is guessed (`paths.rs`).
#[tauri::command]
#[specta::specta]
pub async fn path_resolve(
    candidates: Vec<String>,
    roots: Vec<String>,
) -> std::result::Result<Vec<Option<crate::paths::ResolvedPath>>, HostError> {
    let home = dirs::home_dir();
    tokio::task::spawn_blocking(move || crate::paths::resolve(&candidates, &roots, home.as_deref()))
        .await
        .map_err(|e| Error::Os(e.to_string()))?
        .map_err(HostError::from)
}

/// Open a path with the system's default app, or with one of the editors `path_editors` found (`editor`: its id). The
/// default app never runs a program: a file that would run is refused (Show in folder and an editor still work).
#[tauri::command]
#[specta::specta]
pub async fn path_open(
    app: AppHandle,
    path: String,
    editor: Option<String>,
) -> std::result::Result<(), HostError> {
    use tauri_plugin_opener::OpenerExt;
    let (abs, _kind) = crate::paths::existing(&path)?;
    let target = abs.to_string_lossy().into_owned();
    if let Some(id) = editor {
        let path_var = std::env::var_os("PATH");
        let (_e, program) = crate::paths::editors_on(path_var.as_deref())
            .into_iter()
            .find(|(e, _)| e.id == id)
            .ok_or_else(|| Error::InvalidInput("that editor is not on this computer".into()))?;
        app.opener()
            .open_path(target, Some(program.to_string_lossy().into_owned()))
            .map_err(|e| Error::Os(e.to_string()))?;
    } else {
        if crate::paths::runs_something(&abs) {
            return Err(Error::InvalidInput(
                "boopis does not run programs from a message: open it in an editor, or show it in its folder".into(),
            )
            .into());
        }
        app.opener()
            .open_path(target, None::<&str>)
            .map_err(|e| Error::Os(e.to_string()))?;
    }
    Ok(())
}

/// Show a path in the file manager, selected.
#[tauri::command]
#[specta::specta]
pub fn path_reveal(app: AppHandle, path: String) -> std::result::Result<(), HostError> {
    use tauri_plugin_opener::OpenerExt;
    let (abs, _kind) = crate::paths::existing(&path)?;
    app.opener()
        .reveal_item_in_dir(abs)
        .map_err(|e| Error::Os(e.to_string()))?;
    Ok(())
}

/// The editors found on this computer, to open a file in.
#[tauri::command]
#[specta::specta]
#[must_use]
pub fn path_editors() -> Vec<crate::paths::PathEditor> {
    let path_var = std::env::var_os("PATH");
    crate::paths::editors_on(path_var.as_deref())
        .into_iter()
        .map(|(e, _)| e)
        .collect()
}

/// Opens a sign-in page in the person's browser through the system opener (the ChatGPT sign-in's authorization address carries
/// the account hints, so the host opens it itself and the webview is never handed it).
pub struct SystemBrowser(pub AppHandle);

impl crate::chatgpt::Browser for SystemBrowser {
    fn open(&self, url: &str) -> bool {
        use tauri_plugin_opener::OpenerExt;
        let Ok(url) = os::validate_external_url(url) else {
            return false;
        };
        self.0.opener().open_url(url.as_str(), None::<&str>).is_ok()
    }
}

/// What the host decided about the webview's renderer at startup (managed state, read-only).
pub struct RendererState(pub RendererReport);

/// What the GPU rule decided at startup (managed state, read-only): the report adds the power source as it is now.
pub struct GpuState {
    /// What the rule read.
    pub inputs: crate::gpu::Inputs,
    /// Where the policy came from.
    pub source: crate::gpu::PolicySource,
    /// What it decided.
    pub decision: crate::gpu::Decision,
}

/// The renderer diagnostics: the session, the GPUs and their drivers, the rule that decided, the environment the web
/// process was started with, the `WebKitGTK` version and origin, the display's refresh rate, whether `WebKit`'s 60 fps
/// preference is off and the power profile. The frame-rate part is read from the live window. Read-only; the numbers in
/// it are what the owner sends when asked.
#[tauri::command]
#[specta::specta]
pub async fn renderer_report(
    app: AppHandle,
    state: State<'_, RendererState>,
    frame_rate: State<'_, crate::frame_rate::State>,
    gpu: State<'_, GpuState>,
) -> std::result::Result<RendererReport, HostError> {
    let mut report = state.0.clone();
    report.frame_rate = crate::frame_rate::current(&app, &frame_rate).await;
    let power = tokio::task::spawn_blocking(crate::gpu::power_source)
        .await
        .unwrap_or(crate::gpu::PowerSource::Unknown);
    report.gpu = crate::gpu::report(&gpu.inputs, gpu.source, &gpu.decision, power);
    report.errors = crate::error::recent();
    if let Some(health) = app.try_state::<Arc<crate::webview_health::Health>>() {
        report.health = Some(health.report());
    }
    Ok(report)
}

/// Restart the app, so the choices read at startup (the GPU, `BOOPIS_FPS`, the renderer) apply. The webview's GPU is
/// fixed when the process starts; this is the only way to change it.
#[tauri::command]
#[specta::specta]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

/// Open `WebKitGTK`'s own `webkit://gpu` page in a window of its own: its version, the buffer path in use (`DMABUF` or
/// shared memory), the EGL and GL vendor, and the acceleration policy. The window has no access to the host's commands.
#[tauri::command]
#[specta::specta]
pub async fn renderer_open_gpu_page(app: AppHandle) -> std::result::Result<(), HostError> {
    #[cfg(target_os = "linux")]
    {
        use tauri::{WebviewUrl, WebviewWindowBuilder};
        if let Some(w) = app.get_webview_window("webkit-gpu") {
            w.set_focus().map_err(|e| Error::Os(e.to_string()))?;
            return Ok(());
        }
        let url = "webkit://gpu"
            .parse()
            .map_err(|e: url::ParseError| Error::Os(e.to_string()))?;
        WebviewWindowBuilder::new(&app, "webkit-gpu", WebviewUrl::External(url))
            .title("WebKit GPU information")
            .inner_size(900.0, 720.0)
            .build()
            .map_err(|e| Error::Os(e.to_string()))?;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err(Error::Os("webkit://gpu exists only in WebKitGTK (Linux)".into()).into())
    }
}

// ---------------------------------------------------------------- connectors (docs/CONNECTORS.md, docs/FORMS.md)

/// Opens a page with the OS opener; the engine has already checked it.
struct AppOpener(AppHandle);

impl Opener for AppOpener {
    fn open(&self, url: &str) -> Result<()> {
        use tauri_plugin_opener::OpenerExt;
        self.0
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| Error::Os(e.to_string()))
    }
}

pub(crate) fn connector_engine(
    app: &AppHandle,
    state: &AppState,
    profile: Option<String>,
) -> Result<Arc<Engine>> {
    let profile = profile_of(app, profile)?;
    let home = state
        .supervisor
        .environment()
        .profile_home(profile.as_deref())?;
    let mut engines = state
        .connectors
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(e) = engines.get(&home) {
        return Ok(e.clone());
    }
    let ops = GatewayMcp::new(state.supervisor.clone(), home.clone());
    let events = app.clone();
    let engine = Arc::new(
        Engine::new(
            Arc::new(ops),
            state.secrets.clone(),
            Arc::new(AppOpener(app.clone())),
            state.limits.clone(),
        )
        .with_notifier(Arc::new(move |done| {
            let event = ConnectorRestartEvent {
                names: done.names,
                ok: done.ok,
                message: done.message,
            };
            if let Err(e) = tauri_specta::Event::emit(&event, &events) {
                tracing::debug!(error = %e, "could not emit the connector restart notice");
            }
        })),
    );
    engines.insert(home, engine.clone());
    Ok(engine)
}

/// A restart that waited for idle sessions has ended: Hermes read the key (or could not be restarted). The app shows it as a notice.
#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
pub struct ConnectorRestartEvent {
    /// The connectors that were waiting for it.
    pub names: Vec<String>,
    /// Hermes restarted and read their keys.
    pub ok: bool,
    /// What to tell the user, including each connector's connection test.
    pub message: String,
}

/// The curated collection, for the picker. Data compiled into the app; asks Hermes nothing.
#[tauri::command]
#[specta::specta]
pub fn connector_catalog() -> std::result::Result<Vec<CatalogEntry>, HostError> {
    Ok(catalog::entries()?)
}

/// The form that asks for a source's inputs: a URL, a command, or the setup values of a collection entry
/// (`connector` and `variant` name it). Nothing is validated or sent anywhere yet.
#[tauri::command]
#[specta::specta]
pub fn connector_inputs(
    source: SourceKind,
    connector: Option<String>,
    variant: Option<String>,
) -> std::result::Result<crate::setup::Form, HostError> {
    let entry = connector.as_deref().zip(variant.as_deref());
    Ok(connector_plan::inputs_form(source, entry)?)
}

/// What an install would add, exactly: the review form (command and arguments, the hosts it reaches, the pin, the keys it
/// needs, the config diff) and the hash the install must name. Validates the request; changes nothing.
#[tauri::command]
#[specta::specta]
pub async fn connector_review(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    request: Request,
) -> std::result::Result<Review, HostError> {
    Ok(connector_engine(&app, &state, profile)?
        .review(&request)
        .await?)
}

/// Install what the review showed. `secrets` carries the key fields' values to the keychain and no further.
#[tauri::command]
#[specta::specta]
pub async fn connector_install(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    request: Request,
    plan_hash: String,
    secrets: std::collections::BTreeMap<String, String>,
    restart: Option<RestartWhen>,
) -> std::result::Result<ConnectorInstallReport, HostError> {
    let engine = connector_engine(&app, &state, profile)?;
    Ok(engine
        .install(&request, &plan_hash, &secrets, restart)
        .await?)
}

/// The MCP servers Hermes has, with their state and the keychain references boopis holds for each.
#[tauri::command]
#[specta::specta]
pub async fn connector_list(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<Vec<Installed>, HostError> {
    Ok(connector_engine(&app, &state, profile)?.list().await?)
}

/// Ask Hermes to connect to a server and list its tools.
#[tauri::command]
#[specta::specta]
pub async fn connector_test(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    name: String,
) -> std::result::Result<TestReport, HostError> {
    Ok(connector_engine(&app, &state, profile)?.test(&name).await?)
}

/// Switch a server on or off, through Hermes.
#[tauri::command]
#[specta::specta]
pub async fn connector_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    name: String,
    enabled: bool,
) -> std::result::Result<(), HostError> {
    Ok(connector_engine(&app, &state, profile)?
        .set_enabled(&name, enabled)
        .await?)
}

/// Remove a server through Hermes. `delete_credentials` is the user's agreement to delete the keys boopis holds for it.
#[tauri::command]
#[specta::specta]
pub async fn connector_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    name: String,
    delete_credentials: bool,
) -> std::result::Result<RemoveReport, HostError> {
    Ok(connector_engine(&app, &state, profile)?
        .remove(&name, delete_credentials)
        .await?)
}

/// Sign in to a remote server with OAuth, through Hermes's own flow (its listener, its token store). Resolves when the
/// sign-in ends; `connector_signin_cancel` ends it early.
#[tauri::command]
#[specta::specta]
pub async fn connector_signin(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    name: String,
) -> std::result::Result<SignInReport, HostError> {
    Ok(connector_engine(&app, &state, profile)?
        .signin(&name)
        .await?)
}

/// The engine's Kanban boards, read only (`kanban.rs`). A board is shared by every profile.
#[tauri::command]
#[specta::specta]
pub async fn kanban_boards(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<crate::kanban::Board>, HostError> {
    Ok(crate::kanban::boards(&state.supervisor).await?)
}

/// One board with its tasks, read only.
#[tauri::command]
#[specta::specta]
pub async fn kanban_view(
    state: State<'_, AppState>,
    slug: String,
) -> std::result::Result<crate::kanban::View, HostError> {
    Ok(crate::kanban::view(&state.supervisor, &slug).await?)
}

/// Cancel an open sign-in to `name`.
#[tauri::command]
#[specta::specta]
pub fn connector_signin_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    name: String,
) -> std::result::Result<(), HostError> {
    connector_engine(&app, &state, profile)?.cancel_signin(&name);
    Ok(())
}

/// Run a provider's own sign-in command, by **provider id**: the host maps the id to a program and argument vector of its own
/// (`apps/shared/data/logins.json`, or the named collection entry's reviewed `login`) and never runs what a form's schema says.
/// An id outside the table is refused. Reports the exit status and the end of the output.
#[tauri::command]
#[specta::specta]
pub async fn connector_login(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    connector: Option<String>,
) -> std::result::Result<LoginReport, HostError> {
    Ok(connector_engine(&app, &state, None)?
        .login(&provider, connector.as_deref())
        .await?)
}

// ---------------------------------------------------------------- the ChatGPT sign-in (ADR-0030)

/// Where the ChatGPT sign-in stands: signed in or not, the plan, and the code while a sign-in waits. Read-only.
#[tauri::command]
#[specta::specta]
pub async fn chatgpt_status(
    state: State<'_, AppState>,
) -> std::result::Result<crate::chatgpt::Status, HostError> {
    Ok(state.chatgpt.status().await?)
}

/// Start a ChatGPT sign-in: returns the page to open and the code to type. The wait runs in the host and ends with a
/// `ChatgptSigninEvent`; the tokens go to the keychain and never to the webview.
#[tauri::command]
#[specta::specta]
pub async fn chatgpt_signin_start(
    state: State<'_, AppState>,
) -> std::result::Result<crate::chatgpt::CodeView, HostError> {
    Ok(state.chatgpt.start().await?)
}

/// Cancel the ChatGPT sign-in that is waiting.
#[tauri::command]
#[specta::specta]
pub fn chatgpt_signin_cancel(state: State<'_, AppState>) {
    state.chatgpt.cancel();
}

/// Sign out of ChatGPT: OpenAI is asked to end the renewable session, then both tokens leave the keychain. The answer says
/// whether OpenAI confirmed it.
#[tauri::command]
#[specta::specta]
pub async fn chatgpt_sign_out(
    state: State<'_, AppState>,
) -> std::result::Result<crate::chatgpt::SignedOut, HostError> {
    Ok(state.chatgpt.sign_out().await?)
}

// ---------------------------------------------------------------- the store (docs/STORE.md, docs/PROTOCOL.md 1a)

/// What the store asks of the app: which bot, its connector engine, its gateway.
pub struct AppHost(pub AppHandle);

impl crate::store::backend::Host for AppHost {
    fn bot(&self, profile: Option<String>) -> Result<String> {
        let p = profile_of(&self.0, profile)?;
        match p.as_deref() {
            None | Some("" | "default") => Ok("default".to_owned()),
            Some(name) => {
                // The same rule as a profile's name: plain characters only.
                self.0
                    .state::<AppState>()
                    .supervisor
                    .environment()
                    .profile_home(Some(name))
                    .map(|_| name.to_owned())
            }
        }
    }

    fn connectors(&self, bot: &str) -> Result<Arc<Engine>> {
        let state = self.0.state::<AppState>();
        connector_engine(&self.0, &state, (bot != "default").then(|| bot.to_owned()))
    }

    fn backend(&self, bot: &str) -> Result<Arc<dyn crate::store::backend::Backend>> {
        let state = self.0.state::<AppState>();
        let home = state
            .supervisor
            .environment()
            .profile_home((bot != "default").then_some(bot))?;
        Ok(Arc::new(crate::store::backend::GatewayBackend::new(
            state.supervisor.clone(),
            home,
        )))
    }
}

use crate::store::types as st;

/// A page of the catalogue, from the cache. Works offline; `stale` and `offline` say how old it is.
#[tauri::command]
#[specta::specta]
pub async fn store_catalog_list(
    state: State<'_, AppState>,
    filter: Option<st::StoreFilter>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> std::result::Result<st::StoreBrowse, HostError> {
    Ok(state
        .store
        .browse(None, &filter.unwrap_or_default(), cursor.as_deref(), limit)?)
}

/// Search the catalogue. Local: no query leaves the machine.
#[tauri::command]
#[specta::specta]
pub async fn store_search(
    state: State<'_, AppState>,
    query: String,
    filter: Option<st::StoreFilter>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> std::result::Result<st::StoreBrowse, HostError> {
    Ok(state.store.browse(
        Some(&query),
        &filter.unwrap_or_default(),
        cursor.as_deref(),
        limit,
    )?)
}

/// Read the sources again (all that are on, or one).
#[tauri::command]
#[specta::specta]
pub async fn store_refresh(
    state: State<'_, AppState>,
    source: Option<String>,
) -> std::result::Result<Vec<st::StoreSource>, HostError> {
    Ok(state.store.refresh(source.as_deref()).await?)
}

/// Everything the detail page shows.
#[tauri::command]
#[specta::specta]
pub async fn store_item_detail(
    state: State<'_, AppState>,
    id: String,
    profile: Option<String>,
) -> std::result::Result<st::StoreDetail, HostError> {
    Ok(state.store.detail(&id, profile).await?)
}

/// Fetch an item's pin into staging and check it. Nothing runs.
#[tauri::command]
#[specta::specta]
pub async fn store_stage(
    state: State<'_, AppState>,
    id: String,
    profile: Option<String>,
) -> std::result::Result<st::StageResult, HostError> {
    Ok(state.store.stage(&id, profile).await?)
}

/// What installing a staged item would do, exactly, with the hash the install must name.
#[tauri::command]
#[specta::specta]
pub async fn store_plan(
    state: State<'_, AppState>,
    stage_id: String,
    scope: Option<st::Scope>,
    profile: Option<String>,
) -> std::result::Result<st::InstallPlan, HostError> {
    Ok(state.store.plan(&stage_id, scope, profile).await?)
}

/// Install what the card showed. `request.secrets` go to the keychain and no further.
#[tauri::command]
#[specta::specta]
pub async fn store_install(
    state: State<'_, AppState>,
    request: st::InstallRequest,
    profile: Option<String>,
) -> std::result::Result<st::InstallReceipt, HostError> {
    Ok(state.store.install(request, profile, false).await?)
}

/// Remove an installed item. `delete_credentials` is the user's agreement to delete its keys.
#[tauri::command]
#[specta::specta]
pub async fn store_uninstall(
    state: State<'_, AppState>,
    id: String,
    delete_credentials: Option<bool>,
    profile: Option<String>,
) -> std::result::Result<st::UninstallResult, HostError> {
    Ok(state
        .store
        .uninstall(&id, delete_credentials.unwrap_or(false), profile)
        .await?)
}

/// What is installed for a bot: the host's record and the plugin's.
#[tauri::command]
#[specta::specta]
pub async fn store_installed(
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<Vec<st::InstallReceipt>, HostError> {
    Ok(state.store.installed(profile).await?)
}

/// Which installed items have a newer pin, were taken down, or lost their pin. Installs nothing.
#[tauri::command]
#[specta::specta]
pub async fn store_update_check(
    state: State<'_, AppState>,
    id: Option<String>,
    profile: Option<String>,
) -> std::result::Result<Vec<st::UpdateDiff>, HostError> {
    Ok(state.store.update_check(id, profile).await?)
}

/// The install flow on the new pin, after `store_stage`, `store_plan` and the hold.
#[tauri::command]
#[specta::specta]
pub async fn store_update(
    state: State<'_, AppState>,
    id: String,
    request: st::InstallRequest,
    profile: Option<String>,
) -> std::result::Result<st::InstallReceipt, HostError> {
    Ok(state.store.update(&id, request, profile).await?)
}

/// Go back to the version kept one step back.
#[tauri::command]
#[specta::specta]
pub async fn store_rollback(
    state: State<'_, AppState>,
    id: String,
    profile: Option<String>,
) -> std::result::Result<st::InstallReceipt, HostError> {
    Ok(state.store.rollback(&id, profile).await?)
}

/// Switch an installed item on or off for the bot. It takes effect in the next session.
#[tauri::command]
#[specta::specta]
pub async fn store_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
    profile: Option<String>,
) -> std::result::Result<(), HostError> {
    Ok(state.store.set_item_enabled(&id, enabled, profile).await?)
}

/// The sources, with their state.
#[tauri::command]
#[specta::specta]
pub fn store_sources(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<st::StoreSource>, HostError> {
    Ok(state.store.sources())
}

/// Switch a source on or off.
#[tauri::command]
#[specta::specta]
pub fn store_source_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> std::result::Result<(), HostError> {
    Ok(state.store.set_enabled(&id, enabled)?)
}

/// Add a source: a marketplace address, a GitHub repository, a local folder or a bundle file.
#[tauri::command]
#[specta::specta]
pub async fn store_source_add(
    state: State<'_, AppState>,
    url: Option<String>,
    path: Option<String>,
    label: Option<String>,
) -> std::result::Result<st::StoreSource, HostError> {
    Ok(state.store.source_add(url, path, label).await?)
}

/// Remove a source the user added.
#[tauri::command]
#[specta::specta]
pub fn store_source_remove(
    state: State<'_, AppState>,
    id: String,
) -> std::result::Result<(), HostError> {
    Ok(state.store.source_remove(&id)?)
}

// ---------------------------------------------------------------- setup for every lab (ADR-0039)
//
// The signatures below are the contract (`docs/PROTOCOL.md`, "Providers").

/// The provider commands' engine for a profile: its configuration through the engine's own CLI, the keychain, the one outbound read,
/// and the two sign-ins this host can read (Claude Code's, ChatGPT's).
fn providers_engine(
    app: &AppHandle,
    state: &AppState,
    profile: Option<String>,
) -> Result<crate::providers::service::Providers> {
    let profile = profile_of(app, profile)?;
    let home = state
        .supervisor
        .environment()
        .profile_home(profile.as_deref())?;
    let ops = CliOps::new(state.supervisor.clone(), home);
    Ok(crate::providers::service::Providers::new(
        Arc::new(ops),
        state.secrets.clone(),
        crate::providers::service::https(),
    )
    .with_claude(Arc::new(crate::claude::SystemClaude::new()))
    .with_signins(Arc::new(signins(state))))
}

/// Every way's state: the catalogue's ways in order (hidden ones left out), then the endpoints the person added. Read-only,
/// and it never dials a runtime on this computer: those ways answer from the last `provider_probe_local` of this run.
///
/// Errors: `hx.config.invalid`, `hx.secrets.*`.
#[tauri::command]
#[specta::specta]
pub async fn provider_list(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
) -> std::result::Result<Vec<crate::providers::ProviderState>, HostError> {
    Ok(providers_engine(&app, &state, profile)?.list().await?)
}

/// Save a key for a key way, wire it and check it once. The key goes to the keychain (`secret://provider.<slug>/api_key`) and
/// the engine's configuration gets the two usual writes; the key is in no result, log or error. The check is one model listing:
/// a refusal or a failure to reach the provider comes back in the returned state (status `error`, code `hx.provider.key_rejected`
/// or `hx.provider.unreachable`) and the key stays saved. An error means nothing was saved.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported` (a way with no key), `hx.provider.key_invalid`, `hx.secrets.*`,
/// `hx.setup.config_failed`.
#[tauri::command]
#[specta::specta]
pub async fn provider_set_key(
    app: AppHandle,
    state: State<'_, AppState>,
    way: String,
    key: String,
    profile: Option<String>,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    Ok(providers_engine(&app, &state, profile)?
        .set_key(&way, &key)
        .await?)
}

/// Take a way away: its keychain secret and its configuration (for an endpoint, its whole `providers.<slug>` entry). A ladder
/// tier that names it is left as it is and governed mode says why it cannot run. Returns the state afterwards.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported` (a sign-in the host does not own: Claude's is Claude Code's own,
/// ChatGPT's is `chatgpt_sign_out`), `hx.provider.not_found`, `hx.secrets.*`, `hx.setup.config_failed`.
#[tauri::command]
#[specta::specta]
pub async fn provider_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    way: String,
    profile: Option<String>,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    Ok(providers_engine(&app, &state, profile)?
        .remove(&way)
        .await?)
}

/// Test an endpoint before saving it: one GET of `/models` (then `/v1/models`) on the address, with the key as the wire says,
/// no redirect to another host, loopback or https only. Saves and changes nothing. A dial that failed is an outcome in the
/// result, not an error.
///
/// Errors: `hx.provider.endpoint_invalid`, `hx.provider.endpoint_blocked`.
#[tauri::command]
#[specta::specta]
pub async fn provider_test_endpoint(
    request: crate::providers::endpoint::EndpointTestRequest,
) -> std::result::Result<crate::providers::endpoint::EndpointTestResult, HostError> {
    Ok(
        crate::providers::service::test_endpoint(crate::providers::service::https(), request)
            .await?,
    )
}

/// Save an endpoint of the person's own: the slug is derived from the name (`custom-<name>`, the catalogue's rule), the key goes
/// to the keychain, `providers.<slug>` gets `base_url`, `key_env`, `api_mode`, `models` and `discover_models`, and, when
/// `use_model` is set, `model.provider` and `model.default`. Its models are never frontier. Returns the new way's state.
///
/// Errors: `hx.provider.endpoint_invalid`, `hx.provider.endpoint_blocked`, `hx.provider.endpoint_exists`,
/// `hx.provider.key_invalid`, `hx.secrets.*`, `hx.setup.config_failed`.
#[tauri::command]
#[specta::specta]
pub async fn provider_add_endpoint(
    app: AppHandle,
    state: State<'_, AppState>,
    request: crate::providers::endpoint::EndpointRequest,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    Ok(providers_engine(&app, &state, request.profile.clone())?
        .add_endpoint(&request)
        .await?)
}

/// Ask the runtimes on this computer (Ollama, LM Studio, llama.cpp, vLLM) whether they answer, each on its own default port at
/// 127.0.0.1 with the catalogue's short timeout, no key, no other host. Called when Settings > Models opens and on Check again,
/// never in the background. Returns one state per local way: `found_local` with its address and model count, or `not_found`.
///
/// Errors: none for a runtime that does not answer; `hx.internal_error` only for a bug.
#[tauri::command]
#[specta::specta]
pub async fn provider_probe_local(
    profile: Option<String>,
) -> std::result::Result<Vec<crate::providers::ProviderState>, HostError> {
    let _ = profile;
    let states = crate::local::probe_local().await;
    // `provider_list` never dials: it repeats this answer
    crate::providers::service::remember_local_probe(&states);
    Ok(states)
}

/// Use a runtime on this computer that the engine has its own provider for (LM Studio, the built-in `lmstudio`): the host asks it
/// which models it lists (loopback, no key) and makes `model` (or the first it lists) the person's model, on the engine's
/// `lmstudio` provider and not on an endpoint made up for it. Only a model the runtime lists can be chosen, because LM Studio
/// refuses any other id. Models on this computer are never frontier, so governed mode stays off for them. The other runtimes are
/// ordinary endpoints: `provider_add_endpoint`.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported`, `hx.provider.unreachable`, `hx.provider.key_rejected`,
/// `hx.provider.no_models`, `hx.provider.endpoint_invalid`, `hx.setup.config_failed`.
#[tauri::command]
#[specta::specta]
pub async fn provider_use_local(
    app: AppHandle,
    state: State<'_, AppState>,
    way: String,
    model: Option<String>,
    profile: Option<String>,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    Ok(providers_engine(&app, &state, profile)?
        .use_local(&way, model.as_deref())
        .await?)
}

/// The sign-ins the host owns (ChatGPT's, Copilot's and SuperGrok's), as one service.
fn signins(state: &AppState) -> crate::providers::signin::Signins {
    crate::providers::signin::Signins {
        chatgpt: state.chatgpt.clone(),
        copilot: state.copilot.clone(),
        xai: state.xai.clone(),
        grok: Arc::new(crate::xai::cli::SystemGrok::new()),
    }
}

/// Start a sign-in for a sign-in way the host owns (ChatGPT through OpenAI's Sign in with ChatGPT program, GitHub Copilot, and
/// SuperGrok): returns the lab's own page to open and the code to type; a flow whose page does everything
/// (ChatGPT's) has an empty `user_code`. The host opens the browser itself for ChatGPT; the page address returned carries no
/// token. The wait runs in the host and ends with a `ProviderSigninEvent`; the tokens go to the keychain and never to the
/// webview. A way owned by someone else (Claude's, which is Claude Code's own sign-in, and driving the user's own grok program)
/// has nothing to start. Mirrors `chatgpt_signin_start`.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported`, `hx.provider.unreachable`, `hx.secrets.*`, `hx.signin.*`.
#[tauri::command]
#[specta::specta]
pub async fn provider_signin_start(
    state: State<'_, AppState>,
    way: String,
    profile: Option<String>,
) -> std::result::Result<crate::providers::SigninCode, HostError> {
    let _ = profile;
    Ok(signins(&state).start(&way).await?)
}

/// Cancel the sign-in that is waiting for `way`. Mirrors `chatgpt_signin_cancel`.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported`.
#[tauri::command]
#[specta::specta]
pub fn provider_signin_cancel(
    state: State<'_, AppState>,
    way: String,
) -> std::result::Result<(), HostError> {
    Ok(signins(&state).cancel(&way)?)
}

/// Sign out of a sign-in way the host owns: its tokens leave the keychain and the engine's copy is dropped. Returns the state
/// afterwards; its `detail` says so when OpenAI did not confirm ending a ChatGPT session. Mirrors `chatgpt_sign_out`.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported`, `hx.secrets.*`.
#[tauri::command]
#[specta::specta]
pub async fn provider_sign_out(
    state: State<'_, AppState>,
    way: String,
    profile: Option<String>,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    let _ = profile;
    Ok(signins(&state).sign_out(&way).await?)
}

/// Where a sign-in way the host owns stands: signed in (with the plan or the account), not signed in (with the reason the last
/// sign-in ended, if it ended by itself), or waiting for the person (with the page and the code). Read-only; the sign-in
/// cards draw from it and from `ProviderSigninEvent`.
///
/// Errors: `hx.provider.unknown`, `hx.provider.unsupported`, `hx.secrets.*`.
#[tauri::command]
#[specta::specta]
pub async fn provider_signin_status(
    state: State<'_, AppState>,
    way: String,
) -> std::result::Result<crate::providers::ProviderState, HostError> {
    Ok(signins(&state).status(&way).await?)
}

/// The local API's state, as Settings shows it: the owner's switch, whether the endpoint listens, its address, the path of
/// the token file (never the token), and how many streams are open.
#[tauri::command]
#[specta::specta]
pub async fn local_api_status(
    state: State<'_, AppState>,
) -> std::result::Result<crate::local_api::LocalApiStatus, HostError> {
    Ok(state.local_api.status().await)
}

/// The owner's switch for the loopback endpoint. Off by default. Turning it on mints a token and writes
/// `<app data>/client-token` (mode 0600); turning it off closes the endpoint and deletes the file.
///
/// Errors: `hx.config.invalid` with the reason in words (the token file could not be made private, the address could not
/// be opened).
#[tauri::command]
#[specta::specta]
pub async fn local_api_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> std::result::Result<crate::local_api::LocalApiStatus, HostError> {
    state
        .local_api
        .set_enabled(enabled)
        .await
        .map_err(|e| Error::Os(e).into())
}

/// Replace the endpoint's token: the old one stops working at once and every open stream ends. The new one is in the token
/// file only; no command returns it.
///
/// Errors: `hx.config.invalid` when the endpoint is off.
#[tauri::command]
#[specta::specta]
pub async fn local_api_rotate_token(
    state: State<'_, AppState>,
) -> std::result::Result<crate::local_api::LocalApiStatus, HostError> {
    state
        .local_api
        .rotate()
        .await
        .map_err(|e| Error::Os(e).into())
}

/// What preparing a bot did: whether anything changed, and each step that could not be done, in plain words.
#[derive(Debug, Clone, Serialize, Type)]
pub struct BotPrepared {
    /// Its home changed (a plugin placed, a setting written, its seat in groups).
    pub changed: bool,
    /// What could not be done; the other steps were.
    pub problems: Vec<String>,
}

/// Give the bot `name` what its home needs (ADR-0042): the plugins boopis manages, its configuration (the Governed switch of
/// its record among it) and its seat in groups. `fresh` is a bot made just now (its skills for another OS are switched off).
/// The UI calls it after it makes, restores or changes a bot.
#[tauri::command]
#[specta::specta]
pub async fn bots_prepare(
    state: State<'_, AppState>,
    name: String,
    fresh: bool,
) -> std::result::Result<BotPrepared, HostError> {
    let layout = bots_layout(&state);
    let done = state.bots.prepare(&layout, &name, fresh).await?;
    Ok(BotPrepared {
        changed: done.changed(),
        problems: done.problems,
    })
}

/// Take the bot `name` out of the root's groups (its `hosted_rooms.profiles` entry): after it is archived or deleted.
#[tauri::command]
#[specta::specta]
pub async fn bots_release(
    state: State<'_, AppState>,
    name: String,
) -> std::result::Result<(), HostError> {
    let root = state.supervisor.environment().hermes_root();
    state.bots.release(&root, &name).await?;
    Ok(())
}

/// boopis's own settings for one group (`rooms/settings.rs`): the most rounds `boopis run --group` lets a discussion take.
/// The engine has one pair of limits for every room and no per-room value, so this is boopis's, kept in the app's data folder.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RoomSettingsView {
    /// The cap kept for the group, or none (the default applies).
    pub max_rounds: Option<u32>,
    /// The cap a group without its own has.
    pub default_max_rounds: u32,
}

fn room_settings_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(crate::rooms::settings::FILE))
        .map_err(|e| Error::Io(e.to_string()))
}

/// What boopis keeps for the group `room_id`.
///
/// Errors: `hx.invalid_params` for a bad id, `hx.host.config` for a file this build cannot read.
#[tauri::command]
#[specta::specta]
pub fn room_settings_get(
    app: AppHandle,
    room_id: String,
) -> std::result::Result<RoomSettingsView, HostError> {
    let kept = crate::rooms::settings::RoomSettings::load(&room_settings_path(&app)?)?;
    Ok(RoomSettingsView {
        max_rounds: kept.max_rounds(&room_id),
        default_max_rounds: crate::rooms::settings::DEFAULT_MAX_ROUNDS,
    })
}

/// Keep the cap on rounds for the group `room_id` (`None`: the default again).
///
/// Errors: `hx.invalid_params` for a bad id or a cap outside 1 to 1000.
#[tauri::command]
#[specta::specta]
pub fn room_settings_set(
    app: AppHandle,
    room_id: String,
    max_rounds: Option<u32>,
) -> std::result::Result<RoomSettingsView, HostError> {
    let path = room_settings_path(&app)?;
    let mut kept = crate::rooms::settings::RoomSettings::load(&path)?;
    kept.set_max_rounds(&room_id, max_rounds)?;
    kept.save(&path)?;
    Ok(RoomSettingsView {
        max_rounds: kept.max_rounds(&room_id),
        default_max_rounds: crate::rooms::settings::DEFAULT_MAX_ROUNDS,
    })
}

/// A bot's own cap on turns for `boopis run --bot` (`bots/limit.rs`): the engine's goal budget, `goals.max_turns`, kept in the
/// bot's own configuration where the engine reads it.
#[derive(Debug, Clone, Serialize, Type)]
pub struct BotRunLimitView {
    /// The cap the bot keeps, or none (the default applies).
    pub max_turns: Option<u32>,
    /// The cap a bot without its own has.
    pub default_max_turns: u32,
}

/// What the bot `name` keeps.
///
/// Errors: `hx.bots.not_found` for a bot that is not there, `hx.host.config` for a configuration that cannot be read.
#[tauri::command]
#[specta::specta]
pub fn bot_run_limit_get(
    state: State<'_, AppState>,
    name: String,
) -> std::result::Result<BotRunLimitView, HostError> {
    Ok(BotRunLimitView {
        max_turns: state.bots.run_limit(&bots_layout(&state), &name)?,
        default_max_turns: crate::bots::limit::DEFAULT_MAX_TURNS,
    })
}

/// Keep the cap on turns for the bot `name` (`None`: the default again).
///
/// Errors: `hx.invalid_params` for a cap outside 1 to 1000, `hx.bots.not_found` for a bot that is not there.
#[tauri::command]
#[specta::specta]
pub async fn bot_run_limit_set(
    state: State<'_, AppState>,
    name: String,
    max_turns: Option<u32>,
) -> std::result::Result<BotRunLimitView, HostError> {
    let layout = bots_layout(&state);
    state.bots.set_run_limit(&layout, &name, max_turns).await?;
    Ok(BotRunLimitView {
        max_turns: state.bots.run_limit(&layout, &name)?,
        default_max_turns: crate::bots::limit::DEFAULT_MAX_TURNS,
    })
}

/// The one notice the bots' repair left (the governance change), taken: the app shows it once. `None` when there is none.
#[tauri::command]
#[specta::specta]
pub fn bots_notice(state: State<'_, AppState>) -> std::result::Result<Option<String>, HostError> {
    let root = state.supervisor.environment().hermes_root();
    Ok(crate::bots::take_notice(&root)?)
}
