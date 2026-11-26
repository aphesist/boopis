//! The cards the plugin raises for a rule, read back on the host's side (`docs/specs/rules-engine.md` sections 8 and 10;
//! the window's twin is `apps/desktop/ui/src/host/live/rules.ts`, `ruleCard`).
//!
//! A rules card reads, in the engine's `description`:
//!
//! ```text
//! kai asks: Run a command · git push
//! git push --force origin main
//! Rule: “Ask before a git force-push …”
//! (Asked for by @nina, …)
//! ```
//!
//! Only such a card may be answered `session` or `always` from outside the window (`host-protections.md` H6), and
//! `always` there only keeps a **draft** exception ([`card_draft`]): nothing standing becomes active without the owner.

use serde_json::{Map, Value};

/// What a rules card says.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuleCard {
    /// The rule's words, verbatim (several joined by ` · `); `None` on a card the reviewer could not check.
    pub rule: Option<String>,
    /// What a standing answer covers: the words after ` · ` on the first line.
    pub scope: Option<String>,
}

fn head(line: &str) -> Option<&str> {
    let (who, rest) = line.split_once(" asks: ")?;
    let ok = !who.is_empty()
        && who.len() <= 64
        && who
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
    (ok && !rest.is_empty()).then_some(rest)
}

/// The rule and the scope of a card the rules engine raised, or `None` for any other approval.
#[must_use]
pub fn rule_card(description: &str) -> Option<RuleCard> {
    let lines: Vec<&str> = description
        .split('\n')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let words = head(lines.first()?)?;
    let rules: Vec<&str> = lines
        .iter()
        .filter_map(|l| l.strip_prefix("Rule: “")?.strip_suffix('”'))
        .collect();
    let held = lines
        .iter()
        .any(|l| l.starts_with("The reviewer could not check this"));
    if rules.is_empty() && !held {
        return None;
    }
    Some(RuleCard {
        rule: (!rules.is_empty()).then(|| rules.join(" · ")),
        scope: words
            .find(" · ")
            .filter(|i| *i > 0)
            .map(|i| words[i + " · ".len()..].trim().to_owned()),
    })
}

/// The exception the plugin drafted (`rules.draft`) as the rule the host keeps for an "Always" answer: always a draft
/// (`state: draft`), from a card (`source: card`). `None` when the draft names no rule to except or has no text.
#[must_use]
pub fn card_draft(draft: &Value) -> Option<Value> {
    let d = draft.as_object()?;
    let excepts = d.get("excepts").and_then(Value::as_array)?;
    if excepts.is_empty() || !d.get("text").is_some_and(Value::is_string) {
        return None;
    }
    let mut rule: Map<String, Value> = d.clone();
    rule.remove("id");
    rule.insert("type".into(), "exception".into());
    rule.insert("source".into(), "card".into());
    rule.insert("state".into(), "draft".into());
    rule.insert("enabled".into(), Value::Bool(true));
    Some(Value::Object(rule))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use serde_json::json;

    use super::*;

    const CARD: &str = "kai asks: Run a command · git push\ngit push --force origin main\nRule: “Ask before a git force-push”\n(Asked for by @nina)";

    #[test]
    fn a_rules_card_gives_its_rule_and_scope_and_others_none() {
        let c = rule_card(CARD).unwrap();
        assert_eq!(c.rule.as_deref(), Some("Ask before a git force-push"));
        assert_eq!(c.scope.as_deref(), Some("git push"));
        let held =
            rule_card("kai asks: Use a tool\nThe reviewer could not check this, so it asks.")
                .unwrap();
        assert_eq!(
            held,
            RuleCard {
                rule: None,
                scope: None
            }
        );
        for other in [
            "",
            "Run rm -rf build?",
            "kai asks: Run a command · ls\nno rule here",
            "k a i asks: x\nRule: “y”",
        ] {
            assert!(rule_card(other).is_none(), "{other:?}");
        }
    }

    #[test]
    fn an_always_answer_keeps_only_a_draft() {
        let d = json!({"id": "x", "text": "Allow git push to origin for kai", "excepts": ["user.1"], "applies_to": ["kai"], "state": "active"});
        let r = card_draft(&d).unwrap();
        assert_eq!(
            (
                r["state"].as_str(),
                r["type"].as_str(),
                r["source"].as_str()
            ),
            (Some("draft"), Some("exception"), Some("card"))
        );
        assert!(r.get("id").is_none());
        assert!(card_draft(&json!({"text": "t", "excepts": []})).is_none());
        assert!(card_draft(&json!({"excepts": ["a"]})).is_none());
    }
}
