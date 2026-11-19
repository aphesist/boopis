//! Running the `hermes` CLI: arguments as a vector, a built environment (never inherited wholesale), a timeout and
//! an output cap (`docs/STANDARDS.md` section 5, Processes).

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::secrets::PeerPolicy;

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
    // Windows: without SystemRoot, Python cannot start Winsock (WinError 10106) and the child has no network at all
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "COMSPEC",
    "PATHEXT",
    "WINDIR",
    "PROGRAMDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERNAME",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
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
    // which `claude` and which login directory the Claude subscription plugin uses (paths, never a credential); setup
    // looks at the same ones (`claude::PASS_VARS`, ADR-0029)
    "CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND",
    "CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR",
    "CLAUDE_CONFIG_DIR",
];
/// Prefixes that pass: Hermes's own settings, `uv`'s, the XDG directories and the locale.
const PASS_PREFIX: &[&str] = &["HERMES_", "UV_", "XDG_", "LC_"];

/// Whether a variable of the parent's environment may reach a child. API keys and tokens never do.
#[must_use]
pub fn passes(name: &str) -> bool {
    passes_on(name, cfg!(windows))
}

/// Whether a variable of the parent's environment may reach a bundled (isolated) child: the allowlist without the
/// variables that choose a Hermes home, runtime or package manager.
#[must_use]
pub fn passes_isolated(name: &str) -> bool {
    passes_isolated_on(name, cfg!(windows))
}

/// [`passes`] for a platform. Windows keeps a variable's name in whatever case it was made (`Path`, `SystemRoot`,
/// `windir`, `ComSpec`) and treats names without case, so there the list matches without case; Unix names are exact.
fn passes_on(name: &str, windows: bool) -> bool {
    PASS.iter().any(|p| same_name(name, p, windows))
        || PASS_PREFIX.iter().any(|p| has_prefix(name, p, windows))
}

fn passes_isolated_on(name: &str, windows: bool) -> bool {
    passes_on(name, windows)
        && !has_prefix(name, "HERMES_", windows)
        && !has_prefix(name, "UV_", windows)
}

fn same_name(name: &str, want: &str, windows: bool) -> bool {
    if windows {
        name.eq_ignore_ascii_case(want)
    } else {
        name == want
    }
}

