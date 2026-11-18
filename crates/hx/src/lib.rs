//! The `hx` binary's library: the dispatcher wiring, the stdio server and the one-shot runner.
//!
//! - [`build_dispatcher`] registers every handler crate. `hx-sandbox` adds its handler here
//!   when it exists.
//! - [`serve`] speaks newline-delimited JSON-RPC 2.0 over any async reader and writer.
//! - [`oneshot`] runs a single method for debugging and tests, through the same dispatcher.

pub mod invalidate;
pub mod oneshot;
pub mod schema;
pub mod serve;

use std::sync::Arc;

use hx_pack::{PackHandler, WalkCache};
use hx_proto::Dispatcher;
use hx_txn::TxnHandler;

use crate::invalidate::InvalidatingHandler;

/// The crate version, reported by `hx.describe`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Builds the dispatcher with every handler `hx` ships.
///
/// `pack` serves whole-tree walks from one [`WalkCache`], and `txn` clears it after every
/// call that may change the workspace.
///
/// # Panics
/// Never: registering the built-in handlers cannot conflict. See the test that proves it.
#[must_use]
pub fn build_dispatcher() -> Dispatcher {
    let mut dispatcher = Dispatcher::new(VERSION);
    let cache = Arc::new(WalkCache::default());
    // The built-in handlers claim disjoint namespaces, which `registers_every_builtin_handler`
    // verifies, so registration cannot fail here.
    #[allow(clippy::expect_used)]
    {
        dispatcher
            .register(Arc::new(InvalidatingHandler::new(
                TxnHandler::new(),
                Arc::clone(&cache),
            )))
            .expect("txn methods are unique and in the txn namespace");
        dispatcher
            .register(Arc::new(PackHandler::new(cache)))
            .expect("pack methods are unique and in the pack namespace");
    }
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
            "pack.search",
            "pack.read",
            "pack.symbol",
            "pack.outline",
            "pack.status",
            "pack.bundle",
        ] {
            assert!(methods.contains(&m), "{m}");
        }
        let caps = d.describe().capabilities;
        assert!(caps.contains(&"txn.edit.diff".to_owned()));
        assert!(caps.contains(&"pack.search".to_owned()));
        assert!(caps.contains(&"pack.lang.rust".to_owned()));
        assert_eq!(d.describe().methods, methods);
        assert_eq!(d.describe().protocol, "hx-v1");
    }
}
