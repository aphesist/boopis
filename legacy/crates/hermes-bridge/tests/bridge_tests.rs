use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use hermes_bridge::{
    cleanup_isolated_workdir, compute_shared_prefix_breakpoint, is_competing_native_tool,
    map_mcp_tool_alias, parse_stream_json_line, parse_stream_json_ndjson, probe_hermes_bridge,
    probe_hermes_bridge_async, probe_hermes_bridge_with, stabilize_messages, stabilize_prefix,
    to_mcp_tool_name, CacheMessage, ClaudeDirectSdkConfig, CompoundPrimitive, DirectSdkInvocation,
    DiscoveryOptions, ProviderKind, StreamJsonEvent, StreamJsonSummary, ThinkingBlock,
    MIN_CACHE_PREFIX_TOKENS,
};

static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(1);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let id = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("hypo-bridge-{label}-{}-{id}", std::process::id()));
        fs::create_dir_all(&path).expect("create temp test dir");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn discovery_reads_install_stamp_and_prioritizes_providers() {
    let tmp = TempDir::new("discovery-full");
    let hermes_home = tmp.path.join("hermes");
    let hermes_agent = hermes_home.join("hermes-agent");
    let bin_dir = hermes_home.join("bin");
    fs::create_dir_all(&hermes_agent).unwrap();
    fs::create_dir_all(&bin_dir).unwrap();

    fs::write(
        hermes_agent.join("install-stamp.json"),
        r#"{
            "schemaVersion": 2,
            "commit": "ae2a81ccc00e9b7c06301523e5bb09608397149c",
            "baseVersion": "0.23.2",
            "displayVersion": "0.23.2"
        }"#,
    )
    .unwrap();

    let hermes_exe_name = if cfg!(windows) { "hermes.exe" } else { "hermes" };
    let claude_bin_name = if cfg!(windows) { "claude.cmd" } else { "claude" };
    fs::write(bin_dir.join(hermes_exe_name), "stub").unwrap();
    fs::write(bin_dir.join(claude_bin_name), "stub").unwrap();

    let mut env = BTreeMap::new();
    env.insert("GEMINI_API_KEY".to_string(), "test-key".to_string());
    env.insert("DEEPSEEK_API_KEY".to_string(), "test-key".to_string());

    let opts = DiscoveryOptions {
        hermes_home_override: Some(hermes_home.clone()),
        search_path_dirs: Some(vec![bin_dir]),
        ollama_reachable_override: Some(true),
        env_overrides: Some(env),
        ..Default::default()
    };

    let report = probe_hermes_bridge_with(&opts);
    assert!(report.status.hermes_found);
    assert_eq!(report.status.hermes_version, "0.23.2");
    assert!(report.status.claude_cli_found);
    assert!(report.status.cache_stabilizer_enabled);
    assert_eq!(report.hermes_agent_dir, Some(hermes_agent));
    assert!(report.hermes_bin.is_some());
    assert!(report.claude_bin.is_some());

    let kinds: Vec<ProviderKind> = report.status.providers.iter().map(|p| p.kind).collect();
    assert_eq!(
        kinds,
        vec![
            ProviderKind::ClaudeDirectSdk,
            ProviderKind::GeminiNanoBanana,
            ProviderKind::LocalOllama,
            ProviderKind::CustomOpenAi,
        ]
    );
    assert!(report.status.providers.iter().all(|p| p.connected));
    assert!(report.status.providers[0].zero_api_cost);
    assert!(report.status.providers[2].zero_api_cost);
}

#[test]
fn discovery_handles_missing_hermes_and_claude_gracefully() {
    let tmp = TempDir::new("discovery-empty");
    let opts = DiscoveryOptions {
        hermes_home_override: Some(tmp.path.join("missing-hermes")),
        user_home_override: Some(tmp.path.join("empty-home")),
        local_appdata_override: Some(tmp.path.join("empty-local")),
        search_path_dirs: Some(vec![tmp.path.join("empty-bin")]),
        ollama_reachable_override: Some(false),
        env_overrides: Some(BTreeMap::new()),
        ..Default::default()
    };

    let report = probe_hermes_bridge_with(&opts);
    assert!(!report.status.hermes_found);
    assert_eq!(report.status.hermes_version, "");
    assert!(!report.status.claude_cli_found);
    assert_eq!(report.status.providers.len(), 4);
    assert_eq!(
        report.status.providers[0].kind,
        ProviderKind::ClaudeDirectSdk
    );
    assert!(report.status.providers.iter().all(|p| !p.connected));
}

