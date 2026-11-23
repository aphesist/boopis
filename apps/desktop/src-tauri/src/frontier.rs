//! Which models may do governed work (ADR-0037), read from the one shared list, `apps/shared/data/frontier-models.json`.
//!
//! The plugin is the authority at run time (`plugins/boopis/governance/frontier.py` reads a copy of the same file); the host
//! needs the same rule at setup, to write only frontier ladders, and in Settings > Models, to say which tiers of the saved
//! ladder governed mode would refuse. Two readers of one list, both tested against the file's `examples`.

use std::sync::LazyLock;

use serde::Deserialize;

/// The shared list.
pub const FRONTIER_JSON: &str = include_str!("../../../shared/data/frontier-models.json");

type Version = Vec<u32>;

#[derive(Debug, Deserialize)]
struct FamilyRow {
    id: String,
    name: String,
    prefix: Vec<String>,
    suffix: Vec<String>,
    min: String,
    /// Frontier but token-heavy or costly: never on a ladder setup writes or the plugin defaults to, never an automatic pick.
    #[serde(default)]
    heavy: bool,
}

#[derive(Debug, Deserialize)]
struct File {
    families: Vec<FamilyRow>,
    ignorable_suffixes: Vec<String>,
    aliases: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
}

// the file is compiled in and a test parses it, so a failure here is a build that should not have shipped
#[allow(clippy::expect_used)]
static FILE: LazyLock<File> =
    LazyLock::new(|| serde_json::from_str(FRONTIER_JSON).expect("frontier-models.json is valid"));

fn parse_version(text: &str) -> Version {
    text.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn show(v: &[u32]) -> String {
    v.iter().map(u32::to_string).collect::<Vec<_>>().join(".")
}

fn at_least(version: &[u32], floor: &[u32]) -> bool {
    let n = version.len().max(floor.len());
    let get = |v: &[u32], i: usize| v.get(i).copied().unwrap_or(0);
    for i in 0..n {
        match get(version, i).cmp(&get(floor, i)) {
            std::cmp::Ordering::Greater => return true,
            std::cmp::Ordering::Less => return false,
            std::cmp::Ordering::Equal => {}
        }
    }
    true
}

/// The id as tokens: lower case, the part after the last `/`, a bracketed suffix and anything after `:` dropped, dots and
/// dashes the same.
#[must_use]
pub fn normalise(model: &str) -> Vec<String> {
    let mut text = model.trim().to_lowercase();
    if text.ends_with(']')
        && let Some(open) = text.rfind('[')
    {
        text.truncate(open);
    }
    let text = text.rsplit('/').next().unwrap_or("");
    let text = text.split(':').next().unwrap_or("");
    text.split(['.', '-', '_'])
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect()
}

fn short(token: &str) -> bool {
    (1..=2).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_digit())
}

fn digits(token: &str, n: usize) -> bool {
    token.len() == n && token.bytes().all(|b| b.is_ascii_digit())
}

fn tail_ignorable(rest: &[String]) -> bool {
    let mut i = 0;
    while i < rest.len() {
        let t = &rest[i];
        if FILE.ignorable_suffixes.contains(t) || digits(t, 8) {
            i += 1;
        } else if digits(t, 4) && rest.len() > i + 2 && short(&rest[i + 1]) && short(&rest[i + 2]) {
            i += 3;
        } else {
            return false;
        }
    }
    true
}

fn resolve_alias(provider: &str, model: &str) -> String {
    route_alias(provider, model).map_or_else(|| model.to_owned(), str::to_owned)
}

/// The id `alias` names on `provider`'s own routes today (the Claude subscription's `opus` is `claude-opus-5-5`), from the list's
/// `aliases`; `None` when that provider floats no such alias. Such a provider resolves the alias itself at every request, so a
/// configuration may keep the alias and still run.
#[must_use]
pub fn route_alias(provider: &str, alias: &str) -> Option<&'static str> {
    let key = {
        let m = alias.trim().to_lowercase();
        match (m.ends_with(']'), m.rfind('[')) {
            (true, Some(open)) => m[..open].to_owned(),
            _ => m,
        }
    };
    FILE.aliases
        .get(&provider.trim().to_lowercase())
        .and_then(|t| t.get(&key))
        .map(String::as_str)
}

