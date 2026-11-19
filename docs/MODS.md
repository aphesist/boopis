# Mods

Status: plan, 2026-11-19; **M0 (spike) and M1 (backend) done** (sections 8 and 9). Evidence: `docs/research/mods.md` (Claude Code's mod docs). Decision: ADR-0022.

**Rule: a Claude Code mod installs and runs unchanged, and everything it draws is drawn by our design system, so it looks native.** A mod's behaviour runs wherever the session runs: the desktop app, plain Hermes on the command line, or a cloud session. It draws only where there's a screen, which is Claude Code's own model.

A Claude Code mod is a plugin whose `hooks/hooks.json` names a JavaScript or TypeScript module. That module registers hooks on Claude Code's events, calls the `$` API (interface, themes, commands, tools, prompts, turns, files, network, state), and draws **element trees** (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Link`, `Svg`, …) into surfaces: panes, a band above the prompt, toasts, a status line, transcript rows, a backdrop, and Claude Code's own message views. No public spec exists for running mods outside Claude Code, so boopis implements the API, the event chain and the renderer from the docs, and keeps a conformance suite against real mods.

## 1. Architecture
- **Install:** a mod is a plugin, so it installs through COMPAT §9: pinned to a commit, hash-locked, with an install prompt. A `modules` key in `hooks/hooks.json` marks it as a mod. Before consent, the install prompt lists the mod's hooks and the `$` namespaces it calls, found by static analysis as `claude plugin validate` does.
- **Runtime: `hx-mods`**, a library in the `hx` binary.
  - It embeds a JavaScript engine and a TypeScript/JSX transform, so `.ts` and `.tsx` modules load with no build step.
  - A session's mods share one worker and one QuickJS runtime, as in Claude Code's single hooks worker, but **each mod has its own context**: no object is shared between mods, and the chain runs in a context of its own that no mod code reaches (section 9).
  - The worker is an `hx mods-worker` process inside `hx-sandbox`, with no file, network or process access. The only way out is `$`, as a request to the plugin.
  - The engine is QuickJS-NG through `rquickjs`, with `oxc` for the transform, as spike M0 proved (section 8).
- **Each `$` call** is a request from `hx` to the plugin (`mods.call`). The plugin decides it with `boopis.policy.check`, then performs it through Hermes, the host or the store. There is one table of calls and one implementation each.
- **Events:** the plugin maps Hermes's hooks and the gateway's events onto mod events, through the same bridge as Claude Code's hooks (COMPAT §4). There is one bridge for both.
  - `tool.check` and `tool.call` map to `pre_tool_call` and its result.
  - `prompt.*`, `turn.*` and `session.*` map to the gateway's prompt, turn and session events.
  - `command.run` maps to slash commands (COMPAT §5.1).
- **The chain** follows the docs exactly:
  - tiers (built-in guard, `prependPlugins`, user mods with dependencies first, `appendPlugins`);
  - `next`, `next.to`, `.catch`;
  - frozen events;
  - budgets (10 s per event, 50 ms for `prompt.edit`, 1 s for `.catch`);
  - three crashes unload every user mod.
- **`e.surface` is `desktop`.** Mods take their Desktop path, which suits a desktop renderer. In headless sessions, as with `claude -p`, hooks run and nothing draws.
- **Version:** boopis states which Claude Code mods version it implements. The conformance table (§7) maps each gated feature ("requires v2.1.xxx") to supported, partial or not yet.

## 2. One renderer: the design system
- **Transport:** element trees travel from the plugin to the UI as data, through session events. Handlers (`onPress`, `onSubmit`, `onSelect`, `onInput`) become ids, and the UI answers with `ui.press`, `ui.input` and `ui.select` events. The UI never runs mod code.
- **One component, `hx-mod-view`,** maps each element onto the v6 library:

| Element | Drawn as |
|---|---|
| `Box` | a layout container on the spacing scale. Borders use the hairline token, and `backgroundColor` uses surface tokens |
| `Text` | the type scale. `mono` uses IBM Plex Mono and `tabular` uses tabular figures |
| `Button` | the library's button. `variant` and `role` map to its variants. A `hotkey` that collides with the app's keymap is dropped, never stolen |
| `Input`, `Select` | the form fields from FORMS.md (the same implementation) |
| `Markdown`, `Code` | the session's own markdown and code renderers |
| `Link` | `https:` only, opened in the system browser through the host |
| `Svg` | sanitised inline SVG: no scripts, no `foreignObject`, no external references |
| `Client` | an isolated iframe (no same origin, strict CSP) that talks through `postMessage` as `ui.message`. Phase M2 |
| `Raster`, `Image` | terminal-only in Claude Code; phase M2 |

- **Colours look right:**
  - Claude Code's theme keys and colour names map onto semantic tokens: `claude` to the accent, `success` to ok, `error` to danger, `warning` to warn, `subtle` and `inactive` to the quiet text, `text` to text, the `diff*` keys to the diff tokens, and `'red'`, `'green'` and the other names to their semantic tokens.
  - A literal hex colour, for example in a mod's chart, is drawn as given if it has enough contrast on our surface. Otherwise the nearest token is used.
  - Default text and backgrounds always come from the active theme, so a mod follows light, dark and every preset.
- **Limits** follow the docs: 100,000 characters drawn, 20,000 elements, depth 32, and the per-prop caps. A tree that fails validation is skipped, the site falls back to our own drawing, and the mod gets a log line, as in Claude Code.

## 3. Where each surface lands
| Mod surface | In boopis |
|---|---|
| Pane (`$.ui.open`) | a pane in the details panel, as its own tab (`placement: 'dock'`). In narrow windows, inline above the composer (`'inline'`). Our breakpoints replace the terminal column rules |
| Band above the prompt | a band above the composer, one collapsible row per mod (`AbovePrompt`, `AbovePromptList`) |
| Transcript row (`$.ui.place`) | a row in the conversation, gone on clear, rewind or compaction, and not kept on resume, as in Claude Code |
| Toast | the app's notices, at most three at a time |
| `$.ui.status` | the session's status line under the composer, prefixed with the mod's name |
| `$.ui.log` | a quiet line in the conversation that the model doesn't read |
| `$.ui.notify` | a desktop notification through the host, following the user's notification settings |
| `$.ui.ask` | a `choice` form (FORMS.md) with a new origin kind, `{kind: mod, plugin}` |
| Backdrop | behind the conversation, under the scrim |
| `$.theme.set({ colors })` | a theme layer. The mod's anchors go through our ramp generator into tokens. A card offers to keep it or reject it; one mod at a time, as in Claude Code |
| Terminal themes (`themes/*.json`) | importable as boopis themes: each token maps onto our semantic tokens |
| Redraw sites | each maps to one of our components: `UserMessage` and `AssistantMessage` to messages; `ToolUse`, `ToolResult` and `ToolGroup` to tool rows; `Spinner` to the working indicator; `TurnDuration` to the turn footer; `InfoNotice` to notices; `SessionMode` to the mode chip; `PromptHint` to the composer hint; `CommandOutput` to the command block. A prop change applies to the documented props; a replacement tree draws inside the component's slot. `AskUserQuestion` keeps our question card (as VS Code does). Approval cards and forms are never redrawable, matching Claude Code's permission prompt |
| `$.command.register` | slash commands in the composer's `/` list and the palette, namespaced `plugin:name` |
| `$.tool.register` | model tools `mcp__<plugin>__<name>`, decided by the policy. Toolsets are fixed at `session.create` (prompt caching), so a tool registered later is offered as deferred, or appears in the next session |
| `outputStyles` | a system prompt section fixed at `session.create`. Phase M2 |
| The `statusLine` setting | the command runs with the documented JSON, filled from what the session knows (model, cost computed from the ledger, context window, workspace, session). Its ANSI colours map to tokens in the status line. Phase M1 |

## 4. Security: compatible, and stricter than Claude Code
- In Claude Code a mod runs with the user's permissions, and its `$` calls can skip permission rules and hooks. Here they can't. `$.fs`, `$.http`, `$.process`, `$.mcp` and `$.model` calls are capability decisions (AUTOMATION.md) with the mod as the principal:
  - grants are per mod;
  - an ask becomes a `permission` form;
  - the ledger records each call as `tool.called` with the tool `mod:<plugin>/<call>`.
- The isolate has no file, network or process access of its own (`hx-sandbox`).
- Mods can't redraw approval cards or forms, can't draw outside their surfaces, and can't put HTML or scripts in a tree. `Client` runs in an isolated iframe.
- In governed mode, `turn.step` model changes are refused: the plugin chooses models (AGENTS invariant 2). Mods can observe tool calls; they can change them only within what the policy allows.
- Kill switches: disable per mod; turn all mods off; safe mode starts with none.

## 5. Build order
| Phase | Work |
|---|---|
| M0 spike | **Done, 2026-11-19** (section 8). The runtime choice. Run three mods we write (a pane with state and a clock, a command, a band) through `hx-mods`. Measure isolate start (budget 50 ms), per-event overhead (budget 1 ms) and memory |
| M1 | **Done, 2026-11-19 (section 9).** Runtime and chain. The core of `$`: `plugin`, `ui` (`open`, `close`, `invalidate`, `toast`, `status`, `log`, `notify`, `ask`), `state`, `store`, `clock`, `command`, `config`, `env`, `theme`. The renderer for `Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Link` and `Svg`. Surfaces: pane, band, toast, status, log and ask. Theme mapping, the `statusLine` setting, and the install flow |
| M2 | (`tool.check`, `tool.call` and the events were pulled forward into M1; `tool.register` is not done.) `tool.register`. `prompt.*`, `turn.*` and `session.*`. `fs`, `http`, `process`, `mcp` and `model` through the policy. Redraw sites, placed rows, backdrop and `Client` |
| M3 | Conformance. Public mods from marketplaces as pinned fixtures, a runner compatible with `claude plugin test`, and the feature table per Claude Code version |

## 6. Design work for the owner
The owner designs the new surfaces in v6 before the port, as with forms:
- the band above the composer;
- a mod pane tab in the details panel;
- the mod status line;
- the mod origin in cards and forms;
- placed rows.
Everything else reuses existing components.

## 7. Open questions
- **The licence of Claude Code's `claude-code.d.ts`.** If it isn't permissive, our types are written from the docs and nothing is copied. **[verify]**
- **Desktop colour anchors** beyond `surface-0`, `text-primary` and `text-muted`, which are not on a public page. **[verify]**
- **Strict permissions:** how often real mods expect unrestricted `$.fs` or `$.process`, and how the asks feel. The M3 conformance suite answers this.
- **Reporting `surface: 'desktop'`:** check against popular mods that this gives the best result.

## 8. Spike M0 result (2026-11-19)
`crates/hx-mods` runs the three example mods (`tests/mods/`: a pane with state and a clock, a command, a band) from disk, in `.ts`, `.tsx`, `.mts` and `.jsx`, with no build step. It is a library with tests, not wired into `hx`.

**Engine decision: QuickJS-NG through `rquickjs` 0.14, with `oxc` 0.158 for TypeScript and JSX.**

| Option | Evidence | Verdict |
|---|---|---|
| QuickJS-NG (`rquickjs`) | ES modules, promises, async; `set_interrupt_handler` gives a wall-clock budget per hook; `set_memory_limit` and `set_max_stack_size` make an overrun throw inside the hook. Its build compiles `quickjs.c`, `libregexp.c`, `libunicode.c` and `dtoa.c` only (no `quickjs-libc.c`), so there is no `std` or `os` module to remove. Isolate start 1.8 ms, about 260 KiB of heap | chosen |
| Boa 0.22 (pure Rust) | Read in its source: `RuntimeLimits` holds a loop-iteration limit, a stack-size limit and a recursion limit. No wall-clock interrupt and no heap limit, so a hook cannot be held to a time budget (a loop limit counts iterations, not milliseconds) or a memory budget. Not built or measured here | rejected: two of the four requirements are missing |
| V8 (`v8` crate 152.2) | Termination and heap limits are known V8 features, not exercised here. Its prebuilt static library is a 39.8 MB gzip download (the release asset's `Content-Length`), against a 4.35 MiB delta for this crate. Not built here (disk) | rejected on size and build weight; the right answer if mods ever need JIT speed |
| `swc`, or a JavaScript transform run inside the isolate | Not evaluated | `oxc` was enough: 7 to 14 microseconds per example file |

Measured in a release build, 4 cores of a 2.1 GHz Xeon, `cargo test -p hx-mods --release --test perf -- --ignored --nocapture`:

| What | Budget | Measured (median, p95) |
|---|---|---|
| Isolate start | | 1.81 ms, 1.89 ms |
| Load the three example mods (read, transform, evaluate, `register`) | | 0.85 ms, 0.96 ms |
| **Start plus load** | **50 ms** | **2.67 ms, 2.85 ms** |
| Event with no hook | | 7.5 us, 8.2 us |
| **Event through 1 / 3 pass-through hooks** | **1 ms** | **22 us, 38 us / 48 us, 131 us** |
| `ui.render` of 1,000 elements (build, serialise, parse, validate) | | 7.5 ms, 10.1 ms (6.5 ms with 250 buttons) |
| Engine heap, three mods loaded | | 259 KiB used |
| Resident memory | | about 213 KiB per isolate (10 isolates, +2.1 MiB) |
| Size added to a release `hx` | | **+4,349,064 bytes** (11,550,960 to 15,900,024, +37.7%), with the thin-LTO, stripped release profile. 89 of the 103 new crates are `oxc`'s and 4 are QuickJS's; not split further |

A 1,000-element render is the one number worth watching: at 120 Hz a pane redrawn every frame would spend most of a frame on it. Panes redraw on invalidation (10/s, 30/s for the visible pane), so it is fine, and the isolate runs outside the webview, so a render costs no UI frame.

The soak test shows the heap flat over 2,000 rounds of events, renders, presses and ticks.

**The isolate's reach.** No file, network or process access of its own: the engine has no libc module, `tests/reach.rs` pins the exact global list (no `fetch`, `XMLHttpRequest`, `WebSocket`, timers, `console`, `process`, `require`, `Buffer`, `WebAssembly`, `Intl`, `structuredClone`, workers), and `tests/no_ambient_authority.rs` shows a running isolate adds no descriptor, socket, thread or child to the process. Web APIs present: `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder` (UTF-8), `AbortController`, `AbortSignal`, `queueMicrotask`, `crypto.getRandomValues`, `crypto.randomUUID` and `crypto.subtle.digest` (SHA-256, 384, 512), plus the engine's `atob`, `btoa`, `performance` and `DOMException`.

**Documented behaviour not reproduced**
- **`crypto.subtle`:** only `digest`, and not SHA-1. The docs name `crypto.subtle` without a method list. Anything else (`sign`, `importKey`, HMAC, AES) is absent; SHA-1 and MD5 answer `NotSupportedError`, never a wrong answer.
- **`$`:** only `plugin`, `ui` (`open`, `close`, `invalidate`, `toast`, `status`, `log`), `state`, `clock.every` and `command.register`. The rest is M1 and later. `$.ui.resolve`, `$.ui.place` and the other surfaces are not there.
- **The `claude-code` module** exports the element constructors, `Fragment` and `makeColors`. Its real exports are in `claude-code.d.ts`, which we have not read (section 7, licence). A mod importing another name fails to load.
- **`.cjs` and `.cts`** load, as ES modules. A file that sets `exports.register` is not supported.
- **"Three worker crashes unload every user mod"** is not implemented. A runtime that cannot be driven reports `Error::Crashed` and must be rebuilt.
- **Hot reload and "module variables reset on reload"** are not implemented. `session.start` is fired by the host; the runtime does not fire it.
- **The 10 s budget** is read as per hook, not charged while the hook waits for `next`. The docs say "per event" without saying which.
- **`console`** does not exist, as the docs list no such API. A mod that calls `console.log` throws `ReferenceError`; check against real mods in M3.
- **Settings hooks** (`"hooks"` in `hooks/hooks.json`) are ignored here: that is the COMPAT bridge's job.
- **Rate limits** on `ui.invalidate` (10/s, 30/s) and the pane sizing rules belong to the host and are not in the runtime.
- Nothing here ran a real Claude Code mod: the three examples are ours. Conformance against real mods is M3.

**Risks for M1**
1. **One realm for all mods breaks per-mod grants.** Section 4 grants capabilities per mod, and the attribution is the plugin name the kernel stamps on each call. But the mods share one realm, and a mod can patch a shared primitive: a test mod replaced `JSON.stringify` and rewrote another mod's `ui.log` arguments (the host saw `{"text": "forged"}` from `victim`). Before `$.fs`, `$.http` or `$.process` exist, either freeze the intrinsics before any mod loads (the kernel keeps its own references; SES-style, and watch the "override mistake", where assigning `e.name = ...` on an error subclass throws once `Error.prototype` is frozen), or give each mod its own context in the same runtime and move events and answers between them as JSON, which the chain largely does already. Decide this first.
2. **The isolate should not run in the `hx` process.** QuickJS is 2 MB of C; a memory-safety bug in it would give a mod `hx`'s authority. ADR-0022 says "inside `hx-sandbox`": the way is `sandbox.spawn` of an `hx` subcommand with the channel (`crates/hx-sandbox/INTEGRATION.md`), network off, reading only its own binary. `HostCalls` is already the boundary: the worker's implementation is a client of the channel speaking `mods.call`. The worker then cannot read plugin files, so loading should take sources from a provider (the parent reads them through `cap_std`, as `files.rs` does now) rather than a path. **The channel is not implemented on Windows** (INTEGRATION.md), so a Windows build has no sandboxed worker yet; say so rather than fall back to in-process silently (invariant 6).
3. **Host calls are synchronous** (`HostCalls::call` returns a value). The real ones (policy asks, forms, Hermes) take seconds and arrive from other threads. `drive` currently treats "no job runnable and no answer" as a stalled hook and blames it; with real async calls that state is normal, so the driver must wait on the host, and a hook's budget should not run while it awaits one. This changes `drive`, not the chain.
4. **`ModRuntime` is `!Send`** (`Rc`). It needs its own OS thread and a channel, like Claude Code's worker thread, never the async executor (STANDARDS section 6).
5. **`oxc` is 89 crates and 0.x, with a breaking release most months.** Pin exact versions and review upgrades. `self_cell` (via `oxc`) is `Apache-2.0 OR GPL-2.0-only`: we take Apache. The repository has no `deny.toml`, though STANDARDS lists `cargo-deny` in the gate.
6. **One heap limit for the runtime** (64 MiB): a mod that fills it makes other mods' allocations throw. A runtime per mod would separate them, at roughly 0.3 MiB each, but could not share the chain; the worker design above gives a process per session either way.
7. **Panics are contained but still print.** A transformer or host panic becomes an error, but the default hook writes its message to stderr. That is correct for logs (stdout carries frames only), but the worker should install a hook that goes through `tracing`.
8. **The `claude-code` module and `console`** (above): the unread type declarations decide whether real mods load at all.


## 9. M1 result (2026-11-19): the backend, end to end

The four decisions from the spike's risks (section 8) are implemented. What exists: `hx mods.*`, the sandboxed worker, the `$` table with its policy, the events bridge, the install prompt with static analysis, and the `mod.*` events. The UI renderer is the next step; the events are documented (`docs/PROTOCOL.md` section 3) and fixed by `apps/shared/data/mods.schema.json`.

**Architecture as built**
```
Hermes -> plugin (compat bridge: mod_events.py) --mods.* over hx stdio--> hx --socketpair--> hx mods-worker (hx-sandbox)
                  ^                                                      |                       |
                  +------- mods.call (hx asks, plugin decides) <--------+<---- $ call (frame) ---+
```
- **One context per mod** (risk 1). `chain.js` holds the chain; each mod's `agent.js` holds its `$`, hooks, handlers, atoms and timers. They exchange JSON strings that Rust routes (`natives::Msg`). The plugin name on a host call is set by the Rust native of that mod's context. The intrinsics are frozen before any mod code runs, with SES's "override mistake" repaired for the few properties that need it, so `this.name = ...` still works. `tests/reach.rs::one_mod_cannot_rewrite_another_mods_host_calls` is no longer ignored and passes, and shows both layers: patching `JSON.stringify` is refused, and replacing the global `JSON` changes only the evil mod's own world.
- **A worker process** (risk 2). `hx mods.load` reads each plugin through `cap_std` into a `Bundle` and starts `hx mods-worker` with `sandbox.spawn`'s machinery: Landlock (it may read only its binary and the system libraries it links, not `/bin` or `/etc/passwd`), seccomp (network off), `RLIMIT_NPROC`, and `Landlock EXECUTE` handled and granted nowhere once it runs (`hx_sandbox::forbid_exec`). Its only descriptor besides stdio is the socket pair's child end. Where the sandbox cannot be built, `mods.*` answers `hx.mods.unavailable` with the reason (Windows: no channel yet). There is no unsandboxed path. `mods.reach` runs a real probe inside the worker; on this machine every file, network and process attempt is `denied`.
- **Asynchronous host calls** (risk 3). A `$` call is a promise. `HostCalls::call` answers `Ready` or `Pending`; the driver waits for the host only when every hook is idle, extends the running hook's budget by the time waited, and rejects a call the host never answers after `host_timeout` (10 min). "Idle with nothing pending" is still a stalled hook, and is blamed as before. Answers that arrive after the event that made the call is over (`clock.every`) are delivered by the worker's own loop.
- **hx sends requests.** `hx serve` could only answer; a mod calls `$` whenever it likes (a clock tick, a handler). `serve_with_link` now routes responses to requests `hx` sent (`hx::outbound::Link`), and the plugin's hx client serves `mods.call`, `mods.diagnostic` and `mods.exited`. A `mods.call` is queued before the reply to the operation that made it.
- **Rendering is asynchronous.** The plugin answers `ui.open` and `ui.invalidate` by marking a site dirty; one thread per session draws dirty sites (10/s per site, coalesced). Calling `mods.render` inside the answer would wait for the worker that is waiting for the answer.
- **The clock** belongs to the worker (`clock.every` is decided by the plugin, then kept by the runtime; ticks run in the worker's loop). `console.log/info/warn/error` write `$.ui.log`; `console.debug` writes it with `{ to: 'debug' }`.

**The `$` table.** `ui` (`open`, `close`, `invalidate`, `toast`, `status`, `log`, `notify`, `ask`), `state` (in the mod), `store`, `clock`, `command`, `config`, `env`, `theme` (recorded and announced, not applied), `fs.read`, `fs.write`, `http.fetch`, `session.messages`. Refused by name with `hx.mods.unsupported` ("not yet in boopis"), never silently: `process`, `mcp`, `model`, `agent`, and the namespaces not built (`tool`, `prompt`, `turn`, `settings`, `audio`, `telemetry`). Each call is classified in `policy/defaults.json` (`mod_capabilities`):

| Call | Capability | Default | Notes |
|---|---|---|---|
| `ui.*`, `store.*`, `clock.*`, `command.register`, `config.get`, `env.get`, `theme.*`, `session.messages` | `mod.ui`, `mod.store`, `mod.clock`, `mod.command`, `mod.read`, `mod.theme`, `session.read` | allow | `env` is an allowlist, `config` is five keys, messages are redacted |
| `fs.read`, `fs.write` | `fs.read`, `fs.write` | ask | the path is resolved (symlinks) before the decision; protected paths are refused; **in governed mode a write inside the workspace is refused** (only `ship` writes it, AGENTS invariant 2); writes are atomic; 4 MiB |
| `http.fetch` | `net.egress` | ask | per host, and again for each of at most 5 redirects; 30 s; 4 MiB; never a loopback, private or link-local address |

The decision is `policy.check` with `ToolCall.principal = "mod:<plugin>"`, so deny rules run first with the same syntax (`mod:evil/*`, `mod:demo/http.fetch(url:https://x/*)`) and grants are per mod (an allow rule names the mod). An `ask` is a `permission` form with origin `{kind: mod, plugin}`, once or for the session; closing it or letting it expire denies. The ledger gets `tool.called` with the tool `mod:<plugin>/<call>`, actor `mod:<plugin>`, the arguments hashed and never stored, for every call but the redraw requests. A mod is limited to 200 calls a second (`hx.overloaded`).

**Events.** The one compat bridge delivers `session.start` (the mods load here), `session.end`, `prompt.submit` (`{ drop }` blocks the turn), `turn.start`, `turn.complete`, `tool.check`, `tool.call` (at the start, and again with the result) and `command.run` (slash commands `plugin:name`, through `ctx.register_command`), and `turn.step`. In governed mode a mod observes tool calls and can only tighten (`deny`, `ask`); it cannot rewrite one, and an `allow` answer is ignored. Outside governed mode a rewrite is judged again by `policy.check`. A `turn.step` that answers `{ model }` is refused in both modes, written to the ledger as `mod:<plugin>/turn.step.model` (blocked), and shown in the mod's log line.

**Install.** `mod.install.prepare` returns the prompt: the hooks and `$` namespaces found by `hx mods.analyze` (static analysis of the transformed module, with a `dynamic` flag when `$` escapes), the content hash and the commit when the source is a clean git checkout. `mod.install.confirm` copies only if the hash is the one shown, writes `lock.json`, and approves the content for the project in the trust store, so a changed mod asks again. **Not done:** the Hermes plugin generated from the source and `hermes plugins enable` (COMPAT section 9, steps 5 and 6): until then a mod runs when its slug is in Hermes's `plugins.enabled`.

**Tests.** `hx-mods`: the M0 tests (updated for the new ids and `$` keys), the forgery test un-ignored, `tests/hostcalls.rs` (pending calls and budgets, host timeouts, console, bundles, unload, timers, per-mod state), static analysis. `hx`: `tests/mods.rs` runs `hx serve` with a fake plugin and the three example mods through the sandboxed worker, and the reach probe. Plugin: `test_mods_calls.py` (policy per capability, asks, ledger, contract), `test_mods_hx.py` (the service and the bridge against the real hx, governed and ungoverned, install and analysis), and `tests/e2e/test_mods_e2e.py` against an unmodified Hermes gateway and the real worker (skips without `HX_E2E_*`).

**Risks left for M2 and M3**
1. **Per-mod heap budgets do not exist.** QuickJS accounts memory per runtime, so the 64 MiB limit is shared by every context in the worker: a mod that fills it makes the others' allocations throw. (A runtime per mod would fix it at about 0.3 MiB each; the worker's `RLIMIT_AS` is 2 GiB.)
2. **One operation at a time.** A worker runs one event and queues the next. A mod that awaits `$.ui.ask` holds every other mod's events and redraws for as long as the form is open (up to 10 minutes, `ask_timeout_s`). Concurrent runs need per-run frame stacks in `chain.js`.
3. **A memory-safety bug in QuickJS** would give a mod the worker's authority: it can talk to `hx` and impersonate any mod loaded *in the same session* (hx checks the name against the session's list) but nothing else; the sandbox holds. Per-mod grants therefore assume the engine is sound. Separate workers per mod would close it.
4. **The worker's lifetime is one hour** (`hx-sandbox`'s ceiling on `timeout_ms`). The plugin is told (`mods.exited`) but does not restart workers yet.
5. **`http.fetch` resolves a name twice** (the address check, then the connection): a DNS rebinding window. Pinning the connection to the checked address needs a lower-level client.
6. **`session.messages`** reads the last history the compat bridge saw (up to 4,096, redacted); Hermes gives a plugin no transcript call, so before the first turn it is empty.
7. **`theme.set` is only recorded** (`mod.theme`); `outputStyles`, `statusLine`, redraw sites for Claude Code's own components, placed rows, the backdrop, `Client` and `tool.register` are M2. The `statusLine` setting is not built.
8. **Conformance (M3)** still has not run a real mod: `console` exists now, the `claude-code` exports are still our guess (section 7), and `$.ui.resolve`, `$.ui.place` and the other `$.ui` members are absent.
9. **Windows** has no worker until `hx-sandbox` has a channel there; the setting is `hx.mods.unavailable` with a reason, not a silent fallback. `oxc` still moves fast (section 8, risk 5).
10. **Shared target directories collide between worktrees** (Cargo hashes workspace-relative paths): building two worktrees into one `CARGO_TARGET_DIR` can leave one's `hx` binary in the other's tests. Tests that need the binary should copy it first.
