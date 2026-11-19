//! Which `WebKitGTK` renderer the webview gets (ADR-0024), decided before the webview exists.
//!
//! `WebKitGTK` reads its renderer switches from the environment of the process that creates the web view, so the choice
//! has to be made at the top of `run()`, before Tauri or any thread starts. Three facts shape the policy:
//!
//! - A workaround is never a speed-up, and the two that sound alike are very different. In `WebKitGTK` 2.44 to 2.52,
//!   `WEBKIT_DISABLE_DMABUF_RENDERER=1` empties the buffer transport, so the acceleration policy becomes `never`: no
//!   GL context, every frame painted on the CPU into a bitmap (checked on 2.52.6 with `webkit://gpu`: policy `never`
//!   and no render-process GL section). `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` skips only the `DMABUF` transport: GL
//!   compositing and GPU rasterisation stay, and each frame is copied to shared memory (policy `always`, renderer
//!   "`DMABuf` (Supported buffers: Shared Memory)"). `WEBKIT_DISABLE_COMPOSITING_MODE=1` turns accelerated compositing
//!   off too. All three cure a blank window or a crash; only `FORCE_SHM` keeps the GPU.
//! - The failures that need them are specific: the NVIDIA proprietary driver with an X11 session shows a blank window
//!   (`WebKit` bugs 259644 and 261874; Ubuntu still ships a patch that forces the shared-memory transport for NVIDIA in
//!   2.52.6), and NVIDIA on Wayland can die with `Error 71` (cured by `__NV_DISABLE_EXPLICIT_SYNC=1`, or by the
//!   `DMABUF` switch). A machine that starts and draws is left alone.
//! - The `WebKitGTK` version matters on Wayland with NVIDIA: the GTK 3 explicit-sync crash is fixed upstream in 2.54.2
//!   (`WebKit` bug 324551), so from there the machine gets the default GL renderer and no workaround is set (ADR-0025).
//!   The version is read from the library at run time (`webkit::probe`), not from what the build linked.
//! - The host cannot see a blank window from inside. So the automatic rule touches only the case where the evidence
//!   says the default is broken, and everything else is an explicit choice (`BOOPIS_RENDERER`) that the
//!   diagnostics report and the owner can try. A machine that already runs with a switch of its own is not touched.
//!
//! The decision is a pure function of its inputs (`decide`), the inputs are read by `probe`, and `apply` is the one
//! place that touches the environment.

use std::fs;
use std::path::Path;

use serde::Serialize;
use specta::Type;

use crate::frame_rate;
use crate::gpu;
use crate::webkit;

/// The variable that overrides the automatic rule: `auto` (the default), `default`, `shm`, `cpu`, `nosync` or `software`.
pub const POLICY_VAR: &str = "BOOPIS_RENDERER";

/// Switches the user may already have set. If any is present the host changes nothing: the user's choice stands.
pub const USER_SWITCHES: &[&str] = &[
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_FORCE_COMPOSITING_MODE",
    "__NV_DISABLE_EXPLICIT_SYNC",
];

const NVIDIA_PCI_VENDOR: u32 = 0x10de;

/// What the user asked for with `BOOPIS_RENDERER`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Policy {
    /// The host's evidence-based rule.
    Auto,
    /// Touch nothing: `WebKitGTK`'s own choice.
    Default,
    /// `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`: no `DMABUF`, frames copied through shared memory; GL compositing and GPU
    /// rasterisation stay.
    Shm,
    /// `WEBKIT_DISABLE_DMABUF_RENDERER=1`: no `DMABUF` and, in `WebKitGTK` 2.44 to 2.52, no GL either: CPU painting.
    Cpu,
    /// `__NV_DISABLE_EXPLICIT_SYNC=1`: the Wayland `Error 71` cure, keeps the `DMABUF` path.
    Nosync,
    /// `WEBKIT_DISABLE_COMPOSITING_MODE=1`: no accelerated compositing at all (the last resort).
    Software,
}

impl Policy {
    /// Parse the variable's value; anything unknown is `auto` (a typo must not switch acceleration off).
    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("default" | "none" | "off") => Self::Default,
            Some("shm") => Self::Shm,
            Some("cpu" | "dmabuf-off") => Self::Cpu,
            Some("nosync" | "no-explicit-sync") => Self::Nosync,
            Some("software" | "nocompositing") => Self::Software,
            _ => Self::Auto,
        }
    }
}

