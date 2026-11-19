//! A one-time move of what test builds kept under the product's former name (ADR-0028).
//!
//! Nothing shipped under that name, so nothing reads it afterwards. On the first start of a build called boopis, what an
//! earlier build left on this machine is renamed once and the move is logged:
//!
//! - the app's own folders (`<data>/dev.aphesist.<old>`, and the same name under the config and cache folders);
//! - inside the private Hermes home that folder carries: the plugin's folder (`<home>/<old>/`: ledger, journals, `hx`,
//!   `setup.json`), its logs, the stale plugin copy under `plugins/`, and the old words in `config.yaml`;
//! - the API keys in the OS keychain, whose service names carry the product's name. The keychain cannot be listed, so
//!   the keys come from the references (`secret://scope/name`) that `config.yaml` holds.
//!
//! The user's own Hermes home (`HERMES_HOME`, `~/.hermes`) is never touched, and a second run finds nothing to do.

use std::fs;
use std::path::{Path, PathBuf};

use crate::runtime::HOME_DIR;
use crate::secrets::refs::SecretRef;
use crate::secrets::store::SecretStore;

/// The folder name the app used before (Tauri's `identifier`).
const OLD_ID: &str = "dev.aphesist.hypotaxis";
/// The folder name the app uses now.
const NEW_ID: &str = "dev.aphesist.boopis";
/// The old product word, as it appears in folder, plugin, service and key names.
const OLD_WORD: &str = "hypotaxis";
/// The new one.
const NEW_WORD: &str = "boopis";

/// What a run did and found. Logged by the caller once logging is up.
#[derive(Debug, Default)]
pub struct Report {
    /// App folders renamed: `(from, to)`.
    pub moved: Vec<(PathBuf, PathBuf)>,
    /// What changed inside the private Hermes home, one line each.
    pub home: Vec<String>,
    /// The keychain references `config.yaml` held, whose entries are to be moved ([`keychain`]).
    pub refs: Vec<SecretRef>,
    /// What could not be done, and why. Nothing here is fatal: the app starts either way.
    pub warnings: Vec<String>,
}

impl Report {
    /// Nothing moved and nothing went wrong: the usual run.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.moved.is_empty()
            && self.home.is_empty()
            && self.refs.is_empty()
            && self.warnings.is_empty()
    }

    /// Write the report to the log: one `info` line per change, one `warn` per problem.
    pub fn log(&self) {
        for (from, to) in &self.moved {
            tracing::info!(from = %from.display(), to = %to.display(), "migrated the app folder to its new name");
        }
        for line in &self.home {
            tracing::info!("migrated the private Hermes home: {line}");
        }
        for line in &self.warnings {
            tracing::warn!("migration: {line}");
        }
    }
}

/// The folders that can hold `dev.aphesist.<name>`: the ones Tauri's path resolver uses (data, local data, config,
/// cache) and, on macOS, the logs.
#[must_use]
pub fn app_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = [
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::config_dir(),
        dirs::cache_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();
    #[cfg(target_os = "macos")]
    roots.extend(dirs::home_dir().map(|h| h.join("Library").join("Logs")));
    roots.sort();
    roots.dedup();
    roots
}

/// Rename `<root>/<old id>` to `<root>/<new id>` for each root, then migrate the private Hermes home inside the data
/// folder that moved. A root where both names exist is left alone with a warning: which one is right is not ours to guess.
#[must_use]
pub fn folders(roots: &[PathBuf]) -> Report {
    let mut report = Report::default();
    for root in roots {
        let (old, new) = (root.join(OLD_ID), root.join(NEW_ID));
        if !old.is_dir() {
            continue;
        }
        if new.exists() {
            report.warnings.push(format!(
                "{} and {} both exist; the old one is left where it is. Move what you want to keep by hand.",
                old.display(),
                new.display()
            ));
            continue;
        }
        match fs::rename(&old, &new) {
            Ok(()) => {
                let home = new.join(HOME_DIR);
                report.moved.push((old, new));
                if home.is_dir() {
                    migrate_home(&home, &mut report);
                }
            }
            Err(e) => report
                .warnings
                .push(format!("could not rename {}: {e}", old.display())),
        }
    }
    report
}

