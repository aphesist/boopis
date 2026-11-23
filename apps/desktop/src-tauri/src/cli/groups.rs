//! `boopis groups ...` and `boopis run --group`: the group chats of the app from a terminal.
//!
//! Each command reads its options, asks the engine through [`Rpc`] (the host's own gateway paths, `headless.rs`), and prints.
//! Output is plain lines; `--json` prints one JSON object per line instead. Exit codes: 0 done, 1 failed or timed out, 2 a
//! usage mistake, 3 stopped at a cap, 4 a bot needs the owner (`run::Stop::exit_code`).
//!
//! A message goes through the room hold (`rooms/hold.rs`), as one written in the app does: while members work it waits for
//! them and goes out when the discussion is over, so it never cuts their turns short. Times are printed in UTC and say so
//! (`[23:46:17 UTC]`); `--json` carries `at` (seconds) and `time` (RFC 3339, `Z`).

use std::io::Write;
use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::args::{Args, Kind};
use crate::config::RoomLimits;
use crate::error::{Error, Result};
use crate::rooms::hold::{self, Delivered};
use crate::rooms::lines::{self, Speaker};
use crate::rooms::run::{self, Opts, Outcome, Progress, Stop, Via};
use crate::rooms::settings::{self, RoomSettings};
use crate::rooms::{self, Event, NewRoom, Room, Rpc, Seat};

/// Where a task that did not finish is handed on to (`--to-board`): the engine's kanban, through its own command line.
#[async_trait]
pub trait Board: Send + Sync {
    /// Make one task on `board`, assigned to `assignee`, that carries `title` and `body`. `key` makes a second try with
    /// the same value return the task that exists. Returns the task's id.
    ///
    /// # Errors
    /// `InvalidInput` when there is no such board; the runner's otherwise.
    async fn hand_off(
        &self,
        board: &str,
        assignee: &str,
        title: &str,
        body: &str,
        key: &str,
    ) -> Result<String>;
}

/// What a command works with.
pub struct Ctx<'a> {
    /// The root gateway.
    pub rpc: &'a dyn Rpc,
    /// boopis's own room settings file.
    pub settings: &'a Path,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub err: &'a mut dyn Write,
    /// The kanban, when the command can reach one.
    pub board: Option<&'a dyn Board>,
    /// Reads standard input (for `-`).
    pub stdin: &'a dyn Fn() -> std::io::Result<String>,
    /// How often `--follow` and `run` read the room.
    pub poll: Duration,
}

fn say(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.out, "{line}");
}

fn fail(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.err, "boopis: {line}");
}

fn json_line(ctx: &mut Ctx<'_>, v: &Value) {
    say(ctx, &v.to_string());
}

fn usage(ctx: &mut Ctx<'_>, what: &str) -> i32 {
    fail(ctx, what);
    2
}

/// The words of an error for a person: the gateway's own, unless they name the engine.
fn words(e: &Error) -> String {
    crate::error::unless_engine("hx.engine.refused", &e.to_string())
}

/// `boopis groups ...`. Returns the exit code.
pub async fn groups(args: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let Some((sub, rest)) = args.split_first() else {
        for l in super::help::page_of("groups") {
            let _ = writeln!(ctx.err, "{l}");
        }
        return 2;
    };
    let outcome = match sub.as_str() {
        "list" | "ls" => list(rest, ctx).await,
        "create" | "new" => create(rest, ctx).await,
        "send" => send(rest, ctx).await,
        "log" => log(rest, ctx).await,
        "set" => set(rest, ctx).await,
        other => Err(Fail::Usage(format!(
            "groups {other} is not a command. {}",
            super::help::hint("groups")
        ))),
    };
    finish(outcome, ctx)
}

/// A command's way out.
enum Fail {
    Usage(String),
    Error(Error),
}

impl From<Error> for Fail {
    fn from(e: Error) -> Self {
        Self::Error(e)
    }
}

impl From<super::args::Usage> for Fail {
    fn from(u: super::args::Usage) -> Self {
        Self::Usage(u.0)
    }
}

