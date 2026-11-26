#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a test fails loudly"
)]

use serde_json::{Value, json};

use super::{RulesError, Store, now_text, shipped};

const NOW: &str = "2026-11-26T10:00:00.000Z";

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::under(dir.path());
    (dir, s)
}

fn ids(doc: &Value) -> Vec<String> {
    doc["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn the_shipped_defaults_are_the_owner_s_eight() {
    let (version, kinds, rules) = shipped().unwrap();
    assert_eq!(version, 1);
    assert!(kinds.contains(&"commands".to_owned()));
    assert_eq!(rules.len(), 8);
    assert!(
        rules
            .iter()
            .all(|r| r["id"].as_str().unwrap().starts_with("default."))
    );
}

#[test]
fn a_root_with_no_file_gets_the_defaults_once_and_a_private_file() {
    let (_d, s) = store();
    let (doc, digest) = s.ensure(NOW).unwrap();
    assert_eq!(doc["revision"], 0);
    assert_eq!(ids(&doc).len(), 8);
    assert_eq!(digest.len(), 64);
    let (again, same) = s.ensure(NOW).unwrap();
    assert_eq!(again, doc);
    assert_eq!(same, digest, "nothing changed, nothing was written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(s.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    assert!(
        !s.path().with_extension("json.lock").exists(),
        "the lock is released"
    );
}

#[test]
fn a_new_rule_gets_an_id_and_a_stale_revision_is_a_conflict() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let rule = json!({"type": "ask", "text": "Ask before emailing anyone at example.com."});
    let (rev, id) = s.put(&rule, 0, NOW).unwrap();
    assert_eq!(rev, 1);
    assert!(id.starts_with("r_"));
    let (doc, _) = s.read().unwrap().unwrap();
    let saved = doc["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id.as_str())
        .unwrap();
    assert_eq!(saved["source"], "owner");
    assert_eq!(saved["enabled"], true);
    assert_eq!(saved["bots"], Value::Null);
    assert!(
        saved["kinds"].as_array().unwrap().len() > 5,
        "every kind until the reviewer drafts them"
    );
    assert_eq!(
        s.put(&rule, 0, NOW),
        Err(RulesError::Conflict { current: 1 })
    );
}

#[test]
fn text_must_be_one_short_line() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    for text in ["", "two\nlines", &"x".repeat(201)] {
        let got = s.put(&json!({"type": "ask", "text": text}), 0, NOW);
        assert!(matches!(got, Err(RulesError::Invalid(_))), "{text:?}");
    }
    let bad = [
        json!({"type": "maybe", "text": "x"}),
        json!({"type": "ask", "text": "x", "kinds": ["telepathy"]}),
        json!({"type": "ask", "text": "x", "bots": ["no spaces"]}),
        json!({"type": "ask", "text": "x", "source": "default"}),
        json!({"type": "exception", "text": "x"}),
        json!({"type": "exception", "text": "x", "excepts": ["default.secrets"], "state": "half"}),
    ];
    for rule in bad {
        assert!(
            matches!(s.put(&rule, 0, NOW), Err(RulesError::Invalid(_))),
            "{rule}"
        );
    }
    assert_eq!(
        s.read().unwrap().unwrap().0["revision"],
        0,
        "nothing was written"
    );
}

#[test]
fn an_edited_default_is_marked_and_unknown_keys_are_kept() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let edit = json!({"id": "default.purchases", "text": "Ask before purchases over $50.", "note": "mine"});
    s.put(&edit, 0, NOW).unwrap();
    let (doc, _) = s.read().unwrap().unwrap();
    let r = doc["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "default.purchases")
        .unwrap();
    assert_eq!(
        (r["edited"].clone(), r["source"].clone(), r["note"].clone()),
        (json!(true), json!("default"), json!("mine"))
    );
    assert_eq!(r["type"], "ask");
}

#[test]
fn a_removed_default_stays_removed_and_undo_puts_it_back() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let (rev, old) = s.remove("default.messages", 0, NOW).unwrap();
    assert_eq!(rev, 1);
    let (doc, _) = s.read().unwrap().unwrap();
    assert!(!ids(&doc).contains(&"default.messages".to_owned()));
    assert_eq!(doc["removed_defaults"], json!(["default.messages"]));
    // a newer defaults version does not bring it back
    let mut bumped = doc.clone();
    bumped["defaults_version"] = json!(0);
    std::fs::write(s.path(), serde_json::to_vec(&bumped).unwrap()).unwrap();
    let (after, _) = s.ensure(NOW).unwrap();
    assert!(!ids(&after).contains(&"default.messages".to_owned()));
    s.reinsert(&old, NOW).unwrap();
    let (back, _) = s.read().unwrap().unwrap();
    assert!(ids(&back).contains(&"default.messages".to_owned()));
    assert_eq!(back["removed_defaults"], json!([]));
    assert_eq!(
        s.remove("nope", revision(&back), NOW),
        Err(RulesError::NotFound)
    );
}

