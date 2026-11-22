//! The live probe: every sign-in and key check the host runs, against the real services, up to the step that needs a person.
//! Ignored by default, because it calls real services:
//!
//! ```sh
//! cargo test -p boopis-host --test live_signins -- --ignored --nocapture
//! ```
//!
//! `.github/workflows/live-signins.yml` runs it on Linux, Windows and macOS, on demand and every week.
//!
//! - **No account and nothing saved.** Each sign-in stops where a person would type a code or sign in; each key check sends a
//!   key no provider issued. Nothing touches the keychain or the engine.
//! - **The app's own code**, not a copy: the same transports, the same wire functions and the same mapping to what the card says.
//!   rustls's process default is never installed here, so the TLS rows prove that each HTTPS agent names its own provider.
//! - **Every message a person would read is checked for plain words** ([`raw_words`]): no panic, no transport error, no status
//!   number, no JSON.
//! - **Results**: `pass`; `fail` (boopis's flow is broken; the test fails); `blocked` (something between this machine and the
//!   service refused: a proxy, a firewall or a bot check; shown with what it said, and not counted as boopis's failure).
//!   The table goes to standard output, to `$GITHUB_STEP_SUMMARY` on GitHub Actions, and as JSON lines to `$HX_LIVE_REPORT`
//!   (one row per line: `platform`, `service`, `step`, `result`, `note`), which `scripts/live-table.py` merges across platforms.
//! - The Claude subscription runs on the Claude Code program, not on a host sign-in: it has no row here.

#![allow(clippy::expect_used, clippy::too_many_lines)] // a test: failing loudly is the point

use std::fmt::Write as _;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Duration;

use boopis_host::chatgpt::oauth as chatgpt;
use boopis_host::chatgpt::oauth::Transport as _;
use boopis_host::copilot::oauth as copilot;
use boopis_host::error::HostError;
use boopis_host::providers::check::KeyCheck;
use boopis_host::providers::endpoint::EndpointOutcome;
use boopis_host::providers::http::{self, Address, Transport as _};
use boopis_host::providers::service::{check_way_key, key_state};
use boopis_host::providers::{ApiMode, ProviderStatus, WayKind, catalogue};
use boopis_host::xai::oauth as xai;

/// A key no provider issues: long enough and shaped enough that a format check passes it to the key check.
const BAD_KEY: &str = "sk-boopis-live-probe-0000000000000000000000000000";
/// The timeout of one request here.
const TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Pass,
    Fail,
    Blocked,
}

impl Verdict {
    const fn word(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Fail => "fail",
            Self::Blocked => "blocked",
        }
    }
}

struct Row {
    service: String,
    step: String,
    verdict: Verdict,
    note: String,
}

#[derive(Default)]
struct Probe {
    rows: Vec<Row>,
}

impl Probe {
    /// Run one check; a panic inside it is a failure with the panic's text, never the end of the probe.
    fn check(&mut self, service: &str, step: &str, f: impl FnOnce() -> (Verdict, String)) {
        let (verdict, note) = match catch_unwind(AssertUnwindSafe(f)) {
            Ok(v) => v,
            Err(p) => (
                Verdict::Fail,
                format!(
                    "panicked: {}",
                    panic_text(p.as_ref()).lines().next().unwrap_or("")
                ),
            ),
        };
        println!("{:<8} {service} | {step} | {note}", verdict.word());
        self.rows.push(Row {
            service: service.to_owned(),
            step: step.to_owned(),
            verdict,
            note,
        });
    }
}

fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic with no message".to_owned())
}

fn platform() -> String {
    std::env::var("HX_LIVE_PLATFORM").unwrap_or_else(|_| std::env::consts::OS.to_owned())
}

