use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use super::*;
use crate::bots::run::fake::{Bot, Script};

struct Shared(Arc<Bot>);

#[async_trait]
impl Rpc for Shared {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.0.call(method, params).await
    }
}

struct Fakes {
    bot: Arc<Bot>,
    cap: Option<u32>,
}

#[async_trait]
impl Bots for Fakes {
    async fn link(&self, bot: &str) -> Result<Box<dyn Rpc>> {
        if bot == "ghost" {
            return Err(Error::Bots(
                "hx.bots.not_found",
                "there is no bot called ghost".into(),
            ));
        }
        Ok(Box::new(Shared(self.bot.clone())))
    }
    async fn cap(&self, bot: &str) -> Result<Option<u32>> {
        if bot == "ghost" {
            return Err(Error::Bots(
                "hx.bots.not_found",
                "there is no bot called ghost".into(),
            ));
        }
        Ok(self.cap)
    }
}

#[allow(clippy::struct_field_names)]
struct Out {
    code: i32,
    out: String,
    err: String,
}

async fn go(script: Script, cap: Option<u32>, args: &[&str]) -> (Out, Arc<Bot>) {
    let bot = Arc::new(Bot::new(script));
    let fakes = Fakes {
        bot: bot.clone(),
        cap,
    };
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let stdin = || Ok("from stdin".to_owned());
    let code = {
        let mut ctx = Ctx {
            bots: &fakes,
            out: &mut out,
            err: &mut err,
            stdin: &stdin,
            poll: Duration::from_millis(2),
        };
        run_bot(&args, &mut ctx).await
    };
    (
        Out {
            code,
            out: String::from_utf8(out).unwrap(),
            err: String::from_utf8(err).unwrap(),
        },
        bot,
    )
}

fn budget(bot: &Bot) -> Value {
    bot.automation_calls("set")[0]["kwargs"]["max_turns"].clone()
}

#[tokio::test]
async fn a_finished_task_prints_each_answer_and_ends_with_exit_0() {
    let s = Script {
        done_after: Some(2),
        ..Script::default()
    };
    let (o, _) = go(s, None, &["--bot", "kai", "write", "the", "report"]).await;
    assert_eq!(o.code, 0, "{}", o.err);
    assert!(o.out.contains("  answer 1"), "{}", o.out);
    assert!(
        o.out
            .contains("-- not done yet; going on (1 of 10 turns used)")
    );
    assert!(
        o.out
            .trim_end()
            .ends_with("-- done: kai finished the task in 2 turns")
    );
}

#[tokio::test]
async fn the_flag_beats_the_bots_cap_which_beats_the_default() {
    let never = Script::default;
    let (_, b) = go(never(), None, &["--bot", "kai", "t"]).await;
    assert_eq!(budget(&b), json!(10));
    let (o, b) = go(never(), Some(3), &["--bot", "kai", "t"]).await;
    assert_eq!(budget(&b), json!(3));
    assert_eq!(o.code, 3);
    assert!(
        o.out.contains("-- stopped at the cap of 3 turns."),
        "{}",
        o.out
    );
    assert!(o.out.contains("boopis bots set kai --max-turns N"));
    let (o, b) = go(never(), Some(3), &["--bot", "kai", "--max-turns", "2", "t"]).await;
    assert_eq!(budget(&b), json!(2));
    assert_eq!(b.submitted().len(), 2);
    assert_eq!(o.code, 3);
}

#[tokio::test]
async fn an_approval_is_exit_4_and_a_failed_turn_exit_1() {
    let (o, bot) = go(
        Script {
            approval_turn: Some(1),
            ..Script::default()
        },
        None,
        &["--bot", "kai", "t"],
    )
    .await;
    assert_eq!(o.code, 4);
    assert!(
        o.out
            .contains("-- a bot needs you: kai has an approval waiting")
    );
    assert_eq!(bot.count("approval.respond"), 0);
    let (o, _) = go(
        Script {
            fail_turn: Some((1, "model_unavailable")),
            ..Script::default()
        },
        None,
        &["--bot", "kai", "t"],
    )
    .await;
    assert_eq!(o.code, 1);
    assert!(o.out.contains("-- stopped: kai can't reach its model."));
}

#[tokio::test]
async fn json_prints_one_object_per_line_ending_in_the_end_object() {
    let s = Script {
        done_after: Some(1),
        ..Script::default()
    };
    let (o, _) = go(s, Some(7), &["--bot", "kai", "--json", "t"]).await;
    let lines: Vec<Value> = o
        .out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines[0]["type"], "started");
    assert_eq!(lines[1]["type"], "message");
    assert_eq!(lines[1]["who"], "kai");
    let end = lines.last().unwrap();
    assert_eq!(end["type"], "end");
    assert_eq!(end["stop"], "done");
    assert_eq!(
        (end["turns"].clone(), end["max_turns"].clone()),
        (json!(1), json!(7))
    );
    assert_eq!(o.code, 0);
}

#[tokio::test]
async fn the_task_may_come_from_standard_input_or_a_file() {
    let (_, bot) = go(Script::default(), Some(1), &["--bot", "kai", "-"]).await;
    assert_eq!(bot.submitted()[0], "from stdin");
    let d = tempfile::tempdir().unwrap();
    let f = d.path().join("task.md");
    std::fs::write(&f, "from a file").unwrap();
    let (_, bot) = go(
        Script::default(),
        Some(1),
        &["--bot", "kai", "--file", f.to_str().unwrap()],
    )
    .await;
    assert_eq!(bot.submitted()[0], "from a file");
}

#[tokio::test]
async fn a_usage_mistake_is_exit_2_and_a_missing_bot_exit_1() {
    for args in [
        vec!["t"],            // no bot
        vec!["--bot", "kai"], // no task
        vec!["--bot", "kai", "--max-turns", "0", "t"],
        vec!["--bot", "kai", "--max-turns", "many", "t"],
        vec!["--bot", "kai", "--to-board", "x", "t"],
    ] {
        let (o, bot) = go(Script::default(), None, &args).await;
        assert_eq!(o.code, 2, "{args:?}: {}", o.err);
        assert!(bot.calls().is_empty(), "nothing is asked of the engine");
    }
    let (o, _) = go(Script::default(), None, &["--bot", "ghost", "t"]).await;
    assert_eq!(o.code, 1);
    assert!(o.err.contains("there is no bot called ghost"), "{}", o.err);
}
