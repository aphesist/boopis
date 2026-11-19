# Product

<!-- impeccable:product-schema 1 -->

Written by the wireframe agent from the owner's brief (CONTRACT.md, the coordinator's messages, `data.js`,
the reference images). No interview was possible: every line below is inferred from that brief, not confirmed
by the owner, and should be corrected by them where it is wrong.

## Platform

web

## Stack

Delegated by the brief: vanilla HTML, CSS and JS with no build step, rendered in a Tauri window (custom window
chrome drawn by the page). Published as a claude.ai Artifact for review. Fonts from Google Fonts only.

## Users

One primary user (the owner, "enzo" in the mock data): a developer who runs AI coding agents against their own
repositories most of the day, on Linux, alongside an editor and a terminal. They watch cost closely ("keep it
cheap"), keep several projects going (billing-api, marketing-site, bethunter), and delegate recurring work to
named bots: review, deploys, docs, on-call, data migrations.

## Product Purpose

boopis is a desktop harness for AI coding agents. Two tabs:

- **session**: one unnamed coding agent works on a repository. The user asks in plain language; the agent reads,
  edits, tests and reports, and asks back through structured questions (a blank to fill, an approval) instead of
  long prose. Success: the right change, tested, at the lowest model that can do it, with the user interrupted
  only when their decision is needed.
- **bots**: persistent teammates with names, jobs, schedules and faces (orbs). They work in the background, report
  in a thread and ask for approval before risky actions.

## Positioning

Governed escalation: work starts on a cheap model (qwen3-coder) and climbs a ladder (haiku 4.5, sonnet 5.5, opus
5.5) only after failures or on request, under a cost cap, with the spend visible. The coding agent has no name;
an answer shows only the model that wrote it ("qwen3-coder → sonnet 5.5"). Bots are the opposite: named, with a
face, because they are teammates, not tools.

## Operating Context

Long sessions next to an editor, often in a narrow window. Keyboard first. Attention arrives asynchronously: a
blank waiting in a session, an approval from a bot, a failed gate. The app runs local work in a sandbox
(bubblewrap, network off) with tests as the gate (`npm test`).

## Capabilities and Constraints

- Two tabs: session and bots.
- A dock at the bottom edge, multifunctional (page one: the bots; other pages: widgets), always centred with the
  composer, toggleable; nothing in the interface depends on it.
- A right sidebar in the Antigravity manner: almost nothing when collapsed (a quiet context measure), full panels
  when open (context, connectors, output, environment, tasks, changes, governance).
- Standard harness behaviour everywhere else: command palette, keyboard shortcuts, collapsible sidebars,
  back/forward, settings.
- Red is reserved for attention: a blank waiting, an approval, a failure.
- Bots are drawn with the aphesist/orb2 `<orb-avatar>` component.
- Terminology: session, bots, blank (a question the agent left for the user to fill), approval, ship card,
  governance, governed / ungoverned, gate, ledger.
- Undecided: settings content beyond layout and theme; what the dock's later pages hold beyond the mock.

## Brand Commitments

- Name: "boopis", always lowercase.
- Mark: a φ, neutral (white on dark), never red.
- Bots: orb2 faces with their own colours (data.js).
- Dark is the primary look; a light mirror is optional.
- The owner's Figma, Grok Bot, the Gemini mock-up and Panacea Shell are inspiration for palette and organisation
  only; the visual design is the designer's call.

## Evidence on Hand

- `data.js`: the mock sessions, conversation, bots, threads, context, connectors, output, environment, tasks,
  changes, governance and ledger. All illustrative; no real usage data, users, testimonials or benchmarks exist,
  and none may be invented.
- `ref/`: the owner's Figma frames, Grok Bot's new-bot screen, Panacea Shell screenshots, the halftone card.

## Product Principles

1. The conversation is the work; everything else recedes until it is needed.
2. Interrupt only for decisions: red, motion and sound are spent on the user's attention, nothing else.
3. Every path has a second path: the dock, the sidebars and the palette all reach the same things; the keyboard
   reaches everything.
4. Cost and model are always knowable, never loud.
5. The agent is a tool and stays nameless; bots are teammates and have faces.

## Accessibility & Inclusion

WCAG 2.1 AA as the floor: text contrast 4.5:1, control contrast 3:1, complete keyboard operation with visible
focus, `prefers-reduced-motion` honoured, readable at 200% zoom.
