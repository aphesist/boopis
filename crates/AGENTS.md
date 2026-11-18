# AGENTS.md: crates/

Read the root `AGENTS.md`, `docs/ARCHITECTURE.md` section 3 and 7, and `docs/STANDARDS.md` first.

## Job
The Rust side of hypotaxis: the `hx` binary and its libraries. The plugin drives `hx` over JSON-RPC on stdio. Rust holds what must be fast or unsafe to get wrong.

| Crate | What |
|---|---|
| `hx-proto` | the wire contract: JSON-RPC framing, the error catalog (`errors.json`), `txn.*` types, the generated `schema/hx-v1.schema.json`, the `Handler` trait and `Dispatcher`, logging |
| `hx-txn` | the file transaction behind `ship`: safe paths, edits, journal, apply, restore, recover |
| `hx` | the binary: `serve` over stdio, one-shot subcommands |
| `hx-pack` | search, read, symbols, outlines, git status, redaction: the `pack.*` handlers, registered in `hx::build_dispatcher` |
| `hx-sandbox` | the OS sandbox and the `sandbox.*` handlers (run, spawn, wait, kill, capabilities), registered in `hx::build_dispatcher` |

## Invariants
- Stdout carries protocol frames only.
- Every workspace access goes through a `cap_std` `Dir`. Paths are parsed and resolved only in `hx-txn::paths`.
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
```
Also check the production feature set: `cargo clippy -p hx-txn -p hx-proto -p hx --lib --bins -- -D warnings`. `--all-targets` turns `dev-fixtures` on and hides lints in the no-op `Faults`.

## Do not
- Do not write to stdout from a handler or from logging.
- Do not add a path helper elsewhere; extend `hx-txn::paths`.
- Do not apply the whitespace-fuzzy match. It is report-only.
- Do not follow a symlink yourself; use `paths::resolve`.
- Do not `unwrap`, `expect` or `panic!` outside tests. Do not add an `allow` without a comment saying why.
- Do not edit `schema/hx-v1.schema.json` by hand.
- Do not spawn a handler's blocking work on the async executor; use `spawn_blocking`.
