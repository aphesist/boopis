//! The rules of `runtime_ro` vetting, one by one. Every directory is a made-up tree under a
//! temporary "home", so nothing here depends on the machine's own layout.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};

use super::super::tests::interpreter_prefix;
use super::*;
use crate::policy::SandboxPolicy;

struct Setup {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    work: PathBuf,
}

fn setup() -> Setup {
    let tmp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(tmp.path()).unwrap();
    let home = root.join("home");
    let work = home.join("project");
    fs::create_dir_all(&work).unwrap();
    Setup {
        _tmp: tmp,
        home,
        work,
    }
}

fn vet(s: &Setup, root: &Path, hermes_home: Option<&Path>) -> Result<ResolvedPath> {
    let mut env: HashMap<&str, OsString> = HashMap::new();
    env.insert("HOME", s.home.clone().into_os_string());
    if let Some(h) = hermes_home {
        env.insert("HERMES_HOME", h.as_os_str().to_owned());
    }
    let lookup = move |name: &OsStr| env.get(name.to_str().unwrap()).cloned();
    SandboxPolicy::new(&s.work)
        .with_ro([&s.work])
        .with_runtime_ro([root])
        .resolve_with_env(&lookup)
        .map(|mut r| {
            r.ro.remove(r.ro.iter().position(|g| g.path != s.work).unwrap())
        })
}

fn refused(s: &Setup, root: &Path, hermes_home: Option<&Path>, needle: &str) {
    let err = vet(s, root, hermes_home).unwrap_err();
    assert!(
        matches!(&err, Error::InvalidPolicy(m) if m.contains(needle)),
        "{} should be refused with {needle:?}: {err}",
        root.display()
    );
}

fn accepted(s: &Setup, root: &Path, hermes_home: Option<&Path>) {
    let got = vet(s, root, hermes_home).unwrap_or_else(|e| panic!("{}: {e}", root.display()));
    assert_eq!(got.path, fs::canonicalize(root).unwrap());
}

#[test]
fn credential_directories_are_refused_even_when_they_look_like_a_runtime() {
    let s = setup();
    for secret in [
        ".ssh",
        ".gnupg",
        ".aws",
        ".kube",
        ".config/gcloud",
        ".local/share/keyrings",
    ] {
        let dir = s.home.join(secret);
        // with a perfect interpreter layout planted inside: the deny list does not care
        interpreter_prefix(&dir);
        refused(&s, &dir, None, "may not expose credentials");
        // a prefix nested deeper inside is just as refused
        let nested = dir.join("venv");
        interpreter_prefix(&nested);
        refused(&s, &nested, None, "may not expose credentials");
    }
}

#[test]
fn a_root_that_contains_credentials_is_refused() {
    let s = setup();
    // `~/.config`, `~/.local` and `~/.cargo` contain credentials; give them a bin/ so only the
    // deny list can refuse them
    fs::create_dir_all(s.home.join(".config/gcloud")).unwrap();
    fs::create_dir_all(s.home.join(".local/share/keyrings")).unwrap();
    fs::create_dir_all(s.home.join(".cargo")).unwrap();
    fs::write(s.home.join(".cargo/credentials.toml"), "token").unwrap();
    for parent in [".config", ".local", ".cargo"] {
        let dir = s.home.join(parent);
        interpreter_prefix(&dir);
        refused(&s, &dir, None, "contains");
    }
    // but the cargo bin directory itself holds no credentials
    let bin = s.home.join(".cargo/bin");
    fs::create_dir_all(&bin).unwrap();
    let cargo = bin.join("cargo");
    fs::write(&cargo, "").unwrap();
    fs::set_permissions(&cargo, fs::Permissions::from_mode(0o755)).unwrap();
    accepted(&s, &bin, None);
}

