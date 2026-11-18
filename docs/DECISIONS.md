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
- The plugin executes tool calls with `ctx.dispatch_tool` and `ctx.call_mcp`.
- The S0 spike showed `dispatch_tool` bypasses hooks, middleware and toolset gating; only Hermes's dangerous-command approval still fires. So the plugin runs **its own policy and ledger step** before every kernel-originated call, through the same function `pre_tool_call` uses:
  - one implementation, two entry points;
  - in governed mode, write-capable tools (`write_file`, `patch`, a `terminal` that writes) are denied from exec;
  - shell work inside exec runs through `hx sandbox.run`.
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

## ADR-0007 Per-attempt model selection: a hypotaxis delegation provider
**Context.** The S0 spike (`research/spike-s0.md` 4e, 4f) confirmed two mechanisms:
- `delegate_task` routed by a delegation-provider plugin: `route_task -> {provider, model}`, children in the background;
- `session.mutate {operation: "model"}`, with revision fences and named providers only.

**Decision.**
- **Governed attempts** are `delegate_task` children routed by the plugin's delegation provider (`delegation.backend: hypotaxis`). The provider ignores any tier the model asks for: it reads the task's cascade state from the ledger and returns the next tier's `ModelRef`.
- Children complete in the background and re-enter the orchestrator as a turn, which is contraprova's own orchestrator loop: the orchestrator reads the gate verdict and calls `dispatch` again or stops. The tier is always the plugin's choice.
- **Pinned models** (Smart off) and ungoverned sessions use `session.mutate` with named providers. The host and plugin never use the bare `custom` provider.
- Every provider hypotaxis configures is a named entry under `providers:`.

**Amendment (after implementation, 2026-11-18).** Escalation happens in the plugin, not through the orchestrator:
- On a worker's `subagent_stop`, the plugin reads the gate verdict from the ledger and launches the next tier itself (`delegate_task`, routed by the delegation provider).
- A blocked attempt's completion is vetoed in `pre_llm_call`, so it costs no model call. The orchestrator is told the final outcome once.
- The orchestrator re-calling `dispatch` was dropped, because escalation must not depend on a model remembering to do it.
- This needs `plugins.isolation: in_process` (Hermes's default); host isolation can't bind the orchestrator's agent from the hook.
- `delegate_task` has no per-task toolsets, so the role policy is the guarantee that workers can't dispatch and orchestrators can't ship.
- A tier's `max_tokens` is recorded but not applied (Hermes's delegation route has no such key).

**Consequences.**
- Escalation works in plain Hermes too, with no model in the loop.
- Interim attempts cost no orchestrator turn.
- The tier ladder and the provider entries must stay in sync. The plugin writes both from one ladder definition.

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

## ADR-0014 Direct tool surface: tool_search off in hypotaxis sessions
**Context.**
- Hermes defers every plugin and MCP tool behind three `tool_search` bridge tools unless `tools.tool_search.enabled: "off"` (`tools/tool_search.py`).
- No plugin flag exempts a toolset.
- Governed and ungoverned sessions must show `pack`, `exec`, `ship` (and `dispatch`) directly.

