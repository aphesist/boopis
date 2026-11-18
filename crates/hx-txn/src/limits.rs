//! Caps on everything that grows. Defaults are data, not scattered literals.

/// Size and count limits for one transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Most edits in one request.
    pub max_edits: usize,
    /// Largest file a transaction will read or write.
    pub max_file_bytes: u64,
    /// Most bytes of file content one transaction holds in memory (originals and results).
    pub max_total_bytes: u64,
    /// Most lines in a `closest` snippet.
    pub snippet_lines: usize,
    /// Most bytes in a `closest` snippet.
    pub snippet_bytes: usize,
    /// Most candidate line numbers listed for an ambiguous match.
    pub max_candidates: usize,
    /// How long to wait for the workspace lock before giving up.
    pub lock_timeout: std::time::Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_edits: 1_000,
            max_file_bytes: 32 * 1024 * 1024,
            max_total_bytes: 256 * 1024 * 1024,
            snippet_lines: 40,
            snippet_bytes: 4_000,
            max_candidates: 20,
            lock_timeout: std::time::Duration::from_secs(30),
        }
    }
}
