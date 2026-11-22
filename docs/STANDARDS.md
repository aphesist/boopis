# boopis engineering standards

Every service, tool, store, module and function in this repository follows this document. It's settled before code is written. Changing a rule takes an ADR in `docs/DECISIONS.md`. The four goals, in order when they conflict: **security, correctness, performance, readability**. Updatability is a constraint on all four, not a fifth goal.

## 1. Rules that apply everywhere

1. **One implementation per concern.** Before writing a helper, look in the shared modules (section 9). If it isn't there and two places need it, it goes there. Duplicates fail review.
2. **Hermes conventions first.** Where Hermes has a convention (manifest fields, hook names and kwargs, config keys, registries, `<plugin>:<skill>` namespacing, JSON-RPC style), copy it exactly. Invent only where Hermes has nothing.
3. **Never patch upstream.** No edits to `vendor/`, no monkeypatching Hermes, no imports outside Hermes's public plugin API (`hermes_cli/data/plugin_api.json`, `ctx`, documented ABCs).
4. **No fabricated output.** Never return a success, number or result that didn't happen. Test doubles live only in test code or a `dev-fixtures` feature, never as an error fallback. Unknown is reported as unknown.
5. **Fail closed.** A permission, policy or gate check that errors or times out denies.
6. **Data, not constants.** Model ids, prices, ladders, protected patterns, timeouts and limits come from config or tables with defaults, never from literals scattered in code.
7. **Versioned persistence.** Everything written to disk or wire carries a schema version and has a migration path.
8. **Small units.** Soft limits: a function fits on one screen (about 60 lines), a module about 400 lines, one concept per module. A topic that outgrows a file becomes a package with a facade (Hermes's `<stem>/__init__.py` rule; in Rust, `mod.rs` re-exports).

## 2. Configuration

- **One schema per config surface**, with a JSON Schema as the source of truth: plugin settings (`plugin.yaml` `config_schema`), project settings, host settings, UI preferences. Types are generated from it.
- **Where config lives:**
  - plugin settings: Hermes `config.yaml` under `plugins.entries.boopis.settings`;
  - project settings: `<project>/.hermes/boopis.yaml` (trust-gated);
  - host settings: the app's config dir;
  - UI preferences: the app's store.
- **Secrets never live in config files.** Secrets go to the OS keychain through the host, and Hermes's `.env` holds secrets only, following Hermes's policy.
- **Precedence**, highest first: managed (`/etc/hermes`, platform equivalents), project-local, project, user, plugin defaults. Lists merge, scalars override. For permissions, deny beats ask beats allow, whatever the source.
- **Environment variables:** no new env vars for non-secret config (Hermes's rule). The only env vars are ones Hermes or a third-party tool defines.
- **Validate config at load,** with a precise error (file, key, expected, found). Never half-apply a config.

## 3. Errors

- **Rust:**
  - each library crate has one `Error` enum (`thiserror`, `#[non_exhaustive]`) and `type Result<T> = std::result::Result<T, Error>`;
  - `anyhow` only in binaries' `main` and tests;
  - no `unwrap`/`expect`/`panic!` in non-test code, except proven invariants (static regex compilation), each with a comment saying why it can't fail. Enforced by clippy (`unwrap_used`, `expect_used`, `panic` set to deny outside tests).
- **Python:**
  - one exception hierarchy rooted at `BoopisError`, with subclasses per area;
  - tool handlers never raise to Hermes: they return a JSON error object;
  - hooks catch, log and return the fail-closed answer where the hook is a policy hook.
- **TypeScript:** errors are typed values (`Result`-style unions) at module boundaries. `throw` only for programmer errors.
- **On the wire,** every error is `{code, message, data?}`. Codes are stable, namespaced strings (`hx.ship.aborted_before_write`, `hx.gate.blocked`, `hx.policy.denied`, `hx.config.invalid`) listed in `docs/PROTOCOL.md`. JSON-RPC numeric codes follow the spec (-32600 to -32603), and application errors use -32000 with the string code in `data.code`.
- **Two kinds of failure, never mixed:** a *tool outcome* (the tests failed, the edit didn't match) is a successful call whose result says so; an *infrastructure failure* (`hx` crashed, a timeout) is an error.

## 4. Logging, tracing and telemetry

- **Rust:** `tracing`, structured fields, one span per request and per session (`session_id`, `turn_id`, `tool_call_id`). **Python:** stdlib `logging` through Hermes's logger conventions, the same field names. **TypeScript:** a single `log` module that forwards to the host.
- **Levels:** `error` = needs action; `warn` = degraded; `info` = lifecycle (start, attach, version); `debug` = per request; `trace` = payloads, off by default.
- **Redaction:** every log line passes the shared redactor (section 9). Prompts, file contents and tool payloads never go above `trace`.
- **Where logs go:** files in the profile's `logs/boopis/`, rotated at 10 MB with 5 kept.
- **No telemetry leaves the machine.** The ledger is the record of work. Logs are for debugging.

## 5. Security

- **The single permission authority** is the plugin's policy (inside Hermes's `pre_tool_call`) for agent actions, and the host for machine actions. Nothing an agent reads can change either. Outside content is labelled as data in prompts and can never raise a permission.
- **Paths:**
  - every path from an agent or a project is resolved against a root with capability-style APIs (`cap-std` in Rust; `os.open` with `O_NOFOLLOW` plus `realpath` checks in Python);
  - absolute paths, `..` segments and symlinks that escape the root are rejected;
  - writes are atomic: temp file in the same directory, fsync, rename, preserving mode.
- **Processes:**
  - never build a shell string from untrusted input: arguments as vectors, `shell=False`;
  - child environments are built from an allowlist, never inherited wholesale (API keys stripped by default);
  - process groups are killed on cancel;
  - every child has a timeout and an output cap.
- **Network:**
  - local services bind to `127.0.0.1` only, behind a 32-byte random token compared in constant time;
  - `Host` and `Origin` checks against DNS rebinding;
  - the sandbox's network is off by default, and a new host is an approval.
- **Secrets:** stored in the OS keychain; redacted by pattern and entropy in pack, logs and the ledger; `.env`, key and credential files are never packed or sent.
- **Trust:** a project's hooks, MCP servers and plugins don't run until the user trusts the project. Plugin installs show their contents and pin a version and hash.
- **Tauri:**
  - strict CSP (no `unsafe-eval`, no remote scripts);
  - capabilities list exactly the commands each window uses;
  - every command validates its input as untrusted;
  - the webview never receives tickets, tokens or keys.
- **Dependencies:** `cargo-deny` (advisories, licences, bans) and `pip-audit`/`pnpm audit` in CI. Licences allowed: MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unicode. GPL family only with an ADR.

## 6. Performance budgets

Measured in CI where possible. A regression past a budget fails the build.

| What | Budget |
|---|---|
| App window to interactive (Hermes already running) | < 800 ms |
| Attach to a running gateway | < 300 ms |
| UI motion (dock, orbs, transitions, scrolling) | **the display's full refresh rate, 120 fps on a 120 Hz panel**: every frame under 8.3 ms, no frame over 16.7 ms, measured in the shipping engine (WebKitGTK on Linux) with the perf harness. 60 fps is the floor only where the machine forces it (CPU renderer, or WebKit's fixed 60 Hz timer); ADR-0025 |
| UI frame time while streaming | the same as motion; no layout thrash; long lists virtualised |
| Host proxy overhead per frame | < 1 ms p95 |
| `pack` on a 100k-file repository, warm `hx` | < 300 ms p95 for a search; < 50 ms for a known file range |
| `ship` validate + journal + apply, 10 files | < 100 ms, excluding the gate |
| Ledger append (lock, verify tail, fsync) | < 5 ms p95. Verification is incremental: tail hash plus periodic full verify, never a full re-read per append |
| Idle memory: host + UI | < 250 MB |
| Plugin import time inside Hermes | < 150 ms (lazy-load heavy modules) |

Motion rules (ADR-0025):
- Animate only `transform` and `opacity` (and `filter` where needed) on composited layers, so the compositor thread runs the motion and a busy main thread can't drop it. Springs become CSS `linear()` curves or Web Animations, not per-frame JavaScript.
- Per-frame JavaScript is the exception (the orbs' drawing), and it runs off the main thread where the engine allows it (OffscreenCanvas in a worker).
- No layout reads inside a frame, and no style recalculation of large subtrees during motion.

General rules:
- no blocking I/O on an async executor (`spawn_blocking`) or on the UI thread;
- stream large outputs instead of buffering them;
- cap everything that grows (output, history, caches) with a stated limit;
- cache only with an invalidation rule written next to the cache.

## 7. Wire protocols

- **JSON-RPC 2.0 everywhere** (Hermes's style): requests, responses, `event` notifications carrying `{type, session_id, payload, seq}`.
- **One schema source:** `apps/shared/boopis-v1.openrpc.json` generates the Python, Rust and TypeScript types. CI fails on a stale generated file.
- **Names:** methods `area.verb` (`ship.apply`, `blank.fill`), events `area.noun_or_past_participle` (`blank.opened`, `ship.completed`), fields `snake_case`.
- **Additive evolution:** new optional fields are fine; removing or renaming one is a new method or event name, with the old one deprecated for at least 2 minor releases. Unknown fields are ignored on read (Hermes's manifest rule).
- **Capabilities:** every peer advertises capability strings in its describe call. Features are gated on them, never on version numbers.
- **Time** is RFC 3339 UTC with milliseconds and `Z`. **IDs** are UUIDv7 strings unless a format (contraprova, Hermes) dictates otherwise.

## 8. Language rules

**Rust**
- Edition 2024, stable toolchain pinned in `rust-toolchain.toml`.
- `cargo fmt`; `clippy -D warnings` with `pedantic` on, allowing only the lints listed in the workspace `Cargo.toml`.
- Async on `tokio` with only the features a crate needs. Cancellation through `CancellationToken`. Every external await has a timeout.
- Public items have rustdoc. Every crate has a README with its purpose, public API and invariants.
- Serde: `#[serde(rename_all = "snake_case", deny_unknown_fields)]` for config, but **not** for wire types (wire types ignore unknown fields).

**Python** (plugin; runs inside Hermes's environment)
- Syntax ≥ 3.11. Hermes runs 3.14, but contraprova supports 3.11.
- Standard library first. A third-party dependency needs an ADR and goes through Hermes's package manager (`python_dependencies`).
- `ruff` (format and lint) and `pyright --strict` on our code.
- Type hints on every function. Dataclasses (`frozen=True`, `slots=True`) for values.
- Heavy modules are imported lazily inside functions, to protect Hermes's start-up.

**TypeScript** (UI)
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. ES modules, Vite, no framework.
- Components come from the design system (`ui/components`). Tokens, never literals, for colour, type, radius and spacing.
- Keyboard first: every action has a keybinding in `KEYMAP.md`.
- WCAG 2.2 AA. Reduced motion respected: reduce, never freeze.

## 9. Shared modules (the reuse registry)

Before writing any of these, use the existing one.

| Concern | Rust | Python (plugin) | TypeScript |
|---|---|---|---|
| Wire types | `hx-proto` (generated) | `plugins/boopis/rpc/types.py` (generated) | `apps/shared/ts` (generated) |
| Safe paths | `hx-txn::paths` | `boopis.util.paths` | — |
| Redaction (patterns + entropy) | `hx-pack::redact` | `boopis.util.redact` (same rules file `redact.rules.json`) | — |
| Process spawn (allowlisted env, group kill, timeout, cap) | `hx-sandbox::process` | `boopis.util.proc` | — |
| Canonical JSON and hashing | — | contraprova `events.canonical_json` | — |
| Ledger | — | `boopis.ledger` (wraps contraprova `EventLog`) | read-only views from events |
| Config loading and validation | `hx-proto::config` | `boopis.config` | `ui/core/settings` |
| Logging | `tracing` setup in `hx-proto::log` | `boopis.util.log` | `ui/core/log` |
| Event bus | — | — | `ui/core/bus` (the v6 `HX.on/emit`) |
| UI primitives | — | — | `ui/components` (the v6 `HX.ui.*` library) |
| HTTPS (TLS) in the desktop host | `boopis-host::tls` (`config()`: rustls, ring named on every agent, the system's trust store) | — | — |
| Words a person reads for an error | `boopis-host::error` (`user_message`, `shown`; `kept` keeps the raw words for Diagnostics, `joined` maps a failed blocking task) | — | `ui/host/errors` (`sentenceFor`, `keepDetail`) |

The redaction rules, protected-path patterns and the error-code list are data files shared by every language. They're never re-typed in each one.

## 10. Testing

- Every module has unit tests next to it. Every crate and package has integration tests in `tests/`.
- **Property tests** (`proptest`, `hypothesis`) for every invariant: the ledger (ported 1:1 from contraprova's `test_properties.py`), the journal (apply then restore is the identity on bytes and metadata), path safety (no input escapes the root).
- **Golden files** (`insta` in Rust, plain files elsewhere) for parsers and the wire. A golden ledger is shared with contraprova.
- **End-to-end:** a fake OpenAI-compatible model server plus a real pinned Hermes gateway, run in CI for every PR touching the plugin, host or protocol.
- **Conformance:** public Claude Code, Codex, Gemini and Hermes plugins and skills are fixtures. Each must load and its hooks must fire.
- **The gate on this repository** is the CI suite:
  - `cargo fmt --check`, `clippy`, `cargo test`, `cargo deny`;
  - `ruff`, `pyright`, `pytest`;
  - `tsc`, `vitest`, Playwright smoke;
  - `hermes plugins validate --ci` against the pinned Hermes;
  - performance budgets.
  boopis's gate dogfoods on boopis.
- **Test hygiene:** no network in unit tests, no sleeps (use clocks and events), temp dirs via `tempfile`/`tmp_path`.
- **Live checks** against real services are ignored tests (`#[ignore]`) in an integration test, run by a workflow that is not the gate: `apps/desktop/src-tauri/tests/live_signins.rs` and `live-signins.yml` (docs/RELEASING.md).

## 11. Documentation

- Every area has an `AGENTS.md` with its job, its invariants, how to test it, and what not to do. The root `AGENTS.md` routes to them (Hermes's hub model).
- Every decision with alternatives gets an ADR in `docs/DECISIONS.md`.
- Comments say *why*, not *what*. No commented-out code.
- No borrowed numbers: a claim in docs or UI is either measured (with its source in `study/` or the ledger) or labelled a hypothesis.

## 12. Git

- **Every commit is the owner's alone:** author and committer `aphesist <126630868+aphesist@users.noreply.github.com>`. No `Co-authored-by`, `Claude-Session`, or any line naming an agent, a model or a tool. `.githooks/commit-msg` rejects violations and CI re-checks every commit.
- **Commit messages:** an imperative summary under 72 characters, then why. One logical change per commit.
- **Branches:** `main` is releasable; `develop` integrates; workstream branches `w<N>/<topic>`, merged only through the CI gate. Never force-push shared branches.