/// The session the webview will draw into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Session {
    /// A Wayland compositor.
    Wayland,
    /// An X11 server.
    X11,
    /// Neither could be told.
    Unknown,
}

/// One graphics device, as `/sys/class/drm` reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Gpu {
    /// The sysfs card name (`card0`).
    pub card: String,
    /// PCI vendor id (`0x10de` is NVIDIA, `0x8086` Intel, `0x1002` AMD).
    pub vendor: String,
    /// The kernel driver bound to it (`nvidia`, `nouveau`, `i915`, `xe`, `amdgpu`), when there is one.
    pub driver: Option<String>,
    /// Whether the firmware booted with this one as the display device (`boot_vga`). On a hybrid laptop this is
    /// usually the integrated GPU, with the NVIDIA one a secondary.
    pub boot_display: bool,
}

impl Gpu {
    pub(crate) fn is_nvidia_proprietary(&self) -> bool {
        parse_hex(&self.vendor) == Some(NVIDIA_PCI_VENDOR)
            && self.driver.as_deref() == Some("nvidia")
    }
}

/// What `decide` reads.
#[derive(Debug, Clone)]
pub struct Inputs {
    /// Every GPU found.
    pub gpus: Vec<Gpu>,
    /// The session type.
    pub session: Session,
    /// The compositor is Hyprland (reported only; no rule depends on it).
    pub hyprland: bool,
    /// What `BOOPIS_RENDERER` says.
    pub policy: Policy,
    /// Which of `USER_SWITCHES` are already in the environment.
    pub user_switches: Vec<String>,
    /// The `WebKitGTK` this process runs on (its version decides the Wayland and NVIDIA rule).
    pub webkit: webkit::Info,
    /// The GPU rule (`gpu.rs`, `BOOPIS_GPU`) offloads rendering to the NVIDIA GPU: that GPU, not the display one, is
    /// what the webview draws on, so the rules below judge it.
    pub offload: bool,
}

/// Why the decision came out as it did (stable names: they go in the log and in the diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Rule {
    /// A `WebKit` or NVIDIA switch was already in the environment; nothing is changed.
    UserEnvironment,
    /// `BOOPIS_RENDERER=default`.
    PolicyDefault,
    /// `BOOPIS_RENDERER=shm`.
    PolicyShm,
    /// `BOOPIS_RENDERER=cpu`.
    PolicyCpu,
    /// `BOOPIS_RENDERER=nosync`.
    PolicyNosync,
    /// `BOOPIS_RENDERER=software`.
    PolicySoftware,
    /// The display GPU is not on the NVIDIA proprietary driver: `WebKitGTK`'s own choice is known to work.
    NoNvidiaProprietary,
    /// NVIDIA proprietary driver on X11: the `DMABUF` renderer shows a blank window; the shared-memory transport keeps
    /// the GPU.
    NvidiaX11,
    /// NVIDIA proprietary driver on Wayland, `WebKitGTK` before 2.54.2 or of an unknown version: left alone (it starts
    /// and draws for most; the switches that cure a crash or a blank window are one variable away and the diagnostics
    /// name them).
    NvidiaWaylandUntouched,
    /// NVIDIA proprietary driver on Wayland, `WebKitGTK` 2.54.2 or later: the GTK 3 explicit-sync crash is fixed
    /// upstream (`WebKit` bug 324551), so the default GL renderer is what this machine gets and no workaround is set.
    NvidiaWaylandFixed,
    /// The session type could not be told: nothing is assumed.
    SessionUnknown,
}

/// The outcome: the environment to set, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Decision {
    /// Variables to set, in order (none when `WebKitGTK`'s own choice stands).
    pub set: Vec<(String, String)>,
    /// The rule that decided.
    pub rule: Rule,
}