/// Whatever in `text` a person should never read: what a panic, a transport, a parser or a server says. Empty when the text is plain.
fn raw_words(text: &str) -> Vec<&'static str> {
    const RAW: &[&str] = &[
        "panicked",
        "CryptoProvider",
        "i/o:",
        "io:",
        "os error",
        "error sending",
        "Connection refused",
        "dns error",
        "tls",
        "rustls",
        "ureq",
        "HTTP ",
        "answered 4",
        "answered 5",
        "{",
        "}",
        "\\n",
        "invalid_",
        "JoinError",
        "hermes",
        "Hermes",
    ];
    RAW.iter().copied().filter(|w| text.contains(w)).collect()
}

fn plain_or_fail(text: &str) -> Option<(Verdict, String)> {
    let raw = raw_words(text);
    (!raw.is_empty()).then(|| {
        (
            Verdict::Fail,
            format!("the message is not plain ({}): {text}", raw.join(", ")),
        )
    })
}

/// What a person reads for an error: the host's one mapper.
fn shown(e: boopis_host::error::Error) -> (String, String) {
    let h: HostError = e.into();
    (h.code, h.message)
}

/// When something between here and the service refused (a proxy, a firewall, a bot check), what it said; `None` for an answer
/// from the service itself.
fn blocked_by(status: u16, body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    if matches!(status, 403 | 429 | 503)
        && (lower.contains("cloudflare") || lower.contains("cf-chl"))
    {
        return Some(format!(
            "a Cloudflare check answered {status} (this network is challenged)"
        ));
    }
    if status == 407 {
        return Some("a proxy asked for credentials (407)".to_owned());
    }
    // a sandbox's proxy that answers for some hosts itself (the build machine's does for github.com)
    if lower.contains("docs.anthropic.com") {
        return Some(format!("a proxy answered {status} in place of the service"));
    }
    None
}

fn blocked_transport(e: &str) -> Option<String> {
    let lower = e.to_ascii_lowercase();
    (lower.contains("proxy") || lower.contains("407") || lower.contains("403 forbidden"))
        .then(|| format!("a proxy refused the connection: {e}"))
}

/// One raw request through the sign-ins' transport, to tell a refusal on the way from the service's own answer.
fn diagnose(t: &dyn chatgpt::Transport, url: &str, form: Option<&str>) -> Option<String> {
    let r = match form {
        Some(body) => t.post(url, "application/x-www-form-urlencoded", body),
        None => t.get(url, &[]),
    };
    match r {
        Ok(reply) => blocked_by(reply.status, &reply.body),
        Err(e) => blocked_transport(&e),
    }
}

// ---------------------------------------------------------------- TLS: one real HTTPS request through each agent

fn tls(p: &mut Probe) {
    p.check("TLS", "sign-ins' agent (ChatGPT, Copilot, xAI)", || {
        let t = chatgpt::Https::new(TIMEOUT);
        match t.get(
            "https://auth.openai.com/.well-known/openid-configuration",
            &[],
        ) {
            Ok(r) if r.status == 200 => (
                Verdict::Pass,
                "HTTPS to auth.openai.com answered 200".into(),
            ),
            Ok(r) => (
                blocked_by(r.status, &r.body).map_or(Verdict::Fail, |_| Verdict::Blocked),
                format!("auth.openai.com answered {}", r.status),
            ),
            Err(e) => (
                blocked_transport(&e).map_or(Verdict::Fail, |_| Verdict::Blocked),
                e,
            ),
        }
    });
    p.check("TLS", "provider checks' agent", || {
        let t = http::Https::new(TIMEOUT);
        match t.get("https://openrouter.ai/api/v1/models", &[]) {
            Ok(r) if r.status == 200 => {
                (Verdict::Pass, "HTTPS to openrouter.ai answered 200".into())
            }
            Ok(r) => (
                blocked_by(r.status, &r.body).map_or(Verdict::Fail, |_| Verdict::Blocked),
                format!("openrouter.ai answered {}", r.status),
            ),
            Err(e) => (
                blocked_transport(&e).map_or(Verdict::Fail, |_| Verdict::Blocked),
                e,
            ),
        }
    });
    p.check("TLS", "store's agent", || {
        use boopis_host::store::net::{Ask, Fetcher as _, Hosts, Https};
        let t = Https::new(&boopis_host::config::StoreLimits::default());
        let ask = Ask {
            max_bytes: 4 * 1024 * 1024,
            ..Ask::default()
        };
        match t.get(
            "https://registry.modelcontextprotocol.io/v0/servers?limit=1",
            &Hosts::new(&[]),
            &ask,
        ) {
            Ok(r) if r.status == 200 => (
                Verdict::Pass,
                "HTTPS to registry.modelcontextprotocol.io answered 200".into(),
            ),
            Ok(r) => (Verdict::Fail, format!("the registry answered {}", r.status)),
            Err(e) => (Verdict::Fail, e.to_string()),
        }
    });
}

