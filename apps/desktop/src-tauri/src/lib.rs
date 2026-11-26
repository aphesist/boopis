//! The boopis desktop host: the machine authority of the Tauri app (`docs/ARCHITECTURE.md` sections 1, 3, 4, 10).
//!
//! It owns the Hermes lifecycle, the gateway connection (a validating, multiplexing proxy), the OS keychain, windows
//! and notifications. The UI owns the experience and the backend (Hermes plus the plugin) owns the work.

pub mod bots;
pub mod brand;
pub mod chatgpt;
pub mod claude;
pub mod cli;
pub mod commands;
pub mod config;
pub mod connectors;
pub mod copilot;
pub mod dictation;
pub mod endpoint;
#[cfg(test)]
mod engine_words;
pub mod error;
pub mod frame_rate;
pub mod free_tier;
pub mod frontier;
pub mod gateway;
pub mod gpu;
pub mod hermes;
pub mod house;
pub mod kanban;
pub mod local;
pub mod local_api;
pub mod migrate;
pub mod model_names;
pub mod os;
pub mod paths;
pub mod providers;
pub mod renderer;
pub mod resources;
pub mod rooms;
pub mod rules;
pub mod runtime;
pub mod secrets;
pub mod settings;
pub mod setup;
pub mod state;
pub mod store;
pub mod team;
pub mod tls;
pub mod voice;
pub mod webkit;
pub mod webview_health;
pub mod window;
pub mod xai;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_store::StoreExt;
use tauri_specta::{Builder, Event, collect_commands, collect_events};

use commands::{
    AppState, ConnectionStateEvent, EngineUpdateEvent, FileDragEvent, RoomHeldEvent,
    WindowStateEvent,
};

/// Where the generated TypeScript bindings live, relative to this crate.
pub const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/src/host/bindings.ts");

/// The command and event registry, shared by the app and the bindings export.
#[must_use]
#[allow(clippy::too_many_lines)] // one line per command and event: the list `commands_match_the_capability` checks
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::hermes_status,
            commands::hermes_install,
            commands::hermes_retry,
            commands::setup_check,
            commands::setup_advance,
            commands::setup_reopen_models,
            commands::setup_models_view,
            commands::setup_set_heavy,
            commands::engine_source_get,
            commands::gateway_connect,
            commands::gateway_send,
            commands::gateway_disconnect,
            commands::gateway_stats,
            commands::gateway_ack,
            commands::webview_heartbeat,
            commands::secret_set,
            commands::secret_delete,
            commands::secret_exists,
            commands::app_settings_get,
            commands::app_settings_set,
            commands::notify,
            commands::pick_folder,
            commands::open_external,
            commands::path_resolve,
            commands::path_open,
            commands::path_reveal,
            commands::path_editors,
            commands::window_facts,
            commands::window_control,
            commands::pick_attachments,
            commands::renderer_report,
            commands::renderer_open_gpu_page,
            commands::connector_catalog,
            commands::connector_inputs,
            commands::connector_review,
            commands::connector_install,
            commands::connector_list,
            commands::connector_test,
            commands::connector_set_enabled,
            commands::connector_remove,
            commands::connector_signin,
            commands::connector_signin_cancel,
            commands::connector_login,
            commands::kanban_boards,
            commands::kanban_view,
            commands::app_restart,
            commands::chatgpt_status,
            commands::chatgpt_signin_start,
            commands::chatgpt_signin_cancel,
            commands::chatgpt_sign_out,
            commands::store_catalog_list,
            commands::store_search,
            commands::store_refresh,
            commands::store_item_detail,
            commands::store_stage,
            commands::store_plan,
            commands::store_install,
            commands::store_uninstall,
            commands::store_installed,
            commands::store_update_check,
            commands::store_update,
            commands::store_rollback,
            commands::store_set_enabled,
            commands::store_sources,
            commands::store_source_set_enabled,
            commands::store_source_add,
            commands::store_source_remove,
            commands::provider_list,
            commands::provider_set_key,
            commands::provider_remove,
            commands::provider_test_endpoint,
            commands::provider_add_endpoint,
            commands::provider_probe_local,
            commands::provider_use_local,
            commands::provider_signin_start,
            commands::provider_signin_cancel,
            commands::provider_sign_out,
            commands::provider_signin_status,
            commands::local_api_status,
            commands::local_api_set_enabled,
            commands::local_api_rotate_token,
            commands::bots_prepare,
            commands::bots_set_model,
            commands::bots_release,
            commands::bots_notice,
            commands::room_settings_get,
            commands::room_settings_set,
            commands::room_send,
            commands::room_unhold,
            commands::room_send_now,
            commands::room_held,
            commands::bot_run_limit_get,
            commands::bot_run_limit_set,
            commands::dictation_start,
            commands::dictation_stop,
            commands::dictation_model,
            commands::dictation_model_fetch,
            commands::dictation_model_delete,
            commands::rules_get,
            commands::rules_put,
            commands::rules_set_enabled,
            commands::rules_remove,
            commands::rules_undo,
            commands::rules_restore_defaults,
            commands::rules_accept_outside,
            commands::rules_discard_outside,
            commands::rules_reviewer_set,
            commands::owner_grant,
            commands::team_plans_list,
            commands::team_plan_get,
            commands::team_plan_apply,
            commands::team_plan_reject,
            commands::team_plan_undo,
            commands::house_jobs,
            commands::parked_list,
            commands::parked_answer,
            commands::voice_settings_get,
            commands::voice_settings_set,
        ])
        .events(collect_events![
            ConnectionStateEvent,
            setup::SetupProgress,
            chatgpt::ChatgptSigninEvent,
            providers::ProviderSigninEvent,
            WindowStateEvent,
            FileDragEvent,
            EngineUpdateEvent,
            RoomHeldEvent,
            house::PlansChangedEvent,
            rules::RulesChangedOutsideEvent,
            commands::ConnectorRestartEvent
        ])
}

