//! Reading a plugin's files. Every read goes through a `cap_std` `Dir` on the plugin directory
//! and `hx_txn::paths`, so a path or a symlink that leaves the plugin is refused by the same code
//! that guards the workspace.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use hx_txn::paths::{Kind, RelPath, resolve};

use crate::error::{Error, Result};

/// The largest file a mod may load: manifests and modules alike.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// An opened plugin directory.
pub struct PluginDir {
    dir: Dir,
}

fn read_err(path: &str, message: &impl ToString) -> Error {
    Error::Read {
        path: path.to_owned(),
        message: message.to_string(),
    }
}

impl PluginDir {
    /// Opens the plugin directory.
    ///
    /// # Errors
    /// [`Error::Read`] when it does not exist or is not a directory.
    pub fn open(path: &Path) -> Result<Self> {
        let dir = Dir::open_ambient_dir(path, ambient_authority())
            .map_err(|e| read_err(&path.display().to_string(), &e))?;
        Ok(Self { dir })
    }

    /// The canonical plugin-relative path of the regular file `rel` names, when there is one.
    ///
    /// # Errors
    /// [`Error::Read`] for a path that is absolute, has `..`, or leaves the plugin through a symlink.
    pub fn file(&self, rel: &str) -> Result<Option<String>> {
        let parsed = RelPath::parse(rel).map_err(|e| read_err(rel, &e))?;
        let resolved = resolve(&self.dir, &parsed, true).map_err(|e| read_err(rel, &e))?;
        Ok((resolved.exists() && resolved.kind == Some(Kind::File)).then(|| resolved.to_wire()))
    }

    /// Reads a file as UTF-8, up to [`MAX_FILE_BYTES`].
    ///
    /// # Errors
    /// [`Error::Read`] when it is missing, too large, not UTF-8, or outside the plugin.
    pub fn read(&self, rel: &str) -> Result<String> {
        let canonical = self
            .file(rel)?
            .ok_or_else(|| read_err(rel, &"no such file"))?;
        let parsed = RelPath::parse(&canonical).map_err(|e| read_err(rel, &e))?;
        let file = self
            .dir
            .open(parsed.components().iter().collect::<std::path::PathBuf>())
            .map_err(|e| read_err(rel, &e))?;
        let mut text = String::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|e| read_err(rel, &e))?;
        if text.len() as u64 > MAX_FILE_BYTES {
            return Err(read_err(
                rel,
                &format!("larger than {MAX_FILE_BYTES} bytes"),
            ));
        }
        Ok(text)
    }
}

/// The most files and bytes a [`Bundle`] may hold: a plugin's own sources, not a dependency tree.
pub const MAX_BUNDLE_FILES: usize = 512;
/// See [`MAX_BUNDLE_FILES`].
pub const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;

/// A plugin's sources as data: the two manifests and every file with a module extension, read by
/// the parent through [`PluginDir`] (so `cap_std` and `hx_txn::paths` guard every read) and handed
/// to a worker that cannot read the plugin directory itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Bundle {
    /// Plugin-relative canonical path to its text.
    pub files: BTreeMap<String, String>,
}

impl Bundle {
    /// Reads the plugin at `path`: both manifests, and every module-extension file below it that
    /// resolves inside the plugin (a symlink out is skipped, never followed). Dot-directories and
    /// `node_modules` are not read.
    ///
    /// # Errors
    /// [`Error::Read`] for an unreadable manifest, or a plugin over the bundle limits.
    pub fn read(path: &Path) -> Result<Self> {
        let dir = PluginDir::open(path)?;
        let mut files = BTreeMap::new();
        let mut total = 0usize;
        let mut add = |rel: &str, files: &mut BTreeMap<String, String>| -> Result<()> {
            let Some(canonical) = dir.file(rel)? else {
                return Ok(());
            };
            if files.contains_key(&canonical) {
                return Ok(());
            }
            let text = dir.read(&canonical)?;
            total += text.len();
            if files.len() >= MAX_BUNDLE_FILES || total > MAX_BUNDLE_BYTES {
                return Err(read_err(
                    rel,
                    &"the plugin has too many or too large sources",
                ));
            }
            files.insert(canonical, text);
            Ok(())
        };
        add(".claude-plugin/plugin.json", &mut files)?;
        add("hooks/hooks.json", &mut files)?;
        let mut stack = vec![String::new()];
        while let Some(prefix) = stack.pop() {
            let abs = if prefix.is_empty() {
                path.to_path_buf()
            } else {
                path.join(&prefix)
            };
            let Ok(entries) = std::fs::read_dir(&abs) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let rel = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_dir() {
                    if !name.starts_with('.') && name != "node_modules" {
                        stack.push(rel);
                    }
                } else if crate::transform::MODULE_EXTENSIONS
                    .iter()
                    .any(|e| name.ends_with(&format!(".{e}")))
                {
                    // A symlink or a path that leaves the plugin is refused by `file`: skip it.
                    if dir.file(&rel).is_ok() {
                        add(&rel, &mut files)?;
                    }
                }
            }
        }
        Ok(Self { files })
    }
}

/// Where a plugin's files come from: the disk (library use and tests) or a [`Bundle`] (a sandboxed
/// worker).
pub enum Files {
    /// A plugin directory, read through `cap_std`.
    Disk(PluginDir),
    /// Sources already read by the parent.
    Memory(Bundle),
}

impl Files {
    /// See [`PluginDir::file`].
    ///
    /// # Errors
    /// As [`PluginDir::file`]; a bundle only refuses a path that is not relative and plain.
    pub fn file(&self, rel: &str) -> Result<Option<String>> {
        match self {
            Self::Disk(d) => d.file(rel),
            Self::Memory(b) => {
                let parsed = RelPath::parse(rel).map_err(|e| read_err(rel, &e))?;
                let canonical = parsed.to_wire();
                Ok(b.files.contains_key(&canonical).then_some(canonical))
            }
        }
    }

    /// See [`PluginDir::read`].
    ///
    /// # Errors
    /// As [`PluginDir::read`].
    pub fn read(&self, rel: &str) -> Result<String> {
        match self {
            Self::Disk(d) => d.read(rel),
            Self::Memory(b) => {
                let canonical = self
                    .file(rel)?
                    .ok_or_else(|| read_err(rel, &"no such file"))?;
                b.files
                    .get(&canonical)
                    .cloned()
                    .ok_or_else(|| read_err(rel, &"no such file"))
            }
        }
    }
}