// ---------------------------------------------------------------- ChatGPT (Sign in with ChatGPT, ADR-0030)

fn chatgpt_flow(p: &mut Probe) {
    let ep = chatgpt::Endpoints::openai();
    let redirect = format!(
        "http://127.0.0.1:{}{}",
        boopis_host::chatgpt::callback::PREFERRED_PORT,
        chatgpt::CALLBACK_PATH
    );
    let attempt = chatgpt::Attempt::new(redirect, chatgpt::new_host_id().expect("a host id"), None)
        .expect("an attempt");
    let t = chatgpt::Https::new(TIMEOUT);
    p.check("ChatGPT", "authorize page (first registration)", || {
        let url = chatgpt::authorize_url(&ep, &attempt, false);
        match t.get(&url, &[]) {
            // the page answers with OpenAI's sign-in (a redirect to log in, or the page itself)
            Ok(r) if matches!(r.status, 200 | 302 | 303) => (
                Verdict::Pass,
                format!("answered {} (on to OpenAI's sign-in page)", r.status),
            ),
            Ok(r) => match blocked_by(r.status, &r.body) {
                Some(b) => (Verdict::Blocked, b),
                None => (
                    Verdict::Fail,
                    format!(
                        "answered {}: {}",
                        r.status,
                        r.body.chars().take(160).collect::<String>()
                    ),
                ),
            },
            Err(e) => (
                blocked_transport(&e).map_or(Verdict::Fail, |_| Verdict::Blocked),
                e,
            ),
        }
    });
    p.check("ChatGPT", "token endpoint (a code that was never issued)", || {
        match chatgpt::exchange(&t, &ep, chatgpt::DYNAMIC_CLIENT, "boopis-live-probe", &attempt) {
            Ok(chatgpt::Exchange::Rejected) => (
                Verdict::Pass,
                "reachable; refused the made-up code as OpenAI documents (invalid_client or invalid_grant)".into(),
            ),
            Ok(chatgpt::Exchange::Tokens { .. }) => {
                (Verdict::Fail, "issued tokens for a made-up code".into())
            }
            Err(e) => {
                let (code, message) = shown(e);
                if let Some(b) = diagnose(&t, &format!("{}/api/accounts/oauth/token", ep.issuer()), Some("grant_type=authorization_code")) {
                    return (Verdict::Blocked, b);
                }
                plain_or_fail(&message).unwrap_or((Verdict::Fail, format!("{code}: {message}")))
            }
        }
    });
    p.check(
        "ChatGPT",
        "signing keys (ID token check)",
        || match chatgpt::signing_keys(&t, &ep) {
            Ok(keys) if !keys.is_empty() => {
                (Verdict::Pass, format!("{} RSA keys published", keys.len()))
            }
            Ok(_) => (Verdict::Fail, "OpenAI published no RSA key".into()),
            Err(e) => {
                let (code, message) = shown(e);
                (Verdict::Fail, format!("{code}: {message}"))
            }
        },
    );
}

// ---------------------------------------------------------------- GitHub Copilot (ADR-0039)