/// The decision table. Pure: the same inputs always give the same answer.
#[must_use]
pub fn decide(i: &Inputs) -> Decision {
    let none = |rule| Decision { set: vec![], rule };
    let one = |k: &str, rule| Decision {
        set: vec![(k.to_owned(), "1".to_owned())],
        rule,
    };
    if !i.user_switches.is_empty() {
        return none(Rule::UserEnvironment);
    }
    match i.policy {
        Policy::Default => return none(Rule::PolicyDefault),
        Policy::Shm => return one("WEBKIT_DMABUF_RENDERER_FORCE_SHM", Rule::PolicyShm),
        Policy::Cpu => return one("WEBKIT_DISABLE_DMABUF_RENDERER", Rule::PolicyCpu),
        Policy::Nosync => return one("__NV_DISABLE_EXPLICIT_SYNC", Rule::PolicyNosync),
        Policy::Software => return one("WEBKIT_DISABLE_COMPOSITING_MODE", Rule::PolicySoftware),
        Policy::Auto => {}
    }
    // The display device decides; a second GPU that only computes is not what the webview draws on, unless the GPU rule
    // moved the rendering there. With no device flagged, the first one stands.
    let primary = if i.offload {
        i.gpus.iter().find(|g| g.is_nvidia_proprietary())
    } else {
        None
    }
    .or_else(|| i.gpus.iter().find(|g| g.boot_display))
    .or_else(|| i.gpus.first());
    if !primary.is_some_and(Gpu::is_nvidia_proprietary) {
        return none(Rule::NoNvidiaProprietary);
    }
    match i.session {
        Session::X11 => one("WEBKIT_DMABUF_RENDERER_FORCE_SHM", Rule::NvidiaX11),
        Session::Wayland if i.webkit.has_explicit_sync_fix() => none(Rule::NvidiaWaylandFixed),
        Session::Wayland => none(Rule::NvidiaWaylandUntouched),
        Session::Unknown => none(Rule::SessionUnknown),
    }
}

fn parse_hex(s: &str) -> Option<u32> {
    u32::from_str_radix(s.trim().trim_start_matches("0x"), 16).ok()
}

/// Read the GPUs from a `/sys/class/drm`-shaped directory (a parameter so a test can build one).
#[must_use]
pub fn read_gpus(drm: &Path) -> Vec<Gpu> {
    let Ok(entries) = fs::read_dir(drm) else {
        return vec![];
    };
    let mut gpus: Vec<Gpu> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            // `card0`, `card1`; not `card0-DP-1` (a connector) and not `renderD128`.
            if !name
                .strip_prefix("card")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            {
                return None;
            }
            let dev = e.path().join("device");
            let vendor = fs::read_to_string(dev.join("vendor"))
                .ok()?
                .trim()
                .to_owned();
            let driver = fs::read_link(dev.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
            let boot_display =
                fs::read_to_string(dev.join("boot_vga")).is_ok_and(|s| s.trim() == "1");
            Some(Gpu {
                card: name,
                vendor,
                driver,
                boot_display,
            })
        })
        .collect();
    gpus.sort_by(|a, b| a.card.cmp(&b.card));
    gpus
}

/// The session from the environment values, in the order GTK itself would trust them.
#[must_use]
pub fn session_of(
    gdk_backend: Option<&str>,
    xdg_session_type: Option<&str>,
    wayland_display: bool,
    display: bool,
) -> Session {
    if let Some(b) = gdk_backend
        && let Some(first) = b
            .split(',')
            .map(str::trim)
            .find(|t| matches!(*t, "wayland" | "x11"))
    {
        return if first == "wayland" {
            Session::Wayland
        } else {
            Session::X11
        };
    }
    match xdg_session_type.map(str::to_ascii_lowercase).as_deref() {
        Some("wayland") => return Session::Wayland,
        Some("x11") => return Session::X11,
        _ => {}
    }
    if wayland_display {
        Session::Wayland
    } else if display {
        Session::X11
    } else {
        Session::Unknown
    }
}

/// Read the inputs from this machine and this process's environment.
#[must_use]
pub fn probe() -> Inputs {
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let desktop = var("XDG_CURRENT_DESKTOP")
        .or_else(|| var("XDG_SESSION_DESKTOP"))
        .unwrap_or_default();
    Inputs {
        gpus: read_gpus(Path::new("/sys/class/drm")),
        session: session_of(
            var("GDK_BACKEND").as_deref(),
            var("XDG_SESSION_TYPE").as_deref(),
            var("WAYLAND_DISPLAY").is_some(),
            var("DISPLAY").is_some(),
        ),
        hyprland: desktop.to_ascii_lowercase().contains("hyprland")
            || var("HYPRLAND_INSTANCE_SIGNATURE").is_some(),
        policy: Policy::parse(var(POLICY_VAR).as_deref()),
        user_switches: USER_SWITCHES
            .iter()
            .filter(|k| std::env::var_os(k).is_some())
            .map(|k| (*k).to_owned())
            .collect(),
        webkit: webkit::probe(),
        offload: false,
    }
}

