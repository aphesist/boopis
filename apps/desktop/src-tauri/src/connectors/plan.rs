//! From what the user chose to exactly what will be added. One pure function turns a request (a catalog entry, a URL, a
//! command) into a [`Plan`]: the configuration Hermes will store (with `${VAR}` references where a key goes, never a key),
//! the keychain entries it needs, the config diff, the rows the install form shows, and a hash of all of it. The install
//! recomputes the plan and refuses when its hash is not the one the user saw.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use specta::Type;

use super::catalog::{self, Connector, Variant};
use super::validate;
use crate::error::{Error, Result};
use crate::secrets::refs::{SOURCE, SecretRef};
use crate::setup::{DiffLine, Form};

/// Where a connector comes from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "ConnectorSource")]
pub enum SourceKind {
    /// The curated collection.
    Catalog,
    /// A remote server, by URL.
    Url,
    /// A local program.
    Command,
}

/// What the user chose: the form's values, by field name, all text. The host reads them (the fields are the ones
/// [`inputs_form`] defines) and validates every one.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename = "ConnectorRequest")]
pub struct Request {
    /// Which kind.
    pub source: SourceKind,
    /// The values.
    pub values: BTreeMap<String, String>,
}

/// A key the connector needs, kept in the keychain.
#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename = "ConnectorSecret")]
pub struct SecretNeed {
    /// The form field that carries it.
    pub field: String,
    /// The label.
    pub title: String,
    /// `secret://connector.<name>/<field>`.
    pub reference: String,
    /// Whether the connector works without it.
    pub optional: bool,
}

/// Exactly what an install will do.
#[derive(Debug, Clone)]
pub struct Plan {
    /// The name in `mcp_servers`.
    pub name: String,
    /// The display name for the form.
    pub title: String,
    /// What Hermes will store: no key, only `${VAR}` references.
    pub config: Value,
    /// The keys it needs (all of them; `config` holds the references of the ones `provided` named).
    pub secrets: Vec<SecretNeed>,
    /// `hermes config set` writes that bind a key's reference to the variable Hermes reads: `(key, value)`.
    pub wires: Vec<(String, String)>,
    /// The server signs in through OAuth, which comes after the install.
    pub oauth: bool,
    /// The rows of the form.
    pub contents: Vec<(String, String)>,
    /// `package@version`, when something is pinned.
    pub pinned: Option<String>,
    /// The configuration changes, line by line.
    pub diff: Vec<DiffLine>,
    /// Why it is installed, in a sentence.
    pub why: String,
    /// The hash the user's consent is bound to.
    pub hash: String,
}

/// A plan the host shows: the review form and the hash to send back with the install.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename = "ConnectorReview")]
pub struct Review {
    /// The install form.
    pub form: Form,
    /// What the install must name, so what is installed is what was shown.
    pub plan_hash: String,
    /// The name it will be installed under.
    pub name: String,
}

fn invalid(what: impl Into<String>) -> Error {
    Error::InvalidInput(what.into())
}

fn get<'a>(v: &'a BTreeMap<String, String>, k: &str) -> &'a str {
    v.get(k).map_or("", |s| s.trim())
}

fn secret_ref(name: &str, field: &str) -> Result<SecretRef> {
    SecretRef::parse(&format!("secret://connector.{name}/{field}"))
}

struct Builder {
    name: String,
    title: String,
    config: Map<String, Value>,
    secrets: Vec<SecretNeed>,
    refs: Vec<(String, SecretRef)>,
    oauth: bool,
    contents: Vec<(String, String)>,
    pinned: Option<String>,
    why: String,
}

impl Builder {
    fn new(name: &str, title: &str) -> Self {
        Self {
            name: name.to_owned(),
            title: title.to_owned(),
            config: Map::new(),
            secrets: Vec::new(),
            refs: Vec::new(),
            oauth: false,
            contents: Vec::new(),
            pinned: None,
            why: String::new(),
        }
    }

    /// Declare a key. It is in `config` (as a reference) only when `provided` is `None` (the plan shown) or names it.
    fn need(
        &mut self,
        field: &str,
        title: &str,
        optional: bool,
        provided: Option<&BTreeSet<String>>,
    ) -> Result<Option<String>> {
        let r = secret_ref(&self.name, field)?;
        self.secrets.push(SecretNeed {
            field: field.to_owned(),
            title: title.to_owned(),
            reference: r.text(),
            optional,
        });
        let used = provided.is_none_or(|p| p.contains(field));
        let var = r.env_name();
        self.refs.push((field.to_owned(), r));
        Ok(used.then(|| format!("${{{var}}}")))
    }

    fn row(&mut self, label: &str, text: impl Into<String>) {
        self.contents.push((label.to_owned(), text.into()));
    }

