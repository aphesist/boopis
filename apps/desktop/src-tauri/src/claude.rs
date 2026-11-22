//! The user's own Claude Code, as the Claude subscription plugin sees it (ADR-0029).
//!
//! boopis offers the Claude subscription through Hermes's official plugin `claude-subscription-directsdk`, which drives the
//! unmodified `claude` CLI the user installed and signed in to themselves. This module only **looks**: it finds `claude` the
//! way the plugin does, asks it for its version, and asks it whether it is signed in with its own `claude auth status`. It never
//! reads, copies, stores or forwards a credential, and never opens Claude Code's credential files: the CLI answers for itself.
//! Signing in is the user's: boopis shows `claude auth login` and checks again.
//!
//! What it mirrors, from the plugin's `directsdk_setup.py` (plugin 0.3.5 at the commit the engine's catalogue pins): `_resolve`
//! (the override variable, else `claude` on `PATH` with Windows' `PATHEXT`, else the plugin's `_install_prefixes`),
//! `setup_status` (`auth status`'s `loggedIn`, `authMethod`, `apiProvider` and `subscriptionType`) and the plugin's README,
//! which names the oldest Claude Code each model alias needs.
//!
//! Where Anthropic's installers put `claude` (<https://code.claude.com/docs/en/setup> and `troubleshoot-install`, read on
//! 22 November 2026): the native installer at `~/.local/bin/claude` (macOS, Linux) and `%USERPROFILE%\.local\bin\claude.exe`
//! (Windows, where it does not add the folder to `PATH`); npm in its global folder, `%APPDATA%\npm` on Windows (`claude.cmd`) and
//! `<prefix>/bin` elsewhere; winget as a portable package linked from `%LOCALAPPDATA%\Microsoft\WinGet\Links`; Homebrew and the
//! Linux packages on the system `PATH`. The plugin looks in fewer places ([`plugin_dirs`]); when boopis finds a `claude` the plugin
//! would not, the engine is handed its path in the plugin's own override variable ([`engine_override`]), so both run the same
//! program. The Claude desktop app's built-in Claude Code is the app's own copy, in a folder per version that the app replaces,
//! with the app's own sign-in, and Anthropic says to install the command-line tool separately to use `claude` outside the app:
//! it does not count, and the card says so when it is the only Claude Code here ([`desktop_copy`]).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tokio::process::Command;

use crate::providers::{InstallHint, InstallKind};

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
/// Anthropic's installer on macOS and Linux (<https://code.claude.com/docs/en/setup>, "Native Install (Recommended)").
pub const INSTALL_COMMAND_UNIX: &str = "curl -fsSL https://claude.ai/install.sh | bash";
/// Anthropic's installer on Windows, in PowerShell (the same page). It needs no administrator and does not change `PATH`; boopis
/// finds it in `%USERPROFILE%\.local\bin` all the same.
pub const INSTALL_COMMAND_WINDOWS: &str = "irm https://claude.ai/install.ps1 | iex";
/// Anthropic's page about installing Claude Code.
pub const INSTALL_PAGE: &str = "https://code.claude.com/docs/en/setup";
/// Anthropic's page about updating it.
pub const UPDATE_PAGE: &str = "https://code.claude.com/docs/en/setup#update-claude-code";
/// How the official CLI signs in. "Sign in to Claude" runs it (the `claude-code` entry of the host's login table, with
/// `--claudeai`); it is Claude Code's own login, and boopis offers no login screen of its own.
pub const LOGIN_COMMAND: &str = "claude auth login";
/// How the official CLI updates itself.
pub const UPDATE_COMMAND: &str = "claude update";

/// Anthropic's installer for this computer's system.
#[must_use]
pub const fn install_command() -> &'static str {
    if cfg!(windows) {
        INSTALL_COMMAND_WINDOWS
    } else {
        INSTALL_COMMAND_UNIX
    }
}

/// How to install Claude Code on `os`: Anthropic's own installer, where to paste it and Anthropic's page.
#[must_use]
pub fn install_hint(os: Os) -> InstallHint {
    InstallHint {
        kind: InstallKind::Install,
        command: if os == Os::Windows {
            INSTALL_COMMAND_WINDOWS
        } else {
            INSTALL_COMMAND_UNIX
        }
        .to_owned(),
        shell: os.shell().to_owned(),
        page: INSTALL_PAGE.to_owned(),
    }
}

/// How to update Claude Code on `os`.
#[must_use]
pub fn update_hint(os: Os) -> InstallHint {
    InstallHint {
        kind: InstallKind::Update,
        command: UPDATE_COMMAND.to_owned(),
        shell: os.shell().to_owned(),
        page: UPDATE_PAGE.to_owned(),
    }
}

/// A Claude Code version, `major.minor.patch`.
pub type Version = (u32, u32, u32);

/// The alias that is frontier but bills usage credits on a Pro plan: on the subscription ladder only when the user opts in.
pub const FABLE: &str = "fable";

/// The model aliases the plugin offers for a ladder, cheapest first, each with the oldest Claude Code that serves it. From the
/// plugin's README ("Requirements", plugin 0.4.0, checked 2026-11-19): Haiku 5.5 needs 2.1.293, Sonnet 5.5 2.1.284 and Opus 5.5
/// 2.1.280, and Fable 5.2 2.1.321; an older CLI answers `400 Claude Code ... does not support this model`. Which of them a
/// ladder uses is the frontier list's call (ADR-0037: opus and fable). Fable is frontier, but on a Pro plan it bills usage credits
/// from the first request, so the subscription ladder setup writes is Opus alone and Fable is an opt-in (`FABLE`).
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
    /// No `claude` was found. Not a failure: the person installs it and checks again.
    NotInstalled,
    /// A `claude` was found, but it did not start when boopis ran it (Windows could not run the file, it hung, it was removed
    /// while boopis looked). A real failure: reinstalling fixes it.
    Failed,
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
    /// How to install it (not installed, or it did not start) or update it (too old), for this computer's system.
    pub install: Option<InstallHint>,
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

