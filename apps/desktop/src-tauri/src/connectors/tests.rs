//! The connector flow against an in-memory Hermes: what is written where, what is refused, what is undone, what never leaves
//! the keychain, and how a sign-in ends. The fake keeps what Hermes would keep (servers, configuration keys, how many
//! times it was restarted), so each test reads the outcome rather than the calls.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::engine::{Engine, Opener, RestartDone, RestartWhen, clean_line, login_env, scrub};
use super::ops::{Installed, McpOps, OAuthPoll, OAuthStart, TestReport, ToolInfo};
use super::plan::{Request, SourceKind};
use crate::config::Limits;
use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::refs::SecretRef;
use crate::secrets::store::MemoryStore;

#[derive(Default)]
#[allow(clippy::struct_excessive_bools)]
struct State {
    servers: BTreeMap<String, Value>,
    plugin_servers: Vec<String>,
    config: BTreeMap<String, String>,
    restarts: u32,
    removed: Vec<String>,
    started: u32,
    cancelled: Vec<String>,
    polls: Vec<OAuthPoll>,
    auth_url: String,
    test: Option<TestReport>,
    fail_config_set: bool,
    fail_restart: bool,
    running: u32,
    running_unknown: bool,
    restart_calls: Vec<bool>,
    busy_restarts: u32,
    tokens_present: bool,
    busy_starts: u32,
}

struct Fake(Mutex<State>);

impl Fake {
    fn new() -> Arc<Self> {
        Arc::new(Self(Mutex::new(State {
            auth_url: "https://auth.example.com/authorize?response_type=code&state=s1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fcallback".into(),
            ..State::default()
        })))
    }
    fn st(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
    fn ok_test(tools: &[&str]) -> TestReport {
        TestReport {
            ok: true,
            tools: tools
                .iter()
                .map(|t| ToolInfo {
                    name: (*t).into(),
                    description: String::new(),
                })
                .collect(),
            error: None,
            prompts: Some(0),
            resources: Some(0),
            oauth_needed: false,
            signin_needed: false,
        }
    }
}

#[async_trait]
impl McpOps for Fake {
    async fn list(&self) -> Result<Vec<Installed>> {
        let st = self.st();
        let mut out: Vec<Installed> = st
            .servers
            .iter()
            .map(|(n, c)| Installed {
                name: n.clone(),
                transport: if c.get("url").is_some() {
                    "http"
                } else {
                    "stdio"
                }
                .into(),
                url: c["url"].as_str().map(str::to_owned),
                command: c["command"].as_str().map(str::to_owned),
                auth: c["auth"].as_str().map(str::to_owned),
                oauth_tokens_present: (c["auth"] == "oauth").then_some(st.tokens_present),
                enabled: c["enabled"] != json!(false),
                status: "configured".into(),
                ..Installed::default()
            })
            .collect();
        out.extend(st.plugin_servers.iter().map(|n| Installed {
            name: n.clone(),
            plugin: Some("p".into()),
            enabled: true,
            status: "configured".into(),
            ..Installed::default()
        }));
        Ok(out)
    }
    async fn add(&self, name: &str, config: &Value) -> Result<()> {
        let mut st = self.st();
        if st.servers.contains_key(name) {
            return Err(Error::Connector("hx.connectors.exists", "exists".into()));
        }
        st.servers.insert(name.to_owned(), config.clone());
        Ok(())
    }
    async fn test(&self, _name: &str) -> Result<TestReport> {
        Ok(self
            .st()
            .test
            .clone()
            .unwrap_or_else(|| Self::ok_test(&["a", "b"])))
    }
    async fn remove(&self, name: &str) -> Result<()> {
        let mut st = self.st();
        st.servers.remove(name);
        st.removed.push(name.to_owned());
        Ok(())
    }
    async fn set_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        if let Some(c) = self.st().servers.get_mut(name) {
            c["enabled"] = json!(enabled);
        }
        Ok(())
    }
    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let st = self.st();
        let prefix = format!("{key}.");
        let m: serde_json::Map<String, Value> = st
            .config
            .iter()
            .filter_map(|(k, v)| k.strip_prefix(&prefix).map(|r| (r.to_owned(), json!(v))))
            .collect();
        Ok((!m.is_empty()).then_some(Value::Object(m)))
    }
    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        let mut st = self.st();
        if st.fail_config_set {
            return Err(Error::Connector("hx.connectors.failed", "refused".into()));
        }
        st.config.insert(key.to_owned(), value.to_owned());
        Ok(())
    }
    async fn config_unset(&self, key: &str) -> Result<()> {
        self.st().config.remove(key);
        Ok(())
    }
    async fn running_turns(&self) -> Result<u32> {
        let st = self.st();
        if st.running_unknown {
            return Err(Error::Unavailable("no gateway".into()));
        }
        Ok(st.running)
    }
    async fn hermes_program(&self) -> Result<Option<(std::path::PathBuf, std::path::PathBuf)>> {
        Ok(Some(("/usr/bin/printf".into(), "/h".into())))
    }
    async fn restart_gateway(&self, interrupt: bool) -> Result<()> {
        let mut st = self.st();
        st.restart_calls.push(interrupt);
        if !interrupt && st.busy_restarts > 0 {
            st.busy_restarts -= 1;
            return Err(Error::Connector("hx.connectors.busy", "busy".into()));
        }
        if st.fail_restart {
            return Err(Error::Unavailable("no gateway".into()));
        }
        st.restarts += 1;
        Ok(())
    }
    async fn oauth_start(&self, name: &str) -> Result<OAuthStart> {
        let mut st = self.st();
        if st.busy_starts > 0 {
            st.busy_starts -= 1;
            return Err(Error::Connector(
                "hx.connectors.failed",
                format!("mcp.servers.oauth.start: MCP OAuth for '{name}' is already in progress"),
            ));
        }
        st.started += 1;
        Ok(OAuthStart {
            session_id: "flow-1".into(),
            auth_url: st.auth_url.clone(),
        })
    }
    async fn oauth_poll(&self, _name: &str, _session_id: &str) -> Result<OAuthPoll> {
        let mut st = self.st();
        Ok(if st.polls.is_empty() {
            OAuthPoll::Pending
        } else {
            st.polls.remove(0)
        })
    }
    async fn oauth_cancel(&self, name: &str, _session_id: &str) -> Result<()> {
        self.st().cancelled.push(name.to_owned());
        Ok(())
    }
}

