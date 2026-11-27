# UI components: inventory and consolidation

Every repeated UI pattern of the desktop app is one component of the kit, `@boopis/ui`
(`apps/desktop/ui/src/components/`, its README has each component's purpose, variants, props, rules and a snippet).
This file is the inventory behind it: for each pattern, every place it is drawn, how the copies differed, which
differences are intended variants and which were drift, and where it stands. Rule IDs are the design system's
(`design/v6/design-system/DESIGN-SYSTEM.md` 1.1, indexed in `RULES.md`); every rule cited here is approved, including
the 18 that were proposed (approved 19 November 2026, three amended). The live catalogue is the UI lab (`docs/UI-LAB.md`).
The words in settings and settings-like places (labels, hints, notices, empty states, placeholders) follow the copy rules,
`docs/kit/RULES.md` section 7: a label that stands alone, a hint of one short sentence, nothing about how it works.

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

**The kit's shape (the repass, "kit structure and docs", 27 November 2026).** Every component is a folder,
`components/v7/<name>/` under its public name in kebab-case: `<name>.ts` (the view, typed props to markup, and its `contract`),
`behaviour.ts` (keys, focus and pointer; only where it has any), `<name>.css` (tokens only), `<name>.stories.ts` (the lab's states, id
`kit/<name>`) and `<name>.test.ts` (`story:` and `scene:` cases). A part that only exists inside another (a Card's Row, the chrome's
TitlePill, a Disclosure's Steps) lives in its parent's folder. `index.ts` stays the barrel, so every import of `@boopis/ui` is as it
was; `wire.ts` is the registry of the behaviours (same selectors, same order); `kit-v7.css` imports the folders' CSS in the cascade
order the rules had; `events.ts` is the one event map (`UiEvents`, `emit`, `on`: props down, events up); `contract.test.ts` checks
every contract against the code. The rules, the terms and where state lives: `docs/kit/RULES.md`, `TERMS.md`, `STATE.md`. The kit
taught in one page, in dependency order, with live examples and each folder's files: `pnpm kit:docs` (dist-kit-docs/kit-docs.html,
one self-contained file). A builder adding to the kit (7b, step 8) follows RULES.md section 5.

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
| `kit.composer` | bot, session; its line (plain items, the cost, hints at both ends); `voiceSetup`; `micOff` (a build with no dictation: the mic starts nothing and says so); `hears`; events `ui:send`, `ui:steer`, `ui:stop`, `ui:voice {setup}`, `ui:add`, `ui:dictate {on, mode}`, `ui:dictate-unavailable`, `ui:files {files, via}`; `kit.composerDictation(composer, event)` draws what a dictation reports (see "The mic's dictation" below); `kit.mentions` (an "@" Menu), `kit.composerInsert`, `kit.composerSet`. Its own editing is `components/v7/composer/editing.ts`, the same in every composer: undo and redo across chips and marks, a chip as one unit, paste, a file dragged over it (`data-drop`, `kit.composerDropping`) and dropped or pasted, the mic (a press, alt+V, held; `data-listening`) | screens.js `composer`, kit.css `.composer-under`; the drop and listening states have no board (derived) |
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
| `kit.hoverBar`, `kit.hoverBeside` | a turn's hover actions beside its last bubble: copy, more (a bot's message, board 11); the same on a session's answer (owner), where "more" holds the copy as Markdown; in a room: reply, open the chat | botscreens.js `.hoverbar`, kit.css `.row` |
| `kit.askCard` in a session | a question ("asked during the turn", its options, Something else: your own words in a Field); an approval with no fields (the hold, Deny); lapsed (a change whose approval ran out, S09) | sessiontab.js `ask`, S23 |
| `kit.askCard({ variant: 'form' })` (step 6d, derived) | every form (`modules/cards/form.ts`): the asker at 16 (a bot's orb, the agent's model mark, three orbs and the rail's "+N" chip, a connector's tile, a mod's glyph, the boopis mark, none: "Needs your answer"), the countdown, the StatusWord; the ask, its why, the fields stacked 8 apart, the effect line, the answers (the form's verb or its hold, Later, Cancel or Deny at the end with esc); a question with options is the question (S23's chips) or choices (K02-11's lettered rows) variant; submitting (the primary's words shimmer, the fields and answers inert), a send that failed (the Field's error words); done, later (with Open), expired (with Ask again) and cancelled as the one-row receipt with a quiet word | boards 11 and K04 (the block), S23, K02-11, S17, S29, P1, O-B06, O-P03c, 17; the lead's design (REPASS.md 6d) |
| `kit.statusLine({ kind: 'session' })` | the model's mark and "Waiting for your approval" at rest; while it works the phrase sweeps and `count` is the turn's clock | sessiontab.js `status`, S20 |
| `kit.composer({ kind: 'session' })` | the line (How careful, the branch, who answers next with the effort's ticks, the context's ticks, the cost); Stop while a turn runs; the words the text is read by as Marks; a model mention as a chip; attachments as chips; narrow: the branch and the context fold | sessiontab.js `comp`, `underSess`; S05 B, S20 |
| `kit.titlePill({ sub })` | a session's glyph, its name, its branch in mono | sessiontab.js `title` |
| `kit.rail({ tabs })`, `kit.segmented({ upright })` | the tab switch stood on its end: Sessions over Bots as glyph items in the track, the open tab filled; on the Sessions tab no bots, "+" is New session; hover, focus, both rail sizes | owner, 25 November (option B); no board |
| `kit.pane({ members })` | a room's details: its stack, its name, pane cards (members; name, members, run limit, board, archive) | no board (it follows botscreens.js `pane`): an owner question |

