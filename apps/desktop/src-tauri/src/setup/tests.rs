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
    /// What Hermes says about the free tier: the status before a claim, and after it.
    free: Mutex<FreeScript>,
    /// The free rows of the `OpenRouter` catalogue.
    catalogue: Mutex<Vec<String>>,
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
            free: Mutex::new(FreeScript::default()),
            catalogue: Mutex::new(Vec::new()),
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
}

struct Rig {
    dir: tempfile::TempDir,
    fake: Arc<Fake>,
    store: Arc<MemoryStore>,
    bundle: Bundle,
}

fn rig(config: Value) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let plugin = dir.path().join("bundle");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(
        plugin.join("plugin.yaml"),
        "name: hypotaxis\nversion: 0.1.0\n",
    )
    .unwrap();
    std::fs::write(plugin.join("__init__.py"), "").unwrap();
    let hx = dir.path().join("hx-bin");
    std::fs::write(&hx, "hx").unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    Rig {
        fake: Fake::new(home, config),
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
            "plugins.entries.hypotaxis.allow_gateway_injection"
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
    assert!(r.fake.home.join("plugins/hypotaxis/__init__.py").is_file());

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
        json!("hypotaxis")
    );
    assert_eq!(
        r.fake
            .config_get("plugins.entries.hypotaxis.allow_gateway_injection")
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
            .get("hypotaxis.provider.main", "api_key")
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
            .get("hypotaxis.provider.main", "api_key")
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
            .config_get(&format!("secrets.hypotaxis_host.env.{env}"))
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.main/api_key")
    );
    assert_eq!(
        r.fake
            .config_get("plugins.entries.hypotaxis.settings.ladder")
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
            .get("hypotaxis.provider.main", "api_key")
            .unwrap()
            .is_none(),
        "a refused answer stores nothing"
    );
}

#[tokio::test]
async fn claude_is_the_default_ladder_when_a_key_is_there() {
    let r = rig(
        json!({"tools": {"tool_search": {"enabled": "off"}}, "delegation": {"backend": "hypotaxis"},
        "plugins": {"entries": {"hypotaxis": {"allow_gateway_injection": true}}}}),
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
            .config_get("plugins.entries.hypotaxis.settings.ladder")
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
        .set("hypotaxis.provider.anthropic", "api_key", KEY)
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
            .config_get("secrets.hypotaxis_host.env.ANTHROPIC_API_KEY")
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

const LADDER: &str = "plugins.entries.hypotaxis.settings.ladder";

#[tokio::test]
async fn with_no_key_the_free_tier_is_the_first_choice_and_the_default_and_nothing_is_asked_of_nous_yet()
 {
    let r = rig(json!({}));
    let s = at_models(&r).await;
    let form = s.form.unwrap();
    assert_eq!(form.form_id, "setup.ladder");
    let ids = enum_of(&form, "choice");
    assert_eq!(&ids[..3], ["free", "openrouter-free", "anthropic"]);
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
        .set("hypotaxis.provider.anthropic", "api_key", KEY)
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
            .get("hypotaxis.provider.openrouter", "api_key")
            .unwrap()
            .as_deref(),
        Some(KEY)
    );
    assert_eq!(
        r.fake
            .config_get("secrets.hypotaxis_host.env.OPENROUTER_API_KEY")
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
        .set("hypotaxis.provider.openrouter", "api_key", KEY)
        .unwrap();
    at_models(&r).await;
    let s = choose(&r, "openrouter-free").await;
    let form = s.form.unwrap();
    assert!(form.body.contains("lists no free models"), "{}", form.body);
    assert!(r.fake.config_get(LADDER).await.unwrap().is_none());

    let r = rig(json!({}));
    r.store
        .set("hypotaxis.provider.openrouter", "api_key", KEY)
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
