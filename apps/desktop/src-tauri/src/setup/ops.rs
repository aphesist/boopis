//! What setup asks of Hermes, behind a trait: read and write its configuration, list and enable plugins, restart the
//! gateway. The real implementation runs Hermes's own CLI (`hermes config get/set`, `hermes plugins ...`), so the host
//! never edits `config.yaml` by hand and never parses it (`docs/DECISIONS.md` ADR-0014). Tests use an in-memory double.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::hermes::Supervisor;

/// One plugin as `hermes plugins list --json` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginEntry {
    /// The plugin's name.
    pub name: String,
    /// Whether it is enabled.
    pub enabled: bool,
}

/// Hermes, as setup needs it.
#[async_trait]
pub trait HermesOps: Send + Sync {
    /// Hermes's version (`None` when it names none).
    ///
    /// # Errors
    /// `HermesMissing` when no `hermes` is installed.
    async fn version(&self) -> Result<Option<String>>;
    /// The profile's home directory.
    fn home(&self) -> PathBuf;
    /// A configuration value (`hermes config get --json`), `None` when unset.
    async fn config_get(&self, key: &str) -> Result<Option<Value>>;
    /// Set a configuration value (`hermes config set`). `value` is text; JSON objects and booleans are coerced by Hermes.
    async fn config_set(&self, key: &str, value: &str) -> Result<()>;
    /// Every plugin Hermes knows.
    async fn plugins(&self) -> Result<Vec<PluginEntry>>;
    /// Enable a plugin (`hermes plugins enable`).
    async fn enable_plugin(&self, name: &str) -> Result<()>;
    /// Stop the gateway if it runs and start it again, so it loads the plugin and re-reads its secret sources.
    async fn restart_gateway(&self) -> Result<()>;
}

/// The real thing: Hermes's CLI through the supervisor's runner.
pub struct CliOps {
    sup: Arc<Supervisor>,
    home: PathBuf,
}

impl CliOps {
    /// Ops for the profile whose home is `home`.
    #[must_use]
    pub fn new(sup: Arc<Supervisor>, home: PathBuf) -> Self {
        Self { sup, home }
    }

    async fn run(&self, args: &[&str]) -> Result<crate::hermes::cli::Output> {
        let info = self.sup.info().await?;
        self.sup
            .cli()
            .run(&info.binary, &self.home, args, self.sup.limits().ensure_timeout)
            .await
    }
}

fn tail(s: &str) -> String {
    s.lines().last().unwrap_or("").chars().take(200).collect()
}

#[async_trait]
impl HermesOps for CliOps {
    async fn version(&self) -> Result<Option<String>> {
        Ok(self.sup.info().await?.version)
    }

    fn home(&self) -> PathBuf {
        self.home.clone()
    }

    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let out = self.run(&["config", "get", "--json", key]).await?;
        if out.code != 0 {
            return Ok(None); // "Config key not set"
        }
        let line = out.stdout.trim();
        serde_json::from_str(line)
            .map(Some)
            .map_err(|e| Error::Config(format!("hermes config get {key} printed no JSON: {e}")))
    }

    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        let out = self.run(&["config", "set", key, value]).await?;
        if out.code != 0 {
            return Err(Error::Config(format!(
                "hermes refused {key}: {}",
                tail(&out.stderr).trim().to_owned() + &tail(&out.stdout)
            )));
        }
        Ok(())
    }

    async fn plugins(&self) -> Result<Vec<PluginEntry>> {
        let out = self.run(&["plugins", "list", "--json"]).await?;
        let list: Value = serde_json::from_str(out.stdout.trim())
            .map_err(|e| Error::Config(format!("hermes plugins list printed no JSON: {e}")))?;
        Ok(list
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| {
                        Some(PluginEntry {
                            name: p["name"].as_str()?.to_owned(),
                            enabled: p["status"].as_str() == Some("enabled"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn enable_plugin(&self, name: &str) -> Result<()> {
        let out = self
            .run(&["plugins", "enable", name, "--no-allow-tool-override"])
            .await?;
        if out.code != 0 {
            return Err(Error::Config(format!(
                "hermes could not enable {name}: {}",
                tail(&out.stderr)
            )));
        }
        Ok(())
    }

    async fn restart_gateway(&self) -> Result<()> {
        // `gateway stop` refuses while a turn is live without --yes; setup runs before any work, so it is passed.
        // It also fails when no gateway runs, which is fine: `ensure` then starts one.
        let _ = self.run(&["gateway", "stop", "--yes"]).await;
        self.sup.ensure(&self.home).await.map(|_| ())
    }
}

/// The directory a profile's plugins live in.
#[must_use]
pub fn plugins_dir(home: &Path) -> PathBuf {
    home.join("plugins")
}
