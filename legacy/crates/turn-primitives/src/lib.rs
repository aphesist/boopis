pub use hypotaxis_contracts::*;

pub mod exec;
pub mod pack;
pub mod ship;

pub use exec::{exec, global_exec_manager, ExecManager, ParallelToolOutput, ToolHandler};
pub use pack::pack;
pub use ship::{is_sensitive_path, requires_human_gate, ship, ship_with_gate};

#[derive(Debug, thiserror::Error)]
pub enum PrimitiveError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid workspace root: {0}")]
    InvalidRoot(String),
    #[error("Invalid regex query: {0}")]
    InvalidQuery(#[from] regex::Error),
    #[error("Unsafe path outside workspace root: {0}")]
    UnsafePath(String),
    #[error("Kernel error: {0}")]
    Kernel(#[from] contraprova_kernel::KernelError),
}

pub fn primitives_ready() -> bool {
    true
}
