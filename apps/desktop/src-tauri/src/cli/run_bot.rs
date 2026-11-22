//! `boopis run --bot <bot> "<task>"`: hand a task to one bot and keep it working until it is done, up to the bot's cap on turns.
//!
//! The run itself is `bots::run` (the engine's goal mode, driven the way its own client drives it); this reads the options, finds
//! the bot's cap (`bots::limit`), prints each answer as it arrives and ends with one line that says why it stopped. Exit codes are
//! the group run's: 0 done, 1 failed or timed out, 2 a usage mistake, 3 the cap, 4 the bot needs the owner.

use std::io::Write;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::json;

use super::args::{Args, Kind};
use super::groups::clock;
use crate::bots::limit;
use crate::bots::run::{self, Opts, Outcome, Progress};
use crate::error::{Error, Result};
use crate::rooms::Rpc;
use crate::rooms::run::Stop;

/// What the command asks of the machine: a bot's own link to the gateway, and the cap the bot keeps.
#[async_trait]
pub trait Bots: Send + Sync {
    /// The bot's own gateway link.
    ///
    /// # Errors
    /// `hx.bots.not_found` when there is no such bot.
    async fn link(&self, bot: &str) -> Result<Box<dyn Rpc>>;
    /// The cap the bot keeps for itself, `None` when it keeps none.
    ///
    /// # Errors
    /// `hx.bots.not_found` when there is no such bot; `Config` for a file that cannot be read.
    async fn cap(&self, bot: &str) -> Result<Option<u32>>;
}

/// What the command works with.
pub struct Ctx<'a> {
    /// The bots.
    pub bots: &'a dyn Bots,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub err: &'a mut dyn Write,
    /// Reads standard input (for `-`).
    pub stdin: &'a dyn Fn() -> std::io::Result<String>,
    /// How often a running turn is read.
    pub poll: Duration,
}

const USAGE: &str = "usage: boopis run --bot <bot> \"<task>\" [--max-turns N] [--timeout MINUTES] [--file FILE] [--json]";

fn say(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.out, "{line}");
}

fn fail(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.err, "boopis: {line}");
}

/// The task: the arguments, `--file`, or standard input (`-`).
fn task_of(a: &Args, ctx: &Ctx<'_>) -> Result<String> {
    if let Some(f) = a.value("file") {
        let meta = std::fs::metadata(f).map_err(|e| Error::Io(format!("{f}: {e}")))?;
        if meta.len() > 1_000_000 {
            return Err(Error::InvalidInput(format!("{f}: larger than 1 MB")));
        }
        return std::fs::read_to_string(f).map_err(|e| Error::Io(format!("{f}: {e}")));
    }
    if a.plain.len() == 1 && a.plain[0] == "-" {
        return (ctx.stdin)().map_err(|e| Error::Io(e.to_string()));
    }
    Ok(a.plain.join(" "))
}

/// `boopis run --bot <bot> "<task>"`. Returns the exit code.
pub async fn run_bot(args: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(
        args,
        &[
            ("bot", Kind::Value),
            ("max-turns", Kind::Value),
            ("timeout", Kind::Value),
            ("file", Kind::Value),
            ("json", Kind::Switch),
        ],
    ) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let Some(bot) = a.value("bot") else {
        fail(ctx, USAGE);
        return 2;
    };
    let flag = match a.number("max-turns") {
        Ok(n) => match n.map(limit::check_turns).transpose() {
            Ok(n) => n,
            Err(e) => {
                fail(ctx, &e.to_string());
                return 2;
            }
        },
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let minutes = match a.number("timeout") {
        Ok(n) => n.unwrap_or(60).max(1),
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let task = match task_of(&a, ctx) {
        Ok(t) if !t.trim().is_empty() => t,
        Ok(_) => {
            fail(ctx, &format!("run needs the task. {USAGE}"));
            return 2;
        }
        Err(e) => {
            fail(ctx, &e.to_string());
            return 1;
        }
    };
    match go(bot, &task, flag, minutes, a.has("json"), ctx).await {
        Ok(code) => code,
        Err(e) => {
            let msg = match &e {
                Error::InvalidInput(m) => m.clone(),
                other => crate::error::unless_engine("hx.engine.refused", &other.to_string()),
            };
            fail(ctx, &msg);
            1
        }
    }
}

async fn go(
    bot: &str,
    task: &str,
    flag: Option<u32>,
    minutes: u32,
    json: bool,
    ctx: &mut Ctx<'_>,
) -> Result<i32> {
    let kept = ctx.bots.cap(bot).await?;
    let opts = Opts {
        max_turns: limit::effective(flag, kept),
        poll: ctx.poll,
        timeout: Duration::from_secs(u64::from(minutes) * 60),
    };
    let link = ctx.bots.link(bot).await?;
    let out = &mut *ctx.out;
    let outcome = run::run(link.as_ref(), bot, task, &opts, &mut |p| {
        show(out, json, bot, &p);
    })
    .await?;
    finish(ctx, bot, &outcome, json);
    Ok(outcome.stop.exit_code())
}

fn show(out: &mut dyn Write, json: bool, bot: &str, p: &Progress) {
    let mut put = |line: String| {
        let _ = writeln!(out, "{line}");
    };
    match p {
        Progress::Started(s) => {
            if json {
                put(json!({"type": "started", "bot": bot, "session": s}).to_string());
            }
        }
        Progress::Message { turn, text, at } => {
            if json {
                put(
                    json!({"type": "message", "turn": turn, "at": at, "who": bot, "text": text})
                        .to_string(),
                );
            } else {
                put(format!("[{}] {bot}", clock(*at)));
                for line in text.lines() {
                    put(format!("  {line}"));
                }
            }
        }
        Progress::Continued { used, of } => {
            if json {
                put(json!({"type": "continued", "used": used, "of": of}).to_string());
            } else {
                put(format!(
                    "-- not done yet; going on ({used} of {of} turns used)"
                ));
            }
        }
        Progress::Parked(why) => {
            if json {
                put(json!({"type": "parked", "reason": why}).to_string());
            } else {
                put(format!("-- waiting: {why}"));
            }
        }
    }
}

fn finish(ctx: &mut Ctx<'_>, bot: &str, out: &Outcome, json: bool) {
    let turns = format!(
        "{} turn{}",
        out.turns,
        if out.turns == 1 { "" } else { "s" }
    );
    let why = match &out.stop {
        Stop::Done => format!("done: {bot} finished the task in {turns}"),
        Stop::CapReached | Stop::Paused => format!(
            "stopped at the cap of {} turns. {bot} is paused where it is; raise the cap with --max-turns, or keep it for the bot with `boopis bots set {bot} --max-turns N`",
            out.max_turns
        ),
        Stop::NeedsOwner(w) => format!("a bot needs you: {w}"),
        Stop::Failed(w) => format!("stopped: {w}"),
        Stop::TimedOut => {
            format!("stopped: the time limit passed ({bot} is paused where it is)")
        }
    };
    if json {
        say(
            ctx,
            &json!({"type": "end", "stop": out.stop.word(), "bot": bot, "session": out.session,
                "turns": out.turns, "max_turns": out.max_turns, "messages": out.messages, "reason": why})
            .to_string(),
        );
    } else {
        say(ctx, &format!("-- {why}"));
    }
}

#[cfg(test)]
mod tests;
