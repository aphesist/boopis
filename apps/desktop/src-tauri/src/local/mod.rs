//! Runtimes on this computer (ADR-0039): Ollama, LM Studio, llama.cpp and vLLM, found by asking each one question on its own
//! default port.
//!
//! The rules, which the tests hold:
//! - **Loopback only.** The only address ever dialled is `127.0.0.1` and a port from the catalogue
//!   (`apps/shared/data/providers.json`, `discovery`). There is no DNS lookup, no redirect and no other host: [`dial`] refuses
//!   any address that is not loopback before it opens a socket.
//! - **No key, no side effect.** One `GET`, nothing sent but the request line and three fixed headers; nothing is saved.
//! - **Never in the background.** [`probe_local`] runs when Settings > Models opens and on "Check again" (the command
//!   `provider_probe_local`); nothing here starts a timer or a task of its own.
//! - **Fail closed on what it is.** An answer counts as a runtime only when it has that runtime's shape (the catalogue's
//!   `shape`). An HTML page, another service's JSON or a refusal is not a runtime found.
//!
//! The answer is a [`ProviderState`] per local way: `found_local` with the address and how many models it listed, or
//! `not_found`, or `error` with a stable code when something answers but cannot be read (a timeout, a request for a key).
//! The last answer of this run is kept so `provider_list` can answer from it without dialling anything.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::providers::{ProviderState, Way, WayKind, catalogue};

/// The most of an answer that is read (a long model list stays well under it).
const MAX_BODY: usize = 1 << 20;
/// How many model names the one-line detail spells out.
const NAMES_SHOWN: usize = 3;

/// What one question to a runtime came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// It answered with its own shape; these are the models it listed (names, in its order).
    Found(Vec<String>),
    /// It answered with the shape of that runtime, and names a model count only (a server that loads one model).
    FoundUnnamed,
    /// Nothing is listening on the port.
    Nothing,
    /// Something answered, but it is not that runtime (an HTML page, another service's JSON).
    Other,
    /// It answered, and asks for a key (401 or 403).
    NeedsKey,
    /// It accepted the connection and did not answer in time.
    Slow,
}

/// Why a dial was refused before it happened.
#[derive(Debug, PartialEq, Eq)]
pub struct NotLoopback(pub IpAddr);

/// Open a connection, to loopback only. Any other address is refused before a socket exists.
///
/// # Errors
/// [`NotLoopback`] for an address that is not loopback; an I/O error from the connect otherwise.
pub async fn dial(addr: SocketAddr) -> Result<std::io::Result<TcpStream>, NotLoopback> {
    if !addr.ip().is_loopback() {
        return Err(NotLoopback(addr.ip()));
    }
    Ok(TcpStream::connect(addr).await)
}

/// The address a way is asked at: `127.0.0.1` and the catalogue's port, or `None` when the catalogue says anything else (a
/// way whose host is not `127.0.0.1` is never dialled).
#[must_use]
pub fn target(way: &Way) -> Option<SocketAddr> {
    let d = &way.discovery;
    if d.method != "probe" || d.host.as_deref() != Some("127.0.0.1") {
        return None;
    }
    Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), d.port?))
}

/// Split an answer into its status code and body, undoing chunked transfer.
fn parse_response(raw: &[u8]) -> Option<(u16, Vec<u8>)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = head.lines();
    let status = lines
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let chunked = lines.any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let body = &raw[split + 4..];
    Some((
        status,
        if chunked {
            dechunk(body)
        } else {
            body.to_vec()
        },
    ))
}

/// Chunked transfer coding: `<hex size>\r\n<bytes>\r\n ... 0\r\n`. A malformed stream ends at the last whole chunk.
fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(nl) = body.windows(2).position(|w| w == b"\r\n") {
        let size = std::str::from_utf8(&body[..nl])
            .ok()
            .and_then(|s| usize::from_str_radix(s.split(';').next().unwrap_or("").trim(), 16).ok());
        let Some(size) = size else { break };
        let start = nl + 2;
        if size == 0 || body.len() < start + size {
            break;
        }
        out.extend_from_slice(&body[start..start + size]);
        body = body.get(start + size + 2..).unwrap_or_default();
    }
    out
}

