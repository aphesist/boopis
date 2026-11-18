//! Translating a resolved policy into the Windows objects that enforce it, as pure data.
//!
//! Everything here is plain computation (no Win32 calls), so it is compiled and unit-tested on
//! every platform. The Windows backend turns these values into ACLs, capability SIDs, a
//! command line and an environment block.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::PathBuf;

use crate::normalize::ResolvedPolicy;
use crate::policy::NetworkPolicy;

/// Access rights granted to the `AppContainer` SID, as raw access masks (winnt.h values).
pub(crate) mod mask {
    /// `FILE_GENERIC_READ | FILE_GENERIC_EXECUTE`: read data, attributes and the ACL, execute.
    pub const READ_EXECUTE: u32 = 0x0012_00A9;
    /// `FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE |
    /// FILE_DELETE_CHILD`: everything a build needs inside its output directory, but not
    /// `WRITE_DAC`/`WRITE_OWNER`, so the child can never rewrite the ACL that confines it.
    pub const MODIFY: u32 = 0x0013_01FF;
    /// `WRITE_DAC | WRITE_OWNER`: must never be granted (checked by the tests).
    #[cfg(test)]
    pub const ACL_CONTROL: u32 = 0x0004_0000 | 0x0008_0000;
}

/// What a path grant allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Right {
    /// Read and execute.
    ReadExecute,
    /// Read, write, create, delete.
    Modify,
}

impl Right {
    /// The access mask for this right.
    pub(crate) fn mask(self) -> u32 {
        match self {
            Right::ReadExecute => mask::READ_EXECUTE,
            Right::Modify => mask::MODIFY,
        }
    }
}

/// One ACL entry to add for the container SID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AclGrant {
    /// The canonical path (no `\\?\` prefix).
    pub path: PathBuf,
    /// What the entry allows.
    pub right: Right,
    /// Whether the entry is inherited by everything beneath (directories only).
    pub inherit: bool,
}

/// The ACL entries for a policy: read-execute on each `ro` path, modify on each `rw` path.
pub(crate) fn acl_grants(policy: &ResolvedPolicy) -> Vec<AclGrant> {
    let make = |grants: &[crate::normalize::ResolvedPath], right| {
        grants
            .iter()
            .map(|g| AclGrant {
                path: g.path.clone(),
                right,
                inherit: g.is_dir,
            })
            .collect::<Vec<_>>()
    };
    let mut out = make(&policy.ro, Right::ReadExecute);
    out.extend(make(&policy.rw, Right::Modify));
    out
}

/// Capability SIDs of the `internetClient` family (S-1-15-3-x), by name.
pub(crate) mod capability_sid {
    /// `internetClient`: outbound connections to the internet.
    pub const INTERNET_CLIENT: &str = "S-1-15-3-1";
    /// `internetClientServer`: outbound and inbound.
    pub const INTERNET_CLIENT_SERVER: &str = "S-1-15-3-2";
    /// `privateNetworkClientServer`: the local network.
    pub const PRIVATE_NETWORK: &str = "S-1-15-3-3";
}

/// How the `AppContainer`'s network access is set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NetworkPlan {
    /// Capability SIDs to give the container (none means no network at all).
    pub capabilities: Vec<&'static str>,
    /// The container must be exempt from loopback isolation (needs an elevated caller).
    pub loopback_exempt: bool,
}

/// What the network mode needs, or why Windows cannot do it.
pub(crate) fn network_plan(network: &NetworkPolicy) -> Result<NetworkPlan, &'static str> {
    use capability_sid::{INTERNET_CLIENT, INTERNET_CLIENT_SERVER, PRIVATE_NETWORK};
    match network {
        // An AppContainer with no network capability has no outbound or inbound network, and
        // its loopback is isolated too.
        NetworkPolicy::Off => Ok(NetworkPlan {
            capabilities: vec![],
            loopback_exempt: false,
        }),
        NetworkPolicy::Loopback => Ok(NetworkPlan {
            capabilities: vec![],
            loopback_exempt: true,
        }),
        NetworkPolicy::On => Ok(NetworkPlan {
            capabilities: vec![INTERNET_CLIENT, INTERNET_CLIENT_SERVER, PRIVATE_NETWORK],
            loopback_exempt: false,
        }),
        NetworkPolicy::Allowlist(_) => Err(
            "Windows has no per-host filter for an AppContainer; that needs an egress proxy outside hx-sandbox",
        ),
    }
}

