//! Vetting of `runtime_ro` roots: read access a caller asks for on the strength of "this is my
//! interpreter", checked so that the claim has to be true.
//!
//! A root is granted only if **all** of these hold, each on the canonical path (after every
//! symlink), so no link can carry a refused directory past a check:
//!
//! 1. It is an existing directory that is not `/`, not `$HOME` or a parent of it, not the working
//!    directory, and not inside or above it (the workspace has its own grants).
//! 2. It does not touch a **sensitive location**: it is not one, not inside one, and does not
//!    contain one. The list is [`SENSITIVE_IN_HOME`] (`~/.ssh`, `~/.gnupg`, cloud and registry
//!    credentials, keyrings) plus, in Hermes's home (`HERMES_HOME`, else `~/.hermes`), the
//!    provider keys (`.env`) and the host channel's token (`hypotaxis/`). Because those two sit
//!    at the top of Hermes's home, the home itself and anything that holds it (the app's data
//!    folder) are refused as containing them, while a root *inside* it, such as a Python the app
//!    manages for Hermes, is not.
//! 3. It **looks like a runtime**: `bin/` (or `Scripts/` on Windows) holds an executable named
//!    like an interpreter, a package manager, a compiler or a build tool ([`RUNTIME_PROGRAMS`]), or
//!    the directory is that `bin` itself, or it is a prefix with the marks of one
//!    ([`PREFIX_MARKERS`]: a virtual environment's `pyvenv.cfg`, `lib/python*`, `lib/node_modules`,
//!    `lib/rustlib`, a rustup home's `toolchains/*/lib/rustlib`, and so on) together with a `bin/`.
//!    This is the rule that matters most. A deny list names only the secrets someone
//!    thought of; a root has no business being granted unless there is something in it to run,
//!    and a directory with a Python or Node in `bin/` is not a place secrets are kept. A program
//!    outside every such layout gets a read grant through `ro_paths`, which is not vetted and is
//!    meant for the caller's own paths.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::{ResolvedPath, resolve_path};
use crate::error::{Error, Result};

/// Places under `$HOME` whose contents are credentials. A root may not be, contain or lie inside
/// any of them.
const SENSITIVE_IN_HOME: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".pki",
    ".password-store",
    ".config/gcloud",
    ".config/gh",
    ".local/share/keyrings",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    ".cargo/credentials",
    ".cargo/credentials.toml",
];

/// Secrets inside Hermes's home: the provider keys, and the rendezvous file with the host
/// channel's token (`<hermes home>/hypotaxis/host-channel.json`).
const SENSITIVE_IN_HERMES_HOME: &[&str] = &[".env", "hypotaxis"];

/// Where Hermes's home is when `HERMES_HOME` is not set.
const DEFAULT_HERMES_HOME: &str = ".hermes";

/// Program names (without version digits, dashes or extension) that make a directory a runtime:
/// interpreters, their package managers, compilers and build tools. One list to extend; it is the
/// gate's toolchain (`plugins/hypotaxis/ship/toolchain.py`) that decides what to ask for.
const RUNTIME_PROGRAMS: &[&str] = &[
    // interpreters and their tools
    "python", "pypy", "pip", "pipx", "uv", "poetry", "pytest", "tox", "ruff", "node", "nodejs",
    "npm", "npx", "yarn", "pnpm", "deno", "bun", "ruby", "gem", "bundle", "perl", "php",
    "composer", "java", "javac", "gradle", "mvn", "dotnet", "go", // Rust
    "rustc", "cargo", "rustup",
    // compilers and build tools, for a toolchain that lives outside /usr
    "make", "gmake", "cmake", "ninja", "meson", "gcc", "cc", "g++", "c++", "clang", "clang++",
    "zig",
];

/// What marks a directory as the prefix of a runtime, relative to it (globs with one `*`). A
/// prefix also needs a `bin/` (or `Scripts/`), so a `lib/python3.12` that only holds user-site
/// packages in a directory with no programs is not enough.
const PREFIX_MARKERS: &[&str] = &[
    "pyvenv.cfg",
    "lib/python*",
    "lib64/python*",
    "lib/node_modules",
    "lib/rustlib",
    "lib/ruby",
    "lib/modules",
    "toolchains/*/lib/rustlib",
    "toolchains/*/bin",
];

/// How many directory entries are looked at when searching for a program; a prefix with more
/// than this in one `bin/` is not a place to scan.
const MAX_ENTRIES: usize = 4096;

/// The sensitive places a root must keep away from: it may not be one, lie inside one, or contain
/// one. Paths are lexical (under the canonical home) and, where a secret is itself a symlink,
/// also where it points.
fn sensitive_places(home: Option<&Path>, hermes_home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut places = Vec::new();
    let mut add = |path: PathBuf| {
        if let Ok(real) = std::fs::canonicalize(&path)
            && real != path
        {
            places.push(real);
        }
        places.push(path);
    };
    if let Some(home) = home {
        for rel in SENSITIVE_IN_HOME {
            add(home.join(rel));
        }
    }
    let hermes = hermes_home.or_else(|| home.map(|h| h.join(DEFAULT_HERMES_HOME)));
    if let Some(hermes) = hermes {
        for rel in SENSITIVE_IN_HERMES_HOME {
            add(hermes.join(rel));
        }
    }
    places
}

