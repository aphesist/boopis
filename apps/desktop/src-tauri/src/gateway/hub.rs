//! One gateway link per profile, shared by every UI connection (window) and multiplexed by request id. A UI request's
//! id is swapped for the host's on the way out and swapped back on the way in; params are never touched.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tokio::sync::{Notify, Semaphore, broadcast, mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

use super::frame::{self, Id, Kind};
use super::metrics::{Metrics, ProxyStats};
use super::outbox::{Outbox, Push};
use super::reconnect::Phase;
use crate::config::Limits;
use crate::endpoint::Endpoint;
use crate::error::{Error, HostError, Result};

/// A UI connection's id, unique across profiles.
pub type ConnectionId = u32;

/// Where frames for one UI connection go. The Tauri `Channel` implements it; tests use a collector.
pub trait FrameSink: Send + Sync + 'static {
    /// Deliver one frame (JSON text) to the UI.
    ///
    /// # Errors
    /// An error when the UI is gone; the connection is then closed.
    fn send(&self, frame: &str) -> Result<()>;

    /// Deliver several frames at once, in order. The default sends them one by one.
    ///
    /// # Errors
    /// An error when the UI is gone.
    fn send_batch(&self, frames: &[Arc<str>]) -> Result<()> {
        frames.iter().try_for_each(|f| self.send(f))
    }

    /// Whether the UI acknowledges each delivery (`Hub::ack`). A sink that does gets at most `Limits::ui_credit`
    /// deliveries ahead of the page; one that does not (tests, a collector) is never held back.
    fn acks(&self) -> bool {
        false
    }
}

/// Who a response belongs to.
pub(super) enum Owner {
    Ui {
        conn: ConnectionId,
        orig: Id,
    },
    /// The host's own `session.events.since` for this session, after a reconnect.
    Replay(String),
    /// A request the host itself made (`Hub::request`): the answer goes to whoever waits on it.
    Host(oneshot::Sender<Result<Value>>),
}

pub(super) struct Pending {
    pub owner: Owner,
    pub started: Instant,
    pub method: String,
}

pub(super) struct ConnEntry {
    pub outbox: Arc<Outbox>,
    pub order: u64,
    /// Deliveries the page may still take before it acknowledges one; closed with the connection.
    pub credit: Arc<Semaphore>,
}

pub(super) struct Cursor {
    pub seq: u64,
    pub epoch: Option<String>,
    pub touched: u64,
}

pub(super) struct State {
    pub phase: Phase,
    pub conns: BTreeMap<ConnectionId, ConnEntry>,
    pub pending: HashMap<u64, Pending>,
    pub ready_frame: Option<Arc<str>>,
    pub caps: Option<Value>,
    pub describe: Option<Value>,
    pub cursors: HashMap<String, Cursor>,
    pub floors: HashMap<String, (Option<String>, u64)>,
    pub tick: u64,
    pub order: u64,
    pub reconnected: bool,
}

/// What a command to the actor carries.
pub(super) struct Cmd {
    pub text: String,
}

/// The link's state as `hermes_status`-style consumers and `open` see it.
#[derive(Debug, Clone, Serialize, Type)]
pub struct LinkStatus {
    /// The phase.
    pub phase: Phase,
    /// Consecutive failed dials.
    pub attempts: u32,
    /// The last failure, when the phase is not ready.
    pub error: Option<HostError>,
}

/// Whether the link should declare itself as the Desktop on this machine (`client.capabilities {desktop_local: true}`),
/// asked on every dial.
pub type Declare = Arc<dyn Fn() -> bool + Send + Sync>;

/// A gateway event of a kind the host itself acts on (`free_tier.*`), copied out of the stream; the UI still gets it.
#[derive(Debug, Clone, PartialEq)]
pub struct TapEvent {
    /// The event type, for example `free_tier.challenge`.
    pub event_type: String,
    /// Its payload, as the gateway sent it (`null` when it carried none).
    pub payload: Value,
}

/// The event types the host copies out of the stream: those starting with this.
pub(super) const TAPPED_PREFIX: &str = "free_tier.";

/// Which way a frame of the feed went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// A gateway event, on its way to the windows.
    In,
    /// A request a window sent (only `approval.respond`), on its way to the gateway.
    Out,
}

