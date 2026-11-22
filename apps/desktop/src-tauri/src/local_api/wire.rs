//! The endpoint's rules, as pure functions: reading a request head, deciding whether a request may be served, and the two
//! limiters. Every refusal is a [`Reject`] with a status, a stable code and a sentence that says what to do and echoes
//! nothing the client sent (`ADR-0045`). The order of the checks is part of the model: the shape of the request, the
//! `Host`, the `Origin`, the method, then the token. Nothing before the token is checked tells a stranger anything.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::token::Token;
use crate::config::ApiLimits;

/// A refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reject {
    /// The HTTP status.
    pub status: u16,
    /// A stable code.
    pub code: &'static str,
    /// The sentence.
    pub message: &'static str,
}

const fn reject(status: u16, code: &'static str, message: &'static str) -> Reject {
    Reject {
        status,
        code,
        message,
    }
}

/// The methods the endpoint serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// A read.
    Get,
    /// A write.
    Post,
}

/// A request head, read and checked for shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    /// The method.
    pub method: Method,
    /// The path, with no query.
    pub path: String,
    /// The query's pairs, undecoded (the endpoint accepts only plain tokens in them).
    pub query: Vec<(String, String)>,
    /// The headers, names lowercased, in order.
    pub headers: Vec<(String, String)>,
}

impl Head {
    /// The value of a header (the first of that name).
    #[must_use]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn count(&self, name: &str) -> usize {
        self.headers.iter().filter(|(k, _)| k == name).count()
    }

    /// A query value.
    #[must_use]
    pub fn param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// Where a head ends in what has been read so far: the index just past the blank line.
#[must_use]
pub fn head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn token_chars(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

/// Read a request head.
///
/// # Errors
/// A refusal for anything that is not a well-formed, plain HTTP/1.1 request within the caps.
pub fn parse_head(raw: &[u8], limits: &ApiLimits) -> Result<Head, Reject> {
    if raw.len() > limits.max_head {
        return Err(reject(
            431,
            "head_too_large",
            "The request's headers are too large.",
        ));
    }
    let Ok(text) = std::str::from_utf8(raw) else {
        return Err(reject(400, "bad_request", "The request is not valid text."));
    };
    let mut lines = text.trim_end_matches("\r\n\r\n").split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut words = first.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (words.next(), words.next(), words.next(), words.next())
    else {
        return Err(reject(
            400,
            "bad_request",
            "The request line is not well formed.",
        ));
    };
    if version != "HTTP/1.1" {
        return Err(reject(505, "http_version", "Use HTTP/1.1."));
    }
    if target.len() > limits.max_target {
        return Err(reject(
            414,
            "target_too_long",
            "The request address is too long.",
        ));
    }
    let method = match method {
        "GET" => Method::Get,
        "POST" => Method::Post,
        _ => {
            return Err(reject(
                405,
                "method_not_allowed",
                "Only GET and POST are served.",
            ));
        }
    };
    if !target.starts_with('/')
        || target.starts_with("//")
        || target
            .bytes()
            .any(|b| b <= b' ' || b == b'%' || b == b'#' || b == b'\\')
    {
        return Err(reject(
            400,
            "bad_target",
            "The request address is not accepted.",
        ));
    }
    let (path, query_text) = target.split_once('?').unwrap_or((target, ""));
    let mut query = Vec::new();
    for pair in query_text.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if !token_chars(k) || (!v.is_empty() && !token_chars(v)) || query.len() >= 8 {
            return Err(reject(
                400,
                "bad_query",
                "The request's query is not accepted.",
            ));
        }
        query.push((k.to_owned(), v.to_owned()));
    }
    let mut headers = Vec::new();
    for line in lines {
        if headers.len() >= limits.max_headers {
            return Err(reject(
                431,
                "too_many_headers",
                "The request has too many headers.",
            ));
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(reject(400, "bad_header", "A header is not well formed."));
        };
        if name.is_empty()
            || name
                .bytes()
                .any(|b| !(b.is_ascii_alphanumeric() || b == b'-'))
        {
            return Err(reject(400, "bad_header", "A header is not well formed."));
        }
        let value = value.trim();
        if value.bytes().any(|b| b < b' ' && b != b'\t') {
            return Err(reject(400, "bad_header", "A header is not well formed."));
        }
        headers.push((name.to_ascii_lowercase(), value.to_owned()));
    }
    Ok(Head {
        method,
        path: path.to_owned(),
        query,
        headers,
    })
}

