//! Every lab and route boopis can set up (ADR-0039), read from the one shared file,
//! `apps/shared/data/providers.json` (schema `providers.schema.json`).
//!
//! The file is data: setup and Settings > Models are drawn from it, never from a list in code. This module is the host's
//! reader (the UI's is `ui/src/data/providers.ts`, the plugin keeps a copy made by `scripts/sync-shared-data.sh`); both
//! readers are tested against the file's `examples`. It also holds the types the host commands exchange with the UI:
//! [`ProviderState`] ([`state`]) and the endpoint form's request and result ([`endpoint`]).

pub mod endpoint;
pub mod state;

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Deserialize;
use serde_json::Value;

pub use state::{ProviderSigninEvent, ProviderState, ProviderStatus, SigninCode, WayKind};

/// The shared file.
pub const PROVIDERS_JSON: &str = include_str!("../../../../shared/data/providers.json");

/// The engine's three wire formats, spelled as the engine spells them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ApiMode {
    /// OpenAI chat completions.
    ChatCompletions,
    /// OpenAI Responses.
    CodexResponses,
    /// Anthropic Messages.
    AnthropicMessages,
}

/// How a way is set up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Config {
    /// The engine knows the slug: setup writes the key wiring (and a base URL when it differs).
    Builtin,
    /// A sign-in someone else owns (`claude.rs`, `chatgpt/`).
    External,
    /// boopis writes `providers.<slug>`.
    Endpoint,
}

/// Whether a route's models can be frontier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontierRule {
    /// By the model's name (`frontier-models.json`).
    ByName,
    /// Never (custom endpoints and models on this computer).
    Never,
}

/// Where a way's entry is listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shown {
    /// In setup and Settings.
    Default,
    /// Under More providers.
    More,
}

/// When a way is offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfferedWhen {
    /// Always.
    Always,
    /// Only when the entry's other sign-in is not possible or not in use (xAI: driving the user's own grok program).
    SigninUnused,
}

impl OfferedWhen {
    /// Whether a way with this rule is offered now, given whether its entry's sign-in is in use (connected, or waiting for the
    /// person). `always` is always; `signin_unused` only while the sign-in is not in use.
    #[must_use]
    pub const fn offered(self, signin_in_use: bool) -> bool {
        match self {
            Self::Always => true,
            Self::SigninUnused => !signin_in_use,
        }
    }
}

/// A group of entries in Settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    /// The id entries name.
    pub id: String,
    /// Its heading.
    pub label: String,
    /// Its place.
    pub order: u32,
}

/// Where a key is made and which variables it travels in.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Key {
    /// The variables the engine reads, in its order.
    pub vars: Vec<String>,
    /// The one boopis binds to the keychain secret.
    pub wire_var: Option<String>,
    /// Where a person makes a key.
    pub url: Option<String>,
    /// False for a server that needs none.
    pub required: bool,
    /// A key that starts with one of these is turned down.
    pub refuse_prefixes: Vec<String>,
}

/// A way's address rules.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaseUrl {
    /// The address, when there is a default.
    pub default: Option<String>,
    /// The variable that overrides it for the engine.
    pub env: Option<String>,
    /// The person may change it.
    pub editable: bool,
    /// boopis always sets it to `default`.
    pub pin: bool,
    /// Why it is pinned.
    pub pin_reason: Option<String>,
}

/// How a way's models are found.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discovery {
    /// `engine_options`, `get_models`, `probe` or `none`.
    pub method: String,
    /// Loopback host of a probe.
    pub host: Option<String>,
    /// Port of a probe.
    pub port: Option<u16>,
    /// Path asked.
    pub path: Option<String>,
    /// A second path to try.
    pub fallback_path: Option<String>,
    /// What the answer must look like.
    pub shape: Option<String>,
    /// How long to wait.
    pub timeout_ms: Option<u32>,
}

/// A sign-in a way offers.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signin {
    /// `cli`, `device_code` or `external_token`.
    pub flow: String,
    /// The id in `logins.json`, for `cli`.
    pub login: Option<String>,
    /// The code that owns it.
    pub owner: String,
}

/// A line a person may need: terms, a limit or plain information.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Note {
    /// Its id.
    pub id: String,
    /// `terms`, `limit` or `info`.
    pub kind: String,
    /// `row` or `detail`.
    pub r#where: String,
    /// The words.
    pub text: String,
    /// Where it was read.
    pub source: Option<String>,
}

