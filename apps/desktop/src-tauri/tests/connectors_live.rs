//! The connector flow against a real, unmodified Hermes: a stdio test MCP server is added, tested, switched off and on, and
//! removed through the same engine the app uses (`mcp.servers.*` on a real gateway, and Hermes's CLI). A second test adds
//! one that needs a key: the key goes to the keychain (a map here), the host's secret channel serves it to the gateway the
//! engine restarts, and the server only starts when the key reached it. Skips cleanly unless `HX_E2E_HERMES_ENV` names the
//! spike install and `python3` runs. Never runs an installer; the gateway it starts is stopped when the test ends.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines
)] // a test: failing loudly is the point

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use boopis_host::config::Limits;
use boopis_host::connectors::{Engine, GatewayMcp, McpOps, Opener, Request, SourceKind};
use boopis_host::error::Result;
use boopis_host::hermes::{Environment, Supervisor};
use boopis_host::secrets::refs::SecretRef;
use boopis_host::secrets::{Auth, PeerPolicy, SecretStore, channel};
use boopis_host::setup::install::install_plugin;
use boopis_host::setup::ops::{CliOps, HermesOps};
use sha2::{Digest, Sha256};

const KEY: &str = "fake-live-key-0123456789abcdef";

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

struct NoBrowser;
impl Opener for NoBrowser {
    fn open(&self, _url: &str) -> Result<()> {
        panic!("no sign-in is part of this test");
    }
}

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

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Every `bin` directory of the spike that has a `hermes` launcher. Which install a launcher actually runs is Hermes's choice
/// (its bootstrap puts the active install's packages on the path), so the rig tries them until one has the `mcp` SDK.
fn hermes_bins(spike: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(installs) = std::fs::read_dir(spike.join("hermes-home/installs")) else {
        return out;
    };
    for install in installs.flatten() {
        let Ok(envs) = std::fs::read_dir(install.path().join("environments")) else {
            continue;
        };
        for env in envs.flatten() {
            let bin = env.path().join("venv/bin");
            if bin.join("hermes").is_file() {
                out.push(bin);
            }
        }
    }
    out.sort();
    out
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

fn req(kv: &[(&str, &str)]) -> Request {
    Request {
        source: SourceKind::Command,
        values: kv
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
    }
}

struct Rig {
    // Dropped first: the gateway is stopped while its home still exists.
    _guard: GatewayGuard,
    _channel: Option<boopis_host::secrets::SecretChannel>,
    scratch: tempfile::TempDir,
    hermes_home: PathBuf,
    sup: Arc<Supervisor>,
    engine: Engine,
    keys: Arc<Map>,
    script: String,
}

async fn rig() -> Option<Rig> {
    let spike = PathBuf::from(std::env::var_os("HX_E2E_HERMES_ENV")?);
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init();
    if Command::new("python3").arg("--version").output().is_err() {
        eprintln!("skipped: no python3");
        return None;
    }
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
        r#"{"updates": {"check": false}, "model_catalog": {"enabled": false}}"#,
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
    // Hermes's MCP client needs the `mcp` Python SDK. The shipped runtime carries it (its default extras are
    // `anthropic,mcp,uvloop`); a spike install made without that extra does not, and then these tests skip
    // (`uv pip install --python <venv>/bin/python mcp==2.3.0`, the version Hermes's lock pins, into the install the launcher runs).
    let has_mcp = |bin: &Path| {
        Command::new(bin.join("python"))
            .args(["-c", "import hermes_bootstrap, importlib.util, sys; sys.exit(0 if importlib.util.find_spec('mcp') else 1)"])
            .env("HERMES_HOME", &hermes_home)
            .envs(child_env.iter().map(|(k, v)| (k, v)))
            .current_dir(&home)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    };
    let Some(bin) = hermes_bins(&spike).into_iter().find(|b| has_mcp(b)) else {
        eprintln!(
            "skipped: no Hermes install under HX_E2E_HERMES_ENV has the `mcp` Python SDK, so none can run an MCP server"
        );
        return None;
    };
    // The launcher decides the path Hermes finds itself on; the supervisor needs it first.
    let env = Environment {
        hermes_home: Some(hermes_home.display().to_string()),
        home_dir: Some(home.clone()),
        path: Some(std::ffi::OsString::from(&bin)),
        ..Environment::default()
    };
    let auth = Auth::mint_in(&root.path().join("run")).expect("a channel token");
    let peers = Arc::new(PeerPolicy::new());
    let sup = Arc::new(
        Supervisor::new(env, Limits::default())
            .with_child_env(child_env.clone())
            .with_secret_channel(auth.launch_env(), peers.clone()),
    );
    let keys = Arc::new(Map::default());
    let channel = channel::start(keys.clone(), &auth, peers)
        .await
        .expect("the secret channel starts");
    let guard = GatewayGuard {
        hermes: bin.join("hermes"),
        home: hermes_home.clone(),
        env: child_env,
    };
    let ops = GatewayMcp::new(sup.clone(), hermes_home.clone());
    let engine = Engine::new(
        Arc::new(ops),
        keys.clone(),
        Arc::new(NoBrowser),
        Limits::default(),
    );
    let script = repo()
        .join("tests/e2e/fake_mcp_stdio.py")
        .display()
        .to_string();
    Some(Rig {
        scratch: root,
        hermes_home,
        sup,
        engine,
        keys,
        _guard: guard,
        _channel: Some(channel),
        script,
    })
}

/// The tail of Hermes's own logs, for a failure message.
fn logs_tail(r: &Rig) -> String {
    let mut out = String::new();
    for f in walk(&r.hermes_home.join("logs")) {
        if let Ok(t) = std::fs::read_to_string(&f) {
            let lines: Vec<&str> = t
                .lines()
                .filter(|l| {
                    l.contains("secret")
                        || l.contains("boopis")
                        || l.contains("mcp")
                        || l.contains("WARN")
                        || l.contains("ERROR")
                })
                .collect();
            let from = lines.len().saturating_sub(25);
            let _ = writeln!(out, "--- {}\n{}", f.display(), lines[from..].join("\n"));
        }
    }
    out
}

fn config_text(r: &Rig) -> String {
    std::fs::read_to_string(r.hermes_home.join("config.yaml")).unwrap_or_default()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn adding_testing_switching_and_removing_a_stdio_server_through_a_real_hermes() {
    let Some(r) = rig().await else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run the connector flow against a real Hermes"
        );
        return;
    };
    let request = req(&[
        ("name", "fakemcp"),
        ("command", "python3"),
        ("args", &format!("{}\n--no-op", r.script)),
    ]);
    let review = r.engine.review(&request).await.unwrap();
    assert!(
        review
            .form
            .diff
            .iter()
            .any(|d| d.key == "mcp_servers.fakemcp.command"),
        "the diff shows the command"
    );

    // Add, then Hermes's own connection test, with its result.
    let report = r
        .engine
        .install(&request, &review.plan_hash, &BTreeMap::new(), None)
        .await
        .expect("installs");
    let test = report.test.expect("a test ran");
    assert!(test.ok, "Hermes connected: {test:?} {:?}", report.steps);
    assert_eq!(
        test.tools
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>(),
        vec!["echo"]
    );
    assert!(!report.restarted, "no key, no restart");
    assert!(
        config_text(&r).contains("fakemcp"),
        "Hermes wrote it to its own config: {}",
        config_text(&r)
    );

    let ops = GatewayMcp::new(r.sup.clone(), r.hermes_home.clone());
    assert_eq!(
        ops.running_turns().await.unwrap(),
        0,
        "Hermes's own `session.active_list`: no session has work in flight"
    );
    let listed = r.engine.list().await.unwrap();
    let me = listed.iter().find(|i| i.name == "fakemcp").expect("listed");
    assert_eq!((me.command.as_deref(), me.enabled), (Some("python3"), true));
    assert!(me.secrets.is_empty());

    // The same name again is Hermes's refusal in a stable code, and the first is untouched.
    let again = r
        .engine
        .install(&request, &review.plan_hash, &BTreeMap::new(), None)
        .await
        .unwrap_err();
    assert_eq!(again.code(), "hx.connectors.exists", "{again}");
    assert!(r.engine.test("fakemcp").await.unwrap().ok);

    // Switch off and on through Hermes's own configuration command.
    r.engine.set_enabled("fakemcp", false).await.unwrap();
    assert!(
        !r.engine
            .list()
            .await
            .unwrap()
            .iter()
            .find(|i| i.name == "fakemcp")
            .unwrap()
            .enabled
    );
    r.engine.set_enabled("fakemcp", true).await.unwrap();
    assert!(
        r.engine
            .list()
            .await
            .unwrap()
            .iter()
            .find(|i| i.name == "fakemcp")
            .unwrap()
            .enabled
    );

    // Remove.
    let removed = r.engine.remove("fakemcp", false).await.unwrap();
    assert!(removed.kept_credentials.is_empty());
    assert!(
        r.engine
            .list()
            .await
            .unwrap()
            .iter()
            .all(|i| i.name != "fakemcp")
    );
    assert!(
        !config_text(&r).contains("fakemcp"),
        "gone from Hermes's config: {}",
        config_text(&r)
    );
    assert_eq!(
        r.engine.test("fakemcp").await.unwrap_err().code(),
        "hx.connectors.not_found"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_key_reaches_the_server_through_the_keychain_and_hermes_secret_source_and_never_a_file() {
    let Some(r) = rig().await else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run the connector flow against a real Hermes"
        );
        return;
    };
    // The plugin carries the secret source the key travels through.
    install_plugin(&repo().join("plugins/boopis"), &r.hermes_home).expect("the plugin is copied");
    CliOps::new(r.sup.clone(), r.hermes_home.clone())
        .enable_plugin("boopis")
        .await
        .expect("enabled");

    let record = r.scratch.path().join("record.jsonl");
    let request = req(&[
        ("name", "keyed"),
        ("command", "python3"),
        (
            "args",
            &format!("{}\n--need-key\n--record\n{}", r.script, record.display()),
        ),
        ("key_env", "FAKE_API_KEY"),
    ]);
    let review = r.engine.review(&request).await.unwrap();
    assert!(
        review
            .form
            .contents
            .iter()
            .any(|(k, v)| k == "Restart" && v.contains("No session has a turn running")),
        "the review says it restarts Hermes: {:?}",
        review.form.contents
    );
    assert_eq!(
        review.form.schema.0["properties"]["key"]["x-secret-ref"],
        "secret://connector.keyed/key"
    );

    let secrets: BTreeMap<String, String> = [("key".to_owned(), KEY.to_owned())].into();
    let report = r
        .engine
        .install(&request, &review.plan_hash, &secrets, None)
        .await
        .expect("installs");
    assert!(
        report.restarted,
        "Hermes restarted to read the key: {:?}",
        report.steps
    );
    let test = report.test.as_ref().expect("a test ran");
    assert!(
        test.ok,
        "the server only starts when the key reached it: {test:?} {:?}\n{}\n{}",
        report.steps,
        config_text(&r),
        logs_tail(&r)
    );

    // The server saw the key (its hash matches), and the key is in no file and no report.
    let seen: Vec<serde_json::Value> = std::fs::read_to_string(&record)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let want = hex::encode(Sha256::digest(KEY.as_bytes()));
    assert!(
        seen.iter()
            .any(|s| s["key_present"] == true && s["key_sha256"] == want.as_str()),
        "{seen:?}"
    );
    let reference = SecretRef::parse("secret://connector.keyed/key").unwrap();
    assert_eq!(
        r.keys.get(&reference.service(), "key").unwrap().as_deref(),
        Some(KEY)
    );
    assert!(
        config_text(&r).contains(&reference.env_name()),
        "the config holds the reference"
    );
    for f in walk(&r.hermes_home) {
        if f.starts_with(r.hermes_home.join("installs")) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&f) {
            assert!(
                !text.contains(KEY),
                "the key must not be in {}",
                f.display()
            );
        }
    }
    assert!(!format!("{report:?}").contains(KEY));
    assert_eq!(
        r.engine
            .list()
            .await
            .unwrap()
            .iter()
            .find(|i| i.name == "keyed")
            .unwrap()
            .secrets,
        vec![reference.text()]
    );

    // Removing keeps the key unless the user agrees; agreeing deletes it and unwires it.
    let kept = r.engine.remove("keyed", false).await.unwrap();
    assert_eq!(kept.kept_credentials, vec![reference.text()]);
    assert!(r.keys.get(&reference.service(), "key").unwrap().is_some());
    let ops = GatewayMcp::new(r.sup.clone(), r.hermes_home.clone());
    assert!(
        ops.config_get("secrets.boopis_host.env")
            .await
            .unwrap()
            .is_some_and(|v| v.as_object().is_some_and(|o| !o.is_empty())),
        "the wiring stays while the key stays"
    );
    let secrets: BTreeMap<String, String> = [("key".to_owned(), KEY.to_owned())].into();
    r.engine
        .install(&request, &review.plan_hash, &secrets, None)
        .await
        .expect("installs again");
    let gone = r.engine.remove("keyed", true).await.unwrap();
    assert_eq!(gone.deleted_credentials, vec![reference.text()]);
    assert!(r.keys.get(&reference.service(), "key").unwrap().is_none());
    assert!(
        !config_text(&r).contains(&reference.env_name()),
        "unwired: {}",
        config_text(&r)
    );
}

