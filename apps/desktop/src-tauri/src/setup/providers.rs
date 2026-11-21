//! Setup's last decision: which models run, and whether their keys or sign-ins are in place. It reads what the engine
//! already has (named `providers:`, keys in `.env` by name, the bundled Claude subscription plugin), asks for what is
//! missing through forms, saves a key to the host's keychain and ties it to its provider with the same two config writes
//! the plugin makes for a credential form (`plugins/boopis/forms/effects.py`): `providers.<name>.key_env` and
//! `secrets.boopis_host.env`. The subscriptions sign in through boopis's own flows (ADR-0030): Claude Code's own
//! `claude auth login` for Claude, the host's ChatGPT sign-in (`crate::chatgpt`) for ChatGPT.

use std::fmt::Write as _;
use std::path::Path;

use serde_json::{Value, json};

use super::ops::HermesOps;
use super::state::Optins;
use super::{DiffLine, Form};
use crate::claude::{self, ClaudeCli, INSTALL_COMMAND, PROVIDER_ID, Probe, State};
use crate::commands::Json;
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
/// The choice that runs on the user's Claude subscription, through Hermes's official plugin and their own Claude Code (ADR-0029).
pub const CLAUDE_SUBSCRIPTION: &str = "claude-subscription";
/// What the choice is called.
const CLAUDE_SUBSCRIPTION_LABEL: &str = "Claude subscription (your Claude Code login)";
/// The choice that runs on the user's ChatGPT subscription, signed in through boopis's own ChatGPT sign-in (ADR-0030).
pub const CHATGPT_SUBSCRIPTION: &str = "chatgpt-subscription";
const CHATGPT_SUBSCRIPTION_LABEL: &str = "ChatGPT subscription (sign in with your ChatGPT account)";
/// The engine's provider for a ChatGPT sign-in (OpenAI's Codex models on chatgpt.com).
pub const CHATGPT_PROVIDER: &str = "openai-codex";
/// The ChatGPT and OpenAI ladder, cheapest first (ADR-0037): `(family id in the frontier list, tier name)`. Each rung is the
/// lowest model of that family the signed-in account's own catalogue lists (Sol is cheaper per task than Astra and scores below
/// it, so a failed gate climbs from one to the other). Astra and Sol are account-gated, so the engine's offline list omits them
/// and a plan with neither has no governed ladder. It replaces `luna` and `sol` (`LEGACY_CHATGPT`), which are not frontier.
pub const CHATGPT_RUNGS: &[(&str, &str)] = &[("gpt-sol", "sol"), ("gpt-astra", "astra")];
/// The choice that uses Gemini with a free Google AI Studio key.
pub const GEMINI: &str = "gemini";
const GEMINI_LABEL: &str = "Gemini (a free API key from Google AI Studio)";
/// Where a Gemini key is made.
pub const GEMINI_KEY_URL: &str = "https://aistudio.google.com/apikey";
/// The variables the engine's Gemini provider reads a key from (`plugins/model-providers/gemini`), in its order.
const GEMINI_VARS: &[&str] = &["GOOGLE_API_KEY", "GEMINI_API_KEY"];
/// The Gemini ladder, cheapest first (ADR-0037): Hydrogen, then Neon, each only when the engine's Gemini catalogue lists it. Whether
/// a given key may use a model is Google's decision and nothing the engine reports; a refusal at run time is said plainly. Gemini 4
/// Carbon stays allowed but is not on this ladder: it scored below Neon (72.6 against 76.2) at a higher cost ($5.19 against $4.38 a
/// task, Ramp's SWE-Bench v2), so nothing setup writes climbs to it. It replaces `flash` and `pro` (`LEGACY_GEMINI`), which are not
/// frontier.
pub const GEMINI_RUNGS: &[(&str, &str)] =
    &[("gemini-hydrogen", "hydrogen"), ("gemini-neon", "neon")];
/// The choice that uses an xAI key. Grok 4.7 and later is frontier but heavy (ADR-0037), so this choice writes a governed
/// ladder only once the user turned Grok on (Settings > Models).
pub const XAI: &str = "xai";
const XAI_LABEL: &str =
    "xAI Grok (needs an xAI API key; governed mode only after you turn on Grok, a heavy model)";
/// The variable the engine's xAI provider reads a key from.
const XAI_VARS: &[&str] = &["XAI_API_KEY"];
/// The family id of Grok in the frontier list, and the tier setup names it.
const GROK_FAMILY: &str = "grok";
/// Claude on an Anthropic key: the provider, and the models the plugin's own ladder names (the vendored contraprova's `OPUS` and
/// `FABLE`; a test holds them frontier). Opus is the default ladder; Fable is a heavy opt-in.
pub const ANTHROPIC: &str = "anthropic";
pub(crate) const ANTHROPIC_OPUS: &str = "claude-opus-5-5";
pub(crate) const ANTHROPIC_FABLE: &str = "claude-fable-5-2";
/// What setup wrote before ADR-0037, to recognise a ladder setup itself wrote (and so may repair).
const LEGACY_CHATGPT: &[(&str, &str)] = &[
    ("luna", "openai-codex/gpt-6-luna"),
    ("sol", "openai-codex/gpt-6-sol"),
];
const LEGACY_GEMINI: &[(&str, &str)] = &[
    ("flash", "gemini/gemini-3.8-flash"),
    ("pro", "gemini/gemini-3.1-pro-preview"),
];
/// The 0.1.6 candidate's one-tier ladders (Astra alone for ChatGPT, Carbon alone for Gemini), written before Sol, Neon and
/// Hydrogen joined the list. Setup wrote them too, so the once-per-install repair may rewrite them.
const CANDIDATE_GEMINI: &[(&str, &str)] = &[("carbon", "gemini/gemini-4-carbon")];
/// The Claude subscription's aliases setup wrote before ADR-0037 (a prefix of these, each named as its alias).
const LEGACY_CLAUDE_ALIASES: &[&str] = &["haiku", "sonnet", "opus"];
pub(crate) const LADDER_KEY: &str = "plugins.entries.boopis.settings.ladder";
/// One tier of the governed ladder, as Hermes's configuration holds it (`{name, model: "provider/id"}`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct LadderTier {
    /// The tier's name (`haiku`, `free`).
    pub name: String,
    /// The model it runs, `provider/id`.
    pub model: String,
}

