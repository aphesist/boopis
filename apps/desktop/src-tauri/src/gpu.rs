//! Which GPU the webview renders on (ADR-0025), decided before the webview exists.
//!
//! On a hybrid laptop the integrated GPU drives the panel and the discrete one sits beside it. Rendering on the
//! discrete GPU is **PRIME render offload**: the app draws on it and the frames are copied to the integrated GPU for
//! scan-out. The choice is made by environment variables read when `libEGL` and the web process start, so it is made at
//! the top of `run()`, before any thread, like the renderer switches (`renderer.rs`).
//!
//! What was checked, and where (`[V]` read, `[?]` not run on hardware):
//! - NVIDIA's README, "PRIME Render Offload" (`download.nvidia.com/XFree86/Linux-x86_64/570.133.07/README/primerenderoffload.html`):
//!   `__NV_PRIME_RENDER_OFFLOAD=1` is the switch; "if the graphics application uses Vulkan or EGL, that should be all
//!   that is needed"; GLX also needs `__GLX_VENDOR_LIBRARY_NAME=nvidia`; `__VK_LAYER_NV_optimus=NVIDIA_only` pins
//!   Vulkan to the NVIDIA GPU. [V]
//! - `WebKitGTK` is an EGL client (a Wayland display in the UI process, a GBM device in the web process) and has no GPU
//!   setting of its own; it takes the DRM render node from the UI process' EGL display, so the EGL vendor decides, and
//!   `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD12x` overrides it (`Source/WebKit/UIProcess/glib/DRMMainDevice.cpp`,
//!   `drmMainDevice()`). The host does not set it: the render node EGL reports is the GPU EGL renders on, and a node
//!   chosen by hand could disagree with it. A user-set one is respected. [V]
//! - libglvnd loads every EGL vendor and tries them in file-name order (`10_nvidia.json` before `50_mesa.json`);
//!   `__EGL_VENDOR_LIBRARY_FILENAMES` would restrict that to one vendor (`libglvnd` `src/EGL/icd_enumeration.md`). The host
//!   does not set it: restricting to NVIDIA would also take Mesa away from every other EGL client in the process.
//!   [?: that the NVIDIA vendor then wins on Wayland needs a run on the owner's machine]
//! - switcheroo-control (`net.hadess.SwitcherooControl`, `GPUs` property, `aa{sv}`) names each GPU with `Name`,
//!   `Environment` (an even-length list: variable, value, ...), `Default` and `Discrete`
//!   (`src/net.hadess.SwitcherooControl.xml`). For NVIDIA it advertises exactly `__GLX_VENDOR_LIBRARY_NAME=nvidia`,
//!   `__NV_PRIME_RENDER_OFFLOAD=1`, `__VK_LAYER_NV_optimus=NVIDIA_only` (`get_card_env()` in `src/switcheroo-control.c`),
//!   and `DRI_PRIME=<id>` for a Mesa GPU. [V]
//! - Research (`docs/research/120hz.md` section 4.3) advises against forcing offload as a *fix*: it adds a cross-GPU
//!   copy and wakes the dGPU for a light 2D UI, and puts the app on NVIDIA's EGL, the path of the explicit-sync crash
//!   fixed in `WebKitGTK` 2.54.2. So `auto` requires that fix, AC power and a loaded proprietary driver, and
//!   `dedicated` on an older `WebKitGTK` is allowed but warned about.
//!
//! The decision (`decide`) is a pure function of its inputs; `probe` reads them; `apply` is the renderer's one `set_var`.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::renderer::{Gpu, Session};
use crate::webkit;

/// The variable that sets the choice: `auto` (the default), `integrated` or `dedicated`.
pub const POLICY_VAR: &str = "HYPOTAXIS_GPU";

/// The app identifier: the directory name under the data directory where the Tauri store keeps `settings.json`.
pub const APP_IDENTIFIER: &str = "dev.aphesist.hypotaxis";

/// What the owner chose: from `HYPOTAXIS_GPU` or from Settings > General.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuPolicy")]
pub enum Policy {
    /// The dedicated GPU on AC power with a loaded NVIDIA driver and a `WebKitGTK` that has the explicit-sync fix;
    /// the integrated GPU otherwise.
    #[default]
    Auto,
    /// The integrated GPU (what the system does by default on a hybrid laptop).
    Integrated,
    /// The dedicated GPU, whatever the power source.
    Dedicated,
}

impl Policy {
    /// Parse a value; anything unknown is `None` (a typo must not change what the owner gets).
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "integrated" | "igpu" | "intel" => Some(Self::Integrated),
            "dedicated" | "discrete" | "dgpu" | "nvidia" => Some(Self::Dedicated),
            _ => None,
        }
    }
}

/// Where the policy in force came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuPolicySource")]
pub enum PolicySource {
    /// `HYPOTAXIS_GPU`.
    Environment,
    /// Settings > General.
    Setting,
    /// Neither: `auto`.
    Default,
}

/// The policy in force: the environment variable first, then the saved setting, else `auto`.
#[must_use]
pub fn resolve_policy(env: Option<&str>, stored: Option<Policy>) -> (Policy, PolicySource) {
    if let Some(p) = env.and_then(Policy::parse) {
        return (p, PolicySource::Environment);
    }
    match stored {
        Some(p) => (p, PolicySource::Setting),
        None => (Policy::Auto, PolicySource::Default),
    }
}

/// The saved choice, read from the text of the Tauri store's `settings.json` (`{"app": {"gpu": "dedicated", ...}}`).
/// Lenient on purpose: this runs before the app exists, and a file that does not read means "no saved choice".
#[must_use]
pub fn stored_policy(settings_json: &str) -> Option<Policy> {
    let v: serde_json::Value = serde_json::from_str(settings_json).ok()?;
    Policy::parse(v.get("app")?.get("gpu")?.as_str()?)
}

