//! The task that owns the gateway link: dial, handshake, serve, and on loss reconnect (state machine in
//! `reconnect.rs`) and replay what the UI missed.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::call::{exchange, wait_ready};
use super::frame;
use super::hub::{Cmd, Owner, Pending, Shared};
use super::link::{GatewayConn, Inbound, Outbound};
use super::reconnect::{Event, Machine, Phase, Step};
use crate::error::{Error, HostError, Result};

enum End {
    Shutdown,
    Lost(String),
}

/// Run until cancelled.
pub(super) async fn run(shared: Arc<Shared>, mut cmds: mpsc::Receiver<Cmd>) {
    let mut machine = Machine::new(shared.limits.backoff_first, shared.limits.backoff_max);
    let mut delay = Duration::ZERO;
    loop {
        if !delay.is_zero() {
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                () = shared.retry.notified() => {}
                () = shared.cancel.cancelled() => return,
            }
        }
        while cmds.try_recv().is_ok() {} // stale commands from before the loss; their requests were already failed
        machine.on(Event::Dialing);
        if machine.phase() == Phase::Connecting {
            shared.publish(Phase::Connecting, 0, None);
        }
        let attempt = tokio::select! {
            r = dial_and_handshake(&shared) => r,
            () = shared.cancel.cancelled() => return,
        };
        let step = match attempt {
            Ok((conn, buffered)) => {
                machine.on(Event::HandshakeDone);
                shared.metrics.attach_ms.store(
                    u32::try_from(conn.attach.as_millis()).unwrap_or(u32::MAX),
                    Ordering::Relaxed,
                );
                enter_ready(&shared);
                match serve(&shared, conn, buffered, &mut cmds).await {
                    End::Shutdown => return,
                    End::Lost(why) => {
                        tracing::warn!(reason = %why, "the gateway link was lost");
                        fail_all_pending(&shared);
                        let step = machine.on(Event::LinkLost);
                        shared.publish(
                            Phase::Degraded,
                            machine.failures(),
                            Some(HostError {
                                code: "hx.engine.unavailable".into(),
                                message: crate::error::user_message("hx.engine.unavailable", &why),
                            }),
                        );
                        step
                    }
                }
            }
            Err(e) => {
                let fatal = matches!(
                    e,
                    Error::HermesMissing | Error::HermesTooOld { .. } | Error::Incompatible(_)
                );
                tracing::warn!(error = %e, fatal, "could not reach the gateway");
                let step = machine.on(Event::DialFailed { fatal });
                shared.publish(machine.phase(), machine.failures(), Some(e.into()));
                step
            }
        };
        match step {
            Step::Dial(d) => delay = d,
            Step::Park => {
                tokio::select! {
                    () = shared.retry.notified() => {}
                    () = shared.cancel.cancelled() => return,
                }
                machine.on(Event::Retry);
                delay = Duration::ZERO;
            }
            Step::Serve | Step::Stay => delay = Duration::ZERO,
        }
    }
}

fn enter_ready(shared: &Shared) {
    let ready = shared.lock().ready_frame.clone();
    shared.publish(Phase::Ready, 0, None);
    if let Some(r) = ready {
        let mut st = shared.lock();
        shared.broadcast(&mut st, &r, None);
    }
}

fn fail_all_pending(shared: &Shared) {
    let mut st = shared.lock();
    let pending: Vec<Pending> = st.pending.drain().map(|(_, p)| p).collect();
    st.phase = Phase::Degraded;
    for p in pending {
        match p.owner {
            Owner::Ui { conn, orig } => {
                let err = Error::Unavailable("the gateway connection was lost".into());
                shared.fail_ui(&mut st, conn, &orig, &err);
            }
            Owner::Host(tx) => {
                let _ = tx.send(Err(Error::Unavailable(
                    "the gateway connection was lost".into(),
                )));
            }
            Owner::Replay(_) => {}
        }
    }
}

async fn dial_and_handshake(shared: &Shared) -> Result<(GatewayConn, Vec<String>)> {
    let mut conn = shared.endpoint.connect().await?;
    let mut buffered = Vec::new();
    let deadline = shared.limits.cli_timeout;
    let handshake = async {
        // 1. gateway.ready, which the gateway sends first.
        let ready = wait_ready(&mut conn, shared.limits.max_inbound_frame, &mut buffered).await?;
        // 2. client.capabilities, then runtime.describe: their results are cached and answered to the UI locally.
        let caps = call(
            shared,
            &mut conn,
            "client.capabilities",
            &json!({"server_requests": true}),
            &mut buffered,
        )
        .await?;
        // The Desktop's own declaration, only when the host asked for it (the user chose the free tier). It is a call of
        // its own because a Hermes older than the field refuses just that call and keeps `server_requests`.
        if (shared.declare)() {
            match call(
                shared,
                &mut conn,
                "client.capabilities",
                &json!({"desktop_local": true}),
                &mut buffered,
            )
            .await
            {
                Ok(_) => tracing::info!("declared this link as the Desktop on this machine"),
                Err(e) => tracing::warn!(error = %e, "this Hermes did not accept desktop_local"),
            }
        }
        let describe = call(
            shared,
            &mut conn,
            "runtime.describe",
            &json!({}),
            &mut buffered,
        )
        .await
        .map_err(|e| {
            Error::Incompatible(format!("the gateway does not answer runtime.describe: {e}"))
        })?;
        if describe
            .get("capabilities")
            .and_then(Value::as_array)
            .is_none()
        {
            return Err(Error::Incompatible(
                "runtime.describe carries no capabilities".into(),
            ));
        }
        Ok((ready, caps, describe))
    };
    let (ready, caps, describe) = tokio::time::timeout(deadline, handshake)
        .await
        .map_err(|_| Error::Timeout("the gateway handshake"))??;
    let mut st = shared.lock();
    st.reconnected = st.ready_frame.is_some();
    st.ready_frame = Some(ready.into());
    st.caps = Some(caps);
    st.describe = Some(describe);
    drop(st);
    Ok((conn, buffered))
}

