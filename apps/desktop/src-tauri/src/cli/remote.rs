//! The commands that talk to the engine (`groups`, `run`, `team`): the plumbing between the command line and the host without a
//! window. The commands themselves are in `groups.rs` and `team.rs`, which know nothing of processes, so they are tested with
//! a scripted gateway.

use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;

use super::bots as bots_cmd;
use super::groups::{self, Board};
use super::headless::Host;
use super::run_bot::{self, Bots};
use super::team::{self, Ctx as TeamCtx};
use super::team_live::Live;
use crate::bots::Layout;
use crate::error::{Error, Result};
use crate::rooms::Rpc;

/// Which of the three.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `boopis groups ...`
    Groups,
    /// `boopis run --group ...`
    Run,
    /// `boopis team ...`
    Team,
    /// `boopis bots ...`
    Bots,
}

/// The engine's kanban, through its own command line.
struct Kanban<'a>(&'a Host);

#[async_trait]
impl Board for Kanban<'_> {
    async fn hand_off(
        &self,
        board: &str,
        assignee: &str,
        title: &str,
        body: &str,
        key: &str,
    ) -> Result<String> {
        let listed = self
            .0
            .engine_cli(&["kanban", "boards", "list", "--json"])
            .await?;
        let known = serde_json::from_str::<serde_json::Value>(listed.stdout.trim())
            .ok()
            .and_then(|v| v.as_array().cloned())
            .is_some_and(|rows| {
                rows.iter()
                    .any(|b| b.get("slug").and_then(|s| s.as_str()) == Some(board))
            });
        if !known {
            return Err(Error::InvalidInput(format!(
                "there is no board called {board:?}. `boopis team apply` makes boards, or make it in the app"
            )));
        }
        let mut args = vec![
            "kanban",
            "--board",
            board,
            "create",
            title,
            "--body",
            body,
            "--idempotency-key",
            key,
            "--created-by",
            "boopis",
        ];
        if !assignee.is_empty() {
            args.extend(["--assignee", assignee]);
        }
        let out = self.0.engine_cli(&args).await?;
        if out.code != 0 {
            let why = out
                .stderr
                .lines()
                .rfind(|l| !l.trim().is_empty())
                .unwrap_or("it failed");
            return Err(Error::Unavailable(format!(
                "the board refused the task: {why}"
            )));
        }
        Ok(out
            .stdout
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_owned())
    }
}

/// The bots of this machine: each one's own link to the gateway, and the cap in its own home.
struct LiveBots<'a> {
    host: &'a Host,
    layout: Layout,
}

#[async_trait]
impl Bots for LiveBots<'_> {
    async fn link(&self, bot: &str) -> Result<Box<dyn Rpc>> {
        self.layout.home(bot)?;
        Ok(Box::new(self.host.rpc_for(bot)?))
    }

    async fn cap(&self, bot: &str) -> Result<Option<u32>> {
        crate::bots::limit::read(&self.layout.home(bot)?)
    }
}

/// Whether the arguments of `run` name a bot (`--bot`), not a group.
fn wants_bot(args: &[String]) -> bool {
    args.iter()
        .take_while(|a| *a != "--")
        .any(|a| a == "--bot" || a.starts_with("--bot="))
}

/// Run one of the engine commands. Returns the exit code.
pub fn run(kind: Kind, args: &[String], resource_dir: Option<&Path>) -> i32 {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("{}: could not start: {e}", super::PRODUCT);
            return 1;
        }
    };
    rt.block_on(run_async(kind, args, resource_dir))
}

async fn run_async(kind: Kind, args: &[String], resource_dir: Option<&Path>) -> i32 {
    // A command that only reads a file needs no engine.
    if kind == Kind::Team && args.first().map(String::as_str) == Some("check") {
        return check_only(args);
    }
    let host = match Host::open(resource_dir).await {
        Ok(h) => h,
        Err(e) => {
            eprintln!(
                "{}: {}",
                super::PRODUCT,
                crate::error::unless_engine("hx.engine.unavailable", &e.to_string())
            );
            return 1;
        }
    };
    let stdin = || std::io::read_to_string(std::io::stdin());
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    match kind {
        Kind::Run if wants_bot(args) => {
            let bots = LiveBots {
                host: &host,
                layout: Layout::new(host.root().to_path_buf(), &[]),
            };
            let mut ctx = run_bot::Ctx {
                bots: &bots,
                out: &mut out,
                err: &mut err,
                stdin: &stdin,
                poll: Duration::from_secs(2),
            };
            run_bot::run_bot(args, &mut ctx).await
        }
        Kind::Groups | Kind::Run => {
            let rpc = host.rpc();
            let settings = host.data_dir().join(crate::rooms::settings::FILE);
            let board = Kanban(&host);
            let mut ctx = groups::Ctx {
                rpc: &rpc,
                settings: &settings,
                out: &mut out,
                err: &mut err,
                board: Some(&board),
                stdin: &stdin,
                poll: Duration::from_secs(2),
            };
            if kind == Kind::Groups {
                groups::groups(args, &mut ctx).await
            } else {
                groups::run_group(args, &mut ctx).await
            }
        }
        Kind::Bots => {
            let carried = carried_plugins(resource_dir);
            let live = Live::new(&host, &carried);
            let mut ctx = bots_cmd::Ctx {
                backend: &live,
                out: &mut out,
                err: &mut err,
            };
            bots_cmd::bots(args, &mut ctx).await
        }
        Kind::Team => {
            let carried = carried_plugins(resource_dir);
            let live = Live::new(&host, &carried);
            let mut ctx = TeamCtx {
                backend: &live,
                out: &mut out,
                err: &mut err,
                stdin: &stdin,
                bot_caller: boopis_peer::this_process_is_a_bot().map(boopis_peer::Rule::word),
            };
            team::team(args, &mut ctx).await
        }
    }
}

/// The plugins the runtime carries (what a bot is given besides boopis), as the app's `bots_layout` reads them.
fn carried_plugins(resource_dir: Option<&Path>) -> Vec<String> {
    crate::runtime::Runtime::locate(resource_dir)
        .ok()
        .flatten()
        .map(|r| {
            r.manifest()
                .plugins
                .iter()
                .map(|p| p.name.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// `team check` reads a file and says whether it is a team: no engine, so it works anywhere (a CI check of a shared file).
fn check_only(args: &[String]) -> i32 {
    struct NoEngine;
    #[async_trait]
    impl crate::team::apply::Backend for NoEngine {
        async fn read(&self) -> Result<crate::team::plan::Current> {
            Err(Error::Unavailable("no engine".into()))
        }
        async fn run(&self, _: &crate::team::plan::Op) -> Result<()> {
            Err(Error::Unavailable("no engine".into()))
        }
        async fn missing_skills(&self, _: &str, _: &[String]) -> Result<Vec<String>> {
            Ok(Vec::new())
        }
    }
    let stdin = || std::io::read_to_string(std::io::stdin());
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    let mut ctx = TeamCtx {
        backend: &NoEngine,
        out: &mut out,
        err: &mut err,
        stdin: &stdin,
        bot_caller: boopis_peer::this_process_is_a_bot().map(boopis_peer::Rule::word),
    };
    // `check` never asks the backend, so a plain current-thread poll of the future is enough.
    futures_util::FutureExt::now_or_never(team::team(args, &mut ctx)).unwrap_or(1)
}