/// Where the Tauri store keeps the settings file (`<data dir>/<identifier>/settings.json`).
#[must_use]
pub fn settings_path() -> Option<std::path::PathBuf> {
    Some(dirs::data_dir()?.join(APP_IDENTIFIER).join("settings.json"))
}

/// Where the machine gets its power.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PowerSource {
    /// A mains adapter is online.
    Ac,
    /// There is a mains adapter and none is online.
    Battery,
    /// No mains adapter is listed, or it could not be read: nothing is assumed.
    Unknown,
}

/// One entry of `/sys/class/power_supply`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Supply {
    /// The `type` file (`Mains`, `Battery`, `USB`, ...).
    pub kind: String,
    /// The `online` file, when there is one.
    pub online: Option<bool>,
}

/// Read the supplies from a `/sys/class/power_supply`-shaped directory (a parameter so a test can build one).
#[must_use]
pub fn read_supplies(dir: &Path) -> Vec<Supply> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .flatten()
        .filter_map(|e| {
            let kind = fs::read_to_string(e.path().join("type"))
                .ok()?
                .trim()
                .to_owned();
            let online = fs::read_to_string(e.path().join("online"))
                .ok()
                .map(|s| s.trim() == "1");
            Some(Supply { kind, online })
        })
        .collect()
}

/// The power source: a `Mains` supply online is AC; `Mains` supplies all offline is battery; no `Mains` supply is unknown.
#[must_use]
pub fn power_source_of(supplies: &[Supply]) -> PowerSource {
    let mains: Vec<&Supply> = supplies.iter().filter(|s| s.kind == "Mains").collect();
    if mains.is_empty() {
        PowerSource::Unknown
    } else if mains.iter().any(|s| s.online == Some(true)) {
        PowerSource::Ac
    } else if mains.iter().all(|s| s.online == Some(false)) {
        PowerSource::Battery
    } else {
        PowerSource::Unknown
    }
}

/// The power source of this machine now.
#[must_use]
pub fn power_source() -> PowerSource {
    power_source_of(&read_supplies(Path::new("/sys/class/power_supply")))
}

/// Variables that choose the GPU. If the user has set any, the host sets none: a half-applied offload is worse than the
/// user's own.
pub const USER_VARS: &[&str] = &[
    "__NV_PRIME_RENDER_OFFLOAD",
    "__NV_PRIME_RENDER_OFFLOAD_PROVIDER",
    "__GLX_VENDOR_LIBRARY_NAME",
    "__VK_LAYER_NV_optimus",
    "__EGL_VENDOR_LIBRARY_FILENAMES",
    "__EGL_VENDOR_LIBRARY_DIRS",
    "DRI_PRIME",
    "WEBKIT_WEB_RENDER_DEVICE_FILE",
];

/// NVIDIA's documented offload variables, for when switcheroo-control is not running. `__GLX_VENDOR_LIBRARY_NAME`
/// is for GLX clients and harmless for an EGL one; `__VK_LAYER_NV_optimus` pins Vulkan (the same three switcheroo-control
/// advertises).
pub const NVIDIA_OFFLOAD: &[(&str, &str)] = &[
    ("__NV_PRIME_RENDER_OFFLOAD", "1"),
    ("__GLX_VENDOR_LIBRARY_NAME", "nvidia"),
    ("__VK_LAYER_NV_optimus", "NVIDIA_only"),
];

/// The only variables the host takes from switcheroo-control: the GPU selection ones. Anything else a service names is
/// dropped (a D-Bus reply is not allowed to put `LD_PRELOAD` in this process). `__EGL_VENDOR_LIBRARY_FILENAMES` is not
/// on the list: ADR-0025 says the host never sets an EGL vendor file (it would take Mesa away from every other EGL client
/// in the process), and a service must not be able to do what the host itself does not.
const SWITCHEROO_ALLOWED: &[&str] = &[
    "__NV_PRIME_RENDER_OFFLOAD",
    "__NV_PRIME_RENDER_OFFLOAD_PROVIDER",
    "__GLX_VENDOR_LIBRARY_NAME",
    "__VK_LAYER_NV_optimus",
    "DRI_PRIME",
    "VK_LOADER_DRIVERS_SELECT",
];

/// One GPU as switcheroo-control lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwitcherooGpu {
    /// The user-facing name.
    pub name: String,
    /// The GPU the system uses by default.
    pub default: bool,
    /// A dedicated (discrete) GPU.
    pub discrete: bool,
    /// The environment to set to use it, already filtered to the allowed names.
    pub environment: Vec<(String, String)>,
}

fn allowed_pair(k: &str, v: &str) -> bool {
    SWITCHEROO_ALLOWED.contains(&k)
        && !v.is_empty()
        && v.len() <= 256
        && v.chars().all(|c| !c.is_control())
}

