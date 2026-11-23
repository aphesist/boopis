# boopis onboarding and setup, in v7 (revision 2)

Status: **revision 2, batch 1 of 2** (23 Nov 2026). The owner's picks on revision 1 are recorded and the structure is redesigned for them; batch 2 adds the full screens, every clip and the contact sheet. Invariant 8: the owner designs the UI. Nothing here is built.

Renders are in the scratchpad folder `onboarding-v2/`: `boards/`, `screens/` (1440 x 900 at 2x, dark and light), `motion/` (1280 x 800, 60 fps MP4, each with a reduced-motion version and a frame strip). They are drawn by `src/` in this folder: revision 2's files are `ob2-*.js`, `ob2.css`, `ob2.html`, `ob2-motion.html`, `rec2.cjs` (the 60 fps recorder), `qa2.cjs` (the render QA, with the wider sweep rule), `flicker2.py` (the frame check) and `mkjobs2.py` (the render list); revision 1's files stay beside them, because revision 2 reuses its product cards. They run beside v7's render source (`kit.css`, `kit.js`, the screen builders and `lib/`, with the real `<orb-avatar>` and `<boopis-logo>`).

## The owner's decisions on revision 1 (23 Nov)

| | Decision | What it changes |
|---|---|---|
| **O01** | **B, one onboarding per tab.** Each tab runs its own onboarding the first time it opens. The shared setup (the model, feedforward's Try it) is never asked twice: whichever tab runs first asks it, and the other skips what is answered. | The structure below. Revision 1's shared intro and "Where to start" are gone. |
| **O02** | **A**, the approval rules are walked through in the Bots onboarding. | O-B09, unchanged from revision 1's O17. |
| **O03** | **"Closer to B"**, Grok's tiles for the goal picker, as an onboarding-only component. | The goal tiles, O-B04. |
| **O04** | **A, the app speaks**, but not as a static ball: the boopis logomark, its two o's as eyes, "moving vividly, as if it was a bot, looking around". | The speaker. |
| **C01** | Approved (the Page's intro variant, the Scene), with **much more animation**: "closer to grokbot's level of UI smoothness. Our bots are static, they don't look to the sides at all, don't turn, don't bob their heads." | Every scene now moves; the clips are 60 fps. |
| **C02** | "It doesn't need to reuse anything, especially the animated parts." Onboarding may have its own animations, scenes and transitions. The static product UI on screen still follows v7 exactly. | The speaker's head, the tiles, the scenes and their transitions are onboarding's own. |
| Later | **No new bot character or motion system.** "We just need to apply our already existing animations more." | The bots in onboarding use orb2's existing behaviours only (below). |

## What onboarding must do

Unchanged from revision 1, except where the picks change it:

| Must | Source |
|---|---|
| Each tab explains itself the first time it opens, in its own surface | owner O01 B |
| The model inline, before the first real task, pre-selected from the sign-ins already on the computer (the Claude CLI, ChatGPT, keys), the top model of that lab chosen | owner decisions 5 and 6 |
| Feedforward on by default, with a live **Try it**: a real read when a model is connected, a labelled recording otherwise, ending in "Keep it on / Turn it off" | `w31/specs` feedforward.md 13 |
| The model and Try it asked **once**, by whichever tab runs first | owner O01 B |
| The session default step **asked**: the four rows, Auto-accept edits pre-selected; a project with no trusted gate falls back to Supervised | Session board S02 B |
| The approval rules walked through in plain language, in the Bots onboarding | owner decision 10, O02 A |
| Where the bots' computer lives: in a container here (recommended), a computer you own, a cloud server, directly here | owner decision 8 |
| Connectors optional, through the Store; reach: the dock, the island and notch, the phone, said honestly where they do not exist yet | owner decision 7 |
| Local first; zero tokens until real work (Try it's one read is on the ledger); no survey, no upsell; every step skippable, with a way back from Settings | Part C 3.0 |

**What setup has to finish** is today's (`apps/desktop/ui/src/host/first-run*.ts`, `src-tauri/src/setup/mod.rs` on `w29/integrate`): the boopis engine (install or update), the boopis plugin and the hx tool, the three engine settings boopis needs (required; "Not now" leaves them declined with Review again in Settings), models and keys, and the engine restart. Revision 2 keeps every step and gives them to the first tab that opens: the engine installs behind that tab's first page, and the consent is that tab's second step.

## The structure: one onboarding per tab (O01 B)

### The rule: one ledger, the shared setup asked once

`onboarding.json` in the profile home: `{ version: 2, tabs: { session: {step, done}, bots: {step, done} }, shared: { engine, consent, model, feedforward }, answers }`.

Each tab's onboarding is a list of steps. A **shared** step reads the ledger first: unanswered, the tab asks it in its own surface and writes the answer; answered, the tab shows one receipt line ("Already set in Sessions: Claude Opus; reading your drafts") and moves on. Whichever tab runs first asks; the other never does. Answers are written as they are given, so a person who leaves a tab halfway can open the other tab (it skips what is done) and come back to the first at the same step.

The window opens on Sessions after an install, as the app does today; switching to Bots at any point starts the Bots onboarding, which asks whatever shared step is still open.

### The flows

| When | Steps | To the first result |
|---|---|---|
| **Session first** | O-S01 Hello, O-S02 Settings boopis needs (shared), O-S03 Model (shared), O-S04 Try it (shared), O-S05 Add a folder, O-S06 How careful, O-S07 First task | about 1:40 |
| then **Bots, first open** | O-B01 Welcome to Bots, O-B02 The boopis bot, O-B03 Your team, O-B04 Goals (tiles), O-B05c the shared receipt, O-B06 Where bots work, O-B07 Your name, O-B08 A starter team, O-B09 The approval rules, O-B10 Build, O-B11 Reach, O-B12 First job | about 2:50 |
| **Bots first** | O-B01 Hello, O-B01c Settings boopis needs (shared), O-B02, O-B03, O-B04, O-B05a Model and O-B05b Try it (shared, in boopis's chat), O-B06 to O-B12 | about 3:30 |
| then **Sessions, first open** | O-S01 Welcome to Sessions, O-S05 with the shared receipts, O-S06, O-S07 | about 0:40 |

Times are for a person with a sign-in. Revision 1's A (one hybrid onboarding) and C (just in time) are retired; C's idea survives as the second tab's short path.

### Who speaks

The **speaker** (O04 A) is the logomark with a living head. It speaks on every page and in the Session tab's setup conversation, and it becomes the S41 mark when the session canvas opens (it travels into place: one pair of eyes the whole time). In the Bots tab its eyes drop into the boopis orb (O-B02), and from then on the **boopis bot** speaks in its chat: section 10's "logo given a body", shown literally once. When Bots runs first, the shared model and Try it are asked by the boopis bot in its chat, with the same cards.

## The screens (batch 1: three key frames; batch 2: all)

**O-S01 Hello** (`O-S01-hello`; `O-S01-second-welcome-to-sessions`). The Session tab's shell (the sidebar with its Sessions / Bots switch and "No sessions yet", the title pill "Sessions"), with the Page's intro variant in the main area: "Hi, I'm boopis", "Let's set up sessions: you and one agent, working on your code, step by step.", the speaker at the hero size in the scene, Let's start, and "Skip setup" bottom left. No composer and no dock while the page shows. The second-tab variant: "Welcome to Sessions", "Your model and draft reading are already set. Two questions, then you're working.", the speaker happy, Continue. While the engine still installs, the button gives way to the StatusLine "Getting boopis ready" with the percentage (revision 1's O03b). Clip O-M1.

**O-B03 Meet your team** (`O-B03-meet-your-team`). The Bots tab (the rail holds only boopis), Grok's "Give each bot a job" page: the boopis bot (72) and three bots (60) with their jobs (kai reviews pull requests, moss runs the tests at night, iris writes the release notes). At rest every bot looks at another one, with orb2's own `gaze`: kai at moss, moss at boopis, iris at kai, boopis at you. "Each bot has one job. They work on their own and ask you before anything risky." Next / Back; "Not now" bottom left. In the clip they wake one by one (batch 2).

**O-B04 Goals** (`O-B04-goals-tiles`). The goal tiles on a full-window page of the Bots tab: "What should your bots work on first?", "Pick up to three. Each pick gets a bot.", 3 x 2 tiles (Code and reviews, Research and writing, Videos and posts, Data and reports, Inbox and calendar, Something else), Next / Back, Skip. The bots you just met orbit the heading as Grok's characters do, looking down at the tiles; picking a goal sends its bot into the tile. Writes: `answers.goals`, which picks the starter team (O-B08).

The other screens (O-S02 to O-S07, O-B01, O-B01c, O-B02, O-B05 to O-B12, resume, Settings, the errors, returning users) keep revision 1's content and logic, moved into the tab that owns them; they are drawn in batch 2.

## The speaker (O04 A, pushed further)

The base is the "oo" mark of DESIGN-SYSTEM.md 20.1. Onboarding gives it a head of its own (owner C02); everything here is onboarding only, and the everyday S41 mark keeps 20.1's calm idle.

**Two layers.**
- **Eyes**: the shipped `<boopis-logo mark>` with its own idle switched off (`gaze="off" blink="off"`). The speaker's director calls the element's `look(x, y)`, `blink()` and `morph(state)`, so every eye shape, the blink envelope (155 ms) and the morphs (380 ms) are the element's own, never redrawn.
- **Head**: a wrapper the eyes sit in (`.ob-spk-h`, transform origin 50% 62%). It travels, turns (`rotateY` in a perspective of 5.2 W, so the pair compresses toward the side it turns to and the far eye shrinks, as Grok's characters turn), nods (`rotateX`), tilts (`rotate`), bobs, hops, squashes and breathes. There is no body: the head is seen only through what the eyes do.

**Sizes.** W is the pair's width. Hero, on a page: type size 96, W = 111 px. Stage, above the setup conversation and as the S41 mark: type size 44, W = 51 px. Below 44 the mark is the still logo (the title pill, a receipt).

**Poses** (head travel in W; yaw, pitch, roll in degrees; the eyes' `look(x, y)`):

| Pose | x | y | yaw | pitch | roll | look | Use |
|---|---|---|---|---|---|---|---|
| rest | 0 | 0 | 0 | 0 | 0 | none | a page's still before it speaks |
| you | 0 | 0 | 0 | -4 | 0 | 0, -0.15 | speaking to the person: the home pose it returns to |
| down | 0 | 0.04 | 0 | -16 | 0 | 0, -1 | a card or the composer below it |
| downLeft / downRight | -/+0.06 | 0.04 | -/+14 | -14 | -/+3 | -/+0.6, -0.9 | reading a line with you |
| left / right | -/+0.2 | 0 | -/+34 | 0 | -/+2 | -/+1, 0 | a glance aside |
| upLeft / upRight | -/+0.12 | -0.04 | -/+20 | 12 | -/+5 | -/+0.8, 0.8 | thinking (Grok's working look is up and to the side) |
| tiltLeft / tiltRight | 0 | 0 | -/+6 | -6 | -/+9 | -/+0.3, -0.5 | listening while you type: the head cocked |
| turnLeft / turnRight | -/+0.3 | 0 | -/+60 | 0 | -/+3 | -/+1, 0.1 | a full turn to a thing beside it (the sidebar, a bot) |

**States** are the element's (the bots' own eye states): idle, happy (an answer: with a hop), listening (you type: with a tilt), thinking (up left), skeptic (a doubt: with a shake), sleeping (before it wakes).

**Behaviours** (the director, `src/ob2-speaker.js`):

| Behaviour | Spec |
|---|---|
| Look at a thing | the eyes first (the element's own easing), the head 60 ms later: 420 ms `--spring` |
| Turn | 520 ms on the onboarding turn ease, cubic-bezier(.45, 0, .2, 1) (NEW, onboarding only), with a blink as it starts: Grok blinks into its turns (`new-bot-character-picker.mp4` 4.9 s) |
| Bob (a line said) | 0.07 W up in 140 ms ease-out, down in 200 ms `--spring`, a landing squash of 4% over 160 ms: 500 ms |
| Hop (happy) | an anticipation squash (6%, 90 ms), up 0.14 to 0.22 W in 170 ms ease-out, down in 190 ms ease-in, a landing squash (7%, 180 ms): 640 ms |
| Stretch (waking) | 9% taller and 6% narrower over 380 ms sine, a spring back over 520 ms |
| Nod (yes) | 12 deg then 7, 520 ms |
| Shake (no, doubt, a fourth tile) | three swings of 10 deg, damped, 560 ms |
| Breath | 1.2% over 3.6 s, at the hero size only (none at 44 and under: small things hold still, ORBS.md T4) |
| Idle | glance and return (ORBS.md T2, Grok's pattern): a look aside every 1.4 to 2.8 s, held 0.7 to 1.5 s, then back to `you`; one in four a double glance (two looks 380 ms apart); a blink on half the turns over 20 deg, and the element's own cadence otherwise |
| Reduced motion | the head never moves (no travel, turn, bob, hop, breath); a look or a state change is a **dip**: the eyes fade out in 90 ms, change while hidden for 220 ms (the element's own cross-fade happens unseen), and fade back in 90 ms. A cross-fade would show two pairs of eyes at once; the dip reads as one slow blink |
| Stills | always at rest in a named pose: no breath, hop, blink or morph in flight (the sweep rule, below) |

Measured on Grok-Bot (`motion/`, 30 fps, frame by frame): a glance moves the eyes about 7% of the body's width in 330 to 500 ms, ease-out; a turn takes the eyes to 17% of the width and the body 7% sideways in about 470 ms (14 frames), with the body's breath at 4 to 8% over about 1 s; a blink is closed for 2 to 5 frames (70 to 170 ms) and snaps shut in one; a shape change is a Y turn of about 570 ms (17 frames) in which the body goes edge-on and the eyes slide to the side and shrink; in the group chat the main bot holds long looks up and to the side while it works, squashes on a hop, and switches to `^ ^` when done. Dialogs and popovers are near instant at 30 fps (one or two frames), as GROKBOT-DESIGN.md's 100 to 200 ms values say.

## The goal tiles (O03, onboarding only)

| | Spec |
|---|---|
| Grid | 3 x 2, tiles 212 x 104, gap 12 (Grok: 3 x 3 tiles of 160 x 77, gap 10; boopis has six goals and longer names) |
| Tile | the Card's surface (`--bg-3`, `--line`, `--shadow-inline` in light), radius `--r-card`, continuous corners, 14 inset |
| Icon | 16 px in a 28 px disc (`--fill-2`), top left on the 14 inset |
| Name | `--fs-l` 15/22, `--text`, one line, bottom left on the 14 inset |
| Hover | the surface plus 4% ink, `--dur-1` 120 ms |
| Chosen | a 2 px ring and a 10% tint in the colour of the bot that takes the goal (Grok: the bot's colour); the icon's disc gives way to that bot's orb, 28 px, orb2 as it is, with its own eye colour |
| Which bot | Code and reviews kai, Research and writing iris, Videos and posts nimbus, Data and reports moss, Inbox and calendar nina, Something else none (the disc stays) |
| Picks | up to three; a fourth press shakes the tile (10 deg, 560 ms) and the lede reads "Up to three. Unpick one first." |
| Keys and readers | arrows move, Space picks, Enter is Next; each tile is a checkbox ("Code and reviews, kai takes it, checked") |

It is not added to the kit and appears nowhere else; the AskCard stays for every in-chat question.

## The bots in onboarding: orb2's own behaviours, used generously

The owner's later decision: no new character system, apply the existing animations more. Onboarding's bots use only what orb2 (`<orb-avatar>`, the pinned vendored build) and boopis's helpers already have (`apps/desktop/ui/src/components/orb.ts`, `orb-runtime.ts`, `orb-worker/`), matched to `w31/bot-character` `docs/design/v7/character/ORBS.md` (e8c87cf1):

| Behaviour | orb2 | Onboarding uses it for |
|---|---|---|
| Wake | `wakeUp()`, the `wake` emote (1.5 s); `reaction` from sleeping | the team coming alive one by one (O-B03) |
| Look at a thing | `lookAt(x, y)` (yaw to ±1.18 rad), `gaze` for a held look | bots looking at each other, at the boopis bot, at the speaker, at the tile under the pointer, at the composer |
| Happy, done | `react('happy')`, `F_ARC` with a hop | a bot arriving in its tile, a bot made in Build |
| Blink | `blink()` | a bot noticing something; a bot that speaks |
| Bob | `poke(force)` with `react: false` (the jelly) | a bot landing in the rail or the dock |
| Turn | `spin('turntable')` | a bot turning to the next one as the team assembles |
| Curious, double take | `emote('curious')`, `emote('doubletake')` | a bot noticing the person's pick |
| Reduced motion | orb2 reduces and never freezes (`glance`, `lead` give small eye steps) | every bot under reduced motion |

Onboarding-only scene motion (entrances, the team assembling into the rail and the dock, the tiles taking a bot) is its own, and goes beyond the everyday surfaces without giving an orb a behaviour it lacks. **Would need new** (not built in): none so far. Batch 2 lists any that the clips would want. ORBS.md's clarity fixes (C1 to C3, the canvas snapping) and its optional `face-scale` 1.25 (C4) are the kit's; onboarding draws orbs with the kit's `orb()`, so it follows them with no change once the owner takes them.

## Motion spec (batch 1: the speaker; batch 2 completes it)

Every value is a v7 token (`tokens.v7.json`, 9.2), an element's own constant (orb2, `<boopis-logo>`), or the speaker's above. One easing is NEW and onboarding only: the turn ease, cubic-bezier(.45, 0, .2, 1).

| Moment | What moves | Duration and easing | Reduced motion |
|---|---|---|---|
| Page words | heading, then lede (60 later), then actions: opacity and 4 px up | `--dur-2` 200, `--ease-sharp` | opacity only, 150 |
| The speaker wakes (O-S01, O-B01) | asleep: the element's sleeping eyes, the head dropped (pitch -10, 0.05 W down, roll -3). At 1.2 s `morph(idle)`, the stretch, the head to rest (620 ms `--spring`); a double blink (360 and 570 ms after); then it looks around: left (2.15 s, 420 ms), a long sweep right (2.9 s, 560 ms turn ease), up left (3.55 s, 380 ms), a full turn to the Sessions / Bots switch (4.05 s, 520 ms, with a blink); it finds you (4.8 s: `you`, a hop of 0.14 W, `morph(happy)` held 950 ms) | as listed | dips instead of looks and morphs; no head motion |
| It speaks | the heading enters as it lands; a bob per line (5.05 s, 5.33 s) | the bob above | none |
| It reads with you | downLeft (6.0 s, 380 ms), a sweep to downRight (6.5 s, 640 ms sine), down at the button (7.3 s, 420 ms), back to you with a blink (8.1 s) | | dips |
| Idle on a page | glance and return, as above | | dips every 1.8 s at most |

### The clips (batch 1)

| Clip | Shows | Length |
|---|---|---|
| `O-M1-speaker-wakes.mp4` | O-S01: the speaker asleep, waking, looking around the window, finding you, speaking the heading, reading the lede with you, looking at the button, idle | 10.4 s, 624 frames |
| `O-M1r-speaker-wakes-reduced-motion.mp4` | the same with `prefers-reduced-motion: reduce` | 10.4 s |

Each has a frame strip of the speaker (`-strip.jpg`, 24 frames). How they are made: `src/ob2-motion.js` builds each clip from the same builders as the stills and sets every animated property as a pure function of time; `src/rec2.cjs` runs the page on a virtual clock (`performance.now`, `requestAnimationFrame`, timers, a seeded `Math.random`), advances it one **60 fps** frame at a time and pipes each frame into ffmpeg (H.264, CRF 24, 1280 x 800). The logo's and orb2's own motion advance on the same clock, so no frame is dropped or doubled and no frame is kept on disk.

## Quality gates

### Render QA

`src/qa2.cjs` is v7's render QA (`render-qa.cjs`) with revision 1's thumbnail skip and a wider **sweep** rule: a still shows live things at rest. Besides a status phrase mid-shimmer and a breath mid-cycle, it now fails a live orb in a still (an orb without orb2's `static`, which can be caught mid-blink or mid-glance) and a logomark with its own idle on (not `still` and not `gaze="off" blink="off"`). Revision 2's stills draw every orb still in its pose (orb2's static frame keeps its `gaze`) and settle the speaker on its pose. The rule also fires on revision 1's stills (O12 and O10 drew live orbs and a live mark), which revision 2 replaces.

Batch 1, all rules (wrap, overflow, escape, clip, row, concentric, mark, sweep, baseline, padding, align):

```
ok   s=obS01&theme=dark
ok   s=obS01&theme=light
ok   s=obS01&v=second&theme=dark
ok   s=obS01&v=second&theme=light
ok   s=obB03&theme=dark
ok   s=obB03&theme=light
ok   s=obB04&theme=dark
ok   s=obB04&theme=light
ok   b=o01
ok   b=o02
ok   b=o03
ok   b=o04

12 pages, 0 findings
```

### Critic pass (batch 1)

By eye at full resolution on every still (each screen dark and light, each board), and frame by frame on both clips.

- **Found and fixed:** the speaker's size constant was revision 1's (a 70 px pair at type 96); the element is 1.1556 em wide, so the pair is 111 px, and every amplitude is now in that W. A bot orbiting the goal heading sat on the "W" of "What" (an inline offset overrode the class). The chosen tile's orb was the tile's own colour on its tint (now the disc gives way to the bot with its own eye colour, and the tile is 104 high so the name keeps its line). The poses on board O04 wrapped to a second row. In reduced motion the element's own 150 ms cross-fade showed the sleeping and the open eyes at once for eight frames (a double image): reduced motion is now a dip, and the frame check shows at most two shapes in every visible frame.
- **Clips, frame by frame** (`src/flicker2.py`: the whole frame for A-B-A flicker and cuts; the speaker's region for the number of shapes, a double image showing as more than two, and the centroid's jerk, where a stutter or a dropped frame is a spike):

```
O-M1-speaker-wakes.mp4: 624 frames, mean change 0.04, max 0.63 at frame 319; flicker none; cuts over 6 none
  track [603, 330, 340, 160]: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 5.08 px/frame; jerk p99 1.61, max 2.74 at frames [292, 217, 216, 315, 291]
O-M1r-speaker-wakes-reduced-motion.mp4: 624 frames, mean change 0.03, max 0.23 at frame 523; flicker none; cuts over 6 none
  track [603, 330, 340, 160]: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.15 px/frame; jerk p99 0.14, max 0.19 at frames [235, 196, 310, 197, 236]
```

  The largest jerk (frame 292, 4.85 s) is the hop's launch while the eyes morph to happy; viewed frame by frame (284 to 307) the morph is progressive, with no pop. Two shapes in every visible frame: no double image, and the eyes never leave their shapes (the logomark's eyes are its shape).
- **Not checkable here:** WebKitGTK's frame rate (the clips are rendered on a virtual clock in Chromium; the 60 fps check in WebKitGTK belongs to the kit's lab).