/// Quotes one argument so that `CommandLineToArgvW` and the MSVC runtime parse it back to the
/// same string: wrap in quotes when needed, double the backslashes that precede a quote, and
/// escape quotes. This is the only thing standing between an agent's argument and extra
/// arguments, so it has a round-trip property test.
pub(crate) fn quote_arg(arg: &str) -> String {
    let plain = !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']);
    if plain {
        return arg.to_owned();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    // Backslashes before the closing quote must be doubled or they would escape it.
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
    out
}

/// The full command line: the program path then the arguments, each quoted. Rejects NUL, which
/// cannot appear in a Windows command line.
pub(crate) fn command_line(program: &str, args: &[String]) -> Result<String, &'static str> {
    if program.contains('\0') || args.iter().any(|a| a.contains('\0')) {
        return Err("an argument contains NUL");
    }
    let mut line = quote_arg(program);
    for arg in args {
        line.push(' ');
        line.push_str(&quote_arg(arg));
    }
    Ok(line)
}

/// Encodes an OS string as UTF-16 code units.
fn utf16(s: &std::ffi::OsStr) -> Vec<u16> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        s.encode_wide().collect()
    }
    #[cfg(not(windows))]
    {
        s.to_string_lossy().encode_utf16().collect()
    }
}

/// Builds the `CREATE_UNICODE_ENVIRONMENT` block: `NAME=value\0` entries sorted
/// case-insensitively by name (what `CreateProcess` documents), ended by an extra `\0`. An empty
/// environment is `\0\0`, never a single `\0`.
pub(crate) fn env_block(env: &[(OsString, OsString)]) -> Vec<u16> {
    let mut entries: Vec<(String, Vec<u16>)> = env
        .iter()
        .map(|(name, value)| {
            let mut unit = utf16(name);
            unit.push(u16::from(b'='));
            unit.extend(utf16(value));
            (name.to_string_lossy().to_uppercase(), unit)
        })
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut block = Vec::new();
    for (_, unit) in entries {
        block.extend(unit);
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    block
}

/// The `AppContainer` profile name for one run. Random per run, so a stale access-control entry
/// left by a crash can never be exercised by a later run. Windows limits the name to 64
/// characters.
pub(crate) fn container_name(random: [u8; 16]) -> String {
    let mut name = String::from("hx-sandbox.");
    for byte in random {
        let _ = write!(name, "{byte:02x}");
    }
    name
}

/// Job object UI restrictions applied to every child (`JOB_OBJECT_UILIMIT_*` bits): no clipboard,
/// no desktop or display changes, no global atoms, no handles to windows outside the job, no
/// logoff.
pub(crate) const JOB_UI_LIMITS: u32 = 0x0000_0001 // HANDLES
    | 0x0000_0002 // READCLIPBOARD
    | 0x0000_0004 // WRITECLIPBOARD
    | 0x0000_0008 // SYSTEMPARAMETERS
    | 0x0000_0010 // DISPLAYSETTINGS
    | 0x0000_0020 // GLOBALATOMS
    | 0x0000_0040 // DESKTOP
    | 0x0000_0080; // EXITWINDOWS

#[cfg(test)]
mod tests;

/// Cross-checks the hand-written masks against the Windows headers' own constants.
#[cfg(all(test, windows))]
mod header_checks {
    use super::mask;
    use windows_sys::Win32::Storage::FileSystem as fs;

    #[test]
    fn masks_match_winnt() {
        assert_eq!(
            mask::READ_EXECUTE,
            fs::FILE_GENERIC_READ | fs::FILE_GENERIC_EXECUTE
        );
        assert_eq!(
            mask::MODIFY,
            fs::FILE_GENERIC_READ
                | fs::FILE_GENERIC_WRITE
                | fs::FILE_GENERIC_EXECUTE
                | fs::DELETE
                | fs::FILE_DELETE_CHILD
        );
        assert_eq!(mask::ACL_CONTROL, fs::WRITE_DAC | fs::WRITE_OWNER);
    }
}