/// One route to a lab.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Way {
    /// `<entry>.<name>`, unique.
    pub id: String,
    /// Sign-in, key, local or custom.
    pub kind: WayKind,
    /// Its name.
    pub label: String,
    /// The line under it.
    pub hint: String,
    /// The engine's slug (`model.provider`).
    pub engine: Option<String>,
    /// The `providers.<slug>` boopis writes, for `Config::Endpoint`.
    pub slug: Option<String>,
    /// How it is set up.
    pub config: Config,
    /// Never listed.
    pub hidden: bool,
    /// Why.
    pub hidden_reason: Option<String>,
    /// When it is offered.
    pub offered_when: OfferedWhen,
    /// A regional twin.
    pub region: Option<String>,
    /// The spike that settled the slug.
    pub slug_spike: Option<String>,
    /// The key, when there is one.
    pub key: Option<Key>,
    /// The address rules.
    pub base_url: Option<BaseUrl>,
    /// The wire format.
    pub api_mode: Option<ApiMode>,
    /// How models are found.
    pub discovery: Discovery,
    /// The sign-in, when there is one.
    pub signin: Option<Signin>,
    /// Frontier or never.
    pub frontier: FrontierRule,
    /// Where in the engine's source it was read.
    pub engine_source: Vec<String>,
    /// What a person should know.
    pub notes: Vec<Note>,
}

impl Way {
    /// The provider name in `secret://provider.<name>/api_key`: the engine slug, or the endpoint's slug.
    #[must_use]
    pub fn secret_id(&self) -> Option<&str> {
        self.engine.as_deref().or(self.slug.as_deref())
    }

    /// The keychain reference of this way's key; `None` for a way with no key.
    #[must_use]
    pub fn secret_ref(&self) -> Option<String> {
        self.key.as_ref()?;
        Some(format!("secret://provider.{}/api_key", self.secret_id()?))
    }
}

/// A lab, a host or a runtime, with its ways.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    /// Its id.
    pub id: String,
    /// Whose models these are.
    pub lab: String,
    /// What the row is called.
    pub label: String,
    /// One line.
    pub summary: String,
    /// A group id.
    pub group: String,
    /// The research rank; ties share one.
    pub rank: u32,
    /// Listed by default or under More providers.
    pub shown: Shown,
    /// Extra search words.
    pub keywords: Vec<String>,
    /// The routes.
    pub ways: Vec<Way>,
}

/// One heavy-model switch.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeavySwitch {
    /// What `setup_set_heavy` takes; also the tier's name.
    pub id: String,
    /// A family in `frontier-models.json`.
    pub family: String,
    /// The switch's label.
    pub label: String,
    /// Why it is off by default.
    pub reason: String,
    /// The engine slugs a ladder must be wholly on.
    pub engines: Vec<String>,
    /// The key way whose key must be in place.
    pub key_way: String,
    /// Whether it also applies when no ladder is saved.
    pub applies_when_unset: bool,
    /// `route_alias` or `lowest_in_family`.
    pub pick: String,
    /// The sentence when it does not apply.
    pub not_applicable: String,
    /// The sentence when the catalogue lists none.
    pub none_listed: Option<String>,
    /// `keep` or `unset`.
    pub empty_ladder: String,
}

/// The never-frontier rule for custom endpoints and local runtimes.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NeverFrontier {
    /// What it is.
    pub about: String,
    /// Providers that are never frontier.
    pub engines: Vec<String>,
    /// Slug prefixes that are never frontier.
    pub slug_prefixes: Vec<String>,
    /// Examples both readers are tested against.
    pub examples: Vec<NeverExample>,
}

/// One example of the never-frontier rule.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NeverExample {
    /// The provider slug.
    pub provider: String,
    /// The model id.
    pub model: String,
    /// What the whole check (this rule, then the name) answers.
    pub frontier: bool,
}

/// A route that is not offered, and who it waits for.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotOffered {
    /// Its id.
    pub id: String,
    /// Its lab.
    pub lab: String,
    /// What it is.
    pub route: String,
    /// Why not.
    pub why: String,
    /// `owner`, `terms`, `later` or `none`.
    pub waits_for: String,
}

