//! The window: which desktop the app runs on (so the title bar draws only the controls that mean something there), the
//! window's state, and what the user attaches to a message (picked in the native dialog or dropped on the window).
//!
//! The detection is pure: it reads the environment and the process names through two closures, so the table is tested
//! without a desktop. The Tauri calls (`window_control`, `pick_attachments`, the drag events) are in `commands.rs` and
//! `lib.rs`.

use std::path::Path;

use serde::Serialize;
use specta::Type;

/// The operating system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    /// Linux and the other Unix desktops.
    Linux,
    /// Windows.
    Windows,
    /// macOS.
    Macos,
    /// Anything else.
    Other,
}

impl Platform {
    /// The platform this build runs on.
    #[must_use]
    pub fn current() -> Self {
        Self::from_os(std::env::consts::OS)
    }

    /// Read `std::env::consts::OS`.
    #[must_use]
    pub fn from_os(os: &str) -> Self {
        match os {
            "linux" | "freebsd" | "openbsd" | "netbsd" | "dragonfly" => Self::Linux,
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            _ => Self::Other,
        }
    }
}

/// What kind of window manager the desktop has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DesktopKind {
    /// A tiling window manager: windows are placed by the manager, minimise and maximise mean nothing.
    Tiling,
    /// A floating desktop (GNOME, KDE, Windows, ...): windows minimise, maximise and close.
    Floating,
    /// Nothing recognised.
    Unknown,
}

/// What the host found out about the desktop, once at start.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Detected {
    /// The operating system.
    pub platform: Platform,
    /// The kind of window manager.
    pub kind: DesktopKind,
    /// The desktop or window manager by name, when known (`Hyprland`, `GNOME`).
    pub desktop: Option<String>,
    /// What told us (`SWAYSOCK`, `XDG_CURRENT_DESKTOP`, a process name, the platform), for Diagnostics.
    pub evidence: String,
}

impl Detected {
    /// Whether the window manager tiles windows.
    #[must_use]
    pub fn tiling(&self) -> bool {
        self.kind == DesktopKind::Tiling
    }
}

/// A tiling window manager: the lowercase word its session names use, and how to show it.
const TILING: &[(&str, &str)] = &[
    ("hyprland", "Hyprland"),
    ("sway", "sway"),
    ("swayfx", "sway"),
    ("i3", "i3"),
    ("river", "river"),
    ("niri", "niri"),
    ("bspwm", "bspwm"),
    ("dwm", "dwm"),
    ("dwl", "dwl"),
    ("awesome", "awesome"),
    ("qtile", "qtile"),
    ("xmonad", "xmonad"),
    ("herbstluftwm", "herbstluftwm"),
    ("leftwm", "LeftWM"),
    ("spectrwm", "spectrwm"),
    ("stumpwm", "StumpWM"),
    ("ratpoison", "ratpoison"),
    ("exwm", "EXWM"),
    ("miracle", "Miracle"),
    ("mango", "mango"),
    ("scroll", "scroll"),
];

/// A floating desktop: the lowercase word its session names use, and how to show it.
const FLOATING: &[(&str, &str)] = &[
    ("gnome", "GNOME"),
    ("kde", "KDE"),
    ("plasma", "KDE"),
    ("xfce", "Xfce"),
    ("cinnamon", "Cinnamon"),
    ("x-cinnamon", "Cinnamon"),
    ("mate", "MATE"),
    ("lxqt", "LXQt"),
    ("lxde", "LXDE"),
    ("budgie", "Budgie"),
    ("pantheon", "Pantheon"),
    ("cosmic", "COSMIC"),
    ("unity", "Unity"),
    ("deepin", "Deepin"),
    ("ukui", "UKUI"),
    ("enlightenment", "Enlightenment"),
    ("openbox", "Openbox"),
    ("fluxbox", "Fluxbox"),
    ("icewm", "IceWM"),
    ("wayfire", "Wayfire"),
    ("labwc", "labwc"),
];

