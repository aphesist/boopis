//! Finding Hermes: the binary, its version, its install stamp and its home (`docs/ARCHITECTURE.md` section 4).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{Error, Result};

/// What the host reads from the process environment. A value, so tests never touch the real one.
#[derive(Debug, Clone, Default)]
pub struct Environment {
    /// `$HERMES_HOME`, when set and not empty.
    pub hermes_home: Option<String>,
    /// `$HERMES_DATA_DIR_SUFFIX`: Hermes appends it to its default home name.
    pub data_dir_suffix: Option<String>,
    /// `%LOCALAPPDATA%` (Windows).
    pub local_app_data: Option<String>,
    /// The user's home directory.
    pub home_dir: Option<PathBuf>,
    /// `$PATH`.
    pub path: Option<std::ffi::OsString>,
    /// The runtime the app carries (ADR-0023). When set, it is the only Hermes: nothing is searched for, and the home is
    /// the app's own, so no `HERMES_HOME`, no `~/.hermes` and no other install on the machine is read.
    pub bundled: Option<Bundled>,
}

/// The Hermes the app carries and the private home it runs in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bundled {
    /// Hermes's launcher inside the unpacked runtime (it may not exist yet: first run unpacks it).
    pub binary: PathBuf,
    /// The private `HERMES_HOME`.
    pub home: PathBuf,
    /// Where Python writes its bytecode, so nothing lands in the user's own cache (`PYTHONPYCACHEPREFIX`).
    pub pycache: PathBuf,
}

impl Environment {
    /// Read the process environment.
    #[must_use]
    pub fn from_process() -> Self {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Self {
            hermes_home: get("HERMES_HOME"),
            data_dir_suffix: get("HERMES_DATA_DIR_SUFFIX"),
            local_app_data: get("LOCALAPPDATA"),
            home_dir: dirs::home_dir(),
            path: std::env::var_os("PATH"),
            bundled: None,
        }
    }

    /// The process environment with the bundled runtime in charge (`HERMES_HOME`, `HERMES_DATA_DIR_SUFFIX` and
    /// `~/.hermes` are ignored).
    #[must_use]
    pub fn with_bundled(mut self, bundled: Bundled) -> Self {
        self.bundled = Some(bundled);
        self
    }

    /// Hermes's root home: `$HERMES_HOME`, else `~/.hermes` (Windows: `%LOCALAPPDATA%\hermes`).
    #[must_use]
    pub fn hermes_root(&self) -> PathBuf {
        if let Some(b) = &self.bundled {
            return b.home.clone();
        }
        if let Some(h) = &self.hermes_home {
            return expand_tilde(h, self.home_dir.as_deref());
        }
        let suffix = self.data_dir_suffix.as_deref().unwrap_or("");
        if cfg!(windows) {
            let base = self.local_app_data.as_ref().map_or_else(
                || {
                    self.home_dir
                        .clone()
                        .unwrap_or_default()
                        .join("AppData")
                        .join("Local")
                },
                PathBuf::from,
            );
            return base.join(format!("hermes{suffix}"));
        }
        self.home_dir
            .clone()
            .unwrap_or_default()
            .join(format!(".hermes{suffix}"))
    }

    /// The home of a profile: the root for the default profile, `<root>/profiles/<name>` for a named one.
    ///
    /// # Errors
    /// `InvalidInput` when the name is not a plain profile name.
    pub fn profile_home(&self, profile: Option<&str>) -> Result<PathBuf> {
        match profile {
            None | Some("" | "default") => Ok(self.hermes_root()),
            Some(name) => {
                let ok = !name.is_empty()
                    && name.len() <= 64
                    && name.chars().all(|c| {
                        c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_'
                    });
                if !ok {
                    return Err(Error::InvalidInput(format!(
                        "profile name {name:?} is not [a-z0-9_-]{{1,64}}"
                    )));
                }
                Ok(self.hermes_root().join("profiles").join(name))
            }
        }
    }
}

fn expand_tilde(raw: &str, home: Option<&Path>) -> PathBuf {
    match (raw.strip_prefix("~/"), home) {
        (Some(rest), Some(h)) => h.join(rest),
        _ if raw == "~" => home.map(Path::to_path_buf).unwrap_or_default(),
        _ => PathBuf::from(raw),
    }
}

