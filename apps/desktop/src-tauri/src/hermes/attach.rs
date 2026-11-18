//! What `hermes gateway ensure|attach --json` and the control socket tell the host, and the one thing it does with
//! them: build a [`Dial`] (a URL plus the ticket subprotocols). A ticket is single-use and never leaves the host:
//! no type here is `Serialize`, and `Debug` redacts it.

use std::fmt;

use serde::Deserialize;
use url::Url;

use crate::error::{Error, Result};

/// The WebSocket subprotocol of `hermes-gateway-v1`.
pub const PROTOCOL: &str = "hermes-gateway-v1";
/// The prefix of the ticket subprotocol.
pub const TICKET_PREFIX: &str = "hermes-gateway-ticket.";

/// The gateway's own description of itself (`endpoint` in the verdicts, `identify` on the control socket).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct EndpointInfo {
    /// `http://127.0.0.1:<port>`.
    pub api_origin: Option<String>,
    /// The commit the gateway booted from.
    pub code_sha: Option<String>,
    /// The instance id (changes on every start).
    pub instance_id: Option<String>,
    /// The profile id (the home path).
    pub profile_id: Option<String>,
    /// What the gateway can do.
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// The runtime protocol number.
    pub runtime_protocol: Option<u32>,
}

/// The JSON `ensure --json` and `attach --json` print. Unknown fields are ignored.
#[derive(Debug, Clone, Deserialize)]
pub struct Verdict {
    /// `ready`, `starting`, `draining`, `inaccessible`, `incompatible`, `absent`, `conflict`.
    pub state: String,
    /// A bounded reason (`idle_exit`, `profile_mismatch`, ...).
    pub reason_code: Option<String>,
    /// A human-readable detail.
    pub detail: Option<String>,
    /// A refusal's message (`attach` only).
    pub message: Option<String>,
    /// The gateway.
    pub endpoint: Option<EndpointInfo>,
    /// The code identity of the client Hermes (`ensure` and `attach`).
    pub client_code_sha: Option<String>,
    /// `attach` only: the WebSocket URL.
    pub url: Option<String>,
    /// `attach` only: the dial subprotocols, the ticket among them.
    pub protocols: Option<Vec<String>>,
    /// `attach` only: the single-use ticket.
    pub ticket: Option<String>,
}

impl Verdict {
    /// Parse the last JSON line of a command's stdout.
    ///
    /// # Errors
    /// `Unavailable` when there is no JSON to read.
    pub fn parse(stdout: &str) -> Result<Self> {
        let line = stdout
            .lines()
            .rev()
            .find(|l| l.trim_start().starts_with('{'))
            .unwrap_or("");
        serde_json::from_str(line)
            .map_err(|e| Error::Unavailable(format!("hermes printed no verdict: {e}")))
    }

    /// `Some((client, gateway))` when both sides name a code identity and the two differ: the gateway outlived an update.
    #[must_use]
    pub fn code_mismatch(&self) -> Option<(&str, &str)> {
        let client = self.client_code_sha.as_deref()?;
        let gateway = self.endpoint.as_ref()?.code_sha.as_deref()?;
        (client != gateway).then_some((client, gateway))
    }

    /// The error a verdict that is not `ready` stands for.
    #[must_use]
    pub fn refusal(&self) -> Error {
        let why = self.reason_code.as_deref().unwrap_or("not_ready");
        let detail = self
            .message
            .as_deref()
            .or(self.detail.as_deref())
            .map(|d| format!(": {d}"))
            .unwrap_or_default();
        let text = format!("the Hermes gateway is {} ({why}){detail}", self.state);
        if self.state == "incompatible" {
            Error::Incompatible(text)
        } else {
            Error::Unavailable(text)
        }
    }
}

/// A single-use gateway ticket. Never serialised, never printed.
#[derive(Clone, PartialEq, Eq)]
pub struct Ticket(String);

impl Ticket {
    /// Validate a ticket: it becomes a header token, so only URL-safe base64 characters pass.
    ///
    /// # Errors
    /// `Unavailable` when the ticket is empty, too long or has other characters.
    pub fn new(raw: &str) -> Result<Self> {
        let ok = !raw.is_empty()
            && raw.len() <= 256
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if ok {
            Ok(Self(raw.to_owned()))
        } else {
            Err(Error::Unavailable(
                "the gateway sent a malformed ticket".into(),
            ))
        }
    }

    /// The two subprotocols of the dial: the protocol and the ticket.
    #[must_use]
    pub fn subprotocols(&self) -> Vec<String> {
        vec![PROTOCOL.to_owned(), format!("{TICKET_PREFIX}{}", self.0)]
    }
}

