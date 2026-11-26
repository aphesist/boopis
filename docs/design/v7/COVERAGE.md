# The v7 coverage map

One table of everything the app has, and what each thing is built from: an approved board, a recorded owner decision, or
neither (then it is **derived** and the owner sees it before it ships). The owner: "the boards didn't draw every single
screen possible, or every state that exists in the system." This file is how nothing is forgotten and nothing is invented
silently. It is rule 6 of `REPASS.md` ("Nothing invented") made checkable.

Written 25 November 2026 against `w33/repass` at 7d41b42f and `origin/w33/boards-archive`.

## How to read it

Each row is one screen or one distinct state (empty, loading, error, held, needs you, disabled, long, many). Hover, focus
and pressed states of a control have no rows: the kit's stories cover them.

| Column | What it says |
|---|---|
| **Screen or state** | what the person sees |
| **Exists today?** | `yes`, `partly` or `no` in the app on `w33/repass`, with the module (under `apps/desktop/ui/src/`) or the lab story id |
| **Reference** | `board` with the exact file on `origin/w33/boards-archive` (`*` stands for `dark` and `light`); or `decided` with the owner's words and where they are recorded; or `derived` with the nearest board and the kit components it is composed from; or `unknown` with the reason |
| **Feature** | `works today`; `0.2.0 C`, `D` or `E` (the waves of `PLAN-0.2.0.md`); `0.3.0 S1`, `S2` or `S3` (`PLAN-session-waves.md`); `unknown` with the reason |
| **Repass** | `matched, step N` (REPASS.md's table); `not started (step N)` where the table names the board; `not started (no step)` where it does not; `built at step N (derived)` for a derived part that a step built and the owner has not approved yet |

Where the documents are: the plans are on `origin/notes/parked-work` (`docs/PLAN-0.2.0.md`, `docs/PLAN-session-waves.md`,
`docs/PLAN-w31-foundations.md`, and the lead's notes `docs/ORCHESTRATOR.md`); the written spec is on `origin/w31/design-system-v7` (`docs/design/v7/DESIGN-SYSTEM.md`,
`SESSION-TAB.md`) and `origin/w32/session-specs` (`docs/specs/*`); the notch's spec is `notch/notch-spec.md` in the archive.
None of them is on `w33/repass` (see "Conflicts and doubts", 34).

**Which board is the reference where two draw the same part** (REPASS.md): K02 (`bots/K02-*`) for the open Bots sidebar and
a held message; boards 11, 12 and 17 as `botscreens.js` draws them for those threads; dock K01 to K08 over board 16;
onboarding round 3 (`onboarding/screens/O-*`) over rounds 1 and 2; `session/S17` to `S41` over `session-cards/S1` to `S20`.

**Boards that record a choice and are not screens to build:** `v7/01` to `09` and `P1` to `P4` (fonts, radii, shadows, orb
surface, chrome, rail tile, composer, calm options, accent, search, the mark, status); `session/S01` to `S07` and
`S41-new-session-board.jpg` (the options) and `S08` to `S16` (the parts); `dock/D01` to `D03`, `DK1`, `DK2`;
`onboarding/boards/O01` to `O04`, `C01`, `C02`; `bots/K01`, `K07` to `K09`, `K02-main-bot.jpg`. The options the owner did
not pick on them (the scale as one track, the inbox as chips, the scope as a select, the dock in pages, marks B, C and D)
are not built. The picks are in `PLAN-session-waves.md` and `PLAN-w31-foundations.md`.

## How to keep it

1. A builder who converts a screen changes its **Repass** cell in the same commit as REPASS.md's table.
2. A screen or state found in the app that has no row gets one before it is restyled. If no board draws it, it is `derived`
   and goes on list 2; it is rendered in the lab from kit components only and sent to the owner in its batch.
3. When the owner approves a derived render, its Reference becomes `board` with the approved image's path (`boards.json`
   marks it "derived, approved").
4. A new owner decision is quoted here and in REPASS.md on the day it is made.
5. Two sources that disagree go on list 3 with both sides quoted exactly. Nobody resolves one here; the owner does.

## Counts (as written; update them with the rows)

| Area | Rows | board | decided | derived | unknown |
|---|---|---|---|---|---|
| 1. Shell and chrome | 24 | 13 | 2 | 9 | 0 |
| 2. Sidebar and rail | 32 | 15 | 2 | 15 | 0 |
| 3. Bots: a bot's chat | 26 | 7 | 0 | 19 | 0 |
| 4. Bots: rooms | 24 | 8 | 0 | 16 | 0 |
| 5. Session: new session and launch | 16 | 9 | 3 | 4 | 0 |
| 6. Session: a running and finished session | 43 | 23 | 4 | 16 | 0 |
| 7. Session: panels, commit, inbox, menus | 22 | 12 | 1 | 9 | 0 |
| 8. Composer | 45 | 24 | 5 | 16 | 0 |
| 9. Dock | 22 | 13 | 4 | 5 | 0 |
| 10. Cards, forms and approvals | 24 | 9 | 3 | 12 | 0 |
| 11. Settings | 28 | 10 | 6 | 12 | 0 |
| 12. Store and Connectors | 17 | 4 | 0 | 13 | 0 |
| 13. Models and sign-ins | 13 | 4 | 0 | 9 | 0 |
| 14. Mods | 10 | 1 | 0 | 9 | 0 |
| 15. Onboarding and first run | 19 | 11 | 1 | 7 | 0 |
| 16. Dialogs, menus, palette, notices, tooltips | 16 | 5 | 0 | 11 | 0 |
| 17. Errors, empty, offline, engine states | 18 | 8 | 1 | 9 | 0 |
| 18. Notch (macOS) | 18 | 14 | 3 | 0 | 1 |
| 19. Narrow widths and density | 14 | 1 | 3 | 9 | 1 |
| **All** | **431** | **191** | **38** | **200** | **2** |

A `board` row can still hold a derived part or a conflict: its Reference cell says so.

---