struct Browser {
    opened: Mutex<Vec<String>>,
    fail: bool,
}
impl Opener for Browser {
    fn open(&self, url: &str) -> Result<()> {
        if self.fail {
            return Err(Error::Os("no browser".into()));
        }
        self.opened
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(url.to_owned());
        Ok(())
    }
}

struct Rig {
    hermes: Arc<Fake>,
    keys: Arc<MemoryStore>,
    browser: Arc<Browser>,
    engine: Arc<Engine>,
}

fn rig_with(limits: Limits, browser_fails: bool) -> Rig {
    let hermes = Fake::new();
    let keys = Arc::new(MemoryStore::default());
    let browser = Arc::new(Browser {
        opened: Mutex::new(Vec::new()),
        fail: browser_fails,
    });
    let engine = Arc::new(Engine::new(
        hermes.clone(),
        keys.clone(),
        browser.clone(),
        limits,
    ));
    Rig {
        hermes,
        keys,
        browser,
        engine,
    }
}

fn rig() -> Rig {
    rig_with(
        Limits {
            connector_poll_every: Duration::from_millis(5),
            ..Limits::default()
        },
        false,
    )
}

fn req(source: SourceKind, kv: &[(&str, &str)]) -> Request {
    Request {
        source,
        values: kv
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
    }
}

fn firecrawl_package() -> Request {
    req(
        SourceKind::Catalog,
        &[("connector", "firecrawl"), ("variant", "package")],
    )
}

fn hash(r: &Request) -> String {
    super::plan::review(r).unwrap().plan_hash
}

fn keys_of(v: &[(&str, &str)]) -> BTreeMap<String, String> {
    v.iter()
        .map(|(k, x)| ((*k).to_owned(), (*x).to_owned()))
        .collect()
}

const KEY: &str = "fc-live-SECRET-0123456789";

#[tokio::test]
async fn installing_with_a_key_stores_it_in_the_keychain_and_only_a_reference_in_hermes() {
    let r = rig();
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();

    let reference = SecretRef::parse("secret://connector.firecrawl/firecrawl_api_key").unwrap();
    assert_eq!(
        r.keys
            .get(&reference.service(), "firecrawl_api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    let st = r.hermes.st();
    let stored = st.servers["firecrawl"].to_string();
    assert!(
        stored.contains(&format!("${{{}}}", reference.env_name())),
        "{stored}"
    );
    assert!(
        !stored.contains(KEY),
        "the key is in no configuration Hermes holds"
    );
    assert!(
        !format!("{:?} {:?}", st.config, report).contains(KEY),
        "nor in a wire, a step or the report"
    );
    assert_eq!(
        st.config[&format!("secrets.boopis_host.env.{}", reference.env_name())],
        reference.text()
    );
    assert_eq!(st.config["secrets.boopis_host.enabled"], "true");
    assert_eq!(
        st.restarts, 1,
        "Hermes reads its secret sources once per process"
    );
    drop(st);
    assert!(report.restarted);
    assert_eq!(report.test.as_ref().unwrap().tools.len(), 2);
    assert!(
        report
            .steps
            .iter()
            .all(|s| s.state == crate::setup::StepState::Done),
        "{:?}",
        report.steps
    );
    assert!(report.notes.iter().any(|n| n.contains("prompt cache")));
}

#[tokio::test]
async fn an_install_without_keys_wires_nothing_and_restarts_nothing() {
    let r = rig();
    let request = req(
        SourceKind::Command,
        &[
            ("name", "mine"),
            ("command", "npx"),
            ("args", "-y\nfoo@1.0.0"),
        ],
    );
    let report = r
        .engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    let st = r.hermes.st();
    assert_eq!(
        st.servers["mine"],
        json!({"command": "npx", "args": ["-y", "foo@1.0.0"]})
    );
    assert!(st.config.is_empty());
    assert_eq!(st.restarts, 0);
    assert!(!report.restarted);
}

#[tokio::test]
async fn an_install_must_name_the_hash_of_what_was_shown() {
    let r = rig();
    let request = firecrawl_package();
    let e = r
        .engine
        .install(
            &request,
            "0000",
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.plan_changed");
    assert!(r.hermes.st().servers.is_empty(), "nothing was added");
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_none(),
        "nothing was saved"
    );
    // a different request, the first one's hash
    let other = req(
        SourceKind::Command,
        &[("name", "mine"), ("command", "npx"), ("args", "foo@2")],
    );
    let e = r
        .engine
        .install(&other, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.plan_changed");
}

#[tokio::test]
async fn a_required_key_that_is_missing_stops_everything_before_hermes_is_touched() {
    let r = rig();
    let request = firecrawl_package();
    let e = r
        .engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.secret_missing");
    assert!(r.hermes.st().servers.is_empty());
    let e = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY), ("nonsense", "x")]),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.invalid_params");
}