/// Where the ladder stands in the configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LadderState {
    /// None is saved: the plugin uses its built-in Claude ladder.
    Default,
    /// A ladder is saved and its tiers are listed, cheapest first.
    Set,
    /// Something is saved that does not read as a list of named tiers; nothing is listed and nothing is guessed.
    Unreadable,
}

/// The ladder `plugins.entries.boopis.settings.ladder` holds, as a list of tiers (what setup writes, or what the user did).
#[must_use]
pub fn ladder_of(value: Option<&Value>) -> (LadderState, Vec<LadderTier>) {
    let Some(v) = value else {
        return (LadderState::Default, Vec::new());
    };
    let tiers: Option<Vec<LadderTier>> = v["tiers"].as_array().and_then(|a| {
        a.iter()
            .map(|t| {
                Some(LadderTier {
                    name: t["name"].as_str()?.to_owned(),
                    model: t["model"].as_str()?.to_owned(),
                })
            })
            .collect()
    });
    match tiers {
        Some(t) if !t.is_empty() => (LadderState::Set, t),
        _ => (LadderState::Unreadable, Vec::new()),
    }
}

/// One tier of the saved ladder with whether governed mode may use it (ADR-0037).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TierCheck {
    /// The tier's name.
    pub name: String,
    /// The model it runs, `provider/id`.
    pub model: String,
    /// Whether it is a frontier model.
    pub frontier: bool,
    /// Whether it is a heavy one (Claude Fable, Grok 4.7 and later): on the ladder because the user put it there.
    pub heavy: bool,
}

/// Whether governed mode can run with what is saved, and the models it allows.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct GovernedView {
    /// The allowed models, one per family (`Claude Opus 5.5`); each also qualifies in any later version.
    pub allowed: Vec<String>,
    /// The heavy ones among them, which no automatic ladder includes: they run only when the user asked for them.
    pub heavy: Vec<String>,
    /// The allowed models as one sentence.
    pub sentence: String,
    /// The saved ladder's tiers, each marked; empty unless the ladder is saved.
    pub tiers: Vec<TierCheck>,
    /// Whether governed mode can run: every saved tier is frontier, or no ladder is saved and an Anthropic key is in place
    /// (the plugin's own ladder is Opus alone).
    pub available: bool,
    /// Why not, in one plain sentence; `None` when it can.
    pub why: Option<String>,
}

/// Whether an Anthropic key is in place: by name in the profile's `.env`, or in the keychain.
#[must_use]
pub fn anthropic_key(store: &dyn SecretStore, home: &Path) -> bool {
    let env = dotenv_names(home);
    ANTHROPIC_VARS.iter().any(|v| env.iter().any(|e| e == v))
        || saved(store, &SecretRef::provider_key("anthropic"))
}

/// Which keys are in place (the profile's `.env` by name, or the keychain).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Keys {
    /// An Anthropic key.
    pub anthropic: bool,
    /// An xAI key.
    pub xai: bool,
}

/// Whether an xAI key is in place: by name in the profile's `.env`, or in the keychain.
#[must_use]
pub fn xai_key(store: &dyn SecretStore, home: &Path) -> bool {
    let env = dotenv_names(home);
    XAI_VARS.iter().any(|v| env.iter().any(|e| e == v))
        || saved(store, &SecretRef::provider_key(XAI))
}

/// One heavy model's opt-in (Settings > Models, the governed section): a model that is frontier but token-heavy or costly, so
/// governed mode runs it only when the user turned it on (ADR-0037). The data file marks the family heavy; this is what the user
/// can do about it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct HeavyChoice {
    /// `fable` or `grok`: what `setup_set_heavy` takes.
    pub id: String,
    /// The switch's label: `Climb to Fable`.
    pub label: String,
    /// Why it is off by default, in the user's terms.
    pub reason: String,
    /// The saved ladder is one this model can join, so the choice means something.
    pub applies: bool,
    /// The model is on the saved ladder now.
    pub on: bool,
    /// Why it cannot be turned on right now (an old Claude Code), or `None`.
    pub blocked: Option<String>,
}

/// What a heavy model is called, which family it is and why it is off by default.
struct HeavyKind {
    id: &'static str,
    family: &'static str,
    label: &'static str,
    reason: &'static str,
}

const HEAVY: &[HeavyKind] = &[
    HeavyKind {
        id: "fable",
        family: "claude-fable",
        label: "Climb to Fable",
        reason: "Fable is token-heavy: Ramp's benchmark measured $3.79 a task against Opus's $1.53, and on a Claude Pro plan it bills usage credits from the first request. So boopis never adds it by itself. Off: governed work stays on Opus, and a failed gate retries there. On: Fable is the top tier, and a failed gate climbs to it.",
    },
    HeavyKind {
        id: "grok",
        family: GROK_FAMILY,
        label: "Use Grok",
        reason: "Grok 4.7 is token-heavy: Ramp's benchmark measured it at $4.32 a task, with the most tool calls of any model (161 a task). So boopis never adds it by itself. Off: boopis does not run governed work on it. On: Grok is the top tier of the ladder.",
    },
];

/// How a saved ladder reaches Claude, which says what Fable's tier would be called.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ClaudeRoute {
    Subscription,
    ApiKey,
}

fn all_on(tiers: &[LadderTier], provider: &str) -> bool {
    !tiers.is_empty()
        && tiers
            .iter()
            .all(|t| crate::frontier::split(&t.model).0 == provider)
}

fn claude_route(state: LadderState, tiers: &[LadderTier], keys: Keys) -> Option<ClaudeRoute> {
    match state {
        LadderState::Set if all_on(tiers, PROVIDER_ID) => Some(ClaudeRoute::Subscription),
        LadderState::Set if all_on(tiers, ANTHROPIC) => Some(ClaudeRoute::ApiKey),
        LadderState::Default if keys.anthropic => Some(ClaudeRoute::ApiKey),
        _ => None,
    }
}

fn grok_applies(state: LadderState, tiers: &[LadderTier], keys: Keys) -> bool {
    keys.xai && (state == LadderState::Default || (state == LadderState::Set && all_on(tiers, XAI)))
}

