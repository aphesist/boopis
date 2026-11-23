# boopis onboarding and setup, in v7 (revision 2)

Status: **revision 2, for the owner** (23 Nov 2026). The owner's picks on revision 1 are recorded, the structure is redesigned for them (one onboarding per tab), and every screen, clip and board is drawn again. Invariant 8: the owner designs the UI. Nothing here is built.

Renders are in the scratchpad folder `onboarding-v2/`: `boards/` (O01 to O04, C01, C02), `screens/` (37 screens, dark and light, 1440 x 900 at 2x), `motion/` (8 clips, 1280 x 800 at 60 fps, each with a reduced-motion version and a frame strip) and `contact-sheet.jpg`. They are drawn by `src/` in this folder: revision 2's files are `ob2-*.js`, `ob2.css`, `ob2.html`, `ob2-motion.html`, `rec2.cjs` (the 60 fps recorder), `recall.sh` (records every clip), `qa2.cjs` (the render QA, with the wider sweep rule), `flicker2.py` (the frame check), `regions.cjs` (the regions it tracks), `mkjobs2.py` with `screens2.json` and `boards2.json` (the render list) and `obcontact2.py` (the contact sheet); revision 1's files stay beside them, because revision 2 reuses its product cards. They run beside v7's render source as of `528a5dca` (`kit.css`, `kit.js`, the screen builders, `dockv7.js` and `lib/`, with the real `<boopis-logo>`), and draw every orb with the tuned orb2 build of ORBS.md (`docs/design/v7/character/probes/lib/orb-avatar.tuned.js` on `w31/bot-character` at e8c87cf1: C1 to C3 and T1 to T5, before the C9 and C10 turn clamps, which the owner is replacing with a geometric fix; copied to `lib/`).

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

## The screens

Every screen is drawn dark and light (`screens/`, 1440 x 900 at 2x). "Shared" marks a step that only the first tab asks; "writes" is what a step saves to the ledger as it is answered.

### The Session tab (O-S)

The Session tab's shell throughout: the sidebar with its Sessions / Bots switch and "No sessions yet" (no main bot in this tab, owner 23 Nov), the title pill, the window glyphs. The pages have no composer and no dock; the setup conversation has the composer and no dock; the canvas (O-S05 on) has the v7 dock (Sessions only, `528a5dca`) with only the bots that exist.

**O-S01 Hello** (`O-S01-hello`; `O-S01b-hello-engine-getting-ready`; `O-S01-second-welcome-to-sessions`). The Page's intro variant in the main area: "Hi, I'm boopis", "Let's set up sessions: you and one agent, working on your code, step by step.", the speaker at the hero size in the scene, Let's start, "Skip setup" bottom left. The engine installs behind it; while it does, the button gives way to the StatusLine "Getting boopis ready" with the percentage. Second tab: "Welcome to Sessions", "Your model and draft reading are already set. Two questions, then you're working.", the speaker happy, Continue. *Logic:* the tab says what it is in its own words; the first thing a person meets is the face of every new session. Clips O-M1, O-M6a.

**O-S02 Settings boopis needs** (shared, required; `O-S02-settings-boopis-needs`). Revision 1's consent, unchanged in substance (invariant 6): the three engine settings as rows with their keys in mono, Apply the changes / Not now. The speaker at the stage size above the heading, looking down at the card. Writes: the three settings (`shared.consent`).

**O-S03 Model** (shared; `O-S03-model-found`, `O-S03b-model-nothing-found`, `O-S03c-model-signing-in`, `O-S03d-error-sign-in-failed`, `O-S03e-error-offline`). The Session tab's setup conversation: the title pill "Set up sessions, 1 of 3", the speaker on the stage above the thread, its lines as agent bubbles, the AskCard "Found on this computer" (Claude pre-selected, starts on Claude Opus; ChatGPT; Ollama), Use Claude / Add another / Use the free models, the composer disabled ("Choose a model first"). The speaker looks at the card, follows the row under the pointer, and reacts to the answer (a nod, a hop with happy eyes); while a sign-in waits it looks up and aside (thinking), and on a failed sign-in it doubts (skeptic). Writes: the providers' state and the model ladder (`shared.model`). Clip O-M2.

**O-S04 Try it** (shared; `O-S04a-try-it-marks`, `O-S04b-try-it-mark-open`, `O-S04c-try-it-keep-it-on`, `O-S04d-try-it-recorded`). Revision 1's O06 in the Session tab: the draft types itself into the real composer, the reading draws its marks, a mark opens its menu, the choice is a receipt, then "Keep reading my drafts?" Keep it on / Turn it off. With no model or a failed read, the labelled recording, with the Notice the whole time (invariant 5). The speaker watches the composer: it cocks its head (listening) and its eyes follow the draft as it grows, it notices each reading (a blink and a bob), looks at the menu, nods at the choice and is happy at Keep it on. Writes: `shared.feedforward`. Clip O-M5.