/// What the local API (`ADR-0045`) reads off a link: a copy of a frame's meaning, never of the frame. Cut from the stream
/// only while somebody listens, and for the few event types that carry a state; a delta carries no payload at all.
#[derive(Debug, Clone, PartialEq)]
pub struct FeedFrame {
    /// Which way it went.
    pub direction: Direction,
    /// The event type (`message.delta`, `tool.start`, ...) or, for [`Direction::Out`], the method.
    pub name: String,
    /// The session it belongs to.
    pub session_id: Option<String>,
    /// The execution generation of the envelope, when the frame was read in full.
    pub generation: Option<u64>,
    /// The event's `payload` (a request's `params`), when the type carries a state; `None` for a delta.
    pub payload: Option<Value>,
}

/// The event types a feed reader wants, and whether it needs their payload.
const FEED_EVENTS: [(&str, bool); 17] = [
    ("message.start", false),
    ("message.delta", false),
    ("message.interim", false),
    ("message.complete", true),
    ("thinking.delta", false),
    ("reasoning.delta", false),
    ("reasoning.available", false),
    ("tool.start", true),
    ("tool.generating", true),
    ("tool.progress", true),
    ("tool.complete", false),
    ("approval.request", true),
    ("approval.settled", true),
    ("approval.cancelled", true),
    ("error", true),
    ("turn.failed", true),
    ("sessions.changed", false),
];

fn feed_wants(event: &str) -> Option<bool> {
    FEED_EVENTS
        .iter()
        .find(|(n, _)| *n == event)
        .map(|(_, p)| *p)
}

pub(super) struct Shared {
    pub limits: Limits,
    pub declare: Declare,
    pub taps: broadcast::Sender<TapEvent>,
    pub feed: broadcast::Sender<FeedFrame>,
    pub endpoint: Arc<dyn Endpoint>,
    pub state: Mutex<State>,
    pub metrics: Metrics,
    pub cmd_tx: mpsc::Sender<Cmd>,
    pub status: watch::Sender<LinkStatus>,
    pub retry: Notify,
    pub next_req: AtomicU64,
    pub cancel: CancellationToken,
}

impl Shared {
    pub(super) fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queue a frame for every connection; returns the ids that fell too far behind and were closed.
    pub(super) fn broadcast(&self, st: &mut State, text: &Arc<str>, delta_session: Option<&str>) {
        let mut slow = Vec::new();
        for (id, c) in &st.conns {
            match c.outbox.push(text.clone(), delta_session) {
                Push::Coalesced => {
                    self.metrics.coalesced.fetch_add(1, Ordering::Relaxed);
                }
                Push::TooSlow => slow.push(*id),
                Push::Queued | Push::Closed => {}
            }
        }
        for id in slow {
            self.drop_slow(st, id);
        }
    }

    /// Copy an event's meaning to the feed, when somebody listens. Reads the envelope the caller already read and, for the
    /// few types that carry a state, the frame once more; a delta is never parsed.
    pub(super) fn feed_event(&self, text: &str, event: &str, session_id: Option<&str>) {
        if self.feed.receiver_count() == 0 {
            return;
        }
        let Some(with_payload) = feed_wants(event) else {
            return;
        };
        let (mut generation, mut payload) = (None, None);
        if with_payload && let Ok(v) = serde_json::from_str::<Value>(text) {
            let params = &v["params"];
            generation = params.get("execution_generation").and_then(Value::as_u64);
            payload = params.get("payload").cloned();
        }
        let _ = self.feed.send(FeedFrame {
            direction: Direction::In,
            name: event.to_owned(),
            session_id: session_id.map(str::to_owned),
            generation,
            payload,
        });
    }

    /// Queue a frame for one connection.
    pub(super) fn deliver(&self, st: &mut State, conn: ConnectionId, text: Arc<str>) {
        let verdict = st.conns.get(&conn).map(|c| c.outbox.push(text, None));
        if verdict == Some(Push::TooSlow) {
            self.drop_slow(st, conn);
        }
    }

