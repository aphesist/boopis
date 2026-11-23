//! `boopis groups` and `boopis run --group` against a real, unmodified gateway and the fake model (`tests/e2e/serve_stack.py`):
//! two bots are made and prepared the way the app prepares them, a group is made, a task is sent, and a run goes on past the
//! engine's own pause up to boopis's cap. Skips cleanly unless `HX_E2E_HERMES_ENV` names the spike install and `python3` runs.
//! Never runs an installer; every process it starts is stopped when the test ends.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines
)] // a test: failing loudly is the point

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use boopis_host::config::Limits;
use boopis_host::endpoint::Local;
use boopis_host::error::{Error, Result};
use boopis_host::gateway::oneshot::Link;
use boopis_host::hermes::{Environment, Supervisor};
use boopis_host::rooms::run::{Opts, Progress, Stop};
use boopis_host::rooms::{self, NewRoom, Rpc, Seat};
use serde_json::{Value, json};

struct Stack {
    child: Child,
    info: Value,
}

impl Drop for Stack {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

fn start_stack() -> Option<Stack> {
    std::env::var_os("HX_E2E_HERMES_ENV")?;
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/e2e/serve_stack.py");
    let mut child = Command::new("python3")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut line = String::new();
    BufReader::new(child.stdout.take()?)
        .read_line(&mut line)
        .ok()?;
    let info = serde_json::from_str(line.trim()).ok()?;
    Some(Stack { child, info })
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

/// The gw gateway, one short link per call (the command line keeps one link; the test does not need to).
struct Root {
    sup: Arc<Supervisor>,
    home: PathBuf,
}

#[async_trait]
impl Rpc for Root {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let limits = Limits::default();
        let endpoint = Local::new(self.sup.clone(), self.home.clone(), limits.clone());
        let mut link = Link::open(
            &endpoint,
            false,
            limits.max_inbound_frame,
            Duration::from_mins(2),
        )
        .await?;
        match link.call_rpc(method, &params).await? {
            Ok(v) => Ok(v),
            Err(f) => Err(Error::Unavailable(f.message)),
        }
    }
}

async fn hermes(sup: &Supervisor, home: &std::path::Path, args: &[&str]) -> String {
    let info = sup.info().await.expect("hermes is found");
    let out = sup
        .cli()
        .run(&info.binary, home, args, Duration::from_mins(3))
        .await
        .expect("the engine's command runs");
    assert_eq!(out.code, 0, "hermes {args:?}: {}{}", out.stdout, out.stderr);
    out.stdout
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_runs_through_a_group_past_the_engines_pause_to_boopis_cap() {
    let Some(stack) = start_stack() else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run against a real gateway"
        );
        return;
    };
    let i = &stack.info;
    let home = PathBuf::from(s(&i["home"]));
    let env = Environment {
        hermes_home: Some(s(&i["home"])),
        home_dir: Some(PathBuf::from(s(&i["env"]["HOME"]))),
        path: Some(std::ffi::OsString::from(s(&i["venv_bin"]))),
        ..Environment::default()
    };
    let extra = i["env"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), s(v))).collect())
        .unwrap_or_default();
    let sup = Arc::new(Supervisor::new(env, Limits::default()).with_child_env(extra));
    let gw = Root {
        sup: sup.clone(),
        home: home.clone(),
    };

    // Two bots, made and prepared the way the app makes them (what `tests/e2e/test_bot_home_e2e.py` does step by step).
    let providers_main = hermes(&sup, &home, &["config", "get", "--json", "providers.main"]).await;
    for name in ["moss", "nina"] {
        gw.call(
            "profiles.create",
            json!({"name": name, "soul": "You pass work on.", "model": "claude-opus-5-5", "provider": "main", "no_alias": true}),
        )
        .await
        .expect("a bot is made");
        let bot_home = home.join("profiles").join(name);
        std::fs::create_dir_all(bot_home.join("plugins")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            home.join("plugins").join("boopis"),
            bot_home.join("plugins").join("boopis"),
        )
        .unwrap();
        hermes(
            &sup,
            &bot_home,
            &["config", "set", "providers.main", providers_main.trim()],
        )
        .await;
        hermes(
            &sup,
            &bot_home,
            &[
                "config",
                "set",
                "plugins.entries.boopis.settings.mode",
                "ungoverned",
            ],
        )
        .await;
        hermes(&sup, &bot_home, &["plugins", "enable", "boopis"]).await;
        hermes(
            &sup,
            &home,
            &[
                "config",
                "set",
                &format!("hosted_rooms.profiles.{name}"),
                &bot_home.canonicalize().unwrap().display().to_string(),
            ],
        )
        .await;
    }
    sup.restart(&home, true)
        .await
        .expect("the gateway restarts");

    // The command line's own steps.
    let room = rooms::create(
        &gw,
        &NewRoom {
            name: "e2e".into(),
            seats: ["moss", "nina"]
                .map(|b| Seat {
                    bot: b.into(),
                    display: b.into(),
                })
                .to_vec(),
            ..NewRoom::default()
        },
    )
    .await
    .expect("a group is made");
    assert_eq!(room.member_ids(), ["moss", "nina"]);
    assert!(
        rooms::list(&gw, false)
            .await
            .unwrap()
            .iter()
            .any(|r| r.id == room.id)
    );
    assert_eq!(rooms::resolve(&gw, "e2e").await.unwrap().id, room.id);

    // Every reply cites both bots, so they keep handing off until the engine's limit pauses the discussion.
    let task = "@moss @nina start @@reply @moss @nina over to you@@";
    let opts = Opts {
        max_rounds: 6,
        poll: Duration::from_secs(1),
        timeout: Duration::from_mins(8),
        quiet_polls: 30,
        ..Opts::default()
    };
    let mut seen = Vec::new();
    let held_dir = tempfile::tempdir().expect("a folder for the hold");
    let store = rooms::hold::Store::under(held_dir.path());
    let limits = boopis_host::config::RoomLimits::default();
    let via = rooms::run::Via {
        store: &store,
        limits: &limits,
        prefix: "cli",
    };
    let out = rooms::run::run(&gw, &room, task, &opts, &via, &mut |p| seen.push(p))
        .await
        .expect("the run reads the room");
    eprintln!(
        "stop {:?}, rounds {}, continues {}, messages {}",
        out.stop, out.rounds, out.continues, out.messages
    );
    let said: Vec<&Progress> = seen
        .iter()
        .filter(|p| matches!(p, Progress::Message { .. }))
        .collect();
    assert!(!said.is_empty(), "the bots answered: {seen:?}");
    match out.stop {
        Stop::CapReached => {
            assert!(
                out.continues >= 1,
                "the run continued the engine's pause before it reached its own cap"
            );
            assert_eq!(out.rounds, 6);
        }
        Stop::Done => eprintln!("the bots settled by themselves; the cap was not needed"),
        other => panic!("the run should finish or reach its cap, not {other:?}: {seen:?}"),
    }
    // the log shows the conversation the run printed
    let log = rooms::log_since(&gw, &room.id, 0).await.unwrap();
    assert!(log.iter().any(|e| e.kind == "message.user"));
    assert!(log.iter().filter(|e| e.kind == "message.member").count() >= said.len());
}