#[test]
fn hermes_home_and_what_holds_it_are_refused_but_a_python_inside_it_is_not() {
    let s = setup();
    let hermes = s.home.join(".hermes");
    fs::create_dir_all(hermes.join("hypotaxis")).unwrap();
    fs::write(hermes.join(".env"), "KEY=secret").unwrap();
    // Hermes's home itself, even with an interpreter in its own bin/ ...
    interpreter_prefix(&hermes);
    refused(&s, &hermes, None, "may not expose credentials");
    // ... what holds it, which is how the app's data folder looks (it contains `hermes-home`) ...
    let data = s.home.join(".local/share/app");
    let private_home = data.join("hermes-home");
    fs::create_dir_all(private_home.join("hypotaxis")).unwrap();
    interpreter_prefix(&data);
    refused(&s, &data, Some(&private_home), "may not expose credentials");
    // ... and the files in it that are secrets
    refused(
        &s,
        &hermes.join("hypotaxis"),
        None,
        "may not expose credentials",
    );
    interpreter_prefix(&hermes.join("hypotaxis").join("venv"));
    refused(
        &s,
        &hermes.join("hypotaxis").join("venv"),
        None,
        "may not expose credentials",
    );
    // A Python the app manages for Hermes lives inside that home and is the supported case.
    let managed = hermes.join("tools").join("cpython-3.12");
    interpreter_prefix(&managed);
    accepted(&s, &managed, None);
    let managed_data = private_home.join("runtime").join("py");
    interpreter_prefix(&managed_data);
    accepted(&s, &managed_data, Some(&private_home));
}

#[test]
fn hermes_home_follows_the_environment_when_it_is_set() {
    let s = setup();
    let elsewhere = s.home.join("custom-hermes");
    fs::create_dir_all(&elsewhere).unwrap();
    interpreter_prefix(&elsewhere);
    refused(
        &s,
        &elsewhere,
        Some(&elsewhere),
        "may not expose credentials",
    );
    // With HERMES_HOME set, ~/.hermes is not special (and without a runtime layout, refused anyway).
    let default = s.home.join(".hermes");
    fs::create_dir_all(&default).unwrap();
    refused(&s, &default, Some(&elsewhere), "not an interpreter");
}

#[test]
fn a_symlink_to_a_credential_directory_is_refused_by_where_it_points() {
    let s = setup();
    let ssh = s.home.join(".ssh");
    interpreter_prefix(&ssh);
    let innocent = s.home.join("python-3.12");
    symlink(&ssh, &innocent).unwrap();
    refused(&s, &innocent, None, "may not expose credentials");
    // and a secret that is itself a link (dotfiles kept elsewhere) is refused where it points
    let dotfiles = s.home.join("dotfiles").join("gnupg");
    interpreter_prefix(&dotfiles);
    symlink(&dotfiles, s.home.join(".gnupg")).unwrap();
    refused(&s, &dotfiles, None, "may not expose credentials");
}

#[test]
fn a_directory_without_an_interpreter_layout_is_refused() {
    let s = setup();
    let not_a_runtime = "is not an interpreter or toolchain prefix";
    // empty, and a bin/ with only a helper script
    let empty = s.home.join("empty");
    fs::create_dir_all(&empty).unwrap();
    refused(&s, &empty, None, not_a_runtime);
    let helper = s.home.join("helpers");
    fs::create_dir_all(helper.join("bin")).unwrap();
    let script = helper.join("bin").join("deploy");
    fs::write(&script, "").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    refused(&s, &helper, None, not_a_runtime);
    // a python that cannot be executed, and one that points nowhere
    let dead = s.home.join("dead");
    fs::create_dir_all(dead.join("bin")).unwrap();
    fs::write(dead.join("bin/python3"), "").unwrap();
    fs::set_permissions(dead.join("bin/python3"), fs::Permissions::from_mode(0o644)).unwrap();
    refused(&s, &dead, None, not_a_runtime);
    let dangling = s.home.join("dangling");
    fs::create_dir_all(dangling.join("bin")).unwrap();
    symlink("/nonexistent/python", dangling.join("bin/python3")).unwrap();
    refused(&s, &dangling, None, not_a_runtime);
    // an executable python lying loose in some directory that is not a bin directory
    let loose = s.home.join("Downloads");
    fs::create_dir_all(&loose).unwrap();
    fs::write(loose.join("python3"), "").unwrap();
    fs::set_permissions(loose.join("python3"), fs::Permissions::from_mode(0o755)).unwrap();
    refused(&s, &loose, None, not_a_runtime);
    // the places the review named, empty of runtimes
    for name in [".ssh", ".hermes"] {
        let dir = s.home.join(name);
        fs::create_dir_all(&dir).unwrap();
        refused(&s, &dir, None, "");
    }
}