/* ───────── finding `claude`, the plugin's way and a little further ───────── */

/// The system a lookup is for. The lookup is pure over it, so every system's layout is tested on any of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    /// Windows: `\`, `;`, `PATHEXT`, variable names without case.
    Windows,
    /// macOS.
    Mac,
    /// Linux and the other Unix systems.
    Linux,
}

impl Os {
    /// The system this build runs on.
    pub const HERE: Self = if cfg!(windows) {
        Self::Windows
    } else if cfg!(target_os = "macos") {
        Self::Mac
    } else {
        Self::Linux
    };

    const fn sep(self) -> char {
        if matches!(self, Self::Windows) {
            '\\'
        } else {
            '/'
        }
    }

    const fn list_sep(self) -> char {
        if matches!(self, Self::Windows) {
            ';'
        } else {
            ':'
        }
    }

    /// Where a person pastes a command on this system, as they name it.
    #[must_use]
    pub const fn shell(self) -> &'static str {
        match self {
            Self::Windows => "PowerShell",
            Self::Mac => "Terminal",
            Self::Linux => "a terminal",
        }
    }

    /// `C:\x`, `\\server\share` (Windows) or `/x`: never a path that would resolve against the working directory.
    fn is_absolute(self, p: &str) -> bool {
        if self == Self::Windows {
            let b = p.as_bytes();
            (b.len() >= 3
                && b[0].is_ascii_alphabetic()
                && b[1] == b':'
                && (b[2] == b'\\' || b[2] == b'/'))
                || p.starts_with("\\\\")
        } else {
            p.starts_with('/')
        }
    }

    /// `dir` and a relative path in this system's spelling (`.local/bin` is `.local\bin` on Windows).
    fn join(self, dir: &str, rel: &str) -> String {
        let trim: &[char] = if self == Self::Windows {
            &['\\', '/']
        } else {
            &['/']
        };
        let head = dir.trim_end_matches(trim);
        let rel = if self == Self::Windows {
            rel.replace('/', "\\")
        } else {
            rel.to_owned()
        };
        format!("{head}{}{rel}", self.sep())
    }
}

/// A variable of `env` by name. On Windows a name has no case (the system's `PATH` is spelled `Path`), as Python's `os.environ`
/// reads it in the plugin; elsewhere it is exact.
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn var<'a>(env: &'a HashMap<String, String>, name: &str, os: Os) -> Option<&'a str> {
    if os == Os::Windows {
        env.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    } else {
        env.get(name).map(String::as_str)
    }
}

/// The folders of `PATH`, in order, absolute ones only: a relative entry would resolve against the working directory and could
/// run a program planted there. Windows entries may be quoted.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn path_dirs(env: &HashMap<String, String>, os: Os) -> Vec<String> {
    var(env, "PATH", os)
        .unwrap_or("")
        .split(os.list_sep())
        .map(|d| d.trim().trim_matches('"'))
        .filter(|d| os.is_absolute(d))
        .map(str::to_owned)
        .collect()
}

/// The extensions `PATHEXT` names, in its order, lower case (Python's default when it is not set).
fn pathext(env: &HashMap<String, String>) -> Vec<String> {
    var(env, "PATHEXT", Os::Windows)
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC")
        .split(';')
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| e.starts_with('.') && e.len() > 1)
        .collect()
}

/// The file names to try for `name` in a folder. Unix: the name. Windows, as the plugin's `shutil.which` does: with `PATHEXT`'s
/// extensions when the name has none of them, the bare name last; `runnable_only` keeps the extensions the host can start
/// (`.exe`, `.com`, and `.cmd`/`.bat` through `cmd.exe`), and never the bare name, which on Windows is npm's shell script.
fn names(env: &HashMap<String, String>, os: Os, name: &str, runnable_only: bool) -> Vec<String> {
    if os != Os::Windows {
        return vec![name.to_owned()];
    }
    let exts = pathext(env);
    let lower = name.to_ascii_lowercase();
    if exts.iter().any(|e| lower.ends_with(e.as_str())) {
        return vec![name.to_owned()];
    }
    let mut out: Vec<String> = exts
        .iter()
        .filter(|e| !runnable_only || matches!(e.as_str(), ".exe" | ".com" | ".cmd" | ".bat"))
        .map(|e| format!("{name}{e}"))
        .collect();
    if !runnable_only {
        out.push(name.to_owned());
    }
    out
}

/// The home folder the plugin reads (`USERPROFILE` on Windows, `HOME` elsewhere), when it is absolute.
fn home(env: &HashMap<String, String>, os: Os) -> Option<&str> {
    var(
        env,
        if os == Os::Windows {
            "USERPROFILE"
        } else {
            "HOME"
        },
        os,
    )
    .filter(|h| os.is_absolute(h))
}

/// Where the plugin looks for the bare `claude` after `PATH`: its `_install_prefixes`, the home's `.local/bin` (Anthropic's
/// native installer), `.claude/local` (an older local install), `bin`, `.npm-global/bin`, `.bun/bin`, `.volta/bin`, then
/// Homebrew's and `/usr/local/bin` off Windows. A relative home gives none.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn plugin_dirs(env: &HashMap<String, String>, os: Os) -> Vec<String> {
    let mut dirs: Vec<String> = home(env, os)
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
            .map(|p| os.join(h, p))
            .collect()
        })
        .unwrap_or_default();
    if os != Os::Windows {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(str::to_owned));
    }
    dirs
}

