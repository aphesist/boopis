//! The loopback callback of the program's sign-in: a listener on `127.0.0.1` that takes the one browser redirect of an
//! attempt (`http://127.0.0.1:<port>/auth/callback?code=…&state=…`), answers it with a small page, and hands the parameters
//! to the flow. It is bound before the browser opens, takes only a `GET` of the callback path with the `Host` of the
//! listener, and keeps waiting through anything else (a stray request, a wrong `state`, a probe), so nothing but the real
//! redirect of this attempt can end it. No parameter it reads is ever logged.

use std::time::Duration;

use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use super::oauth::CALLBACK_PATH;

/// The port the program's own examples use; taken when it is free, else any free port (only the port may vary).
pub const PREFERRED_PORT: u16 = 1455;
/// The most of a request read: a callback is a few hundred bytes.
const MAX_REQUEST: usize = 8 * 1024;
/// How long one connection may take to send its request line and headers.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// What the redirect carried. `Debug` prints none of it.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Params {
    /// The authorization code.
    pub code: Option<String>,
    /// OAuth's `error` (`access_denied` when the person declined).
    pub error: Option<String>,
    /// The issued client id of a new registration.
    pub client_id: Option<String>,
}

impl std::fmt::Debug for Params {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Params(<redacted>)")
    }
}

/// How the wait ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Wait {
    /// The redirect of this attempt arrived.
    Got(Params),
    /// The attempt was cancelled.
    Cancelled,
    /// The time ran out.
    TimedOut,
}

/// A bound listener.
pub struct Listener {
    inner: TcpListener,
    port: u16,
}

impl Listener {
    /// Bind `127.0.0.1:preferred`, else a free port on `127.0.0.1`. Never another address.
    ///
    /// # Errors
    /// The I/O error when no port can be had.
    pub async fn bind(preferred: u16) -> std::io::Result<Self> {
        let inner = match TcpListener::bind(("127.0.0.1", preferred)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind(("127.0.0.1", 0)).await?,
        };
        let port = inner.local_addr()?.port();
        Ok(Self { inner, port })
    }

    /// The exact redirect address of an attempt on this listener.
    #[must_use]
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// The port.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Wait for the redirect whose `state` is `state`, for at most `limit`. `reply` makes the page the browser is
    /// answered with, from whether the params look like a success (a code) or not.
    pub async fn wait(&self, state: &str, limit: Duration, cancel: &CancellationToken) -> Wait {
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            let accepted = tokio::select! {
                () = cancel.cancelled() => return Wait::Cancelled,
                () = tokio::time::sleep_until(deadline) => return Wait::TimedOut,
                a = self.inner.accept() => a,
            };
            let Ok((stream, _)) = accepted else { continue };
            // each connection is served inside the loop, one at a time, under its own short timeout: a client that sends
            // nothing costs five seconds, never the sign-in
            if let Some(params) = serve(stream, self.port, state).await {
                return Wait::Got(params);
            }
        }
    }
}

const SUCCESS: &str =
    "boopis is signed in to ChatGPT. You can close this tab and go back to boopis.";
const FAILURE: &str = "The sign-in did not finish. Go back to boopis to see what happened.";

fn page(message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\"><title>boopis</title><body style=\"font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem\"><p>{message}</p></body></html>"
    )
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Read one request, and answer it. `Some` only for the redirect of this attempt.
async fn serve(mut stream: TcpStream, port: u16, state: &str) -> Option<Params> {
    let mut buf = Vec::with_capacity(1024);
    let read = tokio::time::timeout(READ_TIMEOUT, async {
        let mut chunk = [0u8; 1024];
        loop {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                return Some(());
            }
            if buf.len() > MAX_REQUEST {
                return None;
            }
        }
    })
    .await;
    if !matches!(read, Ok(Some(()))) {
        respond(&mut stream, "400 Bad Request", &page(FAILURE)).await;
        return None;
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    match interpret(&text, port, state) {
        Verdict::Mine(params) => {
            let ok = params.code.is_some() && params.error.is_none();
            respond(
                &mut stream,
                "200 OK",
                &page(if ok { SUCCESS } else { FAILURE }),
            )
            .await;
            Some(params)
        }
        Verdict::NotMine(status) => {
            respond(&mut stream, status, &page(FAILURE)).await;
            None
        }
    }
}

