//! The provider commands against an in-memory Hermes and keychain, a scripted transport, and (for the Test step) a real loopback
//! server through the real transport. The engine itself is never started.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::check::KeyCheck;
use super::endpoint::{EndpointOutcome, EndpointRequest, EndpointTestRequest};
use super::http::{Https, Reply, Transport};
use super::service::{Providers, test_endpoint};
use super::{ApiMode, ProviderStatus, WayKind, catalogue};
use crate::error::{Error, Result};
use crate::free_tier::FreeTier;
use crate::secrets::SecretStore;
use crate::secrets::store::MemoryStore;
use crate::setup::ops::{HermesOps, PluginEntry};

const KEY: &str = "sk-test-0123456789abcdef";

struct Fake {
    home: PathBuf,
    config: Mutex<Value>,
    sets: Mutex<Vec<String>>,
    idle_restarts: Mutex<Vec<bool>>,
    restart_answer: Mutex<bool>,
    /// A key whose `config_set` fails, to prove the rollback.
    fail_on: Mutex<Option<String>>,
}

impl Fake {
    fn new(home: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            home,
            config: Mutex::new(json!({})),
            sets: Mutex::new(Vec::new()),
            idle_restarts: Mutex::new(Vec::new()),
            restart_answer: Mutex::new(true),
            fail_on: Mutex::new(None),
        })
    }
    fn sets(&self) -> Vec<String> {
        self.sets.lock().unwrap().clone()
    }
}

#[async_trait]
impl HermesOps for Fake {
    async fn version(&self) -> Result<Option<String>> {
        Ok(Some("0.23.2".into()))
    }
    fn home(&self) -> PathBuf {
        self.home.clone()
    }
    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let cfg = self.config.lock().unwrap();
        let mut at = &*cfg;
        // an environment setting (`GLM_BASE_URL`) is one top-level name, as Hermes keeps it in `.env`
        let parts: Vec<&str> = if key.contains('.') {
            key.split('.').collect()
        } else {
            vec![key]
        };
        for part in parts {
            match at.get(part) {
                Some(v) => at = v,
                None => return Ok(None),
            }
        }
        Ok(Some(at.clone()))
    }
    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        if self.fail_on.lock().unwrap().as_deref() == Some(key) {
            return Err(Error::Config(format!("hermes refused {key}")));
        }
        self.sets.lock().unwrap().push(key.to_owned());
        let parsed = serde_json::from_str::<Value>(value).unwrap_or_else(|_| json!(value));
        let mut cfg = self.config.lock().unwrap();
        let mut at = &mut *cfg;
        let parts: Vec<&str> = if key.contains('.') {
            key.split('.').collect()
        } else {
            vec![key]
        };
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
        let parts: Vec<&str> = if key.contains('.') {
            key.split('.').collect()
        } else {
            vec![key]
        };
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
        Ok(Vec::new())
    }
    async fn enable_plugin(&self, _: &str) -> Result<()> {
        Ok(())
    }
    async fn restart_gateway(&self) -> Result<()> {
        Ok(())
    }
    async fn restart_gateway_when_idle(&self) -> Result<bool> {
        let answer = *self.restart_answer.lock().unwrap();
        self.idle_restarts.lock().unwrap().push(answer);
        Ok(answer)
    }
    async fn free_tier_status(&self) -> Result<FreeTier> {
        Ok(FreeTier::default())
    }
    async fn free_tier_provision(&self) -> Result<FreeTier> {
        Ok(FreeTier::default())
    }
    async fn free_models(&self, _: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
    async fn provider_models(&self, _: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
}

type Seen = Arc<Mutex<Vec<(String, Vec<(String, String)>)>>>;

/// A transport that answers each request with the next scripted reply and keeps what was asked.
struct Script {
    replies: Mutex<Vec<std::result::Result<Reply, String>>>,
    seen: Seen,
}

impl Transport for Script {
    fn get(&self, url: &str, headers: &[(String, String)]) -> std::result::Result<Reply, String> {
        self.seen
            .lock()
            .unwrap()
            .push((url.to_owned(), headers.to_vec()));
        let mut r = self.replies.lock().unwrap();
        if r.is_empty() {
            Err("no answer scripted".into())
        } else {
            r.remove(0)
        }
    }
}

fn listing(ids: &[&str]) -> std::result::Result<Reply, String> {
    let data: Vec<Value> = ids.iter().map(|i| json!({"id": i})).collect();
    answer(200, &json!({"data": data}).to_string())
}

#[allow(clippy::unnecessary_wraps)] // a scripted transport answer
fn answer(status: u16, body: &str) -> std::result::Result<Reply, String> {
    Ok(Reply {
        status,
        body: body.to_owned(),
        location: None,
    })
}

struct Rig {
    _dir: tempfile::TempDir,
    fake: Arc<Fake>,
    store: Arc<MemoryStore>,
    seen: Seen,
    svc: Providers,
}

fn rig(replies: Vec<std::result::Result<Reply, String>>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let fake = Fake::new(dir.path().join("home"));
    std::fs::create_dir_all(&fake.home).unwrap();
    let store = Arc::new(MemoryStore::default());
    let seen: Seen = Arc::default();
    let t = Arc::new(Script {
        replies: Mutex::new(replies),
        seen: seen.clone(),
    });
    let svc = Providers::new(fake.clone(), store.clone(), t);
    Rig {
        _dir: dir,
        fake,
        store,
        seen,
        svc,
    }
}

fn kept(store: &MemoryStore, scope: &str) -> Option<String> {
    store.get(&format!("boopis.{scope}"), "api_key").unwrap()
}

fn code_of(e: &Error) -> &'static str {
    e.code()
}

fn key_ways() -> Vec<&'static super::Way> {
    catalogue()
        .ways()
        .map(|(_, w)| w)
        .filter(|w| w.kind == WayKind::Key && w.config == super::Config::Builtin && !w.hidden)
        .collect()
}