/// The process names of the tiling managers an X session with no desktop variables runs (`startx` sets none). Matched
/// as a prefix so `xmonad-x86_64-linux` is xmonad.
const TILING_PROCESSES: &[(&str, &str)] = &[
    ("bspwm", "bspwm"),
    ("dwm", "dwm"),
    ("awesome", "awesome"),
    ("qtile", "qtile"),
    ("xmonad", "xmonad"),
    ("herbstluftwm", "herbstluftwm"),
    ("leftwm", "LeftWM"),
    ("spectrwm", "spectrwm"),
    ("i3", "i3"),
    ("stumpwm", "StumpWM"),
    ("ratpoison", "ratpoison"),
];

/// The variables a compositor sets for its own clients, strongest first. sway also sets `I3SOCK`, so it is asked first.
const SOCKETS: &[(&str, &str)] = &[
    ("HYPRLAND_INSTANCE_SIGNATURE", "Hyprland"),
    ("SWAYSOCK", "sway"),
    ("NIRI_SOCKET", "niri"),
    ("I3SOCK", "i3"),
];

/// The variables that name the session's desktop, in the order they are asked.
const NAMES: &[&str] = &[
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "DESKTOP_SESSION",
];

fn found(platform: Platform, kind: DesktopKind, desktop: &str, evidence: &str) -> Detected {
    Detected {
        platform,
        kind,
        desktop: Some(desktop.to_owned()),
        evidence: evidence.to_owned(),
    }
}

/// The words of a session name: `none+i3` is `none` and `i3`, `GNOME:Unity` is `gnome` and `unity`, `i3-with-shmlog` is
/// `i3`, `with` and `shmlog`. A hyphen is kept in the joined form too, for names such as `x-cinnamon`.
fn words(value: &str) -> Vec<String> {
    let lower = value.to_ascii_lowercase();
    let mut out: Vec<String> = lower
        .split([':', '+', ' ', ';', ',', '/'])
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    let parts: Vec<String> = out
        .iter()
        .filter(|w| w.contains('-'))
        .flat_map(|w| w.split('-').map(str::to_owned).collect::<Vec<_>>())
        .filter(|w| !w.is_empty())
        .collect();
    out.extend(parts);
    out
}

fn lookup<'a>(table: &'a [(&str, &str)], words: &[String]) -> Option<&'a str> {
    words
        .iter()
        .find_map(|w| table.iter().find(|(k, _)| *k == w).map(|(_, shown)| *shown))
}

/// Decide the desktop from the environment (`var`) and the names of the running processes (`processes`, read only when
/// the environment does not say). Never fails: what it cannot tell stays `Unknown`.
#[must_use]
pub fn detect(
    platform: Platform,
    var: &dyn Fn(&str) -> Option<String>,
    processes: &dyn Fn() -> Vec<String>,
) -> Detected {
    match platform {
        Platform::Windows => {
            return found(platform, DesktopKind::Floating, "Windows", "platform");
        }
        Platform::Macos => return found(platform, DesktopKind::Floating, "macOS", "platform"),
        Platform::Other => {
            return Detected {
                platform,
                kind: DesktopKind::Unknown,
                desktop: None,
                evidence: "platform".into(),
            };
        }
        Platform::Linux => {}
    }
    let set = |k: &str| var(k).filter(|v| !v.trim().is_empty());
    // 1. The compositor's own variables: it is running, whatever the session's name says.
    for (key, shown) in SOCKETS {
        if set(key).is_some() {
            return found(platform, DesktopKind::Tiling, shown, key);
        }
    }
    // 2. The session's names. A tiling manager anywhere in them wins (`GNOME` with `i3` is i3 on GNOME's session).
    let named: Vec<(&str, Vec<String>)> = NAMES
        .iter()
        .filter_map(|k| set(k).map(|v| (*k, words(&v))))
        .collect();
    for (key, w) in &named {
        if let Some(shown) = lookup(TILING, w) {
            return found(platform, DesktopKind::Tiling, shown, key);
        }
    }
    for (key, w) in &named {
        if let Some(shown) = lookup(FLOATING, w) {
            return found(platform, DesktopKind::Floating, shown, key);
        }
    }
    // 3. A bare X session (`startx`) sets none of it: look at what is running.
    let running = processes();
    for comm in &running {
        let lower = comm.to_ascii_lowercase();
        if let Some((_, shown)) = TILING_PROCESSES.iter().find(|(k, _)| {
            lower == *k || lower.strip_prefix(*k).is_some_and(|r| r.starts_with('-'))
        }) {
            return found(platform, DesktopKind::Tiling, shown, "a running process");
        }
    }
    Detected {
        platform,
        kind: DesktopKind::Unknown,
        desktop: named
            .first()
            .map(|(_, w)| w.join(" "))
            .filter(|s| !s.is_empty()),
        evidence: "nothing recognised".into(),
    }
}

