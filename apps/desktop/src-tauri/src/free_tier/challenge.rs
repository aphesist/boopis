//! The free tier's browser challenge, host half (`docs/research/free-tier.md` section 1.5). The account service may ask an
//! anonymous install to clear a check before it mints a token; the check is a portal page whose behaviour is the portal's.
//! The host's whole job is to load that page in a hidden window, reveal the window only if the page asks for a person, and
//! close it when the page says it is finished. The page speaks through its URL fragment, which needs no bridge into it:
//!
//! | fragment | meaning | window |
//! |---|---|---|
//! | `#working` | nothing to show | stays hidden |
//! | `#interactive` | needs the person | revealed (never for an optional challenge) |
//! | `#done` / `#failed` | finished | closed |
//!
//! The window sits behind a trait (`WindowHost`) so the whole flow is tested without a display. Nothing here holds a
//! credential: Hermes polls the account service itself and re-mints; the outcome is a hint it is told about.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::watch;
use tokio::time::Instant;
use url::Url;

use crate::config::Challenge as Config;
use crate::error::Result;

/// What the page's fragment says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Nothing to show.
    Working,
    /// A person is needed.
    Interactive,
    /// Passed.
    Done,
    /// Ended without a pass.
    Failed,
}

/// The phase a URL's fragment names, or `None` for no (or an unknown) fragment.
#[must_use]
pub fn phase_of(url: &Url) -> Option<Phase> {
    match url.fragment()? {
        "working" => Some(Phase::Working),
        "interactive" => Some(Phase::Interactive),
        "done" => Some(Phase::Done),
        "failed" => Some(Phase::Failed),
        _ => None,
    }
}

/// How a window ended, as `free_tier.challenge_result` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The page said it passed.
    Done,
    /// The page said it failed, or left the portal, or an optional challenge asked for a person.
    Failed,
    /// The person closed the window.
    Closed,
    /// It ran out of time.
    Timeout,
    /// The request was not a portal challenge, so nothing was opened.
    Refused,
    /// The window could not be created.
    Error,
}

impl Outcome {
    /// The word Hermes's contract uses.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Closed => "closed",
            Self::Timeout => "timeout",
            Self::Refused => "refused",
            Self::Error => "error",
        }
    }

    /// Whether the same ticket is worth another window after this.
    fn retryable(self) -> bool {
        matches!(self, Self::Timeout | Self::Error)
    }
}

/// One challenge to run: Hermes's `free_tier.challenge` payload.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    /// The page.
    pub url: String,
    /// `false` for a challenge the service only measures with: never revealed.
    pub required: bool,
    /// Seconds the ticket has left, as the service said.
    pub expires_in: Option<f64>,
    /// A new foreground attempt may reopen a window the person closed.
    pub attempt: u64,
}

/// Read a challenge payload. Untrusted: only the documented shape is accepted.
#[must_use]
pub fn parse_request(payload: &Value, max_url_len: usize) -> Option<Request> {
    if payload.get("type").and_then(Value::as_str) != Some("browser") {
        return None;
    }
    let url = payload.get("url")?.as_str()?;
    if url.is_empty() || url.len() > max_url_len {
        return None;
    }
    Some(Request {
        url: url.to_owned(),
        required: payload.get("required") != Some(&Value::Bool(false)),
        expires_in: payload
            .get("expires_in")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n > 0.0),
        attempt: payload.get("attempt").and_then(Value::as_u64).unwrap_or(0),
    })
}

/// The parsed URL when it is a challenge page of the portal: http or https, the portal's origin, under the challenge path.
#[must_use]
pub fn pinned(url: &str, cfg: &Config) -> Option<Url> {
    let target = Url::parse(url).ok()?;
    let portal = Url::parse(&cfg.portal_origin).ok()?;
    let under = target.path() == cfg.path || target.path().starts_with(&format!("{}/", cfg.path));
    (matches!(target.scheme(), "http" | "https") && target.origin() == portal.origin() && under)
        .then_some(target)
}

/// The window of a running challenge.
pub trait Window: Send + Sync {
    /// Its current address, `None` when it cannot be read (it is gone, or loading).
    fn url(&self) -> Option<Url>;
    /// Whether the window still exists (the person did not close it).
    fn alive(&self) -> bool;
    /// Show it and give it focus.
    fn reveal(&self);
    /// Destroy it. Idempotent.
    fn close(&self);
}

/// Where windows come from.
pub trait WindowHost: Send + Sync {
    /// Create a window that is not shown, loading `url`, with no access to the host's commands.
    ///
    /// # Errors
    /// Whatever the toolkit refuses.
    fn open_hidden(&self, url: &Url) -> Result<Box<dyn Window>>;
}

fn ticket_life(expires_in: Option<f64>, cfg: &Config) -> Duration {
    let asked = expires_in
        .filter(|s| *s > 0.0)
        .map_or(cfg.default_ticket_life, Duration::from_secs_f64);
    asked.clamp(cfg.ticket_life.0, cfg.ticket_life.1)
}