#[tokio::test]
async fn each_key_way_writes_exactly_its_config_keys_and_its_secret() {
    for way in key_ways() {
        let r = rig(vec![listing(&["m1", "m2"])]);
        let s = r.svc.set_key(&way.id, KEY).await.unwrap();
        assert_eq!(s.status, ProviderStatus::Connected, "{}", way.id);
        assert!(s.is_consistent());
        assert_eq!(s.models_count, Some(2), "{}", way.id);

        // the secret is where the data says, and nowhere else
        let engine = way.engine.as_deref().unwrap();
        assert_eq!(
            kept(&r.store, &format!("provider.{engine}")).as_deref(),
            Some(KEY),
            "{}",
            way.id
        );
        let wire = way.key.as_ref().unwrap().wire_var.clone().unwrap();
        let mut want: BTreeSet<String> = [
            format!("secrets.boopis_host.env.{wire}"),
            "secrets.boopis_host.enabled".to_owned(),
        ]
        .into();
        if let Some(b) = way.base_url.as_ref().filter(|b| b.pin) {
            want.insert(b.env.clone().unwrap());
        }
        let got: BTreeSet<String> = r.fake.sets().into_iter().collect();
        assert_eq!(got, want, "{}", way.id);
        assert_eq!(
            r.fake
                .config_get(&format!("secrets.boopis_host.env.{wire}"))
                .await
                .unwrap()
                .unwrap(),
            json!(format!("secret://provider.{engine}/api_key")),
            "{}",
            way.id
        );

        // the check asked the way's own address and nothing else: once with the key, and (a list came back) once without it,
        // which tells a list open to anyone from one the key opened
        let seen = r.seen.lock().unwrap().clone();
        assert!((1..=2).contains(&seen.len()), "{}", way.id);
        let base = way.base_url.as_ref().unwrap().default.clone().unwrap();
        let host = url::Url::parse(&base).unwrap();
        for (url, _) in &seen {
            assert_eq!(
                url::Url::parse(url).unwrap().host_str(),
                host.host_str(),
                "{}",
                way.id
            );
        }
        if let Some((_, headers)) = seen.get(1) {
            assert!(
                !headers.iter().any(|(_, v)| v.contains(KEY)),
                "{}: the second ask carries no key",
                way.id
            );
        }

        // running it again with the same key changes nothing in the configuration
        let before = r.fake.sets().len();
        let r2 = r.svc.set_key(&way.id, KEY).await;
        assert!(r2.is_ok(), "{}", way.id);
        assert_eq!(
            r.fake.sets().len(),
            before,
            "{}: a second save wrote config",
            way.id
        );
        // and the key is in no part of the answer
        let json = serde_json::to_string(&format!("{s:?}")).unwrap();
        assert!(!json.contains(KEY));
    }
}

#[tokio::test]
async fn the_openai_key_uses_the_registry_slug_not_the_alias() {
    let r = rig(vec![listing(&["gpt-6.1-terra"])]);
    r.svc.set_key("openai.key", KEY).await.unwrap();
    assert_eq!(kept(&r.store, "provider.openai-api").as_deref(), Some(KEY));
    assert!(
        kept(&r.store, "provider.openai").is_none(),
        "`openai` is the engine's alias of OpenRouter"
    );
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.env.OPENAI_API_KEY")
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.openai-api/api_key")
    );
    assert_eq!(
        r.seen.lock().unwrap()[0].0,
        "https://api.openai.com/v1/models"
    );
}

#[tokio::test]
async fn bad_input_is_refused_before_anything_is_saved() {
    for (way, key, code) in [
        ("anthropic.key", "", "hx.provider.key_invalid"),
        ("anthropic.key", "   ", "hx.provider.key_invalid"),
        ("anthropic.key", "sk ant", "hx.provider.key_invalid"),
        ("anthropic.key", "sk\u{0}ant", "hx.provider.key_invalid"),
        (
            "moonshot.key",
            "sk-kimi-abcdefgh",
            "hx.provider.key_invalid",
        ),
        ("nope.key", KEY, "hx.provider.unknown"),
        ("custom.something", KEY, "hx.provider.unknown"),
        ("custom.custom-x", KEY, "hx.provider.unsupported"),
        ("anthropic.signin", KEY, "hx.provider.unsupported"),
        ("openai.signin", KEY, "hx.provider.unsupported"),
        ("custom.endpoint", KEY, "hx.provider.unsupported"),
        ("ollama.local", KEY, "hx.provider.unsupported"),
        ("alibaba.qwen-signin", KEY, "hx.provider.unsupported"),
    ] {
        let r = rig(vec![]);
        let e = r.svc.set_key(way, key).await.unwrap_err();
        assert_eq!(code_of(&e), code, "{way}: {e}");
        assert!(
            !e.to_string().contains("abcdefgh"),
            "{way}: the key is in the message"
        );
        assert!(r.fake.sets().is_empty(), "{way}: config was written");
        assert!(
            r.store
                .get("boopis.provider.anthropic", "api_key")
                .unwrap()
                .is_none()
        );
        assert!(
            r.seen.lock().unwrap().is_empty(),
            "{way}: something was dialled"
        );
    }
}

#[tokio::test]
async fn z_ai_and_kimi_stay_on_the_pay_as_you_go_address() {
    // the engine follows an explicit `<PROVIDER>_BASE_URL` before its own detection (`_resolve_zai_base_url`,
    // `_resolve_kimi_base_url`: "an explicit ... always wins"), and reads it from the profile's `.env`, which `hermes config set` of
    // an upper-case name writes; the data pins it, so setting a key sets it
    for (way, var, address) in [
        ("zai.key", "GLM_BASE_URL", "https://api.z.ai/api/paas/v4"),
        (
            "moonshot.key",
            "KIMI_BASE_URL",
            "https://api.moonshot.ai/v1",
        ),
    ] {
        let r = rig(vec![listing(&["m"])]);
        r.svc.set_key(way, KEY).await.unwrap();
        assert_eq!(
            r.fake.config_get(var).await.unwrap().unwrap(),
            json!(address),
            "{way}"
        );
        // the check dialled that address too, never a coding-plan one
        assert!(r.seen.lock().unwrap()[0].0.starts_with(address), "{way}");
        // a hand-set coding-plan address is put back
        r.fake.config.lock().unwrap()[var] = json!("https://api.z.ai/api/coding/paas/v4");
        r.svc.set_key(way, KEY).await.ok();
        assert_eq!(
            r.fake.config_get(var).await.unwrap().unwrap(),
            json!(address),
            "{way}"
        );
    }
    // the China twin of Kimi has no pin in the data and gets none
    let r = rig(vec![listing(&["m"])]);
    r.svc.set_key("moonshot.key-cn", KEY).await.unwrap();
    assert!(!r.fake.sets().iter().any(|s| s.ends_with("_BASE_URL")));
    // a coding-plan key never reaches the keychain
    let r = rig(vec![]);
    assert!(
        r.svc
            .set_key("moonshot.key", "sk-kimi-0123456789")
            .await
            .is_err()
    );
    assert!(kept(&r.store, "provider.kimi-coding").is_none());
}

