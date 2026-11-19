//! An in-memory host that records every call. For tests and the benchmark only: the
//! `dev-fixtures` feature is never enabled in the binary.

use std::cell::RefCell;
use std::rc::Rc;

use serde_json::{Value, json};

use crate::host::{HostCalls, HostError, HostRequest};

/// A host that answers every call with a plausible value and remembers it.
///
/// Cloning gives another handle on the same record, so a test keeps one and hands the runtime
/// the other.
#[derive(Debug, Clone, Default)]
pub struct MemoryHost {
    calls: Rc<RefCell<Vec<HostRequest>>>,
    refuse: Rc<RefCell<Vec<String>>>,
}

impl MemoryHost {
    /// An empty host.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every call so far, oldest first.
    #[must_use]
    pub fn calls(&self) -> Vec<HostRequest> {
        self.calls.borrow().clone()
    }

    /// The calls named `call`.
    #[must_use]
    pub fn calls_to(&self, call: &str) -> Vec<HostRequest> {
        self.calls
            .borrow()
            .iter()
            .filter(|c| c.call == call)
            .cloned()
            .collect()
    }

    /// Forgets the recorded calls.
    pub fn clear(&self) {
        self.calls.borrow_mut().clear();
    }

    /// Makes later calls named `call` fail with `hx.policy.denied`.
    pub fn refuse(&self, call: &str) {
        self.refuse.borrow_mut().push(call.to_owned());
    }
}

impl HostCalls for MemoryHost {
    fn call(&mut self, request: &HostRequest) -> Result<Value, HostError> {
        self.calls.borrow_mut().push(request.clone());
        if self.refuse.borrow().contains(&request.call) {
            return Err(HostError {
                code: "hx.policy.denied".into(),
                message: format!("{} is refused", request.call),
            });
        }
        Ok(match request.call.as_str() {
            "ui.open" => json!({ "isPlaced": true }),
            _ => Value::Null,
        })
    }
}
