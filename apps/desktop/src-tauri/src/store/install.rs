//! Staging, the plan, and installing, updating, rolling back and removing (`docs/STORE.md` 5.5, 5.7, 5.9). `impl Store`.
//!
//! The flow, one step per command: `stage` fetches the item's pin into `staging/<id>/tree`, checks the digest or commit, unpacks
//! within the caps, checks the manifest, hashes the tree and scans it (nothing runs); `plan` asks the layer that owns the kind
//! for its half and joins it to the host's, and seals one hash; `install` rebuilds that plan, refuses with
//! `hx.store.plan_changed` when it differs, and hands the install to the owning layer:
//!
//! | kind | plan | install |
//! |---|---|---|
//! | connector | the connector flow (`connectors::plan`, from the collection, a registry entry or a bundle) | the connector engine |
//! | plugin, mod, skill | `plugin.boopis.store.prepare` on the staged tree | `plugin.boopis.store.confirm` |
//! | engine plugin | `plugins.manage inspect`, then `prepare` for the governed policy | `plugins.manage install` pinned to the commit `inspect` read, then `confirm` |
//! | hub skill (pinned) | the host | `skills.manage install` |
//!
//! What the host installs itself (connectors, hub skills) is recorded in `installed.json`; what the plugin installs is the plugin's
//! record (`store.list`). The installed list is the two merged.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::cache::HostRecord;
use super::discover;
use super::github::{self, Repo};
use super::net::{Ask, Hosts};
use super::normalize::{self, Entry, MarketBase, PluginSource};
use super::plan::{self, Base};
use super::servers::{self, Chosen};
use super::service::{Store, blocking, lock};
use super::stage::{self, Select};
use super::time;
use super::types::{
    Component, ComponentKind, ConsentItem, Cost, Effective, FileWrite, GovernedNote, InstallPlan,
    InstallReceipt, InstallRequest, InstallStep, ItemKind, Layer, Pin, PinKind, PluginPlan,
    PreviousVersion, RestartWhen, Scan, ScanVerdict, Scope, ScopeLevel, StageResult, StoreDetail,
    StoreItem, Tier, UninstallResult, UpdateDiff, UpdateStatus, Warning, WarningLevel,
};
use crate::connectors::plan::{self as cplan, Request, ServerSpec, SourceKind};
use crate::connectors::{self, Engine};
use crate::error::{Error, Result};
use crate::setup::StepState;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlanMeta {
    plan_hash: String,
    plugin_hash: Option<String>,
    scope: Scope,
}

/// What `stage` leaves next to the tree (`staging/<id>/meta.json`): the item as it was when staged, so the plan and the install
/// are of that snapshot, not of whatever the cache says by then.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Meta {
    item: StoreItem,
    raw: Value,
    pinned: Pin,
    bot: String,
    route: String,
    tree_sha256: Option<String>,
    scan: Scan,
    files: u32,
    bytes: u64,
    engine: Option<Value>,
    created_at: String,
    plan: Option<PlanMeta>,
}

fn err(code: &'static str, why: impl Into<String>) -> Error {
    Error::Store(code, why.into())
}

fn unsupported(why: impl Into<String>) -> Error {
    err("hx.store.kind_unsupported", why)
}

/// The connector a plan is about, and how to build it again.
#[derive(Clone)]
enum ConnSource {
    Request(Request),
    Spec(ServerSpec),
}

impl ConnSource {
    fn build(&self, provided: Option<&BTreeSet<String>>) -> Result<cplan::Plan> {
        match self {
            Self::Request(r) => cplan::build(r, provided),
            Self::Spec(s) => cplan::build_server(s, provided),
        }
    }
}

/// The way of running a collection entry that needs nothing the store cannot ask for: the default one if it has no required
/// setting, else the first that has none.
fn catalog_request(id: &str) -> Result<Request> {
    let cat = connectors::catalog::load()?;
    let conn = cat.connectors.iter().find(|c| c.id == id).ok_or_else(|| {
        err(
            "hx.store.not_found",
            "that connector is not in boopis's list",
        )
    })?;
    // The item is pinned to a package, so a way of running that package comes first; a hosted one only when none can.
    let mut order = vec![conn.default_variant()];
    order.extend(conn.variants.iter());
    let usable = |v: &&connectors::catalog::Variant| !v.setup.iter().any(|s| s.required);
    let v = order
        .iter()
        .copied()
        .filter(usable)
        .find(|v| conn.pinned(v).is_some())
        .or_else(|| order.iter().copied().find(usable))
        .ok_or_else(|| unsupported("every way of running it needs a setting the store cannot ask for yet; add it in Settings, Connectors"))?;
    Ok(Request {
        source: SourceKind::Catalog,
        values: [
            ("connector".to_owned(), conn.id.clone()),
            ("variant".to_owned(), v.id.clone()),
        ]
        .into_iter()
        .collect(),
    })
}

fn bundle_dir(root: &std::path::Path, sha: &str) -> PathBuf {
    root.join("bundles").join(&sha[..sha.len().min(16)])
}

fn governed_for(kind: ItemKind) -> GovernedNote {
    let (allowed, switch_blocks, text) = match kind {
        ItemKind::Connector => return plan::connector_governed(),
        ItemKind::EnginePlugin => (
            true,
            true,
            "Allowed. It runs in every session outside the sandbox, and permission rules do not see it; a governed project's \"no engine plugins and no plugin hooks\" switch is on by default and stops it there.",
        ),
        ItemKind::Plugin => (
            true,
            false,
            "Allowed. Skills and agents work as usual; hooks run only after you trust them, and a governed project's switch can turn hooks off.",
        ),
        ItemKind::Mod => (
            true,
            false,
            "Allowed. A mod can only tighten the rules in governed mode: it cannot change the model or write the workspace.",
        ),
        ItemKind::Skill => (
            true,
            false,
            "Allowed. Its instructions join the session's skills; its scripts run only through exec and ship.",
        ),
    };
    GovernedNote {
        allowed,
        switch_blocks,
        text: text.into(),
    }
}

fn step_ok(s: StepState) -> bool {
    !matches!(s, StepState::Blocked | StepState::Declined)
}

impl Store {
    fn meta_path(&self, id: &str) -> Result<PathBuf> {
        Ok(self.staging.dir(id)?.join("meta.json"))
    }

    fn read_meta(&self, id: &str) -> Result<Meta> {
        let bytes = std::fs::read(self.meta_path(id)?)
            .map_err(|_| err("hx.store.stage_missing", "the downloaded copy is gone"))?;
        serde_json::from_slice(&bytes)
            .map_err(|_| err("hx.store.stage_missing", "the downloaded copy is damaged"))
    }

    fn write_meta(&self, id: &str, m: &Meta) -> Result<()> {
        std::fs::write(
            self.meta_path(id)?,
            serde_json::to_vec(m).map_err(|e| Error::Io(e.to_string()))?,
        )
        .map_err(|e| Error::Io(e.to_string()))
    }

    fn tree(&self, id: &str) -> Result<PathBuf> {
        Ok(self.staging.dir(id)?.join("tree"))
    }

