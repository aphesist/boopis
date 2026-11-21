//! The user's own Claude Code, as the Claude subscription plugin sees it (ADR-0029).
//!
//! boopis offers the Claude subscription through Hermes's official plugin `claude-subscription-directsdk`, which drives the
//! unmodified `claude` CLI the user installed and signed in to themselves. This module only **looks**: it finds `claude` the
//! way the plugin does, asks it for its version, and asks it whether it is signed in with its own `claude auth status`. It never
//! reads, copies, stores or forwards a credential, and never opens Claude Code's credential files: the CLI answers for itself.
//! Signing in is the user's: boopis shows `claude auth login` and checks again.
//!
//! What it mirrors, from the plugin's `directsdk_setup.py` (version 0.4.0): `_resolve` (the override variable, else `claude` on
//! `PATH`, else the usual install directories), `setup_status` (`auth status`'s `loggedIn`, `authMethod`, `apiProvider` and
//! `subscriptionType`) and the plugin's README, which names the oldest Claude Code each model alias needs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tokio::process::Command;

/// Hermes's provider id of the plugin: what a ladder tier's model is prefixed with (`<provider>/<alias>`) and the name
/// `hermes plugins list` shows for it. Its catalog name is [`CATALOG_NAME`].
pub const PROVIDER_ID: &str = "claude-subscription-directsdk-experimental";
/// The plugin's name in Hermes's plugin catalog (`hermes plugins install <this>`).
pub const CATALOG_NAME: &str = "claude-subscription-directsdk";
/// The variable the plugin reads to find `claude` outside its usual places.
pub const COMMAND_VAR: &str = "CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND";
/// The variables that choose which Claude Code and which of its login directories the plugin uses. They hold paths, not
/// credentials; the host lets them reach Hermes (`hermes::cli::passes`) so that the plugin and this check look at the same
/// `claude` and the same login. A token (`CLAUDE_CODE_OAUTH_TOKEN`) is never one of them.
pub const PASS_VARS: &[&str] = &[
    COMMAND_VAR,
    "CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR",
    "CLAUDE_CONFIG_DIR",
];
/// How the official CLI is installed, as the plugin's manifest says (`external_dependencies`).
pub const INSTALL_COMMAND: &str = "npm install -g @anthropic-ai/claude-code";
/// How the official CLI signs in. "Sign in to Claude" runs it (the `claude-code` entry of the host's login table, with
/// `--claudeai`); it is Claude Code's own login, and boopis offers no login screen of its own.
pub const LOGIN_COMMAND: &str = "claude auth login";
/// How the official CLI updates itself.
pub const UPDATE_COMMAND: &str = "claude update";

/// A Claude Code version, `major.minor.patch`.
pub type Version = (u32, u32, u32);

/// The model aliases the plugin offers for a ladder, cheapest first, each with the oldest Claude Code that serves it. From the
/// plugin's README ("Requirements", plugin 0.4.0, checked 2026-11-19): Haiku 5.5 needs 2.1.293, Sonnet 5.5 2.1.284 and Opus 5.5
/// 2.1.280, and Fable 5.2 2.1.321; an older CLI answers `400 Claude Code ... does not support this model`. Which of them a
/// ladder uses is the frontier list's call (ADR-0034: opus and fable). Fable bills usage credits on a Pro plan.
pub const ALIASES: &[(&str, Version)] = &[
    ("haiku", (2, 1, 293)),
    ("sonnet", (2, 1, 284)),
    ("opus", (2, 1, 280)),
    ("fable", (2, 1, 321)),
];

/// Where the CLI stands, in the words a person needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// No `claude` was found.
    NotInstalled,
    /// Installed, and it says it is not signed in.
    SignedOut,
    /// Installed and signed in, but with a key or a cloud login that bills API usage, not the subscription.
    Metered,
    /// Signed in, but older than the oldest model's minimum, or its version could not be read.
    OldVersion,
    /// Installed, signed in with a Claude account, and new enough for at least one model.
    SignedIn,
}

/// What a look at the CLI found. Nothing here is a credential.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Probe {
    /// Where it stands.
    pub state: State,
    /// The version it reported (`2.1.328`), when it reported one.
    pub version: Option<String>,
    /// The plan it reports (`Claude Max`), when signed in and it names one.
    pub plan: Option<String>,
    /// One or two plain sentences: what is so, and what to do about it.
    pub detail: String,
    /// The model aliases its version serves, cheapest first. Empty unless the version was read.
    pub aliases: Vec<String>,
}