#[tokio::test]
async fn the_check_says_what_the_provider_said_and_the_key_stays_saved() {
    let cases: Vec<(
        std::result::Result<Reply, String>,
        ProviderStatus,
        Option<&str>,
    )> = vec![
        (listing(&["a"]), ProviderStatus::Connected, None),
        (
            answer(401, r#"{"error":"no"}"#),
            ProviderStatus::Error,
            Some("hx.provider.key_rejected"),
        ),
        (
            answer(403, "forbidden"),
            ProviderStatus::Error,
            Some("hx.provider.key_rejected"),
        ),
        (
            Err("timed out".into()),
            ProviderStatus::Error,
            Some("hx.provider.unreachable"),
        ),
        // an answer the check cannot read does not fail the key: it is saved and not verified, and the state says so
        (answer(404, "not found"), ProviderStatus::Connected, None),
        (
            answer(200, "<html></html>"),
            ProviderStatus::Connected,
            None,
        ),
    ];
    for (reply, status, code) in cases {
        let r = rig(vec![reply]);
        let s = r.svc.set_key("deepseek.key", KEY).await.unwrap();
        assert_eq!(s.status, status);
        assert_eq!(s.code.as_deref(), code);
        assert!(s.is_consistent());
        assert_eq!(
            kept(&r.store, "provider.deepseek").as_deref(),
            Some(KEY),
            "the key stays saved"
        );
        if status == ProviderStatus::Connected && s.models_count.is_none() {
            assert!(
                s.detail
                    .as_deref()
                    .unwrap()
                    .contains("could not be used to check")
            );
        }
    }
}

/// What the live probe found (`tests/live_signins.rs`): xAI answers a wrong key with 400 and "Incorrect API key provided", and six
/// providers list their models for any key at all. A wrong key is refused in plain words, and a list open to anyone is not taken
/// for an accepted key.
#[tokio::test]
async fn a_400_about_the_key_refuses_it_and_an_open_list_is_not_an_accepted_key() {
    let r = rig(vec![answer(
        400,
        r#"{"code":"invalid-argument","error":"Incorrect API key provided. You can obtain an API key from https://console.x.ai."}"#,
    )]);
    let s = r.svc.set_key("xai.key", KEY).await.unwrap();
    assert_eq!(s.status, ProviderStatus::Error);
    assert_eq!(s.code.as_deref(), Some("hx.provider.key_rejected"));
    assert!(!s.detail.as_deref().unwrap().contains("console.x.ai"));
    // a 400 about something else is not a refused key
    let r = rig(vec![answer(400, r#"{"error":"model field is required"}"#)]);
    let s = r.svc.set_key("deepseek.key", KEY).await.unwrap();
    assert_eq!(s.status, ProviderStatus::Connected);

    // the same list with no key at all: open to anyone, so the key is saved and not called accepted
    let r = rig(vec![listing(&["a", "b"]), listing(&["a", "b"])]);
    let s = r.svc.set_key("nvidia.key", KEY).await.unwrap();
    assert_eq!(s.status, ProviderStatus::Connected);
    assert_eq!(s.models_count, None, "no count that suggests the key works");
    assert!(
        s.detail
            .as_deref()
            .unwrap()
            .contains("shows its models to anyone"),
        "{:?}",
        s.detail
    );
    let seen = r.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 2);
    assert!(
        !seen[1]
            .1
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("authorization")),
        "the second ask carries no key"
    );
    // a list that needs the key: the second ask is refused, and the key is accepted with its count
    let r = rig(vec![listing(&["a", "b"]), answer(401, "{}")]);
    let s = r.svc.set_key("nvidia.key", KEY).await.unwrap();
    assert_eq!(s.models_count, Some(2));
}

#[tokio::test]
async fn the_key_goes_as_each_wire_says_and_only_to_its_own_host() {
    let header = |way: &str| {
        let way = way.to_owned();
        async move {
            let r = rig(vec![listing(&["m"])]);
            r.svc.set_key(&way, KEY).await.unwrap();
            let seen = r.seen.lock().unwrap().clone();
            (seen[0].0.clone(), seen[0].1.clone())
        }
    };
    let (url, h) = header("anthropic.key").await;
    assert_eq!(url, "https://api.anthropic.com/v1/models");
    assert!(h.contains(&("x-api-key".into(), KEY.into())));
    assert!(!h.iter().any(|(n, _)| n == "Authorization"));
    let (url, h) = header("google.key").await;
    assert_eq!(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models"
    );
    assert!(h.contains(&("x-goog-api-key".into(), KEY.into())));
    let (url, h) = header("xai.key").await;
    assert_eq!(url, "https://api.x.ai/v1/models");
    assert!(h.contains(&("Authorization".into(), format!("Bearer {KEY}"))));
    // OpenRouter's model list is public, so its key is checked at its own key endpoint, and a 200 there is a pass
    let r = rig(vec![answer(200, r#"{"data":{"label":"k"}}"#)]);
    let s = r.svc.set_key("openrouter.key", KEY).await.unwrap();
    assert_eq!(
        r.seen.lock().unwrap()[0].0,
        "https://openrouter.ai/api/v1/key"
    );
    assert_eq!(s.status, ProviderStatus::Connected);
    let r = rig(vec![answer(401, "{}")]);
    assert_eq!(
        r.svc
            .set_key("openrouter.key", KEY)
            .await
            .unwrap()
            .code
            .as_deref(),
        Some("hx.provider.key_rejected")
    );
}

#[tokio::test]
async fn a_failed_config_write_puts_the_keychain_back() {
    let r = rig(vec![listing(&["m"])]);
    r.store
        .set("boopis.provider.deepseek", "api_key", "old-key")
        .unwrap();
    *r.fake.fail_on.lock().unwrap() = Some("secrets.boopis_host.enabled".into());
    let e = r.svc.set_key("deepseek.key", KEY).await.unwrap_err();
    assert_eq!(e.code(), "hx.setup.config_failed");
    assert_eq!(
        kept(&r.store, "provider.deepseek").as_deref(),
        Some("old-key")
    );
    let r = rig(vec![]);
    *r.fake.fail_on.lock().unwrap() = Some("secrets.boopis_host.enabled".into());
    assert!(r.svc.set_key("deepseek.key", KEY).await.is_err());
    assert!(
        kept(&r.store, "provider.deepseek").is_none(),
        "nothing saved when it fails"
    );
}

#[tokio::test]
async fn a_saved_key_restarts_the_engine_when_idle_and_is_remembered_when_a_turn_runs() {
    let r = rig(vec![listing(&["m"])]);
    let s = r.svc.set_key("deepseek.key", KEY).await.unwrap();
    assert_eq!(*r.fake.idle_restarts.lock().unwrap(), [true]);
    assert!(
        !crate::setup::state::load(&r.fake.home)
            .unwrap()
            .restart_pending
    );
    assert!(!s.detail.unwrap().contains("restart"));

    let r = rig(vec![listing(&["m"])]);
    *r.fake.restart_answer.lock().unwrap() = false;
    let s = r.svc.set_key("deepseek.key", KEY).await.unwrap();
    assert!(
        crate::setup::state::load(&r.fake.home)
            .unwrap()
            .restart_pending
    );
    assert!(s.detail.unwrap().contains("next restart"));
    assert_eq!(s.status, ProviderStatus::Connected);
}

#[tokio::test]
async fn remove_takes_the_secret_and_the_wiring_and_says_when_there_is_nothing() {
    let r = rig(vec![listing(&["m"])]);
    r.svc.set_key("zai.key", KEY).await.unwrap();
    let s = r.svc.remove("zai.key").await.unwrap();
    assert_eq!(s.status, ProviderStatus::NeedsKey);
    assert!(kept(&r.store, "provider.zai").is_none());
    assert!(
        r.fake
            .config_get("secrets.boopis_host.env.GLM_API_KEY")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        r.fake.config_get("GLM_BASE_URL").await.unwrap().is_none(),
        "the pin boopis set goes with the key"
    );
    let e = r.svc.remove("zai.key").await.unwrap_err();
    assert_eq!(e.code(), "hx.provider.not_found");

    // a pinned address the person changed by hand is theirs: it stays
    let r = rig(vec![listing(&["m"])]);
    r.svc.set_key("zai.key", KEY).await.unwrap();
    r.fake.config.lock().unwrap()["GLM_BASE_URL"] = json!("https://proxy.example.com/v4");
    r.svc.remove("zai.key").await.unwrap();
    assert!(r.fake.config_get("GLM_BASE_URL").await.unwrap().is_some());

    for (way, code) in [
        ("anthropic.signin", "hx.provider.unsupported"),
        ("openai.signin", "hx.provider.unsupported"),
        ("custom.endpoint", "hx.provider.unsupported"),
        ("nope.key", "hx.provider.unknown"),
        ("custom.custom-ghost", "hx.provider.not_found"),
    ] {
        assert_eq!(r.svc.remove(way).await.unwrap_err().code(), code, "{way}");
    }
}

#[tokio::test]
async fn the_list_reads_keys_endpoints_and_leaves_hidden_ways_and_the_add_row_out() {
    let r = rig(vec![listing(&["m"])]);
    r.svc.set_key("deepseek.key", KEY).await.unwrap();
    std::fs::write(r.fake.home.join(".env"), "XAI_API_KEY=abc\n").unwrap();
    let req = endpoint_request("My Server", "http://127.0.0.1:8000/v1", &["a", "b"]);
    r.svc.add_endpoint(&req).await.unwrap();
    let all = r.svc.list().await.unwrap();
    assert!(all.iter().all(super::ProviderState::is_consistent));
    let by = |w: &str| {
        all.iter()
            .find(|s| s.way == w)
            .unwrap_or_else(|| panic!("{w}"))
    };
    assert_eq!(by("deepseek.key").status, ProviderStatus::Connected);
    assert_eq!(
        by("xai.key").status,
        ProviderStatus::Connected,
        "a key in the profile's .env counts"
    );
    assert_eq!(by("openai.key").status, ProviderStatus::NeedsKey);
    assert_eq!(by("ollama.local").status, ProviderStatus::NotFound);
    assert!(
        by("ollama.local").checked_at.is_none(),
        "list never dials a runtime"
    );
    assert_eq!(
        by("anthropic.signin").status,
        ProviderStatus::Error,
        "no Claude Code is read in this rig"
    );
    assert!(
        !all.iter().any(|s| s.way == "alibaba.qwen-signin"),
        "hidden"
    );
    assert!(!all.iter().any(|s| s.way == "custom.endpoint"));
    let mine = by("custom.custom-my-server");
    assert_eq!(
        (mine.kind, mine.status, mine.models_count),
        (WayKind::Custom, ProviderStatus::Connected, Some(2))
    );
    assert_eq!(mine.base_url.as_deref(), Some("http://127.0.0.1:8000/v1"));
    // the catalogue's order, then the endpoints
    let order: Vec<&str> = all.iter().map(|s| s.way.as_str()).collect();
    let pos = |w: &str| order.iter().position(|x| *x == w).unwrap();
    assert!(
        pos("anthropic.signin") < pos("deepseek.key")
            && pos("deepseek.key") < pos("custom.custom-my-server")
    );
}

fn endpoint_request(name: &str, url: &str, models: &[&str]) -> EndpointRequest {
    EndpointRequest {
        name: name.into(),
        base_url: url.into(),
        api_mode: ApiMode::ChatCompletions,
        key: None,
        models: models.iter().map(|m| (*m).to_owned()).collect(),
        discover: true,
        context_length: None,
        request_timeout_s: None,
        use_model: None,
        profile: None,
    }
}

#[tokio::test]
async fn an_endpoint_writes_exactly_its_entry_and_is_never_frontier() {
    let r = rig(vec![]);
    let s = r
        .svc
        .add_endpoint(&endpoint_request(
            "My Server",
            "http://127.0.0.1:8000/v1",
            &["claude-opus-5-5", "llama3"],
        ))
        .await
        .unwrap();
    assert_eq!(
        (s.provider.as_str(), s.way.as_str(), s.kind),
        ("custom", "custom.custom-my-server", WayKind::Custom)
    );
    let got: BTreeSet<String> = r.fake.sets().into_iter().collect();
    let want: BTreeSet<String> = [
        "base_url",
        "api_mode",
        "models",
        "discover_models",
        "request_timeout_seconds",
    ]
    .iter()
    .map(|k| format!("providers.custom-my-server.{k}"))
    .collect();
    assert_eq!(got, want, "no key: no wiring, and the model is not touched");
    let e = r
        .fake
        .config_get("providers.custom-my-server")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(e["base_url"], "http://127.0.0.1:8000/v1");
    assert_eq!(e["api_mode"], "chat_completions");
    assert_eq!(e["models"], json!({"claude-opus-5-5": {}, "llama3": {}}));
    assert_eq!(e["discover_models"], true);
    assert_eq!(e["request_timeout_seconds"], 300);
    assert!(e.get("key_env").is_none());
    assert!(r.idle_restart_count() == 0, "no key, no restart");
    // never frontier, whatever its model is called
    for m in ["claude-opus-5-5", "llama3", "gpt-6.2-astra"] {
        assert!(!crate::frontier::is_frontier("custom-my-server", m));
    }
    // the same name again is another endpoint, by the slug rule
    let s2 = r
        .svc
        .add_endpoint(&endpoint_request(
            "My Server",
            "http://127.0.0.1:8001/v1",
            &[],
        ))
        .await
        .unwrap();
    assert_eq!(s2.way, "custom.custom-my-server-2");
    // the fixed runtime names are taken
    let s3 = r
        .svc
        .add_endpoint(&endpoint_request(
            "Ollama",
            "http://127.0.0.1:11434/v1",
            &[],
        ))
        .await
        .unwrap();
    assert_eq!(s3.way, "custom.custom-ollama-2");
}

impl Rig {
    fn idle_restart_count(&self) -> usize {
        self.fake.idle_restarts.lock().unwrap().len()
    }
}

#[tokio::test]
async fn an_endpoint_with_a_key_wires_it_and_can_become_the_model() {
    let r = rig(vec![]);
    let mut req = endpoint_request("Lab GPU", "https://llm.example.com/v1", &["qwen-72b"]);
    req.key = Some(format!("  {KEY}\n"));
    req.api_mode = ApiMode::AnthropicMessages;
    req.use_model = Some("qwen-72b".into());
    req.context_length = Some(32768);
    req.discover = false;
    let s = r.svc.add_endpoint(&req).await.unwrap();
    assert_eq!(s.way, "custom.custom-lab-gpu");
    assert_eq!(
        kept(&r.store, "provider.custom-lab-gpu").as_deref(),
        Some(KEY)
    );
    let sref = crate::secrets::refs::SecretRef::provider_key("custom-lab-gpu");
    let e = r
        .fake
        .config_get("providers.custom-lab-gpu")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(e["key_env"], sref.env_name());
    assert_eq!(e["api_mode"], "anthropic_messages");
    assert_eq!(e["discover_models"], false);
    assert_eq!(e["context_length"], 32768);
    assert_eq!(
        e["request_timeout_seconds"], 120,
        "longer only on this computer"
    );
    assert_eq!(
        r.fake
            .config_get(&format!("secrets.boopis_host.env.{}", sref.env_name()))
            .await
            .unwrap()
            .unwrap(),
        json!("secret://provider.custom-lab-gpu/api_key")
    );
    assert_eq!(
        r.fake
            .config_get("secrets.boopis_host.enabled")
            .await
            .unwrap()
            .unwrap(),
        json!(true)
    );
    assert_eq!(
        r.fake.config_get("model.provider").await.unwrap().unwrap(),
        "custom-lab-gpu"
    );
    assert_eq!(
        r.fake.config_get("model.default").await.unwrap().unwrap(),
        "qwen-72b"
    );
    assert_eq!(
        r.idle_restart_count(),
        1,
        "a key needs a restart to be read"
    );
    assert!(!format!("{s:?}").contains(KEY));

    // removing it takes the entry, the wiring and the secret
    let gone = r.svc.remove("custom.custom-lab-gpu").await.unwrap();
    assert_eq!(gone.status, ProviderStatus::NotFound);
    assert!(
        r.fake
            .config_get("providers.custom-lab-gpu")
            .await
            .unwrap()
            .is_none()
    );
    assert!(kept(&r.store, "provider.custom-lab-gpu").is_none());
    assert!(
        r.fake
            .config_get(&format!("secrets.boopis_host.env.{}", sref.env_name()))
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        r.svc
            .remove("custom.custom-lab-gpu")
            .await
            .unwrap_err()
            .code(),
        "hx.provider.not_found"
    );
}

#[tokio::test]
async fn a_bad_endpoint_request_saves_nothing() {
    for (name, url, models, code) in [
        (
            "",
            "http://127.0.0.1:1/v1",
            vec![],
            "hx.provider.endpoint_invalid",
        ),
        (
            "!!!",
            "http://127.0.0.1:1/v1",
            vec![],
            "hx.provider.endpoint_invalid",
        ),
        (
            "x",
            "http://192.168.1.20:8000/v1",
            vec![],
            "hx.provider.endpoint_blocked",
        ),
        (
            "x",
            "https://u:p@example.com/v1",
            vec![],
            "hx.provider.endpoint_invalid",
        ),
        (
            "x",
            "https://example.com/v1?key=abc",
            vec![],
            "hx.provider.endpoint_invalid",
        ),
        (
            "x",
            "ftp://example.com",
            vec![],
            "hx.provider.endpoint_invalid",
        ),
        (
            "x",
            "https://example.com/v1",
            vec!["two words"],
            "hx.provider.endpoint_invalid",
        ),
    ] {
        let r = rig(vec![]);
        let e = r
            .svc
            .add_endpoint(&endpoint_request(name, url, &models))
            .await
            .unwrap_err();
        assert_eq!(e.code(), code, "{name:?} {url}");
        assert!(r.fake.sets().is_empty(), "{name:?} {url}");
    }
    let r = rig(vec![]);
    let mut req = endpoint_request("x", "https://example.com/v1", &[]);
    req.key = Some("a b".into());
    assert_eq!(
        r.svc.add_endpoint(&req).await.unwrap_err().code(),
        "hx.provider.key_invalid"
    );
    assert!(r.fake.sets().is_empty());
    // a write that fails half way leaves neither entry nor secret
    let r = rig(vec![]);
    *r.fake.fail_on.lock().unwrap() = Some("providers.custom-x.models".into());
    let mut req = endpoint_request("x", "https://example.com/v1", &["a"]);
    req.key = Some(KEY.into());
    assert_eq!(
        r.svc.add_endpoint(&req).await.unwrap_err().code(),
        "hx.setup.config_failed"
    );
    assert!(
        r.fake
            .config_get("providers.custom-x")
            .await
            .unwrap()
            .is_none()
    );
    assert!(kept(&r.store, "provider.custom-x").is_none());
}

// ---------------------------------------------------------------- the Test step against a real loopback server

type Requests = Arc<Mutex<Vec<(String, String)>>>;

/// A loopback server answering `routes` (path, status, extra header, body) to the next `n` requests; it keeps each request's path
/// and its raw head.
fn server(
    routes: Vec<(&'static str, u16, &'static str, String)>,
    n: usize,
) -> (String, Requests, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen: Requests = Arc::default();
    let log = seen.clone();
    let handle = std::thread::spawn(move || {
        for _ in 0..n {
            let (mut sock, _) = listener.accept().unwrap();
            sock.set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                let k = sock.read(&mut buf).unwrap_or(0);
                if k == 0 {
                    break;
                }
                head.extend_from_slice(&buf[..k]);
            }
            let head = String::from_utf8_lossy(&head).to_string();
            let path = head.split_whitespace().nth(1).unwrap_or("").to_owned();
            log.lock().unwrap().push((path.clone(), head));
            let (status, extra, body) = routes
                .iter()
                .find(|(p, ..)| *p == path)
                .map_or((404, "", "not found".to_owned()), |(_, s, e, b)| {
                    (*s, *e, b.clone())
                });
            let reply = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
                body.len()
            );
            let _ = sock.write_all(reply.as_bytes());
        }
    });
    (base, seen, handle)
}

fn test_request(base: &str, key: Option<&str>) -> EndpointTestRequest {
    EndpointTestRequest {
        base_url: format!("{base}/v1"),
        api_mode: ApiMode::ChatCompletions,
        key: key.map(str::to_owned),
    }
}

fn real() -> Arc<dyn Transport> {
    Arc::new(Https::new(std::time::Duration::from_secs(5)))
}

#[tokio::test]
async fn test_lists_an_openai_shaped_server_and_sends_the_key_as_a_bearer_token() {
    let body = json!({"object":"list","data":[{"id":"qwen"},{"id":"llama"}]}).to_string();
    let (base, seen, h) = server(vec![("/v1/models", 200, "", body)], 1);
    let r = test_endpoint(real(), test_request(&base, Some(KEY)))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::Listed);
    assert_eq!(r.models, ["qwen", "llama"]);
    assert!(r.loopback);
    assert_eq!(r.status, Some(200));
    assert!(r.code.is_none() && r.answered_at.as_ref().unwrap().ends_with("/v1/models"));
    let req = seen.lock().unwrap()[0].1.to_lowercase();
    assert!(
        req.contains(&format!("authorization: bearer {KEY}")),
        "{req}"
    );
    assert!(!format!("{r:?}").contains(KEY));
}

#[tokio::test]
async fn test_tries_the_second_path_when_the_first_is_not_a_model_list() {
    // `/v1/models` is the base's own `/models`; the first path 404s here, so the second (`/v1/v1/models`) is asked, then it stops
    let (base, seen, h) = server(vec![], 2);
    let r = test_endpoint(real(), test_request(&base, None))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::NotAModelServer);
    assert_eq!(r.code.as_deref(), Some("hx.provider.not_a_model_server"));
    let paths: Vec<String> = seen
        .lock()
        .unwrap()
        .iter()
        .map(|(p, _)| p.clone())
        .collect();
    assert_eq!(paths, ["/v1/models", "/v1/v1/models"]);
    // no key was typed: none was sent
    assert!(
        !seen.lock().unwrap()[0]
            .1
            .to_lowercase()
            .contains("authorization")
    );
}

#[tokio::test]
async fn test_reads_an_ollama_shaped_list() {
    let body = json!({"models":[{"name":"llama3:8b","model":"llama3:8b"},{"name":"qwen2.5:7b"}]})
        .to_string();
    let (base, _, h) = server(vec![("/v1/models", 200, "", body)], 1);
    let r = test_endpoint(real(), test_request(&base, None))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::Listed);
    assert_eq!(r.models, ["llama3:8b", "qwen2.5:7b"]);
}

