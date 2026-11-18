# Source of these fixtures

Real-world Claude Code plugins, copied unchanged from `anthropics/claude-plugins-official`.

- Repository: https://github.com/anthropics/claude-plugins-official
- Commit: `6d491811023d7af2c96a7fab274935922b29ed01`
- Retrieved: 2026-11-18
- Licence: Apache-2.0 (`LICENSE` in this directory; each plugin also ships its own copy)

Copied with every file except READMEs (and `scripts/` for ralph-loop): `plugins/ralph-loop`,
`plugins/explanatory-output-style`, `plugins/commit-commands`, `plugins/example-plugin`.

Copied in part, to cover one feature each, so these are not runnable plugins:
- `plugins/hookify`: manifest, `hooks/hooks.json`, two hook scripts, a skill, an agent and two commands.
- `plugins/security-guidance`: manifest and `hooks/hooks.json` only (the scripts are 600 KB).
- `external_plugins/{context7,github,playwright}`: their `.mcp.json` only.
- `.claude-plugin/marketplace.json`: the whole marketplace (190 KB, 100+ entries, every source type).

Nothing here is edited. Tests read these files and never write to them.
