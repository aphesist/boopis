# Hypotaxis — Session Context & Engineering Rules

You are continuing work on **Hypotaxis** (`https://github.com/aphesist/hypotaxis`), a sovereign **Rust (`Tauri v2`) Desktop Coding Harness** built upon an unmodified upstream **Hermes Agent** base (`vendor/hermes-agent` via `uv`).

Read `docs/ARCHITECTURE_PLAN.md` and inspect `design/mockup_v3.html` before modifying code.

---

## 1. Non-Negotiable User Constraints

1. **Strict `aphesist` Authorship & Zero Co-Authoring:**
   - Every git commit MUST have `user.name = "aphesist"` and `user.email = "126630868+aphesist@users.noreply.github.com"`.
   - **NEVER** include `Co-authored-by:`, `Signed-off-by:`, `Generated-by:`, or `AI-assisted:` trailers in any commit message or PR description.
   - Immediately after cloning on a new machine, run `./scripts/setup-hooks.ps1` (Windows) or `./scripts/setup-hooks.sh` (Linux/macOS) to activate `.githooks/commit-msg`.
2. **Drive & Cache Placement (`X:\` on User's Primary Machine):**
   - Keep `C:\` free of heavy toolchains and build caches. When working on the machine with an `X:` drive, place the clone (`X:\hypotaxis`), git worktrees (`X:\hypotaxis-wt\*`), `CARGO_HOME`, `RUSTUP_HOME`, and a **single shared `CARGO_TARGET_DIR`** (`X:\hypotaxis-target`) on `X:\`.
3. **Architecture Stance:**
   - Neither a Hermes plugin nor a divergent Hermes fork. Rust owns the desktop shell (`src-tauri`), governance kernel, 3-primitive execution engine, cross-harness loader, local Git artifacts server, and Apple VM orchestrator; upstream Hermes runs cleanly behind `crates/hermes-bridge` via `uv`.
4. **Subscription Priority:**
   - User actively uses a **Claude subscription** (prioritize `claude-subscription-directsdk` local `claude` CLI `stream-json` relay), plus Gemini / Nano Banana and local/Chinese OpenAI-compatible models (DeepSeek, Qwen3-Coder, GLM, Ollama). User does **not** have a Codex subscription.
5. **macOS / Apple VM Strategy:**
   - User does **not** currently own a physical Mac. Inside `crates/apple-vm`, support `RemoteAppleSshRunner` (SSH/Tailscale pairing) + `SimulatedAppleRunner` (deterministic local Xcode/Simulator test runner for dev/CI) alongside `QemuKvmRunner` (Docker/QEMU + OpenCore + VirtioFS launcher when QEMU/Docker are present).

---

## 2. Zero-Redundancy Technical Synthesis

| Crate | Exclusive Responsibility | Reference Sources Merged |
| :--- | :--- | :--- |
| `crates/contraprova-kernel` | Hash-chained append-only JSONL ledger (9 event types), frozen Contract Lanes, Tier-1 → Tier-2 → Tier-3 Cascade Router (-61% SWE-bench Pro cost), and Kernel Gate (`scope:` globs, immutable test fence, env-pinned `$HARNESS_GATE_CMD`). | `aphesist/contraprova` |
| `crates/turn-primitives` | Exposes **exactly 3 worker tools**: (1) `pack` (1-call ripgrep + AST outlines + secret shield), (2) `exec` (persistent stateful Python REPL + async parallel tool calls, retiring Turnpack `batch`), (3) `ship` (fuzzy pre-write validator `AbortedBeforeWrite` + byte-exact rollback journal piped directly into Contraprova's Kernel Gate). | `@RayaneRachid_` *Unharnessed* + `@TekonBurns` *Code Mode* + `@OnlyTerp` *Turnpack* |
| `crates/hermes-bridge` | Versioned IPC/JSON-RPC bridge to unmodified Hermes + `Message.cache_upto` (>= 512 tok) & header-normalizing KV-cache stabilizer (97.99% hit rate) + `claude-subscription-directsdk` relay + Nano Banana + local models. | Hermes Agent (`DirectSDK`) + Contraprova cache study |
| `crates/compat-loader` | Natively loads Hermes plugins/skills, `.claude/` (`skills`, `commands`, `agents`, `hooks.json`, `.mcp.json`), `.cursor/rules/*.mdc`, Codex `AGENTS.md`, and Antigravity `SKILL.md`. | Cross-harness interoperability |
| `crates/local-artifacts` | Loopback Git HTTP server (`127.0.0.1:<port>/git/<ns>/<id>.git`), O(1) Copy-on-Write `fork()`, virtual `ArtifactFS`-style tree reader, and generic previewer. | `@dinasaur_404` Cloudflare Local Artifacts |
| `crates/apple-vm` | `RemoteAppleSshRunner` (Tailscale/SSH `xcodebuild`), `QemuKvmRunner` (OpenCore/KVM/Docker-OSX), and `SimulatedAppleRunner`. | macOS / iOS Simulator integration |

---

## 3. Design Contract (`design/mockup_v3.html`)

- **Palette:** 100% pure neutral achromatic grays (`R === G === B`) in **Carbon** (`#000000`, `#080808`, `#0E0E0E`, `#141414`, `#1B1B1B`) and **Paper** (`#F7F7F5`, `#EFEFED`, `#FFFFFF`) + surgical **Nothing OS Crimson (`#D71921`)** on max 2–3 micro-signals. **Zero blue/slate-tinted grays anywhere.**
- **Layout & Sections:** Follows Hermes `apps/desktop/DESIGN.md` *"Flat, not boxed"* with a top-left `[ Sessions | Bots ]` switcher:
  - **Section A (`Sessions`):** Antigravity/Codex cleanliness, 1-line `pack()` trace, `@liu_xingyu` Intra-Turn `LeavingBlanks` & `Feedforward` composer, `CardStack` × `@cheatyyyy` / `dithercn` 1-bit ordered Bayer8 animated smoke Gate/Approval card, and Git-backed Local Artifacts drawer.
  - **Section B (`Bots`):** Bespoke **Living Crew Dock** + **Active Teammate Desk** (reacts to typing in composer, `CardStack` approvals, floating Lucent capsule composer, toggleable `16:10` Apple Bubble VM stage) + **Nothing × Orb Sculptor Studio**.
- **Cohesive `LivingOrb` Companion Engine (`aphesist/orb`):** All companions share one 96-vertex soft-body sphere (`2.2×` anti-clip canvas) with floor-plane squash + dynamic ground shadow, 6-DOF Fourier jelly harmonics, 32-vertex smoothstep expression morphing (`340ms`) across 5 eye archetypes (`capsule`, `slit`, `round`, `crescent`, `matrix`), spherical exponential-map 3D foreshortening, autonomous `sleeping` (`z` particles + hover wake), drag-to-turn, and 3-stage escalating click-poke (`surprised` → `happy ^ ^` → `dizzy`).

---

## 4. 5-Agent Multi-Agent Build Blueprint (Isolated Worktrees)

When starting implementation on the build machine:
1. Create `crates/hypotaxis-contracts` first on `main` (frozen shared types) and verify `cargo check`.
2. Spin up 4 isolated git worktrees + 1 read-only verifier sharing a single `CARGO_TARGET_DIR`:
   - `@kernel-agent` (`crates/contraprova-kernel`, `crates/turn-primitives`)
   - `@bridge-compat-agent` (`crates/hermes-bridge`, `crates/compat-loader`)
   - `@artifacts-vm-agent` (`crates/local-artifacts`, `crates/apple-vm`)
   - `@ui-shell-agent` (`src-tauri/`, `ui/` — React 19 + Tailwind v4 + Tauri v2)
   - `@verifier` (`cargo test --workspace`, `pnpm --dir ui build`, `cargo check --manifest-path src-tauri/Cargo.toml`, plus `git log` authorship & zero-trailer check).
