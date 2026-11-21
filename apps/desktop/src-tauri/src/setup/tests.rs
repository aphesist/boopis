//! The engine against an in-memory Hermes: the flow, its consent, resuming and idempotence. The real CLI is exercised by
//! `tests/setup_live.rs` against a real Hermes.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::install::Bundle;
use super::ops::{HermesOps, PluginEntry};
use super::{Answer, Setup, StepState, windows_gaps};
use crate::claude::{self, ClaudeCli, PROVIDER_ID, Probe};
use crate::commands::Json;
use crate::error::{Error, Result};
use crate::free_tier::FreeTier;
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;

struct Fake {
    home: PathBuf,
    missing: bool,
    config: Mutex<Value>,
    plugins: Mutex<Vec<PluginEntry>>,
    sets: Mutex<Vec<String>>,
    restarts: Mutex<u32>,
    /// How many of the next restarts fail (the gateway does not come up).
    restart_failures: Mutex<u32>,
    /// What Hermes says about the free tier: the status before a claim, and after it.
    free: Mutex<FreeScript>,
    /// The free rows of the `OpenRouter` catalogue.
    catalogue: Mutex<Vec<String>>,
    /// The `ALIASES` the bundled Claude subscription plugin's `model_catalog.py` carries.
    claude_aliases: Mutex<Vec<&'static str>>,
    /// The models the signed-in ChatGPT account's own catalogue lists (`model.options`, `openai-codex`).
    chatgpt_models: Mutex<Vec<String>>,
    /// The engine's Gemini catalogue (`model.options`, `gemini`).
    gemini_models: Mutex<Vec<String>>,
    /// The xAI catalogue (`model.options`, `xai`).
    xai_models: Mutex<Vec<String>>,
}

/// A scripted Claude Code: what the look finds, and how many looks there were.
struct FakeClaude {
    probe: Mutex<Probe>,
    looks: Mutex<u32>,
}

impl FakeClaude {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            probe: Mutex::new(claude::assess(false, None, None)),
            looks: Mutex::new(0),
        })
    }
    /// Claude Code in one of the states: `auth` is its `auth status` JSON.
    fn is(&self, installed: bool, version: &str, auth: Option<&Value>) {
        *self.probe.lock().unwrap() = claude::assess(installed, Some(version), auth);
    }
    fn signed_in(&self, version: &str) {
        self.is(
            true,
            version,
            Some(&json!({"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"})),
        );
    }
}

#[async_trait]
impl ClaudeCli for FakeClaude {
    async fn probe(&self) -> Probe {
        *self.looks.lock().unwrap() += 1;
        self.probe.lock().unwrap().clone()
    }
}

/// A scripted Hermes for the free tier (no gateway, no Nous).
#[derive(Default)]
struct FreeScript {
    before: FreeTier,
    after: FreeTier,
    claimed: bool,
    statuses: u32,
    provisions: u32,
}

impl Fake {
    /// What boopis's runtime leaves in the profile (`install::install_runtime_plugins`): the Claude subscription plugin's
    /// directory, named by its manifest, with its model catalogue, listed by the engine as an enabled model provider.
    fn bundled_claude(&self) {
        let dir = super::ops::plugins_dir(&self.home).join(PROVIDER_ID);
        std::fs::create_dir_all(&dir).unwrap();
        let rows = self
            .claude_aliases
            .lock()
            .unwrap()
            .iter()
            .map(|a| format!("    '{a}': 'claude-{a}-x',\n"))
            .collect::<Vec<_>>()
            .concat();
        std::fs::write(
            dir.join("model_catalog.py"),
            format!(
                "CONTEXT_WINDOWS = {{'claude-x': 1}}\nALIASES = {{\n{rows}}}\nOTHER = {{'k': 1}}\n"
            ),
        )
        .unwrap();
        self.plugins.lock().unwrap().push(PluginEntry {
            name: PROVIDER_ID.into(),
            enabled: true,
        });
    }

    fn new(home: PathBuf, config: Value) -> Arc<Self> {
        Arc::new(Self {
            home,
            missing: false,
            config: Mutex::new(config),
            plugins: Mutex::new(Vec::new()),
            sets: Mutex::new(Vec::new()),
            restarts: Mutex::new(0),
            restart_failures: Mutex::new(0),
            free: Mutex::new(FreeScript::default()),
            catalogue: Mutex::new(Vec::new()),
            claude_aliases: Mutex::new(vec!["sonnet", "haiku", "opus", "fable"]),
            chatgpt_models: Mutex::new(vec!["gpt-6-luna".into(), "gpt-6-sol".into()]),
            // the engine's own static list: Hydrogen and Carbon are there, Neon is not
            gemini_models: Mutex::new(
                [
                    "gemini-3.8-flash",
                    "gemini-4-hydrogen",
                    "gemini-4-carbon",
                    "gemini-4-argon",
                ]
                .map(Into::into)
                .to_vec(),
            ),
            xai_models: Mutex::new(["grok-4.6", "grok-4.7"].map(Into::into).to_vec()),
        })
    }
}

#[async_trait]
impl HermesOps for Fake {
    async fn version(&self) -> Result<Option<String>> {
        if self.missing {
            Err(Error::HermesMissing)
        } else {
            Ok(Some("0.23.2".into()))
        }
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
            at = at
                .as_object_mut()
                .unwrap()
                .entry(*part)
                .or_insert_with(|| json!({}));
        }
        at[parts[parts.len() - 1]] = parsed;
        Ok(())
    }
    async fn config_unset(&self, key: &str) -> Result<()> {
        self.sets.lock().unwrap().push(format!("unset {key}"));
        let mut cfg = self.config.lock().unwrap();
        let mut at = &mut *cfg;
        let parts: Vec<&str> = key.split('.').collect();
        for part in &parts[..parts.len() - 1] {
            match at.get_mut(*part) {
                Some(v) => at = v,
                None => return Ok(()),
            }
        }
        if let Some(o) = at.as_object_mut() {
            o.remove(parts[parts.len() - 1]);
        }
        Ok(())
    }
    async fn plugins(&self) -> Result<Vec<PluginEntry>> {
        Ok(self.plugins.lock().unwrap().clone())
    }
    async fn enable_plugin(&self, name: &str) -> Result<()> {
        let mut list = self.plugins.lock().unwrap();
        list.retain(|p| p.name != name);
        list.push(PluginEntry {
            name: name.to_owned(),
            enabled: true,
        });
        Ok(())
    }
    async fn restart_gateway(&self) -> Result<()> {
        let mut failures = self.restart_failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(Error::Unavailable("the gateway did not start".into()));
        }
        *self.restarts.lock().unwrap() += 1;
        Ok(())
    }
    async fn free_tier_status(&self) -> Result<FreeTier> {
        let mut f = self.free.lock().unwrap();
        f.statuses += 1;
        Ok(if f.claimed {
            f.after.clone()
        } else {
            f.before.clone()
        })
    }
    async fn free_tier_provision(&self) -> Result<FreeTier> {
        let mut f = self.free.lock().unwrap();
        f.provisions += 1;
        f.claimed = true;
        Ok(f.after.clone())
    }
    async fn free_models(&self, provider: &str) -> Result<Vec<String>> {
        assert_eq!(provider, "openrouter");
        Ok(self.catalogue.lock().unwrap().clone())
    }
    async fn provider_models(&self, provider: &str) -> Result<Vec<String>> {
        Ok(match provider {
            "openai-codex" => self.chatgpt_models.lock().unwrap().clone(),
            "gemini" => self.gemini_models.lock().unwrap().clone(),
            "xai" => self.xai_models.lock().unwrap().clone(),
            other => panic!("setup asked the catalogue of {other}"),
        })
    }
}

struct Rig {
    dir: tempfile::TempDir,
    fake: Arc<Fake>,
    claude: Arc<FakeClaude>,
    store: Arc<MemoryStore>,
    bundle: Bundle,
}

fn rig(config: Value) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let plugin = dir.path().join("bundle");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join("plugin.yaml"), "name: boopis\nversion: 0.1.0\n").unwrap();
    std::fs::write(plugin.join("__init__.py"), "").unwrap();
    let hx = dir.path().join("hx-bin");
    std::fs::write(&hx, "hx").unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    Rig {
        fake: Fake::new(home, config),
        claude: FakeClaude::new(),
        store: Arc::new(MemoryStore::default()),
        bundle: Bundle {
            plugin_dir: Some(plugin),
            hx: Some(hx),
        },
        dir,
    }
}

impl Rig {
    fn setup(&self) -> Setup {
        let chatgpt = crate::chatgpt::ChatGpt::new(
            self.store.clone(),
            Arc::new(NoNetwork),
            crate::chatgpt::Timing {
                signin: std::time::Duration::from_mins(15),
                refresh_ahead: std::time::Duration::from_mins(30),
                refresh_every: std::time::Duration::from_mins(5),
            },
        );
        Setup::new(self.fake.clone(), self.store.clone(), self.bundle.clone())
            .with_claude(self.claude.clone())
            .with_chatgpt(Arc::new(chatgpt))
    }
}

/// Setup reads the ChatGPT sign-in from the keychain and never reaches OpenAI.
struct NoNetwork;

impl crate::chatgpt::oauth::Transport for NoNetwork {
    fn post(
        &self,
        url: &str,
        _: &str,
        _: &str,
    ) -> std::result::Result<crate::chatgpt::oauth::Reply, String> {
        panic!("setup asked {url}: it must not reach the network");
    }
}

fn answer(form_id: &str, values: Value, secrets: Value) -> Answer {
    Answer {
        form_id: form_id.into(),
        cancelled: false,
        values: Json(values),
        secrets: Json(secrets),
    }
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
    assert!(
        s.install_command
            .unwrap()
            .contains("hermes-agent.nousresearch.com")
    );
    assert!(
        !s.done && s.steps.len() == 2,
        "only hermes and the pending receipt"
    );
    assert!(
        !r.fake.home.join("plugins").exists(),
        "nothing was installed"
    );
}

