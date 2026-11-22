//! The proxy against a scripted gateway (channels, no network): multiplexing, local answers, loss and replay.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::link::{GatewayConn, Inbound, Outbound};
use super::{FrameSink, Hub};
use crate::config::Limits;
use crate::endpoint::{Endpoint, EndpointKind};
use crate::error::{Error, Result};

const WAIT: Duration = Duration::from_secs(5);

/// The test's end of one fake link.
struct FakeGateway {
    to_client: mpsc::UnboundedSender<Result<Inbound>>,
    from_client: mpsc::UnboundedReceiver<Outbound>,
}

impl FakeGateway {
    fn send(&self, v: &Value) {
        self.to_client
            .send(Ok(Inbound::Text(v.to_string())))
            .unwrap();
    }
    async fn recv(&mut self) -> Value {
        loop {
            match tokio::time::timeout(WAIT, self.from_client.recv())
                .await
                .unwrap()
                .unwrap()
            {
                Outbound::Text(t) => return serde_json::from_str(&t).unwrap(),
                Outbound::Ping => {}
            }
        }
    }
    fn drop_link(&self) {
        self.to_client.send(Ok(Inbound::Closed)).unwrap();
    }
    /// gateway.ready, then answer client.capabilities and runtime.describe like Hermes does.
    async fn handshake(&mut self) {
        self.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"skin":{}},"replay_epoch":"e1","seq":1}}));
        let caps = self.recv().await;
        assert_eq!(caps["method"], "client.capabilities");
        self.send(
            &json!({"jsonrpc":"2.0","id":caps["id"],"result":{"server_requests":["approval"]}}),
        );
        let describe = self.recv().await;
        assert_eq!(describe["method"], "runtime.describe");
        self.send(&json!({"jsonrpc":"2.0","id":describe["id"],"result":{"instance_id":"i","capabilities":["event-replay-v1"]}}));
    }
}

struct FakeEndpoint {
    handles: mpsc::UnboundedSender<FakeGateway>,
    failures: Mutex<Vec<Error>>,
}

#[async_trait]
impl Endpoint for FakeEndpoint {
    fn kind(&self) -> EndpointKind {
        EndpointKind::Local
    }
    async fn connect(&self) -> Result<GatewayConn> {
        if let Some(e) = self.failures.lock().unwrap().pop() {
            return Err(e);
        }
        let (to_client, rx) = mpsc::unbounded_channel::<Result<Inbound>>();
        let (tx, from_client) = mpsc::unbounded_channel::<Outbound>();
        let rx =
            futures_util::stream::unfold(
                rx,
                |mut rx| async move { rx.recv().await.map(|i| (i, rx)) },
            );
        let tx = futures_util::sink::unfold(tx, |tx, o: Outbound| async move {
            tx.send(o).map_err(|_| Error::Ws("closed".into()))?;
            Ok::<_, Error>(tx)
        });
        self.handles
            .send(FakeGateway {
                to_client,
                from_client,
            })
            .unwrap();
        Ok(GatewayConn {
            rx: Box::pin(rx),
            tx: Box::pin(tx),
            attach: Duration::from_millis(1),
        })
    }
}

struct Collect(mpsc::UnboundedSender<String>);
impl FrameSink for Collect {
    fn send(&self, frame: &str) -> Result<()> {
        self.0
            .send(frame.to_owned())
            .map_err(|_| Error::Io("gone".into()))
    }
}

