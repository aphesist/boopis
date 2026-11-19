//! The engine against an in-memory Hermes: the flow, its consent, resuming and idempotence. The real CLI is exercised by
//! `tests/setup_live.rs` against a real Hermes.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::install::Bundle;
use super::ops::{HermesOps, PluginEntry};
use super::{Answer, Setup, StepState};
use crate::commands::Json;
use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;

struct Fake {
    home: PathBuf,
    missing: bool,
    config: Mutex<Value>,
    plugins: Mutex<Vec<PluginEntry>>,
    sets: Mutex<Vec<String>>,
    restarts: Mutex<u32>,
}

impl Fake {
    fn new(home: PathBuf, config: Value) -> Arc<Self> {
        Arc::new(Self {
            home,
            missing: false,
            config: Mutex::new(config),
            plugins: Mutex::new(Vec::new()),
            sets: Mutex::new(Vec::new()),
            restarts: Mutex::new(0),
        })
    }
}

#[async_trait]
impl HermesOps for Fake {
    async fn version(&self) -> Result<Option<String>> {
        if self.missing { Err(Error::HermesMissing) } else { Ok(Some("0.23.2".into())) }
    }
    fn home(&self) -> PathBuf {
        self.home.clone()
    }
    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let cfg = self.config.lock().unwrap();
        let mut at = &*cfg;
        for part in key.split('.') {
            match at.get(part) {
                Some(v) => at = v,
                None => return Ok(None),
            }
        }
        Ok(Some(at.clone()))
    }
    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        self.sets.lock().unwrap().push(key.to_owned());
        let parsed = serde_json::from_str::<Value>(value).unwrap_or_else(|_| json!(value));
        let mut cfg = self.config.lock().unwrap();
        let mut at = &mut *cfg;
        let parts: Vec<&str> = key.split('.').collect();
        for part in &parts[..parts.len() - 1] {
            at = at.as_object_mut().unwrap().entry(*part).or_insert_with(|| json!({}));
        }
        at[parts[parts.len() - 1]] = parsed;
        Ok(())
    }
    async fn plugins(&self) -> Result<Vec<PluginEntry>> {
        Ok(self.plugins.lock().unwrap().clone())
    }
    async fn enable_plugin(&self, name: &str) -> Result<()> {
        let mut list = self.plugins.lock().unwrap();
        list.retain(|p| p.name != name);
        list.push(PluginEntry { name: name.to_owned(), enabled: true });
        Ok(())
    }
    async fn restart_gateway(&self) -> Result<()> {
        *self.restarts.lock().unwrap() += 1;
        Ok(())
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    fake: Arc<Fake>,
    store: Arc<MemoryStore>,
    bundle: Bundle,
}

fn rig(config: Value) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let plugin = dir.path().join("bundle");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join("plugin.yaml"), "name: hypotaxis\nversion: 0.1.0\n").unwrap();
    std::fs::write(plugin.join("__init__.py"), "").unwrap();
    let hx = dir.path().join("hx-bin");
    std::fs::write(&hx, "hx").unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    Rig {
        fake: Fake::new(home, config),
        store: Arc::new(MemoryStore::default()),
        bundle: Bundle { plugin_dir: Some(plugin), hx: Some(hx) },
        _dir: dir,
    }
}

impl Rig {
    fn setup(&self) -> Setup {
        Setup::new(self.fake.clone(), self.store.clone(), self.bundle.clone())
    }
}

fn answer(form_id: &str, values: Value, secrets: Value) -> Answer {
    Answer { form_id: form_id.into(), cancelled: false, values: Json(values), secrets: Json(secrets) }
}

fn state_of(s: &super::Status, id: &str) -> StepState {
    s.steps.iter().find(|x| x.id == id).unwrap().state
}

const KEY: &str = "sk-setup-secret-value-123";

fn main_provider() -> Value {
    json!({"providers": {"main": {"api": "http://127.0.0.1:1/v1", "models": {"fake-a": {}}}}})
}