/// One `GET` on a loopback address, inside `timeout` as a whole (connect, send and read).
async fn get(addr: SocketAddr, path: &str, timeout: Duration) -> Result<(u16, Vec<u8>), Outcome> {
    let run = async {
        let mut stream = match dial(addr).await {
            Err(_) | Ok(Err(_)) => return Err(Outcome::Nothing),
            Ok(Ok(s)) => s,
        };
        // HTTP/1.0 and `Connection: close`: the answer is the bytes until the server closes, and a server may not chunk it
        let request = format!(
            "GET {path} HTTP/1.0\r\nHost: {addr}\r\nAccept: application/json\r\nUser-Agent: boopis\r\nConnection: close\r\n\r\n"
        );
        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|_| Outcome::Nothing)?;
        let mut raw = Vec::new();
        let mut limited = stream.take(MAX_BODY as u64);
        limited
            .read_to_end(&mut raw)
            .await
            .map_err(|_| Outcome::Other)?;
        parse_response(&raw).ok_or(Outcome::Other)
    };
    // a connect to loopback is refused at once, so a timeout means something accepted and then said nothing
    tokio::time::timeout(timeout, run)
        .await
        .unwrap_or(Err(Outcome::Slow))
}

fn name_of(v: &Value) -> Option<String> {
    ["id", "name", "model", "key", "display_name"]
        .iter()
        .find_map(|k| v.get(k).and_then(Value::as_str))
        .map(str::to_owned)
}

/// The models of an OpenAI-style listing, `{"data": [{"id": ...}]}`.
fn openai_models(v: &Value) -> Option<Vec<String>> {
    Some(
        v.get("data")?
            .as_array()?
            .iter()
            .filter_map(name_of)
            .collect(),
    )
}

/// Read an answer by the shape the catalogue names; `None` when it is not that shape.
#[must_use]
pub fn read_shape(shape: &str, body: &[u8]) -> Option<Outcome> {
    let v: Value = serde_json::from_slice(body).ok()?;
    match shape {
        // `{"models": [{"name": "llama3.2:latest", ...}]}`
        "ollama_tags" => {
            let list = v.get("models")?.as_array()?;
            Some(Outcome::Found(list.iter().filter_map(name_of).collect()))
        }
        // LM Studio's own listing, `{"models": [{"type": "llm", "key": ...}]}`; an embedding model is not one to chat with. The
        // OpenAI-style `{"data": [...]}` it also answers on `/v1/models` is read the same way.
        "lmstudio_models" => {
            if let Some(list) = v.get("models").and_then(Value::as_array) {
                let names = list
                    .iter()
                    .filter(|m| m.get("type").and_then(Value::as_str) != Some("embedding"))
                    .filter_map(name_of)
                    .collect();
                return Some(Outcome::Found(names));
            }
            openai_models(&v).map(Outcome::Found)
        }
        // llama.cpp's `/props`: an object that carries the server's own fields. The model it serves is its alias or the file name.
        "llamacpp_props" => {
            let o = v.as_object()?;
            let fingerprint = [
                "default_generation_settings",
                "total_slots",
                "build_info",
                "model_path",
                "chat_template",
            ];
            if !fingerprint.iter().any(|k| o.contains_key(*k)) {
                return None;
            }
            let name = o
                .get("model_alias")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .or_else(|| {
                    let p = o.get("model_path").and_then(Value::as_str)?;
                    p.rsplit(['/', '\\']).next().map(str::to_owned)
                })
                .filter(|s| !s.is_empty());
            Some(name.map_or(Outcome::FoundUnnamed, |n| Outcome::Found(vec![n])))
        }
        "openai_models" => openai_models(&v).map(Outcome::Found),
        _ => None,
    }
}