/// Write the TypeScript bindings to `path`.
///
/// # Errors
/// The exporter's error, as text.
pub fn export_bindings(path: &std::path::Path) -> Result<(), String> {
    specta_builder()
        .export(specta_typescript::Typescript::default(), path)
        .map_err(|e| e.to_string())
}

fn init_logging() {
    use tracing_subscriber::EnvFilter;
    // whisper.cpp writes a page of `info` lines each time the speech model loads (its own log, through `whisper_rs`)
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,boopis_host=info,whisper_rs=warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

/// What the host decides about the webview before anything starts: the renderer and the GPU (ADR-0024, ADR-0025).
pub struct Startup {
    /// The renderer's inputs.
    pub renderer_inputs: renderer::Inputs,
    /// The GPU's inputs.
    pub gpu_inputs: gpu::Inputs,
    /// Where the GPU choice came from.
    pub gpu_source: gpu::PolicySource,
    /// The GPU decision.
    pub gpu_decision: gpu::Decision,
    /// Everything the diagnostics show.
    pub report: renderer::RendererReport,
}

/// Probe the machine and decide the GPU, then the renderer. With `apply` the decided variables are set in the process
/// environment, which must then happen before any thread exists (`run()`); without it nothing is changed (`boopis
/// doctor` reads the same decisions).
#[must_use]
pub fn startup(apply: bool) -> Startup {
    let mut renderer_inputs = renderer::probe();
    // The GPU first (BOOPIS_GPU): offload moves the rendering, which the renderer rules then judge.
    let (gpu_inputs, gpu_source) = gpu::probe(
        renderer_inputs.gpus.clone(),
        renderer_inputs.session,
        renderer_inputs.webkit.clone(),
    );
    let (gpu_inputs, gpu_decision) = gpu::plan(gpu_inputs);
    #[cfg(target_os = "linux")]
    if apply {
        gpu::apply(&gpu_decision);
    }
    renderer_inputs.offload = gpu_decision.renders_on_nvidia;
    let renderer_decision = renderer::decide(&renderer_inputs);
    #[cfg(target_os = "linux")]
    if apply {
        renderer::apply(&renderer_decision);
    }
    let report = renderer::report(
        &renderer_inputs,
        &renderer_decision,
        gpu::report(&gpu_inputs, gpu_source, &gpu_decision, gpu_inputs.power),
    );
    #[cfg(not(target_os = "linux"))]
    let _ = apply;
    Startup {
        renderer_inputs,
        gpu_inputs,
        gpu_source,
        gpu_decision,
        report,
    }
}

/// The last window state the UI was told, so a resize that changes neither flag says nothing.
#[derive(Default)]
struct LastWindowState(std::sync::Mutex<Option<commands::WindowStateEvent>>);

/// The main window's events the UI needs: its maximised and full-screen state, and files dragged over it or dropped on it.
fn window_events(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::DragDropEvent;
    let app = window.app_handle();
    match event {
        tauri::WindowEvent::Resized(_) => {
            let now = commands::WindowStateEvent {
                maximized: window.is_maximized().unwrap_or(false),
                fullscreen: window.is_fullscreen().unwrap_or(false),
            };
            let Some(last) = window.try_state::<LastWindowState>() else {
                return;
            };
            let Ok(mut last) = last.0.lock() else { return };
            if *last != Some(now) {
                *last = Some(now);
                if let Err(e) = now.emit(app) {
                    tracing::debug!(error = %e, "could not emit the window state");
                }
            }
        }
        tauri::WindowEvent::DragDrop(drag) => {
            let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
            let css = |p: &tauri::PhysicalPosition<f64>| (p.x / scale, p.y / scale);
            let (phase, (x, y), attachments) = match drag {
                DragDropEvent::Enter { position, .. } => ("enter", css(position), Vec::new()),
                DragDropEvent::Over { position } => ("over", css(position), Vec::new()),
                DragDropEvent::Drop { paths, position } => (
                    "drop",
                    css(position),
                    window::describe_all(paths.iter().map(std::path::PathBuf::as_path)),
                ),
                _ => ("leave", (0.0, 0.0), Vec::new()),
            };
            let event = commands::FileDragEvent {
                phase: phase.into(),
                x,
                y,
                attachments,
            };
            if let Err(e) = event.emit(app) {
                tracing::debug!(error = %e, "could not emit the drag");
            }
        }
        _ => {}
    }
}

/// Run the app, or one of the command-line commands (`boopis --version`, `boopis doctor`) when the arguments ask.
#[allow(clippy::too_many_lines)] // one linear start-up: decide the GPU and renderer, then build the app
pub fn run() {
    // rustls's process default, for anything that asks for one without naming it (every agent of ours names ring: tls.rs)
    tls::install_default();
    let context = tauri::generate_context!();
    // Before anything else: a command-line command prints and exits, and starts no window, thread or logger.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = cli::dispatch(&args, &|| {
        // The same lookup as the app's: Tauri's resource directory, or a native package's (resources.rs).
        let tauri_dir =
            tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
                .ok();
        resources::locate(
            tauri_dir.as_deref(),
            std::env::current_exe().ok().as_deref(),
        )
    }) {
        std::process::exit(code);
    }
    // What a test build kept under the product's former name moves first: the GPU choice below is read from the app's
    // settings file (ADR-0028). Only the filesystem here; the keychain waits for the logger and the threads it needs.
    let migration = migrate::folders(&migrate::app_roots());
    // Before any thread: WebKitGTK reads its renderer switches when the web view is created (ADR-0024).
    let Startup {
        gpu_inputs,
        gpu_source,
        gpu_decision,
        report: renderer_report,
        ..
    } = startup(true);
    init_logging();
    migration.log();
    if !migration.refs.is_empty() {
        migrate::keychain(&secrets::Keychain, &migration.refs).log();
    }
    cli::banner_line(&renderer_report, &gpu_decision);
    tracing::info!(
        session = ?renderer_report.session,
        hyprland = renderer_report.hyprland,
        gpus = ?renderer_report.gpus.iter().map(|g| format!("{}:{}:{}{}", g.card, g.vendor, g.driver.as_deref().unwrap_or("-"), if g.boot_display { ":display" } else { "" })).collect::<Vec<_>>(),
        rule = ?renderer_report.rule,
        set = ?renderer_report.set,
        webkit = renderer_report.webkit.version.as_deref().unwrap_or("unknown"),
        webkit_origin = ?renderer_report.webkit.origin,
        gpu_policy = ?gpu_inputs.policy,
        gpu_rule = ?gpu_decision.rule,
        gpu_set = ?gpu_decision.set,
        gpu_env_source = ?gpu_decision.source,
        power = ?gpu_inputs.power,
        "webview renderer"
    );
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    if std::path::Path::new(BINDINGS_PATH)
        .parent()
        .is_some_and(std::path::Path::exists)
        && let Err(e) = export_bindings(std::path::Path::new(BINDINGS_PATH))
    {
        tracing::warn!(error = %e, "could not refresh the TypeScript bindings");
    }
    let result = tauri::Builder::default()
        // First of all (B28): a second launch hands its arguments to the running app and exits while Tauri builds it, before
        // any window, link or file of its own exists; the running app shows its window and nothing restarts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            bring_forward(app);
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                window_events(window, event);
                // The window that could have asked for a dictation is going away: the microphone closes (ADR-0059).
                if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                ) && let Some(state) = window.try_state::<AppState>()
                {
                    dictation::stop_for_window(&state.dictation);
                }
            }
            // A window dragged to another monitor may have another refresh rate (ADR-0025); a look at a rate that has
            // not changed is one GDK query.
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
                && let Some(state) = window.try_state::<frame_rate::State>()
            {
                let _ = frame_rate::refresh(window.app_handle(), &state);
            }
        })
        .on_page_load(|webview, payload| {
            // The main page is loading again (a reload, or the watchdog's recovery): the old page's connections have
            // no reader any more. The new page connects afresh and reads its state from the engine.
            if webview.label() != "main" || payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            if let Some(health) = webview.try_state::<Arc<webview_health::Health>>() {
                health.signal(health.now_ms(), webview_health::Signal::Loading);
            }
            if let Some(state) = webview.try_state::<AppState>() {
                // the page that asked for a dictation is gone with its composer: nothing is left to listen for
                dictation::stop_for_window(&state.dictation);
                let closed = state.hubs.close_all_connections();
                if closed > 0 {
                    tracing::info!(closed, "the page is loading again; closed its old connections");
                }
            }
        })
        .setup(move |app| {
            builder.mount_events(app);
            app.manage(commands::RendererState(renderer_report));
            // Which desktop this is, decided once: the title bar draws the controls that mean something there.
            let detected = window::detect_here();
            tracing::info!(platform = ?detected.platform, kind = ?detected.kind, desktop = ?detected.desktop, evidence = %detected.evidence, "desktop");
            app.manage(commands::WindowDetected(detected));
            app.manage(LastWindowState::default());
            app.manage(commands::GpuState {
                inputs: gpu_inputs,
                source: gpu_source,
                decision: gpu_decision,
            });
            // Lift WebKit's 60 fps preference on a display faster than 60 Hz (ADR-0025).
            let fps = frame_rate::State::new(frame_rate::Policy::from_env());
            app.manage(fps.clone());
            let _ = frame_rate::refresh(app.handle(), &fps);
            // The web view's watchdog (webview_health.rs): a dead or stuck page is reloaded instead of left grey, and
            // what happened is kept for Diagnostics and `boopis doctor`, this run's and the previous one's.
            let health = webview_health::Health::new(
                app.path().app_data_dir().ok().map(|d| webview_health::file_in(&d)),
                &app.package_info().version.to_string(),
                webview_health::Policy::default(),
            );
            if let Some(last) = &health.report().last_run
                && (last.recoveries > 0 || !last.events.is_empty())
            {
                tracing::info!(recoveries = last.recoveries, events = last.events.len(), longest_stall_ms = last.longest_stall_ms, outbox_peak = last.outbox_peak, "the previous run's web view record");
            }
            webview_health::watch(app.handle(), health.clone());
            app.manage(health);
            let limits = config::Limits::default();
            // Which engine: the one this build carries, unpacked into the app's own folder (ADR-0023), unless
            // `boopis --engine existing` or `BOOPIS_HERMES=existing` asks for the one on this machine. The app itself
            // offers no such choice (ADR-0031); the repository's docs describe it.
            let source = runtime::Source::from_process();
            // The plugin, the runtime and `hx`: Tauri's resource directory, or the one a native package names after
            // its binary (resources.rs).
            let exe = std::env::current_exe().ok();
            let resource_dir = resources::locate(app.path().resource_dir().ok().as_deref(), exe.as_deref());
            let (plan, runtime_error) = runtime::plan_for(
                source,
                resource_dir.as_deref(),
                app.path().app_data_dir().map_err(|e| e.to_string()),
            );
            // The private engine home was `hermes-home` before ADR-0031: move it once, before anything runs from it.
            if let Some(plan) = &plan {
                migrate::engine_home(
                    &plan.data_dir,
                    &|old| engine_answers(old),
                    &|old| stop_engine(plan, old, &limits),
                )
                .log();
            }
            // A build with a manifest, valid or not, is one that carries a runtime (a broken one is reported by setup).
            let carries_runtime = !matches!(runtime::Runtime::locate(resource_dir.as_deref()), Ok(None));
            let mut environment = hermes::Environment::from_process();
            if let Some(plan) = &plan {
                environment = environment.with_bundled(plan.bundled());
            }
            // The plugin's door to the keychain (secrets::channel): its token goes to the gateways this supervisor starts and
            // to nothing else, and the policy learns which process the gateway is so the socket serves that one only.
            let channel_auth = secrets::Auth::mint()
                .inspect_err(|e| tracing::warn!(error = %e, "no plugin secret channel"))
                .ok();
            // The host-ops channel (ADR-0061): its own token and socket, handed to the same gateways beside the secret
            // channel's, and served to the same one process.
            let ops_auth = house::Auth::mint()
                .inspect_err(|e| tracing::warn!(error = %e, "no host-ops channel"))
                .ok();
            let peers = Arc::new(match &channel_auth {
                Some(auth) => secrets::PeerPolicy::new().holding(auth.token_entry()),
                None => secrets::PeerPolicy::new(),
            });
            // The engine's root home: the plugin reads there where to push what a bot is doing (B45).
            let engine_root = environment.hermes_root();
            let mut supervisor = hermes::Supervisor::new(environment, limits.clone());
            if let Some(auth) = &channel_auth {
                let mut env = auth.launch_env();
                if let Some(ops) = &ops_auth {
                    env.extend(ops.launch_env());
                }
                supervisor = supervisor.with_secret_channel(env, peers.clone());
            }
            let supervisor = Arc::new(supervisor);
            // Find Hermes while the UI loads, so the first connect does not pay for `hermes --version` (about 0.2 s).
            let warm = supervisor.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = warm.info().await {
                    tracing::info!(error = %e, "Hermes is not ready yet");
                }
            });
            let handle = app.handle().clone();
            let emitter: state::StatusEmitter = Arc::new(move |profile, status| {
                let event = ConnectionStateEvent {
                    profile: profile.to_owned(),
                    state: status.phase,
                    attempts: status.attempts,
                    error: status.error.clone(),
                };
                if let Err(e) = event.emit(&handle) {
                    tracing::debug!(error = %e, "could not emit the link state");
                }
            });
            let secrets: Arc<dyn secrets::SecretStore> = Arc::new(secrets::Keychain);
            // The free tier's browser challenge: each gateway link is watched for it, and a hidden window with no access to
            // the host runs it (free_tier/).
            let challenge = config::Challenge::default();
            let observer: state::HubObserver = match url::Url::parse(&challenge.portal_origin) {
                Ok(portal) => {
                    let windows = Arc::new(free_tier::challenge::Windows::new(
                        Arc::new(free_tier::windows::TauriWindows::new(app.handle().clone(), portal)),
                        challenge,
                    ));
                    Arc::new(move |hub, active| {
                        tauri::async_runtime::spawn(free_tier::serve::run(
                            hub.clone(),
                            windows.clone(),
                            active,
                        ));
                    })
                }
                Err(e) => {
                    tracing::error!(error = %e, "the free tier's portal origin is not a URL; challenges will not run");
                    Arc::new(|_, _| {})
                }
            };
            // boopis's own ChatGPT sign-in (ADR-0030, on OpenAI's program) and Copilot sign-in (ADR-0039): their outcomes reach
            // every window, and the ChatGPT refresher keeps the access token fresh in the keychain for as long as the app runs.
            let signin_events = app.handle().clone();
            let browser_app = app.handle().clone();
            let chatgpt = Arc::new(
                chatgpt::ChatGpt::new(
                    secrets.clone(),
                    Arc::new(chatgpt::oauth::Https::new(limits.chatgpt_http_timeout)),
                    chatgpt::Timing {
                        signin: limits.chatgpt_signin_timeout,
                        refresh_ahead: limits.chatgpt_refresh_ahead,
                        refresh_every: limits.chatgpt_refresh_every,
                    },
                )
                .with_browser(Arc::new(commands::SystemBrowser(browser_app)))
                .with_sink(Arc::new(move |e| {
                    let way = providers::signin::CHATGPT.to_owned();
                    if let Err(err) = (providers::ProviderSigninEvent {
                        way,
                        outcome: e.outcome.clone(),
                        message: e.message.clone(),
                    })
                    .emit(&signin_events)
                    {
                        tracing::debug!(error = %err, "could not emit the ChatGPT sign-in outcome");
                    }
                    if let Err(err) = e.emit(&signin_events) {
                        tracing::debug!(error = %err, "could not emit the ChatGPT sign-in outcome");
                    }
                })),
            );
            tauri::async_runtime::spawn(chatgpt.clone().run_refresher());
            let store_root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("store");
            let store = Arc::new(
                store::Store::new(
                    &store_root,
                    limits.clone(),
                    Arc::new(store::net::Https::new(&limits.store)),
                    Arc::new(commands::AppHost(app.handle().clone())),
                )
                .map_err(|e| e.to_string())?,
            );
            let copilot_events = app.handle().clone();
            let copilot = Arc::new(
                copilot::Copilot::new(
                    secrets.clone(),
                    Arc::new(chatgpt::oauth::Https::new(limits.chatgpt_http_timeout)),
                    copilot::Timing {
                        signin: limits.chatgpt_signin_timeout,
                    },
                )
                .with_sink(Arc::new(move |e| {
                    if let Err(err) = e.emit(&copilot_events) {
                        tracing::debug!(error = %err, "could not emit the Copilot sign-in outcome");
                    }
                })),
            );
            tauri::async_runtime::spawn(copilot.clone().run_watcher(limits.chatgpt_refresh_every));
            // boopis's own SuperGrok sign-in (ADR-0039): the same shape, with its own event and refresher.
            let xai_events = app.handle().clone();
            let xai = Arc::new(
                xai::Xai::new(
                    secrets.clone(),
                    Arc::new(chatgpt::oauth::Https::new(limits.chatgpt_http_timeout)),
                    xai::Timing::app(),
                )
                .with_sink(Arc::new(move |e| {
                    if let Err(err) = e.emit(&xai_events) {
                        tracing::debug!(error = %err, "could not emit the xAI sign-in outcome");
                    }
                })),
            );
            tauri::async_runtime::spawn(xai.clone().run_refresher());
            // The local API (`ADR-0045`): presence, notifications and approvals for other clients, and the opt-in endpoint.
            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let house = house::House::new(&app_data, Some(app.handle().clone()));
            let ops_data = app_data.clone();
            let local_api = local_api::LocalApi::new(
                app.handle().clone(),
                app_data,
                &limits.api,
                &limits.rooms,
                Some(engine_root),
                // B47, H4: an owner-voice request is refused from a process under a gateway the host identified
                Arc::new(local_api::owner::SystemCheck::new(peers.clone())),
            );
            let api_feed = local_api.feed().clone();
            // H6: an "Always" answer from outside the window keeps its drafted exception through the app's own rules writer,
            // as a draft, so the writer's record of what it wrote stays true.
            let rules_host = Arc::new(rules::RulesHost::default());
            {
                let (keeper, root) = (rules_host.clone(), supervisor.environment().hermes_root());
                local_api.service().set_draft_keeper(Arc::new(move |rule| {
                    if let Err(e) = keeper.keep_draft(&root, &rule) {
                        tracing::info!(error = %e, "an Always answer's draft exception could not be kept");
                    }
                }));
            }
            local_api.service().set_house_dir(house.dir().to_path_buf());
            // A change to the rules made outside boopis is said to the windows once (rules-engine.md 11).
            tauri::async_runtime::spawn(rules_host.clone().watch(
                supervisor.environment().hermes_root(),
                app.handle().clone(),
                std::time::Duration::from_secs(5),
            ));
            let update_gate = endpoint::Gate::default();
            // Dictation (ADR-0059). Nothing is opened, read or fetched here: the microphone and the speech model wait for
            // the person's first press. The model's name is read once (a change needs a restart).
            let speech_model = app
                .store("settings.json")
                .ok()
                .and_then(|s| settings::AppSettings::migrate(s.get("app").as_ref()).ok())
                .and_then(|s| s.speech_model);
            let dictation = dictation::build(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
                speech_model.as_deref(),
                &limits.dictation,
            );
            app.manage(AppState {
                dictation,
                local_api: local_api.clone(),
                chatgpt,
                copilot,
                xai,
                hubs: state::Hubs::new(supervisor.clone(), limits.clone(), emitter)
                    .with_gate(update_gate.clone())
                    .with_observer(observer)
                    .with_created(Arc::new(move |profile, hub| local_api::forward(&api_feed, profile, hub))),
                supervisor: supervisor.clone(),
                secrets: secrets.clone(),
                limits,
                runtime: plan,
                runtime_error,
                source,
                carries_runtime,
                connectors: std::sync::Mutex::default(),
                bots: Arc::new(bots::engine::Service::new(supervisor.clone())),
                rules: rules_host.clone(),
                house: house.clone(),
                store,
                bundle: setup::install::Bundle::locate(
                    resource_dir.as_deref(),
                    exe.as_deref().and_then(std::path::Path::parent),
                ),
                update_gate,
                updating: std::sync::atomic::AtomicBool::new(false),
            });
            let ops_api = local_api.clone();
            tauri::async_runtime::spawn(async move { local_api.start().await });
            // The host-ops channel. Like the secret channel, a failure is logged and the app works; the plugin's
            // `describe` then does not say host-ops-v1.
            if let (Some(auth), true) = (ops_auth, channel_auth.is_some()) {
                let ops_peers = peers.clone();
                tauri::async_runtime::spawn(async move {
                    let ops: Arc<dyn boopis_hostops::Ops> = Arc::new(house::LiveOps::new(ops_api, house.clone()));
                    match house::start(&house, &auth, ops_peers, ops, &ops_data).await {
                        Ok(listener) => {
                            tracing::info!(socket = %listener.socket().display(), "host-ops channel is up");
                            std::future::pending::<()>().await; // lives as long as the app: Drop removes the socket
                            drop(listener);
                        }
                        Err(e) => tracing::warn!(error = %e, "the host-ops channel did not start"),
                    }
                });
            }
            // The plugin's door to the keychain. A failure (no socket support, another host running) is logged and
            // shown nowhere else: the app works, only the plugin's secret source stays empty.
            if let Some(auth) = channel_auth {
                tauri::async_runtime::spawn(async move {
                    match secrets::channel::start(secrets, &auth, peers).await {
                        Ok(channel) => {
                            tracing::info!(socket = %channel.socket().display(), "plugin secret channel is up");
                            std::future::pending::<()>().await; // lives as long as the app: Drop removes the socket
                            drop(channel);
                        }
                        Err(e) => tracing::warn!(error = %e, "the plugin secret channel did not start"),
                    }
                });
            }
            Ok(())
        })
        .build(context);
    match result {
        Ok(app) => app.run(|handle, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(state) = handle.try_state::<AppState>()
            {
                state.dictation.stop_all();
                tauri::async_runtime::block_on(state.local_api.shutdown());
                state.hubs.shutdown();
            }
        }),
        Err(e) => {
            tracing::error!(error = %e, "the app failed to start");
            std::process::exit(1);
        }
    }
}

