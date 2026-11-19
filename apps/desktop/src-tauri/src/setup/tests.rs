//! The engine against an in-memory Hermes: the flow, its consent, resuming and idempotence. The real CLI is exercised by
//! `tests/setup_live.rs` against a real Hermes.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::install::Bundle;
use super::ops::{CatalogEntry, HermesOps, PluginEntry};
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
    /// Hermes's plugin catalog: the entry for the Claude subscription plugin, and what an install of it does.
    plugin_catalog: Mutex<PluginCatalog>,
}

/// A scripted plugin catalog (no network, no clone).
struct PluginCatalog {
    entry: Option<CatalogEntry>,
    /// The error the next installs answer with (while `Some`), instead of installing.
    refuse: Option<Error>,
    installs: u32,
    /// The `ALIASES` the installed build's `model_catalog.py` carries.
    aliases: Vec<&'static str>,
}

impl Default for PluginCatalog {
    fn default() -> Self {
        Self {
            entry: Some(CatalogEntry {
                name: claude::CATALOG_NAME.into(),
                version: "0.3.5".into(),
                sha: "6313fad5ddf2c060e7b16782f4860c0d5cdbfcac".into(),
                repo: "https://github.com/NousResearch/hermes-official-plugins".into(),
                subdir: "claude-subscription-directsdk".into(),
                tier: "official".into(),
                provides: Vec::new(),
            }),
            refuse: None,
            installs: 0,
            aliases: vec!["sonnet", "haiku", "opus", "fable"],
        }
    }
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
            plugin_catalog: Mutex::new(PluginCatalog::default()),
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
    async fn catalog_entry(&self, name: &str) -> Result<Option<CatalogEntry>> {
        assert_eq!(name, claude::CATALOG_NAME);
        Ok(self.plugin_catalog.lock().unwrap().entry.clone())
    }
    async fn install_catalog_plugin(&self, name: &str) -> Result<()> {
        assert_eq!(name, claude::CATALOG_NAME);
        let mut c = self.plugin_catalog.lock().unwrap();
        if let Some(e) = &c.refuse {
            return Err(match e {
                Error::Setup(code, m) => Error::Setup(code, m.clone()),
                _ => Error::Config("refused".into()),
            });
        }
        c.installs += 1;
        // what `hermes plugins install` leaves: the plugin's directory, named by its manifest, with its model catalogue
        let dir = super::ops::plugins_dir(&self.home).join(PROVIDER_ID);
        std::fs::create_dir_all(&dir).unwrap();
        let rows = c
            .aliases
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
            enabled: true, // a model provider needs no enable entry: Hermes lists it as enabled
        });
        Ok(())
    }
    async fn free_models(&self, provider: &str) -> Result<Vec<String>> {
        assert_eq!(provider, "openrouter");
        Ok(self.catalogue.lock().unwrap().clone())
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
        Setup::new(self.fake.clone(), self.store.clone(), self.bundle.clone())
            .with_claude(self.claude.clone())
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
        step.detail.contains("dedicated Hermes profile")
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
    assert!(s.steps[0].detail.contains("never touches another Hermes"));
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
    assert_eq!(s.steps[0].detail, "Hermes 0.23.2 is unpacked");
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
        Some("hx.hermes.unavailable")
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
async fn not_installed_shows_the_install_and_sign_in_commands_and_changes_nothing() {
    let r = rig(json!({}));
    let s = choose_subscription(&r).await;
    assert_eq!(state_of(&s, "models"), StepState::NeedsInput);
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.claude");
    assert!(form.title.contains("Install Claude Code"), "{}", form.title);
    let shown = rows(&form);
    assert!(
        shown.contains("`npm install -g @anthropic-ai/claude-code`")
            && shown.contains("`claude auth login`"),
        "{shown}"
    );
    assert_eq!(form.submit.0["label"], "Check again");
    assert_eq!(form.cancel.0["label"], "Choose another model");
    assert!(
        !form
            .body
            .to_ascii_lowercase()
            .contains("sign in with google"),
        "no login screen of ours"
    );
    // nothing installed, nothing written
    assert!(!plugin_names(&r).contains(&PROVIDER_ID.to_owned()));
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 0);
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
async fn signed_out_says_so_and_shows_only_the_sign_in_command() {
    let r = rig(json!({}));
    r.claude.is(
        true,
        "2.1.328 (Claude Code)",
        Some(&json!({"loggedIn": false})),
    );
    let form = choose_subscription(&r).await.form.unwrap();
    assert_eq!(form.form_id, "setup.claude");
    assert!(
        form.title.contains("Sign in to Claude Code"),
        "{}",
        form.title
    );
    assert_eq!(rows(&form), "Sign in: `claude auth login`");
    assert!(
        form.body.contains("never sees, reads or stores it"),
        "{}",
        form.body
    );
    // a login that bills the API is not the subscription
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
    assert_eq!(rows(&form), "Sign in: `claude auth login`");
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
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 0);
}

