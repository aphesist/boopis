# boopis launch film: the storyboard

For the owner's approval before any scene is animated. Built from `script/script.md` and `script/beats.json` (master
16:9, 46.93 s, 22 bars at 112.5 BPM, 19 beats) and `script/cutdowns.md` (9:16), in the look of `look.md`.

- **Board sheets:** `board.jpg` (16:9, every beat's key frame, both end-card variants) and `board-vertical.jpg` (the same
  beats recomposed for 9:16).
- **Key frames:** `board/<beat>.jpg` and `board/<beat>-vertical.jpg`, rendered at 3840 x 2160 (and 2160 x 3840) from the
  HTML pages in the repo (`media/launch/look/board/`), drawn with the product's own tokens and kit. Each is the beat's
  most telling instant; its time is given below.
- **Units.** 1 beat = 32 f at 60 fps = 0.533 s; 1 bar = 4 beats. `bar.beat` as in the script (`1.1` = 0 s). "+n" is n
  beats after the beat's first frame. A move "lands on" a beat: it starts its length before it.
- **Curves** (look.md section 8): arrive `(.16,1,.3,1)`, travel `(.83,0,.17,1)`, snap `(.87,0,.13,1)` with 180°
  blur, depart `(.5,0,.75,0)`; springs settle 300/30, camera 170/26, character 400/22 (orbs and the logo only). The
  product's own UI moves on its own tokens (`--ease`, `--spring`, `--dur-*`, the dock's critically damped springs).
- **Layers** in every beat: G ground (the lamp, 0.3x the camera), S stage (plates, orbs, film lines, 1x), F foreground
  (cursor, a passing chip, 1.2 to 1.4x).

## Decisions this board takes on the script (for the owner)

1. **The light is the card stock's tone, not brass.** The script asks for a brass pool; the brand keeps brass for "you
   are here" only and never as a large fill (look.md section 1). The lamp is `--bg-4`/`--bg-3` in a radial; for the
   escalation it "cools" toward `color-mix(--text 9%, --bg-2)`; in B15 and B16 it warms toward red (`--red` 13% into
   `--bg-3`), the film's only red light.
2. **UI scale has a floor of 2.6x wherever the product's 11 px mono must be read** (call numbers, "You 14:02", the
   model route): 11 x 2.6 = 28.6 px. The script's 2.2x room would set them at 24 px. Rooms are drawn at 3x where the
   framing allows (B04 to B06), 2.6x in 9:16 and in the session (B09, B10); cards and buttons at 2.4x (their 13 to 14
   px text lands at 31 to 34 px).
3. **The failed `npm test` row is not red** (B10). The product draws a failed step with a hollow mark and quiet meta,
   and a governed failure that escalates by itself owes the user nothing, so the stamp rule keeps red for B15. The
   script's red "failed" would be the film inventing a product state. Owner may overrule.
4. **The approval card is static markup** of the card layer's own render (card.ts regions, kinds.ts approval,
   parts.ts head, well and foot): the live card element needs the app's data provider. It shows no expiry and no cost.
5. **The composer's mic stays** (the product's own composer, as the script says), never pressed, never in a close-up.
6. **End card (B19): variant (b), the owner's decision** (decisions.md 2): the wordmark, with the tagline set as its own
   line under it, and the platforms. No address and no handle anywhere; the other variant is gone from the board. Brand rule: the wordmark has **no tagline lockup** (DESIGN-SYSTEM
   12, logo README). In (b) the tagline sits far outside the protection area, in the second-line style, never sized or
   aligned to the wordmark as a unit; if the owner reads that as a lockup, (b) becomes the wordmark and the platforms
   only (the style frame `08-end`).
7. **The wordmark is drawn in `--text-strong` (#f6f2ea), not #ffffff**: the logo takes the ink of its surface (logo
   README, "One colour"), and the film's ink is the product's warm white. One colour either way.
8. **No other bot and no other name.** Only kai, nina, moss and vox appear; the room is "release". Nothing from the
   app's mock data or screenshots is shown: no user name (the sidebar foot is a grey disc and a bar), no other project
   (session rows are bars), nothing from the playtest.

## Transitions: from, to, and the move