**Decision.**
- At setup, with the user's consent, hypotaxis sets `tools.tool_search.enabled: "off"` in the profile it uses, and explains the effect: other clients of that profile see plugin and MCP tools eagerly too.
- If the user declines, hypotaxis offers a dedicated profile (ADR-0006's alternative).
- We open an upstream Hermes pull request for a per-toolset "direct surface" declaration (manifest or `register_tool` flag). Once it ships, the global switch is dropped.

## ADR-0015 contraprova is vendored by exact copy
**Context.**
- The plugin needs contraprova's kernel modules.
- Contraprova isn't on PyPI.
- Hermes admits plugin dependencies only through its package manager, which may not accept git URLs.

**Decision.**
- `plugins/hypotaxis/_vendor/contraprova/` holds an **exact copy** of contraprova's engine modules at a pinned commit, written by `scripts/vendor-contraprova.sh <sha>`, with the commit SHA and licence recorded in `_vendor/contraprova/VENDOR.json`.
- CI re-fetches that commit and fails if the copy differs by a single byte.
- Changes are made upstream and re-vendored, never edited in place.

**Consequences.** No fork can drift. The plugin installs with no external Python dependency.

## ADR-0016 Shared data files are copied, never re-typed
**Decision.**
- `errors.json` (from `crates/hx-proto`), `redact.rules.json` and `never_pack.json` (from `crates/hx-pack`) and `protected.default.json` (from `crates/hx-txn`) have one source of truth each.
- `scripts/sync-shared-data.sh` copies them into the plugin package, so the plugin installs standalone.
- CI fails if a copy differs from its source.
- Codes the plugin owns (`hx.config.*`, `hx.policy.*`, `hx.mode.*`, `hx.ledger.*`, `hx.budget.*`) are added to `crates/hx-proto/errors.json`, not kept in a second catalogue.
- **Exception:** the redaction rules are not copied. Hermes's plugin-install security scan rejects a file of secret-matching patterns, so the plugin redacts by calling `hx` (method `redact.apply`). The rules keep a single implementation, in Rust.

## ADR-0017 Sandbox mechanisms per OS
**Context.** ARCHITECTURE section 7 named bubblewrap, Landlock and seccomp for Linux, Seatbelt for macOS and AppContainer for Windows. The `hx-sandbox` work settled the details.

**Decision.**
- **Linux:** Landlock (ABI 3 or later, probed at runtime) for the filesystem, seccomp for network syscalls and a syscall deny-list, and a private network namespace for loopback-only. Every child also gets `setsid` plus `killpg`, a PID namespace when user namespaces allow it, `no_new_privs`, dropped capabilities and rlimits. There's no bubblewrap and no setuid helper.
- **macOS:** a Seatbelt profile run through `sandbox-exec`, with paths passed as parameters, ported from Codex (Apache-2.0, notice kept).
- **Windows:** a per-run AppContainer with filesystem ACLs and capability SIDs for the network, plus a kill-on-close job object with limits. This beats Codex's dedicated-user design for us: no elevated setup, and reads are actually blocked.
- **Fail closed everywhere:** a dimension the platform can't enforce returns `hx.sandbox.unavailable` unless the policy explicitly accepts degraded enforcement, and every run reports what was enforced. A host allowlist the OS can't enforce falls back to network off. A real allowlist comes later through a host-side proxy.

**Consequences.** Linux is verified with real processes in CI. macOS and Windows compile in CI and are verified on real machines before release (`crates/hx-sandbox/tests/{macos,windows}.rs`).

## ADR-0018 Homes and vaults: multi-device and user-owned cloud
**Context.** The owner wants sessions on any device (desktop, a phone app, other machines), stored in infrastructure they choose: Google Drive, OneDrive, S3, R2, B2, WebDAV, SFTP, a hosted server, a local server or a drive.

**Decision.** Two separate concepts.
- **A home** is where the work runs: Hermes, the plugin, `hx` and the workspace. Only a machine that can run programs can be a home: the desktop (default), a home server, a VPS, a cloud VM.
  - Every device attaches to the home over `hermes-gateway-v1`, which Hermes's own desktop already does for remote backends (SSH, URL plus token).
  - Transports: SSH, a tailnet (Tailscale or WireGuard), a Cloudflare Tunnel, or TLS with per-device tokens, which are revocable and kept in the OS keychain.
  - There is exactly one live home per Hermes home directory (Hermes's rule).
- **A vault** is where the data rests: any storage the user picks, reached through **Apache OpenDAL** (Rust, Apache-2.0), which covers S3-compatible stores, Google Drive, OneDrive, WebDAV, SFTP and the local filesystem.
  - Data is encrypted on the device before upload, with the key in the OS keychain.
  - The vault holds **snapshots, not live files**: Hermes state through `hermes backup`; ledgers, which are append-only and hash-verified so they sync safely; artifacts and settings.
  - A lease file in the vault names the live home, so a second machine can take over only after the lease is released or expires. That makes a "travelling home" possible.
- **Clients:**
  - the desktop app;
  - a phone app from the same UI through Tauri v2 mobile (Android directly; iOS through the macOS VM path or a rented Mac);
  - a web client served by the home.
  Hermes's chat platforms already reach phones meanwhile.

**Seams built now (phase 1):**
- The host's gateway connection is an endpoint abstraction, `Local` (ensure/attach) or `Remote` (URL plus token, SSH, tailnet), behind one interface.
- The UI never assumes it runs on the home's machine: paths are home-relative, and file pickers and opening files go through the home.
- Everything hypotaxis persists (ledgers, artifacts, the price cache, settings) goes through one storage interface, so a vault can mirror it.

**Phases.** Remote homes and vault backup and restore are phase 2. The phone app is phase 3.

## ADR-0019 Cloud sessions run the whole stack in a sandbox you own
**Context.**
- The owner wants a "cloud session" option beside local sessions, like Claude Code's: it keeps running with the laptop closed, opens from any device, and can't touch the computer unless allowed.
- Research (`research/cloud.md`) compared two options:
  - (a) the whole Hermes gateway, plugin and `hx` in an ephemeral sandbox;
  - (b) Hermes's terminal environments, which only move tool execution, so the session dies when the laptop does.

**Decision.**
- Build (a), as specified in `docs/CLOUD.md`:
  - the cloud image (official Hermes image + plugin + `hx`);
  - a self-hosted control plane `hx-cloud` (environments, sessions, device sign-in, relay, queue, secrets);
  - runners behind a sandbox-provider interface, Docker first;
  - an egress proxy that injects credentials so no key lives in the sandbox;
  - a git proxy limited to the session's branch prefix;
  - the session store on the user's vault (ADR-0018).
- Handoff between local and cloud forks; it never shares a live session.
- Remote Control lets a cloud session use an approved folder on the user's computer through the desktop host.
- (b) stays available as a Hermes setting ("remote tools"), not as a cloud session.
- This refines ADR-0018: a cloud session is an ephemeral home; a persistent remote home is a cloud environment with no idle timeout.

**Consequences.**
- Phase 1 builds only the seams: the `Cloud` endpoint kind, headless-safe plugin and `hx`, checkpoint pushes, one storage interface.
- The control plane is the one internet-facing component the user runs, so it gets the strictest review.

## ADR-0020 Forms: one schema-driven card for every request to the user
**Context.** The owner's rule: usability first. Nobody should leave the app to set up keys or settings when the agent or a teammate could send a form. Claude Code shows how: a credential card that saves and wires the key without the model seeing it, multiple-choice questions, permission prompts, plan approval, environment-change approvals, trust prompts, sign-in. Hermes has its own interactive requests (clarify, approval, secret, sudo, vault), and MCP has elicitation.

**Decision.**
- One form primitive (`docs/FORMS.md`): MCP elicitation's schema plus hypotaxis extensions (secret, multi-select, other, previews, pickers, upload, sign-in, hold-to-approve), drawn by one renderer in the card family.
- `kind` templates decide where the result goes: credential, question, approval, permission, signin, setup, connector, choice, plan, feedback.
- Hermes's requests and MCP elicitations are adapted onto it. Agents and teammates send forms through `request_input`.
- Secret values go from the UI to the host and on to the keychain or control plane, never to the agent, the transcript, the ledger or logs.

**Consequences.**
- New needs become a new `kind` (a template plus an effect), never a new component.
- The owner designs the visual family as an extension of the approved cards.

## ADR-0012 Prices
Prices come from the models.dev catalogue plus a user override table. Hermes's models.dev data is not reachable through its public plugin API, so:
- the plugin reads a cached catalogue file, `<profile home>/hypotaxis/prices/models-dev.json`;
- the host refreshes that file daily;
- in plain Hermes, the plugin can fetch it itself through RPC `prices.refresh` (one HTTPS GET to models.dev, on by default, switchable off in settings).

An unpriced model shows unknown cost, never zero. A session with a cost cap blocks on unknown cost. Rates are absolute per bucket (input, output, cache read, cache write, reasoning), never vendor multipliers. Dollars are always computed from tokens and never stored. A subscription provider prices at zero, with an API-equivalent projection shown beside it.
