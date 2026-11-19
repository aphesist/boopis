# hx-mods

The runtime that runs Claude Code mods unchanged: one embedded JavaScript isolate for all of a session's mods, a TypeScript and JSX transform that needs no build step, Claude Code's event chain, and a `$` whose every effect leaves the isolate as a request for the embedder to decide. Plan: `docs/MODS.md`. The mod API it implements: `docs/research/mods.md`.

**Status: spike M0.** A library with tests. It is not wired into `hx`'s dispatcher (that is M1), and the `$` it provides is the minimal one M0 asks for.

## The choice

- **Engine: QuickJS-NG through `rquickjs` 0.14** (QuickJS-NG 0.16, vendored C). It has ES modules, async functions and promises, a wall-clock interrupt (`set_interrupt_handler`), a heap limit (`set_memory_limit`) and a native stack limit. Its build compiles `quickjs.c`, `libregexp.c`, `libunicode.c` and `dtoa.c` only, never `quickjs-libc.c`, so the engine has no `std` or `os` module: no files, sockets or processes of its own.
- **Transform: `oxc` 0.158** (parser, semantic, transformer, codegen). Types are stripped and JSX is compiled to the automatic runtime from the `claude-code` module, in microseconds per file.
- Why not the others, and the evidence: `docs/MODS.md` section 8.

## Public API

| Item | What |
|---|---|
| `ModRuntime::new(host, RuntimeConfig)` | starts the isolate: web APIs, the chain, no mods |
| `load_plugin(dir, Tier)`, `load_plugins(&[(dir, Tier)])` | read `.claude-plugin/plugin.json` and `hooks/hooks.json`, evaluate each `modules` entry, call `register(on, options)` with the `userConfig` defaults. `load_plugins` orders dependencies first |
| `dispatch(event, &json)` | one event through the chain: `Answer { answered, value }` |
| `render(component, id, &props)` | `ui.render` for a site: `Render::Tree` (validated JSON, handlers as `{"$handler": id}`), `Default` (no mod drew it) or `Skipped` (invalid tree, logged) |
| `press`, `input`, `select`, `tick`, `run_command` | the host's answers: `ui.press`, `ui.input`, `ui.select`, `clock.tick`, `command.run` |
| `take_diagnostics`, `memory` | what the mods did wrong; the engine's heap |
| `HostCalls`, `HostRequest`, `HostError` | the one door out. A `$` call is `{plugin, call: "ui.open", args}` |
| `transform::prepare`, `tree::validate` | the transform and the tree limits, usable alone |
| `fixtures::MemoryHost` (feature `dev-fixtures`) | an in-memory host that records calls. Tests and the benchmark only |

## The `$` of M0

`plugin`; `ui.open`, `close`, `invalidate`, `toast`, `status`, `log`; `state.atom`, `read`, `update` (updating redraws the sites that read the atom); `clock.every`; `command.register`. Everything else in the docs (`theme`, `tool`, `prompt`, `turn`, `session`, `config`, `fs`, `http`, `process`, `mcp`, `store`, ...) is M1 or later: calling it is a `TypeError` in the hook.

## The web APIs in the isolate

Present: ECMAScript itself (QuickJS-NG, with `Float16Array`, `Iterator` and the disposable stacks), `URL`, `URLSearchParams`, `TextEncoder` and `TextDecoder` (UTF-8 only), `AbortController`, `AbortSignal`, `queueMicrotask`, `crypto.getRandomValues`, `crypto.randomUUID`, `crypto.subtle.digest` (SHA-256, SHA-384, SHA-512), and three the engine brings: `atob`, `btoa`, `performance`, plus `DOMException`.

Absent on purpose: `fetch`, `XMLHttpRequest`, `WebSocket`, timers, `console`, `process`, `require`, `Buffer`, `structuredClone`, `Intl`, `WebAssembly`, workers, streams. `tests/reach.rs` pins the exact list of globals, so an engine upgrade that adds one fails the test and gets decided.

## Invariants

- The isolate has no ambient authority. Every effect is a `HostRequest`; the request names the plugin from the `$` the isolate handed that plugin. `tests/no_ambient_authority.rs` shows a running isolate adds no descriptor, socket, thread or child to the process.
- Plugin files are read through `cap_std` and `hx_txn::paths`, up to 2 MiB each, and the handle is closed once the plugin has loaded. A mod can import its own relative files and `claude-code` only: no bare package, `node:`, URL, absolute path, path climbing out, or symlink out. `import()` is refused at load, and through `eval` or `Function` at run time.
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

## Not done in M0

See `docs/MODS.md` section 8: the isolate runs in the `hx` process (not yet a sandboxed child), host calls are synchronous, and the realm is shared by all mods.
