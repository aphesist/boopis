//! Rooms (the engine's group chats, `groups.*`) as the command line and the team file use them: find a room, make one,
//! send into it, read its log, and run a task through it past the engine's round cap (`run`).
//!
//! Everything here asks the engine through one door, [`Rpc`], which the real host fills with a short link to the gateway
//! (a fresh ticket, the same dial the app's own proxy makes) and the tests fill with a scripted room. No method is guessed:
//! each one and its parameters are the engine's (`tui_gateway/contracts/groups_bot_relay.py`).

pub mod discussion;
pub mod hold;
pub mod lines;
pub mod mentions;
pub mod run;
pub mod settings;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::error::{Error, Result};

/// The thread every room message of the app goes to (`groups.ts`).
pub const THREAD: &str = "main";
/// A room has two to six bots (the engine's roster rule, and the new-group form's).
pub const MIN_MEMBERS: usize = 2;
/// See [`MIN_MEMBERS`].
pub const MAX_MEMBERS: usize = 6;

/// One request to the gateway, and its answer. An error answer is an `Err` carrying the gateway's own words.
#[async_trait]
pub trait Rpc: Send + Sync {
    /// Ask `method` with `params`.
    ///
    /// # Errors
    /// `Unavailable` for a refusal (with the gateway's message) or a link that could not be made.
    async fn call(&self, method: &str, params: Value) -> Result<Value>;
}

/// A bot seated in a room.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// The member id (a bot's name).
    pub id: String,
    /// The profile it answers as.
    pub profile: String,
    /// What people type after `@`.
    pub handle: String,
    /// The name shown.
    pub name: String,
}

impl Member {
    fn from_value(v: &Value) -> Self {
        let text = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned()
        };
        let profile = text("profile");
        let id = if text("member_id").is_empty() {
            profile.clone()
        } else {
            text("member_id")
        };
        let name = if text("display_name").is_empty() {
            id.clone()
        } else {
            text("display_name")
        };
        Self {
            handle: if text("handle").is_empty() {
                profile.clone()
            } else {
                text("handle")
            },
            id,
            profile,
            name,
        }
    }
}

/// A room as `groups.list` gives it.
#[derive(Debug, Clone, PartialEq)]
pub struct Room {
    /// Its id.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Who is seated (frozen when the room is made).
    pub members: Vec<Member>,
    /// Gone for good.
    pub disbanded: bool,
    /// The newest event's number, when the engine says.
    pub latest_seq: Option<u64>,
}

impl Room {
    /// Read a room row.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            id: v
                .get("room_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            name: v
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            members: v
                .get("members")
                .and_then(Value::as_array)
                .map(|m| m.iter().map(Member::from_value).collect())
                .unwrap_or_default(),
            disbanded: v.get("disbanded_at").is_some_and(|d| !d.is_null()),
            latest_seq: v.get("latest_seq").and_then(Value::as_u64),
        }
    }

    /// The members' ids, in seating order.
    #[must_use]
    pub fn member_ids(&self) -> Vec<&str> {
        self.members.iter().map(|m| m.id.as_str()).collect()
    }

    /// The name of the member with this id.
    #[must_use]
    pub fn name_of<'a>(&'a self, id: &'a str) -> &'a str {
        self.members
            .iter()
            .find(|m| m.id == id)
            .map_or(id, |m| m.name.as_str())
    }
}

/// A room's name as a short id piece: lower case letters and digits joined by `-`, 40 at most (`groups.ts`' `slug`).
#[must_use]
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            if dash && !out.is_empty() {
                out.push('-');
            }
            dash = false;
            out.push(c);
        } else {
            dash = true;
        }
    }
    out.truncate(40);
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() {
        "group".to_owned()
    } else {
        out
    }
}

/// Twelve random hex characters (the tail of a v7 id is random).
fn random_hex() -> String {
    let u = uuid::Uuid::now_v7().simple().to_string();
    u[u.len() - 12..].to_owned()
}

/// A new room id the way the app makes one: `g-<slug>-<12 random hex>`.
#[must_use]
pub fn new_room_id(name: &str) -> String {
    let uid = random_hex();
    format!("g-{}-{}", slug(name), uid)
}

/// A fresh event id for something this side writes (`cli-<12 hex>`), so the log shows where a message came from.
#[must_use]
pub fn new_event_id(prefix: &str) -> String {
    format!("{prefix}-{}", random_hex())
}

