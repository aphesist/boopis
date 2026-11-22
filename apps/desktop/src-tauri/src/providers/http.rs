//! The outbound requests the provider commands make: a `GET` of a model listing (`/models`), for the check that follows a saved key
//! and for the Test step of an endpoint (ADR-0039), and a provider's own key route (`key.check` in the data: a `GET`, or a `POST`
//! of an empty JSON object) when its list cannot tell a wrong key (ADR-0041). The same shape as the ChatGPT sign-in's wire (`chatgpt/oauth.rs`): each call is
//! one blocking request through [`Transport`], run on `spawn_blocking` by the caller; nothing here stores anything, and no header
//! value (a key) is ever logged, put in an error or kept.
//!
//! Two rules live here because they are about the wire, not about a provider:
//! - **https, or http on this computer only** ([`Address::parse`]): a key never travels in clear text to another machine;
//! - **no redirect to another origin** ([`get`]): the transport follows none itself, and a redirect that stays on the same scheme,
//!   host and port (`/models` to `/models/`) is followed here by hand, at most [`MAX_REDIRECTS`] times, so a key is only ever sent
//!   to the address that was typed.

use std::time::Duration;

use url::Url;

use crate::error::{Error, Result};

/// The most same-origin redirects followed.
pub const MAX_REDIRECTS: usize = 3;
/// The largest answer body read (a model listing; the engine's own fetchers read up to 1 MiB too).
const MAX_BODY: u64 = 1024 * 1024;

/// One HTTP answer: the status, the body (read up to a cap) and where a redirect points.
#[derive(Debug, Clone)]
pub struct Reply {
    /// The HTTP status.
    pub status: u16,
    /// The body as text.
    pub body: String,
    /// The `Location` of a redirect.
    pub location: Option<String>,
}

/// How a request leaves the computer. Blocking: run it on `spawn_blocking`.
pub trait Transport: Send + Sync + 'static {
    /// `GET url` with these headers, **following no redirect**. `Err` only when no answer came (network, TLS, timeout), with a
    /// message that carries no request data.
    ///
    /// # Errors
    /// The message of the failure.
    fn get(&self, url: &str, headers: &[(String, String)]) -> std::result::Result<Reply, String>;

    /// `POST url` with these headers and a JSON `body`, following no redirect. The same errors as [`Transport::get`].
    ///
    /// # Errors
    /// The message of the failure.
    fn post(
        &self,
        url: &str,
        headers: &[(String, String)],
        body: &str,
    ) -> std::result::Result<Reply, String>;
}

/// The real transport: `ureq` over rustls with the operating system's trust store, a whole-request timeout, a cap on the body and no
/// redirects. An address on this computer is dialled directly, never through a proxy.
pub struct Https {
    proxied: ureq::Agent,
    direct: ureq::Agent,
}

fn agent(timeout: Duration, direct: bool) -> ureq::Agent {
    let mut b = ureq::Agent::config_builder()
        .tls_config(crate::tls::config())
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(timeout))
        .user_agent(concat!("boopis/", env!("CARGO_PKG_VERSION")));
    if direct {
        b = b.proxy(None);
    }
    b.build().new_agent()
}

impl Https {
    /// A transport whose every request ends within `timeout`.
    #[must_use]
    pub fn new(timeout: Duration) -> Self {
        Self {
            proxied: agent(timeout, false),
            direct: agent(timeout, true),
        }
    }
}

impl Https {
    fn agent_for(&self, url: &str) -> &ureq::Agent {
        if Url::parse(url).is_ok_and(|u| is_loopback(&u)) {
            &self.direct
        } else {
            &self.proxied
        }
    }
}

impl Transport for Https {
    fn get(&self, url: &str, headers: &[(String, String)]) -> std::result::Result<Reply, String> {
        let mut req = self
            .agent_for(url)
            .get(url)
            .header("Accept", "application/json");
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        read(req.call().map_err(|e| e.to_string())?)
    }

    fn post(
        &self,
        url: &str,
        headers: &[(String, String)],
        body: &str,
    ) -> std::result::Result<Reply, String> {
        let mut req = self
            .agent_for(url)
            .post(url)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json");
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        read(req.send(body).map_err(|e| e.to_string())?)
    }
}

