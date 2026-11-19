//! The gateway proxy: a WebSocket client to `hermes-gateway-v1`, frames validated and forwarded unaltered, one
//! shared connection per profile multiplexed by request id.

mod actor;
pub mod frame;
pub mod hub;
pub mod link;
pub mod metrics;
pub mod outbox;
pub mod reconnect;
mod route;
pub mod ws;

pub use hub::{ConnectionId, FrameSink, Hub, LinkStatus, Opened};
pub use metrics::ProxyStats;

#[cfg(test)]
mod tests;