    fn finish(self) -> Plan {
        let config = Value::Object(self.config);
        let text = config.to_string();
        // Only the keys the configuration refers to are wired: one that was left out has no reference and needs none.
        let mut wires = Vec::new();
        for (_, r) in &self.refs {
            if text.contains(&r.env_name()) {
                wires.push((format!("secrets.{SOURCE}.env.{}", r.env_name()), r.text()));
            }
        }
        if !wires.is_empty() {
            wires.push((format!("secrets.{SOURCE}.enabled"), "true".to_owned()));
        }
        let mut diff = config_diff(&self.name, &config);
        for (k, v) in &wires {
            diff.push(DiffLine {
                key: k.clone(),
                from: None,
                to: if v == "true" { json!(true) } else { json!(v) },
            });
        }
        let canonical = json!({
            "name": self.name,
            "config": config,
            "secrets": self.secrets.iter().map(|s| json!([s.field, s.reference, s.optional])).collect::<Vec<_>>(),
            "wires": wires,
        });
        let hash = hex::encode(Sha256::digest(canonical.to_string().as_bytes()));
        Plan {
            name: self.name,
            title: self.title,
            config,
            secrets: self.secrets,
            wires,
            oauth: self.oauth,
            contents: self.contents,
            pinned: self.pinned,
            diff,
            why: self.why,
            hash,
        }
    }
}

/// The configuration of one server as `mcp_servers.<name>.<key>` lines.
fn config_diff(name: &str, config: &Value) -> Vec<DiffLine> {
    let mut out = Vec::new();
    let Some(obj) = config.as_object() else {
        return out;
    };
    for (k, v) in obj {
        match v {
            Value::Object(inner) if !inner.is_empty() => {
                for (ik, iv) in inner {
                    out.push(DiffLine {
                        key: format!("mcp_servers.{name}.{k}.{ik}"),
                        from: None,
                        to: iv.clone(),
                    });
                }
            }
            _ => out.push(DiffLine {
                key: format!("mcp_servers.{name}.{k}"),
                from: None,
                to: v.clone(),
            }),
        }
    }
    out
}

/// Build the plan for `request`. `provided` names the key fields the user gave (`None`: all of them, which is the plan the
/// form shows); a key that is left out is simply not in the configuration.
///
/// # Errors
/// `InvalidInput` with the reason in words, for anything the validators refuse or a missing required value.
pub fn build(request: &Request, provided: Option<&BTreeSet<String>>) -> Result<Plan> {
    match request.source {
        SourceKind::Catalog => from_catalog(&request.values, provided),
        SourceKind::Url => from_url(&request.values, provided),
        SourceKind::Command => from_command(&request.values, provided),
    }
}

fn bearer(header: &str, var: &str) -> String {
    if header.eq_ignore_ascii_case("authorization") {
        format!("Bearer {var}")
    } else {
        var.to_owned()
    }
}

fn from_url(v: &BTreeMap<String, String>, provided: Option<&BTreeSet<String>>) -> Result<Plan> {
    let name = get(v, "name");
    validate::name(name)?;
    let url = validate::url(get(v, "url"))?;
    let mut b = Builder::new(name, name);
    b.config.insert("url".into(), json!(url.as_str()));
    let plain = validate::header_lines(get(v, "headers"))?;
    let mut headers: Map<String, Value> =
        plain.iter().map(|(k, x)| (k.clone(), json!(x))).collect();
    match get(v, "auth") {
        "" | "none" => {}
        "key" => {
            let header = match get(v, "key_header") {
                "" => "Authorization",
                h => h,
            };
            validate::header_name(header)?;
            if headers.keys().any(|k| k.eq_ignore_ascii_case(header)) {
                return Err(invalid(format!(
                    "{header} is in the headers field and in the key option; use one"
                )));
            }
            if let Some(var) = b.need("key", "API key or token", false, provided)? {
                headers.insert(header.to_owned(), json!(bearer(header, &var)));
            }
        }
        "oauth" => {
            b.oauth = true;
            b.config.insert("auth".into(), json!("oauth"));
            let mut oauth = Map::new();
            if !get(v, "client_id").is_empty() {
                let id = get(v, "client_id");
                if id.len() > 512 || id.chars().any(|c| c.is_control() || c.is_whitespace()) {
                    return Err(invalid("the OAuth client ID has spaces or is too long"));
                }
                oauth.insert("client_id".into(), json!(id));
                if let Some(var) = b.need("client_secret", "OAuth client secret", true, provided)? {
                    oauth.insert("client_secret".into(), json!(var));
                }
            }
            if !oauth.is_empty() {
                b.config.insert("oauth".into(), Value::Object(oauth));
            }
        }
        other => {
            return Err(invalid(format!(
                "{other:?} is not a way to sign in (none, key or oauth)"
            )));
        }
    }
    if !headers.is_empty() {
        b.config.insert("headers".into(), Value::Object(headers));
    }
    b.row("Connects to", url.as_str());
    b.row("Reaches", validate::host_of(&url));
    if b.oauth {
        b.row(
            "Sign-in",
            "OAuth in your browser. boopis keeps the tokens in its own store and never shows them",
        );
    }
    b.row(
        "Version",
        "Not pinned: this is a server somebody else runs, and it can change",
    );
    b.why = format!(
        "You asked for the server at {} to be added.",
        validate::host_of(&url)
    );
    Ok(b.finish())
}