#[tokio::test]
async fn discovery_async_supports_hermes_home_env_and_dot_hermes() {
    let tmp = TempDir::new("discovery-async");
    let dot_hermes = tmp.path.join(".hermes");
    fs::create_dir_all(&dot_hermes).unwrap();
    fs::write(
        dot_hermes.join("install-stamp.json"),
        r#"{ "displayVersion": "0.24.0-rc1" }"#,
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HERMES_HOME".to_string(),
        dot_hermes.to_string_lossy().into_owned(),
    );

    let opts = DiscoveryOptions {
        user_home_override: Some(tmp.path.clone()),
        search_path_dirs: Some(Vec::new()),
        ollama_reachable_override: Some(false),
        env_overrides: Some(env),
        ..Default::default()
    };

    let report = probe_hermes_bridge_async(&opts).await.unwrap();
    assert!(report.status.hermes_found);
    assert_eq!(report.status.hermes_version, "0.24.0-rc1");
    assert_eq!(report.status.providers.len(), 4);

    // Smoke-check default host probe never panics.
    let host_status = probe_hermes_bridge();
    assert_eq!(host_status.providers[0].kind, ProviderKind::ClaudeDirectSdk);
}

#[test]
fn cache_stabilizer_strips_volatile_reminders_and_preserves_signed_thinking() {
    let req_a = "\
You are Hypotaxis.\n\
Current date: 2026-11-18\n\
TEMPORAL ANCHORING: The current date is 2026-11-18.\n\
Account email: alice@example.com\n\
<system-reminder>\n\
Signed in as alice@example.com\n\
Session timestamp: 2026-11-18T05:00:00Z\n\
</system-reminder>\n\
\n\
<thinking>\n\
Current date: 2026-11-18 internal signed thought must stay identical.\n\
</thinking>\n\
```rust\n\
let current_date = \"Current date: 2026-11-18\";\n\
```\n\
Static system instructions remain untouched.";

    let req_b = "\
You are Hypotaxis.\n\
Current date: 2026-11-19\n\
TEMPORAL ANCHORING: The current date is 2026-11-19.\n\
Account email: bob@example.com\n\
<system-reminder>\n\
Signed in as bob@example.com\n\
Session timestamp: 2026-11-19T09:30:00Z\n\
</system-reminder>\n\
\n\
<thinking>\n\
Current date: 2026-11-18 internal signed thought must stay identical.\n\
</thinking>\n\
```rust\n\
let current_date = \"Current date: 2026-11-18\";\n\
```\n\
Static system instructions remain untouched.";

    let stab_a = stabilize_prefix(req_a);
    let stab_b = stabilize_prefix(req_b);

    assert_eq!(stab_a.stabilized_text, stab_b.stabilized_text);
    assert_eq!(stab_a.prefix_hash, stab_b.prefix_hash);
    assert_eq!(stab_a.stripped_lines, 5);
    assert_eq!(stab_b.stripped_lines, 5);
    assert!(stab_a.signed_thinking_preserved);
    assert!(stab_a
        .stabilized_text
        .contains("Current date: 2026-11-18 internal signed thought must stay identical."));
    assert!(stab_a
        .stabilized_text
        .contains("let current_date = \"Current date: 2026-11-18\";"));
    assert!(!stab_a.stabilized_text.contains("alice@example.com"));
    assert!(!stab_b.stabilized_text.contains("bob@example.com"));
    assert!(!stab_a.stabilized_text.contains("<system-reminder>"));
}

#[test]
fn cache_stabilizer_computes_cache_upto_only_at_or_above_512_tokens() {
    let small = "Short prompt prefix with fewer than 512 tokens.\nCurrent date: 2026-11-18";
    let small_res = stabilize_prefix(small);
    assert!(small_res.estimated_tokens < MIN_CACHE_PREFIX_TOKENS);
    assert_eq!(small_res.cache_upto, None);
    assert_eq!(small_res.cacheable_tokens, 0);

    let big_body = vec!["stable_context_token"; 600].join(" ");
    let big = format!("Current date: 2026-11-18\n{big_body}");
    let big_res = stabilize_prefix(&big);
    assert!(big_res.estimated_tokens >= MIN_CACHE_PREFIX_TOKENS);
    assert_eq!(big_res.cache_upto, Some(big_res.stabilized_text.len()));
    assert_eq!(big_res.cacheable_tokens, big_res.estimated_tokens);
}