#[tokio::test]
async fn the_whole_flow_with_consent_a_choice_and_a_key() {
    let r = rig(main_provider());
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(state_of(&s, "plugin"), StepState::Done);
    assert_eq!(state_of(&s, "hx"), StepState::Done);
    let form = s.form.unwrap();
    assert_eq!(
        (
            form.form_id.as_str(),
            form.kind.as_str(),
            form.origin.as_str()
        ),
        ("setup.config", "setup", "host")
    );
    assert_eq!(
        form.diff.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(),
        [
            "tools.tool_search.enabled",
            "delegation.backend",
            "plugins.entries.boopis.allow_gateway_injection"
        ]
    );
    assert!(
        r.fake
            .config_get("tools.tool_search.enabled")
            .await
            .unwrap()
            .is_none(),
        "nothing before consent"
    );
    assert!(r.fake.home.join("plugins/boopis/__init__.py").is_file());

    let s = r
        .setup()
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert_eq!(
        r.fake
            .config_get("tools.tool_search.enabled")
            .await
            .unwrap()
            .unwrap(),
        json!("off")
    );
    assert_eq!(
        r.fake
            .config_get("delegation.backend")
            .await
            .unwrap()
            .unwrap(),
        json!("boopis")
    );
    assert_eq!(
        r.fake
            .config_get("plugins.entries.boopis.allow_gateway_injection")
            .await
            .unwrap()
            .unwrap(),
        json!(true)
    );
    let ladder = s.form.unwrap();
    assert_eq!(ladder.form_id, "setup.ladder");
    assert!(ladder.schema.0.to_string().contains("main/fake-a"));

    let s = r
        .setup()
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
    let cred = s.form.unwrap();
    assert_eq!(
        (cred.form_id.as_str(), cred.sensitive),
        ("setup.credential.main", true)
    );
    assert!(
        r.store
            .get("boopis.provider.main", "api_key")
            .unwrap()
            .is_none()
    );

    // a fresh engine over the same home resumes: the state file carries the open form
    let s = r
        .setup()
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
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(
        r.store
            .get("boopis.provider.main", "api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    let env = crate::secrets::refs::SecretRef::provider_key("main").env_name();
    assert_eq!(
        r.fake
            .config_get("providers.main.key_env")
            .await
            .unwrap()
            .unwrap(),
        json!(env)
    );
    assert_eq!(
        r.fake
            .config_get(&format!("secrets.boopis_host.env.{env}"))
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.main/api_key")
    );
    assert_eq!(
        r.fake
            .config_get("plugins.entries.boopis.settings.ladder")
            .await
            .unwrap()
            .unwrap(),
        json!({"tiers": [{"name": "fake-a", "model": "main/fake-a"}]})
    );
    assert_eq!(
        *r.fake.restarts.lock().unwrap(),
        1,
        "one restart at the end, not one per change"
    );
    let receipt = s.receipt.as_ref().unwrap().lines.join("\n");
    assert!(
        receipt.contains("fake-a on main") || receipt.contains("one tier"),
        "{receipt}"
    );
    let on_disk = std::fs::read_to_string(super::state::path(&r.fake.home)).unwrap();
    assert!(
        !on_disk.contains(KEY) && !format!("{receipt}{s:?}").contains(KEY),
        "a secret never lands in state, status or receipt"
    );
}

#[tokio::test]
async fn running_it_again_changes_nothing() {
    let r = rig(main_provider());
    let _ = r.setup().advance(None, false).await.unwrap();
    let _ = r
        .setup()
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    let _ = r
        .setup()
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
    let _ = r
        .setup()
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
    let (sets, restarts) = (
        r.fake.sets.lock().unwrap().len(),
        *r.fake.restarts.lock().unwrap(),
    );
    let again = r.setup().advance(None, false).await.unwrap();
    assert!(again.done && again.steps.iter().all(|s| s.state == StepState::Done));
    assert_eq!(
        (
            r.fake.sets.lock().unwrap().len(),
            *r.fake.restarts.lock().unwrap()
        ),
        (sets, restarts)
    );
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
    assert!(
        step.detail.contains("Choose Review again")
            && step.code.as_deref() == Some("hx.setup.declined")
    );
    assert!(
        r.fake
            .config_get("tools.tool_search.enabled")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        s.form.as_ref().map(|f| f.form_id.as_str()),
        Some("setup.ladder"),
        "the flow goes on to models"
    );
    let again = r.setup().advance(None, true).await.unwrap();
    assert_eq!(
        again.form.unwrap().form_id,
        "setup.config",
        "reconsidering asks again"
    );
}

#[tokio::test]
async fn an_answer_to_another_form_is_refused() {
    let r = rig(json!({}));
    let _ = r.setup().advance(None, false).await.unwrap();
    let e = r
        .setup()
        .advance(
            Some(answer("setup.ladder", json!({"choice": "x"}), json!({}))),
            false,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.setup.invalid_answer");
    let e = r
        .setup()
        .advance(
            Some(answer(
                "setup.credential.main",
                json!({}),
                json!({"value": KEY}),
            )),
            false,
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "hx.setup.invalid_answer");
    assert!(
        r.store
            .get("boopis.provider.main", "api_key")
            .unwrap()
            .is_none(),
        "a refused answer stores nothing"
    );
}

#[tokio::test]
async fn claude_is_the_default_ladder_when_a_key_is_there() {
    let r = rig(
        json!({"tools": {"tool_search": {"enabled": "off"}}, "delegation": {"backend": "boopis"},
        "plugins": {"entries": {"boopis": {"allow_gateway_injection": true}}}}),
    );
    std::fs::write(
        r.fake.home.join(".env"),
        "ANTHROPIC_API_KEY=sk-ant-x\n# c\nEMPTY=\n",
    )
    .unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    let models = s.steps.iter().find(|x| x.id == "models").unwrap();
    assert!(models.detail.contains("Claude ladder"));
    assert!(
        r.fake
            .config_get("plugins.entries.boopis.settings.ladder")
            .await
            .unwrap()
            .is_none(),
        "the plugin's default stands"
    );
}

#[tokio::test]
async fn a_key_saved_for_anthropic_is_bound_to_its_own_variable() {
    let r = rig(json!({}));
    r.store
        .set("boopis.provider.anthropic", "api_key", KEY)
        .unwrap();
    let _ = r.setup().advance(None, false).await.unwrap();
    let s = r
        .setup()
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.env.ANTHROPIC_API_KEY")
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.anthropic/api_key")
    );
}

#[tokio::test]
async fn a_build_without_the_plugin_says_so() {
    let mut r = rig(json!({}));
    r.bundle.plugin_dir = None;
    let s = r.setup().advance(None, false).await.unwrap();
    let step = s.steps.iter().find(|x| x.id == "plugin").unwrap();
    assert_eq!(
        (step.state, step.code.as_deref()),
        (StepState::Blocked, Some("hx.setup.no_bundle"))
    );
}

/// What a finished setup leaves in the profile's home, as the e2e fixtures write it (`tests/e2e/setup-done.json`).
const E2E_SETUP_DONE: &str = include_str!("../../../../../tests/e2e/setup-done.json");

/// A home the e2e stack prepared: the plugin copied in at the bundle's version and enabled, as `tests/e2e/stack.py` does.
fn a_home_with_the_plugin(r: &Rig) {
    let home = r.fake.home.clone();
    let plugin = home.join("plugins").join("boopis");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::copy(
        r.bundle.plugin_dir.as_ref().unwrap().join("plugin.yaml"),
        plugin.join("plugin.yaml"),
    )
    .unwrap();
    r.fake.plugins.lock().unwrap().push(PluginEntry {
        name: "boopis".into(),
        enabled: true,
    });
}

#[tokio::test]
async fn the_e2e_setup_marker_is_what_makes_the_ui_show_a_session() {
    // The UI shows first-run setup instead of a session while `check` says `needed`, so the release smoke, which drives a
    // session, has to start from a home setup has finished with. It copies tests/e2e/setup-done.json into the stack's home.
    let r = rig(main_provider());
    a_home_with_the_plugin(&r);
    let unfinished = r.setup().check().await.unwrap();
    assert!(
        unfinished.needed && unfinished.reason == "setup has not finished",
        "{}",
        unfinished.reason
    );

    let marker = super::state::path(&r.fake.home);
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, E2E_SETUP_DONE).unwrap();
    let done = r.setup().check().await.unwrap();
    assert!(!done.needed, "{}", done.reason);
}

#[tokio::test]
async fn a_finished_setup_whose_ladder_has_no_engine_default_runs_once_more_to_write_it() {
    // Setups before 0.1.4 wrote only the ladder: every session froze no model, and the engine refused it on the first
    // message (storage_unavailable). Such an install asks for setup once; one that has the default records the check.
    let r = rig(main_provider());
    a_home_with_the_plugin(&r);
    let marker = super::state::path(&r.fake.home);
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, E2E_SETUP_DONE).unwrap();
    let ladder = json!({"tiers": [{"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"}]});
    r.fake
        .config_set(LADDER, &ladder.to_string())
        .await
        .unwrap();
    r.fake
        .config
        .lock()
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("model");
    let missing = r.setup().check().await.unwrap();
    assert!(
        missing.needed && missing.reason == "the engine has no default model",
        "{}",
        missing.reason
    );
    assert!(
        !super::state::load(&r.fake.home).unwrap().route_checked,
        "not recorded while it is missing"
    );

    r.fake.config_set("model.default", "opus").await.unwrap();
    let fine = r.setup().check().await.unwrap();
    assert!(!fine.needed, "{}", fine.reason);
    assert!(
        super::state::load(&r.fake.home).unwrap().route_checked,
        "recorded, so later starts read no configuration"
    );

    // the free tier routes itself: nothing to repair
    let r = rig(json!({}));
    a_home_with_the_plugin(&r);
    let marker = super::state::path(&r.fake.home);
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, E2E_SETUP_DONE).unwrap();
    r.fake
        .config_set(
            LADDER,
            &json!({"tiers": [{"name": "free", "model": "nous/nous/welcome"}]}).to_string(),
        )
        .await
        .unwrap();
    assert!(!r.setup().check().await.unwrap().needed);
}

fn with_runtime(
    r: &Rig,
    version: &str,
    claimed_sha: Option<&str>,
) -> (Setup, crate::runtime::Plan) {
    let data = r.dir.path().join("data");
    let rt = crate::runtime::tests::bundle(
        &r.dir.path().join("res"),
        version,
        &crate::runtime::tests::standard(version),
        claimed_sha,
    );
    let plan = crate::runtime::Plan {
        runtime: rt,
        data_dir: data,
    };
    (r.setup().with_runtime(plan.clone()), plan)
}

#[tokio::test]
async fn the_bundled_runtime_is_unpacked_first_and_hermes_own_update_check_is_off() {
    let r = rig(main_provider());
    let (setup, plan) = with_runtime(&r, "0.23.2", None);
    let check = setup.check().await.unwrap();
    assert!(check.needed && !check.hermes_installed, "{}", check.reason);
    assert!(check.reason.contains("unpacked"), "{}", check.reason);
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].id, "runtime");
    assert_eq!(s.steps[0].state, StepState::Done, "{:?}", s.steps[0]);
    assert!(
        s.steps[0]
            .detail
            .contains("nothing else on this computer is touched")
    );
    assert_eq!(
        s.steps[1].id, "hermes",
        "the unpack comes before Hermes is looked for"
    );
    assert!(plan.runtime.is_installed(&plan.runtimes_dir()));
    assert_eq!(
        r.fake.config.lock().unwrap()["updates"]["check"],
        json!(false),
        "Hermes does not check for its own updates inside the bundle"
    );
    // again: nothing is unpacked or set twice
    let before = r
        .fake
        .sets
        .lock()
        .unwrap()
        .iter()
        .filter(|k| *k == "updates.check")
        .count();
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].detail, "version 0.23.2, unpacked");
    let after = r
        .fake
        .sets
        .lock()
        .unwrap()
        .iter()
        .filter(|k| *k == "updates.check")
        .count();
    assert_eq!((before, after), (1, 1));
}

#[tokio::test]
async fn a_runtime_that_fails_its_hash_stops_setup_with_the_reason() {
    let r = rig(main_provider());
    let (setup, plan) = with_runtime(&r, "0.23.2", Some(&"f".repeat(64)));
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].state, StepState::Blocked);
    assert_eq!(
        s.steps[0].code.as_deref(),
        Some("hx.setup.runtime_hash_mismatch")
    );
    assert!(
        s.steps[0].detail.contains("nothing was installed"),
        "{}",
        s.steps[0].detail
    );
    assert!(
        !s.done && s.steps.len() == 2,
        "the runtime step and the pending receipt only"
    );
    assert!(!plan.runtime.is_installed(&plan.runtimes_dir()));
    assert!(
        !r.fake.home.join("plugins").exists(),
        "nothing after it ran"
    );
}

/// A progress sink that keeps what it is told.
fn collecting() -> (super::ProgressSink, Arc<Mutex<Vec<super::SetupProgress>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (Arc::new(move |p| sink.lock().unwrap().push(p)), seen)
}

