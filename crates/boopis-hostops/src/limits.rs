//! The rate limits (section 4.4): a token bucket per verb class. Reads 20 a second, changes 2 a second, `team.plan` one
//! each 5 seconds; a call over its bucket is `hx.host.rate_limited`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::protocol::Class;

/// A bucket's size and how long one token takes to come back.
fn shape(class: Class) -> (f64, Duration) {
    match class {
        Class::Read => (20.0, Duration::from_millis(50)),
        Class::Change => (2.0, Duration::from_millis(500)),
        Class::Plan => (1.0, Duration::from_secs(5)),
    }
}

/// The buckets.
#[derive(Debug, Default)]
pub struct Limits {
    buckets: Mutex<HashMap<Class, (f64, Instant)>>,
}

impl Limits {
    /// Take one token of `class` at `now`; `false` when its bucket is empty.
    pub fn take(&self, class: Class, now: Instant) -> bool {
        let (size, every) = shape(class);
        let mut b = self
            .buckets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (tokens, at) = b.entry(class).or_insert((size, now));
        let back = now.saturating_duration_since(*at).as_secs_f64() / every.as_secs_f64();
        *tokens = (*tokens + back).min(size);
        *at = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
