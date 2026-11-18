use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command as TokioCommand;

use crate::error::BridgeError;

static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Competing native Claude Code tools that are disabled so execution goes exclusively
/// through Hypotaxis's 3 compound primitives (`pack`, `exec`, `ship`).
pub const COMPETING_NATIVE_TOOLS: &[&str] = &[
    "Bash",
    "Read",
    "Edit",
    "Write",
    "MultiEdit",
    "Glob",
    "Grep",
    "LS",
    "WebFetch",
    "WebSearch",
    "NotebookEdit",
    "NotebookRead",
    "Task",
    "TodoWrite",
];

/// The 3 Hermes-exposed MCP aliases corresponding to Hypotaxis's compound primitives.
pub const HERMES_MCP_TOOLS: &[&str] = &[
    "mcp__hermes__pack",
    "mcp__hermes__exec",
    "mcp__hermes__ship",
];

/// Canonical Hypotaxis compound primitives mapped from `mcp__hermes__*` tool aliases.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CompoundPrimitive {
    Pack,
    Exec,
    Ship,
}

/// Maps Claude Code / Hermes MCP tool names (`mcp__hermes__pack`, `mcp__hermes__exec`,
/// `mcp__hermes__ship`) to the canonical `CompoundPrimitive`.
pub fn map_mcp_tool_alias(tool_name: &str) -> Option<CompoundPrimitive> {
    match tool_name.trim() {
        "mcp__hermes__pack" | "hermes__pack" | "pack" => Some(CompoundPrimitive::Pack),
        "mcp__hermes__exec" | "hermes__exec" | "exec" => Some(CompoundPrimitive::Exec),
        "mcp__hermes__ship" | "hermes__ship" | "ship" => Some(CompoundPrimitive::Ship),
        _ => None,
    }
}

/// Returns the canonical MCP tool name expected by Claude Code CLI for a `CompoundPrimitive`.
pub fn to_mcp_tool_name(primitive: CompoundPrimitive) -> &'static str {
    match primitive {
        CompoundPrimitive::Pack => "mcp__hermes__pack",
        CompoundPrimitive::Exec => "mcp__hermes__exec",
        CompoundPrimitive::Ship => "mcp__hermes__ship",
    }
}

/// Returns true if `tool_name` is one of Claude Code's built-in tools disallowed in DirectSDK mode.
pub fn is_competing_native_tool(tool_name: &str) -> bool {
    COMPETING_NATIVE_TOOLS
        .iter()
        .any(|t| t.eq_ignore_ascii_case(tool_name.trim()))
}

/// Configuration for running unmodified `claude -p --output-format stream-json --verbose`
/// over the user's Claude Pro/Max subscription without an API key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClaudeDirectSdkConfig {
    pub claude_bin: PathBuf,
    pub model: Option<String>,
    pub working_dir: Option<PathBuf>,
    pub disallowed_tools: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub mcp_config_path: Option<PathBuf>,
    pub permission_mode: Option<String>,
    pub max_turns: Option<u32>,
    pub system_prompt: Option<String>,
    pub exclude_dynamic_system_prompt_sections: bool,
    pub extra_env_removals: Vec<String>,
    pub extra_args: Vec<String>,
}

impl Default for ClaudeDirectSdkConfig {
    fn default() -> Self {
        Self {
            claude_bin: PathBuf::from("claude"),
            model: None,
            working_dir: None,
            disallowed_tools: COMPETING_NATIVE_TOOLS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            allowed_tools: HERMES_MCP_TOOLS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            mcp_config_path: None,
            permission_mode: Some("dontAsk".to_string()),
            max_turns: None,
            system_prompt: None,
            exclude_dynamic_system_prompt_sections: false,
            extra_env_removals: Vec::new(),
            extra_args: Vec::new(),
        }
    }
}

/// Inspectable command & scrubbed environment invocation built from `ClaudeDirectSdkConfig`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectSdkInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub isolated_temp_dir: bool,
    pub removed_env_vars: Vec<String>,
    pub sanitized_env: BTreeMap<String, String>,
}

impl DirectSdkInvocation {
    /// Builds an invocation using the current process environment (with `ANTHROPIC_API_KEY` scrubbed)
    /// and creates an isolated temporary working directory if `config.working_dir` is `None`.
    pub fn build(config: &ClaudeDirectSdkConfig, prompt: &str) -> Result<Self, BridgeError> {
        let current_env: BTreeMap<String, String> = std::env::vars().collect();
        Self::build_with_env(config, prompt, &current_env)
    }

