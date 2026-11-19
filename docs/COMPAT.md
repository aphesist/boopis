# Compatibility spec: other harnesses' formats on Hermes

Status: v1 draft, 2026-11-18. Binding for `plugins/hypotaxis/compat/`. Companion to `docs/ARCHITECTURE.md` section 9, `docs/STANDARDS.md` and ADR-0001, 0003, 0006 and 0011 in `docs/DECISIONS.md`. This file is a spec only. No code exists yet.

Sources:
- `docs/research/formats.md` (formats, from docs only), cited as `F§n`.
- `docs/research/hermes.md`.
- Hermes read from source, cited as `H:<path>` for `hermes-agent` v0.23.2 (`ae2a81cc`).
- The official plugins, cited as `OP:<path>` for `hermes-official-plugins` at `e726eb7d`.

Anything not verified is marked **[verify]** with how to verify it.

## 0. Rules

1. `compat/` translates other harnesses' formats **into Hermes's own surfaces**. It never patches Hermes and never imports outside the public plugin API (AGENTS.md invariant 1).
2. What Hermes reads natively is **native**: `compat/` does no work for it and must not duplicate it. Where Hermes reads a thing lossily, `compat/` adds only the remainder.
3. **Prompt caching is sacred** (invariant 4). `compat/` never changes the system prompt, the toolsets or the tool schemas of a running session. It changes only:
   - what a later session sees;
   - tool results (appended text);
   - the user message of the current turn.
4. Project content is **trust-gated** (section 11). Fail closed: untrusted means inert.
5. Nothing is fabricated (invariant 5). A feature with no faithful mapping is **unsupported**, listed in the inventory, and never approximated silently.
6. Translation is deterministic and idempotent. The same inputs produce the same bytes, which also keeps the prompt prefix stable across sessions.
7. Foreign files and repositories are never modified. Compat writes only under `<profile home>/hypotaxis/` (and installs plugins under the profile `plugins/`).

## 1. What Hermes already does natively (verified)

| Capability | Hermes behaviour | Source |
|---|---|---|
| Project context files | **One type wins**, first found: `.hermes.md`/`HERMES.md` (walk to git root), then the `AGENTS.md` chain, then `CLAUDE.md` (cwd only), then `.cursorrules` plus `.cursor/rules/*.mdc` (cwd only, non-recursive). Lower types are shadowed, not merged. | `H:agent/prompt_builder.py` `build_context_files_prompt`, `_CONTEXT_FILE_CANDIDATES` |
| `AGENTS.md` chain | Git root down to cwd. Per directory the first non-empty of `AGENTS.override.md`, `AGENTS.md`, `agents.md`. Sections are concatenated, identical content is deduplicated. | same, `_agents_md_candidates` |
| Context-file hygiene | Prompt-injection scan blocks the file. Containment and symlink checks. Cap `context_file_max_chars` (default 20,000). | same, `_scan_context_content`; `agent/context_file_sources.py` |
| `.mdc` handling | **Frontmatter is not stripped and `globs`/`alwaysApply` are ignored.** Every top-level `.mdc` is always-on. | same, `_load_cursorrules` |
| Subdirectory context | On the first tool call touching a directory (args `path`, `file_path`, `workdir`, or `cd` and paths in a `terminal` command), the first of `AGENTS.override.md`, `AGENTS.md`, `agents.md`, `CLAUDE.md`, `claude.md`, `.cursorrules` is **appended to the tool result**, up to 32,000 chars. Any tool is covered. | `H:agent/subdirectory_hints.py`; `agent/tool_executor.py:1158` |
| Project skills | `<git root>/.hermes/skills` and `.agents/skills`. Load only if the root is in `skills.trusted_project_dirs`. Every skill is scanned, and a `dangerous` verdict quarantines it. Same-tier name clashes are refused. | `H:agent/skill_utils.py` (`PROJECT_SKILLS_SUBDIRS`, `is_quarantined_project_skill`) |
| Other skill roots | `~/.hermes/skills`, `skills.create_dir`, `skills.external_dirs`. Precedence is project > local > create_dir > external. Every skill is also a `/slash` command (it becomes a user message). `${HERMES_SKILL_DIR}`, `${HERMES_SESSION_ID}` and `` !`cmd` `` (off unless `skills.inline_shell`) are expanded. | `H:agent/skill_utils.py`, `agent/skill_commands.py`, `agent/skill_preprocessing.py` |
| Plugin skills | `ctx.register_skill` registers `<plugin>:<skill>`. | `H:hermes_cli/plugins_content.py` |
| Agent Plugins v1 | **Root `plugin.json`** (`$schema` must be the agent-plugins.org v1 URL), `skills/*/SKILL.md` (name equals the directory), `mcp.json`. Stdio and streamable-http only. **SSE is rejected.** No OAuth, no env defaults. Optional `extensions."com.nousresearch.hermes".servers.<n>.{trust,timeout,costs}`. Namespaced skills, enabled via `plugins.enabled`. | `H:hermes_cli/agent_plugins.py` |
| MCP client | `mcp_servers` in `config.yaml`. Stdio via `command/args/env/cwd`. `url` means streamable HTTP, and `transport: sse` is explicit. Also `headers`, `timeout`, `enabled`, `lazy`, `tools.include/exclude` (globs), `trust: untrusted`, `auth: oauth` plus `oauth:{client_id,client_secret,scope,redirect_*}`. **Interpolation: `${VAR}`, `${env:VAR}`, `${workspaceFolder}`, `${userHome}`, `${workspaceFolderBasename}`, `${/}`.** There is no `${VAR:-default}`. Each server becomes toolset `mcp-<server>` and tools `mcp_<server>_<tool>`. OAuth (CIMD, DCR, PKCE, step-up) is Hermes's. | `H:tools/mcp_tool_config.py`, `mcp_tool_transport.py`, `website/docs/user-guide/features/mcp.md` |
| Shell hooks | `hooks:` in `config.yaml`, keyed by **Hermes** event names. stdin JSON `{hook_event_name, tool_name, tool_input, session_id, cwd, profile, extra}`. Exit 2 blocks `pre_tool_call`. `{"decision":"block"}` is accepted. First-use consent per `(event, command)`. Matcher is a **full-match regex on Hermes tool names**. Timeout at most 300s. User scope only. | `H:agent/shell_hooks.py` |
| `hermes setup` and `hermes import-agent` | Detects `~/.claude`, `~/.codex`, `~/.cursor` and offers the `agent-importers` plugin. **User scope only, one-shot, with `--sync`.** Maps: `CLAUDE.md`, `AGENTS.md`, Cursor user rules (frontmatter stripped) into `memories/MEMORY.md`; Claude `Bash(...)` allow and deny into `command_allowlist` and `approvals.deny`; `mcpServers` into `mcp_servers` (secret-named env and headers stripped); `skills/` into `skills/<agent>-imports/`; Claude `commands/*.md` **skipped**. | `H:hermes_cli/setup_agent_import.py`; `OP:agent-importers/importer.py`, `README.md` |
| Grok Bot | `import-agent grok-bot` reads a Bot-written export: skills, memories, remote MCP apps, routines as paused cron jobs. | `OP:agent-importers/grok_bot.py` |
| Delegation | `delegate_task` runs children in the background. A pluggable **delegation provider** (one active, `delegation.backend`) can add a per-task enum and route a task to a model or a **Hermes profile**. | `H:agent/delegation_provider.py`; `OP:advanced-delegation` |
| System prompt sections | `ctx.register_system_prompt_section`: frozen per session, **at most 4,000 chars each and 8,000 in total across all plugins**, 32 sections. | `H:hermes_cli/plugins_dispatch.py:98-102`, `agent/system_prompt.py` |

