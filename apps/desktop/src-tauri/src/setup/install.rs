//! Putting the bundled plugin and `hx` where Hermes and the plugin find them (`docs/ARCHITECTURE.md` section 4).
//!
//! The plugin is a *copy* in `<home>/plugins/hypotaxis/` (the app image is read-only and its path changes on every
//! launch), versioned by its `plugin.yaml`. An upgrade replaces the directory in place: the user's settings live in
//! `config.yaml`, not here, so nothing of theirs is touched. `hx` goes to `<home>/hypotaxis/bin/hx`, a path that stays.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// What the app carries.
#[derive(Debug, Clone, Default)]
pub struct Bundle {
    /// The plugin directory (`plugin.yaml`, `__init__.py`, ...).
    pub plugin_dir: Option<PathBuf>,
    /// The `hx` binary.
    pub hx: Option<PathBuf>,
}

impl Bundle {
    /// Find the bundle: the app's resource directory and the directory of the running executable (where Tauri puts
    /// sidecars). A native package keeps `hx` in the resource directory instead (`/usr/bin/hx` is Helix's name on
    /// Arch). A debug build falls back to the repository's own plugin.
    #[must_use]
    pub fn locate(resource_dir: Option<&Path>, exe_dir: Option<&Path>) -> Self {
        let mut plugin_dir = resource_dir
            .map(|r| r.join("plugin").join("hypotaxis"))
            .filter(|p| p.join("plugin.yaml").is_file());
        if plugin_dir.is_none() && cfg!(debug_assertions) {
            let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../plugins/hypotaxis");
            plugin_dir = dev.join("plugin.yaml").is_file().then_some(dev);
        }
        let name = if cfg!(windows) { "hx.exe" } else { "hx" };
        let hx = exe_dir
            .into_iter()
            .chain(resource_dir)
            .map(|d| d.join(name))
            .find(|p| p.is_file());
        Self { plugin_dir, hx }
    }
}

/// The `version:` of a `plugin.yaml` (a top-level scalar line; no YAML parser is needed for one key).
#[must_use]
pub fn plugin_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("plugin.yaml")).ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix("version:"))
        .map(|v| v.trim().trim_matches('"').to_owned())
        .filter(|v| !v.is_empty())
}

const SKIP_DIRS: &[&str] = &[
    "__pycache__",
    "tests",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
];

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if !SKIP_DIRS.contains(&name_s.as_ref()) {
                copy_tree(&entry.path(), &to.join(&name))?;
            }
        } else if kind.is_file() && !name_s.ends_with(".pyc") {
            std::fs::copy(entry.path(), to.join(&name))?;
        }
    }
    Ok(())
}

/// What `install_plugin` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Installed {
    /// The same version was already there.
    Current(String),
    /// Copied: a first install (`from: None`) or an upgrade.
    Written {
        /// The version that was there.
        from: Option<String>,
        /// The version now.
        to: String,
    },
}

