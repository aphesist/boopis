//! The web view's health: a watchdog that notices a web process that died or stopped answering, recovers the page
//! instead of leaving the window grey, and keeps what happened for Settings > General > Diagnostics and `boopis doctor`.
//!
//! The owner's report (22 November 2026): boopis left running on Hyprland goes grey and unresponsive after a switch of
//! workspace or tab, across several versions. A grey window is what `WebKitGTK` shows when the page has nothing to
//! paint: its web process crashed, was killed (out of memory), or is stuck. Before this module nothing watched for it,
//! so the window stayed grey until the app was restarted, and nothing was left to say why.
//!
//! Three parts:
//!
//! - **The decision** (`Watchdog`): a pure table from what `WebKit` reports (the web process terminated, and why; the
//!   web process stopped or started answering `WebKit`'s own pings) and the clock, to what the host does: nothing,
//!   reload the page, or end the stuck web process and then reload. Recoveries back off (`BACKOFF`) so a page that
//!   fails again at once cannot reload in a tight loop, and the host never gives up on a dead page.
//! - **The record** (`Health`): the events of this run and of the previous run (read from a small JSON file next to
//!   the app's data), the page's longest main-thread stall and the proxy's outbox peak, and the plain notice the page
//!   shows once after a recovery.
//! - **The wiring** (`watch`, Linux only): the `web-process-terminated` signal and the `is-web-process-responsive`
//!   property of the main window's `WebKitWebView`, and a 2 s tick on the main loop. Reloading asks the host nothing
//!   new: the page reconnects to the engine through the host and reads its sessions and transcripts from there, and
//!   the UI's own choices are in its settings, which a reload keeps.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use specta::Type;

/// Why the web process ended, as `WebKit` says (`WebKitWebProcessTerminationReason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Ended {
    /// It crashed (the GPU or buffer path, a bug, or killed by a signal).
    Crashed,
    /// It went past `WebKit`'s memory limit.
    ExceededMemory,
    /// The host ended it (the watchdog, after it stopped answering).
    ByHost,
    /// A reason this build does not know.
    Unknown,
}

/// What the watchdog hears.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    /// The web process is gone.
    Terminated(Ended),
    /// `WebKit`'s `is-web-process-responsive` changed.
    Responsive(bool),
    /// The page's heartbeat arrived; whether the page said it was visible.
    Heartbeat(bool),
    /// The page started loading again (a reload): its heartbeat starts over.
    Loading,
    /// The clock: time passed.
    Tick,
}

/// Why the page was recovered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Why {
    /// The web process crashed.
    Crashed,
    /// The web process ran out of memory.
    OutOfMemory,
    /// The web process stopped answering for `Policy::unresponsive_after_ms`, or the page's heartbeat stopped.
    Unresponsive,
    /// The web process ended for a reason this build does not know.
    Ended,
}

impl Why {
    /// The plain sentence the page shows once after the recovery.
    #[must_use]
    pub const fn notice(self) -> &'static str {
        match self {
            Self::Crashed | Self::Ended => {
                "The window's page stopped working, so boopis reloaded it. Your sessions are as they were."
            }
            Self::OutOfMemory => {
                "The window's page ran out of memory, so boopis reloaded it. Your sessions are as they were."
            }
            Self::Unresponsive => {
                "The window stopped responding, so boopis reloaded it. Your sessions are as they were."
            }
        }
    }
}

/// What the host does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Nothing now.
    Nothing,
    /// Load the page again (`WebKit` starts a new web process for a dead one).
    Reload(Why),
    /// End the stuck web process; its `Terminated(ByHost)` then reloads.
    Terminate,
}