impl fmt::Debug for Ticket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Ticket(<redacted>)")
    }
}

/// Where and how to dial a gateway.
#[derive(Clone)]
pub struct Dial {
    /// `ws://127.0.0.1:<port>/api/ws`.
    pub url: Url,
    /// The subprotocols to offer (carries the ticket).
    pub subprotocols: Vec<String>,
    /// What the gateway said about itself.
    pub endpoint: EndpointInfo,
}

impl fmt::Debug for Dial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Dial")
            .field("url", &self.url.as_str())
            .field("subprotocols", &"<redacted>")
            .finish_non_exhaustive()
    }
}

/// The WebSocket URL for an API origin (`http://127.0.0.1:1234` becomes `ws://127.0.0.1:1234/api/ws`).
///
/// # Errors
/// `Unavailable` when the origin is not a loopback `http` URL.
pub fn ws_url_for_origin(origin: &str) -> Result<Url> {
    let url =
        Url::parse(origin).map_err(|e| Error::Unavailable(format!("bad gateway origin: {e}")))?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        s => {
            return Err(Error::Unavailable(format!(
                "unsupported gateway scheme {s}"
            )));
        }
    };
    let host = url
        .host_str()
        .ok_or_else(|| Error::Unavailable("gateway origin has no host".into()))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| Error::Unavailable("gateway origin has no port".into()))?;
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    Url::parse(&format!("{scheme}://{host}:{port}/api/ws"))
        .map_err(|e| Error::Unavailable(e.to_string()))
}

/// Refuse any URL that is not on the loopback interface: the local endpoint never leaves the machine.
///
/// # Errors
/// `Unavailable` when the host is not `127.0.0.1`, `::1` or `localhost`.
pub fn require_loopback(url: &Url) -> Result<()> {
    let ok = match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    if ok {
        Ok(())
    } else {
        Err(Error::Unavailable(format!(
            "{url} is not a loopback address"
        )))
    }
}

impl Dial {
    /// Build a dial from an `attach --json` verdict. The verdict's own `protocols` are used when they carry a ticket,
    /// so a future change to the subprotocol shape needs no host change; otherwise they are built from the ticket.
    ///
    /// # Errors
    /// The verdict's refusal when it is not `ready`; `Unavailable` when URL or ticket are missing or not loopback.
    pub fn from_attach(v: &Verdict) -> Result<Self> {
        if v.state != "ready" {
            return Err(v.refusal());
        }
        let ticket = Ticket::new(
            v.ticket
                .as_deref()
                .ok_or_else(|| Error::Unavailable("attach returned no ticket".into()))?,
        )?;
        let url = Url::parse(
            v.url
                .as_deref()
                .ok_or_else(|| Error::Unavailable("attach returned no url".into()))?,
        )
        .map_err(|e| Error::Unavailable(format!("bad gateway url: {e}")))?;
        require_loopback(&url)?;
        let subprotocols = match &v.protocols {
            Some(p)
                if p.iter().any(|s| s.starts_with(TICKET_PREFIX))
                    && p.iter().all(|s| is_token(s)) =>
            {
                p.clone()
            }
            _ => ticket.subprotocols(),
        };
        Ok(Self {
            url,
            subprotocols,
            endpoint: v.endpoint.clone().unwrap_or_default(),
        })
    }

    /// Build a dial from what the control socket gave: the API origin and a ticket.
    ///
    /// # Errors
    /// `Unavailable` when the origin is not loopback or the ticket is malformed.
    pub fn from_control(endpoint: EndpointInfo, ticket: &str) -> Result<Self> {
        let origin = endpoint
            .api_origin
            .as_deref()
            .ok_or_else(|| Error::Unavailable("identify returned no api_origin".into()))?;
        let url = ws_url_for_origin(origin)?;
        require_loopback(&url)?;
        Ok(Self {
            url,
            subprotocols: Ticket::new(ticket)?.subprotocols(),
            endpoint,
        })
    }
}