impl Probe {
    /// Whether the plugin can run on it: signed in with a Claude account and new enough for some model.
    #[must_use]
    pub fn usable(&self) -> bool {
        self.state == State::SignedIn
    }
}

/// Looking at the user's Claude Code, behind a trait so setup's tests use a scripted one.
#[async_trait]
pub trait ClaudeCli: Send + Sync {
    /// Find `claude`, read its version and ask whether it is signed in. Never fails: what could not be read is said in the
    /// probe, not guessed.
    async fn probe(&self) -> Probe;
}

/// `3` in `2.1.328 (Claude Code)`: the first token's numbers.
#[must_use]
pub fn parse_version(text: &str) -> Option<Version> {
    let token = text.split_whitespace().next()?;
    let mut parts = token.trim_start_matches('v').splitn(3, '.');
    let mut next = |last: bool| -> Option<u32> {
        let p = parts.next()?;
        let digits: String = p.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() || (!last && digits.len() != p.len()) {
            return None;
        }
        digits.parse().ok()
    };
    Some((next(false)?, next(false)?, next(true)?))
}

/// The aliases a version serves, cheapest first.
#[must_use]
pub fn aliases_for(version: Version) -> Vec<String> {
    ALIASES
        .iter()
        .filter(|(_, min)| version >= *min)
        .map(|(a, _)| (*a).to_owned())
        .collect()
}

/// The oldest version any model needs.
#[must_use]
pub fn oldest_supported() -> Version {
    ALIASES.iter().map(|(_, v)| *v).min().unwrap_or((0, 0, 0))
}

/// `2.1.280` for a version.
#[must_use]
pub fn show(v: Version) -> String {
    format!("{}.{}.{}", v.0, v.1, v.2)
}

/// Where the plugin looks for `claude` after `PATH`: the usual install directories (its `_install_prefixes`). A relative `HOME`
/// would resolve against the working directory and could run a program planted there, so it gives none.
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn install_dirs(env: &HashMap<String, String>) -> Vec<PathBuf> {
    let home_key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let mut dirs: Vec<PathBuf> = env
        .get(home_key)
        .map(PathBuf::from)
        .filter(|h| h.is_absolute())
        .map(|h| {
            [
                ".local/bin",
                ".claude/local",
                "bin",
                ".npm-global/bin",
                ".bun/bin",
                ".volta/bin",
            ]
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

/// `name` as a runnable file in `dirs` (on Windows with the extensions the shell runs).
fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let candidates: Vec<String> = if cfg!(windows) && Path::new(name).extension().is_none() {
        ["exe", "cmd", "bat", "com"]
            .iter()
            .map(|e| format!("{name}.{e}"))
            .collect()
    } else {
        vec![name.to_owned()]
    };
    dirs.iter()
        .flat_map(|d| candidates.iter().map(move |c| d.join(c)))
        .find(|p| runnable(p))
}

fn runnable(p: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(p) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Find the `claude` the plugin would run, the way its `_resolve` does: the command is `CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND`
/// when set, else `claude`. An absolute path that is runnable is used as it is; a name is looked up on `PATH`; and only the bare
/// name `claude` also tries the usual install directories, because an override is the user's choice and never second-guessed.
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn resolve(env: &HashMap<String, String>) -> Option<PathBuf> {
    let command = env
        .get(COMMAND_VAR)
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .unwrap_or("claude");
    let given = Path::new(command);
    if given.is_absolute() && runnable(given) {
        return Some(given.to_owned());
    }
    let on_path: Vec<PathBuf> = env
        .get("PATH")
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    if let Some(found) = find_in(&on_path, command) {
        return Some(found);
    }
    (command == "claude")
        .then(|| find_in(&install_dirs(env), command))
        .flatten()
}

/// The environment a Claude Code child of the host gets: the variables a Hermes child gets, plus the plugin's path variables
/// (`PASS_VARS`), with the CLI's own self-updates and reporting off, as the plugin runs it. No key or token passes.
#[must_use]
pub fn child_env() -> HashMap<String, String> {
    child_env_from(
        std::env::vars_os()
            .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?))),
    )
}

