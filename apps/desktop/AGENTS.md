# AGENTS.md: apps/desktop (the UI half: `ui/`)

The desktop app is a Tauri host (`src-tauri/`, Rust; its guide is the other half of this file) and a UI (`ui/`, TypeScript, Vite, no framework). This half covers `ui/`.

## Job
`apps/desktop/ui` is the **owner's approved v6 design system**, ported to typed ES modules. It draws sessions, bots, the dock and the cards from a data provider and sends the user's actions back to it. It does not design anything: **implement the approved design exactly and never reinterpret it** (root `AGENTS.md` invariant 8, ADR-0009). The source is `design/v6/` (the reference; never edit it) and the system's own docs: `design/v6/design-system/DESIGN-SYSTEM.md`, `KEYMAP.md`, `LAYOUT.md`, `DESIGN.md`, `PRODUCT.md`.

## Layout
```
ui/
  index.html            the app's markup (the shell's chrome), as v6's index.html
  src/main.ts           entry: styles, the web component, the provider, the modules, boot
  src/core/             bus (typed events), state (typed HX.state + setState), registry (slots, provide), settings, log, keys, dom
  src/components/       the HX.ui library, one module per primitive (hold, composer, orb, layer, ...); components.css
  src/modules/          shell, session, bots, dock, cards: each module's TS and CSS
  src/styles/           tokens.css (+ tokens.json, generated), theme.ts (runtime), theme-panel.ts, fonts.ts, index.ts (the cascade order)
  src/data/             THE DATA SEAM: types, provider interfaces, mock provider, README.md
  vendor/               orb-avatar.min.js (the owner's <orb-avatar> web component, MIT) and its .d.ts
  tests/                smoke (Playwright), parity (v6 against the port), lib.mjs
  scripts/              build-tokens.mjs
```
Unit tests sit next to the code (`*.test.ts`).

## Invariants: the owner's decisions (each one must still hold)
Every row of "Owner decisions" in `DESIGN-SYSTEM.md`, and one newer rule. A change that breaks one is a bug, not a trade-off.

| Decision | Where it lives | Checked by |
|---|---|---|
| The dock is pitch black `#000` in every theme, never themeable | `--dock-bg`, `dock.css`, `[data-ground="dock"]` | smoke: "the dock is #000" in 4 presets x 3 modes |
| Cards animate their height when their state changes (the one height animation); reduced motion snaps | `modules/cards/card.ts` `flipHeight` | smoke: card height |
| **Hold to approve takes 1 second**, everywhere | `components/hold.ts`, `--dur-hold` | unit: `hold.test.ts`; smoke: commits at 1 s, in the thread and in the dock |
| Dock orbs: one click (or Enter) opens the bot's session in the dock; the same orb again, Esc or the close button returns to the row; another orb switches; **double-click or mod+Enter** opens the full chat in the Bots tab; no short press | `modules/dock/input.ts`, `controller.ts` | smoke: owner gestures, keys section 8 |
| A click outside returns the dock to rest (the pill stays a pill, an off dock stays off) | `modules/dock/input.ts` `onDocDown`/`onDocUp` | smoke |
| Dock pages: a quiet nub of page dots in the slab's foot; no tab, no side lanes | `engine.ts`, `dock.css` | parity |
| Dock motion: it stays centred on the centre line; content travels inside the slab; reduced motion: size changes are instant, entrances fade, nothing slides or overshoots | `modules/dock/engine.ts` | smoke: reduced motion |
| Reduced motion **reduces and never freezes** the orbs: blinks, eye morphs, small glances stay; large travel, bounce and spin go; `static` only off-screen or tiny | `components/orb.ts` (`glance`, `liven`), `dock/orbs.ts` | smoke: reduced motion |
| Inactive marks reach 3:1 in every preset and on the dock (`--mark-off`) | `tokens.css`, `styles/theme.ts` `PAIRS` | smoke: contrast of all pairs in all presets; unit |
| Nested corners fit their container (concentric radii, `--r-outer`, `--pad`, `--r-in`) | `components.css`, `tokens.css` | parity (pixels) |
| Continuous corners (`corner-shape: superellipse(1.8)`), larger nominal scale; round arc as the fallback | `components.css`, `components/shape.ts` | parity |
| **Every composer can talk**: a mic in each one (session, Bots tab, dock session); the bot's orb listens while you talk; alt+V talks | `components/composer.ts` | smoke: alt+V in the session and the dock |
| Graphite and Typewriter have a real accent (`#9db6cf`, `#7ea6e0`) | `tokens.css` | parity; contrast |
| **Smart and the model picker** (owner, later): **alt+M opens the model picker while Smart stays ON**; its first entry is "Smart" (automatic; the current choice while Smart is on) and then the models; choosing a model pins it and turns Smart off; choosing Smart keeps or turns it back on; Esc changes nothing; with Smart on the model chip stays hidden and the picker opens against the Smart chip; tooltips: Smart = "Picks the model for each message", off = "You pick the model" | `modules/session/composer.ts` | smoke: alt+M, pick a model, alt+M, pick Smart |
| Keyboard first: every action has a key in `KEYMAP.md`; the keymap table feeds the sheet, Settings and the palette | `modules/shell/keymap.ts` | unit: `keymap.test.ts` (the dispatcher); smoke: the whole walk-through |