    fn drop_slow(&self, st: &mut State, id: ConnectionId) {
        tracing::warn!(
            connection = id,
            "a UI connection fell too far behind; closing it (its page reloads)"
        );
        self.metrics.slow_closed.fetch_add(1, Ordering::Relaxed);
        if let Some(c) = st.conns.remove(&id) {
            self.metrics.outbox_peak.fetch_max(
                u32::try_from(c.outbox.peak()).unwrap_or(u32::MAX),
                Ordering::Relaxed,
            );
            // Wakes a drain that waits for the page's acknowledgement, so it says goodbye and ends.
            c.credit.close();
        }
    }

    /// Answer a UI request with an error.
    pub(super) fn fail_ui(&self, st: &mut State, conn: ConnectionId, orig: &Id, err: &Error) {
        let text = frame::error_response(orig, err.code(), &err.to_string());
        self.deliver(st, conn, text.into());
    }

    pub(super) fn publish(&self, phase: Phase, attempts: u32, error: Option<HostError>) {
        let payload =
            serde_json::json!({"state": phase.as_str(), "attempts": attempts, "error": error});
        let text: Arc<str> = frame::host_event("connection.state", &payload).into();
        {
            let mut st = self.lock();
            st.phase = phase;
            self.broadcast(&mut st, &text, None);
        }
        self.status.send_replace(LinkStatus {
            phase,
            attempts,
            error,
        });
    }
}

/// The proxy for one profile.
pub struct Hub {
    shared: Arc<Shared>,
    cmd_rx: Mutex<Option<mpsc::Receiver<Cmd>>>,
    started: AtomicBool,
}

/// What `open` returns.
#[derive(Debug, Clone)]
pub struct Opened {
    /// The result of `runtime.describe`.
    pub describe: Value,
}

const LOCAL_METHODS: [&str; 2] = ["client.capabilities", "runtime.describe"];

impl Hub {
    /// A proxy over `endpoint`. Nothing is dialled until the first connection opens.
    #[must_use]
    pub fn new(endpoint: Arc<dyn Endpoint>, limits: Limits) -> Self {
        Self::with_declaration(endpoint, limits, Arc::new(|| false))
    }

