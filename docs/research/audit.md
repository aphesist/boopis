# hypotaxis first-pass audit

Repo `/home/user/hypotaxis`, one commit (`d0365a9`), 15.9k lines. Compared against the owner's plan (`scratchpad/plan.md`) and the Python `contraprova` at `/home/user/contraprova/src/contraprova`. Read-only: nothing in the repo was edited. `ui/node_modules`, `ui/dist` and `tsconfig.tsbuildinfo` created by my `pnpm` run were removed again; `git status` is clean.

## Bottom line

The code is a convincing demo, not a foundation for the plan. The one boundary the plan stands on, core to Hermes over `hermes-gateway-v1`, does not exist. Four of the plan's crates and directories are absent. The useful parts are narrow:

- the `ship` validate, journal, apply and restore loop;
- the structured SSH command builders in `apple-vm`;
- the `claude -p` stream-json parser.

Everything else is either a different design from the plan or a stub that returns success. The Tauri layer fabricates outcomes: hard-coded "14/14 assertions passed", seeded ledger events, a 97.9% cache-hit figure, and "shipped" results with no write. Passing tests and a clean clippy say very little: many tests exercise fixtures and mocks, and 3 of the 10 vitest tests assert the offline mock itself.

## 1. Build and test results

| Command | Result |
|---|---|
| `cargo check --workspace` | **Fails** on `hypotaxis-desktop`: `failed to run custom build command for gdk-sys v0.18.2 ... Package 'gdk-3.0' not found` (`pkg-config`). No GTK3/webkit2gtk-4.1 dev packages here. `src-tauri` was therefore only read, never compiled or tested. |
| `cargo check --workspace --exclude hypotaxis-desktop` | OK, 0 warnings |
| `cargo test --workspace --exclude hypotaxis-desktop` | **45 passed, 0 failed**. By crate: apple-vm 5, compat-loader 3, contraprova-kernel 12, hermes-bridge 10, local-artifacts 4, turn-primitives 10 unit + 1 integration, hypotaxis-contracts 0. The 3 tests inside `src-tauri/src/lib.rs:679-813` were not run. |
| `cargo clippy ... --all-targets -- -D warnings` (same exclude) | Clean, exit 0 |
| `cargo fmt --all --check` (extra) | **Dirty: 89 diff hunks** (14 in `src-tauri/src/lib.rs`, 9 in `ship.rs`). No `rustfmt.toml`, no `rust-toolchain`, no CI (`.github/` missing). |
| `ui/`: `pnpm install --frozen-lockfile && pnpm test && pnpm build` | All pass: vitest 10/10 (1 file), `tsc -b` clean, vite build 304 kB JS. |

I also wrote a scratch crate under the scratchpad (`harness/probe`) that depends on the repo crates by path. It confirmed several findings empirically; those are marked **[probed]** below.

## 2. hermes-bridge: it does not speak to Hermes

Verdict: it never starts, talks to, or configures Hermes. It does three unrelated things.

- `discovery.rs`: filesystem probing for a Hermes install (`install-stamp.json`, `~/.hermes`), plus a 120 ms TCP connect to Ollama on every call (`discovery.rs:75`, `:524`). It hard-codes a personal Windows path, `C:\Users\x80\AppData\Local\hermes` (`discovery.rs:329`, `:350`), and returns static provider rows with `zero_api_cost: true` for the Claude subscription (`:142-145`). The plan says that traffic bills to the Agent SDK allowance, not zero.
- `direct_sdk.rs`: runs the user's `claude -p --output-format stream-json --verbose` as the whole agent loop. It disables Claude's built-in tools, allows `mcp__hermes__pack|exec|ship`, and sets `--permission-mode dontAsk` (`:109`). That is the plan's `claude-subscription-directsdk` idea, but as a standalone runner, not a provider adapter behind a gateway. No MCP server that serves `mcp__hermes__*` exists anywhere in the repo.
- `cache_stabilizer.rs`: strips Claude-Code `<system-reminder>` date and email lines from strings. Nothing calls it. The plan's caching approach is byte-stable ordering in the gateway, not rewriting prompts.

There is no JSON-RPC, no stdio client, no `session.*`, `prompt.submit`, `approval.respond` or `session.steer`, no `uv` lifecycle, no `vendor/hermes-agent`, and no shim. The only mentions of JSON-RPC are in docs (`docs/ARCHITECTURE_PLAN.md:26,142`). The README's "unmodified upstream Hermes base" is aspirational.

