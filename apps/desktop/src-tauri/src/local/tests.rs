//! Probe tests: loopback servers shaped like each runtime, plus slow, 401, HTML and nothing-listening, and the rule that
//! nothing but loopback is ever dialled.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;
use crate::providers::ProviderStatus;

/// What a test server answers for a path.
#[derive(Clone)]
enum Reply {
    Json(&'static str),
    Html,
    Status(u16),
    Chunked(&'static str),
    Silent,
}

/// Serve `routes` on an ephemeral loopback port; returns its address and the paths asked, in order.
async fn serve(
    routes: Vec<(&'static str, Reply)>,
) -> (SocketAddr, std::sync::Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
    let log = asked.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = listener.accept().await else {
                return;
            };
            let routes = routes.clone();
            let log = log.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("").to_owned();
                log.lock().unwrap().push(path.clone());
                let reply = routes
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map(|(_, r)| r.clone());
                let out = match reply {
                    Some(Reply::Json(b)) => format!("HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{b}"),
                    Some(Reply::Html) => "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>hello</body></html>".to_owned(),
                    Some(Reply::Status(c)) => format!("HTTP/1.0 {c} X\r\n\r\n{{\"error\":\"no\"}}"),
                    Some(Reply::Chunked(b)) => format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{b}\r\n0\r\n\r\n", b.len()),
                    Some(Reply::Silent) => {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        return;
                    }
                    None => "HTTP/1.0 404 Not Found\r\n\r\n".to_owned(),
                };
                let _ = s.write_all(out.as_bytes()).await;
            });
        }
    });
    (addr, asked)
}

fn way(id: &str) -> Way {
    catalogue().way(id).map(|(_, w)| w.clone()).unwrap()
}

/// The way with a short timeout, for the slow cases.
fn quick(id: &str) -> Way {
    let mut w = way(id);
    w.discovery.timeout_ms = Some(300);
    w
}

async fn state(id: &str, addr: SocketAddr) -> ProviderState {
    let w = quick(id);
    state_for("x", &w, addr, ask(&w, addr).await)
}

const OLLAMA: &str = r#"{"models":[{"name":"llama3.2:latest","size":1},{"name":"qwen3:8b"}]}"#;

#[tokio::test]
async fn ollama_lists_its_models() {
    let (addr, _) = serve(vec![("/api/tags", Reply::Json(OLLAMA))]).await;
    let s = state("ollama.local", addr).await;
    assert_eq!(s.status, ProviderStatus::FoundLocal);
    assert_eq!(s.models_count, Some(2));
    assert_eq!(s.detail.as_deref(), Some("llama3.2:latest, qwen3:8b"));
    assert_eq!(s.base_url.as_deref(), Some("http://127.0.0.1:11434/v1"));
    assert!(s.checked_at.is_some() && s.is_consistent());
}