/// Run one window to its end.
pub async fn drive(host: &dyn WindowHost, cfg: &Config, request: &Request, url: &Url) -> Outcome {
    let window = match host.open_hidden(url) {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!(error = %e, "the free tier's challenge window could not be created");
            return Outcome::Error;
        }
    };
    let portal = Url::parse(&cfg.portal_origin).ok().map(|u| u.origin());
    let mut deadline = Instant::now() + cfg.hidden_deadline;
    let mut revealed = false;
    let mut lingering: Option<(Outcome, Instant)> = None;
    let outcome = loop {
        tokio::time::sleep(cfg.poll_every).await;
        if !window.alive() {
            break Outcome::Closed;
        }
        let now = Instant::now();
        if let Some((outcome, until)) = lingering {
            if now >= until {
                break outcome;
            }
            continue;
        }
        if now >= deadline {
            break Outcome::Timeout;
        }
        let Some(at) = window.url() else { continue };
        // Only the portal speaks for the challenge: a window that left it ends the run, and no phase is read from it.
        if Some(at.origin()) != portal {
            break Outcome::Failed;
        }
        match phase_of(&at) {
            None | Some(Phase::Working) => {}
            Some(Phase::Interactive) => {
                if !request.required {
                    break Outcome::Failed; // an optional check has nothing to ask a person
                }
                if !revealed {
                    revealed = true;
                    deadline = now + ticket_life(request.expires_in, cfg);
                    window.reveal();
                }
            }
            Some(phase @ (Phase::Done | Phase::Failed)) => {
                let outcome = if phase == Phase::Done {
                    Outcome::Done
                } else {
                    Outcome::Failed
                };
                if !revealed {
                    break outcome;
                }
                let linger = if phase == Phase::Done {
                    cfg.revealed_done_linger
                } else {
                    cfg.revealed_failed_linger
                };
                lingering = Some((outcome, now + linger));
            }
        }
    };
    window.close();
    tracing::info!(
        outcome = outcome.as_str(),
        revealed,
        "the free tier's challenge window ended"
    );
    outcome
}

enum Claim {
    Join(watch::Receiver<Option<Outcome>>),
    Settled(Outcome),
    Start(watch::Sender<Option<Outcome>>),
}

/// Runs challenges: one window per challenge URL however many times it is announced, and a settled one is remembered so a
/// window the person closed does not come back for the same ticket.
pub struct Windows {
    host: Arc<dyn WindowHost>,
    cfg: Config,
    running: Mutex<HashMap<String, watch::Receiver<Option<Outcome>>>>,
    settled: Mutex<HashMap<String, (Outcome, Instant)>>,
}

impl Windows {
    /// A runner over `host`.
    #[must_use]
    pub fn new(host: Arc<dyn WindowHost>, cfg: Config) -> Self {
        Self {
            host,
            cfg,
            running: Mutex::new(HashMap::new()),
            settled: Mutex::new(HashMap::new()),
        }
    }

    /// The configuration in force.
    #[must_use]
    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Decide, under the lock and without awaiting, whether this ask joins a run, repeats a settled one or starts one.
    fn claim(&self, running_key: &str, attempt_key: &str) -> Claim {
        let mut running = self.running.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(rx) = running.get(running_key) {
            return Claim::Join(rx.clone());
        }
        if let Some((outcome, at)) = self
            .settled
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(attempt_key)
            .copied()
            && at.elapsed() < self.cfg.settled_memory
            && !outcome.retryable()
        {
            return Claim::Settled(outcome);
        }
        let (tx, rx) = watch::channel(None);
        running.insert(running_key.to_owned(), rx);
        Claim::Start(tx)
    }

    /// Run `request` and say how it ended.
    pub async fn run(&self, request: Request) -> Outcome {
        let Some(url) = pinned(&request.url, &self.cfg) else {
            tracing::warn!("a free-tier challenge outside the portal origin was refused");
            return Outcome::Refused;
        };
        // A required ask for a ticket that ran as optional (never revealed) must not join that run or inherit its verdict.
        let running_key = format!("{}:{}", request.url, request.required);
        let attempt_key = format!("{running_key}:{}", request.attempt);
        let tx = match self.claim(&running_key, &attempt_key) {
            Claim::Settled(outcome) => return outcome,
            Claim::Join(mut rx) => {
                return loop {
                    if let Some(o) = *rx.borrow_and_update() {
                        break o;
                    }
                    if rx.changed().await.is_err() {
                        break Outcome::Error;
                    }
                };
            }
            Claim::Start(tx) => tx,
        };
        let outcome = drive(self.host.as_ref(), &self.cfg, &request, &url).await;
        {
            let mut settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
            settled.insert(attempt_key, (outcome, Instant::now()));
            let memory = self.cfg.settled_memory;
            settled.retain(|_, (_, at)| at.elapsed() < memory);
        }
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&running_key);
        let _ = tx.send(Some(outcome));
        outcome
    }
}
