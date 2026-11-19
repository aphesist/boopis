//! The connection state machine, pure so it can be tested without a socket. The UI sees its phases as
//! `connection.state` frames: `connecting`, `ready`, `degraded`, `incompatible`.

use std::time::Duration;

use serde::Serialize;
use specta::Type;

/// Where the link to the gateway is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Dialling, or waiting for the handshake.
    Connecting,
    /// Handshake done: frames flow.
    Ready,
    /// The link is down or failing; the host keeps trying.
    Degraded,
    /// The gateway cannot be used (too old, wrong protocol); the host stops until told to retry.
    Incompatible,
}

impl Phase {
    /// The phase's name on the wire.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Ready => "ready",
            Self::Degraded => "degraded",
            Self::Incompatible => "incompatible",
        }
    }
}

/// What happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// A dial attempt starts.
    Dialing,
    /// A dial or handshake failed; `fatal` when retrying cannot help (incompatible, Hermes missing).
    DialFailed {
        /// Whether to stop retrying.
        fatal: bool,
    },
    /// The handshake finished.
    HandshakeDone,
    /// The link dropped (close, error, silence).
    LinkLost,
    /// The user asked to try again.
    Retry,
}

/// What the actor does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Dial after this delay.
    Dial(Duration),
    /// Serve frames.
    Serve,
    /// Wait for a `Retry`.
    Park,
    /// Nothing to do for this event.
    Stay,
}

/// The state machine.
#[derive(Debug)]
pub struct Machine {
    phase: Phase,
    failures: u32,
    first: Duration,
    max: Duration,
}

impl Machine {
    /// A machine in `Connecting` with this backoff.
    #[must_use]
    pub fn new(first: Duration, max: Duration) -> Self {
        Self {
            phase: Phase::Connecting,
            failures: 0,
            first,
            max,
        }
    }

    /// The current phase.
    #[must_use]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Consecutive failed dials since the last ready.
    #[must_use]
    pub fn failures(&self) -> u32 {
        self.failures
    }

    fn delay(&self) -> Duration {
        // The first retry after a lost link is immediate: a gateway that idle-exited (600 s) is restarted by the
        // attach, and the user should not wait for it. Failures then back off exponentially.
        if self.failures == 0 {
            return Duration::ZERO;
        }
        let exp = self.failures.saturating_sub(1).min(16);
        self.first.saturating_mul(1u32 << exp).min(self.max)
    }

    /// Apply an event and say what to do.
    pub fn on(&mut self, event: Event) -> Step {
        match (self.phase, event) {
            (_, Event::Dialing) => {
                if self.phase != Phase::Degraded {
                    self.phase = Phase::Connecting;
                }
                Step::Stay
            }
            (_, Event::HandshakeDone) => {
                self.phase = Phase::Ready;
                self.failures = 0;
                Step::Serve
            }
            (_, Event::DialFailed { fatal: true }) => {
                self.phase = Phase::Incompatible;
                Step::Park
            }
            (_, Event::DialFailed { fatal: false }) => {
                self.phase = Phase::Degraded;
                self.failures = self.failures.saturating_add(1);
                Step::Dial(self.delay())
            }
            (Phase::Ready | Phase::Connecting | Phase::Degraded, Event::LinkLost) => {
                self.phase = Phase::Degraded;
                Step::Dial(self.delay())
            }
            (Phase::Incompatible | Phase::Degraded, Event::Retry) => {
                self.phase = Phase::Connecting;
                self.failures = 0;
                Step::Dial(Duration::ZERO)
            }
            (_, Event::Retry) | (Phase::Incompatible, Event::LinkLost) => Step::Stay,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> Machine {
        Machine::new(Duration::from_millis(400), Duration::from_secs(15))
    }

    #[test]
    fn a_healthy_start() {
        let mut m = machine();
        assert_eq!(m.phase(), Phase::Connecting);
        assert_eq!(m.on(Event::Dialing), Step::Stay);
        assert_eq!(m.on(Event::HandshakeDone), Step::Serve);
        assert_eq!(m.phase(), Phase::Ready);
    }

    #[test]
    fn the_first_reconnect_after_a_loss_is_immediate_then_backs_off() {
        let mut m = machine();
        m.on(Event::HandshakeDone);
        assert_eq!(m.on(Event::LinkLost), Step::Dial(Duration::ZERO));
        assert_eq!(m.phase(), Phase::Degraded);
        assert_eq!(
            m.on(Event::DialFailed { fatal: false }),
            Step::Dial(Duration::from_millis(400))
        );
        assert_eq!(
            m.on(Event::DialFailed { fatal: false }),
            Step::Dial(Duration::from_millis(800))
        );
        assert_eq!(
            m.on(Event::DialFailed { fatal: false }),
            Step::Dial(Duration::from_millis(1600))
        );
        for _ in 0..20 {
            m.on(Event::DialFailed { fatal: false });
        }
        assert_eq!(
            m.on(Event::DialFailed { fatal: false }),
            Step::Dial(Duration::from_secs(15)),
            "capped"
        );
        assert!(m.failures() > 10);
    }

    #[test]
    fn a_success_resets_the_backoff() {
        let mut m = machine();
        m.on(Event::LinkLost);
        m.on(Event::DialFailed { fatal: false });
        m.on(Event::DialFailed { fatal: false });
        m.on(Event::HandshakeDone);
        assert_eq!(m.failures(), 0);
        assert_eq!(m.on(Event::LinkLost), Step::Dial(Duration::ZERO));
    }

    #[test]
    fn dialing_does_not_hide_a_degraded_phase() {
        let mut m = machine();
        m.on(Event::LinkLost);
        m.on(Event::Dialing);
        assert_eq!(
            m.phase(),
            Phase::Degraded,
            "the UI keeps saying degraded until ready"
        );
    }

    #[test]
    fn incompatible_parks_until_the_user_retries() {
        let mut m = machine();
        assert_eq!(m.on(Event::DialFailed { fatal: true }), Step::Park);
        assert_eq!(m.phase(), Phase::Incompatible);
        assert_eq!(m.on(Event::LinkLost), Step::Stay);
        assert_eq!(m.on(Event::Retry), Step::Dial(Duration::ZERO));
        assert_eq!(m.phase(), Phase::Connecting);
        assert_eq!(m.on(Event::HandshakeDone), Step::Serve);
    }

    #[test]
    fn retry_while_ready_changes_nothing() {
        let mut m = machine();
        m.on(Event::HandshakeDone);
        assert_eq!(m.on(Event::Retry), Step::Stay);
        assert_eq!(m.phase(), Phase::Ready);
    }
}
