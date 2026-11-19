//! The `hx` binary's library: the dispatcher wiring, the stdio server and the one-shot runner.
//!
//! - [`build_dispatcher`] registers every handler crate: txn, pack, sandbox and mods.
//! - [`serve`] speaks newline-delimited JSON-RPC 2.0 over any async reader and writer.
//! - [`oneshot`] runs a single method for debugging and tests, through the same dispatcher.

pub mod invalidate;
pub mod mods;
pub mod oneshot;
pub mod outbound;
pub mod schema;
pub mod serve;

use std::sync::Arc;

use hx_pack::{PackHandler, RedactHandler, WalkCache};
use hx_proto::Dispatcher;
use hx_sandbox::SandboxHandler;
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
    build_dispatcher_with(outbound::Link::new())
}

/// As [`build_dispatcher`], with the [`outbound::Link`] the mod workers' `$` calls travel on.
/// `serve_with_link` binds it to the stdio writer; a link that is never bound makes `mods.*`
/// calls fail with `hx.mods.no_host`.
///
/// # Panics
/// Never: registering the built-in handlers cannot conflict. See the test that proves it.
#[must_use]
pub fn build_dispatcher_with(link: Arc<outbound::Link>) -> Dispatcher {
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
        dispatcher
            .register(Arc::new(RedactHandler))
            .expect("redact methods are unique and in the redact namespace");
        dispatcher
            .register(Arc::new(SandboxHandler::new()))
            .expect("sandbox methods are unique and in the sandbox namespace");
        dispatcher
            .register(Arc::new(mods::ModsHandler::new(link)))
            .expect("mods methods are unique and in the mods namespace");
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
            "redact.apply",
            "sandbox.run",
            "sandbox.capabilities",
            "sandbox.spawn",
            "sandbox.wait",
            "sandbox.kill",
            "mods.capabilities",
            "mods.load",
            "mods.unload",
            "mods.list",
            "mods.dispatch",
            "mods.render",
            "mods.press",
            "mods.input",
            "mods.select",
            "mods.reach",
            "mods.analyze",
        ] {
            assert!(methods.contains(&m), "{m}");
        }
        let caps = d.describe().capabilities;
        assert!(caps.contains(&"txn.edit.diff".to_owned()));
        assert!(caps.contains(&"pack.search".to_owned()));
        assert!(caps.contains(&"pack.lang.rust".to_owned()));
        assert_eq!(d.describe().methods, methods);
        assert!(caps.contains(&"sandbox.run".to_owned()));
        assert_eq!(d.describe().protocol, "hx-v1");
    }
}
