# UI components: inventory and consolidation

Every repeated UI pattern of the desktop app is one component of the kit, `@boopis/ui`
(`apps/desktop/ui/src/components/`, its README has each component's purpose, variants, props, rules and a snippet).
This file is the inventory behind it: for each pattern, every place it is drawn, how the copies differed, which
differences are intended variants and which were drift, and where it stands. Rule IDs are the design system's
(`design/v6/design-system/DESIGN-SYSTEM.md` 1.1, indexed in `RULES.md`); every rule cited here is approved, including
the 18 that were proposed (approved 19 November 2026, three amended). The live catalogue is the UI lab (`docs/UI-LAB.md`).

Status words: **one** (one kit component, every instance migrated, the per-screen copies and their CSS deleted);
**debt** (instances left, each named below and allowlisted in `kit.guard.test.ts`, which fails on a new copy and on an
allowlisted one that is gone); **other branch** (owned by a parallel branch; nothing redone here).

## The v7 kit (DESIGN-SYSTEM.md v7 section 21, w31/design-system-v7 at 8ec7ede3)

The owner's v7 kit is built beside the v6 one, in `apps/desktop/ui/src/components/v7/`, exported from `@boopis/ui` as `kit`
(`kit.<name>(opts)` an element already wired, `kit.html.<name>(opts)` its markup). It draws on a v7 root (`data-ui="v7"`,
`kit.applyTheme(el, { theme, accent, radii, shadow })`), whose tokens are `styles/tokens.v7.css`, generated from the design's
`tokens.v7.json` by `scripts/build-tokens-v7.mjs`. Every component's root carries `data-kit="<Name>"` (a part `data-kit-part`), which
the lab's v7 checks read. Wave C moves the screens onto it; until then today's screens keep the v6 kit, and the v6 components that
a v7 one replaces stay as they are (the list is under "Left for wave C").

**The boards bind the kit (the repass, 25 November 2026).** Where a kit component and the approved boards' own `kit.css` or `kit.js`
(`docs/design/v7/boards/src/`) differ, the component is corrected to the boards: their CSS is ported, not reinterpreted, and
`pnpm lab:board` measures the result (docs/UI-LAB.md). Corrected so far, with boards 11 and S17: the WindowChrome's controls (the
search hint 36 tall with its key chips, the window glyphs in 32 x 28 cells, the title pill 0 14 0 8 and centred on the work), glyphs
(the stroke scales with the glyph; the sidebar toggles' filled half is never drawn), the Rail (its 24 hairline, its foot of three 32
tinted buttons, a room's three orbs on the boards' circle), the Segmented (items as wide as their words; the chosen one carries the
fill), the Pane (its head, sections and pane cards), the AskCard (the boards' `.qcard`: head, ask, rule line, 28 chips 6 apart, the
outlined Deny with its key), the Composer (the mic a tinted circle; the line under it 12 apart on a 12 inset, plain items, a hint
at each end), the Notice (the boards' `.notice`), the SelectorItem (the boards' `.select`), the Badge (the boards' `.badge2`), the
Button (line-height 1), the logomark (72 box, 44 type size), the StatusLine and TimeSeparator (the thread's own 20 line), the
Block's text rows (4 at the start only), and every orb (eyes cut to its surface's colour; the boopis bot in ink). New from the
boards: `kit.fileCard` (a file a bot wrote), `kit.toolRow({ variant: 'bot' })` (a bot's tool call) and the boards' named sizes in
`scripts/build-tokens-v7.mjs`. Corrected with boards 12 and K02 (the room and the Bots sidebar): the ListRow (a bot's orb 28 and
the amber dot at the row's end in place of a flag on the orb; a new `head` variant, the main bot at 44 over its name; `actionAttrs`
on an item's action), the Bubble (a member's name on the 20 line, 14 under what it follows; a message to you is the amber wash
alone, no edge bar; the gutter's orb at rest, its eyes cut to the ground), the InlineChip (a mention is set in the line as the
boards' `.mention`, a control where it opens the bot, the room's stack for @all, muted for a bot that is not here; the "you"
capsule and the reference pill on the boards' own 18 line; inline code on the line's own height; new `cite`, a source; `words`,
a chip set into a composer's text), the SystemLine (13 on the 20 line, a 16 glyph), the StatusLine (a room's stack on the
phrase's baseline), the Queue (held: the clock, Send now's tip, an Edit that shows with the pointer or the focus), the stacks
(`kitStack`: neighbours a whole two thirds of an orb apart, no room around them), the Pane (a room's stack heads its details) and
the Composer (mentions and files as chips in the text: `kit.mentions({ chips })`, `kit.composerChips`, `kit.composerInsertChip`;
the "@" list under its heading, kept open while you type). New: `kit.sidebarFoot` (you, Store, Settings). Corrected with boards
S20 and S23 (a started session; S05 and S09 for its parts): the ToolRow, a session's (the boards' `.toolrow`: the model's 14 mark, the
tool's glyph, the name in mono, an edit's +/−, what became of it at the head's end; its answers under the head, a decline's feedback
quoted), the AskCard's attached variant (its answers alone; a model's mark 14 in a card's head; "Something else" outlined), the
FilesCard (the boards' `.files-card`: "N changed files" with the turn's +/−, an action at the head's end, a row per file; a long list
folds), the Disclosure (the boards' `.worklog`: the chevron leads and turns down), the TurnFoot, a session's (the boards' `.turnbar`:
"Checkpoint N", its actions as ghost buttons with glyphs, the model with its time and cost at the end), the Bubble's gutter in a session
thread (`.k7-thread[data-kind="session"]`: the boards' `.thread.sess` margins), the title pill (`sub`: a session's branch), the
Composer (the session's line of S05 B: plain items, a model's effort ticks, the context's ticks and the cost at the end, items that fold
in a narrow composer; `kit.composerMarks`, the words a text is read by, as Marks; `kit.composerRunning`). By the owner's decisions of
25 November: the Composer's own Stop at the start of the right cluster while a turn runs (the primary circle never becomes it);
`queueOff` leaves out the send while a turn runs where nothing queues; the voice circle always shows, and `voiceSetup` makes its name and tip say that it needs a voice model (owner, 26 November; pressed, the app opens `kit.openNotice` at it: "Voice needs a voice model", "Set up voice"); the Segmented's `upright`
(the collapsed rail's tab switch, `kit.rail({ tabs })`); "@all" in the attention amber.

**What each component the converted screens use is, and its board** (boards 11, 17 and S17; `pnpm lab:board`):

| Component | Variants and states on these boards | Board source |
|---|---|---|
| `kit.windowChrome`, `kit.titlePill` | a bot's orb, a session's glyph; the search hint; the window glyphs | screens.js `chrome`, `pill` |
| `kit.rail` | tiles, the open one, the flag, a room's cluster and its "+N" (owner, 25 November), the foot | screens.js `rail`, kit.js `cluster` |
| `kit.pane` (details) | the head (64 orb, name, Activity / Library), `k7-pane__sec`, `k7-pane__none` | botscreens.js `pane` |
| `kit.card({ variant: 'pane' })`, its Row | a value, a value with a lead (`valueHTML`), a second line (`k7-row__sub`), a control (Switch), a row that is a control (`action`) | kit.css `.pane-card .sr` |
| `kit.segmented` | items as wide as their words; the chosen one carries the fill | kit.css `.seg` |
| `kit.bubble`, `kit.timeSeparator`, `kit.statusLine` | yours in the bot's fill, the bot's; the time; working (the sweep) and waiting (at rest) | kit.css `.b`, `.sep`, `.activity` |
| `kit.toolRow({ variant: 'bot' })` | closed; open on its Steps (done, now, to do, each with its end words); `icon` for a shell | kit.css `.tool`, `.steps` |
| `kit.fileCard` | a file; `opens` makes it a control | kit.css `.file` |
| `kit.askCard` | approval: head, ask, `rule`, four answers (`inert` for one that cannot be taken yet, `outline` for Deny) | botscreens.js `approval` |
| `kit.composer` | bot, session; its line (plain items, the cost, hints at both ends); `voiceSetup`; events `ui:send`, `ui:steer`, `ui:stop`, `ui:voice {setup}`, `ui:add`, `ui:dictate`; `kit.mentions` (an "@" Menu), `kit.composerInsert` | screens.js `composer`, kit.css `.composer-under` |
| `kit.listRow` | session (the model's mark, title, branch and time, Badge or dot), compact (one line), bot, item; `kit.sectionHead` with a count, folding | kit.css `.sess-row`, `.inbox-h` |
| `kit.selectorItem({ variant: 'launch' })` | a glyph, a model's mark or the five ticks, the value, the chevron; `aria-disabled` for one that cannot be chosen yet | kit.css `.select`, sessionnew.js `launch` |
| `kit.notice` | a limit: glyph, `title` and words, a ghost action, dismiss | kit.css `.notice` |
| `kit.avatar({ variant: 'logomark' })`, `.k7-type-2xl` | the new session's mark and greeting | kit.css `.ns-mark`, `.ns-h` |
| `kit.dock` | the row: orbs, the flag, the ask pill | dockv7.js |
| `kit.listRow` (the Bots list) | `head` (the main bot at 44 over its name), `bot` (a 28 orb at rest, the name, one line; "Needs you: ..." in amber with the amber dot at the end; a room's row led by its members' stack at 24), `item` (an archived bot or room with Restore); hover, focus, pressed, current, long names | K02 screens.js `sidebarOpen`, kit.css `.sb-main`, `.sb-row` |
| `kit.sectionHead` | "Groups"; "Archived" with its count, folding | K02 kit.css `.sb-head` |
| `kit.sidebarFoot` | you (a 32 circle at --current, the name), Store, Settings; hover, focus, the menu open, a long name, without the account (the Sessions side) | botscreens.js `sidebarG` `.foot-ctl` |
| `kit.bubble` in a room | yours in ink with mention chips; a member's with its name in its colour over the first of its run and its 20 orb in the gutter; a message to you (the "you" capsule, the amber wash) | botscreens.js `room12` `said`, kit.css `.gname`, `.gutter` |
| `kit.inlineChip` | `mention` (a bot, the room's stack, a bot that is not here; a control in a message; `words` in a composer), `you`, `code`, `cite` (a source), `reference` (a path that opens; a file in a composer) | kit.css `.mention`, `.you`, `.cite`, `.refchip`, `.b code` |
| `kit.systemLine` | a line the room says; `icon: 'clock'` for a routine made; `action` (Let them continue) | kit.css `.sysline` |
| `kit.statusLine` (a room) | the members' stack at 16 and "kai and moss are replying" | botscreens.js `room12` `.activity` |
| `kit.askCard` in a room | a member's approval in the gutter under what it said | botscreens.js `room12` |
| `kit.queue({ variant: 'held' })` | the clock, "N message(s) wait until the discussion ends", Send now (its tip says what it stops), Edit on hover or focus | K02 kit.css `.queue-held` |
| `kit.composer({ kind: 'room' })` | "Message <room>", its line ("@" N members, the cost), a hint (who answers first); mentions and files as chips; the "@" Menu under its heading | botscreens.js `room12` `comp`, sessiontab2.js `s11` (the composer's lists) |
| `kit.bubble({ brand })` in a session | yours in ink; the agent's in the 30 gutter, the answering model's mark (a 22 circle) at the foot of the bubble; an unknown model: the gutter without the mark | sessiontab.js `shell` `.thread.sess`, kit.js `.gm` |
| `kit.disclosure({ variant: 'worklog' })` | "Read 6 files, searched 2 patterns" while it works, "Worked for 59s: ..." once it ended; closed, open on its steps (done, now, failed, an escalation); hover, focus, no steps, narrow | kit.css `.worklog`, S20, S23 |
| `kit.toolRow` (a session's) | a change or a command waiting on its row with its answers (Deny esc, Always allow this session, Hold to allow once: the ones the engine offers); allowed ("Allowed once 09:43"); denied with the feedback quoted; with steps it opens; hover, focus, narrow | kit.css `.toolrow`, S09, S20 |
| `kit.filesCard` | the count and the turn's +/−, Open diff, a row per file; one file, many (folded, unfolded), empty, long paths, narrow; the action hovered and focused | kit.css `.files-card`, S23 |
| `kit.turnFoot({ kind: 'session' })` | "Checkpoint N", Undo (the rewind; disabled with why where it cannot run), Edit from here and Fork once they exist, the model's 12 mark with its name, time and cost; a route, why it was picked, "ungoverned"; hover, focus, narrow | kit.css `.turnbar`, S23 |
| `kit.askCard` in a session | a question ("asked during the turn", its options, Something else: your own words in a Field); an approval with no fields (the hold, Deny); lapsed (a change whose approval ran out, S09) | sessiontab.js `ask`, S23 |
| `kit.statusLine({ kind: 'session' })` | the model's mark and "Waiting for your approval" at rest; while it works the phrase sweeps and `count` is the turn's clock | sessiontab.js `status`, S20 |
| `kit.composer({ kind: 'session' })` | the line (How careful, the branch, who answers next with the effort's ticks, the context's ticks, the cost); Stop while a turn runs; the words the text is read by as Marks; a model mention as a chip; attachments as chips; narrow: the branch and the context fold | sessiontab.js `comp`, `underSess`; S05 B, S20 |
| `kit.titlePill({ sub })` | a session's glyph, its name, its branch in mono | sessiontab.js `title` |
| `kit.rail({ tabs })`, `kit.segmented({ upright })` | the tab switch stood on its end: Sessions over Bots as glyph items in the track, the open tab filled; on the Sessions tab no bots, "+" is New session; hover, focus, both rail sizes | owner, 25 November (option B); no board |
| `kit.pane({ members })` | a room's details: its stack, its name, pane cards (members; name, members, run limit, board, archive) | no board (it follows botscreens.js `pane`): an owner question |

A module composes these and places them; its CSS holds placement only (`bots.css` "boards 11, 17 and 12", `session.css` "board S17").

| # | Component | `kit.` | Story | Variants built |
|---|---|---|---|---|
| 1 | WindowChrome | `windowChrome` (`titlePill`, `searchHint` inside) | `kit/window-chrome` | rail A, compact B; title idle, running; search hint S5, button S1, pill S2, off |
| 2 | Page | `page`, `section` | `kit/page` | column, settings page with its scope; empty |
| 3 | Pane | `pane` | `kit/pane` | details (bot, session, room), tools (Diff, Files, Terminal, PR, side chat); overlay |
| 4 | Dialog | `dialog` | `kit/dialog` | large (Settings), form (commit, new bot, import, confirm); error |
| 5 | Menu | `menu`, `openMenu` | `kit/menu` | menu, quick, palette / @ $, snooze, split, options; open, flipped |
| 6 | Card | `card` (and its Row) | `kit/card` | settings, pane, danger zone collapsed and open |
| 7 | Block | `block` | `kit/block` | the corner rule's specimen |
| 8 | ToolRow | `toolRow` | `kit/tool-row` | edit, command, read, search; running, done, failed, waiting; a session's (S20): a change waiting with its answers, a command waiting, allowed, denied with feedback; an answer hovered, focused; narrow |
| 9 | AskCard | `askCard` | `kit/ask-card` | standalone, attached, question, choices, lapsed; asked, needs, answered, hold at 50% |
| 10 | FilesCard | `filesCard` | `kit/files-card` | 1 file, 2 files (S23) with Open diff, 12 files folded and unfolded, empty, long, narrow; the action hovered, focused |
| 11 | Queue | `queue` | `kit/queue` | list 1, 3, 9; held (with Edit: at rest, hovered, focused, narrow); editing |
| 12 | Notice | `notice` | `kit/notice` | composer, page, floating; neutral, amber, accent, red; 0 to 2 actions; dismiss |
| 13 | SystemLine | `systemLine` | `kit/system-line` | info, steer, hand-off, error with its action |
| 14 | Bubble | `bubble` | `kit/bubble` | user, agent, a bot's fill, room byline, brand tile, you wash, code |
| 15 | DiffView | `diffView` | `kit/diff-view` | stacked, split; comment, comment focused |
| 16 | Well | `well` | `kit/well` | code in a Block and a bubble, terminal |
| 17 | ListRow | `listRow`, `list` | `kit/list-row` | session, bot, head, item, compact; current, needs you, working; the Bots list (hover, focus, pressed, the main bot open, narrow with long names, no rows, archived items) |
| 18 | SectionHead | `sectionHead` | `kit/section-head` | plain, count, disclosure; collapsed |
| 19 | MenuRow | `menuRow` | `kit/menu-row` | glyph, description, kbd, danger, check |
| 20 | OptionRow | `optionRow` | `kit/option-row` | permission step, import pick; disabled (a step that cannot be honoured: its line says why) |
| 21 | Button | `button` | `kit/button` | secondary, primary, ghost, tint, danger, split; 36, 32, 28; hold |
| 22 | IconButton | `iconButton` | `kit/icon-button` | floating, tinted, ghost, inverted |
| 23 | Segmented | `segmented` | `kit/segmented` | inline 2 to 4, page head, tab bar; upright (the collapsed rail's switch: glyph items, the attention dot, hover, focus) |
| 24 | SelectorItem | `selectorItem` | `kit/selector-item` | line, launch, field; ticks; "+ Choose a model" |
| 25 | Switch | `switch` | `kit/switch` | on, off, disabled |
| 26 | Field | `field` | `kit/field` | text, search pill, multi-line; error, disabled |
| 27 | Kbd | `kbd` | `kit/kbd` | in text, in a pill |
| 28 | Chip | `chip` | `kit/chip` | answer, filter, mode |
| 29 | Tooltip | `tooltip` (the runtime `[data-tip]`, restyled on a v7 root) | `kit/tooltip` | name, name and keys |
| 30 | InlineChip | `inlineChip` | `kit/inline-chip` | mention (a bot, the room, a bot that is not here; hover, focus), you, reference, code, cite, model, countdown; 13, 14, 15; chips of a composer's text |
| 31 | Mark | `mark`, `markReveal` | `kit/mark` | feedforward, blank (waiting, opened, filled, lapsed), info label |
| 32 | StatusWord | `statusWord` | `kit/status-word` | neutral, amber, red, ok; dot, pulse |
| 33 | Badge | `badge` | `kit/badge` | neutral, amber |
| 34 | StatusLine | `statusLine` | `kit/status-line` | bot, session, system; working, waiting |
| 35 | Avatar | `avatar` | `kit/avatar` | orb 16 to 96, brand tile, stack, logomark |
| 36 | Disclosure | `disclosure` | `kit/disclosure` | steps, work log; closed, open; the summary hovered, focused; no steps; narrow |
| 37 | TurnFoot | `turnFoot` | `kit/turn-foot` | bot (model, time, cost); session (S23: the checkpoint, the actions that exist, the model with its time and cost): only Undo, none, Undo disabled, a route with why and "ungoverned", an action hovered and focused, narrow |
| 38 | TimeSeparator | `timeSeparator` | `kit/time-separator` | a gap, NEW |
| 39 | Composer | `composer` | `kit/composer` | session, bot, room, dock, notch; typed, multi-line, running (Stop beside the mic; with text; idle; Stop hovered, focused; narrow), held, no model, quick menu; no voice model yet (the voice circle as ever, its name saying so; what it opens: the Notice with "Set up voice"); nothing queues (no send while a turn runs); a session's line and marks (S20; an item hovered, focused; narrow: it folds; no line); a room's line and hint; chips in the text (and narrow); the "@" list open |
| 40 | Rail | `rail` | `kit/rail` | A, B; current, needs you, working; groups (decided, owner, 25 November 2026: a room's cluster is at most three orbs in their triangle, at 15, or 12 on the compact rail; the members past three are a "+N" chip clear of the orbs on the cluster's right, a filled pill in the line stack's counter colours, half a cluster orb tall, so the compact rail's is smaller) |
| 41 | Dock | `dock` | `kit/dock`; the app's: `v7/dock`; boards `boards/dock` (K01 to K08) | row, compact, open (stack, card); hover, focus, many; in the app: one bot, none (no dock), 120 bots ("N more"), a long name (and hovered), the asks open, a card with an ask, with a thread, of a working bot, with no messages, of a long-named bot, centred in the window, compact when idle, 112% and 125% (and a card open at 125%), the Bots tab (no dock). An orb is drawn at the size it shows and fills its button (`--s`); an AskCard in it takes `plain`, `rest` and an answer at the `end`; the row's end slot is the ask pill or, under a hover, the bot's name and state (at least `--dk-cap-min` wide) |
| 42 | Notch | `notch` | `kit/notch` | the slab and its composer (the notch spec is not in this repository) |
| — | SidebarFoot | `sidebarFoot` | `kit/sidebar-foot` | you, Store, Settings; hover, focus, pressed, the menu open, a long name, no account, narrow |
| — | EmptyState | `emptyState` | `kit/empty-state` | one line, at most one action |
| — | Session S0 patterns | `modules/session/s0.ts` | `kit/session-launch`, `kit/session-rewind`, `kit/session-lines` | the new session's canvas and launch row, the four-row How careful menu, the rewind foot and sheet, the thread's own lines (wave C, `w33/session-s0`) |

**The retired names** (21.3: QueueStrip, LimitNotice, Toast, Banner, ScopePicker, SettingsLine, SteerLine, CheckpointBar, ChoiceCards,
LaunchCard, ReferenceChip) exist nowhere in the v7 kit. **Left for wave C** (v6 code the screens still draw with, reported by the
lab's `kit.single` and not blocking until the screens move): the v6 toast (`components/toast.ts`, `ui.toast`, its CSS and tests, and
every screen that still confirms with it; the v7 Notice's floating placement replaces it, `kit.notify`), the store story's "Banner"
text, and the v6 kit as a whole (`ui.*`), which the v7 kit replaces component by component as each screen moves.

**Moved by w33/shell-bots** (the app is a v7 root: `data-ui="v7"` and `data-theme` on the body and `#hx-app`, in the scheme of the
active theme, `modules/shell/chrome.ts`): the title bar is the kit's WindowChrome (the title pill with the open bot's orb, a room's
stack or a session's glyph; the search hint; details; the window glyphs; back and forward are keys and palette entries only); the open
sidebar's head (Sessions / Bots, the kit's Segmented with the amber attention dot, and New) and foot (you, Store, Settings); the Bots
roster's rows and its rooms' rows (ListRow, SectionHead "Groups", New group a ghost Button); the rail (the kit's Rail in `#hx-rail`,
compact under 1200 px, rest-pose orbs); a bot's and a room's messages (Bubble, with the bot's derived fill in its own chat and a
member's byline and orb in a room, the message to you washed amber, TimeSeparator, the turn's hover actions as ghost IconButtons); a
bot's approval (AskCard, approval variant: Hold to allow once and Deny); the shell's and the Bots tab's confirmations (the floating
Notice, `kit.notify`). Their stories are `src/lab/stories/v7/` (blocking on the v7 rules). **Since the repass's boards 11, 17, 12
and K02** a bot's chat, a room and the Bots sidebar are the kit's throughout: the composers (the kit's Composer; "@" a kit Menu,
mentions and files chips in the text), who is replying (StatusLine), a room's held messages (Queue), its own controls in the
details pane (Pane), the Archived group (SectionHead and ListRow items), a live bot's empty thread (EmptyState; its sessions are
in its details). The v6 room header, presence entry, huddle fold, held strip, ledger lines and glance are deleted. **Since boards S20 and S23** a started session is the
kit's too (`modules/session/conversation.ts`, `turn.ts`, `composer.ts`): the thread, the composer and its line, their menus (the kit's
Menu), the model-change line (SystemLine), find (the kit's search Field). **Still v6 in the Bots tab:** the bot settings sheet, the
new-bot and new-group forms, a room's kanban board view; **in a session:** the form card for forms with fields (`hx-card`: credentials,
sign-ins, plans), the tasks handed to other models (`children.ts`, `ui.child`), a council (`council.ts`), the details panel, find's
popover shell; and outside them the dock's own composer (`ui.composer`, `components/mentions.ts`), the palette, and Settings, Store and
Keyboard.

## The kit as a package

- **Decision: the existing `src/components` promoted, imported as `@boopis/ui`** (a path alias in `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`), not a new `packages/ui` workspace package. The UI is one pnpm project with
  one lockfile, installed offline and frozen in CI; a workspace would add a root `pnpm-workspace.yaml`, a lockfile
  change and a rename under every open branch for the same import name. The folder keeps its paths and history.
- **One entry** (`index.ts`): every component, its typed options and `variants` (`variants.ts`, the UI lab's axes).
- **Pure**: no import from `modules/`, `host/`, `data/`, the app's state, settings or registry. The colour maths the kit
  needed moved out of the theme runtime (which reads settings) into `styles/colour.ts`. Two shared tables that state rules from
  outside the app may be read: `apps/shared/data/model-names.json` and `room-mentions.json` (the engine's mention rule, one copy
  for the host and the kit).
- **Tokens from the one source**: `kit.css` imports `styles/tokens.css` (generated into `tokens.json` by
  `pnpm tokens`), then the library CSS. The app loads `kit.css` first (`styles/index.ts`).
- **Build**: `pnpm kit` writes `dist-kit/boopis-ui.js` (ES module) and `dist-kit/boopis-ui.css` (gitignored).
- **Guard** (`src/components/kit.guard.test.ts`, run by `pnpm test`): the kit imports nothing from the app; nothing
  outside the kit imports `components/...` by path (54 files moved to `@boopis/ui`); no module re-implements a kit
  pattern (17 checks over module TS and CSS and `index.html`, with the allowlist below); every variant list names a
  template; the new templates render from their options alone.

### The v6 mock and the kit: not done, a decision for the owner

The mock (`design/v6/`) cannot load the built kit without changing how the owner designs in it, so it does not:

- it is plain HTML that loads classic scripts in order (`components/components.js` defines `window.HX.ui`, and every
  page script calls `HX.ui.*` synchronously); the kit is an ES module with a different entry (`ui`, `@boopis/ui`);
- the owner edits `design/v6/components/*.js` and `.css` directly and reloads, with no build; loading `dist-kit` would
  make the reference depend on a build of the app and turn edits in the mock into edits that the next build overwrites;
- `design/v6/` is the reference the port is compared against (`pnpm test:parity`); making it render the port would
  compare the port with itself, and `AGENTS.md` forbids editing it.

The alternative, if the owner wants the mock to show the real components: a small `design/v6/kit-bridge.js` that loads
`dist-kit/boopis-ui.js` as a module and assigns `window.HX.ui = ui`, used by a new `index.kit.html` beside the mock's
own `index.html`. That keeps the mock as it is and adds a second page that shows the kit. It needs the owner's word,
because the mock is the owner's.

## Before and after (the owner's named cases)

Screenshots, Chromium at deviceScaleFactor 2 and WebKitGTK 2.52 at GDK_SCALE 2 (Tauri's Linux engine), light (Bone) and
dark (Card catalog), in the scratchpad's `components/` folder: `before-*`, `after-*` and `compare-*`
(`compare-scrollbar-webkit-*`, `compare-scrollbar-chromium-*`, `compare-tabs-*`, `compare-search-titlebar-*`,
`compare-palette-*`, `compare-tooltip-keys-*`).

| Case | Before | After |
|---|---|---|
| Settings' scrollbar | WebKitGTK ignored `scrollbar-width: thin` and drew GTK's wide bar (the owner's screenshot); each scroller declared its own `overflow` and `scrollbar-*` | One scroll area (`.ui-scroll`) drawn with `::-webkit-scrollbar` from `--scroll-*` in every engine (R-scroll-1 to 3), stable gutters (R-scroll-4), the track kept off the dialog's curved foot (R-scroll-5) |
| Settings' tab pills | `.hx-dtab` at `--r-s` (12) beside a close button at `--r-in` (18) in the dialog's 30px corner band; a duplicate of `.mod-tab` | `ui.tabs`: a tab takes the band's `--r-corner` (the dialog card is a `.ui-nest` container at `--pad-dialog`), a capsule on a 28px tab, like the close button, now a `.ui-corner` (R-tab-1, R-corner-5, R-dialog-1, F38). Exact concentricity of a 28px control 12px from a 30px corner needs a 60px head or a 36px close: the owner's call |
| Search field and key chips | the title bar's field and the palette's field hand-built in `index.html` and `shell.css`; key chips at `--r-xs` in the field's 12px corner; chips drawn by four different pieces of code | `ui.search` (sizes s, m, l; R-search-1 to 5), its glyph in a 26px square (R-search-3); every chip from `ui.html.keys`, concentric with the field (`--r-in-field`, R-kbd-2) |

The visible change in the search field is small (chips from 6px to 8px corners, the glyph 4px further left); what
changed most is that it is now the kit's component, one markup for both fields and the shortcut sheet's filter.

## Inventory

### Buttons and icon buttons — one, with debt
- **Kit:** `button` (secondary, primary, ghost; m, s), `iconButton` (s, window), `send`, `hold`.
- **Instances:** every module's actions through `ui.button`/`ui.html.button` (bots settings, room, new bot, dock
  views, cards' feet and rules, right panel, models tab, Hermes source, connectors, diagnostics). Migrated here: the
  theme panel's Copy, Apply, Reset and per-colour Reset (hand-written `<button class="ui-btn">`), the first run's
  buttons (`el('button', {class: 'ui-btn'})`).
- **Drift found:** hand-built buttons with their own reset and states: `.hx-me` (account), `.hx-stub-orb`, `.bt-opt`,
  `.bt-p-sched`, `.bt-sugg`, `.dk-add`, `.dk-run-open`, `.dk-pillbtn`, `.hxt-swatch`, and row-like ones (below).
- **Corner controls** (the corners primitive, `components/corners.ts`, from `w12/corners`): the dialogs' close
  buttons, the mods band's and inline pane's chevrons and close, and a mod toast's dismiss set their radius by hand;
  they are `.ui-corner` now, in containers that carry `.ui-nest` (the dialogs, the palette, the mods band and inline
  pane) or are in the one container rule (the command field, the form cards). Every hand-written `--r-in` formula in
  the shell, mods and cards is gone. **Left:** the dock's `--r-card` (`dock.css`, the dock branch's) and the palette's
  last row (a 30px row cannot be concentric 6px from a 30px corner: the owner's call on row height or inset,
  `docs/UI-LAB-FINDINGS.md`). The toast's action and the terminal's copy were converted on `w12/corners`.
- **Sign-in button** (ADR-0040): `signinButton` (`components/signin-button.ts`, `.css`; the four labs, the themed shell, "A1"), the labs' own logos in `vendor/signin-marks/` (`signinLogo` draws a lab's mark anywhere). Used by first run's hub and by the sign-in rows of Settings > Models and the shared sign-in card.
- **Debt (allowlisted):** the theme panel's "Import file" is a `<label class="ui-btn">` that opens the file chooser;
  the kit has no file button yet.

### Toggles and switches — one
- `switch` everywhere: Settings > General (Show the dock), Appearance (Grow bots on hover), Hermes source, bot settings,
  the dock's card, form cards, connectors. No checkbox anywhere (R-check-1): the form card's several-choice rows were
  a filled square, now the check glyph at rest in `--mark-off`, brass when chosen, with "Choose any" in the label.

### Segmented controls — one
- `segmented` for Session | Bots (pill and rail), Rail | Hide, Auto | Integrated | Dedicated, Governed | Ungoverned,
  Worktree | Sandbox, the theme panel's case, corners and density, the new bot's Colour | Shape tabs.
- **Drift fixed:** the theme panel built the control and then edited its markup with string replacement to add a name
  and a label; the shell swapped `aria-label` for `aria-labelledby` after building it. `segmented` takes `labelledby`
  and `attrs`. R-seg-3 (a control on a dialog's edge band) has no instance today.

### Tab bars — one
- `tabs`: Settings' sections (the dialog head, `--r-in-dialog`) and the details panel's mod panes (scrolling strip,
  `--r-s` on the flat panel head). The two were copies of each other (`.hx-dtab`, `.mod-tab`, identical CSS and two
  keyboard handlers); both deleted. The tabs pill stays `segmented({mode: 'tabs'})`: a different look by rule (R-tab-1).

### Text fields and search fields — one, with debt
- **Kit:** `field` (with label, hint, error), `input` (the bare control for a place with its own label), `select`
  (themed, `w11/ui-controls`), `search` (s: the title bar's command field; m: a search in a form; l: the palette's head).
- **Migrated:** the title bar's command field and the palette's field (from `index.html` and `shell.css`), the shortcut
  sheet's filter (now a search field, R-search-1), the bot settings' cap fields (the mock version wrote its value after
  an empty `value` attribute: fixed), the session rename, the theme panel's hex fields and JSON box.
- **Debt (allowlisted):** `cards/form.ts` renders its own `.ui-input` controls from the schema (one card family);
  the new bot's name field (`.bt-name`, an underlined title field) and the card's free answer (`.cd-free input`) keep
  their own look by design (§13, §14.13).

### Key chips — one
- `keys` (a spec), `kbd` (one literal chip), `combo`/`comboKbds` (the keymap's combinations). Instances: buttons
  (New session), menus, tooltips (`fit`, `raised`), the search fields (`fit`), the palette rows, the shortcut sheet and
  Settings > Keyboard, the go-to hint. Before, the library, `core/keys.ts` (`comboChips`), the go-to hint and the
  tooltip each wrote `<kbd class="ui-kbd">`; `core/keys` now only names keys (`comboLabels`).

### Chips and badges — one
- `chip` and `chipGroup` (toolbar chips, option chips, model chips), `stamp` (owed, red), `dot`, and the new `badge`
  (quiet outlined capsule, mono 11): the "made outside boopis" mark in the roster row and the room header, which the
  bots module drew with its own CSS. States are `ui.html.stateWord`.

### Settings rows and section headers — one, with debt
- `setRow`, and the new `setHead`/`setSection`: every settings heading was a hand-written
  `<h3 class="ui-set__head">` in a `<section class="hx-set">` (a class with no CSS) across the shell, the theme panel,
  the models, plan, Hermes-source and connectors tabs; the theme panel's choice rows were hand-built `.ui-set__row`s.
- **Section headers** share one look, 12/500 quiet in the interface case (R-type-3, R-menu-3): `ui-set__head`
  (settings, 20 above), `ui-group__head` (row groups; also the new bot's "Or start from one of these", the glance
  headings and the palette's groups), `ui-menu__title`, the keymap's group `h3`. Their spacing differs by place, as
  the design system sets it; they stay separate classes. **Debt:** `index.html`'s static Settings > General section
  keeps its hand-written rows (the page's own chrome, before the kit runs).

### Lists and rows — one, with debt
- `row` and `group` for the session list, the bots roster and Archived group, the dock roster. The palette's rows are
  `.ui-row` (Finding F10) built as listbox options.
- **Debt (allowlisted):** the diff file head (`.ss-diff-head`) and the panel's file row (`.ssr-file`) in
  `session.css`; the card layer's mini card, option row and token in `cards.css`; `.bt-routine`, `.bt-glance-row`,
  `.dk-sched-row`, `.ssr-task`. They have their own metrics today; the next step is a row variant for each.
- **Fixed:** Settings > Keyboard laid the keymap's groups in a two-column grid meant for bare `dt`/`dd` and drew each
  row's line twice; it now lists the groups as the shortcut sheet does.

### Item marks and item rows — one each (brand colours and publisher tiles: the owner, 23 November 2026)
- **Why:** the owner, 23 November 2026, on the Store and Settings > Connectors: "we need more visuals. logos, right now
  it's just text. it's hard to actually find stuff in the screen." The design system had no mark for an installable
  thing (R-icon-1 names only model marks, the logo and orbs), so this is the smallest addition in its own terms, made
  for that redesign and awaiting the owner's approval with its screenshots.
- `itemMark` (`components/item-mark.ts`): a raised tile (`--bg-3`, a `--hair` line, a continuous corner through
  `data-sq`), 24px in a row's lead and 40px at the head of an item's page; the floor corner at 24, `--r-s` at 40. It
  holds the mark of the service a connector connects to, or for a skill, plugin or mod the mark of its publisher when the
  source proved the publisher (`tileMarkOf`; `data-mark-of` says which), or a monogram (one or two letters, mono 11/600
  in `--text-dim`). Marks are in their brand colours (the owner, 23 November 2026, ADR-0040 amended for these surfaces):
  `light-dark(--mk-l, --mk-d)` from the map, the brand's `hex` where it holds 3:1 on the preset's tile, else its black or
  white version; `item-mark.test.ts` checks every mark on every preset. A mark comes only from evidence
  (`vendor/service-marks/map.json`: an id in boopis's collection, an address's host, a package or image it runs, a store
  item's home page host, a proven publisher's exact name). Always `aria-hidden`: the name beside it says what it is. The
  files are Simple Icons' (CC0), unchanged (`vendor/service-marks/README.md`).
- `publisher`: a publisher's name with its 14px mark first when the kit carries one and the source proved it (`proven`),
  in its brand colours (R-icon-4), one unit like `model`. Rows say "Skill by Supabase", so a publisher's mark on a tile
  reads as who made the item.
- `itemRow`: the kit's two-line `row` (R-row-4) with the tile as its lead (`.ui-row--item`: the lead is 24 wide instead
  of 16, its left inset stays 12 so it sits outside the row's corner), a quiet line of what the item is, and the end
  slot's state word (`endTone` attention for what the person owes, busy for an update). One tab stop per list, Up and
  Down, Enter opens (`ui:select`). Used by the Store's lists and Settings > Connectors' collection.
- `setRow({ lead })`: a settings row about one item takes its tile before the label (Settings > Connectors' installed
  list, the Store's Installed, the session's Connectors section); the row's gap is `--sp-3` when it has one.
- **Rule this adds (proposed):** the lead column of a row may hold an item's tile, as it holds a bot's orb: it is the
  item's face, not decoration (R-row-3).

### Orbs and member stacks — one each
- `orb` draws every bot, through the one look resolver (`lookOf` in `components/look.ts`): the saved look, else the
  name's. `stack` draws several bots overlapped (a group's members in the sidebar's row, the group room's header and
  who is replying; a card's origin when teammates ask together).
- **Fixed:** the card layer's own `.cd-stack` and the group code's call into it are the kit's `stack` now; the group
  row's stack overflowed its 16px lead over the group's name, and "+N" lay under the last orb.

### Dialogs and sheets — one look, shell-owned
- Settings, the shortcut sheet (`.hx-dialog`), the palette, the bot settings sheet (`.ui-panel` with a concave corner),
  popovers (`ui.popover`). R-dialog-1 to 6 hold. The dialog markup is the page's own (`index.html`); its body is a
  stable scroll area with the track inset at the foot.

### Menus, tooltips and popovers — one
- `menu.open` (account, model picker, composer, room, form pickers, right panel), `popover.open` (the blank), the
  delegated tooltip (`[data-tip]`). The tooltip's content was built twice (`html.tip` and `tooltip.ts`); both use
  `tipBody` now. **Other branch:** overlay placement is `w12/corners`'.

### Toasts — one
- `ui.toast` everywhere; a mod's toasts queue through `modules/mods/toasts.ts` with the kit's surface (R-toast-1 to 3).

### Empty states — one, with debt
- `empty` for the session view, the room, the dock and the failed-module notice. **Debt:** short inline notes have
  their own text styles: the palette's "No matches" (`.hx-pal-empty`, R-search-5), the shortcut filter's
  (`.hx-keys-empty`), the dock log's (`.dk-sess-empty`), the bots tab's empty glance (`.bt-empty`, placed in the
  margin). The design system names only the large empty state (R-empty-1); a "note" variant is the next step.

### Progress — one
- `progressDots`/`setProgress` (the first run, R-data-1), `measure`, `ladder`, `pages`, `capacity`. The cards' diff and
  week dots (`.cd-diffdots`, `.cd-week`) are the card layer's data marks, not progress.

### Scroll containers — one
- `.ui-scroll` with `x`, `both`, `bare`, `inset-end`, `inset-both`, `stable`: the conversation, the Bots room and new
  bot page, the sidebar lists, the palette's list, both dialogs' bodies, the right panel and bot settings, the dock's
  log, a mod's inline body, the mod pane tab strip (bare), diffs (x), the listbox, code wells (kit). Every module's
  `overflow`/`scrollbar-*` declarations are gone (R-scroll-6 to 8). The sidebar rail hides its bar so the orbs keep
  the x = 28 axis.

### Cards — card layer, with debt
- `hx-card` (the cards module) is the one card family (forms included). **Debt:** the bots module's confirm and review
  boxes (`.bt-confirm`, `.bt-review`) draw a native 1px border at `--r-m` rather than a card or well; the suggestion
  tiles (`.bt-sugg`), the theme presets (`.hxt-preset`) and the dock tiles (`.dk-tile`) are their own surfaces.

## Rules this work implements, and where each lives

| Rule | Where (one place) |
|---|---|
| R-scroll-1 to 3 | `components.css`, the scroll-area block, from `--scroll-*` |
| R-scroll-4 | `components.css` `.ui-scroll--stable` (one rule); ends give the gutter back through `--scroll-gutter` |
| R-scroll-5 | `components.css` `.ui-scroll--inset-end`, `--inset-both` |
| R-scroll-7, R-tab-2 | `.ui-tabs--scroll` (bare strip, 28px fade, open tab kept in view) |
| R-tab-1, R-corner-5, R-dialog-1 | `.ui-tab` `border-radius: var(--r-corner, var(--r-s))`; the dialog's close is a `.ui-corner` in a `.ui-nest` card (`--pad-dialog`) |
| R-search-1, 3, 4 | `.ui-search--s/--m/--l` |
| R-kbd-1 to 3 | `kbd.ts`, `.ui-keys--fit`, `.ui-keys--raised` |
| R-state-3 | every hover rule of `components.css` and `mod-view.css` under `(hover: hover) and (pointer: fine)` |
| R-check-1 | `cards/form.ts` several-choice rows, `.cd-opt__check`, "Choose any" |

R-load-2 (the waiting region's quiet line after `--load-delay`) has no instance in the app yet: there is no waiting
region to apply it to. R-seg-3 has no instance (no segmented control sits on a dialog's band).
