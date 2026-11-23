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
    /// The most frames the host hands a UI connection in one delivery (one script run in the web view).
    pub batch_frames: usize,
    /// About the most bytes of one delivery (a single larger frame still goes alone).
    pub batch_bytes: usize,
    /// Deliveries a UI connection may have unacknowledged. Past it the host waits for the page, so frames wait in
    /// the bounded queue (where they coalesce and are counted) instead of piling up unbounded inside the web view.
    pub ui_credit: usize,
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
    /// How long a connector's OAuth sign-in waits for the browser before the host cancels it. Hermes's own callback
    /// window is `oauth.timeout` (300 s by default); the host's is a little longer so Hermes ends it first, in words.
    pub connector_signin_timeout: std::time::Duration,
    /// How long a restart waits for the old gateway to stop answering before it starts the new one.
    pub gateway_stop_wait: std::time::Duration,
    /// How long a sign-in start is retried while Hermes still counts the one just cancelled as open (its worker ends a moment
    /// after the cancel).
    pub connector_start_wait: std::time::Duration,
    /// How often a restart that waits for idle sessions asks whether any has a turn running.
    pub restart_poll_every: std::time::Duration,
    /// The longest such a restart waits before it gives up and says so.
    pub restart_wait_max: std::time::Duration,
    /// How often the host asks Hermes how a sign-in stands.
    pub connector_poll_every: std::time::Duration,
    /// How long a provider's own `login` command may run.
    pub login_timeout: std::time::Duration,
    /// The most output kept from a `login` command, per stream.
    pub login_output_cap: usize,
    /// The last lines of its output shown to the user.
    pub login_output_lines: usize,
    /// The longest one request to OpenAI's sign-in service may take (the ChatGPT sign-in, ADR-0030).
    pub chatgpt_http_timeout: std::time::Duration,
    /// How long the ChatGPT sign-in waits for the user to type the code (OpenAI's code lives 15 minutes).
    pub chatgpt_signin_timeout: std::time::Duration,
    /// Renew the ChatGPT access token when it has less than this left (or half its life, if that is shorter).
    pub chatgpt_refresh_ahead: std::time::Duration,
    /// How often the host looks whether the ChatGPT access token is due.
    pub chatgpt_refresh_every: std::time::Duration,
    /// The store's caps and timings (`docs/STORE.md` 5.3), as data.
    pub store: StoreLimits,
    /// The local API's caps and timings (`ADR-0045`).
    pub api: ApiLimits,
    /// How rooms hold a message while their members work (`rooms/hold.rs`).
    pub rooms: RoomLimits,
}

/// How a message written while a room's members work is held (`rooms/hold.rs`, `rooms/discussion.rs`).
#[derive(Debug, Clone)]
pub struct RoomLimits {
    /// A discussion the log shows open but silent (no turn running, nothing new written) for this long is taken as stuck, so
    /// a held message does not wait on it: the engine's router waits 20 s at most and its worker polls every 5 s.
    pub quiet_grace: std::time::Duration,
    /// How often the app reads the rooms that hold messages.
    pub hold_every: std::time::Duration,
    /// The longest a command waits for its own held message to go out (a turn may run half an hour).
    pub hold_wait: std::time::Duration,
    /// Messages held for one room, at most.
    pub held_per_room: usize,
    /// The longest message (the engine's own cap on a user message, 64 KiB).
    pub max_text: usize,
}

impl Default for RoomLimits {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            quiet_grace: Duration::from_secs(45),
            hold_every: Duration::from_secs(2),
            hold_wait: Duration::from_hours(3),
            held_per_room: 20,
            max_text: 64 * 1024,
        }
    }
}

/// The local API's caps and timings: what the feed keeps, how often it asks the engine, and what the endpoint accepts.
#[derive(Debug, Clone)]
pub struct ApiLimits {
    /// The port the endpoint tries first; any free port on `127.0.0.1` when it is taken.
    pub preferred_port: u16,
    /// The largest request head (the request line and the headers).
    pub max_head: usize,
    /// Headers in a request, at most.
    pub max_headers: usize,
    /// The longest request target.
    pub max_target: usize,
    /// The largest request body.
    pub max_body: usize,
    /// The longest text sent to a bot or a room.
    pub max_say: usize,
    /// How long a client may take to send its head and its body.
    pub read_timeout: std::time::Duration,
    /// Connections served at once.
    pub max_connections: usize,
    /// Event streams open at once.
    pub max_streams: usize,
    /// Requests a second, and the burst, for reads.
    pub read_rate: (u32, u32),
    /// Requests a second, and the burst, for writes (a message, an answer).
    pub write_rate: (u32, u32),
    /// Wrong tokens that close the door, within `auth_window`.
    pub auth_failures: u32,
    /// The window those are counted in.
    pub auth_window: std::time::Duration,
    /// How long the door stays closed.
    pub auth_lockout: std::time::Duration,
    /// Events kept for a stream that resumes after `Last-Event-ID`, and the room a live stream has before it is told it lagged.
    pub ring: usize,
    /// How often a quiet stream is sent a comment so a dead client is noticed.
    pub keepalive: std::time::Duration,
    /// How often the live sessions of every bot are asked about while somebody listens.
    pub poll_every: std::time::Duration,
    /// How often the roster is read again while somebody listens.
    pub roster_every: std::time::Duration,
    /// How long one request to the engine may wait.
    pub engine_wait: std::time::Duration,
    /// Notifications kept.
    pub notes_kept: usize,
    /// The longest text a notification or an approval carries.
    pub text_cap: usize,
    /// The longest text one conversation message carries (longer is cut, and says so).
    pub message_cap: usize,
    /// Rows of a conversation one read asks the engine for, at most (the call's `limit` is held to it).
    pub conversation_rows: usize,
    /// Bots one event stream may narrow its conversation events to.
    pub follow_bots: usize,
    /// How often a streaming reply is sent again while it grows.
    pub stream_every: std::time::Duration,
    /// A kanban worker counts as running while its session showed life this recently (the engine refreshes a running
    /// worker's `last_active` at least every minute; the app's roster uses the same window).
    pub worker_active: std::time::Duration,
    /// How often each bot's cron list is read while somebody listens, for the runs that finished (B42).
    pub cron_every: std::time::Duration,
}