**Consequences that shape this spec:**
- Hermes has **no native reader** for `.claude/{skills,commands,agents,rules,settings*.json}`, `.mcp.json`, `.cursor/mcp.json`, `.codex/`, `.gemini/`, `GEMINI.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, ancestor `CLAUDE.md` or Claude plugins. These are the translation work.
- `import-agent` already owns **user-scope** Claude, Codex and Cursor memory, Bash permissions, MCP and skills. `compat/` reads the profile's `import-sync.json`. For a source listed there, `compat/` skips the user-scope items the importer owns (memory, Bash rules, MCP, skills) and translates only what the importer skips (commands, hooks, agents, rules).
- Project-scope content is not covered by the importer at all.

## 2. Unified model and Hermes surfaces

The model is `F§10`. Every concept carries `source{tool,scope,path,plugin?}`, `precedenceKey`, `raw` (round-trips unknown keys) and a content hash.

**Timing.** *install* = plugin or marketplace install and update. *session* = `plugin.hypotaxis.compat.prepare{cwd}` (RPC), called by the host before `session.create`. In plain Hermes the same code runs lazily at `on_session_open`, so effects reach the next session. *change* = the file watcher refreshes the inventory and marks items **pending**. A pending item is applied at the next session and **never to a running one**.

| Concept | Hermes surface | When |
|---|---|---|
| MemoryDoc (not natively loaded) | Always-on text: section 8.1 (section if it fits, else the first user turn) | session |
| Rule | always: as MemoryDoc. glob: index plus a tool-result append. model_decision: a skill. manual: a `/` skill | session; append on first matching touch |
| Skill | Project and user scope: `ctx.register_skill` from the per-project cache (5.2). Plugin: generated Agent Plugin v1 skills dir | session / install |
| Command | A skill (model-invocable) or `ctx.register_command` (user-only) | session |
| Subagent | A delegation-provider route, optionally a profile (teammate) | session; promotion is explicit |
| Hook | Python callbacks on `ctx.register_hook` (section 4) | callbacks registered at plugin load; the project's hook set is read from a session-frozen snapshot |
| PermissionRule | The hypotaxis policy in `pre_tool_call` (deny > ask > allow) | session snapshot |
| McpServer | **Hosted by the plugin and exposed through exec** (section 7). Never written to the user's `config.yaml`. | session |
| Plugin / Marketplace | Generated skills plugin plus lock file | install |
| OutputStyle | **Unsupported.** Hermes has no hook to replace the system prompt after build. | none |
| Settings (`env`, `model`) | `env` applies only to translated hook and MCP child processes. `model` is ignored (hypotaxis ladder). | session |

## 3. Per format

Legend: **N** native (no work), **T** translate (our code), **U** unsupported (reason given).

### 3.1 Claude Code (`F§1`)

| Item and location | Status | Notes |
|---|---|---|
| `./CLAUDE.md` | **N** only if no `.hermes.md` or `AGENTS.md` wins | Otherwise T (as MemoryDoc). |
| `.claude/CLAUDE.md`, `CLAUDE.local.md`, ancestor `CLAUDE.md` (cwd to repo root) | **T** | Order is root first, nearer later. Hermes reads cwd-only. `@path` imports: relative to the importing file, depth 4, skipped in code spans. Imports escaping the project root need trust. |
| `~/.claude/CLAUDE.md`, managed CLAUDE.md | T unless the importer owns it | Managed is read-only and cannot be excluded. `claudeMdExcludes` is honoured. |
| Subdirectory `CLAUDE.md` | **N** | Subdirectory hints. |
| `.claude/rules/**/*.md` | **T** | `paths:` makes a glob rule. No `paths` means always. |
| `settings.json` hooks | **T** | Section 4. |
| `settings.json` permissions | **T** | Into the hypotaxis policy. Section 10. |
| `settings.json` `env` | T | Child processes only. |
| `.claude/skills/<n>/SKILL.md` | **T** | Registration, section 5.2. Most skills load as-is because Hermes ignores unknown keys. CC-only keys are handled in section 5.1. |
| `.claude/commands/**/*.md`, `~/.claude/commands` | **T** | Section 5.1. The importer skips them. |
| `.claude/agents/*.md`, `--agents` JSON | **T** | Section 6. |
| `.mcp.json`, `~/.claude.json` (local and user scope) | **T** | Section 7. |
| Plugins and marketplaces | **T** | Section 9. |
| Mods (`hooks/hooks.json` `modules`), `themes`, output styles, the `statusLine` setting | **T** (planned) | The app is the surface, not Hermes: `docs/MODS.md`. |
| `.lsp.json`, `monitors`, `bin/` | **U** | No Hermes surface. `bin/` could go on `PATH` and is deferred. **[verify]** whether Hermes LSP config (`lsp.*`) can take `.lsp.json`. |
| `claude.ai` connectors | **U** | Account-bound. |

### 3.2 Agent Skills (`F§2`)

| Item | Status |
|---|---|
| `<dir>/SKILL.md` in `.agents/skills`, `.hermes/skills` | **N** |
| `~/.agents/skills`, `/etc/codex/skills` | **T** through `ctx.register_skill` from the cache (5.2). Never through `skills.external_dirs`. |
| Spec fields `name, description, license, compatibility, metadata, allowed-tools` | **N**: unknown keys are ignored by Hermes. `allowed-tools` is **U** (Hermes has no per-skill pre-approval). |
| `skills-ref validate` | Test oracle only (section 12). |

### 3.3 Codex (`F§3`)

| Item | Status |
|---|---|
| `AGENTS.md`, `AGENTS.override.md` (git root to cwd) | **N** (override beats `AGENTS.md` per directory, as Codex does) |
| `~/.codex/AGENTS.md`, `memories/*.md` | importer-owned, else **T** |
| `project_doc_fallback_filenames`, `project_doc_max_bytes` | **U** (Hermes uses `context_file_max_chars`) |
| `.codex/config.toml` `[mcp_servers.*]` | **T**, only for `projects.<path>.trust_level="trusted"`, plus Hermes trust. Section 7. |
| `.agents/skills`, `[[skills.config]]` | **N** / **U** (disable list: use `skills.disabled`) |
| `~/.codex/prompts/*.md` (deprecated) | **T**: user-only commands (5.1) |
| `hooks.json`, `[hooks]` (14 events) | **T in phase 2.** Event-name map only. Payloads and exit semantics are not fetched **[verify]** by reading the Codex hooks doc and source. |
| `agents/openai.yaml` | ignored (unknown file) |

### 3.4 Gemini CLI (`F§4`)

| Item | Status |
|---|---|
| `GEMINI.md` (`~/.gemini`, workspace and parents), `context.fileName` | **T** as MemoryDoc. `@file.md` imports are expanded as for CLAUDE.md. JIT scan of accessed directories is **U** (Hermes hints do not read `GEMINI.md`). |
| `settings.json` `mcpServers` (`command`, `url` SSE, `httpUrl`) | **T** |
| `.gemini/commands/**/*.toml` | **T** (5.1) |
| Extensions `gemini-extension.json` | **T**: skills, MCP, commands, hooks, `contextFileName`, `settings[]` (to userConfig). `excludeTools` becomes PermissionRule deny. `policies/*.toml`, `themes`, `plan` are **U**. |
| Hooks (BeforeTool, AfterTool, BeforeAgent, ...) | Phase 2, see 4.6 |
| Trust (`trust`, `includeTools`) | `includeTools` and `excludeTools` become `tools.include/exclude`. `trust: true` is **U** (never widen trust from a repo file). |

### 3.5 Cursor (`F§5`)

| Item | Status |
|---|---|
| `AGENTS.md` | **N** |
| `.cursorrules`, top-level `.cursor/rules/*.mdc` | **N but wrong for `.mdc`**: loaded only when no `.hermes.md`, `AGENTS.md` or `CLAUDE.md` wins, always-on, frontmatter included. Compat **honours the frontmatter** (section 8.1). `.cursorrules` is N. |
| `.cursor/rules/**/*.mdc` nested, frontmatter-aware types | **T**: section 8 |
| `.cursor/mcp.json`, `~/.cursor/mcp.json` | **T**, mostly verbatim since Hermes already understands `${env:VAR}`, `${workspaceFolder}`, `${userHome}` |
| `auth{CLIENT_ID,...}` | T to `oauth:{client_id,client_secret,scope}` |
| User and Team rules (cloud) | **U** |
| `.cursor/skills` | not in `F§5` **[verify]** |

### 3.6 Antigravity (`F§6`)

| Item | Status |
|---|---|
| `AGENTS.md`, `GEMINI.md` | as Codex and Gemini |
| `.agents/skills`, legacy `.agent/skills` | **N** / **T** (legacy dirs projected) |
| `~/.gemini/config/skills` | T (user, external dir) |
| `.agents/rules/*.md` (`trigger`) | **T** (section 8). **Missing or invalid `trigger` means drop the file.** Limits of 24,000 B per file and 20,000 tokens aggregate are enforced. |
| `.agents/rules.json` | **T** (`inherits`, `entries`) |
| `.agents/workflows/*.md` | **U** until the format is verified (`F§6`) |
| Plugins `plugin.json` / `.antigravity-plugin/` | T in phase 2: skills, MCP (`<plugin>_<server>`), rules, hooks (PreToolUse, PostToolUse, SessionStart, Stop). `agy plugin import` is not used. |
| Artifacts | **U**. Not a file format. |

### 3.7 Hermes native, MCP, Grok Bot

| Item | Status |
|---|---|
| `.hermes.md`, `.hermes/skills`, `.hermes/plugins` (opt-in), `plugin.yaml` plugins, `config.yaml` | **N**. Hermes always beats a translated item. |
| Agent Plugins v1 repo | **N** (`hermes plugins install owner/repo#subdir`) |
| MCP servers (any file) | Section 7 |
| Grok Bot "plugins" are MCP connectors (`F§8`) | MCP only. The Remote HTTPS connector (name, URL, headers, optional OAuth client) maps like a Cursor remote server. The Command connector maps to stdio. Skills and routines come only via the Bot-written export, which is **N** through `import-agent grok-bot`. |

## 4. Claude Code hooks, exactly

Hermes already has a shell-hook bridge, but it is Hermes-keyed, user-scope, fullmatch and consent-per-command (section 1). It cannot express Claude semantics. `compat/` therefore registers **its own** Python callbacks with `ctx.register_hook` and never writes `hooks:` into `config.yaml`, so the two cannot double-fire.

### 4.1 Event map

Verified kwargs are from `H:website/docs/user-guide/features/hooks.md` and `hermes_cli/hooks.py`.

| Claude event | Hermes hook (kwargs used) | Fidelity |
|---|---|---|
| PreToolUse | `pre_tool_call(tool_name,args,tool_call_id,session_id,task_id,turn_id,...)` | **Full**, except `allow` (4.4) |
| PostToolUse, PostToolUseFailure | `post_tool_call(tool_name,args,result,duration_ms,status,error_type,error_message,...)` plus `transform_tool_result` for feedback | Full. Failure is `status != ok`. |
| UserPromptSubmit | `pre_llm_call(user_message,session_id,turn_id,...)`. Fires **once per user prompt**, before inference. Returns context, which is joined into the user message, or `{"action":"block"}`. | Full. **[verify]** whether a blocked prompt stays in history, since Claude erases it. |
| SessionStart | `on_session_start(session_id,model,platform)` for `startup`, `on_session_open(reason=create\|resume)` for `resume`, `on_session_reset` for `clear`, `post_compaction` for `compact` | Observers fire **after** the system prompt is built. `additionalContext` is therefore delivered through the next `pre_llm_call`, and never the system prompt. |
| SessionEnd | `on_session_finalize` | Partial: Claude's `reason` set is mapped to `other` unless the surface supplies `reason`. |
| Stop | `post_llm_call`, which Hermes fires once when the tool loop ends in a final answer (not when interrupted). A block (exit 2 or `decision:"block"`) is fed back with `ctx.inject_message`. | **Partial.** Hermes has no turn-end hook that can continue a turn, and `pre_verify` fires only after `write_file` or `patch` edits (verified: `ship` writes do not count), so hypotaxis does not use it. The reason re-enters as a user-role message queued in the session's own FIFO: a **new turn after the answer**, not a continuation inside it. It needs `plugins.entries.hypotaxis.allow_gateway_injection: true` (reported in `compat.inventory`). Upstream proposal: `compat/UPSTREAM.md`. |
| SubagentStart / SubagentStop | `subagent_start(child_goal,child_role,...)` / `subagent_stop(child_summary,child_status,...)` | Observe only. A SubagentStop block cannot force continuation. |
| Notification | `on_human_input_request(kind=approval\|clarify\|sudo, prompt)`. `approval` becomes `permission_prompt`, `clarify` becomes `elicitation_dialog`. Do not also use `pre_approval_request`. | Partial. `idle_prompt` and `auth_success` do not exist. |
| PostCompact | `post_compaction(session_id,old_session_id,kind,reason)` | Full |
| InstructionsLoaded | Synthesized by `compat/` when it delivers memory or rules | Observational |
| PreModelSwitch / PostModelSwitch | Synthesized by the cascade (section 6 of ARCHITECTURE) | Optional |

**No faithful mapping (listed in the inventory, never run):**

| Claude event | Why |
|---|---|
| PreCompact | Hermes has only `post_compaction`. It cannot be blocked or observed in advance. |
| PermissionRequest, PermissionDenied | `pre_approval_request` is an observer, and Hermes intentionally has no auto-allow or decision callback (`F` hermes.md, security.md "Hardline Blocklist"). |
| UserPromptExpansion, PostToolBatch, StopFailure, Setup | No Hermes equivalent. |
| TaskCreated, TaskCompleted, TeammateIdle | Kanban hooks differ in meaning. |
| ConfigChange, FileChanged, CwdChanged, DirectoryAdded, WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult, MessageDisplay | None. Worktrees are host-owned. |

`agent_loop_stopped` is **not** Stop. It fires only when a running turn is interrupted (`/stop` or `session.interrupt`). It is the closest match for Codex's `Interrupt`.

### 4.2 stdin payload

Built per call from Hermes kwargs. Keys are exactly Claude's (`F§1.3`).

| Key | Source |
|---|---|
| `session_id` | Hermes `session_id` |
| `prompt_id` | `turn_id` |
| `transcript_path` | `<home>/hypotaxis/compat/transcripts/<session>.jsonl`, written **lazily** before the first spawn in a session and appended after each turn. Content is a best-effort Claude-shaped JSONL **[verify]** against real `transcript_path` consumers in the fixtures. |
| `cwd` | `ctx.session_cwd()` |
| `permission_mode` | `bypassPermissions` if YOLO or `approvals.mode: off`, else `default` |
| `effort{level}` | the session's reasoning effort |
| `hook_event_name` | the Claude name |
| `agent_id`, `agent_type` | set inside a subagent (`subagent_start.child_subagent_id`, `child_role`) |
| PreToolUse `tool_name`, `tool_input`, `tool_use_id` | aliased name (4.5), arguments translated to Claude's field names (`path` becomes `file_path`, ...), `tool_call_id` |
| PostToolUse `tool_response`, `duration_ms` | `result`, `duration_ms`. `error` and `is_interrupt` for failures. |
| UserPromptSubmit `prompt` | `user_message` |
| SessionStart `source`, `model` | per the 4.1 map |
| Stop `stop_hook_active`, `last_assistant_message` | whether the turn began with our own continuation message (matched by its exact text), `post_llm_call.assistant_response` |
| SubagentStop `agent_id`, `agent_type`, `last_assistant_message` | `child_session_id`, `child_role`, `child_summary` |
| Notification `message`, `notification_type` | `prompt`, the kind map |

Environment of the child:
- the allowlisted base environment (STANDARDS section 5; API keys stripped);
- `CLAUDE_PROJECT_DIR` (the git root of the session cwd);
- `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PLUGIN_OPTION_<KEY>` for plugin hooks;
- the translated settings `env`.

`CLAUDE_ENV_FILE` is **unsupported** (it would mutate the shell environment of a running session) and is left unset.

### 4.3 Execution

- Handler types: `command` (shell string, or exec form `command` plus `args` with `shell=False`). `http` is supported (POST the payload, no redirects, trust-gated URL). `mcp_tool` is T through the MCP client. `prompt` and `agent` are **unsupported**.
- A shell-form `command` runs through the platform shell, as Claude does. This is accepted by **ADR-0013**: a Claude Code hook command is a shell string by definition. It runs through the platform shell (`sh -c`, `cmd /c`), **only after the project is trusted**, with an allowlisted environment, a timeout and an output cap, with cwd at the project root. It is **unsandboxed**, as in Claude Code. Exec-form `command`+`args` uses `shell=False`.
- Hooks for one event run **in parallel**. The strictest result wins. A block beats `ask`, which beats `allow`, which beats none.
- `matcher`: empty, `*` or absent matches all. A string made only of `[A-Za-z0-9_\- ,|]` is an exact name or `|`/`,` list. Anything else is an unanchored regex (Python `re.search`; ECMAScript differences covered by golden tests). It is matched against the **Claude-aliased tool name**. `if` uses the PermissionRule syntax and applies to tool events only.
- **Timeouts.**
  - The runner enforces the handler's own timeout (per `F§1.3`: 600s default, 30s for UserPromptSubmit; **[verify]** the 60s default the owner recalls against the Claude Code docs) by killing the process group.
  - At install the plugin sets `plugins.hook_callback_timeout` to **120** **only if it is lower**, and records the change in its settings. It never lowers it.
  - The effective timeout is `min(declared, hook_callback_timeout - 1)`. A per-hook timeout above that limit is **clamped**, with a warning in `compat.inventory`. Hermes abandons a callback past the bound and `pre_tool_call` then **fails closed**.
  - A handler timeout discards its output and follows Claude: PreToolUse **proceeds**. Hermes's own abandonment still blocks.

### 4.4 Exit codes and JSON output

| Outcome | Claude contract | Hermes action |
|---|---|---|
| exit 0, stdout a single JSON object | parse the decision | per the next table |
| exit 0, other stdout | plain text. Context only for SessionStart, UserPromptSubmit and PostToolUse. | appended as context (`pre_llm_call` context or `transform_tool_result`) |
| exit **2** | block where the event can block: PreToolUse, UserPromptSubmit, Stop (continue). stderr goes to the model. | `{"action":"block","message":<stderr>}`; `pre_verify` continue; for PostToolUse the stderr is **appended to the result** |
| other non-zero, `onFailure:"block"` absent | non-blocking error, one line in the log | none |
| `onFailure:"block"` | treated as exit 2 | as exit 2 |

| JSON field | Mapping |
|---|---|
| `hookSpecificOutput.permissionDecision: "deny"` or top-level `decision:"block"` | `{"action":"block","message":reason}` |
| `permissionDecision: "ask"` | `{"action":"approve","message":reason,"rule_key":"compat:<hook id>"}` (Hermes human gate) |
| `permissionDecision: "allow"` | **Skips hypotaxis-level approval prompts for that call.** Hermes's own approvals (`pre_approval_request`) and **hardline blocks still apply**. It never overrides a `deny` (from any source) or a hypotaxis scope or protected-path veto. It is not a Hermes directive, so the call proceeds to Hermes's gates unchanged. Hermes has no auto-allow. |
| `permissionDecision: "defer"` | treated as `ask` |
| `updatedInput` | `{"action":"modify","args":...}` (shallow merge, argument names translated back) **[verify]** `updatedInput` is not in `F§1.3` verified fields. |
| `additionalContext` (cap 10,000 chars) | `pre_llm_call` context, or a suffix on the tool result |
| `continue:false`, `stopReason` | block with `stopReason` (PreToolUse, UserPromptSubmit); otherwise ignored |
| `systemMessage` | shown through `ctx.post_message` |
| `suppressOutput`, `terminalSequence` | ignored |
| Stop-block loop cap | 8 consecutive continuations; a real user prompt resets the count. `UserPromptSubmit` does not run for a continuation. |

### 4.5 Tool-name aliasing

The hook sees a Claude name, `tool_input` is translated to Claude's field names, and `matcher` matches the Claude name.

| Hypotaxis tool (default surface) | Claude name | Rule |
|---|---|---|
| `pack` | `Read` for file, range or symbol; `Grep` for search; `Glob` for glob listing | by argument shape. Other `pack` modes (git status, diff, log) use `Read`. |
| `ship` | `Write` (new file), `Edit` (one replacement), `MultiEdit` (several), `NotebookEdit` (`.ipynb`) | **One PreToolUse per target file.** Any block aborts the whole ship (it is transactional, so no partial writes). |
| `exec` itself | no alias (name `exec`) | a catch-all `*` matcher sees it |
| shell calls **inside** `exec` (the kernel's `terminal` dispatch) | `Bash` | The kernel must route inner dispatches through the same hook runner. **[verify]** whether `ctx.dispatch_tool` fires `pre_tool_call`. If it does not (`registry.dispatch` direct), the kernel calls `compat.hooks.run_tool_event()` itself. |
| `dispatch` | `Agent` (alias `Task`) | |

| Hermes default tool (ungoverned profile) | Claude name |
|---|---|
| `terminal` | `Bash` (`command` kept) |
| `read_file` | `Read` |
| `search_files` | `Grep` (`target=content`) or `Glob` (`target=files`) |
| `write_file` | `Write` |
| `patch` | `Edit` (`old_string`, `new_string`, `replace_all` match Claude's) |
| `web_extract` / `web_search` | `WebFetch` / `WebSearch` |
| `delegate_task` | `Agent` |
| `todo_list` | `TodoWrite` |
| `skill_view` | `Skill` |
| `mcp_<server>_<tool>` | `mcp__<server>__<tool>`. Plugin servers use `mcp__plugin_<plugin>_<server>__<tool>`. The original names come from the compat manifest, because Hermes sanitizes `-` and `.` to `_`. |
| anything else | its Hermes name (a `*` matcher still sees it) |

### 4.6 Other harnesses' hooks (phase 2)

Event-name maps only, each **[verify]** against the vendor's hook docs:
- Gemini: BeforeTool is `pre_tool_call`, AfterTool is `post_tool_call`, BeforeAgent is `pre_llm_call`, AfterAgent is `on_session_end`, SessionStart/End as in 4.1. BeforeModel and AfterModel are observer-only through `pre_api_request` and `post_api_request`. PreCompress and BeforeToolSelection are unsupported.
- Codex: PreModelRequest and PostModelRequest are observers. PreToolUse, PostToolUse, SessionStart, SessionEnd and UserPromptSubmit map as Claude. Interrupt is `agent_loop_stopped`. PermissionRequest, PreCompact and Stop follow Claude.
- Antigravity: PreToolUse, PostToolUse, SessionStart and Stop follow Claude.

## 5. Commands and skills

### 5.1 Commands

A command is a prompt template. It becomes a **skill** (so it appears as `/name` natively) unless it is user-only, in which case it becomes a `ctx.register_command` handler that renders the template and sends it as a user message through `ctx.inject_message` **[verify]** that this starts a turn (the handler's return value is displayed text).

| Source | Templating | Target |
|---|---|---|
| `.claude/commands/**/*.md` (and `~/.claude/commands`) | `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` (0-based, shell-quoted), `$name` from `arguments`. No placeholder consuming the arguments means append `ARGUMENTS: <v>`. `\$` escapes. `` !`cmd` `` and ```` ```! ```` fences run **before** the model sees the text (non-zero exit aborts, exit 1 tolerated). `@path` becomes `@file:<path>` (Hermes syntax, Read deny-list applies **[verify]** that command messages pass through Hermes's `@` expander, otherwise inline it with the same deny-list). `${CLAUDE_*}` variables are substituted. Frontmatter `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`. | Model-invocable: skill. `disable-model-invocation: true`: user-only command. |
| Gemini `*.toml` | `prompt` plus `description`. `{{args}}` (shell-escaped inside `!{}`; absent means append after two newlines). `!{cmd}`, `@{path}` (injected first). | user-only command |
| Codex `~/.codex/prompts/*.md` | `$1`..`$9`, `$ARGUMENTS`, `$NAME` (call `NAME=value`), `$$` | user-only command (`/prompts:<name>`) |

Rules:
- **Shell injection** (`` !`cmd` ``, `!{}`) is expanded by compat, never by `skills.inline_shell`, so the setting is irrelevant. It runs only after trust, through the shared process helper (`hypotaxis.util.proc`: allowlisted env, timeout, output cap).
- `disableSkillShellExecution` is honoured.
- `allowed-tools` becomes a PermissionRule allow scoped to the invoking turn. It is the only case where compat can pre-approve, and it does so inside the hypotaxis policy and never in Hermes's approval gate. `model` and `effort` apply to the **turn** only if the ladder permits. Otherwise they are reported as ignored.
- `context: fork` runs through the subagent mechanism (section 6).
- **Namespacing.** Subdirectory gives `frontend:component`. Plugin commands are `plugin:name`. Gemini extension commands are `ext.cmd` on conflict.
- **Collisions**, by precedence:
  - Hermes built-in commands win. `register_command` already refuses them, and compat reports `/cmd unavailable, use /skill cmd`.
  - Then native Hermes skills.
  - Then project translated commands.
  - Then user, then plugin.
  - Same-tier duplicates are refused and listed. Compat never guesses.

### 5.2 Skills registration (no files in the repo or the profile)

Claude skills, Gemini and Antigravity skill dirs, and translated commands are **never copied into the repository, `.agents/skills` or any profile-global directory**.
- At `session` time compat parses them into the per-project cache `<profile home>/hypotaxis/projects/<cwd-hash>/` (normalized `SKILL.md` files plus a manifest of content hashes; `<cwd-hash>` is the hash of the realpath).
- It then registers each with `ctx.register_skill(name, <cache path>/SKILL.md, description, frontmatter)`.
- The target namespace is **`claude:<name>`**. Gemini and Antigravity sources use `gemini:` and `agy:`. A native skill of the same name is untouched (native wins).
- **[verify] exact Hermes behaviour**, read from `H:hermes_cli/plugins_content.py`:
  1. `register_skill` derives the namespace from the **registering plugin's manifest name** and forbids `:` in the skill name. So `claude:` needs a second tiny generated plugin named `claude` (no Python logic beyond the register calls). Otherwise the fallback is `hypotaxis:claude-<name>`.
  2. The registry `manager._plugin_skills` is **process-global**, and enabled plugin skills appear in every session's `<available_skills>`. Check whether a session in another cwd sees them.
  3. If it is global, scope with the `skills` list of `session.create` (an allowed create field, `H:gateway/session_policy.py` `CREATE_FIELDS`): the host passes only the cwd's `claude:*` names. **[verify]** whether that field filters the index or only preloads. If it only preloads, register at `on_session_open` and release (`PluginRegistration`) when the last session of that cwd closes, and accept the one-session visibility window.
- CC-only keys are handled when writing the cache copy:
  - `allowed-tools`, `disallowed-tools`, `model`, `effort` are moved into compat metadata and applied as in 5.1.
  - `disable-model-invocation` and `user-invocable: false` are dropped, because Hermes has no flag. The skill stays visible to the model, and this is reported.
  - `paths` makes the skill a glob rule (section 8).
  - `hooks` is registered scoped to the skill's invocation turn, and is trust-gated as a hook.
  - `$ARGUMENTS`-style substitution applies when invoked through a compat command, and is left alone when the model loads the skill with `skill_view` (it reads the raw body).
  - `` !`cmd` `` injections are trust-gated (section 11).
- Skills are prompt material and are **not** trust-gated, except for `!` injections and hooks. Hermes's own `skills.trusted_project_dirs` gate applies only to native `.agents/skills` and `.hermes/skills`.

## 6. Subagents

Source files: `.claude/agents/*.md` (recursive), `~/.claude/agents`, plugin `agents/`, `--agents` JSON, Gemini `agents/*.md` (preview), Antigravity plugin subagents. Identity is `name`. Priority is managed > CLI > project > user > plugin.

Compat registers a **delegation provider** `hypotaxis-agents` (`ctx.register_delegation_provider`, `H:agent/delegation_provider.py`). It adds one per-task enum parameter `agent` (names plus one-line descriptions, deterministic order) and routes a task:

| Claude field | Hermes |
|---|---|
| `name`, `description` | the `agent` enum value and its description |
| body (`prompt`) | **Prepended to the task `context`** by a `pre_tool_call` `modify` on `delegate_task` (routes cannot carry a prompt) |
| `model` (`sonnet`, `opus`, `haiku`, `fable`, id, `inherit`) | route `model`/`provider` through a data table `compat.model_aliases` (STANDARDS section 1.6). `inherit` means an empty route. |
| `effort` | route `reasoning_effort` |
| `tools`, `disallowedTools` | per-task `toolsets` via the reverse alias map in 4.5. **[verify]** the per-task `toolsets` param is honoured under a provider. Otherwise the restriction is enforced in `pre_tool_call` for that child's `task_id`. |
| `mcpServers` | toolsets `mcp-<name>` |
| `skills[]` | preload instruction in `context` **[verify]** per-child skill preload |
| `hooks` | scoped by the child's `child_session_id` |
| `maxTurns` | **[verify]** `delegation.*` iteration key |
| `permissionMode`, `memory`, `isolation: worktree`, `color`, `initialPrompt`, `autoCompactWindow`, `omitClaudeMd`, `experimental` | **U** and reported (plugin subagents ignore `permissionMode`, `mcpServers`, `hooks`, as Claude does) |
| `background` | native: `delegate_task` always runs in the background |

Only **one** delegation provider is active (`delegation.backend`). If the user selected `model_map` or `profile_routes` (`OP:advanced-delegation`), compat does not take over. It exposes each definition as a skill `agent-<name>` whose body is the prompt, and reports the downgrade.

**Promotion to a teammate** is explicit (`plugin.hypotaxis.compat.promote_agent{name}`):
1. Run `hermes profile create hx-<name> --no-skills` **[verify]** flags on the pinned Hermes.
2. Write `SOUL.md` from the prompt body and `config.yaml` (model, toolsets, `mcp_servers` subset). Copy the listed skills.
3. Record the content hash. Never overwrite a `SOUL.md` whose hash differs from the recorded one, and ask instead.
4. The provider's route for that name becomes `{"profile":"hx-<name>"}`, so core runs the child as that profile (its own memory, skills and schedule).

## 7. MCP

**Compat never writes project, plugin or other-tool servers into the user's `config.yaml`.**

**What Hermes has (verified).**
- `session.create` accepts `editor.mcp_servers` (`H:gateway/session_local_editor.py`, `session_local_mcp.py`): session-scoped, frozen into the prompt prefix, at most 16 servers and 64 KB, ACP-schema stdio, http or sse entries.
- It is **accepted only from `source: "acp"`**, and it forces `edit_approval_policy: "ask"` (one approval per edit, which conflicts with `ship`). hypotaxis launches with `source: "gui"`.
- The entries carry no OAuth block and no `${...}` interpolation.
- Plugins have no API to register an MCP server (`ctx.call_mcp` only reaches servers already in config).
- The only other sources are `config.yaml` and portable Agent Plugin `mcp.json`, and both are profile-global.

**Gap, stated plainly:** Hermes has **no session-scoped MCP mechanism usable by hypotaxis**. Two fallbacks:

| Fallback | Cost |
|---|---|
| A. A project-scoped profile overlay (a generated Hermes profile carrying the servers) | Separate memory, skills and sessions. This breaks ADR-0006 (attach to the active profile). |
| B. **The plugin hosts the servers** and exposes them through `exec` (and `dispatch`) | The plugin runs an MCP client for these servers only. No Hermes change, no profile pollution. In governed mode MCP tools are reachable only through `exec` anyway (ARCHITECTURE section 7). |

**Recommendation: B.**
- Servers are exposed as exec functions `mcp.<server>.<tool>`. Inner calls run through the hook runner under their **original** names `mcp__<server>__<tool>` (4.5).
- Phase 1 supports stdio and streamable HTTP with static headers. SSE is accepted as deprecated.
- **OAuth servers are unsupported in project and plugin scope** until Hermes exposes a session-scoped API, because the plugin must not re-implement OAuth. They are listed in the inventory. A user who wants one adds it natively with `hermes mcp`, and Hermes then owns it.
- In ungoverned mode with Hermes default tools, translated MCP servers are **unavailable** (listed). Only natively configured ones work.
- User-scope servers of Claude, Codex and Cursor are the importer's, so they are native.
- Servers start lazily on first call, per session, and stop with it. **[verify]** the Python `mcp` SDK Hermes depends on is importable from a plugin under the public API rule. If not, B needs a small vendored client and an ADR.
- Server names are plain `<name>`. A native entry of the same name wins and the translated one is dropped.

| Source | Shape | Translation |
|---|---|---|
| `.mcp.json`, `~/.claude.json`, plugin `.mcp.json` | stdio (no `type`): `command,args,env`; `type:http` or `streamable-http`: `url,headers`; `type:sse`: deprecated; `type:ws` | stdio: same keys. http: `url`+`headers`. sse: `transport: sse`, flagged **deprecated** (MCP 2026-07-28 spec). `ws`: **U**. `sdk` is skipped. `timeout` (ms) becomes `timeout` (s). `oauth{clientId,callbackPort,scopes,authServerMetadataUrl}` becomes `auth: oauth` plus `oauth:{client_id,redirect_port,scope}`. `authServerMetadataUrl` is **U** **[verify]**. |
| `headersHelper` | command printing JSON headers | **U** in phase 1 (it is a hook-like command run per connect, so it is trust-gated and needs its own runner). The server is imported without it and flagged. |
| Codex `[mcp_servers.<id>]` | `command` or `url`, `http_headers`, `env_http_headers`, `bearer_token_env_var`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec`, `tool_timeout_sec` | `env_http_headers`/`bearer_token_env_var` become `headers: {Authorization: "Bearer ${VAR}"}`. Tool lists become `tools.include/exclude`. `tool_timeout_sec` becomes `timeout`. `enabled:false` becomes `enabled:false`. |
| Gemini `mcpServers` | `command`, `url` (SSE), `httpUrl` (streamable), `trust`, `includeTools`, `excludeTools` (wins) | `httpUrl` becomes `url`. `url` becomes `url`+`transport: sse`. `trust` is dropped. Priority `httpUrl` > `url` > `command`. |
| Cursor `mcp.json` | `command` / `url`, `envFile`, `auth` | verbatim. `envFile` is read at translation time. Secrets are never copied (they are referenced as `${VAR}`). |
| Grok Bot connectors | URL (+headers/OAuth client) or command | as Cursor remote and stdio |

**Environment expansion.** Hermes natively expands `${VAR}`, `${env:VAR}`, `${workspaceFolder}`, `${userHome}`, `${workspaceFolderBasename}` and `${/}`. Compat rewrites the rest at translation time.

| Source token | Becomes |
|---|---|
| `${VAR:-d}` (Claude, Gemini) | `${VAR}` if `VAR` is defined in the profile `.env` or the environment at translation time, else the literal `d`. Re-evaluated at each session prepare. |
| `$VAR` (Gemini) | `${VAR}` |
| `${CLAUDE_PROJECT_DIR}`, `${workspacePath}` | `${workspaceFolder}` |
| `${CLAUDE_PLUGIN_ROOT}`, `${extensionPath}` | absolute plugin path at install |
| `${CLAUDE_PLUGIN_DATA}` | `<home>/hypotaxis/compat/plugin-data/<id>` |
| `${user_config.KEY}` | non-sensitive value substituted. Sensitive values are `${HX_...}` references resolved from the keychain by the host. |

An unresolved reference in `url` or `headers` fails the server closed (Hermes already does this).

**Secrets.** Literal secret-looking env or headers in a source file are stripped and reported, never written to `config.yaml`. This is the importer's rule (`is_secret_key`).

**OAuth.** Hermes owns it (`auth: oauth`; CIMD, DCR, PKCE, step-up, per `H:website/docs/user-guide/features/mcp.md`). Compat writes config only and implements no OAuth. The MCP 2026-07-28 requirements in `F§9` (RFC 9728, RFC 8707 `resource`, RFC 9207 `iss`, 403 step-up) are conformance targets for Hermes's client. **[verify]** with the mock authorization server in section 12. A failure is reported upstream and is never patched here.

**Dedupe and precedence.**
- Same name: native `config.yaml` entry beats the project, which beats user, which beats plugin (Claude's order: local > project > user > plugin; whole-entry replacement, no field merge).
- Same endpoint (`url` or `command`+`args`) from a plugin and from a scope: keep the higher scope.
- A server a user already configured natively is never overwritten.

**Per-server trust.**
- Project servers need approval (section 11).
- `trust: untrusted` (Hermes's write-capable-call prompt) is the default for every **project-scope** server. A user may widen it per server. A package may only narrow, never widen (Hermes's own rule, `H:hermes_cli/agent_plugins.py`).
- Claude's `enableAllProjectMcpServers` and `enabledMcpjsonServers` are honoured only from user and managed files, never from a committed file. `disabledMcpjsonServers` always applies.

## 8. Rules with globs (cache-safe)

Sources: Cursor `.mdc` (`alwaysApply`, `globs`, `description`), Claude `.claude/rules` (`paths`), Antigravity `.agents/rules` (`trigger`). All normalize to `Rule{mode: always|glob|model_decision|manual}`.

**Constraints, verified:**
- Plugin system prompt sections hold 4,000 chars each and **8,000 in total across all plugins**, shared with hypotaxis's own governance section.
- Hermes already appends context to tool results through the subdirectory-hint mechanism.
- Hermes injects `pre_llm_call` context into the user message.

**Alternatives:**

| Option | Verdict |
|---|---|
| A. Everything in the system prompt | **Rejected.** It exceeds the 4,000 and 8,000 character budgets for any real ruleset. |
| B. Index in the section plus full text appended to the first matching tool result | **Chosen for glob rules.** It is cache-stable (the prefix is untouched), deterministic and mirrors Hermes's own hints and Claude's lazy `paths` semantics. |
| C. Inject matching rules into the next user turn | Rejected. It is one turn late, and the user message is the wrong carrier. |
| D. A `rules(path)` tool the model calls | Rejected for glob rules, because it depends on model behaviour. It is not needed, since skills already give progressive disclosure. |

**Decision.**

1. **always** rules and memory docs Hermes did not load natively:
   - If the total is at most 2,000 chars, inline it in a compat section (`id: compat-rules`, at most 3,500 chars, so hypotaxis's governance section keeps at least 4,000 chars of the 8,000 total).
   - Otherwise the **bodies** go to the first `pre_llm_call` of the session (`is_first_turn`), prefixed `[Project rules]`, and are re-delivered once on the next prompt after any `post_compaction`. Only the index stays in the section. The choice is by size, recorded in the inventory.
2. **glob** rules: the section (or first-turn block) lists `<globs> -> <rule name, one line>`. The body is **appended once per session** by a `transform_tool_result` callback to the first `pack` or `ship` result (or Hermes file tool) whose target path matches any glob. A per-session delivered set is kept. It is re-armed after `post_compaction`. The block is `[Rule <name> (<source path>)]` plus the body, capped at 8,000 chars (overflow gets a head-and-tail marker with the path).
   - Path matching uses gitignore-style globs against the repo-relative path, for `pack` read, search and glob results (any matched path) and for `ship` (each target).
   - Claude's lazy subdirectory `CLAUDE.md` stays native.
3. **model_decision**: a synthesized skill `rule-<name>` (the description is the rule description). The model loads it through Hermes's progressive disclosure.
4. **manual**: a user-only `/rule-<name>` command.
5. Antigravity: an invalid or missing `trigger` drops the rule. Limits are applied as in 3.6.
6. Rule text passes the redaction and injection scan, and is labelled as project data.

### 8.1 `.mdc` handling and the native load

We **strip the frontmatter and honour `alwaysApply`, `globs` and `description`**. Hermes does not (`H:agent/prompt_builder.py` `_load_cursorrules`): every top-level `.mdc` is always-on with its frontmatter included.

**Is suppression needed?** Only in one case, and it cannot be done without patching Hermes.
- The native `.mdc` load is active only when no `.hermes.md`, `AGENTS.md` or `CLAUDE.md` is found. When any of those exists, Hermes does not load `.mdc` at all, and compat delivers the rules alone. There is no double inclusion.
- When `.cursor/rules` is the winning type, Hermes has already put every top-level `.mdc` into the system prompt. Compat cannot remove it.
  - `ignore_rules` on `session.create` is rejected, because it also drops memory and `SOUL.md` (`H:gateway/session_execution.py`).
  - Creating a higher-priority file in the repo is forbidden (section 0, rule 7).
  - Compat detects this case by re-evaluating the same priority order (`.hermes.md`, `AGENTS.md` chain, `CLAUDE.md`, `.cursorrules`).

**Rule in that case:** compat delivers **nothing twice**.
- It skips every top-level `.mdc` that Hermes loaded, and any later glob delivery for them.
- It delivers only what Hermes missed: nested `.cursor/rules/**` files, and `.claude/rules`, Antigravity and other sources.
- It reports each skipped file as `native_overinclusion` in `compat.inventory`, because glob, description-only and manual rules are always-on there.

The real fix is upstream (deferred, section 13). Where a project needs the exact semantics, a committed `AGENTS.md` makes Hermes skip the native `.mdc` load, and compat then applies the frontmatter.

## 9. Plugins and marketplaces

| Format | Manifest | Handled as |
|---|---|---|
| Claude plugin | `.claude-plugin/plugin.json` (or none), `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json` | **T**. Not loadable natively, because Hermes's adapter wants a **root** `plugin.json` with the agent-plugins `$schema`. |
| Claude marketplace | `.claude-plugin/marketplace.json` | T (`name`, `owner`, `plugins[]`; sources: relative, `github`, `url`, `git-subdir`, `npm`, `archive`, `command`) |
| Gemini extension | `gemini-extension.json` | T |
| Antigravity plugin | `plugin.json` / `.antigravity-plugin/` | T (phase 2) |
| Agent Plugins v1 | root `plugin.json` | **N** |
| Hermes plugin | `plugin.yaml` | **N** (`hermes plugins install`) |

**Install flow** (`plugin.hypotaxis.compat.plugin.install{name@marketplace | source}`):
1. Resolve the entry (marketplace `strict` rules, `F§1.9`). A `strict:false` entry that conflicts with its manifest fails with "conflicting manifests". A `url` marketplace cannot use relative sources.
2. Fetch into `<home>/hypotaxis/compat/plugins/<slug>/source/`:
   - **Pinned to a 40-hex commit.** If the entry gives a `ref`, resolve it to a SHA at install. Never track a branch.
   - npm sources: no install scripts.
   - `command` sources and `archive` sources without `sha256` are refused.
3. Compute `tree_sha256` (sorted path and content hashes). Write `lock.json`: `{schema, source, sha, tree_sha256, version, installed_at, components, user_config(non-sensitive)}`.
4. Show the **install prompt** (section 11): the full component list, every hook command, MCP server and agent, requested `userConfig`, and the hash.
5. On consent, generate a **portable Agent Plugin v1** at `<home>/plugins/<slug>/` containing only `plugin.json` and `skills/<n>/SKILL.md`, with frontmatter normalized to v1 (`name` equals the directory, strings only). Skills that fail validation are skipped and reported. Hermes then provides native namespacing `<slug>:<skill>` and enable and disable. Run `hermes plugins enable <slug>`.
6. Hooks, commands, agents, rules and MCP servers are read from `source/`. They are active **iff Hermes reports the generated plugin enabled** and the trust grant matches. **Hermes's enabled flag is the single source of truth for enable and disable as a unit.** Disabled plugins' hosted MCP servers do not start. Uninstall removes `plugins/<slug>`, the `source/` directory and the trust records.
7. `plugin.update`: re-resolve, show the **component diff**, re-prompt (hash changed), then swap atomically. Claude's `${CLAUDE_PLUGIN_ROOT}` changes on update (as in Claude), and `${CLAUDE_PLUGIN_DATA}` persists.

Other rules:
- Reserved marketplace names (`claude-plugins-official`, `anthropic-*`, ...) are accepted only from the sources Claude itself accepts, and `blockedMarketplaces` and `strictKnownMarketplaces` from managed settings are honoured.
- Components are namespaced `plugin:name` everywhere (commands, agents, MCP tool names).
- Plugin `userConfig` values are collected by the UI. Sensitive values go to the OS keychain through the host (STANDARDS section 5) and reach hooks and MCP only through `CLAUDE_PLUGIN_OPTION_*` or `${HX_...}`.
- `engines` and `dependencies` are checked. Unmet means not installed.

## 10. Precedence

General rule (STANDARDS section 2): **managed > CLI > project-local > project > user > plugin**. Lists merge and scalars override. **deny > ask > allow regardless of source.** **A native Hermes item beats a translated item at the same level.**

| Subject | Order, highest first | Notes |
|---|---|---|
| Settings scalars | managed (`/etc/claude-code`, `/etc/hermes`, ...), `--settings`, `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json` | arrays union, `env` per key. Keys Claude ignores in repo files stay ignored (`defaultMode: bypassPermissions`). |
| Permissions | **deny > ask > allow**, first match wins, source irrelevant | Project `allow` waits for trust. `deny` and `ask` apply immediately (restrictive). Bash matching follows `F§1.2` (wrapper stripping, compound commands, `Bash(ls *)` vs `lsof`). |
| Memory and rules text | **Concatenate, never override.** Native Hermes block first (whichever type won). Then translated docs in this fixed order: managed, user, ancestors root to cwd, project, local. Per directory, `CLAUDE.md` then `AGENTS.md` then `GEMINI.md`. | Content duplicated by digest is dropped (same rule as Hermes's AGENTS chain). Codex `AGENTS.override.md` replaces its sibling. |
| Skills | trusted project (native `.hermes`, `.agents`) > registered `claude:`/`gemini:`/`agy:` project skills > local profile > `create_dir` > `external_dirs` > plugin (namespaced, no clash). Within one root: native dialect, then `.agents`. | Hermes's own tier order. Same-tier clash refused. A skill beats a same-named command. |
| Commands | built-in > skill > project > user > plugin | 5.1 |
| Subagents | managed > `--agents` > project > user > plugin | by `name` |
| MCP | native `config.yaml` > project > user > plugin > connectors | whole-entry replacement |
| Hooks | **additive across all sources.** All matching handlers run in parallel. Strictest wins. | Native Hermes `hooks:` entries and plugin hooks run too. They are not overridden. **[verify]** the conflicting-hook semantics for non-Claude sources. |
| Cursor rules | Team > Project > User (cloud tiers unsupported, so Project and User files) | |
| Gemini | project commands > user > extension; `/ext.cmd` on conflict | |

## 11. Trust

**Gated** (inert until approved):

| Kind | Items |
|---|---|
| `hooks` | every hook handler, including plugin and frontmatter hooks |
| `mcp` | every project, plugin and Codex-project server |
| `plugins` | install and update |
| `commands` | `` !`cmd` `` and `!{}` injections in commands and skills |
| `permissions` | project `allow` rules only (kept gated: an `allow` widens, so fail closed) |
| `imports` | a `CLAUDE.md` `@path` import that resolves outside the project root (3.1). Keyed by the import path in its importing file; the hash is the imported file's bytes. User and managed files import freely. |

**Not gated: translated memory, rules, skills and agent prompts.** They are prompt material, which matches Hermes (it loads `AGENTS.md` ungated). They still pass the redaction and injection scan and are labelled as project data. Trust gates only what **executes code**.

`deny` and `ask` rules and the native Hermes behaviour are never gated.

**Prompt contents** (rendered by the host, never by the repo): the project path and git remote, then per kind each item's exact text. For hooks, the full command line, the event, the matcher, the timeout, and the script file when the command is a path (with its hash). For MCP, the command or URL, argument list, header and env **names** (values redacted), the transport and OAuth use. For imports, the importing file, the import path and the imported file's hash. For plugins, source, SHA, tree hash, component list, `userConfig` requests. On a re-prompt, the **diff** against the approved set. Options: approve the kind, approve selected items, or decline. Declining leaves the items listed as untrusted.

**Storage:** `<home>/hypotaxis/compat/trust.json` (versioned schema, atomic write, mode 0600). Entries:
`{project_id (realpath + git remote hash), kind, item_id, content_hash, decided_at, decided_by:"user"}`.

**Hash:** SHA-256 of the canonical JSON of the translated item plus the bytes of every script file it names. Approval is per `(kind, item_id)` and valid only while the hash matches.

**Re-prompt on change:**
- A changed or new item is untrusted until approved.
- Removed items are dropped.
- Unchanged items stay approved.
- A `git pull` that alters a hook therefore re-asks.

**Headless** (no UI to answer): untrusted items stay inert. Nothing prompts in a gateway. A pre-trusted project list can be supplied only by the user's profile, never by a repo file.

## 12. Conformance suite

The suite lives in `plugins/hypotaxis/tests/compat/`. Fixtures are pinned in `tests/compat/fixtures.lock` (`repo`, 40-hex SHA, retrieval date). **Pinning happens at W3 start.** This session had no GitHub access, so no SHA is claimed here, and the Hermes pins are the only known ones. Hermes `v0.23.2` is `ae2a81cc`, and `hermes-official-plugins` is `e726eb7d`.

| Fixture | Source | Passes when |
|---|---|---|
| Claude plugins and marketplace | `anthropics/claude-code` (`plugins/`, `examples/settings/`), `anthropics/claude-plugins-official` | every plugin installs (trust auto-approved by the test harness), skills load as `<slug>:<skill>`, every hook fires with the golden payload, agents and commands appear, unsupported items appear in the inventory with their reasons |
| Skills | `anthropics/skills`, `agentskills/agentskills` | each skill loads in Hermes (`skill_view`) and `skills-ref validate` agrees on name and description rules |
| Codex | `openai/codex` (`AGENTS.md`, `.codex`) | the `AGENTS.md` chain equals Hermes's native output (no translation), config MCP entries translate |
| Gemini | `google-gemini/gemini-cli` (`docs/extensions`, commands) | extension installs and TOML commands render |
| Hermes | `NousResearch/hermes-agent` `skills/`, `hermes-official-plugins` | native items are untouched (byte-identical config and tree) |
| MCP | `modelcontextprotocol/servers`, `github/github-mcp-server` (`.mcp.json` and stdio entries) | translated servers connect to a **local** reference server, and the tool list matches |
| Synthetic goldens | in-repo | below |

**Synthetic fixtures**, one directory each with input and expected output:
- **Per hook event**, a golden stdin payload plus an exit-code and JSON matrix (0, 2, other, timeout, each JSON field, `onFailure`).
  - Events: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart (4 sources), SessionEnd, Stop (edit and no-edit turns), SubagentStart/Stop, Notification, PostCompact.
  - Also the alias table (every row of 4.5 for `pack`, `ship` and `exec`).
  - Also the unsupported events: they must be listed and never executed.
- The permission-rule match table from `F§1.2`.
- `@` import depth-4 and code-span cases.
- Marketplace `strict` true and false conflicts.
- A Cursor four-type rule matrix, including `.md` ignored.
- An Antigravity rule with an invalid `trigger`, which must be dropped.
- Glob-rule delivery: exactly once per session, re-armed after compaction, and **byte-identical system prompt before and after**.
- MCP env-expansion table (section 7).
- Trust: hash change re-prompts, headless stays inert.
- An MCP stateless versus `initialize` server pair.
- A mock authorization server covering RFC 9728, RFC 8707 `resource`, RFC 9207 `iss` and a 403 step-up. This tests Hermes's client and records failures upstream.

**Round-trip rule:** parse, then unified model, then re-emit must preserve unknown keys (`ext`) byte-semantically.

**Cache invariant test (every fixture):** the rendered system prompt and the tool schemas at turn N equal those at turn 1, and only tool results and user messages differ.

**CI:** job `compat` in the Python lane, after `ruff`, `pyright` and `pytest`.
1. Install pinned Hermes (`vendor/hermes-agent`).
2. Run `hermes plugins validate --ci` on the plugin.
3. Run the suite offline against vendored fixture snapshots (no network in unit tests, STANDARDS section 10).
4. A weekly job refreshes `fixtures.lock` and re-runs the docs diff (`F§13`: the vendor formats move fast). A drift failure opens an issue and never silently updates.

A fixture passes only if every item is **loaded or listed with a reason**. A silent drop fails.

## 13. Open questions and deferred scope

**Open questions for the owner:** none at this revision. Decisions are folded in above (skills registration, hosted MCP, ADR-0013, `allow`, timeout, instruction trust).

**Deferred (phase 2):**
- Codex, Gemini and Antigravity hooks (payloads unverified, 4.6).
- Antigravity plugins.
- OAuth MCP servers in project and plugin scope (needs a Hermes session-scoped API).
- `headersHelper`, `bin/` on `PATH`, `.lsp.json`.
- An upstream request to Hermes to strip `.mdc` frontmatter and honour `alwaysApply` and `globs` (8.1). This is a contribution, not a patch.
