//! Putting the bundled plugin and `hx` where Hermes and the plugin find them (`docs/ARCHITECTURE.md` section 4).
//!
//! The plugin is a *copy* in `<home>/plugins/boopis/` (the app image is read-only and its path changes on every
//! launch). A copy is current when its **content** is the bundle's ([`tree_digest`]): `plugin.yaml`'s `version` names the
//! manifest, not the code, and it stayed `0.1.0` through every release, so an upgrade that compared versions never
//! replaced the engine's copy (B27). An upgrade replaces the directory in one step (built beside it, then swapped in with
//! one rename): the user's settings live in `config.yaml`, not here, so nothing of theirs is touched. `hx` goes to
//! `<home>/boopis/bin/hx`, a path that stays, and is replaced the same way when its bytes differ.

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
            .map(|r| r.join("plugin").join("boopis"))
            .filter(|p| p.join("plugin.yaml").is_file());
        if plugin_dir.is_none() && cfg!(debug_assertions) {
            let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../plugins/boopis");
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

/// What of a directory entry a copy takes: a directory unless it is a cache or the tests, a regular file unless it is
/// bytecode. Links and anything else are never copied. One rule for [`copy_tree`] and [`tree_digest`], so the digest of a
/// copy is the digest of its bundle.
fn kept(name: &str, kind: std::fs::FileType) -> Option<bool> {
    if kind.is_dir() {
        (!SKIP_DIRS.contains(&name)).then_some(true)
    } else if kind.is_file() {
        let bytecode = Path::new(name)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("pyc"));
        (!bytecode).then_some(false)
    } else {
        None
    }
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        match kept(&name.to_string_lossy(), entry.file_type()?) {
            Some(true) => copy_tree(&entry.path(), &to.join(&name))?,
            Some(false) => {
                std::fs::copy(entry.path(), to.join(&name))?;
            }
            None => {}
        }
    }
    Ok(())
}

/// The SHA-256 of a plugin tree as [`copy_tree`] copies it: every kept directory and file by its path relative to `dir`
/// (`/`-separated, in sorted order), and every file's bytes. Caches, tests and bytecode are not part of it, so the copy in a
/// profile and the bundle it came from have the same digest, whatever Python wrote beside either.
///
/// # Errors
/// The I/O error of a directory or file that cannot be read.
pub fn tree_digest(dir: &Path) -> std::io::Result<String> {
    fn walk(
        dir: &Path,
        rel: &str,
        out: &mut Vec<(String, Option<PathBuf>)>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            match kept(&name, entry.file_type()?) {
                Some(true) => {
                    out.push((path.clone(), None));
                    walk(&entry.path(), &path, out)?;
                }
                Some(false) => out.push((path, Some(entry.path()))),
                None => {}
            }
        }
        Ok(())
    }
    let mut entries = Vec::new();
    walk(dir, "", &mut entries)?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hash = Sha256::new();
    for (rel, file) in &entries {
        // `d` or `f`, the path, a NUL (no path holds one), then a file's length and bytes: no two trees hash alike
        hash.update(if file.is_some() { b"f" } else { b"d" });
        hash.update(rel.as_bytes());
        hash.update([0]);
        if let Some(file) = file {
            let bytes = std::fs::read(file)?;
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(&bytes);
        }
    }
    Ok(hex::encode(hash.finalize()))
}

