//! Helpers shared by the integration tests.
#![allow(dead_code)] // each test binary uses a different part

use std::fs;
use std::path::{Path, PathBuf};

use hx_mods::fixtures::MemoryHost;
use hx_mods::{ModRuntime, RuntimeConfig};

/// A runtime on an in-memory host, and the handle on what the host recorded.
pub fn runtime() -> (ModRuntime, MemoryHost) {
    runtime_with(RuntimeConfig::default())
}

pub fn runtime_with(config: RuntimeConfig) -> (ModRuntime, MemoryHost) {
    let host = MemoryHost::new();
    let rt = ModRuntime::new(Box::new(host.clone()), config).expect("the isolate starts");
    (rt, host)
}

/// One of the example mods under `tests/mods/`.
pub fn example(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/mods").join(name)
}

/// Writes a plugin: manifests plus `files` (path, content). `entry` is the module `hooks.json` names.
pub fn write_plugin(root: &Path, name: &str, entry: &str, files: &[(&str, &str)]) -> PathBuf {
    write_plugin_with(root, name, &[], entry, files)
}

pub fn write_plugin_with(root: &Path, name: &str, deps: &[&str], entry: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(dir.join(".claude-plugin")).unwrap();
    fs::create_dir_all(dir.join("hooks")).unwrap();
    let deps: Vec<String> = deps.iter().map(|d| format!("\"{d}\"")).collect();
    fs::write(dir.join(".claude-plugin/plugin.json"), format!("{{\"name\":\"{name}\",\"dependencies\":[{}]}}", deps.join(","))).unwrap();
    fs::write(dir.join("hooks/hooks.json"), format!("{{\"modules\":[\"./{entry}\"]}}")).unwrap();
    for (path, content) in files {
        let target = dir.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, content).unwrap();
    }
    dir
}

/// A single-module plugin whose `register.js` is `source`.
pub fn simple_plugin(root: &Path, name: &str, source: &str) -> PathBuf {
    write_plugin(root, name, "register.js", &[("register.js", source)])
}