/// The watchdog's numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// How long the web process may stay unresponsive before the host ends it. `WebKit` itself marks it unresponsive
    /// after about 3 s without an answer; a long synchronous burst of work on return can take several seconds, so the
    /// host waits well past that before it decides the page is stuck.
    pub unresponsive_after_ms: u64,
    /// How long the page's heartbeat (every 10 s) may be missing while the page last said it was visible, before the
    /// page counts as stuck. `WebKit`'s own flag is only raised when the UI process waits on the web process (input,
    /// a load), so an idle window whose web process hung never shows it: measured under Xvfb with the web process
    /// stopped for two minutes, the flag never changed. The heartbeat is what notices that case.
    pub silent_visible_ms: u64,
    /// The same while the page last said it was hidden (`WebKit` may throttle a hidden page's timers).
    pub silent_hidden_ms: u64,
    /// The window over which recent recoveries count towards the back-off.
    pub window_ms: u64,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            unresponsive_after_ms: 20_000,
            silent_visible_ms: 35_000,
            silent_hidden_ms: 180_000,
            window_ms: 10 * 60_000,
        }
    }
}

/// How long to wait before a recovery, by how many recoveries the window already holds: the first two at once, then
/// 30 s, 2 min and 10 min apart. Never "give up": a grey window is the one outcome this module exists to prevent.
pub const BACKOFF: [u64; 5] = [0, 0, 30_000, 120_000, 600_000];

/// The decision table's state. Time is milliseconds on any monotonic clock.
#[derive(Debug, Clone, Default)]
pub struct Watchdog {
    policy: Policy,
    unresponsive_since: Option<u64>,
    /// The host ended the web process and waits for its `Terminated` to reload.
    terminating: bool,
    /// The page is dead and a recovery waits for the back-off.
    owed: Option<Why>,
    recoveries: VecDeque<u64>,
    /// The last heartbeat and whether the page was visible then; none until the page's first one after a load.
    beat: Option<(u64, bool)>,
}

impl Watchdog {
    /// A watchdog with these numbers.
    #[must_use]
    pub fn new(policy: Policy) -> Self {
        Self {
            policy,
            ..Self::default()
        }
    }

    /// Whether the page's heartbeat is overdue (it beat at least once since its load).
    #[must_use]
    pub fn silent(&self, now: u64) -> bool {
        self.beat.is_some_and(|(at, visible)| {
            let limit = if visible {
                self.policy.silent_visible_ms
            } else {
                self.policy.silent_hidden_ms
            };
            now.saturating_sub(at) >= limit
        })
    }

    /// Since when the web process has been unresponsive, if it is.
    #[must_use]
    pub const fn unresponsive_since(&self) -> Option<u64> {
        self.unresponsive_since
    }

    /// Decide what to do at `now` on `signal`.
    pub fn on(&mut self, now: u64, signal: Signal) -> Action {
        match signal {
            Signal::Terminated(ended) => {
                self.unresponsive_since = None;
                let why = match ended {
                    Ended::ByHost if self.terminating => Why::Unresponsive,
                    Ended::Crashed => Why::Crashed,
                    Ended::ExceededMemory => Why::OutOfMemory,
                    Ended::ByHost | Ended::Unknown => Why::Ended,
                };
                self.terminating = false;
                self.beat = None;
                self.owed = Some(why);
                self.try_recover(now)
            }
            Signal::Responsive(true) => {
                self.unresponsive_since = None;
                Action::Nothing
            }
            Signal::Responsive(false) => {
                if self.unresponsive_since.is_none() && !self.terminating {
                    self.unresponsive_since = Some(now);
                }
                Action::Nothing
            }
            Signal::Heartbeat(visible) => {
                self.beat = Some((now, visible));
                Action::Nothing
            }
            Signal::Loading => {
                self.beat = None;
                Action::Nothing
            }
            Signal::Tick => {
                if self.owed.is_some() {
                    return self.try_recover(now);
                }
                let flagged = self.unresponsive_since.is_some_and(|since| {
                    now.saturating_sub(since) >= self.policy.unresponsive_after_ms
                });
                let stuck = flagged || self.silent(now);
                if stuck && !self.terminating && self.may_recover(now) {
                    self.terminating = true;
                    Action::Terminate
                } else {
                    Action::Nothing
                }
            }
        }
    }

    fn recent(&mut self, now: u64) -> usize {
        while self
            .recoveries
            .front()
            .is_some_and(|t| now.saturating_sub(*t) > self.policy.window_ms)
        {
            self.recoveries.pop_front();
        }
        self.recoveries.len()
    }

