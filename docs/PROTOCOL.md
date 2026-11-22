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
| `window_facts` | | `{detected: {platform, kind, desktop, evidence}, maximized, fullscreen}`: the desktop the host found once at start (`window.rs`: the compositor's variables, the session's names, a running tiling manager) and the window's state now |
| `window_control` | `{action}` | `{}`. `minimize`, `toggle_maximize`, `toggle_fullscreen` or `close` on the main window. The title bar draws close alone on a tiling manager |
| `pick_attachments` | `{kind}` | `[{path, name, kind, bytes}]` from the system's file (`file`, several) or folder (`folder`) dialog; `[]` when cancelled. `kind` is `file`, `image` or `folder` |
| `setup_check` | `{profile?}` | `{hermes_installed, needed, reason}`. Read-only: does first-run setup still have to run |
| `setup_advance` | `{profile?, answer?, reconsider}` | `{steps[], form?, done, install_command?, receipt?}`. Runs setup as far as it goes (below); `answer` is `{form_id, cancelled, values, secrets}` for the form the last call returned. Secret values travel here only to reach the keychain; the host never logs them. It never runs an installer |
| `hermes_retry` | `{profile?}` | `{}`. Asks a link that parked as `incompatible` to try again |
| `gateway_stats` | `{profile?}` | counters and p95 timings of the proxy |
| `provider_list` | `{profile?}` | `ProviderState[]`: one per way of `apps/shared/data/providers.json` (hidden ones left out) then one per endpoint the person added (`custom.<slug>`). `{provider, way, kind, status, code?, detail?, plan?, models_count?, base_url?, signin?, checked_at?}`; `status` is `connected`, `needs_key`, `signed_out`, `signing_in`, `found_local`, `not_found` or `error`, and `code` is set exactly for `error` (`hx.provider.*`, `hx.setup.*`, `hx.secrets.*`). Read-only; never dials a runtime on this computer (they answer from the last probe of this run, `not_found` with no `checked_at` before one). Errors: `hx.config.invalid`, `hx.secrets.*` |
| `provider_set_key` | `{way, key, profile?}` | `ProviderState`. Saves the key to the keychain as `secret://provider.<engine or slug>/api_key`, makes the two usual configuration writes, then checks it with one model listing. A refused or unreachable provider is in the returned state (`error`, `hx.provider.key_rejected` or `unreachable`) and the key stays saved; an error means nothing was saved. Errors: `hx.provider.unknown`, `unsupported` (a way with no key), `key_invalid` (empty, spaces, too long, or a refused prefix such as `sk-kimi-`), `hx.secrets.*`, `hx.setup.config_failed` |
| `provider_remove` | `{way, profile?}` | `ProviderState`. Removes a key way's secret and wiring, or an endpoint's whole entry. Errors: `hx.provider.unknown`, `unsupported` (a sign-in: use `provider_sign_out`), `not_found`, `hx.secrets.*`, `hx.setup.config_failed` |
| `provider_test_endpoint` | `{request: {base_url, api_mode, key?}}` | `{outcome: listed\|empty\|needs_key\|unreachable\|not_a_model_server, models[], answered_at?, status?, loopback, code?, detail?}`. One GET of `/models` then `/v1/models`; https anywhere, plain http only on this computer; never follows a redirect to another host; saves nothing. A failed dial is an outcome. Errors: `hx.provider.endpoint_invalid`, `endpoint_blocked` |
| `provider_add_endpoint` | `{request: {name, base_url, api_mode, key?, models[], discover, context_length?, request_timeout_s?, use_model?, profile?}}` | `ProviderState` of `custom.<slug>`. The slug is `custom-<name>` by the catalogue's rule (`endpoint.slug`); writes `providers.<slug>` (`base_url`, `key_env`, `api_mode`, `models`, `discover_models`) and the key wiring, and `model.provider`/`model.default` when `use_model` is set. Its models are never frontier. Errors: `hx.provider.endpoint_invalid`, `endpoint_blocked`, `endpoint_exists`, `key_invalid`, `hx.secrets.*`, `hx.setup.config_failed` |
| `provider_probe_local` | `{profile?}` | `ProviderState[]`, one per local way: `found_local` (with `base_url` and `models_count`) or `not_found`. 127.0.0.1 only, the catalogue's short timeouts, no key. Called when Settings > Models opens and on Check again, never in the background |
| `provider_use_local` | `{way, model?, profile?}` | `ProviderState` (`found_local`, its `detail` says which model). For a runtime the engine has its own provider for (LM Studio, `lmstudio`): the host asks the runtime which models it lists, then makes `model` (or the first listed) the person's model on the engine's `lmstudio` provider, with its address in `LM_BASE_URL`. Only a listed id is accepted (`hx.provider.endpoint_invalid` otherwise); no id is made up. Never frontier. The other runtimes are ordinary endpoints (`provider_add_endpoint`) and answer `hx.provider.unsupported` here. Errors: `hx.provider.unknown`, `.unsupported`, `.unreachable`, `.key_rejected`, `.no_models`, `.endpoint_invalid`, `hx.setup.config_failed` |
| `provider_signin_start` / `provider_signin_cancel` / `provider_sign_out` | `{way, profile?}` | The generic sign-in commands, mirroring `chatgpt_signin_start`, `chatgpt_signin_cancel`, `chatgpt_sign_out`: `SigninCode {verification_url, user_code, expires_at}`, `()`, `ProviderState`. The wait runs in the host and ends with the event `ProviderSigninEvent {way, outcome: signed_in\|failed\|cancelled\|timed_out, message}`. For the sign-ins the host owns: ChatGPT (OpenAI's Sign in with ChatGPT program: the host opens the browser itself, so `user_code` is empty and the page carries no token) and GitHub Copilot (a device flow: the page and the code), with xAI to follow. `provider_signin_status {way}` (added by ADR-0039's stream B2) returns the way's `ProviderState`: `connected` with the plan or the account in `detail`, `signed_out` with the reason the last sign-in ended by itself in `detail`, or `signing_in` with the page and the code; `provider_sign_out`'s `detail` says when OpenAI did not confirm ending a ChatGPT session. Errors: `hx.provider.unknown`, `unsupported`, `unreachable`, `rate_limited`, `signin_failed`, `hx.signin.*`, `hx.secrets.*` |
| `setup_set_heavy` | `{id, on, profile?}` | The models view. `id` is any `heavy_switches[].id` of `providers.json` (`fable`, `grok`, `carbon`); nothing in the host branches on an id: the switch's engines, key way, pick rule, messages and empty-ladder rule are its data row. Unchanged signature; the host's own table goes away |
| `connector_catalog` | | the curated collection (`docs/CONNECTORS.md`) as the picker shows it |
| `connector_inputs` | `{source: catalog\|url\|command, connector?, variant?}` | the form that asks for the source's inputs |
| `connector_review` | `{profile?, request: {source, values}}` | `{form, plan_hash, name}`: what an install would add, exactly. Validates; changes nothing, except that it asks Hermes how many sessions have a turn running when the install would restart it |
| `connector_install` | `{profile?, request, plan_hash, secrets, restart?: now\|when_idle}` | `{name, steps[], test, signin_needed, restarted, notes[]}`. Adds through Hermes, saves each key to the keychain, wires it, restarts Hermes if a key was given, then Hermes tests the connection. `secrets` goes to the keychain and no further |
| `connector_list` | `{profile?}` | the MCP servers Hermes has (`mcp.servers.list` and `.status`), with the keychain references boopis holds for each, never a value |
| `connector_test` / `connector_set_enabled` / `connector_remove` | `{profile?, name, ...}` | Hermes's test, `hermes config set mcp_servers.<name>.enabled`, and `hermes mcp remove` (with `delete_credentials` the user's agreement to delete the keys) |
| `connector_signin` / `connector_signin_cancel` | `{profile?, name}` | Hermes's own OAuth flow for a remote server; resolves when it ends. Hermes's token store holds the result |
| `connector_login` | `{provider, connector?}` | the host's own sign-in for a provider id in its table (`apps/shared/data/logins.json`, or the named collection entry's reviewed `login`), run as a program and an argument vector, never a shell; an id outside the table is refused. `{command_line, ok, code, timed_out, output[]}` |

