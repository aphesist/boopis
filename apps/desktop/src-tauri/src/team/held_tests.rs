//! `team::held` over the made-up engine (`team::tests::Model`): team-ops.md acceptance tests 1 to 7.

use serde_json::Value;

use super::apply::Backend;
use super::held::{apply_held, propose, reject, undo};
use super::plan::Op;
use super::spec::Bot;
use super::tests::{Model, base};

const NOW: u64 = 1_795_689_000_000;

fn house() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let house = dir.path().join("house");
    (dir, house)
}

fn plans_in(house: &std::path::Path) -> usize {
    std::fs::read_dir(house.join("plans")).map_or(0, Iterator::count)
}

const ADD_KAI: &str = "bots:\n  kai:\n    role: writes the code\n";

#[tokio::test]
async fn a_plan_adding_one_bot_is_stored_once_by_its_hash() {
    let (_d, house) = house();
    let model = Model::new(base());
    let a = propose(&model, &house, ADD_KAI, "a coder", Some("j1"), NOW)
        .await
        .unwrap();
    assert_eq!(a["state"], "proposed");
    let actions = a["plan"]["actions"].as_array().unwrap();
    assert_eq!(actions.len(), 1, "{a}");
    assert_eq!(
        (actions[0]["mark"].as_str(), actions[0]["target"].as_str()),
        (Some("+"), Some("bot kai"))
    );
    let b = propose(&model, &house, ADD_KAI, "a coder", Some("j1"), NOW + 1)
        .await
        .unwrap();
    assert_eq!(a["plan_hash"], b["plan_hash"]);
    assert_eq!(plans_in(&house), 1);
    assert!(model.ran().is_empty(), "a plan changes nothing");
}

#[tokio::test]
async fn a_fragment_that_fails_the_check_or_names_a_file_is_refused() {
    let (_d, house) = house();
    let model = Model::new(base());
    let bad = "bots:\n  kai: {}\nrooms:\n  build:\n    members: [kai]\n";
    let r = propose(&model, &house, bad, "r", None, NOW)
        .await
        .unwrap_err();
    assert_eq!(r.code, "hx.invalid_params");
    let r = propose(
        &model,
        &house,
        "bots:\n  kai:\n    soul: ../../.ssh/id_rsa\n",
        "r",
        None,
        NOW,
    )
    .await
    .unwrap_err();
    assert_eq!(r.code, "hx.invalid_params");
    assert_eq!(plans_in(&house), 0);
}

#[tokio::test]
async fn the_hold_applies_after_a_snapshot_and_keeps_the_report() {
    let (dir, house) = house();
    let model = Model::new(base());
    let a = propose(&model, &house, ADD_KAI, "a coder", None, NOW)
        .await
        .unwrap();
    let h = a["plan_hash"].as_str().unwrap();
    let done = apply_held(&model, &house, h, "gui", NOW).await.unwrap();
    assert_eq!(done["state"], "applied", "{done}");
    assert_eq!(done["answered_by"]["surface"], "gui");
    assert_eq!(model.ran(), ["CreateBot"]);
    assert_eq!(
        std::fs::read_dir(house.join("snapshots")).unwrap().count(),
        1
    );
    let answers = std::fs::read_to_string(dir.path().join("audit/client-answers.jsonl")).unwrap();
    assert!(answers.contains("\"choice\":\"apply\"") && answers.contains(h));
    // A second hold of the same plan does nothing.
    assert_eq!(
        apply_held(&model, &house, h, "gui", NOW)
            .await
            .unwrap_err()
            .code,
        "hx.team.plan_not_open"
    );
    assert_eq!(model.ran().len(), 1);
}

#[tokio::test]
async fn a_team_that_changed_after_planning_is_stale() {
    let (_d, house) = house();
    let model = Model::new(base());
    let a = propose(&model, &house, ADD_KAI, "a coder", None, NOW)
        .await
        .unwrap();
    model
        .run(&Op::CreateBot {
            name: "zed".into(),
            bot: Bot::default(),
        })
        .await
        .unwrap();
    let before = model.ran().len();
    let r = apply_held(&model, &house, a["plan_hash"].as_str().unwrap(), "gui", NOW)
        .await
        .unwrap_err();
    assert_eq!(r.code, "hx.team.plan_stale");
    assert_eq!(model.ran().len(), before, "nothing applied");
    let stored: Value = serde_json::from_slice(
        &std::fs::read(
            house
                .join("plans")
                .join(format!("{}.json", a["plan_hash"].as_str().unwrap())),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(stored["state"], "expired");
}

#[tokio::test]
async fn a_plan_file_edited_on_disk_is_tampered() {
    let (_d, house) = house();
    let model = Model::new(base());
    let a = propose(&model, &house, ADD_KAI, "a coder", None, NOW)
        .await
        .unwrap();
    let h = a["plan_hash"].as_str().unwrap();
    let path = house.join("plans").join(format!("{h}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\"kai\"", "\"evil\"");
    std::fs::write(&path, text).unwrap();
    let r = apply_held(&model, &house, h, "gui", NOW).await.unwrap_err();
    assert_eq!(r.code, "hx.team.plan_tampered");
    assert!(model.ran().is_empty());
}

#[tokio::test]
async fn an_undo_plans_the_way_back_and_its_hold_restores_the_team() {
    let (_d, house) = house();
    let model = Model::new(base());
    let before = super::held::actions_json(&super::plan::plan(
        &super::export::export(&model.read_now()).team,
        &model.read_now(),
        true,
    ));
    assert!(before.is_empty());
    let frag = "bots:\n  kai:\n    role: codes\n  ana:\n    role: tests\nrooms:\n  build:\n    members: [kai, ana]\n";
    let a = propose(&model, &house, frag, "a team", None, NOW)
        .await
        .unwrap();
    let h = a["plan_hash"].as_str().unwrap().to_owned();
    apply_held(&model, &house, &h, "gui", NOW).await.unwrap();
    let snapshot_export = super::export::export(&base()).team;
    let back = undo(&model, &house, &h, "gui", NOW + 10).await.unwrap();
    assert_eq!(back["state"], "proposed", "{back}");
    let marks: Vec<&str> = back["plan"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["mark"].as_str().unwrap())
        .collect();
    assert!(
        marks.iter().all(|m| *m == "-") && marks.len() == 3,
        "{back}"
    );
    assert!(
        back["plan"]["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n.as_str().unwrap().contains("permanent"))
    );
    let undone = apply_held(
        &model,
        &house,
        back["plan_hash"].as_str().unwrap(),
        "gui",
        NOW + 20,
    )
    .await
    .unwrap();
    assert_eq!(undone["state"], "applied", "{undone}");
    assert_eq!(
        super::export::export(&model.read_now()).team,
        snapshot_export
    );
}

#[tokio::test]
async fn a_rejected_plan_keeps_the_words_and_cannot_be_applied() {
    let (_d, house) = house();
    let model = Model::new(base());
    let a = propose(&model, &house, ADD_KAI, "a coder", None, NOW)
        .await
        .unwrap();
    let h = a["plan_hash"].as_str().unwrap();
    let r = reject(&house, h, Some("not this week"), "gui", NOW).unwrap();
    assert_eq!(
        (r["state"].as_str(), r["words"].as_str()),
        (Some("rejected"), Some("not this week"))
    );
    assert_eq!(
        apply_held(&model, &house, h, "gui", NOW)
            .await
            .unwrap_err()
            .code,
        "hx.team.plan_not_open"
    );
}