/// The names of this user's running processes (`/proc/*/comm`); empty where there is no `/proc`.
#[must_use]
pub fn running_process_names() -> Vec<String> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.filter_map(Result::ok)
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()))
        })
        .filter_map(|e| std::fs::read_to_string(e.path().join("comm")).ok())
        .map(|s| s.trim().to_owned())
        .collect()
}

/// Detect this machine's desktop, with the real environment and `/proc`.
#[must_use]
pub fn detect_here() -> Detected {
    detect(
        Platform::current(),
        &|k| std::env::var(k).ok(),
        &running_process_names,
    )
}

// ───────── what the user attaches ─────────

/// What an attached path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    /// A file the model reads as text or through a tool.
    File,
    /// A picture the model sees.
    Image,
    /// A folder added to the context.
    Folder,
}

/// One attached path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Attachment {
    /// The absolute path on this machine.
    pub path: String,
    /// The last component, for the chip.
    pub name: String,
    /// File, image or folder.
    pub kind: AttachmentKind,
    /// The size of a file in bytes; unknown for a folder.
    pub bytes: Option<u32>,
}

/// The most paths one pick or drop attaches.
pub const MAX_ATTACHMENTS: usize = 64;

/// The picture formats the engine's image attach takes.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// Describe a path the user picked or dropped; `None` when it is not there any more or is neither a file nor a folder.
#[must_use]
pub fn describe(path: &Path) -> Option<Attachment> {
    let meta = std::fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let (kind, bytes) = if meta.is_dir() {
        (AttachmentKind::Folder, None)
    } else if meta.is_file() {
        let image = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
        (
            if image {
                AttachmentKind::Image
            } else {
                AttachmentKind::File
            },
            Some(u32::try_from(meta.len()).unwrap_or(u32::MAX)),
        )
    } else {
        return None;
    };
    Some(Attachment {
        path: path.to_string_lossy().into_owned(),
        name,
        kind,
        bytes,
    })
}

