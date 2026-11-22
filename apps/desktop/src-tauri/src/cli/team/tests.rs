use super::*;
use crate::team::tests::{EXAMPLE_DIR, Model, base};

#[allow(clippy::struct_field_names)]
struct Out {
    code: i32,
    out: String,
    err: String,
}

async fn go(model: &Model, args: &[&str]) -> Out {
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let stdin = || Ok(String::new());
    let code = {
        let mut ctx = Ctx {
            backend: model,
            out: &mut out,
            err: &mut err,
            stdin: &stdin,
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