| # | From (state) | To (state) | The move |
|---|---|---|---|
| B01→B02 | the claim set over kai and nina, both turned to camera | the four sign-in buttons fanning out of a point | T2: the camera dives into kai's left eye (24 f, snap, blurred); its dark interior fills the frame and becomes the ground; the buttons fan out of the eye's centre |
| B02→B03 | four sign-in buttons in a column | four cast cards with orbs asleep | T8: each button's shell resizes into a card (travel 32 f, 4 f stagger); the label slides left and blurs out; the lab mark rides untouched into the plan line; a circular mask opens in the label's old slot to uncover the orb |
| B03→B04 | four cards, eyes open | the room's head stack, the room assembling | T1: each card collapses into its orb (text slides under and is masked, corners pull in); the four orbs travel up-left on arcs (30 f, 3 f stagger) and overlap into the head's stack, never redrawn |
| B04→B05 | your request and kai thinking (presence) | kai's reply, the camera lower | the room's own rule: kai's reply takes the presence entry's place, landing whole (blocks rise 6 px in turn); the camera follows the thread down on the camera spring, the head leaves the top |
| B05→B06 | kai's hand-off, the presence line under it | the live huddle, open | nina's reply lands above the presence (the presence never moves); moss's lands and the two gather into one huddle entry (container resize at `--dur-3`); the film line swaps in place |
| B06→B07 | the huddle open, three messages | the huddle folded, the camera close | you send; on the same frame the disclosure closes, the body's height animates to zero and the compact messages slide up under the head and are masked (filed away, as in style frame 04); the camera pushes in until the label is 44 px |
| B07→B08 | the folded line, close | the whole boopis window | pull back (travel 32 f) from the line to the window at 86% of the width; the window's plate, shadow and top light arrive with the scale, never a fade |
| B08→B09 | the window, Bots tab | your session, its composer close | the cursor clicks Session in the tabs pill; the thumb slides (`--dur-slide`, `--spring`), the room slides 48 px left as the session slides in; the composer stays put and morphs (member chips fold away, the Governed chip arrives, `--dur-3`); the camera pushes into it |
| B09→B10 | Sol answering, Sol current | Astra answering, Astra current | rows keep rising (U3, 8 px, 3 f apart); the failed row; the ladder's brass marker travels down from Sol to Astra (travel 16 f) while the call number's second line slides out from under the first |
| B10→B11 | the answer, close | three plates on the ground | the one slow move: pull back for 4 beats on travel; Bots clicked on the way; past the window's edges the terminal (left, behind) and the nameless app (right, in front) come into frame; the lamp cools |
| B11→B12 | three plates, wide | the terminal, close | the camera eases onto the terminal on the camera spring until it fills the left 55% |
| B12→B13 | the command typed | the run printing beside the open room | Enter on the downbeat (the drop); the camera widens (travel 24 f) to frame the terminal and the room together; each block lands on a half-beat in both |
| B13→B14 | terminal and room | the dock and the nameless app | the camera glides right and down on the camera spring; a click on nina's orb in the dock: the orb pokes, the slab's outline morphs up on its springs, the orb travels to the session head |
| B14→B15 | your message typed in the other app | the message in boopis as yours, the approval card | the message leaves the other app's field and appears in the dock session on the same frame; nina's reply streams in both at once; the card rises (height at `--dur-3`); the lamp warms red |
| B15→B16 | the dock session with the card | the hold button, close | the camera pushes in on the camera spring until the hold button fills about 60% of the width (vector, final size) |
| B16→B17 | the hold complete | nina, happy, alone | a smash cut on the downbeat (T3) to the medium shot: the receipt "Approved at 14:09", nina happy, "Approved" in the other app; then T7: everything but nina blurs 0 to 24 px and darkens 10% while the camera pushes into her |
| B17→B18 | nina, happy, under the tagline | the wordmark arriving | her triangle shrinks away behind her eyes (an opaque shape scaling down, never an opacity ramp); her eyes morph from the happy arcs into the logo's ovals (the logo's 0.38 s morph) and turn to light ink; the letters spring in around them |
| B18→B19 | the wordmark settling | the end card | the wordmark stays; the two lines rise under it (K1) once it has settled |
| B19→B01 | the end card | frame 0 | the autoplay loop cuts to frame 0: the same family, a centred pair of eyes and faces with one line of type |