#[tokio::test]
async fn a_missing_hermes_shows_the_command_and_installs_nothing() {
    let mut r = rig(json!({}));
    Arc::get_mut(&mut r.fake).unwrap().missing = true;
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(state_of(&s, "hermes"), StepState::Blocked);
    assert!(s.install_command.unwrap().contains("hermes-agent.nousresearch.com"));
    assert!(!s.done && s.steps.len() == 2, "only hermes and the pending receipt");
    assert!(!r.fake.home.join("plugins").exists(), "nothing was installed");
}

#[tokio::test]
async fn the_whole_flow_with_consent_a_choice_and_a_key() {
    let r = rig(main_provider());
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(state_of(&s, "plugin"), StepState::Done);
    assert_eq!(state_of(&s, "hx"), StepState::Done);
    let form = s.form.unwrap();
    assert_eq!((form.form_id.as_str(), form.kind.as_str(), form.origin.as_str()), ("setup.config", "setup", "host"));
    assert_eq!(form.diff.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(), [
        "tools.tool_search.enabled",
        "delegation.backend",
        "plugins.entries.hypotaxis.allow_gateway_injection"
    ]);
    assert!(r.fake.config_get("tools.tool_search.enabled").await.unwrap().is_none(), "nothing before consent");
    assert!(r.fake.home.join("plugins/hypotaxis/__init__.py").is_file());

    let s = r.setup().advance(Some(answer("setup.config", json!({}), json!({}))), false).await.unwrap();
    assert_eq!(r.fake.config_get("tools.tool_search.enabled").await.unwrap().unwrap(), json!("off"));
    assert_eq!(r.fake.config_get("delegation.backend").await.unwrap().unwrap(), json!("hypotaxis"));
    assert_eq!(r.fake.config_get("plugins.entries.hypotaxis.allow_gateway_injection").await.unwrap().unwrap(), json!(true));
    let ladder = s.form.unwrap();
    assert_eq!(ladder.form_id, "setup.ladder");
    assert!(ladder.schema.0.to_string().contains("main/fake-a"));

    let s = r.setup().advance(Some(answer("setup.ladder", json!({"choice": "main/fake-a"}), json!({}))), false).await.unwrap();
    let cred = s.form.unwrap();
    assert_eq!((cred.form_id.as_str(), cred.sensitive), ("setup.credential.main", true));
    assert!(r.store.get("hypotaxis.provider.main", "api_key").unwrap().is_none());

    // a fresh engine over the same home resumes: the state file carries the open form
    let s = r.setup().advance(Some(answer("setup.credential.main", json!({}), json!({"value": KEY}))), false).await.unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(r.store.get("hypotaxis.provider.main", "api_key").unwrap().as_deref(), Some(KEY));
    let env = crate::secrets::refs::SecretRef::provider_key("main").env_name();
    assert_eq!(r.fake.config_get("providers.main.key_env").await.unwrap().unwrap(), json!(env));
    assert_eq!(r.fake.config_get(&format!("secrets.hypotaxis_host.env.{env}")).await.unwrap().unwrap(), json!("secret://provider.main/api_key"));
    assert_eq!(r.fake.config_get("plugins.entries.hypotaxis.settings.ladder").await.unwrap().unwrap(), json!({"tiers": [{"name": "fake-a", "model": "main/fake-a"}]}));
    assert_eq!(*r.fake.restarts.lock().unwrap(), 1, "one restart at the end, not one per change");
    let receipt = s.receipt.as_ref().unwrap().lines.join("\n");
    assert!(receipt.contains("fake-a on main") || receipt.contains("one tier"), "{receipt}");
    let on_disk = std::fs::read_to_string(super::state::path(&r.fake.home)).unwrap();
    assert!(!on_disk.contains(KEY) && !format!("{receipt}{s:?}").contains(KEY), "a secret never lands in state, status or receipt");
}

