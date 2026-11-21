//! MCP servers described by something other than boopis's own collection, mapped to the connector flow's [`ServerSpec`]: a
//! registry `server.json` (the 2025-12-11 schema) and an MCP bundle's `manifest.json`. Nothing here fetches or runs anything.
//!
//! The mapping of `docs/STORE.md` 5.10: each `remotes[]` entry is a URL variant; each `packages[]` entry a command variant
//! (`npx -y <id>@<version>`, `uvx <id>==<version>`, `docker run <image@digest>`); a bundle is unpacked by the host and run from
//! there, and its `fileSha256` is checked before anything is unpacked. A field the registry cannot fill (what the server
//! reaches, its tools) is "not known". What a server asks for that boopis cannot ask the user for (a required value with no
//! default) is listed in [`Chosen::unfilled`] and shown as a warning, never invented.

use std::path::Path;

use serde_json::Value;

use super::types::{HostBasis, HostList, Pin, PinKind, SecretNeed};
use crate::connectors::plan::{SecretTarget, ServerSpec, SpecSecret, SpecTransport};
use crate::connectors::validate;

/// One input of a server: an environment variable, a header or an argument.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Input {
    name: String,
    value: Option<String>,
    default: Option<String>,
    required: bool,
    secret: bool,
    description: String,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn inputs(v: Option<&Value>) -> Vec<Input> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|i| Input {
                    name: text(i, "name").unwrap_or_default(),
                    value: text(i, "value"),
                    default: text(i, "default"),
                    required: i.get("isRequired").and_then(Value::as_bool).unwrap_or(false),
                    secret: i.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
                    description: text(i, "description").unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A value that is complete as written: no `{variable}` left to fill.
fn plain(v: &str) -> bool {
    !v.contains('{') && !v.contains('}')
}

/// What was chosen of a server, and what it means for the plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chosen {
    /// The connector spec; `None` for a bundle, whose command is known only once it is unpacked.
    pub spec: Option<ServerSpec>,
    /// What the pin is made of (`None`: not installable).
    pub pin: Option<Pin>,
    /// What it reaches.
    pub hosts: HostList,
    /// The keys it needs.
    pub secrets: Vec<SecretNeed>,
    /// Required values with nothing to fill them, by name.
    pub unfilled: Vec<String>,
    /// For a bundle: where to download it and the digest the registry gives.
    pub bundle: Option<Bundle>,
    /// Remote, package or bundle, in words for the review.
    pub how: String,
}

/// A bundle to download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bundle {
    /// The https address of the `.mcpb`.
    pub url: String,
    /// Its SHA-256, which the host checks before it opens the file.
    pub sha256: String,
}

/// The name a server is installed under: the part after the namespace, lowercased, anything else a hyphen, within the
/// connector name rules.
#[must_use]
pub fn install_name(registry_name: &str) -> String {
    let leaf = registry_name.rsplit('/').next().unwrap_or(registry_name);
    let mut out = String::new();
    for c in leaf.chars() {
        let c = c.to_ascii_lowercase();
        let c = if c.is_ascii_alphanumeric() || c == '_' { c } else { '-' };
        if c == '-' && (out.ends_with('-') || out.is_empty()) {
            continue;
        }
        out.push(c);
    }
    let mut out: String = out.trim_matches('-').chars().take(validate::MAX_NAME).collect();
    if out.is_empty() || !out.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        out = format!("mcp-{out}").trim_end_matches('-').to_owned();
    }
    out
}

fn field_of(name: &str, taken: &[SpecSecret]) -> String {
    let mut f: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    if f.is_empty() || !f.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        f = format!("k{f}");
    }
    let base = f.clone();
    let mut n = 2;
    while taken.iter().any(|s| s.field == f) {
        f = format!("{base}_{n}");
        n += 1;
    }
    f
}

fn title_of(i: &Input) -> String {
    let t = i.description.split(['.', '\n']).next().unwrap_or("").trim();
    if t.is_empty() || t.len() > 80 { i.name.clone() } else { t.to_owned() }
}

