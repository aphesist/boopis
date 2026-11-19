//! The boundary between the isolates and the rest of the system.
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

/// Identifies a call that has not been answered yet.
pub type CallId = u64;

/// What the host does with a call the moment it arrives.
#[derive(Debug, Clone, PartialEq)]
pub enum HostReply {
    /// Answered at once (an in-memory host, a call that needs no one).
    Ready(Result<Value, HostError>),
    /// Accepted; the answer comes later through [`HostCalls::wait`]. The mod's promise stays
    /// pending, and the chain waits instead of blaming the hook.
    Pending,
}

/// One answer to a call that was [`HostReply::Pending`].
pub type Completion = (CallId, Result<Value, HostError>);

/// Performs `$` calls.
///
/// A `$` call returns a promise in the mod. [`HostCalls::call`] must not block: it either answers
/// at once or says [`HostReply::Pending`] and delivers the answer later from
/// [`HostCalls::wait`], which the driver calls only when every hook is idle and a call is
/// outstanding. A hook's time budget does not run while it waits for the host.
pub trait HostCalls: Send {
    /// Starts one call. `id` names it in a later [`Completion`].
    fn call(&mut self, id: CallId, request: &HostRequest) -> HostReply;

    /// Blocks for up to `timeout` for the answer to a pending call. `None` means nothing arrived.
    /// The default never answers, which suits a host that is never pending.
    fn wait(&mut self, timeout: std::time::Duration) -> Option<Completion> {
        let _ = timeout;
        None
    }
}
