# AGENTS.md: plugins/hypotaxis

The hypotaxis Hermes plugin (Python, stdlib only at runtime). It adds governance, a ledger and the `plugin.hypotaxis.*` RPC to **unmodified** Hermes (docs/ARCHITECTURE.md section 5). Read the root `AGENTS.md`, `docs/STANDARDS.md` and `docs/research/spike-s0.md` first.

## Layout
| Path | Job |
|---|---|
| `plugin.yaml` | manifest v2. `provides_*` list only what `register` really registers (a test checks it) |
| `__init__.py` | thin `register(ctx)`: lazy wrappers only, so import stays far under 150 ms |
| `hooks.py` | the Hermes hook callbacks. Policy hooks fail closed, observers never raise |
| `session.py` | `Runtime` and `SessionState`: the lock at first prompt, `session.opened`, spend |
| `compat/` | Claude Code files and hooks on Hermes (readers, merge, trust, hooks bridge, inventory RPC). Area guide: `compat/AGENTS.md` |
| `tools/` | the `pack` and `ship` tools (toolset `hypotaxis`): schemas in `tools/schemas.json`, handlers return JSON strings and never raise |
| `ship/` | the `ship` engine: `run.py` (validate, apply, gate, keep or restore), `gate.py` (contraprova's gates on a temp copy), `checkpoint.py` (git plumbing), `recover.py`, `edits.py`, `evidence.py` |
| `hx/` | the hx client (`client.py`) and the **generated** wire types (`types.py`) |
| `_vendor/contraprova/` | exact copy of contraprova's engine at a pinned commit (see below). Never edit |
| `data/` | copies of shared data files (`errors.json`, `protected.default.json`, hx-pack's rules). Never edit |
| `config/` | settings and trust-gated project settings, validated against `config/schemas/*.json` |
| `policy/` | `check(call, session) -> Decision`, the one permission function. Data in `policy/defaults.json` |
| `ledger/` | `SessionLedger` over contraprova's `EventLog`; usage mapping; prices; stats |
| `rpc/` | the hypotaxis-v1 methods |
| `prompt.py` | the cache-stable governed-mode prompt section |
| `errors.py`, `errors.json` | exception hierarchy and the plugin's wire error codes |
| `util/` | `schema` (JSON Schema subset), `globs`, `log` |

## Invariants
- **Imports.** Relative inside the package (Hermes loads it as `hermes_plugins.hypotaxis`). From Hermes, only what `hermes_cli/data/plugin_api.json` lists (`hermes_yaml`, `hermes_constants`), imported lazily inside the function that needs it. From contraprova, only the public modules: `events`, `log`, `projections`, `pricing`, `usage`, `interfaces`. **Never** copy its hash, canonical JSON or lock code.
- **Policy is one function.** `policy.check` serves the `pre_tool_call` hook and, later, the exec kernel (`ctx.dispatch_tool` bypasses hooks). Do not add a second decision path.
- **Fail closed.** An exception in a policy hook or in `check` blocks. A config that fails validation allows read-only tools only. Observers log and swallow, and never invent a value.
- **Mode locks at the first prompt**, when Hermes renders the prompt section. After that `mode.set` raises `hx.mode.locked`.
- **Dollars are computed, never stored.** The ledger holds tokens. The cap value may be stored, spend never.
- **Arguments are hashed, never stored** (`tool.called.args_sha256`).
- **Project settings are trust-gated.** Untrusted: the gate command, timeout, `permissions.allow` and `data_policy` are ignored; `protected`, `permissions.deny` and `permissions.ask` still apply.
- **contraprova is vendored** (ADR-0015): `scripts/vendor-contraprova.sh <sha>` writes `_vendor/contraprova/` and `--check` (CI) re-fetches the commit and compares bytes. Import it relatively (`from .._vendor.contraprova.events import ...`). Its `gates` module imports siblings by absolute name, so `_vendor.load("gates")` aliases the copy first; use that for the gates.
- **Shared data is copied** (ADR-0016): `scripts/sync-shared-data.sh` (+ `--check`). The plugin's error codes live in `crates/hx-proto/errors.json`, not here.
- **hx types are generated**: `scripts/gen-hx-types.py` (+ `--check`) from `crates/hx-proto/schema/hx-v1.schema.json`. `hx/types.py` is excluded from ruff and never edited.
- **Only `ship` writes the workspace**, through `txn.validate` then `txn.apply` with the explicit effective `protected` list (shared defaults, the plugin's extras and the project's). A pass discards the journal and commits `refs/hypotaxis/checkpoints/<session>`; a failure restores. The gate runs on a temp copy with **no sandbox yet**: every `gate.decided` says `enforcement: degraded:unsandboxed`. Never describe it as sandboxed until `hx sandbox.run` is wired.
- **No runtime dependencies.** `pyproject.toml` is tooling only and must not gain a `[project]` table (Hermes would treat the plugin as a package).
- RPC errors: Hermes turns an exception into `plugin_rpc_failed` with `detail` `"<Class>: hx.<code>: <message>"`. The code is first in `str(exc)` on purpose.

## Hermes facts this code depends on (verified on v0.23.2)
- `post_api_request.usage` is Hermes's normalised usage: `input_tokens` is already uncached. Do not subtract the cache read again.
- `pre_llm_call` fires once per user turn, so the cost cap is checked per turn. `pre_api_request` cannot block (its return is ignored: `agent/turn_api_request.py`), so a per-request cap is not possible with hooks; a turn that makes many requests can overshoot the cap by the cost of that turn. (`llm_execution` middleware could wrap the call; not used.)
- `session.create` accepts `toolsets: ["hypotaxis"]` only once a tool is registered in that toolset.
- Hermes does not tell a plugin a session's cwd before its first prompt: `ctx.session_cwd()` in an RPC or in `on_session_open` returns the profile's terminal directory. The cwd comes from the prompt section's `info` (`Runtime.cwd_of`); until then it is unknown, and RPC says `null`.
- The prompt section callable runs at a session's first prompt, before `on_session_start` and `pre_llm_call`.
- `on_session_end` fires every turn; `on_session_finalize` ends a session.
- `ctx.session_cwd()` is right only inside a turn (hooks, tool handlers) and in the prompt section `info`.

## Test and check
```sh
# dev env: pytest and ruamel.yaml. Upstream contraprova (editable) is only used by the e2e tests, to run its own
# `contraprova verify` on the ledgers; the plugin itself imports the vendored copy.
export HX_HERMES_SRC=<a Hermes source tree>     # lets tests import hermes_yaml; those tests skip without it
ruff check --config pyproject.toml . ../../tests/e2e && ruff format --check --config pyproject.toml . ../../tests/e2e
pyright && pyright -p ../../tests/e2e
export HX_BIN=$CARGO_TARGET_DIR/debug/hx          # cargo build -p hx; the pack/ship tests skip without it
pytest                       # unit tests, then ../../tests/e2e (skips cleanly without a Hermes install)
hermes plugins validate .
```
End-to-end tests (`../../tests/e2e`) start a real, unmodified Hermes gateway against a fake OpenAI-compatible model (`fake_model_server.py`) with this plugin copied into a temp `HERMES_HOME`. Set `HX_E2E_HERMES_ENV` to the directory the spike's `install.sh` produced (it holds `hermes-home/installs`, `runtime`, `uv-python`); without it they skip. Hermes's venv has no contraprova yet, so the stack puts the test process's contraprova on `PYTHONPATH`. Type-check them with `pyright -p ../../tests/e2e`.

## Do not
- Import Hermes internals, patch Hermes, or register a tool before it works.
- Put a model id, a price, a protected glob or a timeout in code. Data goes in `defaults.json`, the schemas or settings.
- Add a new env var for non-secret config.
