use std::time::Duration;

use serde_json::json;

use super::fake::{Bot, Script};
use super::*;

fn opts(max: u32) -> Opts {
    Opts {
        max_turns: max,
        poll: Duration::from_millis(2),
        timeout: Duration::from_secs(30),
    }
}

async fn go(script: Script, max: u32) -> (Outcome, Bot, Vec<Progress>) {
    let bot = Bot::new(script);
    let mut seen = Vec::new();
    let out = run(&bot, "kai", "write the report", &opts(max), &mut |p| {
        seen.push(p);
    })
    .await
    .unwrap();
    (out, bot, seen)
}

#[tokio::test]
async fn a_task_the_judge_calls_done_ends_with_exit_0() {
    let (out, bot, seen) = go(
        Script {
            done_after: Some(3),
            ..Script::default()
        },
        10,
    )
    .await;
    assert_eq!(out.stop, Stop::Done);
    assert_eq!(out.stop.exit_code(), 0);
    assert_eq!((out.turns, out.messages, out.max_turns), (3, 3, 10));
    // the task is the first turn; each later turn is the engine's own continuation prompt
    let sent = bot.submitted();
    assert_eq!(sent[0], "write the report");
    assert!(sent[1].starts_with("[Continuing toward your standing goal] 1"));
    assert!(sent[2].starts_with("[Continuing toward your standing goal] 2"));
    // the goal was set once, on the budget the run resolved, and nothing paused a goal that finished
    let made = bot.automation_calls("set");
    assert_eq!(made.len(), 1);
    assert_eq!(made[0]["args"], json!(["write the report"]));
    assert_eq!(made[0]["kwargs"], json!({"max_turns": 10}));
    assert!(bot.automation_calls("pause").is_empty());
    let said: Vec<&str> = seen
        .iter()
        .filter_map(|p| match p {
            Progress::Message { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(said, ["answer 1", "answer 2", "answer 3"]);
}

#[tokio::test]
async fn a_task_that_is_never_done_stops_at_the_cap_with_exit_3() {
    let (out, bot, _) = go(Script::default(), 4).await;
    assert_eq!(out.stop, Stop::CapReached);
    assert_eq!(out.stop.exit_code(), 3);
    assert_eq!((out.turns, out.max_turns), (4, 4));
    // exactly the budget's turns ran, and the engine's own pause is the stop (the run pauses nothing more)
    assert_eq!(bot.submitted().len(), 4);
    assert!(bot.automation_calls("pause").is_empty());
}

#[tokio::test]
async fn the_run_hands_the_goal_the_budget_it_was_given() {
    let (_, bot, _) = go(Script::default(), 2).await;
    assert_eq!(
        bot.automation_calls("set")[0]["kwargs"],
        json!({"max_turns": 2})
    );
    assert_eq!(bot.submitted().len(), 2);
}

#[tokio::test]
async fn a_task_done_on_the_last_turn_is_done_not_capped() {
    let (out, _, _) = go(
        Script {
            done_after: Some(4),
            ..Script::default()
        },
        4,
    )
    .await;
    assert_eq!(out.stop, Stop::Done);
}

#[tokio::test]
async fn an_approval_is_left_for_the_owner_with_exit_4_and_never_answered() {
    let (out, bot, _) = go(
        Script {
            approval_turn: Some(1),
            ..Script::default()
        },
        10,
    )
    .await;
    let Stop::NeedsOwner(why) = &out.stop else {
        panic!("{:?}", out.stop)
    };
    assert!(why.contains("an approval waiting"), "{why}");
    assert!(why.contains("s1"), "{why}");
    assert_eq!(out.stop.exit_code(), 4);
    assert_eq!(bot.count("approval.respond"), 0);
    // the goal is paused so nothing goes on behind the owner's back
    assert_eq!(bot.automation_calls("pause").len(), 1);
}

#[tokio::test]
async fn a_task_the_judge_calls_blocked_needs_the_owner() {
    let (out, bot, _) = go(
        Script {
            blocked_after: Some(2),
            ..Script::default()
        },
        10,
    )
    .await;
    let Stop::NeedsOwner(why) = &out.stop else {
        panic!("{:?}", out.stop)
    };
    assert!(why.contains("it needs a password"), "{why}");
    assert_eq!(out.stop.exit_code(), 4);
    // the engine already paused it
    assert!(bot.automation_calls("pause").is_empty());
}

#[tokio::test]
async fn a_failed_turn_is_an_error_in_boopis_words_and_pauses_the_goal() {
    let (out, bot, _) = go(
        Script {
            fail_turn: Some((2, "model_unavailable")),
            ..Script::default()
        },
        10,
    )
    .await;
    let Stop::Failed(why) = &out.stop else {
        panic!("{:?}", out.stop)
    };
    assert!(why.starts_with("kai can't reach its model."), "{why}");
    assert!(!why.to_lowercase().contains("hermes"));
    assert_eq!(out.stop.exit_code(), 1);
    assert_eq!(bot.submitted().len(), 2);
    assert_eq!(bot.automation_calls("pause").len(), 1);
    // the failed turn is not judged (the engine never judges one)
    assert_eq!(bot.automation_calls("evaluate_after_turn").len(), 1);
}

#[tokio::test]
async fn a_turn_someone_stopped_is_an_error() {
    let (out, _, _) = go(
        Script {
            interrupt_turn: Some(1),
            ..Script::default()
        },
        10,
    )
    .await;
    assert!(matches!(&out.stop, Stop::Failed(w) if w.contains("was stopped")));
    assert_eq!(out.stop.exit_code(), 1);
}

#[tokio::test]
async fn an_empty_answer_is_an_error_and_is_not_judged() {
    let (out, bot, _) = go(
        Script {
            blank_turn: Some(1),
            ..Script::default()
        },
        10,
    )
    .await;
    assert!(matches!(&out.stop, Stop::Failed(w) if w.contains("without an answer")));
    assert!(bot.automation_calls("evaluate_after_turn").is_empty());
}

#[tokio::test]
async fn a_judge_that_cannot_run_is_an_error_below_the_cap() {
    let (out, _, _) = go(
        Script {
            judge_broken: true,
            ..Script::default()
        },
        10,
    )
    .await;
    let Stop::Failed(why) = &out.stop else {
        panic!("{:?}", out.stop)
    };
    assert!(why.contains("could not run"), "{why}");
    assert!(why.contains("1 of 10 turns"), "{why}");
    assert_eq!(out.stop.exit_code(), 1);
}

#[tokio::test]
async fn a_run_that_takes_too_long_times_out_with_exit_1_and_pauses_the_goal() {
    let bot = Bot::new(Script {
        hang: true,
        ..Script::default()
    });
    let o = Opts {
        timeout: Duration::from_millis(40),
        ..opts(10)
    };
    let out = run(&bot, "kai", "t", &o, &mut |_| {}).await.unwrap();
    assert_eq!(out.stop, Stop::TimedOut);
    assert_eq!(out.stop.exit_code(), 1);
    assert_eq!(bot.automation_calls("pause").len(), 1);
}

#[tokio::test]
async fn a_parked_goal_is_waited_out_and_judged_again() {
    let (out, bot, seen) = go(
        Script {
            park_after: Some(1),
            done_after: Some(2),
            ..Script::default()
        },
        10,
    )
    .await;
    assert_eq!(out.stop, Stop::Done);
    assert!(seen.contains(&Progress::Parked("waiting on a build".into())));
    assert!(!bot.automation_calls("is_waiting").is_empty());
}

#[test]
fn what_each_verdict_calls_for() {
    let g = |status: &str, used: u32, max: u32| Goal {
        status: status.into(),
        turns_used: used,
        max_turns: max,
        paused_reason: "why".into(),
    };
    let d = |status: &str, cont: bool, prompt: &str, verdict: &str| Decision {
        status: status.into(),
        should_continue: cont,
        prompt: prompt.into(),
        verdict: verdict.into(),
        reason: "r".into(),
    };
    assert_eq!(
        step_of(&d("done", false, "", "done"), &g("done", 1, 10)),
        Step::Done
    );
    assert_eq!(
        step_of(&d("active", true, "go", "continue"), &g("active", 1, 10)),
        Step::Continue("go".into())
    );
    assert_eq!(
        step_of(&d("active", false, "", "wait"), &g("active", 1, 10)),
        Step::Park("r".into())
    );
    assert_eq!(
        step_of(&d("paused", false, "", "blocked"), &g("paused", 1, 10)),
        Step::Blocked("r".into())
    );
    assert_eq!(
        step_of(&d("paused", false, "", "continue"), &g("paused", 10, 10)),
        Step::Cap
    );
    assert_eq!(
        step_of(&d("paused", false, "", "continue"), &g("paused", 3, 10)),
        Step::Stopped("why".into())
    );
    // a goal that is not active any more is never read as done
    assert!(matches!(
        step_of(&d("inactive", false, "", "inactive"), &g("cleared", 1, 10)),
        Step::Stopped(_)
    ));
}