#[tokio::test]
async fn test_says_empty_for_a_server_that_lists_nothing() {
    let (base, _, h) = server(
        vec![("/v1/models", 200, "", json!({"data": []}).to_string())],
        1,
    );
    let r = test_endpoint(real(), test_request(&base, None))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::Empty);
    assert!(r.models.is_empty());
    assert_eq!(r.code.as_deref(), Some("hx.provider.no_models"));
}

#[tokio::test]
async fn test_says_needs_key_for_a_401_and_never_echoes_the_servers_words() {
    let body = json!({"error": {"message": format!("bad key {KEY}")}}).to_string();
    let (base, _, h) = server(vec![("/v1/models", 401, "", body)], 1);
    let r = test_endpoint(real(), test_request(&base, Some(KEY)))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::NeedsKey);
    assert_eq!(r.status, Some(401));
    assert_eq!(r.code.as_deref(), Some("hx.provider.key_rejected"));
    assert!(
        !format!("{r:?}").contains(KEY),
        "what the server said is never shown"
    );
}

#[tokio::test]
async fn test_says_not_a_model_server_for_an_html_page() {
    let (base, _, h) = server(
        vec![
            (
                "/v1/models",
                200,
                "",
                "<html><body>Welcome to nginx</body></html>".into(),
            ),
            ("/v1/v1/models", 200, "", "<html></html>".into()),
        ],
        2,
    );
    let r = test_endpoint(real(), test_request(&base, None))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.outcome, EndpointOutcome::NotAModelServer);
    assert!(r.models.is_empty());
}

