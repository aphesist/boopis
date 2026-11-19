//! Setup's last decision: which models run, and whether their keys are in place. It reads what Hermes already has
//! (named `providers:`, keys in `.env` by name, the claude-subscription plugin), asks for what is missing through forms,
//! saves a key to the host's keychain and ties it to its provider with the same two config writes the plugin makes for a
//! credential form (`plugins/hypotaxis/forms/effects.py`): `providers.<name>.key_env` and `secrets.hypotaxis_host.env`.

use std::fmt::Write as _;
use std::path::Path;

use serde_json::{Value, json};

use super::ops::HermesOps;
use super::{DiffLine, Form};
use crate::config::FREE_TIER_ENABLED;
use crate::error::{Error, Result};
use crate::free_tier::FreeTier;
use crate::secrets::SecretStore;
use crate::secrets::refs::{SOURCE, SecretRef, builtin_provider_env};

/// The variables Hermes accepts as an Anthropic credential.
const ANTHROPIC_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];
/// The Claude subscription plugin, which signs in through the `claude` CLI instead of a key.
pub const SUBSCRIPTION_PLUGIN: &str = "claude-subscription-directsdk";
const LADDER_KEY: &str = "plugins.entries.hypotaxis.settings.ladder";
/// The choice that uses Nous's free tier (no account, no key): Hermes's own welcome-trial route.
pub const FREE: &str = "free";
/// The choice that uses `OpenRouter`'s `:free` models (a free `OpenRouter` key).
pub const OPENROUTER_FREE: &str = "openrouter-free";
/// Where the free tier's terms are (shown, never decided here: `docs/research/free-tier.md` section 5).
const NOUS_TERMS: &str = "https://portal.nousresearch.com/terms";
const NOUS_PRIVACY: &str = "https://portal.nousresearch.com/privacy";
/// The most tiers proposed from a catalogue.
const PROPOSED_TIERS: usize = 3;

/// What the providers step found out.
#[allow(clippy::large_enum_variant)] // one short-lived value per setup call
pub enum Outcome {
    /// Nothing more to ask: a line for the receipt.
    Done(String),
    /// The user decided to skip models for now.
    Skipped(String),
    /// A form to show.
    Form(Form),
    /// The choice cannot be used here: the form offers the others, and `note` is remembered so the choice is not offered again.
    Unavailable {
        /// The choices again, without the one that cannot be used.
        form: Form,
        /// Why, in Hermes's terms.
        note: String,
    },
}

/// What the providers step knows from earlier calls.
#[derive(Default)]
pub struct Input<'a> {
    /// The user's earlier answer (`""` means skip, `None` means not asked).
    pub choice: Option<&'a str>,
    /// The models picked from a catalogue.
    pub picks: &'a [String],
    /// Why the free tier is not offered here, once Hermes said so.
    pub free_note: Option<&'a str>,
    /// The user asked to choose again.
    pub reopen: bool,
}

/// Names of the variables in `<home>/.env` that have a value. Values are never read into the result.
#[must_use]
pub fn dotenv_names(home: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(home.join(".env")) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| {
            let (k, v) = l
                .trim()
                .strip_prefix("export ")
                .unwrap_or(l.trim())
                .split_once('=')?;
            (!k.starts_with('#') && !v.trim().trim_matches(['"', '\'']).is_empty())
                .then(|| k.trim().to_owned())
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
            models: v["models"]
                .as_object()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default(),
            inline_key: v["api_key"].as_str().is_some_and(|k| !k.trim().is_empty()),
            key_env: v["key_env"]
                .as_str()
                .or_else(|| v["api_key_env"].as_str())
                .map(str::to_owned),
        })
        .collect()
}

/// Whether the keychain holds the secret. A direct call: the Secret Service answers in milliseconds, and setup runs once.
fn saved(store: &dyn SecretStore, r: &SecretRef) -> bool {
    matches!(store.get(&r.service(), &r.name), Ok(Some(_)))
}

