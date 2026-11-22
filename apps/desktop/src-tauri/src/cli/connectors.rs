//! `boopis connectors`: the connectors of the main profile or of one bot, from a terminal, without a question.
//!
//! ```text
//! boopis connectors list [--bot NAME] [--json]
//! boopis connectors add NAME --command PROGRAM [--args ARG...] [--env K=V]... [--bot NAME] [--yes] [--json]
//! boopis connectors test NAME [--bot NAME] [--json]
//! boopis connectors remove NAME [--bot NAME] [--keep-keys] --yes [--json]
//! ```
//!
//! It is the Settings > Connectors flow without the window: the same `connectors::Engine` (the same validators, the same review,
//! the same plan hash, the same rollback), over the gateway's `mcp.servers.*` on the link of the bot's own home. It never
//! drives the engine's own `mcp add`, which cancels without a terminal. Nothing asks: `add` and `remove` print what they would
//! do and stop with exit code 3 until `--yes` says to go on. A key is never a literal here either: a value that reads as a
//! key in `--env` is refused by the same rule as the form's, and keys that must live in the keychain are given in the app.
//!
//! Exit codes: 0 done, 1 failed, 2 not understood, 3 waiting for `--yes`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};

use crate::config::Limits;
use crate::connectors::{Engine, GatewayMcp, Installed, Opener, Request, SourceKind, TestReport};
use crate::error::{self, Error};
use crate::{hermes, runtime, secrets};

/// Done.
pub const EXIT_OK: i32 = 0;
/// It failed; the reason is on the error stream.
pub const EXIT_FAILED: i32 = 1;
/// The arguments are not understood.
pub const EXIT_USAGE: i32 = 2;
/// The command printed what it would do and waits for `--yes`.
pub const EXIT_CONFIRM: i32 = 3;

/// The usage lines, for `--help` and for a mistake.
#[must_use]
pub fn usage(product: &str) -> Vec<String> {
    vec![
        format!(
            "  {product} connectors list [--bot NAME]                 the connectors of the main profile or of one bot"
        ),
        format!(
            "  {product} connectors add NAME --command PROGRAM [--args ARG...] [--env K=V]... [--bot NAME] [--yes]"
        ),
        format!(
            "  {product} connectors test NAME [--bot NAME]            connect and list its tools"
        ),
        format!("  {product} connectors remove NAME [--bot NAME] [--keep-keys] --yes"),
        "    every one takes --json; add and remove print what they would do until --yes"
            .to_owned(),
    ]
}

/// What was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    /// A bot's name; `None` is the main profile.
    pub bot: Option<String>,
    /// Print JSON instead of lines.
    pub json: bool,
    /// What to do.
    pub verb: Verb,
}

/// One verb of the command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verb {
    /// `list`.
    List,
    /// `add`.
    Add {
        /// The name in the bot's `mcp_servers`.
        name: String,
        /// The program.
        command: String,
        /// Its arguments, one each.
        args: Vec<String>,
        /// `NAME=value` pairs.
        env: Vec<String>,
        /// Go on without the review stop.
        yes: bool,
    },
    /// `test`.
    Test {
        /// The server.
        name: String,
    },
    /// `remove`.
    Remove {
        /// The server.
        name: String,
        /// Go on without the stop.
        yes: bool,
        /// Keep the keys the keychain holds for it.
        keep_keys: bool,
    },
}

const LONG: &[&str] = &[
    "--bot",
    "--command",
    "--args",
    "--env",
    "--yes",
    "--json",
    "--keep-keys",
];

fn is_flag(a: &str) -> bool {
    let head = a.split('=').next().unwrap_or(a);
    LONG.contains(&head)
}

