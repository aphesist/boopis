//! Every source's own shape, normalised to a [`StoreItem`] (`docs/STORE.md` 5.3). Each function is pure: it takes what the
//! source answered (parsed JSON) and the time, and returns items. Nothing is fetched, nothing is guessed: a field a source does
//! not give is `not stated`, `unknown` or `null`, never filled in. The tests run each one over a response saved from the real
//! source (`fixtures/`, where each came from is in its test).
//!
//! An [`Entry`] keeps the source's own record next to the item (`raw`), because what the install needs (a registry
//! `server.json`, a marketplace entry's `source`, a catalogue entry's `subdir`) is not in the item's shape. The raw record is
//! the source's data and is read again at plan time, so what is installed is what the cache says.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::servers;
use super::types::{
    ComponentCounts, HostBasis, HostList, ItemKind, NamespaceProof, Pin, PinKind, Provenance,
    Removed, RemovedBy, Scan, ScanVerdict, SecretNeed, StoreItem, Tier,
};

/// An item and the source's own record of it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    /// What the store shows.
    pub item: StoreItem,
    /// What the source said, kept for the install.
    pub raw: Value,
}

/// `not stated`: what a missing licence shows as.
pub const NOT_STATED: &str = "not stated";

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

fn cap(text: &str, n: usize) -> String {
    let t: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() <= n {
        t
    } else {
        let mut cut: String = t.chars().take(n - 1).collect();
        cut.push('…');
        cut
    }
}

fn is_sha1(v: &str) -> bool {
    v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The scan of an item nothing was staged for.
#[must_use]
pub fn not_scanned() -> Scan {
    Scan {
        verdict: ScanVerdict::NotScanned,
        scanner: "not scanned: nothing is downloaded until the item is opened for install".into(),
        findings: vec![],
    }
}

fn no_components() -> ComponentCounts {
    ComponentCounts {
        known: false,
        skills: 0,
        commands: 0,
        agents: 0,
        hooks: 0,
        mcp_servers: 0,
        modules: 0,
        scripts: 0,
        python: 0,
    }
}

/// The pieces every item shares, so each normaliser fills only what its source knows.
struct Draft<'a> {
    source: &'a str,
    name: String,
    kind: ItemKind,
    title: String,
    publisher: String,
    summary: String,
    license: Option<String>,
    homepage: Option<String>,
    version: Option<String>,
    pinned: Option<Pin>,
    components: ComponentCounts,
    hosts: HostList,
    secrets: Vec<SecretNeed>,
    tier: Tier,
    verified: Option<String>,
    removed: Option<Removed>,
    tags: Vec<String>,
    proof: NamespaceProof,
    source_url: String,
    last_updated: Option<String>,
    source_tier: Option<String>,
}

impl<'a> Draft<'a> {
    fn new(source: &'a str, name: &str, kind: ItemKind) -> Self {
        Self {
            source,
            name: name.to_owned(),
            kind,
            title: name.to_owned(),
            publisher: "unknown".into(),
            summary: String::new(),
            license: None,
            homepage: None,
            version: None,
            pinned: None,
            components: no_components(),
            hosts: HostList {
                basis: HostBasis::Unknown,
                hosts: vec![],
            },
            secrets: vec![],
            tier: Tier::NotReviewed,
            verified: None,
            removed: None,
            tags: vec![],
            proof: NamespaceProof::None,
            source_url: String::new(),
            last_updated: None,
            source_tier: None,
        }
    }

    fn build(self, fetched_at: &str) -> StoreItem {
        StoreItem {
            id: format!("{}:{}", self.source, self.name),
            kind: self.kind,
            title: self.title,
            publisher: self.publisher.clone(),
            summary: self.summary,
            license: self.license.unwrap_or_else(|| NOT_STATED.to_owned()),
            homepage: self.homepage.clone(),
            version: self.version,
            pinned: self.pinned.clone(),
            components: self.components,
            hosts: self.hosts,
            secrets: self.secrets,
            tier: self.tier,
            source: self.source.to_owned(),
            verified: self.verified,
            removed: self.removed,
            tags: (!self.tags.is_empty()).then_some(self.tags),
            provenance: Provenance {
                source: self.source.to_owned(),
                publisher: self.publisher,
                namespace_proof: self.proof,
                pinned: self.pinned,
                tree_sha256: None,
                scan: not_scanned(),
                source_url: if self.source_url.is_empty() {
                    self.homepage.unwrap_or_default()
                } else {
                    self.source_url
                },
                fetched_at: fetched_at.to_owned(),
                last_updated: self.last_updated,
                source_tier: self.source_tier,
            },
        }
    }
}

// ---------------------------------------------------------------- boopis's own list

/// The pin of an entry of boopis's own list: the package a way of running it pins (`npx` an npm version, `uvx` a `PyPI` version,
/// `docker` an image digest), else, for a connector only its publisher hosts, its address (`remote:<url>`, the owner's decision
/// of 21 November 2026: hosted connectors are allowed with a standing caution) at the version boopis checked.
fn curated_pin(c: &crate::connectors::catalog::Connector) -> Option<Pin> {
    if let Some(v) = c.variants.iter().find(|v| c.pinned(v).is_some()) {
        let (p, ver) = (c.verified.package.clone()?, c.verified.version.clone()?);
        let (kind, registry) = match v
            .command
            .as_deref()
            .map(|cmd| cmd.rsplit(['/', '\\']).next().unwrap_or(cmd))
        {
            Some("uvx" | "uv") => (PinKind::Version, "pypi"),
            Some("docker" | "podman") if ver.starts_with("sha256:") => (PinKind::OciDigest, "oci"),
            _ => (PinKind::Version, "npm"),
        };
        return Some(Pin {
            kind,
            value: ver,
            repo: Some(format!("{registry}:{p}")),
        });
    }
    let hosted = c
        .variants
        .iter()
        .find(|v| v.default && v.url.is_some())
        .or_else(|| c.variants.iter().find(|v| v.url.is_some()))?;
    Some(Pin {
        kind: PinKind::Version,
        value: c
            .verified
            .version
            .clone()
            .unwrap_or_else(|| format!("checked {}", c.verified.date)),
        repo: Some(format!("remote:{}", hosted.url.as_deref()?)),
    })
}