Also binding: tokens, never literals, for colour, type, radius and space (the CSS is v6's, with no literal colours; do not add any); WCAG 2.2 AA (labels, roles, focus order, contrast, **label in name**: an accessible name must contain the visible text, in order); `<orb-avatar>` stays a vendored web component.

## The data seam
Modules read **only** through `DataProvider` (`src/data/provider.ts`): `Watch`/`Feed` streams plus commands. Never import `mock-data.ts` or `mock-provider.ts` from a module, never keep a second copy of data a provider owns, never fabricate a value (an unknown value is `null` and is shown as unknown). The live provider (the Hermes gateway and the hypotaxis plugin) comes from another workstream and implements the same interfaces. Read `src/data/README.md` before touching anything under `src/data` or any module's data flow.

## How to test
```sh
cd apps/desktop/ui
pnpm install --frozen-lockfile
pnpm typecheck                # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
pnpm test                     # vitest: bus, state, settings, theme and contrast maths, hold timing, the keymap dispatcher, layout, cron, the mock provider, the feedforward reader
pnpm build                    # tokens check, typecheck, vite build
pnpm test:smoke [part]        # Playwright: boot, themes, the KEYMAP walk-through, the owner's decisions, axe (zero violations); parts: boot themes keys owner axe
pnpm test:parity              # LOCAL ONLY (not in CI): needs Chromium (`pnpm exec playwright install chromium` once, or the pre-installed one) and the v6 reference in design/v6; the v6 mock-up against the port at 1440x900 and 1920x1080, in every preset, session and bots; diffs in test-results/parity/ (gitignored)
```
CI runs `typecheck`, `test` and `test:smoke` (it installs Chromium with `pnpm exec playwright install --with-deps chromium`). `playwright` is pinned in `package.json`; on a machine with a pre-installed Chromium keep that pin equal to the installed version and do not run `playwright install`. The tests use, deviceScaleFactor 1, and serve a `vite build --mode e2e` (it exposes `window.__hx` for the tests; the production build has no global). Parity compares pixels with the orbs hidden (their idle motion is random by design) and again with every orb frozen to a still frame, plus the rects of every orb. **Any visible difference from v6 is a bug** unless you can name an intentional fix and list it below.

Intentional differences from v6, all invisible:
- accessible names contain their visible text (WCAG 2.5.3): the session rows say when they ran, the command field and the account button name their words; the avatar's initial is drawn by CSS; a space separates the row's parts and a key's chips in the markup;
- the dock hears the same approval, answer, state and message the Bots and Session tabs do (v6 passed events between modules and the dock missed some);
- a module that fails to mount shows a plain notice instead of v6's placeholder content (which was invented);
- fonts are bundled (`@fontsource`, latin) instead of fetched from Google, because the app runs under a strict CSP;
- the mock's streams persist what v6 lost (a turn typed in a non-first session survives switching away).

## What not to do
- Do not redesign, "improve", re-space or re-colour anything. If the design looks wrong, tell the owner; do not change it.
- Do not edit `design/v6/` (the reference).
- Do not add a framework (no React). Do not add a dependency without an ADR (licences: STANDARDS section 5).
- Do not read `localStorage` directly: go through `core/settings` (wrapped, versioned). Do not use `console` directly: use `core/log`.
- Do not duplicate a primitive: look in `src/components` first (STANDARDS section 9); two places that need a helper put it in `core/` or `components/`.
- Do not hand-edit `src/styles/tokens.json`: `pnpm tokens` generates it from `tokens.css`, and the build checks it.
- Do not make the UI depend on the dock: everything it shows is reachable elsewhere.
- Do not add a global key inside a module: the shell owns global keys (`keymap.ts`); modules handle keys on their own elements and call `preventDefault()`.
- Commits are the owner's alone: `scripts/setup-hooks.sh` once, no co-author lines, nothing that names an agent, a model or a tool.