    fn route_of(entry: &Entry) -> Result<&'static str> {
        let item = &entry.item;
        Ok(match item.kind {
            ItemKind::Connector if item.source == "boopis" => "catalog",
            ItemKind::Connector if entry.raw["kind"] == "bundle-file" => "bundle-file",
            ItemKind::Connector => match servers::pick(&entry.raw) {
                Ok(Chosen { spec: Some(_), .. }) => "registry",
                Ok(Chosen {
                    bundle: Some(_), ..
                }) => "bundle",
                Ok(_) => return Err(unsupported("it names no address or package boopis can run")),
                Err(why) => return Err(unsupported(why)),
            },
            ItemKind::EnginePlugin => "engine-plugin",
            ItemKind::Skill if item.source == "skills-hub" => "hub-skill",
            ItemKind::Skill | ItemKind::Plugin | ItemKind::Mod => "plugin",
        })
    }

    // ------------------------------------------------------------ stage

    /// Fetch the item's pin into staging and check it. Nothing runs.
    ///
    /// # Errors
    /// `hx.store.not_found`, `removed`, `unpinned`, `offline`, `source_unreachable`, `rate_limited`, `digest_mismatch`,
    /// `too_large`, `unsafe_archive`, `dangerous_verdict`, `kind_unsupported`, `invalid_manifest`.
    pub async fn stage(&self, id: &str, profile: Option<String>) -> Result<StageResult> {
        let _one = self.busy.lock().await;
        let bot = self.host.bot(profile)?;
        let entry = self.find(id)?;
        let item = self.with_kill_list(entry.item.clone());
        if let Some(r) = &item.removed {
            return Err(err(
                "hx.store.removed",
                format!(
                    "{} ({})",
                    r.reason,
                    serde_json::to_value(r.by)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                        .unwrap_or_default()
                ),
            ));
        }
        let Some(pin) = item.pinned.clone() else {
            return Err(err(
                "hx.store.unpinned",
                "this item is not pinned to an exact version, so boopis will not install it",
            ));
        };
        let route = Self::route_of(&entry)?;
        let (sid, dir) = self.staging.create()?;
        match self
            .stage_into(&entry, &item, &pin, &bot, route, &sid, &dir.join("tree"))
            .await
        {
            Ok(r) => Ok(r),
            Err(e) => {
                self.staging.remove(&sid);
                Err(e)
            }
        }
    }

    #[allow(clippy::too_many_lines)] // one step per route
    async fn stage_into(
        &self,
        entry: &Entry,
        item: &StoreItem,
        pin: &Pin,
        bot: &str,
        route: &str,
        sid: &str,
        tree: &std::path::Path,
    ) -> Result<StageResult> {
        let lim = self.limits.store.clone();
        std::fs::create_dir_all(tree).map_err(|e| Error::Io(e.to_string()))?;
        let mut stats = stage::Stats::default();
        let mut engine = None;
        match route {
            "catalog" | "registry" | "hub-skill" => {}
            "bundle" | "bundle-file" => {
                let (bytes, expect) = if route == "bundle" {
                    let b = servers::pick(&entry.raw)
                        .map_err(unsupported)?
                        .bundle
                        .ok_or_else(|| unsupported("no bundle"))?;
                    let host = url::Url::parse(&b.url)
                        .ok()
                        .and_then(|u| u.host_str().map(str::to_owned))
                        .ok_or_else(|| {
                            err(
                                "hx.store.source_unreachable",
                                "the bundle's address is not one",
                            )
                        })?;
                    let (f, max, url) =
                        (self.fetcher.clone(), lim.max_archive_bytes, b.url.clone());
                    let reply = blocking(move || {
                        f.get(
                            &url,
                            &Hosts::new(&[host]),
                            &Ask {
                                max_bytes: max,
                                etag: None,
                                accept: None,
                            },
                        )
                    })
                    .await?;
                    (reply.body, b.sha256)
                } else {
                    let p = entry.raw["path"].as_str().unwrap_or_default().to_owned();
                    let bytes = std::fs::read(&p)
                        .map_err(|e| Error::Io(format!("cannot read the bundle: {e}")))?;
                    if bytes.len() as u64 > lim.max_archive_bytes {
                        return Err(err(
                            "hx.store.too_large",
                            "that bundle is larger than boopis accepts",
                        ));
                    }
                    (bytes, pin.value.clone())
                };
                let found = stage::sha256_hex(&bytes);
                if found != expect {
                    return Err(err(
                        "hx.store.digest_mismatch",
                        format!("expected {expect}, found {found}"),
                    ));
                }
                stats = stage::unpack_zip(&bytes, tree, &Select::default(), &lim)?;
            }
            "engine-plugin" => {
                let name = entry.raw["name"].as_str().ok_or_else(|| {
                    err(
                        "hx.store.invalid_manifest",
                        "the catalogue entry has no name",
                    )
                })?;
                let a = self
                    .host
                    .backend(bot)?
                    .rpc(
                        "plugins.manage",
                        &json!({"action": "inspect", "catalog_name": name}),
                    )
                    .await?;
                if a["ok"] == false {
                    return Err(err(
                        "hx.store.invalid_manifest",
                        format!(
                            "the engine could not read it: {}",
                            a["error"].as_str().unwrap_or("no reason given")
                        ),
                    ));
                }
                let read = a["sha"].as_str().unwrap_or_default().to_ascii_lowercase();
                if read != pin.value {
                    return Err(err(
                        "hx.store.digest_mismatch",
                        format!(
                            "the catalogue pins {} and the engine read {read}",
                            pin.value
                        ),
                    ));
                }
                engine = Some(json!({
                    "capabilities": entry.raw.get("capabilities").cloned().unwrap_or(Value::Null),
                    "halves": {"agent": a["agent"], "desktop": a["desktop"]},
                    "scan": {"verdict": "not-scanned", "scanner": "the engine's install check runs when it installs", "findings": []},
                    "name": name,
                    "warnings": a["warnings"],
                }));
            }
            "plugin" => stats = self.fetch_plugin(entry, pin, tree).await?,
            other => return Err(unsupported(format!("no way to stage {other}"))),
        }
        let byte_staged = matches!(route, "bundle" | "bundle-file" | "plugin");
        let (tree_sha, scan) = if byte_staged {
            let t = tree.to_owned();
            let (h, s) = blocking(move || Ok((stage::tree_sha256(&t)?, stage::scan(&t)?))).await?;
            check_manifest(item, route, tree)?;
            (Some(h), s)
        } else {
            (None, normalize::not_scanned())
        };
        if scan.verdict == ScanVerdict::Dangerous {
            let first = scan
                .findings
                .iter()
                .find(|f| f.level == super::types::FindingLevel::Dangerous);
            return Err(err(
                "hx.store.dangerous_verdict",
                first.map_or_else(
                    || "a dangerous pattern".to_owned(),
                    |f| format!("{}: {}", f.path.clone().unwrap_or_default(), f.text),
                ),
            ));
        }
        let expires = time::rfc3339(time::now_secs() + self.limits.store.stage_ttl.as_secs());
        let meta = Meta {
            item: item.clone(),
            raw: entry.raw.clone(),
            pinned: pin.clone(),
            bot: bot.to_owned(),
            route: route.to_owned(),
            tree_sha256: tree_sha.clone(),
            scan: scan.clone(),
            files: stats.files,
            bytes: stats.bytes,
            engine,
            created_at: time::now(),
            plan: None,
        };
        self.write_meta(sid, &meta)?;
        Ok(StageResult {
            stage_id: sid.to_owned(),
            item_id: item.id.clone(),
            pinned: pin.clone(),
            tree_sha256: tree_sha,
            files: stats.files,
            bytes: stats.bytes,
            scan,
            expires_at: expires,
        })
    }

    /// The bytes of a plugin, skill or mod: from GitHub at its commit, from an archive at its digest, or from a local folder.
    async fn fetch_plugin(
        &self,
        entry: &Entry,
        pin: &Pin,
        tree: &std::path::Path,
    ) -> Result<stage::Stats> {
        let lim = self.limits.store.clone();
        let raw = &entry.raw;
        let (source, select_sub): (PluginSource, Option<String>) = match raw["kind"].as_str() {
            Some("skill" | "tree") => (
                PluginSource::Git {
                    repo: raw["repo"].as_str().unwrap_or_default().to_owned(),
                    subdir: None,
                    sha: raw["sha"].as_str().map(str::to_owned),
                },
                raw["subdir"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned),
            ),
            Some("plugin") => {
                let base = MarketBase {
                    repo: raw["base_repo"].as_str().map(str::to_owned),
                    commit: raw["base_commit"].as_str().map(str::to_owned),
                    root_license: None,
                };
                match normalize::plugin_source(&raw["entry"], &base) {
                    Some(PluginSource::Git { repo, subdir, sha }) => (
                        PluginSource::Git {
                            repo,
                            subdir: None,
                            sha,
                        },
                        subdir,
                    ),
                    Some(other) => (other, None),
                    None => return Err(unsupported("its source is not one boopis reads")),
                }
            }
            Some("local") => {
                let src = PathBuf::from(raw["path"].as_str().unwrap_or_default());
                let (t, l) = (tree.to_owned(), lim);
                return blocking(move || stage::copy_tree(&src, &t, &l)).await.and_then(|st| {
                    let h = stage::tree_sha256(tree)?;
                    if h == pin.value {
                        Ok(st)
                    } else {
                        Err(err("hx.store.digest_mismatch", "the folder changed since it was added; refresh the source and look again"))
                    }
                });
            }
            _ => return Err(unsupported("boopis does not know how to fetch this item")),
        };
        match source {
            PluginSource::Git { repo, sha, .. } => {
                let r = github::parse(&repo).map_err(|_| unsupported("boopis installs from GitHub and from archives; this item is on another host"))?;
                let sha = sha.ok_or_else(|| err("hx.store.unpinned", "no commit is named"))?;
                if pin.kind != PinKind::Commit || pin.value != sha {
                    return Err(err(
                        "hx.store.digest_mismatch",
                        "the pin and the source disagree",
                    ));
                }
                self.fetch_tarball(&r, &sha, select_sub, tree).await
            }
            PluginSource::Archive { url, sha256 } => {
                let want = sha256.ok_or_else(|| {
                    err(
                        "hx.store.unpinned",
                        "an archive with no sha256 is not installed",
                    )
                })?;
                if pin.kind != PinKind::ArchiveSha256 || pin.value != want.to_ascii_lowercase() {
                    return Err(err(
                        "hx.store.digest_mismatch",
                        "the pin and the source disagree",
                    ));
                }
                let host = url::Url::parse(&url)
                    .ok()
                    .and_then(|u| u.host_str().map(str::to_owned))
                    .unwrap_or_default();
                let (f, max, u) = (self.fetcher.clone(), lim.max_archive_bytes, url.clone());
                let reply = blocking(move || {
                    f.get(
                        &u,
                        &Hosts::new(&[host]),
                        &Ask {
                            max_bytes: max,
                            etag: None,
                            accept: None,
                        },
                    )
                })
                .await?;
                let found = stage::sha256_hex(&reply.body);
                if found != want.to_ascii_lowercase() {
                    return Err(err(
                        "hx.store.digest_mismatch",
                        format!("expected {want}, found {found}"),
                    ));
                }
                let t = tree.to_owned();
                blocking(move || {
                    let sel = Select {
                        strip_top: false,
                        subdir: None,
                    };
                    if reply.body.starts_with(b"PK") {
                        stage::unpack_zip(&reply.body, &t, &sel, &lim)
                    } else {
                        stage::unpack_tar_gz(&reply.body, &t, &sel, &lim)
                    }
                })
                .await
            }
            PluginSource::Npm { .. } => {
                Err(unsupported("an npm package is not installed by the store"))
            }
            PluginSource::Command => Err(unsupported(
                "a source that runs a command is never installed",
            )),
        }
    }

    async fn fetch_tarball(
        &self,
        r: &Repo,
        sha: &str,
        subdir: Option<String>,
        tree: &std::path::Path,
    ) -> Result<stage::Stats> {
        let (f, lim, owner, name, sha, t) = (
            self.fetcher.clone(),
            self.limits.store.clone(),
            r.owner.clone(),
            r.name.clone(),
            sha.to_owned(),
            tree.to_owned(),
        );
        blocking(move || {
            let reply = f.get(
                &github::archive_url(&owner, &name, &sha),
                &Hosts::new(&[]),
                &Ask {
                    max_bytes: lim.max_archive_bytes,
                    etag: None,
                    accept: None,
                },
            )?;
            let stats = stage::unpack_tar_gz(
                &reply.body,
                &t,
                &Select {
                    strip_top: true,
                    subdir,
                },
                &lim,
            )?;
            match stats.commit.as_deref() {
                Some(c) if c == sha => Ok(stats),
                Some(c) => Err(err(
                    "hx.store.digest_mismatch",
                    format!("expected commit {sha}, the download is {c}"),
                )),
                None => Err(err(
                    "hx.store.digest_mismatch",
                    "the download does not say which commit it is",
                )),
            }
        })
        .await
    }

    // ------------------------------------------------------------ plan

    async fn sessions_open(&self, bot: &str) -> Option<u32> {
        let backend = self.host.backend(bot).ok()?;
        backend
            .rpc("session.active_list", &json!({}))
            .await
            .ok()
            .map(|a| connectors::ops::count_running(&a))
    }

    fn default_scope(bot: &str) -> Scope {
        Scope {
            level: ScopeLevel::Bot,
            bot: bot.to_owned(),
            project: None,
        }
    }

    /// The connector source of a staged connector, with the bundle's place when it is one.
    fn conn_source(
        &self,
        m: &Meta,
        sid: &str,
    ) -> Result<(ConnSource, Option<PathBuf>, Vec<String>, Option<Chosen>)> {
        match m.route.as_str() {
            "catalog" => Ok((
                ConnSource::Request(catalog_request(
                    m.raw["connector"].as_str().unwrap_or_default(),
                )?),
                None,
                vec![],
                None,
            )),
            "registry" => {
                let c = servers::pick(&m.raw).map_err(unsupported)?;
                let spec = c
                    .spec
                    .clone()
                    .ok_or_else(|| unsupported("no way to run it"))?;
                Ok((ConnSource::Spec(spec), None, c.unfilled.clone(), Some(c)))
            }
            _ => {
                let tree = self.tree(sid)?;
                let manifest: Value = serde_json::from_slice(
                    &std::fs::read(tree.join("manifest.json")).map_err(|_| {
                        err(
                            "hx.store.invalid_manifest",
                            "the bundle has no manifest.json",
                        )
                    })?,
                )
                .map_err(|_| {
                    err(
                        "hx.store.invalid_manifest",
                        "the bundle's manifest.json is not JSON",
                    )
                })?;
                let hash = m.tree_sha256.clone().unwrap_or_default();
                let dir = bundle_dir(self.cache.root(), &hash);
                let name = servers::install_name(manifest["name"].as_str().unwrap_or("bundle"));
                let (spec, unfilled) =
                    servers::bundle_spec(&manifest, &dir, &name).map_err(unsupported)?;
                Ok((
                    ConnSource::Spec(spec),
                    Some(dir),
                    unfilled,
                    servers::pick(&m.raw).ok(),
                ))
            }
        }
    }

    #[allow(clippy::too_many_lines)] // the connector's plan, row by row
    async fn plan_connector(
        &self,
        m: &Meta,
        sid: &str,
        scope: Scope,
        sessions: Option<u32>,
    ) -> Result<(InstallPlan, ConnSource, Option<PathBuf>, String)> {
        let (src, bundle, unfilled, chosen) = self.conn_source(m, sid)?;
        let cp = src.build(None)?;
        let hash12 = cp.hash[..12].to_owned();
        let mut code_runs = Vec::new();
        if let Some(cmd) = cp.config["command"].as_str() {
            let args: Vec<String> = cp.config["args"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            code_runs.push(plan::connector_code_run(cmd, &args));
        }
        let mut secrets: Vec<super::types::SecretNeed> = cp
            .secrets
            .iter()
            .map(|s| {
                let known = m.item.secrets.iter().find(|k| k.id == s.field);
                super::types::SecretNeed {
                    id: s.field.clone(),
                    title: s.title.clone(),
                    env: known.and_then(|k| k.env.clone()),
                    host: known.and_then(|k| k.host.clone()),
                    optional: s.optional,
                }
            })
            .collect();
        secrets.sort_by(|a, b| a.id.cmp(&b.id));
        let mut files = vec![
            FileWrite { path: format!("engine configuration: mcp_servers.{}", cp.name), purpose: format!("the server's entry (connector plan {hash12})"), bytes: None },
            FileWrite { path: format!("engine configuration: {}", connectors::GOVERNED_ALLOWLIST), purpose: "lets a governed session's exec call this server, each call decided by your permissions".into(), bytes: None },
        ];
        if let Some(d) = &bundle {
            files.push(FileWrite {
                path: d.to_string_lossy().into_owned(),
                purpose: "the bundle's files, unpacked".into(),
                bytes: Some(m.bytes),
            });
        }
        let mut consent = Vec::new();
        if let Some(r) = code_runs.first() {
            consent.push(ConsentItem {
                id: "runs-server".into(),
                text: format!(
                    "Run `{}` on this computer, as you, whenever a session uses this server.",
                    r.command
                ),
                runs_code: true,
            });
        } else if let Some(url) = cp.config["url"].as_str() {
            let host = url::Url::parse(url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_owned))
                .unwrap_or_default();
            consent.push(ConsentItem { id: "sends-to-host".into(), text: format!("Send what the assistant gives this server, and read what it returns, at {host}."), runs_code: false });
        }
        for s in &secrets {
            consent.push(plan::key_consent(&s.title, &s.id));
        }
        let mut warnings = Vec::new();
        plan::ensure_tier_warnings(&mut warnings, m.item.tier, ItemKind::Connector);
        if cp.config.get("url").is_some() {
            warnings.push(Warning { code: "not-pinned-remote".into(), level: WarningLevel::Caution, text: "A server somebody else runs: boopis cannot pin what it does, and its publisher can change it.".into() });
        }
        for name in &unfilled {
            warnings.push(Warning { code: "unfilled-input".into(), level: WarningLevel::Caution, text: format!("This server asks for {name}, which boopis cannot ask you for yet. It may not start without it.") });
        }
        if cp.oauth {
            warnings.push(Warning {
                code: "sign-in".into(),
                level: WarningLevel::Info,
                text: "You sign in to it in your browser after it is installed.".into(),
            });
        }
        warnings.push(Warning {
            code: "next-session".into(),
            level: WarningLevel::Info,
            text: match sessions {
                Some(n) if n > 0 => format!("It takes effect in new sessions. {n} session{} {} a turn running; they keep the tools they started with.", if n == 1 { "" } else { "s" }, if n == 1 { "has" } else { "have" }),
                _ => "It takes effect in new sessions; a session that is open keeps the tools it started with.".into(),
            },
        });
        let _ = chosen;
        let hosts = m.item.hosts.clone();
        let mut p = InstallPlan {
            item_id: m.item.id.clone(),
            kind: ItemKind::Connector,
            title: m.item.title.clone(),
            source: m.item.source.clone(),
            publisher: m.item.publisher.clone(),
            version: m.item.version.clone(),
            pinned: m.pinned.clone(),
            tree_sha256: m.tree_sha256.clone(),
            stage_id: Some(sid.to_owned()),
            layer: Layer::Connector,
            components: vec![Component {
                kind: ComponentKind::McpServer,
                name: cp.name.clone(),
                detail: Some(if cp.config.get("url").is_some() {
                    "a hosted server".into()
                } else {
                    "a local program".into()
                }),
            }],
            code_runs,
            hosts,
            secrets,
            files_written: files,
            scope,
            consent,
            warnings,
            governed: plan::connector_governed(),
            cost: Cost {
                tools: None,
                context_tokens: None,
            },
            tier: m.item.tier,
            scan: m.scan.clone(),
            sessions_open: sessions,
            plan_hash: String::new(),
        };
        plan::seal(&mut p);
        Ok((p, src, bundle, cp.hash))
    }

    fn prepare_params(&self, m: &Meta, sid: &str, scope: &Scope, kind: &str) -> Result<Value> {
        let mut p = json!({
            "kind": kind, "item_id": m.item.id, "source": m.item.source, "pinned": m.pinned, "tree_sha256": m.tree_sha256,
            "scope": scope,
        });
        if kind == "engine-plugin" {
            p["engine"] = m.engine.clone().unwrap_or(Value::Null);
        } else {
            p["staged_dir"] = json!(self.tree(sid)?.to_string_lossy());
        }
        if let Some(project) = &scope.project {
            p["cwd"] = json!(project);
        }
        // A marketplace entry's own `source`, as the host read it: the plugin refuses a source it cannot pin, and a pin that
        // differs from the entry's.
        if m.raw["kind"] == "plugin"
            && let Some(src) = m.raw["entry"].get("source")
        {
            p["entry_source"] = src.clone();
        }
        Ok(p)
    }

    /// The plugin's half of a plan, joined to the host's. Returns the plan and the plugin's own hash.
    async fn plan_plugin(
        &self,
        m: &Meta,
        sid: &str,
        scope: Scope,
        sessions: Option<u32>,
    ) -> Result<(InstallPlan, Option<String>)> {
        let kind = match (m.route.as_str(), m.item.kind) {
            ("engine-plugin", _) => "engine-plugin",
            (_, ItemKind::Skill) => "skill",
            (_, ItemKind::Mod) => "mod",
            _ => "plugin",
        };
        let backend = self.host.backend(&m.bot)?;
        let params = self.prepare_params(m, sid, &scope, kind)?;
        let raw = backend.rpc("plugin.boopis.store.prepare", &params).await?;
        let pp: PluginPlan = serde_json::from_value(raw).map_err(|e| {
            err(
                "hx.store.invalid_manifest",
                format!("the plugin's plan is not in the contract's shape: {e}"),
            )
        })?;
        if pp.scan.verdict == ScanVerdict::Dangerous {
            return Err(err(
                "hx.store.dangerous_verdict",
                pp.scan
                    .findings
                    .first()
                    .map_or_else(|| "a dangerous pattern".to_owned(), |f| f.text.clone()),
            ));
        }
        let hash = pp.plugin_hash.clone();
        let layer = if m.route == "engine-plugin" {
            Layer::Engine
        } else {
            Layer::Plugin
        };
        let base = Base {
            item: &m.item,
            pinned: m.pinned.clone(),
            tree_sha256: m.tree_sha256.clone(),
            stage_id: Some(sid.to_owned()),
            scope,
            scan: m.scan.clone(),
            sessions_open: sessions,
        };
        let mut p = plan::merge_plugin(base, layer, pp);
        p.warnings.push(Warning {
            code: "next-session".into(),
            level: WarningLevel::Info,
            text: match sessions {
                Some(n) if n > 0 => format!("It takes effect in new sessions. {n} session{} {} a turn running; they keep what they started with.", if n == 1 { "" } else { "s" }, if n == 1 { "has" } else { "have" }),
                _ => "It takes effect in new sessions; a session that is open keeps what it started with.".into(),
            },
        });
        plan::seal(&mut p);
        Ok((p, Some(hash)))
    }

    fn plan_hub_skill(
        &self,
        m: &Meta,
        sid: &str,
        scope: Scope,
        sessions: Option<u32>,
    ) -> InstallPlan {
        let mut warnings = Vec::new();
        plan::ensure_tier_warnings(&mut warnings, m.item.tier, ItemKind::Skill);
        let mut p = InstallPlan {
            item_id: m.item.id.clone(),
            kind: ItemKind::Skill,
            title: m.item.title.clone(),
            source: m.item.source.clone(),
            publisher: m.item.publisher.clone(),
            version: m.item.version.clone(),
            pinned: m.pinned.clone(),
            tree_sha256: None,
            stage_id: Some(sid.to_owned()),
            layer: Layer::Engine,
            components: vec![Component {
                kind: ComponentKind::Skill,
                name: m.item.title.clone(),
                detail: None,
            }],
            code_runs: vec![],
            hosts: m.item.hosts.clone(),
            secrets: vec![],
            files_written: vec![FileWrite {
                path: "the bot's skills folder".into(),
                purpose: "the skill's files, installed by the engine's hub".into(),
                bytes: None,
            }],
            scope,
            consent: vec![ConsentItem {
                id: "adds-skill".into(),
                text:
                    "Add this skill's instructions, and any scripts it ships, to this bot's skills."
                        .into(),
                runs_code: false,
            }],
            warnings,
            governed: governed_for(ItemKind::Skill),
            cost: Cost {
                tools: None,
                context_tokens: None,
            },
            tier: m.item.tier,
            scan: m.scan.clone(),
            sessions_open: sessions,
            plan_hash: String::new(),
        };
        plan::seal(&mut p);
        p
    }

    async fn build_plan(
        &self,
        m: &Meta,
        sid: &str,
        scope: Scope,
    ) -> Result<(
        InstallPlan,
        Option<String>,
        Option<(ConnSource, Option<PathBuf>, String)>,
    )> {
        let sessions = self.sessions_open(&m.bot).await;
        match m.route.as_str() {
            "catalog" | "registry" | "bundle" | "bundle-file" => {
                let (p, src, bundle, ch) = self.plan_connector(m, sid, scope, sessions).await?;
                Ok((p, None, Some((src, bundle, ch))))
            }
            "plugin" | "engine-plugin" => {
                let (p, h) = self.plan_plugin(m, sid, scope, sessions).await?;
                Ok((p, h, None))
            }
            "hub-skill" => Ok((self.plan_hub_skill(m, sid, scope, sessions), None, None)),
            other => Err(unsupported(format!("no plan for {other}"))),
        }
    }

    /// What installing the staged item would do, exactly, with its hash. Changes nothing.
    ///
    /// # Errors
    /// `hx.store.stage_missing`, `dangerous_verdict`, `kind_unsupported`, `invalid_manifest`.
    pub async fn plan(
        &self,
        stage_id: &str,
        scope: Option<Scope>,
        profile: Option<String>,
    ) -> Result<InstallPlan> {
        let mut m = self.read_meta(stage_id)?;
        let bot = self.host.bot(profile)?;
        if m.bot != bot {
            return Err(err(
                "hx.store.stage_missing",
                "that copy was downloaded for another bot",
            ));
        }
        let installed_scope = self.installed_scope(&bot, &m.item.id);
        let scope = scope
            .or(installed_scope)
            .unwrap_or_else(|| Self::default_scope(&bot));
        if scope.bot != bot {
            return Err(Error::InvalidInput("the scope names another bot".into()));
        }
        if scope.level == ScopeLevel::BotProject
            && scope.project.as_deref().is_none_or(str::is_empty)
        {
            return Err(Error::InvalidInput(
                "a scope for a project names the project".into(),
            ));
        }
        let (p, plugin_hash, _) = self.build_plan(&m, stage_id, scope.clone()).await?;
        m.plan = Some(PlanMeta {
            plan_hash: p.plan_hash.clone(),
            plugin_hash,
            scope,
        });
        self.write_meta(stage_id, &m)?;
        Ok(p)
    }

    fn installed_scope(&self, bot: &str, id: &str) -> Option<Scope> {
        self.record_of(bot, id)
            .map(|r| r.receipt.scope)
            .or_else(|| {
                lock(&self.seen_plugin)
                    .get(bot)
                    .and_then(|v| v.iter().find(|r| r.item_id == id).map(|r| r.scope.clone()))
            })
    }

    // ------------------------------------------------------------ install

    /// Update `id` to the staged copy: [`Store::install`] after checking that the staged item is `id`.
    ///
    /// # Errors
    /// `hx.store.stage_missing` when the staged copy is another item's; else as [`Store::install`].
    pub async fn update(
        &self,
        id: &str,
        request: InstallRequest,
        profile: Option<String>,
    ) -> Result<InstallReceipt> {
        if self.read_meta(&request.stage_id)?.item.id != id {
            return Err(err(
                "hx.store.stage_missing",
                "that downloaded copy is of another item",
            ));
        }
        self.install(request, profile, true).await
    }

    /// Install what the review showed, or update to it. `request.plan_hash` is the plan the user saw; it is rebuilt and
    /// refused if it differs.
    ///
    /// # Errors
    /// `hx.store.plan_changed`, `stage_missing`, `already_installed`, `not_installed` (an update), `dangerous_verdict`,
    /// `governed_refused`, `install_failed`; for a connector the `hx.connectors.*` codes.
    pub async fn install(
        &self,
        request: InstallRequest,
        profile: Option<String>,
        update: bool,
    ) -> Result<InstallReceipt> {
        let _one = self.busy.lock().await;
        let m = self.read_meta(&request.stage_id)?;
        let bot = self.host.bot(profile.clone())?;
        if m.bot != bot {
            return Err(err(
                "hx.store.stage_missing",
                "that copy was downloaded for another bot",
            ));
        }
        let planned = m.plan.clone().ok_or_else(|| {
            err(
                "hx.store.plan_changed",
                "the item was never planned: review it first",
            )
        })?;
        if let Some(r) = self
            .with_kill_list(
                self.find(&m.item.id)
                    .map_or_else(|_| m.item.clone(), |e| e.item),
            )
            .removed
        {
            return Err(err("hx.store.removed", r.reason));
        }
        let (rebuilt, plugin_hash, conn) = self
            .build_plan(&m, &request.stage_id, planned.scope.clone())
            .await?;
        if rebuilt.plan_hash != request.plan_hash
            || rebuilt.plan_hash != planned.plan_hash
            || plugin_hash != planned.plugin_hash
        {
            return Err(err(
                "hx.store.plan_changed",
                "what would be installed is not what the card showed",
            ));
        }
        if rebuilt.scan.verdict == ScanVerdict::Dangerous {
            return Err(err(
                "hx.store.dangerous_verdict",
                "the check found something dangerous",
            ));
        }
        let existing = self
            .installed(profile.clone())
            .await
            .unwrap_or_default()
            .into_iter()
            .find(|r| r.item_id == m.item.id);
        match (&existing, update) {
            (Some(_), false) => {
                return Err(err(
                    "hx.store.already_installed",
                    "that item is installed; use update to change it",
                ));
            }
            (None, true) => {
                return Err(err("hx.store.not_installed", "that item is not installed"));
            }
            _ => {}
        }
        let previous = existing.as_ref().map(|r| PreviousVersion {
            version: r.version.clone(),
            pinned: r.pinned.clone(),
            tree_sha256: r.tree_sha256.clone(),
        });
        let receipt = match m.route.as_str() {
            "catalog" | "registry" | "bundle" | "bundle-file" => {
                let (src, bundle, conn_hash) =
                    conn.ok_or_else(|| err("hx.store.install_failed", "no connector plan"))?;
                self.install_connector(
                    &request,
                    &rebuilt,
                    src,
                    bundle,
                    &conn_hash,
                    previous.as_ref(),
                    update,
                    &bot,
                )
                .await?
            }
            "hub-skill" => {
                self.install_hub_skill(&m, &request, &rebuilt, previous, &bot)
                    .await?
            }
            _ => {
                self.install_via_plugin(&m, &request, &rebuilt, &planned, update, &bot)
                    .await?
            }
        };
        self.staging.remove(&request.stage_id);
        Ok(receipt)
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    async fn install_connector(
        &self,
        request: &InstallRequest,
        p: &InstallPlan,
        src: ConnSource,
        bundle: Option<PathBuf>,
        conn_hash: &str,
        previous: Option<&PreviousVersion>,
        update: bool,
        bot: &str,
    ) -> Result<InstallReceipt> {
        let engine: Arc<Engine> = self.host.connectors(bot)?;
        let secrets = request.secrets.clone().unwrap_or_default();
        let name = src.build(None)?.name;
        if update {
            engine.remove(&name, false).await.map_err(|e| {
                err(
                    "hx.store.install_failed",
                    format!("the old version could not be removed: {e}"),
                )
            })?;
        }
        if let Some(dir) = &bundle {
            let (from, to, lim) = (
                self.tree(&request.stage_id)?,
                dir.clone(),
                self.limits.store.clone(),
            );
            let _ = std::fs::remove_dir_all(&to);
            blocking(move || stage::copy_tree(&from, &to, &lim).map(|_| ())).await?;
        }
        let restart = request.restart.map(|r| match r {
            RestartWhen::Now => connectors::RestartWhen::Now,
            RestartWhen::WhenIdle => connectors::RestartWhen::WhenIdle,
        });
        let s2 = src.clone();
        let planner = move |provided: Option<&BTreeSet<String>>| s2.build(provided);
        let report = match engine
            .install_with(&planner, conn_hash, &secrets, restart)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                if let Some(dir) = &bundle {
                    let _ = std::fs::remove_dir_all(dir);
                }
                return Err(match e {
                    Error::Connector("hx.connectors.plan_changed", m) => {
                        err("hx.store.plan_changed", m)
                    }
                    other => other,
                });
            }
        };
        let mut files: Vec<String> = p.files_written.iter().map(|f| f.path.clone()).collect();
        files.sort();
        let mut steps: Vec<InstallStep> = report
            .steps
            .iter()
            .map(|s| InstallStep {
                name: s.title.clone(),
                ok: step_ok(s.state),
                note: Some(s.detail.clone()),
            })
            .collect();
        steps.insert(
            0,
            InstallStep {
                name: "Checked the plan".into(),
                ok: true,
                note: Some("what was installed is what the card showed".into()),
            },
        );
        let receipt = InstallReceipt {
            item_id: p.item_id.clone(),
            kind: ItemKind::Connector,
            title: Some(p.title.clone()),
            source: p.source.clone(),
            layer: Layer::Connector,
            version: p.version.clone(),
            pinned: p.pinned.clone(),
            plan_hash: p.plan_hash.clone(),
            tree_sha256: p.tree_sha256.clone(),
            installed_at: time::now(),
            scope: p.scope.clone(),
            files,
            enabled: true,
            effective: Effective::NextSession,
            trusted_projects: None,
            previous: previous.cloned(),
            kill_listed: None,
            restart_needed: Some(report.restart_pending),
            steps,
            notes: report.notes.clone(),
        };
        let mut all = self.cache.installed();
        all.items
            .retain(|r| !(r.bot == bot && r.receipt.item_id == p.item_id));
        all.items.push(HostRecord { bot: bot.to_owned(), receipt: receipt.clone(), plan: p.clone(), extra: json!({"name": name, "bundle_dir": bundle.map(|b| b.to_string_lossy().into_owned())}) });
        self.cache.save_installed(&all)?;
        Ok(receipt)
    }

    async fn install_hub_skill(
        &self,
        m: &Meta,
        request: &InstallRequest,
        p: &InstallPlan,
        previous: Option<PreviousVersion>,
        bot: &str,
    ) -> Result<InstallReceipt> {
        let identifier = m.raw["identifier"].as_str().unwrap_or_default();
        let a = self
            .host
            .backend(bot)?
            .rpc(
                "skills.manage",
                &json!({"action": "install", "query": identifier}),
            )
            .await?;
        if a["installed"] != true {
            return Err(err(
                "hx.store.install_failed",
                "the engine's hub did not install it",
            ));
        }
        let name = a["name"].as_str().unwrap_or(&m.item.title).to_owned();
        let receipt = InstallReceipt {
            item_id: p.item_id.clone(),
            kind: ItemKind::Skill,
            title: Some(p.title.clone()),
            source: p.source.clone(),
            layer: Layer::Engine,
            version: p.version.clone(),
            pinned: p.pinned.clone(),
            plan_hash: request.plan_hash.clone(),
            tree_sha256: None,
            installed_at: time::now(),
            scope: p.scope.clone(),
            files: vec![format!("skills/{name}")],
            enabled: true,
            effective: Effective::NextSession,
            trusted_projects: None,
            previous,
            kill_listed: None,
            restart_needed: None,
            steps: vec![InstallStep {
                name: "Installed by the engine's hub".into(),
                ok: true,
                note: None,
            }],
            notes: vec![],
        };
        let mut all = self.cache.installed();
        all.items
            .retain(|r| !(r.bot == bot && r.receipt.item_id == p.item_id));
        all.items.push(HostRecord {
            bot: bot.to_owned(),
            receipt: receipt.clone(),
            plan: p.clone(),
            extra: json!({"skill": name}),
        });
        self.cache.save_installed(&all)?;
        Ok(receipt)
    }

    async fn install_via_plugin(
        &self,
        m: &Meta,
        request: &InstallRequest,
        p: &InstallPlan,
        planned: &PlanMeta,
        update: bool,
        bot: &str,
    ) -> Result<InstallReceipt> {
        let backend = self.host.backend(bot)?;
        let kind = match (m.route.as_str(), p.kind) {
            ("engine-plugin", _) => "engine-plugin",
            (_, ItemKind::Skill) => "skill",
            (_, ItemKind::Mod) => "mod",
            _ => "plugin",
        };
        let mut engine_info = Value::Null;
        let mut steps = Vec::new();
        if m.route == "engine-plugin" {
            let name = m
                .engine
                .as_ref()
                .and_then(|e| e["name"].as_str())
                .unwrap_or_default();
            let call = if update {
                json!({"action": "update", "name": name, "accept_capabilities": true})
            } else {
                json!({"action": "install", "catalog_name": name, "ref": m.pinned.value, "inspected_sha": m.pinned.value, "enable": true})
            };
            let a = backend.rpc("plugins.manage", &call).await?;
            if a["ok"] == false {
                return Err(err(
                    "hx.store.install_failed",
                    format!(
                        "install: {}",
                        a["error"].as_str().unwrap_or("the engine refused it")
                    ),
                ));
            }
            if let Some(sha) = a["sha"].as_str()
                && !sha.eq_ignore_ascii_case(&m.pinned.value)
            {
                let _ = backend
                    .rpc("plugins.manage", &json!({"action": "remove", "name": name}))
                    .await;
                return Err(err(
                    "hx.store.digest_mismatch",
                    format!(
                        "the engine installed {sha}, not the pinned {}",
                        m.pinned.value
                    ),
                ));
            }
            engine_info = json!({"name": a["name"].as_str().unwrap_or(name), "version": m.item.version, "path": a["path"], "enabled": a["enabled"].as_bool().unwrap_or(true)});
            steps.push(InstallStep {
                name: "Installed by the engine".into(),
                ok: true,
                note: Some("pinned to the commit that was read".into()),
            });
        }
        let mut params = json!({
            "kind": kind, "item_id": m.item.id, "source": m.item.source, "pinned": m.pinned, "tree_sha256": m.tree_sha256,
            "plugin_hash": planned.plugin_hash, "plan_hash": request.plan_hash, "scope": p.scope,
        });
        if m.route == "engine-plugin" {
            params["engine"] = engine_info;
        } else {
            params["staged_dir"] = json!(self.tree(&request.stage_id)?.to_string_lossy());
        }
        if let Some(project) = &p.scope.project {
            params["cwd"] = json!(project);
        }
        let raw = match backend.rpc("plugin.boopis.store.confirm", &params).await {
            Ok(v) => v,
            Err(e) => {
                if m.route == "engine-plugin" && !update {
                    let name = m
                        .engine
                        .as_ref()
                        .and_then(|e| e["name"].as_str())
                        .unwrap_or_default();
                    let _ = backend
                        .rpc("plugins.manage", &json!({"action": "remove", "name": name}))
                        .await;
                }
                return Err(e);
            }
        };
        let mut receipt: InstallReceipt =
            serde_json::from_value(raw["receipt"].clone()).map_err(|e| {
                err(
                    "hx.store.install_failed",
                    format!("the plugin's receipt is not in the contract's shape: {e}"),
                )
            })?;
        let mut all = steps;
        all.extend(receipt.steps.clone());
        receipt.steps = all;
        Ok(receipt)
    }

    // ------------------------------------------------------------ installed, detail, uninstall

    /// What is installed for a bot: the host's record and the plugin's, merged. When the engine is down the plugin's part is absent
    /// and a note on each row says so.
    ///
    /// # Errors
    /// `InvalidInput` for a bot that is not one.
    pub async fn installed(&self, profile: Option<String>) -> Result<Vec<InstallReceipt>> {
        let bot = self.host.bot(profile)?;
        let kill: std::collections::BTreeMap<String, super::types::Removed> =
            self.kill_list().into_iter().collect();
        let mut out: Vec<InstallReceipt> = self
            .cache
            .installed()
            .items
            .into_iter()
            .filter(|r| r.bot == bot)
            .map(|r| r.receipt)
            .collect();
        let plugin = match self.host.backend(&bot) {
            Ok(b) => b.rpc("plugin.boopis.store.list", &json!({})).await,
            Err(e) => Err(e),
        };
        if let Ok(v) = plugin {
            let items: Vec<InstallReceipt> =
                serde_json::from_value(v["items"].clone()).unwrap_or_default();
            lock(&self.seen_plugin).insert(bot.clone(), items.clone());
            out.extend(items);
        } else {
            let note = "The engine is not running, so what was installed through the plugin is not listed.".to_owned();
            for r in &mut out {
                r.notes.push(note.clone());
            }
        }
        for r in &mut out {
            if r.kill_listed.is_none() {
                r.kill_listed = kill.get(&r.item_id).cloned();
            }
        }
        out.sort_by(|a, b| a.item_id.cmp(&b.item_id));
        out.dedup_by(|a, b| a.item_id == b.item_id);
        Ok(out)
    }

    /// Everything the detail page shows.
    ///
    /// # Errors
    /// `hx.store.not_found`.
    pub async fn detail(&self, id: &str, profile: Option<String>) -> Result<StoreDetail> {
        let item = self.with_kill_list(self.find(id)?.item);
        let installed = self
            .installed(profile.clone())
            .await
            .ok()
            .and_then(|v| v.into_iter().find(|r| r.item_id == id));
        let update = if installed.is_some() {
            self.diffs(profile, Some(id.to_owned()), false)
                .await
                .ok()
                .and_then(|mut v| v.pop())
        } else {
            None
        };
        Ok(StoreDetail {
            governed: governed_for(item.kind),
            cost: Cost {
                tools: None,
                context_tokens: None,
            },
            item,
            installed,
            update,
        })
    }

    /// Remove an installed item through the layer that owns it.
    ///
    /// # Errors
    /// `hx.store.not_installed`, `install_failed`; the connector flow's codes.
    pub async fn uninstall(
        &self,
        id: &str,
        delete_credentials: bool,
        profile: Option<String>,
    ) -> Result<UninstallResult> {
        let _one = self.busy.lock().await;
        let bot = self.host.bot(profile.clone())?;
        let mut result = UninstallResult {
            item_id: id.to_owned(),
            removed: vec![],
            kept_secrets: vec![],
            notes: vec![],
        };
        if let Some(rec) = self.record_of(&bot, id) {
            if rec.receipt.layer == Layer::Connector {
                let name = rec.extra["name"].as_str().unwrap_or_default().to_owned();
                let r = self
                    .host
                    .connectors(&bot)?
                    .remove(&name, delete_credentials)
                    .await?;
                result.removed.push(format!("the server {name}"));
                result.kept_secrets = r.kept_credentials;
                result.notes = r.notes;
                if let Some(dir) = rec.extra["bundle_dir"].as_str() {
                    let _ = std::fs::remove_dir_all(dir);
                    result.removed.push(dir.to_owned());
                }
            } else {
                let skill = rec.extra["skill"].as_str().unwrap_or_default().to_owned();
                let out = self
                    .host
                    .backend(&bot)?
                    .cli(&["skills", "uninstall", &skill, "--yes"])
                    .await?;
                if out.code != 0 {
                    return Err(err(
                        "hx.store.install_failed",
                        format!(
                            "skills uninstall: {}",
                            out.stderr.lines().last().unwrap_or("")
                        ),
                    ));
                }
                result.removed.push(format!("the skill {skill}"));
            }
            let mut all = self.cache.installed();
            all.items
                .retain(|r| !(r.bot == bot && r.receipt.item_id == id));
            self.cache.save_installed(&all)?;
            return Ok(result);
        }
        let mine = self
            .installed(profile)
            .await?
            .into_iter()
            .find(|r| r.item_id == id)
            .ok_or_else(|| err("hx.store.not_installed", "that item is not installed"))?;
        let backend = self.host.backend(&bot)?;
        if mine.kind == ItemKind::EnginePlugin {
            let name = id.split_once(':').map_or(id, |(_, n)| n);
            let a = backend
                .rpc("plugins.manage", &json!({"action": "remove", "name": name}))
                .await?;
            if a["ok"] == false {
                return Err(err(
                    "hx.store.install_failed",
                    format!(
                        "remove: {}",
                        a["error"].as_str().unwrap_or("the engine refused it")
                    ),
                ));
            }
            result
                .removed
                .push(format!("the plugin {name} (by the engine)"));
        }
        let mut params = json!({"item_id": id, "kind": mine.kind});
        if let Some(p) = &mine.scope.project {
            params["cwd"] = json!(p);
        }
        let v = backend
            .rpc("plugin.boopis.store.uninstall", &params)
            .await?;
        let r: UninstallResult = serde_json::from_value(v).map_err(|e| {
            err(
                "hx.store.install_failed",
                format!("the plugin's answer is not in the contract's shape: {e}"),
            )
        })?;
        result.removed.extend(r.removed);
        result.kept_secrets.extend(r.kept_secrets);
        result.notes.extend(r.notes);
        Ok(result)
    }

    // ------------------------------------------------------------ on and off

    /// Switch an installed item on or off for a bot; it takes effect in the next session. The layer that owns the item does it: a
    /// connector through the connector flow's switch, a plugin, mod, skill or engine plugin through the plugin's record (which asks
    /// the engine's own `plugins enable` and `plugins disable`). A skill from the engine's hub has no switch of its own.
    ///
    /// # Errors
    /// `hx.store.not_installed`, `hx.store.kind_unsupported` for a hub skill, `hx.store.install_failed` when the layer refuses.
    pub async fn set_item_enabled(
        &self,
        id: &str,
        enabled: bool,
        profile: Option<String>,
    ) -> Result<()> {
        let _one = self.busy.lock().await;
        let bot = self.host.bot(profile.clone())?;
        if let Some(rec) = self.record_of(&bot, id) {
            if rec.receipt.layer != Layer::Connector {
                return Err(err(
                    "hx.store.kind_unsupported",
                    "a skill from the engine's store is on while it is installed; remove it to turn it off",
                ));
            }
            let name = rec.extra["name"].as_str().unwrap_or_default().to_owned();
            self.host
                .connectors(&bot)?
                .set_enabled(&name, enabled)
                .await?;
            let mut all = self.cache.installed();
            for r in &mut all.items {
                if r.bot == bot && r.receipt.item_id == id {
                    r.receipt.enabled = enabled;
                }
            }
            self.cache.save_installed(&all)?;
            return Ok(());
        }
        let mine = self
            .installed(profile)
            .await?
            .into_iter()
            .find(|r| r.item_id == id)
            .ok_or_else(|| err("hx.store.not_installed", "that item is not installed"))?;
        let mut params = json!({"item_id": id, "kind": mine.kind, "enabled": enabled});
        if let Some(p) = &mine.scope.project {
            params["cwd"] = json!(p);
        }
        self.host
            .backend(&bot)?
            .rpc("plugin.boopis.store.set_enabled", &params)
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------ updates and rollback

    /// Which installed items have a different pin in the catalogue now, or were taken down, or lost their pin. Refreshes the
    /// catalogue first when asked (and when the network answers). Installs nothing.
    ///
    /// # Errors
    /// `hx.store.not_installed` when `id` is given and not installed.
    pub async fn update_check(
        &self,
        id: Option<String>,
        profile: Option<String>,
    ) -> Result<Vec<UpdateDiff>> {
        self.diffs(profile, id, true).await
    }

    async fn diffs(
        &self,
        profile: Option<String>,
        only: Option<String>,
        refresh: bool,
    ) -> Result<Vec<UpdateDiff>> {
        if refresh {
            // Offline is an answer, not a failure: the diff is made against the cache.
            let _ = self.refresh(None).await;
        }
        let bot = self.host.bot(profile.clone())?;
        let installed = self.installed(profile).await?;
        if let Some(id) = &only
            && !installed.iter().any(|r| &r.item_id == id)
        {
            return Err(err("hx.store.not_installed", "that item is not installed"));
        }
        let mut out = Vec::new();
        for r in installed
            .iter()
            .filter(|r| only.as_ref().is_none_or(|o| *o == r.item_id))
        {
            let from = PreviousVersion {
                version: r.version.clone(),
                pinned: r.pinned.clone(),
                tree_sha256: r.tree_sha256.clone(),
            };
            let mut d = UpdateDiff {
                item_id: r.item_id.clone(),
                status: UpdateStatus::UpToDate,
                from,
                to: None,
                changes: vec![],
                new_hosts: vec![],
                new_secrets: vec![],
                new_code: vec![],
                widened: false,
                tier_changed: None,
                removed: None,
                to_plan_hash: None,
            };
            let Ok(entry) = self.find(&r.item_id) else {
                d.status = UpdateStatus::SourceUnreachable;
                out.push(d);
                continue;
            };
            let item = self.with_kill_list(entry.item);
            if let Some(rm) = item.removed.clone().or_else(|| r.kill_listed.clone()) {
                d.status = UpdateStatus::Removed;
                d.removed = Some(rm);
            } else if let Some(pin) = item.pinned.clone() {
                if pin.value == r.pinned.value && pin.kind == r.pinned.kind {
                    continue;
                }
                d.status = UpdateStatus::Available;
                d.to = Some(PreviousVersion {
                    version: item.version.clone(),
                    pinned: pin,
                    tree_sha256: None,
                });
                if let Some(rec) = self.record_of(&bot, &r.item_id) {
                    let old = &rec.plan;
                    d.new_hosts = item
                        .hosts
                        .hosts
                        .iter()
                        .filter(|h| !old.hosts.hosts.contains(h))
                        .cloned()
                        .collect();
                    d.new_secrets = item
                        .secrets
                        .iter()
                        .filter(|s| !old.secrets.iter().any(|o| o.id == s.id))
                        .cloned()
                        .collect();
                    if old.tier != item.tier {
                        d.tier_changed = Some(super::types::TierChange {
                            from: old.tier,
                            to: item.tier,
                        });
                    }
                    d.widened = !d.new_hosts.is_empty()
                        || !d.new_secrets.is_empty()
                        || d.tier_changed.as_ref().is_some_and(|t| {
                            t.to == Tier::NotReviewed && t.from != Tier::NotReviewed
                        });
                } else {
                    // What the plugin installed: its own diff needs the new tree, which is staged when the user starts the update.
                    d.widened = false;
                }
                for h in &d.new_hosts {
                    d.changes.push(super::types::Change {
                        action: super::types::ChangeAction::Added,
                        kind: super::types::ChangeKind::Host,
                        name: h.clone(),
                        detail: None,
                    });
                }
                for s in &d.new_secrets {
                    d.changes.push(super::types::Change {
                        action: super::types::ChangeAction::Added,
                        kind: super::types::ChangeKind::Secret,
                        name: s.title.clone(),
                        detail: None,
                    });
                }
            } else {
                d.status = UpdateStatus::Unpinned;
            }
            out.push(d);
        }
        Ok(out)
    }

    /// Go back to the version kept one step back. The plugin swaps its own kinds atomically; a connector and an engine plugin
    /// keep no earlier copy, so there is nothing to swap to (`hx.store.no_previous`, naming the pin to reinstall).
    ///
    /// # Errors
    /// `hx.store.not_installed`, `no_previous`, `install_failed`.
    pub async fn rollback(&self, id: &str, profile: Option<String>) -> Result<InstallReceipt> {
        let _one = self.busy.lock().await;
        let bot = self.host.bot(profile.clone())?;
        let mine = self
            .installed(profile)
            .await?
            .into_iter()
            .find(|r| r.item_id == id)
            .ok_or_else(|| err("hx.store.not_installed", "that item is not installed"))?;
        let prev = mine.previous.clone().ok_or_else(|| {
            err(
                "hx.store.no_previous",
                "there is no earlier version to go back to",
            )
        })?;
        if mine.layer != Layer::Plugin {
            return Err(err(
                "hx.store.no_previous",
                format!(
                    "boopis keeps no earlier copy of this kind; install version {} again from its page (pinned {})",
                    prev.version.as_deref().unwrap_or("before"),
                    prev.pinned.value
                ),
            ));
        }
        let mut params = json!({"item_id": id, "kind": mine.kind});
        if let Some(p) = &mine.scope.project {
            params["cwd"] = json!(p);
        }
        let v = self
            .host
            .backend(&bot)?
            .rpc("plugin.boopis.store.rollback", &params)
            .await?;
        serde_json::from_value(v["receipt"].clone()).map_err(|_| {
            err(
                "hx.store.install_failed",
                "the plugin gave no receipt for the earlier version",
            )
        })
    }
}