fn copilot_flow(p: &mut Probe) {
    let ep = copilot::Endpoints::github();
    let t = chatgpt::Https::new(TIMEOUT);
    let mut issued = None;
    p.check(
        "GitHub Copilot",
        "device code for boopis's client id",
        || match copilot::request_code(&t, &ep) {
            Ok(code) => {
                let note = format!(
                    "code issued ({} characters), page {}",
                    code.user_code.len(),
                    code.verification_url
                );
                issued = Some(code);
                (Verdict::Pass, note)
            }
            Err(e) => {
                let (code, message) = shown(e);
                if let Some(b) = diagnose(
                    &t,
                    "https://github.com/login/device/code",
                    Some("client_id=x"),
                ) {
                    return (Verdict::Blocked, b);
                }
                plain_or_fail(&message).unwrap_or((Verdict::Fail, format!("{code}: {message}")))
            }
        },
    );
    p.check("GitHub Copilot", "waiting for approval (one poll)", || {
        let Some(code) = issued.as_ref() else {
            return (
                Verdict::Blocked,
                "no code to poll with (the step before did not pass)".into(),
            );
        };
        std::thread::sleep(Duration::from_secs(code.interval));
        match copilot::poll(&t, &ep, code, code.interval) {
            Ok(copilot::Poll::Pending | copilot::Poll::SlowDown(_)) => {
                (Verdict::Pass, "GitHub is waiting for the person".into())
            }
            Ok(_) => (Verdict::Fail, "GitHub ended a code nobody typed".into()),
            Err(e) => {
                let (code, message) = shown(e);
                (Verdict::Fail, format!("{code}: {message}"))
            }
        }
    });
    p.check(
        "GitHub Copilot",
        "plan check with a token GitHub never issued",
        || match copilot::entitlement(&t, &ep, "gho_boopisliveprobe000000000000000000000") {
            Ok(copilot::Entitlement::No) => {
                (Verdict::Pass, "reachable; refused the made-up token".into())
            }
            Ok(copilot::Entitlement::Has) => {
                (Verdict::Fail, "granted Copilot to a made-up token".into())
            }
            Err(e) => {
                let (code, message) = shown(e);
                (Verdict::Fail, format!("{code}: {message}"))
            }
        },
    );
}

// ---------------------------------------------------------------- xAI SuperGrok (ADR-0039)

fn xai_flow(p: &mut Probe) {
    let ep = xai::Endpoints::xai();
    let t = chatgpt::Https::new(TIMEOUT);
    let mut issued = None;
    p.check("xAI", "sign-in's first step (device code)", || {
        match xai::request_code(&t, &ep) {
            Ok(code) => {
                let note = format!(
                    "code issued ({} characters), page on {}",
                    code.user_code.len(),
                    url::Url::parse(&code.verification_url)
                        .ok()
                        .and_then(|u| u.host_str().map(str::to_owned))
                        .unwrap_or_default()
                );
                issued = Some(code);
                (Verdict::Pass, note)
            }
            Err(e) => {
                let (code, message) = shown(e);
                if let Some(b) = diagnose(
                    &t,
                    &format!("{}/oauth2/device/code", xai::ISSUER),
                    Some("client_id=x"),
                ) {
                    // the person still gets plain words for it
                    return match plain_or_fail(&message) {
                        Some(f) => f,
                        None => (Verdict::Blocked, format!("{b}; the card says: {message}")),
                    };
                }
                plain_or_fail(&message).unwrap_or((Verdict::Fail, format!("{code}: {message}")))
            }
        }
    });
    p.check("xAI", "waiting for approval (one poll)", || {
        let Some(code) = issued.as_ref() else {
            return (
                Verdict::Blocked,
                "no code to poll with (the step before did not pass)".into(),
            );
        };
        std::thread::sleep(Duration::from_secs(code.interval));
        match xai::poll(&t, &ep, code) {
            Ok(xai::Poll::Pending | xai::Poll::SlowDown) => {
                (Verdict::Pass, "xAI is waiting for the person".into())
            }
            Ok(xai::Poll::Approved(_)) => {
                (Verdict::Fail, "xAI approved a code nobody typed".into())
            }
            Err(e) => {
                let (code, message) = shown(e);
                (Verdict::Fail, format!("{code}: {message}"))
            }
        }
    });
    p.check("xAI", "Grok command-line program (this computer)", || {
        use boopis_host::xai::cli::{GrokCli as _, SystemGrok};
        let probe = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime")
            .block_on(SystemGrok::new().probe());
        plain_or_fail(&probe.detail).unwrap_or((Verdict::Pass, probe.detail))
    });
}