async fn call(
    shared: &Shared,
    conn: &mut GatewayConn,
    method: &str,
    params: &Value,
    buffered: &mut Vec<String>,
) -> Result<Value> {
    let id = shared.next_req.fetch_add(1, Ordering::Relaxed);
    exchange(
        conn,
        shared.limits.max_inbound_frame,
        id,
        method,
        params,
        buffered,
    )
    .await
}

async fn serve(
    shared: &Shared,
    conn: GatewayConn,
    buffered: Vec<String>,
    cmds: &mut mpsc::Receiver<Cmd>,
) -> End {
    let GatewayConn { mut rx, mut tx, .. } = conn;
    for t in buffered {
        for back in shared.route_inbound(t, Instant::now()) {
            if tx.send(Outbound::Text(back)).await.is_err() {
                return End::Lost("the link closed".into());
            }
        }
    }
    let replays = replay_requests(shared);
    for text in replays {
        if let Err(e) = tx.send(Outbound::Text(text)).await {
            return End::Lost(e.to_string());
        }
    }
    let mut ping = tokio::time::interval(shared.limits.ping_every);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ping.tick().await;
    let mut last_rx = Instant::now();
    loop {
        tokio::select! {
            biased;
            () = shared.cancel.cancelled() => return End::Shutdown,
            cmd = cmds.recv() => {
                let Some(Cmd { text }) = cmd else { return End::Shutdown };
                let t = Instant::now();
                if let Err(e) = tx.send(Outbound::Text(text)).await {
                    return End::Lost(e.to_string());
                }
                shared.metrics.write.record(t.elapsed());
            }
            item = rx.next() => {
                let received = Instant::now();
                match item {
                    Some(Ok(Inbound::Text(t))) => {
                        last_rx = received;
                        for back in shared.route_inbound(t, received) {
                            if let Err(e) = tx.send(Outbound::Text(back)).await {
                                return End::Lost(e.to_string());
                            }
                        }
                    }
                    Some(Ok(Inbound::Alive)) => last_rx = received,
                    Some(Ok(Inbound::Closed)) | None => return End::Lost("the gateway closed the link".into()),
                    Some(Err(e)) => return End::Lost(e.to_string()),
                }
            }
            _ = ping.tick() => {
                if last_rx.elapsed() > shared.limits.silence_limit {
                    return End::Lost("the gateway went silent".into());
                }
                if let Err(e) = tx.send(Outbound::Ping).await {
                    return End::Lost(e.to_string());
                }
                sweep_timeouts(shared);
            }
        }
    }
}

/// `session.events.since` for every session the UI has seen events of, after a reconnect.
fn replay_requests(shared: &Shared) -> Vec<String> {
    let mut st = shared.lock();
    if !st.reconnected {
        return Vec::new();
    }
    let mut work: Vec<(String, u64, Option<String>, u64)> = st
        .cursors
        .iter()
        .map(|(k, c)| (k.clone(), c.seq, c.epoch.clone(), c.touched))
        .collect();
    work.sort_by_key(|w| std::cmp::Reverse(w.3));
    work.truncate(shared.limits.replay_sessions);
    let mut out = Vec::new();
    for (session, seq, epoch, _) in work {
        let id = shared.next_req.fetch_add(1, Ordering::Relaxed);
        out.push(
            json!({"jsonrpc": "2.0", "id": id, "method": "session.events.since",
                   "params": {"session_id": session, "last_seen": seq, "replay_epoch": epoch}})
            .to_string(),
        );
        st.pending.insert(
            id,
            Pending {
                owner: Owner::Replay(session),
                started: Instant::now(),
                method: "session.events.since".into(),
            },
        );
    }
    let payload = json!({"state": "ready", "reconnected": true, "replaying": out.len()});
    let text: Arc<str> = frame::host_event("connection.state", &payload).into();
    shared.broadcast(&mut st, &text, None);
    out
}

/// Answer requests that waited longer than the limit, so the UI never hangs on a lost answer.
fn sweep_timeouts(shared: &Shared) {
    let limit = shared.limits.request_timeout;
    let mut st = shared.lock();
    let stale: Vec<u64> = st
        .pending
        .iter()
        .filter(|(_, p)| p.started.elapsed() > limit)
        .map(|(k, _)| *k)
        .collect();
    for k in stale {
        if let Some(p) = st.pending.remove(&k) {
            tracing::warn!(method = %p.method, "a gateway request timed out");
            match p.owner {
                Owner::Ui { conn, orig } => {
                    shared.fail_ui(
                        &mut st,
                        conn,
                        &orig,
                        &Error::Timeout("the gateway's answer"),
                    );
                }
                Owner::Host(tx) => {
                    let _ = tx.send(Err(Error::Timeout("the gateway's answer")));
                }
                Owner::Replay(_) => {}
            }
        }
    }
}