/// Copy the bundled plugin into `<home>/plugins/hypotaxis/` unless the same version is already there.
///
/// # Errors
/// `Config` (`hx.setup.plugin_install_failed`) when the copy fails; the old directory is then put back.
pub fn install_plugin(bundle_dir: &Path, home: &Path) -> Result<Installed> {
    let to = plugin_version(bundle_dir)
        .ok_or_else(|| Error::Config("the bundled plugin has no version".into()))?;
    let target = super::ops::plugins_dir(home).join("hypotaxis");
    let from = plugin_version(&target);
    if from.as_deref() == Some(to.as_str()) && target.join("__init__.py").is_file() {
        return Ok(Installed::Current(to));
    }
    let parent = target
        .parent()
        .ok_or_else(|| Error::Io("no plugins dir".into()))?;
    std::fs::create_dir_all(parent)?;
    let fresh = parent.join(".hypotaxis.new");
    let old = parent.join(".hypotaxis.old");
    let _ = std::fs::remove_dir_all(&fresh);
    let _ = std::fs::remove_dir_all(&old);
    copy_tree(bundle_dir, &fresh).map_err(|e| {
        let _ = std::fs::remove_dir_all(&fresh);
        Error::Config(format!("copying the plugin failed: {e}"))
    })?;
    if target.exists() {
        std::fs::rename(&target, &old)?;
    }
    if let Err(e) = std::fs::rename(&fresh, &target) {
        let _ = std::fs::rename(&old, &target); // put the old one back
        return Err(Error::Config(format!("installing the plugin failed: {e}")));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(Installed::Written { from, to })
}

fn digest(p: &Path) -> Option<String> {
    Some(hex::encode(Sha256::digest(std::fs::read(p).ok()?)))
}

/// Where the plugin finds `hx` (`hx_path`).
#[must_use]
pub fn hx_target(home: &Path) -> PathBuf {
    home.join("hypotaxis")
        .join("bin")
        .join(if cfg!(windows) { "hx.exe" } else { "hx" })
}

/// Copy the bundled `hx` to its stable place, executable, unless an identical file is there. Returns whether it wrote.
///
/// # Errors
/// `Io` when the copy fails.
pub fn place_hx(bundled: &Path, home: &Path) -> Result<bool> {
    let target = hx_target(home);
    if digest(bundled).is_some() && digest(bundled) == digest(&target) {
        return Ok(false);
    }
    let dir = target
        .parent()
        .ok_or_else(|| Error::Io("no bin dir".into()))?;
    std::fs::create_dir_all(dir)?;
    let tmp = target.with_extension("new");
    std::fs::copy(bundled, &tmp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&tmp, &target)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(dir: &Path, version: &str) {
        std::fs::create_dir_all(dir.join("tests")).unwrap();
        std::fs::create_dir_all(dir.join("__pycache__")).unwrap();
        std::fs::write(
            dir.join("plugin.yaml"),
            format!("name: hypotaxis\nversion: {version}\n"),
        )
        .unwrap();
        std::fs::write(dir.join("__init__.py"), format!("V = '{version}'\n")).unwrap();
        std::fs::write(dir.join("tests").join("t.py"), "x").unwrap();
        std::fs::write(dir.join("__pycache__").join("a.pyc"), "x").unwrap();
    }

    #[test]
    fn installs_upgrades_in_place_and_skips_what_is_current() {
        let tmp = tempfile::tempdir().unwrap();
        let (b, home) = (tmp.path().join("bundle"), tmp.path().join("home"));
        bundle(&b, "0.1.0");
        let target = home.join("plugins").join("hypotaxis");
        assert_eq!(
            install_plugin(&b, &home).unwrap(),
            Installed::Written {
                from: None,
                to: "0.1.0".into()
            }
        );
        assert!(target.join("__init__.py").is_file());
        assert!(!target.join("tests").exists() && !target.join("__pycache__").exists());
        assert_eq!(
            install_plugin(&b, &home).unwrap(),
            Installed::Current("0.1.0".into())
        );
        std::fs::write(target.join("stale.py"), "old").unwrap();
        bundle(&b, "0.2.0");
        assert_eq!(
            install_plugin(&b, &home).unwrap(),
            Installed::Written {
                from: Some("0.1.0".into()),
                to: "0.2.0".into()
            }
        );
        assert!(
            !target.join("stale.py").exists(),
            "an upgrade replaces the directory"
        );
        assert_eq!(plugin_version(&target).as_deref(), Some("0.2.0"));
        assert!(!target.parent().unwrap().join(".hypotaxis.old").exists());
    }

    #[test]
    fn a_bundle_without_a_version_is_refused_and_nothing_is_touched() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("plugin.yaml"), "name: x\n").unwrap();
        assert!(install_plugin(tmp.path(), &tmp.path().join("home")).is_err());
        assert!(!tmp.path().join("home").exists());
    }

    #[cfg(unix)]
    #[test]
    fn hx_is_placed_executable_once() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let (src, home) = (tmp.path().join("hx"), tmp.path().join("home"));
        std::fs::write(&src, "binary").unwrap();
        assert!(place_hx(&src, &home).unwrap());
        assert!(
            !place_hx(&src, &home).unwrap(),
            "an identical file is left alone"
        );
        assert_eq!(
            std::fs::metadata(hx_target(&home))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        std::fs::write(&src, "binary v2").unwrap();
        assert!(place_hx(&src, &home).unwrap());
    }

    #[test]
    fn the_bundle_is_found_by_its_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let res = tmp.path().join("res");
        bundle(&res.join("plugin").join("hypotaxis"), "1.0.0");
        std::fs::write(tmp.path().join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(tmp.path()));
        assert_eq!(
            found.plugin_dir.unwrap(),
            res.join("plugin").join("hypotaxis")
        );
        assert_eq!(found.hx.unwrap(), tmp.path().join("hx"));
    }

    #[test]
    fn hx_is_found_in_the_resource_directory_of_a_native_package() {
        let tmp = tempfile::tempdir().unwrap();
        let (res, bin) = (tmp.path().join("lib"), tmp.path().join("bin"));
        std::fs::create_dir_all(&bin).unwrap();
        bundle(&res.join("plugin").join("hypotaxis"), "1.0.0");
        std::fs::write(res.join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(&bin));
        assert_eq!(found.hx.unwrap(), res.join("hx"));
        // beside the executable still wins, as in an app bundle
        std::fs::write(bin.join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(&bin));
        assert_eq!(found.hx.unwrap(), bin.join("hx"));
    }
}
