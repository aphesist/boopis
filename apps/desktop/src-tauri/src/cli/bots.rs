//! `boopis bots list|create|set`: one bot from a terminal, with the same operations `team apply` runs (`team::plan::Op`), so a
//! bot made here is made exactly as the Bots form and a team file make it. It needs the app's gateway (or one of its own, with
//! the secret channel served from this process): the host's `headless::Host` sees to that.
//!
//! Exit codes: 0 done, 1 failed, 2 a usage mistake.

use std::io::Write;
use std::path::Path;

use serde_json::json;

use super::args::{Args, Kind};
use crate::bots::limit::{self, Cap};
use crate::team::apply::Backend;
use crate::team::plan::{Current, Op};
use crate::team::spec::{Bot, Look, SHAPES, is_color};

/// What the command works with.
pub struct Ctx<'a> {
    /// What is read and changed.
    pub backend: &'a dyn Backend,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub err: &'a mut dyn Write,
}

const USAGE: &str = "usage: boopis bots list [--json] | create <name> [--role <text>] [--soul-file <file>] [--model <model>] [--shape <shape> --color <#rrggbb>] [--governed] [--max-turns <n>] | set <name> [--role <text>] [--soul-file <file>] [--model <model>] [--shape <shape>] [--color <#rrggbb>] [--governed|--ungoverned] [--max-turns <n>|default]";

fn fail(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.err, "boopis: {line}");
}

/// `boopis bots ...`. Returns the exit code.
pub async fn bots(args: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let Some((sub, rest)) = args.split_first() else {
        fail(ctx, USAGE);
        return 2;
    };
    match sub.as_str() {
        "list" => list(rest, ctx).await,
        "create" => create(rest, ctx).await,
        "set" => set(rest, ctx).await,
        other => {
            fail(ctx, &format!("bots {other} is not a command. {USAGE}"));
            2
        }
    }
}

async fn read(ctx: &mut Ctx<'_>) -> Result<Current, i32> {
    match ctx.backend.read().await {
        Ok(n) => Ok(n),
        Err(e) => {
            fail(
                ctx,
                &format!(
                    "could not read what is there: {}",
                    crate::error::unless_engine("hx.engine.refused", &e.to_string())
                ),
            );
            Err(1)
        }
    }
}

async fn list(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(rest, &[("json", Kind::Switch)]) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    if !a.plain.is_empty() {
        fail(ctx, "bots list takes no arguments");
        return 2;
    }
    let now = match read(ctx).await {
        Ok(n) => n,
        Err(c) => return c,
    };
    if a.has("json") {
        let rows: Vec<_> = now
            .bots
            .iter()
            .map(|(name, b)| {
                json!({"name": name, "role": b.role, "provider": b.provider, "model": b.model, "look": b.look,
                       "governed": b.governed, "max_turns": b.max_turns, "default_max_turns": limit::DEFAULT_MAX_TURNS})
            })
            .collect();
        let _ = writeln!(ctx.out, "{}", json!({"bots": rows}));
        return 0;
    }
    if now.bots.is_empty() {
        let _ = writeln!(
            ctx.out,
            "no bots yet: `boopis bots create <name>` makes one"
        );
    }
    for (name, b) in &now.bots {
        let model = if b.model.is_empty() {
            "default model".to_owned()
        } else {
            format!("{}/{}", b.provider, b.model)
        };
        let mode = if b.governed { "governed" } else { "ungoverned" };
        let role = b.role.lines().next().unwrap_or("");
        let _ = writeln!(ctx.out, "{name}  {model}  {mode}  {role}");
    }
    0
}

const EDIT: &[(&str, Kind)] = &[
    ("role", Kind::Value),
    ("soul-file", Kind::Value),
    ("model", Kind::Value),
    ("shape", Kind::Value),
    ("color", Kind::Value),
    ("governed", Kind::Switch),
    ("ungoverned", Kind::Switch),
    ("max-turns", Kind::Value),
    ("json", Kind::Switch),
];

/// What the options say about a bot's look: both parts or neither, each checked.
fn look_of(a: &Args, have: Option<&Look>) -> Result<Option<Look>, String> {
    let (shape, color) = (a.value("shape"), a.value("color"));
    if shape.is_none() && color.is_none() {
        return Ok(None);
    }
    let shape = shape
        .map(str::to_owned)
        .or_else(|| have.map(|l| l.shape.clone()));
    let color = color
        .map(str::to_owned)
        .or_else(|| have.map(|l| l.color.clone()));
    let (Some(shape), Some(color)) = (shape, color) else {
        return Err("a look needs both --shape and --color".into());
    };
    if !SHAPES.contains(&shape.as_str()) {
        return Err(format!(
            "--shape {shape:?} is not a shape (one of {})",
            SHAPES.join(", ")
        ));
    }
    if !is_color(&color) {
        return Err(format!("--color {color:?} is not a colour like #3a7bd5"));
    }
    Ok(Some(Look { shape, color }))
}

fn soul_of(a: &Args) -> Result<Option<String>, String> {
    let Some(file) = a.value("soul-file") else {
        return Ok(None);
    };
    let text = if file == "-" {
        std::io::read_to_string(std::io::stdin()).map_err(|e| e.to_string())?
    } else {
        let meta = std::fs::metadata(Path::new(file)).map_err(|e| format!("{file}: {e}"))?;
        if meta.len() > 1_000_000 {
            return Err(format!("{file}: larger than 1 MB"));
        }
        std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?
    };
    Ok(Some(text))
}