#[tokio::test]
async fn an_optional_key_left_out_leaves_the_header_out() {
    let r = rig();
    let request = req(
        SourceKind::Catalog,
        &[
            ("connector", "firecrawl"),
            ("variant", "hosted"),
            ("auth", "key"),
        ],
    );
    r.engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    assert!(r.hermes.st().servers["firecrawl"].get("headers").is_none());
    assert!(r.hermes.st().config.is_empty());
}

#[tokio::test]
async fn a_name_that_is_taken_is_refused_and_nothing_else_changes() {
    let r = rig();
    let request = req(
        SourceKind::Command,
        &[("name", "mine"), ("command", "npx"), ("args", "foo@1")],
    );
    r.engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    let e = r
        .engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.exists");
    assert!(
        r.hermes.st().removed.is_empty(),
        "the first install is untouched"
    );
}

#[tokio::test]
async fn a_keychain_that_refuses_undoes_the_add() {
    let r = rig();
    r.keys.unavailable.store(true, Ordering::Relaxed);
    let request = firecrawl_package();
    let e = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.secrets.unavailable");
    let st = r.hermes.st();
    assert!(st.servers.is_empty(), "the server was removed again");
    assert_eq!(st.removed, vec!["firecrawl"]);
    assert!(st.config.is_empty());
}

#[tokio::test]
async fn a_failed_wire_undoes_the_server_and_deletes_the_key_it_saved() {
    let r = rig();
    r.hermes.st().fail_config_set = true;
    let request = firecrawl_package();
    let e = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.failed");
    assert!(r.hermes.st().servers.is_empty());
    r.keys.unavailable.store(false, Ordering::Relaxed);
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_none(),
        "the key is gone from the keychain"
    );
}

#[tokio::test]
async fn a_failed_restart_is_reported_and_the_install_stands() {
    let r = rig();
    r.hermes.st().fail_restart = true;
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    assert!(!report.restarted);
    assert!(report.notes.iter().any(|n| n.contains("Restart it")));
    assert!(r.hermes.st().servers.contains_key("firecrawl"));
}

#[tokio::test]
async fn a_failed_test_is_shown_and_a_key_in_its_words_is_masked() {
    let r = rig();
    r.hermes.st().test = Some(TestReport {
        ok: false,
        tools: vec![],
        error: Some(format!("401 for key {KEY}")),
        prompts: None,
        resources: None,
        oauth_needed: false,
        signin_needed: false,
    });
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    let t = report.test.unwrap();
    assert!(!t.ok);
    assert!(!t.error.as_deref().unwrap().contains(KEY), "{t:?}");
    assert!(t.error.as_deref().unwrap().contains("***"));
    assert!(!report.signin_needed);
    assert_eq!(
        scrub("a KEY b", &["KEY"]),
        "a KEY b",
        "a value shorter than 4 is left alone: it would eat ordinary words"
    );
}

#[tokio::test]
async fn an_oauth_connector_ends_the_install_asking_for_a_sign_in() {
    let r = rig();
    r.hermes.st().test = Some(TestReport {
        ok: false,
        tools: vec![],
        error: Some("OAuth authentication required".into()),
        prompts: None,
        resources: None,
        oauth_needed: true,
        signin_needed: true,
    });
    let request = req(
        SourceKind::Catalog,
        &[("connector", "firecrawl"), ("variant", "hosted")],
    );
    let report = r
        .engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    assert!(report.signin_needed);
    assert_eq!(
        report.steps.last().unwrap().state,
        crate::setup::StepState::NeedsInput
    );
    assert_eq!(r.hermes.st().servers["firecrawl"]["auth"], "oauth");
}

#[tokio::test]
async fn a_server_that_cannot_be_installed_by_the_validators_never_reaches_hermes() {
    let r = rig();
    for (kv, source) in [
        (
            vec![("name", "a"), ("url", "http://evil.example/mcp")],
            SourceKind::Url,
        ),
        (
            vec![("name", "a"), ("command", "bash"), ("args", "-c\nid")],
            SourceKind::Command,
        ),
        (
            vec![("name", "a"), ("command", "npx -y x")],
            SourceKind::Command,
        ),
    ] {
        assert!(super::plan::review(&req(source, &kv)).is_err(), "{kv:?}");
    }
    assert!(r.hermes.st().servers.is_empty());
}

