# Recommended skills and plugins

boopis's own list of skills and plugins (`apps/shared/data/recommended.json`, schema `recommended.schema.json`) is what the store's
front page leads with, next to the connectors (`connectors.json`, [CONNECTORS.md](CONNECTORS.md)). They are "Recommended by boopis"
(ADR-0038) for the same reason a connector is: a person read each one against its **publisher's own repository** at the commit it
pins, and nothing here is a rating. The file is compiled into the host (`src-tauri/src/store/recommended.rs`), turned into store items by
`normalize::boopis_skills_and_plugins`, and installed by the ordinary skill and plugin path, so the review card and the hold apply
exactly as to any other item.

## What was checked for each entry
- **The publisher's repository and commit.** The entry pins a full 40-character commit of the publisher's own repository, never a
  branch. Plugins of Anthropic's marketplace are pinned at the commit of `claude-plugins-official` the marketplace file was read at;
  a plugin that lives in its author's repository (Superpowers) is pinned at the commit the marketplace itself names for it.
- **The manifest.** The skill's `SKILL.md` or the plugin's `.claude-plugin/plugin.json` was read at that commit, its name matches
  the entry's id, and its SHA-256 is recorded (`verified.manifest`), so a later reader can tell the file they read is the one that was read.
- **The licence.** From the publisher's own files: the skill's `LICENSE.txt`, the plugin's `LICENSE`, the repository's `LICENSE`,
  or, where there is none, the licence the publisher states in the skill itself (`verified.license_note` says which). An item with no stated licence is not listed.
- **What it runs.** Skills and plugins with a script or a hook still show it on their review card (`Runs`); nothing here hides it.

## The order
Each kind is ordered by its own **cited popularity signal**, most used first, read on one date and recorded with the entry:
- **Skills: installs on skills.sh** (`skills-sh-installs`), the all-time count the open skills directory shows on each skill's own
  page, as it shows it (rounded: `1.2M`, `921.7K`; `popularity.shown`, and the number it stands for in `installs`). It counts
  installs made with the `skills` command-line tool, so it measures use, not review.
- **Plugins: installs in Anthropic's plugin directory** (`claude-directory-installs`), the exact Installs figure on each plugin's
  page at `claude.com/plugins/<name>`.
The two have no common scale, and neither is comparable with the connectors' GitHub stars, so no single ranking across the kinds
would be honest. The store keeps each kind in its own order and lets the kinds take turns (connector, plugin, skill, connector, ...)
on the front page and in Browse (`normalize::weave`), so the most used of every kind comes before the second most used of any. Within a
search, relevance leads. Each item's page says which count placed it and when it was read ("Why it is listed here").

`scripts/read-recommended-popularity.py` reads both signals again; the `popularity` job of `.github/workflows/live-store.yml` runs it every
week and says when the recorded order no longer follows them. Reorder only after reading the entries from their sources again. A unit test
(`recommended::tests`) holds the file to the order, to full commits, to a stated licence and to a count that agrees with what the page showed.

## Entries
Read on 22 November 2026. Counts are as the page showed them on that day; the run that read them again is recorded in the file's `popularity` evidence and listed below.

### Skills (skills.sh installs)
| Skill | Publisher | Repository and folder | Commit | Licence | Installs |
|---|---|---|---|---|---|
| Frontend Design | Anthropic | `anthropics/skills` `skills/frontend-design` | `e4bb5d96` | Apache-2.0 | 1.2M |
| React Best Practices | Vercel | `vercel-labs/agent-skills` `skills/react-best-practices` | `5a37a632` | MIT | 921.7K |
| Code Review | Matt Pocock | `mattpocock/skills` `skills/engineering/code-review` | `abeeaf95` | MIT | 920.9K |
| Postgres Best Practices | Supabase | `supabase/agent-skills` `skills/supabase-postgres-best-practices` | `c9be0e93` | MIT | 494.2K |
| Skill Creator | Anthropic | `anthropics/skills` `skills/skill-creator` | `e4bb5d96` | Apache-2.0 | 439.1K |
| PowerPoint decks | Anthropic | `anthropics/skills` `skills/pptx` | `e4bb5d96` | Apache-2.0 | 261.0K |
| PDF files | Anthropic | `anthropics/skills` `skills/pdf` | `e4bb5d96` | Apache-2.0 | 234.8K |
| Word documents | Anthropic | `anthropics/skills` `skills/docx` | `e4bb5d96` | Apache-2.0 | 223.6K |
| Web app testing | Anthropic | `anthropics/skills` `skills/webapp-testing` | `e4bb5d96` | Apache-2.0 | 211.3K |
| Spreadsheets | Anthropic | `anthropics/skills` `skills/xlsx` | `e4bb5d96` | Apache-2.0 | 203.6K |
| MCP server builder | Anthropic | `anthropics/skills` `skills/mcp-builder` | `e4bb5d96` | Apache-2.0 | 145.9K |

