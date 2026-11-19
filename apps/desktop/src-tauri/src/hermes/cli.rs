//! Running the `hermes` CLI: arguments as a vector, a built environment (never inherited wholesale), a timeout and
//! an output cap (`docs/STANDARDS.md` section 5, Processes).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::{Error, Result};

/// Environment variable names (or prefixes ending in `_`) that pass to a `hermes` child.
const PASS: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "TERM",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "WINDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "DBUS_SESSION_BUS_ADDRESS",
];
/// Prefixes that pass: Hermes's own settings, `uv`'s, the XDG directories and the locale.
const PASS_PREFIX: &[&str] = &["HERMES_", "UV_", "XDG_", "LC_"];

/// Whether a variable of the parent's environment may reach a child. API keys and tokens never do.
#[must_use]
pub fn passes(name: &str) -> bool {
    PASS.contains(&name) || PASS_PREFIX.iter().any(|p| name.starts_with(p))
}

/// Whether a variable of the parent's environment may reach a bundled (isolated) child: the allowlist without the
/// variables that choose a Hermes home, runtime or package manager.
#[must_use]
pub fn passes_isolated(name: &str) -> bool {
    passes(name) && !name.starts_with("HERMES_") && !name.starts_with("UV_")
}

/// What a finished `hermes` call produced. `stdout` and `stderr` are capped.
#[derive(Debug)]
pub struct Output {
    /// The exit code, `-1` when the process was killed by a signal.
    pub code: i32,
    /// Standard output as UTF-8 (lossy).
    pub stdout: String,
    /// Standard error as UTF-8 (lossy).
    pub stderr: String,
}

/// A runner of `hermes` commands.
#[derive(Debug, Clone)]
pub struct Cli {
    short: Duration,
    cap: usize,
    extra: Vec<(String, String)>,
    isolated: bool,
}

impl Cli {
    /// A runner with the short-call timeout of `limits` and a 1 MiB output cap per stream.
    #[must_use]
    pub fn new(limits: &crate::config::Limits) -> Self {
        Self {
            short: limits.cli_timeout,
            cap: 1024 * 1024,
            extra: Vec::new(),
            isolated: false,
        }
    }

    /// Run the bundled Hermes: no `HERMES_*` or `UV_*` variable of the user's reaches it, so another install's home,
    /// runtime directory or package settings cannot steer it (ADR-0023). What the caller adds with `with_env` still does.
    #[must_use]
    pub fn isolated(mut self) -> Self {
        self.isolated = true;
        self
    }

    /// Add variables every child gets on top of the allowlist (the integration tests point Hermes at a scratch install).
    #[must_use]
    pub fn with_env(mut self, extra: Vec<(String, String)>) -> Self {
        self.extra.extend(extra);
        self
    }

    /// The timeout for a short call.
    #[must_use]
    pub fn short_timeout(&self) -> Duration {
        self.short
    }

    /// Run `binary args...` with `HERMES_HOME` set to `home`.
    ///
    /// # Errors
    /// `Unavailable` when the process cannot start; `Timeout` when it outlives `timeout` (it is killed).
    pub async fn run(
        &self,
        binary: &Path,
        home: &Path,
        args: &[&str],
        timeout: Duration,
    ) -> Result<Output> {
        let mut cmd = Command::new(binary);
        cmd.args(args)
            .env_clear()
            .envs(std::env::vars_os().filter(|(k, _)| {
                k.to_str().is_some_and(|k| {
                    if self.isolated {
                        passes_isolated(k)
                    } else {
                        passes(k)
                    }
                })
            }))
            .envs(self.extra.iter().map(|(k, v)| (k, v)))
            .env("HERMES_HOME", home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| Error::Unavailable(format!("cannot run {}: {e}", binary.display())))?;
        let mut out = child
            .stdout
            .take()
            .ok_or_else(|| Error::Io("no stdout".into()))?;
        let mut err = child
            .stderr
            .take()
            .ok_or_else(|| Error::Io("no stderr".into()))?;
        let cap = u64::try_from(self.cap).unwrap_or(u64::MAX);
        let work = async {
            let (mut o, mut e) = (Vec::new(), Vec::new());
            let mut out = (&mut out).take(cap);
            let mut err = (&mut err).take(cap);
            let (ro, re) = tokio::join!(out.read_to_end(&mut o), err.read_to_end(&mut e));
            ro?;
            re?;
            let status = child.wait().await?;
            Ok::<_, std::io::Error>((status, o, e))
        };
        let (status, o, e) = tokio::time::timeout(timeout, work)
            .await
            .map_err(|_| Error::Timeout("hermes"))?
            .map_err(Error::from)?;
        Ok(Output {
            code: status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o).into_owned(),
            stderr: String::from_utf8_lossy(&e).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_is_an_allowlist() {
        for ok in [
            "PATH",
            "HOME",
            "HERMES_RUNTIME_DIR",
            "UV_CACHE_DIR",
            "XDG_RUNTIME_DIR",
            "LC_ALL",
            "HTTPS_PROXY",
        ] {
            assert!(passes(ok), "{ok}");
        }
        for no in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "SSH_AUTH_SOCK",
        ] {
            assert!(!passes(no), "{no}");
        }
    }

    #[test]
    fn the_isolated_environment_drops_the_users_hermes_settings() {
        for no in [
            "HERMES_HOME",
            "HERMES_RUNTIME_DIR",
            "HERMES_DATA_DIR_SUFFIX",
            "UV_CACHE_DIR",
            "UV_PYTHON",
        ] {
            assert!(!passes_isolated(no), "{no}");
        }
        for ok in [
            "PATH",
            "HOME",
            "HTTPS_PROXY",
            "XDG_RUNTIME_DIR",
            "SSL_CERT_FILE",
        ] {
            assert!(passes_isolated(ok), "{ok}");
        }
        assert!(!passes_isolated("OPENAI_API_KEY"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_with_a_clean_environment_and_a_timeout() {
        let cli = Cli::new(&crate::config::Limits::default());
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake-hermes");
        std::fs::write(
            &script,
            "#!/bin/sh\necho \"home=$HERMES_HOME key=${OPENAI_API_KEY:-none} arg=$1\"\n",
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = cli
            .run(&script, dir.path(), &["--version"], Duration::from_secs(10))
            .await
            .unwrap();
        assert_eq!(out.code, 0);
        assert!(out.stdout.contains("key=none"), "{}", out.stdout);
        assert!(out.stdout.contains("arg=--version"));
        let sleeper = dir.path().join("sleeper");
        std::fs::write(&sleeper, "#!/bin/sh\nsleep 30\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sleeper, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let err = cli
            .run(&sleeper, dir.path(), &[], Duration::from_millis(200))
            .await
            .unwrap_err();
        assert_eq!(err.code(), "hx.hermes.unavailable");
    }
}
