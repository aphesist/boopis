//! A room's log as the lines a person reads: the one reading of `groups.log` that `boopis groups log` prints and the local
//! API's room log serves (the app's room draws the same events, `host/live/groups.ts`). The messages are the user's and the
//! members'; what happened to a turn (it failed, it was cancelled, a member was not available), a stop, the lead passing a
//! message on and a discussion that paused or settled are lines boopis says, in its own words. Bookkeeping events
//! (`turn.settled`, `room.continued`, ...) are not lines: they say nothing a person has not already read.

use serde_json::Value;

use super::{Event, Room};

/// Who a line is from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Speaker {
    /// The human (any client: the app, the command line, the local API).
    User,
    /// A member, by member id.
    Member(String),
    /// boopis, saying what happened in the room.
    Boopis,
}

/// One line of a room's log.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// Its place in the log.
    pub seq: u64,
    /// The event's id.
    pub id: String,
    /// When, in seconds since 1970.
    pub at: f64,
    /// The engine's event kind it comes from.
    pub kind: String,
    /// Who it is from.
    pub from: Speaker,
    /// The member a line is about (a failed or cancelled turn), when there is one.
    pub about: Option<String>,
    /// What it says.
    pub text: String,
}

/// A failed turn in boopis's words (the bot, what happened, the next step).
fn failed(room: &Room, e: &Event) -> String {
    let id = e.text("member_id").unwrap_or("a bot");
    super::run::turn_failed_words(
        room.name_of(id),
        e.text("error").unwrap_or(""),
        e.text("reason_code"),
    )
}

/// A cancelled turn: the engine drops the answer of a member still working when a newer message arrives.
fn cancelled(room: &Room, e: &Event) -> String {
    let name = room.name_of(e.text("member_id").unwrap_or("a bot"));
    if e.text("reason") == Some("superseded_by_newer_user_event") {
        format!(
            "{name}'s turn was stopped because a newer message arrived, so its answer is not shown."
        )
    } else {
        format!("{name}'s turn was cancelled, so its answer is not shown.")
    }
}

/// The lead passing a message on (`room.assignment`): "kai gave this to nina and moss".
fn assignment(room: &Room, e: &Event) -> Option<String> {
    let lead = e.text("lead_member_id").filter(|l| !l.is_empty())?;
    let others: Vec<&str> = e
        .payload
        .get("member_ids")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .filter(|id| *id != lead)
                .map(|id| room.name_of(id))
                .collect()
        })
        .unwrap_or_default();
    let fallback = e.payload.get("fallback").and_then(Value::as_bool) == Some(true);
    Some(if fallback || others.is_empty() {
        format!("{} is answering this one.", room.name_of(lead))
    } else {
        format!(
            "{} gave this to {}.",
            room.name_of(lead),
            super::list_words(&others)
        )
    })
}

