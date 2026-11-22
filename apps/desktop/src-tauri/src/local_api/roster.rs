//! The roster: the bots of the machine as the island wants them, in one row each. Built from what the engine's
//! `profiles.list` says, what the plugin's `bots.read` holds (the look the owner chose, whether boopis keeps a record), and,
//! for a bot whose row has no model, `profiles.describe` (the engine's roster drops `model` and `provider` for a named
//! profile; the playtest's B10). Nothing is invented: a model that nobody says stays null.

use std::collections::HashMap;

use serde_json::Value;

use super::look::{self, Look};

/// The prefix an archived teammate's profile carries (the plugin's rule, `bots/homes.py`).
pub const ARCHIVE_PREFIX: &str = "archived--";

/// One bot before its presence is added.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// The profile name.
    pub name: String,
    /// The name a person reads.
    pub display_name: String,
    /// What the bot is for.
    pub role: String,
    /// `provider/model`, or the model alone; null when nobody says.
    pub model: Option<String>,
    /// The provider, null when unknown.
    pub provider: Option<String>,
    /// The look.
    pub look: Look,
    /// Whether boopis keeps a record of its own for it.
    pub known_to_boopis: bool,
    /// Whether the bot runs governed (its own record says so; a bot with none is ungoverned, ADR-0042).
    pub governed: bool,
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_owned()
}

fn model_label(provider: &str, model: &str) -> Option<String> {
    let (p, m) = (provider.trim(), model.trim());
    if m.is_empty() {
        return None;
    }
    Some(if p.is_empty() { m.to_owned() } else { format!("{p}/{m}") })
}

/// The profiles whose row lacks a model: the ones `profiles.describe` should be asked about.
#[must_use]
pub fn needs_describe(profiles: &Value) -> Vec<String> {
    profiles
        .get("profiles")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter(|r| text(r, "model").is_empty())
                .map(|r| text(r, "name"))
                .filter(|n| !n.is_empty() && !n.starts_with(ARCHIVE_PREFIX))
                .collect()
        })
        .unwrap_or_default()
}

/// Build the roster from `profiles.list`'s answer, the plugin's `bots.read` answer (when it answered) and the
/// `profiles.describe` answers by name. Archived teammates are left out.
#[must_use]
pub fn build(profiles: &Value, plugin: Option<&Value>, described: &HashMap<String, Value>) -> Vec<Entry> {
    let mut records: HashMap<String, (&Value, bool)> = HashMap::new();
    if let Some(bots) = plugin.and_then(|p| p.get("bots")).and_then(Value::as_array) {
        for b in bots {
            let archived = b.get("archived").is_some_and(|a| !a.is_null());
            let record = b.get("record").filter(|r| !r.is_null());
            if let (Some(name), Some(record)) = (b.get("name").and_then(Value::as_str), record) {
                records.insert(name.to_owned(), (record, archived));
            } else if let Some(name) = b.get("name").and_then(Value::as_str) {
                records.insert(name.to_owned(), (&Value::Null, archived));
            }
        }
    }
    let Some(rows) = profiles.get("profiles").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for row in rows {
        let name = text(row, "name");
        if name.is_empty() || name.starts_with(ARCHIVE_PREFIX) {
            continue;
        }
        let own = records.get(&name);
        if own.is_some_and(|(_, archived)| *archived) {
            continue;
        }
        let record = own.map(|(r, _)| *r).filter(|r| !r.is_null());
        let shown = {
            let d = text(row, "display_name");
            if d.is_empty() { name.clone() } else { d }
        };
        let (mut provider, mut model) = (text(row, "provider"), text(row, "model"));
        if model.is_empty()
            && let Some(d) = described.get(&name).and_then(|d| d.get("model"))
        {
            model = text(d, "default");
            if provider.is_empty() {
                provider = text(d, "provider");
            }
        }
        out.push(Entry {
            // The default look is keyed by the name a person reads, as the window keys it.
            look: look::resolve(&shown, record),
            display_name: shown,
            role: text(row, "description"),
            model: model_label(&provider, &model),
            provider: (!provider.is_empty()).then_some(provider),
            known_to_boopis: record.is_some_and(|r| ["look", "settings", "approvals"].iter().any(|k| r.get(*k).is_some())),
            governed: record
                .and_then(|r| r.get("settings"))
                .and_then(|s| s.get("gov"))
                .and_then(Value::as_str)
                == Some("governed"),
            name,
        });
    }
    out
}

