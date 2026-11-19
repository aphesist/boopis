//! The stdio server, driven over in-memory pipes with a test handler that can be gated.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use hx::serve::{ServeOptions, serve};
use hx_proto::AppError;
use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::{Semaphore, mpsc};
use tokio_util::sync::CancellationToken;

/// A handler in the reserved `pack` namespace that blocks until the test releases it.
struct Gate {
    started: mpsc::UnboundedSender<String>,
    release: Arc<Semaphore>,
    running: AtomicUsize,
    max_seen: Arc<AtomicUsize>,
}

impl Handler for Gate {
    fn namespace(&self) -> Namespace {
        Namespace::Pack
    }
    fn methods(&self) -> &'static [&'static str] {
        &["pack.gate", "pack.panic"]
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["test.gate".into()]
    }
    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        Box::pin(async move {
            assert!(method != "pack.panic", "boom"); // The test's deliberate handler panic.
            let name = params["name"].as_str().unwrap_or("?").to_owned();
            let now = self.running.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_seen.fetch_max(now, Ordering::SeqCst);
            let _ = self.started.send(name.clone());
            let outcome = tokio::select! {
                () = ctx.cancel.cancelled() => Err(AppError::cancelled()),
                permit = self.release.acquire() => {
                    permit.map(tokio::sync::SemaphorePermit::forget).map_err(|e| AppError::internal(e.to_string()))?;
                    Ok(json!({"name": name}))
                }
            };
            self.running.fetch_sub(1, Ordering::SeqCst);
            outcome
        })
    }
}

struct Harness {
    input: DuplexStream,
    output: tokio::io::Lines<BufReader<DuplexStream>>,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
    started: mpsc::UnboundedReceiver<String>,
    release: Arc<Semaphore>,
    max_seen: Arc<AtomicUsize>,
    shutdown: CancellationToken,
}

fn harness(max_concurrency: usize) -> Harness {
    let (started_tx, started) = mpsc::unbounded_channel();
    let release = Arc::new(Semaphore::new(0));
    let max_seen = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = hx::build_dispatcher();
    dispatcher
        .register(Arc::new(Gate {
            started: started_tx,
            release: Arc::clone(&release),
            running: AtomicUsize::new(0),
            max_seen: Arc::clone(&max_seen),
        }))
        .unwrap();
    let (client_tx, server_rx) = tokio::io::duplex(1 << 16);
    let (server_tx, client_rx) = tokio::io::duplex(1 << 16);
    let shutdown = CancellationToken::new();
    let opts = ServeOptions {
        max_concurrency,
        ..ServeOptions::default()
    };
    let server = tokio::spawn(serve(
        server_rx,
        server_tx,
        Arc::new(dispatcher),
        opts,
        shutdown.clone(),
    ));
    Harness {
        input: client_tx,
        output: BufReader::new(client_rx).lines(),
        server,
        started,
        release,
        max_seen,
        shutdown,
    }
}

impl Harness {
    async fn send(&mut self, v: Value) {
        self.send_raw(&v.to_string()).await;
    }
    async fn send_raw(&mut self, s: &str) {
        self.input.write_all(s.as_bytes()).await.unwrap();
        self.input.write_all(b"\n").await.unwrap();
    }
    async fn recv(&mut self) -> Value {
        let line = self
            .output
            .next_line()
            .await
            .unwrap()
            .expect("a response frame");
        serde_json::from_str(&line).expect("every output line is a JSON frame")
    }
    /// Closes the input (EOF) and waits for a clean exit.
    async fn finish(mut self) -> Vec<Value> {
        self.input.shutdown().await.unwrap();
        let mut rest = Vec::new();
        while let Some(line) = self.output.next_line().await.unwrap() {
            rest.push(serde_json::from_str(&line).unwrap());
        }
        self.server.await.unwrap().unwrap();
        rest
    }
}