/// A parsed `major.minor.patch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u64, pub u64, pub u64);

impl Version {
    /// Parse the leading `x.y.z` of a version string (`0.23.2`, `0.23.2+3.gabc`, `v0.24.0-rc1`).
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim().trim_start_matches('v');
        let core = raw.split(['+', '-', ' ']).next()?;
        let mut parts = core.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next().map_or(Some(0), |p| p.parse().ok())?;
        let patch = parts.next().map_or(Some(0), |p| p.parse().ok())?;
        Some(Self(major, minor, patch))
    }
}

/// Check `version` against a `requires_hermes` string. Only `>=x.y.z` is used by the plugin.
///
/// # Errors
/// `InvalidInput` when the requirement is malformed; `HermesTooOld` when the version is older.
pub fn check_requirement(version: Version, required: &str) -> Result<()> {
    let min = required
        .trim()
        .strip_prefix(">=")
        .and_then(Version::parse)
        .ok_or_else(|| {
            Error::InvalidInput(format!("requires_hermes {required:?} is not `>=x.y.z`"))
        })?;
    if version < min {
        return Err(Error::HermesTooOld {
            found: format!("{}.{}.{}", version.0, version.1, version.2),
            required: required.to_owned(),
        });
    }
    Ok(())
}

/// The version out of `hermes --version` (`Hermes Agent v0.23.2 (2026.9.24)`). `None` for `vunknown`.
#[must_use]
pub fn parse_version_output(out: &str) -> Option<String> {
    let first = out.lines().next()?;
    first
        .split_whitespace()
        .find_map(|tok| {
            tok.strip_prefix('v')
                .filter(|rest| rest.starts_with(|c: char| c.is_ascii_digit()))
        })
        .map(str::to_owned)
}

/// The facts of `install-stamp.json` the host uses. Unknown fields are ignored.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct InstallStamp {
    /// The release the install is based on (`baseVersion` in a sealed payload's stamp).
    #[serde(alias = "baseVersion")]
    pub base_version: Option<String>,
    /// The commit.
    pub commit: Option<String>,
    /// How the install was packaged (`docker`, `nix`, `desktop-app`).
    pub distribution: Option<String>,
}

/// What discovery found.
#[derive(Debug, Clone)]
pub struct HermesInfo {
    /// The `hermes` binary.
    pub binary: PathBuf,
    /// The version, when Hermes names one (`None` for a source checkout with no stamp).
    pub version: Option<String>,
    /// The install stamp, when there is one.
    pub stamp: Option<InstallStamp>,
    /// Hermes's root home.
    pub home: PathBuf,
}

/// Find the `hermes` binary: `$PATH`, then the installer's usual places.
#[must_use]
pub fn find_binary(env: &Environment) -> Option<PathBuf> {
    if let Some(b) = &env.bundled {
        return is_executable(&b.binary).then(|| b.binary.clone());
    }
    let exe = if cfg!(windows) {
        ["hermes.exe", "hermes.cmd"].as_slice()
    } else {
        ["hermes"].as_slice()
    };
    let mut dirs: Vec<PathBuf> = env
        .path
        .as_ref()
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    if let Some(h) = &env.home_dir {
        dirs.push(h.join(".local").join("bin"));
    }
    let root = env.hermes_root();
    dirs.push(root.join("hermes-agent").join("venv").join("bin"));
    dirs.push(root.join("bin"));
    dirs.iter()
        .flat_map(|d| exe.iter().map(move |e| d.join(e)))
        .find(|p| is_executable(p))
}

