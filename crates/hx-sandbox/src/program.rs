//! Finding the program to run, against the *child's* `PATH` and nothing else.
//!
//! The host's own `PATH`, current directory and shell are never consulted: the sandbox would
//! otherwise run whatever the host happens to resolve. A bare name is searched only in the
//! absolute directories of the child's `PATH`.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::normalize::ResolvedPolicy;

fn env_path(policy: &ResolvedPolicy) -> Option<&OsString> {
    policy
        .env
        .iter()
        .find(|(name, _)| {
            if cfg!(windows) {
                name.to_string_lossy().eq_ignore_ascii_case("PATH")
            } else {
                name == "PATH"
            }
        })
        .map(|(_, value)| value)
}

#[cfg(unix)]
fn is_runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_runnable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file())
}

/// Extensions tried for a bare name on Windows. Only real executables: `.bat` and `.cmd` need
/// `cmd.exe`, whose argument parsing makes injection from untrusted arguments easy.
#[cfg(windows)]
const WINDOWS_EXTENSIONS: &[&str] = &["exe", "com"];

fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        if Path::new(name).extension().is_some() {
            return vec![dir.join(name)];
        }
        WINDOWS_EXTENSIONS
            .iter()
            .map(|ext| dir.join(format!("{name}.{ext}")))
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![dir.join(name)]
    }
}

/// Resolves `argv0` to an absolute path, or says why it cannot be run.
pub(crate) fn resolve(argv0: &str, policy: &ResolvedPolicy) -> Result<PathBuf, String> {
    if argv0.is_empty() || argv0.contains('\0') {
        return Err("argv[0] is empty or contains NUL".to_owned());
    }
    let given = Path::new(argv0);
    if given.is_absolute() || given.components().count() > 1 {
        let abs = if given.is_absolute() {
            given.to_path_buf()
        } else {
            policy.cwd.join(given)
        };
        let found = candidates(
            abs.parent().unwrap_or(&abs),
            &abs.file_name()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
        )
        .into_iter()
        .find(|c| is_runnable(c));
        return found
            .ok_or_else(|| format!("{} does not exist or is not executable", abs.display()));
    }
    let Some(path_var) = env_path(policy) else {
        return Err(format!(
            "{argv0} is not a path and the child environment has no PATH; add PATH to env_allowlist or use an absolute path"
        ));
    };
    for dir in std::env::split_paths(path_var) {
        // An empty entry would mean "the current directory"; relative entries depend on the host.
        if !dir.is_absolute() {
            continue;
        }
        if let Some(found) = candidates(&dir, argv0).into_iter().find(|c| is_runnable(c)) {
            return Ok(found);
        }
    }
    Err(format!("{argv0} was not found in the child's PATH"))
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;
    use crate::policy::{Degraded, NetworkPolicy};
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    fn policy(cwd: &Path, path: Option<&str>) -> ResolvedPolicy {
        ResolvedPolicy {
            ro: vec![],
            rw: vec![],
            network: NetworkPolicy::Off,
            env: path
                .map(|p| vec![(OsString::from("PATH"), OsString::from(p))])
                .unwrap_or_default(),
            cwd: cwd.to_path_buf(),
            timeout: Duration::from_secs(1),
            output_cap: 1,
            kill_grace: Duration::ZERO,
            degraded: Degraded::default(),
            resources: crate::normalize::ResolvedLimits::default(),
        }
    }

    fn make_exe(path: &Path) {
        std::fs::write(path, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn bare_names_use_only_the_childs_absolute_path_entries() {
        let t = tempfile::tempdir().unwrap();
        let bin = t.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        make_exe(&bin.join("tool"));
        let p = policy(t.path(), Some(&format!(":relative:{}", bin.display())));
        assert_eq!(resolve("tool", &p).unwrap(), bin.join("tool"));
        assert!(resolve("nope", &p).unwrap_err().contains("not found"));
    }

    #[test]
    fn no_path_means_no_search() {
        let t = tempfile::tempdir().unwrap();
        make_exe(&t.path().join("tool"));
        let p = policy(t.path(), None);
        assert!(resolve("tool", &p).unwrap_err().contains("no PATH"));
    }

    #[test]
    fn relative_paths_resolve_against_the_policy_cwd() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir(t.path().join("sub")).unwrap();
        make_exe(&t.path().join("sub/tool"));
        let p = policy(t.path(), None);
        assert_eq!(resolve("sub/tool", &p).unwrap(), t.path().join("sub/tool"));
        assert!(resolve("./missing", &p).is_err());
    }

    #[test]
    fn non_executable_files_are_rejected() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("data"), b"x").unwrap();
        let p = policy(t.path(), None);
        assert!(resolve(&t.path().join("data").to_string_lossy(), &p).is_err());
        assert!(resolve("", &p).is_err());
    }
}