/// Whether `target` is a copy of `bundle_dir` as setup makes it: a real directory (not a link) with the plugin's
/// `__init__.py`, whose [`tree_digest`] is the bundle's. Anything that cannot be read is not current.
#[must_use]
pub fn is_current(bundle_dir: &Path, target: &Path) -> bool {
    let real_dir = std::fs::symlink_metadata(target).is_ok_and(|m| m.is_dir());
    if !real_dir || !target.join("__init__.py").is_file() {
        return false;
    }
    match (tree_digest(bundle_dir), tree_digest(target)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Whether [`install_named`] would write `<home>/plugins/<name>/` from `bundle_dir` (setup stops the gateway first, so no
/// process runs a mix of the old modules and the new).
#[must_use]
pub fn needs_install(bundle_dir: &Path, home: &Path, name: &str) -> bool {
    !is_current(bundle_dir, &super::ops::plugins_dir(home).join(name))
}

/// Swap two directory entries in one step (Linux `renameat2` with `RENAME_EXCHANGE`), so a reader of either path sees the
/// old tree or the new one, never neither. `Ok(false)` where the kernel or the filesystem cannot (the caller then swaps
/// with two renames).
#[cfg(target_os = "linux")]
#[allow(unsafe_code)] // renameat2 has no std wrapper; both arguments are NUL-terminated strings that outlive the call
fn exchange(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::os::unix::ffi::OsStrExt as _;
    let a = std::ffi::CString::new(a.as_os_str().as_bytes())?;
    let b = std::ffi::CString::new(b.as_os_str().as_bytes())?;
    // SAFETY: both pointers are valid C strings for the whole call; renameat2 reads them and keeps nothing.
    let done = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    if done == 0 {
        return Ok(true);
    }
    let e = std::io::Error::last_os_error();
    match e.raw_os_error() {
        Some(libc::EINVAL | libc::ENOSYS | libc::EOPNOTSUPP) => Ok(false),
        _ => Err(e),
    }
}

#[cfg(not(target_os = "linux"))]
fn exchange(_a: &Path, _b: &Path) -> std::io::Result<bool> {
    Ok(false)
}

/// Put the tree at `fresh` where `target` is: one atomic exchange where the OS has one, else move the old aside and the
/// new in (putting the old back if the second rename fails). The old tree is removed afterwards; nothing is left beside.
fn swap_in(fresh: &Path, target: &Path, old: &Path) -> Result<()> {
    if std::fs::symlink_metadata(target).is_err() {
        std::fs::rename(fresh, target)
            .map_err(|e| Error::Config(format!("installing the plugin failed: {e}")))?;
        return Ok(());
    }
    if exchange(fresh, target)
        .map_err(|e| Error::Config(format!("installing the plugin failed: {e}")))?
    {
        // `fresh` now holds the old tree
        let _ = remove_entry(fresh);
        return Ok(());
    }
    std::fs::rename(target, old)?;
    if let Err(e) = std::fs::rename(fresh, target) {
        let _ = std::fs::rename(old, target); // put the old one back
        return Err(Error::Config(format!("installing the plugin failed: {e}")));
    }
    let _ = remove_entry(old);
    Ok(())
}

/// Remove a directory with its contents, or a link or file as itself (never what a link points at).
fn remove_entry(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// What `install_plugin` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Installed {
    /// The copy in the profile already had the bundle's content (its version is given).
    Current(String),
    /// Copied: a first install (`from: None`), or a copy whose content differed (an upgrade, even at the same version).
    Written {
        /// The version that was there.
        from: Option<String>,
        /// The version now.
        to: String,
    },
}

/// Copy the bundled plugin into `<home>/plugins/boopis/` unless a copy with the same content is already there.
///
/// # Errors
/// `Config` (`hx.setup.plugin_install_failed`) when the copy fails; the old directory is then put back.
pub fn install_plugin(bundle_dir: &Path, home: &Path) -> Result<Installed> {
    install_named(bundle_dir, home, "boopis")
}

/// Copy a plugin the app carries into `<home>/plugins/<name>/` unless a copy with the same content ([`is_current`]) is
/// already there: the boopis plugin, the plugins boopis's runtime carries (ADR-0030), and a bot's own copy where links are
/// not made (`bots::links`). The same swap for all: build the copy beside the target, swap it in with one rename, remove
/// the old tree; on failure the old one stays (or is put back).
///
/// # Errors
/// `Config` when the copy fails; the old directory is then put back.
pub fn install_named(bundle_dir: &Path, home: &Path, name: &str) -> Result<Installed> {
    let to = plugin_version(bundle_dir)
        .ok_or_else(|| Error::Config(format!("the bundled {name} plugin has no version")))?;
    let target = super::ops::plugins_dir(home).join(name);
    if is_current(bundle_dir, &target) {
        return Ok(Installed::Current(to));
    }
    let from = plugin_version(&target);
    let parent = target
        .parent()
        .ok_or_else(|| Error::Io("no plugins dir".into()))?;
    std::fs::create_dir_all(parent)?;
    let fresh = parent.join(format!(".{name}.new"));
    let old = parent.join(format!(".{name}.old"));
    let _ = remove_entry(&fresh);
    let _ = remove_entry(&old);
    copy_tree(bundle_dir, &fresh).map_err(|e| {
        let _ = std::fs::remove_dir_all(&fresh);
        Error::Config(format!("copying the plugin failed: {e}"))
    })?;
    swap_in(&fresh, &target, &old).inspect_err(|_| {
        let _ = remove_entry(&fresh);
    })?;
    Ok(Installed::Written { from, to })
}

/// Where the runtime archive keeps the plugins it carries (`scripts/build-runtime.sh`), each under the name the engine lists it
/// by.
pub const RUNTIME_PLUGINS: &str = "plugins";

/// The plugins the unpacked runtime at `root` carries, as `(name, directory)`, in name order. A runtime that carries none
/// (an older build) has none.
///
/// # Errors
/// `Io` when the runtime's plugin folder exists but cannot be listed.
fn runtime_plugins(root: &Path) -> Result<Vec<(String, PathBuf)>> {
    let Ok(entries) = std::fs::read_dir(root.join(RUNTIME_PLUGINS)) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() && !name.starts_with('.') && name != "boopis" {
            out.push((name, entry.path()));
        }
    }
    out.sort();
    Ok(out)
}

/// The plugins the runtime at `root` carries whose copy in the profile at `home` is missing or differs from it.
#[must_use]
pub fn runtime_plugins_pending(root: &Path, home: &Path) -> Vec<String> {
    runtime_plugins(root)
        .unwrap_or_default()
        .into_iter()
        .filter(|(name, dir)| needs_install(dir, home, name))
        .map(|(name, _)| name)
        .collect()
}

/// Copy every plugin the unpacked runtime at `root` carries into the profile at `home`. True when one was written (the
/// gateway then restarts to load it). A runtime that carries none (an older build) is not an error.
///
/// # Errors
/// `Config` or `Io` when a copy fails.
pub fn install_runtime_plugins(root: &Path, home: &Path) -> Result<bool> {
    let mut changed = false;
    for (name, dir) in runtime_plugins(root)? {
        let written = install_named(&dir, home, &name)?;
        if let Installed::Written { from, to } = &written {
            tracing::info!(plugin = %name, ?from, %to, "placed a plugin the runtime carries");
        }
        changed |= matches!(written, Installed::Written { .. });
    }
    Ok(changed)
}

/// Whether two files hold the same bytes: the sizes, then the contents a block at a time, stopping at the first difference.
/// Cheaper than hashing both, which matters because `Setup::check` asks it at every start, before the window is drawn.
fn same_bytes(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::io::Read as _;
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (std::fs::File::open(a)?, std::fs::File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
    loop {
        let n = fa.read(&mut ba)?;
        if n == 0 {
            return Ok(true);
        }
        fb.read_exact(&mut bb[..n])?;
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

/// Whether the `hx` setup placed in this home is not the bundled one: there is one at its stable place, and its bytes differ
/// (or cannot be read). A home where setup never placed one (the end-to-end stack's, which names its own `hx`) has
/// nothing of setup's to update: a missing file is not an outdated one, and counting it as one restarted the stack's
/// gateway in the release smoke.
#[must_use]
pub fn hx_outdated(bundled: &Path, home: &Path) -> bool {
    std::fs::symlink_metadata(hx_target(home)).is_ok() && hx_differs(bundled, home)
}

/// Whether the `hx` at its stable place differs from the bundled one (or is missing, or either cannot be read):
/// [`place_hx`] would write it.
#[must_use]
pub fn hx_differs(bundled: &Path, home: &Path) -> bool {
    !same_bytes(bundled, &hx_target(home)).unwrap_or(false)
}

/// Where the plugin finds `hx` (`hx_path`).
#[must_use]
pub fn hx_target(home: &Path) -> PathBuf {
    home.join("boopis")
        .join("bin")
        .join(if cfg!(windows) { "hx.exe" } else { "hx" })
}

/// Copy the bundled `hx` to its stable place, executable, unless an identical file is there. Returns whether it wrote.
///
/// # Errors
/// `Io` when the copy fails.
pub fn place_hx(bundled: &Path, home: &Path) -> Result<bool> {
    let target = hx_target(home);
    if !hx_differs(bundled, home) {
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
            format!("name: boopis\nversion: {version}\n"),
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
        let target = home.join("plugins").join("boopis");
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
        assert!(!target.parent().unwrap().join(".boopis.old").exists());
    }

    /// B27: `plugin.yaml` said `0.1.0` in every release, so a version check kept the 0.1.7 code on every upgraded machine.
    #[test]
    fn a_copy_at_the_same_version_with_other_code_is_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let (b, home) = (tmp.path().join("bundle"), tmp.path().join("home"));
        bundle(&b, "0.1.0");
        install_plugin(&b, &home).unwrap();
        let target = home.join("plugins").join("boopis");
        // the next release: same manifest version, a changed module and a new one (0.1.9's bots/guides.py)
        std::fs::write(b.join("__init__.py"), "V = 'new code'\n").unwrap();
        std::fs::create_dir_all(b.join("bots")).unwrap();
        std::fs::write(
            b.join("bots").join("guides.py"),
            "NAME = 'boopis-handoffs'\n",
        )
        .unwrap();
        assert!(needs_install(&b, &home, "boopis"));
        assert_eq!(
            install_plugin(&b, &home).unwrap(),
            Installed::Written {
                from: Some("0.1.0".into()),
                to: "0.1.0".into()
            }
        );
        assert_eq!(
            std::fs::read_to_string(target.join("__init__.py")).unwrap(),
            "V = 'new code'\n"
        );
        assert!(target.join("bots").join("guides.py").is_file());
        assert_eq!(tree_digest(&b).unwrap(), tree_digest(&target).unwrap());
        assert!(!needs_install(&b, &home, "boopis"));
        assert_eq!(
            install_plugin(&b, &home).unwrap(),
            Installed::Current("0.1.0".into())
        );
        let left: Vec<_> = std::fs::read_dir(home.join("plugins"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, ["boopis"], "nothing is left beside the plugin");
    }

    #[test]
    fn caches_tests_and_bytecode_are_not_part_of_the_content() {
        let tmp = tempfile::tempdir().unwrap();
        let (b, home) = (tmp.path().join("bundle"), tmp.path().join("home"));
        bundle(&b, "0.1.0"); // carries tests/ and __pycache__/, which are not copied
        install_plugin(&b, &home).unwrap();
        let target = home.join("plugins").join("boopis");
        // what an engine run writes beside the copy (bytecode next to the sources) does not make it stale
        std::fs::create_dir_all(target.join("__pycache__")).unwrap();
        std::fs::write(target.join("__pycache__").join("x.cpython-314.pyc"), "b").unwrap();
        std::fs::write(target.join("y.pyc"), "b").unwrap();
        assert!(is_current(&b, &target));
        // but anything else is
        std::fs::write(target.join("extra.py"), "").unwrap();
        assert!(!is_current(&b, &target));
    }

    #[test]
    fn the_digest_tells_apart_names_contents_and_where_bytes_sit() {
        let tmp = tempfile::tempdir().unwrap();
        let tree = |name: &str, files: &[(&str, &str)]| {
            let d = tmp.path().join(name);
            for (rel, text) in files {
                let p = d.join(rel);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, text).unwrap();
            }
            tree_digest(&d).unwrap()
        };
        let base = tree("a", &[("x.py", "12"), ("y.py", "3")]);
        assert_eq!(base, tree("same", &[("y.py", "3"), ("x.py", "12")]));
        assert_ne!(base, tree("content", &[("x.py", "13"), ("y.py", "3")]));
        assert_ne!(base, tree("moved", &[("x.py", "1"), ("y.py", "23")]));
        assert_ne!(base, tree("renamed", &[("x.py", "12"), ("z.py", "3")]));
        assert_ne!(base, tree("nested", &[("x.py", "12"), ("d/y.py", "3")]));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_plugin_is_replaced_by_a_copy_and_what_it_pointed_at_is_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let (b, home, elsewhere) = (
            tmp.path().join("bundle"),
            tmp.path().join("home"),
            tmp.path().join("elsewhere"),
        );
        bundle(&b, "0.1.0");
        bundle(&elsewhere, "0.1.0");
        std::fs::create_dir_all(home.join("plugins")).unwrap();
        let target = home.join("plugins").join("boopis");
        std::os::unix::fs::symlink(&elsewhere, &target).unwrap();
        assert!(!is_current(&b, &target), "a link is not a copy setup made");
        assert!(matches!(
            install_plugin(&b, &home).unwrap(),
            Installed::Written { .. }
        ));
        assert!(std::fs::symlink_metadata(&target).unwrap().is_dir());
        assert!(
            elsewhere.join("tests").join("t.py").is_file(),
            "the link's target keeps everything"
        );
    }

    #[test]
    fn the_runtime_plugins_that_differ_are_the_ones_pending() {
        let tmp = tempfile::tempdir().unwrap();
        let (root, home) = (tmp.path().join("runtime"), tmp.path().join("home"));
        bundle(&root.join(RUNTIME_PLUGINS).join("github-copilot"), "0.4.0");
        bundle(&root.join(RUNTIME_PLUGINS).join("grok-acp"), "1.0.0");
        assert_eq!(
            runtime_plugins_pending(&root, &home),
            ["github-copilot", "grok-acp"]
        );
        assert!(install_runtime_plugins(&root, &home).unwrap());
        assert!(runtime_plugins_pending(&root, &home).is_empty());
        std::fs::write(
            root.join(RUNTIME_PLUGINS)
                .join("grok-acp")
                .join("__init__.py"),
            "changed",
        )
        .unwrap();
        assert_eq!(runtime_plugins_pending(&root, &home), ["grok-acp"]);
        assert!(runtime_plugins_pending(&tmp.path().join("none"), &home).is_empty());
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
        assert!(!hx_differs(&src, &home) && !hx_outdated(&src, &home));
        std::fs::write(&src, "binary v2").unwrap();
        assert!(
            hx_outdated(&src, &home),
            "the one setup placed is older than the bundle"
        );
        assert!(
            hx_differs(&src, &home),
            "a new hx is seen before it is placed"
        );
        assert!(place_hx(&src, &home).unwrap());
        assert!(!hx_differs(&src, &home));
    }

    #[test]
    fn a_home_where_setup_never_placed_hx_has_no_outdated_hx() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, home) = (tmp.path().join("hx"), tmp.path().join("home"));
        std::fs::write(&src, "binary").unwrap();
        assert!(hx_differs(&src, &home), "setup's hx step still places it");
        assert!(
            !hx_outdated(&src, &home),
            "but nothing of setup's is out of date"
        );
    }

    #[test]
    fn the_bundle_is_found_by_its_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let res = tmp.path().join("res");
        bundle(&res.join("plugin").join("boopis"), "1.0.0");
        std::fs::write(tmp.path().join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(tmp.path()));
        assert_eq!(found.plugin_dir.unwrap(), res.join("plugin").join("boopis"));
        assert_eq!(found.hx.unwrap(), tmp.path().join("hx"));
    }

    #[test]
    fn hx_is_found_in_the_resource_directory_of_a_native_package() {
        let tmp = tempfile::tempdir().unwrap();
        let (res, bin) = (tmp.path().join("lib"), tmp.path().join("bin"));
        std::fs::create_dir_all(&bin).unwrap();
        bundle(&res.join("plugin").join("boopis"), "1.0.0");
        std::fs::write(res.join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(&bin));
        assert_eq!(found.hx.unwrap(), res.join("hx"));
        // beside the executable still wins, as in an app bundle
        std::fs::write(bin.join("hx"), "x").unwrap();
        let found = Bundle::locate(Some(&res), Some(&bin));
        assert_eq!(found.hx.unwrap(), bin.join("hx"));
    }
}
