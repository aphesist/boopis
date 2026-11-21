//! The curated collection (`apps/shared/data/connectors.json`, `docs/CONNECTORS.md`) as data: compiled in, parsed once, and
//! never a place for code. An entry is pinned and verified by a person; the host only reads it and builds the same install
//! form from it that a URL or a command gets.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{Error, Result};

/// The shared data file, compiled in (the schema next to it is checked by CI).
pub const CATALOG_JSON: &str = include_str!("../../../../shared/data/connectors.json");

/// The whole collection.
#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    /// The connectors.
    pub connectors: Vec<Connector>,
}

/// One connector.
#[derive(Debug, Clone, Deserialize)]
pub struct Connector {
    /// A lowercase token; the default name it is installed under.
    pub id: String,
    /// The display name.
    pub name: String,
    /// Who publishes it.
    pub publisher: String,
    /// One line.
    pub description: String,
    /// The publisher's source.
    pub source: String,
    /// The licence.
    pub license: String,
    /// What it is for, as the data file lists them.
    #[serde(default)]
    pub categories: Vec<String>,
    /// What was verified, when, against which sources.
    pub verified: Verified,
    /// The ways to run it.
    pub variants: Vec<Variant>,
}

/// What was checked.
#[derive(Debug, Clone, Deserialize)]
pub struct Verified {
    /// The date of the check.
    pub date: String,
    /// The package the pin names.
    #[serde(default)]
    pub package: Option<String>,
    /// The pinned version.
    #[serde(default)]
    pub version: Option<String>,
}

/// One way to run a connector.
#[derive(Debug, Clone, Deserialize)]
pub struct Variant {
    /// A token, unique within the connector.
    pub id: String,
    /// The label.
    pub label: String,
    /// The variant offered first.
    #[serde(default)]
    pub default: bool,
    /// One line.
    #[serde(default)]
    pub summary: String,
    /// `stdio`, `streamable-http` or `sse`.
    pub transport: String,
    /// The program, for `stdio`.
    #[serde(default)]
    pub command: Option<String>,
    /// Its arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// The URL, for the HTTP transports.
    #[serde(default)]
    pub url: Option<String>,
    /// How the server signs a user in.
    #[serde(default)]
    pub auth: Option<Auth>,
    /// Plain values the user fills in.
    #[serde(default)]
    pub setup: Vec<Setup>,
    /// What must exist first.
    #[serde(default)]
    pub requires: Vec<Requires>,
    /// Keys.
    #[serde(default)]
    pub credentials: Vec<Credential>,
    /// What it reaches.
    pub network: Network,
    /// A sign-in command of this variant, reviewed with the entry (the provider id a form names is its `id`).
    #[serde(default)]
    pub login: Option<super::logins::Login>,
}

/// `auth` of a variant.
#[derive(Debug, Clone, Deserialize)]
pub struct Auth {
    /// `oauth`.
    pub kind: String,
    /// The URL to use when signing in (it can differ from the keyless one).
    #[serde(default)]
    pub url: Option<String>,
    /// The key-based alternative.
    #[serde(default)]
    pub alternative: Option<Alternative>,
}

/// A key sent as a header.
#[derive(Debug, Clone, Deserialize)]
pub struct Alternative {
    /// `bearer`.
    pub kind: String,
    /// The header.
    pub header: String,
    /// The credential's id.
    pub credential: String,
}

/// A plain value a stdio server reads from its environment.
#[derive(Debug, Clone, Deserialize)]
pub struct Setup {
    /// The variable.
    pub env: String,
    /// The label.
    pub title: String,
    /// Help.
    #[serde(default)]
    pub description: String,
    /// A schema format such as `uri`.
    #[serde(default)]
    pub format: Option<String>,
    /// Whether it must be given.
    #[serde(default)]
    pub required: bool,
}

/// Something the connector needs that boopis does not install.
#[derive(Debug, Clone, Deserialize)]
pub struct Requires {
    /// The thing's name.
    pub name: String,
    /// Where it comes from.
    #[serde(default)]
    pub source: Option<String>,
    /// What to do about it.
    #[serde(default)]
    pub note: Option<String>,
}

