//! The boopis desktop host: the machine authority of the Tauri app (`docs/ARCHITECTURE.md` sections 1, 3, 4, 10).
//!
//! It owns the Hermes lifecycle, the gateway connection (a validating, multiplexing proxy), the OS keychain, windows
//! and notifications. The UI owns the experience and the backend (Hermes plus the plugin) owns the work.

pub mod brand;
pub mod chatgpt;
pub mod claude;
pub mod cli;
pub mod commands;
pub mod config;
pub mod connectors;
pub mod endpoint;
#[cfg(test)]
mod engine_words;
pub mod error;
pub mod frame_rate;
pub mod free_tier;
pub mod gateway;
pub mod gpu;
pub mod hermes;
pub mod migrate;
pub mod os;
pub mod renderer;
pub mod resources;
pub mod runtime;
pub mod secrets;
pub mod settings;
pub mod setup;
pub mod state;
pub mod webkit;

use std::sync::Arc;

use tauri::Manager;
use tauri_specta::{Builder, Event, collect_commands, collect_events};

use commands::{AppState, ConnectionStateEvent};

/// Where the generated TypeScript bindings live, relative to this crate.
pub const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/src/host/bindings.ts");

/// The command and event registry, shared by the app and the bindings export.
#[must_use]
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
            commands::engine_source_get,
            commands::gateway_connect,
            commands::gateway_send,
            commands::gateway_disconnect,
            commands::gateway_stats,
            commands::secret_set,
            commands::secret_delete,
            commands::secret_exists,
            commands::app_settings_get,
            commands::app_settings_set,
            commands::notify,
            commands::pick_folder,
            commands::open_external,
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
            commands::app_restart,
            commands::chatgpt_status,
            commands::chatgpt_signin_start,
            commands::chatgpt_signin_cancel,
            commands::chatgpt_sign_out,
        ])
        .events(collect_events![
            ConnectionStateEvent,
            setup::SetupProgress,
            chatgpt::ChatgptSigninEvent,
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
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,boopis_host=info"));
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

/// Run the app, or one of the command-line commands (`boopis --version`, `boopis doctor`) when the arguments ask.
#[allow(clippy::too_many_lines)] // one linear start-up: decide the GPU and renderer, then build the app
pub fn run() {
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .on_window_event(|window, event| {
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
        .setup(move |app| {
            builder.mount_events(app);
            app.manage(commands::RendererState(renderer_report));
            app.manage(commands::GpuState {
                inputs: gpu_inputs,
                source: gpu_source,
                decision: gpu_decision,
            });
            // Lift WebKit's 60 fps preference on a display faster than 60 Hz (ADR-0025).
            let fps = frame_rate::State::new(frame_rate::Policy::from_env());
            app.manage(fps.clone());
            let _ = frame_rate::refresh(app.handle(), &fps);
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
            let peers = Arc::new(match &channel_auth {
                Some(auth) => secrets::PeerPolicy::new().holding(auth.token_entry()),
                None => secrets::PeerPolicy::new(),
            });
            let mut supervisor = hermes::Supervisor::new(environment, limits.clone());
            if let Some(auth) = &channel_auth {
                supervisor = supervisor.with_secret_channel(auth.launch_env(), peers.clone());
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
            // boopis's own ChatGPT sign-in (ADR-0030): its outcome reaches every window, and its refresher keeps the access
            // token fresh in the keychain for as long as the app runs.
            let signin_events = app.handle().clone();
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
                .with_sink(Arc::new(move |e| {
                    if let Err(err) = e.emit(&signin_events) {
                        tracing::debug!(error = %err, "could not emit the ChatGPT sign-in outcome");
                    }
                })),
            );
            tauri::async_runtime::spawn(chatgpt.clone().run_refresher());
            app.manage(AppState {
                chatgpt,
                hubs: state::Hubs::new(supervisor.clone(), limits.clone(), emitter).with_observer(observer),
                supervisor: supervisor.clone(),
                secrets: secrets.clone(),
                limits,
                runtime: plan,
                runtime_error,
                source,
                carries_runtime,
                connectors: std::sync::Mutex::default(),
                bundle: setup::install::Bundle::locate(
                    resource_dir.as_deref(),
                    exe.as_deref().and_then(std::path::Path::parent),
                ),
            });
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
                state.hubs.shutdown();
            }
        }),
        Err(e) => {
            tracing::error!(error = %e, "the app failed to start");
            std::process::exit(1);
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
