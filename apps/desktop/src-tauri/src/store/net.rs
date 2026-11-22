//! What the store reads from the network, and nothing else does: one blocking GET over `ureq` and rustls with the operating
//! system's trust store (the stack of the ChatGPT sign-in), under the rules of `docs/STORE.md` 5.3.
//!
//! - **https only**, no credentials in an address, and the host must be on the list the caller gives (the built-in hosts of the
//!   sources plus the host of a source the user added). Plain `http` is allowed to a loopback address only when the
//!   [`Hosts`] say so, which only tests do.
//! - **Redirects are followed here, by hand**, one hop at a time, and every hop is checked against the same list: a redirect to
//!   a host that is not allowed fails (`hx.store.source_unreachable`), as the engine's own catalogue loader does.
//! - **Caps**: a response over the byte cap fails with `hx.store.too_large`; a connection and a whole request have timeouts.
//! - **Conditional**: a cached `ETag` goes out as `If-None-Match`; `304` is a [`Reply`] with no body.
//! - **Rate limits** (`429`, and `403` with `x-ratelimit-remaining: 0`) become `hx.store.rate_limited` with the seconds to wait.
//!
//! The query a user types never reaches here: search is local.

use std::io::Read;
use std::time::Duration;

use url::Url;

use crate::config::StoreLimits;
use crate::error::{Error, Result};

/// The hosts the store reads from by default: each source's own, and the ones its answers may redirect to.
pub const BUILT_IN_HOSTS: &[&str] = &[
    "registry.modelcontextprotocol.io",
    "github.com",
    "codeload.github.com",
    "raw.githubusercontent.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "hermes-agent.nousresearch.com",
    "nousresearch.github.io",
];

/// Which hosts a request may reach, now and after any redirect.
#[derive(Debug, Clone)]
pub struct Hosts {
    allowed: Vec<String>,
    loopback_http: bool,
}

impl Hosts {
    /// The built-in hosts, and `extra` (the host of a source the user added).
    #[must_use]
    pub fn new(extra: &[String]) -> Self {
        let mut allowed: Vec<String> = BUILT_IN_HOSTS.iter().map(|h| (*h).to_owned()).collect();
        allowed.extend(extra.iter().map(|h| h.to_ascii_lowercase()));
        Self {
            allowed,
            loopback_http: false,
        }
    }

    /// Also allow `http` to a loopback address and that address as a host (a test server).
    #[must_use]
    pub fn with_loopback_http(mut self) -> Self {
        self.loopback_http = true;
        self
    }

    /// Whether `url` may be fetched.
    ///
    /// # Errors
    /// `hx.store.source_unreachable` in words: plain text, a credential in the address, or a host that is not on the list.
    pub fn check(&self, url: &Url) -> Result<()> {
        if !url.username().is_empty() || url.password().is_some() {
            return Err(unreachable_msg("an address with a user name or password"));
        }
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let loopback = matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]");
        match url.scheme() {
            "https" => {}
            "http" if loopback && self.loopback_http => return Ok(()),
            _ => return Err(unreachable_msg("an address that is not https")),
        }
        if self.allowed.contains(&host) {
            Ok(())
        } else {
            Err(unreachable_msg(&format!(
                "{host}, which is not a host boopis reads from"
            )))
        }
    }
}

fn unreachable_msg(what: &str) -> Error {
    Error::Store(
        "hx.store.source_unreachable",
        format!("boopis will not read {what}"),
    )
}

/// What to ask for.
#[derive(Debug, Clone, Default)]
pub struct Ask<'a> {
    /// The most body bytes accepted.
    pub max_bytes: u64,
    /// The `ETag` of the copy held, sent as `If-None-Match`.
    pub etag: Option<&'a str>,
    /// An `Accept` header.
    pub accept: Option<&'a str>,
}

/// One answer: a `200` with a body, or a `304`.
#[derive(Debug, Clone)]
pub struct Reply {
    /// `200` or `304`.
    pub status: u16,
    /// The body (empty for a `304`).
    pub body: Vec<u8>,
    /// The `ETag` of this answer.
    pub etag: Option<String>,
    /// The address the answer came from, after redirects.
    pub final_url: String,
}

/// How a GET leaves the computer. Blocking: run it on `spawn_blocking`.
pub trait Fetcher: Send + Sync + 'static {
    /// `GET url` within `hosts` and the caps of `ask`.
    ///
    /// # Errors
    /// `hx.store.source_unreachable` (network, a refused host, a bad status), `hx.store.too_large`, `hx.store.rate_limited`.
    fn get(&self, url: &str, hosts: &Hosts, ask: &Ask<'_>) -> Result<Reply>;
}

