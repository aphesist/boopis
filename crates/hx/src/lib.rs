//! The `hx` binary's library: the dispatcher wiring, the stdio server and the one-shot runner.
//!
//! - [`build_dispatcher`] registers every handler crate. `hx-pack` adds its handler
//!   here when it lands; `hx-sandbox` is registered.
//! - [`serve`] speaks newline-delimited JSON-RPC 2.0 over any async reader and writer.
//! - [`oneshot`] runs a single method for debugging and tests, through the same dispatcher.

pub mod oneshot;
pub mod schema;
pub mod serve;

use std::sync::Arc;

use hx_proto::Dispatcher;
use hx_sandbox::SandboxHandler;
use hx_txn::TxnHandler;

/// The crate version, reported by `hx.describe`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Builds the dispatcher with every handler `hx` ships.
///
/// # Panics
/// Never: registering the built-in handlers cannot conflict. See the test that proves it.
#[must_use]
pub fn build_dispatcher() -> Dispatcher {
    let mut dispatcher = Dispatcher::new(VERSION);
    // The built-in handlers claim disjoint namespaces, which `registers_every_builtin_handler`
    // verifies, so registration cannot fail here.
    #[allow(clippy::expect_used)]
    dispatcher
        .register(Arc::new(TxnHandler::new()))
        .expect("txn methods are unique and in the txn namespace");
    #[allow(clippy::expect_used)]
    dispatcher
        .register(Arc::new(SandboxHandler::new()))
        .expect("sandbox methods are unique and in the sandbox namespace");
    dispatcher
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_every_builtin_handler() {
        let d = build_dispatcher();
        let methods = d.methods();
        for m in [
            "hx.describe",
            "txn.validate",
            "txn.apply",
            "txn.restore",
            "txn.discard",
            "txn.recover",
            "sandbox.run",
            "sandbox.capabilities",
            "sandbox.spawn",
            "sandbox.wait",
            "sandbox.kill",
        ] {
            assert!(methods.contains(&m), "{m}");
        }
        let caps = d.describe().capabilities;
        assert!(caps.contains(&"txn.edit.diff".to_owned()));
        assert!(caps.contains(&"sandbox.run".to_owned()));
        assert_eq!(d.describe().protocol, "hx-v1");
    }
}