fn governed_of(a: &Args) -> Result<Option<bool>, String> {
    match (a.has("governed"), a.has("ungoverned")) {
        (true, true) => Err("--governed and --ungoverned say opposite things".into()),
        (true, false) => Ok(Some(true)),
        (false, true) => Ok(Some(false)),
        (false, false) => Ok(None),
    }
}

/// `--max-turns N`, or `default` to forget the bot's own cap.
fn cap_of(a: &Args) -> Result<Option<Cap>, String> {
    let Some(v) = a.value("max-turns") else {
        return Ok(None);
    };
    if matches!(v, "default" | "none") {
        return Ok(Some(Cap::Default));
    }
    let n = v
        .parse::<u32>()
        .map_err(|_| format!("--max-turns takes a whole number or \"default\", not {v:?}"))?;
    limit::check_turns(n)
        .map(|n| Some(Cap::Turns(n)))
        .map_err(|e| e.to_string())
}

async fn run_op(ctx: &mut Ctx<'_>, op: &Op, json: bool, name: &str, what: &str) -> i32 {
    match ctx.backend.run(op).await {
        Ok(()) => {
            let _ = if json {
                writeln!(
                    ctx.out,
                    "{}",
                    json!({"type": "done", "bot": name, "what": what})
                )
            } else {
                writeln!(ctx.out, "{what} {name}")
            };
            0
        }
        Err(e) => {
            fail(ctx, &e.to_string());
            1
        }
    }
}

async fn create(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(rest, EDIT) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let [name] = a.plain.as_slice() else {
        fail(ctx, &format!("bots create takes one name. {USAGE}"));
        return 2;
    };
    if a.has("ungoverned") {
        fail(ctx, "a new bot is ungoverned unless you say --governed");
        return 2;
    }
    if let Err(e) = crate::bots::check_name(name) {
        fail(ctx, &e.to_string());
        return 2;
    }
    let made = (|| {
        Ok::<_, String>((
            look_of(&a, None)?,
            soul_of(&a)?,
            governed_of(&a)?,
            cap_of(&a)?,
        ))
    })();
    let (look, soul_text, governed, cap) = match made {
        Ok(x) => x,
        Err(e) => {
            fail(ctx, &e);
            return 2;
        }
    };
    let now = match read(ctx).await {
        Ok(n) => n,
        Err(c) => return c,
    };
    if now.bots.contains_key(name) {
        fail(
            ctx,
            &format!("{name} already exists: `boopis bots set {name}` changes it"),
        );
        return 1;
    }
    let bot = Bot {
        role: a.value("role").map(str::to_owned),
        soul_text,
        model: a.value("model").map(str::to_owned),
        look,
        governed,
        max_turns: cap.and_then(Cap::kept),
        ..Bot::default()
    };
    run_op(
        ctx,
        &Op::CreateBot {
            name: name.clone(),
            bot,
        },
        a.has("json"),
        name,
        "made",
    )
    .await
}

#[allow(clippy::too_many_lines)] // one pass: read, check, compare each field, send
async fn set(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(rest, EDIT) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let [name] = a.plain.as_slice() else {
        fail(ctx, &format!("bots set takes one name. {USAGE}"));
        return 2;
    };
    let given = [
        "role",
        "soul-file",
        "model",
        "shape",
        "color",
        "governed",
        "ungoverned",
        "max-turns",
    ]
    .iter()
    .any(|o| a.has(o));
    if !given {
        fail(
            ctx,
            &format!("bots set {name} needs something to change. {USAGE}"),
        );
        return 2;
    }
    let now = match read(ctx).await {
        Ok(n) => n,
        Err(c) => return c,
    };
    let Some(have) = now.bots.get(name) else {
        fail(
            ctx,
            &format!("there is no bot called {name:?}: `boopis bots create {name}` makes one"),
        );
        return 1;
    };
    let made = (|| {
        Ok::<_, String>((
            look_of(&a, have.look.as_ref())?,
            soul_of(&a)?,
            governed_of(&a)?,
            cap_of(&a)?,
        ))
    })();
    let (look, soul, governed, cap) = match made {
        Ok(x) => x,
        Err(e) => {
            fail(ctx, &e);
            return 2;
        }
    };
    // Only what differs is sent, as `team apply` does: setting a bot to what it is does nothing.
    let role = a
        .value("role")
        .map(|r| r.trim().to_owned())
        .filter(|r| *r != have.role.trim());
    let soul = soul
        .map(|s| s.trim().to_owned())
        .filter(|s| *s != have.soul.trim());
    let model = a
        .value("model")
        .filter(|m| {
            let m = m.trim();
            m != have.model && m != format!("{}/{}", have.provider, have.model)
        })
        .map(str::to_owned);
    let look = look.filter(|l| have.look.as_ref() != Some(l));
    let governed = governed.filter(|g| *g != have.governed);
    let max_turns = cap.filter(|c| c.kept() != have.max_turns);
    if role.is_none()
        && soul.is_none()
        && model.is_none()
        && look.is_none()
        && governed.is_none()
        && max_turns.is_none()
    {
        let _ = writeln!(ctx.out, "nothing to change: {name} is as asked");
        return 0;
    }
    run_op(
        ctx,
        &Op::UpdateBot {
            name: name.clone(),
            role,
            soul,
            model,
            look,
            governed,
            max_turns,
        },
        a.has("json"),
        name,
        "changed",
    )
    .await
}

#[cfg(test)]
mod tests;
