//! The command line of the app's binary: `boopis --version` and `boopis doctor`, run before the GUI starts.
//!
//! No arguments launches the app as always (and, from a terminal, prints one branded line first). A command prints and
//! exits: no window, no thread, no logger, and none of the renderer's environment changes. `doctor` reuses the host's
//! own decisions (`startup`, `frame_rate`, `webkit`, `runtime`); it is the Diagnostics report of Settings > General in a
//! terminal, not a second implementation of it.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::brand::{Art, Caps, ColorLevel, Ink, Tone};
use crate::renderer::{self, Gpu, RendererReport, Session};
use crate::{frame_rate, gpu, runtime, startup, webkit};

mod args;
mod bots;
pub mod connectors;
mod groups;
mod headless;
mod help;
mod remote;
mod run_bot;
mod team;
mod team_live;

/// The name people type.
pub const PRODUCT: &str = "boopis";

/// The width of a row's value: 78 columns less the mark and the label.
const VALUE_WIDTH: usize = 61;

/// Break `text` at spaces into lines of at most `width` characters (a word longer than that stays whole).
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for word in text.split(' ') {
        match lines.last_mut() {
            Some(line) if line.chars().count() + 1 + word.chars().count() <= width => {
                line.push(' ');
                line.push_str(word);
            }
            _ => lines.push(word.to_owned()),
        }
    }
    lines
}

/// What the arguments ask for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Start the app.
    Launch,
    /// `--version`.
    Version,
    /// `doctor`.
    Doctor,
    /// `connectors ...`: the arguments after the word.
    Connectors(Vec<String>),
    /// `--help`.
    Help,
    /// `groups ...`, with what follows it (group chats from a terminal).
    Groups(Vec<String>),
    /// `run ...` (a task through a group, to its end).
    Run(Vec<String>),
    /// `team ...` (a whole team as one file).
    Team(Vec<String>),
    /// `bots ...` (list, make and change bots).
    Bots(Vec<String>),
    /// `connect ...` (how to dial the engine's gateway, `docs/LOCAL-API.md`).
    Connect(Vec<String>),
    /// An option or command that does not exist, or one that takes no more arguments.
    Unknown(String),
}

/// Read the arguments (without the program name). Only a known word or an option-looking one is a command: anything
/// else (a path or a link the system hands to the app) starts the app.
#[must_use]
pub fn parse(args: &[String]) -> Command {
    let Some(first) = args.first() else {
        return Command::Launch;
    };
    if let Some(page) = help::find(first) {
        return (page.make)(args[1..].to_vec());
    }
    // `boopis help bots` is `boopis bots --help`
    if matches!(first.as_str(), "--help" | "-h" | "help")
        && let [_, word] = args
        && let Some(page) = help::find(word)
    {
        return (page.make)(vec!["--help".to_owned()]);
    }
    let rest_ok = args.len() == 1;
    match first.as_str() {
        "--version" | "-V" | "version" if rest_ok => Command::Version,
        "doctor" if rest_ok => Command::Doctor,
        "--help" | "-h" | "help" if rest_ok => Command::Help,
        "--version" | "-V" | "version" | "doctor" | "--help" | "-h" | "help" => {
            Command::Unknown(args[1].clone())
        }
        other if other.starts_with('-') => Command::Unknown(other.to_owned()),
        _ => Command::Launch,
    }
}

/// Take a leading `--engine <bundled|existing>` (or `--engine=<word>`) off the arguments: the choice, and what is left.
///
/// # Errors
/// The word, when it is neither (a missing word is the empty string).
pub fn split_engine(args: &[String]) -> Result<(Option<runtime::Source>, Vec<String>), String> {
    let (word, rest) = match args.first().map(String::as_str) {
        Some("--engine") => (
            args.get(1).cloned().unwrap_or_default(),
            args.get(2..).unwrap_or_default(),
        ),
        Some(a) if a.starts_with("--engine=") => (a["--engine=".len()..].to_owned(), &args[1..]),
        _ => return Ok((None, args.to_vec())),
    };
    runtime::Source::parse(&word)
        .map(|s| (Some(s), rest.to_vec()))
        .ok_or(word)
}

