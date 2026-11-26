//! `boopis team check|apply|export`: a whole team as one YAML file (`docs/CLI.md`).
//!
//! The command reads the file, asks the backend what is there, plans (`team::plan`, pure), prints the plan, and with `apply`
//! runs it. Exit codes: 0 done (or nothing to do), 1 a problem in the plan or an action that failed, 2 a usage mistake.

use std::io::Write;
use std::path::Path;

use serde_json::json;

use super::args::{Args, Kind};
use crate::team::apply::{self, Backend};
use crate::team::export;
use crate::team::plan::{self, Plan};
use crate::team::spec::Team;

/// What the command works with.
pub struct Ctx<'a> {
    /// What is read and changed.
    pub backend: &'a dyn Backend,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub err: &'a mut dyn Write,
    /// Standard input (for `-`).
    pub stdin: &'a dyn Fn() -> std::io::Result<String>,
    /// Why the caller is a bot's process (`boopis_peer::this_process_is_a_bot`), `None` for the owner's own (B47, H5).
    pub bot_caller: Option<&'static str>,
}

/// What a bot reads when it runs an owner-only command (B47, H5).
pub const BOT_REFUSAL: &str = "A bot cannot change the team. The owner applies plans in boopis.";

fn fail(ctx: &mut Ctx<'_>, line: &str) {
    let _ = writeln!(ctx.err, "boopis: {line}");
}

fn load(ctx: &Ctx<'_>, file: &str) -> Result<Team, String> {
    let (text, base) = if file == "-" {
        (
            (ctx.stdin)().map_err(|e| e.to_string())?,
            std::env::current_dir().unwrap_or_default(),
        )
    } else {
        let p = Path::new(file);
        let text = std::fs::read_to_string(p).map_err(|e| format!("{file}: {e}"))?;
        (
            text,
            p.parent()
                .map(Path::to_path_buf)
                .filter(|b| !b.as_os_str().is_empty())
                .unwrap_or_else(|| ".".into()),
        )
    };
    Team::parse(&text, &base).map_err(|e| format!("{file} is not a usable team:\n{e}"))
}

/// `boopis team ...`. Returns the exit code.
pub async fn team(args: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let Some((sub, rest)) = args.split_first() else {
        for l in super::help::page_of("team") {
            let _ = writeln!(ctx.err, "{l}");
        }
        return 2;
    };
    match sub.as_str() {
        "check" => check(rest, ctx),
        "apply" => {
            // B47, H5: every form of apply is the owner's; a process the engine started is refused before anything is read
            if let Some(rule) = ctx.bot_caller {
                tracing::info!(rule, "boopis team apply refused a bot's process (B47)");
                fail(ctx, BOT_REFUSAL);
                return 2;
            }
            apply_cmd(rest, ctx).await
        }
        "export" => export_cmd(rest, ctx).await,
        other => {
            fail(
                ctx,
                &format!(
                    "team {other} is not a command. {}",
                    super::help::hint("team")
                ),
            );
            2
        }
    }
}

fn check(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(rest, &[("json", Kind::Switch)]) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let [file] = a.plain.as_slice() else {
        fail(ctx, "team check takes one file");
        return 2;
    };
    match load(ctx, file) {
        Ok(t) => {
            let _ = if a.has("json") {
                writeln!(
                    ctx.out,
                    "{}",
                    json!({"ok": true, "bots": t.bots.len(), "rooms": t.rooms.len(), "boards": t.boards.len(), "cron": t.cron.len()})
                )
            } else {
                writeln!(
                    ctx.out,
                    "{file} is a team of {} bots, {} rooms, {} boards and {} jobs",
                    t.bots.len(),
                    t.rooms.len(),
                    t.boards.len(),
                    t.cron.len()
                )
            };
            0
        }
        Err(e) => {
            fail(ctx, &e);
            1
        }
    }
}

fn print_plan(ctx: &mut Ctx<'_>, p: &Plan, json: bool) {
    if json {
        let _ = writeln!(ctx.out, "{}", json!({"type": "plan", "plan": p}));
        return;
    }
    for a in &p.actions {
        let _ = writeln!(ctx.out, "{} {}  {}", a.mark, a.target, a.what);
    }
    for n in &p.notes {
        let _ = writeln!(ctx.out, "note: {n}");
    }
    for n in &p.problems {
        let _ = writeln!(ctx.err, "problem: {n}");
    }
    if p.actions.is_empty() && p.problems.is_empty() {
        let _ = writeln!(ctx.out, "nothing to change: the team is as the file says");
    }
}