#[tokio::test]
async fn removing_keeps_the_keys_unless_the_user_agrees_to_delete_them() {
    let r = rig();
    let request = firecrawl_package();
    r.engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    let listed = r.engine.list().await.unwrap();
    assert_eq!(
        listed[0].secrets,
        vec!["secret://connector.firecrawl/firecrawl_api_key"],
        "the list names the keys boopis holds"
    );

    let kept = r.engine.remove("firecrawl", false).await.unwrap();
    assert_eq!(kept.kept_credentials.len(), 1);
    assert!(kept.deleted_credentials.is_empty());
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_some()
    );
    assert!(
        kept.notes
            .iter()
            .any(|n| n.contains("still in your keychain"))
    );

    // install again and agree to delete
    r.engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    let gone = r.engine.remove("firecrawl", true).await.unwrap();
    assert_eq!(
        gone.deleted_credentials,
        vec!["secret://connector.firecrawl/firecrawl_api_key"]
    );
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_none()
    );
    assert!(
        !r.hermes
            .st()
            .config
            .keys()
            .any(|k| k.starts_with("secrets.boopis_host.env.")),
        "the wiring is unset too"
    );
    assert!(r.hermes.st().servers.is_empty());
}

#[tokio::test]
async fn a_remove_leaves_another_connectors_keys_alone() {
    let r = rig();
    let a = firecrawl_package();
    r.engine
        .install(&a, &hash(&a), &keys_of(&[("firecrawl_api_key", KEY)]), None)
        .await
        .unwrap();
    let b = req(
        SourceKind::Command,
        &[
            ("name", "other"),
            ("command", "npx"),
            ("args", "x@1"),
            ("key_env", "X_API_KEY"),
        ],
    );
    r.engine
        .install(
            &b,
            &hash(&b),
            &keys_of(&[("key", "other-secret-value")]),
            None,
        )
        .await
        .unwrap();
    r.engine.remove("other", true).await.unwrap();
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_some()
    );
    assert!(
        r.keys
            .get("boopis.connector.other", "key")
            .unwrap()
            .is_none()
    );
    assert!(r.hermes.st().servers.contains_key("firecrawl"));
}

#[tokio::test]
async fn a_plugins_server_and_an_unknown_one_are_not_changed_from_here() {
    let r = rig();
    r.hermes.st().plugin_servers.push("fromplugin".into());
    assert_eq!(
        r.engine
            .remove("fromplugin", false)
            .await
            .unwrap_err()
            .code(),
        "hx.connectors.plugin_owned"
    );
    assert_eq!(
        r.engine
            .set_enabled("fromplugin", false)
            .await
            .unwrap_err()
            .code(),
        "hx.connectors.plugin_owned"
    );
    assert_eq!(
        r.engine.remove("nothing", false).await.unwrap_err().code(),
        "hx.connectors.not_found"
    );
    assert_eq!(
        r.engine.test("nothing").await.unwrap_err().code(),
        "hx.connectors.not_found"
    );
    assert!(
        r.engine.set_enabled("a.b", true).await.is_err(),
        "a dotted name would split the config key"
    );
    assert!(r.engine.remove("a b", false).await.is_err());
}

#[tokio::test]
async fn switching_off_and_on_goes_through_hermes() {
    let r = rig();
    let request = req(
        SourceKind::Command,
        &[("name", "mine"), ("command", "npx"), ("args", "foo@1")],
    );
    r.engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    r.engine.set_enabled("mine", false).await.unwrap();
    assert!(!r.engine.list().await.unwrap()[0].enabled);
    r.engine.set_enabled("mine", true).await.unwrap();
    assert!(r.engine.list().await.unwrap()[0].enabled);
    assert!(r.engine.test("mine").await.unwrap().ok);
}

// ---------------------------------------------------------------- sign-in (Hermes's OAuth)