fn exact_version(v: &str) -> bool {
    !v.is_empty()
        && v != "latest"
        && !v.contains(['^', '~', '*', '>', '<', '=', ' ', '|', 'x'].as_ref())
        && v.chars().next().is_some_and(|c| c.is_ascii_digit())
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(str::to_owned)
}

/// Choose how to run `server` (a `server.json`): a remote first (nothing runs here), then the first package boopis can run
/// that is pinned, then the first it can run at all. `Err` says why nothing can be run.
///
/// # Errors
/// The reason, in words, when the entry has no remote or package boopis can use.
pub fn choose(server: &Value) -> Result<Chosen, String> {
    let name = text(server, "name").ok_or("no name")?;
    let title = text(server, "title").unwrap_or_else(|| name.clone());
    let mut candidates: Vec<Chosen> = Vec::new();
    for r in server.get("remotes").and_then(Value::as_array).into_iter().flatten() {
        if let Some(c) = remote(&name, &title, r) {
            candidates.push(c);
        }
    }
    for p in server.get("packages").and_then(Value::as_array).into_iter().flatten() {
        if let Some(c) = package(&name, &title, p, server) {
            candidates.push(c);
        }
    }
    candidates
        .iter()
        .position(|c| c.pin.is_some())
        .map(|i| candidates.swap_remove(i))
        .or_else(|| candidates.into_iter().next())
        .ok_or_else(|| "it lists no remote address or package type boopis can run (npm, PyPI, OCI and bundles)".to_owned())
}

fn remote(name: &str, title: &str, r: &Value) -> Option<Chosen> {
    let kind = text(r, "type")?;
    let url = text(r, "url")?;
    if !(kind == "streamable-http" || kind == "sse") || !plain(&url) {
        return None;
    }
    let host = host_of(&url)?;
    let mut headers = Vec::new();
    let mut secrets: Vec<SpecSecret> = Vec::new();
    let mut needs = Vec::new();
    let mut unfilled = Vec::new();
    for h in inputs(r.get("headers")) {
        match (&h.value, h.secret) {
            (Some(v), false) if plain(v) => headers.push((h.name.clone(), v.clone())),
            (_, true) => {
                let field = field_of(&h.name, &secrets);
                needs.push(SecretNeed {
                    id: field.clone(),
                    title: title_of(&h),
                    env: None,
                    host: Some(host.clone()),
                    optional: !h.required,
                });
                secrets.push(SpecSecret {
                    field,
                    title: title_of(&h),
                    optional: !h.required,
                    target: SecretTarget::Header(h.name.clone()),
                });
            }
            _ => match h.default.as_ref().filter(|d| plain(d)) {
                Some(d) => headers.push((h.name.clone(), d.clone())),
                None if h.required => unfilled.push(h.name.clone()),
                None => {}
            },
        }
    }
    Some(Chosen {
        spec: Some(ServerSpec {
            name: install_name(name),
            title: title.to_owned(),
            transport: SpecTransport::Url { url: url.clone(), headers },
            secrets,
            pinned: None,
            reaches: host.clone(),
            rows: vec![(
                "Run by".into(),
                "its publisher: boopis cannot pin what a hosted server does, and it can change".into(),
            )],
            why: format!("{title}: the server at {host}, from the MCP Registry."),
        }),
        pin: None,
        hosts: HostList { basis: HostBasis::Declared, hosts: vec![host] },
        secrets: needs,
        unfilled,
        bundle: None,
        how: "a server somebody else runs".into(),
    })
    .map(|mut c| {
        // A hosted server has no digest. Its pin is the exact version the registry lists, which says what boopis reviewed and
        // what it will show; the review card says the server itself can change.
        c.pin = server_version_pin(r, &url);
        c
    })
}

fn server_version_pin(_r: &Value, url: &str) -> Option<Pin> {
    // The version comes from the server entry, which `remote` does not hold; `choose`'s caller sets it (see `with_version`).
    Some(Pin { kind: PinKind::Version, value: String::new(), repo: Some(format!("remote:{url}")) })
}