    fn may_recover(&mut self, now: u64) -> bool {
        let n = self.recent(now);
        let wait = BACKOFF[n.min(BACKOFF.len() - 1)];
        self.recoveries
            .back()
            .is_none_or(|last| now.saturating_sub(*last) >= wait)
    }

    fn try_recover(&mut self, now: u64) -> Action {
        let Some(why) = self.owed else {
            return Action::Nothing;
        };
        if !self.may_recover(now) {
            return Action::Nothing;
        }
        self.owed = None;
        self.recoveries.push_back(now);
        Action::Reload(why)
    }
}

/// One thing that happened to the web view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename = "WebviewEvent")]
pub struct Event {
    /// When, in seconds since the Unix epoch.
    pub at: u32,
    /// `terminated`, `unresponsive`, `responsive`, `reloaded`, `stall` or `outbox`.
    pub kind: String,
    /// The reason or detail (`crashed`, `exceeded_memory`, the page's visibility...).
    pub detail: String,
    /// A duration in seconds, or a count, where the kind has one.
    pub value: Option<f64>,
}

/// One run's record.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename = "WebviewRun")]
pub struct Run {
    /// When this run started, in seconds since the Unix epoch.
    pub started: u32,
    /// The app's version.
    pub version: String,
    /// The events, oldest first, at most `MAX_EVENTS` (the oldest are dropped).
    pub events: Vec<Event>,
    /// The longest main-thread stall the page measured while it was visible, in milliseconds.
    pub longest_stall_ms: u32,
    /// The deepest any window's frame queue in the host went.
    pub outbox_peak: u32,
    /// How many times the page was reloaded to recover it.
    pub recoveries: u32,
    /// The last time the page said it was alive, in seconds since the Unix epoch, and whether it was visible then.
    pub last_heartbeat: Option<u32>,
    /// Whether the page was visible at the last heartbeat.
    pub last_visible: Option<bool>,
}

/// What Diagnostics and `boopis doctor` show.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename = "WebviewHealthReport")]
pub struct Report {
    /// Whether the host watches the web process (Linux, once the window exists).
    pub watching: bool,
    /// This run.
    pub this_run: Run,
    /// The run before, as it was left (the file is written as things happen, so a run that was killed still says
    /// what it saw).
    pub last_run: Option<Run>,
}

/// The most events a run keeps.
pub const MAX_EVENTS: usize = 40;

/// The shared record: the watchdog's decisions, this run's events and the file they are kept in.
#[derive(Debug)]
pub struct Health {
    inner: Mutex<Inner>,
    file: Option<PathBuf>,
    clock: std::time::Instant,
}

#[derive(Debug)]
struct Inner {
    dog: Watchdog,
    report: Report,
    notice: Option<Why>,
}

/// Seconds since the Unix epoch (a `u32` lasts until 2106, and the bindings carry it as a plain number).
#[must_use]
pub fn unix_now() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u32::try_from(d.as_secs()).unwrap_or(u32::MAX))
}

/// The file a run's record is kept in, under the app's data folder.
#[must_use]
pub fn file_in(data_dir: &Path) -> PathBuf {
    data_dir.join("diagnostics").join("webview-health.json")
}

/// The record a run left in `file`, if it can be read.
#[must_use]
pub fn read_run(file: &Path) -> Option<Run> {
    let text = std::fs::read_to_string(file).ok()?;
    serde_json::from_str(&text).ok()
}

impl Health {
    /// A record for this run. With a file, the previous run's record is read from it first, and this run's replaces it
    /// as things happen.
    #[must_use]
    pub fn new(file: Option<PathBuf>, version: &str, policy: Policy) -> Arc<Self> {
        let last_run = file.as_deref().and_then(read_run);
        let health = Self {
            inner: Mutex::new(Inner {
                dog: Watchdog::new(policy),
                report: Report {
                    watching: false,
                    this_run: Run {
                        started: unix_now(),
                        version: version.to_owned(),
                        ..Run::default()
                    },
                    last_run,
                },
                notice: None,
            }),
            file,
            clock: std::time::Instant::now(),
        };
        health.save();
        Arc::new(health)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn save(&self) {
        let Some(file) = &self.file else { return };
        let run = self.lock().report.this_run.clone();
        let write = || -> std::io::Result<()> {
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = file.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec_pretty(&run).unwrap_or_default())?;
            std::fs::rename(&tmp, file)
        };
        if let Err(e) = write() {
            tracing::debug!(error = %e, "could not keep the web view's health record");
        }
    }

