//! The host's error type. Every error that reaches the UI is `{code, message}` with a stable namespaced code
//! (`docs/STANDARDS.md` section 3); the codes `hx.engine.*` are listed in `docs/PROTOCOL.md`.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

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
    #[error("{0}")]
    SecretsUnavailable(String),
    /// The secret store refused or failed.
    #[error("{0}")]
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
    /// A connector operation failed with its own stable code (`hx.connectors.*`).
    #[error("{1}")]
    Connector(&'static str, String),
    /// A store operation failed with its own stable code (`hx.store.*`, `docs/STORE.md`).
    #[error("{1}")]
    Store(&'static str, String),
    /// A provider operation failed with its own stable code (`hx.provider.*`).
    #[error("{1}")]
    Provider(&'static str, String),
    /// A background task ended without an answer: it panicked (a bug in boopis) or was cancelled at shutdown. The text is the
    /// raw one, for Diagnostics; a person reads `hx.host.task_failed`'s sentence ([`joined`]).
    #[error("{0}")]
    Task(String),
    /// A bot could not be made, changed or prepared, with its own stable code (`hx.bots.*`, ADR-0042).
    #[error("{1}")]
    Bots(&'static str, String),
}

/// A specialised `Result`.
pub type Result<T> = std::result::Result<T, Error>;

/// Every `hx.store.*` code (`crates/hx-proto/errors.json`), so a code that arrives as text (a plugin's refusal) can be carried as
/// the `&'static str` an [`Error::Store`] holds. A code outside the list is not a store code.
pub const STORE_CODES: &[&str] = &[
    "hx.store.unpinned",
    "hx.store.digest_mismatch",
    "hx.store.plan_changed",
    "hx.store.source_unreachable",
    "hx.store.too_large",
    "hx.store.unsafe_archive",
    "hx.store.dangerous_verdict",
    "hx.store.kind_unsupported",
    "hx.store.governed_refused",
    "hx.store.not_installed",
    "hx.store.offline",
    "hx.store.not_found",
    "hx.store.already_installed",
    "hx.store.removed",
    "hx.store.invalid_source",
    "hx.store.invalid_manifest",
    "hx.store.stage_missing",
    "hx.store.no_previous",
    "hx.store.rate_limited",
    "hx.store.install_failed",
];

impl Error {
    /// A store error with a code from [`STORE_CODES`]; `None` for any other text.
    #[must_use]
    pub fn store_code(code: &str, message: impl Into<String>) -> Option<Self> {
        STORE_CODES
            .iter()
            .find(|c| **c == code)
            .map(|c| Self::Store(c, message.into()))
    }
}

impl Error {
    /// The stable, namespaced code of this error.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::HermesMissing
            | Self::Unavailable(_)
            | Self::Ws(_)
            | Self::Timeout(_)
            | Self::Io(_) => "hx.engine.unavailable",
            Self::HermesTooOld { .. } | Self::Incompatible(_) => "hx.engine.incompatible",
            Self::InvalidFrame(_) | Self::FrameTooLarge { .. } => "hx.host.invalid_frame",
            Self::UnknownConnection(_) => "hx.host.unknown_connection",
            Self::InvalidInput(_) => "hx.invalid_params",
            Self::Config(_) => "hx.config.invalid",
            Self::ConsentRequired(_) => "hx.host.consent_required",
            Self::SecretsUnavailable(_) => "hx.secrets.unavailable",
            Self::Secrets(_) => "hx.secrets.failed",
            Self::SecretNotFound => "hx.secrets.not_found",
            Self::Os(_) => "hx.host.os",
            Self::Task(_) => "hx.host.task_failed",
            Self::Setup(code, _)
            | Self::Connector(code, _)
            | Self::Store(code, _)
            | Self::Provider(code, _)
            | Self::Bots(code, _) => code,
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
    /// A stable code such as `hx.engine.unavailable`.
    pub code: String,
    /// A human-readable message.
    pub message: String,
}

impl From<Error> for HostError {
    fn from(e: Error) -> Self {
        let code = e.code();
        Self {
            code: code.to_owned(),
            message: user_message(code, &e.to_string()),
        }
    }
}

/// The error catalog shared with the plugin and the UI (`crates/hx-proto/errors.json`).
const CATALOG_JSON: &str = include_str!("../../../../crates/hx-proto/errors.json");

/// The codes whose message is the engine's (or built from what the engine printed): the UI always gets the catalog's
/// sentence for these, never the text.
const ENGINE_CODES: &[&str] = &[
    "hx.engine.unavailable",
    "hx.engine.incompatible",
    "hx.engine.refused",
    "hx.config.invalid",
    "hx.host.invalid_frame",
    "hx.setup.plugin_install_failed",
    "hx.setup.config_failed",
    "hx.setup.verify_failed",
    "hx.setup.runtime_missing",
    "hx.setup.runtime_manifest_invalid",
    "hx.setup.runtime_hash_mismatch",
    "hx.setup.runtime_corrupt",
    "hx.setup.runtime_unpack_failed",
    "hx.connectors.rejected",
    "hx.connectors.signin_failed",
    "hx.connectors.failed",
    "hx.bots.engine_failed",
    "hx.store.install_failed",
];

/// The codes whose message is raw by nature (a panic's text, a cancelled task): the UI always gets the catalog's sentence.
const RAW_CODES: &[&str] = &["hx.host.task_failed"];

/// The fallback for a code the catalog gives no sentence.
const FALLBACK: &str = "hx.engine.refused";

/// How many raw errors Diagnostics keeps.
const RECENT_CAP: usize = 32;

/// `code -> user sentence`, read once from the catalog.
fn sentences() -> &'static HashMap<String, String> {
    static ONCE: OnceLock<HashMap<String, String>> = OnceLock::new();
    ONCE.get_or_init(|| {
        let doc: serde_json::Value = serde_json::from_str(CATALOG_JSON).unwrap_or_default();
        doc["errors"]
            .as_array()
            .map(|all| {
                all.iter()
                    .filter_map(|e| {
                        Some((
                            e["code"].as_str()?.to_owned(),
                            e["user"].as_str()?.to_owned(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// The catalog's sentence for `code`, else the engine fallback's.
#[must_use]
pub fn sentence(code: &str) -> String {
    let all = sentences();
    all.get(code)
        .or_else(|| all.get(FALLBACK))
        .cloned()
        .unwrap_or_else(|| "boopis could not do that. Try again.".to_owned())
}

/// Whether `text` names the engine (any case), which the UI never shows.
#[must_use]
pub fn names_engine(text: &str) -> bool {
    text.to_ascii_lowercase().contains("hermes")
}

/// What the UI shows for an error with this code and raw text: the catalog's sentence when the text is the engine's
/// (an engine code, or any text that names it), else the host's own sentence. Whatever is replaced is recorded for
/// Diagnostics and logged; nothing else is.
#[must_use]
pub fn user_message(code: &str, raw: &str) -> String {
    if !ENGINE_CODES.contains(&code)
        && !RAW_CODES.contains(&code)
        && !names_engine(raw)
        && !raw.trim().is_empty()
    {
        return raw.to_owned();
    }
    record(code, raw);
    sentence(code)
}

/// A text that is not an error of the engine's own but may quote it (a connector's test result, a step's note): kept
/// as it is unless it names the engine, then the sentence of `code`.
#[must_use]
pub fn unless_engine(code: &str, raw: &str) -> String {
    if names_engine(raw) {
        record(code, raw);
        sentence(code)
    } else {
        raw.to_owned()
    }
}

/// What a person reads for `e`: the one mapper's words (the text of a sign-in's end event goes through here too).
#[must_use]
pub fn shown(e: Error) -> String {
    HostError::from(e).message
}

/// `e`, whose message is already plain words, after keeping `raw` (what the transport, the server or the parser actually said)
/// for Diagnostics and the log. The raw text never reaches a message.
#[must_use]
pub fn kept(e: Error, raw: impl AsRef<str>) -> Error {
    record(e.code(), raw.as_ref());
    e
}

/// A blocking task that ended without an answer (`spawn_blocking`'s `JoinError`): a panic, which is a bug in boopis, or a
/// cancellation at shutdown. Never shown as it is: a person reads `hx.host.task_failed`'s sentence and Diagnostics keeps the text.
#[must_use]
pub fn joined(e: &tokio::task::JoinError) -> Error {
    if e.is_panic() {
        tracing::error!(error = %e, "a background task panicked");
    }
    Error::Task(e.to_string())
}

/// One raw error kept for Diagnostics: the code, what was actually said, and when (Unix seconds).
#[derive(Debug, Clone, Serialize, Type)]
pub struct RecentError {
    /// The stable code.
    pub code: String,
    /// The raw text the UI was not shown.
    pub detail: String,
    /// When it happened, in seconds since the Unix epoch.
    #[specta(type = f64)]
    pub at: u64,
}

fn ring() -> &'static Mutex<VecDeque<RecentError>> {
    static RING: OnceLock<Mutex<VecDeque<RecentError>>> = OnceLock::new();
    RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(RECENT_CAP)))
}

/// Keep `raw` for Diagnostics and the log without showing it: for engine words a host sentence replaces.
pub fn keep(code: &str, raw: &str) {
    record(code, raw);
}

fn record(code: &str, raw: &str) {
    tracing::warn!(
        code,
        detail = raw,
        "raw error text kept for Diagnostics; the person read plain words"
    );
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    if let Ok(mut r) = ring().lock() {
        if r.len() == RECENT_CAP {
            r.pop_front();
        }
        r.push_back(RecentError {
            code: code.to_owned(),
            detail: raw.to_owned(),
            at,
        });
    }
}

/// The raw errors of this run that the UI showed as sentences, oldest first (Settings, General, Diagnostics).
#[must_use]
pub fn recent() -> Vec<RecentError> {
    ring()
        .lock()
        .map(|r| r.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_namespaced_and_stable() {
        assert_eq!(Error::HermesMissing.code(), "hx.engine.unavailable");
        assert_eq!(
            Error::Incompatible("x".into()).code(),
            "hx.engine.incompatible"
        );
        assert_eq!(Error::SecretNotFound.code(), "hx.secrets.not_found");
        let e: HostError = Error::ConsentRequired("install").into();
        assert_eq!(e.code, "hx.host.consent_required");
        assert!(e.message.contains("consent"));
    }

    /// Every variant, with engine words in it, reaches the UI as a boopis sentence; the raw words go to Diagnostics.
    #[test]
    fn no_error_shows_the_engine_and_the_raw_text_is_kept() {
        let raw = "hermes refused updates.check: OSError: [Errno 13] Permission denied";
        let all = [
            Error::HermesMissing,
            Error::HermesTooOld {
                found: "0.1.0".into(),
                required: ">=0.23.2".into(),
            },
            Error::Unavailable(raw.into()),
            Error::Incompatible(raw.into()),
            Error::InvalidFrame(raw.into()),
            Error::FrameTooLarge { size: 9, limit: 1 },
            Error::UnknownConnection(3),
            Error::InvalidInput(raw.into()),
            Error::ConsentRequired("installing Hermes"),
            Error::SecretsUnavailable(raw.into()),
            Error::Secrets(raw.into()),
            Error::SecretNotFound,
            Error::Config(raw.into()),
            Error::Io(raw.into()),
            Error::Ws(raw.into()),
            Error::Timeout("hermes gateway ensure"),
            Error::Os(raw.into()),
            Error::Task(raw.into()),
            Error::Setup("hx.setup.config_failed", raw.into()),
            Error::Setup("hx.setup.runtime_corrupt", "anything".into()),
            Error::Connector("hx.connectors.failed", raw.into()),
            Error::Connector(
                "hx.connectors.exists",
                "A connector named x exists already.".into(),
            ),
            Error::Store("hx.store.install_failed", raw.into()),
            Error::Store("hx.store.source_unreachable", raw.into()),
        ];
        for e in all {
            let shown: HostError = e.into();
            assert!(
                !names_engine(&shown.message),
                "{}: {}",
                shown.code,
                shown.message
            );
            assert!(!shown.message.contains("OSError"), "{}", shown.message);
            assert!(shown.code.starts_with("hx."), "{}", shown.code);
        }
        assert!(
            recent()
                .iter()
                .any(|r| r.detail == raw && r.code == "hx.engine.unavailable")
        );
        let own: HostError = Error::Connector(
            "hx.connectors.exists",
            "A connector named x exists already.".into(),
        )
        .into();
        assert_eq!(
            own.message, "A connector named x exists already.",
            "the host's own sentence stays"
        );
    }

    /// A panic in a blocking task reaches a person as a plain sentence; its text is kept for Diagnostics.
    #[tokio::test]
    async fn a_panicking_task_is_a_plain_sentence() {
        let joined = tokio::task::spawn_blocking(|| -> u8 {
            panic!("No CryptoProvider for Rustls. Either enable feature `rustls`")
        })
        .await
        .map_err(|e| joined(&e))
        .unwrap_err();
        assert_eq!(joined.code(), "hx.host.task_failed");
        let seen: HostError = joined.into();
        assert!(!seen.message.contains("panicked"), "{}", seen.message);
        assert!(!seen.message.contains("CryptoProvider"), "{}", seen.message);
        assert!(seen.message.contains("Try again"), "{}", seen.message);
        assert!(
            recent()
                .iter()
                .any(|r| r.code == "hx.host.task_failed" && r.detail.contains("panicked"))
        );
        let plain = kept(
            Error::Provider(
                "hx.provider.unreachable",
                "boopis could not reach GitHub.".into(),
            ),
            "io: Connection refused (os error 111)",
        );
        assert_eq!(shown(plain), "boopis could not reach GitHub.");
        assert!(recent().iter().any(|r| r.detail.contains("os error 111")));
    }

    /// Every code the host can raise has a sentence of its own in the catalog, and no sentence names the engine.
    #[test]
    fn the_catalog_has_a_sentence_for_every_host_code() {
        for code in ENGINE_CODES.iter().chain(RAW_CODES) {
            assert!(
                sentences().contains_key(*code),
                "{code} has no user sentence"
            );
        }
        for (code, s) in sentences() {
            assert!(!names_engine(s), "{code}: {s}");
            assert!(!s.contains('\u{2014}') && !s.contains('!'), "{code}: {s}");
        }
        for code in [
            "hx.engine.unavailable",
            "hx.secrets.unavailable",
            "hx.setup.engine_missing",
            "hx.host.consent_required",
        ] {
            assert!(sentences().contains_key(code), "{code}");
        }
    }
}
