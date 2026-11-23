# boopis onboarding and setup, in v7 (proposal)

Status: **for the owner's pick** (23 Nov 2026). Invariant 8: the owner designs the UI. This file offers the options, recommends one, and walks the recommended flow screen by screen, with our logic under each, as `SESSION-TAB.md` does for the Session tab. Nothing here is built.

Renders are in the scratchpad folder `onboarding/`: `boards/` (choice boards O01 to O04, component boards C01 and C02), `screens/` (O01 to O24, dark and light, 1440 x 900 at 2x), `motion/` (five clips and a reduced-motion version, 1280 x 800 MP4, each with its frame strip) and `contact-sheet.jpg`. They are drawn by `src/` in this folder (placed beside v7's render source, the boards' `src/` with `kit.css`, `kit.js`, the screen builders and `lib/`; `mkjobs.py` lists every render, `rec.cjs` records a clip, `obcontact.py` makes the sheet) from v7's own render source: `tokens.v7.css`, `kit.css`, the real `<orb-avatar>` (orb2) and `<boopis-logo>`, and the Bots and Session screen builders. A product screen uses only the kit's 42 components (DESIGN-SYSTEM.md section 21), except the two compositions tagged NEW, FOR APPROVAL (C01).

## What onboarding must do

From the owner's decisions and the binding specs:

| Must | Source |
|---|---|
| Explain boopis as one app with two ways to work: Session (hands on, "Claude Code") and Bots (the team, "Claude Duet") | the owner's request; DESIGN-SYSTEM.md 20 |
| The model step inline in the conversation, before the first real task, pre-selected from the sign-ins already on the computer (the Claude CLI, ChatGPT, keys), the top model of that lab chosen | BOOPIS-MASTER owner decisions 5 and 6 |
| Feedforward on by default, with a live **Try it**: a real read when a model is connected, a labelled recording otherwise, ending in "Keep it on / Turn it off"; after Models, before Connectors | `w31/specs` feedforward.md section 13; PLAN-w31-foundations |
| The default permission step for sessions is **asked**: the four rows, Auto-accept edits pre-selected; a project with no trusted gate falls back to Supervised | Session board S02 B; PLAN-session-waves |
| Walk through the approval rules in plain language: the eight defaults, pre-filled, each kept, edited or removed | owner decision 10; `w31/specs` rules-engine.md section 4 |
| Where the bots' computer lives: this computer in a container (recommended), a computer you own, a cloud server, directly here | owner decision 8 |
| Connectors optional, through the Store and Connectors; reach: the dock, the island and notch, the phone (the engine's messaging gateways), said honestly where they do not exist yet | owner decision 7; Part C C6, C9 |
| The new-session mark is A, the "oo" logomark, with its idle, blink, composer look, sleep and happy morph | DESIGN-SYSTEM.md 20.1 (from `w31/design-system-v7` 94f25ad4, merged here) |
| Local first; zero tokens until real work (Try it's one read is on the ledger); no survey, no upsell; every step skippable, with a way back from Settings | Part C 3.0; the 4.8 brief |

**What setup has to finish**, read from today's code (`apps/desktop/ui/src/host/first-run*.ts`, `src-tauri/src/setup/mod.rs` on `w29/integrate`): the **boopis engine** (install or update; step `runtime`), the **boopis plugin** and the **hx tool**, **Settings boopis needs** (`setup.config`, "Change three settings boopis needs?": `tools.tool_search.enabled = off`, `delegation.backend = boopis`, `plugins.entries.boopis.allow_gateway_injection = true`; required, "Not now" leaves them declined with Review again), **Models and keys** (sign-ins: Claude through the person's own Claude Code CLI, which boopis only looks at with `claude auth status` and never reads a credential of; ChatGPT, GitHub, xAI, API keys, local runtimes such as Ollama, the free models), and **Start with boopis** (the engine restart). Today these are the full-window phases Welcome, Models, Connectors, Store and "You are set" (ADR-0040, `PHASES`). The new flow keeps every one of those steps and moves them: the engine steps run behind the intro; the consent stays a full-window step; Models becomes O05; feedforward's "Try it" (spec section 13) is O06; Connectors and the Store become optional cards where a goal needs them (O16) and stay one click away in the rail.

## The boards

| Board | Decides | Recommended |
|---|---|---|
| **O01** Onboarding structure | A one hybrid onboarding, B a double onboarding (one per tab), C just in time | **A** |
| **O02** Where the approval rules are walked through | A in the Bots branch, B in the shared setup | **A** (the rules apply to bots only, owner answer of 23 Nov) |
| **O03** The goal picker | A the AskCard's lettered rows, B Grok's tiles (a new AskCard variant) | **A** (no new part) |
| **O04** Who speaks in the shared setup | A the app, as the mark A; B the boopis bot from the first line | **A** |
| **C01** New parts, FOR APPROVAL | the Page's intro variant; the Scene (three scenes) | |
| **C02** What onboarding reuses from the kit | the map from screens to the 42 components | |

### O01: the structure (the owner's open question)

| | Structure | Before the first result | Asked twice | Notes |
|---|---|---|---|---|
| **A (recommended)** | **One hybrid onboarding**: a shared intro and setup, then a short branch for the tab you start in; the other tab's intro waits for its first open | 3 intro screens (while the engine installs), the consent, the model, Try it, "Where to start", then 2 steps (Session) or 8 (Bots): about 1:40 to a first session task, 3:30 to a first bot job | nothing | the app is explained once; the shared setup is asked once for both tabs |
| B | **A double onboarding**: one flow per tab, the first time each opens | about 1:30 to a first session task | the model and Try it (or a "seen it" rule), and "what boopis is" | two flows to build and keep in step, against the one-kit rule; neither can explain the whole app |
| C | **Just in time**: one welcome, then each topic at its moment of need | about 0:45 | nothing | the model, how careful and feedforward each interrupt the first real task; nothing explains the two tabs |

**Why A.** It meets the three tests the owner set. One app and one kit: one flow, with the shared part in the conversation surface both tabs already use, built from the kit. The least time to a first real result that still asks what must be asked: C is faster only because it moves those asks into the first task. Nothing explained twice: the intro says what boopis is once, the model and Try it are asked once, and each branch holds only what belongs to its tab. A also takes C's good idea where it costs nothing: the **other tab's intro is just in time**, at its first open, and skips everything already answered.

## The flow, screen by screen

Times are for a person with a sign-in. "Writes" is what a step saves; every answer is saved as it is given (`onboarding.json` in the profile home: `{version, step, answers, seen}`), so closing the window loses nothing.

### Shared intro (full window)

Grok-Bot's anatomy (screens 001 to 008), in the Page's intro variant (C01): one heading at `--fs-3xl`, one line at `--fs-l` in `--text-dim`, a 760 x 300 scene, a 288 px primary pill with a secondary under it, "Skip the intro" as a ghost bottom left, only the window glyphs at the top. The engine installs or updates behind these screens (`runtime`, `plugin`, `hx`), so the wait becomes the introduction. No sidebar, no dock: nothing exists yet.

**O01 Meet boopis** (`O01-meet-boopis`). The wordmark appears; its letters fade; its two eyes, which are the mark A, travel to the centre and grow to the hero size (type size 96, the pair about 70 px wide), then idle with the mark's own glance and blink (20.1). "Work with AI on this computer: hands on, or with a team." Primary: See how it works.
*Logic:* the mark A is the face of every new session (20.1), so the first thing a person meets is what they will see every day; the eyes coming out of the word says the logo and the face are one thing. Clip O-M1.

**O02 Two ways to work** (`O02-two-ways-to-work`). "Steer one task yourself, or hand work to bots that keep going." The scene: two Cards. Sessions, "You and one agent, step by step": your bubble, a Block with a diff in a Well, the composer reading "Steer or queue". Bots, "A team that works on its own": kai, nina and moss, kai working with its StatusLine, nina asking with the amber word.
*Logic:* the owner's question is about two tabs; this is the one place their difference is said, in the tabs' own components, so neither tab has to explain it again and the person recognises both when they get there.

**O03 You stay in charge** (`O03-you-stay-in-charge`). "boopis asks before anything risky. Nothing leaves this computer unless you allow it." The scene: an AskCard (approval: "nina asks, Deploy 0.2.0 to staging, Rule: …, Hold to allow once, Deny") and the SystemLine "Every change is recorded. Undo any turn." Primary: Set up boopis.
*Logic:* both tabs rest on it (approvals for bots, the journal and rewind for sessions); it is the reassurance line the voice rules ask for (section 2). In the clip the card is held to allow (the 1 s hold) and answers.
States: **engine still installing** (`O03b-engine-getting-ready`): the buttons give way to the StatusLine (system variant) "Getting boopis ready" and the percentage in mono; it becomes the button when done. **Engine failed** (`O23a-error-no-engine`): one sentence in `--red-text` ("The engine could not be installed: the download stopped. Nothing else was changed."), Try again and Show what happened (the step's detail and Diagnostics; raw text never on the page, ADR-0041).

**O04 Settings boopis needs** (`O04-settings-boopis-needs`). The existing consent, in the same page: "boopis changes three engine settings, and only these. It asks before it changes any other." A settings Card lists the three, each as what it does and the key in mono. Apply the changes / Not now.
*Logic:* required and unchanged in substance (invariant 6, fail closed). Not now keeps today's behaviour: declined, explained once in the setup conversation, Review again in Settings.
Writes: the three engine settings; the restart runs after O05 if a model changed.

### Shared setup (the conversation, before the branch)

The window becomes the app's ground with the floating chrome: the title pill reads "Set up boopis" with the step in mono ("1 of 3"), and a ghost "Skip setup" sits left of the window glyphs. No sidebar or dock yet. The speaker is the app (O04 A): its bubbles carry the mark A in the 22 px gutter tile where a session's model mark sits (S09). Every line is host-scripted: zero tokens.

**O05 Model** (`O05-model-found`). "Hi. I'll set boopis up with you; it takes about a minute." "First, a model to think with. I found these, so you only need to confirm." An AskCard ("Found on this computer") with OptionRows: Claude (Claude Code, signed in, starts on Claude Opus; pre-selected), ChatGPT (signed in), Ollama (2 models here). Use Claude / Add another / Use the free models. The composer below is disabled ("Choose a model first").
*Logic:* owner decisions 5 and 6. Detection is today's (`claude auth status` for Claude Code, the providers' states for the rest, local runtimes that answer); the default is the first connected lab's top model, and every other connected lab stays connected. Answering collapses the card to the person's bubble and a receipt ("Connected: Claude, your subscription. Starts on Claude Opus."), clip O-M4.
States: **nothing signed in** (`O05b`): the sign-in buttons of the existing hub (Claude, ChatGPT, a Gemini key, More) and "Use the free models" ("Small and slow, but free"); **signing in** (`O05c`): "Finish signing in in your browser. This card updates when it's done." (today's copy); **sign-in failed** (`O23b`): "Claude Code is installed but not signed in", the command in a Well (`claude auth login`), Check again, Copy the command, Use something else; **offline** (`O23c`): the Notice above the composer, "No internet right now. Finish this later; your answers are saved." with Try again.
Writes: the providers' state, the model ladder from what is connected (as today), the boopis bot's model (owner decision 5).

**O06 Try it** (`O06a` marks, `O06b` a mark open, `O06c` keep it on, `O06d` recorded). "One thing boopis does differently: I read what you write before you send it, and mark what I'd otherwise ask you later." "Watch the composer. Open a mark to answer it." The draft "refactor the billing helpers and ship it" types itself into the **real composer** at 25 characters a second, pausing after "helpers"; 250 ms after each pause the reading arrives and its marks draw in (the Mark, feedforward); the line under the composer says what it will assume. A mark opens its Menu ("I read 'ship it' as": Open a pull request, Merge it into main, Commit, don't push, Something else); the choice turns the mark solid accent and a receipt says what would travel. Then the AskCard: "Keep reading my drafts?" with the reader named ("Reads with Claude Haiku, the cheapest model you have. Each read is on the ledger.") and Keep it on / Turn it off.
*Logic:* the spec places it after Models (it needs the reader). Running it in the real composer, not a copy in a card, teaches the feature where it lives, and it is the same component as the session's. With no model, or when the first read fails, the same steps replay the recorded read (`apps/shared/data/feedforward-demo.json`), and the Notice above the composer says so the whole time ("Recorded example. Connect a model and boopis reads your own drafts."); nothing is ever shown as live that is not (invariant 5). Nothing is sent: there is no session yet. Clip O-M3.
Writes: the feedforward setting (on by default; Turn it off writes off).

**O07 Where to start** (`O07-where-to-start`). "That's all boopis needs. Where do you want to start? The other tab is one click away, and it introduces itself the first time you open it." The AskCard (choices): A A session, B Bots, C Decide later (an empty session).
*Logic:* the branch is the person's choice and decides only what comes next, not what they can use. Writes: `seen.shared = true`.

### Session branch (the new-session canvas, S41, mark A)

The window becomes the Session tab: the sidebar's Sessions list ("No sessions yet"), the title pill "New session", the dock with only the boopis orb (no bots exist).

**O08 Add a folder** (`O08-add-a-folder`). S41's no-project state with one line: "A session works in one project folder. Nothing in it changes until you say so." Add a project / Import sessions.

**O09 How careful** (`O09-how-careful`). "How careful should sessions be?" over the launch row (folder, worktree, model) and a Block of the four OptionRows (S01 B), Auto-accept edits pre-selected and marked "recommended"; Use Auto-accept edits; "Change it in Settings, Sessions". A project with no trusted gate shows only Supervised and Full access, with Supervised chosen (owner, 23 Nov).
*Logic:* the owner asked for this step to be asked here. It is asked once, as the default for new sessions; each session's launch row can still change it. Writes: Settings > Sessions > default step.

**O10 The first task** (`O10-first-task`). S41 ready: the mark A, "What's next for boopis?", the launch row with the choices just made, and three suggestion Chips that prefill the composer and never send on their own (Explain how this project is laid out, Find and fix one failing test, Review the last 3 commits). While you type, the mark looks down at the composer (20.1) and feedforward marks the draft. Enter starts the session; onboarding is over for this tab. Clip O-M4 (second half).

### Bots branch (the Bots tab: Grok's full-window moment, then boopis's chat)

The rail holds only the boopis bot until the team is built; the dock likewise.

**O11 Meet the boopis bot** (`O11-meet-the-boopis-bot`). The mark's eyes drop into the boopis orb (ink, cut-out eyes, `squircle`), which comes alive and is happy for a moment. "It works with you, makes your bots, hands them work and tells you what it cost." Show me the bots. "Not now" bottom left leaves the tab on boopis's chat with one line ("I'm here when you want a team.").
*Logic:* section 10 calls the boopis bot "the logo given a body"; this is the one place that is shown literally. Clip O-M2.

**O12 Give each bot a job** (`O12-give-each-bot-a-job`). Three bots asleep wake one after another, each with its job Chip (Reviews pull requests, Night shift, Research with sources). "They work on their own, on this computer, and ask you before anything risky." Make my team / Back. Clip O-M2.

**O13 Where your bots work** (`O13-where-bots-work`). boopis's chat begins (Grok continues its onboarding inside the chat): "Hi, I'm boopis. I make your bots, give them work, and tell you what they did and what it cost." "First, your bots need a computer to work on." The AskCard (choices): A This computer, in a container (recommended, kept apart, about 4 GB); B A computer I own (a home server, paired by a code); C A cloud server (your own server, set up over SSH); D Directly on this computer (no container; risky steps ask).
*Logic:* owner decision 8. The container downloads in the background while the conversation goes on (O14 shows its StatusLine with the size in mono); B and C open their pairing steps in the same card. Writes: the bot computer setting.

**O14 Your name** (`O14-your-name`). "What should I call you?" A your name on this computer, B your login name, C Something else, D Don't use a name. "Your bots use it too."
*Logic:* the house bot is always boopis (renamable later, owner decision 2), so the one name to ask is the owner's (Part C C1). Writes: `house.json` name.

**O15 Pick a goal** (`O15-pick-a-goal`). "What should your bots work on first? Pick up to three." The AskCard (choices, checks for a multiple pick): Code and reviews, Research and writing, Videos and posts, Data and reports, Inbox and calendar ("needs a connector"), Something else. Use these / Skip. Board O03 offers Grok's tiles as B.

**O16 A starter team, and connectors** (`O16-team-and-connectors`). "Here's a small team for that. Nothing is made until you hold the button." The plan card (the AskCard surface): "A small crew for ~/code/boopis": kai, moss, iris, each with its job and model mark; the room and the paused routine; Hold to build this team / Change it / Just you and me. Then, optional and from the Store, at most two connector cards chosen by the goal (GitHub for code), as ListRow items with "Add GitHub"; "Asks before every change. Remove it any time in Settings, Connectors."
*Logic:* Part C C4 and C6; the plan is a template and costs no tokens; nothing is installed without the connector's own review and hold. Change it is the first model turn.

**O17 The approval rules** (`O17-approval-rules`). "Before they start: these are the things every bot asks you about first. Keep, edit or remove any of them." The AskCard lists the eight default rules (rules-engine.md section 4) in plain words under "Your bots ask you before", each with its Switch (kept) and, on hover, Edit and Remove: deleting or overwriting files outside a bot's workspace; running as root, installing or removing packages; disks, the bootloader, system services, /etc; startup files, SSH keys, keyrings, .env and credentials; force-pushing, rewriting history, deleting branches or cloud resources; opening ports, the firewall, VPN or network settings; sending messages, emails or posts, publishing anything; purchases and spending money. "Anything not on the list runs on its own. A check that fails holds the action." Keep these rules / Add a rule / Open in Settings.
*Logic:* owner decision 10. Placed just before the team is built (board O02 A), where the rules start to mean something; the rows use the Queue's geometry (36 rows, radius 18 on the Block's 4 inset) so the 28 px buttons are concentric. Writes: `rules.json` (provenance `default`; a removed default stays removed).

**O18 Build** (`O18-build`). The hold builds the team: the card collapses to boopis's StatusLine, which says each step for at least 800 ms (Making kai, Making moss, Making iris, Seating the crew, Adding the routine, paused); each new bot arrives in the rail and the dock with its phrase (it wakes happy, then idles), the dock's slab growing to fit; the receipt is a SystemLine with Undo ("Built at 09:47: 3 bots, 1 room, 1 routine (paused)"). Clip O-M5.
States (Part C C7): partial ("2 of 3 made. iris couldn't be made: {reason}. Try again"); an engine restart ("Restarting boopis's engine to finish. Nothing is lost.").

**O19 Your bots, everywhere** (`O19-reach`). "You don't need this window open to keep up with your bots." A card of three Rows: the dock (Show me: each orb pokes once), the island and the notch (answer approvals from the top of the screen; a Switch, shown only where the island runs), your phone (message boopis from Telegram, Signal, Slack and the engine's other gateways; Connect a chat app). Done with this / Skip.
*Logic:* owner decision 7; what is not built (the mobile app) is not offered. Turning on a client's access is the owner's (B47): boopis never turns it on itself.

**O20 The first job** (`O20-first-job`). The person gives a first job (a suggestion Chip prefills it): "Review the last 3 commits and list the risks." boopis: "On it. kai leads; moss runs the tests." A hand-off SystemLine, a ToolRow, and then a real approval: "moss asks, boopis started this for you: Install pytest-xdist to run the tests in parallel", naming its rule ("Ask before running as root, and before installing or removing packages") with Hold to allow once, Allow all this turn, Always allow, Deny; moss's tile and dock orb carry the amber flag.
*Logic:* the O17 walkthrough made real on the first job, with no countdown (bots' asks never expire, 17.1). This is the first spend; its cost is on the composer's line.

### Across the flow

**Skip.** "Skip the intro" (O01 to O03) goes straight to the consent and then the setup conversation; "Skip setup" in the chrome goes to the Session canvas with whatever is already answered, and anything still missing is asked where it is first needed (the model by the S41 no-model state, S37; how careful by the launch row; the rules by the Bots tab's first open). Every card also skips with Esc ("Later"). Skipping Try it keeps feedforward on (the spec's default).

**O21 Resume** (`O21-resume`). Reopening an unfinished setup brings back the conversation at the same card: "Pick up where we left off? We were on the last two steps." Pick up / Start again / Finish later. A plan card shown but not held is redrawn (Part C 3.3).

**O22 Settings, getting started** (`O22-settings-getting-started`). Settings > General > Getting started: The intro (Show it again), Setup (Done, Run it again), Sessions tour (Done, Run it again), Bots tour (Not started, Start), Try reading drafts (Try it). Under "This computer": the boopis engine (Up to date, Check now), Models (Change), Where bots work (Change). Running a tour again replays its screens with the current answers pre-filled; nothing is reset unless the person changes it.

**O23 Errors.** No engine (`O23a`, on O03), sign-in failed (`O23b`), offline (`O23c`); one plain sentence and the way out every time; raw text only in Diagnostics.

**O24 Returning users** (`O24-returning-user`). Someone upgrading with sign-ins, bots or sessions gets no intro: "Welcome to the new boopis. You're already set up, so this takes a few seconds." Receipts for what was found (models as before, settings already set, "Your 4 bots and 12 sessions: all here"), then the one new thing, feedforward: Show me / Keep it on, skip the demo / Turn it off. Their tabs never show the intros (`seen` is written for both).

**The other tab's first open.** Session first opened after a Bots start: the S41 canvas with O09's Block (how careful), then O10; the model and Try it are not asked again. Bots first opened after a Session start: O11 and O12, then O13 to O20; the model is not asked again and the rules (O17) are seen here for the first time.

## Motion spec

Every value is a v7 token (`tokens.v7.json`, section 9.2) or an element's own constant (orb2's reactions, `<boopis-logo>`'s idle and blink, 20.1). One proposed token is marked NEW.

| Moment | What moves | Duration and easing | Reduced motion |
|---|---|---|---|
| Intro entry (O01) | the wordmark fades in | `--dur-2` 200, `--ease-out` | cross-fade 150 |
| The eyes lift (O01) | the letters fade (`--dur-2`, `--ease-sharp`); the mark A, sitting on the wordmark's "oo" (whose own eyes are hidden: one pair of eyes the whole time), travels to the centre and grows from type size 64 to 96 | **`--dur-hero` 600 (NEW, FOR APPROVAL: the intro's one long travel)**, `--spring` | the word cross-fades to the mark in place, 150 |
| Page words (any intro step) | heading, then line (60 later), then actions: opacity and 4 px up | `--dur-2`, `--ease-sharp` | opacity only, 150 |
| Step to step (O01 to O03, O11 to O12) | the page cross-fades; buttons stay in place | `--dur-2`, `--ease-sharp` | the same |
| A scene's cards (O02) | each Card from .98 and 4 px, 60 apart | `--dur-2`, `--ease-sharp` | opacity only |
| Orbs come alive (O02, O12, O18) | `reaction` from sleeping to happy (held 800) to idle: orb2's own morph; 500 between bots | orb2's constants | orb2's reduced rule (they reduce, never freeze) |
| The eyes drop into the orb (O11) | the mark falls 12 px and fades (150), then the orb grows from .6 | 150 `--ease-sharp`; `--dur-3` 300 `--spring` | cross-fade 150 |
| A press | scale .96 | `--dur-press` 50 | none |
| Hold to allow, hold to build | the fill sweeps left to right | `--dur-hold` 1000, linear | the fill still shows progress (it is feedback, not decoration) |
| An answered card (every setup step) | the card's height to 0 and fade; the person's bubble, then the receipt, then the next bubble enter from 4 px | `--dur-3` 300 `--spring`; `--dur-2` `--ease-sharp`, 140 apart | the card is replaced; the rest cross-fade 150 |
| Feedforward (O06) | typing 25 characters a second; a reading 250 ms after a pause; a mark draws in left to right | `--mark-dur-in` 180 `--mark-ease`; hover colour `--dur-1` 120; chosen `--dur-1` | the mark appears whole; the menu appears without travel |
| The reading's menu | from scale .98 and 4 px toward its anchor | `--dur-pop` 100 in, `--dur-out` 100 out | opacity only |
| Status phrases (O03, O14, O18) | the shimmer sweep; each phrase held at least 800 | `--dur-shimmer` 2.2 s steps(60); `--dur-hold-phrase` 800 | no sweep; phrases change in place |
| New bots arrive (O18) | the rail tile and the dock slot open (width and the 14 gap), the orb from .98; the slab grows | `--dur-2`, `--spring` | the tile and the orb cross-fade; the slab jumps to its new width |
| The new session's mark (O10) | first keystroke: `look(0, -1)`; 1.2 s after the last keystroke, `look()` | the element's own easing (20.1) | one cross-fade to the down gaze and back |

Stills never show a phrase mid-sweep or a breath mid-cycle: the stills render live text at rest, and the QA checks it (`sweep`, below). The shimmer appears only in the clips.

### The clips

| Clip | Shows | Length |
|---|---|---|
| `O-M1-intro.mp4` | O01 to O03: the eyes lift out of the wordmark into the mark A, its idle; the scene of two ways to work and its bots waking; the ask held to allow | 12.4 s |
| `O-M1r-intro-reduced-motion.mp4` | the same with `prefers-reduced-motion: reduce` | 12.4 s |
| `O-M2-bots-come-alive.mp4` | O11 to O12: the eyes drop into the boopis orb; three bots wake one by one with their jobs | 7.6 s |
| `O-M3-try-it.mp4` | O06: the draft typed, two readings drawn in, a mark opened and answered, the receipt, keep it on | about 9 s |
| `O-M4-step-and-mark.mp4` | O05 answered (the card collapses into the conversation), then O10: the mark looks at the composer while you type, and lets go | 10.4 s |
| `O-M5-build.mp4` | O17 to O18: the rules kept, the StatusLine's phrases, the bots arriving in the rail and the growing dock, the receipt | 7.8 s |

How they are made: `src/motion.js` builds each clip from the same builders as the stills and sets every animated property as a pure function of time; `src/rec.cjs` runs the page on a virtual clock (`performance.now`, `requestAnimationFrame`, timers, a seeded `Math.random`), advances it one 30 fps frame at a time and pipes each frame straight into ffmpeg (H.264, CRF 22, 1280 x 800). The orbs' and the logo's own motion advances on the same clock, so there are no dropped or doubled frames, and no frames are kept on disk.

## New parts (FOR APPROVAL, board C01)

- **Page, intro variant.** The full-window step (O01 to O04, O11, O12): heading `--fs-3xl` 26/32 at top 196, one line `--fs-l` at `--text-dim` (8 under, at most 420 wide, balanced), a 760 x 300 scene 28 under, the actions at y 640 (a 288 x 36 primary pill and a secondary 12 under, or the StatusLine while the engine works), "Skip the intro" as a ghost 24 from the left and 20 from the bottom. The type scale already reserves `--fs-3xl` for "the first-run hero"; the variant is what is new.
- **Scene.** An illustration made only of kit components at their real sizes on Card surfaces, so it themes, scales and animates with the kit: two ways to work (Bubble, Block, Well, Composer at 36, Avatar 44, StatusLine, StatusWord), you stay in charge (AskCard, SystemLine), give each bot a job (Avatar 64, Chip).
- **`--dur-hero` 600 ms** (motion token): the intro's one long travel, the eyes lifting out of the wordmark.

Everything else is the kit (board C02). If the owner picks O03 B, the AskCard gains a tiles variant (tiles 166 x 72, radius 14 on the Block's 8 inset, a 2 px accent ring when chosen).

## Quality gates

### Render QA

`src/qa.cjs` is v7's script with two additions: it skips the boards' scaled thumbnails (each is QA'd as its full screen), and a new rule, **`sweep`**, fails a still that shows a status phrase frozen mid-sweep or a breath frozen mid-cycle (the second reviewer's note on batch 1). Run over every page (64 screens and 6 boards, 70 pages): wrap, overflow, escape, clip, row, concentric, mark, sweep, baseline, padding, align. The final output is at the end of this file.

### Critic pass

Done by eye on every still at full resolution (each dark and light screen, each board) and on every clip frame by frame around each transition, after the QA was clean. What was checked, and what it found and fixed:

- **Baselines and padding against the v7 screens:** the conversation column, bubbles, the composer and its line, the title pill, the rail, the dock and the S41 canvas are the v7 builders' own output (the Bots shell of screens 11 and 17, the Session shell of S17 to S41), so their baselines and padding are the approved ones; only the onboarding cards were checked by hand: every card's text sits on the Block's 12 (8 + 4), every 28 px control on its 8 inset.
- **Found and fixed:** the reading's menu overlapped the composer (O06b, and by 52 px more with the recording's Notice, O06d); a stray space before a comma in an AskCard's head (O20); the Where-to-start rows with and without icons did not share a name column (O07: icons removed); the scaled switches in the rules list (O17: back to the kit's 32 x 20); the rules list's hover buttons were not concentric (now the Queue's geometry); a receipt and a running status phrase shown together (O18); the sign-in buttons wrapping to a second line (O05b); a still showing a receipt before the answer it reports (O06a); the choices card's foot not laid out as a row (O13 to O15) and its right button off the 8 inset; the dock's slab narrower than its orbs; the mark A shown looking ahead in O10 while typing (now `look(0, -1)`, as 20.1 specifies); a needs-you bot with no flag on its rail tile and dock orb (O20); code tokens breaking across lines on board C01.
- **No phrase frozen mid-sweep in any still** (the second reviewer's note): the stills render the shimmer at rest and the new `sweep` QA rule checks it; the sweep exists only in the clips.
- **Clips, frame by frame:** the intro's eyes were first a cross-fade between the wordmark's eyes and the mark, which showed two pairs for four frames; rebuilt so one pair of eyes (the mark, sitting on the hidden "oo") travels the whole way. The boopis orb grew while the mark was still fading (a double face for three frames); now sequential. The answered card's fade finished in two frames; now 200 ms. Every clip was then checked by a script that compares each frame with its neighbours (`src/flicker.py`): no A-B-A flicker and no single-frame jump in any clip; the largest change between two frames is a 200 ms cross-fade or the card collapsing. Motion blur is off (CSS and canvas render crisp frames; ffmpeg adds none).
- **Not checkable here:** WebKitGTK frame rate (the clips are rendered on a virtual clock in Chromium; the 60 fps check belongs to the kit's lab), and real reads for Try it (no live engine in this container: O06 shows the reading the spec describes, and the recording path is what a no-model run shows).

```
O-M1-intro.mp4: 372 frames, mean change 0.05, max 2.30 at frame 250; flicker none; cuts over 6 none
O-M1r-intro-reduced-motion.mp4: 372 frames, mean change 0.04, max 1.12 at frame 253; flicker none; cuts over 6 none
O-M2-bots-come-alive.mp4: 228 frames, mean change 0.05, max 1.88 at frame 94; flicker none; cuts over 6 none
O-M3-try-it.mp4: 270 frames, mean change 0.02, max 0.70 at frame 184; flicker none; cuts over 6 none
O-M4-step-and-mark.mp4: 312 frames, mean change 0.04, max 3.02 at frame 127; flicker none; cuts over 6 none
O-M5-build.mp4: 234 frames, mean change 0.04, max 3.29 at frame 16; flicker none; cuts over 6 none
```

### QA output (final)

```
ok   s=obIntro&step=1&theme=dark
ok   s=obIntro&step=1&theme=light
ok   s=obIntro&step=2&theme=dark
ok   s=obIntro&step=2&theme=light
ok   s=obIntro&step=3&theme=dark
ok   s=obIntro&step=3&theme=light
ok   s=obIntro&step=3&engine=busy&theme=dark
ok   s=obIntro&step=3&engine=busy&theme=light
ok   s=obIntro&step=3&engine=blocked&theme=dark
ok   s=obIntro&step=3&engine=blocked&theme=light
ok   s=obConsent&theme=dark
ok   s=obConsent&theme=light
ok   s=obModels&theme=dark
ok   s=obModels&theme=light
ok   s=obModelsSt&st=none&theme=dark
ok   s=obModelsSt&st=none&theme=light
ok   s=obModelsSt&st=waiting&theme=dark
ok   s=obModelsSt&st=waiting&theme=light
ok   s=obTry&phase=shown&theme=dark
ok   s=obTry&phase=shown&theme=light
ok   s=obTry&phase=open&theme=dark
ok   s=obTry&phase=open&theme=light
ok   s=obTry&phase=ask&theme=dark
ok   s=obTry&phase=ask&theme=light
ok   s=obTry&phase=open&rec=1&theme=dark
ok   s=obTry&phase=open&rec=1&theme=light
ok   s=obWhere&theme=dark
ok   s=obWhere&theme=light
ok   s=obFolder&theme=dark
ok   s=obFolder&theme=light
ok   s=obCareful&theme=dark
ok   s=obCareful&theme=light
ok   s=obFirst&theme=dark
ok   s=obFirst&theme=light
ok   s=obBots&step=1&theme=dark
ok   s=obBots&step=1&theme=light
ok   s=obBots&step=2&theme=dark
ok   s=obBots&step=2&theme=light
ok   s=obBWhere&theme=dark
ok   s=obBWhere&theme=light
ok   s=obBName&theme=dark
ok   s=obBName&theme=light
ok   s=obBGoal&theme=dark
ok   s=obBGoal&theme=light
ok   s=obBTeam&theme=dark
ok   s=obBTeam&theme=light
ok   s=obBRules&theme=dark
ok   s=obBRules&theme=light
ok   s=obBBuild&theme=dark
ok   s=obBBuild&theme=light
ok   s=obBReach&theme=dark
ok   s=obBReach&theme=light
ok   s=obBFirst&theme=dark
ok   s=obBFirst&theme=light
ok   s=obResume&theme=dark
ok   s=obResume&theme=light
ok   s=obSettings&theme=dark
ok   s=obSettings&theme=light
ok   s=obModelsSt&st=failed&theme=dark
ok   s=obModelsSt&st=failed&theme=light
ok   s=obModelsSt&st=offline&theme=dark
ok   s=obModelsSt&st=offline&theme=light
ok   s=obReturning&theme=dark
ok   s=obReturning&theme=light
ok   b=o01
ok   b=o02
ok   b=o03
ok   b=o04
ok   b=c01
ok   b=c02

70 pages, 0 findings
```

