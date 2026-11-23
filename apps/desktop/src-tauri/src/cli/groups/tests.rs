use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;

use super::*;
use crate::rooms::fake::{Fake, Script};

type Handoff = (String, String, String, String, String);
struct Rec(Mutex<Vec<Handoff>>);

#[async_trait]
impl Board for Rec {
    async fn hand_off(
        &self,
        board: &str,
        assignee: &str,
        title: &str,
        body: &str,
        key: &str,
    ) -> Result<String> {
        self.0.lock().unwrap().push((
            board.into(),
            assignee.into(),
            title.into(),
            body.into(),
            key.into(),
        ));
        if board == "missing" {
            return Err(Error::InvalidInput(
                "there is no board called \"missing\"".into(),
            ));
        }
        Ok("t_1".into())
    }
}

#[allow(clippy::struct_field_names)]
struct Out {
    code: i32,
    out: String,
    err: String,
}

async fn go(
    fake: &Fake,
    board: Option<&Rec>,
    settings: &std::path::Path,
    run: bool,
    args: &[&str],
) -> Out {
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let stdin = || Ok("from stdin".to_owned());
    let code = {
        let mut ctx = Ctx {
            rpc: fake,
            settings,
            out: &mut out,
            err: &mut err,
            board: board.map(|b| b as &dyn Board),
            stdin: &stdin,
            poll: Duration::from_millis(10),
        };
        if run {
            run_group(&args, &mut ctx).await
        } else {
            groups(&args, &mut ctx).await
        }
    };
    Out {
        code,
        out: String::from_utf8(out).unwrap(),
        err: String::from_utf8(err).unwrap(),
    }
}

fn tmp() -> (tempfile::TempDir, std::path::PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("rooms.json");
    (d, p)
}

#[tokio::test]
async fn list_prints_ids_names_and_members_and_json() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(&fake, None, &s, false, &["list"]).await;
    assert_eq!(o.code, 0);
    assert_eq!(o.out.trim(), "g-paper-past-  paper past  kai,nina");
    let j = go(&fake, None, &s, false, &["list", "--json"]).await;
    let v: Value = serde_json::from_str(j.out.trim()).unwrap();
    assert_eq!(v[0]["id"], "g-paper-past-");
    assert_eq!(v[0]["members"], json!(["kai", "nina"]));
}

#[tokio::test]
async fn create_makes_the_room_with_lead_purpose_and_cap() {
    let (d, s) = tmp();
    let purpose = d.path().join("purpose.md");
    std::fs::write(&purpose, "make shorts").unwrap();
    let fake = Fake::new(Script::default());
    let o = go(
        &fake,
        None,
        &s,
        false,
        &[
            "create",
            "new room",
            "kai",
            "nina",
            "moss",
            "--lead",
            "kai",
            "--purpose",
            purpose.to_str().unwrap(),
            "--max-rounds",
            "12",
        ],
    )
    .await;
    assert_eq!(o.code, 0, "{}", o.err);
    assert!(o.out.starts_with("made new room (g-new-room-"), "{}", o.out);
    let calls = fake.calls();
    let ctx = calls.iter().find(|(m, _)| m == "groups.context").unwrap();
    assert_eq!(ctx.1["purpose"], "make shorts");
    assert_eq!(ctx.1["lead_member_id"], "kai");
    let id = calls.iter().find(|(m, _)| m == "groups.create").unwrap().1["room_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(RoomSettings::load(&s).unwrap().max_rounds(&id), Some(12));
}

#[tokio::test]
async fn create_says_what_is_wrong() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(&fake, None, &s, false, &["create", "x", "kai"]).await;
    assert_eq!(o.code, 1);
    assert!(o.err.contains("2 to 6 bots"), "{}", o.err);
    let o = go(&fake, None, &s, false, &["create", "x", "kai", "hex"]).await;
    assert!(
        o.err.contains("hex") && o.err.contains("Open boopis"),
        "{}",
        o.err
    );
    let o = go(&fake, None, &s, false, &["create"]).await;
    assert_eq!(o.code, 2);
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["create", "x", "kai", "nina", "--max-rounds", "many"],
    )
    .await;
    assert_eq!(o.code, 2);
    let o = go(&fake, None, &s, false, &["nope"]).await;
    assert_eq!(o.code, 2);
    assert!(o.err.contains("groups nope is not a command"), "{}", o.err);
    assert!(
        o.err.contains(&super::super::help::hint("groups")),
        "{}",
        o.err
    );
    let o = go(&fake, None, &s, false, &[]).await;
    assert_eq!(o.code, 2);
    // no subcommand prints the page, as `bots` and `team` do
    assert!(o.err.contains("groups send"), "{}", o.err);
}

