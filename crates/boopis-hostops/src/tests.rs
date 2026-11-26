#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::many_single_char_names,
    clippy::needless_pass_by_value,
    clippy::cloned_ref_to_slice_refs
)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::audit::Audit;
use crate::grants::Grants;
use crate::plans::{self, PlanStore, Proposal};
use crate::protocol::{self, VERBS};
use crate::{Call, Dispatcher, OpFuture, Ops, Refusal};

const TOKEN: &str = "t0k3n";
const NOW: u64 = 1_790_000_000_000;

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<(String, bool)>>,
    fail: Mutex<bool>,
}

impl Ops for Fake {
    fn call<'a>(&'a self, call: Call<'a>) -> OpFuture<'a> {
        Box::pin(async move {
            let n = {
                let mut c = self.calls.lock().unwrap();
                c.push((call.op.to_owned(), call.dry_run));
                c.len()
            };
            if *self.fail.lock().unwrap() {
                return Err(Refusal::new("hx.engine.unavailable", "no"));
            }
            if call.dry_run {
                return Ok(json!({"would": "send"}));
            }
            Ok(match call.op {
                "bot.say" => json!({"session_id": format!("s{n}"), "created": true}),
                "room.run" | "bot.run" => {
                    json!({"run_id": format!("r{n}"), "session_id": format!("s{n}")})
                }
                _ => json!({"status": "sent", "n": n}),
            })
        })
    }
}

struct World {
    dir: tempfile::TempDir,
    d: Dispatcher,
    ops: Fake,
    grants: Arc<Grants>,
    mono: Instant,
}

fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let grants = Arc::new(Grants::default());
    let d = Dispatcher::new(
        TOKEN.into(),
        &dir.path().join("house"),
        Audit::at(&dir.path().join("audit/house-ops.jsonl")),
        grants.clone(),
    );
    World {
        dir,
        d,
        ops: Fake::default(),
        grants,
        mono: Instant::now(),
    }
}

impl World {
    /// Ask with fresh rate-limit buckets (each call a second later on the monotonic clock).
    async fn ask(&mut self, req: Value) -> Value {
        self.mono += Duration::from_secs(6);
        self.ask_at(req, self.mono).await
    }
    async fn ask_at(&self, req: Value, mono: Instant) -> Value {
        let out = self
            .d
            .handle(&self.ops, &req.to_string(), true, mono, NOW)
            .await;
        assert!(
            out.ends_with('\n') && out.matches('\n').count() == 1,
            "{out}"
        );
        serde_json::from_str(out.trim()).unwrap()
    }
    fn calls(&self) -> usize {
        self.ops.calls.lock().unwrap().len()
    }
    fn audit(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("audit/house-ops.jsonl")).unwrap_or_default()
    }
}

fn req(op: &str, id: Option<&str>, params: Value) -> Value {
    let mut r = json!({"v": 1, "token": TOKEN, "op": op, "params": params});
    if let Some(i) = id {
        r["id"] = i.into();
    }
    r
}

fn code(v: &Value) -> &str {
    v["code"].as_str().unwrap_or("")
}

#[test]
fn the_verb_list_is_pinned_and_holds_no_answer() {
    assert_eq!(
        VERBS,
        [
            "team.plan",
            "room.say",
            "room.run",
            "room.log",
            "room.stop",
            "bot.say",
            "bot.run",
            "session.stop",
            "jobs.get",
            "jobs.put",
            "grant.redeem"
        ]
    );
    for v in VERBS {
        for word in [
            "apply", "undo", "approv", "reject", "clarify", "form", "secret", "config", "rules",
            "budget", "token",
        ] {
            assert!(!v.contains(word), "{v}");
        }
    }
}

#[tokio::test]
async fn forbidden_verbs_are_not_found() {
    let mut w = world();
    for op in [
        "team.apply",
        "team.undo",
        "team.reject",
        "approval.respond",
        "clarify.respond",
        "form.submit",
        "form.cancel",
        "secret.get",
        "config.set",
        "rules.put",
        "budget.set",
        "token.rotate",
        "nope",
    ] {
        let r = w.ask(req(op, Some("k"), json!({}))).await;
        assert_eq!(code(&r), "hx.method_not_found", "{op}");
    }
    assert_eq!(w.calls(), 0);
}

