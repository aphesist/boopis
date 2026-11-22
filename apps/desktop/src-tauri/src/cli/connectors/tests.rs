use std::sync::{Arc, Mutex, PoisonError};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::*;
use crate::connectors::ops::{OAuthPoll, OAuthStart};
use crate::connectors::{McpOps, ToolInfo};
use crate::secrets::store::MemoryStore;

fn a(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn list_takes_a_bot_and_json() {
    let p = parse(&a(&["list", "--bot", "kai", "--json"])).unwrap();
    assert_eq!(
        p,
        Parsed {
            bot: Some("kai".into()),
            json: true,
            verb: Verb::List
        }
    );
    assert_eq!(parse(&a(&["list"])).unwrap().bot, None);
    assert_eq!(parse(&a(&["list", "--bot=default"])).unwrap().bot, None);
}

#[test]
fn add_reads_the_command_arguments_and_env() {
    let p = parse(&a(&[
        "add",
        "notes",
        "--bot",
        "kai",
        "--command",
        "npx",
        "--args",
        "-y",
        "notes-mcp@1.2.3",
        "--env",
        "REGION=eu",
        "--env=A=1",
        "--yes",
    ]))
    .unwrap();
    assert_eq!(p.bot.as_deref(), Some("kai"));
    assert_eq!(
        p.verb,
        Verb::Add {
            name: "notes".into(),
            command: "npx".into(),
            args: a(&["-y", "notes-mcp@1.2.3"]),
            env: a(&["REGION=eu", "A=1"]),
            yes: true
        }
    );
}

#[test]
fn args_stop_at_a_flag_and_a_double_dash_keeps_the_rest() {
    let p = parse(&a(&["add", "n", "--args", "x", "--command", "npx"])).unwrap();
    assert!(matches!(p.verb, Verb::Add { ref args, .. } if args == &a(&["x"])));
    let p = parse(&a(&[
        "add",
        "n",
        "--command",
        "npx",
        "--args",
        "a",
        "--",
        "--yes",
        "-z",
    ]))
    .unwrap();
    assert!(
        matches!(p.verb, Verb::Add { ref args, yes: false, .. } if args == &a(&["a", "--yes", "-z"]))
    );
}

#[test]
fn mistakes_are_said_in_words() {
    for bad in [
        &["add", "n"][..],
        &["add", "--command", "npx"],
        &["add", "n", "--command"],
        &["add", "n", "--command", "x", "--args"],
        &["list", "--yes"],
        &["list", "extra"],
        &["remove"],
        &["frob"],
        &["test", "n", "--nope"],
    ] {
        assert!(parse(&a(bad)).is_err(), "{bad:?}");
    }
    assert!(parse(&[]).is_err());
}

#[derive(Default)]
struct Fake(Mutex<BTreeMap<String, Value>>);

#[async_trait]
impl McpOps for Fake {
    async fn list(&self) -> crate::error::Result<Vec<Installed>> {
        Ok(self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .map(|(n, c)| Installed {
                name: n.clone(),
                command: c["command"].as_str().map(str::to_owned),
                args: c["args"]
                    .as_array()
                    .map(|x| {
                        x.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default(),
                enabled: true,
                status: "configured".into(),
                ..Installed::default()
            })
            .collect())
    }
    async fn add(&self, name: &str, config: &Value) -> crate::error::Result<()> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(name.into(), config.clone());
        Ok(())
    }
    async fn test(&self, _n: &str) -> crate::error::Result<TestReport> {
        Ok(TestReport {
            ok: true,
            tools: vec![ToolInfo {
                name: "t1".into(),
                description: String::new(),
            }],
            error: None,
            prompts: None,
            resources: None,
            oauth_needed: false,
            signin_needed: false,
        })
    }
    async fn remove(&self, n: &str) -> crate::error::Result<()> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(n);
        Ok(())
    }
    async fn set_enabled(&self, _n: &str, _e: bool) -> crate::error::Result<()> {
        Ok(())
    }
    async fn config_get(&self, _k: &str) -> crate::error::Result<Option<Value>> {
        Ok(None)
    }
    async fn config_set(&self, _k: &str, _v: &str) -> crate::error::Result<()> {
        Ok(())
    }
    async fn config_unset(&self, _k: &str) -> crate::error::Result<()> {
        Ok(())
    }
    async fn restart_gateway(&self, _i: bool) -> crate::error::Result<()> {
        Ok(())
    }
    async fn running_turns(&self) -> crate::error::Result<u32> {
        Ok(0)
    }
    async fn oauth_start(&self, _n: &str) -> crate::error::Result<OAuthStart> {
        Err(Error::Unavailable("no".into()))
    }
    async fn oauth_poll(&self, _n: &str, _s: &str) -> crate::error::Result<OAuthPoll> {
        Err(Error::Unavailable("no".into()))
    }
    async fn oauth_cancel(&self, _n: &str, _s: &str) -> crate::error::Result<()> {
        Ok(())
    }
}

fn engine() -> (Engine, Arc<Fake>) {
    let fake = Arc::new(Fake::default());
    (
        Engine::new(
            fake.clone(),
            Arc::new(MemoryStore::default()),
            Arc::new(NoBrowser),
            Limits::default(),
        ),
        fake,
    )
}

fn run_args(e: &Engine, args: &[&str]) -> Outcome {
    let p = parse(&a(args)).unwrap();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(execute(e, &p))
}

#[test]
fn add_stops_for_yes_then_adds_then_lists_and_removes() {
    let (e, fake) = engine();
    let o = run_args(
        &e,
        &[
            "add",
            "notes",
            "--command",
            "npx",
            "--args",
            "-y",
            "notes-mcp@1.2.3",
            "--bot",
            "kai",
        ],
    );
    assert_eq!(o.code, EXIT_CONFIRM);
    assert!(
        fake.0.lock().unwrap().is_empty(),
        "nothing is added before --yes"
    );
    assert!(o.out.iter().any(|l| l.contains("--yes")));
    let o = run_args(
        &e,
        &[
            "add",
            "notes",
            "--command",
            "npx",
            "--args",
            "-y",
            "notes-mcp@1.2.3",
            "--yes",
        ],
    );
    assert_eq!(o.code, EXIT_OK, "{o:?}");
    assert_eq!(
        fake.0.lock().unwrap()["notes"]["args"],
        json!(["-y", "notes-mcp@1.2.3"])
    );
    let o = run_args(&e, &["list", "--json"]);
    let v: Value = serde_json::from_str(&o.out.join("\n")).unwrap();
    assert_eq!(v["connectors"][0]["name"], "notes");
    assert_eq!(run_args(&e, &["remove", "notes"]).code, EXIT_CONFIRM);
    assert_eq!(run_args(&e, &["remove", "notes", "--yes"]).code, EXIT_OK);
    assert!(fake.0.lock().unwrap().is_empty());
}

#[test]
fn the_forms_refusals_apply_and_a_key_is_never_a_literal() {
    let (e, fake) = engine();
    let o = run_args(&e, &["add", "x", "--command", "sh", "--yes"]);
    assert_eq!(o.code, EXIT_FAILED);
    let o = run_args(
        &e,
        &[
            "add",
            "x",
            "--command",
            "npx",
            "--args",
            "foo@1",
            "--env",
            "API_KEY=sk-live",
            "--yes",
        ],
    );
    assert_eq!(o.code, EXIT_FAILED);
    assert!(fake.0.lock().unwrap().is_empty());
    assert!(!o.err.join(" ").contains("sk-live") || o.err.join(" ").contains("${"));
}
