# hypotaxis design system

Version 1.0, extracted from the v6 mock-up on 18 November 2026 by the design-system agent.

This file is the source of truth for how hypotaxis looks, reads, moves and behaves. Everything else follows it:

| File | What it is |
|---|---|
| `design-system/DESIGN-SYSTEM.md` | This document: principles, voice, tokens, theming, foundations, every component, findings. |
| `design-system/tokens.json` | The tokens in W3C Design Tokens format (2025.10), the four presets as modes. Generated, never edited by hand. |
| `design-system/build-tokens.mjs` | Regenerates `tokens.json` from `tokens.css`; `--report` prints the contrast table below. |
| `design-system/index.html` | The specimen: every token and component, live, in every preset. Published as the Artifact "hypotaxis system". |
| `design-system/MIGRATION.md` | Module by module: which local implementation to delete and which `HX.ui` call replaces it. |
| `components/components.css`, `components/components.js` | The shared component library (`HX.ui`). One canonical version of every piece more than one module draws. |
| `tokens.css`, `theme.js` | The token source and the theme runtime (unchanged by this pass; proposed changes are listed in Findings). |
| `cards.js`, `cards.css` | The card layer (`HX.cards`), promoted as the canonical card implementation and reachable as `HX.ui.card`. |
| `DESIGN.md`, `LAYOUT.md`, `PRODUCT.md` | The wireframe agent's world, geometry and product brief. Where this file and they disagree, this file is newer. |

