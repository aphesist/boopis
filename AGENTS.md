# AGENTS.md — Hypotaxis Workspace Instructions

Before planning or writing code in this repository, read:
1. `.agents/rules/hypotaxis-handoff.md` (complete context handoff, user preferences, zero-redundancy rules, and 5-agent swarm layout)
2. `docs/ARCHITECTURE_PLAN.md` (full architecture, crate layout, and design specifications)
3. `design/mockup_v3.html` (approved pure Nothing OS monochrome UI & `LivingOrb` 60fps engine reference)

**Mandatory First Action on Any Fresh Clone:**
Run `./scripts/setup-hooks.ps1` (PowerShell) or `./scripts/setup-hooks.sh` (POSIX) to configure `user.name = aphesist` and enforce `.githooks/commit-msg` (zero `Co-authored-by` trailers).