/// A key.
#[derive(Debug, Clone, Deserialize)]
pub struct Credential {
    /// The id; part of the keychain reference.
    pub id: String,
    /// The label.
    pub title: String,
    /// The variable a stdio server reads it from.
    #[serde(default)]
    pub env: Option<String>,
    /// The host it is for.
    #[serde(default)]
    pub host: Option<String>,
    /// Whether it may be left out.
    #[serde(default)]
    pub optional: bool,
}

/// Where a variant reaches.
#[derive(Debug, Clone, Deserialize)]
pub struct Network {
    /// `none`, `loopback`, `any` or a list of hosts.
    pub egress: Egress,
}

/// The egress, as the data file spells it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Egress {
    /// `none`, `loopback` or `any`.
    Word(String),
    /// Named hosts.
    Hosts(Vec<String>),
}

impl Egress {
    /// The words for the install form.
    #[must_use]
    pub fn text(&self) -> String {
        match self {
            Self::Word(w) if w == "none" => "Nothing: it does not use the network".into(),
            Self::Word(w) if w == "loopback" => "Only this computer (127.0.0.1)".into(),
            Self::Word(w) if w == "any" => "Any host: it is not limited".into(),
            Self::Word(w) => w.clone(),
            Self::Hosts(h) => h.join(", "),
        }
    }
}

impl Connector {
    /// The variant offered first.
    #[must_use]
    pub fn default_variant(&self) -> &Variant {
        self.variants
            .iter()
            .find(|v| v.default)
            .unwrap_or(&self.variants[0])
    }

    /// A variant by id.
    #[must_use]
    pub fn variant(&self, id: &str) -> Option<&Variant> {
        self.variants.iter().find(|v| v.id == id)
    }

    /// The exact version a stdio variant is pinned to, as `package@version`; `None` for a hosted variant (nothing runs here,
    /// so there is nothing to pin) and for an entry that names no package.
    #[must_use]
    pub fn pinned(&self, variant: &Variant) -> Option<String> {
        if variant.transport != "stdio" {
            return None;
        }
        let (p, v) = (
            self.verified.package.as_deref()?,
            self.verified.version.as_deref()?,
        );
        let pin = format!("{p}@{v}");
        variant.args.contains(&pin).then_some(pin)
    }
}

/// The collection, parsed once.
///
/// # Errors
/// `Config` when the compiled-in file does not parse (a build mistake; the unit test catches it).
pub fn load() -> Result<&'static Catalog> {
    static CATALOG: OnceLock<std::result::Result<Catalog, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| serde_json::from_str(CATALOG_JSON).map_err(|e| e.to_string()))
        .as_ref()
        .map_err(|e| Error::Config(format!("the connector collection does not parse: {e}")))
}

/// What the picker shows of a connector.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorCatalogEntry")]
pub struct CatalogEntry {
    /// The id.
    pub id: String,
    /// The name.
    pub name: String,
    /// The publisher.
    pub publisher: String,
    /// One line.
    pub description: String,
    /// The licence.
    pub license: String,
    /// The date it was checked against the publisher's sources.
    pub verified: String,
    /// The ways to run it, the default first.
    pub variants: Vec<CatalogVariant>,
}

/// One way to run it, as the picker shows it.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorCatalogVariant")]
pub struct CatalogVariant {
    /// The id.
    pub id: String,
    /// The label.
    pub label: String,
    /// One line.
    pub summary: String,
    /// What it reaches.
    pub reaches: String,
    /// `package@version` for a program that runs here; `None` when hosted.
    pub pinned: Option<String>,
    /// Whether this is the default way.
    pub default: bool,
}

