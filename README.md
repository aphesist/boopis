# hypotaxis

Sovereign Rust (`Tauri v2`) Desktop Coding Harness built on an unmodified upstream **Hermes Agent** base, **Contraprova** counterfactual governance (-61% cascade routing & env-pinned gates), 3 compound execution primitives (`pack`, stateful/parallel `exec`, journaled `ship`), Git-backed Local Artifacts, universal cross-harness skill/plugin loading, Apple Bubble VM integration, and a pure Nothing OS monochrome UI with cohesive `LivingOrb` companions.

---

## Resume This Session on Another Machine (`X:\` Drive Setup)

1. **Clone & configure strict `aphesist` hooks:**
   ```powershell
   git clone https://github.com/aphesist/hypotaxis.git X:\hypotaxis
   cd X:\hypotaxis
   .\scripts\setup-hooks.ps1
   ```

2. **Point Rust & Cargo caches onto `X:\` (keeps `C:\` clean):**
   ```powershell
   $env:CARGO_HOME = "X:\.cargo"
   $env:RUSTUP_HOME = "X:\.rustup"
   $env:CARGO_TARGET_DIR = "X:\hypotaxis-target"
   ```

3. **Open `X:\hypotaxis` in Antigravity IDE / Antigravity 2.0 / `agy`:**
   `AGENTS.md` and `.agents/rules/hypotaxis-handoff.md` auto-load the complete context from our design session, along with:
   - [Architecture Plan](docs/ARCHITECTURE_PLAN.md)
   - [Approved v3 Monochrome Mockup](design/mockup_v3.html)

4. **Paste into the new Antigravity session to start Wave-1 production immediately:**
   > Read `AGENTS.md`, `.agents/rules/hypotaxis-handoff.md`, `docs/ARCHITECTURE_PLAN.md`, and `design/mockup_v3.html`, check `X:\` toolchains (`rustc`, `cargo`, `uv`, `pnpm`, `claude`, `docker`/`qemu`), scaffold `crates/hypotaxis-contracts`, and launch the 5-agent swarm across isolated worktrees on `X:\`.
