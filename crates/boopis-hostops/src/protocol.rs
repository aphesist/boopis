//! The wire: the verbs, the envelope and each verb's parameters (`docs/specs/team-ops.md` 4.2 and 4.3).
//!
//! ```json
//! {"v": 1, "token": "…", "op": "room.say", "id": "house/j_0193…/3", "dry_run": false, "params": {…}}
//! {"v": 1, "protocol": "hx-host-ops-v1", "ok": true, "result": {…}}
//! {"v": 1, "protocol": "hx-host-ops-v1", "ok": false, "code": "hx.rooms.busy", "message": "…"}
//! ```

use serde_json::{Value, json};

use crate::Refusal;

/// The protocol's name, in every answer.
pub const PROTOCOL: &str = "hx-host-ops-v1";
/// The environment variable that carries the channel's token to the gateway, and only there.
pub const TOKEN_ENV: &str = "BOOPIS_HOST_OPS_TOKEN";
/// The environment variable that names the channel's socket for the plugin.
pub const SOCKET_ENV: &str = "BOOPIS_HOST_OPS_SOCKET";
/// The socket's file name, beside the secret channel's `host.sock`.
pub const SOCKET_FILE: &str = "host-ops.sock";

/// The whole list of verbs. Nothing that applies, undoes, rejects or answers is here, and never will be: a test pins it.
pub const VERBS: &[&str] = &[
    "team.plan",
    "room.say",
    "room.run",
    "room.log",
    "room.stop",
    "bot.say",
    "bot.run",
    "session.stop",
    "jobs.get",
    "jobs.put",
    "grant.redeem",
];

/// How a verb is rate limited (section 4.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Class {
    /// Reads: 20 a second.
    Read,
    /// Changes: 2 a second.
    Change,
    /// `team.plan`: one each 5 seconds.
    Plan,
}

/// The verb's class, `None` for a name that is not a verb.
#[must_use]
pub fn class(op: &str) -> Option<Class> {
    match op {
        "room.log" | "jobs.get" => Some(Class::Read),
        "team.plan" => Some(Class::Plan),
        o if VERBS.contains(&o) => Some(Class::Change),
        _ => None,
    }
}

/// Whether `op` changes something, so it takes an idempotency key and a dry run.
#[must_use]
pub fn changes(op: &str) -> bool {
    matches!(class(op), Some(Class::Change | Class::Plan))
}

/// The verbs whose answer is kept in the run table under their key (a repeat returns it): the ones that act outside this
/// crate. `jobs.put` and `grant.redeem` are idempotent by what they write; `team.plan` by its hash.
#[must_use]
pub fn kept(op: &str) -> bool {
    matches!(
        op,
        "room.say" | "room.run" | "room.stop" | "bot.say" | "bot.run" | "session.stop"
    )
}

/// The longest request line the listener reads at all: a 64 KiB fragment escaped as JSON, and the envelope.
pub const MAX_LINE: usize = 160 * 1024;
/// The longest request line for a verb that carries no text (section 4.1: 8 KiB).
pub const SHORT_LINE: usize = 8 * 1024;
/// The longest idempotency key.
pub const MAX_KEY: usize = 200;
/// The longest team-file fragment.
pub const MAX_FRAGMENT: usize = 64 * 1024;

/// The longest line `op` may arrive in. The verbs that carry text take what their text may be, escaped, and the envelope;
/// the rest 8 KiB.
#[must_use]
pub fn line_cap(op: &str) -> usize {
    match op {
        "team.plan" => MAX_LINE,
        "bot.say" => 2 * 32 * 1024 + 4096,
        "room.say" | "room.run" | "bot.run" => 2 * 16 * 1024 + 4096,
        _ => SHORT_LINE,
    }
}

/// A request line, read. `Debug` never shows the token.
pub struct Request {
    /// The version (1).
    pub v: u64,
    /// The channel's token.
    pub token: String,
    /// The verb.
    pub op: String,
    /// The idempotency key.
    pub id: Option<String>,
    /// Answer what would happen, and change nothing.
    pub dry_run: bool,
    /// The verb's parameters (an object).
    pub params: Value,
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("op", &self.op)
            .field("dry_run", &self.dry_run)
            .finish_non_exhaustive()
    }
}