## The beats

Each entry: the key frame (its time), the layers, the moves in beats, and what must stay true.

### B01 The hook · 0.000 to 2.667 · 1.1 to 2.2 · 5 beats
- **Key frame (1.0 s):** "[Claude] Claude and [ChatGPT] GPT" over "Same group chat", "Same" in the brass selection
  with its caret; kai under "Claude", nina under "GPT", looking at each other. Frame 0 is the same with line 2 not yet
  risen: it is the thumbnail.
- **Layers:** G lamp under the orbs (`--bg-4`, 70% down); S the two lines (96 px), the orbs (260 px) with their
  contact shadows; F none.
- **Moves:** +1 line 2 rises (K1, lands ~+1.9); +2 kai's speaking face toward nina (character spring); +3 nina
  answers; +4 both turn to camera (gaze capped .30/.20 rad); +4.25 the dive into kai's eye (24 f, snap). Camera push
  2% a second throughout.
- **True:** the labs' sign-in marks unrecoloured (Claude #D97757, ChatGPT white); orbs placed under their lab's word,
  measured from the set line.

### B02 The promise · 2.667 to 5.067 · 2.2 to 3.2.5 · 4.5 beats
- **Key frame (4.4 s):** "Bring the plans you already pay for" over the app's four sign-in buttons (`ui.signinButton`
  at 2.4x, equal width, in the app's order: ChatGPT, GitHub, Claude, xAI).
- **Layers:** G lamp (`--bg-3`); S line (92 px) and column; F none.
- **Moves:** +0 the buttons fan out of the eye's point (each from 60% scale, travel 24 f, 3 f stagger, settle spring);
  +0 the line rises (lands +1.4, holds to +4.3).
- **True:** the marks are the labs' files, never morphed or recoloured, here or in B03.

### B03 The cast · 5.067 to 7.467 · 3.2.5 to 4.3 · 4.5 beats
- **Key frame (6.0 s):** the four cards (880 x 150, `--bg-3`, hairline): nina / deploys / ChatGPT subscription; moss
  / flaky test hunter / GitHub Copilot subscription; kai / docs and changelog / Claude subscription; vox / release
  notes / SuperGrok subscription. Eyes opening card by card: nina and moss awake, kai and vox still asleep.
- **Layers:** G lamp; S line "Make each one a bot in boopis" (92 px, "bot" selected), the cards; F none.
- **Moves:** +0 shells become cards (travel 32 f, 4 f stagger); text rises 4 f after its container; +1.5 to +2 the
  eyes open on sixteenths, asleep to idle, each orb glancing at the next as it wakes; +2.5 vox blinks; +3.5 to +4.5
  the cards collapse into their orbs.
- **True:** names, roles and plan labels as the app ships them (cast.md).

### B04 The room: you ask once · 7.467 to 9.600 · 4.3 to 5.3 · 4 beats
- **Key frame (9.3 s):** the room "release": the head (the kit's stack at 32, the name, "kai, nina, moss and vox", its
  actions), your request "@kai is it ready to cut?" (You 14:02), the presence entry "kai thinking" (its clock a bar,
  no digits), the composer with the four member chips; the cursor just off the send button. 3x.
- **Layers:** G lamp; S the room plate (bleeds three edges), head, entries, composer; F the cursor.
- **Moves:** +0 the name rises beside the stack; the composer rises from the bottom (arrive 30 f); +0.5 the cursor
  arcs in, clicks at +1; +1 to +2.7 the line types (K2, 28 cps), "@kai" becomes a chip as the handle completes; +3 send
  (press .96), the line lifts into the thread as your request (travel 20 f); +3 the presence rises (`--dur-2`, 6 px).
- **True:** no empty thread plate; the presence words are the kit's.

### B05 They hand work on · 9.600 to 12.267 · 5.3 to 6.4 · 5 beats
- **Key frame (11.2 s):** kai's reply landed whole: "Almost. [moss] is the suite stable? [nina] is staging free?",
  "to moss and nina", 14:02; the film line "They hand work to each other" in the ground above it, aligned to the
  measure; the presence line "moss is in the terminal, nina is reading a file"; the composer below. 3x.
