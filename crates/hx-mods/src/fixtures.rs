//! An in-memory host that records every call. For tests and the benchmark only: the
//! `dev-fixtures` feature is never enabled in the binary.

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};

use crate::host::{CallId, HostCalls, HostError, HostReply, HostRequest};

/// A host that answers every call with a plausible value and remembers it.
///
/// Cloning gives another handle on the same record, so a test keeps one and hands the runtime
/// the other.
#[derive(Debug, Clone, Default)]
pub struct MemoryHost {
    calls: Arc<Mutex<Vec<HostRequest>>>,
    refuse: Arc<Mutex<Vec<String>>>,
}

impl MemoryHost {
    fn lock_calls(&self) -> std::sync::MutexGuard<'_, Vec<HostRequest>> {
        self.calls.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// An empty host.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every call so far, oldest first.
    #[must_use]
    pub fn calls(&self) -> Vec<HostRequest> {
        self.lock_calls().clone()
    }

    /// The calls named `call`.
    #[must_use]
    pub fn calls_to(&self, call: &str) -> Vec<HostRequest> {
        self.lock_calls()
            .iter()
            .filter(|c| c.call == call)
            .cloned()
            .collect()
    }

    /// Forgets the recorded calls.
    pub fn clear(&self) {
        self.lock_calls().clear();
    }

    /// Makes later calls named `call` fail with `hx.policy.denied`.
    pub fn refuse(&self, call: &str) {
        self.refuse
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(call.to_owned());
    }
}

impl HostCalls for MemoryHost {
    fn call(&mut self, _id: CallId, request: &HostRequest) -> HostReply {
        self.lock_calls().push(request.clone());
        if self
            .refuse
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&request.call)
        {
            return HostReply::Ready(Err(HostError {
                code: "hx.policy.denied".into(),
                message: format!("{} is refused", request.call),
            }));
        }
        HostReply::Ready(Ok(match request.call.as_str() {
            "ui.open" => json!({ "isPlaced": true }),
            _ => Value::Null,
        }))
    }
}
