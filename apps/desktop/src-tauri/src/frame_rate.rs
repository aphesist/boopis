//! Motion at the display's refresh rate (ADR-0025): lift `WebKit`'s 60 fps preference on a fast display, and say what
//! the frame rate depends on.
//!
//! `WebKit` caps `requestAnimationFrame` and the page's rendering updates near 60 fps on a faster display unless
//! `PreferPageRenderingUpdatesNear60FPS` is off (`docs/research/120hz.md` section 1.1). There is no environment
//! variable for it; the host turns it off through `webkit_settings_set_feature_enabled` (`webkit::set_feature`), on
//! the main window's web view, once the display's rate is known.
//!
//! `HYPOTAXIS_FPS` is the owner's choice: `auto` (the default) lifts the cap when the display is faster than 60 Hz,
//! `60` leaves `WebKit`'s own default, `max` always lifts it. The decision (`decide`) is a pure function of the policy
//! and the rate GDK reports for the window's monitor. The cap is only ever lifted, never put back: with the cap off,
//! a 60 Hz display still gets 60.
//!
//! Two other things halve or cap the rate and are reported beside it: the power profile (`power-saver` is `WebKit`'s
//! "low power mode", which halves `requestAnimationFrame`) and the renderer (the CPU path paints every frame on the
//! main thread).

use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use specta::Type;

use crate::webkit::{self, PREFER_NEAR_60_FPS, Refusal};

/// The variable that sets the policy: `auto` (the default), `60` or `max`.
pub const POLICY_VAR: &str = "HYPOTAXIS_FPS";

/// A display counts as "faster than 60 Hz" above this, in millihertz. GDK reports modes as integer millihertz
/// (`59_940` for 59.94, `60_000` for 60); the margin keeps a 60.01 Hz mode from counting as fast.
pub const FAST_ABOVE_MILLIHERTZ: u32 = 60_500;

/// What the owner asked for with `HYPOTAXIS_FPS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "FpsPolicy")]
pub enum Policy {
    /// Lift the cap when the display is faster than 60 Hz.
    Auto,
    /// Keep `WebKit`'s default (its 60 fps preference stays on).
    Sixty,
    /// Always lift the cap.
    Max,
}

impl Policy {
    /// Parse the variable's value; anything unknown is `auto` (a typo must not change what the owner gets).
    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("60" | "sixty" | "default" | "off") => Self::Sixty,
            Some("max" | "full" | "native" | "on") => Self::Max,
            _ => Self::Auto,
        }
    }

    /// Read `HYPOTAXIS_FPS` from the process environment.
    #[must_use]
    pub fn from_env() -> Self {
        Self::parse(std::env::var(POLICY_VAR).ok().as_deref())
    }
}

/// Why the decision came out as it did (stable names: they go in the log and in the diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "FpsRule")]
pub enum Rule {
    /// `HYPOTAXIS_FPS=60`.
    PolicySixty,
    /// `HYPOTAXIS_FPS=max`.
    PolicyMax,
    /// `auto`, and the display is faster than 60 Hz.
    FasterThanSixty,
    /// `auto`, and the display is 60 Hz or slower: the cap changes nothing.
    NotFasterThanSixty,
    /// `auto`, and the display's rate could not be read: nothing is assumed.
    RateUnknown,
}

/// Whether to turn `WebKit`'s 60 fps preference off, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    /// Turn the preference off.
    pub lift_cap: bool,
    /// The rule that decided.
    pub rule: Rule,
}

/// The decision table. Pure. `refresh_millihertz` is what GDK reports for the window's monitor (none when unknown).
#[must_use]
pub fn decide(policy: Policy, refresh_millihertz: Option<u32>) -> Decision {
    let (lift_cap, rule) = match (policy, refresh_millihertz) {
        (Policy::Sixty, _) => (false, Rule::PolicySixty),
        (Policy::Max, _) => (true, Rule::PolicyMax),
        (Policy::Auto, Some(r)) if r > FAST_ABOVE_MILLIHERTZ => (true, Rule::FasterThanSixty),
        (Policy::Auto, Some(_)) => (false, Rule::NotFasterThanSixty),
        (Policy::Auto, None) => (false, Rule::RateUnknown),
    };
    Decision { lift_cap, rule }
}

/// GDK's refresh rate (integer millihertz, `0` or negative when unknown) as a known rate.
#[must_use]
pub fn known_rate(gdk_millihertz: i32) -> Option<u32> {
    u32::try_from(gdk_millihertz).ok().filter(|r| *r > 0)
}