Other defects in `direct_sdk.rs`:

- **Env scrubbing.** Only `env_remove("ANTHROPIC_API_KEY")` (`:244`, `:257`). `sanitized_env` is computed (`:223-226`) and never applied to the `Command`. `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_USE_*` still pass through. The plan requires the child to get no keys.
- **Process lifecycle.** `cmd.output().await` (`:559`): no streaming, no cancel, no timeout, no `kill_on_drop`, no process-group kill. The plan says the whole group is killed on cancel.
- **Prompt delivery.** The prompt goes in argv, which is visible in `ps` and subject to size limits.
- **Scope.** It relays every request, not "only the first".

API quality is fine on its own terms: `thiserror` enum, typed events, `Unknown` variant for forward compatibility. Keep the parser, delete the rest.

## 3. contraprova-kernel: a re-imagining, not a port

### Ledger

Wire-incompatible with Python, **[probed]**. A ledger written by `contraprova.log.EventLog` loads in Rust as `next_seq=2 head=genesis`, and `verify_chain` fails with `missing field timestamp`. Differences:

| | Python (`events.py`, `log.py`) | Rust (`ledger.rs`, contracts) |
|---|---|---|
| Event types | 14, dotted: `task.created` ... plus `lane.planned`, `interface.frozen`, `interface.requested`, `merge.decided`, `coordination.detected` (`events.py:19-37`) | 9, snake_case (`contracts:4-17`), none of the lane events |
| Fields | `seq, type, actor, ts, payload, prev_hash, hash` | `seq, timestamp, kind, prev_hash, hash, payload`; **no `actor`** |
| `seq` | 0-based | 1-based (`ledger.rs:155`) |
| Hash | `sha256(canonical_json({seq,type,actor,ts,payload,prev_hash}))` (`events.py:44-46`) | `sha256("seq|ts|kind|prev|payload")` (`ledger.rs:445`) |
| Append | `flock`, re-read, validate transition, `fsync` (`log.py:40-56`) | plain `OpenOptions::append` + `flush`; no lock, no fsync; `Ledger` is `Clone` (`:133`), so two handles fork the chain |
| Open | strict | **lenient** (`:167-174`): a malformed line is skipped and `next_seq` bumped, so appends continue onto a corrupt chain |
| Pricing | tokens only; dollars are a re-priceable projection (`pricing.py`, table `anthropic-2026-11`, Opus 5.5 at $4/$20) | hard-coded Claude-4-era constants, Opus $15/$75, Haiku $0.80/$4 (`ledger.rs:90-100`); no cache-write rate |
| Task projection | `projections.py` rejects illegal transitions before write | none |

The Rust ledger also cannot carry what the plan lists: model, latency, cached tokens and cost per call, tool calls, ship results, blanks and approvals. `UsageRecordInput` has four token fields and a tier (`ledger.rs:104-113`).

Fixes: port `events.py` and `log.py` byte for byte (the canonical JSON is the contract) and add a cross-language fixture test. The Python test log is the natural fixture. Effort S–M.

### Gate

Not the Python gate.

- **Python** (`gates.py`): tiers `T0.scope`, `T0.visible_tests`, `T1.private_tests` and a blast-radius-triggered `T2.review`. Protected files are sha256-bound before the attempt (test-tamper detection). Tests run on a **temp copy** with the submission applied, with a timeout.
- **Rust** (`gate.rs:117-280`): scope non-empty, protected check, scope match, then `sh -c $HARNESS_GATE_CMD` in the **live workspace**, synchronously, with no timeout (`:314-329`).

Gaps:

- No hash binding, so "immutable tests" is a path-pattern check only.
- The env-pinned command is faithful to the plan's wording, but the plan says it runs in the sandbox.
- **Protected patterns are over-broad (`gate.rs:11-26`).** `*test*` and `*spec*` match anywhere in the path. **[probed]** `src/latest.rs`, `src/inspector.rs`, `docs/contest.md`, `src/aspect.rs` and `src/protest.py` are all "protected". A model can never legitimately edit them, and `is_sensitive_path` (`ship.rs:219`) reuses this to force human holds.
- It also blocks creating new tests. Python uses explicit patterns (`tests/*`, `test_*.py`, `*.spec.*`) plus per-task files (`contracts.py:12`).
- No `T2.review` hook.