/// Whether a command needs the parent's console: every command that prints, and never a launch of the window.
#[must_use]
pub fn needs_console(command: &Command) -> bool {
    !matches!(command, Command::Launch)
}

/// The word of an engine command whose arguments ask for its page (`--help`, `-h`, or `help` first), else `None`.
#[must_use]
pub fn asks_help(command: &Command) -> Option<&'static str> {
    let (word, rest) = match command {
        Command::Groups(r) => ("groups", r),
        Command::Run(r) => ("run", r),
        Command::Team(r) => ("team", r),
        Command::Bots(r) => ("bots", r),
        Command::Connectors(r) => ("connectors", r),
        Command::Connect(r) => ("connect", r),
        Command::Launch
        | Command::Version
        | Command::Doctor
        | Command::Help
        | Command::Unknown(_) => return None,
    };
    help::asked(rest).then_some(word)
}

/// Run a command if the arguments ask for one. Returns the exit code; `None` means "start the app".
/// `resource_dir` is asked only by the commands that need it.
pub fn dispatch(args: &[String], resource_dir: &dyn Fn() -> Option<PathBuf>) -> Option<i32> {
    // `--engine existing|bundled` (first, before any command) chooses the engine for this run; documented in the
    // repository (docs/ENGINE.md), never in the app.
    let args = match split_engine(args) {
        Ok((choice, rest)) => {
            if let Some(choice) = choice {
                runtime::choose_for_this_run(choice);
            }
            rest
        }
        Err(what) => {
            console::attach_to_parent();
            eprintln!(
                "{PRODUCT}: --engine takes bundled or existing, not {what}. Try {PRODUCT} --help for what it does."
            );
            return Some(2);
        }
    };
    let command = parse(&args);
    if !needs_console(&command) {
        return None;
    }
    // The release binary is a GUI-subsystem one on Windows: without this a command's output goes nowhere.
    console::attach_to_parent();
    // `boopis <command> --help`: the command's page, before anything opens a link.
    if let Some(word) = asks_help(&command) {
        println!("{}", help::page_of(word).join("\n"));
        return Some(0);
    }
    let caps = Caps::from_process();
    let out = Out::new(caps);
    let version = env!("CARGO_PKG_VERSION");
    let text = match command {
        Command::Launch => return None,
        Command::Groups(rest) => {
            return Some(remote::run(
                remote::Kind::Groups,
                &rest,
                resource_dir().as_deref(),
            ));
        }
        Command::Run(rest) => {
            return Some(remote::run(
                remote::Kind::Run,
                &rest,
                resource_dir().as_deref(),
            ));
        }
        Command::Team(rest) => {
            return Some(remote::run(
                remote::Kind::Team,
                &rest,
                resource_dir().as_deref(),
            ));
        }
        Command::Bots(rest) => {
            return Some(remote::run(
                remote::Kind::Bots,
                &rest,
                resource_dir().as_deref(),
            ));
        }
        Command::Version => version_lines(&out, version, &facts(resource_dir().as_deref())),
        Command::Doctor => doctor_lines(&out, version, &gather(resource_dir().as_deref())),
        Command::Help => help_lines(&out, version),
        Command::Connectors(rest) => {
            return Some(connectors::run(&rest, resource_dir().as_deref()));
        }
        // How to dial the engine's gateway, for a client of the owner's (docs/LOCAL-API.md).
        Command::Connect(rest) => return Some(crate::local_api::connect::run(&rest, resource_dir)),
        Command::Unknown(what) => {
            eprintln!(
                "{PRODUCT}: {what} is not something {PRODUCT} understands. Try {PRODUCT} --help for what it does."
            );
            return Some(2);
        }
    };
    println!("{}", text.join("\n"));
    Some(0)
}