/// Set the decided variables. Call it first thing in `run()`, before any thread exists: changing the environment of a
/// running multi-threaded process is not sound, and `WebKitGTK` reads these when the web view is created.
#[allow(unsafe_code)]
pub fn apply(d: &Decision) {
    for (k, v) in &d.set {
        // SAFETY: called from `run()` before Tauri, tokio or the logger start a thread, so nothing can read the
        // environment concurrently. The only other `set_var` is `gpu::apply`, under the same rule.
        unsafe { std::env::set_var(k, v) };
    }
}

/// Everything the diagnostics show: what was found, what was decided and what the web process will see.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RendererReport {
    /// The session type.
    pub session: Session,
    /// The compositor is Hyprland.
    pub hyprland: bool,
    /// The GPUs, with the driver bound to each.
    pub gpus: Vec<Gpu>,
    /// What `BOOPIS_RENDERER` asked for.
    pub policy: Policy,
    /// The rule that decided.
    pub rule: Rule,
    /// The variables the host set.
    pub set: Vec<(String, String)>,
    /// Every renderer-related variable in the process environment now (set by the host or by the user).
    pub environment: Vec<(String, String)>,
    /// `BOOPIS_RENDERER` values and the variables each sets, for the report's reader.
    pub choices: Vec<(String, String)>,
    /// The `WebKitGTK` this process runs on: its version and whether it is the `AppImage`'s or the system's.
    pub webkit: webkit::Report,
    /// The frame rate: the display's rate, whether `WebKit`'s 60 fps preference is off, the power profile. Read from the
    /// live window when the report is asked for.
    pub frame_rate: frame_rate::Report,
    /// One plain sentence when the renderer in use limits motion, else none.
    pub note: Option<String>,
    /// Which GPU the webview renders on (`BOOPIS_GPU`), and why. The power source and the restart advice are read
    /// when the report is asked for.
    pub gpu: gpu::Report,
    /// The engine's own words behind the errors the UI showed as boopis sentences this run (ADR-0031), oldest first.
    /// Filled when the report is asked for; Diagnostics is the one place they are shown.
    pub errors: Vec<crate::error::RecentError>,
}

/// The switches that make `WebKitGTK` paint on the CPU (no accelerated compositing, so no compositor-thread animation).
const CPU_PAINT_SWITCHES: &[&str] = &[
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
];

/// A sentence for the diagnostics when the renderer limits motion (ADR-0025): the CPU path paints every frame on the
/// main thread, so the display's full rate is not a realistic target, and a smooth 60 is. `None` otherwise.
#[must_use]
pub fn note(inputs: &Inputs, decision: &Decision) -> Option<String> {
    let cpu = inputs
        .user_switches
        .iter()
        .chain(decision.set.iter().map(|(k, _)| k))
        .find(|k| CPU_PAINT_SWITCHES.contains(&k.as_str()))?;
    let extra = if inputs.webkit.has_explicit_sync_fix() {
        " This WebKitGTK has the explicit-sync fix for NVIDIA on Wayland, so the switch is probably not needed: unset it and try again."
    } else {
        ""
    };
    Some(format!(
        "{cpu} is set, so WebKitGTK paints every frame on the CPU: motion is steady at 60 fps at best, never the display's full rate.{extra}"
    ))
}

/// The variables worth reporting: the renderer switches, the session and the GPU selection.
const REPORTED: &[&str] = &[
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_DMABUF_RENDERER_DISABLE_GBM",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_FORCE_COMPOSITING_MODE",
    "WEBKIT_SHOW_FPS",
    "__NV_DISABLE_EXPLICIT_SYNC",
    "__NV_PRIME_RENDER_OFFLOAD",
    "__GLX_VENDOR_LIBRARY_NAME",
    "__EGL_VENDOR_LIBRARY_FILENAMES",
    "LIBGL_ALWAYS_SOFTWARE",
    "GDK_BACKEND",
    "GDK_SCALE",
    "GDK_DPI_SCALE",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "AQ_DRM_DEVICES",
    POLICY_VAR,
];