/// The tiers the saved ladder holds now, where an unset ladder is the plugin's own default (Opus on an Anthropic key, else none).
fn current_tiers(state: LadderState, tiers: &[LadderTier], keys: Keys) -> Vec<LadderTier> {
    match state {
        LadderState::Set => tiers.to_vec(),
        LadderState::Default if keys.anthropic => vec![LadderTier {
            name: "opus".to_owned(),
            model: format!("{ANTHROPIC}/{ANTHROPIC_OPUS}"),
        }],
        _ => Vec::new(),
    }
}

fn holds(tiers: &[LadderTier], family: &str) -> bool {
    tiers.iter().any(|t| {
        let (p, id) = crate::frontier::split(&t.model);
        crate::frontier::is_heavy(p, id)
            && crate::frontier::family_of(p, id).as_deref() == Some(family)
    })
}

/// The heavy models' opt-ins as Settings > Models shows them: whether each applies to the saved ladder, is on, and can be turned on.
#[must_use]
pub fn heavy_choices(
    state: LadderState,
    tiers: &[LadderTier],
    probe: &Probe,
    keys: Keys,
) -> Vec<HeavyChoice> {
    let route = claude_route(state, tiers, keys);
    HEAVY
        .iter()
        .map(|k| {
            let applies = if k.id == "fable" {
                route.is_some()
            } else {
                grok_applies(state, tiers, keys)
            };
            let on = applies && holds(tiers, k.family);
            let blocked = (applies
                && !on
                && k.id == "fable"
                && route == Some(ClaudeRoute::Subscription)
                && !probe.aliases.iter().any(|a| a == claude::FABLE))
            .then(|| "Your Claude Code does not serve Fable yet (it needs 2.1.321). Update it with `claude update`.".to_owned());
            HeavyChoice {
                id: k.id.to_owned(),
                label: k.label.to_owned(),
                reason: k.reason.to_owned(),
                applies,
                on,
                blocked,
            }
        })
        .collect()
}

/// Turn a heavy model on or off for the saved ladder (the user's choice, Settings > Models): on adds it as the top tier, off takes
/// it away; a ladder it leaves empty is unset. Only a ladder the model can join changes. For Grok the tier is the lowest Grok 4.7
/// or later the xAI account's own catalogue lists. Takes effect for sessions started afterwards.
///
/// # Errors
/// `hx.setup.invalid_answer` for an id that is not a heavy model; `hx.setup.subscription_unavailable` when the saved ladder is
/// not one it can join, Claude Code does not serve Fable or the xAI catalogue lists no Grok; whatever Hermes refuses.
pub async fn set_heavy(
    ops: &dyn HermesOps,
    probe: &Probe,
    keys: Keys,
    id: &str,
    on: bool,
) -> Result<()> {
    let Some(kind) = HEAVY.iter().find(|k| k.id == id) else {
        return Err(Error::Setup(
            "hx.setup.invalid_answer",
            format!("{id:?} is not a heavy model"),
        ));
    };
    let (state, saved_tiers) = ladder_of(ops.config_get(LADDER_KEY).await?.as_ref());
    let choice = heavy_choices(state, &saved_tiers, probe, keys)
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| Error::Setup("hx.setup.invalid_answer", "no such choice".into()))?;
    if !choice.applies {
        return Err(Error::Setup(
            "hx.setup.subscription_unavailable",
            if id == "fable" {
                "The saved ladder is not a Claude one, so there is no Fable choice to make. Change models sets that up.".into()
            } else {
                "There is no xAI key, or the saved ladder is not an xAI one, so there is no Grok choice to make. Change models sets that up.".into()
            },
        ));
    }
    if !on && !choice.on {
        return Ok(()); // already off: nothing to take away
    }
    let mut tiers = current_tiers(state, &saved_tiers, keys);
    if on {
        if let Some(why) = choice.blocked {
            return Err(Error::Setup("hx.setup.subscription_unavailable", why));
        }
        if !choice.on {
            tiers.push(heavy_tier(ops, kind, state, &saved_tiers, keys).await?);
        }
    } else {
        tiers.retain(|t| {
            let (p, m) = crate::frontier::split(&t.model);
            !(crate::frontier::is_heavy(p, m)
                && crate::frontier::family_of(p, m).as_deref() == Some(kind.family))
        });
    }
    if tiers.is_empty() {
        // An xAI ladder of Grok alone: with Grok off nothing is left to run, so none is saved and governed mode says why. Any other
        // ladder is never left empty.
        if kind.id == "grok" && state == LadderState::Set {
            ops.config_unset(LADDER_KEY).await?;
        }
        return Ok(());
    }
    let pairs: Vec<(String, String)> = tiers.into_iter().map(|t| (t.name, t.model)).collect();
    if current_tiers(state, &saved_tiers, keys).is_empty() {
        write_route(ops, &pairs).await?; // the first tier of a new ladder is also the engine's default model
    } else {
        write_ladder(ops, &pairs).await?;
    }
    Ok(())
}

/// The tier a heavy model adds: Fable is the Claude route's own alias or the Anthropic model, Grok the lowest the xAI catalogue lists.
async fn heavy_tier(
    ops: &dyn HermesOps,
    kind: &HeavyKind,
    state: LadderState,
    saved_tiers: &[LadderTier],
    keys: Keys,
) -> Result<LadderTier> {
    let model = if kind.id == "fable" {
        match claude_route(state, saved_tiers, keys) {
            Some(ClaudeRoute::Subscription) => format!("{PROVIDER_ID}/{}", claude::FABLE),
            _ => format!("{ANTHROPIC}/{ANTHROPIC_FABLE}"),
        }
    } else {
        let catalogue = ops.provider_models(XAI).await?;
        let id = lowest_in_family(XAI, kind.family, &catalogue, true).ok_or_else(|| {
            Error::Setup(
                "hx.setup.subscription_unavailable",
                "Your xAI key lists no Grok 4.7 or later, so there is nothing to turn on.".into(),
            )
        })?;
        format!("{XAI}/{id}")
    };
    Ok(LadderTier {
        name: kind.id.to_owned(),
        model,
    })
}

