# boopis trailer: research

What the trailer shows, feature by feature: what it is, how it works in boopis, where it lives in the code and docs,
and what is visually distinctive about it (what the camera should look at). Read from the repository on 22 November
2026 (`main` at `f2bcaba3`). The brand rule the owner set for this video: **boopis is the only product brand**, and
the labs and models that take part in a session may appear with their own marks (the vendored marks and sign-in
buttons, as boopis shows them). What boopis is built from never appears: no engine name, no ledger library name, none
of the owner's other projects.

## The owner's spine (in their order)

### 1. Feedforward: the word reading
- **What it is.** As you type in the session composer, the words boopis will act on get a dashed underline: the verb
  ("refactor", "fix", "review"), the scope ("src/billing"), the test run ("run the tests"), what happens when done
  ("open a PR") and the spend ("cheap", "thorough"). A row under the composer says what it will assume:
  "Will assume: >refactor, >src/billing, >npm test, >draft a PR". Click a dashed word, or press alt+down on it, and a
  small menu offers the other readings, each with one line of what it means ("refactor: same behaviour, new structure";
  "fix: the smallest change that makes it right"; "review only: read and comment, no edits"). The pick confirms the
  word and rewrites the assumption. Tab reaches the assumptions; Delete drops one.
- **How it works.** A catalogue of decision kinds (pattern, options, guesses) comes from the data provider;
  `modules/session/feedforward.ts` is the reader: which words are decisions, the guess for each, which are confirmed or
  dropped, and the cost assumption that ties the reading to governance ("governed starts on ..."). The kit composer
  draws the marks (`.ui-ff`, `data-confirmed`) and the assumptions row (`.ui-composer__hint`, `.ui-assume`).
- **Where.** `apps/desktop/ui/src/modules/session/feedforward.ts`, `src/data/mock-data.ts` (`DECISIONS`, the
  catalogue), `src/components/composer.ts` (`feedforward`, `hint`, `ui:decision`, `ui:assumption`), the plugin's
  feedforward events (`docs/ARCHITECTURE.md` section 5), the ledger's `feedforward.set` event.
- **What to show.** Typing that grows dashed underlines word by word; the assumptions row filling in as mono chips; a
  click on "refactor" opening the readings; "fix" chosen, the underline turning solid (confirmed) and the assumption
  rewriting itself. The keyboard path as a keycap pair: alt + down. Nothing else on screen: it is a close-up.

### 2. Governed models: frontier only, a ladder, heavy switches
- **What it is.** Governed mode (on by default) runs only on frontier models: every rung of the ladder and the
  session's own model. The session model orchestrates and never picks the next model itself; a brief runs through the
  ladder in the plugin, every write goes through `ship`, every `ship` ends at the gate (the project's tests, in an OS
  sandbox), and only a failed gate climbs one rung, carrying the brief, the failing output and the rejected diff. The
  workspace rolls back byte for byte on a failure. Heavy frontier models (Claude Fable, Grok, Gemini Carbon today) are
  never chosen by anything automatic: each has an opt-in switch in Settings > Models with the reason in plain words
  ("Climb to Fable": token-heavy, bills credits from the first request on a Pro plan).
- **How it works.** `apps/shared/data/frontier-models.json` lists families with the lowest qualifying version
  (Claude Opus 5.5, Claude Fable 5.2 heavy, GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, Gemini 4 Neon, Gemini 4
  Hydrogen, Gemini 4 Carbon heavy, Grok 4.7 heavy). Three readers (plugin, host, UI) are tested against its examples.
  Setup writes frontier ladders only, cheapest first (ChatGPT: Sol then Astra; Gemini: Hydrogen then Neon; Claude:
  Opus). `heavy_switches` in `apps/shared/data/providers.json`.