/// A question the reading of the engine's source settled.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spike {
    /// Its id.
    pub id: String,
    /// When.
    pub date: String,
    /// What was asked.
    pub question: String,
    /// What was found.
    pub result: String,
    /// Where.
    pub evidence: Vec<String>,
    /// What setup does about it.
    pub decision: String,
}

/// What a reader must answer for a way.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Example {
    /// The way's id.
    pub way: String,
    /// Dotted path to value.
    pub expect: BTreeMap<String, Value>,
}

/// The endpoint form and what its commands accept (kept as data; see [`endpoint`] for the typed views).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointRules {
    /// What it is.
    pub about: String,
    /// The wire formats on offer.
    pub api_modes: Vec<ApiModeChoice>,
    /// The default one.
    pub default_api_mode: ApiMode,
    /// The address rules.
    pub url: Value,
    /// The slug rule and its examples.
    pub slug: Value,
    /// The limits.
    pub limits: EndpointLimits,
    /// What Test asks.
    pub test: Value,
    /// The form's fields.
    pub fields: Vec<EndpointField>,
}

/// A wire format and its label.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiModeChoice {
    /// The engine's spelling.
    pub id: ApiMode,
    /// The label.
    pub label: String,
}

/// The endpoint limits.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointLimits {
    /// Most model ids saved.
    pub max_models: u32,
    /// Longest model id.
    pub max_model_id_chars: u32,
    /// Request timeout for an address on this computer.
    pub request_timeout_loopback_s: u32,
    /// Request timeout elsewhere.
    pub request_timeout_s: u32,
    /// Smallest context length accepted.
    pub context_length_min: u32,
}

/// One field of the `endpoint` form.
#[allow(clippy::struct_excessive_bools)] // the file's own flags, one per way a field can differ
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointField {
    /// Its name.
    pub name: String,
    /// `string`, `boolean` or `integer`.
    pub r#type: String,
    /// `uri`, for an address.
    pub format: Option<String>,
    /// Its title.
    pub title: String,
    /// Its help.
    pub description: String,
    /// A hint in the empty field.
    pub placeholder: Option<String>,
    /// Must be filled.
    pub required: bool,
    /// The choices.
    pub r#enum: Option<Vec<String>>,
    /// The choices' labels.
    #[serde(rename = "enumNames")]
    pub enum_names: Option<Vec<String>>,
    /// The start value.
    pub default: Option<Value>,
    /// A secret field.
    #[serde(default)]
    pub secret: bool,
    /// A multi-select.
    #[serde(default)]
    pub multi: bool,
    /// A multi-line field.
    #[serde(default)]
    pub multiline: bool,
    /// Drawn in the mono face.
    #[serde(default)]
    pub mono: bool,
    /// Exists only once Test found models.
    #[serde(default)]
    pub after_test: bool,
}

/// The file's engine pin.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineRef {
    /// The release read.
    pub version: String,
    /// Its commit.
    pub commit: String,
    /// What it is for.
    pub about: String,
}

/// The whole file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalogue {
    /// Always 1.
    pub schema_version: u32,
    /// What the file is.
    pub description: String,
    /// The engine release it was read from.
    pub engine: EngineRef,
    /// The groups, in order.
    pub groups: Vec<Group>,
    /// The entries, in display order.
    pub providers: Vec<Entry>,
    /// The heavy-model switches.
    pub heavy_switches: Vec<HeavySwitch>,
    /// The never-frontier rule.
    pub never_frontier: NeverFrontier,
    /// The endpoint form and its rules.
    pub endpoint: EndpointRules,
    /// Routes not offered yet.
    pub not_offered: Vec<NotOffered>,
    /// Settled questions.
    pub spikes: Vec<Spike>,
    /// What readers must answer.
    pub examples: Vec<Example>,
}

// the file is compiled in and a test parses it, so a failure here is a build that should not have shipped
#[allow(clippy::expect_used)]
static CATALOGUE: LazyLock<Catalogue> = LazyLock::new(|| {
    serde_json::from_str(PROVIDERS_JSON).expect("providers.json matches providers.schema.json")
});

/// The catalogue. The file is part of the build, so it cannot fail to parse at run time (the tests parse it).
#[must_use]
pub fn catalogue() -> &'static Catalogue {
    &CATALOGUE
}

impl Catalogue {
    /// Every way, in display order, hidden ones included.
    pub fn ways(&self) -> impl Iterator<Item = (&Entry, &Way)> {
        self.providers
            .iter()
            .flat_map(|e| e.ways.iter().map(move |w| (e, w)))
    }