#[tokio::test]
async fn once_claude_code_is_ready_the_plugin_is_reviewed_then_installed_and_the_ladder_written() {
    let r = rig(json!({}));
    let s = choose_subscription(&r).await;
    assert_eq!(s.form.as_ref().unwrap().form_id, "setup.claude");
    r.claude.signed_in("2.1.328 (Claude Code)");
    // Check again: the review of what will be installed comes first, and nothing is changed by it
    let s = r
        .setup()
        .advance(Some(answer("setup.claude", json!({}), json!({}))), false)
        .await
        .unwrap();
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.claude.install");
    assert_eq!(form.kind, "connector");
    assert_eq!(
        form.pinned.as_deref(),
        Some("6313fad5ddf2c060e7b16782f4860c0d5cdbfcac")
    );
    let shown = rows(&form);
    for want in [
        "claude-subscription-directsdk 0.3.5 (official, from Hermes's plugin catalog)",
        "https://github.com/NousResearch/hermes-official-plugins#claude-subscription-directsdk",
        "registers no tool, hook or middleware",
        "the plugin has no credentials of its own",
        "2.1.328, signed in (Claude Max)",
    ] {
        assert!(shown.contains(want), "{want} in\n{shown}");
    }
    assert!(shown.contains("plugins"), "it says where it goes: {shown}");
    assert!(
        form.effect
            .as_deref()
            .unwrap()
            .contains("hermes plugins install claude-subscription-directsdk --no-enable")
    );
    assert_eq!(
        r.fake.plugin_catalog.lock().unwrap().installs,
        0,
        "showing it installs nothing"
    );
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());

    // the user agrees: the catalog's build is installed, once, and the ladder is the plugin's aliases, cheapest first
    let s = r
        .setup()
        .advance(
            Some(answer("setup.claude.install", json!({}), json!({}))),
            false,
        )
        .await
        .unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 1);
    assert!(
        plugin_names(&r).contains(&PROVIDER_ID.to_owned()),
        "Hermes lists the provider afterwards"
    );
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap(),
        json!({"tiers": [
            {"name": "haiku", "model": "claude-subscription-directsdk-experimental/haiku"},
            {"name": "sonnet", "model": "claude-subscription-directsdk-experimental/sonnet"},
            {"name": "opus", "model": "claude-subscription-directsdk-experimental/opus"}]})
    );
    assert!(
        *r.fake.restarts.lock().unwrap() >= 1,
        "Hermes restarts to load the provider"
    );
    let receipt = s.receipt.unwrap().lines.join("\n");
    assert!(
        receipt.contains(
            "Claude subscription (Claude Max): haiku, sonnet, opus on your Claude Code login"
        ),
        "{receipt}"
    );
    assert!(
        !receipt.contains("plugin settings"),
        "the old line is gone: {receipt}"
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

    // running it again changes nothing: no second install, the same ladder
    let sets = r.fake.sets.lock().unwrap().len();
    let again = r.setup().advance(None, false).await.unwrap();
    assert!(again.done);
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 1);
    assert_eq!(r.fake.sets.lock().unwrap().len(), sets);
}

#[tokio::test]
async fn the_ladder_follows_what_the_installed_claude_code_and_plugin_serve() {
    // Claude Code 2.1.285 serves sonnet and opus, not haiku (it needs 2.1.293)
    let r = rig(json!({}));
    r.claude.signed_in("2.1.285 (Claude Code)");
    choose_subscription(&r).await;
    r.setup()
        .advance(
            Some(answer("setup.claude.install", json!({}), json!({}))),
            false,
        )
        .await
        .unwrap();
    assert_eq!(ladder_names(&r).await, ["sonnet", "opus"]);

    // a pinned plugin that does not know `sonnet` is not asked for it, whatever Claude Code serves
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    r.fake.plugin_catalog.lock().unwrap().aliases = vec!["haiku", "opus"];
    choose_subscription(&r).await;
    let s = r
        .setup()
        .advance(
            Some(answer("setup.claude.install", json!({}), json!({}))),
            false,
        )
        .await
        .unwrap();
    assert!(s.done, "{:?}", s.steps);
    assert_eq!(ladder_names(&r).await, ["haiku", "opus"]);
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
async fn declining_the_plugin_goes_back_to_the_models_question_and_installs_nothing() {
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    let s = choose_subscription(&r).await;
    assert_eq!(s.form.unwrap().form_id, "setup.claude.install");
    let mut no = answer("setup.claude.install", json!({}), json!({}));
    no.cancelled = true;
    let s = r.setup().advance(Some(no), false).await.unwrap();
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder", "{:?}", s.steps);
    assert_eq!(enum_of(&form, "choice")[0], "free");
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 0);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());
    // and "choose another model" from the instructions does the same
    let r = rig(json!({}));
    choose_subscription(&r).await;
    let mut other = answer("setup.claude", json!({}), json!({}));
    other.cancelled = true;
    let s = r.setup().advance(Some(other), false).await.unwrap();
    assert_eq!(s.form.unwrap().form_id, "setup.ladder");
}