**How this was made.** The owner could not be asked. Every rule here is read from the mock-up's code, its screenshots
(`shots/integration/`), `CONTRACT.md`, `DESIGN.md`, `LAYOUT.md` and `PRODUCT.md`, then checked in a real browser. Where
I had to choose between two incumbent versions of the same thing, I say which and why; those choices are marked
**Decision**. Choices the owner has made are marked **Owner decision** and are not open to re-inference. Where the
mock-up breaks its own rules, the fix is in [Findings](#16-findings).

**Owner decisions** (confirmed by the owner, not inferred):

| Decision | Where it applies |
|---|---|
| The dock is pitch black (`#000`) in every theme and is not themeable. | 4.1, 4.6, 5.3, 14.12 |
| Cards animate their height when their state changes, so the conversation never jumps (the one height animation). | 11, 14.13 |
| **Hold to approve takes 1 second**, everywhere (confirmed 18 November 2026). | 11, 14.15 |
| **Dock orbs:** one click (or Enter) opens the bot's session in the dock (its last messages, its open card, a composer), so you answer, message or approve without leaving the tab; the same orb again, Esc or the close button returns to the row; another orb switches; a double-click (or mod+Enter) opens the full chat in the Bots tab. No short press (revised 18 November 2026, v10). | 13, 14.12 |
| **Dock pages:** a quiet nub of page dots in the slab's foot, near the window edge (the current page a short pill, the others `--mark-off` dots), between Arrange and Minimise. No tab on the top edge, no side lanes or arrows; the minimised pill offers restore only (v10). | 14.12 |
| **Dock motion:** the dock stays centred on the centre line and its content travels inside the slab; under reduced motion a size change is instant (entrances fade), with no sliding or overshoot (v10). | 12, 14.12 |
| **Reduced motion reduces and never freezes the orbs:** blinks, eye morphs, small glances and reactions stay; large travel, bounce and spin go. `static` only for orbs off-screen or tiny thumbnails (16px, or picker tiles up to 28px). The one orb you are looking at (presence, new-bot preview) always has a step every 1.8s (the glance lead). | 11, 13 |
| **Inactive marks reach 3:1** (page dots, ladder stations to come; non-text, WCAG 1.4.11) in every preset and on the dock, and stay visibly quieter than the active marks (`--mark-off`). | 4.5, 4.6, 14.27 |
| **Nested corners fit their container (concentric radii).** Every rounded surface inside another follows the outer curve: inner radius = outer radius − the gap, never under a floor of 8; where the arithmetic would go under the floor, the padding gives way, not the radius (Apple keeps inner radii generous). A round piece inside a pill stays a pill. Systemic: containers declare `--r-outer` and `--pad`, what sits in their corners takes `--r-in`. | 1, 8, 14 |
| **Apple continuous corners in every engine** (revised 18 November 2026: the owner's main platform is Linux, Tauri on WebKitGTK, where `corner-shape` does nothing). The corner is drawn as a path, Figma's corner smoothing at 0.6 as on iOS, by `HX.ui.squircle`, so WebKit and Chromium show the same curve. Radii are generous: sheets and the dock 30, cards 20, buttons, rows and fields 12, chips a capsule. | 8 |
| **Every composer can talk:** a mic in each one (the session, the Bots tab, the dock's session); when a bot is the target, its orb listens while you talk. mod+Enter still sends; alt+V talks. The dock session's send no longer floats: the composer's actions sit in its corner, concentric with it. | 14.10 |
| **Graphite and Typewriter have a real accent:** Graphite steel `#9db6cf`, Typewriter carbon-paper blue `#7ea6e0`, so "you are here" is distinct from text in every preset. | 4.3, 5.4 |
| **Provider logos beside every model name** (19 November 2026). The model that answered shows its provider's logo next to its name, never instead of it: monochrome in `currentColor` everywhere (origin slots, queue rows, the session's model line and composer chip, the ladder, the dock run), full brand colour only in the model selection menu and its chip preview. The family comes from the model id, never the host (Claude through Bedrock is Claude); an unknown family gets a neutral generic mark, never the φ. One primitive, `HX.ui.modelMark`; icons from LobeHub (MIT) in `vendor/model-icons/`. | 10.1, 12 |

---

## Contents

1. [Principles](#1-principles)
2. [Voice and copy](#2-voice-and-copy)
3. [Token architecture](#3-token-architecture)
4. [Colour](#4-colour)
5. [Theming contract](#5-theming-contract)
6. [Typography](#6-typography)
7. [Space, density and layout](#7-space-density-and-layout)
8. [Shape](#8-shape)
9. [Elevation, hairlines and depth](#9-elevation-hairlines-and-depth)
10. [Iconography](#10-iconography)
11. [Motion](#11-motion)
12. [The φ mark](#12-the-φ-mark)
13. [Bots and orbs](#13-bots-and-orbs)
14. [Components](#14-components)
15. [Accessibility](#15-accessibility)
16. [Findings](#16-findings)
17. [Open questions](#17-open-questions)
18. [Appendix: Tailwind v4 and React](#18-appendix-tailwind-v4-and-react)

---

## 1. Principles

Ordered. When two collide, the higher one wins.

1. **The conversation is the work.** The column, the request and the answer own the ground; the frame, the panels
   and the dock recede until called. *Why:* the user spends the day reading what an agent did. Anything that
   competes with the measure costs attention the product is supposed to save.
2. **Interrupt only for decisions.** Red, motion and sound are spent on the user's attention: a blank waiting, an
   approval, a failed gate. Nothing else is red, nothing else loops. *Why:* attention arrives asynchronously (a bot
   asks from the background); if anything else were red, the one thing that is owed would be missed.
3. **Cost and model are always knowable, never loud.** Model, elapsed time and cost live in the call-number margin
   and in running totals against their limit ("$0.37 of $0.60"), in mono, in the same place every time. *Why:* the
   product's position is governed escalation under a cap; the user must be able to check it at a glance without it
   becoming the subject.
4. **Every path has a second path.** The dock, the sidebars and the palette reach the same things; the keyboard
   reaches everything. No component is the only way to do something. *Why:* the dock can be turned off and the
   sidebars collapse; a keyboard-first developer never has to reach for the pointer.
5. **The agent is a tool and stays nameless; bots are teammates and have faces.** An answer shows only the model
   that wrote it. A bot always shows orb, name, role, schedule and state word, in that order, in the same places.
   *Why:* it tells the user who they are dealing with before they read a word.
6. **Standard controls, one signature.** Buttons, rows, tabs, menus and fields behave the way a developer already
   expects from desktop harnesses. The card-catalog world lends palette, type, density and one signature move, the
   call-number margin; it never supplies the controls. *Why:* this is an Operate surface; familiarity is a feature,
   and expression lives in precise details.
7. **One canonical component per job.** A piece drawn by two modules is drawn by the library. *Why:* the owner asked
   for no redundancy and no re-design; three hold-to-approve buttons is three products.
8. **Corners fit, and they are continuous** (Owner decision). A corner inside another follows it: the inner radius is
   the outer less the gap, never under the floor, judged by eye, never chosen per module; and every corner eases out
   of its edge instead of meeting it as an arc, in every engine the app runs in. *Why:* nested shapes that do not share a centre read as stacked parts rather than one
   object, and a plain arc against a straight edge reads as "square roundness".

## 2. Voice and copy

Plain words a developer would say out loud, in sentence case.

- **Sentence case** for interface text: "New session", "Show the dock", "Hold to approve", "Session details".
  The brand is always lowercase: hypotaxis. Content keeps its own case: session titles, bot names and roles,
  messages, code, model names. In the Typewriter preset (or with the case setting on lowercase) interface labels go
  lowercase through `text-transform: var(--ui-case)`; content never does.
- **Buttons are a verb and its object**: Open PR, View diff, Fix and retry, Raise cap to $1.00, Schedule it, Sign in,
  Compact conversation. A bare verb is fine where the object is obvious from the card (Deny, Accept, Answer, Stop).
  Never OK, Submit, Continue, Learn more.
- **State words** are one or two lowercase words in mono, from one vocabulary (section 13): working, running,
  thinking, replying, listening, needs you, done, asleep, paused, failed. Idle shows nothing in lists.
- **Stamps** have three wordings only: "waiting for you" (a blank), "needs you" (an approval, a capped escalation),
  "failed" (a gate, a ship, a sign-in).
- **Receipts** say what happened and when, in the card's foot: "Approved at 14:09", "Expired at 14:17, nothing ran",
  "Passed on retry at 14:22". The time is mono.
- **Errors** name the problem and the way out: "Days of the week run from 0 to 6. Try 0 9 * * 1-5." "The browser
  closed before Linear sent a token. Try again, or sign in later from Connectors."
- **Tooltips** name the control, then its keys: "Hide sidebar ctrl B". The tooltip repeats the aria-label; it never
  carries information that is only in the tooltip.
- **Capacities** are a running total against the limit: "$0.37 of $0.60", "76k / 200k", "2 of 5".
- **Cost and model** appear in the margin, not in the prose. The prose never says "I used sonnet".
- **Bans in interface copy:** all caps, middle-dot meta strings ("3m · $0.37"), em dashes, exclamation marks, arrows
  after links, "please", jokes, filler adjectives (seamless, powerful, simply). The arrow in a model escalation
  ("qwen3-coder → sonnet 5.5") is content, not decoration.
- **Numbers** carry their unit and sit in mono with tabular figures: "3m 42s", "$0.37", "142 passed", "+96 −71"
  (a true minus sign).

## 3. Token architecture

Three tiers. Each tier only references the one below it.

```
primitive  raw values, no meaning          warm/18 #121110, grey/15 #0b0b0b, brass/74 #c8a66a, space 4, radius 6, 150ms
   │
semantic   roles the app uses, one CSS     --bg-1 (surface.frame), --text-quiet (text.quiet), --brass (accent.default),
   │       custom property each, a value   --line (line.default), --r-s, --dur-1, --fs-s
   │       per preset (mode)
component  sizes and assignments one       button.primary.background = {selected.fill}; row.icon-axis = 28;
           component reads                 card.width = 520; hold.duration = {duration.hold}
```

- **The CSS custom property is the contract.** Components read `var(--bg-1)`, never a hex and never a primitive.
  Primitives exist in `tokens.json` so a preset can be audited and a new preset built from known values; the CSS
  does not expose them.
- **Primitive names** are family and OKLCH lightness: `warm/18` is a warm neutral at L 18%; `grey/93` is the
  Graphite text grey. The name tells you how light a value is without a lookup. Families: warm (Card catalog and
  Bone neutrals, which all lean warm), grey (Graphite and Typewriter, R = G = B), brass, amber, red, green, black.
- **Semantic names** keep the incumbent CSS names (`--bg-0`…`--bg-4`, `--text-*`, `--brass`, `--red`) because five
  modules already read them; `tokens.json` gives each a role path (`surface.frame`, `text.quiet`,
  `accent.default`) for the React app and Tailwind.
- **Translucent tokens are derived, never chosen.** `--hair`, `--line`, `--line-strong`, `--line-field`,
  `--hover`, `--current` are `color-mix()` of `--text`; `--brass-soft` and `--red-soft` of their solids. A theme
  only chooses solid colours, so every line follows a text-colour override.
- **Modifiers.** Five independent axes, all attributes on `<html>` except the ground:

| Axis | Values | Attribute | Changes |
|---|---|---|---|
| Preset | catalog (default), graphite, bone, typewriter | `data-hx-preset` | every colour, the two families |
| Corners | sharp, default, round | `data-hx-corners` | `--r-xs`, `--r-s`, `--r-m`, `--r-l` |
| Density | compact, regular, comfortable | `data-hx-density` | `--row-h`, `--row-h-2`, `--ctl`, `--ctl-s` |
| Case | sentence, lower | `data-hx-case` | `--ui-case` (none, lowercase) |
| Ground | surface (default), dock | `data-ground="dock"` on an element | re-derives text, line and fill roles from `#000` inside that element |

`theme.js` also sets `data-hx-theme="light"` on `<html>` whenever the ground is light (Bone, or a light override).
Use it only for what tokens cannot express.

- **Library tokens.** `components.css` defines the tokens the modules hard-coded as literals or needed and lacked,
  until `tokens.css` takes them. Promoted (they live in `tokens.css` now): `--dur-out` 120ms, `--dur-slide` 240ms,
  `--dur-breathe` 1.8s, `--dur-hold` 1000ms, `--line-field`, `--ink-on-dock`, `--ink-on-dock-strong`, and
  `--brass-base` (the accent captured on `:root`, so a ground can re-derive `--brass` without referring to itself; a
  self-referencing custom property is a cycle that silently voids the accent and the focus ring), `--mark-off`, and
  the corner scale (`--r-xs` to `--r-l` in both shapes and all three corner settings), `--r-floor`, `--corner` and
  `--composer-pad` (section 8). The retuned corner scale of the drawn corners (section 8) and `--corner-smoothing` are
  library tokens again until `tokens.css` takes them (MIGRATION.md §0.8); the library also holds the squircle's
  behaviour (`HX.ui.squircle`) and the nesting contract.

## 4. Colour

Surfaces separate by tone, not by shadow. Two colours carry meaning and nothing else: **brass** marks where you are,
**red** marks what you owe. Values below are the four presets as they stand in `tokens.css`.

### 4.1 Surfaces, deepest to highest

| Token | Role | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|---|
| `--bg-0` | Inset (drawer): fields, cards set into the work, wells, the command field | `#0c0b0a` | `#070707` | `#fbf9f4` | `#000000` |
| `--bg-1` | Frame (cabinet): title bar, sidebars, open right panel, menus, palette, dialogs | `#121110` | `#0b0b0b` | `#ebe6dc` | `#0b0b0b` |
| `--bg-2` | Ground (reading room): what the work sits on | `#181715` | `#111111` | `#f4f0e8` | `#111111` |
| `--bg-3` | Raised (card stock): your request, the composer, tooltips, toasts, hold button at rest | `#23211e` | `#1f1f1f` | `#fffdf8` | `#1f1f1f` |
| `--bg-4` | Pressed: pressed fills, kbd in a tooltip, scrollbar thumb, disabled primary | `#2e2b27` | `#2a2a2a` | `#ddd6c9` | `#2a2a2a` |
| `--chip` | Inline code chip | `#26231f` | `#1c1c1c` | `#e6e0d4` | `#1c1c1c` |
| `--dock-bg` | The dock. Fixed in every theme, never in the customizer | `#000000` | `#000000` | `#000000` | `#000000` |

**The layering rule.** What the user wrote is raised (card stock). What the system set into the work is inset
(drawer): approval and ship cards, wells, fields. The frame holds; the ground carries. Do not put inset on inset.

### 4.2 Text and icons

| Token | Role | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|---|
| `--text` | Body and labels; lines and fills derive from it | `#e9e4da` | `#e8e8e8` | `#23201c` | `#e8e8e8` |
| `--text-strong` | Titles, the current row, a hovered icon | `#f6f2ea` | `#ffffff` | `#0f0e0c` | `#ffffff` |
| `--text-dim` | Secondary: roles, quotes, descriptions, kbd labels | `#a59d90` | `#a3a3a3` | `#4e483f` | `#a3a3a3` |
| `--text-quiet` | Meta that must stay readable: times, costs, call numbers, group headings | `#958c7f` | `#8f8f8f` | `#5c564c` | `#8f8f8f` |
| `--text-faint` | Decoration and disabled only; never carries meaning alone (an inactive mark that does is `--mark-off`, 4.5) | `#5b554c` | `#4a4a4a` | `#b3ab9e` | `#4a4a4a` |
| `--icon` | Glyphs in icon buttons and rows | `#b3ab9e` | `#b6b6b6` | `#4f493f` | `#b6b6b6` |
| `--icon-quiet` | Window controls | `#7f786d` | `#6e6e6e` | `#7a7366` | `#6e6e6e` |
| `--icon-off` | Disabled icons | `#4a453e` | `#4b4b4b` | `#bdb5a7` | `#4b4b4b` |

### 4.3 Meaning

| Token | Role | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|---|
| `--brass` | **You are here**: focus ring, current marker, active rung, checked item, pressed toggle, caret | `#c8a66a` brass | `#9db6cf` steel (Owner decision) | `#8a6a2c` | `#7ea6e0` carbon-paper blue (Owner decision) |
| `--red` | **You owe something**: dots, stamp outlines, the blank's dotted line | `#e5484d` | `#e5484d` | `#cf3a3f` | `#e5484d` |
| `--red-text` | Attention as text: the stamp, "needs you" | `#f0646a` | `#f0646a` | `#a82328` (was `#b4282e`, F4) | `#f0646a` |
| `--selected` | Bone fill: primary button, segmented thumb, send, checked switch | `#ece6da` | `#e9e9e9` | `#23201c` | `#e9e9e9` |
| `--text-on-light` | Ink on the selected fill | `#1a1815` | `#161616` | `#f6f2ea` | `#161616` |

Named rules:

- **The stamp rule.** Red appears only when the user owes something: a blank waiting, an approval, a failed gate or
  sign-in, a capped escalation. Recording, destructive confirmations, removed diff lines and errors in a form field
  are not owed; they are not stamp red (removed lines use `--del`, a form error uses `--red-text` only on the
  message and the field line, never on the button).
- **The you-are-here rule.** Brass marks position and choice: focus, the current row's dot, the active rung, a
  checked item, a pressed toggle's icon, the caret. Brass is never a fill for a large area, never decoration and
  **never text** (it is 4.0:1 in Bone).
- **The warm-neutral rule** (Card catalog, Bone). Every neutral leans a few degrees warm; no pure grey, no pure white.
  Graphite and Typewriter are the deliberate exception: R = G = B, as in the owner's Figma.
- **Colour is never the only cue.** Every red mark has a word (the stamp, "needs you", an aria-label); every brass
  mark has a shape (the ring, the check, the filled station, the thumb).

### 4.4 Status and diff

| Token | Role | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|---|
| `--ok` | A passed gate in output | `#7fb68c` | `#7cbf8e` | `#3f7d4f` | `#7cbf8e` |
| `--warn` | A failing contrast pair in the customizer. Never attention | `#d9a54a` | `#d9a54a` | `#9a6a12` | `#d9a54a` |
| `--add` | Added lines and counts | `#7fb68c` | `#7cbf8e` | `#356b43` (was `#3f7d4f`, F4) | `#7cbf8e` |
| `--del` | Removed lines and counts | `#d97b72` | `#e07a76` | `#a63d35` (was `#b4453c`, F4) | `#e07a76` |

The tables reflect `tokens.css` as of 18 November 2026, 17:47: the Bone fixes (F4), the library tokens and the
Graphite and Typewriter accents are in it.

### 4.5 Derived lines and fills

| Token | Formula | Use |
|---|---|---|
| `--hair` | `--text` 7.5% | Dividers inside a surface: section rules, list separators, a card's foot rule |
| `--line` | `--text` 15% | Outlines of controls whose label identifies them: secondary buttons, menus, popovers |
| `--line-strong` | `--text` 26% | Hovered outlines, empty radio rings, the switch track |
| `--line-field` | `--text` 42% (54% when light) | **Text fields** and the focused composer: 3:1 against the field and the frame |
| `--mark-off` | `--text-quiet` 55% into `--text-faint` (solid) | **Inactive non-text marks:** page dots, ladder stations still to come (ring), an empty option ring. 3.3–4.2:1 on every surface of every preset (WCAG 1.4.11), and well under the active marks (`--text-dim` 6:1 and up, brass). Card catalog `#7b7368`, Graphite `#707070`, Bone `#837c71`, Typewriter `#707070`. Library token |
| `--hover` | `--text` 4.5% | Hover fill on rows, icon buttons, chips, ghost buttons |
| `--current` | `--text` 8.5% | The selected row, the active dialog tab, a focused menu item |
| `--brass-soft` | `--brass` 14% | Text selection; the flash on a panel section opened from elsewhere |
| `--red-soft` | `--red` 14% | Behind a stamp on hover |
| `--scrim` | per preset (60% / 56% black, 22% warm in Bone) | Behind the palette, dialogs and overlay drawers |

### 4.6 The dock ground

Inside `[data-ground="dock"]` the same role names are re-derived from `#000` and a light ink (`--ink-on-dock`: the
theme's `--text` on dark presets, its `--bg-2` on light ones), so a component never needs a dock variant:

| Role inside the dock | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|
| `--text` | `#e9e4da` | `#e8e8e8` | `#f4f0e8` | `#e8e8e8` |
| `--text-dim` (ink 68%) | `#9e9b94` | `#9e9e9e` | `#a6a39e` | `#9e9e9e` |
| `--text-quiet` (ink 60%) | `#8c8983` | `#8b8b8b` | `#92908b` | `#8b8b8b` |
| `--text-faint` (ink 42%) and `--mark-off` (the same): inactive page dots, ladder rings, the non-text marks; 3.3–3.6:1 on `#000`, 3.0–3.2:1 on a card set into the dock | `#62605c` | `#616161` | `#666561` | `#616161` |
| `--surface` (ink 7%): a card set into the dock | `#10100f` | `#101010` | `#111110` | `#101010` |
| `--selected` | ink | ink | ink | ink |
| `--brass` | `#cfb483` | `#aec1d5` | `#baa681` | `#95b5e2` |
| `--red-text` | `#e66769` | `#e6686c` | `#d65e61` | `#e6686c` |

## 5. Theming contract

### 5.1 Presets

| Preset | Note | Interface font | Code font | Case | Corners | Density |
|---|---|---|---|---|---|---|
| Card catalog (default) | Warm dark | Libre Franklin | IBM Plex Mono | sentence | default | regular |
| Graphite | Neutral grey, close to the owner's Figma | Geist | Geist Mono | sentence | default | regular |
| Bone | Light | Libre Franklin | IBM Plex Mono | sentence | default | regular |
| Typewriter | Mono and lowercase | Geist Mono | Geist Mono | lower | round | regular |

Dark is the primary look. Bone is the light mirror and is composed for itself, not inverted: its brass is darker,
its red text is darker, its shadows are warm and faint, its scrim is a 22% warm wash.

### 5.2 What the user may change (Settings > Appearance, `theme.js`)

- **Presets** (one click), then any of the **solid colours**: `--brass`, `--red`, `--red-text`, `--bg-0`…`--bg-4`,
  `--chip`, `--text`, `--text-strong`, `--text-dim`, `--text-quiet`, `--text-faint`, `--icon`, `--icon-quiet`,
  `--icon-off`, `--selected`, `--text-on-light`, `--ok`, `--warn`, `--add`, `--del`.
- **Interface font** (Libre Franklin, Geist, IBM Plex Sans, Instrument Sans, Public Sans, Geist Mono, IBM Plex Mono,
  System) and **code font** (IBM Plex Mono, Geist Mono, JetBrains Mono, Source Code Pro, System). Google Fonts only.
- **Interface case** (sentence, lowercase), **corners** (sharp, default, round), **density** (compact, regular,
  comfortable).
- **Export and import** as JSON: `{"format": "hypotaxis-theme", "version": 1, "preset", "sans", "mono", "case",
  "corners", "density", "colors": {"--brass": "#c8a66a", …}}`. Saved in `localStorage` under `hx.v6.theme`.

### 5.3 What the user may not change

- **`--dock-bg` is `#000` in every theme.** It is not in the customizer, not in the JSON, and no preset defines it.
  The dock's inks are re-derived from it (4.6), so a light theme still gets a black dock with light ink.
- **Derived tokens** (4.5) follow their solids; they are not offered.
- **The scale**: sizes, spacing, durations, curves, z-index. Density and corners are the only geometry the user
  moves.
- **Semantics.** The customizer changes colours, not jobs: brass stays "you are here", red stays "you owe".

### 5.4 The pairs that must hold

The customizer checks these as the user edits and flags a failing colour with a `--warn` dot. Ratios below are
computed from `tokens.css` by `build-tokens.mjs --report`; the specimen measures them live. **Bold** is a failure.

| Pair | Min | Card catalog | Graphite | Bone | Typewriter |
|---|---|---|---|---|---|
| Text on the frame (`--text` on `--bg-1`) | 4.5 | 14.89 | 16.06 | 13.04 | 16.06 |
| Text on the ground (`--text` on `--bg-2`) | 4.5 | 14.14 | 15.41 | 14.27 | 15.41 |
| Text on raised surfaces (`--text` on `--bg-3`) | 4.5 | 12.67 | 13.45 | 15.95 | 13.45 |
| Text on inset cards (`--text` on `--bg-0`) | 4.5 | 15.52 | 16.44 | 15.41 | 17.14 |
| Secondary text on the frame (`--text-dim` on `--bg-1`) | 4.5 | 7.03 | 7.80 | 7.27 | 7.80 |
| Secondary text on raised surfaces (`--text-dim` on `--bg-3`) | 4.5 | 5.98 | 6.53 | 8.89 | 6.53 |
| Meta text on the frame (`--text-quiet` on `--bg-1`) | 4.5 | 5.69 | 6.09 | 5.84 | 6.09 |
| Meta text on the ground (`--text-quiet` on `--bg-2`) | 4.5 | 5.40 | 5.84 | 6.39 | 5.84 |
| Meta text on raised surfaces (`--text-quiet` on `--bg-3`) | 4.5 | 4.84 | 5.10 | 7.15 | 5.10 |
| Meta text on inset cards (`--text-quiet` on `--bg-0`) | 4.5 | 5.93 | 6.23 | 6.90 | 6.49 |
| Meta text on a selected row (`--text-quiet` on `--current` over `--bg-1`) | 4.5 | 4.74 | 5.17 | 4.98 | 5.17 |
| Code in a chip (`--text` on `--chip`) | 4.5 | 12.34 | 13.91 | 12.34 | 13.91 |
| Kbd in a tooltip, as found (`--text-quiet` on `--bg-4`) | 4.5 | **4.25** | **4.44** | 5.03 | **4.44** |
| Kbd in a tooltip, library (`--text-dim` on `--bg-4`) | 4.5 | 5.25 | 5.69 | 6.26 | 5.69 |
| Ink on the selected fill (`--text-on-light` on `--selected`) | 4.5 | 14.25 | 14.91 | 14.53 | 14.91 |
| Attention text on the ground (`--red-text` on `--bg-2`) | 4.5 | 5.75 | 6.06 | 5.63 | 6.06 |
| Attention text on inset cards (`--red-text` on `--bg-0`) | 4.5 | 6.31 | 6.46 | 6.08 | 6.74 |
| Attention text on the frame (`--red-text` on `--bg-1`) | 4.5 | 6.05 | 6.31 | 5.14 | 6.31 |
| Attention text on a selected row (`--red-text` on `--current` over `--bg-1`) | 4.5 | 5.04 | 5.36 | 4.90 (was **4.38**) | 5.36 |
| Accent on the frame: focus ring, current marker (`--brass` on `--bg-1`) | 3 | 8.19 | 9.40 | 4.04 | 7.89 |
| Accent on the ground (`--brass` on `--bg-2`) | 3 | 7.78 | 9.02 | 4.42 | 7.57 |
| Accent on inset cards (`--brass` on `--bg-0`) | 3 | 8.54 | 9.62 | 4.78 | 8.42 |
| Accent on raised surfaces: chip icon, caret (`--brass` on `--bg-3`) | 3 | 6.97 | 7.87 | 4.94 | 6.61 |
| Icons on the frame (`--icon` on `--bg-1`) | 3 | 8.30 | 9.71 | 7.16 | 9.71 |
| Window controls on the frame (`--icon-quiet` on `--bg-1`) | 3 | 4.32 | 3.86 | 3.78 | 3.86 |
| Attention dot and stamp outline on the ground (`--red` on `--bg-2`) | 3 | 4.58 | 4.82 | 4.27 | 4.82 |
| Attention dot on the frame (`--red` on `--bg-1`) | 3 | 4.82 | 5.03 | 3.90 | 5.03 |
| Added-line count on the frame (`--add` on `--bg-1`) | 4.5 | 8.06 | 9.09 | 5.06 (was **3.97**) | 9.09 |
| Removed-line count on the frame (`--del` on `--bg-1`) | 4.5 | 6.31 | 6.76 | 5.05 (was **4.38**) | 6.76 |
| Field outline as found (`--line` over `--bg-0`, against `--bg-1`) | 3 | **1.35** | **1.35** | **1.14** | **1.25** |
| Field outline, library (`--line-field` over `--bg-0`, against `--bg-1`) | 3 | 3.30 | 3.40 | 3.01 | 3.20 |
| Field outline, library (`--line-field` over `--bg-0`, against `--bg-0`) | 3 | 3.44 | 3.48 | 3.55 | 3.41 |
| Inactive mark as found (`--text-faint` on `--bg-2`) | 3 | **2.43** | **2.13** | **2.00** | **2.13** |
| Inactive mark, library (`--mark-off` on `--bg-0`) | 3 | 4.22 | 4.06 | 3.91 | 4.24 |
| Inactive mark, library (`--mark-off` on `--bg-1`) | 3 | 4.05 | 3.97 | 3.31 | 3.97 |
| Inactive mark, library (`--mark-off` on `--bg-2`) | 3 | 3.84 | 3.81 | 3.62 | 3.81 |
| Inactive mark, library (`--mark-off` on `--bg-3`) | 3 | 3.44 | 3.33 | 4.05 | 3.33 |
| Dock text on `#000` | 4.5 | 16.57 | 17.14 | 18.48 | 17.14 |
| Dock meta on `#000` | 4.5 | 6.01 | 6.18 | 6.59 | 6.18 |
| Meta on a card set into the dock | 4.5 | 5.44 | 5.59 | 5.94 | 5.59 |
| Dock attention text on `#000` | 4.5 | 6.51 | 6.55 | 5.66 | 6.55 |
| Dock accent on `#000` | 3 | 10.49 | 11.37 | 8.87 | 9.95 |
| Dock inactive mark (`--mark-off` on `#000`) | 3 | 3.34 | 3.41 | 3.60 | 3.41 |
| Dock inactive mark on a card set into the dock | 3 | 3.02 | 3.09 | 3.24 | 3.09 |

The customizer's own check (`theme.js PAIRS`) now carries text and meta on inset, attention text on a selected row,
kbd on `--bg-4`, diff counts on the frame, the field line and the dock pairs, and reads `color(srgb …)` (F6 fixed). It
should add the inactive-mark pairs (`--mark-off` on `--bg-1` and `--bg-3`, and on `#000` in the dock) once
`--mark-off` is in `tokens.css`; a user who darkens `--text-quiet` or `--text-faint` can push them under 3:1.

### 5.5 Rules every module follows

1. No literal colours. Tokens only; a tint of your own is `color-mix(in srgb, var(--text) N%, transparent)`.
2. Fonts only through `var(--sans)` and `var(--mono)`; sizes only through `--fs-*`.
3. Sizes that density changes use `--row-h`, `--row-h-2`, `--ctl`, `--ctl-s`; radii use `--r-*`.
4. Interface labels take `text-transform: var(--ui-case)`; content never does.
5. Anything that caches a colour in JS (canvas, orb attributes, the hold button's fill) re-reads it on `hx:theme`.
6. Inside the dock, set `data-ground="dock"` on the root and read the usual roles. No `--dock-*` palette.

## 6. Typography

**Families.** One family per role. `--sans` (Libre Franklin in Card catalog and Bone, Geist in Graphite, Geist Mono
in Typewriter) for interface and prose: the American gothic of library labels. `--mono` (IBM Plex Mono, Geist Mono)
for code, paths, numbers, times, costs, model names, call numbers, state words, kbd and stamps: the typewriter
lineage of the catalog card. Mono is never a costume for "technical" prose.

**Scale.** Six sizes, three weights. Nothing in between.

| Role | Size / line height | Weight | Family | Where |
|---|---|---|---|---|
| Display | `--fs-xl` 20 / 1.2 | 600 | sans | One per screen at most: the name of a bot being made |
| Title | `--fs-l` 16 / 1.2 | 600 | sans | View and dialog titles, a bot's name in its header, empty-state titles |
| Card title | `--fs-m` 14 / 1.35 | 600 | sans | Card and dock-card titles |
| Reading | `--fs-m` 14 / 1.6 | 400 | sans | Conversation prose, request cards, the composer. Measure 608px (about 80 characters) |
| Interface | `--fs-s` 13 / 1.35 | 400; 500 for buttons, tabs, menu labels | sans | Rows, buttons, menus, tabs, panel labels |
| Label | `--fs-xs` 12 / 1.35 | 500 | sans | Group headings, field labels, chips |
| Small | `--fs-xs` 12 / 1.5 | 400 | sans | Hints, descriptions, tooltips, notes |
| Code | `--fs-xs` 12 | 400 | mono | Inline code chips, paths in lists |
| Meta | `--fs-2xs` 11 / 1.45 | 400 | mono | Call numbers, times, costs, state words, kbd |
| Stamp | `--fs-2xs` 11 / 1 | 500 | mono | "waiting for you", "needs you", "failed" |

- **Tracking:** 0 for sans; `--track-mono` −0.01em for mono.
- **Numerals:** `font-variant-numeric: tabular-nums` on every mono number that can change or line up (costs,
  times, counts, ratios).
- **Wrapping:** `text-wrap: pretty` on prose and card titles, `balance` on headings.
- **Measure:** prose stops at `--measure` (608px); notes and hints at 42–46ch.
- **Weights:** 400, 500, 600 only. 700 is not loaded.
- **The brand** "hypotaxis" is set 15/600, −0.01em, beside the φ. It is the one off-scale size; name it
  `--fs-brand` when promoted (Finding F10).

## 7. Space, density and layout

**Spacing**: a 4px base, seven steps. Use the scale for gaps and padding; component internals listed below are the
only named exceptions.

| Token | Value | Typical use |
|---|---|---|
| `--sp-1` | 4 | Icon to label inside a chip; between key chips |
| `--sp-2` | 8 | Between buttons; row inset; label to field |
| `--sp-3` | 12 | Inside wells; between card regions; paragraphs |
| `--sp-4` | 16 | Card padding (16 sides); between a sheet's sections |
| `--sp-5` | 24 | Between groups; scroller bottom padding beyond the composer |
| `--sp-6` | 32 | Between conversation entries; first entry below the title bar |
| `--sp-7` | 48 | Before a new block of a form (suggestions under the new-bot form) |

Named exceptions (component internals): card padding 14 16; request card 10 14; composer 12 14 8; stamp 0 7;
code chip 1 5; segmented track 3; menu 4.

**Density** moves only rows and controls:

| Token | Compact | Regular | Comfortable | Used by |
|---|---|---|---|---|
| `--row-h` | 26 | 30 | 34 | List rows, menu items, options |
| `--row-h-2` | 40 | 44 | 50 | Two-line rows (bots), roster, panel head |
| `--ctl` | 26 | 30 | 34 | Buttons, segmented control, fields |
| `--ctl-s` | 24 | 28 | 32 | Icon buttons, small buttons, send |

**Layout geometry** (LAYOUT.md has the per-slot detail):

| Part | Size |
|---|---|
| Title bar | `--chrome-h` 40, frame colour; command field `clamp(240px, 34vw, 480px)` × 26, centred on the window |
| Left sidebar | open `--sb-w` `clamp(256px, 15vw, 288px)`; rail `--sb-rail-w` 56; closed 0 |
| Sidebar axes | every glyph and orb centres on **x = 28** (the rail's centre); every label starts at **x = 44**; group headings and the brand outdent to x = 20 |
| Ground | between the sidebars; 14px concave corner where it meets the frame |
| Right panel | closed: a 28px strip with the context measure; open `--right-w` `clamp(300px, 18vw, 340px)`; session tab only |
| Conversation column | `--col-w` 720 = `--margin-w` 112 (call numbers) + `--measure` 608 (content); `min(720, free − 64)`; the margin collapses to a line above the entry under 560 |
| Composer | the column's width, centred on the same line, `--composer-gap` 16 above the dock |
| Dock | `--dock-rest-h` 72 at rest, flush to the bottom edge, centred with the composer |

**Breakpoints**: ≥1200 both sidebars push the ground; 900–1199 the right panel overlays with a shadow (Esc closes);
640–899 an open sidebar overlays the rail with a scrim; <640 the sidebar is a drawer, back, forward and window
controls hide, the command field fills the bar.

**Large windows** (decided for the owner's 2880×1800 panel at 1x, and 2560 wide): no app-wide maximum width. The
conversation column keeps its measure (720, of which 608 is text), the sidebar and the details panel keep their
clamps, the composer keeps the column's width and the dock its own; the column, the composer and the dock stay centred
on the ground between the sidebars. Only the title bar spans the window, with the command field centred on it. The
extra width becomes margin on both sides of the work, the way a document sits on a desk, rather than longer lines.

**The sidebar follows the window until the person sets it**: closed under 640, a rail under 900, open from 900. The
shell re-reads the width on every resize while the sidebar is automatic, because a frame can boot small and grow (the
claude.ai artifact viewer does). It stores the sidebar only once the person sets it; a stored choice from an older
build, or a stored open sidebar or details panel at a width where it would overlay the work, is ignored at boot. A
chosen open sidebar that a narrowing window would turn into an overlay goes back to following the window.

**The dock's reservation.** `--hx-dock-space` is measured, never a constant: the dock observes its current view
(ResizeObserver) and sends `hx:dock` with the slab's height plus the most the row can lift it while bots grow under the
pointer (8px at 40px orbs), in every mode (rest, a session, the grid, the minimised pill). The slab at its tallest
therefore still ends below the composer, and the composer never moves under the pointer.

**The centre line.** The shell publishes `--hx-center-x`, `--hx-col-left`, `--hx-col-w`, `--hx-margin-w` and
`--hx-dock-space` as registered, animated custom properties; the composer, the column and the dock ride them so they
travel together on one curve. Nothing computes its own centre.

## 8. Shape

Corners are **Apple's continuous corners, drawn the same in every engine**, and a corner inside another **fits** it
(Owner decisions, 18 November 2026, revised the same day). Why the revision: the app runs in Tauri, which is WebKitGTK
on Linux (the owner's main platform), WebKit on macOS and WebView2 (Chromium) only on Windows. WebKit has no
`corner-shape`, so the first version (`superellipse(1.8)`) showed only in Chromium; on the owner's machine every
corner was a small circular arc, and inner radii had collapsed to 5–6px.

### 8.1 The drawn corner (`HX.ui.squircle`)

- **The curve.** Figma's corner smoothing, ported from figma-squircle (MIT, Tien Pham) after Daniel Furse's
  "Desperately seeking squircles". A corner of radius R with smoothing ξ = 0.6 (iOS) keeps a circular arc of
  90(1 − ξ)° = 36° in its middle and replaces each end with a cubic whose curvature starts at zero on the straight
  edge; the corner runs (1 + ξ)·R = 1.6R along each edge. The radius means what it means on iOS: a continuous corner of
  R reads as round as an arc of R, only softer. Where an edge is too short for the full run, ξ shrinks first, so the
  corner never passes the middle of an edge. `--corner-smoothing` (0.6) is the one knob.
- **How it is applied: never by clipping a container.** Owner rule: never `clip-path` a container whose content may
  overflow (orbs draw past their box, flags sit on corners, popovers and shadows reach out). So there are three modes:
  - **frame** (the default for every bound element): nothing is clipped. `::before` paints the fill (`--sq-bg`) clipped
    to the path, `::after` draws the line (`--sq-line`) on a band of it and, on `:focus-visible`, the focus ring. A
    frame component writes its fill once, `--sq-bg: X; background: var(--sq-bg)`, so the same colour paints the element
    itself whenever it is not bound (before the library runs, or a capsule the browser draws). Rows, menu items, cards,
    wells, minis, options, the composer box, the segmented track, palette rows, the orb sculptor's options, the dock's
    tiles and schedule rows are frames.
  - **clip**, for leaf controls only (buttons, icon buttons, send, the segmented thumb, file chips): the element is
    clipped to the path and its own background shows through; `::after` draws the line and the ring. Asking for clip on
    anything else gets a frame.
  - **surface**: a frame that keeps its elevation shadow (menus, popovers, tooltips, toasts, the expanded blank, dialogs).
  The dock's still slab and the concave corners are plain shapes, clipped. The live dock draws its outline with
  `HX.ui.shape.slab()`, which uses the same smoothing.
- **Crisp lines at any pixel ratio.** A native border is snapped to whole device pixels; a path is drawn where it falls,
  so a 1px band at 1.25x straddles two device pixels and looks soft. The path is snapped: its straight edges land on
  device pixels (from the element's place on screen) and the line is a whole number of device pixels, rounded down as
  the browser rounds a border (one below 2x, two at 2x, three at 3x); the focus ring the same way from 2px. Edges round
  inward, to the innermost of the three places a browser may put a box's edge (snapped to device pixels, snapped to
  whole CSS pixels and then scaled, or not snapped at all under a transform), because a pseudo-element paints nothing
  outside its own box; the shape sits at most about a device pixel inside the box. Positions change without a resize, so
  the snap is re-read after transitions, animations, scrolling, font loads and layout. Measured on 24 boxes at
  scattered fractional positions: every straight edge one clean device pixel (two at 2x) at 1, 1.25, 1.5, 1.6, 1.75, 2
  and 3x, against 0 of 48 unsnapped at 1.5 and 1.75. In the app every visible line is one device pixel at rest at
  1.25, 1.5, 1.6, 1.75 and 2x; the one soft case left is headless Chromium compositing a focused composer while the dock
  grid animates (the line is promoted with the text field's layer at a fractional offset), which no path can fix.
- **When it recomputes.** One shared `ResizeObserver` (border box). The browser runs its callback once per frame after
  layout, so the path is written in the same frame as the size: a card animating its height or the dock morphing never
  shows a stale clip, and every read happens before every write. A corner's commands are relative, so they are cached
  by radius and smoothing and a resize rebuilds only the four straight edges; whole paths are cached by size and radii.
  The radii come from the element's computed `border-radius` (the tokens, so nesting holds), read when it binds and
  again on `hx:theme` or a change of preset, corners or density. The `--sq-*` properties are plain (inheriting)
  custom properties: registered as not inheriting, WebKitGTK hands a pseudo-element its grandparent's value; a bound
  element that declares none gets transparent from a zero-specificity reset, never its container's. A corner as round as half the element (a capsule, a
  circle) needs no path and stays native. Nothing animates, so reduced motion has nothing to stop.
- **Cost, measured.** 200 bound elements changing height every frame (Chromium 153, headless, this specimen): the
  squircle's work per frame averages 0.9ms, 1.4ms at the 95th percentile (budget 2ms). Binding the whole specimen
  (about 240 surfaces) takes one 20–40ms frame at load, once.
- **What is bound.** The library's (buttons, icon buttons, send, segmented track and thumb, rows, menu items,
  menus, popovers, tooltips, toasts, the composer box, files, request cards, the still slab, concave corners) and the
  card layer's (cards, wells, minis, option rows, the free answer, previews). Modules bind theirs with
  `HX.ui.squircle.auto(selector)` or `data-sq` (MIGRATION.md §9). Text inputs keep a native arc: an `<input>` cannot
  hold the `::after` that draws the line.
- **Verified in WebKitGTK 2.52** (Tauri's Linux engine) through its own WebView: `corner-shape` is unsupported there,
  `clip-path: path()` and `@property` are supported, the bound surfaces draw the same curve as Chromium
  (`shots/corners-webkit-vs-chromium.png`), and the specimen has no console errors. The app itself (every module
  migrated, 19 November 2026) renders the same in WebKitGTK and Chromium: `../shots/final3/webkit-vs-chromium-*.png`.
  On the app, the squircle's work stays under 0.5ms a frame during the dock's morphs and a card's height animation.

| Token | Sharp | Default | Round | v6 default | Use |
|---|---|---|---|---|---|
| `--r-xs` | 3 | **6** | 8 | 4 | kbd, inline code, stamps |
| `--r-s` | 6 | **12** | 16 | 6 | Buttons, rows, fields, wells, the segmented track, tooltips |
| `--r-m` | 10 | **20** | 26 | 10 | Cards, the composer, menus, popovers, toasts, request cards |
| `--r-l` | 14 | **30** | 36 | 14 | Sheets, dialogs, the palette, the dock, where the ground meets the frame |
| `--r-floor` | 4 | **8** | 12 | none | The smallest inner radius of a nested corner |
| `--r-pill` | 999 | 999 | 999 | 999 | Chips (a capsule), dots, the switch, anything inside a pill |
| `--corner-smoothing` | 0.6 | 0.6 | 0.6 | none | The corner's smoothing (0 is a plain arc) |

### 8.2 Nested corners fit their container

```
--r-in = max(--r-floor, --r-outer − --pad)        and, where that would go under the floor: --pad = --r-outer − --r-floor
```

- **The contract.** A surface that holds others declares, on itself, its radius `--r-outer` and the inset of what
  sits in its corners `--pad`; it computes `--r-in` and uses `border-radius: var(--r-outer)`. What sits in its corners
  takes `border-radius: var(--r-in)`. The same as two classes for module surfaces: `.ui-nest` and `.ui-fit`. The
  squircle reads the resulting radii, so the drawn corners are concentric too.
- **Generous, as Apple does.** The inner radius never goes under the floor (8): a hard corner against a soft one is
  the mistake the owner sees as "too square". When `R − gap` would go under it, the padding gives way: the gap
  becomes `R − floor` (12 in a 20px card), so the corners stay concentric and the inner piece stays soft.
- **Tight or loose.** When the gap is smaller than the outer radius the corners read together: use the formula. When
  the gap is as large as the outer radius or larger, the inner piece keeps its own step, never larger than the outer.
- **Pills.** A round piece inside a pill stays a pill, concentric when the gap is equal on every side.

| Nesting | Outer | Gap | Inner (default) |
|---|---|---|---|
| Mic, send, attach, chips and files in the composer | `--r-m` 20 | 6 | 14 (the send, 28px, is a circle) |
| A menu item in a menu | `--r-m` 20 | 4 | 16 |
| A button in a toast | `--r-m` 20 | 6 | 14 |
| A well, a footer button, a stamp in a card | `--r-m` 20 | 12 (was 16) | 8 |
| The segmented thumb and options in the track | `--r-s` 12 | 3 | 9 |
| A key in a tooltip | `--r-s` 12 | 4 | 8 |
| A colour swatch in its customizer well | `--r-s` 12 | 2 | 10 |
| A card or a row at the top of the dock slab (wait, queue) | `--r-l` 30 | 12 | 18 |
| The close button in a dialog's corner | `--r-l` 30 | 12 | 18 |
| A row at the bottom of the palette | `--r-l` 30 | 6 | 24 |
| The switch thumb; orbs in the dock's minimised pill; chips | pill | 3; 9 | pill |
| A surface flush with its container's edge (a card's foot, a queue's peek) | the container's | 0 | the container's radius |

The specimen draws the rule twice as large, lists these with the live values of the current theme, and shows WebKit
before and after.

## 9. Elevation, hairlines and depth

Flat. Depth is tone: frame, ground, raised, inset. Lines divide; shadows only on things that float over other things.

| Token | Card catalog, Graphite, Typewriter | Bone | Use |
|---|---|---|---|
| `--shadow-pop` | `0 16 40 rgba(0,0,0,.5–.55)`, `0 1 3 rgba(0,0,0,.4)` | `0 16 40 rgba(40,34,26,.16)`, `0 1 3 …/.1` | Menus, popovers, palette, dialogs, toasts |
| `--shadow-tip` | `0 6 18 rgba(0,0,0,.35–.4)` | `0 6 18 rgba(40,34,26,.14)` | Tooltips |
| `--shadow-side` / `-r` | `±20 0 40 rgba(0,0,0,.4–.45)` | `±20 0 40 rgba(40,34,26,.14)` | A sidebar or the right panel overlaying the ground |

- A floating surface is the frame colour with an inset 1px `--line` and `--shadow-pop`. Tooltips and toasts are
  raised (`--bg-3`) with `--hair`.
- No coloured halos, no zero-offset glows, no hard offset shadows. (The brass halo on the current rung is removed,
  Finding F7.)
- **z-index scale:** base 0, right panel 20, sidebar 30, dock 40, chrome 50, menu 70, palette 80, toast 90,
  tooltip 100.

## 10. Iconography

- Drawn icons only (no emoji, no unicode glyphs as icons). One set, in `HX.ui.icon(name)`: chrome glyphs on the
  shell's 20-unit grid, content glyphs on the session's 16-unit grid.
- **One rendered stroke:** 1.5px with round caps and joins, via `vector-effect: non-scaling-stroke`, so a 16-grid
  glyph at 18px and a 20-grid glyph at 14px weigh the same. Fills only for solid glyphs (stop, the dots of "more")
  and the toggles' filled half (`.is-fill-on`, shown while `aria-expanded="true"`).
- **Sizes:** 18 in icon buttons, 16 in buttons, rows and the send button, 14–15 in chips and menus, 10–12 for
  chevrons in disclosures.
- **Colour:** `--icon` at rest, `--text-strong` on hover, `--icon-off` disabled, `--brass` when pressed or checked.
- Every icon is `aria-hidden`; its button carries the name. The one exception is a model mark (10.1), which names
  its provider.
- The set: sidebar-left, sidebar-right, back, forward, search, minimize, maximize, restore, close, plus, gear,
  session, bots, dock, send, mic, stop, ladder (Governed), spark (Smart), chevron, chevron-down, copy, check, play,
  pen, archive, unarchive, fork, file, folder, at, slash, clock, sliders, more.

### 10.1 Model marks (`HX.ui.modelMark`, Owner decision)

- **What it is:** the provider's logo beside a model's name, so you see at a glance which model answered or is
  asking. Never alone: the name stays next to it everywhere, and the mark carries the family's accessible name
  ("Claude", "OpenAI"), so a screen reader hears "Claude, sonnet 5.5".
- **One primitive** (`components/model-mark.js`, `model-mark.css`): `HX.ui.modelMark(ref, {size, color})`,
  `html.model(ref)` (mark and name, one unit that never wraps apart) and `html.modelRoute('qwen3-coder → sonnet 5.5')`
  (both marks, the arrow kept). The library's pieces take a model and draw it through the primitive: menu items
  `{model}`, chips `{model}`, every station of a list ladder, and an entry's call number `[{model}, {model, via: '→'}]`.
  No inline SVG anywhere else.
- **Monochrome everywhere:** `currentColor`, so the theme's tokens drive it (the name's colour beside text, `--icon`
  in an origin slot). 14px in chips, call numbers, the ladder and running text; 16px in origin slots, bylines,
  menus and the picker.
- **Brand colour only in the model selection menu and its chip preview** (a form's model picker). A brand fill under
  3:1 on the menu row keeps its hue and moves in OKLab lightness until it reaches 3:1, per scheme, through
  `light-dark()`; the shipped value stays as the fill. OpenAI, Grok, Z.ai and Ollama are monochrome brands and stay
  `currentColor` in both modes. On the dock a brand mark is drawn for the dark scheme in every theme.
- **The family comes from the model id** (its last path segment), never the host. The mapping is data,
  `vendor/model-icons/map.json`, first match wins: Claude (claude, haiku, sonnet, opus, fable), OpenAI (gpt, o1, o3,
  o4, codex), Gemini (with Nano Banana), DeepSeek, Qwen, Z.ai (GLM, Zhipu; Z.ai is Zhipu's mark since 2025 and its
  dot-field logo does not survive 14px), Kimi (Moonshot), MiniMax, Grok (xAI), Meta (Llama), Mistral (Codestral and
  the rest). A model of unknown family served by local Ollama gets Ollama's mark; anything else the generic mark,
  a small chip drawn for hypotaxis. Never the φ.
- **Source:** `@lobehub/icons-static-svg` 1.104.0 (MIT), only the icons used, optimised with SVGO. The logos are
  trademarks of their owners, used only to identify the model (`vendor/model-icons/NOTICE`). A new provider: its SVG
  through SVGO into `svg/`, a family in `map.json`, then `node vendor/model-icons/build.js`.

## 11. Motion

Motion explains a change of state and nothing else. No curve passes its mark: no bounce, no overshoot, no elastic.

| Token | Value | Curve | Use |
|---|---|---|---|
| `--dur-press` | 90ms | `--ease` | Press: translateY(1px) scale(.985) for buttons, .96 for icon buttons |
| `--dur-1` | 150ms | `--ease` | Hover in, colour changes |
| `--dur-out` | 120ms | `--ease` | Hover out, exits, tooltips (library token) |
| `--dur-2` | 200ms | `--ease` | Menus and popovers (fade with a 6px drop), fades, toasts |
| `--dur-slide` | 240ms | `--ease` | A segmented thumb or page indicator travelling (library token) |
| `--dur-3` | 300ms | `--spring` | Layout travel (sidebars, centre line, sheets) and **card height changes** |
| `--dur-hold` | 1000ms | linear progress, eased fill | Hold to approve, everywhere (library token). **Owner decision** |
| `--dur-breathe` | 1.8s | `--ease-io`, alternate | The one loop: a running dot breathes, opacity .35 to 1 (library token) |

Curves: `--ease` `cubic-bezier(.2, .8, .2, 1)` for every UI step; `--spring` `cubic-bezier(.22, 1, .36, 1)`
(a settle, despite its name; it never overshoots) for travel; `--ease-io` `cubic-bezier(.65, 0, .35, 1)` only for
the breathing dot. The dock's morphs are critically damped springs (ω ≈ 22, settles in about 300ms) that keep their
velocity when interrupted; travel along the centre line is never a JS spring.

- **What moves:** transform, opacity, colour, clip-path (the hold fill). Never width, height, top, left or margin,
  with one exception.
- **The card height exception (owner decision).** A card that changes state animates its height over `--dur-3` on
  `--spring`, so the conversation under it never jumps. Implemented once, in the card layer (`_flipHeight`).
- **Entrances:** a revealed card fades up 6px over `--dur-3`; swapped regions cross-fade (exit 120ms, enter 220ms).
  No page-load choreography, no scroll reveals.
- **The one loop** is the running dot. Nothing else repeats unless it is a bot's orb idling (calm), which is the
  bot's face, not decoration.
- **Reduced motion:** `--dur-1`…`--dur-3`, `--dur-out` and `--dur-slide` become 1ms; the breathing stops; press
  transforms and drops are removed; thumbs and indicators jump; the hold drains instantly when released. Orbs are
  reduced, never frozen (Owner decision, section 13): blinks, eye morphs, small glances and reactions stay; travel,
  bounce and spin go. Colour and opacity changes still answer, so feedback stays legible.
- Focus rings never animate.

## 12. The φ mark

- The owner's closed φ (`brand/phi-closed.svg`, `HX.ui.icon('phi')`), filled, never outlined.
- Colour: the strongest neutral of its surface (`--text-strong` on the frame; the dock ink on the dock;
  `--text-faint` as the quiet mark of an empty state). **Never red, never brass**, never a gradient.
- Sizes: 16 × 21 beside the wordmark in the sidebar and the specimen bar; 24 × 32 in an empty state; at least 16px
  wide anywhere.
- Lockup: φ, 10px gap, "hypotaxis" 15/600 −0.01em, lowercase, `--text-strong`. In the rail the φ stands alone on the
  x = 28 axis.
- Clear space: half its width on every side. Not inside a filled shape, not animated.
- The φ is the product's mark, never a model's: an agent's card shows its model's provider mark (10.1).

## 13. Bots and orbs

Bots are drawn with aphesist/orb2 (`vendor/orb-avatar.min.js`, the `<orb-avatar>` element). The agent never has one.

**Furniture.** Every bot shows the same things in the same places: orb, name, role, schedule, state word. In a list:
orb on the x = 28 axis, name 13 and role 12 quiet from x = 44, state word mono 11 on the right. In its header: orb
40 in the margin, name 16/600, role 12 quiet, state. In a call number: orb 20, name, time.

**Shape, eyes and colour are the bot's own data** (`data.js`: `shape`, `eyes`, `color`). The system never recolours
an orb to match a theme; the orb's colour belongs to the orb only and never appears as UI colour elsewhere.

**One state map** (`HX.ui.states`, `HX.ui.botState(bot)`). Attention outranks work: a bot that needs you shows the
needs face and the red word whatever it was doing.

| State | orb2 reaction | Word | Tone |
|---|---|---|---|
| idle | `idle` (its own `eye-shape`) | nothing in lists; "idle" where a word is required | none |
| listening | `listening` | listening | busy |
| thinking | `thinking` | thinking | busy |
| working | `working` | working | busy |
| compute | `compute` | running | busy |
| speaking | `speaking` | replying | busy |
| needs (or any state with `attention`) | `needs` | needs you | attention (`--red-text`, red flag) |
| done | `done` | done | none |
| happy | `happy` | done | none |
| sleeping | `sleeping` | asleep | none |
| paused | `sleeping` | paused | none |
| error | `error` | failed | attention |

**Interaction reactions.** A hovered or focused live orb turns to `listening` and returns to its state when the
pointer leaves. Approving a teammate request turns its orb `happy`; declining returns it to `idle`. Nothing else
pokes, spins or emotes automatically; `alive` and `extras` stay off.

**Dock orbs (Owner decision).** On an orb in the dock:

| Input | Result |
|---|---|
| Single click | Opens the bot's session in the dock; the orb gets a small poke as the click's feedback. The tab stays |
| The same orb again (session head or switcher), Esc, the close button | Closes the session, back to the row |
| Another orb | Switches the session |
| Double-click | Opens that bot's full chat in the Bots tab (`hx:bot-select`, tab switches to Bots); the session closes |
| Enter, Space | The same as a click: open (or close) the session |
| mod+Enter | The same as a double-click: the full chat |

A session is the bot's last few messages (`HX.ui.html.entry`, yours as request bubbles), its open cards
(`HX.ui.card(..., {size: 'compact', ground: 'dock'})`, the 1 s hold) and the library composer (`HX.ui.composer`);
what you send lands in that bot's thread (`HX.data.botThreads`) and is announced on `hx:bot-message`. The second click
of a double-click belongs to the double-click: nothing under it (a Deny button, the page) receives it. A hovered row
looks toward the pointer through a clamp (about 20 degrees), never with orb2's own follow mode, which turns a face up
to 67 degrees and reads as a crescent; under reduced motion a hovered orb only listens.
Every pointer gesture has a key, so nothing is pointer-only. Under reduced motion the poke is a smaller jiggle.
Elsewhere (lists, call numbers, cards) an orb is not a control on its own: its row or button acts.

**Sizes and motion.**

| Size | Where | Motion |
|---|---|---|
| 10 | Dock minimal pill | `static` |
| 16 | Card minis, schedule rows, arrange tiles | `static` |
| 20 | Lists, call numbers, the composer's addressee | calm |
| 24 | Inline cards, the rail | calm |
| 26 | Dock roster | calm |
| 40 | Dock row (rendered at 80 and scaled, so magnification stays crisp), bot header | calm; the header orb is `lively` |
| 40 | Dock session head (the row orb, travelled) | calm |
| 120 | New-bot preview | calm (the glance lead still steps; its gaze is capped and turns face-on while the shape morphs, so the face never clips the rim) |

- `idle-motion="calm"` everywhere except the bot header, which is `lively`. The new-bot preview is `calm`: a lively tilt plus a full turn toward the pointer clipped the face on pointy shapes.
- **Reduced motion (Owner decision): reduce, never freeze.** Under `prefers-reduced-motion` an orb keeps its blinks,
  eye morphs, small glances and reaction faces; orb2 itself drops floating, head travel, hops, bounces and spins,
  `HX.ui.orb` lowers the jelly to .12 so a poke does not bounce, and `HX.ui.glance` (shared by the lists, the header
  and the dock) moves the eyes of up to three visible orbs in small steps every 1.4–3s, because orb2 holds its
  ambient gaze still then. `static` (one still frame) is only for tiny thumbnails: 16px and under by default, or
  `still: true` for picker tiles up to 28px. Orbs off-screen are paused by orb2 itself; they never need `static`.
- **Live or still, in code:** `HX.ui.orb(bot, {size, live, still})`: `live: true` always animates whatever the size;
  `still: true` is one still frame; otherwise live above 16px and still at 16px and under. An orb made outside the
  library (the dock's 80px-rendered row orbs, a presence orb) gets the same rule with `HX.ui.liven(orbAvatar, {size,
  live, still})`, which also lowers the jelly under reduced motion and enrols it in `HX.ui.glance`. The jelly follows a
  change of the preference at runtime.
- **The lead orb.** Three random steps among fifteen orbs would leave the one orb the user is looking at (the room's
  presence orb, the new-bot preview) nearly still. `HX.ui.glance.lead(orb | () => orb, {skip})` names it: under
  reduced motion it gets its own step every 1.8s, a blink one time in three or a small gaze, and the random steps
  leave it alone. Pass a getter when the lead changes with the view (bots: the preview while making a bot, the
  presence orb otherwise); it is read on every step. The step waits while the pointer is on the orb, while it carries
  `data-glance-hold` (it is following the cursor or a new message), or while `skip(orb)` returns true.
  `lead(null)` clears it; there is one lead at a time; `HX.ui.glance.current` is the lead now. Shortcut for an orb made
  outside the library: `HX.ui.liven(orb, {size, lead: true, skip})`. Without reduced motion orb2's own idle life
  keeps the lead alive and nothing is stepped.
- **Dark bodies** (luminance under .05, e.g. noct `#1c1c24`) get light eyes: `eye-color="var(--ink-on-dock)"`, which
  is light in every theme.
- **Attention flag:** an 8px red dot at the top-right with a 2px ring of the surface behind it (`.ui-dot--flag`).
- **Accessibility:** the orb is `aria-hidden`; the button or row that holds it carries the name ("nina, deploys, needs
  you"). A bot's state change is announced by its row, not by the orb.

## 14. Components

Each component lists anatomy, variants, states, keyboard, accessibility, the library call, and do and don't. Sizes
are at regular density and default corners.

### 14.1 Title bar

- **Anatomy:** 40px frame-colour bar. Left, from x = 14: sidebar toggle, back, forward (28px icon buttons). Centre
  of the window: the command field (26px, inset colour, hairline) showing "project / title" and `ctrl K`. Right:
  session details toggle, then window controls (36 × 28, `--icon-quiet`).
- **States:** the command field's hairline becomes `--line` on hover and brass while the palette is open. Toggles
  show their filled half while expanded.
- **Keyboard:** `ctrl/⌘ K` opens the palette; `ctrl B` sidebar; `ctrl shift B` rail; `ctrl .` session details;
  `ctrl [` and `]` back and forward. The command field is a button.
- **Accessibility:** toggles carry `aria-expanded` and a label that names the next action ("Hide sidebar"); the
  command field's label includes its shortcut and `aria-keyshortcuts`.
- **Library:** `HX.ui.iconButton({icon: 'sidebar-left', label, keys: 'mod+B', expanded})`; window controls with
  `window: true`.
- **Do** keep the bar free of content except the command field. **Don't** put a search input in the sidebar: the
  command field is the search.

### 14.2 Sidebar: open, rail, closed

- **Open** (256–288): brand (φ + hypotaxis, 44px), the Session | Bots pill, "New session" or "New bot", the list,
  then the account row (avatar 24, name, settings gear) above a hairline.
- **Rail** (56): φ, the vertical pill (icons), "+" and the avatar on the x = 28 axis. Lists render a rail variant
  (bots: orbs 24 in 40px rows with the attention flag) or hide.
- **Closed** (0): the ground starts at the window edge; the title-bar toggle brings it back.
- **Overlay** below 900px: it floats over the ground with `--shadow-side` and a scrim; Esc or the scrim closes it.
- **Keyboard:** `ctrl B` toggles open/closed, `ctrl shift B` the rail; `alt 1` and `alt 2` switch tabs; `ctrl shift O`
  new session or bot.
- **Do** keep the axes: collapsing to the rail moves nothing that stays. **Don't** add a permanent "new" row to a list;
  only a draft row while something is being made.

### 14.3 Tabs pill (segmented control as tabs)

- **Anatomy:** inset-colour track (`--bg-0`) with a hairline, 3px padding, `--r-s`; a bone thumb concentric with the
  track (`--r-in`, 9 by default) that slides
  by transform over `--dur-slide`; labels 13/500.
- **States:** selected (ink on bone), unselected (`--text-dim`, hover `--text-strong`), with an attention dot beside
  an unselected label when that tab owes something. On an icon-only option (the rail) the dot sits on the option's
  top-right corner, out of the flow, so the icon stays on the x = 28 axis.
- **Variants:** tabs (`role="tablist"`, switches a view); radio (`role="radiogroup"`, sets a value: Governed |
  Ungoverned, preset pickers); small (12px labels, settings rows); vertical (the rail); fill (full width).
- **Keyboard:** one tab stop; Left/Right (Up/Down when vertical) move and select; Home and End.
- **Accessibility:** `aria-selected` or `aria-checked`; the dot is `aria-hidden` and the tab's label gains ", needs
  you".
- **Library:** `HX.ui.segmented({options, value, mode: 'tabs'|'radio', size, vertical, fill})`, fires `ui:change`.
- **Do** use it for two to four exclusive options. **Don't** use it for on/off (that is a switch) or for more than four.

### 14.4 List rows

- **Anatomy:** a 30px row (`--row-h`) inset 8px in its list, radius `--r-s`, padding 0 4 0 12; a 16px lead column
  (glyph or orb) centred on x = 28; the title from x = 44; an end slot for mono meta, a state word or actions.
  Two-line rows (`--row-h-2`, 44) add a 12px quiet sub line.
- **Lead glyph:** running: a bone dot breathing; needs you: a red dot; current and idle: a brass dot; otherwise
  nothing.
- **States:** hover `--hover`; current `--current` with `--text-strong`; archived: quiet title struck through with
  `--line-strong`; actions (rename, archive, 24px icon buttons) replace the meta on hover and focus-within, and the
  title then ellipsises before them (the row reserves one icon button's width plus 2px per action, from `--acts`).
- **Group heading:** 12/500 quiet at x = 20, 24px tall, 12px above the group; collapsible with a chevron that shows on
  hover, focus or when collapsed.
- **Keyboard:** one tab stop per list; Up/Down, Home/End move; Enter or click opens; F2 (or the pen) renames.
- **Accessibility:** rows are buttons with `aria-current="true"` on the current one; the state word is in the
  accessible name; groups are `role="group"` with the project name.
- **Library:** `HX.ui.row({title, sub, end, endTone, lead, current, archived, acts})`, `HX.ui.group({label,
  collapsible, rows})`, `HX.ui.html.leadFor({running, attention, current})`. Rows inside `[data-ui="rows"]` get roving
  focus and fire `ui:select`.
- **Do** keep meta right-aligned mono. **Don't** add icons to text rows; the lead column is for state.

### 14.5 Call-number margin entry (the signature)

- **Anatomy:** a grid of `--hx-margin-w` (112) and the measure (608). The call number is mono 11/1.45 `--text-quiet`,
  first line `--text-dim`. User: "You", time. Agent: one line per model ("qwen3-coder", "→ sonnet 5.5"), elapsed,
  cost, then the steps disclosure. Bot: orb 20, name, time. 32px between entries.
- **Narrow:** under 560px the margin collapses and the call number becomes one line above the entry.
- **Accessibility:** each entry is an `article` labelled by its call number; costs read as text.
- **Library:** `HX.ui.entry({kind, who, callno: [...], steps: {count, id}, body})`.
- **Do** put model, time and cost here and only here. **Don't** repeat them in the prose or in a meta line under it.

### 14.6 Request card

- What the user wrote: `--bg-3`, `--r-m`, padding 10 14, reading type, `width: fit-content`, left-aligned in the
  measure. Never a right-aligned bubble. `HX.ui.request(text)`.

### 14.7 Prose and code chips

- Prose: 14/1.6 `--text`, paragraphs 12px apart, lists indented 18px with quiet markers, measure 608.
- Code chip: mono 12px on `--chip`, `--r-xs`, padding 1 5; wraps with its background cloned per line instead of
  overflowing. `HX.ui.code(text)`; `HX.ui.html.inline(text)` turns backticks into chips.
- **Don't** set code at 12.5 or 13; the scale has 12.

### 14.8 Steps disclosure

- **Anatomy:** a quiet mono button in the call number ("› 6 steps", chevron rotates 90° when open) that reveals an
  ordered list at the top of the answer: a 5px dot per step on a hairline spine, title 13, mono meta, time right.
  A failed step is a ring; an escalation is a 7px ring in `--text-dim`.
- **Keyboard:** Enter/Space toggles; `aria-expanded` and `aria-controls` on the button.
- **Library:** `HX.ui.disclosure({label, controls})`, `HX.ui.steps(items, {id, hidden})`.

### 14.9 Blank and the "waiting for you" stamp

- **Anatomy:** inside the sentence it belongs to: a gap (at least 7ch) with a 1px dotted `--red` underline, then the
  stamp. Answered: the answer replaces the gap with a dashed quiet underline and the stamp goes.
- **States:** open (stamp), hover (solid underline, `--red-soft` behind the stamp), open popover, answered.
- **Popover:** 360px, frame colour with line and pop shadow: the short question, options as radio rows with number
  keys 1–9 (the chosen one brass), "Or write your own" field, Later and Answer (primary, disabled until a choice).
- **Keyboard:** Enter opens; in the popover Up/Down move, 1–9 pick, Enter answers, Esc closes and returns focus,
  Tab stays inside.
- **Accessibility:** the blank is a button "Answer the open question, waiting for you", `aria-haspopup="dialog"`;
  the popover is labelled by the question; the answer is announced.
- **Library:** the card layer, `HX.ui.card('blank', data, {size: 'inline'})`; the static mark `HX.ui.html.blank()`.

### 14.10 Composer, feedforward and chips

- **Anatomy:** `--bg-3` box, hairline, the column's width. A container (section 8.2): radius `--r-outer`
  (`--r-composer` where a context sets one, else `--r-m`), inset `--pad` 6px (`--composer-pad`). Input 14/1.6,
  padding 12 14 4, grows to 220px. The bar inside, inset 6px from the bottom and both sides: attach (+), the
  module's chips, a spacer, the capacity ("$0.37 of $0.60", mono quiet), then the **actions group**: mic and send
  (bone 28px). Every control at the edge takes `--r-in` (10 by default), so the corner pieces are concentric with
  the box. Above it, the assumptions row ("Will assume: refactor, src/billing, npm test…", 12px quiet) shows while
  typing; each assumption is a focusable quiet button. Nothing below.
- **Compact** (`data-compact`; the dock session, and any composer that is only text): one row, 40px, the text and
  the actions group side by side. The input's padding centres one line on the 28px actions; the group sits in the
  bottom-right corner, 6px from both edges, concentric with it, and stays on the last line as the text grows (to
  120px in the dock). This replaces the dock's send that floated alone under the text. Chosen automatically when the
  composer has no attach, chips, spend or hint, or with `compact: true|false`.
- **Talking** (Owner decision: every composer has the mic; `mic: false` is ignored). A click on the mic toggles
  listening; pressing and holding it for 400ms or more talks while held (push to talk), and releasing stops; alt+V
  does the same from the keyboard (a tap toggles, a hold talks while held); Esc while listening stops listening and
  is consumed; sending stops it too. Listening: the mic pressed (`--current` fill, brass glyph, "Stop listening"),
  the box's line at `--line-field`, the placeholder "Listening" or "nina is listening", announced politely. **When a
  bot is the target** (`bot`), the mic is labelled "Talk to nina", every orb of that bot on screen
  (`.ui-orb[data-bot]`, plus any the module passes in `orbs()`) takes orb2's `listening` reaction, and the mic shows
  the bot's own 18px orb listening in place of its glyph; on stop each orb gets its reaction back. The audio is the
  host's: the composer fires `ui:dictate {value, bot, mode: 'toggle'|'hold'}`.
- **Feedforward:** words the agent read from the request are underlined dashed (`--text-dim`): its guess. Click, or
  Alt+Down with the caret on one, opens a menu of readings; picking one makes the line solid brass: your choice.
- **Chips:** toggles for modes (Governed with the ladder icon, Smart with the spark), 26px, 12/500 `--text-dim`;
  pressed: `--text` with a brass icon; unpressed: label struck through with `--line-strong`. A model chip is mono with
  a chevron and opens a menu.
- **States:** empty (placeholder quiet, send disabled at .35), typing (hint shows), focused (frame line becomes
  `--line-field`), running (send becomes Stop with the square glyph; `mod+.` stops), listening (above).
- **Keyboard:**

| Key | Does |
|---|---|
| Enter | Sends |
| Shift+Enter | Breaks the line |
| mod+Enter | Sends from anywhere in the composer (the assumptions row, a chip) |
| ↑ on an empty composer, caret at the start | Asks for the last message to edit (`ui:edit-last`) |
| Tab (while the assumptions row shows) | Moves into the assumptions; Left/Right between them; Enter or Space opens one (`ui:assumption`); Delete or Backspace drops it (`ui:assumption-drop`); Shift+Tab or Esc returns to the text |
| Alt+Down on a dashed word | Opens its readings (`ui:decision`) |
| Alt+A | Attach (opens the attach menu) |
| Alt+V | Talk: a tap toggles listening, a hold (400ms or more) talks while held (the mic carries `aria-keyshortcuts`) |
| Esc, while listening | Stops listening (consumed); otherwise Esc belongs to the shell and the dock |
| mod+. | Stop while running (the shell's shortcut; Esc belongs to the shell, not the composer) |

  Paste is plain text.
- **Accessibility:** `role="textbox"` with `aria-multiline`, a label, and an `aria-description` explaining the dashed
  words and the Tab path; the assumptions row is a `group` labelled "Will assume"; send carries
  `aria-keyshortcuts` (Enter, or `mod+.` as Stop); attach carries Alt+A; the mic carries Alt+V and
  `aria-pressed`. Pressing the mic with the pointer does not take focus from the text, so you can talk and type.
  Region markers: `data-hx-composer` on the root, `data-hx-focus="composer"` on the text field.
- **Library:** `HX.ui.composer({placeholder, value, chips, spend, attach, bot, orbs, compact, hint, feedforward})`
  where `hint` returns a sentence or a list of assumptions `[{label, value, kind, text}]` and `bot` is a bot (or its
  id); events `ui:send`, `ui:stop`, `ui:decision`, `ui:dictate`, `ui:edit-last`, `ui:assumption`,
  `ui:assumption-drop`; methods `setValue`, `insert`, `focus`, `refresh`, `setRunning`, `setSpend`, `setHint`,
  `flashHint`, `addFile`, `setListening`; `listening` reads the state.
- **Do** keep module-specific chips in the chips slot (bots: "Also on Slack"). **Don't** build a second composer.

### 14.11 Right panel: dots measure, sections, governance ladder

- **Closed:** a 28px strip on the frame colour holding one button: the context measure, 8 dots of 4px in a column,
  filled from the bottom (`--text-dim` on, `--text-faint` off: on and off differ by colour alone, so the gap between
  them stays wide; the button names the value), centred above the dock space, in a button of at least
  24 × 24 (`.ui-measure-btn`). Tooltip "Context 38% used ctrl .".
- **Open:** frame colour, `--right-w`. Head 44px with "Session details" 13/600 at x = 20; no close button (the
  title-bar toggle and `ctrl .` own it). Sections are disclosure rows (40px: label 13, mono quiet meta right,
  chevron), body padding 0 20 16, hairlines between.
- **Sections:** Context (40 dots in 20 columns shaded by part with a legend, "Compact conversation"), Tasks, Changes
  (paths mono with `+n −n`), Output (terminal well), Connectors (switch rows), Environment (dl), Governance (segmented
  Governed | Ungoverned, the ladder as a list with the current station brass, the spend against the cap).
- **Keyboard:** each section head is a button with `aria-expanded`; a panel opened from elsewhere flashes its section
  head with `--brass-soft` once.
- **Library:** `HX.ui.measure({used, total, dots: 8})` in `.ui-measure-btn`; `HX.ui.measure({variant: 'grid', parts})`
  with `HX.ui.legend(parts)`; `HX.ui.section({label, meta, open, body})`; `HX.ui.ladder({stations, current, variant:
  'list'})`; `HX.ui.capacity(spent, cap)`; `.ui-panel` for the frame.
- **Do** show context as dots. **Don't** draw a bar (Finding F18).

### 14.12 Dock

- **Slab:** `--dock-bg` black in every theme, flush to the bottom edge, `--r-l` top corners with two `--r-l` concave
  flares, centred on `--hx-center-x` with the composer. 76px at rest (the 24px foot is inside it). Everything inside
  sits on `data-ground="dock"`.
- **Pages** (a quiet nub of page dots in the foot, about 7px above the window edge, between Arrange and Minimise; the
  current one a 14 × 4 brass pill that slides, the others `--mark-off`; a page that owes something has a red dot; no
  tab on the top edge, no side lanes or arrows): Bots (orbs 40 at a 54px pitch, "+"), Run (ladder, title and models,
  elapsed, spend, stop), Needs you (compact approval and blank cards), Scheduled (rows with orb 16, what, when),
  Context (off by default).
- **States:** off (nothing drawn, nothing depends on it), minimal (a 28px pill: the bots as 10px orbs and the
  attention dot; it restores and offers nothing else), normal, expanded (roster in a 4-column grid of two-line rows,
  or a page's detail), a bot's session, edit (arrange pages: tiles, show or hide, move with Alt+Left/Right).
- **Motion:** the slab's outline is one path rebuilt from critically damped springs so the flares follow every
  morph; shared elements (orbs) travel between views instead of re-creating; while anything travels the content is
  held inside the slab; hover magnifies the row (1.42). Under reduced motion every size change is instant and lands in
  the same frame as its content (entrances fade 140ms); no magnification, no sliding, no overshoot.
- **Orbs (Owner decision):** one click or Enter opens the bot's session in the dock; the same orb again or Esc closes
  it; double-click or mod+Enter opens the full chat in the Bots tab. See section 13.
- **Keyboard:** [ ] and PageUp/PageDown change pages, Left/Right move within the bot row (and within the nub), Up/Down
  expand and collapse, Esc closes a session, then returns to normal; on an orb Enter opens the session and mod+Enter
  the full chat; holding Space or Enter twice on the hold button approves. Horizontal wheel pages; vertical wheel
  expands.
- **Accessibility:** the row is a toolbar of orb buttons named "nina, deploys, needs you"; page dots are a tablist;
  mode changes are announced ("Dock minimised").
- **Library:** contents are library parts on the dock ground: `HX.ui.orb`, `HX.ui.row` (roster), `HX.ui.card(kind,
  data, {size: 'compact', ground: 'dock'})` (needs you), `HX.ui.ladder` (run), `HX.ui.capacity`, `HX.ui.pages`,
  `HX.ui.hold`. `.ui-slab` draws a still slab; the live dock keeps its morphing path.
- **Do** keep it a second path. **Don't** give it its own approval rows, buttons or palette (Findings F1, F2).

### 14.13 Cards

One element (`<hx-card>`, `HX.ui.card(kind, data, opts)`), eight kinds, three sizes, every state.

- **Anatomy:** drawer colour (`--bg-0`; a card in the dock uses the dock `--surface`), `--r-m`, padding 14 16, up to
  520px (inline) or 360px (compact); an optional side column (orb 24/20 or a connector tile); a head (title 14/600 as
  a sentence, "nina wants to deploy to staging", with the stamp in its corner), a quote (`--text-dim`), a well (the
  ground colour, `--r-s`, mono first line), a foot (mono quiet meta left, actions right) or a receipt.
- **Sizes:** inline (in the measure), compact (dock, side panel), mini (one 30px row with an orb or tile, text, the
  attention dot and a short meta). Blank also has popover.
- **Decided cards recede:** title and well step back to `--text-dim`; the foot becomes a receipt.
- **Height:** every state change animates height over `--dur-3` (the owner's exception).
- **Attention:** a card that owes something reports it (`hx:attention {source: 'cards'}`); its stamp is the only red.

| Kind | States | Stamp | Primary action |
|---|---|---|---|
| approval | pending, holding, approved, denied, expired | needs you (pending, holding) | Hold to approve; Deny; Ask again when expired |
| ship | passed, failed, rolled-back | failed | Open PR; Fix and retry; Try again |
| blank | open, answered | waiting for you | Answer |
| teammate | pending, accepted, declined | none | Accept; Decline |
| escalation | escalated, capped | needs you (capped) | Raise cap to $1.00; Stop here. Inline it is a rule across the answer with the ladder |
| error | failed, retrying, passed | failed | Retry on sonnet 5.5; View output; Stop |
| schedule | pending, scheduled, dismissed | none | Schedule it; Not now; Edit |
| connector | needed, waiting, connected, failed | failed | Sign in; Try again; Cancel |

- **Keyboard:** actions are buttons in order; a queue of approvals shows its position as dots and announces "Request 2
  of 3"; a resolved card keeps focus on its next sensible control.
- **Accessibility:** each card is labelled by its title; state changes are announced politely ("Approved: …");
  running states set `aria-busy`.
- **Do** keep red to the stamp. **Don't** add dither or texture; **don't** nest a card in a card.

### 14.14 Buttons

| Variant | Look | Use |
|---|---|---|
| Primary | `--selected` fill, `--text-on-light`, no outline; hover `--text-strong` | One per group: the action that moves the work forward |
| Secondary (default) | Transparent, inset 1px `--line`, `--text`; hover `--hover` | Everything else |
| Ghost | No outline, `--text-dim`, 8px padding; hover `--text-strong` | The quiet way out: Not now, Later, a toast's Undo |
| Small | `--ctl-s` tall, 10px padding, 12/500 | Inside cards' compact rules, panel actions |
| Icon | 28px, `--r-s`, 18px glyph, `--icon`; hover `--hover` + `--text-strong` | Toolbars; always with a tooltip |
| Window | Icon at 36 × 28, `--icon-quiet` | Title bar only |
| Send | Bone 28px square, 16px arrow; disabled at .35; Stop while running | The composer only |

- **States:** hover (fine pointer only for icon buttons), press (1px down, scale .985 / .96), focus (brass ring),
  disabled (`--text-quiet`; primary disabled on `--bg-4`), armed (a destructive confirm: strong line and the label
  "Click again to archive"; never red).
- Height `--ctl`, radius `--r-s`, 13/500, sentence case through `--ui-case`. A button may show its keys on hover
  (New session ctrl shift O).
- **Library:** `HX.ui.button({label, variant, size, icon, keys, disabled})`, `HX.ui.iconButton({icon, label, keys,
  pressed, expanded})`, `HX.ui.html.send({running, disabled})`.

### 14.15 Hold to approve

- **The one control that commits by holding.** Card stock at rest (`--bg-3` with a hairline, min 148px); hover
  `--bg-4`. Pressing gathers an ordered dot field (Bayer 4 × 4 on a 3px grid) at the leading edge that fuses into
  the bone fill behind it; the label inverts as the fill passes. **1 second** (`--dur-hold`, 1000ms) everywhere:
  **Owner decision**, confirmed. Released
  early, it drains in 280ms and says "Keep holding". Finished: "Approved", then `ui:commit`.
- **Keyboard:** hold Space; or press Enter twice within four seconds (the first press arms it: "Press again to
  approve"). A screen reader's single activation arms it the same way.
- **Accessibility:** described by a hidden hint ("Press and hold for one second, hold the space bar, or press enter
  twice"); progress and arming are announced politely.
- **Library:** `HX.ui.hold({label, ms})` (or `HX.ui.html.hold()` + `HX.ui.hold.wire(btn)`); `ui:commit` is
  cancelable; `btn._hold.reset()`, `.show(p)`.
- **Don't** make it a primary button at rest, change its duration per surface, or put it anywhere but an approval.

### 14.16 Switches

- A native checkbox with `role="switch"`: 34 × 20 pill, inset `--bg-0` with a `--line-strong` edge, a 14px
  `--text-quiet` knob; on: bone track, ink knob slid 14px over `--dur-2` (200ms). Disabled at .45.
- Label it with a visible `<label for>`; in a settings row the label is on the left with a hint below.
- **Keyboard:** Space toggles. **Library:** `HX.ui.switch({id, checked, label})`, `ui:change`.
- **Do** use for settings that apply at once. **Don't** use for an action or a mode that needs a confirmation.

### 14.17 Chips

- **Shape:** a capsule (`--r-pill`), as on iOS; inside the composer's bar it takes the bar's `--r-in`, which is a
  capsule at that height too.
- **Toolbar chip:** see 14.10. **Option chip:** a radio in a group of presets (Only when asked, Hourly, Every night,
  Weekday mornings): 26px, outline `--line`; checked: `--current` fill and an inset brass line. Arrows move and
  select. **Code chip:** 14.7. **Key chip:** `.ui-kbd`, 18px, `--bg-3`, hairline, mono 11 `--text-dim`; on a
  tooltip `--bg-4`.
- **Library:** `HX.ui.chip({label, icon, pressed, mono, haspopup})`, `HX.ui.chipGroup({options, value})`,
  `HX.ui.keys('mod+shift+O')`.

### 14.18 Menus

- **Anatomy:** frame colour, `--r-m`, padding 4, inset `--line` and `--shadow-pop`, 220–340px. Items 30px min,
  padding 6 8, concentric with the menu (`--r-in` = `--r-m` − 4, 16 by default): a 16px glyph column (icon, or a brass check for checked items), label (13) with an optional
  12px quiet description, keys or a stamp on the right. Titles 12/500 quiet; separators a hairline; a foot note 12
  quiet above a hairline.
- **Motion:** fade with a 6px drop over `--dur-2` (rise when it opens above); closes in 160ms.
- **States:** hover `--hover`; keyboard focus `--current` with an inset 2px brass ring; checked: brass check;
  disabled `--text-quiet`.
- **Keyboard:** opens with focus on the checked item or the first; Up/Down/Home/End; typing a letter jumps; Enter
  selects; Esc closes and returns focus to the trigger; Tab closes.
- **Accessibility:** `role="menu"`, items `menuitem`, `menuitemradio` or `menuitemcheckbox` with `aria-checked`; the
  trigger has `aria-haspopup` and `aria-expanded`.
- **Library:** `HX.ui.menu.open(anchor, items, {label, place, align, multi, onSelect})`; `HX.ui.menu.still(items)` for
  documentation. One layer is open at a time.

### 14.19 Popovers

- The menu's surface with arbitrary content (`role="dialog"`, padding 12, 360px): the expanded blank, a quick edit.
  Focus moves inside; Tab loops; Esc and outside clicks close and return focus. `HX.ui.popover.open(anchor, node,
  {label})`.

### 14.20 Command palette

- A scrim, then a 600px box 48px from the top: frame colour, `--r-l`, line and pop shadow. A 48px field (search icon,
  input 14 `--text-strong`, `esc` key) above a hairline; groups (12/500 quiet) of 34px rows (icon or orb, label with
  the match underlined in brass, quiet meta, a mono trail; a red trail for something owed); the selected row
  `--current`. Empty: "No matches for … Try a session title, a bot's name or a command."
- **Keyboard:** `ctrl K` opens; typing filters; Up/Down move; Enter runs; Esc closes. `role="combobox"` with a
  `listbox`.
- **Library:** the palette is a shell singleton; its rows should be `.ui-row` at `--row-h` (Finding F10) and its
  surface `.ui-pop`'s.

### 14.21 Settings

- **Dialog:** 600 × 680, frame colour, `--r-l`; head 52px with "Settings" 16/600 and tabs (General, Appearance,
  Keyboard) as 28px buttons, the active one `--current`. Appearance steps aside to the right edge (420px, no scrim)
  so changes show on the whole app.
- **Rows:** `.ui-set__row`: label 13 with a 12px dim hint on the left, the control on the right, 40px min, hairline
  between; group headings 12/500 quiet, 20px above.
- **The customizer** (`theme.js`): preset cards (a chip strip of six swatches, name 13/600, note 12), type selects,
  case/corners/density segmented controls, colour rows (swatch, label and hint, hex field, Reset), the contrast list,
  JSON export and import.
- **Bot settings sheet:** `--right-w`, frame colour, concave top-left corner, head "Bot settings" with a close button
  (a sheet opened from inside a view has its own close and Esc; the right panel does not), sections divided by
  hairlines, a foot (Archive nina, Done).
- **Library:** `HX.ui.setRow({label, hint, for, control})`, `.ui-set__head`, `.ui-panel`, `HX.ui.segmented({size:
  's', mode: 'radio'})` for every choice (the customizer's radio `.hx-choice` migrates to it).

### 14.22 Toasts

- One line at the top of the work: `--chrome-h` + 12px, centred on the centre line, raised colour with a hairline and
  pop shadow, `--r-m`, 40px high, 13px; optional ghost action (Undo), 6px from the edges and concentric with the
  toast (`--r-in`). Fades with a 6px drop; stays 3s (6s with an action) and
  waits while hovered or focused. `role="status"`. `HX.ui.toast(text, {action: {label, onClick}})`.
- **Do** confirm what just happened ("Archived audit log export"). **Don't** report errors in a toast; an error stays
  where it happened.

### 14.23 Tooltips

- Raised colour, hairline, `--shadow-tip`, `--r-s`, 12px, padding 4 8 (4 4 4 8 with keys, whose keys are concentric
  with it: `--r-in`), keys after the label, an
  optional mono state ("needs you" in red text). Below the target, or above within 160px of the window bottom, or to
  the right in the rail.
- **Timing:** 480ms the first time, at once while warm (700ms after the last), at once on keyboard focus; hides on
  pointer down, focus out and Esc.
- **Accessibility:** visual only (`aria-hidden`): it repeats the control's `aria-label`; shortcuts are also in
  `aria-keyshortcuts`. Never put information only in a tooltip.
- **Library:** any element with `data-tip`, `data-kbd`, `data-tip-pos`, `data-tip-state`; `HX.ui.tooltip`.

### 14.24 Focus rings

- **2px solid `--brass` outline, 2px offset, no transition**, on `:focus-visible` only. Fields put the ring on the
  field box (`:focus-within`), not the bare input. Menu items and option rows inside a floating surface use an inset
  2px ring with the `--current` fill (an offset ring would be clipped). The composer's frame shows focus as
  `--line-field` (it holds focus most of the day; a brass ring around it would be loud) and its caret is brass.
- **On a surface with a drawn corner** (section 8.1: buttons, rows, menu items, cards) the element is clipped to its
  path, which would clip an outline, so the ring is drawn by the library inside the edge: 2px of `--focus` along the
  same continuous path. Its contrast is the same (brass against the surface around the element, 3:1 and up).
- On the dock ground the ring is the dock's brass. Orb buttons use a 3px offset.

### 14.25 Fields

- `.ui-input`: `--ctl` min height, `--r-s`, `--bg-0` on the frame (`--bg-3` raised variant on the ground), inset 1px
  `--line-field`, 13px sans (mono variant 11), placeholder quiet. Hover `--text-quiet` line; focus the ring; error
  `aria-invalid="true"` with a red line and a red-text message below; disabled at .55.
- Label above (12/500 dim) with `for`; hint or error below (`aria-describedby`). Textareas grow, no resize grip.
  Selects draw their own chevron.
- **Library:** `HX.ui.field({id, label, hint, error, kind, value, placeholder, mono})`.

### 14.26 Stamps and dots

- **Stamp:** 20px, padding 0 7, `--r-xs`, inset 1px `--red`, `--red-text`, mono 11/500. Three wordings. Never filled.
- **Dots:** 6px pills. Run (`--text`, breathing), attention (`--red`), here (`--brass`), flag (8px red with a 2px ring
  of the surface, on orbs), small (5px, inline in meta). Idle has no dot.
- **Library:** `HX.ui.stamp(text)`, `HX.ui.dot(kind, {size, label})`.

### 14.27 Ladder, measures, capacity, pages

- **Ladder line:** 5px stations joined by a 1px `--line`; past `--text-dim`, now brass, next a `--mark-off` ring
  (3:1 on every surface; it differs from the past by shape as well, a ring against a fill).
  Inline in an escalation rule, a mini row, the dock run page. `role="img"` labelled "Model ladder, station 3 of 4:
  sonnet 5.5".
- **Ladder list:** 8px stations on a spine, model mono 11, the rule that reaches it (first try, after 1 fail, after 2
  fails, by request) right-aligned; the current station brass, its model `--text-strong`. In the panel, bot settings
  (where the current station is the starting rung) and the compact escalation card. `ol` with `aria-current="step"`.
  Stations to come are `--mark-off` rings here too.
- **Measure:** strip (8 dots, the closed panel), grid (40 dots shaded by part), row (a small count). `role="img"` with
  "Context 38% used".
- **Capacity:** "$0.37 of $0.60", the spent part `--text`, the rest quiet, mono tabular.
- **Pages:** 4px dots in `--mark-off`; the current a 14 × 4 brass pill (shape and colour); red when that page owes
  something; a tablist when it pages (dock), an image when it only shows position (a card queue; its current dot
  carries `data-current`, no ARIA state).
- **Library:** `HX.ui.ladder`, `HX.ui.measure`, `HX.ui.legend`, `HX.ui.capacity`, `HX.ui.pages`.

### 14.28 Empty states

- Centred in the space above the dock: the φ at 24 × 32 in `--text-faint`, a title 16/600, one or two sentences 13/1.6
  dim (46ch), and the one action that fills it ("New session ctrl shift O"). Teach the interface, never "Nothing
  here". `HX.ui.empty({title, text, action, mark})`.

## 15. Accessibility

WCAG 2.1 AA is the floor (PRODUCT.md). Audit of the specimen and the library on 18 November 2026: axe-core 4 (wcag2a,
wcag2aa, wcag21aa, best-practice) in Chromium at 1440 in every preset, at 720 (200% zoom equivalent) and at 390;
a 160-stop keyboard walk; scripted checks of every interactive component; reduced-motion run.

**Result** (re-run after the corners and composer pass, 18 November 2026, evening: unchanged, in all four presets
at 1440 and 390 and in Card catalog at 720): zero axe violations in every preset, at 720 and at 390, once the library fixes below were in and the
three Bone values of Finding F4 landed in `tokens.css` (they have). No horizontal overflow at 390 or 720. Re-run
after `--mark-off` (18 November 2026, evening): unchanged.

| # | Issue | Criterion | Severity | Where | Fix |
|---|---|---|---|---|---|
| A1 | Text-field outlines at 1.14–1.35:1 | 1.4.11 | Major | every field in the mock-up | `--line-field` (done in the library) |
| A2 | Bone `--add`, `--del`, `--red-text` on a selected row under 4.5:1 | 1.4.3 | Major | right panel Changes, bots list | Finding F4 values |
| A3 | Brass used as text (current rung's rule, dock tag) at 4.0:1 in Bone | 1.4.3 | Major | `session.css .ssr-rung.now .ssr-when`, `dock.css .dk-tag` | Brass never text (done in the library) |
| A4 | Kbd label in tooltips at 4.25:1 | 1.4.3 | Minor | `shell.css .hx-tip kbd`, `session.css .ss-tip kbd` | `--text-dim` (done in the library) |
| A5 | The customizer's contrast check misreads translucent tokens | 1.4.3 (process) | Major | `theme.js compositeOf` | Finding F6 (fixed in `theme.js`) |
| A6 | Panel sections were `section` landmarks with repeated names | best practice | Minor | `HX.ui.section` | now `role="group"` (done) |
| A7 | Option rows in the blank popover show focus as a fill only | 2.4.7 | Minor | `cards.css .cd-opt:focus-visible` | the menu item's inset brass ring (done in `cards.css`) |
| A8 | Page dots and small segmented options are under 24px | 2.5.8 (2.2) | Minor | dock page dots 10px, small segmented 22px | Keep (keyboard paths exist); give page dots a 24px tall hit area. The context measure button is now at least 24 × 24 (done) |
| A9 | Recording shown only by red on the mic | 1.4.1, stamp rule | Minor | `session.css .ssc-mic` | pressed state (brass) plus the label "Stop dictation" (done) |
| A10 | Inactive page dots and ladder rings at 2.0–2.4:1 (`--text-faint`), 2.3–2.5:1 in the dock | 1.4.11 | Minor | `HX.ui.pages`, `HX.ui.ladder`, card queues, the blank's option ring, the schedule's weekdays | `--mark-off` (done in the library; F28 for the modules) |

**Keyboard map** (library components):

| Component | Tab | Enter / Space | Esc | Arrows |
|---|---|---|---|---|
| Segmented, pages | one stop | select | none | move and select; Home, End |
| Rows | one stop per list | open | none | Up/Down; Home, End |
| Menu | focus moves in | select | close, focus returns | Up/Down; letters jump |
| Popover | loops inside | per control | close, focus returns | per control |
| Hold to approve | stop | Space hold; Enter twice | none | none |
| Composer | stop; then the assumptions row | Enter sends; Shift+Enter newline; mod+Enter sends from anywhere in it | stops listening; otherwise the shell's (Stop is mod+.) | ↑ on empty edits the last message; Alt+Down opens a reading; Alt+A attaches; Alt+V talks |
| Section, disclosure, group | stop | toggle | none | none |
| Switch | stop | Space toggles | none | none |
| Tooltip | shows on focus | none | hides | none |

**Screen reader:** icon buttons are named by `aria-label` (tooltips are `aria-hidden` duplicates); toggles expose
`aria-pressed` or `aria-expanded`; segmented controls are `tablist`/`radiogroup`; rows are buttons with
`aria-current`; ladders and measures are images with a sentence; orbs are hidden and their holder is named; the hold
button is described by its instructions; cards and toasts announce through polite live regions. Not tested with a
real screen reader (VoiceOver, NVDA): do that before shipping.

## 16. Findings

What the extraction found in the mock-up, with the fix. None of the mock-up's files were edited; the library already
holds the canonical version of each fix and MIGRATION.md says who changes what.

| # | Kind | Finding | Where | Fix |
|---|---|---|---|---|
| F1 | drift | **Three hold-to-approve buttons.** Cards: Bayer dot field, 1000ms, card stock at rest, Space or Enter twice. Dock: a `scaleX` bone fill under a `mix-blend-mode: difference` label, 650ms. Bots fallback: a primary (bone) button with a 14% `--text-on-light` overlay, 1100ms linear. | `cards.js holdController`, `dock.js HOLD_MS`, `dock.css .dk-hold`, `bots.css .bt-hold`, `bots.js` | `HX.ui.hold`, promoted from cards.js; `--dur-hold` 1000ms |
| F2 | drift | **Two dock palettes.** `dock.css` re-derives 25 `--dock-*` inks (switching on `data-hx-theme`); `cards.css` re-derives them again for `hx-card[data-ground="dock"]` (with `light-dark()`). | `dock.css` 14–50, `cards.css` 18–45 | One `[data-ground="dock"]` scope in `components.css`; components read the usual roles |
| F3 | contrast | **Field outlines at 1.14–1.35:1.** Every text field is bounded by `--line` (15%) on a fill one step from its surround. | `.bt-field`, `.ssp-field`, `.cd-free`, `.hxt-hex`, `.hxt-select`, `.ssl-title input` | `--line-field` 42% (54% light): 3.0–3.5:1 |
| F4 | contrast | **Bone fails three text pairs:** `--add` 3.97, `--del` 4.38 on the frame; `--red-text` 4.38 on a selected row. | `tokens.css` Bone | Bone `--add #356b43` (5.06), `--del #a63d35` (5.05), `--red-text #a82328` (4.90 on a selected row, 6.29 on the ground) |
| F5 | contrast | **Kbd in tooltips at 4.25:1** (`--text-quiet` on `--bg-4`) in three presets. | `shell.css .hx-tip kbd`, `session.css .ss-tip kbd` | Keys are `--text-dim` |
| F6 | bug | **The customizer misreads translucent colours.** `theme.js` reads computed colours with a number regex; Chrome returns `color(srgb 0.91 0.89 0.85 / 0.085)` for `color-mix()`, so `--current@--bg-1` is composited from 0–1 values as if they were 0–255 (near black). The selected-row pairs are measured against the wrong colour and can pass while failing. | `theme.js hexOf`, `compositeOf` | **Resolved:** `theme.js parseColor` reads `color(srgb …)` and composites from it |
| F7 | drift | **Five ladders.** Session panel: 8px stations, the current one 10px with a 3px `--brass-soft` halo (a zero-offset coloured glow). Cards: 5px line and 7px list. Dock: 3px vertical ticks. Bots settings: 9px stations with a 1.5px ring. | `session.css .ssr-rung`, `cards.css .cd-ladder .cd-steps`, `dock.css .dk-tick .dk-ladderx`, `bots.css .bt-ladder` | `HX.ui.ladder` line (5px) and list (8px), no halo |
| F8 | drift | **Two words for one state.** happy reads "done" in the bots list and "finished a task" in the dock; compute reads "working" and "running a job". Reactions also differ (bots map done to happy; dock maps paused to sleeping). | `bots.js STATE_WORD`, `reactionFor`; `dock.js STATE_WORD`, `reactionOf` | `HX.ui.states`, `HX.ui.botState` |
| F9 | rule | **Red outside the stamp rule.** The mic turns `--red-text` while dictating; the bots "Archive" button turns red when armed. Neither is owed. | `session.css .ssc-mic[aria-pressed]`, `bots.css .bt-secondary.is-armed` | Pressed icon buttons are brass; armed buttons strengthen their line and change their label |
| F10 | scale | **Ad-hoc values.** Code chips at 12.5px (`calc(var(--fs-xs) + .5px)`, `calc(var(--fs-m) - 1.5px)`, `12.5px`); the brand at 15px; palette rows at 34px; `--r-xl` duplicating `--r-l` (and 22 vs 20 when round); 120ms, 180ms and 240ms literals in every module. | `session.css .ss-code`, `bots.css .bt-code`, `shell.css .hx-answer code`, `.hx-brand__name`, `.hx-pal-row`, `tokens.css --r-xl` | 12px code; `--fs-brand: 15px` named once; palette rows `--row-h` + 4 or a named `--row-h-palette`; delete `--r-xl`; `--dur-out`, `--dur-slide` |
| F11 | drift | **Two breathing dots.** Bots: keyframes 1 → .35 → 1 on `--ease`, `--selected`, not alternate. Everyone else: `from {opacity: .35}` alternate on `--ease-io`, `--text`. | `bots.css .bt-run` | `.ui-dot--run` |
| F12 | drift | **Three tooltips** with different paddings, delays and kbd styles. | `shell.css .hx-tip` (canonical), `session.css .ss-tip`, `dock.css .dk-tip` | `HX.ui.tooltip` (the shell's behaviour, delegated, one element) |
| F13 | drift | **Three menus.** Account menu: inset `--line`, focus = `--current` fill. Session popovers: inset `--hair`, focus = inset ring. Card options: `--current` fill. Checked: a brass square in one, a brass check in the other. | `shell.css .hx-menu`, `session.css .ssp`, `cards.css .cd-opt` | `.ui-menu`: `--line`, focus = `--current` + inset ring, checked = brass check |
| F14 | drift | **Two composers.** Bots builds its own (`textarea`, chips 24px `--text-dim`, send disabled at .4) instead of the session one (`contenteditable`, chips 26px `--text-quiet`, .35), though session exposes `HX.composer.create` for reuse. | `bots.js` 647, `bots.css .bt-composer` | `HX.ui.composer` with the bots chip in the chips slot |
| F15 | drift | **Four switches and two segmented looks.** `.hx-switch` (input), `.dk-sw` (button `role="switch"`), `.ssr-switch`, `.bt-switch`; settings choices `.hx-choice` change fill without the sliding thumb every other segmented control has. | shell, dock, session, bots | `.ui-switch` (native checkbox `role="switch"`), `.ui-seg` |
| F16 | drift | **Three screen-reader-only utilities** (`.ss-sr` with `clip: rect()`, `.cd-sr`, `.dk-sr`). | session, cards, dock | `.ui-sr` |
| F17 | drift | **Icon grids and weights.** Shell 20-grid at 1.4–1.7, session 16-grid at 1.35, dock 14-grid at 1.5, bots 1.5: rendered strokes from 1.35 to 1.93px. | `index.html` sprite, `session.js ICONS`, `dock.js ICON`, `bots.js` | `HX.ui.icon`: one set, 1.5px non-scaling stroke |
| F18 | rule | **Bars where the system says dots and text.** The dock's context page draws a 6px segmented bar and its run page a 3px meter, against the brief ("dots, not a big bar") and the capacity rule (a running total in mono). | `dock.css .dk-segs`, `.dk-meter` | `HX.ui.measure` (grid or row) and `HX.ui.capacity` |
| F19 | rule | **Brass used as text** (the current rung's "after 2 fails", the dock's tag) is 4.04:1 in Bone. | `session.css .ssr-rung.now .ssr-when`, `dock.css .dk-tag` | Brass marks the station; the text is `--text-dim` |
| F20 | drift | **The blank's gap** is a fixed 56px in session and `min-width: 7ch` in cards. | `session.css .ss-gap`, `cards.css .cd-blank__gap` | 7ch (it scales with the font) |
| F21 | drift | **Popover and menu edges** use `--hair` in session and `--line` elsewhere. | `session.css .ssp` | `--line` |
| F22 | copy | **Middle-dot strings reach the screen.** `data.js` environment values ("bubblewrap · network off", "node 22.11 · python 3.12") render as written in the panel. Cards already split " · " into spaced parts. | `data.js environment`, `session.js` environment section | Split on " · " and set the parts apart with space, as cards do |
| F23 | rule | **Field focus offsets differ** (1px on the customizer's hex and JSON fields, 2px elsewhere). | `shell.css .hxt-hex:focus-visible`, `.hxt-json` | 2px everywhere |
| F24 | a11y | Card option rows show focus as a fill only (A7). | `cards.css .cd-opt:focus-visible` | **Resolved:** the menu item's inset ring |
| F26 | a11y | **Session rows are listbox options that contain buttons** (rename, archive): an option may not hold interactive children, so a screen reader hears neither properly. Bots rows are buttons with a class for current. | `session.js` ~869 (`role="option"`), `.ssl-acts` | Button rows with `aria-current`, actions as sibling buttons (`HX.ui.row({acts})`) |
| F27 | owner | **A double-click on a dock orb opens its dock card**, against the owner's decision (double-click opens the bot's chat, as Enter does). Single click (poke), Enter (chat), Space and the 420ms press (card) already match. | `dock.js` click handler, `case 'card'`: `e.detail === 2` falls through to `openCard()` | On `e.detail === 2` call `openBotInTab(id)`. Done in v8; superseded in v10 (a click opens the dock session, a double-click the full chat) |
| F29 | owner | **Nested corners are hand-picked.** Only the customizer swatch (`--r-s − 2px`) is concentric; a card at the top of the dock's wait views sits 14–16px under a 14px corner with its own 10px radius; the toast's button, the tooltip's key and the menu items each pick a step by hand; the slab path draws circular arcs. | `cards.css` (`hx-card` radius, `.cd-queue__peek`, `.cd-opt`), `dock.css` (wait views, `.dk-v-min`), `dock.js slabPath()`, `shell.css .hxt-swatch` | The nesting contract (section 8.2) and `HX.ui.shape.slab`; per module in MIGRATION.md §8 |
| F31 | owner | **The continuous corner never reached the owner.** `corner-shape` is Chromium-only; Tauri is WebKitGTK on Linux (the owner's platform) and WebKit on macOS, so every corner there was a circular arc, at the small fallback radii (cards 12, buttons 7). Measured in WebKitGTK 2.52: `CSS.supports('corner-shape', …)` is false. | `components.css` (the `:where(*)` corner-shape rule), `tokens.css` (the `@supports` scale) | **Resolved in the library:** `HX.ui.squircle` draws every corner as a path in every engine; the `@supports` scale goes (MIGRATION.md §0.8) |
| F32 | owner | **Inner radii collapsed to 5–6px**, e.g. a card at the top of the dock under a 22px corner with 16px of padding. Apple keeps inner radii generous and gives up padding. | `--r-floor` 5, cards' `--pad` 16, the dock's wait views | Floor 8; padding = R − floor where the arithmetic would go under it (MIGRATION.md §9) |
| F33 | owner | **In the claude.ai viewer the sidebar was gone, the orbs were small and the dock covered the composer** (1600×860 at 1.25x). One cause: the viewer mounts its iframe small and then grows it. The shell chose the sidebar once from the width at boot (closed under 640) and kept it; the dock fitted its orbs to the small row, and the live orbs kept the old size because only a move between slots re-read it; and the dock never re-sent its height on a resize, so `--hx-dock-space` stayed at the small value (54–60 for a 76px slab). | `shell.js` (`narrowAtBoot`), `dock.js` (`fitRow`, `onResize`, `emitDock`) | **Resolved:** the sidebar follows the width until the person sets it and is stored only then; `fitRow()` re-seats the live orbs; the reservation is measured (a ResizeObserver on the view) and sent whenever it changes, hover headroom included |
| F34 | owner | **Containers were clip-path'd**, so anything reaching past them (orbs, flags, popovers) would be cut: rows with orbs, bot rows, the orb sculptor's options, cards, minis. | `HX.ui.squircle` default mode | **Resolved:** clip is for leaf controls only; every other bound element is a frame (fill and line drawn by `::before` and `::after`, content unclipped) |
| F35 | owner | **Soft hairlines at fractional pixel ratios**: the drawn line was 1 CSS px wherever it fell, so at 1.25–1.75x it covered two device pixels at partial strength. | `HX.ui.squircle` path | **Resolved:** paths snap to device pixels and lines are whole device pixels (§8.1) |
| F36 | engine | **In WebKitGTK the session composer and column lost their place** (left at the sidebar's edge, the column full width) at every size: a registered `<length>` custom property used with a percentage fallback (`var(--hx-center-x, 50%)`, `var(--hx-col-w, min(…, calc(100% − 64px)))`) is invalid at computed-value time there, as the spec says, so `left` and `width` fell back to `auto`. Chromium ignores the mismatch, so it never showed in the artifact. | `session.css .ss-col, .ss-composer`, `bots.css`, `components.css .ui-toast` | **Resolved:** length fallbacks (`50vw`, `100vw`). Rule: a registered property's fallback matches its syntax |
| F30 | owner | **The dock session's send floats** in the box's bottom-right corner under a one-line field, and the dock and Bots composers have no way to talk to the bot. | `dock.js composerFor()` (`attach: false, mic: false`), `bots.js` composer | The library composer's compact layout and mic (done); the modules pass `bot` (MIGRATION.md §8) |
| F28 | contrast | **Inactive marks at 2.0–2.4:1.** Page dots, ladder stations to come and empty rings were `--text-faint` (or `--line-strong`), which is decoration-grade; as marks that carry position they need 3:1 (1.4.11). Fixed in the library with `--mark-off`. | `cards.css .cd-opt__ring`, `.cd-week i`; `dock.css .dk-tile-dot` (on the dock ground, already 3.3:1) | `--mark-off`; promote it to `tokens.css` and add its pairs to `theme.js PAIRS`. On/off marks that differ by colour alone (the context measure, the shell's stub rail) keep `--text-faint` off |
| F25 | taste | **Graphite and Typewriter set brass to a light grey** (`#d6d6d6`, `#e9e9e9`), so "you are here" is the same colour as text. Meaning survives through shape (rings, checks, thumbs), so it is not a failure. | `tokens.css` | **Resolved (Owner decision):** Graphite `#9db6cf` steel (9.4:1 on the frame), Typewriter `#7ea6e0` carbon-paper blue (7.9:1) |

## 17. Open questions

Things I could not settle without the owner; each has the default the system uses today.

1. ~~An accent for the monochrome presets~~ Settled by the owner: Graphite steel `#9db6cf`, Typewriter carbon-paper
   blue `#7ea6e0` (F25 resolved).
2. ~~Hold duration~~ Settled by the owner: 1 second everywhere.
3. **Field outlines.** `--line-field` makes text fields visibly bounded (WCAG 1.4.11). If the owner prefers the quieter
   look, the alternative that still passes is a fill change: fields on `--bg-3` raised with the 15% line; that only
   works on the frame, not inside cards.
4. **Bone's red text** `#a82328` is darker and less warm; a slightly warmer `#a52a2a` also passes (4.85 on a selected
   row). Owner's call.
5. **The composer's focus.** Shown as the field line, not the brass ring, because it holds focus most of the day.
6. **The palette and the dock** stay shell and dock singletons; only their parts are library components.
7. **Not tested:** real screen readers, Linux WebKitGTK (Tauri's renderer), Windows high contrast. The library needs
   `color-mix()`, `:has()` and registered custom properties, so a 2023 or later WebKitGTK; the card layer's
   `light-dark()` (removed by the migration) would need a 2024 one.

## 18. Appendix: Tailwind v4 and React

The React app keeps the CSS custom properties as the contract and maps them into Tailwind v4's theme, so utilities
follow every preset and override with no rebuild:

```css
@import "tailwindcss";
@import "./tokens.css";              /* the presets, scale and modifiers */
@import "./components.css";          /* the library: ui-* classes, library tokens, the dock ground */

@theme inline {
  --color-inset: var(--bg-0);   --color-frame: var(--bg-1);   --color-ground: var(--bg-2);
  --color-raised: var(--bg-3);  --color-pressed: var(--bg-4); --color-chip: var(--chip);
  --color-text: var(--text);    --color-strong: var(--text-strong); --color-dim: var(--text-dim);
  --color-quiet: var(--text-quiet); --color-faint: var(--text-faint);
  --color-icon: var(--icon);    --color-selected: var(--selected); --color-on-selected: var(--text-on-light);
  --color-accent: var(--brass); --color-attention: var(--red); --color-attention-text: var(--red-text);
  --color-hair: var(--hair);    --color-line: var(--line);    --color-line-strong: var(--line-strong);
  --color-line-field: var(--line-field); --color-hover: var(--hover); --color-current: var(--current);
  --color-dock: var(--dock-bg);
  --font-sans: var(--sans);     --font-mono: var(--mono);
  --text-2xs: var(--fs-2xs); --text-xs: var(--fs-xs); --text-sm: var(--fs-s);
  --text-base: var(--fs-m);  --text-lg: var(--fs-l);  --text-xl: var(--fs-xl);
  --radius-xs: var(--r-xs); --radius-sm: var(--r-s); --radius-md: var(--r-m); --radius-lg: var(--r-l);
  --radius-in: var(--r-in);                         /* rounded-in: a child in its container's corner (section 8.2) */
  --spacing: 4px;                                   /* p-1 = 4px … p-12 = 48px; the scale's steps are 1,2,3,4,6,8,12 */
  --shadow-pop: var(--shadow-pop); --shadow-tip: var(--shadow-tip);
  --ease-ui: var(--ease); --ease-settle: var(--spring);
}
```

- `tokens.json` is for tooling (Style Dictionary, a Figma sync, audits); the app does not need to read it at runtime.
  Each themed token holds its Card catalog value in `$value` and every preset in `$extensions.hypotaxis.modes`; the
  CSS variable it maps to is `$extensions.hypotaxis.css`.
- React components wrap the library's markup: the class names and ARIA contracts in section 14 are the API; the
  factories in `components.js` are the reference implementation. Keep the event names (`ui:change`, `ui:commit`,
  `ui:select`, `ui:send`) as callback props (`onChange`, `onCommit`, `onSelect`, `onSend`).
- Corners come from the library: `rounded-*` utilities set the radius, and a `useSquircle(ref)` hook (or the
  `data-sq` attribute, which `HX.ui.squircle` binds on its own) draws the continuous corner; `rounded-full` pieces need
  nothing. A nested surface is a component, not a utility chain: it sets
  `--r-outer` and `--pad` (a `<Nest radius pad>` wrapper or the `.ui-nest` class) and its corner children use
  `rounded-in`.
- Regenerate tokens after any change to `tokens.css`: `node design-system/build-tokens.mjs --report`.