/// The curated connectors (`apps/shared/data/connectors.json`) as items, in the file's order (most popular first). Only boopis's
/// list yields `recommended`, and only for an entry a person checked: its `verified.date` is that check. The pin is the verified
/// package at its exact version, or a hosted connector's address ([`curated_pin`]).
#[must_use]
pub fn boopis_connectors(
    catalog: &crate::connectors::catalog::Catalog,
    fetched_at: &str,
) -> Vec<Entry> {
    catalog
        .connectors
        .iter()
        .map(|c| {
            let mut d = Draft::new("boopis", &c.id, ItemKind::Connector);
            d.title.clone_from(&c.name);
            d.publisher.clone_from(&c.publisher);
            d.summary.clone_from(&c.description);
            d.license = Some(c.license.clone());
            d.homepage = Some(c.source.clone());
            d.version.clone_from(&c.verified.version);
            d.pinned = curated_pin(c);
            let mut hosts: Vec<String> = Vec::new();
            let mut any = false;
            let mut loopback_only = true;
            for v in &c.variants {
                match &v.network.egress {
                    crate::connectors::catalog::Egress::Hosts(h) => {
                        hosts.extend(h.iter().cloned());
                        loopback_only = false;
                    }
                    crate::connectors::catalog::Egress::Word(w) if w == "any" => any = true,
                    crate::connectors::catalog::Egress::Word(w) if w == "loopback" => {}
                    crate::connectors::catalog::Egress::Word(_) => {}
                }
            }
            hosts.sort();
            hosts.dedup();
            d.hosts = if any {
                HostList {
                    basis: HostBasis::Unknown,
                    hosts: vec![],
                }
            } else if hosts.is_empty() && loopback_only {
                HostList {
                    basis: HostBasis::Loopback,
                    hosts: vec![],
                }
            } else {
                HostList {
                    basis: HostBasis::Verified,
                    hosts,
                }
            };
            d.components = ComponentCounts {
                known: true,
                mcp_servers: 1,
                ..no_components()
            };
            d.secrets = c
                .variants
                .iter()
                .flat_map(|v| &v.credentials)
                .fold(BTreeMap::new(), |mut m: BTreeMap<String, SecretNeed>, k| {
                    m.entry(k.id.clone()).or_insert_with(|| SecretNeed {
                        id: k.id.clone(),
                        title: k.title.clone(),
                        env: k.env.clone(),
                        host: k.host.clone(),
                        optional: k.optional,
                    });
                    m
                })
                .into_values()
                .collect();
            d.tier = Tier::Recommended;
            d.verified = Some(c.verified.date.clone());
            d.tags.clone_from(&c.categories);
            d.proof = NamespaceProof::Curated;
            d.source_url.clone_from(&c.source);
            d.last_updated = Some(c.verified.date.clone());
            d.source_tier = Some(curated_words(match (&c.popularity, &catalog.popularity) {
                (Some(p), Some(read)) => p.stars.map(|n| {
                    format!(
                        "{} GitHub stars on {}, read {}",
                        group_thousands(n),
                        p.repo,
                        date_words(&read.read)
                    )
                }),
                _ => None,
            }));
            let item = d.build(fetched_at);
            Entry {
                raw: serde_json::json!({"connector": c.id}),
                item,
            }
        })
        .collect()
}

/// `1234567` as `1,234,567`.
fn group_thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `2026-11-22` as `22 November 2026`; a date that does not parse stays as written.
fn date_words(d: &str) -> String {
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let parts: Vec<&str> = d.split('-').collect();
    match parts.as_slice() {
        [y, m, day] => match (m.parse::<usize>(), day.parse::<u32>()) {
            (Ok(m @ 1..=12), Ok(day)) => format!("{day} {} {y}", MONTHS[m - 1]),
            _ => d.to_owned(),
        },
        _ => d.to_owned(),
    }
}

/// What the item's page says about why boopis's own list holds it and why it sits where it does: the signal that orders it, as
/// the count it showed on the date it was read. Said after "which calls it", so it begins with what boopis does.
fn curated_words(signal: Option<String>) -> String {
    signal.map_or_else(
        || "curated by boopis".to_owned(),
        |s| format!("checked by boopis and placed by its popularity: {s}"),
    )
}

/// boopis's own skills and plugins (`apps/shared/data/recommended.json`) as items, each kind in the file's order (most used first).
/// They are `recommended` for the same reason the connectors are: a person read each against its publisher's own repository at
/// the commit it pins, and the pin is that commit. The `raw` record has the shape a marketplace entry's has, so the ordinary
/// install fetches, stages, hashes and plans it.
#[must_use]
pub fn boopis_skills_and_plugins(
    list: &super::recommended::Recommended,
    fetched_at: &str,
) -> (Vec<Entry>, Vec<Entry>) {
    let build = |kind: ItemKind, e: &super::recommended::Entry, read: &super::recommended::Read| {
        let (dir, tree) = match kind {
            ItemKind::Skill => ("skills", true),
            _ => ("plugins", false),
        };
        let mut d = Draft::new("boopis", &format!("{dir}/{}", e.id), kind);
        d.title.clone_from(&e.name);
        d.publisher.clone_from(&e.publisher);
        d.summary.clone_from(&e.description);
        d.license = Some(e.license.clone());
        d.version.clone_from(&e.version);
        d.homepage = Some(match &e.subdir {
            Some(sub) => format!("{}/tree/{}/{sub}", e.repo, e.commit),
            None => format!("{}/tree/{}", e.repo, e.commit),
        });
        d.pinned = Some(Pin {
            kind: PinKind::Commit,
            value: e.commit.clone(),
            repo: Some(e.repo.clone()),
        });
        d.components = if tree {
            ComponentCounts {
                known: true,
                skills: 1,
                ..no_components()
            }
        } else {
            no_components()
        };
        d.tier = Tier::Recommended;
        d.verified = Some(e.verified.date.clone());
        d.tags.clone_from(&e.categories);
        d.proof = NamespaceProof::Github;
        d.source_url = d.homepage.clone().unwrap_or_default();
        d.last_updated = Some(e.verified.date.clone());
        let counted = if read.signal == "skills-sh-installs" {
            format!("{} installs on skills.sh", e.popularity.shown)
        } else {
            format!(
                "{} installs in Anthropic's plugin directory",
                e.popularity.shown
            )
        };
        d.source_tier = Some(curated_words(Some(format!(
            "{counted}, read {}",
            date_words(&read.read)
        ))));
        let raw = if tree {
            serde_json::json!({
                "kind": "skill", "repo": e.repo, "subdir": e.subdir, "sha": e.commit, "marketplace": "boopis"
            })
        } else {
            let source = match &e.subdir {
                Some(sub) => {
                    serde_json::json!({"source": "git-subdir", "url": e.repo, "path": sub, "sha": e.commit})
                }
                None => serde_json::json!({"source": "url", "url": e.repo, "sha": e.commit}),
            };
            serde_json::json!({
                "kind": "plugin",
                "entry": {"name": e.id, "source": source},
                "marketplace": "boopis", "base_commit": e.commit, "base_repo": e.repo
            })
        };
        Entry {
            item: d.build(fetched_at),
            raw,
        }
    };
    (
        list.skills
            .iter()
            .map(|e| build(ItemKind::Skill, e, &list.popularity.skills))
            .collect(),
        list.plugins
            .iter()
            .map(|e| build(ItemKind::Plugin, e, &list.popularity.plugins))
            .collect(),
    )
}

/// The kinds of boopis's own list woven into one order: each kind keeps its own (most used first), and the kinds take turns, so
/// the front page and Browse show the most used of every kind before the second most used of any. The signals have no common
/// scale (stars, skills.sh installs, directory installs), so no single ranking across them would be honest.
#[must_use]
pub fn weave(kinds: Vec<Vec<Entry>>) -> Vec<Entry> {
    let longest = kinds.iter().map(Vec::len).max().unwrap_or(0);
    let mut iters: Vec<std::vec::IntoIter<Entry>> =
        kinds.into_iter().map(IntoIterator::into_iter).collect();
    let mut out = Vec::new();
    for _ in 0..longest {
        for it in &mut iters {
            if let Some(e) = it.next() {
                out.push(e);
            }
        }
    }
    out
}

// ---------------------------------------------------------------- what the user pointed at