fn from_command(v: &BTreeMap<String, String>, provided: Option<&BTreeSet<String>>) -> Result<Plan> {
    let name = get(v, "name");
    validate::name(name)?;
    let command = get(v, "command");
    validate::command(command)?;
    let args = validate::arg_lines(v.get("args").map_or("", String::as_str));
    validate::args(command, &args)?;
    let env = validate::env_lines(get(v, "env"))?;
    let mut b = Builder::new(name, name);
    b.config.insert("command".into(), json!(command));
    if !args.is_empty() {
        b.config.insert("args".into(), json!(args));
    }
    let mut env_obj: Map<String, Value> = env.iter().map(|(k, x)| (k.clone(), json!(x))).collect();
    let key_env = get(v, "key_env");
    if !key_env.is_empty() {
        validate::env_name(key_env)?;
        if env_obj.contains_key(key_env) {
            return Err(invalid(format!(
                "{key_env} is in the environment field and in the key option; use one"
            )));
        }
        if let Some(var) = b.need("key", "API key or token", false, provided)? {
            env_obj.insert(key_env.to_owned(), json!(var));
        }
    }
    if !env_obj.is_empty() {
        b.config.insert("env".into(), Value::Object(env_obj));
    }
    b.row("Command", command);
    b.row(
        "Arguments",
        if args.is_empty() {
            "none".to_owned()
        } else {
            validate::display_args(&args)
        },
    );
    if !env.is_empty() {
        b.row(
            "Environment",
            env.iter()
                .map(|(k, x)| format!("{k}={x}"))
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    b.row("Reaches", "Not known: it is a program on this computer, run as you. boopis cannot say what it connects to");
    b.row(
        "Version",
        "Not pinned: boopis cannot tell which version this command starts",
    );
    "You asked for this program to be added as an MCP server.".clone_into(&mut b.why);
    Ok(b.finish())
}

fn from_catalog(v: &BTreeMap<String, String>, provided: Option<&BTreeSet<String>>) -> Result<Plan> {
    let cat = catalog::load()?;
    let conn = cat
        .connectors
        .iter()
        .find(|c| c.id == get(v, "connector"))
        .ok_or_else(|| invalid("that connector is not in the collection"))?;
    let variant = conn
        .variant(get(v, "variant"))
        .ok_or_else(|| invalid("that way of running it is not in the collection"))?;
    let name = match get(v, "name") {
        "" => conn.id.as_str(),
        n => n,
    };
    validate::name(name)?;
    let mut b = Builder::new(name, &format!("{} ({})", conn.name, variant.label));
    match variant.transport.as_str() {
        "stdio" => catalog_stdio(&mut b, conn, variant, v, provided)?,
        _ => catalog_http(&mut b, variant, v, provided)?,
    }
    b.row("Reaches", variant.network.egress.text());
    for r in &variant.requires {
        let note = r.note.clone().unwrap_or_default();
        b.row("Needs", format!("{}. {note}", r.name).trim().to_owned());
    }
    b.row("Licence", conn.license.clone());
    b.row(
        "Checked",
        format!(
            "{} against {}'s own sources",
            conn.verified.date, conn.publisher
        ),
    );
    b.why = format!("{}: {}", conn.name, conn.description);
    Ok(b.finish())
}

fn catalog_stdio(
    b: &mut Builder,
    conn: &Connector,
    variant: &Variant,
    v: &BTreeMap<String, String>,
    provided: Option<&BTreeSet<String>>,
) -> Result<()> {
    let command = variant.command.as_deref().unwrap_or_default();
    validate::command(command)?;
    validate::args(command, &variant.args)?;
    b.config.insert("command".into(), json!(command));
    if !variant.args.is_empty() {
        b.config.insert("args".into(), json!(variant.args));
    }
    let mut env = Map::new();
    for s in &variant.setup {
        let value = get(v, &s.env);
        if value.is_empty() {
            if s.required {
                return Err(invalid(format!("{} is needed", s.title)));
            }
            continue;
        }
        validate::env_name(&s.env)?;
        validate::env_value(&s.env, value)?;
        if s.format.as_deref() == Some("uri") {
            validate::url(value)?;
        }
        env.insert(s.env.clone(), json!(value));
    }
    for k in &variant.credentials {
        let Some(env_name) = &k.env else { continue };
        validate::env_name(env_name)?;
        if let Some(var) = b.need(&k.id, &k.title, k.optional, provided)? {
            env.insert(env_name.clone(), json!(var));
        }
    }
    if !env.is_empty() {
        b.config.insert("env".into(), Value::Object(env));
    }
    b.pinned = conn.pinned(variant);
    b.row("Command", command);
    b.row("Arguments", validate::display_args(&variant.args));
    b.row(
        "Version",
        b.pinned.clone().unwrap_or_else(|| "Not pinned".into()),
    );
    Ok(())
}

fn catalog_http(
    b: &mut Builder,
    variant: &Variant,
    v: &BTreeMap<String, String>,
    provided: Option<&BTreeSet<String>>,
) -> Result<()> {
    let key_url = variant.url.as_deref().unwrap_or_default();
    let mode = match (get(v, "auth"), &variant.auth) {
        ("", Some(_)) => "oauth",
        ("", None) => "none",
        (m, _) => m,
    };
    let url = match (mode, variant.auth.as_ref().and_then(|a| a.url.as_deref())) {
        ("oauth", Some(u)) => u,
        _ => key_url,
    };
    validate::url(url)?;
    b.config.insert("url".into(), json!(url));
    match (mode, &variant.auth) {
        ("oauth", Some(_)) => {
            b.oauth = true;
            b.config.insert("auth".into(), json!("oauth"));
            b.row(
                "Sign-in",
                "OAuth in your browser. boopis keeps the tokens in its own store and never shows them",
            );
        }
        ("key", Some(auth)) => {
            let alt = auth
                .alternative
                .as_ref()
                .ok_or_else(|| invalid("this connector has no key option"))?;
            validate::header_name(&alt.header)?;
            let cred = variant
                .credentials
                .iter()
                .find(|k| k.id == alt.credential)
                .ok_or_else(|| invalid("the collection names a key it does not define"))?;
            if let Some(var) = b.need(&cred.id, &cred.title, cred.optional, provided)? {
                b.config.insert(
                    "headers".into(),
                    json!({ alt.header.clone(): bearer(&alt.header, &var) }),
                );
            }
        }
        ("none" | "key", None) => {
            for k in &variant.credentials {
                b.need(&k.id, &k.title, k.optional, provided)?;
            }
        }
        (other, _) => {
            return Err(invalid(format!(
                "{other:?} is not a way to use this connector"
            )));
        }
    }
    b.row("Connects to", url);
    b.row(
        "Version",
        "Not pinned: the publisher runs this server and can change it",
    );
    Ok(())
}

/// Where one key goes in a [`ServerSpec`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretTarget {
    /// An environment variable of a local program.
    Env(String),
    /// An HTTP header of a remote server (`Authorization` gets `Bearer ${VAR}`).
    Header(String),
}

/// One key a [`ServerSpec`] needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecSecret {
    /// The field: part of the keychain reference (`secret://connector.<name>/<field>`), so lowercase letters, digits, `_`, `-`.
    pub field: String,
    /// The label.
    pub title: String,
    /// Whether the server works without it.
    pub optional: bool,
    /// Where it goes.
    pub target: SecretTarget,
}