#[tokio::test]
async fn test_says_unreachable_when_nothing_listens() {
    let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", free.local_addr().unwrap());
    drop(free);
    let r = test_endpoint(real(), test_request(&base, None))
        .await
        .unwrap();
    assert_eq!(r.outcome, EndpointOutcome::Unreachable);
    assert_eq!(r.code.as_deref(), Some("hx.provider.unreachable"));
    assert!(r.status.is_none() && r.answered_at.is_none());
}

#[tokio::test]
async fn test_follows_a_redirect_on_the_same_host_and_refuses_one_to_another_with_the_key_unsent() {
    // same origin: `/v1/models` redirects to `/v1/models/`
    let body = json!({"data":[{"id":"m"}]}).to_string();
    let (base, _, h) = server(
        vec![
            (
                "/v1/models",
                301,
                "Location: /v1/models/\r\n",
                String::new(),
            ),
            ("/v1/models/", 200, "", body.clone()),
        ],
        2,
    );
    let r = test_endpoint(real(), test_request(&base, Some(KEY)))
        .await
        .unwrap();
    h.join().unwrap();
    assert_eq!(r.models, ["m"]);

    // another host: refused, and the other host is never asked (it is a port that nothing listens on, so a dial would be seen)
    let other = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    other.set_nonblocking(true).unwrap();
    let target = format!("http://{}/steal", other.local_addr().unwrap());
    let location: &'static str = Box::leak(format!("Location: {target}\r\n").into_boxed_str());
    let (base, _, h) = server(vec![("/v1/models", 302, location, String::new())], 1);
    let e = test_endpoint(real(), test_request(&base, Some(KEY)))
        .await
        .unwrap_err();
    h.join().unwrap();
    assert_eq!(e.code(), "hx.provider.endpoint_blocked");
    assert!(
        other.accept().is_err(),
        "nothing connected to the other host"
    );
}