// ---------------------------------------------------------------- OAuth: Hermes's own flow, a fake authorization server

/// A fake MCP server with its own OAuth authorization server (`tests/e2e/fake_mcp_oauth.py`), stopped when dropped.
struct FakeOauth {
    child: std::process::Child,
    url: String,
}

impl FakeOauth {
    fn start() -> Self {
        let mut child = Command::new("python3")
            .arg(repo().join("tests/e2e/fake_mcp_oauth.py"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("python3 starts the fake server");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let url = serde_json::from_str::<serde_json::Value>(line.trim()).unwrap()["url"]
            .as_str()
            .unwrap()
            .to_owned();
        Self { child, url }
    }
    fn stats(&self) -> serde_json::Value {
        let (_, _, body) = http_get(&format!("{}/_stats", self.url)).expect("stats");
        serde_json::from_str(&body).unwrap()
    }
}

impl Drop for FakeOauth {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

/// One `GET` on loopback, no redirects followed: `(status, Location, body)`.
fn http_get(url: &str) -> std::io::Result<(u16, Option<String>, String)> {
    let rest = url.strip_prefix("http://").expect("an http URL");
    let (host, path) = rest
        .split_once('/')
        .map_or((rest, "/".to_owned()), |(h, p)| (h, format!("/{p}")));
    assert!(
        host.starts_with("127.0.0.1:") || host.starts_with("localhost:"),
        "the test browser only dials loopback: {host}"
    );
    let mut s = TcpStream::connect(host)?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(10)))?;
    write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )?;
    let mut raw = String::new();
    s.read_to_string(&mut raw)?;
    let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((&raw, ""));
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let location = head
        .lines()
        .find_map(|l| {
            l.strip_prefix("Location: ")
                .or_else(|| l.strip_prefix("location: "))
        })
        .map(str::to_owned);
    Ok((status, location, body.to_owned()))
}

