//! The transport under the proxy: a stream of inbound items and a sink of outbound ones. The WebSocket implements it
//! (`ws.rs`); tests implement it with channels.

use std::pin::Pin;

use futures_util::{Sink, Stream};

use crate::error::Result;

/// What arrives from the gateway.
#[derive(Debug)]
pub enum Inbound {
    /// A text frame (every `hermes-gateway-v1` frame).
    Text(String),
    /// Any sign of life that is not a frame (a pong).
    Alive,
    /// The peer closed the link.
    Closed,
}

/// What goes to the gateway.
#[derive(Debug)]
pub enum Outbound {
    /// A text frame.
    Text(String),
    /// A WebSocket ping.
    Ping,
}

/// A boxed inbound stream.
pub type RxStream = Pin<Box<dyn Stream<Item = Result<Inbound>> + Send>>;
/// A boxed outbound sink.
pub type TxSink = Pin<Box<dyn Sink<Outbound, Error = crate::error::Error> + Send>>;

/// An established link to a gateway.
pub struct GatewayConn {
    /// Frames from the gateway.
    pub rx: RxStream,
    /// Frames to the gateway.
    pub tx: TxSink,
    /// How long the attach took (ticket plus dial), for the budget.
    pub attach: std::time::Duration,
}