/// Parse `busctl --json=short get-property net.hadess.SwitcherooControl ... GPUs`. The property is `aa{sv}`; `busctl`
/// writes `{"type":"aa{sv}","data":[{"Name":{"type":"s","data":"..."},"Environment":{"type":"as","data":[...]},...}]}`.
/// A bare variant value (`"Name":"..."`) is read too. An entry with an odd `Environment` list, or that is not an object, is
/// skipped; nothing here fails the start of the app.
#[must_use]
pub fn parse_switcheroo(json: &str) -> Vec<SwitcherooGpu> {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(json) else {
        return vec![];
    };
    let data = root.get("data").unwrap_or(&root);
    // A variant is `{"type": .., "data": ..}`; take the inside when it is one.
    let inner = |v: &serde_json::Value| -> serde_json::Value {
        match (v.get("type"), v.get("data")) {
            (Some(_), Some(d)) => d.clone(),
            _ => v.clone(),
        }
    };
    let Some(list) = data.as_array() else {
        return vec![];
    };
    list.iter()
        .filter_map(|gpu| {
            let gpu = gpu.as_object()?;
            let field = |k: &str| gpu.get(k).map(&inner);
            let strings: Vec<String> = field("Environment")?
                .as_array()?
                .iter()
                .map(|s| s.as_str().map(str::to_owned))
                .collect::<Option<_>>()?;
            if !strings.len().is_multiple_of(2) {
                return None;
            }
            let environment = strings
                .chunks(2)
                .filter(|kv| allowed_pair(&kv[0], &kv[1]))
                .map(|kv| (kv[0].clone(), kv[1].clone()))
                .collect();
            Some(SwitcherooGpu {
                name: field("Name")
                    .and_then(|n| n.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                default: field("Default").and_then(|b| b.as_bool()).unwrap_or(false),
                discrete: field("Discrete").and_then(|b| b.as_bool()).unwrap_or(false),
                environment,
            })
        })
        .collect()
}

/// The environment switcheroo-control advertises for the dedicated GPU: the first `Discrete` entry that has any
/// allowed variable. With `nvidia`, an entry that sets `__NV_PRIME_RENDER_OFFLOAD` is the one wanted.
#[must_use]
pub fn discrete_environment(gpus: &[SwitcherooGpu], nvidia: bool) -> Option<Vec<(String, String)>> {
    gpus.iter()
        .filter(|g| g.discrete && !g.environment.is_empty())
        .find(|g| {
            !nvidia
                || g.environment
                    .iter()
                    .any(|(k, _)| k == "__NV_PRIME_RENDER_OFFLOAD")
        })
        .map(|g| g.environment.clone())
}

/// Where systemd's `busctl` is looked for, in order. Fixed absolute paths, never `PATH`: the host runs it before anything
/// else is up, and a `busctl` found through a user-writable `PATH` entry would be run as the user's app.
#[cfg(target_os = "linux")]
const BUSCTL_PATHS: &[&str] = &["/usr/bin/busctl", "/bin/busctl"];

/// The first of `candidates` that is a regular, executable file (a symlink to one is fine: `/bin` is one on merged-`/usr`
/// systems). Pure over the list, so the lookup is tested without a systemd.
#[cfg(target_os = "linux")]
fn first_executable(candidates: &[&str]) -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    candidates.iter().map(std::path::PathBuf::from).find(|p| {
        std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    })
}

/// Ask switcheroo-control for its GPU list with `busctl` (systemd's own tool, so present wherever the service is; found at
/// a fixed path), with a deadline. It is a child process, not a D-Bus connection in this process: a connection starts a thread, and the
/// environment must be set before any thread exists. `None` when the service is not running or anything goes wrong.
#[cfg(target_os = "linux")]
#[must_use]
pub fn query_switcheroo() -> Option<Vec<SwitcherooGpu>> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let busctl = first_executable(BUSCTL_PATHS)?;
    let mut child = Command::new(busctl)
        .env_clear()
        .args([
            "--system",
            "--json=short",
            "--timeout=1",
            "get-property",
            "net.hadess.SwitcherooControl",
            "/net/hadess/SwitcherooControl",
            "net.hadess.SwitcherooControl",
            "GPUs",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_millis(1500);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
        }
    }
    let mut out = String::new();
    child
        .stdout
        .take()?
        .take(1 << 16)
        .read_to_string(&mut out)
        .ok()?;
    let gpus = parse_switcheroo(&out);
    (!gpus.is_empty()).then_some(gpus)
}

/// No switcheroo-control off Linux.
#[cfg(not(target_os = "linux"))]
#[must_use]
pub fn query_switcheroo() -> Option<Vec<SwitcherooGpu>> {
    None
}

/// What `decide` reads.
#[derive(Debug, Clone)]
pub struct Inputs {
    /// Every GPU found (`renderer::read_gpus`).
    pub gpus: Vec<Gpu>,
    /// The session type.
    pub session: Session,
    /// The `WebKitGTK` this process runs on.
    pub webkit: webkit::Info,
    /// Where the power comes from now.
    pub power: PowerSource,
    /// The choice in force.
    pub policy: Policy,
    /// Which of `USER_VARS` are already in the environment.
    pub user_vars: Vec<String>,
    /// switcheroo-control's GPU list, when the service answered.
    pub switcheroo: Option<Vec<SwitcherooGpu>>,
}

/// Why the decision came out as it did (stable names: they go in the log and in the diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuRule")]
pub enum Rule {
    /// A GPU-selecting variable was already in the environment; nothing is changed.
    UserEnvironment,
    /// `integrated`: the system's own choice on a hybrid laptop.
    PolicyIntegrated,
    /// `dedicated`: offload to the dedicated GPU.
    PolicyDedicated,
    /// `dedicated`, and no dedicated GPU with a loaded proprietary driver was found: nothing to offload to.
    PolicyDedicatedNoGpu,
    /// `auto`: the dedicated GPU (AC power, a loaded NVIDIA driver, a `WebKitGTK` with the explicit-sync fix).
    AutoDedicated,
    /// `auto`, on battery: the integrated GPU.
    AutoOnBattery,
    /// `auto`, and the power source could not be told: the integrated GPU.
    AutoPowerUnknown,
    /// `auto`, and no separate NVIDIA GPU with a loaded proprietary driver exists: nothing to choose between.
    AutoNoDedicatedGpu,
    /// `auto`, and the `WebKitGTK` is older than 2.54.2 or its version is unknown: the integrated GPU.
    AutoWebkitTooOld,
    /// `auto`, and the session type could not be told: nothing is assumed.
    AutoSessionUnknown,
    /// The display GPU already is the NVIDIA GPU (a dGPU-only mode): there is no offload to do.
    DisplayIsDedicated,
}

/// What the owner should know about the choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuWarning")]
pub enum Warning {
    /// `dedicated` on Wayland with a `WebKitGTK` before 2.54.2 (or of unknown version): the GTK 3 explicit-sync crash
    /// with NVIDIA is not fixed there, so the window may close or stay blank.
    MayCrashOnWayland,
}