/// What governed mode can do with the saved ladder.
#[must_use]
pub fn governed_view(state: LadderState, tiers: &[LadderTier], keys: Keys) -> GovernedView {
    let checks: Vec<TierCheck> = tiers
        .iter()
        .map(|t| {
            let (p, id) = crate::frontier::split(&t.model);
            TierCheck {
                name: t.name.clone(),
                model: t.model.clone(),
                frontier: crate::frontier::is_frontier(p, id),
                heavy: crate::frontier::is_heavy(p, id),
            }
        })
        .collect();
    let why = match state {
        LadderState::Set => non_frontier(tiers).into_iter().next(),
        LadderState::Default if !keys.anthropic && keys.xai => Some(
            "no ladder is saved, and the only frontier model an xAI key reaches is Grok 4.7 or later, a heavy model that governed mode runs only when you turn it on. Turn on Grok below".to_owned(),
        ),
        LadderState::Default if !keys.anthropic => Some(format!(
            "no ladder is saved, and boopis's own ladder runs on Claude through an Anthropic key, which is not set up; governed mode runs only on {}",
            crate::frontier::allowed_sentence()
        )),
        LadderState::Default => None,
        LadderState::Unreadable => Some(
            "the saved ladder does not read as a list of named tiers, so governed mode cannot use it".to_owned(),
        ),
    };
    GovernedView {
        allowed: crate::frontier::allowed(),
        heavy: crate::frontier::heavy_families(),
        sentence: crate::frontier::allowed_sentence(),
        tiers: checks,
        available: why.is_none(),
        why,
    }
}

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
pub struct Input<'a> {
    /// The user's earlier answer (`""` means skip, `None` means not asked).
    pub choice: Option<&'a str>,
    /// The models picked from a catalogue.
    pub picks: &'a [String],
    /// Why the free tier is not offered here, once Hermes said so.
    pub free_note: Option<&'a str>,
    /// The user asked to choose again.
    pub reopen: bool,
    /// The user's Claude Code, looked at when the Claude subscription is offered or chosen.
    pub claude: &'a dyn ClaudeCli,
    /// A ChatGPT account is signed in through boopis's own sign-in (both tokens are in the keychain).
    pub chatgpt_signed_in: bool,
    /// The heavy models the user turned on (Settings > Models): only these may be on a ladder setup writes.
    pub optins: Optins,
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

/// Whether a Gemini key is in place: in the keychain, or by name in the profile's `.env`.
#[must_use]
pub fn gemini_key(store: &dyn SecretStore, home: &Path) -> bool {
    let env = dotenv_names(home);
    GEMINI_VARS.iter().any(|v| env.iter().any(|e| e == v))
        || saved(store, &SecretRef::provider_key(GEMINI))
}

/// Whether the keychain holds the secret. A direct call: the Secret Service answers in milliseconds, and setup runs once.
fn saved(store: &dyn SecretStore, r: &SecretRef) -> bool {
    matches!(store.get(&r.service(), &r.name), Ok(Some(_)))
}

fn credential_form(provider: &str) -> Form {
    let r = SecretRef::provider_key(provider);
    let kept = "It is saved in your OS keychain, not in a file, and boopis hands it to the models from there.";
    let (name, body) = match provider {
        "openrouter" => (
            "OpenRouter",
            format!(
                "A free OpenRouter key is enough: it only unlocks the models OpenRouter lists as free. {kept}"
            ),
        ),
        "anthropic" => ("Anthropic", format!("Models need it to answer. {kept}")),
        XAI => ("xAI", format!("Grok needs it to answer. {kept}")),
        GEMINI => (
            "Gemini",
            format!(
                "A Gemini key is free. Open {GEMINI_KEY_URL}, sign in with your Google account and choose Create API key, then paste it here. Google sets the free key's daily limits. {kept}"
            ),
        ),
        other => (other, format!("Models need it to answer. {kept}")),
    };
    let mut form = Form::new(
        &format!("setup.credential.{provider}"),
        "credential",
        &format!("Add your {name} API key"),
        &body,
        json!({"type": "object", "required": ["value"], "properties": {
            "value": {"type": "string", "title": "API key", "x-secret": true, "x-secret-ref": r.text()}}}),
    );
    if provider == GEMINI {
        form.links = vec![("Get a free key".into(), GEMINI_KEY_URL.into())];
    }
    form
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
            "Claude ladder: Opus 5.5 on your Anthropic key (governed mode runs only on frontier models). Fable is a heavy model: turn it on in Settings, Models to climb to it".into(),
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
        None => Ok(Outcome::Form(ladder_form(
            &named,
            input.free_note,
            &input.claude.probe().await,
        ))),
        Some("anthropic") => Ok(Outcome::Form(credential_form("anthropic"))),
        Some(FREE) if FREE_TIER_ENABLED => free_tier(ops, &named, input.claude, restart).await,
        Some(OPENROUTER_FREE) => openrouter(ops, store, &env, &named, input, restart).await,
        Some(CLAUDE_SUBSCRIPTION) => subscription(ops, input, restart).await,
        Some(CHATGPT_SUBSCRIPTION) => chatgpt(ops, input, restart).await,
        Some(GEMINI) => gemini(ops, store, &env, restart).await,
        Some(XAI) => xai(ops, store, &env, input, restart).await,
        Some(pick) => single_tier(ops, store, &env, &named, pick, restart).await,
    }
}

/// Nous's free tier: ask Hermes (on a link that declares the Desktop) whether it can be used, let Hermes claim it when it
/// can, and write only the governed ladder. Hermes writes the identity itself and no model config: "Never written to
/// config.yaml, so it stops applying the moment the user configures a real model" (`trial_model`).
async fn free_tier(
    ops: &dyn HermesOps,
    named: &[Named],
    claude: &dyn ClaudeCli,
    restart: &mut bool,
) -> Result<Outcome> {
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
        return Ok(unavailable(named, &unclaimed_note(&status), claude).await);
    }
    if status.model.trim().is_empty() {
        return Ok(unavailable(
            named,
            "The free tier reported itself ready but named no model, so no ladder can be set.",
            claude,
        )
        .await);
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

async fn unavailable(named: &[Named], note: &str, claude: &dyn ClaudeCli) -> Outcome {
    Outcome::Unavailable {
        form: ladder_form(named, Some(note), &claude.probe().await),
        note: note.to_owned(),
    }
}

/// Why the free tier could not be used, in Hermes's terms.
fn unclaimed_note(status: &FreeTier) -> String {
    if !status.enabled {
        return "The free tier is offered only to a first install on this computer, once per user, and only with no model provider or Nous sign-in set up. One of those is not the case here (the engine does not say which), or guests are switched off.".to_owned();
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
        "boopis could not set up the free tier: {}.{wait}",
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
            input.claude,
        )
        .await);
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
    *restart |= write_route(ops, &ladder).await?;
    Ok(Outcome::Done(format!(
        "OpenRouter free models, smallest to largest: {}",
        tiers.join(", ")
    )))
}