/// The private Hermes home: rename the plugin's folder and its logs, drop the plugin's stale copy (setup installs it
/// again under its new name), and rewrite the old words in `config.yaml`.
fn migrate_home(home: &Path, report: &mut Report) {
    for (from, to) in [
        (home.join(OLD_WORD), home.join(NEW_WORD)),
        (
            home.join("logs").join(OLD_WORD),
            home.join("logs").join(NEW_WORD),
        ),
    ] {
        if !from.exists() {
            continue;
        }
        if to.exists() {
            report.warnings.push(format!(
                "{} and {} both exist; the old one is left where it is",
                from.display(),
                to.display()
            ));
        } else if let Err(e) = fs::rename(&from, &to) {
            report
                .warnings
                .push(format!("could not rename {}: {e}", from.display()));
        } else {
            report
                .home
                .push(format!("{} is now {}", from.display(), to.display()));
        }
    }
    let plugins = home.join("plugins");
    for stale in [
        plugins.join(OLD_WORD),
        plugins.join(format!(".{OLD_WORD}.new")),
        plugins.join(format!(".{OLD_WORD}.old")),
    ] {
        if stale.exists() {
            match fs::remove_dir_all(&stale) {
                Ok(()) => report
                    .home
                    .push(format!("removed the old plugin copy {}", stale.display())),
                Err(e) => report
                    .warnings
                    .push(format!("could not remove {}: {e}", stale.display())),
            }
        }
    }
    migrate_config(&home.join("config.yaml"), report);
}

/// Rewrite the old words in the home's `config.yaml` (plugin and secret-source keys, `HYPOTAXIS_*` variable names, the
/// paths under the renamed folders), after reading the keychain references out of it. The file is this app's own: it
/// lives in the private home. The write is atomic and keeps the file's mode.
fn migrate_config(path: &Path, report: &mut Report) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    report.refs = references(&text);
    let new = text
        .replace(
            &OLD_WORD.to_ascii_uppercase(),
            &NEW_WORD.to_ascii_uppercase(),
        )
        .replace(OLD_WORD, NEW_WORD);
    if new == text {
        return;
    }
    match write_atomically(path, &new) {
        Ok(()) => report
            .home
            .push(format!("config.yaml: the old name is now {NEW_WORD}")),
        Err(e) => report
            .warnings
            .push(format!("could not rewrite {}: {e}", path.display())),
    }
}

fn write_atomically(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("yaml.migrating");
    fs::write(&tmp, text)?;
    fs::set_permissions(&tmp, fs::metadata(path)?.permissions())?;
    fs::rename(&tmp, path)
}

/// Every `secret://scope/name` in `text` that parses, once each.
fn references(text: &str) -> Vec<SecretRef> {
    let mut found: Vec<SecretRef> = Vec::new();
    for (at, _) in text.match_indices("secret://") {
        let tail = &text[at..];
        let end = tail
            .find(|c: char| {
                !(c.is_ascii_lowercase()
                    || c.is_ascii_digit()
                    || matches!(c, ':' | '/' | '.' | '_' | '-'))
            })
            .unwrap_or(tail.len());
        if let Ok(r) = SecretRef::parse(&tail[..end])
            && !found.contains(&r)
        {
            found.push(r);
        }
    }
    found
}

/// What the keychain step did, for the log.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct KeychainReport {
    /// References whose key moved to the new service name.
    pub moved: Vec<String>,
    /// What could not be done, and why.
    pub warnings: Vec<String>,
}

impl KeychainReport {
    /// Write the report to the log. Values are never logged, only the references.
    pub fn log(&self) {
        for r in &self.moved {
            tracing::info!("migrated the keychain entry of {r} to its new service name");
        }
        for line in &self.warnings {
            tracing::warn!("migration: {line}");
        }
    }
}

/// Move the key of each reference from the old service name (`<old word>.<scope>`) to the new one, then delete the old
/// entry. A reference that has no old entry is skipped. When the new entry already exists it wins and the old one stays,
/// with a warning. When the keychain is unavailable the step stops at the first failure and says so: the keys are
/// still under their old names, and the user enters them again in Settings.
pub fn keychain(store: &dyn SecretStore, refs: &[SecretRef]) -> KeychainReport {
    let mut report = KeychainReport::default();
    for r in refs {
        let old_service = format!("{OLD_WORD}.{}", r.scope);
        let new_service = r.service();
        let outcome = (|| -> crate::error::Result<bool> {
            let Some(value) = store.get(&old_service, &r.name)? else {
                return Ok(false);
            };
            if store.get(&new_service, &r.name)?.is_some() {
                return Err(crate::error::Error::Secrets(format!(
                    "{new_service} already holds a key; {old_service} was left in place"
                )));
            }
            store.set(&new_service, &r.name, &value)?;
            store.delete(&old_service, &r.name)?;
            Ok(true)
        })();
        match outcome {
            Ok(true) => report.moved.push(r.text()),
            Ok(false) => {}
            Err(e @ crate::error::Error::SecretsUnavailable(_)) => {
                report.warnings.push(format!(
                    "the keychain is not available ({e}); the keys keep their old names"
                ));
                break;
            }
            Err(e) => report.warnings.push(format!("{}: {e}", r.text())),
        }
    }
    report
}

#[cfg(test)]
mod tests;