#[tokio::test]
async fn a_refused_peer_a_wrong_token_and_a_wrong_version_get_one_answer() {
    let mut w = world();
    let good = req("room.log", None, json!({"room_id": "g-1"}));
    let mut wrong = good.clone();
    wrong["token"] = "other".into();
    let mut v2 = good.clone();
    v2["v"] = 2.into();
    let a = w.ask(wrong).await;
    let b = w.ask(v2).await;
    let c: Value = serde_json::from_str(
        w.d.handle(&w.ops, &good.to_string(), false, w.mono, NOW)
            .await
            .trim(),
    )
    .unwrap();
    let d: Value = serde_json::from_str(
        w.d.handle(&w.ops, "garbage", false, w.mono, NOW)
            .await
            .trim(),
    )
    .unwrap();
    assert_eq!(code(&a), "hx.host.unauthorized");
    assert_eq!(a, b);
    assert_eq!(a, c);
    assert_eq!(a, d);
    assert_eq!(w.calls(), 0);
    assert_eq!(code(&w.ask(good).await), "");
}

#[tokio::test]
async fn a_change_without_a_key_is_refused() {
    let mut w = world();
    let r = w
        .ask(req(
            "room.say",
            None,
            json!({"room_id": "g-1", "text": "hi"}),
        ))
        .await;
    assert_eq!(code(&r), "hx.invalid_params");
    let long = "k".repeat(201);
    let r = w
        .ask(req(
            "room.say",
            Some(&long),
            json!({"room_id": "g-1", "text": "hi"}),
        ))
        .await;
    assert_eq!(code(&r), "hx.invalid_params");
    assert_eq!(w.calls(), 0);
}

#[tokio::test]
async fn prune_from_the_channel_is_the_owners_only() {
    let mut w = world();
    let r = w
        .ask(req(
            "team.plan",
            Some("k"),
            json!({"fragment": "bots: {}", "reason": "x", "prune": true}),
        ))
        .await;
    assert_eq!(code(&r), "hx.team.prune_owner_only");
    assert_eq!(w.calls(), 0);
}

#[tokio::test]
async fn a_bot_is_never_given_the_owners_open_thread() {
    let mut w = world();
    let r = w
        .ask(req(
            "bot.say",
            Some("k1"),
            json!({"bot": "kai", "text": "hi", "session": "latest"}),
        ))
        .await;
    assert_eq!(code(&r), "hx.invalid_params");
    let r = w
        .ask(req(
            "bot.say",
            Some("k2"),
            json!({"bot": "kai", "text": "hi", "session": "s-owner"}),
        ))
        .await;
    assert_eq!(
        code(&r),
        "hx.invalid_params",
        "a session this job did not start"
    );
    // A job opens, starts a session, and may then speak in it again.
    w.d.jobs()
        .put("j1", &json!({"kind": "opened", "title": "t"}), NOW)
        .unwrap();
    let r = w
        .ask(req(
            "bot.say",
            Some("k3"),
            json!({"bot": "kai", "text": "hi", "session": "new", "job_id": "j1"}),
        ))
        .await;
    let sid = r["result"]["session_id"].as_str().unwrap().to_owned();
    let r = w
        .ask(req(
            "bot.say",
            Some("k4"),
            json!({"bot": "kai", "text": "again", "session": sid, "job_id": "j1"}),
        ))
        .await;
    assert_eq!(r["ok"], true, "{r}");
    let r = w
        .ask(req(
            "bot.say",
            Some("k5"),
            json!({"bot": "mira", "text": "x", "session": sid, "job_id": "j1"}),
        ))
        .await;
    assert_eq!(code(&r), "hx.invalid_params", "another bot's session id");
}

#[tokio::test]
async fn one_key_acts_once() {
    let mut w = world();
    let r1 = w
        .ask(req(
            "room.run",
            Some("house/j/1"),
            json!({"room_id": "g-1", "task": "go"}),
        ))
        .await;
    let r2 = w
        .ask(req(
            "room.run",
            Some("house/j/1"),
            json!({"room_id": "g-1", "task": "go"}),
        ))
        .await;
    assert_eq!(r1, r2);
    assert_eq!(w.calls(), 1);
    let other = w
        .ask(req(
            "room.say",
            Some("house/j/1"),
            json!({"room_id": "g-1", "text": "x"}),
        ))
        .await;
    assert_eq!(
        code(&other),
        "hx.invalid_params",
        "a key used for another verb"
    );
}

