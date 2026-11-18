# Architecture decisions

Each record has a context, the decision, and its consequences. A superseded record stays and points to its replacement.
Evidence for 0001–0010: `research/hermes.md` (Hermes v0.23.2 read from source), `research/audit.md` (first-pass code), `research/contraprova.md`, `research/formats.md`. These are kept with the W0 spec notes.

## ADR-0001 Hermes's organisational model
**Context.** The owner's constraints:
- Hermes updates must flow in;
- every Hermes plugin, skill and custom code must work unchanged;
- the harness should be organised the way Hermes is.

Hermes's rules are "the core is a narrow waist; capability lives at the edges". Its desktop app splits into machine, experience and work authorities, and its wire is generated from OpenRPC.

**Decision.**
- Adopt all three: edges only, three authorities (host, UI, Hermes backend with our plugin), generated contracts.
- Mirror Hermes's repository shape: AGENTS.md hub, per-area AGENTS.md, `plugins/`, `apps/desktop`, `apps/shared`, `skills/`.

**Consequences.** Hermes is never patched. Anything hypotaxis adds must be expressible as a Hermes plugin, a skill, an MCP server or host-side code.

## ADR-0002 No Rust model gateway
**Context.**
- The plan put a Rust gateway with per-provider adapters between Hermes and every model.
- Hermes already ships about 40 provider plugins, prompt caching, models.dev data and the Claude subscription relay (`claude-subscription-directsdk`, official).
- Hermes can use a single endpoint as its only provider by config alone.

**Decision.**
- Model traffic goes through Hermes providers.
- Routing, cost caps and usage accounting live in the hypotaxis plugin, through `post_api_request`, `pre_llm_call` and per-session or per-subagent model selection.

**Consequences.**
- One layer per mechanism.
- We inherit Hermes's provider coverage and fixes.
- Provider-specific features (thinking, tool formats) are whatever Hermes supports.
- Gaps get fixed upstream as pull requests, never in a fork.

## ADR-0003 Governance is a Hermes plugin built on contraprova's Python
**Context.**
- Contraprova (stdlib-only Python) is the measured system.
- The first-pass Rust "kernel" is wire-incompatible, with invented router and lane semantics and no state machine.
- The owner requires the generic harness to keep contraprova's behaviour.

**Decision.**
- The hypotaxis plugin imports contraprova's kernel modules (events, log, projections, contracts, gates, forks, pricing) as a pinned dependency.
- Generalising them is done upstream in contraprova: neutral `ModelRef`/`Usage`/`PriceTable`/`TierLadder`, the extra event types, a portable file lock for Windows.

**Consequences.**
- One implementation of the policy.
- Contraprova's own tools read hypotaxis ledgers.
- The Rust kernel crate is deleted.
- Contraprova gets a small, reviewed set of upstream changes, which need the owner's approval to push.

## ADR-0004 `hx`: one Rust binary for the parts Rust earns
**Context.** Three parts need Rust:
- ship's file transaction must be capability-safe (the first pass had a confirmed symlink escape and lost file modes);
- pack wants ripgrep's crates and tree-sitter;
- OS sandboxing needs native APIs, including AppContainer on Windows.

**Decision.**
- A single binary `hx`, built from library crates `hx-proto`, `hx-pack`, `hx-txn` and `hx-sandbox`.
- It speaks JSON-RPC 2.0 over stdio, and the plugin keeps one warm `hx serve` child per Hermes process.
- The app bundles it, and it installs standalone for plain-Hermes users.
- Reused from the first pass: ship's edit matching and its tests, pack's walker and secret patterns.

**Consequences.**
- Plugin logic stays in Python, next to Hermes. Heavy and unsafe work stays in Rust.
- One process boundary, with a schema.

## ADR-0005 Our own exec kernel
**Context.**
- Hermes's `execute_code` kernel is persistent but synchronous.
- It can call only 7 whitelisted tools.
- It loses state on timeout.

**Decision.**
- An asyncio Python kernel, started inside the `hx` sandbox, talks to the plugin over a private socket, never stdout.
- The plugin executes tool calls with `ctx.dispatch_tool` and `ctx.call_mcp`, so they pass Hermes's approvals, redaction and budgets.
- An interrupt cancels the running cell without killing the kernel. A hard timeout kills it and says so.