/// The checks that come before the token: the `Host` and the `Origin` of a browser, and the shape of the body.
///
/// # Errors
/// The refusal.
pub fn check_origin(head: &Head, port: u16) -> Result<(), Reject> {
    // DNS rebinding: a page of another site reaches this port under a name it controls, and says so in `Host`.
    if head.count("host") != 1 {
        return Err(reject(400, "bad_host", "This address is not accepted."));
    }
    let host = head.header("host").unwrap_or_default().to_ascii_lowercase();
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return Err(reject(
            403,
            "bad_host",
            "This address is not accepted. Use 127.0.0.1.",
        ));
    }
    // This is not a web API: a browser always sends `Origin` on a cross-site request and `Sec-Fetch-*` on every one.
    if head.header("origin").is_some()
        || head
            .headers
            .iter()
            .any(|(k, _)| k.starts_with("sec-fetch-"))
    {
        return Err(reject(
            403,
            "browser_refused",
            "Browsers may not call this endpoint.",
        ));
    }
    if head.header("access-control-request-method").is_some() {
        return Err(reject(
            403,
            "browser_refused",
            "Browsers may not call this endpoint.",
        ));
    }
    for banned in ["transfer-encoding", "expect", "upgrade", "te", "trailer"] {
        if head.header(banned).is_some() {
            return Err(reject(
                400,
                "unsupported",
                "That header is not supported here.",
            ));
        }
    }
    Ok(())
}

/// The body's declared length, checked for the method.
///
/// # Errors
/// The refusal.
pub fn body_length(head: &Head, limits: &ApiLimits) -> Result<usize, Reject> {
    if head.count("content-length") > 1 {
        return Err(reject(
            400,
            "bad_length",
            "The request's length is not accepted.",
        ));
    }
    let declared = match head.header("content-length") {
        None => None,
        Some(v) if !v.is_empty() && v.len() <= 8 && v.bytes().all(|b| b.is_ascii_digit()) => {
            v.parse::<usize>().ok()
        }
        Some(_) => {
            return Err(reject(
                400,
                "bad_length",
                "The request's length is not accepted.",
            ));
        }
    };
    match head.method {
        Method::Get => match declared {
            None | Some(0) => Ok(0),
            Some(_) => Err(reject(400, "unexpected_body", "A read takes no body.")),
        },
        Method::Post => {
            let n = declared
                .ok_or_else(|| reject(411, "length_required", "A write needs a Content-Length."))?;
            if n > limits.max_body {
                return Err(reject(
                    413,
                    "body_too_large",
                    "The request's body is too large.",
                ));
            }
            let kind = head
                .header("content-type")
                .unwrap_or_default()
                .to_ascii_lowercase();
            let kind = kind.split(';').next().unwrap_or_default().trim().to_owned();
            if kind != "application/json" {
                return Err(reject(
                    415,
                    "content_type",
                    "Send the body as application/json.",
                ));
            }
            Ok(n)
        }
    }
}

/// Whether the request carries this token, in constant time.
#[must_use]
pub fn authorized(head: &Head, token: &Token) -> bool {
    if head.count("authorization") != 1 {
        return false;
    }
    let value = head.header("authorization").unwrap_or_default();
    let presented = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "));
    presented.is_some_and(|p| token.matches(p.trim()))
}

/// A token bucket.
#[derive(Debug, Clone)]
pub struct Bucket {
    tokens: f64,
    rate: f64,
    burst: f64,
    last: Instant,
}

impl Bucket {
    /// A full bucket of `burst`, refilled `per_second` a second.
    #[must_use]
    pub fn new((per_second, burst): (u32, u32), now: Instant) -> Self {
        Self {
            tokens: f64::from(burst),
            rate: f64::from(per_second),
            burst: f64::from(burst),
            last: now,
        }
    }