/// [`child_env`] over the given variables.
#[must_use]
pub fn child_env_from(vars: impl IntoIterator<Item = (String, String)>) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = vars
        .into_iter()
        .filter(|(k, _)| {
            (crate::hermes::cli::passes_isolated(k)) || PASS_VARS.contains(&k.as_str())
        })
        .collect();
    for (k, v) in [
        ("DISABLE_AUTOUPDATER", "1"),
        ("DISABLE_TELEMETRY", "1"),
        ("DISABLE_ERROR_REPORTING", "1"),
        ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ] {
        env.insert(k.to_owned(), v.to_owned());
    }
    env
}

/// How `auth status` says Claude Code would authenticate, when that bills API usage and not the subscription. The plugin's
/// `_METERED_AUTH` and its `apiProvider` rule.
fn metered_how(auth: &Value) -> Option<String> {
    let by_method = match auth["authMethod"].as_str() {
        Some("api_key") => Some("an Anthropic API key".to_owned()),
        Some("api_key_helper") => Some("an API key helper".to_owned()),
        Some("third_party") => Some("a third-party cloud login".to_owned()),
        _ => None,
    };
    by_method.or_else(|| {
        let provider = auth["apiProvider"].as_str().unwrap_or("firstParty");
        (provider != "firstParty").then(|| format!("the {provider} backend"))
    })
}

/// `pro` and `Claude Pro` both name the same plan: the plugin's `_plan_label`.
fn plan_label(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.to_ascii_lowercase().starts_with("claude") {
        return Some(raw.to_owned());
    }
    let mut words = raw.replace('_', " ");
    if let Some(first) = words.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    Some(format!("Claude {words}"))
}

/// A probe from what the CLI said. `version` is its `--version` text when it ran, `auth` its `auth status` JSON when that parsed
/// (`None` when it did not run or printed something else). Pure, so every state is testable without a CLI.
#[must_use]
pub fn assess(installed: bool, version_text: Option<&str>, auth: Option<&Value>) -> Probe {
    let parsed = version_text.and_then(parse_version);
    let version = parsed.map(show);
    let no = |state, detail: String| Probe {
        state,
        version: version.clone(),
        plan: None,
        detail,
        aliases: parsed.map(aliases_for).unwrap_or_default(),
    };
    if !installed {
        return no(
            State::NotInstalled,
            format!(
                "Claude Code is not installed. Install it with `{INSTALL_COMMAND}`, then sign in to Claude (boopis runs Claude Code's own `{LOGIN_COMMAND}`)."
            ),
        );
    }
    let with_version = version
        .as_deref()
        .map_or_else(|| "Claude Code".to_owned(), |v| format!("Claude Code {v}"));
    if let Some(v) = parsed
        && v < oldest_supported()
    {
        return no(
            State::OldVersion,
            format!(
                "{with_version} is older than the oldest one that serves a Claude model here ({}). Update it with `{UPDATE_COMMAND}`, then choose Check again.",
                show(oldest_supported())
            ),
        );
    }
    let signed_in = auth.is_some_and(|a| a["loggedIn"] == true);
    if !signed_in {
        return no(
            State::SignedOut,
            format!(
                "{with_version} is installed but not signed in. Choose Sign in to Claude (boopis runs Claude Code's own `{LOGIN_COMMAND}`), then Check again."
            ),
        );
    }
    let auth = auth.unwrap_or(&Value::Null);
    if let Some(how) = metered_how(auth) {
        return no(
            State::Metered,
            format!(
                "{with_version} is signed in with {how}, which bills API usage instead of your Claude subscription. Choose Sign in to Claude to sign in with your Claude account (boopis runs Claude Code's own `{LOGIN_COMMAND}`), then Check again."
            ),
        );
    }
    if parsed.is_none() {
        return no(
            State::OldVersion,
            format!(
                "{with_version} is signed in, but its version could not be read, so boopis cannot tell which Claude models it serves. Update it with `{UPDATE_COMMAND}`, then choose Check again."
            ),
        );
    }
    let plan = plan_label(auth["subscriptionType"].as_str().unwrap_or(""));
    Probe {
        state: State::SignedIn,
        version,
        detail: format!(
            "{with_version} is signed in{}.",
            plan.as_deref()
                .map_or_else(String::new, |p| format!(" ({p})"))
        ),
        plan,
        aliases: parsed.map(aliases_for).unwrap_or_default(),
    }
}