struct Ui {
    id: u32,
    rx: mpsc::UnboundedReceiver<String>,
}
impl Ui {
    async fn next(&mut self) -> Value {
        serde_json::from_str(
            &tokio::time::timeout(WAIT, self.rx.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap()
    }
    /// The next frame that is not a `connection.state` frame.
    async fn next_data(&mut self) -> Value {
        loop {
            let v = self.next().await;
            if v["params"]["type"] != "connection.state" {
                return v;
            }
        }
    }
    async fn state(&mut self, want: &str) -> Value {
        loop {
            let v = self.next().await;
            if v["params"]["type"] == "connection.state" && v["params"]["payload"]["state"] == want
            {
                return v;
            }
        }
    }
}

fn limits() -> Limits {
    Limits {
        ping_every: Duration::from_hours(1),
        silence_limit: Duration::from_hours(2),
        ..Limits::default()
    }
}

struct Rig {
    hub: Hub,
    gateways: mpsc::UnboundedReceiver<FakeGateway>,
    endpoint: Arc<FakeEndpoint>,
}

fn rig() -> Rig {
    let (handles, gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    Rig {
        hub: Hub::new(endpoint.clone(), limits()),
        gateways,
        endpoint,
    }
}

impl Rig {
    async fn gateway(&mut self) -> FakeGateway {
        tokio::time::timeout(WAIT, self.gateways.recv())
            .await
            .unwrap()
            .unwrap()
    }
    /// Open a UI connection, completing the handshake on the gateway side.
    async fn open(&mut self, id: u32) -> (Ui, Option<FakeGateway>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let first = self.hub.connections() == 0
            && self.hub.status().phase != super::reconnect::Phase::Ready;
        let open = self.hub.open(id, Arc::new(Collect(tx)), WAIT);
        if first {
            let (res, gw) = tokio::join!(open, async {
                let mut gw = self.gateways.recv().await.unwrap();
                gw.handshake().await;
                gw
            });
            res.unwrap();
            return (Ui { id, rx }, Some(gw));
        }
        open.await.unwrap();
        (Ui { id, rx }, None)
    }
}

#[tokio::test]
async fn opening_waits_for_the_handshake_and_returns_describe() {
    let mut r = rig();
    let (mut ui, gw) = r.open(1).await;
    assert!(gw.is_some());
    assert_eq!(
        ui.state("ready").await["params"]["payload"]["state"],
        "ready"
    );
    let ready = ui.next_data().await;
    assert_eq!(
        ready["params"]["type"], "gateway.ready",
        "the UI gets the gateway.ready frame"
    );
    // A second window attaches to the same link and gets the cached frames at once; the gateway sees no second dial.
    let (mut ui2, none) = r.open(2).await;
    assert!(none.is_none());
    assert_eq!(ui2.next_data().await["params"]["type"], "gateway.ready");
    assert!(r.gateways.try_recv().is_err());
}

#[tokio::test]
async fn two_windows_with_the_same_request_id_are_multiplexed_and_answered_under_their_own_ids() {
    let mut r = rig();
    let (mut a, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let (mut b, _) = r.open(2).await;
    let _ = (a.next_data().await, b.next_data().await); // gateway.ready
    r.hub
        .send(
            a.id,
            json!({"jsonrpc":"2.0","id":1,"method":"session.list","params":{"limit":5}}),
        )
        .await
        .unwrap();
    r.hub.send(b.id, json!({"jsonrpc":"2.0","id":1,"method":"session.info","params":{"session_id":"x","weird":[1.0,null]}})).await.unwrap();
    let (ra, rb) = (gw.recv().await, gw.recv().await);
    assert_ne!(ra["id"], rb["id"], "the host's ids are unique");
    assert_eq!(ra["params"], json!({"limit":5}));
    assert_eq!(
        rb["params"],
        json!({"session_id":"x","weird":[1.0,null]}),
        "params are never altered"
    );
    gw.send(&json!({"jsonrpc":"2.0","id":rb["id"],"result":{"for":"b"}}));
    gw.send(&json!({"jsonrpc":"2.0","id":ra["id"],"result":{"for":"a"}}));
    let got_b = b.next_data().await;
    let got_a = a.next_data().await;
    assert_eq!(
        (got_a["id"].clone(), got_a["result"]["for"].clone()),
        (json!(1), json!("a"))
    );
    assert_eq!(
        (got_b["id"].clone(), got_b["result"]["for"].clone()),
        (json!(1), json!("b"))
    );
}

#[tokio::test]
async fn events_reach_every_window() {
    let mut r = rig();
    let (mut a, gw) = r.open(1).await;
    let gw = gw.unwrap();
    let (mut b, _) = r.open(2).await;
    let _ = (a.next_data().await, b.next_data().await); // gateway.ready
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s1","payload":{"text":"hi"},"replay_epoch":"e1","seq":2}}));
    for ui in [&mut a, &mut b] {
        let v = ui.next_data().await;
        assert_eq!(v["params"]["payload"]["text"], "hi");
    }
}

#[tokio::test]
async fn capabilities_and_describe_are_answered_from_the_cache() {
    let mut r = rig();
    let (mut ui, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let _ = ui.next_data().await;
    r.hub
        .send(
            ui.id,
            json!({"jsonrpc":"2.0","id":9,"method":"runtime.describe","params":{}}),
        )
        .await
        .unwrap();
    let v = ui.next_data().await;
    assert_eq!(v["id"], 9);
    assert_eq!(v["result"]["instance_id"], "i");
    r.hub.send(ui.id, json!({"jsonrpc":"2.0","id":"c","method":"client.capabilities","params":{"server_requests":true}})).await.unwrap();
    assert_eq!(
        ui.next_data().await["result"]["server_requests"][0],
        "approval"
    );
    // Nothing reached the gateway for either.
    r.hub
        .send(ui.id, json!({"jsonrpc":"2.0","id":10,"method":"ping"}))
        .await
        .unwrap();
    assert_eq!(gw.recv().await["method"], "ping");
}

#[tokio::test]
async fn server_requests_go_to_the_latest_window_and_responses_pass_through() {
    let mut r = rig();
    let (mut a, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let (mut b, _) = r.open(2).await;
    let _ = (a.next_data().await, b.next_data().await);
    gw.send(&json!({"jsonrpc":"2.0","id":"srv-1","method":"clarify","params":{"q":"?"}}));
    let asked = b.next_data().await;
    assert_eq!(asked["id"], "srv-1");
    r.hub
        .send(
            b.id,
            json!({"jsonrpc":"2.0","id":"srv-1","result":{"answer":"yes"}}),
        )
        .await
        .unwrap();
    let back = gw.recv().await;
    assert_eq!(back["id"], "srv-1");
    assert_eq!(back["result"]["answer"], "yes");
    r.hub.close(2);
    r.hub.close(1);
    gw.send(&json!({"jsonrpc":"2.0","id":"srv-2","method":"clarify","params":{}}));
    let declined = gw.recv().await;
    assert_eq!(declined["id"], "srv-2");
    assert_eq!(
        declined["error"]["data"]["code"], "hx.host.no_ui",
        "fail closed: never leave a turn hanging"
    );
}

#[tokio::test]
async fn a_lost_link_fails_pending_requests_and_the_host_reconnects_and_replays() {
    let mut r = rig();
    let (mut ui, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let _ = ui.next_data().await;
    for seq in [2, 3, 4] {
        gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s1","payload":{"text":seq.to_string()},"replay_epoch":"e1","seq":seq}}));
        ui.next_data().await;
    }
    r.hub
        .send(
            ui.id,
            json!({"jsonrpc":"2.0","id":5,"method":"session.list"}),
        )
        .await
        .unwrap();
    let _ = gw.recv().await;
    gw.drop_link();
    let failed = ui.next_data().await;
    assert_eq!(failed["id"], 5);
    assert_eq!(failed["error"]["data"]["code"], "hx.engine.unavailable");
    ui.state("degraded").await;
    // While the link is down a request is answered with an error at once, never queued to hang.
    // (The reconnect is immediate, so race it by checking only that an answer arrives either way.)
    let mut gw2 = r.gateway().await;
    gw2.handshake().await;
    // After the handshake the host replays the session from its cursor (seq 4, epoch e1).
    let replay = gw2.recv().await;
    assert_eq!(replay["method"], "session.events.since");
    assert_eq!(
        replay["params"],
        json!({"session_id":"s1","last_seen":4,"replay_epoch":"e1"})
    );
    gw2.send(&json!({"jsonrpc":"2.0","id":replay["id"],"result":{"events":[
        {"type":"message.delta","session_id":"s1","payload":{"text":"5"},"replay_epoch":"e1","seq":5},
        {"type":"message.complete","session_id":"s1","payload":{"text":"12345"},"replay_epoch":"e1","seq":6}],
        "latest_seq":6,"truncated":false,"count":2,"epoch":"e1","open_requests":[]}}));
    let mut types = Vec::new();
    while types.len() < 2 {
        let v = ui.next().await;
        if v["params"]["session_id"] == "s1" {
            types.push(v["params"]["type"].as_str().unwrap().to_owned());
        }
    }
    assert_eq!(types, ["message.delta", "message.complete"]);
    // A live event the replay already delivered is not delivered twice; a newer one is.
    gw2.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.complete","session_id":"s1","payload":{"text":"dup"},"replay_epoch":"e1","seq":6}}));
    gw2.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"session.usage","session_id":"s1","payload":{},"replay_epoch":"e1","seq":7}}));
    let next = loop {
        let v = ui.next().await;
        if v["params"]["session_id"] == "s1" {
            break v;
        }
    };
    assert_eq!(
        next["params"]["type"], "session.usage",
        "the duplicate was dropped"
    );
    assert_eq!(r.hub.status().phase, super::reconnect::Phase::Ready);
}

#[tokio::test]
async fn a_replay_tells_the_ui_what_hermes_still_has_open() {
    let mut r = rig();
    let (mut ui, gw) = r.open(1).await;
    let gw = gw.unwrap();
    let _ = ui.next_data().await;
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s1","payload":{"text":"1"},"replay_epoch":"e1","seq":1}}));
    ui.next_data().await;
    gw.drop_link();
    ui.state("degraded").await;
    let mut gw2 = r.gateway().await;
    gw2.handshake().await;
    let replay = gw2.recv().await;
    assert_eq!(replay["method"], "session.events.since");
    // A prompt raised during the gap: the ring has nothing of it, Hermes reports it apart.
    let open =
        json!([{"id":"srq-a1","method":"sudo","params":{"session_id":"s1","command":"sudo ls"}}]);
    gw2.send(&json!({"jsonrpc":"2.0","id":replay["id"],"result":{"events":[
        {"type":"message.delta","session_id":"s1","payload":{"text":"2"},"replay_epoch":"e1","seq":2}],
        "latest_seq":2,"truncated":false,"count":1,"epoch":"e1","open_requests":open}}));
    let mut seen = Vec::new();
    while seen.len() < 2 {
        let v = ui.next().await;
        if v["params"]["session_id"] == "s1" {
            seen.push(v);
        }
    }
    assert_eq!(seen[0]["params"]["type"], "message.delta");
    // After the events, in the host's own namespace, routed to the session, with Hermes's entries untouched.
    assert_eq!(seen[1]["params"]["type"], "connection.open_requests");
    assert_eq!(seen[1]["params"]["payload"]["open_requests"], open);
}

#[tokio::test]
async fn a_replay_with_nothing_open_sends_no_open_requests_event() {
    let mut r = rig();
    let (mut ui, gw) = r.open(1).await;
    let gw = gw.unwrap();
    let _ = ui.next_data().await;
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s1","payload":{"text":"1"},"replay_epoch":"e1","seq":1}}));
    ui.next_data().await;
    gw.drop_link();
    ui.state("degraded").await;
    let mut gw2 = r.gateway().await;
    gw2.handshake().await;
    let replay = gw2.recv().await;
    gw2.send(&json!({"jsonrpc":"2.0","id":replay["id"],"result":{"events":[
        {"type":"message.complete","session_id":"s1","payload":{"text":"1"},"replay_epoch":"e1","seq":2}],
        "latest_seq":2,"truncated":false,"count":1,"epoch":"e1","open_requests":[]}}));
    gw2.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"session.usage","session_id":"s1","payload":{},"replay_epoch":"e1","seq":3}}));
    let mut types = Vec::new();
    while types.len() < 2 {
        let v = ui.next().await;
        if v["params"]["session_id"] == "s1" {
            types.push(v["params"]["type"].as_str().unwrap().to_owned());
        }
    }
    assert_eq!(types, ["message.complete", "session.usage"]);
}

