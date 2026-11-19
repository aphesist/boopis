//! The host's error type. Every error that reaches the UI is `{code, message}` with a stable namespaced code
//! (`docs/STANDARDS.md` section 3); the codes `hx.hermes.*` are listed in `docs/PROTOCOL.md`.

use serde::Serialize;
use specta::Type;

/// Every way a host operation can fail.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// Hermes is not installed (no `hermes` binary was found).
    #[error("Hermes is not installed")]
    HermesMissing,
    /// The installed Hermes is older than the version the plugin requires.
    #[error("Hermes {found} is older than the required {required}")]
    HermesTooOld {
        /// The installed version.
        found: String,
        /// The requirement, as the plugin declares it (`>=0.23.2`).
        required: String,
    },
    /// The endpoint cannot be reached right now, or is not supported yet.
    #[error("{0}")]
    Unavailable(String),
    /// The gateway speaks something this host does not (protocol, capabilities, code identity).
    #[error("{0}")]
    Incompatible(String),
    /// A frame is not a valid JSON-RPC 2.0 message.
    #[error("invalid frame: {0}")]
    InvalidFrame(String),
    /// A frame is larger than the cap.
    #[error("frame of {size} bytes exceeds the {limit} byte cap")]
    FrameTooLarge {
        /// The frame's size in bytes.
        size: usize,
        /// The cap in bytes.
        limit: usize,
    },
    /// The connection id is not (or no longer) open.
    #[error("unknown connection {0}")]
    UnknownConnection(u32),
    /// A command's input failed validation.
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// An action that needs the user's consent was called without it.
    #[error("{0} needs the user's consent")]
    ConsentRequired(&'static str),
    /// No secret store is running (on Linux: no Secret Service).
    #[error("no secret store is available: {0}")]
    SecretsUnavailable(String),
    /// The secret store refused or failed.
    #[error("secret store: {0}")]
    Secrets(String),
    /// The secret does not exist.
    #[error("no such secret")]
    SecretNotFound,
    /// Settings failed validation or are from a newer version.
    #[error("{0}")]
    Config(String),
    /// Reading or writing a local file or socket failed.
    #[error("i/o: {0}")]
    Io(String),
    /// The WebSocket layer failed.
    #[error("websocket: {0}")]
    Ws(String),
    /// An external await ran out of time.
    #[error("{0} timed out")]
    Timeout(&'static str),
    /// The OS integration (dialog, notification, opener) failed.
    #[error("{0}")]
    Os(String),
    /// A first-run setup failure with its own stable code (`hx.setup.*`).
    #[error("{1}")]
    Setup(&'static str, String),
}

/// A specialised `Result`.
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// The stable, namespaced code of this error.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::HermesMissing
            | Self::Unavailable(_)
            | Self::Ws(_)
            | Self::Timeout(_)
            | Self::Io(_) => "hx.hermes.unavailable",
            Self::HermesTooOld { .. } | Self::Incompatible(_) => "hx.hermes.incompatible",
            Self::InvalidFrame(_) | Self::FrameTooLarge { .. } => "hx.host.invalid_frame",
            Self::UnknownConnection(_) => "hx.host.unknown_connection",
            Self::InvalidInput(_) => "hx.invalid_params",
            Self::Config(_) => "hx.config.invalid",
            Self::ConsentRequired(_) => "hx.host.consent_required",
            Self::SecretsUnavailable(_) => "hx.secrets.unavailable",
            Self::Secrets(_) => "hx.secrets.failed",
            Self::SecretNotFound => "hx.secrets.not_found",
            Self::Os(_) => "hx.host.os",
            Self::Setup(code, _) => code,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

/// The error as the UI sees it: a stable code and a message. Never carries a secret, a ticket or a token.
#[derive(Debug, Clone, Serialize, Type)]
pub struct HostError {
    /// A stable code such as `hx.hermes.unavailable`.
    pub code: String,
    /// A human-readable message.
    pub message: String,
}

impl From<Error> for HostError {
    fn from(e: Error) -> Self {
        Self {
            code: e.code().to_owned(),
            message: e.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_namespaced_and_stable() {
        assert_eq!(Error::HermesMissing.code(), "hx.hermes.unavailable");
        assert_eq!(
            Error::Incompatible("x".into()).code(),
            "hx.hermes.incompatible"
        );
        assert_eq!(Error::SecretNotFound.code(), "hx.secrets.not_found");
        let e: HostError = Error::ConsentRequired("install").into();
        assert_eq!(e.code, "hx.host.consent_required");
        assert!(e.message.contains("consent"));
    }
}