/// The status, the redirect's target and the body (up to [`MAX_BODY`]) of an answer.
#[allow(clippy::unnecessary_wraps)] // the transport's result type
fn read(mut resp: ureq::http::Response<ureq::Body>) -> std::result::Result<Reply, String> {
    let status = resp.status().as_u16();
    let location = resp
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let body = resp
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .unwrap_or_default();
    Ok(Reply {
        status,
        body,
        location,
    })
}

/// Whether a parsed address is on this computer: `127.0.0.1`, `localhost` or `[::1]`.
#[must_use]
pub fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip == std::net::Ipv4Addr::LOCALHOST,
        Some(url::Host::Ipv6(ip)) => ip == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    }
}

/// An address the provider commands may dial: https, or http on this computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    url: Url,
    /// Whether it is on this computer.
    pub loopback: bool,
}

impl Address {
    /// Check an address typed by a person: `http` or `https`, no credentials, no query, no fragment, a host, and plain `http` only
    /// on this computer.
    ///
    /// # Errors
    /// `hx.provider.endpoint_invalid` for an address that is not one of those; `hx.provider.endpoint_blocked` for plain `http` to a
    /// host that is not on this computer.
    pub fn parse(text: &str) -> Result<Self> {
        let invalid = |why: &str| Error::Provider("hx.provider.endpoint_invalid", why.to_owned());
        let text = text.trim();
        if text.is_empty() || text.len() > 2048 || text.chars().any(char::is_control) {
            return Err(invalid(
                "the address is empty, too long or has control characters",
            ));
        }
        let url = Url::parse(text).map_err(|_| invalid("that is not a web address"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(invalid("the address starts with http:// or https://"));
        }
        if url.host().is_none() {
            return Err(invalid("the address has no host"));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(invalid(
                "the address must not carry a user name or password",
            ));
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err(invalid("the address must not carry a query or a fragment"));
        }
        let loopback = is_loopback(&url);
        if url.scheme() == "http" && !loopback {
            return Err(Error::Provider(
                "hx.provider.endpoint_blocked",
                "plain http is used only for servers on this computer; use an https address".into(),
            ));
        }
        Ok(Self { url, loopback })
    }

    /// The address as text, without a trailing slash.
    #[must_use]
    pub fn text(&self) -> String {
        self.url.as_str().trim_end_matches('/').to_owned()
    }

    /// The address with `path` added (`/models`).
    #[must_use]
    pub fn join(&self, path: &str) -> String {
        format!("{}{path}", self.text())
    }

    /// Whether `other` is the same origin: scheme, host and port.
    fn same_origin(&self, other: &Url) -> bool {
        self.url.origin() == other.origin()
    }
}

/// `GET url` (which must be on `origin`'s host) and follow only the redirects that stay on the same origin.
///
/// # Errors
/// `hx.provider.endpoint_blocked` for a redirect to another origin (another host, port or scheme: the key would follow it);
/// `Err(message)` in the inner result is not used: a failed dial is `Ok(Err(..))`.
pub fn get(
    t: &dyn Transport,
    origin: &Address,
    url: &str,
    headers: &[(String, String)],
) -> Result<std::result::Result<Reply, String>> {
    let mut current = url.to_owned();
    for _ in 0..=MAX_REDIRECTS {
        let reply = match t.get(&current, headers) {
            Ok(r) => r,
            Err(e) => return Ok(Err(e)),
        };
        if !(300..400).contains(&reply.status) || reply.status == 304 {
            return Ok(Ok(reply));
        }
        let next = reply
            .location
            .as_deref()
            .and_then(|l| Url::parse(&current).ok()?.join(l).ok());
        match next {
            Some(n) if origin.same_origin(&n) && n.query().is_none() && n.fragment().is_none() => {
                current = n.to_string();
            }
            _ => {
                return Err(Error::Provider(
                    "hx.provider.endpoint_blocked",
                    "that address redirects to another address; boopis does not follow it, so a key never leaves the address you typed".into(),
                ));
            }
        }
    }
    Err(Error::Provider(
        "hx.provider.endpoint_blocked",
        "that address redirects too often".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_follow_the_catalogues_examples() {
        let rules = &crate::providers::catalogue().endpoint.url;
        for ex in rules["examples"].as_array().unwrap() {
            let url = ex["url"].as_str().unwrap();
            let valid = ex["valid"].as_bool().unwrap();
            assert_eq!(Address::parse(url).is_ok(), valid, "{url}");
        }
    }

    #[test]
    fn a_remote_http_address_is_blocked_and_the_rest_invalid() {
        let code = |u: &str| match Address::parse(u) {
            Err(Error::Provider(c, _)) => c,
            other => panic!("{u}: {other:?}"),
        };
        assert_eq!(
            code("http://192.168.1.20:8000/v1"),
            "hx.provider.endpoint_blocked"
        );
        assert_eq!(
            code("http://example.com/v1"),
            "hx.provider.endpoint_blocked"
        );
        for bad in [
            "",
            "   ",
            "not a url",
            "ftp://example.com",
            "https://user:pass@example.com/v1",
            "https://example.com/v1?key=abc",
            "https://example.com/v1#x",
            "file:///etc/passwd",
        ] {
            assert_eq!(code(bad), "hx.provider.endpoint_invalid", "{bad:?}");
        }
    }

    #[test]
    fn loopback_is_this_computer_in_every_spelling_and_nothing_else() {
        for ok in [
            "http://127.0.0.1:8000/v1",
            "http://localhost:11434/v1",
            "http://LOCALHOST/v1",
            "http://[::1]:1234/v1",
            "https://127.0.0.1/v1",
        ] {
            assert!(Address::parse(ok).unwrap().loopback, "{ok}");
        }
        for not in [
            "https://api.example.com/v1",
            "https://127.0.0.1.example.com/v1",
            "https://localhost.example.com/v1",
        ] {
            assert!(!Address::parse(not).unwrap().loopback, "{not}");
        }
        // an address on this network is not this computer, even when it looks private
        assert!(!Address::parse("https://192.168.1.20/v1").unwrap().loopback);
        assert_eq!(
            Address::parse("https://api.example.com/v1/")
                .unwrap()
                .text(),
            "https://api.example.com/v1"
        );
    }

    struct Script(std::sync::Mutex<Vec<std::result::Result<Reply, String>>>);
    impl Transport for Script {
        fn get(&self, _: &str, _: &[(String, String)]) -> std::result::Result<Reply, String> {
            self.0.lock().unwrap().remove(0)
        }
        fn post(
            &self,
            _: &str,
            _: &[(String, String)],
            _: &str,
        ) -> std::result::Result<Reply, String> {
            self.0.lock().unwrap().remove(0)
        }
    }

    #[allow(clippy::unnecessary_wraps)] // a scripted transport answer
    fn redirect(to: &str) -> std::result::Result<Reply, String> {
        let reply = Reply {
            status: 302,
            body: String::new(),
            location: Some(to.to_owned()),
        };
        Ok(reply)
    }

    #[test]
    fn only_a_redirect_that_stays_on_the_same_origin_is_followed() {
        let origin = Address::parse("https://api.example.com/v1").unwrap();
        let ok = Ok(Reply {
            status: 200,
            body: "{}".into(),
            location: None,
        });
        let t = Script(std::sync::Mutex::new(vec![
            redirect("/v1/models/"),
            ok.clone(),
        ]));
        let got = get(&t, &origin, "https://api.example.com/v1/models", &[])
            .unwrap()
            .unwrap();
        assert_eq!(got.status, 200);
        for elsewhere in [
            "https://evil.example.net/v1/models",
            "http://api.example.com/v1/models",
            "https://api.example.com:8443/v1/models",
            "https://api.example.com.evil.net/v1/models",
        ] {
            let t = Script(std::sync::Mutex::new(vec![redirect(elsewhere), ok.clone()]));
            let e = get(&t, &origin, "https://api.example.com/v1/models", &[]).unwrap_err();
            assert_eq!(e.code(), "hx.provider.endpoint_blocked", "{elsewhere}");
        }
        // a loop is cut
        let t = Script(std::sync::Mutex::new(vec![
            redirect("/a"),
            redirect("/b"),
            redirect("/c"),
            redirect("/d"),
            redirect("/e"),
        ]));
        assert!(get(&t, &origin, "https://api.example.com/x", &[]).is_err());
        // a failed dial is a result, not an error
        let t = Script(std::sync::Mutex::new(vec![Err("refused".into())]));
        assert!(
            get(&t, &origin, "https://api.example.com/x", &[])
                .unwrap()
                .is_err()
        );
    }
}