fn finish(outcome: std::result::Result<i32, Fail>, ctx: &mut Ctx<'_>) -> i32 {
    match outcome {
        Ok(code) => code,
        Err(Fail::Usage(m)) => usage(ctx, &m),
        Err(Fail::Error(e)) => {
            let msg = match &e {
                Error::InvalidInput(m) => m.clone(),
                other => words(other),
            };
            fail(ctx, &msg);
            1
        }
    }
}

/// A time of day for a person, in UTC and saying so: the host has no time-zone database (no date-time dependency), so the
/// zone is marked rather than guessed. Every command that prints a time uses this one.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // a time of day from a positive timestamp
pub(super) fn clock(at: f64) -> String {
    let s = at.max(0.0) as u64 % 86_400;
    format!("{:02}:{:02}:{:02} UTC", s / 3600, (s / 60) % 60, s % 60)
}

/// A time for `--json`: RFC 3339 in UTC with `Z` (STANDARDS section 7), beside the seconds.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // seconds since 1970, positive
pub(super) fn rfc3339(at: f64) -> String {
    crate::store::time::rfc3339(at.max(0.0) as u64)
}

/// The held messages' file, beside boopis's room settings in the app's data folder.
fn hold_store(ctx: &Ctx<'_>) -> hold::Store {
    hold::Store::under(ctx.settings.parent().unwrap_or(Path::new(".")))
}

async fn list(rest: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(rest, &[("json", Kind::Switch), ("all", Kind::Switch)])?;
    if !a.plain.is_empty() {
        return Err(Fail::Usage("groups list takes no arguments".into()));
    }
    let rooms = rooms::list(ctx.rpc, a.has("all")).await?;
    let kept = RoomSettings::load(ctx.settings).unwrap_or_default();
    if a.has("json") {
        let rows: Vec<Value> = rooms.iter().map(|r| room_json(r, &kept)).collect();
        json_line(ctx, &Value::Array(rows));
    } else if rooms.is_empty() {
        say(
            ctx,
            "no groups yet. `boopis groups create \"name\" bot bot` makes one.",
        );
    } else {
        for r in &rooms {
            let cap = kept
                .max_rounds(&r.id)
                .map_or(String::new(), |n| format!("  max {n} rounds"));
            let gone = if r.disbanded { "  (disbanded)" } else { "" };
            say(
                ctx,
                &format!(
                    "{}  {}  {}{cap}{gone}",
                    r.id,
                    r.name,
                    r.member_ids().join(",")
                ),
            );
        }
    }
    Ok(0)
}

fn room_json(r: &Room, kept: &RoomSettings) -> Value {
    json!({
        "id": r.id, "name": r.name, "members": r.member_ids(), "disbanded": r.disbanded,
        "max_rounds": kept.max_rounds(&r.id),
    })
}

fn read_file(path: &str) -> Result<String> {
    std::fs::read_to_string(path).map_err(|e| Error::InvalidInput(format!("{path}: {e}")))
}

async fn create(rest: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(
        rest,
        &[
            ("lead", Kind::Value),
            ("purpose", Kind::Value),
            ("max-rounds", Kind::Value),
            ("json", Kind::Switch),
        ],
    )?;
    let Some((name, bots)) = a.plain.split_first() else {
        return Err(Fail::Usage("groups create needs a name and the bots: boopis groups create \"paper past\" kai nina --lead kai".into()));
    };
    let max = a
        .number("max-rounds")?
        .map(settings::check_rounds)
        .transpose()?;
    let purpose = a.value("purpose").map(read_file).transpose()?;
    let new = NewRoom {
        id: None,
        name: name.clone(),
        seats: bots
            .iter()
            .map(|b| Seat {
                bot: b.clone(),
                display: b.clone(),
            })
            .collect(),
        lead: a.value("lead").map(str::to_owned),
        purpose,
    };
    let room = rooms::create(ctx.rpc, &new).await?;
    if let Some(n) = max {
        let mut kept = RoomSettings::load(ctx.settings)?;
        kept.set_max_rounds(&room.id, Some(n))?;
        kept.save(ctx.settings)?;
    }
    if a.has("json") {
        let kept = RoomSettings::load(ctx.settings).unwrap_or_default();
        json_line(ctx, &room_json(&room, &kept));
    } else {
        say(
            ctx,
            &format!(
                "made {} ({}) with {}",
                room.name,
                room.id,
                room.member_ids().join(", ")
            ),
        );
    }
    Ok(0)
}

