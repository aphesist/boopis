//! First-run setup against a real, unmodified Hermes, from a fresh `HERMES_HOME`, answering its forms non-interactively
//! (`docs/FORMS.md`, ADR-0014). Skips cleanly unless `HX_E2E_HERMES_ENV` names the spike install, `python3` runs and an
//! `hx` binary exists (`HX_BIN`, else `$CARGO_TARGET_DIR/debug/hx`). Never runs an installer; every process it starts
//! (the fake model, the gateway) is stopped when the test ends.
//!
//! It proves, in order: the plugin is installed and enabled; the Hermes settings are set through Hermes's CLI and only
//! after consent; the provider key reaches the host's keychain (a map in this test) and never a file; the gateway the
//! setup restarted loads the plugin; the plugin's secret source fetches the key through the host's real socket, so the
//! fake model sees it in the `Authorization` header of a real model call; and a governed session works afterwards.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines
)] // a test: failing loudly is the point

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hypotaxis_host::commands::Json;
use hypotaxis_host::config::Limits;
use hypotaxis_host::endpoint::EndpointConfig;
use hypotaxis_host::error::{Error, Result};
use hypotaxis_host::gateway::{FrameSink, Hub};
use hypotaxis_host::hermes::{Environment, Supervisor};
use hypotaxis_host::secrets::{SecretStore, channel};
use hypotaxis_host::setup::install::Bundle;
use hypotaxis_host::setup::ops::{CliOps, HermesOps};
use hypotaxis_host::setup::{Answer, Setup, StepState};
use serde_json::{Value, json};
use tokio::sync::mpsc;

const WAIT: Duration = Duration::from_mins(2);
const KEY: &str = "sk-setup-e2e-0123456789";
const AUX: &[&str] = &[
    "vision",
    "compression",
    "approval",
    "review",
    "mcp",
    "title_generation",
    "memory_query_rewrite",
    "tts_audio_tags",
    "voice_chat",
    "triage_specifier",
    "kanban_decomposer",
    "profile_describer",
    "goal_judge",
    "group_router",
    "curator",
    "monitor",
    "background_review",
    "moa_reference",
    "moa_aggregator",
];

/// The host's keychain, in memory (a test double that lives only here).
#[derive(Default)]
struct Map(Mutex<HashMap<(String, String), String>>);

impl SecretStore for Map {
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert((service.into(), account.into()), value.into());
        Ok(())
    }
    fn get(&self, service: &str, account: &str) -> Result<Option<String>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&(service.to_owned(), account.to_owned()))
            .cloned())
    }
    fn delete(&self, service: &str, account: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .remove(&(service.to_owned(), account.to_owned()));
        Ok(())
    }
}

struct Fake {
    child: Child,
    url: String,
}