    /// A way by id.
    #[must_use]
    pub fn way(&self, id: &str) -> Option<(&Entry, &Way)> {
        self.ways().find(|(_, w)| w.id == id)
    }

    /// The entries to list: not hidden, with their hidden ways left out, by `shown`.
    #[must_use]
    pub fn listed(&self, shown: Shown) -> Vec<&Entry> {
        self.providers
            .iter()
            .filter(|e| e.shown == shown && e.ways.iter().any(|w| !w.hidden))
            .collect()
    }

    /// The engine slugs the model picker must leave out.
    #[must_use]
    pub fn hidden_engines(&self) -> Vec<&str> {
        self.ways()
            .filter(|(_, w)| w.hidden)
            .filter_map(|(_, w)| w.engine.as_deref())
            .collect()
    }

    /// A heavy switch by id.
    #[must_use]
    pub fn heavy(&self, id: &str) -> Option<&HeavySwitch> {
        self.heavy_switches.iter().find(|h| h.id == id)
    }

    /// Whether a provider's models can never be frontier (a custom endpoint or a runtime on this computer).
    #[must_use]
    pub fn never_frontier(&self, provider: &str) -> bool {
        let n = &self.never_frontier;
        n.engines.iter().any(|e| e == provider)
            || n.slug_prefixes
                .iter()
                .any(|p| provider.starts_with(p.as_str()))
    }
}

/// A dotted path into a way (`key.wire_var`), as the examples spell it; `shown` and `secret_ref` are derived.
#[must_use]
pub fn field(entry: &Entry, way: &Way, path: &str) -> Value {
    match path {
        "shown" => {
            return Value::String(match entry.shown {
                Shown::Default => "default".into(),
                Shown::More => "more".into(),
            });
        }
        "secret_ref" => return way.secret_ref().map_or(Value::Null, Value::String),
        _ => {}
    }
    let Ok(mut v) = serde_json::to_value(WayView(way)) else {
        return Value::Null;
    };
    for part in path.split('.') {
        v = v.get(part).cloned().unwrap_or(Value::Null);
    }
    v
}

/// A way as the examples read it: the file's own spelling, so a path means what it says in the file.
struct WayView<'a>(&'a Way);