fn print_message(ctx: &mut Ctx<'_>, json: bool, at: f64, who: &str, text: &str, seq: u64) {
    if json {
        json_line(
            ctx,
            &json!({"type": "message", "seq": seq, "at": at, "time": rfc3339(at), "who": who, "text": text}),
        );
    } else {
        say(ctx, &format!("[{}] {who}", clock(at)));
        for line in text.lines() {
            say(ctx, &format!("  {line}"));
        }
    }
}

/// Text from the arguments, `--file`, or standard input (`-`).
fn text_of(a: &Args, from: usize, ctx: &Ctx<'_>) -> Result<String> {
    if let Some(f) = a.value("file") {
        return read_file(f);
    }
    let words = a.plain.get(from..).unwrap_or_default();
    if words.len() == 1 && words[0] == "-" {
        return (ctx.stdin)().map_err(|e| Error::Io(e.to_string()));
    }
    Ok(words.join(" "))
}

/// Say so when a message names a bot that is not in the room (the engine wakes nobody for it, as the app's composer warns):
/// the message still goes to the room, without that bot.
async fn warn_outsiders(ctx: &mut Ctx<'_>, room: &Room, text: &str, json: bool) {
    let handles: Vec<&str> = room.members.iter().map(|m| m.handle.as_str()).collect();
    if rooms::mentions::handles(text).is_empty() {
        return;
    }
    let Ok(known) = rooms::known_bots(ctx.rpc).await else {
        return;
    };
    let out = rooms::mentions::outsiders(text, &handles, &known);
    if out.is_empty() {
        return;
    }
    let names: Vec<&str> = room.members.iter().map(|m| m.name.as_str()).collect();
    let who = rooms::list_words(&out);
    let verb = if out.len() == 1 { "isn't" } else { "aren't" };
    let words = format!(
        "{who} {verb} in {}, so the message reaches only {}. To ask {who}, use their own chat: boopis run --bot {} \"...\"",
        room.name,
        rooms::list_words(&names),
        out[0]
    );
    if json {
        json_line(
            ctx,
            &json!({"type": "warning", "code": "not_in_group", "outside": out, "members": room.member_ids(), "text": words}),
        );
    } else {
        let _ = writeln!(ctx.err, "boopis: warning: {words}");
    }
}

/// What a held message waits for, in words.
fn held_words(room: &Room, working: &[String]) -> String {
    let names: Vec<&str> = working.iter().map(|id| room.name_of(id)).collect();
    let who = if names.is_empty() {
        "the group's conversation is still going".to_owned()
    } else {
        format!(
            "{} {} working",
            rooms::list_words(&names),
            if names.len() == 1 { "is" } else { "are" }
        )
    };
    format!(
        "held: {who}, and a new message would stop that. It goes to {} when the group has finished (stop waiting with Ctrl+C: boopis keeps it and sends it then).",
        room.name
    )
}

async fn send(rest: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(
        rest,
        &[
            ("wait", Kind::Switch),
            ("json", Kind::Switch),
            ("file", Kind::Value),
        ],
    )?;
    let Some(key) = a.plain.first() else {
        return Err(Fail::Usage(
            "groups send needs a group and the text: boopis groups send \"paper past\" \"hello\""
                .into(),
        ));
    };
    let text = text_of(&a, 1, ctx)?;
    if text.trim().is_empty() {
        return Err(Fail::Error(Error::InvalidInput(
            "there is nothing to send".into(),
        )));
    }
    let room = rooms::resolve(ctx.rpc, key).await?;
    let json = a.has("json");
    warn_outsiders(ctx, &room, &text, json).await;
    if !a.has("wait") {
        return Ok(send_held(ctx, &room, &text, json).await?);
    }
    let opts = Opts {
        auto_continue: false,
        poll: ctx.poll,
        ..Opts::default()
    };
    Ok(drive(ctx, &room, &text, &opts, json, None).await?)
}