#[tokio::test]
async fn running_it_again_changes_nothing() {
    let r = rig(main_provider());
    let _ = r.setup().advance(None, false).await.unwrap();
    let _ = r.setup().advance(Some(answer("setup.config", json!({}), json!({}))), false).await.unwrap();
    let _ = r.setup().advance(Some(answer("setup.ladder", json!({"choice": "main/fake-a"}), json!({}))), false).await.unwrap();
    let _ = r.setup().advance(Some(answer("setup.credential.main", json!({}), json!({"value": KEY}))), false).await.unwrap();
    let (sets, restarts) = (r.fake.sets.lock().unwrap().len(), *r.fake.restarts.lock().unwrap());
    let again = r.setup().advance(None, false).await.unwrap();
    assert!(again.done && again.steps.iter().all(|s| s.state == StepState::Done));
    assert_eq!((r.fake.sets.lock().unwrap().len(), *r.fake.restarts.lock().unwrap()), (sets, restarts));
}

#[tokio::test]
async fn declining_is_respected_explained_and_can_be_reconsidered() {
    let r = rig(json!({"providers": {}}));
    let _ = r.setup().advance(None, false).await.unwrap();
    let mut no = answer("setup.config", json!({}), json!({}));
    no.cancelled = true;
    let s = r.setup().advance(Some(no), false).await.unwrap();
    assert_eq!(state_of(&s, "config"), StepState::Declined);
    let step = s.steps.iter().find(|x| x.id == "config").unwrap();
    assert!(step.detail.contains("dedicated Hermes profile") && step.code.as_deref() == Some("hx.setup.declined"));
    assert!(r.fake.config_get("tools.tool_search.enabled").await.unwrap().is_none());
    assert_eq!(s.form.as_ref().map(|f| f.form_id.as_str()), Some("setup.ladder"), "the flow goes on to models");
    let again = r.setup().advance(None, true).await.unwrap();
    assert_eq!(again.form.unwrap().form_id, "setup.config", "reconsidering asks again");
}

#[tokio::test]
async fn an_answer_to_another_form_is_refused() {
    let r = rig(json!({}));
    let _ = r.setup().advance(None, false).await.unwrap();
    let e = r.setup().advance(Some(answer("setup.ladder", json!({"choice": "x"}), json!({}))), false).await.unwrap_err();
    assert_eq!(e.code(), "hx.setup.invalid_answer");
    let e = r.setup().advance(Some(answer("setup.credential.main", json!({}), json!({"value": KEY}))), false).await.unwrap_err();
    assert_eq!(e.code(), "hx.setup.invalid_answer");
    assert!(r.store.get("hypotaxis.provider.main", "api_key").unwrap().is_none(), "a refused answer stores nothing");
}

#[tokio::test]
async fn claude_is_the_default_ladder_when_a_key_is_there() {
    let r = rig(json!({"tools": {"tool_search": {"enabled": "off"}}, "delegation": {"backend": "hypotaxis"},
        "plugins": {"entries": {"hypotaxis": {"allow_gateway_injection": true}}}}));
    std::fs::write(r.fake.home.join(".env"), "ANTHROPIC_API_KEY=sk-ant-x\n# c\nEMPTY=\n").unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    let models = s.steps.iter().find(|x| x.id == "models").unwrap();
    assert!(models.detail.contains("Claude ladder"));
    assert!(r.fake.config_get("plugins.entries.hypotaxis.settings.ladder").await.unwrap().is_none(), "the plugin's default stands");
}

#[tokio::test]
async fn a_key_saved_for_anthropic_is_bound_to_its_own_variable() {
    let r = rig(json!({}));
    r.store.set("hypotaxis.provider.anthropic", "api_key", KEY).unwrap();
    let _ = r.setup().advance(None, false).await.unwrap();
    let s = r.setup().advance(Some(answer("setup.config", json!({}), json!({}))), false).await.unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.fake.config_get("secrets.hypotaxis_host.env.ANTHROPIC_API_KEY").await.unwrap().unwrap(),
        json!("secret://provider.anthropic/api_key")
    );
}

#[tokio::test]
async fn a_build_without_the_plugin_says_so() {
    let mut r = rig(json!({}));
    r.bundle.plugin_dir = None;
    let s = r.setup().advance(None, false).await.unwrap();
    let step = s.steps.iter().find(|x| x.id == "plugin").unwrap();
    assert_eq!((step.state, step.code.as_deref()), (StepState::Blocked, Some("hx.setup.no_bundle")));
}
