# The v7 repass: the app made to match the approved boards

The first v7 build was rejected by the owner: it was built from the written spec, kept v6 parts inside v7 screens, and nobody
compared it with the boards. This file is the rule for the repass and its status. Every builder reads it first and keeps the
table at the end true.

## The reference
- The approved boards: `docs/design/v7/boards/` (sources) and the branch `origin/w33/boards-archive` (every approved image:
  `v7/`, `session/`, `dock/`, `onboarding/`, `bots/`, `notch/`, `final-set/`). Look at the images before writing code.
- A board wins over the written spec. Note every difference for the owner.
- Owner decisions made after the boards still hold, and win where a board differs:
  - the rail's "+N" (25 November: the triangle kept; "+N" a small filled chip to the right, clear of the bots, about half a bot
    tall, smaller on the compact rail);
  - **the Bots sidebar is board K02's** (23 November, `bots/K02-12-room-main44-*.jpg`, source `boards/src-k02`): the Sessions /
    Bots switch with "+" on its row in the open sidebar on both tabs (one sidebar, one Segmented), the boopis bot at 44 first in
    the Bots list, rows of 28 orbs at rest in the fixed pose, "Groups", you / Store / Settings at the foot. Board 12 stays the
    reference for the room (title pill, thread, composer); K02 for a message held over the composer. The rail keeps board 11's
    orbs (36): the rows' 28 against the rail's 36 is an open owner question;
  - **mentions** (25 November): "@" in a bot's or a room's composer opens a menu like the composer's lists (boards S31, S32) of
    whom that chat can name; the pick is set into the text as the capsule a message draws (the kit's InlineChip mention: orb and
    name), one unit for the caret and Backspace, sent as the mention; "@user" likewise where it applies;
  - **attachments are chips** (25 November): a file added with "+" is a reference chip in the composer's text, not "@path" words;
  - **the collapsed rail has no tab button yet** (25 November: "there could be a button there when it's closed, maybe"): options
    are shown to the owner as a sheet; the keys and the palette switch tabs meanwhile;
  - **keys get their own pass** (25 November): ctrl Enter is left as it is (it sends), and S17's hint as drawn;
  - **a started session is boards S20 to S23** (25 November, from the coverage map `COVERAGE.md`): boards 10 and 13 are an earlier
    draft and are replaced wherever they differ (the model's mark in the gutter, a change approved on its tool row, the composer's line
    of S05 B, the checkpoint row). They are not compared;
  - **Stop and voice both stay in the composer** (25 November, evening): while a turn or a room runs, Stop is a button of its own at
    the start of the right cluster, `[stop] [mic] [primary]`: a tinted 28 circle with a filled rounded square. The primary circle never
    becomes Stop. Boards drawn while something runs differ from the app by exactly this button;
  - **the collapsed rail carries the tab switch, upright** (25 November, option B): Sessions over Bots in the switch's own track under
    the sidebar toggle. On the Sessions tab the rail shows no bots ("the Sessions tab shows no bots except the dock"): the switch, and
    at the foot New session, Store and Settings. Boards 11 and 17's rail differs from the app by this control;
  - **"@all" is named in the attention amber** (25 November), in a message and in a composer; a member's mention keeps its colour;
  - **one word for refusing: "Deny"** (with esc), also where S20 draws "Decline" (consistency across the app overrides a board);
  - **the session composer's "+" opens the add menu** (Attach a file, Add a folder to context, Mention a file, Commands); in a bot's
    chat and a room, where only files can be added, "+" opens the file picker;
  - **the voice button is never hidden** (26 November: "there should be an API key option there, so it's not supposed to be hidden, it
    just will not come out functioning from the get go"): every composer's primary circle is as the boards draw it, the voice glyph
    when the composer is empty and the send arrow when there is text. Voice works once the person sets up a voice model: an API key
    for a voice provider (ElevenLabs, Fish Audio) or a local model on their own hardware with live voice. Until then a press starts
    nothing and opens a small Notice at the circle, "Voice needs a voice model", whose one action, "Set up voice", opens Settings at
    Models; the circle's name and tooltip say it needs setting up. The capability is the provider's `voice` (`data/provider.ts`); the
    voice section of Settings, Models (the provider, its key through the host's secret store, the local option) is the Settings
    step's, and live voice itself is not built yet. Dictation (the mic) is another thing and works already;
  - **the lead's dock decisions** (26 November; the owner gave the lead design latitude, and these are the lead's, not the owner's):
    - K02: a hovered bot at 52, and its neighbours at 46, drop the small orbs' 1.25 face scale, as the board's still draws them, and
      take it back at 40;
    - the Well inside an ask in the dock takes the corner the boards draw (10, `kit.css` `.well`), not the corner concentric with its
      Block (14): rule 6. The boards draw every Well at 10 wherever one stands (the dock's asks K03 and K04, a bot's tool block on
      board 11, the terminal of S26); the session's approval boards draw no Well in an ask (S20's change waits on its tool row with
      its diff, boards 11 and 12's approval card has its rule line), so nothing there differs. The kit's Well in a Block elsewhere
      still takes 14, which no board draws: an open question for the kit, not changed here;
    - a card with no messages keeps its ask and its composer at the foot of the card, 12 over the row as K04 draws them; the space
      above stays empty;
    - the row's order stays needs you, then working, then the rest. K05's still (moss resting before kai working) contradicts that
      rule and is not followed;
    - "Always for staging": the standing answer names the scope when the rules engine supplies one with the ask ("Always for
      <scope>", `ApprovalData.scope`), and is "Always allow" otherwise; it stays hidden until rules exist (`approval-rules`). The
      label is a field of the ask; nothing of the engine is built;
  - confirmed (25 November): member name colours stay the kit's contrast-safe derivation; the huddle fold, the "to nina" line and the
    presence tool words stay out; file chips keep the bare file name.

## The rules (the owner's)
1. **It matches.** A screen is done when the app's real screen, on the board's content at 1440 × 900 @2x, is the same as the
   board in dark and light. `pnpm lab:board <board>` proves it (docs/UI-LAB.md); the builder also looks at the sheet.
   No v6 part stays inside a converted screen.
2. **It works.** Every control does its job wherever the app has the capability; nothing that worked in v6 is lost. **A control
   whose feature does not exist yet is not shown** (25 November: a thing shows only when it exists). It is still built, against a
   capability: the provider's `info.later` (`data/types.ts` `LaterFeature`, read by `modules/chat/compose.ts` `later()`), or what
   the engine offers (a form's own choices, the session's capability map). No provider of the app switches a `later` feature on;
   the board's lab fixture does, so `lab:board` still compares the whole board. The hidden controls are listed for the owner. Each
   wired control has a behaviour test. **The one named exception is the voice circle** (owner, 26 November, above): it always
   shows, and says what it needs until a voice model is set up.
3. **It is the kit.** Every look lives in the kit (`src/components/v7`, `kit.*`). Screens (`src/modules/*`) compose and place
   kit components; module CSS holds placement only. A kit component is fixed or extended only where it differs from the boards
   or lacks a drawn variant, never forked. `docs/UI-COMPONENTS.md` lists every component, its variants and its board.
4. **It is a component: all states, not one screenshot** (owner, 25 November: "it'd be unintelligent to go about this as a
   screen mirroring and not actually making the components themselves, like the sidebar, functional"). The board comparison checks
   one drawn state. Every converted component is whole: it works in the app in all its states (a sidebar opens, collapses to the
   rail, resizes, switches tabs, keeps its selection, scrolls, shows empty, long-name and attention states; rows have hover,
   focus, pressed and current; menus open by keyboard and pointer), has kit lab stories for those states (typical, hover, focus,
   long, empty, narrow where they apply) and behaviour tests.
5. **It is readable.** One component, one named section in the kit's CSS and one builder in its TS, named as in the registry
   (`k7-<component>__<part>`, data attributes for state). Tokens, not loose values. When a screen is converted, the v6 code,
   CSS, stories and tests it replaced are deleted. Comments say what a thing is for.
6. **Nothing invented.** Where no board covers something, it is an owner question; the nearest drawn state is kept meanwhile.
7. Where a lab rule flags what a board draws, the board wins: the rule is adjusted, with a line naming the board.

## Health: the app works, and every step proves it
Four conversion steps landed without a full run and the app's own checks were red (26 November: the smoke could not start, 29 lab
stories never drew, the built app's smoke could not type). From now on **every step ends with the local suite below run in the
foreground and CI's non-lab jobs green on its final SHA.** A check of v6 markup that no longer exists is rewritten to check the same
behaviour on the new markup, never deleted or skipped; a check goes only with a behaviour an owner decision removed, and the step's
report says so.

Run it, in `apps/desktop/ui` (docs/UI-LAB.md and apps/desktop/AGENTS.md say what each part covers):

```sh
pnpm typecheck && pnpm test                    # strict types; the unit and behaviour tests (jsdom)
pnpm test:smoke                                # the built app in Chromium, every part (or one: pnpm test:smoke keys)
python3 ../../../tests/e2e/dock_webkit.py --dist dist-e2e   # the dock in a real WebKitGTK (xvfb-run, WebKitWebDriver, Pillow)
pnpm lab:static                                # the kit's source rules; no finding may be in a converted file
pnpm lab:orbs --story <each story you touched> && node tests/lab/gate.mjs lab-report-orbs/summary.json
pnpm lab:board --all                           # every converted board against the approved image's source
(cd ../../../plugins/boopis && uvx ruff check . ../../tests/e2e && uvx ruff format --check . ../../tests/e2e)
gh api repos/aphesist/boopis/actions/workflows/ci.yml/dispatches -f ref=<branch>   # then every job but `lab` green
```

- What runs green (26 November, step 5): typecheck; the unit tests; every smoke part (boot, themes, keys, owner, live, forms, mods,
  controls, mention, store, corners with concentric, dock-empty, dock-motion, dock-presence, lab-probe, axe); the dock in WebKitGTK;
  `lab:orbs` on the kit's and the converted screens' stories; ruff and pyright on the plugin and `tests/e2e`. `lab:static` reports only
  v6 files (`components.css` and the unconverted modules).
- Step 6a (26 November): the same, with `lab:board --all` on 21 boards (S33, S37 and S41 added). One smoke check is the machine's: the
  `corners` budget (200 bound elements, at most 2 ms a frame) measured 2.1 to 2.4 ms here on the step's first commit and on its last,
  so it says nothing of the step; CI's `desktop-smoke` and `ui` are where it is judged. `tests/e2e/dock_webkit.py` held 25 of 25 in six
  runs of nine (two never started: the WebKit driver answered 500; one held 24).
- The lab's report is read by cause, not by story (step 6a, CI run 45736911632 on `2890ee9a`: 1109 blocking findings). A cause is fixed
  where it is a defect of a converted screen or of the kit; where a rule flags what a board draws or the owner decided, the rule is
  adjusted in `tests/lab/probe.js`, `probe-v7.js` or `v7.mjs` with a comment naming the board (rule 7); a cause of a screen still on v6
  is listed in the step's report for the step that converts it.
- CI's jobs: identity, checks, rust, hx, plugin, runtime, installer (both), appimage, e2e, desktop-window (both), desktop-smoke, ui and
  lab-orbs must be green. **`lab` is the exception until step 9**: it takes 75 to 90 minutes and its v6 goldens differ wherever a
  screen is converted. Read its blocking findings by cause: fix what is a defect of a converted screen, leave the golden differences
  of unconverted v6 screens, and list both in the step's report.
- A lab story whose state "never finished drawing" is a bug, in the story or in the app: `lab:orbs` now prints what its setup threw.
- Not in CI, run by hand when their subject changes: `tests/readme-shots.mjs` (the README's images), `pnpm test:parity` (v6 only).

## Status
| Step | Boards | State |
|---|---|---|
| 1 | 11 bot chat, S17 new session | matches; controls wired; the dock's small differences left for the dock step |
| 2 | 17 bot working | matches |
| 3 | 12 group room; K02 the Bots sidebar and a held message | matches (the room 0.02 to 0.04% outside the orbs: a member's name keeps the kit's readable colour where the board's is another; the sidebar and the held message 0.00%); the room is the kit's throughout, its v6 header, presence, huddles and held strip are gone; controls wired and tested; owner questions in the step's report |
| 4 | S20, S23 (10 and 13 replaced; S21, S22, S35–S38 not yet): a started session's conversation and composer | S20 and S23 match but for the owner's decisions ("Deny" with esc, Stop while a turn runs); the thread, the composer and its line are the kit's; controls wired and tested; what v6 did, the hidden controls and the owner questions are in the step's report. Still v6 inside it: the form card for forms with fields, the tasks handed to other models, a council |
| 5 | K01–K08: the dock (board 16's dock is replaced by them) | K01 and K07 match (0.01% outside the live orbs), K02 0.20%, K08 0.11%; K03, K04 and K05 match but for what `boards.json` notes (a question drawn as an approval, the needs-you-first order; "Always for staging" and the Well's corner follow the boards since the lead's decisions of step 6a); K06: no dock and the composer 24 from the foot, with the owner's Stop. S17, S20 and S23's dock region is the orbs' alone (0.3 to 0.8%, was 2.4%). Bots are drawn at the size they show, the dock is on its centre line to the device pixel, a hovered bot comes alive, and "Compact dock when idle" is a setting. Controls wired and tested (`modules/dock/dock.test.ts`, the smoke's dock parts, `tests/e2e/dock_webkit.py`). The v6 `components/composer.ts` and `mentions.ts` were deleted at step 6a |
| 6a | The composer, completed in the kit for every composer (a session, a bot's chat, a room, the dock's card); S33, S37, S41's composer; S05 B's quick menu; the lead's dock decisions | The kit Composer's own editing (`components/v7/compose.ts`): undo and redo across chips and marks, a chip as one unit, paste, a file dragged over it and dropped or pasted, the mic (a press, alt+V, held). A session's answer has the hover actions a bot's message has (the kit's one HoverBar). S33's line 0.00% (the effort and the model changed from the composer's line; the cost in tokens, no price is held yet), S37 0.03% outside the orbs, S41's canvas and composer measured (its sidebar and title are 6b's). Under 900 px the branch and the context fold into the quick menu. The v6 composer and its mentions are deleted. Derived and shown to the owner: the drop state, listening, the effort in the model menu, the fold, a session answer's hover actions. Not verified here: the effort and the model line against a running engine; transcription (the live provider's dictation hears nothing: no host code exists for it); a paste of a file in the desktop web view |
| 6b | S18, S19, S24–S32, S34–S36, S38–S41: the session's panels, menus, commit, inbox, the engine stopped, a gate failed; S41's sidebar and title | |
| 7 | 14, 15: Settings, Store, Connectors | |
| 8 | O-*: onboarding, the one continuous first run | |
| 9 | Lab rules and goldens reconciled with the boards; full CI green | |