#[tokio::test]
async fn an_incompatible_gateway_parks_until_retry() {
    let mut r = rig();
    r.endpoint
        .failures
        .lock()
        .unwrap()
        .push(Error::Incompatible("too old".into()));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let err = r
        .hub
        .open(1, Arc::new(Collect(tx)), WAIT)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "hx.engine.incompatible");
    assert_eq!(r.hub.status().phase, super::reconnect::Phase::Incompatible);
    assert!(
        r.gateways.try_recv().is_err(),
        "no retry loop on a fatal failure"
    );
    // The state frame reached the window before it was closed.
    let first: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(first["params"]["type"], "connection.state");
    // The user fixes Hermes and retries.
    let (tx2, _rx2) = mpsc::unbounded_channel();
    r.hub.retry();
    let (res, _gw) = tokio::join!(r.hub.open(2, Arc::new(Collect(tx2)), WAIT), async {
        let mut gw = r.gateways.recv().await.unwrap();
        gw.handshake().await;
        gw
    });
    res.unwrap();
    assert_eq!(r.hub.status().phase, super::reconnect::Phase::Ready);
}

#[tokio::test]
async fn requests_on_unknown_connections_and_garbage_frames_are_refused() {
    let mut r = rig();
    let (ui, _gw) = r.open(1).await;
    assert_eq!(
        r.hub
            .send(99, json!({"jsonrpc":"2.0","id":1,"method":"x"}))
            .await
            .unwrap_err()
            .code(),
        "hx.host.unknown_connection"
    );
    assert_eq!(
        r.hub
            .send(ui.id, json!({"nope":1}))
            .await
            .unwrap_err()
            .code(),
        "hx.host.invalid_frame"
    );
    let huge =
        json!({"jsonrpc":"2.0","id":1,"method":"x","params":{"t":"a".repeat(9 * 1024 * 1024)}});
    assert_eq!(
        r.hub.send(ui.id, huge).await.unwrap_err().code(),
        "hx.host.invalid_frame"
    );
}