/// The names whose row differs between two rosters, including those added and removed.
#[must_use]
pub fn changed(old: &[Entry], new: &[Entry]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for n in new {
        if old.iter().find(|o| o.name == n.name) != Some(n) {
            names.push(n.name.clone());
        }
    }
    for o in old {
        if !new.iter().any(|n| n.name == o.name) {
            names.push(o.name.clone());
        }
    }
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn profiles() -> Value {
        json!({"profiles": [
            {"name": "default", "model": "opus", "provider": "claude-subscription", "display_name": "", "description": ""},
            {"name": "kai", "model": "", "provider": "", "display_name": "Kai", "description": "the editor"},
            {"name": "nina", "model": "", "provider": "", "display_name": "", "description": ""},
            {"name": "archived--old", "model": "", "provider": "", "display_name": "", "description": ""},
            {"name": "gone", "model": "x", "provider": "p", "display_name": "", "description": ""}
        ]})
    }

    fn plugin() -> Value {
        json!({"bots": [
            {"name": "kai", "record": {"look": {"shape": "hexagon", "color": "#a6a6ab"}, "settings": {"gov": "governed"}}, "archived": null},
            {"name": "nina", "record": null, "archived": null},
            {"name": "gone", "record": {"look": {}}, "archived": {"name": "gone"}}
        ]})
    }

    #[test]
    fn the_look_the_owner_chose_is_in_the_row_and_the_default_fills_the_rest() {
        let rows = build(&profiles(), Some(&plugin()), &HashMap::new());
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["default", "kai", "nina"], "archived teammates and prefixed profiles are left out");
        let kai = &rows[1];
        assert_eq!((kai.look.shape.as_str(), kai.look.color.as_str()), ("hexagon", "#a6a6ab"));
        assert_eq!(kai.display_name, "Kai");
        assert_eq!(kai.role, "the editor");
        assert!(kai.known_to_boopis);
        let nina = &rows[2];
        assert_eq!(nina.look, look::look_for("nina"));
        assert!(!nina.known_to_boopis, "a bot made outside boopis has no record");
    }

    #[test]
    fn a_missing_model_is_read_from_the_description_and_never_invented() {
        let mut described = HashMap::new();
        described.insert(
            "kai".to_owned(),
            json!({"model": {"provider": "claude-subscription-directsdk-experimental", "default": "opus"}}),
        );
        let rows = build(&profiles(), Some(&plugin()), &described);
        assert_eq!(rows[1].model.as_deref(), Some("claude-subscription-directsdk-experimental/opus"));
        assert_eq!(rows[1].provider.as_deref(), Some("claude-subscription-directsdk-experimental"));
        assert_eq!(rows[2].model, None, "nobody said");
        assert_eq!(rows[0].model.as_deref(), Some("claude-subscription/opus"));
    }

    #[test]
    fn the_bots_to_describe_are_those_with_no_model() {
        assert_eq!(needs_describe(&profiles()), ["kai", "nina"]);
    }

    #[test]
    fn a_plugin_that_did_not_answer_leaves_defaults_and_marks_nothing() {
        let rows = build(&profiles(), None, &HashMap::new());
        assert_eq!(rows.len(), 4, "without the plugin an archived record cannot be known; only the prefix is");
        assert!(rows.iter().all(|r| !r.known_to_boopis));
        assert_eq!(rows[1].look, look::look_for("Kai"));
    }

    #[test]
    fn what_moved_between_two_reads_is_named() {
        let old = build(&profiles(), Some(&plugin()), &HashMap::new());
        let mut changed_plugin = plugin();
        changed_plugin["bots"][0]["record"]["look"]["color"] = json!("#f23b5a");
        let new = build(&profiles(), Some(&changed_plugin), &HashMap::new());
        assert_eq!(changed(&old, &new), ["kai"]);
        assert!(changed(&old, &old).is_empty());
        assert_eq!(changed(&old, &new[..2]), ["kai", "nina"]);
    }
}
