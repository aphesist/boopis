//! Platforms with no backend: every request fails closed with `Unavailable`.

use super::LaunchSpec;
use crate::capabilities::{Capabilities, Capability};
use crate::error::{Dimension, Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::report::{Enforcement, ExitOutcome};

pub(crate) struct Prepared;
pub(crate) struct Child;
#[derive(Debug, Clone, Copy)]
pub(crate) struct TreeKiller;

impl TreeKiller {
    pub(crate) fn terminate(self) {}
    pub(crate) fn kill(self) {}
}

impl Child {
    pub(crate) fn pid(&self) -> u32 {
        0
    }
    pub(crate) fn killer(&self) -> TreeKiller {
        TreeKiller
    }
    pub(crate) fn take_streams(&mut self) -> super::Streams {
        unreachable_streams()
    }
    pub(crate) async fn wait(&mut self) -> std::io::Result<ExitOutcome> {
        Ok(ExitOutcome::Exited { code: -1 })
    }
}

fn unreachable_streams() -> super::Streams {
    super::Streams {
        stdin: None,
        stdout: Box::new(tokio::io::empty()),
        stderr: Box::new(tokio::io::empty()),
    }
}

impl Prepared {
    pub(crate) fn enforcement(&self) -> &Enforcement {
        unreachable!("prepare never returns Prepared on this platform")
    }
    pub(crate) fn spawn(self, _spec: LaunchSpec<'_>) -> Result<super::Launch> {
        Err(Error::unavailable(
            Dimension::Fs,
            "no sandbox backend for this platform",
        ))
    }
}

pub(crate) fn prepare(_policy: &ResolvedPolicy) -> Result<Prepared> {
    Err(Error::unavailable(
        Dimension::Fs,
        "hx-sandbox has no backend for this operating system (supported: Linux, macOS, Windows)",
    ))
}

pub(crate) fn capabilities() -> Capabilities {
    let no = || Capability::no(None, "no backend for this operating system");
    Capabilities {
        platform: "unsupported".to_owned(),
        os_version: None,
        fs: no(),
        network_off: no(),
        network_loopback: no(),
        network_allowlist: no(),
        process_tree_kill: no(),
        inherited_handle: no(),
    }
}
