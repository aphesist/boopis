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
    unsafe_code, // one `set_var` in the bundled test, with its SAFETY note
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

use boopis_host::commands::Json;
use boopis_host::config::Limits;
use boopis_host::endpoint::EndpointConfig;
use boopis_host::error::{Error, Result};
use boopis_host::gateway::{FrameSink, Hub};
use boopis_host::hermes::{Environment, Supervisor};
use boopis_host::secrets::{Auth, PeerPolicy, SecretStore, channel};
use boopis_host::setup::install::Bundle;
use boopis_host::setup::ops::{CliOps, HermesOps};
use boopis_host::setup::{Answer, Setup, StepState};
use serde_json::{Value, json};
use tokio::sync::mpsc;

const WAIT: Duration = Duration::from_mins(2);
const KEY: &str = "sk-setup-e2e-0123456789";
/// The model the fake provider serves for the session and the ladder: governed mode runs only on frontier models
/// (ADR-0037) and matches by the model id, so the fake model carries a frontier id. Side calls stay on `fake-a`.
const FRONTIER: &str = "claude-opus-5-5";
/// The engine's own provider for the governed session: `OpenRouter`, whose base URL the engine reads from `OPENROUTER_BASE_URL`
/// and which the engine reports as `openrouter`, not `custom`. `OpenRouter` keys start with `sk-or-`.
const GOVERNED_PROVIDER: &str = "openrouter";
const GOVERNED_KEY: &str = "sk-or-v1-setup-e2e-governed";
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
                format!(
                    "{}:/usr/bin:/bin",
                    self.hermes
                        .parent()
                        .unwrap_or(Path::new("/usr/bin"))
                        .display()
                ),
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

/// The live tests share the process environment (the bundled one sets two variables), so they run one at a time.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Where the Hermes under test comes from.
enum Install {
    /// The spike install (`HX_E2E_HERMES_ENV`), found on `PATH` the way a user's own Hermes is.
    Spike(PathBuf),
    /// The runtime archive the app ships (`HX_E2E_RUNTIME_ARCHIVE`: a directory with `runtime.json` and the archive): the host
    /// unpacks it itself as the first setup step, into a temporary app data directory.
    Runtime(PathBuf),
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_run_setup_end_to_end_on_a_real_hermes() {
    let Some(spike) = std::env::var_os("HX_E2E_HERMES_ENV").map(PathBuf::from) else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run first-run setup against a real Hermes"
        );
        return;
    };
    run_flow(Install::Spike(spike)).await;
}

/// The same flow, end to end, on the archive the installer carries (ADR-0023): the real `.tar.zst` is unpacked by the
/// host into a temporary data directory, the private home never sees `~/.hermes`, and the gateway runs on the bundled
/// interpreter. CI points `HX_E2E_RUNTIME_ARCHIVE` at the artifact `scripts/build-runtime.sh` made.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_run_setup_end_to_end_on_the_bundled_runtime() {
    let Some(dir) = std::env::var_os("HX_E2E_RUNTIME_ARCHIVE").map(PathBuf::from) else {
        eprintln!(
            "skipped: set HX_E2E_RUNTIME_ARCHIVE to a directory with runtime.json and the runtime archive (scripts/build-runtime.sh)"
        );
        return;
    };
    run_flow(Install::Runtime(dir)).await;
}

/// The running processes whose command line mentions `needle` (Linux: `/proc`; macOS: `ps`, which reads the kernel's
/// argument blocks).
fn processes_using(needle: &Path) -> Vec<String> {
    let needle = needle.display().to_string();
    if cfg!(target_os = "macos") {
        let out = Command::new("/bin/ps")
            .args(["-axww", "-o", "command="])
            .output()
            .unwrap();
        return String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| l.contains(&needle))
            .map(str::to_owned)
            .collect();
    }
    let mut found = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/proc") {
        for e in rd.flatten() {
            if let Ok(raw) = std::fs::read(e.path().join("cmdline")) {
                let line = String::from_utf8_lossy(&raw).replace('\0', " ");
                if line.contains(&needle) {
                    found.push(line);
                }
            }
        }
    }
    found
}

