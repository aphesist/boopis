//! The host's tunable numbers, as data with defaults (`docs/STANDARDS.md` section 1, rule 6).

/// The Hermes version the plugin requires (`plugins/boopis/plugin.yaml` `requires_hermes`).
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

/// Whether this build offers Nous's free tier ("Free models (Nous free tier, no account)") at all. Nous's Terms do not
/// say whether a third-party distribution of Hermes may use the anonymous tier (`docs/research/free-tier.md` section 5), so
/// the owner decides; `false` removes the choice from setup and stops the host declaring itself as the Desktop.
pub const FREE_TIER_ENABLED: bool = true;

/// The free tier's browser challenge, as data (`docs/research/free-tier.md` section 1.5): which origin may be loaded, and
/// the timings Hermes Desktop uses, so a challenge behaves the same here.
#[derive(Debug, Clone)]
pub struct Challenge {
    /// The Nous Portal's origin: the only origin a challenge page may be loaded from or navigate to.
    pub portal_origin: String,
    /// The path prefix of a challenge page on the portal.
    pub path: String,
    /// The longest a request's URL may be.
    pub max_url_len: usize,
    /// How long a challenge may run while its window is hidden (nobody can see it hang).
    pub hidden_deadline: std::time::Duration,
    /// The ticket's life when the service named none.
    pub default_ticket_life: std::time::Duration,
    /// The bounds of a ticket's life as the service reported it (network input that becomes a timer).
    pub ticket_life: (std::time::Duration, std::time::Duration),
    /// How long a window that was revealed lingers after the page says it passed ("You're all set").
    pub revealed_done_linger: std::time::Duration,
    /// How long a revealed window lingers after the page says it failed (long enough to read why).
    pub revealed_failed_linger: std::time::Duration,
    /// How long a settled challenge URL is remembered, so a closed window does not come back for the same ticket.
    pub settled_memory: std::time::Duration,
    /// How often the window's address is read (the page signals through its fragment).
    pub poll_every: std::time::Duration,
}

impl Default for Challenge {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            portal_origin: "https://portal.nousresearch.com".to_owned(),
            path: "/challenge".to_owned(),
            max_url_len: 2048,
            hidden_deadline: Duration::from_secs(90),
            default_ticket_life: Duration::from_mins(10),
            ticket_life: (Duration::from_secs(30), Duration::from_mins(15)),
            revealed_done_linger: Duration::from_millis(1500),
            revealed_failed_linger: Duration::from_secs(20),
            settled_memory: Duration::from_mins(10),
            poll_every: Duration::from_millis(250),
        }
    }
}