// ---------------------------------------------------------------- every key way, with a key no provider issued

fn keys(p: &mut Probe) {
    let t = http::Https::new(TIMEOUT);
    for (entry, way) in catalogue()
        .ways()
        .filter(|(_, w)| w.kind == WayKind::Key && !w.hidden)
    {
        let service = format!("{} key", entry.label);
        p.check(
            &service,
            &format!("check of a key no provider issued ({})", way.id),
            || {
                let found = check_way_key(&t, way, BAD_KEY);
                let state = key_state(entry, way, &found, None);
                let detail = state.detail.clone().unwrap_or_default();
                if let Some(f) = plain_or_fail(&detail) {
                    return f;
                }
                let route = way.key.as_ref().and_then(|k| k.check.as_ref());
                match (&found, state.status, state.code.as_deref()) {
                    (
                        Ok(KeyCheck::Rejected),
                        ProviderStatus::Error,
                        Some("hx.provider.key_rejected"),
                    ) => (
                        Verdict::Pass,
                        match route {
                            Some(r) => format!("{detail} (its key route, {})", r.url),
                            None => detail,
                        },
                    ),
                    // a list open to anyone cannot tell a wrong key: the card must say so, not call the key accepted
                    (Ok(KeyCheck::Public), ProviderStatus::Connected, None)
                        if state.models_count.is_none() && detail.contains("anyone") =>
                    {
                        (Verdict::Pass, format!("open model list: {detail}"))
                    }
                    (Ok(KeyCheck::Unreachable), ..) => {
                        let listing = way
                            .base_url
                            .as_ref()
                            .and_then(|b| b.default.clone())
                            .unwrap_or_default();
                        let why = {
                            match t.get(&format!("{listing}/models"), &[]) {
                                Ok(r) => blocked_by(r.status, &r.body),
                                Err(e) => blocked_transport(&e).or(Some(e)),
                            }
                        };
                        match why {
                            Some(w)
                                if blocked_transport(&w).is_some() || w.contains("Cloudflare") =>
                            {
                                (Verdict::Blocked, format!("{w}; the card says: {detail}"))
                            }
                            Some(w) => (
                                Verdict::Fail,
                                format!("unreachable ({w}); the card says: {detail}"),
                            ),
                            None => (
                                Verdict::Fail,
                                format!("unreachable; the card says: {detail}"),
                            ),
                        }
                    }
                    (found, status, code) => (
                        Verdict::Fail,
                        format!(
                            "a bad key came out as {found:?}, {status:?} ({}): {detail}",
                            code.unwrap_or("no code")
                        ),
                    ),
                }
            },
        );
    }
}

// ---------------------------------------------------------------- a custom endpoint's Test step

fn endpoints(p: &mut Probe) {
    use boopis_host::providers::check::test_endpoint;
    let t = http::Https::new(TIMEOUT);
    let cases: [(&str, &str, &[EndpointOutcome]); 3] = [
        (
            "a public model list",
            "https://openrouter.ai/api/v1",
            &[EndpointOutcome::Listed],
        ),
        (
            "a server that needs a key",
            "https://api.openai.com/v1",
            &[EndpointOutcome::NeedsKey],
        ),
        (
            "nothing listening",
            "http://127.0.0.1:9/v1",
            &[EndpointOutcome::Unreachable],
        ),
    ];
    for (what, address, want) in cases {
        p.check("Custom endpoint", &format!("Test: {what}"), || {
            let a = Address::parse(address).expect("a valid address");
            match test_endpoint(&t, &a, ApiMode::ChatCompletions, None) {
                Ok(r) => {
                    let detail = r.detail.clone().unwrap_or_default();
                    if let Some(f) = plain_or_fail(&detail) {
                        return f;
                    }
                    if want.contains(&r.outcome) {
                        (
                            Verdict::Pass,
                            if detail.is_empty() {
                                format!("{:?}, {} models", r.outcome, r.models.len())
                            } else {
                                detail
                            },
                        )
                    } else {
                        (Verdict::Fail, format!("{:?}: {detail}", r.outcome))
                    }
                }
                Err(e) => {
                    let (code, message) = shown(e);
                    (Verdict::Fail, format!("{code}: {message}"))
                }
            }
        });
    }
}

