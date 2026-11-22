//! What boopis finds of Claude Code on this computer, as JSON, for the CI jobs that install it with Anthropic's installer and
//! with npm on Windows, Linux and macOS (`.github/workflows/claude-cli.yml`).
//!
//! ```text
//! claude_probe          the lookup and the probe
//! claude_probe signin   start "Sign in to Claude" and stop it at the page that needs a person
//! ```
//!
//! It looks exactly as the app does (`claude::SystemClaude`, the environment a Hermes child gets) and prints one JSON object:
//! the `claude` boopis found and the one the Claude subscription plugin would find by itself, the variable the engine is handed
//! so they agree, the environment the engine gets (`hermes::cli::child_vars`, for the job to run the plugin's own `_resolve`
//! in), whether the Claude desktop app keeps its own copy here, and the probe (state, version, words, install command).
//! Nothing it prints is a credential: `auth status` is read for `loggedIn` and the plan only.
//!
//! `signin` starts the process the card's "Sign in to Claude" starts (`connectors::engine::login_command`: the `claude` the host
//! resolves, the sign-in table's `claude-code` arguments, the login environment, stdin closed, no console window), waits for
//! Claude Code to print the page it sends the person to, then stops it and everything it started. It prints the command line,
//! the program, the page, and whether Claude Code ended by itself first. The page is an authorization request (PKCE): it holds
//! no credential, and the sign-in it starts dies with the process.

#![allow(clippy::print_stdout, clippy::unwrap_used)]

use std::collections::HashMap;
use std::time::Duration;

use boopis_host::claude::{self, ClaudeCli, Os, RealFs, SystemClaude};
use boopis_host::connectors::engine::login_command;
use boopis_host::connectors::logins::LoginTable;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

/// How long Claude Code may take to print its page (a cold start on a CI runner, an npm wrapper).
const PAGE_WAIT: Duration = Duration::from_secs(90);

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let out = if std::env::args().nth(1).as_deref() == Some("signin") {
        signin().await
    } else {
        probe().await
    };
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}

async fn probe() -> serde_json::Value {
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
    serde_json::json!({
        "os": format!("{:?}", Os::HERE),
        "found": located.found,
        "plugin_alone": located.plugin,
        "engine_override": claude::engine_override(look.env()),
        "engine_env": engine,
        "desktop_copy": claude::desktop_copy(look.env(), Os::HERE, &RealFs),
        "auth_status_logged_in": logged_in,
        "probe": probe,
    })
}

/// The first `https://` link on a line, up to the first space.
fn link(line: &str) -> Option<String> {
    let at = line.find("https://")?;
    Some(line[at..].split_whitespace().next()?.to_owned())
}

/// Lines of one of the child's streams, as they come.
fn lines(stream: impl AsyncRead + Unpin + Send + 'static, tx: tokio::sync::mpsc::Sender<String>) {
    tokio::spawn(async move {
        let mut r = BufReader::new(stream).lines();
        while let Ok(Some(l)) = r.next_line().await {
            if tx.send(l).await.is_err() {
                break;
            }
        }
    });
}

async fn signin() -> serde_json::Value {
    // exactly what `Engine::login("claude-code", None)` runs: the table's entry, and the `claude` the plugin would run
    let entry = LoginTable::shared().find("claude-code").cloned().unwrap();
    let Some(program) = claude::resolve(&claude::child_env()) else {
        return serde_json::json!({ "command_line": entry.line(), "program": null, "page": null, "ended_first": false, "said": [] });
    };
    let program = program.display().to_string();
    let mut child = login_command(&program, &entry.args, &[]).spawn().unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    lines(child.stdout.take().unwrap(), tx.clone());
    lines(child.stderr.take().unwrap(), tx);
    let mut said: Vec<String> = Vec::new();
    let mut page = None;
    let mut ended_first = false;
    let deadline = tokio::time::sleep(PAGE_WAIT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            l = rx.recv() => {
                let Some(l) = l else { ended_first = true; break; };
                let l = boopis_host::connectors::engine::clean_line(&l);
                page = link(&l);
                said.push(l);
                if page.is_some() { break; }
            },
            () = &mut deadline => break,
        }
    }
    stop(&mut child).await;
    serde_json::json!({
        "command_line": entry.line(),
        "program": program,
        "page": page,
        "ended_first": ended_first,
        "said": said,
    })
}

/// Stop the sign-in and whatever it started (on Windows an npm `claude.cmd` runs Claude Code under `cmd.exe`).
async fn stop(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(10), child.wait()).await;
}
