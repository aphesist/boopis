# AGENTS.md: hypotaxis

hypotaxis is a desktop coding harness on **unmodified Hermes Agent**: Hermes does the work, a Hermes plugin adds governance and three tools, a Rust binary does the unsafe and fast parts, and a Tauri app is the experience. Read `docs/ARCHITECTURE.md` first, then `docs/STANDARDS.md`. Both are binding.

## Invariants (never break these)
1. **Hermes is never patched.**
   - No edits under `vendor/`, no monkeypatching, no imports outside Hermes's public plugin API.
   - Capability lives at the edges: plugin, skill, MCP server, host.
2. **Only `ship` writes the workspace**, and every ship ends at the gate. In governed mode, only a gate failure buys a stronger model, and the plugin chooses it, never the model.
3. **The ledger is contraprova's format**, byte for byte (`docs/LEDGER.md`). Dollars are computed from tokens and never stored.
4. **Prompt caching is sacred** (Hermes's rule). Toolsets, skills and the system prompt are fixed at `session.create` and never change mid-session.
5. **Nothing is fabricated.** No simulated success, no placeholder numbers, no test doubles outside tests. Unknown is shown as unknown.
6. **Fail closed** on every permission, policy and gate check.
7. **One implementation per concern.** Use the shared modules (`docs/STANDARDS.md` section 9).
8. **The owner designs the UI.** Implement the approved v6 design system and never reinterpret it.

## Where things live (read the area's AGENTS.md before editing it)
| Path | What | Area guide |
|---|---|---|
| `plugins/hypotaxis/` | Hermes plugin (Python): tools, governance, ledger, exec kernel, compat, RPC | `plugins/hypotaxis/AGENTS.md` |
| `crates/` | `hx` binary and libraries: `hx-proto`, `hx-pack`, `hx-txn`, `hx-sandbox` | `crates/AGENTS.md` |
| `apps/desktop/src-tauri/` | host (Rust): Hermes lifecycle, gateway proxy, keychain, OS | `apps/desktop/AGENTS.md` |
| `apps/desktop/ui/` | UI (TypeScript), the v6 design system | `apps/desktop/AGENTS.md` |
| `apps/shared/` | the hypotaxis-v1 OpenRPC contract and generated types | `apps/shared/AGENTS.md` |
| `skills/` | bundled skills (agentskills.io format) | `skills/AGENTS.md` |
| `packaging/` | the terminal art (`brand/`), the installers' icons, the Arch install script; `scripts/install.sh` and `install.ps1` read it | `packaging/AGENTS.md` |
| `docs/` | architecture, standards, decisions, protocol, ledger, compat, research | this file |
| `vendor/hermes-agent/` | upstream Hermes, pinned tag, CI only. Read it, never edit it | — |

## Commands
```sh
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
(cd plugins/hypotaxis && ruff check . && pyright && pytest)
(cd apps/desktop/ui && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test)
shellcheck scripts/install.sh scripts/embed-brand.sh scripts/test-brand.sh scripts/test-install.sh && scripts/test-brand.sh && scripts/test-install.sh
```

## Git: every commit is the owner's alone
- Run `scripts/setup-hooks.sh` (or `.ps1`) once per clone. It sets `user.name aphesist`, `user.email 126630868+aphesist@users.noreply.github.com` and the commit-msg hook.
- Never add `Co-authored-by`, `Claude-Session`, or any line naming an agent, a model or a tool. The hook rejects them, and CI re-checks author and committer.
- Work on `w<N>/<topic>` branches off `develop`. Merge only through the CI gate.
