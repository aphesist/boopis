//! Setup's last decision: which models run, and whether their keys are in place. It reads what Hermes already has
//! (named `providers:`, keys in `.env` by name, the claude-subscription plugin), asks for what is missing through forms,
//! saves a key to the host's keychain and ties it to its provider with the same two config writes the plugin makes for a
//! credential form (`plugins/hypotaxis/forms/effects.py`): `providers.<name>.key_env` and `secrets.hypotaxis_host.env`.

use std::path::Path;

use serde_json::{Value, json};

use super::ops::HermesOps;
use super::{DiffLine, Form};
use crate::error::Result;
use crate::secrets::SecretStore;
use crate::secrets::refs::{SOURCE, SecretRef, builtin_provider_env};

/// The variables Hermes accepts as an Anthropic credential.
const ANTHROPIC_VARS: &[&str] = &["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
/// The Claude subscription plugin, which signs in through the `claude` CLI instead of a key.
pub const SUBSCRIPTION_PLUGIN: &str = "claude-subscription-directsdk";
const LADDER_KEY: &str = "plugins.entries.hypotaxis.settings.ladder";

/// What the providers step found out.
pub enum Outcome {
    /// Nothing more to ask: a line for the receipt.
    Done(String),
    /// The user decided to skip models for now.
    Skipped(String),
    /// A form to show.
    Form(Form),
}

/// Names of the variables in `<home>/.env` that have a value. Values are never read into the result.
#[must_use]
pub fn dotenv_names(home: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(home.join(".env")) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| {
            let (k, v) = l.trim().strip_prefix("export ").unwrap_or(l.trim()).split_once('=')?;
            (!k.starts_with('#') && !v.trim().trim_matches(['"', '\'']).is_empty()).then(|| k.trim().to_owned())
        })
        .collect()
}

/// A named provider as setup sees it.
struct Named {
    name: String,
    models: Vec<String>,
    inline_key: bool,
    key_env: Option<String>,
}