#[tokio::test]
async fn the_unpack_reports_how_far_it_has_come_in_bytes_of_the_manifests_archive() {
    use crate::runtime::Pass;
    let r = rig(main_provider());
    let (setup, plan) = with_runtime(&r, "0.23.2", None);
    let (sink, seen) = collecting();
    let setup = setup.with_progress(sink);
    setup.advance(None, false).await.unwrap();
    let total = plan.runtime.manifest().archive.size;
    let events = seen.lock().unwrap().clone();
    assert!(
        events
            .iter()
            .all(|e| e.step == "runtime" && e.total == total && e.read <= total),
        "{events:?}"
    );
    for phase in [Pass::Verify, Pass::Unpack] {
        let last = events
            .iter()
            .rfind(|e| e.phase == phase)
            .expect("a report per pass");
        assert_eq!(last.read, total, "{phase:?} runs to the whole archive");
    }
    let first_unpack = events.iter().position(|e| e.phase == Pass::Unpack).unwrap();
    assert!(
        events[..first_unpack]
            .iter()
            .all(|e| e.phase == Pass::Verify),
        "the archive is verified before it is unpacked: {events:?}"
    );
    // once it is unpacked there is nothing to report: no event is made up for a step that did no work
    let before = events.len();
    setup.advance(None, false).await.unwrap();
    assert_eq!(seen.lock().unwrap().len(), before);
}

#[tokio::test]
async fn a_failed_check_reports_verification_only_and_never_a_made_up_unpack() {
    use crate::runtime::Pass;
    let r = rig(main_provider());
    let (setup, _) = with_runtime(&r, "0.23.2", Some(&"f".repeat(64)));
    let (sink, seen) = collecting();
    let s = setup
        .with_progress(sink)
        .advance(None, false)
        .await
        .unwrap();
    assert_eq!(s.steps[0].state, StepState::Blocked);
    let events = seen.lock().unwrap().clone();
    assert!(
        !events.is_empty() && events.iter().all(|e| e.phase == Pass::Verify),
        "{events:?}"
    );
}

#[tokio::test]
async fn a_blocked_runtime_step_runs_again_on_the_next_call_without_a_new_engine_or_a_restart() {
    let r = rig(main_provider());
    let (setup, plan) = with_runtime(&r, "0.23.2", None);
    let archive = r.dir.path().join("res").join("rt.tar.zst");
    let bytes = std::fs::read(&archive).unwrap();
    std::fs::remove_file(&archive).unwrap();
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].state, StepState::Blocked);
    assert_eq!(s.steps[0].code.as_deref(), Some("hx.setup.runtime_missing"));
    assert!(!s.done);
    // the user puts it right (here: the file is back) and presses Retry: the same engine, the same call
    std::fs::write(&archive, bytes).unwrap();
    let s = setup.advance(None, false).await.unwrap();
    assert_eq!(s.steps[0].state, StepState::Done, "{:?}", s.steps[0]);
    assert!(plan.runtime.is_installed(&plan.runtimes_dir()));
    assert_eq!(s.steps[1].id, "hermes", "and setup went on from there");
}

#[tokio::test]
async fn a_blocked_later_step_is_retried_alone_and_what_is_done_is_not_redone() {
    let r = rig(main_provider());
    r.store.set("boopis.provider.main", "api_key", KEY).unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.config");
    *r.fake.restart_failures.lock().unwrap() = 1;
    let setup = r.setup();
    let s = setup
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    // the models question is the next stop; answer it with the one configured model
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.ladder");
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
    assert_eq!(state_of(&s, "restart"), StepState::Blocked, "{:?}", s.steps);
    assert_eq!(
        s.steps
            .iter()
            .find(|x| x.id == "restart")
            .unwrap()
            .code
            .as_deref(),
        Some("hx.engine.unavailable")
    );
    assert!(!s.done);
    let sets = r.fake.sets.lock().unwrap().len();
    // Retry: the same call as "Check again". It finishes, and writes nothing again.
    let s = setup.advance(None, false).await.unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(state_of(&s, "restart"), StepState::Done);
    assert_eq!(
        r.fake.sets.lock().unwrap().len(),
        sets,
        "no setting was written twice"
    );
    assert_eq!(*r.fake.restarts.lock().unwrap(), 1);
}

#[tokio::test]
async fn the_ladder_view_says_default_set_or_unreadable_and_lists_tiers_as_hermes_holds_them() {
    use super::providers::{LadderState, LadderTier};
    let r = rig(json!({}));
    let v = r.setup().models_view().await.unwrap();
    assert_eq!((v.state, v.tiers.len()), (LadderState::Default, 0));
    r.fake
        .config_set(
            LADDER,
            &json!({"tiers": [{"name": "small", "model": "openrouter/a:free"}, {"name": "big", "model": "openrouter/b:free", "effort": "high"}]}).to_string(),
        )
        .await
        .unwrap();
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(v.state, LadderState::Set);
    assert_eq!(
        v.tiers,
        vec![
            LadderTier {
                name: "small".into(),
                model: "openrouter/a:free".into()
            },
            LadderTier {
                name: "big".into(),
                model: "openrouter/b:free".into()
            }
        ]
    );
    for bad in [
        json!({"tiers": []}),
        json!({"tiers": [{"name": "x"}]}),
        json!("nope"),
        json!({"tiers": [3]}),
    ] {
        r.fake.config_set(LADDER, &bad.to_string()).await.unwrap();
        let v = r.setup().models_view().await.unwrap();
        assert_eq!(
            (v.state, v.tiers.len()),
            (LadderState::Unreadable, 0),
            "{bad}"
        );
    }
}

#[tokio::test]
async fn the_view_shows_the_ladder_the_free_choice_wrote_and_change_models_asks_the_question_again()
{
    let r = rig(json!({}));
    {
        let mut f = r.fake.free.lock().unwrap();
        f.before = welcome(false, true);
        f.after = welcome(true, true);
    }
    at_models(&r).await;
    choose(&r, "free").await;
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(
        v.tiers
            .iter()
            .map(|t| (t.name.as_str(), t.model.as_str()))
            .collect::<Vec<_>>(),
        [("free", "nous/nous/welcome")]
    );
    // "Change models": forget the choice, and the next call asks setup's question with the saved ladder still in place
    r.setup().reopen_models().unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(
        s.form.as_ref().unwrap().form_id,
        "setup.ladder",
        "{:?}",
        s.steps
    );
    assert_eq!(
        r.setup().models_view().await.unwrap().tiers.len(),
        1,
        "asking changes nothing until the new choice is made"
    );
}

// ── the free models ─────────────────────────────────────────────────────────────────────────────────────────────────

/// Run setup up to the models question (the plugin, hx and the consent are done).
async fn at_models(r: &Rig) -> super::Status {
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.config");
    r.setup()
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap()
}

fn welcome(available: bool, enabled: bool) -> FreeTier {
    FreeTier {
        has_guest: available,
        enabled,
        available,
        model: "nous/welcome".into(),
        label: "Nous · free tier".into(),
        ..FreeTier::default()
    }
}

fn choose(r: &Rig, choice: &str) -> impl std::future::Future<Output = super::Status> {
    let setup = r.setup();
    let a = answer("setup.ladder", json!({"choice": choice}), json!({}));
    async move { setup.advance(Some(a), false).await.unwrap() }
}

fn enum_of(form: &super::Form, field: &str) -> Vec<String> {
    form.schema.0["properties"][field]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect()
}

const LADDER: &str = "plugins.entries.boopis.settings.ladder";

#[tokio::test]
async fn with_no_key_the_free_tier_is_the_first_choice_and_the_default_and_nothing_is_asked_of_nous_yet()
 {
    let r = rig(json!({}));
    let s = at_models(&r).await;
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder");
    let ids = enum_of(&form, "choice");
    assert_eq!(
        &ids[..4],
        [
            "free",
            "openrouter-free",
            "anthropic",
            "claude-subscription"
        ],
        "the free choices stay first and the default, the API key choice keeps its place"
    );
    let field = &form.schema.0["properties"]["choice"];
    assert_eq!(
        field["default"], "free",
        "the default when no key is present"
    );
    assert_eq!(
        field["enumNames"][0],
        "Free models (Nous free tier, no account)"
    );
    assert_eq!(
        field["enumNames"][1],
        "OpenRouter free models (needs a free OpenRouter key)"
    );
    assert!(
        form.body.contains("https://portal.nousresearch.com/terms")
            && form.body.contains("one model"),
        "the form names whose service it is, links the terms and says it is one model: {}",
        form.body
    );
    let f = r.fake.free.lock().unwrap();
    assert_eq!(
        (f.statuses, f.provisions),
        (0, 0),
        "showing the choice calls no one"
    );
    drop(f);
    assert!(
        !super::state::free_tier_chosen(&r.fake.home),
        "the host declares nothing until the user chooses"
    );
}

#[tokio::test]
async fn a_claude_key_keeps_the_claude_ladder_as_the_default() {
    let r = rig(json!({}));
    r.store
        .set("boopis.provider.anthropic", "api_key", KEY)
        .unwrap();
    let s = at_models(&r).await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert!(
        s.receipt
            .unwrap()
            .lines
            .join("\n")
            .contains("Claude ladder"),
        "with a key present the free tier is not the default"
    );
}

#[tokio::test]
async fn choosing_the_free_tier_lets_hermes_claim_it_and_writes_only_the_ladder() {
    let r = rig(json!({}));
    {
        let mut f = r.fake.free.lock().unwrap();
        f.before = welcome(false, true);
        f.after = welcome(true, true);
    }
    at_models(&r).await;
    let s = choose(&r, "free").await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    {
        let f = r.fake.free.lock().unwrap();
        assert_eq!(f.provisions, 1, "Hermes was asked to claim, once");
    }
    // one model, so one tier; its name is what Hermes reported, with the provider in front
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "free", "model": "nous/nous/welcome"}]})
    );
    // Hermes writes the identity itself: the host writes no model, no key, no secret for it
    for key in ["model", "providers", "secrets", "model.provider"] {
        assert!(
            r.fake.config_get(key).await.unwrap().is_none(),
            "the host wrote {key}"
        );
    }
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("one model at every tier") && receipt.contains("nous/welcome"),
        "setup says so: {receipt}"
    );
    assert!(receipt.contains("https://portal.nousresearch.com/terms"));
    assert_eq!(*r.fake.restarts.lock().unwrap(), 1);
    assert!(
        super::state::free_tier_chosen(&r.fake.home),
        "now the host declares itself the Desktop on its gateway link"
    );
}

#[tokio::test]
async fn the_ladder_names_the_model_hermes_reports_not_one_in_the_code() {
    let r = rig(json!({}));
    {
        let mut f = r.fake.free.lock().unwrap();
        f.before = FreeTier {
            model: "nous/another-free-one".into(),
            ..welcome(true, true)
        };
    }
    at_models(&r).await;
    choose(&r, "free").await;
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "free", "model": "nous/nous/another-free-one"}]})
    );
}

#[tokio::test]
async fn an_identity_that_already_carries_inference_is_not_claimed_again() {
    let r = rig(json!({}));
    r.fake.free.lock().unwrap().before = welcome(true, true);
    at_models(&r).await;
    let s = choose(&r, "free").await;
    assert!(s.done);
    assert_eq!(r.fake.free.lock().unwrap().provisions, 0);
}

