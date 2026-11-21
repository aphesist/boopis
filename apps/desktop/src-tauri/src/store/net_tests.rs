//! The fetcher against a loopback server that answers as hostile or broken sources do: oversized bodies, redirects to hosts
//! that are not allowed, redirect loops, rate limits, a server that never answers. The real HTTPS stack is `ureq`; only the
//! scheme differs (loopback `http`, which [`Hosts::with_loopback_http`] allows and nothing else does).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::net::{Ask, Fetcher, Hosts, Https, read_capped, retry_after_s};
use crate::config::StoreLimits;

type Handler = dyn Fn(&str, &[(String, String)]) -> Vec<u8> + Send + Sync;

struct Server {
    port: u16,
    seen: Arc<Mutex<Vec<(String, Vec<(String, String)>)>>>,
}

fn http(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    let mut b = out.into_bytes();
    b.extend_from_slice(body);
    b
}

fn serve(handler: impl Fn(&str, &[(String, String)]) -> Vec<u8> + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (s2, h): (_, Arc<Handler>) = (seen.clone(), Arc::new(handler));
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (s3, h2) = (s2.clone(), h.clone());
            std::thread::spawn(move || answer(stream, &s3, &*h2));
        }
    });
    Server { port, seen }
}

fn answer(mut stream: TcpStream, seen: &Mutex<Vec<(String, Vec<(String, String)>)>>, h: &Handler) {
    let mut r = BufReader::new(stream.try_clone().unwrap());
    let mut first = String::new();
    if r.read_line(&mut first).unwrap_or(0) == 0 {
        return;
    }
    let path = first.split_whitespace().nth(1).unwrap_or("/").to_owned();
    let mut headers = Vec::new();
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).unwrap_or(0) == 0 || l.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_owned()));
        }
    }
    seen.lock().unwrap().push((path.clone(), headers.clone()));
    let _ = stream.write_all(&h(&path, &headers));
}

fn fetcher(limits: &StoreLimits) -> Https {
    Https::new(limits)
}

fn local() -> Hosts {
    Hosts::new(&[]).with_loopback_http()
}

fn ask(max: u64) -> Ask<'static> {
    Ask { max_bytes: max, etag: None, accept: None }
}

fn url(s: &Server, path: &str) -> String {
    format!("http://127.0.0.1:{}{path}", s.port)
}

fn code(r: crate::error::Result<super::net::Reply>) -> String {
    r.map(|r| format!("ok {}", r.status)).unwrap_or_else(|e| e.code().to_owned())
}

#[test]
fn a_plain_answer_comes_back_with_its_etag_and_a_conditional_one_is_not_sent_again() {
    let s = serve(|_, h| {
        if h.iter().any(|(k, v)| k == "if-none-match" && v == "\"v1\"") {
            http("304 Not Modified", &[], b"")
        } else {
            http("200 OK", &[("ETag", "\"v1\"")], b"{\"a\":1}")
        }
    });
    let f = fetcher(&StoreLimits::default());
    let r = f.get(&url(&s, "/c.json"), &local(), &ask(1024)).unwrap();
    assert_eq!((r.status, r.body.as_slice(), r.etag.as_deref()), (200, &b"{\"a\":1}"[..], Some("\"v1\"")));
    let again = f.get(&url(&s, "/c.json"), &local(), &Ask { etag: r.etag.as_deref(), ..ask(1024) }).unwrap();
    assert_eq!((again.status, again.body.len(), again.etag.as_deref()), (304, 0, Some("\"v1\"")));
}

#[test]
fn a_body_over_the_cap_is_too_large_and_one_at_the_cap_is_not() {
    let s = serve(|_, _| http("200 OK", &[], &[b'x'; 2048]));
    let f = fetcher(&StoreLimits::default());
    assert_eq!(code(f.get(&url(&s, "/big"), &local(), &ask(2047))), "hx.store.too_large");
    assert_eq!(code(f.get(&url(&s, "/big"), &local(), &ask(2048))), "ok 200");
    assert_eq!(read_capped(&b"abc"[..], 3).unwrap(), b"abc");
    assert_eq!(read_capped(&b"abcd"[..], 3).unwrap_err().code(), "hx.store.too_large");
}

