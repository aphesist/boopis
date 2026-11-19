//! The proxy against a real, unmodified Hermes gateway and the fake model (`tests/e2e/serve_stack.py`).
//! Skips cleanly (passes with a note) unless `HX_E2E_HERMES_ENV` names the spike install and `python3` runs.
//! Never runs an installer; every process it starts is stopped when the test ends.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines
)] // a test: failing loudly is the point

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use boopis_host::config::Limits;
use boopis_host::endpoint::EndpointConfig;
use boopis_host::error::{Error, Result};
use boopis_host::gateway::{FrameSink, Hub};
use boopis_host::hermes::{Environment, Supervisor};
use serde_json::{Value, json};
use tokio::sync::mpsc;

const WAIT: Duration = Duration::from_mins(1);

/// A running scratch stack; dropping it closes the helper's stdin, which stops the gateway.
struct Stack {
    child: Child,
    info: Value,
}

impl Drop for Stack {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

fn start_stack() -> Option<Stack> {
    std::env::var_os("HX_E2E_HERMES_ENV")?;
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/e2e/serve_stack.py");
    let mut child = Command::new("python3")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut line = String::new();
    BufReader::new(child.stdout.take()?)
        .read_line(&mut line)
        .ok()?;
    let info = serde_json::from_str(line.trim()).ok()?;
    Some(Stack { child, info })
}

struct Collect(mpsc::UnboundedSender<String>);
impl FrameSink for Collect {
    fn send(&self, frame: &str) -> Result<()> {
        self.0
            .send(frame.to_owned())
            .map_err(|_| Error::Io("gone".into()))
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn supervisor(stack: &Stack) -> Arc<Supervisor> {
    let i = &stack.info;
    let env = Environment {
        hermes_home: Some(s(&i["home"])),
        home_dir: Some(PathBuf::from(s(&i["env"]["HOME"]))),
        path: Some(std::ffi::OsString::from(s(&i["venv_bin"]))),
        ..Environment::default()
    };
    let extra = i["env"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), s(v))).collect())
        .unwrap_or_default();
    Arc::new(Supervisor::new(env, Limits::default()).with_child_env(extra))
}

async fn next(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
    serde_json::from_str(
        &tokio::time::timeout(WAIT, rx.recv())
            .await
            .expect("a frame in time")
            .expect("open"),
    )
    .expect("json")
}

/// Wait for the response to `id`, returning it and every frame seen on the way.
async fn response(rx: &mut mpsc::UnboundedReceiver<String>, id: i64) -> (Value, Vec<Value>) {
    let mut seen = Vec::new();
    loop {
        let v = next(rx).await;
        if v.get("id") == Some(&json!(id)) && v.get("method").is_none() {
            return (v, seen);
        }
        seen.push(v);
    }
}