/// Windows' GUI-subsystem binary starts with no console, so `--version` and `doctor` print nothing from a terminal.
/// A command attaches to its parent's console (when there is one, and when the output is not already redirected).
mod console {
    /// Attach the process's output to the parent console. Nothing to do off Windows.
    #[cfg(not(windows))]
    pub fn attach_to_parent() {}

    /// Attach to the parent console and point the standard output and error at it, unless they already go to a
    /// pipe or a file. Does nothing when there is no parent console (started from Explorer): nobody reads it.
    #[cfg(windows)]
    #[allow(unsafe_code)] // Win32 console calls; no safe wrapper exists
    pub fn attach_to_parent() {
        use std::fs::OpenOptions;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Console::{
            ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_ERROR_HANDLE,
            STD_OUTPUT_HANDLE, SetStdHandle,
        };
        // SAFETY: plain Win32 calls with valid constants; the handle passed to `SetStdHandle` is leaked on purpose
        // (the process keeps it until it exits).
        unsafe {
            if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
                return;
            }
            let Ok(console) = OpenOptions::new().write(true).open("CONOUT$") else {
                return;
            };
            for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
                let current = GetStdHandle(which);
                // A GUI process starts with no handle; one that exists is a redirect and stays.
                if current.is_null() || current as isize == -1 {
                    SetStdHandle(which, console.as_raw_handle().cast());
                }
            }
            std::mem::forget(console);
        }
    }
}

/// One branded line when the app is started from a terminal: the version and what the host decided for the renderer.
/// Nothing is printed to a pipe or a file.
pub fn banner_line(report: &RendererReport, gpu: &gpu::Decision) {
    let caps = Caps::from_process();
    if !caps.interactive {
        return;
    }
    let out = Out::new(caps);
    let line = format!(
        "{} {}  {}",
        out.logo(),
        env!("CARGO_PKG_VERSION"),
        out.ink.paint(
            Tone::Dim,
            &format!(
                "renderer {}, gpu {}",
                renderer_short(report.rule),
                if gpu.renders_on_nvidia {
                    "dedicated"
                } else {
                    "integrated"
                }
            )
        )
    );
    println!("{line}");
}

/// How text is drawn on this terminal: the logo, the marks, the tones.
pub struct Out {
    caps: Caps,
    ink: Ink,
}

/// A verdict beside a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    /// Fine.
    Ok,
    /// Worth a look.
    Warn,
    /// Wrong.
    Fail,
}

impl Out {
    /// For a terminal's capabilities.
    #[must_use]
    pub fn new(caps: Caps) -> Self {
        Self {
            caps,
            ink: Ink::new(caps.color),
        }
    }

    /// The one-line logo, in the terminal's own foreground, bold.
    #[must_use]
    pub fn logo(&self) -> String {
        self.ink
            .paint(Tone::Strong, &Art::shipped().compact(&self.caps))
    }

    fn mark(&self, mark: Option<Mark>) -> String {
        let (glyph, tone) = match (mark, self.caps.unicode && self.caps.interactive) {
            (None, _) => return " ".to_owned(),
            (Some(Mark::Ok), true) => ("✓", Tone::Ok),
            (Some(Mark::Warn), _) => ("!", Tone::Warn),
            (Some(Mark::Fail), true) => ("✗", Tone::Fail),
            (Some(Mark::Ok), false) => ("+", Tone::Ok),
            (Some(Mark::Fail), false) => ("x", Tone::Fail),
        };
        self.ink.paint(tone, glyph)
    }

    /// `  <mark> <label, 12 wide> <value>`, the value wrapped under itself.
    fn row(&self, mark: Option<Mark>, label: &str, value: &str) -> String {
        let mut lines = wrap(value, VALUE_WIDTH).into_iter();
        let first = lines.next().unwrap_or_default();
        let mut out = format!(
            "  {} {} {first}",
            self.mark(mark),
            self.ink.paint(Tone::Dim, &format!("{label:<12}"))
        );
        for more in lines {
            let _ = write!(out, "\n    {:<12} {more}", "");
        }
        out
    }