#[tokio::test]
async fn when_hermes_says_it_is_not_claimable_the_form_says_so_and_offers_the_other_choices() {
    let r = rig(json!({}));
    r.fake.free.lock().unwrap().before = welcome(false, false);
    at_models(&r).await;
    let s = choose(&r, "free").await;
    assert!(!s.done);
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder");
    let ids = enum_of(&form, "choice");
    assert!(!ids.contains(&"free".to_owned()), "{ids:?}");
    assert_eq!(&ids[..2], ["openrouter-free", "anthropic"]);
    assert!(
        form.body.contains("first install") && form.body.contains("does not say which"),
        "{}",
        form.body
    );
    assert_eq!(
        r.fake.free.lock().unwrap().provisions,
        0,
        "nothing to claim"
    );
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    assert!(
        !super::state::free_tier_chosen(&r.fake.home),
        "no longer the choice: the host stops declaring itself the Desktop"
    );
    // asked again, it does not ask Hermes again and still leaves the free tier out
    let calls = r.fake.free.lock().unwrap().statuses;
    let again = r.setup().advance(None, false).await.unwrap();
    assert!(!enum_of(&again.form.unwrap(), "choice").contains(&"free".to_owned()));
    assert_eq!(r.fake.free.lock().unwrap().statuses, calls);
}

#[tokio::test]
async fn a_failed_claim_is_shown_in_hermes_words_with_when_to_try_again() {
    let r = rig(json!({}));
    {
        let mut f = r.fake.free.lock().unwrap();
        f.before = welcome(false, true);
        f.after = FreeTier {
            error: Some("Lots of people are getting started right now".into()),
            error_code: Some("anon_rate_limited".into()),
            retryable: Some(true),
            retry_after: Some(300),
            ..welcome(false, true)
        };
    }
    at_models(&r).await;
    let s = choose(&r, "free").await;
    let form = s.form.unwrap();
    assert!(
        form.body
            .contains("Lots of people are getting started right now")
            && form.body.contains("about 5 minutes"),
        "{}",
        form.body
    );
    assert!(
        r.fake.config_get(LADDER).await.unwrap().is_none(),
        "no ladder for a tier that is not there"
    );
}

#[tokio::test]
async fn the_openrouter_choice_asks_for_a_key_then_offers_the_free_models_smallest_to_largest() {
    let r = rig(json!({}));
    *r.fake.catalogue.lock().unwrap() = vec![
        "meta-llama/llama-3.3-70b-instruct:free".into(),
        "google/gemma-3-27b-it:free".into(),
        "openrouter/some-router:free".into(),
        "meta-llama/llama-3.2-3b-instruct:free".into(),
        "openai/gpt-oss-120b:free".into(),
    ];
    at_models(&r).await;
    let s = choose(&r, "openrouter-free").await;
    let cred = s.form.unwrap();
    assert_eq!(
        (cred.form_id.as_str(), cred.kind.as_str(), cred.sensitive),
        ("setup.credential.openrouter", "credential", true)
    );
    assert!(cred.body.contains("free OpenRouter key"));
    let s = r
        .setup()
        .advance(
            Some(answer(
                "setup.credential.openrouter",
                json!({}),
                json!({"value": KEY}),
            )),
            false,
        )
        .await
        .unwrap();
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.openrouter");
    assert_eq!(
        enum_of(&form, "picks"),
        [
            "meta-llama/llama-3.2-3b-instruct:free",
            "google/gemma-3-27b-it:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "openai/gpt-oss-120b:free",
            "openrouter/some-router:free"
        ],
        "smallest to largest by the size each name states; the one that states none last"
    );
    assert_eq!(
        form.schema.0["properties"]["picks"]["default"],
        json!([
            "meta-llama/llama-3.2-3b-instruct:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "openai/gpt-oss-120b:free"
        ]),
        "the proposal: small, middle, large"
    );
    // the key is in the keychain and wired by name, never in a file
    assert_eq!(
        r.store
            .get("boopis.provider.openrouter", "api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.env.OPENROUTER_API_KEY")
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.openrouter/api_key")
    );
    let s = r
        .setup()
        .advance(
            Some(answer(
                "setup.openrouter",
                json!({"picks": ["meta-llama/llama-3.3-70b-instruct:free", "meta-llama/llama-3.2-3b-instruct:free"]}),
                json!({}),
            )),
            false,
        )
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [
            {"name": "llama-3.2-3b-instruct", "model": "openrouter/meta-llama/llama-3.2-3b-instruct:free"},
            {"name": "llama-3.3-70b-instruct", "model": "openrouter/meta-llama/llama-3.3-70b-instruct:free"}
        ]}),
        "ordered small to large whatever order the user picked in"
    );
    let on_disk = std::fs::read_to_string(super::state::path(&r.fake.home)).unwrap();
    assert!(!on_disk.contains(KEY));
    assert!(
        !super::state::free_tier_chosen(&r.fake.home),
        "OpenRouter is not the Nous free tier"
    );
}

#[tokio::test]
async fn an_empty_openrouter_catalogue_or_a_pick_outside_it_never_writes_a_ladder() {
    let r = rig(json!({}));
    r.store
        .set("boopis.provider.openrouter", "api_key", KEY)
        .unwrap();
    at_models(&r).await;
    let s = choose(&r, "openrouter-free").await;
    let form = s.form.unwrap();
    assert!(form.body.contains("lists no free models"), "{}", form.body);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());

    let r = rig(json!({}));
    r.store
        .set("boopis.provider.openrouter", "api_key", KEY)
        .unwrap();
    *r.fake.catalogue.lock().unwrap() = vec!["a/b-8b:free".into()];
    at_models(&r).await;
    choose(&r, "openrouter-free").await;
    let s = r
        .setup()
        .advance(
            Some(answer(
                "setup.openrouter",
                json!({"picks": ["not/in-the-catalogue:free"]}),
                json!({}),
            )),
            false,
        )
        .await
        .unwrap();
    assert_eq!(state_of(&s, "models"), StepState::Blocked);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
}

#[tokio::test]
async fn choosing_the_models_again_asks_the_question_again_even_when_a_ladder_is_set() {
    let r = rig(json!({}));
    r.fake.free.lock().unwrap().before = welcome(true, true);
    at_models(&r).await;
    choose(&r, "free").await;
    assert!(super::state::free_tier_chosen(&r.fake.home));
    r.setup().reopen_models().unwrap();
    assert!(!super::state::free_tier_chosen(&r.fake.home));
    let s = r.setup().advance(None, false).await.unwrap();
    let form = s.form.expect("asked again");
    assert_eq!(form.form_id, "setup.ladder");
    assert_eq!(
        enum_of(&form, "choice")[0],
        "free",
        "still offered: Hermes decides, not a stored refusal"
    );
    // answering ends the reopening
    let s = r
        .setup()
        .advance(
            Some(answer("setup.ladder", json!({"choice": "free"}), json!({}))),
            false,
        )
        .await
        .unwrap();
    assert!(s.done);
}

#[test]
fn a_models_size_is_what_its_name_states_and_nothing_else() {
    use super::providers::{order_by_size, propose_ladder, size_hint};
    assert_eq!(
        size_hint("meta-llama/llama-3.3-70b-instruct:free"),
        Some(70.0)
    );
    assert_eq!(size_hint("openai/gpt-oss-120b:free"), Some(120.0));
    assert_eq!(
        size_hint("qwen/qwen3-235b-a22b:free"),
        Some(235.0),
        "the total, not the active part"
    );
    assert_eq!(size_hint("some/tiny-1.5b"), Some(1.5));
    assert_eq!(size_hint("google/gemini-2.0-flash-exp:free"), None);
    assert_eq!(
        size_hint("x/abc3b"),
        None,
        "3b glued to letters is not a size"
    );
    assert_eq!(size_hint("x/model-7bit"), None);
    let ids: Vec<String> = ["a/z", "b/m-70b", "c/m-8b"].map(str::to_owned).into();
    assert_eq!(order_by_size(&ids), ["c/m-8b", "b/m-70b", "a/z"]);
    assert!(propose_ladder(&["a/z".to_owned(), "b/y".to_owned()]).is_empty());
    let many: Vec<String> = (1..=9).map(|n| format!("v/m-{n}b")).collect();
    assert_eq!(propose_ladder(&many), ["v/m-1b", "v/m-5b", "v/m-9b"]);
}

#[test]
fn the_catalogue_reader_takes_zero_priced_and_free_tagged_rows_of_the_asked_provider() {
    let answer = json!({"providers": [
        {"slug": "nous", "models": ["x"], "pricing": {"x": {"free": true}}},
        {"slug": "openrouter",
         "models": ["a/b:free", "c/d", "e/f", "g/h:free"],
         "pricing": {"c/d": {"free": true}, "e/f": {"free": false}}}]});
    assert_eq!(
        super::ops::free_models_of(&answer, "openrouter"),
        ["a/b:free", "c/d", "g/h:free"]
    );
    assert!(super::ops::free_models_of(&answer, "nope").is_empty());
    assert!(super::ops::free_models_of(&json!({}), "openrouter").is_empty());
}

// ── the Claude subscription (ADR-0029) ──────────────────────────────────────────────────────────────────────────────

/// Walk to the question, choose the Claude subscription, and return what the host shows next.
async fn choose_subscription(r: &Rig) -> super::Status {
    at_models(r).await;
    choose(r, "claude-subscription").await
}

