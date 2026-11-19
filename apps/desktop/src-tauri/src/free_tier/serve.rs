//! Listening for the free tier's challenge on a gateway link and answering it: an event in, a hidden window requested, the
//! reveal and close on the page's signal (`challenge.rs`), then `free_tier.challenge_result` back to Hermes as a hint.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use super::FreeTier;
use super::challenge::{Windows, parse_request};
use crate::gateway::reconnect::Phase;
use crate::gateway::{Declare, Hub};

/// How long a request the host makes to the gateway may wait.
const ASK: Duration = Duration::from_secs(20);

/// Run the challenge in `payload` (an event's, or `free_tier.status`'s `challenge`) and tell Hermes how its window ended.
pub async fn handle(hub: &Hub, windows: &Windows, payload: &Value) {
    let Some(request) = parse_request(payload, windows.config().max_url_len) else {
        tracing::debug!(
            "a free_tier.challenge payload that is not a browser challenge was ignored"
        );
        return;
    };
    let (url, attempt) = (request.url.clone(), request.attempt);
    let outcome = windows.run(request).await;
    // A hint, never a verdict: Hermes re-mints either way. An older Hermes without the method just refuses it.
    if let Err(e) = hub
        .request(
            "free_tier.challenge_result",
            json!({"url": url, "attempt": attempt, "outcome": outcome.as_str()}),
            ASK,
        )
        .await
    {
        tracing::debug!(error = %e, "free_tier.challenge_result was not delivered");
    }
}

/// Serve one hub for as long as it lives. `active` says whether the profile uses the free tier (the host declared itself
/// the Desktop): nothing is asked of the gateway otherwise, and a challenge event is still handled, since only a free-tier
/// identity can raise one.
pub async fn run(hub: Arc<Hub>, windows: Arc<Windows>, active: Declare) {
    let mut events = hub.events();
    let mut status = hub.watch();
    let mut was_ready = false;
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(e) if e.event_type == "free_tier.challenge" => {
                    let (hub, windows) = (hub.clone(), windows.clone());
                    tokio::spawn(async move { handle(&hub, &windows, &e.payload).await });
                }
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            },
            changed = status.changed() => {
                if changed.is_err() {
                    return;
                }
                let ready = status.borrow_and_update().phase == Phase::Ready;
                // A window opened after the event fired still learns it has a challenge to run (`free_tier.status`).
                if ready && !was_ready && active() {
                    let (hub, windows) = (hub.clone(), windows.clone());
                    tokio::spawn(async move { catch_up(&hub, &windows).await });
                }
                was_ready = ready;
            }
        }
    }
}

async fn catch_up(hub: &Hub, windows: &Windows) {
    let Ok(answer) = hub.request("free_tier.status", json!({}), ASK).await else {
        return;
    };
    if let Ok(status) = serde_json::from_value::<FreeTier>(answer)
        && let Some(challenge) = status.challenge
    {
        handle(hub, windows, &challenge).await;
    }
}