    /// A proxy that asks `declare` on every dial whether to declare itself as the Desktop on this machine. Hermes counts
    /// that declaration only on a connection that holds a ticket from its private control socket, which is what the
    /// local endpoint dials with. Nothing is dialled until the first connection opens.
    #[must_use]
    pub fn with_declaration(endpoint: Arc<dyn Endpoint>, limits: Limits, declare: Declare) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel(1024);
        let (status, _) = watch::channel(LinkStatus {
            phase: Phase::Connecting,
            attempts: 0,
            error: None,
        });
        let shared = Arc::new(Shared {
            limits,
            declare,
            taps: broadcast::channel(64).0,
            feed: broadcast::channel(1024).0,
            endpoint,
            state: Mutex::new(State {
                phase: Phase::Connecting,
                conns: BTreeMap::new(),
                pending: HashMap::new(),
                ready_frame: None,
                caps: None,
                describe: None,
                cursors: HashMap::new(),
                floors: HashMap::new(),
                tick: 0,
                order: 0,
                reconnected: false,
            }),
            metrics: Metrics::new(),
            cmd_tx,
            status,
            retry: Notify::new(),
            next_req: AtomicU64::new(1),
            cancel: CancellationToken::new(),
        });
        Self {
            shared,
            cmd_rx: Mutex::new(Some(cmd_rx)),
            started: AtomicBool::new(false),
        }
    }

    fn ensure_started(&self) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let rx = self
            .cmd_rx
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(rx) = rx {
            tokio::spawn(super::actor::run(self.shared.clone(), rx));
        }
    }

    /// Register a UI connection and wait until the link is ready. Frames reach `sink` from now on, starting with the
    /// state frame (and `gateway.ready` when the link is already up).
    ///
    /// # Errors
    /// The link's failure when it is fatal or keeps failing; `Timeout` after `wait`.
    pub async fn open(
        &self,
        id: ConnectionId,
        sink: Arc<dyn FrameSink>,
        wait: Duration,
    ) -> Result<Opened> {
        if self.status().phase == Phase::Incompatible {
            self.retry(); // connecting again is the user's retry
        }
        let outbox = Arc::new(Outbox::new(
            self.shared.limits.queue_soft_cap,
            self.shared.limits.queue_hard_cap,
        ));
        let credit = Arc::new(Semaphore::new(self.shared.limits.ui_credit.max(1)));
        {
            let mut st = self.shared.lock();
            st.order += 1;
            let order = st.order;
            st.conns.insert(
                id,
                ConnEntry {
                    outbox: outbox.clone(),
                    order,
                    credit: credit.clone(),
                },
            );
            let status = self.shared.status.borrow().clone();
            let payload = serde_json::json!({"state": st.phase.as_str(), "attempts": status.attempts, "error": status.error});
            self.shared.deliver(
                &mut st,
                id,
                frame::host_event("connection.state", &payload).into(),
            );
            if let (Phase::Ready, Some(ready)) = (st.phase, st.ready_frame.clone()) {
                self.shared.deliver(&mut st, id, ready);
            }
        }
        tokio::spawn(drain(self.shared.clone(), id, outbox, credit, sink));
        self.ensure_started();
        match self.wait_ready(wait).await {
            Ok(describe) => Ok(Opened { describe }),
            Err(e) => {
                self.close(id);
                Err(e)
            }
        }
    }

    async fn wait_ready(&self, wait: Duration) -> Result<Value> {
        let mut rx = self.shared.status.subscribe();
        let work = async {
            loop {
                let s = rx.borrow_and_update().clone();
                match s.phase {
                    Phase::Ready => {
                        if let Some(d) = self.shared.lock().describe.clone() {
                            return Ok(d);
                        }
                    }
                    Phase::Incompatible => {
                        return Err(s.error.map_or_else(
                            || Error::Incompatible("the gateway is incompatible".into()),
                            |e| Error::Incompatible(e.message),
                        ));
                    }
                    Phase::Degraded if s.attempts >= 3 => {
                        return Err(Error::Unavailable(s.error.map_or_else(
                            || "the gateway is unreachable".into(),
                            |e| e.message,
                        )));
                    }
                    Phase::Connecting | Phase::Degraded => {}
                }
                rx.changed()
                    .await
                    .map_err(|_| Error::Unavailable("the proxy stopped".into()))?;
            }
        };
        tokio::time::timeout(wait, work)
            .await
            .map_err(|_| Error::Timeout("connecting to the gateway"))?
    }

    /// Send a UI frame to the gateway.
    ///
    /// # Errors
    /// `UnknownConnection`, `InvalidFrame`, `FrameTooLarge`, or `Unavailable` for a frame that is not a request while
    /// the link is down. A *request* while the link is down is answered with an error frame, not an error here.
    pub async fn send(&self, id: ConnectionId, value: Value) -> Result<()> {
        let started = Instant::now();
        let shared = &self.shared;
        let out = frame::prepare_outgoing(value, shared.limits.max_outbound_frame, || {
            shared.next_req.fetch_add(1, Ordering::Relaxed)
        })?;
        let text;
        {
            let mut st = shared.lock();
            if !st.conns.contains_key(&id) {
                return Err(Error::UnknownConnection(id));
            }
            let ready = st.phase == Phase::Ready;
            match out.kind {
                Kind::Request { id: orig, method } => {
                    if LOCAL_METHODS.contains(&method.as_str()) {
                        let cached = if method == "runtime.describe" {
                            st.describe.clone()
                        } else {
                            st.caps.clone()
                        };
                        let reply = match cached {
                            Some(result) if ready => serde_json::json!({"jsonrpc": "2.0", "id": orig.to_value(), "result": result}).to_string(),
                            _ => frame::error_response(&orig, "hx.engine.unavailable", "the gateway is not connected"),
                        };
                        shared.deliver(&mut st, id, reply.into());
                        return Ok(());
                    }
                    if !ready {
                        let err =
                            Error::Unavailable(format!("the gateway is {}", st.phase.as_str()));
                        shared.fail_ui(&mut st, id, &orig, &err);
                        return Ok(());
                    }
                    if method == "approval.respond" && shared.feed.receiver_count() > 0 {
                        // The window's own answer: the inbox learns who answered, from the request and never from the answer.
                        let params = out.value.get("params").cloned().unwrap_or(Value::Null);
                        let _ = shared.feed.send(FeedFrame {
                            direction: Direction::Out,
                            name: method.clone(),
                            session_id: params
                                .get("session_id")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                            generation: None,
                            payload: Some(params),
                        });
                    }
                    let host_id = out
                        .value
                        .get("id")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| Error::InvalidFrame("no host id".into()))?;
                    st.pending.insert(
                        host_id,
                        Pending {
                            owner: Owner::Ui { conn: id, orig },
                            started,
                            method,
                        },
                    );
                }
                Kind::Notification { .. } | Kind::Response { .. } => {
                    if !ready {
                        return Err(Error::Unavailable(format!(
                            "the gateway is {}",
                            st.phase.as_str()
                        )));
                    }
                }
            }
            text = serde_json::to_string(&out.value)
                .map_err(|e| Error::InvalidFrame(e.to_string()))?;
        }
        shared
            .cmd_tx
            .send(Cmd { text })
            .await
            .map_err(|_| Error::Unavailable("the proxy stopped".into()))?;
        shared.metrics.frames_out.fetch_add(1, Ordering::Relaxed);
        shared.metrics.route_out.record(started.elapsed());
        Ok(())
    }

    /// The events the host acts on (`free_tier.*`). A receiver that falls behind skips the oldest.
    #[must_use]
    pub fn events(&self) -> broadcast::Receiver<TapEvent> {
        self.shared.taps.subscribe()
    }

    /// What the local API reads off this link (`FeedFrame`): events that carry a state, and a window's `approval.respond`.
    /// Nothing is copied while nobody holds a receiver. A receiver that falls behind skips the oldest.
    #[must_use]
    pub fn feed(&self) -> broadcast::Receiver<FeedFrame> {
        self.shared.feed.subscribe()
    }

    /// Start the link when nothing has yet (a request the host makes itself needs no window) and wait until it is ready.
    ///
    /// # Errors
    /// The link's failure when it is fatal or keeps failing; `Timeout` after `wait`.
    pub async fn ensure_ready(&self, wait: Duration) -> Result<()> {
        if self.status().phase == Phase::Incompatible {
            self.retry();
        }
        self.ensure_started();
        self.wait_ready(wait).await.map(|_| ())
    }

    /// Ask the gateway something as the host (no UI connection involved) and wait for the answer.
    ///
    /// # Errors
    /// `Unavailable` while the link is not ready or when the gateway answers with an error, `Timeout` after `wait`.
    pub async fn request(&self, method: &str, params: Value, wait: Duration) -> Result<Value> {
        let shared = &self.shared;
        let (tx, rx) = oneshot::channel();
        let id = shared.next_req.fetch_add(1, Ordering::Relaxed);
        {
            let mut st = shared.lock();
            if st.phase != Phase::Ready {
                return Err(Error::Unavailable(format!(
                    "the gateway is {}",
                    st.phase.as_str()
                )));
            }
            st.pending.insert(
                id,
                Pending {
                    owner: Owner::Host(tx),
                    started: Instant::now(),
                    method: method.to_owned(),
                },
            );
        }
        let text =
            serde_json::json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
                .to_string();
        if shared.cmd_tx.send(Cmd { text }).await.is_err() {
            shared.lock().pending.remove(&id);
            return Err(Error::Unavailable("the proxy stopped".into()));
        }
        match tokio::time::timeout(wait, rx).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => Err(Error::Unavailable("the gateway connection was lost".into())),
            Err(_) => {
                shared.lock().pending.remove(&id);
                Err(Error::Timeout("the gateway's answer"))
            }
        }
    }

    /// Close a UI connection. Its pending requests are forgotten; their answers are dropped.
    pub fn close(&self, id: ConnectionId) {
        let mut st = self.shared.lock();
        if let Some(c) = st.conns.remove(&id) {
            c.outbox.close();
            c.credit.close();
        }
        st.pending
            .retain(|_, p| !matches!(&p.owner, Owner::Ui { conn, .. } if *conn == id));
    }

    /// The page took one delivery of connection `id`: it may have another. Never more than `Limits::ui_credit` ahead.
    pub fn ack(&self, id: ConnectionId) {
        let st = self.shared.lock();
        if let Some(c) = st.conns.get(&id)
            && c.credit.available_permits() < self.shared.limits.ui_credit.max(1)
        {
            c.credit.add_permits(1);
        }
    }

    /// How many UI connections are open.
    #[must_use]
    pub fn connections(&self) -> usize {
        self.shared.lock().conns.len()
    }

    /// The link's current status.
    #[must_use]
    pub fn status(&self) -> LinkStatus {
        self.shared.status.borrow().clone()
    }

    /// Watch the link's status.
    #[must_use]
    pub fn watch(&self) -> watch::Receiver<LinkStatus> {
        self.shared.status.subscribe()
    }

    /// Ask a parked (incompatible) or degraded link to try again now.
    pub fn retry(&self) {
        self.ensure_started();
        self.shared.status.send_if_modified(|s| {
            let parked = s.phase == Phase::Incompatible;
            if parked {
                *s = LinkStatus {
                    phase: Phase::Connecting,
                    attempts: 0,
                    error: None,
                };
            }
            parked
        });
        self.shared.lock().phase = self.shared.status.borrow().phase;
        self.shared.retry.notify_one();
    }

    /// The proxy's counters and timings.
    #[must_use]
    pub fn stats(&self) -> ProxyStats {
        self.shared.metrics.snapshot()
    }

    /// The raw metrics, for the integration test's budget checks.
    #[must_use]
    pub fn metrics(&self) -> &Metrics {
        &self.shared.metrics
    }

    /// Stop the link and close every connection.
    pub fn shutdown(&self) {
        self.shared.cancel.cancel();
        let mut st = self.shared.lock();
        for c in st.conns.values() {
            c.outbox.close();
            c.credit.close();
        }
        st.conns.clear();
    }
}