/// Write the ladder and the engine's own default model, its first (cheapest) tier: `model.provider` and `model.default`.
/// A session freezes the engine's default model when it is created; with none in the config it froze `None`, which the
/// engine then refused to read back on the first message ("invalid policy", answered as `storage_unavailable`: the
/// owner's report, 20 November 2026). Every choice but the free tier, whose claim the engine routes itself. True when
/// it wrote anything.
async fn write_route(ops: &dyn HermesOps, tiers: &[(String, String)]) -> Result<bool> {
    let mut wrote = write_ladder(ops, tiers).await?;
    if let Some((_, first)) = tiers.first() {
        wrote |= write_default_model(ops, first).await?;
    }
    Ok(wrote)
}

/// Set `model.provider` and `model.default` to a tier's `provider/id` (the id may hold more slashes), each only when it
/// differs. True when it wrote.
async fn write_default_model(ops: &dyn HermesOps, tier: &str) -> Result<bool> {
    let Some((provider, id)) = tier
        .split_once('/')
        .filter(|(p, i)| !p.is_empty() && !i.is_empty())
    else {
        return Ok(false);
    };
    let mut wrote = false;
    for (key, want) in [("model.provider", provider), ("model.default", id)] {
        if ops.config_get(key).await?.as_ref().and_then(Value::as_str) == Some(want) {
            continue;
        }
        ops.config_set(key, want).await?;
        wrote = true;
    }
    Ok(wrote)
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

fn ladder_form(named: &[Named], free_note: Option<&str>, claude: &Probe) -> Form {
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
    labels.push("Claude: Opus (needs an Anthropic API key)".to_owned());
    // beside the other Claude choice and after the free ones, which stay first and the default (ADR-0027)
    ids.push(CLAUDE_SUBSCRIPTION.to_owned());
    labels.push(CLAUDE_SUBSCRIPTION_LABEL.to_owned());
    ids.push(CHATGPT_SUBSCRIPTION.to_owned());
    labels.push(CHATGPT_SUBSCRIPTION_LABEL.to_owned());
    ids.push(GEMINI.to_owned());
    labels.push(GEMINI_LABEL.to_owned());
    ids.push(XAI.to_owned());
    labels.push(XAI_LABEL.to_owned());
    for p in named {
        for m in &p.models {
            ids.push(format!("{}/{m}", p.name));
            labels.push(format!("{m} on {}", p.name));
        }
    }
    let mut body = format!(
        "boopis runs governed work on a ladder of models, cheapest first, and only on frontier models: {}. Free models and the other choices work for sessions that are not governed; governed mode stays unavailable until a frontier model is set up. Pick where to start; you can change the ladder later.",
        crate::frontier::allowed_sentence()
    );
    if offer_free {
        let _ = write!(
            body,
            "\n\nFree models need no account and no key: boopis uses Nous Research's free tier, which offers one model, so every step of the ladder uses it. That is Nous's service under their Terms of Service ({NOUS_TERMS}) and Privacy Policy ({NOUS_PRIVACY}); Nous decides who may use it (once per user on a computer, so this also uses it up for Nous Research's own desktop app) and boopis says so if it is not available to you."
        );
    }
    if let Some(note) = free_note {
        let _ = write!(body, "\n\nThe free tier is not available: {note}");
    }
    if claude.usable() {
        let _ = write!(
            body,
            "\n\nClaude subscription: {} It runs on your own Claude Code login; boopis never sees your Claude login.",
            claude.detail
        );
    } else {
        let _ = write!(body, "\n\nClaude subscription: {}", claude.detail);
    }
    let _ = write!(
        body,
        "\n\nChatGPT subscription: you sign in with your ChatGPT account on OpenAI's own page, and boopis keeps the sign-in in your OS keychain. Gemini: a free key from Google AI Studio. xAI: an API key from xAI."
    );
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

/// What the once-per-install frontier repair did (ADR-0037).
#[derive(Debug, PartialEq, Eq)]
pub enum Repair {
    /// The saved ladder is frontier, or there is none: nothing to do.
    Nothing,
    /// A ladder setup itself wrote was rewritten; the line says what it is now.
    Rewrote(String),
    /// The ladder has tiers governed mode will not use and setup could not (or may not) change it: the line names them.
    Report(String),
}

/// The tiers of a saved ladder that are not frontier, one clause each (`tier 'haiku' runs a/b, which is not one: ...`).
#[must_use]
pub fn non_frontier(tiers: &[LadderTier]) -> Vec<String> {
    tiers
        .iter()
        .filter_map(|t| {
            let (provider, id) = crate::frontier::split(&t.model);
            (!crate::frontier::is_frontier(provider, id)).then(|| {
                format!(
                    "tier '{}' runs {}, which is not a frontier model: {}",
                    t.name,
                    t.model,
                    crate::frontier::why_not(provider, id)
                )
            })
        })
        .collect()
}

/// Whether a saved ladder is exactly what an earlier setup wrote for the Claude subscription, the ChatGPT subscription or
/// Gemini, in 0.1.5 or in the 0.1.6 candidate. Anything else (a hand-written ladder, a configured model, the free choices) is
/// not ours to rewrite.
pub(crate) fn written_by_setup(tiers: &[LadderTier]) -> bool {
    let pairs: Vec<(&str, &str)> = tiers
        .iter()
        .map(|t| (t.name.as_str(), t.model.as_str()))
        .collect();
    // the Claude subscription's ladder: the aliases the version served, each named as its alias (and `fable`, which the
    // candidate wrote on its own before it became an opt-in)
    let claude = !tiers.is_empty()
        && pairs.iter().all(|(n, m)| {
            (LEGACY_CLAUDE_ALIASES.contains(n) || *n == claude::FABLE)
                && *m == format!("{PROVIDER_ID}/{n}")
        });
    claude
        || pairs == LEGACY_CHATGPT
        || pairs == LEGACY_GEMINI
        || pairs == CANDIDATE_GEMINI
        || candidate_chatgpt(tiers)
}

/// The candidate's ChatGPT ladder: one tier named `astra` on a GPT Astra.
fn candidate_chatgpt(tiers: &[LadderTier]) -> bool {
    matches!(tiers, [t] if t.name == "astra" && {
        let (p, id) = crate::frontier::split(&t.model);
        p == CHATGPT_PROVIDER && crate::frontier::family_of(p, id).as_deref() == Some("gpt-astra")
    })
}

/// Whether a ladder setup wrote needs to be written again (ADR-0037, the once-per-install repair): it has tiers governed mode will
/// not use, a heavy tier the user did not opt in to, or it is the candidate's one-tier ChatGPT or Gemini ladder, which the new
/// ladders replace. Cheap: it asks nothing of the engine.
pub(crate) fn stale(tiers: &[LadderTier], optins: Optins) -> bool {
    if !written_by_setup(tiers) {
        return false;
    }
    let heavy_unasked = tiers.iter().any(|t| {
        let (p, id) = crate::frontier::split(&t.model);
        crate::frontier::is_heavy(p, id) && !optins.fable
    });
    !non_frontier(tiers).is_empty()
        || heavy_unasked
        || candidate_chatgpt(tiers)
        || tiers
            .iter()
            .map(|t| (t.name.as_str(), t.model.as_str()))
            .collect::<Vec<_>>()
            == CANDIDATE_GEMINI
}

/// Once per install: a ladder that setup wrote and that has tiers governed mode will not use, a heavy tier nobody opted in to, or
/// the candidate's one-tier ChatGPT and Gemini ladders is rewritten to what setup writes now, the way the engine's default model
/// was repaired (`route_missing`). A ladder the user wrote by hand is never rewritten, and neither is one that names a heavy model
/// the user chose: its non-frontier tiers are reported. A ladder that cannot be rewritten (a ChatGPT plan with neither Sol nor
/// Astra, a missing Claude Code) is reported when it is unusable, and left alone when it is still frontier.
///
/// # Errors
/// Whatever Hermes refuses.
pub async fn repair(
    ops: &dyn HermesOps,
    claude: &dyn ClaudeCli,
    optins: Optins,
    restart: &mut bool,
) -> Result<Repair> {
    let (state, tiers) = ladder_of(ops.config_get(LADDER_KEY).await?.as_ref());
    if state != LadderState::Set {
        return Ok(Repair::Nothing);
    }
    let bad = non_frontier(&tiers);
    if bad.is_empty() && !stale(&tiers, optins) {
        return Ok(Repair::Nothing);
    }
    let report = |why: &str| {
        Repair::Report(format!(
            "governed mode is unavailable on the tier ladder you set: {}{why}. Settings, Models changes it",
            bad.join("; ")
        ))
    };
    if !written_by_setup(&tiers) {
        return Ok(if bad.is_empty() {
            Repair::Nothing
        } else {
            report("")
        });
    }
    let provider = crate::frontier::split(&tiers[0].model).0.to_owned();
    let target: Vec<(String, String)> = if provider == PROVIDER_ID {
        let probe = claude.probe().await;
        if probe.usable() {
            subscription_tiers(&probe, plugin_aliases(&ops.home()).as_deref(), optins)
        } else {
            // Claude Code cannot say what it serves now: keep the tiers that are already frontier and wanted
            tiers
                .iter()
                .filter(|t| !bad.iter().any(|b| b.contains(&format!("'{}'", t.name))))
                .filter(|t| {
                    let (p, id) = crate::frontier::split(&t.model);
                    optins.fable || !crate::frontier::is_heavy(p, id)
                })
                .map(|t| (t.name.clone(), t.model.clone()))
                .collect()
        }
    } else if provider == CHATGPT_PROVIDER {
        let catalogue = ops
            .provider_models(CHATGPT_PROVIDER)
            .await
            .unwrap_or_default();
        ladder_from_catalogue(CHATGPT_PROVIDER, &catalogue, CHATGPT_RUNGS)
    } else {
        let catalogue = ops.provider_models(GEMINI).await.unwrap_or_default();
        ladder_from_catalogue(GEMINI, &catalogue, GEMINI_RUNGS)
    };
    let current: Vec<(String, String)> = tiers
        .iter()
        .map(|t| (t.name.clone(), t.model.clone()))
        .collect();
    if target.is_empty() || target == current {
        // nothing better is listed: a ladder that is still all frontier keeps running, one that is not is reported
        return Ok(if bad.is_empty() {
            Repair::Nothing
        } else {
            report("; your account lists no frontier model for it")
        });
    }
    *restart |= write_route(ops, &target).await?;
    Ok(Repair::Rewrote(format!(
        "the tier ladder is now {}, because governed mode runs only on frontier models and heavy ones only when you turn them on",
        target
            .iter()
            .map(|(_, m)| m.as_str())
            .collect::<Vec<_>>()
            .join(", then ")
    )))
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
            format!("{pick:?} is not a configured model"),
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
    *restart |= write_route(ops, &[(model.to_owned(), pick.to_owned())]).await?;
    Ok(Outcome::Done(format!("one tier: {model} on {provider}")))
}

/// Why the subscription needs the user before it can go on, and what fixes it. Signing in is Claude Code's own
/// `claude auth login` (Anthropic's program: it opens the browser and keeps the login), offered as a sign-in on the card; the
/// install and the update are commands the user runs. boopis checks the result through the CLI (ADR-0029, ADR-0030).
fn claude_form(probe: &Probe) -> Form {
    let title = match probe.state {
        State::NotInstalled => "Install Claude Code to use your Claude subscription",
        State::SignedOut => "Sign in to Claude",
        State::Metered => "Claude Code is not signed in with your Claude account",
        State::OldVersion => "Update Claude Code",
        State::SignedIn => "Claude Code is ready",
    };
    let mut steps: Vec<(String, String)> = Vec::new();
    let sign_in = matches!(probe.state, State::SignedOut | State::Metered);
    let tail = match probe.state {
        State::NotInstalled => {
            steps.push(("Install it".into(), format!("`{INSTALL_COMMAND}`")));
            "Run it in a terminal, then choose Check again."
        }
        State::OldVersion => {
            steps.push(("Update it".into(), format!("`{}`", claude::UPDATE_COMMAND)));
            "Run it in a terminal, then choose Check again."
        }
        State::SignedOut | State::Metered => {
            "Choose Sign in to Claude: Claude Code opens your browser to sign in with your Claude account."
        }
        State::SignedIn => "",
    };
    let mut form = Form::new(
        "setup.claude",
        "setup",
        title,
        &format!(
            "{}\n\n{tail} Claude Code is Anthropic's own program: it does the signing in and keeps your login. boopis never sees, reads or stores it; it only asks Claude Code whether it is signed in.",
            probe.detail
        ),
        json!({"type": "object", "properties": {}}),
    );
    if sign_in {
        // a provider id in the host's own table (`claude-code`), never a command: the host runs `claude auth login --claudeai`
        form.signin = Some(super::SignIn {
            provider: CLAUDE_LOGIN.into(),
            label: "Sign in to Claude".into(),
        });
    }
    form.contents = steps;
    form.submit = Json(json!({"label": "Check again"}));
    form.cancel = Json(json!({"label": "Choose another model"}));
    form
}

/// The sign-in the Claude form offers: the `claude-code` entry of `apps/shared/data/logins.json`.
pub const CLAUDE_LOGIN: &str = "claude-code";

/// The aliases the installed plugin's own model catalogue knows (`ALIASES = {'haiku': ..., }` in its `model_catalog.py`), so a
/// ladder never names a model the pinned build does not serve. `None` when the file cannot be read: the caller then trusts the
/// host's table, which is the plugin's documented set.
fn plugin_aliases(home: &Path) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(
        super::ops::plugins_dir(home)
            .join(PROVIDER_ID)
            .join("model_catalog.py"),
    )
    .ok()?;
    let block = text.split_once("ALIASES = {")?.1.split_once('}')?.0;
    let names: Vec<String> = block
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            let quote = l.chars().next().filter(|c| *c == '\'' || *c == '"')?;
            let end = l[1..].find(quote)?;
            let name = &l[1..=end];
            l[end + 2..]
                .trim_start()
                .starts_with(':')
                .then(|| name.to_owned())
        })
        .collect();
    (!names.is_empty()).then_some(names)
}