/// The real fetcher.
pub struct Https {
    agent: ureq::Agent,
    max_redirects: u32,
}

impl Https {
    /// An agent with the limits' timeouts and no automatic redirects.
    #[must_use]
    pub fn new(limits: &StoreLimits) -> Self {
        let agent = ureq::Agent::config_builder()
            .tls_config(crate::tls::config())
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(limits.connect_timeout))
            .timeout_global(Some(limits.request_timeout))
            .user_agent(concat!("boopis/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        Self {
            agent,
            max_redirects: limits.max_redirects,
        }
    }
}

fn header(resp: &ureq::http::Response<ureq::Body>, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

impl Fetcher for Https {
    fn get(&self, url: &str, hosts: &Hosts, ask: &Ask<'_>) -> Result<Reply> {
        let mut current = Url::parse(url).map_err(|e| unreachable_msg(&format!("{url} ({e})")))?;
        for _ in 0..=self.max_redirects {
            hosts.check(&current)?;
            let mut req = self.agent.get(current.as_str());
            if let Some(etag) = ask.etag {
                req = req.header("If-None-Match", etag);
            }
            if let Some(a) = ask.accept {
                req = req.header("Accept", a);
            }
            let mut resp = req.call().map_err(|e| {
                unreachable_msg(&format!("{} ({e})", current.host_str().unwrap_or("")))
            })?;
            let status = resp.status().as_u16();
            match status {
                200 => {
                    let etag = header(&resp, "etag");
                    let body = read_capped(resp.body_mut().as_reader(), ask.max_bytes)?;
                    return Ok(Reply {
                        status,
                        body,
                        etag,
                        final_url: current.to_string(),
                    });
                }
                304 => {
                    return Ok(Reply {
                        status,
                        body: Vec::new(),
                        etag: ask.etag.map(str::to_owned),
                        final_url: current.to_string(),
                    });
                }
                301 | 302 | 303 | 307 | 308 => {
                    let Some(location) = header(&resp, "location") else {
                        return Err(unreachable_msg("a redirect with no address"));
                    };
                    current = current.join(&location).map_err(|_| {
                        unreachable_msg("a redirect to an address that does not parse")
                    })?;
                }
                429 => return Err(rate_limited(header(&resp, "retry-after"))),
                403 if header(&resp, "x-ratelimit-remaining").as_deref() == Some("0") => {
                    return Err(rate_limited(
                        header(&resp, "retry-after").or_else(|| header(&resp, "x-ratelimit-reset")),
                    ));
                }
                other => {
                    return Err(unreachable_msg(&format!(
                        "{} (it answered {other})",
                        current.host_str().unwrap_or("")
                    )));
                }
            }
        }
        Err(unreachable_msg("an address that redirects too many times"))
    }
}

/// `hx.store.rate_limited`, with the seconds to wait when the source said (`retry-after` seconds; a reset time is not trusted
/// as a duration, so it gives the default).
fn rate_limited(after: Option<String>) -> Error {
    let secs = after
        .and_then(|a| a.trim().parse::<u64>().ok())
        .filter(|s| *s <= 3600)
        .unwrap_or(60);
    Error::Store(
        "hx.store.rate_limited",
        format!("that source is limiting requests; retry_after_s={secs}"),
    )
}

/// Read at most `max` bytes; one byte more is `hx.store.too_large`.
///
/// # Errors
/// `hx.store.too_large`, or `hx.store.source_unreachable` when the read fails.
pub fn read_capped(mut r: impl Read, max: u64) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut limited = (&mut r).take(max.saturating_add(1));
    limited
        .read_to_end(&mut out)
        .map_err(|e| unreachable_msg(&format!("a response that stopped early ({e})")))?;
    if out.len() as u64 > max {
        return Err(Error::Store(
            "hx.store.too_large",
            format!(
                "a response is larger than the {} MB boopis accepts",
                max / (1024 * 1024)
            ),
        ));
    }
    Ok(out)
}

/// The seconds a `hx.store.rate_limited` message asks to wait, for the UI's `retry_after_s`.
#[must_use]
pub fn retry_after_s(message: &str) -> Option<u64> {
    message
        .split("retry_after_s=")
        .nth(1)
        .and_then(|t| t.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|n| n.parse().ok())
}

/// A pause between two tries, for callers that wait on a rate limit (none do automatically: the user is told).
#[must_use]
pub fn default_wait() -> Duration {
    Duration::from_mins(1)
}
