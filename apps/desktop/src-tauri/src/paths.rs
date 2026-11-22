//! Paths a message names (a bot's reply, an agent's answer), opened on this computer: which of them exist, opening one with
//! the system's default app or an editor found here, and showing one in the file manager.
//!
//! Nothing is guessed. A relative path resolves only inside one of the workspaces the UI names (the session's folder, a
//! bot's), and never out of it (`..` and links that leave the workspace are refused); an absolute path, or one under `~`,
//! resolves only when it exists. Everything the webview sends is untrusted: lengths and counts are bounded, and a path to
//! open is resolved again here, so the UI cannot open what it could not resolve. The default app never runs a program:
//! a file that is executable, or of a kind that runs something (`.desktop`, scripts, installers), is refused for Open (Show
//! in folder and an editor still work).

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use specta::Type;

use crate::error::{Error, Result};

/// The most candidates one call may ask about.
pub const MAX_CANDIDATES: usize = 200;
/// The most workspaces one call may name.
pub const MAX_ROOTS: usize = 8;
/// The longest path accepted, in bytes.
pub const MAX_PATH: usize = 4096;

/// What a path a message names turned out to be.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ResolvedPath {
    /// The path as the message wrote it.
    pub path: String,
    /// Where it is: absolute and canonical.
    pub abs: String,
    /// `file` or `folder`.
    pub kind: String,
    /// The path inside the workspace it was found in, `/`-separated; none for an absolute path outside every workspace.
    pub rel: Option<String>,
}

/// An editor found on this computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PathEditor {
    /// Stable id, what `path_open` takes.
    pub id: String,
    /// Its name as people know it.
    pub name: String,
}

/// The editors boopis knows: an id, the name, and the programs that are it (the first found on `PATH` wins). Graphical
/// editors only: a terminal editor needs a terminal the host does not open.
pub const EDITORS: &[(&str, &str, &[&str])] = &[
    ("vscode", "Visual Studio Code", &["code"]),
    ("vscodium", "VSCodium", &["codium", "vscodium"]),
    ("cursor", "Cursor", &["cursor"]),
    ("zed", "Zed", &["zed", "zeditor"]),
    ("sublime", "Sublime Text", &["subl", "sublime_text"]),
    ("kate", "Kate", &["kate"]),
    ("gnome-text-editor", "Text Editor", &["gnome-text-editor"]),
    ("gedit", "gedit", &["gedit"]),
    ("mousepad", "Mousepad", &["mousepad"]),
    (
        "idea",
        "IntelliJ IDEA",
        &["idea", "intellij-idea-ultimate", "intellij-idea-community"],
    ),
];

/// Extensions the default app would run rather than show.
const RUNS: &[&str] = &[
    "desktop",
    "sh",
    "bash",
    "zsh",
    "fish",
    "csh",
    "ksh",
    "run",
    "bin",
    "appimage",
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "ps1",
    "vbs",
    "jar",
    "app",
    "command",
    "scr",
    "pif",
    "lnk",
    "url",
    "deb",
    "rpm",
    "pkg",
    "dmg",
    "flatpakref",
    "snap",
];

fn bounded(s: &str) -> Result<()> {
    if s.is_empty() || s.len() > MAX_PATH || s.contains('\0') || s.chars().any(char::is_control) {
        return Err(Error::InvalidInput("not a path boopis can look for".into()));
    }
    Ok(())
}

/// `~` and `~/x` under `home`; everything else as written.
fn expand(p: &str, home: Option<&Path>) -> Option<PathBuf> {
    if p == "~" {
        return home.map(Path::to_path_buf);
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return home.map(|h| h.join(rest));
    }
    if p.starts_with('~') {
        return None; // another user's home: not ours to read
    }
    Some(PathBuf::from(p))
}

/// Strip a trailing `:line` or `:line:col` (`src/main.rs:42`).
fn without_position(p: &str) -> &str {
    let mut s = p;
    for _ in 0..2 {
        if let Some(i) = s.rfind(':') {
            let tail = &s[i + 1..];
            if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) {
                s = &s[..i];
                continue;
            }
        }
        break;
    }
    s
}

fn kind_of(p: &Path) -> Option<&'static str> {
    let m = std::fs::metadata(p).ok()?;
    if m.is_dir() {
        Some("folder")
    } else if m.is_file() {
        Some("file")
    } else {
        None
    }
}

