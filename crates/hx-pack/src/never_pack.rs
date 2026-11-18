//! The never-pack list: files whose contents are never returned.
//!
//! The patterns live in `never_pack.json`, shared with the other
//! implementations. Matching is case-insensitive. A file that matches is
//! withheld even when a request names it, and the response says so.

use std::sync::OnceLock;

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::paths::RelPath;

const RULES_JSON: &str = include_str!("../never_pack.json");

#[derive(Deserialize)]
struct Entry {
    glob: String,
    reason: String,
}

#[derive(Deserialize)]
struct File {
    schema_version: u32,
    names: Vec<Entry>,
    paths: Vec<Entry>,
}

/// The compiled never-pack list.
#[derive(Debug)]
pub struct NeverPack {
    names: GlobSet,
    paths: GlobSet,
    name_reasons: Vec<String>,
    path_reasons: Vec<String>,
}

fn build(entries: &[Entry]) -> Result<(GlobSet, Vec<String>)> {
    let mut set = GlobSetBuilder::new();
    for e in entries {
        let glob: Glob = GlobBuilder::new(&e.glob)
            .case_insensitive(true)
            .literal_separator(true)
            .build()
            .map_err(|err| Error::ConfigInvalid(format!("never_pack.json: {}: {err}", e.glob)))?;
        set.add(glob);
    }
    let set = set
        .build()
        .map_err(|err| Error::ConfigInvalid(format!("never_pack.json: {err}")))?;
    Ok((set, entries.iter().map(|e| e.reason.clone()).collect()))
}

impl NeverPack {
    /// Parses a rules document.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] when the JSON or a glob is bad.
    pub fn from_json(json: &str) -> Result<Self> {
        let file: File = serde_json::from_str(json)
            .map_err(|e| Error::ConfigInvalid(format!("never_pack.json: {e}")))?;
        if file.schema_version != 1 {
            return Err(Error::ConfigInvalid(format!(
                "never_pack.json: unsupported schema_version {}",
                file.schema_version
            )));
        }
        let (names, name_reasons) = build(&file.names)?;
        let (paths, path_reasons) = build(&file.paths)?;
        Ok(Self {
            names,
            paths,
            name_reasons,
            path_reasons,
        })
    }

    /// The embedded list, compiled once.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if the embedded file is broken. Callers fail
    /// closed: nothing is returned without a working list.
    pub fn embedded() -> Result<&'static Self> {
        static CELL: OnceLock<std::result::Result<NeverPack, String>> = OnceLock::new();
        CELL.get_or_init(|| NeverPack::from_json(RULES_JSON).map_err(|e| e.to_string()))
            .as_ref()
            .map_err(|msg| Error::ConfigInvalid(msg.clone()))
    }

    /// The reason `path` is withheld, or `None` when it may be packed.
    #[must_use]
    pub fn check(&self, path: &RelPath) -> Option<&str> {
        let name = path.file_name();
        if let Some(i) = self.names.matches(name).first() {
            return self.name_reasons.get(*i).map(String::as_str);
        }
        if let Some(i) = self.paths.matches(path.as_str()).first() {
            return self.path_reasons.get(*i).map(String::as_str);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn withheld(p: &str) -> bool {
        NeverPack::embedded()
            .unwrap()
            .check(&RelPath::parse(p).unwrap())
            .is_some()
    }

    #[test]
    fn env_and_key_files_are_withheld_at_any_depth() {
        for p in [
            ".env",
            "a/b/.env",
            ".env.local",
            "svc/.ENV.production",
            "prod.env",
            "id_rsa",
            "keys/server.pem",
            "tls/cert.crt",
            "x/credentials.json",
            "a/.aws/config",
            ".git/config",
            "sub/.git/HEAD",
            "terraform/prod.tfvars",
            "k/.kube/config",
        ] {
            assert!(withheld(p), "{p} should be withheld");
        }
    }

    #[test]
    fn ordinary_files_are_not() {
        for p in [
            "src/main.rs",
            "README.md",
            "environment.rs",
            "src/env.rs",
            "docs/keys.md",
            "monkey.rs",
            "Cargo.lock",
            ".gitignore",
            ".github/workflows/ci.yml",
        ] {
            assert!(!withheld(p), "{p} should not be withheld");
        }
    }

    #[test]
    fn broken_rules_fail_to_load() {
        assert!(NeverPack::from_json("{").is_err());
        assert!(NeverPack::from_json(r#"{"schema_version":2,"names":[],"paths":[]}"#).is_err());
    }
}
