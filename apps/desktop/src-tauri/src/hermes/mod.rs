//! Hermes: where it is, whether it is new enough, and how to reach its gateway.

pub mod attach;
pub mod cli;
pub mod control;
pub mod discover;
pub mod idle;
pub mod install;
pub mod lifecycle;

pub use attach::{Dial, EndpointInfo};
pub use discover::Environment;
pub use lifecycle::{GatewayOwner, GatewayState, HermesStatus, Supervisor};