/// Read the arguments after `connectors`.
///
/// `--args` takes every value up to the next flag of this command, so `--args -y some-mcp@1.2.3` is two arguments (a value
/// that starts with `-` is still a value); `--args=VALUE` and a repeated `--args` add one each, and a lone `--` makes the rest
/// arguments whatever they look like.
///
/// # Errors
/// The mistake, in a sentence.
#[allow(clippy::too_many_lines)] // one flat match over the arguments: a branch per flag
pub fn parse(args: &[String]) -> Result<Parsed, String> {
    let (verb_word, rest) = args
        .split_first()
        .ok_or("connectors needs a word: list, add, test or remove")?;
    let mut bot: Option<String> = None;
    let mut json = false;
    let mut yes = false;
    let mut keep_keys = false;
    let mut command: Option<String> = None;
    let mut list_args: Vec<String> = Vec::new();
    let mut env: Vec<String> = Vec::new();
    let mut positional: Vec<String> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let a = rest[i].as_str();
        i += 1;
        let (flag, inline) = match a.split_once('=') {
            Some((f, v)) if is_flag(f) => (f, Some(v.to_owned())),
            _ => (a, None),
        };
        let mut one = |what: &str| -> Result<String, String> {
            if let Some(v) = inline.clone() {
                return Ok(v);
            }
            let v = rest.get(i).ok_or(format!("{flag} needs {what}"))?;
            i += 1;
            Ok(v.clone())
        };
        match flag {
            "--bot" => bot = Some(one("a bot's name")?),
            "--command" => command = Some(one("a program")?),
            "--env" => env.push(one("NAME=value")?),
            "--yes" => yes = true,
            "--json" => json = true,
            "--keep-keys" => keep_keys = true,
            "--args" => {
                if let Some(v) = inline {
                    list_args.push(v);
                } else {
                    let before = list_args.len();
                    while let Some(v) = rest.get(i) {
                        if v == "--" {
                            list_args.extend(rest[i + 1..].iter().cloned());
                            i = rest.len();
                            break;
                        }
                        if is_flag(v) {
                            break;
                        }
                        list_args.push(v.clone());
                        i += 1;
                    }
                    if list_args.len() == before {
                        return Err("--args needs at least one argument".into());
                    }
                }
            }
            "--" => positional.extend(rest[i..].iter().cloned()),
            f if f.starts_with('-') => {
                return Err(format!("{f} is not an option of connectors {verb_word}"));
            }
            _ => positional.push(a.to_owned()),
        }
    }
    let bot = bot.filter(|b| !b.is_empty() && b != "default");
    let name = |what: &str| -> Result<String, String> {
        match positional.as_slice() {
            [n] => Ok(n.clone()),
            [] => Err(format!("{what} needs the connector's name")),
            [_, extra, ..] => Err(format!("{extra} is one argument too many")),
        }
    };
    let none = |loose: bool, flag: &str, verb: &str| -> Result<(), String> {
        if loose {
            Err(format!("{flag} is not an option of connectors {verb}"))
        } else {
            Ok(())
        }
    };
    let verb = match verb_word.as_str() {
        "list" | "ls" => {
            if let Some(extra) = positional.first() {
                return Err(format!("{extra} is one argument too many"));
            }
            none(command.is_some(), "--command", "list")?;
            none(!list_args.is_empty(), "--args", "list")?;
            none(!env.is_empty(), "--env", "list")?;
            none(yes, "--yes", "list")?;
            Verb::List
        }
        "add" => {
            let command =
                command.ok_or("add needs --command PROGRAM (the program the connector runs)")?;
            none(keep_keys, "--keep-keys", "add")?;
            Verb::Add {
                name: name("add")?,
                command,
                args: list_args,
                env,
                yes,
            }
        }
        "test" => {
            none(command.is_some(), "--command", "test")?;
            none(yes, "--yes", "test")?;
            Verb::Test {
                name: name("test")?,
            }
        }
        "remove" | "rm" => {
            none(command.is_some(), "--command", "remove")?;
            Verb::Remove {
                name: name("remove")?,
                yes,
                keep_keys,
            }
        }
        other => {
            return Err(format!(
                "{other} is not a connectors word; try list, add, test or remove"
            ));
        }
    };
    Ok(Parsed { bot, json, verb })
}

/// What a run printed and how it ended.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// The exit code.
    pub code: i32,
    /// Standard output lines.
    pub out: Vec<String>,
    /// Standard error lines.
    pub err: Vec<String>,
}

impl Outcome {
    fn done(out: Vec<String>) -> Self {
        Self {
            code: EXIT_OK,
            out,
            err: Vec::new(),
        }
    }
    fn failed(e: &Error) -> Self {
        Self {
            code: EXIT_FAILED,
            out: Vec::new(),
            err: vec![format!(
                "boopis: {}",
                error::user_message(e.code(), &e.to_string())
            )],
        }
    }
}

fn pretty(v: &Value) -> Vec<String> {
    vec![serde_json::to_string_pretty(v).unwrap_or_else(|_| "null".into())]
}

/// A server as a row of JSON: its configuration without a value of any key, and its state.
fn server_json(i: &Installed) -> Value {
    json!({
        "name": i.name, "transport": i.transport, "url": i.url, "command": i.command, "args": i.args,
        "env": i.env, "enabled": i.enabled, "status": i.status, "tools": i.tools, "plugin": i.plugin,
        "needs_sign_in": i.needs_auth,
    })
}