fn rel_string(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// The workspaces as canonical folders (a root that is not an existing folder is dropped).
#[must_use]
pub fn roots_of(roots: &[String], home: Option<&Path>) -> Vec<PathBuf> {
    roots
        .iter()
        .take(MAX_ROOTS)
        .filter(|r| bounded(r).is_ok())
        .filter_map(|r| expand(r, home))
        .filter(|r| r.is_absolute())
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .filter(|r| r.is_dir())
        .collect()
}

/// Resolve one path a message names against the workspaces (already canonical).
#[must_use]
pub fn resolve_one(raw: &str, roots: &[PathBuf], home: Option<&Path>) -> Option<ResolvedPath> {
    bounded(raw).ok()?;
    let p = without_position(raw.trim());
    if p.is_empty() || p.contains("://") {
        return None;
    }
    let found = |abs: PathBuf, rel: Option<String>| -> Option<ResolvedPath> {
        let kind = kind_of(&abs)?;
        Some(ResolvedPath {
            path: raw.to_string(),
            abs: abs.to_string_lossy().into_owned(),
            kind: kind.into(),
            rel,
        })
    };
    let rel_in = |abs: &Path| {
        roots
            .iter()
            .find_map(|r| abs.strip_prefix(r).ok().map(rel_string))
    };
    let candidate = expand(p, home)?;
    if candidate.is_absolute() {
        let abs = std::fs::canonicalize(&candidate).ok()?;
        let rel = rel_in(&abs);
        return found(abs, rel);
    }
    /* a relative path: inside a workspace and never out of it */
    if candidate
        .components()
        .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
    {
        return None;
    }
    for root in roots {
        let Ok(abs) = std::fs::canonicalize(root.join(&candidate)) else {
            continue;
        };
        if let Ok(rel) = abs.strip_prefix(root) {
            let rel = rel_string(rel);
            if let Some(r) = found(abs.clone(), Some(rel)) {
                return Some(r);
            }
        }
    }
    None
}

/// Resolve every candidate (bounded), in order.
///
/// # Errors
/// `InvalidInput` when the call asks about too many paths or workspaces.
pub fn resolve(
    candidates: &[String],
    roots: &[String],
    home: Option<&Path>,
) -> Result<Vec<Option<ResolvedPath>>> {
    if candidates.len() > MAX_CANDIDATES || roots.len() > MAX_ROOTS {
        return Err(Error::InvalidInput(format!(
            "ask about at most {MAX_CANDIDATES} paths in {MAX_ROOTS} folders"
        )));
    }
    let roots = roots_of(roots, home);
    Ok(candidates
        .iter()
        .map(|c| resolve_one(c, &roots, home))
        .collect())
}

/// A path the UI asks to open or reveal: absolute, canonical, existing.
///
/// # Errors
/// `InvalidInput` for anything else.
pub fn existing(raw: &str) -> Result<(PathBuf, &'static str)> {
    bounded(raw)?;
    let p = Path::new(raw);
    if !p.is_absolute() {
        return Err(Error::InvalidInput(
            "a path to open must be absolute".into(),
        ));
    }
    let abs = std::fs::canonicalize(p)
        .map_err(|_| Error::InvalidInput("that file is not there any more".into()))?;
    let kind = kind_of(&abs)
        .ok_or_else(|| Error::InvalidInput("that is not a file or a folder".into()))?;
    Ok((abs, kind))
}

/// Whether the system's default app would run this file instead of showing it.
#[must_use]
pub fn runs_something(p: &Path) -> bool {
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if RUNS.contains(&ext.as_str()) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(m) = std::fs::metadata(p)
            && m.is_file()
            && m.permissions().mode() & 0o111 != 0
        {
            return true;
        }
    }
    false
}

/// A program by name on `path_var` (the `PATH` the host was started with), as an absolute file that can run.
#[must_use]
pub fn which(name: &str, path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let dirs = path_var?;
    std::env::split_paths(dirs)
        .filter(|d| d.is_absolute())
        .map(|d| d.join(name))
        .find(|c| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::metadata(c)
                    .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            }
            #[cfg(not(unix))]
            {
                c.is_file()
            }
        })
}