/// An RFC 6455 token: what a `Sec-WebSocket-Protocol` entry may contain.
fn is_token(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ATTACH: &str = r#"{"client_code_sha":null,"detail":null,"endpoint":{"api_origin":"http://127.0.0.1:56079","authority_epoch":1,"capabilities":["event-replay-v1"],"code_sha":null,"instance_id":"b6f8","profile_id":"/h","runtime_protocol":1,"supervisor":"none"},"protocol":"hermes-gateway-v1","protocols":["hermes-gateway-v1","hermes-gateway-ticket.9XrhLALJeN7OF6mOhizI_FrFmv7t8Mtj_Eu-L0WbxfA"],"reason_code":null,"start_context":{"windows_service_session":false},"state":"ready","ticket":"9XrhLALJeN7OF6mOhizI_FrFmv7t8Mtj_Eu-L0WbxfA","url":"ws://127.0.0.1:56079/api/ws"}"#;

    #[test]
    fn a_ready_attach_gives_a_dial_with_the_ticket_subprotocols() {
        let v = Verdict::parse(&format!("noise\n{ATTACH}\n")).unwrap();
        let d = Dial::from_attach(&v).unwrap();
        assert_eq!(d.url.as_str(), "ws://127.0.0.1:56079/api/ws");
        assert_eq!(d.subprotocols[0], "hermes-gateway-v1");
        assert!(d.subprotocols[1].starts_with("hermes-gateway-ticket.9Xrh"));
        assert!(
            d.endpoint
                .capabilities
                .contains(&"event-replay-v1".to_owned())
        );
    }

    #[test]
    fn debug_never_shows_the_ticket() {
        let v = Verdict::parse(ATTACH).unwrap();
        let d = Dial::from_attach(&v).unwrap();
        let shown = format!(
            "{d:?} {:?} {:?}",
            Ticket::new("secretticket").unwrap(),
            d.url
        );
        assert!(!shown.contains("9XrhLALJ"));
        assert!(!shown.contains("secretticket"));
    }

    #[test]
    fn subprotocols_are_built_from_the_ticket_when_the_verdict_has_none() {
        let mut v = Verdict::parse(ATTACH).unwrap();
        v.protocols = None;
        let d = Dial::from_attach(&v).unwrap();
        assert_eq!(
            d.subprotocols,
            vec![
                "hermes-gateway-v1".to_owned(),
                format!("{TICKET_PREFIX}9XrhLALJeN7OF6mOhizI_FrFmv7t8Mtj_Eu-L0WbxfA")
            ]
        );
    }

    #[test]
    fn hostile_tickets_and_urls_are_refused() {
        for bad in ["", "a b", "a\r\nOrigin: x", "a,b", &"x".repeat(257)] {
            assert!(Ticket::new(bad).is_err(), "{bad:?}");
        }
        let mut v = Verdict::parse(ATTACH).unwrap();
        v.url = Some("ws://evil.example.com/api/ws".into());
        assert!(Dial::from_attach(&v).is_err());
        v.url = Some("ws://127.0.0.1:1/api/ws".into());
        v.protocols = Some(vec!["hermes-gateway-ticket.a, x-evil".into()]);
        let d = Dial::from_attach(&v).unwrap();
        assert!(
            d.subprotocols.iter().all(|s| is_token(s)),
            "an unsafe protocol list falls back to the ticket-built one"
        );
    }

    #[test]
    fn not_ready_is_a_refusal_with_the_right_code() {
        let v =
            Verdict::parse(r#"{"state":"incompatible","reason_code":"runtime_protocol"}"#).unwrap();
        assert_eq!(
            Dial::from_attach(&v).unwrap_err().code(),
            "hx.hermes.incompatible"
        );
        let v = Verdict::parse(
            r#"{"state":"inaccessible","reason_code":"idle_exit","message":"gone"}"#,
        )
        .unwrap();
        let e = Dial::from_attach(&v).unwrap_err();
        assert_eq!(e.code(), "hx.hermes.unavailable");
        assert!(e.to_string().contains("idle_exit") && e.to_string().contains("gone"));
        assert!(Verdict::parse("not json").is_err());
    }

    #[test]
    fn code_mismatch_needs_both_shas() {
        let mut v = Verdict::parse(ATTACH).unwrap();
        assert!(v.code_mismatch().is_none());
        v.client_code_sha = Some("aaa".into());
        assert!(v.code_mismatch().is_none(), "the gateway names none");
        v.endpoint.as_mut().unwrap().code_sha = Some("bbb".into());
        assert_eq!(v.code_mismatch(), Some(("aaa", "bbb")));
        v.endpoint.as_mut().unwrap().code_sha = Some("aaa".into());
        assert!(v.code_mismatch().is_none());
    }

    #[test]
    fn origin_becomes_a_websocket_url() {
        assert_eq!(
            ws_url_for_origin("http://127.0.0.1:9").unwrap().as_str(),
            "ws://127.0.0.1:9/api/ws"
        );
        assert_eq!(
            ws_url_for_origin("http://[::1]:9").unwrap().as_str(),
            "ws://[::1]:9/api/ws"
        );
        assert!(ws_url_for_origin("ftp://127.0.0.1:9").is_err());
        let d = Dial::from_control(
            EndpointInfo {
                api_origin: Some("http://10.0.0.5:9".into()),
                ..EndpointInfo::default()
            },
            "tok",
        );
        assert!(d.is_err(), "not loopback");
    }
}
