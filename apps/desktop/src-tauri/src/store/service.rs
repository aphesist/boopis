//! The store's service: the catalogue (read, search, refresh), the sources, and the kill list. Installing is `install.rs`. Both
//! are `impl Store`; the commands (`commands.rs`) are thin calls into it.
//!
//! The catalogue is read from disk once per source and kept in memory, so browse and search never wait on a file or the network.
//! A refresh reads the source again, replaces its cache on success, and on failure keeps the last good copy and says why
//! (`error`, `offline`). Search is local.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};

use super::backend::Host;
use super::cache::{Cache, HostRecord, SourceCache, UserSources};
use super::github::{self, Repo};
use super::net::{Ask, Fetcher, Hosts};
use super::normalize::{self, Entry, Found, MarketBase};
use super::stage::{self, Select, Staging};
use super::types::{
    Bundle, InstallReceipt, ItemKind, NamespaceProof, Pin, PinKind, Removed, RemovedBy,
    SourceFetch, StoreBrowse, StoreFilter, StoreItem, StoreSource, Terms, Tier,
};
use super::{discover, search, time};
use crate::config::Limits;
use crate::error::{Error, Result};

const SOURCES_JSON: &str = include_str!("../../../../shared/data/store-sources.json");

/// The published catalogue of the engine's plugins. The engine's own loader reads the same file (a 301 to
/// `nousresearch.github.io`, which the host list allows); the gateway has a lookup for one name but no listing.
pub const ENGINE_CATALOGUE_URL: &str =
    "https://hermes-agent.nousresearch.com/docs/api/plugin-catalog.json";
/// The registry's API.
pub const REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io";

/// Anthropic's two repositories: where each marketplace file is, and the licence its root file states (read when the terms were
/// checked, 2026-11-21; `anthropics/skills` has no root licence file, each skill has its own).
const ANTHROPIC: &[(&str, &str, Option<&str>)] = &[
    ("anthropics", "claude-plugins-official", Some("Apache-2.0")),
    ("anthropics", "skills", None),
];

/// How many of boopis's own items the front page leads with, most popular first.
pub const FRONT_PAGE: usize = 24;

/// Items boopis took down itself, `(id, reason)`. Empty today; the list exists so a bad entry can be stopped without an update
/// of any source.
pub const BOOPIS_KILL_LIST: &[(&str, &str)] = &[];

/// The store.
pub struct Store {
    pub(super) cache: Cache,
    pub(super) staging: Staging,
    pub(super) limits: Limits,
    pub(super) fetcher: Arc<dyn Fetcher>,
    pub(super) host: Arc<dyn Host>,
    builtin: Vec<StoreSource>,
    mem: Mutex<BTreeMap<String, Arc<SourceCache>>>,
    pub(super) seen_plugin: Mutex<BTreeMap<String, Vec<InstallReceipt>>>,
    /// One refresh or install at a time.
    pub(super) busy: tokio::sync::Mutex<()>,
}

pub(super) fn bad_source(why: &str) -> Error {
    Error::Store("hx.store.invalid_source", why.to_owned())
}

pub(super) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Run blocking work off the async threads.
pub(super) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| Error::Io(e.to_string()))?
}

/// The two built-in sources that hold nothing until the user adds one.
fn is_placeholder(s: &StoreSource) -> bool {
    !s.user_added && matches!(s.id.as_str(), "marketplace-url" | "local")
}

/// Whether reading the sources again reads `s`: not boopis's own list (built in), not GitHub (its lists are part of boopis's index
/// and live search needs a sign-in), not the two placeholders.
fn refreshable(s: &StoreSource) -> bool {
    !matches!(s.fetch, SourceFetch::CompiledIn | SourceFetch::GithubApi) && !is_placeholder(s)
}

fn added_id(key: &str) -> String {
    format!("added-{}", &stage::sha256_hex(key.as_bytes())[..8])
}

impl Store {
    /// A store whose files are under `root` (`<app data>/store`).
    ///
    /// # Errors
    /// `Config` when the compiled-in sources file does not parse.
    pub fn new(
        root: &Path,
        limits: Limits,
        fetcher: Arc<dyn Fetcher>,
        host: Arc<dyn Host>,
    ) -> Result<Self> {
        let builtin = serde_json::from_str::<Bundle>(SOURCES_JSON)
            .map_err(|e| Error::Config(format!("the store's sources do not parse: {e}")))?
            .sources
            .unwrap_or_default();
        let s = Self {
            cache: Cache::new(root),
            staging: Staging::new(root),
            limits,
            fetcher,
            host,
            builtin,
            mem: Mutex::new(BTreeMap::new()),
            seen_plugin: Mutex::new(BTreeMap::new()),
            busy: tokio::sync::Mutex::new(()),
        };
        s.staging.sweep(s.limits.store.stage_ttl);
        s.refresh_compiled()?;
        Ok(s)
    }

    // ------------------------------------------------------------ sources

    fn user(&self) -> UserSources {
        self.cache.user_sources()
    }

    fn all_sources(&self) -> Vec<StoreSource> {
        let mut all = self.builtin.clone();
        all.extend(self.user().added);
        all
    }