/// The report for `inputs` and `decision`, reading the live environment for the variables that are set.
#[must_use]
pub fn report(inputs: &Inputs, decision: &Decision, gpu: gpu::Report) -> RendererReport {
    RendererReport {
        session: inputs.session,
        hyprland: inputs.hyprland,
        gpus: inputs.gpus.clone(),
        policy: inputs.policy,
        rule: decision.rule,
        set: decision.set.clone(),
        environment: REPORTED
            .iter()
            .filter_map(|k| std::env::var(k).ok().map(|v| ((*k).to_owned(), v)))
            .collect(),
        webkit: inputs.webkit.report(),
        frame_rate: frame_rate::Report::pending(frame_rate::Policy::from_env()),
        note: note(inputs, decision),
        gpu,
        errors: Vec::new(),
        choices: [
            ("default", "nothing: WebKitGTK's own choice"),
            (
                "shm",
                "WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 (GPU kept, frames copied through memory)",
            ),
            (
                "cpu",
                "WEBKIT_DISABLE_DMABUF_RENDERER=1 (no GL: the CPU paints every frame)",
            ),
            ("nosync", "__NV_DISABLE_EXPLICIT_SYNC=1"),
            ("software", "WEBKIT_DISABLE_COMPOSITING_MODE=1"),
        ]
        .iter()
        .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
        .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(card: &str, vendor: &str, driver: Option<&str>, boot: bool) -> Gpu {
        Gpu {
            card: card.into(),
            vendor: vendor.into(),
            driver: driver.map(Into::into),
            boot_display: boot,
        }
    }
    fn nvidia(boot: bool) -> Gpu {
        gpu("card1", "0x10de", Some("nvidia"), boot)
    }
    fn intel(boot: bool) -> Gpu {
        gpu("card0", "0x8086", Some("i915"), boot)
    }
    fn inputs(gpus: Vec<Gpu>, session: Session) -> Inputs {
        Inputs {
            gpus,
            session,
            hyprland: false,
            policy: Policy::Auto,
            user_switches: vec![],
            webkit: webkit::Info::unknown(),
            offload: false,
        }
    }
    fn webkit_at(major: u32, minor: u32, micro: u32) -> webkit::Info {
        webkit::Info {
            version: Some(webkit::Version::new(major, minor, micro)),
            origin: webkit::Origin::System,
            library: None,
        }
    }
    fn set_of(d: &Decision) -> Vec<&str> {
        d.set.iter().map(|(k, _)| k.as_str()).collect()
    }

    /// The decision table, one row per line: (gpus, session, policy, user switches) -> (variables set, rule).
    #[test]
    #[allow(clippy::too_many_lines)] // one row per case reads best as one table
    fn the_decision_table() {
        type Row = (
            Vec<Gpu>,
            Session,
            Policy,
            Vec<&'static str>,
            Vec<&'static str>,
            Rule,
        );
        let rows: Vec<Row> = vec![
            // WebKitGTK's own choice for everything that is not known to be broken.
            (
                vec![intel(true)],
                Session::Wayland,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            (
                vec![intel(true)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            (
                vec![gpu("card0", "0x1002", Some("amdgpu"), true)],
                Session::Wayland,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            (
                vec![],
                Session::Wayland,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            // Nouveau is not the proprietary driver.
            (
                vec![gpu("card0", "0x10de", Some("nouveau"), true)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            // A hybrid laptop whose display is the integrated GPU: the NVIDIA one only computes.
            (
                vec![intel(true), nvidia(false)],
                Session::Wayland,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            (
                vec![intel(true), nvidia(false)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NoNvidiaProprietary,
            ),
            // NVIDIA proprietary on the display: X11 is the known blank window; Wayland is left alone.
            (
                vec![nvidia(true)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"],
                Rule::NvidiaX11,
            ),
            (
                vec![intel(false), nvidia(true)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"],
                Rule::NvidiaX11,
            ),
            (
                vec![nvidia(true)],
                Session::Wayland,
                Policy::Auto,
                vec![],
                vec![],
                Rule::NvidiaWaylandUntouched,
            ),
            (
                vec![nvidia(true)],
                Session::Unknown,
                Policy::Auto,
                vec![],
                vec![],
                Rule::SessionUnknown,
            ),
            // No device flagged: the first one stands.
            (
                vec![nvidia(false)],
                Session::X11,
                Policy::Auto,
                vec![],
                vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"],
                Rule::NvidiaX11,
            ),
            // The owner's explicit choices apply on any machine.
            (
                vec![intel(true)],
                Session::Wayland,
                Policy::Shm,
                vec![],
                vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"],
                Rule::PolicyShm,
            ),
            (
                vec![nvidia(true)],
                Session::Wayland,
                Policy::Cpu,
                vec![],
                vec!["WEBKIT_DISABLE_DMABUF_RENDERER"],
                Rule::PolicyCpu,
            ),
            (
                vec![nvidia(true)],
                Session::Wayland,
                Policy::Nosync,
                vec![],
                vec!["__NV_DISABLE_EXPLICIT_SYNC"],
                Rule::PolicyNosync,
            ),
            (
                vec![nvidia(true)],
                Session::Wayland,
                Policy::Software,
                vec![],
                vec!["WEBKIT_DISABLE_COMPOSITING_MODE"],
                Rule::PolicySoftware,
            ),
            (
                vec![nvidia(true)],
                Session::X11,
                Policy::Default,
                vec![],
                vec![],
                Rule::PolicyDefault,
            ),
            // A switch already in the environment wins over everything, the policy included.
            (
                vec![nvidia(true)],
                Session::X11,
                Policy::Auto,
                vec!["WEBKIT_DISABLE_COMPOSITING_MODE"],
                vec![],
                Rule::UserEnvironment,
            ),
            // The owner's launch: WEBKIT_DISABLE_DMABUF_RENDERER=1 already set, on a hybrid NVIDIA laptop under Hyprland.
            (
                vec![intel(true), nvidia(false)],
                Session::Wayland,
                Policy::Auto,
                vec!["WEBKIT_DISABLE_DMABUF_RENDERER"],
                vec![],
                Rule::UserEnvironment,
            ),
            (
                vec![nvidia(true)],
                Session::Wayland,
                Policy::Software,
                vec!["__NV_DISABLE_EXPLICIT_SYNC"],
                vec![],
                Rule::UserEnvironment,
            ),
        ];
        for (gpus, session, policy, user, want_set, want_rule) in rows {
            let mut i = inputs(gpus.clone(), session);
            i.policy = policy;
            i.user_switches = user.iter().map(|s| (*s).to_owned()).collect();
            let d = decide(&i);
            assert_eq!(
                (set_of(&d), d.rule),
                (want_set, want_rule),
                "{gpus:?} {session:?} {policy:?} {user:?}"
            );
            assert!(d.set.iter().all(|(_, v)| v == "1"));
        }
    }

    #[test]
    fn a_typo_in_the_policy_never_switches_acceleration_off() {
        assert_eq!(Policy::parse(None), Policy::Auto);
        assert_eq!(Policy::parse(Some("")), Policy::Auto);
        assert_eq!(Policy::parse(Some("sofware")), Policy::Auto);
        assert_eq!(Policy::parse(Some(" SHM ")), Policy::Shm);
        assert_eq!(Policy::parse(Some("cpu")), Policy::Cpu);
        assert_eq!(Policy::parse(Some("Software")), Policy::Software);
        assert_eq!(Policy::parse(Some("nosync")), Policy::Nosync);
        assert_eq!(Policy::parse(Some("default")), Policy::Default);
    }

    #[test]
    fn the_session_follows_gtks_own_order() {
        assert_eq!(
            session_of(Some("x11,wayland"), Some("wayland"), true, true),
            Session::X11
        );
        assert_eq!(
            session_of(Some("wayland,x11"), None, false, true),
            Session::Wayland
        );
        assert_eq!(
            session_of(Some("broadway"), Some("wayland"), false, false),
            Session::Wayland
        );
        assert_eq!(session_of(None, Some("X11"), true, true), Session::X11);
        assert_eq!(session_of(None, Some("tty"), true, true), Session::Wayland);
        assert_eq!(session_of(None, None, false, true), Session::X11);
        assert_eq!(session_of(None, None, false, false), Session::Unknown);
    }

    #[cfg(unix)]
    #[test]
    fn the_gpus_are_read_from_a_drm_directory() {
        let t = tempfile::tempdir().unwrap_or_else(|e| panic!("{e}"));
        let mk = |card: &str, vendor: &str, driver: Option<&str>, boot: Option<&str>| {
            let dev = t.path().join(card).join("device");
            fs::create_dir_all(&dev).unwrap_or_else(|e| panic!("{e}"));
            fs::write(dev.join("vendor"), format!("{vendor}\n")).unwrap_or_else(|e| panic!("{e}"));
            if let Some(b) = boot {
                fs::write(dev.join("boot_vga"), format!("{b}\n")).unwrap_or_else(|e| panic!("{e}"));
            }
            if let Some(d) = driver {
                let target = t.path().join("drivers").join(d);
                fs::create_dir_all(&target).unwrap_or_else(|e| panic!("{e}"));
                std::os::unix::fs::symlink(&target, dev.join("driver"))
                    .unwrap_or_else(|e| panic!("{e}"));
            }
        };
        mk("card0", "0x8086", Some("i915"), Some("1"));
        mk("card1", "0x10de", Some("nvidia"), Some("0"));
        fs::create_dir_all(t.path().join("card0-eDP-1")).unwrap_or_else(|e| panic!("{e}"));
        fs::create_dir_all(t.path().join("renderD128")).unwrap_or_else(|e| panic!("{e}"));
        let gpus = read_gpus(t.path());
        assert_eq!(
            gpus,
            vec![
                gpu("card0", "0x8086", Some("i915"), true),
                gpu("card1", "0x10de", Some("nvidia"), false)
            ]
        );
        let hybrid = Inputs {
            gpus,
            session: Session::Wayland,
            hyprland: true,
            policy: Policy::Auto,
            user_switches: vec![],
            webkit: webkit::Info::unknown(),
            offload: false,
        };
        assert_eq!(decide(&hybrid).rule, Rule::NoNvidiaProprietary);
        assert!(read_gpus(&t.path().join("missing")).is_empty());
    }

    /// The Wayland and NVIDIA rule by `WebKitGTK` version: the fix is in from 2.54.2, and an unknown version is not
    /// assumed to have it. Either way nothing is set, and a user's switch still wins.
    #[test]
    fn the_version_decides_the_wayland_nvidia_rule() {
        type Ver = Option<(u32, u32, u32)>;
        let rows: &[(Ver, Rule)] = &[
            (None, Rule::NvidiaWaylandUntouched),
            (Some((2, 44, 0)), Rule::NvidiaWaylandUntouched),
            (Some((2, 52, 6)), Rule::NvidiaWaylandUntouched),
            (Some((2, 54, 0)), Rule::NvidiaWaylandUntouched),
            (Some((2, 54, 1)), Rule::NvidiaWaylandUntouched),
            (Some((2, 54, 2)), Rule::NvidiaWaylandFixed),
            (Some((2, 54, 3)), Rule::NvidiaWaylandFixed),
            (Some((2, 56, 0)), Rule::NvidiaWaylandFixed),
        ];
        for (version, want) in rows {
            let mut i = inputs(vec![nvidia(true)], Session::Wayland);
            if let Some((a, b, c)) = version {
                i.webkit = webkit_at(*a, *b, *c);
            }
            let d = decide(&i);
            assert_eq!((d.rule, d.set.is_empty()), (*want, true), "{version:?}");
        }
    }

    /// The version changes nothing outside Wayland with the NVIDIA proprietary display GPU.
    #[test]
    fn the_version_changes_no_other_row() {
        for session in [Session::X11, Session::Unknown] {
            let mut old = inputs(vec![nvidia(true)], session);
            let mut new = old.clone();
            old.webkit = webkit_at(2, 52, 6);
            new.webkit = webkit_at(2, 54, 3);
            assert_eq!(decide(&old), decide(&new), "{session:?}");
        }
        let mut hybrid = inputs(vec![intel(true), nvidia(false)], Session::Wayland);
        hybrid.webkit = webkit_at(2, 54, 3);
        assert_eq!(decide(&hybrid).rule, Rule::NoNvidiaProprietary);
        // A user's switch wins over the fixed-version rule, and so does the policy.
        let mut user = inputs(vec![nvidia(true)], Session::Wayland);
        user.webkit = webkit_at(2, 54, 3);
        user.user_switches = vec!["__NV_DISABLE_EXPLICIT_SYNC".to_owned()];
        assert_eq!(decide(&user).rule, Rule::UserEnvironment);
        let mut policy = inputs(vec![nvidia(true)], Session::Wayland);
        policy.webkit = webkit_at(2, 54, 3);
        policy.policy = Policy::Shm;
        let d = decide(&policy);
        assert_eq!(d.rule, Rule::PolicyShm);
        assert_eq!(set_of(&d), vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"]);
    }

    /// When the GPU rule moves rendering to the NVIDIA GPU, the renderer rules judge that GPU, not the display one.
    #[test]
    fn offloaded_rendering_is_judged_on_the_nvidia_gpu() {
        let hybrid = vec![intel(true), nvidia(false)];
        // Without offload the display GPU is Intel: nothing to do on either session.
        for session in [Session::X11, Session::Wayland] {
            assert_eq!(
                decide(&inputs(hybrid.clone(), session)).rule,
                Rule::NoNvidiaProprietary
            );
        }
        // With offload on X11 the NVIDIA blank-window rule applies (ADR-0024); on Wayland the version decides.
        let mut x11 = inputs(hybrid.clone(), Session::X11);
        x11.offload = true;
        let d = decide(&x11);
        assert_eq!(
            (d.rule, set_of(&d)),
            (Rule::NvidiaX11, vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM"])
        );
        let mut wl = inputs(hybrid.clone(), Session::Wayland);
        wl.offload = true;
        assert_eq!(decide(&wl).rule, Rule::NvidiaWaylandUntouched);
        wl.webkit = webkit_at(2, 54, 2);
        assert_eq!(decide(&wl).rule, Rule::NvidiaWaylandFixed);
        // Offload with no NVIDIA proprietary GPU falls back to the display GPU.
        let mut none = inputs(vec![intel(true)], Session::X11);
        none.offload = true;
        assert_eq!(decide(&none).rule, Rule::NoNvidiaProprietary);
    }

    #[test]
    fn the_note_names_a_renderer_that_limits_motion() {
        // The owner's launch: the CPU path forced by the environment, on a version with the fix.
        let mut i = inputs(vec![intel(true), nvidia(false)], Session::Wayland);
        i.webkit = webkit_at(2, 54, 2);
        i.user_switches = vec!["WEBKIT_DISABLE_DMABUF_RENDERER".to_owned()];
        let n = note(&i, &decide(&i)).unwrap_or_default();
        assert!(n.contains("WEBKIT_DISABLE_DMABUF_RENDERER"), "{n}");
        assert!(n.contains("CPU"), "{n}");
        assert!(n.contains("explicit-sync fix"), "{n}");
        // Before the fix the advice to unset it is not given.
        i.webkit = webkit_at(2, 52, 6);
        assert!(
            !note(&i, &decide(&i))
                .unwrap_or_default()
                .contains("explicit-sync")
        );
        // The host's own CPU choice is named too.
        let mut cpu = inputs(vec![intel(true)], Session::Wayland);
        cpu.policy = Policy::Cpu;
        assert!(note(&cpu, &decide(&cpu)).is_some());
        // GL paths and the default have nothing to say.
        let mut shm = inputs(vec![nvidia(true)], Session::X11);
        assert!(note(&shm, &decide(&shm)).is_none());
        shm.user_switches = vec!["WEBKIT_DMABUF_RENDERER_FORCE_SHM".to_owned()];
        assert!(note(&shm, &decide(&shm)).is_none());
        assert!(
            note(
                &inputs(vec![], Session::Wayland),
                &decide(&inputs(vec![], Session::Wayland))
            )
            .is_none()
        );
    }

    #[test]
    fn the_report_names_the_rule_and_the_choices() {
        let i = inputs(vec![nvidia(true)], Session::X11);
        let d = decide(&i);
        let gpu_inputs = gpu::Inputs {
            gpus: i.gpus.clone(),
            session: i.session,
            webkit: i.webkit.clone(),
            power: gpu::PowerSource::Ac,
            policy: gpu::Policy::Auto,
            user_vars: vec![],
            switcheroo: None,
        };
        let gpu_decision = gpu::decide(&gpu_inputs);
        let r = report(
            &i,
            &d,
            gpu::report(
                &gpu_inputs,
                gpu::PolicySource::Default,
                &gpu_decision,
                gpu::PowerSource::Ac,
            ),
        );
        assert_eq!(r.rule, Rule::NvidiaX11);
        assert_eq!(
            r.set,
            vec![(
                "WEBKIT_DMABUF_RENDERER_FORCE_SHM".to_owned(),
                "1".to_owned()
            )]
        );
        assert!(r.choices.iter().any(|(k, _)| k == "software"));
        assert_eq!(r.webkit.version, None);
        assert_eq!(r.webkit.origin, webkit::Origin::Unknown);
        assert_eq!(r.note, None);
    }
}