/// Describe a list of paths, in order, dropping what is gone and keeping at most [`MAX_ATTACHMENTS`].
#[must_use]
pub fn describe_all<'a>(paths: impl IntoIterator<Item = &'a Path>) -> Vec<Attachment> {
    paths
        .into_iter()
        .filter_map(describe)
        .take(MAX_ATTACHMENTS)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn linux(vars: &[(&str, &str)], procs: &[&str]) -> Detected {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        let procs: Vec<String> = procs.iter().map(|s| (*s).to_owned()).collect();
        detect(Platform::Linux, &|k| map.get(k).cloned(), &|| procs.clone())
    }

    fn tiling(d: &Detected) -> Option<&str> {
        d.tiling().then(|| d.desktop.as_deref().unwrap_or(""))
    }

    #[test]
    fn the_compositors_own_variables_decide() {
        assert_eq!(
            tiling(&linux(&[("HYPRLAND_INSTANCE_SIGNATURE", "abc")], &[])),
            Some("Hyprland")
        );
        assert_eq!(
            tiling(&linux(&[("SWAYSOCK", "/run/user/1000/sway-ipc.sock")], &[])),
            Some("sway")
        );
        assert_eq!(
            tiling(&linux(&[("NIRI_SOCKET", "/run/user/1000/niri.sock")], &[])),
            Some("niri")
        );
        assert_eq!(
            tiling(&linux(&[("I3SOCK", "/run/user/1000/i3/ipc.sock")], &[])),
            Some("i3")
        );
    }

    #[test]
    fn sway_is_not_taken_for_i3_though_it_sets_both() {
        let d = linux(&[("I3SOCK", "/x"), ("SWAYSOCK", "/y")], &[]);
        assert_eq!(d.desktop.as_deref(), Some("sway"));
        assert_eq!(d.evidence, "SWAYSOCK");
    }

    #[test]
    fn a_socket_beats_a_floating_session_name() {
        let d = linux(
            &[
                ("XDG_CURRENT_DESKTOP", "GNOME"),
                ("HYPRLAND_INSTANCE_SIGNATURE", "abc"),
            ],
            &[],
        );
        assert!(d.tiling());
    }

    #[test]
    fn every_listed_tiling_manager_is_found_by_its_session_name() {
        for name in [
            "Hyprland",
            "sway",
            "i3",
            "river",
            "niri",
            "bspwm",
            "dwm",
            "awesome",
            "qtile",
            "xmonad",
            "herbstluftwm",
            "leftwm",
            "dwl",
            "spectrwm",
            "stumpwm",
            "ratpoison",
        ] {
            for key in [
                "XDG_CURRENT_DESKTOP",
                "XDG_SESSION_DESKTOP",
                "DESKTOP_SESSION",
            ] {
                let d = linux(&[(key, name)], &[]);
                assert!(d.tiling(), "{name} in {key}");
                assert_eq!(d.evidence, key);
            }
        }
    }

    #[test]
    fn display_manager_session_names_are_read() {
        // lightdm: `none+i3`; gdm and sddm: `i3-with-shmlog`, `sway`, `bspwm`; a colon list from the desktop entry
        assert!(linux(&[("DESKTOP_SESSION", "none+i3")], &[]).tiling());
        assert!(linux(&[("DESKTOP_SESSION", "i3-with-shmlog")], &[]).tiling());
        assert!(linux(&[("XDG_CURRENT_DESKTOP", "X-Generic:bspwm")], &[]).tiling());
        assert!(linux(&[("XDG_CURRENT_DESKTOP", "river")], &[]).tiling());
        assert!(linux(&[("DESKTOP_SESSION", "none+awesome")], &[]).tiling());
    }

    #[test]
    fn a_tiling_manager_wins_over_the_desktop_it_runs_on() {
        // GNOME Flashback with i3: the session says GNOME, the window manager is i3
        let d = linux(
            &[
                ("XDG_CURRENT_DESKTOP", "GNOME-Flashback:GNOME"),
                ("DESKTOP_SESSION", "gnome-flashback-i3"),
            ],
            &[],
        );
        assert_eq!(tiling(&d), Some("i3"));
    }

    #[test]
    fn floating_desktops_are_floating() {
        for (value, shown) in [
            ("GNOME", "GNOME"),
            ("ubuntu:GNOME", "GNOME"),
            ("KDE", "KDE"),
            ("X-Cinnamon", "Cinnamon"),
            ("XFCE", "Xfce"),
            ("MATE", "MATE"),
            ("LXQt", "LXQt"),
            ("Budgie:GNOME", "Budgie"),
            ("COSMIC", "COSMIC"),
            ("Pantheon", "Pantheon"),
        ] {
            let d = linux(&[("XDG_CURRENT_DESKTOP", value)], &[]);
            assert_eq!(d.kind, DesktopKind::Floating, "{value}");
            assert_eq!(d.desktop.as_deref(), Some(shown), "{value}");
        }
    }

    #[test]
    fn a_bare_x_session_is_found_by_its_running_manager() {
        assert_eq!(
            tiling(&linux(&[], &["systemd", "Xorg", "bspwm", "sxhkd"])),
            Some("bspwm")
        );
        assert_eq!(tiling(&linux(&[], &["dwm"])), Some("dwm"));
        assert_eq!(tiling(&linux(&[], &["xmonad-x86_64-"])), Some("xmonad"));
        assert_eq!(tiling(&linux(&[], &["awesome", "picom"])), Some("awesome"));
        assert_eq!(tiling(&linux(&[], &["qtile"])), Some("qtile"));
        assert_eq!(tiling(&linux(&[], &["herbstluftwm"])), Some("herbstluftwm"));
        assert_eq!(tiling(&linux(&[], &["leftwm"])), Some("LeftWM"));
    }

    #[test]
    fn a_process_that_only_starts_like_one_is_not_one() {
        assert!(
            !linux(
                &[],
                &["dwmblocks", "awesomewm-helper", "i3status", "i3blocks"]
            )
            .tiling()
        );
    }

    #[test]
    fn nothing_recognised_is_unknown_and_not_tiling() {
        let d = linux(&[], &["systemd", "bash"]);
        assert_eq!(d.kind, DesktopKind::Unknown);
        assert!(!d.tiling());
        let odd = linux(&[("XDG_CURRENT_DESKTOP", "SomethingNew")], &[]);
        assert_eq!(odd.kind, DesktopKind::Unknown);
        assert_eq!(odd.desktop.as_deref(), Some("somethingnew"));
    }

    #[test]
    fn empty_variables_say_nothing() {
        assert_eq!(
            linux(&[("SWAYSOCK", " "), ("XDG_CURRENT_DESKTOP", "")], &[]).kind,
            DesktopKind::Unknown
        );
    }

    #[test]
    fn windows_and_macos_are_floating_whatever_the_environment_holds() {
        let sway = |k: &str| (k == "SWAYSOCK").then(|| "/x".to_owned());
        let w = detect(Platform::Windows, &sway, &Vec::new);
        assert_eq!(
            (w.kind, w.desktop.as_deref()),
            (DesktopKind::Floating, Some("Windows"))
        );
        let m = detect(Platform::Macos, &sway, &Vec::new);
        assert_eq!(
            (m.kind, m.platform),
            (DesktopKind::Floating, Platform::Macos)
        );
        assert_eq!(
            detect(Platform::Other, &|_| None, &Vec::new).kind,
            DesktopKind::Unknown
        );
    }

    #[test]
    fn the_platform_is_read_from_the_os_name() {
        assert_eq!(Platform::from_os("linux"), Platform::Linux);
        assert_eq!(Platform::from_os("freebsd"), Platform::Linux);
        assert_eq!(Platform::from_os("windows"), Platform::Windows);
        assert_eq!(Platform::from_os("macos"), Platform::Macos);
        assert_eq!(Platform::from_os("ios"), Platform::Other);
    }

    #[test]
    fn attachments_are_described_by_what_is_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("notes.md");
        let image = dir.path().join("shot.PNG");
        let sub = dir.path().join("src");
        std::fs::write(&text, "hello").unwrap();
        std::fs::write(&image, [0u8; 3]).unwrap();
        std::fs::create_dir(&sub).unwrap();
        let gone = dir.path().join("gone.txt");
        let all = describe_all([
            text.as_path(),
            image.as_path(),
            sub.as_path(),
            gone.as_path(),
        ]);
        let kinds: Vec<_> = all
            .iter()
            .map(|a| (a.name.as_str(), a.kind, a.bytes))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("notes.md", AttachmentKind::File, Some(5)),
                ("shot.PNG", AttachmentKind::Image, Some(3)),
                ("src", AttachmentKind::Folder, None),
            ]
        );
        assert!(all[0].path.ends_with("notes.md") && Path::new(&all[0].path).is_absolute());
    }

    /// The window is undecorated, so the UI's title bars are its only chrome. Their drag region (`data-tauri-drag-region`)
    /// calls Tauri's `start_dragging` on a press and `internal_toggle_maximize` on a double click; without both permissions
    /// the window neither moves nor maximises from its bar. Windows needs the shadow and a resizable window for its edges to
    /// resize (the invisible frame left, right and below, Tauri's own strip at the top) and for Snap.
    #[test]
    fn the_undecorated_window_keeps_what_a_normal_window_does() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let perms: Vec<&str> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect();
        for want in [
            "core:window:allow-start-dragging",
            "core:window:allow-internal-toggle-maximize",
            "allow-window-facts",
            "allow-window-control",
        ] {
            assert!(perms.contains(&want), "the main window lacks {want}");
        }
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &conf["app"]["windows"][0];
        assert_eq!(main["label"], "main");
        assert_eq!(main["decorations"], false);
        assert_eq!(main["shadow"], true);
        assert_eq!(main["resizable"], true);
    }

    #[test]
    fn a_drop_of_a_thousand_paths_attaches_the_first_sixty_four() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<_> = (0..100)
            .map(|i| {
                let p = dir.path().join(format!("f{i}"));
                std::fs::write(&p, "x").unwrap();
                p
            })
            .collect();
        let all = describe_all(paths.iter().map(std::path::PathBuf::as_path));
        assert_eq!(all.len(), MAX_ATTACHMENTS);
        assert_eq!(all[0].name, "f0");
    }
}