/// A model recognised as a family: its readable name, whether it is at or above the family's floor, and the floor.
struct Found {
    family: String,
    called: String,
    frontier: bool,
    heavy: bool,
    floor: String,
}

fn find(provider: &str, model: &str) -> Option<Found> {
    let tokens = normalise(&resolve_alias(provider, model));
    for f in &FILE.families {
        let n = f.prefix.len();
        if tokens.len() < n || tokens[..n] != f.prefix[..] {
            continue;
        }
        let mut i = n;
        let mut parts: Version = Vec::new();
        while i < tokens.len() && parts.len() < 3 && short(&tokens[i]) {
            parts.push(tokens[i].parse().unwrap_or(0));
            i += 1;
        }
        let end = i + f.suffix.len();
        if parts.is_empty() || tokens.len() < end || tokens[i..end] != f.suffix[..] {
            continue;
        }
        if tail_ignorable(&tokens[end..]) {
            let floor = parse_version(&f.min);
            return Some(Found {
                family: f.id.clone(),
                heavy: f.heavy,
                called: f.name.replace("{v}", &show(&parts)),
                frontier: at_least(&parts, &floor),
                floor: show(&floor),
            });
        }
    }
    None
}

/// Whether `provider`'s models can never be frontier: a custom endpoint or a runtime on this computer (ADR-0039, `never_frontier` in
/// `providers.json`). The rule comes first, before the name is looked at, so no model name can make such a model frontier.
fn never(provider: &str) -> bool {
    crate::providers::catalogue().never_frontier(provider)
}

/// Whether `provider`/`model` may do governed work. Unknown, empty and unrecognised are not, and neither is anything on a custom
/// endpoint or a runtime on this computer, whatever it is called.
#[must_use]
pub fn is_frontier(provider: &str, model: &str) -> bool {
    !never(provider) && find(provider, model).is_some_and(|f| f.frontier)
}

/// Whether `provider`/`model` is a frontier model of a heavy family (Claude Fable, Grok 4.7 and later): governed mode may run
/// it, but only when the user asked for it. Nothing that picks a model by itself may pick one.
#[must_use]
pub fn is_heavy(provider: &str, model: &str) -> bool {
    !never(provider) && find(provider, model).is_some_and(|f| f.frontier && f.heavy)
}

/// The id of the family `provider`/`model` is in (`gpt-sol`), whether or not it is at its floor; `None` in no family.
#[must_use]
pub fn family_of(provider: &str, model: &str) -> Option<String> {
    find(provider, model).map(|f| f.family)
}

/// The heavy families' names for people, as `allowed` gives them: `Claude Fable 5.2`.
#[must_use]
pub fn heavy_families() -> Vec<String> {
    FILE.families
        .iter()
        .filter(|f| f.heavy)
        .map(|f| f.name.replace("{v}", &f.min))
        .collect()
}

/// The allowed models for people, one per family: `Claude Opus 5.5`.
#[must_use]
pub fn allowed() -> Vec<String> {
    FILE.families
        .iter()
        .map(|f| f.name.replace("{v}", &f.min))
        .collect()
}

/// `Claude Opus 5.5 or later, ... and Grok 4.7 or later`.
#[must_use]
pub fn allowed_sentence() -> String {
    let names: Vec<String> = allowed()
        .into_iter()
        .map(|n| format!("{n} or later"))
        .collect();
    match names.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        Some((last, _)) => last.clone(),
        None => String::new(),
    }
}