#[tokio::test]
async fn a_failed_call_frees_its_key() {
    let mut w = world();
    *w.ops.fail.lock().unwrap() = true;
    let r = w
        .ask(req("room.stop", Some("k"), json!({"room_id": "g-1"})))
        .await;
    assert_eq!(code(&r), "hx.engine.unavailable");
    *w.ops.fail.lock().unwrap() = false;
    let r = w
        .ask(req("room.stop", Some("k"), json!({"room_id": "g-1"})))
        .await;
    assert_eq!(r["ok"], true);
    assert_eq!(w.calls(), 2);
}

#[tokio::test]
async fn a_dry_run_changes_nothing_not_even_the_run_table() {
    let mut w = world();
    for (op, p) in [
        ("room.say", json!({"room_id": "g-1", "text": "x"})),
        ("room.run", json!({"room_id": "g-1", "task": "x"})),
        ("room.stop", json!({"room_id": "g-1"})),
        (
            "bot.say",
            json!({"bot": "kai", "text": "x", "session": "new"}),
        ),
        ("bot.run", json!({"bot": "kai", "goal": "x"})),
        ("session.stop", json!({"bot": "kai", "session_id": "s1"})),
        (
            "jobs.put",
            json!({"job_id": "j", "line": {"kind": "opened"}}),
        ),
        (
            "grant.redeem",
            json!({"grant": "g", "purpose": "budget.set"}),
        ),
    ] {
        let mut r = req(op, Some("dry"), p);
        r["dry_run"] = true.into();
        let a = w.ask(r).await;
        assert!(a["result"]["would"].is_string(), "{op}: {a}");
    }
    assert!(!w.dir.path().join("house/ops.json").exists());
    assert!(!w.dir.path().join("house/jobs.jsonl").exists());
}

#[tokio::test]
async fn a_run_table_that_cannot_be_written_refuses_the_change() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("house"),
        "a file where the folder should be",
    )
    .unwrap();
    let d = Dispatcher::new(
        TOKEN.into(),
        &dir.path().join("house"),
        Audit::none(),
        Arc::default(),
    );
    let ops = Fake::default();
    let out = d
        .handle(
            &ops,
            &req("room.say", Some("k"), json!({"room_id": "g", "text": "x"})).to_string(),
            true,
            Instant::now(),
            NOW,
        )
        .await;
    assert!(out.contains("hx.host.store_failed"), "{out}");
    assert_eq!(ops.calls.lock().unwrap().len(), 0);
}

#[tokio::test]
async fn changes_are_rate_limited() {
    let w = world();
    let t = Instant::now();
    let mut codes = Vec::new();
    for i in 0..4 {
        let r = w
            .ask_at(
                req("room.stop", Some(&format!("k{i}")), json!({"room_id": "g"})),
                t,
            )
            .await;
        codes.push(code(&r).to_owned());
    }
    assert_eq!(
        codes,
        ["", "", "hx.host.rate_limited", "hx.host.rate_limited"]
    );
    let r = w
        .ask_at(
            req("room.stop", Some("k9"), json!({"room_id": "g"})),
            t + Duration::from_millis(600),
        )
        .await;
    assert_eq!(r["ok"], true);
}

#[tokio::test]
async fn a_bot_cannot_close_a_job_that_spent_money() {
    let mut w = world();
    let put = |line: Value| req("jobs.put", Some("k"), json!({"job_id": "j1", "line": line}));
    assert_eq!(
        code(&w.ask(put(json!({"kind": "step"}))).await),
        "hx.invalid_params",
        "no such job yet"
    );
    w.ask(put(json!({"kind": "opened", "title": "Build a team"})))
        .await;
    w.ask(put(json!({"kind": "step", "bot": "kai", "state": "running", "spend": {"usd_est": 0.02, "turns": 3}}))).await;
    let r = w.ask(put(json!({"kind": "state", "state": "done"}))).await;
    assert_eq!(r["result"]["job"]["state"], "done_suggested", "{r}");
    let r = w.ask(put(json!({"kind": "started", "what": {}}))).await;
    assert_eq!(
        code(&r),
        "hx.invalid_params",
        "the plugin cannot write what the host started"
    );
    let jobs = w.ask(req("jobs.get", None, json!({}))).await;
    assert_eq!(jobs["result"]["jobs"][0]["title"], "Build a team");
    assert_eq!(jobs["result"]["jobs"][0]["spend"]["turns"], 3);
}