/// What the lookup needs of the file system, behind a trait so each system's layout is tested on any system.
pub trait Fs {
    /// A file the host could start (on Unix, with an execute bit).
    fn runnable(&self, path: &str) -> bool;
    /// The names of the folders inside `path` (none when it is not a folder).
    fn subdirs(&self, path: &str) -> Vec<String>;
    /// A small text file's content.
    fn read(&self, path: &str) -> Option<String>;
}

/// The real file system.
pub struct RealFs;

impl Fs for RealFs {
    fn runnable(&self, path: &str) -> bool {
        runnable(Path::new(path))
    }
    fn subdirs(&self, path: &str) -> Vec<String> {
        std::fs::read_dir(path)
            .map(|rd| {
                rd.filter_map(Result::ok)
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default()
    }
    fn read(&self, path: &str) -> Option<String> {
        let meta = std::fs::metadata(path).ok()?;
        (meta.is_file() && meta.len() <= 64 * 1024)
            .then(|| std::fs::read_to_string(path).ok())
            .flatten()
    }
}

/// npm's global folder from the user's own `.npmrc` (`prefix=...`, the setting `npm config set prefix` writes), where `npm
/// install -g` puts `claude`: the prefix itself on Windows, its `bin` elsewhere.
fn npmrc_bin(env: &HashMap<String, String>, os: Os, fs: &dyn Fs) -> Option<String> {
    let home = home(env, os)?;
    let text = fs.read(&os.join(home, ".npmrc"))?;
    let raw = text.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == "prefix").then(|| v.trim().trim_matches('"').to_owned())
    })?;
    // npm expands `~` and `${VAR}` in its config
    let mut prefix = raw;
    if let Some(rest) = prefix
        .strip_prefix("~/")
        .or_else(|| prefix.strip_prefix("~\\"))
    {
        prefix = os.join(home, rest);
    }
    while let Some(start) = prefix.find("${") {
        let end = prefix[start..].find('}')? + start;
        let value = var(env, &prefix[start + 2..end], os)?;
        prefix.replace_range(start..=end, value);
    }
    if !os.is_absolute(&prefix) {
        return None;
    }
    Some(if os == Os::Windows {
        prefix
    } else {
        os.join(&prefix, "bin")
    })
}

/// Where boopis also looks, after the plugin's places: where npm, winget and nvm put `claude` when their folder is not on the
/// `PATH` boopis was started with (a program started from the desktop does not read a shell's profile, and the native Windows
/// installer and npm both leave `PATH` to the person). Windows: npm's default global folder `%APPDATA%\npm`, winget's links
/// (`%LOCALAPPDATA%\Microsoft\WinGet\Links`, and the machine-wide one) and its package folder for Anthropic's package. Everywhere:
/// npm's prefix from `~/.npmrc`; on macOS and Linux the newest Node of nvm.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn extra_dirs(env: &HashMap<String, String>, os: Os, fs: &dyn Fs) -> Vec<String> {
    let mut dirs = Vec::new();
    let abs = |v: Option<&str>| v.filter(|p| os.is_absolute(p)).map(str::to_owned);
    if os == Os::Windows {
        if let Some(appdata) = abs(var(env, "APPDATA", os)) {
            dirs.push(os.join(&appdata, "npm"));
        }
        if let Some(local) = abs(var(env, "LOCALAPPDATA", os)) {
            dirs.push(os.join(&local, "Microsoft/WinGet/Links"));
            dirs.push(os.join(
                &local,
                "Microsoft/WinGet/Packages/Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe",
            ));
        }
        if let Some(drive) =
            var(env, "SYSTEMDRIVE", os).filter(|d| d.len() == 2 && d.ends_with(':'))
        {
            dirs.push(os.join(drive, "Program Files/WinGet/Links"));
        }
    }
    if let Some(npm) = npmrc_bin(env, os, fs) {
        dirs.push(npm);
    }
    if os != Os::Windows
        && let Some(h) = home(env, os)
    {
        let root = os.join(h, ".nvm/versions/node");
        let mut versions: Vec<(Version, String)> = fs
            .subdirs(&root)
            .into_iter()
            .filter_map(|n| parse_version(&n).map(|v| (v, n)))
            .collect();
        versions.sort();
        if let Some((_, newest)) = versions.last() {
            dirs.push(os.join(&os.join(&root, newest), "bin"));
        }
    }
    dirs
}

/// The desktop app's execution alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\claude.exe`, which an older Claude desktop app
/// registers): running it opens the app, not Claude Code (Anthropic's troubleshooting page). No installer of Claude Code puts
/// anything there, so boopis never takes a `claude` from it.
fn is_windows_apps(dir: &str) -> bool {
    dir.trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
        .replace('/', "\\")
        .ends_with("\\microsoft\\windowsapps")
}

/// Where a lookup found `claude`: boopis's answer, and the plugin's own (its `_resolve` over the same environment). They differ
/// only where boopis looks further (its extra places) or skips the desktop app's alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// The `claude` boopis uses.
    pub found: Option<String>,
    /// The `claude` the plugin would run with this environment and no help.
    pub plugin: Option<String>,
}