/// The editors found on `path_var`, in the table's order, with the program each runs.
#[must_use]
pub fn editors_on(path_var: Option<&std::ffi::OsStr>) -> Vec<(PathEditor, PathBuf)> {
    EDITORS
        .iter()
        .filter_map(|(id, name, programs)| {
            programs
                .iter()
                .find_map(|p| which(p, path_var))
                .map(|prog| {
                    (
                        PathEditor {
                            id: (*id).into(),
                            name: (*name).into(),
                        },
                        prog,
                    )
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (tempdir::Dir, PathBuf) {
        let d = tempdir::Dir::new();
        let root = d.path().join("work");
        std::fs::create_dir_all(root.join("episodes/ep1")).unwrap();
        std::fs::write(root.join("episodes/ep1/episode.json"), "{}").unwrap();
        std::fs::write(d.path().join("secret.txt"), "x").unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        (d, root)
    }

    /// a throwaway folder under the system's temp dir, removed on drop
    mod tempdir {
        pub struct Dir(std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = std::env::temp_dir().join(format!(
                    "boopis-paths-{}-{}",
                    std::process::id(),
                    uuid::Uuid::now_v7()
                ));
                std::fs::create_dir_all(&p).unwrap();
                Self(p)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn a_relative_path_resolves_inside_the_workspace() {
        let (_d, root) = tree();
        let roots = vec![root.clone()];
        let r = resolve_one("episodes/ep1/episode.json", &roots, None).unwrap();
        assert_eq!(r.kind, "file");
        assert_eq!(r.rel.as_deref(), Some("episodes/ep1/episode.json"));
        assert_eq!(
            PathBuf::from(&r.abs),
            root.join("episodes/ep1/episode.json")
        );
        let f = resolve_one("./episodes/ep1/", &roots, None).unwrap();
        assert_eq!(f.kind, "folder");
        let at = resolve_one("episodes/ep1/episode.json:12:3", &roots, None).unwrap();
        assert_eq!(at.path, "episodes/ep1/episode.json:12:3");
        assert_eq!(at.kind, "file");
    }

    #[test]
    fn nothing_is_guessed() {
        let (_d, root) = tree();
        let roots = vec![root];
        assert!(
            resolve_one("episodes/ep2/episode.json", &roots, None).is_none(),
            "a file that is not there"
        );
        assert!(
            resolve_one("episode.json", &roots, None).is_none(),
            "a bare name is not searched for"
        );
        assert!(
            resolve_one("../secret.txt", &roots, None).is_none(),
            "out of the workspace"
        );
        assert!(
            resolve_one("episodes/../../secret.txt", &roots, None).is_none(),
            "out of the workspace by a detour"
        );
        assert!(
            resolve_one("episodes/ep1/episode.json", &[], None).is_none(),
            "no workspace: no relative path"
        );
        assert!(resolve_one("https://x.y/a.json", &roots, None).is_none());
        assert!(resolve_one("~other/x", &roots, None).is_none());
        assert!(resolve_one("a\0b", &roots, None).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leaves_the_workspace_is_refused() {
        let (d, root) = tree();
        std::os::unix::fs::symlink(d.path().join("secret.txt"), root.join("out.txt")).unwrap();
        assert!(resolve_one("out.txt", &[root], None).is_none());
    }

    #[test]
    fn an_absolute_path_resolves_when_it_exists() {
        let (d, root) = tree();
        let secret = std::fs::canonicalize(d.path().join("secret.txt")).unwrap();
        let r = resolve_one(&secret.to_string_lossy(), std::slice::from_ref(&root), None).unwrap();
        assert_eq!(r.rel, None);
        let inside = resolve_one(
            &root.join("episodes").to_string_lossy(),
            std::slice::from_ref(&root),
            None,
        )
        .unwrap();
        assert_eq!(inside.rel.as_deref(), Some("episodes"));
        assert!(resolve_one(&d.path().join("nope").to_string_lossy(), &[root], None).is_none());
    }

    #[test]
    fn home_and_workspaces_expand() {
        let (d, root) = tree();
        let home = std::fs::canonicalize(d.path()).unwrap();
        let r = resolve_one("~/secret.txt", &[], Some(&home)).unwrap();
        assert_eq!(r.kind, "file");
        let roots = roots_of(
            &[
                "~/work".into(),
                "relative/root".into(),
                "/no/such/dir".into(),
            ],
            Some(&home),
        );
        assert_eq!(roots, vec![root]);
    }

    #[test]
    fn calls_are_bounded() {
        let many = vec!["a.md".to_string(); MAX_CANDIDATES + 1];
        assert!(resolve(&many, &[], None).is_err());
        assert!(resolve(&["a.md".into()], &vec![String::new(); MAX_ROOTS + 1], None).is_err());
        assert_eq!(resolve(&["a.md".into()], &[], None).unwrap(), vec![None]);
        assert!(existing("relative/path").is_err());
        assert!(existing(&"/".repeat(MAX_PATH + 1)).is_err());
    }

    #[test]
    fn the_default_app_never_runs_a_program() {
        let (d, _root) = tree();
        let script = d.path().join("go.desktop");
        std::fs::write(&script, "[Desktop Entry]").unwrap();
        assert!(runs_something(&script));
        assert!(!runs_something(&d.path().join("secret.txt")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let exe = d.path().join("tool");
            std::fs::write(&exe, "#!/bin/sh").unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(runs_something(&exe));
        }
    }

    #[cfg(unix)]
    #[test]
    fn editors_are_found_on_the_path() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempdir::Dir::new();
        let bin = d.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        for name in ["zeditor", "kate", "not-an-editor"] {
            std::fs::write(bin.join(name), "#!/bin/sh").unwrap();
            std::fs::set_permissions(bin.join(name), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        std::fs::write(bin.join("code"), "not executable").unwrap();
        let path = std::env::join_paths([bin.as_path(), Path::new("relative")]).unwrap();
        let found: Vec<String> = editors_on(Some(&path))
            .into_iter()
            .map(|(e, _)| e.id)
            .collect();
        assert_eq!(found, vec!["zed", "kate"]);
        assert!(editors_on(None).is_empty());
    }
}