fn credential_form(provider: &str) -> Form {
    let r = SecretRef::provider_key(provider);
    let body = if provider == "openrouter" {
        "A free OpenRouter key is enough: it only unlocks the models OpenRouter lists as free. It is saved in your OS keychain, not in a file, and Hermes reads it from there."
    } else {
        "Models need it to answer. It is saved in your OS keychain, not in a file, and Hermes reads it from there."
    };
    Form::new(
        &format!("setup.credential.{provider}"),
        "credential",
        &format!("Add your {provider} API key"),
        body,
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
    let var = if named {
        Some(r.env_name())
    } else {
        builtin_provider_env(provider)
    };
    let Some(var) = var else {
        return Ok(Vec::new());
    };
    // Hermes runs a secret source only when its section says `enabled: true`
    let mut writes = vec![
        (format!("secrets.{SOURCE}.env.{var}"), r.text()),
        (format!("secrets.{SOURCE}.enabled"), "true".to_owned()),
    ];
    if named {
        writes.insert(0, (format!("providers.{provider}.key_env"), var));
    }
    let mut made = Vec::new();
    for (key, value) in writes {
        let current = ops.config_get(&key).await?;
        let want = if value == "true" {
            json!(true)
        } else {
            json!(value)
        };
        if current.as_ref() != Some(&want) {
            ops.config_set(&key, &value).await?;
            made.push(DiffLine {
                key,
                from: current,
                to: want,
            });
        }
    }
    Ok(made)
}

/// Decide and act. `input.choice` is the user's earlier answer (`""` means skip).
///
/// # Errors
/// Whatever Hermes refuses.
pub async fn run(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    let choice = input.choice;
    let home = ops.home();
    let env = dotenv_names(&home);
    let named = named_providers(ops.config_get("providers").await?.as_ref());
    let anthropic_ref = SecretRef::provider_key("anthropic");
    let claude_key =
        ANTHROPIC_VARS.iter().any(|v| env.iter().any(|e| e == v)) || saved(store, &anthropic_ref);
    let claude = if claude_key {
        if saved(store, &anthropic_ref) && !wire(ops, "anthropic", false).await?.is_empty() {
            *restart = true;
        }
        true
    } else {
        false
    };
    if claude && !input.reopen && choice.is_none_or(|c| c == "anthropic") {
        return Ok(Outcome::Done(
            "Claude ladder: haiku, sonnet, opus on your Anthropic key".into(),
        ));
    }
    if choice == Some("") {
        return Ok(Outcome::Skipped(
            "no model chosen; governed sessions need one (Settings, Models)".into(),
        ));
    }
    if choice.is_none() && !input.reopen && ops.config_get(LADDER_KEY).await?.is_some() {
        return Ok(Outcome::Done("keeps the tier ladder you set".into()));
    }
    match choice {
        None => Ok(Outcome::Form(ladder_form(&named, input.free_note))),
        Some("anthropic") => Ok(Outcome::Form(credential_form("anthropic"))),
        Some(FREE) if FREE_TIER_ENABLED => free_tier(ops, &named, restart).await,
        Some(OPENROUTER_FREE) => openrouter(ops, store, &env, &named, input, restart).await,
        Some(pick) => single_tier(ops, store, &env, &named, pick, restart).await,
    }
}

/// Nous's free tier: ask Hermes (on a link that declares the Desktop) whether it can be used, let Hermes claim it when it
/// can, and write only the governed ladder. Hermes writes the identity itself and no model config: "Never written to
/// config.yaml, so it stops applying the moment the user configures a real model" (`trial_model`).
async fn free_tier(ops: &dyn HermesOps, named: &[Named], restart: &mut bool) -> Result<Outcome> {
    let mut status = ops.free_tier_status().await?;
    if !status.available && status.enabled {
        let claimed = ops.free_tier_provision().await?;
        status = ops.free_tier_status().await?;
        if !status.available {
            status.error = status.error.or(claimed.error);
            status.retry_after = status.retry_after.or(claimed.retry_after);
        }
    }
    if !status.available {
        return Ok(unavailable(named, &unclaimed_note(&status)));
    }
    if status.model.trim().is_empty() {
        return Ok(unavailable(
            named,
            "Hermes reported the free tier as ready but named no model, so no ladder can be set.",
        ));
    }
    // The free tier offers one model, so the ladder is that model at every tier. It is what Hermes reports now, never a
    // name written in this code.
    let model = format!("nous/{}", status.model);
    *restart |= write_ladder(ops, &[("free".to_owned(), model)]).await?;
    Ok(Outcome::Done(format!(
        "Nous free tier ({}): one model at every tier, as the free tier offers one. It is Nous's service under their Terms ({NOUS_TERMS}) and Privacy Policy ({NOUS_PRIVACY})",
        status.model
    )))
}

fn unavailable(named: &[Named], note: &str) -> Outcome {
    Outcome::Unavailable {
        form: ladder_form(named, Some(note)),
        note: note.to_owned(),
    }
}

/// Why the free tier could not be used, in Hermes's terms.
fn unclaimed_note(status: &FreeTier) -> String {
    if !status.enabled {
        return "Hermes offers the free tier only to a first install on this computer, once per user, and only with no model provider or Nous sign-in set up. It found one of those missing here (it does not say which), or guests are switched off.".to_owned();
    }
    let wait = status
        .retry_after
        .filter(|s| *s > 0)
        .map(|s| {
            format!(
                " It suggests trying again in about {} minutes.",
                s.div_ceil(60)
            )
        })
        .unwrap_or_default();
    format!(
        "Hermes could not set up the free tier: {}.{wait}",
        status.error.as_deref().unwrap_or("it gave no reason")
    )
}

/// `OpenRouter`'s free models: the key (a form), then the `:free` rows of Hermes's catalogue to choose from.
async fn openrouter(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    env: &[String],
    named: &[Named],
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    let r = SecretRef::provider_key("openrouter");
    let has_key = env.iter().any(|e| e == "OPENROUTER_API_KEY") || saved(store, &r);
    if !has_key {
        return Ok(Outcome::Form(credential_form("openrouter")));
    }
    if saved(store, &r) && !wire(ops, "openrouter", false).await?.is_empty() {
        *restart = true;
    }
    let catalogue = ops.free_models("openrouter").await?;
    if catalogue.is_empty() {
        return Ok(unavailable(
            named,
            "OpenRouter's catalogue lists no free models right now.",
        ));
    }
    if input.picks.is_empty() {
        return Ok(Outcome::Form(models_form(&catalogue)));
    }
    if let Some(bad) = input.picks.iter().find(|p| !catalogue.contains(p)) {
        return Err(Error::Setup(
            "hx.setup.invalid_answer",
            format!("{bad:?} is not a free OpenRouter model in the catalogue"),
        ));
    }
    let tiers = order_by_size(input.picks);
    let ladder: Vec<(String, String)> = tiers
        .iter()
        .map(|id| (tier_name(id), format!("openrouter/{id}")))
        .collect();
    *restart |= write_ladder(ops, &ladder).await?;
    Ok(Outcome::Done(format!(
        "OpenRouter free models, smallest to largest: {}",
        tiers.join(", ")
    )))
}

/// Write the governed ladder (`tiers`: name and `provider/id`) when it differs from what is there. True when it wrote.
async fn write_ladder(ops: &dyn HermesOps, tiers: &[(String, String)]) -> Result<bool> {
    let ladder = json!({"tiers": tiers.iter().map(|(name, model)| json!({"name": name, "model": model})).collect::<Vec<_>>()});
    if ops.config_get(LADDER_KEY).await?.as_ref() == Some(&ladder) {
        return Ok(false);
    }
    ops.config_set(LADDER_KEY, &ladder.to_string()).await?;
    Ok(true)
}

/// The parameter count a model id states (`70b`, `1.5b`), the largest when it states several. Read from the id, because the
/// catalogue carries no size: a model that states none has none here (unknown stays unknown).
#[must_use]
pub fn size_hint(id: &str) -> Option<f64> {
    let b = id.as_bytes();
    let mut best: Option<f64> = None;
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_digit() && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let start = i;
            while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'.') {
                i += 1;
            }
            let ends = i < b.len()
                && b[i].eq_ignore_ascii_case(&b'b')
                && (i + 1 == b.len() || !b[i + 1].is_ascii_alphanumeric());
            if ends && let Ok(n) = id[start..i].parse::<f64>() {
                best = Some(best.map_or(n, |m| m.max(n)));
            }
        } else {
            i += 1;
        }
    }
    best
}