/// A staged tree is what its item says it is: a skill has a valid `SKILL.md`, a plugin has a manifest or parts, a bundle has a
/// manifest with a server.
fn check_manifest(item: &StoreItem, route: &str, tree: &std::path::Path) -> Result<()> {
    let bad = |why: String| err("hx.store.invalid_manifest", why);
    match (route, item.kind) {
        ("bundle" | "bundle-file", _) => {
            let m: Value = serde_json::from_slice(
                &std::fs::read(tree.join("manifest.json"))
                    .map_err(|_| bad("the bundle has no manifest.json".into()))?,
            )
            .map_err(|_| bad("the bundle's manifest.json is not JSON".into()))?;
            if m.get("server").is_none() || m["name"].as_str().is_none() {
                return Err(bad("the bundle's manifest has no name or no server".into()));
            }
        }
        (_, ItemKind::Skill) => {
            let text = std::fs::read_to_string(tree.join("SKILL.md"))
                .map_err(|_| bad("the skill has no SKILL.md".into()))?;
            discover::skill_doc("", &text).map_err(bad)?;
        }
        (_, ItemKind::Plugin | ItemKind::Mod) => {
            let doc = discover::plugin_doc(tree).map_err(bad)?;
            let c = discover::count_components(tree);
            if doc.is_none()
                && c.skills + c.commands + c.agents + c.hooks + c.mcp_servers + c.modules == 0
            {
                return Err(bad(
                    "there is no plugin manifest and nothing a plugin holds".into(),
                ));
            }
            if item.kind == ItemKind::Mod && !doc.as_ref().is_some_and(|d| d.is_mod) {
                return Err(bad(
                    "it is listed as a mod, but its hooks name no modules".into()
                ));
            }
        }
        _ => {}
    }
    Ok(())
}
