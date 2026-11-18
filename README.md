# hypotaxis

A desktop coding harness that runs any model, through any subscription you already pay for, with [contraprova](https://github.com/aphesist/contraprova)'s governance built in and measured.

- **Engine:** unmodified upstream [Hermes Agent](https://github.com/NousResearch/hermes-agent). Hermes updates, plugins and skills work as they are.
- **Governance:** a Hermes plugin. A cheap model tries first, a gate the project defines decides, and only a failure buys a stronger model. Every step goes into contraprova's hash-chained ledger.
- **Three tools:** `pack` reads, `exec` computes in a sandbox, `ship` is the only way a change reaches your files, and it rolls back byte for byte when the gate fails.
- **Compatibility:** Claude Code skills, plugins, hooks, commands, subagents and MCP servers load unchanged, as do Codex, Gemini CLI, Cursor, Antigravity and Agent Skills formats.
- **App:** Tauri, with two sections, Sessions and Bots, and a dock.

## Status
Under construction. Phase 1 is the Sessions section, good enough to replace Claude Code for a week. The only measured numbers are contraprova's (on 88 fresh SWE-bench Pro tasks, on par with a single Opus at about 61% less cost per solved task). Everything hypotaxis adds is a hypothesis until its study is published.

## Read first
- `AGENTS.md`: invariants and where everything lives
- `docs/ARCHITECTURE.md`, `docs/STANDARDS.md`, `docs/DECISIONS.md`
- `design/v6/`: the approved interface design and its design system

## Licence
To be chosen by the owner.