#[tokio::test]
async fn test_refuses_an_address_it_may_not_dial_before_dialling() {
    for (url, code) in [
        (
            "http://192.168.1.20:8000/v1",
            "hx.provider.endpoint_blocked",
        ),
        ("http://example.com/v1", "hx.provider.endpoint_blocked"),
        ("ftp://example.com", "hx.provider.endpoint_invalid"),
        ("https://a:b@example.com/v1", "hx.provider.endpoint_invalid"),
    ] {
        let req = EndpointTestRequest {
            base_url: url.into(),
            api_mode: ApiMode::ChatCompletions,
            key: Some(KEY.into()),
        };
        let e = test_endpoint(real(), req).await.unwrap_err();
        assert_eq!(e.code(), code, "{url}");
    }
    let bad_key = EndpointTestRequest {
        base_url: "https://example.com/v1".into(),
        api_mode: ApiMode::ChatCompletions,
        key: Some("a b".into()),
    };
    assert_eq!(
        test_endpoint(real(), bad_key).await.unwrap_err().code(),
        "hx.provider.key_invalid"
    );
}

#[tokio::test]
async fn the_anthropic_wire_sends_x_api_key() {
    let (base, seen, h) = server(
        vec![(
            "/v1/models",
            200,
            "",
            json!({"data":[{"id":"c"}]}).to_string(),
        )],
        1,
    );
    let mut req = test_request(&base, Some(KEY));
    req.api_mode = ApiMode::AnthropicMessages;
    test_endpoint(real(), req).await.unwrap();
    h.join().unwrap();
    let head = seen.lock().unwrap()[0].1.to_lowercase();
    assert!(
        head.contains(&format!("x-api-key: {KEY}")) && !head.contains("authorization"),
        "{head}"
    );
    assert!(head.contains("anthropic-version"));
}

