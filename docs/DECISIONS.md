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
- The user's `Bash` deny and ask rules judge `harness.sh` by the command string the kernel reports, and the kernel runs its own argv: they do not bind exec (a cell can use `subprocess` or `open()` with no `harness.sh` call). The sandbox is the boundary; the rules are an audit trail (security review, 2026-11-19). Network tools called through `tool.call` are refused unless `exec.network` is `on`.

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

**Addendum (security review, 2026-11-19).** The tools a hook runs load project files outside the hash (`package.json` scripts, lint and format configs, a `Makefile`, `conftest.py`), and the agent writes the workspace through `ship`. So a ship that touches such a file, or a hook's own script, switches the project's trusted hooks off and asks the user again (`compat/rearm.py`); the list of files is data and a heuristic. Sandboxing hooks like the gate was considered and rejected: formatters must write the workspace and notifiers reach the network, which are the Claude Code behaviours this ADR exists to keep.

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

## ADR-0021 Automation: reuse Hermes's drivers, one capability and grant model for every tool
**Context.**
- The owner wants agents, on any model, to operate other programs and browsers (not only Chrome), and wants one way to give them permission across many tools.
- Research (`research/automation.md`) found the following.
  - Hermes already ships the drivers:
    - `browser_exec`: Chromium over CDP, model-written Python;
    - `browser_vault`;
    - a real-profile copy;
    - `computer_use` on cua-driver: the accessibility tree plus screenshots, for any tool-calling model;
    - camofox.
  - Its approvals leave three gaps:
    - no approval or per-site grant for `browser_exec`;
    - `computer_use` grants keyed by action, not by app;
    - MCP trust is binary.
  - Firefox has no CDP, so Hermes can't drive it. Claudezilla and Mozilla's BiDi server can.
  - Claude in Chrome needs an Anthropic plan, so it isn't model-agnostic.

**Decision.**
- Build no drivers. Reuse Hermes's first, then add MCP servers where Hermes has none: Chrome DevTools MCP for the live Chrome, Claudezilla and firefox-devtools-mcp for Firefox. Build only the policy, cards, ledger records and revocation (`docs/AUTOMATION.md`).
- **One vocabulary of capabilities** for every tool, mapped from tool names by a data file:
  - `web.read`, `web.act`, `web.script`, `web.identity`;
  - `desktop.observe`, `desktop.act`, `desktop.display`;
  - `app.<server>`, `fs.*`, `secret.use`, `net.egress`.
- **Grants:**
  - each grant has a subject (an origin, an app, a folder, a server and tool) and a scope (once, turn, session, always), with expiry;
  - grants only narrow down the layers;
  - a project can't grant reach;
  - each teammate has its own grant set and browser identity.
- They're enforced by the one permission function, `hypotaxis.policy.check`, which both the `pre_tool_call` hook and the exec kernel call.
- **Protected action classes** always ask, whatever the grants say: spend, send as the user, irreversible delete, credentials, download and run, upload, authorise, account creation, identity upgrade, script injection.
- **A short never-allowed list:**
  - CAPTCHA bypass;
  - input to OS security prompts;
  - Hermes's hard-blocked key combinations;
  - cloud metadata addresses.
- Content from pages and screenshots can never create or widen a grant. A taint rule escalates the outbound classes after untrusted content arrives.
- Permissions reach the user as forms (ADR-0020): `permission`, `approval`, and `signin` as a takeover under Hermes's control lease.

**Consequences.**
- A1 (capability map, grant store, policy step, cards, ledger, revocation) covers every tool at once. The per-driver work after it is thin.
- `grant.decided` and `grant.revoked` go upstream into contraprova with `form.*`. Until then, they're written as `tool.called`.
- Four spikes come first: one card instead of two for `computer_use`; native-Wayland capture on Arch; an agent-owned display; DevTools MCP annotations.

## ADR-0022 Claude Code mods run unchanged in a sandboxed runtime and draw through the design system
**Context.**
- The owner wants Claude Code mods to work in hypotaxis, compatible and looking right.
- A mod is a plugin whose JavaScript or TypeScript module hooks Claude Code's events, calls a `$` API, and draws element trees into panes, a band above the prompt, toasts, a status line, transcript rows, a backdrop and Claude Code's own message views (`research/mods.md`).
- Mods run inside Claude Code, unsandboxed, and no public spec covers running them anywhere else.

