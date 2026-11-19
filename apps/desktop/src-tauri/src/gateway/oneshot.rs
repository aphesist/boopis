//! A short-lived link for the few things the host asks of the gateway itself (first-run setup: the free tier's status and
//! claim, the model catalogue). It dials like the proxy does (a fresh ticket, `gateway.ready` first), may declare
//! `desktop_local` (see `Hub`), asks, and is dropped. It never answers server requests: it advertises none, so Hermes
//! fails them fast.

use std::time::Duration;

use serde_json::{Value, json};

use super::call::{exchange, wait_ready};
use super::link::GatewayConn;
use crate::endpoint::Endpoint;
use crate::error::{Error, Result};

/// An open one-shot link.
pub struct Link {
    conn: GatewayConn,
    max_frame: usize,
    next: u64,
    wait: Duration,
}

impl Link {
    /// Dial `endpoint`, wait for `gateway.ready` and, when `desktop_local`, declare it.
    ///
    /// # Errors
    /// The endpoint's error, `Timeout` after `wait`, `Unavailable` when the gateway refuses the declaration.
    pub async fn open(
        endpoint: &dyn Endpoint,
        desktop_local: bool,
        max_frame: usize,
        wait: Duration,
    ) -> Result<Self> {
        let conn = tokio::time::timeout(wait, endpoint.connect())
            .await
            .map_err(|_| Error::Timeout("connecting to the gateway"))??;
        let mut link = Self {
            conn,
            max_frame,
            next: 1,
            wait,
        };
        let mut dropped = Vec::new();
        tokio::time::timeout(wait, wait_ready(&mut link.conn, max_frame, &mut dropped))
            .await
            .map_err(|_| Error::Timeout("the gateway's first frame"))??;
        if desktop_local {
            link.call("client.capabilities", &json!({"desktop_local": true}))
                .await
                .map_err(|e| {
                    Error::Unavailable(format!(
                        "this Hermes did not accept the desktop declaration: {e}"
                    ))
                })?;
        }
        Ok(link)
    }

    /// Ask one question.
    ///
    /// # Errors
    /// `Unavailable` for an error answer or a closed link, `Timeout` after the wait given to `open`.
    pub async fn call(&mut self, method: &str, params: &Value) -> Result<Value> {
        let id = self.next;
        self.next += 1;
        let mut dropped = Vec::new();
        tokio::time::timeout(
            self.wait,
            exchange(
                &mut self.conn,
                self.max_frame,
                id,
                method,
                params,
                &mut dropped,
            ),
        )
        .await
        .map_err(|_| Error::Timeout("the gateway's answer"))?
    }
}