fn rows(form: &super::Form) -> String {
    form.contents
        .iter()
        .map(|(a, b)| format!("{a}: {b}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn plugin_names(r: &Rig) -> Vec<String> {
    r.fake
        .plugins
        .lock()
        .unwrap()
        .iter()
        .map(|p| p.name.clone())
        .collect()
}

fn nothing_secret_was_touched(r: &Rig) {
    // boopis never sees a Claude credential: nothing is stored, and no configuration write names a key or a token
    assert!(
        r.store
            .get("boopis.provider.claude-subscription", "api_key")
            .unwrap()
            .is_none()
    );
    for key in r.fake.sets.lock().unwrap().iter() {
        let low = key.to_ascii_lowercase();
        assert!(
            !low.contains("token") && !low.contains("secret") && !low.contains("key_env"),
            "{key}"
        );
    }
}

#[tokio::test]
async fn the_models_question_offers_the_subscription_with_a_note_when_claude_code_is_missing_or_signed_out()
 {
    let r = rig(json!({}));
    let form = at_models(&r).await.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder");
    let ids = enum_of(&form, "choice");
    let at = ids.iter().position(|i| i == "claude-subscription").unwrap();
    assert_eq!(
        form.schema.0["properties"]["choice"]["enumNames"][at],
        "Claude subscription (your Claude Code login)"
    );
    assert_eq!(
        &ids[..3],
        ["free", "openrouter-free", "anthropic"],
        "the free choices stay first, the API key choice stays"
    );
    assert_eq!(form.schema.0["properties"]["choice"]["default"], "free");
    assert!(
        form.body.contains("Claude Code is not installed")
            && form
                .body
                .contains("npm install -g @anthropic-ai/claude-code")
            && form.body.contains("claude auth login"),
        "{}",
        form.body
    );

    // signed out: the same choice, a different note
    r.claude.is(
        true,
        "2.1.328 (Claude Code)",
        Some(&json!({"loggedIn": false})),
    );
    r.setup().reopen_models().unwrap();
    let form = r.setup().advance(None, false).await.unwrap().form.unwrap();
    assert!(
        form.body.contains("installed but not signed in")
            && form.body.contains("claude auth login"),
        "{}",
        form.body
    );
    assert!(
        !form.body.contains("npm install"),
        "signed out is not 'not installed'"
    );

    // signed in: the note says it is ready and that boopis never sees the login
    r.claude.signed_in("2.1.328 (Claude Code)");
    r.setup().reopen_models().unwrap();
    let form = r.setup().advance(None, false).await.unwrap().form.unwrap();
    assert!(
        form.body.contains("is signed in (Claude Max)")
            && form.body.contains("never sees your Claude login"),
        "{}",
        form.body
    );
    assert_eq!(enum_of(&form, "choice")[0], "free");
}

#[tokio::test]
async fn not_installed_shows_the_install_command_and_changes_nothing() {
    let r = rig(json!({}));
    let s = choose_subscription(&r).await;
    assert_eq!(state_of(&s, "models"), StepState::NeedsInput);
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.claude");
    assert!(form.title.contains("Install Claude Code"), "{}", form.title);
    assert_eq!(
        rows(&form),
        "Install it: `npm install -g @anthropic-ai/claude-code`"
    );
    assert!(
        form.signin.is_none(),
        "nothing to sign in to before it is installed"
    );
    assert_eq!(form.submit.0["label"], "Check again");
    assert_eq!(form.cancel.0["label"], "Choose another model");
    assert!(!form.body.contains("Hermes"), "{}", form.body);
    // nothing installed, nothing written
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    // "Check again" with nothing changed asks the same thing again, and is not an error
    let again = r
        .setup()
        .advance(Some(answer("setup.claude", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert_eq!(again.form.unwrap().form_id, "setup.claude");
    nothing_secret_was_touched(&r);
}

#[tokio::test]
async fn signed_out_offers_sign_in_to_claude_through_claude_code_s_own_login() {
    let r = rig(json!({}));
    r.claude.is(
        true,
        "2.1.328 (Claude Code)",
        Some(&json!({"loggedIn": false})),
    );
    let form = choose_subscription(&r).await.form.unwrap();
    assert_eq!(form.form_id, "setup.claude");
    assert_eq!(form.title, "Sign in to Claude");
    // the sign-in names the host's own table entry, never a command
    assert_eq!(
        form.signin,
        Some(super::SignIn {
            provider: "claude-code".into(),
            label: "Sign in to Claude".into()
        })
    );
    assert!(
        crate::connectors::logins::LoginTable::shared()
            .find(super::providers::CLAUDE_LOGIN)
            .is_some(),
        "the card's sign-in is one the host knows"
    );
    assert!(
        form.contents.is_empty(),
        "no command to copy into a terminal"
    );
    assert!(
        form.body.contains("Choose Sign in to Claude")
            && form.body.contains("never sees, reads or stores it"),
        "{}",
        form.body
    );
    assert!(!form.body.contains("Hermes"), "{}", form.body);
    // a login that bills the API is not the subscription: the same sign-in is offered
    r.claude.is(
        true,
        "2.1.328",
        Some(&json!({"loggedIn": true, "authMethod": "api_key"})),
    );
    let form = r
        .setup()
        .advance(Some(answer("setup.claude", json!({}), json!({}))), false)
        .await
        .unwrap()
        .form
        .unwrap();
    assert!(
        form.body.contains("an Anthropic API key") && form.body.contains("bills API usage"),
        "{}",
        form.body
    );
    assert_eq!(
        form.signin.as_ref().map(|s| s.provider.as_str()),
        Some("claude-code")
    );
}

#[tokio::test]
async fn an_old_claude_code_is_told_the_minimum_and_how_to_update() {
    let r = rig(json!({}));
    r.claude.signed_in("2.1.200 (Claude Code)");
    let form = choose_subscription(&r).await.form.unwrap();
    assert_eq!(form.form_id, "setup.claude");
    assert!(form.title.contains("Update Claude Code"));
    assert!(
        form.body.contains("2.1.200") && form.body.contains("2.1.280"),
        "{}",
        form.body
    );
    assert_eq!(rows(&form), "Update it: `claude update`");
}

#[tokio::test]
async fn once_claude_code_is_signed_in_the_bundled_plugin_s_ladder_is_written_with_nothing_to_install()
 {
    let r = rig(json!({}));
    r.fake.bundled_claude();
    let s = choose_subscription(&r).await;
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.claude");
    r.claude.signed_in("2.1.328 (Claude Code)");
    // Check again: no review, no install, straight to the ladder
    let s = r
        .setup()
        .advance(Some(answer("setup.claude", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"}]})
    );
    // the engine's own default model is the first tier: a session freezes it when it is created, and with none the
    // engine refused to read the session back on the first message (storage_unavailable)
    assert_eq!(
        r.fake.config_get("model.provider").await.unwrap(),
        Some(json!("claude-subscription-directsdk-experimental"))
    );
    assert_eq!(
        r.fake.config_get("model.default").await.unwrap(),
        Some(json!("opus"))
    );
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("Claude subscription (Claude Max): opus on your Claude Code login"),
        "{receipt}"
    );
    // a model provider needs no enable entry, and none was written
    assert!(
        !r.fake
            .sets
            .lock()
            .unwrap()
            .iter()
            .any(|k| k.contains("plugins.enabled"))
    );
    nothing_secret_was_touched(&r);

    // running it again changes nothing
    let sets = r.fake.sets.lock().unwrap().len();
    let again = r.setup().advance(None, false).await.unwrap();
    assert!(again.done);
    assert_eq!(r.fake.sets.lock().unwrap().len(), sets);
}

#[tokio::test]
async fn the_ladder_follows_what_the_installed_claude_code_and_plugin_serve_and_is_frontier_only() {
    // Fable is frontier but bills usage credits on a Pro plan, so it is never on the ladder setup writes unless the user opted in
    // Claude Code 2.1.285 serves sonnet and opus, not haiku or fable; sonnet is not frontier, so the ladder is opus alone
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.285 (Claude Code)");
    assert!(choose_subscription(&r).await.done);
    assert_eq!(ladder_names(&r).await, ["opus"]);

    // fable needs Claude Code 2.1.321
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.320 (Claude Code)");
    assert!(choose_subscription(&r).await.done);
    assert_eq!(ladder_names(&r).await, ["opus"]);

    // a pinned plugin that does not know `fable` is not asked for it, whatever Claude Code serves
    let r = rig(json!({}));
    *r.fake.claude_aliases.lock().unwrap() = vec!["haiku", "opus"];
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328");
    let s = choose_subscription(&r).await;
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(ladder_names(&r).await, ["opus"]);
}

async fn ladder_names(r: &Rig) -> Vec<String> {
    let v = r.fake.config_get(LADDER).await.unwrap().unwrap();
    v["tiers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn choose_another_model_goes_back_to_the_models_question() {
    let r = rig(json!({}));
    choose_subscription(&r).await;
    let mut other = answer("setup.claude", json!({}), json!({}));
    other.cancelled = true;
    let s = r.setup().advance(Some(other), false).await.unwrap();
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder");
    assert_eq!(enum_of(&form, "choice")[0], "free");
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
}

#[tokio::test]
async fn an_engine_without_the_claude_plugin_says_so_and_installs_nothing() {
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    let s = choose_subscription(&r).await;
    let step = s.steps.iter().find(|x| x.id == "models").unwrap();
    assert_eq!(step.state, StepState::Blocked);
    assert_eq!(
        step.code.as_deref(),
        Some("hx.setup.subscription_unavailable")
    );
    assert!(
        step.detail
            .contains("does not include the Claude subscription")
            && !crate::error::names_engine(&step.detail),
        "{}",
        step.detail
    );
    assert!(!step.detail.contains("Hermes"), "{}", step.detail);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    assert!(!plugin_names(&r).contains(&PROVIDER_ID.to_owned()));
}

#[tokio::test]
async fn a_plugin_switched_off_by_hand_is_switched_back_on_when_chosen() {
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.fake
        .plugins
        .lock()
        .unwrap()
        .retain(|p| p.name != PROVIDER_ID);
    r.fake.plugins.lock().unwrap().push(PluginEntry {
        name: PROVIDER_ID.into(),
        enabled: false,
    });
    r.claude.signed_in("2.1.328");
    let s = choose_subscription(&r).await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert!(
        r.fake
            .plugins
            .lock()
            .unwrap()
            .iter()
            .any(|p| p.name == PROVIDER_ID && p.enabled)
    );
    assert_eq!(ladder_names(&r).await.len(), 1);
}

#[tokio::test]
async fn the_models_view_reports_claude_codes_state_and_whether_the_plugin_is_there() {
    let r = rig(json!({}));
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(v.claude.state, claude::State::NotInstalled);
    assert!(!v.claude_plugin);
    r.claude.signed_in("2.1.328 (Claude Code)");
    r.fake.bundled_claude();
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(v.claude.state, claude::State::SignedIn);
    assert_eq!(
        (v.claude.version.as_deref(), v.claude.plan.as_deref()),
        (Some("2.1.328"), Some("Claude Max"))
    );
    assert!(v.claude_plugin);
    r.claude
        .is(true, "2.1.328", Some(&json!({"loggedIn": false})));
    assert_eq!(
        r.setup().models_view().await.unwrap().claude.state,
        claude::State::SignedOut
    );
}

// ── the ChatGPT subscription and Gemini (ADR-0030) ──────────────────────────────────────────────────────────────────

/// A JWT-shaped ChatGPT access token on the Plus plan that expires in a day.
fn chatgpt_token() -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 86_400;
    let claims = json!({"exp": exp, "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"}})
        .to_string();
    // base64url without padding, enough for the claims reader
    let mut out = String::new();
    for chunk in claims.as_bytes().chunks(3) {
        let n = chunk.iter().fold(0u32, |a, b| (a << 8) | u32::from(*b)) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(char::from(T[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    format!("h.{out}.s")
}

fn sign_in_to_chatgpt(r: &Rig) {
    r.store
        .set("boopis.chatgpt", "access_token", &chatgpt_token())
        .unwrap();
    r.store
        .set("boopis.chatgpt", "refresh_token", "rt-setup")
        .unwrap();
}

#[tokio::test]
async fn the_models_question_offers_chatgpt_and_gemini_after_the_free_choices() {
    let r = rig(json!({}));
    let form = at_models(&r).await.form.unwrap();
    let ids = enum_of(&form, "choice");
    assert_eq!(
        &ids[..6],
        [
            "free",
            "openrouter-free",
            "anthropic",
            "claude-subscription",
            "chatgpt-subscription",
            "gemini"
        ]
    );
    let names = &form.schema.0["properties"]["choice"]["enumNames"];
    assert_eq!(
        names[4],
        "ChatGPT subscription (sign in with your ChatGPT account)"
    );
    assert_eq!(names[5], "Gemini (a free API key from Google AI Studio)");
    assert_eq!(
        form.schema.0["properties"]["choice"]["default"], "free",
        "free stays the default"
    );
    assert!(!form.body.contains("Hermes"), "{}", form.body);
    assert!(
        !form
            .body
            .to_ascii_lowercase()
            .contains("sign in with google"),
        "Gemini is a key, not a sign-in"
    );
}

#[tokio::test]
async fn chatgpt_asks_for_the_sign_in_then_writes_the_astra_ladder_from_the_accounts_own_catalogue()
{
    let r = rig(json!({}));
    at_models(&r).await;
    let s = choose(&r, "chatgpt-subscription").await;
    assert_eq!(state_of(&s, "models"), StepState::NeedsInput);
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.chatgpt");
    assert_eq!(form.title, "Sign in with ChatGPT");
    assert!(
        form.body.contains("OS keychain") && !form.body.contains("Hermes"),
        "{}",
        form.body
    );
    assert_eq!(form.cancel.0["label"], "Choose another model");
    assert_eq!(
        form.signin,
        Some(super::SignIn {
            provider: "chatgpt".into(),
            label: "Sign in with ChatGPT".into()
        })
    );
    assert!(
        r.fake.config_get(LADDER).await.unwrap().is_none(),
        "nothing is written before the sign-in"
    );
    // "Check again" while still signed out shows the same card
    let s = r
        .setup()
        .advance(Some(answer("setup.chatgpt", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert_eq!(s.form.unwrap().form_id, "setup.chatgpt");

    // the card's sign-in finished (the tokens are in the keychain): the next call writes the ladder. The account's catalogue
    // lists two Astra models and others; the ladder is the lowest frontier one, never luna or sol
    sign_in_to_chatgpt(&r);
    *r.fake.chatgpt_models.lock().unwrap() = vec![
        "gpt-6-luna".into(),
        "gpt-6-astra".into(),
        "gpt-6.3-astra".into(),
        "gpt-6.2-astra".into(),
        "gpt-6-sol".into(),
    ];
    let s = r
        .setup()
        .advance(Some(answer("setup.chatgpt", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]})
    );
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("ChatGPT subscription: gpt-6.2-astra on your ChatGPT sign-in"),
        "{receipt}"
    );
    // the tokens stay in the keychain: no configuration write names them, and the engine's files are not written
    for key in r.fake.sets.lock().unwrap().iter() {
        assert!(
            !key.contains("token") && !key.contains("secrets.") && !key.contains("key_env"),
            "{key}"
        );
    }
    assert!(
        *r.fake.restarts.lock().unwrap() >= 1,
        "the engine restarts and the plugin hands it the sign-in"
    );

    // choose another model goes back
    let r = rig(json!({}));
    at_models(&r).await;
    choose(&r, "chatgpt-subscription").await;
    let mut back = answer("setup.chatgpt", json!({}), json!({}));
    back.cancelled = true;
    assert_eq!(
        r.setup()
            .advance(Some(back), false)
            .await
            .unwrap()
            .form
            .unwrap()
            .form_id,
        "setup.ladder"
    );
}

#[tokio::test]
async fn gemini_asks_for_a_key_with_the_link_keeps_it_in_the_keychain_and_writes_the_ladder_from_its_catalogue()
 {
    let r = rig(json!({}));
    at_models(&r).await;
    let s = choose(&r, "gemini").await;
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.credential.gemini");
    assert_eq!(form.kind, "credential");
    assert_eq!(form.title, "Add your Gemini API key");
    assert!(form.sensitive);
    assert_eq!(
        form.schema.0["properties"]["value"]["x-secret-ref"],
        "secret://provider.gemini/api_key"
    );
    assert_eq!(
        form.links,
        [(
            "Get a free key".to_owned(),
            "https://aistudio.google.com/apikey".to_owned()
        )]
    );
    assert!(
        form.body.contains("https://aistudio.google.com/apikey") && form.body.contains("free"),
        "{}",
        form.body
    );
    assert!(!form.body.contains("Hermes"), "{}", form.body);

    let s = r
        .setup()
        .advance(
            Some(answer(
                "setup.credential.gemini",
                json!({}),
                json!({"value": KEY}),
            )),
            false,
        )
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.store
            .get("boopis.provider.gemini", "api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    // wired to the variable the engine's Gemini provider reads, through the host's secret source
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.env.GOOGLE_API_KEY")
            .await
            .unwrap(),
        Some(json!("secret://provider.gemini/api_key"))
    );
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.enabled")
            .await
            .unwrap(),
        Some(json!(true))
    );
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "hydrogen", "model": "gemini/gemini-4-hydrogen"}]}),
        "the catalogue lists Hydrogen and Carbon, not Neon: Hydrogen alone, and never Carbon"
    );
    // the key is never in the configuration or the receipt
    let cfg = r.fake.config.lock().unwrap().to_string();
    assert!(!cfg.contains(KEY));
    assert!(!s.receipt.unwrap().lines.join("\n").contains(KEY));
    assert!(r.setup().models_view().await.unwrap().gemini_key);
}

#[tokio::test]
async fn a_gemini_key_already_in_the_profile_is_used_without_asking() {
    let r = rig(json!({}));
    std::fs::write(r.fake.home.join(".env"), "GEMINI_API_KEY=abc\n").unwrap();
    at_models(&r).await;
    let s = choose(&r, "gemini").await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(ladder_names(&r).await, ["hydrogen"]);
    assert!(
        r.fake
            .config_get("secrets.boopis_host.env.GOOGLE_API_KEY")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn the_models_view_reports_the_chatgpt_sign_in_and_the_gemini_key() {
    let r = rig(json!({}));
    let v = r.setup().models_view().await.unwrap();
    let c = v.chatgpt.unwrap();
    assert_eq!((c.state, c.plan), (crate::chatgpt::State::SignedOut, None));
    assert!(!v.gemini_key);
    sign_in_to_chatgpt(&r);
    r.store
        .set("boopis.provider.gemini", "api_key", KEY)
        .unwrap();
    let v = r.setup().models_view().await.unwrap();
    let c = v.chatgpt.unwrap();
    assert_eq!(
        (c.state, c.plan.as_deref()),
        (crate::chatgpt::State::SignedIn, Some("plus"))
    );
    assert!(v.gemini_key);
    // the view carries no token: only the state and the plan
    let shown = serde_json::to_string(&r.setup().models_view().await.unwrap()).unwrap();
    assert!(
        !shown.contains("rt-setup")
            && !shown.contains(&chatgpt_token()[..20])
            && !shown.contains(KEY)
    );
}

#[test]
fn the_runtime_s_plugins_are_placed_in_the_profile_once() {
    let tmp = tempfile::tempdir().unwrap();
    let (root, home) = (tmp.path().join("runtime"), tmp.path().join("home"));
    let plugin = root.join("plugins").join(PROVIDER_ID);
    std::fs::create_dir_all(plugin.join("tests")).unwrap();
    std::fs::write(
        plugin.join("plugin.yaml"),
        format!("name: {PROVIDER_ID}\nversion: 0.3.5\n"),
    )
    .unwrap();
    std::fs::write(plugin.join("__init__.py"), "").unwrap();
    std::fs::write(plugin.join("LICENSE"), "MIT License").unwrap();
    assert!(super::install::install_runtime_plugins(&root, &home).unwrap());
    let placed = home.join("plugins").join(PROVIDER_ID);
    assert!(placed.join("__init__.py").is_file() && placed.join("LICENSE").is_file());
    assert!(!placed.join("tests").exists());
    assert!(
        !super::install::install_runtime_plugins(&root, &home).unwrap(),
        "the same version is not copied again"
    );
    // a runtime that carries no plugins (an older build) is not an error
    assert!(!super::install::install_runtime_plugins(&tmp.path().join("none"), &home).unwrap());
}

/// The Windows build says what it lacks, in the receipt, and says what still works (nothing is hidden).
#[test]
fn the_windows_gaps_are_named_with_what_still_works() {
    let gaps = windows_gaps().join("\n");
    assert!(
        gaps.contains("keychain") && gaps.contains("free Nous models"),
        "{gaps}"
    );
    assert!(
        gaps.contains("sandbox") && gaps.contains("never runs unsandboxed"),
        "{gaps}"
    );
    assert!(gaps.contains("mods are off"), "{gaps}");
}

#[tokio::test]
async fn a_chatgpt_plan_with_no_sol_or_astra_writes_no_ladder_and_says_governed_mode_is_unavailable()
 {
    // the account's catalogue lists luna and a GPT-6 Sol and Astra below the 6.2 floor: no frontier model
    let r = rig(json!({}));
    at_models(&r).await;
    choose(&r, "chatgpt-subscription").await;
    sign_in_to_chatgpt(&r);
    *r.fake.chatgpt_models.lock().unwrap() = vec![
        "gpt-6-luna".into(),
        "gpt-6-sol".into(),
        "gpt-6-astra".into(),
    ];
    let s = r
        .setup()
        .advance(Some(answer("setup.chatgpt", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains(
            "lists no GPT Sol or GPT Astra of 6.2 or later, so governed mode is unavailable"
        ) && receipt.contains("GPT-6.2 Astra or later"),
        "{receipt}"
    );
}

// ---- ADR-0037: the repair of a ladder an earlier setup wrote

fn legacy_claude() -> Value {
    json!({"tiers": [
        {"name": "haiku", "model": "claude-subscription-directsdk-experimental/haiku"},
        {"name": "sonnet", "model": "claude-subscription-directsdk-experimental/sonnet"},
        {"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"}]})
}

async fn finished_with(r: &Rig, ladder: &Value) {
    a_home_with_the_plugin(r);
    let marker = super::state::path(&r.fake.home);
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, E2E_SETUP_DONE).unwrap();
    r.fake
        .config_set(LADDER, &ladder.to_string())
        .await
        .unwrap();
    r.fake.config_set("model.default", "haiku").await.unwrap();
    let mut st = super::state::load(&r.fake.home).unwrap();
    st.route_checked = true;
    st.consent = super::state::Consent::Granted;
    super::state::save(&r.fake.home, &st).unwrap();
}

#[tokio::test]
async fn a_ladder_setup_wrote_with_cheap_tiers_is_rewritten_once_to_the_frontier_ladder() {
    let r = rig(main_provider());
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328 (Claude Code)");
    finished_with(&r, &legacy_claude()).await;
    let c = r.setup().check().await.unwrap();
    assert!(
        c.needed
            && c.reason
                .starts_with("governed mode runs only on frontier models"),
        "{}",
        c.reason
    );
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        ladder_names(&r).await,
        ["opus"],
        "Fable bills usage credits on a Pro plan: opt-in only"
    );
    assert_eq!(
        r.fake.config_get("model.default").await.unwrap(),
        Some(json!("opus"))
    );
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(receipt.contains("the tier ladder is now"), "{receipt}");
    // recorded: later starts ask for nothing
    assert!(!r.setup().check().await.unwrap().needed);
    let st = super::state::load(&r.fake.home).unwrap();
    assert!(st.frontier_checked && st.ladders_checked);
}

#[tokio::test]
async fn the_chatgpt_and_gemini_ladders_of_an_earlier_setup_are_rewritten_too() {
    let r = rig(main_provider());
    *r.fake.chatgpt_models.lock().unwrap() = vec!["gpt-6-sol".into(), "gpt-6.2-astra".into()];
    finished_with(
        &r,
        &json!({"tiers": [
            {"name": "luna", "model": "openai-codex/gpt-6-luna"},
            {"name": "sol", "model": "openai-codex/gpt-6-sol"}]}),
    )
    .await;
    assert!(r.setup().check().await.unwrap().needed);
    assert!(r.setup().advance(None, false).await.unwrap().done);
    assert_eq!(
        ladder_names(&r).await,
        ["astra"],
        "the catalogue lists no 6.2 Sol"
    );

    let r = rig(main_provider());
    finished_with(
        &r,
        &json!({"tiers": [
            {"name": "flash", "model": "gemini/gemini-3.8-flash"},
            {"name": "pro", "model": "gemini/gemini-3.1-pro-preview"}]}),
    )
    .await;
    assert!(r.setup().advance(None, false).await.unwrap().done);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "hydrogen", "model": "gemini/gemini-4-hydrogen"}]})
    );
}

#[tokio::test]
async fn a_ladder_setup_wrote_that_cannot_be_rewritten_is_reported_not_guessed() {
    // a ChatGPT plan whose catalogue lists no Astra: the old ladder stays, and the receipt names its tiers
    let r = rig(main_provider());
    let legacy = json!({"tiers": [
        {"name": "luna", "model": "openai-codex/gpt-6-luna"},
        {"name": "sol", "model": "openai-codex/gpt-6-sol"}]});
    finished_with(&r, &legacy).await;
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done);
    assert_eq!(r.fake.config_get(LADDER).await.unwrap().unwrap(), legacy);
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("governed mode is unavailable on the tier ladder you set")
            && receipt.contains("tier 'luna' runs openai-codex/gpt-6-luna"),
        "{receipt}"
    );
}