    /// A quiet line under a row, aligned with the values and wrapped.
    fn note(&self, text: &str) -> String {
        wrap(text, VALUE_WIDTH)
            .iter()
            .map(|l| format!("    {:<12} {}", "", self.ink.paint(Tone::Dim, l)))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn heading(&self, text: &str) -> Vec<String> {
        vec![String::new(), self.ink.paint(Tone::Strong, text)]
    }
}

fn help_lines(out: &Out, version: &str) -> Vec<String> {
    let mut lines = vec![
        format!("{} {version}", out.logo()),
        String::new(),
        "A desktop app for AI coding agents.".to_owned(),
        String::new(),
        format!("Usage: {PRODUCT} [command]"),
        String::new(),
        format!("  {PRODUCT}               start the app"),
        format!(
            "  {PRODUCT} doctor        check this machine: session, GPUs, renderer, WebKitGTK, runtime and folders"
        ),
        format!("  {PRODUCT} --version     print the version and what the app carries"),
        String::new(),
        "These talk to the engine (docs/CLI.md):".to_owned(),
    ];
    lines.extend(
        help::PAGES
            .iter()
            .map(|p| format!("  {PRODUCT} {:<14}{}", p.word, p.summary)),
    );
    lines.extend([
        String::new(),
        format!(
            "{PRODUCT} <command> --help shows what a command takes. Exit codes: 0 done, 1 failed, 2 a usage mistake,"
        ),
        "3 stopped at a cap (or waiting for --yes), 4 a bot needs you.".to_owned(),
    ]);
    lines
}

/// What `--version` shows beside the version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    /// The engine version this build carries, when it carries one.
    pub hermes: Option<String>,
    /// The `WebKitGTK` this process runs on.
    pub webkit: webkit::Report,
}

/// Read the facts: the bundled runtime's manifest and the loaded `WebKitGTK`.
#[must_use]
pub fn facts(resource_dir: Option<&Path>) -> Facts {
    let hermes = runtime::Runtime::locate(resource_dir)
        .ok()
        .flatten()
        .map(|r| r.manifest().hermes_version.clone());
    Facts {
        hermes,
        webkit: webkit::probe().report(),
    }
}

fn webkit_origin(origin: webkit::Origin) -> &'static str {
    match origin {
        webkit::Origin::Bundled => "bundled",
        webkit::Origin::System => "the system's",
        webkit::Origin::Unknown => "origin unknown",
    }
}

/// The lines of `--version`.
#[must_use]
pub fn version_lines(out: &Out, version: &str, facts: &Facts) -> Vec<String> {
    let engine = facts.hermes.as_ref().map_or_else(
        || "not bundled in this build".to_owned(),
        |v| format!("{v}, bundled"),
    );
    let webkit = facts.webkit.version.as_ref().map_or_else(
        || "unknown".to_owned(),
        |v| format!("{v}, {}", webkit_origin(facts.webkit.origin)),
    );
    vec![
        format!("{} {version}", out.logo()),
        format!(
            "  {} {engine}",
            out.ink.paint(Tone::Dim, &format!("{:<10}", "engine"))
        ),
        format!(
            "  {} {webkit}",
            out.ink.paint(Tone::Dim, &format!("{:<10}", "webkitgtk"))
        ),
    ]
}

/// Everything `doctor` reports, gathered before any of it is drawn.
pub struct Gathered {
    /// The renderer's diagnostics, with the GPU's, as the Diagnostics screen has them.
    pub report: RendererReport,
    /// `BOOPIS_FPS`.
    pub fps_policy: frame_rate::Policy,
    /// The ACPI platform profile's text.
    pub platform_profile: Option<String>,
    /// Which Hermes the app runs and what state it is in.
    pub runtime: RuntimeStatus,
    /// The folders the app keeps things in, and whether each exists.
    pub folders: Vec<(&'static str, PathBuf, bool)>,
    /// What the web view's watchdog kept from the last run the app made (`webview_health`), when there is a record.
    pub last_webview: Option<crate::webview_health::Run>,
}

/// The state of the Hermes the app runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeStatus {
    /// The bundled runtime: its Hermes version, the folder it unpacks to, and whether that has happened.
    Bundled {
        /// Hermes's release.
        hermes: String,
        /// The interpreter's build.
        python: String,
        /// `<data>/runtime/<id>`.
        root: PathBuf,
        /// Unpacked and hash-checked.
        unpacked: bool,
    },
    /// The Hermes on this machine, by choice or because this build carries none.
    Existing {
        /// Whether the choice is the user's (`BOOPIS_HERMES` or the setting) rather than the build's.
        chosen: bool,
        /// Its home.
        home: PathBuf,
    },
    /// The bundled runtime cannot be used: the reason, as setup shows it.
    Broken(String),
}