- **Layers:** G lamp; S plate, entries, line; F none.
- **Moves:** +0 the reply's blocks rise 6 px in turn, kai's orb plays speaking then settles; +1 the line rises (lands
  +2.25, holds to +4.5); +2 the presence returns: moss's orb, nina's 60 ms later, growing in beside it (moss glances
  at her). Camera follows on the camera spring, 5 f lag.
- **True:** room replies arrive whole, never streamed.

### B06 They work it out · 12.267 to 14.933 · 6.4 to 8.1 · 5 beats
- **Key frame (14.5 s):** the live huddle, open: "nina, moss and kai worked it out, 3 messages", "between themselves",
  14:03 to 14:05, and on its spine nina's "Staging is free and matches production.", moss's "Green on every run since
  Monday.", kai's "Then it's ready to cut." Film line "They work it out" above. 3x.
- **Moves:** +1 nina's reply lands above the presence (which drops to moss alone); +3 moss's lands and the two gather
  into the huddle (resize `--dur-3`); +4 kai's compact message lands, the head line updates in place; +4.5 the presence
  fades and shrinks out (`--dur-out`).
- **True:** the label is the product's format, members in order of their first message.

### B07 The fold (the moment) · 14.933 to 17.867 · 8.1 to 9.2.5 · 5.5 beats
- **Key frame (17.0 s):** the folded entry alone, close (3.4x, the label 44 px): three stacked orbs (still, as every
  16 px orb is), "between themselves", "14:03 to 14:05", "nina, moss and kai worked it out, 3 messages"; your "@nina
  stage it next" (You 14:05) under it.
- **Moves:** +0 you type (K2); +2 send: on the same frame the huddle folds (disclosure closes, body to zero at
  `--dur-3` on `--ease`, compact messages slide up under the head, masked); the film line exits; +2 to +3 the camera
  pushes in (27 f); +3 to +5.5 hold, drifting 2% a second.
- **True:** the huddle folds because you wrote again, the app's own rule.

### B08 To your own session · 17.867 to 20.000 · 9.2.5 to 10.2.5 · 4 beats
- **Key frame (18.5 s):** the whole boopis window at 86% of the width, an establishing frame with no readable words:
  its own title bar (the two-eye mark, sidebar toggle, back and forward, the search pill, minimise, maximise, close),
  the sidebar (tabs pill on Bots, New bot, the four bots, the group, the foot a grey disc and a bar), the room as bars,
  the dock (black, four orbs, "+"); the cursor arriving at the tabs pill.
- **Moves:** +0 to +1 pull back (travel 32 f); +1 to +2.5 the cursor arcs to the pill, clicks Session at +2.5; the
  thumb slides, the room slides out left, the session in; the composer morphs (chips fold, Governed arrives); +3 to +4
  the camera pushes into the composer (2.4x).
- **True:** never macOS chrome; session rows are bars (no project names).

### B09 The cheaper one tries first · 20.000 to 22.933 · 10.2.5 to 11.4 · 5.5 beats
- **Key frame (22.5 s):** your request "fix the proration drift in src/billing" (You 14:06); the answer's call number
  "[OpenAI] GPT-6.2 Sol" with two steps; the right panel's Governance section (the list ladder: Sol, current in brass,
  then Astra); the film line "The cheaper one tries first" anchored above the ladder; the composer with its Governed
  chip. 2.6x.
- **Layers:** G lamp (`--bg-3`); S the session plate, the panel plate (`--bg-1`), the line; F none.
- **Moves:** +0 to +2.5 the request types (30 cps, no underlines); +2.5 send; +2.5 the answer starts and the panel's
  section slides in from the right edge, its head flashing `--brass-soft` once; +3 and +3.5 rows rise; +3.5 the line
  rises (lands +4.6, holds into B10).
- **True:** a main-window session on the ChatGPT plan (ladder Sol then Astra, ADR-0037), never a bot; no spend, cap or
  elapsed time; no feedforward.

### B10 A failed test buys the next rung · 22.933 to 25.600 · 11.4 to 13.1 · 5 beats
- **Key frame (24.7 s):** six steps: the two before, "npm test" failed invoice.test.ts (hollow fail mark), "Rolled back
  invoice.ts and escalated to GPT-6.2 Astra" (Governance, after a failed gate), "Rounded once per invoice", "npm test"
  passed; the call number "GPT-6.2 Sol → GPT-6.2 Astra"; the ladder's brass on Astra; the lamp cooling.