/// Fill the version of a remote's pin from the entry that holds it.
#[must_use]
pub fn with_version(mut c: Chosen, server: &Value) -> Chosen {
    if let Some(p) = c.pin.as_mut()
        && p.kind == PinKind::Version
        && p.value.is_empty()
    {
        match text(server, "version").filter(|v| !v.is_empty()) {
            Some(v) => p.value = v,
            None => c.pin = None,
        }
    }
    c
}

fn package(name: &str, title: &str, p: &Value, server: &Value) -> Option<Chosen> {
    let kind = text(p, "registryType")?;
    let id = text(p, "identifier")?;
    let version = text(p, "version").unwrap_or_default();
    if p.pointer("/transport/type").and_then(Value::as_str) != Some("stdio") {
        return None;
    }
    let mut env = Vec::new();
    let mut secrets: Vec<SpecSecret> = Vec::new();
    let mut needs = Vec::new();
    let mut unfilled = Vec::new();
    let mut env_names = Vec::new();
    for e in inputs(p.get("environmentVariables")) {
        env_names.push(e.name.clone());
        if e.secret {
            let field = field_of(&e.name, &secrets);
            needs.push(SecretNeed {
                id: field.clone(),
                title: title_of(&e),
                env: Some(e.name.clone()),
                host: None,
                optional: !e.required,
            });
            secrets.push(SpecSecret {
                field,
                title: title_of(&e),
                optional: !e.required,
                target: SecretTarget::Env(e.name.clone()),
            });
            continue;
        }
        match (&e.value, &e.default) {
            (Some(v), _) | (None, Some(v)) if plain(v) => env.push((e.name.clone(), v.clone())),
            _ if e.required => unfilled.push(e.name.clone()),
            _ => {}
        }
    }
    let mut args = Vec::new();
    for a in inputs(p.get("packageArguments")) {
        let fixed = a.value.clone().or_else(|| a.default.clone()).filter(|v| plain(v));
        let is_named = a.name.starts_with('-');
        match fixed {
            Some(v) if is_named => args.push(format!("{}={v}", a.name)),
            Some(v) => args.push(v),
            None if a.required => unfilled.push(if a.name.is_empty() { "an argument".into() } else { a.name.clone() }),
            None => {}
        }
    }
    let version_pin = |repo: String| {
        exact_version(&version).then(|| Pin { kind: PinKind::Version, value: version.clone(), repo: Some(repo) })
    };
    let (command, mut full, pin, pinned_text, bundle) = match kind.as_str() {
        "npm" => (
            "npx".to_owned(),
            vec!["-y".to_owned(), format!("{id}@{version}")],
            version_pin(format!("npm:{id}")),
            Some(format!("{id}@{version}")),
            None,
        ),
        "pypi" => (
            "uvx".to_owned(),
            vec![format!("{id}=={version}")],
            version_pin(format!("pypi:{id}")),
            Some(format!("{id}=={version}")),
            None,
        ),
        "oci" => {
            let mut a: Vec<String> = ["run", "-i", "--rm"].map(str::to_owned).to_vec();
            for n in &env_names {
                a.push("-e".into());
                a.push(n.clone());
            }
            a.push(id.clone());
            let digest = id.split_once("@sha256:").map(|(_, d)| format!("sha256:{d}"));
            (
                "docker".to_owned(),
                a,
                digest.map(|d| Pin { kind: PinKind::OciDigest, value: d, repo: Some(id.clone()) }),
                Some(id.clone()),
                None,
            )
        }
        "mcpb" => {
            let sha = text(p, "fileSha256").filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()));
            let url = id.clone();
            let ok = url.starts_with("https://");
            let pin = sha
                .clone()
                .filter(|_| ok)
                .map(|s| Pin { kind: PinKind::ArchiveSha256, value: s.to_ascii_lowercase(), repo: Some(url.clone()) });
            return Some(Chosen {
                spec: None,
                hosts: HostList { basis: HostBasis::Unknown, hosts: vec![] },
                secrets: needs,
                unfilled,
                bundle: sha.filter(|_| ok).map(|s| Bundle { url, sha256: s.to_ascii_lowercase() }),
                pin,
                how: "a bundle that runs on this computer".into(),
            });
        }
        _ => return None,
    };
    full.extend(args);
    Some(Chosen {
        spec: Some(ServerSpec {
            name: install_name(name),
            title: title.to_owned(),
            transport: SpecTransport::Command { command, args: full, env },
            secrets,
            pinned: pinned_text.filter(|_| pin.is_some()),
            reaches: "Not known: it is a program on this computer, run as you. boopis cannot say what it connects to".into(),
            rows: Vec::new(),
            why: format!("{title}: a {kind} package, from the MCP Registry."),
        }),
        pin,
        hosts: HostList { basis: HostBasis::Unknown, hosts: vec![] },
        secrets: needs,
        unfilled,
        bundle,
        how: format!("a {kind} package that runs on this computer"),
    })
    .map(|c| with_version(c, server))
}