**O-S05 Add a folder** (`O-S05-add-a-folder`; `O-S05-second-with-receipts`). S41's no-project canvas; the speaker has travelled from the stage into S41's mark (one pair of eyes the whole way) and is now the mark. "Add a folder to start", Add a project / Import sessions; the dock rises with boopis only. When Bots ran first, one receipt under the buttons ("Already set in Bots: Claude Opus, and reading your drafts") and the dock holds the team. Clip O-M6b.

**O-S06 How careful** (`O-S06-how-careful`). The four rows, Auto-accept edits pre-selected and marked recommended, Use Auto-accept edits; a project with no trusted gate shows Supervised and Full access, Supervised chosen. The mark looks down at the rows. Writes: Settings, Sessions, the default step.

**O-S07 First task** (`O-S07-first-task`). S41 ready: the mark listening and looking down at the composer as the draft is typed (20.1's look at the composer), the launch row, three suggestion Chips. Enter starts the session; the Session onboarding is done (`tabs.session.done`).

### The Bots tab (O-B)

The Bots tab's shell throughout (owner, 23 Nov, ORBS.md K02 A): the open sidebar with its Sessions / Bots switch, then the main boopis bot at 44 px centred with its name, then the bots that exist as rows with 28 px orbs. No dock in this tab. Before boopis is met (O-B01, O-B01c, O-B02) the list reads "No bots yet".

**O-B01 Hello** (`O-B01-hello`; `O-B01-second-welcome-to-bots`). "Hi, I'm boopis", "Let's set up your bots: a small team that works on its own and asks you first.", the speaker at the hero size, Let's start, "Not now". Second tab: "Welcome to Bots", "Your model and draft reading are already set, so this is only about your team."

**O-B01c Settings boopis needs** (shared, required, when Bots runs first; `O-B01c-settings-boopis-needs`). The same page as O-S02 in the Bots tab.

**O-B02 Meet the boopis bot** (`O-B02-meet-the-boopis-bot`). "It makes your bots, hands them work and tells you what it cost. It has my eyes." The speaker's eyes drop into the boopis orb (ink, `squircle`, 120), which wakes and is happy. Show me the bots / Back. *Logic:* section 10's "the logo given a body", shown literally once; from here the boopis bot speaks in the Bots tab. Clip O-M3.

**O-B03 Meet your team** (`O-B03-meet-your-team`). The boopis bot has travelled into the sidebar's main slot. Three bots at 64 with their jobs (kai reviews pull requests, moss runs the tests at night, iris writes the release notes); at rest each looks at another, with orb2's `gaze` (kai at moss, moss up at boopis in the sidebar, iris at kai). "Each bot has one job. They work on their own and ask you before anything risky." Next / Back. Clip O-M3.

**O-B04 Goals** (`O-B04-goals-tiles`, `O-B04b-goals-two-picks`). The goal tiles (O03), the bots orbiting the heading. Writes: `answers.goals`. Clip O-M7.

**O-B05 The shared setup in boopis's chat.** When Bots runs first: **O-B05a Model** (`O-B05a-model-in-boopis-chat`) and **O-B05b Try it** (`O-B05b-try-it-in-boopis-chat`), the same cards and composer as O-S03 and O-S04, asked by the boopis bot ("Got it. Before I make anyone: your bots need a model to think with."). When Sessions ran first: **O-B05c**, one receipt line at the top of the chat ("Already set in Sessions: Claude Opus, and reading your drafts"), shown on `O-B06-second-shared-receipt`.

**O-B06 Where your bots work** (`O-B06-where-bots-work`, `O-B06-second-shared-receipt`). The AskCard (choices): this computer in a container (recommended, about 4 GB), a computer I own, a cloud server, directly on this computer. Writes: the bot computer setting.

**O-B07 Your name** (`O-B07-your-name`), **O-B08 A starter team and connectors** (`O-B08-starter-team-and-connectors`), **O-B09 The approval rules** (`O-B09-approval-rules`, owner O02 A), **O-B10 Build** (`O-B10-build`), **O-B11 Reach** (`O-B11-reach`), **O-B12 First job** (`O-B12-first-job`): revision 1's O14, O16 to O20, unchanged in content and logic, in the v7 Bots tab. What changed: the team is built into the sidebar (rows at 28 under the main bot), not a rail and a dock; Build's line reads "They're in your sidebar, under me."; Reach names "The dock, in Sessions". The first job's ask flags moss's row in the sidebar (the amber dot and "Needs you"). Clip O-M4 (Build).

### Across both tabs (O-X)

**O-X01 Resume** (`O-X01-resume`): reopening a tab whose onboarding is unfinished brings back its conversation at the same card: "Pick up where we left off? We were on Try it, then two questions." Pick up / Start again / Finish later. Each tab resumes its own; the other tab's answers are receipts.

**O-X02 Settings, getting started** (`O-X02-settings-getting-started`): Sessions onboarding (Done, Run it again), Bots onboarding (Not started, Start), Shared setup: model, reading drafts (Done in Sessions, Change), Try reading drafts (Try it). Running a tab's onboarding again replays its steps with the answers pre-filled and skips the shared ones (they are changed from their own rows).

**O-X03 Returning users** (`O-X03-returning-user`): someone upgrading with sign-ins, bots or sessions gets no onboarding in either tab: receipts for what was found and the one new thing, feedforward (Show me / Keep it on, skip the demo / Turn it off). Both tabs are marked done.

**Skip.** "Skip setup" (Sessions) and "Not now" (Bots) leave the tab's onboarding with whatever is answered; what is still missing is asked where it is first needed (the model by S41's no-model state, how careful by the launch row, the rules by the Bots tab's next open). Skipping Try it keeps feedforward on. Every card skips with Esc.

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

The owner's later decisions: no new character system, apply the existing animations more; then the orb decisions of 23 Nov (`w31/bot-character` ORBS.md, 40aaabab) and the sidebar policy. Onboarding follows them all:

| Decision | In onboarding |
|---|---|
| The new renderer, the clarity fixes (C1 to C3) and T1 to T5 | every orb is drawn by the tuned orb2 build (`src/lib/orb-avatar.tuned.js`, ORBS.md's probe build: snapped canvases, no dpr ladder, the 0.20 s blink, calm glance and return, no float under 44, the rest gaze front) |
| Eyes at `face-scale` 1.25 | on every orb of 44 px and under (`OB2.orbRules`) |
| Grok's sizes; the main bot at 44, only in the Bots tab, first below the switch | the Bots tab's sidebar while onboarding: boopis at 44 centred with its name, the team as rows at 28; the Sessions tab shows no bot |
| The dock is the Sessions tab's only (v7 528a5dca) | no dock anywhere in the Bots onboarding; the Session canvas (O-S05 on) has the v7 dock with the bots that exist; the team assembles into the Bots sidebar |
| Sidebar bots sit at one fixed sideways 3/4 angle and move only through their states | the sidebar's orbs carry one fixed `gaze` (`OB2.SIDE_GAZE`, -24 4, provisional until ORBS.md 23 gives the exact angle) and `idle-motion="off"`; in the clips they only change state (happy when made, idle). A bot flying into the sidebar settles on that angle before it lands |
| Everywhere else fully lively, with 3D turns and face variety | the scenes (the boopis bot born, the team waking, the goals' orbit, the newborns above the composer) use every existing behaviour, below |

| Behaviour | orb2 | Onboarding uses it for |
|---|---|---|
| Wake | the `wake` emote, `reaction` from sleeping | the boopis bot born (O-B02); kai and moss waking (O-B03) |
| Double take | `emote('doubletake')` | iris waking (O-B03) |
| Look at a thing | `lookAt(x, y)`, `gaze` for a held look | bots looking at each other, at boopis in the sidebar, at the tile under the pointer, at you |
| Happy | `react('happy')` | a bot made, a bot landing in its tile, the team at the end |
| Bob | `poke(force, {react: false})` | a bot that is happy, lands in its tile, or wakes |
| Turn | `spin('turntable')` | a bot turning as it takes off (O-B04, O-B10), moss turning to kai (O-B03) |
| Blink | `blink()` | a bot noticing; the newborn before it flies |
| Reduced motion | orb2 reduces and never freezes | every bot under reduced motion; travel becomes a dip |

**A render guard for big turns.** orb2's current build deforms a flat body's silhouette near its turn clamp (the owner's silhouette bug: past about 0.2 rad a squircle's outline kinks, past 0.75 rad the eyes are cut; ORBS.md C9, C10). The owner is replacing those clamps with a geometric fix so that big turns stay. Until it lands, onboarding's clips cap each `lookAt` so the head turns at most about 0.5 rad (the target is pulled toward the orb to 0.42 of orb2's distance constant), and the frame check measures every tracked orb's silhouette (below). For the same reason a full turn (`spin('turntable')`) is used on a round body only (kai); a flat body (moss's squircle, iris's flower) shows its interest with orb2's `curious` emote instead, because the critic pass saw moss's turntable kink its outline and cut its eyes at the rim. When the geometric fix lands, the cap is lifted, the flat bodies turn too, and the clips are re-recorded; nothing else changes.

**Would need new** (not built in): none. Every bot moment is orb2 as it is, used more; what onboarding adds is scene motion around an orb (its flight, its orbit, its row opening), never a behaviour of the orb itself.

## Motion spec

Every value is a v7 token (`tokens.v7.json`, 9.2), an element's own constant (orb2, `<boopis-logo>`), or the speaker's (above). Two easings are NEW and onboarding only: the **turn** ease, cubic-bezier(.45, 0, .2, 1), for the speaker's full turns; and the **travel** ease, cubic-bezier(.32, 0, .12, 1), for anything that goes from one place to another (the speaker between pages, a bot into the sidebar or a tile). `--spring` starts at full speed, which at 60 fps is a jump in the first frame of a long move (the frame check measured it: 36 px in one frame); travel eases out of rest and lands as softly. Reduced motion, everywhere: nothing travels, scales or turns; a change is a dip (out 90, hidden 220 for the speaker or 60 for a bot, in 90 ms), never a cross-fade of two images; orb2 reduces itself.

| Moment | What moves | Duration and easing | Reduced motion |
|---|---|---|---|
| Page words | heading, then lede (60 later), then actions: opacity and 4 px up | `--dur-2` 200, `--ease-sharp` | opacity only, 150 |
| Step to step (a page or a step of the conversation) | the old page's parts go (opacity, 120 ms `--ease-out`); the next page's come (200 ms `--ease-sharp`, 50 to 60 ms apart); parts both pages share (the pill, the dock, the ghost, the sidebar) never move; one window shows at a time | 120 + 200 | the same, opacity only |
| One speaker, travelling | the speaker leaves its page and goes to the next page's spot: hero to a page's 44 spot, to the stage, into S41's mark; its scale goes with it (96 to 44 is 0.458) | 640 travel (680 into the canvas) | a dip at the old spot, then it is at the new one |
| The speaker wakes (O-S01, O-B01) | asleep: the sleeping eyes, the head dropped (pitch -10, 0.05 W down, roll -3); at 1.2 s `morph(idle)`, the stretch, the head to rest (620 `--spring`); a double blink 360 and 570 ms later; it looks around: left (420), a sweep right (560, turn ease), up left (380), a full turn to the Sessions / Bots switch (520, turn ease, with a blink); it finds you (`you`, a 0.14 W hop, `morph(happy)` held 950 ms) | as listed | dips; no head motion |
| It speaks | a bob per line as it lands | bob 500 | none |
| It reads, it follows | it looks at what is under the pointer (a row, the button) and at what arrives (a receipt, a card): eyes first, the head 60 ms later | 420 `--spring` | dips, at most one per 300 ms |
| It is answered | a nod (520), then a 0.18 W hop with `morph(happy)` (held about 950 ms), then it looks at the receipt and blinks | | a dip to happy and back |
| It listens (Try it, the first task) | `morph(listening)`, the head cocked (tiltLeft, 420); its eyes follow the draft across the composer, `look(x, -1)` with x from -0.7 to 0.7, a step every 300 ms; a reading lands: a blink and a 0.06 W bob; it looks at the opened menu, nods at the choice, is happy at Keep it on | | dips |
| The boopis bot is born (O-B02) | the speaker's eyes shrink to 0.35 and fall 0.18 W (380 `--spring`); the orb, asleep, appears opaque at .45 round them and grows (380 `--spring`, from 1.3 s); the eyes fade inside the body (110 ms, from 1.32 s), the body's colour, so never two faces; the orb wakes (`wake`, 1.75 s), is happy with a bob (2.05 s, held 900) | | a dip from the eyes to the orb, sequential |
| It takes its place | the orb travels from the hero (120) to the sidebar's main slot (44): 640 travel, then a bob, then the sidebar's fixed angle | 640 | a dip |
| The team wakes (O-B03) | three bots enter asleep (200, from .98, 80 apart); one by one, 800 ms apart: wake, look at boopis, happy with a bob, their chip enters; moss turns (`spin`) to kai; iris does a double take; they look round at each other, then at you, blink in a ripple (80 apart) and hop together (90 apart) | orb2's own | orb2 reduced; chips fade |
| The team assembles (O-B10) | each bot is made above the composer (from .3, 300 `--spring`, happy), looks at boopis, blinks, turns as it takes off, flies to its row along a 60 px arc (640 travel, 44 to 28 px) while its row opens (height 0 to 44, 200 `--spring`); 300 ms before it lands it settles on the sidebar's angle; its words come as it lands (200), it is happy for 900 ms (a state, the sidebar's only motion); 1.4 s between bots, with the StatusLine's phrases (each held at least 800) | | the bot dips out above the composer and in on its row |
| A pick takes a bot (O-B04) | the orbiting bots drift on 8 x 5 px ellipses (4.2 to 5.4 s); they look at the tile under the pointer; a pick: the bot turns and flies from the orbit into the tile's disc (660 travel, a 40 px arc, its size to 28); the icon goes (120) as it arrives; the tile takes its colour as it lands (120); the bot is happy with a bob | | no drift; a dip |
| The reading's menu | from scale .98 and 4 px toward its anchor | `--dur-pop` 100 in, `--dur-out` 100 out | opacity only |
| Hold to allow, hold to build | the fill sweeps left to right | `--dur-hold` 1000, linear | the fill still shows progress |
| A card answered | its height to 0 and its opacity to 0; the person's bubble, the receipt and the next line enter from 4 px | `--dur-3` 300 `--spring`; `--dur-2`, 140 apart | the card is replaced; the rest fade |
| Status phrases | the shimmer sweep; each phrase held at least 800 | `--dur-shimmer` 2.2 s steps(60) | no sweep |
| The dock arrives (O-S05) | the v7 dock rises 12 px and fades in | 300 `--spring` | opacity only |

Stills never show anything in flight: no phrase mid-sweep, no breath, no blink, no morph, no hop; orbs are drawn still in their pose (QA rule `sweep`, below).

### The clips

All 1280 x 800, **60 fps**, each with a reduced-motion version (`r`) and a frame strip of 16 frames (24 of the speaker for O-M1).

| Clip | Shows | Length |
|---|---|---|
| `O-M1-speaker-wakes.mp4` | O-S01: the speaker asleep, waking, looking around the window, finding you, speaking, reading the lede with you, looking at the button | 10.4 s |
| `O-M2-speaker-reacts.mp4` | O-S03: the speaker follows the row under the pointer and the button, is answered (a nod, a hop, happy), reads the receipt and its next lines, then listens as a draft is typed | 9.6 s |
| `O-M3-bots-come-alive.mp4` | O-B02 to O-B03: the eyes become the boopis bot, it wakes and is happy, travels into the sidebar; the three bots wake one by one, turn, glance and bob, look at each other and at boopis, then at you | 10.8 s |
| `O-M4-team-assembles.mp4` | O-B09 to O-B10: the rules kept, the StatusLine's phrases, each bot made above the composer, looking at boopis, turning and flying to its row in the sidebar, the receipt | 8.6 s |
| `O-M5-try-it.mp4` | O-S04: the draft typed, the speaker listening and following it, two readings, a mark opened and answered, the receipt, keep it on | 9.3 s |
| `O-M6a-steps-hello-to-setup.mp4` | O-S01 to O-S02 to O-S03: one speaker travelling from the hero to the consent page to the stage, the pages handing over | 8.8 s |
| `O-M6b-steps-setup-to-canvas.mp4` | O-S04 to O-S05 to O-S06 to O-S07: from the stage into S41's mark, the dock rising, how careful, the first task typed while the mark listens | 10.0 s |
| `O-M7-goal-tiles.mp4` | O-B04: the bots orbiting the heading watch the tile under the pointer; two picks, each bot flying into its tile | 9.6 s |

How they are made: `src/ob2-motion.js` and `src/ob2-motion2.js` build each clip from the same builders as the stills and set every animated property as a pure function of time; `src/rec2.cjs` runs the page on a virtual clock (`performance.now`, `requestAnimationFrame`, timers, a seeded `Math.random`), advances it one 60 fps frame at a time and pipes each frame into ffmpeg (H.264, CRF 24, 1280 x 800); `src/recall.sh` records them all, and `src/strip2.py` cuts each strip from the MP4 itself. orb2's and the logo's own motion advance on the same clock, so no frame is dropped or doubled and none is kept on disk.

## Quality gates

### Render QA

`src/qa2.cjs` is v7's render QA (`render-qa.cjs`) with revision 1's thumbnail skip and a wider **sweep** rule: a still shows live things at rest. Besides a status phrase mid-shimmer and a breath mid-cycle, it fails a live orb in a still (an orb without orb2's `static`, which can be caught mid-blink or mid-glance) and a logomark with its own idle on (not `still` and not `gaze="off" blink="off"`). Revision 2's stills draw every orb still in its pose (orb2's static frame keeps its `gaze`) and settle the speaker on its pose. The rule also fires on revision 1's stills (O10 and O12 drew live orbs and a live mark); revision 2 replaces them.

Final run, every screen dark and light and every board (74 screens, 6 boards), all rules: wrap, overflow, escape, clip, row, concentric, mark, sweep, baseline, padding, align:

```
ok   s=obS01&theme=dark
ok   s=obS01&theme=light
ok   s=obS01&v=second&theme=dark
ok   s=obS01&v=second&theme=light
ok   s=obB03&theme=dark
ok   s=obB03&theme=light
ok   s=obB04&theme=dark
ok   s=obB04&theme=light
ok   s=obS01&engine=busy&theme=dark
ok   s=obS01&engine=busy&theme=light
ok   s=obS02&theme=dark
ok   s=obS02&theme=light
ok   s=obS03&theme=dark
ok   s=obS03&theme=light
ok   s=obS03&st=none&theme=dark
ok   s=obS03&st=none&theme=light
ok   s=obS03&st=waiting&theme=dark
ok   s=obS03&st=waiting&theme=light
ok   s=obS03&st=failed&theme=dark
ok   s=obS03&st=failed&theme=light
ok   s=obS03&st=offline&theme=dark
ok   s=obS03&st=offline&theme=light
ok   s=obS04&phase=shown&theme=dark
ok   s=obS04&phase=shown&theme=light
ok   s=obS04&phase=open&theme=dark
ok   s=obS04&phase=open&theme=light
ok   s=obS04&phase=ask&theme=dark
ok   s=obS04&phase=ask&theme=light
ok   s=obS04&phase=open&rec=1&theme=dark
ok   s=obS04&phase=open&rec=1&theme=light
ok   s=obS05&theme=dark
ok   s=obS05&theme=light
ok   s=obS05&v=second&theme=dark
ok   s=obS05&v=second&theme=light
ok   s=obS06&theme=dark
ok   s=obS06&theme=light
ok   s=obS07&theme=dark
ok   s=obS07&theme=light
ok   s=obB01&theme=dark
ok   s=obB01&theme=light
ok   s=obB01&v=second&theme=dark
ok   s=obB01&v=second&theme=light
ok   s=obB01c&theme=dark
ok   s=obB01c&theme=light
ok   s=obB02&theme=dark
ok   s=obB02&theme=light
ok   s=obB04&picks=two&theme=dark
ok   s=obB04&picks=two&theme=light
ok   s=obB05a&theme=dark
ok   s=obB05a&theme=light
ok   s=obB05b&phase=open&theme=dark
ok   s=obB05b&phase=open&theme=light
ok   s=obB06&theme=dark
ok   s=obB06&theme=light
ok   s=obB06&v=second&theme=dark
ok   s=obB06&v=second&theme=light
ok   s=obB07&theme=dark
ok   s=obB07&theme=light
ok   s=obB08&theme=dark
ok   s=obB08&theme=light
ok   s=obB09&theme=dark
ok   s=obB09&theme=light
ok   s=obB10&theme=dark
ok   s=obB10&theme=light
ok   s=obB11&theme=dark
ok   s=obB11&theme=light
ok   s=obB12&theme=dark
ok   s=obB12&theme=light
ok   s=obX01&theme=dark
ok   s=obX01&theme=light
ok   s=obX02&theme=dark
ok   s=obX02&theme=light
ok   s=obX03&theme=dark
ok   s=obX03&theme=light
ok   b=o01
ok   b=o02
ok   b=o03
ok   b=o04
ok   b=c01
ok   b=c02

80 pages, 0 findings
```

### Critic pass

**Stills**, by eye at full resolution, each screen in dark and in light and each board. Checked: the Page's anatomy (heading at 196, the scene, actions at 640, the ghost bottom left) on every page; the speaker's pose against what it looks at; every orb's eyes inside its body at its gaze; the sidebars (Sessions: no bot; Bots: the main bot at 44 and rows at 28, at the fixed angle); no dock in the Bots tab, the v7 dock in the Session canvas; the reading's menu above its mark and clear of the Notice; the tiles' 2 px ring on continuous corners; copy against the decisions (no rail or dock named in the Bots tab). Found and fixed:

- the speaker's size constant was revision 1's (a 70 px pair at type 96): the element is 1.1556 em wide, so the pair is 111 px, and every amplitude is now in that W;
- a bot orbiting the goal heading sat on its first letter (an inline offset overrode the class); the chosen tile's orb was its own colour on its own tint (the disc now gives way to the bot, with orb2's own eye colour);
- board O04's nine poses wrapped to a second row;
- O-X02 (Settings) sat on revision 1's canvas, with a live mark (the sweep rule caught it); it now sits on revision 2's;
- O-X03 (a returning user) said "your 4 bots and 12 sessions: all here" over an empty sessions list; its sidebar now lists them, and its pill says "What's new";
- O-B10 and O-B11 still named the rail and the dock in the Bots tab; they now say "in your sidebar, under me" and "the dock, in Sessions";
- the Bots screens were redrawn for the owner's orb decisions (the main bot at 44, rows at 28, no dock, the fixed sidebar angle, face-scale 1.25, the tuned renderer).

**Clips**, frame by frame around every transition (crops at full size, every frame or every second frame), and by script on every frame (`src/flicker2.py`): the whole frame for A-B-A flicker and cuts; the speaker's region for the number of eye shapes (a double image is more than two) and the centroid's jerk (a stutter or a dropped frame is a spike); each tracked orb's silhouette for area spikes, jumps over 8% and convexity dents (a cut or deformed edge). Found and fixed:

- reduced motion: the element's own 150 ms cross-fade showed the sleeping and the open eyes at once for eight frames; reduced motion is now a dip;
- the boopis bot's birth showed the speaker's eyes over a half-transparent orb with its own eyes for two frames; the body is now opaque from its first frame and the eyes, at 0.35, fade inside it;
- a chain of page swaps let a later window cover an earlier one (O-M6a and O-M6b showed blank first pages); one window now shows at a time;
- the goals' lifted bots appeared before the page and stopped drifting; they now enter and drift with the orbit until their trip, and the tile takes its colour as the bot lands, not before;
- the speaker crossed the consent page's heading as it travelled; that page's words now come once it has passed;
- `--spring` travel jumped 36 px in its first frame at 60 fps; travel now uses the travel ease (the jerk at take-off fell from 23 to 3.8 px per frame squared);
- a starting pose was applied 60 ms in (a pop in the first frames of O-M5); a cue at t <= 0 is now in place before the first frame;
- orb2 looking at a far point turned a flat body to its clamp and bent its outline (the owner's silhouette bug); `lookAt` is capped at about 0.5 rad until the geometric fix;
- moss's turntable kinked its outline and cut its eyes at the rim; flat bodies use the curious emote instead of a turn until the fix;
- a bot reached its sidebar row still turning, so the swap to the row's orb jumped its eyes; the turn now ends before it lands and it rests on the row 260 ms before the swap, settled on the sidebar's angle.

Final frame check, all sixteen clips:

```
O-M1-speaker-wakes.mp4: 624 frames, mean change 0.04, max 0.63 at frame 319; flicker none; cuts over 6 none
  track [602, 330, 340, 160] frames 0-624: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 5.08 px/frame; jerk p99 1.61, max 2.74 at frames [292, 217, 216, 315, 291]
O-M2-speaker-reacts.mp4: 576 frames, mean change 0.02, max 0.93 at frame 246; flicker none; cuts over 6 none
  track [712, 40, 122, 84] frames 0-576: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 1.94 px/frame; jerk p99 0.61, max 1.08 at frames [272, 250, 312, 249, 9]
O-M3-bots-come-alive.mp4: 648 frames, mean change 0.07, max 2.22 at frame 257; flicker none; cuts over 6 none
  track [600, 280, 350, 250] frames 0-230: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 1.42 px/frame; jerk p99 0.64, max 0.85 at frames [69, 70, 72, 74, 73]
  orb [712,346,120,120] frames 100-235: area 10273-10852 px, convexity median 0.996 min 0.990; area spikes none; jumps over 8% none; dents none
  orb [542,312,70,70] frames 280-648: area 2385-2454 px, convexity median 0.987 min 0.982; area spikes none; jumps over 8% none; dents none
  orb [738,366,70,70] frames 280-648: area 2870-3120 px, convexity median 0.988 min 0.975; area spikes none; jumps over 8% none; dents none
  orb [932,312,70,70] frames 280-648: area 2037-2127 px, convexity median 0.942 min 0.927; area spikes none; jumps over 8% none; dents none
  orb [100,78,62,62] frames 290-648: area 1436-1472 px, convexity median 0.990 min 0.989; area spikes none; jumps over 8% none; dents none
O-M4-team-assembles.mp4: 516 frames, mean change 0.04, max 1.87 at frame 31; flicker none; cuts over 6 none
  orb [100,78,62,62] frames 0-516: area 1181-1486 px, convexity median 0.993 min 0.979; area spikes none; jumps over 8% none; dents none
  orb [10,162,40,40] frames 215-516: area 477-486 px, convexity median 0.982 min 0.976; area spikes none; jumps over 8% none; dents none
  orb [10,202,40,40] frames 300-516: area 598-601 px, convexity median 1.000 min 0.999; area spikes none; jumps over 8% none; dents none
  orb [10,240,40,40] frames 390-516: area 422-433 px, convexity median 0.940 min 0.936; area spikes none; jumps over 8% none; dents none
O-M5-try-it.mp4: 558 frames, mean change 0.01, max 0.45 at frame 259; flicker none; cuts over 6 none
  track [712, 40, 122, 84] frames 0-558: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 2.14 px/frame; jerk p99 0.73, max 1.60 at frames [477, 135, 499, 130, 186]
O-M6a-steps-hello-to-setup.mp4: 528 frames, mean change 0.05, max 0.85 at frame 337; flicker none; cuts over 6 none
  track [400, 30, 750, 480] frames 0-528: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 22.76 px/frame; jerk p99 2.25, max 3.84 at frames [164, 163, 165, 162, 170]
O-M6b-steps-setup-to-canvas.mp4: 600 frames, mean change 0.05, max 0.87 at frame 269; flicker none; cuts over 6 none
  track [400, 30, 750, 420] frames 0-600: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 13.65 px/frame; jerk p99 1.67, max 2.59 at frames [268, 92, 93, 89, 94]
O-M7-goal-tiles.mp4: 576 frames, mean change 0.02, max 0.66 at frame 37; flicker none; cuts over 6 none
  orb [484,270,38,38] frames 320-576: area 467-474 px, convexity median 0.984 min 0.980; area spikes none; jumps over 8% none; dents none
  orb [684,270,38,38] frames 460-576: area 396-422 px, convexity median 0.924 min 0.924; area spikes none; jumps over 8% none; dents none
  orb [650,116,40,40] frames 40-576: area 661-743 px, convexity median 0.988 min 0.958; area spikes none; jumps over 8% none; dents none
  orb [100,78,62,62] frames 0-576: area 1180-1482 px, convexity median 0.991 min 0.982; area spikes none; jumps over 8% none; dents none
O-M1r-speaker-wakes-reduced-motion.mp4: 624 frames, mean change 0.03, max 0.23 at frame 523; flicker none; cuts over 6 none
  track [602, 330, 340, 160] frames 0-624: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.15 px/frame; jerk p99 0.14, max 0.19 at frames [235, 196, 310, 197, 236]
O-M2r-speaker-reacts-reduced-motion.mp4: 576 frames, mean change 0.02, max 2.47 at frame 245; flicker none; cuts over 6 none
  track [712, 40, 122, 84] frames 0-576: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.23 px/frame; jerk p99 0.17, max 0.22 at frames [372, 364, 233, 334, 210]
O-M3r-bots-come-alive-reduced-motion.mp4: 648 frames, mean change 0.03, max 0.82 at frame 248; flicker none; cuts over 6 none
  track [600, 280, 350, 250] frames 0-230: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.07 px/frame; jerk p99 0.07, max 0.08 at frames [23, 66, 24, 22, 5]
  orb [712,346,120,120] frames 100-235: area 10273-10849 px, convexity median 0.996 min 0.989; area spikes none; jumps over 8% none; dents none
  orb [542,312,70,70] frames 280-648: area 2385-2415 px, convexity median 0.987 min 0.984; area spikes none; jumps over 8% none; dents none
  orb [738,366,70,70] frames 280-648: area 2933-3113 px, convexity median 0.993 min 0.985; area spikes none; jumps over 8% none; dents none
  orb [932,312,70,70] frames 280-648: area 2057-2134 px, convexity median 0.945 min 0.924; area spikes none; jumps over 8% none; dents none
  orb [100,78,62,62] frames 290-648: area 1442-1473 px, convexity median 0.991 min 0.990; area spikes none; jumps over 8% none; dents none
O-M4r-team-assembles-reduced-motion.mp4: 516 frames, mean change 0.02, max 5.09 at frame 30; flicker none; cuts over 6 none
  orb [100,78,62,62] frames 0-516: area 1209-1488 px, convexity median 0.992 min 0.983; area spikes none; jumps over 8% none; dents none
  orb [10,162,40,40] frames 215-516: area 477-485 px, convexity median 0.981 min 0.974; area spikes none; jumps over 8% none; dents none
  orb [10,202,40,40] frames 300-516: area 600-601 px, convexity median 1.000 min 1.000; area spikes none; jumps over 8% none; dents none
  orb [10,240,40,40] frames 390-516: area 419-426 px, convexity median 0.941 min 0.931; area spikes none; jumps over 8% none; dents none
O-M5r-try-it-reduced-motion.mp4: 558 frames, mean change 0.01, max 0.21 at frame 383; flicker none; cuts over 6 none
  track [712, 40, 122, 84] frames 0-558: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.22 px/frame; jerk p99 0.15, max 0.31 at frames [382, 472, 556, 361, 23]
O-M6ar-steps-hello-to-setup-reduced-motion.mp4: 528 frames, mean change 0.04, max 1.05 at frame 344; flicker none; cuts over 6 none
  track [400, 30, 750, 480] frames 0-528: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 1.28 px/frame; jerk p99 0.27, max 1.39 at frames [2, 56, 435, 21, 501]
O-M6br-steps-setup-to-canvas-reduced-motion.mp4: 600 frames, mean change 0.03, max 0.95 at frame 92; flicker none; cuts over 6 none
  track [400, 30, 750, 420] frames 0-600: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.48 px/frame; jerk p99 0.24, max 0.41 at frames [106, 2, 21, 213, 423]
O-M7r-goal-tiles-reduced-motion.mp4: 576 frames, mean change 0.01, max 0.30 at frame 162; flicker none; cuts over 6 none
  orb [484,270,38,38] frames 320-576: area 464-472 px, convexity median 0.979 min 0.977; area spikes none; jumps over 8% none; dents none
  orb [684,270,38,38] frames 460-576: area 382-421 px, convexity median 0.925 min 0.922; area spikes none; jumps over 8% none; dents none
  orb [650,116,40,40] frames 40-576: area 672-729 px, convexity median 0.997 min 0.968; area spikes none; jumps over 8% none; dents none
  orb [100,78,62,62] frames 0-576: area 1209-1490 px, convexity median 0.991 min 0.981; area spikes none; jumps over 8% none; dents none
```

Every clip: no A-B-A flicker, no single-frame cut, never more than two eye shapes, no silhouette spike, jump or dent. The largest jerks are the speaker's hop launch with its morph to happy (O-M1, 2.74) and the travel's take-off (O-M6a, 3.84); both were viewed frame by frame and are smooth.

**Not checkable here:** WebKitGTK's frame rate (the clips are rendered on a virtual clock in Chromium; the 60 fps check in WebKitGTK belongs to the kit's lab), and real reads for Try it (no live engine in this container: the screens show the reading the spec describes, and the recording path is what a run with no model shows).

## Dependencies

- `w31/bot-character` ORBS.md (40aaabab): the tuned renderer and the owner's orb decisions are applied. Two things wait on it: the exact sidebar angle (ORBS.md 23; `OB2.SIDE_GAZE` holds a provisional value), and the geometric fix for turned silhouettes, after which the `lookAt` cap and the round-only turntable are lifted and the clips re-recorded.
- v7 at `528a5dca` (the dock, Sessions only): the Session canvas uses `dockv7.js`.
- The speaker's blink is `<boopis-logo>`'s (155 ms); ORBS.md's T1 (0.20 s) applies to orb2, and reaches the logo only if the logo's lifted orb block is rebuilt from it.
