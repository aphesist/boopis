//! The host's tunable numbers, as data with defaults (`docs/STANDARDS.md` section 1, rule 6).

/// The Hermes version the plugin requires (`plugins/hypotaxis/plugin.yaml` `requires_hermes`).
pub const REQUIRES_HERMES: &str = ">=0.23.2";

/// Limits and timings of the gateway proxy and the Hermes lifecycle.
#[derive(Debug, Clone)]
pub struct Limits {
    /// The largest frame accepted from the gateway (a `session.resume` answer carries a whole history).
    pub max_inbound_frame: usize,
    /// The largest frame accepted from the UI.
    pub max_outbound_frame: usize,
    /// Frames queued per UI connection before `message.delta` frames start to coalesce.
    pub queue_soft_cap: usize,
    /// Frames queued per UI connection before the connection is declared too slow and closed.
    pub queue_hard_cap: usize,
    /// How often the host pings the gateway.
    pub ping_every: std::time::Duration,
    /// How long the gateway may stay silent (no frame, no pong) before the link counts as dead.
    pub silence_limit: std::time::Duration,
    /// How long a single request to the gateway may wait for its response.
    pub request_timeout: std::time::Duration,
    /// How long `hermes gateway ensure` may take (a cold start is about 3 s, the first one 7 s).
    pub ensure_timeout: std::time::Duration,
    /// How long a short `hermes` call (`--version`, `attach`) may take.
    pub cli_timeout: std::time::Duration,
    /// First reconnect delay.
    pub backoff_first: std::time::Duration,
    /// Longest reconnect delay.
    pub backoff_max: std::time::Duration,
    /// Events the host replays per session after a reconnect, at most.
    pub replay_sessions: usize,
}

impl Default for Limits {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            max_inbound_frame: 32 * 1024 * 1024,
            max_outbound_frame: 8 * 1024 * 1024,
            queue_soft_cap: 2048,
            queue_hard_cap: 16 * 1024,
            ping_every: Duration::from_secs(20),
            silence_limit: Duration::from_secs(75),
            request_timeout: Duration::from_mins(2),
            ensure_timeout: Duration::from_mins(1),
            cli_timeout: Duration::from_secs(30),
            backoff_first: Duration::from_millis(400),
            backoff_max: Duration::from_secs(15),
            replay_sessions: 64,
        }
    }
}