/// How `root` touches the first sensitive place it does, if it does.
fn touches(places: &[PathBuf], root: &Path) -> Option<String> {
    places.iter().find_map(|s| {
        if root.starts_with(s) {
            Some(format!("is or lies inside {}", s.display()))
        } else if s.starts_with(root) {
            Some(format!("contains {}", s.display()))
        } else {
            None
        }
    })
}

/// Vets one runtime root and resolves it. The sandbox grants the canonical path only.
pub(super) fn resolve_runtime_root(
    requested: &Path,
    cwd: &Path,
    home: Option<&Path>,
    hermes_home: Option<&OsStr>,
) -> Result<ResolvedPath> {
    let resolved = resolve_path(requested)?;
    let path = &resolved.path;
    let refuse = |why: &str| {
        Err(Error::invalid(format!(
            "runtime root {} (resolves to {}) {why}",
            requested.display(),
            path.display()
        )))
    };
    if !resolved.is_dir {
        return refuse("is not a directory");
    }
    if path.parent().is_none() {
        return refuse("is the file system root");
    }
    if home.is_some_and(|h| path == h || h.starts_with(path)) {
        return refuse("is the home directory or one of its parents");
    }
    if path.starts_with(cwd) {
        return refuse("is inside the working directory, which is granted already");
    }
    if cwd.starts_with(path) {
        return refuse("contains the working directory");
    }
    let hermes_home = hermes_home
        .filter(|h| !h.is_empty())
        .map(|h| std::fs::canonicalize(h).unwrap_or_else(|_| PathBuf::from(h)));
    if let Some(how) = touches(&sensitive_places(home, hermes_home), path) {
        return refuse(&format!("{how}: a runtime root may not expose credentials"));
    }
    if !looks_like_a_runtime(path) {
        return refuse(
            "is not an interpreter or toolchain prefix: it has no bin/ with a python, node, \
             ruby, java, go, cargo or similar program in it, and is not such a bin directory",
        );
    }
    Ok(resolved)
}

/// Whether `path/bin` (or `path/Scripts`), or `path` itself when it is named like one, holds an
/// executable named like an interpreter or toolchain driver.
fn looks_like_a_runtime(path: &Path) -> bool {
    holds_programs(path) || has_prefix_marks(path)
}

/// A prefix mark, with a `bin/` or `Scripts/` beside it. A rustup home has none of its own (its
/// programs are under `toolchains/*/bin`), so there the marker is the program directory itself.
fn has_prefix_marks(path: &Path) -> bool {
    let has_bin = path.join("bin").is_dir() || path.join("Scripts").is_dir();
    PREFIX_MARKERS
        .iter()
        .any(|marker| (has_bin || marker.starts_with("toolchains/")) && exists_glob(path, marker))
}

/// Whether `rel` (at most one `*` component) names something under `base`.
fn exists_glob(base: &Path, rel: &str) -> bool {
    let Some((head, tail)) = rel.split_once('*') else {
        return base.join(rel).exists();
    };
    // `lib/python*` is a prefix of a name; `toolchains/*/x` is a whole component.
    let (dir_rel, name_prefix) = head.rsplit_once('/').unwrap_or(("", head));
    let Ok(entries) = std::fs::read_dir(base.join(dir_rel)) else {
        return false;
    };
    entries.take(MAX_ENTRIES).flatten().any(|e| {
        e.file_name()
            .to_str()
            .is_some_and(|n| n.starts_with(name_prefix))
            && (tail.is_empty() || e.path().join(tail.trim_start_matches('/')).exists())
    })
}

/// Whether `bin/` (or `Scripts/`, or the directory itself when it is named like one) holds a
/// recognised program.
fn holds_programs(path: &Path) -> bool {
    let is_bin_dir = path
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|n| matches!(n, "bin" | "sbin" | "Scripts"));
    let mut dirs = vec![path.join("bin"), path.join("Scripts")];
    if is_bin_dir {
        dirs.push(path.to_path_buf());
    }
    dirs.iter().any(|dir| holds_a_runtime_program(dir))
}

fn holds_a_runtime_program(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries
        .take(MAX_ENTRIES)
        .flatten()
        .any(|e| names_a_runtime_program(&e.file_name()) && is_executable_file(&e.path()))
}

/// `python3.12`, `python`, `node`, `pypy3.10`, `ruby.exe`: the name without extension or
/// trailing version digits is on the list.
fn names_a_runtime_program(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    // Whatever follows the first dot is a version or an extension.
    let stem = name.split('.').next().unwrap_or(name);
    // `python3`, `gcc-13`, `go1`: trailing version digits and the dash before them.
    let stem = stem.trim_end_matches(|c: char| c.is_ascii_digit() || c == '-');
    RUNTIME_PROGRAMS.contains(&stem)
}

/// A regular file (through symlinks: a venv's `python` points elsewhere) that can be executed.
fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
#[cfg(unix)]
mod tests;
