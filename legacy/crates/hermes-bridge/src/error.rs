use thiserror::Error;

/// Errors returned by the Hermes bridge, KV-cache stabilizer, and DirectSDK runner.
#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Claude CLI binary not found: {0}")]
    ClaudeCliNotFound(String),

    #[error("Invalid DirectSDK configuration: {0}")]
    InvalidConfig(String),

    #[error("DirectSDK process failed (exit {code:?}): {message}")]
    ProcessFailed { code: Option<i32>, message: String },
}