#[test]
fn cache_stabilizer_shared_message_prefix_preserves_thinking_signatures() {
    let shared_chunk = vec!["architecture_invariant"; 540].join(" ");
    let thinking = vec![ThinkingBlock {
        thinking: "Checking signed thinking Current date: 2026-11-18".to_string(),
        signature: Some("sig_deadbeef_01".to_string()),
    }];

    let history_a = vec![
        CacheMessage::new(
            "system",
            format!("Current date: 2026-11-18\nAccount email: a@x.io\n{shared_chunk}"),
        ),
        CacheMessage::with_thinking("assistant", "Planned edits", thinking.clone()),
        CacheMessage::new("user", "Turn A question"),
    ];

    let history_b = vec![
        CacheMessage::new(
            "system",
            format!("Current date: 2026-11-19\nAccount email: b@x.io\n{shared_chunk}"),
        ),
        CacheMessage::with_thinking("assistant", "Planned edits", thinking.clone()),
        CacheMessage::new("user", "Turn B follow-up"),
    ];

    let conv = compute_shared_prefix_breakpoint(&history_a, &history_b);
    assert_eq!(conv.messages.len(), 2);
    assert_eq!(conv.cache_upto, Some(1));
    assert!(conv.estimated_cacheable_tokens >= MIN_CACHE_PREFIX_TOKENS);
    assert!(conv.signed_thinking_preserved);
    assert_eq!(conv.messages[1].thinking_blocks, thinking);

    let short_only = stabilize_messages(&[CacheMessage::new("system", "Tiny prefix")], None);
    assert_eq!(short_only.cache_upto, None);
    assert_eq!(short_only.estimated_cacheable_tokens, 0);
}

#[test]
fn direct_sdk_builds_isolated_command_and_scrubs_anthropic_api_key() {
    let mut env = BTreeMap::new();
    env.insert(
        "ANTHROPIC_API_KEY".to_string(),
        "sk-ant-should-never-pass".to_string(),
    );
    env.insert("PATH".to_string(), "/usr/local/bin".to_string());

    let cfg = ClaudeDirectSdkConfig {
        model: Some("claude-sonnet-4-6".to_string()),
        ..Default::default()
    };

    let invocation = DirectSdkInvocation::build_with_env(&cfg, "Inspect src/lib.rs", &env).unwrap();

    assert!(invocation.isolated_temp_dir);
    assert!(invocation.cwd.exists());
    assert!(invocation.cwd.starts_with(std::env::temp_dir()));
    assert!(!invocation.sanitized_env.contains_key("ANTHROPIC_API_KEY"));
    assert_eq!(
        invocation.sanitized_env.get("PATH").map(String::as_str),
        Some("/usr/local/bin")
    );
    assert!(invocation
        .removed_env_vars
        .contains(&"ANTHROPIC_API_KEY".to_string()));

    assert_eq!(
        &invocation.args[0..4],
        &["-p", "--output-format", "stream-json", "--verbose"]
    );
    assert!(invocation.args.contains(&"--disallowedTools".to_string()));
    assert!(invocation.args.contains(&"--allowedTools".to_string()));
    let disallowed_idx = invocation
        .args
        .iter()
        .position(|a| a == "--disallowedTools")
        .unwrap();
    assert!(invocation.args[disallowed_idx + 1].contains("Bash"));
    assert!(invocation.args[disallowed_idx + 1].contains("Read"));
    let allowed_idx = invocation
        .args
        .iter()
        .position(|a| a == "--allowedTools")
        .unwrap();
    assert_eq!(
        invocation.args[allowed_idx + 1],
        "mcp__hermes__pack,mcp__hermes__exec,mcp__hermes__ship"
    );
    assert_eq!(invocation.args.last().map(String::as_str), Some("Inspect src/lib.rs"));

    let std_cmd = invocation.to_std_command();
    assert_eq!(std_cmd.get_current_dir(), Some(invocation.cwd.as_path()));
    let removed_entry = std_cmd
        .get_envs()
        .find(|(k, _)| *k == OsStr::new("ANTHROPIC_API_KEY"));
    assert_eq!(removed_entry, Some((OsStr::new("ANTHROPIC_API_KEY"), None)));

    let tokio_cmd = invocation.to_tokio_command();
    assert_eq!(
        tokio_cmd.as_std().get_current_dir(),
        Some(invocation.cwd.as_path())
    );

    cleanup_isolated_workdir(&invocation).unwrap();
    assert!(!invocation.cwd.exists());
}

