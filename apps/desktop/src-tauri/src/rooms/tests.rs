use std::time::Duration;

use serde_json::json;

use super::fake::{Fake, Script};
use super::run::{Opts, Progress, Stop};
use super::*;

fn opts(max_rounds: u32) -> Opts {
    Opts {
        max_rounds,
        poll: Duration::from_millis(10),
        timeout: Duration::from_secs(60),
        quiet_polls: 3,
        ..Opts::default()
    }
}

async fn run_with(script: Script, o: &Opts) -> (run::Outcome, Vec<Progress>, Fake) {
    let fake = Fake::new(script);
    let room = resolve(&fake, "paper past").await.unwrap();
    let mut seen = Vec::new();
    let out = run::run(&fake, &room, "make the episode", o, &mut |p| seen.push(p))
        .await
        .unwrap();
    (out, seen, fake)
}

#[test]
fn slugs_are_the_apps() {
    assert_eq!(slug("Paper Past!"), "paper-past");
    assert_eq!(slug("  --  "), "group");
    assert_eq!(slug(&"a".repeat(80)).len(), 40);
    assert!(new_room_id("paper past").starts_with("g-paper-past-"));
}

#[tokio::test]
async fn a_room_is_found_by_id_or_name_and_an_unknown_one_says_so() {
    let fake = Fake::new(Script::default());
    assert_eq!(resolve(&fake, "g-paper-past-").await.unwrap().name, "paper past");
    assert_eq!(resolve(&fake, "PAPER PAST").await.unwrap().id, "g-paper-past-");
    let err = resolve(&fake, "nope").await.unwrap_err().to_string();
    assert!(err.contains("groups list"), "{err}");
    let rooms = vec![
        Room::from_value(&json!({"room_id": "a", "name": "x"})),
        Room::from_value(&json!({"room_id": "b", "name": "X"})),
    ];
    let err = find(&rooms, "x").unwrap_err().to_string();
    assert!(err.contains("a, b"), "{err}");
}

fn seats(names: &[&str]) -> Vec<Seat> {
    names
        .iter()
        .map(|n| Seat {
            bot: (*n).to_owned(),
            display: (*n).to_owned(),
        })
        .collect()
}

