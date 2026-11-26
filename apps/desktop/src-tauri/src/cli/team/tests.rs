use super::*;
use crate::team::tests::{EXAMPLE_DIR, Model, base};

#[allow(clippy::struct_field_names)]
struct Out {
    code: i32,
    out: String,
    err: String,
}

async fn go(model: &Model, args: &[&str]) -> Out {
    go_as(model, args, None).await
}

async fn go_as(model: &Model, args: &[&str], bot_caller: Option<&'static str>) -> Out {
    go_in(model, args, bot_caller, None).await
}

async fn go_in(
    model: &Model,
    args: &[&str],
    bot_caller: Option<&'static str>,
    house: Option<&Path>,
) -> Out {
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let stdin = || Ok(String::new());
    let code = {
        let mut ctx = Ctx {
            backend: model,
            out: &mut out,
            err: &mut err,
            stdin: &stdin,
            bot_caller,
            house,
        };
        team(&args, &mut ctx).await
    };
    Out {
        code,
        out: String::from_utf8(out).unwrap(),
        err: String::from_utf8(err).unwrap(),
    }
}

fn file() -> String {
    format!("{EXAMPLE_DIR}/paper-past.yaml")
}

#[tokio::test]
async fn dry_run_prints_the_plan_and_changes_nothing() {
    let model = Model::new(base());
    let o = go(&model, &["apply", &file(), "--dry-run"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert!(o.out.contains("+ bot kai  new, model opus"), "{}", o.out);
    assert!(
        o.out.contains("+ room paper past  6 bots, lead kai"),
        "{}",
        o.out
    );
    assert!(o.out.contains("+ board paper-past"), "{}", o.out);
    assert!(o.out.contains("dry run: nothing was changed"), "{}", o.out);
    assert!(model.ran().is_empty());
}

#[tokio::test]
async fn apply_makes_the_team_and_says_nothing_to_change_the_second_time() {
    let model = Model::new(base());
    let o = go(&model, &["apply", &file()]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert!(o.out.contains("ok + bot kai  new, model opus"), "{}", o.out);
    assert!(o.out.trim_end().ends_with(" done"), "{}", o.out);
    let n = model.ran().len();
    assert!(n > 10);
    let o = go(&model, &["apply", &file()]).await;
    assert_eq!(o.code, 0);
    assert!(o.out.contains("nothing to change"), "{}", o.out);
    assert_eq!(model.ran().len(), n, "the second run ran nothing");
    let j = go(&model, &["apply", &file(), "--json"]).await;
    let v: serde_json::Value = serde_json::from_str(j.out.lines().last().unwrap()).unwrap();
    assert_eq!(v["type"], "applied");
    assert_eq!(v["report"]["done"], serde_json::json!([]));
}

#[tokio::test]
async fn failures_and_problems_are_exit_code_one() {
    let mut model = Model::new(base());
    model.fail_bot = Some("nina".into());
    let o = go(&model, &["apply", &file()]).await;
    assert_eq!(o.code, 1);
    assert!(o.out.contains("failed + bot nina"), "{}", o.out);
    // a file with a problem is refused before anything runs
    let d = tempfile::tempdir().unwrap();
    let bad = d.path().join("t.yaml");
    std::fs::write(&bad, "version: 1\nrooms:\n  r: {members: [kai, ghost]}\n").unwrap();
    let model = Model::new(base());
    let o = go(&model, &["apply", bad.to_str().unwrap()]).await;
    assert_eq!(o.code, 1);
    assert!(
        o.err.contains("ghost is not a bot") && o.err.contains("nothing was changed"),
        "{}",
        o.err
    );
    assert!(model.ran().is_empty());
    let o = go(&model, &["apply", "/nonexistent.yaml"]).await;
    assert_eq!(o.code, 1);
}

#[tokio::test]
async fn export_writes_the_team_and_refuses_to_overwrite() {
    let model = Model::new(base());
    go(&model, &["apply", &file()]).await;
    let o = go(&model, &["export"]).await;
    assert_eq!(o.code, 0);
    assert!(o.out.starts_with("# A boopis team"), "{}", o.out);
    assert!(o.out.contains("soul_text:"));
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("team.yaml");
    let p = path.to_str().unwrap();
    assert_eq!(go(&model, &["export", "--output", p]).await.code, 0);
    let o = go(&model, &["export", "--output", p]).await;
    assert_eq!(o.code, 1);
    assert!(o.err.contains("--force"));
    assert_eq!(
        go(&model, &["export", "--output", p, "--force"]).await.code,
        0
    );
    // the exported file applies as nothing to change
    let o = go(&model, &["apply", p, "--dry-run"]).await;
    assert!(o.out.contains("nothing to change"), "{}", o.out);
}

#[tokio::test]
async fn check_reads_a_file_without_the_engine_and_usage_is_code_two() {
    let model = Model::new(base());
    let o = go(&model, &["check", &file()]).await;
    assert_eq!(o.code, 0);
    assert!(
        o.out
            .contains("a team of 6 bots, 1 rooms, 1 boards and 1 jobs"),
        "{}",
        o.out
    );
    assert_eq!(go(&model, &[]).await.code, 2);
    assert_eq!(go(&model, &["nope"]).await.code, 2);
    assert_eq!(go(&model, &["apply"]).await.code, 2);
    assert_eq!(go(&model, &["apply", "x", "--wat"]).await.code, 2);
}

/// B47, H5: a process the engine started cannot apply a team, in any form, and nothing is read or changed.
#[tokio::test]
async fn a_bot_s_process_cannot_apply_a_team() {
    for rule in ["environment", "ancestry"] {
        for args in [
            vec!["apply", &file()[..]],
            vec!["apply", &file()[..], "--dry-run"],
            vec!["apply", &file()[..], "--prune", "--json"],
        ] {
            let model = Model::new(base());
            let o = go_as(&model, &args, Some(rule)).await;
            assert_eq!(o.code, 2, "{args:?}: {}{}", o.out, o.err);
            assert!(o.err.contains(BOT_REFUSAL), "{}", o.err);
            assert!(model.ran().is_empty(), "{args:?}");
        }
    }
    // checking a file changes nothing, so a bot may still do it
    let model = Model::new(base());
    assert_eq!(
        go_as(&model, &["check", &file()], Some("environment"))
            .await
            .code,
        0
    );
}

/// team-ops.md acceptance 16: `team plan` prints the hash, `apply --hash` applies it, a bot's process gets exit 2.
#[tokio::test]
async fn a_plan_is_applied_by_its_hash_and_never_by_a_bot() {
    let dir = tempfile::tempdir().unwrap();
    let house = dir.path().join("house");
    let fragment = dir.path().join("kai.yaml");
    std::fs::write(&fragment, "bots:\n  kai:\n    role: writes code\n").unwrap();
    let model = Model::new(base());
    let o = go_in(
        &model,
        &["plan", fragment.to_str().unwrap(), "--json"],
        None,
        Some(&house),
    )
    .await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    let v: serde_json::Value = serde_json::from_str(o.out.trim()).unwrap();
    let hash = v["plan_hash"].as_str().unwrap().to_owned();
    for rule in ["environment", "ancestry"] {
        for args in [vec!["apply", "--hash", &hash[..]], vec!["undo", &hash[..]]] {
            let o = go_in(&model, &args, Some(rule), Some(&house)).await;
            assert_eq!(o.code, 2, "{args:?}");
            assert!(o.err.contains(BOT_REFUSAL));
        }
    }
    assert!(model.ran().is_empty());
    let o = go_in(
        &model,
        &["apply", "--hash", &hash, "--json"],
        None,
        Some(&house),
    )
    .await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert_eq!(model.ran(), ["CreateBot"]);
    let v: serde_json::Value = serde_json::from_str(o.out.trim()).unwrap();
    assert_eq!(v["answered_by"]["surface"], "cli");
}
