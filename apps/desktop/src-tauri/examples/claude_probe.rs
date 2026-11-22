//! What boopis finds of Claude Code on this computer, as JSON, for the CI jobs that install it with Anthropic's installer and
//! with npm on Windows, Linux and macOS (`.github/workflows/claude-cli.yml`).
//!
//! ```text
//! claude_probe
//! ```
//!
//! It looks exactly as the app does (`claude::SystemClaude`, the environment a Hermes child gets) and prints one JSON object:
//! the `claude` boopis found and the one the Claude subscription plugin would find by itself, the variable the engine is handed
//! so they agree, the environment the engine gets (`hermes::cli::child_vars`, for the job to run the plugin's own `_resolve`
//! in), whether the Claude desktop app keeps its own copy here, and the probe (state, version, words, install command).
//! Nothing it prints is a credential: `auth status` is read for `loggedIn` and the plan only.

#![allow(clippy::print_stdout, clippy::unwrap_used)]

use std::collections::HashMap;

use boopis_host::claude::{self, ClaudeCli, Os, RealFs, SystemClaude};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let look = SystemClaude::new();
    let located = claude::locate(look.env(), Os::HERE, &RealFs);
    let engine: HashMap<String, String> = boopis_host::hermes::cli::child_vars(true, &[])
        .into_iter()
        .collect();
    let probe = look.probe().await;
    // the sign-in status as Claude Code itself says it (`loggedIn` only), so the job can tell "signed out" from "not read"
    let logged_in = located.found.as_deref().and_then(|exe| {
        let out = std::process::Command::new(exe)
            .args(["auth", "status"])
            .env_clear()
            .envs(look.env())
            .current_dir(std::env::temp_dir())
            .stdin(std::process::Stdio::null())
            .output()
            .ok()?;
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
        v.get("loggedIn").cloned()
    });
    let out = serde_json::json!({
        "os": format!("{:?}", Os::HERE),
        "found": located.found,
        "plugin_alone": located.plugin,
        "engine_override": claude::engine_override(look.env()),
        "engine_env": engine,
        "desktop_copy": claude::desktop_copy(look.env(), Os::HERE, &RealFs),
        "auth_status_logged_in": logged_in,
        "probe": probe,
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