#[derive(Clone, Copy)]
enum Browser {
    /// The redirect comes back with a `state` that is not the one Hermes made.
    WrongState,
    /// Follows it as a person does, then sends the same callback again.
    Twice,
}

/// A browser that acts on what it is asked to open and records what Hermes's listener answered.
struct TestBrowser {
    mode: Browser,
    log: Arc<Mutex<Vec<String>>>,
}

impl Opener for TestBrowser {
    fn open(&self, url: &str) -> Result<()> {
        let (status, location, _) = http_get(url).expect("the authorization server answers");
        assert_eq!(status, 302, "the authorization server redirects back");
        let mut back = location.expect("a Location");
        if matches!(self.mode, Browser::WrongState) {
            back = back.replace("state=", "state=forged-");
        }
        let first =
            http_get(&back).map_or_else(|e| format!("refused: {e}"), |(c, _, _)| c.to_string());
        self.log.lock().unwrap().push(first);
        if matches!(self.mode, Browser::Twice) {
            // The listener is one-shot: a second callback is refused or finds nothing listening.
            let again =
                http_get(&back).map_or_else(|e| format!("refused: {e}"), |(c, _, _)| c.to_string());
            self.log.lock().unwrap().push(again);
        }
        // Remember where Hermes listened, so the test can check it was closed.
        let q = url::Url::parse(url).unwrap();
        let redirect = q
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        self.log
            .lock()
            .unwrap()
            .push(format!("listener {redirect}"));
        Ok(())
    }
}