impl Drop for Fake {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

/// Stops the gateway the test started, whether the test passes or panics.
struct GatewayGuard {
    hermes: PathBuf,
    home: PathBuf,
    env: Vec<(String, String)>,
}

impl Drop for GatewayGuard {
    fn drop(&mut self) {
        let _ = Command::new(&self.hermes)
            .args(["gateway", "stop", "--yes"])
            .env("HERMES_HOME", &self.home)
            .envs(self.env.iter().map(|(k, v)| (k, v)))
            .env(
                "PATH",
                self.hermes.parent().unwrap_or(Path::new("/usr/bin")),
            )
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

struct Collect(mpsc::UnboundedSender<String>);
impl FrameSink for Collect {
    fn send(&self, frame: &str) -> Result<()> {
        self.0
            .send(frame.to_owned())
            .map_err(|_| Error::Io("gone".into()))
    }
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn start_fake(log: &Path) -> Option<Fake> {
    let mut child = Command::new("python3")
        .arg(repo().join("tests/e2e/serve_fake_model.py"))
        .arg(log)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut line = String::new();
    BufReader::new(child.stdout.take()?)
        .read_line(&mut line)
        .ok()?;
    let url = serde_json::from_str::<Value>(line.trim()).ok()?["url"]
        .as_str()?
        .to_owned();
    Some(Fake { child, url })
}

fn hermes_bin_dir(spike: &Path) -> Option<PathBuf> {
    let installs = std::fs::read_dir(spike.join("hermes-home/installs")).ok()?;
    for install in installs.flatten() {
        for env in std::fs::read_dir(install.path().join("environments"))
            .ok()?
            .flatten()
        {
            let bin = env.path().join("venv/bin");
            if bin.join("hermes").is_file() {
                return Some(bin);
            }
        }
    }
    None
}

fn hx_binary() -> Option<PathBuf> {
    let env = std::env::var_os("HX_BIN").map(PathBuf::from);
    let target = std::env::var_os("CARGO_TARGET_DIR").map(|t| PathBuf::from(t).join("debug/hx"));
    env.into_iter().chain(target).find(|p| p.is_file())
}

fn answer(form_id: &str, values: Value, secrets: Value) -> Answer {
    Answer {
        form_id: form_id.into(),
        cancelled: false,
        values: Json(values),
        secrets: Json(secrets),
    }
}

async fn next(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
    serde_json::from_str(
        &tokio::time::timeout(WAIT, rx.recv())
            .await
            .expect("a frame in time")
            .expect("open"),
    )
    .expect("json")
}

async fn response(rx: &mut mpsc::UnboundedReceiver<String>, id: i64) -> (Value, Vec<Value>) {
    let mut seen = Vec::new();
    loop {
        let v = next(rx).await;
        if v.get("id") == Some(&json!(id)) && v.get("method").is_none() {
            return (v, seen);
        }
        seen.push(v);
    }
}

async fn turn(
    hub: &Hub,
    rx: &mut mpsc::UnboundedReceiver<String>,
    id: i64,
    session: &str,
    text: &str,
) -> Vec<Value> {
    hub.send(1, json!({"jsonrpc":"2.0","id":id,"method":"prompt.submit","params":{"session_id":session,"text":text,"submission_id":format!("sub-{id}")}})).await.unwrap();
    let (submitted, mut frames) = response(rx, id).await;
    assert!(submitted.get("error").is_none(), "{submitted}");
    loop {
        let v = next(rx).await;
        let done = v["params"]["type"] == "message.complete"
            && v["params"]["session_id"] == json!(session);
        frames.push(v);
        if done {
            return frames;
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_run_setup_end_to_end_on_a_real_hermes() {
    let Some(spike) = std::env::var_os("HX_E2E_HERMES_ENV").map(PathBuf::from) else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run first-run setup against a real Hermes"
        );
        return;
    };
    let (Some(bin), Some(hx)) = (hermes_bin_dir(&spike), hx_binary()) else {
        eprintln!(
            "skipped: no Hermes install under HX_E2E_HERMES_ENV, or no hx binary (cargo build -p hx)"
        );
        return;
    };
    let root = tempfile::tempdir().unwrap();
    // HX_E2E_KEEP=<dir>: keep the scratch profile there, to read Hermes's logs after a failure.
    let root_path = match std::env::var_os("HX_E2E_KEEP") {
        Some(dir) => tempfile::Builder::new()
            .prefix("setup-live-")
            .tempdir_in(dir)
            .unwrap()
            .keep(),
        None => root.path().to_path_buf(),
    };
    let log = root_path.as_path().join("model-requests.jsonl");
    let Some(fake) = start_fake(&log) else {
        eprintln!("skipped: python3 could not serve the fake model");
        return;
    };

    // A fresh profile: a user with Hermes and one provider (no key), a model endpoint, and nothing of ours.
    let (home, hermes_home, work) = (
        root_path.as_path().join("home"),
        root_path.as_path().join("hermes-home"),
        root_path.as_path().join("work"),
    );
    for d in [&home, &hermes_home, &work] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::os::unix::fs::symlink(
        spike.join("hermes-home/installs"),
        hermes_home.join("installs"),
    )
    .unwrap();
    let mut aux = serde_json::Map::new();
    for t in AUX {
        aux.insert((*t).into(), json!({"provider": "main", "model": "fake-a"}));
    }
    let fixture = json!({
        "model": {"provider": "main", "default": "fake-a"}, "updates": {"check": false},
        "model_catalog": {"enabled": false},
        "models_dev": {"url": fake.url.trim_end_matches("/v1").to_owned() + "/models-dev-api.json"},
        "providers": {"main": {"api": fake.url, "transport": "openai_chat", "discover_models": false,
            "models": {"fake-a": {"context_length": 200_000}}}},
        "auxiliary": aux,
    });
    std::fs::write(hermes_home.join("config.yaml"), fixture.to_string()).unwrap(); // JSON is YAML

    let env = Environment {
        hermes_home: Some(hermes_home.display().to_string()),
        home_dir: Some(home.clone()),
        path: Some(std::ffi::OsString::from(&bin)),
        ..Environment::default()
    };
    let child_env: Vec<(String, String)> = [
        ("HOME", home.display().to_string()),
        (
            "HERMES_RUNTIME_DIR",
            spike.join("runtime").display().to_string(),
        ),
        (
            "UV_PYTHON_INSTALL_DIR",
            spike.join("uv-python").display().to_string(),
        ),
        ("UV_CACHE_DIR", spike.join("uv-cache").display().to_string()),
        ("NO_PROXY", "127.0.0.1,localhost,::1".into()),
        ("no_proxy", "127.0.0.1,localhost,::1".into()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v))
    .collect();
    let sup = Arc::new(Supervisor::new(env, Limits::default()).with_child_env(child_env.clone()));
    let guard = GatewayGuard {
        hermes: bin.join("hermes"),
        home: hermes_home.clone(),
        env: child_env,
    };
    let ops = Arc::new(CliOps::new(sup.clone(), hermes_home.clone()));

    // The host's secret channel, over its keychain, exactly as the app starts it.
    let keychain = Arc::new(Map::default());
    let _channel = channel::start(
        keychain.clone(),
        &root.path().join("run"),
        &hermes_home.join("hypotaxis/host-channel.json"),
    )
    .await
    .expect("the secret channel starts");

    let bundle = Bundle {
        plugin_dir: Some(repo().join("plugins/hypotaxis")),
        hx: Some(hx),
    };
    let setup = Setup::new(ops.clone(), keychain.clone(), bundle);

    assert!(
        setup.check().await.unwrap().needed,
        "a fresh profile needs setup"
    );

    // 1. The plugin and hx, then one consent form with the exact diff. Nothing is changed before the answer.
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].state, StepState::Done, "{:?}", s.steps);
    let form = s.form.expect("the consent form");
    assert_eq!(
        (form.form_id.as_str(), form.kind.as_str()),
        ("setup.config", "setup")
    );
    assert_eq!(form.diff.len(), 3, "{:?}", form.diff);
    assert!(
        ops.config_get("delegation.backend")
            .await
            .unwrap()
            .is_none_or(|v| v != json!("hypotaxis"))
    );
    assert!(hermes_home.join("plugins/hypotaxis/plugin.yaml").is_file());
    assert!(
        !hermes_home.join("plugins/hypotaxis/tests").exists(),
        "tests are not shipped"
    );
    assert!(
        ops.plugins()
            .await
            .unwrap()
            .iter()
            .any(|p| p.name == "hypotaxis" && p.enabled),
        "enabled through Hermes"
    );

    // 2. Consent: the settings are written by `hermes config set`. Then the model choice and the key.
    let s = setup
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert_eq!(
        ops.config_get("tools.tool_search.enabled")
            .await
            .unwrap()
            .unwrap(),
        json!("off")
    );
    assert_eq!(
        ops.config_get("delegation.backend").await.unwrap().unwrap(),
        json!("hypotaxis")
    );
    assert_eq!(
        ops.config_get("plugins.entries.hypotaxis.allow_gateway_injection")
            .await
            .unwrap()
            .unwrap(),
        json!(true)
    );
    assert_eq!(s.form.unwrap().form_id, "setup.ladder");
    let s = setup
        .advance(
            Some(answer(
                "setup.ladder",
                json!({"choice": "main/fake-a"}),
                json!({}),
            )),
            false,
        )
        .await
        .unwrap();
    let cred = s.form.expect("a credential form for the missing key");
    assert_eq!(
        (cred.form_id.as_str(), cred.sensitive),
        ("setup.credential.main", true)
    );
    let s = setup
        .advance(
            Some(answer(
                "setup.credential.main",
                json!({}),
                json!({"value": KEY}),
            )),
            false,
        )
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    let receipt = s.receipt.unwrap();
    assert!(!receipt.lines.is_empty());

    // 3. The key is in the keychain and in no file.
    assert_eq!(
        keychain
            .get("hypotaxis.provider.main", "api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    for entry in walk(&hermes_home) {
        if entry.starts_with(hermes_home.join("installs")) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&entry) {
            assert!(
                !text.contains(KEY),
                "the key must not be in {}",
                entry.display()
            );
        }
    }
    assert_eq!(
        ops.config_get("plugins.entries.hypotaxis.settings.hx_path")
            .await
            .unwrap()
            .unwrap(),
        json!(hermes_home.join("hypotaxis/bin/hx").display().to_string())
    );

    // 4. The gateway setup restarted runs the plugin; the model call carries the key the secret source fetched.
    let limits = Limits::default();
    let endpoint = EndpointConfig::Local { profile: None }
        .build(&sup, &limits)
        .unwrap();
    let hub = Hub::new(endpoint, limits);
    let (tx, mut rx) = mpsc::unbounded_channel();
    hub.open(1, Arc::new(Collect(tx)), WAIT)
        .await
        .expect("the gateway connects");
    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":1,"method":"plugin.hypotaxis.describe","params":{}}),
    )
    .await
    .unwrap();
    let (described, _) = response(&mut rx, 1).await;
    let result = &described["result"];
    assert_eq!(result["protocol"], "hypotaxis-v1", "{described}");
    assert_eq!(result["config"]["errors"], json!([]), "{described}");
    assert_eq!(result["config"]["ladder_errors"], json!([]), "{described}");

    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":2,"method":"session.create","params":{
        "source":"gui","cwd":work,"model":"fake-a","provider":"main","toolsets":["hypotaxis"]}}),
    )
    .await
    .unwrap();
    let (created, _) = response(&mut rx, 2).await;
    let session = created["result"]["session_id"]
        .as_str()
        .expect("a session")
        .to_owned();
    let frames = turn(
        &hub,
        &mut rx,
        3,
        &session,
        "@@reply hello from the setup test@@",
    )
    .await;
    assert!(
        frames.iter().any(|f| f["params"]["payload"]["text"]
            .as_str()
            .is_some_and(|t| t.contains("hello"))),
        "the model answered"
    );
    let seen = std::fs::read_to_string(&log).unwrap();
    assert!(
        seen.lines().any(
            |l| serde_json::from_str::<Value>(l).unwrap()["authorization"]
                == format!("Bearer {KEY}")
        ),
        "the fake model must have received the keychain key; it saw: {seen}"
    );

    // 5. A governed session works: its first prompt locks the mode, and the plugin's own tool answers and is recorded.
    let frames = turn(&hub, &mut rx, 4, &session,
        r#"@@call request_input {"kind":"question","title":"Which branch?","schema":{"type":"object","properties":{"branch":{"type":"string"}}}}@@ @@reply asked@@"#).await;
    assert!(
        frames
            .iter()
            .any(|f| f["params"]["type"] == "plugin.hypotaxis.form.opened"),
        "the form reached the viewer"
    );
    hub.send(1, json!({"jsonrpc":"2.0","id":5,"method":"plugin.hypotaxis.ledger.tail","params":{"session_id":session,"since_seq":-1,"limit":100}})).await.unwrap();
    let (tail, _) = response(&mut rx, 5).await;
    let events = tail["result"]["events"].as_array().expect("events");
    let opened = events
        .iter()
        .find(|e| e["type"] == "session.opened")
        .expect("session.opened");
    assert_eq!(opened["payload"]["mode"], "governed");
    assert!(
        events.iter().any(|e| e["payload"]["tool"] == "form.opened"),
        "the form is in the ledger"
    );

    // 6. Running setup again changes nothing and asks nothing.
    let again = setup.advance(None, false).await.unwrap();
    assert!(again.done && again.form.is_none(), "{:?}", again.steps);
    assert!(!setup.check().await.unwrap().needed);

    drop(hub);
    let info = sup.info().await.unwrap();
    let _ = sup
        .cli()
        .run(
            &info.binary,
            &hermes_home,
            &["gateway", "stop", "--yes"],
            Duration::from_mins(1),
        )
        .await;
    drop(guard);
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_symlink() {
                continue;
            }
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}
