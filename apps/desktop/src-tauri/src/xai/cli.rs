//! The user's own `grok` program, as the community `grok-acp` plugin sees it (ADR-0039).
//!
//! boopis offers the xAI CLI way through the community plugin `grok-acp` (nicolasdmolina/hermes-grok-acp, pinned by the engine's
//! plugin catalogue and bundled by `scripts/build-runtime.sh`), which drives the unmodified `grok` program the user installed and
//! signed in to themselves. This module only **looks**, as `claude.rs` does for Claude Code: it finds `grok` the way the plugin
//! does, asks it for its version and asks `grok models` whether it is signed in (the plugin's own `grok_setup_status`). It never
//! reads, copies, stores or forwards a credential and never opens `~/.grok`: the program answers for itself. Signing in is the
//! user's (`grok login`); boopis shows the command and checks again.
//!
//! The way is offered only when the SuperGrok sign-in is not in use (`offered_when: signin_unused`, [`offered`]).

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use specta::Type;

use crate::claude::{Version, ask_cli, find_in, parse_version, runnable, show};
use crate::providers::{OfferedWhen, ProviderState, WayKind};

/// The engine's provider id of the plugin: what a ladder tier's model is prefixed with (`grok-acp/<model>`), and the name
/// `hermes plugins list` shows for it. Its catalogue name is the same.
pub const PROVIDER_ID: &str = "grok-acp";
/// The variables the plugin reads to find `grok` outside `PATH` (its `process_command_env_vars`).
pub const COMMAND_VARS: &[&str] = &["HERMES_GROK_ACP_COMMAND", "GROK_CLI_PATH"];
/// The variables that choose which `grok` and which login directory the plugin uses. They hold paths, not credentials; the host
/// lets them reach the engine so the plugin and this look see the same program and login. A key (`XAI_API_KEY`) is never one.
pub const PASS_VARS: &[&str] = &["HERMES_GROK_ACP_COMMAND", "GROK_CLI_PATH", "GROK_HOME"];
/// How the official program is installed (xAI's `grok-build` README).
pub const INSTALL_COMMAND: &str = "curl -fsSL https://x.ai/cli/install.sh | bash";
/// How it is installed on Windows.
pub const INSTALL_COMMAND_WINDOWS: &str = "irm https://x.ai/cli/install.ps1 | iex";
/// How the official program signs in (its own browser sign-in; `--device-auth` for a machine without a browser).
pub const LOGIN_COMMAND: &str = "grok login";
/// The oldest `grok` the pinned plugin was verified against (`grok agent --no-leader stdio`, ACP protocol 1, plugin 0.1.2).
/// An older one may not accept that command line.
pub const MIN_VERSION: Version = (1, 0, 41);

/// The install command for this platform.
#[must_use]
pub const fn install_command() -> &'static str {
    if cfg!(windows) {
        INSTALL_COMMAND_WINDOWS
    } else {
        INSTALL_COMMAND
    }
}

/// Where the program stands, in the words a person needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GrokCliState")]
pub enum State {
    /// No `grok` was found.
    NotInstalled,
    /// Installed, and it says it is not signed in.
    SignedOut,
    /// Older than the plugin was verified against, or its version could not be read.
    OldVersion,
    /// Installed, signed in and new enough.
    SignedIn,
}

/// What a look at the program found. Nothing here is a credential.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "GrokCliProbe")]
pub struct Probe {
    /// Where it stands.
    pub state: State,
    /// The version it reported (`1.0.41`), when it reported one.
    pub version: Option<String>,
    /// The plan it reports (`SuperGrok`), when signed in and it names one.
    pub plan: Option<String>,
    /// One or two plain sentences: what is so, and what to do about it.
    pub detail: String,
}

impl Probe {
    /// Whether the plugin can run on it.
    #[must_use]
    pub fn usable(&self) -> bool {
        self.state == State::SignedIn
    }
}

/// Looking at the user's `grok`, behind a trait so tests use a scripted one.
#[async_trait]
pub trait GrokCli: Send + Sync {
    /// Find `grok`, read its version and ask whether it is signed in. Never fails: what could not be read is said in the probe.
    async fn probe(&self) -> Probe;
}

/// Whether the `xai.cli` way is offered now: the catalogue's `offered_when` rule ([`OfferedWhen::offered`]) with whether the SuperGrok
/// sign-in is in use (connected, or waiting). A person signed in with SuperGrok is not shown a second subscription route; one
/// who never signed in, or whose account xAI refused, is.
#[must_use]
pub fn offered(signin_in_use: bool) -> bool {
    OfferedWhen::SigninUnused.offered(signin_in_use)
}

/// The first word of `text` that reads as a version: `grok 1.0.41 (4220f3b)` gives 1.0.41.
fn version_in(text: &str) -> Option<Version> {
    text.split_whitespace().find_map(parse_version)
}

/// What `grok models` said about the login: the plugin's `_LOGGED_IN` and `_NOT_AUTHENTICATED`, which say "You are logged in
/// with <plan>" or "You are not authenticated" (a logged-out program still prints a generic catalogue). `Some(plan)` when
/// signed in (the plan may be empty), `None` when not.
fn login_in(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    if lower.contains("you are not authenticated") || lower.contains("authentication required") {
        return None;
    }
    let at = lower.find("you are logged in")?;
    let rest = &text[at + "you are logged in".len()..];
    let line = rest.lines().next().unwrap_or("");
    let plan = line
        .trim()
        .strip_prefix("with")
        .or_else(|| line.trim().strip_prefix("With"))
        .map(|p| p.trim().trim_end_matches('.').trim().to_owned())
        .unwrap_or_default();
    Some(plan)
}

