# Release plan: 0.1.8 and 0.1.9

Written 22 November 2026, when the owner split the release: "0.1.8" ships the fixes from their testing on Arch Linux and
Windows, then "0.1.9" ships the extras they asked for. Update this file as items land; remove it when 0.1.9 is out.

## 0.1.8: the fixes

Integration branch: `w26/integrate` (from `main` at f2bcaba3). Every branch below merges there, then the whole set is
checked and released.

| Branch | What it fixes | State |
|---|---|---|
| `w25/lab-first-run-shots` | The lab screenshots the first-run screens whole (they were 24 px strips), and a lab check reports a control cut off by a box that does not scroll that way (it caught the Store dialog). | merged |
| `w24/first-run-window` | Windows (and every desktop): the first-run screens and other full-window layers keep the window's own close, minimise and maximise, drag and double-click; edge resize and Snap proven on `windows-latest` (`desktop-window.yml`). | merged |
| `w24/signin-net` | TLS named on every HTTPS agent (the ChatGPT sign-in panicked on Windows), plain words for every sign-in, key, endpoint and local-runtime failure, long tokens kept in parts in the Windows keychain, real key checks for providers whose model list is open, and the live sign-in probe (`live-signins.yml`, weekly). | merged |
| `w24/claude-cli` | Claude Code found where its installers put it (npm's folder on Windows included), a calm "not installed" card with Anthropic's installer instead of a red "failed", and a CI job that installs it for real on Windows and Linux (`claude-cli.yml`). | merged |
| `w24/store` | The Store dialog fits at every width, sources read when due and say why when they cannot (needs `w24/signin-net`'s TLS fix), the popular connectors lead (ordered by the GitHub stars of each official repository, read on a recorded date, refreshed weekly). | merged |
| `w24/team` | Bots get the engine plugins they need in their own homes (the Claude subscription, ChatGPT, Copilot and SuperGrok sign-ins, keychain keys), groups can seat every bot, governance for bots is opt-in, failed room turns in plain words, the "install out of sync" notice, the roster's model and display name, other-OS skills off; `boopis bots create|set|list` if ready. | in progress |
| `w24/bot-looks` | A bot draws its saved look everywhere (the roster and dock drew another), the group member stack is consistent and never covers the group's name in the sidebar, and a bot's look can be edited. | in progress |
| `w24/chat` | The bots' chat, direction A ("Ledger"): one markdown renderer for every chat, mention chips that open the bot, links and clickable paths, code blocks with copy, the "to you" line, a pending entry where the reply will land, arrival motion. | in progress |
| `w24/grey-window` | The window going grey and unresponsive after switching workspaces: the cause, and a watchdog that recovers the page instead of leaving it grey, with diagnostics. | in progress |
| `w25/dock-fit` | The dock row and the expanded dock fit the window with many bots, and the rail's account button fits the rail. | in progress |
| `w24/orbs-size` | Orbs never blink empty when a bot changes state, and an interface size setting in Settings > Appearance. | in progress |
| `w24/rooms` | The owner's round 2 (seven bots, two rooms). B16: a new message in a room must never silently cancel a running bot's turn ("Send when done" by default, "Send now" says it stops the turn). Classify and mitigate B17 (a cancelled turn's kanban tasks created twice), B18 (dependent tasks without parent links), B19 and B21 (one bot running in a room and a kanban worker at once). Engine-only parts become upstream drafts. | in progress |

Round 2 also covers B13 (every new bot needs the plugin and room fixes, including bots made outside boopis: `w24/team`) and
B20 (a mention of a bot that isn't in the room: `w24/chat`). B14 (a SOUL that includes a project file and flags dead paths)
and B15 (steering a bot mid-turn without stopping it, unless the engine already offers it) are 0.1.9.

Already released from this round (on `main`): the Windows installer picks the newest pre-release alone in Windows
PowerShell 5.1; the Arch menu entry names its icon by absolute path; CI runs the desktop smoke.

### Owner decisions made on the way (record each in its ADR at merge)
- **Bot governance is opt-in per bot.** A bot runs ungoverned unless the owner turns Governed on in its settings, whatever its
  model. Turning it on needs a frontier model (ADR-0037). Existing bots become ungoverned on upgrade with one notice. The
  main window's sessions keep their defaults. Reason, in the owner's words: "the bot pipeline is already a governance of some
  kind, you just configure it manually."
- **The group member stack keeps its overlapping orbs** ("looks cool"), made consistent, and never drawn over text.
- **Bot chat:** direction A now, direction B (the huddle) in 0.1.9. The owner chose from rendered concepts.
- **Claude Code:** no button that runs the installer: copy, paste and Check again (ADR-0029).

### Before releasing 0.1.8
1. Merge the remaining branches into `w26/integrate`, resolving conflicts (lab goldens are re-accepted on the merged code,
   never taken blindly).
2. Gates on the merged code: `pnpm typecheck`, `pnpm test`, `pnpm test:smoke` (its 700 ms boot settle fails on a heavily
   loaded machine: run it when the machine is quiet), `pnpm lab:check` with 0 failures, `cargo fmt --all --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test -p boopis-host`, the plugin suite.
3. CI on `w26/integrate`: `ci.yml`, `desktop-window.yml`, `claude-cli.yml`, `live-signins.yml`.
4. Previews of every fix (dark and light) for the owner.
5. Version 0.1.8 everywhere (`docs/RELEASING.md`), merge to `develop` and `main` through CI, dispatch `release.yml`,
   verify the assets against `SHA256SUMS`, send the owner the Arch package, the AppImage and the Windows installer.

## 0.1.9: the extras (paused until 0.1.8 is out)

Each branch holds what its agent finished before the pause; the last commit on each is an unfinished work-in-progress
commit whose tests have not run. Resume from there.

| Branch | Scope | State at the pause |
|---|---|---|
| `w25/team-cli` (from `w24/team`) | `boopis groups create\|send\|log\|list`; `boopis run --group <group> "<task>"`, which continues a discussion with `groups.continue` up to boopis's own cap; a per-room max-rounds setting; `boopis team apply\|export` for a whole team (bots, rooms, kanban boards, cron jobs) as one YAML file, idempotent, with `--dry-run`. | WIP 64a1b71e |
| `w25/bots-extras` | Connectors per bot in Settings > Connectors and `boopis connectors add --bot` (non-interactive, through the gateway's `mcp.servers.*`); a read-only kanban board view per group; a cron job's delivery room shown in words in a bot's schedule. | WIP 9f2ba454 |
| `w25/island-api` | For other local clients (the owner's Quickshell island first): the look in the roster and `bots.changed`, a presence feed across every bot and source (orb2 state words), notifications, an approvals inbox answered from any client (first answer wins, policy kept), `bots.say`, a client tag, `boopis connect --json` with a documented local contract, and an opt-in loopback HTTP and SSE endpoint with a rotating token file and Host and Origin checks. ADR first. | WIP d8ce8bca |
| `w25/store-more` (from `w24/store`) | Progress per source while reading, sources read again while the store stays open, "This list is out of date" explained, Recommended skills and plugins curated by popularity with cited sources. | 177384b1 |
| `w24/chat` | Direction B, the huddle: the bots' own rounds fold into one disclosure. | not started |

### Facts found on the way
- The engine reads `hosted_rooms.discussion.max_rounds` and `hosted_rooms.discussion.max_messages` (startup, native
  server-hosted rooms, `tui_gateway/hosted_room_service.py` `_discussion_limits()`). They look global, not per room: the
  per-room cap is boopis's own, enforced in `boopis run`, with the engine's keys set high enough.
- The engine's own `hermes mcp add` cancels without a terminal, so boopis never drives that command.

### Engine reports, waiting for the owner to send
Five reports were checked against the engine's v0.23.2 and its `main`. They could not be filed from here (no write access
to the engine's repository), so the owner has them as paste-ready files:
- B5, a new bug;
- B10, a feature request;
- B4 and B7, comments on open issues #31970 and #156311;
- B6, a low-severity security note for the engine's private channel, if the owner chooses to send it;
- a cover email and a Discord message.
B9 was dropped: the round cap is configurable (above).