/// `groups send` without `--wait`: through the hold, back as soon as the message is in the room.
async fn send_held(ctx: &mut Ctx<'_>, room: &Room, text: &str, json: bool) -> Result<i32> {
    let store = hold_store(ctx);
    let limits = RoomLimits::default();
    let mut watch = hold::Watch::new(&room.id);
    let (rpc, poll) = (ctx.rpc, ctx.poll);
    let out = &mut *ctx.out;
    let delivered = hold::deliver(
        rpc,
        &store,
        &mut watch,
        text,
        "cli",
        &limits,
        poll,
        limits.hold_wait,
        &mut |held, working| {
            let line = if json {
                json!({"type": "held", "group": room.id, "id": held.id, "waiting_for": working})
                    .to_string()
            } else {
                format!("-- {}", held_words(room, working))
            };
            let _ = writeln!(out, "{line}");
        },
    )
    .await?;
    match delivered {
        Delivered::Sent(ev) => {
            if json {
                json_line(
                    ctx,
                    &json!({"type": "sent", "group": room.id, "event": ev.id, "seq": ev.seq}),
                );
            } else {
                say(ctx, &format!("sent to {} ({})", room.name, ev.id));
            }
            Ok(0)
        }
        Delivered::TakenBack => {
            fail(ctx, "the message was taken back before it went out");
            Ok(1)
        }
        Delivered::StillHeld(h) => {
            if json {
                json_line(
                    ctx,
                    &json!({"type": "still_held", "group": room.id, "id": h.id}),
                );
            } else {
                say(
                    ctx,
                    &format!(
                        "-- still held: boopis sends it to {} when the group has finished",
                        room.name
                    ),
                );
            }
            Ok(3)
        }
    }
}

/// Send, follow and print; the outcome's exit code. `hand_off` is the kanban board and the lead to give an unfinished task to.
async fn drive(
    ctx: &mut Ctx<'_>,
    room: &Room,
    text: &str,
    opts: &Opts,
    json: bool,
    hand_off: Option<(&str, &str)>,
) -> Result<i32> {
    let rpc = ctx.rpc;
    let store = hold_store(ctx);
    let limits = RoomLimits::default();
    let via = Via {
        store: &store,
        limits: &limits,
        prefix: "cli",
    };
    let out = &mut *ctx.out;
    let outcome = run::run(rpc, room, text, opts, &via, &mut |p| {
        show(out, json, room, &p);
    })
    .await?;
    finish_run(ctx, room, text, &outcome, json, hand_off).await
}

fn show(out: &mut dyn Write, json: bool, room: &Room, p: &Progress) {
    let mut put = |line: String| {
        let _ = writeln!(out, "{line}");
    };
    match p {
        Progress::Held(names) => {
            if json {
                put(json!({"type": "held", "group": room.id, "waiting_for": names}).to_string());
            } else {
                let ids: Vec<String> = room
                    .members
                    .iter()
                    .filter(|m| names.iter().any(|n| n == &m.name))
                    .map(|m| m.id.clone())
                    .collect();
                put(format!("-- {}", held_words(room, &ids)));
            }
        }
        Progress::Sent(id) => {
            if json {
                put(json!({"type": "sent", "event": id}).to_string());
            }
        }
        Progress::Message { seq, who, text, at } => {
            if json {
                put(
                    json!({"type": "message", "seq": seq, "at": at, "time": rfc3339(*at), "who": who, "text": text})
                        .to_string(),
                );
            } else {
                put(format!("[{}] {who}", clock(*at)));
                for line in text.lines() {
                    put(format!("  {line}"));
                }
            }
        }
        Progress::Continued { count, rounds } => {
            if json {
                put(json!({"type": "continued", "count": count, "rounds": rounds}).to_string());
            } else {
                put(format!(
                    "-- the engine paused; going on ({count} so far, up to {rounds} rounds)"
                ));
            }
        }
        Progress::Note(n) => {
            if json {
                put(json!({"type": "note", "text": n}).to_string());
            } else {
                put(format!("-- {n}"));
            }
        }
    }
}