- **Moves:** +0 the failed row; +1 the rollback row, a strip of added lines (bars) folding back into the originals in
  12 f; +1.5 the brass marker travels Sol to Astra (16 f) and the route's second line slides out; +2 and +3 the next
  rows; +4.25 the line exits.
- **True:** only a failed gate buys the next rung; the meta stays the product's quiet (decision 3).

### B11 The breath (the slow move) · 25.600 to 27.733 · 13.1 to 14.1 · 4 beats
- **Key frame (27.0 s):** three plates on the ground: a terminal behind on the left (a thin strip, a prompt, nothing
  named), the boopis window (Bots, the room as bars), the small nameless app in front at the lower right (a message
  list and one field, no title, no icon, no name); the lamp cool.
- **Moves:** one move for 4 beats on travel, no cut: +0 to +1 back to the whole window; +1 Bots clicked, the room
  returns with nina's reply that landed while away; +1 to +4 the pull back keeps going past the window's edges.
- **True:** the other app is "another app on your desktop", nothing more.

### B12 The whole team, from a terminal · 27.733 to 29.867 · 14.1 to 15.1 · 4 beats
- **Key frame (29.4 s):** the terminal fills the left 55%: `$ boopis run --group release "write the release notes"`,
  the caret at rest; the window soft behind on the right; the film line "The whole team, from a terminal" at the top.
- **Moves:** +0 the camera eases onto the terminal (camera spring); +0.25 to +3.2 the command types (30 cps); +0 the
  line rises (lands +1.25, holds to +3.5); Enter lands on 15.1 (the drop).
- **True:** the command as `docs/CLI.md` writes it.

### B13 The run, live in the open room · 29.867 to 32.000 · 15.1 to 16.1 · 4 beats
- **Key frame (31.3 s):** the run printed in the CLI's plain format ([14:07:41] kai / @vox draft them from the merged
  changes. [14:07:58] vox / The draft is in CHANGELOG.md. [14:08:16] kai / Read it. Tightened the fixes section.
  -- done: the bots stopped handing off after 3 rounds), and on the right the open room at 2.6x with the same messages,
  vox's and kai's gathered into a live huddle ("vox and kai worked it out, 2 messages").
- **Moves:** +0 the camera widens (travel 24 f); blocks land on half-beats (+0.5, +1.5, +2), each landing in the room
  on the same frame; +2.5 the done line, the prompt returns. The clock stamps advance: compressed time shown as
  compressed.
- **True:** open question 2 in the script (a live build confirms the room updates).

### B14 Same thread, from your other apps · 32.000 to 34.667 · 16.1 to 17.2 · 5 beats
- **Key frame (34.5 s):** nina's session open in the dock (the slab grown up from the bottom edge: her orb at the
  head, her own chat's older messages as bars, a compact composer); the nameless app at the right with "nina, go ahead
  with staging" typed and the cursor in its field; the film line "Same thread, from your other apps".
- **Moves:** +0.5 to +1.5 the camera glides to the dock and the app; +1.5 the line rises (lands +2.75); +2 one click
  on nina's orb: a poke, the slab's outline morphs up on its springs, the orb travels to the session head (40); +2.6
  the cursor to the app's field; +3.2 to +4.9 the message types; +5 send.
- **True:** the dock session shows nina's own chat, not the room.

### B15 Nothing ships until you hold · 34.667 to 36.800 · 17.2 to 18.2 · 4 beats
- **Key frame (36.4 s):** the dock session: your "nina, go ahead with staging" (You 14:09), nina's "Ready. Deploying
  needs your approval.", the compact approval card (red hairline, "needs you" stamp, "nina wants to deploy to
  staging", the well "staging invoices-api", Deny and Hold to approve); nina's head orb on the needs face with the
  flag; the other app listing the same thread and "nina needs your approval"; the line "Nothing ships until you hold";
  the lamp warm with red.
- **Moves:** +0 the message appears in both places on the same frame; +0.5 to +1.75 nina's reply streams in both in
  sync (her own chat streams; room replies do not); +2 the card rises (`--dur-3`), the face turns, the other app's row
  appears; +2 the line swaps (lands +3.1, holds through the hold).
