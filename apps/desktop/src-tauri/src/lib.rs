//! The hypotaxis desktop host: the machine authority of the Tauri app (`docs/ARCHITECTURE.md` sections 1, 3, 4, 10).
//!
//! It owns the Hermes lifecycle, the gateway connection (a validating, multiplexing proxy), the OS keychain, windows
//! and notifications. The UI owns the experience and the backend (Hermes plus the plugin) owns the work.

pub mod commands;
pub mod config;
pub mod endpoint;
pub mod error;
pub mod frame_rate;
pub mod gateway;
pub mod gpu;
pub mod hermes;
pub mod os;
pub mod renderer;
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
            commands::app_restart,
        ])
        .events(collect_events![ConnectionStateEvent])
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
        .unwrap_or_else(|_| EnvFilter::new("info,hypotaxis_host=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

/// Run the app.
#[allow(clippy::too_many_lines)] // one linear start-up: decide the GPU and renderer, then build the app
pub fn run() {
    // First thing, before any thread: WebKitGTK reads its renderer switches when the web view is created (ADR-0024).
    let mut renderer_inputs = renderer::probe();
    // The GPU first (HYPOTAXIS_GPU): offload moves the rendering, which the renderer rules then judge.
    let (gpu_inputs, gpu_source) = gpu::probe(
        renderer_inputs.gpus.clone(),
        renderer_inputs.session,
        renderer_inputs.webkit.clone(),
    );
    let (gpu_inputs, gpu_decision) = gpu::plan(gpu_inputs);
    #[cfg(target_os = "linux")]
    gpu::apply(&gpu_decision);
    renderer_inputs.offload = gpu_decision.renders_on_nvidia;
    let renderer_decision = renderer::decide(&renderer_inputs);
    #[cfg(target_os = "linux")]
    renderer::apply(&renderer_decision);
    init_logging();
    let renderer_report = renderer::report(
        &renderer_inputs,
        &renderer_decision,
        gpu::report(&gpu_inputs, gpu_source, &gpu_decision, gpu_inputs.power),
    );
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
            let supervisor = Arc::new(hermes::Supervisor::new(hermes::Environment::from_process(), limits.clone()));
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
            app.manage(AppState {
                hubs: state::Hubs::new(supervisor.clone(), limits.clone(), emitter),
                supervisor: supervisor.clone(),
                secrets: secrets.clone(),
                limits,
                bundle: setup::install::Bundle::locate(
                    app.path().resource_dir().ok().as_deref(),
                    std::env::current_exe().ok().as_deref().and_then(std::path::Path::parent),
                ),
            });
            // The plugin's door to the keychain. A failure (no socket support, another host running) is logged and
            // shown nowhere else: the app works, only the plugin's secret source stays empty.
            let env = supervisor.environment().clone();
            tauri::async_runtime::spawn(async move {
                let Some(dir) = secrets::channel::default_socket_dir() else {
                    tracing::warn!("no directory for the plugin secret channel");
                    return;
                };
                let rendezvous = env.hermes_root().join("hypotaxis").join("host-channel.json");
                match secrets::channel::start(secrets, &dir, &rendezvous).await {
                    Ok(channel) => {
                        tracing::info!(socket = %channel.socket().display(), "plugin secret channel is up");
                        std::future::pending::<()>().await; // lives as long as the app: Drop removes the socket
                        drop(channel);
                    }
                    Err(e) => tracing::warn!(error = %e, "the plugin secret channel did not start"),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!());
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
    /// `HX_UPDATE_BINDINGS=1 cargo test -p hypotaxis-host bindings` rewrites the file.
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
            "apps/desktop/ui/src/host/bindings.ts is stale: run `HX_UPDATE_BINDINGS=1 cargo test -p hypotaxis-host bindings`"
        );
    }
}
