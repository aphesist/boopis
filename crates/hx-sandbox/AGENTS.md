# AGENTS.md: hx-sandbox

The OS sandbox for the exec kernel and the gate commands. Read `README.md` (threat model, mechanisms, gaps) and `INTEGRATION.md` first; `docs/ARCHITECTURE.md` section 7 and `docs/STANDARDS.md` are binding.

## Invariants (never break these)
1. **Never silently run unsandboxed.** A requested dimension that cannot be enforced is `Error::Unavailable`, unless the policy's `degraded` flag for it is set, and then the report says `degraded`. Do not add a fallback that runs the command anyway.
2. **The report is built from what was applied**, never from the policy alone. A child that is running has had every step the report lists applied, because a failing setup step aborts the spawn (`Error::Setup`).
3. **Fail closed.** Any error while building or applying the sandbox means the command does not run.
4. **Paths are canonicalised once** (`normalize.rs`) and backends only ever see the resolved form. A `ro` path inside an `rw` tree is rejected, because no backend can subtract a grant.
5. **The pre-exec hook is async-signal-safe.** `platform/linux/child.rs` and `sys.rs` run between `fork` and `exec` in a possibly multithreaded process: raw syscalls over memory the parent prepared, no allocation, no formatting, no locks. Build everything in the parent.
6. **`unsafe` is confined** to modules marked `#![allow(unsafe_code)]` with a reason (`platform/*/sys.rs`, `spawn.rs`, the Windows `container.rs`, `launch.rs`, `loopback.rs`, `sys.rs`). Every block has a `SAFETY:` comment. The crate keeps the workspace's `deny`.
7. **Pure logic stays pure** and is compiled and tested on every platform: `normalize`, `seatbelt`, `winpolicy`, `linux/plan`.
8. Derived Codex code keeps its licence header and a line in `NOTICE`.

## Layout
`policy` / `normalize` / `report` / `wire` (types and validation), `process` (run, spawn, kill, timeout), `capture` (output cap), `program` (program lookup), `platform/{linux,macos,windows,unix}` (backends), `seatbelt` and `winpolicy` (pure translation), `tests/` (real processes), `examples/probe.rs` (the program the tests run inside the sandbox).

## Test
```sh
cargo fmt --check && cargo clippy -p hx-sandbox --all-targets -- -D warnings && cargo test -p hx-sandbox
cargo clippy --target x86_64-pc-windows-msvc --target aarch64-apple-darwin -p hx-sandbox --all-targets -- -D warnings
```
`cargo test -p hx-sandbox --test linux` alone does not rebuild the `probe` example; run `cargo build -p hx-sandbox --examples` after changing it. When you change a mechanism, mutate it (drop the Landlock fd, drop the seccomp program) and check that the matching tests fail.

## Do not
- Add a shell, a `PATH` lookup in the host's environment, or `sh -c`.
- Inherit the host environment, or add a variable to `DEFAULT_ENV_ALLOWLIST` that can carry a secret.
- Grant `/proc` or `/etc` by default, or `WRITE_DAC`/`WRITE_OWNER` on Windows.
- Report a mechanism you did not apply. Claims in `Enforcement` must be checkable from inside the child (see `the_enforcement_report_matches_the_child_s_own_view`).
