//! `boopis connect`: how to dial the engine's own gateway, for a client that talks to it directly (`docs/LOCAL-API.md`).
//!
//! It runs as the owner, in their terminal, before any window. It reads what the gateway's control socket says of itself and
//! prints the address, the protocol names and which profile homes are served by which gateway. **Without `--ticket` it
//! prints no credential at all** (safe to log). With `--ticket` it mints one single-use ticket (30 seconds) through the same
//! control socket any process of the owner can use, and prints it to this process's output and nowhere else: never to a log,
//! a file or a setting.
//!
//! Exit codes: 0 done, 1 the engine could not be reached or refused, 2 a usage error.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::config::Limits;
use crate::hermes::attach::{self, PROTOCOL};
use crate::hermes::control::{self, Identify};
use crate::hermes::{Environment, Supervisor};
use crate::runtime;

/// What the arguments ask for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Options {
    /// The profile whose link to describe; `default` is the root.
    pub profile: String,
    /// Print JSON.
    pub json: bool,
    /// Mint and print a ticket.
    pub ticket: bool,
    /// Start the engine when it is not running.
    pub start: bool,
    /// `--help`.
    pub help: bool,
}

/// Read `connect`'s arguments (without the word itself).
///
/// # Errors
/// A sentence for anything that is not an option of `connect`.
pub fn parse(args: &[String]) -> Result<Options, String> {
    let mut o = Options { profile: "default".into(), ..Options::default() };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => o.json = true,
            "--ticket" => o.ticket = true,
            "--start" => o.start = true,
            "--help" | "-h" => o.help = true,
            "--profile" => {
                o.profile = it.next().cloned().ok_or("--profile needs a name")?;
            }
            other if other.starts_with("--profile=") => o.profile = other["--profile=".len()..].to_owned(),
            other => return Err(format!("{other} is not an option of connect")),
        }
    }
    let ok = o.profile == "default"
        || (!o.profile.is_empty()
            && o.profile.len() <= 64
            && o.profile.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_'));
    if !ok {
        return Err(format!("{:?} is not a profile name ([a-z0-9_-], up to 64)", o.profile));
    }
    Ok(o)
}

/// The usage text.
#[must_use]
pub fn usage() -> &'static str {
    "boopis connect [--profile NAME] [--json] [--ticket] [--start]\n\n\
     Say how to dial the engine's gateway as the owner: the address, the protocol, and which profile homes are served by\n\
     which gateway. With no --ticket nothing printed is a credential. --ticket mints one single-use ticket (30 seconds)\n\
     and prints it to this output only. --start starts the engine when it is not running. See docs/LOCAL-API.md."
}

/// What the control socket said, reduced to what the report needs.
#[derive(Debug, Clone)]
pub struct Facts {
    /// The root home.
    pub root: PathBuf,
    /// The home of the profile asked for.
    pub profile_home: PathBuf,
    /// What the root's gateway said of itself.
    pub root_identity: Identify,
    /// What the profile home's own socket said, when one answers (`None`: there is none).
    pub own_identity: Option<Identify>,
}

/// The report, without any credential.
#[must_use]
pub fn report(o: &Options, f: &Facts) -> Value {
    let served: Vec<String> = f
        .root_identity
        .served_profiles
        .iter()
        .map(|p| p.home.clone().unwrap_or_else(|| p.profile_id.clone()))
        .collect();
    let in_root = f.profile_home == f.root
        || served.iter().any(|h| Path::new(h) == f.profile_home)
        || (f.root_identity.served_profiles.len() == 1 && f.profile_home == f.root);
    let own = f.own_identity.as_ref().is_some_and(|i| {
        i.endpoint.instance_id.is_some() && i.endpoint.instance_id != f.root_identity.endpoint.instance_id
    });
    let url = f
        .root_identity
        .endpoint
        .api_origin
        .as_deref()
        .and_then(|o| attach::ws_url_for_origin(o).ok())
        .map(|u| u.to_string());
    json!({
        "version": super::model::API_VERSION,
        "profile": o.profile,
        "url": url,
        "protocols": [PROTOCOL],
        "ticket": null,
        "ticket_how": "Ask the control socket for one (verbs identify and session-ticket, docs/LOCAL-API.md), or run this command with --ticket.",
        "gateway": {
            "state": f.root_identity.state,
            "instance_id": f.root_identity.endpoint.instance_id,
            "capabilities": f.root_identity.endpoint.capabilities,
            "root_home": f.root,
            "profile_home": f.profile_home,
            "control_socket": f.root.join("gateway.sock"),
            "serves_profile_homes": served,
            "this_profile_is_served_by_the_root_gateway": in_root,
            "this_profile_has_its_own_gateway": own,
        },
        "client": {
            "label_session_with": {"client": {"name": "<your-client-name>", "version": "<optional>"}},
            "note": "session.create takes client {name, version}; the engine keeps it and boopis shows it. `source` is a closed list.",
        },
        "docs": "docs/LOCAL-API.md",
    })
}