#[tokio::test(start_paused = true)]
async fn send_without_wait_sends_and_returns() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["send", "paper past", "hello", "there"],
    )
    .await;
    assert_eq!(o.code, 0);
    assert!(o.out.starts_with("sent to paper past (cli-"), "{}", o.out);
    let sent = fake
        .calls()
        .into_iter()
        .find(|(m, _)| m == "groups.send")
        .unwrap();
    assert_eq!(sent.1["payload"]["text"], "hello there");
    assert!(
        !o.out.contains("held"),
        "a free room gets it at once: {}",
        o.out
    );
    // the text from standard input
    let o = go(&fake, None, &s, false, &["send", "paper past", "-"]).await;
    assert_eq!(o.code, 0);
    let sent = fake
        .calls()
        .into_iter()
        .rfind(|(m, _)| m == "groups.send")
        .unwrap();
    assert_eq!(sent.1["payload"]["text"], "from stdin");
    let o = go(&fake, None, &s, false, &["send", "paper past"]).await;
    assert_eq!(o.code, 1);
    assert!(o.err.contains("nothing to send"));
}

#[tokio::test(start_paused = true)]
async fn send_wait_prints_the_replies_and_stops_at_the_engines_pause() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script {
        rounds: 7,
        ..Script::default()
    });
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["send", "paper past", "go", "--wait"],
    )
    .await;
    assert_eq!(o.code, 3, "{}{}", o.out, o.err);
    assert!(o.out.contains("Kai\n  step 0"), "{}", o.out);
    assert!(o.out.contains("paused at the engine's limit"), "{}", o.out);
    assert_eq!(fake.count("groups.continue"), 0);
}

#[tokio::test(start_paused = true)]
async fn run_goes_on_past_the_pause_and_says_done() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script {
        rounds: 7,
        ..Script::default()
    });
    let o = go(
        &fake,
        None,
        &s,
        true,
        &["--group", "paper past", "make", "the", "episode"],
    )
    .await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert!(
        o.out.contains("-- the engine paused; going on (2 so far"),
        "{}",
        o.out
    );
    assert!(
        o.out
            .trim_end()
            .ends_with("done: the bots stopped handing off after 7 rounds"),
        "{}",
        o.out
    );
    assert_eq!(fake.count("groups.continue"), 2);
}

#[tokio::test(start_paused = true)]
async fn run_uses_the_rooms_cap_unless_the_flag_says_otherwise() {
    let (_d, s) = tmp();
    let mut kept = RoomSettings::default();
    kept.set_max_rounds("g-paper-past-", Some(6)).unwrap();
    kept.save(&s).unwrap();
    let fake = Fake::new(Script {
        rounds: 20,
        ..Script::default()
    });
    let o = go(&fake, None, &s, true, &["--group", "g-paper-past-", "task"]).await;
    assert_eq!(o.code, 3, "{}", o.out);
    assert!(
        o.out.contains("stopped at the cap of 6 rounds"),
        "{}",
        o.out
    );
    let fake = Fake::new(Script {
        rounds: 20,
        ..Script::default()
    });
    let o = go(
        &fake,
        None,
        &s,
        true,
        &["--group", "g-paper-past-", "task", "--max-rounds", "9"],
    )
    .await;
    assert!(o.out.contains("cap of 9 rounds"), "{}", o.out);
}

#[tokio::test(start_paused = true)]
async fn the_rest_can_be_handed_to_a_board_and_a_missing_board_is_said() {
    let (_d, s) = tmp();
    let rec = Rec(Mutex::new(Vec::new()));
    let fake = Fake::new(Script {
        rounds: 20,
        ..Script::default()
    });
    let o = go(
        &fake,
        Some(&rec),
        &s,
        true,
        &[
            "--group",
            "paper past",
            "the task",
            "--max-rounds",
            "3",
            "--to-board",
            "paper-past",
        ],
    )
    .await;
    assert_eq!(o.code, 3);
    assert!(
        o.out.contains("handed on to the board as task t_1"),
        "{}",
        o.out
    );
    let calls = rec.0.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "paper-past");
    assert_eq!(calls[0].1, "kai", "the first member when nobody leads");
    assert!(calls[0].3.contains("the task") && calls[0].3.contains("g-paper-past-"));
    assert!(
        calls[0].4.starts_with("cli-"),
        "the discussion id is the key"
    );
    // a board that is not there: the run still says why it stopped, and the exit code says the hand-off failed
    let fake = Fake::new(Script {
        rounds: 20,
        ..Script::default()
    });
    let o = go(
        &fake,
        Some(&rec),
        &s,
        true,
        &[
            "--group",
            "paper past",
            "t",
            "--max-rounds",
            "3",
            "--to-board",
            "missing",
        ],
    )
    .await;
    assert_eq!(o.code, 1);
    assert!(
        o.err.contains("could not hand the rest to the board"),
        "{}",
        o.err
    );
    // a finished run hands nothing on
    let before = rec.0.lock().unwrap().len();
    let fake = Fake::new(Script {
        rounds: 2,
        ..Script::default()
    });
    let o = go(
        &fake,
        Some(&rec),
        &s,
        true,
        &["--group", "paper past", "t", "--to-board", "paper-past"],
    )
    .await;
    assert_eq!(o.code, 0);
    assert_eq!(rec.0.lock().unwrap().len(), before);
}

