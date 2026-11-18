//! What this host can enforce, for `hx.describe` and for deciding on a policy before running.

use serde::{Deserialize, Serialize};

/// One thing the host can or cannot do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Capability {
    /// Whether the sandbox can enforce this here, without the policy allowing degrading.
    pub available: bool,
    /// The mechanism used when available, or the best candidate when not.
    pub mechanism: Option<String>,
    /// Versions, ABIs, and the reason when unavailable.
    pub detail: String,
}

impl Capability {
    pub(crate) fn yes(mechanism: &str, detail: impl Into<String>) -> Self {
        Self {
            available: true,
            mechanism: Some(mechanism.to_owned()),
            detail: detail.into(),
        }
    }

    pub(crate) fn no(mechanism: Option<&str>, detail: impl Into<String>) -> Self {
        Self {
            available: false,
            mechanism: mechanism.map(str::to_owned),
            detail: detail.into(),
        }
    }
}

/// What [`crate::capabilities`] reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Capabilities {
    /// `linux`, `macos`, `windows` or `unsupported`.
    pub platform: String,
    /// Kernel or OS version string, when known.
    pub os_version: Option<String>,
    /// Read-only and read-write path confinement, including denying reads elsewhere.
    pub fs: Capability,
    /// `network: off`.
    pub network_off: Capability,
    /// `network: loopback`.
    pub network_loopback: Capability,
    /// `network: allowlist` of non-loopback hosts. Never available without an external proxy.
    pub network_allowlist: Capability,
    /// Killing the whole process tree on timeout, cancel or drop.
    pub process_tree_kill: Capability,
    /// Passing one extra socket or pipe handle to the child.
    pub inherited_handle: Capability,
}
