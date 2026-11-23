# Design system v7: the audit

Status: **proposal for the owner** (invariant 8). Nothing in the app changes until the owner picks the options in `DESIGN-SYSTEM.md` section 13. 23 November 2026.

This file maps everything in the v6 design system to its v7 target: every token (`tokens.css`), every rule (`RULES.md`, 220 IDs), every kit component (`apps/desktop/ui/src/components`, `docs/UI-COMPONENTS.md`), every lab check (`docs/UI-LAB.md`), and the v6 owner decisions. Each is marked **keep**, **change** (with the value), **add** or **remove**.

Sources: the owner's brief ("a complete refactor ... maintaining our character but cloning grokbot's style pretty hard, wherever possible"); Grok Bot's measured values (`grokbot-design/tokens.json`, Part A sections 2 and 4, the screens and the recordings); Part H (`08-CALM-UI-DESIGN-RULES.md`, an owner decision); `BOOPIS-MASTER.md`'s owner decisions; the calm pass's commit on `w31c/calm` (36219708); the approved notch spec (sections 2.1 and 12).

## 1. Summary

**The rule of the refactor.** Grok's style wins wherever boopis's v6 rules disagree, except for boopis's character, which stays:

| Stays (character) | Becomes Grok (style) |
|---|---|
| orb2's orbs: shapes, faces, states, the eyes that belong to the state, the reduced-motion rule | one neutral ink (#f5f5f5 / #1c1c1c) at alpha steps over near-black surfaces in tiny steps |
| the wordmark and the logo (`<boopis-logo>`, oval eyes, `currentColor`) | no shadows in dark: a 1 device px hairline and an inset specular line; real shadows in light |
| each bot's own colour, and the boopis bot in the theme's ink (owner decision 1) | pills for every control; Grok's radii (22 composer, 18 bubbles, 16 menus, 14 cards, 12 tiles) |
| boopis's vocabulary: bot, session, room, governed, Smart, "needs you", "hold to approve", the stamp wordings | a small tight scale (11 to 17, 22 and 26 for first run), 400 almost everywhere, hierarchy by alpha |
| the dock: pitch black, its slab, flares and springs (owner decisions) | ruthless density: bubbles of 560 in a 640 column, panels only on request (Part H) |
| hold to approve (1 s), forms as one card family, the provider marks, the mods' rules (owner decisions) | status in words and motion: the live mini orb and a shimmering phrase instead of chrome |
| accessibility floors (WCAG 2.2 AA): meta at 66%, fields at 3:1, a visible focus ring | fast, sharp motion: 100 ms popovers from scale(.98), 120 ms colour, 200 ms dialogs |
| the continuous corner and the concentric rule, at Grok's radii (recommended; board 02) | floating chrome instead of bars: no title bar, three floating pills (board 05) |

**What changes most.**
- **Colour.** The four presets (Card catalog, Graphite, Bone, Typewriter) and the colour customizer retire; v7 has a dark and a light theme from Grok's samples. Brass retires; the accent is one blue (board 09). Red keeps meaning "you owe something", in Grok's values (recommended; board 09).
- **Surfaces.** The frame / ground / raised / inset ladder becomes Grok's five surface steps. Cards stop being inset: they are elevated, like menus and dialogs. Bot messages get bubbles; your messages are 18% ink (solid ink in light).
- **Type.** One open family (Geist recommended, already bundled; board 01) on Grok's scale. Mono shrinks to code, numbers and keys; state words and model names become sans.
- **Shape.** Every control becomes a pill. The radius scale splits into Grok's named radii; the floor drops from 8 to 6; the dock and the notch keep 30 (`--r-slab`).
- **Chrome and layout.** No title bar; a 88 px rail of 54 px tiles; a 356 px details pane that pushes the work; Settings, Store and Keyboard as 900 px dialogs with a 220 px nav. The call-number margin goes: model, time and cost become a quiet line under a turn.
- **Calm.** Part H's closed component set is the kit. The calm pass's pieces (Row value and (i), empty Section, one-line EmptyState, StatusLine, danger zone, overflow, long-text editor) are folded in, with their four open choices on board 08.

