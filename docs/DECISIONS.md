# Architecture decisions

Each record has a context, the decision, and its consequences. A superseded record stays and points to its replacement.
Records before ADR-0028 name the product *hypotaxis*, its name when they were written; they are history and are not rewritten (ADR-0028 says what changed).
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

**Update 2026-11-19, M1.** Three of the spike's open risks were decided and built (`docs/MODS.md` section 9):
- **One QuickJS context per mod** in the session's runtime, the chain in a context of its own, JSON messages between them, intrinsics frozen. The heap limit is still the runtime's, shared; QuickJS cannot account per context.
- **The runtime runs in an `hx mods-worker` process inside `hx-sandbox`**, reached through an inherited socket pair, with no unsandboxed fallback (Windows has none yet: mods are off there, with a reason). Alternatives rejected: in-process (a memory-safety bug in the engine would hold `hx`'s authority), and a runtime per mod (separate heaps but a process or runtime each; kept as the answer if the shared heap or a shared worker proves too weak).
- **Host calls are asynchronous**, and `hx` sends requests to the plugin (`mods.call`): `hx serve` binds a `Link` to its writer. Alternative rejected: a long-poll method the plugin calls for pending `$` calls, which is more machinery and adds a round trip to every call.
The decision of every `$` call is `policy.check` with the mod as principal; the bridge for Claude Code hooks also delivers mod events.

**Update 2026-11-19, M2a.** The runtime runs **one worker per mod**, and the chain runs in `hx` (`docs/MODS.md` section 11). Measured before building it: about 10.6 MiB resident and 12 ms to spawn and load per worker, at 1, 5 and 20 workers (release), under the 15 MiB and 150 ms bar. The alternative (a runtime per mod in one worker) would have left risk 3, a memory-safety bug reaching other mods' authority, open. The plugin restarts a worker that ends, with a backoff of 1, 5 and 30 s, and starts a replacement before the sandbox's one-hour ceiling.

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

## ADR-0027 Hermes's free models in first-run setup: the Desktop declaration, never `HERMES_DESKTOP`
**Context.**
- The owner wants the models Hermes offers for free to work with no configuration. Research (`research/free-tier.md`, read in Hermes v0.23.2 and checked against a real Hermes) found three facts.
  - **The Nous free tier** is one anonymous model, `nous/welcome`, on its own host. Hermes claims it only for a connection that declared itself the Desktop on this machine (`client.capabilities {desktop_local: true}`, counted only on a ticket from the gateway's private control socket), on a first install, once per OS user. It has no usage gauges; its limits arrive as refusals with a wait.
  - **`HERMES_DESKTOP=1` is not that mechanism.** It changes the session platform, the toolsets every session gets and the system prompt (fixed at `session.create`, invariant 4), the telemetry offer and more.
  - **The browser challenge** is a portal page whose URL fragment (`#working`, `#interactive`, `#done`, `#failed`) tells the host when to show or close its window.
- Whether Nous's Terms let a third-party distribution of Hermes use the anonymous tier is **not stated** anywhere (`research/free-tier.md` section 5).

**Decision.**
- Setup's models question has "Free models (Nous free tier, no account)" first and chosen when no key is present, then "OpenRouter free models" (a `credential` form for the key, then the catalogue's free rows), then the Claude ladder and the named models.
- Choosing the Nous tier makes the host declare its gateway link the Desktop, on that link only and only while that is the choice (`setup/state.rs::free_tier_chosen`, asked on every dial). Hermes makes the claim through its own path (`free_tier.provision`); the host writes no model, key or secret for it, only the governed ladder. `HERMES_DESKTOP` is never set and Hermes is never patched.
- The ladder is chosen at run time. The free tier has one model, so one tier of `nous/<what free_tier.status reports>` at every level, and setup says so. For OpenRouter it is up to three of the catalogue's free models ordered by the size each name states (smallest, middle, largest), and models that state none are offered but not proposed.
- The challenge: the host listens for `free_tier.challenge` on each gateway link, opens the page in a hidden webview window that matches no capability, is pinned to the portal origin, refuses popups and downloads, reveals it on `#interactive` (never for an optional challenge), closes it on `#done` or `#failed`, and reports `free_tier.challenge_result` as a hint. The window sits behind a trait so the flow is tested without a display.
- The plan is shown as Hermes reports it (`free_tier.status`, `model.options`, a refused turn's `error_surface`) and nothing else: no allowance size, no bar where Hermes sends none. A refusal raises a notice that offers "choose another model", which asks setup's models question again.
- `config::FREE_TIER_ENABLED` removes the Nous choice from a build, so the owner can decide the terms question without touching anything else.

**Consequences.**
- The declaration makes Hermes write `onboarding: {run: true}` into the private home and the machine marker under the real `$HOME`, and the claim uses up the once-per-user trial for Hermes's own Desktop app too. The choice form says so.
- The account service sees `surface: desktop` from a client that is not Hermes Desktop; the block is self-reported and proves nothing, but the service cannot tell the two apart.
- `nous/welcome` has no price in the user's price table, so its cost reads unknown (ADR-0012) and a session with a cost cap blocks on it. The host writes no zero for it.
- The mechanism is proved live against a real Hermes without calling Nous (`setup_live`: `enabled` is false to a link that does not declare and true to one that does). The hidden window itself is untested against the real page: no call to Nous is made from tests, and a hidden WebKitGTK page may be throttled (Tauri has no background-throttling control on Linux), in which case the check times out after 90 s as Hermes Desktop's would.

**Owner decision (19 November 2026).** Ship both the Nous free tier and OpenRouter's free models. If problems arise with Nous (terms or service), turn the Nous free tier off with `config::FREE_TIER_ENABLED` and keep OpenRouter.

## ADR-0028 The product is named boopis
**Context.**
- Nothing had shipped publicly. The name *hypotaxis* was on every identifier, and the terminal faces (installers, Arch package, `boopis.art`) already said *boopis*, with the old names held in one block each.
- The first public build is the last cheap moment to change a name that is a wire contract, a folder on disk and a keychain service.

**Decision.** The product is **boopis**, always lowercase, in text, window titles, installers and docs.
- **Renamed:**
  - the Tauri `productName` and `identifier` (`dev.aphesist.boopis`), the Cargo bin `boopis`, the host crate `boopis-host`, the UI package `@boopis/desktop-ui`;
  - the plugin (`plugin.yaml` name `boopis`, the directory `plugins/boopis`, the Python package `boopis`, `BoopisError`), the RPC namespace `plugin.boopis.*`, the protocol `boopis-v1`, the theme format `boopis-theme`;
  - the project config `.hermes/boopis.yaml`, `<profile home>/boopis/` and `logs/boopis/`, the checkpoint refs `refs/boopis/checkpoints/`, the Hermes secret source `boopis_host`, the keychain services `boopis.provider.*`, the variables `BOOPIS_*`;
  - the artifact names (`boopis_*.AppImage`, `boopis-*` workflow artifacts), the installers' and the Arch package's name blocks, the `.desktop` file and `StartupWMClass=boopis` (it matches the binary).
- **Kept:** the engineering prefix `hx` (crates `hx-*`, the `hx` binary, `HX.ui`, `hx-` CSS, `HX_*` test variables, `hx-host-secrets-v1`); contraprova's names and format, and its vendored copy (byte for byte); Hermes's own names; the text of earlier ADRs; `legacy/`, the frozen first pass.
- **No compatibility shims.** Nothing reads an old name after the first start. The one exception is a one-time move on that start (`apps/desktop/src-tauri/src/migrate.rs`), logged, tested, and skipped when there is nothing to move:
  - the app's folders `dev.aphesist.hypotaxis` (data, config, cache) become `dev.aphesist.boopis`; when both exist nothing is touched and a warning says so;
  - inside the private Hermes home (never the user's own `~/.hermes`): `hypotaxis/` (ledger, journals, `hx`, `setup.json`) and `logs/hypotaxis/` are renamed, the stale `plugins/hypotaxis` copy is removed (setup installs `plugins/boopis`), and the old words in `config.yaml` are rewritten;
  - API keys in the keychain: the references in that `config.yaml` (`secret://scope/name`) name the entries to copy from `hypotaxis.<scope>` to `boopis.<scope>` before the old one is deleted. The keychain cannot be listed, so this is the only way to find them; a key that cannot be moved is entered again in Settings.
- **Not moved:** git checkpoint refs in a project (`refs/hypotaxis/checkpoints/...`), `.hermes/hypotaxis.yaml` files in projects, a theme exported as `hypotaxis-theme`, and anything in the user's own Hermes home. Each is a user's file or repository, so the owner moves them by hand (`git update-ref` for the refs); in the user's own Hermes home the old plugin is disabled in Hermes.

**Consequences.**
- The repository is renamed on GitHub by its owner (`aphesist/boopis`); `Cargo.toml`, the installers and the PKGBUILD already point there.
- Wire, folder and variable names change together: a build of one name cannot talk to the plugin of the other.
- The logo is the product's mark in the app (`<boopis-logo>`, vendored), and the app icon has a light and a dark set (`apps/desktop/src-tauri/icons/`).

## ADR-0029 The Claude subscription runs through the user's own Claude Code (owner decision)
**Context.**
- The owner wants boopis to run on a Claude Pro/Max subscription, and has decided it several times. Agents kept forgetting and re-raising Anthropic's rule against third-party apps offering claude.ai login.
- Hermes's official plugin `claude-subscription-directsdk` (Nous Research, `hermes-official-plugins`, pinned in Hermes's plugin catalog) drives the **unmodified, official Claude Code executable**, which the user installed and signed in to themselves (`claude auth login`).
  - The plugin has no credentials of its own and never opens, copies, refreshes or prints Claude Code's credential files.
  - Hermes keeps its own agent loop, tools, approvals and compaction.
- Anthropic's legal page does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code".

**Decision.** boopis offers the Claude subscription as a model choice, through that plugin and the user's own Claude Code. **Owner decision, 2026-11-19. Settled: do not re-raise it.**
- boopis never sees, stores, reads or forwards Claude credentials or session tokens. Authentication belongs to the `claude` CLI.
- boopis never offers its own claude.ai login screen. It shows the user `claude auth login`, the official CLI's own login, and checks the result through the CLI.
- The plugin is installed from Hermes's catalog, pinned, through Hermes (`hermes plugins install`). boopis does not vendor or modify it.
- The ledger marks its usage `subscription: true` (LEDGER.md). Its native cost figure is a list-price estimate, never a charge.

**Consequences.**
- First-run setup and Settings → Models offer "Claude subscription (your Claude Code login)" when `claude` is installed, and say what is missing when it is not or is signed out.
- Anthropic API keys, Bedrock, Vertex and Foundry stay available beside it.

**Partly superseded by ADR-0030** (19 November 2026): the plugin is no longer installed through `hermes plugins install`; it ships inside boopis's runtime, and "Sign in to Claude" runs Claude Code's own `claude auth login`. The rest stands.

## ADR-0030 Model sign-ins are boopis's own (owner decision)
**Context.**
- The owner wants boopis to be self-sufficient and wholly its own product: "the logins should never go through hermes itself, nor the plugin install". The engine is named in the repository and in what comes from its store, never in the program.
- The owner asked for ChatGPT (Codex) and Gemini as model choices beside the Claude subscription.
- What the engine (Hermes Agent v0.23.2, read from source) offers:
  - **ChatGPT:** provider `openai-codex` (`chatgpt.com/backend-api/codex`, the Responses API), signed in by OpenAI's device-code flow (`hermes_cli/auth_codex.py`: `https://auth.openai.com/api/accounts/deviceauth/usercode`, the `codex/device` page, polling `deviceauth/token`, the exchange at `oauth/token` with `redirect_uri=…/deviceauth/callback`, client `app_EMoamEEZ73f0CkXaXp7hrann`), the same endpoints and client as the official Codex CLI (`codex-rs/login/src/device_code_auth.rs`). Its tokens normally live in the engine's own `auth.json`. Its credential pool (`agent.credential_pool`) is in its public plugin API (`hermes_cli/data/plugin_api.json`).
  - **Adopting a Codex CLI login:** `auth.adopt_external_logins` only lets the engine *repair* a Codex sign-in of its own from `~/.codex/auth.json` when its tokens are broken or were rotated away; it never creates one. The only import of a Codex CLI login is an interactive `[y/N]` question in `hermes model`, whose default is no ("a separate login is recommended"): refresh tokens are single-use, so two programs sharing one log each other out.
  - **Gemini:** provider `gemini` (Google AI Studio) by API key (`GOOGLE_API_KEY` or `GEMINI_API_KEY`), and Vertex. There is no Google-account or Gemini-subscription sign-in.
  - Other OAuth providers exist (`xai-oauth`, `qwen-oauth`, `minimax-oauth`, `nous`); they are not offered yet.

**Decision.** Owner decision, 19 November 2026. Settled: do not re-raise the terms questions.
- **Every model sign-in is a boopis flow, run by the host.** No `hermes auth`, no `hermes plugins install`, no engine command where the user can see it, and no engine wording in anything the user reads.
- **ChatGPT subscription** ("ChatGPT subscription (sign in with your ChatGPT account)"): the host runs OpenAI's device-code sign-in itself (`apps/desktop/src-tauri/src/chatgpt/`), with the endpoints and client above. The device code, not the browser redirect, because the Codex client's redirect is fixed at `localhost:1455` (a running Codex CLI sign-in may hold it, and it needs a listener in the host), while the code works in any browser on any device and needs none. The card shows OpenAI's page as a button and the code in large mono with a copy button, and says what to do. Both tokens go to the OS keychain (`secret://chatgpt/access_token`, `secret://chatgpt/refresh_token`).
  - **Refresh stays in the host.** The refresh token is single-use, so one program holds it: the host renews the access token 30 minutes before it expires (or at half its life), and a token OpenAI refuses for good signs the account out.
  - **The engine gets the access token only**, in-process: the boopis plugin reads it over the host's secret channel and keeps one row of the engine's `openai-codex` credential pool (source `manual:boopis_chatgpt`, typed as a key so the pool never tries to refresh it) equal to it, through the pool's own API, at load and then every five minutes while a sign-in is held (every 30 seconds while none is, so a new sign-in reaches it within half a minute); signing out removes the row. The engine's own Codex provider then works unchanged (its headers, its transport, its 401 recovery, which re-reads the pool). No engine file is written by hand.
  - The ladder is the first two models of the engine's curated Codex list, cheapest first by its price table: `openai-codex/gpt-6-luna`, then `openai-codex/gpt-6-sol`. `openai-codex` is a plan provider in the ledger (`subscription: true`).
  - A Codex CLI login on the machine is not adopted: the engine has no way to adopt one that is not interactive, and sharing the token family would log one of the two out.
- **Gemini** ("Gemini (a free API key from Google AI Studio)"): a credential form with the page where a key is made (`https://aistudio.google.com/apikey`), the key in the keychain, wired to `GOOGLE_API_KEY` through the secret source like every key; ladder `gemini/gemini-3.8-flash`, then `gemini/gemini-3.1-pro-preview`. No Google sign-in is claimed.
- **Claude subscription** (ADR-0029's substance stands): boopis never sees, stores, reads or forwards a Claude credential; authentication belongs to Anthropic's own `claude` CLI. What changes: the `claude-subscription-directsdk` plugin is **bundled inside boopis's runtime** at build time (`scripts/build-runtime.sh`), unmodified, at the commit the engine's own plugin catalog pins (`plugin-catalog/claude-subscription-directsdk.yaml`), with its MIT licence beside it and in `NOTICE`; setup's runtime step places it in the profile, where a model-provider plugin is enabled with no entry. Setup only checks Claude Code (installed, version, signed in) and offers **Sign in to Claude**, which runs Claude Code's own `claude auth login --claudeai` through the host's login table (`claude-code`). The review-and-install form and its code are gone.
- Free models stay first and the default (ADR-0027). Settings → Models shows each provider's state and offers the same sign-in or key as setup.
- **Dependency:** the host reaches OpenAI's sign-in service over HTTPS with `ureq` 3 (MIT or Apache-2.0) on `rustls` with `ring` (Apache-2.0 and ISC) and the operating system's trust store (`rustls-platform-verifier`, MIT or Apache-2.0), so a company's own certificate authority works and no root list is bundled. Blocking, on `spawn_blocking`.

**Consequences.**
- The ChatGPT access token is in the engine's `auth.json` (written by its pool API) as long as the user is signed in; the refresh token never leaves the keychain. A token in the pool is at least 25 minutes from expiry while the app runs; with the app closed it lapses, and the next start renews it.
- With the user's own engine ("Use my own Hermes" in Settings) the Claude subscription is available only if that engine has the plugin; setup says so (`hx.setup.subscription_unavailable`). The ChatGPT and Gemini choices work on either.
- A ChatGPT plan's limits arrive as refusals from OpenAI; boopis shows them as the engine reports them and invents no allowance.
- New host codes: `hx.signin.unreachable`, `hx.signin.rate_limited`, `hx.signin.unsupported`, `hx.signin.failed`; `hx.setup.subscription_unreachable` and `hx.setup.subscription_install_failed` are gone.
- Tested: the device flow against a scripted OpenAI (approved, cancelled, timed out, refused, rate-limited) and the real HTTPS transport against a loopback server; the refresh (renewed, rotated, revoked); setup's forms and ladders; the plugin's pool row over the host's real secret channel; and, with a real engine, its own Codex provider resolving exactly the host's token, and the bundled Claude plugin listed as an enabled model provider with nothing installed. A real ChatGPT account was not signed in to.

## ADR-0031 boopis is the product; its engine is invisible (owner decision)
**Context.**
- boopis runs on unmodified Hermes, bundled (ADR-0023), and the app said so everywhere: setup's "Hermes runtime" step, "This makes a Hermes profile for jabuti", "Hermes did not answer", raw engine errors ("hermes refused updates.check: OSError: ..."), the "Use my own Hermes" setting, `hermes` in `--version` and `doctor`, the private folder `<app data>/hermes-home/` shown when a bot is made.
- The owner, 19 November 2026: "i do like that we depend on hermes but i wanted something more 'autosuficient' ... i want the only hermes mention to be on the repo and on the plugins/anything else that you could download directly from hermes/hermes store. the program itself should be 100% boopis branded, as if we were our own thing."

**Decision.** boopis is the product. Hermes stays the engine inside, bundled and never patched, and the person using the app never reads its name. **Owner decision, 2026-11-19.**
- **Allowed places for "Hermes":** the repository (README credits, docs, code identifiers, licences and `NOTICE`), and an item the user downloads from the Hermes plugin store whose own name or publisher is Hermes's. That item is the only in-app exception; a component that draws one marks it `data-store-item` (`ui/src/core/engine-words.ts`).
- **The app names the thing, not the engine:** "boopis's engine" where the engine itself is the subject, and better what failed in the user's terms; a teammate is a "bot", never a "profile". Meaning stays exact: boopis never claims to do something the engine does differently. The inventory is `docs/BRANDING.md`.
- **Errors:** one mapper in the host (`error::user_message`) gives every error the UI sees a boopis sentence, a stable `hx.*` code and the next step, from the catalog's new `user` field (`crates/hx-proto/errors.json`, synced to the plugin, read by the UI). The engine's raw words go to the log and to Settings, General, Diagnostics only. The engine's own JSON-RPC answers pass the proxy untouched (frames are never altered), so the UI applies the same catalog's `hx.engine.refused` sentence to an answer without an `hx.*` code (`GatewayError.fromFrame`). Codes that a person reads no longer name the engine: `hx.hermes.*` is `hx.engine.*`, `hx.setup.hermes_missing` is `hx.setup.engine_missing`, `hx.bots.hermes_failed` is `hx.bots.engine_failed`.
- **The private engine home** is `<app data>/engine/` (was `hermes-home/`). The engine has no profile-root override, so a bot's folder keeps the engine's layout inside it, `engine/profiles/<name>`.
- **"Use my own Hermes" leaves the app.** The capability stays for developers, as `boopis --engine existing` and `BOOPIS_HERMES=existing`, documented in `docs/ENGINE.md`. Settings no longer offers it, and the saved `hermes_source` setting is no longer read; `engine_source_get` (read-only) tells the first-run screen which engine this run uses.
- **Guards:** a vitest (`ui/src/engine-words.test.ts`) and a Rust test (`src-tauri/src/engine_words.rs`) fail on the word in any user-facing source literal, with an allowlist for code identifiers, logs, error detail and store items; `cli/tests.rs` checks `--version`, `doctor` and `--help`; `scripts/test-brand.sh` checks the installers and the Arch package. The design system's voice section carries the rule as an owner decision.

**Migration.** `migrate::engine_home`, once, at start, before anything runs from the folder (like ADR-0028's rename):
- `<app data>/hermes-home` becomes `<app data>/engine` with one rename; the absolute paths that its `config.yaml` and each `profiles/*/config.yaml` hold (`hx_path`) are rewritten;
- a gateway an earlier run left serving from the old folder is stopped first (`gateway stop --yes` with the bundled launcher, this build's or the one an earlier build unpacked, then a wait until its control socket is quiet); one that will not stop keeps the old folder for that run only (`runtime::Plan::home`), and the move is tried on the next start;
- when both folders exist nothing is touched and a warning says so; a machine without the old folder is untouched; every step is logged and tested (`migrate/tests.rs`). Nothing reads the old name after the move. The user's own Hermes home is never touched.

**Consequences.**
- The model sign-in flows (setup's models question, Settings > Models, the plan, the Claude subscription) were rewritten in boopis's words when ADR-0030's branch merged with this one; both guards' `PENDING` lists are empty.
- A saved `hermes_source: existing` is ignored after the update: start with `--engine existing` instead.
- Diagnostics is the one screen where the engine's own words appear.

## ADR-0032 Smart runs in the UI, per message, through the engine's own switches (owner decision on the need, 2026-11-20)
**Context.**
- The owner: "Smart (the automatic model choice) is not built yet", "a quicker way to change models ... a menu in the chatbox where you can just choose who will answer you next". Smart had been a switch that refused with "not built yet".
- The plugin's hooks (`pre_llm_call` and the others) can add context or block a call; they cannot change the model of a request, and mods may not either (`turn.step` model is refused). The engine does have a per-session model switch (`config.set` key `model` with `--provider X --session`; at creation `session.create` takes `model` and `provider`), and the plugin has a start tier for a governed task.

**Decision.** Smart is a pure function in the UI (`ui/src/data/smart.ts`), run in the live provider just before `prompt.submit` (`details.prepareSend`). It is not in the plugin and not in the Rust host.
- **Why there.** The UI is where the message, its attachments and the session's recent failures are all known at the moment of sending, and where the choice must be visible (the chip previews it while typing; the turn's meta says "Smart: debugging"). Neither the plugin nor the engine can switch a model per request, so a plugin rule would still need the UI to carry it out. A rule in the UI is unit-tested with no engine.
- **The rule.** A level 0, 1 or 2 from the message: design, architecture or migration words, over 1,500 characters, over 40 lines of code, 4 or more attachments, or two of the last three turns failed raise it to 2; debugging words, refactoring words, a diff or code block, over 400 characters, any attachment or `@file` mention, or the last turn failing give 1; anything else is 0. The highest signal wins and is the reason. The level is spread over the session's ladder (cheapest first): 0 the first tier, 2 the last, 1 the middle (the lower of two). The cheapest tier answers by default. With no ladder known Smart refuses to turn on and says so; it never guesses.
- **Ungoverned:** the pick is applied with `config.set model ... --session` once per change (`--session` always, so nothing is written to the profile's configuration). **Governed:** the pick is where the ladder starts, through the new plugin RPC `cascade.start_tier` (allowed after the first prompt, unlike `mode.set`, because the start tier is read at dispatch and does not touch the cached prompt); the gate still escalates past it. In governed mode only the ladder's tiers can be picked.
- **Who answered** is the engine's word: `usage.model` of `message.complete` (ungoverned), and the tiers of `plugin.boopis.cascade.updated` in order (governed, shown as the route). Smart's reason is shown in the turn's meta.
- **Names.** Model ids are written for people by a small parser over `apps/shared/data/model-names.json`; the engine reports no label for a model, so only a provider's name is the engine's, and the provider's plan is secondary text.

**Consequences.**
- A failed switch stops the message with a sentence saying which model; nobody is answered by a model nobody chose.
- Smart is off by default (the engine's own model answers until the user chooses), so nothing changes silently.
- The ledger does not record a start-tier change or a Smart pick yet; the turn's meta is the record for now.

## ADR-0033 Talking to bots, and team chat on the engine's Group Chat rooms
**Context.**
- The owner, 20 November 2026: "the session works, but i can't send any bots messages nor create bot groups." A bot was a profile whose room could only show its schedule and sessions; `docs/ARCHITECTURE.md` section 10a left open which engine primitive carries team chat (**[verify]**: group sessions `groups.*`, bot relay `bot_relay.*`, agent-to-agent `a2a.forward`, Kanban).
- Read in the engine's source (v0.23.2, `tui_gateway/methods_groups.py`, `gateway/hosted_room_*.py`, `gateway/session_bot.py`, `gateway/session_a2a.py`):
  - **`groups.*` (Group Chat rooms) is a group chat.** A room is a name and a frozen roster of two to six local profiles (`member_id`, `profile`, `handle`, `display_name`). `groups.send` appends a `message.user`; the room worker (the gateway's, started with it) runs a *Discussion*: it hands the message to every member, or to those the text names with `@handle` (`resolve_mentions`; `@all` and `@everyone` are reserved), each member answers as its own profile in its own session, and the answers are republished to the others for up to three rounds and ten messages; a bare "pass" is silence. Every message is an event of a durable, monotonic log (`groups.log`, `message.member` with the member's id), and the engine pushes `groups.changed`. `groups.rename`, `groups.stop`, `groups.continue` (after the cap), `groups.state` (who is working) and `groups.context` (purpose, notes, routing `everyone`, `lead` or `auto`) exist.
  - `bot_relay.*` carries messages between a *client's own* bots and the engine (roster sync, deliver, reply, an outbox): it is for a desktop that hosts bots itself, not for the engine's profiles.
  - `a2a.forward` forwards one session's message to another gateway's session (`session_a2a.py`): one hop between two sessions, with no room, no roster and no shared thread.
  - Kanban (`kanban.db`) is a durable task board: right for a hand-off that must survive, wrong for conversation.

**Decision.**
- **Group Chat rooms (`groups.*`) carry team chat.** A boopis group is a room; its members are bots (profile names); the thread is the room's log; `@name` is the engine's own `@handle` (the handle is the profile name), so boopis does not route anything itself. `a2a.forward` and Kanban stay what hand-offs use later (the contract lane of section 10a); `bot_relay.*` is not used.
- **A conversation with one bot is a session of its own profile**, on the bot's own link (`connect(profile)`; the engine binds a ticket to one profile): `session.create` on the first message, `prompt.submit`, the reply streaming back as `message.*` events attributed to the bot, `approval.respond`, `session.interrupt`. The bot's recent sessions are the ones `session.list` gives on that link; `session.resume` opens one as the thread. It runs with the profile's own soul, memory, skills and model; boopis's governed mode (the `boopis` toolset) is the Sessions section's and is not applied to a bot's conversation (the room worker cannot apply it to a member's turn either).
- **What the engine's rooms cannot do is said, not faked.**
  - *Members:* a roster is frozen at creation. Changing the members makes a new room with the same name and archives the old one; the form says so before it does. The new room starts empty; the old one's messages stay readable in Archived.
  - *Archive:* a room can only be disbanded for good (`groups.disband`). Archiving is boopis's own mark on this computer (`core/settings`, `hx.v6.bots.archivedGroups`), reversible with Restore; the room and its log are untouched. Another computer's boopis, or another client of the same engine, still lists it.
  - *Replies arrive whole*, not word by word: the engine publishes a member's message when the member has finished it. The room shows who is replying (`groups.state`, `member_activity`) in the meantime.
  - *Who answers:* with no `@name` every member answers, then reads the others; so a group is a conversation among bots that each see the others' replies, not a router that picks one.
- **The UI says what it is:** the empty room and the new-group form carry `GroupsSource.nature` ("Each member reads what you write and what the others said, and answers in its own words. Write @name to ask one of them."). Where the room worker is off or the engine has no `groups.*`, the form and the room say so (`GroupsSource.note`) and nothing is pretended.

**Consequences.**
- No plugin change, no new RPC and no engine patch: everything above is the engine's public methods, typed by the vendored contract (ADR-0023).
- A group holds two to six bots; a user with one bot cannot make one yet.
- A group's thread is the engine's, so it survives a restart and is the same in any client of that engine.

## ADR-0034 Tasks sent to the models the user names, through the engine's own delegation (owner decision on the need, 21 November 2026)
**Context.**
- The owner: "send this task to opus, this one to codex, and this one to carbon, and this one to grok should automatically separate those tasks as the message stated ... if it can happen in-engine, without [patches], that's fine by me."
- Read in the engine's source (v0.23.2): `delegate_task` (`tools/delegate_tool.py`) already runs child agents in the background with a fresh context (`goal` and `context`), in parallel, and returns their results to the parent. A model cannot choose a child's provider or model: those task parameters are reserved and stripped. A *delegation provider* (`agent/delegation_provider.py`) chooses: it may declare extra per-task parameters (an enum is enforced by the engine before `route_task` runs) and returns a route (`provider`, `model`, `label`). The tool's schema is built from the provider when a session's tools are built and pinned with them (`agent/delegation_backends.py`). Events `subagent.spawn_requested|start|progress|thinking|tool|complete` carry the child's goal, model, status, summary, duration and `child_session_id`; `subagent.interrupt` stops one; `session.transcript` reads a session without attaching it.
- boopis already registers one (`governance/delegation.py`, `BoopisDelegation`, `delegation.backend: boopis`), which refused every delegation not started by its own governed `dispatch`.

**Decision.** No engine change and no new tool: the session's own model splits the message (it understands it) and calls `delegate_task` with one task per model; the boopis backend decides where each goes.
- **`target`.** `BoopisDelegation` declares one task parameter, `target`, an enum of the words of the models the person can use now. The words come from the shared names table (`apps/shared/data/model-names.json`, copied into the plugin by `scripts/sync-shared-data.sh`): the Claude aliases (`opus`, `sonnet`, `haiku`), a provider's words (`codex`, `gpt`, `grok`, `gemini`), the model's family word, and always the model's own id. A word goes to the first model that claims it, so none is ambiguous.
- **Where the list comes from.** The plugin cannot list the user's signed-in models through Hermes's public plugin API, but the desktop already does (`model.options`, the ladder). Just before `session.create` and `session.resume` the UI sends `plugin.boopis.dispatch.roster {models: [{provider, model}]}`; the plugin keeps the roster for the process and `task_parameters` reads it when the session's tools are built. A session's tools are fixed at creation (invariant 4), so **a model signed in later is named by the next session** (the UI does not yet say so; left for the owner to place).
- **Guard (invariant 2's spirit).** `route_task` accepts a `target` only if the user wrote that word in the message that started the turn. The plugin records each session's `pre_llm_call` `user_message` and matches the word (case-insensitive, whole word; in an id a space, hyphen or dot are the same). A word the user did not write is refused ("the user did not name 'grok'..."), so the model can never buy a stronger or different model on its own. A word that matches nothing (the engine refuses it from the enum, or the plugin when the roster changed since: "No model called 'carbon' is available. The models that can take a task are: ...") ends in a message the model reports to the user.
- **Governed sessions keep the refusal.** `route_task` answers a governed session (or a cascade launch) exactly as before: only `dispatch` starts work and the ladder's tier is the route; a `target` is refused with that explanation. The user-directed path is open when `user_directed_allowed(state)` says so, which is today any session that is not governed (the owner's chosen default). A turn that runs ungoverned by the user's one-message choice reaches the same function.
- **The UI.** `subagent.*` frames become cards in the turn that raised them (`ui.child`: the model's logo and readable name, the goal, what it does now, status, a running clock, the summary), with *open* (reads `session.transcript` of `child_session_id`, read-only and never attached) and *stop* (`subagent.interrupt`). Children are live state: a resumed transcript does not carry them.

**Consequences.**
- A message that names models and no one else works with no new tool, no patch and no extra model call; results return to the session's model, which reports.
- A task without `target` in an ungoverned session is refused with a sentence ("Set `target` to the model the user named..."), not run on a model nobody named.
- The guard is a word match, not an understanding: a message that mentions "opus" in passing allows a task to opus. It never allows a model the user did not write.
- The roster is the process's, not the session's: two windows with different sign-ins share the last one sent.

## ADR-0036 Who answered each message, "@" for one message, and one ungoverned turn (owner decisions, 20-21 November 2026)
**Context.**
- The owner, 20 November 2026: "centralize all the models in a single session on the session tab": any of his models answers any turn of one session, with one shared context, and every reply shows its model's logo. He approved a record of the model per message that survives a resume, a divider where the model changes, and "@" in the composer ("@codex fix this") to have one message answered by one model, the session's default unchanged.
- The bug: `transcriptToTurns(res.messages, c.model, ...)` stamped the *current* model on every past reply after a resume. The engine does not remember who answered: its messages table has no model column (it only writes a "[Model switched to X via provider Y]" row, a stored user row with `display_kind: model_switch`, of which it keeps the newest).
- What the engine offers (read in v0.23.2: `tui_gateway/methods_config_set.py`, `model_switch.py`, `prompt_turn.py`): `config.set {key: "model", value: "<model> --provider <slug> --once"}` switches the live agent at once and arms a restore that runs when the next turn ends; `prompt.submit` has no model field; a switch asked of a running turn is only stashed. `message.complete.persisted_turn` gives the turn's stored row ids. The plugin's `post_api_request` hook sees every model request with its real provider, model and `turn_id` (also after a fallback).

**Decision: who answered.**
- The plugin records it (`plugins/boopis/turns.py`), not the host. The plugin already sees the real provider and model of each request; the host would only know what the UI was told. The record is a *turn book*: one JSON line per answered turn in a file beside the session's ledger (`<ledger>.turns.jsonl`), `{turn_id, model: "provider/model", route: [...worker tiers], ungoverned, user_row_id, row_ids, at}`. It is a sidecar and not ledger events because the ledger is contraprova's format, byte for byte (invariant 3), and a new event type would have to go upstream first.
- Two RPCs: `plugin.boopis.turns.bind {session_id, user_row_id?, row_ids}` (the UI calls it when `message.complete` carries `persisted_turn`: the plugin takes the model requests it saw since the last bind and writes the line) and `plugin.boopis.turns.models {session_id}` (read on a resume). The answering model of a turn is the last request of the session's own model; a governed turn also keeps the tiers its workers ran on, so it still shows its route.
- `usage.recorded` now carries `turn_id` (an extra field; contraprova allows them), so the ledger and the book can be joined. (The brief said it already did; in the code it did not.)
- A turn with no line is **unknown**: `transcriptToTurns(rows, idPrefix, book)` gives it an empty model and the call number says "Model unknown". It never falls back to the session's current model (invariant 5). A branched session has an empty book for its copied turns (unknown); copying the book across a branch is left.
- The UI hides the engine's own switch-note rows (they are user-role rows) and draws a **divider** instead: a hairline row with both models' logos and names ("Claude Haiku -> GPT-6 Luna") before each reply whose model differs from the last known one. An unknown reply neither draws nor hides a divider.
- Cost of the choice: a turn finishing while no UI is connected is not bound and so shows as unknown after a resume. That is the honest outcome and rare (the host keeps the UI's link while the app runs).

**Decision: "@" for one message.**
- Typing "@" at the start of a word opens a menu of the same models as "who answers next" (without Smart), with logos and readable names; picking one writes `@<readable name>` into the text, drawn as a mention chip (a composer mark of kind `mention`). The reader (`data/mentions.ts`) is the one place that says what a mention is; the composer and the send use it.
- A message whose only mention is **one model** (however many times it is named) is sent through the engine's one-turn switch: `config.set ... --once`, then `prompt.submit` with the text as written, on an idle session (a running session refuses it in words). The session's own model and the sticky pick are never touched: the engine restores itself, and the UI holds the session's model for the chip while the mentioned model is named by the engine's reports. If the submit fails after the switch, the previous model is put back. **Smart does not override a mention.**
- A message that mentions **two or more different models** is left as written for the session's model: the task-splitting tool (ADR-0034) reads it. The UI does not split.

**Decision: one ungoverned turn (the owner's change to the default, 21 November 2026).**
- The owner: *"@ in governed mode can turn off governed mode for that message specifically."* This replaces the first default (in governed mode only ladder tiers can be mentioned). In a governed session, a message with one "@model" runs **ungoverned for that turn only**: any available model can be named, it answers directly with no cascade and no gate escalation, and the next message is governed again.
- How governed mode really works, and what could change: the mode, the policy and the toolsets are fixed at the first prompt (prompt caching, invariant 4), and a governed session is created with `toolsets: ["boopis"]`. So the exception cannot change the mode. `plugin.boopis.mode.once {session_id, armed}` **arms** the next orchestrator turn; `pre_llm_call` starts it (`turns.begin`) and `on_session_end` ends it. While it runs, `SessionState.effective_mode` is `ungoverned`: no turn directive, the ungoverned policy (`policy_for`), and `ship` without the governed rule that demands a configured gate command. The session's `mode` field never changes, and an ungoverned session answers `armed: false`.
- It resets itself whatever happens: `on_session_end` fires for a completed, failed or interrupted turn; a turn whose end was never heard of is closed by the next turn's start (`reason: lost`); an armed session that sends nothing lapses after 120 seconds; the UI withdraws it (`armed: false`) when it could not switch the model or submit; a cost-capped turn clears it. A worker's turn end does not end it.
- **What that turn can and cannot do.** The toolset is still the governed `boopis` one (`pack`, `exec`, `ship`, `dispatch`, forms), because toolsets are fixed at creation. So the ungoverned turn **can** read (`pack`), compute (`exec`) and write files through `ship` itself (the orchestrator may ship; in governed mode only workers can), and answer in prose. It **cannot** use the engine's own tools (terminal, file edit, web), because they are not in the session, and `dispatch` is refused ("available in governed mode only"). The system prompt still carries the governed contract (it is cached and cannot change); the plugin adds a one-line context to the turn saying governance is suspended for it. `ship` still ends at the project's gate when the project has a gate command, as in any ungoverned session: it is not a way to skip a gate that is configured.
- **The audit trail.** Both edges are `mode.changed` ledger events with `scope: turn` (`from`/`to`, `reason`: `armed`, `completed`, `failed`, `interrupted` or `lost`, and on the start `gate: skipped`, `cascade: skipped`, `turn_id`), so the ledger shows which turn skipped governance. The turn book marks the turn `ungoverned: true`, so it keeps its mark after a resume.
- **The UI says it plainly:** the "@" menu in a governed session lists every model with "Runs without governance" and a foot note ("This message runs without governance: no cascade, no gate. The next message is governed again."); the assumptions row under the composer says "to X only, ungoverned"; the sent turn carries a quiet "ungoverned" badge beside its model, with the sentence in its tooltip.

**Consequences.**
- Plugin: `turns.py`, three RPCs (`mode.once`, `turns.bind`, `turns.models`), `on_session_end` hook, `usage.recorded.turn_id`. UI: `host/live/attribution.ts`, `data/mentions.ts`, `modules/session/attribution.ts`, the "@" menu and chip in the session composer. No engine patch (ADR-0023).
- Left: copying the book across a branch; a turn that completes while no UI listens is unknown; the divider for a governed route compares the last tier only.

## ADR-0012 Prices
Prices come from the models.dev catalogue plus a user override table. Hermes's models.dev data is not reachable through its public plugin API, so:
- the plugin reads a cached catalogue file, `<profile home>/hypotaxis/prices/models-dev.json`;
- the host refreshes that file daily;
- in plain Hermes, the plugin can fetch it itself through RPC `prices.refresh` (one HTTPS GET to models.dev, on by default, switchable off in settings).

An unpriced model shows unknown cost, never zero. A session with a cost cap blocks on unknown cost. Rates are absolute per bucket (input, output, cache read, cache write, reasoning), never vendor multipliers. Dollars are always computed from tokens and never stored. A subscription provider prices at zero, with an API-equivalent projection shown beside it.