enum Verdict {
    Mine(Params),
    NotMine(&'static str),
}

/// Decide what a request is. Pure, so a table of requests tests it.
fn interpret(request: &str, port: u16, state: &str) -> Verdict {
    let mut lines = request.split("\r\n");
    let Some(first) = lines.next() else {
        return Verdict::NotMine("400 Bad Request");
    };
    let mut words = first.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (words.next(), words.next(), words.next(), words.next())
    else {
        return Verdict::NotMine("400 Bad Request");
    };
    if !version.starts_with("HTTP/1.") {
        return Verdict::NotMine("400 Bad Request");
    }
    if method != "GET" {
        return Verdict::NotMine("405 Method Not Allowed");
    }
    // a page of another site must not be able to talk to the listener by a name that resolves here (DNS rebinding)
    let host_ok = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .any(|(k, v)| k.eq_ignore_ascii_case("host") && v.trim() == format!("127.0.0.1:{port}"));
    if !host_ok {
        return Verdict::NotMine("400 Bad Request");
    }
    let Some((path, query)) = target.split_once('?') else {
        return Verdict::NotMine("404 Not Found");
    };
    if path != CALLBACK_PATH {
        return Verdict::NotMine("404 Not Found");
    }
    let mut params = Params::default();
    let mut seen_state = String::new();
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "code" => params.code = Some(v.into_owned()).filter(|s| !s.is_empty()),
            "error" => params.error = Some(v.into_owned()).filter(|s| !s.is_empty()),
            "client_id" => params.client_id = Some(v.into_owned()).filter(|s| !s.is_empty()),
            "state" => seen_state = v.into_owned(),
            _ => {}
        }
    }
    if seen_state.is_empty() || !bool::from(seen_state.as_bytes().ct_eq(state.as_bytes())) {
        return Verdict::NotMine("400 Bad Request");
    }
    Verdict::Mine(params)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(target: &str, host: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nAccept: */*\r\n\r\n")
    }

    #[test]
    fn only_the_redirect_of_this_attempt_is_taken() {
        let mine = interpret(
            &req(
                "/auth/callback?code=c&state=s1&client_id=oaiapp_x",
                "127.0.0.1:1455",
            ),
            1455,
            "s1",
        );
        let Verdict::Mine(p) = mine else {
            panic!("not taken")
        };
        assert_eq!(p.code.as_deref(), Some("c"));
        assert_eq!(p.client_id.as_deref(), Some("oaiapp_x"));

        let refused = [
            req("/auth/callback?code=c&state=other", "127.0.0.1:1455"),
            req("/auth/callback?code=c", "127.0.0.1:1455"),
            req("/callback?code=c&state=s1", "127.0.0.1:1455"),
            req("/auth/callback?code=c&state=s1", "localhost:1455"),
            req("/auth/callback?code=c&state=s1", "evil.example:1455"),
            req("/auth/callback", "127.0.0.1:1455"),
            "POST /auth/callback?code=c&state=s1 HTTP/1.1\r\nHost: 127.0.0.1:1455\r\n\r\n"
                .to_owned(),
            "GARBAGE\r\n\r\n".to_owned(),
        ];
        for r in refused {
            assert!(
                matches!(interpret(&r, 1455, "s1"), Verdict::NotMine(_)),
                "{r}"
            );
        }
    }

    #[test]
    fn a_declined_redirect_is_taken_with_its_error() {
        let v = interpret(
            &req("/auth/callback?error=access_denied&state=s1", "127.0.0.1:9"),
            9,
            "s1",
        );
        let Verdict::Mine(p) = v else {
            panic!("not taken")
        };
        assert_eq!((p.code, p.error.as_deref()), (None, Some("access_denied")));
    }

    #[test]
    fn params_print_nothing() {
        let p = Params {
            code: Some("secret-code".into()),
            ..Params::default()
        };
        assert!(!format!("{p:?}").contains("secret-code"));
    }
}
