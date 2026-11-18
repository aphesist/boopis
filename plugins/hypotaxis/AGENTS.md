# AGENTS.md: plugins/hypotaxis

The hypotaxis Hermes plugin (Python, stdlib only at runtime). It adds governance, a ledger and the `plugin.hypotaxis.*` RPC to **unmodified** Hermes (docs/ARCHITECTURE.md section 5). Read the root `AGENTS.md`, `docs/STANDARDS.md` and `docs/research/spike-s0.md` first.

## Layout
| Path | Job |
|---|---|
| `plugin.yaml` | manifest v2. `provides_*` list only what `register` really registers (a test checks it) |
| `__init__.py` | thin `register(ctx)`: lazy wrappers only, so import stays far under 150 ms |
| `hooks.py` | the Hermes hook callbacks. Policy hooks fail closed, observers never raise |
| `session.py` | `Runtime` and `SessionState`: the lock at first prompt, `session.opened`, spend |
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
- **No runtime dependencies.** `pyproject.toml` is tooling only and must not gain a `[project]` table (Hermes would treat the plugin as a package).
- RPC errors: Hermes turns an exception into `plugin_rpc_failed` with `detail` `"<Class>: hx.<code>: <message>"`. The code is first in `str(exc)` on purpose.

## Hermes facts this code depends on (verified on v0.23.2)
- `post_api_request.usage` is Hermes's normalised usage: `input_tokens` is already uncached. Do not subtract the cache read again.
- `pre_llm_call` fires once per user turn, so the cost cap is checked per turn.
- The prompt section callable runs at a session's first prompt, before `on_session_start` and `pre_llm_call`.
- `on_session_end` fires every turn; `on_session_finalize` ends a session.
- `ctx.session_cwd()` inside an RPC is not the session's cwd; hooks and the prompt section `info` carry the right one.

## Test and check
```sh
# dev env: contraprova editable at the pinned commit (hx/generalize @ 74fabe9), plus pytest and ruamel.yaml
export HX_HERMES_SRC=<a Hermes source tree>     # lets tests import hermes_yaml; those tests skip without it
ruff check --config pyproject.toml . ../../tests/e2e && ruff format --check --config pyproject.toml . ../../tests/e2e
pyright
pytest                       # unit tests, then ../../tests/e2e (skips cleanly without a Hermes install)
hermes plugins validate .
```
End-to-end tests: see `tests/e2e/README` in the module docstring of `tests/e2e/conftest.py` (`HX_E2E_HERMES_HOME`).

## Do not
- Import Hermes internals, patch Hermes, or register a tool before it works.
- Put a model id, a price, a protected glob or a timeout in code. Data goes in `defaults.json`, the schemas or settings.
- Add a new env var for non-secret config.