/// A snapshot of a directory tree (names, sizes and modification times) to prove nothing in it changed.
fn snapshot(dir: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
    let mut v: Vec<_> = walk(dir)
        .into_iter()
        .map(|p| {
            let m = std::fs::metadata(&p).ok();
            (
                p,
                m.as_ref().map_or(0, std::fs::Metadata::len),
                m.and_then(|m| m.modified().ok()),
            )
        })
        .collect();
    v.sort();
    v
}

#[allow(clippy::too_many_lines)]
async fn run_flow(install: Install) {
    let _serial = SERIAL.lock().await;
    let Some(hx) = hx_binary() else {
        eprintln!("skipped: no hx binary (cargo build -p hx)");
        return;
    };
    let spike_bin = match &install {
        Install::Spike(spike) => {
            let Some(bin) = hermes_bin_dir(spike) else {
                eprintln!("skipped: no Hermes install under HX_E2E_HERMES_ENV");
                return;
            };
            Some(bin)
        }
        Install::Runtime(_) => None,
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
    let (home, work) = (
        root_path.as_path().join("home"),
        root_path.as_path().join("work"),
    );
    let (plan, hermes_home) = match &install {
        Install::Spike(_) => (None, root_path.as_path().join("hermes-home")),
        Install::Runtime(dir) => {
            let plan = boopis_host::runtime::Plan {
                runtime: boopis_host::runtime::Runtime::read(dir).expect("runtime.json is valid"),
                data_dir: root_path.as_path().join("data"),
            };
            let home = plan.home();
            (Some(plan), home)
        }
    };
    for d in [&home, &hermes_home, &work] {
        std::fs::create_dir_all(d).unwrap();
    }
    // The user's own Hermes home, which the bundled runtime must never read or write.
    let decoy = home.join(".hermes");
    std::fs::create_dir_all(&decoy).unwrap();
    std::fs::write(
        decoy.join("config.yaml"),
        "model: {provider: decoy, default: never-used}\n",
    )
    .unwrap();
    std::fs::write(decoy.join(".env"), "OPENAI_API_KEY=sk-the-users-own-key\n").unwrap();
    let decoy_before = snapshot(&decoy);
    if let Install::Spike(spike) = &install {
        std::os::unix::fs::symlink(
            spike.join("hermes-home/installs"),
            hermes_home.join("installs"),
        )
        .unwrap();
    }
    let mut aux = serde_json::Map::new();
    for t in AUX {
        // `side`, not `main`: "main" in an auxiliary task means the provider of the session that runs, which in the governed
        // session is the built-in OpenRouter the engine would reach on the real network.
        aux.insert((*t).into(), json!({"provider": "side", "model": "fake-a"}));
    }
    let fixture = json!({
        "model": {"provider": "main", "default": FRONTIER}, "updates": {"check": false},
        "model_catalog": {"enabled": false},
        "models_dev": {"url": fake.url.trim_end_matches("/v1").to_owned() + "/models-dev-api.json"},
        "providers": {
            "main": {"api": fake.url, "transport": "openai_chat", "discover_models": false,
                "models": {"fake-a": {"context_length": 200_000}, FRONTIER: {"context_length": 200_000}}},
            "side": {"api": fake.url, "transport": "openai_chat", "discover_models": false,
                "models": {"fake-a": {"context_length": 200_000}}},
        },
        "auxiliary": aux,
    });
    std::fs::write(hermes_home.join("config.yaml"), fixture.to_string()).unwrap(); // JSON is YAML
    // The user's own environment points somewhere else: the bundled Hermes must not follow it.
    if plan.is_some() {
        // SAFETY: the two live tests of this binary run one after the other (`SERIAL`), and nothing else in the process
        // reads these two names while this runs: Hermes's children get their environment explicitly.
        unsafe {
            std::env::set_var("HERMES_HOME", decoy.display().to_string());
            std::env::set_var(
                "HERMES_RUNTIME_DIR",
                decoy.join("tools").display().to_string(),
            );
        }
    }

    let mut env = Environment {
        hermes_home: Some(hermes_home.display().to_string()),
        home_dir: Some(home.clone()),
        path: spike_bin.as_ref().map(std::ffi::OsString::from),
        ..Environment::default()
    };
    let mut child_env: Vec<(String, String)> = vec![
        ("HOME".into(), home.display().to_string()),
        // The governed session of step 5 runs on a built-in provider of the engine, pointed at the fake model through the
        // variable the engine reads its base URL from (ADR-0039: a custom endpoint never runs governed mode, and the engine
        // reports every user-defined `providers:` entry as `custom`).
        ("OPENROUTER_BASE_URL".into(), fake.url.clone()),
        ("OPENROUTER_API_KEY".into(), GOVERNED_KEY.into()),
        ("NO_PROXY".into(), "127.0.0.1,localhost,::1".into()),
        ("no_proxy".into(), "127.0.0.1,localhost,::1".into()),
    ];
    if let Install::Spike(spike) = &install {
        child_env.extend([
            (
                "HERMES_RUNTIME_DIR".to_owned(),
                spike.join("runtime").display().to_string(),
            ),
            (
                "UV_PYTHON_INSTALL_DIR".to_owned(),
                spike.join("uv-python").display().to_string(),
            ),
            (
                "UV_CACHE_DIR".to_owned(),
                spike.join("uv-cache").display().to_string(),
            ),
        ]);
    }
    if let Some(plan) = &plan {
        env = env.with_bundled(plan.bundled());
    }
    let hermes_launcher = spike_bin.as_ref().map_or_else(
        || plan.as_ref().map(|p| p.bundled().binary).unwrap(),
        |b| b.join("hermes"),
    );
    // The host's secret channel: its token goes to the gateway this supervisor starts, and the policy learns which process
    // that is and requires that it was started with the token, exactly as the app wires it (on macOS, where the engine's
    // daemon is a launchd job and not the launcher's child, the token is what admits it while it starts).
    let auth = Auth::mint_in(&root.path().join("run")).expect("a channel token");
    let peers = Arc::new(PeerPolicy::new().holding(auth.token_entry()));
    let sup = Arc::new(
        Supervisor::new(env, Limits::default())
            .with_child_env(child_env.clone())
            .with_secret_channel(auth.launch_env(), peers.clone()),
    );
    let guard = GatewayGuard {
        hermes: hermes_launcher,
        home: hermes_home.clone(),
        env: child_env,
    };
    let ops = Arc::new(CliOps::new(sup.clone(), hermes_home.clone()));

    // The host's secret channel, over its keychain, exactly as the app starts it.
    let keychain = Arc::new(Map::default());
    let _channel = channel::start(keychain.clone(), &auth, peers)
        .await
        .expect("the secret channel starts");

    let bundle = Bundle {
        plugin_dir: Some(repo().join("plugins/boopis")),
        hx: Some(hx),
    };
    let setup = Setup::new(ops.clone(), keychain.clone(), bundle);
    let setup = match plan.clone() {
        Some(plan) => setup.with_runtime(plan),
        None => setup,
    };

    assert!(
        setup.check().await.unwrap().needed,
        "a fresh profile needs setup"
    );

    // 1. The plugin and hx, then one consent form with the exact diff. Nothing is changed before the answer.
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].state, StepState::Done, "{:?}", s.steps);
    let steps = format!("{:?}", s.steps);
    let form = s
        .form
        .unwrap_or_else(|| panic!("the consent form; steps: {steps}"));
    assert_eq!(
        (form.form_id.as_str(), form.kind.as_str()),
        ("setup.config", "setup")
    );
    assert_eq!(form.diff.len(), 3, "{:?}", form.diff);
    assert!(
        ops.config_get("delegation.backend")
            .await
            .unwrap()
            .is_none_or(|v| v != json!("boopis"))
    );
    assert!(hermes_home.join("plugins/boopis/plugin.yaml").is_file());
    assert!(
        !hermes_home.join("plugins/boopis/tests").exists(),
        "tests are not shipped"
    );
    assert!(
        ops.plugins()
            .await
            .unwrap()
            .iter()
            .any(|p| p.name == "boopis" && p.enabled),
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
        json!("boopis")
    );
    assert_eq!(
        ops.config_get("plugins.entries.boopis.allow_gateway_injection")
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
                json!({"choice": format!("main/{FRONTIER}")}),
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
            .get("boopis.provider.main", "api_key")
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
        ops.config_get("plugins.entries.boopis.settings.hx_path")
            .await
            .unwrap()
            .unwrap(),
        json!(hermes_home.join("boopis/bin/hx").display().to_string())
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
        json!({"jsonrpc":"2.0","id":1,"method":"plugin.boopis.describe","params":{}}),
    )
    .await
    .unwrap();
    let (described, _) = response(&mut rx, 1).await;
    let result = &described["result"];
    assert_eq!(result["protocol"], "boopis-v1", "{described}");
    assert_eq!(result["config"]["errors"], json!([]), "{described}");
    assert_eq!(result["config"]["ladder_errors"], json!([]), "{described}");

    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":2,"method":"session.create","params":{
        "source":"gui","cwd":work,"model":FRONTIER,"provider":"main","toolsets":["boopis"]}}),
    )
    .await
    .unwrap();
    let (created, _) = response(&mut rx, 2).await;
    let session = created["result"]["session_id"]
        .as_str()
        .expect("a session")
        .to_owned();
    // The provider setup wrote is a user-defined one, which the engine reports as `custom`: governed mode never runs on it
    // (ADR-0039), so this session answers ungoverned. It proves the key; step 5 proves governed mode on a built-in provider.
    hub.send(1, json!({"jsonrpc":"2.0","id":20,"method":"plugin.boopis.mode.set","params":{"session_id":session,"mode":"ungoverned"}}))
        .await
        .unwrap();
    let (mode, _) = response(&mut rx, 20).await;
    assert!(mode.get("error").is_none(), "{mode}");
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

    // 5. A governed session works: its first prompt locks the mode, and the plugin's own tool answers and is recorded. It runs
    // on the engine's built-in OpenRouter provider (pointed at the fake model), with a frontier-named model.
    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":21,"method":"session.create","params":{
        "source":"gui","cwd":work,"model":FRONTIER,"provider":GOVERNED_PROVIDER,"toolsets":["boopis"]}}),
    )
    .await
    .unwrap();
    let (created, _) = response(&mut rx, 21).await;
    let session = created["result"]["session_id"]
        .as_str()
        .expect("a governed session")
        .to_owned();
    hub.send(1, json!({"jsonrpc":"2.0","id":22,"method":"plugin.boopis.mode.set","params":{"session_id":session,"mode":"governed"}}))
        .await
        .unwrap();
    let (mode, _) = response(&mut rx, 22).await;
    assert!(mode.get("error").is_none(), "{mode}");
    let frames = turn(&hub, &mut rx, 4, &session,
        r#"@@call request_input {"kind":"question","title":"Which branch?","schema":{"type":"object","properties":{"branch":{"type":"string"}}}}@@ @@reply asked@@"#).await;
    assert!(
        frames
            .iter()
            .any(|f| f["params"]["type"] == "plugin.boopis.form.opened"),
        "the form reached the viewer"
    );
    hub.send(1, json!({"jsonrpc":"2.0","id":5,"method":"plugin.boopis.ledger.tail","params":{"session_id":session,"since_seq":-1,"limit":100}})).await.unwrap();
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

    // The bundled runtime: unpacked by the host, running the gateway, with Hermes's own updates off.
    let old_runtime = plan
        .as_ref()
        .map(|plan| plan.runtimes_dir().join("0.22.0-00000000"));
    if let Some(plan) = &plan {
        let layout = plan.runtime.layout(&plan.runtimes_dir());
        assert!(
            layout.hermes.is_file() && layout.python.is_file(),
            "unpacked by the host"
        );
        let users = processes_using(&layout.root);
        assert!(
            users.iter().any(|l| l.contains("gateway")),
            "the gateway runs on the bundled interpreter, found: {users:?}"
        );
        assert_eq!(
            ops.config_get("updates.check").await.unwrap().unwrap(),
            json!(false),
            "Hermes's own update check is off"
        );
        let update = sup
            .cli()
            .run(
                &layout.hermes,
                &hermes_home,
                &["update"],
                Duration::from_mins(1),
            )
            .await
            .unwrap();
        assert_ne!(
            update.code, 0,
            "`hermes update` refuses inside the bundle: {}",
            update.stdout
        );
        assert!(update.stdout.contains("desktop app") || update.stderr.contains("desktop app"));
        assert!(
            std::fs::read_dir(plan.data_dir.join("cache/pycache"))
                .is_ok_and(|mut d| d.next().is_some()),
            "Python's bytecode goes to the app's own cache"
        );
        // an older runtime (ours: it has the marker) and a stranger's folder, for the cleanup below
        let old = old_runtime.as_ref().unwrap();
        std::fs::create_dir_all(old).unwrap();
        std::fs::write(old.join(".hx-runtime.json"), "{}").unwrap();
        std::fs::create_dir_all(plan.runtimes_dir().join("not-ours")).unwrap();
    }

    // 6. Running setup again changes nothing and asks nothing.
    let again = setup.advance(None, false).await.unwrap();
    assert!(again.done && again.form.is_none(), "{:?}", again.steps);
    assert!(!setup.check().await.unwrap().needed);
    if let Some(plan) = &plan {
        assert_eq!(
            again.steps[0].detail,
            format!(
                "version {}, unpacked",
                plan.runtime.manifest().hermes_version
            )
        );
        assert!(
            !old_runtime.unwrap().exists(),
            "the older runtime is removed once the new one runs"
        );
        assert!(
            plan.runtimes_dir().join("not-ours").is_dir(),
            "a folder that is not ours is left alone"
        );
        assert_eq!(
            snapshot(&decoy),
            decoy_before,
            "the user's own ~/.hermes was never read or written"
        );
        assert!(
            !home.join(".cache/hermes-pycache").exists(),
            "nothing in the user's cache either"
        );
    }

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

/// The free tier's mechanism on a real Hermes, with no call to Nous: `free_tier.status` is a pure read ("zero network, zero
/// side effects"), so it can be asked on a link that does not declare itself the Desktop and on one that does. Hermes answers
/// "claimable" only to the second, which is the whole reason the host declares it (`docs/research/free-tier.md` section 2).
/// `free_tier.provision`, the one call that reaches the account service, is never made here.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_free_tier_is_claimable_only_to_a_link_that_declares_the_desktop() {
    use boopis_host::endpoint::Local;
    use boopis_host::gateway::oneshot::Link;

    let _serial = SERIAL.lock().await;
    let Some(spike) = std::env::var_os("HX_E2E_HERMES_ENV").map(PathBuf::from) else {
        eprintln!("skipped: set HX_E2E_HERMES_ENV to the spike install");
        return;
    };
    let Some(bin) = hermes_bin_dir(&spike) else {
        eprintln!("skipped: no Hermes install under HX_E2E_HERMES_ENV");
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let (home, hermes_home) = (root.path().join("home"), root.path().join("hermes-home"));
    for d in [&home, &hermes_home] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::os::unix::fs::symlink(
        spike.join("hermes-home/installs"),
        hermes_home.join("installs"),
    )
    .unwrap();
    // nothing configured, nothing used: a first install, and no network wanted
    std::fs::write(
        hermes_home.join("config.yaml"),
        json!({"updates": {"check": false}, "model_catalog": {"enabled": false}}).to_string(),
    )
    .unwrap();
    let child_env: Vec<(String, String)> = vec![
        ("HOME".into(), home.display().to_string()),
        ("NO_PROXY".into(), "127.0.0.1,localhost,::1".into()),
        ("no_proxy".into(), "127.0.0.1,localhost,::1".into()),
        (
            "HERMES_RUNTIME_DIR".into(),
            spike.join("runtime").display().to_string(),
        ),
        (
            "UV_PYTHON_INSTALL_DIR".into(),
            spike.join("uv-python").display().to_string(),
        ),
        (
            "UV_CACHE_DIR".into(),
            spike.join("uv-cache").display().to_string(),
        ),
    ];
    let env = Environment {
        hermes_home: Some(hermes_home.display().to_string()),
        home_dir: Some(home.clone()),
        path: Some(std::ffi::OsString::from(&bin)),
        ..Environment::default()
    };
    let limits = Limits::default();
    let sup = Arc::new(Supervisor::new(env, limits.clone()).with_child_env(child_env.clone()));
    let _guard = GatewayGuard {
        hermes: bin.join("hermes"),
        home: hermes_home.clone(),
        env: child_env,
    };
    let endpoint = Local::new(sup.clone(), hermes_home.clone(), limits.clone());
    let ask = |declare: bool| {
        let endpoint = &endpoint;
        let limits = limits.clone();
        async move {
            Link::open(
                endpoint,
                declare,
                limits.max_inbound_frame,
                limits.ensure_timeout + limits.cli_timeout,
            )
            .await
            .expect("the gateway answers")
            .call("free_tier.status", &json!({}))
            .await
            .expect("free_tier.status answers")
        }
    };

    let plain = ask(false).await;
    assert_eq!(plain["model"], "nous/welcome", "{plain}");
    assert_eq!(plain["label"], "Nous \u{b7} free tier", "{plain}");
    assert_eq!(plain["available"], false);
    assert_eq!(
        plain["enabled"], false,
        "a link that does not say it is the Desktop is not offered the claim: {plain}"
    );

    let declared = ask(true).await;
    assert_eq!(
        declared["available"], false,
        "nothing was claimed: {declared}"
    );
    assert_eq!(
        declared["enabled"], true,
        "Hermes counts the declaring link as the Desktop on this machine and the machine as a first install: {declared}"
    );
    assert_eq!(declared["model"], "nous/welcome");

    tokio::time::sleep(Duration::from_secs(4)).await; // the boot Hermes starts on a declaration runs in the background
    // no identity was made, and nothing was sent to Nous: there is no auth store with a guest in it
    let auth = std::fs::read_to_string(hermes_home.join("auth.json")).unwrap_or_default();
    assert!(!auth.contains("anon_"), "no identity was claimed");
    // the declaration did not touch the session platform: that is what HERMES_DESKTOP would have changed
    let cfg = std::fs::read_to_string(hermes_home.join("config.yaml")).unwrap_or_default();
    eprintln!("config.yaml after the declaration:\n{cfg}");
    eprintln!("state under HOME: {:?}", walk(&home.join(".local")));
    assert!(
        !cfg.contains("desktop_ui"),
        "the declaration writes no toolset: {cfg}"
    );
}

/// The Claude subscription plugin boopis's runtime carries (ADR-0030), placed in a profile the way setup places it
/// (`install::install_runtime_plugins`), is listed by a real engine as an enabled model provider: nothing is installed through
/// the engine's own commands and nothing is downloaded. `HX_E2E_CLAUDE_PLUGIN` is the plugin's directory as
/// `scripts/build-runtime.sh` bundles it (the catalog's pinned commit, with its licence). No gateway is started.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_bundled_claude_plugin_placed_by_setup_is_an_enabled_model_provider_with_nothing_installed()
 {
    let _serial = SERIAL.lock().await;
    let Some(spike) = std::env::var_os("HX_E2E_HERMES_ENV").map(PathBuf::from) else {
        eprintln!("skipped: set HX_E2E_HERMES_ENV to the spike install");
        return;
    };
    let Some(plugin) = std::env::var_os("HX_E2E_CLAUDE_PLUGIN").map(PathBuf::from) else {
        eprintln!("skipped: set HX_E2E_CLAUDE_PLUGIN to the bundled plugin's directory");
        return;
    };
    let Some(bin) = hermes_bin_dir(&spike) else {
        eprintln!("skipped: no Hermes install under HX_E2E_HERMES_ENV");
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let (home, hermes_home) = (root.path().join("home"), root.path().join("hermes-home"));
    for d in [&home, &hermes_home] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::os::unix::fs::symlink(
        spike.join("hermes-home/installs"),
        hermes_home.join("installs"),
    )
    .unwrap();
    std::fs::write(
        hermes_home.join("config.yaml"),
        json!({"updates": {"check": false}, "model_catalog": {"enabled": false}}).to_string(),
    )
    .unwrap();
    let dead = "http://127.0.0.1:1".to_owned();
    let child_env: Vec<(String, String)> = vec![
        ("HOME".into(), home.display().to_string()),
        // both spellings: git and curl read the lower-case one first, and the parent's must not win
        ("HTTPS_PROXY".into(), dead.clone()),
        ("https_proxy".into(), dead.clone()),
        ("HTTP_PROXY".into(), dead.clone()),
        ("http_proxy".into(), dead.clone()),
        ("ALL_PROXY".into(), dead.clone()),
        ("all_proxy".into(), dead),
        ("NO_PROXY".into(), "127.0.0.1,localhost,::1".into()),
        ("no_proxy".into(), "127.0.0.1,localhost,::1".into()),
        (
            "HERMES_RUNTIME_DIR".into(),
            spike.join("runtime").display().to_string(),
        ),
        (
            "UV_PYTHON_INSTALL_DIR".into(),
            spike.join("uv-python").display().to_string(),
        ),
        (
            "UV_CACHE_DIR".into(),
            spike.join("uv-cache").display().to_string(),
        ),
    ];
    let env = Environment {
        hermes_home: Some(hermes_home.display().to_string()),
        home_dir: Some(home.clone()),
        path: Some(std::ffi::OsString::from(&bin)),
        ..Environment::default()
    };
    let sup = Arc::new(Supervisor::new(env, Limits::default()).with_child_env(child_env));
    let ops = CliOps::new(sup, hermes_home.clone());
    // what the runtime archive holds, and what setup's runtime step does with it
    let runtime = root.path().join("runtime");
    let carried = runtime
        .join("plugins")
        .join(boopis_host::claude::PROVIDER_ID);
    std::fs::create_dir_all(&carried).unwrap();
    for f in std::fs::read_dir(&plugin).unwrap() {
        let f = f.unwrap();
        if f.file_type().unwrap().is_file() {
            std::fs::copy(f.path(), carried.join(f.file_name())).unwrap();
        }
    }
    assert!(
        carried.join("LICENSE").is_file(),
        "the plugin travels with its licence"
    );
    assert!(boopis_host::setup::install::install_runtime_plugins(&runtime, &hermes_home).unwrap());
    let listed = ops.plugins().await.unwrap();
    assert!(
        listed
            .iter()
            .any(|p| p.name == boopis_host::claude::PROVIDER_ID && p.enabled),
        "{listed:?}"
    );
    assert!(
        !hermes_home
            .join("plugins")
            .join(".install-metadata.json")
            .exists(),
        "nothing went through the engine's installer"
    );
}
