//! Seatbelt (`sandbox-exec`) profile generation: a pure function from a resolved policy to
//! profile text and `-D` parameters, so it is unit-tested as text on every platform.
//!
//! Paths never appear in the profile text. Each grant is a `(param "RO_0")` reference and the
//! value travels as a `-DRO_0=/path` argument, so no path can break out of the profile with a
//! quote or a parenthesis.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::Path;

use crate::normalize::{ResolvedPath, ResolvedPolicy};
use crate::policy::NetworkPolicy;

const BASE: &str = include_str!("base.sbpl");
const PLATFORM: &str = include_str!("platform.sbpl");
const NETWORK_ON: &str = include_str!("network_on.sbpl");

/// Where `sandbox-exec` lives. Only this absolute path is used, never `PATH`: if it has been
/// replaced the attacker already has root.
#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, reason = "used by the macOS backend only")
)]
pub(crate) const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// A generated profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Profile {
    /// The profile text, passed with `-p`.
    pub text: String,
    /// `(NAME, value)` pairs, passed as `-DNAME=value`.
    pub params: Vec<(String, String)>,
}

/// Loopback only: bind, accept and connect to localhost on any port.
const NETWORK_LOOPBACK: &str = r#"
; network: loopback only
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
"#;

fn push_grants(
    text: &mut String,
    params: &mut Vec<(String, String)>,
    prefix: &str,
    grants: &[ResolvedPath],
    rules: &[&str],
) {
    for (index, grant) in grants.iter().enumerate() {
        let name = format!("{prefix}_{index}");
        params.push((name.clone(), grant.path.to_string_lossy().into_owned()));
        // A directory grant covers its tree (`subpath`); a file grant matches that file only.
        let matcher = if grant.is_dir { "subpath" } else { "literal" };
        let _ = writeln!(
            text,
            "(allow {} ({matcher} (param \"{name}\")))",
            rules.join(" ")
        );
    }
}

/// Builds the profile for `policy`. The network mode must already be one Seatbelt can enforce
/// (`Off`, `Loopback`, `On`); host allowlists are refused before this point.
pub(crate) fn build(policy: &ResolvedPolicy) -> Profile {
    let mut text = String::with_capacity(BASE.len() + PLATFORM.len() + 1024);
    let mut params = Vec::new();
    text.push_str(BASE);
    text.push('\n');
    text.push_str(PLATFORM);

    text.push_str("\n; read-only grants (ro_paths)\n");
    push_grants(
        &mut text,
        &mut params,
        "RO",
        &policy.ro,
        &["file-read*", "file-map-executable"],
    );

    text.push_str("\n; read-write grants (rw_paths)\n");
    push_grants(
        &mut text,
        &mut params,
        "RW",
        &policy.rw,
        &["file-read*", "file-map-executable", "file-write*"],
    );

    match &policy.network {
        NetworkPolicy::Off | NetworkPolicy::Allowlist(_) => {
            text.push_str("\n; network: off (nothing allowed)\n");
        }
        NetworkPolicy::Loopback => text.push_str(NETWORK_LOOPBACK),
        NetworkPolicy::On => {
            text.push_str("\n; network: on\n");
            text.push_str(NETWORK_ON);
        }
    }
    Profile { text, params }
}

impl Profile {
    /// The argument vector after `sandbox-exec` for running `program args...` under this profile.
    pub(crate) fn exec_args(&self, program: &Path, args: &[String]) -> Vec<OsString> {
        let mut out: Vec<OsString> = vec!["-p".into(), self.text.clone().into()];
        for (name, value) in &self.params {
            out.push(format!("-D{name}={value}").into());
        }
        out.push("--".into());
        out.push(program.as_os_str().to_owned());
        out.extend(args.iter().map(OsString::from));
        out
    }
}

#[cfg(test)]
mod tests;
