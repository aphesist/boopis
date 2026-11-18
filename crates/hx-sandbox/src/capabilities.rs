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

impl Capabilities {
    /// Capability strings for `hx.describe` (STANDARDS section 7: features are gated on these,
    /// never on version numbers). Only what is enforceable here is listed, so a peer that sees
    /// `sandbox.fs` can rely on it.
    #[must_use]
    pub fn capability_strings(&self) -> Vec<String> {
        let mut out = vec![
            "sandbox.run".to_owned(),
            "sandbox.spawn".to_owned(),
            format!("sandbox.platform.{}", self.platform),
        ];
        let flags = [
            (&self.fs, "sandbox.fs"),
            (&self.network_off, "sandbox.net.off"),
            (&self.network_loopback, "sandbox.net.loopback"),
            (&self.network_allowlist, "sandbox.net.allowlist"),
            (&self.process_tree_kill, "sandbox.process_tree_kill"),
            (&self.inherited_handle, "sandbox.inherited_handle"),
        ];
        out.extend(
            flags
                .iter()
                .filter(|(c, _)| c.available)
                .map(|(_, name)| (*name).to_owned()),
        );
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_available_things_are_advertised() {
        let caps = Capabilities {
            platform: "linux".into(),
            os_version: None,
            fs: Capability::yes("landlock", "x"),
            network_off: Capability::yes("seccomp", "x"),
            network_loopback: Capability::no(Some("netns"), "no"),
            network_allowlist: Capability::no(None, "no"),
            process_tree_kill: Capability::yes("setsid", "x"),
            inherited_handle: Capability::yes("fd", "x"),
        };
        let strings = caps.capability_strings();
        assert!(strings.contains(&"sandbox.fs".to_owned()));
        assert!(strings.contains(&"sandbox.net.off".to_owned()));
        assert!(!strings.contains(&"sandbox.net.loopback".to_owned()));
        assert!(!strings.contains(&"sandbox.net.allowlist".to_owned()));
        assert!(strings.windows(2).all(|w| w[0] <= w[1]), "sorted");
    }
}
