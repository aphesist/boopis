//! `hx.describe`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The protocol identifier. Peers gate features on capabilities, not on this string.
pub const PROTOCOL: &str = "hx-v1";

/// Result of `hx.describe`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DescribeResult {
    /// The `hx` binary's semantic version.
    pub version: String,
    /// Always `"hx-v1"`.
    pub protocol: String,
    /// Sorted capability strings, such as `txn.edit.diff`. Gate features on these.
    pub capabilities: Vec<String>,
}