fn revision(doc: &Value) -> u64 {
    doc["revision"].as_u64().unwrap()
}

#[test]
fn restore_defaults_brings_back_the_shipped_text() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    s.put(
        &json!({"id": "default.secrets", "text": "Ask before reading .env."}),
        0,
        NOW,
    )
    .unwrap();
    s.remove("default.purchases", 1, NOW).unwrap();
    s.restore_defaults(Some(&["default.secrets".to_owned()]), NOW)
        .unwrap();
    let (doc, _) = s.read().unwrap().unwrap();
    let r = doc["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "default.secrets")
        .unwrap();
    assert_eq!(r["edited"], false);
    assert!(
        !ids(&doc).contains(&"default.purchases".to_owned()),
        "only the named one"
    );
    s.restore_defaults(None, NOW).unwrap();
    assert!(ids(&s.read().unwrap().unwrap().0).contains(&"default.purchases".to_owned()));
}

#[test]
fn an_exception_from_a_card_keeps_its_match_and_may_be_a_draft() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let ex = json!({"type": "exception", "text": "kai may force-push feature branches.", "source": "card",
        "bots": ["kai"], "excepts": ["default.git_cloud"], "match": ["Bash(git push --force origin feature/*)"],
        "match_cwd": "~/repos/site", "state": "draft"});
    let (_, id) = s.put(&ex, 0, NOW).unwrap();
    assert!(id.starts_with("x_"));
    let (doc, _) = s.read().unwrap().unwrap();
    let r = doc["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id.as_str())
        .unwrap();
    assert_eq!(
        (r["state"].clone(), r["source"].clone()),
        (json!("draft"), json!("card"))
    );
    s.set_enabled(&id, false, 1, NOW).unwrap();
}

#[test]
fn a_file_this_boopis_cannot_read_is_never_overwritten() {
    let (_d, s) = store();
    std::fs::create_dir_all(s.path().parent().unwrap()).unwrap();
    for text in [
        "{not json",
        r#"{"schema_version": 99, "rules": []}"#,
        r#"{"rules": []}"#,
    ] {
        std::fs::write(s.path(), text).unwrap();
        assert!(
            matches!(s.ensure(NOW), Err(RulesError::Unreadable(_))),
            "{text}"
        );
        assert!(matches!(
            s.put(&json!({"type": "ask", "text": "x"}), 0, NOW),
            Err(RulesError::Unreadable(_))
        ));
        assert_eq!(std::fs::read_to_string(s.path()).unwrap(), text);
    }
}

#[test]
fn a_held_lock_is_busy_and_a_dead_writer_s_lock_is_taken_over() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let lock = s.path().with_extension("json.lock");
    std::fs::write(&lock, "").unwrap();
    assert_eq!(
        s.set_enabled("default.secrets", false, 0, NOW),
        Err(RulesError::Busy)
    );
    let old = std::time::SystemTime::now() - std::time::Duration::from_mins(1);
    std::fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(old)
        .unwrap();
    assert_eq!(s.set_enabled("default.secrets", false, 0, NOW), Ok(1));
}

#[test]
fn the_reviewer_is_auto_or_pinned_with_a_whole_route() {
    let (_d, s) = store();
    s.ensure(NOW).unwrap();
    let got = s
        .set_reviewer("pinned", Some("gemini"), Some("gemini-2.5-flash"), NOW)
        .unwrap();
    assert_eq!(got["provider"], "gemini");
    assert_eq!(s.read().unwrap().unwrap().0["reviewer"]["mode"], "pinned");
    assert!(s.set_reviewer("pinned", None, None, NOW).is_err());
    assert!(s.set_reviewer("auto", Some("x"), None, NOW).is_err());
    assert!(s.set_reviewer("smart", None, None, NOW).is_err());
    assert!(s.set_reviewer("auto", None, None, NOW).is_ok());
}

#[test]
fn the_time_is_rfc_3339() {
    let t = now_text();
    assert_eq!(t.len(), 24);
    assert!(t.ends_with('Z') && t.as_bytes()[10] == b'T');
    assert!(t.starts_with("20"));
}