/// Where the variables came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuEnvSource")]
pub enum EnvSource {
    /// What switcheroo-control advertises for the dedicated GPU.
    Switcheroo,
    /// NVIDIA's documented offload variables.
    NvidiaDocumented,
}

/// The outcome: the environment to set, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    /// Variables to set, in order (none when the system's own choice stands).
    pub set: Vec<(String, String)>,
    /// The rule that decided.
    pub rule: Rule,
    /// Where `set` came from, when it is not empty.
    pub source: Option<EnvSource>,
    /// Something the owner should know.
    pub warning: Option<Warning>,
    /// The webview will render on the NVIDIA GPU (so the renderer rules judge that GPU, not the display one).
    pub renders_on_nvidia: bool,
}

impl Decision {
    fn nothing(rule: Rule) -> Self {
        Self {
            set: vec![],
            rule,
            source: None,
            warning: None,
            renders_on_nvidia: false,
        }
    }
}

fn display_gpu(gpus: &[Gpu]) -> Option<&Gpu> {
    gpus.iter()
        .find(|g| g.boot_display)
        .or_else(|| gpus.first())
}

/// A separate NVIDIA GPU with the proprietary driver loaded: not the display one.
fn dedicated_gpu(gpus: &[Gpu]) -> Option<&Gpu> {
    let display = display_gpu(gpus)?;
    gpus.iter()
        .find(|g| g.card != display.card && g.is_nvidia_proprietary())
}

/// The offload environment for the NVIDIA GPU: switcheroo-control's when it answered, else NVIDIA's documented one.
fn offload(i: &Inputs, rule: Rule) -> Decision {
    let advertised = i
        .switcheroo
        .as_deref()
        .and_then(|g| discrete_environment(g, true));
    let (set, source) = match advertised {
        Some(env) => (env, EnvSource::Switcheroo),
        None => (
            NVIDIA_OFFLOAD
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
            EnvSource::NvidiaDocumented,
        ),
    };
    let warning = (i.policy == Policy::Dedicated
        && i.session == Session::Wayland
        && !i.webkit.has_explicit_sync_fix())
    .then_some(Warning::MayCrashOnWayland);
    Decision {
        set,
        rule,
        source: Some(source),
        warning,
        renders_on_nvidia: true,
    }
}

/// The decision table. Pure: the same inputs always give the same answer.
#[must_use]
pub fn decide(i: &Inputs) -> Decision {
    if !i.user_vars.is_empty() {
        return Decision::nothing(Rule::UserEnvironment);
    }
    match i.policy {
        Policy::Integrated => return Decision::nothing(Rule::PolicyIntegrated),
        Policy::Dedicated => {
            if display_gpu(&i.gpus).is_some_and(Gpu::is_nvidia_proprietary) {
                return Decision::nothing(Rule::DisplayIsDedicated);
            }
            return if dedicated_gpu(&i.gpus).is_some() {
                offload(i, Rule::PolicyDedicated)
            } else {
                Decision::nothing(Rule::PolicyDedicatedNoGpu)
            };
        }
        Policy::Auto => {}
    }
    if display_gpu(&i.gpus).is_some_and(Gpu::is_nvidia_proprietary) {
        return Decision::nothing(Rule::DisplayIsDedicated);
    }
    if dedicated_gpu(&i.gpus).is_none() {
        return Decision::nothing(Rule::AutoNoDedicatedGpu);
    }
    match i.power {
        PowerSource::Battery => return Decision::nothing(Rule::AutoOnBattery),
        PowerSource::Unknown => return Decision::nothing(Rule::AutoPowerUnknown),
        PowerSource::Ac => {}
    }
    if !i.webkit.has_explicit_sync_fix() {
        return Decision::nothing(Rule::AutoWebkitTooOld);
    }
    if i.session == Session::Unknown {
        return Decision::nothing(Rule::AutoSessionUnknown);
    }
    offload(i, Rule::AutoDedicated)
}

/// Read the inputs from this machine, ask switcheroo-control only when the answer would be used, and decide.
#[must_use]
pub fn plan(mut i: Inputs) -> (Inputs, Decision) {
    let first = decide(&i);
    if first.source.is_some() {
        i.switcheroo = query_switcheroo();
    }
    let d = decide(&i);
    (i, d)
}

/// What the machine would do now, against what was applied at start: the app cannot move to another GPU while it
/// runs, so a difference is offered as "restart to switch", never done silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "GpuSwitch")]
pub enum Switch {
    /// A restart would move rendering to the dedicated GPU.
    ToDedicated,
    /// A restart would move rendering to the integrated GPU.
    ToIntegrated,
}

/// The restart advice: the decision the inputs give with the power source as it is now, against the one applied.
#[must_use]
pub fn restart_advice(
    applied: &Decision,
    inputs: &Inputs,
    power_now: PowerSource,
) -> Option<Switch> {
    let now = decide(&Inputs {
        power: power_now,
        ..inputs.clone()
    });
    match (applied.renders_on_nvidia, now.renders_on_nvidia) {
        (false, true) => Some(Switch::ToDedicated),
        (true, false) => Some(Switch::ToIntegrated),
        _ => None,
    }
}

/// The GPU part of the diagnostics report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "GpuReport")]
pub struct Report {
    /// The choice in force.
    pub policy: Policy,
    /// Where it came from.
    pub policy_source: PolicySource,
    /// The rule that decided.
    pub rule: Rule,
    /// The variables the host set.
    pub set: Vec<(String, String)>,
    /// Where they came from.
    pub env_source: Option<EnvSource>,
    /// A warning for the owner.
    pub warning: Option<Warning>,
    /// The power source now.
    pub power: PowerSource,
    /// A restart would change the GPU.
    pub restart_advice: Option<Switch>,
    /// The display GPU's driver and vendor (`card0 0x8086 i915`).
    pub display_gpu: Option<String>,
    /// The dedicated NVIDIA GPU, when there is one.
    pub dedicated_gpu: Option<String>,
}