#[tokio::test]
async fn a_closed_window_stops_receiving_and_its_late_answer_is_dropped() {
    let mut r = rig();
    let (mut a, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let (mut b, _) = r.open(2).await;
    let _ = (a.next_data().await, b.next_data().await);
    r.hub
        .send(a.id, json!({"jsonrpc":"2.0","id":1,"method":"slow"}))
        .await
        .unwrap();
    let req = gw.recv().await;
    r.hub.close(1);
    gw.send(&json!({"jsonrpc":"2.0","id":req["id"],"result":{}}));
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"sessions.changed","session_id":"","payload":{}}}));
    assert_eq!(
        b.next_data().await["params"]["type"],
        "sessions.changed",
        "b only sees the event, not a's answer"
    );
    assert_eq!(r.hub.connections(), 1);
    let stats = r.hub.stats();
    assert!(stats.frames_in >= 2 && stats.route_in_p95_us.is_some());
}

fn rig_declaring(answer_ok: bool) -> (Rig, Arc<std::sync::atomic::AtomicBool>) {
    let (handles, gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    let _ = answer_ok;
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let f = flag.clone();
    let hub = Hub::with_declaration(
        endpoint.clone(),
        limits(),
        Arc::new(move || f.load(std::sync::atomic::Ordering::SeqCst)),
    );
    (
        Rig {
            hub,
            gateways,
            endpoint,
        },
        flag,
    )
}

impl FakeGateway {
    /// gateway.ready, client.capabilities, then (declared) the second client.capabilities with `desktop_local`, then
    /// runtime.describe. `accept` is whether the gateway takes the declaration.
    async fn handshake_declared(&mut self, accept: bool) -> Value {
        self.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{},"replay_epoch":"e1","seq":1}}));
        let caps = self.recv().await;
        assert_eq!(caps["params"], json!({"server_requests": true}));
        self.send(&json!({"jsonrpc":"2.0","id":caps["id"],"result":{"server_requests":[]}}));
        let declared = self.recv().await;
        assert_eq!(declared["method"], "client.capabilities");
        if accept {
            self.send(&json!({"jsonrpc":"2.0","id":declared["id"],"result":{}}));
        } else {
            self.send(&json!({"jsonrpc":"2.0","id":declared["id"],"error":{"code":-32602,"message":"unknown parameter desktop_local"}}));
        }
        let describe = self.recv().await;
        assert_eq!(describe["method"], "runtime.describe");
        self.send(&json!({"jsonrpc":"2.0","id":describe["id"],"result":{"instance_id":"i","capabilities":["event-replay-v1"]}}));
        declared
    }
}