/// `ids` smallest to largest by the size each states; those that state none come last, in the order given.
#[must_use]
pub fn order_by_size(ids: &[String]) -> Vec<String> {
    let mut sized: Vec<(f64, &String)> = ids
        .iter()
        .filter_map(|i| size_hint(i).map(|n| (n, i)))
        .collect();
    sized.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    let mut out: Vec<String> = sized.into_iter().map(|(_, i)| i.clone()).collect();
    out.extend(ids.iter().filter(|i| size_hint(i).is_none()).cloned());
    out
}

/// A ladder proposed from a catalogue: up to three of the models that state a size (smallest, middle, largest). Nothing
/// when no model states one: nothing can be ordered, so nothing is proposed.
#[must_use]
pub fn propose_ladder(catalogue: &[String]) -> Vec<String> {
    let sized: Vec<String> = order_by_size(catalogue)
        .into_iter()
        .filter(|i| size_hint(i).is_some())
        .collect();
    let n = sized.len();
    let at: Vec<usize> = match n {
        0 => Vec::new(),
        1..=PROPOSED_TIERS => (0..n).collect(),
        _ => vec![0, n / 2, n - 1],
    };
    at.into_iter().map(|i| sized[i].clone()).collect()
}

/// A tier's name: the model's own name without its vendor and `:free` tag.
fn tier_name(id: &str) -> String {
    let base = id.rsplit('/').next().unwrap_or(id);
    base.strip_suffix(":free").unwrap_or(base).to_owned()
}

