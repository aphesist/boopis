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
   - **S20–S23 replace boards 10 and 13** for a started session (thread, title pill, composer line). Boards 10–16
     were approved at 06:25 on 23 Nov, the Session boards at 08:11–09:06 with the owner's picks. The lead briefed
     the session builder with board 10 first and corrected it mid-step when the coverage map showed the conflict.
   - The order boards were sent in is in `scratchpad/sent-files.json` (every file sent to the owner, with times).
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
- Wave E: the macOS notch helper: **moved to 0.4.0 by the owner (26 Nov)**. The dmg ships unsigned (owner decision).
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
- **The stop hook's "uncommitted changes" notice:** when the changes are a running builder's work in progress in
  its worktree, the lead does not commit them from outside (it would break the builder's build or collide with its
  commits); the lead says so and checks that its own files are committed. The lead commits them only if the
  builder has stopped.
- **Before briefing any step:** look up the screen in COVERAGE.md and in section 3's replacement list, and check
  the order of approval, so the brief names the latest reference. Two stale references were briefed on 25 Nov
  (board 12's sidebar, board 10's session thread); both were caught mid-step.
- **This notebook is written at every event,** in the same turn: an owner message with a decision, a builder's
  report, a finding, a question asked or answered, a change of plan, a CI result.

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
- **The lead may make design decisions** where no board decides ("you're on fable so make design decisions on your
  own, keeping the theme and design philosophy we are aiming for"). So: for derived screens and states the lead
  decides, records the decision here and in REPASS.md, and shows the result to the owner in the next batch; work
  does not wait. Options go to the owner only for something large or a real change of direction.
- Collapsed rail: the tab switch upright (option B): Sessions over Bots, two ghost 28s in a vertical track.
- "@all" capsule: gold (the attention amber), not the plain text colour.
- Huddle fold, "to nina" line, presence tool words: left out ("if those features make no sense in the newer design").
- Stop stays, and voice stays too. The lead's design: Stop is a 28 tinted circle with a filled rounded square, at
  the left of the composer's right cluster ([stop] [mic] [primary]); positions never shift; no red.
- (Lead, after step 4) The composer's primary circle is always present. With no voice feature it shows the send
  arrow, quiet when the composer is empty and inverted ink when there is text; the voice glyph returns when voice
  exists. A session turn gets the same hover actions as a bot's (copy, more). Talk-while-held dictation and a working
  undo come back in the composer step. Receipts say "Denied". Undo under a turn rewinds to before that turn;
  "Checkpoint N" counts kept ships.
- Member name colours: the kit's contrast-safe ones. File chips: the bare file name (lead's decision, unanswered).
- Keybinds get their own pass. Ctrl+Enter steers with the queued message in a running session (S06).

**The lead's dock decisions (26 Nov, after step 5; to show the owner in the batch):**
- K02: a hovered bot at 52 or 46 drops the 1.25 face scale, as the board's still draws.
- The Well inside an ask follows the boards' corner (10), per rule 6 (the board wins over a lab rule).
- The ask's words sit 6 above the Well in the dock as K03/K04 draw; other cards keep their own boards' 8.
- A card with no messages keeps the composer at the foot of the card, over the row; the space above stays empty.
- Row order stays needs-you, working, the rest; K05's still contradicts its own rule and is not followed.
- "Always for staging": the label names the scope when the rules engine supplies one ("Always for <scope>"),
  otherwise "Always allow"; both hidden until the rules exist (phase 3).
- ctrl J for the compact row goes to the keys pass.
- Removed with the v6 dock (spec 21.4 and "bots ask only through approvals"): a form answered from the dock,
  `[` `]` pages, up/down for size, the minimised pill, the session part.