async fn oauth_server(r: &Rig) {
    let request = req(
        SourceKind::Url,
        &[
            ("name", "linear"),
            ("url", "https://mcp.linear.example/mcp"),
            ("auth", "oauth"),
        ],
    );
    r.engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_sign_in_opens_hermes_page_waits_and_reports_where_the_tokens_are() {
    let r = rig();
    oauth_server(&r).await;
    r.hermes.st().polls = vec![
        OAuthPoll::Pending,
        OAuthPoll::Pending,
        OAuthPoll::Approved(vec!["issues".into()]),
    ];
    let report = r.engine.signin("linear").await.unwrap();
    assert_eq!(report.tools, vec!["issues"]);
    assert_eq!(report.stored, "Hermes's own token store");
    assert!(report.test.unwrap().ok);
    let opened = r.browser.opened.lock().unwrap().clone();
    assert_eq!(opened.len(), 1);
    assert!(
        opened[0].starts_with("https://auth.example.com/authorize?"),
        "{opened:?}"
    );
    assert_eq!(r.hermes.st().started, 1);
    assert!(
        r.hermes.st().cancelled.is_empty(),
        "a finished flow is not cancelled"
    );
}

#[tokio::test]
async fn a_sign_in_address_the_host_would_not_open_is_refused_and_the_flow_cancelled() {
    for url in [
        "http://auth.example.com/authorize?state=s",
        "https://auth.example.com/authorize?state=s&redirect_uri=https%3A%2F%2Fevil.example%2Fcb",
        "https://auth.example.com/authorize",
        "javascript:alert(1)",
    ] {
        let r = rig();
        oauth_server(&r).await;
        r.hermes.st().auth_url = url.into();
        let e = r.engine.signin("linear").await.unwrap_err();
        assert_eq!(e.code(), "hx.invalid_params", "{url}");
        assert!(
            r.browser.opened.lock().unwrap().is_empty(),
            "{url}: nothing was opened"
        );
        assert_eq!(
            r.hermes.st().cancelled,
            vec!["linear"],
            "{url}: Hermes's listener was closed"
        );
    }
}

#[tokio::test]
async fn a_browser_that_will_not_open_cancels_the_flow() {
    let r = rig_with(
        Limits {
            connector_poll_every: Duration::from_millis(5),
            ..Limits::default()
        },
        true,
    );
    oauth_server(&r).await;
    assert_eq!(
        r.engine.signin("linear").await.unwrap_err().code(),
        "hx.host.os"
    );
    assert_eq!(r.hermes.st().cancelled, vec!["linear"]);
}

#[tokio::test]
async fn hermes_reason_for_a_failed_sign_in_is_what_the_user_reads() {
    let r = rig();
    oauth_server(&r).await;
    r.hermes.st().polls = vec![OAuthPoll::Failed(
        "OAuth callback state mismatch\u{7}".into(),
    )];
    let e = r.engine.signin("linear").await.unwrap_err();
    assert_eq!(e.code(), "hx.connectors.signin_failed");
    assert_eq!(e.to_string(), "OAuth callback state mismatch");
    // and the slot is free again: a second try starts a new flow
    r.hermes.st().polls = vec![OAuthPoll::Approved(vec![])];
    r.engine.signin("linear").await.unwrap();
    assert_eq!(r.hermes.st().started, 2);
}

#[tokio::test(start_paused = true)]
async fn a_sign_in_that_the_browser_never_finishes_times_out_and_is_cancelled() {
    let r = rig_with(
        Limits {
            connector_signin_timeout: Duration::from_mins(1),
            connector_poll_every: Duration::from_secs(1),
            ..Limits::default()
        },
        false,
    );
    oauth_server(&r).await;
    let e = r.engine.signin("linear").await.unwrap_err();
    assert_eq!(e.code(), "hx.connectors.signin_timeout");
    assert_eq!(
        r.hermes.st().cancelled,
        vec!["linear"],
        "cancelling closes Hermes's loopback listener"
    );
}

#[tokio::test(start_paused = true)]
async fn the_user_can_cancel_a_sign_in_and_only_one_runs_per_server() {
    let r = rig();
    oauth_server(&r).await;
    let engine = r.engine.clone();
    let first = tokio::spawn(async move { engine.signin("linear").await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let second = r.engine.signin("linear").await.unwrap_err();
    assert_eq!(second.code(), "hx.connectors.failed");
    assert!(second.to_string().contains("already open"));
    r.engine.cancel_signin("linear");
    let e = first.await.unwrap().unwrap_err();
    assert_eq!(e.code(), "hx.connectors.signin_cancelled");
    assert_eq!(r.hermes.st().cancelled, vec!["linear"]);
}

#[tokio::test]
async fn only_an_oauth_server_signs_in() {
    let r = rig();
    let request = req(
        SourceKind::Command,
        &[("name", "mine"), ("command", "npx"), ("args", "foo@1")],
    );
    r.engine
        .install(&request, &hash(&request), &BTreeMap::new(), None)
        .await
        .unwrap();
    assert_eq!(
        r.engine.signin("mine").await.unwrap_err().code(),
        "hx.connectors.not_oauth"
    );
    assert_eq!(r.hermes.st().started, 0);
    assert_eq!(
        r.engine.signin("nothing").await.unwrap_err().code(),
        "hx.connectors.not_found"
    );
}

// ---------------------------------------------------------------- a provider's own login command

fn quick() -> Limits {
    Limits {
        login_timeout: Duration::from_secs(10),
        ..Limits::default()
    }
}

fn entry(id: &str, program: &str, args: &[&str]) -> super::logins::Login {
    super::logins::Login {
        id: id.into(),
        name: id.into(),
        program: program.into(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
    }
}

/// An engine over a table of made-up sign-ins that run harmless real programs.
fn login_rig(limits: Limits) -> Rig {
    let table = super::logins::LoginTable::new(vec![
        entry(
            "t-device",
            "printf",
            &["Open https://x.example/device\\nCode: ABCD-1234\\n"],
        ),
        entry("t-literal", "printf", &["%s", "$(id); echo pwned"]),
        entry("t-false", "false", &[]),
        entry("t-sleep", "sleep", &["30"]),
        entry(
            "t-lines",
            "printf",
            &["1\\n2\\n3\\n4\\naccess_token: abc.def\\n"],
        ),
        entry("t-hermes", "hermes", &["x"]),
    ]);
    let hermes = Fake::new();
    let keys = Arc::new(MemoryStore::default());
    let browser = Arc::new(Browser {
        opened: Mutex::new(Vec::new()),
        fail: false,
    });
    let engine = Arc::new(
        Engine::new(hermes.clone(), keys.clone(), browser.clone(), limits).with_logins(table),
    );
    Rig {
        hermes,
        keys,
        browser,
        engine,
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_known_provider_runs_exactly_the_tables_vector_and_its_result_is_reported() {
    let r = login_rig(quick());
    let ok = r.engine.login("t-device", None).await.unwrap();
    assert!(ok.ok && ok.code == Some(0));
    assert_eq!(
        ok.command_line,
        "printf 'Open https://x.example/device\\nCode: ABCD-1234\\n'"
    );
    assert_eq!(
        ok.output,
        vec!["Open https://x.example/device", "Code: ABCD-1234"]
    );

    // a metacharacter in the table's argument is an argument: nothing interprets it
    let literal = r.engine.login("t-literal", None).await.unwrap();
    assert_eq!(literal.output, vec!["$(id); echo pwned"]);

    let failed = r.engine.login("t-false", None).await.unwrap();
    assert!(!failed.ok && failed.code == Some(1) && !failed.timed_out);
}

#[cfg(unix)]
#[tokio::test]
async fn a_provider_outside_the_table_is_refused_and_nothing_runs() {
    let r = login_rig(quick());
    for id in [
        "curl",
        "claude",
        "sh",
        "bash",
        "env",
        "../../bin/sh",
        "t-device ; id",
        "T-DEVICE",
        "",
        "gcloud",
    ] {
        let e = r.engine.login(id, None).await.unwrap_err();
        assert_eq!(e.code(), "hx.connectors.unknown_login", "{id}");
        assert!(e.to_string().contains("not one boopis knows"), "{id}");
    }
    // a collection entry that names no login of its own offers none, and the host table is not consulted for it
    for (id, connector) in [
        ("t-device", "firecrawl"),
        ("gcloud", "firecrawl"),
        ("t-device", "nothing"),
    ] {
        assert_eq!(
            r.engine
                .login(id, Some(connector))
                .await
                .unwrap_err()
                .code(),
            "hx.connectors.unknown_login",
            "{id} {connector}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn the_hermes_entry_runs_the_hermes_the_host_runs_with_its_home() {
    let r = login_rig(quick());
    let report = r.engine.login("t-hermes", None).await.unwrap();
    assert!(report.ok);
    assert_eq!(
        report.command_line, "hermes x",
        "the card shows the entry, not a path"
    );
    assert_eq!(report.output, vec!["x"]);
}

#[cfg(unix)]
#[tokio::test]
async fn a_login_that_never_ends_is_stopped() {
    let r = login_rig(Limits {
        login_timeout: Duration::from_millis(300),
        ..Limits::default()
    });
    let report = r.engine.login("t-sleep", None).await.unwrap();
    assert!(report.timed_out && !report.ok && report.code.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn a_login_output_is_bounded_and_masked() {
    let r = login_rig(Limits {
        login_output_lines: 3,
        ..quick()
    });
    let report = r.engine.login("t-lines", None).await.unwrap();
    assert_eq!(report.output, vec!["3", "4", "access_token: ***"]);
}

#[test]
fn output_lines_lose_escape_sequences_and_credentials() {
    assert_eq!(clean_line("\u{1b}[32mSigned in\u{1b}[0m"), "Signed in");
    assert_eq!(
        clean_line("Authorization: Bearer abc.def.ghi"),
        "Authorization: Bearer ***"
    );
    assert_eq!(clean_line("refresh_token=xyz"), "refresh_token: ***");
    assert_eq!(clean_line("api_key = 'sk-1'"), "api_key: ***");
    assert_eq!(
        clean_line("Use this token page: https://x.example/device"),
        "Use this token page: https://x.example/device"
    );
    assert_eq!(clean_line("a\u{7}b"), "ab");
}

#[test]
fn a_login_command_gets_the_allowlisted_environment_and_no_keys() {
    for ok in [
        "PATH",
        "HOME",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "BROWSER",
        "HTTPS_PROXY",
    ] {
        assert!(login_env(ok), "{ok}");
    }
    for no in [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        "HERMES_HOME",
        "UV_CACHE_DIR",
        "BOOPIS_HOST_SECRETS_TOKEN",
        "SSH_AUTH_SOCK",
    ] {
        assert!(!login_env(no), "{no}");
    }
}

#[tokio::test]
async fn a_sign_in_started_just_after_a_cancel_waits_for_hermes_to_let_go_of_the_last_one() {
    let r = rig();
    oauth_server(&r).await;
    {
        let mut st = r.hermes.st();
        st.busy_starts = 3;
        st.polls = vec![OAuthPoll::Approved(vec!["issues".into()])];
    }
    let report = r.engine.signin("linear").await.unwrap();
    assert_eq!(report.tools, vec!["issues"]);
    assert_eq!(
        r.hermes.st().started,
        1,
        "Hermes began one flow, after its busy answers"
    );
}

#[tokio::test]
async fn a_sign_in_that_hermes_keeps_refusing_as_in_progress_says_so_after_the_wait() {
    let r = rig_with(
        Limits {
            connector_poll_every: Duration::from_millis(5),
            connector_start_wait: Duration::from_millis(40),
            ..Limits::default()
        },
        false,
    );
    oauth_server(&r).await;
    r.hermes.st().busy_starts = 10_000;
    let e = r.engine.signin("linear").await.unwrap_err();
    assert!(e.to_string().contains("already in progress"), "{e}");
    assert!(r.browser.opened.lock().unwrap().is_empty());
}

// ---------------------------------------------------------------- restarting Hermes for a key

fn notify_rig(limits: Limits) -> (Rig, Arc<Mutex<Vec<RestartDone>>>) {
    let hermes = Fake::new();
    let keys = Arc::new(MemoryStore::default());
    let browser = Arc::new(Browser {
        opened: Mutex::new(Vec::new()),
        fail: false,
    });
    let told = Arc::new(Mutex::new(Vec::new()));
    let sink = told.clone();
    let engine = Arc::new(
        Engine::new(hermes.clone(), keys.clone(), browser.clone(), limits)
            .with_notifier(Arc::new(move |d| sink.lock().unwrap().push(d))),
    );
    (
        Rig {
            hermes,
            keys,
            browser,
            engine,
        },
        told,
    )
}

fn fast() -> Limits {
    Limits {
        restart_poll_every: Duration::from_millis(5),
        restart_wait_max: Duration::from_secs(5),
        ..Limits::default()
    }
}

async fn until(what: &str, mut ok: impl FnMut() -> bool) {
    for _ in 0..400 {
        if ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("never happened: {what}");
}

fn nothing_changed(r: &Rig) -> bool {
    let st = r.hermes.st();
    st.servers.is_empty() && st.config.is_empty() && st.restart_calls.is_empty()
}

#[tokio::test]
async fn a_key_with_no_turn_running_restarts_hermes_at_once_without_ending_anything() {
    let r = rig();
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    assert!(report.restarted && !report.restart_pending);
    assert_eq!(
        r.hermes.st().restart_calls,
        vec![false],
        "asked not to interrupt: Hermes refuses if work has started since"
    );
}

#[tokio::test]
async fn a_key_while_a_turn_runs_changes_nothing_until_the_user_chooses_when() {
    for (running, unknown) in [(2, false), (1, false), (0, true)] {
        let r = rig();
        {
            let mut st = r.hermes.st();
            st.running = running;
            st.running_unknown = unknown;
        }
        let request = firecrawl_package();
        let e = r
            .engine
            .install(
                &request,
                &hash(&request),
                &keys_of(&[("firecrawl_api_key", KEY)]),
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(
            e.code(),
            "hx.connectors.restart_choice",
            "{running} {unknown}"
        );
        assert!(e.to_string().contains("restart"), "{e}");
        assert!(nothing_changed(&r), "no server, no wiring, no restart");
        assert!(
            r.keys
                .get("boopis.connector.firecrawl", "firecrawl_api_key")
                .unwrap()
                .is_none(),
            "no key saved"
        );
    }
}

#[tokio::test]
async fn restart_now_is_the_only_choice_that_ends_running_turns() {
    let r = rig();
    r.hermes.st().running = 3;
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            Some(RestartWhen::Now),
        )
        .await
        .unwrap();
    assert!(report.restarted);
    assert_eq!(r.hermes.st().restart_calls, vec![true]);
}

#[tokio::test]
async fn restart_when_idle_saves_the_key_now_then_waits_and_restarts_when_no_turn_runs() {
    let (r, told) = notify_rig(fast());
    r.hermes.st().running = 2;
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            Some(RestartWhen::WhenIdle),
        )
        .await
        .unwrap();
    assert!(report.restart_pending && !report.restarted);
    assert!(
        report.test.is_none(),
        "the connection is tested after the restart"
    );
    assert!(
        report
            .steps
            .iter()
            .any(|s| s.id == "restart" && s.state == crate::setup::StepState::Pending)
    );
    assert!(r.hermes.st().servers.contains_key("firecrawl"));
    assert!(
        r.keys
            .get("boopis.connector.firecrawl", "firecrawl_api_key")
            .unwrap()
            .is_some(),
        "the key is saved now"
    );
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert!(
        r.hermes.st().restart_calls.is_empty(),
        "never restarted while a turn runs"
    );
    assert!(told.lock().unwrap().is_empty());

    r.hermes.st().running = 0;
    until("the restart", || !told.lock().unwrap().is_empty()).await;
    assert_eq!(
        r.hermes.st().restart_calls,
        vec![false],
        "and without interrupting"
    );
    let done = told.lock().unwrap()[0].clone();
    assert!(done.ok && done.names == vec!["firecrawl"], "{done:?}");
    assert!(
        done.message.contains("firecrawl connected, 2 tools"),
        "{}",
        done.message
    );
    assert!(!done.message.contains(KEY));
}

#[tokio::test]
async fn an_idle_restart_waits_while_hermes_cannot_say_and_while_it_refuses_as_busy() {
    let (r, told) = notify_rig(fast());
    {
        let mut st = r.hermes.st();
        st.running = 1;
        st.busy_restarts = 2;
    }
    let request = firecrawl_package();
    r.engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            Some(RestartWhen::WhenIdle),
        )
        .await
        .unwrap();
    {
        let mut st = r.hermes.st();
        st.running = 0;
        st.running_unknown = true;
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        r.hermes.st().restart_calls.is_empty(),
        "an unknown answer is not an idle one"
    );
    r.hermes.st().running_unknown = false;
    until("the restart", || !told.lock().unwrap().is_empty()).await;
    let calls = r.hermes.st().restart_calls.clone();
    assert_eq!(
        calls,
        vec![false, false, false],
        "two busy refusals, then it went through: {calls:?}"
    );
    assert!(told.lock().unwrap()[0].ok);
}

#[tokio::test]
async fn one_waiter_restarts_once_for_every_connector_that_waits() {
    let (r, told) = notify_rig(fast());
    r.hermes.st().running = 1;
    let a = firecrawl_package();
    let b = req(
        SourceKind::Command,
        &[
            ("name", "other"),
            ("command", "npx"),
            ("args", "x@1"),
            ("key_env", "X_API_KEY"),
        ],
    );
    r.engine
        .install(
            &a,
            &hash(&a),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            Some(RestartWhen::WhenIdle),
        )
        .await
        .unwrap();
    r.engine
        .install(
            &b,
            &hash(&b),
            &keys_of(&[("key", "other-secret-value")]),
            Some(RestartWhen::WhenIdle),
        )
        .await
        .unwrap();
    r.hermes.st().running = 0;
    until("the restart", || !told.lock().unwrap().is_empty()).await;
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(r.hermes.st().restart_calls.len(), 1);
    let told = told.lock().unwrap();
    assert_eq!(told.len(), 1);
    assert_eq!(told[0].names, vec!["firecrawl", "other"]);
}

#[tokio::test]
async fn an_idle_restart_that_never_finds_a_quiet_moment_gives_up_and_says_the_key_is_saved() {
    let (r, told) = notify_rig(Limits {
        restart_wait_max: Duration::from_millis(80),
        ..fast()
    });
    r.hermes.st().running = 1;
    let request = firecrawl_package();
    r.engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            Some(RestartWhen::WhenIdle),
        )
        .await
        .unwrap();
    until("the notice", || !told.lock().unwrap().is_empty()).await;
    let done = told.lock().unwrap()[0].clone();
    assert!(
        !done.ok && done.message.contains("not restarted") && done.message.contains("key is saved"),
        "{done:?}"
    );
    assert!(r.hermes.st().restart_calls.is_empty());
}

#[tokio::test]
async fn a_gateway_that_turns_busy_between_the_check_and_the_restart_defers_instead_of_ending_the_turn()
 {
    let (r, told) = notify_rig(fast());
    r.hermes.st().busy_restarts = 1; // no turn at the check, work by the time Hermes is asked to stop
    let request = firecrawl_package();
    let report = r
        .engine
        .install(
            &request,
            &hash(&request),
            &keys_of(&[("firecrawl_api_key", KEY)]),
            None,
        )
        .await
        .unwrap();
    assert!(report.restart_pending && !report.restarted);
    until("the restart", || !told.lock().unwrap().is_empty()).await;
    assert!(
        r.hermes.st().restart_calls.iter().all(|i| !i),
        "never interrupting"
    );
}

#[tokio::test]
async fn the_review_says_boopis_restarts_hermes_and_how_many_turns_would_end_and_asks_when() {
    let request = firecrawl_package();
    let say = |r: &super::plan::Review| {
        r.form
            .contents
            .iter()
            .find(|(k, _)| k == "Restart")
            .map(|(_, v)| v.clone())
    };

    let r = rig();
    let quiet = r.engine.review(&request).await.unwrap();
    assert_eq!(
        say(&quiet).unwrap(),
        "boopis restarts Hermes to load the key. No session has a turn running, so it restarts at once."
    );
    assert!(
        quiet.form.schema.0["properties"]["restart"].is_null(),
        "no choice to make"
    );

    r.hermes.st().running = 2;
    let busy = r.engine.review(&request).await.unwrap();
    assert_eq!(
        say(&busy).unwrap(),
        "boopis restarts Hermes to load the key. 2 sessions have a turn running, and a restart would end them: you choose below."
    );
    let f = &busy.form.schema.0["properties"]["restart"];
    assert_eq!(f["enum"], json!(["when_idle", "now"]));
    assert_eq!(
        f["enumNames"],
        json!(["Install, restart when idle", "Install and restart now"])
    );
    assert_eq!(f["default"], "when_idle", "the safe choice is the default");
    assert!(
        busy.form.schema.0["required"]
            .as_array()
            .unwrap()
            .contains(&json!("restart"))
    );
    assert_eq!(
        busy.plan_hash, quiet.plan_hash,
        "the choice is not part of what the hash binds"
    );

    r.hermes.st().running = 1;
    assert!(
        say(&r.engine.review(&request).await.unwrap())
            .unwrap()
            .contains("1 session has a turn running, and a restart would end it")
    );
    r.hermes.st().running_unknown = true;
    let unknown = r.engine.review(&request).await.unwrap();
    assert!(
        say(&unknown)
            .unwrap()
            .contains("could not ask Hermes whether a turn is running")
    );
    assert!(unknown.form.schema.0["properties"]["restart"].is_object());

    // an optional key says "if", and a connector with no key says nothing about a restart
    let hosted = req(
        SourceKind::Catalog,
        &[
            ("connector", "firecrawl"),
            ("variant", "hosted"),
            ("auth", "key"),
        ],
    );
    assert!(
        say(&r.engine.review(&hosted).await.unwrap())
            .unwrap()
            .starts_with("If you give a key, boopis restarts Hermes to load it.")
    );
    let plain = req(
        SourceKind::Command,
        &[("name", "m"), ("command", "npx"), ("args", "x@1")],
    );
    assert!(say(&r.engine.review(&plain).await.unwrap()).is_none());
}