async fn finish_run(
    ctx: &mut Ctx<'_>,
    room: &Room,
    task: &str,
    out: &Outcome,
    json: bool,
    hand_off: Option<(&str, &str)>,
) -> Result<i32> {
    let why = match &out.stop {
        Stop::Done => format!(
            "done: the bots stopped handing off after {} rounds",
            out.rounds
        ),
        Stop::CapReached => format!(
            "stopped at the cap of {} rounds. The group is paused; raise the cap with --max-rounds, or hand the rest to a board with --to-board",
            out.rounds
        ),
        Stop::Paused => {
            "paused at the engine's limit. `boopis run --group` goes on from here".to_owned()
        }
        Stop::NeedsOwner(w) => format!("a bot needs you: {w}"),
        Stop::Failed(w) => format!("stopped: {w}"),
        Stop::TimedOut => "stopped: the time limit passed (the group keeps its place)".to_owned(),
    };
    let mut handed = None;
    if let (Some((board, assignee)), true) = (
        hand_off,
        matches!(out.stop, Stop::CapReached | Stop::Paused),
    ) {
        handed = Some(match ctx.board {
            Some(b) => {
                let title: String = task.chars().take(80).collect();
                let body = format!(
                    "Continue this task. It was started in the group \"{}\" ({}) and the group stopped after {} rounds before it was finished. Read the group's log, finish what is left, and say what you did.\n\nThe task:\n{task}",
                    room.name, room.id, out.rounds
                );
                b.hand_off(board, assignee, &title, &body, &out.discussion)
                    .await
            }
            None => Err(Error::Unavailable(
                "no kanban is reachable from here".into(),
            )),
        });
    }
    if json {
        let mut v = json!({"type": "end", "stop": out.stop.word(), "discussion": out.discussion, "rounds": out.rounds,
            "continues": out.continues, "messages": out.messages, "reason": why});
        match &handed {
            Some(Ok(id)) => v["task"] = json!(id),
            Some(Err(e)) => v["hand_off_error"] = json!(words(e)),
            None => {}
        }
        json_line(ctx, &v);
    } else {
        say(ctx, &format!("-- {why}"));
        match &handed {
            Some(Ok(id)) => say(ctx, &format!("-- handed on to the board as task {id}")),
            Some(Err(e)) => fail(
                ctx,
                &format!("could not hand the rest to the board: {}", words(e)),
            ),
            None => {}
        }
    }
    let code = out.stop.exit_code();
    Ok(if matches!(handed, Some(Err(_))) && code == 3 {
        1
    } else {
        code
    })
}

fn log_line(ctx: &mut Ctx<'_>, room: &Room, e: &Event, json: bool) {
    let Some(l) = lines::line(room, e) else {
        return;
    };
    let who = match &l.from {
        Speaker::User => "you".to_owned(),
        Speaker::Member(id) => room.name_of(id).to_owned(),
        Speaker::Boopis => "--".to_owned(),
    };
    if json {
        let mut v = json!({"type": l.kind, "seq": l.seq, "at": l.at, "time": rfc3339(l.at), "who": who, "text": l.text});
        if let Some(about) = &l.about {
            v["member"] = json!(about);
        }
        json_line(ctx, &v);
    } else if l.from == Speaker::Boopis {
        say(ctx, &format!("[{}] -- {}", clock(l.at), l.text));
    } else {
        print_message(ctx, false, l.at, &who, &l.text, l.seq);
    }
}

async fn log(rest: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(
        rest,
        &[
            ("follow", Kind::Switch),
            ("json", Kind::Switch),
            ("since", Kind::Value),
            ("last", Kind::Value),
            ("for", Kind::Value),
        ],
    )?;
    let [key] = a.plain.as_slice() else {
        return Err(Fail::Usage(
            "groups log takes one group: boopis groups log \"paper past\"".into(),
        ));
    };
    let room = rooms::resolve(ctx.rpc, key).await?;
    let json = a.has("json");
    let mut cursor = u64::from(a.number("since")?.unwrap_or(0));
    let mut events = rooms::log_since(ctx.rpc, &room.id, cursor).await?;
    let newest = events.last().map_or(cursor, |e| e.seq.max(cursor));
    if let Some(n) = a.number("last")? {
        let messages: Vec<usize> = events
            .iter()
            .enumerate()
            .filter(|(_, e)| matches!(e.kind.as_str(), "message.user" | "message.member"))
            .map(|(i, _)| i)
            .collect();
        if let Some(&first) = messages
            .len()
            .checked_sub(n as usize)
            .and_then(|k| messages.get(k))
        {
            events.drain(..first);
        }
    }
    cursor = newest;
    for e in &events {
        log_line(ctx, &room, e, json);
    }
    if !a.has("follow") {
        return Ok(0);
    }
    // `--for SECONDS` ends a follow that nobody interrupts (scripts, tests); without it the follow runs until the terminal ends it.
    let until = a
        .number("for")?
        .map(|s| tokio::time::Instant::now() + Duration::from_secs(u64::from(s)));
    loop {
        if until.is_some_and(|u| tokio::time::Instant::now() >= u) {
            return Ok(0);
        }
        tokio::time::sleep(ctx.poll).await;
        let more = rooms::log_since(ctx.rpc, &room.id, cursor).await?;
        for e in &more {
            log_line(ctx, &room, e, json);
            cursor = cursor.max(e.seq);
        }
    }
}

