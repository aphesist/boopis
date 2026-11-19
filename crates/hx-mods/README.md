# hx-mods

The runtime that runs Claude Code mods unchanged: a QuickJS runtime with **one context per mod** and one for the event chain, a TypeScript and JSX transform that needs no build step, Claude Code's event chain, a `$` whose every effect leaves as a request for the embedder to decide, and the worker that serves all of it over a channel. Plan and results: `docs/MODS.md` (sections 8 and 9). The mod API it implements: `docs/research/mods.md`.

**Status: M1.** Wired into `hx` as the `mods.*` namespace (`crates/hx/src/mods.rs`): `hx` starts `hx mods-worker` inside `hx-sandbox` and the plugin decides every `$` call. This crate is the library under both.

## The choice

- **Engine: QuickJS-NG through `rquickjs` 0.14** (QuickJS-NG 0.16, vendored C). It has ES modules, async functions and promises, a wall-clock interrupt (`set_interrupt_handler`), a heap limit (`set_memory_limit`) and a native stack limit. Its build compiles `quickjs.c`, `libregexp.c`, `libunicode.c` and `dtoa.c` only, never `quickjs-libc.c`, so the engine has no `std` or `os` module: no files, sockets or processes of its own.
- **Transform: `oxc` 0.158** (parser, semantic, transformer, codegen). Types are stripped and JSX is compiled to the automatic runtime from the `claude-code` module, in microseconds per file.
- Why not the others, and the evidence: `docs/MODS.md` section 8.

## Public API

| Item | What |
|---|---|
| `ModRuntime::new(host, RuntimeConfig)` | starts the runtime: the chain context, no mods |
| `load_plugin(dir, Tier)`, `load_plugins(&[(dir, Tier)])`, `load_bundle`, `load_bundles` | read `.claude-plugin/plugin.json` and `hooks/hooks.json`, evaluate each `modules` entry, call `register(on, options)` with the `userConfig` defaults. `load_plugins` orders dependencies first |
| `dispatch(event, &json)` | one event through the chain: `Answer { answered, value }` |
| `render(component, id, &props)` | `ui.render` for a site: `Render::Tree` (validated JSON, handlers as `{"$handler": id}`), `Default` (no mod drew it) or `Skipped` (invalid tree, logged) |
| `press`, `input`, `select`, `tick`, `run_command` | the host's answers: `ui.press`, `ui.input`, `ui.select`, `clock.tick`, `command.run` |
| `unload_plugin`, `plugins`, `next_timer_due`, `fire_due_timers`, `host_completed`, `collect_garbage` | a mod leaves (its context is dropped); the runtime keeps time for `clock.every`; an answer that arrives after its event |
| `Bundle`, `analyze::analyze` | a plugin's sources as data (read by the parent, sent to a worker that cannot read the directory); the hooks and `$` members a mod's code names, for the install prompt |
| `worker::serve`, `wire` | the `hx-mods-v1` worker loop over a byte channel; the `mods.*` types of `hx-v1` |
| `take_diagnostics`, `memory` | what the mods did wrong; the engine's heap |
| `HostCalls`, `HostRequest`, `HostError` | the one door out. A `$` call is `{plugin, call: "ui.open", args}` |
| `transform::prepare`, `tree::validate` | the transform and the tree limits, usable alone |
| `fixtures::MemoryHost` (feature `dev-fixtures`) | an in-memory host that records calls. Tests and the benchmark only |

## The `$` of M1

`plugin`; `ui` (`open`, `close`, `invalidate`, `toast`, `status`, `log`, `notify`, `ask`); `state` (`atom`, `read`, `update`: in the mod, updating redraws the sites that read it); `store`, `clock` (`every`, `now`), `command.register`, `config.get`, `env.get`, `theme`, `fs`, `http.fetch`, `session.messages`: all promises, all requests to the host. `process`, `mcp`, `model`, `agent`, `tool`, `prompt`, `turn`, `settings`, `audio` and `telemetry` exist as proxies that send `process.run`, `mcp.call`, ... to the host, which refuses them by name. Anything else is a `TypeError`.

## The web APIs in each mod's context

Present: ECMAScript itself (QuickJS-NG, with `Float16Array`, `Iterator` and the disposable stacks), `URL`, `URLSearchParams`, `TextEncoder` and `TextDecoder` (UTF-8 only), `AbortController`, `AbortSignal`, `queueMicrotask`, `crypto.getRandomValues`, `crypto.randomUUID`, `crypto.subtle.digest` (SHA-256, SHA-384, SHA-512), and three the engine brings: `atob`, `btoa`, `performance`, plus `DOMException`.

Present from M1: `console` (`log`, `info`, `warn`, `error` write `$.ui.log`; `debug` writes it with `{ to: 'debug' }`). Absent on purpose: `fetch`, `XMLHttpRequest`, `WebSocket`, timers, `process`, `require`, `Buffer`, `structuredClone`, `Intl`, `WebAssembly`, workers, streams. `tests/reach.rs` pins the exact list of globals, so an engine upgrade that adds one fails the test and gets decided.

## Invariants

- **No object is shared between mods.** Each mod has a context; the chain has another; they exchange JSON messages that Rust routes. The plugin name on a host call is set by the Rust native of the mod's own context. The intrinsics are frozen before any mod code runs (`agent.js`, `hardenIntrinsics`), with the "override mistake" repaired for `constructor`, `toString`, `valueOf`, `name`, `message` and a few others. The heap limit is shared by every context (QuickJS accounts per runtime).
- The isolate has no ambient authority. Every effect is a `HostRequest`; the request names the plugin from the `$` the isolate handed that plugin. `tests/no_ambient_authority.rs` shows a running isolate adds no descriptor, socket, thread or child to the process.
- Plugin files are read through `cap_std` and `hx_txn::paths`, up to 2 MiB each (a `Bundle` up to 512 files and 16 MiB, read by the parent), and the handle is closed once the plugin has loaded. A mod can import its own relative files and `claude-code` only: no bare package, `node:`, URL, absolute path, path climbing out, or symlink out. `import()` is refused at load, and through `eval` or `Function` at run time.
- A hook that throws, or runs past its budget (10 s; 50 ms for `prompt.edit`; 1 s for `.catch`), is skipped, and the mod gets a diagnostic. The budget does not run while the hook waits for `next`. The engine interrupts the hook; the chain carries on.
- Rust is the authority on tree limits (100,000 characters, 20,000 elements, depth 32, the per-prop caps). A tree over a limit is skipped and the site keeps its own drawing.
- A panic in the transform or in the host never unwinds through the engine's C frames (that aborts the process): it becomes a compile error or an `hx.internal` error in the hook. This relies on the release profile keeping `panic = "unwind"`.
- Events are deeply frozen. `next(e2)` freezes the copy it passes on.

## Test and measure

```sh
cargo fmt --check && cargo clippy -p hx-mods --all-targets -- -D warnings && cargo test -p hx-mods
cargo clippy -p hx-mods --lib -- -D warnings      # the production feature set
cargo test -p hx-mods --release --test perf -- --ignored --nocapture   # the budgets
```

## Not done

See `docs/MODS.md` sections 8 and 9: per-mod heap budgets, concurrent events in one worker, a worker restart policy, `tool.register`, redraw sites for Claude Code's own components, and conformance against real mods.