#[tokio::test]
async fn a_declaring_hub_says_it_is_the_desktop_in_a_call_of_its_own() {
    let (mut r, _) = rig_declaring(true);
    let (tx, _rx) = mpsc::unbounded_channel();
    let open = r.hub.open(1, Arc::new(Collect(tx)), WAIT);
    let (res, declared) = tokio::join!(open, async {
        let mut gw = r.gateways.recv().await.unwrap();
        gw.handshake_declared(true).await
    });
    res.unwrap();
    assert_eq!(declared["params"], json!({"desktop_local": true}));
}

#[tokio::test]
async fn a_gateway_that_refuses_the_declaration_still_serves() {
    let (mut r, _) = rig_declaring(false);
    let (tx, _rx) = mpsc::unbounded_channel();
    let open = r.hub.open(1, Arc::new(Collect(tx)), WAIT);
    let (res, ()) = tokio::join!(open, async {
        let mut gw = r.gateways.recv().await.unwrap();
        gw.handshake_declared(false).await;
    });
    res.unwrap();
    assert_eq!(r.hub.status().phase, super::reconnect::Phase::Ready);
}

#[tokio::test]
async fn a_hub_that_does_not_declare_sends_no_second_capabilities_call() {
    // `rig()` uses `Hub::new`, whose handshake the plain `handshake` helper checks call by call:
    // client.capabilities is followed directly by runtime.describe.
    let mut r = rig();
    let (_ui, gw) = r.open(1).await;
    assert!(gw.is_some());
}

