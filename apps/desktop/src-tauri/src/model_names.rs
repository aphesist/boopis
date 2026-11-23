//! The shared names table (`apps/shared/data/model-names.json`) as the host reads it: the short names a provider floats (`haiku`
//! is the newest Claude Haiku, `claude-haiku-5-5` today) and the rule that tells two spellings of one model from two models.
//!
//! The UI reads the same table in `ui/src/components/model-name.ts` (`canon`, `sameModel`, `aliasOf`), which is what lets its
//! model picker show `haiku` and `claude-haiku-5-5[1m]` as one row; the plugin reads it in `governance/roster.py`. This reader
//! keeps the UI's rule and is tested against the UI's own examples.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde_json::Value;

/// The shared table.
pub const NAMES_JSON: &str = include_str!("../../../shared/data/model-names.json");

/// Alias to the id it points at today (`aliases` of the table; its `about` text is not an alias).
static ALIASES: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str::<Value>(NAMES_JSON)
        .ok()
        .and_then(|v| v.get("aliases").and_then(Value::as_object).cloned())
        .map(|m| {
            m.into_iter()
                .filter_map(|(alias, row)| {
                    Some((
                        alias.to_lowercase(),
                        row.get("pinned")?.as_str()?.to_owned(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
});

/// The id the alias `alias` points at today (`fable` is `claude-fable-5-2`), `None` for a name that is not an alias.
#[must_use]
pub fn pinned(alias: &str) -> Option<&'static str> {
    ALIASES
        .get(&alias.trim().to_lowercase())
        .map(String::as_str)
}

/// Whether `id` is an alias: a short name the provider resolves to its newest model of that tier.
#[must_use]
pub fn is_alias(id: &str) -> bool {
    pinned(id).is_some()
}

/// One model's id as compared: the part after the last `/`, lower case, a bracketed suffix (`[1m]`) dropped, an alias
/// resolved to the id it points at (the UI's `canon`).
#[must_use]
pub fn canon(id: &str) -> String {
    let last = id.trim().rsplit('/').next().unwrap_or("").to_lowercase();
    let mut plain = String::with_capacity(last.len());
    let mut depth = 0u32;
    for c in last.chars() {
        match c {
            '[' => depth += 1,
            ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => plain.push(c),
            _ => {}
        }
    }
    pinned(&plain).map_or(plain, str::to_owned)
}

/// Whether two ids name the same model today: the same id with or without its suffix, or an alias and the id it points at.
/// Empty names nothing.
#[must_use]
pub fn same(a: &str, b: &str) -> bool {
    let (a, b) = (canon(a), canon(b));
    !a.is_empty() && a == b
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The UI's examples (`model-name.test.ts`, "same model").
    #[test]
    fn an_alias_and_the_id_it_points_at_are_one_model() {
        assert!(same("haiku", "claude-haiku-5-5[1m]"));
        assert!(same("HAIKU", "claude-haiku-5-5"));
        assert!(same("claude-sub/opus", "claude-opus-5-5[1m]"));
        assert!(!same("haiku", "sonnet"));
        assert!(!same("", ""));
        assert_eq!(pinned("opus"), Some("claude-opus-5-5"));
        assert_eq!(pinned("fable"), Some("claude-fable-5-2"));
        assert!(is_alias("sonnet"));
        assert!(!is_alias("gpt-5"));
        assert!(!is_alias("about"), "the table's own note is not an alias");
        assert_eq!(
            canon("anthropic/claude-sonnet-5-5[1m]"),
            "claude-sonnet-5-5"
        );
    }
}