#[tokio::test]
async fn a_ladder_the_user_wrote_by_hand_is_never_rewritten_only_reported() {
    let r = rig(main_provider());
    let hand = json!({"tiers": [
        {"name": "cheap", "model": "claude-subscription-directsdk-experimental/haiku"},
        {"name": "mine", "model": "main/fake"}]});
    finished_with(&r, &hand).await;
    // setup does not even ask to run again for it: nothing it may change
    let c = r.setup().check().await.unwrap();
    assert!(!c.needed, "{}", c.reason);
    // but if it does run, the ladder is as the user left it
    let mut st = super::state::load(&r.fake.home).unwrap();
    st.frontier_checked = false;
    st.ladders_checked = false;
    super::state::save(&r.fake.home, &st).unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done);
    assert_eq!(r.fake.config_get(LADDER).await.unwrap().unwrap(), hand);
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(receipt.contains("tier 'mine' runs main/fake"), "{receipt}");
}

#[tokio::test]
async fn the_models_view_says_whether_governed_mode_can_run_on_what_is_saved() {
    let r = rig(main_provider());
    let v = r.setup().models_view().await.unwrap();
    // no ladder and no Anthropic key: the plugin's own ladder has nothing to run on
    assert!(!v.governed.available);
    assert!(v.governed.why.unwrap().contains("Anthropic key"));
    assert_eq!(v.governed.allowed[0], "Claude Opus 5.5");

    r.fake
        .config_set(LADDER, &legacy_claude().to_string())
        .await
        .unwrap();
    let v = r.setup().models_view().await.unwrap();
    assert!(!v.governed.available);
    assert_eq!(
        v.governed
            .tiers
            .iter()
            .map(|t| t.frontier)
            .collect::<Vec<_>>(),
        [false, false, true]
    );
    assert!(v.governed.why.unwrap().starts_with("tier 'haiku' runs"));

    r.fake
        .config_set(
            LADDER,
            &json!({"tiers": [{"name": "opus", "model": "anthropic/claude-opus-5-5"}]}).to_string(),
        )
        .await
        .unwrap();
    let v = r.setup().models_view().await.unwrap();
    assert!(v.governed.available && v.governed.why.is_none());
}