/// Gather the facts with the host's own functions. Reads the machine; changes nothing.
#[must_use]
pub fn gather(resource_dir: Option<&Path>) -> Gathered {
    let startup = startup(false);
    let data = dirs::data_dir().map(|d| d.join(gpu::APP_IDENTIFIER));
    let source = runtime::Source::from_process();
    let (plan, error) = runtime::plan_for(
        source,
        resource_dir,
        data.clone().ok_or_else(|| "no data folder".to_owned()),
    );
    let environment = crate::hermes::Environment::from_process();
    let runtime_status = match (plan, error) {
        (_, Some(e)) => RuntimeStatus::Broken(e),
        (Some(plan), None) => {
            let layout = plan.runtime.layout(&plan.runtimes_dir());
            let m = plan.runtime.manifest();
            RuntimeStatus::Bundled {
                hermes: m.hermes_version.clone(),
                python: m.python_version.clone(),
                unpacked: plan.runtime.is_installed(&plan.runtimes_dir()),
                root: layout.root,
            }
        }
        (None, None) => RuntimeStatus::Existing {
            chosen: source == runtime::Source::Existing,
            home: environment.hermes_root(),
        },
    };
    let mut folders = Vec::new();
    if let Some(d) = &data {
        let mut add = |label: &'static str, p: PathBuf| {
            let exists = p.exists();
            folders.push((label, p, exists));
        };
        add("data", d.clone());
        if let RuntimeStatus::Bundled { .. } = runtime_status {
            add("runtime", d.join("runtime"));
            add("engine home", d.join(runtime::HOME_DIR));
        }
        add("settings", d.join("settings.json"));
    }
    if !matches!(runtime_status, RuntimeStatus::Bundled { .. }) {
        let home = environment.hermes_root();
        let exists = home.exists();
        folders.push(("engine home", home, exists));
    }
    if let Some(sockets) = crate::secrets::channel::default_socket_dir() {
        let exists = sockets.exists();
        folders.push(("sockets", sockets, exists));
    }
    let fps_policy = frame_rate::Policy::from_env();
    let mut report = startup.report;
    let platform_profile = frame_rate::read_platform_profile_blocking();
    report.frame_rate = frame_rate::Report {
        rule: Some(frame_rate::decide(fps_policy, None).rule),
        power_profile: platform_profile.as_deref().map_or(
            frame_rate::PowerProfile::Unknown,
            frame_rate::power_profile_of,
        ),
        platform_profile: platform_profile.clone(),
        ..frame_rate::Report::pending(fps_policy)
    };
    let last_webview = data
        .as_deref()
        .and_then(|d| crate::webview_health::read_run(&crate::webview_health::file_in(d)));
    Gathered {
        report,
        fps_policy,
        platform_profile,
        runtime: runtime_status,
        folders,
        last_webview,
    }
}

/// A serde unit variant's name (`auto`, `x11`), for the settings the report echoes.
fn name<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn vendor(g: &Gpu) -> String {
    match g.vendor.trim().to_ascii_lowercase().as_str() {
        "0x10de" => "nvidia".to_owned(),
        "0x8086" => "intel".to_owned(),
        "0x1002" => "amd".to_owned(),
        other => other.to_owned(),
    }
}