    /// Take one; false when the bucket is empty.
    pub fn take(&mut self, now: Instant) -> bool {
        let gained = now.saturating_duration_since(self.last).as_secs_f64() * self.rate;
        self.tokens = (self.tokens + gained).min(self.burst);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Wrong tokens, counted: too many in a window and the door is shut for a while, to everyone.
#[derive(Debug, Default)]
pub struct DoorGuard {
    failures: VecDeque<Instant>,
    shut_until: Option<Instant>,
}

impl DoorGuard {
    /// Whether the door is shut now.
    #[must_use]
    pub fn shut(&self, now: Instant) -> bool {
        self.shut_until.is_some_and(|t| now < t)
    }

    /// A wrong token. Returns true when this one shut the door.
    pub fn failed(&mut self, now: Instant, limits: &ApiLimits) -> bool {
        self.failures.push_back(now);
        while self
            .failures
            .front()
            .is_some_and(|t| now.saturating_duration_since(*t) > limits.auth_window)
        {
            self.failures.pop_front();
        }
        if self.failures.len() >= usize::try_from(limits.auth_failures).unwrap_or(usize::MAX) {
            self.failures.clear();
            self.shut_until = Some(now + limits.auth_lockout);
            return true;
        }
        false
    }

    /// A right token: the count starts over.
    pub fn succeeded(&mut self) {
        self.failures.clear();
    }

    /// How long until the door opens again.
    #[must_use]
    pub fn wait(&self, now: Instant) -> Duration {
        self.shut_until
            .map_or(Duration::ZERO, |t| t.saturating_duration_since(now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 47_821;

    fn limits() -> ApiLimits {
        ApiLimits::default()
    }

    fn req(lines: &[&str]) -> Vec<u8> {
        let mut s = lines.join("\r\n");
        s.push_str("\r\n\r\n");
        s.into_bytes()
    }

    fn ok_head(extra: &[&str]) -> Head {
        let mut lines = vec![
            "GET /v1/bots HTTP/1.1",
            "Host: 127.0.0.1:47821",
            "Authorization: Bearer abc",
        ];
        lines.extend_from_slice(extra);
        parse_head(&req(&lines), &limits()).unwrap()
    }

    #[test]
    fn a_plain_request_is_read() {
        let h = parse_head(
            &req(&[
                "GET /v1/notifications?after=3&limit=10 HTTP/1.1",
                "Host: 127.0.0.1:47821",
            ]),
            &limits(),
        )
        .unwrap();
        assert_eq!(
            (h.method, h.path.as_str()),
            (Method::Get, "/v1/notifications")
        );
        assert_eq!(
            (h.param("after"), h.param("limit")),
            (Some("3"), Some("10"))
        );
        assert!(check_origin(&h, PORT).is_ok());
    }

    #[test]
    fn a_malformed_request_is_refused_before_anything_is_read_from_it() {
        let cases: [(&[&str], u16); 11] = [
            (&["GET /v1 HTTP/1.0", "Host: x"], 505),
            (&["PUT /v1 HTTP/1.1", "Host: x"], 405),
            (&["OPTIONS /v1 HTTP/1.1", "Host: x"], 405),
            (&["GET v1 HTTP/1.1", "Host: x"], 400),
            (&["GET //evil.example/x HTTP/1.1", "Host: x"], 400),
            (&["GET /v1/%2e%2e/x HTTP/1.1", "Host: x"], 400),
            (&["GET /v1 HTTP/1.1 extra", "Host: x"], 400),
            (&["GET /v1?a=b c HTTP/1.1"], 400),
            (&["GET /v1 HTTP/1.1", "Bad Header: x"], 400),
            (&["GET /v1 HTTP/1.1", "NoColon"], 400),
            (&["GET /v1?token=a%20b HTTP/1.1", "Host: x"], 400),
        ];
        for (lines, status) in cases {
            let e = parse_head(&req(lines), &limits()).unwrap_err();
            assert_eq!(e.status, status, "{lines:?}");
        }
    }

    #[test]
    fn the_caps_hold() {
        let long = format!("GET /{} HTTP/1.1", "a".repeat(600));
        assert_eq!(
            parse_head(&req(&[&long, "Host: x"]), &limits())
                .unwrap_err()
                .status,
            414
        );
        let many: Vec<String> = (0..40).map(|i| format!("X-H{i}: v")).collect();
        let mut lines = vec!["GET /v1 HTTP/1.1".to_owned()];
        lines.extend(many);
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        assert_eq!(parse_head(&req(&refs), &limits()).unwrap_err().status, 431);
        let huge = vec![b'a'; limits().max_head + 1];
        assert_eq!(parse_head(&huge, &limits()).unwrap_err().status, 431);
        assert_eq!(head_end(b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody"), Some(27));
        assert_eq!(head_end(b"GET / HTTP/1.1\r\nHost: x\r\n"), None);
    }

    #[test]
    fn dns_rebinding_is_refused_by_the_host_header() {
        for host in [
            "evil.example:47821",
            "evil.example",
            "127.0.0.1",
            "127.0.0.1:1",
            "127.0.0.1:47821.evil.example",
            "[::1]:47821",
            "0.0.0.0:47821",
            "",
        ] {
            let h = parse_head(
                &req(&["GET /v1/bots HTTP/1.1", &format!("Host: {host}")]),
                &limits(),
            )
            .unwrap();
            let e = check_origin(&h, PORT).unwrap_err();
            assert_eq!(e.code, "bad_host", "{host:?}");
        }
        for host in ["127.0.0.1:47821", "localhost:47821", "LOCALHOST:47821"] {
            let h = parse_head(
                &req(&["GET /v1/bots HTTP/1.1", &format!("Host: {host}")]),
                &limits(),
            )
            .unwrap();
            assert!(check_origin(&h, PORT).is_ok(), "{host}");
        }
        let none = parse_head(&req(&["GET /v1/bots HTTP/1.1"]), &limits()).unwrap();
        assert_eq!(check_origin(&none, PORT).unwrap_err().code, "bad_host");
        let two = parse_head(
            &req(&[
                "GET /v1/bots HTTP/1.1",
                "Host: 127.0.0.1:47821",
                "Host: evil.example",
            ]),
            &limits(),
        )
        .unwrap();
        assert_eq!(check_origin(&two, PORT).unwrap_err().code, "bad_host");
    }

    #[test]
    fn a_browser_is_refused_by_its_origin_and_fetch_metadata_and_there_is_no_cors() {
        for extra in [
            "Origin: https://evil.example",
            "Origin: null",
            "Origin: http://127.0.0.1:47821",
            "Sec-Fetch-Site: cross-site",
            "Sec-Fetch-Mode: cors",
            "Access-Control-Request-Method: POST",
        ] {
            let h = ok_head(&[extra]);
            assert_eq!(
                check_origin(&h, PORT).unwrap_err().code,
                "browser_refused",
                "{extra}"
            );
        }
        assert_eq!(
            parse_head(
                &req(&[
                    "OPTIONS /v1/bots HTTP/1.1",
                    "Host: 127.0.0.1:47821",
                    "Origin: https://evil.example"
                ]),
                &limits()
            )
            .unwrap_err()
            .status,
            405
        );
    }

    #[test]
    fn smuggling_shapes_are_refused() {
        for extra in [
            "Transfer-Encoding: chunked",
            "Expect: 100-continue",
            "Upgrade: websocket",
            "TE: trailers",
        ] {
            assert_eq!(
                check_origin(&ok_head(&[extra]), PORT).unwrap_err().code,
                "unsupported",
                "{extra}"
            );
        }
        let two = ok_head(&["Content-Length: 1", "Content-Length: 2"]);
        assert_eq!(body_length(&two, &limits()).unwrap_err().code, "bad_length");
    }

    #[test]
    fn a_write_needs_a_length_a_json_type_and_a_size_within_the_cap() {
        let post = |extra: &[&str]| {
            let mut lines = vec!["POST /v1/bots/kai/say HTTP/1.1", "Host: 127.0.0.1:47821"];
            lines.extend_from_slice(extra);
            parse_head(&req(&lines), &limits()).unwrap()
        };
        assert_eq!(
            body_length(
                &post(&["Content-Type: application/json", "Content-Length: 12"]),
                &limits()
            ),
            Ok(12)
        );
        assert_eq!(
            body_length(
                &post(&[
                    "Content-Type: application/json; charset=utf-8",
                    "Content-Length: 0"
                ]),
                &limits()
            ),
            Ok(0)
        );
        for (extra, code) in [
            (vec!["Content-Type: application/json"], "length_required"),
            (
                vec!["Content-Type: text/plain", "Content-Length: 3"],
                "content_type",
            ),
            (vec!["Content-Length: 3"], "content_type"),
            (
                vec!["Content-Type: application/json", "Content-Length: 99999999"],
                "body_too_large",
            ),
            (
                vec![
                    "Content-Type: application/json",
                    "Content-Length: 999999999",
                ],
                "bad_length",
            ),
            (
                vec!["Content-Type: application/json", "Content-Length: 70000"],
                "body_too_large",
            ),
            (
                vec!["Content-Type: application/json", "Content-Length: -1"],
                "bad_length",
            ),
            (
                vec!["Content-Type: application/json", "Content-Length: 1e3"],
                "bad_length",
            ),
        ] {
            assert_eq!(
                body_length(&post(&extra), &limits()).unwrap_err().code,
                code,
                "{extra:?}"
            );
        }
        assert_eq!(
            body_length(&ok_head(&["Content-Length: 4"]), &limits())
                .unwrap_err()
                .code,
            "unexpected_body"
        );
    }

    #[test]
    fn only_the_exact_bearer_token_passes_and_never_by_the_address() {
        let token = Token::from_text("s3cr3t-token".into());
        let with = |value: &str| {
            parse_head(
                &req(&[
                    "GET /v1/bots HTTP/1.1",
                    "Host: 127.0.0.1:47821",
                    &format!("Authorization: {value}"),
                ]),
                &limits(),
            )
            .unwrap()
        };
        assert!(authorized(&with("Bearer s3cr3t-token"), &token));
        for bad in [
            "Bearer s3cr3t-toke",
            "Bearer s3cr3t-token2",
            "Bearer ",
            "s3cr3t-token",
            "Basic s3cr3t-token",
            "Bearer S3CR3T-TOKEN",
        ] {
            assert!(!authorized(&with(bad), &token), "{bad}");
        }
        let none = parse_head(
            &req(&["GET /v1/bots HTTP/1.1", "Host: 127.0.0.1:47821"]),
            &limits(),
        )
        .unwrap();
        assert!(!authorized(&none, &token));
        let query = parse_head(
            &req(&[
                "GET /v1/bots?token=s3cr3t-token HTTP/1.1",
                "Host: 127.0.0.1:47821",
            ]),
            &limits(),
        )
        .unwrap();
        assert!(
            !authorized(&query, &token),
            "a token in the address is never read"
        );
        let two = parse_head(
            &req(&[
                "GET /v1/bots HTTP/1.1",
                "Host: 127.0.0.1:47821",
                "Authorization: Bearer s3cr3t-token",
                "Authorization: Bearer x",
            ]),
            &limits(),
        )
        .unwrap();
        assert!(!authorized(&two, &token));
    }

    #[test]
    fn the_bucket_allows_a_burst_then_the_rate() {
        let t0 = Instant::now();
        let mut b = Bucket::new((2, 6), t0);
        assert_eq!((0..6).filter(|_| b.take(t0)).count(), 6);
        assert!(!b.take(t0));
        assert!(!b.take(t0 + Duration::from_millis(400)));
        assert!(b.take(t0 + Duration::from_millis(600)));
        let mut full = Bucket::new((2, 6), t0);
        assert!(
            (0..10)
                .filter(|_| full.take(t0 + Duration::from_hours(1)))
                .count()
                <= 6,
            "never more than the burst"
        );
    }

    #[test]
    fn five_wrong_tokens_in_ten_seconds_shut_the_door_and_it_opens_again() {
        let t0 = Instant::now();
        let mut g = DoorGuard::default();
        for i in 0..4 {
            assert!(!g.failed(t0 + Duration::from_secs(i), &limits()));
        }
        assert!(!g.shut(t0 + Duration::from_secs(4)));
        assert!(g.failed(t0 + Duration::from_secs(4), &limits()));
        assert!(g.shut(t0 + Duration::from_secs(5)));
        assert!(g.wait(t0 + Duration::from_secs(5)) > Duration::from_secs(8));
        assert!(!g.shut(t0 + Duration::from_secs(15)));
        let mut slow = DoorGuard::default();
        for i in 0..10 {
            assert!(
                !slow.failed(t0 + Duration::from_secs(i * 11), &limits()),
                "slow guessing is not a flood"
            );
        }
    }
}