fn listener_of(log: &Arc<Mutex<Vec<String>>>) -> String {
    log.lock()
        .unwrap()
        .iter()
        .find_map(|l| l.strip_prefix("listener ").map(str::to_owned))
        .expect("the browser saw the redirect address")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn oauth_sign_in_runs_through_hermes_own_flow_and_its_loopback_listener() {
    let Some(r) = rig().await else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run the connector flow against a real Hermes"
        );
        return;
    };
    let server = FakeOauth::start();
    let request = req_url("oauthfake", &format!("{}/mcp", server.url), "oauth");
    let review = r.engine.review(&request).await.unwrap();
    assert!(
        review
            .form
            .diff
            .iter()
            .any(|d| d.key == "mcp_servers.oauthfake.auth" && d.to == "oauth")
    );
    let report = r
        .engine
        .install(&request, &review.plan_hash, &BTreeMap::new(), None)
        .await
        .expect("installs");
    assert!(
        report.signin_needed,
        "Hermes says the server needs a sign-in: {:?} {:?}",
        report.test, report.steps
    );
    let listed = r.engine.list().await.unwrap();
    assert_eq!(
        listed
            .iter()
            .find(|i| i.name == "oauthfake")
            .unwrap()
            .auth
            .as_deref(),
        Some("oauth")
    );
    let tokens = r.hermes_home.join("mcp-tokens");

    // 1. A callback whose state is not Hermes's is refused by Hermes's listener, and nothing is exchanged: the flow ends only
    //    by the host's timeout, which cancels it and closes the listener.
    let log = Arc::new(Mutex::new(Vec::new()));
    let short = Limits {
        connector_signin_timeout: std::time::Duration::from_secs(8),
        connector_poll_every: std::time::Duration::from_millis(300),
        ..Limits::default()
    };
    let engine = Engine::new(
        Arc::new(GatewayMcp::new(r.sup.clone(), r.hermes_home.clone())),
        r.keys.clone(),
        Arc::new(TestBrowser {
            mode: Browser::WrongState,
            log: log.clone(),
        }),
        short,
    );
    let e = engine.signin("oauthfake").await.unwrap_err();
    assert_eq!(e.code(), "hx.connectors.signin_timeout", "{e}");
    assert_eq!(
        log.lock().unwrap()[0],
        "400",
        "Hermes's listener refused the forged state: {:?}",
        log.lock().unwrap()
    );
    assert_eq!(
        server.stats()["token_exchanges"],
        0,
        "no code was exchanged"
    );
    assert!(
        !tokens.join("oauthfake.json").exists(),
        "no token was stored"
    );
    let addr = listener_of(&log);
    let port = url::Url::parse(&addr).unwrap().port().unwrap();
    assert!(
        TcpStream::connect(("127.0.0.1", port)).is_err(),
        "cancelling the flow closed Hermes's loopback listener on {port}"
    );

    // 2. The right callback, twice: the first completes the flow, the second finds the listener gone or refuses it. One exchange.
    let log = Arc::new(Mutex::new(Vec::new()));
    let engine = Engine::new(
        Arc::new(GatewayMcp::new(r.sup.clone(), r.hermes_home.clone())),
        r.keys.clone(),
        Arc::new(TestBrowser {
            mode: Browser::Twice,
            log: log.clone(),
        }),
        Limits {
            connector_poll_every: std::time::Duration::from_millis(300),
            ..Limits::default()
        },
    );
    let done = engine
        .signin("oauthfake")
        .await
        .expect("the sign-in completes");
    assert_eq!(done.stored, "boopis's own token store");
    assert_eq!(done.tools, vec!["whoami"]);
    assert!(done.test.as_ref().is_some_and(|t| t.ok), "{:?}", done.test);
    let seen = log.lock().unwrap().clone();
    assert_eq!(seen[0], "200", "{seen:?}");
    assert!(
        seen[1] == "400" || seen[1].starts_with("refused"),
        "a second callback is not accepted: {seen:?}"
    );
    assert_eq!(
        server.stats()["token_exchanges"],
        1,
        "one exchange, whatever the browser did"
    );
    let stored = std::fs::read_to_string(tokens.join("oauthfake.json"))
        .expect("Hermes's own token store holds the result");
    assert!(stored.contains("access_token"));
    assert!(
        !format!("{done:?}").contains("tok-"),
        "the host never saw the token"
    );
    assert!(r.engine.test("oauthfake").await.unwrap().ok);

    // 3. Removing the server drops its tokens too (Hermes's own `mcp remove`).
    r.engine.remove("oauthfake", false).await.unwrap();
    assert!(
        !tokens.join("oauthfake.json").exists(),
        "the tokens went with the server"
    );
}

fn req_url(name: &str, url: &str, auth: &str) -> Request {
    Request {
        source: SourceKind::Url,
        values: [("name", name), ("url", url), ("auth", auth)]
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
    }
}
