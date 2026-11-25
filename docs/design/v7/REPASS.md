# The v7 repass: the app made to match the approved boards

The first v7 build was rejected by the owner: it was built from the written spec, kept v6 parts inside v7 screens, and nobody
compared it with the boards. This file is the rule for the repass and its status. Every builder reads it first and keeps the
table at the end true.

## The reference
- The approved boards: `docs/design/v7/boards/` (sources) and the branch `origin/w33/boards-archive` (every approved image:
  `v7/`, `session/`, `dock/`, `onboarding/`, `bots/`, `notch/`, `final-set/`). Look at the images before writing code.
- A board wins over the written spec. Note every difference for the owner.
- Owner decisions made after the boards still hold: the rail's "+N" (25 November: the triangle kept; "+N" a small filled chip
  to the right, clear of the bots, about half a bot tall, smaller on the compact rail).

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
4. **It is readable.** One component, one named section in the kit's CSS and one builder in its TS, named as in the registry
   (`k7-<component>__<part>`, data attributes for state). Tokens, not loose values. When a screen is converted, the v6 code,
   CSS, stories and tests it replaced are deleted. Comments say what a thing is for.
5. **Nothing invented.** Where no board covers something, it is an owner question; the nearest drawn state is kept meanwhile.
6. Where a lab rule flags what a board draws, the board wins: the rule is adjusted, with a line naming the board.

## Status
| Step | Boards | State |
|---|---|---|
| 1 | 11 bot chat, S17 new session | matches; controls wired; the dock's small differences left for the dock step |
| 2 | 17 bot working | matches |
| 3 | 12 group room and the Bots sidebar | next |
| 4 | 10, 13, S20–S23, S35–S38: a started session's conversation and composer | |
| 5 | 16, K01–K08: the dock | |
| 6 | S18, S19, S24–S34, S39–S41: the session's panels, menus, commit, inbox, settings | |
| 7 | 14, 15: Settings, Store, Connectors | |
| 8 | O-*: onboarding, the one continuous first run | |
| 9 | Lab rules and goldens reconciled with the boards; full CI green | |