impl Drop for Hub {
    fn drop(&mut self) {
        self.shared.cancel.cancel();
    }
}

/// Deliver a connection's queue to its sink in batches, report overflow, and say goodbye when it was too slow.
///
/// A sink that acknowledges (the web view) gets a batch only while it holds credit: a page that is busy, hidden or
/// stuck stops taking frames, and they wait here, bounded, where adjacent deltas merge, instead of piling up as
/// scripts queued inside `WebKit` (the Tauri channel runs one script per message and never pushes back).
async fn drain(
    shared: Arc<Shared>,
    id: ConnectionId,
    outbox: Arc<Outbox>,
    credit: Arc<Semaphore>,
    sink: Arc<dyn FrameSink>,
) {
    let mut reported = 0u64;
    let mut last_report = Instant::now();
    let acks = sink.acks();
    let (max_frames, max_bytes) = (
        shared.limits.batch_frames.max(1),
        shared.limits.batch_bytes.max(1),
    );
    loop {
        if acks {
            match credit.acquire().await {
                Ok(permit) => permit.forget(),
                Err(_) => break, // the connection was closed (or dropped as too slow)
            }
        }
        let Some(batch) = outbox.pop_batch(max_frames, max_bytes).await else {
            break;
        };
        let t = Instant::now();
        if sink.send_batch(&batch).is_err() {
            let mut st = shared.lock();
            if let Some(c) = st.conns.remove(&id) {
                c.credit.close();
            }
            outbox.close();
            return;
        }
        shared.metrics.sink.record(t.elapsed());
        shared.metrics.batches.fetch_add(1, Ordering::Relaxed);
        shared.metrics.frames_to_ui.fetch_add(
            u32::try_from(batch.len()).unwrap_or(u32::MAX),
            Ordering::Relaxed,
        );
        shared.metrics.outbox_peak.fetch_max(
            u32::try_from(outbox.peak()).unwrap_or(u32::MAX),
            Ordering::Relaxed,
        );
        let merged = outbox.coalesced();
        if merged > reported && last_report.elapsed() >= Duration::from_secs(1) {
            reported = merged;
            last_report = Instant::now();
            tracing::warn!(
                connection = id,
                coalesced = merged,
                "message deltas were merged because the UI is behind"
            );
            let _ = sink.send(&frame::host_event(
                "connection.backpressure",
                &serde_json::json!({"coalesced": merged}),
            ));
        }
    }
    if outbox.was_too_slow() {
        let payload = serde_json::json!({"state": "degraded", "reason": "slow_consumer"});
        let _ = sink.send(&frame::host_event("connection.state", &payload));
    }
}