- **True:** the card has no expiry and no cost line; red appears because something is owed.

### B16 The hold · 36.800 to 39.467 · 18.2 to 19.3 · 5 beats
- **Key frame (37.9 s):** inside the dock card, close: the hold button at about 60% of the width, half held: the
  ordered 4 x 4 dot field gathering at the leading edge and fusing into the bone fill, the label inverting where the
  fill has passed, the cursor pressed (0.85).
- **Moves:** +0 to +1 the camera pushes in (camera spring); +0.75 the cursor arrives, dips 4 f, presses at +1.1;
  exactly 60 f of fill (the product's 1000 ms, `--dur-hold`); +3 complete: smash cut on 19.1 to the medium shot (the
  card receded, its foot the receipt "Approved at 14:09", nina happy, "Approved" in the other app); +3 to +5 hold with
  drift.
- **True:** the hold is the product's own fill (Bayer 4 x 4 on a 3 px grid, scaled with the camera).

### B17 The tagline · 39.467 to 42.133 · 19.3 to 20.4 · 5 beats
- **Key frame (40.8 s):** nina (360 px, happy, lower third) glancing up at "Your AI plans, on one team" ("team"
  selected); the desktop behind blurred 24 px and darkened 10%, become the ground.
- **Moves:** +0 to +1 T7 focus pull (one layer always opaque); +1 the tagline rises (96 px, lands +2.25, holds to
  +4.5, exits).
- **True:** a claim, not a slogan; no lockup with the mark that follows.

### B18 The eyes become the wordmark · 42.133 to 43.733 · 20.4 to 21.3 · 3 beats
- **Key frame (42.5 s):** mid-morph: nina's body shrunk behind her eyes, the eyes already the logo's two ovals in light
  ink, b and p landed, the i's dot hopping, the s still arriving.
- **Moves:** +0 to +0.75 the body scales down behind the eyes (opaque); the eyes morph arcs to ovals (0.38 s) and to
  light ink; +0.5 to +1.5 the letters spring in (`letters="play"`: squash, hop, 48 ms stagger, the dot's own bounce);
  settled by +2. The music stops at 21.1.
- **True:** one colour, nothing in the protection area (56 px at a 200 px type size).

### B19 Where to get it · 43.733 to 46.933 · 21.3 to 23.1 · 6 beats
- **Key frame (45.3 s), variant (b):** the wordmark, "Your AI plans, on one team" (52 px, its own line), "For Linux,
  and early on Windows" (40 px, quiet). See decision 6.
- **Moves:** +0 the lines rise (K1, land +1.25); hold with drift 1.5% a second; the live eyes glance once (+3) and blink
  once (+5).
- **True:** no Mac, no store badges, no counts, no "free" (the script keeps it for the post copy).

## 9:16

`board-vertical.jpg` recomposes every beat inside the safe band (y 220 to 1640), as `cutdowns.md` section 2 and look.md
section 7 set out: film lines at 96 to 104 px in two lines broken by sense; rooms and the session in the product's own
narrow layout (each call number folded above its message) at 2.6x, the room's composer closing the column; the
window cropped to the sidebar's tabs pill and the composer (B08); the three plates stacked (B11); terminal above, room
below (B12, B13); the dock session in the middle band with the other app below it (B14, B15); the hold at 90% of the
width (B16); nina at 420 px (B17); the wordmark at a 170 px type size (B18, B19). In 9:16 the session's Governance
section sits under the steps, the window being narrower than its right panel. The 9:16 presence pill of B06 (the
room scrolled away) is style frame `06-pill`.

## How the key frames are made

`media/launch/look/board/<beat>.html` (and `-vertical`) mount the scene builders in `media/launch/look/src/scenes/`
(hook, room, session, desk, close; shared pieces in `parts.ts`) with the real kit from `apps/desktop/ui`. Render with
`node media/launch/look/render.mjs --dir board --check` (1x, with the 28 px check; every key frame passes, the smallest
text on the board is 28 px) or `--scale 2` for these copies. Each builder states its key frame's instant in its comment,
so an animator can start the scene from the same composition.