    fn is_enabled(&self, s: &StoreSource, user: &UserSources) -> bool {
        user.enabled.get(&s.id).copied().unwrap_or(s.default_on)
    }

    /// Whether a source's copy is due a read: never read, its last read failed, or older than its period (the registry's is
    /// shorter).
    fn is_stale(&self, s: &StoreSource, c: &SourceCache) -> bool {
        let every = if s.fetch == SourceFetch::RegistryApi {
            self.limits.store.registry_refresh_every
        } else {
            self.limits.store.refresh_every
        };
        let age = c
            .fetched_at
            .as_deref()
            .and_then(time::parse)
            .map(|t| time::now_secs().saturating_sub(t));
        c.error.is_some() || age.is_none_or(|a| a > every.as_secs())
    }

    /// Every source with its state: whether it is on, when it was read, how many items it holds, and why its last read failed.
    #[must_use]
    pub fn sources(&self) -> Vec<StoreSource> {
        let user = self.user();
        self.all_sources()
            .into_iter()
            .map(|mut s| {
                let c = self.source_cache(&s.id);
                let on = self.is_enabled(&s, &user);
                let readable = refreshable(&s);
                s.enabled = Some(on);
                s.refreshed_at.clone_from(&c.fetched_at);
                s.items = Some(u32::try_from(c.entries.len()).unwrap_or(u32::MAX));
                s.error.clone_from(&c.error);
                s.refreshable = Some(readable);
                s.stale = Some(on && readable && self.is_stale(&s, &c));
                s
            })
            .collect()
    }

    /// Switch a source on or off.
    ///
    /// # Errors
    /// `hx.store.invalid_source` for an id that is not a source.
    pub fn set_enabled(&self, id: &str, on: bool) -> Result<()> {
        if !self.all_sources().iter().any(|s| s.id == id) {
            return Err(bad_source("there is no source by that id"));
        }
        let mut u = self.user();
        u.enabled.insert(id.to_owned(), on);
        self.cache.save_user_sources(&u)
    }

    // ------------------------------------------------------------ the cache in memory

    pub(super) fn source_cache(&self, id: &str) -> Arc<SourceCache> {
        let mut m = lock(&self.mem);
        m.entry(id.to_owned())
            .or_insert_with(|| Arc::new(self.cache.source(id).unwrap_or_default()))
            .clone()
    }

    fn put_cache(&self, id: &str, c: SourceCache) -> Result<()> {
        self.cache.save_source(id, &c)?;
        lock(&self.mem).insert(id.to_owned(), Arc::new(c));
        Ok(())
    }

    fn refresh_compiled(&self) -> Result<()> {
        let catalog = crate::connectors::catalog::load()?;
        let list = super::recommended::load()?;
        let now = time::now();
        let (skills, plugins) = normalize::boopis_skills_and_plugins(list, &now);
        let c = SourceCache {
            fetched_at: Some(now.clone()),
            entries: normalize::weave(vec![
                normalize::boopis_connectors(catalog, &now),
                plugins,
                skills,
            ]),
            ..SourceCache::default()
        };
        self.put_cache("boopis", c)
    }

    /// An item by id, from any source's cache (a source that is switched off still answers for what is installed).
    ///
    /// # Errors
    /// `hx.store.not_found`.
    pub fn find(&self, id: &str) -> Result<Entry> {
        let (source, _) = id
            .split_once(':')
            .ok_or_else(|| Error::Store("hx.store.not_found", "that is not an item id".into()))?;
        self.source_cache(source)
            .entries
            .iter()
            .find(|e| e.item.id == id)
            .cloned()
            .ok_or_else(|| {
                Error::Store("hx.store.not_found", "that item is not in the store".into())
            })
    }

    /// The items of every source that is on, with the kill list applied.
    fn enabled_items(&self) -> Vec<StoreItem> {
        let user = self.user();
        let mut out = Vec::new();
        for s in self
            .all_sources()
            .iter()
            .filter(|s| self.is_enabled(s, &user))
        {
            for e in &self.source_cache(&s.id).entries {
                out.push(self.with_kill_list(e.item.clone()));
            }
        }
        out
    }

    /// The item with boopis's own kill list merged in (the engine's and the registry's arrive with the items).
    #[must_use]
    pub fn with_kill_list(&self, mut item: StoreItem) -> StoreItem {
        if item.removed.is_none()
            && let Some((_, why)) = BOOPIS_KILL_LIST.iter().find(|(id, _)| *id == item.id)
        {
            item.removed = Some(Removed {
                reason: (*why).to_owned(),
                by: RemovedBy::Boopis,
                date: None,
            });
        }
        item
    }

    // ------------------------------------------------------------ browse and search

    pub(super) fn installed_ids(&self, bot: &str) -> BTreeSet<String> {
        let mut ids: BTreeSet<String> = self
            .cache
            .installed()
            .items
            .into_iter()
            .filter(|r| r.bot == bot)
            .map(|r| r.receipt.item_id)
            .collect();
        if let Some(seen) = lock(&self.seen_plugin).get(bot) {
            ids.extend(seen.iter().map(|r| r.item_id.clone()));
        }
        ids
    }

