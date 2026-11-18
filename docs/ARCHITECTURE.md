# hypotaxis architecture

Status: v2, 2026-11-18. Replaces `docs/ARCHITECTURE_PLAN.md` (the first-pass plan) wherever they differ.
Companion documents: `docs/STANDARDS.md` (how everything is written), `docs/DECISIONS.md` (why), `docs/PROTOCOL.md` (the wire), `docs/LEDGER.md` (the event log), `docs/COMPAT.md` (other harnesses' formats).

hypotaxis is a desktop coding harness that runs any model, through any subscription the user already pays for, with contraprova's governance built in and measured. Its engine is **unmodified upstream Hermes Agent**. hypotaxis is Hermes with the configuration already done, a governed execution plane, a tasteful app, and numbers behind the defaults.

## 1. The organising rule: Hermes's own model

hypotaxis is organised the way Hermes organises itself, so that Hermes updates, plugins and skills flow through unchanged.

- **The core is a narrow waist; capability lives at the edges.** Hermes's rule (root `AGENTS.md` of hermes-agent). Hermes is never patched. Everything hypotaxis adds is an edge: a Hermes plugin, a skill, an MCP server, or a separate host process.
- **Three authorities**, as in Hermes Desktop (`apps/desktop/AGENTS.md`):
  - the **host** (Tauri, Rust) owns the machine: processes, OS keychain, sandboxing, windows, updates, the local git server, the macOS VM;
  - the **UI** (webview, TypeScript) owns the experience: rendering, input, keyboard, themes;
  - the **backend** (the Hermes gateway plus the hypotaxis plugin running inside it) owns the work: sessions, the agent loop, tools, memory, skills, governance, the ledger.
  A component never decides something another authority owns. It caches server truth and does not own it.
- **One layer per mechanism.** If Hermes already does something (provider adapters, prompt caching, memory, skills, subagents, cron, chat platforms, MCP), hypotaxis uses it and does not rebuild it.
- **Generated contracts.** Wire types are generated from one schema, as Hermes generates `gateway-contract.openrpc.json`. They are never hand-mirrored.

## 2. What changed from the plan, and why

Research on Hermes v0.23.2 (`ae2a81cc`) and an audit of the first-pass code produced five corrections:

1. **No Rust model gateway.** Hermes already ships about 40 provider plugins, prompt caching and models.dev data. It can use any single endpoint as its only provider, and the Claude subscription relay is an official Hermes plugin (`claude-subscription-directsdk`). A Rust gateway would duplicate all of it. Routing, cost caps and usage accounting move into the hypotaxis plugin, through Hermes hooks (`post_api_request`, `pre_llm_call`) and per-session or per-subagent model selection.
2. **Governance is a Hermes plugin, built on contraprova's own Python.** Contraprova is stdlib-only Python and its kernel is tested. The first-pass Rust "port" was wire-incompatible and invented its own semantics. Reusing the original keeps the measured policy exactly and works in plain Hermes (CLI, TUI, chat platforms) as well as in the app.
3. **The Hermes wire is `hermes-gateway-v1` over a loopback WebSocket**, bootstrapped by `hermes gateway ensure|attach --json`. It isn't stdio. Built-in toolsets are chosen by the host at `session.create {toolsets}`, because a plugin cannot disable them.
4. **`exec` needs its own kernel.** Hermes's code kernel is synchronous and can call only 7 whitelisted tools. hypotaxis's kernel is asyncio-based and calls *any* tool through the plugin's `ctx.dispatch_tool` (the full Hermes pipeline: approvals, redaction, budgets).
5. **Rust is kept where Rust earns its place:** a capability-safe file transaction (ship's journal), fast search and outlines (pack's engine), OS sandboxing, and the host. These live in one binary, `hx`, that the plugin drives over JSON-RPC.

## 3. Components

```
+-------------------- hypotaxis app (Tauri) --------------------+
|  UI (webview, TS)  <-- Tauri IPC (typed, generated) -->  host  |
|  v6 design system         Channel streams            (Rust)   |
+-------------------------------------------------------|-------+
                                                        | WebSocket, hermes-gateway-v1
                                                        | (host proxies; no Origin; ticket)
+---------------- Hermes gateway (unmodified, per profile) -----+
|  agent loop · sessions · providers · memory · skills · cron   |
|  subagents · MCP · chat platforms · approvals                 |
|   +--------------- hypotaxis plugin (Python) --------------+  |
|   | tools: pack · exec · ship (+ dispatch, governed mode)  |  |
|   | governance: cascade · gate · lanes · policy · cost cap |  |
|   | ledger (contraprova) · feedforward · blanks · compat   |  |
|   +-----|---------------------------|----------------------+  |
+---------|---------------------------|-------------------------+
          | JSON-RPC over stdio       | asyncio RPC (own socket)
     +----v-----+               +-----v---------------------+
     |  hx      |  sandbox ---> | exec kernel (Python)      |
     | (Rust)   |  launcher     | in an OS sandbox          |
     +----------+               +---------------------------+
```

| Mechanism | Lives in | Notes |
|---|---|---|
| Agent loop, sessions, compaction, memory, skills, learning loop | Hermes | Used as they are |
| Model providers, auth, prompt caching, model catalog | Hermes | Its provider plugins, including `claude-subscription-directsdk` |
| Subagents, worktrees, background processes, cron, chat platforms, MCP | Hermes | `delegate_task`, `/worktree`, `cron`, gateway platforms, `mcp_servers` |
| Tools `pack`, `exec`, `ship`, `dispatch`; `leave_blank` in exec | hypotaxis plugin | Registered in toolset `hypotaxis` |
| Cascade, gate, contract lanes, permission policy, cost cap | hypotaxis plugin | contraprova semantics |
| Ledger | hypotaxis plugin | contraprova's `EventLog`, extended event set (`docs/LEDGER.md`) |
| Feedforward, blanks | hypotaxis plugin | Plugin RPC and events on the gateway socket |
| Compatibility with Claude Code, Codex, Gemini CLI, Cursor, Antigravity | hypotaxis plugin (`compat/`) | Translates into Hermes's own surfaces (`docs/COMPAT.md`) |
| Search and outlines, file transaction, OS sandbox | `hx` (Rust) | JSON-RPC over stdio, one warm child per Hermes process |
| Hermes lifecycle, WS proxy, keychain, windows, notifications, updater | host (Rust) | Machine authority |
| Local artifacts git server, macOS VM and its screen stream | host (Rust crates) | Later phases |
| Rendering, keyboard, themes, dock, cards, orbs | UI (TypeScript) | The approved v6 mock-up's component library, ported |

## 4. Hermes integration

**Install and update.** hypotaxis never vendors or patches Hermes at runtime.
- On first run the host finds Hermes (`hermes --version`, `install-stamp.json`). If it's missing, the host runs Hermes's own installer with the user's consent.
- Hermes updates through Hermes's own channel (`hermes update`, stable releases `vX.Y.Z`).
- The plugin declares `requires_hermes`, and the host refuses an older Hermes.
- A running gateway can outlive an update, so the host compares `client_code_sha` with `endpoint.code_sha` and restarts the gateway when they differ.
- `vendor/hermes-agent` is a git submodule pinned to a release tag. It's used only for CI (contract generation, plugin validation, end-to-end tests), never at runtime.

**Profile.**
- By default hypotaxis attaches to the user's **active Hermes profile**, the way Hermes Desktop does: one gateway multiplexes every client of a home. That way the user's existing plugins, skills, memory and MCP servers work in hypotaxis unchanged, and hypotaxis sessions show up in the Hermes CLI and TUI.
- A setting switches to a dedicated profile.
- hypotaxis state lives under `<profile home>/hypotaxis/`: ledgers, journals, artifacts, the exec scratch area.
- **Teammates are Hermes profiles** (`profiles/<name>/`), each with its own SOUL.md, memory, skills and schedule.

**Gateway.**
1. The host runs `hermes gateway ensure --json`, then `attach --json` for a ticket. On POSIX it may speak the documented control socket instead.
2. It dials `ws://127.0.0.1:<port>/api/ws` with no `Origin` header and the ticket subprotocols.
3. It calls `runtime.describe` and gates features on `capabilities`.
4. It sends `client.capabilities {server_requests: true}`.

The host proxies frames between the UI and the gateway. The UI never opens sockets itself. A browser WebSocket always sends `Origin`, and tickets must not reach page script.

**Session policy** is set at `session.create`:
- `cwd`;
- `model` and `provider` from the session's mode (section 6);
- `toolsets`: `["hypotaxis"]` in governed mode, a profile-defined set in ungoverned mode;
- `skills`;
- `source: "gui"`;
- `client: {name: "hypotaxis", version}`.

Prompt caching is sacred in Hermes, so toolsets and the system prompt never change mid-session.

## 5. The hypotaxis plugin

A normal Hermes plugin (`plugin.yaml` manifest v2, `kind: standalone`, `__init__.py: register(ctx)`), shipped with the app and installable alone through Hermes's plugin catalog (SHA-pinned). It runs in plain Hermes too: the CLI and chat platforms get governance and the ledger, without the app.

It registers:
- **Tools** in toolset `hypotaxis` (section 7). Handlers return JSON strings. `check_fn` hides tools whose prerequisites are missing, for example `hx` not found.
- **Hooks:**
  - `pre_tool_call`: permission policy, scope and protected-path vetoes, approval escalation; fails closed;
  - `post_tool_call`: ledger;
  - `post_api_request`: usage into the ledger, cost-cap accounting;
  - `pre_llm_call`: cost-cap block;
  - session lifecycle hooks: ledger open and close;
  - `subagent_start` and `subagent_stop`: attempt tracking.
- **System prompt section** (`register_system_prompt_section`) for the governed-mode contract, so it's cache-stable.
- **RPC namespace** `plugin.hypotaxis.*` and session events through `ctx.emit_to_session`: feedforward, blanks, ledger stream, cascade state, compat inventory (`docs/PROTOCOL.md`).
- **Approval transport** `hypotaxis`: approval prompts render as cards in the app. Chat-platform buttons keep working through Hermes's own transports.
- **Settings** through `config_schema`, stored by Hermes under `plugins.entries.hypotaxis.settings`. Project-pinned settings (the gate command, protected paths, data policy) live in `<project>/.hermes/hypotaxis.yaml` and are trust-gated.

## 6. Models, routing and the cascade

- Every model call goes through a Hermes provider. hypotaxis adds no transport.
- A **tier ladder** is data: an ordered list of `{name, provider, model, effort, max_tokens, retries}`, per profile. A model is identified by a `ModelRef` `{provider, id}`, never by a vendor-specific constant.
- Prices come from Hermes's models.dev data, with a per-user override table. Dollars are always a projection of tokens and never stored (contraprova's rule).
- **Governed mode** (the default):
  - The session model is the orchestrator. It has `pack` (read-only, outlines) and `dispatch(brief)`.
  - `dispatch` runs the cascade **deterministically in the plugin**. Each attempt is a Hermes `delegate_task` child, routed by the plugin's delegation provider to the tier's model (ADR-0007), with the worker toolset (pack, exec, ship).
  - Children finish in the background and re-enter the orchestrator as a turn.
  - Every write goes through `ship`, so every attempt ends at the gate. A gate block restores the workspace and escalates one tier, carrying the brief, the failing output and the rejected diff.
  - The same-tier scope retry and the forks (control and treatment) follow contraprova's measured policy.
  - The orchestrator never chooses the next model itself.