    fn push(inner: &mut Inner, kind: &str, detail: &str, value: Option<f64>) {
        let events = &mut inner.report.this_run.events;
        events.push(Event {
            at: unix_now(),
            kind: kind.to_owned(),
            detail: detail.to_owned(),
            value,
        });
        if events.len() > MAX_EVENTS {
            let extra = events.len() - MAX_EVENTS;
            events.drain(..extra);
        }
    }

    /// Milliseconds since this record was made: the watchdog's clock.
    #[must_use]
    pub fn now_ms(&self) -> u64 {
        u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    /// Mark the web view as watched.
    pub fn set_watching(&self) {
        self.lock().report.watching = true;
    }

    /// Feed the watchdog a signal at `now` (milliseconds, monotonic); records what it means and returns the action.
    pub fn signal(&self, now: u64, signal: Signal) -> Action {
        let action;
        let mut changed = false;
        {
            let mut g = self.lock();
            let before = g.dog.unresponsive_since();
            let was_silent = g.dog.silent(now);
            action = g.dog.on(now, signal);
            match signal {
                Signal::Terminated(ended) => {
                    let detail = serde_json::to_value(ended)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    tracing::error!(reason = %detail, "the web view's process ended");
                    Self::push(&mut g, "terminated", &detail, None);
                    changed = true;
                }
                Signal::Responsive(false) if before.is_none() => {
                    tracing::warn!("the web view's process stopped responding");
                    Self::push(&mut g, "unresponsive", "", None);
                    changed = true;
                }
                Signal::Responsive(true) => {
                    if let Some(since) = before {
                        #[allow(clippy::cast_precision_loss)]
                        // milliseconds to seconds for a report
                        let secs = now.saturating_sub(since) as f64 / 1000.0;
                        tracing::warn!(seconds = secs, "the web view's process responds again");
                        Self::push(&mut g, "responsive", "", Some(secs));
                        changed = true;
                    }
                }
                _ => {}
            }
            match action {
                Action::Reload(why) => {
                    let detail = serde_json::to_value(why)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    tracing::warn!(why = %detail, "reloading the page to recover the window");
                    Self::push(&mut g, "reloaded", &detail, None);
                    g.report.this_run.recoveries += 1;
                    g.notice = Some(why);
                    changed = true;
                }
                Action::Terminate => {
                    let why = if was_silent {
                        "no heartbeat"
                    } else {
                        "unresponsive"
                    };
                    tracing::warn!(
                        why,
                        "ending the web view's stuck process to recover the window"
                    );
                    Self::push(&mut g, "ending", why, None);
                    changed = true;
                }
                Action::Nothing => {}
            }
        }
        if changed {
            self.save();
        }
        action
    }

    /// The page's heartbeat: whether it is visible, and the longest main-thread stall it measured since the last one
    /// (milliseconds). Returns the notice to show once after a recovery.
    pub fn heartbeat(&self, visible: bool, stall_ms: u32, outbox_peak: u32) -> Option<Why> {
        self.signal(self.now_ms(), Signal::Heartbeat(visible));
        let mut save = false;
        let notice = {
            let mut g = self.lock();
            let run = &mut g.report.this_run;
            run.last_heartbeat = Some(unix_now());
            run.last_visible = Some(visible);
            // A stall worth a line: past a second, and the longest so far.
            if stall_ms > run.longest_stall_ms {
                run.longest_stall_ms = stall_ms;
                if stall_ms >= 1000 {
                    tracing::warn!(stall_ms, "the page's main thread stalled");
                    Self::push(
                        &mut g,
                        "stall",
                        if visible { "visible" } else { "hidden" },
                        Some(f64::from(stall_ms) / 1000.0),
                    );
                    save = true;
                }
            }
            let run = &mut g.report.this_run;
            if outbox_peak > run.outbox_peak {
                let before = run.outbox_peak;
                run.outbox_peak = outbox_peak;
                // Kept in the file as it doubles, not at every frame.
                if outbox_peak >= 256 && outbox_peak >= before.saturating_mul(2) {
                    Self::push(
                        &mut g,
                        "outbox",
                        "peak frames queued",
                        Some(f64::from(outbox_peak)),
                    );
                    save = true;
                }
            }
            g.notice.take()
        };
        if save {
            self.save();
        }
        notice
    }

    /// The report for Diagnostics.
    #[must_use]
    pub fn report(&self) -> Report {
        self.lock().report.clone()
    }
}

/// A Unix time as `2026-11-22 04:51:07 UTC`, for a line a person reads.
#[must_use]
pub fn utc(secs: u64) -> String {
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    // Howard Hinnant's days-to-civil.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// The plain lines `boopis doctor` prints for a run's record.
#[must_use]
pub fn doctor_lines(run: &Run) -> Vec<String> {
    let mut out = vec![format!(
        "boopis {}, started {}; {} recoveries; longest page stall {} ms; outbox peak {} frames",
        run.version,
        utc(u64::from(run.started)),
        run.recoveries,
        run.longest_stall_ms,
        run.outbox_peak
    )];
    if let Some(at) = run.last_heartbeat {
        out.push(format!(
            "last page heartbeat at {} ({})",
            utc(u64::from(at)),
            match run.last_visible {
                Some(true) => "visible",
                Some(false) => "hidden",
                None => "visibility unknown",
            }
        ));
    }
    if run.events.is_empty() {
        out.push("no web view events".to_owned());
    }
    for e in &run.events {
        out.push(format!(
            "  {}  {}{}{}",
            utc(u64::from(e.at)),
            e.kind,
            if e.detail.is_empty() {
                String::new()
            } else {
                format!(" ({})", e.detail)
            },
            e.value.map_or_else(String::new, |v| format!(" {v}"))
        ));
    }
    out
}

/// Watch the main window's web view: its process ending and its responsiveness, with a tick on the main loop that
/// lets the watchdog act on a long unresponsive period and on a deferred recovery. Linux only.
#[cfg(target_os = "linux")]
pub fn watch(app: &tauri::AppHandle, health: Arc<Health>) {
    use tauri::Manager;
    use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("no main window to watch");
        return;
    };
    let result = window.with_webview(move |platform| {
        let view = platform.inner();
        let act = |view: &webkit2gtk::WebView, action: Action| match action {
            Action::Reload(_) => view.reload(),
            Action::Terminate => view.terminate_web_process(),
            Action::Nothing => {}
        };
        let h = health.clone();
        view.connect_web_process_terminated(move |view, reason| {
            let ended = match reason {
                WebProcessTerminationReason::Crashed => Ended::Crashed,
                WebProcessTerminationReason::ExceededMemoryLimit => Ended::ExceededMemory,
                WebProcessTerminationReason::TerminatedByApi => Ended::ByHost,
                _ => Ended::Unknown,
            };
            act(view, h.signal(h.now_ms(), Signal::Terminated(ended)));
        });
        let h = health.clone();
        view.connect_is_web_process_responsive_notify(move |view| {
            act(
                view,
                h.signal(
                    h.now_ms(),
                    Signal::Responsive(view.is_web_process_responsive()),
                ),
            );
        });
        let h = health.clone();
        let weak = webkit2gtk::glib::object::ObjectExt::downgrade(&view);
        webkit2gtk::glib::timeout_add_local(std::time::Duration::from_secs(2), move || {
            let Some(view) = weak.upgrade() else {
                return webkit2gtk::glib::ControlFlow::Break;
            };
            act(&view, h.signal(h.now_ms(), Signal::Tick));
            webkit2gtk::glib::ControlFlow::Continue
        });
        health.set_watching();
        tracing::info!("watching the web view's process");
    });
    if let Err(e) = result {
        tracing::warn!(error = %e, "could not watch the web view");
    }
}

/// No `WebKitGTK` here: nothing to watch.
#[cfg(not(target_os = "linux"))]
pub fn watch(_app: &tauri::AppHandle, _health: Arc<Health>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn dog() -> Watchdog {
        Watchdog::new(Policy::default())
    }

    #[test]
    fn a_crash_reloads_at_once_with_its_reason() {
        let mut d = dog();
        assert_eq!(
            d.on(1_000, Signal::Terminated(Ended::Crashed)),
            Action::Reload(Why::Crashed)
        );
        let mut d = dog();
        assert_eq!(
            d.on(1_000, Signal::Terminated(Ended::ExceededMemory)),
            Action::Reload(Why::OutOfMemory)
        );
        let mut d = dog();
        assert_eq!(
            d.on(1_000, Signal::Terminated(Ended::Unknown)),
            Action::Reload(Why::Ended)
        );
    }

    #[test]
    fn a_short_unresponsive_burst_is_left_alone() {
        let mut d = dog();
        assert_eq!(d.on(0, Signal::Responsive(false)), Action::Nothing);
        assert_eq!(d.on(10_000, Signal::Tick), Action::Nothing);
        assert_eq!(d.on(15_000, Signal::Responsive(true)), Action::Nothing);
        assert_eq!(
            d.on(40_000, Signal::Tick),
            Action::Nothing,
            "it answered again: nothing to do"
        );
    }

    #[test]
    fn a_long_unresponsive_period_ends_the_process_and_its_end_reloads() {
        let mut d = dog();
        d.on(0, Signal::Responsive(false));
        assert_eq!(d.on(19_999, Signal::Tick), Action::Nothing);
        assert_eq!(d.on(20_000, Signal::Tick), Action::Terminate);
        assert_eq!(
            d.on(22_000, Signal::Tick),
            Action::Nothing,
            "terminate once, then wait for its end"
        );
        assert_eq!(d.on(22_100, Signal::Responsive(false)), Action::Nothing);
        assert_eq!(
            d.on(22_500, Signal::Terminated(Ended::ByHost)),
            Action::Reload(Why::Unresponsive)
        );
        assert_eq!(d.unresponsive_since(), None);
    }

    #[test]
    fn a_page_whose_heartbeat_stops_is_ended_and_reloaded() {
        let mut d = dog();
        assert_eq!(d.on(0, Signal::Tick), Action::Nothing);
        assert_eq!(
            d.on(600_000, Signal::Tick),
            Action::Nothing,
            "no heartbeat yet: the page is still loading"
        );
        d.on(600_000, Signal::Heartbeat(true));
        assert_eq!(d.on(634_999, Signal::Tick), Action::Nothing);
        assert_eq!(
            d.on(635_000, Signal::Tick),
            Action::Terminate,
            "visible and silent for 35 s"
        );
        assert_eq!(
            d.on(636_000, Signal::Terminated(Ended::ByHost)),
            Action::Reload(Why::Unresponsive)
        );
        assert_eq!(
            d.on(900_000, Signal::Tick),
            Action::Nothing,
            "the new page has not beaten yet"
        );
    }

    #[test]
    fn a_hidden_page_gets_longer_before_its_silence_counts() {
        let mut d = dog();
        d.on(0, Signal::Heartbeat(false));
        assert_eq!(d.on(100_000, Signal::Tick), Action::Nothing);
        assert_eq!(d.on(180_000, Signal::Tick), Action::Terminate);
        let mut d = dog();
        d.on(0, Signal::Heartbeat(true));
        d.on(10_000, Signal::Loading);
        assert_eq!(
            d.on(100_000, Signal::Tick),
            Action::Nothing,
            "a reload starts the heartbeat over"
        );
    }

    #[test]
    fn repeated_failures_back_off_but_are_never_abandoned() {
        let mut d = dog();
        let mut now = 0;
        assert_eq!(
            d.on(now, Signal::Terminated(Ended::Crashed)),
            Action::Reload(Why::Crashed)
        );
        now += 1_000;
        assert_eq!(
            d.on(now, Signal::Terminated(Ended::Crashed)),
            Action::Reload(Why::Crashed)
        );
        now += 1_000;
        // the third within the window waits 30 s after the last
        assert_eq!(
            d.on(now, Signal::Terminated(Ended::Crashed)),
            Action::Nothing
        );
        assert_eq!(d.on(now + 20_000, Signal::Tick), Action::Nothing);
        assert_eq!(
            d.on(now + 29_000, Signal::Tick),
            Action::Reload(Why::Crashed)
        );
        now += 29_000;
        // the fourth waits 2 minutes
        assert_eq!(
            d.on(now + 1, Signal::Terminated(Ended::Crashed)),
            Action::Nothing
        );
        assert_eq!(d.on(now + 119_999, Signal::Tick), Action::Nothing);
        assert_eq!(
            d.on(now + 120_000, Signal::Tick),
            Action::Reload(Why::Crashed)
        );
        now += 120_000;
        // and an hour later the window is clear again
        now += 3_600_000;
        assert_eq!(
            d.on(now, Signal::Terminated(Ended::Crashed)),
            Action::Reload(Why::Crashed)
        );
    }

    #[test]
    fn an_unresponsive_page_inside_the_back_off_waits_for_it() {
        let mut d = dog();
        d.on(0, Signal::Terminated(Ended::Crashed));
        d.on(1_000, Signal::Terminated(Ended::Crashed));
        d.on(2_000, Signal::Responsive(false));
        assert_eq!(
            d.on(25_000, Signal::Tick),
            Action::Nothing,
            "the third recovery waits 30 s after the last"
        );
        assert_eq!(d.on(31_000, Signal::Tick), Action::Terminate);
    }

    #[test]
    fn the_record_keeps_events_the_notice_once_and_the_previous_run() {
        let dir = tempfile::tempdir().unwrap();
        let file = file_in(dir.path());
        let h = Health::new(Some(file.clone()), "0.1.8", Policy::default());
        assert_eq!(h.signal(0, Signal::Responsive(false)), Action::Nothing);
        assert_eq!(
            h.signal(5_000, Signal::Terminated(Ended::Crashed)),
            Action::Reload(Why::Crashed)
        );
        assert_eq!(h.heartbeat(true, 1_500, 300), Some(Why::Crashed));
        assert_eq!(h.heartbeat(true, 20, 310), None, "the notice is shown once");
        let r = h.report();
        let kinds: Vec<&str> = r.this_run.events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(
            kinds,
            ["unresponsive", "terminated", "reloaded", "stall", "outbox"]
        );
        assert_eq!(r.this_run.recoveries, 1);
        assert_eq!(r.this_run.longest_stall_ms, 1_500);
        assert_eq!(r.this_run.outbox_peak, 310);
        assert!(r.last_run.is_none());
        // the next run reads what this one left, even though it never ended cleanly
        let next = Health::new(Some(file), "0.1.8", Policy::default());
        let last = next.report().last_run.unwrap();
        assert_eq!(last.recoveries, 1);
        assert_eq!(last.events[1].detail, "crashed");
        assert!(
            doctor_lines(&last)
                .iter()
                .any(|l| l.contains("terminated (crashed)"))
        );
    }

    #[test]
    fn times_read_as_utc_dates() {
        assert_eq!(utc(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(utc(1_795_000_000), "2026-11-18 11:06:40 UTC");
        assert_eq!(utc(951_782_400), "2000-02-29 00:00:00 UTC");
    }

    #[test]
    fn events_are_bounded() {
        let h = Health::new(None, "0", Policy::default());
        for i in 0..(MAX_EVENTS as u64 + 10) {
            h.signal(i * 100_000, Signal::Responsive(false));
            h.signal(i * 100_000 + 1, Signal::Responsive(true));
        }
        assert_eq!(h.report().this_run.events.len(), MAX_EVENTS);
    }

    #[test]
    fn every_reason_has_a_plain_notice_without_the_engine() {
        for w in [
            Why::Crashed,
            Why::OutOfMemory,
            Why::Unresponsive,
            Why::Ended,
        ] {
            let n = w.notice();
            assert!(n.ends_with('.') && n.contains("reloaded"));
        }
    }
}