**Owner, 26 Nov (after the model switch):** "yes, run the host-only parts in parallel, that's fine. we can add the
macOS notch integration futurely. leave that for a possible 0.4.0 update. right now i want the basics. just don't
run screen-building for those. want to maintain the same level of consistency fable was giving me, where the boards
were a base but the model itself did some choices (it has to, not every screen is done, neither is every submenu)."
So: host-only work runs beside the kit builder, never screens; **the notch moves to 0.4.0** (phase 3 no longer
holds it); screen steps keep the board as the base and make the derived choices themselves, on Opus at high effort,
recorded and shown to the owner in batches.

**Owner, 26 Nov:** "can't we run opus on medium, with you on high making the decisions that are out of its
scope?" Agreed. **The rule from now:** builders on Opus at medium (Sonnet at medium for close-outs and CI). The lead
decides the derived screens before the brief (COVERAGE's derived rows for the step: layout, which kit parts, copy),
so the brief says what to build; the builder makes only small choices and lists each one with its pick; the lead
checks the sheets and corrects in the next brief. The host builder already running stays at high (security work,
mid-run); the next host builder runs at medium.

**The lead's transcription follow-up decisions (26 Nov):** the kit takes one trailing final after the mic is off;
the Unlicense is accepted for whisper-rs and whisper-rs-sys (public-domain dedication; told to the owner); the
AppImage relies on the system's libasound (it is on the AppImage exclude list).

**The lead's fates for the v6 details panel (26 Nov, COVERAGE conflict 14; to show the owner):**
- The collapsed context strip goes (the context is on the composer's line).
- S40's pane: head (title, folder, branch); Session (Model, Effort, How careful, Workspace) with the menus that
  exist; Use (Context, Cost, Pull request hidden until 0.3.0).
- Context: its row opens the breakdown by parts with "Compact conversation" (kit Disclosure in the pane; derived);
  `/compact` stays a command.
- Cost: its row carries "Change cap" (derived).
- Tasks (the agent's todo list): the Steps card in the thread, as board 17 draws a working bot's steps.
- Changes: "Open diff" opens the right panel on the diff as S24 draws its Diff tab, alone (no tab strip until a
  second tab exists; review features are 0.3.0).
- Output: a command's output lives in its tool row in the open work line (kit Well); the panel's Output goes.
- Governed and the ladder: the model menu already says them. The project's "no plugins and hooks" switch, the
  per-session connector switches and Environment detail (sandbox, runtime, harness, gate) move to Settings
  (step 7: project policy, Connectors, Diagnostics); the pane keeps one "Environment" section of plain rows.
- Pin, Settle, Fork: whatever works today stays reachable from the session row's and the title's menu.
- A mod's pane stays a tab; the overlay under 900 px stays; palette commands are re-pointed.
- Model menu: S19's two-line rows (nothing cut). "Fix and retry" sends the fix request as the next message.
  The engine line under a bot's chat and a room stays. Partial dictation text stands as plain text.

**Owner, 26 Nov (after the transcription finding):** "the microphone button is simply a transcription button. it
reads your voice and transcribes it into text. that is simple and should already exist. the 'talk' button, meaning,
talking to the bots themselves, don't come from the microphone button." So: the mic is plain speech-to-text and must
work in the live app, with no setup screen and no link to voice; talk is the voice circle only. The lead's "mic shows
a setup Notice" below is **withdrawn**; the proposal "transcription as a 0.2.0 feature" is answered: build it now.

**Owner, 26 Nov (later):** "you can just use a real transcribing open source system that already exists, like
voxtype or something. no need to actually build one." Checked: voxtype is MIT, Rust, whisper.cpp plus cpal
underneath, a Linux-first daemon/CLI (partial macOS, no Windows, no embeddable crate), so it cannot be shipped
as-is; the builder was told to reuse existing crates and adapt voxtype's code (notice kept) and write only the glue.
The owner also asked how many steps remain; answered with the count in section 7 (about 9 to 11 builder steps to
the phase 2 gate and a test build, 7 to 8 for 0.2.0's features, 12 to 15 for 0.3.0; about 2.5 hours a step).

**The lead's transcription decisions (26 Nov):** local and private (no key, audio never leaves the machine, never
on disk); native capture in the host (cpal), not the web view; whisper.cpp (whisper-rs), multilingual base
quantized (about 57 MB) fetched on first use with a pinned hash and progress; recording only from the person's own
press (no local API, mod, bot or deep link); seam `start(onEvent): stop` with preparing / listening / partial /
final / error; UI adapter in one file `host/dictation.ts`. Kit side (states drawn with existing parts) by 6b.

**The lead's decisions after 6a (26 Nov):**
- (WITHDRAWN by the owner the same day, see above.) The mic with no speech model behaves as the voice circle does: shown, a press starts nothing and opens a Notice
  ("Dictation needs a speech model", "Set up voice") leading to Settings > Models. Capability-driven.
- (ANSWERED: build it now, see above.) Proposed to the owner: build transcription as a 0.2.0 feature in the same voice section, a local
  model on the person's hardware first (no key, private) and a provider key as the other option.
- K04's bubble: the kit's derived fill stays (one rule for every bot colour); the board's value was typed by hand.
- A pasted file with no path: a Notice asks to save it and add it with "+" (copy to be read in the copy pass).
- S33's cost on the live line reads tokens until a price table exists in the UI.
- S37's buttons open Settings > Models filtered to that lab (the sign-in lives there).
- Session composer placeholder is "Message" (the session boards' default), not v6's "Describe the change".

## 9b. The coverage map and the lead's resolutions (25 Nov)

`docs/design/v7/COVERAGE.md` (branch `w33/coverage` 6507482d, to be merged into `w33/repass`): 427 rows in 19 areas:
191 on a board, 37 decided, 197 derived, 2 unknown; 17 derived review batches; 34 conflicts. Top derived items: the
command palette, everyday composer states, the bot settings sheet, New bot and New group, the form cards, the
Settings pages no board draws, models and sign-ins, session parts with no board (council, menus, the rewind sheet,
the details sections), the Store beyond its front page, narrow widths and failure screens.

Resolutions the lead made (by the precedence of section 3 and the owner's leave to decide):
- A started session follows S20–S23, not boards 10 and 13 (conflicts 1, 6). The Sessions sidebar is S17's inbox (2).
- No bots in the Sessions tab outside the dock (3). The collapsed rail on Sessions holds the toggle, the upright
  switch, "+" for New session, Store and Settings; nothing else (derived, lead's design).
- The hand-off line is a SystemLine variant, shown when the provider reports a hand-off (4). K02-11's thread is not
  a reference; board 11 is (5).
- "+" in a session opens the add menu (attach as a chip, folder, mention a file, commands); in a bot's chat and a
  room it opens the file picker. A click on the composer's line opens its quick menu (8, pick S05).
- Keys: the owner's pick S06 stands (Ctrl+Enter steers, Enter while running queues); the keybind pass settles the
  rest (9). The default step is Auto-accept edits (10, pick S02).
- One word for refusing everywhere: "Deny" (11). A session's answers are S20's; a bot's are boards 11 and 12's.
- Bots ask only through approvals; a bot's question on dock K03 is stale content (12).
- Rewind takes S23's CheckpointBar look; "Undo" is the rewind with its dry-run sheet (13).
- **A control whose feature does not exist yet is hidden, not disabled** (24): built against the capability map,
  shown in the lab with the capability on. This replaces "disabled with a tooltip" and closes open question 1.
- Settings nav follows the latest board, O-X02: General, Models, Connectors, Approvals, Sessions, Bots, Appearance,
  Keyboard; Diagnostics inside General (15, 16). The open dock is one fixed size, 640 × 432 (20).
- Still to decide when their step comes: the session details pane's sections (14), what General holds (17),
  Settings > Sessions' Worktrees and Git groups (19), the dock's order without pins (21), where a floating notice
  sits (31: currently the top of the work), where mods draw in v7 (32), first run's extra states (27).
- For the owner in the next batch, not blocking: "you" in the Sessions foot (28), the Store's item marks (30: the
  owner's brand tiles of 23 Nov against board 15's grey tiles; the lead keeps the brand tiles), light contrast (33).

## 10. State

| Thing | Where |
|---|---|
| Repass branch | `w33/repass` (worktree `/home/user/hx-wt/w33-repass`), from the shell branch, with session S0 and the dock branch merged |
| Boards | `origin/w33/boards-archive`; sources also in `docs/design/v7/boards/src/` on `w33/repass` |
| Builders' rules and step table | `docs/design/v7/REPASS.md` on `w33/repass` |
| Done | Boards 11, 17, S17: match (0.05–0.19%, live orbs and the dock's half pixel) and wired |
| Done (7d41b42f) | Board 12 thread (0.02–0.04% outside orbs), the K02 sidebar (0.00%), the held strip (0.00%); the room on the kit composer; "@" menu and capsules; attachment chips; a room details pane (derived); v6 presence, huddle, glance, mentions deleted. The lead looked at 12-room dark, K02 sidebar light, the rail options and the chips crop |
| Done (0376447f) | A started session: S20 (0.16–0.17% outside orbs; the differences are "Deny" and the Stop button, both decided) and S23 (0.06%). v6 conversation and session composer deleted. Stop button, upright rail switch, gold @all, "hidden until it exists" (capability-driven) built. Coverage map merged. The lead looked at S20 dark, S23 light and both crops |
| CI on 7d41b42f (run 45702861490) | **desktop-smoke failed, ui smoke failed, lab-orbs 29 errors ("the state never finished drawing")**; other jobs green; lab still running. Regressions are accumulating: the next step starts with health |
| Note | The owner stopped step 5's builder by accident (25 Nov evening) and asked for a restart; a stopped builder cannot be resumed, so a new builder was started on the same brief, told to review the 16 uncommitted files the first one left, with the voice decision added |
| Done (2890ee9a, 26 Nov) | Step 5 by the restarted builder. **Health:** smoke 447/448 (the one is a 2 ms frame budget, green on CI), unit 1944, `dock_webkit.py` 25/25, lab:orbs clean on the touched stories; CI run 45736911632: every non-lab job green (ui, desktop-smoke, lab-orbs, e2e, appimage, installers). **Voice:** the circle is always shown; with no voice model a press opens the Notice "Voice needs a voice model" with "Set up voice" (Settings > Models); `DataProvider.voice` is the capability, no provider sets it. **Dock K01–K08:** K01, K07 0.01%; K08 0.11%; K02 0.20% (face scale); K05 0.40% (order rule against the board's own drawing); K06 0.66% (owner's Stop); K04 1.8% ("Always allow", Well corner); K03 10% (moss's question drawn as an approval, by the owner's "bots ask only through approvals", plus the order). Orbs drawn at their shown size; dock on the device pixel; "Compact dock when idle" setting (off). The lead looked at all eight boards in both themes (crops in scratchpad/repass/crops, sheets dock-K01-K08-{dark,light}.png) and the voice notice: they match as reported |
| Not proven at 2890ee9a | **The full lab:** no completed report since 0376447f (1146 blocking findings in 35 stories then; three causes fixed but unconfirmed). Run 45736911632's lab job was still running when the builder stopped. README images not regenerated; goldens for new states not regenerated; kit/dock stories not extended; `components/composer.ts` and `mentions.ts` (v6) still in the tree, used only by their own stories and tests |
| Done (ca44785a, 26 Nov) | **Step 6a.** Lab report of 2890ee9a read by cause (1109 blocking: 622 handled, 394 inherited by later steps, 93 small listed); v6 `components/composer.ts` and `mentions.ts` deleted with stories, CSS and 157 goldens; kit/dock stories; the lead's dock decisions built (K02 0.20, K03 10.24, K04 1.69: the bubble's fill, board hand value #d42746 against the kit's derived #e2284e). **Composer:** hold-to-talk (400 ms), own undo/redo across chips, drop and paste of files in every composer, one kit HoverBar (bots, rooms, session answers: copy, more), effort and model changed mid-session with the S33 line (0.00%), quick menu and the fold under 900 px, S37 (0.03%), S41 composer (0.00%). Unit 1997; smoke 447/448 (frame budget, machine); CI run 45754565610: all non-lab jobs green, lab running. The lead looked at S33 dark, S37 light, S41 dark and the five derived shots |
| **Found in 6a, verified by the lead** | **Transcription does not exist in the live app.** `host/live-provider.ts` has `dictation: { start: () => () => undefined }`; nothing on main or develop hears audio; only the mock writes a transcript. The owner believed it worked ("at least transcription is supposed to be a thing already"). Told to the owner 26 Nov with a proposal (below). REPASS.md's "works already" is wrong and is corrected in 6b |
| Seen by the lead on 6a's sheets (to fix in 6b) | S41: with no sessions the app's sidebar loses the Sessions / Bots switch and the "+" (the board keeps them) and the title reads "New session" for the board's "Sessions". The model menu is about 160 px wide and cuts its rows' text ("Picks a …", "Not on …"). At 880 px wide the sidebar covers the thread and the title pill collides with the search hint: narrow widths are not done (phase 2 step 5) |
| Not proven at ca44785a | The full lab (in progress); effort/model change against a real engine (fake gateway only); a pasted file, hold-to-talk and undo in WebKitGTK (Chromium only); `dock_webkit.py` flaked once in nine runs (24/25, check not captured) |
| Done (bb32bb41, 26 Nov) | **Step 6b, items 1 to 6 of 8.** S41 (0.63/0.47%; chrome, sidebar, composer 0.00; the switch was never lost in the app, the fixture sheet misled the lead; the difference left is the hidden "Import sessions"); the model menu as a kit Menu `list` variant, 360 wide (derived; descriptions still cut, with a tooltip); the mic's states in the kit (preparing, listening, partial, final, error) and the setup Notice removed per the owner; S36 engine stopped (line 0.00%, "Start it again" calls the host's real `hermes_retry`; derived under a bot's chat and a room); S38 gate failed (card 0.00/0.01%, kit FilesCard `check`; failed and rolled back are one state in the engine); the open work line to S10's geometry with human words. Unit 2026; smoke 447/448 (machine budget); CI run 45768380782: all non-lab jobs green, lab running. The lead looked at S36 dark, S38 light, S41 light and the derived batch |
| Not done in 6b | **S40** (the v6 details panel, `modules/session/right.ts`, untouched; the builder left an inventory with proposed fates) and **the lab findings** (501 blocking on ca44785a: details strip 105 + panel 27, room details pane 98, `stability.render` 50, inline chips 41, kit Pane rows 15, tool-row head and FileCard tile 14, axe contrast on Steps 14, S23 foot at 390 7, small kit 12, bots stories 17, pages/window 9, screens still v6 90) |
| **Intermittent, real** | `dock_webkit.py` failed once on CI (run 45765615125, 23/25): "the asks fold" and "and as they fold": nina and kai's orbs blank (under 12 lit pixels) in the first frame after the panel folds, on WebKitGTK. Passed on the re-run. A paint defect, not a test problem: first item of 6c, by cause |
| Seen by the lead on 6b's shots | The model menu still cuts its descriptions; a failed step reads "terminal failed" (a raw tool name) |
| Dictation seam (final, from 6b) | `DictationSource.start({ botId }, onEvent): cancel`; events preparing {done,total}, listening, partial {text}, final {text}, error {reason: a sentence, retry?}. Sent to the transcription builder, who merges `origin/w33/repass` into its branch |
| Step 6c (stopped 26 Nov by the Fable quota, resets 2 Dec 07:00 UTC) | Committed and pushed before the stop: `3bbba2ab` the dock test now records why an orb is blank (diagnosis only; **the blank-orb defect is not fixed**); `9a98c4ca` **S40 the details pane on the kit Pane (head, Session, Use 0.00% dark and light)**, the v6 details panel deleted, the lead's fates built (context breakdown with Compact, Change cap, Environment and Connectors derived sections, tasks as board 17's steps card, Open diff as S24 alone, command output in the work line, mod pane as a tab, palette re-pointed); `5c03fd4d` lab findings fixed by cause (rail flag and upright switch re-render, S23 foot at 390, FileCard name, pane cards). Not known: item 3 (model menu two-line rows, failed step words). Health suite not run. Worktree was clean |
| Merged by the lead (26 Nov) | `e5f4c171`: `w33/transcription` (6d6076a2) into `w33/repass`, no conflicts, pushed |
| **Model change (owner, 26 Nov)** | The owner switched the session to Opus 5.5 and said: no Fable subagents; pick models and effort levels that fit the goal; do not waste limits. The lead's rule from now: **Sonnet at medium** for close-outs, health runs, mechanical fixes and CI chasing; **Opus at medium** for board-matching and kit steps, with the lead deciding the derived screens in the brief (owner, 26 Nov; was "Opus at high"); one kit builder at a time; parallel host-only work only when the owner agrees (asked 26 Nov, no answer yet) |
| Running (26 Nov) | **6c close-out** (Sonnet, medium): item 3 if missing, the smoke's controls wait, dictation wording, health suite, CI, the dock diagnostic text if it fails |
| Running in parallel (26 Nov, owner's OK) | **0.2.0 host foundations, no screens** (Opus, high): branch `w34/host-foundations` (worktree `/home/user/hx-wt/w34-host`) from w33/repass e5f4c171 with `w31/specs` merged (`1eff3002`; DECISIONS.md conflict resolved by keeping both; the w31 ADR drafts 0051 to 0056 collide with the orb's ADR-0051 and are to be renumbered 0060 to 0065). Order: renumber, host protections H1 to H6, the rules engine and its data (approval `scope`, capability `approval-rules`), team ops if room. Not: feedforward, blanks, notch, any `components/` or `modules/` file. Host builds on CI only (disk) |
| Next | **6d** (Opus, high): the dock blank-orb fix from the diagnostic, form cards with fields, a council, find, the `ship` card kind. Then **step 7** (Opus, high): Settings (with project policy, connectors, Diagnostics, the voice section), Store, Connectors, palette, dialogs |
| Transcription (76ed01b6 on `w33/transcription`, 26 Nov) | **Built and proven on a recording on Linux, Windows and macOS; a real microphone not tested.** New crate `crates/boopis-dictation` (whisper.cpp via whisper-rs 0.16, cpal, rubato; resampler adapted from voxtype with its MIT notice), CPU only with pinned x86-64 instructions; model `ggml-base-q5_1` (59.7 MB, pinned SHA-256, from huggingface.co, resumable, re-hashed at every load) in `<app data>/speech/`; host commands `dictation_start`/`dictation_stop` (main window only), stopped on close/reload/exit; local API test "nothing reaches the microphone"; `host/dictation.ts` in the kit's shape; new CI job `dictation` on three systems runs the model-backed test on whisper.cpp's public-domain sample. First words about 4 to 5.6 s, last words 0.3 to 1.1 s after the end; +1.7 MB. CI run 45772503012: all green but `ui` (smoke "controlslight: it opens a themed listbox") and the running lab. Merged `origin/w33/repass` at bb32bb41 into itself, no conflicts. The owner's test steps are in `docs/RELEASING.md` "Dictation" |
| Transcription follow-ups (6d6076a2, 26 Nov) | **Done:** the kit composer keeps taking a stopped dictation's events until one `final`, an `error` or 3 s (`988d81c8`; `hostDictation()` always follows; 4 new tests; vitest 2041); macOS reads the authorization status and waits for the person's answer (objc2-av-foundation 0.3.2, MIT, macOS only; type-checked and built on CI's macOS leg, the prompt itself not seen); the record is **ADR-0059** (w31/specs holds 0051 to 0056, w32/session-specs 0057 and 0058). **`ui` still red on the branch, not from this work:** "controlslight: it opens a themed listbox" is an intermittent in the smoke's fixed 350 ms wait (0 of 17 local runs; 1 of 3 on CI); the re-run 45778070936 failed only at the WebKitGTK dock step (the blank-orb intermittent 6c is fixing); every other non-lab job green incl. `dictation` on three systems. Known cost of "do not mix": a new press within about a second of a stop loses the stopped dictation's last second. `data/provider.ts` and UI-COMPONENTS wording ("cancels" now means "stops listening; one last final may follow") left for the repass side. The builder cleaned the shared target directory by mistake (504 MB, its own build; nothing of the other builder's was there). **To do by the lead when 6c finishes: merge `origin/w33/transcription` into `w33/repass`; then the smoke's controls check waits for the fill, not 350 ms** |
| Disk (26 Nov) | Fell to 734 MB; the lead ran `cargo clean` on `/home/user/hx-wt/w33-session-s0/target` (2.4 GB of regenerable build output); 3.0 GB free. That directory never held the host's dependencies (the lead's brief was wrong); a full host build does not fit on this disk: host builds rely on CI |
| Stopped, kept on their branches | `w33/onboarding`, `w33/settings-store` (first-attempt work; logic may be reused, looks are redone) |
| Paused by the owner | The launch film (`w28/launch-video`, uncommitted edits in `w28-launch`) |

**Not verified at 7d41b42f (superseded by the 2890ee9a rows above):** smoke tests updated blind; the reworked bots stories not run; no real engine.
**Known gaps:** the sidebar does not resize (the spec says 88–400; the app never had it); no drop or paste of files
in the Bots composers; a room's cost and room-level approvals have no provider data yet.
**Dropped by the board 12 step because no board draws them (asked of the owner):** the huddle fold, the "to nina"
line, presence detail (tool-in-use words, the needs-you row).

**Lost or changed in step 4, to restore or confirm:** talk-while-held dictation (gone); the composer's own undo
(gone, browser undo may break when marks redraw); the hover copy button on a session turn (gone); "Open PR" and the
ship verdict unreachable (they belong to S2); the assumptions row replaced by the mark's menu; every form kind but
approvals is still the v6 card; tasks, council, find and the details panel are still v6.
**Tests at 0376447f:** unit 1918 pass; smoke mention 16/16, boot 3/3, live 9/10, forms 27/33, keys 102/114 (the
failures are the dock's API, bot settings, the account menu); not run: owner, mods, controls, store, corners,
concentric, dock, axe, the Python e2e; stale and known to fail: concentric.mjs, corners.mjs, mods.mjs.

**Open questions for the owner**
00. (Answered 25 Nov, corrected by the owner the same evening: transcription, the mic's dictation, is supposed to
    work already and must be verified in the live app at the phase gate. **The voice button is not hidden**: it is
    shown as the boards draw it and does not work until the person sets up a voice model: an API key for a voice
    provider (ElevenLabs, Fish Audio) or a local model on their own hardware with live voice. Until then a press
    opens "Set up voice" leading to Settings > Models. It is the one exception to "hidden until it exists". The
    lead's "send arrow when empty" decision is withdrawn. To build: the voice section in Settings (step 7: provider,
    key through the host's secret store, local option); live voice itself is a feature with no release yet: to be
    placed in the plan with the owner.)
0. (Answered 25 Nov: rail switch B, @all gold, dropped room features stay out, Stop and voice both, readable
   colours. Sent to the session builder as kit items.)
1. (Closed by the lead: hidden until the feature exists; told to the owner.)
2. The rail's orb size: board 11 (matched) against the recorded "rail 36".
3. From the first repass report: no attention dot on the Sessions / Bots pill; no "you" in the Sessions sidebar
   foot; short model names ("sonnet 5.5"); where a bot's role is shown.
4. Text contrast in light mode (quiet text under 4.5:1 on some boards).
5. The refund request for the wasted usage is the owner's to send to Anthropic support; the lead offered a summary.