/// How a [`ServerSpec`] runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpecTransport {
    /// A local program.
    Command {
        /// The program.
        command: String,
        /// Its arguments.
        args: Vec<String>,
        /// Plain environment (no key).
        env: Vec<(String, String)>,
    },
    /// A remote server.
    Url {
        /// Its address.
        url: String,
        /// Plain headers (no key).
        headers: Vec<(String, String)>,
    },
}

/// A server described by something other than the connector form: the store's registry entries and bundles. It goes through
/// the same builder as a request, so the same validators, the same `${VAR}` references and the same hash apply, and it may
/// carry several keys.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSpec {
    /// The name in `mcp_servers`.
    pub name: String,
    /// The display name.
    pub title: String,
    /// How it runs.
    pub transport: SpecTransport,
    /// Its keys.
    pub secrets: Vec<SpecSecret>,
    /// `package@version`, when something local is pinned.
    pub pinned: Option<String>,
    /// What it reaches, in words.
    pub reaches: String,
    /// Rows for the review, after the standard ones.
    pub rows: Vec<(String, String)>,
    /// Why it is installed.
    pub why: String,
}

/// The plan for a [`ServerSpec`]; `provided` is as for [`build`].
///
/// # Errors
/// `InvalidInput` with the reason in words, for anything the validators refuse.
pub fn build_server(spec: &ServerSpec, provided: Option<&BTreeSet<String>>) -> Result<Plan> {
    validate::name(&spec.name)?;
    let mut b = Builder::new(&spec.name, &spec.title);
    match &spec.transport {
        SpecTransport::Command { command, args, env } => {
            validate::command(command)?;
            validate::args(command, args)?;
            b.config.insert("command".into(), json!(command));
            if !args.is_empty() {
                b.config.insert("args".into(), json!(args));
            }
            let mut env_obj = Map::new();
            for (k, v) in env {
                validate::env_name(k)?;
                validate::env_value(k, v)?;
                env_obj.insert(k.clone(), json!(v));
            }
            for s in &spec.secrets {
                let SecretTarget::Env(var_name) = &s.target else {
                    return Err(invalid("a program takes its keys in its environment"));
                };
                validate::env_name(var_name)?;
                if env_obj.contains_key(var_name) {
                    return Err(invalid(format!("{var_name} is set and is also a key")));
                }
                if let Some(var) = b.need(&s.field, &s.title, s.optional, provided)? {
                    env_obj.insert(var_name.clone(), json!(var));
                }
            }
            if !env_obj.is_empty() {
                b.config.insert("env".into(), Value::Object(env_obj));
            }
            b.row("Command", command);
            b.row(
                "Arguments",
                if args.is_empty() { "none".to_owned() } else { validate::display_args(args) },
            );
        }
        SpecTransport::Url { url, headers } => {
            let parsed = validate::url(url)?;
            b.config.insert("url".into(), json!(parsed.as_str()));
            let mut hdr = Map::new();
            for (k, v) in headers {
                validate::plain_header(k, v)?;
                hdr.insert(k.clone(), json!(v));
            }
            for s in &spec.secrets {
                let SecretTarget::Header(name) = &s.target else {
                    return Err(invalid("a remote server takes its keys in a header"));
                };
                validate::header_name(name)?;
                if hdr.keys().any(|k| k.eq_ignore_ascii_case(name)) {
                    return Err(invalid(format!("{name} is set and is also a key")));
                }
                if let Some(var) = b.need(&s.field, &s.title, s.optional, provided)? {
                    hdr.insert(name.clone(), json!(bearer(name, &var)));
                }
            }
            if !hdr.is_empty() {
                b.config.insert("headers".into(), Value::Object(hdr));
            }
            b.row("Connects to", parsed.as_str());
        }
    }
    b.pinned.clone_from(&spec.pinned);
    b.row("Reaches", spec.reaches.clone());
    b.row(
        "Version",
        spec.pinned
            .clone()
            .unwrap_or_else(|| "Not pinned: the publisher runs this server and can change it".into()),
    );
    for (k, v) in &spec.rows {
        b.row(k, v.clone());
    }
    b.why.clone_from(&spec.why);
    Ok(b.finish())
}