## 1. Shell and chrome

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The floating chrome: sidebar toggle, title pill, search hint, details button, window glyphs | yes, `modules/shell/chrome.ts`, story `v7/chrome` | board `v7/11-bot-chat-rail-*.jpg` (the pick: `v7/05-chrome.jpg` A) | works today | matched, step 1 |
| Title pill of a bot: its orb and name | yes, `v7/chrome` "a bot open" | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| Title pill of a room: the members' stack and the name | yes, `v7/chrome` "a room open" | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| Title pill of a new session: the session glyph and "New session" | yes, `v7/chrome` "the Sessions tab" | board `session/S17-new-session-*.jpg` | works today | matched, step 1 |
| Title pill of a started session: the glyph, the title, the branch in mono | partly, the title is drawn, the branch is not checked | board `session/S20-running-supervised-*.jpg` | works today | not started (step 4) |
| Title pill with a long name | yes, `v7/chrome` "a long name" | derived: `v7/11` pill; kit WindowChrome, one line with an ellipsis | works today | built at step 1 (derived) |
| Title pill while a turn runs (the spec's "title running": a StatusLine inside) | no | derived: spec 21.2 component 1 names the state, no board draws it; kit StatusLine | unknown: no plan names it | not started (no step) |
| Chrome with nothing open: title "Sessions", no session | yes, `v7/chrome` "no bots, no sessions"; `modules/session/conversation.ts` `titleOf` (no folder to start in), `modules/shell/attention.ts` (no session) | board `session/S41-no-project-*.jpg` | works today | matched, step 6b (S41: the chrome 0.00%) |
| Chrome in the Bots tab with no bot open | yes | derived: `onboarding/screens/O-X04-bots-later-first-open-*.jpg`; kit WindowChrome | works today | not started (no step) |
| Search as the hint "Search ctrl K" (opens the palette) | yes, `modules/shell/chrome.ts` | decided: "Search default S5: keyboard-first with a clickable hint; button and pill as Settings options" (PLAN-w31-foundations, final round); drawn on `v7/11` | works today | matched, step 1 |
| Search as a button, as a pill, or hidden (the Settings options) | no | board `v7/P2-search-placements.jpg` and `v7/05-chrome.jpg` B | 0.2.0 C | not started (step 7) |
| Window glyphs: minimise, maximise, close | yes, `host/window-controls.ts` | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| Window glyphs: close alone (a tiling desktop) | yes, story `shell/title-bar` | derived: `v7/11` glyphs; kit WindowChrome | works today | not started (no step) |
| Window glyphs on macOS (close, minimise, zoom, on the left) | yes, story `shell/title-bar` | derived: no board draws macOS; kit WindowChrome | works today | not started (no step) |
| Back and forward: keys and palette only, no buttons | yes, `modules/shell/history.ts` | board `v7/05-chrome.jpg` A ("back and forward move to keys and the palette") | works today | matched, step 1 |
| Tooltip on a chrome button (name and keys) | yes, story `shell/title-bar` "sidebar button tooltip" | derived: no board draws a tooltip; kit Tooltip (spec 21.2 component 29) | works today | not started (no step) |
| Dark and light theme of every screen | yes | board: every key screen is a `-dark` and `-light` pair | works today | per screen |
| Accent (Iris by default, a hex of the owner's choice per theme) | partly, `components/v7/theme.ts` takes it; no setting on v7 yet | board `v7/P1-accent.jpg`; decided: "accent Iris (#5b5bd6 / #8b8dff / #4546c8)" (PLAN-w31-foundations) | 0.2.0 C | not started (step 7) |
| Corners: standard (B) and rounder (C) | partly, the kit takes `radii`; no setting on v7 yet | board `v7/02-radii.jpg`; decided: "02 radii B default, C as a theme option" | 0.2.0 C | not started (step 7) |
| Light-theme shadows A, "customizable per theme" | partly, the kit takes `shadow` | board `v7/03-light-shadows.jpg` | 0.2.0 C | not started (step 7) |
| Interface size 100%, 112%, 125% | yes, `modules/shell/ui-size.ts`, story `shell/interface-size` | derived: no board; every screen at the web view's zoom | works today | not started (no step) |
| Keyboard regions: F6, F8, the go-to leader, the focus ring | yes, `modules/shell/regions.ts` | derived: `dock/DK1-the-row.jpg` draws the Iris focus ring on one orb; no other board draws focus | works today | not started (no step) |
| A module that failed to mount: a plain notice in its slot | yes, `modules/shell/index.ts` | derived: no board; kit EmptyState | works today | not started (no step) |
| Reduced motion (orbs reduce, sweeps stop) | yes | decided: "reduced motion reduces and never freezes" (owner decision in `modules/bots/orbs.ts`); `onboarding` sheet strip O-M1r | works today | not started (no step) |

## 2. Sidebar and rail

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Open Bots sidebar: the Sessions / Bots switch and "+", boopis at 44, rows of 28 orbs, "Groups", the foot | yes, `modules/bots/list.ts`, story `v7/sidebar` | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Bot row at rest, working ("Writing the changelog"), asleep, current | yes | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Bot row that needs you: the line in amber and the amber dot at the row's end | yes | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Bots sidebar with boopis alone (no bot of your own) | yes, `v7/sidebar` "no bots" | board `onboarding/screens/O-B01-boopis-greets-*.jpg` | works today | not started (step 8) |
| Bots sidebar with one bot | yes, `v7/sidebar` "one bot" | derived: K02-12; kit ListRow | works today | built at step 3 (derived) |
| Bots sidebar with 120 bots, scrolling | yes, `v7/sidebar` "120 bots, scrolling" | derived: K02-12; kit ListRow, the scroll edge | works today | built at step 3 (derived) |
| A long bot name; the "made outside boopis" mark | yes, `modules/bots/outside.ts`, `v7/sidebar` | derived: K02-12 row; kit ListRow, a quiet mono capsule | works today | built at step 3 (derived) |
| Bots changing state live in the list | yes, story `bots/roster` "live updates of several bots" | derived: K02-12 rows; `bots/ORBS.md` state table | works today | built at step 3 (derived) |
| "Groups": a room row (stack at 24, name, who spoke last) and the current room | yes, `v7/sidebar` "the groups" | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Groups of one to six members, several rooms, a long room name | yes, story `bots/roster` | derived: K02-12 group row; kit `kitStack` | works today | built at step 3 (derived) |
| "Archived" group of bots and rooms, folding, with Restore | yes, story `bots/roster` "archived group open" | derived: `session/S30-session-inbox-*.jpg` ("Settled 12", a folded head); kit SectionHead | works today | built at step 3 (derived) |
| "+" in the sidebar head: the New menu (New bot, New group; New group disabled with one bot) | yes, `modules/shell/actions.ts` | derived: K02-12 draws the "+" alone; kit Menu | works today | built at step 3 (derived) |
| Foot of the Bots sidebar: you, Store, Settings | yes, story `v7/sidebar` "the foot" | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Foot of the Sessions sidebar: Store and Settings, no "you" | yes | board `session/S17-new-session-*.jpg` | works today | matched, step 1 |
| Attention on the switch (a dot on Sessions or Bots when the other tab needs you) | partly, `modules/shell/attention.ts` counts it; v7 draws no dot | derived: no board draws it (an open owner question); nearest `notch/stills/08-stage-idle.jpg` (the red dot on "Rooms") | works today | not started (no step) |
| Open Sessions sidebar as an inbox: Needs you, Working, Pinned, Recent, Settled folded | yes, `modules/session/list.ts` | board `session/S17-new-session-*.jpg` (the pick: `session/S03-session-inbox.jpg` A) | partly: the sections are today's facts; pin, snooze and settle are 0.3.0 S1 | matched, step 1 |
| Session row: the model's mark, title, branch and time, "Approval" badge or the working dot | yes | board `session/S17-new-session-*.jpg` | works today | matched, step 1 |
| Sessions sidebar with no sessions: the switch and "+", "No sessions yet" | yes, `modules/session/list.ts` (the kit's EmptyState in a list), stories `shell/sidebar` "no sessions", `kit/empty-state` "in a list" | board `session/S41-no-project-*.jpg` | works today | matched, step 6b (S41: the sidebar 0.00%) |
| Sessions sidebar with one session, with 150 scrolling, with long titles | yes, story `shell/sidebar` | derived: S17 list; kit ListRow | works today | not started (no step) |
| Session row hovered: Snooze and Settle; the "Snooze until" menu | no | board `session/S30-session-inbox-*.jpg` | 0.3.0 S1 | not started (step 6) |
| Session row's menu (Rename, Fork, Settle) and renaming in place (F2) | partly, `modules/session/list.ts` (the context menu) | derived: S30 menu; kit Menu, Field | Rename works today; Fork 0.3.0 S2; Settle 0.3.0 S1 | not started (no step) |
| "Settled" opened: the settled sessions listed | partly, archived sessions are the settled ones | derived: S30 ("Settled 12" folded); kit SectionHead, ListRow | 0.3.0 S1 | not started (no step) |
| Sessions sidebar grouped by day ("Today 3", "Yesterday 3", times) | no | board `v7/13-session-sidebar-open-*.jpg` and `bots/K02-13-session-*.jpg`; see conflict 2 | works today | not started (step 4) |
| The rail: tiles of 54 with orbs of 36, the open one, the amber flag, a room's cluster, "+", Store, Settings | yes, `modules/bots/list.ts`, story `v7/rail` | board `v7/11-bot-chat-rail-*.jpg` (the pick: `v7/06-sidebar-tile.jpg` A) | works today | matched, step 1 |
| The rail's "+N" on a room's cluster | yes | decided: "the triangle kept; '+N' a small filled chip to the right, clear of the bots, about half a bot tall, smaller on the compact rail" (REPASS.md, 25 November) | works today | built at step 3 (derived) |
| The rail with no bots; with twelve bots and five rooms, scrolling; a room open | yes, stories `bots/rail`, `v7/rail` | derived: `v7/11` rail; kit Rail | works today | built at step 1 (derived) |
| The compact rail (64 wide, tiles of 44) and "Rail size: Automatic / Standard / Compact" | partly: the kit's Rail has the compact size (`components/v7/surfaces.ts`); no setting and no automatic switch were found in the shell | board `v7/06-sidebar-tile.jpg` B; decided: "06 rail 54/88 standard; 44/64 as an option, automatic at small desktop sizes" | 0.2.0 C | not started (step 7) |
| The rail in the Sessions tab | yes, the same rail of bots | board `v7/10-session-chat-*.jpg`; see conflict 3 | works today | not started (step 4) |
| A tab button on the collapsed rail | no | decided: "there could be a button there when it's closed, maybe"; options go to the owner as a sheet (REPASS.md, 25 November) | works today (keys and palette switch tabs) | not started (no step) |
| Sidebar hidden completely ("When the sidebar collapses: Hide") | yes, `core/state.ts` (`left: closed`) | derived: `v7/14-settings-*.jpg` draws the setting only; the layout is any board without its sidebar | works today | not started (no step) |
| Sidebar resized by dragging (88 to 400) | no, the app never had it | derived: the spec's section 7 says "300 (resizable 88 to 400)"; no board, no decision | unknown: no plan names it | not started (no step) |
| Account menu from "you" (Settings, Keyboard shortcuts, Show the dock, Show session details) | yes, `modules/shell/dialogs.ts`, story `shell/menus` | derived: K02-12 draws "you"; kit Menu with checks | works today | not started (no step) |

## 3. Bots: a bot's chat

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| A bot's chat: your bubble in the bot's fill, its bubbles, a closed tool row, a file card, the status line | yes, `modules/bots/room.ts`, story `v7/bot-chat` | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| A turn hovered: copy and more | yes, `v7/bot-chat` "a turn hovered: its actions" | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| The "more" menu of a turn (copy, reply, open the chat) | yes, `modules/bots/turn.ts` | derived: `v7/11` hover bar; kit Menu | works today | built at step 1 (derived) |
| The bot asks for approval: the AskCard with its rule and four answers, "Waiting for you" | yes | board `v7/11-bot-chat-rail-*.jpg` | approvals work today; "Allow all this turn" and "Always allow" 0.2.0 D (rules engine), drawn inert until then | matched, step 1 |
| An approval answered: the card folds to a one-row receipt | yes, `modules/bots/room.ts` | derived: spec 21.2 component 9 ("answered (collapses to one row)"); no board draws it | works today | built at step 1 (derived) |
| The bot asks a question with lettered options (A to D, "Something else") | partly, the form card kind `question` | board `bots/K02-11-bot-chat-main44-*.jpg`; see conflict 5 | works today | not started (no step) |
| A bot working through a task: the tool row open on its steps, the terminal row, the sweep | yes, `boards/bots` "17 a bot working" | board `v7/17-bot-working-*.jpg` | works today | matched, step 2 |
| The details pane: 64 orb, name, Activity / Library, Upcoming (a routine with its switch), Work (model, spend, workspace) | yes, `modules/bots/details.ts` | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| The details pane's Library side | partly, one line says it is not there | derived: `v7/11` draws the tab only; an owner question | unknown: no plan says what Library holds | not started (no step) |
| A bot with no thread yet | yes, `v7/bot-chat` "kai (no thread yet)" | derived: `onboarding/screens/O-X04-bots-later-first-open-*.jpg`; kit EmptyState | works today | built at step 1 (derived) |
| The boopis bot's own chat: its head (64 orb, "Your main bot. It makes and runs the others."), ink bubbles | partly, the chat exists without that head | board `onboarding/screens/O-B01-boopis-greets-*.jpg` | 0.2.0 C | not started (step 8) |
| A reply in markdown: lists, a quote, a table, fenced code, a path, a mention | yes, story `bots/room` "a reply in markdown" | derived: `v7/12` (inline code, a source chip); kit Bubble, Well, InlineChip | works today | built at step 1 (derived) |
| A long bot name in the pill, the thread and the composer | yes, `v7/bot-chat` "a long name" | derived: `v7/11`; one line with an ellipsis | works today | built at step 1 (derived) |
| A live bot's past sessions ("recent sessions") and one of them open with a line the app says | yes, story `bots/room` "live bot: recent sessions and a live composer" | derived: no board draws a bot's earlier sessions; nearest `v7/11` thread and `session/S33` SystemLine | works today | not started (no step) |
| A bot that is also running a kanban task | yes, story `bots/room` "also running a kanban task" | derived: `v7/17` status line; kit StatusLine | works today | not started (no step) |
| No bots at all in the Bots tab | yes, story `bots/room` "no bots at all" | derived: `onboarding/screens/O-X04-bots-later-first-open-*.jpg`; kit EmptyState with one action | works today | not started (no step) |
| Stopping a running bot (Stop where the voice button is) | yes, `modules/bots/index.ts` (`stop`) | derived: the boards draw the voice button; an open owner question | works today | built at step 1 (derived) |
| The bot's settings sheet: role, SOUL.md, model, routines, governance, cap, workspace, what it asks first, archive | yes, `modules/bots/settings.ts`, `settings-live.ts`, story `bots/settings-sheet` | derived: no board; nearest `v7/14-settings-*.jpg` cards and `v7/08-calm-options.jpg` (the danger zone); kit Pane or Dialog, Card, Row, Switch | works today | not started (no step) |
| Saving a live bot's files: the diff of each file, then save | yes, `modules/bots/settings-live.ts` | derived: `session/S24-panel-diff-*.jpg` DiffView in a form; kit Block | works today | not started (no step) |
| A bot's routines: cron in plain words, where each posts, pause and resume | yes, story `bots/settings-sheet` "live bot: where each routine posts" | derived: `v7/11` "Upcoming" row; kit Row, Switch | works today | not started (no step) |
| The look editor: Colour and Shape tabs, the dice, the change on every orb at once | yes, `modules/bots/look-edit.ts`, `look-picker.ts` | derived: `v7/08-calm-options.jpg` draws a "Colour and shape" row; kit Segmented, a radiogroup of tiles | works today | not started (no step) |
| The run-limit menu (Default, 5, 20, 30, 60, 100) | yes, `modules/bots/run-limit.ts` | derived: kit Menu with a check | works today | not started (no step) |
| New bot: the stage, the name, the pickers, suggestions, the dice | yes, `modules/bots/new-bot.ts`, story `bots/new-bot` | derived: `v7/03-light-shadows.jpg` draws a small "Create a new bot" dialog as a sample; spec 21.2 pattern "the setup form" | works today | not started (no step) |
| New bot from no bots | yes, `bots/new-bot` "from no bots" | derived: as above | works today | not started (no step) |
| Archive, delete and restore a bot: the confirm, the notice with Undo | yes, `modules/bots/settings.ts`, `modules/shell/palette.ts` ("Restore bot…") | derived: `v7/03-light-shadows.jpg` (a "Link copied / Undo" sample); kit Dialog form, Notice | works today | not started (no step) |
| Who is at work, in detail (the tool a bot is in, nine at work, a lead first) | partly, `components/presence.ts` and story `chat/presence` remain; the room no longer draws it | derived: dropped at step 3 because no board draws it; asked of the owner | works today | not started (no step) |

## 4. Bots: rooms

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| A room's thread: mentions as chips in your ink bubble, a member's name over its run, its 20 orb in the gutter, a source chip | yes, `modules/bots/group-room.ts`, story `v7/room` | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| A line the room says ("Created routine Weekly changelog") | yes | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| A message addressed to you: the "you" capsule and the amber wash | yes, story `bots/group` "a message addressed to you" | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| A member's approval in the room, under what it said | partly, drawn; the provider has no room-level approvals yet | board `v7/12-group-room-sidebar-open-*.jpg` | unknown: a known gap in the lead's notes (`docs/ORCHESTRATOR.md`); no plan names the provider work | matched, step 3 |
| "kai and moss are replying": the members' stack and the sweep | yes | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| The hand-off row ("kai handed the notes to nina") | partly, the kit has it (`components/v7/thread.ts`); the room does not draw one | board `bots/K02-12-room-main44-*.jpg`; see conflict 4 | works today | not started (no step) |
| A message held over the composer: "1 message waits until the discussion ends", Send now | yes, `boards/bots` "12 a message held" | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Two or more messages held; Edit on a held message | yes, story `bots/group` "two messages waiting" | derived: K02-12 held strip; kit Queue (held) | works today | built at step 3 (derived) |
| A room with no messages yet | yes, `bots/group` "no messages yet" | derived: no board; kit EmptyState | works today | built at step 3 (derived) |
| Group chat is off (the room cannot talk) | yes, `bots/group` "group chat is off" | derived: no board; kit Notice or SystemLine, the composer disabled | works today | built at step 3 (derived) |
| Several members at work at once (three in tools, five in one status line) | yes, `bots/group` | derived: `v7/12` status line; kit StatusLine with a stack | works today | built at step 3 (derived) |
| A mention of a bot that is not in the room: the muted chip, the note and "Send to" | yes, `bots/group` | derived: `v7/12` mention chip, muted; kit InlineChip, SystemLine with an action | works today | built at step 3 (derived) |
| A mention hovered: the bot's card (orb, name, role, state, model, Open chat, Ask in this room); its menu | yes, `modules/chat/refs.ts` | derived: no board; nearest `dock/K04-bot-card-*.jpg` head; kit Menu | works today | not started (no step) |
| A path in a message: opens it; its menu (Open in, Show in folder, Copy path, Attach) | yes, `modules/chat/refs.ts` | derived: `v7/12` inline code chip; kit InlineChip (reference), Menu | works today | not started (no step) |
| The run reached its rounds: a line with "Let them continue" | yes, `modules/bots/group-room.ts` | derived: `session/S36-error-engine-stopped-*.jpg` (a line with an action); kit SystemLine `action` | works today | built at step 3 (derived) |
| The room's cost on the composer's line ("$0.21") | partly, drawn; the provider has no cost for a room | board `v7/12-group-room-sidebar-open-*.jpg` | unknown: a known gap in the lead's notes (`docs/ORCHESTRATOR.md`) | matched, step 3 |
| A lead answers first (the hint on the line) | yes, `bots/group` "a lead answers first" | derived: `session/S17` (a hint at the line's end); kit Composer line | works today | built at step 3 (derived) |
| A long room name | yes, `v7/room` "a long group name" | derived: `v7/12` pill | works today | built at step 3 (derived) |
| The room's details pane: members, name, Change members, run limit, board, Archive | yes, `modules/bots/group-details.ts` | derived: `v7/11` pane; kit Pane with the stack, pane cards | works today | built at step 3 (derived) |
| The room's kanban board in the thread's place: columns and tasks; forty tasks; a column folded | yes, `modules/bots/group-board.ts`, story `bots/group-board` | derived: no board draws any kanban; kit Card, ListRow, SectionHead | works today | not started (no step) |
| The kanban board reading, empty, no board, no engine board, could not be read, this build cannot read boards | yes, `bots/group-board` | derived: no board; kit EmptyState, StatusLine | works today | not started (no step) |
| New group: a name and two to six bots; only one bot; group chat off | yes, `modules/bots/new-group.ts`, story `bots/new-group` | derived: `session/S18-import-sessions-*.jpg` (a form dialog of checked rows); kit Dialog form, OptionRow | works today | not started (no step) |
| Changing a room's members (a new room, the old one archived; the form says so) | yes, `bots/new-group` "changing the members" | derived: as New group | works today | not started (no step) |
| The huddle fold and the "to nina" line of v6 | no, dropped at step 3 | derived: no board draws them; asked of the owner | works in v6 | not started (no step) |

## 5. Session: new session and launch

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The new session's canvas: the "oo" mark, "What's next for boopis?", the launch row, "Waiting on you", the composer and its two hints | yes, `modules/session/new.ts`, `s0.ts`, story `boards/sessions` | board `session/S17-new-session-*.jpg` (the pick: `session/S41-new-session-board.jpg` A) | works today (S0) | matched, step 1 |
| The mark looks at the composer while you type, and lets go 1.2 s after | yes, `s0.ts` `watchTyping` | decided: "mark A (the 'oo' logomark, idle glance/blink, looks at the composer while typing)" (PLAN-session-waves, owner picks) | works today | matched, step 1 (a still cannot show it) |
| "Waiting on you": sessions that wait, one line each, with "Approval" or "Question" | yes, `modules/session/launch.ts` | board `session/S17-new-session-*.jpg` | works today | matched, step 1 |
| The canvas with nothing waiting on you | yes | derived: S17 without the section | works today | built at step 1 (derived) |
| A usage limit that is close, as a Notice over the composer, with "Get more usage" | partly, `new.ts`: drawn when the provider reports one; "Get more usage" is inert with a reason | board `session/S17-new-session-*.jpg` | 0.3.0 S3 (usage limits as data) | matched, step 1 |
| "How careful" open: four rows and "The default for new sessions is in Settings, Sessions." | yes, `s0.ts` `openCarefulMenu` | board `session/S19-launch-step-*.jpg` (the pick: `session/S01-permission-scale.jpg` B) | works today (S0) | not started (step 6) |
| A step that cannot be picked (no trusted gate): in its place, with why | yes, `s0.ts` `carefulEntries` | decided: "Without a trusted gate command a project offers only Supervised and Full access" (PLAN-session-waves, owner decisions); the look derived from S19's OptionRow, disabled | works today (S0) | not started (no step) |
| The folder selector: its menu and the system's folder chooser | yes, `modules/session/launch.ts` | derived: S17 draws the selector closed; kit SelectorItem, Menu | works today (S0) | not started (no step) |
| The workspace selector ("New worktree") | partly, drawn and disabled with a reason | board `session/S17-new-session-*.jpg`; see conflict 24 | 0.3.0 S1 (worktrees) | matched, step 1 (disabled) |
| The model selector's menu: Automatic (Smart) first, then every usable model by provider | yes, `modules/session/model-menu.ts` | derived: S19 menu; kit Menu with marks; see conflict 6 | works today | not started (no step) |
| The effort selector's menu (ticks of five) | yes, `launch.ts` `openEffort` | derived: S17 draws the selector closed; `session/S08-components-launch.jpg` | works today (S0) | not started (no step) |
| No project yet: "Add a folder to start", Add a project, Import sessions | partly, the canvas asks for a folder; Import is not shown until importing exists | board `session/S41-no-project-*.jpg` | Add a project works today; Import: see the next row | matched, step 6b (S41 whole: the chrome, the sidebar and the composer 0.00%; the canvas differs by "Import sessions" alone) |
| Import sessions: the dialog listing Claude Code and Codex sessions by project | no | board `session/S18-import-sessions-*.jpg` | unknown: SESSION-TAB.md section 1 describes it; no wave in PLAN-session-waves names it | not started (step 6) |
| No model yet: the mark asleep, "+ Choose a model", a block offering Claude, ChatGPT, Gemini, More | yes, `modules/session/s0.ts` `launchCanvas` (the kit's Block, `offer`): a lab opens Settings at Models with that lab's ways to sign in found; More and "+ Choose a model" open Models | board `session/S37-no-model-*.jpg` | works today: the sign-ins themselves are Settings, Models' (still v6, step 7); Gemini's is a key | matched, step 6a (S37: 0.03% outside the orbs) |
| Starting a session in the background (ctrl Enter) | yes, `new.ts` | board `session/S17-new-session-*.jpg` (the hint); see conflict 9 | works today (S0) | matched, step 1 |
| The canvas leaving when the session starts (the launch row settling into the composer's line) | unknown: not found in `new.ts` | decided in the spec's 20.1 ("Leaving": 200 ms, the mark fades in 120 ms); no board | works today | not started (no step) |

## 6. Session: a running and finished session

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| A session's thread with the rail: your request, the reply, the steps line, a diff block, the turn's model, time and cost | yes (v6 parts), `modules/session/conversation.ts` | board `v7/10-session-chat-*.jpg`; see conflict 1 | works today | replaced by S20 to S23 (owner, 25 November); not compared |
| The same with the sidebar open | yes (v6 parts) | board `v7/13-session-sidebar-open-*.jpg` and `bots/K02-13-session-*.jpg`; see conflicts 1, 2 | works today | replaced by S20 to S23 (owner, 25 November); not compared |
| A running turn, Supervised: the tool row with its approval inline, the model's mark in the gutter, "Waiting for your approval" | partly, approvals are a separate card today (`cards/approval`) | board `session/S20-running-supervised-*.jpg` | approvals work today; the scale is S0 | done (step 4): matches S20/S23 with `lab:board`; "Deny" with esc where S20 draws "Decline", and Stop in the composer (owner decisions) |
| Declining with feedback (typing while a change waits declines it and sends the reason) | no | board `session/S20-running-supervised-*.jpg` (the placeholder) | unknown: `docs/specs/session-launch.md` was not read for it; no wave table names it | done (step 4): typing while a change waits denies it and sends the words; the row quotes them |
| A session approval that expired (300 s) and became the ask card | partly, `cards/approval` state `expired` | decided: "session approvals expire at 300 s into the ask card" (PLAN-session-waves, owner decisions); look derived from `session/S23` AskCard | works today | done (step 4): the change becomes the AskCard, lapsed; not compared with a board |
| The steps line closed ("Read 6 files, searched 2 patterns") | yes, story `composer/steps` | board `session/S20-running-supervised-*.jpg` | works today | done (step 4): matches S20/S23 with `lab:board` |
| The steps line open: its tool rows; many steps; a failed step; a step that escalated to a stronger model | yes, `composer/steps` | board `session/S10-components-worklog-checkpoint.jpg` (open); failed and escalated derived from it; kit Disclosure, ToolRow, StatusWord | works today | done (step 4): the kit Disclosure over its steps; not compared with S10 |
| A blank waiting in the reply: the amber gap, the countdown, "waiting for you", the paused note | partly, blanks exist (`composer/blank`, `cards/blank`) without the inline wait | board `session/S21-blank-waiting-*.jpg` | 0.2.0 D (blanks inline) | not started (step 4) |
| A blank answered in time: your words in the solid accent line | partly, `cards/blank` "answered" | board `v7/P3-the-mark.jpg` (the mark's states) | 0.2.0 D | not started (no step) |
| A blank's choices open (options, free text, number keys) | yes, `modules/cards/popover.ts`, story `shell/menus` "the blank popover" | board `onboarding/screens/O-P04b-try-it-mark-open-*.jpg` and `v7/P3-the-mark.jpg` | works today | not started (no step) |
| A blank that lapsed: "(my guess)" in the reply and the question as an AskCard under it | no | board `session/S23-finished-turn-*.jpg` | 0.2.0 D | the look is done (step 4, S23); no provider sends a lapsed blank yet (`blank.guess` is the lab fixture's) |
| Steering a running turn: the "Steer" line with your message | no | board `session/S22-steer-and-queue-*.jpg` | 0.3.0 S1 (follow-ups) | not started (step 4) |
| Queued messages over the composer: numbered, edit, cancel, Send now; the key hint | no | board `session/S22-steer-and-queue-*.jpg` | 0.3.0 S1 | not started (step 4) |
| A queued message being edited; one queued; many queued | no | board `session/S11-components-queue-steer.jpg` (editing); many derived from it; kit Queue (list) | 0.3.0 S1 | not started (no step) |
| A finished turn: "Worked for 59s: …", the answer, the changed-files card, the checkpoint row, the model, time and cost | partly: the reply, steps and cost exist; the files card and Fork do not | board `session/S23-finished-turn-*.jpg` | rewind works today (S0); files card, Open diff, Fork 0.3.0 S2 | done (step 4): matches S20/S23 with `lab:board` |
| Rewinding: the turn's foot ("Rewind files to here", "Rewind to before this session") | yes, `s0.ts` `rewindFoot` | board `session/S23-finished-turn-*.jpg` ("Checkpoint 3", "Undo"); see conflict 13 | works today (S0) | done (step 4): "Checkpoint N" and Undo in the turn's foot (S23); Undo rewinds to before that turn |
| Rewind's dry-run sheet: each file and what happens to it, Rewind, Cancel | yes, `s0.ts` `rewindSheet` | derived: `session/S29-commit-*.jpg` (a form dialog of file rows); kit Dialog form, FilesCard rows | works today (S0) | not started (no step) |
| Rewind when it cannot run (a shared checkout): the button disabled with why | yes, `s0.ts` | decided: "Rewind requires a worktree, not a shared checkout" (PLAN-session-waves D); look derived: kit Button disabled, Tooltip | works today (S0) | not started (no step) |
| The line a rewind leaves in the thread, with Undo | yes, `s0.ts` `lineEl` | derived: `session/S33-settings-changed-*.jpg`; kit SystemLine with an action | works today (S0) | not started (no step) |
| "Edit from here" on a turn; editing your last message | partly, `conversation.ts` (e, or up in an empty composer) | board `session/S23-finished-turn-*.jpg` (the button); the editing state derived; kit Composer | works today | built and hidden (step 4) until it exists (`later('turn-edit')`); E and ArrowUp bring a message back as before |
| Fork from a turn | no | board `session/S23-finished-turn-*.jpg` | 0.3.0 S2 (fork and side chat) | built and hidden (step 4) until it exists (`later('turn-fork')`) |
| A setting changed mid-session: one line with the extra cost | yes, `s0.ts` `lineEl` (the kit's SystemLine with `meta`): how careful (in place, or continued), the effort (`SessionControls.setEffort`, the engine's `session.mutate` reasoning), the model you picked ("Model changed to X") | board `session/S33-settings-changed-*.jpg` | the steps work today (S0); the effort and the model's line are built at step 6a and tested on a fake gateway, not against a running engine; the cost is said in tokens read again without the cache (dollars need a price for the model, which nothing holds yet) | matched, step 6a (S33: the line 0.00%; the thread around it is S20's and S23's, see boards.json) |
| The effort changed from the composer's line: its levels under the models in "who answers next" | yes, `modules/session/composer.ts` `effortEntries` | derived: no board draws the model item's menu with the effort; kit Menu (a heading, radio rows); the launch row's selector is `session/S08-components-launch.jpg` | built at step 6a | built at step 6a (derived; shown to the owner) |
| A usage limit reached: the notice over the composer, "Paused: …" in the thread, the weekly bar on the line | partly, the free tier's limit notice exists (`host/free-tier.ts`) | board `session/S34-usage-limits-*.jpg` | 0.3.0 S3 | not started (step 6) |
| Continued after a restart, a queued message still queued | no | board `session/S35-after-restart-*.jpg` | 0.3.0 S1 (the queue); "Continue after a restart" has no wave named | not started (step 4) |
| The engine stopped mid-session: a line with "Start it again" | unknown: the link's state is known (`host/gateway.ts`); no line found in `modules/session` | board `session/S36-error-engine-stopped-*.jpg` | unknown: no plan names the restart action | not started (step 4) |
| The gate failed: the card with the failing check and "Fix and retry" | partly, `cards/ship` state `failed` | board `session/S38-error-gate-failed-*.jpg` | works today | not started (step 4) |
| A ship that asks first ("Write 2 files to the workspace?", Deny, Hold to approve) | yes, `cards/approval` | board `v7/10-session-chat-*.jpg`; see conflict 1 | works today | done (step 4) as the kit AskCard with the hold and Deny (board 10's "Ship" block is replaced); not compared with a board |
| A ship that passed; a ship rolled back; View diff | yes, `cards/ship` states `passed`, `rolled-back` | derived: S38 card and S23 files card; kit FilesCard, StatusWord | works today | partly (step 4): the changed files as the FilesCard, Open diff opens the Changes panel; the ship card's verdict line is gone with the mock-only card (owner question) |
| The answering model changed: the divider; a turn sent to one model outside governed mode (the "ungoverned" mark) | yes, `modules/session/attribution.ts`, story `composer/attribution` | derived: `session/S33` SystemLine; `session/S23` turn foot (the model's mark and name) | works today | done (step 4): a SystemLine between the turns; "ungoverned" a Badge in the turn's foot |
| A session's answer hovered: copy and more (the copy as Markdown) | yes, `modules/session/conversation.ts` `answerActs`, story `kit/hover-bar` | decided: the same copy and "more" hover actions a bot's message has, on a session's turns (owner; the step 6a brief); drawn for a bot on `v7/11-bot-chat-rail-*.jpg` | works today | built at step 6a (the kit's one HoverBar; your own message has none, as in a bot's chat: an owner question) |
| A turn of unknown model after a resume ("Model unknown") | yes, `composer/attribution` | derived: S23 turn foot without a mark | works today | done (step 4): "Model unknown" in the foot, no mark in the gutter |
| A council: the form (members, the combiner), a turn running, combining, done, answers open, a member failed, none reported | yes, `modules/session/council.ts`, story `composer/council` | derived: no board draws a council; nearest `session/S19` menu (the form) and `v7/17` tool row with steps (the members); kit Menu, OptionRow, Disclosure | works today | not started (no step) |
| Tasks handed to other models: a card each (running, queued, done, error), its transcript open, Stop | yes, `modules/session/children.ts`, story `composer/children` | derived: no board; nearest `v7/17` tool row; kit ToolRow, Disclosure, StatusWord | works today | not started (no step) |
| A model escalation (escalated; capped) | yes, `cards/escalation` | derived: no board; kit SystemLine or a Block with a StatusWord | works today | not started (no step) |
| A turn that failed: failed, retrying, passed | yes, `cards/error` | derived: `session/S38`; kit Block, StatusWord red | works today | not started (no step) |
| A teammate asked to help (pending, accepted, declined); a schedule proposed (pending, scheduled, dismissed) | yes, `cards/teammate`, `cards/schedule` | derived: `v7/12` (the routine line, the AskCard); kit AskCard question | works today | not started (no step) |
| Find in this conversation (mod+F): the field, matches, no matches | yes, `conversation.ts` `openFind` | derived: no board; kit Field (search) | works today | partly (step 4): the kit's search Field in the v6 popover shell |
| A message you sent with files | yes, story `composer/entry` "a sent message with files" | decided: "a file added with '+' is a reference chip in the composer's text" (REPASS.md); in a sent bubble derived from `v7/12` chips | works today | done (step 4): reference chips under your words |
| Stopping a running turn | yes, `conversation.ts` (`stop`, mod+.) | derived: the boards draw the voice button while a turn runs (S22); an open owner question | works today | done (owner, 25 November): Stop is the composer's own button while a turn runs |
| A plan turn and "Run this plan" | partly, the form kind `plan` exists (`cards/form-plan`) | derived: no board; kit AskCard with a list | 0.3.0 S2 (plan turn) | not started (no step) |
| A long history: older turns loaded as you scroll | no | derived: no board; kit StatusLine | 0.3.0 S3 (history paging) | not started (no step) |
| A session with no priced model (costs unknown) | yes, story `pages/window` "unpriced models (recorded)" | derived: S23 foot without the cost (unknown stays unknown) | works today | not started (no step) |

## 7. Session: panels, commit, inbox, menus

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The right panel as one panel with tabs: Diff, Files, Terminal, PR | no, today it is the v6 details panel (`modules/session/right.ts`) | board `session/S24-panel-diff-*.jpg` (the pick: `session/S07-right-panel-tabs.jpg` A) | 0.3.0 S2 | not started (step 6) |
| Diff: "This turn" scope, the file cards, a hunk, a comment on a line with "Add to message" | partly, an inline diff exists (`modules/session/diff.ts`) | board `session/S24-panel-diff-*.jpg` | 0.3.0 S2 (diff review) | not started (step 6) |
| Diff's scope menu open (This turn, This session, Uncommitted, Branch against its base) | no | board `session/S12-components-panel-diff-terminal.jpg` | 0.3.0 S2 | not started (step 6) |
| Diff as Split | no | derived: S24 draws the words "Stacked" and "Split", not the split view; kit DiffView | 0.3.0 S2 | not started (no step) |
| Diff with nothing changed; a very long diff; a binary or deleted file | partly, `diff.ts` | derived: S24; kit DiffView, EmptyState | 0.3.0 S2 | not started (no step) |
| Files: the worktree as a tree, "Find a file", changed counts, the worktree's path | no | board `session/S25-panel-files-*.jpg` | 0.3.0 S2 (the tabbed panel; the plan's tables do not name the tree) | not started (step 6) |
| Files: a file opened read-only; "Mention" | no | derived: SESSION-TAB.md section 7 names it; no board; kit Well | 0.3.0 S2 | not started (no step) |
| Terminal: path and branch, output, the prompt, "Select output to attach it to your message" | no (today "Output" shows the logs) | board `session/S26-panel-terminal-*.jpg` | 0.3.0 S2 (terminal) | not started (step 6) |
| Terminal: a second shell ("+"), a running command, a long scrollback | no | derived: S26 draws "+" only; kit Well (terminal) | 0.3.0 S2 | not started (no step) |
| PR: branch to base, title, "#412, open, 2 files", Checks, Review, Open on GitHub, Update from this session | no | board `session/S27-panel-pr-*.jpg` | 0.3.0 S2 (git flows) | not started (step 6) |
| PR: none yet; merged or closed; a check failed; reviews present | no | derived: S27 draws one state; kit Card, StatusWord, EmptyState | 0.3.0 S2 | not started (no step) |
| Side chat as a fifth tab: its context line, thread, "Add to chat", Delete, its own composer | no | board `session/S28-side-chat-*.jpg` | 0.3.0 S2 (fork and side chat) | not started (step 6) |
| Commit: the files with checks, the written message, "No agent credits are added.", the split button and its menu | no | board `session/S29-commit-*.jpg` | 0.3.0 S2 (git flows) | not started (step 6) |
| Commit: the message being written; a push refused; the gate not passed; nothing to commit | no | derived: S29; "classified errors (stderr never shown)" (PLAN-session-waves S2); kit Dialog form, Notice | 0.3.0 S2 | not started (no step) |
| The session's details pane: title, project and branch, Session (Model, Effort, How careful, Workspace), Use (Context, Cost, Pull request) | partly, the v6 details panel, story `shell/details-panel` | board `session/S40-session-details-*.jpg`; see conflict 14 | Model, Effort and How careful work today (S0); Pull request 0.3.0 S2 | not started (step 6) |
| The details pane's overflow: Pin, Fork, Settle | no | decided in SESSION-TAB.md section 16 ("then Pin, Fork and Settle in the overflow"); S40 draws the button closed | Pin and Settle 0.3.0 S1; Fork 0.3.0 S2 | not started (no step) |
| Today's panel sections: Context (the measure, "Compact conversation"), Connectors, Output, Environment, Tasks, Changes, Governance | yes, `modules/session/right.ts` | derived: no board places them; see conflict 14 | works today | not started (no step) |
| Today's collapsed panel: the context measure as a strip | yes, `right.ts` `strip` | derived: `session/S20` (the context ticks on the composer's line) | works today | not started (no step) |
| The inbox with a row hovered and the snooze menu | no | board `session/S30-session-inbox-*.jpg` | 0.3.0 S1 | not started (step 6) |
| "/" in the composer: Commands, then "Skills and plugins" | partly, the attach menu's "Commands" types "/" | board `session/S31-slash-commands-*.jpg` | unknown: SESSION-TAB.md section 10 describes it; no wave table names it | not started (step 6) |
| "$" skills, and an "@" file set in the text as a chip | partly, "Mention a file" completes a path (`modules/session/composer.ts`) | board `session/S32-files-and-skills-*.jpg` | unknown: as the row above | not started (step 6) |
| The "@" files list itself | partly | derived: S32 draws the skills list and a file chip, not the files list; kit Menu | works today | not started (no step) |

## 8. Composer

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The one-row composer, empty: "+", the placeholder, the mic, the voice button | yes, kit `composer`, story `kit/composer` | board `v7/11-bot-chat-rail-*.jpg` (the pick: `v7/07-composer.jpg` C) | works today | matched, step 1 |
| Typed: the voice button becomes send in the same slot | yes | board `session/S20-running-supervised-*.jpg` | works today | matched, step 1 |
| Several lines; a long unbroken word; a tall draft that scrolls | yes, story `kit/composer` ("multi-line", "a long unbroken word", "a tall draft scrolls") | derived: no board draws more than one line; kit Composer | works today | built at step 6a (derived) |
| A bot's composer: "Message kai", send in the bot's colour, the line (Governed, the model, spend of cap) | yes | board `v7/11-bot-chat-rail-*.jpg`; decided: "in a specific bot's own chat they take that bot's colour by default (contrast-safe), with a setting to disable" (PLAN-w31-foundations) | works today | matched, step 1 |
| The boopis bot's and a room's composer in ink | yes | decided: "your bubble + send button are ink by default and in group chats / the boopis bot's chat" (PLAN-w31-foundations); drawn on `v7/12` | works today | matched, step 3 |
| A room's composer: "Message release crew", the line ("@ 3 members", the cost) | yes | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| A new session's composer: the placeholder naming "@ files, $ skills, / commands", the two hints | yes | board `session/S17-new-session-*.jpg` | works today | matched, step 1 |
| A session's composer and its line: how careful, branch, model with effort ticks, context ticks and "76k / 200k", cost | partly, the v6 composer with chips (`modules/session/composer.ts`) | board `session/S20-running-supervised-*.jpg` (the pick: `session/S05-composer-line.jpg` B); see conflict 6 | works today, except the context ticks (0.3.0 S3) | not started (step 4) |
| The line's quick menu: what shows, each on or off | yes, `modules/session/composer.ts` `openQuick`: a press on the line (or "Show under the composer" in the "+" menu) opens it over the composer, at its end; a check turns an item off and is kept (`core/settings.ts` `saveLineHidden`) | board `session/S05-composer-line.jpg` B; decided: "S05 composer line shows everything, customizable, and its on/off popup becomes the session composer's quick menu"; see conflict 8 | works today | built at step 4, completed at step 6a (tested: `conversation.test.ts`) |
| A line item opened: "How careful" from the line | partly, `launch.ts` `openCarefulFor` | board `session/S08-components-launch.jpg` ("The scale as a line item") | works today (S0) | not started (step 4) |
| A line item opened: the model's menu | yes, alt+M | derived: `session/S19` menu; kit Menu | works today | not started (no step) |
| The composer in the dock's card: "Message nina" | yes, `modules/dock/index.ts` | board `dock/K04-bot-card-*.jpg` | works today | matched, step 5 (K04: the kit's one Composer, its primary circle white) |
| The side chat's composer ("Ask on the side", no line) | no | board `session/S28-side-chat-*.jpg` | 0.3.0 S2 | not started (step 6) |
| "@" in a bot's or room's composer: the list of whom the chat can name | yes, `modules/chat/compose.ts` | decided: "'@' in a bot's or a room's composer opens a menu like the composer's lists (boards S31, S32) of whom that chat can name" (REPASS.md, 25 November) | works today | built at step 3 (derived) |
| A mention set in the text as a capsule (orb and name), one unit for the caret | yes | decided: "the pick is set into the text as the capsule a message draws … one unit for the caret and Backspace, sent as the mention" (REPASS.md) | works today | built at step 3 (derived) |
| "@all" as the room's stack; a bot that is not here, muted; "@kai." left as text | yes, story `bots/group` | derived: the mention decision; kit InlineChip `mention` | works today | built at step 3 (derived) |
| "@" a model in a session; in governed mode the list says the message runs without governance | yes, story `composer/attribution` | derived: S32 list; kit Menu with a note row | works today | not started (no step) |
| "+" adds a file: a chip in the text | yes, `compose.ts` | decided: "a file added with '+' is a reference chip in the composer's text, not '@path' words" (REPASS.md, 25 November) | works today | built at step 3 (derived) |
| A folder and a picture attached; a file dropped on a composer or pasted into it | yes, in every composer (a session, a bot's chat, a room, the dock's card): the kit Composer's `ui:files` (`components/v7/compose.ts`) and `modules/chat/compose.ts` `composerFiles`; the desktop app's host reports its drags. In the live app a pasted file with no place on disk is not attached, and a Notice says so | derived: the attachment decision; kit InlineChip `words` | works today (a pasted picture cannot reach the engine yet: it has no path) | built at step 6a (derived; story `kit/composer` "a dropped file is a chip") |
| A file dragged over a composer: the drop target | yes, story `kit/composer` "a file dragged over it" | derived: no board draws it; the composer's own focus answer (the box's line in `--focus`), nothing new | works today | built at step 6a (derived; shown to the owner) |
| Undo and redo in a composer (mod+Z, shift+mod+Z) across mention chips, marks and files | yes, `components/v7/compose.ts` | derived: no board (a behaviour); what v6's composer did | works today | built at step 6a |
| The session's "+" menu: Attach a file, Add a folder to context, Mention a file, Commands, Show under the composer | yes, `modules/session/composer.ts` | decided: "the session composer's '+' opens the add menu …; in a bot's chat and a room, where only files can be added, '+' opens the file picker" (REPASS.md, 25 November); kit Menu | works today | built at step 4 (tested) |
| A review comment as a reference chip ("dock.css:42") | no | board `session/S24-panel-diff-*.jpg` | 0.3.0 S2 | not started (step 6) |
| A terminal selection attached as a chip | no | derived: S26 says "Select output to attach it to your message"; the chip from S24 | 0.3.0 S2 | not started (no step) |
| Feedforward marks in the text as you type | yes, `modules/session/feedforward.ts` (the mock's catalog, off by default in the live app) | board `session/S20-running-supervised-*.jpg` and `onboarding/screens/O-P04a-try-it-marks-*.jpg` | 0.2.0 D (feedforward live) | not started (step 4) |
| A mark's readings open, one chosen | yes | board `onboarding/screens/O-P04b-try-it-mark-open-*.jpg` and `v7/P3-the-mark.jpg` | 0.2.0 D | not started (step 8) |
| Reviewing the assumptions before sending (tab) | yes, keymap "Review the assumptions" | derived: no board; decided only as "everything in 'Will assume' travels" (PLAN-w31-foundations) | 0.2.0 D | not started (no step) |
| While a change waits: "Send feedback to decline this request" | no | board `session/S20-running-supervised-*.jpg` | unknown (section 6, declining) | not started (step 4) |
| While a turn runs: "Queue a message, or ctrl Enter to steer" and the hint "Enter queues, ctrl Enter steers" | no | board `session/S22-steer-and-queue-*.jpg`; see conflict 9 | 0.3.0 S1 | not started (step 4) |
| A message held (a room) | yes | board `bots/K02-12-room-main44-*.jpg` | works today | matched, step 3 |
| Messages queued (a session) | no | board `session/S22-steer-and-queue-*.jpg` | 0.3.0 S1 | not started (step 4) |
| The line with a limit: the weekly bar and "81%" | no | board `session/S34-usage-limits-*.jpg` | 0.3.0 S3 | not started (step 6) |
| "/" commands and "$" skills lists over the composer | partly | board `session/S31-slash-commands-*.jpg`, `session/S32-files-and-skills-*.jpg` | unknown (section 7) | not started (step 6) |
| Dictation: the mic on, listening (a press or alt+V switches it; held, it listens while held; Esc stops it; the bot's orbs listen meanwhile) | yes, the kit Composer (`components/v7/compose.ts`) and `modules/chat/compose.ts` through the provider's dictation; story `kit/composer` "listening" | derived: the boards draw the mic at rest; nearest `notch/stills/12-stage-listening.jpg`; the mic pressed in the accent, the placeholder saying who listens, the box's line as with the focus | the mic works; **the live provider's dictation hears nothing yet** (`host/live-provider.ts`: no transcription exists in the host), only the page build's mock writes a transcript | built at step 6a (derived; shown to the owner) |
| Talking to a bot (the voice button with no text) | partly: the button is always drawn (owner, 26 November: "it's not supposed to be hidden, it just will not come out functioning from the get go"); with no voice model it opens a Notice, "Voice needs a voice model", whose action "Set up voice" opens Settings at Models; with one (the provider's `voice`) it starts talking. Live voice and the voice section of Settings, Models (a provider's key, a local model) are not built | board `v7/11-bot-chat-rail-*.jpg` draws the button; the talking state and the Notice have no board | the set-up: step 7 (Settings); live voice: after 0.3.0 (PLAN-w31-foundations, "Naming") | matched, step 1; the Notice and the capability at step 5 |
| A turn running: the send slot as Stop | yes (`ui:stop`) | derived: an open owner question (the boards draw the voice button) | works today | built at step 1 (derived) |
| Governed or ungoverned, Smart on or off, as controls (alt+G, alt+S) | yes, `modules/session/composer.ts` | board `v7/10-session-chat-*.jpg` draws "Governed" and "Smart" on the line; see conflict 6 | works today | not started (step 4) |
| Governed mode unavailable (no frontier model): the item at rest and its menu saying why | yes, story `components/menu` "governed mode unavailable" | derived: S19's disabled OptionRow; kit Menu | works today | not started (no step) |
| "Ask a council" from the model menu (alt+C) | yes | derived: no board (section 6, council) | works today | not started (no step) |
| No model: "Choose a model to start"; no project: "Add a folder to start" | yes, `modules/session/new.ts` | board `session/S37-no-model-*.jpg`, `session/S41-no-project-*.jpg` | works today | matched, step 6a (the composer 0.00% on both boards) |
| The composer during onboarding: "Type your answer, or ask something else" | no | board `onboarding/screens/O-B01-boopis-greets-*.jpg` | 0.2.0 C | not started (step 8) |
| The composer under 900 px: the branch and the context fold into the quick menu first | yes: the kit Composer leaves them out of the line in a window under 900 wide (and in a composer under 600), and the quick menu says what they hold beside their names | decided in the spec's S05 row ("under 900 px the branch and the context fold into the quick menu first"); no board | works today | built at step 6a (derived; shown to the owner) |
| The composer at 390 px; right-to-left text | yes, story `kit/composer` "typed, narrow (390)", "right to left" | derived: no board; kit Composer | works today | built at step 6a (derived) |
| Tooltips on "+", the mic and send | yes, story `kit/composer` ("the add tooltip", "the mic tooltip", "the send tooltip") | derived: no board draws a tooltip; kit Tooltip | works today | built at step 6a (derived) |
| The composer steps aside while the dock's stack or a card is open | unknown: not checked in `modules/dock/index.ts` | board `dock/K03-asks-open-*.jpg`, `dock/K04-bot-card-*.jpg` | works today | matched, step 5 (K03, K04; `data-dock-open`) |

## 9. Dock

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The row at rest: the bots that matter now, the amber flag, "nina needs you" at the end | yes, `modules/dock/index.ts`, story `v7/dock` | board `dock/K01-rest-running-*.jpg` | works today | matched, step 5 (K01: 0.01% outside the live orbs) |
| A bot hovered: it grows to 52, its neighbours to 46, the end slot names it and its state | yes, `v7/dock` "an orb hovered" | board `dock/K02-hover-*.jpg` | works today | matched, step 5 (K02: 0.20% outside the live orbs); at step 6a the grown bots drop the small orbs' face scale as the board draws them (the lead, 26 November) |
| A bot focused by the keyboard: the Iris ring | yes, `v7/dock` "an orb focused" | board `dock/DK1-the-row.jpg` | works today | built, step 5 (derived from DK1; the pill stays under a focus) |
| Nothing needs you: no pill | yes | board `dock/DK1-the-row.jpg` | works today | built, step 5 (derived) |
| Two or more need you: "2 need you" | yes | board `dock/D03-asks.jpg` | works today | built, step 5 (derived; tested) |
| The asks open: "Waiting on you 2", an approval and a question, the row under them | yes, `v7/dock` "the asks open (the stack)" | board `dock/K03-asks-open-*.jpg` | works today | matched but for what boards.json notes, step 5 (K03: the question is an approval; the order is needs you, working, the rest: the lead, 26 November); at step 6a the Well's corner is the board's 10 and the standing answer names its scope |
| A bot's card: its head ("Open in Bots", close), its last messages, its ask, its composer, the Iris dot under its orb | yes, `v7/dock` "nina's card (an approval)" | board `dock/K04-bot-card-*.jpg` (it replaces `v7/16-dock-*.jpg`) | works today | matched, step 6a (K04: "Always for staging" from the ask's scope, the Well's corner 10; what differs is your bubble's fill, the kit's derivation where the board writes #d42746) |
| A bot's card with a thread and no ask; with the bot working; with no messages yet | yes, `v7/dock` "atlas's card (a thread)" | derived: K04; kit Bubble, StatusLine, EmptyState | works today | built, step 5 (derived from K04; stories `v7/dock`, `kit/dock`); at step 6a the ask and the composer stay at the card's foot, 12 over the row, and a card with no messages is empty above them (the lead, 26 November) |
| Many bots: six, then "13 more" (to the Bots tab) | yes, `v7/dock` "120 bots (N more)" | board `dock/K05-many-bots-*.jpg` (the pick: `dock/D01-many-bots.jpg` B) | works today | matched but for the order, step 5 (K05: kai, at work, comes before moss: the order needs you, working, the rest is the lead's decision of 26 November, and K05's still is not followed) |
| One bot; a long-named bot in the end slot | yes, `v7/dock` | derived: K01, K02; one line with an ellipsis | works today | built, step 5 (derived; stories) |
| No bot of your own: no dock, the composer 24 px from the foot | yes, `modules/dock/model.ts` | board `dock/K06-no-bots-*.jpg` | works today | matched, step 5 (K06, with the owner's Stop in the running composer) |
| Centred in the window instead of on the session's column | yes, `v7/dock` "centred in the window" | board `dock/K07-centred-in-window-*.jpg` | works today | matched, step 5 (K07: 0.01%) |
| Compact when idle (orbs of 24, the pill small) and its setting | yes, `modules/dock/index.ts` (`setCompact`, `wake`), story `v7/dock` "compact when idle" | board `dock/K08-compact-idle-*.jpg`; decided: "D02 A full row + a compact idle version toggleable in Settings" | 0.2.0 C | matched, step 5 (K08: 0.11%); the setting is in Settings, General |
| The Bots tab: no dock | yes, `v7/dock` "the Bots tab (no dock)" | decided: "the dock (with the bots) appears only in the Sessions tab, not in Bots" (PLAN-session-waves); drawn on `v7/11` | works today | matched, step 1 |
| The dock switched off ("Show the dock", mod+J) | yes | board `v7/14-settings-*.jpg` (the setting); the layout is K06's | works today | not started (step 7) |
| The dock under a dialog's scrim | yes | board `v7/15-store-*.jpg` | works today | not started (step 7) |
| The dock arriving with your first bot and leaving with the last | yes | decided: "Arrival and departure … kept; the slab's spring, unchanged" (the spec's 21.4); no board | works today | kept, step 5 (smoke `dock-presence`, WebKitGTK) |
| A resting bot holds the fixed pose; a hovered one comes alive; a working or asking one animates | yes, `components/orb-pose.ts` | decided: "the dock also uses the fixed 3/4 pose at idle; a hovered bot animates smoothly out of it and back; bots in a state … animate" (PLAN-session-waves); `bots/K08-pose-volume.jpg` B | works today | built, step 5 (the hover's life was missing: `modules/dock/index.ts` `awake`; tested) |
| A form answered from the dock (a question with chips, a credential, a hold) | partly, the cards have a compact size on the dock (`cards/*` "compact, on the dock") | derived: K03's two cards; kit AskCard, Field | works today | not started (no step) |
| The dock at 112% and 125%, and in a narrow window (fewer bots, "N more") | yes, `v7/dock` "larger (112%)" | derived: K05; the row's width "fits its content up to 640" (DK1) | works today | built, step 5 (stories at 112% and 125%; the lab draws every state at 390 to 1920) |
| The dock's keys: arrows along the row, Enter opens a card, mod+Enter the full chat, Esc closes, 1 to 9 | partly; the keymap sheet still lists the grid, the pages and the nub; see conflict 22 | decided: "keys get their own pass" (REPASS.md, 25 November) | works today | not started (no step) |
| "Grow bots on hover" as a setting | yes, `modules/shell/dialogs.ts` (Appearance, Bots) | derived: DK1 describes the growth; no board draws the setting | works today | not started (no step) |

## 10. Cards, forms and approvals

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The AskCard as a bot's approval: "kai asks", "needs you", the ask, the rule, four answers | yes, kit `askCard` | board `v7/11-bot-chat-rail-*.jpg` | works today; the rule line and two answers 0.2.0 D | matched, step 1 |
| The same in a room, in the gutter under the member's message | yes | board `v7/12-group-room-sidebar-open-*.jpg` | works today | matched, step 3 |
| The same in the dock, with the command in a well and "Always for staging" | yes | board `dock/K03-asks-open-*.jpg`; see conflict 11 | works today | not started (step 5) |
| The approval attached to a session's tool row | no | board `session/S20-running-supervised-*.jpg` | works today as a separate card | not started (step 4) |
| A question with chips ("staging", "the Linux app", "Something else") | partly, the form kind `question` | board `session/S23-finished-turn-*.jpg` and `dock/K03-asks-open-*.jpg` | works today | not started (step 4) |
| A question with lettered rows (A to D) | partly, the form kind `question` | board `bots/K02-11-bot-chat-main44-*.jpg`; see conflicts 5, 12 | works today | not started (no step) |
| Holding to approve: the hold filling | yes, `components/hold.ts`, `cards/approval` "holding" | decided: "approval hold everywhere" (`notch/owner-decisions.md`); nearest `notch/stills/26-approval-holding-60.jpg`; no app board draws a hold in progress | works today | built at step 1 (derived) |
| An answered ask: one row saying what was decided | yes | derived: spec 21.2 component 9; no board | works today | built at step 1 (derived) |
| An approval denied; expired; cancelled | yes, `cards/approval` "denied", "expired" | derived: the answered row with a quiet StatusWord | works today | not started (no step) |
| Several asks at once: one at a time, the next peeking | yes, `modules/cards/queue.ts`, `cards/approval` "queue of three" | derived: `dock/K03-asks-open-*.jpg` (a stack of two); `notch/stills/28-stack-peek.jpg` | works today | not started (no step) |
| An approval that names the rule it matched, with "Always allow" drafting an exception to edit | no | decided: "on a match the bot pauses and the engine's approval card names the rule … 'Always allow' drafts a narrow exception rule for the owner to edit before saving" (PLAN-w31-foundations, specs 2); the rule line is on `v7/11`; the drafting step has no board | 0.2.0 D (rules engine) | not started (no step) |
| Editing a request before approving it | no | decided: "edit-before-approve" (PLAN-w31-foundations, specs 4, approval surfaces); no board | 0.2.0 D | not started (no step) |
| A form, open: title, why, the fields, the effect, submit | yes, `modules/cards/form.ts`, stories `cards/form-*` | derived: no board draws a form with fields; nearest `v7/11` AskCard and `session/S29` (a field in a form); kit Block, Field, Button | works today | not started (no step) |
| A form invalid, submitting, done (a receipt), deferred ("Later"), expired, cancelled | yes, `cards/form-*` | derived: as above; kit StatusWord, the one-row receipt | works today | not started (no step) |
| Form kinds: credential (a secret field), permission (once, session, always, deny), approval with a note | yes, `cards/form-credential`, `-permission`, `-approval` | derived: `v7/11` AskCard; `onboarding/screens/O-P03b-model-nothing-found-*.jpg` (sign in or a key) | works today | not started (no step) |
| Form kinds: setup (a config file's diff), plan (steps to approve), theme (swatches) | yes, `cards/form-setup`, `-plan`, `-theme` | derived: `session/S24` DiffView in a Block; kit OptionRow, swatches from `v7/P1-accent.jpg` | works today | not started (no step) |
| Form kinds: sign-in, connector (what will be installed), choice (folder and model pickers), feedback, several picks with an upload | yes, `cards/form-signin`, `-connector`, `-choice`, `-feedback`, `-multi` | derived: `onboarding/screens/O-B06-starter-team-and-connectors-*.jpg` (the connector block), `O-P03c` (signing in), `session/S17` SelectorItems | works today | not started (no step) |
| Form kinds: a model endpoint of your own, first step and "models found" | yes, `host/endpoint-form.ts`, `cards/form-endpoint` | derived: no board; kit Field, OptionRow | works today | not started (no step) |
| Who is asking: the agent with its model, a teammate, five askers, a relay, a connector, a mod, the app, nobody named | yes, story `cards/form-askers` | derived: `v7/11` ("kai asks", a 16 orb); `session/S23` ("asked during the turn", the model's mark); kit Avatar, stack | works today | not started (no step) |
| A card at the dock's width and as one row; every string long | yes, `cards/*` "compact", "mini", "long" | derived: `dock/K03`; names cut to one line, whole on hover | works today | not started (no step) |
| A file a bot wrote: name, lines and size; as a control that opens it | yes, kit `fileCard` | board `v7/11-bot-chat-rail-*.jpg` | works today | matched, step 1 |
| A turn's changed files: count, totals, rows, "Open diff" | no | board `session/S23-finished-turn-*.jpg` | 0.3.0 S2 | not started (step 4) |
| A connector asked for in the thread (needed, waiting, connected, failed) | yes, `cards/connector` | derived: `onboarding/screens/O-B06-starter-team-and-connectors-*.jpg` ("Add GitHub") | works today | not started (no step) |
| A team plan to build by holding ("Hold to build this team", Change it, Just you and me) | no | board `onboarding/screens/O-B06-starter-team-and-connectors-*.jpg` | 0.2.0 D (team ops: "apply only by the owner's hold in the app") | not started (step 8) |

## 11. Settings

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The Settings dialog: 900 wide, the nav of 220, cards of rows, close | yes (v6), `modules/shell/dialogs.ts`, story `settings/dialog` | board `v7/14-settings-*.jpg`; see conflict 15 | works today | not started (step 7) |
| General, Layout: Show the dock, When the sidebar collapses, Rail size, Show search, Search shows as | partly: the first two exist; the others do not | board `v7/14-settings-*.jpg`; see conflict 18 | 0.2.0 C | not started (step 7) |
| General, Under the composer: what the line shows, each checked or not | no | board `v7/14-settings-*.jpg`; see conflict 7 | 0.2.0 C | not started (step 7) |
| General, Appearance card: Theme, Accent, Corners | partly, on the Appearance page today | board `v7/14-settings-*.jpg` (the card is cut at the dialog's foot) | 0.2.0 C | not started (step 7) |
| General, Getting started (run a part again, start the Bots part) and This computer (engine, models, where bots work) | no | board `onboarding/screens/O-X02-settings-getting-started-*.jpg`; see conflict 17 | 0.2.0 C | not started (step 8) |
| General: "Keep the dock centred in the window" | yes | decided: "'Keep the dock centred in the window': kept, in Settings > General" (the spec's 21.4); the row is on no board | works today | not started (no step) |
| General: "Compact dock when idle" | yes | decided: "a setting (Settings > General > 'Compact dock when idle'), off by default" (`dock/D02-at-rest.jpg`); the row is on no board | 0.2.0 C | built, step 5 (the switch in Settings, General; the row itself is step 7's board) |
| General, Window: window controls (Automatic, Close only, All) and what was found | yes | derived: no board; kit Row, Segmented | works today | not started (no step) |
| General, Local API: off; on with the address and the token file; apps following; not started; the address could not be opened; Rotate | yes, `modules/shell/local-api.ts`, story `settings/local-api` | derived: no board; kit Row, Switch, a mono value, Button | works today | not started (no step) |
| Diagnostics: graphics card, renderer report, Measure frames, the WebKit GPU page | yes, a section of General | board `v7/14-settings-*.jpg` names a Diagnostics page; its content is derived; see conflict 16 | works today | not started (step 7) |
| Models: the plan, governed mode and its heavy switches, the ladder, "Change models" | yes, `host/models-tab.ts`, story `settings/dialog` "models" | derived: board 14 names the page only; kit Card, Row, Switch | works today | not started (no step) |
| Models: governed mode unavailable; a ladder with cheap tiers marked; the plan not reported | yes, story `components/set-row` | derived: as above; unknown shown as unknown | works today | not started (no step) |
| Connectors page (rows are in section 12) | yes, `host/connectors.ts` | derived: board 14 names the page only; `v7/15-store-*.jpg` item rows | works today | not started (no step) |
| Approvals: the rules list (on or off, edit, remove, Add a rule), per-bot extra rules, the reviewer model | no | derived: `onboarding/screens/O-B07-approval-rules-*.jpg` draws the rules as a card in the chat; the page is named on boards 14, S39 and O-X02; "Lab: Settings > Approvals … rendered in dark and light for the owner's pick" (PLAN-w31-foundations) | 0.2.0 D (rules engine and its UI) | not started (no step) |
| Sessions: New sessions (Workspace, Model, When it runs out, How careful), While it runs, Inbox, with This device / This project | no | board `session/S39-settings-sessions-*.jpg` (the pick: `session/S04-settings-scope.jpg` A); see conflict 19 | How careful works today (S0); the scope 0.3.0 S3; steer or queue and settle 0.3.0 S1 | not started (step 6) |
| A row set for the project, with Reset | no | board `session/S16-components-scope-picker.jpg` | 0.3.0 S3 (the settings cascade) | not started (step 6) |
| Bots page | no | derived: named in the nav on `session/S39` and `O-X02`; no board draws it; what it holds is undecided, see list 2 | unknown | not started (no step) |
| Feedforward: on by default, with global, per-context and per-bot or per-room switches | no | decided: "runs everywhere (sessions, bot chats, rooms) with global + per-context + per-bot/room toggles" (PLAN-w31-foundations); no board | 0.2.0 D | not started (no step) |
| Waiting on a blank: 30 s, 60 s, 2 min, for sessions | no | board `session/S39-settings-sessions-*.jpg` ("Wait for my answer") | 0.2.0 D | not started (step 6) |
| Appearance: the theme customizer (presets, colours, fonts, the logo), the dialog stepping aside so the app shows | yes (v6), `modules/shell/dialogs.ts` | derived: board 14 names the page and draws three rows; `v7/P1-accent.jpg`; the spec's section 18 | 0.2.0 C | not started (step 7) |
| Appearance: Size (100, 112, 125%); Bots ("Grow bots on hover") | yes, story `settings/dialog` "appearance, a larger interface chosen" | derived: no board; kit Row, Segmented, Switch | works today | not started (no step) |
| Keyboard: the keymap by group | yes, story `settings/dialog` "keyboard" | derived: board 14 names the page only; kit Kbd, Row; "keys get their own pass" (REPASS.md) | works today; the data-driven keymap 0.3.0 S3 | not started (no step) |
| The keyboard sheet (mod+/): the list, filtered, no matches | yes, story `shell/keys-sheet` | derived: no board; kit Dialog, Field (search), Kbd | works today | not started (no step) |
| The notch's settings page (Bots in the notch, Shortcut, When it shows, Privacy and displays) | no | board `notch/stills/50-settings.jpg`; see conflict 15 | 0.2.0 E | not started (no step) |
| A bot's colour in its own chat: the setting to turn it off | no | decided: "with a setting to disable" (PLAN-w31-foundations); no board | 0.2.0 C | not started (no step) |
| A destructive section (archive, delete) | yes, in a bot's sheet | decided: "Danger hybrid" (PLAN-w31-foundations, pick 08); `v7/08-calm-options.jpg` | works today | not started (no step) |
| Editing a long text (a bot's SOUL.md, a role) | yes, in a bot's sheet | decided: "Long text: focused view" (PLAN-w31-foundations, pick 08); the spec's pattern "the long-text editor"; no key screen | works today | not started (no step) |
| A settings page with a long label or a narrow dialog | yes, story `components/set-row` "long", "narrow" | derived: board 14 rows | works today | not started (no step) |

## 12. Store and Connectors

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The Store's front page: the search, the kind chips, "Reading sources 0 of 1", Recommended in two columns, Mods, "3 installed" | yes (v6), `modules/store/view.ts`, stories `store/dialog`, `store/browse` | board `v7/15-store-*.jpg` | works today | not started (step 7) |
| An item row at rest, hovered, with Get or Open | yes | board `v7/15-store-*.jpg` | works today | not started (step 7) |
| Search results across kinds; nothing matches; nothing matches in one kind (show everything) | yes, `store/browse` | derived: board 15 list; kit ListRow (item), EmptyState with one action | works today | not started (no step) |
| One kind chosen (skills, connectors, engine plugins, mods); many items; long names | yes, `store/browse`, `store/dialog` | derived: board 15 | works today | not started (no step) |
| The sources being read, one by one; up to date after a read | yes, `modules/store/reading.ts` | board `v7/15-store-*.jpg` (the reading line); the per-source states derived; kit StatusLine | works today | not started (step 7) |
| Out of date: one or several sources could not be read, with the reasons; due a read again | yes, `store/browse` | derived: board 15 status slot; kit Notice in a page, StatusWord | works today | not started (no step) |
| Offline with the saved copy; the store did not load; no sources on | yes, `store/browse` | derived: board 15; kit Notice, EmptyState | works today | not started (no step) |
| An item's detail: what it is, where it comes from, what it reaches; not reviewed; taken down; not pinned; installed with an update; not there | yes, story `store/detail` | derived: no board draws a detail; kit Dialog or Pane, Card, Row, StatusWord | works today | not started (no step) |
| The review before installing: a key, a strong warning, a standing caution, the scope choice, an update's diff, could not be checked; hold to install | yes, story `store/review` | derived: `v7/11` AskCard (the hold), `session/S24` DiffView, `session/S19` OptionRows; no board draws it | works today | not started (no step) |
| Installed: the list with switches, an update available, Roll back, Remove with its keys, the taken-down banner, nothing installed | yes, story `store/installed` | derived: board 15 draws the link "3 installed"; kit ListRow, Switch, Notice | works today | not started (no step) |
| Sources: the list, a source you added, one that is off with the reason, add a source, offline, could not be read | yes, story `store/sources` | derived: no board; kit Card, Row, Switch, Field | works today | not started (no step) |
| A project's switch "No engine plugins and no plugin hooks" | yes, `modules/store/policy.ts` | derived: no board; kit Row, Switch | works today | not started (no step) |
| Connectors in Settings: installed ones in every state, the search, nothing installed, nothing matches, could not be read, long names | yes, `host/connectors.ts`, story `settings/connectors` | derived: board 15 rows; kit ListRow, Switch, StatusWord, EmptyState | works today | not started (no step) |
| Connectors for one bot: its own list, none yet, could not be read | yes, story `settings/connectors-for` | derived: as above, with a SelectorItem naming the bot | works today | not started (no step) |
| Adding a connector: from the collection, a URL or a command; the review; an OAuth sign-in | yes, `host/connectors.ts` | derived: the form rows of section 10; `O-B06` "Add GitHub" | works today | not started (no step) |
| "boopis restarted to read the key" after an install | yes, `host/connectors-notice.ts` | derived: `session/S17` Notice; kit Notice | works today | not started (no step) |
| An item's mark (a brand, a publisher's tile, letters) | yes, `components/item-mark.ts` | board `v7/15-store-*.jpg`; see conflict 30 | works today | not started (step 7) |

## 13. Models and sign-ins

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Providers: the search, the filter (All, Connected, Sign in, API key, On this computer, Custom), one head per lab, one row per way | yes, `host/providers-view.ts`, story `settings/providers` | derived: no board; nearest `onboarding/screens/O-P03-model-found-*.jpg` (three OptionRows); kit Field, Segmented, SectionHead, Row | works today | not started (no step) |
| Nothing set up; everything connected; "found on this computer"; more providers open; search with no match | yes, `settings/providers` | derived: as above; `O-P03b` for nothing found | works today | not started (no step) |
| A key form in place; "remove asks first"; many endpoints; long names and reasons | yes, `settings/providers` | derived: kit Field, Button, a confirm in the row | works today | not started (no step) |
| Sign in with ChatGPT: at its button, opening the page, waiting, cancelled, declined, timed out, could not start, could not reach, the clock is wrong, signed in | yes, `host/chatgpt-signin.ts`, story `settings/signin-card` | derived: `onboarding/screens/O-P03c-model-signing-in-*.jpg` and `O-P03d-error-sign-in-failed-*.jpg`; kit Block, StatusLine, Button | works today | not started (no step) |
| Sign in with GitHub Copilot: getting a code, the code to copy, copied, expired, declined, rate limited, no plan, signed in | yes, `host/copilot-signin.ts`, `settings/signin-card` | derived: as above, with the code in a Well | works today | not started (no step) |
| Sign in with SuperGrok: its button, getting a code, the code and the page, lapsed, rate limited, signed in | yes, `host/xai-signin.ts`, story `settings/xai-signin` | derived: as above | works today | not started (no step) |
| Claude Code: signed in, signed out, signing in, not installed (with the installer), only the desktop app's copy, did not start, too old, billed per use | yes, `host/providers-view.ts`, `settings/providers` | derived: `O-P03-model-found` ("Claude Code, signed in"), `O-P03b`, `O-P03c`; the other states have no board | works today | not started (no step) |
| A runtime on this computer (Ollama, LM Studio) used as the model | yes, `host/local-runtime.ts` | board `onboarding/screens/O-P03-model-found-*.jpg` ("Ollama, 2 models on this computer") | works today | not started (step 8) |
| The plan: free, none in use, not reported; the free tier's limit and "choose another model" | yes, `host/plan-view.ts`, `host/free-tier.ts` | derived: `session/S34` Notice with two actions | works today | not started (no step) |
| "Change models": the models question asked again | yes, `host/change-models.ts` | board `onboarding/screens/O-X02-settings-getting-started-*.jpg` ("Models: Claude, ChatGPT, Change") | works today | not started (step 8) |
| A model's short name beside its mark ("sonnet 5.5") | yes, `components/model-name.ts` | board `session/S17-new-session-*.jpg`; an open owner question (short names) | works today | matched, step 1 |
| The engine asks you to confirm a model pick (it costs a lot, or sends data where a policy forbids) | yes, `data/confirm.ts` | derived: no board; kit Dialog form with the engine's own sentence | works today | not started (no step) |
| The fallback model ("When it runs out") | no | board `session/S39-settings-sessions-*.jpg` | 0.3.0 S3 | not started (step 6) |

## 14. Mods

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Mods in the Store ("Pomodoro band", "Ledger glance") | yes | board `v7/15-store-*.jpg` | works today | not started (step 7) |
| A mod's view: its tree of text, rows, progress dots, buttons | yes, `components/mod-view.ts`, story `cards/mod-view` | derived: no board; kit Block, Row, Button | works today | not started (no step) |
| The band above the composer, folded and open | yes, `modules/mods/panes.ts`, story `cards/mod-surfaces` "band and status" | derived: no board; nearest `bots/K02-12` (a strip over the composer); see conflict 32 | works today | not started (no step) |
| The status line under the composer (the composer rises 22 px) | yes, `modules/mods/status.ts` | derived: no board; see conflict 32 | works today | not started (no step) |
| A mod's pane: a tab in the details panel from 1200 px, inline over the composer below it | yes, `modules/mods/panes.ts` | derived: no board; nearest `session/S28` (a fifth tab); see conflict 32 | works today | not started (no step) |
| Rows a mod places in the conversation (its log lines) | yes, `modules/mods/rows.ts` | derived: `v7/12` SystemLine | works today | not started (no step) |
| A mod's notice, one at a time, with "+N" | yes, `modules/mods/toasts.ts` | derived: `session/S17` Notice; see conflict 31 | works today | not started (no step) |
| "Apply <mod>'s colours?" with a live preview of the whole app | yes, `modules/mods/theme-card.ts`, `cards/form-theme` | derived: no board; kit AskCard question, swatches | works today | not started (no step) |
| A mod's question (a form with the mod as the asker) | yes | derived: section 10's form rows | works today | not started (no step) |
| A mod in the dock ("A focus timer in the dock") | unknown: the store's sample text on board 15 says so; no dock surface for mods was found in `modules/mods` | derived: no board; the spec's 21.4 removes the dock's pages | unknown | not started (no step) |

## 15. Onboarding and first run

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Hello: the whole window, the "oo" mark, "Hi, I'm boopis", Let's start, "Skip setup" | partly, the v6 welcome (`host/first-run.ts`, story `settings/first-run` "welcome") | board `onboarding/screens/O-P01-hello-*.jpg` | 0.2.0 C | not started (step 8) |
| Hello while the engine gets ready | partly, "unpacking the engine" | board `onboarding/screens/O-P01b-hello-engine-getting-ready-*.jpg` | 0.2.0 C | not started (step 8) |
| The three settings boopis needs: Apply the changes, Not now | partly, "consent: the three settings" | board `onboarding/screens/O-P02-settings-boopis-needs-*.jpg` | 0.2.0 C | not started (step 8) |
| The settings declined | yes, "consent declined" | derived: O-P02; what the app says when they are refused has no board | works today | not started (no step) |
| A model: found (Claude chosen), nothing found, signing in, the sign-in failed, offline | partly, the models hub | board `onboarding/screens/O-P03-model-found-*.jpg`, `O-P03b`, `O-P03c`, `O-P03d`, `O-P03e` | 0.2.0 C | not started (step 8) |
| The models hub of today: four sign-ins, a wall of key tiles, runtimes found, your own endpoint, more providers | yes, `host/providers-hub.ts`, `settings/first-run` "models hub, …" | derived: O-P03 offers three sources and "Use another"; see conflict 27 | works today | not started (no step) |
| A key asked for in setup; a key form in place | yes, `settings/first-run` "a question (a key)" | derived: O-P03b; kit Field | works today | not started (no step) |
| Try it: marks in a real composer, a mark open, "Keep reading your drafts?", the recorded example | no | board `onboarding/screens/O-P04a-try-it-marks-*.jpg`, `O-P04b`, `O-P04c`, `O-P04d` | 0.2.0 D (feedforward live; the recording stands in without a model) | not started (step 8) |
| Sessions setup in the app: add a folder, where changes go (worktree), how careful, "You're set. What's first?" | no | board `onboarding/screens/O-S01-add-a-folder-*.jpg`, `O-S02-worktree`, `O-S03-how-careful`, `O-S04-ready` | 0.2.0 C; the worktree choice 0.3.0 S1 | not started (step 8) |
| The hand-off: the mark becomes the boopis bot and the tab switches by itself; or it asks first ("Meet your bots", Later) | no | board `onboarding/screens/O-H01-handoff-auto-switch-*.jpg`, `O-H01b-handoff-prompt-option-*.jpg` | 0.2.0 C | not started (step 8) |
| boopis in its chat: greets, what bots are, goals as tiles (one pick, two picks), where bots work, your name | no | board `onboarding/screens/O-B01` to `O-B05` (`O-B03-goals-tiles`, `O-B03b-goals-two-picks`) | 0.2.0 C | not started (step 8) |
| The starter team and a connector; the approval rules; the build; keeping up without the window; the first job | no | board `onboarding/screens/O-B06` to `O-B10`; see conflict 29 | 0.2.0 C; the team plan and the rules 0.2.0 D | not started (step 8) |
| Pick up where you left off; a returning user ("Welcome to the new boopis"); the Bots part started later | no | board `onboarding/screens/O-X01-resume-*.jpg`, `O-X03-returning-user-*.jpg`, `O-X04-bots-later-first-open-*.jpg` | 0.2.0 C | not started (step 8) |
| The motion: the mark waking, reacting, the morph into the bot; reduced motion | no | decided: "Much more motion in onboarding … bots look to the sides, turn, bob their heads" (PLAN-session-waves); the frame strips are on `onboarding/contact-sheet.jpg`; the clips themselves are not in the archive | 0.2.0 C | not started (step 8) |
| Setup's checklist while steps run; a step blocked (the disk is full; no engine, with the install command) | yes, `settings/first-run` "steps running", "blocked", "blocked, no engine" | derived: `O-P01b` and `O-P03d`; no board draws a blocked setup | works today | not started (no step) |
| The summary: the ladder made from what is connected; choosing where to start | yes, `settings/first-run` "summary: …" | derived: no board in round 3; see conflict 27 | works today | not started (no step) |
| Optional steps: connectors, the store; done; done with a declined step | yes, `settings/first-run` "optional: …", "done" | derived: `O-B06` puts the connector in boopis's chat; `O-S04` is the end of setup; see conflict 27 | works today | not started (no step) |
| The window's own controls on a full-window page | yes | board `onboarding/screens/O-P01-hello-*.jpg` (the glyphs at the top right) | works today | not started (step 8) |
| The engine updated by itself: one line; it failed: the line offers Set up | yes, `host/engine-update-notice.ts` | derived: `session/S17` Notice | works today | not started (no step) |

## 16. Dialogs, menus, palette, notices, tooltips

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The command palette (mod+K): sessions, bots and commands; a typed query; no matches; many results; a long query | yes (v6), `modules/shell/palette.ts`, story `shell/palette` | derived: no board draws the palette; nearest `session/S31-slash-commands-*.jpg` (a list of name and description rows) and `v7/P2-search-placements.jpg` (where it opens from); kit Dialog, Field (search), MenuRow, Kbd | works today; "the palette covering every action" 0.3.0 S3 | not started (no step) |
| The palette limited to commands (">"), to bots ("@"), to archived bots ("Restore bot…") | yes | derived: as above | works today | not started (no step) |
| "Go to a session or bot" (mod+P) | yes, the keymap | derived: as above | works today | not started (no step) |
| A menu: rows with a glyph, a description, keys, a check, a danger row, a divider, a heading | yes, kit `menu`, story `kit/menu` | board `session/S31-slash-commands-*.jpg`, `session/S30-session-inbox-*.jpg`, `session/S29-commit-*.jpg` (the split button's menu) | works today | not started (step 6) |
| A menu of two-line radio rows | yes | board `session/S19-launch-step-*.jpg` | works today | not started (step 6) |
| A context menu on a bot or a session (Rename, Copy link, Mark as unread, Archive, Delete…) | partly: rename, archive and delete exist; "Mark as unread" and "Copy conversation link" do not | derived: `v7/03-light-shadows.jpg` draws such a menu as a sample of shadows; not a key screen | works today for what exists | not started (no step) |
| A select open: a few options, models grouped by provider, 120 options, flipped above | yes, story `components/select` | derived: `session/S19` menu; kit Menu, SelectorItem (field) | works today | not started (no step) |
| A form dialog (a title, fields, Cancel and one primary) | yes | board `session/S18-import-sessions-*.jpg`, `session/S29-commit-*.jpg` | works today | not started (step 6) |
| A confirm before something is lost (delete a bot, remove a key, remove a connector's keys) | yes, `modules/bots/settings.ts`, `host/providers-view.ts`, `modules/store/view.ts` | derived: `v7/02-radii.jpg` draws a "Delete nina?" confirm as a sample; kit Dialog form, Button danger | works today | not started (no step) |
| A floating notice ("Archived audit log export", with Undo; a long one) | yes (v6 toast), `components/toast.ts`, story `shell/toast` | derived: `v7/03-light-shadows.jpg` draws "Link copied / Undo" as a sample; kit Notice (floating); see conflict 31 | works today | not started (no step) |
| A notice over the composer (a limit; dismiss) | yes | board `session/S17-new-session-*.jpg`, `session/S34-usage-limits-*.jpg` | 0.3.0 S3 | matched, step 1 (S17) |
| A notice in a page (a source could not be read; taken down by its source) | yes (v6) | derived: S17 Notice with `place: page`; no board | works today | not started (no step) |
| A tooltip: a name, a name and keys, a cut name shown whole, a reason why a control is disabled | yes, `components/tooltip.ts`, story `kit/tooltip` | derived: no board draws a tooltip; `dock/DK1-the-row.jpg` says the dock uses none; rule 2 of REPASS.md requires the "why" tooltip; kit Tooltip | works today | not started (no step) |
| The scrim under a dialog | yes | board `v7/14-settings-*.jpg` | works today | not started (step 7) |
| What the screen reader is told (one polite live region) | yes, `components/announce.ts` | derived: nothing to draw | works today | not started (no step) |
| A notification when the window is not focused | no | derived: no board; the system's own notification | 0.3.0 S3 | not started (no step) |

## 17. Errors, empty, offline, engine states

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| The whole app empty: no project, no session | yes, story `pages/window` "empty app" | board `session/S41-no-project-*.jpg` | works today | matched, step 6b (S41) |
| The Bots tab the first time, with no bot of your own | partly | board `onboarding/screens/O-X04-bots-later-first-open-*.jpg` | 0.2.0 C | not started (step 8) |
| The app could not start: the reason, the code, Retry (also without a code, with a long reason) | yes, `host/notice.ts`, story `settings/startup-notice` | derived: `onboarding/screens/O-P03d-error-sign-in-failed-*.jpg` (a full-window page led by the mark, "Try again"); `host/notice.ts` says "the owner may design one" | works today | not started (no step) |
| The engine getting ready at first start | yes | board `onboarding/screens/O-P01b-hello-engine-getting-ready-*.jpg` | works today | not started (step 8) |
| The engine stopped while a session is open | unknown (section 6) | board `session/S36-error-engine-stopped-*.jpg`; see conflict 26 | unknown | not started (step 4) |
| The engine stopped while a bot's chat or a room is open | unknown | derived: S36's line in a bot's thread; kit SystemLine with an action | unknown | not started (no step) |
| The link to the engine lost and found again (forms and mods read again) | yes, `host/gateway.ts`, `host/live-provider.ts` | derived: `session/S35-after-restart-*.jpg` (one line); no board for "reconnecting" | works today | not started (no step) |
| No model signed in | partly | board `session/S37-no-model-*.jpg`; see conflict 26 | works today | not started (step 4) |
| A model limited (a subscription's limit; the free tier's) | partly | board `session/S34-usage-limits-*.jpg` | 0.3.0 S3 | not started (step 6) |
| The gate failed | partly | board `session/S38-error-gate-failed-*.jpg` | works today | not started (step 4) |
| Offline during setup | no (the hub says it per provider) | board `onboarding/screens/O-P03e-error-offline-*.jpg` | 0.2.0 C | not started (step 8) |
| Offline in the Store, in a sign-in, in a connector's test | yes, stories `store/browse`, `settings/signin-card`, `settings/connectors` | derived: no board for the app offline; kit Notice, StatusWord | works today | not started (no step) |
| A list that could not be read (connectors, providers, sources, a kanban board, a bot's connectors) | yes, the stories named in sections 4, 12, 13 | derived: no board; kit EmptyState with the reason and one action | works today | not started (no step) |
| A value the app does not have ("Context size: unknown", "Model unknown", an unpriced model, the plan "Not reported") | yes | derived: the row without the value, in words (invariant 5: unknown is shown as unknown) | works today | not started (no step) |
| A feature this build does not have yet: the control disabled, with why | yes (the worktree selector, "Get more usage", two AskCard answers; the voice button is the named exception: always shown, it says what it needs) | decided: "A control is disabled only when the feature does not exist yet, with a tooltip saying why, and it is listed for the owner" (REPASS.md, rule 2); see conflict 24 | per control | built at steps 1 and 3 |
| The page without the desktop host (the lab, a browser): "Connectors are added in the desktop app" and the like | yes | derived: not a screen the person sees in the app; kit EmptyState | works today | not started (no step) |
| A bot's preview mark in the palette ("preview") | yes, `modules/shell/palette.ts` | derived: no board; kit StatusWord | works today | not started (no step) |
| The page stalled (the host's heartbeat notice) | yes, `host/heartbeat.ts` | derived: no board; kit Notice | works today | not started (no step) |

## 18. Notch (macOS)

Nothing of the notch is in the app: it is a Swift helper (0.2.0 E, `w34/notch-helper`), "aligned to v7". The kit has a
`Notch` component (story `kit/notch`) that draws the slab's shape only. Every row: **Exists today?** no; **Feature** 0.2.0 E;
**Repass** not started (no step in REPASS.md's table).

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Off (the default until the owner turns it on) | no | decided: `notch/notch-spec.md` 4.1; nothing is drawn | 0.2.0 E | not started (no step) |
| The first time it is turned on: "Your bots live here now" | no | board `notch/stills/00-first-run-hello.jpg` | 0.2.0 E | not started (no step) |
| Rest: the Mac's own notch; a display without one; a bot just done | no | board `notch/stills/01-rest.jpg`, `01b-rest-external.jpg`, `01c-rest-just-done.jpg` | 0.2.0 E | not started (no step) |
| Wings: one bot at work, several, needs you, failed; without a notch | no | board `notch/stills/02-ambient-one-bot.jpg`, `02b`, `03-ambient-several.jpg`, `04-ambient-needs-you.jpg`, `05-ambient-failed.jpg` | 0.2.0 E | not started (no step) |
| Wings with words | no | board `notch/stills/06-wings-words-4A.jpg`, `06b-wings-words-needs.jpg`, `06c-wings-words-4B.jpg` | 0.2.0 E | not started (no step) |
| The hover card: one bot's steps, several bots, progress | no | board `notch/stills/07-hover-working-card.jpg`, `07b-hover-several.jpg`, `07c-hover-progress.jpg` | 0.2.0 E | not started (no step) |
| The stage, one bot at a time: idle, working, typing, needs you, listening, failed; without a notch | no | board `notch/stills/08-stage-idle.jpg`, `08b`, `09-stage-working.jpg`, `10-stage-typing.jpg`, `11-stage-needs-you.jpg`, `12-stage-listening.jpg`, `13-stage-failed.jpg` | 0.2.0 E; listening: unknown (voice) | not started (no step) |
| Quick actions; a banner for another bot | no | board `notch/stills/14-stage-quick-actions.jpg`, `15-stage-banner-other-bot.jpg` | 0.2.0 E | not started (no step) |
| A bot's thread: your messages, working steps, a reply streaming, typing while it replies (held), an approval inline, a receipt, stopped | no | board `notch/stills/16-thread.jpg`, `16b-thread-you-1A.jpg`, `17` to `22-stopped.jpg` | 0.2.0 E | not started (no step) |
| Rooms and a room: the list, a ping in each option, a room with you | no | board `notch/stills/23-rooms.jpg`, `24-room-ping-AC.jpg`, `24b`, `24c`, `24d-room-ping-app.jpg`, `24e-room-you-1B.jpg` | 0.2.0 E | not started (no step) |
| An approval: hold, holding at 60%, tap, answered; without a notch; several stacked (peek, list) | no | board `notch/stills/25-approval-hold.jpg`, `25b`, `26-approval-holding-60.jpg`, `27-approval-tap.jpg`, `28-stack-peek.jpg`, `28b-stack-list.jpg`, `29-approval-answered.jpg` | 0.2.0 E | not started (no step) |
| Cards: a reply (A, B, the mini C), a reply tapped, a ping, a scheduled run, an error, several stacked | no | board `notch/stills/30-card-A-reply.jpg`, `30b`, `31-card-B-reply.jpg`, `32-card-C-mini.jpg`, `33` to `37b-cards-stack-list.jpg` | 0.2.0 E | not started (no step) |
| Offline: boopis is not running; the Local API is off; boopis is starting | no | board `notch/stills/38-offline-not-running.jpg`, `39-offline-local-api-off.jpg`, `40-offline-starting.jpg` | 0.2.0 E | not started (no step) |
| A full-screen app; words hidden; increased contrast; a light menu bar; long names and many bots; reduced motion | no | board `notch/stills/41-full-screen.jpg`, `42-words-hidden.jpg`, `43-increased-contrast.jpg`, `44-light-menu-bar.jpg`, `44b-light-card.jpg`, `45-long-names-many-bots.jpg`, `46-reduced-motion-stage.jpg` | 0.2.0 E | not started (no step) |
| The owner's picks among the notch's options | no | decided: "your messages B in a 1:1, A in rooms; ping A+C; approval hold everywhere; small orbs badge (A); cards A, with C as the Quiet setting; several cards peek" (`notch/owner-decisions.md`) | 0.2.0 E | not started (no step) |
| Its corners | no | decided: "every nested surface keeps the design system's corner rules … the chat box's corner did not match the notch's" (`notch/owner-decisions.md`) | 0.2.0 E | not started (no step) |
| The notch's settings in boopis | no | board `notch/stills/50-settings.jpg` (section 11 has the row; see conflict 15) | 0.2.0 E | not started (no step) |
| The island on Linux (the same options, "round 4") | unknown: it is a separate shell client of the Local API, not in this app's UI | unknown: its boards are not in the archive | unknown | not started (no step) |

## 19. Narrow widths and density

No board is drawn at any size but 1440 × 900. Every row here is derived or decided in words.

| Screen or state | Exists today? | Reference | Feature | Repass |
|---|---|---|---|---|
| Under 1200 px: the compact rail (64, tiles of 44) by itself | partly: the kit has the size; the shell does not switch to it | decided: "44/64 as an option, automatic at small desktop sizes" (PLAN-w31-foundations, pick 06); `v7/06-sidebar-tile.jpg` B | 0.2.0 C | not started (no step) |
| Under 1200 px: the right panel starts closed; a mod's pane moves inline over the composer | yes, `core/state.ts`, `modules/mods/panes.ts` | derived: no board | works today | not started (no step) |
| Under 900 px: the sidebar becomes a rail by itself, and opens as a drawer over the work with a scrim | yes, `core/state.ts` `autoLeft`, `modules/shell/layout.ts` | derived: no board; the open sidebar of K02 over a scrim | works today | not started (no step) |
| Under 900 px: the details pane and the tools panel overlay the work | yes for today's panel | decided in the spec ("pushes the work (overlays under 900)", section 7 and 21.2 component 3); no board | works today | not started (no step) |
| Under 900 px: the composer's line folds the branch and the context away | no | decided in the spec's S05 row; no board | 0.2.0 C | not started (no step) |
| Under 640 px: the sidebar closed, the column's margin folded | yes, `layout.ts` (`phone`) | derived: no board | works today | not started (no step) |
| A wide window: the column stays 640, centred on the work | yes | derived: the boards' own layout rule (the composer and thread centred on the work) | works today | not started (no step) |
| The Settings and Store dialogs in a window narrower than they are | yes (v6) | derived: no board; kit Dialog | works today | not started (no step) |
| The dock in a narrow window: fewer bots, then "N more" | yes | derived: `dock/K05-many-bots-*.jpg`; the row "fits its content up to 640" | works today | not started (no step) |
| The providers list, a settings row and "Claude: not installed" at a narrow width | yes, stories `settings/providers` "narrow", `components/set-row` "narrow" | derived: no board | works today | not started (no step) |
| The interface at 112% and 125%: sessions, bots, a room, the rail, the dock | yes, story `shell/interface-size` | derived: every board, scaled by the web view | works today | not started (no step) |
| Rounder corners (radii C) across the app | no | board `v7/02-radii.jpg` C | 0.2.0 C | not started (step 7) |
| Quiet text in the light theme under 4.5:1 | yes, as the boards draw it | unknown: an open owner question in the lead's notes; the contrast was not measured for this map; see conflict 33 | works today | not started (no step) |
| A density setting (compact rows) | no | derived: no board and no decision offers one; the interface size is the only scale | unknown: no plan names it | not started (no step) |

---

## List 1. Boards with no screen in the app yet

The feature is future, or the screen was never built. Each is built with its feature, so nothing is drawn before it works
(the lead's plan, phase 4); until then its control on an existing screen is disabled with a reason (conflict 24).

| Board | What it draws | When |
|---|---|---|
| `session/S18-import-sessions-*.jpg` | importing Claude Code and Codex sessions | unknown: no wave names it |
| `session/S21-blank-waiting-*.jpg`, the lapsed blank on `S23` | a blank that waits inline, then lapses into an ask | 0.2.0 D (blanks inline) |
| `session/S22-steer-and-queue-*.jpg`, `S35-after-restart-*.jpg` | steer, the queue, a queue that survives a restart | 0.3.0 S1 |
| `session/S30-session-inbox-*.jpg` | Snooze and Settle on a row, the snooze menu | 0.3.0 S1 |
| `session/S23-finished-turn-*.jpg` (the files card, Fork) | changed files with Open diff; fork from a checkpoint | 0.3.0 S2 |
| `session/S24` to `S28` | the tabbed right panel: Diff, Files, Terminal, PR, Side chat | 0.3.0 S2 |
| `session/S29-commit-*.jpg` | commit, push, open a PR | 0.3.0 S2 |
| `session/S31-slash-commands-*.jpg`, `S32-files-and-skills-*.jpg` | "/" commands, "$" skills | unknown: no wave names them |
| `session/S34-usage-limits-*.jpg` | a limit reached, the weekly bar, the context ticks | 0.3.0 S3 |
| `session/S39-settings-sessions-*.jpg`, `S16-components-scope-picker.jpg` | Settings > Sessions; This device / This project | page 0.2.0 C; the scope 0.3.0 S3 |
| `session/S40-session-details-*.jpg` (Pull request; Pin, Fork, Settle) | the PR row and the overflow | 0.3.0 S1 and S2 |
| `session/S05-composer-line.jpg` B | the composer line's quick menu | 0.2.0 C |
| `session/S20-running-supervised-*.jpg` (decline with feedback) | typing declines a waiting change | unknown: not found in a wave table |
| `v7/14-settings-*.jpg` (Rail size, Show search, Search shows as, Under the composer) | four settings and one card | 0.2.0 C |
| `v7/P2-search-placements.jpg`, `v7/06-sidebar-tile.jpg` B | search as a button or a pill; the compact rail | 0.2.0 C |
| `v7/11-bot-chat-rail-*.jpg` ("Allow all this turn", "Always allow", the rule line; Library) | two answers that need the rules engine; the Library side | 0.2.0 D; Library unknown |
| `v7/12-group-room-sidebar-open-*.jpg` (a room's approval, a room's cost) | the provider has neither for a room | unknown: a known gap, no wave |
| `dock/K08-compact-idle-*.jpg` | the compact dock and its setting | 0.2.0 C |
| `onboarding/screens/O-P01` to `O-X04` (33 screens) | the one continuous first run | 0.2.0 C; `O-P04*` needs 0.2.0 D (feedforward live); `O-B06` (team plan) and `O-B07` (rules) need 0.2.0 D; `O-S02` (worktree) needs 0.3.0 S1 |
| `notch/stills/*` (66 stills) | the macOS notch | 0.2.0 E |

## List 2. App screens and states with no board (the derived rows)

Grouped as batches for the owner's review, the most used first. Each batch is one contact sheet: every state rendered in
the lab from kit components, beside its nearest board.

1. **Composer, every day** (section 8): several lines and a tall draft; Stop while a turn runs; dictation listening; a
   folder, a picture, a drop and a paste; the "@" list and the capsule (built at step 3); "@all", a bot that is not here;
   "@" a model in a session; reviewing the assumptions; the session's "+" menu of today; tooltips; 390 px and right-to-left.
2. **Sidebar, rail and chrome** (sections 1, 2): one bot, 120 bots, long names, the made-outside mark; the Archived group;
   the New menu; the account menu; the attention dot on the switch; the rail's "+N" (built) and its tab button; the
   sidebar hidden; a settled list opened; a session row's menu and renaming; window glyphs for a tiling desktop and for
   macOS; the title pill with a long name and while a turn runs.
3. **A session's thread without a board** (sections 5, 6, 7): the rewind sheet, its disabled state and its line; the model,
   effort and folder menus; a step that cannot be picked; the divider where the model changes and the "ungoverned" mark;
   a council (the form and seven turn states); tasks handed to other models; an escalation; a failed turn; a ship that
   passed or was rolled back; find in the conversation; today's details sections (Context and Compact, Connectors, Output,
   Environment, Tasks, Changes, Governance) and the context strip.
4. **Asks and their small states** (sections 3, 10): an answered ask as one row; denied, expired, cancelled; the hold in
   progress; several asks, the next peeking; the more menu of a turn; a reply in markdown.
5. **A bot beyond its chat** (section 3): the settings sheet (role, SOUL.md, model, routines, governance, cap, workspace,
   archive); saving with the diff; the look editor; the run-limit menu; New bot; archive, delete and restore; a live bot's
   earlier sessions; a bot with no thread; no bots at all; who is at work, in detail.
6. **A room beyond its thread** (section 4): the details pane (built at step 3); the kanban board and its six unhappy
   states; New group and changing members; no messages yet; group chat off; "Let them continue"; a mention's card and
   menu; a path's menu; several members at work; a bot that is not in the room.
7. **Palette, menus, dialogs, notices, tooltips** (section 16): the palette in all its states; go to a session or bot; the
   keyboard sheet; a select open; a context menu; the confirm before a loss; the floating notice; a notice in a page; the
   tooltip, including the "why" of a disabled control.
8. **Forms** (section 10): the form card open and in its six other states; the thirteen kinds; who is asking; compact and
   one-row sizes; a connector asked for in the thread; a teammate and a schedule.
9. **Settings pages no board draws** (section 11): Models; Connectors; Approvals (the rules page, with 0.2.0 D); Bots;
   Appearance and Size; Keyboard; Diagnostics' content; Window; Local API; the feedforward switches; "Keep the dock
   centred" and "Compact dock when idle"; the bot-colour switch; the long-text editor.
10. **Models and sign-ins** (section 13): Providers and its filters; the four sign-in cards (ChatGPT, GitHub Copilot,
    SuperGrok, Claude Code) in every state; a key form; an endpoint of your own; the plan and the free tier's limit; the
    engine's confirm of a model pick.
11. **The Store beyond its front page** (section 12): search and filters; the read states; offline; an item's detail; the
    review before installing; Installed; Sources; the project's switch; Connectors in Settings and for one bot.
12. **Errors, empty and offline** (section 17): the app could not start; the engine stopped in a bot's chat; the link lost
    and found; a list that could not be read; a value the app does not have; the page stalled.
13. **The dock's remaining states** (section 9): a card with no ask, with the bot working, with no messages; one bot; a
    long name; a form answered from the dock; its keys; "Grow bots on hover".
14. **First-run steps round 3 does not draw** (section 15): the settings declined; a step blocked; today's hub of many
    providers; a key form; the summary and its ladder; the optional steps; the engine's update line.
15. **Mods** (section 14): the mod's view, the band, the status line, the pane, placed rows, the notice with "+N", the
    colours card.
16. **Narrow widths and sizes** (section 19): under 1200, 900 and 640 px; dialogs in a narrow window; 112% and 125%.
17. **Future features with no board** (sections 6, 7, 10, 16): the plan turn; history paging; the split diff; a file opened
    read-only; a PR's other states; a commit's errors; a terminal's second shell; drafting a rule's exception; editing a
    request before approving; notifications when the window is not focused.

## List 3. Conflicts and doubts

Both sides as they are written or drawn. None is resolved here.

1. **A session's thread: board 10 and 13 against S20 to S23.** `v7/10-session-chat-*.jpg` and `v7/13-…` draw the approval as
   a block headed "Ship" ("Write 2 files to the workspace?", "Deny esc", "Hold to approve"), no mark beside the agent's
   bubbles, and the title pill without a branch. `session/S20-running-supervised-*.jpg` draws the approval inside the tool
   row ("Decline", "Always allow this session", "Hold to allow once", "Waiting for you"), the model's mark in the gutter of
   every agent bubble and block (the pick S09 "approved, branded"), and the branch in the pill. REPASS.md's step 4 names
   all of them together ("10, 13, S20–S23"). Which set is later could not be determined: the archive keeps no order
   (`jobs-fix.json` and `jobs-merge.json` render 10 and 13 again; `jobs-sk.json` renders S17 to S41).
2. **The Sessions sidebar.** `v7/13-session-sidebar-open-*.jpg` and `bots/K02-13-session-*.jpg` draw "Today 3" and
   "Yesterday 3" with a time at each row's end and a dot on the running one. `session/S17` to `S40` draw the inbox:
   "Needs you 1", "Working 2", "Pinned 1", "Recent 3", "Settled 12", the model's mark and the branch on each row (the pick:
   "S03 sections"). The app draws the inbox (matched at step 1). K02 is the later board for the open Bots sidebar; whether
   K02-13 says anything about the Sessions list is not recorded.
3. **Bots in the Sessions tab.** `v7/10-session-chat-*.jpg` draws the rail of bots (seven tiles and a room's cluster) beside a
   session. The owner, 23 November: "the Sessions tab shows no bots except the dock (and maybe notifications)"
   (PLAN-session-waves). No board draws a collapsed sidebar in the Sessions tab after that decision.
4. **The hand-off row.** `bots/K02-12-room-main44-*.jpg` draws "kai handed the notes to nina" between two messages, and the
   spec's SystemLine lists "hand-off (two 16 orbs and a chevron)". `v7/12-group-room-sidebar-open-*.jpg` as finally rendered
   draws no hand-off (it draws "Created routine Weekly changelog" and an approval). REPASS.md: "Board 12 stays the reference
   for the room (title pill, thread, composer); K02 for a message held over the composer."
5. **K02-11's thread.** `bots/K02-11-bot-chat-main44-*.jpg` draws your bubble in grey and the voice button in white, and a
   question with lettered rows. `v7/11-bot-chat-rail-*.jpg` draws your bubble and the voice button in kai's green, and an
   approval. The owner: "in a specific bot's own chat they take that bot's colour by default". REPASS.md names K02 for the
   sidebar only; whether its thread (the lettered question) is still a reference is not recorded.
6. **What the session composer's line says.** `v7/10` and `v7/13` draw "Governed", "Smart" and "$0.37 of $0.60".
   `session/S20` to `S23` draw "Supervised" or "Auto-accept edits", the branch, "sonnet 5.5" with effort ticks, context
   ticks with "76k / 200k", and the cost; no "Governed", no "Smart". The app has both ideas: Governed and Smart as controls
   (alt+G, alt+S, the model menu's "Automatic (Smart)") and the four-step scale (S0). The plan maps them ("Full access:
   ungoverned"); no board shows Smart, or a governed tier's route, on the S20 line.
7. **"Under the composer" in Settings.** `v7/14-settings-*.jpg` lists "Mode", "Smart or the pinned model", "Model", "Cost
   against the cap", "Context used". The spec's S05 row lists "how careful, branch, model and effort, context and cost"
   and says the quick menu "is the same list as Settings > General > Under the composer".
8. **What "+" in the composer does.** The spec's S05 row: "the quick menu (the on/off list) opens from the composer's + or
   a click on the line". REPASS.md, 25 November: "a file added with '+' is a reference chip in the composer's text". The app:
   in a bot's chat, a room and a new session "+" asks for files; in a started session it opens a menu (Attach a file, Add a
   folder to context, Mention a file, Commands).
9. **Enter and ctrl Enter.** SESSION-TAB.md section 4: "Enter steers the running turn … ctrl Enter queues." The owner's pick:
   "S06 Ctrl+Enter steers, Enter while running queues", as `session/S22` draws ("Enter queues, ctrl Enter steers").
   `session/S17` draws "Enter starts the session" and "ctrl Enter starts it in the background". REPASS.md: "ctrl Enter is
   left as it is (it sends), and S17's hint as drawn". Today's keymap sheet: "Send now: mod+enter".
10. **The default step.** SESSION-TAB.md section 2: "boopis starts Supervised (a setting)". The owner's pick: "S02 default
    Auto-accept edits (configurable; asked in onboarding; no trusted gate -> Supervised)", as S17, S19 and S39 draw.
11. **An approval's answers, surface by surface.** `v7/11` and `v7/12`: "Hold to allow once", "Allow all this turn", "Always
    allow", "Deny esc". `dock/K03` and `K04`: "Hold to allow once", "Always for staging", "Deny esc". `session/S20`:
    "Decline", "Always allow this session", "Hold to allow once". `v7/10`: "Deny esc", "Hold to approve".
    `notch/stills/11-stage-needs-you.jpg`: "Deny", "Hold to approve". The rules-engine spec: "Allow once / Always allow /
    Deny / Allow all this turn". Today's permission form: "Once", "For this session", "Always, in this project", "Deny".
12. **Bots asking questions.** The owner: "Bots never have blanks; they ask only through approvals the owner defined
    beforehand (rules engine + tiers), shown as the Grok-Bot approval cards, with NO time limit." `dock/K03-asks-open-*.jpg`
    draws a bot's question ("The WebKit job flaked twice. Quarantine it?" with three chips) and `bots/K02-11` a bot's
    lettered question. The plan also says "`ask` and `request_input` follow the blanks rule next wave".
13. **Rewind's words.** `session/S23-finished-turn-*.jpg`: "Checkpoint 3", "Undo", "Edit from here", "Fork". The app (S0, from
    `docs/specs/checkpoint-rewind.md`): "Rewind files to here" and "Rewind to before this session", then a dry-run sheet
    that no board draws.
14. **A session's details.** `session/S40-session-details-*.jpg`: one pane with "Session" (Model, Effort, How careful,
    Workspace) and "Use" (Context, Cost, Pull request). The app: a panel of seven sections (Context with "Compact
    conversation", Connectors, Output, Environment, Tasks, Changes, Governance), each a palette command ("Open context" …).
    `session/S24` to `S27` give Changes to Diff and Output to Terminal; no board places Compact, Connectors, Environment,
    Tasks or Governance.
15. **The Settings nav: three boards, three lists.** `v7/14`: General, Models, Connectors, Approvals, Appearance, Keyboard,
    Diagnostics. `session/S39`: General, Sessions, Bots, Models, Approvals, Connectors, Appearance, Keyboard.
    `onboarding/screens/O-X02`: General, Models, Connectors, Approvals, Sessions, Bots, Appearance, Keyboard. The app:
    General, Models, Connectors, Appearance, Keyboard. `notch/stills/50-settings.jpg` draws a fourth: Settings in the v6 look,
    tabs across the top (General, Appearance, Models, Bots, Local API, Notch), against "notch helper … aligned to v7"
    (PLAN-0.2.0) and "Maintain the design system's choices everywhere" (`notch/owner-decisions.md`).
16. **Diagnostics.** A page of its own on `v7/14`'s nav; absent from the nav on `S39` and `O-X02`; a section of General in
    the app.
17. **What General holds.** `v7/14`: "Layout", "Under the composer", "Appearance". `O-X02`: "Getting started", "This
    computer", and nothing else in view. Whether these are one page, and in what order, is not drawn. `v7/14` also has an
    "Appearance" card on General while its nav has an Appearance page.
18. **"Search shows as".** `v7/14-settings-*.jpg` draws the row's value as "A button" while the chrome on the same board draws
    the hint "Search ctrl K". The owner: "Search default S5: keyboard-first with a clickable hint; button and pill as
    Settings options".
19. **Settings > Sessions.** SESSION-TAB.md section 17 lists five groups (New sessions with a default project folder and
    effort; While it runs; Worktrees; Inbox with "snooze until usage resets" and "resume after limits"; Git).
    `session/S39-settings-sessions-*.jpg` draws three (New sessions: Workspace, Model, When it runs out, How careful; While
    it runs; Inbox with four switches). Worktrees and Git are on no board.
20. **The open dock's size.** The spec's kit table, component 41: "open (640, its height fits the stack or a card)".
    `dock/DK2-asks-and-card.jpg`: "one fixed size for every card and stack (640 × 432)". The owner: "the open dock states and
    the composer stay a fixed size."
21. **The dock's order.** `dock/D01-many-bots.jpg` B: "needs you first, then working, then your pinned and recent bots".
    `modules/dock/model.ts`: "the app keeps no pin and no recency of its own yet: an owner question".
22. **The dock's key screens and keys.** The spec's 21.4 says "K01 to K09 key screens"; the archive has `dock/K01` to `K08`
    (`bots/K09-eyes-bolder.jpg` is another board). The spec removes the dock's pages, grid, nub, minimal mode and "+"; today's
    keymap sheet and palette still list them ("Bot row: open the grid on the same bot", "Page nub", "Minimise the dock",
    "Expand or collapse the dock"). REPASS.md: "keys get their own pass".
23. **The rail's orbs.** REPASS.md: "The rail keeps board 11's orbs (36): the rows' 28 against the rail's 36 is an open owner
    question". The recorded pick: "Grok sizes (rows 28, rail 36)". Board 11's source draws 36. These agree as read here;
    what remains open (the lead's notes list "the rail's orb size: board 11 (matched) against the recorded 'rail 36'")
    could not be determined.
24. **A control whose feature comes later.** REPASS.md, rule 2: "A control is disabled only when the feature does not exist
    yet, with a tooltip saying why". The lead's open question: "disabled with a reason (current), or hidden?" It applies to
    "New worktree" on S17, "Get more usage", "Allow all this turn", "Always allow", the voice button, and every later
    board's control on a 0.2.0 screen.
25. **Two boards that contradict themselves.** `session/S23-finished-turn-*.jpg`: the open session is still under "Needs
    you 1" with an "Approval" badge, while its turn is finished and only a question waits (the source passes an empty badge,
    which falls back to "Approval"). `session/S22-steer-and-queue-*.jpg`: the title reads "Calc: multiply and divide
    w32/calc-ops" while the current row in the sidebar is "Room mentions in every compo… w29/mentions".
26. **Error words.** `session/S36`: "boopis's engine stopped" with a button "Start it again"; SESSION-TAB.md section 15:
    "(Restart)". `session/S37`: a block, "boopis needs a model to think with. Sign in once and every session can use it."
    with Claude, ChatGPT, Gemini, More; SESSION-TAB.md: "No model is signed in for this session" (Choose a model).
27. **First run: today's steps against round 3.** The app has a checklist of setup steps, a consent that can be declined, a
    blocked step, a key form, a hub of every provider, a summary with a ladder, and optional Connectors and Store steps.
    Round 3 draws hello, the three settings, one model question (three sources and "Use another"), Try it, then the app. No
    board says what happens to the ladder summary, the declined and blocked states, or the provider wall.
28. **"you" in the sidebar's foot.** `bots/K02-12` draws "you", Store, Settings in the Bots sidebar. `onboarding/screens/O-B06`
    to `O-B10` draw the same Bots sidebar with Store and Settings only. The Sessions sidebar has no "you" on any board; the
    account menu opens from "you".
29. **O-B09's switches.** `onboarding/screens/O-B09-reach-*.jpg` draws "The island and the notch" switched on. The notch's
    spec, 4.1: "Settings, Notch is off (the default until the owner turns it on)". The same card offers "Your phone …
    Connect a chat app"; whether the app can do that could not be determined (no module was found for it).
30. **An item's mark in the Store.** `docs/UI-COMPONENTS.md`: "Item marks and item rows … (brand colours and publisher tiles:
    the owner, 23 November 2026)". `v7/15-store-*.jpg` draws grey tiles with two letters ("C7", "GH", "LN").
31. **Where a floating notice sits.** The spec's Notice: "floating (bottom centre, was the toast)". The app's toast: "one
    line at the top of the work". No board draws a floating notice on a key screen (`v7/03-light-shadows.jpg` draws one as
    a sample).
32. **Where mods draw.** The app: a band above the composer, a status line under it (the composer rises 22 px), a pane as a
    tab of the details panel, rows in the thread, a notice. In v7 the line under the composer is the composer's own, the
    right panel's tabs are "four fixed tabs", and a held or queued strip sits above the composer. No board shows a mod.
33. **Light-theme contrast.** The lead's notes: "Text contrast in light mode (quiet text under 4.5:1 on some boards)". The
    spec has a contrast section (4.4). Not measured for this map.
34. **The written spec is not on this branch.** `docs/design/v7/boards/README.md`: "The written spec is
    `../DESIGN-SYSTEM.md` and `../SESSION-TAB.md`." `docs/design/v7/` on `w33/repass` holds `REPASS.md` and `boards/` only;
    the spec is on `origin/w31/design-system-v7`, a copy of SESSION-TAB.md is in the archive (`session/SESSION-TAB.md`), and
    `docs/specs/` is on `origin/w32/session-specs`. `docs/specs/*` was not read in full for this map (only as the plans and
    the app's comments quote it).

**Settled by a recorded decision, listed so nobody reopens them:** board 12's own sidebar (no switch, boopis at 64, rows of
36) is replaced by K02; board 16's dock by K04; the session cards S1 to S20 by S17 to S41; the LaunchCard of `S1a`/`S1b`
by the canvas of S17 ("LaunchCard retired", the spec's section 20); marks B, C and D on `S41-new-session-board.jpg` by A.
