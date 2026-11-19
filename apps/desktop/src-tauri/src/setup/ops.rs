//! What setup asks of Hermes, behind a trait: read and write its configuration, list and enable plugins, restart the
//! gateway. The real implementation runs Hermes's own CLI (`hermes config get/set`, `hermes plugins ...`), so the host
//! never edits `config.yaml` by hand and never parses it (`docs/DECISIONS.md` ADR-0014). Tests use an in-memory double.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::endpoint::Local;
use crate::error::{Error, Result};
use crate::free_tier::FreeTier;
use crate::gateway::oneshot::Link;
use crate::hermes::Supervisor;

/// One plugin as `hermes plugins list --json` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginEntry {
    /// The plugin's name.
    pub name: String,
    /// Whether it is enabled.
    pub enabled: bool,
}

/// A plugin as Hermes's catalog lists it (`hermes plugins search --json`): the reviewed, pinned build that an install gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogEntry {
    /// The catalog name (`hermes plugins install <name>`).
    pub name: String,
    /// The version the pin carries.
    pub version: String,
    /// The pinned commit.
    pub sha: String,
    /// Where Hermes clones it from.
    pub repo: String,
    /// The folder of the repository it lives in, when it is not the root.
    pub subdir: String,
    /// `official`, `community`, ...
    pub tier: String,
    /// The tools, hooks and middleware it registers (empty: it declares none).
    pub provides: Vec<String>,
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
    /// Nous's free tier as Hermes reports it (`free_tier.status`), asked on a link that declares itself the Desktop on this
    /// machine, because Hermes answers "claimable" only to that. Call it only after the user chose the free tier.
    async fn free_tier_status(&self) -> Result<FreeTier>;
    /// Ask Hermes to claim the free tier (`free_tier.provision`), the one call that reaches Nous's account service. Hermes
    /// applies its own rules (a first install, once per OS user); the answer carries Hermes's own reason when it did not.
    async fn free_tier_provision(&self) -> Result<FreeTier>;
    /// The catalog's entry for `name`, as Hermes reads it now (the live catalog, else the one in its own tree). `None` when the
    /// catalog has no such plugin. Read-only: it installs nothing.
    async fn catalog_entry(&self, name: &str) -> Result<Option<CatalogEntry>>;
    /// Install the catalog's pinned, reviewed build of `name` into this profile (`hermes plugins install <name> --no-enable`).
    /// boopis never vendors or edits a plugin: Hermes fetches it, checks it against the catalog's kill list and pins it.
    ///
    /// # Errors
    /// `hx.setup.subscription_unreachable` when Hermes could not download it, `hx.setup.subscription_install_failed` for any
    /// other refusal. Nothing is installed in either case.
    async fn install_catalog_plugin(&self, name: &str) -> Result<()>;
    /// The models of `provider` that Hermes's catalogue lists as free (`model.options`), in the catalogue's order.
    async fn free_models(&self, provider: &str) -> Result<Vec<String>>;
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

    /// A short-lived link to this home's gateway (started when none runs).
    async fn link(&self, desktop_local: bool) -> Result<Link> {
        let limits = self.sup.limits();
        let endpoint = Local::new(self.sup.clone(), self.home.clone(), limits.clone());
        Link::open(
            &endpoint,
            desktop_local,
            limits.max_inbound_frame,
            limits.ensure_timeout + limits.cli_timeout,
        )
        .await
    }

    async fn run(&self, args: &[&str]) -> Result<crate::hermes::cli::Output> {
        let info = self.sup.info().await?;
        self.sup
            .cli()
            .run(
                &info.binary,
                &self.home,
                args,
                self.sup.limits().ensure_timeout,
            )
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
        // `gateway stop` refuses while a turn is live without --yes; setup runs before any work, so the supervisor passes it.
        // It waits for the old gateway to go before it starts the new one, so the new one is served its keys
        // (`Supervisor::restart`).
        self.sup.restart(&self.home, true).await.map(|_| ())
    }

    async fn free_tier_status(&self) -> Result<FreeTier> {
        let answer = self
            .link(true)
            .await?
            .call("free_tier.status", &json!({}))
            .await?;
        serde_json::from_value(answer)
            .map_err(|e| Error::Config(format!("free_tier.status answered badly: {e}")))
    }

    async fn free_tier_provision(&self) -> Result<FreeTier> {
        let answer = self
            .link(true)
            .await?
            .call("free_tier.provision", &json!({}))
            .await?;
        serde_json::from_value(answer)
            .map_err(|e| Error::Config(format!("free_tier.provision answered badly: {e}")))
    }

    async fn catalog_entry(&self, name: &str) -> Result<Option<CatalogEntry>> {
        let out = self.run(&["plugins", "search", name, "--json"]).await?;
        if out.code != 0 {
            return Err(Error::Config(format!(
                "hermes could not read its plugin catalog: {}",
                tail(&out.stderr)
            )));
        }
        let answer: Value = serde_json::from_str(out.stdout.trim())
            .map_err(|e| Error::Config(format!("hermes plugins search printed no JSON: {e}")))?;
        Ok(catalog_entry_of(&answer, name))
    }

    async fn install_catalog_plugin(&self, name: &str) -> Result<()> {
        let out = self
            .run(&["plugins", "install", name, "--no-enable"])
            .await?;
        if out.code == 0 {
            return Ok(());
        }
        Err(install_refusal(&out.stdout, &out.stderr))
    }

    async fn free_models(&self, provider: &str) -> Result<Vec<String>> {
        let answer = self
            .link(false)
            .await?
            .call("model.options", &json!({"include_unconfigured": true}))
            .await?;
        Ok(free_models_of(&answer, provider))
    }
}