impl Request {
    /// Read a line. `None` for anything that is not an envelope.
    #[must_use]
    pub fn parse(line: &str) -> Option<Self> {
        let v: Value = serde_json::from_str(line).ok()?;
        let o = v.as_object()?;
        let params = match o.get("params") {
            None | Some(Value::Null) => json!({}),
            Some(p @ Value::Object(_)) => p.clone(),
            Some(_) => return None,
        };
        Some(Self {
            v: o.get("v")?.as_u64()?,
            token: o.get("token")?.as_str()?.to_owned(),
            op: o.get("op")?.as_str()?.to_owned(),
            id: match o.get("id") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) => Some(s.clone()),
                Some(_) => return None,
            },
            dry_run: match o.get("dry_run") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return None,
            },
            params,
        })
    }
}

/// An answer line.
#[must_use]
pub fn ok(result: &Value) -> String {
    format!(
        "{}\n",
        json!({"v": 1, "protocol": PROTOCOL, "ok": true, "result": result})
    )
}

/// A refusal line.
#[must_use]
pub fn refused(r: &Refusal) -> String {
    format!(
        "{}\n",
        json!({"v": 1, "protocol": PROTOCOL, "ok": false, "code": r.code, "message": r.message})
    )
}

/// The answer a refused peer, a wrong token and a wrong version all get, so none can be told from another.
#[must_use]
pub fn unauthorized() -> Refusal {
    Refusal::new(
        "hx.host.unauthorized",
        "This channel is not available here.",
    )
}

fn bad(what: &str) -> Refusal {
    Refusal::new("hx.invalid_params", what)
}

fn str_param<'a>(p: &'a Value, key: &str, max: usize, what: &str) -> Result<&'a str, Refusal> {
    let s = p
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| bad(&format!("Give {what}.")))?;
    if s.trim().is_empty() {
        return Err(bad(&format!("Give {what}.")));
    }
    if s.len() > max || s.contains('\0') {
        return Err(bad(&format!("{} is too long.", capital(what))));
    }
    Ok(s)
}

fn opt_str<'a>(
    p: &'a Value,
    key: &str,
    max: usize,
    what: &str,
) -> Result<Option<&'a str>, Refusal> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => str_param(p, key, max, what).map(Some),
    }
}

fn opt_count(p: &Value, key: &str, max: u64, what: &str) -> Result<(), Refusal> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(()),
        Some(v) => match v.as_u64() {
            Some(n) if (1..=max).contains(&n) => Ok(()),
            _ => Err(bad(&format!(
                "{} must be a whole number from 1 to {max}.",
                capital(what)
            ))),
        },
    }
}

fn capital(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or_else(String::new, |f| {
        f.to_uppercase().collect::<String>() + c.as_str()
    })
}

/// Whether `id` is a name the host takes for a job, a room or a bot: letters, digits and `_ . / - @ :`, at most 200.
#[must_use]
pub fn name_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./-@:".contains(c))
}

fn name_param<'a>(p: &'a Value, key: &str, what: &str) -> Result<&'a str, Refusal> {
    let s = p
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| bad(&format!("Give {what}.")))?;
    if name_ok(s) {
        Ok(s)
    } else {
        Err(bad(&format!("That is not {what}.")))
    }
}

fn opt_name(p: &Value, key: &str, what: &str) -> Result<(), Refusal> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(()),
        Some(_) => name_param(p, key, what).map(|_| ()),
    }
}