#[allow(clippy::needless_pass_by_value)] // Call sites pass `json!(..)` literals; borrowing would add noise.
fn req(id: i64, method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

fn code(resp: &Value) -> &str {
    resp["error"]["data"]["code"].as_str().unwrap_or("")
}

#[tokio::test]
async fn describe_round_trips_and_eof_ends_the_server_cleanly() {
    let mut h = harness(2);
    h.send(req(1, "hx.describe", Value::Null)).await;
    let r = h.recv().await;
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["protocol"], "hx-v1");
    assert!(
        r["result"]["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == "txn.edit.replace")
    );
    assert_eq!(h.finish().await, Vec::<Value>::new());
}

#[tokio::test]
async fn protocol_errors_are_answered_not_fatal() {
    let mut h = harness(2);
    h.send_raw("{broken").await;
    let r = h.recv().await;
    assert_eq!(
        (r["id"].clone(), r["error"]["code"].clone()),
        (Value::Null, json!(-32700))
    );
    h.send_raw("[1,2]").await;
    assert_eq!(h.recv().await["error"]["code"], -32600);
    h.send_raw("").await; // blank lines are ignored
    h.send(req(5, "nope.nope", Value::Null)).await;
    let r = h.recv().await;
    assert_eq!(
        (r["id"].clone(), code(&r)),
        (json!(5), "hx.method_not_found")
    );
    h.send(req(6, "txn.apply", json!({"root": 1}))).await;
    assert_eq!(code(&h.recv().await), "hx.invalid_params");
    // A notification gets no answer, and the server is still alive afterwards.
    h.send(json!({"jsonrpc": "2.0", "method": "client.hello"}))
        .await;
    h.send(req(7, "hx.describe", Value::Null)).await;
    assert_eq!(h.recv().await["id"], 7);
    h.finish().await;
}

#[tokio::test]
async fn string_ids_and_invalid_utf8() {
    let mut h = harness(2);
    h.send(json!({"jsonrpc": "2.0", "id": "abc", "method": "hx.describe"}))
        .await;
    assert_eq!(h.recv().await["id"], "abc");
    h.input.write_all(&[0xff, 0xfe, b'\n']).await.unwrap();
    assert_eq!(code(&h.recv().await), "hx.parse_error");
    h.finish().await;
}

#[tokio::test]
async fn oversized_frames_are_rejected_and_the_stream_resyncs() {
    let (client_tx, server_rx) = tokio::io::duplex(1 << 16);
    let (server_tx, client_rx) = tokio::io::duplex(1 << 16);
    let opts = ServeOptions {
        max_frame_bytes: 200,
        ..ServeOptions::default()
    };
    let server = tokio::spawn(serve(
        server_rx,
        server_tx,
        Arc::new(hx::build_dispatcher()),
        opts,
        CancellationToken::new(),
    ));
    let mut input = client_tx;
    let mut lines = BufReader::new(client_rx).lines();
    let big = format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"hx.describe\",\"pad\":\"{}\"}}\n",
        "x".repeat(5000)
    );
    input.write_all(big.as_bytes()).await.unwrap();
    input
        .write_all(req(2, "hx.describe", Value::Null).to_string().as_bytes())
        .await
        .unwrap();
    input.write_all(b"\n").await.unwrap();
    let first: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(code(&first), "hx.frame_too_large");
    let second: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(second["id"], 2);
    input.shutdown().await.unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn concurrency_is_bounded() {
    let mut h = harness(2);
    for i in 1..=5 {
        h.send(req(i, "pack.gate", json!({"name": format!("r{i}")})))
            .await;
    }
    // Two start; the rest wait for a permit.
    let a = h.started.recv().await.unwrap();
    let b = h.started.recv().await.unwrap();
    assert_ne!(a, b);
    let mut answered = Vec::new();
    for _ in 0..5 {
        h.release.add_permits(1);
        answered.push(
            h.recv().await["result"]["name"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    answered.sort();
    assert_eq!(answered, ["r1", "r2", "r3", "r4", "r5"]);
    assert_eq!(
        h.max_seen.load(Ordering::SeqCst),
        2,
        "never more than max_concurrency at once"
    );
    h.finish().await;
}

#[tokio::test]
async fn a_running_request_can_be_cancelled() {
    let mut h = harness(2);
    h.send(req(1, "pack.gate", json!({"name": "x"}))).await;
    h.started.recv().await.unwrap();
    h.send(json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": 1}}))
        .await;
    let r = h.recv().await;
    assert_eq!((r["id"].clone(), code(&r)), (json!(1), "hx.cancelled"));
    h.finish().await;
}

#[tokio::test]
async fn a_queued_request_is_cancelled_without_running() {
    let mut h = harness(1);
    h.send(req(1, "pack.gate", json!({"name": "first"}))).await;
    assert_eq!(h.started.recv().await.unwrap(), "first");
    h.send(req(2, "pack.gate", json!({"name": "queued"}))).await;
    h.send(json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": 2}}))
        .await;
    let r = h.recv().await;
    assert_eq!((r["id"].clone(), code(&r)), (json!(2), "hx.cancelled"));
    h.release.add_permits(1);
    assert_eq!(h.recv().await["result"]["name"], "first");
    assert!(
        h.started.try_recv().is_err(),
        "the queued request never started"
    );
    h.finish().await;
}

#[tokio::test]
async fn a_duplicate_in_flight_id_is_refused() {
    let mut h = harness(2);
    h.send(req(1, "pack.gate", json!({"name": "a"}))).await;
    h.started.recv().await.unwrap();
    h.send(req(1, "pack.gate", json!({"name": "b"}))).await;
    assert_eq!(code(&h.recv().await), "hx.invalid_request");
    h.release.add_permits(1);
    assert_eq!(h.recv().await["result"]["name"], "a");
    h.finish().await;
}

#[tokio::test]
async fn a_panicking_handler_becomes_an_error_and_the_server_survives() {
    let mut h = harness(2);
    h.send(req(1, "pack.panic", Value::Null)).await;
    assert_eq!(code(&h.recv().await), "hx.internal_error");
    h.send(req(2, "hx.describe", Value::Null)).await;
    assert_eq!(h.recv().await["id"], 2);
    h.finish().await;
}

#[tokio::test]
async fn eof_lets_accepted_requests_finish_and_answer() {
    let mut h = harness(2);
    h.send(req(1, "pack.gate", json!({"name": "slow"}))).await;
    h.started.recv().await.unwrap();
    h.input.shutdown().await.unwrap();
    h.release.add_permits(1);
    let r = h.recv().await;
    assert_eq!(r["result"]["name"], "slow");
    h.server.await.unwrap().unwrap();
}

#[tokio::test]
async fn a_shutdown_signal_cancels_running_requests_and_stops() {
    let mut h = harness(2);
    h.send(req(1, "pack.gate", json!({"name": "x"}))).await;
    h.started.recv().await.unwrap();
    h.shutdown.cancel();
    assert_eq!(code(&h.recv().await), "hx.cancelled");
    h.server.await.unwrap().unwrap();
}

#[tokio::test]
async fn transactions_work_end_to_end_over_the_wire() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("ws");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.txt"), "hello\n").unwrap();
    let journals = tmp.path().join("journals");
    let (root_s, journals_s) = (
        root.to_string_lossy().into_owned(),
        journals.to_string_lossy().into_owned(),
    );

    let mut h = harness(4);
    h.send(req(1, "txn.apply", json!({
        "root": root_s, "journal_dir": journals_s, "protected": [],
        "edits": [{"op": "replace", "path": "a.txt", "old": "hello", "new": "goodbye"}, {"op": "create", "path": "b.txt", "content": "new\n"}]
    })))
    .await;
    let applied = h.recv().await;
    let id = applied["result"]["journal_id"].as_str().unwrap().to_owned();
    assert_eq!(applied["result"]["files"].as_array().unwrap().len(), 2);
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "goodbye\n"
    );

    // A miss is an error with the closest match in data.failures.
    h.send(req(2, "txn.apply", json!({
        "root": root_s, "journal_dir": journals_s, "protected": [],
        "edits": [{"op": "replace", "path": "a.txt", "old": "goodby", "new": "x"}, {"op": "replace", "path": "a.txt", "old": "goodbye\nmore", "new": "y"}]
    })))
    .await;
    let miss = h.recv().await;
    assert_eq!(
        (miss["error"]["code"].clone(), code(&miss)),
        (json!(-32000), "hx.txn.aborted_before_write")
    );
    // "goodby" is a substring of "goodbye" and matches exactly; the second edit is the miss.
    let failures = miss["error"]["data"]["failures"].as_array().unwrap();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0]["edit_index"], 1);
    assert_eq!(failures[0]["kind"], "no_match");
    assert_eq!(failures[0]["closest"]["start_line"], 1);

    h.send(req(
        3,
        "txn.restore",
        json!({"journal_dir": journals_s, "journal_id": id, "root": root_s}),
    ))
    .await;
    let restored = h.recv().await;
    assert_eq!(restored["result"]["removed"], json!(["b.txt"]));
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "hello\n"
    );
    assert!(!root.join("b.txt").exists());

    h.send(req(4, "txn.recover", json!({"journal_dir": journals_s})))
        .await;
    assert_eq!(h.recv().await["result"]["pending"], json!([]));
    h.finish().await;
}