#[test]
fn the_check_enum_is_what_the_state_reads() {
    // a guard against the two enums drifting: every check result has a state
    for c in [
        KeyCheck::Accepted(1),
        KeyCheck::Unverified(404),
        KeyCheck::Rejected,
        KeyCheck::Unreachable,
        KeyCheck::Public,
    ] {
        let _ = format!("{c:?}");
    }
}

// ---------------------------------------------------------------- LM Studio is the engine's built-in provider

fn lmstudio() -> (&'static super::Entry, &'static super::Way) {
    catalogue().way("lm-studio.local").expect("lm-studio.local")
}

#[tokio::test]
async fn lm_studio_is_configured_as_the_built_in_provider_with_only_the_models_it_listed() {
    let r = rig(vec![]);
    let (entry, way) = lmstudio();
    let listed = vec!["qwen3-coder-30b".to_owned(), "gemma-4-12b".to_owned()];
    let st = r
        .svc
        .use_local_with(
            entry,
            way,
            crate::local::Outcome::Found(listed.clone()),
            None,
        )
        .await
        .unwrap();
    assert_eq!(st.status, ProviderStatus::FoundLocal);
    assert_eq!(st.way, "lm-studio.local");
    assert_eq!(st.models_count, Some(2));
    assert!(st.detail.unwrap().contains("Using qwen3-coder-30b"));
    // the engine's own provider, the first listed id, the address its registry reads: and no endpoint made up for it
    let cfg = r.fake.config.lock().unwrap().clone();
    assert_eq!(cfg["model"]["provider"], "lmstudio");
    assert_eq!(cfg["model"]["default"], "qwen3-coder-30b");
    assert_eq!(cfg["LM_BASE_URL"], "http://127.0.0.1:1234/v1");
    assert!(
        cfg.get("providers").is_none(),
        "no providers.custom-lmstudio entry: {cfg}"
    );
    assert!(
        r.fake.sets().iter().all(|k| !k.contains("custom-lmstudio")),
        "{:?}",
        r.fake.sets()
    );

    // a model of the person's choosing, when the runtime lists it
    r.svc
        .use_local_with(
            entry,
            way,
            crate::local::Outcome::Found(listed.clone()),
            Some("gemma-4-12b"),
        )
        .await
        .unwrap();
    assert_eq!(
        r.fake.config.lock().unwrap()["model"]["default"],
        "gemma-4-12b"
    );

    // LM Studio rejects an id it does not list, so one it did not list is refused and nothing changes
    let before = r.fake.sets().len();
    let err = r
        .svc
        .use_local_with(
            entry,
            way,
            crate::local::Outcome::Found(listed),
            Some("claude-opus-5-5"),
        )
        .await
        .unwrap_err();
    assert_eq!(code_of(&err), "hx.provider.endpoint_invalid");
    assert_eq!(r.fake.sets().len(), before);
}