/// The real thing: the `claude` on this computer, looked at with the environment a Hermes child gets.
pub struct SystemClaude {
    env: HashMap<String, String>,
    timeout: Duration,
}

impl Default for SystemClaude {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemClaude {
    /// A look with the host's own environment and a 20 second limit per command, as the plugin's.
    #[must_use]
    pub fn new() -> Self {
        Self {
            env: child_env(),
            timeout: Duration::from_secs(20),
        }
    }

    /// One command of the CLI: its standard output, or `None` when it did not run, failed to start or took too long. Standard
    /// input is closed, the working directory is the system's temporary one (never a project, whose settings it would read).
    async fn ask(&self, exe: &Path, args: &[&str]) -> Option<String> {
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .env_clear()
            .envs(&self.env)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let out = tokio::time::timeout(self.timeout, cmd.output())
            .await
            .ok()?
            .ok()?;
        // `auth status` exits 1 when signed out and still prints its JSON, so the exit code is not what decides
        Some(
            String::from_utf8_lossy(&out.stdout)
                .chars()
                .take(64 * 1024)
                .collect(),
        )
    }
}

#[async_trait]
impl ClaudeCli for SystemClaude {
    async fn probe(&self) -> Probe {
        let Some(exe) = resolve(&self.env) else {
            return assess(false, None, None);
        };
        let version = self.ask(&exe, &["--version"]).await;
        let auth = self
            .ask(&exe, &["auth", "status"])
            .await
            .and_then(|t| serde_json::from_str::<Value>(t.trim()).ok());
        assess(true, version.as_deref(), auth.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_version_is_read_from_the_clis_own_line() {
        assert_eq!(parse_version("2.1.328 (Claude Code)"), Some((2, 1, 328)));
        assert_eq!(
            parse_version("2.1.263 (synthetic offline CLI)"),
            Some((2, 1, 263))
        );
        assert_eq!(parse_version("v2.1.9-beta.1"), Some((2, 1, 9)));
        for bad in ["", "Claude Code", "2.1", "x.y.z", "2..3"] {
            assert_eq!(parse_version(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn each_alias_needs_the_cli_version_the_plugin_documents() {
        assert_eq!(
            aliases_for((2, 1, 328)),
            ["haiku", "sonnet", "opus", "fable"]
        );
        assert_eq!(
            aliases_for((2, 1, 321)),
            ["haiku", "sonnet", "opus", "fable"]
        );
        assert_eq!(
            aliases_for((2, 1, 320)),
            ["haiku", "sonnet", "opus"],
            "fable needs 2.1.321"
        );
        assert_eq!(aliases_for((2, 1, 293)), ["haiku", "sonnet", "opus"]);
        assert_eq!(
            aliases_for((2, 1, 292)),
            ["sonnet", "opus"],
            "haiku needs 2.1.293"
        );
        assert_eq!(aliases_for((2, 1, 284)), ["sonnet", "opus"]);
        assert_eq!(aliases_for((2, 1, 283)), ["opus"], "sonnet needs 2.1.284");
        assert_eq!(aliases_for((2, 1, 280)), ["opus"]);
        assert!(aliases_for((2, 1, 279)).is_empty());
        assert!(aliases_for((1, 9, 999)).is_empty());
        assert_eq!(aliases_for((3, 0, 0)).len(), 4);
        assert_eq!(oldest_supported(), (2, 1, 280));
    }

    #[test]
    fn the_three_states_each_have_their_own_words() {
        let missing = assess(false, None, None);
        assert_eq!(missing.state, State::NotInstalled);
        assert!(
            missing
                .detail
                .contains("npm install -g @anthropic-ai/claude-code")
        );
        assert!(missing.detail.contains("claude auth login"));
        assert!(missing.version.is_none() && missing.aliases.is_empty());

        let out = assess(
            true,
            Some("2.1.328 (Claude Code)"),
            Some(&json!({"loggedIn": false})),
        );
        assert_eq!(out.state, State::SignedOut);
        assert!(
            out.detail.contains("installed but not signed in")
                && out.detail.contains("claude auth login")
        );
        assert_eq!(out.version.as_deref(), Some("2.1.328"));

        let auth = json!({"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"});
        let ok = assess(true, Some("2.1.328 (Claude Code)"), Some(&auth));
        assert_eq!(ok.state, State::SignedIn);
        assert!(ok.usable());
        assert_eq!(ok.plan.as_deref(), Some("Claude Max"));
        assert_eq!(ok.aliases, ["haiku", "sonnet", "opus", "fable"]);
        assert_eq!(ok.detail, "Claude Code 2.1.328 is signed in (Claude Max).");
    }

    #[test]
    fn an_old_version_is_named_with_the_minimum_and_the_fix() {
        let auth = json!({"loggedIn": true, "authMethod": "claude.ai"});
        let old = assess(true, Some("2.1.200 (Claude Code)"), Some(&auth));
        assert_eq!(old.state, State::OldVersion);
        assert!(!old.usable());
        assert!(old.detail.contains("2.1.280") && old.detail.contains("claude update"));
        assert!(old.aliases.is_empty());
        // an old CLI is reported as old whether or not it is signed in: the version is what stops it
        assert_eq!(assess(true, Some("2.1.200"), None).state, State::OldVersion);
        // some models are served, and the signed-in probe lists exactly those
        let mid = assess(true, Some("2.1.285 (Claude Code)"), Some(&auth));
        assert_eq!(mid.state, State::SignedIn);
        assert_eq!(mid.aliases, ["sonnet", "opus"]);
    }

    #[test]
    fn a_version_that_cannot_be_read_is_never_guessed() {
        let auth = json!({"loggedIn": true, "authMethod": "claude.ai"});
        let p = assess(true, Some("something else"), Some(&auth));
        assert_eq!(p.state, State::OldVersion);
        assert!(p.version.is_none() && p.aliases.is_empty());
        assert!(p.detail.contains("could not be read"));
        // and a CLI that said nothing about being signed in is signed out, not assumed in
        assert_eq!(assess(true, Some("2.1.328"), None).state, State::SignedOut);
        assert_eq!(
            assess(true, Some("2.1.328"), Some(&json!({"unexpected": 1}))).state,
            State::SignedOut
        );
    }

    #[test]
    fn a_login_that_bills_the_api_is_not_a_subscription() {
        for (auth, how) in [
            (
                json!({"loggedIn": true, "authMethod": "api_key"}),
                "an Anthropic API key",
            ),
            (
                json!({"loggedIn": true, "authMethod": "api_key_helper"}),
                "an API key helper",
            ),
            (
                json!({"loggedIn": true, "authMethod": "third_party"}),
                "a third-party cloud login",
            ),
            (
                json!({"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "bedrock"}),
                "the bedrock backend",
            ),
        ] {
            let p = assess(true, Some("2.1.328"), Some(&auth));
            assert_eq!(p.state, State::Metered, "{how}");
            assert!(
                p.detail.contains(how) && p.detail.contains("bills API usage"),
                "{how}"
            );
            assert!(!p.usable());
        }
        // a token made with `claude setup-token` is a subscription's
        let token =
            json!({"loggedIn": true, "authMethod": "oauth_token", "subscriptionType": "pro"});
        let p = assess(true, Some("2.1.328"), Some(&token));
        assert_eq!(
            (p.state, p.plan.as_deref()),
            (State::SignedIn, Some("Claude Pro"))
        );
    }

    #[test]
    fn nothing_but_names_and_a_plan_label_comes_out_of_a_status() {
        // a status that carries an address and an account id: none of it reaches the probe
        let auth = json!({"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "team",
            "email": "someone@example.invalid", "orgId": "org-123", "configDirectory": "/home/u/.claude"});
        let text = serde_json::to_string(&assess(true, Some("2.1.328"), Some(&auth))).unwrap();
        for private in ["someone@example.invalid", "org-123", "/home/u/.claude"] {
            assert!(!text.contains(private), "{private}");
        }
        assert!(text.contains("Claude Team"));
    }

    fn env_of(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[cfg(unix)]
    fn script(dir: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, "#!/bin/sh\necho 2.1.328\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn claude_is_found_as_the_plugin_finds_it() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let on_path = script(&tmp.path().join("bin"), "claude");
        let in_home = script(&home.join(".npm-global/bin"), "claude");
        let path = tmp.path().join("bin").display().to_string();
        let home_s = home.display().to_string();

        // PATH first
        let both = env_of(&[("PATH", &path), ("HOME", &home_s)]);
        assert_eq!(resolve(&both), Some(on_path.clone()));
        // then the usual install directories, so a launch with a bare PATH still finds it
        let bare = env_of(&[("PATH", "/nonexistent"), ("HOME", &home_s)]);
        assert_eq!(resolve(&bare), Some(in_home.clone()));
        // a relative HOME gives no directory: a program planted in the working directory is never run
        let relative = env_of(&[("PATH", "/nonexistent"), ("HOME", "home")]);
        assert!(
            !install_dirs(&relative)
                .iter()
                .any(|d| d.starts_with("home"))
        );
        assert_eq!(
            resolve(&env_of(&[("PATH", "/nonexistent")])).filter(|p| p.starts_with(tmp.path())),
            None
        );

        // the override names the program: an absolute path wins over PATH
        let elsewhere = script(&tmp.path().join("elsewhere"), "my-claude");
        let over = env_of(&[
            ("PATH", &path),
            ("HOME", &home_s),
            (COMMAND_VAR, &elsewhere.display().to_string()),
        ]);
        assert_eq!(resolve(&over), Some(elsewhere.clone()));
        // a bare name is looked up on PATH only: an override is the user's choice and is never second-guessed
        let named = env_of(&[
            ("PATH", &tmp.path().join("elsewhere").display().to_string()),
            (COMMAND_VAR, "my-claude"),
        ]);
        assert_eq!(resolve(&named), Some(elsewhere));
        let lost = env_of(&[
            ("PATH", "/nonexistent"),
            ("HOME", &home_s),
            (COMMAND_VAR, "my-claude"),
        ]);
        assert_eq!(resolve(&lost), None);
        // an override that is not runnable is not replaced by another claude
        let missing = env_of(&[
            ("PATH", &path),
            (
                COMMAND_VAR,
                &tmp.path().join("no-such").display().to_string(),
            ),
        ]);
        assert_eq!(resolve(&missing), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_real_look_runs_the_clis_own_commands_and_reads_their_words() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("claude");
        // a stand-in for the CLI: it answers --version and `auth status` the way Claude Code 2.1.328 does
        std::fs::write(
            &p,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2.1.328 (Claude Code)'; exit 0; fi\nif [ \"$1 $2\" = \"auth status\" ]; then echo '{\"loggedIn\":false,\"authMethod\":\"none\"}'; exit 1; fi\nexit 9\n",
        )
        .unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut look = SystemClaude::new();
        look.env = env_of(&[
            ("PATH", "/usr/bin:/bin"),
            (COMMAND_VAR, &p.display().to_string()),
        ]);
        let probe = look.probe().await;
        assert_eq!(
            probe.state,
            State::SignedOut,
            "auth status exits 1 and still says so"
        );
        assert_eq!(probe.version.as_deref(), Some("2.1.328"));

        look.env = env_of(&[
            ("PATH", "/nonexistent"),
            (COMMAND_VAR, &tmp.path().join("nope").display().to_string()),
        ]);
        assert_eq!(look.probe().await.state, State::NotInstalled);
    }

    #[test]
    fn the_children_environment_has_the_path_variables_and_no_key_or_token() {
        let env = child_env_from(
            [
                ("PATH", "/usr/bin"),
                ("CLAUDE_CONFIG_DIR", "/somewhere/claude"),
                ("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat-secret"),
                ("ANTHROPIC_API_KEY", "sk-ant-api-secret"),
                ("HERMES_HOME", "/not/this"),
                ("SOME_OTHER", "x"),
            ]
            .map(|(k, v)| (k.to_owned(), v.to_owned())),
        );
        assert_eq!(
            env.get("CLAUDE_CONFIG_DIR").map(String::as_str),
            Some("/somewhere/claude")
        );
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));
        for gone in [
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "HERMES_HOME",
            "SOME_OTHER",
        ] {
            assert!(!env.contains_key(gone), "{gone}");
        }
        assert_eq!(
            env.get("DISABLE_AUTOUPDATER").map(String::as_str),
            Some("1")
        );
    }
}