#[tokio::test]
async fn fable_joins_the_subscription_ladder_only_when_the_user_opted_in_and_claude_code_serves_it()
{
    // opted in, and Claude Code 2.1.328 serves it: opus, then fable
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328 (Claude Code)");
    let mut st = super::state::load(&r.fake.home).unwrap();
    st.set_heavy("fable", true);
    super::state::save(&r.fake.home, &st).unwrap();
    assert!(choose_subscription(&r).await.done);
    assert_eq!(ladder_names(&r).await, ["opus", "fable"]);

    // opted in, but 2.1.320 does not serve it (it needs 2.1.321): opus alone
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.320 (Claude Code)");
    let mut st = super::state::load(&r.fake.home).unwrap();
    st.set_heavy("fable", true);
    super::state::save(&r.fake.home, &st).unwrap();
    assert!(choose_subscription(&r).await.done);
    assert_eq!(ladder_names(&r).await, ["opus"]);
}

/// "Change models": the question is asked again and the user picks `choice`.
async fn choose_again(r: &Rig, choice: &str) -> super::Status {
    r.setup().reopen_models().unwrap();
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.ladder");
    choose(r, choice).await
}

fn heavy_of(v: &super::ModelsView, id: &str) -> (bool, bool, bool) {
    let c = v.heavy.iter().find(|c| c.id == id).unwrap();
    (c.applies, c.on, c.blocked.is_none())
}

#[tokio::test]
async fn the_models_tab_turns_fable_on_and_off_on_the_subscription_and_setup_run_again_keeps_the_choice()
 {
    let r = rig(json!({}));
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328 (Claude Code)");
    assert!(choose_subscription(&r).await.done);
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(heavy_of(&v, "fable"), (true, false, true));
    assert!(!heavy_of(&v, "grok").0, "no xAI key: no Grok choice");
    assert!(
        v.heavy[0]
            .reason
            .contains("usage credits from the first request")
    );

    let v = r.setup().set_heavy("fable", true).await.unwrap();
    assert!(heavy_of(&v, "fable").1);
    assert_eq!(ladder_names(&r).await, ["opus", "fable"]);
    assert!(v.governed.tiers.iter().any(|t| t.heavy && t.frontier));
    assert!(super::state::load(&r.fake.home).unwrap().optins().fable);

    // setup run again (choosing the subscription once more) keeps it
    assert!(choose_again(&r, "claude-subscription").await.done);
    assert_eq!(ladder_names(&r).await, ["opus", "fable"]);

    let v = r.setup().set_heavy("fable", false).await.unwrap();
    assert!(!heavy_of(&v, "fable").1);
    assert_eq!(ladder_names(&r).await, ["opus"]);
    assert!(!super::state::load(&r.fake.home).unwrap().optins().fable);
    assert!(choose_again(&r, "claude-subscription").await.done);
    assert_eq!(ladder_names(&r).await, ["opus"]);

    // a Claude Code too old to serve it refuses, and writes nothing
    r.claude.signed_in("2.1.300 (Claude Code)");
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(heavy_of(&v, "fable"), (true, false, false));
    let e = r.setup().set_heavy("fable", true).await.unwrap_err();
    assert!(e.to_string().contains("2.1.321"), "{e}");
    assert_eq!(ladder_names(&r).await, ["opus"]);
    assert!(!super::state::load(&r.fake.home).unwrap().optins().fable);

    // an id that is not a heavy model is refused
    assert!(r.setup().set_heavy("opus", true).await.is_err());
}

#[tokio::test]
async fn on_an_anthropic_key_the_default_ladder_is_opus_alone_and_fable_is_the_same_opt_in() {
    let r = rig(json!({}));
    r.store
        .set("boopis.provider.anthropic", "api_key", KEY)
        .unwrap();
    r.claude.signed_in("2.1.328 (Claude Code)");
    let s = r.setup().advance(None, false).await.unwrap();
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.config");
    let s = r
        .setup()
        .advance(Some(answer("setup.config", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("Claude ladder: Opus 5.5 on your Anthropic key")
            && !receipt.contains("then Fable"),
        "{receipt}"
    );
    assert!(
        r.fake.config_get(LADDER).await.unwrap().is_none(),
        "the plugin's own default stands"
    );

    let v = r.setup().models_view().await.unwrap();
    assert!(v.governed.available);
    assert_eq!(heavy_of(&v, "fable"), (true, false, true));

    let v = r.setup().set_heavy("fable", true).await.unwrap();
    assert!(heavy_of(&v, "fable").1 && v.governed.available);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [
            {"name": "opus", "model": "anthropic/claude-opus-5-5"},
            {"name": "fable", "model": "anthropic/claude-fable-5-2"}]})
    );
    let v = r.setup().set_heavy("fable", false).await.unwrap();
    assert!(!heavy_of(&v, "fable").1);
    assert_eq!(ladder_names(&r).await, ["opus"]);
}

#[test]
fn the_models_the_host_names_for_an_anthropic_key_are_the_plugins_own_frontier_ones_and_only_fable_is_heavy()
 {
    use super::providers::{ANTHROPIC, ANTHROPIC_FABLE, ANTHROPIC_OPUS};
    // the plugin's default ladder names these through the vendored contraprova: the two must not drift
    let vendored = include_str!("../../../../../plugins/boopis/_vendor/contraprova/interfaces.py");
    assert!(vendored.contains(&format!("OPUS = \"{ANTHROPIC_OPUS}\"")));
    assert!(vendored.contains(&format!("FABLE = \"{ANTHROPIC_FABLE}\"")));
    assert!(crate::frontier::is_frontier(ANTHROPIC, ANTHROPIC_OPUS));
    assert!(!crate::frontier::is_heavy(ANTHROPIC, ANTHROPIC_OPUS));
    assert!(crate::frontier::is_frontier(ANTHROPIC, ANTHROPIC_FABLE));
    assert!(crate::frontier::is_heavy(ANTHROPIC, ANTHROPIC_FABLE));
}

// ---- ADR-0037, the added families: every setup ladder, with and without the new models in the provider's list

fn models(list: &[&str]) -> Vec<String> {
    list.iter().map(|m| (*m).to_owned()).collect()
}

async fn chatgpt_ladder_for(listed: &[&str]) -> (Option<Value>, String) {
    let r = rig(json!({}));
    at_models(&r).await;
    choose(&r, "chatgpt-subscription").await;
    sign_in_to_chatgpt(&r);
    *r.fake.chatgpt_models.lock().unwrap() = models(listed);
    let s = r
        .setup()
        .advance(Some(answer("setup.chatgpt", json!({}), json!({}))), false)
        .await
        .unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    (
        r.fake.config_get(LADDER).await.unwrap(),
        s.receipt.unwrap().lines.join("\n"),
    )
}

