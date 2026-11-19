//! Build script: declares every app command, so Tauri generates one `allow-<command>` permission each and the
//! capability file can list exactly the commands the window uses (`docs/STANDARDS.md` section 5, Tauri).

/// Every command the UI may invoke. Keep in step with `collect_commands!` in `src/lib.rs` and with
/// `capabilities/main.json`; the `commands_match_the_capability` test checks both.
const COMMANDS: &[&str] = &[
    "hermes_status",
    "hermes_install",
    "hermes_retry",
    "setup_check",
    "setup_advance",
    "gateway_connect",
    "gateway_send",
    "gateway_disconnect",
    "gateway_stats",
    "secret_set",
    "secret_delete",
    "secret_exists",
    "app_settings_get",
    "app_settings_set",
    "notify",
    "pick_folder",
    "open_external",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(e) = tauri_build::try_build(attributes) {
        eprintln!("tauri-build failed: {e:#}");
        std::process::exit(1);
    }
}