/// The renderer decision in a few words.
#[must_use]
pub fn renderer_short(rule: renderer::Rule) -> &'static str {
    use renderer::Rule as R;
    match rule {
        R::UserEnvironment => "left to your environment",
        R::PolicyDefault
        | R::NoNvidiaProprietary
        | R::NvidiaWaylandUntouched
        | R::NvidiaWaylandFixed
        | R::SessionUnknown => "default",
        R::PolicyShm | R::NvidiaX11 => "shared memory",
        R::PolicyCpu => "cpu",
        R::PolicyNosync => "no explicit sync",
        R::PolicySoftware => "software",
    }
}

fn renderer_long(rule: renderer::Rule) -> &'static str {
    use renderer::Rule as R;
    match rule {
        R::UserEnvironment => {
            "A WebKit or NVIDIA switch is already in the environment, so nothing is changed."
        }
        R::PolicyDefault => "BOOPIS_RENDERER=default: WebKitGTK's own choice.",
        R::PolicyShm => "BOOPIS_RENDERER=shm: GL kept, frames copied through shared memory.",
        R::PolicyCpu => "BOOPIS_RENDERER=cpu: the CPU paints every frame.",
        R::PolicyNosync => "BOOPIS_RENDERER=nosync: explicit sync off for NVIDIA.",
        R::PolicySoftware => "BOOPIS_RENDERER=software: no accelerated compositing.",
        R::NoNvidiaProprietary => {
            "The display GPU is not on the NVIDIA proprietary driver: WebKitGTK's own choice."
        }
        R::NvidiaX11 => {
            "NVIDIA proprietary driver on X11: shared-memory frames keep the GPU and avoid a blank window."
        }
        R::NvidiaWaylandUntouched => {
            "NVIDIA proprietary driver on Wayland, WebKitGTK before 2.54.2: left alone."
        }
        R::NvidiaWaylandFixed => {
            "NVIDIA proprietary driver on Wayland, WebKitGTK 2.54.2 or later: fixed upstream, nothing set."
        }
        R::SessionUnknown => "The session type could not be told, so nothing is assumed.",
    }
}

fn gpu_long(rule: gpu::Rule) -> &'static str {
    use gpu::Rule as R;
    match rule {
        R::UserEnvironment => "A GPU-selecting variable is already set, so nothing is changed.",
        R::PolicyIntegrated => "integrated: the system's own choice.",
        R::PolicyDedicated => "dedicated: rendering is offloaded to the NVIDIA GPU.",
        R::PolicyDedicatedNoGpu => {
            "dedicated, but no NVIDIA GPU with a loaded proprietary driver was found."
        }
        R::AutoDedicated => {
            "auto: the dedicated GPU (on AC power, NVIDIA driver loaded, WebKitGTK 2.54.2 or later)."
        }
        R::AutoOnBattery => "auto: the integrated GPU, because the machine is on battery.",
        R::AutoPowerUnknown => {
            "auto: the integrated GPU, because the power source could not be told."
        }
        R::AutoNoDedicatedGpu => {
            "auto: there is no separate NVIDIA GPU with a loaded driver to choose."
        }
        R::AutoWebkitTooOld => {
            "auto: the integrated GPU, because WebKitGTK is older than 2.54.2 or unknown."
        }
        R::AutoSessionUnknown => "auto: the session type could not be told, so nothing is assumed.",
        R::DisplayIsDedicated => "The display GPU already is the NVIDIA GPU: nothing to offload.",
    }
}

fn session_name(s: Session) -> &'static str {
    match s {
        Session::Wayland => "wayland",
        Session::X11 => "x11",
        Session::Unknown => "unknown",
    }
}

fn fps_long(policy: frame_rate::Policy) -> &'static str {
    use frame_rate::Policy as P;
    match policy {
        P::Auto => {
            "auto: WebKit's 60 fps cap is lifted on a display faster than 60 Hz (read when the window opens)."
        }
        P::Sixty => "60: WebKit's own default, the cap stays.",
        P::Max => "max: the cap is always lifted, motion follows the display.",
    }
}