#[tokio::test]
async fn an_unreachable_catalog_is_said_and_a_retry_installs_without_asking_again() {
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    r.fake.plugin_catalog.lock().unwrap().refuse = Some(super::ops::install_refusal(
        "Error: Could not download the plugin from https://github.com/NousResearch/hermes-official-plugins.",
        "",
    ));
    choose_subscription(&r).await;
    let s = r
        .setup()
        .advance(
            Some(answer("setup.claude.install", json!({}), json!({}))),
            false,
        )
        .await
        .unwrap();
    assert!(!s.done);
    let step = s.steps.iter().find(|x| x.id == "models").unwrap();
    assert_eq!(step.state, StepState::Blocked);
    assert_eq!(
        step.code.as_deref(),
        Some("hx.setup.subscription_unreachable")
    );
    assert!(
        step.detail.contains("could not reach the plugin catalog")
            && step.detail.contains("Nothing was installed"),
        "{}",
        step.detail
    );
    assert!(
        r.fake.config_get(LADDER).await.unwrap().is_none(),
        "no ladder without the plugin"
    );
    assert!(!plugin_names(&r).contains(&PROVIDER_ID.to_owned()));

    // the network is back: Retry (the same call, no answer) installs, and the user is not asked again
    r.fake.plugin_catalog.lock().unwrap().refuse = None;
    let s = r.setup().advance(None, false).await.unwrap();
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 1);
}

#[tokio::test]
async fn any_other_refusal_by_hermes_carries_its_own_reason() {
    let e = super::ops::install_refusal(
        "Error: Plugin 'x' was removed from the Hermes plugin catalog and is blocked from installation: unsafe\n",
        "",
    );
    assert_eq!(e.code(), "hx.setup.subscription_install_failed");
    assert!(
        e.to_string()
            .contains("was removed from the Hermes plugin catalog"),
        "{e}"
    );
    let silent = super::ops::install_refusal("", "");
    assert!(silent.to_string().contains("it gave no reason"));
    // a catalog with no such plugin cannot be installed from
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    r.fake.plugin_catalog.lock().unwrap().entry = None;
    let s = choose_subscription(&r).await;
    let step = s.steps.iter().find(|x| x.id == "models").unwrap();
    assert_eq!(step.state, StepState::Blocked);
    assert_eq!(
        step.code.as_deref(),
        Some("hx.setup.subscription_install_failed")
    );
}

#[tokio::test]
async fn a_plugin_that_is_already_there_is_not_installed_again_or_asked_about() {
    let r = rig(json!({}));
    r.claude.signed_in("2.1.328");
    r.fake.plugins.lock().unwrap().push(PluginEntry {
        name: PROVIDER_ID.into(),
        enabled: true,
    });
    let s = choose_subscription(&r).await;
    assert!(s.done && s.form.is_none(), "{:?}", s.steps);
    assert_eq!(r.fake.plugin_catalog.lock().unwrap().installs, 0);
    assert_eq!(
        r.fake.config_get(LADDER).await.unwrap().unwrap()["tiers"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[tokio::test]
async fn the_models_view_reports_claude_codes_state_and_whether_the_plugin_is_there() {
    let r = rig(json!({}));
    let v = r.setup().models_view().await.unwrap();
    assert_eq!(v.claude.state, claude::State::NotInstalled);
    assert!(!v.claude_plugin);
    r.claude.signed_in("2.1.328 (Claude Code)");
    r.fake.plugins.lock().unwrap().push(PluginEntry {
        name: PROVIDER_ID.into(),
        enabled: true,
    });
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

#[test]
fn the_catalog_reader_takes_the_pinned_row_and_the_install_refusal_is_in_plain_words() {
    let answer = json!({"results": [
        {"name": "other", "sha": "x"},
        {"name": "claude-subscription-directsdk", "version": "0.3.5", "sha": "abc", "repo": "https://r", "subdir": "d", "tier": "official",
         "capabilities": {"provides_tools": ["t"], "provides_hooks": [], "provides_middleware": ["m1", "m2"]}}]});
    let e = super::ops::catalog_entry_of(&answer, "claude-subscription-directsdk").unwrap();
    assert_eq!(
        (e.version.as_str(), e.sha.as_str(), e.subdir.as_str()),
        ("0.3.5", "abc", "d")
    );
    assert_eq!(e.provides, ["tools: t", "middleware: m1, m2"]);
    assert!(super::ops::catalog_entry_of(&answer, "nope").is_none());
    assert!(super::ops::catalog_entry_of(&json!({}), "x").is_none());
    let net = super::ops::install_refusal(
        "",
        "fatal: unable to access ... check your internet connection",
    );
    assert_eq!(net.code(), "hx.setup.subscription_unreachable");
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
