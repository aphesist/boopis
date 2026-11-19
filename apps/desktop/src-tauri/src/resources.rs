//! Where the files the app carries are: the plugin, the Hermes runtime and `hx`.
//!
//! Tauri looks in `<exe dir>/../lib/<productName>` and then in `/usr/lib/<productName>`; inside an `AppImage` that is the
//! mounted image, and the bundler put the files there. A native package (`packaging/arch`) names its directory after the
//! binary it installs, because the product's name is not a path it can rely on (it changes with the rename). So when
//! Tauri's directory carries none of the app's files, the one named after the running executable is tried: a binary at
//! `/usr/bin/boopis` finds `/usr/lib/boopis`. Nothing else changes: a build that finds neither keeps Tauri's answer.

use std::path::{Path, PathBuf};

/// Whether `dir` looks like the app's resource directory: it carries the plugin or the runtime.
fn carries_the_app(dir: &Path) -> bool {
    dir.join("plugin").is_dir() || dir.join("runtime").is_dir()
}

/// The directory the running executable's own name points at under the prefix's `lib`: `<exe dir>/../lib/<exe name>`.
fn beside_the_executable(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?.join("../lib").join(exe.file_name()?);
    dir.canonicalize().ok()
}

/// The resource directory: Tauri's own when it carries the app, else the one named after the running executable, else
/// Tauri's again (what a debug or source build has, and what the code that reads it already handles).
#[must_use]
pub fn locate(tauri_dir: Option<&Path>, exe: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = tauri_dir.filter(|d| carries_the_app(d)) {
        return Some(dir.to_path_buf());
    }
    exe.and_then(beside_the_executable)
        .filter(|d| carries_the_app(d))
        .or_else(|| tauri_dir.map(Path::to_path_buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A prefix with `bin/<exe>` and, when given, a `lib/<lib>/runtime` directory.
    fn prefix(exe: &str, lib: Option<&str>) -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("bin")).unwrap();
        let exe_path = tmp.path().join("bin").join(exe);
        std::fs::write(&exe_path, "x").unwrap();
        if let Some(lib) = lib {
            std::fs::create_dir_all(tmp.path().join("lib").join(lib).join("runtime")).unwrap();
        }
        (tmp, exe_path)
    }

    #[test]
    fn a_native_package_is_found_by_the_installed_binary_name() {
        let (tmp, exe) = prefix("boopis", Some("boopis"));
        // Tauri looks for the product's name, which is not what the package named its directory.
        let tauri = tmp.path().join("lib").join("OtherName");
        let found = locate(Some(&tauri), Some(&exe)).unwrap();
        assert_eq!(
            found,
            tmp.path()
                .join("lib")
                .join("boopis")
                .canonicalize()
                .unwrap()
        );
    }

    #[test]
    fn tauri_wins_when_its_directory_carries_the_app() {
        let (tmp, exe) = prefix("boopis", Some("boopis"));
        let tauri = tmp.path().join("appimage");
        std::fs::create_dir_all(tauri.join("plugin")).unwrap();
        assert_eq!(locate(Some(&tauri), Some(&exe)).unwrap(), tauri);
    }

    #[test]
    fn a_build_that_finds_nothing_keeps_tauris_answer() {
        let (tmp, exe) = prefix("boopis", None);
        let tauri = tmp.path().join("lib").join("OtherName");
        assert_eq!(locate(Some(&tauri), Some(&exe)).unwrap(), tauri);
        assert_eq!(locate(None, Some(&exe)), None);
        assert_eq!(locate(Some(&tauri), None).unwrap(), tauri);
    }

    #[test]
    fn a_directory_without_the_app_is_not_taken() {
        let (tmp, exe) = prefix("boopis", None);
        std::fs::create_dir_all(tmp.path().join("lib").join("boopis")).unwrap();
        let tauri = tmp.path().join("lib").join("OtherName");
        assert_eq!(locate(Some(&tauri), Some(&exe)).unwrap(), tauri);
    }
}