fn gpu_label(g: &Gpu) -> String {
    format!(
        "{}  {} {}{}",
        g.card,
        vendor(g),
        g.driver.as_deref().unwrap_or("no driver"),
        if g.boot_display { "  display" } else { "" }
    )
}

/// The lines of `doctor`.
#[must_use]
#[allow(clippy::too_many_lines)] // one report, section after section
pub fn doctor_lines(out: &Out, version: &str, gathered: &Gathered) -> Vec<String> {
    let report = &gathered.report;
    let mut lines = vec![format!(
        "{} doctor {}",
        out.logo(),
        out.ink.paint(Tone::Dim, version)
    )];

    lines.extend(out.heading("session"));
    let session_mark = if report.session == Session::Unknown {
        Mark::Warn
    } else {
        Mark::Ok
    };
    lines.push(out.row(
        Some(session_mark),
        "type",
        &format!(
            "{}{}",
            session_name(report.session),
            if report.hyprland { " (hyprland)" } else { "" }
        ),
    ));

    lines.extend(out.heading("gpus"));
    if report.gpus.is_empty() {
        lines.push(out.row(
            Some(Mark::Warn),
            "none found",
            "nothing under /sys/class/drm",
        ));
    }
    for gpu in &report.gpus {
        lines.push(out.row(None, "", &gpu_label(gpu)));
    }

    lines.extend(out.heading("renderer"));
    lines.push(out.row(
        None,
        "setting",
        &format!("BOOPIS_RENDERER={}", name(&report.policy)),
    ));
    lines.push(out.row(None, "decision", renderer_short(report.rule)));
    lines.push(out.note(renderer_long(report.rule)));
    let sets = if report.set.is_empty() {
        "nothing".to_owned()
    } else {
        report
            .set
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    lines.push(out.row(None, "sets", &sets));
    for (k, v) in &report.environment {
        lines.push(out.row(None, "", &format!("{k}={v}")));
    }
    if let Some(note) = &report.note {
        lines.push(out.row(Some(Mark::Warn), "note", note));
    }

    lines.extend(out.heading("gpu"));
    let gpu_report = &report.gpu;
    lines.push(out.row(
        None,
        "setting",
        &format!(
            "BOOPIS_GPU={} ({})",
            name(&gpu_report.policy),
            name(&gpu_report.policy_source)
        ),
    ));
    lines.push(out.row(
        None,
        "decision",
        if gpu_report.set.is_empty() {
            "integrated"
        } else {
            "dedicated"
        },
    ));
    lines.push(out.note(gpu_long(gpu_report.rule)));
    if let Some(d) = &gpu_report.display_gpu {
        lines.push(out.row(None, "display gpu", d));
    }
    if let Some(d) = &gpu_report.dedicated_gpu {
        lines.push(out.row(None, "dedicated", d));
    }
    lines.push(out.row(None, "power", &name(&gpu_report.power)));
    if gpu_report.warning.is_some() {
        lines.push(out.row(
            Some(Mark::Warn),
            "warning",
            "dedicated on Wayland with a WebKitGTK before 2.54.2 may close the window or leave it blank",
        ));
    }
    if let Some(s) = gpu_report.restart_advice {
        let to = match s {
            gpu::Switch::ToDedicated => "the dedicated GPU",
            gpu::Switch::ToIntegrated => "the integrated GPU",
        };
        lines.push(out.row(
            Some(Mark::Warn),
            "advice",
            &format!("a restart would move rendering to {to}"),
        ));
    }

    lines.extend(out.heading("frame rate"));
    lines.push(out.row(
        None,
        "setting",
        &format!("BOOPIS_FPS={}", name(&gathered.fps_policy)),
    ));
    lines.push(out.note(fps_long(gathered.fps_policy)));
    let profile = gathered
        .platform_profile
        .as_deref()
        .unwrap_or("not exposed by this machine");
    let profile_mark = (report.frame_rate.power_profile == frame_rate::PowerProfile::PowerSaver)
        .then_some(Mark::Warn);
    lines.push(out.row(profile_mark, "profile", profile));
    if profile_mark.is_some() {
        lines.push(out.note("power-saver halves WebKit's animation rate."));
    }

    lines.extend(out.heading("webkitgtk"));
    let webkit_report = &report.webkit;
    match &webkit_report.version {
        Some(v) => lines.push(out.row(
            Some(Mark::Ok),
            "version",
            &format!("{v}, {}", webkit_origin(webkit_report.origin)),
        )),
        None => lines.push(out.row(
            Some(Mark::Warn),
            "version",
            "unknown (the library could not be asked)",
        )),
    }
    if let Some(p) = &webkit_report.library {
        lines.push(out.row(None, "library", p));
    }

    lines.extend(out.heading("runtime"));
    match &gathered.runtime {
        RuntimeStatus::Bundled {
            hermes: engine,
            python,
            root,
            unpacked,
        } => {
            lines.push(out.row(
                None,
                "engine",
                &format!("{engine}, bundled (python {python})"),
            ));
            if *unpacked {
                lines.push(out.row(Some(Mark::Ok), "status", "unpacked and checked"));
            } else {
                lines.push(out.row(
                    Some(Mark::Warn),
                    "status",
                    "not unpacked yet: the first start does it",
                ));
            }
            lines.push(out.row(None, "folder", &path_for_display(root)));
        }
        RuntimeStatus::Existing { chosen, home } => {
            let why = if *chosen {
                "you chose it (--engine existing)"
            } else {
                "this build carries none"
            };
            lines.push(out.row(
                None,
                "engine",
                &format!("the one on this machine, because {why}"),
            ));
            lines.push(out.row(None, "home", &path_for_display(home)));
        }
        RuntimeStatus::Broken(e) => {
            // boopis never names its engine: a reason that does is said in the catalog's words (ADR-0031).
            let shown = if crate::error::names_engine(e) {
                crate::error::sentence("hx.setup.runtime_corrupt")
            } else {
                e.clone()
            };
            lines.push(out.row(Some(Mark::Fail), "status", &shown));
            lines.push(out.note("Reinstall boopis to restore the runtime."));
        }
    }

    // What the web view went through the last time the app ran (webview_health.rs): the record a grey or frozen window
    // leaves, written as it happens, so a run that had to be killed still says what it saw.
    lines.extend(out.heading("window (last run)"));
    match &gathered.last_webview {
        Some(run) => {
            let bad = run.recoveries > 0
                || run
                    .events
                    .iter()
                    .any(|e| e.kind == "terminated" || e.kind == "unresponsive");
            for (i, l) in crate::webview_health::doctor_lines(run)
                .into_iter()
                .enumerate()
            {
                if i == 0 {
                    lines.push(out.row(
                        Some(if bad { Mark::Warn } else { Mark::Ok }),
                        "record",
                        &l,
                    ));
                } else {
                    lines.push(out.note(l.trim_start()));
                }
            }
        }
        None => lines.push(out.row(
            None,
            "record",
            "none yet (the app keeps one once its window has opened)",
        )),
    }

    lines.extend(out.heading("folders"));
    for (label, path, exists) in &gathered.folders {
        let shown = path_for_display(path);
        if *exists {
            lines.push(out.row(Some(Mark::Ok), label, &shown));
        } else {
            lines.push(out.row(None, label, &format!("{shown} (not created yet)")));
        }
    }
    lines
}

/// `~` for the home folder, so lines stay short and a pasted report names no user.
fn path_for_display(p: &Path) -> String {
    match dirs::home_dir() {
        Some(h) => p.strip_prefix(&h).map_or_else(
            |_| p.display().to_string(),
            |rest| format!("~/{}", rest.display()),
        ),
        None => p.display().to_string(),
    }
}

/// A colourless writer for tests: the same lines without escape codes.
#[must_use]
pub fn plain() -> Out {
    Out::new(Caps {
        color: ColorLevel::None,
        unicode: true,
        interactive: true,
        animate: false,
    })
}

#[cfg(test)]
mod tests;
