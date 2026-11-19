# AGENTS.md: plugins/boopis/compat

Projects and plugins made for other harnesses load unchanged. The spec is `docs/COMPAT.md` (binding). Part 1 reads
Claude Code, merges it, gates what executes behind trust, and bridges Claude Code hooks onto Hermes's hooks. Codex,
Gemini, Cursor, Antigravity, skills and commands registration, MCP hosting and marketplace installs are part 2.

## Layout
| Path | Job |
|---|---|
| `model/` | `items.py`: frozen dataclasses (source, precedence, `raw`). `jsonval.py`: typed access to untrusted JSON and YAML |
| `readers/` | one module per file kind. A bad file is a `Diagnostic`, never an exception. `common.py` has the YAML frontmatter split (Hermes's `hermes_yaml`) |
| `merge.py` | precedence and merge, pure functions over a total order, so input order never matters |
| `trust.py` | what is gated, the content hash of each item, and the state over `config.TrustStore` |
| `scan.py` | one read-only scan of a project into an immutable `ScanResult` |
| `activation.py` | the one place a hook's state (active, untrusted, unsupported, ...) is decided |
| `snapshot.py` | a session's frozen view: scan, classified hooks, compat permission policy |
| `hooks/` | the bridge: `alias`, `matcher`, `payload`, `runner`, `decision`, `engine`, `core`, `tool_events`, `session_events`, `bridge`, `grants`, `transcript`, `hermes` |
| `inventory.py`, `rpc.py` | `compat.inventory`, `trust.set` |
| `registry.py` | the Hermes hooks and RPC methods `register` wires, as data, with no imports |
| `data/*.json` | the event map, the alias tables, limits. Data, not code (STANDARDS rule 6) |

## Invariants
- **Nothing here runs code until the user approved it.** Gated: hook handlers, MCP servers, plugins, `!` injections, repository `allow` rules, `@` imports that leave the project (kind `imports`). Not gated: memory, rules, skills, agent prompts, `deny` and `ask` rules.
- **An approval is a content hash.** A hook's hash covers its handler, matcher, the effective `env` and the bytes of the scripts it *runs* (a program or an interpreter's first argument inside the project or plugin, never a redirection target). `runner` re-derives it before every spawn, so a script edited mid-session is not run.
- **The only shell string is a trusted hook command** (ADR-0013), through `util.proc.run_shell`. Exec form (`command` plus `args`) never uses a shell.
- **A ship that changes what a hook loads switches the hooks off** (`rearm.py`). The tools a hook runs load project files outside its hash (`package.json` scripts, `eslint.config.js`, a `Makefile`, `conftest.py`: `hook_config_globs` in `data/limits.json`), and `ship` is the agent's way to write them. After a ship keeps its changes, if it touched one of those files or a hook's own script, every trusted command hook of the project loses its approval (untrusted again, not declined) and a `permission` form asks the user; the answer `trust` re-approves only a hook whose hash is still the one the form showed. `hooks.core.recheck` re-reads the trust store before every spawn, so a running session stops at once. Hooks are not sandboxed instead because a formatter must write the workspace and a notifier reach the network (ADR-0013); the glob list is a heuristic, not a proof. If the check itself fails, every hook approval of the project is withdrawn (fail closed).
- **Prompt caching is sacred.** Hook context is delivered in the user message (`pre_llm_call` context) or appended to a tool result. Never the system prompt, the toolsets or the tool schemas.
- **Fail closed where it is a policy.** `pre_tool_call` blocks if the bridge cannot decide, and blocks a call whose `updatedInput` cannot be applied faithfully. Observers log and swallow.
- **Nothing is fabricated.** A key Hermes cannot supply is left out of a payload (`effort`, timestamps). An event with no faithful mapping is listed in `compat.inventory` with its reason and never run.
- **Never write to a foreign file.** Compat writes only under `<profile home>/boopis/compat/` (trust store, transcripts).
- **One permission function.** Claude's permission rules are judged by `policy.check`; compat never adds a second decision path.

## Hooks bridge: what is mapped
Mapped (11): PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop, Notification, PostCompact. Unsupported (22, listed with reasons in `data/hook_events.json`): PreCompact, PermissionRequest, PermissionDenied, UserPromptExpansion, PostToolBatch, StopFailure, Setup, TaskCreated, TaskCompleted, TeammateIdle, ConfigChange, FileChanged, CwdChanged, DirectoryAdded, WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult, MessageDisplay, InstructionsLoaded, PreModelSwitch, PostModelSwitch.