### Router

`router.rs` is a 3-state ladder with an invented rule: retry the same tier once on a pure scope violation, otherwise escalate (`:46-106`). The Python router is a seeded, hash-pinned logistic regression with epsilon-greedy propensities, fork-based control retries, and off-policy evaluation inputs. The measured arm D is: Haiku, gate, router picks Haiku (control) or Sonnet (treatment) after a failure. The plan says "the defaults are the policy the study measured", and this is not it.

The ladder is hard-wired to three enum variants. Plan: per-profile ladders, retries per tier, cost cap, and "carry task, failing output and rejected diff". None of that is modelled.

Keep as a placeholder only, or replace with a ladder-as-data design plus a `Router` trait that the Python-equivalent policy can implement later.

### Lanes

`lanes.rs` is a static glob-disjointness checker. It lacks the planner, interface board, frozen-interface hashes, shadow versus governed merge, blame rules and `coordination.detected` events (`harness/lanes.py`, 1274 lines). It does not reject overlapping lanes at registration (Python has `overlapping_scopes`). It uses `globset`, where `*` crosses `/` (same as Python's `fnmatchcase`, but unlike the gitignore-style globs the plan implies).

## 4. turn-primitives

### ship (`ship.rs`, 1179 lines): the best code here, but it is not yet the plan's `ship`

Real: validate all edits in memory first, then abort with diagnostics and closest match (`:65-145`). Then journal, apply via tmp+rename, gate, restore. Exact, CRLF, indent-shift and whitespace-fuzzy matching. The byte-exact rollback test is real (`ship::tests::gate_failure_rolls_back_byte_exact_and_deletes_new_files`). Problems, in severity order:

1. **Symlink escape, [probed].** A relative path through an in-workspace symlink (`link/pwned.txt`, where `link` points outside) returns `ShippedAndVerified` and writes outside the root. `resolve_safe_rel_path` (`:298-327`) only checks `..` and canonicalises absolute paths. This breaks "ship is the only path, inside the workspace".
2. **Fabricated telemetry (`:203-205`).** Every successful ship returns `cost_saved_usd` computed from constants (`2_400/650/9_600` tokens). **[probed]** value `0.2235` on every call. Remove it.
3. **Rollback is byte-exact but not metadata-exact, [probed].** An executable file goes 0755 to 0644 after a successful edit, and again after rollback, because every write is a fresh tmp file. Mtime changes, and symlinks are replaced by regular files.
4. **No rollback on gate error.** `gate.evaluate(...)?` (`:164`) and `restore_from_journal(...)?` (`:166`, `:184`) propagate errors after the workspace has been modified. A failing restore leaves a half-applied tree and a journal in `/tmp`.
5. **Journal weaknesses.** It lives in `std::env::temp_dir()` (`:851`) with default permissions (source snapshots world-readable), has no fsync, and nothing ever reads it back after a crash. No hidden checkpoint ref, so no rewind (plan: commit to hidden ref on pass).
6. **Gate side effects survive rollback, [probed].** The gate command can write the workspace and nothing undoes those writes. It runs unsandboxed and without a timeout (see kernel gate).
7. **`human_approved` is a field of the request.** Whoever builds `ShipRequest` can set it. In the Tauri layer it comes straight from the webview, and the demo UI hard-codes `true` (`SessionsView.tsx:265-300`). Approval must be core state, not a request flag.
8. **Fuzzy auto-apply.** The whitespace-normalised tier (`:434`) can rewrite code where whitespace matters (Python, YAML, string literals). The plan says a miss returns `ABORTED_BEFORE_WRITE` with the closest match, not a silent fuzzy apply. Make fuzz opt-in or report-only.
9. **Scope and protected checks run after the write.** They are cheap pre-checks and belong before the journal.
10. **UTF-8 only.** Non-UTF-8 targets are refused, which is acceptable for now.

### exec (`exec.rs`): a persistent REPL, not the plan's `exec`

- **Real:** a long-lived `python -u -c` child per `session_id`; variables persist **[probed]**; last-expression echo; kill on timeout.
- **Not real:**
  - `parallel_tools` is Rust-side pre-dispatch before the code runs, with results injected as `tool_results` (`:195`, `:324-366`). Python code cannot call tools. `harness.parallel`, Hermes and MCP tools as functions, `diagnostics()` and `leave_blank` do not exist. Only `echo` and `pack` handlers are registered (`:149-170`). Top-level `await` is a SyntaxError **[probed]**.
  - **No sandbox**: full user privileges, network on, cwd is the Tauri process's. **[probed]** It writes workspace files directly, bypassing `ship`, so "only ship can write" is false.
  - **Protocol shares fd 1 with user code.** A child process writing to stdout (`subprocess.run(["echo",...])`) or `os.write(1,...)` corrupts the JSON line; **[probed]** the result is `invalid REPL response JSON` with exit 127, and the session is killed. stderr is `/dev/null` (`:413`), so fd-level errors vanish.
  - Timeout kills the process, so all state is lost **[probed]**. There is no interrupt, no process group (grandchildren survive), and no output cap.
  - `get_or_spawn_session` holds the global map lock while awaiting a session lock (`:373-376`). One busy session head-of-line blocks others.
  - Python found as `python` then `python3`: no `uv`-managed runtime.

Plan says to reuse Hermes's `tools/code_kernel.py` (RPC kernel) or write an asyncio kernel with the same RPC. This should be rewritten against that design.

### pack (`pack.rs`)

Real and tested: ignore-aware walk (skips `.git`, `node_modules`, `target`), 2 MB per-file cap, binary skip, byte budget, git status, regex secret redaction for private keys, `sk-`, `AKIA`, `ghp_`, JWT and `key = "..."` forms. Symbol outlines are regexes for rs/ts/py only (`:326+`).

Versus the plan:

- Plan: ripgrep crates plus tree-sitter, context lines around matches, whole files, line ranges, single symbols, globs. This is line-matching with no context, no ranges and no symbol fetch.
- No entropy redaction. `.env` files are read and redacted (`pack.rs:211+`) rather than never packed.
- Every pack call walks and reads the whole tree synchronously. In Tauri it is a blocking command on the main handler.
- `root` is caller-supplied; `.git/**` and other secrets-adjacent files are not denied by default in explicit-file mode.

Keep and extend (M–L).

## 5. compat-loader: wrong on exactly the points you asked about

- **Hooks (`loader.rs:67`, `:246`, `:294`).** It looks for `.claude/hooks.json`, a file Claude Code does not read. Hooks live in `.claude/settings.json` (`hooks`) and `settings.local.json`, and in plugins at `hooks/hooks.json`. `settings.json` is never opened. The inner `{hooks: {Event: [{matcher, hooks:[{command}]}]}}` parse (`parse_claude_hooks_json`, `:399-498`) is the right shape, attached to the wrong path.
- **Missing entirely:**
  - `.claude-plugin/plugin.json`
  - `marketplace.json`
  - plugin `commands/agents/skills/hooks/.mcp.json` bundling
  - `.mcp.json` / `.cursor/mcp.json` / Codex `config.toml` MCP servers
  - permissions and env from settings
  - `CLAUDE.md` `@import` resolution
  - `.cursorrules`
  - `GEMINI.md` and `gemini-extension.json`
  - output styles
  - hook events/exit-code semantics
  - tool-name aliasing
  - precedence (managed, local, project, user, plugin)
  - trust prompts
  - version/hash pinning
- **It only catalogues.** It returns `CompatAsset {id,name,path,description,scope_globs,trigger}` with no content. The plan needs translation into a Hermes profile (prompt material) and core policy (hooks and permissions). Nothing translates.
- **Regex path classification** (`:57-77`) rather than format-aware readers. Frontmatter is a hand-written line parser (`frontmatter.rs`), not YAML. Quoted multi-line values, nested keys and `allowed-tools` lists are lossy.
- **Fragility.** One unreadable or non-UTF-8 file aborts the whole scan via `?` (`:207`, `:291`). It walks hidden dirs and the whole Hermes home. Compat tests: 3 fixtures.

Verdict: rewrite the loader. Keep the `ignore` walker, the id scheme and fixture approach. Use `serde_yaml`, `serde_json` and `toml`, and model the six formats as typed readers that return a translation plan.

## 6. local-artifacts

- **Store** (`store.rs`): shells out to `git` per operation, about 10 processes per commit (`:493`; `configure_local_repo` alone runs 5 `git config`). Plan: gitoxide, with git2 as fallback. Repos are working-tree repos, not bare (plan: bare). Versions are `git log` ordinal, not `v1/v2` tags. Commits carry no session or turn. Author hard-coded to `aphesist` (`:8-9`). Fork is `git clone --local` (hardlinks, not alternates). `read_file_at` returns `String` (lossy for binaries and builds). Input validation is good: segment, relative-path and revision allowlists, traversal rejected, hooks disabled via `core.hooksPath`. Tests are real, against git.
- **Server** (`server.rs`): bound to `127.0.0.1:0` only (good). But:
  - **no token**, though the plan requires a per-artifact token (`build_router` `:73`);
  - no `Host`/Origin check, so a DNS-rebinding web page can read it;
  - it serves artifact HTML as `text/html` from the same origin as the API (`:216-235`);
  - it is **not a git server**: only JSON, tree and diff GETs. Nothing can `git clone` or `push` over HTTP, which is its stated purpose (VM, sandboxes, teammates).
- Preview CSP, sandboxed webview and blobless clones: absent (preview is "later" in the plan).

## 7. apple-vm

- `remote_ssh.rs`: the best-designed module in the repo. Structured `CommandSpec`, no local shell, validated tokens, POSIX single-quoting, `BatchMode`, `ConnectTimeout`. `execute` shells out to `ssh` only. Caveats: `StrictHostKeyChecking=accept-new` (`:98`); `rsync --delete` (`:135`) to a config-supplied path; `execute` never runs the rsync, so it builds whatever is already on the mount.
- `qemu_kvm.rs`: builds QEMU args, a `virtiofsd` spec and an SSH spec. It **never launches or supervises a VM** and no VNC/WebRTC path exists. It prints an Apple-EULA notice. A snapshot/rollback story is absent.
- `detector.rs`: env and PATH probing. Fine.
- `simulated.rs`: a canned 14-test "pass" with fixed timestamps and names from the mock-up (`testOrbSphericalEyeForeshortening`...). That belongs in test code only. It is wired into production as a fallback: `src-tauri/src/lib.rs:577-583` **turns any real build error (ssh unreachable, xcodebuild failure) into a successful 14/14 simulated result**.
- No EAS backend, no `apple.build()/test()/run()/screenshot()/record()` API surface for `exec`.
- Unused dependency: `serde_json`.

## 8. src-tauri

The scaffolding is fine (`main.rs`, `build.rs`, `tauri.conf.json`). `lib.rs` is the integration problem.

- **Fabrication.**
  - `seed_ledger_if_empty` (`:115-133`) writes fake `route_decided` and `usage_recorded` events (86,000 cached tokens) into the real hash chain, and re-seeds whenever `verify_chain()` fails, i.e. onto a corrupt ledger.
  - `kv_cache_hit_rate` falls back to **97.9** and `cost_saved_pct` to **61.0** when there is no data (`:266-275`). The first is the unsourced number the plan removes.
  - `seed_artifacts_if_empty` creates a fake `toast` artifact.
  - Defaults: ssh `100.84.12.9`, user `aphesist`, scheme `CorePay`, root `~/core` (`:185-193`, `:234`).
- **`ship_gate` (`:323-448`)** has a "showcase" path. If an edit targets a file that does not exist, nothing is written, yet it returns `ShippedAndVerified` with `gate_output "14/14 assertions passed · $0.038 vs $0.112 Opus"` and `cost_saved_usd 0.074`, and it invents default files (`src/middleware/rateLimit.ts`). The `!human_approved && !run_gate` branch reports "DENIED · working tree restored byte-for-byte" though nothing was touched. These are indistinguishable from real results.
- **Security.**
  - `csp: null` (`tauri.conf.json`).
  - `append_ledger_event` accepts any `kind` and `payload` from the webview (`:646`): the ledger can be forged.
  - `run_exec` runs arbitrary Python from IPC with no root or sandbox (`:604`).
  - `resolve_root` accepts any existing directory and falls back silently to the process cwd if it does not exist (`:231-243`).
  - Capabilities are only `core:default` (fine, but custom commands are all open).
- **Performance.** `get_system_status` re-reads the whole ledger twice, probes Hermes on disk, TCP-connects to Ollama, and walks the whole workspace plus Hermes home for compat assets, all on one call that the UI makes on load and after every action. It runs under a `std::sync::Mutex`.
- **API.** All commands return `Result<_, String>`. There is no event stream, so the plan's `feedforward.preview`, `blank.open`, approvals and ledger updates have no channel. No tracing.

## 9. UI integration plumbing (`ui/src/lib/ipc.ts`, 717 lines)

- Types are hand-mirrored from Rust (no `specta` or `ts-rs`). They currently match, but nothing enforces it. `ShipStatus` SCREAMING case and `EventKind` snake_case depend on the exact serde attributes.
- `callTauriOrFallback` (`:394-403`): outside Tauri, every command returns canned success. About 500 lines of simulated state ship in the production module (hash chain via FNV, fake providers, `97.9`, `14/14`). The "IPC tests" (`orbMath.test.ts:177-294`, 3 of the 10 vitest tests) assert this mock.
- Views never call `run_exec` and have no streaming. The composer's send is a mock reply: "Queued on Contract Lane B" (`SessionsView.tsx:355-366`). Approve and Deny buttons call `ship` with `human_approved: true` and a hard-coded "14/14 assertions passed" quote (`:265-320`). `root: '.'` everywhere.
- Plumbing worth keeping: the `invoke` typing pattern, the `isTauriRuntime` check. Rewrite: type generation, a `Channel`/event subscription layer, a typed error type, and move mocks into a dev-only module.

## 10. Cross-cutting

- **Errors.** Three styles: `anyhow` (kernel ledger, ship, pack, exec), `thiserror` enums (bridge, artifacts, kernel, primitives), and `String` at the Tauri boundary. `ship` and `pack` return `anyhow::Result` wrapping a typed `PrimitiveError`, so callers cannot match on it. Tool failure versus infrastructure failure is conflated: `ExecResult` encodes failures as `exit_code 127/124` with prose in `stderr`.
- **Config.** None. Env reads are scattered: `HARNESS_GATE_CMD`, `HERMES_HOME`, `LOCALAPPDATA`, `HYPOTAXIS_APPLE_SSH_*`, `HOME`. No project/user/managed settings model, no gate pinned in project config (plan: pinned in project config).
- **Logging.** No `tracing` or `log` anywhere. The ledger is the only record.
- **Duplicated helpers.** `normalize_rel_path` three times with different semantics (`contraprova-kernel/lib.rs:45`, `local-artifacts/store.rs:441`, `pack.rs` via kernel); `normalize_path` and `normalize_display_path`; hand-rolled temp-dir helpers in 6 test files (no `tempfile`); `normalize_ws`; a `posix_single_quote`. Every crate does `pub use hypotaxis_contracts::*`, and `contraprova-kernel` and `turn-primitives` re-export the full set.
- **Contracts crate.** It mixes protocol types with product types (`ProviderProfile`, `XcodeBuildResult`). It has no versioning and no schema, while the plan makes W0 own the protocol.
- **Dependencies.** All via `[workspace.dependencies]` (good). `tokio` with `full` everywhere. `axum 0.7` (0.8 is current). `tauri = "2"` unpinned. One unused dep (`apple-vm` `serde_json`). Missing for the plan: `keyring`, `tree-sitter`, ripgrep crates (`grep-*`), `gix`, a YAML/TOML parser, `tracing`, `tempfile`, a models.dev client. No `cargo-deny` or audit.
- **Panics.** About 100 `unwrap()` or `expect()` in non-test source (`pack.rs` 27, `ship.rs` 20, `ledger.rs` 19, `loader.rs` 17 are mostly static regex or test code; not triaged individually).
- **Missing from the plan's layout:** `crates/gateway`, `crates/sandbox`, `shim/`, `vendor/hermes-agent` (no `.gitmodules`), `study/`. Docs hold only the old plan; no protocol spec. Also missing: CI and the commit-identity check, `keyring`, hooks engine, capability probe, checkpoints and rewind, cost cap, feedforward and blanks, teammates and approvals queue, headless CLI, models.dev, per-project data policy, trust prompts.
- **Repo hygiene.** The README and handoff docs carry the "97.99% hit rate" and "71.2% SOTA" claims the plan retires, plus an `X:\` Windows resume script. `scripts/setup-hooks.*` and `.githooks/commit-msg` exist (good, but the hook's trailer regex, `.githooks/commit-msg:3`, does not match `Claude-Session:` and cannot catch lines naming a model or tool, which the plan requires; no CI identity check).

## 11. Verdict table

| Item | Verdict | What to do | Effort |
|---|---|---|---|
| `hypotaxis-contracts` | Keep and fix | Add `actor`, 14 dotted event types, 0-based seq. Move product types out. Generate TS types (specta or ts-rs). Add protocol/version module; stop `pub use *` | S–M |
| kernel: ledger | **Rewrite** | Byte-for-byte port of `events.py`/`log.py` (canonical JSON, flock, fsync, strict open, transition checks). Cross-language fixture test. Tokens-only usage + price tables, not constants | S–M |
| kernel: gate | Keep and fix | Run in sandbox/temp copy with timeout. Sha256-bind protected files. Replace `*test*`/`*spec*` with explicit patterns plus per-project list. Config-pinned command, not just env | M |
| kernel: router | **Rewrite** | Ladder as data (per profile, retries, cost cap, handover payload). Router trait; port `LinearRouter` when the study needs it | M |
| kernel: lanes | **Rewrite/extend** | Overlap rejection at plan time, frozen-interface hashes, merge via gate, blame rules, events | L |
| `ship` | Keep and fix | Symlink and `O_NOFOLLOW` checks, preserve mode/mtime/symlinks, rollback on every error path, journal in app state with 0600 and crash recovery, hidden checkpoint ref, remove fake cost, move approval into core state, fuzzy opt-in, pre-write scope check | M |
| `pack` | Keep and fix | ripgrep crates and tree-sitter, context lines, ranges, symbols, globs, entropy redaction, never pack `.env`/keys, async, per-session root | M–L |
| `exec` | **Rewrite** | Real kernel with RPC back to the core (`harness.parallel`, tools as functions, `await`), separate protocol fd, sandbox, process groups, interrupt without state loss, output caps. Or reuse Hermes `code_kernel.py` via the shim | L |
| hermes-bridge: sidecar client | **Write new** | `uv` lifecycle and `hermes-gateway-v1` JSON-RPC over stdio, contract tests, version pin | L |
| hermes-bridge: `direct_sdk` | Keep and fix | Move to `crates/gateway` as a provider adapter. Apply env scrub, stream, cancel by process group, stdin prompt, version range check | M |
| hermes-bridge: discovery, cache_stabilizer | **Rewrite/delete** | Remove hard-coded paths and fake provider table. Drop the stabilizer; do prefix ordering in the gateway | S |
| compat-loader | **Rewrite** | Typed readers for the six formats, `.claude/settings.json` and `hooks/hooks.json`, `plugin.json`, `marketplace.json`, MCP, imports, translation output, precedence, trust. Keep walker, ids, fixtures | L |
| local-artifacts: store | Keep and fix | Bare repos, tags, alternates, session/turn trailers, gix, binary-safe reads, configurable identity | M |
| local-artifacts: server | **Rewrite** | Per-artifact token, Host check, real smart-HTTP git, no HTML from the API origin | M |
| apple-vm: remote_ssh, detector | Keep and fix | Pin host keys, run rsync, expose `apple.*` API | S–M |
| apple-vm: qemu_kvm | Keep as spec builder | Add VM lifecycle, snapshots, VNC stream | L |
| apple-vm: simulated | **Delete** from prod | Keep as test double behind `cfg(test)`/feature; never as an error fallback | S |
| apple-vm: EAS backend | Missing | Add | M |
| `src-tauri` command layer | **Rewrite** | Typed errors, event `Channel`, no seeding or fabricated outputs, CSP on, remove `append_ledger_event`, session-scoped roots, tracing. Keep `main.rs`/`build.rs`/`tauri.conf` | L |
| `ui/src/lib/ipc.ts` | **Rewrite** | Generated types, event subscription, typed errors; mocks into a dev-only module | M |
| `ui/` views, `LivingOrb`, `orbMath` | Out of scope | Visuals replaced by the owner's new design. `orbMath` and `LivingOrb` physics are reusable as-is | — |
| `crates/gateway`, `crates/sandbox`, `shim/`, `vendor/hermes-agent`, `study/`, CI | **Missing** | Build per plan | L each (sandbox, gateway); S–M others |

## 12. What I would keep

The reusable assets are small enough to list:

- the `ship` edit-matching and journal skeleton, plus its tests;
- the `remote_ssh` command builders;
- the `claude -p` stream-json parser;
- `local-artifacts` input validation and the git-backed test approach;
- the `ignore`-based walker and fixture style from `compat-loader`;
- pack's secret regex set (add entropy);
- the `LivingOrb`/`orbMath` code.

Start new work from the plan's W0 protocol spec, not from this contracts crate.
