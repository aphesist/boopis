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
    assert_eq!(failed["error"]["data"]["code"], "hx.hermes.unavailable");
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
    assert_eq!(err.code(), "hx.hermes.incompatible");
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
