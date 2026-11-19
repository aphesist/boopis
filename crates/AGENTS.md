# AGENTS.md: crates/

Read the root `AGENTS.md`, `docs/ARCHITECTURE.md` section 3 and 7, and `docs/STANDARDS.md` first.

## Job
The Rust side of boopis: the `hx` binary and its libraries. The plugin drives `hx` over JSON-RPC on stdio. Rust holds what must be fast or unsafe to get wrong.

| Crate | What |
|---|---|
| `hx-proto` | the wire contract: JSON-RPC framing, the error catalog (`errors.json`), `txn.*` types, the generated `schema/hx-v1.schema.json`, the `Handler` trait and `Dispatcher`, logging |
| `hx-txn` | the file transaction behind `ship`: safe paths, edits, journal, apply, restore, recover |
| `hx` | the binary: `serve` over stdio, one-shot subcommands |
| `hx-pack` | search, read, symbols, outlines, git status, redaction: the `pack.*` handlers, registered in `hx::build_dispatcher` |
| `hx-sandbox` | the OS sandbox and the `sandbox.*` handlers (run, spawn, wait, kill, capabilities), registered in `hx::build_dispatcher` |
| `hx-mods` | the runtime for Claude Code mods: QuickJS with a context per mod, the oxc TypeScript/JSX transform, the event chain, `$` as asynchronous host calls, and the `hx-mods-v1` worker. Served by `hx` as `mods.*` (`crates/hx/src/mods.rs`), in `hx mods-worker` inside `hx-sandbox` (`docs/MODS.md`) |

## Invariants
- Stdout carries protocol frames only.
- Every workspace access goes through a `cap_std` `Dir`. Paths are parsed and resolved only in `hx-txn::paths`. A write, delete or restore opens each directory with `O_NOFOLLOW` and holds it (`hx-txn::held`, `fsops`); never open a workspace path for a write with cap-std's own `open`, which follows links that stay inside the root.
- A journal is trusted only with a valid tag under the profile's key (`hx-txn::mac`), and a restore needs the caller's expected root.
- Nothing is written until every edit validated. Any failure after the first write restores from the journal. A crash at any step is recoverable.
- Errors are `{code, message, data}`; application errors use `-32000` and a string code from `crates/hx-proto/errors.json`. Add codes there only.
- Wire types ignore unknown fields. Changing one means re-blessing the schema in the same commit.
- Protected-path defaults live in `hx-txn/protected.default.json`. Explicit forms only, never bare `*test*` substrings.
- Handlers poll the cancel token and answer `hx.cancelled` only before they change anything.
- No fabricated numbers, no test doubles outside tests (the `dev-fixtures` feature is for tests).

## Test
```sh
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cargo test -p hx -- --ignored bless_schema     # after changing a wire type
cargo test -p hx-txn --release --test perf -- --ignored --nocapture   # 10-file budget
cargo test -p hx-mods --release --test perf -- --ignored --nocapture  # mods: start 50 ms, event 1 ms
```
Also check the production feature set: `cargo clippy -p hx-txn -p hx-proto -p hx -p hx-mods --lib --bins -- -D warnings`. `--all-targets` turns `dev-fixtures` on and hides lints in the no-op `Faults`.

## Pending consolidation
- `hx-pack/src/proc.rs` (child process with an allowlisted environment, timeout and output cap) is a stand-in for `hx-sandbox::process`. It is the only module that spawns, used only by `pack.status`; replace it when `hx-sandbox::process` lands.

## Mods
- The mod worker is `hx mods-worker` in `hx-sandbox`: read-only on its binary and the libraries it links, network off, no exec (`hx_sandbox::forbid_exec`), one inherited socket. Never run the runtime in the `hx` process, and never fall back to it: where the sandbox cannot be built, `mods.*` answers `hx.mods.unavailable`.
- `hx` reads plugin files (`Bundle::read`, `cap_std`); the worker never does. A `call` frame naming a mod that is not loaded in the session is refused before it reaches the plugin.
- Every `$` call is a `mods.call` request to the plugin, queued before the reply to the operation that made it. `hx` is the only crate that sends requests (`hx::outbound::Link`).
- A new `$` call needs a row in `plugins/boopis/policy/defaults.json` (`mod_capabilities`) and a handler in `plugins/boopis/mods/calls.py`; the isolate's `$` is `crates/hx-mods/src/js/agent.js`.
- Cargo hashes workspace-relative paths, so two worktrees built into one `CARGO_TARGET_DIR` overwrite each other's artifacts (touch your sources before a build or test, and copy `hx` before pointing a test at it).

## Do not
- Do not let a panic unwind through the `hx-mods` engine callbacks (they are C frames: it aborts the process). New natives use `std::panic::catch_unwind`, like `natives::host_reply`.
- Do not add a global to a mod's context without deciding it: `tests/reach.rs` pins the list. Do not let an object cross between contexts: messages are JSON strings.
- Do not write to stdout from a handler or from logging.
- Do not add a path helper elsewhere; extend `hx-txn::paths`.
- Do not apply the whitespace-fuzzy match. It is report-only.
- Do not follow a symlink yourself; use `paths::resolve`.
- Do not `unwrap`, `expect` or `panic!` outside tests. Do not add an `allow` without a comment saying why.
- Do not edit `schema/hx-v1.schema.json` by hand.
- Do not spawn a handler's blocking work on the async executor; use `spawn_blocking`.