/// Ask one way's runtime at `addr` (the way's own `discovery`, but at the given address: tests aim it at a server of their own).
pub(crate) async fn ask(way: &Way, addr: SocketAddr) -> Outcome {
    let d = &way.discovery;
    let (Some(path), Some(shape)) = (d.path.as_deref(), d.shape.as_deref()) else {
        return Outcome::Nothing;
    };
    let timeout = Duration::from_millis(u64::from(d.timeout_ms.unwrap_or(2000)));
    let mut attempts = vec![(path, shape)];
    if let Some(fallback) = d.fallback_path.as_deref() {
        // the native listing failed to read: the OpenAI-style one is the runtime's other door
        attempts.push((fallback, "openai_models"));
    }
    let mut last = Outcome::Nothing;
    for (p, s) in attempts {
        match get(addr, p, timeout).await {
            Ok((200..=299, body)) => match read_shape(s, &body) {
                Some(found) => return found,
                None => last = Outcome::Other,
            },
            Ok((401 | 403, _)) => return Outcome::NeedsKey,
            Ok(_) => last = Outcome::Other,
            // nothing listening or no answer in time: a second path will not change it
            Err(o @ (Outcome::Nothing | Outcome::Slow)) => return o,
            Err(o) => last = o,
        }
    }
    last
}

/// A way's state from what the question came to.
#[must_use]
pub fn state_for(entry_id: &str, way: &Way, addr: SocketAddr, outcome: Outcome) -> ProviderState {
    let base = way
        .base_url
        .as_ref()
        .and_then(|b| b.default.clone())
        .unwrap_or_else(|| format!("http://{addr}/v1"));
    let mut state = match outcome {
        Outcome::Found(names) => {
            let mut s = ProviderState::found_local(
                entry_id,
                &way.id,
                &base,
                u32::try_from(names.len()).unwrap_or(u32::MAX),
            );
            s.detail = Some(if names.is_empty() {
                "It is running and has no models loaded yet.".to_owned()
            } else {
                let shown = names
                    .iter()
                    .take(NAMES_SHOWN)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                match names.len().saturating_sub(NAMES_SHOWN) {
                    0 => shown,
                    more => format!("{shown} and {more} more"),
                }
            });
            s
        }
        Outcome::FoundUnnamed => ProviderState::found_local(entry_id, &way.id, &base, 1),
        Outcome::Nothing | Outcome::Other => ProviderState::not_found(entry_id, &way.id),
        Outcome::NeedsKey => ProviderState::error(
            entry_id,
            &way.id,
            WayKind::Local,
            "hx.provider.key_rejected",
            &format!(
                "Something on {addr} asks for a key, so it was not listed. Add it as your own endpoint, with its key."
            ),
        ),
        Outcome::Slow => ProviderState::error(
            entry_id,
            &way.id,
            WayKind::Local,
            "hx.provider.unreachable",
            &format!("Something is listening on {addr} but did not answer in time."),
        ),
    };
    state.checked_at = Some(now_ms());
    state
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// The last answer of this run, by way id (read by `provider_list`; nothing is dialled to answer it).
static LAST: Mutex<Vec<ProviderState>> = Mutex::new(Vec::new());

/// The last probe's states, in the catalogue's order; empty before the first probe.
#[must_use]
pub fn last() -> Vec<ProviderState> {
    LAST.lock().map(|g| g.clone()).unwrap_or_default()
}

/// The last probe's state of one way, if there has been a probe.
#[must_use]
pub fn last_for(way_id: &str) -> Option<ProviderState> {
    last().into_iter().find(|s| s.way == way_id)
}

/// Ask every local way of the catalogue, all at once, each inside its own timeout, and remember the answer.
pub async fn probe_local() -> Vec<ProviderState> {
    let asks = catalogue()
        .ways()
        .filter(|(_, w)| w.kind == WayKind::Local && !w.hidden)
        .map(|(e, w)| async move {
            match target(w) {
                Some(addr) => state_for(&e.id, w, addr, ask(w, addr).await),
                // a catalogue row that names anything but 127.0.0.1 is never dialled
                None => ProviderState::not_found(&e.id, &w.id),
            }
        });
    let states = futures_util::future::join_all(asks).await;
    if let Ok(mut g) = LAST.lock() {
        g.clone_from(&states);
    }
    states
}

#[cfg(test)]
mod tests;