- **Where.** ADR-0037, ADR-0007, `docs/ARCHITECTURE.md` section 6, `plugins/boopis/AGENTS.md` ("Governed mode: the
  cascade", "The gate's sandbox"), `src/data/frontier.ts`, the kit's `ui.ladder` (dots, an active brass rung).
- **What to show.** A ladder of real models with their marks (mono, as the app draws them on a ladder), a label
  "frontier only"; an attempt on the first rung, the gate running ("npm test"), a red "failed" stamp, the diff
  restoring, the next rung lighting in brass, "142 passed". Then two heavy switches, off, with their one-line reason;
  the owner's hand turns one on. The ladder never moves by itself to a heavy rung.

### 3. Many models through the plans you already pay for
- **What it is.** First run is one hub: the four account plates with branded buttons ("Sign in with Claude",
  "Sign in with ChatGPT", "Sign in with GitHub" for Copilot, "Sign in with xAI"), a wall of key tiles (Gemini,
  OpenRouter, DeepSeek and the rest), what was found on this computer, your own endpoint, and "Do it later" (the free
  models, no account). Then boopis orchestrates across everything connected:
  - **Who answers next** (alt+M): Smart (automatic, per message) or any model, by provider.
  - **"@" one model**: "@GPT-6.2 Sol fix this" answers that one message with that model; the session's model stays.
    In a governed session, an "@" turn runs ungoverned for that message only, and says so.
  - **The council** (alt+C): several models answer one message, one combines them; one row per member with its mark
    and state word, "Claude Opus combined 3 answers".
  - **Task split**: "send the tests to sol and the docs to gemini" becomes one child card per model, running in
    parallel, each with its mark, goal, clock and summary. A model the person did not name is refused.
  - **Attribution**: every reply carries the mark and name of the model that wrote it, kept across a resume; a
    divider where the model changes ("Claude Opus 5.5 → GPT-6.2 Sol").
- **Where.** ADR-0039, ADR-0040 (the hub, branded sign-ins, "Do it later"), ADR-0032 (Smart), ADR-0034 (task split),
  ADR-0035 (council), ADR-0036 (attribution, "@"), `src/host/providers-hub.ts`, `src/components/signin-button.ts`,
  `src/components/model-mark.ts`, `src/vendor/model-icons/` and `src/vendor/signin-marks/` (with their NOTICE files),
  `src/modules/session/council.ts`, `attribution.ts`, `children.ts`.
- **What to show.** The sign-in buttons assembling into the hub and connecting one by one (each plate turning into
  its receipt), "Do it later" as the quiet way in. The council as three member rows ticking from "thinking" to
  "done" and folding into one combined answer. The "@" menu with brand-coloured marks (the one place the app shows
  colour), the mention chip, and the reply's signed byline.

### 4. Bots, group chats with bots, governed bots
- **What it is.** Teammates with a name, a role, a colour, a shape and a living orb whose eyes follow its state
  (idle, listening, thinking, working, running, replying, needs you, done, asleep, failed). The pitch-black dock holds
  them: one click on an orb opens that bot's session in the dock (its last messages, its open card, a composer), so you
  answer or approve without leaving what you are doing; double-click opens the full chat. Groups are rooms of two to
  six bots: each member reads what you wrote and what the others said and answers in its own words; "@name" asks one.
  Each bot has its own settings: governed or ungoverned, its approvals (deploys, pushes, network, spend, people,
  outside), its workspace (sandbox or worktree), its schedule.
- **Where.** ADR-0033, `docs/ARCHITECTURE.md` section 10a, `src/modules/bots/` (`room.ts`, `group-room.ts`,
  `settings.ts`), `src/modules/dock/`, `design/v6/design-system/DESIGN-SYSTEM.md` sections 13 and 14.12 (the dock is
  `#000` in every theme, owner decision; one click opens the session in the dock).
- **What to show.** Orbs popping in with their names; their faces changing state on the beat; the black slab rising
  with its concave flares; a click on an orb morphing the dock into the session. A room with three orbs, messages
  arriving with their orbs in the margin, a hand-off from one bot to another. A bot's settings with the Governed
  switch and its approvals.

### 5. Auto-learning
- **What it is.** Every bot keeps its own memory and its own skills, and the learning loop runs as part of the work: a
  bot that solves something new writes it down as a skill, refines that skill the next time, and remembers what you
  told it. Presented as boopis's bots learning; nothing names where the loop comes from.
- **Where.** `docs/ARCHITECTURE.md` sections 3 and 10a (each teammate has its own SOUL.md, memory, skills and
  schedule; the learning loop is used as it is); the bot settings' "What it can use" (skills inventory,
  `modules/bots/settings-live.ts`).