async fn apply_cmd(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(
        rest,
        &[
            ("dry-run", Kind::Switch),
            ("prune", Kind::Switch),
            ("json", Kind::Switch),
        ],
    ) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    let [file] = a.plain.as_slice() else {
        fail(
            ctx,
            &format!("team apply takes one file. {}", super::help::hint("team")),
        );
        return 2;
    };
    let team = match load(ctx, file) {
        Ok(t) => t,
        Err(e) => {
            fail(ctx, &e);
            return 1;
        }
    };
    let now = match ctx.backend.read().await {
        Ok(n) => n,
        Err(e) => {
            fail(
                ctx,
                &format!(
                    "could not read what is there: {}",
                    crate::error::unless_engine("hx.engine.refused", &e.to_string())
                ),
            );
            return 1;
        }
    };
    let p = plan::plan(&team, &now, a.has("prune"));
    let json = a.has("json");
    print_plan(ctx, &p, json);
    if !p.problems.is_empty() {
        fail(
            ctx,
            "nothing was changed: fix the problems above and run it again",
        );
        return 1;
    }
    if a.has("dry-run") {
        if !json {
            let _ = writeln!(
                ctx.out,
                "dry run: nothing was changed ({} to do)",
                p.actions.len()
            );
        }
        return 0;
    }
    let wanted: std::collections::BTreeMap<String, Vec<String>> = team
        .bots
        .iter()
        .filter(|(_, b)| !b.skills.is_empty())
        .map(|(n, b)| (n.clone(), b.skills.clone()))
        .collect();
    let report = match apply::apply(ctx.backend, &p, &wanted).await {
        Ok(r) => r,
        Err(e) => {
            fail(ctx, &e.to_string());
            return 1;
        }
    };
    if json {
        let _ = writeln!(ctx.out, "{}", json!({"type": "applied", "report": report}));
    } else {
        for d in &report.done {
            let tail = d.error.as_ref().map_or(String::new(), |e| format!(": {e}"));
            let _ = writeln!(
                ctx.out,
                "{} {} {}  {}{tail}",
                d.result, d.mark, d.target, d.what
            );
        }
        for w in &report.warnings {
            let _ = writeln!(ctx.out, "note: {w}");
        }
        let ok = report.done.iter().filter(|d| d.result == "ok").count();
        let _ = writeln!(ctx.out, "{ok} of {} done", report.done.len());
    }
    i32::from(!report.all_ok())
}

async fn export_cmd(rest: &[String], ctx: &mut Ctx<'_>) -> i32 {
    let a = match Args::read(
        rest,
        &[
            ("output", Kind::Value),
            ("force", Kind::Switch),
            ("json", Kind::Switch),
        ],
    ) {
        Ok(a) => a,
        Err(u) => {
            fail(ctx, &u.0);
            return 2;
        }
    };
    if !a.plain.is_empty() {
        fail(ctx, "team export takes no arguments");
        return 2;
    }
    let now = match ctx.backend.read().await {
        Ok(n) => n,
        Err(e) => {
            fail(
                ctx,
                &format!(
                    "could not read what is there: {}",
                    crate::error::unless_engine("hx.engine.refused", &e.to_string())
                ),
            );
            return 1;
        }
    };
    let done = export::export(&now);
    for w in &done.warnings {
        fail(ctx, &format!("note: {w}"));
    }
    let text = if a.has("json") {
        serde_json::to_string_pretty(&done.team).unwrap_or_default() + "\n"
    } else {
        match done.team.to_yaml() {
            Ok(t) => t,
            Err(e) => {
                fail(ctx, &e.to_string());
                return 1;
            }
        }
    };
    match a.value("output") {
        Some(path) => {
            if Path::new(path).exists() && !a.has("force") {
                fail(ctx, &format!("{path} exists; add --force to replace it"));
                return 1;
            }
            if let Err(e) = std::fs::write(path, text) {
                fail(ctx, &format!("{path}: {e}"));
                return 1;
            }
            let _ = writeln!(ctx.out, "wrote {path}");
        }
        None => {
            let _ = write!(ctx.out, "{text}");
        }
    }
    0
}

#[cfg(test)]
mod tests;