    /// Builds an invocation against an explicit `base_env` map (ideal for deterministic tests).
    pub fn build_with_env(
        config: &ClaudeDirectSdkConfig,
        prompt: &str,
        base_env: &BTreeMap<String, String>,
    ) -> Result<Self, BridgeError> {
        if config.claude_bin.as_os_str().is_empty() {
            return Err(BridgeError::InvalidConfig(
                "claude_bin cannot be empty".to_string(),
            ));
        }

        let (cwd, isolated_temp_dir) = match &config.working_dir {
            Some(dir) => {
                std::fs::create_dir_all(dir)?;
                (dir.clone(), false)
            }
            None => (create_isolated_workdir()?, true),
        };

        let mut args = vec![
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
        ];

        if !config.disallowed_tools.is_empty() {
            args.push("--disallowedTools".to_string());
            args.push(config.disallowed_tools.join(","));
        }

        if !config.allowed_tools.is_empty() {
            args.push("--allowedTools".to_string());
            args.push(config.allowed_tools.join(","));
        }

        if let Some(model) = config.model.as_deref().filter(|m| !m.trim().is_empty()) {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        if let Some(mcp_path) = &config.mcp_config_path {
            args.push("--mcp-config".to_string());
            args.push(mcp_path.to_string_lossy().into_owned());
        }

        if let Some(mode) = config
            .permission_mode
            .as_deref()
            .filter(|m| !m.trim().is_empty())
        {
            args.push("--permission-mode".to_string());
            args.push(mode.to_string());
        }

        if let Some(turns) = config.max_turns {
            args.push("--max-turns".to_string());
            args.push(turns.to_string());
        }

        if let Some(sys) = config
            .system_prompt
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            args.push("--append-system-prompt".to_string());
            args.push(sys.to_string());
        }

        if config.exclude_dynamic_system_prompt_sections {
            args.push("--exclude-dynamic-system-prompt-sections".to_string());
        }

        args.extend(config.extra_args.iter().cloned());
        args.push("--".to_string());
        args.push(prompt.to_string());

        let mut removed_env_vars = vec!["ANTHROPIC_API_KEY".to_string()];
        for extra in &config.extra_env_removals {
            if !removed_env_vars.iter().any(|existing| existing == extra) {
                removed_env_vars.push(extra.clone());
            }
        }

        let mut sanitized_env = base_env.clone();
        for key in &removed_env_vars {
            sanitized_env.remove(key);
        }

        Ok(Self {
            program: config.claude_bin.clone(),
            args,
            cwd,
            isolated_temp_dir,
            removed_env_vars,
            sanitized_env,
        })
    }

    /// Materializes a `std::process::Command` with isolated `current_dir` and explicit
    /// `env_remove("ANTHROPIC_API_KEY")` (plus any extra removed env vars).
    pub fn to_std_command(&self) -> StdCommand {
        let mut cmd = StdCommand::new(&self.program);
        cmd.current_dir(&self.cwd);
        cmd.args(&self.args);
        cmd.env_remove("ANTHROPIC_API_KEY");
        for key in &self.removed_env_vars {
            cmd.env_remove(key);
        }
        cmd
    }

    /// Materializes a `tokio::process::Command` with isolated `current_dir` and explicit
    /// `env_remove("ANTHROPIC_API_KEY")` (plus any extra removed env vars).
    pub fn to_tokio_command(&self) -> TokioCommand {
        let mut cmd = TokioCommand::new(&self.program);
        cmd.current_dir(&self.cwd);
        cmd.args(&self.args);
        cmd.env_remove("ANTHROPIC_API_KEY");
        for key in &self.removed_env_vars {
            cmd.env_remove(key);
        }
        cmd
    }
}

/// Token and prompt-cache usage metrics emitted in `stream-json` events.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
}

/// Thinking block captured from a `stream-json` assistant message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StreamThinkingBlock {
    pub thinking: String,
    pub signature: Option<String>,
}

/// Tool call parsed from an assistant message and mapped to `CompoundPrimitive` when applicable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StreamToolUse {
    pub id: String,
    pub name: String,
    pub primitive: Option<CompoundPrimitive>,
    pub input: Value,
}

/// Parsed NDJSON event emitted by `claude -p --output-format stream-json --verbose`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StreamJsonEvent {
    SystemInit {
        session_id: Option<String>,
        model: Option<String>,
        tools: Vec<String>,
        raw: Value,
    },
    AssistantMessage {
        id: Option<String>,
        model: Option<String>,
        text_parts: Vec<String>,
        thinking_blocks: Vec<StreamThinkingBlock>,
        tool_uses: Vec<StreamToolUse>,
        usage: Option<TokenUsage>,
        raw: Value,
    },
    UserToolResult {
        tool_use_id: Option<String>,
        content: Value,
        is_error: bool,
        raw: Value,
    },
    StreamDelta {
        event: Value,
    },
    Result {
        subtype: Option<String>,
        is_error: bool,
        result: Option<String>,
        session_id: Option<String>,
        duration_ms: Option<u64>,
        num_turns: Option<u32>,
        total_cost_usd: Option<f64>,
        usage: Option<TokenUsage>,
        raw: Value,
    },
    Error {
        error_type: Option<String>,
        message: String,
        raw: Value,
    },
    Unknown {
        event_type: String,
        raw: Value,
    },
}