**Decision.**
- Implement the mods API from the docs (`docs/MODS.md`), as a new `hx-mods` library in the `hx` binary:
  - an embedded JavaScript engine and a TypeScript/JSX transform, chosen by a spike;
  - one isolate per session, inside `hx-sandbox`, whose only way out is `$`.
- The plugin maps Hermes's hooks and the gateway's events onto mod events, through the same bridge as Claude Code's hooks. Every `$` call is decided by `hypotaxis.policy.check`, with the mod as principal.
- Element trees travel to the UI as data, and one component draws them with the v6 library. Theme keys and colour names map onto semantic tokens, and each mod surface maps onto an app surface.
- Report `surface: 'desktop'`. Headless sessions run hooks and draw nothing, as `claude -p` does.

**Consequences.**
- Compatible but stricter than Claude Code: `$.fs`, `$.http`, `$.process`, `$.mcp` and `$.model` calls can ask, through forms, where Claude Code would let them through.
- New surfaces (the band above the composer, mod panes, the mod status line, placed rows, the mod origin) need the owner's design in v6 first.
- A conformance suite against pinned public mods tracks support per Claude Code version.

**Update 2026-11-19, spike M0.** The engine is QuickJS-NG through `rquickjs`, and the transform is `oxc`. Boa has no wall-clock interrupt or heap limit; V8's prebuilt library alone is about 40 MB against a 4.35 MiB delta here. Isolate start plus three mods took 2.7 ms (budget 50 ms), an event 7 to 48 microseconds (budget 1 ms). Evidence, deviations from the docs and the risks for M1 (a shared realm, an in-process isolate, synchronous host calls): `docs/MODS.md` section 8.

## ADR-0023 One self-contained app: Hermes ships inside it
**Context.**
- The first build asked the user to install Hermes with a terminal command before running the app.
- The owner: it must ship as a single app with its own installer. Building on Hermes stays (ADR-0001): its plugins work and its updates flow in.
- Hermes is MIT-licensed, so bundling it is allowed with its notice.

**Decision.**
- Each installer carries:
  - a pinned, unmodified Hermes;
  - a private, relocatable Python runtime;
  - `hx`;
  - the plugin.
- On first run the host unpacks the runtime, checking its hash, into the app's data folder, with a private `HERMES_HOME`. No terminal, no separate install, and no contact with any other Hermes on the machine.
- One updater ships the app and the runtime together, and a Hermes release reaches users only after CI passes on it. Hermes's self-update is off inside the bundle.
- Large optional pieces (Chromium for automation, the desktop-control driver, Node) are downloaded on first use, with consent, into the private home, through Hermes's own package manager.
- Pointing the app at an existing Hermes stays as an advanced setting.

**Consequences.**
- The release pipeline builds the runtime per platform, and the end-to-end tests run against that same artifact, so CI tests what ships.
- Installer size grows by the runtime's size, so its footprint is measured and kept lean.
- Signed updates need an update-signing key, which the owner creates and stores as a CI secret. It never goes in the repository.
- ARCHITECTURE §4 is amended: the earlier plan had the host run Hermes's installer on the user's machine.

**Amendment (what was built).**
- The runtime is Hermes's own sealed payload (the layout its desktop app and Docker image use), made by calling its build functions (`scripts/bundles/native.py`, `scripts/build/agent.py`), not by a script of ours that copies their results: `tools/` holds python-build-standalone and uv at the pins in `pm/lock.json`, `pm-runtime/` the package manager's own environment, `venv/` the locked dependencies, `manifest.json` the layout. A first version without `pm-runtime` could not enable the plugin.
- Why Hermes's layout: every path is found relative to the payload, so the directory works unpacked anywhere (proved by `scripts/verify-runtime.sh`), and a sealed payload's package manager puts what it downloads on first use in `<HERMES_HOME>/tools`, not in the replaceable runtime folder.
- Hermes's self-update is off by two of its own mechanisms: the install stamp (`distribution: desktop-app`, `updateMechanism: external`, written by Hermes's `write_install_stamp.py`) makes `hermes update` refuse, and `updates.check: false` in the private home's config (key read in `hermes_cli/source_check.py` and `update_cmd.py`) stops the passive check.
- Two crates join the host: `tar` and `zstd` (MIT or Apache-2.0; `zstd-sys` builds the BSD-licensed C library), to unpack the archive in the host without a system `tar` or `zstd` (Windows has neither).
- The host keeps the choice of Hermes in one pure function: the bundled runtime unless `HYPOTAXIS_HERMES=existing` (or `hermes_source` in `settings.json`) says otherwise; a build without a runtime uses the Hermes on the machine, and a broken `runtime.json` is a setup error.