/// The picker's rows.
///
/// # Errors
/// As [`load`].
pub fn entries() -> Result<Vec<CatalogEntry>> {
    Ok(load()?
        .connectors
        .iter()
        .map(|c| {
            let mut variants: Vec<CatalogVariant> = c
                .variants
                .iter()
                .map(|v| CatalogVariant {
                    id: v.id.clone(),
                    label: v.label.clone(),
                    summary: v.summary.clone(),
                    reaches: v.network.egress.text(),
                    pinned: c.pinned(v),
                    default: std::ptr::eq(v, c.default_variant()),
                })
                .collect();
            variants.sort_by_key(|v| !v.default);
            CatalogEntry {
                id: c.id.clone(),
                name: c.name.clone(),
                publisher: c.publisher.clone(),
                description: c.description.clone(),
                license: c.license.clone(),
                verified: c.verified.date.clone(),
                variants,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_collection_parses_and_every_entry_is_sound() {
        let cat = load().unwrap();
        assert!(!cat.connectors.is_empty());
        for c in &cat.connectors {
            super::super::validate::name(&c.id).unwrap();
            assert!(!c.variants.is_empty(), "{}", c.id);
            assert_eq!(
                c.variants.iter().filter(|v| v.default).count().max(1),
                1,
                "{}: at most one default",
                c.id
            );
            for v in &c.variants {
                match v.transport.as_str() {
                    "stdio" => {
                        let cmd = v
                            .command
                            .as_deref()
                            .unwrap_or_else(|| panic!("{} {}: a command", c.id, v.id));
                        super::super::validate::command(cmd).unwrap();
                        super::super::validate::args(cmd, &v.args).unwrap();
                        assert!(
                            c.pinned(v).is_some(),
                            "{} {}: a stdio variant is pinned to verified.package@version",
                            c.id,
                            v.id
                        );
                    }
                    "streamable-http" | "sse" => {
                        super::super::validate::url(
                            v.url
                                .as_deref()
                                .unwrap_or_else(|| panic!("{} {}: a url", c.id, v.id)),
                        )
                        .unwrap();
                        if let Some(u) = v.auth.as_ref().and_then(|a| a.url.as_deref()) {
                            super::super::validate::url(u).unwrap();
                        }
                    }
                    other => panic!("{} {}: transport {other}", c.id, v.id),
                }
                if let Some(login) = &v.login {
                    login.check().unwrap();
                }
                for s in &v.setup {
                    super::super::validate::env_name(&s.env).unwrap();
                }
                for k in &v.credentials {
                    super::super::validate::name(&k.id.replace('_', "-")).unwrap();
                    if let Some(env) = &k.env {
                        super::super::validate::env_name(env).unwrap();
                    }
                }
                if let Some(alt) = v.auth.as_ref().and_then(|a| a.alternative.as_ref()) {
                    assert!(
                        v.credentials.iter().any(|k| k.id == alt.credential),
                        "{} {}: the alternative names a credential",
                        c.id,
                        v.id
                    );
                    super::super::validate::header_name(&alt.header).unwrap();
                }
            }
        }
    }

    #[test]
    fn nothing_is_unpinned() {
        for c in &load().unwrap().connectors {
            for v in &c.variants {
                for a in &v.args {
                    let low = a.to_ascii_lowercase();
                    assert!(
                        !low.ends_with("@latest")
                            && !low.ends_with("==latest")
                            && !low.contains(":latest"),
                        "{} {}: {a}",
                        c.id,
                        v.id
                    );
                }
            }
            assert!(
                c.verified.version.as_deref().is_none_or(|v| v != "latest"),
                "{}",
                c.id
            );
        }
    }

    #[test]
    fn the_picker_lists_the_default_first_with_its_reach_and_pin() {
        let e = entries().unwrap();
        let fc = e.iter().find(|c| c.id == "firecrawl").unwrap();
        assert_eq!(fc.variants[0].id, "local");
        assert!(fc.variants[0].default);
        assert_eq!(fc.variants[0].reaches, "Only this computer (127.0.0.1)");
        assert_eq!(
            fc.variants[0].pinned.as_deref(),
            Some("firecrawl-mcp@3.40.0")
        );
        let hosted = fc.variants.iter().find(|v| v.id == "hosted").unwrap();
        assert_eq!(hosted.reaches, "mcp.firecrawl.dev");
        assert!(hosted.pinned.is_none(), "a hosted server has no pin");
    }
}