fn is_executable(p: &Path) -> bool {
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

/// Read `install-stamp.json` near the binary or in the home. Missing or malformed means no stamp.
#[must_use]
pub fn read_stamp(binary: &Path, home: &Path) -> Option<InstallStamp> {
    let real = std::fs::canonicalize(binary).unwrap_or_else(|_| binary.to_path_buf());
    let bin_dir = real.parent()?;
    let candidates = [
        bin_dir.join("../../workspace/install-stamp.json"),
        bin_dir.join("../install-stamp.json"),
        bin_dir.join("../hermes-agent/install-stamp.json"), // the bundled runtime (a sealed payload)
        bin_dir.join("install-stamp.json"),
        home.join("install-stamp.json"),
    ];
    candidates
        .iter()
        .find_map(|p| serde_json::from_slice(&std::fs::read(p).ok()?).ok())
}

/// Discover Hermes: the binary, its version and its stamp.
///
/// # Errors
/// `HermesMissing` when no `hermes` binary is found; `Unavailable` when it cannot be run.
pub async fn discover(env: &Environment, cli: &super::cli::Cli) -> Result<HermesInfo> {
    let binary = find_binary(env).ok_or(Error::HermesMissing)?;
    let home = env.hermes_root();
    let out = cli
        .run(&binary, &home, &["--version"], cli.short_timeout())
        .await?;
    let stamp = read_stamp(&binary, &home);
    let version = parse_version_output(&out.stdout).or_else(|| {
        stamp
            .as_ref()
            .and_then(|s| s.base_version.clone())
            .filter(|v| Version::parse(v).is_some())
    });
    Ok(HermesInfo {
        binary,
        version,
        stamp,
        home,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(home: &str) -> Environment {
        Environment {
            home_dir: Some(PathBuf::from(home)),
            ..Environment::default()
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_bundled_runtime_ignores_every_other_hermes() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        // a user with a Hermes on PATH, in ~/.local/bin, in ~/.hermes, and HERMES_HOME exported
        let theirs = dir.path().join("bin");
        std::fs::create_dir_all(&theirs).unwrap();
        std::fs::write(theirs.join("hermes"), "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(
            theirs.join("hermes"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        let ours = dir.path().join("app/runtime/hermes");
        let env = Environment {
            hermes_home: Some("/home/u/their-home".into()),
            data_dir_suffix: Some("-dev".into()),
            home_dir: Some(dir.path().to_path_buf()),
            path: Some(theirs.into_os_string()),
            ..Environment::default()
        }
        .with_bundled(Bundled {
            binary: ours.clone(),
            home: dir.path().join("app/hermes-home"),
            pycache: dir.path().join("app/pycache"),
        });
        assert_eq!(env.hermes_root(), dir.path().join("app/hermes-home"));
        assert_eq!(
            env.profile_home(None).unwrap(),
            dir.path().join("app/hermes-home")
        );
        assert_eq!(
            env.profile_home(Some("nina")).unwrap(),
            dir.path().join("app/hermes-home/profiles/nina")
        );
        assert!(
            find_binary(&env).is_none(),
            "their hermes is never used, and ours is not unpacked yet"
        );
        std::fs::create_dir_all(ours.parent().unwrap()).unwrap();
        std::fs::write(&ours, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&ours, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_binary(&env), Some(ours));
    }

    #[test]
    fn a_sealed_payloads_stamp_is_read_beside_its_launcher() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("bin")).unwrap();
        std::fs::create_dir_all(dir.path().join("hermes-agent")).unwrap();
        std::fs::write(dir.path().join("bin/hermes"), "#!/bin/sh\n").unwrap();
        std::fs::write(
            dir.path().join("hermes-agent/install-stamp.json"),
            r#"{"schemaVersion":2,"commit":"ae2a81c","distribution":"desktop-app","baseVersion":"0.23.2"}"#,
        )
        .unwrap();
        let stamp = read_stamp(&dir.path().join("bin/hermes"), dir.path()).unwrap();
        assert_eq!(stamp.base_version.as_deref(), Some("0.23.2"));
        assert_eq!(stamp.commit.as_deref(), Some("ae2a81c"));
    }

    #[test]
    fn default_home_is_dot_hermes() {
        if !cfg!(windows) {
            assert_eq!(
                env("/home/u").hermes_root(),
                PathBuf::from("/home/u/.hermes")
            );
        }
    }

    #[test]
    fn hermes_home_wins_and_expands_tilde() {
        let e = Environment {
            hermes_home: Some("~/alt".into()),
            ..env("/home/u")
        };
        assert_eq!(e.hermes_root(), PathBuf::from("/home/u/alt"));
        let e = Environment {
            hermes_home: Some("/srv/h".into()),
            ..env("/home/u")
        };
        assert_eq!(e.hermes_root(), PathBuf::from("/srv/h"));
    }

    #[test]
    fn suffix_is_appended() {
        let e = Environment {
            data_dir_suffix: Some("-dev".into()),
            ..env("/home/u")
        };
        if !cfg!(windows) {
            assert_eq!(e.hermes_root(), PathBuf::from("/home/u/.hermes-dev"));
        }
    }

    #[test]
    fn windows_default_uses_local_app_data() {
        // The Windows branch is selected by `cfg!`, so on other systems this only checks the root is still sane.
        let e = Environment {
            local_app_data: Some("C:/L".into()),
            ..env("/home/u")
        };
        assert!(
            e.hermes_root()
                .ends_with(if cfg!(windows) { "hermes" } else { ".hermes" })
        );
    }

    #[test]
    fn profile_homes() {
        let e = Environment {
            hermes_home: Some("/h".into()),
            ..Environment::default()
        };
        assert_eq!(e.profile_home(None).unwrap(), PathBuf::from("/h"));
        assert_eq!(
            e.profile_home(Some("default")).unwrap(),
            PathBuf::from("/h")
        );
        assert_eq!(
            e.profile_home(Some("nina")).unwrap(),
            PathBuf::from("/h/profiles/nina")
        );
        for bad in ["../x", "a/b", "A", "x y", &"a".repeat(65)] {
            assert!(e.profile_home(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn versions_parse_and_compare() {
        assert_eq!(Version::parse("0.23.2"), Some(Version(0, 23, 2)));
        assert_eq!(Version::parse("v0.24.0-rc1"), Some(Version(0, 24, 0)));
        assert_eq!(Version::parse("0.23.2+3.gabc"), Some(Version(0, 23, 2)));
        assert_eq!(Version::parse("1.2"), Some(Version(1, 2, 0)));
        assert_eq!(Version::parse("unknown"), None);
        assert!(Version(0, 23, 10) > Version(0, 23, 2));
    }

    #[test]
    fn version_output_forms() {
        assert_eq!(
            parse_version_output("Hermes Agent v0.23.2 (2026.9.24)\nInstall directory: x")
                .as_deref(),
            Some("0.23.2")
        );
        assert_eq!(
            parse_version_output("Hermes Agent vunknown (2026.9.24)\n"),
            None
        );
        assert_eq!(parse_version_output(""), None);
    }

    #[test]
    fn requirement_refuses_older() {
        assert!(check_requirement(Version(0, 23, 2), ">=0.23.2").is_ok());
        assert!(check_requirement(Version(1, 0, 0), ">=0.23.2").is_ok());
        let err = check_requirement(Version(0, 22, 9), ">=0.23.2").unwrap_err();
        assert_eq!(err.code(), "hx.engine.incompatible");
        assert!(check_requirement(Version(1, 0, 0), "~0.23").is_err());
    }

    #[test]
    fn stamp_is_found_next_to_the_install_and_ignores_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let bin_dir = dir.path().join("env").join("venv").join("bin");
        let ws = dir.path().join("env").join("workspace");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(bin_dir.join("hermes"), "#!/bin/sh\n").unwrap();
        std::fs::write(
            ws.join("install-stamp.json"),
            r#"{"base_version":"0.23.2","commit":"abc","x":1}"#,
        )
        .unwrap();
        let stamp = read_stamp(&bin_dir.join("hermes"), dir.path()).unwrap();
        assert_eq!(stamp.base_version.as_deref(), Some("0.23.2"));
        assert_eq!(stamp.commit.as_deref(), Some("abc"));
        assert!(read_stamp(&dir.path().join("nope/hermes"), dir.path()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn binary_is_found_on_path_and_must_be_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("hermes");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        let e = Environment {
            path: Some(dir.path().as_os_str().to_owned()),
            hermes_home: Some("/nonexistent".into()),
            ..Environment::default()
        };
        assert!(find_binary(&e).is_none(), "not executable yet");
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_binary(&e), Some(bin));
    }
}