#[tokio::test]
async fn ollama_falls_back_to_the_openai_listing() {
    let (addr, asked) = serve(vec![(
        "/v1/models",
        Reply::Json(r#"{"data":[{"id":"phi4"}]}"#),
    )])
    .await;
    let s = state("ollama.local", addr).await;
    assert_eq!(s.models_count, Some(1));
    assert_eq!(*asked.lock().unwrap(), vec!["/api/tags", "/v1/models"]);
}

#[tokio::test]
async fn lm_studio_skips_embedding_models() {
    let body = r#"{"models":[{"type":"llm","key":"qwen/qwen3-4b"},{"type":"embedding","key":"nomic-embed"}]}"#;
    let (addr, _) = serve(vec![("/api/v1/models", Reply::Json(body))]).await;
    let s = state("lm-studio.local", addr).await;
    assert_eq!(s.models_count, Some(1));
    assert_eq!(s.detail.as_deref(), Some("qwen/qwen3-4b"));
}

#[tokio::test]
async fn llama_cpp_is_known_by_its_props() {
    let body = r#"{"default_generation_settings":{},"total_slots":1,"model_path":"/models/Qwen3-8B-Q4.gguf"}"#;
    let (addr, _) = serve(vec![("/props", Reply::Json(body))]).await;
    let s = state("llama-cpp.local", addr).await;
    assert_eq!(s.status, ProviderStatus::FoundLocal);
    assert_eq!(s.detail.as_deref(), Some("Qwen3-8B-Q4.gguf"));
    let (addr, _) = serve(vec![("/props", Reply::Json(r#"{"total_slots":2}"#))]).await;
    let s = state("llama-cpp.local", addr).await;
    assert_eq!(
        s.models_count,
        Some(1),
        "a llama.cpp server that does not name its model still serves one"
    );
}

#[tokio::test]
async fn vllm_lists_models_and_reads_a_chunked_answer() {
    let (addr, _) = serve(vec![("/v1/models", Reply::Chunked(r#"{"object":"list","data":[{"id":"meta/llama"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"}]}"#))]).await;
    let s = state("vllm.local", addr).await;
    assert_eq!(s.models_count, Some(5));
    assert_eq!(s.detail.as_deref(), Some("meta/llama, b, c and 2 more"));
}

#[tokio::test]
async fn a_runtime_with_no_models_is_found_with_none() {
    let (addr, _) = serve(vec![("/v1/models", Reply::Json(r#"{"data":[]}"#))]).await;
    let s = state("vllm.local", addr).await;
    assert_eq!(
        (s.status, s.models_count),
        (ProviderStatus::FoundLocal, Some(0))
    );
}

#[tokio::test]
async fn html_and_other_services_are_not_a_runtime() {
    let (addr, _) = serve(vec![
        ("/v1/models", Reply::Html),
        ("/props", Reply::Json(r#"{"hello":"world"}"#)),
        ("/api/tags", Reply::Json(r"[1,2]")),
    ])
    .await;
    for id in ["vllm.local", "llama-cpp.local", "ollama.local"] {
        let s = state(id, addr).await;
        assert_eq!(s.status, ProviderStatus::NotFound, "{id}");
        assert!(s.is_consistent());
    }
}

#[tokio::test]
async fn a_401_is_a_problem_that_says_what_to_do() {
    let (addr, _) = serve(vec![("/v1/models", Reply::Status(401))]).await;
    let s = state("vllm.local", addr).await;
    assert_eq!(s.status, ProviderStatus::Error);
    assert_eq!(s.code.as_deref(), Some("hx.provider.key_rejected"));
    assert!(s.detail.unwrap().contains("endpoint"));
}

#[tokio::test]
async fn a_slow_server_is_cut_off_at_the_timeout() {
    let (addr, _) = serve(vec![("/v1/models", Reply::Silent)]).await;
    let began = std::time::Instant::now();
    let s = state("vllm.local", addr).await;
    assert!(began.elapsed() < Duration::from_secs(2));
    assert_eq!(s.code.as_deref(), Some("hx.provider.unreachable"));
}

#[tokio::test]
async fn nothing_listening_is_not_found() {
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap()
    };
    let s = state("ollama.local", port).await;
    assert_eq!(s.status, ProviderStatus::NotFound);
    assert_eq!(s.detail, None);
}

#[tokio::test]
async fn only_loopback_is_ever_dialled() {
    for ip in [
        IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)),
        IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        "2001:db8::1".parse().unwrap(),
    ] {
        let began = std::time::Instant::now();
        assert!(matches!(
            dial(SocketAddr::new(ip, 80)).await,
            Err(NotLoopback(_))
        ));
        assert!(
            began.elapsed() < Duration::from_millis(50),
            "refused before any socket"
        );
    }
    // a request to a non-loopback address comes back as "nothing", never as an attempt
    let w = quick("ollama.local");
    assert_eq!(
        ask(
            &w,
            SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)), 11434)
        )
        .await,
        Outcome::Nothing
    );
}

#[test]
fn every_local_way_of_the_catalogue_is_aimed_at_127_0_0_1() {
    let locals: Vec<_> = catalogue()
        .ways()
        .filter(|(_, w)| w.kind == WayKind::Local)
        .collect();
    assert_eq!(locals.len(), 4);
    for (_, w) in locals {
        let a = target(w).unwrap_or_else(|| panic!("{} has no loopback target", w.id));
        assert!(a.ip().is_loopback(), "{}", w.id);
        assert_eq!(w.discovery.method, "probe");
    }
    let mut elsewhere = way("ollama.local");
    elsewhere.discovery.host = Some("example.com".into());
    assert_eq!(
        target(&elsewhere),
        None,
        "a catalogue row naming another host is never dialled"
    );
}

#[test]
fn the_default_ports_are_the_runtimes_own() {
    let port = |id: &str| target(&way(id)).unwrap().port();
    assert_eq!(
        (
            port("ollama.local"),
            port("lm-studio.local"),
            port("llama-cpp.local"),
            port("vllm.local")
        ),
        (11434, 1234, 8080, 8000)
    );
}

#[tokio::test]
async fn probe_local_answers_for_every_local_way_and_keeps_it() {
    let states = probe_local().await;
    assert_eq!(states.len(), 4);
    assert!(
        states
            .iter()
            .all(|s| s.kind == WayKind::Local && s.is_consistent() && s.checked_at.is_some())
    );
    assert_eq!(last().len(), 4);
    assert_eq!(
        last_for("vllm.local").map(|s| s.way),
        Some("vllm.local".to_owned())
    );
}