The host reconnects on gateway restarts (after `code_sha` mismatch, idle exit or crash) and replays with `session.events.since` using `seq` and `replay_epoch`. The UI sees host-made `event` frames (type namespace `connection.`, never from the gateway): `connection.state` (`payload.state`: `connecting`, `ready`, `degraded` or `incompatible`; `reconnected: true` after a loss), `connection.replay_gap` (`payload.session_id`: the replay buffer was truncated, reload that transcript), `connection.open_requests` (envelope `session_id`; `payload.open_requests`: the server requests Hermes still has open for that session, copied from the replay's answer unchanged, after the replayed events and only when there are some), and `connection.backpressure` (`payload.coalesced`: `message.delta` frames were merged because the window fell behind). The same state is a typed `ConnectionStateEvent`. A window's `client.capabilities` and `runtime.describe` are answered by the host from the handshake it did once.

The host reads the secrets the plugin needs through its own channel (`apps/desktop/AGENTS.md`, "The secret channel"): protocol `hx-host-secrets-v1`, host-only codes `hx.host.*` and `hx.secrets.*` (listed in `crates/hx-proto/errors.json`).

## 1a. The store: host commands

The store (`docs/STORE.md`, ADR-0038) is a host feature: the host is the only layer that fetches from the network and verifies bytes. Every command validates its input as untrusted and fails with `{code, message}`. Shapes are in `apps/shared/data/store.schema.json` (`StoreItem`, `InstallPlan`, `InstallReceipt`, `UpdateDiff`, `StoreSource` and the rest); `profile` is the bot (an engine profile), as in the connector commands, and defaults to the attached one. Browse, search, detail and sources read the local cache and work offline. Nothing a command returns holds a secret.

| Command | Request | Response and errors |
|---|---|---|
| `store_catalog_list` | `{filter?: StoreFilter, cursor?: string, limit?: number}` | `StoreBrowse`: a page of the cache; `recommended` on the first page of an unfiltered call. Reads only; never fails for lack of a network (`offline` and `stale` say so) |
| `store_search` | `{query, filter?, cursor?, limit?}` | `StoreBrowse`, ranked. Local: no query leaves the machine |
| `store_refresh` | `{source?: string}` | `StoreSource[]` as they are after. Reads the sources again (all, or one). `hx.store.offline`, `hx.store.source_unreachable`, `hx.store.rate_limited`, `hx.store.too_large` |
| `store_item_detail` | `{id, profile?}` | `StoreDetail`: the item, its receipt if installed, the pending update, the governed note and cost from the catalogue. `hx.store.not_found` |
| `store_stage` | `{id, profile?}` | `StageResult`. Fetches the catalogue's pin into staging, verifies it, unpacks within the caps, hashes the tree, scans; nothing runs. For an installed item with a newer pin it stages the new pin (the first step of an update). `hx.store.not_found`, `removed`, `unpinned`, `offline`, `source_unreachable`, `rate_limited`, `digest_mismatch`, `too_large`, `unsafe_archive`, `dangerous_verdict`, `kind_unsupported`, `invalid_manifest` |
| `store_plan` | `{stage_id, scope?: StoreScope, profile?}` | `InstallPlan`, with its `plan_hash`. Asks the owning layer for its half (5.9), asks the engine how many sessions have a turn running, changes nothing. `scope` defaults to the installed scope, else `bot` for `profile`. `hx.store.stage_missing`, `dangerous_verdict`, `kind_unsupported`, `invalid_manifest` |
| `store_install` | `{request: InstallRequest, profile?}` | `InstallReceipt`. The hold has happened: `request.plan_hash` is the plan the user saw. The host rebuilds the plan and refuses if it differs; `request.secrets` go to the keychain and no further. `hx.store.plan_changed`, `stage_missing`, `already_installed`, `governed_refused`, `dangerous_verdict`, `install_failed`; for a connector also `hx.connectors.secret_missing`, `restart_choice`, `busy`, `exists`, `rejected` |
| `store_uninstall` | `{id, delete_credentials?: bool, profile?}` | `UninstallResult`. `delete_credentials` is the user's agreement to delete the item's keys from the keychain; without it they stay and are listed in `kept_secrets`. `hx.store.not_installed`, `install_failed` |
| `store_installed` | `{profile?}` | `InstallReceipt[]`: the merge of the host's record and the plugin's (`plugin.boopis.store.list`). When the engine is down the plugin's part is absent and a note says so |
| `store_update_check` | `{id?: string, profile?}` | `UpdateDiff[]`: one per installed item whose catalogue pin changed, was removed, or lost its pin. Refreshes the catalogue first when online; offline it diffs against the cache and says so. Installs nothing. `hx.store.not_installed` (with `id`) |
| `store_update` | `{id, request: InstallRequest, profile?}` | `InstallReceipt`. The install flow on the new pin after `store_stage` and `store_plan` and a hold; keeps the previous version one step back. Same errors as `store_install`, and `hx.store.not_installed` |
| `store_rollback` | `{id, profile?}` | `InstallReceipt` of the kept version. Atomic; trust is re-checked. `hx.store.not_installed`, `no_previous`, `install_failed` |
| `store_set_enabled` | `{id, enabled, profile?}` | `{}`. Switches an installed item on or off for the bot; it takes effect in the next session (a connector through the connector flow's switch; a plugin, mod, skill the plugin installed or engine plugin through `plugin.boopis.store.set_enabled`, which asks the engine's own `plugins enable` or `plugins disable` and updates the plugin's record). A skill from the engine's hub has no switch of its own: `hx.store.kind_unsupported`, remove it instead. `hx.store.not_installed`, `removed` (a taken-down item stays off), `install_failed`. The installed screen's switches use it |
| `store_sources` | `{}` | `StoreSource[]` with their state (`enabled`, `refreshed_at`, `items`, `error`) |
| `store_source_set_enabled` | `{id, enabled}` | `{}`. `hx.store.invalid_source` for an unknown id |
| `store_source_add` | `{url?: string, path?: string, label?: string}` | `StoreSource`. A marketplace address, a git repository (a GitHub URL included) or a local folder or file; the host validates it, reads it once and refuses what it cannot parse. `hx.store.invalid_source`, `source_unreachable`, `too_large`, `unsafe_archive`, `invalid_manifest` |
| `store_source_remove` | `{id}` | `{}`. Only a source the user added; its items go from the cache, installed items stay. `hx.store.invalid_source` |

The host stages in `<app data>/store/staging/<id>/{meta.json, tree/}`; the plugin is given `tree/`. `store_update`'s `id` is checked against the staged item. The UI's `store.review` is `store_stage` then `store_plan`; its `install` is `store_install`, and `store_update` for an update. A project's switch is not a host command: it is the plugin's (below), read and set over the gateway.

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
- **Approvals:** canonical only, as verified in S0. The flow is event `approval.request {prompt_id, execution_generation, command, description, choices: once|deny|session|always, timeout_s}`, then `approval.respond {session_id, execution_generation, prompt_id, choice}`, then event `approval.settled`. Server requests still carry `clarify`, `secret`, `sudo`, `vault.*`, `preview.*` and `theme.*`: JSON-RPC requests from the gateway with an `srq-` id, answered by a response frame (`{id, result}`) and withdrawn by the event `request.cancel {id, method, reason}`. The UI answers `secret`, `sudo`, `vault.unlock_prompt`, `vault.save_login` and `vault.code` (`result: {value}`, empty for skipped; `docs/FORMS.md` section 6) and refuses the rest.
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
| `cascade.start_tier` | `{session_id, start_tier: string\|null}` | `{}`. Where the next governed task starts on the ladder (a tier name; `null` is the configured start). Allowed after the first prompt, unlike `mode.set`: it is read when a task is dispatched and does not touch the cached prompt. The UI's pick and Smart choice use it (ADR-0032); the gate still escalates past it. An unknown tier is `hx.invalid_params` with the tiers |
| `mode.once` | `{session_id, armed?: boolean = true}` | `{armed: boolean}`. The next orchestrator turn of a *governed* session runs outside governed mode, for that turn only (ADR-0036: the owner's "@ in governed mode can turn off governed mode for that message"). The mode and toolsets are fixed at the first prompt and stay fixed; this arms one turn. It resets itself when the turn ends (completed, failed or interrupted), lapses after 120 s unused, and `armed: false` withdraws it. An ungoverned session answers `armed: false`. The turn is two `mode.changed` ledger events with `scope: turn` |
| `turns.bind` | `{session_id, row_ids: int[], user_row_id?: int, council?: {members: [{model, state, text, cut?}], combiner}, children?: [{model, goal, status, summary, child_session_id, tool_count, duration_ms, cut?}]}` | `{recorded: boolean}`. The turn that just completed is these stored rows (`message.complete.persisted_turn`): the plugin writes the model (and tiers) it saw answer it. `recorded: false` when it saw no request for it. `council` and `children` are what the turn showed beyond its answer (ADR-0035, ADR-0034): bounded (member text 6000 characters, summary 1500, goal 400, 12 members, 20 cards; a cut is `cut: true`), a failed member keeps its state word only, a malformed one is left out |
| `turns.models` | `{session_id}` | `{turns: [{model: "provider/model", route: string[], ungoverned: boolean, user_row_id, row_ids: int[], turn_id, at, council?, children?}]}`, oldest first (`council` and `children` as in `turns.bind`, absent on a turn that showed none). A resume reads it to say which model answered each past turn; a turn not listed is unknown |
| `dispatch.roster` | `{models: [{provider, model}]}` | `{aliases: [{alias, provider, model}]}`. The models the user can use now, in the order he prefers them (ADR-0034). The plugin keeps them for the process and builds the enum of `delegate_task`'s `target` from them (shared names table `apps/shared/data/model-names.json`; each model also answers to its own id). Not session-bound. Call it before `session.create` and `session.resume`: a session's tools are fixed when they are built, so a model signed in later is named by the next session |
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
| `bots.guide` | `{name}` | `{skill, version, written}`. Puts the hand-off skill (`boopis-handoffs`, how to use the kanban board: list first, `idempotency_key`, `parents`) in the teammate's `skills/`; idempotent, a file of that name that boopis did not write is left alone; archived or default: `hx.bots.refused` |
| `bots.inspect` | `{name}` | `{path, bytes, files, truncated, has_sessions, memory_files, skills, boopis_bytes}`: what deleting it would remove, counted on disk |
| `bots.archive` | `{name, paused_jobs?}` | `{name, path, was}`. Hermes's `profile rename` to `archived--<name>` (nothing destroyed, the name is free); `paused_jobs` are the routines the caller paused, kept for the way back |
| `bots.restore` | `{name}` | `{name, path, paused_jobs}`. The way back; `hx.bots.exists` when the name was taken meanwhile |
| `bots.delete` | `{name, confirm}` | `{deleted, path}`. Hermes's `profile delete`; `confirm` must be the name (`hx.bots.refused` otherwise) |
| `compat.inventory` | `{cwd}` | `{items: CompatItem[], trust: TrustState}` |
| `trust.set` | `{cwd, decision: "trust"\|"deny", content_hash}` | `{}` |


### The store's plugin RPCs

The plugin owns plans, trust, locks and records for Claude plugins, mods, skills that are not from the engine's hub, and the store's record for engine plugins (`docs/STORE.md` 5.9). Capability `store-v1` in `describe.capabilities`. The host calls these over its own gateway link while it runs a store install (as it drives `mcp.servers.*` for a connector); the UI calls only `store.policy.*`. Paths are staging folders the host made under `<app data>/store/staging/`: the plugin refuses a `staged_dir` that is not a directory, holds a link that leaves it, or whose recomputed `tree_sha256` differs from the one passed (`hx.store.plan_changed`). Errors are the `hx.store.*` codes; the plugin raises them as the transport note in section 6 describes.

| Method | Params | Result |
|---|---|---|
| `store.prepare` | `{kind: "skill"\|"plugin"\|"mod"\|"engine-plugin", item_id, source, pinned: StorePin, tree_sha256, staged_dir?, scope: StoreScope, cwd?, entry_source?, engine?: {capabilities, halves, scan}}` | `PluginPlan`. Reads and analyses; runs nothing and writes nothing. For `skill`, `plugin` and `mod`: `staged_dir` is required, and the plan lists components, hook commands with script hashes, MCP entries, agents, modules (a mod through `hx mods.analyze`), the files it would write under `<bot home>/boopis/compat/plugins/<slug>/`, and the consent items. For `engine-plugin`: no `staged_dir` (the engine fetches); `engine` carries what the engine's `inspect` read, and the plan is the governed policy (the project's switch, the warnings that it runs in the engine, outside the sandbox) and the consent items. Refuses a `command` source, an `archive` without a sha256, and an npm package that would run install scripts (`hx.store.unpinned`, `kind_unsupported`); `invalid_manifest`; `dangerous_verdict`. `entry_source` is the marketplace entry's `source` exactly as the host read it, when the item came from a marketplace: the plugin refuses an unpinnable one and a `pinned` that is not the pin the entry gives (`digest_mismatch`). The `plan` holds no time and no staging path, so `prepare` and `confirm` hash alike; `engine`'s capabilities and scan are the engine's `inspect` words, and a `dangerous` engine scan is refused |
| `store.confirm` | `{kind, item_id, source, pinned, tree_sha256, staged_dir?, plugin_hash, plan_hash, scope, cwd?, engine?: {name, version, path, enabled}}` | `{receipt: InstallReceipt}`. `plugin_hash` is the `PluginPlan`'s; the plugin rebuilds the plan and refuses with `hx.store.plan_changed` if it differs. `skill`, `plugin`, `mod`: copies the staged tree (symlinks off, re-hashed after the copy: what lands is what was shown), writes `lock.json`, keeps the previous version one step back, approves the content for `cwd` when the scope is `bot-project`. `engine-plugin`: called after the engine reported the install (`engine`); records the receipt and the previous pin. `plan_hash` (the host's) goes into the receipt only. An engine plugin's `confirm` carries the engine's report, not `inspect`'s, so the plugin cannot rebuild the plan: it accepts only the `plugin_hash` it issued in this process for that pin (`hx.store.plan_changed` otherwise, review again). `scope.level` `bot-project` for a plugin with hooks in a project whose switch is on is `governed_refused`; the same install for the bot alone is allowed. `hx.store.plan_changed`, `already_installed`, `governed_refused`, `install_failed` |
| `store.uninstall` | `{item_id, kind, cwd?}` | `UninstallResult`. `skill`, `plugin`, `mod`: removes the install folder, the lock and the trust records. `engine-plugin`: drops the plugin's record after the engine removed the plugin. `hx.store.not_installed` |
| `store.set_enabled` | `{item_id, kind, enabled: boolean, cwd?}` | `{receipt: InstallReceipt}`. Asks the engine's own `plugins enable` or `plugins disable` for the plugin (an engine plugin by its name), then records it. A refusal by the engine changes nothing (`hx.store.install_failed`); an item on the kill list cannot be switched on (`hx.store.removed`); `hx.store.not_installed`. Takes effect in the next session |
| `store.diff` | `{item_id, kind: "skill"\|"plugin"\|"mod", staged_dir, tree_sha256, pinned}` | `UpdateDiff`: the component diff of the installed lock against the staged tree: new hooks, servers, modules, hosts and secrets called out, `widened` set. An engine plugin's diff is the engine's own `delta` (`plugins.manage update` with `accept_capabilities`), mapped by the host. `hx.store.not_installed` |
| `store.rollback` | `{item_id, kind, cwd?}` | `{receipt: InstallReceipt\|null, reinstall: StorePrevious\|null}`. `skill`, `plugin`, `mod`: swaps to the kept version atomically and re-checks trust. `engine-plugin`: the engine keeps no earlier copy, so `receipt` is null and `reinstall` is the previous pin for the host to put through the review again. `hx.store.not_installed`, `no_previous` |
| `store.list` | `{cwd?}` | `{items: InstallReceipt[], kill_listed: string[]}`: what the plugin installed or recorded for this bot, and which of them are on the kill list |
| `store.removed.set` | `{removed: [{id, reason, by}]}` | `{flagged: string[]}`. The host pushes the merged kill list; installed items on it are flagged and switched off at the next session |
| `store.policy.get` | `{cwd}` | `ProjectPolicy`. The project's "no engine plugins and no plugin hooks" switch |
| `store.policy.set` | `{cwd, block: boolean}` | `ProjectPolicy`. Writes the project's explicit choice. `governed` in `ProjectPolicy` is the bot's default mode (the plugin's `mode` setting); a session's own mode decides its refusal. With the switch on, the project's Claude plugin hooks are inert and a governed session whose bot has an enabled engine plugin is refused at its first prompt with `hx.store.governed_refused` (`docs/STORE.md` 5.8) |

### The delegation backend (`delegation.backend: boopis`)
`delegate_task` gains one per-task parameter, `target` (ADR-0034), an enum of the roster's words. Routing: a cascade launch (`dispatch`) is routed by the ledger's tier, as before; in a governed session anything else is refused; in a session that is not governed, a task with `target` runs on that word's provider and model **only if the message that started the turn (`pre_llm_call` `user_message`) wrote that word**. Refusals reach the model as the tool error: not named, unknown (with the available words), no `target`, no active turn. The child runs in parallel with a fresh context (`goal`, `context`); the parent's events are the engine's `subagent.*` frames, `subagent.interrupt` stops one and `session.transcript` reads the child's session.

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
| `mod.toast` | `{plugin, text, timeout_ms}`. The UI shows one at a time, queued in order, with a quiet "+N" while others wait (owner decision, 19 November 2026) |
| `mod.status` | `{plugin, text}`. The mod's status line, prefixed with the mod's name; stays until changed. Empty text clears it |
| `mod.log` | `{plugin, level: "info"\|"debug"\|"warn", text}`. A quiet line the model does not read; `plugin: ""` is boopis speaking about the mods (one failed to start, one was refused) |
| `mod.command` | `{action: "register", command: "plugin:name", plugin, name, description, argumentHint, immediate}` |
| `mod.notify` | `{plugin, text, title}`. For a desktop notification, following the user's settings |
| `mod.theme` | `{action: "set"\|"clear", plugin, theme?}`. Recorded. The UI offers a `set` as a card ("Apply name's colours?") that previews the colours live; Keep commits them, Reject, Esc, closing or hiding the card, or choosing another theme restores the previous theme |

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
- `mods.capabilities`, `mods.load {session_id, plugins: [{dir, tier?, limits?: {heap_mib?, event_budget_ms?, lifetime_s?}}], replace?}` (`{loaded: [{name, dir, tier, modules, hooks, generation, pid?, expires_in_s?, running}], failed: [{dir, plugin?, code, message}]}`: each mod gets a worker of its own, and a mod that does not load is in `failed` without stopping the others; `replace` starts a new worker for a running mod before the old one is stopped), `mods.unload {session_id, plugin?}`, `mods.list`, `mods.dispatch {session_id, event, payload, plugin?}` (`{answered, value, answered_by?}`; `plugin` runs the event through that mod's hooks only), `mods.render {session_id, component, id?, props}` (`{kind, tree?, props?, reason?, plugin?}`: `plugin` is the mod whose hook drew it, the first to answer; absent for `default`), `mods.press`, `mods.input` and `mods.select` (`{session_id, handler, value?}`), `mods.reach {session_id, plugin?}` (what a sandboxed worker could do, tried for real) and `mods.analyze {dir}` (the hooks and `$` namespaces of a plugin, without running it). `mods.load` starts one `hx mods-worker` per mod in the sandbox; see section 4a.
- **`hx` sends requests too.** `mods.call {session_id, plugin, call, args}` goes from `hx` to the plugin, once per `$` call a mod makes; the plugin decides it (`boopis.policy.check`, the mod as principal) and answers the result, or an error with `data.code` (`hx.policy.denied`, `hx.mods.unsupported`, `hx.overloaded`, ...), which the mod sees as an `Error` with that `code`. Notifications from `hx`: `mods.diagnostic {session_id, level, plugin, message}` and `mods.exited {session_id, plugin, generation, cause: "ceiling"|"crash", reason, stderr}` (one mod's worker is gone; the other mods are not touched, and the mod keeps its place in the chain, so `mods.load` for it puts a new worker there. A worker that `replace` or `mods.unload` stopped on purpose is not reported). Request ids from `hx` are strings (`hx-<n>`); the plugin's are numbers. The schema lists these under `peer_methods`.

Cancellation uses `$/cancelRequest`. The plugin keeps one warm `hx serve` child per Hermes process and restarts it on crash, never more than 3 times a minute.

### 4a. `hx` and the mod worker: `hx-mods-v2`
One worker per mod. One JSON object per line over a socket pair that `hx` passes to `hx mods-worker` as its only extra descriptor (`HX_MODS_FD`; its limits are in `HX_MODS_LIMITS`). The event chain runs in `hx`, across the workers; a worker runs one mod's hooks.
- **Parent to worker:** `{id, op: load|plugins|memory|reach, ...}` (plugin files go in `load` as a bundle: the worker cannot read them), `{op: invoke, m: {frame, hook, kind, e, budget, event, tier, site, run, failure?}}` (run one hook; no reply, its outcome comes as `ev` frames), `{op: next_done, frame, call, value}`, `{op: abort, frame, message}`, `{op: commit, site, ok, tokens}`, and `{ret, ok|err}` (the answer to a `$` call).
- **Worker to parent:** `{re, ok|err}`, `{ev: reg|catch}` (a hook was registered), `{ev: settled, frame, status: ok|nomatch|threw|timeout, value?, tok?, error?}`, `{ev: next, frame, call, e, tier?}` (the hook called `next`), `{ev: tick, id}` (a `clock.every` timer fired), `{call, name, args}` (a `$` call to decide) and `{diag}`.
- A worker is bound to one mod: `hx` stamps that name on every `call` itself, so a worker cannot speak for another mod. A frame is capped at 16 MiB. Hooks of one mod run concurrently inside its worker (a hook waiting on `$.ui.ask` does not stop the next one); each hook's budget is charged only for the time it runs, not while it waits for `next` or the host. The budget, the heap limit and the sandbox's lifetime are per worker.

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
- `hx.engine.incompatible`, `hx.engine.unavailable`;
- `hx.host.*` (the host's own: `consent_required`, `unauthorized`, `invalid_frame`, `unknown_connection`, `no_ui`, `os`);
- `hx.secrets.*` (`unavailable`, `failed`, `not_found`, `invalid_ref`);
- `hx.connectors.*` (`exists`, `not_found`, `rejected`, `plan_changed`, `secret_missing`, `plugin_owned`, `restart_choice`, `busy`, `unknown_login`, `not_oauth`, `signin_failed`, `signin_cancelled`, `signin_timeout`, `command_failed`, `failed`);
- `hx.store.*` (`unpinned`, `digest_mismatch`, `plan_changed`, `source_unreachable`, `too_large`, `unsafe_archive`, `dangerous_verdict`, `kind_unsupported`, `governed_refused`, `not_installed`, `offline`, `not_found`, `already_installed`, `removed`, `invalid_source`, `invalid_manifest`, `stage_missing`, `no_previous`, `rate_limited`, `install_failed`);
- `hx.setup.*` (`hermes_missing`, `no_bundle`, `plugin_install_failed`, `subscription_unavailable`, `config_failed`, `declined`, `invalid_answer`, `state_invalid`, `verify_failed`);
- `hx.provider.*` (`unknown`, `unsupported`, `key_invalid`, `key_rejected`, `unreachable`, `no_models`, `not_a_model_server`, `endpoint_invalid`, `endpoint_blocked`, `endpoint_exists`, `not_found`, `not_installed`, `needs_update`, `metered`);
- `hx.form.*` (`invalid_schema`, `invalid_values`, `not_found`, `resolved`, `timeout`, `secret_missing`, `unsupported`, `limit`);
- `hx.mods.*` (`unavailable`, `load_failed`, `not_a_mod`, `already_loaded`, `no_session`, `worker_failed`, `crashed`, `no_host`, `host_timeout`, `host_failed`, `unsupported`).