#[tokio::test]
async fn the_chatgpt_ladder_is_sol_then_astra_from_what_the_account_lists() {
    let (ladder, receipt) = chatgpt_ladder_for(&[
        "gpt-6-luna",
        "gpt-6.2-astra",
        "gpt-6.3-sol",
        "gpt-6.2-sol",
        "gpt-6.1-sol",
        "gpt-6-astra",
    ])
    .await;
    assert_eq!(
        ladder.unwrap(),
        json!({"tiers": [
            {"name": "sol", "model": "openai-codex/gpt-6.2-sol"},
            {"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]})
    );
    assert!(
        receipt.contains("gpt-6.2-sol, then gpt-6.2-astra on your ChatGPT sign-in"),
        "{receipt}"
    );

    // Sol alone and Astra alone: the rung the account lacks is left out, never guessed
    let (ladder, _) = chatgpt_ladder_for(&["gpt-6.2-sol", "gpt-6-astra"]).await;
    assert_eq!(
        ladder.unwrap(),
        json!({"tiers": [{"name": "sol", "model": "openai-codex/gpt-6.2-sol"}]})
    );
    let (ladder, _) = chatgpt_ladder_for(&["gpt-6.2-astra", "gpt-6.1-sol"]).await;
    assert_eq!(
        ladder.unwrap(),
        json!({"tiers": [{"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]})
    );
    // neither: no ladder, and the line says why (the other test of this file checks its words)
    let (ladder, receipt) = chatgpt_ladder_for(&["gpt-6-luna", "gpt-6.1-sol"]).await;
    assert!(ladder.is_none());
    assert!(
        receipt.contains("governed mode is unavailable"),
        "{receipt}"
    );
}

async fn gemini_ladder_for(listed: &[&str]) -> (Option<Value>, String) {
    let r = rig(json!({}));
    std::fs::write(r.fake.home.join(".env"), "GEMINI_API_KEY=abc\n").unwrap();
    *r.fake.gemini_models.lock().unwrap() = models(listed);
    at_models(&r).await;
    let s = choose(&r, "gemini").await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    (
        r.fake.config_get(LADDER).await.unwrap(),
        s.receipt.unwrap().lines.join("\n"),
    )
}

#[tokio::test]
async fn the_gemini_ladder_is_hydrogen_then_neon_from_what_the_catalogue_lists_and_never_carbon() {
    let (ladder, receipt) = gemini_ladder_for(&[
        "gemini-3.8-flash",
        "gemini-4-neon",
        "gemini-4-carbon",
        "gemini-4-hydrogen",
    ])
    .await;
    assert_eq!(
        ladder.unwrap(),
        json!({"tiers": [
            {"name": "hydrogen", "model": "gemini/gemini-4-hydrogen"},
            {"name": "neon", "model": "gemini/gemini-4-neon"}]})
    );
    assert!(
        receipt.contains("gemini-4-hydrogen, then gemini-4-neon"),
        "{receipt}"
    );
    let (ladder, _) =
        gemini_ladder_for(&["gemini-4-neon", "gemini-4-carbon", "gemini-3-hydrogen"]).await;
    assert_eq!(
        ladder.unwrap(),
        json!({"tiers": [{"name": "neon", "model": "gemini/gemini-4-neon"}]})
    );
    // Carbon alone is allowed but is not on the ladder: no ladder, and the line says so
    let (ladder, receipt) = gemini_ladder_for(&["gemini-3.8-flash", "gemini-4-carbon"]).await;
    assert!(ladder.is_none());
    assert!(
        receipt.contains("no Gemini 4 Hydrogen or Gemini 4 Neon")
            && receipt.contains("Gemini 4 Carbon is allowed but is not on the ladder"),
        "{receipt}"
    );
}

#[tokio::test]
async fn setup_never_writes_a_heavy_model_to_a_ladder_it_builds_from_a_catalogue() {
    use super::providers::{CHATGPT_RUNGS, GEMINI_RUNGS, ladder_from_catalogue};
    // a catalogue that lists Grok and Fable under a provider is no way onto a ladder: the rungs name their families, and a heavy
    // family is never a rung
    let weird = models(&[
        "grok-4.7",
        "claude-fable-5-2",
        "gpt-6.2-sol",
        "gemini-4-neon",
    ]);
    for rungs in [CHATGPT_RUNGS, GEMINI_RUNGS] {
        for provider in ["openai-codex", "gemini", "xai", "anthropic"] {
            for (_, m) in ladder_from_catalogue(provider, &weird, rungs) {
                let (p, id) = crate::frontier::split(&m);
                assert!(!crate::frontier::is_heavy(p, id), "{m}");
            }
        }
    }
    for (family, _) in CHATGPT_RUNGS.iter().chain(GEMINI_RUNGS) {
        assert!(
            ["gpt-sol", "gpt-astra", "gemini-hydrogen", "gemini-neon"].contains(family),
            "{family}"
        );
    }
}

// ---- heavy models: Grok on an xAI key

fn xai_rig() -> Rig {
    let r = rig(json!({}));
    r.store.set("boopis.provider.xai", "api_key", KEY).unwrap();
    r
}

#[tokio::test]
async fn xai_alone_has_no_governed_mode_until_grok_is_turned_on_and_the_choice_is_remembered() {
    let r = xai_rig();
    // no ladder, no Anthropic key, an xAI key: governed mode is unavailable, and the reason says why and where the switch is
    let v = r.setup().models_view().await.unwrap();
    assert!(!v.governed.available);
    let why = v.governed.why.clone().unwrap();
    assert!(
        why.contains("heavy") && why.contains("Turn on Grok"),
        "{why}"
    );
    assert_eq!(heavy_of(&v, "grok"), (true, false, true));
    assert!(!heavy_of(&v, "fable").0);
    let grok = v.heavy.iter().find(|c| c.id == "grok").unwrap();
    assert!(grok.reason.contains("token-heavy"), "{}", grok.reason);

    // choosing xAI in setup with the switch off writes no ladder and says so
    at_models(&r).await;
    let s = choose(&r, "xai").await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains("governed mode stays unavailable on it until you turn on Grok"),
        "{receipt}"
    );

    // turning it on: Grok is the ladder, and the engine's default model
    let v = r.setup().set_heavy("grok", true).await.unwrap();
    assert!(
        heavy_of(&v, "grok").1 && v.governed.available,
        "{:?}",
        v.governed.why
    );
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "grok", "model": "xai/grok-4.7"}]})
    );
    assert_eq!(
        r.fake.config_get("model.default").await.unwrap(),
        Some(json!("grok-4.7"))
    );
    assert!(v.governed.tiers[0].heavy && v.governed.tiers[0].frontier);
    assert!(super::state::load(&r.fake.home).unwrap().optins().grok);

    // setup run again keeps it
    assert!(choose_again(&r, "xai").await.done);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [{"name": "grok", "model": "xai/grok-4.7"}]})
    );

    // turning it off takes it away: no ladder is left, and governed mode is unavailable again
    let v = r.setup().set_heavy("grok", false).await.unwrap();
    assert!(!heavy_of(&v, "grok").1 && !v.governed.available);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    assert!(!super::state::load(&r.fake.home).unwrap().optins().grok);
    let s = choose_again(&r, "xai").await;
    assert!(s.done);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
}

#[tokio::test]
async fn grok_needs_an_xai_key_and_a_grok_in_its_catalogue() {
    // no key: no choice to make
    let r = rig(json!({}));
    let v = r.setup().models_view().await.unwrap();
    assert!(!heavy_of(&v, "grok").0);
    assert!(r.setup().set_heavy("grok", true).await.is_err());

    // a key, but a catalogue with no Grok 4.7 or later: nothing is written, and nothing is remembered
    let r = xai_rig();
    *r.fake.xai_models.lock().unwrap() = models(&["grok-4.6", "grok-4"]);
    let e = r.setup().set_heavy("grok", true).await.unwrap_err();
    assert!(e.to_string().contains("no Grok 4.7 or later"), "{e}");
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    assert!(!super::state::load(&r.fake.home).unwrap().optins().grok);
}

#[tokio::test]
async fn the_xai_choice_asks_for_a_key_and_wires_it() {
    let r = rig(json!({}));
    at_models(&r).await;
    let form = choose(&r, "xai").await.form.unwrap();
    assert_eq!(form.form_id, "setup.credential.xai");
    assert_eq!(form.title, "Add your xAI API key");
    assert_eq!(
        form.schema.0["properties"]["value"]["x-secret-ref"],
        "secret://provider.xai/api_key"
    );
    let s = r
        .setup()
        .advance(
            Some(answer(
                "setup.credential.xai",
                json!({}),
                json!({"value": KEY}),
            )),
            false,
        )
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.env.XAI_API_KEY")
            .await
            .unwrap(),
        Some(json!("secret://provider.xai/api_key"))
    );
    assert!(!r.fake.config.lock().unwrap().to_string().contains(KEY));
}

// ---- ADR-0037: the repair of the ladders the 0.1.6 candidate wrote

#[tokio::test]
async fn the_candidates_opus_and_fable_ladder_is_rewritten_to_opus_unless_the_user_opted_in() {
    let ladder = json!({"tiers": [
        {"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"},
        {"name": "fable", "model": "claude-subscription-directsdk-experimental/fable"}]});
    let r = rig(main_provider());
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328 (Claude Code)");
    finished_with(&r, &ladder).await;
    let c = r.setup().check().await.unwrap();
    assert!(c.needed, "{}", c.reason);
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(ladder_names(&r).await, ["opus"]);
    assert!(!r.setup().check().await.unwrap().needed);

    // the same ladder with Fable turned on is what the user asked for: nothing to do
    let r = rig(main_provider());
    r.fake.bundled_claude();
    r.claude.signed_in("2.1.328 (Claude Code)");
    finished_with(&r, &ladder).await;
    let mut st = super::state::load(&r.fake.home).unwrap();
    st.set_heavy("fable", true);
    super::state::save(&r.fake.home, &st).unwrap();
    assert!(!r.setup().check().await.unwrap().needed);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        ladder,
        "left alone"
    );
}

#[tokio::test]
async fn the_candidates_astra_only_ladder_becomes_sol_then_astra_and_stays_when_sol_is_not_listed()
{
    let astra = json!({"tiers": [{"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]});
    let r = rig(main_provider());
    *r.fake.chatgpt_models.lock().unwrap() = models(&["gpt-6.2-sol", "gpt-6.2-astra"]);
    finished_with(&r, &astra).await;
    assert!(r.setup().check().await.unwrap().needed);
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [
            {"name": "sol", "model": "openai-codex/gpt-6.2-sol"},
            {"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]})
    );
    assert_eq!(
        r.fake.config_get("model.default").await.unwrap(),
        Some(json!("gpt-6.2-sol"))
    );
    assert!(!r.setup().check().await.unwrap().needed);

    // the account lists no Sol: the same ladder stays, and it is recorded
    let r = rig(main_provider());
    *r.fake.chatgpt_models.lock().unwrap() = models(&["gpt-6.2-astra"]);
    finished_with(&r, &astra).await;
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done);
    assert_eq!(r.fake.config_get(LADDER).await.unwrap().unwrap(), astra);
    assert!(!r.setup().check().await.unwrap().needed);
}

#[tokio::test]
async fn the_candidates_carbon_only_ladder_becomes_hydrogen_then_neon_and_stays_when_neither_is_listed()
 {
    let carbon = json!({"tiers": [{"name": "carbon", "model": "gemini/gemini-4-carbon"}]});
    let r = rig(main_provider());
    *r.fake.gemini_models.lock().unwrap() =
        models(&["gemini-4-hydrogen", "gemini-4-neon", "gemini-4-carbon"]);
    finished_with(&r, &carbon).await;
    assert!(r.setup().check().await.unwrap().needed);
    assert!(r.setup().advance(None, false).await.unwrap().done);
    assert_eq!(ladder_names(&r).await, ["hydrogen", "neon"]);

    let r = rig(main_provider());
    *r.fake.gemini_models.lock().unwrap() = models(&["gemini-4-carbon"]);
    finished_with(&r, &carbon).await;
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        carbon,
        "Carbon is allowed: a working ladder is not taken away"
    );
}

#[tokio::test]
async fn a_hand_written_ladder_that_names_a_heavy_model_is_the_users_own_and_is_left_alone() {
    for hand in [
        json!({"tiers": [
            {"name": "cheap", "model": "anthropic/claude-opus-5-5"},
            {"name": "strong", "model": "anthropic/claude-fable-5-2"}]}),
        json!({"tiers": [{"name": "g", "model": "xai/grok-4.7"}]}),
        json!({"tiers": [
            {"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"},
            {"name": "mine", "model": "claude-subscription-directsdk-experimental/fable"},
            {"name": "x", "model": "xai/grok-4.7"}]}),
    ] {
        let r = rig(main_provider());
        r.fake.bundled_claude();
        r.claude.signed_in("2.1.328 (Claude Code)");
        finished_with(&r, &hand).await;
        let c = r.setup().check().await.unwrap();
        assert!(!c.needed, "{}: {hand}", c.reason);
        // and when setup does run, the ladder is as it was and governed mode accepts it
        let mut st = super::state::load(&r.fake.home).unwrap();
        st.frontier_checked = false;
        st.ladders_checked = false;
        super::state::save(&r.fake.home, &st).unwrap();
        assert!(r.setup().advance(None, false).await.unwrap().done);
        assert_eq!(r.fake.config_get(LADDER).await.unwrap().unwrap(), hand);
        let v = r.setup().models_view().await.unwrap();
        assert!(v.governed.available, "{hand}");
        assert!(v.governed.tiers.iter().any(|t| t.heavy));
    }
}

#[test]
fn the_old_fable_opt_in_is_read_into_the_heavy_list_once() {
    let dir = tempfile::tempdir().unwrap();
    let p = super::state::path(dir.path());
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, r#"{"schema_version": 1, "subscription_fable": true}"#).unwrap();
    let st = super::state::load(dir.path()).unwrap();
    assert!(st.optins().fable && !st.optins().grok && !st.subscription_fable);
    super::state::save(dir.path(), &st).unwrap();
    assert!(super::state::load(dir.path()).unwrap().optins().fable);
    // turning it off sticks
    let mut st = super::state::load(dir.path()).unwrap();
    st.set_heavy("fable", false);
    super::state::save(dir.path(), &st).unwrap();
    assert!(!super::state::load(dir.path()).unwrap().optins().fable);
}
