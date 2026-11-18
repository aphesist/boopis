# S0 spike: unmodified Hermes v0.23.2, headless, against a fake model

Run 2026-11-18 in a Linux container. Scripts, configs, raw frames and evidence transcripts are kept with the W0 notes (`spike/`):
- `install.sh`;
- `fake_model_server.py` (a stdlib OpenAI-compatible fake, driven by `@@call tool {json}@@` and `@@reply text@@`);
- `hx_ws_client.py` (a stdlib WebSocket client, no `Origin`);
- `hx_scenarios.py` (12 scenarios);
- `netlog_proxy.py` (an egress logger);
- `plugins/hx_probe/` (a probe plugin with a delegation provider).

## Verdicts
| # | Claim | Verdict |
|---|---|---|
| 1 | Installs with Hermes's package manager on pinned Python 3.14 | Confirmed (`setup-hermes.sh --runtime-only`; 1 m 10 s; downloads Python 3.14.9, node, pnpm, ripgrep, ffmpeg, chromium) |
| 2 | One custom endpoint as the only provider, by config alone | Confirmed with 4 keys, and zero other egress (see config) |
| 3 | `hermes gateway ensure/attach --json`, plus a raw WebSocket handshake | Confirmed |
| 4a | An explicit `toolsets` list gives an exact tool surface | Partly. `[]` gives no tools. `["x"]` exposes only Hermes's 3 `tool_search` bridge tools unless `tools.tool_search.enabled: "off"`. Plugin and MCP tools are deferrable by design (`tools/tool_search.py`), and no plugin flag exempts them |
| 4b | Plugin tool, `pre_tool_call` (block/approve/modify), `post_api_request`, `register_rpc`, `emit_to_session`, prompt section | Confirmed |
| 4b | `ctx.dispatch_tool` is the full pipeline | **Refuted.** It calls `registry.dispatch` directly (`hermes_cli/plugins_context.py:485`): no hooks, no middleware, no toolset gating. Hermes's dangerous-command approval still fires for `terminal` |
| 4c | `session.steer` | Confirmed. Needs `execution_generation` from an event envelope. Delivered after the running tool returns, as a user message `[OUT-OF-BAND USER MESSAGE] … [/OUT-OF-BAND USER MESSAGE]` |
| 4d | Legacy server-request approvals with `server_requests: true` | **Refuted.** Only canonical `approval.request` → `approval.respond` → `approval.settled`, every time. Choices are `once`, `deny`, `session`, `always`; timeout 300 s; the turn blocks |
| 4e | Mid-session model and provider switch | Confirmed: `session.mutate {operation: "model", payload: {model, provider}, expected_revision, expected_generation}`. The fences come from the `revision_conflict` refusal (not from `session.info`). Use **named** providers only (a bare `custom` resolved to the wrong endpoint). `prompt.submit` also accepts a one-turn `model_override` |
| 4f | Per-task model for `delegate_task` | Confirmed, through a delegation-provider plugin (`ctx.register_delegation_provider`, `delegation.backend: <name>`, `route_task(task, config) → {provider, model, label}`, with extra task parameters). Children ran on other models and endpoints. Children are **background**: the tool returns `dispatched`, and completion re-enters as a new turn. Children inherit the parent's toolsets minus `delegate_task` |
| 4g | `plugins.isolation: host` keeps all of the above | Confirmed. It can't do `register_approval_transport`, platforms, `post_message`, `fork_session`; it skips `register_cli_command` |
| 4h | Footprint | 2.36 GB installed (the gateway uses about 775 MB of it); 3.1 s cold start (7.3 s on first run); 212 MB idle RSS, 323 MB after the suite |

## Config that gave a single provider and zero egress
```yaml
model: {provider: custom, default: fake-a, base_url: "http://127.0.0.1:18080/v1", api_key: fake-key, api_mode: chat_completions}
updates: {check: false}
model_catalog: {enabled: false}                 # else: catalog refresh at +30 s, then every 20 min
models_dev: {url: "http://127.0.0.1:18080/models-dev-api.json"}   # else: models.dev on model switch
tools: {tool_search: {enabled: "off"}}
providers:
  main: {api: "http://127.0.0.1:18080/v1", api_key: fake-key, transport: openai_chat, discover_models: false,
         models: {fake-a: {context_length: 200000}}}
auxiliary:   # every auxiliary.* task (title_generation, vision, compression, approval, curator, ...)
  title_generation: {provider: custom, model: fake-a, base_url: "http://127.0.0.1:18080/v1", api_key: fake-key}
```

## Observed signatures
- **Tool handler:** `handler(args, **kw)` returns a JSON string. `kw`: `conversation_id`, `session_id`, `task_id`, `user_task`.
- **`pre_tool_call`:** `cb(tool_name, args, **kw)`, with `kw` `api_request_id`, `conversation_id`, `middleware_trace`, `session_id`, `task_id`, `tool_call_id`, `turn_id`. It fires for built-ins too.
  - `block` means the model sees `{"error": message}`, `post_tool_call.status == "blocked"`, and there's no `tool.start`.
- **`post_api_request`:** `cb(**kw)`, carrying:
  - `usage {input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, prompt_tokens, total_tokens}`;
  - `model`, `provider`, `base_url`, `api_mode`, `session_id`, `finish_reason`, `api_duration`, `context_length`.
- **RPC:** `ctx.register_rpc(name, fn)`, with `fn(params, *, session_id=None, **kw)`. Clients call it as `plugin.<id>.<name>`; an unknown method gives `-32601`.
- **Events:** `ctx.emit_to_session(session_id, event, payload) -> bool` arrives as `{type: "plugin.<id>.<event>", session_id, payload, seq}`.
- **Prompt sections:** `ctx.register_system_prompt_section(id, text, position="after_memory")`. That's the only position, and it lands between `<!-- hermes-plugin-sections:start -->` markers. Caps: 4000 chars per section, 8000 total across plugins (COMPAT research).
- **`prompt.submit`** requires `submission_id` or `input_id`, otherwise it returns `4001`. **`session.create`** rejects an empty `base_url`, so omit it to use a named provider.

## Other facts
- Gateways a client starts idle-exit after 600 s; `ensure` restarts them. `gateway stop` refuses while a turn is live (use `--yes`).
- Plugin code loads at gateway start, so edits need a restart. Config edits apply hot.
- Prompt caching on custom routes needs `providers.<n>.models.<id>.prompt_caching: true`. Markers then land on system part 0, the plugin-section block, the user message and the last tool result.
- Startup probes the configured endpoint with `/v1/models`, `/api/tags`, `/props`, `/version` and similar; servers must tolerate 404s.
- A packaged install must write `install-stamp.json` (`scripts/write_install_stamp.py`), or the version reads `unknown`.