/// The power profile, as far as the kernel says. `power-saver` is what halves `WebKit`'s rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PowerProfile {
    /// `low-power`: what `power-profiles-daemon` sets for its `power-saver` profile.
    PowerSaver,
    /// `balanced`.
    Balanced,
    /// `performance`.
    Performance,
    /// A profile the firmware names differently (`quiet`, `cool`, `balanced-performance`).
    Other,
    /// No `platform_profile` on this machine, or it could not be read.
    Unknown,
}

/// Where the kernel exposes the ACPI platform profile.
pub const PLATFORM_PROFILE_PATH: &str = "/sys/firmware/acpi/platform_profile";

/// Classify the text of `platform_profile`. `power-profiles-daemon` writes `low-power` for `power-saver`, `balanced`
/// for `balanced` and `performance` for `performance`.
#[must_use]
pub fn power_profile_of(raw: &str) -> PowerProfile {
    match raw.trim() {
        "low-power" => PowerProfile::PowerSaver,
        "balanced" => PowerProfile::Balanced,
        "performance" => PowerProfile::Performance,
        "" => PowerProfile::Unknown,
        _ => PowerProfile::Other,
    }
}

/// What the diagnostics say about the frame rate. Filled from the live window, so it is read at report time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "FrameRateReport")]
pub struct Report {
    /// What `HYPOTAXIS_FPS` asked for.
    pub policy: Policy,
    /// The rule that decided, once a web view has been looked at.
    pub rule: Option<Rule>,
    /// The refresh rate GDK reports for the window's monitor, in millihertz.
    pub refresh_millihertz: Option<u32>,
    /// The monitor's model, as GDK names it.
    pub monitor: Option<String>,
    /// Whether `WebKit`'s 60 fps preference is off now (read back from `WebKit`), when it could be read.
    pub preference_off: Option<bool>,
    /// Why the feature API was not used or did not take.
    pub refusal: Option<Refusal>,
    /// The ACPI platform profile, as `power-profiles-daemon` maps it.
    pub power_profile: PowerProfile,
    /// The raw text of `platform_profile`.
    pub platform_profile: Option<String>,
}

impl Report {
    /// Nothing looked at yet.
    #[must_use]
    pub const fn pending(policy: Policy) -> Self {
        Self {
            policy,
            rule: None,
            refresh_millihertz: None,
            monitor: None,
            preference_off: None,
            refusal: Some(Refusal::NoWebview),
            power_profile: PowerProfile::Unknown,
            platform_profile: None,
        }
    }
}

/// What looking at a web view found: the display, the decision and the outcome of acting on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    /// The refresh rate of the window's monitor.
    pub refresh_millihertz: Option<u32>,
    /// The monitor's model.
    pub monitor: Option<String>,
    /// The rule that decided.
    pub rule: Rule,
    /// Whether the preference is off now.
    pub preference_off: Option<bool>,
    /// Why the API was not used.
    pub refusal: Option<Refusal>,
}

/// Decide for this display and act through `api`. Pure over the trait, so the table and the guards are tested without
/// a window. When the cap is kept, the preference is only read (for the report); when it is lifted it is set, and the
/// answer is what `WebKit` reads back.
pub fn apply<A: webkit::FeatureApi + ?Sized>(
    api: &A,
    policy: Policy,
    refresh_millihertz: Option<u32>,
    monitor: Option<String>,
) -> Applied {
    let d = decide(policy, refresh_millihertz);
    let result = if d.lift_cap {
        webkit::set_feature(api, PREFER_NEAR_60_FPS, false).map(|()| true)
    } else {
        webkit::read_feature(api, PREFER_NEAR_60_FPS).map(|on| !on)
    };
    let (preference_off, refusal) = match result {
        Ok(off) => (Some(off), None),
        Err(Refusal::NotApplied) => (Some(false), Some(Refusal::NotApplied)),
        Err(r) => (None, Some(r)),
    };
    Applied {
        refresh_millihertz,
        monitor,
        rule: d.rule,
        preference_off,
        refusal,
    }
}

/// The host's record of the last look at the window, shared with the window-event hook and the report command.
#[derive(Clone)]
pub struct State(Arc<Inner>);

struct Inner {
    policy: Policy,
    last: Mutex<Option<Applied>>,
}

impl State {
    /// A state with no look yet.
    #[must_use]
    pub fn new(policy: Policy) -> Self {
        Self(Arc::new(Inner {
            policy,
            last: Mutex::new(None),
        }))
    }