/// The tiers of the Claude subscription: the plugin's aliases the user's Claude Code serves and the pinned plugin knows, that
/// the frontier list allows (opus and fable: ADR-0037) and that are not heavy unless the user opted in to them (Fable bills usage
/// credits from the first request on a Pro plan), cheapest first, each as `<provider>/<alias>`.
#[must_use]
pub fn subscription_tiers(
    probe: &Probe,
    plugin: Option<&[String]>,
    optins: Optins,
) -> Vec<(String, String)> {
    probe
        .aliases
        .iter()
        .filter(|a| plugin.is_none_or(|p| p.contains(a)))
        .filter(|a| crate::frontier::is_frontier(PROVIDER_ID, a))
        .filter(|a| optins.fable || !crate::frontier::is_heavy(PROVIDER_ID, a))
        .map(|a| (a.clone(), format!("{PROVIDER_ID}/{a}")))
        .collect()
}

fn listed(plugins: &[super::ops::PluginEntry]) -> Option<&super::ops::PluginEntry> {
    plugins.iter().find(|p| p.name == PROVIDER_ID)
}

/// The Claude subscription (ADR-0029, ADR-0030): look at the user's Claude Code, check that the engine carries the Claude
/// subscription plugin (it comes inside boopis's runtime, so there is nothing to install), and write a ladder of its model
/// aliases. Each missing piece is a form that says what to do; none is guessed.
async fn subscription(
    ops: &dyn HermesOps,
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    let probe = input.claude.probe().await;
    if !probe.usable() {
        return Ok(Outcome::Form(claude_form(&probe)));
    }
    let home = ops.home();
    match listed(&ops.plugins().await?) {
        None => {
            return Err(Error::Setup(
                "hx.setup.subscription_unavailable",
                "This engine does not include the Claude subscription. It comes with boopis's own engine; choose another model, or start boopis with its own engine.".into(),
            ));
        }
        Some(p) if !p.enabled => {
            // someone switched the provider off by hand; the user chose it just now
            ops.enable_plugin(PROVIDER_ID).await?;
            *restart = true;
        }
        Some(_) => {}
    }
    let tiers = subscription_tiers(&probe, plugin_aliases(&home).as_deref(), input.optins);
    if tiers.is_empty() {
        return Err(Error::Setup(
            "hx.setup.subscription_unavailable",
            format!(
                "Governed mode runs only on frontier models ({}), and your Claude Code {} serves none of them, so no ladder can be set. Updating Claude Code (claude update) may fix it.",
                crate::frontier::allowed_sentence(),
                probe.version.as_deref().unwrap_or("(version unknown)")
            ),
        ));
    }
    *restart |= write_route(ops, &tiers).await?;
    Ok(Outcome::Done(format!(
        "Claude subscription ({}): {} on your Claude Code login",
        probe.plan.as_deref().unwrap_or("plan not reported"),
        tiers
            .iter()
            .map(|(n, _)| n.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

/// The sign-in card's form while no ChatGPT account is signed in. The sign-in itself (the code, the page, the wait) is the
/// first-run view's card over the host's ChatGPT commands, offered through `signin`; this form carries the words and the way
/// back.
fn chatgpt_form() -> Form {
    let mut form = Form::new(
        "setup.chatgpt",
        "setup",
        "Sign in with ChatGPT",
        "Choose Sign in with ChatGPT: boopis opens OpenAI's sign-in page in your browser, you sign in with your ChatGPT account and allow boopis to use your ChatGPT plan, and the browser sends you back. boopis keeps the sign-in in your OS keychain and renews it by itself. Governed work then runs on the models your ChatGPT plan includes.",
        json!({"type": "object", "properties": {}}),
    );
    form.signin = Some(super::SignIn {
        provider: super::SIGNIN_CHATGPT.into(),
        label: "Sign in with ChatGPT".into(),
    });
    form.submit = Json(json!({"label": "Check again"}));
    form.cancel = Json(json!({"label": "Choose another model"}));
    form
}

/// The lowest model of `family` that `provider`'s catalogue lists and the frontier list allows: the rung of a ladder. Versions order
/// by number (`gpt-6.2-sol` before `gpt-6.10-sol`); models of one version keep the catalogue's order. A heavy model is taken
/// only when `heavy` says the user asked for it.
fn lowest_in_family(
    provider: &str,
    family: &str,
    catalogue: &[String],
    heavy: bool,
) -> Option<String> {
    let key = |id: &String| -> Vec<(Option<u32>, String)> {
        crate::frontier::normalise(id)
            .into_iter()
            .map(|t| (t.parse().ok(), t))
            .collect()
    };
    catalogue
        .iter()
        .filter(|id| crate::frontier::is_frontier(provider, id))
        .filter(|id| heavy || !crate::frontier::is_heavy(provider, id))
        .filter(|id| crate::frontier::family_of(provider, id).as_deref() == Some(family))
        .min_by_key(|id| key(id))
        .cloned()
}

/// A ladder from what a provider's catalogue lists: one tier for each rung (`(family id, tier name)`, cheapest first) whose family
/// the catalogue has a model of, as `provider/id`. A rung the catalogue lacks is left out, never guessed; a heavy model is never
/// a rung. Empty when the catalogue lists none: that provider has no governed ladder.
#[must_use]
pub fn ladder_from_catalogue(
    provider: &str,
    catalogue: &[String],
    rungs: &[(&str, &str)],
) -> Vec<(String, String)> {
    rungs
        .iter()
        .filter_map(|(family, name)| {
            lowest_in_family(provider, family, catalogue, false)
                .map(|id| ((*name).to_owned(), format!("{provider}/{id}")))
        })
        .collect()
}

/// The ChatGPT subscription (ADR-0030): signed in through boopis's own sign-in, then the account's own catalogue is asked for a GPT
/// Sol and a GPT Astra of 6.2 or later (ADR-0037). The ladder is the ones it lists, Sol first. Without either, nothing is written:
/// the plan has no model governed mode may use, and the line says so.
async fn chatgpt(ops: &dyn HermesOps, input: &Input<'_>, restart: &mut bool) -> Result<Outcome> {
    if !input.chatgpt_signed_in {
        return Ok(Outcome::Form(chatgpt_form()));
    }
    let catalogue = ops.provider_models(CHATGPT_PROVIDER).await?;
    let tiers = ladder_from_catalogue(CHATGPT_PROVIDER, &catalogue, CHATGPT_RUNGS);
    if tiers.is_empty() {
        return Ok(Outcome::Done(format!(
            "ChatGPT subscription: signed in, but your plan lists no GPT Sol or GPT Astra of 6.2 or later, so governed mode is unavailable on it. It runs only on {}. Sessions that are not governed can use your plan's models",
            crate::frontier::allowed_sentence()
        )));
    }
    *restart |= write_route(ops, &tiers).await?;
    Ok(Outcome::Done(format!(
        "ChatGPT subscription: {} on your ChatGPT sign-in",
        ladder_models(&tiers)
    )))
}

/// A ladder's models in tier order: `gpt-6.2-sol, then gpt-6.2-astra`.
fn ladder_models(tiers: &[(String, String)]) -> String {
    tiers
        .iter()
        .map(|(_, m)| crate::frontier::split(m).1)
        .collect::<Vec<_>>()
        .join(", then ")
}

/// Gemini with a Google AI Studio key: the key (a form, with the link to make one), then a ladder from what the engine's Gemini
/// catalogue lists: Hydrogen, then Neon. Carbon is allowed but not on the ladder (it scored below Neon at a higher cost).
async fn gemini(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    env: &[String],
    restart: &mut bool,
) -> Result<Outcome> {
    let r = SecretRef::provider_key(GEMINI);
    let in_env = GEMINI_VARS.iter().any(|v| env.iter().any(|e| e == v));
    if !in_env && !saved(store, &r) {
        return Ok(Outcome::Form(credential_form(GEMINI)));
    }
    if saved(store, &r) && !wire(ops, GEMINI, false).await?.is_empty() {
        *restart = true;
    }
    let catalogue = ops.provider_models(GEMINI).await?;
    let tiers = ladder_from_catalogue(GEMINI, &catalogue, GEMINI_RUNGS);
    if tiers.is_empty() {
        return Ok(Outcome::Done(format!(
            "Gemini on your Google AI Studio key: its catalogue lists no Gemini 4 Hydrogen or Gemini 4 Neon, so no governed ladder was written and governed mode is unavailable on it. Gemini 4 Carbon is allowed but is not on the ladder setup writes (it scored below Neon at a higher cost). It runs only on {}",
            crate::frontier::allowed_sentence()
        )));
    }
    *restart |= write_route(ops, &tiers).await?;
    Ok(Outcome::Done(format!(
        "Gemini on your Google AI Studio key: {}. Whether your key may use them is Google's decision, and boopis says so if one is refused",
        ladder_models(&tiers)
    )))
}

/// xAI with an API key: the key (a form), then, only when the user turned Grok on (Settings > Models), a ladder of the lowest Grok
/// 4.7 or later the xAI catalogue lists. Grok is heavy (ADR-0037), so with the switch off no ladder is written and the line says so.
async fn xai(
    ops: &dyn HermesOps,
    store: &dyn SecretStore,
    env: &[String],
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    let r = SecretRef::provider_key(XAI);
    let in_env = XAI_VARS.iter().any(|v| env.iter().any(|e| e == v));
    if !in_env && !saved(store, &r) {
        return Ok(Outcome::Form(credential_form(XAI)));
    }
    if saved(store, &r) && !wire(ops, XAI, false).await?.is_empty() {
        *restart = true;
    }
    if !input.optins.grok {
        return Ok(Outcome::Done(
            "xAI key saved. Grok 4.7 and later is a heavy model (token-heavy), so governed mode stays unavailable on it until you turn on Grok in Settings, Models. Sessions that are not governed can use it now".into(),
        ));
    }
    let catalogue = ops.provider_models(XAI).await?;
    let Some(id) = lowest_in_family(XAI, GROK_FAMILY, &catalogue, true) else {
        return Ok(Outcome::Done(
            "xAI key saved, but your xAI catalogue lists no Grok 4.7 or later, so governed mode is unavailable on it".into(),
        ));
    };
    *restart |= write_route(ops, &[("grok".to_owned(), format!("{XAI}/{id}"))]).await?;
    Ok(Outcome::Done(format!(
        "xAI: {id} on your xAI key (heavy: it is on the ladder because you turned it on)"
    )))
}