/// What the review says about the restart a key brings. Present only when the plan has a key.
#[derive(Debug, Clone, Copy)]
pub struct RestartInfo {
    /// How many sessions have a turn running; `None` when Hermes could not say.
    pub running: Option<u32>,
}

/// The review form: the contents, the diff, the pin, a field for each key, and, when the install restarts Hermes while a turn
/// may be running, the choice of when.
#[must_use]
pub fn review_form(plan: &Plan, restart: Option<RestartInfo>) -> Form {
    let mut props = Map::new();
    let mut required = Vec::new();
    for s in &plan.secrets {
        props.insert(
            s.field.clone(),
            json!({
                "type": "string",
                "title": s.title,
                "description": if s.optional { "Optional. It goes to your keychain, never into a file." } else { "It goes to your keychain, never into a file or the conversation." },
                "x-secret": true,
                "x-secret-ref": s.reference,
            }),
        );
        if !s.optional {
            required.push(json!(s.field));
        }
    }
    let mut contents = plan.contents.clone();
    if let Some(r) = restart {
        let optional = plan.secrets.iter().all(|s| s.optional);
        let lead = if optional {
            "If you give a key, boopis restarts to load it."
        } else {
            "boopis restarts to load the key."
        };
        let tail = match r.running {
            Some(0) => " No session has a turn running, so it restarts at once.".to_owned(),
            Some(n) => format!(
                " {n} session{} {} a turn running, and a restart would end {}: you choose below.",
                if n == 1 { "" } else { "s" },
                if n == 1 { "has" } else { "have" },
                if n == 1 { "it" } else { "them" }
            ),
            None => {
                " boopis could not tell whether a turn is running, so you choose below.".to_owned()
            }
        };
        contents.push(("Restart".to_owned(), format!("{lead}{tail}")));
        if r.running != Some(0) {
            props.insert(
                "restart".into(),
                json!({
                    "type": "string", "title": "Restart", "enum": ["when_idle", "now"],
                    "enumNames": ["Install, restart when idle", "Install and restart now"], "default": "when_idle",
                    "description": "When idle: the key is saved now and boopis restarts the moment no session has a turn running, then tests it. Now: it ends the turns that are running."
                }),
            );
            required.push(json!("restart"));
        }
    }
    let schema = json!({"type": "object", "properties": props, "required": required});
    let mut f = Form::new(
        "connector.review",
        "connector",
        &format!("Install {}", plan.title),
        &plan.why,
        schema,
    );
    f.submit = crate::commands::Json(json!({"label": "Install", "hold": true}));
    f.cancel = crate::commands::Json(json!({"label": "Not now"}));
    f.diff.clone_from(&plan.diff);
    f.contents = contents;
    f.pinned.clone_from(&plan.pinned);
    f.effect = Some(
        "Adds it to boopis's connectors, then tests the connection. You can switch it off or remove it in Settings, Connectors."
            .to_owned(),
    );
    f
}

/// The review for a request.
///
/// # Errors
/// As [`build`].
pub fn review(request: &Request) -> Result<Review> {
    let plan = build(request, None)?;
    Ok(Review {
        form: review_form(&plan, None),
        plan_hash: plan.hash.clone(),
        name: plan.name,
    })
}

const NAME_PATTERN: &str = "^[a-z0-9][a-z0-9_-]{0,47}$";
const NAME_ERROR: &str =
    "Use lowercase letters, digits, - and _, up to 48, starting with a letter or digit";

fn text_field(title: &str, description: &str) -> Value {
    json!({"type": "string", "title": title, "description": description})
}