/// Names in a sentence: "kai", "kai and nina", "kai, nina and moss".
#[must_use]
pub fn list_words<S: AsRef<str>>(names: &[S]) -> String {
    match names {
        [] => String::new(),
        [one] => one.as_ref().to_owned(),
        [rest @ .., last] => format!(
            "{} and {}",
            rest.iter()
                .map(AsRef::as_ref)
                .collect::<Vec<_>>()
                .join(", "),
            last.as_ref()
        ),
    }
}

/// The bots that exist (the engine's profiles, archived ones left out), by name: who a mention can name outside a room.
///
/// # Errors
/// The gateway's.
pub async fn known_bots(rpc: &dyn Rpc) -> Result<Vec<String>> {
    let res = rpc
        .call("profiles.list", json!({"include_sessions": false}))
        .await?;
    Ok(res
        .get("profiles")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r.get("name").and_then(Value::as_str))
                .filter(|n| !n.is_empty() && !n.starts_with(crate::bots::ARCHIVE_PREFIX))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

/// The rooms of the root's gateway, most recently changed first.
///
/// # Errors
/// The gateway's.
pub async fn list(rpc: &dyn Rpc, include_disbanded: bool) -> Result<Vec<Room>> {
    let mut params = json!({"limit": 500});
    if include_disbanded {
        params["include_disbanded"] = json!(true);
    }
    let res = rpc.call("groups.list", params).await?;
    Ok(res
        .get("rooms")
        .and_then(Value::as_array)
        .map(|r| r.iter().map(Room::from_value).collect())
        .unwrap_or_default())
}

/// Find a room by its id, or else by its name (case does not matter).
///
/// # Errors
/// `InvalidInput` when no room, or more than one, answers to `key` (the message lists the ids).
pub fn find<'a>(rooms: &'a [Room], key: &str) -> Result<&'a Room> {
    let key = key.trim();
    if let Some(r) = rooms.iter().find(|r| !r.disbanded && r.id == key) {
        return Ok(r);
    }
    let named: Vec<&Room> = rooms
        .iter()
        .filter(|r| !r.disbanded && r.name.trim().eq_ignore_ascii_case(key))
        .collect();
    match named.as_slice() {
        [one] => Ok(one),
        [] => Err(Error::InvalidInput(format!(
            "there is no group called {key:?}. `boopis groups list` shows the ones you have."
        ))),
        many => Err(Error::InvalidInput(format!(
            "{} groups are called {key:?}: use an id ({}).",
            many.len(),
            many.iter()
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// Find a room by id or name on the gateway.
///
/// # Errors
/// As [`list`] and [`find`].
pub async fn resolve(rpc: &dyn Rpc, key: &str) -> Result<Room> {
    let rooms = list(rpc, false).await?;
    find(&rooms, key).cloned()
}

/// How a room routes a message that names nobody.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Context {
    /// What the room is for.
    pub purpose: String,
    /// Shared notes.
    pub notes: String,
    /// `everyone`, `lead` or `auto`.
    pub routing: String,
    /// The lead's member id.
    pub lead: String,
}

impl Context {
    fn from_value(v: &Value) -> Self {
        let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
        Self {
            purpose: text("purpose"),
            notes: text("notes"),
            routing: if text("routing").is_empty() {
                "everyone".to_owned()
            } else {
                text("routing")
            },
            lead: text("lead_member_id"),
        }
    }
}

/// What a room is doing now.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct State {
    /// Its purpose, notes and routing.
    pub context: Context,
    /// A member is working.
    pub working: bool,
    /// The driver waits for someone (an approval, a retry).
    pub blocked: bool,
    /// The actions it waits on, as the engine gives them.
    pub pending: Vec<Value>,
    /// The engine's rounds per budget (`hosted_rooms.discussion.max_rounds`, read at its start).
    pub engine_rounds: Option<u32>,
    /// The driver's last preparation failure.
    pub last_error: Option<String>,
    /// The members the room says are at work now (`member_activity`, member ids, in the engine's order).
    pub at_work: Vec<String>,
}

/// Read a room's state.
///
/// # Errors
/// The gateway's.
pub async fn state(rpc: &dyn Rpc, room_id: &str) -> Result<State> {
    let res = rpc
        .call("groups.state", json!({"room_id": room_id}))
        .await?;
    let d = res.get("driver_status").filter(|d| !d.is_null());
    Ok(State {
        context: res
            .get("context")
            .map(Context::from_value)
            .unwrap_or_default(),
        working: d.and_then(|d| d.get("working")).and_then(Value::as_bool) == Some(true),
        blocked: d.and_then(|d| d.get("blocked")).and_then(Value::as_bool) == Some(true),
        pending: d
            .and_then(|d| d.get("pending_actions"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        engine_rounds: d
            .and_then(|d| d.get("max_rounds"))
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok()),
        last_error: d
            .and_then(|d| d.get("last_error"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        at_work: d
            .and_then(|d| d.get("member_activity"))
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| r.get("member_id").and_then(Value::as_str))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// A bot to seat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seat {
    /// The bot's name (its profile, member id and handle).
    pub bot: String,
    /// The name shown.
    pub display: String,
}

/// What to make.
#[derive(Debug, Clone, Default)]
pub struct NewRoom {
    /// The id, or `None` for a fresh one.
    pub id: Option<String>,
    /// The name.
    pub name: String,
    /// Who sits.
    pub seats: Vec<Seat>,
    /// The lead, when messages are routed through one.
    pub lead: Option<String>,
    /// What the room is for.
    pub purpose: Option<String>,
}

/// Check what a room is made of before the engine is asked.
///
/// # Errors
/// `InvalidInput` with the rule that was broken.
pub fn check(new: &NewRoom) -> Result<()> {
    if new.name.trim().is_empty() {
        return Err(Error::InvalidInput("a group needs a name".into()));
    }
    let n = new.seats.len();
    if !(MIN_MEMBERS..=MAX_MEMBERS).contains(&n) {
        return Err(Error::InvalidInput(format!(
            "a group is {MIN_MEMBERS} to {MAX_MEMBERS} bots, not {n}"
        )));
    }
    let mut seen = std::collections::BTreeSet::new();
    for s in &new.seats {
        if !seen.insert(s.bot.as_str()) {
            return Err(Error::InvalidInput(format!("{} is listed twice", s.bot)));
        }
    }
    if let Some(lead) = &new.lead
        && !new.seats.iter().any(|s| &s.bot == lead)
    {
        return Err(Error::InvalidInput(format!(
            "the lead {lead} is not one of the group's bots"
        )));
    }
    Ok(())
}

/// Which of `bots` the gateway will not seat for this caller, or `None` when it does not say.
///
/// # Errors
/// The gateway's.
pub async fn unseatable(rpc: &dyn Rpc, bots: &[String]) -> Result<Option<Vec<String>>> {
    let res = rpc.call("groups.capabilities", json!({})).await?;
    let Some(seatable) = res.get("seatable_profiles").and_then(Value::as_array) else {
        return Ok(None);
    };
    let ok: Vec<&str> = seatable.iter().filter_map(Value::as_str).collect();
    Ok(Some(
        bots.iter()
            .filter(|b| !ok.contains(&b.as_str()))
            .cloned()
            .collect(),
    ))
}

/// Make a room (idempotent by id on the engine's side), then set its purpose and lead when given.
///
/// # Errors
/// `InvalidInput` from [`check`], `Bots("hx.bots.not_seatable")` when the gateway will not seat a bot, the gateway's
/// otherwise.
pub async fn create(rpc: &dyn Rpc, new: &NewRoom) -> Result<Room> {
    check(new)?;
    let bots: Vec<String> = new.seats.iter().map(|s| s.bot.clone()).collect();
    if let Some(missing) = unseatable(rpc, &bots).await?
        && !missing.is_empty()
    {
        return Err(Error::Bots(
            "hx.bots.not_seatable",
            format!(
                "the engine will not seat {} in a group yet. Open boopis once so every bot is prepared, then try again.",
                missing.join(", ")
            ),
        ));
    }
    let id = new.id.clone().unwrap_or_else(|| new_room_id(&new.name));
    let members: Vec<Value> = new
        .seats
        .iter()
        .map(|s| {
            json!({"member_id": s.bot, "profile": s.bot, "handle": s.bot, "display_name": s.display})
        })
        .collect();
    let res = rpc
        .call(
            "groups.create",
            json!({"room_id": id, "name": new.name.trim(), "members": members}),
        )
        .await?;
    let room = Room::from_value(res.get("room").unwrap_or(&Value::Null));
    let room = if room.id.is_empty() {
        resolve(rpc, &id).await?
    } else {
        room
    };
    if new.lead.is_some() || new.purpose.is_some() {
        let ctx = Context {
            purpose: new.purpose.clone().unwrap_or_default(),
            notes: String::new(),
            routing: if new.lead.is_some() {
                "lead"
            } else {
                "everyone"
            }
            .to_owned(),
            lead: new.lead.clone().unwrap_or_default(),
        };
        set_context(rpc, &room.id, &ctx).await?;
    }
    Ok(room)
}

/// Set a room's purpose, notes and routing (`groups.context`).
///
/// # Errors
/// The gateway's.
pub async fn set_context(rpc: &dyn Rpc, room_id: &str, ctx: &Context) -> Result<()> {
    let mut params = json!({
        "room_id": room_id,
        "event_id": new_event_id("cx"),
        "purpose": ctx.purpose,
        "notes": ctx.notes,
        "routing": ctx.routing,
    });
    if ctx.routing == "lead" {
        params["lead_member_id"] = json!(ctx.lead);
    }
    rpc.call("groups.context", params).await.map(|_| ())
}

/// One entry of a room's log.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// Its place in the log.
    pub seq: u64,
    /// Its id.
    pub id: String,
    /// What kind (`message.user`, `message.member`, `room.activity`, `turn.failed`, ...).
    pub kind: String,
    /// Who did it (`user`, or a member id).
    pub actor: String,
    /// The engine's payload.
    pub payload: Value,
    /// Seconds since 1970.
    pub at: f64,
}

impl Event {
    /// Read one event of `groups.log`.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            seq: v.get("seq").and_then(Value::as_u64).unwrap_or(0),
            id: v
                .get("event_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            kind: v
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            actor: v
                .get("actor")
                .and_then(|a| a.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            payload: v.get("payload").cloned().unwrap_or(Value::Null),
            at: v.get("created_at").and_then(Value::as_f64).unwrap_or(0.0),
        }
    }

    /// A string of the payload.
    #[must_use]
    pub fn text(&self, key: &str) -> Option<&str> {
        self.payload.get(key).and_then(Value::as_str)
    }
}

/// One page of the log.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    /// The events, oldest first.
    pub events: Vec<Event>,
    /// More follow.
    pub more: bool,
}

/// Read the log after `since_seq`.
///
/// # Errors
/// The gateway's.
pub async fn log_page(rpc: &dyn Rpc, room_id: &str, since_seq: u64) -> Result<Page> {
    let res = rpc
        .call(
            "groups.log",
            json!({"room_id": room_id, "since_seq": since_seq, "limit": 200}),
        )
        .await?;
    Ok(Page {
        events: res
            .get("events")
            .and_then(Value::as_array)
            .map(|e| e.iter().map(Event::from_value).collect())
            .unwrap_or_default(),
        more: res.get("has_more").and_then(Value::as_bool) == Some(true),
    })
}

/// Read the whole log after `since_seq` (a bounded number of pages).
///
/// # Errors
/// The gateway's.
pub async fn log_since(rpc: &dyn Rpc, room_id: &str, since_seq: u64) -> Result<Vec<Event>> {
    let mut out = Vec::new();
    let mut cursor = since_seq;
    for _ in 0..50 {
        let page = log_page(rpc, room_id, cursor).await?;
        if let Some(last) = page.events.last() {
            cursor = last.seq;
        }
        out.extend(page.events);
        if !page.more {
            break;
        }
    }
    Ok(out)
}

/// Send a message to a room as the user, straight away. Every client sends through the hold (`hold::submit`), which calls
/// this when the room is free; nothing else should.
///
/// # Errors
/// `InvalidInput` for an empty text, the gateway's otherwise.
pub async fn send_as(rpc: &dyn Rpc, room_id: &str, event_id: &str, text: &str) -> Result<Event> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::InvalidInput("there is nothing to send".into()));
    }
    // The engine's `groups.send` is idempotent by event id: the same id twice is one message (a hold pumped by two processes).
    let res = rpc
        .call(
            "groups.send",
            json!({"room_id": room_id, "event_id": event_id, "payload": {"thread_id": THREAD, "text": text}}),
        )
        .await?;
    let mut event = Event::from_value(res.get("event").unwrap_or(&Value::Null));
    if event.id.is_empty() {
        event_id.clone_into(&mut event.id);
    }
    Ok(event)
}

/// Ask for one more budget for a paused discussion (`groups.continue`).
///
/// # Errors
/// The gateway's.
pub async fn continue_discussion(rpc: &dyn Rpc, room_id: &str, discussion: &str) -> Result<()> {
    rpc.call(
        "groups.continue",
        json!({"room_id": room_id, "discussion_event_id": discussion}),
    )
    .await
    .map(|_| ())
}

/// Stop the work queued or running in a room.
///
/// # Errors
/// The gateway's.
pub async fn stop(rpc: &dyn Rpc, room_id: &str) -> Result<()> {
    rpc.call(
        "groups.stop",
        json!({"room_id": room_id, "cancel_id": new_event_id("stop")}),
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
pub mod fake;
#[cfg(test)]
mod tests;