    /// The policy in force.
    #[must_use]
    pub fn policy(&self) -> Policy {
        self.0.policy
    }

    fn last(&self) -> Option<Applied> {
        self.0
            .last
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn remember(&self, a: Applied) {
        *self.0.last.lock().unwrap_or_else(PoisonError::into_inner) = Some(a);
    }

    /// The report from the last look and the power profile text (read by the caller, off the executor).
    #[must_use]
    pub fn report(&self, platform_profile: Option<String>) -> Report {
        let power_profile = platform_profile
            .as_deref()
            .map_or(PowerProfile::Unknown, power_profile_of);
        let platform_profile = platform_profile.map(|s| s.trim().to_owned());
        match self.last() {
            Some(a) => Report {
                policy: self.0.policy,
                rule: Some(a.rule),
                refresh_millihertz: a.refresh_millihertz,
                monitor: a.monitor,
                preference_off: a.preference_off,
                refusal: a.refusal,
                power_profile,
                platform_profile,
            },
            None => Report {
                power_profile,
                platform_profile,
                ..Report::pending(self.0.policy)
            },
        }
    }
}

/// Read the platform profile off the async executor. `None` when the file is absent or unreadable.
pub async fn read_platform_profile() -> Option<String> {
    tokio::fs::read_to_string(PLATFORM_PROFILE_PATH)
        .await
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

/// Look at the main window's web view and act on it (Linux only; elsewhere there is nothing to lift). Runs on the main
/// thread through Tauri; the answer arrives on the returned channel. The result is also remembered in `state`.
///
/// A repeat look at a display whose rate has not changed asks `WebKit` nothing, so a window drag that fires many
/// `Moved` events costs one GDK query each.
#[cfg(target_os = "linux")]
#[must_use]
pub fn refresh(
    app: &tauri::AppHandle,
    state: &State,
) -> Option<tokio::sync::oneshot::Receiver<Applied>> {
    use tauri::Manager;
    use webkit2gtk::WebViewExt;

    let window = app.get_webview_window("main")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let state = state.clone();
    window
        .with_webview(move |platform| {
            let view = platform.inner();
            let (refresh, monitor) = gdk_monitor_of(&view);
            if let Some(last) = state.last()
                && last.refresh_millihertz == refresh
                && last.refusal.is_none()
            {
                let _ = tx.send(last);
                return;
            }
            let applied = match WebViewExt::settings(&view) {
                Some(settings) => apply(
                    &webkit::native::Live::for_settings(&settings),
                    state.policy(),
                    refresh,
                    monitor,
                ),
                None => Applied {
                    refresh_millihertz: refresh,
                    monitor,
                    rule: decide(state.policy(), refresh).rule,
                    preference_off: None,
                    refusal: Some(Refusal::NoWebview),
                },
            };
            tracing::info!(
                policy = ?state.policy(),
                rule = ?applied.rule,
                refresh_millihertz = ?applied.refresh_millihertz,
                monitor = ?applied.monitor,
                preference_off = ?applied.preference_off,
                refusal = ?applied.refusal,
                "frame rate"
            );
            state.remember(applied.clone());
            let _ = tx.send(applied);
        })
        .ok()?;
    Some(rx)
}

/// No `WebKitGTK` here: there is no preference to lift.
#[cfg(not(target_os = "linux"))]
#[must_use]
pub fn refresh(
    _app: &tauri::AppHandle,
    _state: &State,
) -> Option<tokio::sync::oneshot::Receiver<Applied>> {
    None
}

/// The refresh rate and model of the monitor the web view is on, from GDK. The window's own monitor when it is mapped,
/// else the primary one, else the first. Safe wrappers only.
#[cfg(target_os = "linux")]
fn gdk_monitor_of(view: &webkit2gtk::WebView) -> (Option<u32>, Option<String>) {
    use gtk::gdk::prelude::MonitorExt;
    use gtk::prelude::WidgetExt;

    let display = view.display();
    let monitor = view
        .window()
        .and_then(|w| display.monitor_at_window(&w))
        .or_else(|| display.primary_monitor())
        .or_else(|| display.monitor(0));
    match monitor {
        Some(m) => (
            known_rate(m.refresh_rate()),
            m.model().map(|s| s.to_string()),
        ),
        None => (None, None),
    }
}

/// The frame rate part of the report for the current window: look again (so a moved window or a changed mode is seen),
/// wait briefly for the main thread, and read the power profile.
pub async fn current(app: &tauri::AppHandle, state: &State) -> Report {
    if let Some(rx) = refresh(app, state) {
        // The main thread may be busy; the last look is a good enough answer after this long.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
    }
    state.report(read_platform_profile().await)
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;
    use crate::webkit::{FeatureApi, Version};

    #[test]
    fn the_policy_parses_and_a_typo_changes_nothing() {
        assert_eq!(Policy::parse(None), Policy::Auto);
        assert_eq!(Policy::parse(Some("")), Policy::Auto);
        assert_eq!(Policy::parse(Some("auto")), Policy::Auto);
        assert_eq!(Policy::parse(Some("mxa")), Policy::Auto);
        assert_eq!(Policy::parse(Some(" 60 ")), Policy::Sixty);
        assert_eq!(Policy::parse(Some("MAX")), Policy::Max);
        assert_eq!(Policy::parse(Some("max")), Policy::Max);
    }

    /// One row per case: (policy, GDK rate in millihertz) -> (cap lifted, rule).
    #[test]
    fn the_decision_table() {
        let rows: &[(Policy, Option<u32>, bool, Rule)] = &[
            // auto: only a display faster than 60 Hz lifts the cap.
            (Policy::Auto, Some(120_000), true, Rule::FasterThanSixty),
            (Policy::Auto, Some(119_880), true, Rule::FasterThanSixty),
            (Policy::Auto, Some(144_000), true, Rule::FasterThanSixty),
            (Policy::Auto, Some(75_000), true, Rule::FasterThanSixty),
            (Policy::Auto, Some(60_500), false, Rule::NotFasterThanSixty),
            (Policy::Auto, Some(60_501), true, Rule::FasterThanSixty),
            (Policy::Auto, Some(60_011), false, Rule::NotFasterThanSixty),
            (Policy::Auto, Some(60_000), false, Rule::NotFasterThanSixty),
            (Policy::Auto, Some(59_940), false, Rule::NotFasterThanSixty),
            (Policy::Auto, Some(30_000), false, Rule::NotFasterThanSixty),
            // auto with no rate: nothing is assumed.
            (Policy::Auto, None, false, Rule::RateUnknown),
            // 60 keeps WebKit's default whatever the display says.
            (Policy::Sixty, Some(240_000), false, Rule::PolicySixty),
            (Policy::Sixty, Some(60_000), false, Rule::PolicySixty),
            (Policy::Sixty, None, false, Rule::PolicySixty),
            // max always lifts it, even on a display that is not faster or not known.
            (Policy::Max, Some(120_000), true, Rule::PolicyMax),
            (Policy::Max, Some(60_000), true, Rule::PolicyMax),
            (Policy::Max, None, true, Rule::PolicyMax),
        ];
        for (policy, rate, lift, rule) in rows {
            assert_eq!(
                decide(*policy, *rate),
                Decision {
                    lift_cap: *lift,
                    rule: *rule
                },
                "{policy:?} {rate:?}"
            );
        }
    }

    #[test]
    fn gdk_rates_become_known_rates() {
        assert_eq!(known_rate(120_000), Some(120_000));
        assert_eq!(known_rate(0), None);
        assert_eq!(known_rate(-1), None);
    }

    #[test]
    fn the_power_profile_is_read_the_way_power_profiles_daemon_writes_it() {
        assert_eq!(power_profile_of("low-power\n"), PowerProfile::PowerSaver);
        assert_eq!(power_profile_of("balanced"), PowerProfile::Balanced);
        assert_eq!(power_profile_of("performance\n"), PowerProfile::Performance);
        assert_eq!(power_profile_of("quiet"), PowerProfile::Other);
        assert_eq!(
            power_profile_of("balanced-performance"),
            PowerProfile::Other
        );
        assert_eq!(power_profile_of(""), PowerProfile::Unknown);
        assert_eq!(power_profile_of("  \n"), PowerProfile::Unknown);
    }

    struct Script {
        version: Option<Version>,
        symbols: bool,
        preference_on: RefCell<Option<bool>>,
        sets: Cell<u32>,
    }

    impl Script {
        fn new(version: Option<Version>, symbols: bool, on: Option<bool>) -> Self {
            Self {
                version,
                symbols,
                preference_on: RefCell::new(on),
                sets: Cell::new(0),
            }
        }
        fn current() -> Self {
            Self::new(Some(Version::new(2, 54, 2)), true, Some(true))
        }
    }

    impl FeatureApi for Script {
        fn version(&self) -> Option<Version> {
            self.version
        }
        fn symbols_present(&self) -> bool {
            self.symbols
        }
        fn feature_enabled(&self, id: &str) -> Option<bool> {
            assert_eq!(id, PREFER_NEAR_60_FPS, "only this feature is asked about");
            *self.preference_on.borrow()
        }
        fn set_feature_enabled(&self, id: &str, enabled: bool) -> bool {
            assert_eq!(id, PREFER_NEAR_60_FPS);
            self.sets.set(self.sets.get() + 1);
            let mut on = self.preference_on.borrow_mut();
            if on.is_some() {
                *on = Some(enabled);
            }
            on.is_some()
        }
    }

    #[test]
    fn a_fast_display_turns_the_preference_off() {
        let api = Script::current();
        let a = apply(&api, Policy::Auto, Some(120_000), Some("eDP".into()));
        assert_eq!(a.rule, Rule::FasterThanSixty);
        assert_eq!(a.preference_off, Some(true));
        assert_eq!(a.refusal, None);
        assert_eq!(a.refresh_millihertz, Some(120_000));
        assert_eq!(a.monitor.as_deref(), Some("eDP"));
        assert_eq!(api.sets.get(), 1);
    }

    #[test]
    fn a_slow_display_or_the_60_setting_leaves_the_default_and_only_reads_it() {
        for (policy, rate) in [
            (Policy::Auto, Some(60_000)),
            (Policy::Auto, None),
            (Policy::Sixty, Some(120_000)),
        ] {
            let api = Script::current();
            let a = apply(&api, policy, rate, None);
            assert_eq!(api.sets.get(), 0, "{policy:?} {rate:?}");
            assert_eq!(a.preference_off, Some(false));
            assert_eq!(a.refusal, None);
        }
    }

    #[test]
    fn max_lifts_the_cap_on_any_display() {
        let api = Script::current();
        let a = apply(&api, Policy::Max, Some(60_000), None);
        assert_eq!((a.rule, a.preference_off), (Rule::PolicyMax, Some(true)));
    }

    #[test]
    fn an_old_or_incomplete_webkit_is_refused_and_said_so() {
        let old = Script::new(Some(Version::new(2, 40, 0)), true, Some(true));
        let a = apply(&old, Policy::Auto, Some(120_000), None);
        assert_eq!((a.preference_off, a.refusal), (None, Some(Refusal::TooOld)));
        assert_eq!(old.sets.get(), 0);

        let bare = Script::new(Some(Version::new(2, 54, 2)), false, Some(true));
        let a = apply(&bare, Policy::Max, None, None);
        assert_eq!(a.refusal, Some(Refusal::SymbolsMissing));
        assert_eq!(bare.sets.get(), 0);

        let no_feature = Script::new(Some(Version::new(2, 54, 2)), true, None);
        let a = apply(&no_feature, Policy::Auto, Some(120_000), None);
        assert_eq!(a.refusal, Some(Refusal::NoSuchFeature));
        assert_eq!(no_feature.sets.get(), 0);

        let unknown = Script::new(None, true, Some(true));
        let a = apply(&unknown, Policy::Auto, Some(120_000), None);
        assert_eq!(a.refusal, Some(Refusal::VersionUnknown));
        // The rule still says what would have been decided.
        assert_eq!(a.rule, Rule::FasterThanSixty);
    }

    #[test]
    fn the_report_before_any_look_says_there_is_no_webview() {
        let s = State::new(Policy::Auto);
        let r = s.report(Some("balanced\n".into()));
        assert_eq!(r.rule, None);
        assert_eq!(r.refusal, Some(Refusal::NoWebview));
        assert_eq!(r.power_profile, PowerProfile::Balanced);
        assert_eq!(r.platform_profile.as_deref(), Some("balanced"));
        assert_eq!(s.report(None).power_profile, PowerProfile::Unknown);
    }

    #[test]
    fn the_report_carries_the_last_look() {
        let s = State::new(Policy::Max);
        s.remember(apply(
            &Script::current(),
            Policy::Max,
            Some(120_000),
            Some("eDP".into()),
        ));
        let r = s.report(Some("low-power".into()));
        assert_eq!(r.policy, Policy::Max);
        assert_eq!(r.rule, Some(Rule::PolicyMax));
        assert_eq!(r.preference_off, Some(true));
        assert_eq!(r.refresh_millihertz, Some(120_000));
        assert_eq!(r.power_profile, PowerProfile::PowerSaver);
    }
}