#[tokio::test]
async fn lm_studio_answers_plainly_when_it_is_not_there_or_lists_nothing() {
    use crate::local::Outcome;
    let (entry, way) = lmstudio();
    for (outcome, code) in [
        (Outcome::Nothing, "hx.provider.unreachable"),
        (Outcome::Slow, "hx.provider.unreachable"),
        (Outcome::Other, "hx.provider.unreachable"),
        (Outcome::NeedsKey, "hx.provider.key_rejected"),
        (Outcome::Found(vec![]), "hx.provider.no_models"),
        (Outcome::FoundUnnamed, "hx.provider.no_models"),
    ] {
        let r = rig(vec![]);
        let err = r
            .svc
            .use_local_with(entry, way, outcome.clone(), None)
            .await
            .unwrap_err();
        assert_eq!(code_of(&err), code, "{outcome:?}");
        assert!(
            r.fake.sets().is_empty(),
            "nothing is written for {outcome:?}"
        );
    }
}

#[tokio::test]
async fn only_the_built_in_local_way_goes_this_path_and_its_models_are_never_frontier() {
    let r = rig(vec![]);
    for other in [
        "ollama.local",
        "llama-cpp.local",
        "vllm.local",
        "openai.key",
        "nope.way",
    ] {
        let err = r.svc.use_local(other, None).await.unwrap_err();
        assert!(
            ["hx.provider.unsupported", "hx.provider.unknown"].contains(&code_of(&err)),
            "{other}: {err}"
        );
    }
    // a probed id that is named like a frontier model is still not one, on the provider boopis wrote
    let (entry, way) = lmstudio();
    let name = "claude-opus-5-5";
    r.svc
        .use_local_with(
            entry,
            way,
            crate::local::Outcome::Found(vec![name.to_owned()]),
            None,
        )
        .await
        .unwrap();
    let cfg = r.fake.config.lock().unwrap().clone();
    let provider = cfg["model"]["provider"].as_str().unwrap();
    assert_eq!(provider, "lmstudio");
    assert!(!crate::frontier::is_frontier(provider, name));
    assert!(!crate::frontier::is_heavy(provider, name));
    assert!(
        crate::frontier::family_of(provider, name).is_none()
            || !crate::frontier::is_frontier(provider, name)
    );
}

// ---------------------------------------------------------------- the host's own sign-ins are in the list

#[tokio::test]
async fn the_list_shows_every_sign_in_way_with_its_real_state_and_the_program_only_while_the_sign_in_is_unused()
 {
    use super::signin::fakes::signins;
    let r = rig(vec![]);
    let svc = Providers::new(
        r.fake.clone(),
        r.store.clone(),
        Arc::new(Script {
            replies: Mutex::new(vec![]),
            seen: Arc::default(),
        }),
    )
    .with_signins(Arc::new(signins(&r.store)));
    let ways = [
        "openai.signin",
        "github-copilot.signin",
        "xai.signin",
        "xai.key",
        "xai.cli",
    ];
    let all = svc.list().await.unwrap();
    assert!(all.iter().all(super::ProviderState::is_consistent));
    let by = |all: &[super::ProviderState], w: &str| all.iter().find(|s| s.way == w).cloned();
    for w in ways {
        let s = by(&all, w).unwrap_or_else(|| panic!("{w} is listed"));
        assert_ne!(
            s.code.as_deref(),
            Some("hx.provider.unsupported"),
            "{w} is read from its owner, not answered as not built"
        );
    }
    assert_eq!(
        by(&all, "xai.signin").unwrap().status,
        ProviderStatus::SignedOut
    );
    assert_eq!(
        by(&all, "github-copilot.signin").unwrap().status,
        ProviderStatus::SignedOut
    );
    assert_eq!(
        by(&all, "openai.signin").unwrap().status,
        ProviderStatus::SignedOut
    );
    let cli =
        by(&all, "xai.cli").expect("the program's way is offered while the sign-in is unused");
    assert_eq!(cli.way, "xai.cli");
    // the order is the catalogue's
    let order: Vec<&str> = all.iter().map(|s| s.way.as_str()).collect();
    let pos = |w: &str| order.iter().position(|x| *x == w).unwrap();
    assert!(pos("xai.signin") < pos("xai.key") && pos("xai.key") < pos("xai.cli"));

    // signed in to each, as the keychain says
    r.store.set("boopis.xai", "access_token", "xat").unwrap();
    r.store.set("boopis.xai", "refresh_token", "xrt").unwrap();
    r.store
        .set("boopis.copilot", "github_token", "ghu")
        .unwrap();
    r.store
        .set("boopis.copilot", "account", r#"{"login":"octocat"}"#)
        .unwrap();
    let all = svc.list().await.unwrap();
    assert_eq!(
        by(&all, "xai.signin").unwrap().status,
        ProviderStatus::Connected
    );
    let copilot = by(&all, "github-copilot.signin").unwrap();
    assert_eq!(
        (copilot.status, copilot.detail.as_deref()),
        (ProviderStatus::Connected, Some("octocat"))
    );
    assert!(
        by(&all, "xai.cli").is_none(),
        "the program is not offered while the SuperGrok sign-in is in use (offered_when: signin_unused)"
    );
}
