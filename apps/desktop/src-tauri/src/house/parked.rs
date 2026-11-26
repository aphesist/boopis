//! Parked steps (`docs/specs/rules-engine.md` 8.3): a scheduled run's step a rule refused, written by the plugin as
//! `<root>/boopis/parked/<id>.json` with the exact arguments needed to run it again. The host shows each as an approval
//! card (never its arguments), and the owner's answer either deletes it (Deny) or re-runs it once (Approve, Always) in the
//! run's own session with a one-time grant (`local_api::service::Service::rerun_parked`).

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

/// The folder under the engine's root.
#[must_use]
pub fn folder(root: &Path) -> PathBuf {
    root.join("boopis").join("parked")
}

/// Whether `id` is a parked step's id (the plugin's `UUIDv7` shape).
#[must_use]
pub fn id_ok(id: &str) -> bool {
    let b = id.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(c)
            }
        })
}

/// One parked step as the plugin wrote it.
#[must_use]
pub fn read(root: &Path, id: &str) -> Option<Value> {
    if !id_ok(id) {
        return None;
    }
    let v: Value =
        serde_json::from_slice(&std::fs::read(folder(root).join(format!("{id}.json"))).ok()?)
            .ok()?;
    (v["id"] == id).then_some(v)
}

/// Delete a parked step (answered, or expired).
pub fn remove(root: &Path, id: &str) {
    if id_ok(id) {
        let _ = std::fs::remove_file(folder(root).join(format!("{id}.json")));
    }
}

fn expired(doc: &Value, now: &str) -> bool {
    let until = doc["expires_at"].as_str().unwrap_or_default();
    until.len() < 19 || now.len() < 19 || until[..19] <= now[..19]
}

/// The card a parked step is shown as: never its arguments.
#[must_use]
pub fn card(doc: &Value) -> Value {
    json!({
        "id": doc["id"],
        "bot": doc["bot"],
        "profile": doc["profile"],
        "session_id": doc["session_id"],
        "summary": doc["summary"],
        "action": doc["action"],
        "rules": doc["rules"],
        "held": doc.get("held").cloned().unwrap_or(Value::Null),
        "at": doc["at"],
        "expires_at": doc["expires_at"],
        "choices": ["once", "always", "deny"],
    })
}

/// Every parked step not expired, oldest first, as cards; an expired one is deleted ("Expired: run the job again from its
/// schedule"). `now` is an RFC 3339 time.
#[must_use]
pub fn list(root: &Path, now: &str) -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(folder(root))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".json")?.to_owned();
            let doc = read(root, &id)?;
            if expired(&doc, now) {
                remove(root, &id);
                return None;
            }
            Some(doc)
        })
        .collect();
    out.sort_by(|a, b| a["at"].as_str().cmp(&b["at"].as_str()));
    out.iter().map(card).collect()
}

/// The fixed message a re-run that resumed the run's session submits (8.3 step 3).
#[must_use]
pub fn message(doc: &Value) -> String {
    let action = [doc["summary"].as_str(), doc["action"].as_str()]
        .into_iter()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "[Approved step] The owner approved the step your scheduled run stopped at:\n{action}\nDo this step now, then finish only what depended on it, and report. Do not redo the rest of the run."
    )
}

/// The message a re-run that could not resume the run's session submits in a fresh one.
#[must_use]
pub fn fresh_message(doc: &Value) -> String {
    format!(
        "Your scheduled run's conversation could not be reopened, so this is a fresh one.\n{}",
        message(doc)
    )
}

/// A rules card's text for this step, for the plugin's `rules.draft` ("Always allow and re-run").
#[must_use]
pub fn card_text(doc: &Value) -> String {
    let mut lines = vec![format!(
        "{} asks: {}",
        doc["bot"].as_str().unwrap_or("a bot"),
        doc["summary"].as_str().unwrap_or("a step")
    )];
    if let Some(a) = doc["action"].as_str() {
        lines.push(a.to_owned());
    }
    for r in doc["rules"].as_array().into_iter().flatten() {
        if let Some(t) = r["text"].as_str() {
            lines.push(format!("Rule: \u{201c}{t}\u{201d}"));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0193a4b2-1c2d-7000-8000-00000000abcd";

    fn put(root: &Path, id: &str, expires: &str) {
        std::fs::create_dir_all(folder(root)).unwrap();
        let doc = json!({"id": id, "bot": "kai", "profile": "kai", "session_id": "s1", "tool": "terminal",
            "args": {"command": "git push --force origin main"}, "summary": "Run a command · git push",
            "action": "git push --force origin main", "rules": [{"id": "default.git_cloud", "text": "Ask before a force-push"}],
            "at": "2026-11-26T09:00:00.000000Z", "expires_at": expires});
        std::fs::write(folder(root).join(format!("{id}.json")), doc.to_string()).unwrap();
    }

    #[test]
    fn a_card_never_carries_the_arguments_and_an_expired_step_goes() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, "2026-12-03T09:00:00.000000Z");
        put(
            dir.path(),
            "0193a4b2-1c2d-7000-8000-00000000abce",
            "2026-11-25T09:00:00.000000Z",
        );
        let cards = list(dir.path(), "2026-11-26T10:00:00.000Z");
        assert_eq!(cards.len(), 1);
        assert!(cards[0].get("args").is_none() && cards[0]["id"] == ID);
        assert_eq!(std::fs::read_dir(folder(dir.path())).unwrap().count(), 1);
        assert!(read(dir.path(), "../x").is_none());
        let doc = read(dir.path(), ID).unwrap();
        assert!(
            message(&doc).starts_with("[Approved step]")
                && message(&doc).contains("git push --force")
        );
        assert!(boopis_rules::rule_card(&card_text(&doc)).is_some());
        remove(dir.path(), ID);
        assert!(read(dir.path(), ID).is_none());
    }
}