- **What to show.** After a task, a skill card writes itself line by line ("rerun a flaky test 20 times before
  touching the code"), lands in the bot's skills, and later gains a refinement (a +/− diff, "v2"). Memory as quiet
  chips that stack beside the bot: "you prefer draft PRs", "invoices round once". The orb looks pleased (done).

### 6. One store for every source
- **What it is.** One in-app store for everything installable: skills, connectors, plugins, mods. Every source is
  searched by default, in one place, locally (no query leaves the machine): boopis's own list, catalogues, registries,
  repositories, a marketplace address you add, a folder on your computer. The front page is Recommended. Each item
  carries its tier in plain words: "Recommended by boopis", "Verified by its source", "Not reviewed". Everything is
  pinned or refused; anything that runs code is approved with the one-second hold; installs take effect in the next
  session.
- **Where.** ADR-0038, `docs/STORE.md`, `apps/shared/data/store-sources.json`, `src/modules/store/`, `mod+shift+S`.
- **What to show.** Many unnamed source tiles (a registry, a repository, a marketplace, a folder) flying from the
  edges into one store window; the search field; the Recommended row; tier words on the items; an install that ends
  on the hold. No source names or logos.

## The point the owner added: no pile of tools

- **What it is.** Agents usually get a long list of tools: read a file, write a file, edit, multi-edit, patch, grep,
  glob, list a directory, find, a terminal, run a command, fetch a page, search the web, a todo list, notebook edits,
  git status, git diff, and so on, each a schema in every prompt. boopis gives the agent three:
  - **`pack` reads**: search with context, whole files, ranges, single symbols, git status, diff and log, byte-capped,
    secrets redacted, `.env` and keys never packed.
  - **`exec` computes**: Python in a persistent asyncio kernel inside an OS sandbox (workspace read-only, scratch
    writable, network off unless allowed); every other capability is a function you call from code
    (`harness.parallel`), each checked by the policy.
  - **`ship` writes**: the only path to the workspace. Every edit is validated before anything is written, journaled,
    applied, then the gate runs; a pass commits to a hidden checkpoint (so any turn can be rewound), a fail restores
    byte and metadata exact.
  In governed mode the orchestrator has only `pack` and `dispatch`; there is no terminal for any role (a command line
  cannot be proved read-only); shell work runs inside the sandbox. Tool search is off, so the three are always
  direct.
- **Where.** `docs/ARCHITECTURE.md` sections 2, 6 and 7, ADR-0004 (`hx`), ADR-0005 (the exec kernel), ADR-0014
  (direct tool surface), `plugins/boopis/AGENTS.md`, `plugins/boopis/tools/schemas.json`, `crates/hx-sandbox`,
  `legacy/ARCHITECTURE_PLAN.md` ("No Tool Bloat": capabilities reachable from code instead of dozens of schemas in
  every prompt).
- **What to show.** A wall of generic tool names in quiet mono, scrolling and crowding the frame; then everything
  collapses into three words, `pack`, `exec`, `ship`, with one line each. Then `exec` drawn inside its sandbox
  boundary (network off, workspace read-only) and `ship` ending at the gate. No product is named; the wall is generic
  verbs.

## Other distinctive features found

| Feature | What it is | Where | Chosen? |
|---|---|---|---|
| **Hold to approve** | The one control that commits by holding: a dot field gathers and fuses into the fill over exactly one second (owner decision), the label inverts, "Approved at 14:09". | DESIGN-SYSTEM 14.15, `components/hold.ts` | Yes: the governed act's payoff, and the store install |
| **The record** | One hash-chained log per session: every model call, tool call, ship, approval, blank and mode change, each line hashed over the one before. Dollars computed from tokens, never stored. A broken chain is flagged, never repaired. | `docs/LEDGER.md` | Yes: "every step on the record" (as boopis's own record, no library named) |
| **The sandbox and the gate** | Tests run in a copy of the tree without secret files, network off, the real workspace not mounted. No sandbox, no gate. | `plugins/boopis/AGENTS.md`, `crates/hx-sandbox` | Yes, inside the no-tools act |
| **Checkpoints and rollback** | Every passing ship is a commit on a hidden ref; a failed ship restores byte for byte. | ARCHITECTURE 7 | Yes, in the gate beat |
| **Forms** | One schema-driven card for everything the agent, a bot, a plugin or a connector needs from you: a key, a choice, a sign-in, a permission, a folder. Secrets go from the field to the keychain, never to the agent. | `docs/FORMS.md`, ADR-0020, `modules/cards/form*.ts` | Yes, montage |
| **Blanks** | The agent leaves a blank only for a real ambiguity: a "waiting for you" stamp and inline options; answering rewrites the sentence and the diff. | ARCHITECTURE 5, `cards` blank kind | Folded into the forms beat |
| **Mods** | Themes, panes, status lines and toasts that mods add, drawn by boopis's own design system so they look native; a mod's colours preview live and stay readable; the composer rises 22px for a status line. | `docs/MODS.md`, ADR-0022, `modules/mods/` | Yes, montage |
| **Four themes** | Card catalog (warm dark, brass), Graphite (neutral, steel), Bone (light), Typewriter (mono, lowercase, carbon blue). The dock stays black in all four. | DESIGN-SYSTEM 5 | Yes, montage (theme wipes) |
| **Keyboard first** | Every action has a key: mod+K palette, alt+M who answers next, alt+C council, alt+G governed, alt+S Smart, alt+V talk, mod+shift+S store. | `design/v6/KEYMAP.md` | Yes, montage |
| **Local-first** | The whole app, its engine and its runtime unpack into its own folder on your machine; keys live in the system keychain; search in the store is local. | README, ADR-0023 | Yes, montage line |
| **Smart** | Picks the model for each message from the ladder (design and migration words climb, a quick question stays low); off by default; its reason shown in the turn. | ADR-0032 | Shown as the chip in the composer; not its own beat |
| **Talk to any composer** | A mic in every composer; the bot's orb listens while you talk (alt+V). | DESIGN-SYSTEM owner decisions | Shown as the listening face in the bots act |
| **Dock gestures** | One click opens a bot's session in the dock, double-click the full chat, pages as a nub of dots. | DESIGN-SYSTEM 14.12 | Yes, the dock beat |
| **Schedules** | Bots run on schedules (nightly digest, flaky-test reruns). | `modules/bots/cron.ts` | Implied by roles; not its own beat |
| **Cost always knowable** | "$0.37 of $0.60", in mono, in the same place every time; a cap the agent cannot pass. | DESIGN-SYSTEM principles | Visible on the composer and the run, not its own beat |
| **Connectors** | Curated, pinned servers with the hosts they reach shown before install. | `docs/CONNECTORS.md` | Folded into the store |
| Formats of other harnesses load unchanged | Skills, plugins, hooks and servers from other tools work as they are. | `docs/COMPAT.md` | Left out: it can only be said by naming other products |
| Homes, vaults, cloud sessions | Later phases. | ADR-0018, ADR-0019 | Left out: not built yet |
| Motion at the display's rate | 120 Hz on Linux, compositor motion. | ADR-0025 | Left out: invisible in a 60 fps video |

## Brand and design notes the trailer follows

- **Name:** always lowercase, "boopis". The wordmark is paths (`<boopis-logo>`), one colour (`currentColor`), never on a
  gradient, never rotated, skewed, blurred or outlined; the protection area is 0.28 of its type size; no tagline
  lockup (the end line sits well outside it, on its own beat). `letters="play"` (the hero) is for a launch: this is
  one, and it is the logo's one big moment.
- **Eyes belong to the state:** orbs get their eyes from their reaction, never a chosen eye shape.
- **The dock is `#000` in every theme.** Hold to approve takes one second. Red only for what you owe (a stamp, "needs
  you", "failed"); brass only for where you are (a ring, the active rung, the caret), never text.
- **Motion:** `--ease` `cubic-bezier(.2, .8, .2, 1)` for UI steps, `--spring` `cubic-bezier(.22, 1, .36, 1)` for travel,
  critically damped springs (no overshoot) for the dock; the logo's letters are the one place that overshoots.
- **Type:** Libre Franklin (400, 500, 600) and IBM Plex Mono, bundled. Interface copy in sentence case; no exclamation
  marks, no em dashes, no filler adjectives.
- **Lab marks:** the vendored LobeHub marks (MIT, `src/vendor/model-icons/NOTICE`) beside model names, mono as the app
  draws them on ladders and bylines, brand colour in the model menu and on the setup hub; the sign-in buttons with the
  labs' own files, unrecoloured (`src/vendor/signin-marks/NOTICE`).
- **Mock data cleaned:** the app's mock content names other projects and services (a channel app, a tracker, a project
  of the owner's); the trailer composes its own data with the kit instead, from boopis's own bot roster (atlas, nina,
  kai, iris, hex, sol, noct, terra, nimbus, vox, moss) and the billing example.