/// Aggregated summary of a parsed `stream-json` session.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct StreamJsonSummary {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub assistant_text: String,
    pub final_result: Option<String>,
    pub is_error: bool,
    pub tool_uses: Vec<StreamToolUse>,
    pub thinking_blocks: Vec<StreamThinkingBlock>,
    pub usage: TokenUsage,
}

impl StreamJsonSummary {
    /// Aggregates parsed `StreamJsonEvent`s into final text, mapped primitives, and token usage.
    pub fn from_events(events: &[StreamJsonEvent]) -> Self {
        let mut summary = Self::default();
        let mut text_chunks: Vec<String> = Vec::new();
        let mut saw_result_usage = false;

        for ev in events {
            match ev {
                StreamJsonEvent::SystemInit {
                    session_id, model, ..
                } => {
                    if summary.session_id.is_none() {
                        summary.session_id = session_id.clone();
                    }
                    if summary.model.is_none() {
                        summary.model = model.clone();
                    }
                }
                StreamJsonEvent::AssistantMessage {
                    model,
                    text_parts,
                    thinking_blocks,
                    tool_uses,
                    usage,
                    ..
                } => {
                    if summary.model.is_none() {
                        summary.model = model.clone();
                    }
                    text_chunks.extend(text_parts.iter().cloned());
                    summary.thinking_blocks.extend(thinking_blocks.iter().cloned());
                    summary.tool_uses.extend(tool_uses.iter().cloned());
                    if !saw_result_usage {
                        if let Some(u) = usage {
                            summary.usage.input_tokens += u.input_tokens;
                            summary.usage.output_tokens += u.output_tokens;
                            summary.usage.cache_creation_input_tokens +=
                                u.cache_creation_input_tokens;
                            summary.usage.cache_read_input_tokens += u.cache_read_input_tokens;
                        }
                    }
                }
                StreamJsonEvent::Result {
                    is_error,
                    result,
                    session_id,
                    usage,
                    ..
                } => {
                    if *is_error {
                        summary.is_error = true;
                    }
                    if session_id.is_some() {
                        summary.session_id = session_id.clone();
                    }
                    if result.is_some() {
                        summary.final_result = result.clone();
                    }
                    if let Some(u) = usage {
                        summary.usage = u.clone();
                        saw_result_usage = true;
                    }
                }
                StreamJsonEvent::Error { .. } => {
                    summary.is_error = true;
                }
                StreamJsonEvent::UserToolResult { .. }
                | StreamJsonEvent::StreamDelta { .. }
                | StreamJsonEvent::Unknown { .. } => {}
            }
        }

        summary.assistant_text = text_chunks.join("");
        summary
    }
}

