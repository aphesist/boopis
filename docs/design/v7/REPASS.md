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
  - **keys get their own pass** (25 November): ctrl Enter is left as it is (it sends), and S17's hint as drawn.

## The rules (the owner's)
1. **It matches.** A screen is done when the app's real screen, on the board's content at 1440 × 900 @2x, is the same as the
   board in dark and light. `pnpm lab:board <board>` proves it (docs/UI-LAB.md); the builder also looks at the sheet.
   No v6 part stays inside a converted screen.
2. **It works.** Every control does its job wherever the app has the capability; nothing that worked in v6 is lost. A control
   is disabled only when the feature does not exist yet, with a tooltip saying why, and it is listed for the owner. Each wired
   control has a behaviour test.
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

## Status
| Step | Boards | State |
|---|---|---|
| 1 | 11 bot chat, S17 new session | matches; controls wired; the dock's small differences left for the dock step |
| 2 | 17 bot working | matches |
| 3 | 12 group room; K02 the Bots sidebar and a held message | matches (the room 0.02 to 0.04% outside the orbs: a member's name keeps the kit's readable colour where the board's is another; the sidebar and the held message 0.00%); the room is the kit's throughout, its v6 header, presence, huddles and held strip are gone; controls wired and tested; owner questions in the step's report |
| 4 | 10, 13, S20–S23, S35–S38: a started session's conversation and composer | |
| 5 | 16, K01–K08: the dock | |
| 6 | S18, S19, S24–S34, S39–S41: the session's panels, menus, commit, inbox, settings | |
| 7 | 14, 15: Settings, Store, Connectors | |
| 8 | O-*: onboarding, the one continuous first run | |
| 9 | Lab rules and goldens reconciled with the boards; full CI green | |
