# Protocols

Status: v1. Verified against a live Hermes v0.23.2 in the S0 spike (`docs/research/spike-s0.md`), except where marked **[verify]**. Wire rules (JSON-RPC 2.0, naming, additive evolution, capabilities, errors) are in `docs/STANDARDS.md` section 7. The source of truth for every type is `apps/shared/boopis-v1.openrpc.json`. Python, Rust and TypeScript types are generated from it.

There are four seams, and each has one protocol:

| Seam | Protocol | Transport |
|---|---|---|
| UI and host | Tauri commands + Channels (typed with `tauri-specta`) | Tauri IPC |
| Host and Hermes | `hermes-gateway-v1` (Hermes's own, unmodified) | WebSocket `ws://127.0.0.1:<port>/api/ws`, ticket subprotocol, no `Origin` |
| UI and plugin | **`boopis-v1`**: plugin RPC `plugin.boopis.<method>` and events `plugin.boopis.<event>`, carried inside `hermes-gateway-v1` | via the host's proxy |
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
| `secret_exists` | `{service, account}` | `boolean`. For a form's "provided" state; never the value |
| `app_settings_get` / `app_settings_set` | typed settings (`{version, profile, notifications}`, versioned and migrated) | |
| `notify` | `{title, body, action?}` | `{}`. Desktop notifications carry no action buttons; `action` is validated and ignored |
| `pick_folder` | | `{path, home_relative}` or `null`: `~/x/y` under the user's home, absolute outside it |
| `open_external` | `{url}` | `{}`. `http` and `https` only, no credentials in the URL |
| `setup_check` | `{profile?}` | `{hermes_installed, needed, reason}`. Read-only: does first-run setup still have to run |
| `setup_advance` | `{profile?, answer?, reconsider}` | `{steps[], form?, done, install_command?, receipt?}`. Runs setup as far as it goes (below); `answer` is `{form_id, cancelled, values, secrets}` for the form the last call returned. Secret values travel here only to reach the keychain; the host never logs them. It never runs an installer |
| `hermes_retry` | `{profile?}` | `{}`. Asks a link that parked as `incompatible` to try again |
| `gateway_stats` | `{profile?}` | counters and p95 timings of the proxy |

The host reconnects on gateway restarts (after `code_sha` mismatch, idle exit or crash) and replays with `session.events.since` using `seq` and `replay_epoch`. The UI sees host-made `event` frames (type namespace `connection.`, never from the gateway): `connection.state` (`payload.state`: `connecting`, `ready`, `degraded` or `incompatible`; `reconnected: true` after a loss), `connection.replay_gap` (`payload.session_id`: the replay buffer was truncated, reload that transcript) and `connection.backpressure` (`payload.coalesced`: `message.delta` frames were merged because the window fell behind). The same state is a typed `ConnectionStateEvent`. A window's `client.capabilities` and `runtime.describe` are answered by the host from the handshake it did once.

The host reads the secrets the plugin needs through its own channel (`apps/desktop/AGENTS.md`, "The secret channel"): protocol `hx-host-secrets-v1`, host-only codes `hx.host.*` and `hx.secrets.*` (listed in `crates/hx-proto/errors.json`).

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
- **`session.create` from boopis:**
  - `source: "gui"`, `client: {name: "boopis", version}`;
  - `cwd`, `model`, `provider`;
  - `toolsets: ["boopis"]` (governed) or the profile's ungoverned set. A governed session is **always** created with it, including one whose mode is the plugin's default and not a choice; a `mode.set` that fails closes the new session, sends nothing to it and shows the error (the UI never runs a session whose mode it could not set);
  - `skills`.
  Never `safe_mode`, because that would skip plugin discovery and drop boopis.
- **Approvals:** canonical only, as verified in S0. The flow is event `approval.request {prompt_id, execution_generation, command, description, choices: once|deny|session|always, timeout_s}`, then `approval.respond {session_id, execution_generation, prompt_id, choice}`, then event `approval.settled`. Server requests still carry `clarify`, `secret`, `sudo`, `vault.*`, `preview.*` and `theme.*`.
- **Call rules:**
  - `prompt.submit` requires `submission_id`;
  - `session.steer` requires the `execution_generation` from an event envelope;
  - `session.mutate` takes `expected_revision` and `expected_generation`, which come from the `revision_conflict` refusal;
  - `session.create` must omit `base_url` when using a named provider.
- **Generated client:** the TypeScript client reuses `@hermes/shared`'s generated contract (`gateway-contract.generated.ts`, MIT), vendored per Hermes tag and diffed on every bump.

## 3. UI and plugin: `boopis-v1`

Methods are registered with `ctx.register_rpc(name, handler)` and appear as `plugin.boopis.<name>`. Events are sent with `ctx.emit_to_session(session_id, event, payload)` and appear as `plugin.boopis.<event>` gateway events. Gate the whole surface on the gateway capability `plugin-rpc-v1` and on `describe.capabilities`.

### Methods
| Method | Params | Result |
|---|---|---|
| `describe` | — | `{version, protocol: "boopis-v1", capabilities[], hx: {version, protocol}\|null, kernel: {ok}\|null, session?, config: {mode, cost_cap_usd, errors, ladder_errors}}` |
| `mode.set` | `{session_id, mode: "governed"\|"ungoverned", ladder?: Tier[], model?: ModelRef, gate?: {enabled}}` | `{}`. Must be called before the first `prompt.submit` of a session; later calls fail with `hx.mode.locked` (prompt caching). **[verify when system-prompt sections are evaluated]** |
| `feedforward.preview` | `{session_id, draft, cursor?}` | `{decisions: Decision[], assume: string}`. At most one model call per typing pause, which the UI debounces at 1.5 s |
| `feedforward.set` | `{session_id, key, value}` | `{}`. Applied to the next turn and written to the ledger |
| `blank.fill` | `{session_id, blank_id, answer}` | `{delivered: bool}`. Writes `blank.filled` (decided by the user), emits `blank.filled`, and hands the answer to the model with `ctx.inject_message` (Hermes's plugin context has no steering call, so it arrives as the session's next turn, and only with `allow_gateway_injection`). `delivered: false` means the model will not see it unless the client sends it as a message. Refuses (`hx.invalid_params`) a blank that is not open |
| `ledger.tail` | `{session_id, since_seq, limit}` | `{events: LedgerEvent[], head_seq}` |
| `ledger.verify` | `{session_id}` | `{ok, broken_at_seq?}` |
| `ledger.stats` | `{session_id}` | `{tokens: Usage, cost_usd, cost_api_equivalent_usd, round_trips, escalations, rollbacks, blanks, approvals, price_table}`. Costs are computed on read |
| `cascade.state` | `{session_id}` | `{task_id?, tier?, ladder: Tier[], status}` |
| `ladder.get` / `ladder.set` | `{profile}` / `{profile, ladder}` | |
| `checkpoint.list` | `{session_id}` | `{checkpoints: [{ship_id, commit, ref, files, ts, task_id?}]}`, kept ships only, oldest first (a restored ship has no checkpoint). Read off the ledger |
| `checkpoint.diff` | `{session_id, ship_id?}` | `{files: [{path, status, add, del, binary, truncated, hunks: [{header, lines}]}], truncated, base?, head?, unavailable?}`. One ship, or every kept ship together. A hunk line keeps its `' '`, `'+'` or `'-'`. `unavailable` says why there is nothing to show (folder gone, no parent commit) |
| `checkpoint.rewind` | `{session_id, ship_id}` | `{ok}`. Itself a journaled ship, so it's reversible |
| `form.submit` | `{form_id, values, provided?, session_id?}` | `{form_id, status}`. Secret fields are not in `values`: the UI saved them with the host (`secret_set`) and names them in `provided`; the plugin confirms each with the host and tells the agent `{saved, ref}` |
| `form.cancel` | `{form_id, session_id?}` | `{form_id, status}` |
| `form.list` | `{session_id}` | `{forms: [form.opened payload]}`: the open forms, for a client that reconnects |
| `mod.press` / `mod.input` / `mod.select` | `{session_id, handler, value?}` | `{handled}`. The UI never runs mod code: it answers with the handler id of the element used (`{"$handler": id}` in a `mod.render` tree). `handled: false` means the id is gone (the tree was replaced) |
| `mod.props` | `{session_id, component, id?, props}` | `{}`. The UI tells a site's props (`AbovePrompt` `isWorking`, a pane's width) and asks for a redraw |
| `mod.list` | `{session_id?}` | `{capabilities: {available, reason?, platform}, sessions: [{session_id, running, exited, plugins[], panes[], commands[], status}]}`. `available: false` says why mods are off (no sandbox, Windows) |
| `mod.unload` | `{session_id, plugin?}` | `{unloaded}`. Disables one mod, or every mod of the session: the kill switch |
| `mod.install.prepare` | `{source}` | the install prompt: `{plugin, slug, version, sha, tree_sha256, hooks[], calls[], modules[], dynamic, notes[]}`. Reads and analyses; runs nothing |
| `mod.install.confirm` | `{source, tree_sha256, cwd?}` | `{installed, slug, path, trusted_for, not_done[]}`. Copies only if the hash is the one shown, writes `lock.json`, approves the content for `cwd` |
| `bots.read` | `{}` | `{root, bots: [{name, path, record, problem, archived}]}`: every teammate's own store (`<profile>/boopis/bot.json`: look, settings, approvals) and whether it is archived. Teammates are Hermes profiles (ADR-0006); everything else about one is Hermes's `profiles.*` and `cron.manage` |
| `bots.write` | `{name, look?, settings?, approvals?}` | `{record}`. Merges into the teammate's store. Never a Hermes key; the default profile and archived teammates are refused (`hx.bots.refused`) |
| `bots.inspect` | `{name}` | `{path, bytes, files, truncated, has_sessions, memory_files, skills, boopis_bytes}`: what deleting it would remove, counted on disk |
| `bots.archive` | `{name, paused_jobs?}` | `{name, path, was}`. Hermes's `profile rename` to `archived--<name>` (nothing destroyed, the name is free); `paused_jobs` are the routines the caller paused, kept for the way back |
| `bots.restore` | `{name}` | `{name, path, paused_jobs}`. The way back; `hx.bots.exists` when the name was taken meanwhile |
| `bots.delete` | `{name, confirm}` | `{deleted, path}`. Hermes's `profile delete`; `confirm` must be the name (`hx.bots.refused` otherwise) |
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
| `form.opened` | `{form_id, kind, title, body?, schema, submit, cancel?, sensitive, origin, expires_at}` (`docs/FORMS.md` section 6). `origin` is a word or an object; a mod's is `{kind: "mod", plugin}` |
| `mod.render` | `{component, id?, kind: "tree"\|"default"\|"skipped", tree?, props?, reason?}`. A site was drawn: `tree` is the element tree as JSON (`{type, props, children}`, handlers as `{"$handler": id}`), validated against the limits (100,000 characters, 20,000 elements, depth 32). `default`: no mod drew it, keep the app's drawing (with `props` if a hook changed them). `skipped`: a mod drew something invalid, keep the app's drawing; the reason is in the mod's log |
| `mod.pane` | `{action: "open"\|"close", plugin, id, title?, focus?, closeOnEscape?, holdToasts?, rows?, columns?}` |
| `mod.toast` | `{plugin, text, timeout_ms}`. At most three show at once (the UI's rule) |
| `mod.status` | `{plugin, text}`. The mod's status line, prefixed with the mod's name; stays until changed |
| `mod.log` | `{plugin, level: "info"\|"debug"\|"warn", text}`. A quiet line the model does not read; `plugin: ""` is boopis speaking about the mods (one failed to start, one was refused) |
| `mod.command` | `{action: "register", command: "plugin:name", plugin, name, description, argumentHint, immediate}` |
| `mod.notify` | `{plugin, text, title}`. For a desktop notification, following the user's settings |
| `mod.theme` | `{action: "set"\|"clear", plugin, theme?}`. Recorded; the UI applies it later |

The shared schema of these events and the `mod.*` params is `apps/shared/data/mods.schema.json`; the plugin's tests validate what it emits against it.
| `form.resolved` | `{form_id, status: "submitted"\|"cancelled"\|"expired"}` |

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
- `sandbox.run` (`{argv, cwd, ro[], rw[], system_read, net: false|allowlist, env, timeout_ms, output_cap}`); `system_read: true` adds the platform's own system read paths, so callers never copy that list. `runtime_ro[]` is the program's own runtime (the interpreter's prefix, its virtual environment): read-only like `ro`, but vetted, since each is resolved first and refused unless it is an existing directory that is not `/`, `$HOME` or a parent of it, the working directory, or anything inside or above the working directory; is not, inside or above a credential location (`~/.ssh`, `~/.gnupg`, cloud and registry credentials, Hermes's `.env` and `boopis/`); and looks like a runtime (a `bin/` holding an executable python, node, ruby, java, go, cargo or similar, or that `bin` itself). A Python managed under the user's home (Hermes's own is) is outside the system paths; the plugin passes its roots here, and hx grants only their canonical paths. `sandbox.spawn` takes the same plus `channel`.
- `redact.apply {text} -> {text, count}`: hx-pack's redactor on free text (ADR-0016).
- `mods.capabilities`, `mods.load {session_id, plugins: [{dir, tier?}]}`, `mods.unload {session_id, plugin?}`, `mods.list`, `mods.dispatch {session_id, event, payload}` (`{answered, value, answered_by?}`), `mods.render {session_id, component, id?, props}`, `mods.press`, `mods.input` and `mods.select` (`{session_id, handler, value?}`), `mods.reach {session_id}` (what the sandboxed worker could do, tried for real) and `mods.analyze {dir}` (the hooks and `$` namespaces of a plugin, without running it). `mods.load` starts `hx mods-worker` in the sandbox; see section 4a.
- **`hx` sends requests too.** `mods.call {session_id, plugin, call, args}` goes from `hx` to the plugin, once per `$` call a mod makes; the plugin decides it (`boopis.policy.check`, the mod as principal) and answers the result, or an error with `data.code` (`hx.policy.denied`, `hx.mods.unsupported`, `hx.overloaded`, ...), which the mod sees as an `Error` with that `code`. Notifications from `hx`: `mods.diagnostic {session_id, level, plugin, message}` and `mods.exited {session_id, reason, stderr}` (the worker is gone: the session's mods must be loaded again). Request ids from `hx` are strings (`hx-<n>`); the plugin's are numbers. The schema lists these under `peer_methods`.

Cancellation uses `$/cancelRequest`. The plugin keeps one warm `hx serve` child per Hermes process and restarts it on crash, never more than 3 times a minute.

### 4a. `hx` and the mod worker: `hx-mods-v1`
One JSON object per line over a socket pair that `hx` passes to `hx mods-worker` as its only extra descriptor (`HX_MODS_FD`). Parent to worker: `{id, op: load|unload|dispatch|render|press|input|select|plugins|reach|memory, ...}` (plugin files go in `load` as a bundle: the worker cannot read them) and `{ret, ok|err}` (the answer to a `$` call). Worker to parent: `{re, ok|err}`, `{call, plugin, name, args}` (a `$` call to decide) and `{diag}`. `hx` refuses a `call` that names a mod not loaded in the session and caps a frame at 16 MiB. The worker runs one operation at a time.

## 5. Plugin and exec kernel: `hx-kernel-v1`
- **Plugin to kernel:** `cell.run {code, timeout_ms}` streams `cell.output` notifications and ends with `{status: "ok"|"error"|"cancelled"|"timeout", result_repr?, error?}`; `cell.cancel`; `kernel.reset`.
- **Kernel to plugin:** `tool.call {name, args}` goes through `ctx.dispatch_tool`; `mcp.call {server, tool, args}` goes through `ctx.call_mcp`; also `blank.open {question, options, blocks}`, `diagnostics {paths}` and `apple.*` (phase 3).
- `harness.parallel([...])` is `asyncio.gather` over `tool.call`. The plugin bounds concurrency (`exec.max_concurrency`) and counts every request of a cell against `exec.max_calls_per_cell`.
- Framing: one JSON object per line. The kernel sends `kernel.ready {protocol, pid, python, cwd, scratch}` first. `cell.run {cell_id, code, timeout_ms, output_cap_bytes, spill_cap_bytes, result_cap_bytes}` answers `{status, result_repr?, error?, output: {stdout, stderr: {bytes, shown, spill}}, execution_count, duration_ms}`; `status` `timeout` is the kernel's soft timeout (the cell was cancelled, state kept). Past the output cap, the whole stream is also written to `spill`, a file in the scratch directory. Requests also carry `cell_id`; the plugin refuses one that is not the running cell's.
- Also kernel to plugin: `sh.call {argv, command}` (judged as a `terminal` call, answers `{call_id}`) and `sh.done {call_id, status, exit, timed_out, duration_ms}` around a command the kernel runs in its own sandbox. The plugin judges the `command` string the kernel reports (`shlex.join(argv)`) with the user's `Bash` deny and ask rules; the kernel runs its own `argv`, and it is the agent's own code, so those rules are an audit trail and not a boundary for exec: the sandbox is the boundary (`plugins/boopis/AGENTS.md`, "exec"). A cell also cannot call a network tool (`web_search`, `web_extract`, `vision_analyze`, ...) through `tool.call` while `exec.network` is not `on`; `form.open {kind, title, body, schema, wait}` (a stub, see `docs/FORMS.md`).
- A plugin refusal is an error with `data.code`: `hx.policy.denied`, `hx.exec.call_limit`, `hx.exec.unsupported`, `hx.exec.invalid`.

## 6. Error codes
**Transport note** (verified on Hermes v0.23.2): an exception in a plugin RPC handler reaches the client as error `plugin_rpc_failed`, with detail `"<ExceptionClass>: <code>: <message>"`. The plugin can't set `data.code` on that path, so its handlers raise with the stable code first in the message, and clients parse it from there. `hx` and kernel errors carry `data.code` normally.

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
- `hx.hermes.incompatible`, `hx.hermes.unavailable`;
- `hx.host.*` (the host's own: `consent_required`, `unauthorized`, `invalid_frame`, `unknown_connection`, `no_ui`, `os`);
- `hx.secrets.*` (`unavailable`, `failed`, `not_found`, `invalid_ref`);
- `hx.setup.*` (`hermes_missing`, `no_bundle`, `plugin_install_failed`, `config_failed`, `declined`, `invalid_answer`, `state_invalid`, `verify_failed`);
- `hx.form.*` (`invalid_schema`, `invalid_values`, `not_found`, `resolved`, `timeout`, `secret_missing`, `unsupported`, `limit`);
- `hx.mods.*` (`unavailable`, `load_failed`, `not_a_mod`, `already_loaded`, `no_session`, `worker_failed`, `crashed`, `no_host`, `host_timeout`, `host_failed`, `unsupported`).