fn state_word(i: &Installed) -> &'static str {
    if i.plugin.is_some() {
        "from a plugin"
    } else if !i.enabled {
        "off"
    } else if i.needs_auth {
        "needs sign-in"
    } else {
        match i.status.as_str() {
            "connected" => "connected",
            "failed" => "failed to connect",
            "connecting" => "connecting",
            "lazy" => "connects when used",
            _ => "not connected yet",
        }
    }
}

fn where_of(i: &Installed) -> String {
    i.url.clone().unwrap_or_else(|| {
        [i.command.clone().unwrap_or_default()]
            .into_iter()
            .chain(i.args.clone())
            .collect::<Vec<_>>()
            .join(" ")
    })
}

fn test_json(t: &TestReport) -> Value {
    json!({
        "ok": t.ok, "tools": t.tools.iter().map(|x| x.name.clone()).collect::<Vec<_>>(),
        "error": t.error, "needs_sign_in": t.signin_needed,
    })
}

fn tools_line(t: &TestReport) -> String {
    if t.ok {
        let names: Vec<&str> = t.tools.iter().take(8).map(|x| x.name.as_str()).collect();
        let more = if t.tools.len() > 8 { ", ..." } else { "" };
        format!(
            "connected, {} tool{}{}{more}",
            t.tools.len(),
            if t.tools.len() == 1 { "" } else { "s" },
            if names.is_empty() {
                String::new()
            } else {
                format!(": {}", names.join(", "))
            }
        )
    } else {
        format!(
            "did not connect: {}",
            t.error.as_deref().unwrap_or("no reason given")
        )
    }
}

