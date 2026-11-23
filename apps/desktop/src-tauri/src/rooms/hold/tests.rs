//! The hold against a scripted room: a log, who is at work, and the engine's idempotent `groups.send`.

use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::*;
use crate::config::RoomLimits;

/// A room whose state the test sets: members at work or not, and the events its log holds.
struct Room {
    inner: Mutex<Inner>,
}

struct Inner {
    events: Vec<Value>,
    working: Vec<String>,
    calls: Vec<(String, Value)>,
}

fn now() -> f64 {
    super::now_secs()
}

impl Room {
    fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                events: Vec::new(),
                working: Vec::new(),
                calls: Vec::new(),
            }),
        }
    }

    fn push(&self, kind: &str, id: &str, payload: &Value) {
        let mut g = self.inner.lock().unwrap();
        let seq = g.events.len() + 1;
        g.events.push(json!({"seq": seq, "event_id": id, "kind": kind, "actor": {"id": "x"}, "payload": payload, "created_at": now()}));
    }

    fn work(&self, members: &[&str]) {
        self.inner.lock().unwrap().working = members.iter().map(|m| (*m).to_owned()).collect();
    }

    /// The newest user message's discussion settles and nobody works.
    fn settle(&self) {
        let last = {
            let g = self.inner.lock().unwrap();
            g.events
                .iter()
                .rev()
                .find(|e| e["kind"] == "message.user")
                .map(|e| e["event_id"].as_str().unwrap_or("").to_owned())
        };
        self.work(&[]);
        if let Some(id) = last {
            self.push(
                "room.activity",
                "act",
                &json!({"discussion_event_id": id, "status": "settled"}),
            );
        }
    }

    fn sent(&self) -> Vec<(String, String)> {
        let g = self.inner.lock().unwrap();
        g.events
            .iter()
            .filter(|e| e["kind"] == "message.user")
            .map(|e| {
                (
                    e["event_id"].as_str().unwrap().to_owned(),
                    e["payload"]["text"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn count(&self, method: &str) -> usize {
        self.inner
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(m, _)| m == method)
            .count()
    }
}

#[async_trait]
impl Rpc for Room {
    async fn call(&self, method: &str, params: Value) -> crate::error::Result<Value> {
        let mut g = self.inner.lock().unwrap();
        g.calls.push((method.to_owned(), params.clone()));
        match method {
            "groups.log" => {
                let since = params["since_seq"].as_u64().unwrap_or(0);
                let events: Vec<Value> = g
                    .events
                    .iter()
                    .filter(|e| e["seq"].as_u64().unwrap() > since)
                    .cloned()
                    .collect();
                Ok(json!({"events": events, "has_more": false}))
            }
            "groups.state" => {
                let acts: Vec<Value> = g
                    .working
                    .iter()
                    .map(|m| json!({"member_id": m, "status": "running"}))
                    .collect();
                Ok(
                    json!({"room": {}, "driver_status": {"working": !g.working.is_empty(), "blocked": false, "pending_actions": [], "member_activity": acts}}),
                )
            }
            "groups.send" => {
                let id = params["event_id"].as_str().unwrap().to_owned();
                if let Some(e) = g.events.iter().find(|e| e["event_id"] == id.as_str()) {
                    return Ok(json!({"event": e}));
                }
                let seq = g.events.len() + 1;
                let e = json!({"seq": seq, "event_id": id, "kind": "message.user", "actor": {"id": "user"}, "payload": params["payload"], "created_at": now()});
                g.events.push(e.clone());
                Ok(json!({"event": e}))
            }
            "groups.stop" => {
                let seq = g.events.len() + 1;
                g.events.push(json!({"seq": seq, "event_id": "stop", "kind": "room.stop_requested", "actor": {"id": "x"}, "payload": {}, "created_at": now()}));
                g.working.clear();
                Ok(json!({"cancelled": 1}))
            }
            other => Err(crate::error::Error::Unavailable(format!("no {other}"))),
        }
    }
}

fn setup() -> (Room, Store, tempfile::TempDir, RoomLimits) {
    let dir = tempfile::tempdir().unwrap();
    (
        Room::new(),
        Store::under(dir.path()),
        dir,
        RoomLimits::default(),
    )
}

#[tokio::test]
async fn a_free_room_gets_the_message_at_once() {
    let (room, store, _d, limits) = setup();
    let mut w = Watch::new("g-1");
    let out = submit(
        &room,
        &store,
        &mut w,
        "  hello  ",
        How::WhenDone,
        "cli",
        &limits,
    )
    .await
    .unwrap();
    let Outcome::Sent(ev) = out else {
        panic!("{out:?}")
    };
    assert!(ev.id.starts_with("cli-"));
    assert_eq!(room.sent(), [(ev.id.clone(), "hello".to_owned())]);
    assert!(store.held("g-1").unwrap().is_empty());
}

#[tokio::test]
async fn a_message_while_members_work_waits_and_goes_when_the_discussion_is_over() {
    let (room, store, _d, limits) = setup();
    room.push(
        "message.user",
        "u1",
        &json!({"thread_id": "main", "text": "open every source"}),
    );
    room.work(&["kai"]);
    let mut w = Watch::new("g-1");
    let out = submit(
        &room,
        &store,
        &mut w,
        "also say which to cut",
        How::WhenDone,
        "cli",
        &limits,
    )
    .await
    .unwrap();
    let Outcome::Held(held, all) = out else {
        panic!("{out:?}")
    };
    assert_eq!(all, std::slice::from_ref(&held));
    assert_eq!(w.working(), ["kai"]);
    assert_eq!(room.sent().len(), 1, "kai's turn is not cut short (B30)");
    assert_eq!(
        pump(&room, &store, &mut w, &limits).await.unwrap(),
        None,
        "still busy"
    );
    room.settle();
    let ev = pump(&room, &store, &mut w, &limits).await.unwrap().unwrap();
    assert_eq!(ev.id, held.id, "sent with the id it was held with");
    assert_eq!(room.sent().last().unwrap().1, "also say which to cut");
    assert!(store.held("g-1").unwrap().is_empty());
}

#[tokio::test]
async fn an_open_discussion_between_turns_holds_too_but_a_stuck_one_does_not() {
    let (room, store, _d, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    let mut w = Watch::new("g-1");
    let out = submit(&room, &store, &mut w, "next", How::WhenDone, "ui", &limits)
        .await
        .unwrap();
    assert!(
        matches!(out, Outcome::Held(..)),
        "nobody works this second, but the discussion is open and alive"
    );
    let quick = RoomLimits {
        quiet_grace: std::time::Duration::ZERO,
        ..RoomLimits::default()
    };
    assert!(
        pump(&room, &store, &mut w, &quick).await.unwrap().is_some(),
        "a silent open discussion is stuck: the message goes"
    );
}

#[tokio::test]
async fn held_messages_go_one_discussion_at_a_time_in_order() {
    let (room, store, _d, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    room.work(&["kai", "nina"]);
    let mut w = Watch::new("g-1");
    for t in ["first", "second"] {
        submit(&room, &store, &mut w, t, How::WhenDone, "cli", &limits)
            .await
            .unwrap();
    }
    room.settle();
    let a = pump(&room, &store, &mut w, &limits).await.unwrap().unwrap();
    assert_eq!(room.sent().last().unwrap().1, "first");
    assert_eq!(
        pump(&room, &store, &mut w, &limits).await.unwrap(),
        None,
        "the first one's discussion runs now"
    );
    assert_eq!(store.held("g-1").unwrap().len(), 1);
    room.settle();
    let b = pump(&room, &store, &mut w, &limits).await.unwrap().unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(room.sent().last().unwrap().1, "second");
    // a message written when the room is free but something is still held goes after it
    room.push("message.user", "u9", &json!({"text": "busy again"}));
    room.work(&["kai"]);
    submit(
        &room,
        &store,
        &mut w,
        "third",
        How::WhenDone,
        "cli",
        &limits,
    )
    .await
    .unwrap();
    room.settle();
    let out = submit(
        &room,
        &store,
        &mut w,
        "fourth",
        How::WhenDone,
        "cli",
        &limits,
    )
    .await
    .unwrap();
    assert!(
        matches!(out, Outcome::Held(..)),
        "fourth waits behind third"
    );
    assert_eq!(
        room.sent().last().unwrap().1,
        "third",
        "third went first, when the room was free"
    );
}

#[tokio::test]
async fn two_processes_pumping_the_same_hold_send_the_message_once() {
    let (room, store, dir, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    room.work(&["kai"]);
    let mut w = Watch::new("g-1");
    let Outcome::Held(held, _) =
        submit(&room, &store, &mut w, "once", How::WhenDone, "cli", &limits)
            .await
            .unwrap()
    else {
        panic!("held")
    };
    room.settle();
    // The app and the command line both saw the room free at the same moment: one sent first, the other sends too. The held
    // message names its own event id, and the engine's send is idempotent by it.
    let other = Store::under(dir.path());
    let mut w2 = Watch::new("g-1");
    let a = send_as(&room, "g-1", &held.id, &held.text).await.unwrap();
    let same_moment = RoomLimits {
        quiet_grace: std::time::Duration::ZERO,
        ..RoomLimits::default()
    };
    let b = pump(&room, &other, &mut w2, &same_moment)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((a.seq, a.id.clone()), (b.seq, b.id));
    assert_eq!(room.sent().iter().filter(|(_, t)| t == "once").count(), 1);
    assert!(
        pump(&room, &store, &mut w, &limits)
            .await
            .unwrap()
            .is_none(),
        "nothing left"
    );
    let _ = limits;
}

async fn send_as(room: &Room, id: &str, event: &str, text: &str) -> crate::error::Result<Event> {
    super::super::send_as(room, id, event, text).await
}

#[tokio::test]
async fn held_messages_survive_the_process_that_held_them() {
    let (room, store, dir, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    room.work(&["kai"]);
    let mut w = Watch::new("g-1");
    submit(&room, &store, &mut w, "kept", How::WhenDone, "cli", &limits)
        .await
        .unwrap();
    drop(store);
    let text = std::fs::read_to_string(dir.path().join(FILE)).unwrap();
    assert!(
        text.contains("\"version\": 1") && text.contains("kept"),
        "{text}"
    );
    room.settle();
    let later = Store::under(dir.path());
    let mut fresh = Watch::new("g-1");
    let ev = pump(&room, &later, &mut fresh, &limits)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(room.sent().last().unwrap().1, "kept");
    assert!(ev.id.starts_with("cli-"));
}

#[tokio::test]
async fn send_now_stops_the_running_turns_first_and_take_back_removes_it() {
    let (room, store, _d, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    room.work(&["kai"]);
    let mut w = Watch::new("g-1");
    let Outcome::Held(a, _) = submit(&room, &store, &mut w, "a", How::WhenDone, "ui", &limits)
        .await
        .unwrap()
    else {
        panic!()
    };
    let Outcome::Held(b, _) = submit(&room, &store, &mut w, "b", How::WhenDone, "ui", &limits)
        .await
        .unwrap()
    else {
        panic!()
    };
    let ev = send_now(&room, &store, &mut w, &b.id, &limits)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        room.count("groups.stop"),
        1,
        "the running turn is stopped first, as Send now says"
    );
    assert_eq!(ev.id, b.id);
    assert_eq!(store.held("g-1").unwrap(), std::slice::from_ref(&a));
    assert_eq!(store.remove("g-1", &a.id).unwrap().unwrap().text, "a");
    assert_eq!(store.remove("g-1", &a.id).unwrap(), None, "taken back once");
    assert_eq!(
        send_now(&room, &store, &mut w, &a.id, &limits)
            .await
            .unwrap(),
        None
    );
    let now = submit(&room, &store, &mut w, "now", How::Now, "api", &limits)
        .await
        .unwrap();
    assert!(matches!(now, Outcome::Sent(_)), "now never waits");
}

#[tokio::test]
async fn deliver_waits_pumping_itself_and_knows_a_message_taken_back() {
    let (room, store, _d, limits) = setup();
    room.push("message.user", "u1", &json!({"text": "go"}));
    room.work(&["kai"]);
    let room = std::sync::Arc::new(room);
    let mut w = Watch::new("g-1");
    let settle = {
        let room = room.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(60)).await;
            room.settle();
        })
    };
    let mut told = Vec::new();
    let got = deliver(
        &*room,
        &store,
        &mut w,
        "after you",
        "cli",
        &limits,
        std::time::Duration::from_millis(10),
        std::time::Duration::from_secs(10),
        &mut |_, working| told.push(working.to_vec()),
    )
    .await
    .unwrap();
    settle.await.unwrap();
    assert_eq!(told, [vec!["kai".to_owned()]]);
    let Delivered::Sent(ev) = got else {
        panic!("{got:?}")
    };
    assert_eq!(room.sent().last().unwrap().0, ev.id);

    room.push("message.user", "u2", &json!({"text": "again"}));
    room.work(&["nina"]);
    let taker = {
        let store = store.clone();
        tokio::spawn(async move {
            for _ in 0..200 {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                if let Some(h) = store.held_now("g-1").await.unwrap().first().cloned() {
                    store.remove_now("g-1", &h.id).await.unwrap();
                    return;
                }
            }
        })
    };
    let got = deliver(
        &*room,
        &store,
        &mut w,
        "never mind",
        "cli",
        &limits,
        std::time::Duration::from_millis(10),
        std::time::Duration::from_secs(10),
        &mut |_, _| {},
    )
    .await
    .unwrap();
    taker.await.unwrap();
    assert_eq!(got, Delivered::TakenBack);
    assert!(!room.sent().iter().any(|(_, t)| t == "never mind"));
    let got = deliver(
        &*room,
        &store,
        &mut w,
        "later",
        "cli",
        &limits,
        std::time::Duration::from_millis(5),
        std::time::Duration::from_millis(20),
        &mut |_, _| {},
    )
    .await
    .unwrap();
    assert!(
        matches!(got, Delivered::StillHeld(_)),
        "the wait ran out; it stays held"
    );
    assert_eq!(store.held("g-1").unwrap().len(), 1);
}

#[test]
fn the_file_refuses_what_it_cannot_read_and_a_full_hold_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::under(dir.path());
    let held = |i: usize| Held {
        id: format!("cli-{i}"),
        text: "x".into(),
        at: 0.0,
    };
    for i in 0..3 {
        store.push("g-1", held(i), 3).unwrap();
    }
    let full = store.push("g-1", held(9), 3).unwrap_err();
    assert!(full.to_string().contains("already waiting"), "{full}");
    assert_eq!(
        store.push("g-1", held(1), 9).unwrap().len(),
        3,
        "the same id is held once"
    );
    std::fs::write(store.path(), r#"{"version": 9, "rooms": {}}"#).unwrap();
    assert!(matches!(
        store.held("g-1"),
        Err(crate::error::Error::Config(_))
    ));
    assert!(
        std::fs::read_to_string(store.path())
            .unwrap()
            .contains("\"version\": 9"),
        "nothing was overwritten"
    );
    std::fs::write(store.path(), "").unwrap();
    assert!(store.held("g-1").unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_or_huge_message_is_refused_before_the_room_is_read() {
    let (room, store, _d, limits) = setup();
    let mut w = Watch::new("g-1");
    for bad in ["   ", "a\0b"] {
        assert!(matches!(
            submit(&room, &store, &mut w, bad, How::WhenDone, "cli", &limits).await,
            Err(crate::error::Error::InvalidInput(_))
        ));
    }
    let huge = "x".repeat(limits.max_text + 1);
    assert!(
        submit(&room, &store, &mut w, &huge, How::WhenDone, "cli", &limits)
            .await
            .is_err()
    );
    assert_eq!(room.count("groups.log"), 0);
}