#[tokio::test(start_paused = true)]
async fn run_json_is_one_object_per_line_and_ends_with_the_reason() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script {
        rounds: 2,
        ..Script::default()
    });
    let o = go(
        &fake,
        None,
        &s,
        true,
        &["--group", "paper past", "t", "--json"],
    )
    .await;
    let lines: Vec<Value> = o
        .out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.first().unwrap()["type"], "sent");
    let end = lines.last().unwrap();
    assert_eq!(end["type"], "end");
    assert_eq!(end["stop"], "done");
    assert_eq!(end["messages"], 2);
}

#[tokio::test(start_paused = true)]
async fn run_needs_a_group_and_a_task() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    assert_eq!(go(&fake, None, &s, true, &["task"]).await.code, 2);
    assert_eq!(
        go(&fake, None, &s, true, &["--group", "paper past"])
            .await
            .code,
        2
    );
    let o = go(&fake, None, &s, true, &["--group", "nope", "t"]).await;
    assert_eq!(o.code, 1);
    assert!(o.err.contains("no group called"));
}

#[tokio::test(start_paused = true)]
async fn log_prints_the_conversation_and_follow_reads_on() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script {
        rounds: 2,
        ..Script::default()
    });
    go(&fake, None, &s, true, &["--group", "paper past", "hello"]).await;
    let o = go(&fake, None, &s, false, &["log", "paper past"]).await;
    assert_eq!(o.code, 0);
    assert!(o.out.contains("you\n  hello"), "{}", o.out);
    assert!(
        o.out.contains("Kai\n  step 0") && o.out.contains("Nina\n  step 1"),
        "{}",
        o.out
    );
    assert!(o.out.contains("Settled"), "{}", o.out);
    assert!(
        o.out.contains(" UTC] you"),
        "a time says its zone (B37): {}",
        o.out
    );
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["log", "paper past", "--last", "1"],
    )
    .await;
    assert!(
        o.out.contains("Nina") && !o.out.contains("Kai"),
        "{}",
        o.out
    );
    let o = go(&fake, None, &s, false, &["log", "paper past", "--json"]).await;
    assert!(
        o.out
            .lines()
            .all(|l| serde_json::from_str::<Value>(l).is_ok())
    );
    let first: Value = serde_json::from_str(o.out.lines().next().unwrap()).unwrap();
    assert!(first["time"].as_str().unwrap().ends_with('Z'), "{first}");
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["log", "paper past", "--follow", "--for", "1"],
    )
    .await;
    assert_eq!(o.code, 0);
    assert!(fake.count("groups.log") > 4, "the follow polled");
}

#[tokio::test]
async fn set_keeps_and_clears_the_rooms_cap() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(&fake, None, &s, false, &["set", "paper past"]).await;
    assert!(o.out.contains("default, 10 rounds"), "{}", o.out);
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["set", "paper past", "--max-rounds", "12"],
    )
    .await;
    assert!(o.out.contains("stop at 12 rounds"), "{}", o.out);
    assert_eq!(
        RoomSettings::load(&s).unwrap().max_rounds("g-paper-past-"),
        Some(12)
    );
    let o = go(&fake, None, &s, false, &["list"]).await;
    assert!(o.out.contains("max 12 rounds"));
    go(
        &fake,
        None,
        &s,
        false,
        &["set", "paper past", "--max-rounds", "default"],
    )
    .await;
    assert_eq!(
        RoomSettings::load(&s).unwrap().max_rounds("g-paper-past-"),
        None
    );
    assert_eq!(
        go(
            &fake,
            None,
            &s,
            false,
            &["set", "paper past", "--max-rounds", "0"]
        )
        .await
        .code,
        1
    );
}