/// The form that asks for a source's inputs. For the catalog, `entry` is `(connector id, variant id)`.
///
/// # Errors
/// `InvalidInput` when the catalog entry is not in the collection.
pub fn inputs_form(source: SourceKind, entry: Option<(&str, &str)>) -> Result<Form> {
    let mut props = Map::new();
    let (id, title, body, required): (String, String, String, Vec<&str>);
    match source {
        SourceKind::Url => {
            props.insert("name".into(), json!({"type": "string", "title": "Name", "description": "How it appears in Connectors and in tool names.", "pattern": NAME_PATTERN, "x-error": NAME_ERROR, "x-mono": true}));
            props.insert("url".into(), json!({"type": "string", "format": "uri", "title": "URL", "description": "The server's MCP address. https only (plain http only for this computer).", "placeholder": "https://mcp.example.com/mcp", "x-mono": true}));
            props.insert("auth".into(), json!({"type": "string", "title": "Sign-in", "enum": ["none", "key", "oauth"], "enumNames": ["None", "An API key or token", "Sign in with OAuth"], "default": "none"}));
            props.insert("key_header".into(), text_field("Header for the key", "Only for an API key. Authorization sends it as a Bearer token. You paste the key on the next step."));
            props.insert("headers".into(), json!({"type": "string", "title": "Other headers", "description": "One per line, as Name: value. Not for keys: a key has its own option, so it goes to your keychain.", "x-multiline": true, "x-mono": true}));
            props.insert(
                "client_id".into(),
                text_field(
                    "OAuth client ID",
                    "Only for OAuth, and only when the server does not register clients by itself.",
                ),
            );
            id = "connector.url".into();
            title = "Add a connector by URL".into();
            body = "A remote MCP server. boopis shows exactly what will be added before it adds anything.".into();
            required = vec!["name", "url"];
        }
        SourceKind::Command => {
            props.insert("name".into(), json!({"type": "string", "title": "Name", "description": "How it appears in Connectors and in tool names.", "pattern": NAME_PATTERN, "x-error": NAME_ERROR, "x-mono": true}));
            props.insert("command".into(), json!({"type": "string", "title": "Command", "description": "One program, such as npx or uvx. Not a shell line: its arguments go below.", "x-mono": true}));
            props.insert("args".into(), json!({"type": "string", "title": "Arguments", "description": "One per line, exactly as the program should receive them. Pin a version, for example -y then package@1.2.3.", "x-multiline": true, "x-mono": true}));
            props.insert("env".into(), json!({"type": "string", "title": "Environment", "description": "One NAME=value per line, for values that are not keys.", "x-multiline": true, "x-mono": true}));
            props.insert("key_env".into(), text_field("Variable for a key", "Only if the program needs a key: the name of the variable that carries it. You paste the key on the next step."));
            id = "connector.command".into();
            title = "Add a connector by command".into();
            body = "A local program that speaks MCP over stdio. It runs on this computer as you."
                .into();
            required = vec!["name", "command"];
        }
        SourceKind::Catalog => {
            let (cid, vid) =
                entry.ok_or_else(|| invalid("pick a connector from the collection"))?;
            let cat = catalog::load()?;
            let conn = cat
                .connectors
                .iter()
                .find(|c| c.id == cid)
                .ok_or_else(|| invalid("that connector is not in the collection"))?;
            let variant = conn
                .variant(vid)
                .ok_or_else(|| invalid("that way of running it is not in the collection"))?;
            props.insert("name".into(), json!({"type": "string", "title": "Name", "description": "How it appears in Connectors and in tool names.", "default": conn.id, "pattern": NAME_PATTERN, "x-error": NAME_ERROR, "x-mono": true}));
            if let Some(auth) = &variant.auth {
                let (mut vals, mut names) = (
                    vec!["oauth"],
                    vec![format!("Sign in with {}", conn.publisher)],
                );
                if auth.alternative.is_some() {
                    vals.push("key");
                    names.push("An API key, or no account".to_owned());
                }
                props.insert("auth".into(), json!({"type": "string", "title": "Sign-in", "enum": vals, "enumNames": names, "default": "oauth"}));
            }
            let mut req = vec!["name"];
            for s in &variant.setup {
                let mut f = json!({"type": "string", "title": s.title, "description": s.description, "x-mono": true});
                if let Some(fmt) = &s.format {
                    f["format"] = json!(fmt);
                }
                props.insert(s.env.clone(), f);
                if s.required {
                    req.push(&s.env);
                }
            }
            id = format!("connector.catalog.{cid}.{vid}");
            title = format!("Add {} ({})", conn.name, variant.label);
            body = variant.summary.clone();
            // `required` borrows from the entry, which is 'static (the collection is parsed once)
            required = req;
        }
    }
    let schema = json!({"type": "object", "properties": props, "required": required});
    let mut f = Form::new(&id, "connector", &title, &body, schema);
    f.submit = crate::commands::Json(json!({"label": "Review", "hold": false}));
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(source: SourceKind, kv: &[(&str, &str)]) -> Request {
        Request {
            source,
            values: kv
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        }
    }
    fn provided(fields: &[&str]) -> BTreeSet<String> {
        fields.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn a_catalog_stdio_variant_shows_command_pin_reach_and_the_setup_value() {
        let p = build(
            &req(
                SourceKind::Catalog,
                &[
                    ("connector", "firecrawl"),
                    ("variant", "local"),
                    ("FIRECRAWL_API_URL", "http://127.0.0.1:3002"),
                ],
            ),
            None,
        )
        .unwrap();
        assert_eq!(p.name, "firecrawl");
        assert_eq!(p.config["command"], "npx");
        assert_eq!(p.config["args"], json!(["-y", "firecrawl-mcp@3.40.0"]));
        assert_eq!(
            p.config["env"]["FIRECRAWL_API_URL"],
            "http://127.0.0.1:3002"
        );
        assert_eq!(p.pinned.as_deref(), Some("firecrawl-mcp@3.40.0"));
        let rows: BTreeMap<_, _> = p.contents.iter().cloned().collect();
        assert_eq!(rows["Command"], "npx");
        assert_eq!(rows["Arguments"], "-y firecrawl-mcp@3.40.0");
        assert_eq!(rows["Reaches"], "Only this computer (127.0.0.1)");
        assert_eq!(rows["Version"], "firecrawl-mcp@3.40.0");
        assert!(rows["Needs"].starts_with("Firecrawl Local"));
        assert!(
            p.secrets.is_empty() && p.wires.is_empty(),
            "no key, so nothing is wired"
        );
        assert!(
            p.diff
                .iter()
                .any(|d| d.key == "mcp_servers.firecrawl.command" && d.to == json!("npx"))
        );
    }

    #[test]
    fn a_required_setup_value_is_asked_for_and_checked() {
        let r = req(
            SourceKind::Catalog,
            &[("connector", "firecrawl"), ("variant", "local")],
        );
        assert!(build(&r, None).unwrap_err().to_string().contains("needed"));
        let r = req(
            SourceKind::Catalog,
            &[
                ("connector", "firecrawl"),
                ("variant", "local"),
                ("FIRECRAWL_API_URL", "ftp://x"),
            ],
        );
        assert!(build(&r, None).is_err());
    }

    #[test]
    fn a_key_is_a_reference_in_the_config_and_a_wire_never_a_value() {
        let r = req(
            SourceKind::Catalog,
            &[("connector", "firecrawl"), ("variant", "package")],
        );
        let p = build(&r, None).unwrap();
        let s = &p.secrets[0];
        assert_eq!(
            s.reference,
            "secret://connector.firecrawl/firecrawl_api_key"
        );
        assert!(!s.optional);
        let var = SecretRef::parse(&s.reference).unwrap().env_name();
        assert_eq!(p.config["env"]["FIRECRAWL_API_KEY"], format!("${{{var}}}"));
        assert!(p.wires.contains(&(
            format!("secrets.boopis_host.env.{var}"),
            s.reference.clone()
        )));
        assert!(
            p.wires
                .contains(&("secrets.boopis_host.enabled".to_owned(), "true".to_owned()))
        );
        assert!(
            p.diff
                .iter()
                .any(|d| d.key == format!("secrets.boopis_host.env.{var}"))
        );
        let rows: BTreeMap<_, _> = p.contents.iter().cloned().collect();
        assert_eq!(rows["Reaches"], "api.firecrawl.dev");
    }

    #[test]
    fn the_hosted_variant_offers_oauth_or_an_optional_key() {
        let oauth = build(
            &req(
                SourceKind::Catalog,
                &[("connector", "firecrawl"), ("variant", "hosted")],
            ),
            None,
        )
        .unwrap();
        assert!(oauth.oauth);
        assert_eq!(
            oauth.config["url"],
            "https://mcp.firecrawl.dev/v2/mcp-oauth"
        );
        assert_eq!(oauth.config["auth"], "oauth");
        let key = req(
            SourceKind::Catalog,
            &[
                ("connector", "firecrawl"),
                ("variant", "hosted"),
                ("auth", "key"),
            ],
        );
        let shown = build(&key, None).unwrap();
        assert_eq!(shown.config["url"], "https://mcp.firecrawl.dev/v2/mcp");
        assert!(
            shown.config["headers"]["Authorization"]
                .as_str()
                .unwrap()
                .starts_with("Bearer ${BOOPIS_CONNECTOR_FIRECRAWL")
        );
        assert!(shown.secrets[0].optional);
        // left out: no header, and the hash of what was shown does not change what is installed
        let none = build(&key, Some(&provided(&[]))).unwrap();
        assert!(none.config.get("headers").is_none());
        assert_eq!(none.hash, build(&key, Some(&provided(&[]))).unwrap().hash);
        assert_ne!(none.hash, shown.hash);
    }

    #[test]
    fn a_url_with_a_key_builds_a_bearer_reference_and_no_literal() {
        let r = req(
            SourceKind::Url,
            &[
                ("name", "acme"),
                ("url", "https://mcp.acme.dev/mcp"),
                ("auth", "key"),
                ("headers", "X-Tenant: eu"),
            ],
        );
        let p = build(&r, None).unwrap();
        assert_eq!(p.config["url"], "https://mcp.acme.dev/mcp");
        assert_eq!(p.config["headers"]["X-Tenant"], "eu");
        assert!(
            p.config["headers"]["Authorization"]
                .as_str()
                .unwrap()
                .starts_with("Bearer ${BOOPIS_CONNECTOR_ACME_KEY_")
        );
        assert_eq!(p.secrets[0].reference, "secret://connector.acme/key");
        // another header name carries the bare reference
        let r = req(
            SourceKind::Url,
            &[
                ("name", "acme"),
                ("url", "https://mcp.acme.dev/mcp"),
                ("auth", "key"),
                ("key_header", "X-Api-Key"),
            ],
        );
        assert!(
            build(&r, None).unwrap().config["headers"]["X-Api-Key"]
                .as_str()
                .unwrap()
                .starts_with("${BOOPIS_")
        );
    }

    #[test]
    fn a_url_with_oauth_may_name_a_client() {
        let r = req(
            SourceKind::Url,
            &[
                ("name", "acme"),
                ("url", "https://mcp.acme.dev/mcp"),
                ("auth", "oauth"),
                ("client_id", "abc123"),
            ],
        );
        let p = build(&r, None).unwrap();
        assert!(p.oauth);
        assert_eq!(p.config["auth"], "oauth");
        assert_eq!(p.config["oauth"]["client_id"], "abc123");
        assert!(
            p.config["oauth"]["client_secret"]
                .as_str()
                .unwrap()
                .starts_with("${BOOPIS_CONNECTOR_ACME_CLIENT_SECRET_")
        );
        assert!(p.secrets[0].optional);
    }

    #[test]
    fn bad_urls_and_credentials_in_urls_never_become_a_plan() {
        for url in [
            "http://mcp.acme.dev/mcp",
            "https://u:p@mcp.acme.dev/mcp",
            "https://mcp.acme.dev/mcp?token=x",
            "javascript:alert(1)",
        ] {
            let r = req(SourceKind::Url, &[("name", "acme"), ("url", url)]);
            assert!(build(&r, None).is_err(), "{url}");
        }
        let r = req(
            SourceKind::Url,
            &[
                ("name", "acme"),
                ("url", "https://a.dev/mcp"),
                ("headers", "Authorization: Bearer sk-1"),
            ],
        );
        assert!(
            build(&r, None).is_err(),
            "a key typed into the headers field is refused"
        );
        let r = req(
            SourceKind::Url,
            &[("name", "Bad Name"), ("url", "https://a.dev/mcp")],
        );
        assert!(build(&r, None).is_err());
    }

    #[test]
    fn a_command_plan_is_a_vector_and_refuses_shell_strings() {
        let r = req(
            SourceKind::Command,
            &[
                ("name", "mine"),
                ("command", "npx"),
                ("args", "-y\nfoo-mcp@1.2.3"),
                ("env", "REGION=eu"),
                ("key_env", "FOO_API_KEY"),
            ],
        );
        let p = build(&r, None).unwrap();
        assert_eq!(p.config["command"], "npx");
        assert_eq!(p.config["args"], json!(["-y", "foo-mcp@1.2.3"]));
        assert_eq!(p.config["env"]["REGION"], "eu");
        assert!(
            p.config["env"]["FOO_API_KEY"]
                .as_str()
                .unwrap()
                .starts_with("${BOOPIS_CONNECTOR_MINE_KEY_")
        );
        assert!(p.pinned.is_none());
        let rows: BTreeMap<_, _> = p.contents.iter().cloned().collect();
        assert!(rows["Version"].starts_with("Not pinned"));
        assert!(rows["Reaches"].starts_with("Not known"));
        for (cmd, args) in [
            ("npx -y foo", ""),
            ("bash", "-c\nid"),
            ("python3", "-c\nimport os"),
            ("env", "A=1"),
            ("npx", "a\0b"),
        ] {
            let r = req(
                SourceKind::Command,
                &[("name", "mine"), ("command", cmd), ("args", args)],
            );
            assert!(build(&r, None).is_err(), "{cmd} {args:?}");
        }
        let r = req(
            SourceKind::Command,
            &[
                ("name", "mine"),
                ("command", "npx"),
                ("env", "API_KEY=sk-live"),
            ],
        );
        assert!(
            build(&r, None)
                .unwrap_err()
                .to_string()
                .contains("keychain"),
            "a key typed into the environment is refused"
        );
    }

    #[test]
    fn the_hash_binds_the_consent_to_the_plan() {
        let a = build(
            &req(
                SourceKind::Command,
                &[("name", "m"), ("command", "npx"), ("args", "foo@1")],
            ),
            None,
        )
        .unwrap();
        let again = build(
            &req(
                SourceKind::Command,
                &[("name", "m"), ("command", "npx"), ("args", "foo@1")],
            ),
            None,
        )
        .unwrap();
        let other = build(
            &req(
                SourceKind::Command,
                &[("name", "m"), ("command", "npx"), ("args", "foo@2")],
            ),
            None,
        )
        .unwrap();
        assert_eq!(a.hash, again.hash);
        assert_ne!(a.hash, other.hash);
        assert_eq!(a.hash.len(), 64);
    }

    #[test]
    fn the_review_form_is_a_connector_card_with_a_secret_field_per_key() {
        let r = review(&req(
            SourceKind::Catalog,
            &[("connector", "firecrawl"), ("variant", "package")],
        ))
        .unwrap();
        assert_eq!(r.form.kind, "connector");
        assert_eq!(r.form.pinned.as_deref(), Some("firecrawl-mcp@3.40.0"));
        assert!(!r.form.diff.is_empty() && !r.form.contents.is_empty());
        assert!(r.form.sensitive);
        let f = &r.form.schema.0["properties"]["firecrawl_api_key"];
        assert_eq!(f["x-secret"], true);
        assert_eq!(
            f["x-secret-ref"],
            "secret://connector.firecrawl/firecrawl_api_key"
        );
        assert_eq!(r.form.schema.0["required"], json!(["firecrawl_api_key"]));
        assert_eq!(r.form.submit.0["hold"], true);
        assert!(
            !serde_json::to_string(&r.form.schema.0)
                .unwrap()
                .contains("sk-")
        );
    }

    #[test]
    fn the_input_forms_name_the_fields_the_request_reads() {
        let f = inputs_form(SourceKind::Url, None).unwrap();
        for k in ["name", "url", "auth", "key_header", "headers", "client_id"] {
            assert!(f.schema.0["properties"][k].is_object(), "{k}");
        }
        let f = inputs_form(SourceKind::Command, None).unwrap();
        for k in ["name", "command", "args", "env", "key_env"] {
            assert!(f.schema.0["properties"][k].is_object(), "{k}");
        }
        let f = inputs_form(SourceKind::Catalog, Some(("firecrawl", "local"))).unwrap();
        assert!(f.schema.0["properties"]["FIRECRAWL_API_URL"].is_object());
        assert_eq!(f.schema.0["properties"]["name"]["default"], "firecrawl");
        let f = inputs_form(SourceKind::Catalog, Some(("firecrawl", "hosted"))).unwrap();
        assert_eq!(
            f.schema.0["properties"]["auth"]["enum"],
            json!(["oauth", "key"])
        );
        assert!(inputs_form(SourceKind::Catalog, Some(("nope", "x"))).is_err());
        assert!(inputs_form(SourceKind::Catalog, None).is_err());
    }
}
