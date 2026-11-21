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
    name: String,
    prefix: Vec<String>,
    suffix: Vec<String>,
    min: String,
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
    let key = {
        let m = model.trim().to_lowercase();
        match (m.ends_with(']'), m.rfind('[')) {
            (true, Some(open)) => m[..open].to_owned(),
            _ => m,
        }
    };
    FILE.aliases
        .get(&provider.trim().to_lowercase())
        .and_then(|t| t.get(&key))
        .cloned()
        .unwrap_or_else(|| model.to_owned())
}

/// A model recognised as a family: its readable name, whether it is at or above the family's floor, and the floor.
struct Found {
    called: String,
    frontier: bool,
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
                called: f.name.replace("{v}", &show(&parts)),
                frontier: at_least(&parts, &floor),
                floor: show(&floor),
            });
        }
    }
    None
}

/// Whether `provider`/`model` may do governed work. Unknown, empty and unrecognised are not.
#[must_use]
pub fn is_frontier(provider: &str, model: &str) -> bool {
    find(provider, model).is_some_and(|f| f.frontier)
}

/// The allowed models for people, one per family: `Claude Opus 5.5`.
#[must_use]
pub fn allowed() -> Vec<String> {
    FILE.families
        .iter()
        .map(|f| f.name.replace("{v}", &f.min))
        .collect()
}

/// `Claude Opus 5.5 or later, ... and Gemini 4 Carbon or later`.
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
        }
    }

    #[test]
    fn both_sides_of_each_floor_and_the_words() {
        for (family, below, at) in [
            ("claude-opus-{}", "5-4", "5-5"),
            ("claude-fable-{}", "5-1", "5-2"),
            ("gpt-{}-astra", "6-1", "6-2"),
            ("gemini-{}-carbon", "3", "4"),
        ] {
            assert!(!is_frontier("p", &family.replace("{}", below)), "{family}");
            assert!(is_frontier("p", &family.replace("{}", at)), "{family}");
        }
        assert_eq!(
            allowed(),
            [
                "Claude Opus 5.5",
                "Claude Fable 5.2",
                "GPT-6.2 Astra",
                "Gemini 4 Carbon"
            ]
        );
        assert!(allowed_sentence().ends_with("and Gemini 4 Carbon or later"));
        assert_eq!(
            why_not("anthropic", "claude-opus-5-4"),
            "it is Claude Opus 5.4, and the lowest version allowed is 5.5"
        );
        assert_eq!(
            why_not("xai", "grok-4.7"),
            "it is not in a family on that list"
        );
        assert_eq!(
            split("openai-codex/gpt-6.2-astra"),
            ("openai-codex", "gpt-6.2-astra")
        );
    }

    #[test]
    fn the_plugins_copy_is_this_file() {
        let copy = include_str!("../../../../plugins/boopis/data/frontier-models.json");
        assert_eq!(copy, FRONTIER_JSON, "run scripts/sync-shared-data.sh");
    }
}