/// Why a model that is not frontier is not, in a clause: its family and the lowest version allowed, or that it is in no listed
/// family.
#[must_use]
pub fn why_not(provider: &str, model: &str) -> String {
    if never(provider) {
        return "it runs on an endpoint of your own or on this computer, which governed mode never uses".to_owned();
    }
    match find(provider, model) {
        Some(f) if !f.frontier => format!(
            "it is {}, and the lowest version allowed is {}",
            f.called, f.floor
        ),
        Some(_) => String::new(),
        None => "it is not in a family on that list".to_owned(),
    }
}

/// A saved ladder's model (`provider/id`, the id may hold slashes) as `(provider, id)`.
#[must_use]
pub fn split(model: &str) -> (&str, &str) {
    model.split_once('/').unwrap_or(("", model))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_examples() {
        let raw: serde_json::Value = serde_json::from_str(FRONTIER_JSON).unwrap();
        let examples = raw["examples"].as_array().unwrap();
        assert!(examples.len() > 40);
        for e in examples {
            let (p, m) = (
                e["provider"].as_str().unwrap(),
                e["model"].as_str().unwrap(),
            );
            assert_eq!(
                is_frontier(p, m),
                e["frontier"].as_bool().unwrap(),
                "{p}/{m}"
            );
            assert_eq!(
                is_heavy(p, m),
                e["heavy"].as_bool().unwrap_or(false),
                "heavy: {p}/{m}"
            );
        }
    }

    #[test]
    fn a_route_alias_is_the_providers_own() {
        let sub = "claude-subscription-directsdk-experimental";
        assert_eq!(route_alias(sub, "haiku"), Some("claude-haiku-5-5"));
        assert_eq!(route_alias(sub, "Opus[1m]"), Some("claude-opus-5-5"));
        assert_eq!(route_alias(sub, "claude-opus-5-5"), None);
        assert_eq!(route_alias("anthropic", "haiku"), None);
    }

    #[test]
    fn both_sides_of_each_floor_and_the_words() {
        for (family, below, at) in [
            ("claude-opus-{}", "5-4", "5-5"),
            ("claude-fable-{}", "5-1", "5-2"),
            ("gpt-{}-terra", "6", "6-1"),
            ("gpt-{}-astra", "6-1", "6-2"),
            ("gemini-{}-carbon", "3", "4"),
            ("gpt-{}-sol", "6-1", "6-2"),
            ("gemini-{}-neon", "3", "4"),
            ("gemini-{}-hydrogen", "3", "4"),
            ("grok-{}", "4-6", "4-7"),
        ] {
            assert!(!is_frontier("p", &family.replace("{}", below)), "{family}");
            assert!(is_frontier("p", &family.replace("{}", at)), "{family}");
        }
        assert_eq!(
            allowed(),
            [
                "Claude Opus 5.5",
                "Claude Fable 5.2",
                "GPT-6.1 Terra",
                "GPT-6.2 Astra",
                "GPT-6.2 Sol",
                "Gemini 4 Carbon",
                "Gemini 4 Neon",
                "Gemini 4 Hydrogen",
                "Grok 4.7"
            ]
        );
        assert!(allowed_sentence().ends_with("and Grok 4.7 or later"));
        assert_eq!(
            heavy_families(),
            ["Claude Fable 5.2", "Gemini 4 Carbon", "Grok 4.7"]
        );
        assert_eq!(
            why_not("anthropic", "claude-opus-5-4"),
            "it is Claude Opus 5.4, and the lowest version allowed is 5.5"
        );
        assert_eq!(
            why_not("xai", "grok-4.6"),
            "it is Grok 4.6, and the lowest version allowed is 4.7"
        );
        assert_eq!(
            why_not("xai", "grok-code-fast-1"),
            "it is not in a family on that list"
        );
        assert_eq!(
            split("openai-codex/gpt-6.2-astra"),
            ("openai-codex", "gpt-6.2-astra")
        );
    }

    #[test]
    fn sol_astra_and_luna_do_not_clash_and_neither_do_the_gemini_families() {
        let fam = |m: &str| family_of("p", m);
        assert_eq!(fam("gpt-6.2-sol").as_deref(), Some("gpt-sol"));
        assert_eq!(fam("gpt-6.2-astra").as_deref(), Some("gpt-astra"));
        assert_eq!(fam("gpt-6.2-luna"), None);
        assert_eq!(fam("gemini-4-neon").as_deref(), Some("gemini-neon"));
        assert_eq!(fam("gemini-4-hydrogen").as_deref(), Some("gemini-hydrogen"));
        assert_eq!(fam("gemini-4-carbon").as_deref(), Some("gemini-carbon"));
        assert!(!is_frontier("p", "gpt-6.2-sol-astra"));
    }

    #[test]
    fn only_a_frontier_model_of_a_heavy_family_is_heavy() {
        for (p, m) in [
            ("anthropic", "claude-fable-5-2"),
            ("claude-subscription-directsdk-experimental", "fable"),
            ("xai", "grok-4.7"),
            ("xai", "grok-5"),
            ("gemini", "gemini-4-carbon"),
            ("gemini", "models/gemini-5-carbon-high"),
        ] {
            assert!(is_heavy(p, m), "{p}/{m}");
        }
        for (p, m) in [
            ("anthropic", "claude-opus-5-5"),
            ("openai-codex", "gpt-6.2-sol"),
            ("gemini", "gemini-4-neon"),
            ("gemini", "gemini-4-hydrogen"),
            ("gemini", "gemini-3-carbon"),
            ("anthropic", "claude-fable-5-1"),
            ("xai", "grok-4.6"),
            ("anthropic", ""),
        ] {
            assert!(!is_heavy(p, m), "{p}/{m}");
        }
    }

    #[test]
    fn a_custom_endpoint_or_a_runtime_on_this_computer_is_never_frontier_whatever_the_model_is_called()
     {
        // the rule's own examples (`never_frontier.examples` in providers.json), asked of the whole check
        let c = crate::providers::catalogue();
        assert!(c.never_frontier.examples.len() >= 8);
        for e in &c.never_frontier.examples {
            assert_eq!(
                is_frontier(&e.provider, &e.model),
                e.frontier,
                "{}/{}",
                e.provider,
                e.model
            );
            if !e.frontier {
                assert!(
                    !is_heavy(&e.provider, &e.model),
                    "{}/{}",
                    e.provider,
                    e.model
                );
            }
        }
        // the rule comes first: every frontier example of the list, asked as a custom or local provider, is refused
        let raw: serde_json::Value = serde_json::from_str(FRONTIER_JSON).unwrap();
        for e in raw["examples"].as_array().unwrap() {
            let model = e["model"].as_str().unwrap();
            for provider in [
                "custom",
                "custom-x",
                "custom-my-server",
                "ollama",
                "lmstudio",
                "llamacpp",
                "llama-cpp",
                "vllm",
                "Custom-Mine",
                " ollama ",
            ] {
                assert!(
                    !is_frontier(provider, model) && !is_heavy(provider, model),
                    "{provider}/{model}"
                );
            }
        }
        // a hand-written provider keeps the rule by name, and a name that only starts like the prefix is not one
        assert!(is_frontier("my-gateway", "claude-opus-5-5"));
        assert!(is_frontier("customer-api", "claude-opus-5-5"));
        assert!(
            why_not("custom-x", "claude-opus-5-5")
                .starts_with("it runs on an endpoint of your own or on this computer")
        );
        assert!(
            non_frontier_names(&["custom-x/claude-opus-5-5"]),
            "a ladder tier on a custom endpoint is refused with that reason"
        );
    }

    fn non_frontier_names(tiers: &[&str]) -> bool {
        tiers.iter().all(|t| {
            let (p, m) = split(t);
            !is_frontier(p, m) && why_not(p, m).contains("your own")
        })
    }

    #[test]
    fn the_plugins_copy_is_this_file() {
        let copy = include_str!("../../../../plugins/boopis/data/frontier-models.json");
        assert_eq!(copy, FRONTIER_JSON, "run scripts/sync-shared-data.sh");
    }
}