fn p95(mut v: Vec<Duration>) -> Duration {
    v.sort();
    v[(v.len() * 95).div_ceil(100).saturating_sub(1)]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_proxy_drives_a_session_on_a_real_gateway() {
    let Some(stack) = start_stack() else {
        eprintln!(
            "skipped: set HX_E2E_HERMES_ENV to the spike install to run against a real Hermes gateway"
        );
        return;
    };
    let sup = supervisor(&stack);
    let limits = Limits::default();
    let endpoint = EndpointConfig::Local { profile: None }
        .build(&sup, &limits)
        .unwrap();
    let hub = Hub::new(endpoint.clone(), limits);

    // First connect: discovery (`hermes --version`), attach, handshake.
    let (tx_a, mut a) = mpsc::unbounded_channel();
    let started = Instant::now();
    let opened = hub
        .open(1, Arc::new(Collect(tx_a)), WAIT)
        .await
        .expect("the gateway connects");
    let first_connect = started.elapsed();
    assert!(
        opened.describe["capabilities"]
            .as_array()
            .is_some_and(|c| !c.is_empty()),
        "runtime.describe: {}",
        opened.describe
    );
    assert!(opened.describe["instance_id"].is_string());
    let mut saw_state = false;
    loop {
        let v = next(&mut a).await;
        match v["params"]["type"].as_str() {
            Some("connection.state") => saw_state = true,
            Some("gateway.ready") => break,
            other => panic!("unexpected first frame {other:?}"),
        }
    }
    assert!(
        saw_state,
        "the window is told the link state before gateway.ready"
    );

    // Attach alone (control socket ticket plus dial), a fresh ticket each time, against the running gateway.
    let mut attach = Vec::new();
    for _ in 0..10 {
        let t = Instant::now();
        let conn = endpoint.connect().await.expect("a second link");
        attach.push(t.elapsed());
        drop(conn);
    }
    let attach_max = attach.iter().max().copied().unwrap();
    assert!(
        attach_max < Duration::from_millis(300),
        "attach budget 300 ms, slowest was {attach_max:?}"
    );

    // runtime.describe through the proxy, then a session and a streamed turn.
    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":1,"method":"runtime.describe","params":{}}),
    )
    .await
    .unwrap();
    let (describe, _) = response(&mut a, 1).await;
    assert_eq!(
        describe["result"]["instance_id"],
        opened.describe["instance_id"]
    );

    let workdir = s(&stack.info["workdir"]);
    hub.send(1, json!({"jsonrpc":"2.0","id":2,"method":"session.create","params":{"source":"gui","cwd":workdir,"model":"fake-a","provider":"main"}})).await.unwrap();
    let (created, _) = response(&mut a, 2).await;
    let session = s(&created["result"]["session_id"]);
    assert!(session.starts_with("local-"), "{created}");

    // A second window shares the link and sees the same stream.
    let (tx_b, mut b) = mpsc::unbounded_channel();
    hub.open(2, Arc::new(Collect(tx_b)), WAIT).await.unwrap();
    assert_eq!(hub.connections(), 2);

    let words: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
    let reply = words.join(" ");
    hub.send(1, json!({"jsonrpc":"2.0","id":3,"method":"prompt.submit","params":{"session_id":session,"text":format!("@@reply {reply}@@"),"submission_id":"sub-live-1"}})).await.unwrap();
    let (submitted, mut frames) = response(&mut a, 3).await;
    assert!(submitted.get("error").is_none(), "{submitted}");
    let complete = loop {
        let v = next(&mut a).await;
        let done = v["params"]["type"] == "message.complete"
            && v["params"]["session_id"] == json!(session);
        frames.push(v.clone());
        if done {
            break v;
        }
    };
    let deltas: String = frames
        .iter()
        .filter(|f| f["params"]["type"] == "message.delta")
        .filter_map(|f| f["params"]["payload"]["text"].as_str())
        .collect();
    let delta_count = frames
        .iter()
        .filter(|f| f["params"]["type"] == "message.delta")
        .count();
    assert!(
        delta_count > 1,
        "the reply streams as several deltas, saw {delta_count}"
    );
    assert!(
        complete["params"]["payload"]["text"]
            .as_str()
            .unwrap()
            .contains("word299"),
        "{complete}"
    );
    assert!(
        deltas.contains("word0") && deltas.contains("word299"),
        "the deltas carry the whole reply"
    );
    // Window b saw the very same events through the one shared link.
    let mut b_complete = false;
    while let Ok(Some(f)) = tokio::time::timeout(Duration::from_secs(5), b.recv()).await {
        if f.contains("message.complete") && f.contains(&session) {
            b_complete = true;
            break;
        }
    }
    assert!(b_complete, "the second window got message.complete");

    // sessions.list through the proxy sees the session.
    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":4,"method":"session.list","params":{"limit":10}}),
    )
    .await
    .unwrap();
    let (list, _) = response(&mut a, 4).await;
    assert!(list["result"]["sessions"].is_array(), "{list}");

    // Warm the outbound path with a few hundred small requests so the p95 means something.
    for i in 0..300 {
        let id = 100 + i;
        hub.send(
            1,
            json!({"jsonrpc":"2.0","id":id,"method":"session.list","params":{"limit":1}}),
        )
        .await
        .unwrap();
        let (r, _) = response(&mut a, id).await;
        assert!(r["result"]["sessions"].is_array());
    }

    // Budgets.
    let m = hub.metrics();
    let route = m.route_in.percentile(95).unwrap();
    let route_out = m.route_out.percentile(95).unwrap();
    let sink = m.sink.percentile(95).unwrap();
    let stats = hub.stats();
    eprintln!(
        "BUDGETS first_connect={first_connect:?} attach_p95={:?} attach_max={attach_max:?} route_in_p95={route:?} route_out_p95={route_out:?} sink_p95={sink:?} write_p95={:?} frames_in={} frames_out={} coalesced={}",
        p95(attach.clone()),
        m.write.percentile(95).unwrap(),
        stats.frames_in,
        stats.frames_out,
        stats.coalesced
    );
    assert!(
        route < Duration::from_millis(1),
        "proxy overhead budget 1 ms p95, route_in p95 was {route:?}"
    );
    assert!(
        route_out < Duration::from_millis(1),
        "route_out p95 was {route_out:?}"
    );
    assert!(m.route_in.count() >= 100);

    // The gateway goes away (as on an idle exit): the host reconnects on its own and the window hears about it.
    let hermes_bin = PathBuf::from(s(&stack.info["venv_bin"])).join("hermes");
    let mut stop = Command::new(&hermes_bin);
    stop.args(["gateway", "stop", "--yes"]).env_clear();
    for (k, v) in stack.info["env"].as_object().unwrap() {
        stop.env(k, s(v));
    }
    stop.env("HERMES_HOME", s(&stack.info["home"]))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    assert!(stop.status().expect("hermes gateway stop").success());
    let deadline = Instant::now() + Duration::from_secs(90);
    let (mut saw_degraded, mut saw_ready_again) = (false, false);
    while Instant::now() < deadline && !saw_ready_again {
        if let Ok(Some(f)) = tokio::time::timeout(Duration::from_secs(5), a.recv()).await {
            let v: Value = serde_json::from_str(&f).unwrap();
            if v["params"]["type"] == "connection.state" {
                match v["params"]["payload"]["state"].as_str() {
                    Some("degraded") => saw_degraded = true,
                    Some("ready") if saw_degraded => saw_ready_again = true,
                    _ => {}
                }
            }
        }
    }
    assert!(
        saw_degraded && saw_ready_again,
        "degraded then ready again after the gateway restarted"
    );
    hub.send(
        1,
        json!({"jsonrpc":"2.0","id":5,"method":"session.list","params":{"limit":1}}),
    )
    .await
    .unwrap();
    let (after, _) = response(&mut a, 5).await;
    assert!(after["result"]["sessions"].is_array(), "{after}");
    hub.shutdown();
}
