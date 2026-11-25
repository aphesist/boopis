# Orchestrator's memory: the v7 rebuild of boopis

This file is the lead's notebook (the owner: "keep updating that file every time something happens"; the owner does
not need to be sent it). The lead reads it at the start of every working turn and after every context summary, and
writes in it every time something happens: a decision, a report, a finding, a change of plan. Builders read `docs/design/v7/REPASS.md` on `w33/repass` (their rules);
this file holds the wider picture: the goal, what went wrong, the plan, the guards and the current state.

Last updated: 25 November 2026.

## 1. The goal (the owner's words)

"The fully functional boopis app, fully refactored, with our new UI-kit design system fully applied on all the
screens, and all the features we were planning to add onto the 0.2.0 and 0.3.0 release."

"It needs to use the boards as a full base, but the boards didn't draw every single screen possible, or every state
that exists in the system."

## 2. What happened (so it is not repeated)

| When | Event |
|---|---|
| 23 Nov | The owner approved the v7 design in this session: about 330 boards (v7 system, Bots, Session tab, dock, onboarding, the bots' look, the notch), and many decisions in words. 0.1.10 released. PLAN-0.2.0 agreed. |
| 23–25 Nov | Wave A (base merge) and wave B (lab checks, the v7 kit, orb3) built. Wave C started: five builders, one per surface. |
| 25 Nov | The owner rejected the wave C build: it looked nothing like the boards. About 8 hours and, by the owner's count, 25% of a weekly limit were wasted. |
| 25 Nov | Repass started: boards archived in the repo, `pnpm lab:board` built, boards 11, 17 and S17 matched and wired. The owner: "much better, should've been looking like this since the start." |

**Why it failed (the lead's mistakes):**
1. The boards and their source were only in the scratch folder. Briefs pointed builders at the written spec.
2. The lead accepted screens that still held v6 parts (composer, session screens, dock) and sent a build anyway.
3. "0 lab findings" and green CI were treated as proof. They check spacing rules, not whether a screen is its board.
4. The lead did not put a screen beside its board before sending it to the owner.
5. The owner's decisions were spread over several files and the chat; a later decision (the K02 sidebar) was missed.
6. Work was split by surface among parallel builders who each left "v6 remains" for someone else.

## 3. What is true, in order of precedence

1. **The owner's latest words** in this session.
2. **The owner's recorded decisions:** section 9 here; `docs/PLAN-session-waves.md` ("Owner decisions", "Owner picks",
   "Owner on onboarding and the bots' look"); `docs/PLAN-w31-foundations.md` ("Owner answers" and later);
   `docs/PLAN-0.2.0.md` ("Owner decisions"); `docs/design/v7/REPASS.md` on `w33/repass`.
3. **The latest approved board** of a screen. Boards live on `origin/w33/boards-archive` (images and sources) and in
   `docs/design/v7/boards/src/` on `w33/repass`. A later board replaces an earlier one for the part it redraws:
   - **K02** (`bots/K02-*-main44-*`, source `bots/src-k02/`) replaces boards 11, 12 and 13's **open sidebar**: the
     Sessions / Bots switch on top, the boopis bot at 44 under it, rows as K02 draws them, "Groups".
   - **room12 / bot11 / bot17** (`botscreens.js`, Grok parity) are the threads of boards 12, 11 and 17.
   - **Dock K01–K08** (second set, one dock component) replace board 16's dock.
   - **Onboarding round 3** (`O-P*`, `O-S*`, `O-H*`, `O-B*`) replaces rounds 1 and 2.
   - **S17–S41** (session-boards) replace the earlier Session cards S1–S20 where both draw a screen.
4. **The written spec:** `docs/design/v7/DESIGN-SYSTEM.md`, `SESSION-TAB.md`, `ORBS.md`, `ONBOARDING.md`,
   `docs/specs/*`. Where text and board differ, the board wins and the difference goes to the owner.
5. **What v6 did.** Behaviour that worked is kept unless a decision removed it.

When two sources disagree and no later decision settles it: ask the owner, keep the nearest drawn state meanwhile.

## 4. How a screen is built (every step)

The builders' rules are in REPASS.md: it matches, it works, it is the kit, it is a component with all its states,
it is readable, nothing invented, the board wins over a lab rule. In short:

- The real app screen, on the board's content, is compared with the board by `pnpm lab:board` (dark and light).
- Every control works wherever the app can do the job; nothing v6 did is lost; a missing feature means a disabled
  control with a reason, on a list.
- Looks live in the kit (`src/components/v7`); screens compose and place. The registry `docs/UI-COMPONENTS.md` is
  kept true. The v6 code a screen replaced is deleted.
- Each component has lab stories for its states and behaviour tests.

## 5. Screens and states no board draws

The boards draw the main screens, not every screen or state (example: the mention capsule in the composer).

1. **The coverage map** (`docs/design/v7/COVERAGE.md` on `w33/repass`, built in phase 1): every screen, dialog, menu
   and state the app has (from the modules, the v6 lab stories and the feature list) in one table, each row marked
   **board** (which one), **decided** (an owner decision describes it), or **derived**.
2. **A derived screen or state** is composed only from kit components, tokens and the patterns of the nearest
   boards (the same-component rule, the corner and row rules, the calm rules). No new look, size or colour.
   If it cannot be composed that way, it needs a design: 2–3 options rendered for the owner.
3. Derived screens are rendered in the lab, checked by the lead against the nearest boards, and sent to the owner in
   **batches** (one contact sheet per area) for approval. Work continues meanwhile; nothing derived is released
   unapproved.
4. Once approved, a derived screen's render becomes its reference image (`boards.json`, marked "derived, approved").

## 6. What could go wrong, and the guard

| Risk | Guard |
|---|---|
| A screen that doesn't match is called done | `lab:board` numbers in every report, and the lead looks at every sheet in both themes before the owner sees it |
| A mock-up instead of the app | The lead checks the story boots the real app with provider data (no board HTML in `src/modules`) |
| Looks right, does nothing | The report's control table (wired to what, or why disabled); behaviour tests; the lead spot-checks |
| A v6 feature lost in a conversion | Before converting, the builder lists what the v6 screen did; the report accounts for each item |
| A one-off screen instead of kit components | The lead reads the diff's shape: kit files and registry change, module CSS holds placement only |
| A stale board used | Section 3's replacement list; the coverage map names the one reference per screen and region |
| An owner decision missed | Every decision is added to section 9 the turn it is made, and to REPASS.md when it binds builders |
| Builders collide or leave gaps | One builder at a time on anything that touches the kit; steps sized to finish; parallel only on disjoint areas after the kit settles |
| A builder runs out of room | Steps of one or two screens; "stop at a clean commit and report what is left" |
| Usage wasted | Proof before volume: a new kind of screen is proven on one case first; no full CI or long runs until a phase gate |
| Container restart or scratch wipe | Everything worth keeping is committed and pushed; boards are in the repo |
| Regressions as screens convert | `lab:board --all` in every report; unit tests; full CI and a real-engine pass at each phase gate |
| The lead forgets after a summary | This file |

## 7. The plan

Each phase ends at a gate. The lead does not start the next phase's volume work until the gate holds.

**Phase 0: the repass's base (done).** Boards archived, `lab:board`, the rules, boards 11, 17 and S17.

**Phase 1: the map and the shared parts.**
- Board 12 with the K02 sidebar: the group room, the sidebar as one component (open, rail, both tabs). In progress.
- The coverage map (section 5) and one owner-decision register folded into REPASS.md.
- The composer as one complete component: mentions as capsules with the "@" menu, attachment chips, the line and its
  quick menu, held and queued messages, the bot, room, session and dock variants.
- Gate: boards 11, 12, 17 and S17 match and work; the map exists; the owner has seen the first derived batch.

**Phase 2: every screen that exists today, on the kit.** One step at a time, in this order:
1. A started session: conversation, tool rows, AskCard, the finished turn, the composer (10, 13, S20–S23, S33–S38).
2. The dock (16, K01–K08), including the two small differences left on S17.
3. Settings, Store, Connectors, the palette, dialogs and menus (14, 15, S39, S40 and derived).
4. Onboarding, the one continuous first run (O-*), with its motion.
5. Everything else on the map: bot settings, new bot and new group, forms and cards, mods, sign-ins, errors, empty
   states, narrow widths.
- Gate: no v6 component, token or stylesheet is left in the app (`ui.*` and `tokens.css` deleted); lab rules and
  goldens reconciled with the boards; full CI green; a pass on a real engine; a test build the owner accepts.

**Phase 3: 0.2.0's remaining features.**
- Wave D foundations, each with its UI on the kit: host protections, the rules engine and its UI (this enables
  "Allow all this turn" and "Always allow"), team ops, feedforward live, blanks inline.
- Wave E: the macOS notch helper, aligned to v7. The dmg ships unsigned (owner decision).
- Already in the base: governed bots, local API 0.2, macOS, Session S0 (launch settings, the permission scale,
  rewind, sessions stay live).
- Gate: every 0.2.0 feature works on a real engine; installers for Linux, Windows, macOS; the owner's OK to release.

**Phase 4: 0.3.0, the Session waves.** Each feature is built with its screen (boards S18–S40), so nothing is drawn
before it works.
- S1: session metadata and search, worktrees, follow-ups (steer, queue, stop), the session inbox.
- S2: commit, push and PR; diff review; the terminal and the tabbed right panel; plan turn; fork and side chat.
- S3: notifications, usage limits, the context tick, **the keymap and palette (the owner's "keybind pass")**, the
  settings cascade, history paging, the CI checks, the replay profile.
- Gate: as phase 3, for 0.3.0.

Until a 0.3.0 feature exists, its control on a 0.2.0 screen is disabled with a reason (open question 1 below).

## 8. How the lead works

- **Builders:** one at a time on kit-touching work; a fresh builder per step, briefed with REPASS.md, the exact
  boards, what v6 did there, and the report format. A builder that knows the area is continued only while it has room.
- **Every report is checked before it is believed:** the sheets (both themes), the control table, the diff's shape,
  the test counts. Anything unproven is said to the owner as unproven.
- **To the owner:** side-by-sides (board left, app right), what is not done, and questions with the current choice.
  Work does not wait on a question unless the answer changes what is being built.
- **Commits:** the owner's identity only, no attribution lines, never to develop or main, no PRs, no tags or
  releases without the owner's OK. orb2 pushes need the owner's OK each time.
- **Machines:** commit and push often; no full lab locally; full CI by dispatch at gates; the disk is tight.

## 9. Owner decisions since the rejection (25 Nov 2026)

- The app must look exactly like the approved boards; the boards are the base for everything.
- Components are real: functional, built on the UI kit (kit fixed only where it was not correctly implemented),
  with a readable, standardized, organized structure. Not screen mirroring.
- Rail "+N": the triangle cluster stays; "+N" is a small filled chip on the right, clear of the bots, about half a
  bot tall, smaller on the compact rail.
- The Sessions / Bots switch is in the open sidebar (both tabs). On the collapsed rail a button is possible:
  options to be rendered for the owner's pick.
- Mentions: "@" opens a menu like the skills menu with the mentionable bots of the session or group; the choice
  becomes the same capsule (icon and name) in the composer as in the chat.
- Attachments: chips ("probably"); a crop goes to the owner to confirm.
- A stale board was caught: board 12's final render draws the Bots sidebar without the switch; K02 (later) is the
  reference for the open sidebar. The builder was corrected mid-step.
- Keybinds get their own pass. Ctrl+Enter steers with the queued message in a running session (S06).

## 10. State

| Thing | Where |
|---|---|
| Repass branch | `w33/repass` (worktree `/home/user/hx-wt/w33-repass`), from the shell branch, with session S0 and the dock branch merged |
| Boards | `origin/w33/boards-archive`; sources also in `docs/design/v7/boards/src/` on `w33/repass` |
| Builders' rules and step table | `docs/design/v7/REPASS.md` on `w33/repass` |
| Done | Boards 11, 17, S17: match (0.05–0.19%, live orbs and the dock's half pixel) and wired |
| Running | Board 12 with the K02 sidebar, mentions, attachment chips, the rail button options |
| Stopped, kept on their branches | `w33/onboarding`, `w33/settings-store` (first-attempt work; logic may be reused, looks are redone) |
| Paused by the owner | The launch film (`w28/launch-video`, uncommitted edits in `w28-launch`) |

**Open questions for the owner**
1. In 0.2.0, a control whose feature comes in 0.3.0 (worktree selector, "Get more usage"): disabled with a reason
   (current), or hidden?
2. The rail's orb size: board 11 (matched) against the recorded "rail 36".
3. From the first repass report: no attention dot on the Sessions / Bots pill; no "you" in the Sessions sidebar
   foot; short model names ("sonnet 5.5"); where a bot's role is shown.
4. Text contrast in light mode (quiet text under 4.5:1 on some boards).
5. The refund request for the wasted usage is the owner's to send to Anthropic support; the lead offered a summary.