    /// A page of the catalogue, from the cache. `query` is searched locally; with none, best tier first.
    ///
    /// # Errors
    /// `InvalidInput` for a bot that is not one.
    pub fn browse(
        &self,
        query: Option<&str>,
        filter: &StoreFilter,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<StoreBrowse> {
        let items = self.enabled_items();
        let installed = if filter.installed.is_some() {
            self.installed_ids(&self.host.bot(None)?)
        } else {
            BTreeSet::new()
        };
        let kept: Vec<&StoreItem> = items
            .iter()
            .filter(|i| {
                search::passes(i, filter)
                    && filter
                        .installed
                        .is_none_or(|want| installed.contains(&i.id) == want)
            })
            .collect();
        let order = self.curated_order();
        let place = |i: &StoreItem| order.get(i.id.as_str()).copied();
        let ranked = search::rank(kept.into_iter(), query.unwrap_or(""), &place);
        let total = u32::try_from(ranked.len()).unwrap_or(u32::MAX);
        let (page, next_cursor) = search::page(&ranked, cursor, limit);
        let front = cursor.is_none() && query.is_none() && *filter == StoreFilter::default();
        let recommended = front.then(|| {
            let mut rec: Vec<&StoreItem> = items
                .iter()
                .filter(|i| i.tier == Tier::Recommended && i.removed.is_none())
                .collect();
            rec.sort_by_key(|i| place(i).unwrap_or(usize::MAX));
            rec.into_iter().take(FRONT_PAGE).cloned().collect()
        });
        let user = self.user();
        let (mut newest, mut stale, mut offline) = (None::<String>, false, false);
        for s in self
            .all_sources()
            .iter()
            .filter(|s| self.is_enabled(s, &user) && refreshable(s))
        {
            let c = self.source_cache(&s.id);
            stale |= self.is_stale(s, &c);
            offline |= c.offline;
            if let Some(t) = &c.fetched_at
                && newest.as_ref().is_none_or(|n| t > n)
            {
                newest = Some(t.clone());
            }
        }
        Ok(StoreBrowse {
            items: page.into_iter().cloned().collect(),
            total,
            next_cursor,
            recommended,
            refreshed_at: newest,
            stale,
            offline,
        })
    }

    /// boopis's own list in its order (`connectors.json` is ordered by a cited popularity signal, most popular first): an item's
    /// place, for ordering browse and the front page. Items of other sources have none and follow in their own order.
    fn curated_order(&self) -> BTreeMap<String, usize> {
        self.source_cache("boopis")
            .entries
            .iter()
            .enumerate()
            .map(|(n, e)| (e.item.id.clone(), n))
            .collect()
    }

    // ------------------------------------------------------------ refresh

    fn hosts_for(&self, s: &StoreSource) -> Hosts {
        let extra: Vec<String> = s
            .url
            .as_deref()
            .and_then(|u| url::Url::parse(u).ok())
            .and_then(|u| u.host_str().map(str::to_owned))
            .filter(|_| s.user_added)
            .into_iter()
            .collect();
        Hosts::new(&extra)
    }

    /// Read the sources again: every one that is on, or just `only`. Each keeps its last good copy when it cannot be read.
    ///
    /// # Errors
    /// `hx.store.invalid_source` for an unknown id; for one source, its own error; when every source that was asked failed and
    /// none has a copy, `hx.store.offline` (or `source_unreachable`).
    pub async fn refresh(&self, only: Option<&str>) -> Result<Vec<StoreSource>> {
        let _one = self.busy.lock().await;
        let user = self.user();
        let all = self.all_sources();
        let targets: Vec<StoreSource> = match only {
            Some(id) => vec![
                all.iter()
                    .find(|s| s.id == id)
                    .cloned()
                    .ok_or_else(|| bad_source("there is no source by that id"))?,
            ],
            None => all
                .into_iter()
                .filter(|s| self.is_enabled(s, &user))
                .collect(),
        };
        let (mut failed, mut tried, mut last) = (0, 0, None);
        for s in &targets {
            if s.fetch == SourceFetch::CompiledIn {
                self.refresh_compiled()?;
                continue;
            }
            if matches!(s.fetch, SourceFetch::GithubApi) || is_placeholder(s) {
                // GitHub's cached lists are part of boopis's own index and live search needs a sign-in; the two placeholders
                // hold nothing until the user adds a source.
                continue;
            }
            tried += 1;
            let prev = self.source_cache(&s.id);
            match self.read_source(s, &prev).await {
                Ok(mut c) => {
                    c.fetched_at = Some(time::now());
                    c.error = None;
                    c.offline = false;
                    self.put_cache(&s.id, c)?;
                }
                Err(e) => {
                    failed += 1;
                    let mut c = (*prev).clone();
                    c.error = Some(super::reasons::reason(s, &e));
                    c.offline = e.code() == "hx.store.source_unreachable";
                    self.put_cache(&s.id, c)?;
                    last = Some(e);
                }
            }
        }
        if let Some(e) = last
            && (only.is_some()
                || (failed == tried
                    && targets
                        .iter()
                        .filter(|s| s.fetch != SourceFetch::CompiledIn)
                        .all(|s| self.source_cache(&s.id).entries.is_empty())))
        {
            return Err(
                if only.is_some() || e.code() != "hx.store.source_unreachable" {
                    e
                } else {
                    Error::Store("hx.store.offline", "no source could be reached".into())
                },
            );
        }
        self.push_kill_list().await;
        Ok(self.sources())
    }

    async fn read_source(&self, s: &StoreSource, prev: &SourceCache) -> Result<SourceCache> {
        match (s.id.as_str(), s.fetch) {
            ("engine-plugins", _) => self.read_engine_catalogue(s, prev).await,
            ("skills-hub", _) => self.read_skills_hub().await,
            ("mcp-registry", _) => self.read_registry(s, prev).await,
            ("anthropic", _) => self.read_anthropic(s).await,
            (
                _,
                SourceFetch::Local
                | SourceFetch::GitRepo
                | SourceFetch::HttpJson
                | SourceFetch::GitMarketplace,
            ) if s.user_added => {
                let entries = self.read_user_source(s).await?;
                Ok(SourceCache {
                    entries,
                    ..SourceCache::default()
                })
            }
            _ => Ok(prev.clone()),
        }
    }

    async fn read_engine_catalogue(
        &self,
        s: &StoreSource,
        prev: &SourceCache,
    ) -> Result<SourceCache> {
        let (f, hosts, max) = (
            self.fetcher.clone(),
            self.hosts_for(s),
            self.limits.store.max_catalogue_bytes,
        );
        let url = s
            .url
            .clone()
            .unwrap_or_else(|| ENGINE_CATALOGUE_URL.to_owned());
        let etag = prev.etag.clone();
        let reply = blocking(move || {
            f.get(
                &url,
                &hosts,
                &Ask {
                    max_bytes: max,
                    etag: etag.as_deref(),
                    accept: Some("application/json"),
                },
            )
        })
        .await?;
        if reply.status == 304 && !prev.entries.is_empty() {
            return Ok(SourceCache {
                etag: reply.etag,
                entries: prev.entries.clone(),
                ..SourceCache::default()
            });
        }
        let doc: Value = serde_json::from_slice(&reply.body).map_err(|e| {
            Error::Store(
                "hx.store.source_unreachable",
                format!("the engine's catalogue is not JSON: {e}"),
            )
        })?;
        let mut entries = normalize::engine_catalogue(&doc, &time::now());
        entries.truncate(self.limits.store.max_items_per_source);
        Ok(SourceCache {
            etag: reply.etag,
            entries,
            ..SourceCache::default()
        })
    }

    async fn read_skills_hub(&self) -> Result<SourceCache> {
        let bot = self.host.bot(None)?;
        let backend = self.host.backend(&bot)?;
        let mut rows: Vec<Value> = Vec::new();
        for page in 1..=30u32 {
            let a = backend
                .rpc(
                    "skills.manage",
                    &json!({"action": "browse", "page": page, "page_size": 100}),
                )
                .await?;
            rows.extend(a["items"].as_array().cloned().unwrap_or_default());
            if u64::from(page) >= a["total_pages"].as_u64().unwrap_or(1) {
                break;
            }
        }
        let mut entries = normalize::skills_hub(&rows, &time::now());
        entries.truncate(self.limits.store.max_items_per_source);
        Ok(SourceCache {
            entries,
            ..SourceCache::default()
        })
    }

    async fn read_registry(&self, s: &StoreSource, prev: &SourceCache) -> Result<SourceCache> {
        let base = s.url.clone().unwrap_or_else(|| REGISTRY_URL.to_owned());
        let (f, hosts, lim) = (
            self.fetcher.clone(),
            self.hosts_for(s),
            self.limits.store.clone(),
        );
        let since = prev.fetched_at.clone().filter(|_| !prev.entries.is_empty());
        let started = time::now();
        let incremental = since.is_some();
        let (fresh, deleted) = blocking(move || {
            let (mut out, mut gone): (Vec<Entry>, Vec<String>) = (Vec::new(), Vec::new());
            let mut cursor: Option<String> = None;
            for _ in 0..lim.registry_max_pages {
                let mut url = format!(
                    "{}/v0.1/servers?limit=100&version=latest",
                    base.trim_end_matches('/')
                );
                if let Some(t) = &since {
                    url.push_str(&format!("&updated_since={t}"));
                }
                if let Some(c) = &cursor {
                    url.push_str(&format!(
                        "&cursor={}",
                        url::form_urlencoded::byte_serialize(c.as_bytes()).collect::<String>()
                    ));
                }
                let reply = f.get(
                    &url,
                    &hosts,
                    &Ask {
                        max_bytes: lim.max_catalogue_bytes,
                        etag: None,
                        accept: Some("application/json"),
                    },
                )?;
                let doc: Value = serde_json::from_slice(&reply.body).map_err(|e| {
                    Error::Store(
                        "hx.store.source_unreachable",
                        format!("the registry's answer is not JSON: {e}"),
                    )
                })?;
                let page = normalize::registry_page(&doc, &time::now());
                out.extend(page.entries);
                gone.extend(page.deleted);
                match page.next {
                    Some(n) if !n.is_empty() => cursor = Some(n),
                    _ => break,
                }
                if out.len() > lim.max_items_per_source {
                    break;
                }
            }
            Ok((out, gone))
        })
        .await?;
        // An incremental read replaces what changed and keeps the rest; deleted names are dropped (spam, malware or worse).
        let mut by_id: BTreeMap<String, Entry> = if incremental {
            prev.entries
                .iter()
                .map(|e| (e.item.id.clone(), e.clone()))
                .collect()
        } else {
            BTreeMap::new()
        };
        for e in fresh {
            by_id.insert(e.item.id.clone(), e);
        }
        for name in deleted {
            by_id.remove(&format!("mcp-registry:{name}"));
        }
        let mut entries: Vec<Entry> = by_id.into_values().collect();
        entries.truncate(self.limits.store.max_items_per_source);
        Ok(SourceCache {
            fetched_at: Some(started),
            entries,
            ..SourceCache::default()
        })
    }

    async fn read_anthropic(&self, s: &StoreSource) -> Result<SourceCache> {
        let mut entries = Vec::new();
        let mut errors = Vec::new();
        for (owner, name, license) in ANTHROPIC {
            let repo = Repo {
                owner: (*owner).into(),
                name: (*name).into(),
                reference: None,
                path: None,
            };
            let (f, hosts, lim) = (
                self.fetcher.clone(),
                self.hosts_for(s),
                self.limits.store.clone(),
            );
            let r = repo.clone();
            let got = blocking(move || {
                let sha = github::resolve_commit(f.as_ref(), &hosts, &lim, &r)?;
                let url =
                    github::raw_url(&r.owner, &r.name, &sha, ".claude-plugin/marketplace.json");
                let reply = f.get(
                    &url,
                    &hosts,
                    &Ask {
                        max_bytes: lim.max_catalogue_bytes,
                        etag: None,
                        accept: None,
                    },
                )?;
                let doc: Value = serde_json::from_slice(&reply.body).map_err(|e| {
                    Error::Store(
                        "hx.store.invalid_manifest",
                        format!("a marketplace that is not JSON: {e}"),
                    )
                })?;
                Ok((sha, doc))
            })
            .await;
            match got {
                Ok((sha, doc)) => {
                    let base = MarketBase {
                        repo: Some(repo.url()),
                        commit: Some(sha),
                        root_license: license.map(str::to_owned),
                    };
                    let label = if *name == "skills" {
                        "Anthropic's skills"
                    } else {
                        "Anthropic's plugins"
                    };
                    entries.extend(normalize::marketplace(
                        "anthropic",
                        Tier::Verified,
                        label,
                        &doc,
                        &base,
                        &time::now(),
                    ));
                }
                Err(e) => errors.push(e),
            }
        }
        if entries.is_empty()
            && let Some(e) = errors.into_iter().next()
        {
            return Err(e);
        }
        entries.truncate(self.limits.store.max_items_per_source);
        Ok(SourceCache {
            entries,
            ..SourceCache::default()
        })
    }

    // ------------------------------------------------------------ sources the user adds

    /// Add a source: a GitHub address, a marketplace address, a local folder, or a `.mcpb` file. It is read once; what cannot be
    /// parsed is refused.
    ///
    /// # Errors
    /// `hx.store.invalid_source`, `source_unreachable`, `too_large`, `unsafe_archive`, `invalid_manifest`.
    pub async fn source_add(
        &self,
        url: Option<String>,
        path: Option<String>,
        label: Option<String>,
    ) -> Result<StoreSource> {
        let _one = self.busy.lock().await;
        let (key, fetch, display) = match (&url, &path) {
            (Some(u), None) => {
                let u = u.trim().to_owned();
                if let Ok(r) = github::parse(&u) {
                    (
                        r.url() + &r.path.clone().map(|p| format!("/{p}")).unwrap_or_default(),
                        SourceFetch::GitRepo,
                        format!("{}/{}", r.owner, r.name),
                    )
                } else {
                    let parsed =
                        url::Url::parse(&u).map_err(|_| bad_source("that is not an address"))?;
                    if parsed.scheme() != "https"
                        || !parsed.username().is_empty()
                        || parsed.password().is_some()
                    {
                        return Err(bad_source(
                            "an address must be https, with no user name or password",
                        ));
                    }
                    (
                        parsed.to_string(),
                        SourceFetch::HttpJson,
                        parsed.host_str().unwrap_or("marketplace").to_owned(),
                    )
                }
            }
            (None, Some(p)) => {
                let c = std::fs::canonicalize(p)
                    .map_err(|_| bad_source("that folder or file does not exist"))?;
                let name = c
                    .file_name()
                    .map_or_else(|| "folder".into(), |n| n.to_string_lossy().into_owned());
                (c.to_string_lossy().into_owned(), SourceFetch::Local, name)
            }
            _ => {
                return Err(Error::InvalidInput(
                    "give an address or a path, not both and not neither".into(),
                ));
            }
        };
        let id = added_id(&key);
        if self.all_sources().iter().any(|s| s.id == id) {
            return Err(bad_source("that source is already added"));
        }
        let mut src = StoreSource {
            id: id.clone(),
            label: label
                .map(|l| l.trim().chars().take(60).collect::<String>())
                .filter(|l| !l.is_empty())
                .unwrap_or(display),
            description: Some("Added by you. Nothing here was reviewed.".into()),
            kinds: vec![],
            fetch,
            default_tier: Tier::NotReviewed,
            default_on: true,
            user_added: true,
            engine_origin: false,
            url: (fetch != SourceFetch::Local).then(|| key.clone()),
            path: (fetch == SourceFetch::Local).then(|| key.clone()),
            terms: Some(Terms::NotApplicable),
            note: None,
            enabled: None,
            refreshed_at: None,
            items: None,
            error: None,
            refreshable: None,
            stale: None,
        };
        let entries = self.read_user_source(&src).await?;
        if entries.is_empty() {
            return Err(Error::Store(
                "hx.store.invalid_manifest",
                "nothing installable was found there (no skill, plugin, marketplace or bundle)"
                    .into(),
            ));
        }
        let mut kinds: Vec<ItemKind> = entries.iter().map(|e| e.item.kind).collect();
        kinds.sort_by_key(|k| format!("{k:?}"));
        kinds.dedup();
        src.kinds = kinds;
        let mut u = self.user();
        u.added.push(src.clone());
        self.cache.save_user_sources(&u)?;
        self.put_cache(
            &id,
            SourceCache {
                fetched_at: Some(time::now()),
                entries,
                ..SourceCache::default()
            },
        )?;
        Ok(self
            .sources()
            .into_iter()
            .find(|s| s.id == id)
            .unwrap_or(src))
    }

    /// Remove a source the user added. Its items leave the cache; installed items stay.
    ///
    /// # Errors
    /// `hx.store.invalid_source` for a built-in source or an unknown id.
    pub fn source_remove(&self, id: &str) -> Result<()> {
        let mut u = self.user();
        let before = u.added.len();
        u.added.retain(|s| s.id != id);
        if u.added.len() == before {
            return Err(bad_source("only a source you added can be removed"));
        }
        u.enabled.remove(id);
        self.cache.save_user_sources(&u)?;
        self.cache.remove_source(id);
        lock(&self.mem).remove(id);
        Ok(())
    }

    async fn read_user_source(&self, s: &StoreSource) -> Result<Vec<Entry>> {
        match s.fetch {
            SourceFetch::Local => {
                let (p, l, id, st) = (
                    s.path.clone().unwrap_or_default(),
                    self.limits.store.clone(),
                    s.id.clone(),
                    self.staging.clone(),
                );
                blocking(move || local_items(&id, Path::new(&p), &l, &st)).await
            }
            SourceFetch::GitRepo | SourceFetch::GitMarketplace => {
                let repo = github::parse(s.url.as_deref().unwrap_or_default())?;
                let (f, hosts, lim, id) = (
                    self.fetcher.clone(),
                    self.hosts_for(s),
                    self.limits.store.clone(),
                    s.id.clone(),
                );
                let staging = self.staging.clone();
                blocking(move || github_items(f.as_ref(), &hosts, &lim, &staging, &id, &repo)).await
            }
            SourceFetch::HttpJson => {
                let (f, hosts, max, url) = (
                    self.fetcher.clone(),
                    self.hosts_for(s),
                    self.limits.store.max_catalogue_bytes,
                    s.url.clone().unwrap_or_default(),
                );
                let reply = blocking(move || {
                    f.get(
                        &url,
                        &hosts,
                        &Ask {
                            max_bytes: max,
                            etag: None,
                            accept: Some("application/json"),
                        },
                    )
                })
                .await?;
                let doc: Value = serde_json::from_slice(&reply.body).map_err(|_| {
                    Error::Store(
                        "hx.store.invalid_manifest",
                        "that address does not hold a marketplace file (JSON)".into(),
                    )
                })?;
                if !doc.get("plugins").is_some_and(Value::is_array) {
                    return Err(Error::Store(
                        "hx.store.invalid_manifest",
                        "that file has no plugins list".into(),
                    ));
                }
                Ok(normalize::marketplace(
                    &s.id,
                    Tier::NotReviewed,
                    "added by you",
                    &doc,
                    &MarketBase::default(),
                    &time::now(),
                ))
            }
            _ => Err(bad_source("that kind of source cannot be read")),
        }
    }

    // ------------------------------------------------------------ the kill list

    /// The merged kill list: every item the caches mark removed, with who removed it.
    #[must_use]
    pub fn kill_list(&self) -> Vec<(String, Removed)> {
        let mut out = Vec::new();
        for s in self.all_sources() {
            for e in &self.source_cache(&s.id).entries {
                let item = self.with_kill_list(e.item.clone());
                if let Some(r) = item.removed {
                    out.push((item.id, r));
                }
            }
        }
        out
    }

    /// Tell the plugin the merged kill list, so it can flag and switch off what is installed. Best effort: the engine may be
    /// down, and the next refresh tries again.
    async fn push_kill_list(&self) {
        let Ok(bot) = self.host.bot(None) else { return };
        let Ok(backend) = self.host.backend(&bot) else {
            return;
        };
        let removed: Vec<Value> = self
            .kill_list()
            .into_iter()
            .map(|(id, r)| json!({"id": id, "reason": r.reason, "by": r.by}))
            .collect();
        if let Err(e) = backend
            .rpc(
                "plugin.boopis.store.removed.set",
                &json!({"removed": removed}),
            )
            .await
        {
            tracing::debug!(error = %e, "the plugin did not take the kill list");
        }
    }

    pub(super) fn record_of(&self, bot: &str, id: &str) -> Option<HostRecord> {
        self.cache
            .installed()
            .items
            .into_iter()
            .find(|r| r.bot == bot && r.receipt.item_id == id)
    }
}

// ---------------------------------------------------------------- reading what the user pointed at

/// The items of a GitHub repository: its marketplace file when it has one, else what its tree holds.
fn github_items(
    f: &dyn Fetcher,
    hosts: &Hosts,
    lim: &crate::config::StoreLimits,
    staging: &Staging,
    source: &str,
    repo: &Repo,
) -> Result<Vec<Entry>> {
    let sha = github::resolve_commit(f, hosts, lim, repo)?;
    let now = time::now();
    let raw = github::raw_url(
        &repo.owner,
        &repo.name,
        &sha,
        ".claude-plugin/marketplace.json",
    );
    if let Ok(reply) = f.get(
        &raw,
        hosts,
        &Ask {
            max_bytes: lim.max_catalogue_bytes,
            etag: None,
            accept: None,
        },
    ) && let Ok(doc) = serde_json::from_slice::<Value>(&reply.body)
        && doc.get("plugins").is_some_and(Value::is_array)
    {
        let base = MarketBase {
            repo: Some(repo.url()),
            commit: Some(sha),
            root_license: None,
        };
        return Ok(normalize::marketplace(
            source,
            Tier::NotReviewed,
            "added by you",
            &doc,
            &base,
            &now,
        ));
    }
    let reply = f.get(
        &github::archive_url(&repo.owner, &repo.name, &sha),
        hosts,
        &Ask {
            max_bytes: lim.max_archive_bytes,
            etag: None,
            accept: None,
        },
    )?;
    let (id, dir) = staging.create()?;
    let out = (|| {
        let stats = stage::unpack_tar_gz(
            &reply.body,
            &dir,
            &Select {
                strip_top: true,
                subdir: repo.path.clone(),
            },
            lim,
        )?;
        if stats.commit.as_deref().is_some_and(|c| c != sha) {
            return Err(Error::Store(
                "hx.store.digest_mismatch",
                "the download is not the commit that was asked for".into(),
            ));
        }
        Ok(tree_items(
            source,
            repo,
            &sha,
            &dir,
            repo.path.as_deref().unwrap_or(""),
            &now,
        ))
    })();
    staging.remove(&id);
    out
}

fn license_of(dir: &Path, stated: Option<String>) -> Option<String> {
    stated.or_else(|| {
        let text = std::fs::read_to_string(dir.join("LICENSE"))
            .or_else(|_| std::fs::read_to_string(dir.join("LICENSE.txt")))
            .ok()?;
        let head = text
            .lines()
            .take(5)
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        [
            ("apache license", "Apache-2.0"),
            ("mit license", "MIT"),
            ("permission is hereby granted", "MIT"),
            ("bsd", "BSD"),
            ("mozilla public license", "MPL-2.0"),
            ("gnu general public license", "GPL"),
        ]
        .iter()
        .find(|(needle, _)| head.contains(needle))
        .map(|(_, l)| (*l).to_owned())
    })
}

/// What an unpacked repository holds, as items pinned at `sha`.
fn tree_items(
    source: &str,
    repo: &Repo,
    sha: &str,
    dir: &Path,
    sub: &str,
    now: &str,
) -> Vec<Entry> {
    let pin = Pin {
        kind: PinKind::Commit,
        value: sha.to_owned(),
        repo: Some(repo.url()),
    };
    let base_name = format!("{}/{}", repo.owner, repo.name);
    let join = |a: &str, b: &str| {
        [a, b]
            .iter()
            .filter(|p| !p.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join("/")
    };
    let mut out = Vec::new();
    if let Ok(Some(doc)) = discover::plugin_doc(dir) {
        let name = join(&base_name, sub);
        out.push(normalize::found(
            Found {
                source: source.to_owned(),
                kind: if doc.is_mod {
                    ItemKind::Mod
                } else {
                    ItemKind::Plugin
                },
                name,
                title: doc.name.clone(),
                publisher: doc.author.clone().unwrap_or_else(|| repo.owner.clone()),
                summary: doc.description.clone().unwrap_or_default(),
                license: license_of(dir, doc.license.clone()),
                homepage: doc.homepage.clone().or_else(|| Some(repo.url())),
                version: doc.version.clone(),
                pinned: Some(pin.clone()),
                components: discover::count_components(dir),
                proof: NamespaceProof::Github,
                source_url: repo.url(),
                raw: json!({"kind": "tree", "repo": repo.url(), "sha": sha, "subdir": sub}),
            },
            now,
        ));
        return out;
    }
    for (rel, doc) in discover::find_skills(dir) {
        let Ok(doc) = doc else { continue };
        let at = join(sub, &rel);
        let skill_dir = if rel.is_empty() {
            dir.to_owned()
        } else {
            dir.join(&rel)
        };
        out.push(normalize::found(
            Found {
                source: source.to_owned(),
                kind: ItemKind::Skill,
                name: join(&base_name, &at),
                title: doc.name.clone(),
                publisher: repo.owner.clone(),
                summary: doc.description.clone(),
                license: license_of(&skill_dir, doc.license.clone()),
                homepage: Some(format!("{}/tree/{sha}/{at}", repo.url())),
                version: None,
                pinned: Some(pin.clone()),
                components: discover::count_components(&skill_dir),
                proof: NamespaceProof::Github,
                source_url: repo.url(),
                raw: json!({"kind": "tree", "repo": repo.url(), "sha": sha, "subdir": at}),
            },
            now,
        ));
    }
    out
}

/// What a local folder or `.mcpb` file holds, pinned by the hash of its bytes now.
fn local_items(
    source: &str,
    path: &Path,
    lim: &crate::config::StoreLimits,
    staging: &Staging,
) -> Result<Vec<Entry>> {
    let now = time::now();
    if path.is_file() {
        if path.extension().and_then(|e| e.to_str()) != Some("mcpb") {
            return Err(bad_source("a file must be an MCP bundle (.mcpb)"));
        }
        let bytes = std::fs::read(path).map_err(|e| Error::Io(e.to_string()))?;
        if bytes.len() as u64 > lim.max_archive_bytes {
            return Err(Error::Store(
                "hx.store.too_large",
                "that bundle is larger than boopis accepts".into(),
            ));
        }
        let (tmp_id, tmp) = staging.create()?;
        let unpacked = stage::unpack_zip(&bytes, &tmp, &Select::default(), lim);
        let counts = discover::count_components(&tmp);
        let manifest_bytes = std::fs::read(tmp.join("manifest.json"));
        staging.remove(&tmp_id);
        unpacked?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes.map_err(|_| {
            Error::Store(
                "hx.store.invalid_manifest",
                "the bundle has no manifest.json".into(),
            )
        })?)
        .map_err(|_| {
            Error::Store(
                "hx.store.invalid_manifest",
                "the bundle's manifest.json is not JSON".into(),
            )
        })?;
        let name = manifest["name"]
            .as_str()
            .ok_or_else(|| {
                Error::Store(
                    "hx.store.invalid_manifest",
                    "the manifest has no name".into(),
                )
            })?
            .to_owned();
        let sha = stage::sha256_hex(&bytes);
        return Ok(vec![normalize::found(
            Found {
                source: source.to_owned(),
                kind: ItemKind::Connector,
                title: manifest["display_name"]
                    .as_str()
                    .unwrap_or(&name)
                    .to_owned(),
                name,
                publisher: manifest
                    .pointer("/author/name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_owned(),
                summary: manifest["description"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                license: manifest["license"].as_str().map(str::to_owned),
                homepage: manifest["homepage"].as_str().map(str::to_owned),
                version: manifest["version"].as_str().map(str::to_owned),
                pinned: Some(Pin {
                    kind: PinKind::ArchiveSha256,
                    value: sha,
                    repo: None,
                }),
                components: counts,
                proof: NamespaceProof::None,
                source_url: path.to_string_lossy().into_owned(),
                raw: json!({"kind": "bundle-file", "path": path.to_string_lossy()}),
            },
            &now,
        )]);
    }
    if !path.is_dir() {
        return Err(bad_source("that is not a folder or a bundle"));
    }
    let mut out = Vec::new();
    let mut add = |kind: ItemKind,
                   rel: &str,
                   name: String,
                   title: String,
                   summary: String,
                   license: Option<String>,
                   version: Option<String>,
                   publisher: Option<String>|
     -> Result<()> {
        let dir = if rel.is_empty() {
            path.to_owned()
        } else {
            path.join(rel)
        };
        let hash = stage::tree_sha256(&dir)?;
        out.push(normalize::found(
            Found {
                source: source.to_owned(),
                kind,
                name,
                title,
                publisher: publisher.unwrap_or_else(|| "you".into()),
                summary,
                license: license_of(&dir, license),
                homepage: None,
                version,
                pinned: Some(Pin {
                    kind: PinKind::TreeSha256,
                    value: hash,
                    repo: None,
                }),
                components: discover::count_components(&dir),
                proof: NamespaceProof::None,
                source_url: dir.to_string_lossy().into_owned(),
                raw: json!({"kind": "local", "path": dir.to_string_lossy()}),
            },
            &now,
        ));
        Ok(())
    };
    let leaf = path
        .file_name()
        .map_or_else(|| "folder".into(), |n| n.to_string_lossy().into_owned());
    if let Some(doc) =
        discover::plugin_doc(path).map_err(|e| Error::Store("hx.store.invalid_manifest", e))?
    {
        add(
            if doc.is_mod {
                ItemKind::Mod
            } else {
                ItemKind::Plugin
            },
            "",
            doc.name.clone(),
            doc.name.clone(),
            doc.description.clone().unwrap_or_default(),
            doc.license.clone(),
            doc.version.clone(),
            doc.author.clone(),
        )?;
    } else {
        for (rel, doc) in discover::find_skills(path) {
            if let Ok(doc) = doc {
                let name = if rel.is_empty() {
                    leaf.clone()
                } else {
                    format!("{leaf}/{rel}")
                };
                add(
                    ItemKind::Skill,
                    &rel,
                    name,
                    doc.name.clone(),
                    doc.description.clone(),
                    doc.license.clone(),
                    None,
                    None,
                )?;
            }
        }
    }
    Ok(out)
}