/// An item read from a folder or a repository the user pointed at (a GitHub address, a local folder or file). The user vouches for
/// nothing: it is `not-reviewed`, its namespace proof is `none` unless GitHub names the owner, and its pin is what the host
/// resolved (a commit) or computed (a tree or file hash).
pub struct Found {
    /// The user-added source's id (`added-…`).
    pub source: String,
    /// The kind.
    pub kind: ItemKind,
    /// The id's name part.
    pub name: String,
    /// The title.
    pub title: String,
    /// Who published it, as far as the files say.
    pub publisher: String,
    /// What it is.
    pub summary: String,
    /// Its licence, as its files state it.
    pub license: Option<String>,
    /// Its page.
    pub homepage: Option<String>,
    /// Its version.
    pub version: Option<String>,
    /// Its pin.
    pub pinned: Option<Pin>,
    /// What it holds.
    pub components: ComponentCounts,
    /// The proof the name belongs to its publisher.
    pub proof: NamespaceProof,
    /// Where it was read from.
    pub source_url: String,
    /// What the host keeps for the install.
    pub raw: Value,
}

/// An [`Entry`] for something the user pointed at.
#[must_use]
pub fn found(f: Found, fetched_at: &str) -> Entry {
    let mut d = Draft::new(&f.source, &f.name, f.kind);
    d.title = f.title;
    d.publisher = f.publisher;
    d.summary = cap(&f.summary, 400);
    d.license = f.license;
    d.homepage = f.homepage;
    d.version = f.version;
    d.pinned = f.pinned;
    d.components = f.components;
    d.proof = f.proof;
    d.source_url = f.source_url;
    d.source_tier = Some("added by you".into());
    Entry {
        item: d.build(fetched_at),
        raw: f.raw,
    }
}

// ---------------------------------------------------------------- the MCP Registry

fn namespace(name: &str) -> (String, NamespaceProof) {
    let ns = name.split('/').next().unwrap_or(name);
    if let Some(user) = ns.strip_prefix("io.github.") {
        return (format!("github.com/{user}"), NamespaceProof::Github);
    }
    let mut parts: Vec<&str> = ns.split('.').collect();
    parts.reverse();
    (parts.join("."), NamespaceProof::Registry)
}

/// What a page of `/v0.1/servers` held.
#[derive(Debug, Default)]
pub struct RegistryPage {
    /// The servers to list (only the latest version of each).
    pub entries: Vec<Entry>,
    /// Names the registry marks `deleted`: spam, malware or illegal. The caller drops them.
    pub deleted: Vec<String>,
    /// The cursor of the next page, when there is one.
    pub next: Option<String>,
}

