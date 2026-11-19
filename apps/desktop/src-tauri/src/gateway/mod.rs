//! The gateway proxy: a WebSocket client to `hermes-gateway-v1`, frames validated and forwarded unaltered, one
//! shared connection per profile multiplexed by request id.

mod actor;
mod call;
pub mod frame;
pub mod hub;
pub mod link;
pub mod metrics;
pub mod oneshot;
pub mod outbox;
pub mod reconnect;
mod route;
pub mod ws;

pub use hub::{ConnectionId, Declare, FrameSink, Hub, LinkStatus, Opened, TapEvent};
pub use metrics::ProxyStats;

#[cfg(test)]
mod tests;