## ADR-0024 The host picks WebKitGTK's renderer from evidence, never blanket
**Context.**
- Tauri draws with WebKitGTK on Linux. Its renderer is chosen by environment switches read when the web view is created: `WEBKIT_DISABLE_DMABUF_RENDERER` (shared-memory buffers instead of DMABUF), `WEBKIT_DISABLE_COMPOSITING_MODE` (no accelerated compositing), `__NV_DISABLE_EXPLICIT_SYNC` (NVIDIA on Wayland).
- They cure a blank window or a crash on some NVIDIA setups (WebKit bugs 259644, 261874; Tauri's Linux graphics guide). They cost frames wherever the default works, and Tauri's own guide says not to ship them unconditionally.
- They are not equivalent. Checked on WebKitGTK 2.52.6 with `webkit://gpu`: `WEBKIT_DISABLE_DMABUF_RENDERER=1` makes the acceleration policy `never` (no GL context, the CPU paints every frame), while `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` keeps policy `always` and GL compositing and copies frames through shared memory. Ubuntu ships a patch that forces that shared-memory transport for NVIDIA (2.52.6-0ubuntu0.24.04.2).
- The owner's laptop is a hybrid NVIDIA machine on Hyprland (Wayland, scale 1.6) and runs with `WEBKIT_DISABLE_DMABUF_RENDERER=1` from the start: so it paints on the CPU at 3600x2250 buffer pixels. The frame drops measured there (see `apps/desktop/ui/tests/perf`) are largely the page's work in that path.

**Decision.**
- `renderer.rs` probes the GPUs (`/sys/class/drm`: vendor, bound driver, boot display), the session type and the compositor, and decides before any thread starts. It is a pure table, unit-tested.
- Automatic rule: only the NVIDIA proprietary driver as the display GPU (or as the GPU the app renders on, ADR-0025) on X11 gets `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` (the GPU stays). A hybrid machine whose display is the integrated GPU, any other vendor, and any Wayland session are left to WebKitGTK. On Wayland with NVIDIA the rule takes the runtime WebKitGTK version into account: from 2.54.2 (the GTK 3 explicit-sync fix, WebKit bug 324551) the machine gets the default GL renderer and the rule says so (`nvidia_wayland_fixed`); before that, or when the version cannot be read, the rule is the one above (`nvidia_wayland_untouched`). Both set nothing; the version changes the reason in the log and the report, and the report's note names a CPU-painting switch that is set in the environment.
- The version is read from `libwebkit2gtk` at run time (`webkit_get_major_version` and its siblings, through `dlsym`), not from what the build linked: the AppImage carries its own copy.
- `HYPOTAXIS_RENDERER=auto|default|shm|cpu|nosync|software` is the owner's explicit choice (`shm` is `FORCE_SHM`, `cpu` is `DISABLE_DMABUF_RENDERER`). A WebKit or NVIDIA switch already in the environment wins over everything.
- The decision is logged at startup. Settings > General > Diagnostics copies a report (session, GPUs and drivers, rule, environment, the page's size and `devicePixelRatio`) and opens WebKitGTK's `webkit://gpu` page in its own window, with no access to the host's commands.
- `set_var` is an `unsafe` call (`#[allow(unsafe_code)]` with its SAFETY note): it runs first in `run()`, before the logger, tokio or Tauri start a thread. ADR-0025 adds the same call for the GPU rule and one `dlsym` block.

**Consequences.**
- No machine pays for a workaround it does not need. A machine that does need one sets a variable and sends the report.
- Wayland plus NVIDIA is not auto-fixed: the evidence is crashes and blank windows, which the host cannot see in advance. The diagnostics and the variable make the fix one step.
- Distribution patches differ (Ubuntu forces the shared-memory transport for NVIDIA in 2.52.6; Arch's package is not known to), so the report, not an assumption, says what a machine does.

## ADR-0025 Motion at the display's refresh rate: compositor-driven, WebKit's 60 fps cap lifted, current WebKitGTK
**Context.**
- The owner's panel runs at 120 Hz and they want 120 fps with no stutter. The research (`research/120hz.md`, read in WebKitGTK's source) found three limits.
  - **WebKit's 60 fps preference:** WebKit caps `requestAnimationFrame` and page rendering updates to 60 fps on fast displays by default (`PreferPageRenderingUpdatesNear60FPS`). It can be turned off from the host (`webkit_settings_set_feature_enabled`).
  - **The renderer:** only the GL renderers (DMA-BUF, or shared memory) run `transform` and `opacity` animations on the compositor thread. The CPU renderer the owner was forced into paints every frame on the main thread.
  - **The WebKitGTK version:** the GTK3 explicit-sync crash with NVIDIA on Wayland is fixed in WebKitGTK 2.54.2 and later, and CSS `linear()` easing only stops forcing main-thread animation in 2.54.
- GTK3 on Wayland renders a 1.6 scale at 2x (3600x2250 here). Tauri has no GTK4 port, and Tauri's Chromium runtime is a Tauri 3 alpha that runs under XWayland.

**Decision.**
- **Lift the cap:** the host turns WebKit's 60 fps preference off on displays faster than 60 Hz, with a setting to force 60.
- **Renderer rule:** the renderer rule (ADR-0024) takes the WebKitGTK version into account. On 2.54.2 and later, Wayland with NVIDIA gets the default GL renderer, not a workaround.
- **Motion:**
  - motion runs on the compositor: `transform` and `opacity` only, springs as `linear()` curves or Web Animations;
  - the orbs draw in an OffscreenCanvas worker where the engine supports it;
  - STANDARDS §6 makes the display's full rate the budget, with 60 fps as the floor only where the machine forces it.
- **Packaging:** ship on a current WebKitGTK.
  - Arch gets a native package that uses the system's WebKitGTK (2.54.2 or later).
  - The AppImage's bundled WebKitGTK version is reported in Diagnostics and raised as builds allow.
- **Frame rate setting:** `HYPOTAXIS_FPS=auto|60|max`. `auto` (the default) turns the preference off when GDK reports a refresh rate above 60 Hz for the window's monitor, `60` keeps WebKit's default, `max` always turns it off. The cap is only ever lifted. The preference is reached through `webkit_settings_set_feature_enabled`, resolved with `dlsym` and called only after the runtime version (2.42 or later), the symbols and the feature's existence are checked; the host reads the value back and Diagnostics reports it.
- **GPU rule:** `HYPOTAXIS_GPU=auto|integrated|dedicated`, also in Settings > General (saved, applied at the next start; `HYPOTAXIS_GPU` overrides it). `dedicated` is PRIME render offload to the NVIDIA GPU: the environment that switcheroo-control advertises for the discrete GPU (`net.hadess.SwitcherooControl`, read with `busctl` in a child process so no thread starts before the environment is set), else NVIDIA's documented `__NV_PRIME_RENDER_OFFLOAD=1`, `__GLX_VENDOR_LIBRARY_NAME=nvidia`, `__VK_LAYER_NV_optimus=NVIDIA_only`. Only GPU-selection variables are taken from the service. The host sets no EGL vendor file and no `WEBKIT_WEB_RENDER_DEVICE_FILE`: WebKit takes the DRM render node from its EGL display, and NVIDIA documents `__NV_PRIME_RENDER_OFFLOAD=1` as enough for an EGL client. A GPU-selecting variable already in the environment wins, and then the host sets none.
  - `auto` offloads only on AC power (a `Mains` supply online in `/sys/class/power_supply`), with a separate NVIDIA GPU whose proprietary driver is bound, a runtime WebKitGTK of 2.54.2 or later and a known session type. On battery, with an unknown power source, with an older or unreadable WebKitGTK, or with no such GPU it uses the integrated GPU (it sets nothing).
  - `dedicated` is allowed on an older WebKitGTK and warns in Diagnostics that it may crash or stay blank on Wayland. It supports the NVIDIA proprietary driver only.
  - The GPU is fixed when the process starts. If the power source changes, Diagnostics and Settings offer "Restart to switch"; the app never switches silently.
  - When offload is on, the renderer rules (ADR-0024) judge the NVIDIA GPU, not the display one.
  - Diagnostics reports the GL renderer the page really gets (WebGL's unmasked renderer string, which goes through the web process' EGL display), the power source, and what was requested.
  - `docs/research/120hz.md` section 4.3 advises against forcing offload as a fix for blank windows (a cross-GPU copy, the dGPU awake for a light UI, NVIDIA's EGL path). This rule is the owner's choice for a demanding app, and `auto` is gated on the fix for that path.
- **Not now:** Chromium (Tauri 3 alpha with CEF). Revisit when it reaches beta with native Wayland.

**Consequences.**
- The perf harness measures at the owner's geometry, and its numbers gate motion changes.
- A machine stuck on the CPU renderer or WebKit's fixed 60 Hz timer gets a smooth 60, said plainly in Diagnostics, never a stutter at an unreachable 120.

## ADR-0026 The terminal art is data, with one renderer per language that cannot link the others
**Context.**
- boopis has three terminal faces: the installers (`install.sh` for Linux and macOS, `install.ps1` for Windows), the app's own binary (`boopis --version`, `boopis doctor`) and the Arch package's install script. All three show the logo and the bots.
- The installers run from a pipe, so they are one file each and cannot read the repository. The host is Rust. A shell, PowerShell and Rust cannot share code.

**Decision.**
- **The art exists once, as data:** `packaging/brand/boopis.art` (pixel grids, palette, scenes, animation frames), a line-based text format. The wordmark's pixels are the real logo's outlines sampled on the terminal's pixel grid (a cell is 2x2 pixels, drawn with the quadrant blocks); the bots' colours are `design/v6/data.js`'s.
- **One renderer per language, kept equal by golden files:** the host's (`brand.rs`) is the reference, `render.awk` is what `install.sh` carries, `render.ps1` what `install.ps1` carries. `packaging/brand/golden/` holds what the host draws for every colour level; `scripts/test-brand.sh` checks that awk draws the same bytes. The PowerShell renderer follows the awk one line by line and has no golden test yet (it needs a Windows or PowerShell runner).
- **The installers embed the art** between `>>> brand` markers, written by `scripts/embed-brand.sh` and checked by `--check`, the same pattern as the repository's other generators.
- **Capabilities are read, never assumed:** `NO_COLOR`, `TERM=dumb`, a pipe, `COLORTERM`, `TERM`, the locale, `CI` and `BOOPIS_NO_ANIMATION`, in the same order in all three.

**Consequences.**
- Changing the art is one file and `scripts/embed-brand.sh`. Changing the renderer's rules is three edits and the goldens.
- Alternatives refused: pre-rendered ANSI in the scripts (four colour levels times every frame: large and unreadable); a second art copy per language (drifts); downloading the art at install time (the installer would depend on the repository being reachable and public).

## ADR-0012 Prices
Prices come from the models.dev catalogue plus a user override table. Hermes's models.dev data is not reachable through its public plugin API, so:
- the plugin reads a cached catalogue file, `<profile home>/hypotaxis/prices/models-dev.json`;
- the host refreshes that file daily;
- in plain Hermes, the plugin can fetch it itself through RPC `prices.refresh` (one HTTPS GET to models.dev, on by default, switchable off in settings).

An unpriced model shows unknown cost, never zero. A session with a cost cap blocks on unknown cost. Rates are absolute per bucket (input, output, cache read, cache write, reasoning), never vendor multipliers. Dollars are always computed from tokens and never stored. A subscription provider prices at zero, with an API-equivalent projection shown beside it.
