# boopis onboarding and setup, in v7 (revision 3)

Status: **revision 3, for the owner** (23 Nov 2026). The owner liked revision 2's look and animations ("everything is looking dandy now") and changed three things: the structure (one continuous first run, below), the buttons the clips drew off-centre, and the bots' sidebar pose. Everything else is revision 2's. Invariant 8: the owner designs the UI. Nothing here is built.

Renders are in the scratchpad folder `onboarding-v3/`: `boards/` (O01 to O04, C01, C02), `screens/` (33 screens, dark and light, 1440 x 900 at 2x), `motion/` (9 clips, 1280 x 800 at 60 fps, each with a reduced-motion version and a 16-frame strip), `contact-sheet.jpg`, `qa-final.txt` and `flicker-final.txt`. They are drawn by `src/` in this folder: revision 3's files are `ob3-screens.js`, `ob3-boards.js`, `ob3-motion.js`, `ob3.css`, `ob3.html`, `ob3-motion.html`, `rec3.cjs` (the 60 fps recorder), `recall3.sh` (records every clip), `qa3.cjs` (the render QA, now also on clip frames, with the new `align-btn` rule), `flickall3.sh` (the frame check of every clip, `flicker2.py` with its regions), `regions3.cjs`, `frames3.py` (frame grids for the critic pass), `mkjobs3.py` with `screens3.json` (the render list), `shot3.cjs` and `obcontact3.py`. Revision 3 builds on revision 2's builders (`ob2-*.js`, `ob2.css`), which stay beside it; `ob2-motion2.js` gets the button fix and exports its helpers. They run beside v7's render source as of the design-system branch's latest (`kit.css`, `kit.js`, `screens.js`, `dockv7.js` from `ds-v7/src`, the session builders and `lib/`, with the real `<boopis-logo>`), and draw every orb in the stills with orb3 3.0.0 (`lib/orb-avatar.orb3min.js`, the decided rest pose, ORBS.md section 23) and, until the state table lands, every orb in the clips with the tuned orb2 build (`lib/orb-avatar.tuned.js`).

## The owner's decisions

Revision 1's picks (23 Nov) stand: **O02 A** (the approval rules in the Bots part), **O03 "closer to B"** (Grok's goal tiles, onboarding only), **O04 A** (the living logomark speaks), **C01** approved with much more animation, **C02** (onboarding may have its own animations; the product UI on screen is v7 exactly), and **no new bot character or motion system**.

**O01, revision 3: the owner's final word.** "the entire setup needs to happen directly at the start. after setting up the sessions tab and talking to you through the [oo mark], the oo mark will transform into the boopis bot and the tab will change itself (or it can prompt you to change it). and then boopis bot will take over." And earlier: "why is the entire onboarding happening inside the actual app layout? inside the chatbox? … watch grokbot's onboarding again. it starts normally, as a setup screen, onboarding, animated, you choose your things, etc, and then when you enter in the app the grokbot starts talking to you in his chat." Revision 2's B (one onboarding per tab, each tab running its own the first time it opens) is **replaced**.

**The buttons.** "Let's start" sat left of the centred heading on "Hi, I'm boopis", and "Apply the changes" was off-centre from "Not now" on "Settings boopis needs", in the owner's frames of the clips. Fixed, and guarded by a new QA rule run on clip frames (below).

**The orbs.** Decided later the same day (ORBS.md section 23, K08 B, orb3 3.0.0): a bot at rest in a sidebar or dock context holds the home pose (38, 22, −24) with K07's pills; outside rest (a state, a hover, the chat, a scene) it runs its lively behaviour with its state's face. The stills follow it; the clips wait for the orb agent's state table.

## What onboarding must do