/// Check a verb's parameters before anything is asked or changed (section 4.3's table and rules).
///
/// # Errors
/// `hx.invalid_params` with what is wrong, `hx.team.prune_owner_only` for a prune.
pub fn check_params(op: &str, p: &Value) -> Result<(), Refusal> {
    opt_name(p, "job_id", "a job's id")?;
    match op {
        "team.plan" => {
            if p.get("prune").is_some_and(|v| v != &Value::Bool(false)) {
                return Err(Refusal::new(
                    "hx.team.prune_owner_only",
                    "Only the owner removes things from the team, in boopis. Plan what to add or change.",
                ));
            }
            str_param(p, "fragment", MAX_FRAGMENT, "a team-file fragment")?;
            let reason = str_param(p, "reason", 200, "a reason")?;
            if reason.contains('\n') {
                return Err(bad("The reason is one line."));
            }
        }
        "room.say" => {
            name_param(p, "room_id", "a room's id")?;
            str_param(p, "text", 16 * 1024, "the text")?;
            if p.get("now").is_some() {
                return Err(bad(
                    "A note waits for the room's turns to end; it is never sent now.",
                ));
            }
        }
        "room.run" => {
            name_param(p, "room_id", "a room's id")?;
            str_param(p, "task", 16 * 1024, "the task")?;
            opt_count(p, "max_rounds", 50, "max_rounds")?;
            opt_str(p, "to_board", 200, "a board")?;
        }
        "room.log" => {
            name_param(p, "room_id", "a room's id")?;
            match p.get("after") {
                None | Some(Value::Null) => {}
                Some(v) if v.as_u64().is_some() => {}
                Some(_) => return Err(bad("after is a line's sequence number.")),
            }
            opt_count(p, "limit", 200, "limit")?;
        }
        "room.stop" => {
            name_param(p, "room_id", "a room's id")?;
        }
        "bot.say" => {
            name_param(p, "bot", "a bot's name")?;
            str_param(p, "text", 32 * 1024, "the text")?;
            match p.get("session").and_then(Value::as_str) {
                Some("latest") => {
                    return Err(bad(
                        "A bot is never given a message in the owner's open conversation. Use \"new\".",
                    ));
                }
                Some(s) if s == "new" || name_ok(s) => {}
                _ => return Err(bad("session is \"new\" or a session this job started.")),
            }
        }
        "bot.run" => {
            name_param(p, "bot", "a bot's name")?;
            str_param(p, "goal", 16 * 1024, "the goal")?;
            opt_count(p, "max_turns", 200, "max_turns")?;
        }
        "session.stop" => {
            name_param(p, "bot", "a bot's name")?;
            name_param(p, "session_id", "a session's id")?;
        }
        "jobs.get" => {}
        "jobs.put" => {
            name_param(p, "job_id", "a job's id")?;
            if !p.get("line").is_some_and(Value::is_object) {
                return Err(bad("Give the line to add, as an object."));
            }
        }
        "grant.redeem" => {
            str_param(p, "grant", 128, "the grant")?;
            str_param(p, "purpose", 100, "the purpose")?;
        }
        _ => {
            return Err(Refusal::new(
                "hx.method_not_found",
                "There is no such operation.",
            ));
        }
    }
    Ok(())
}

/// What the audit line names as the call's target: the room, the bot, or the team.
#[must_use]
pub fn target(op: &str, p: &Value) -> String {
    let get = |k: &str| p.get(k).and_then(Value::as_str).filter(|s| name_ok(s));
    match op {
        "team.plan" => "team".to_owned(),
        "jobs.get" | "jobs.put" => {
            get("job_id").map_or_else(|| "jobs".to_owned(), |j| format!("job {j}"))
        }
        "grant.redeem" => "grant".to_owned(),
        _ => get("room_id")
            .map(|r| format!("room {r}"))
            .or_else(|| get("bot").map(|b| format!("bot {b}")))
            .unwrap_or_default(),
    }
}

/// The fixed label a bot's message goes out under (section 4.3, the w30/governed-bots S2 label). The host writes it, never
/// the bot, and the owner's name is the host's to say.
#[must_use]
pub fn labelled(owner: &str, text: &str) -> String {
    format!("From boopis, for {owner}. This is not an approval.\n\n{text}")
}

/// The room event id for a key: one message for one key, because the engine's `groups.send` is idempotent by event id.
#[must_use]
pub fn event_id(key: &str) -> String {
    format!("ops-{}", crate::key_digest(key))
}

/// The `prompt.submit` submission id for a key.
#[must_use]
pub fn submission_id(key: &str) -> String {
    format!("ops-{}", &crate::sha256_hex(key.as_bytes())[..24])
}