fn has_prefix(name: &str, prefix: &str, windows: bool) -> bool {
    if windows {
        name.get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    } else {
        name.starts_with(prefix)
    }
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

/// What a call that starts a gateway adds: the secret channel's socket and token, for that call's environment only, and
/// the policy that learns the process so the daemon it starts may read its secrets (`secrets::peer`).
#[derive(Debug, Clone)]
struct SecretChannel {
    env: Vec<(String, String)>,
    peers: Arc<PeerPolicy>,
}

/// A runner of `hermes` commands.
#[derive(Debug, Clone)]
pub struct Cli {
    short: Duration,
    cap: usize,
    extra: Vec<(String, String)>,
    isolated: bool,
    secret_channel: Option<SecretChannel>,
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
            secret_channel: None,
        }
    }

    /// Hand the secret channel to the gateways this runner starts, and to nothing else: `env` (the socket and the token)
    /// goes only to [`Cli::run_launching`], never to `--version`, `config set`, `gateway stop` or any other call, and
    /// `peers` learns each launch so the daemon it starts may read its secrets.
    #[must_use]
    pub fn with_secret_channel(
        mut self,
        env: Vec<(String, String)>,
        peers: Arc<PeerPolicy>,
    ) -> Self {
        self.secret_channel = Some(SecretChannel { env, peers });
        self
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
        self.run_with(binary, home, args, timeout, None).await
    }

    /// [`Cli::run`] for a call that may start the gateway (`gateway ensure`, `gateway attach --start`): the secret channel's
    /// socket and token are in this one process's environment, from which the daemon it starts inherits them (Hermes
    /// builds the daemon's environment from its own), and the process is noted while it runs so the daemon is admitted
    /// as it reads its secrets at start-up. With no channel configured it is exactly [`Cli::run`].
    ///
    /// # Errors
    /// As [`Cli::run`].
    pub async fn run_launching(
        &self,
        binary: &Path,
        home: &Path,
        args: &[&str],
        timeout: Duration,
    ) -> Result<Output> {
        self.run_with(binary, home, args, timeout, self.secret_channel.as_ref())
            .await
    }

    async fn run_with(
        &self,
        binary: &Path,
        home: &Path,
        args: &[&str],
        timeout: Duration,
        channel: Option<&SecretChannel>,
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
            .envs(
                channel
                    .iter()
                    .flat_map(|c| c.env.iter().map(|(k, v)| (k, v))),
            )
            .env("HERMES_HOME", home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = cmd
            .spawn()
            .map_err(|e| Error::Unavailable(format!("cannot run {}: {e}", binary.display())))?;
        // Held until this function returns, whichever way: the daemon this call starts reads its secrets before that.
        let _launch = channel
            .zip(child.id())
            .map(|(c, pid)| c.peers.begin_launch(pid));
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
    #[test]
    fn on_windows_the_list_matches_names_in_any_case_and_on_unix_exactly() {
        // the names a real Windows environment carries, in the case Windows keeps them
        for name in [
            "Path",
            "SystemRoot",
            "windir",
            "ComSpec",
            "SystemDrive",
            "TEMP",
            "LOCALAPPDATA",
            "PathExt",
        ] {
            assert!(super::passes_on(name, true), "{name} on Windows");
        }
        assert!(super::passes_on("hermes_home", true));
        assert!(
            !super::passes_isolated_on("Hermes_Home", true),
            "a Hermes home never reaches a bundled child"
        );
        assert!(!super::passes_isolated_on("uv_cache_dir", true));
        for secret in ["OpenAI_Api_Key", "anthropic_api_key", "GitHub_Token"] {
            assert!(!super::passes_on(secret, true), "{secret}");
        }
        // Unix names are exact: `Path` is not `PATH` there
        assert!(super::passes_on("PATH", false));
        assert!(!super::passes_on("Path", false));
        assert!(!super::passes_on("SystemRoot", false));
    }

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
            "CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND",
            "CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR",
            "CLAUDE_CONFIG_DIR",
        ] {
            assert!(passes(ok), "{ok}");
        }
        for no in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "SSH_AUTH_SOCK",
        ] {
            assert!(!passes(no), "{no}");
        }
    }

    /// A `hermes` that records its environment, starts a "daemon" (a background process), and
    /// answers after a second.
    #[cfg(unix)]
    fn fake_hermes(dir: &Path) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("hermes");
        std::fs::write(
            &path,
            "#!/bin/sh\nenv > \"$HERMES_HOME/env.txt\"\nsh -c 'sleep 4; true' >/dev/null 2>&1 &\necho $! > \"$HERMES_HOME/daemon.pid\"\nsleep 1\necho '{}'\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    fn channel_env() -> Vec<(String, String)> {
        vec![
            (
                "BOOPIS_HOST_SECRETS_SOCKET".to_owned(),
                "/run/x/host.sock".to_owned(),
            ),
            (
                "BOOPIS_HOST_SECRETS_TOKEN".to_owned(),
                "tok-launch-only".to_owned(),
            ),
        ]
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_channel_token_reaches_only_the_calls_that_start_a_gateway() {
        let dir = tempfile::tempdir().unwrap();
        let hermes = fake_hermes(dir.path());
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let limits = crate::config::Limits::default();
        let cli = Cli::new(&limits).with_secret_channel(channel_env(), Arc::new(PeerPolicy::new()));
        let wait = Duration::from_secs(10);

        cli.run(&hermes, &home, &["--version"], wait).await.unwrap();
        let plain = std::fs::read_to_string(home.join("env.txt")).unwrap();
        assert!(
            !plain.contains("BOOPIS_HOST_SECRETS"),
            "an ordinary call gets neither: {plain}"
        );

        cli.run_launching(&hermes, &home, &["gateway", "ensure"], wait)
            .await
            .unwrap();
        let launching = std::fs::read_to_string(home.join("env.txt")).unwrap();
        assert!(
            launching.contains("BOOPIS_HOST_SECRETS_TOKEN=tok-launch-only"),
            "{launching}"
        );
        assert!(launching.contains("BOOPIS_HOST_SECRETS_SOCKET=/run/x/host.sock"));
        assert!(
            !launching.contains("OPENAI_API_KEY"),
            "the allowlist still holds"
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn the_daemon_a_launch_starts_is_admitted_while_it_runs_and_refused_after() {
        use crate::secrets::peer::Refusal;
        let dir = tempfile::tempdir().unwrap();
        let hermes = fake_hermes(dir.path());
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        // Only a process started with the token the launch hands out may be admitted: the fake daemon inherits it from the
        // fake `hermes`, as the real one does from `hermes gateway ensure`.
        let peers = Arc::new(
            PeerPolicy::new().holding("BOOPIS_HOST_SECRETS_TOKEN=tok-launch-only".to_owned()),
        );
        let cli = Cli::new(&crate::config::Limits::default())
            .with_secret_channel(channel_env(), peers.clone());

        let (hermes_path, home_path) = (hermes.clone(), home.clone());
        let launch = tokio::spawn(async move {
            cli.run_launching(
                &hermes_path,
                &home_path,
                &["gateway", "ensure"],
                Duration::from_secs(10),
            )
            .await
        });
        let pid_file = home.join("daemon.pid");
        let daemon = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_file)
                .ok()
                .and_then(|t| t.trim().parse::<u32>().ok())
            {
                break pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        // The daemon is below the process the host spawned and holds the token: it may read its secrets as it starts.
        // (Between `fork` and `exec` the daemon still shows its parent's environment, which is the same: no wait is needed
        // for that, but its parent chain and start time are read from a process that may not have settled.)
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while peers.admit(Some(daemon)).is_err() && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(peers.admit(Some(daemon)), Ok(()));
        // This test process is neither: refused.
        assert_eq!(
            peers.admit(Some(std::process::id())),
            Err(Refusal::NotTheGateway)
        );
        launch.await.unwrap().unwrap();
        // The call has returned, the window is closed, and nothing recorded the daemon.
        assert_eq!(peers.admit(Some(daemon)), Err(Refusal::NotTheGateway));
        let _ = std::process::Command::new("kill")
            .arg(daemon.to_string())
            .status();
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
        assert_eq!(err.code(), "hx.engine.unavailable");
    }
}