fn models_form(catalogue: &[String]) -> Form {
    let ordered = order_by_size(catalogue);
    Form::new(
        "setup.openrouter",
        "choice",
        "Which free models should do the work?",
        "These are the models OpenRouter lists as free right now. Governed work starts on the smallest you pick and moves up only when a gate fails, so pick one or more. The proposal spreads small, middle and large by the size each model's name states; models that state none are listed last and not proposed.",
        json!({"type": "object", "required": ["picks"], "properties": {
            "picks": {"type": "string", "title": "Free models", "x-multi": true, "enum": ordered,
                "enumNames": ordered, "default": propose_ladder(catalogue)}}}),
    )
}

fn ladder_form(named: &[Named], free_note: Option<&str>) -> Form {
    let mut ids = Vec::new();
    let mut labels = Vec::new();
    let offer_free = FREE_TIER_ENABLED && free_note.is_none();
    if offer_free {
        ids.push(FREE.to_owned());
        labels.push("Free models (Nous free tier, no account)".to_owned());
    }
    ids.push(OPENROUTER_FREE.to_owned());
    labels.push("OpenRouter free models (needs a free OpenRouter key)".to_owned());
    ids.push("anthropic".to_owned());
    labels.push("Claude: haiku, sonnet, opus (needs an Anthropic API key)".to_owned());
    for p in named {
        for m in &p.models {
            ids.push(format!("{}/{m}", p.name));
            labels.push(format!("{m} on {}", p.name));
        }
    }
    let mut body = String::from(
        "hypotaxis runs governed work on a ladder of models, cheapest first. Pick where to start; you can change the ladder later.",
    );
    if offer_free {
        let _ = write!(
            body,
            "\n\nFree models need no account and no key: Hermes uses Nous Research's free tier, which offers one model, so every step of the ladder uses it. That is Nous's service under their Terms of Service ({NOUS_TERMS}) and Privacy Policy ({NOUS_PRIVACY}); Hermes decides who may use it (once per user on a computer, so this also uses it up for Hermes's own app) and says so if it is not available to you."
        );
    }
    if let Some(note) = free_note {
        let _ = write!(body, "\n\nThe free tier is not available: {note}");
    }
    let default = ids[0].clone();
    Form::new(
        "setup.ladder",
        "choice",
        "Which model should do the work?",
        &body,
        json!({"type": "object", "required": ["choice"], "properties": {
            "choice": {"type": "string", "title": "Model", "enum": ids, "enumNames": labels, "default": default}}}),
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
    let Some(p) = named
        .iter()
        .find(|p| p.name == provider && p.models.iter().any(|m| m == model))
    else {
        return Err(crate::error::Error::Setup(
            "hx.setup.invalid_answer",
            format!("{pick:?} is not a model Hermes has configured"),
        ));
    };
    let r = SecretRef::provider_key(provider);
    let has_key = p.inline_key
        || p.key_env
            .as_deref()
            .is_some_and(|k| env.iter().any(|e| e == k))
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
    plugins
        .iter()
        .any(|p| p.name == SUBSCRIPTION_PLUGIN && p.enabled)
}