Known gaps, all reported rather than hidden:
- **Stop** runs at the final `post_llm_call` of every completed turn. A block goes back through `ctx.inject_message`, so it is a new queued turn after the answer, not a continuation inside it, and needs `plugins.entries.boopis.allow_gateway_injection` (warned in `compat.inventory`). Hermes's `pre_verify` is not used: it never fires after a `ship`. Upstream proposal: `UPSTREAM.md`.
- **SessionStart** hooks run at the next `pre_llm_call`, not at `on_session_start`: the open and reset hooks carry no cwd, and the context must reach that turn's user message anyway.
- **A hook `allow`** is recorded in `hooks/grants.py`, and `policy._ask` consumes it (`SessionPolicy.hook_allow`), so it skips only boopis-level approval prompts for that one call. `register_compat` runs before the policy hooks are registered so the grant is on record in time. Claude's own `ask` rules (`hook_allow=False` in the compat policy), Hermes's approvals and deny, protected-path and governed-mode decisions are unaffected.
- **`updatedInput`** replaces the whole object in Claude Code. Hermes merges a patch, so an omitted key keeps its original value (logged). A rewrite of a fan-out call (`pack`, a multi-file `ship`, several URLs) cannot be mapped back and blocks the call.
- **`permission_mode`** is `bypassPermissions` only when `approvals.mode` is off. Hermes's per-session YOLO switch is not on the public plugin API.
- `effort`, `scratchpad_dir` and transcript timestamps are not supplied: Hermes does not give them to plugins.

## Verified against Hermes v0.23.2 (source) and Claude Code docs
| Question | Result |
|---|---|
| Does `ctx.dispatch_tool` fire `pre_tool_call`? | **No.** `hermes_cli/plugins_context.py:485` calls `registry.dispatch` directly. The exec kernel must call `Bridge.run_tool_event` itself. |
| Does a `ship` write count as an edit for `pre_verify`? | **No.** `FILE_MUTATING_TOOL_NAMES = {write_file, patch}` (`agent/tool_result_classification.py`), and `pre_verify` needs a non-empty `_turn_file_mutation_paths`. Hence Stop does not use `pre_verify`. |
| Does a blocked `UserPromptSubmit` stay in history? | It is stored as `[Message withheld: a pre_llm_call policy hook blocked it.]`. The prompt never reaches a model, now or on replay. Claude Code erases it instead. |
| Order of `on_session_start` and `pre_llm_call`? | `on_session_start` fires while the system prompt is built (`agent/turn_context.py:1308`), before `pre_llm_call` collects context (`:1339`) in the same turn. |
| `pre_tool_call` directives | `block` needs a message; `approve` optional `rule_key`; `modify` shallow-merges `args`, accumulates across callbacks, and loses to `block` and `approve` only in the sense that those are resolved separately. One directive per callback, hence two callbacks. |
| Callback bounds | `plugins.hook_callback_timeout` default 30 s, max 600, `<= 0` unbounded. `pre_tool_call` fails closed on a timeout; `pre_llm_call`, `transform_tool_result`, observers skip. Compat clamps a hook to `limit - 1`. |
| `subagent_stop` kwargs | `parent_session_id, child_session_id, child_role, child_summary, child_status, tool_call_history, duration_ms`. No `child_subagent_id`, so the id from `subagent_start` is remembered. |
| Claude Code default hook timeout | **600 s** for `command`, `http` and `mcp_tool`; 30 s on UserPromptSubmit and the model-switch events; 10 s on MessageDisplay (`code.claude.com/docs/en/hooks`, fetched 2026-11-18). The 60 s recalled earlier is the `agent` handler default. |
| `updatedInput` | Exists in `hookSpecificOutput`, replaces the whole input object; `deny > defer > ask > allow`; `allow` does not skip deny or ask rules (same page). |
| `ctx.inject_message` | A user-role message (other roles are prefixed `[role]`). In a local gateway session it is committed to that session's own FIFO as a producer admission, from the session bound in the calling hook context, and runs once, in order, as a new turn after the current one. Needs `plugins.entries.<id>.allow_gateway_injection: true`; returns False otherwise. Checked live: the e2e Stop test sees the answer, then the injected message as the next user message. |
| `ctx.session_cwd()` in hooks | Works in the agent's hook threads (the e2e payload carries the project cwd). Not reliable in `on_session_open` or RPC, so those never build a snapshot. |
| Real `transcript_path` consumers | **Not verified.** No consumer fixture accepts or rejects the best-effort JSONL. |

## Test
```sh
export HX_HERMES_SRC=<a Hermes source tree>        # frontmatter tests skip without it
pytest tests/compat                                 # unit, real-subprocess and property tests
export HX_E2E_HERMES_ENV=<the spike install dir> HX_BIN=<cargo build -p hx>   # ../../tests/e2e/test_compat_e2e.py skips without them
```
Fixtures: `tests/fixtures/claude_code/` (synthetic project, golden stdin payloads per event in `hooks/`, and real plugins from anthropics/claude-plugins-official, Apache-2.0, source and commit in `real/.../SOURCE.md`).

## Do not
- Run a hook, a `!` injection or an MCP server that is not trusted, or trust anything because a file in the repository says so.
- Change the system prompt, toolsets or tool schemas from here.
- Add a path-based "script" heuristic that hashes redirection targets: a hook that logs into the repository would re-prompt itself on every run.
- Import Hermes internals. `hermes_yaml` and `hermes_cli.config` are on the public list; import them lazily.
