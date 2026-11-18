# Protocols

Status: v1. Verified against a live Hermes v0.23.2 in the S0 spike (`docs/research/spike-s0.md`), except where marked **[verify]**. Wire rules (JSON-RPC 2.0, naming, additive evolution, capabilities, errors) are in `docs/STANDARDS.md` section 7. The source of truth for every type is `apps/shared/hypotaxis-v1.openrpc.json`. Python, Rust and TypeScript types are generated from it.

There are four seams, and each has one protocol:

| Seam | Protocol | Transport |
|---|---|---|
| UI and host | Tauri commands + Channels (typed with `tauri-specta`) | Tauri IPC |
| Host and Hermes | `hermes-gateway-v1` (Hermes's own, unmodified) | WebSocket `ws://127.0.0.1:<port>/api/ws`, ticket subprotocol, no `Origin` |
| UI and plugin | **`hypotaxis-v1`**: plugin RPC `plugin.hypotaxis.<method>` and events `plugin.hypotaxis.<event>`, carried inside `hermes-gateway-v1` | via the host's proxy |
| Plugin and `hx` | **`hx-v1`**: JSON-RPC over stdio, newline-delimited (`crates/hx-proto/schema/hx-v1.schema.json`) | child process |
| Plugin and exec kernel | `hx-kernel-v1`: JSON-RPC over a private socket (never stdout) | Unix socket / named pipe |

## 1. UI and host (Tauri)

The UI never holds gateway tickets, tokens or keys.

| Command | Request | Response |
|---|---|---|
| `hermes_status` | — | `{installed, version, code_sha, profile, gateway: "running"\|"stopped"\|"incompatible", requires: ">=x.y.z"}` |
| `hermes_install` | `{consent: true}` | progress on a Channel; final `{ok}` or error |
| `gateway_connect` | `{profile?: string, frames: Channel<Frame>}` | `{connection_id, describe}` (the result of `runtime.describe`) |
| `gateway_send` | `{connection_id, frame}` | `{}`. Frames are JSON-RPC objects. The host validates shape and size and never alters `params` |
| `gateway_disconnect` | `{connection_id}` | `{}` |
| `secret_set` / `secret_delete` | `{service, account, value?}` | `{}`. Writes go to the OS keychain. **There is no `secret_get` for the UI**; the plugin reads secrets through Hermes's `register_secret_source`, backed by the host |
| `app_settings_get` / `app_settings_set` | typed settings | |
| `notify` | `{title, body, action?}` | `{}` |
| `pick_folder` / `open_external` | | |

The host reconnects on gateway restarts (after `code_sha` mismatch, idle exit or crash) and replays with `session.events.since` using `seq` and `replay_epoch`. The UI sees a `connection.state` frame: `connecting`, `ready`, `degraded` or `incompatible`.

## 2. Host and Hermes: `hermes-gateway-v1`

Hermes's own protocol, used exactly as Hermes Desktop uses it (`apps/shared` in hermes-agent).
- **Bootstrap:** `hermes gateway ensure --json`, then `hermes gateway attach --json`. On POSIX the host may use the control socket instead.
- **Handshake:** `runtime.describe`, then gate on `capabilities`, then `client.capabilities {server_requests: true}` after `gateway.ready`.
- **Methods the app uses:**
  - sessions: `session.create`, `session.resume`, `session.list`, `session.info`, `session.interrupt`, `session.steer`, `session.redirect`, `session.transcript`, `session.export`, `session.events.since`;
  - prompts: `prompt.submit`, `prompt.cancel`;
  - responses: `approval.respond`, `clarify.respond`;
  - config: `config.get`, `config.set`;
  - discovery: `commands.catalog`, `skills.reload`;
  - other: `rollback.*`, `profiles.list`, `cron.*`.
- **`session.create` from hypotaxis:**
  - `source: "gui"`, `client: {name: "hypotaxis", version}`;
  - `cwd`, `model`, `provider`;
  - `toolsets: ["hypotaxis"]` (governed) or the profile's ungoverned set;
  - `skills`.
  Never `safe_mode`, because that would skip plugin discovery and drop hypotaxis.
- **Approvals:** canonical only, as verified in S0. The flow is event `approval.request {prompt_id, execution_generation, command, description, choices: once|deny|session|always, timeout_s}`, then `approval.respond {session_id, execution_generation, prompt_id, choice}`, then event `approval.settled`. Server requests still carry `clarify`, `secret`, `sudo`, `vault.*`, `preview.*` and `theme.*`.
- **Call rules:**
  - `prompt.submit` requires `submission_id`;
  - `session.steer` requires the `execution_generation` from an event envelope;
  - `session.mutate` takes `expected_revision` and `expected_generation`, which come from the `revision_conflict` refusal;
  - `session.create` must omit `base_url` when using a named provider.
- **Generated client:** the TypeScript client reuses `@hermes/shared`'s generated contract (`gateway-contract.generated.ts`, MIT), vendored per Hermes tag and diffed on every bump.

## 3. UI and plugin: `hypotaxis-v1`

Methods are registered with `ctx.register_rpc(name, handler)` and appear as `plugin.hypotaxis.<name>`. Events are sent with `ctx.emit_to_session(session_id, event, payload)` and appear as `plugin.hypotaxis.<event>` gateway events. Gate the whole surface on the gateway capability `plugin-rpc-v1` and on `describe.capabilities`.

### Methods
| Method | Params | Result |
|---|---|---|
| `describe` | — | `{version, protocol: "hypotaxis-v1", capabilities[], hx: {version, protocol}\|null, kernel: {ok}\|null}` |
| `mode.set` | `{session_id, mode: "governed"\|"ungoverned", ladder?: Tier[], model?: ModelRef, gate?: {enabled}}` | `{}`. Must be called before the first `prompt.submit` of a session; later calls fail with `hx.mode.locked` (prompt caching). **[verify when system-prompt sections are evaluated]** |
| `feedforward.preview` | `{session_id, draft, cursor?}` | `{decisions: Decision[], assume: string}`. At most one model call per typing pause, which the UI debounces at 1.5 s |
| `feedforward.set` | `{session_id, key, value}` | `{}`. Applied to the next turn and written to the ledger |
| `blank.fill` | `{session_id, blank_id, answer}` | `{delivered: bool}`. Delivered through steering at the next tool boundary |
| `ledger.tail` | `{session_id, since_seq, limit}` | `{events: LedgerEvent[], head_seq}` |
| `ledger.verify` | `{session_id}` | `{ok, broken_at_seq?}` |
| `ledger.stats` | `{session_id}` | `{tokens: Usage, cost_usd, cost_api_equivalent_usd, round_trips, escalations, rollbacks, blanks, approvals, price_table}`. Costs are computed on read |
| `cascade.state` | `{session_id}` | `{task_id?, tier?, ladder: Tier[], status}` |
| `ladder.get` / `ladder.set` | `{profile}` / `{profile, ladder}` | |
| `checkpoint.list` | `{session_id}` | `{checkpoints: [{ship_id, turn_id, commit, files, ts}]}` |
| `checkpoint.rewind` | `{session_id, ship_id}` | `{ok}`. Itself a journaled ship, so it's reversible |
| `compat.inventory` | `{cwd}` | `{items: CompatItem[], trust: TrustState}` |
| `trust.set` | `{cwd, decision: "trust"\|"deny", content_hash}` | `{}` |

### Events
| Event | Payload |
|---|---|
| `ledger.appended` | `LedgerEvent` (the full envelope) |
| `cascade.updated` | `{task_id, tier, status: "working"\|"gate"\|"escalating"\|"passed"\|"failed", attempt}` |
| `ship.completed` | `{ship_id, status: "shipped"\|"restored"\|"aborted_before_write", files, gate?: GateSummary}` |
| `blank.opened` / `blank.filled` / `blank.lapsed` | `{blank_id, question, options, blocks}` / `{blank_id, answer}` / `{blank_id}` |
| `budget.blocked` | `{cap_usd, projected_usd}` |
| `compat.changed` | `{cwd}` |

### Shared types (abridged; full definitions in the OpenRPC file)
- `ModelRef {provider, id}`.
- `Tier {name, model: ModelRef, effort: "none"|"low"|"medium"|"high"|"max", max_tokens?, retries}`.
- `Usage {input_uncached, output, cache_read, cache_write, reasoning}`.
- `Decision {key: "approach"|"scope"|"gate"|"ship_target"|"mode"|"tier"|"cost_cap", value, options[], source: "config"|"convention"|"model"|"user", span?: [start, end]}`.
- `LedgerEvent` is contraprova's envelope (`docs/LEDGER.md`).

## 4. Plugin and `hx`: `hx-v1`

Defined in `crates/hx-proto`.
- `hx.describe`.
- `txn.validate`, `txn.apply`, `txn.restore`, `txn.discard`, `txn.recover`.
- `pack.search`, `pack.read`, `pack.symbol`, `pack.outline`, `pack.status`, `pack.bundle`.
- `sandbox.run` (`{argv, cwd, ro[], rw[], net: false|allowlist, env, timeout_ms, output_cap}`).

Cancellation uses `$/cancelRequest`. The plugin keeps one warm `hx serve` child per Hermes process and restarts it on crash, never more than 3 times a minute.

## 5. Plugin and exec kernel: `hx-kernel-v1`
- **Plugin to kernel:** `cell.run {code, timeout_ms}` streams `cell.output` notifications and ends with `{status: "ok"|"error"|"cancelled"|"timeout", result_repr?, error?}`; `cell.cancel`; `kernel.reset`.
- **Kernel to plugin:** `tool.call {name, args}` goes through `ctx.dispatch_tool`; `mcp.call {server, tool, args}` goes through `ctx.call_mcp`; also `blank.open {question, options, blocks}`, `diagnostics {paths}` and `apple.*` (phase 3).
- `harness.parallel([...])` is `asyncio.gather` over `tool.call`. Concurrency is capped by `code_execution.max_tool_calls` and a per-cell limit.

## 6. Error codes
Stable string codes in `data.code`, listed in `crates/hx-proto/errors.json` (shared by all languages):
- `hx.config.invalid`;
- `hx.policy.denied`;
- `hx.mode.locked`;
- `hx.txn.aborted_before_write`, `hx.txn.scope_violation`, `hx.txn.protected_path`, `hx.txn.io`, `hx.txn.journal_corrupt`;
- `hx.gate.blocked` (a tool outcome, not an error), `hx.gate.timeout`;
- `hx.pack.*`;
- `hx.sandbox.unavailable`, `hx.sandbox.denied`;
- `hx.kernel.dead`;
- `hx.ledger.chain_broken`, `hx.ledger.invalid_transition`;
- `hx.budget.blocked`;
- `hx.hermes.incompatible`, `hx.hermes.unavailable`.
