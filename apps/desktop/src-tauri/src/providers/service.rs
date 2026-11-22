//! The provider commands' behaviour (ADR-0039): the state of every way, saving and removing a key, and saving an endpoint of the
//! person's own. Everything is drawn from `providers.json`; no lab is named here.
//!
//! A key goes to the keychain (`secret://provider.<engine or slug>/api_key`) and the engine's configuration gets the two usual
//! writes (the key's variable bound to the reference, and the secret source switched on; for an endpoint also `key_env`), plus the
//! pinned address where the data pins one. The engine reads its secret sources when it starts, so a saved key is used after a
//! restart: it is done at once when no turn is running, and left pending otherwise (ending a turn is never silent).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::check::{KeyCheck, check_key, post_check, timeout};
use super::endpoint::EndpointRequest;
use super::endpoints::{check, clean_key, models_value, reserved, slug_for};
use super::http::{Address, Transport};
use super::signin::Signins;
use super::{
    ApiMode, Config, Entry, KeyRoute, ProviderState, ProviderStatus, RouteMethod, Way, WayKind,
    catalogue,
};
use crate::claude::{self, ClaudeCli};
use crate::error::{Error, Result};
use crate::secrets::SecretStore;
use crate::secrets::refs::{SOURCE, SecretRef, builtin_provider_env};
use crate::setup::ops::HermesOps;
use crate::setup::providers::{
    dotenv_names, key_in_place, pinned_address, saved, wire, write_default_model,
};
use crate::setup::state;

/// What the last probe of the runtimes on this computer found, by way id (this run only; `provider_probe_local` fills it).
static LAST_LOCAL: Mutex<BTreeMap<String, ProviderState>> = Mutex::new(BTreeMap::new());

/// Remember a probe's answers, so `provider_list` (which never dials) can repeat them.
pub fn remember_local_probe(states: &[ProviderState]) {
    let mut m = LAST_LOCAL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for s in states {
        m.insert(s.way.clone(), s.clone());
    }
}

