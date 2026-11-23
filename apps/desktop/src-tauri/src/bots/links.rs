//! A bot's own `plugins/` folder (ADR-0042). The engine gives each profile home its own plugins (`<home>/plugins/<name>/`,
//! the engine's plugin README), and a bot's home is `<root>/profiles/<bot>`, so it does not see the plugins of the root. Each
//! plugin boopis manages is placed in the bot's folder as a link to the root's copy where the OS allows one without
//! privileges, and as a copy, compared by content like setup's own (`setup::install::is_current`), where it does not
//! (Windows: a symbolic link needs a privilege or Developer Mode). A link that already reaches the root's copy is left as it
//! is, however it was written (the owner's own absolute links included); anything else under that name is replaced.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::setup::install::{Installed, install_named, is_current, plugin_version};

/// How a plugin reaches a bot's folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    /// A relative symbolic link to the root's copy: it follows the root's copy through every update and survives the whole
    /// engine folder moving. Unix.
    Link,
    /// A copy, replaced when its content is not the root's copy's. Windows.
    Copy,
}

impl Strategy {
    /// The way of this OS.
    #[must_use]
    pub const fn here() -> Self {
        if cfg!(windows) {
            Self::Copy
        } else {
            Self::Link
        }
    }
}

/// What placing one plugin did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placed {
    /// It was there already and reaches the root's copy (or is a copy with the same content).
    Kept,
    /// Placed where nothing was.
    Added,
    /// Something else had the name (a broken or foreign link, an older copy) and was replaced.
    Replaced,
    /// The root has no such plugin (setup has not placed it yet): nothing to give.
    Missing,
}

impl Placed {
    /// Whether the bot's folder changed.
    #[must_use]
    pub fn changed(&self) -> bool {
        matches!(self, Self::Added | Self::Replaced)
    }
}

/// Whether `dir` holds a plugin (its manifest).
#[must_use]
pub fn is_plugin(dir: &Path) -> bool {
    dir.join("plugin.yaml").is_file() || dir.join("plugin.yml").is_file()
}

/// Whether `target` reaches the same directory as `source` (both resolved; a broken link reaches nothing).
fn reaches(target: &Path, source: &Path) -> bool {
    match (std::fs::canonicalize(target), std::fs::canonicalize(source)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Remove whatever is at `path` without following a link: a link (to a directory or not) is removed as a link, a directory
/// with its contents, anything else as a file.
fn remove_entry(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        // On Windows a link to a directory is removed with remove_dir; elsewhere a link is a file.
        std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))
    } else if meta.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// The relative path from the folder `from` to `to`, both absolute and lexically clean (`profiles/kai/plugins` to `plugins/x`
/// is `../../../plugins/x`). `None` when they share no root.
fn relative(from: &Path, to: &Path) -> Option<PathBuf> {
    let a: Vec<_> = from.components().collect();
    let b: Vec<_> = to.components().collect();
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    if common == 0 {
        return None;
    }
    let mut out = PathBuf::new();
    for _ in common..a.len() {
        out.push("..");
    }
    for c in &b[common..] {
        out.push(c);
    }
    Some(out)
}

#[cfg(unix)]
fn symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    let parent = target.parent().unwrap_or(Path::new("."));
    let pointer = relative(parent, source).unwrap_or_else(|| source.to_path_buf());
    std::os::unix::fs::symlink(pointer, target)
}

#[cfg(not(unix))]
fn symlink(_source: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "links are not made on this OS",
    ))
}

/// Place the plugin at `source` (the root's copy, `<root>/plugins/<name>`) in the bot whose home is `bot`, as
/// `<bot>/plugins/<name>`.
///
/// # Errors
/// `Io` when the bot's `plugins` folder is a link (nothing is written through it), or when a write fails.
pub fn place(source: &Path, bot: &Path, name: &str, strategy: Strategy) -> Result<Placed> {
    if !is_plugin(source) {
        return Ok(Placed::Missing);
    }
    let folder = bot.join("plugins");
    if std::fs::symlink_metadata(&folder).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(Error::Io(format!(
            "{} is a link; boopis writes nothing through it",
            folder.display()
        )));
    }
    std::fs::create_dir_all(&folder)?;
    let target = folder.join(name);
    let existing = std::fs::symlink_metadata(&target).ok();
    if existing.is_some() && reaches(&target, source) {
        return Ok(Placed::Kept);
    }
    match strategy {
        Strategy::Link => {
            let replaced = existing.is_some();
            if replaced {
                remove_entry(&target)?;
            }
            symlink(source, &target)?;
            Ok(if replaced {
                Placed::Replaced
            } else {
                Placed::Added
            })
        }
        Strategy::Copy => {
            // A link that reaches somewhere else (or nowhere) is not a copy to upgrade: it goes first.
            if existing.is_some_and(|m| m.file_type().is_symlink()) {
                remove_entry(&target)?;
            }
            let had = std::fs::symlink_metadata(&target).is_ok();
            match install_named(source, bot, name)? {
                Installed::Current(_) => Ok(Placed::Kept),
                Installed::Written { from: None, .. } if !had => Ok(Placed::Added),
                Installed::Written { .. } => Ok(Placed::Replaced),
            }
        }
    }
}

/// Whether the bot whose home is `bot` already has the plugin at `source` as [`place`] would leave it: a link that reaches
/// it, or (with [`Strategy::Copy`]) a copy with its content. A repair that finds this skips the bot; anything else is placed
/// again (an outdated copy included, which a look at the manifest alone missed).
#[must_use]
pub fn current(source: &Path, bot: &Path, name: &str, strategy: Strategy) -> bool {
    let target = bot.join("plugins").join(name);
    match strategy {
        Strategy::Link => reaches(&target, source),
        Strategy::Copy => reaches(&target, source) || is_current(source, &target),
    }
}