**Counts.** Tokens: 26 keep, 81 change, 43 add, 14 remove. Rules: 127 keep, 91 change, 2 remove, and 34 added (30 from Part H, 4 from Grok's style). Components: section 5. Lab checks: section 6.

**How to read the marks.** keep = unchanged in meaning (values may follow the new tokens). change = the v7 rule or value is given. add = new in v7. remove = retired.

## 2. Tokens

Every custom property of `apps/desktop/ui/src/styles/tokens.css` (the same names as `design/v6/tokens.css`), grouped. Values are dark / light; the full set with sources is `tokens.v7.json`.

### Colour: surfaces

| v6 token | v7 | Target |
|---|---|---|
| `--bg-0` | **change** | well only: #171717 / #f7f7f7 (was inset for cards, fields, wells) |
| `--bg-1` | **change** | sidebar #0e0e0e / #f5f5f5 |
| `--bg-2` | **change** | chrome (the ground) #121212 / #fcfcfc |
| `--bg-3` | **change** | elevated #1f1f1f / #ffffff |
| `--bg-4` | **change** | elevated hover #2c2c2c / #f1f1f1 |
| `--chip` | **change** | ink 8% / 6% (was solid) |
| `--dock-bg` | **keep** | #000 in both (owner decision) |
| `--bg-pane` | **add** | #161616 / #ffffff: the details pane, large dialogs |

### Colour: text and icons

| v6 token | v7 | Target |
|---|---|---|
| `--text` | **change** | ink 100%: #f5f5f5 / #1c1c1c |
| `--text-strong` | **change** | ink 100% (an alias of --text in v7) |
| `--text-dim` | **change** | ink 66% / 68%: all readable secondary text and meta |
| `--text-quiet` | **change** | ink 54% / 56%: placeholders and labelling glyphs only |
| `--text-faint` | **change** | ink 38% / 40%: disabled |
| `--icon` | **change** | ink 90% |
| `--icon-quiet` | **change** | ink 54% / 56% |
| `--icon-off` | **change** | ink 30% |
| `--mark-off` | **change** | ink 38% / 42% (3:1 kept) |
| `--text-on-light` | **change** | #121212 / #fcfcfc (ink on the inverted primary) |
| `--ink` | **add** | #f5f5f5 / #1c1c1c: the one neutral |

### Colour: meaning

| v6 token | v7 | Target |
|---|---|---|
| `--brass` | **remove** | retired with the presets; --accent replaces it (board 09) |
| `--brass-base` | **remove** | retired |
| `--brass-soft` | **change** | --accent-soft: accent 7% |
| `--accent` | **change** | Grok blue #116dd2 / #1680f3 (board 09 A); v6 used it as a preset alias of brass |
| `--accent-text` | **add** | #4d9bff / #0b6dd3: links, banner text |
| `--on-accent` | **add** | #fff: knob and letter on the accent |
| `--red` | **change** | #cf2b35 (Grok danger) in both |
| `--red-text` | **change** | #ff6463 / #c4232f |
| `--red-soft` | **change** | red 7% |
| `--selected` | **change** | inverted ink #f5f5f5 / #1c1c1c |
| `--selected-hover` | **add** | #dbdbdb / #333333 |
| `--selected-off` | **add** | ink 13% |
| `--ok` | **change** | #0e9f5a |
| `--ok-text` | **add** | #00ba69 / #087a43 |
| `--warn` | **change** | #c8770c (was the customizer's warning only) |
| `--warn-text` | **add** | #e28600 / #b25e00 |
| `--add` | **change** | #00ba69 / #087a43 |
| `--del` | **change** | #ff6463 / #c4232f |
| `--focus` | **change** | #4d9bff / #0b6dd3 (was brass) |
| `--bubble-agent` | **add** | ink 4% (+ specular in dark) / ink 6% |
| `--bubble-user` | **add** | ink 18% / solid ink |
| `--bubble-user-text` | **add** | #f5f5f5 / #fcfcfc |
| `--find` | **add** | yellow 22% / 35%: find-in-chat |

### Colour: lines and fills (all ink at an alpha step)

| v6 token | v7 | Target |
|---|---|---|
| `--hair` | **change** | 4% / 8% |
| `--line` | **change** | 6% / 12% |
| `--line-strong` | **change** | 10% / 18% |
| `--line-field` | **change** | 38% / 42% (kept at 3:1) |
| `--hover` | **change** | 6% |
| `--current` | **change** | 8% |
| `--fill-2` | **add** | 4% / 6% |
| `--fill-4` | **add** | 2% |
| `--fill-active` | **add** | 20% |
| `--float-line` | **add** | 6% / almost none (light: the shadow is the edge) |
| `--composer-line` | **add** | 10% / 8% |
| `--spec` | **add** | white 3% dark only |
| `--spec-strong` | **add** | white 12% dark only |
| `--scrim` | **change** | black 70% / 50%, no blur |
| `--ink-on-dock` | **keep** | the dock ground's ink |
| `--ink-on-dock-strong` | **keep** | kept |
| `--disabled-alpha` | **keep** | kept |
| `--mask-solid` | **keep** | kept |

### Type

| v6 token | v7 | Target |
|---|---|---|
| `--sans` | **change** | Geist (board 01 A; B Inter, C Figtree), all SIL OFL 1.1 |
| `--mono` | **change** | Geist Mono |
| `--fs-2xs` | **change** | 11/16 |
| `--fs-xs` | **change** | 12/16 |
| `--fs-s` | **change** | 13/18 |
| `--fs-m` | **change** | 14/20 |
| `--fs-l` | **change** | 15/22 (was 16) |
| `--fs-xl` | **change** | 17/24 (was 20) |
| `--fs-2xl` | **add** | 22/28 |
| `--fs-3xl` | **add** | 26/32 |
| `--lh` | **remove** | replaced by a px line height per size (--lh-2xs to --lh-3xl) |
| `--lh-ui` | **remove** | as above |
| `--lh-tight` | **remove** | as above |
| `--lh-meta` | **remove** | as above |
| `--lh-small` | **remove** | as above |
| `--track` | **change** | +0.01em |
| `--track-s` | **add** | +0.015em at 13 |
| `--track-mono` | **change** | 0 |
| `--ui-case` | **remove** | retired with the Typewriter preset |

### Radius and nesting

| v6 token | v7 | Target |
|---|---|---|
| `--r-xs` | **change** | 4 (kbd, inline code) |
| `--r-s` | **change** | split: --r-field 10, --r-nav 8, --r-tip 6 |
| `--r-m` | **change** | split: --r-bubble 18, --r-menu 16, --r-card 14, --r-composer 22 |
| `--r-l` | **change** | split: --r-dialog 20 (form), --r-card 14 (large dialogs), --r-slab 30 (dock and notch only) |
| `--r-pill` | **keep** | 9999, now every control |
| `--r-floor` | **change** | 6 |
| `--corner-smoothing` | **keep** | 0.6 (board 02 B); 0 under A |
| `--r-tile` | **add** | 12 |
| `--r-in-*` | **change** | recomputed from the new radii and pads: menu 10, palette 8, composer 14 (a circle), dialog 10, card 6, bubble 10, dock 18 |
| `--pad-menu` | **change** | 6 |
| `--pad-palette` | **change** | 6 |
| `--composer-pad` | **change** | 8 |
| `--pad-dialog` | **change** | 10 |
| `--pad-card` | **change** | 8 |
| `--pad-seg` | **change** | 2 |
| `--pad-dock` | **keep** | 12 |
| `--pad-row` | **change** | 6 8 |
| `--pad-pop` | **change** | 6 |
| `--pad-tip` | **change** | 4 6 |
| `--pad-toast` | **change** | 0 8 0 14 |
| `--pad-bubble` | **add** | 8 |
| `--pad-tile` | **add** | 9 |

### Space, size and layout

| v6 token | v7 | Target |
|---|---|---|
| `--sp-1 to --sp-7` | **keep** | 4, 8, 12, 16, 24, 32, 48 |
| `--row-h` | **change** | 32 |
| `--row-h-2` | **change** | 54 |
| `--ctl` | **change** | 36 |
| `--ctl-s` | **keep** | 28 |
| `--ctl-card` | **add** | 32 |
| `--hit-min` | **change** | 28 |
| `--chrome-h` | **remove** | no bar: --drag-h 56 and --chrome-y 10 (board 05 A) |
| `--sb-w` | **change** | resizable 88 to 400 |
| `--sb-rail-w` | **change** | 88 (board 06 A) |
| `--right-w` | **change** | 356 |
| `--right-rail-w` | **remove** | the closed panel's 28px strip goes (panels on request, R-calm-12) |
| `--col-w` | **change** | 640 |
| `--margin-w` | **remove** | the call-number margin goes |
| `--measure` | **change** | --bubble-max 560 |
| `--composer-w` | **change** | min(720, column + 80) |
| `--composer-gap` | **keep** | 16 |
| `--gutter` | **keep** | 16 |
| `--dock-rest-h` | **keep** | 72 |
| `--float-gap` | **keep** | 8 |
| `--float-margin` | **keep** | 8 |
| `--composer-h` | **add** | 44 |
| `--pill-h` | **add** | 40 |
| `--dialog-l` | **add** | 900 |
| `--dialog-form` | **add** | 460 |
| `--palette-w` | **add** | 640 |
| `--set-nav-w` | **add** | 220 |
| `--ic-xl to --ic-2xs` | **change** | 18 (floating buttons), 16 (rows, menus, composer), 14, 12, 10 |
| `--ic-gap` | **keep** | 8 |
| `--ic-gap-tight` | **keep** | 6 |
| `--scroll-*` | **keep** | unchanged (thumb colour from --bg-4) |
| `--scroll-fade` | **keep** | 16 |

### Elevation

| v6 token | v7 | Target |
|---|---|---|
| `--shadow-pop` | **change** | none / 0 10 20 -3 10%, 0 4 6 -4 10%, 0 0 0 1px 1% |
| `--shadow-tip` | **remove** | --shadow-pop serves tooltips too |
| `--shadow-side` | **remove** | the pane pushes the work; overlaying under 900 it takes --shadow-modal |
| `--shadow-side-r` | **remove** | as above |
| `--shadow-inline` | **add** | none / 0 4 12 -1 8%, 0 2 4 -2 6% |
| `--shadow-modal` | **add** | none / 0 20 32 -5 10%, 0 8 12 -6 10% |
| `--shadow-window` | **add** | none / 0 22 70 4 56% |
| `--shadow-composer` | **add** | both themes |
| `--hl` | **add** | one device pixel |
| `--elev-0 to --elev-4` | **change** | values above |
| `--z-*` | **keep** | unchanged |
| `--focus-w` | **keep** | 2 |
| `--focus-offset` | **keep** | 2 |

### Motion

| v6 token | v7 | Target |
|---|---|---|
| `--ease` | **change** | --ease-sharp cubic-bezier(.165,.84,.44,1) |
| `--spring` | **keep** | cubic-bezier(.22,1,.36,1) |
| `--ease-io` | **change** | ease-in-out |
| `--ease-drawer` | **add** | cubic-bezier(.32,.72,0,1) |
| `--ease-out` | **add** | ease-out |
| `--dur-press` | **change** | 50 |
| `--dur-1` | **change** | 120 |
| `--dur-out` | **change** | 100 |
| `--dur-2` | **keep** | 200 (dialogs) |
| `--dur-pop` | **add** | 100 (menus, popovers, tooltips) |
| `--dur-slide` | **change** | 200 |
| `--dur-3` | **keep** | 300 |
| `--dur-hold` | **keep** | 1000 (owner decision) |
| `--dur-breathe` | **change** | 1.4s |
| `--dur-dot` | **add** | 130 |
| `--dur-shimmer` | **add** | 2.2s |
| `--dur-hold-phrase` | **add** | 800 |
| `--load-delay` | **change** | 150 |

## 3. Rules

All 220 rules of `design/v6/design-system/RULES.md`, in its order. "keep" means the rule holds as written (its values may follow the new tokens); "change" gives the v7 rule; "remove" retires it. The 30 Part H rules (R-calm, R-comp, R-flow) and four new v7 rules are added in section 4.

### R-copy

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-copy-1 | Interface text is in sentence case and the brand is lowercase (boopis); content keeps its own case; the Typewriter preset lowers interface labels… | **keep** | Sentence case and lowercase brand stay. `--ui-case` and the lowercase setting go with the Typewriter preset (R-theme), so the rule loses its last clause. |
| R-copy-2 | A button is a verb and its object (a bare verb where the card names the object) | **keep** | Verb and object. Grok's own labels pass ("Add rule", "Connect"). |
| R-copy-3 | State words come from the one vocabulary of section 13, lowercase mono; stamps have three wordings only | **change** | The vocabulary stays word for word (working, thinking, replying, needs you, asleep, failed...). The style changes: sans 12/13 at --text-dim (Grok's status words), sentence case where the word stands alone as a row's subtitle ("Needs you: approve a deploy"). Mono is no longer the costume of a state word. The three stamp wordings stay. |
| R-copy-4 | Banned in interface copy: all caps, middle-dot meta strings, em dashes, exclamation marks, arrows after links, "please", jokes, filler adjectives | **keep** | Bans stay (no middle dots, em dashes, exclamation marks). Grok uses "Bot's computer · Asleep"; boopis does not. |
| R-copy-5 | Numbers carry their unit, sit in mono with tabular figures, and use a true minus (U+2212) for negatives and removed counts | **keep** | Units, mono tabular figures and a true minus stay. Mono is now reserved for exactly these. |
| R-copy-6 | An error names the problem and the way out | **keep** | Problem and way out; "unknown" as a value (R-calm-5). |
| R-copy-7 | A tooltip repeats the control's accessible name, then its keys; nothing lives only in a tooltip | **keep** | Tooltip = accessible name + keys (Grok does the same: "Click or hold Ctrl D to dictate"). |
| R-copy-8 | boopis presents itself as its own product (owner decision, 19 November 2026; its row is added with the branding work): user-facing text never says… | **keep** | The engine stays invisible. |
| R-copy-9 | A raw engine error never reaches the interface: no stack traces, error codes, JSON or messages written for developers | **keep** | No raw engine errors. |

### R-colour

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-colour-1 | Tokens only: no literal colour in a stylesheet, an inline style or a canvas outside `tokens.css` | **keep** | Tokens only. The data colours stay: orb colours, provider marks in the model menu, mod swatches, item marks. |
| R-colour-2 | The stamp rule: `--red` and `--red-text` appear only on what the user owes (stamp, attention dot and flag, the blank's underline, a red trail in the… | **change** | Board 09, attention. Recommended B: red still means "you owe" (stamp, dot, "you" capsule, the notch's edge) with Grok's values (#cf2b35 marks, #ff6463 / #c4232f text); red also becomes the fill of a destructive confirm in a dialog (Grok's Reset). A: Grok's amber for needs-you. |
| R-colour-3 | The you-are-here rule: `--brass` marks position and choice (focus ring, current dot, active rung, check, pressed glyph, caret, the selected option… | **change** | Brass retires (board 09, accent). Recommended A: one accent, Grok blue, as a fill for the switch, the chosen option and progress, and as --accent-text for links (6.6:1 dark, 5.1:1 light); the focus ring takes --focus. "You are here" in a list becomes the --current fill (8% ink), as Grok. |
| R-colour-4 | The layering rule: what the user wrote is raised (`--bg-3`), what the system set into the work is inset (`--bg-0`); the frame holds, the ground… | **change** | Replaced. The layering is Grok's: sidebar #0e0e0e < chrome #121212 < pane #161616 < elevated #1f1f1f < elevated-hover #2c2c2c. What the user wrote is a bubble (18% ink, solid ink in light); cards, menus, dialogs and the composer are elevated; inset survives only for wells (code, diffs, terminal). |
| R-colour-5 | Colour is never the only cue: every red mark has a word, every brass mark has a shape | **keep** | Colour is never the only cue; Grok gap 2 (colour-only badges) is the warning. Needs-you keeps its words and the orb's needs face. |
| R-colour-6 | Every pair in 5.4 holds in all four presets and on the dock ground; a new pair a component creates is added to the table and to `theme.js PAIRS` | **change** | The pairs table is rebuilt for two themes (dark and light) plus the dock, from tokens.v7.json; floors unchanged (4.5 text, 3 marks). Readable meta moves to --text-dim (66% / 68%), because Grok's tertiary (54% / 56%) is 3.7:1 in light. |
| R-colour-7 | A tint is `color-mix()` of a solid role; a theme chooses only solids, so every line and fill follows an override | **change** | Every tint is now the one ink at an alpha step (Grok's model) instead of color-mix of --text; same idea, fixed steps: 2, 4, 6, 8, 10, 20, 38, 54, 66 and 90%. |
| R-colour-8 | An orb's colour belongs to the orb and never becomes interface colour | **keep** | An orb's colour stays the orb's. Two named uses join the card ring: a bot's name above its bubble and its @mention chip take the bot's colour (Grok 9.3), and the boopis bot is the theme's ink (owner decision 1). |

### R-theme

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-theme-1 | A new colour token is derived from a solid role (preferred), or defined in all four presets; the build (`build-tokens.mjs`) reads each preset's… | **change** | Two modes (dark, light) instead of four presets; a token missing from one mode is a bug. |
| R-theme-2 | `--dock-bg` is `#000` in every theme and is offered nowhere (owner decision) | **keep** | The dock is #000 in both themes and never offered (owner decision). |
| R-theme-3 | The only geometry the user moves is corners and density; every size that follows them reads its token (`--r-*`, `--r-in-*`, `--row-h`, `--ctl`), so… | **change** | Density stays (regular is Grok's: rows 32, controls 36/28, tiles 54). The corners setting goes: one radius scale, Grok's. |
| R-theme-4 | `data-hx-theme="light"` is used only for what tokens cannot express; today that is `--ink-on-dock`, `--ink-on-dock-strong`, `--line-field` and the… | **change** | data-hx-theme="light" becomes data-theme="light", one of two modes; same restraint. |
| R-theme-5 | A colour cached in JavaScript (a canvas, an orb attribute, the hold's fill) is read again on `hx:theme` | **change** | Kept, and it now also covers the orbs' eye colour (cut-out eyes, board 04) and the boopis bot's ink. |
| R-theme-6 | A token that reads a role the dock ground re-derives is declared again on `[data-ground="dock"]`, because a custom property resolves where it is… | **keep** | The dock ground re-derives the roles from #000. |

### R-type

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-type-1 | Two families: `--sans` for interface and prose, `--mono` for code, paths, numbers, times, costs, model names, call numbers, state words, kbd and… | **change** | Two families stay, roles narrow: --sans for everything a person reads, including state words, model names and call numbers; --mono only for code, paths, numbers that line up, keys. |
| R-type-2 | Six sizes, only through `--fs-*` (11, 12, 13, 14, 16, 20) | **change** | Eight sizes, Grok's: 11/16, 12/16, 13/18, 14/20, 15/22, 17/24, 22/28, 26/32 (--fs-2xs to --fs-3xl). 16 and 20 retire; the larger two are first-run only. |
| R-type-3 | Three weights, by role: 600 only for titles (display, title, card title, panel and dialog titles); 500 for buttons, tabs and segmented options,… | **change** | Weights by Grok: 400 nearly everywhere (buttons, tabs, chips and labels too, which were 500), 500 page titles and the title pill, 600 dialog titles and a question card's question. |
| R-type-4 | Line heights by role, through tokens: `--lh` 1.6 reading text and multi-line fields; `--lh-ui` 1.35 interface; `--lh-tight` 1.2 titles; `--lh-meta`… | **change** | Line heights in px on a 4px grid, one per size (16, 16, 18, 20, 22, 24, 28, 32); prose 22 at 15. |
| R-type-5 | Case through `text-transform: var(--ui-case)` on interface labels only | **change** | Kept for sentence case; `--ui-case` retires with the Typewriter preset. |
| R-type-6 | Every mono number that can change or line up uses `font-variant-numeric: tabular-nums` (`.ui-mono`) | **keep** | Tabular figures on every mono number. |
| R-type-7 | Code is 12 (`--fs-xs`) in chips and 11 (`--fs-2xs`) at 1.6 in wells, diffs and terminal output; never 12.5 or 13 (F10) | **change** | Code 13 inline in a bubble (beside 15 text), 12 in wells and diffs. |
| R-type-8 | Tracking 0 for sans, `--track-mono` (−0.01em) for mono, 0 inside a key chip | **change** | Tracking +0.01em on sans (+0.015em at 13), 0 on mono and in key chips. |
| R-type-9 | Prose and card titles wrap with `text-wrap: pretty`, headings with `balance`; overflow by kind is 7.1 | **keep** | pretty and balance. |
| R-type-10 | Prose stops at `--measure` (608); notes and hints at 42ch (settings), empty states at 46ch | **change** | The measure is the bubble: 560 max (Grok); the session column 640. The 42ch settings hint is gone (R-calm-2: a hint is one line of 60 characters). |
| R-type-11 | Text in a fixed-height control is centred by its box (flex centring and a line height of 1), never nudged with padding or a transform | **keep** | Text centred by its box. |
| R-type-12 | Hierarchy is weight and colour before size: inside one surface one title, then the text roles step down (`--text-strong`, `--text`, `--text-dim`,… | **change** | Inverted: hierarchy by alpha before weight (Grok principle 4): --text, then --text-dim, then --text-quiet; a larger size is only ever a title. |

### R-space

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-space-1 | Gaps and padding come from `--sp-*` (4, 8, 12, 16, 24, 32, 48) or the named exceptions of R-space-2 | **keep** | The 4px scale stays (4, 8, 12, 16, 24, 32, 48) plus 2. |
| R-space-2 | The named exceptions, all component internals, from the library: card padding 14 16; request card 10 14; the composer's text 12 14 4 and its inset 6… | **change** | The named exceptions become Grok's: bubble 7 12; menu row 6 8 with inset 6; button 0 16 (36) and 0 14 (32 in cards); chip 0 14; settings rows 16 across; nav row 7 9; tooltip 4 6; palette row inset 8; title pill 7.5 13.5 7.5 7.5. |
| R-space-3 | Siblings are spaced by `gap` on their parent, never by margins on the children; a margin only separates a group from the next (`.ui-group +… | **keep** | gap, not margins. |
| R-space-4 | Density moves only `--row-h`, `--row-h-2`, `--ctl` and `--ctl-s`; nothing else changes with it | **keep** | Density moves only the four sizes. |
| R-space-5 | Every control's height is one of `--ctl`, `--ctl-s`, `--row-h`, `--row-h-2`, or a named fixed height: chip `--ctl-s` − 2, option chip `--ctl` − 4,… | **change** | Heights: --ctl 36, --ctl-card 32, --ctl-s 28, --row-h 32, --row-h-2 54, composer 44, title pill 40, chip 28, key chip 20, switch 20. |

### R-layout

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-layout-1 | Window breakpoints are 560 (the call-number margin collapses), 640, 900 and 1200 (both sidebars push; mod panes become tabs) | **keep** | Breakpoints 560, 640, 900, 1200; the 560 call-number collapse goes with the margin. |
| R-layout-2 | Widths that follow the window come only from the layout tokens (`--sb-w`, `--right-w`, `--col-w`, `--measure`, `--composer-w`) and the clamps above;… | **change** | Layout tokens: --sb-rail-w 88, --sb-w resizable 88 to 400, --right-w 356, --bubble-max 560, --col-w 640, --composer-w. |
| R-layout-3 | The column, the composer and the dock ride the shell's centre line (`--hx-center-x` and friends); nothing computes its own centre | **keep** | The centre line. |
| R-layout-4 | Distances from the window edge: the work keeps `--gutter` (16); floating surfaces `--float-margin` (8); side dialogs and sheets 12 | **change** | Floating chrome sits at --chrome-y 10 from the top; work keeps 16; floating surfaces 8. |
| R-layout-5 | A scroller that runs under the composer or the dock pads its end by their height (`--hx-dock-space` plus the composer) and sets the same… | **keep** | Scroll padding past the composer and dock. |
| R-layout-6 | Large windows have no app-wide maximum width; the extra width becomes margin around the work | **keep** | No app maximum width; the column stays narrow (Grok's 560 in an 1800 window). |

### R-overflow

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-overflow-1 | A one-line label (a row's title, a tab, a chip, a button, a menu label, the command field, a mini card) ends with an ellipsis and never wraps:… | **keep** | Ellipsis. |
| R-overflow-2 | Descriptions clamp: two lines in lists and sheets (a bot's description), three in a card's quote | **change** | One line, ellipsized, in lists (R-calm-7); two only in a card's quote. |
| R-overflow-3 | Prose, titles and messages wrap; paths, code and output wrap anywhere inside wells (`overflow-wrap: anywhere`); a code chip clones its background on… | **keep** | Wrapping by kind. |
| R-overflow-4 | Nothing scrolls sideways except code, diffs, terminal output, tables wider than their box (14.37) and tab strips | **keep** | No sideways scroll. |

### R-scroll

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-scroll-1 | Scrollbars are drawn with `::-webkit-scrollbar` and its pseudo-elements, from the scrollbar tokens, and nothing in the app sets `scrollbar-width` or… | **keep** | ::-webkit-scrollbar everywhere. |
| R-scroll-2 | Geometry: the bar's box is `--scroll-size` 10px; the thumb a capsule `--scroll-thumb` 4px wide, centred, 6px (`--scroll-thumb-active`) while hovered… | **keep** | Geometry unchanged. |
| R-scroll-3 | The thumb is `--scroll-thumb-color` (`--bg-4`, the mock-up's) at rest and `--scroll-thumb-color-active` (`--mark-off`, 3:1 like every non-text mark)… | **change** | Thumb --bg-4 (#2c2c2c) at rest, --mark-off active. |
| R-scroll-4 | Bars are inset, never overlay: none of the three engines gives a styled overlay bar, so the bar takes its 10px at the scroller's end | **keep** | Stable gutters. |
| R-scroll-5 | Where a scroller's end meets a curved corner of its container (a dialog body's foot, a menu, a popover, the palette list, a sheet), the track is… | **keep** | Track inset at curved corners. |
| R-scroll-6 | Scrollbars appear only in the named scrollers: the conversation, the sidebar lists, the right panel's body, a dialog's or sheet's body (never the… | **keep** | Named scrollers. |
| R-scroll-7 | A horizontal scroller is only code, a diff, terminal output, a wide table or a tab strip | **keep** | Horizontal only for code and tabs. |
| R-scroll-8 | Every inner scroller sets `overscroll-behavior: contain` | **keep** | overscroll contain. |
| R-scroll-9 | A scroller never cuts its content with a straight edge: where more lies beyond an edge, the content fades out over `--scroll-fade` (16px); none at… | **keep** | Edge fades (owner decision). |

### R-corner

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-corner-1 | Radii come only from `--r-*`, `--r-outer`, `--r-in` or `--r-in-*`; the only literal is 0 | **keep** | Radii only from tokens. |
| R-corner-2 | The radius by kind of element | **change** | The radius by kind is Grok's (board 02): pill for every control, composer 22, bubble 18, form dialog 20, menu 16, card / large dialog / palette 14, tile 12, field / menu row / toast 10, nav row 8, tooltip 6, kbd 4; --r-slab 30 for the dock and the notch only. |
| R-corner-3 | Nested corners fit (owner decision): a piece within its container's radius of a corner takes `max(--r-floor, R − gap)`, through the container's… | **change** | Kept, with the floor at 6 (Grok's smallest nested radius). Grok's numbers are already concentric, so the rule needs no exceptions. |
| R-corner-4 | A piece in a corner sits inside it: inset by the container's `--pad` from both edges, it never touches or crosses the container's edge or its curve | **keep** | Inside the corner. |
| R-corner-5 | The edge band shares the corner: every piece on the same band as a corner piece (the same inset from that edge, for example a dialog head's tabs… | **keep** | The band shares the corner. |
| R-corner-6 | Every corner is the drawn continuous corner (`HX.ui.squircle`, smoothing 0.6); no `corner-shape` anywhere; only leaf controls are clipped, a… | **change** | Board 02. Recommended B: the continuous corner (smoothing 0.6) stays at Grok's radii. Under A, smoothing 0: Grok's plain arc, and the squircle machinery could retire. |
| R-corner-7 | Nothing paints a rectangle behind a rounded surface: the `<dialog>` element, wrappers and a scroller the same size as a rounded surface have no… | **keep** | Nothing behind a rounded surface. |
| R-corner-8 | A piece flush with its container's edge (a card's foot, a queue's peek, a body's focus ring at a dialog's foot) takes the container's radius on the… | **keep** | Flush pieces. |
| R-corner-9 | A piece whose inner radius would reach half its height is a capsule (`--r-pill`), drawn natively; a round piece in a pill stays a pill | **keep** | Capsules native. |

### R-line

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-line-1 | The outline of a rounded thing is drawn inset (an inset 1px `box-shadow`, or `--sq-line` once bound), never a `border`, which does not follow the… | **keep** | Inset outlines. |
| R-line-2 | Which line | **change** | Which line: --line (6%) outlines every elevated thing in dark; --float-line in light is nearly nothing, because the shadow draws the edge (board 03); --line-strong (10%) hovered and the composer; --hair (4%) the agent bubble's ring and group dividers; --line-field (38%) text fields (kept at 3:1). |
| R-line-3 | A line is one device pixel at rest (the squircle snaps, a native border snaps itself); 2px only for focus rings; dotted only under a blank; dashed… | **keep** | One device pixel; 2px focus only. |
| R-line-4 | A head or foot rule spans its surface edge to edge; a divider between items stops at the content inset (settings rows inside the body's 20, menu… | **keep** | Divider insets. |
| R-line-5 | No double lines: a divider never meets an outline or another divider | **keep** | No double lines. |

### R-elev

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-elev-1 | Depth is tone | **change** | Dark: no shadows at all, depth is surface steps, a hairline and an inset specular line (Grok). Light: shadows on everything that floats and on settings cards (board 03). |
| R-elev-2 | Five levels, each with its shadow token and its layer | **change** | Five levels kept, values replaced: --shadow-inline, --shadow-pop, --shadow-modal, --shadow-window in light; none in dark; --shadow-composer in both. |
| R-elev-3 | One shadow per surface, never coloured, never a glow, never a hard offset; a surface inside a floating one (a menu item, a card in a popover) has none | **change** | Grok's light shadows are multi-layer (two blurs and a 1px ring); one shadow token per surface still. |
| R-elev-4 | A floating surface is opaque: the frame colour with `--line` (menus, popovers, the palette, dialogs) or raised with `--hair` (tooltips, toasts) | **change** | Floating surfaces are --bg-3 (elevated) in both themes; large dialogs --bg-pane with --bg-3 cards inside. Never blurred. |
| R-elev-5 | `z-index` comes from `--z-*` | **keep** | z from tokens. |
| R-elev-6 | A modal dialog uses the top layer (`showModal`), above every `--z-*`; every layer opened from inside it (a menu, a popover, the tooltip) mounts… | **keep** | Modal top layer. |
| R-elev-7 | One floating layer is open at a time; a tooltip may show over it; opening another closes the first | **keep** | One floating layer. |
| R-elev-8 | One scrim at a time, only behind the palette, a modal dialog or an overlaying sidebar or panel | **change** | Scrim is Grok's: 70% black dark, 50% light, no blur. |

### R-stack

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-stack-1 | Each surface holds only the tones of the ladder (frame, ground, inset card, raised, floating); never inset on inset, never raised on raised | **change** | The tone ladder is Grok's surface steps (R-colour-4). |
| R-stack-2 | A card never holds a card: what a card holds is a well, a mini row, an option row, a field or a quote | **keep** | A card never holds a card. |
| R-stack-3 | Cards in a queue stack: the front card, then at most two peeks of their foot, 7px lower each, inset 12 and 24, at .9 and .55, no shadow | **keep** | Queue peeks (owner's card motion). |
| R-stack-4 | A mini card behaves as a row (`--hover`, `--current`, one 30px line); a full card is never clickable as a whole: its actions are its buttons | **keep** | Minis behave as rows. |
| R-stack-5 | A sheet sits beside the work (flush to the right edge under the title bar, a concave corner where it meets the frame); a dialog floats over a scrim;… | **change** | The right panel is a pane that pushes the work (Grok details panel, 356, --bg-pane, no concave corner); dialogs float over the scrim; sheets inside a view become the pane or a focused view (R-calm-9). |

### R-icon

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-icon-1 | One set, `HX.ui.icon(name)` | **keep** | One set; the set gains info (the calm pass) and, proposed, waveform, arrow-up, terminal, store, user, shield, plug, keyboard, palette, bell, share, grid (drawn in the boards on the same grid and stroke). |
| R-icon-2 | One rendered stroke: 1.5px, round caps and joins, `vector-effect: non-scaling-stroke`, `currentColor` | **keep** | One 1.5 stroke, round caps. |
| R-icon-3 | Six sizes, as tokens, and no other | **change** | Sizes: 16 in rows, menus, buttons and the 28px composer buttons; 18 in 36px floating buttons; 12 chevrons. |
| R-icon-4 | An icon's size follows the text beside it, never the control's height alone: 16 beside 13 or 14, 15 beside 12 in chips and 13 in menus, 14 beside 12,… | **keep** | Icon follows its text. |
| R-icon-5 | Icon to label: `--ic-gap` (8) in buttons, menu items and rows; `--ic-gap-tight` (6) in capsules and controls of 26px and under (chips, files,… | **change** | Icon to label 8 in menus and nav (Grok 6 in menus: 8 kept), 6 in chips. |
| R-icon-6 | Alignment: an icon is centred in a square box of its own size; optical corrections are drawn into the glyph, never added per use (no margins or… | **keep** | Alignment. |
| R-icon-7 | Colour: `--icon` at rest, `--text-strong` on hover, `--icon-off` disabled, `--brass` pressed or checked, `--icon-quiet` for window controls | **change** | Colour: --icon (90%) at rest, --icon-quiet (54%) for window and composer glyphs, accent when checked. |
| R-icon-8 | When to use one: an icon alone only in an icon button, always with its tooltip and accessible name; in a text button only when the glyph is the… | **change** | Menus get glyphs on every item (Grok's menus all carry one); text rows still have none. |
| R-icon-9 | Chevrons: `chevron` (right) rotates 90° to open a disclosure; `chevron-down` marks a picker (a select, the model chip) and never rotates | **keep** | Chevrons. |
| R-icon-10 | Every icon is `aria-hidden`; its control carries the name | **keep** | aria-hidden. |

### R-motion

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-motion-1 | Durations and curves come only from the tokens; the only literal is the reduced-motion 1ms | **keep** | Tokens only. |
| R-motion-2 | What moves: `transform`, `translate`, `opacity`, colour, `clip-path` | **keep** | transform and opacity. |
| R-motion-3 | No curve passes its mark: every cubic-bezier keeps its y values within 0 to 1, every spring is critically damped | **keep** | No overshoot; Grok's curves pass (--ease-sharp, --spring, --ease-drawer). |
| R-motion-4 | Timing by kind: hover in `--dur-1`, out `--dur-out`; press `--dur-press`; a thumb or page indicator `--dur-slide`; an entrance (menu, popover, toast,… | **change** | Timing by Grok: hover and colour 120 ease-out; press 50 (transform) and 100 (colour); menus, popovers, tooltips 100 from scale(.98) on --ease-sharp; dialogs 200; sidebar and tiles 200 on --spring; panes on --ease-drawer; status dots 130; card height and composer growth 300. |
| R-motion-5 | Motion runs at the display's rate (120 Hz and up): it is driven by time, never by frame counts; it composites (transform and opacity); a spring with… | **keep** | Compositor first; measured in WebKitGTK. |
| R-motion-6 | Reduced motion: the durations become 1ms (the tokens do it), loops stop, travel and drops go, thumbs jump, colour and opacity still answer; orbs… | **change** | Reduced motion also stops the shimmer and the working pulse. |
| R-motion-7 | The only loops: the running dot, the travelling dot of indeterminate progress, an orb's idle life, and a live logo on its own screen | **change** | The loops: the working pulse (1.4s), the status shimmer (2.2s, board 08 C), an orb's life, a live logo. |
| R-motion-8 | Focus rings never animate; no page-load choreography, no scroll reveals; an entrance only for something that just appeared because the state changed | **keep** | No page choreography. |

### R-orb

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-orb-1 | Eyes follow the state only: a bot's look is its name, colour and shape | **keep** | Eyes belong to the state (owner decision). The eye colour is not a look: under board 04 B it follows the surface. |
| R-orb-2 | Orb sizes come only from the table above (10, 16, 20, 24, 26, 40, 120) | **change** | Sizes 10, 16, 20, 24, 28, 36, 40, 64, 96 (26 and 120 retire; 36 the rail tile and sidebar rows, 64 the details header, 96 the new-bot preview). |
| R-orb-3 | A bot always shows orb, name, role, schedule and state word, in that order, in the same places; in a list the orb centres on x = 28 | **change** | The furniture stays (orb, name, role, schedule, state word) but at rest a row shows orb, name and one activity line (Grok's sidebar); role and schedule move to the details pane (R-calm-11 "look"). |
| R-orb-4 | Motion by size: `static` at 16 and under (or `still` picker tiles to 28), calm above, lively only in the bot's header; reduced motion reduces and… | **change** | Motion by size: static at 16 and under except the activity line's orb, which is live while it works (Grok); calm above; lively in the details header. |
| R-orb-5 | An orb is never clipped: its container is a frame (8.1), and its attention flag (8px with a 2px ring of the surface) has room outside the orb's box | **keep** | Never clipped; its flag gets a 2.5px ring of the surface (Grok's badge). |
| R-orb-6 | An orb is not a control except in the dock; it is `aria-hidden` and its row or button carries the name | **keep** | Not a control except in the dock. |
| R-orb-7 | A dark body (luminance under .05) gets light eyes, `--ink-on-dock` | **change** | Under board 04 B the dark-body rule generalises: the eyes are the surface. |

### R-seg

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-seg-1 | Two to four options of equal width (the track is a grid of equal columns); more, or labels of very different length, become a select (14.32) | **keep** | Two to four options. |
| R-seg-2 | The track is `--bg-0` with `--hair`, inset 3 (`--pad-seg`), radius `--r-s`; the thumb and the options take `--r-in-seg` (9); the thumb slides by… | **change** | Track a pill at --fill-2, inset 2; the thumb a pill: --current in dark, a white raised pill in light (Grok's Activity \| Library). |
| R-seg-3 | A segmented control on a container's edge band takes the band's radius for its track (`--r-outer: var(--r-in-dialog)` in a dialog head), and its… | **keep** | On a band, the band's radius (a pill anyway). |

### R-tab

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-tab-1 | Three tab looks, one per place, and nothing else is a tab: the segmented pill (view switches such as Session | **change** | Two looks: the segmented pill (view switches) and the settings nav (Grok's 220 left nav, rows 32, radius 8, --current when active). Dialog-head tabs retire. |
| R-tab-2 | Tabs never wrap | **keep** | Tabs never wrap. |
| R-tab-3 | One tab stop; arrows move and select (Up and Down when vertical), Home and End; `aria-selected`; an attention dot beside an unselected label, and ",… | **keep** | Keyboard. |

### R-row

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-row-1 | A row is `--row-h`, inset 8 in its list, radius `--r-s`; its lead column is 16 wide and centred on x = 28; its label starts at x = 44; its end slot… | **change** | Rows: 32 (menus, nav, sessions) or 54 (bots, groups: a 36 orb, name 14, activity 13 at --text-dim, gap 10), radius 10 or 12. The x = 28 / x = 44 axes go with the 56px rail. |
| R-row-2 | States: hover `--hover`; current `--current` with `--text-strong` and `aria-current`; archived: quiet and struck through with `--line-strong`;… | **change** | Hover 6%, current 8% (Grok); archived as before. |
| R-row-3 | The lead column is for state (a dot, an orb, the palette's kind glyph), never decoration | **keep** | The lead is the face: orb, item mark, group stack. |
| R-row-4 | A two-line row is `--row-h-2` with a 12 quiet sub line; a list never has three-line rows | **change** | Two-line rows are 54 with a 13 secondary line (the activity), never three lines. |

### R-dock

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-dock-1 | The dock is `--dock-bg` black in every theme, flush to the bottom edge, `--r-l` top corners with `--r-l` concave flares, centred on the centre line… | **change** | Kept black, flush, centred (owner decisions); its slab keeps --r-slab 30 and its flares. Its insides take v7's components on the dock ground (bubble, composer, the hold). |
| R-dock-2 | The dock shows only what exists (owner decision, 19 November 2026; its row is added with the dock's presence work): its bots part when at least one… | **keep** | Only what exists. |
| R-dock-3 | It rises in, grows and leaves with spring motion (critically damped, no overshoot, R-motion-3); under reduced motion size changes are instant and… | **keep** | Springs. |
| R-dock-4 | Its options and its minimise control appear only on hover or keyboard focus (`:hover`, `:focus-within`), never at rest (owner decision, 19 November… | **keep** | Controls on hover. |
| R-dock-5 | The page indicator (the nub of page dots in the foot) shows only when there is more than one page (owner decision, 19 November 2026); the current… | **keep** | Page nub. |
| R-dock-6 | One click or Enter on an orb opens the bot's session in the dock; the same orb, Esc or the close button returns; a double-click or mod+Enter opens… | **keep** | Orb gestures. |

### R-card

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-card-1 | A card is the drawer colour (`--bg-0`; the dock's `--surface` in the dock), `--r-m`, padding 14 16, up to 520 inline or 360 compact; what sits in its… | **change** | A card is elevated (--bg-3, --line, radius 18 in a conversation, 14 elsewhere), padding 12; its well 10 inside (radius 10 = 18 − 8). |
| R-card-2 | Its foot puts mono meta or a receipt at the start and the actions at the end, the primary action (or the hold) last | **keep** | Foot: meta first, actions last, primary last. |
| R-card-3 | Red is only its stamp; a decided card recedes (title and well to `--text-dim`, the foot a receipt) | **change** | A decided card collapses to one row ("Terminal, ran 1 command", Grok 9.4) instead of receding in place. |
| R-card-4 | Every state change animates its height (owner decision); cards stack as R-stack-3 and never nest (R-stack-2) | **keep** | Height animates (owner decision); never nested. |

### R-btn

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-btn-1 | One primary per group: the action that moves the work forward | **keep** | One primary: the inverted ink pill. |
| R-btn-2 | In a foot or a group, actions sit at the end; the primary (or the hold) is last, the way out first | **keep** | Order. |
| R-btn-3 | A destructive action is secondary, never red and never primary: the first press arms it (`--line-strong`, the label "Click again to archive"), the… | **change** | A destructive action is a menu item or a secondary that confirms in a form dialog; the confirm itself is the red pill (Grok's Delete / Reset). The arm-twice pattern retires (R-comp-6: one way to confirm). |
| R-btn-4 | A text button's icon leads, `--ic-l` (16), `--ic-gap` from the label, and only when the glyph is the action's own (R-icon-8) | **keep** | Icon leads. |
| R-btn-5 | A button hugs its label (padding 0 14, small 0 10, ghost 0 8, `flex: none`); it never stretches to its container, except the hold's 148 minimum | **change** | Buttons are pills: 36 (padding 0 16), 32 in cards (0 14), 28 small (0 12). |

### R-ib

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-ib-1 | An icon button is a `--ctl-s` square with an 18 glyph, `--r-s` (or the corner's `--r-in-*` in a corner or on a band), always with an accessible name… | **change** | Icon buttons are circles: 36 floating (elevated fill, hairline), 28 in the composer and rows (4% fill). |
| R-ib-2 | A toggle shows `aria-pressed` with a brass glyph, or `aria-expanded` with its filled half; never both | **keep** | Toggle states. |

### R-switch

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-switch-1 | A switch is for a setting that applies at once; an action or a mode that needs a confirmation is not a switch | **keep** | Applies at once. |
| R-switch-2 | It sits at the end of its settings row, the label and hint at the start, `<label for>` bound | **keep** | End of the row. |
| R-switch-3 | No "on" or "off" text inside or beside it; the knob's place and the bone track say it | **change** | Switch 32 x 20: on = --accent with a white knob, off = 4% fill (light: 12% grey track, white raised knob). |

### R-chip

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-chip-1 | A chip is a capsule; inside a container's band it takes the band's `--r-in-*`, which is a capsule at a chip's height too | **keep** | Capsule. |
| R-chip-2 | Heights and type: a toolbar chip is `--ctl-s` − 2 (26), 12/500 `--text-dim`, glyph `--ic-m`; an option chip `--ctl` − 4 with `--line`, checked… | **change** | Chips 28, 13/400, --fill-2; a filter chip that is on is the inverted ink pill (Grok's category chips); composer mode chips 26 with a hairline, --current when on. |
| R-chip-3 | The strike through an unpressed label is only for the composer's mode toggles (Governed, Smart) | **remove** | The strike through an unpressed mode chip goes: off is outline, on is filled. |

### R-kbd

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-kbd-1 | A key chip is 18 tall and at least 18 wide, padding 0 4, mono 11 `--text-dim`, tracking 0; `--bg-3` with `--hair`, or `--bg-4` with no line on a… | **change** | Key chip 20 tall, 6% fill, radius 4, 12 --text-dim, sans (Grok). |
| R-kbd-2 | A key chip at the end of a rounded container takes its --r-in (8 in a tooltip or a 26px field), at most a capsule; --r-xs in running text | **keep** | Concentric at a field's end. |
| R-kbd-3 | Keys show in tooltips, at the end of menu items, in the palette's field (esc), on a button while hovered or focused, in the command field and in the… | **keep** | Where keys show. |

### R-float

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-float-1 | A menu, a popover and a tooltip sit `--float-gap` (8) from their anchor and at least `--float-margin` (8) from the window edge, below the anchor… | **keep** | Gap 8 and margin 8. |
| R-float-2 | No arrows, beaks or tails on any floating surface | **keep** | No beaks. |
| R-float-3 | A menu opens below its trigger, its start 8px before the trigger's (so the first item's label lines up with the trigger's), or end-aligned when the… | **keep** | Menu alignment. |
| R-float-4 | Sizes: menus 220 to 340 wide, popovers 360 (at most the window less 24), tooltips one line | **change** | Menus 220 to 280; popovers 360; the palette 640; tooltips one line. |
| R-float-5 | Opening moves focus in (a menu to its checked item or the first); Esc, an outside press and Tab close it and focus returns to the trigger; one at a… | **keep** | Focus in and out. |

### R-menu

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-menu-1 | A menu item is at least `--row-h`, padding 6 8, radius `--r-in-menu` (16); a 16 glyph column, a 13/400 label (R-type-3), an optional 12 quiet… | **change** | Menu 16 radius, inset 6; items 32, padding 6 8, radius 10, a 16 glyph, 14/400 label; titles 12 --text-dim. |
| R-menu-2 | Item states: hover `--hover`; keyboard focus `--current` with an inset 2px brass ring; checked a brass check, never a filled square; disabled… | **change** | Hover and keyboard focus are the 6% fill (keyboard adds the ring); checked a check glyph; a destructive item red text and glyph. |
| R-menu-3 | A title is 12/500 quiet; a separator a hairline 6 in from each side; a foot note 12 quiet above a hairline | **keep** | Titles and separators. |

### R-toast

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-toast-1 | One line at the top of the work (`--chrome-h` + 12), centred on the centre line, raised with `--hair` and `--elev-3`, `--r-m`, `--ctl-s` + 12 tall;… | **change** | Toast elevated, radius 10, 40 tall, popover shadow in light. |
| R-toast-2 | It stays 3s (6s with an action) and waits while hovered or focused; one at a time (a mod's queue, 14.29) | **keep** | Timing and queue. |
| R-toast-3 | A toast confirms what just happened | **change** | A toast also confirms every copy (Grok gap 10). |

### R-tip

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-tip-1 | A tooltip is raised with `--hair` and `--elev-2`, `--r-s`, 12px, padding 4 8 (4 4 4 8 with keys); its keys take `--r-in-field` (R-kbd-2) | **change** | Tooltip elevated, radius 6, padding 4 6, 12/16. |
| R-tip-2 | It shows below its anchor, above within 160px of the window's bottom, to the right in the rail; and it never covers the text you are typing: a… | **keep** | Placement. |
| R-tip-3 | Timing: 480ms the first time, at once while warm (700ms after the last) and on keyboard focus; it hides on pointer down, focus out and Esc | **change** | Timing: enter 100 from scale(.98). |
| R-tip-4 | Its text is the control's accessible name, then an optional mono state, then the keys; one line, never interactive, never the only place for… | **keep** | Content. |

### R-focus

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-focus-1 | Focus is a `--focus-w` (2px) `--focus` ring at `--focus-offset` (2px) outside the element, on `:focus-visible` only, with no transition | **change** | The ring stays (2px at 2px) in --focus (the accent text blue); Grok draws none, boopis keeps WCAG 2.4.7. |
| R-focus-2 | Inside a floating surface or a clipped track (menu items, option rows, segmented options) the ring is inset 2px, with the `--current` fill | **keep** | Inset in floating surfaces. |
| R-focus-3 | On a drawn corner the ring follows the same continuous path, inside the edge (8.1) | **keep** | Follows the drawn corner. |
| R-focus-4 | A field shows the ring on its box (`:focus-within`), never on the bare input; the composer shows focus as `--line-field` and a brass caret | **change** | The composer shows focus with --line-field and the caret in --focus. |
| R-focus-5 | Focus never moves on hover; opening a layer moves it in; closing returns it to the trigger; a resolved card keeps it on its next sensible control | **keep** | Focus moves. |
| R-focus-6 | A focused control is never hidden (WCAG 2.4.11): scrollers keep `scroll-padding` for the composer, the dock and any fixed head (R-layout-5) | **keep** | Never hidden. |

### R-field

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-field-1 | A text field is at least `--ctl`, `--r-s`, `--bg-0` on the frame (`--bg-3` raised on the ground), an inset `--line-field`, 13 sans at `--lh` (mono 11… | **change** | Field 36, radius 10, transparent with --line-field (3:1, where Grok's 22% fails), 13 text; a search field is a pill at --fill-2. |
| R-field-2 | Its label is above it (12/500 `--text-dim`, 6 above, bound with `for`); a hint or the error is below it (12/1.5, `aria-describedby`); the error… | **change** | Label 12 --text-dim above; "(Optional)" in --text-quiet; a hint only under R-calm-2. |
| R-field-3 | States: hover line `--text-quiet`; focus the ring (R-focus-4); `aria-invalid` red line; disabled at `--disabled-alpha` (R-state-6) | **keep** | States. |
| R-field-4 | A textarea grows with its text and has no resize grip (`resize: none`) | **keep** | No grip. |

### R-empty

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-empty-1 | An empty state is centred in the space above the dock: the logo's mark 32 wide in `--text-faint`, a title 16/600, one or two sentences 13/1.6… | **change** | Replaced by R-calm-4: one line of at most 80 characters (15 words) in --text-dim and at most one action, inside the place the content would be; the logo-and-title empty state is for first run only. |

### R-dialog

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-dialog-1 | A modal dialog is `min(600px, 100% − 32px)` × `min(680px, 100% − 64px)`, centred, the frame colour, `--r-l`, `--line` and `--elev-4` over `--scrim` | **change** | Large dialogs (Settings, Store, Keyboard) 900 wide, radius 14, --bg-pane with --bg-3 cards, 220 nav; form dialogs 440 to 488, radius 20, --bg-3, title 15/600, foot right-aligned. Close top-right, 28, 10 in. |
| R-dialog-2 | The wide sheet (the keymap) is `min(1000px, 100% − 32px)` × `min(720px, 100% − 48px)`, with the same head and body | **change** | The keymap sheet becomes a 900 large dialog (Grok's two-column shortcuts). |
| R-dialog-3 | The side dialog (Appearance) is `min(420px, 100% − 24px)` wide and the window's height less 12 on each side, at the right edge, with no scrim, so its… | **change** | The Appearance side dialog becomes a Settings page. |
| R-dialog-4 | A sheet inside a view (bot settings) is `--right-w`, the frame colour, flush right under the title bar with a concave top-left corner (`--r-l`), and… | **change** | Sheets in a view (bot settings) become the details pane (356, --bg-pane, pushes the work, overlays under 900) with an overflow menu in its head (board 08). |
| R-dialog-5 | Focus moves in (the first field, else the close button), Tab loops inside, Esc closes and focus returns to the opener; one modal at a time; a… | **keep** | Focus trap and Esc. |
| R-dialog-6 | Under 640 a dialog keeps 16 from the window's sides and drops its title, never its tabs | **keep** | Narrow windows. |

### R-search

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-search-1 | Three search fields, one family | **keep** | One family: the palette field, the search pill (chrome option B), a field in a page. |
| R-search-2 | The search glyph labels, it does not act: `--text-quiet`, like the placeholder, at the start | **keep** | The glyph labels. |
| R-search-3 | The leading glyph is centred in a square as tall as its field: its centre is half the field's height from the edge | **keep** | Glyph square. |
| R-search-4 | What ends a field (key chips while it is empty) sits `--pad-tip` (4) from the end of a 26 field and takes `--r-in-field` (R-kbd-2); in the palette's… | **keep** | End chips. |
| R-search-5 | Matches are underlined in brass with the text `--text-strong`, never highlighted with a fill; no matches is a sentence that teaches ("No matches for… | **change** | Find-in-chat highlights matches with a yellow wash (22%, current 32%, Grok); search results keep the underline. |

### R-select

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-select-1 | A select is a button drawn as a field (the `.ui-input` box, the value, a `chevron-down` at `--ic-xs` in `--icon` at the end) that opens a menu of… | **change** | A select is a 28 text trigger with a chevron, transparent until hover, radius 10 (Grok); in a form, a field. |
| R-select-2 | Long lists (fonts, models) keep the menu's typeahead (a letter jumps, 14.18) and scroll inside past the window's height (R-float-4) | **keep** | Typeahead. |
| R-select-3 | Enter, Space and Alt+Down open it; Up and Down move; Enter picks; Esc closes with no change | **keep** | Keys. |
| R-select-4 | A model picker shows each provider's mark in brand colour (owner decision, 10.1); every other picker is monochrome | **keep** | Brand marks in the model picker. |

### R-check

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-check-1 | There is no square checkbox | **keep** | No square checkbox. |
| R-check-2 | A radio is an option row's ring: empty in `--mark-off`, the chosen one filled brass (a shape change as well as a colour), the row `--current` while… | **change** | A radio is a letter tile in a question card (A, B, C, chosen = accent) or a check in a menu. |

### R-slider

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-slider-1 | No slider track | **change** | Grok has one slider (voice speed); boopis still has none. Kept until voice needs it. |

### R-state

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-state-1 | Every control draws exactly the states of the table above with those tokens; a state not in the table does not exist | **keep** | The state table, with v7 values. |
| R-state-2 | State lives in ARIA or data attributes, never in classes such as `.is-active` | **keep** | ARIA state. |
| R-state-3 | Hover styles apply only where a pointer hovers: every hover rule sits under `@media (hover: hover) and (pointer: fine)` | **keep** | Hover media query. |
| R-state-4 | Hover in over `--dur-1`, out over `--dur-out`, press over `--dur-press`; focus never transitions | **change** | Hover in 120, out 100, press 50. |
| R-state-5 | Three meanings, never mixed: `--current` is where you are (the current row, the active text tab, a focused menu item, the listening mic); the bone… | **change** | Three meanings: --current (where you are, 8%), --selected (the primary, inverted ink), --accent (on: the switch, the chosen option). |
| R-state-6 | Disabled: a control with text or an icon takes the role colours (`--text-quiet`, `--icon-off`); a control drawn in fills (send, switch, field) takes… | **change** | Disabled primary: 13% ink fill with 30% text (Grok). |
| R-state-7 | Busy shows `aria-busy` and the running dot or the Stop it became; never a spinner (R-load-1) | **change** | Busy shows the status line (board 08) or the Stop it became; never a spinner, except the one boot ring (R-load-1). |

### R-load

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-load-1 | No spinners and no shimmering skeletons | **change** | No spinners (one thin ring on a cold boot, Grok 3.12, is allowed); skeletons are allowed only with the exact shape of the content (R-flow-4) at 6 to 8% ink, never shimmering. |
| R-load-2 | A region waiting for its first data keeps its frame (its head, title and hairlines) and draws nothing in its body; if it is still empty after… | **change** | Loading shows after 150ms (R-flow-4), not --load-delay. |

### R-error

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-error-1 | An error stays where it happened: a field shows it below the field, an action in its card (the error card), a view that cannot load in its empty… | **keep** | Errors stay where they happened. |
| R-error-2 | Only the message and a field's line are `--red-text` and `--red`; a failed gate or sign-in is the "failed" stamp | **change** | Red values per R-colour-2. |

### R-unknown

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-unknown-1 | Unknown is shown as unknown: the word "unknown" where the value would be (mono quiet where the value would be mono), never a placeholder number, a… | **keep** | "unknown" as a value. |

### R-table

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-table-1 | Reference data is a two-column grid, as the keymap is (`shell.css .hx-keys`): the label at the start, the value at the end, 8 0 per line, a `--hair`… | **keep** | Two-column reference data. |
| R-table-2 | A table with more columns has no vertical rules and no zebra stripes; its header is 12/500 `--text-quiet` in sentence case; rows are `--row-h` with a… | **keep** | Tables. |

### R-data

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-data-1 | Measures, progress and positions are dots, never bars (owner decision; 14.27) | **change** | Dots stay for measures and pages (owner decision); a usage meter may be Grok's thin bar in Settings > Usage only if the owner allows it (open question, not on a board). |

### R-form

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-form-1 | A form is one card family (owner decision, `apps/desktop/AGENTS.md`): one renderer from the schema, every field a library field (14.25), one column,… | **keep** | One card family (owner decision); the cards take v7's surfaces. |
| R-form-2 | Rhythm: 6 from a label to its field, 12 (`--sp-3`) between fields (`cards.css .cd-form`), 24 between groups, 48 before a new block (7) | **change** | Rhythm: 6 label to field, 16 between fields, 24 between groups. |
| R-form-3 | A secret field never shows the saved value again; it says where the value is kept | **keep** | Secrets. |

### R-native

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-native-1 | Nothing the platform draws ever shows (decision of 19 November 2026): no `<select>` popup, no date, time or colour picker, no file button, no range,… | **keep** | No native controls. |
| R-native-2 | Text inputs stay native elements drawn by `.ui-input`; they keep a native arc for their corner (an `<input>` cannot hold the `::after` that draws the… | **keep** | Native inputs drawn by the kit. |
| R-native-3 | The customizer's colour row is its swatch and hex field; the mock-up's `<input type="color">` is replaced by a swatch button that focuses the hex… | **remove** | The colour customizer goes with the presets; a mod's theme preview stays. |

### R-a11y

| Rule | v6 | v7 | Target |
|---|---|---|---|
| R-a11y-1 | WCAG 2.2 AA is the floor (the app's rule in `apps/desktop/AGENTS.md`; this section's audit was 2.1): zero axe violations in every preset at 1440, 720… | **keep** | WCAG 2.2 AA, zero axe. |
| R-a11y-2 | A pointer target is at least `--hit-min` (24 × 24), or a mark smaller than that gets a hit area of 24 around it (page dots, the context measure) | **change** | Targets at least 28 (Grok's composer buttons; its gap 3 asks 32 for message actions, which v7 takes for those). |
| R-a11y-3 | Label in name: an accessible name contains the visible text, in order; icon buttons are named; orbs and icons are hidden and their holder is named | **keep** | Label in name. |
| R-a11y-4 | Everything the pointer does, the keyboard does (`KEYMAP.md`); one tab stop per composite (lists, segmented controls, pages) | **keep** | Keyboard parity. |
| R-a11y-5 | Focus is never hidden behind the composer, the dock, a fixed head or a toast (R-focus-6) | **keep** | Focus not hidden. |
| R-a11y-6 | Reflow: no horizontal scroll at 390 or 720 (200%) | **keep** | Reflow. |
| R-a11y-7 | State changes are announced politely (`role="status"`, `aria-live="polite"`); never assertive | **keep** | Polite announcements. |
| R-a11y-8 | Text 4.5:1, non-text marks and the focus ring 3:1 on every surface they sit on (R-colour-6) | **keep** | Contrast floors (this is why meta is 66%, not 54%, and fields keep 38%). |

## 4. Rules added: Part H (owner decision) and Grok

Part H's rules join v7 as written (`08-CALM-UI-DESIGN-RULES.md`); where Part H says "where an existing rule conflicts, this file wins", v7 follows it. v7 adds four rules of its own from Grok.

| Rule | v7 | Where it lands |
|---|---|---|
| R-calm-1 to R-calm-10 (text budget: label + value + control, hints the exception, say it once, empty is quiet, unknown is a value, one status line, length caps, diagnostics are not hints, long text gets its own editor, words per surface) | **add** | DESIGN-SYSTEM.md 11; the calm pass built R-calm-1, 4, 6, 9 and 14's library pieces |
| R-calm-11 to R-calm-16 (three depths, panels on request, group don't rule, one primary per view, breathing room is a token, truncation is not a design) | **add** | R-calm-13 replaces the settings row separators with Grok's soft cards; R-calm-12 removes the closed right panel's strip |
| R-comp-1 to R-comp-7 (the closed set of surfaces and blocks, no layout CSS in modules, one string catalogue, a registry with states, one way per pattern, specs first) | **add** | DESIGN-SYSTEM.md 12 is the closed set in v7's values |
| R-flow-1 to R-flow-7 (nothing from nowhere, shared elements travel, one timing scale, no layout jumps, state persists, 60 fps on WebKitGTK, same place same thing) | **add** | DESIGN-SYSTEM.md 9 (motion) |
| R-ink-1 | **add** | One neutral: every interface colour that is not a meaning (accent, attention, warn, ok) or data (orbs, marks) is the ink at a named alpha step. |
| R-float-6 | **add** | Floating chrome: no bar spans the window; controls float at y = 10 in a 56 px drag region; a floating control is a 36 px pill on --bg-3 with --line. |
| R-status-1 | **add** | A working bot's status is its live 16 px orb and one phrase, held at least 800 ms, swept by the shimmer (board 08 C); the nameless agent's is the dot and the phrase (A). Never a spinner. |
| R-bubble-1 | **add** | Conversations are bubbles: a bot's at --bubble-agent, yours at --bubble-user, radius 18, padding 7 12, 6 apart within a sender and 16 between senders; no per-message avatar in a 1:1, a byline in the bot's colour in a room. |

## 5. Components (the kit, `@boopis/ui`)

Every module of `apps/desktop/ui/src/components` and every pattern of `docs/UI-COMPONENTS.md`, against Part H's closed set (R-comp-1, R-comp-2). "Surface" and "block" are Part H's words.

| Component (v6) | Part H role | v7 | Target |
|---|---|---|---|
| `button` (secondary, primary, ghost; m, s) | block | **change** | Pills: secondary --bg-3 + --line, primary inverted ink, ghost text --text-dim, danger red fill (confirms only); 36 / 32 / 28 |
| `iconButton` (s, window) | block | **change** | Circles: 36 floating (elevated), 28 tinted (4%), ghost for window controls |
| `send` | block | **change** | The composer's last slot: the voice button (waveform) that becomes send when there is text, inverted ink, 28 |
| `hold` | block | **keep** | 1 s hold (owner decision), drawn as the inverted-ink pill filling |
| `switch` | block | **change** | 32 x 20, accent when on (R-switch-3) |
| `segmented` | block | **change** | Pill track at 4%, pill thumb (--current dark, white raised light) |
| `tabs` (dialog head, pane strip) | block | **change** | Dialog-head tabs become the Settings nav (220, rows 32, radius 8); pane tabs become a segmented pill (Activity, Library) |
| `field`, `input`, `select`, `search` | Field | **change** | Field 36 radius 10 at --line-field; select a 28 text trigger with chevron; search a pill |
| `keys`, `kbd`, `combo` | block | **change** | Key chip 20, 6% fill, radius 4, sans 12 |
| `chip`, `chipGroup`, `stamp`, `dot`, `badge` | block | **change** | Chips 28 at 4%; filter chip on = inverted pill; stamp = dot + word in --red-text; badge kept for "made outside boopis" |
| `setRow`, `setHead`, `setSection` | Row, Section | **change** | Row inside Grok's soft card (radius 14, --bg-3, rows 16 across, no separators); with the calm pass's value, (i) and danger |
| `row`, `group` | Row, List | **change** | 32 (sessions, menus) or 54 (bots, groups: 36 orb + name + activity) |
| `itemMark`, `itemRow`, `publisher` | Row | **change** | 40 tile radius 12 in a 60 row; marks and their evidence rules kept |
| `orb`, `liven`, `glance`, `orb-runtime`, `orb-worker` | OrbStack | **keep** | orb2 unchanged; sizes per R-orb-2; eye colour = surface (board 04 B); the activity-line orb live |
| `stack` (and the rail's cluster) | OrbStack | **keep** | One overlap step (owner decision); 24 in the title pill and rows, 16 in the activity line |
| `presence` (who is at work) | StatusLine | **change** | The activity line: stacked 16 px orbs + "kai and moss are replying", shimmer |
| `menu`, `popover`, `layer`, `listbox` | Popover/Menu | **change** | Radius 16, inset 6, rows 32 radius 10, glyphs on every item; enter 100 ms from scale(.98) |
| `tooltip` | Popover | **change** | Radius 6, padding 4 6, 12/16 |
| `toast` | Toast | **change** | Radius 10, 40 tall; confirms copies |
| `composer`, `mentions`, `fileChip` | (composer) | **change** | 44 pill growing to radius 22; mode line inside (board 07 B); held-message strip inside; "@" machinery kept |
| `markdown`, `md-view` | (content) | **change** | Renders inside bubbles: 15/22, code 13 on --chip; mention chips in the bot's colour; "you" capsule in red (owner decision) |
| card layer (`hx-card`, forms, `card-registry`) | Card, ApprovalCard, PlanCard | **change** | Elevated, radius 18 in a thread, padding 12, well 10; decided card collapses to one row; forms one family (owner decision) |
| `progress` (dots, measure, ladder, pages, capacity) | StatusLine | **keep** | Dots stay (owner decision); colours from the new tokens |
| `model-mark`, `model-name` | block | **keep** | Provider marks beside every model name (owner decision) |
| `logo` | block | **keep** | `<boopis-logo>`, still where it labels, the title pill on an empty session |
| `signin-button` | block | **keep** | ADR-0040's branded buttons; the shell around them takes v7's pill |
| `squircle`, `squircle-path`, `shape`, `corners` | (primitive) | **keep** | Board 02 B keeps the continuous corner and the nesting arithmetic; under A, `squircle` retires and `corners` stays |
| `place` | (primitive) | **keep** | Overlay placement (gap 8, margin 8) |
| `scroll`, `scroll-edges` | (primitive) | **keep** | Scroll areas and edge fades (owner decision) |
| `mod-view`, `mod-colors`, `mod-svg`, `mod-tree` | (mods) | **keep** | Mods draw in theme (owner decision); their map points at v7's roles |
| `announce`, `bot-state`, `look`, `clipboard`, `child`, `wire`, `html`, `kit`, `variants`, `icons` | (plumbing) | **keep** | `icons` gains `info` (calm pass) and the proposed glyphs of R-icon-1; `bot-state` keeps the one state map |
| calm pass: `statusLine`, `setStatus` | StatusLine | **change** | Look C (live orb + shimmer) for bots, A for the agent (board 08) |
| calm pass: `dangerZone`, `overflow` | Section, Menu | **keep** | Both kept: overflow on panes and sheets, danger zone at the end of Settings pages (board 08) |
| calm pass: `longText`, `editLong` | (R-calm-9) | **change** | The editor opens as a focused view (board 08 B), not a dialog |
| calm pass: `setRow({ value, info, danger })`, `section({ empty, hideEmpty })`, `empty({ line })` | Row, Section, EmptyState | **keep** | As built; restyled by the tokens |
| (none) | ChoiceCards | **add** | The question card: bold question, A/B/C letter tiles (20, radius 6), "Something else" as a free answer; the chosen one in the accent |
| (none) | Island/Pill | **add** | The title pill (40, orb 24 + name, opens details) and the floating chrome pills |
| (none) | Page | **add** | The details pane (356, --bg-pane, pushes the work; overlays under 900) |
| (none) | Disclosure | **add** | "Read 6 files, ran 2 commands ›" under a turn (Grok's collapsed tool row) |
| (none) | (string catalogue) | **add** | `ui/strings/en.json` with roles (R-comp-4). Not started on `w31c/calm`; v7 needs it before the copy pass |

## 6. Lab checks (`docs/UI-LAB.md`, `tests/lab/rules.mjs`)

| Check | v7 | Target |
|---|---|---|
| `errors`, `stability.render`, `stability.interact` | **keep** | as is |
| `geometry.contain`, `geometry.center`, `geometry.clip`, `geometry.hscroll`, `geometry.overlap` | **keep** | as is |
| `geometry.target` | **change** | 28 instead of 24 (R-a11y-2) |
| `concentric` | **keep** | floor 6; under board 02 A it checks plain arcs |
| `overlay` | **keep** | as is |
| `tokens.computed` | **change** | the active theme's tokens: dark, light, the dock ground (two modes instead of four presets) |
| `tokens.spacing` | **change** | v7's named exceptions (R-space-2) |
| `tokens.static` | **keep** | as is |
| `native`, `scrollbar`, `brand`, `copy` | **keep** | as is |
| `roles` | **change** | "text in --brass" becomes "text in --accent" (only --accent-text may be text); "inset on inset" becomes "elevated on elevated without a step" |
| `axe` | **keep** | zero violations; the calm-options story's allowlist (status B) goes if B is not picked |
| `visual` | **change** | every golden is retaken after the owner's pick |
| matrix: presets catalog, graphite, bone, typewriter | **change** | themes dark and light |
| R-calm-1, 2, 3, 4, 7, 10 checks (Part H's machine checks) | **add** | warnings first, then failures (Part H section 7); none exist yet on `w31c/calm` |
| R-comp-3 lint (no layout CSS in modules), R-comp-4 (no string literals), R-comp-6 (duplicate DOM signatures) | **add** | as Part H states |
| R-flow-4 (no layout jump on load), R-flow-6 (frame measure) | **add** | the stability check already catches part of R-flow-4 |
| shimmer contrast | **add** | the swept phrase never drops under 4.5:1 (its rest colour is --text-dim; the sweep only brightens) |

## 7. The v6 owner decisions

| Decision (DESIGN-SYSTEM.md, apps/desktop/AGENTS.md) | v7 |
|---|---|
| The dock is pitch black in every theme | **keep** |
| Cards animate their height | **keep** |
| Hold to approve takes 1 s | **keep** |
| Dock orbs: one click opens the session; double-click the full chat | **keep** |
| Dock pages (a nub of dots), dock motion, "only what exists", controls on hover, centred option | **keep** |
| Reduced motion reduces and never freezes the orbs | **keep** |
| Inactive marks reach 3:1 | **keep** (--mark-off) |
| Nested corners fit their container | **keep** (floor 6) |
| Apple continuous corners in every engine (radii 30 / 20 / 12) | **change**: the curve stays (board 02 B), the radii become Grok's; only the dock and the notch keep 30. Under A, the curve goes too |
| Every composer can talk | **keep** (mic in every composer, the voice button in the last slot) |
| boopis is the product; the engine is invisible | **keep** |
| Graphite and Typewriter have a real accent | **remove** (the presets retire; one accent, board 09) |
| Provider logos beside every model name | **keep** |
| Logo: oval eyes, live eyes when animated, playful letters for big moments, sizes, the name and element, the app icons | **keep** |
| Mod colours stay in theme; mod panes inline under 1200; progress in the band is dots; the composer rises 22 px; the puzzle glyph; mod toasts queue; a mod's colours preview live; a mod's colours keep text readable | **keep** (they map onto v7's roles) |
| Eyes belong to the state | **keep** |
| No native controls | **keep** |
| Which profiles are bots; archived bots; one look per bot; a group's members overlap; the interface size is the web view's zoom | **keep** |
| A message in a group never ends a bot's work; "@" in every composer; a message to the person stands out (red) | **keep** (red per board 09 B; under A the "you" capsule turns amber) |
| Smart and the model picker; keyboard first; the window's controls always reachable | **keep** (the window controls float in the drag region) |
| Forms are one card family | **keep** |
| BOOPIS-MASTER 1: the boopis bot is the theme's foreground colour | **keep** (drawn so in every board; light ink on the dock) |
| Part H (calm UI) | **add** in full |

## 8. The calm pass, folded in (`w31c/calm`, commit 36219708)

The calm writer paused after the library pieces. v7 keeps everything it built and does not redo it:
- **Built, kept:** Row gains `value`, `info` and `danger`; Section gains `empty` and `hideEmpty`; EmptyState gains `line`; `calm.ts` adds `statusLine` / `setStatus`, `dangerZone`, `overflow`, `longText` / `setLongText` / `editLong`; the `info` glyph; lab stories `components/calm-forms`, `calm-options`, `danger-zone`, `long-text`, `status-line`; unit tests in `calm.test.ts`.
- **Not started, now part of v7's implementation plan:** the string catalogue (R-comp-4), the R-calm lab checks, the screen fixes (Part H section 7's list).
- **Its four open choices** are on board 08, redrawn in v7: the status look (A dot, B breathing phrase, C Grok's live orb and shimmer, which Part H names and the kit lacks), the danger actions (A collapsed section, B overflow menu), the (i) glyph (A the calm pass's, B filled, C none), the long-text editor (A dialog, B focused view).

## 9. The notch's corner rules (spec sections 2.1 and 12)

The approved notch spec uses the kit's continuous corner (`squircle-path.ts`, smoothing 0.6), the concentric rule with the floor, and the dock's slab (`--r-l` 30, flares 30). v7 carries them consistently:
- **Under board 02 B (recommended)** nothing in the notch changes: the curve is the same; `--r-l` is renamed `--r-slab` (30) and keeps the shape and its flares; `--pad-dock` 12 gives the notch composer 18, which is now also v7's bubble radius; the send inside it is 18 − 6 = 12. The notch's controls take v7's pills, which section 2.1 already makes capsules (R-corner-9). Its section 12 table holds as written except for two renames: `--r-m` request card becomes the bubble (18), `--r-s` wells become `--r-field` (10).
- **Under A** the notch would switch to plain arcs too (`--corner-smoothing: 0`), with the same radii and the same concentric table; `slabPath` takes `{round: true}`. One switch for both, so the dock, the notch and the app never mix curve families.
- The floor moves from 8 to 6. No piece in the notch's table sits at the floor, so no notch radius changes.

## 10. Open choices (the boards)

Each open choice is rendered as 2 to 3 options in dark and light at app scale, on the boards delivered with this proposal (`ds-v7/01-fonts.jpg` to `09-accent-attention.jpg`, with a contact sheet). The recommended pick of each is the default in `tokens.v7.json`.

| Board | Choice | Recommended |
|---|---|---|
| 01-fonts | Geist, Inter or Figtree (all SIL OFL 1.1) | A Geist (bundled today) |
| 02-radii | Grok exact (plain arcs), Grok's radii with the continuous corner, or rounder | B |
| 03-light-shadows | Grok's shadows, hairline plus half shadows, or flat | A |
| 04-orb-surface | orb2's own eyes, cut-out eyes, cut-out eyes in a tile | B |
| 05-chrome | floating (Grok), floating plus a search pill, an unfilled bar | A |
| 06-sidebar-tile | 54 tile / rail 88, 44 tile / rail 64, 48 circle / rail 72 | A |
| 07-composer | the pill alone, the pill with a mode line inside, the mode line under it | B |
| 08-calm-options | status look; danger actions; the (i); the long-text editor | C (A for the agent); B on panes, A on Settings; A; B |
| 09-accent-attention | accent blue, ink or brass; attention amber or red | blue; red |