### Plugins (installs in Anthropic's plugin directory)
| Plugin | Publisher | Repository and folder | Commit | Licence | Installs |
|---|---|---|---|---|---|
| Frontend Design | Anthropic | `anthropics/claude-plugins-official` `plugins/frontend-design` | `73c8cf3e` | Apache-2.0 | 1,134,112 |
| Superpowers | Jesse Vincent | `obra/superpowers` | `22f0b463` | MIT | 1,009,371 |
| Code Review | Anthropic | `anthropics/claude-plugins-official` `plugins/code-review` | `73c8cf3e` | Apache-2.0 | 438,525 |
| Code Simplifier | Anthropic | `anthropics/claude-plugins-official` `plugins/code-simplifier` | `73c8cf3e` | Apache-2.0 | 346,763 |
| CLAUDE.md Management | Anthropic | `anthropics/claude-plugins-official` `plugins/claude-md-management` | `73c8cf3e` | Apache-2.0 | 287,247 |
| Feature Development | Anthropic | `anthropics/claude-plugins-official` `plugins/feature-dev` | `73c8cf3e` | Apache-2.0 | 256,017 |
| Claude Code Setup | Anthropic | `anthropics/claude-plugins-official` `plugins/claude-code-setup` | `73c8cf3e` | Apache-2.0 | 195,067 |
| Commit Commands | Anthropic | `anthropics/claude-plugins-official` `plugins/commit-commands` | `73c8cf3e` | Apache-2.0 | 171,244 |
| PR Review Toolkit | Anthropic | `anthropics/claude-plugins-official` `plugins/pr-review-toolkit` | `73c8cf3e` | Apache-2.0 | 114,856 |

## What is left out, and why
The most used is not the same as the most suitable for an app that installs them: these were read and not listed.
- **`find-skills`** (vercel-labs/skills, 4.5M installs, the most installed) and **`agent-browser`** (vercel-labs/agent-browser, 1.6M): each drives a
  command-line tool that has to be installed separately; the first searches for skills with `npx skills`, which the store replaces.
- **`grill-me`** (mattpocock/skills, 1.6M): it only calls another skill (`grilling`) and does nothing alone. Code Review from the same repository stands alone.
- **`web-design-guidelines`** (vercel-labs/agent-skills, 890.8K): neither the skill nor the repository states a licence.
- **Remotion's skills** (remotion-dev/skills): the skills' own licence page sends to Remotion's pricing to buy a licence, and boopis does not recommend what its user may have to pay for.
- **`hyperframes`, `lark-*`, `azure-*` and the other vendor-specific packs** that fill the top of skills.sh: each is for one vendor's product, so they are not a recommendation for everyone.
- **Plugins `context7`, `github`, `playwright`, `chrome-devtools-mcp`, `supabase`, `atlassian`, `slack`, `figma`**: the same servers are in the connector list, which pins what runs.
- **Plugins `typescript-lsp` and `pyright-lsp`**: they need a language server installed on the computer first.
- **Plugin `security-guidance`** (241,800): its session-start hook builds a Python environment and installs the Agent SDK into `~/.claude/security`, and its hooks review code with a model, which is more than a first recommendation should do unseen.
- **Plugin `ralph-loop`** (196,527): a stop hook that keeps a session looping until it decides it is done.
- **Plugins `vercel`, `telegram`, `serena`**: not read for this list yet.
Any of them is still in the store, from the source it comes from, as "Verified by its source" or "Not reviewed".

## Adding or updating an entry
1. Read the publisher's repository at one commit: the `SKILL.md` or `plugin.json`, the licence file, and what the files run.
2. Read the signal's page for the entry (`skills.sh/<owner>/<repo>/<skill>`, `claude.com/plugins/<name>`) and record the figure as shown.
3. Put the entry in its place in the array (most used first), with its commit, its manifest hash, the pages it was read from and the count.
4. Run `cargo test -p boopis-host --lib store::recommended` and `store::normalize`, and `scripts/read-recommended-popularity.py` to see the order.