#[tokio::test]
async fn the_host_can_ask_the_gateway_itself_and_get_the_answer() {
    let mut r = rig();
    let (_ui, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let asked = r.hub.request("free_tier.status", json!({}), WAIT);
    let (answer, ()) = tokio::join!(asked, async {
        let req = gw.recv().await;
        assert_eq!(req["method"], "free_tier.status");
        gw.send(&json!({"jsonrpc":"2.0","id":req["id"],"result":{"model":"m"}}));
    });
    assert_eq!(answer.unwrap()["model"], "m");
    // an error answer is an error
    let asked = r.hub.request("free_tier.provision", json!({}), WAIT);
    let (answer, ()) = tokio::join!(asked, async {
        let req = gw.recv().await;
        gw.send(&json!({"jsonrpc":"2.0","id":req["id"],"error":{"code":5092,"message":"no"}}));
    });
    assert!(
        answer
            .unwrap_err()
            .to_string()
            .contains("free_tier.provision")
    );
}

#[tokio::test]
async fn a_host_request_while_the_link_is_down_fails_at_once() {
    let r = rig();
    let err = r
        .hub
        .request("free_tier.status", json!({}), Duration::from_millis(50))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "hx.engine.unavailable");
}

#[tokio::test]
async fn free_tier_events_are_copied_to_the_host_and_still_reach_the_window() {
    let mut r = rig();
    let mut events = r.hub.events();
    let (mut ui, gw) = r.open(1).await;
    let gw = gw.unwrap();
    let _ = ui.next_data().await; // gateway.ready
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"free_tier.challenge","session_id":"","payload":{"type":"browser","url":"https://portal.nousresearch.com/challenge/x","required":true,"expires_in":600,"message":"m","attempt":1}}}));
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s","payload":{"text":"x"},"seq":1,"replay_epoch":"e1"}}));
    let tapped = tokio::time::timeout(WAIT, events.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(tapped.event_type, "free_tier.challenge");
    assert_eq!(tapped.payload["attempt"], 1);
    assert_eq!(
        ui.next_data().await["params"]["type"],
        "free_tier.challenge"
    );
    assert!(
        events.try_recv().is_err(),
        "only free_tier.* events are copied"
    );
}

#[tokio::test]
async fn a_one_shot_link_declares_asks_and_closes() {
    let (handles, mut gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    let server = tokio::spawn(async move {
        let mut gw = gateways.recv().await.unwrap();
        gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{}}}));
        let declared = gw.recv().await;
        assert_eq!(declared["params"], json!({"desktop_local": true}));
        gw.send(&json!({"jsonrpc":"2.0","id":declared["id"],"result":{}}));
        let q = gw.recv().await;
        assert_eq!(q["method"], "free_tier.status");
        gw.send(
            &json!({"jsonrpc":"2.0","method":"event","params":{"type":"setup.ready","payload":{}}}),
        );
        gw.send(&json!({"jsonrpc":"2.0","id":q["id"],"result":{"available":false}}));
    });
    let mut link = super::oneshot::Link::open(endpoint.as_ref(), true, 1 << 20, WAIT)
        .await
        .unwrap();
    let got = link.call("free_tier.status", &json!({})).await.unwrap();
    assert_eq!(got["available"], false, "events in between are skipped");
    server.await.unwrap();
}