/// The same report with a ticket in it (`--ticket`).
#[must_use]
pub fn with_ticket(mut report: Value, ticket: &attach::Ticket) -> Value {
    report["protocols"] = json!(ticket.subprotocols());
    report["ticket"] = json!("in protocols");
    report["ticket_expires_in_seconds"] = json!(30);
    report["ticket_how"] = Value::Null;
    report
}

/// Plain text for a person.
#[must_use]
pub fn plain(report: &Value) -> Vec<String> {
    let g = &report["gateway"];
    let mut lines = vec![
        format!("profile   {}", report["profile"].as_str().unwrap_or("default")),
        format!("url       {}", report["url"].as_str().unwrap_or("(no gateway is running)")),
        format!("protocol  {}", report["protocols"][0].as_str().unwrap_or(PROTOCOL)),
        format!("gateway   {}", g["state"].as_str().unwrap_or("unknown")),
        format!(
            "homes     {}",
            if g["this_profile_has_its_own_gateway"] == true {
                "this profile has its own gateway"
            } else if g["this_profile_is_served_by_the_root_gateway"] == true {
                "this profile is served by the root gateway"
            } else {
                "this profile is not served by a running gateway"
            }
        ),
    ];
    if report["ticket"].is_null() {
        lines.push("ticket    none printed (run with --ticket for one single-use ticket)".into());
    } else if let Some(p) = report["protocols"].as_array() {
        for p in p.iter().filter_map(Value::as_str) {
            lines.push(format!("protocol  {p}"));
        }
    }
    lines
}

fn supervisor(resource_dir: Option<&Path>) -> Supervisor {
    let data = dirs::data_dir().map(|d| d.join(crate::gpu::APP_IDENTIFIER));
    let source = runtime::Source::from_process();
    let (plan, _) = runtime::plan_for(source, resource_dir, data.ok_or_else(|| "no data folder".to_owned()));
    let mut env = Environment::from_process();
    if let Some(plan) = &plan {
        env = env.with_bundled(plan.bundled());
    }
    Supervisor::new(env, Limits::default())
}

async fn gather(sup: &Supervisor, o: &Options) -> Result<(Facts, Option<attach::Ticket>), String> {
    let env = sup.environment();
    let root = env.hermes_root();
    let profile_home = env.profile_home(Some(&o.profile)).map_err(|e| e.to_string())?;
    if o.start {
        sup.ensure_if_needed(&root).await.map_err(|e| e.to_string())?;
    }
    let root_identity = control::identify(&root)
        .await
        .map_err(|_| "No engine is running. Start boopis, or run this with --start.".to_owned())?;
    if root_identity.state != "ready" {
        return Err(format!("The engine is {}, not ready.", root_identity.state));
    }
    let own_identity = if profile_home == root { None } else { control::identify(&profile_home).await.ok() };
    let ticket = if o.ticket {
        let home = if own_identity.is_some() { &profile_home } else { &root };
        let identity = own_identity.as_ref().unwrap_or(&root_identity);
        let id = identity
            .profile_id_for(&profile_home)
            .or_else(|| identity.profile_id_for(home))
            .ok_or_else(|| "The gateway does not serve that profile.".to_owned())?
            .to_owned();
        let raw = control::session_ticket(home, identity, &id).await.map_err(|e| e.to_string())?;
        Some(attach::Ticket::new(&raw).map_err(|e| e.to_string())?)
    } else {
        None
    };
    Ok((Facts { root, profile_home, root_identity, own_identity }, ticket))
}