/// A probe from what the program said. `version_text` is its `--version` output when it ran, `models_text` the output of
/// `grok models`. Pure, so every state is testable without the program.
#[must_use]
pub fn assess(installed: bool, version_text: Option<&str>, models_text: Option<&str>) -> Probe {
    let parsed = version_text.and_then(version_in);
    let version = parsed.map(show);
    let no = |state, detail: String| Probe {
        state,
        version: version.clone(),
        plan: None,
        detail,
    };
    if !installed {
        return no(
            State::NotInstalled,
            format!(
                "The grok program is not installed. Install it with `{}`, then sign in with `{LOGIN_COMMAND}` and choose Check again.",
                install_command()
            ),
        );
    }
    let with_version = version
        .as_deref()
        .map_or_else(|| "grok".to_owned(), |v| format!("grok {v}"));
    if parsed.is_none_or(|v| v < MIN_VERSION) {
        return no(
            State::OldVersion,
            format!(
                "{with_version} is older than the oldest one boopis was checked with ({}), or its version could not be read. Update it with `{}`, then choose Check again.",
                show(MIN_VERSION),
                install_command()
            ),
        );
    }
    let Some(plan) = models_text.and_then(login_in) else {
        return no(
            State::SignedOut,
            format!(
                "{with_version} is installed but not signed in. Run `{LOGIN_COMMAND}` in a terminal, then choose Check again."
            ),
        );
    };
    let plan = Some(plan).filter(|p| !p.is_empty());
    Probe {
        state: State::SignedIn,
        version,
        detail: format!(
            "{with_version} is signed in{}.",
            plan.as_deref()
                .map_or_else(String::new, |p| format!(" ({p})"))
        ),
        plan,
    }
}

/// The state of the `xai.cli` way. Never an error: the program being absent or signed out is the person's to fix, and says how.
#[must_use]
pub fn provider_state(probe: &Probe) -> ProviderState {
    let way = super::WAY_CLI;
    match probe.state {
        State::SignedIn => {
            let mut s = ProviderState::connected(super::PROVIDER, way, WayKind::Signin);
            s.plan.clone_from(&probe.plan);
            s.detail = Some(probe.detail.clone());
            s
        }
        State::NotInstalled | State::SignedOut | State::OldVersion => {
            let mut s = ProviderState::signed_out(super::PROVIDER, way);
            s.detail = Some(probe.detail.clone());
            s
        }
    }
}

/// The environment a `grok` child of the host gets: the variables a Hermes child gets, plus the plugin's path variables
/// ([`PASS_VARS`]). No key or token passes.
#[must_use]
pub fn child_env_from(vars: impl IntoIterator<Item = (String, String)>) -> HashMap<String, String> {
    vars.into_iter()
        .filter(|(k, _)| crate::hermes::cli::passes_isolated(k) || PASS_VARS.contains(&k.as_str()))
        .collect()
}

/// Where the program is usually found after `PATH`: its own installer's directory (`~/.grok/bin`), then the usual ones. A
/// relative `HOME` would resolve against the working directory and could run a program planted there, so it gives none.
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn install_dirs(env: &HashMap<String, String>) -> Vec<PathBuf> {
    let home_key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let mut dirs: Vec<PathBuf> = env
        .get(home_key)
        .map(PathBuf::from)
        .filter(|h| h.is_absolute())
        .map(|h| {
            [".grok/bin", ".local/bin", "bin"]
                .iter()
                .map(|p| h.join(p))
                .collect()
        })
        .unwrap_or_default();
    if !cfg!(windows) {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    dirs
}

/// Find the `grok` the plugin would run, the way its `resolve_grok_executable` does: the override variable when set (a path that
/// is runnable, or a name on `PATH`), else `grok` on `PATH`, and only the bare name also tries the usual install directories.
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn resolve(env: &HashMap<String, String>) -> Option<PathBuf> {
    let command = COMMAND_VARS
        .iter()
        .find_map(|v| env.get(*v).map(|c| c.trim()).filter(|c| !c.is_empty()))
        .unwrap_or("grok");
    let given = std::path::Path::new(command);
    if given.is_absolute() {
        return runnable(given).then(|| given.to_owned());
    }
    let on_path: Vec<PathBuf> = env
        .get("PATH")
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    if let Some(found) = find_in(&on_path, command) {
        return Some(found);
    }
    (command == "grok")
        .then(|| find_in(&install_dirs(env), command))
        .flatten()
}

/// The real thing: the `grok` on this computer, looked at with the environment a Hermes child gets.
pub struct SystemGrok {
    env: HashMap<String, String>,
    timeout: Duration,
}

impl Default for SystemGrok {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemGrok {
    /// A look with the host's own environment and a 20 second limit per command, as the plugin's.
    #[must_use]
    pub fn new() -> Self {
        Self::with_env(child_env_from(std::env::vars_os().filter_map(|(k, v)| {
            Some((k.into_string().ok()?, v.into_string().ok()?))
        })))
    }

    /// A look with exactly `env` (tests).
    #[must_use]
    pub fn with_env(env: HashMap<String, String>) -> Self {
        Self {
            env,
            timeout: Duration::from_secs(20),
        }
    }
}

#[async_trait]
impl GrokCli for SystemGrok {
    async fn probe(&self) -> Probe {
        let Some(exe) = resolve(&self.env) else {
            return assess(false, None, None);
        };
        let version = ask_cli(&self.env, self.timeout, &exe, &["--version"], true).await;
        // `grok models` is a local listing, not an inference request; it prints who is signed in to either stream
        let models = ask_cli(&self.env, self.timeout, &exe, &["models"], true).await;
        assess(true, version.as_deref(), models.as_deref())
    }
}