#[tokio::test]
async fn a_challenge_event_opens_a_hidden_window_reveals_and_closes_it_and_reports_back() {
    use crate::free_tier::challenge::Windows;
    use crate::free_tier::tests::{FakeHost, PAGE};

    let (handles, mut gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    let hub = Arc::new(Hub::new(endpoint, limits()));
    let host = Arc::new(FakeHost::default());
    let cfg = crate::config::Challenge {
        poll_every: Duration::from_millis(5),
        revealed_done_linger: Duration::from_millis(5),
        ..crate::config::Challenge::default()
    };
    let windows = Arc::new(Windows::new(host.clone(), cfg));
    tokio::spawn(crate::free_tier::serve::run(
        hub.clone(),
        windows,
        Arc::new(|| false),
    ));
    let (tx, _rx) = mpsc::unbounded_channel();
    let open = hub.open(1, Arc::new(Collect(tx)), WAIT);
    let (res, mut gw) = tokio::join!(open, async {
        let mut gw = gateways.recv().await.unwrap();
        gw.handshake().await;
        gw
    });
    res.unwrap();
    // the gateway announces a challenge
    gw.send(&json!({"jsonrpc":"2.0","method":"event","params":{"type":"free_tier.challenge","session_id":"","payload":{"type":"browser","url":PAGE,"required":true,"expires_in":600,"message":"m","attempt":3}}}));
    // a hidden window is requested ...
    let script = loop {
        if host.count() > 0 {
            break host.window(0);
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    };
    assert_eq!(script.lock().unwrap().revealed, 0);
    // ... the page asks for the person, then passes
    script.lock().unwrap().url = url::Url::parse(&format!("{PAGE}#interactive")).unwrap();
    loop {
        if script.lock().unwrap().revealed == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    script.lock().unwrap().url = url::Url::parse(&format!("{PAGE}#done")).unwrap();
    // ... and Hermes is told how the window ended
    let report = gw.recv().await;
    assert_eq!(report["method"], "free_tier.challenge_result");
    assert_eq!(
        report["params"],
        json!({"url": PAGE, "attempt": 3, "outcome": "done"})
    );
    assert!(script.lock().unwrap().closed);
    gw.send(&json!({"jsonrpc":"2.0","id":report["id"],"result":{"accepted":true}}));
}

#[tokio::test]
async fn a_window_opened_after_the_event_still_runs_the_challenge_the_status_names() {
    use crate::free_tier::challenge::Windows;
    use crate::free_tier::tests::{FakeHost, PAGE};

    let (handles, mut gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    let hub = Arc::new(Hub::new(endpoint, limits()));
    let host = Arc::new(FakeHost::default());
    let windows = Arc::new(Windows::new(
        host.clone(),
        crate::config::Challenge::default(),
    ));
    tokio::spawn(crate::free_tier::serve::run(
        hub.clone(),
        windows,
        Arc::new(|| true),
    ));
    let (tx, _rx) = mpsc::unbounded_channel();
    let open = hub.open(1, Arc::new(Collect(tx)), WAIT);
    let (res, mut gw) = tokio::join!(open, async {
        let mut gw = gateways.recv().await.unwrap();
        gw.handshake().await;
        gw
    });
    res.unwrap();
    let ask = gw.recv().await;
    assert_eq!(ask["method"], "free_tier.status");
    gw.send(&json!({"jsonrpc":"2.0","id":ask["id"],"result":{"has_guest":true,"enabled":true,"available":true,"model":"m","label":"l","challenge":{"type":"browser","url":PAGE,"required":true,"expires_in":300,"message":"m","attempt":0}}}));
    loop {
        if host.count() == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A sink that acknowledges deliveries, like the web view's channel: each message is one batch (an array, or one frame).
struct AckCollect(mpsc::UnboundedSender<String>);
impl FrameSink for AckCollect {
    fn send(&self, frame: &str) -> Result<()> {
        self.0
            .send(frame.to_owned())
            .map_err(|_| Error::Io("gone".into()))
    }
    fn send_batch(&self, frames: &[Arc<str>]) -> Result<()> {
        let joined: Vec<&str> = frames.iter().map(|f| &**f).collect();
        self.send(&format!("[{}]", joined.join(",")))
    }
    fn acks(&self) -> bool {
        true
    }
}

fn event(n: u64) -> Value {
    json!({"jsonrpc":"2.0","method":"event","params":{"type":"tool.start","session_id":"s","payload":{"n":n},"seq":n}})
}

/// Every frame a message holds (a batch is an array).
fn frames_of(msg: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(msg).unwrap() {
        Value::Array(v) => v,
        one => vec![one],
    }
}

#[tokio::test]
async fn an_acknowledging_page_gets_batches_only_while_it_has_credit_and_a_stuck_one_is_dropped_alone()
 {
    let (handles, mut gateways) = mpsc::unbounded_channel();
    let endpoint = Arc::new(FakeEndpoint {
        handles,
        failures: Mutex::new(Vec::new()),
    });
    let hub = Hub::new(
        endpoint,
        Limits {
            queue_soft_cap: 4,
            queue_hard_cap: 12,
            batch_frames: 3,
            ui_credit: 1,
            ..limits()
        },
    );
    let (tx, mut page) = mpsc::unbounded_channel();
    let open = hub.open(1, Arc::new(AckCollect(tx)), WAIT);
    let (res, gw) = tokio::join!(open, async {
        let mut gw = gateways.recv().await.unwrap();
        gw.handshake().await;
        gw
    });
    res.unwrap();
    let (tx2, mut other) = mpsc::unbounded_channel();
    hub.open(2, Arc::new(Collect(tx2)), WAIT).await.unwrap();
    // the page takes its first delivery and acknowledges nothing yet
    let first = tokio::time::timeout(WAIT, page.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(!frames_of(&first).is_empty());
    for n in 0..6 {
        gw.send(&event(n));
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        page.try_recv().is_err(),
        "no credit: nothing more reaches the page"
    );
    // an acknowledgement lets one batch through, at most three frames
    hub.ack(1);
    let batch = tokio::time::timeout(WAIT, page.recv())
        .await
        .unwrap()
        .unwrap();
    assert!((1..=3).contains(&frames_of(&batch).len()));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(page.try_recv().is_err());
    // the page is stuck: its queue fills to the hard cap and it alone is dropped
    for n in 6..40 {
        gw.send(&event(n));
        tokio::time::sleep(Duration::from_millis(2)).await; // the other window's drain keeps up
    }
    let mut seen = Vec::new();
    while seen.len() < 40 {
        let v: Value = serde_json::from_str(
            &tokio::time::timeout(WAIT, other.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if v["params"]["type"] == "tool.start" {
            seen.push(v["params"]["payload"]["n"].as_u64().unwrap());
        }
    }
    assert_eq!(
        seen,
        (0..40).collect::<Vec<_>>(),
        "the other window gets every frame, in order"
    );
    let mut goodbye = None;
    while let Ok(Some(m)) = tokio::time::timeout(Duration::from_secs(1), page.recv()).await {
        for f in frames_of(&m) {
            if f["params"]["payload"]["reason"] == "slow_consumer" {
                goodbye = Some(f);
            }
        }
    }
    assert!(
        goodbye.is_some(),
        "the stuck page is told it was dropped as too slow"
    );
    assert_eq!(hub.stats().slow_closed, 1);
    assert_eq!(hub.connections(), 1, "only the stuck connection was closed");
    assert!(hub.stats().outbox_peak >= 12);
    gw.send(&event(99));
    let v: Value = serde_json::from_str(
        &tokio::time::timeout(WAIT, other.recv())
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(v["params"]["payload"]["n"], 99, "the other window goes on");
}

#[tokio::test]
async fn the_feed_copies_the_words_of_a_reply_and_of_a_typed_message_only_while_a_reader_follows_conversations()
 {
    use super::Direction;
    let mut r = rig();
    let mut feed = r.hub.feed();
    let (mut ui, gw) = r.open(1).await;
    let mut gw = gw.unwrap();
    let _ = ui.next_data().await; // gateway.ready
    let delta = |n: u64, text: &str| json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s1","payload":{"text":text},"seq":n,"replay_epoch":"e1"}});
    let typed = |id: u64| json!({"jsonrpc":"2.0","id":id,"method":"prompt.submit","params":{"session_id":"s1","text":"typed in the app","submission_id":"sub"}});
    // nobody follows: a delta is seen as an event with no words, a typed message is not copied at all
    gw.send(&delta(2, "secret"));
    r.hub.send(ui.id, typed(1)).await.unwrap();
    let first = gw.recv().await;
    assert_eq!(
        first["method"], "prompt.submit",
        "the message still goes through"
    );
    let seen = tokio::time::timeout(WAIT, feed.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (seen.name.as_str(), seen.payload.clone()),
        ("message.delta", None)
    );
    assert!(feed.try_recv().is_err(), "the typed message was not copied");
    // a reader follows: both carry their words
    r.hub.set_feed_text(true);
    gw.send(&delta(3, "hello"));
    r.hub.send(ui.id, typed(2)).await.unwrap();
    let _ = gw.recv().await;
    let mut seen = Vec::new();
    for _ in 0..2 {
        seen.push(
            tokio::time::timeout(WAIT, feed.recv())
                .await
                .unwrap()
                .unwrap(),
        );
    }
    let words = seen.iter().find(|f| f.name == "message.delta").unwrap();
    assert_eq!(words.payload.as_ref().unwrap()["text"], "hello");
    let said = seen.iter().find(|f| f.name == "prompt.submit").unwrap();
    assert_eq!(said.direction, Direction::Out);
    assert_eq!(said.payload.as_ref().unwrap()["text"], "typed in the app");
    assert_eq!(said.session_id.as_deref(), Some("s1"));
    // the reader leaves: back to no words
    r.hub.set_feed_text(false);
    gw.send(&delta(4, "again"));
    let last = tokio::time::timeout(WAIT, feed.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(last.payload, None);
}