#[test]
fn real_prefixes_and_their_bin_directories_are_accepted() {
    let s = setup();
    // a prefix outside the home, a uv-style managed Python under it, a venv, and a bin directory
    // alone (what `dirname(realpath(sys.executable))` is)
    let system = s.home.parent().unwrap().join("opt").join("python");
    interpreter_prefix(&system);
    accepted(&s, &system, None);
    let uv = s
        .home
        .join(".local/share/uv/python/cpython-3.12.1-linux-x86_64-gnu");
    interpreter_prefix(&uv);
    accepted(&s, &uv, None);
    accepted(&s, &uv.join("bin"), None);
    let venv = s.home.join("venvs").join("tools");
    interpreter_prefix(&venv);
    symlink(uv.join("bin/python3.12"), venv.join("bin/python")).unwrap();
    accepted(&s, &venv, None);
    // other runtimes
    for (dir, program) in [
        ("node-v20", "node"),
        ("jdk-21", "java"),
        ("go1.22", "go"),
        ("toolchain", "rustc"),
    ] {
        let root = s.home.join("tools").join(dir);
        fs::create_dir_all(root.join("bin")).unwrap();
        let exe = root.join("bin").join(program);
        fs::write(&exe, "").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        accepted(&s, &root, None);
    }
}

fn exe(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "").unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn the_gate_s_toolchain_roots_are_accepted() {
    let s = setup();
    // a rustup home (the proxy's data directory, with no bin/ of its own) and one toolchain in it
    let rustup = s.home.join(".rustup");
    let toolchain = rustup
        .join("toolchains")
        .join("stable-x86_64-unknown-linux-gnu");
    exe(&toolchain.join("bin/rustc"));
    exe(&toolchain.join("bin/cargo"));
    fs::create_dir_all(toolchain.join("lib/rustlib")).unwrap();
    accepted(&s, &rustup, None);
    accepted(&s, &toolchain, None);
    // the rustup proxies' directory
    exe(&s.home.join(".cargo/bin/cargo"));
    accepted(&s, &s.home.join(".cargo/bin"), None);
    // a Node prefix whose bin/ holds only a global tool: lib/node_modules marks it
    let node = s.home.parent().unwrap().join("opt/node-v22");
    exe(&node.join("bin/eslint"));
    fs::create_dir_all(node.join("lib/node_modules")).unwrap();
    accepted(&s, &node, None);
    // a virtualenv with only pytest in its bin/
    let venv = s.home.join("venvs/gate");
    exe(&venv.join("bin/pytest"));
    fs::write(venv.join("pyvenv.cfg"), "home = /usr/bin\n").unwrap();
    accepted(&s, &venv, None);
    // make and compilers that live outside /usr
    for (dir, program) in [
        ("gnumake", "make"),
        ("gcc-13", "gcc-13"),
        ("llvm", "clang++"),
    ] {
        let prefix = s.home.parent().unwrap().join("opt").join(dir);
        exe(&prefix.join("bin").join(program));
        accepted(&s, &prefix, None);
    }
}

#[test]
fn a_prefix_mark_alone_or_a_marked_home_subtree_is_not_enough() {
    let s = setup();
    // lib/python3.12 without any bin/: user-site packages, not a runtime
    let site = s.home.join("site");
    fs::create_dir_all(site.join("lib/python3.12")).unwrap();
    refused(&s, &site, None, "not an interpreter or toolchain prefix");
    // ~/.local looks like a prefix (bin/, lib/python*) and holds a keyring directory
    let local = s.home.join(".local");
    exe(&local.join("bin/uv"));
    fs::create_dir_all(local.join("lib/python3.12")).unwrap();
    fs::create_dir_all(local.join("share/keyrings")).unwrap();
    refused(&s, &local, None, "contains");
    // ~/.cargo holds credentials.toml
    let cargo = s.home.join(".cargo");
    exe(&cargo.join("bin/cargo"));
    fs::write(cargo.join("credentials.toml"), "token").unwrap();
    refused(&s, &cargo, None, "contains");
}

#[test]
fn program_names_are_matched_without_versions_and_extensions() {
    for yes in [
        "python",
        "python3",
        "python3.12",
        "pypy3.10",
        "node",
        "nodejs",
        "ruby",
        "go",
        "go1.22.3",
        "java",
        "cargo",
        "python.exe",
    ] {
        assert!(names_a_runtime_program(OsStr::new(yes)), "{yes}");
    }
    for no in [
        "python-config",
        "pythonista",
        "ls",
        "node_modules",
        "golang",
        "gofmt",
        "",
        ".python",
    ] {
        assert!(!names_a_runtime_program(OsStr::new(no)), "{no}");
    }
}