#[tokio::test]
async fn a_room_is_made_with_its_lead_and_purpose() {
    let fake = Fake::new(Script::default());
    let room = create(
        &fake,
        &NewRoom {
            id: Some("g-x".into()),
            name: "x".into(),
            seats: seats(&["kai", "nina", "moss"]),
            lead: Some("kai".into()),
            purpose: Some("make shorts".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(room.id, "g-x");
    let calls = fake.calls();
    let ctx = calls.iter().find(|(m, _)| m == "groups.context").unwrap();
    assert_eq!(ctx.1["routing"], "lead");
    assert_eq!(ctx.1["lead_member_id"], "kai");
    assert_eq!(ctx.1["purpose"], "make shorts");
    assert_eq!(room.members.len(), 3);
}

#[tokio::test]
async fn a_room_that_cannot_be_made_is_refused_before_the_engine_is_asked() {
    let fake = Fake::new(Script::default());
    let mk = |names: &[&str], lead: Option<&str>| NewRoom {
        name: "x".into(),
        seats: seats(names),
        lead: lead.map(str::to_owned),
        ..NewRoom::default()
    };
    assert!(create(&fake, &mk(&["kai"], None)).await.is_err());
    assert!(create(&fake, &mk(&["kai", "kai"], None)).await.is_err());
    assert!(create(&fake, &mk(&["kai", "nina"], Some("moss"))).await.is_err());
    assert_eq!(fake.count("groups.create"), 0);
    // a bot the engine would not seat says what to do
    let err = create(&fake, &mk(&["kai", "hex"], None)).await.unwrap_err();
    assert_eq!(err.code(), "hx.bots.not_seatable");
    assert!(err.to_string().contains("hex"));
    assert_eq!(fake.count("groups.create"), 0);
}

#[tokio::test(start_paused = true)]
async fn a_run_goes_past_the_engines_pause_until_the_bots_are_done() {
    // 7 rounds at 3 per budget: two pauses, two continues.
    let (out, seen, fake) = run_with(Script { rounds: 7, ..Script::default() }, &opts(30)).await;
    assert_eq!(out.stop, Stop::Done);
    assert_eq!(out.continues, 2);
    assert_eq!(out.messages, 7);
    assert_eq!(out.rounds, 7);
    assert_eq!(fake.count("groups.continue"), 2);
    assert_eq!(out.stop.exit_code(), 0);
    let said: Vec<&str> = seen
        .iter()
        .filter_map(|p| match p {
            Progress::Message { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(said.first(), Some(&"step 0"));
    assert_eq!(said.len(), 7);
    assert!(seen.contains(&Progress::Continued { count: 2, rounds: 9 }));
}

#[tokio::test(start_paused = true)]
async fn a_short_task_needs_no_continue() {
    let (out, _, fake) = run_with(Script { rounds: 2, ..Script::default() }, &opts(30)).await;
    assert_eq!(out.stop, Stop::Done);
    assert_eq!(fake.count("groups.continue"), 0);
}

#[tokio::test(start_paused = true)]
async fn the_cap_stops_a_run_and_says_so() {
    // The bots want 20 rounds; the cap is 6, which is two budgets: one continue, then the cap.
    let (out, _, fake) = run_with(Script { rounds: 20, ..Script::default() }, &opts(6)).await;
    assert_eq!(out.stop, Stop::CapReached);
    assert_eq!(out.stop.exit_code(), 3);
    assert_eq!(out.continues, 1);
    assert_eq!(out.rounds, 6);
    assert_eq!(fake.count("groups.continue"), 1);
}

#[tokio::test(start_paused = true)]
async fn a_cap_inside_the_first_budget_never_continues() {
    let (out, _, fake) = run_with(Script { rounds: 20, ..Script::default() }, &opts(2)).await;
    assert_eq!(out.stop, Stop::CapReached);
    assert_eq!(fake.count("groups.continue"), 0);
}

#[tokio::test(start_paused = true)]
async fn without_auto_continue_the_pause_is_reported() {
    let o = Opts { auto_continue: false, ..opts(30) };
    let (out, _, fake) = run_with(Script { rounds: 7, ..Script::default() }, &o).await;
    assert_eq!(out.stop, Stop::Paused);
    assert_eq!(out.stop.exit_code(), 3);
    assert_eq!(fake.count("groups.continue"), 0);
}

#[tokio::test(start_paused = true)]
async fn a_bot_that_needs_the_owner_stops_the_run_without_answering_for_them() {
    let (out, _, fake) = run_with(Script { rounds: 7, approval_at: Some(1), ..Script::default() }, &opts(30)).await;
    match &out.stop {
        Stop::NeedsOwner(w) => assert!(w.contains("approval"), "{w}"),
        other => panic!("{other:?}"),
    }
    assert_eq!(out.stop.exit_code(), 4);
    assert_eq!(fake.count("groups.approve"), 0);
    assert_eq!(fake.count("groups.stop"), 0);
}

#[tokio::test(start_paused = true)]
async fn a_failed_turn_stops_the_room_and_is_said_in_boopis_words() {
    let (out, _, fake) = run_with(Script { rounds: 7, fail_at: Some(1), ..Script::default() }, &opts(30)).await;
    match &out.stop {
        Stop::Failed(w) => {
            assert!(w.starts_with("Nina can't reach its model"), "{w}");
            assert!(!w.to_ascii_lowercase().contains("hermes"), "{w}");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(out.stop.exit_code(), 1);
    assert_eq!(fake.count("groups.stop"), 1);
}

#[tokio::test(start_paused = true)]
async fn a_room_that_goes_quiet_is_a_failure_not_a_hang() {
    let (out, _, _) = run_with(Script { silent: true, ..Script::default() }, &opts(30)).await;
    assert!(matches!(out.stop, Stop::Failed(_)), "{:?}", out.stop);
}

#[tokio::test(start_paused = true)]
async fn the_runs_own_time_can_run_out() {
    let o = Opts { timeout: Duration::from_millis(15), quiet_polls: 1000, ..opts(30) };
    let (out, _, _) = run_with(Script { silent: true, ..Script::default() }, &o).await;
    assert_eq!(out.stop, Stop::TimedOut);
}

#[test]
fn the_cap_comes_from_the_flag_then_the_room_then_the_default() {
    use settings::effective;
    assert_eq!(effective(Some(5), Some(9)), 5);
    assert_eq!(effective(None, Some(9)), 9);
    assert_eq!(effective(None, None), settings::DEFAULT_MAX_ROUNDS);
}

#[test]
fn room_settings_are_kept_between_runs_and_refuse_bad_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rooms.json");
    let mut s = settings::RoomSettings::load(&path).unwrap();
    assert_eq!(s.max_rounds("g-a"), None);
    s.set_max_rounds("g-a", Some(12)).unwrap();
    s.save(&path).unwrap();
    assert_eq!(settings::RoomSettings::load(&path).unwrap().max_rounds("g-a"), Some(12));
    assert!(s.set_max_rounds("g-a", Some(0)).is_err());
    assert!(s.set_max_rounds("g-a", Some(1001)).is_err());
    assert!(s.set_max_rounds("../x", Some(3)).is_err());
    s.set_max_rounds("g-a", None).unwrap();
    s.save(&path).unwrap();
    assert_eq!(settings::RoomSettings::load(&path).unwrap().max_rounds("g-a"), None);
    // a file this build cannot read is refused, not overwritten
    std::fs::write(&path, "{\"version\": 9, \"rooms\": {}}").unwrap();
    assert!(settings::RoomSettings::load(&path).is_err());
    std::fs::write(&path, "not json").unwrap();
    assert!(settings::RoomSettings::load(&path).is_err());
}
