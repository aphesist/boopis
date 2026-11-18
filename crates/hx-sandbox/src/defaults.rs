//! Per-platform default read paths. A convenience list, never applied implicitly.

use std::path::PathBuf;

#[cfg(target_os = "linux")]
const SYSTEM_READ: &[&str] = &[
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    // Single files and small trees under /etc, not /etc itself: it holds host secrets.
    "/etc/ld.so.cache",
    "/etc/ld.so.conf",
    "/etc/ld.so.conf.d",
    "/etc/alternatives",
    "/etc/ssl",
    "/etc/ca-certificates",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
    "/etc/localtime",
    "/etc/os-release",
    "/etc/mime.types",
];

#[cfg(target_os = "macos")]
const SYSTEM_READ: &[&str] = &[
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library/Apple",
    "/private/etc/ssl",
    "/private/etc/localtime",
    "/private/etc/passwd",
    "/private/etc/group",
];

// AppContainer processes may already read the Windows directory and Program Files through the
// ALL APPLICATION PACKAGES group, so nothing needs granting for the system itself.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
const SYSTEM_READ: &[&str] = &[];

/// The default read paths that exist here, canonicalised.
pub(crate) fn system_read_paths() -> Vec<PathBuf> {
    SYSTEM_READ
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .fold(Vec::new(), |mut acc, p| {
            if !acc.contains(&p) {
                acc.push(p);
            }
            acc
        })
}