**Consequences.**
- `harness.parallel`, tools as functions, `leave_blank`, `diagnostics` and `apple.*` are all possible.
- Every plugin tool is callable from code.

## ADR-0006 Attach to the user's active Hermes profile by default
**Context.**
- "Every Hermes plugin should work" means the user's existing profile, with its plugins, skills, memory and MCP servers.
- Hermes's gateway multiplexes clients per home, as Hermes Desktop does.

**Decision.**
- Attach to the active profile by default.
- Install the hypotaxis plugin there.
- Keep hypotaxis state under `<home>/hypotaxis/`.
- A setting switches to a dedicated profile.
- Teammates are separate profiles.

**Consequences.**
- hypotaxis sessions are visible in the Hermes CLI and TUI.
- Our tools are scoped by `session.create {toolsets}`, so other clients' sessions are unaffected unless they opt in.

## ADR-0007 Per-attempt model selection (pending the S0 spike)
**Context.** The cascade runs each attempt on a tier's model. There are two candidates:
- **(a)** `delegate_task` subagents with a per-task model route;
- **(b)** a session-scoped model switch between attempts.

**Decision.** (a) if the spike confirms subagents can run on another provider and model; otherwise (b). This record is updated with the spike's evidence.

## ADR-0008 Ledger format is contraprova's
**Decision.**
- The envelope `{seq, type, actor, ts, payload, prev_hash, hash}`, `seq` from 0, a SHA-256 over the canonical JSON of the whole envelope, and a locked, verifying, validating, fsyncing single writer.
- Harness event types are added to contraprova's vocabulary (`docs/LEDGER.md`).
- Verification on append is incremental (tail hash plus a periodic full verify), to meet the 5 ms budget.
- A golden log is shared by both repositories.

## ADR-0009 UI is the v6 design system, ported to TypeScript
**Context.**
- The owner approved the v6 mock-up: a vanilla module system and component library, keyboard-first, accessible, themeable.
- The first-pass React UI implements a design the owner rejected.

**Decision.**
- Port v6's modules and `HX.ui.*` library to typed ES modules with Vite and no framework. Delete the React UI.
- Keep `orbMath`/`LivingOrb` only if the orb2 web component does not cover them (it does today).
- Reuse `@hermes/shared`'s gateway client (MIT) behind a Tauri-IPC transport.

**Consequences.** No redesign and no re-implementation of approved behaviour. The mock data layer is replaced by live streams.

## ADR-0010 What survives from the first pass
**Keep, then fix:**
- ship's edit matching, journal skeleton and tests (move into `hx-txn`);
- pack's walker and secret regexes (into `hx-pack`);
- the `claude -p` stream-json parser (only if `claude-subscription-directsdk` doesn't cover it);
- the `remote_ssh` command builders and local-artifacts input validation (phase 3);
- `scripts/setup-hooks.*`.

**Delete:**
- every fabricated output: seeded ledger events, the 97.9% cache figure, "14/14 passed", simulated Xcode success;
- `cache_stabilizer`, `discovery`, the Rust kernel, the compat loader, the React UI and its mock IPC;
- the README's borrowed claims.

## ADR-0011 Hermes desktop plugins come later
Hermes desktop plugins (`plugin.js` against `@hermes/plugin-sdk`) are React and Electron-specific. Phase 3 hosts a compatible subset of the SDK in a sandboxed pane. Until then, the Python halves of unified Hermes plugins work and their desktop halves are listed but not loaded.

## ADR-0013 Claude Code hook commands run as shell strings
**Context.** STANDARDS section 5 forbids building shell strings. Claude Code hook commands *are* shell strings, and compatibility requires running them unchanged.

**Decision.** Translated hook commands from Claude Code settings and plugins run through the platform shell (`sh -c`, `cmd /c`). Conditions:
- only after the user trusts the project or plugin (content-hash pinned);
- with an allowlisted environment plus Claude Code's documented variables;
- with the hook's timeout, clamped to Hermes's callback limit;
- with an output cap;
- with the project root as cwd.

They're not sandboxed, matching Claude Code. This is the only exception to the no-shell-string rule.

## ADR-0012 Prices
Prices come from Hermes's models.dev data, with a user override table. Rates are absolute per bucket (input, output, cache read, cache write, reasoning), never vendor multipliers. Dollars are always computed from tokens and never stored. A subscription provider prices at zero, with an API-equivalent projection shown beside it.
