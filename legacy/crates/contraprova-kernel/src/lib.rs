use std::path::Path;

pub use hypotaxis_contracts::*;

pub mod gate;
pub mod lanes;
pub mod ledger;
pub mod router;

pub use gate::{GateConfig, GateFailureKind, GateReport, KernelGate};
pub use lanes::{ClashKind, ClashReport, ContractLaneRegistry, LaneClash};
pub use ledger::{
    project_tokens_cost, Ledger, UsageCostProjection, UsageRecordInput, GENESIS_HASH,
};
pub use router::{CascadeRouter, RouteDecision};

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Glob pattern error: {0}")]
    Glob(#[from] globset::Error),
    #[error("Ledger integrity violation at seq {seq}: {reason}")]
    InvalidChain { seq: u64, reason: String },
    #[error("Duplicate contract lane: {0}")]
    DuplicateLane(String),
    #[error("Unknown contract lane: {0}")]
    UnknownLane(String),
    #[error("Invalid kernel input: {0}")]
    InvalidInput(String),
}

pub fn kernel_ready() -> bool {
    true
}

/// Generate a fresh UUID v4 correlation identifier for ledger/gate runs.
pub fn new_correlation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Normalize a workspace-relative path to forward slashes without leading `./` or `/`.
pub fn normalize_rel_path(raw: &str) -> String {
    let replaced = raw.trim().replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for seg in replaced.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        parts.push(seg);
    }
    parts.join("/")
}

/// Normalize a path against `root` if it is absolute and sits under `root`.
pub fn normalize_against_root(root: &Path, raw: &str) -> String {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        if let Ok(stripped) = candidate.strip_prefix(root) {
            return normalize_rel_path(&stripped.to_string_lossy());
        }
        if let (Ok(canon_root), Ok(canon_cand)) = (root.canonicalize(), candidate.canonicalize()) {
            if let Ok(stripped) = canon_cand.strip_prefix(&canon_root) {
                return normalize_rel_path(&stripped.to_string_lossy());
            }
        }
    }
    normalize_rel_path(raw)
}