/// Find `claude` the way the plugin's `_resolve` does, and a little further. The command is `CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND`
/// when set, else `claude`. An absolute path is used as it is (on Windows also with `PATHEXT`'s extensions); a name is looked up
/// on `PATH`; only the bare name `claude` also tries the plugin's install folders and then boopis's own ([`extra_dirs`]), because
/// an override is the person's choice and never second-guessed. A relative path with a folder in it is refused.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn locate(env: &HashMap<String, String>, os: Os, fs: &dyn Fs) -> Located {
    let command = var(env, COMMAND_VAR, os)
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("claude");
    let first = |dirs: &[String], names: &[String], skip_alias: bool| -> Option<String> {
        dirs.iter()
            .filter(|d| !(skip_alias && is_windows_apps(d)))
            .flat_map(|d| names.iter().map(move |n| os.join(d, n)))
            .find(|p| fs.runnable(p))
    };
    if os.is_absolute(command) {
        let (dir, file) = command
            .rfind(|c| c == '/' || (os == Os::Windows && c == '\\'))
            .map_or(("", command), |i| (&command[..i], &command[i + 1..]));
        let hit = if fs.runnable(command) {
            Some(command.to_owned())
        } else {
            first(&[dir.to_owned()], &names(env, os, file, true), false)
        };
        return Located {
            found: hit.clone(),
            plugin: hit,
        };
    }
    if command.contains('/') || (os == Os::Windows && command.contains('\\')) {
        return Located {
            found: None,
            plugin: None,
        };
    }
    let on_path = path_dirs(env, os);
    let bare = command == "claude";
    let mut plugin_places = on_path.clone();
    let mut boopis_places = on_path;
    if bare {
        plugin_places.extend(plugin_dirs(env, os));
        boopis_places.extend(plugin_dirs(env, os));
        boopis_places.extend(extra_dirs(env, os, fs));
    }
    Located {
        found: first(&boopis_places, &names(env, os, command, true), true),
        plugin: first(&plugin_places, &names(env, os, command, false), false),
    }
}

/// `name` as a runnable file in `dirs` (on Windows with the extensions the shell runs).
pub(crate) fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
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

pub(crate) fn runnable(p: &Path) -> bool {
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

/// The `claude` boopis uses on this computer ([`locate`] over the real file system).
#[must_use]
#[allow(clippy::implicit_hasher)] // the host builds these maps itself
pub fn resolve(env: &HashMap<String, String>) -> Option<PathBuf> {
    locate(env, Os::HERE, &RealFs).found.map(PathBuf::from)
}

/// What the engine's environment needs so the plugin runs the `claude` boopis found: its own override variable, set to that path,
/// when the plugin would find none or another one by itself (a `claude` only in npm's or winget's folder, or behind the desktop
/// app's alias). Nothing when the person set the variable, or when the plugin already finds the same program.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn engine_override_in(
    env: &HashMap<String, String>,
    os: Os,
    fs: &dyn Fs,
) -> Option<(String, String)> {
    if var(env, COMMAND_VAR, os).is_some_and(|c| !c.trim().is_empty()) {
        return None;
    }
    let l = locate(env, os, fs);
    let found = l.found?;
    (l.plugin.as_deref() != Some(found.as_str())).then(|| (COMMAND_VAR.to_owned(), found))
}

/// [`engine_override_in`] on this computer.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn engine_override(env: &HashMap<String, String>) -> Option<(String, String)> {
    engine_override_in(env, Os::HERE, &RealFs)
}

/// Whether the Claude desktop app keeps its own Claude Code here: its data folder's `claude-code` folder with a version inside
/// (Anthropic's "data storage" page: "Claude Code binary ... for Code sessions"). `%APPDATA%\Claude` on Windows (and the Store
/// build's `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude`), `~/Library/Application Support/Claude` on
/// macOS, `~/.config/Claude` on Linux. That copy runs only inside the app: boopis says so, and asks for the command-line tool.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn desktop_copy(env: &HashMap<String, String>, os: Os, fs: &dyn Fs) -> bool {
    let abs = |v: Option<&str>| v.filter(|p| os.is_absolute(p)).map(str::to_owned);
    let mut roots: Vec<String> = Vec::new();
    match os {
        Os::Windows => {
            if let Some(a) = abs(var(env, "APPDATA", os)) {
                roots.push(os.join(&a, "Claude"));
            }
            if let Some(l) = abs(var(env, "LOCALAPPDATA", os)) {
                roots.push(os.join(
                    &l,
                    "Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude",
                ));
            }
        }
        Os::Mac => {
            if let Some(h) = home(env, os) {
                roots.push(os.join(h, "Library/Application Support/Claude"));
            }
        }
        Os::Linux => {
            if let Some(c) = abs(var(env, "XDG_CONFIG_HOME", os)) {
                roots.push(os.join(&c, "Claude"));
            } else if let Some(h) = home(env, os) {
                roots.push(os.join(h, ".config/Claude"));
            }
        }
    }
    roots
        .iter()
        .any(|r| !fs.subdirs(&os.join(r, "claude-code")).is_empty())
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

/// Why a `claude` that was found did not start, in a few plain words (the operating system's own message goes to the log).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoStart {
    /// The system refused to start the file (not a program it can run, blocked, gone).
    Refused,
    /// It started and did not answer within the limit.
    TimedOut,
}

/// Everything a look found, for [`assess_facts`].
#[derive(Debug, Clone, Default)]
pub struct Facts<'a> {
    /// The `claude` that was found, if any.
    pub found: Option<&'a str>,
    /// Why it did not start, when it did not.
    pub no_start: Option<NoStart>,
    /// Its `--version` text, when it ran.
    pub version_text: Option<&'a str>,
    /// Its `auth status` JSON, when that ran and parsed.
    pub auth: Option<&'a Value>,
    /// The Claude desktop app keeps its own copy here ([`desktop_copy`]).
    pub desktop_copy: bool,
    /// The system, for the install command.
    pub os: Option<Os>,
}

/// A probe from what the CLI said. `version` is its `--version` text when it ran, `auth` its `auth status` JSON when that parsed
/// (`None` when it did not run or printed something else). Pure, so every state is testable without a CLI.
#[must_use]
pub fn assess(installed: bool, version_text: Option<&str>, auth: Option<&Value>) -> Probe {
    assess_facts(&Facts {
        found: installed.then_some("claude"),
        version_text,
        auth,
        ..Facts::default()
    })
}

