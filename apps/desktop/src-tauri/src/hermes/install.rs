//! `hermes_install`: a consented stub. It only reports the documented installer command; it never runs an installer
//! (`docs/ARCHITECTURE.md` section 4 says the host runs Hermes's own installer with the user's consent; that arrives
//! with the setup form).

use serde::Serialize;
use specta::Type;

use crate::error::{Error, Result};

/// What `hermes_install` answers.
#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
pub struct InstallReport {
    /// Always `false` for now: nothing was run.
    pub ran: bool,
    /// The documented installer command for this OS, for the user to run.
    pub command: String,
    /// A line saying what happened.
    pub note: String,
}

/// The documented installer command (`README.md` of Hermes).
#[must_use]
pub fn installer_command() -> &'static str {
    if cfg!(windows) {
        "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"
    } else {
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
    }
}

/// Report the installer command. Without `consent` it is refused; with it, still nothing runs.
///
/// # Errors
/// `ConsentRequired` when `consent` is `false`.
pub fn plan(consent: bool) -> Result<InstallReport> {
    if !consent {
        return Err(Error::ConsentRequired("installing Hermes"));
    }
    Ok(InstallReport {
        ran: false,
        command: installer_command().to_owned(),
        note: "The host does not run installers yet; run this command in a terminal, then reopen boopis.".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_without_consent_and_nothing_run_with_it() {
        assert_eq!(plan(false).unwrap_err().code(), "hx.host.consent_required");
        let r = plan(true).unwrap();
        assert!(!r.ran);
        assert!(r.command.contains("hermes-agent.nousresearch.com"));
    }
}
