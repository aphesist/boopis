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
    step's, and live voice itself is not built yet. Dictation (the mic) is another thing (below);
  - **the mic is transcription** (owner, 26 November: "the microphone button is simply a transcription button. it reads your voice and
    transcribes it into text. that is simple and should already exist. the 'talk' button, meaning talking to the bots themselves,
    doesn't come from the microphone button."). The mic writes what you say into the composer's text and must work in the live app; it
    has nothing to do with a voice model, never says "set up voice" and never leads to Settings, Models: that Notice is the voice
    circle's alone. Transcription is built (the host's local whisper.cpp, the model fetched on first use, ADR-0059; crate
    `crates/boopis-dictation`, `apps/desktop/ui/src/host/dictation.ts`; merged from `w33/transcription` in `e5f4c171`). It was tested on a
    recording on three systems, **not yet on a real microphone**. The kit's Composer draws what a dictation reports (`DataProvider.dictation`, `DictationEvent` in
    `data/provider.ts`; `components/v7/compose.ts`): the speech model being fetched once, with its progress in the placeholder
    ("Getting the speech model 12 of 57 MB"); listening; the words arriving in the text; an error in plain words in a Notice at
    the mic ("No microphone found", "Microphone access is off for boopis", "The speech model could not be downloaded") with "Try
    again". A build with no dictation at all says "Dictation is not available in this build", with no action. (An earlier decision
    of the lead's the same day, a "Dictation needs a speech model" Notice with "Set up voice", is withdrawn by this.);
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
  - **the lead's decisions for a session's details** (26 November; the lead's, with the owner's latitude; they close COVERAGE conflict
    14: board S40 draws one pane, the v6 panel had seven sections):
    - the collapsed context strip goes: the context is on the composer's line;
    - the pane is S40's on the kit's Pane: its head (the name, the folder, the branch), Session (Model, Effort, How careful, each
      opening the menu the composer's line opens; Workspace), Use (Context, Cost; Pull request hidden until 0.3.0);
    - Context: its row opens what fills the context, part by part, with "Compact conversation" (the kit's Disclosure in the pane:
      derived); `/compact` stays a command;
    - Cost: its row changes the cap ("Change cap": derived), as the v6 control did;
    - Tasks (the agent's todo list) are not in the pane: they are the kit's card of steps in the thread, on the session's last turn,
      as board 17 draws a working bot's ("Release 0.2.0, step 3 of 5");
    - Changes: a FilesCard's "Open diff" opens the right panel on the diff as S24 draws its Diff tab, shown alone (no strip of
      tabs until a second tab exists; the review features are 0.3.0 and hidden);
    - Output: what a session's commands printed is in the open work line (the kit's terminal Well); the panel's section goes;
    - Governed and the ladder: the model menu says them. The project's "no engine plugins and no plugin hooks", the per-session
      connector switches and the Environment detail move to Settings at step 7; until then the pane keeps one "Environment"
      section of plain rows and one "Connectors" section with the switches, the store and the project's switch (derived from
      S40's own sections), so nothing is lost before step 7;
    - Pin, Settle, Fork: whatever works stays reachable (a session row's menu, the pane's overflow); what does not exist is
      hidden (pinning: `LaterFeature` `pin`);
    - a mod's pane stays a tab of this panel; the overlay under 900 px stays; the palette's "Open context", "Open connectors",
      "Open environment" and "Open changes" go to their new places, and "Open output", "Open tasks" and "Open governance" went
      with their sections;
    - the model menu's rows are S19's two-line rows (the name, what it is on a second line, nothing cut), in both the composer
      line's menu and the new session's; a failed step in the open work line keeps its words ("Ran pnpm test dock") with the
      failure as a StatusWord and its time;
  - **the lead's decisions for 6e** (27 November; the lead's, with the owner's latitude; no board draws these): a council is S19's Menu
    (checked OptionRows, the combiner a SelectorItem, "Ask the council"), a Block "Council · N models" of member ToolRows while it runs
    ("asking", "combining" with the shimmer; a failed member's reason in a Tooltip), and once done the ordinary reply with "council of N"
    and the stacked marks in its foot and "Answers (N)" in a Disclosure; none reported, red with "Ask again". A task handed to another
    model is a ToolRow (its StatusWord queued, running, done, error), its transcript a compact thread in a Well under a Disclosure, a ghost
    Stop only while it runs. An escalation is a SystemLine ("Switched to <model> for this step: <reason>"; capped with an amber
    StatusWord). A failed turn is S38's check card ("retrying" shimmers; "passed" 6d's receipt). A teammate's ask and a routine's are the
    AskCard question form with 6d's receipts. The rewind's sheet is the Dialog with FilesCard rows; where it cannot run Rewind is disabled
    with why in its Tooltip. Find is a floating FindBar with the matches washed in a token. A bot's proposed team change is an AskCard
    holding the kit's TeamPlan (O-B06's block), applied by the hold; a step a rule paused is an AskCard "<bot>'s step waited for you".
    Edit before approving and Settings › Approvals' Open are built and hidden behind capabilities (`approval-edit`, `rules-settings`);
  - **the lead's decision for 6f** (27 November, from the 6e sheets): in the running council Block the header "Council · N models" and each
    member's model name were mono; a model's name is set in the regular face everywhere (the answers Disclosure, menus, askers), so the
    head and the members are too, and so is a task handed to another model (the kit's ToolRow `text`). Mono stays where boards 17, S20
    and S23 use it: commands and paths (a tool row's name);
  - **the lead's decisions for 7a** (27 November; the lead's, with the owner's latitude; no board draws these): Settings › Approvals is
    O-B07's look on the kit (a rule's Switch leads its words, where it came from a quiet word at its end, Edit and Remove with the pointer
    or the focus; an edit opens under its card as a Field with "What this catches"), with "Drafts" first (each a Field, "Save rule" and
    Discard), the last change as a SystemLine with Undo (S33's line), "Restore defaults" behind a confirm in place, "Reviewer model" a
    select, and "The rules changed outside boopis" as a Notice with "Use the new rules" and "Keep mine"; Voice and speech is a section of
    Models (Dictation: the speech model's state, Download, Delete, the language; Voice: the provider, a key as a secret Field that goes to
    the keychain and leaves the page, a local server's address); a narrow window stacks the dialog's nav over the page as its glyphs; on
    Appearance the dialog steps to the window's edge without its scrim (today's behaviour, kept);
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
- Step 6b (26 November): the same on `bb101dbb` (this note and the tables are the only later change), with `lab:board --all` on 23
  boards (S36 and S38 added). The unit tests 2026 of 2026; the smoke 447 of 448 (the one is the machine's `corners` budget again: 2.1
  and 2.6 ms in two runs); `tests/e2e/dock_webkit.py` 25 of 25 twice; `lab:static` 553 findings, the same set as at `ca44785a`;
  `lab:orbs` 0 findings on the touched stories. CI run 45754565610 on `ca44785a` (6a's last commit): every job green but `lab`,
  whose gate counts 501 blocking findings (1109 at step 6a's first reading): by cause, the v6 details strip and panel 132
  (`modules/session/right.ts`, not converted: S40), the room's details pane 98, a second render that differs 50 (the switch's
  "needs you" name), inline chips 41, the kit Pane's rows and a bot's tool row and file tile 29, the kit's Steps and chrome under axe
  14, S23's foot at 390 wide 7, and 90 on screens still on v6 (cards, mods, store, menus, dialogs). None was fixed at step 6b.
- Step 6c (27 November): the same, with `lab:board --all` on 22 boards (S40 added; every board's own parts at or under 0.7% outside
  the orbs except K03's open dock, 10.2%, and K04's card, 1.7%, both known since 6a). The unit tests 2066 of 2066; the smoke 443 of 446
  before two fixes (the `keys` check read the old list's rows: now the kit's option rows, 118 of 118; `corners` is the machine's budget
  again, 2.3 ms) and the controls check now waits for the listbox's fill instead of 350 ms; `tests/e2e/dock_webkit.py` 25 of 25 in four
  runs of five (the fifth never started: the WebKit driver answered 500); `lab:static` 539 findings, all in v6 files; `lab:orbs` 0
  findings on `kit/pane`, `kit/menu`, `kit/disclosure` and `boards/sessions`.
- Step 6d (27 November): the same, with `lab:board --all` on the same 22 boards (unchanged: no board draws a form; K03's open dock 10.2% and
  K04's card 1.7% as before, every other board's parts at or under 0.64% outside the orbs). The unit tests 2082 of 2082; the smoke 444 of
  446 before the mods part was rewritten on the kit's block (then 40 of 40), `corners` the machine's budget again (2.6 ms); `forms` 41 of
  41; `tests/e2e/dock_webkit.py` 26 of 26 in five runs of five; `lab:static` 537 findings, none in a converted file; `lab:orbs` 0
  findings on `cards/form*` (202 states, 70 with orbs), `kit/swatches`, `kit/field`, `kit/option-row`, `kit/disclosure`. The dock's
  blank orbs were the WebKit driver's screenshot, one frame behind the page (below): the test now waits for two drawn frames.
- Step 6e (27 November): the same, with `lab:board --all` on the same 22 boards (S19 has no entry in `boards.json`: its menu is compared
  by eye in the council's sheet; S23 0.03% outside the orbs dark and light, S33's line 0.00%, S38's card 0.00% / 0.01%, 12-room 0.02% /
  0.04%, 11 and 17 0.24% and 0.23%). The unit tests 2141 of 2141; the smoke 447 of 448 (the machine's `corners` budget again,
  2.16 ms), `keys` 122 of 122 with the find checks; `tests/e2e/dock_webkit.py` 26 of 26; `lab:static` 535 findings, none in a file 6e
  converted (the room's notices were renamed off "toast"); `lab:orbs` 0 findings on `composer/council`, `composer/children`,
  `cards/escalation`, `cards/error`, `cards/teammate`, `cards/schedule`, `bots/held`, `kit/find-bar`, `kit/team-plan`, `kit/turn-foot`,
  `kit/files-card`.
- Step 6f (27 November): the same, with `lab:board` on 11, 12, 17, S20, S23, S33, S38 and K01 to K08 (none worse than at 6e: 11 and 17
  0.24% and 0.23% outside the orbs, 12-room 0.02% / 0.04%, S20 0.13%, S23 0.03%, S33's line 0.00%, S38 0.00% / 0.01%, K01 and K07 0.01%,
  K02 0.20%, K02-12's sidebar and held 0.00%, K06 0.32%, K08 0.11%, K05 0.40%; K03 10.2% and K04 1.7% as known since 6a). One lab fix was
  undone by the boards: inline code with `line-height: 1` moved board 12's thread by a pixel, so the board's own `line-height: inherit`
  stays and the rule allows its pixel (rule 7). The unit tests 2124 of 2124; the smoke 451 of 452 (the machine's `corners` budget, 2.21 ms);
  `tests/e2e/dock_webkit.py` 26 of 26; `lab:static` 519 findings (535 at 6e), none in a converted file; `lab:orbs` 0 findings on
  `kit/tool-row`, `kit/system-line`, `kit/inline-chip`, `composer/council`, `composer/children`, `bots/group` (the hand-off). CI's lab on
  6e's last commit (run 45821440744) counted 904 blocking findings, not the 166 of the earlier reading: 6d's form card and 6e's blocks
  had not been through a full lab yet (the forms' concentric 560, the council's menu, a bot's held asks). Read by cause and fixed at
  the cause, mostly in the kit (each per story with `pnpm lab:check --story`): a secret Field's Show (concentric with the box), the
  Field's input drawing a second ring under forced focus, an answered row's action (centred, concentric), a DiffView framed twice in a
  Well, a Menu's foot (its rows the menu, its button concentric and still under press), a running ToolRow's name invisible under reduced
  motion, a long path's reference leaving its line, @all's stack making its line taller and its "+N" raised on raised, a mention's orb
  parting from its name, a check's long name pushing its action out, the turn foot's ring past
  the turn, the hx-card host taking its content's width in a page column; on screens: the mod drawer's corner, the v6 menus' key chips,
  the new group's title, the diff pane at 390, the dock card's head at 390 (it stays at the top while its log scrolls), a menu foot's select giving way before its button on CI's wider fonts, a mod toast's count, the store's and the keys sheet's v6 search padding, a roster row's outside mark. Rules
  adjusted where the boards draw what they flag (rule 7, each with a line naming the board): the light theme's `--text-quiet` (boards
  11, P2, 17; a section head's count, K02), a StatusWord's amber and red, the boards' untrimmed 18 boxes (`.you`, `.refchip`,
  `.badge2`), a source wrapping with its sentence (board 12 ends a line with its tile: "(WebKit bug 27611)"; keeping the tile with its word moved the board by 0.11%, so it was undone), inline code's pixel; and three probe corrections where a finding was wrong (the kit's
  `.k7-sr` text is not visible; @all's stack is a mention's mark, not its words; a chip that clips its own content is measured to its
  content box, and drawn text that wraps is read on its last line). One story allowance: the connector asker's 16 tile in a form's head
  stands where an orb stands. CI's lab on `8a91350f` (run 45846824653): 17 blocking (904 before), every other job green; fixed after it: the council foot on CI's
  fonts (10), the dock head at 390 (3), the wrapped source (1), the mod toast's count (1). CI's lab on `c3f63cf2` (run 45864217295):
  **3 blocking**, every other job green. Left, by cause (not fixed here): the v6 bots settings sheet's run-limit menu does not open at
  390 (1, `bots/settings-sheet`, step 7); the first run's consent diff ring under forced focus (1, `settings/first-run`, step 8's page);
  the long-names window at 390, the dock card's long name over the thread (1, `pages/window`: the sticky head fixed the short name's
  case in `composer/composer-in-app`, not this one).
- Step 7a (27 November): the same, with `lab:board --all` on 24 boards (14 and S39 added; none worse than at 6f: 11 and 17 0.24% and 0.23%,
  12-room 0.02% / 0.04%, S20 0.13%, S23 0.03%, S33's line 0.00%, S38 0.00% / 0.01%, K01 0.01%, K06 0.32%, K08 0.11%; K03 10.2% and K04 1.7% as
  known). The unit tests 2153 of 2153; the smoke 445 of 447 on its first full run (the machine's `corners` budget, 2.44 ms, and `dock-presence`'s
  check of the v6 dock switch, rewritten on the kit: 27 of 27), `keys` 122 of 122, `controls` 15 of 15, `owner` 38 of 38, `axe` 25 of 25;
  `tests/e2e/dock_webkit.py` 26 of 26; `lab:static` 481 findings (519 at 6f), none in a file 7a touched; `lab:orbs` 0 findings on
  `v7/settings`, `boards/settings`, `v7/settings-connectors`, `pages/window`; `lab:check --quick` 0 failures on `v7/settings` (and at 390),
  `v7/settings-providers`, `v7/settings-connectors`, `v7/settings-connectors-for`, `v7/settings-local-api`, `kit/card`, `kit/kbd`,
  `kit/swatches`, `kit/dialog`, `kit/page`, `boards/settings`. Host: `cargo test -p boopis-dictation` (service) and `-p boopis-rules` here;
  `boopis-host` (its commands, `voice.rs`, the bindings) builds in CI only. Rules adjusted: none; one story allowance (`boards/settings`:
  board 14's nav 12 down and 8 in, and its ghost close 10 in, rule 7).
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
| 6a | The composer, completed in the kit for every composer (a session, a bot's chat, a room, the dock's card); S33, S37, S41's composer; S05 B's quick menu; the lead's dock decisions | Done at `ca44785a`. The kit Composer's own editing (`components/v7/compose.ts`): undo and redo across chips and marks, a chip as one unit, paste, a file dragged over it and dropped or pasted, the mic (a press, alt+V, held). A session's answer has the hover actions a bot's message has (the kit's one HoverBar). S33's line 0.00% (the effort and the model changed from the composer's line; the cost in tokens, no price is held yet), S37 0.03% outside the orbs, S41's canvas and composer measured (its sidebar and title are 6b's). Under 900 px the branch and the context fold into the quick menu. The v6 composer and its mentions are deleted. Derived and shown to the owner: the drop state, listening, the effort in the model menu, the fold, a session answer's hover actions. Not verified here: the effort and the model line against a running engine; transcription (the live provider's dictation hears nothing: no host code exists for it); a paste of a file in the desktop web view |
| 6b | S41 whole (no sessions: the sidebar and the title); the model menu; the mic without a speech model; S36 the engine stopped; S38 the gate failed; the open work line against S10 | S41 matches (the chrome, the sidebar and the composer 0.00%; the canvas differs by "Import sessions", hidden until importing exists): "No sessions yet" under the switch and "+", the title "Sessions". A session's "who answers next" and the new session's model menu are the kit's list Menu (360, as S31 and S32 draw a list of names with descriptions; a cut description is whole in its tooltip). The mic is transcription (owner, above): the kit's Composer draws a dictation's states (the model being fetched, listening, the words arriving, an error with "Try again", no dictation in this build) from the events of `DataProvider.dictation`, which the host's transcription (`w33/transcription`) will send; the live provider's own line is untouched and still hears nothing. S36's line 0.00% in a session, and the same line under a bot's chat and a room (derived); "Start it again" is the host's `hermes_retry`. S38's card 0.00% / 0.01% on the kit's FilesCard in its check form; "Fix and retry" sends the ask as your next message (owner question), and the note says what the engine does (it puts the files back) where the board says nothing was written (owner question). The open work line is S10's (rows under its words, a glyph per kind, the board's words). Not verified here: the engine line and the gate card against a running engine that stopped or failed its gate. **Not done, left for the next step before 6c:** S40's details pane (the v6 panel `modules/session/right.ts` is unchanged and still carries its lab findings; the step's report lists its features one by one with a proposed place for each), the lab findings of the room's details pane and the small ones of step 6a's table, the session HoverBar over the last 8 px of a full-width bubble. Still v6 and shown by no screen: the card kind `ship` (`modules/cards`), kept until the cards module goes |
| 6c | S40 the session's details, replacing the v6 details panel; S24's Diff alone; what 6b left | **Done** (27 November). S40's pane matches (lab:board S40: the head, Session and Use 0.00%, dark and light; the chrome and the sidebar 0.00%). The right panel is the kit's Pane (`modules/session/details.ts`): the details with every row wired (the model, the effort and how careful open the menus the composer's line opens; the Context row opens its parts and "Compact conversation"; the Cost row changes the cap; Fork and Settle in the overflow, Pin hidden until it exists), Environment and Connectors kept as derived sections until step 7, and the diff a FilesCard opens (S24's Diff alone, each file a DiffView that folds). The agent's tasks are board 17's card of steps on the session's last turn; a session's output is a terminal Well at the end of its open work line. The model menus are S19's two-line rows; a failed step keeps its words. The v6 panel, its diff, its CSS, the collapsed strip and its story states are deleted; a mod's pane is a tab of the kit's Pane. Derived and shown to the owner: the context's parts, the cap menu, Environment and Connectors, the diff alone, the tasks card in a session, the room's details. Not compared with a board: S24 (its panel is 600 wide on the board, the kit's tools are 520: the cards are the board's, the width is the token's). Not verified here: the pane against a running engine. The dock's blank orbs on WebKitGTK (CI run 45765615125) were not reproduced in 13 full runs and 58 folds; the test now reports what a blank snapshot shows. Also in 6c: the lab's findings read by cause and fixed where they were defects (`5c03fd4d`); the model menus (the composer line's "who answers next" and the new session's) are the kit's option Menu, S19's two-line rows with the second line whole (`variant: 'options'`, 372; the list variant cuts a description where the row ends), each with its test; a failed step in the open work line keeps its words with "failed" and its time (`stepRows`, tested); the dock test's diagnostic (`3bbba2ab`); the mic's transcription merged (`e5f4c171`: local whisper.cpp, ADR-0059, tried on a recording on three systems, not on a real microphone). **Left for 6d:** the dock's blank orb on WebKitGTK (CI run 45765615125: nina and kai blank in the first snapshot after the asks fold; the next fix starts from the diagnostic `3bbba2ab` prints), plus the 6d row below |
| 6d | The dock's blank orb on WebKitGTK; form cards with fields | **Done** (27 November). The blank orbs were not the app's: WebKitWebDriver's screenshot is the view's last presented frame and can be the one from before the script that just ran (a square's colour read back stale 14 times in 60, 32 in 60 with the machine loaded, never in 80 after two animation frames); CI's blank nina and kai were such a snapshot (the row's band the picture from before the fold in all its pixels). `tests/e2e/dock_webkit.py` waits for two drawn frames before each snapshot and first checks that 24 snapshots follow the page (17 of 24 miss without the wait). The form card is the kit's AskCard block (the lead's design, derived): `modules/cards/form.ts` on `askCard({ variant: 'form' })`, every kind and state with its test (`form.test.ts`), the stories `cards/form-*` redrawn (dark and light), the v6 form markup and CSS deleted. A question with options in a session is S23's chips or K02-11's lettered rows (conflict 5 decided for sessions). Esc cancels (Deny for a permission); "Later" puts a form off. Kit additions, each derived: the AskCard's form variant, the Field's secret, hint and control, the OptionRow's check, Swatches, the Steps alone, a DiffView's body as a group. Not verified here: a form against a running engine; the forms in the store, connectors and first run are drawn on the kit (a v7 island on those v6 pages) and are restyled whole at steps 7 and 8 |
| 6e | Tasks handed to other models, a council, find, the `ship` card kind, edit-before-approve; an escalation, a failed turn, a teammate's ask, a routine's; rewind's sheet; a bot's proposed team change and its paused steps | **Done** (27 November). Nothing drawn in a session's thread or a room is v6 now but the v6 card kinds approval, blank and connector (the next row). Council (`modules/session/council.ts`), the tasks handed to other models (`children.ts`), find (`conversation.ts` with `find.ts`), the rewind's sheet (`s0.ts`) and the thread's own lines (`modules/cards/asks.ts`: escalation, failed turn, teammate, routine) are the kit's, as the lead decided (above); the v6 `ui.child` card, the council's CSS and the card kinds ship, teammate, escalation, error and schedule (and their CSS, stories and goldens) are deleted; the smoke's card-height check runs on a form. A bot's thread holds what the host keeps for the owner (`modules/bots/held.ts`, `host/live/held.ts`): the team plans it proposed (the kit's TeamPlan, O-B06's block, in an AskCard: Hold to apply, Change it, Later; applied with Undo, changes asked, expired, failed) and its steps a rule paused (Hold to allow once, Always allow behind `approval-rules`, Deny). A bot's approval card now answers Allow all this turn and Always allow (they did nothing), its receipts are 6d's ("You allowed it always · exception drafted" once the host kept a draft, with Open behind `rules-settings`), and Edit is built behind `approval-edit`, which no provider has: the engine's `approval.respond` takes only the choice (approval-surfaces.md 7). Kit additions, each with its story: TeamPlan, FindBar, MarkStack (in TurnFoot's `marks`), the ToolRow's `row`, `wordTone`, `wordTip`, `end`, `after` and empty `icon`, the FilesCard row's `word` and head `title` and the check's `live`, the Menu's `foot`, the SystemLine's `word`, the Well's `thread`, a Dialog action's `disabled` with `tip`, a ghost answer, the TurnFoot action's `aria-disabled`, the chevron-up glyph, the tokens `--find-hit`, `--find-hit-now`, `--find-w`, `--well-thread-h`. **Not wired:** the room's hand-off row (the room has no hand-off event: COVERAGE conflict 4, an owner question). Not verified here: any of it against a running engine or host (a council, a child's transcript, a plan applied, a parked step re-run) |
| 6f | The v6 card kinds left: approval, blank and connector (a connector asked for in a thread, the dock's compact and mini sizes); the room's hand-off row once the room has an event for it; the lead's council fix; the lab's blocking findings | **Done** (27 November). The three v6 kinds were drawn by no screen any more (a bot's approval has been the room's and the dock's AskCard since steps 1 and 5, a session's approval its approval-shaped form, a session's blank the AskCard question with the kit's Mark since step 4, a connector's sign-in the form kinds `signin` and `connector` since 6d): their kinds, markup, CSS, the queue, the blank's popover and option group, the names' fitting, the fixtures, the stories `cards/approval`, `cards/blank`, `cards/connector`, `composer/blank` and their goldens, and the library's v6 blank (`ui.blank`) are deleted. `modules/cards/` keeps the `<hx-card>` host (now the form's alone: `KINDS = { form }`), the form (`form.ts`, `form-model.ts`, `forms-host.ts`), the thread's own lines (`asks.ts`) and what they read (`parts.ts`: the origin, the countdown, and the config diff's well a bot's settings show). **Kept** from v6: every job (allow once with the hold, deny with x and esc, a countdown and its lapse with Ask again on a session's ask, the receipts, one answer shared by every copy of an ask, the attention count without mirrors, F8's targets, a blank's options and your own words, a sign-in's needed, waiting, signed in and failed); **changed**: the look (the kit's AskCard and Mark), a bot's approval never lapses (as since step 1); **lost**: the approval queue with its peeking cards and "3 decided" summary (no screen used it since step 5's dock), the blank's number keys 1 to 9 and its popover under the gap (the session's blank has been the AskCard question since step 4), a teammate's accent tint on a card, the v6 one-row "mini" cards (a form's one row is the AskCard's answered row). The lead's council fix: a model's name is words (the kit's ToolRow `text`): the council's head and members and a task handed to another model are in the regular face; a running row's name, which vanished under reduced motion, now reads (kit fix). **The hand-off row is wired**: the engine's `room.assignment` (the room's lead giving the user's message to members, until now a plain line) is carried as `GroupNote.handoff` and drawn as the kit's SystemLine hand-off (the lead's orb, a chevron, the member, or the members stacked: derived); the lead keeping it stays a plain line (COVERAGE conflict 4 closed). The lab: see Health, 6f. Kit additions, each with its story: the ToolRow's `text`, the SystemLine hand-off's several receivers, the `k7-search-pill__label`, the Menu foot's group. Not verified here: the hand-off against a running engine room; the dock at 390 and the bots settings sheet (below) |
| 7a | 14, S39 (S04, S33, O-B07, 11): Settings on the kit, every page working | **Done** (27 November). The Settings dialog is the kit's large Dialog (`modules/settings`): S39's nav with board 14's icons (General, Sessions, Bots, Models, Approvals, Connectors, Appearance, Keyboard, Diagnostics last), a page hidden where its feature is absent (Approvals without `rules-v1`, Diagnostics outside the desktop app), each page the kit's Page with its title, section heads and settings Cards. lab:board 14: the page's title and Layout 0.37% / 0.36%, the nav 1.94% (S39's order: Sessions and Bots); S39: the nav 0.00%, the head (title and This device / This project) 1.07%. **General** (14's rows; Rail size, Show search and Search shows as are built: the rail's width and the chrome's search follow them), Under the composer (the line's items as checks, the quick menu's names), Appearance (Theme with Follow system, Accent from P1's candidates, Corners), Dock, Window, Local API. **Sessions**: This device's How careful (the launch row's default); This project's "No engine plugins and no plugin hooks" (moved from the details pane). **Bots**: each bot's cap and rule in a line, opening its own settings (no default exists to set). **Models**: today's tab on the kit (plan, governed mode, the ladder as rows, Providers, Change models) and Voice and speech. **Approvals**: the rules list (the lead's design above), `rules-settings` on with `rules-v1`, "Open" on 6e's receipt lands on the drafts. **Connectors**: today's tab on the kit (installed with state, switch, Test, Sign in, Remove; the collection with Add; a URL, a command, the store; for a bot). **Keyboard**: the keymap read only as key chips. **Diagnostics**: GPU, renderer report, Measure frames, the WebKit GPU page. Host: `dictation_model`, `dictation_model_fetch`, `dictation_model_delete`, `rules_discard_outside`, `voice_settings_get`, `voice_settings_set` (keys through the existing `secret_set`). Lost: v6's theme customizer (presets, fonts, case, density, colour editing, contrast, JSON: they changed only v6 tokens). Also: the bots sheet's run-limit story names the kit's Menu (its menu opened; the lab looked for v6's), a long name in the dock card stays on its line (pages/window at 390). Not verified here: any of it against a running host (the host commands build in CI only); talking itself has no release |
| 7b | 15: Store, the full Connectors page, the palette, the dialogs; what 7a left: the v6 menus' key chips a pixel under their corner; the store's v6 search field and item rows; the forms on the store and connectors pages (the kit's block on a v6 page); the session pane's Environment and per-session connector switches (kept in the pane: Settings has no session); the shortcut sheet (mod+/) still v6 | |
| 8 | O-*: onboarding, the one continuous first run | |
| 9 | Lab rules and goldens reconciled with the boards; full CI green | |