/// [`choose`], with a remote's pin filled in.
///
/// # Errors
/// As [`choose`].
pub fn pick(server: &Value) -> Result<Chosen, String> {
    choose(server).map(|c| with_version(c, server))
}

// ---------------------------------------------------------------- bundles

fn platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// A bundle's `manifest.json` as a [`ServerSpec`], with `dir` (where the host unpacked it) substituted for `${__dirname}`.
/// `${user_config.KEY}` becomes a key when the manifest says it is sensitive and an environment value is exactly that; a
/// value boopis cannot ask for is `unfilled`.
///
/// # Errors
/// The reason, in words.
pub fn bundle_spec(manifest: &Value, dir: &Path, install: &str) -> Result<(ServerSpec, Vec<String>), String> {
    let name = text(manifest, "name").ok_or("the manifest has no name")?;
    let title = text(manifest, "display_name").unwrap_or_else(|| name.clone());
    let server = manifest.get("server").ok_or("the manifest has no server")?;
    let kind = text(server, "type").unwrap_or_default();
    if !matches!(kind.as_str(), "node" | "python" | "binary") {
        return Err(format!("a {kind:?} bundle is not one boopis runs yet (node, python and binary are)"));
    }
    let mut cfg = server.get("mcp_config").cloned().ok_or("the manifest has no mcp_config")?;
    if let Some(over) = cfg.get("platform_overrides").and_then(|o| o.get(platform())).cloned()
        && let (Some(base), Some(add)) = (cfg.as_object_mut(), over.as_object())
    {
        for (k, v) in add {
            base.insert(k.clone(), v.clone());
        }
    }
    let here = dir.to_string_lossy();
    let sub = |s: &str| s.replace("${__dirname}", &here);
    let command = sub(&text(&cfg, "command").ok_or("the manifest has no command")?);
    let mut unfilled = Vec::new();
    let mut args = Vec::new();
    for a in cfg.get("args").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        let a = sub(a);
        if a.contains("${") {
            unfilled.push(a);
        } else {
            args.push(a);
        }
    }
    let user_config = manifest.get("user_config").cloned().unwrap_or(Value::Null);
    let mut env = Vec::new();
    let mut secrets: Vec<SpecSecret> = Vec::new();
    if let Some(map) = cfg.get("env").and_then(Value::as_object) {
        for (k, v) in map {
            let v = sub(v.as_str().unwrap_or_default());
            if let Some(key) = v.strip_prefix("${user_config.").and_then(|r| r.strip_suffix('}')) {
                let def = user_config.get(key);
                if def.and_then(|d| d.get("sensitive")).and_then(Value::as_bool) == Some(true) {
                    let field = field_of(k, &secrets);
                    secrets.push(SpecSecret {
                        field,
                        title: def.and_then(|d| text(d, "title")).unwrap_or_else(|| k.clone()),
                        optional: def.and_then(|d| d.get("required")).and_then(Value::as_bool) != Some(true),
                        target: SecretTarget::Env(k.clone()),
                    });
                } else {
                    unfilled.push(k.clone());
                }
            } else if v.contains("${") {
                unfilled.push(k.clone());
            } else {
                env.push((k.clone(), v));
            }
        }
    }
    let spec = ServerSpec {
        name: install.to_owned(),
        title,
        transport: SpecTransport::Command { command, args, env },
        secrets,
        pinned: None,
        reaches: "Not known: it is a program on this computer, run as you. boopis cannot say what it connects to".into(),
        rows: vec![("Unpacked to".into(), here.into_owned())],
        why: "An MCP bundle: a program and its files, unpacked on this computer.".into(),
    };
    Ok((spec, unfilled))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn names_are_made_from_the_part_after_the_namespace() {
        assert_eq!(install_name("io.github.user/My Server!"), "my-server");
        assert_eq!(install_name("com.example/tickets"), "tickets");
        assert_eq!(install_name("ai.x/-weird--name-"), "weird-name");
        assert_eq!(install_name("a.b/").is_empty(), false);
        for n in [install_name("io.github.0x/Ünïcode"), install_name("a/b_c")] {
            validate::name(&n).unwrap();
        }
    }

    #[test]
    fn an_npm_package_becomes_npx_at_an_exact_version_and_its_secret_a_key() {
        let s = json!({"name":"com.example/tickets","version":"0.4.2","description":"d","packages":[
            {"registryType":"npm","identifier":"@example/tickets-mcp","version":"0.4.2","transport":{"type":"stdio"},
             "environmentVariables":[{"name":"TICKETS_TOKEN","isSecret":true,"isRequired":true,"description":"Your token. More."},
                                     {"name":"TICKETS_REGION","default":"eu"}]}]});
        let c = pick(&s).unwrap();
        let spec = c.spec.unwrap();
        assert_eq!(
            spec.transport,
            SpecTransport::Command {
                command: "npx".into(),
                args: vec!["-y".into(), "@example/tickets-mcp@0.4.2".into()],
                env: vec![("TICKETS_REGION".into(), "eu".into())],
            }
        );
        assert_eq!(c.pin.unwrap().repo.as_deref(), Some("npm:@example/tickets-mcp"));
        assert_eq!(c.secrets[0].id, "tickets_token");
        assert_eq!(c.secrets[0].title, "Your token");
        assert_eq!(c.hosts.basis, HostBasis::Unknown);
    }

    #[test]
    fn a_range_or_latest_is_not_a_pin() {
        for v in ["latest", "^1.2.0", "1.x", ">=1", ""] {
            let s = json!({"name":"a/b","version":"1","packages":[{"registryType":"npm","identifier":"p","version":v,"transport":{"type":"stdio"}}]});
            assert!(pick(&s).unwrap().pin.is_none(), "{v}");
        }
    }

    #[test]
    fn a_remote_is_a_url_with_its_host_declared_and_an_authorization_key() {
        let s = json!({"name":"ai.x/hosted","version":"2.0.1","remotes":[
            {"type":"streamable-http","url":"https://api.x.ai/mcp","headers":[{"name":"Authorization","isSecret":true,"isRequired":true}]}]});
        let c = pick(&s).unwrap();
        assert_eq!(c.hosts, HostList { basis: HostBasis::Declared, hosts: vec!["api.x.ai".into()] });
        let pin = c.pin.unwrap();
        assert_eq!((pin.kind, pin.value.as_str()), (PinKind::Version, "2.0.1"));
        let spec = c.spec.unwrap();
        assert_eq!(spec.secrets[0].target, SecretTarget::Header("Authorization".into()));
        let plan = crate::connectors::plan::build_server(&spec, None).unwrap();
        assert_eq!(plan.config["headers"]["Authorization"].as_str().unwrap().starts_with("Bearer ${BOOPIS_CONNECTOR_"), true);
    }

    #[test]
    fn a_remote_with_a_template_in_its_address_is_skipped_and_a_package_is_used() {
        let s = json!({"name":"a/b","version":"1.0.0",
            "remotes":[{"type":"streamable-http","url":"https://{tenant}.example.com/mcp"}],
            "packages":[{"registryType":"pypi","identifier":"b-mcp","version":"1.0.0","transport":{"type":"stdio"}}]});
        let c = pick(&s).unwrap();
        assert_eq!(c.spec.unwrap().pinned.as_deref(), Some("b-mcp==1.0.0"));
    }

    #[test]
    fn a_required_value_with_nothing_to_fill_it_is_listed_never_invented() {
        let s = json!({"name":"a/b","version":"1.0.0","packages":[{"registryType":"npm","identifier":"p","version":"1.0.0","transport":{"type":"stdio"},
            "environmentVariables":[{"name":"ROOT_DIR","isRequired":true}],
            "packageArguments":[{"type":"named","name":"--mode","value":"safe"},{"type":"positional","valueHint":"path","isRequired":true}]}]});
        let c = pick(&s).unwrap();
        assert_eq!(c.unfilled, vec!["ROOT_DIR".to_owned(), "an argument".to_owned()]);
        let SpecTransport::Command { args, .. } = c.spec.unwrap().transport else { panic!() };
        assert_eq!(args.last().unwrap(), "--mode=safe");
    }

    #[test]
    fn an_image_is_pinned_only_by_a_digest_and_a_bundle_only_by_its_file_hash() {
        let sha = "a".repeat(64);
        let oci = |id: &str| json!({"name":"a/b","version":"1","packages":[{"registryType":"oci","identifier":id,"version":"1","transport":{"type":"stdio"}}]});
        assert!(pick(&oci("ghcr.io/x/y:1")).unwrap().pin.is_none());
        let c = pick(&oci(&format!("ghcr.io/x/y@sha256:{sha}"))).unwrap();
        assert_eq!(c.pin.unwrap().kind, PinKind::OciDigest);
        let b = json!({"name":"a/b","version":"1","packages":[{"registryType":"mcpb","identifier":"https://github.com/x/mcp/releases/download/v1/x.mcpb","fileSha256":sha,"transport":{"type":"stdio"}}]});
        let c = pick(&b).unwrap();
        assert_eq!(c.bundle.unwrap().sha256, sha);
        assert_eq!(c.pin.unwrap().kind, PinKind::ArchiveSha256);
        let no_hash = json!({"name":"a/b","version":"1","packages":[{"registryType":"mcpb","identifier":"https://x.example/x.mcpb","transport":{"type":"stdio"}}]});
        let c = pick(&no_hash).unwrap();
        assert!(c.pin.is_none() && c.bundle.is_none());
    }

    #[test]
    fn nothing_runnable_says_why() {
        let s = json!({"name":"a/b","version":"1","packages":[{"registryType":"nuget","identifier":"X","version":"1","transport":{"type":"stdio"}}]});
        assert!(pick(&s).unwrap_err().contains("npm, PyPI"));
    }

    #[test]
    fn a_bundle_manifest_becomes_a_command_inside_its_folder() {
        let m = json!({"name":"x","display_name":"X","server":{"type":"node","entry_point":"server/index.js",
            "mcp_config":{"command":"node","args":["${__dirname}/server/index.js"],"env":{"API_KEY":"${user_config.api_key}","MODE":"${user_config.mode}","FIXED":"1"}}},
            "user_config":{"api_key":{"type":"string","sensitive":true,"required":true,"title":"API key"},"mode":{"type":"string"}}});
        let (spec, unfilled) = bundle_spec(&m, Path::new("/data/store/bundles/ab"), "x").unwrap();
        assert_eq!(unfilled, vec!["MODE".to_owned()]);
        assert_eq!(spec.secrets[0].title, "API key");
        let SpecTransport::Command { command, args, env } = spec.transport else { panic!() };
        assert_eq!((command.as_str(), args[0].as_str()), ("node", "/data/store/bundles/ab/server/index.js"));
        assert_eq!(env, vec![("FIXED".to_owned(), "1".to_owned())]);
        assert!(bundle_spec(&json!({"name":"x","server":{"type":"uv","mcp_config":{"command":"uv"}}}), Path::new("/d"), "x").is_err());
    }
}