/// The entry named `name` in a `hermes plugins search --json` answer.
#[must_use]
pub fn catalog_entry_of(answer: &Value, name: &str) -> Option<CatalogEntry> {
    let row = answer["results"]
        .as_array()?
        .iter()
        .find(|r| r["name"].as_str() == Some(name))?;
    let text = |k: &str| row[k].as_str().unwrap_or_default().to_owned();
    let caps = &row["capabilities"];
    let provides = [
        ("provides_tools", "tools"),
        ("provides_hooks", "hooks"),
        ("provides_middleware", "middleware"),
    ]
    .iter()
    .filter_map(|(k, label)| {
        let items: Vec<&str> = caps[*k]
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .collect();
        (!items.is_empty()).then(|| format!("{label}: {}", items.join(", ")))
    })
    .collect();
    Some(CatalogEntry {
        name: text("name"),
        version: text("version"),
        sha: text("sha"),
        repo: text("repo"),
        subdir: text("subdir"),
        tier: text("tier"),
        provides,
    })
}

/// What a refused `hermes plugins install` means, in plain words. Hermes prints its `Error:` on standard output; a download that
/// could not happen (no network, a blocked host) says "Could not download the plugin".
#[must_use]
pub fn install_refusal(stdout: &str, stderr: &str) -> Error {
    let all = format!("{stdout}\n{stderr}");
    if all.contains("Could not download") || all.contains("internet connection") {
        return Error::Setup(
            "hx.setup.subscription_unreachable",
            "Hermes could not reach the plugin catalog's repository to download the Claude subscription plugin. Check your internet connection and choose Check again. Nothing was installed or changed.".into(),
        );
    }
    let why: String = all
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("Error:") || l.starts_with("Blocked:"))
        .unwrap_or("it gave no reason")
        .chars()
        .filter(|c| !c.is_control())
        .take(300)
        .collect();
    Error::Setup(
        "hx.setup.subscription_install_failed",
        format!(
            "Hermes did not install the Claude subscription plugin ({why}). Nothing was installed or changed."
        ),
    )
}

/// The ids of `provider`'s models that a `model.options` answer lists as free: priced zero by the catalogue
/// (`pricing[id].free`), or tagged `:free` by the provider's own naming.
#[must_use]
pub fn free_models_of(answer: &Value, provider: &str) -> Vec<String> {
    let Some(row) = answer["providers"]
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["slug"].as_str() == Some(provider)))
    else {
        return Vec::new();
    };
    row["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(Value::as_str)
                .filter(|id| id.ends_with(":free") || row["pricing"][*id]["free"] == true)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The directory a profile's plugins live in.
#[must_use]
pub fn plugins_dir(home: &Path) -> PathBuf {
    home.join("plugins")
}