#[test]
fn a_redirect_is_followed_inside_the_list_and_refused_outside_it() {
    let s = serve(|p, _| match p {
        "/a" => http("302 Found", &[("Location", "/b")], b""),
        "/b" => http("301 Moved", &[("Location", "/c")], b""),
        "/c" => http("200 OK", &[], b"end"),
        "/out" => http("302 Found", &[("Location", "https://evil.example/steal")], b""),
        "/plain" => http("302 Found", &[("Location", "http://127.0.0.1:1/x")], b""),
        "/cred" => http("302 Found", &[("Location", "https://user:pw@github.com/x")], b""),
        "/loop" => http("302 Found", &[("Location", "/loop")], b""),
        "/none" => http("302 Found", &[], b""),
        _ => http("404 Not Found", &[], b""),
    });
    let f = fetcher(&StoreLimits::default());
    let r = f.get(&url(&s, "/a"), &local(), &ask(100)).unwrap();
    assert_eq!(r.body, b"end");
    assert!(r.final_url.ends_with("/c"));
    for p in ["/out", "/cred", "/loop", "/none"] {
        assert_eq!(code(f.get(&url(&s, p), &local(), &ask(100))), "hx.store.source_unreachable", "{p}");
    }
    // `/plain` redirects to a loopback address nothing listens on: it is allowed by the list and fails to connect.
    assert_eq!(code(f.get(&url(&s, "/plain"), &local(), &ask(100))), "hx.store.source_unreachable");
    // The redirect to a refused host was never requested: the server saw no second hop for `/out`.
    assert!(!s.seen.lock().unwrap().iter().any(|(p, _)| p == "/steal"));
}

#[test]
fn the_redirect_cap_counts_hops() {
    let s = serve(|p, _| {
        let n: u32 = p.trim_start_matches("/h").parse().unwrap_or(0);
        if n < 4 { http("302 Found", &[("Location", &format!("/h{}", n + 1))], b"") } else { http("200 OK", &[], b"ok") }
    });
    let few = StoreLimits { max_redirects: 3, ..StoreLimits::default() };
    assert_eq!(code(fetcher(&few).get(&url(&s, "/h0"), &local(), &ask(10))), "hx.store.source_unreachable");
    let enough = StoreLimits { max_redirects: 4, ..StoreLimits::default() };
    assert_eq!(code(fetcher(&enough).get(&url(&s, "/h0"), &local(), &ask(10))), "ok 200");
}

#[test]
fn a_host_that_is_not_listed_and_a_plain_address_are_refused_before_any_request() {
    let s = serve(|_, _| http("200 OK", &[], b"x"));
    let f = fetcher(&StoreLimits::default());
    let strict = Hosts::new(&[]);
    assert_eq!(code(f.get(&url(&s, "/"), &strict, &ask(10))), "hx.store.source_unreachable", "http is for tests only");
    assert!(s.seen.lock().unwrap().is_empty(), "nothing reached the server");
    assert_eq!(code(f.get("https://example.com/x", &strict, &ask(10))), "hx.store.source_unreachable", "not on the list");
    assert_eq!(code(f.get("https://user:pw@github.com/x", &strict, &ask(10))), "hx.store.source_unreachable");
    assert_eq!(code(f.get("file:///etc/passwd", &strict, &ask(10))), "hx.store.source_unreachable");
    assert_eq!(code(f.get("not a url", &strict, &ask(10))), "hx.store.source_unreachable");
    let added = Hosts::new(&["Example.COM".to_owned()]);
    assert!(added.check(&url::Url::parse("https://example.com/x").unwrap()).is_ok(), "a source the user added");
    assert!(added.check(&url::Url::parse("https://github.com/x").unwrap()).is_ok());
    assert!(added.check(&url::Url::parse("https://other.example.com/x").unwrap()).is_err(), "exact hosts, no wildcard");
}

#[test]
fn limits_become_rate_limited_with_the_seconds_to_wait() {
    let s = serve(|p, _| match p {
        "/429" => http("429 Too Many Requests", &[("Retry-After", "120")], b""),
        "/403" => http("403 Forbidden", &[("X-RateLimit-Remaining", "0"), ("X-RateLimit-Reset", "1999999999")], b""),
        "/403plain" => http("403 Forbidden", &[], b""),
        "/500" => http("500 Server Error", &[], b""),
        _ => http("404 Not Found", &[], b""),
    });
    let f = fetcher(&StoreLimits::default());
    let e = f.get(&url(&s, "/429"), &local(), &ask(10)).unwrap_err();
    assert_eq!(e.code(), "hx.store.rate_limited");
    assert_eq!(retry_after_s(&e.to_string()), Some(120));
    let e = f.get(&url(&s, "/403"), &local(), &ask(10)).unwrap_err();
    assert_eq!(e.code(), "hx.store.rate_limited");
    assert_eq!(retry_after_s(&e.to_string()), Some(60), "a reset time is not trusted as a duration");
    for p in ["/403plain", "/500", "/nowhere"] {
        assert_eq!(code(f.get(&url(&s, p), &local(), &ask(10))), "hx.store.source_unreachable", "{p}");
    }
}

#[test]
fn a_server_that_never_answers_ends_at_the_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut s in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf);
                std::thread::sleep(Duration::from_secs(5));
            });
        }
    });
    let quick = StoreLimits { request_timeout: Duration::from_millis(300), ..StoreLimits::default() };
    let started = std::time::Instant::now();
    assert_eq!(code(fetcher(&quick).get(&format!("http://127.0.0.1:{port}/"), &local(), &ask(10))), "hx.store.source_unreachable");
    assert!(started.elapsed() < Duration::from_secs(3));
}
