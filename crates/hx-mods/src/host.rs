//! The boundary between the isolate and the rest of the system.
//!
//! Every `$` call that has an effect or reads the outside world leaves the isolate as one
//! [`HostRequest`]. The plugin implements [`HostCalls`] later, deciding each request with the
//! policy and performing it through Hermes, the host or the store. The isolate holds no handle to
//! anything: it cannot open a file, a socket or a process by itself.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One `$` call as the host sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostRequest {
    /// The plugin that made the call. The isolate sets it from the `$` it handed that plugin;
    /// a mod cannot name another.
    pub plugin: String,
    /// The call, as `namespace.method`: `ui.open`, `command.register`, `clock.every`, ...
    pub call: String,
    /// The single argument, as JSON (`null` when there was none).
    pub args: Value,
}

/// A refusal or failure from the host, thrown into the mod as an `Error` with a `code`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostError {
    /// A stable code such as `hx.policy.denied`.
    pub code: String,
    /// A message for the mod author.
    pub message: String,
}

/// Performs `$` calls.
///
/// The spike's calls are synchronous, which is all an in-memory host needs. The real host answers
/// from another thread; the answer then arrives as a promise resolved by the driver loop, which
/// already runs until the pending jobs drain.
pub trait HostCalls {
    /// Performs one call.
    ///
    /// # Errors
    /// A [`HostError`] is thrown into the calling hook.
    fn call(&mut self, request: &HostRequest) -> Result<Value, HostError>;
}
