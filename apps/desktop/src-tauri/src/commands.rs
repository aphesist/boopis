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
    /// The connector engine of each profile home, kept so a sign-in started by one command can be cancelled by another.
    pub connectors: std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, Arc<Engine>>>,
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

/// Opt in to Fable on the Claude subscription ladder, or out (Settings > Models). Returns the models view as it is after.
#[tauri::command]
#[specta::specta]
pub async fn setup_set_subscription_fable(
    app: AppHandle,
    state: State<'_, AppState>,
    on: bool,
    profile: Option<String>,
) -> std::result::Result<ModelsView, HostError> {
    Ok(setup_engine(&app, &state, profile)?
        .set_subscription_fable(on)
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

fn connector_engine(
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

/// Sign out of ChatGPT: both tokens leave the keychain.
#[tauri::command]
#[specta::specta]
pub async fn chatgpt_sign_out(state: State<'_, AppState>) -> std::result::Result<(), HostError> {
    Ok(state.chatgpt.sign_out().await?)
}