/// [`assess`] with everything a look can find: where it was, whether it started, and the desktop app's copy.
#[must_use]
pub fn assess_facts(f: &Facts<'_>) -> Probe {
    let os = f.os.unwrap_or(Os::HERE);
    let parsed = f.version_text.and_then(parse_version);
    let version = parsed.map(show);
    let no = |state, detail: String, install: Option<InstallHint>| Probe {
        state,
        version: version.clone(),
        plan: None,
        detail,
        aliases: parsed.map(aliases_for).unwrap_or_default(),
        install,
    };
    let Some(found) = f.found else {
        let detail = if f.desktop_copy {
            "The Claude desktop app is here, but its Claude Code works only inside the app. boopis needs the Claude Code command-line tool, which is separate: install it, then choose Check again."
        } else {
            "Claude Code, Anthropic's command-line tool, is not installed yet. boopis runs your Claude plan through it: install it, then choose Check again."
        };
        return no(
            State::NotInstalled,
            detail.to_owned(),
            Some(install_hint(os)),
        );
    };
    if let Some(why) = f.no_start {
        let how = match why {
            NoStart::Refused => "the system could not start it",
            NoStart::TimedOut => "it did not answer within 20 seconds",
        };
        return no(
            State::Failed,
            format!(
                "Claude Code is installed ({found}), but {how}. Install it again with Anthropic's installer, then choose Check again."
            ),
            Some(install_hint(os)),
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
            Some(update_hint(os)),
        );
    }
    let signed_in = f.auth.is_some_and(|a| a["loggedIn"] == true);
    if !signed_in {
        return no(
            State::SignedOut,
            format!(
                "{with_version} is installed but not signed in. Choose Sign in to Claude (boopis runs Claude Code's own `{LOGIN_COMMAND}`), then Check again."
            ),
            None,
        );
    }
    let auth = f.auth.unwrap_or(&Value::Null);
    if let Some(how) = metered_how(auth) {
        return no(
            State::Metered,
            format!(
                "{with_version} is signed in with {how}, which bills API usage instead of your Claude subscription. Choose Sign in to Claude to sign in with your Claude account (boopis runs Claude Code's own `{LOGIN_COMMAND}`), then Check again."
            ),
            None,
        );
    }
    if parsed.is_none() {
        return no(
            State::OldVersion,
            format!(
                "{with_version} is signed in, but its version could not be read, so boopis cannot tell which Claude models it serves. Update it with `{UPDATE_COMMAND}`, then choose Check again."
            ),
            Some(update_hint(os)),
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
        install: None,
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

    /// A look with the given environment (a test, or the CI probe of a real install).
    #[must_use]
    pub fn with_env(env: HashMap<String, String>) -> Self {
        Self {
            env,
            timeout: Duration::from_secs(20),
        }
    }

    /// The environment the look runs `claude` with.
    #[must_use]
    pub fn env(&self) -> &HashMap<String, String> {
        &self.env
    }
}

/// One command of a user's own CLI (Claude Code, `grok`): its output, or `None` when it did not run, failed to start or took too
/// long. Standard input is closed, the environment is exactly `env`, the working directory is the system's temporary one (never a
/// project, whose settings it would read). The exit code is not what decides (`auth status` exits 1 when signed out and still
/// prints its JSON); with `stderr` the CLI's standard error follows its standard output.
pub(crate) async fn ask_cli(
    env: &HashMap<String, String>,
    timeout: Duration,
    exe: &Path,
    args: &[&str],
    stderr: bool,
) -> Option<String> {
    run_cli(env, timeout, exe, args, stderr).await.ok()
}

/// [`ask_cli`], saying why a command did not run.
pub(crate) async fn run_cli(
    env: &HashMap<String, String>,
    timeout: Duration,
    exe: &Path,
    args: &[&str],
    stderr: bool,
) -> Result<String, NoStart> {
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .env_clear()
        .envs(env)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(if stderr {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: tokio's own method, as in `hermes::cli`
    let out = match tokio::time::timeout(timeout, cmd.output()).await {
        Err(_) => {
            tracing::warn!(program = %exe.display(), ?args, "a CLI did not answer in time");
            return Err(NoStart::TimedOut);
        }
        Ok(Err(e)) => {
            tracing::warn!(program = %exe.display(), ?args, error = %e, "a CLI could not be started");
            return Err(NoStart::Refused);
        }
        Ok(Ok(out)) => out,
    };
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    if stderr {
        text.push('\n');
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    Ok(text.chars().take(64 * 1024).collect())
}

#[async_trait]
impl ClaudeCli for SystemClaude {
    async fn probe(&self) -> Probe {
        let os = Os::HERE;
        let Some(exe) = locate(&self.env, os, &RealFs).found else {
            return assess_facts(&Facts {
                desktop_copy: desktop_copy(&self.env, os, &RealFs),
                os: Some(os),
                ..Facts::default()
            });
        };
        let shown = exe.clone();
        let exe = PathBuf::from(exe);
        let version = run_cli(&self.env, self.timeout, &exe, &["--version"], false).await;
        if let Err(why) = version {
            return assess_facts(&Facts {
                found: Some(&shown),
                no_start: Some(why),
                os: Some(os),
                ..Facts::default()
            });
        }
        let version = version.ok();
        let auth = ask_cli(&self.env, self.timeout, &exe, &["auth", "status"], false)
            .await
            .and_then(|t| serde_json::from_str::<Value>(t.trim()).ok());
        assess_facts(&Facts {
            found: Some(&shown),
            version_text: version.as_deref(),
            auth: auth.as_ref(),
            os: Some(os),
            ..Facts::default()
        })
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
            missing.detail.contains("not installed yet") && missing.detail.contains("Check again"),
            "{}",
            missing.detail
        );
        let hint = missing.install.as_ref().unwrap();
        assert_eq!(hint.kind, InstallKind::Install);
        assert_eq!(hint.command, install_command());
        assert_eq!(hint.page, INSTALL_PAGE);
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
        assert!(out.install.is_none(), "signing in is not installing");

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
        let update = old.install.as_ref().unwrap();
        assert_eq!(
            (update.kind, update.command.as_str()),
            (InstallKind::Update, "claude update")
        );
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

    /// A file system made of the paths a test names: files that run, folders, and small text files.
    #[derive(Default)]
    struct FakeFs {
        files: std::collections::HashSet<String>,
        dirs: HashMap<String, Vec<String>>,
        text: HashMap<String, String>,
    }

    impl FakeFs {
        fn with(files: &[&str]) -> Self {
            let mut fs = Self::default();
            for f in files {
                fs.files.insert((*f).to_owned());
            }
            fs
        }
        fn dir(mut self, path: &str, children: &[&str]) -> Self {
            self.dirs.insert(
                path.to_owned(),
                children.iter().map(|c| (*c).to_owned()).collect(),
            );
            self
        }
        fn file_text(mut self, path: &str, text: &str) -> Self {
            self.text.insert(path.to_owned(), text.to_owned());
            self
        }
    }

    impl Fs for FakeFs {
        fn runnable(&self, path: &str) -> bool {
            // Windows' file system has no case
            self.files.contains(path)
                || self
                    .files
                    .iter()
                    .any(|f| f.eq_ignore_ascii_case(path) && f.contains('\\'))
        }
        fn subdirs(&self, path: &str) -> Vec<String> {
            self.dirs.get(path).cloned().unwrap_or_default()
        }
        fn read(&self, path: &str) -> Option<String> {
            self.text.get(path).cloned()
        }
    }

    /// A Windows environment as the system spells it: `Path`, `PathExt`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemDrive`.
    fn windows_env(path: &str) -> HashMap<String, String> {
        env_of(&[
            ("Path", path),
            (
                "PATHEXT",
                ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
            ),
            ("USERPROFILE", r"C:\Users\ana"),
            ("APPDATA", r"C:\Users\ana\AppData\Roaming"),
            ("LOCALAPPDATA", r"C:\Users\ana\AppData\Local"),
            ("SystemDrive", "C:"),
        ])
    }
    const WIN_SYSTEM: &str = r"C:\Windows\system32;C:\Windows;C:\Program Files\Git\cmd";
    const NPM_WIN: &str = r"C:\Users\ana\AppData\Roaming\npm";
    const NATIVE_WIN: &str = r"C:\Users\ana\.local\bin\claude.exe";

    fn win(path: &str, fs: &FakeFs) -> Located {
        locate(&windows_env(path), Os::Windows, fs)
    }

    #[test]
    fn on_windows_the_path_named_path_is_read_whatever_its_case() {
        // the system spells it `Path`; the plugin's Python reads it without case, and so must boopis (the owner's npm install)
        let env = windows_env(&format!("{WIN_SYSTEM};{NPM_WIN}"));
        assert!(
            !env.contains_key("PATH"),
            "the map holds `Path`, not `PATH`"
        );
        assert_eq!(var(&env, "PATH", Os::Windows), Some(env["Path"].as_str()));
        assert_eq!(var(&env, "PATH", Os::Linux), None, "Unix names are exact");
        let npm = FakeFs::with(&[
            r"C:\Users\ana\AppData\Roaming\npm\claude",
            r"C:\Users\ana\AppData\Roaming\npm\claude.cmd",
            r"C:\Users\ana\AppData\Roaming\npm\claude.ps1",
        ]);
        let l = locate(&env, Os::Windows, &npm);
        let want = r"C:\Users\ana\AppData\Roaming\npm\claude.cmd".to_owned();
        assert_eq!(
            l.found.as_ref(),
            Some(&want),
            "npm's .cmd, never its shell script or .ps1"
        );
        assert_eq!(
            l.plugin.as_ref(),
            Some(&want),
            "the plugin's which() takes the same file"
        );
        assert_eq!(
            engine_override_in(&env, Os::Windows, &npm),
            None,
            "both agree: nothing to hand over"
        );
    }

    #[test]
    fn on_windows_the_native_installers_claude_is_found_off_path_by_both() {
        // Anthropic's installer puts claude.exe in %USERPROFILE%\.local\bin and leaves PATH alone
        let fs = FakeFs::with(&[NATIVE_WIN]);
        let l = win(WIN_SYSTEM, &fs);
        assert_eq!(l.found.as_deref(), Some(NATIVE_WIN));
        assert_eq!(
            l.plugin.as_deref(),
            Some(NATIVE_WIN),
            "the plugin's own prefixes reach it"
        );
        assert_eq!(
            engine_override_in(&windows_env(WIN_SYSTEM), Os::Windows, &fs),
            None
        );
    }

    #[test]
    fn on_windows_npms_folder_off_path_is_found_and_handed_to_the_engine() {
        // npm's default global folder is %APPDATA%\npm; a boopis started before Node's installer added it to PATH does not see it
        let fs = FakeFs::with(&[r"C:\Users\ana\AppData\Roaming\npm\claude.cmd"]);
        let l = win(WIN_SYSTEM, &fs);
        assert_eq!(
            l.found.as_deref(),
            Some(r"C:\Users\ana\AppData\Roaming\npm\claude.cmd")
        );
        assert_eq!(
            l.plugin, None,
            "the plugin's prefixes do not include npm's Windows folder"
        );
        assert_eq!(
            engine_override_in(&windows_env(WIN_SYSTEM), Os::Windows, &fs),
            Some((
                COMMAND_VAR.to_owned(),
                r"C:\Users\ana\AppData\Roaming\npm\claude.cmd".to_owned()
            ))
        );
    }

    #[test]
    fn on_windows_wingets_link_is_found_on_or_off_path() {
        let link = r"C:\Users\ana\AppData\Local\Microsoft\WinGet\Links\claude.exe";
        let fs = FakeFs::with(&[link]);
        let on = win(
            &format!(r"{WIN_SYSTEM};C:\Users\ana\AppData\Local\Microsoft\WinGet\Links"),
            &fs,
        );
        assert_eq!(
            (on.found.as_deref(), on.plugin.as_deref()),
            (Some(link), Some(link))
        );
        let off = win(WIN_SYSTEM, &fs);
        assert_eq!((off.found.as_deref(), off.plugin), (Some(link), None));
        // without links (no developer mode), WinGet's package folder itself, and the machine-wide links
        let pkg = r"C:\Users\ana\AppData\Local\Microsoft\WinGet\Packages\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\claude.exe";
        assert_eq!(
            win(WIN_SYSTEM, &FakeFs::with(&[pkg])).found.as_deref(),
            Some(pkg)
        );
        let machine = r"C:\Program Files\WinGet\Links\claude.exe";
        assert_eq!(
            win(WIN_SYSTEM, &FakeFs::with(&[machine])).found.as_deref(),
            Some(machine)
        );
    }

    #[test]
    fn on_windows_the_desktop_apps_alias_is_never_taken_for_claude_code() {
        // an older Claude desktop app registers WindowsApps\claude.exe, which opens the app; it comes first on a user's PATH
        let alias = r"C:\Users\ana\AppData\Local\Microsoft\WindowsApps\claude.exe";
        let fs = FakeFs::with(&[alias, r"C:\Users\ana\AppData\Roaming\npm\claude.cmd"]);
        let path =
            format!(r"C:\Users\ana\AppData\Local\Microsoft\WindowsApps;{WIN_SYSTEM};{NPM_WIN}");
        let l = win(&path, &fs);
        assert_eq!(
            l.found.as_deref(),
            Some(r"C:\Users\ana\AppData\Roaming\npm\claude.cmd")
        );
        assert_eq!(
            l.plugin.as_deref(),
            Some(alias),
            "the plugin alone would run the alias"
        );
        assert_eq!(
            engine_override_in(&windows_env(&path), Os::Windows, &fs).map(|(_, v)| v),
            Some(r"C:\Users\ana\AppData\Roaming\npm\claude.cmd".to_owned()),
            "so the engine is handed the real one"
        );
        // the alias alone is not Claude Code
        assert_eq!(win(&path, &FakeFs::with(&[alias])).found, None);
    }

    #[test]
    fn on_windows_pathext_orders_the_extensions_and_an_override_may_leave_out_exe() {
        let both = FakeFs::with(&[r"C:\tools\claude.exe", r"C:\tools\claude.cmd"]);
        assert_eq!(
            win(r"C:\tools", &both).found.as_deref(),
            Some(r"C:\tools\claude.exe")
        );
        // the override names the file without .exe: Windows (and the plugin's which) add it
        let mut env = windows_env(WIN_SYSTEM);
        env.insert(COMMAND_VAR.into(), r"C:\tools\claude".into());
        let l = locate(&env, Os::Windows, &both);
        assert_eq!(
            (l.found.as_deref(), l.plugin.as_deref()),
            (Some(r"C:\tools\claude.exe"), Some(r"C:\tools\claude.exe"))
        );
        assert_eq!(
            engine_override_in(&env, Os::Windows, &both),
            None,
            "the person's own variable is never replaced"
        );
        // a relative path with a folder would resolve against the working directory: refused
        env.insert(COMMAND_VAR.into(), r"tools\claude.exe".into());
        assert_eq!(locate(&env, Os::Windows, &both).found, None);
        // quoted PATH entries are read
        assert_eq!(
            win(r#""C:\tools""#, &both).found.as_deref(),
            Some(r"C:\tools\claude.exe")
        );
    }

    #[test]
    fn on_windows_the_desktop_apps_own_copy_does_not_count_and_is_named() {
        // the Code tab's Claude Code: %APPDATA%\Claude\claude-code\<version>\claude.exe, or the Store build's virtual folder
        let fs =
            FakeFs::with(&[r"C:\Users\ana\AppData\Roaming\Claude\claude-code\2.1.119\claude.exe"])
                .dir(
                    r"C:\Users\ana\AppData\Roaming\Claude\claude-code",
                    &["2.1.119"],
                );
        let env = windows_env(WIN_SYSTEM);
        assert_eq!(
            locate(&env, Os::Windows, &fs).found,
            None,
            "the app's copy is not the command-line tool"
        );
        assert!(desktop_copy(&env, Os::Windows, &fs));
        let store = FakeFs::default().dir(
            r"C:\Users\ana\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code",
            &["2.1.142"],
        );
        assert!(desktop_copy(&env, Os::Windows, &store));
        assert!(!desktop_copy(&env, Os::Windows, &FakeFs::default()));
        let p = assess_facts(&Facts {
            desktop_copy: true,
            os: Some(Os::Windows),
            ..Facts::default()
        });
        assert_eq!(p.state, State::NotInstalled);
        assert!(
            p.detail.contains("desktop app")
                && p.detail.contains("command-line tool, which is separate"),
            "{}",
            p.detail
        );
        assert_eq!(p.install.unwrap().command, INSTALL_COMMAND_WINDOWS);
    }

    #[test]
    fn the_installer_shown_is_anthropics_own_for_each_system() {
        let w = install_hint(Os::Windows);
        assert_eq!(
            (w.command.as_str(), w.shell.as_str()),
            ("irm https://claude.ai/install.ps1 | iex", "PowerShell")
        );
        let m = install_hint(Os::Mac);
        assert_eq!(
            (m.command.as_str(), m.shell.as_str()),
            ("curl -fsSL https://claude.ai/install.sh | bash", "Terminal")
        );
        let l = install_hint(Os::Linux);
        assert_eq!(
            (l.command.as_str(), l.shell.as_str()),
            (INSTALL_COMMAND_UNIX, "a terminal")
        );
        for h in [w, m, l] {
            assert_eq!(
                (h.kind, h.page.as_str()),
                (
                    InstallKind::Install,
                    "https://code.claude.com/docs/en/setup"
                )
            );
        }
        assert_eq!(update_hint(Os::Windows).command, "claude update");
    }

    #[test]
    fn on_macos_homebrew_the_native_installer_and_nvm_are_found() {
        let env = env_of(&[
            ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
            ("HOME", "/Users/ana"),
        ]);
        // a program started from the Dock gets a bare PATH: Homebrew's and the native installer's folders are the plugin's own
        for file in [
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
            "/Users/ana/.local/bin/claude",
        ] {
            let l = locate(&env, Os::Mac, &FakeFs::with(&[file]));
            assert_eq!(
                (l.found.as_deref(), l.plugin.as_deref()),
                (Some(file), Some(file)),
                "{file}"
            );
        }
        // npm under nvm: only boopis looks there, and hands the newest one to the engine
        let fs = FakeFs::with(&[
            "/Users/ana/.nvm/versions/node/v20.18.0/bin/claude",
            "/Users/ana/.nvm/versions/node/v22.11.0/bin/claude",
        ])
        .dir(
            "/Users/ana/.nvm/versions/node",
            &["v20.18.0", "v22.11.0", "system"],
        );
        let l = locate(&env, Os::Mac, &fs);
        assert_eq!(
            l.found.as_deref(),
            Some("/Users/ana/.nvm/versions/node/v22.11.0/bin/claude")
        );
        assert_eq!(l.plugin, None);
        assert!(engine_override_in(&env, Os::Mac, &fs).is_some());
        // the desktop app's copy
        let app = FakeFs::default().dir(
            "/Users/ana/Library/Application Support/Claude/claude-code",
            &["2.1.142"],
        );
        assert!(desktop_copy(&env, Os::Mac, &app));
    }

    #[test]
    fn on_linux_the_native_installer_npm_and_relative_entries() {
        let env = env_of(&[("PATH", ".:/usr/bin:bin"), ("HOME", "/home/ana")]);
        // relative PATH entries are never searched: a planted ./claude does not run
        assert_eq!(
            locate(&env, Os::Linux, &FakeFs::with(&["./claude", "bin/claude"])).found,
            None
        );
        let native = "/home/ana/.local/bin/claude";
        let l = locate(&env, Os::Linux, &FakeFs::with(&[native]));
        assert_eq!(
            (l.found.as_deref(), l.plugin.as_deref()),
            (Some(native), Some(native))
        );
        // npm with a prefix of the person's own (`npm config set prefix`), from ~/.npmrc, with npm's ${VAR} expansion
        let fs = FakeFs::with(&["/home/ana/.npm-packages/bin/claude"]).file_text(
            "/home/ana/.npmrc",
            "registry=https://registry.npmjs.org/\nprefix=${HOME}/.npm-packages\n",
        );
        let l = locate(&env, Os::Linux, &fs);
        assert_eq!(
            (l.found.as_deref(), l.plugin),
            (Some("/home/ana/.npm-packages/bin/claude"), None)
        );
        let tilde = FakeFs::with(&["/home/ana/.npm-packages/bin/claude"])
            .file_text("/home/ana/.npmrc", "prefix = ~/.npm-packages\n");
        assert_eq!(
            locate(&env, Os::Linux, &tilde).found.as_deref(),
            Some("/home/ana/.npm-packages/bin/claude")
        );
        // the desktop app's copy, under XDG_CONFIG_HOME when it is set
        let mut xdg = env.clone();
        xdg.insert("XDG_CONFIG_HOME".into(), "/home/ana/conf".into());
        let app = FakeFs::default().dir("/home/ana/conf/Claude/claude-code", &["2.1.142"]);
        assert!(desktop_copy(&xdg, Os::Linux, &app) && !desktop_copy(&env, Os::Linux, &app));
    }

    #[test]
    fn on_windows_npms_prefix_from_npmrc_is_the_folder_itself() {
        let fs = FakeFs::with(&[r"D:\npm-global\claude.cmd"])
            .file_text(r"C:\Users\ana\.npmrc", "prefix=D:\\npm-global\r\n");
        assert_eq!(
            win(WIN_SYSTEM, &fs).found.as_deref(),
            Some(r"D:\npm-global\claude.cmd")
        );
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
            !plugin_dirs(&relative, Os::Linux)
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
        let none = look.probe().await;
        assert_eq!(none.state, State::NotInstalled);
        assert!(none.install.is_some());

        // found, but the system cannot start it (its interpreter is gone): a real failure, in plain words, with the installer
        let broken = tmp.path().join("broken-claude");
        std::fs::write(&broken, "#!/nonexistent/interpreter\n").unwrap();
        std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).unwrap();
        look.env = env_of(&[
            ("PATH", "/nonexistent"),
            (COMMAND_VAR, &broken.display().to_string()),
        ]);
        let failed = look.probe().await;
        assert_eq!(failed.state, State::Failed);
        assert!(
            failed.detail.contains("could not start it")
                && failed.detail.contains("Install it again"),
            "{}",
            failed.detail
        );
        assert_eq!(
            failed.install.as_ref().map(|h| h.kind),
            Some(InstallKind::Install)
        );

        // found, and it hangs: also a failure, said as such
        let slow = tmp.path().join("slow-claude");
        std::fs::write(&slow, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&slow, std::fs::Permissions::from_mode(0o755)).unwrap();
        look.env = env_of(&[
            ("PATH", "/usr/bin:/bin"),
            (COMMAND_VAR, &slow.display().to_string()),
        ]);
        look.timeout = Duration::from_millis(300);
        let hung = look.probe().await;
        assert_eq!(hung.state, State::Failed);
        assert!(hung.detail.contains("did not answer"), "{}", hung.detail);
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