#[tokio::test]
async fn a_job_without_spend_may_be_done() {
    let mut w = world();
    let put = |line: Value| req("jobs.put", Some("k"), json!({"job_id": "j2", "line": line}));
    w.ask(put(json!({"kind": "opened"}))).await;
    let r = w.ask(put(json!({"kind": "state", "state": "done"}))).await;
    assert_eq!(r["result"]["job"]["state"], "done");
    let open = w.ask(req("jobs.get", None, json!({}))).await;
    assert_eq!(open["result"]["jobs"], json!([]), "done jobs are not open");
}

#[tokio::test]
async fn the_audit_trail_never_holds_text_fragment_or_key() {
    let mut w = world();
    w.ask(req(
        "room.say",
        Some("house/secret-key/1"),
        json!({"room_id": "g-1", "text": "SECRET-TEXT"}),
    ))
    .await;
    w.ask(req(
        "team.plan",
        Some("house/secret-key/2"),
        json!({"fragment": "bots: {SECRET-FRAG: {}}", "reason": "r"}),
    ))
    .await;
    w.ask(req(
        "bot.run",
        Some("house/secret-key/3"),
        json!({"bot": "kai", "goal": "SECRET-GOAL"}),
    ))
    .await;
    let mut bad = req("room.log", None, json!({"room_id": "g-1"}));
    bad["token"] = "SECRET-TOKEN".into();
    w.ask(bad).await;
    let audit = w.audit();
    assert_eq!(audit.lines().count(), 4, "{audit}");
    for s in ["SECRET", "secret-key", TOKEN] {
        assert!(!audit.contains(s), "{s} in {audit}");
    }
    assert!(audit.contains(&crate::key_digest("house/secret-key/1")));
    assert!(audit.contains("\"outcome\":\"refused\""));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(w.dir.path().join("audit/house-ops.jsonl"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[tokio::test]
async fn a_grant_is_used_once_for_its_purpose_within_a_minute() {
    let mut w = world();
    let g = w.grants.mint("bots.write.approvals", NOW).unwrap();
    let redeem = |grant: &str, purpose: &str| {
        req(
            "grant.redeem",
            Some("k"),
            json!({"grant": grant, "purpose": purpose}),
        )
    };
    assert_eq!(
        w.ask(redeem(&g, "bots.write.approvals")).await["result"]["ok"],
        true
    );
    assert_eq!(
        code(&w.ask(redeem(&g, "bots.write.approvals")).await),
        "hx.host.owner_grant_required"
    );
    let g2 = w.grants.mint("budget.set", NOW).unwrap();
    assert_eq!(
        code(&w.ask(redeem(&g2, "bots.write.cap")).await),
        "hx.host.owner_grant_required"
    );
    assert_eq!(
        code(&w.ask(redeem(&g2, "budget.set")).await),
        "hx.host.owner_grant_required",
        "burnt by the wrong use"
    );
    let g3 = w.grants.mint("budget.set", NOW - 61_000).unwrap();
    assert!(!w.grants.redeem(&g3, "budget.set", NOW));
    assert!(w.grants.mint("rules.put", NOW).is_err());
}

#[test]
fn the_label_and_the_ids_are_the_hosts() {
    assert!(
        protocol::labelled("Ana", "hello")
            .starts_with("From boopis, for Ana. This is not an approval.")
    );
    assert_eq!(protocol::event_id("k"), protocol::event_id("k"));
    assert_ne!(protocol::event_id("k"), protocol::event_id("k2"));
    assert_eq!(protocol::event_id("k").len(), 16);
    assert!(protocol::submission_id("k").starts_with("ops-"));
}

// ───────────────────────── plans ─────────────────────────

fn export() -> Value {
    json!({"version": 1, "bots": {"mira": {"role": "writer", "model": "opus"}}, "rooms": {}, "cron": [
        {"bot": "mira", "name": "daily", "schedule": "every 1d", "prompt": "a"}]})
}

#[test]
fn a_fragment_merges_over_the_export_and_removes_nothing() {
    let frag = json!({"bots": {"kai": {"role": "coder"}, "mira": {"model": "haiku"}},
                      "cron": [{"bot": "mira", "name": "daily", "schedule": "every 2d"}, {"bot": "kai", "name": "n", "schedule": "every 1h"}]});
    let m = plans::merge(&export(), &frag).unwrap();
    assert_eq!(
        m["bots"]["mira"],
        json!({"role": "writer", "model": "haiku"})
    );
    assert_eq!(m["bots"]["kai"]["role"], "coder");
    assert_eq!(m["cron"].as_array().unwrap().len(), 2);
    assert_eq!(m["cron"][0]["schedule"], "every 2d");
    assert_eq!(m["cron"][0]["prompt"], "a");
    assert!(plans::merge(&export(), &json!(["x"])).is_err());
    assert!(plans::merge(&export(), &json!({"bots": ["x"]})).is_err());
    assert!(plans::merge(&export(), &json!({"cron": [{"bot": "x"}]})).is_err());
}

fn action(mark: &str, target: &str, op: &Value) -> Value {
    json!({"mark": mark, "target": target, "what": "new", "op": op})
}

fn proposal(base: &str, actions: Vec<Value>) -> Proposal {
    Proposal {
        base_export_hash: base.into(),
        actions,
        reason: "a writer needs a coder".into(),
        fragment: "bots: {kai: {}}".into(),
        merged: "version: 1".into(),
        job_id: Some("j1".into()),
        ..Proposal::default()
    }
}

#[test]
fn a_plan_is_stored_once_by_its_hash() {
    let dir = tempfile::tempdir().unwrap();
    let store = PlanStore::under(dir.path());
    let base = plans::export_hash(&export());
    let op = json!({"op": "create_bot", "name": "kai"});
    let a = store
        .propose(&proposal(&base, vec![action("+", "bot kai", &op)]), NOW)
        .unwrap();
    assert_eq!(a["state"], "proposed");
    assert_eq!(
        a["plan"]["actions"][0],
        json!({"mark": "+", "target": "bot kai", "what": "new"})
    );
    let hash = a["plan_hash"].as_str().unwrap();
    assert_eq!(hash, plans::plan_hash(&[op.clone()], &base));
    let b = store
        .propose(&proposal(&base, vec![action("+", "bot kai", &op)]), NOW + 5)
        .unwrap();
    assert_eq!(a, b);
    assert_eq!(
        std::fs::read_dir(dir.path().join("plans")).unwrap().count(),
        1
    );
    let none = store.propose(&proposal(&base, vec![]), NOW).unwrap();
    assert_eq!(none["state"], "nothing_to_do");
    assert_eq!(
        std::fs::read_dir(dir.path().join("plans")).unwrap().count(),
        1
    );
    assert_eq!(store.open_for_job("j1", NOW), 1);
    let listed = store.list(false, NOW);
    assert_eq!(listed[0]["title"], "Add 1 bot");
    assert_eq!(listed[0]["counts"]["bots"], 1);
    let shown = store.public(hash, NOW).unwrap();
    assert!(shown.get("fragment").is_none() && shown.get("merged").is_none());
}

#[test]
fn apply_checks_expiry_staleness_and_tampering_before_anything() {
    let dir = tempfile::tempdir().unwrap();
    let store = PlanStore::under(dir.path());
    let base = plans::export_hash(&export());
    let op = json!({"op": "create_bot", "name": "kai"});
    let make = |name: &str| {
        let op = json!({"op": "create_bot", "name": name});
        let a = store
            .propose(
                &proposal(&base, vec![action("+", &format!("bot {name}"), &op)]),
                NOW,
            )
            .unwrap();
        (a["plan_hash"].as_str().unwrap().to_owned(), op)
    };
    // stale: the team changed
    let (h, o) = make("kai");
    let r = store
        .begin_apply(&h, "other", &[o.clone()], NOW)
        .unwrap_err();
    assert_eq!(r.code, "hx.team.plan_stale");
    assert_eq!(store.get(&h).unwrap()["state"], "expired");
    assert_eq!(
        store.begin_apply(&h, &base, &[o], NOW).unwrap_err().code,
        "hx.team.plan_not_open"
    );
    // expired
    let (h, o) = make("ana");
    assert_eq!(
        store
            .begin_apply(&h, &base, &[o], NOW + plans::TTL_MS)
            .unwrap_err()
            .code,
        "hx.team.plan_expired"
    );
    // tampered: an action edited on disk
    let (h, o) = make("bo");
    let path = dir.path().join("plans").join(format!("{h}.json"));
    let edited = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\"name\": \"bo\"", "\"name\": \"evil\"");
    std::fs::write(&path, edited).unwrap();
    assert_eq!(
        store.begin_apply(&h, &base, &[o], NOW).unwrap_err().code,
        "hx.team.plan_tampered"
    );
    assert_eq!(store.get(&h).unwrap()["state"], "failed");
    // good: snapshot first, then the report
    let (h, o) = make("cy");
    let doc = store.begin_apply(&h, &base, &[o], NOW).unwrap();
    assert_eq!(doc["state"], "proposed");
    let snap = store.hold(&h, "version: 1\n", NOW).unwrap();
    assert!(snap.exists());
    assert_eq!(store.get(&h).unwrap()["state"], "held");
    assert_eq!(store.snapshot(&h).unwrap(), "version: 1\n");
    let done = store
        .finish(&h, &json!({"done": []}), true, "gui", NOW)
        .unwrap();
    assert_eq!(done["state"], "applied");
    assert_eq!(done["answered_by"]["surface"], "gui");
    let _ = op;
}

#[test]
fn a_rejected_plan_keeps_the_owners_words() {
    let dir = tempfile::tempdir().unwrap();
    let store = PlanStore::under(dir.path());
    let op = json!({"op": "create_bot", "name": "kai"});
    let a = store
        .propose(&proposal("b", vec![action("+", "bot kai", &op)]), NOW)
        .unwrap();
    let h = a["plan_hash"].as_str().unwrap();
    let r = store.reject(h, Some(" not now "), "gui", NOW).unwrap();
    assert_eq!(
        (r["state"].as_str(), r["words"].as_str()),
        (Some("rejected"), Some("not now"))
    );
    assert!(store.reject(h, None, "gui", NOW).is_err());
    assert_eq!(store.clear_old(NOW + plans::CLEAR_AFTER_MS + 1), 1);
}

#[test]
fn an_undo_keeps_only_what_the_plan_touched() {
    let acts = vec![
        action("-", "bot kai", &json!({"op": "archive_bot"})),
        action("-", "room build", &json!({"op": "disband_room"})),
        action("~", "bot mira", &json!({"op": "update_bot"})),
    ];
    let (kept, notes) = plans::undo_filter(acts, &["bot kai".into(), "room build".into()]);
    assert_eq!(kept.len(), 2);
    assert!(notes.iter().any(|n| n.contains("room build is permanent")));
    assert!(
        notes
            .iter()
            .any(|n| n == "bot mira changed after this plan; left as it is.")
    );
}

#[test]
fn times_are_written_in_utc() {
    assert_eq!(crate::rfc3339(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(
        crate::rfc3339(1_795_689_000_123),
        "2026-11-26T10:30:00.123Z"
    );
}

// ───────────────────────── the listener ─────────────────────────

#[cfg(unix)]
#[tokio::test]
async fn the_listener_serves_one_line_and_tells_the_handler_the_verdict() {
    use std::os::unix::fs::PermissionsExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use crate::listen::{Opts, serve};
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("run/host-ops.sock");
    let admit_me = Arc::new(Mutex::new(true));
    let gate = admit_me.clone();
    let l = serve(
        &socket,
        Opts {
            max_line: 64,
            timeout: Duration::from_secs(2),
            conns: 2,
        },
        Arc::new(move |pid| pid.is_some() && *gate.lock().unwrap()),
        Arc::new(|line, admitted| Box::pin(async move { format!("{admitted}:{line}\n") })),
    )
    .await
    .unwrap();
    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(
        (mode(l.socket()), mode(socket.parent().unwrap())),
        (0o600, 0o700)
    );
    let ask = |line: String| {
        let socket = socket.clone();
        async move {
            let mut s = tokio::net::UnixStream::connect(&socket).await.unwrap();
            s.write_all(line.as_bytes()).await.unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).await.unwrap();
            out
        }
    };
    assert_eq!(ask("hello\nmore".into()).await, "true:hello\n");
    assert_eq!(
        ask(format!("{}\n", "x".repeat(200))).await,
        "true:\n",
        "a line past the cap is no line"
    );
    *admit_me.lock().unwrap() = false;
    assert_eq!(ask("hello\n".into()).await, "false:hello\n");
    // A second host does not take a live socket.
    let again = serve(
        &socket,
        Opts {
            max_line: 64,
            timeout: Duration::from_secs(2),
            conns: 2,
        },
        Arc::new(|_| true),
        Arc::new(|_, _| Box::pin(async { String::new() })),
    )
    .await;
    assert!(again.is_err());
    drop(l);
    assert!(!socket.exists());
}