fn describe(g: &Gpu) -> String {
    format!(
        "{} {} {}",
        g.card,
        g.vendor,
        g.driver.as_deref().unwrap_or("no driver")
    )
}

/// The report for a decision, with the power source as it is now.
#[must_use]
pub fn report(
    inputs: &Inputs,
    source: PolicySource,
    decision: &Decision,
    power_now: PowerSource,
) -> Report {
    Report {
        policy: inputs.policy,
        policy_source: source,
        rule: decision.rule,
        set: decision.set.clone(),
        env_source: decision.source,
        warning: decision.warning,
        power: power_now,
        restart_advice: restart_advice(decision, inputs, power_now),
        display_gpu: display_gpu(&inputs.gpus).map(describe),
        dedicated_gpu: dedicated_gpu(&inputs.gpus).map(describe),
    }
}

/// Read the inputs: the GPUs, the session, `WebKitGTK`, the power source, the choice and the user's variables.
#[must_use]
pub fn probe(gpus: Vec<Gpu>, session: Session, webkit: webkit::Info) -> (Inputs, PolicySource) {
    let stored = settings_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| stored_policy(&t));
    let (policy, source) = resolve_policy(std::env::var(POLICY_VAR).ok().as_deref(), stored);
    (
        Inputs {
            gpus,
            session,
            webkit,
            power: power_source(),
            policy,
            user_vars: USER_VARS
                .iter()
                .filter(|k| std::env::var_os(k).is_some())
                .map(|k| (*k).to_owned())
                .collect(),
            switcheroo: None,
        },
        source,
    )
}

