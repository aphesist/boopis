//! Platform backends. Exactly one is compiled in; they share this contract:
//!
//! - `prepare(&ResolvedPolicy) -> Result<Prepared>` decides what the host can enforce, applies
//!   the degrade rules, and fails with `Error::Unavailable` when a requested dimension cannot
//!   be held. It builds the [`Enforcement`] report from that decision.
//! - `Prepared::spawn(LaunchSpec) -> Result<Launch>` starts the child with every restriction
//!   applied *before* the program runs. A setup step that fails means the program never runs
//!   (`Error::Setup`); only a failure to start the program itself is `Launch::Failed`.
//! - [`Child`] exposes the pid, the three streams, `wait`, and a [`TreeKiller`] that ends the
//!   whole process tree.
//!
//! The report is built before the spawn and is true because of the rule above: if the child
//! is running, every step that the report lists was applied.

use std::path::Path;

use tokio::io::{AsyncRead, AsyncWrite};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub(crate) mod unix_sys;

#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "linux")]
pub(crate) use linux as sys;

#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(target_os = "macos")]
pub(crate) use macos as sys;

#[cfg(windows)]
pub(crate) mod windows;
#[cfg(windows)]
pub(crate) use windows as sys;

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(crate) mod unsupported;
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(crate) use unsupported as sys;

pub(crate) use sys::{Child, Prepared, TreeKiller, capabilities, prepare};

/// A readable child stream.
pub(crate) type BoxRead = Box<dyn AsyncRead + Send + Unpin>;
/// A writable child stream.
pub(crate) type BoxWrite = Box<dyn AsyncWrite + Send + Unpin>;

/// The OS object passed to the child on top of stdio: a file descriptor on Unix, a handle on
/// Windows. The child sees it under the same number it has in the parent.
#[cfg(unix)]
pub type InheritedHandle = std::os::fd::OwnedFd;
/// The OS object passed to the child on top of stdio: a file descriptor on Unix, a handle on
/// Windows. The child sees it under the same value it has in the parent.
#[cfg(windows)]
pub type InheritedHandle = std::os::windows::io::OwnedHandle;
/// Placeholder where no handle passing exists.
#[cfg(not(any(unix, windows)))]
pub type InheritedHandle = std::convert::Infallible;

/// The streams of a started child.
pub(crate) struct Streams {
    pub stdin: Option<BoxWrite>,
    pub stdout: BoxRead,
    pub stderr: BoxRead,
}

/// Whether the child gets a pipe on stdin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StdinMode {
    /// Stdin is the null device.
    Null,
    /// Stdin is a pipe the caller writes to.
    Piped,
}

/// Everything a backend needs to start the program.
pub(crate) struct LaunchSpec<'a> {
    /// Absolute path of the program, already resolved against the child's `PATH`.
    pub program: &'a Path,
    /// `argv[1..]`.
    pub args: &'a [String],
    /// Stdin wiring.
    pub stdin: StdinMode,
    /// The extra handle for the child, if any.
    pub inherit: Option<InheritedHandle>,
}

/// The outcome of trying to start the child.
#[allow(
    clippy::large_enum_variant,
    reason = "one short-lived value per spawn; boxing would add an allocation for nothing"
)]
pub(crate) enum Launch {
    /// Running.
    Started(Child),
    /// The program could not be started (not executable, permission denied, bad format). The
    /// sandbox setup itself succeeded.
    Failed(String),
}

impl std::fmt::Debug for Launch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Launch::Started(_) => f.write_str("Launch::Started"),
            Launch::Failed(reason) => write!(f, "Launch::Failed({reason})"),
        }
    }
}