impl serde::Serialize for WayView<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let w = self.0;
        let mut m = serde_json::Map::new();
        let opt = |o: &Option<String>| o.clone().map_or(Value::Null, Value::String);
        m.insert("id".into(), w.id.clone().into());
        m.insert(
            "kind".into(),
            serde_json::to_value(w.kind).map_err(serde::ser::Error::custom)?,
        );
        m.insert("engine".into(), opt(&w.engine));
        m.insert("slug".into(), opt(&w.slug));
        m.insert("slug_spike".into(), opt(&w.slug_spike));
        m.insert("hidden".into(), w.hidden.into());
        m.insert(
            "offered_when".into(),
            match w.offered_when {
                OfferedWhen::Always => "always",
                OfferedWhen::SigninUnused => "signin_unused",
            }
            .into(),
        );
        m.insert(
            "config".into(),
            match w.config {
                Config::Builtin => "builtin",
                Config::External => "external",
                Config::Endpoint => "endpoint",
            }
            .into(),
        );
        m.insert(
            "frontier".into(),
            match w.frontier {
                FrontierRule::ByName => "by_name",
                FrontierRule::Never => "never",
            }
            .into(),
        );
        m.insert(
            "api_mode".into(),
            w.api_mode.map_or(Value::Null, |a| {
                serde_json::to_value(a).unwrap_or(Value::Null)
            }),
        );
        if let Some(k) = &w.key {
            m.insert(
                "key".into(),
                serde_json::json!({"wire_var": k.wire_var, "url": k.url, "required": k.required,
                    "refuse_prefixes": k.refuse_prefixes, "vars": k.vars}),
            );
        }
        if let Some(b) = &w.base_url {
            m.insert(
                "base_url".into(),
                serde_json::json!({"default": b.default, "env": b.env, "editable": b.editable, "pin": b.pin}),
            );
        }
        m.insert(
            "discovery".into(),
            serde_json::json!({"method": w.discovery.method, "port": w.discovery.port, "path": w.discovery.path,
                "shape": w.discovery.shape}),
        );
        if let Some(si) = &w.signin {
            m.insert(
                "signin".into(),
                serde_json::json!({"flow": si.flow, "login": si.login, "owner": si.owner}),
            );
        }
        Value::Object(m).serialize(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn raw() -> Value {
        serde_json::from_str(PROVIDERS_JSON).unwrap()
    }

    #[test]
    fn the_file_parses_and_every_example_holds() {
        let c = catalogue();
        assert_eq!(c.schema_version, 1);
        assert!(!c.examples.is_empty());
        for ex in &c.examples {
            let (entry, way) = c
                .way(&ex.way)
                .unwrap_or_else(|| panic!("example way {} exists", ex.way));
            for (path, want) in &ex.expect {
                assert_eq!(&field(entry, way, path), want, "{}: {path}", ex.way);
            }
        }
    }

    #[test]
    fn ids_are_unique_and_ways_belong_to_their_entry() {
        let c = catalogue();
        let mut entries = BTreeSet::new();
        let mut ways = BTreeSet::new();
        let mut slugs = BTreeSet::new();
        for e in &c.providers {
            assert!(entries.insert(&e.id), "entry {} twice", e.id);
            assert!(
                c.groups.iter().any(|g| g.id == e.group),
                "{}: group {}",
                e.id,
                e.group
            );
            for w in &e.ways {
                assert!(ways.insert(&w.id), "way {} twice", w.id);
                assert!(
                    w.id.starts_with(&format!("{}.", e.id)),
                    "{} is not under {}",
                    w.id,
                    e.id
                );
                if let Some(s) = w.secret_id() {
                    // two ways may share a slug only when they are the same route
                    assert!(slugs.insert(s.to_owned()), "slug {s} used by two ways");
                }
            }
        }
        for g in &c.groups {
            assert!(
                c.providers.iter().any(|e| e.group == g.id),
                "group {} is empty",
                g.id
            );
        }
    }

    #[test]
    fn the_array_is_in_rank_order() {
        let ranks: Vec<u32> = catalogue().providers.iter().map(|e| e.rank).collect();
        assert!(ranks.windows(2).all(|w| w[0] <= w[1]), "{ranks:?}");
    }

    #[test]
    fn ranks_one_to_thirteen_are_listed_and_the_rest_are_under_more() {
        for e in &catalogue().providers {
            let want = if e.rank <= 13 {
                Shown::Default
            } else {
                Shown::More
            };
            assert_eq!(e.shown, want, "{} (rank {})", e.id, e.rank);
        }
    }

    #[test]
    fn each_kind_carries_what_it_needs() {
        for (e, w) in catalogue().ways() {
            match w.kind {
                WayKind::Key => {
                    let k = w
                        .key
                        .as_ref()
                        .unwrap_or_else(|| panic!("{} has no key", w.id));
                    assert_eq!(w.config, Config::Builtin, "{}", w.id);
                    let wire = k
                        .wire_var
                        .as_ref()
                        .unwrap_or_else(|| panic!("{} has no wire var", w.id));
                    assert!(
                        k.vars.contains(wire),
                        "{}: wire var is not one of the engine's",
                        w.id
                    );
                    assert!(w.engine.is_some() && w.base_url.is_some(), "{}", w.id);
                    assert_eq!(w.frontier, FrontierRule::ByName, "{}", w.id);
                }
                WayKind::Signin => {
                    assert!(w.signin.is_some() && w.key.is_none(), "{}", w.id);
                    assert_eq!(w.config, Config::External, "{}", w.id);
                }
                WayKind::Local | WayKind::Custom => {
                    assert_eq!(w.frontier, FrontierRule::Never, "{}", w.id);
                    assert!(
                        catalogue().never_frontier(w.secret_id().unwrap_or("custom")),
                        "{}: the never-frontier rule must cover it",
                        w.id
                    );
                }
            }
            if w.config == Config::Endpoint {
                assert!(w.engine.is_none(), "{}", w.id);
            }
            if w.hidden {
                assert!(w.hidden_reason.is_some(), "{}", w.id);
            }
            if let Some(p) = w.discovery.port {
                assert_eq!(
                    w.discovery.host.as_deref(),
                    Some("127.0.0.1"),
                    "{} ({p})",
                    e.id
                );
            }
            if w.discovery.method == "probe" {
                assert!(
                    w.discovery.shape.is_some() && w.discovery.timeout_ms.is_some(),
                    "{}",
                    w.id
                );
            }
            if let Some(b) = &w.base_url {
                assert_eq!(b.pin, b.pin_reason.is_some(), "{}", w.id);
            }
            for n in &w.notes {
                assert!(
                    n.text.chars().count() <= 400,
                    "{}: note {} is long",
                    w.id,
                    n.id
                );
            }
        }
    }

    #[test]
    fn the_coding_plan_keys_are_kept_out() {
        let c = catalogue();
        let (_, kimi) = c.way("moonshot.key").unwrap();
        assert!(
            kimi.key
                .as_ref()
                .unwrap()
                .refuse_prefixes
                .iter()
                .any(|p| p == "sk-kimi-")
        );
        assert!(kimi.base_url.as_ref().unwrap().pin);
        let (_, zai) = c.way("zai.key").unwrap();
        assert!(zai.base_url.as_ref().unwrap().pin);
        assert_eq!(
            zai.base_url.as_ref().unwrap().default.as_deref(),
            Some("https://api.z.ai/api/paas/v4")
        );
        for n in ["zai.key", "moonshot.key"] {
            assert!(
                c.way(n).unwrap().1.notes.iter().any(|x| x.kind == "terms"),
                "{n} says why"
            );
        }
        let (_, g) = c.way("google.key").unwrap();
        assert!(
            g.notes
                .iter()
                .any(|x| x.id == "no-subscription-signin" && x.r#where == "row")
        );
    }

    #[test]
    fn qwen_sign_in_is_hidden_and_listed_nowhere() {
        let c = catalogue();
        assert_eq!(c.hidden_engines(), vec!["qwen-oauth"]);
        for shown in [Shown::Default, Shown::More] {
            for e in c.listed(shown) {
                assert!(e.ways.iter().any(|w| !w.hidden));
            }
        }
    }

    #[test]
    fn the_openai_key_slug_is_the_registry_row_not_the_legacy_alias() {
        let (_, w) = catalogue().way("openai.key").unwrap();
        assert_eq!(w.engine.as_deref(), Some("openai-api"));
        assert_eq!(
            w.secret_ref().as_deref(),
            Some("secret://provider.openai-api/api_key")
        );
        let spike = catalogue()
            .spikes
            .iter()
            .find(|s| Some(&s.id) == w.slug_spike.as_ref());
        assert!(spike.is_some_and(|s| s.result.starts_with("`openai-api`")));
    }

    #[test]
    fn heavy_switches_name_real_families_and_key_ways() {
        const MARK_PENDING: &[&str] = &["carbon"];
        let frontier: Value = serde_json::from_str(crate::frontier::FRONTIER_JSON).unwrap();
        let families: Vec<&Value> = frontier["families"].as_array().unwrap().iter().collect();
        // Carbon's family is marked heavy by the stream that adds its switch to the host (ADR-0039); until then the
        // data names it and the mark is still absent. When the mark lands, delete this list: the test then holds
        // every switch to the mark.
        let ids: Vec<&str> = catalogue()
            .heavy_switches
            .iter()
            .map(|h| h.id.as_str())
            .collect();
        assert_eq!(ids, ["fable", "grok", "carbon"]);
        for h in &catalogue().heavy_switches {
            let fam = families
                .iter()
                .find(|f| f["id"] == h.family)
                .unwrap_or_else(|| panic!("{}: family {}", h.id, h.family));
            let marked = fam["heavy"] == true;
            assert_eq!(
                !marked,
                MARK_PENDING.contains(&h.id.as_str()),
                "{}: heavy mark in frontier-models.json",
                h.id
            );
            let (_, key_way) = catalogue().way(&h.key_way).unwrap();
            assert_eq!(key_way.kind, WayKind::Key);
            for e in &h.engines {
                assert!(
                    catalogue()
                        .ways()
                        .any(|(_, w)| w.engine.as_deref() == Some(e)),
                    "{}: engine {e}",
                    h.id
                );
            }
            assert_eq!(
                h.pick == "lowest_in_family",
                h.none_listed.is_some(),
                "{}",
                h.id
            );
        }
    }

    #[test]
    fn the_existing_heavy_switches_say_what_the_host_says_today() {
        // Until stream A deletes the host's own table, the data and the table must not drift.
        use crate::claude::{Probe, State};
        use crate::setup::providers::{Keys, LadderState, heavy_choices};
        let probe = Probe {
            state: State::SignedIn,
            version: None,
            plan: None,
            detail: String::new(),
            aliases: vec![],
        };
        let choices = heavy_choices(LadderState::Default, &[], &probe, Keys::default());
        for c in choices {
            let h = catalogue()
                .heavy(&c.id)
                .unwrap_or_else(|| panic!("{} is in the data", c.id));
            assert_eq!(h.label, c.label, "{}", c.id);
            assert_eq!(h.reason, c.reason, "{}", c.id);
        }
    }

    #[test]
    fn the_secret_table_agrees_with_the_data() {
        // `secret-refs.json` lists the built-in providers setup binds today; every one must match the catalogue. Stream A
        // makes the table follow the catalogue; this holds the two together meanwhile.
        let table: Value = serde_json::from_str(include_str!(
            "../../../../../crates/hx-proto/secret-refs.json"
        ))
        .unwrap();
        for (engine, var) in table["builtin_provider_env"].as_object().unwrap() {
            let way = catalogue()
                .ways()
                .find(|(_, w)| w.kind == WayKind::Key && w.engine.as_deref() == Some(engine))
                .unwrap_or_else(|| panic!("{engine} is in the data"))
                .1;
            assert_eq!(
                way.key.as_ref().unwrap().wire_var.as_deref(),
                var.as_str(),
                "{engine}"
            );
        }
    }

    #[test]
    fn the_never_frontier_examples_follow_the_rule() {
        let c = catalogue();
        for ex in &c.never_frontier.examples {
            if ex.frontier {
                assert!(!c.never_frontier(&ex.provider), "{}", ex.provider);
                assert!(
                    crate::frontier::is_frontier(&ex.provider, &ex.model),
                    "{}/{}",
                    ex.provider,
                    ex.model
                );
            } else {
                assert!(c.never_frontier(&ex.provider), "{}", ex.provider);
            }
        }
    }

    #[test]
    fn the_endpoint_rules_are_consistent() {
        let r = &catalogue().endpoint;
        assert!(r.api_modes.iter().any(|m| m.id == r.default_api_mode));
        let slug = &r.slug;
        let prefix = slug["prefix"].as_str().unwrap();
        assert!(
            catalogue()
                .never_frontier
                .slug_prefixes
                .iter()
                .any(|p| p == prefix)
        );
        for ex in slug["examples"].as_array().unwrap() {
            let s = ex["slug"].as_str().unwrap();
            assert!(s.starts_with(prefix) && s.len() <= prefix.len() + 41, "{s}");
        }
        let key: Vec<_> = r.fields.iter().filter(|f| f.secret).collect();
        assert_eq!(key.len(), 1, "one secret field");
        assert!(key[0].default.is_none() && !key[0].required && key[0].r#enum.is_none());
        assert!(r.fields.iter().filter(|f| f.after_test).all(|f| f.multi));
        let mode = r.fields.iter().find(|f| f.name == "api_mode").unwrap();
        let ids: Vec<String> = r
            .api_modes
            .iter()
            .map(|m| {
                serde_json::to_value(m.id)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(mode.r#enum.as_ref().unwrap(), &ids);
    }

    #[test]
    fn no_word_a_person_reads_names_the_engine() {
        // ADR-0031. `engine_source`, `spikes` and `not_offered` are for the people who build boopis; everything else may
        // reach a screen.
        fn walk(v: &Value, path: &str, bad: &mut Vec<String>) {
            match v {
                Value::String(s) if s.to_lowercase().contains("hermes") => {
                    bad.push(format!("{path}: {s}"));
                }
                Value::Array(a) => a
                    .iter()
                    .enumerate()
                    .for_each(|(i, x)| walk(x, &format!("{path}[{i}]"), bad)),
                Value::Object(o) => {
                    for (k, x) in o {
                        if !["engine_source", "spikes", "not_offered"].contains(&k.as_str()) {
                            walk(x, &format!("{path}.{k}"), bad);
                        }
                    }
                }
                _ => {}
            }
        }
        let mut bad = Vec::new();
        walk(&raw(), "", &mut bad);
        assert!(bad.is_empty(), "{bad:?}");
    }

    #[test]
    fn the_plugin_copy_is_current() {
        let copy = include_str!("../../../../../plugins/boopis/data/providers.json");
        assert_eq!(copy, PROVIDERS_JSON, "run scripts/sync-shared-data.sh");
    }
}