/// boopis was launched again while it runs (the desktop launcher, `panacea-ctl open boopis`): its window comes forward instead
/// of a second app starting. A second app used to start its own Local API, and then the first one's shutdown deleted the new
/// one's endpoint and token files (B28). The second launch's arguments are not acted on: a command (`boopis doctor`,
/// `boopis bots ...`) never gets this far (`cli::dispatch` runs it and exits before the app is built), and the engine choice
/// (`--engine`) is the running app's.
fn bring_forward(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::info!("boopis was launched again, and has no main window to show");
        return;
    };
    tracing::info!("boopis was launched again; showing the running window");
    for (what, done) in [
        ("unminimize", window.unminimize()),
        ("show", window.show()),
        ("focus", window.set_focus()),
    ] {
        if let Err(e) = done {
            tracing::debug!(error = %e, what, "could not bring the window forward");
        }
    }
}

/// Whether a gateway answers on the control socket of `home` (the one-time engine move asks before it renames).
fn engine_answers(home: &std::path::Path) -> bool {
    tauri::async_runtime::block_on(hermes::control::identify(home)).is_ok()
}

/// Stop the gateway an earlier run left serving from `home`, with the bundled launcher: this build's, or one an earlier
/// build unpacked (they are removed only after setup succeeds). Waits until its control socket is quiet.
fn stop_engine(
    plan: &runtime::Plan,
    home: &std::path::Path,
    limits: &config::Limits,
) -> std::result::Result<(), String> {
    let runtimes = plan.runtimes_dir();
    let current = plan.runtime.layout(&runtimes).hermes;
    let relative = current
        .strip_prefix(plan.runtime.layout(&runtimes).root)
        .ok()
        .map(std::path::Path::to_path_buf);
    let mut launchers = vec![current];
    if let (Some(rel), Ok(rd)) = (relative, std::fs::read_dir(&runtimes)) {
        launchers.extend(rd.flatten().map(|e| e.path().join(&rel)));
    }
    let Some(launcher) = launchers.into_iter().find(|p| p.is_file()) else {
        return Err("no unpacked engine to stop it with".to_owned());
    };
    let cli = hermes::cli::Cli::new(limits).isolated().with_env(vec![(
        "PYTHONPYCACHEPREFIX".to_owned(),
        plan.bundled().pycache.display().to_string(),
    )]);
    tauri::async_runtime::block_on(async {
        cli.run(
            &launcher,
            home,
            &["gateway", "stop", "--yes"],
            limits.cli_timeout,
        )
        .await
        .map_err(|e| e.to_string())?;
        let deadline = tokio::time::Instant::now() + limits.gateway_stop_wait;
        while hermes::control::identify(home).await.is_ok()
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The commands the build script declares, the capability file allows and the registry exports are one list.
    #[test]
    fn commands_match_the_capability() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let cap: serde_json::Value = serde_json::from_slice(
            &std::fs::read(manifest.join("capabilities/main.json")).unwrap(),
        )
        .unwrap();
        let mut allowed: Vec<String> = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| {
                p.as_str()?
                    .strip_prefix("allow-")
                    .map(|c| c.replace('-', "_"))
            })
            .collect();
        allowed.sort();
        let build = std::fs::read_to_string(manifest.join("build.rs")).unwrap();
        let mut declared: Vec<String> = build
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"')?.strip_suffix("\","))
            .map(str::to_owned)
            .collect();
        declared.sort();
        let source = std::fs::read_to_string(manifest.join("src/lib.rs")).unwrap();
        let mut registered: Vec<String> = source
            .lines()
            .filter_map(|l| {
                l.trim()
                    .strip_prefix("commands::")?
                    .strip_suffix(',')
                    .map(str::to_owned)
            })
            .collect();
        registered.sort();
        assert_eq!(allowed, declared, "capability vs build.rs");
        assert_eq!(registered, declared, "registry vs build.rs");
        assert_ne!(allowed.len(), 0, "the capability lists no command");
    }

    /// CI's staleness check: the checked-in bindings are exactly what the registry generates.
    /// `HX_UPDATE_BINDINGS=1 cargo test -p boopis-host bindings` rewrites the file.
    #[test]
    fn bindings_are_fresh() {
        let path = std::path::Path::new(BINDINGS_PATH);
        let dir = tempfile::tempdir().unwrap();
        let generated = dir.path().join("bindings.ts");
        export_bindings(&generated).unwrap();
        let fresh = std::fs::read_to_string(&generated).unwrap();
        if std::env::var_os("HX_UPDATE_BINDINGS").is_some() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &fresh).unwrap();
        }
        let checked_in = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            checked_in == fresh,
            "apps/desktop/ui/src/host/bindings.ts is stale: run `HX_UPDATE_BINDINGS=1 cargo test -p boopis-host bindings`"
        );
    }
}