/// The line an event is, or `None` for bookkeeping and for a message with no words.
#[must_use]
pub fn line(room: &Room, e: &Event) -> Option<Line> {
    let said = |from: Speaker, about: Option<String>, text: String| {
        let text = text.trim().to_owned();
        (!text.is_empty()).then(|| Line {
            seq: e.seq,
            id: e.id.clone(),
            at: e.at,
            kind: e.kind.clone(),
            from,
            about,
            text,
        })
    };
    let member = || e.text("member_id").map(str::to_owned);
    match e.kind.as_str() {
        "message.user" => said(Speaker::User, None, e.text("text").unwrap_or("").to_owned()),
        "message.member" => {
            let id = e.text("member_id").unwrap_or(&e.actor).to_owned();
            said(
                Speaker::Member(id),
                None,
                e.text("text").unwrap_or("").to_owned(),
            )
        }
        "turn.failed" => said(Speaker::Boopis, member(), failed(room, e)),
        "turn.cancelled" => said(Speaker::Boopis, member(), cancelled(room, e)),
        "member.unavailable" => said(
            Speaker::Boopis,
            member(),
            format!(
                "{} is not available.",
                room.name_of(e.text("member_id").unwrap_or("a bot"))
            ),
        ),
        "room.assignment" => said(Speaker::Boopis, None, assignment(room, e)?),
        "room.stop_requested" => said(Speaker::Boopis, None, "Stopped.".to_owned()),
        "room.activity" => match e.text("status") {
            Some("bounded") => said(
                Speaker::Boopis,
                None,
                "The conversation paused at its limit.".to_owned(),
            ),
            Some("settled") => said(
                Speaker::Boopis,
                None,
                "Settled: the bots stopped handing off.".to_owned(),
            ),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn room() -> Room {
        Room::from_value(&json!({"room_id": "g-1", "name": "paper past", "members": [
            {"member_id": "kai", "profile": "kai", "handle": "kai", "display_name": "Kai"},
            {"member_id": "nina", "profile": "nina", "handle": "nina", "display_name": "Nina"},
            {"member_id": "moss", "profile": "moss", "handle": "moss", "display_name": "Moss"}]}))
    }

    fn ev(seq: u64, kind: &str, payload: Value) -> Event {
        Event {
            seq,
            id: format!("e{seq}"),
            kind: kind.into(),
            actor: "kai".into(),
            payload,
            at: 1000.0,
        }
    }

    #[test]
    fn a_cancelled_or_failed_turn_is_a_line_and_bookkeeping_is_not() {
        let r = room();
        let l = line(
            &r,
            &ev(
                57,
                "turn.cancelled",
                json!({"member_id": "kai", "reason": "superseded_by_newer_user_event"}),
            ),
        )
        .unwrap();
        assert_eq!(
            (l.seq, l.from.clone(), l.about.as_deref()),
            (57, Speaker::Boopis, Some("kai"))
        );
        assert!(
            l.text
                .starts_with("Kai's turn was stopped because a newer message arrived"),
            "{}",
            l.text
        );
        let l = line(
            &r,
            &ev(
                58,
                "turn.cancelled",
                json!({"member_id": "nina", "reason": "member turn cancelled"}),
            ),
        )
        .unwrap();
        assert_eq!(
            l.text,
            "Nina's turn was cancelled, so its answer is not shown."
        );
        let l = line(&r, &ev(59, "turn.failed", json!({"member_id": "nina", "error": "Unknown provider 'x'. Check 'hermes model'", "reason_code": "missing_config"}))).unwrap();
        assert!(
            l.text.starts_with("Nina can't reach its model."),
            "{}",
            l.text
        );
        assert!(
            !l.text.contains("hermes"),
            "the engine's words stay out: {}",
            l.text
        );
        for kind in ["turn.settled", "room.continued", "room.created"] {
            assert!(line(&r, &ev(60, kind, json!({}))).is_none(), "{kind}");
        }
        assert!(
            line(
                &r,
                &ev(
                    61,
                    "message.member",
                    json!({"member_id": "kai", "text": "  "})
                )
            )
            .is_none()
        );
    }

    #[test]
    fn messages_and_the_leads_hand_off_read_as_the_app_draws_them() {
        let r = room();
        assert_eq!(
            line(&r, &ev(1, "message.user", json!({"text": "go"})))
                .unwrap()
                .from,
            Speaker::User
        );
        assert_eq!(
            line(
                &r,
                &ev(
                    2,
                    "message.member",
                    json!({"member_id": "nina", "text": "on it"})
                )
            )
            .unwrap()
            .from,
            Speaker::Member("nina".into())
        );
        let l = line(
            &r,
            &ev(
                3,
                "room.assignment",
                json!({"lead_member_id": "kai", "member_ids": ["kai", "nina", "moss"]}),
            ),
        )
        .unwrap();
        assert_eq!(l.text, "Kai gave this to Nina and Moss.");
        let l = line(
            &r,
            &ev(
                4,
                "room.assignment",
                json!({"lead_member_id": "kai", "member_ids": ["kai"], "fallback": true}),
            ),
        )
        .unwrap();
        assert_eq!(l.text, "Kai is answering this one.");
        assert!(line(&r, &ev(5, "room.activity", json!({"status": "working"}))).is_none());
    }
}