impl Default for ApiLimits {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            preferred_port: 47_821,
            max_head: 8 * 1024,
            max_headers: 32,
            max_target: 512,
            max_body: 64 * 1024,
            max_say: 32 * 1024,
            read_timeout: Duration::from_secs(5),
            max_connections: 16,
            max_streams: 8,
            read_rate: (20, 40),
            write_rate: (2, 6),
            auth_failures: 5,
            auth_window: Duration::from_secs(10),
            auth_lockout: Duration::from_secs(10),
            ring: 512,
            keepalive: Duration::from_secs(15),
            poll_every: Duration::from_secs(2),
            roster_every: Duration::from_secs(10),
            engine_wait: Duration::from_secs(8),
            notes_kept: 200,
            text_cap: 400,
            message_cap: 16 * 1024,
            conversation_rows: 200,
            follow_bots: 6,
            stream_every: Duration::from_millis(250),
            worker_active: Duration::from_secs(90),
            cron_every: Duration::from_secs(10),
        }
    }
}

/// The caps and timings of the store: what the host accepts from a source, and for how long it keeps what it fetched.
#[derive(Debug, Clone)]
pub struct StoreLimits {
    /// The largest catalogue response read.
    pub max_catalogue_bytes: u64,
    /// The largest archive downloaded.
    pub max_archive_bytes: u64,
    /// Entries in a staged tree, at most.
    pub max_entries: u64,
    /// Directory depth in a staged tree, at most.
    pub max_depth: usize,
    /// One staged file, at most.
    pub max_file_bytes: u64,
    /// The longest a connection may take.
    pub connect_timeout: std::time::Duration,
    /// The longest a whole request may take.
    pub request_timeout: std::time::Duration,
    /// Redirects followed per request (each hop is checked against the host list).
    pub max_redirects: u32,
    /// How old a source's cache may be before a refresh is due.
    pub refresh_every: std::time::Duration,
    /// The same for the MCP Registry, which is synced more often.
    pub registry_refresh_every: std::time::Duration,
    /// How long a staging folder lives.
    pub stage_ttl: std::time::Duration,
    /// Pages of the MCP Registry read in one refresh, at most (100 servers a page).
    pub registry_max_pages: u32,
    /// Items one source may hold in the cache.
    pub max_items_per_source: usize,
}

impl Default for StoreLimits {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            max_catalogue_bytes: 16 * 1024 * 1024,
            max_archive_bytes: 64 * 1024 * 1024,
            max_entries: 10_000,
            max_depth: 32,
            max_file_bytes: 16 * 1024 * 1024,
            connect_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_mins(1),
            max_redirects: 5,
            refresh_every: Duration::from_hours(6),
            registry_refresh_every: Duration::from_hours(1),
            stage_ttl: Duration::from_hours(1),
            registry_max_pages: 120,
            max_items_per_source: 20_000,
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        use std::time::Duration;
        Self {
            max_inbound_frame: 32 * 1024 * 1024,
            max_outbound_frame: 8 * 1024 * 1024,
            queue_soft_cap: 2048,
            queue_hard_cap: 16 * 1024,
            batch_frames: 256,
            batch_bytes: 1024 * 1024,
            ui_credit: 4,
            ping_every: Duration::from_secs(20),
            silence_limit: Duration::from_secs(75),
            request_timeout: Duration::from_mins(2),
            ensure_timeout: Duration::from_mins(1),
            cli_timeout: Duration::from_secs(30),
            backoff_first: Duration::from_millis(400),
            backoff_max: Duration::from_secs(15),
            replay_sessions: 64,
            connector_signin_timeout: Duration::from_secs(330),
            gateway_stop_wait: Duration::from_secs(20),
            connector_start_wait: Duration::from_secs(10),
            restart_poll_every: Duration::from_secs(5),
            restart_wait_max: Duration::from_hours(8),
            connector_poll_every: Duration::from_secs(1),
            login_timeout: Duration::from_mins(5),
            login_output_cap: 64 * 1024,
            login_output_lines: 30,
            chatgpt_http_timeout: Duration::from_secs(20),
            chatgpt_signin_timeout: Duration::from_mins(15),
            chatgpt_refresh_ahead: Duration::from_mins(30),
            chatgpt_refresh_every: Duration::from_mins(5),
            store: StoreLimits::default(),
            api: ApiLimits::default(),
            rooms: RoomLimits::default(),
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