async fn set(rest: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(rest, &[("max-rounds", Kind::Value), ("json", Kind::Switch)])?;
    let [key] = a.plain.as_slice() else {
        return Err(Fail::Usage(
            "groups set takes one group: boopis groups set \"paper past\" --max-rounds 12".into(),
        ));
    };
    let room = rooms::resolve(ctx.rpc, key).await?;
    let mut kept = RoomSettings::load(ctx.settings)?;
    match a.value("max-rounds") {
        Some("default" | "none") => {
            kept.set_max_rounds(&room.id, None)?;
            kept.save(ctx.settings)?;
        }
        Some(_) => {
            let n = a.number("max-rounds")?.unwrap_or(0);
            kept.set_max_rounds(&room.id, Some(n))?;
            kept.save(ctx.settings)?;
        }
        None => {}
    }
    let now = kept.max_rounds(&room.id);
    if a.has("json") {
        json_line(
            ctx,
            &json!({"id": room.id, "max_rounds": now, "default": settings::DEFAULT_MAX_ROUNDS}),
        );
    } else {
        match now {
            Some(n) => say(ctx, &format!("{}: runs stop at {n} rounds", room.name)),
            None => say(
                ctx,
                &format!(
                    "{}: runs stop at the default, {} rounds",
                    room.name,
                    settings::DEFAULT_MAX_ROUNDS
                ),
            ),
        }
    }
    Ok(0)
}

/// `boopis run --group <group> "<task>"`. Returns the exit code.
pub async fn run_group(args: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let outcome = run_inner(args, ctx).await;
    finish(outcome, ctx)
}

async fn run_inner(args: &[String], ctx: &mut Ctx<'_>) -> std::result::Result<i32, Fail> {
    let a = Args::read(
        args,
        &[
            ("group", Kind::Value),
            ("max-rounds", Kind::Value),
            ("timeout", Kind::Value),
            ("to-board", Kind::Value),
            ("file", Kind::Value),
            ("json", Kind::Switch),
        ],
    )?;
    let Some(key) = a.value("group") else {
        return Err(Fail::Usage(
            "run needs a group or a bot: boopis run --group \"paper past\" \"the task\" or boopis run --bot kai \"the task\"".into(),
        ));
    };
    let task = text_of(&a, 0, ctx)?;
    if task.trim().is_empty() {
        return Err(Fail::Usage(
            "run needs the task: boopis run --group \"paper past\" \"the task\"".into(),
        ));
    }
    let room = rooms::resolve(ctx.rpc, key).await?;
    warn_outsiders(ctx, &room, &task, a.has("json")).await;
    let kept = RoomSettings::load(ctx.settings)?;
    let cap = settings::effective(
        a.number("max-rounds")?
            .map(settings::check_rounds)
            .transpose()?,
        kept.max_rounds(&room.id),
    );
    let minutes = a.number("timeout")?.unwrap_or(60).max(1);
    let opts = Opts {
        max_rounds: cap,
        poll: ctx.poll,
        timeout: Duration::from_secs(u64::from(minutes) * 60),
        ..Opts::default()
    };
    let lead = rooms::state(ctx.rpc, &room.id).await?.context.lead;
    let assignee = if lead.is_empty() {
        room.members
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_default()
    } else {
        lead
    };
    let hand = a.value("to-board").map(|b| (b, assignee.as_str()));
    Ok(drive(ctx, &room, &task, &opts, a.has("json"), hand).await?)
}

#[cfg(test)]
mod tests;
