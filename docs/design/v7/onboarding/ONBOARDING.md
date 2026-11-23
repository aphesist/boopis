# boopis onboarding and setup, in v7 (proposal)

Status: **batch 1 for the owner** (23 Nov 2026): the structure choice (board O01), the recommended flow, and four key frames. Batch 2 adds every screen in dark and light, the other open choices, the component boards, the motion clips and spec, and the contact sheet. Invariant 8: the owner designs the UI; this file offers options and recommends, and the owner picks.

Renders (dark and light, 1440 x 900 at 2x) are in the scratchpad folder `onboarding/` (`boards/`, `screens/`, `motion/`), drawn by `src/` here from v7's own render source: `tokens.v7.css`, `kit.css`, the real `<orb-avatar>` and `<boopis-logo>`, and the Bots and Session screen builders. Nothing on a product screen is drawn outside the kit (DESIGN-SYSTEM.md section 21) except the two parts tagged NEW, FOR APPROVAL below.

## What onboarding must do

From the owner's decisions and the binding specs, not from taste:

| Must | Source |
|---|---|
| Explain boopis as one app with two ways to work: Session (hands on, "Claude Code") and Bots (the team, "Claude Duet") | the owner's request; DESIGN-SYSTEM.md 20 |
| The model step inline in the conversation, before the first real task, pre-selected from the sign-ins already on the computer (Claude CLI, ChatGPT, keys), the top model of that lab chosen | BOOPIS-MASTER owner decisions 5 and 6 |
| Feedforward on by default, with a live **Try it**: a real read when a model is connected, a labelled recording otherwise, ending in "Keep it on / Turn it off"; after Models, before Connectors | `w31/specs` feedforward.md section 13; PLAN-w31-foundations |
| The default permission step for sessions is **asked**: the four rows, Auto-accept edits pre-selected; a project with no trusted gate falls back to Supervised | Session board S02 B; PLAN-session-waves |
| Walk through the approval rules in plain language: the eight default rules, pre-filled, each kept, edited or removed | owner decision 10; `w31/specs` rules-engine.md section 4 |
| Where the bots' computer lives (this computer in a container, recommended; a computer you own; a cloud server; directly here) | owner decision 8 |
| Connectors optional, through the Store and Connectors; reach: the dock, the island and notch, the phone (the engine's messaging gateways), said honestly where they do not exist yet | owner decision 7; Part C C6, C9 |
| The new-session mark is A, the "oo" logomark, with its own idle, blink, composer look, sleep and happy morph | DESIGN-SYSTEM.md 20.1 (merged from `w31/design-system-v7` 94f25ad4) |
| Local first, zero tokens until real work (Try it's one read goes on the ledger), no survey, no upsell, every step skippable, a way back from Settings | Part C 3.0 rules; 4.8 brief |

What setup has to finish, from today's code (`apps/desktop/ui/src/host/first-run*.ts`, `src-tauri/src/setup/mod.rs`, read on `w29/integrate`): the **boopis engine** (install or update, `runtime`), the **boopis plugin** and the **hx tool**, **Settings boopis needs** (the consent card `setup.config`, "Change three settings boopis needs?": tool search off, delegation through boopis, gateway injection on; required), **Models and keys** (sign-ins: Claude through the user's own Claude Code CLI, which boopis only looks at; ChatGPT, GitHub, xAI, keys, local runtimes such as Ollama, the free models), and **Start with boopis** (the engine restart). Today these are the full-window Welcome, Models, Connectors, Store, "You are set" (ADR-0040). The new flow keeps every one of those steps and moves them.

## O01: the structure (the owner's open question)

Board `boards/O01-structure.jpg`. Three structures, each as a flow with its key frames:

| | Structure | Before the first result | Asked twice | Notes |
|---|---|---|---|---|
| **A (recommended)** | **One hybrid onboarding**: a shared intro and setup, then a short branch for the tab you start in; the other tab's intro waits for its first open | 3 intro screens (while the engine unpacks), the consent, the model, Try it, "Where to start", then 2 steps (Session) or 6 (Bots). About 1:40 to a first session task, 3:30 to a first bot job | nothing | the app is explained once; the shared setup is asked once for both tabs |
| B | **A double onboarding**: one flow per tab, the first time each opens | about 1:30 to a first session task | the model and Try it (or a "seen it" rule), and "what boopis is" | two flows to build and keep in step, against the one-kit rule; neither can explain the whole app |
| C | **Just in time**: one welcome, then each topic at its moment of need | about 0:45 | nothing | the model, how careful and feedforward each interrupt the first real task; nothing ever explains the two tabs |

**Why A.** It meets all three tests the owner set: one app and one kit (one flow, built from the kit's own components, with the shared part in the same conversation surface both tabs use); the least time to a first real result that still asks what must be asked (C is faster only because it moves those asks into the first task); and nothing explained twice (the intro says what boopis is once; the model and Try it are asked once; each branch holds only what is specific to its tab). It takes C's good idea where it costs nothing: the **other tab's intro is just in time**, at its first open, and skips everything already answered.

## The recommended flow, screen by screen (outline)

Numbering is the screens' (O-NN). Under each, its logic; batch 2 adds the states, copy and motion in full.

**Shared intro** (full window, no sidebar; Grok-Bot's anatomy: one heading, one line, one scene, one primary, a ghost; "Skip the intro" bottom left). The engine installs or updates behind these three screens, so the wait is the introduction.

- **O01 Meet boopis.** The wordmark plays its letters (the logo's one allowed big moment), the two eyes lift out of the "oo" and settle as the mark A at hero size, then idle (glance, blink). "Work with AI on this computer: hands on, or with a team." *Why:* the mark A is the app's face everywhere a new session starts (20.1), so the first thing a person meets is the thing they will see every day.
- **O02 Two ways to work.** A scene of two cards made of real components: a session in miniature (your bubble, a diff block, the composer) and the bots (three orbs, one working with the status line, one asking with the amber word). *Why:* the owner's question is about two tabs; this is the one place the difference is said, so neither tab has to say it again.
- **O03 You stay in charge.** An approval waiting (the AskCard, approval variant) and the SystemLine "Every change is recorded. Undo any turn." *Why:* both tabs rest on it (approvals for bots, the journal and rewind for sessions); it is also the reassurance line the voice rules ask for under risky things. If the engine has not finished, the primary becomes the StatusLine "Getting boopis ready" with its percentage; if it failed, one plain sentence in red text and Try again.
- **O04 Settings boopis needs.** The existing consent card, unchanged in substance, required. *Why:* nothing in the engine changes without the person's word (invariant 6, fail closed).

**Shared setup** (the app window, in the conversation column; the speaker is boopis the app, shown by the mark A in the 22 px gutter tile where a session's model mark sits, S09; host-scripted, zero tokens).

- **O05 Model.** "First, a model to think with. I found these, so you only need to confirm." An AskCard (choices) lists what is signed in on this computer, the top one pre-selected with its top model (Claude: Claude Opus); Add another; Use the free models. *Why:* owner decision 6. Returning users with a sign-in see one receipt line and move on.
- **O06 Try it.** The draft "refactor the billing helpers and ship it" types itself into the **real composer** at the bottom of the window; the marks draw in; one opens ("I read 'ship it' as": Open a pull request, Merge it into main, Commit, don't push, Something else); the choice turns solid accent and a receipt says what would travel; then "Keep reading my drafts?" Keep it on / Turn it off. With no model, the same in a recording, labelled the whole time ("Recorded example. Connect a model and boopis reads your own drafts."). *Why:* the spec puts it after Models; doing it in the real composer teaches the feature where it lives, instead of in a copy.
- **O07 Where to start.** "Where do you want to start?" Session or Bots (AskCard, choices); the other tab waits. *Why:* the branch is the person's choice, and it decides only what comes next, not what they can use.

**Session branch** (the new-session canvas S41, mark A).

- **O08 Add a folder.** S41's no-project state: Add a project, Import sessions.
- **O09 How careful.** The four OptionRows (S01 B) in the canvas, Auto-accept edits pre-selected (S02 B), "Without a trusted gate this project starts Supervised" when that applies; "Change it any time in Settings, Sessions". *Why:* the owner asked for this step to be asked in onboarding.
- **O10 The first task.** S41 ready: suggestion chips prefill the composer (never send on their own); the mark looks down at the composer while you type; feedforward is on.

**Bots branch** (the Bots tab; Grok-Bot's full-window screens, then the conversation with the boopis bot).

- **O11 Meet the boopis bot.** The mark's eyes drop into the boopis orb (ink, cut-out eyes), which comes alive. "It works with you, makes your bots, hands them work and tells you what it cost."
- **O12 Give each bot a job.** Three orbs, asleep, wake one after another with their job pills (Reviews pull requests, Night shift, Research with sources).
- **O13 Where your bots work.** In the boopis bot's chat: This computer, in a container (recommended, with the disk cost); A computer I own; A cloud server; Directly on this computer, with approvals.
- **O14 Hello, and your name.** "What should I call you?" (A to D).
- **O15 Pick a goal.** Up to three goals (an open choice for batch 2: the kit's lettered rows, or Grok's tiles as a new AskCard variant).
- **O16 A starter team and connectors.** The plan card (nothing made until the hold), and at most two connector cards chosen by the goal (GitHub for code), each optional, through the Store and Connectors.
- **O17 The approval rules.** The eight default rules in plain words, each with Keep (on), Edit and Remove; "Anything not on the list runs on its own." *Why:* owner decision 10, and the rules apply to bots only (owner, 23 Nov), so this is where they mean something.
- **O18 Build.** The hold; the new bots come alive in the rail and the dock one after another; the receipt with Undo.
- **O19 Your bots, everywhere.** The dock, the island and notch (where they run), the phone through the engine's messaging gateways (Telegram, Signal, ...).
- **O20 The first job.** Suggestion chips; the bot works; a real approval arrives and names its rule, the walkthrough of O17 made real.

**Across the flow** (batch 2): O21 resume ("Pick up where we left off?"), O22 Settings > General > Onboarding (show the intro again, each tab's tour), O23 errors (no engine, sign-in failed, offline), O24 returning users with sign-ins and bots, O25 the other tab's first open.

## Key frames in batch 1

| Screen | Files |
|---|---|
| O01 Meet boopis | `screens/O01-meet-boopis-{dark,light}.jpg` |
| O02 Two ways to work | `screens/O02-two-ways-to-work-{dark,light}.jpg` |
| O06 Try it, a mark open in the real composer | `screens/O06-try-it-{dark,light}.jpg` |
| O12 Give each bot a job | `screens/O12-give-each-bot-a-job-{dark,light}.jpg` |

## New parts (FOR APPROVAL; boards in batch 2)

- **Page, intro variant**: the full-window step (heading `--fs-3xl`, one line `--fs-l` at `--text-dim`, a 300 px scene, a 288 px primary pill with a secondary under it, a ghost bottom left). The type scale already reserves `--fs-3xl` for "the first-run hero"; the variant is new.
- **Scene**: an illustration made only of kit components at their real sizes on Card surfaces (Avatar, Bubble, Block, Well, Composer, StatusLine, AskCard, SystemLine). It is a pattern, not a drawing: it themes, scales and animates with the kit.

## Render QA (batch 1)

`qa.cjs` (v7's script; this copy skips the board's scaled thumbnails, which are QA'd as full screens) over every batch-1 page: wrap, overflow, escape, clip, row, concentric, mark, baseline, padding, align.

```
ok   s=obIntro&step=1&theme=dark
ok   s=obIntro&step=1&theme=light
ok   s=obIntro&step=2&theme=dark
ok   s=obIntro&step=2&theme=light
ok   s=obTry&phase=open&theme=dark
ok   s=obTry&phase=open&theme=light
ok   s=obBots&step=2&theme=dark
ok   s=obBots&step=2&theme=light
ok   b=o01

9 pages, 0 findings
```
