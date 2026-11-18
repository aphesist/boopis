pub mod cache_stabilizer;
pub mod direct_sdk;
pub mod discovery;
pub mod error;

pub use hypotaxis_contracts::*;

pub use cache_stabilizer::{
    compute_shared_prefix_breakpoint, estimate_tokens, stabilize_messages, stabilize_prefix,
    strip_volatile_reminders, CacheMessage, StabilizedConversation, StabilizedPrefix,
    ThinkingBlock, MIN_CACHE_PREFIX_TOKENS,
};
pub use direct_sdk::{
    cleanup_isolated_workdir, create_isolated_workdir, is_competing_native_tool,
    map_mcp_tool_alias, parse_stream_json_line, parse_stream_json_ndjson, run_direct_sdk,
    to_mcp_tool_name, ClaudeDirectSdkConfig, CompoundPrimitive, DirectSdkInvocation,
    StreamJsonEvent, StreamJsonSummary, StreamThinkingBlock, StreamToolUse, TokenUsage,
    COMPETING_NATIVE_TOOLS, HERMES_MCP_TOOLS,
};
pub use discovery::{
    parse_install_stamp, prioritized_providers, probe_hermes_bridge, probe_hermes_bridge_async,
    probe_hermes_bridge_with, DiscoveryOptions, HermesDiscoveryReport, InstallStamp,
};
pub use error::BridgeError;

pub fn bridge_ready() -> bool {
    true
}