fn last_local(way: &str) -> Option<ProviderState> {
    LAST_LOCAL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(way)
        .cloned()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn unsupported(why: &str) -> Error {
    Error::Provider("hx.provider.unsupported", why.to_owned())
}

fn unknown(id: &str) -> Error {
    Error::Provider(
        "hx.provider.unknown",
        format!("{id:?} is not a provider boopis knows"),
    )
}

/// What a way id names: a way of the catalogue, or an endpoint the person added (`custom.<slug>`).
enum Target {
    Way(&'static Entry, &'static Way),
    Endpoint(String),
}

fn resolve(id: &str) -> Result<Target> {
    if let Some((e, w)) = catalogue().way(id) {
        return Ok(Target::Way(e, w));
    }
    let prefix = catalogue().endpoint.slug["prefix"]
        .as_str()
        .unwrap_or("custom-");
    match id.strip_prefix("custom.") {
        Some(slug) if slug.starts_with(prefix) && slug.len() > prefix.len() => {
            Ok(Target::Endpoint(slug.to_owned()))
        }
        _ => Err(unknown(id)),
    }
}

/// The provider commands' engine: Hermes's configuration, the keychain and the one outbound read.
pub struct Providers {
    ops: Arc<dyn HermesOps>,
    secrets: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
    claude: Option<Arc<dyn ClaudeCli>>,
    signins: Option<Arc<Signins>>,
}

impl Providers {
    /// An engine over these.
    #[must_use]
    pub fn new(
        ops: Arc<dyn HermesOps>,
        secrets: Arc<dyn SecretStore>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        Self {
            ops,
            secrets,
            transport,
            claude: None,
            signins: None,
        }
    }

    /// Read the Claude subscription's state through this Claude Code.
    #[must_use]
    pub fn with_claude(mut self, claude: Arc<dyn ClaudeCli>) -> Self {
        self.claude = Some(claude);
        self
    }

    /// Read the sign-ins the host owns (ChatGPT's, Copilot's, SuperGrok's, and the user's own grok program) from these.
    #[must_use]
    pub fn with_signins(mut self, signins: Arc<Signins>) -> Self {
        self.signins = Some(signins);
        self
    }

    // ------------------------------------------------------------------ list

    /// Every way's state, in the catalogue's order, then the endpoints the person added. Dials nothing.
    ///
    /// # Errors
    /// `hx.config.invalid` when the engine's configuration cannot be read.
    pub async fn list(&self) -> Result<Vec<ProviderState>> {
        let env = dotenv_names(&self.ops.home());
        let keyed = self.key_states(env).await?;
        // the sign-in ways the host owns, read once: ChatGPT's, Copilot's and xAI's (`Xai::way_states`, which leaves
        // `xai.cli` out while the SuperGrok sign-in is in use)
        let owned = self.owned_signins(&keyed).await;
        let mut out = Vec::new();
        for (entry, way) in catalogue().ways().filter(|(_, w)| !w.hidden) {
            match way.kind {
                WayKind::Key => out.extend(keyed.get(&way.id).cloned()),
                WayKind::Local => out.push(
                    last_local(&way.id)
                        .unwrap_or_else(|| ProviderState::not_found(&entry.id, &way.id)),
                ),
                WayKind::Signin => out.extend(self.signin_state(entry, way, &owned).await),
                // the row that adds an endpoint is not a connection: the endpoints it made are listed below
                WayKind::Custom => {}
            }
        }
        out.extend(self.endpoint_states().await?);
        Ok(out)
    }

    /// What the host's own sign-ins say, by way id; the read's failure, when it failed.
    async fn owned_signins(
        &self,
        keyed: &BTreeMap<String, ProviderState>,
    ) -> std::result::Result<BTreeMap<String, ProviderState>, Error> {
        let Some(signins) = &self.signins else {
            return Ok(BTreeMap::new());
        };
        let xai_key = keyed
            .get(crate::xai::WAY_KEY)
            .cloned()
            .unwrap_or_else(|| ProviderState::needs_key(crate::xai::PROVIDER, crate::xai::WAY_KEY));
        Ok(signins
            .states(xai_key)
            .await?
            .into_iter()
            .map(|s| (s.way.clone(), s))
            .collect())
    }

    async fn key_states(&self, env: Vec<String>) -> Result<BTreeMap<String, ProviderState>> {
        let store = self.secrets.clone();
        tokio::task::spawn_blocking(move || {
            catalogue()
                .ways()
                .filter(|(_, w)| !w.hidden && w.kind == WayKind::Key)
                .map(|(e, w)| {
                    let state = if key_in_place(store.as_ref(), &env, &w.id) {
                        ProviderState::connected(&e.id, &w.id, WayKind::Key)
                    } else {
                        ProviderState::needs_key(&e.id, &w.id)
                    };
                    (w.id.clone(), state)
                })
                .collect()
        })
        .await
        .map_err(|e| crate::error::joined(&e))
    }

    /// A sign-in way the host or Claude Code owns: its state, read from its owner. A way that is offered only while the entry's
    /// sign-in is unused is left out while it is in use (`None`). A sign-in nothing owns yet is an error state saying so,
    /// never a guess.
    async fn signin_state(
        &self,
        entry: &Entry,
        way: &Way,
        owned: &std::result::Result<BTreeMap<String, ProviderState>, Error>,
    ) -> Option<ProviderState> {
        let who = way.signin.as_ref().map_or("", |s| s.owner.as_str());
        if who == "claude.rs"
            && let Some(c) = &self.claude
        {
            return Some(claude_state(entry, way, &c.probe().await));
        }
        match owned {
            Ok(map) => {
                if let Some(state) = map.get(&way.id) {
                    return Some(state.clone());
                }
                if self.signins.is_some() && !way.offered_when.offered(true) {
                    return None;
                }
            }
            Err(e) => {
                return Some(ProviderState::error(
                    &entry.id,
                    &way.id,
                    WayKind::Signin,
                    e.code(),
                    "boopis could not read the sign-in.",
                ));
            }
        }
        Some(ProviderState::error(
            &entry.id,
            &way.id,
            WayKind::Signin,
            "hx.provider.unsupported",
            "This sign-in is not available in this version yet.",
        ))
    }

    async fn endpoint_states(&self) -> Result<Vec<ProviderState>> {
        let taken = reserved(&[]);
        let providers = self.ops.config_get("providers").await?;
        let prefix = catalogue().endpoint.slug["prefix"]
            .as_str()
            .unwrap_or("custom-")
            .to_owned();
        let Some(map) = providers.as_ref().and_then(Value::as_object) else {
            return Ok(Vec::new());
        };
        let store = self.secrets.clone();
        let entries: Vec<(String, Value)> = map
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix) && !taken.contains(k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        tokio::task::spawn_blocking(move || {
            entries
                .into_iter()
                .map(|(slug, v)| endpoint_state(store.as_ref(), &slug, &v))
                .collect()
        })
        .await
        .map_err(|e| crate::error::joined(&e))
    }

    // ------------------------------------------------------------------ keys

    /// Save a key for a key way, wire it and check it once with a model listing.
    ///
    /// # Errors
    /// As `provider_set_key`: `hx.provider.unknown`, `unsupported`, `key_invalid`, `hx.secrets.*`, `hx.setup.config_failed`. Nothing
    /// is saved when it fails.
    pub async fn set_key(&self, way_id: &str, raw: &str) -> Result<ProviderState> {
        let Target::Way(entry, way) = resolve(way_id)? else {
            return Err(unsupported("an endpoint's key is set when it is saved"));
        };
        let rule = way
            .key
            .as_ref()
            .filter(|_| way.kind != WayKind::Signin && way.config == Config::Builtin && !way.hidden)
            .ok_or_else(|| unsupported("this way takes no key here"))?;
        let engine = way
            .engine
            .as_deref()
            .ok_or_else(|| unsupported("this way has no provider"))?;
        let key = clean_key(raw, &rule.refuse_prefixes)?;
        let r = SecretRef::parse(&way.secret_ref().ok_or_else(|| unsupported("no key"))?)?;
        let previous = self.secrets.get(&r.service(), &r.name)?;
        self.secrets.set(&r.service(), &r.name, &key)?;
        if let Err(e) = wire(self.ops.as_ref(), engine, false).await {
            self.restore(&r, previous.as_deref());
            return Err(Error::Setup("hx.setup.config_failed", e.to_string()));
        }
        let note = self.reload().await;
        let found = self.verify(way, &key).await;
        Ok(key_state(entry, way, &found, note))
    }

    fn restore(&self, r: &SecretRef, previous: Option<&str>) {
        let undone = match previous {
            Some(v) => self.secrets.set(&r.service(), &r.name, v),
            None => self.secrets.delete(&r.service(), &r.name),
        };
        if let Err(e) = undone {
            tracing::warn!(error = %e, "could not put the keychain back as it was");
        }
    }

    /// The model listing that checks a key: the way's own address, never another.
    async fn verify(&self, way: &'static Way, key: &str) -> std::result::Result<KeyCheck, Error> {
        let (t, key) = (self.transport.clone(), key.to_owned());
        tokio::task::spawn_blocking(move || check_way_key(t.as_ref(), way, &key))
            .await
            .map_err(|e| crate::error::joined(&e))?
    }

    /// Restart the engine so it reads the key, when no turn is running; otherwise remember that it has to. The sentence to show,
    /// when it did not restart.
    async fn reload(&self) -> Option<String> {
        let home = self.ops.home();
        let pending = |why: &str| {
            let mut st = state::load(&home).unwrap_or_default();
            st.restart_pending = true;
            if let Err(e) = state::save(&home, &st) {
                tracing::warn!(error = %e, "could not record that the engine has to restart");
            }
            Some(why.to_owned())
        };
        match self.ops.restart_gateway_when_idle().await {
            Ok(true) => None,
            Ok(false) => pending(
                "Saved. boopis's engine uses it after its next restart: a turn is running now.",
            ),
            Err(_) => {
                pending("Saved, but boopis could not restart its engine. Restart boopis to use it.")
            }
        }
    }

    // ---------------------------------------------------------------- remove

    /// Take a way away: its secret and its configuration.
    ///
    /// # Errors
    /// As `provider_remove`.
    pub async fn remove(&self, way_id: &str) -> Result<ProviderState> {
        match resolve(way_id)? {
            Target::Endpoint(slug) => self.remove_endpoint(&slug).await,
            Target::Way(entry, way) if way.kind == WayKind::Signin => {
                let _ = entry;
                Err(unsupported("a sign-in is signed out, not removed"))
            }
            Target::Way(_, way) if way.config == Config::Endpoint => match way.slug.clone() {
                Some(slug) if way.kind == WayKind::Local => self.remove_endpoint(&slug).await,
                _ => Err(unsupported("there is nothing to remove for this row")),
            },
            Target::Way(entry, way) => self.remove_key(entry, way).await,
        }
    }

    async fn remove_key(&self, entry: &Entry, way: &Way) -> Result<ProviderState> {
        let engine = way
            .engine
            .as_deref()
            .ok_or_else(|| unsupported("no provider"))?;
        let r = SecretRef::parse(&way.secret_ref().ok_or_else(|| unsupported("no key"))?)?;
        let var = builtin_provider_env(engine);
        let bound = match &var {
            Some(v) => self
                .ops
                .config_get(&format!("secrets.{SOURCE}.env.{v}"))
                .await?
                .is_some(),
            None => false,
        };
        let had = self.secrets.get(&r.service(), &r.name)?.is_some();
        if !had && !bound {
            return Err(Error::Provider(
                "hx.provider.not_found",
                "there is no saved key to remove".into(),
            ));
        }
        self.secrets.delete(&r.service(), &r.name)?;
        let cfg = |e: Error| Error::Setup("hx.setup.config_failed", e.to_string());
        if let Some(v) = &var {
            self.ops
                .config_unset(&format!("secrets.{SOURCE}.env.{v}"))
                .await
                .map_err(cfg)?;
        }
        // the pinned address was set by boopis alongside the key; take it away only while it is still the one it set
        if let Some((env, address)) = pinned_address(engine)
            && self
                .ops
                .config_get(&env)
                .await?
                .as_ref()
                .and_then(Value::as_str)
                == Some(address.as_str())
        {
            self.ops.config_unset(&env).await.map_err(cfg)?;
        }
        let note = self.reload().await;
        let env = dotenv_names(&self.ops.home());
        let mut s = if key_in_place(self.secrets.as_ref(), &env, &way.id) {
            let mut c = ProviderState::connected(&entry.id, &way.id, WayKind::Key);
            c.detail = Some("A key from the engine's own settings is still in use.".into());
            c
        } else {
            ProviderState::needs_key(&entry.id, &way.id)
        };
        if let Some(n) = note {
            s.detail = Some(n);
        }
        Ok(s)
    }

    async fn remove_endpoint(&self, slug: &str) -> Result<ProviderState> {
        let current = self.ops.config_get(&format!("providers.{slug}")).await?;
        let r = SecretRef::provider_key(slug);
        let had = self.secrets.get(&r.service(), &r.name)?.is_some();
        if current.is_none() && !had {
            return Err(Error::Provider(
                "hx.provider.not_found",
                "there is no such endpoint".into(),
            ));
        }
        self.secrets.delete(&r.service(), &r.name)?;
        let cfg = |e: Error| Error::Setup("hx.setup.config_failed", e.to_string());
        self.ops
            .config_unset(&format!("secrets.{SOURCE}.env.{}", r.env_name()))
            .await
            .map_err(cfg)?;
        if current.is_some() {
            self.ops
                .config_unset(&format!("providers.{slug}"))
                .await
                .map_err(cfg)?;
        }
        let note = self.reload().await;
        let mut s = endpoint_gone(slug);
        s.detail = note.or(Some("Removed.".into()));
        Ok(s)
    }

    // ------------------------------------------------------------ built-in local

    /// Use a runtime on this computer that the engine has its own provider for (LM Studio: the built-in `lmstudio`, not an
    /// endpoint named `custom-lmstudio`, which the engine would not know as LM Studio). The host asks the runtime itself, on
    /// its own loopback address, which models it lists; only those ids can be the model, because LM Studio refuses an id it
    /// does not list. Models on this computer are never frontier.
    ///
    /// # Errors
    /// `hx.provider.unknown`, `hx.provider.unsupported` (a way that is an ordinary endpoint: add it with
    /// `provider_add_endpoint`), `hx.provider.unreachable`, `hx.provider.key_rejected`, `hx.provider.no_models`,
    /// `hx.provider.endpoint_invalid` (a model the runtime does not list), `hx.setup.config_failed`.
    pub async fn use_local(&self, way_id: &str, model: Option<&str>) -> Result<ProviderState> {
        let (entry, way) = builtin_local(way_id)?;
        let outcome = match crate::local::target(way) {
            Some(addr) => crate::local::ask(way, addr).await,
            None => crate::local::Outcome::Nothing,
        };
        self.use_local_with(entry, way, outcome, model).await
    }

    /// [`Providers::use_local`] over what the runtime answered (the tests give it their own answers).
    ///
    /// # Errors
    /// As [`Providers::use_local`].
    pub(crate) async fn use_local_with(
        &self,
        entry: &Entry,
        way: &Way,
        outcome: crate::local::Outcome,
        model: Option<&str>,
    ) -> Result<ProviderState> {
        use crate::local::Outcome;
        let name = &entry.label;
        let ids = match outcome {
            Outcome::Found(ids) if !ids.is_empty() => ids,
            Outcome::Found(_) | Outcome::FoundUnnamed => {
                return Err(Error::Provider(
                    "hx.provider.no_models",
                    format!(
                        "{name} is running and lists no model. Load one in {name}, then check again."
                    ),
                ));
            }
            Outcome::NeedsKey => {
                return Err(Error::Provider(
                    "hx.provider.key_rejected",
                    format!("{name} asks for a key, so it cannot be used from here."),
                ));
            }
            Outcome::Nothing | Outcome::Other | Outcome::Slow => {
                return Err(Error::Provider(
                    "hx.provider.unreachable",
                    format!(
                        "{name} did not answer on this computer. Start its local server, then check again."
                    ),
                ));
            }
        };
        let chosen = match model {
            Some(m) => ids.iter().find(|i| i.as_str() == m).ok_or_else(|| {
                Error::Provider(
                    "hx.provider.endpoint_invalid",
                    format!("{name} does not list {m}."),
                )
            })?,
            None => &ids[0],
        };
        let engine = way
            .engine
            .as_deref()
            .ok_or_else(|| unsupported("no engine provider"))?;
        let cfg = |e: Error| Error::Setup("hx.setup.config_failed", e.to_string());
        let base = way.base_url.as_ref();
        let address = base.and_then(|b| b.default.clone());
        // the engine reads the address from the variable its registry names; set it to the address that was asked
        let mut wrote = false;
        if let (Some(env), Some(address)) = (base.and_then(|b| b.env.as_deref()), &address)
            && self
                .ops
                .config_get(env)
                .await?
                .as_ref()
                .and_then(Value::as_str)
                != Some(address.as_str())
        {
            self.ops.config_set(env, address).await.map_err(cfg)?;
            wrote = true;
        }
        wrote |= write_default_model(self.ops.as_ref(), &format!("{engine}/{chosen}"))
            .await
            .map_err(cfg)?;
        let note = if wrote { self.reload().await } else { None };
        let mut s = ProviderState::found_local(
            &entry.id,
            &way.id,
            address.as_deref().unwrap_or_default(),
            u32::try_from(ids.len()).unwrap_or(u32::MAX),
        );
        s.checked_at = Some(now_ms());
        s.detail = Some(match note {
            Some(n) => format!("Using {chosen}. {n}"),
            None => format!("Using {chosen}."),
        });
        Ok(s)
    }

    // -------------------------------------------------------------- endpoint

    /// Save an endpoint of the person's own.
    ///
    /// # Errors
    /// As `provider_add_endpoint`.
    pub async fn add_endpoint(&self, req: &EndpointRequest) -> Result<ProviderState> {
        let ok = check(req)?;
        let existing: Vec<String> = self
            .ops
            .config_get("providers")
            .await?
            .as_ref()
            .and_then(Value::as_object)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        let slug = slug_for(&req.name, &reserved(&existing))?;
        let r = SecretRef::provider_key(&slug);
        if let Some(key) = &ok.key {
            self.secrets.set(&r.service(), &r.name, key)?;
        }
        if let Err(e) = self.write_endpoint(&slug, req, &ok).await {
            self.rollback_endpoint(&slug, &r).await;
            return Err(Error::Setup("hx.setup.config_failed", e.to_string()));
        }
        let note = if ok.key.is_some() {
            self.reload().await
        } else {
            None
        };
        let mut s = endpoint_state_of(&slug, &ok.address.text(), ok.models.len(), false);
        s.checked_at = Some(now_ms());
        s.detail = note;
        Ok(s)
    }

    async fn write_endpoint(
        &self,
        slug: &str,
        req: &EndpointRequest,
        ok: &super::endpoints::Checked,
    ) -> Result<()> {
        let mode = serde_json::to_value(req.api_mode).unwrap_or(Value::Null);
        let mut writes: Vec<(String, String)> = vec![
            (format!("providers.{slug}.base_url"), ok.address.text()),
            (
                format!("providers.{slug}.api_mode"),
                mode.as_str().unwrap_or("chat_completions").to_owned(),
            ),
            (
                format!("providers.{slug}.models"),
                models_value(&ok.models).to_string(),
            ),
            (
                format!("providers.{slug}.discover_models"),
                req.discover.to_string(),
            ),
            (
                format!("providers.{slug}.request_timeout_seconds"),
                ok.timeout_s.to_string(),
            ),
        ];
        if let Some(c) = req.context_length {
            writes.push((format!("providers.{slug}.context_length"), c.to_string()));
        }
        for (k, v) in &writes {
            self.ops.config_set(k, v).await?;
        }
        if ok.key.is_some() {
            wire(self.ops.as_ref(), slug, true).await?;
        }
        if let Some(m) = &req.use_model {
            write_default_model(self.ops.as_ref(), &format!("{slug}/{m}")).await?;
        }
        Ok(())
    }

    async fn rollback_endpoint(&self, slug: &str, r: &SecretRef) {
        let _ = self.secrets.delete(&r.service(), &r.name);
        let _ = self
            .ops
            .config_unset(&format!("secrets.{SOURCE}.env.{}", r.env_name()))
            .await;
        let _ = self.ops.config_unset(&format!("providers.{slug}")).await;
    }
}

/// Check a key for a key way: at the provider's own key route when the data names one (`key.check`), else (or when the route said
/// nothing about the key) with the model listing at the way's own address. The key goes to those two addresses and nowhere else.
/// Blocking: run it on `spawn_blocking`. Saves nothing; the live probe (`tests/live_signins.rs`) calls it with a key no provider
/// accepts.
///
/// # Errors
/// `hx.provider.endpoint_invalid` for an address in the catalogue that is not one (never expected), `hx.provider.endpoint_blocked`
/// for a redirect to another origin.
pub fn check_way_key(t: &dyn Transport, way: &Way, key: &str) -> Result<KeyCheck> {
    let Some(base) = way.base_url.as_ref().and_then(|b| b.default.clone()) else {
        return Ok(KeyCheck::Unverified(0));
    };
    let mode = way.api_mode.unwrap_or(ApiMode::ChatCompletions);
    let address = Address::parse(&base)?;
    // the provider's own key route, when its list cannot tell a wrong key; an answer that says nothing falls back to the list
    if let Some(route) = way.key.as_ref().and_then(|k| k.check.as_ref()) {
        match ask_key_route(t, route, mode, key)? {
            KeyCheck::Unverified(_) => {}
            said => return Ok(said),
        }
    }
    let url = match mode {
        ApiMode::AnthropicMessages => address.join("/v1/models"),
        _ => address.join("/models"),
    };
    Ok(match check_key(t, &address, &url, mode, key)? {
        // a listing that lists models for any key may be open to anyone: asked once more with no key, it says which
        KeyCheck::Accepted(n) => match check_key(t, &address, &url, mode, "")? {
            KeyCheck::Accepted(m) if m > 0 => KeyCheck::Public,
            _ => KeyCheck::Accepted(n),
        },
        c => c,
    })
}

/// What a provider's key route (`key.check`) says: `Rejected`, `Unreachable`, `Accepted` (a working key; a route lists no models,
/// so usually with no count), or `Unverified` when it said nothing about the key.
fn ask_key_route(
    t: &dyn Transport,
    route: &KeyRoute,
    mode: ApiMode,
    key: &str,
) -> Result<KeyCheck> {
    Ok(match route.method {
        RouteMethod::Get => {
            match check_key(t, &Address::parse(&route.url)?, &route.url, mode, key)? {
                // an account or key page: 2xx is a working key, whatever it holds
                KeyCheck::Unverified(s) if (200..300).contains(&s) => KeyCheck::Accepted(0),
                c => c,
            }
        }
        RouteMethod::Post => post_check(t, &route.url, mode, key),
    })
}

/// The local way `way_id` names, when the engine has its own provider for it (`config: builtin`: LM Studio).
fn builtin_local(way_id: &str) -> Result<(&'static Entry, &'static Way)> {
    let (entry, way) = catalogue().way(way_id).ok_or_else(|| unknown(way_id))?;
    if way.kind != WayKind::Local || way.config != Config::Builtin {
        return Err(unsupported(
            "that runtime is an ordinary endpoint: add it with its address",
        ));
    }
    Ok((entry, way))
}

fn claude_state(entry: &Entry, way: &Way, p: &claude::Probe) -> ProviderState {
    let id = (&entry.id, &way.id);
    let err = |code: &str| ProviderState::error(id.0, id.1, WayKind::Signin, code, &p.detail);
    let mut s = match p.state {
        claude::State::SignedIn => ProviderState::connected(id.0, id.1, WayKind::Signin),
        claude::State::SignedOut => ProviderState::signed_out(id.0, id.1),
        claude::State::NotInstalled => err("hx.provider.not_installed"),
        claude::State::OldVersion => err("hx.provider.needs_update"),
        claude::State::Metered => err("hx.provider.metered"),
    };
    if p.state == claude::State::SignedIn {
        s.plan.clone_from(&p.plan);
    }
    s.checked_at = Some(now_ms());
    s
}

/// What a key way shows after its check: connected (with what the listing said) or an error with its code and plain words.
#[must_use]
pub fn key_state(
    entry: &Entry,
    way: &Way,
    found: &std::result::Result<KeyCheck, Error>,
    note: Option<String>,
) -> ProviderState {
    let (e, w) = (&entry.id, &way.id);
    let mut s = match found {
        Ok(KeyCheck::Accepted(n)) => {
            let mut c = ProviderState::connected(e, w, WayKind::Key);
            c.models_count = (*n > 0).then_some(*n);
            c.detail = (*n > 0).then(|| format!("{n} models listed."));
            c
        }
        Ok(KeyCheck::Unverified(_)) => {
            let mut c = ProviderState::connected(e, w, WayKind::Key);
            c.detail =
                Some("Saved. The provider's model list could not be used to check the key.".into());
            c
        }
        Ok(KeyCheck::Rejected) => ProviderState::error(
            e,
            w,
            WayKind::Key,
            "hx.provider.key_rejected",
            "The provider did not accept that key. Check it, or make a new one.",
        ),
        Ok(KeyCheck::Public) => {
            let mut c = ProviderState::connected(e, w, WayKind::Key);
            c.detail = Some(
                "Saved. This provider shows its models to anyone, so boopis can check the key only when you first use it."
                    .into(),
            );
            c
        }
        Ok(KeyCheck::Unreachable) => ProviderState::error(
            e,
            w,
            WayKind::Key,
            "hx.provider.unreachable",
            "boopis could not reach the provider to check the key. The key is saved. Check your internet connection or proxy.",
        ),
        Err(err) => {
            crate::error::keep(err.code(), &err.to_string());
            ProviderState::error(
                e,
                w,
                WayKind::Key,
                err.code(),
                "boopis could not check the key. The key is saved.",
            )
        }
    };
    s.checked_at = Some(now_ms());
    if let (Some(n), None) = (note, s.code.as_ref()) {
        s.detail = Some(match s.detail.take() {
            Some(d) => format!("{d} {n}"),
            None => n,
        });
    }
    s
}

fn endpoint_state_of(slug: &str, base_url: &str, models: usize, needs_key: bool) -> ProviderState {
    let way = format!("custom.{slug}");
    let mut s = if needs_key {
        ProviderState::needs_key("custom", &way)
    } else {
        ProviderState::connected("custom", &way, WayKind::Custom)
    };
    s.kind = WayKind::Custom;
    s.base_url = Some(base_url.to_owned());
    s.models_count = u32::try_from(models).ok();
    s
}

fn endpoint_gone(slug: &str) -> ProviderState {
    let mut s = ProviderState::not_found("custom", &format!("custom.{slug}"));
    s.kind = WayKind::Custom;
    s
}

/// One saved endpoint as `provider_list` shows it: a key it names but the keychain lacks is `needs_key`.
fn endpoint_state(store: &dyn SecretStore, slug: &str, v: &Value) -> ProviderState {
    let models = match &v["models"] {
        Value::Object(o) => o.len(),
        Value::Array(a) => a.len(),
        _ => 0,
    };
    let names_key = v["key_env"]
        .as_str()
        .or_else(|| v["api_key_env"].as_str())
        .is_some();
    let r = SecretRef::provider_key(slug);
    let needs_key = names_key && !saved(store, &r);
    let mut s = endpoint_state_of(
        slug,
        v["base_url"].as_str().unwrap_or_default(),
        models,
        needs_key,
    );
    if s.status == ProviderStatus::Connected && v["base_url"].as_str().is_none() {
        s = ProviderState::error(
            "custom",
            &s.way,
            WayKind::Custom,
            "hx.config.invalid",
            "This endpoint has no address.",
        );
    }
    s
}

/// Test an endpoint before saving it (`provider_test_endpoint`): the address is checked, then one listing is asked on a blocking
/// thread. Saves and changes nothing.
///
/// # Errors
/// `hx.provider.endpoint_invalid`, `hx.provider.endpoint_blocked`.
pub async fn test_endpoint(
    transport: Arc<dyn Transport>,
    request: super::endpoint::EndpointTestRequest,
) -> Result<super::endpoint::EndpointTestResult> {
    let address = Address::parse(&request.base_url)?;
    let key = match request
        .key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        Some(k) => Some(clean_key(k, &[])?),
        None => None,
    };
    tokio::task::spawn_blocking(move || {
        super::check::test_endpoint(
            transport.as_ref(),
            &address,
            request.api_mode,
            key.as_deref(),
        )
    })
    .await
    .map_err(|e| crate::error::joined(&e))?
}

/// A transport for the commands: real https with the catalogue's timeout.
#[must_use]
pub fn https() -> Arc<dyn Transport> {
    Arc::new(super::http::Https::new(timeout()))
}