- **Ungoverned mode:** one chosen model with `pack`, `exec` and `ship` directly (or Hermes's default tools, as a profile choice). `ship` still journals. The gate can be switched off, and the same ledger is written.
- **Smart** (the composer's Smart switch; the idea comes from Hermes's `smart_model_routing`) is per-message model choice, combined with the mode:

  | | Smart on | Smart off |
  |---|---|---|
  | **Governed** | Feedforward picks the starting tier for each message from the ladder, and escalation climbs from there | The user's chosen model is the starting tier; escalation climbs the ladder above it |
  | **Ungoverned** | A routing choice per message, with no gate and no escalation | Exactly the chosen model |

  Alt+M opens the model picker without turning Smart off. Choosing a model pins it and turns Smart off; choosing "Smart" turns it back on.
- **Model selection:**
  - per attempt, through the hypotaxis delegation provider;
  - pinned models through `session.mutate` (named providers only, revision-fenced).
  See ADR-0007.
- **Tool surface:** hypotaxis sessions need `tools.tool_search.enabled: "off"`, set with consent (ADR-0014).
- **Cost cap:** `pre_llm_call` blocks the call that would exceed the cap and the UI asks. Usage comes from `post_api_request`, normalised to `Usage {input_uncached, output, cache_read, cache_write, reasoning}`.
- The **capability probe** stores per-model flags (tool use, edit format, prefill, prompt-cache kind) and picks the tool surface for weak models.

## 7. Execution plane

| Tool | One call does | Writes the workspace | Runs in |
|---|---|---|---|
| `pack` | Search with surrounding lines, whole files, line ranges, single symbols, globs, git status. Output byte-capped; secrets redacted; `.env` and key files never packed | No | `hx` (ripgrep crates, tree-sitter), in process |
| `exec` | Python in a persistent asyncio kernel. `await harness.parallel([...])`; any Hermes, plugin or MCP tool as a function, each checked by the plugin's policy (`ctx.dispatch_tool` bypasses hooks, so the plugin applies policy itself); `leave_blank`, `diagnostics`, `apple.*` | No (scratch dir only) | Kernel process inside the `hx` OS sandbox; tool calls go back to the plugin over a private socket, never stdout |
| `ship` | Validate every edit before writing anything (`ABORTED_BEFORE_WRITE` with the closest match on a miss); journal; apply; gate; on pass commit to the session's hidden checkpoint ref, on fail restore byte- and metadata-exact | Yes, the only path | `hx` file transaction (capability-safe: no symlink escapes) plus the contraprova gate in the `hx` sandbox |
| `dispatch` | Governed mode only: runs a brief through the tier ladder | Through ship | Plugin |

- **Sandbox:** workspace read-only, writable scratch, network off unless allowed.
  - Linux: bubblewrap, Landlock and seccomp.
  - macOS: Seatbelt.
  - Windows (the owner's daily platform): AppContainer.
  Codex's Apache-2.0 sandbox crates are the reference.
- **Checkpoints:** every passing ship is a commit on `refs/hypotaxis/checkpoints/<session>`, so rewind to any turn comes free.

## 8. Ledger

One hash-chained JSONL per session at `<profile home>/hypotaxis/ledger/<session_id>.jsonl`, in **contraprova's exact wire format**: envelope `{seq, type, actor, ts, payload, prev_hash, hash}`, `seq` from 0, the hash taken over the canonical JSON of the whole envelope, a locked, verifying, validating and fsyncing single writer. The harness's own event types (model calls, tool calls, ship, approvals, blanks, feedforward, sessions) are added to contraprova's vocabulary upstream, so `contraprova verify|cost|report` read hypotaxis ledgers directly. A golden log shared by both repositories proves the format. Details are in `docs/LEDGER.md`.

## 9. Compatibility

- Hermes natively reads its own plugins and skills, `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, portable Agent Plugins v1 (`plugin.json` + skills + `mcp.json`), and MCP servers.
- The plugin's `compat/` package translates everything else into Hermes surfaces, at session start or on file-change events:
  - Claude Code settings hooks and plugin `hooks/hooks.json` run with Claude Code's exact payloads and exit-code rules, on the matching Hermes hooks;
  - commands become slash commands;
  - subagents become delegation definitions or teammates;
  - `.mcp.json`, Codex `config.toml`, Gemini and Cursor MCP become `mcp_servers`;
  - Cursor glob rules become a cache-safe rule index;
  - Gemini extensions;
  - marketplaces.
- Grok Bot "plugins" are MCP connectors, so MCP covers them.
- Project content is **trust-gated**: hooks, MCP servers and plugins from a repository don't run until the user trusts it.
- Spec and precedence: `docs/COMPAT.md`. Conformance fixtures run in CI.

## 10. Desktop app

- **Host** (`apps/desktop/src-tauri`, Rust):
  - Hermes lifecycle and the WS proxy;
  - typed Tauri commands and Channels (types generated with `tauri-specta`);
  - Hermes `register_secret_source` backed by the OS keychain (`keyring`), reached through plugin RPC;
  - notifications, tray, deep links (`hermes://` installs), the Tauri updater;
  - a strict CSP, a minimal capability allowlist, no `csp: null`.
- **UI** (`apps/desktop/ui`, TypeScript, Vite, no framework):
  - the approved v6 mock-up's module system and component library (`HX.ui.*`), ported to typed ES modules, with tokens, themes, keymap and accessibility kept;
  - Hermes's MIT-licensed `@hermes/shared` gateway client is reused where it fits;
  - the mock data layer is replaced by the gateway and plugin streams.
- **Hermes desktop plugins** (`desktop-plugins/<id>/plugin.js`) are a separate surface. A later phase hosts a compatible subset of `@hermes/plugin-sdk` in a sandboxed pane.

## 11. Repository layout (mirrors hermes-agent)

```
AGENTS.md                  hub: invariants + routing table to per-area AGENTS.md
docs/                      ARCHITECTURE, STANDARDS, DECISIONS, PROTOCOL, LEDGER, COMPAT
plugins/hypotaxis/         the Hermes plugin (Python): plugin.yaml, __init__.py, tools/, governance/,
                           ledger/, exec/, compat/, rpc/, feedforward/, blanks/, tests/
crates/                    hx (binary) and its libraries: hx-pack, hx-txn, hx-sandbox, hx-proto;
                           later hx-artifacts, hx-apple
apps/desktop/src-tauri/    host (Rust)
apps/desktop/ui/           UI (TypeScript)
apps/shared/               generated contract: hypotaxis-v1 OpenRPC -> TS, Rust and Python types
skills/                    bundled hypotaxis skills (agentskills.io format)
vendor/hermes-agent/       submodule pinned to a release tag (CI only)
scripts/  tests/           tooling, end-to-end tests (fake model server, live gateway)
study/                     pre-registration and run scripts (phase 2)
```

## 12. Phases

- **Phase 1 (MVP):** the Sessions section good enough to replace Claude Code for a week, covering:
  - plugin tools, the ledger and governance;
  - host plus UI, connected to a real Hermes gateway;
  - Claude Code compatibility;
  - the Claude subscription and API-key providers.
- **Phase 2:** teammates and the Bots section (profiles, cron, approvals on chat platforms), the dock widgets driven by the ledger, the study's pre-registration.
- **Phase 3:** local artifacts with the git server, the macOS VM and remote Mac, EAS, Hermes desktop-plugin hosting.

Each phase ends on a test anyone can run.