// ---------------------------------------------------------------- the runtimes on this computer

fn local(p: &mut Probe) {
    let states = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime")
        .block_on(boopis_host::local::probe_local());
    for s in states {
        p.check("On this computer", &format!("ask {}", s.way), || {
            let detail = s.detail.clone().unwrap_or_default();
            if let Some(f) = plain_or_fail(&detail) {
                return f;
            }
            let state = format!("{:?}", s.status);
            let note = if detail.is_empty() {
                state
            } else {
                format!("{state}: {detail}")
            };
            // nothing runs on a clean runner: an error here means a closed port was taken for a runtime (Windows' slow refusals)
            if s.status == ProviderStatus::Error {
                (
                    Verdict::Fail,
                    format!("{note} (is something really running on that port?)"),
                )
            } else {
                (Verdict::Pass, note)
            }
        });
    }
}

// ---------------------------------------------------------------- the report

fn markdown(rows: &[Row]) -> String {
    let mut out = format!(
        "### Live sign-in probe, {}\n\n| Service | Step | Result | What it saw |\n|---|---|---|---|\n",
        platform()
    );
    for r in rows {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} |",
            r.service,
            r.step,
            r.verdict.word(),
            r.note.replace('|', "/").replace('\n', " ")
        );
    }
    out
}

fn write_reports(rows: &[Row]) {
    let table = markdown(rows);
    println!("\n{table}");
    if let Ok(path) = std::env::var("GITHUB_STEP_SUMMARY") {
        let _ = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, table.as_bytes()));
    }
    if let Ok(path) = std::env::var("HX_LIVE_REPORT") {
        let lines: String = rows
            .iter()
            .map(|r| {
                serde_json::json!({
                    "platform": platform(),
                    "service": r.service,
                    "step": r.step,
                    "result": r.verdict.word(),
                    "note": r.note,
                })
                .to_string()
                    + "\n"
            })
            .collect();
        std::fs::write(path, lines).expect("the report file");
    }
}

#[test]
#[ignore = "calls the real sign-in services and providers; run with --ignored (live-signins.yml)"]
fn every_signin_and_key_check_against_the_real_services() {
    let mut p = Probe::default();
    tls(&mut p);
    chatgpt_flow(&mut p);
    copilot_flow(&mut p);
    xai_flow(&mut p);
    keys(&mut p);
    endpoints(&mut p);
    local(&mut p);
    write_reports(&p.rows);
    let failed: Vec<String> = p
        .rows
        .iter()
        .filter(|r| r.verdict == Verdict::Fail)
        .map(|r| format!("{} | {}: {}", r.service, r.step, r.note))
        .collect();
    assert!(
        failed.is_empty(),
        "{} failed:\n{}",
        failed.len(),
        failed.join("\n")
    );
}

#[test]
fn plain_words_are_told_from_raw_ones() {
    assert!(raw_words("boopis could not reach OpenAI. Check your internet connection or proxy, then try again.").is_empty());
    for raw in [
        "i/o: task 424 panicked with message \"No CryptoProvider for Rustls.\"",
        "could not reach GitHub (io: Connection refused (os error 111))",
        "OpenAI's sign-in service answered 503 when finishing the sign-in",
        "{\"error\":\"invalid_client\"}",
    ] {
        assert!(!raw_words(raw).is_empty(), "{raw}");
    }
}