/// Run `boopis connect`. Returns the exit code.
pub fn run(args: &[String], resource_dir: &dyn Fn() -> Option<PathBuf>) -> i32 {
    let o = match parse(args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("boopis connect: {e}. Try boopis connect --help.");
            return 2;
        }
    };
    if o.help {
        println!("{}", usage());
        return 0;
    }
    let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        eprintln!("boopis connect: could not start.");
        return 1;
    };
    let sup = supervisor(resource_dir().as_deref());
    match rt.block_on(gather(&sup, &o)) {
        Ok((facts, ticket)) => {
            let mut r = report(&o, &facts);
            if let Some(t) = &ticket {
                r = with_ticket(r, t);
            }
            if o.json {
                println!("{r}");
            } else {
                println!("{}", plain(&r).join("\n"));
            }
            0
        }
        Err(e) => {
            if o.json {
                println!("{}", json!({"error": {"code": "engine_unavailable", "message": e}}));
            } else {
                eprintln!("boopis connect: {e}");
            }
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(args: &[&str]) -> Result<Options, String> {
        parse(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn the_options_are_read_and_a_bad_one_is_a_sentence() {
        let o = opts(&["--json", "--profile", "kai", "--ticket"]).unwrap();
        assert_eq!((o.json, o.ticket, o.profile.as_str()), (true, true, "kai"));
        assert_eq!(opts(&[]).unwrap().profile, "default");
        assert_eq!(opts(&["--profile=nina"]).unwrap().profile, "nina");
        for bad in [vec!["--nope"], vec!["--profile"], vec!["--profile", "../x"], vec!["--profile", "A b"]] {
            assert!(opts(&bad).is_err(), "{bad:?}");
        }
    }

    fn identity(json: &str) -> Identify {
        serde_json::from_str(json).unwrap()
    }

    fn facts(profile: &str, own: Option<Identify>) -> Facts {
        let root = PathBuf::from("/data/engine");
        Facts {
            profile_home: if profile == "default" { root.clone() } else { root.join("profiles").join(profile) },
            root,
            root_identity: identity(
                r#"{"state":"ready","api_origin":"http://127.0.0.1:56079","instance_id":"i-root","capabilities":["event-replay-v1"],"served_profiles":[{"profile_id":"/data/engine","home":"/data/engine"},{"profile_id":"/data/engine/profiles/kai","home":"/data/engine/profiles/kai"}]}"#,
            ),
            own_identity: own,
        }
    }

    #[test]
    fn the_report_has_the_address_the_protocol_and_which_gateway_serves_which_home_and_no_credential() {
        let o = opts(&["--json", "--profile", "kai"]).unwrap();
        let r = report(&o, &facts("kai", None));
        assert_eq!(r["url"], "ws://127.0.0.1:56079/api/ws");
        assert_eq!(r["protocols"], json!([PROTOCOL]));
        assert_eq!(r["gateway"]["this_profile_is_served_by_the_root_gateway"], true);
        assert_eq!(r["gateway"]["this_profile_has_its_own_gateway"], false);
        assert!(r["ticket"].is_null());
        let text = r.to_string();
        assert!(!text.contains("hermes-gateway-ticket"), "no ticket unless it was asked for");
        let own = identity(r#"{"state":"ready","instance_id":"i-kai","api_origin":"http://127.0.0.1:56080"}"#);
        let r = report(&o, &facts("kai", Some(own)));
        assert_eq!(r["gateway"]["this_profile_has_its_own_gateway"], true);
    }

    #[test]
    fn a_ticket_is_in_the_output_only_when_asked_for_and_says_how_long_it_lives() {
        let o = opts(&["--json", "--ticket"]).unwrap();
        let ticket = attach::Ticket::new("AbCdEf0123-_xyz").unwrap();
        let r = with_ticket(report(&o, &facts("default", None)), &ticket);
        assert_eq!(r["protocols"][0], PROTOCOL);
        assert_eq!(r["protocols"][1], "hermes-gateway-ticket.AbCdEf0123-_xyz");
        assert_eq!(r["ticket_expires_in_seconds"], 30);
        let lines = plain(&r).join("\n");
        assert!(lines.contains("hermes-gateway-ticket."), "{lines}");
        let none = plain(&report(&o, &facts("default", None))).join("\n");
        assert!(!none.contains("hermes-gateway-ticket") && none.contains("--ticket"), "{none}");
    }
}