/// Parses a single NDJSON line from `claude -p --output-format stream-json --verbose`.
pub fn parse_stream_json_line(line: &str) -> Result<Option<StreamJsonEvent>, BridgeError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let raw: Value = serde_json::from_str(trimmed)?;
    let event_type = raw
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let parsed = match event_type.as_str() {
        "system" => {
            let session_id = raw
                .get("session_id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let model = raw
                .get("model")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let tools = raw
                .get("tools")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default();
            StreamJsonEvent::SystemInit {
                session_id,
                model,
                tools,
                raw,
            }
        }
        "assistant" => parse_assistant_event(raw),
        "user" => parse_user_event(raw),
        "stream_event" => {
            let event = raw.get("event").cloned().unwrap_or(raw);
            StreamJsonEvent::StreamDelta { event }
        }
        "result" => {
            let subtype = raw
                .get("subtype")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let is_error = raw.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let result = raw
                .get("result")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let session_id = raw
                .get("session_id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let duration_ms = raw.get("duration_ms").and_then(Value::as_u64);
            let num_turns = raw
                .get("num_turns")
                .and_then(Value::as_u64)
                .and_then(|v| u32::try_from(v).ok());
            let total_cost_usd = raw.get("total_cost_usd").and_then(Value::as_f64);
            let usage = raw
                .get("usage")
                .cloned()
                .and_then(|u| serde_json::from_value::<TokenUsage>(u).ok());
            StreamJsonEvent::Result {
                subtype,
                is_error,
                result,
                session_id,
                duration_ms,
                num_turns,
                total_cost_usd,
                usage,
                raw,
            }
        }
        "error" => {
            let err_obj = raw.get("error");
            let error_type = err_obj
                .and_then(|e| e.get("type"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let message = err_obj
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .or_else(|| raw.get("message").and_then(Value::as_str))
                .unwrap_or("unknown error")
                .to_string();
            StreamJsonEvent::Error {
                error_type,
                message,
                raw,
            }
        }
        _ => StreamJsonEvent::Unknown { event_type, raw },
    };

    Ok(Some(parsed))
}

/// Parses a multi-line `stream-json` NDJSON payload into `Vec<StreamJsonEvent>`.
pub fn parse_stream_json_ndjson(ndjson: &str) -> Result<Vec<StreamJsonEvent>, BridgeError> {
    let mut events = Vec::new();
    for line in ndjson.lines() {
        if let Some(ev) = parse_stream_json_line(line)? {
            events.push(ev);
        }
    }
    Ok(events)
}

/// Executes an invocation asynchronously via Tokio and parses its `stream-json` stdout.
pub async fn run_direct_sdk(
    config: &ClaudeDirectSdkConfig,
    prompt: &str,
) -> Result<StreamJsonSummary, BridgeError> {
    let invocation = DirectSdkInvocation::build(config, prompt)?;
    let mut cmd = invocation.to_tokio_command();
    let output_res = cmd.output().await;
    let _ = cleanup_isolated_workdir(&invocation);

    let output = output_res.map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            BridgeError::ClaudeCliNotFound(invocation.program.display().to_string())
        } else {
            BridgeError::Io(err)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(BridgeError::ProcessFailed {
            code: output.status.code(),
            message: stderr,
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let events = parse_stream_json_ndjson(&stdout)?;
    Ok(StreamJsonSummary::from_events(&events))
}

/// Removes an isolated temporary directory if it was auto-created by `DirectSdkInvocation`.
pub fn cleanup_isolated_workdir(invocation: &DirectSdkInvocation) -> std::io::Result<()> {
    if invocation.isolated_temp_dir && invocation.cwd.exists() {
        std::fs::remove_dir_all(&invocation.cwd)?;
    }
    Ok(())
}

/// Builds an isolated temporary working directory path under `std::env::temp_dir()`.
pub fn create_isolated_workdir() -> std::io::Result<PathBuf> {
    let seq = WORKDIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let dir = std::env::temp_dir().join(format!("hypo-directsdk-{pid}-{seq}"));
    ensure_dir(&dir)?;
    Ok(dir)
}

fn ensure_dir(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

fn parse_assistant_event(raw: Value) -> StreamJsonEvent {
    let msg = raw.get("message").unwrap_or(&raw);
    let id = msg.get("id").and_then(Value::as_str).map(ToString::to_string);
    let model = msg
        .get("model")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let usage = msg
        .get("usage")
        .cloned()
        .and_then(|u| serde_json::from_value::<TokenUsage>(u).ok());

    let mut text_parts = Vec::new();
    let mut thinking_blocks = Vec::new();
    let mut tool_uses = Vec::new();

    if let Some(blocks) = msg.get("content").and_then(Value::as_array) {
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(txt) = block.get("text").and_then(Value::as_str) {
                        text_parts.push(txt.to_string());
                    }
                }
                Some("thinking") => {
                    let thinking = block
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let signature = block
                        .get("signature")
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    thinking_blocks.push(StreamThinkingBlock {
                        thinking,
                        signature,
                    });
                }
                Some("tool_use") => {
                    let id = block
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let name = block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let primitive = map_mcp_tool_alias(&name);
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    tool_uses.push(StreamToolUse {
                        id,
                        name,
                        primitive,
                        input,
                    });
                }
                _ => {}
            }
        }
    }

    StreamJsonEvent::AssistantMessage {
        id,
        model,
        text_parts,
        thinking_blocks,
        tool_uses,
        usage,
        raw,
    }
}

fn parse_user_event(raw: Value) -> StreamJsonEvent {
    let msg = raw.get("message").unwrap_or(&raw);
    let first_block = msg
        .get("content")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first());

    let tool_use_id = first_block
        .and_then(|b| b.get("tool_use_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let content = first_block
        .and_then(|b| b.get("content"))
        .cloned()
        .unwrap_or(Value::Null);
    let is_error = first_block
        .and_then(|b| b.get("is_error"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    StreamJsonEvent::UserToolResult {
        tool_use_id,
        content,
        is_error,
        raw,
    }
}