/// One page of the MCP Registry's `/v0.1/servers`. Only a latest version is kept (a page may hold every version); `deleted`
/// is returned for the caller to drop, `deprecated` is kept with a tag and a note in the summary (the registry flags it, boopis
/// shows that); everything else is `not-reviewed`, with its namespace proof as the registry names it.
#[must_use]
pub fn registry_page(page: &Value, fetched_at: &str) -> RegistryPage {
    let mut out = RegistryPage {
        next: page
            .pointer("/metadata/nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned),
        ..RegistryPage::default()
    };
    for row in page
        .get("servers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(server) = row.get("server") else {
            continue;
        };
        let Some(name) = s(server, "name") else {
            continue;
        };
        let meta = row
            .pointer("/_meta/io.modelcontextprotocol.registry~1official")
            .or_else(|| {
                row.get("_meta")
                    .and_then(|m| m.get("io.modelcontextprotocol.registry/official"))
            });
        let status = meta
            .and_then(|m| s(m, "status"))
            .unwrap_or_else(|| "active".into());
        if status == "deleted" {
            out.deleted.push(name);
            continue;
        }
        if meta
            .and_then(|m| m.get("isLatest"))
            .and_then(Value::as_bool)
            == Some(false)
        {
            continue;
        }
        let mut d = Draft::new("mcp-registry", &name, ItemKind::Connector);
        d.title = s(server, "title").unwrap_or_else(|| name.clone());
        let (publisher, proof) = namespace(&name);
        d.publisher = publisher;
        d.proof = proof;
        d.summary = cap(&s(server, "description").unwrap_or_default(), 400);
        d.version = s(server, "version");
        d.homepage = s(server, "websiteUrl").or_else(|| {
            server
                .pointer("/repository/url")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        d.source_url = format!(
            "https://registry.modelcontextprotocol.io/v0.1/servers/{}/versions/latest",
            name.replace('/', "%2F")
        );
        d.last_updated = meta
            .and_then(|m| s(m, "updatedAt"))
            .map(|t| t.chars().take(10).collect());
        d.source_tier = Some(match proof {
            NamespaceProof::Github => {
                "the registry proved this name belongs to its GitHub account".to_owned()
            }
            _ => "the registry proved this name belongs to its publisher".to_owned(),
        });
        d.components = ComponentCounts {
            known: true,
            mcp_servers: 1,
            ..no_components()
        };
        if status == "deprecated" {
            d.tags.push("deprecated".into());
            d.summary = format!("Deprecated in the registry. {}", d.summary);
        }
        match servers::pick(server) {
            Ok(c) => {
                d.pinned = c.pin;
                d.hosts = c.hosts;
                d.secrets = c.secrets;
            }
            Err(why) => {
                let note = format!("{} (Not installable here: {why}.)", d.summary);
                note.trim().clone_into(&mut d.summary);
            }
        }
        let item = d.build(fetched_at);
        out.entries.push(Entry {
            item,
            raw: server.clone(),
        });
    }
    out
}

// ---------------------------------------------------------------- the engine's catalogue

/// The engine's plugin catalogue (its published `plugin-catalog.json`): `{generated_at, entries: [...], removed: [...]}`.
/// Every entry is an engine plugin, pinned at its mandatory commit. Its `official` and `verified` tiers are the engine's own
/// mark and show as `verified` with the source's word; `community` (and no tier) is `not-reviewed`. The disclosure the
/// catalogue's description carries stays in the summary. The kill list comes from `removed`.
#[must_use]
pub fn engine_catalogue(doc: &Value, fetched_at: &str) -> Vec<Entry> {
    let removed: BTreeMap<String, &Value> = doc
        .get("removed")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| Some((s(r, "name")?, r)))
        .collect();
    let mut out = Vec::new();
    for e in doc
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = s(e, "name") else { continue };
        let mut d = Draft::new("engine-plugins", &name, ItemKind::EnginePlugin);
        d.title = s(e, "title").unwrap_or_else(|| name.clone());
        d.publisher = s(e, "maintainer").unwrap_or_else(|| "unknown".into());
        d.summary = cap(&s(e, "description").unwrap_or_default(), 700);
        d.version = s(e, "version");
        d.homepage = s(e, "docs_url").or_else(|| s(e, "repo"));
        d.source_url = s(e, "repo").unwrap_or_default();
        d.pinned = s(e, "repo")
            .zip(s(e, "sha").filter(|h| is_sha1(h)))
            .map(|(repo, sha)| Pin {
                kind: PinKind::Commit,
                value: sha.to_ascii_lowercase(),
                repo: Some(repo),
            });
        let tier = s(e, "tier").unwrap_or_else(|| "community".into());
        d.tier = if matches!(tier.as_str(), "official" | "verified") {
            Tier::Verified
        } else {
            Tier::NotReviewed
        };
        d.source_tier = Some(format!("the engine's store lists it as {tier}"));
        d.proof = if d.tier == Tier::Verified {
            NamespaceProof::Curated
        } else {
            NamespaceProof::None
        };
        d.tags = s(e, "category").into_iter().collect();
        let caps = e.get("capabilities");
        let count = |k: &str| {
            caps.and_then(|c| c.get(k))
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        };
        let portable = d.summary.contains("Agent Plugins v1")
            && count("provides_tools") + count("provides_hooks") + count("provides_middleware")
                == 0;
        d.components = ComponentCounts {
            known: false,
            hooks: u32::try_from(count("provides_hooks")).unwrap_or(u32::MAX),
            python: u32::from(!portable),
            ..no_components()
        };
        d.secrets = caps
            .and_then(|c| c.get("requires_env"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|env| SecretNeed {
                id: env.to_ascii_lowercase(),
                title: env.to_owned(),
                env: Some(env.to_owned()),
                host: None,
                optional: false,
            })
            .collect();
        if let Some(r) = removed.get(&name) {
            d.removed = Some(Removed {
                reason: s(r, "reason").unwrap_or_else(|| "taken down by the engine's store".into()),
                by: RemovedBy::Engine,
                date: s(r, "date"),
            });
        }
        out.push(Entry {
            item: d.build(fetched_at),
            raw: e.clone(),
        });
    }
    out
}

// ---------------------------------------------------------------- the engine's skills hub

/// Rows of the engine's `skills.manage browse`: `{name, description, source, trust, identifier}`. The hub gives no commit for a
/// skill before it installs it, so none of these is pinned: they are listed, marked, and the stage refuses them with
/// `hx.store.unpinned` (`docs/STORE.md` 8). The hub's `trusted` and `builtin` levels are the engine's own mark.
#[must_use]
pub fn skills_hub(rows: &[Value], fetched_at: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    for r in rows {
        let Some(name) = s(r, "name") else { continue };
        let identifier = s(r, "identifier").unwrap_or_else(|| name.clone());
        let mut d = Draft::new("skills-hub", &identifier, ItemKind::Skill);
        d.title = name;
        d.summary = cap(&s(r, "description").unwrap_or_default(), 400);
        let trust = s(r, "trust").unwrap_or_else(|| "community".into());
        d.tier = if matches!(trust.as_str(), "trusted" | "builtin") {
            Tier::Verified
        } else {
            Tier::NotReviewed
        };
        d.source_tier = Some(format!("the engine's hub lists it as {trust}"));
        let mut parts = identifier.splitn(3, '/');
        if let (Some(owner), Some(repo)) = (parts.next(), parts.next()) {
            owner.clone_into(&mut d.publisher);
            if s(r, "source").as_deref() == Some("github")
                || s(r, "source").as_deref() == Some("official")
            {
                d.homepage = Some(format!("https://github.com/{owner}/{repo}"));
            }
        } else {
            d.publisher = s(r, "source").unwrap_or_else(|| "unknown".into());
        }
        d.components = ComponentCounts {
            known: true,
            skills: 1,
            ..no_components()
        };
        out.push(Entry {
            item: d.build(fetched_at),
            raw: r.clone(),
        });
    }
    out
}

// ---------------------------------------------------------------- Claude Code marketplaces

/// Where a marketplace's own files live, so a relative `source` can be pinned.
#[derive(Debug, Clone, Default)]
pub struct MarketBase {
    /// `https://github.com/owner/repo` when the marketplace is a GitHub repository.
    pub repo: Option<String>,
    /// The commit of that repository the marketplace was read at.
    pub commit: Option<String>,
    /// The licence of the marketplace repository's root `LICENSE`, read by whoever checked it. Applied only to Anthropic's own
    /// plugins under `plugins/`, never to third-party entries that happen to sit in the same repository.
    pub root_license: Option<String>,
}

/// Anthropic's own: a path under `plugins/` of its marketplace repository, or a repository of the `anthropics` account.
/// Everything else in its marketplace (`external_plugins/`, a git or url source elsewhere, a command) is third-party, and the
/// README of `claude-plugins-official` says Anthropic cannot verify it.
fn anthropic_own(source: Option<&PluginSource>, entry: &Value) -> bool {
    match source {
        Some(PluginSource::Git { repo, subdir, .. }) => {
            let rel = entry.get("source").and_then(Value::as_str).is_some();
            if rel {
                subdir.as_deref().is_some_and(|p| p.starts_with("plugins/"))
                    || subdir.is_none() && repo.starts_with("https://github.com/anthropics/")
            } else {
                repo.starts_with("https://github.com/anthropics/")
            }
        }
        _ => false,
    }
}

/// How a marketplace entry's `source` reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginSource {
    /// A GitHub repository (and a path inside it), at a commit when the entry names one.
    Git {
        /// `https://github.com/owner/repo`, or another git address.
        repo: String,
        /// A folder inside it.
        subdir: Option<String>,
        /// The commit.
        sha: Option<String>,
    },
    /// An https archive and its digest.
    Archive {
        /// The address.
        url: String,
        /// SHA-256, when given.
        sha256: Option<String>,
    },
    /// An npm package at a version.
    Npm {
        /// The package.
        package: String,
        /// Its version.
        version: Option<String>,
    },
    /// A command that would run on the user's machine: never installed.
    Command,
}

fn github_url(repo: &str) -> String {
    if repo.starts_with("http") {
        repo.trim_end_matches(".git").to_owned()
    } else {
        format!("https://github.com/{}", repo.trim_end_matches(".git"))
    }
}

/// Read a marketplace entry's `source` (a relative path, or an object with a `source` word).
#[must_use]
pub fn plugin_source(entry: &Value, base: &MarketBase) -> Option<PluginSource> {
    let src = entry.get("source")?;
    if let Some(path) = src.as_str() {
        let sub = path.trim_start_matches("./").trim_matches('/');
        return Some(PluginSource::Git {
            repo: base.repo.clone()?,
            subdir: (!sub.is_empty() && sub != ".").then(|| sub.to_owned()),
            sha: base.commit.clone(),
        });
    }
    let kind = s(src, "source")?;
    let sha = s(src, "sha")
        .filter(|h| is_sha1(h))
        .map(|h| h.to_ascii_lowercase());
    match kind.as_str() {
        "github" => Some(PluginSource::Git {
            repo: github_url(&s(src, "repo")?),
            subdir: None,
            sha,
        }),
        "url" => Some(PluginSource::Git {
            repo: github_url(&s(src, "url")?),
            subdir: None,
            sha,
        }),
        "git-subdir" => Some(PluginSource::Git {
            repo: github_url(&s(src, "url")?),
            subdir: s(src, "path"),
            sha,
        }),
        "npm" => Some(PluginSource::Npm {
            package: s(src, "package")?,
            version: s(src, "version"),
        }),
        "archive" => Some(PluginSource::Archive {
            url: s(src, "url")?,
            sha256: s(src, "sha256"),
        }),
        "command" => Some(PluginSource::Command),
        _ => None,
    }
}

