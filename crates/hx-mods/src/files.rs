//! Reading a plugin's files. Every read goes through a `cap_std` `Dir` on the plugin directory
//! and `hx_txn::paths`, so a path or a symlink that leaves the plugin is refused by the same code
//! that guards the workspace.

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