#[tokio::test(start_paused = true)]
async fn log_shows_a_cancelled_or_failed_turn_so_the_numbering_has_no_gap() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    fake.write(
        "message.user",
        "user",
        &json!({"thread_id": "main", "text": "open every source"}),
    );
    fake.write(
        "turn.cancelled",
        "gateway",
        &json!({"member_id": "kai", "reason": "superseded_by_newer_user_event", "discussion_event_id": "e1"}),
    );
    fake.write(
        "turn.failed",
        "gateway",
        &json!({"member_id": "nina", "error": "Unknown provider 'x'. Check 'hermes model'", "reason_code": "missing_config"}),
    );
    let o = go(&fake, None, &s, false, &["log", "paper past"]).await;
    assert!(
        o.out
            .contains("-- Kai's turn was stopped because a newer message arrived"),
        "{}",
        o.out
    );
    assert!(
        o.out.contains("-- Nina can't reach its model."),
        "{}",
        o.out
    );
    assert!(!o.out.contains("hermes"), "{}", o.out);
    let o = go(&fake, None, &s, false, &["log", "paper past", "--json"]).await;
    let seqs: Vec<u64> = o
        .out
        .lines()
        .map(|l| {
            serde_json::from_str::<Value>(l).unwrap()["seq"]
                .as_u64()
                .unwrap()
        })
        .collect();
    assert_eq!(seqs, [1, 2, 3], "B30: seq 2 and 3 are not skipped");
    let cancelled: Value = serde_json::from_str(o.out.lines().nth(1).unwrap()).unwrap();
    assert_eq!(
        (cancelled["type"].as_str(), cancelled["member"].as_str()),
        (Some("turn.cancelled"), Some("kai"))
    );
}

#[tokio::test(start_paused = true)]
async fn a_message_while_the_bots_work_is_held_until_they_finish() {
    let (d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["send", "paper past", "first task"],
    )
    .await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    let o = go(&fake, None, &s, false, &["send", "paper past", "also this"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert!(
        o.out
            .contains("-- held: the group's conversation is still going")
            || o.out.contains("-- held: Kai"),
        "{}",
        o.out
    );
    assert!(o.out.contains("sent to paper past (cli-"), "{}", o.out);
    // the second message went in only after the first discussion settled: nobody's turn was cut short (B30)
    let log = fake.calls();
    let sends: Vec<usize> = log
        .iter()
        .enumerate()
        .filter(|(_, (m, _))| m == "groups.send")
        .map(|(i, _)| i)
        .collect();
    assert_eq!(sends.len(), 2);
    let o = go(&fake, None, &s, false, &["log", "paper past", "--json"]).await;
    let kinds: Vec<String> = o
        .out
        .lines()
        .map(|l| {
            serde_json::from_str::<Value>(l).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    let settled = kinds.iter().position(|k| k == "room.activity").unwrap();
    let second = kinds.iter().rposition(|k| k == "message.user").unwrap();
    assert!(settled < second, "{kinds:?}");
    assert!(
        hold::Store::under(d.path())
            .held("g-paper-past-")
            .unwrap()
            .is_empty(),
        "nothing is left held"
    );
}

#[tokio::test(start_paused = true)]
async fn a_mention_of_a_bot_outside_the_group_is_said_and_the_message_still_goes() {
    let (_d, s) = tmp();
    let fake = Fake::new(Script::default());
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["send", "paper past", "@moss please confirm, @kai too"],
    )
    .await;
    assert_eq!(o.code, 0, "{}", o.err);
    assert!(
        o.err.contains(
            "boopis: warning: moss isn't in paper past, so the message reaches only Kai and Nina"
        ),
        "B20: {}",
        o.err
    );
    assert!(o.err.contains("boopis run --bot moss"), "{}", o.err);
    let o = go(
        &fake,
        None,
        &s,
        false,
        &["send", "paper past", "@nobody @all hi", "--json"],
    )
    .await;
    assert!(
        o.err.is_empty() && !o.out.contains("warning"),
        "an unknown handle and @all are not outsiders: {}{}",
        o.out,
        o.err
    );
    let o = go(
        &fake,
        None,
        &s,
        true,
        &["--group", "paper past", "@moss do it", "--json"],
    )
    .await;
    let warning: Value = serde_json::from_str(o.out.lines().next().unwrap()).unwrap();
    assert_eq!(
        (warning["type"].as_str(), warning["outside"][0].as_str()),
        (Some("warning"), Some("moss"))
    );
}