fn count_of(v: Option<&Value>) -> u32 {
    match v {
        Some(Value::Array(a)) => u32::try_from(a.len()).unwrap_or(u32::MAX),
        Some(Value::Object(o)) => u32::try_from(o.len()).unwrap_or(u32::MAX),
        Some(Value::String(_)) => 1,
        _ => 0,
    }
}

/// A Claude Code `marketplace.json`. `source_id` is the store source (`anthropic`, `marketplace-url`, `github`); `tier` what that
/// source's own review supports; `base` where relative sources live.
///
/// - A plugin with a relative source and a `skills` list is a set of skills in one repository: each skill is listed as a skill,
///   pinned at the marketplace's commit (the folder `skills/pdf` is the skill `pdf`).
/// - Every other entry is a plugin. Its pin is the commit its `source` names, an archive's `sha256`, or an npm package's exact
///   version; a relative source is pinned at the marketplace's commit when that is known. `command` sources and unpinned ones
///   are listed with no pin.
#[must_use]
pub fn marketplace(
    source_id: &str,
    tier: Tier,
    source_tier: &str,
    doc: &Value,
    base: &MarketBase,
    fetched_at: &str,
) -> Vec<Entry> {
    let owner = doc
        .pointer("/owner/name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();
    let market = s(doc, "name").unwrap_or_default();
    let mut out: Vec<Entry> = Vec::new();
    let mut seen_skills = std::collections::BTreeSet::new();
    for e in doc
        .get("plugins")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = s(e, "name") else { continue };
        let source = plugin_source(e, base);
        let publisher = e
            .pointer("/author/name")
            .and_then(Value::as_str)
            .map_or_else(|| owner.clone(), str::to_owned);
        let license = s(e, "license");
        let skills_list: Vec<String> = e
            .get("skills")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        if let (
            Some(PluginSource::Git {
                repo,
                subdir: None,
                sha,
            }),
            false,
        ) = (&source, skills_list.is_empty())
        {
            let repo_path = repo.trim_start_matches("https://github.com/");
            for path in &skills_list {
                let sub = path.trim_start_matches("./").trim_matches('/').to_owned();
                if sub.is_empty() || !seen_skills.insert(sub.clone()) {
                    continue;
                }
                let leaf = sub.rsplit('/').next().unwrap_or(&sub).to_owned();
                let mut d = Draft::new(source_id, &format!("{repo_path}/{sub}"), ItemKind::Skill);
                d.title = leaf;
                d.publisher.clone_from(&publisher);
                d.summary = format!(
                    "A skill from {repo_path}. Its SKILL.md is read when you open it to install."
                );
                d.license.clone_from(&license);
                d.homepage = Some(format!(
                    "{repo}/tree/{}/{sub}",
                    sha.as_deref().unwrap_or("HEAD")
                ));
                d.source_url = d.homepage.clone().unwrap_or_default();
                d.pinned = sha.as_ref().map(|c| Pin {
                    kind: PinKind::Commit,
                    value: c.clone(),
                    repo: Some(repo.clone()),
                });
                d.components = ComponentCounts {
                    known: true,
                    skills: 1,
                    ..no_components()
                };
                let own = source_id != "anthropic" || anthropic_own(source.as_ref(), e);
                d.tier = if own { tier } else { Tier::NotReviewed };
                d.proof = NamespaceProof::Github;
                d.source_tier = Some(source_tier.to_owned());
                let raw = serde_json::json!({"kind": "skill", "repo": repo, "subdir": sub, "sha": sha, "marketplace": market});
                out.push(Entry {
                    item: d.build(fetched_at),
                    raw,
                });
            }
            continue;
        }
        let mut d = Draft::new(source_id, &name, ItemKind::Plugin);
        d.title.clone_from(&name);
        d.publisher = publisher;
        d.summary = cap(&s(e, "description").unwrap_or_default(), 400);
        d.version = s(e, "version");
        d.license = license;
        d.homepage = s(e, "homepage").or_else(|| match &source {
            Some(PluginSource::Git { repo, .. }) => Some(repo.clone()),
            _ => None,
        });
        d.tags = e
            .get("tags")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if let Some(c) = s(e, "category") {
            d.tags.push(c);
        }
        d.pinned = match &source {
            Some(PluginSource::Git {
                repo,
                sha: Some(sha),
                ..
            }) => Some(Pin {
                kind: PinKind::Commit,
                value: sha.clone(),
                repo: Some(repo.clone()),
            }),
            Some(PluginSource::Archive {
                url,
                sha256: Some(h),
            }) if url.starts_with("https://") && h.len() == 64 => Some(Pin {
                kind: PinKind::ArchiveSha256,
                value: h.to_ascii_lowercase(),
                repo: Some(url.clone()),
            }),
            Some(PluginSource::Npm {
                package,
                version: Some(v),
            }) if !v.contains(['^', '~', '*', '>', '<', ' ']) && v != "latest" => Some(Pin {
                kind: PinKind::Version,
                value: v.clone(),
                repo: Some(format!("npm:{package}")),
            }),
            _ => None,
        };
        let any = ["skills", "commands", "agents", "hooks", "mcpServers"]
            .iter()
            .any(|k| e.get(*k).is_some());
        d.components = ComponentCounts {
            known: any,
            skills: count_of(e.get("skills")),
            commands: count_of(e.get("commands")),
            agents: count_of(e.get("agents")),
            hooks: u32::from(e.get("hooks").is_some()),
            mcp_servers: count_of(e.get("mcpServers")),
            ..no_components()
        };
        let own = source_id != "anthropic" || anthropic_own(source.as_ref(), e);
        d.tier = if own { tier } else { Tier::NotReviewed };
        if source_id == "anthropic"
            && own
            && d.license.is_none()
            && matches!(&source, Some(PluginSource::Git { subdir: Some(p), .. }) if p.starts_with("plugins/"))
        {
            d.license.clone_from(&base.root_license);
        }
        d.proof = if matches!(&source, Some(PluginSource::Git { repo, .. }) if repo.starts_with("https://github.com/"))
        {
            NamespaceProof::Github
        } else {
            NamespaceProof::None
        };
        d.source_tier = Some(if own {
            source_tier.to_owned()
        } else {
            format!(
                "listed in {market}, which says its publisher cannot verify what a third-party plugin does"
            )
        });
        d.source_url = base.repo.clone().unwrap_or_default();
        out.push(Entry { item: d.build(fetched_at), raw: serde_json::json!({"kind": "plugin", "entry": e, "marketplace": market, "base_commit": base.commit, "base_repo": base.repo}) });
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    const NOW: &str = "2026-11-21T09:30:00Z";

    /// Saved from the `MCP Registry`'s `/v0.1/servers?limit=100&version=latest` on 2026-11-21, the pages
    /// narrowed to seven real entries: one of each shape the registry has (an npm package with a secret, a remote with a
    /// header key, a plain remote, a `PyPI` package, an npm package that also lists a bundle, an image with a tag and no digest,
    /// and an entry the registry marks deprecated).
    const REGISTRY: &str = include_str!("fixtures/mcp-registry.servers.json");
    /// The two marketplaces, saved from `raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json`
    /// (317 plugins on 2026-11-21, narrowed to one of each source shape: git-subdir, url, relative, command) and
    /// `.../anthropics/skills/main/.claude-plugin/marketplace.json` (whole).
    const OFFICIAL: &str = include_str!("fixtures/claude-plugins-official.marketplace.json");
    const SKILLS: &str = include_str!("fixtures/anthropic-skills.marketplace.json");
    /// Saved from the engine's published `plugin-catalog.json` (2,514 entries on 2026-11-21, narrowed to five of different tiers
    /// and shapes, and the first two rows of its `removed` list).
    const ENGINE: &str = include_str!("fixtures/engine-plugin-catalog.json");

    fn by_id<'a>(items: &'a [Entry], id: &str) -> &'a StoreItem {
        &items
            .iter()
            .find(|e| e.item.id == id)
            .unwrap_or_else(|| {
                panic!(
                    "{id} in {:?}",
                    items.iter().map(|e| &e.item.id).collect::<Vec<_>>()
                )
            })
            .item
    }

    #[test]
    fn registry_rows_become_connectors_with_their_pins_hosts_and_keys() {
        let page = registry_page(&serde_json::from_str(REGISTRY).unwrap(), NOW);
        assert_eq!(page.entries.len(), 7);
        assert!(page.deleted.is_empty());
        let e = &page.entries;
        let npm = by_id(e, "mcp-registry:ai.2kw/mcp-server");
        assert_eq!(
            (npm.kind, npm.tier, npm.title.as_str()),
            (ItemKind::Connector, Tier::NotReviewed, "2kw.ai")
        );
        assert_eq!(
            npm.pinned.as_ref().unwrap().repo.as_deref(),
            Some("npm:@2kw/ai-mcp-server")
        );
        assert_eq!(npm.version.as_deref(), Some("8.0.3"));
        assert_eq!(npm.secrets[0].env.as_deref(), Some("AI_2KW_API_KEY"));
        assert_eq!(
            npm.hosts.basis,
            HostBasis::Unknown,
            "a local package's reach is not known"
        );
        assert_eq!(
            (npm.publisher.as_str(), npm.provenance.namespace_proof),
            ("2kw.ai", NamespaceProof::Registry)
        );
        assert_eq!(npm.license, NOT_STATED);
        assert_eq!(npm.provenance.scan.verdict, ScanVerdict::NotScanned);
        let hdr = by_id(e, "mcp-registry:academy.apexai/apex-ai-academy");
        assert_eq!(
            hdr.hosts,
            HostList {
                basis: HostBasis::Declared,
                hosts: vec!["apexai.academy".into()]
            }
        );
        assert_eq!(hdr.secrets[0].host.as_deref(), Some("apexai.academy"));
        assert!(
            hdr.secrets[0].optional,
            "its description says the key is optional and isRequired is absent"
        );
        assert_eq!(
            hdr.pinned.as_ref().unwrap().repo.as_deref(),
            Some("remote:https://apexai.academy/mcp")
        );
        let py = by_id(e, "mcp-registry:ai.arsentev/contextburn");
        assert_eq!(
            py.pinned.as_ref().unwrap().repo.as_deref(),
            Some("pypi:contextburn")
        );
        let both = by_id(e, "mcp-registry:ai.autonomous.harness/harness");
        assert_eq!(
            both.pinned.as_ref().unwrap().repo.as_deref(),
            Some("npm:@autonomous-ai/harness-mcp"),
            "the npm package, pinned, before the bundle"
        );
        let image = by_id(e, "mcp-registry:ai.aliengiraffe/spotdb");
        assert!(image.pinned.is_none(), "an image tag is not a digest");
        let dep = by_id(e, "mcp-registry:ai.agentgates/mcp");
        assert_eq!(dep.tags.as_deref(), Some(&["deprecated".to_owned()][..]));
        assert!(dep.summary.starts_with("Deprecated in the registry."));
        assert!(
            dep.removed.is_none(),
            "deprecated is flagged, not a takedown"
        );
    }

    #[test]
    fn registry_deleted_and_older_versions_are_dropped_and_the_cursor_is_kept() {
        let mut doc: Value = serde_json::from_str(REGISTRY).unwrap();
        let rows = doc["servers"].as_array_mut().unwrap();
        rows[0]["_meta"]["io.modelcontextprotocol.registry/official"]["status"] = json!("deleted");
        rows[1]["_meta"]["io.modelcontextprotocol.registry/official"]["isLatest"] = json!(false);
        doc["metadata"]["nextCursor"] = json!("next:1");
        let page = registry_page(&doc, NOW);
        assert_eq!(page.deleted, vec!["ai.2kw/mcp-server".to_owned()]);
        assert!(
            !page
                .entries
                .iter()
                .any(|e| e.item.id.ends_with("apex-ai-academy"))
        );
        assert_eq!(page.entries.len(), 5);
        assert_eq!(page.next.as_deref(), Some("next:1"));
    }

    #[test]
    fn an_anthropic_plugin_is_pinned_by_the_commit_its_source_names_or_the_marketplaces() {
        let base = MarketBase {
            repo: Some("https://github.com/anthropics/claude-plugins-official".into()),
            commit: Some("a".repeat(40)),
            root_license: Some("Apache-2.0".into()),
        };
        let items = marketplace(
            "anthropic",
            Tier::Verified,
            "Anthropic's marketplace",
            &serde_json::from_str(OFFICIAL).unwrap(),
            &base,
            NOW,
        );
        assert_eq!(items.len(), 6);
        let sub = by_id(&items, "anthropic:42crunch-api-security-testing");
        assert_eq!(
            (sub.kind, sub.tier, sub.publisher.as_str()),
            (ItemKind::Plugin, Tier::NotReviewed, "42Crunch"),
            "a third-party git-subdir source"
        );
        assert!(
            sub.provenance
                .source_tier
                .as_deref()
                .unwrap()
                .contains("cannot verify")
        );
        let pin = sub.pinned.as_ref().unwrap();
        assert_eq!(pin.kind, PinKind::Commit);
        assert_eq!(pin.value.len(), 40);
        assert!(
            pin.repo
                .as_deref()
                .unwrap()
                .starts_with("https://github.com/")
        );
        let rel = by_id(&items, "anthropic:asana");
        assert_eq!(
            rel.tier,
            Tier::NotReviewed,
            "external_plugins are third-party"
        );
        assert_eq!(
            rel.pinned.as_ref().unwrap().value,
            "a".repeat(40),
            "a relative source is pinned at the marketplace's commit"
        );
        let own = by_id(&items, "anthropic:agent-sdk-dev");
        assert_eq!(
            (own.tier, own.license.as_str()),
            (Tier::Verified, "Apache-2.0"),
            "plugins/ is Anthropic's own, under the repository's root licence"
        );
        assert_eq!(
            own.provenance.source_tier.as_deref(),
            Some("Anthropic's marketplace")
        );
        assert_eq!(
            by_id(&items, "anthropic:agentforce-adlc").tier,
            Tier::NotReviewed,
            "a url source outside anthropics"
        );
        assert_eq!(by_id(&items, "anthropic:xcode").tier, Tier::NotReviewed);
        assert_eq!(
            by_id(&items, "anthropic:github").license,
            NOT_STATED,
            "a third-party entry does not take the repository's licence"
        );
        let cmd = by_id(&items, "anthropic:xcode");
        assert!(
            cmd.pinned.is_none(),
            "a command source is never pinned, so never installed"
        );
    }

    #[test]
    fn a_relative_source_with_no_known_commit_is_listed_unpinned() {
        let base = MarketBase {
            repo: Some("https://github.com/anthropics/claude-plugins-official".into()),
            commit: None,
            root_license: None,
        };
        let items = marketplace(
            "anthropic",
            Tier::Verified,
            "x",
            &serde_json::from_str(OFFICIAL).unwrap(),
            &base,
            NOW,
        );
        assert!(by_id(&items, "anthropic:asana").pinned.is_none());
        assert!(
            by_id(&items, "anthropic:42crunch-api-security-testing")
                .pinned
                .is_some(),
            "its own sha still pins it"
        );
    }

    #[test]
    fn a_skills_marketplace_lists_each_skill_once_at_the_marketplaces_commit() {
        let base = MarketBase {
            repo: Some("https://github.com/anthropics/skills".into()),
            commit: Some("b".repeat(40)),
            root_license: None,
        };
        let items = marketplace(
            "anthropic",
            Tier::Verified,
            "Anthropic's skills",
            &serde_json::from_str(SKILLS).unwrap(),
            &base,
            NOW,
        );
        let skills: Vec<_> = items
            .iter()
            .filter(|e| e.item.kind == ItemKind::Skill)
            .collect();
        assert!(skills.len() >= 16, "{}", skills.len());
        let pdf = by_id(&items, "anthropic:anthropics/skills/skills/pdf");
        assert_eq!(pdf.title, "pdf");
        assert_eq!(pdf.pinned.as_ref().unwrap().value, "b".repeat(40));
        assert_eq!(
            pdf.tier,
            Tier::Verified,
            "anthropics/skills is Anthropic's own"
        );
        assert_eq!(
            pdf.license, NOT_STATED,
            "each skill carries its own LICENSE.txt, read when it is staged"
        );
        assert_eq!(
            items
                .iter()
                .filter(|e| e.item.id.ends_with("/skills/pdf"))
                .count(),
            1
        );
        let raw = &items
            .iter()
            .find(|e| e.item.id.ends_with("/skills/pdf"))
            .unwrap()
            .raw;
        assert_eq!(raw["subdir"], "skills/pdf");
    }

    #[test]
    fn engine_catalogue_entries_are_engine_plugins_pinned_at_their_commit_with_the_engines_tier() {
        let items = engine_catalogue(&serde_json::from_str(ENGINE).unwrap(), NOW);
        assert_eq!(items.len(), 5);
        let official = by_id(&items, "engine-plugins:accent-picker");
        assert_eq!(
            (official.kind, official.tier),
            (ItemKind::EnginePlugin, Tier::Verified)
        );
        assert!(
            official
                .provenance
                .source_tier
                .as_deref()
                .unwrap()
                .contains("official")
        );
        let verified = by_id(&items, "engine-plugins:adaption");
        assert_eq!(verified.tier, Tier::Verified);
        let community = by_id(&items, "engine-plugins:0bull");
        assert_eq!(community.tier, Tier::NotReviewed);
        assert_eq!(
            community.pinned.as_ref().unwrap().value,
            "240890a71715375bc877b238491e414517e9d902"
        );
        assert_eq!(
            community.pinned.as_ref().unwrap().repo.as_deref(),
            Some("https://github.com/0bull/agent-plugin")
        );
        assert_eq!(community.publisher, "0bull");
        assert_eq!(
            community.components.python, 0,
            "it says it is a portable package with no plugin code"
        );
        assert!(!community.components.known);
        assert!(
            community.summary.contains("Disclosure"),
            "the catalogue's disclosure stays in the summary"
        );
        assert_eq!(community.license, NOT_STATED);
        assert!(items.iter().all(|e| e.item.pinned.is_some()));
    }

    #[test]
    fn the_engines_kill_list_marks_items_removed_by_the_engine() {
        let mut doc: Value = serde_json::from_str(ENGINE).unwrap();
        let real_row = doc["removed"][0].clone();
        // The two saved `removed` rows name plugins that are no longer in the catalogue; to show the match, one entry takes a
        // removed name (the row itself is the real one).
        doc["entries"][0]["name"] = real_row["name"].clone();
        let items = engine_catalogue(&doc, NOW);
        let hit = items.iter().find(|e| e.item.removed.is_some()).unwrap();
        let removed = hit.item.removed.as_ref().unwrap();
        assert_eq!(removed.by, RemovedBy::Engine);
        assert_eq!(Some(removed.reason.as_str()), real_row["reason"].as_str());
        assert_eq!(items.iter().filter(|e| e.item.removed.is_some()).count(), 1);
    }

    #[test]
    fn hub_skills_are_listed_unpinned_with_the_hubs_trust_as_the_sources_mark() {
        // Rows are shaped by the engine's `SkillBrowseItem` contract (`tui_gateway/contracts/tools_mcp_plugins.py`); no real
        // engine was reachable, so these are written by hand to that shape.
        let rows = vec![
            json!({"name":"pdf","description":"Read PDFs","source":"github","trust":"trusted","identifier":"anthropics/skills/skills/pdf"}),
            json!({"name":"odd","description":"x","source":"clawhub","trust":"community","identifier":"odd-abc123"}),
        ];
        let items = skills_hub(&rows, NOW);
        let pdf = by_id(&items, "skills-hub:anthropics/skills/skills/pdf");
        assert_eq!(
            (pdf.tier, pdf.pinned.is_none(), pdf.publisher.as_str()),
            (Tier::Verified, true, "anthropics")
        );
        assert_eq!(
            pdf.homepage.as_deref(),
            Some("https://github.com/anthropics/skills")
        );
        let odd = by_id(&items, "skills-hub:odd-abc123");
        assert_eq!(
            (odd.tier, odd.publisher.as_str()),
            (Tier::NotReviewed, "clawhub")
        );
    }

    #[test]
    fn boopis_connectors_are_recommended_with_the_date_somebody_checked_them() {
        let items = boopis_connectors(crate::connectors::catalog::load().unwrap(), NOW);
        let fc = by_id(&items, "boopis:firecrawl");
        assert_eq!(
            (fc.tier, fc.verified.as_deref()),
            (Tier::Recommended, Some("2026-11-19"))
        );
        assert_eq!(
            fc.pinned.as_ref().unwrap().repo.as_deref(),
            Some("npm:firecrawl-mcp")
        );
        assert_eq!(fc.hosts.basis, HostBasis::Verified);
        assert!(fc.hosts.hosts.contains(&"mcp.firecrawl.dev".to_owned()));
        assert_eq!(fc.secrets.len(), 1);
        assert_eq!(fc.license, "MIT");
    }

    #[test]
    fn each_curated_connector_is_pinned_the_way_it_runs_in_the_lists_order() {
        let cat = crate::connectors::catalog::load().unwrap();
        let items = boopis_connectors(cat, NOW);
        let ids: Vec<String> = cat
            .connectors
            .iter()
            .map(|c| format!("boopis:{}", c.id))
            .collect();
        assert_eq!(
            items.iter().map(|e| e.item.id.clone()).collect::<Vec<_>>(),
            ids,
            "the list's order, most popular first"
        );
        let pin = |id: &str| {
            let p = by_id(&items, id).pinned.clone().unwrap();
            (p.kind, p.value, p.repo.unwrap())
        };
        // a Docker image by its digest
        let gh = pin("boopis:github");
        assert_eq!(
            (gh.0, gh.2.as_str()),
            (PinKind::OciDigest, "oci:ghcr.io/github/github-mcp-server")
        );
        assert!(gh.1.starts_with("sha256:") && gh.1.len() == 71, "{}", gh.1);
        // an npm package at its exact version
        assert_eq!(
            pin("boopis:playwright"),
            (
                PinKind::Version,
                "0.0.86".into(),
                "npm:@playwright/mcp".into()
            )
        );
        // a server only its publisher hosts, by its address at the version checked (the owner's decision of 21 November 2026)
        assert_eq!(
            pin("boopis:notion"),
            (
                PinKind::Version,
                "1.0.1".into(),
                "remote:https://mcp.notion.com/mcp".into()
            )
        );
        for e in &items {
            assert_eq!(e.item.tier, Tier::Recommended, "{}", e.item.id);
            assert!(e.item.pinned.is_some(), "{}: pinned or refused", e.item.id);
        }
    }

    #[test]
    fn boopis_skills_and_plugins_are_recommended_pinned_and_say_what_placed_them() {
        let list = crate::store::recommended::load().unwrap();
        let (skills, plugins) = boopis_skills_and_plugins(list, NOW);
        assert_eq!(skills.len(), list.skills.len());
        assert_eq!(plugins.len(), list.plugins.len());
        for e in skills.iter().chain(&plugins) {
            assert_eq!(e.item.tier, Tier::Recommended, "{}", e.item.id);
            let pin = e.item.pinned.as_ref().unwrap();
            assert_eq!(pin.kind, PinKind::Commit, "{}", e.item.id);
            assert_eq!(pin.value.len(), 40, "{}", e.item.id);
            assert!(e.item.verified.is_some(), "{}", e.item.id);
            let why = e.item.provenance.source_tier.as_deref().unwrap();
            assert!(why.contains("installs") && why.contains("2026"), "{why}");
        }
        let fd = by_id(&skills, "boopis:skills/frontend-design");
        assert_eq!(fd.kind, ItemKind::Skill);
        assert_eq!(fd.license, "Apache-2.0");
        assert!(
            fd.provenance
                .source_tier
                .as_deref()
                .unwrap()
                .contains("1.2M installs on skills.sh, read 22 November 2026")
        );
        let sp = by_id(&plugins, "boopis:plugins/superpowers");
        assert_eq!(sp.kind, ItemKind::Plugin);
        assert!(
            sp.provenance
                .source_tier
                .as_deref()
                .unwrap()
                .contains("1,009,371 installs in Anthropic's plugin directory")
        );
        // a skill and a plugin of the same name do not collide
        assert_ne!(by_id(&plugins, "boopis:plugins/frontend-design").id, fd.id);
    }

    #[test]
    fn a_recommended_entry_installs_through_the_ordinary_marketplace_path() {
        // The `raw` records have the shapes `install.rs` reads for a marketplace skill and a marketplace plugin.
        let list = crate::store::recommended::load().unwrap();
        let (skills, plugins) = boopis_skills_and_plugins(list, NOW);
        let sk = skills
            .iter()
            .find(|e| e.item.id == "boopis:skills/pdf")
            .unwrap();
        assert_eq!(sk.raw["kind"], "skill");
        assert_eq!(sk.raw["subdir"], "skills/pdf");
        assert_eq!(sk.raw["sha"], sk.item.pinned.as_ref().unwrap().value);
        let base = MarketBase {
            repo: sk.raw["repo"].as_str().map(str::to_owned),
            commit: None,
            root_license: None,
        };
        let inside = plugins
            .iter()
            .find(|e| e.item.id == "boopis:plugins/code-review")
            .unwrap();
        match plugin_source(&inside.raw["entry"], &base).unwrap() {
            PluginSource::Git { repo, subdir, sha } => {
                assert_eq!(
                    repo,
                    "https://github.com/anthropics/claude-plugins-official"
                );
                assert_eq!(subdir.as_deref(), Some("plugins/code-review"));
                assert_eq!(
                    sha.as_deref(),
                    Some(inside.item.pinned.as_ref().unwrap().value.as_str())
                );
            }
            other => panic!("{other:?}"),
        }
        let own = plugins
            .iter()
            .find(|e| e.item.id == "boopis:plugins/superpowers")
            .unwrap();
        assert!(matches!(
            plugin_source(&own.raw["entry"], &base).unwrap(),
            PluginSource::Git {
                subdir: None,
                sha: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn the_kinds_of_boopis_list_take_turns_each_in_its_own_order() {
        let cat = crate::connectors::catalog::load().unwrap();
        let list = crate::store::recommended::load().unwrap();
        let (skills, plugins) = boopis_skills_and_plugins(list, NOW);
        let ids = |v: &[Entry]| v.iter().map(|e| e.item.id.clone()).collect::<Vec<_>>();
        let (c, p, s) = (boopis_connectors(cat, NOW), plugins, skills);
        let woven = weave(vec![c.clone(), p.clone(), s.clone()]);
        let w = ids(&woven);
        assert_eq!(w.len(), c.len() + p.len() + s.len());
        // the first of each kind come first, in that turn order
        assert_eq!(
            &w[..3],
            &[ids(&c)[0].clone(), ids(&p)[0].clone(), ids(&s)[0].clone()]
        );
        // and each kind keeps its own order
        for kind in [ids(&c), ids(&p), ids(&s)] {
            let at: Vec<usize> = kind
                .iter()
                .map(|i| w.iter().position(|x| x == i).unwrap())
                .collect();
            assert!(at.windows(2).all(|x| x[0] < x[1]), "{kind:?}");
        }
        // a connector's page says which stars placed it
        let ctx = by_id(&c, "boopis:context7");
        assert!(
            ctx.provenance
                .source_tier
                .as_deref()
                .unwrap()
                .contains("65,246 GitHub stars on upstash/context7, read 22 November 2026"),
            "{:?}",
            ctx.provenance.source_tier
        );
    }

    #[test]
    fn counts_and_dates_are_said_in_words() {
        assert_eq!(group_thousands(65_246), "65,246");
        assert_eq!(group_thousands(1_134_112), "1,134,112");
        assert_eq!(group_thousands(92), "92");
        assert_eq!(date_words("2026-11-22"), "22 November 2026");
        assert_eq!(date_words("later"), "later");
    }

    #[test]
    fn every_normalised_item_has_the_contract_shape() {
        // Ids are `source:name`; the provenance repeats the source; nothing is missing a required field. Round-tripping through
        // the typed JSON is the schema's check on this side (`types.rs` refuses unknown keys).
        let mut all = registry_page(&serde_json::from_str(REGISTRY).unwrap(), NOW).entries;
        all.extend(engine_catalogue(
            &serde_json::from_str(ENGINE).unwrap(),
            NOW,
        ));
        for e in all {
            let (src, name) = e.item.id.split_once(':').unwrap();
            assert_eq!(
                (src, e.item.provenance.source.as_str()),
                (e.item.source.as_str(), src)
            );
            assert!(
                !name.is_empty() && !e.item.summary.is_empty()
                    || e.item.kind == ItemKind::Connector
            );
            let v = serde_json::to_value(&e.item).unwrap();
            assert_eq!(serde_json::from_value::<StoreItem>(v).unwrap(), e.item);
        }
    }
}