A module composes these and places them; its CSS holds placement only (`bots.css` "boards 11, 17 and 12", `session.css` "board S17").

| # | Component | `kit.` | Story | Variants built |
|---|---|---|---|---|
| 1 | WindowChrome | `windowChrome` (`titlePill`, `searchHint` inside) | `kit/window-chrome` | rail A, compact B; title idle, running; search hint S5, button S1, pill S2, off 6f: the search pill's word is `k7-search-pill__label` 7a: `kit.html.searchHint` exported (Settings › General redraws the chrome's search as a hint, a button, a pill or none) |
| 2 | Page | `page`, `section` | `kit/page` | column, settings page with its scope; empty 7a: the settings page is board 14's `.setbody` (22 28 28 8, the title 24 down, its sections' heads 22 apart: the tokens `--pad-set-page`, `--pad-set-gap`); the scope Segmented takes `attrs`; `k7-page__note`, a quiet line in a settings page |
| 3 | Pane | `pane` | `kit/pane` | details (a bot's: board 11; a room's), session (board S40: the name with its overflow, the folder and the branch; a long name; under a strip of tabs when a mod's pane shares it), tools (Diff, Files, Terminal, PR, side chat; one tool alone with no strip of tabs and its summary where they would stand: S24's Diff until a second tab exists); overlay. A pane card's rows stand 4 inside the card on its concentric corner, a long value is cut and never its label, a row may have a second line (`sub`), `k7-pane__note` is a sentence under a card. In the app: `shell/details-panel` (the session's details and its diff), `bots/group-details`, board 11's pane |
| 4 | Dialog | `dialog` | `kit/dialog` | large (Settings), form (commit, new bot, import, confirm); error. An action can be `disabled` with a `tip` (6e: Rewind where it cannot run; `aria-disabled`, so its Tooltip still shows) 7a: large: the nav 12 down and 8 in (board 14's `.setnav`), each row's `value` (`data-page`) and `attrs`, `pageAttrs`, the close a ghost (`.d-close`), the page fading over its last 28; a narrow window (under 720) stacks the nav over the page as its glyphs (derived); the nav's glyphs plug, palette and keyboard added from the boards' kit.js 7b: wide (board 15: the Store and the shortcut sheet; 900 by 640, no nav, its title and `headEnd` in a head of 52, a body that scrolls 18 in) |
| 5 | Menu | `menu`, `openMenu` | `kit/menu` | menu, quick, palette / @ $, snooze, split, options (board S19's two-line rows: the name, what it means on a second line that is never cut; a row may lead its name with a mark or a glyph and end it with its keys: a session's "who answers next" and the new session's model menu), list (rows with a description beside the name, 360: boards S31, S32); open, flipped. An open Menu gives a row whose description is cut its whole words as a tooltip. `foot` (6e, derived): what follows the rows (a council's combiner and "Ask the council") 6f: with a `foot` the rows are the menu (`role="menu"` on the list) and the whole a group; the foot is a line, not a surface, and its button is concentric with the menu's corner and keeps still under press (axe: a menu holds only its items) |
| 6 | Card | `card` (and its Row) | `kit/card` | settings, pane, danger zone collapsed and open 7a: a settings card's second line is board 14's hint (13 on 18) and the label then wraps; Row `check` (the whole row a checkbox, the accent check at its end: 14's Under the composer), `leadHTML` (a control before the label: O-B07's rule Switch), `subHTML` (inline code in the host's words), `wrap` (the owner's words wrap); a settings row wraps its controls under its label in a narrow card; a check row's fill is 8 in, concentric |
| 7 | Block | `block` | `kit/block` | the corner rule's specimen; `offer` (S37: what is missing, said kindly, over the ways to get it, each a Button led by a provider's mark); narrow |
| 8 | ToolRow | `toolRow` | `kit/tool-row` | edit, command, read, search; running, done, failed, waiting; a session's (S20): a change waiting with its answers, a command waiting, allowed, denied with feedback; an answer hovered, focused; narrow. 6e, derived: `row` (a row of a Block: a council's member, no frame of its own), `icon: ''` (no glyph: the model's mark alone), `wordTone`, `wordTip` (why, in the word's Tooltip, reached by the keyboard), `end` (a control at the head's end: a task's ghost Stop), `after` (what stands under the head: a task's transcript Disclosure); stories `composer/council`, `composer/children`. 6f (the lead): `text` (a name that is words, not a command or a path: a model's name, a council's members and its head, a task handed to another model, in the row's regular face; a tool's name stays mono as S20, S23 and 17 draw it), story state "a model's name, in words" |
| 9 | AskCard | `askCard` | `kit/ask-card`; forms: `cards/form-*`, `cards/form-questions`, `cards/form-askers` | standalone, attached, question, choices, lapsed, form (6d, derived: fields, effect, error, busy, a row's action, the asker drawn by the app, the head's word and countdown); asked, needs, answered, hold at 50%. An answer can be `ghost` (6e: Edit on a permission) 6f: an answered row's action (Open, Ask again) gives the row its height, 8 round it, concentric with the block; a long item name breaks; the asker's "+N" a step up (--bg-4) |
| 10 | FilesCard | `filesCard` | `kit/files-card` | 1 file, 2 files (S23) with Open diff, 12 files folded and unfolded, empty, long, narrow; the action hovered, focused; `check` (board S38): how a check on the change went: its glyph and name, the verdict as a StatusWord, the one action, what it printed in a Well in the verdict's colour, the files, a note. 6e: a row's `word` (what happens to the file, in words: the rewind's dry run), the head's own `title` ("3 files"), `check.live` (the verdict shimmers while the check runs again: a failed turn retrying) 6f: a check's long name gives way with an ellipsis before its word and action |
| 11 | Queue | `queue` | `kit/queue` | list 1, 3, 9; held (with Edit: at rest, hovered, focused, narrow); editing |
| 12 | Notice | `notice` | `kit/notice` | composer, page, floating; neutral, amber, accent, red; 0 to 2 actions; dismiss |
| 13 | SystemLine | `systemLine` | `kit/system-line` | info (with `meta`: what a changed setting costs, in mono at its end, S33), steer, hand-off, error (the glyph and the words in red, S36) with its action (the tint Button, `.sysline.act .btn`). A stopped engine's line is `modules/chat/engine.ts` in a session, a bot's chat and a room. `word` (6e, derived): a StatusWord before the words (an escalation the cap stopped: "capped" in amber, `cards/escalation`). 6f: the hand-off's `to` takes several bots, drawn as the kit's stack at 16 (derived: a room's lead gives a message to more than one member); a room draws the engine's `room.assignment` as this line (`modules/bots/group-room.ts` `handoffLine`, story `bots/group` "the lead hands the message on", state "a hand-off to two members") |
| 14 | Bubble | `bubble` | `kit/bubble` | user, agent, a bot's fill, room byline, brand tile, you wash, code |
| 15 | DiffView | `diffView` | `kit/diff-view` | stacked, split; comment, comment focused; its body a named group in a form (6d: no landmark); a file of the tools' Diff that folds by its head (board S24: the chevron, the path, its counts), open and closed, its head hovered and focused 6f: held by a Well, the Well draws the frame and the diff takes its corner |
| 16 | Well | `well` | `kit/well` | code in a Block and a bubble, terminal; `thread` (6e, derived): a compact thread as markup, at most `--well-thread-h` then it scrolls (a handed-off task's transcript, a council's answers) |
| 17 | ListRow | `listRow`, `list` | `kit/list-row` | session, bot, head, item, compact; current, needs you, working; the Bots list (hover, focus, pressed, the main bot open, narrow with long names, no rows, archived items) 7b: an item (board 15) is its name on the 20 line over its 13 line, its 40 tile at --r-tile; the Store's, Settings › Connectors' and the item page's head |
| 18 | SectionHead | `sectionHead` | `kit/section-head` | plain, count, disclosure; collapsed |
| 19 | MenuRow | `menuRow` | `kit/menu-row` | glyph, description, kbd, danger, check |
| 20 | OptionRow | `optionRow` | `kit/option-row` | permission step, import pick; disabled (a step that cannot be honoured: its line says why); check (6d, derived: one of several that can all be chosen, a form's "choose any") |
| 21 | Button | `button` | `kit/button` | secondary, primary, ghost, tint, danger, split; 36, 32, 28; hold 7b: `iconEnd`, a glyph after the words (board 15's "3 installed" and its chevron) |
| 22 | IconButton | `iconButton` | `kit/icon-button` | floating, tinted, ghost, inverted |
| 23 | Segmented | `segmented` | `kit/segmented` | inline 2 to 4, page head, tab bar; upright (the collapsed rail's switch: glyph items, the attention dot, hover, focus) |
| 24 | SelectorItem | `selectorItem` | `kit/selector-item` | line, launch, field; ticks; "+ Choose a model" 7a: `swatch` (board 14's Accent: a 12 circle before the value) |
| 25 | Switch | `switch` | `kit/switch` | on, off, disabled |
| 26 | Field | `field` | `kit/field` | text, search pill, multi-line; error, disabled; secret with Show and Hide, a hint line, an email or address input, round another control (OptionRows, Segmented, SelectorItem, Switch on its line, Swatches): 6d, derived for forms 6f: the box's radius is `--field-r` (the AskCard sets it); a secret's Show is concentric with it; the input never draws a second ring 7b: a search pill's glyph 6 in (board 15's `.input.search`), the root's tracking in the input, no platform clear button |
| — | Swatches | `swatches` | `kit/swatches` | 6d, derived from P1: colours as 28 circles; shown, or one to choose (a radio group, the chosen ringed); none chosen, long, focus 7a: `kit.html.swatchDot`, one colour as a 12 circle beside its name (a select's value, a menu row) |
| — | TeamPlan | `teamPlan` | `kit/team-plan`; in an AskCard: `bots/held` | 6e, derived from O-B06's team-plan block: a row per action led by its mark (+ added in the add colour, ~ changed, − removed in red), what it is about and what changes, a lead (a bot's 16 orb); problems as error lines (alerts), notes quiet, a permanent action's quiet note; empty, long. For a bot's proposed team change (`modules/bots/held.ts`) and step 8's O-B06 |
| — | FindBar | `findBar` | `kit/find-bar` | 6e, derived: find in a conversation: the search Field in a floating pill (the Menu's surface), "3 of 12" or "No matches" (quiet), previous (chevron-up, new) and next, esc; in a thread the matches are the CSS highlights `k7-find` (`--find-hit`) and `k7-find-now` (`--find-hit-now`), tokens added in `scripts/build-tokens-v7.mjs` |
| — | CommandPalette | `commandPalette`, `commandPaletteList` | `kit/command-palette`; the app's: `shell/palette` | 7b, derived (no board: S31's rows, P2's search): mod+K over sessions, bots and commands; the search Field over one listbox under group heads, the row the keys are on (Up, Down, Tab), Enter or a press chooses it (`ui:select`); a typed word marked, nothing matching in one line, many rows, long words |
| — | SetupPage | `setupPage` | `kit/setup-page`; the app's: `v7/first-run` | step 8, boards O-P01 to O-P04: the first run's whole window before the app: the logomark 44 over the heading or 96 in the scene, one heading at 196 and its lede, what the step shows (a card 520 wide, or a scene), the actions stacked at 640 (288 wide, wider for long words) or a status line in their place, a quiet way out at the foot's start, the window's glyphs; a short window stacks it all |
| — | Tiles | `tiles` | `kit/tiles`; the app's: `v7/first-run-app` | step 8, boards O-B02, O-B03: a Block of three columns (fewer when narrow): goals to pick up to three (a glyph in a 28 circle, the bot it gets once chosen, the bot's colour as its line and a tenth of its ground; `ui:change`, the count live), or bots each over a chip of its job; the foot's chip and a quiet line |
| — | MarkStack | inside `turnFoot` (`marks`) | `composer/council` "done" | 6e, derived from 6d's askers: model marks overlapped a third, three, then the rail's "+N" chip 6f: with no name of its own it is hidden from readers (the words beside it say it: "council of 3") |
| 27 | Kbd | `kbd` | `kit/kbd` | in text, in a pill 7a: `kit.html.kbdSpec`, a binding as the keymap writes it (alternatives with "or", a sequence with "then", a hold), read only on Settings › Keyboard |
| 28 | Chip | `chip` | `kit/chip` | answer, filter, mode |
| 29 | Tooltip | `tooltip` (the runtime `[data-tip]`, restyled on a v7 root) | `kit/tooltip` | name, name and keys |
| 30 | InlineChip | `inlineChip` | `kit/inline-chip` | mention (a bot, the room, a bot that is not here; hover, focus), you, reference, code, cite, model, countdown; 13, 14, 15; chips of a composer's text 6f: a reference never leaves its line (clipped with an ellipsis, `overflow: clip` so its baseline holds); a mention's orb and name never part in a composer; @all's stack is its orbs' height |
| 31 | Mark | `mark`, `markReveal` | `kit/mark` | feedforward, blank (waiting, opened, filled, lapsed), info label |
| 32 | StatusWord | `statusWord` | `kit/status-word` | neutral, amber, red, ok; dot, pulse |
| 33 | Badge | `badge` | `kit/badge` | neutral, amber |
| 34 | StatusLine | `statusLine` | `kit/status-line` | bot, session, system; working, waiting 7b: system in a page is 13 on 18 (board 15's "Reading sources 0 of 1") |
| 35 | Avatar | `avatar` | `kit/avatar` | orb 16 to 96, brand tile, stack, logomark |
| 36 | Disclosure | `disclosure`, `steps` (its Steps alone: a form's plan, 6d) | `kit/disclosure` | steps, work log; the Steps alone, not started; closed, open; the summary hovered, focused; no steps; narrow; the work log open as S10 draws it (rows under its words, each led by its kind's glyph: a step's `log` state; a step that failed keeps its words and says "failed" as a red StatusWord before its time: `word`); what follows the steps (`after`): a work log's output in the terminal Well, a list of parts with a Button (the context's parts and "Compact conversation") |
| 37 | TurnFoot | `turnFoot` | `kit/turn-foot` | bot (model, time, cost); session (S23: the checkpoint, the actions that exist, the model with its time and cost): only Undo, none, Undo disabled, a route with why and "ungoverned", an action hovered and focused, narrow. 6e: `marks` (several models' marks stacked, three then "+N": a council's reply); an action that cannot be taken is `aria-disabled`, so its tip shows on hover and focus |
| 38 | TimeSeparator | `timeSeparator` | `kit/time-separator` | a gap, NEW |
| 39 | Composer | `composer` | `kit/composer` | session, bot, room, dock, notch; typed, multi-line, running (Stop beside the mic; with text; idle; Stop hovered, focused; narrow), held, no model, quick menu; no voice model yet (the voice circle as ever, its name saying so; what it opens: the Notice with "Set up voice"); nothing queues (no send while a turn runs); a session's line and marks (S20; an item hovered, focused; narrow: it folds; no line); a room's line and hint; chips in the text (and narrow); the "@" list open |
| 40 | Rail | `rail` | `kit/rail` | A, B; current, needs you, working; groups (decided, owner, 25 November 2026: a room's cluster is at most three orbs in their triangle, at 15, or 12 on the compact rail; the members past three are a "+N" chip clear of the orbs on the cluster's right, a filled pill in the line stack's counter colours, half a cluster orb tall, so the compact rail's is smaller) |
| 41 | Dock | `dock` | `kit/dock`; the app's: `v7/dock`; boards `boards/dock` (K01 to K08) | row, compact, open (stack, card); hover, focus, many; in the app: one bot, none (no dock), 120 bots ("N more"), a long name (and hovered), the asks open, a card with an ask, with a thread, of a working bot, with no messages, of a long-named bot, centred in the window, compact when idle, 112% and 125% (and a card open at 125%), the Bots tab (no dock). An orb is drawn at the size it shows and fills its button (`--s`); an AskCard in it takes `plain`, `rest` and an answer at the `end`; the row's end slot is the ask pill or, under a hover, the bot's name and state (at least `--dk-cap-min` wide) |
| 42 | Notch | `notch` | `kit/notch` | the slab and its composer (the notch spec is not in this repository) |
| — | SidebarFoot | `sidebarFoot` | `kit/sidebar-foot` | you, Store, Settings; hover, focus, pressed, the menu open, a long name, no account, narrow |
| — | EmptyState | `emptyState` | `kit/empty-state` | one line, at most one action; `place: 'list'` in a list (board S41's "No sessions yet": the line starts where the rows' words start) |
| — | HoverBar | `hoverBar`, `hoverBeside` | `kit/hover-bar` | what a turn offers under the pointer or the focus (board 11's `.hoverbar`): copy, more; a room adds reply and open the chat; beside a bubble, and in the gutter (a room's member, a session's answer); an action hovered, focused, pressed; at rest (hidden); long; the more menu open. One part for a bot's chat, a room and a session (`modules/bots/turn.ts`, `modules/session/conversation.ts`) |
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
new-bot and new-group forms, a room's kanban board view; **in a session:** nothing since step 6f (the council, the tasks handed to other models and find at 6e; the card kinds approval, blank and
connector at 6f); and outside them the palette, the Store and the shortcut sheet (Settings is the kit's since step 7a:
`modules/settings`, the kit's large Dialog over S39's nav and board 14's pages; its Models and Connectors tabs, `host/models-tab.ts`,
`plan-view.ts`, `providers-view.ts`, `connectors.ts` and `modules/settings/local-api.ts`, draw the kit's Cards; v6's theme customizer
is deleted). The v6 composer and its mentions (`components/composer.ts`,
`mentions.ts`, `.ui-composer`, `.ui-ff`, the story `composer/composer`) were deleted at step 6a: every composer is `kit.composer`.
**Since board S40** (step 6c) the session's right panel is the kit's Pane (`modules/session/details.ts`): its details as S40 draws them,
with what the lead kept in them until Settings holds it (the context's parts and Compact in a Disclosure, the cap, Environment and
Connectors as pane cards), and the diff a FilesCard opens (S24's Diff alone: DiffViews that fold). The agent's tasks are the kit's
card of steps on the session's last turn (the ToolRow's `bot` variant, board 17's card), and what its commands printed is a terminal
Well at the end of the open work line. The v6 panel (`right.ts`, `diff.ts`, `.ssr-*`, `.ss-diff*`, the collapsed context strip) is deleted;
a mod's pane is a tab of the kit's Pane (`surface.panelTabs`), its own content still the mods module's.

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
  the dock's card, form cards, connectors. No platform checkbox anywhere (R-check-1): a form's several-choice rows are the
  kit's OptionRows with the check variant (6d), with "choose any" in the field's label.

### Segmented controls — one
- `segmented` for Session | Bots (pill and rail), Rail | Hide, Auto | Integrated | Dedicated, Governed | Ungoverned,
  Worktree | Sandbox, the theme panel's case, corners and density, the new bot's Colour | Shape tabs.
- **Drift fixed:** the theme panel built the control and then edited its markup with string replacement to add a name
  and a label; the shell swapped `aria-label` for `aria-labelledby` after building it. `segmented` takes `labelledby`
  and `attrs`. R-seg-3 (a control on a dialog's edge band) has no instance today.

### Tab bars — one
- `tabs`: Settings' sections (the dialog head, `--r-in-dialog`). A mod's pane in the session's details is a tab of the kit's Pane
  (its `strip`, the kit's Segmented tabs) since step 6c. The two v6 tab bars were copies of each other (`.hx-dtab`, `.mod-tab`, identical CSS and two
  keyboard handlers); both deleted. The tabs pill stays `segmented({mode: 'tabs'})`: a different look by rule (R-tab-1).

### Text fields and search fields — one, with debt
- **Kit:** `field` (with label, hint, error), `input` (the bare control for a place with its own label), `select`
  (themed, `w11/ui-controls`), `search` (s: the title bar's command field; m: a search in a form; l: the palette's head).
- **Migrated:** the title bar's command field and the palette's field (from `index.html` and `shell.css`), the shortcut
  sheet's filter (now a search field, R-search-1), the bot settings' cap fields (the mock version wrote its value after
  an empty `value` attribute: fixed), the session rename, the theme panel's hex fields and JSON box.
- Forms draw the kit's Field (6d): no `.ui-input` is left in `cards/form.ts`. **Debt (allowlisted):** the new bot's name field (`.bt-name`, an underlined title field) and the card's free answer (`.cd-free input`) keep
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
  the design system sets it; they stay separate classes. Since step 7a Settings is the v7 kit's (`modules/settings`: the kit's
  Page, `kit.section`, settings Cards of Rows); `index.html` holds only the empty `<dialog>`. The v6 `setRow`/`setHead` remain for
  the pages still on v6 (first run, the store).

### Lists and rows — one, with debt
- `row` and `group` for the session list, the bots roster and Archived group, the dock roster. The palette's rows are
  `.ui-row` (Finding F10) built as listbox options.
- **Debt (allowlisted):** the card layer's mini card, option row and token in `cards.css`; `.bt-routine`, `.bt-glance-row`,
  `.dk-sched-row`. (The session panel's diff head, file row and task row went with the v6 panel at step 6c.) They have their own metrics today; the next step is a row variant for each.
- **Fixed:** Settings > Keyboard laid the keymap's groups in a two-column grid meant for bare `dt`/`dd` and drew each
  row's line twice; it now lists the groups as the shortcut sheet does.

### Item marks — one each (brand colours and publisher tiles: the owner, 23 November 2026; logos over letters: the owner, 27 November 2026)
- `components/item-mark.ts`: what an installable thing is, from evidence (`vendor/service-marks/map.json`: a host or package it runs
  that names a listed service, else an id in boopis's collection or the connector's own name as one key (`connectorKey`), a home
  page's host, a proven publisher's exact name), in its brand's colours for the scheme (`light-dark(--mk-l, --mk-d)`: the brand's
  colour where it holds 3:1 on every tile of the scheme, else its hue with the lightness moved, a one-colour brand the theme's ink;
  `item-mark.test.ts`). `itemTile(ref)` is the one rule every row of an installable thing draws (the Store, Settings › Connectors
  installed and from the collection, the pane's connector rows, the first run's offer): a mod's glyph, else `brandMarkHTML(ref)` (the
  kit's ListRow item tile, 40 at `--r-tile`, the mark 55% of it; a 16 mark before the name in the kit's Card row), else board 15's
  letters (`core/letters.ts`). Board 15's letters lose to the owner's decision (COVERAGE conflict 30).
- Deleted at step 9: the v6 tile and publisher line (`ui.itemMark`, `ui.publisher`: no app user).
- Deleted at step 8: the v6 `itemRow` (no app user since 7b) and the v6 search field (`ui.search`: the palette is the kit's
  CommandPalette).

### Orbs and member stacks — one each
- `orb` draws every bot, through the one look resolver (`lookOf` in `components/look.ts`): the saved look, else the
  name's. `stack` draws several bots overlapped (a group's members in the sidebar's row, the group room's header and
  who is replying; a card's origin when teammates ask together).
- **Fixed:** the card layer's own `.cd-stack` and the group code's call into it are the kit's `stack` now; the group
  row's stack overflowed its 16px lead over the group's name, and "+N" lay under the last orb.

### Dialogs and sheets — one look, shell-owned
- Settings (the kit's large Dialog), the Store and the shortcut sheet (the kit's wide Dialog, board 15) live in the shell's `<dialog>`s
  (`index.html`, drawn by `modules/settings` and `modules/shell/dialogs.ts`); the palette is the kit's CommandPalette in the shell's
  scrim; the bot settings sheet (`.ui-panel` with a concave corner) and popovers (`ui.popover`) are still v6. R-dialog-1 to 6 hold.

### The mic's dictation

The mic is transcription (owner, 26 November): it writes what you say into the composer's text. A dictation source reports its
states as events, and the kit's Composer draws each with what it already has (the placeholder line, the text, a Notice at the mic).
The shape, in `data/provider.ts` (the kit's `DictationState` in `components/v7/composer/editing.ts` is the same):

```ts
export type DictationEvent =
  | { kind: 'preparing'; done: number; total: number }   // the speech model is being fetched, once: bytes done of the total
  | { kind: 'listening' }                                // the microphone is open and it hears
  | { kind: 'partial'; text: string }                    // the words so far of what is being said; each replaces the last partial
  | { kind: 'final'; text: string }                      // a finished stretch: it stays in the text; more may follow
  | { kind: 'error'; reason: string; retry?: boolean };  // one plain sentence; `retry: false` when trying again cannot help
export interface DictationSource {
  start(opts: { botId: string | null }, onEvent: (e: DictationEvent) => void): () => void;   // the returned function stops listening; one last `final` may follow
}
```

| Event | What the composer shows |
|---|---|
| `preparing` | `data-dictation="preparing"`; the placeholder reads "Getting the speech model 12 of 57 MB" (megabytes from the bytes) |
| `listening` | `data-dictation="listening"`; the placeholder says who listens ("nina is listening", "Listening") |
| `partial` | `data-dictation="transcribing"`; the words stand in the text where the caret is (at its end when the caret is elsewhere), after a space where the words before have none; the next partial replaces them |
| `final` | the words stay, the composer's own input handling follows (marks, chips, the send arrow), and it listens again |
| `error` | the mic switches off (`ui:dictate {on: false}`, so the app cancels the source), and a Notice at the mic says `reason` with "Try again" (it switches the mic on again), or with no action when `retry` is `false` |

The app starts a source on `ui:dictate {on: true}` and hands its events on (`modules/chat/compose.ts` `dictate`). The function a source
returns means "stop listening", not "throw it away": when the mic goes off the microphone closes at once, and what was still being
said may arrive as one last `final` (or an `error`, or nothing). The composer takes that `final` although its mic is off and waits up
to 3 s for it (`LAST_WORDS` in `components/v7/composer/editing.ts`), then lets go; any other event that arrives while the mic is off is dropped.
The live source is the host's (`host/dictation.ts`: local whisper.cpp, the model fetched on first use, ADR-0059). A provider with no `dictation` draws the mic with `micOff`: a press says "Dictation is not available
in this build" (`micTool`). Stories: `kit/composer` "dictation: getting the speech model", "the words arriving", "it failed", "not in
this build", and "listening".

### Menus, tooltips and popovers — one
- `menu.open` (account, model picker, composer, room, form pickers, right panel), `popover.open`, the
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
- `progressDots`/`setProgress` (the first run, R-data-1), `measure`, `ladder`, `pages`, `capacity`.

### Scroll containers — one
- `.ui-scroll` with `x`, `both`, `bare`, `inset-end`, `inset-both`, `stable`: the conversation, the Bots room and new
  bot page, the sidebar lists, the palette's list, both dialogs' bodies, the right panel and bot settings, the dock's
  log, a mod's inline body, the mod pane tab strip (bare), diffs (x), the listbox, code wells (kit). Every module's
  `overflow`/`scrollbar-*` declarations are gone (R-scroll-6 to 8). The sidebar rail hides its bar so the orbs keep
  the x = 28 axis.

### Cards — card layer, with debt
- `hx-card` (the cards module) hosts one kind, the form: a bare host round the kit's AskCard block (6d). The v6 kinds are gone: ship,
  teammate, escalation, error and schedule at 6e, approval, blank and connector at 6f (with the queue, the blank's popover and option
  group, the name fitting and `ui.blank`); what `modules/cards/` keeps is the host (`card.ts`), the form (`form.ts`, `form-model.ts`,
  `forms-host.ts`), the thread's own lines (`asks.ts`) and what they read (`parts.ts`, with the config diff's well a bot's settings show). **Debt:** the bots module's confirm and review
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
| R-check-1 | a form's several-choice OptionRows (`check`), "choose any" |

R-load-2 (the waiting region's quiet line after `--load-delay`) has no instance in the app yet: there is no waiting
region to apply it to. R-seg-3 has no instance (no segmented control sits on a dialog's band).