| Must | Source |
|---|---|
| The whole setup first, full window, before the app: animated, led by the oo mark, the person choosing their things (Grok-Bot 001 to 008, BOOPIS-MASTER 3.1) | owner, O01 revision 3 |
| Then Sessions, still led by the oo mark, which carries on into the app as mark A on the new-session canvas | owner |
| Then the hand-off: the oo mark becomes the boopis bot, and the tab changes to Bots by itself or on a prompt | owner |
| Then the boopis bot takes over in its own chat, Grok-style, with choice cards | owner |
| The model before the first real task, pre-selected from the sign-ins on the computer (the Claude CLI, ChatGPT, keys), the lab's top model chosen | owner decisions 5 and 6 |
| Feedforward on by default, with a live **Try it**: a real read when a model is connected, a labelled recording otherwise, ending in "Keep it on / Turn it off" | `w31/specs` feedforward.md 13 |
| The session default step **asked**: the four rows, Auto-accept edits pre-selected; a project with no trusted gate falls back to Supervised | Session board S02 B |
| The approval rules walked through in plain language, in the Bots part | owner decision 10, O02 A |
| Where the bots' computer lives: a container here (recommended), a computer you own, a cloud server, directly here | owner decision 8 |
| Connectors optional, through the Store; reach: the dock (in Sessions), the island and notch, the phone, said honestly where they do not exist yet | owner decision 7 |
| Local first; zero tokens until real work (Try it's one read is on the ledger); no survey, no upsell; every step skippable, with a way back from Settings | Part C 3.0 |

**What setup has to finish** is today's (`apps/desktop/ui/src/host/first-run*.ts`, `src-tauri/src/setup/mod.rs` on `w29/integrate`): the boopis engine (install or update), the boopis plugin and the hx tool, the three engine settings boopis needs (required; "Not now" leaves them declined with Review again in Settings), models and keys, and the engine restart. All of it now happens in part (a): the engine installs behind hello, and the consent is the second page.

## The structure: one continuous first run (board O01)

| Part | Where | Who speaks | Steps | Elapsed |
|---|---|---|---|---|
| **(a) Setup** | the whole window, before the app: no sidebar, composer, title pill or dock; only the window glyphs and "Skip setup" | the oo mark: hero size on hello, 44 above each heading after | O-P01 Hello, O-P02 Settings boopis needs, O-P03 A model, O-P04 Try it | about 0:50 |
| **(b) Sessions** | the app opens round the speaker on the Sessions tab; the new-session canvas | the oo mark, now mark A on the canvas | O-S01 Add a folder, O-S02 Worktree, O-S03 How careful, O-S04 Ready | about 1:20 |
| **(c) The hand-off** | the ready canvas, then the Bots tab | mark A, which becomes the boopis bot | O-H01: "One more thing: your bots"; the morph; the tab switches | about 1:30 |
| **(d) Bots** | the Bots tab, the boopis bot's own chat | the boopis bot | O-B01 boopis greets you, O-B02 What bots are, O-B03 Goals, O-B04 Where, O-B05 Your name, O-B06 Team and connectors, O-B07 Approval rules, O-B08 Build, O-B09 Reach, O-B10 First job | about 3:40 to the first job |

Times are for a person with a sign-in. There is one pair of eyes from hello to the hand-off (the speaker travels from page to page and into mark A, never redrawn), and one boopis bot after it: section 10's "the logo given a body", shown literally once.

### The hand-off (c): auto-switch, with Later visible (recommended)

On the ready canvas, mark A's line takes the place of the launch row: "One more thing: your bots", "A bot of mine takes it from here, in the Bots tab. It has my eyes.", then "Opening Bots in 3 s" and **Later** on one centre line under the heading. Mark A looks over at the Bots tab in the sidebar (a full turn with a blink), then **morphs** where it stands: its eyes shrink and drop into the boopis bot's body, which grows round them, opaque from its first frame, so there are never two faces. The bot wakes and is happy. Then the tab **switches by itself**: the sidebar's Sessions / Bots switch slides to Bots and the sessions list empties; the canvas, its title pill and composer go (120 ms) and boopis's chat comes (200 ms); the bot travels to the head of its chat and hops; its name, its lines, then its choice card. Later stays visible until the switch.

| | Auto-switch with Later (recommended, O-H01) | The bot prompts (the other option, O-H01b) |
|---|---|---|
| What you see | the countdown and Later | Meet your bots / Later |
| For it | the owner's words ("the tab will change itself"); the morph already says something is about to happen; no extra press keeps the run continuous | nothing moves without you; safer for someone surprised by a tab changing under them |
| Against it | a tab that changes by itself can surprise; the countdown and Later answer that | one more press in a run that is otherwise led |

Either way the morph plays on the canvas first, and **Later** leaves you on Sessions, ready to type (O-S04); the Bots part then starts from the morph on the Bots tab's first open (O-X04).

### The ledger: resume, skip and returning users only

`onboarding.json` in the profile home: `{ version: 3, step, parts: { setup, sessions, bots }, answers }`, written as each answer is given. It no longer drives a per-tab onboarding (revision 2's model is retired). It is only for:

- **Resume**: reopening the app mid-way brings back the step it stopped on (O-X01: "Pick up where we left off?" Pick up / Start again / Finish later), on its own surface (a setup page, the canvas, or boopis's chat).
- **Skip**: "Skip setup" on a setup page opens the app on Sessions with what is answered; what is missing is asked where it is first needed (the model by S41's no-model state, how careful by the launch row). Skipping Try it keeps feedforward on. Every card skips with Esc.
- **Later at the hand-off** (or leaving during the Bots part): `parts.bots` stays open; the Bots tab's **first open starts from the morph** (O-X04: mark A at the head of boopis's chat, "Back for your bots? One moment.", then the morph and boopis's greeting), and resumes at the step if it had started.
- **Returning users** (O-X03): an upgrade with sign-ins, bots or sessions gets no first run: one setup page with receipts for what was found and the one new thing, feedforward (Show me / Keep it on, skip the example; "Turn it off" bottom left).
- **Settings, Getting started** (O-X02): Setup (Done, Run it again), Sessions (Done, Run it again), Bots with the boopis bot (Later, Start: it starts from the morph), Try reading drafts (Try it).

## The screens

Every screen is drawn dark and light (`screens/`, 1440 x 900 at 2x).

### (a) Setup, before the app (O-P)

The Page's intro variant (approved in revision 1) on the **whole window**: the heading at 196, the lede, a 760 x 300 scene, the actions at 640, "Skip setup" bottom left, the window glyphs top right; nothing else of the app. Heading, card and actions share one centre line.

**O-P01 Hello** (`O-P01-hello`, `O-P01b-hello-engine-getting-ready`). "Hi, I'm boopis", "A minute of setup here, then sessions, then your bots. I'll walk you through it.", the speaker at the hero size in the scene, Let's start. The engine installs behind it; while it does, the button gives way to the StatusLine "Getting boopis ready" with the percentage. Clips O-M1, O-M6a.

**O-P02 Settings boopis needs** (`O-P02-settings-boopis-needs`, required). The three engine settings as rows with their keys in mono, Apply the changes / Not now. The speaker at 44 above the heading, looking down at the card. Invariant 6.

**O-P03 A model** (`O-P03-model-found`, `O-P03b-model-nothing-found`, `O-P03c-model-signing-in`, `O-P03d-error-sign-in-failed`, `O-P03e-error-offline`). The AskCard's options as a Block: Claude pre-selected (Claude Code, signed in, starts on Claude Opus), ChatGPT, Ollama; Use Claude / Add another. Nothing found: the three sign-ins, Sign in with Claude / Use the free models. Signing in: the speaker looks up and aside (thinking). A failed sign-in: the command in a Well, Check again; the speaker doubts (skeptic). Offline: the Notice above the card. Clip O-M2.

**O-P04 Try it** (`O-P04a-try-it-marks`, `O-P04b-try-it-mark-open`, `O-P04c-try-it-keep-it-on`, `O-P04d-try-it-recorded`). The real composer is the scene (the component, not the app): the draft types itself, the reading draws its marks, a mark opens its menu (above its mark), the choice is sent with the message, then the page asks "Keep reading your drafts?" Keep it on / Turn it off. "Skip the example" while it plays. With no model or a failed read, the labelled recording, its Notice under the composer the whole time (invariant 5). Clip O-M5.

### (b) Sessions (O-S)

The app opens round the speaker (clip O-M6b): the setup page's parts go, the sidebar slides in, the title pill and the composer come, and the speaker lands as **mark A** on S41's canvas. The Sessions tab's shell: the sidebar with its Sessions / Bots switch and "No sessions yet", the title pill, the composer 24 px from the bottom. **No dock**: there is no bot of your own yet, and boopis alone does not count (DESIGN-SYSTEM 21.4, K06). On the canvas the mark, the heading, the line, the buttons and the Block share one centre line; a Block's CTA sits on the Block's content edge.

**O-S01 Add a folder** (`O-S01-add-a-folder`). "Add a folder to start", Add a project / Import sessions.

**O-S02 Worktree** (`O-S02-worktree`). "Where should sessions make changes?", the folder in the launch row, two rows: In a new worktree (recommended: each session gets its own copy, your checkout stays as it is) / In the folder itself; Use worktrees. Writes Settings, Sessions.

**O-S03 How careful** (`O-S03-how-careful`). The four rows, Auto-accept edits pre-selected and marked recommended, Use Auto-accept edits; a project with no trusted gate shows Supervised. The mark looks down at the rows.

**O-S04 Ready** (`O-S04-ready`). "You're set. What's first?", the full launch row, three suggestion Chips. The hand-off begins from here.

### (c) The hand-off (O-H)

**O-H01 One more thing: your bots** (`O-H01-handoff-auto-switch`, recommended; `O-H01b-handoff-prompt-option`, the other option). As described above. The morph and the switch are motion only (stills never show anything in flight): see clip **O-M8** and board O01's morph row.

### (d) Bots: the boopis bot's own chat (O-B)

The Bots tab's shell (ORBS.md K02 A): the open sidebar with its switch, the main boopis bot at 44 centred with its name, then the bots that exist as rows at 28 (all at the sidebar's fixed pose); boopis's chat with its title pill and composer; no dock. Every question is a card in the chat, Grok-style.

**O-B01 boopis greets you** (`O-B01-boopis-greets`). The chat's head: the bot at 64 with its name and "Your main bot. It makes and runs the others." (where the morph lands); "Hi again. Same eyes, now with a body.", "I'm the boopis bot. I make your bots, hand them work, and tell you what it cost. Shall we build your team?", the choice card: Yes, let's go (about two minutes) / Tell me what bots are first / Later (I'll be here, in Bots).

**O-B02 What bots are** (`O-B02-what-bots-are`). "A bot is a teammate with one job. It works on its own computer, on its own time, and asks you before anything risky." The team card: kai, moss and iris at 44 with their jobs, each looking at another; Got it. Clip O-M3.

**O-B03 Goals** (`O-B03-goals-tiles`, `O-B03b-goals-two-picks`). The goal tiles (O03) as a card in the chat; the free bots wait in the card's head and a pick sends one into its tile. Clip O-M7.

**O-B04 Where your bots work** (`O-B04-where-bots-work`): a container here (recommended, about 4 GB), a computer I own, a cloud server, directly here. **O-B05 Your name** (`O-B05-your-name`), with the container downloading. **O-B06 A starter team and connectors** (`O-B06-starter-team-and-connectors`): "Alex it is. Here's a small team for code and reviews."; the plan (Hold to build this team) and GitHub from the Store. **O-B07 The approval rules** (`O-B07-approval-rules`, O02 A). **O-B08 Build** (`O-B08-build`): "They're in your sidebar, under me." Clip O-M4. **O-B09 Reach** (`O-B09-reach`): "The dock, in Sessions". **O-B10 First job** (`O-B10-first-job`): moss's row flags "Needs you". Revision 1's and 2's content and logic, unchanged, in revision 3's order.

### The ledger's screens (O-X)

**O-X01 Resume** (`O-X01-resume`), **O-X02 Settings, Getting started** (`O-X02-settings-getting-started`), **O-X03 Returning users** (`O-X03-returning-user`), **O-X04 The Bots tab's first open after Later** (`O-X04-bots-later-first-open`): as in the ledger above.

## The speaker (O04 A, unchanged from revision 2)

The base is the "oo" mark of DESIGN-SYSTEM.md 20.1. Onboarding gives it a head of its own (owner C02); everything here is onboarding only, and the everyday S41 mark keeps 20.1's calm idle. In revision 3 it speaks from hello to the hand-off, and nowhere after: from the morph on, the boopis bot speaks.

**Two layers.**
- **Eyes**: the shipped `<boopis-logo mark>` with its own idle switched off (`gaze="off" blink="off"`). The speaker's director calls the element's `look(x, y)`, `blink()` and `morph(state)`, so every eye shape, the blink envelope (155 ms) and the morphs (380 ms) are the element's own, never redrawn.
- **Head**: a wrapper the eyes sit in (`.ob-spk-h`, transform origin 50% 62%). It travels, turns (`rotateY` in a perspective of 5.2 W, so the pair compresses toward the side it turns to and the far eye shrinks, as Grok's characters turn), nods (`rotateX`), tilts (`rotate`), bobs, hops, squashes and breathes. There is no body: the head is seen only through what the eyes do.

**Sizes.** W is the pair's width. Hero, on hello: type size 96, W = 111 px. Above a setup page’s heading, and as mark A on the Sessions canvas: type size 44, W = 51 px. Below 44 the mark is the still logo (the title pill, a receipt).

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

## The goal tiles (O03, onboarding only), now in the chat

| | Spec |
|---|---|
| Where | a wide Block in boopis's chat (the thread's 640), its content on the Block's 8 inset; the free bots (kai, iris, nimbus, moss, nina) wait in its head at 24 px |
| Grid | 3 x 2, tiles 200 x 100, gap 8 (revision 2's page: 212 x 104, gap 12; Grok: 3 x 3 of 160 x 77) |
| Tile | the Card's surface (`--bg-3`, `--line`, `--shadow-inline` in light), radius 14 (the Block's 22 less its 8 inset: concentric), continuous corners, 14 inset; icon 16 px in a 28 px disc top left, name `--fs-l` bottom left |
| Hover | the surface plus 4% ink, 120 ms; the free bots look at the tile under the pointer |
| Chosen | a 2 px ring and a 10% tint in the colour of the bot that takes the goal; the bot flies from the head into the icon's disc (660 ms travel, a 40 px arc, 24 to 28 px) and is happy with a bob |
| Which bot | Code and reviews kai, Research and writing iris, Videos and posts nimbus, Data and reports moss, Inbox and calendar nina, Something else none |
| Picks | up to three; a fourth press shakes the tile and the head reads "Up to three. Unpick one first."; the card's Next chip turns on after the first pick, its count beside it |
| Keys and readers | arrows move, Space picks, Enter is Next; each tile is a checkbox ("Code and reviews, kai takes it, checked") |

It is not added to the kit and appears nowhere else; the AskCard stays for every other in-chat question.

## The bots in onboarding

orb2's existing behaviours, used generously (the owner: no new character system), with the orb decisions of 23 Nov (ORBS.md on `w31/bot-character`):

| Decision | In onboarding |
|---|---|
| The tuned renderer (C1 to C3, T1 to T5), `face-scale` 1.25 at 44 and under | every orb (`lib/orb-avatar.tuned.js`, `OB2.orbRules`) |
| The main bot at 44, only in the Bots tab, first below the switch; rows at 28 | the Bots sidebar throughout part (d) |
| **The rest pose, DECIDED (owner, 23 Nov; ORBS.md section 23, K08 B, orb3 3.0.0)** | in the stills, every bot **at rest in a sidebar or dock context** (the Bots sidebar's main bot and idle rows) is drawn by orb3 (`lib/orb-avatar.orb3min.js`, aphesist/orb2 `main` 265777c, byte-identical to the build on `w31/bot-character`) with the home orientation `home="38 22 -24"` and K07's big upright pills (the hidden reaction `pose`: no blink, idle off, mode drift, jelly 0). Onboarding never shows the dock (no own bot exists while it runs) |
| **Outside rest: lively** (owner, 23 Nov) | a bot in a state (kai working, moss needing you), in the boopis chat or in a scene runs that state's lively behaviour (looking around, rotating, with the state's face). A still catches it mid-behaviour: its body part-way through a look-around turn (an orb3 orientation smaller than the rest pose, never it) and its eyes on its look, with the state's face; a held look a scene gives it (the team card's bots looking at each other) turns its body the same way |

**Stills and clips are on different builds for now.** The stills (`ob3.html`) are drawn by orb3 with the rules above (`OB2.orbRules`, extended in `ob3-screens.js`, applies them only where orb3 draws). The rotation out of the rest pose into lively behaviour and back is the orb agent's next build (the state table on `w31/bot-character`); until it lands, **the clips are on hold**: `ob3-motion.html` stays on revision 3's committed build (the tuned orb2 build, the provisional sidebar gaze 32 4, revision 2's `lookAt` cap and round-only turntable), and O-M3, O-M4, O-M7 and O-M8 are not re-recorded. When the state table lands, the motion page switches to orb3, the cap and the round-only turntable go (orb3's eye constraints replace them: a look eases into 0.72 rad of yaw and 0.5 of pitch, the eyes never go edge-on, merge or touch the rim), sidebar bots return to `pose` after a state, and those four clips are re-recorded and checked (`flickall3.sh`, `qa3.cjs --clips`, and orb3's `eyecheck.py` through `eyes3.sh`).

**The rest pose's eyes, checked on the stills** (`eyes3-stills.cjs`: orb3's `eyecheck.py` from `w31/bot-character` probes/tools, on every Bots-sidebar still, dark and light, at 2x): 34 pose orbs across the 22 Bots-sidebar stills, 0 below the width, gap and margin floors, 0 merged or hidden (`eyes-stills.txt`). `edges.py` reads the canvases' own per-frame pixel stats from the character recorder and does not apply to stills or to MP4s; the clips' silhouettes are checked by `flicker2.py`.

| Behaviour | orb2 | Onboarding uses it for |
|---|---|---|
| Wake | the `wake` emote, `reaction` from sleeping | the boopis bot after the morph (O-M8); kai and moss waking (O-M3) |
| Double take | `emote('doubletake')` | iris waking (O-M3) |
| Look at a thing | `lookAt(x, y)`, `gaze` for a held look | bots looking at each other, at boopis, at the tile under the pointer, at the choice card, at you |
| Happy, bob | `react('happy')`, `poke(force, {react: false})` | a bot born, landing at its chat's head, in its tile or on its row |
| Turn | `spin('turntable')` | a round bot turning as it takes off (kai) |
| Blink | `blink()` | a bot noticing; boopis as its lines land |
| Reduced motion | orb2 reduces and never freezes | every bot; travel becomes a dip |

**A render guard for big turns, kept in the clips only.** Until the clips move to orb3 (whose geometry and eye constraints replace orb2's turn clamps, ORBS.md G1 to G3), they keep revision 2's limits: each `lookAt` is capped so the head turns at most about 0.5 rad, and a full turn (`spin('turntable')`) is used on a round body only; a flat body shows interest with `curious`.

**Would need new** (not built in): none. The morph is scene motion between two existing elements (the logo's eyes shrink and fade inside orb2's body), never a new behaviour of either.

## Motion spec

Revision 2's motion is kept: every value is a v7 token (`tokens.v7.json`, 9.2), an element's own constant (orb2, `<boopis-logo>`), or the speaker's (above), plus two NEW onboarding-only easings, the **turn** ease, cubic-bezier(.45, 0, .2, 1), and the **travel** ease, cubic-bezier(.32, 0, .12, 1). Reduced motion, everywhere: nothing travels, scales or turns; a change is a dip (out 90, hidden 60 to 220, in 90 ms), never a cross-fade of two faces; orb2 reduces itself.

| Moment | What moves | Duration and easing | Reduced motion |
|---|---|---|---|
| Page words | heading, then lede (60 later), then actions: opacity and 4 px up | `--dur-2` 200, `--ease-sharp` | opacity only, 150 |
| Step to step | the old page's parts go (120 ms `--ease-out`); the next page's come (200 ms `--ease-sharp`, 50 to 60 apart); parts both pages share never move; one window at a time | 120 + 200 | opacity only |
| One speaker, travelling | from page to page (hero 96 to 44: scale .458), then into mark A | 640 travel (680 into the canvas) | a dip at the old spot, then it is at the new one |
| The speaker wakes (O-P01) | asleep, the head dropped; at 1.2 s `morph(idle)`, the stretch; a double blink; it looks around the empty window (left, a sweep right, up left, a full turn right); it finds you (a hop, happy) | as revision 2 | dips |
| It speaks, reads, is answered, listens | a bob per line; it looks at what is under the pointer and what arrives; a nod then a hop with happy eyes; tilted, its eyes following the draft | as revision 2 | dips |
| **The app opens round the speaker (NEW)** | the setup page's parts go (120); the sidebar slides in 16 px (300 travel, opacity 200 from 140 ms); the title pill (200, from 260 ms) and the composer (200 and 8 px up, from 320 ms); the canvas words from 520 ms; the speaker travels into mark A | 680 travel | opacity only; the speaker dips |
| **The hand-off (NEW)** | the line and Later enter (200, 60 apart); a bob per line; a full turn to the Bots tab (520, turn ease, a blink); back to you | | dips |
| **The morph (NEW)** | the eyes shrink to .35 and drop .18 W (380 `--spring`); the bot, asleep, appears opaque at .45 round them (from 200 ms) and grows (380 `--spring`); the eyes fade inside the body from 220 ms (110 ms), white on white, so never two faces; the bot wakes (600 ms) and is happy with a bob (900 ms) | | the eyes dip out; the bot dips in at the same spot |
| **The tab switches (NEW)** | the switch's pill slides from Sessions to Bots (200 `--ease-sharp`); the sessions list goes (100); the canvas, title pill and composer go (120), boopis's chat comes (200); the bot travels to its chat's head (680 travel) and hops; boopis appears in the sidebar's main slot at the fixed pose (200, from 900 ms) | 200 + 680 | the pill jumps; the bot dips out and in at its chat's head |
| boopis greets you | its name and line (200), its lines 300 to 600 apart, each with a blink; the choice card (200, from .98); it looks at the card and at you | | opacity only |
| The team wakes (O-B02) | the card enters (from .98); one by one, 800 ms apart: wake, look at boopis, happy with a bob, their job chip enters; moss shows interest (curious), iris double-takes; they look round, then at you, blink in a ripple and hop together | orb2's own | orb2 reduced; chips fade |
| A pick takes a bot (O-B03) | the free bots look at the tile under the pointer; a pick: the bot turns (round bodies) and flies from the card's head into the tile's disc (660 travel, a 40 px arc, 24 to 28 px); the icon goes (120); the tile takes its colour as it lands; happy with a bob | | a dip |
| The team assembles (O-B08) | as revision 2: each bot made above the composer, looking at boopis, flying to its row (640 travel, 44 to 28 px) while the row opens; it settles on the sidebar's pose before it lands | | the bot dips out above the composer and in on its row |
| The reading's menu | from scale .98 and 4 px toward its anchor | `--dur-pop` 100 in, `--dur-out` 100 out | opacity only |
| A card answered | its height and opacity to 0; the next lines enter from 4 px | `--dur-3` 300 `--spring` | replaced; the rest fade |

Stills never show anything in flight (QA rule `sweep`).

### The clips

All 1280 x 800, **60 fps**, each with a reduced-motion version (`r`) and a 16-frame strip.

| Clip | Shows | Length |
|---|---|---|
| `O-M1-speaker-wakes.mp4` | O-P01: the speaker asleep, waking, looking round the empty window, finding you, speaking, reading the lede with you, looking at the button | 10.4 s |
| `O-M2-speaker-reacts.mp4` | O-P03: the speaker follows the row under the pointer and the button, is answered (a nod, a hop, happy), reads the receipt | 9.6 s |
| `O-M3-what-bots-are.mp4` | O-B02: the team card in boopis's chat; the three bots wake one by one, look at each other and at boopis in the sidebar, hop together | 9.2 s |
| `O-M4-team-assembles.mp4` | O-B07 to O-B08: the rules kept, each bot made above the composer and flying to its row in the sidebar, settling on the fixed pose | 8.6 s |
| `O-M5-try-it.mp4` | O-P04: the draft typed, the speaker listening and following it, two readings, a mark opened and answered, the page asking, keep it on | 9.5 s |
| `O-M6a-setup-hello-to-model.mp4` | O-P01 to O-P02 to O-P03: one speaker travelling between the setup pages | 8.8 s |
| `O-M6b-setup-into-sessions.mp4` | O-P04 to O-S01 to O-S04: the app opening round the speaker, which lands as mark A; the worktree, how careful, ready | 11.2 s |
| `O-M7-goal-tiles.mp4` | O-B03: the free bots watch the tile under the pointer; two picks, each bot flying into its tile | 9.0 s |
| **`O-M8-handoff.mp4`** | **the hand-off, one continuous clip: mark A on the ready canvas, its line with the countdown and Later, a look at the Bots tab, the morph into the boopis bot, the tab switching by itself, the bot travelling to its chat's head, boopis greeting you with its choice card** | 10.0 s |

How they are made: `src/ob3-motion.js` (with revision 2's `ob2-motion.js` and `ob2-motion2.js` helpers) builds each clip from the same builders as the stills and sets every animated property as a pure function of time; `src/rec3.cjs` runs the page on a virtual clock (`performance.now`, `requestAnimationFrame`, timers, a seeded `Math.random`), advances it one 60 fps frame at a time and pipes each frame into ffmpeg (H.264, CRF 24, 1280 x 800); `src/recall3.sh` records them all, and `src/strip2.py` cuts each strip from the MP4. No frame is kept on disk.

## Quality gates

### Render QA, on stills and on clip frames

`src/qa3.cjs` is revision 2's QA (v7's `render-qa.cjs` with the thumbnail skip and the wider `sweep` rule), plus v7's newer `same-component` rule, plus two things revision 3 adds:

- **Clip frames** (`--clips name[:r],...`): the clip runs on the recorder's virtual clock and the QA runs on **every rest point and each transition's end**: the first frame after which no page part (outside the speaker, the orbs and a status phrase) changes its inline transform, opacity, visibility or text. In clip frames an element counts as visible by its effective opacity (its ancestors' too), and `sweep` is exempt (frames are motion). Every rule runs, the new one included.
- **`align-btn`** (new): stacked or sibling buttons share their centre line (or both edges); a page's CTA group sits on its heading's axis (the centre of the heading's text when centred); a CTA inside a Block or card sits on the card's content edge (the edge its rows start on).

**The owner's two frames, reproduced and fixed.** Run on revision 2's O-M6a, the new rule reported exactly the owner's findings:

```
FAIL clip stepsA: 5 rest points checked  align-btn @0.02s: CTA off its heading's axis by -144.0px: .btn.primary "Let’s start" under .ob-h "Hi, I’m boopis"  ;  align-btn @3.52s: stacked buttons off one centre line by 144.0px: .btn.primary "Apply the changes" / .btn "Not now" | CTA off its heading's axis by -72.0px: .btn.primary "Apply the changes" under .ob-h "Settings boopis needs"
```

The cause: the clips' button press (`press()`, a 4% scale for 100 ms) was given the actions column's `translateX(-50%)` as its base transform, so the pressed button itself shifted left by half its own width (144 px) and stayed there after the press. The stills were never affected, which is why the stills' QA passed. The press now scales the button alone (`ob2-motion2.js`, five calls); revision 2's clips run clean under the new rule, and every revision 3 clip is clean (below).

**Final run** (`qa-final.txt`): every screen dark and light, every board, and every clip's rest points in both motion modes, all rules (wrap, overflow, escape, clip, row, concentric, mark, sweep, baseline, padding, align, align-btn, same-component):

```
ok   clip wake: 3 rest points checked
ok   clip stepsA: 5 rest points checked
ok   clip listen: 4 rest points checked
ok   clip tryit: 50 rest points checked
ok   clip stepsB: 5 rest points checked
ok   clip handoff: 7 rest points checked
ok   clip alive: 9 rest points checked
ok   clip goals: 6 rest points checked
ok   clip assemble: 13 rest points checked
ok   clip wake reduced: 3 rest points checked
ok   clip stepsA reduced: 8 rest points checked
ok   clip listen reduced: 4 rest points checked
ok   clip tryit reduced: 51 rest points checked
ok   clip stepsB reduced: 6 rest points checked
ok   clip handoff reduced: 10 rest points checked
ok   clip alive reduced: 8 rest points checked
ok   clip goals reduced: 7 rest points checked
ok   clip assemble reduced: 19 rest points checked
ok   s=o3P01&theme=dark
ok   s=o3P01&theme=light
ok   s=o3P01&engine=busy&theme=dark
ok   s=o3P01&engine=busy&theme=light
ok   s=o3P02&theme=dark
ok   s=o3P02&theme=light
ok   s=o3P03&theme=dark
ok   s=o3P03&theme=light
ok   s=o3P03&st=none&theme=dark
ok   s=o3P03&st=none&theme=light
ok   s=o3P03&st=waiting&theme=dark
ok   s=o3P03&st=waiting&theme=light
ok   s=o3P03&st=failed&theme=dark
ok   s=o3P03&st=failed&theme=light
ok   s=o3P03&st=offline&theme=dark
ok   s=o3P03&st=offline&theme=light
ok   s=o3P04&phase=shown&theme=dark
ok   s=o3P04&phase=shown&theme=light
ok   s=o3P04&phase=open&theme=dark
ok   s=o3P04&phase=open&theme=light
ok   s=o3P04&phase=ask&theme=dark
ok   s=o3P04&phase=ask&theme=light
ok   s=o3P04&phase=open&rec=1&theme=dark
ok   s=o3P04&phase=open&rec=1&theme=light
ok   s=o3S01&theme=dark
ok   s=o3S01&theme=light
ok   s=o3S02&theme=dark
ok   s=o3S02&theme=light
ok   s=o3S03&theme=dark
ok   s=o3S03&theme=light
ok   s=o3S04&theme=dark
ok   s=o3S04&theme=light
ok   s=o3H01&theme=dark
ok   s=o3H01&theme=light
ok   s=o3H01&v=prompt&theme=dark
ok   s=o3H01&v=prompt&theme=light
ok   s=o3B01&theme=dark
ok   s=o3B01&theme=light
ok   s=o3B02&theme=dark
ok   s=o3B02&theme=light
ok   s=o3B03&theme=dark
ok   s=o3B03&theme=light
ok   s=o3B03&picks=two&theme=dark
ok   s=o3B03&picks=two&theme=light
ok   s=o3B04&theme=dark
ok   s=o3B04&theme=light
ok   s=o3B05&theme=dark
ok   s=o3B05&theme=light
ok   s=o3B06&theme=dark
ok   s=o3B06&theme=light
ok   s=o3B07&theme=dark
ok   s=o3B07&theme=light
ok   s=o3B08&theme=dark
ok   s=o3B08&theme=light
ok   s=o3B09&theme=dark
ok   s=o3B09&theme=light
ok   s=o3B10&theme=dark
ok   s=o3B10&theme=light
ok   s=o3X01&theme=dark
ok   s=o3X01&theme=light
ok   s=o3X02&theme=dark
ok   s=o3X02&theme=light
ok   s=o3X03&theme=dark
ok   s=o3X03&theme=light
ok   s=o3X04&theme=dark
ok   s=o3X04&theme=light
ok   b=o01
ok   b=o02
ok   b=o03
ok   b=o04
ok   b=c01
ok   b=c02

72 pages, 18 clips, 0 findings
```

### Critic pass

**Stills**, by eye at full resolution, each screen dark and light and each board. Checked: the setup page's anatomy (heading at 196, the scene, the actions at 640, one centre line, nothing of the app) on every O-P screen; the canvas's centre line and the Block's CTA on its content edge; no dock anywhere (no own bot yet); the Bots sidebar (boopis at 44, rows at 28, all at the fixed pose); the chat's head; the team and goal cards concentric with their Blocks; the reading's menu above its mark and clear of the heading and the Notice. Found and fixed:

- the goal and team cards put their chips (radius 14) on a 12 px inset in a 22 px Block (`concentric` caught it in the clip frames): the cards now sit their content on the 8 inset, the tiles at radius 14;
- the recorded Try it's Notice sat above the composer, under the reading's menu; it now sits under the composer, the composer where it is in the live version;
- O01's labels under the hand-off thumbnails ran into each other; shortened, thumbnails widened;
- revision 2's Session canvas drew the dock with boopis only, which v7 now forbids (no dock until a bot of your own, 21.4): revision 3's canvas has no dock.

**Clips**, frame by frame around every transition (crops at full size, every frame or every second or third frame, `src/frames3.py`), and by script on every frame (`src/flickall3.sh`): the whole frame for A-B-A flicker and cuts; the speaker's region for the number of eye shapes (more than two is a double image) and its jerk; each tracked orb's silhouette for spikes, jumps and dents. O-M8 was viewed every third frame through the morph (frames 172 to 240: the eyes shrink inside the body while it grows, the body opaque from its first frame, never more than one face) and every ninth through the tab switch (the switch's pill, the list emptying, the bot travelling and landing, the sidebar's slot appearing). Found and fixed:

- the press bug above (the owner's two frames);
- the setup pages' parts were not faded by the step-to-step swap (it only knew the app's main area); they now go in 120 ms like the app's;
- every clip's first ten frames showed orb2's own mount animation (a new orb easing from a circle into its shape: boopis's squircle in the sidebar was round at frame 0; revision 2's clips have it too); the recorder now pre-rolls 30 frames at t = 0, so each clip starts with every orb settled;
- the first check of O-M4 reported jumps on kai's and moss's rows: the next newborn flying past through the crop, not a deformed orb (viewed frame by frame); the windows now end before and start after each fly-past, and are clean.

Final frame check, all eighteen clips (`flicker-final.txt`):

```
O-M1-speaker-wakes.mp4: 624 frames, mean change 0.04, max 0.65 at frame 319; flicker none; cuts over 6 none
  track [470, 300, 340, 200] frames 0-624: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 5.26 px/frame; jerk p99 1.46, max 2.84 at frames [217, 292, 216, 315, 291]
O-M2-speaker-reacts.mp4: 576 frames, mean change 0.01, max 0.43 at frame 246; flicker none; cuts over 6 none
  track [560, 60, 160, 100] frames 0-576: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 1.97 px/frame; jerk p99 0.71, max 1.07 at frames [250, 332, 272, 438, 253]
O-M3-what-bots-are.mp4: 552 frames, mean change 0.01, max 0.43 at frame 79; flicker none; cuts over 6 none
  orb [558,268,52,52] frames 96-552: area 1134-1179 px, convexity median 0.988 min 0.978; area spikes none; jumps over 8% none; dents none
  orb [746,268,52,52] frames 96-552: area 1397-1526 px, convexity median 0.992 min 0.969; area spikes none; jumps over 8% none; dents none
  orb [934,268,52,52] frames 96-552: area 1006-1058 px, convexity median 0.929 min 0.919; area spikes none; jumps over 8% none; dents none
  orb [106,84,52,52] frames 0-552: area 1514-1514 px, convexity median 0.992 min 0.992; area spikes none; jumps over 8% none; dents none
O-M4-team-assembles.mp4: 516 frames, mean change 0.04, max 1.87 at frame 31; flicker none; cuts over 6 none
  orb [106,84,52,52] frames 0-516: area 1504-1522 px, convexity median 0.992 min 0.984; area spikes none; jumps over 8% none; dents none
  orb [10,164,38,38] frames 215-256: area 480-484 px, convexity median 0.978 min 0.976; area spikes none; jumps over 8% none; dents none
  orb [10,164,38,38] frames 300-516: area 480-482 px, convexity median 0.978 min 0.978; area spikes none; jumps over 8% none; dents none
  orb [10,202,38,38] frames 300-340: area 625-626 px, convexity median 0.998 min 0.998; area spikes none; jumps over 8% none; dents none
  orb [10,202,38,38] frames 380-516: area 625-625 px, convexity median 0.998 min 0.998; area spikes none; jumps over 8% none; dents none
  orb [10,242,38,38] frames 390-516: area 407-421 px, convexity median 0.944 min 0.938; area spikes none; jumps over 8% none; dents none
O-M5-try-it.mp4: 570 frames, mean change 0.01, max 0.61 at frame 406; flicker none; cuts over 6 none
  track [560, 60, 160, 100] frames 0-570: shapes per frame 2-2 (expected <= 2); frames with more: none; max speed 1.70 px/frame; jerk p99 0.67, max 1.46 at frames [489, 135, 191, 127, 511]
O-M6a-setup-hello-to-model.mp4: 528 frames, mean change 0.05, max 3.94 at frame 344; flicker none; cuts over 6 none
  track [400, 30, 480, 480] frames 0-528: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 22.78 px/frame; jerk p99 2.24, max 3.83 at frames [164, 163, 165, 162, 170]
O-M6b-setup-into-sessions.mp4: 672 frames, mean change 0.05, max 0.82 at frame 531; flicker none; cuts over 6 none
  track [560, 60, 300, 260] frames 0-672: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 10.84 px/frame; jerk p99 1.19, max 1.86 at frames [92, 93, 536, 90, 94]
O-M7-goal-tiles.mp4: 540 frames, mean change 0.02, max 0.80 at frame 49; flicker none; cuts over 6 none
  orb [504,248,38,38] frames 270-540: area 476-489 px, convexity median 0.984 min 0.967; area spikes none; jumps over 8% none; dents none
  orb [690,248,38,38] frames 400-540: area 417-434 px, convexity median 0.954 min 0.935; area spikes none; jumps over 8% none; dents none
  orb [966,206,32,32] frames 60-540: area 277-292 px, convexity median 0.967 min 0.945; area spikes none; jumps over 8% none; dents none
  orb [1018,206,32,32] frames 60-540: area 310-329 px, convexity median 0.965 min 0.940; area spikes none; jumps over 8% none; dents none
O-M8-handoff.mp4: 600 frames, mean change 0.03, max 0.42 at frame 397; flicker none; cuts over 6 none
  track [708, 196, 130, 96] frames 0-255: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 1.48 px/frame; jerk p99 0.94, max 1.03 at frames [157, 80, 108, 156, 72]
  orb [738,68,70,70] frames 330-600: area 2929-3127 px, convexity median 0.992 min 0.983; area spikes none; jumps over 8% none; dents none
  orb [106,84,52,52] frames 330-600: area 1514-1517 px, convexity median 0.993 min 0.992; area spikes none; jumps over 8% none; dents none
O-M1r-speaker-wakes-reduced-motion.mp4: 624 frames, mean change 0.03, max 0.23 at frame 130; flicker none; cuts over 6 none
  track [470, 300, 340, 200] frames 0-624: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.16 px/frame; jerk p99 0.11, max 0.21 at frames [545, 544, 412, 509, 581]
O-M2r-speaker-reacts-reduced-motion.mp4: 576 frames, mean change 0.01, max 0.31 at frame 250; flicker none; cuts over 6 none
  track [560, 60, 160, 100] frames 0-576: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.18 px/frame; jerk p99 0.18, max 0.23 at frames [267, 455, 299, 540, 276]
O-M3r-what-bots-are-reduced-motion.mp4: 552 frames, mean change 0.01, max 0.25 at frame 85; flicker none; cuts over 6 none
  orb [558,268,52,52] frames 96-552: area 1154-1182 px, convexity median 0.987 min 0.977; area spikes none; jumps over 8% none; dents none
  orb [746,268,52,52] frames 96-552: area 1408-1520 px, convexity median 0.995 min 0.978; area spikes none; jumps over 8% none; dents none
  orb [934,268,52,52] frames 96-552: area 996-1046 px, convexity median 0.929 min 0.915; area spikes none; jumps over 8% none; dents none
  orb [106,84,52,52] frames 0-552: area 1514-1515 px, convexity median 0.992 min 0.992; area spikes none; jumps over 8% none; dents none
O-M4r-team-assembles-reduced-motion.mp4: 516 frames, mean change 0.02, max 5.09 at frame 30; flicker none; cuts over 6 none
  orb [106,84,52,52] frames 0-516: area 1506-1519 px, convexity median 0.992 min 0.989; area spikes none; jumps over 8% none; dents none
  orb [10,164,38,38] frames 215-256: area 475-484 px, convexity median 0.979 min 0.973; area spikes none; jumps over 8% none; dents none
  orb [10,164,38,38] frames 300-516: area 482-484 px, convexity median 0.981 min 0.979; area spikes none; jumps over 8% none; dents none
  orb [10,202,38,38] frames 300-340: area 623-624 px, convexity median 0.999 min 0.999; area spikes none; jumps over 8% none; dents none
  orb [10,202,38,38] frames 380-516: area 623-623 px, convexity median 0.999 min 0.999; area spikes none; jumps over 8% none; dents none
  orb [10,242,38,38] frames 390-516: area 403-418 px, convexity median 0.943 min 0.935; area spikes none; jumps over 8% none; dents none
O-M5r-try-it-reduced-motion.mp4: 570 frames, mean change 0.01, max 0.30 at frame 406; flicker none; cuts over 6 none
  track [560, 60, 160, 100] frames 0-570: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.22 px/frame; jerk p99 0.16, max 0.22 at frames [42, 284, 546, 506, 484]
O-M6ar-setup-hello-to-model-reduced-motion.mp4: 528 frames, mean change 0.04, max 3.92 at frame 344; flicker none; cuts over 6 none
  track [400, 30, 480, 480] frames 0-528: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.62 px/frame; jerk p99 0.21, max 0.61 at frames [254, 56, 2, 481, 502]
O-M6br-setup-into-sessions-reduced-motion.mp4: 672 frames, mean change 0.04, max 0.83 at frame 536; flicker none; cuts over 6 none
  track [560, 60, 300, 260] frames 0-672: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.50 px/frame; jerk p99 0.31, max 0.48 at frames [32, 267, 411, 446, 150]
O-M7r-goal-tiles-reduced-motion.mp4: 540 frames, mean change 0.01, max 0.56 at frame 250; flicker none; cuts over 6 none
  orb [504,248,38,38] frames 270-540: area 473-488 px, convexity median 0.990 min 0.971; area spikes none; jumps over 8% none; dents none
  orb [690,248,38,38] frames 400-540: area 413-431 px, convexity median 0.959 min 0.949; area spikes none; jumps over 8% none; dents none
  orb [966,206,32,32] frames 60-540: area 273-290 px, convexity median 0.971 min 0.953; area spikes none; jumps over 8% none; dents none
  orb [1018,206,32,32] frames 60-540: area 320-331 px, convexity median 0.961 min 0.952; area spikes none; jumps over 8% none; dents none
O-M8r-handoff-reduced-motion.mp4: 600 frames, mean change 0.02, max 0.45 at frame 258; flicker none; cuts over 6 none
  track [708, 196, 130, 96] frames 0-255: shapes per frame 0-2 (expected <= 2); frames with more: none; max speed 0.12 px/frame; jerk p99 0.12, max 0.21 at frames [55, 57, 56, 117, 54]
  orb [738,68,70,70] frames 330-600: area 2923-3121 px, convexity median 0.991 min 0.984; area spikes none; jumps over 8% none; dents none
  orb [106,84,52,52] frames 330-600: area 1514-1515 px, convexity median 0.992 min 0.992; area spikes none; jumps over 8% none; dents none
```

Every clip: no A-B-A flicker, no single-frame cut, never more than two eye shapes (in O-M8 the morph region never shows more than the pair or the one body), no silhouette spike, jump or dent.

**Not checkable here:** WebKitGTK's frame rate (the clips are rendered on a virtual clock in Chromium; the 60 fps check in WebKitGTK belongs to the kit's lab), and real reads for Try it (no live engine in this container: the screens show the reading the spec describes, and the recording path is what a run with no model shows).

## Dependencies

- `w31/bot-character` ORBS.md section 23 (bfc32575): the rest pose is decided (K08 B, orb3 3.0.0) and drawn in the stills. Waiting: the state table (a bot rotating out of the rest pose into lively behaviour and back); then the clips O-M3, O-M4, O-M7 and O-M8 move to orb3 and are re-recorded.
- v7 (`w31/design-system-v7`, merged): the dock only with a bot of your own (21.4), so onboarding draws none; the `same-component` QA rule.
- The speaker's blink is `<boopis-logo>`'s (155 ms); ORBS.md's T1 (0.20 s) applies to orb2.