/// Do what `parsed` asks against `engine`.
#[allow(clippy::too_many_lines)] // one match over the verbs: list, add, test, remove, each with its plain and JSON output
pub async fn execute(engine: &Engine, parsed: &Parsed) -> Outcome {
    let who = parsed
        .bot
        .as_deref()
        .map_or_else(|| "the main profile".to_owned(), |b| format!("the bot {b}"));
    match &parsed.verb {
        Verb::List => match engine.list().await {
            Err(e) => Outcome::failed(&e),
            Ok(list) if parsed.json => Outcome::done(pretty(
                &json!({ "bot": parsed.bot, "connectors": list.iter().map(server_json).collect::<Vec<_>>() }),
            )),
            Ok(list) if list.is_empty() => Outcome::done(vec![format!("No connectors for {who}.")]),
            Ok(list) => {
                let width = list
                    .iter()
                    .map(|i| i.name.chars().count())
                    .max()
                    .unwrap_or(0);
                let mut out = vec![format!("Connectors of {who}:")];
                out.extend(
                    list.iter().map(|i| {
                        format!("  {:<width$}  {}  {}", i.name, state_word(i), where_of(i))
                    }),
                );
                Outcome::done(out)
            }
        },
        Verb::Add {
            name,
            command,
            args,
            env,
            yes,
        } => {
            let values: BTreeMap<String, String> = [
                ("name", name.clone()),
                ("command", command.clone()),
                ("args", args.join("\n")),
                ("env", env.join("\n")),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect();
            let request = Request {
                source: SourceKind::Command,
                values,
            };
            let review = match engine.review(&request).await {
                Ok(r) => r,
                Err(e) => return Outcome::failed(&e),
            };
            if !yes {
                let rows = review.form.contents.clone();
                if parsed.json {
                    let mut o = Outcome::done(pretty(&json!({
                        "bot": parsed.bot, "name": review.name, "added": false, "needs_yes": true,
                        "plan": rows.iter().map(|(k, v)| json!({"label": k, "text": v})).collect::<Vec<_>>(),
                        "config": review.form.diff.iter().map(|d| json!({"key": d.key, "to": d.to})).collect::<Vec<_>>(),
                    })));
                    o.code = EXIT_CONFIRM;
                    return o;
                }
                let mut out = vec![format!(
                    "This would add the connector {} to {who}:",
                    review.name
                )];
                out.extend(rows.iter().map(|(k, v)| format!("  {k}: {v}")));
                out.extend(
                    review
                        .form
                        .diff
                        .iter()
                        .map(|d| format!("  config {} = {}", d.key, d.to)),
                );
                out.push(
                    "Nothing was changed. Run the same command with --yes to add it.".to_owned(),
                );
                return Outcome {
                    code: EXIT_CONFIRM,
                    out,
                    err: Vec::new(),
                };
            }
            match engine
                .install(&request, &review.plan_hash, &BTreeMap::new(), None)
                .await
            {
                Err(e) => Outcome::failed(&e),
                Ok(r) if parsed.json => Outcome::done(pretty(&json!({
                    "bot": parsed.bot, "name": r.name, "added": true,
                    "test": r.test.as_ref().map(test_json), "notes": r.notes,
                }))),
                Ok(r) => {
                    let mut out = vec![format!("Added {} to {who}.", r.name)];
                    if let Some(t) = &r.test {
                        out.push(format!("  {}: {}", r.name, tools_line(t)));
                    }
                    out.extend(r.notes.iter().map(|n| format!("  {n}")));
                    out.push(
                        "Sessions already open keep the tools they started with; new ones use it."
                            .to_owned(),
                    );
                    Outcome::done(out)
                }
            }
        }
        Verb::Test { name } => match engine.test(name).await {
            Err(e) => Outcome::failed(&e),
            Ok(t) => {
                let code = if t.ok { EXIT_OK } else { EXIT_FAILED };
                let out = if parsed.json {
                    pretty(&json!({ "bot": parsed.bot, "name": name, "test": test_json(&t) }))
                } else {
                    vec![format!("{name}: {}", tools_line(&t))]
                };
                Outcome {
                    code,
                    out,
                    err: Vec::new(),
                }
            }
        },
        Verb::Remove {
            name,
            yes,
            keep_keys,
        } => {
            if !yes {
                let mut o = Outcome::done(if parsed.json {
                    pretty(
                        &json!({ "bot": parsed.bot, "name": name, "removed": false, "needs_yes": true }),
                    )
                } else {
                    vec![
                        format!("This would remove the connector {name} from {who}."),
                        "Nothing was changed. Run the same command with --yes to remove it."
                            .to_owned(),
                    ]
                });
                o.code = EXIT_CONFIRM;
                return o;
            }
            match engine.remove(name, !keep_keys).await {
                Err(e) => Outcome::failed(&e),
                Ok(r) if parsed.json => Outcome::done(pretty(
                    &json!({ "bot": parsed.bot, "name": r.name, "removed": true, "notes": r.notes }),
                )),
                Ok(r) => {
                    let mut out = vec![format!("Removed {} from {who}.", r.name)];
                    out.extend(r.notes.iter().map(|n| format!("  {n}")));
                    Outcome::done(out)
                }
            }
        }
    }
}

/// The browser is no part of anything here: a connector that needs a sign-in is finished in the app.
struct NoBrowser;

impl Opener for NoBrowser {
    fn open(&self, _url: &str) -> crate::error::Result<()> {
        Err(Error::Os(
            "a sign-in is finished in the boopis app, not from a terminal".into(),
        ))
    }
}

/// The engine for a bot's home (or the main profile's), built the way the app builds it.
fn engine_for(bot: Option<&str>, resource_dir: Option<&Path>) -> crate::error::Result<Engine> {
    let limits = Limits::default();
    let data = dirs::data_dir()
        .map(|d| d.join(crate::gpu::APP_IDENTIFIER))
        .ok_or_else(|| Error::Os("this computer has no data folder".into()))?;
    let (plan, problem) =
        runtime::plan_for(runtime::Source::from_process(), resource_dir, Ok(data));
    if let Some(p) = problem {
        return Err(Error::Unavailable(p));
    }
    let mut environment = hermes::Environment::from_process();
    if let Some(plan) = &plan {
        environment = environment.with_bundled(plan.bundled());
    }
    let home: PathBuf = environment.profile_home(bot)?;
    if bot.is_some() && !home.is_dir() {
        return Err(Error::InvalidInput(format!(
            "there is no bot named {} here (boopis bots list shows the bots)",
            bot.unwrap_or_default()
        )));
    }
    let supervisor = Arc::new(hermes::Supervisor::new(environment, limits.clone()));
    let ops = GatewayMcp::new(supervisor, home);
    Ok(Engine::new(
        Arc::new(ops),
        Arc::new(secrets::Keychain),
        Arc::new(NoBrowser),
        limits,
    ))
}

/// Run `boopis connectors ...`: print, and return the exit code.
#[must_use]
pub fn run(args: &[String], resource_dir: Option<&Path>) -> i32 {
    let parsed = match parse(args) {
        Ok(p) => p,
        Err(why) => {
            eprintln!("boopis: connectors: {why}.");
            for l in usage(super::PRODUCT) {
                eprintln!("{l}");
            }
            return EXIT_USAGE;
        }
    };
    let outcome = match engine_for(parsed.bot.as_deref(), resource_dir) {
        Err(e) => Outcome::failed(&e),
        Ok(engine) => match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => rt.block_on(execute(&engine, &parsed)),
            Err(e) => Outcome::failed(&Error::Os(e.to_string())),
        },
    };
    for l in &outcome.out {
        println!("{l}");
    }
    for l in &outcome.err {
        eprintln!("{l}");
    }
    outcome.code
}

#[cfg(test)]
mod tests;