fn named_providers(cfg: Option<&Value>) -> Vec<Named> {
    let Some(map) = cfg.and_then(Value::as_object) else {
        return Vec::new();
    };
    map.iter()
        .map(|(name, v)| Named {
            name: name.clone(),
            models: v["models"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default(),
            inline_key: v["api_key"].as_str().is_some_and(|k| !k.trim().is_empty()),
            key_env: v["key_env"].as_str().or_else(|| v["api_key_env"].as_str()).map(str::to_owned),
        })
        .collect()
}

/// Whether the keychain holds the secret. A direct call: the Secret Service answers in milliseconds, and setup runs once.
fn saved(store: &dyn SecretStore, r: &SecretRef) -> bool {
    matches!(store.get(&r.service(), &r.name), Ok(Some(_)))
}

fn credential_form(provider: &str) -> Form {
    let r = SecretRef::provider_key(provider);
    Form::new(
        &format!("setup.credential.{provider}"),
        "credential",
        &format!("Add your {provider} API key"),
        "Models need it to answer. It is saved in your OS keychain, not in a file, and Hermes reads it from there.",
        json!({"type": "object", "required": ["value"], "properties": {
            "value": {"type": "string", "title": "API key", "x-secret": true, "x-secret-ref": r.text()}}}),
    )
}

/// Make Hermes read `r` as the key of `provider`: a named entry gets `key_env`, a built-in provider keeps its own
/// variable, and the secret source binds the variable to the reference. Returns the writes it made.
///
/// # Errors
/// Whatever `config set` refuses.
pub async fn wire(ops: &dyn HermesOps, provider: &str, named: bool) -> Result<Vec<DiffLine>> {
    let r = SecretRef::provider_key(provider);
    let var = if named { Some(r.env_name()) } else { builtin_provider_env(provider) };
    let Some(var) = var else {
        return Ok(Vec::new());
    };
    let mut writes = vec![(format!("secrets.{SOURCE}.env.{var}"), r.text())];
    if named {
        writes.insert(0, (format!("providers.{provider}.key_env"), var));
    }
    let mut made = Vec::new();
    for (key, value) in writes {
        let current = ops.config_get(&key).await?;
        if current.as_ref().and_then(Value::as_str) != Some(value.as_str()) {
            ops.config_set(&key, &value).await?;
            made.push(DiffLine { key, from: current, to: json!(value) });
        }
    }
    Ok(made)
}

/// Decide and act. `choice` is the user's earlier answer (`""` means skip).
///
/// # Errors
/// Whatever Hermes refuses.
pub async fn run(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    choice: Option<&str>,
    restart: &mut bool,
) -> Result<Outcome> {
    let home = ops.home();
    let env = dotenv_names(&home);
    let named = named_providers(ops.config_get("providers").await?.as_ref());
    let anthropic_ref = SecretRef::provider_key("anthropic");
    let claude_key = ANTHROPIC_VARS.iter().any(|v| env.iter().any(|e| e == v)) || saved(store, &anthropic_ref);
    let claude = if claude_key {
        if saved(store, &anthropic_ref) && !wire(ops, "anthropic", false).await?.is_empty() {
            *restart = true;
        }
        true
    } else {
        false
    };
    if claude && choice.is_none_or(|c| c == "anthropic") {
        return Ok(Outcome::Done("Claude ladder: haiku, sonnet, opus on your Anthropic key".into()));
    }
    if choice == Some("") {
        return Ok(Outcome::Skipped("no model chosen; governed sessions need one (Settings, Models)".into()));
    }
    if choice.is_none() && ops.config_get(LADDER_KEY).await?.is_some() {
        return Ok(Outcome::Done("keeps the tier ladder you set".into()));
    }
    match choice {
        None => Ok(Outcome::Form(ladder_form(&named))),
        Some("anthropic") => Ok(Outcome::Form(credential_form("anthropic"))),
        Some(pick) => single_tier(ops, store, &env, &named, pick, restart).await,
    }
}

fn ladder_form(named: &[Named]) -> Form {
    let mut values = vec!["anthropic".to_owned()];
    let mut names = vec!["Claude: haiku, sonnet, opus (needs an Anthropic API key)".to_owned()];
    for p in named {
        for m in &p.models {
            values.push(format!("{}/{m}", p.name));
            names.push(format!("{m} on {}", p.name));
        }
    }
    Form::new(
        "setup.ladder",
        "choice",
        "Which model should do the work?",
        "hypotaxis runs governed work on a ladder of models, cheapest first. Pick where to start; you can change the ladder later.",
        json!({"type": "object", "required": ["choice"], "properties": {
            "choice": {"type": "string", "title": "Model", "enum": values, "enumNames": names}}}),
    )
}

async fn single_tier(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    env: &[String],
    named: &[Named],
    pick: &str,
    restart: &mut bool,
) -> Result<Outcome> {
    let (provider, model) = pick.split_once('/').unwrap_or((pick, ""));
    let Some(p) = named.iter().find(|p| p.name == provider && p.models.iter().any(|m| m == model)) else {
        return Err(crate::error::Error::Setup("hx.setup.invalid_answer", format!("{pick:?} is not a model Hermes has configured")));
    };
    let r = SecretRef::provider_key(provider);
    let has_key = p.inline_key
        || p.key_env.as_deref().is_some_and(|k| env.iter().any(|e| e == k))
        || saved(store, &r);
    if !has_key {
        return Ok(Outcome::Form(credential_form(provider)));
    }
    if saved(store, &r) && !wire(ops, provider, true).await?.is_empty() {
        *restart = true;
    }
    let ladder = json!({"tiers": [{"name": model, "model": pick}]});
    if ops.config_get(LADDER_KEY).await?.as_ref() != Some(&ladder) {
        ops.config_set(LADDER_KEY, &ladder.to_string()).await?;
        *restart = true;
    }
    Ok(Outcome::Done(format!("one tier: {model} on {provider}")))
}

/// Whether the Claude subscription plugin is enabled (it needs no key).
#[must_use]
pub fn subscription_enabled(plugins: &[super::ops::PluginEntry]) -> bool {
    plugins.iter().any(|p| p.name == SUBSCRIPTION_PLUGIN && p.enabled)
}