#[test]
fn direct_sdk_maps_mcp_tool_aliases_and_parses_stream_json_ndjson() {
    assert_eq!(
        map_mcp_tool_alias("mcp__hermes__pack"),
        Some(CompoundPrimitive::Pack)
    );
    assert_eq!(
        map_mcp_tool_alias("mcp__hermes__exec"),
        Some(CompoundPrimitive::Exec)
    );
    assert_eq!(
        map_mcp_tool_alias("mcp__hermes__ship"),
        Some(CompoundPrimitive::Ship)
    );
    assert_eq!(map_mcp_tool_alias("Bash"), None);
    assert_eq!(to_mcp_tool_name(CompoundPrimitive::Pack), "mcp__hermes__pack");
    assert_eq!(to_mcp_tool_name(CompoundPrimitive::Exec), "mcp__hermes__exec");
    assert_eq!(to_mcp_tool_name(CompoundPrimitive::Ship), "mcp__hermes__ship");
    assert!(is_competing_native_tool("Bash"));
    assert!(is_competing_native_tool("Edit"));
    assert!(!is_competing_native_tool("mcp__hermes__pack"));

    let ndjson = concat!(
        r#"{"type":"system","subtype":"init","session_id":"sess-42","model":"claude-sonnet-4-6","tools":["mcp__hermes__pack","mcp__hermes__exec","mcp__hermes__ship"]}"#,
        "\n\n",
        r#"{"type":"assistant","message":{"id":"msg_1","model":"claude-sonnet-4-6","role":"assistant","content":[{"type":"thinking","thinking":"Inspecting crates","signature":"sig_123"},{"type":"text","text":"Packing workspace context."},{"type":"tool_use","id":"tu_1","name":"mcp__hermes__pack","input":{"query":"HermesBridgeStatus"}},{"type":"tool_use","id":"tu_2","name":"mcp__hermes__exec","input":{"code":"print(1)"}},{"type":"tool_use","id":"tu_3","name":"mcp__hermes__ship","input":{"run_gate":true}}],"usage":{"input_tokens":120,"output_tokens":45,"cache_creation_input_tokens":0,"cache_read_input_tokens":4096}}}"#,
        "\n",
        r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":{"matches":2},"is_error":false}]}}"#,
        "\n",
        r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":842,"num_turns":2,"result":"Done","session_id":"sess-42","total_cost_usd":0.0,"usage":{"input_tokens":150,"output_tokens":60,"cache_creation_input_tokens":0,"cache_read_input_tokens":4096}}"#,
        "\n"
    );

    assert!(parse_stream_json_line("   ").unwrap().is_none());
    let events = parse_stream_json_ndjson(ndjson).unwrap();
    assert_eq!(events.len(), 4);
    assert!(matches!(events[0], StreamJsonEvent::SystemInit { .. }));
    assert!(matches!(events[2], StreamJsonEvent::UserToolResult { is_error: false, .. }));

    let summary = StreamJsonSummary::from_events(&events);
    assert_eq!(summary.session_id.as_deref(), Some("sess-42"));
    assert_eq!(summary.model.as_deref(), Some("claude-sonnet-4-6"));
    assert_eq!(summary.assistant_text, "Packing workspace context.");
    assert_eq!(summary.final_result.as_deref(), Some("Done"));
    assert!(!summary.is_error);
    assert_eq!(summary.thinking_blocks.len(), 1);
    assert_eq!(
        summary.thinking_blocks[0].signature.as_deref(),
        Some("sig_123")
    );
    assert_eq!(summary.tool_uses.len(), 3);
    assert_eq!(summary.tool_uses[0].primitive, Some(CompoundPrimitive::Pack));
    assert_eq!(summary.tool_uses[1].primitive, Some(CompoundPrimitive::Exec));
    assert_eq!(summary.tool_uses[2].primitive, Some(CompoundPrimitive::Ship));
    assert_eq!(summary.usage.cache_read_input_tokens, 4096);
    assert_eq!(summary.usage.input_tokens, 150);
}

#[test]
fn cache_stabilizer_strips_single_line_system_reminder_and_keeps_static_reminders() {
    let input = concat!(
        "<system-reminder>Current date: 2026-11-18</system-reminder>\n",
        "<system-reminder>Always verify gate invariants.</system-reminder>\n",
        "Static prompt line"
    );
    let res = stabilize_prefix(input);
    assert_eq!(res.stripped_lines, 1);
    assert!(!res.stabilized_text.contains("2026-11-18"));
    assert!(res
        .stabilized_text
        .contains("<system-reminder>Always verify gate invariants.</system-reminder>"));
}

#[tokio::test]
async fn direct_sdk_returns_claude_cli_not_found_when_binary_missing() {
    let cfg = ClaudeDirectSdkConfig {
        claude_bin: PathBuf::from("nonexistent-claude-cli-hypotaxis-test"),
        ..Default::default()
    };
    let err = hermes_bridge::run_direct_sdk(&cfg, "hello")
        .await
        .expect_err("missing binary must error cleanly");
    assert!(matches!(
        err,
        hermes_bridge::BridgeError::ClaudeCliNotFound(_)
    ));
}