/// Set the decided variables. Call it first thing in `run()`, before any thread exists (see `renderer::apply`).
#[allow(unsafe_code)]
pub fn apply(d: &Decision) {
    for (k, v) in &d.set {
        // SAFETY: called from `run()` before Tauri, tokio or the logger start a thread (the switcheroo query is a child
        // process, not a thread), so nothing can read the environment concurrently.
        unsafe { std::env::set_var(k, v) };
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
    fn intel() -> Gpu {
        gpu("card1", "0x8086", Some("i915"), true)
    }
    fn nvidia(boot: bool) -> Gpu {
        gpu("card0", "0x10de", Some("nvidia"), boot)
    }
    fn webkit_at(a: u32, b: u32, c: u32) -> webkit::Info {
        webkit::Info {
            version: Some(webkit::Version::new(a, b, c)),
            origin: webkit::Origin::System,
            library: None,
        }
    }
    /// The owner's machine: Intel display, NVIDIA beside it, Wayland, on AC, `WebKitGTK` 2.54.2.
    fn owner() -> Inputs {
        Inputs {
            gpus: vec![nvidia(false), intel()],
            session: Session::Wayland,
            webkit: webkit_at(2, 54, 2),
            power: PowerSource::Ac,
            policy: Policy::Auto,
            user_vars: vec![],
            switcheroo: None,
        }
    }
    fn names(d: &Decision) -> Vec<&str> {
        d.set.iter().map(|(k, _)| k.as_str()).collect()
    }

    const OFFLOAD: &[&str] = &[
        "__NV_PRIME_RENDER_OFFLOAD",
        "__GLX_VENDOR_LIBRARY_NAME",
        "__VK_LAYER_NV_optimus",
    ];

    /// One row per case: what changes from the owner's machine -> (rule, whether it offloads).
    #[test]
    #[allow(clippy::too_many_lines)] // one row per case reads best as one table
    fn the_decision_table() {
        type Edit = fn(&mut Inputs);
        let rows: Vec<(&str, Edit, Rule, bool)> = vec![
            ("the owner's machine", |_| {}, Rule::AutoDedicated, true),
            // power
            (
                "on battery",
                |i| i.power = PowerSource::Battery,
                Rule::AutoOnBattery,
                false,
            ),
            (
                "power unknown",
                |i| i.power = PowerSource::Unknown,
                Rule::AutoPowerUnknown,
                false,
            ),
            // WebKitGTK version
            (
                "2.54.1",
                |i| i.webkit = webkit_at(2, 54, 1),
                Rule::AutoWebkitTooOld,
                false,
            ),
            (
                "2.52.6",
                |i| i.webkit = webkit_at(2, 52, 6),
                Rule::AutoWebkitTooOld,
                false,
            ),
            (
                "version unknown",
                |i| i.webkit = webkit::Info::unknown(),
                Rule::AutoWebkitTooOld,
                false,
            ),
            (
                "2.54.3",
                |i| i.webkit = webkit_at(2, 54, 3),
                Rule::AutoDedicated,
                true,
            ),
            // session
            (
                "X11",
                |i| i.session = Session::X11,
                Rule::AutoDedicated,
                true,
            ),
            (
                "session unknown",
                |i| i.session = Session::Unknown,
                Rule::AutoSessionUnknown,
                false,
            ),
            // GPUs and driver
            (
                "no dedicated GPU",
                |i| i.gpus = vec![intel()],
                Rule::AutoNoDedicatedGpu,
                false,
            ),
            (
                "no GPU found",
                |i| i.gpus = vec![],
                Rule::AutoNoDedicatedGpu,
                false,
            ),
            (
                "nouveau",
                |i| i.gpus = vec![gpu("card0", "0x10de", Some("nouveau"), false), intel()],
                Rule::AutoNoDedicatedGpu,
                false,
            ),
            (
                "NVIDIA with no driver bound",
                |i| i.gpus = vec![gpu("card0", "0x10de", None, false), intel()],
                Rule::AutoNoDedicatedGpu,
                false,
            ),
            (
                "AMD dedicated: auto is NVIDIA only",
                |i| i.gpus = vec![gpu("card0", "0x1002", Some("amdgpu"), false), intel()],
                Rule::AutoNoDedicatedGpu,
                false,
            ),
            (
                "NVIDIA is the display GPU",
                |i| i.gpus = vec![nvidia(true)],
                Rule::DisplayIsDedicated,
                false,
            ),
            (
                "NVIDIA first, no flag: the first is the display",
                |i| i.gpus = vec![nvidia(false), gpu("card1", "0x8086", Some("i915"), false)],
                Rule::DisplayIsDedicated,
                false,
            ),
            // the owner's choices
            (
                "integrated",
                |i| i.policy = Policy::Integrated,
                Rule::PolicyIntegrated,
                false,
            ),
            (
                "dedicated on battery",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.power = PowerSource::Battery;
                },
                Rule::PolicyDedicated,
                true,
            ),
            (
                "dedicated, power unknown",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.power = PowerSource::Unknown;
                },
                Rule::PolicyDedicated,
                true,
            ),
            (
                "dedicated on an old WebKitGTK",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.webkit = webkit_at(2, 52, 6);
                },
                Rule::PolicyDedicated,
                true,
            ),
            (
                "dedicated with no dedicated GPU",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.gpus = vec![intel()];
                },
                Rule::PolicyDedicatedNoGpu,
                false,
            ),
            (
                "dedicated and NVIDIA already displays",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.gpus = vec![nvidia(true)];
                },
                Rule::DisplayIsDedicated,
                false,
            ),
            // a user variable wins over everything
            (
                "a user variable",
                |i| i.user_vars = vec!["DRI_PRIME".into()],
                Rule::UserEnvironment,
                false,
            ),
            (
                "a user variable beats dedicated",
                |i| {
                    i.policy = Policy::Dedicated;
                    i.user_vars = vec!["__NV_PRIME_RENDER_OFFLOAD".into()];
                },
                Rule::UserEnvironment,
                false,
            ),
        ];
        for (what, edit, rule, offloads) in rows {
            let mut i = owner();
            edit(&mut i);
            let d = decide(&i);
            assert_eq!((d.rule, d.renders_on_nvidia), (rule, offloads), "{what}");
            assert_eq!(
                d.set.is_empty(),
                !offloads,
                "{what}: variables iff offloading"
            );
            assert_eq!(d.source.is_some(), offloads, "{what}");
        }
    }

    #[test]
    fn without_switcheroo_nvidias_documented_variables_are_set() {
        let d = decide(&owner());
        assert_eq!(names(&d), OFFLOAD);
        assert_eq!(d.source, Some(EnvSource::NvidiaDocumented));
        assert!(
            d.set
                .contains(&("__NV_PRIME_RENDER_OFFLOAD".into(), "1".into()))
        );
        assert!(
            d.set
                .contains(&("__GLX_VENDOR_LIBRARY_NAME".into(), "nvidia".into()))
        );
        assert!(
            d.set
                .contains(&("__VK_LAYER_NV_optimus".into(), "NVIDIA_only".into()))
        );
        // No EGL vendor or render-node override: EGL's own choice stands.
        assert!(
            d.set
                .iter()
                .all(|(k, _)| !k.starts_with("__EGL") && !k.starts_with("WEBKIT"))
        );
    }

    #[test]
    fn switcheroo_controls_environment_is_preferred_when_it_answers() {
        let mut i = owner();
        i.switcheroo = Some(vec![
            SwitcherooGpu {
                name: "Intel".into(),
                default: true,
                discrete: false,
                environment: vec![("DRI_PRIME".into(), "pci-0000_00_02_0".into())],
            },
            SwitcherooGpu {
                name: "NVIDIA".into(),
                default: false,
                discrete: true,
                environment: vec![
                    ("__GLX_VENDOR_LIBRARY_NAME".into(), "nvidia".into()),
                    ("__NV_PRIME_RENDER_OFFLOAD".into(), "1".into()),
                    ("__VK_LAYER_NV_optimus".into(), "NVIDIA_only".into()),
                    ("VK_LOADER_DRIVERS_SELECT".into(), "nvidia_icd.json".into()),
                ],
            },
        ]);
        let d = decide(&i);
        assert_eq!(d.source, Some(EnvSource::Switcheroo));
        assert_eq!(
            names(&d),
            vec![
                "__GLX_VENDOR_LIBRARY_NAME",
                "__NV_PRIME_RENDER_OFFLOAD",
                "__VK_LAYER_NV_optimus",
                "VK_LOADER_DRIVERS_SELECT"
            ]
        );
        // A service that lists no discrete GPU leaves NVIDIA's documented variables.
        i.switcheroo = Some(vec![SwitcherooGpu {
            name: "Intel".into(),
            default: true,
            discrete: false,
            environment: vec![("DRI_PRIME".into(), "x".into())],
        }]);
        assert_eq!(decide(&i).source, Some(EnvSource::NvidiaDocumented));
    }

    #[test]
    fn dedicated_on_wayland_without_the_fix_warns() {
        type Ver = (u32, u32, u32);
        let rows: &[(Session, Ver, Option<Warning>)] = &[
            (
                Session::Wayland,
                (2, 52, 6),
                Some(Warning::MayCrashOnWayland),
            ),
            (
                Session::Wayland,
                (2, 54, 1),
                Some(Warning::MayCrashOnWayland),
            ),
            (Session::Wayland, (2, 54, 2), None),
            (Session::X11, (2, 52, 6), None),
        ];
        for (session, (a, b, c), want) in rows {
            let mut i = owner();
            i.policy = Policy::Dedicated;
            i.session = *session;
            i.webkit = webkit_at(*a, *b, *c);
            assert_eq!(decide(&i).warning, *want, "{session:?} {a}.{b}.{c}");
        }
        let mut unknown = owner();
        unknown.policy = Policy::Dedicated;
        unknown.webkit = webkit::Info::unknown();
        assert_eq!(decide(&unknown).warning, Some(Warning::MayCrashOnWayland));
        // `auto` only offloads with the fix, so it never warns.
        assert_eq!(decide(&owner()).warning, None);
    }

    #[test]
    fn a_restart_is_offered_when_the_power_source_changes_never_done() {
        let i = owner();
        let on_ac = decide(&i);
        assert_eq!(restart_advice(&on_ac, &i, PowerSource::Ac), None);
        assert_eq!(
            restart_advice(&on_ac, &i, PowerSource::Battery),
            Some(Switch::ToIntegrated)
        );
        let mut battery = owner();
        battery.power = PowerSource::Battery;
        let started_on_battery = decide(&battery);
        assert_eq!(
            restart_advice(&started_on_battery, &battery, PowerSource::Ac),
            Some(Switch::ToDedicated)
        );
        assert_eq!(
            restart_advice(&started_on_battery, &battery, PowerSource::Battery),
            None
        );
        // An explicit choice does not move with the power.
        let mut dedicated = owner();
        dedicated.policy = Policy::Dedicated;
        let d = decide(&dedicated);
        assert_eq!(restart_advice(&d, &dedicated, PowerSource::Battery), None);
    }

    #[test]
    fn the_policy_comes_from_the_environment_then_the_setting_then_auto() {
        assert_eq!(
            resolve_policy(None, None),
            (Policy::Auto, PolicySource::Default)
        );
        assert_eq!(
            resolve_policy(None, Some(Policy::Dedicated)),
            (Policy::Dedicated, PolicySource::Setting)
        );
        assert_eq!(
            resolve_policy(Some("integrated"), Some(Policy::Dedicated)),
            (Policy::Integrated, PolicySource::Environment)
        );
        // A typo in the variable does not hide the saved choice.
        assert_eq!(
            resolve_policy(Some("dedicatd"), Some(Policy::Dedicated)),
            (Policy::Dedicated, PolicySource::Setting)
        );
        assert_eq!(Policy::parse(" Dedicated "), Some(Policy::Dedicated));
        assert_eq!(Policy::parse("AUTO"), Some(Policy::Auto));
        assert_eq!(Policy::parse(""), None);
    }

    #[test]
    fn the_saved_choice_is_read_from_the_store_file() {
        assert_eq!(
            stored_policy(r#"{"app":{"version":1,"gpu":"dedicated","notifications":true}}"#),
            Some(Policy::Dedicated)
        );
        assert_eq!(stored_policy(r#"{"app":{"version":1}}"#), None);
        assert_eq!(stored_policy(r#"{"app":{"gpu":"turbo"}}"#), None);
        assert_eq!(stored_policy(r#"{"app":{"gpu":3}}"#), None);
        assert_eq!(stored_policy("not json"), None);
        assert_eq!(stored_policy(""), None);
    }

    #[test]
    fn the_identifier_matches_the_apps_config() {
        let conf = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"),
        )
        .unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&conf).unwrap_or_default();
        assert_eq!(v["identifier"].as_str(), Some(APP_IDENTIFIER));
    }

    fn supply(kind: &str, online: Option<bool>) -> Supply {
        Supply {
            kind: kind.into(),
            online,
        }
    }

    #[test]
    fn the_power_source_comes_from_mains_supplies() {
        let battery = supply("Battery", None);
        assert_eq!(
            power_source_of(&[supply("Mains", Some(true)), battery.clone()]),
            PowerSource::Ac
        );
        assert_eq!(
            power_source_of(&[supply("Mains", Some(false)), battery.clone()]),
            PowerSource::Battery
        );
        // Two adapters, one online.
        assert_eq!(
            power_source_of(&[supply("Mains", Some(false)), supply("Mains", Some(true))]),
            PowerSource::Ac
        );
        // No adapter listed (a desktop, or USB-C only): nothing is assumed.
        assert_eq!(power_source_of(&[battery]), PowerSource::Unknown);
        assert_eq!(power_source_of(&[]), PowerSource::Unknown);
        assert_eq!(
            power_source_of(&[supply("USB", Some(true))]),
            PowerSource::Unknown
        );
        // An adapter with no `online` file is not "offline".
        assert_eq!(
            power_source_of(&[supply("Mains", None)]),
            PowerSource::Unknown
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_supplies_are_read_from_a_directory() {
        let t = tempfile::tempdir().unwrap_or_else(|e| panic!("{e}"));
        let mk = |name: &str, kind: &str, online: Option<&str>| {
            let d = t.path().join(name);
            std::fs::create_dir_all(&d).unwrap_or_else(|e| panic!("{e}"));
            std::fs::write(d.join("type"), format!("{kind}\n")).unwrap_or_else(|e| panic!("{e}"));
            if let Some(o) = online {
                std::fs::write(d.join("online"), format!("{o}\n"))
                    .unwrap_or_else(|e| panic!("{e}"));
            }
        };
        mk("AC", "Mains", Some("1"));
        mk("BAT0", "Battery", None);
        std::fs::create_dir_all(t.path().join("junk")).unwrap_or_else(|e| panic!("{e}"));
        let supplies = read_supplies(t.path());
        assert_eq!(supplies.len(), 2);
        assert_eq!(power_source_of(&supplies), PowerSource::Ac);
        assert!(read_supplies(&t.path().join("missing")).is_empty());
    }

    /// `busctl --json=short get-property ... GPUs` for an Intel + NVIDIA laptop, as switcheroo-control advertises it.
    const BUSCTL: &str = r#"{"type":"aa{sv}","data":[
      {"Name":{"type":"s","data":"Intel Graphics"},
       "Environment":{"type":"as","data":["DRI_PRIME","pci-0000_00_02_0"]},
       "Default":{"type":"b","data":true},"Discrete":{"type":"b","data":false}},
      {"Name":{"type":"s","data":"NVIDIA GeForce RTX 4070 Laptop GPU"},
       "Environment":{"type":"as","data":["__GLX_VENDOR_LIBRARY_NAME","nvidia","__NV_PRIME_RENDER_OFFLOAD","1","__VK_LAYER_NV_optimus","NVIDIA_only"]},
       "Default":{"type":"b","data":false},"Discrete":{"type":"b","data":true}}]}"#;

    #[test]
    fn switcheroo_controls_gpu_list_is_parsed() {
        let gpus = parse_switcheroo(BUSCTL);
        assert_eq!(gpus.len(), 2);
        assert_eq!(gpus[0].name, "Intel Graphics");
        assert!(gpus[0].default && !gpus[0].discrete);
        assert_eq!(
            gpus[0].environment,
            vec![("DRI_PRIME".to_owned(), "pci-0000_00_02_0".to_owned())]
        );
        assert!(!gpus[1].default && gpus[1].discrete);
        assert_eq!(gpus[1].environment.len(), 3);
        assert_eq!(
            discrete_environment(&gpus, true),
            Some(gpus[1].environment.clone())
        );
        assert_eq!(discrete_environment(&gpus[..1], true), None);
        // Bare values (no type wrapper) are read too.
        let bare = r#"{"data":[{"Name":"X","Environment":["DRI_PRIME","1"],"Default":false,"Discrete":true}]}"#;
        let g = parse_switcheroo(bare);
        assert_eq!(g.len(), 1);
        assert!(g[0].discrete);
        assert_eq!(
            discrete_environment(&g, false),
            Some(g[0].environment.clone())
        );
        assert_eq!(
            discrete_environment(&g, true),
            None,
            "NVIDIA wanted, none offered"
        );
    }

    #[test]
    fn no_egl_vendor_file_is_taken_from_switcheroo_control() {
        // ADR-0025: the host never sets `__EGL_VENDOR_LIBRARY_FILENAMES`, so a service cannot make it do so (nor
        // `__EGL_VENDOR_LIBRARY_DIRS`), whatever else comes with it.
        let json = r#"{"data":[{"Environment":{"type":"as","data":[
          "__EGL_VENDOR_LIBRARY_FILENAMES","/usr/share/glvnd/egl_vendor.d/10_nvidia.json",
          "__EGL_VENDOR_LIBRARY_DIRS","/tmp/evil",
          "__NV_PRIME_RENDER_OFFLOAD","1"]},"Discrete":{"type":"b","data":true}}]}"#;
        let gpus = parse_switcheroo(json);
        assert_eq!(
            gpus[0].environment,
            vec![("__NV_PRIME_RENDER_OFFLOAD".to_owned(), "1".to_owned())]
        );
        assert!(
            !SWITCHEROO_ALLOWED
                .iter()
                .any(|k| k.starts_with("__EGL_VENDOR"))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn busctl_is_found_at_a_fixed_path_and_never_through_path() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let (plain, exec, dir) = (
            t.path().join("plain"),
            t.path().join("exec"),
            t.path().join("dir"),
        );
        std::fs::write(&plain, "").unwrap();
        std::fs::write(&exec, "").unwrap();
        std::fs::set_permissions(&exec, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::create_dir(&dir).unwrap();
        let s = |p: &std::path::Path| p.to_str().unwrap().to_owned();
        let (plain_s, exec_s, dir_s, missing) =
            (s(&plain), s(&exec), s(&dir), s(&t.path().join("nope")));
        // Not found, not executable and not a file are all skipped; the first real one wins.
        assert_eq!(
            first_executable(&[&missing, &plain_s, &dir_s, &exec_s]),
            Some(exec.clone())
        );
        assert_eq!(first_executable(&[&missing, &plain_s, &dir_s]), None);
        // The list the host uses is absolute paths only: a bare `busctl` would be a PATH lookup.
        assert!(BUSCTL_PATHS.iter().all(|p| p.starts_with('/')));
    }

    #[test]
    fn switcheroo_controls_reply_is_filtered_and_never_trusted() {
        // A variable outside the GPU selection ones is dropped; an odd list or a non-object entry is skipped.
        let json = r#"{"data":[
          {"Environment":{"type":"as","data":["LD_PRELOAD","/tmp/x.so","DRI_PRIME","1"]},"Discrete":{"type":"b","data":true}},
          {"Environment":{"type":"as","data":["DRI_PRIME"]},"Discrete":{"type":"b","data":true}},
          {"Environment":{"type":"as","data":["DRI_PRIME",""]},"Discrete":{"type":"b","data":true}},
          {"Environment":{"type":"as","data":["DRI_PRIME","a\nb"]},"Discrete":{"type":"b","data":true}},
          "nonsense", 7]}"#;
        let gpus = parse_switcheroo(json);
        assert_eq!(gpus.len(), 3);
        assert_eq!(
            gpus[0].environment,
            vec![("DRI_PRIME".to_owned(), "1".to_owned())]
        );
        assert!(gpus[1].environment.is_empty() && gpus[2].environment.is_empty());
        assert_eq!(discrete_environment(&gpus[1..], false), None);
        for bad in ["", "null", "[]", "{}", "not json", r#"{"data":"x"}"#] {
            assert!(parse_switcheroo(bad).is_empty(), "{bad:?}");
        }
    }

    #[test]
    fn the_report_names_the_gpus_and_the_advice() {
        let i = owner();
        let d = decide(&i);
        let r = report(&i, PolicySource::Default, &d, PowerSource::Battery);
        assert_eq!(r.rule, Rule::AutoDedicated);
        assert_eq!(r.restart_advice, Some(Switch::ToIntegrated));
        assert_eq!(r.display_gpu.as_deref(), Some("card1 0x8086 i915"));
        assert_eq!(r.dedicated_gpu.as_deref(), Some("card0 0x10de nvidia"));
        assert_eq!(r.set.len(), 3);
    }
}