/// The version a bot's copy of a plugin has, for a report (a link reports the root's).
#[must_use]
pub fn version_in(bot: &Path, name: &str) -> Option<String> {
    plugin_version(&bot.join("plugins").join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path, version: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("plugin.yaml"),
            format!("name: x\nversion: {version}\n"),
        )
        .unwrap();
        std::fs::write(dir.join("__init__.py"), "").unwrap();
    }

    #[test]
    fn the_relative_path_climbs_out_of_the_bot() {
        assert_eq!(
            relative(
                Path::new("/e/profiles/kai/plugins"),
                Path::new("/e/plugins/boopis")
            ),
            Some(PathBuf::from("../../../plugins/boopis"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_added_kept_and_a_wrong_one_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("engine");
        let source = root.join("plugins").join("boopis");
        plugin(&source, "1.0.0");
        let bot = root.join("profiles").join("kai");
        std::fs::create_dir_all(&bot).unwrap();
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Link).unwrap(),
            Placed::Added
        );
        let link = bot.join("plugins").join("boopis");
        assert_eq!(
            std::fs::read_link(&link).unwrap(),
            PathBuf::from("../../../plugins/boopis")
        );
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Link).unwrap(),
            Placed::Kept
        );
        // the owner's own absolute link to the same folder is left as it is
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&source, &link).unwrap();
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Link).unwrap(),
            Placed::Kept
        );
        assert_eq!(std::fs::read_link(&link).unwrap(), source);
        // a broken link, and an old real copy, are replaced
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("gone"), &link).unwrap();
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Link).unwrap(),
            Placed::Replaced
        );
        std::fs::remove_file(&link).unwrap();
        plugin(&link, "0.9.0");
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Link).unwrap(),
            Placed::Replaced
        );
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        // the whole engine folder moves: the relative link still reaches the moved root
        let moved = tmp.path().join("moved");
        std::fs::rename(&root, &moved).unwrap();
        assert!(reaches(
            &moved.join("profiles/kai/plugins/boopis"),
            &moved.join("plugins/boopis")
        ));
    }

    #[test]
    fn a_copy_follows_the_roots_version() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("engine");
        let source = root.join("plugins").join("boopis");
        plugin(&source, "1.0.0");
        let bot = root.join("profiles").join("kai");
        std::fs::create_dir_all(&bot).unwrap();
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Copy).unwrap(),
            Placed::Added
        );
        assert_eq!(version_in(&bot, "boopis").as_deref(), Some("1.0.0"));
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Copy).unwrap(),
            Placed::Kept
        );
        plugin(&source, "1.1.0");
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Copy).unwrap(),
            Placed::Replaced
        );
        assert_eq!(version_in(&bot, "boopis").as_deref(), Some("1.1.0"));
    }

    /// B27 for the bots' copies: a new release at the same manifest version is still a new copy.
    #[test]
    fn a_copy_with_other_code_at_the_same_version_is_not_current_and_is_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("engine");
        let source = root.join("plugins").join("boopis");
        plugin(&source, "0.1.0");
        let bot = root.join("profiles").join("kai");
        std::fs::create_dir_all(&bot).unwrap();
        place(&source, &bot, "boopis", Strategy::Copy).unwrap();
        assert!(current(&source, &bot, "boopis", Strategy::Copy));
        std::fs::write(source.join("__init__.py"), "V = 'next release'\n").unwrap();
        assert!(!current(&source, &bot, "boopis", Strategy::Copy));
        assert_eq!(
            place(&source, &bot, "boopis", Strategy::Copy).unwrap(),
            Placed::Replaced
        );
        assert!(current(&source, &bot, "boopis", Strategy::Copy));
        assert_eq!(
            std::fs::read_to_string(bot.join("plugins/boopis/__init__.py")).unwrap(),
            "V = 'next release'\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_current_only_while_it_reaches_the_root_s_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("engine");
        let source = root.join("plugins").join("boopis");
        plugin(&source, "0.1.0");
        let other = tmp.path().join("other");
        plugin(&other, "0.1.0");
        let bot = root.join("profiles").join("kai");
        std::fs::create_dir_all(bot.join("plugins")).unwrap();
        assert!(!current(&source, &bot, "boopis", Strategy::Link));
        std::os::unix::fs::symlink(&other, bot.join("plugins/boopis")).unwrap();
        assert!(
            !current(&source, &bot, "boopis", Strategy::Link),
            "a plugin that is there but is not the root's copy"
        );
        place(&source, &bot, "boopis", Strategy::Link).unwrap();
        assert!(current(&source, &bot, "boopis", Strategy::Link));
    }

    #[test]
    fn nothing_is_given_that_the_root_does_not_have() {
        let tmp = tempfile::tempdir().unwrap();
        let bot = tmp.path().join("profiles").join("kai");
        std::fs::create_dir_all(&bot).unwrap();
        assert_eq!(
            place(
                &tmp.path().join("plugins/grok-acp"),
                &bot,
                "grok-acp",
                Strategy::here()
            )
            .unwrap(),
            Placed::Missing
        );
        assert!(!bot.join("plugins").exists());
    }

    #[cfg(unix)]
    #[test]
    fn nothing_is_written_through_a_linked_plugins_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("plugins").join("boopis");
        plugin(&source, "1.0.0");
        let bot = tmp.path().join("profiles").join("kai");
        std::fs::create_dir_all(&bot).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("elsewhere"), bot.join("plugins")).unwrap();
        assert!(place(&source, &bot, "boopis", Strategy::Link).is_err());
        assert!(!tmp.path().join("elsewhere").exists());
    }
}
