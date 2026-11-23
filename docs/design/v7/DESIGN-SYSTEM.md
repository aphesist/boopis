# boopis design system v7 (proposal)

Status: **the owner has picked** (23 November 2026; section 15.1). Invariant 8: the owner designs the UI. The kit is not restyled yet: the next step is the accent hex (one of five indigo candidates, preview P1), the search placement (P2), the mark (P3) and the normal-session screen, which the owner will discuss next. Where an earlier section says "recommended", section 15.1 wins. Once implemented, this file replaces `design/v6/design-system/DESIGN-SYSTEM.md` as the source of truth and the kit is restyled from it.

| File | What it is |
|---|---|
| `DESIGN-SYSTEM.md` | This proposal: principles, tokens for dark and light, type, radii, space, elevation, motion, the calm rules, the closed component set, bots and orbs, the options |
| `tokens.v7.json` | Every token with its dark and light value, the v6 token it replaces and the Grok value it comes from; the options and their recommended defaults |
| `build-v7-css.mjs`, `tokens.v7.css` | The generator and its output: the tokens as custom properties, plus the option switches the boards use |
| `AUDIT.md` | Every v6 token, rule (220), component, lab check and owner decision mapped to v7: keep, change, add or remove |

**The brief.** "A complete refactor, based on the recordings, screenshots, and plans: maintaining our character but cloning grokbot's style pretty hard, wherever possible." Grok Bot's measured values (Part A, `grokbot-design/tokens.json`) are the starting values. Where a v6 rule disagrees, Grok's style wins, except for boopis's character:

- **Kept as boopis:** orb2's orbs (shapes, faces, states, the eyes that belong to the state); the wordmark and logo; each bot's own colour, and the boopis bot in the theme's foreground; boopis's vocabulary; and, by owner decision, the black dock, the 1 s hold, forms as one card family, the provider marks, the mods' rules, the corners' concentric rule.
- **Cloned from Grok:** one neutral ink at alpha steps on near-black surfaces; no shadows in dark, hairlines and specular light instead; pills and big radii; a small tight type scale with hierarchy by alpha; ruthless density; status in words and motion; fast, sharp motion; floating chrome instead of bars.
- **Not copied:** Grok's logo, its XVF font files and its character art. The fonts are open (section 6); the characters are orb2.
- **Floors that do not bend:** WCAG 2.2 AA (readable text 4.5:1, marks and fields 3:1, a visible focus ring). Where Grok falls under them (its 54% captions, its 22% field outline, its missing focus ring; Part A section 8), v7 keeps the floor.

---

## 1. Principles

Ordered; when two collide, the higher wins. v6's principles 1, 2, 4, 5, 7 and 8 stay; 3 and 6 are restated; four come from Grok.

1. **The conversation is the work.** One narrow column (bubbles of 560 in a 640 column) on a quiet ground; everything else floats, recedes or waits to be asked for.
2. **Interrupt only for decisions.** Red still marks what the person owes (board 09).
3. **Quiet at rest** (Part H, principle 2b). A surface at rest shows names, values and controls; explanation, diagnostics and empty narration wait one step away.
4. **One neutral, many steps.** The interface is one ink at alpha steps on near-black (or near-white) surfaces in tiny steps. Colour appears only for meaning (accent, attention, warn, ok) and for the bots.
5. **The characters carry the personality.** The orbs are the only playful element; everything around them is austere, so they stand out.
6. **Status is said in words and motion.** A live mini orb and one phrase, not spinners, step lists or badges.
7. **Cost and model are always knowable, never loud.** In the composer's mode line and a quiet line under a turn, in mono.
8. **Every path has a second path.** The palette (ctrl K) and the keys reach everything the floating chrome does.
9. **One canonical component per job,** from Part H's closed set (section 12).
10. **Corners fit.** Nested corners are concentric; Grok's radii already are.
11. **Fast and sharp.** 100 ms popovers, 120 ms colour, 200 ms dialogs; the only long animations are the orbs, the shimmer and the working pulse.

## 2. Voice and copy

v6's voice stays (sentence case, a verb and its object, no middle dots, em dashes or exclamation marks, "unknown" as a value, the engine invisible). Part H's text budget joins it (section 11). From Grok, three habits:
- **One plain sentence for empty, with the next action named:** "No sessions yet", "Nothing waiting on you".
- **Reassurance under risky actions, one line:** "boopis asks before anything leaves this computer."
- **Status phrases from the tool in use,** held at least 800 ms: "Reading the changelog", "Running the tests", "Waiting for your approval".

State words keep boopis's vocabulary (working, thinking, replying, listening, needs you, done, asleep, paused, failed), set in sans at `--text-dim`, sentence case when the word stands alone ("Needs you: approve a deploy"). The three stamp wordings stay.

## 3. Token architecture

- **One ink.** `--ink` is #f5f5f5 in dark and #1c1c1c in light. Text, icons, lines and fills are that ink at named alpha steps: 2, 4, 6, 8, 10, 20, 38, 54, 66, 90 and 100%. A theme chooses solids (surfaces, ink, the meaning colours); every tint follows.
- **Two modes.** `data-theme="dark"` (the default) and `"light"`. The four v6 presets, `--ui-case` and the colour customizer retire. The user still sets: theme (system, light, dark), accent (section 4), interface size (the web view's zoom, owner decision) and density.
- **The CSS custom property is the contract,** as in v6. v7 keeps the incumbent names where the role survives (`--bg-0` to `--bg-4`, `--text-*`, `--line*`, `--hover`, `--current`, `--selected`, `--red*`) so modules need few edits; new roles get new names (`--bg-pane`, `--fill-2`, `--spec`, `--accent-text`, `--bubble-*`, the radius names).
- **The dock ground** re-derives the roles from #000 as in v6.

## 4. Colour

### 4.1 Surfaces

| Token | Role | Dark | Light | Grok |
|---|---|---|---|---|
| `--bg-1` | the sidebar and the rail | `#0e0e0e` | `#f5f5f5` | bg-sidebar |
| `--bg-2` | the ground: the window, the conversation | `#121212` | `#fcfcfc` | bg-chrome |
| `--bg-pane` | the details pane; large dialogs | `#161616` | `#ffffff` | bg-pane |
| `--bg-3` | elevated: cards, menus, dialogs, the composer, tooltips, toasts, floating buttons | `#1f1f1f` | `#ffffff` | bg-elevated |
| `--bg-4` | elevated hover, pressed, the scrollbar thumb | `#2c2c2c` | `#f1f1f1` | bg-elevated-hover |
| `--bg-0` | wells only: code, diffs, terminal | `#171717` | `#f7f7f7` | sampled |
| `--dock-bg` | the dock (owner decision) | `#000000` | `#000000` | none |

What the user writes is a bubble (`--bubble-user`, 18% ink in dark, solid ink in light); a bot's message is `--bubble-agent` (4% ink plus a 3% top gradient and a 4% ring in dark, 6% ink in light). Everything that floats or holds controls is elevated. Nothing is inset except wells.

### 4.2 Text, icons, lines, fills

| Token | Role | Dark | Light |
|---|---|---|---|
| `--text`, `--text-strong` | body, names, titles | ink 100% | ink 100% |
| `--text-dim` | everything secondary a person must read: descriptions, times, headings, meta, state words | 66% (7.3:1 on elevated) | 68% (5.4:1) |
| `--text-quiet` | placeholders and labelling glyphs only | 54% | 56% (3.7:1: never meta) |
| `--text-faint` | disabled | 38% | 40% |
| `--icon` / `--icon-quiet` / `--icon-off` | glyphs; window and composer glyphs; disabled | 90 / 54 / 30% | 90 / 56 / 30% |
| `--mark-off` | inactive non-text marks (3:1) | 38% | 42% |
| `--fill-4` / `--fill-2` / `--hover` / `--current` / `--fill-active` | washes: faintest; composer buttons and chips; hover; selected; pressed | 2 / 4 / 6 / 8 / 20% | 2 / 6 / 6 / 8 / 20% |
| `--hair` / `--line` / `--line-strong` | group dividers and the bubble ring; outlines of elevated things; hovered | 4 / 6 / 10% | 8 / 12 / 18% |
| `--float-line` | the outline of floating surfaces | 6% | almost none: the shadow is the edge |
| `--composer-line` | the composer at rest | 10% | 8% |
| `--line-field` | text fields (kept at 3:1) | 38% | 42% |
| `--spec` / `--spec-strong` | inset top and bottom light; the top-most layer's highlight | white 3% / 12% | none |
| `--selected` / `--selected-hover` / `--text-on-light` | the primary pill, send, the active filter chip | `#f5f5f5` / `#dbdbdb` / `#121212` | `#1c1c1c` / `#333333` / `#fcfcfc` |
| `--scrim` | behind dialogs and the palette, never blurred | black 70% | black 50% |

### 4.3 Meaning

| Token | Role | Dark | Light |
|---|---|---|---|
| `--accent` | the owner's pick: an indigo (Iris `#5b5bd6` as placeholder, one of five candidates; editable in a custom theme). The switch on, the chosen option, progress, a filled or chosen mark (section 17). A fill, never text | `#5b5bd6` | `#5b5bd6` |
| `--accent-text` | links, the info banner | `#8b8dff` (6.6:1) | `#4546c8` (7.1:1) |
| `--accent-soft` | the info banner, text selection | accent 7% | accent 7% |
| `--focus` | the 2px focus ring | `#8b8dff` | `#4546c8` |
| `--owe` / `--owe-text` / `--owe-soft` | the owner's pick (09 A): what the person owes: the needs-you dot and words, the rail's flag, the "you" capsule, a lapsed blank, the notch's edge | `#c8770c` / `#e28600` (7.0:1) / amber 8% | `#c8770c` / `#a35600` (4.8:1) / amber 8% |
| `--red` | failed, and the fill of a destructive confirm, only | `#cf2b35` | `#cf2b35` |
| `--red-text` | "failed", error lines, a destructive menu item | `#ff6463` (6.5:1) | `#c4232f` (5.6:1) |
| `--warn` / `--warn-text` | the same amber; `--owe*` are its "you owe" names | `#c8770c` / `#e28600` | `#c8770c` / `#a35600` |
| `--ok` / `--ok-text` | online, connected, passed | `#0e9f5a` / `#00ba69` | `#0e9f5a` / `#087a43` |
| `--add` / `--del` | diff counts | `#00ba69` / `#ff6463` | `#087a43` / `#c4232f` |

**Bots' colours are data** (R-colour-8 kept): an orb's colour stays the orb's. **One owner-approved exception** (23 Nov): in a specific bot's own chat, your bubble and the send button take that bot's derived fill (section 18.1); nothing else in the chrome changes. Two named uses also join the card ring: a bot's name above its bubble in a room, and its @mention chip, take the bot's colour (Grok 9.3). The boopis bot is the theme's ink (owner decision 1).

### 4.4 Contrast

The pairs table of v6 5.4 is rebuilt for two themes and the dock from these values (`build-tokens.mjs --report` after the pick). Measured now: ink on every surface 12.8 to 17.7:1; `--text-dim` 6.5 to 7.9:1 dark, 5.1 to 5.5:1 light; `--text-quiet` 4.9 to 5.7:1 dark, 3.5 to 3.7:1 light (hence placeholders only); `--mark-off` 3.2 to 3.4:1.

## 5. Theming

- **Theme:** Follow system, Light, Dark (Grok's three).
- **Accent:** an indigo by default (the owner chooses the hex from P1), any hex in a custom theme (section 18). Grok's "Bot colour" accent is not offered: an orb's colour never becomes interface colour.
- **Size:** Default, Larger, Largest (owner decision: the web view's zoom).
- **Density:** compact, regular (Grok's), comfortable; moves `--row-h`, `--row-h-2`, `--ctl`, `--ctl-s` only.
- **Mods** keep their theme preview and readability guard (owner decisions), mapped onto v7's roles.

## 6. Typography

**Family** (board 01, the owner's pick): **Geist** ( SIL OFL 1.1, already bundled as `@fontsource/geist`), B Inter (SIL OFL 1.1), C Figtree (SIL OFL 1.1). Mono is Geist Mono (SIL OFL 1.1) in every option. Licences are checked: all three families and Geist Mono are SIL OFL 1.1 (the files' own LICENSE texts are in the boards' `src/fonts/`). Grok's XVF is proprietary and is not used or shipped.

| Token | Size / line | Weight | Where |
|---|---|---|---|
| `--fs-2xs` | 11 / 16 | 400 | badges, mono meta |
| `--fs-xs` | 12 / 16 | 400 | timestamps, section headings, tooltips, captions, state words, key chips |
| `--fs-s` | 13 / 18 (+0.015em) | 400 | settings descriptions, row subtitles (the activity line), inputs, select values |
| `--fs-m` | 14 / 20 | 400 | menus, buttons, chips at 13, the composer, row names, settings labels |
| `--fs-l` | 15 / 22 | 400; 600 for a dialog title or a question | messages, dialog titles, the question card's question |
| `--fs-xl` | 17 / 24 | 500 | a page title (Settings section), the bot name field |
| `--fs-2xl` | 22 / 28 | 400 | first-run headings |
| `--fs-3xl` | 26 / 32 | 400 | the first-run hero |

- Tracking +0.01em (sans), 0 (mono, key chips). Weights 400, 500, 600 only; hierarchy by alpha first (`--text`, `--text-dim`, `--text-quiet`), size second, weight last.
- **Mono** only for code, paths, numbers that change or line up (costs, times, counts, ratios, "$0.37 of $0.60") and keys. Model names, state words and the call number become sans.
- Code: 13 inline in a bubble on `--chip`, 12 in wells and diffs.
- The title pill's name is 15 (Grok 16), the one place a name is larger than a row's 14.

## 7. Space, density and layout

**Space:** the 4 px scale (4, 8, 12, 16, 24, 32, 48) plus 2. Named component internals, Grok's: bubble 7 12; menu row 6 8 inset 6; button 0 16 (36), 0 14 (32), 0 12 (28); chip 0 14; settings rows 16 across in a card padded 8 0; nav row 7 9; palette rows inset 8; tooltip 4 6; title pill 7.5 13.5 7.5 7.5.

**Sizes:** `--ctl` 36 (floating buttons, buttons), `--ctl-card` 32 (buttons in a card), `--ctl-s` 28 (composer buttons, chips, small buttons), `--row-h` 32 (menus, nav, sessions), `--row-h-2` 54 (bots, groups, rail tiles), composer 44, title pill 40, key chip 20, switch 32 x 20, hit minimum 28.

**Layout (1440 x 900, regular density)** — key screens 10 to 16:

| Part | v7 | v6 |
|---|---|---|
| Top chrome | no bar; a 56 px drag region; floating controls at y = 10: the sidebar toggle (36 circle) over the rail, the title pill centred on the column (orb 24 + name; opens the details pane), search and details (36 circles), thin window glyphs (board 05 A, the owner's pick). Search is always reachable (ctrl K opens the palette everywhere). **Default (the owner's pick, P2 S5): keyboard first with a clickable hint.** The hint sits in the right-hand group of the drag region, just left of the details button, vertically centred on the 36 px controls: the word "Search" (13, `--text-quiet`) and the key chips (ctrl K; ⌘K on macOS) with no fill at rest. On hover and focus it becomes a 28 px pill at `--hover` with the text at `--text-dim`, over `--dur-1`; focus also shows the ring. It is a button; its accessible name is "Search, ctrl K" (it contains the visible text, R-a11y-3), and it opens the palette. It never fades. Settings > General > Layout: "Show search" (on; off hides the hint, ctrl K still works) and "Search shows as": the hint (default), a button (board 05 A's 36 px circle), or a pill beside the title (board 05 B) | a 40 px frame bar with back, forward, the command field and toggles |
| Rail (sidebar collapsed) | 88 px, `--bg-1`, 54 px tiles (radius 12, orb 36, the current one 8%), the attention flag (amber) with a 2.5 px ring; groups as their cluster under a hairline; New bot, Store and Settings at the foot (board 06 A, the owner's pick). **Compact rail** (board 06 B: 64 px, 44 tiles, orb 28): Settings > General > Layout > Rail size: Automatic (default), Standard, Compact. Automatic is compact **under 1200 px of window width** (v6's breakpoint where both side panels stop pushing, R-layout-1, so no new width), standard from 1200; under 900 an open sidebar overlays; under 640 the sidebar is a drawer | 56 px, orbs 24 on x = 28 |
| Sidebar (open) | 300 (resizable 88 to 400), `--bg-1`; the Sessions / Bots pill at the top; bot rows 54 (orb 36, name 14, activity 13 at `--text-dim`, gap 10, radius 12); "Groups" heading 12 `--text-dim`; you, Store, Settings at the foot | clamp(256, 15vw, 288) |
| Conversation | column 640 centred on the ground; bubbles up to 560; a time separator only on a gap ("Today 10:05", 12 `--text-dim`) | 720 column with a 112 call-number margin |
| Composer | centred, min(720, column + 80), 16 above the dock; its line underneath (board 07 C, the owner's pick; section 12.2) | the column's width |
| Details pane | 356, `--bg-pane`, pushes the work (overlays under 900): the 64 orb, the name, an Activity / Library pill, then only the sections that exist | a 28 px strip closed; clamp(300, 18vw, 340) open |
| Dialogs | large 900 (Settings, Store, Keyboard): radius 14, `--bg-pane`, a 220 nav, `--bg-3` cards; forms 440 to 488: radius 20, `--bg-3` | 600 x 680, radius 30 |
| Palette | 640, radius 14, rows inset 6 radius 8 | 600 |
| Dock | kept (owner decisions): black, flush, centred, 72 at rest, `--r-slab` 30 with its flares; its contents take v7's bubble, composer and hold | same |

The call-number margin goes. A session's turn shows the model (its provider mark and name), time and cost as one 12 px line under the answer, in `--text-dim` (mono for the numbers); the running total sits in the composer's mode line.

## 8. Shape

### 8.1 Radii (board 02)

| Token | Value | Elements |
|---|---|---|
| `--r-pill` | 9999 | every button, icon button, chip, segmented track and thumb, switch, the title pill, the search pill, the one-line composer, avatars |
| `--r-composer` | 22 | the composer box as it grows |
| `--r-bubble` | 18 | messages, question cards, cards in a conversation (approval, plan, file, connector) |
| `--r-dialog` | 20 | form dialogs (new bot, confirm, the long-text editor if board 08 picks A) |
| `--r-menu` | 16 | menus, popovers, the listbox |
| `--r-card` | 14 | settings cards, large dialogs, the palette, kanban cards |
| `--r-tile` | 12 | the rail tile, sidebar rows, item marks |
| `--r-field` | 10 | fields, selects, menu rows, toasts, the info banner, wells |
| `--r-nav` | 8 | settings nav rows, palette rows |
| `--r-tip` | 6 | tooltips, a question's letter tile |
| `--r-xs` | 4 | key chips, inline code |
| `--r-slab` | 30 | the dock's slab and flares and the notch's shape, only |
| `--r-floor` | 6 | the smallest nested radius |

**The curve** (board 02): **B (recommended)** keeps boopis's continuous corner (`squircle.ts`, smoothing 0.6) at these radii; A sets smoothing to 0 (Grok's plain arcs); C pushes every step one notch rounder.

### 8.2 Nesting

v6 8.2 stays: `--r-in = max(--r-floor, --r-outer − --pad)`; a piece too small to be that round moves in until its curve shares the corner's centre; a round piece in a pill stays a pill. Grok's numbers satisfy it already:

| Nesting | Outer | Inset | Inner |
|---|---|---|---|
| a row in a menu | 16 | 6 | 10 |
| a row in the palette | 14 | 6 | 8 |
| a 28 button in the composer | 22 (44 tall) | 8 | 14: a circle |
| the close button (28) in a form dialog | 20 | 10 | 10 → a capsule (R-corner-9) |
| a 28 control in a Block (tool row, files, AskCard, approval, notice) | 22 | 8 | 14: a pill (R-corner-10) |
| a row in the queue, and its button | 22, then 18 | 4, then 4 | 18, then 14 |
| a button in a line pill (the engine stopped) | 16 (32 tall) | 3 | 13: a pill |
| a kbd in the search pill | 18 | 8 | 10: a pill |
| a well in a conversation card | 18 | 8 | 10 |
| a piece in a settings card | 14 | 8 | 6 (the floor) |
| the orb in a rail tile | 12 | 9 | a circle |
| the notch's composer in its shape | 30 | 12 | 18 (= the bubble radius) |
| the send in the notch's composer | 18 | 6 | 12 |

**R-corner-10, the corner rule made strict (owner, 23 Nov, after S36).** A control nested in a container's corner zone (both of its insets under the container's radius) has radius = outer radius − inset, its two insets are equal, and it never runs past the container's edge. A control that cannot meet it moves out of the corner zone (an inset at least the container's radius on one axis) or the container changes: every inline surface that holds controls is now a **Block** (`--r-block` 22, the composer's radius, `--pad-block` 8), so its 28 px pill controls sit 8 from both edges; text rows inside indent 4 more, so text keeps its 12. Badges are labels, not controls: a status in a Block's head is a word (`.word`), not a capsule in the corner. The render QA checks it (`concentric`), and the lab blocks on it (LAB-v7).

**R-row-1, single-line rows (owner, 23 Nov, after S32).** A menu or list row is one line: the name never wraps or shrinks, a fixed gap (12 px: the row's 8 gap and 4 on the description) separates it from the description, and the description truncates with an ellipsis. Nothing in a row runs past the row's padding edge. The render QA checks it (`row`), and the lab blocks on it.

The notch spec's sections 2.1 and 12 hold under B unchanged (AUDIT.md section 9): `--r-l` becomes `--r-slab`, the request card's radius becomes the bubble's 18, wells take `--r-field`. Under A, the notch switches to plain arcs with the app, never alone.

## 9. Elevation and motion

### 9.1 Elevation

- **Dark: no shadows.** Depth is the surface steps, a 1 device px `--line` (0.5 px at 2x, 0.625 at 1.6x) and an inset `--spec` top and bottom line; the top-most floating layer adds a 1 px `--spec-strong` highlight on its top edge (Grok gap 9: stacked dialogs).
- **Light** (board 03 A, recommended): Grok's shadows as measured. `--shadow-inline` 0 4 12 −1 8%, 0 2 4 −2 6% (floating buttons, settings cards); `--shadow-pop` 0 10 20 −3 10%, 0 4 6 −4 10%, a 1 px 1% ring (menus, tooltips, toasts); `--shadow-modal` 0 20 32 −5 10%, 0 8 12 −6 10% (dialogs); `--shadow-window` 0 22 70 4 56%. Floating surfaces drop their visible outline (`--float-line`): the shadow is the edge.
- **The composer** carries `--shadow-composer` in both themes.
- Scrim 70% black dark, 50% light; never blurred. z-index scale unchanged.

### 9.2 Motion

| Token | Value | Use |
|---|---|---|
| `--ease-sharp` | cubic-bezier(.165, .84, .44, 1) | popovers, menus, tooltips, dialogs, presses |
| `--spring` | cubic-bezier(.22, 1, .36, 1) | the sidebar, tiles, layout travel (unchanged) |
| `--ease-drawer` | cubic-bezier(.32, .72, 0, 1) | the details pane |
| `--ease-out` | ease-out | colour |
| `--dur-press` | 50 ms | press: scale(.96), no travel |
| `--dur-1` / `--dur-out` | 120 / 100 ms | hover in and out, colour |
| `--dur-pop` | 100 ms | menus, popovers, tooltips, the palette: from scale(.98) and 2-4 px toward the anchor |
| `--dur-2` | 200 ms | dialogs, the voice-to-send swap, cross-fades |
| `--dur-dot` | 130 ms | status dots and badges |
| `--dur-slide` | 200 ms | the sidebar, rail tiles, a segmented thumb |
| `--dur-3` | 300 ms | card height (owner decision), the composer's growth (a spring), the dock's springs |
| `--dur-hold` | 1000 ms | hold to approve (owner decision) |
| `--dur-breathe` | 1.4 s | the working pulse (opacity .35 → 1 → .35) |
| `--dur-shimmer` | 2.2 s | the status phrase's sweep (board 08 C), steps(60) |
| `--dur-hold-phrase` | 800 ms | a status phrase's minimum hold |

Part H's R-flow rules apply in full: nothing appears from nowhere, shared elements travel (the orb from the rail into the title pill, from a group row into the room), one timing scale, no layout jumps (space reserved, skeletons the exact shape, loading after 150 ms, text that changes cross-fades), state persists, 60 fps measured in WebKitGTK, same place same thing. Reduced motion: durations to 1 ms, the pulse and the shimmer stop, travel becomes a cross-fade, orbs reduce and never freeze (owner decision).

## 10. Bots and orbs

orb2 is unchanged: shapes, colours, faces, reactions, the state map (`HX.ui.states`), "eyes belong to the state", the reduced-motion rule.

| Size | Where | Motion |
|---|---|---|
| 10 | the dock's minimised pill | static |
| 16 | the activity line (live while it works), mentions, bylines, card minis | static, except the activity line |
| 20 | lists inside cards, the dock session's switcher | calm |
| 24 | the title pill, a group's stack in rows | calm |
| 28 | the compact rail (board 06 B only) | calm |
| 36 | the rail tile, sidebar rows | calm |
| 40 | the dock row | calm |
| 64 | the details header | lively |
| 96 | the new-bot preview | calm, glance lead |

- **Eyes on a Grok-style surface** (board 04, the owner's pick B) give orb2's eyes the colour of the surface behind the orb (read on `hx:theme`, R-theme-5), so they read as cut out, as Grok's characters' are. On dark surfaces A and B look alike; on light surfaces and tiles B's eyes go white.
- **The boopis bot:** the `squircle` shape (the reserved `boop` shape when it ships), coloured with `--text-strong`, so it is light ink on dark, dark ink on light, and light on the black dock; its eyes are the ground. It reads as the logo given a body.
- **The activity line** (R-status-1): the working bot's 16 px orb, live, beside one phrase in `--text-dim` at 15, swept by the shimmer; in a room, the stacked orbs of everyone replying ("kai and moss are replying"). Thinking turns the orb to its dot-grid eyes (orb2's `thinking`).
- **The attention flag:** an 8 px `--owe` (amber) dot with a 2.5 px ring of the surface, bottom-right of a tile; always with words in the row ("Needs you: approve a deploy") so colour is never the only cue (Grok gap 2).

## 11. The calm rules (Part H, owner decision)

Part H joins v7 in full: R-calm-1 to 16, R-comp-1 to 7, R-flow-1 to 7. In short:
- **Label + value + control** in every settings or details row; a hint is the exception (one line, at most 60 characters, at most one per six rows); explanation behind an (i) (board 08), a row's detail page, or the boopis bot.
- **Say it once; empty is quiet** (a section collapses to its heading and a muted value; a page empty state is one line of at most 80 characters and one action); **unknown is a value; status is one line.**
- **Word budgets at rest:** side pane 40, settings section 60, card 25, page empty state 15, dialog 50. Allowed dense surfaces: the palette, the keyboard sheet, search results, logs and diagnostics, diffs, the kanban board, tables, Store search results, Settings > Keyboard.
- **Three depths:** glance (at rest), look (hover or expand), dig (a page or dialog).
- **Panels on request; group, don't rule** (Grok's soft cards replace the settings row lines); **one primary per view; destructive and rare actions in the overflow or a danger zone** (board 08); **truncation is not a design.**

## 12. Components: the closed set

Part H R-comp-1 and R-comp-2, in v7's values. Each lists its spec; states, keyboard and accessibility follow v6 section 14 unless a line says otherwise.

### 12.1 Surfaces

| Surface | Spec |
|---|---|
| **Page** | the ground (`--bg-2`) and its column (640), or the details pane (356, `--bg-pane`, a hairline at its left edge, pushes the work; overlays under 900 with `--shadow-modal`). Head: the 64 orb (or icon), name 17/500, a segmented pill; sections only for what exists |
| **Dialog** | large (900, radius 14, `--bg-pane`, 220 nav of 32 rows radius 8, a 17/500 page title, sections of soft cards) or form (440 to 488, radius 20, `--bg-3`, title 15/600, foot right-aligned: ghost then primary); close 28 at 10 in, top-right; enter 200 ms; scrim 70% / 50% |
| **Popover / Menu** | `--bg-3`, radius 16, inset 6, `--float-line`, `--shadow-pop` in light; items 32, padding 6 8, radius 10, a 16 glyph, 14 label; separators a hairline 8 in; enter 100 ms from scale(.98); one open at a time |
| **Card** | settings card: `--bg-3`, radius 14, padding 8 0, rows 16 across, no separators (light: `--shadow-inline`). Conversation card: `--bg-3`, radius 18, padding 12, a 13 `--text-dim` tool head, a 15/600 question, one plain line, a well (radius 10), the foot's actions; decided, it collapses to one row |
| **Toast** | `--bg-3`, radius 10, 40 tall, 14, one line, an optional ghost action; confirms copies; one at a time (mods queue, owner decision) |
| **Island / Pill** | the title pill (40, orb 24 + name 15, opens details) and the floating chrome pills (36, `--bg-3`, `--line`, `--shadow-inline` in light); the voice pill and the notch use the same family |
| **Sheet** | retired as a separate surface: bot settings become the details pane; long text opens a focused view (board 08) |

### 12.2 Blocks

| Block | Spec |
|---|---|
| **Section** | heading 12 `--text-dim` (4 in from its card), an optional muted value, a disclosure; collapses to its heading when empty (calm pass) |
| **Row** | settings: label 14, optional value 13 `--text-dim` (mono for numbers), control at the end; a label that explains itself is a mark (section 17, the owner's pick 08 Info C; fallback the outline (i)). List: 32 (sessions, menus) or 54 (bots, groups: orb 36, name 14, activity 13, radius 12; current 8%, hover 6%) |
| **List** | rows, virtualised; one tab stop, arrows move |
| **EmptyState** | one line (≤ 80 characters) in `--text-dim` and at most one action, where the content would be |
| **StatusLine** | the owner's pick (08): one line, one shimmer (2.2 s, the phrase held at least 800 ms), one configuration. A bot: its live 16 px orb. A normal session (the nameless agent): the answering model's provider mark (the shipped LobeHub marks, mono, `--text-dim`), breathing on the working pulse (opacity .55 to 1, scale .92 to 1, 1.4 s); still while it waits. A system job with no model: the phrase alone. Reduced motion: the mark still, no sweep. An optional count in mono; one per job per view; polite live region (preview P4). The session screen's own look is the next discussion with the owner |
| **Disclosure** | "Read 6 files, ran 2 commands" with a chevron, 13 `--text-dim`; opens the step list (icon + verb + target, 13) |
| **Field** | 36, radius 10, transparent, `--line-field`; label 12 `--text-dim` above; "(Optional)" in `--text-quiet`; error below in `--red-text`; search is a pill at `--fill-2` |
| **Toolbar** | chips 28 at `--fill-2` (13), the active filter an inverted pill; segmented pills; a status line at the end |
| **ChoiceCards** | the question card: bubble surface, radius 18, question 15/600, options 36 tall with a 20 letter tile (radius 6, 6% fill), hover 6%, the chosen tile in the accent; "Something else" turns into a free answer; once answered the others collapse away |
| **AskCard** (the owner's pick, 23 Nov; Part H's ApprovalCard and the blank's card, one component) | everything that waits on the person's answer under a reply. Elevated (`--bg-3`, `--line`), radius 18, padding 10 12, the reply's width (440 to 560). Anatomy, in order: a head (12 `--text-dim`: the asker's 16 px mark or orb and a short line; at the end the state, for example "needs you" with the amber dot); the ask (14 `--text`, one line, wrapping); an optional sub line (12 `--text-dim`, one line, ellipsized); the answers as a row of 28 px chips, the default one inverted, wrapping. Variants: **`question`** (a session's lapsed blank: head "asked during the turn" with the answering model's mark; the agent's guess as the inverted chip, the others and "Something else" as a free answer; answered: the chosen answer as a solid accent mark and "sent as a correction") and **`approval`** (a bot's ask, from `approval-surfaces.md`: head the bot's orb and "nina asks" with "needs you"; the ask is the B40 summary of what it wants to do; the sub line "Rule: “…”" linking to the rule in Settings > Approvals; the answers that spec defines for the card's kind: Hold to allow once (the 1 s hold, owner decision; the inverted chip), Allow all this turn, Always allow, Deny with esc; governed sessions and budget pauses offer once and deny only). Neither variant has a countdown in the card. States: pending, answering, answered (a one-line receipt in the head, then the card collapses to one row), withdrawn (the turn ended). A bot's card never expires (`approval-surfaces.md` section 5 on `w31/specs` at d5350c0b: "expired" applies only to the owner's own sessions and to parked steps after 7 days). Look depth: the exact action in a well, who asked, the reviewer's why; dig: the rule in full. This is the reference `approval-surfaces.md` section 5 should point to. PlanCard keeps the same surface and head with its own body |
| **OrbStack** | members overlapped by a third of an orb (owner decision): 24 in the title pill and rows, 16 in the activity line, the rail's cluster |
| **Composer** | the owner's pick (07 C): a 44 pill (radius 22 as it grows), `--bg-3`, `--composer-line`, `--shadow-composer`; + (28, `--fill-2`) left; mic (28) then the voice button (28, inverted ink) that becomes send with text; grows with a 300 ms spring; a held message as a strip above it (owner decision). **The line under it**, 12 `--text-dim`, 8 below, items left and the cost at the end, each item toggleable: Mode (Governed or Ungoverned; on), Smart (Smart, or the pinned model; on), Model (the answering model with its provider mark; off), Cost ("$0.37 of $0.60", mono, unknown when unknown; on), Context ("76k / 200k"; off); in a room Members ("3 members") replaces Mode. Toggled from the composer's + menu > "Show under the composer" (checks, remembered per kind of composer: session, bot, room, dock) and Settings > General > Under the composer (the defaults); kept in `core/settings`; an empty line takes no space. Each item is also the control (click Governed to switch, Smart to open the model picker, as today) |
| **Buttons** | pills: secondary (`--bg-3` + `--line`), primary (inverted ink), ghost (`--text-dim`), danger (red fill, confirms only); 36, 32 in cards, 28 small |
| **Icon buttons** | circles: 36 floating, 28 tinted, ghost for window controls |
| **Switch** | 32 x 20; on: accent with a white knob; off: 4% (light: a grey track and a raised white knob) |
| **Key chip** | 20 tall, 6% fill, radius 4, 12 `--text-dim` |
| **Tooltip** | `--bg-3`, radius 6, padding 4 6, 12; the name, then the keys |
| **Inline chips** (R-inline-1) | every chip set in running text (the "you" capsule, @mentions, inline code, the mark and a blank's countdown) sits on the line: its text baseline equals the line's baseline (within 0.5 device px); its box is optically centred on the line (the glyph or orb inside is centred on the x-height by its own `vertical-align`); it never makes the line taller (its height is at most the line height; it is inline-level, never a flex box); its padding is symmetric left and right. The lab enforces it with an `inline-baseline` check, being built on `w29/inline-baseline` |
| **Bubble** | R-bubble-1: radius 18, padding 7 12, 15/22; a bot's `--bubble-agent`, yours `--bubble-user`; 6 apart within a sender, 16 between; in a room a byline (16 orb + name in the bot's colour) above a sender's first bubble; mentions as chips (16 orb + name in the bot's colour); a message to you gets the amber "you" capsule and an 8% amber wash (owner decision, recoloured by the 09 A pick) |
| **Time separator** | 12 `--text-dim`, centred, only after a gap |
| **Hand-off row** | centred, 13 `--text-dim`: two 16 orbs, a chevron, "kai handed the notes to nina" |
| **Item row** | 60 tall, a 40 mark (radius 12, `--bg-4`), name 14, one line 13 `--text-dim` (ellipsized), the action as a 28 tinted pill |
| **Danger zone / overflow** | the owner's pick (08, hybrid): the overflow (28 circle, `more` glyph) in the head of panes and sheets; the collapsed "Danger zone" card at the end of a Settings page; a destructive item in red; confirms in a form dialog with a red pill |
| **Long-text editor** | the owner's pick (08 B): a focused view over the work, the chrome kept (back, the title pill, Save), the text in mono 13/22 at the column's measure |

Every component ships with its states in the lab before a module uses it (R-comp-5); `docs/UI-COMPONENTS.md` becomes the registry.

## 13. Key screens

Rendered with the owner's picks beside the boards; 11, 12 and the new 17 follow the Grok-Bot parity of section 19 (`ds-v7/10-` to `16-`, dark and light): the session chat, a bot's chat with the rail (the sidebar collapsed), a group room with the sidebar open, the session list open, Settings, the Store, and the dock opened on a bot's session. They are drawn from the kit's own tokens (`tokens.v7.css`), boopis's icon set, the real `<orb-avatar>` (orb2) and `<boopis-logo>`, and the kit's `squircle-path.ts` for the continuous corners. The app's own lab draws v6 components, so the v7 previews are standalone boards until the kit is restyled.

## 14. Accessibility

WCAG 2.2 AA stays the floor (R-a11y-1 to 8). What v7 adds or tightens because of Grok:
- readable secondary text at 66% / 68% (never Grok's 54% captions);
- text fields at 3:1 (`--line-field` 38% / 42%), where Grok's 22% fails;
- a visible 2 px focus ring in `--focus`, where Grok draws none;
- targets at least 28 (the composer's buttons), 32 for message actions (Grok gap 3);
- colour never the only cue: the attention flag always has words; the status shimmer never dims the phrase below 4.5:1 (its rest colour is `--text-dim`, the sweep only brightens); reduced motion stops it.

## 15. The owner's picks

### 15.1 Owner's picks, 23 Nov

| # | Choice | The owner's pick | In this file |
|---|---|---|---|
| 01 | Font | A, Geist (SIL OFL 1.1) | 6 |
| 02 | Radii | B (Grok's radii, the continuous corner) is the default; C (rounder) is offered in theme customization. This reading of "B and C look good" is the coordinator's; the owner can correct it | 8, 18 |
| 03 | Light shadows | A (Grok's measured) is the standard; each theme can pick A, B or C | 9.1, 18 |
| 04 | The orb on the surface | B, cut-out eyes | 10 |
| 05 | Chrome | A, floating pills, is the standard. Search is always reachable (ctrl K) and its visible control can be turned off; B (the search pill) is a Settings option; other placements in preview P2 | 7 |
| 06 | Rail | A (54 tile, rail 88) is the standard; B (44 / 64) is a setting and switches on automatically under 1200 px of window width | 7 |
| 07 | Composer | C, the line under the composer; its items are toggles (Mode, Smart, Model, Cost, Context; Members in a room), in the composer's + menu and Settings | 12.2 |
| 08 | Calm options | Status: C for a bot (live orb + shimmer); for a normal session the same shimmer with the answering model's logo, animated (P4). Danger: the hybrid (overflow on panes and sheets, the danger zone at the end of Settings). Info: C, the mark revealed on hover (fallback A, the outline (i), if the owner rejects P3). Long text: B, the focused view | 12.2, 17 |
| 09 | Accent | an indigo default, editable in custom themes; the owner chooses among Iris, Indigo, Ultramarine, Violet-indigo, Soft indigo (P1); Iris is the placeholder | 4.3, 18 |
| 09 | Attention | A, Grok's amber for "needs you"; red stays for failed and destructive confirms (15.2) | 4.3, 15.2 |
| new | The mark | one dashed-underline primitive for info labels, feedforward and blanks (the owner's request; P3) | 17 |

**Final picks (later on 23 Nov), which close the open items above:**

| Preview | The owner's pick | In this file |
|---|---|---|
| P1 accent | **Iris** is the default accent: `#5b5bd6` fill, `#8b8dff` text in dark, `#4546c8` text in light | 4.3 |
| P2 search | **S5 is the default**: keyboard first with the hint, and the hint itself is clickable and opens the palette; the button (S1) and the pill (S2) stay as Settings options | 7 |
| P3 the mark | **approved**, info labels included; the outline (i) is no longer a fallback, kept only for forced colours (17.2) | 17 |
| P4 status | **approved** | 12.2 |
| Blanks | **changed**: sessions only. A session's blank waits inline with a countdown (the agent paused, amber), then lapses to a card; bots never have blanks and ask through approval cards with no time limit (17.1) | 17 |

### 15.2 The attention reversal (09 A)

The pick reverses "red means you owe something" (v6 R-colour-2, the stamp rule) and the owner decisions of 22-23 November that name red. Red now means failed and a destructive confirm only; amber (`--owe`) means the person owes something. Every place that changes:

| Where | Was | Becomes |
|---|---|---|
| v6 R-colour-2, R-error-2, R-card-3, R-copy-3 (the "needs you" stamp) | `--red`, `--red-text` | `--owe`, `--owe-text`; "failed" stays red |
| The "you" capsule and the message addressed to you (owner decision, 23 Nov: "a message to the person stands out"; `components/markdown.ts` `you`, `components.css`, `PAIRS`) | ring and glow in attention red, a `--red-soft` wash, the attention edge in the gutter | ring, word and edge in amber, an `--owe-soft` wash; the flash on arrival stays |
| The sidebar's needs-you line and dot, the rail's attention flag (`modules/bots/list.ts`, `.ui-dot--flag`) | red | amber |
| The jump button's "1 for you" and its dot (`modules/bots/ledger.ts` `setJump`) | red dot | amber dot |
| The blank (`.ui-blank__gap`, "waiting for you" stamp) | a dotted red line and the red stamp | the mark (section 17): neutral while the bot runs (a blank does not stop the cell), amber only once it has lapsed and waits on the person |
| Approval cards and the dock's needs-you state (stamp, dot, "Needs you" word) | red | amber |
| A tab's attention dot and ", needs you" (R-tab-3), the palette's red trail | red | amber |
| The notch spec (`notch-design/notch-spec.md`): principle 4 "Red only when you owe something"; section 3 the attention edge ("a 1 pt red edge ... soft red glow"); 4.4 the wings' approval count "in red" and the red outline; "needs you" in red (wings with words, 4.10's byline); 4.6 page dots ("a bot that needs you a red dot") and the Rooms tab's red dot; 4.9 ping highlight C and boopis's red edge, glow and wash; 4.10 "the red dot and count stay"; 4.11 the ping card's red edge; 5 "others as a red ..." in the priority rule; 6 option 2 (C, the red dot until seen; the red edge); 7 full screen "a red dot and the edge glow"; the `tools/check-corners.js` scenes that draw them | red | amber; 4.11's error card ("failed" in red, the last lines in red text) stays red. Not re-rendered now |
| The island (panacea-island) round-4 options that share the notch's letters (ping C) | red | amber, decided once with the notch |
| Contrast pairs (`styles/theme.ts` `PAIRS`, the mods' readability guard) | `--red-text` on every surface | `--owe-text` on every surface (7.0:1 dark; `#a35600` 4.8:1 on the lightest and the darkest light surfaces) |

### 15.3 The boards as offered

| # | Choice | Options | Recommended then |
|---|---|---|---|
| 01 | Font | A Geist, B Inter, C Figtree (all SIL OFL 1.1) | A |
| 02 | Radii | A Grok exact (plain arcs), B Grok's radii with the continuous corner, C rounder | B |
| 03 | Light shadows | A Grok's measured, B hairline + half, C flat | A |
| 04 | The orb on the surface | A orb2's eyes, B cut-out eyes, C cut-out eyes in a tile | B |
| 05 | Chrome | A floating pills, B floating + a search pill, C an unfilled bar | A |
| 06 | Rail tile | A 54 / rail 88, B 44 / rail 64, C a 48 circle / rail 72 | A |
| 07 | Composer | A the pill alone, B the pill with a mode line inside, C the mode line under it | B |
| 08 | Calm pass | status A dot / B breathing / C live orb + shimmer; danger A section / B overflow; (i) A outline / B filled / C none; long text A dialog / B focused view | C (A for the agent); B on panes and A on Settings; A; B |
| 09 | Accent and attention | accent A blue / B ink / C brass; attention A amber / B red | A; B |

Not on a board, smaller questions for the owner: Grok's thin usage bar in Settings > Usage (R-data-1 says dots); whether the Typewriter preset should survive as a mod theme; whether "Share" (Grok's third floating control) has a boopis meaning (for example, a session's report).

## 16. After the pick (not started)

1. Replace `apps/desktop/ui/src/styles/tokens.css` from `tokens.v7.json` (two modes), keeping the incumbent names; regenerate `tokens.json`; rebuild the contrast pairs.
2. Restyle the kit component by component (section 12), each with its lab states; fold in the calm pass's pieces; add the string catalogue.
3. Rebuild the shell's chrome (floating controls, rail, pane) and the conversation (bubbles, the activity line, the meta line).
4. Update the lab's matrix (two themes), its token, spacing and roles checks, and add the R-calm checks; retake the goldens.
5. Port the notch and the island's styles from the same tokens (`--r-slab`, the dock ground).
6. Replace `design/v6/design-system/DESIGN-SYSTEM.md`'s role as source of truth with this file (the v6 folder stays as the reference it is).

## 17. The mark: one dashed underline for the whole app

The owner's request (23 November): one standardized dashed-underline animation, part of the design system and the kit, for every place boopis underlines words with dashes. It has three uses, and all three are the same primitive. Preview P3.

| Context | What it is | At rest | Opening it |
|---|---|---|---|
| **Feedforward** (the composer) | while the person types, the agent reads the request and marks the readings and assumptions it would otherwise ask about later; the person changes them inline before sending (`plugins/boopis` feedforward, `docs/ARCHITECTURE.md` "Feedforward, blanks") | **always visible**: that is the feature | the reading's menu (alt+Down or a click, `ui:decision`); Tab reaches the assumptions |
| **Blanks** (a session's reply; sessions only) | while the agent writes, it leaves inline questions the person answers right there, without waiting or sending a new message (`blank.opened`, `blank.filled`, `blank.lapsed`; `rpc/blanks.py`, `docs/PROTOCOL.md`) | **always visible** | the inline answer in the gap (the options, if the blank has any, as a menu) |
| **Info labels** (settings and detail rows) | a term that explains itself; replaces the (i) (the owner's pick 08 Info C) | **hidden**; revealed by hovering its row or card, or focusing the label; shown at rest where there is no hover | the explanation popover |

### 17.1 The primitive

| Token | Value | What |
|---|---|---|
| `--mark-dash` | 3px | dash length |
| `--mark-gap` | 2px | gap between dashes |
| `--mark-thick` | 1px | thickness (one device pixel at 1x; 1px at 2x reads as Grok's hairline weight) |
| `--mark-offset` | 3px | below the baseline |
| `--mark-color` | `--mark-off` (38% / 42%: 3:1) | shown |
| `--mark-color-hover` | `--text-dim`; the word goes `--text-strong` | hover and keyboard focus |
| `--mark-color-open` | `--text` | while its menu, input or popover is open |
| `--mark-color-chosen` | `--accent`, solid | a filled blank, a reading the person chose (`data-confirmed`) |
| `--mark-color-waiting` | `--owe`, dashed, with the countdown chip and "waiting for you" in `--owe-text` | a session's blank waiting (the bot paused) |
| `--mark-color-guess` | `--mark-color` (shown) | a lapsed blank's guess, in the reply |
| `--mark-dur-in` | 180ms | the draw-in |
| `--mark-dur-out` | 120ms | the fade-out |
| `--mark-ease` | `--ease-sharp` | both |

- **One class, data states:** `.ui-mark` with `data-mark="shown | hover | open | chosen | waiting | guess"`, `data-mark-reveal="always | hover"` on its context, and `data-mark-new` for one draw-in. Hover and focus use the pseudo-classes; `hover` as a state is for the lab's forced states.
- **Drawn, not a text decoration:** a dash layer (`repeating-linear-gradient` of `--mark-dash` and `--mark-gap`, `--mark-thick` tall) at `--mark-offset` under the text, `box-decoration-break: clone` so a mark that wraps draws on each line. The width of that layer is a registered `--mark-p` (0 to 100%), which is what the draw-in animates (left to right, per line); WebKitGTK supports `@property` (v6 8.1). Chosen replaces the dashes with a solid line of the same thickness.
- **Appear:** a new mark draws in once (`--mark-p` 0 to 100% over `--mark-dur-in`), then `data-mark-new` is removed. **Disappear:** the layer fades out over `--mark-dur-out` (no reverse sweep), then the class goes. **Hover and focus:** the colour changes over `--dur-1`; the word brightens. **Reduced motion:** every change is instant: a new mark appears whole, nothing sweeps or fades.
- **Feedforward stability:** the composer already redraws its marks only when their signature changes (`components/composer.ts` `markSig`). v7 adds: only a span whose signature is new gets `data-mark-new`; existing marks never redraw or re-animate; a reading arrives at most once per 250 ms pause in typing, so nothing flashes per keystroke; while an input method composes nothing changes.
- **Blank states (the owner's decision, later on 23 Nov), replacing the protocol's current ones:**
  - **Sessions: a blank waits.** The bot is paused and the blank waits inline in the reply for a limited time: the dashed gap (at least 7 characters) in `--owe`, a countdown chip inside the blank (mono 11, `--owe-text` on `--owe-soft`, "0:42", ticking every second; at 10 seconds it does not flash or grow), and "waiting for you" in `--owe-text`. The wait is a setting, Settings > General > Sessions > "Wait for my answer": 30 s, 60 s (default), 2 min. Focus puts the answer inline (the ring, the caret, the blank's options as a menu if it has any); Enter answers, Esc leaves it waiting.
  - **Filled in time:** solid accent under the person's words, in the same reply; the bot resumes from there.
  - **Lapsed:** the time ran out. The bot keeps going on its own guess, which the reply shows in place of the gap with a quiet "(my guess)" and the shown mark; the question stays as a card under the reply (or an end-of-turn question) that can still be answered.
  - **The card a lapsed blank leaves is the AskCard** (section 12.2), the owner's pick for every ask that waits on the person.
  - **Answered late:** the answer in the card turns solid accent and is sent as a **correction** ("sent as a correction"), which the bot takes as its next message.
  - **Blanks are for sessions only.** Bots never leave blanks: a bot asks only through the approvals the owner set up beforehand (the rules engine and its tiers), drawn with the same **AskCard** as a session's lapsed question (below), with no countdown: a bot's approval waits until it is answered.
  - Reduced motion: the countdown changes its digits only; the mark appears whole.
  - **This needs the protocol to change** (`docs/PROTOCOL.md`, `plugins/boopis/exec` and `rpc/blanks.py`): today `leave_blank` returns at once ("the cell goes on"), `blank.lapsed` means "the turn ended unanswered", and a fill after that arrives as the next turn. The owner's decision needs a timed wait on `blank.open` (a `wait_s`, the cell paused), a lapse on timeout carrying the guess the bot went on with, and a late fill marked as a correction. Until the plugin has them, the UI can show only filled and lapsed.
- **Info labels:** the label is a button only where it explains (one tab stop); its row's `:hover` or `:focus-within` reveals the mark (draw-in); hovering the label opens the popover after 300 ms (at once while warm, as tooltips), 8 from the label; Enter or Space opens it, Esc closes and returns focus. Under `(hover: none)` the marks show at rest, and a tap opens the popover.
- **The helper:** `ui.mark(target, { state, reveal, kind, onOpen })` and `html.mark(text, opts)`; components call it, never draw dashes themselves. `ui.markReveal(container, 'hover' | 'always')` sets a context.

### 17.2 What migrates to it

| Today | Where | Becomes |
|---|---|---|
| `.ui-ff` (1px dashed `--text-dim` border, hover `--text-strong`) and `.ui-ff[data-confirmed]` (solid brass) | `components/components.css` 924-927, `components/composer.ts`, `modules/session/composer.ts` | `.ui-mark` (feedforward), chosen in `--accent`; `[data-chip]` and `[data-kind="mention"]` stay capsules, never marks |
| `.ui-blank__gap` (1px dotted `--red`; answered: dashed `--text-quiet`) and its "waiting for you" stamp | `components/components.css` 852-859, `components/html.ts` `blank` | `.ui-mark` (blank): opened, filled, lapsed as above |
| `.cd-token` (dotted `--text-quiet`, expanded solid `--text`) | `modules/cards/cards.css` 108-118, `modules/cards/kinds.ts` | `.ui-mark` (info: an explaining phrase in a card) |
| the (i) of the calm pass (`setRow({ info })`, `icons.ts` `info`) | `components/html.ts`, `calm.ts` | the label as a mark (approved). The (i) stays only for forced colours (`forced-colors: active`, where a dashed background layer is not drawn): there the explained label shows the outline (i) after it. The UI always runs with scripts, so no no-script fallback is needed |
| not marks, kept separate: links (`.ui-link`, `.mv-link`: solid, `--line-strong`), the palette's match underline (`.hx-pal-row__label mark`, R-search-5), the bots glance title's hover underline | | unchanged; their brass becomes the accent where they had it |

## 18. Theme customization

Several picks are "standard, customizable by theme". A theme (a built-in one or one the person makes) can set:

| Setting | Choices | Default |
|---|---|---|
| Accent | any hex. A contrast check derives the rest: `--accent-text` and `--focus` (lightened in OKLab until 4.5:1 on `--bg-3` and `--bg-1` in dark, darkened until 4.5:1 on `--bg-1` in light), `--on-accent` (white, or the inverted ink when white is under 4.5:1 on the fill), and, for marks only, a fill lightened (dark) or darkened (light) until 3:1 on `--bg-2` | the owner's indigo (Iris for now) |
| Corners | B Standard (Grok's radii, continuous) or C Rounder | B |
| Light shadows | A Grok's, B hairline + half, C flat | A |
| Density | compact, regular, comfortable | regular |

### 18.1 A bot's colour in its own chat (the owner's decision, 23 Nov)

- **Default:** in a specific bot's own chat (kai, nina, ...), your bubble and the send button take that bot's colour, as in Grok Bot. Everywhere else, in rooms and in the boopis bot's chat, they are ink (`--bubble-user`, `--selected`). Nothing else changes: the accent stays the theme's, the chrome stays ink.
- **The derived fill** (one rule, both themes, re-read when the bot's look changes): start from the orb's colour. If white text can reach 4.5:1 by lowering its OKLab lightness by at most 0.08, the fill is that darkened colour and the text white; otherwise the fill is the orb's colour as it is and the text is `#121212`. The six mock bots give: kai `#4fc9a8` with ink (9.2:1), nina `#e1274d` with white (4.6:1), moss `#2fd26a` with ink (9.4:1), iris `#2b72e5` with white (4.5:1), hex `#a6a6ab` with ink (7.7:1), nimbus `#9252ec` with white (4.5:1). The boopis bot is never coloured (it is the ink already).
- **Settings:** Settings > Appearance > "Your messages in a bot's colour" (on); off returns to ink everywhere. Per bot, the bot's details pane carries the same switch under its look (cheap: one boolean in the bot's store), which overrides the global one for that bot.
- **R-colour-8 exception, scoped:** that bot's own chat, your bubble and the send button only.

**Fixed by meaning, not by theme:** the attention amber (`--owe`) and the danger red (`--red`). They are the two colours a person must recognise in every theme, on the dock and in the notch; if a theme could move them, "needs you" could look like "failed" or like the accent, and the contrast and colour-blindness checks were made for these two values only. The surfaces and the ink come from the two modes (a mod can still preview a palette through the one theme mechanism, under the readability guard: owner decisions); the dock stays #000.

## 19. Bot session: Grok-Bot parity

The owner's direction (23 November): everything in a bot's session feels like Grok Bot (`GROKBOT-DESIGN.md`, sections 3 and 9, and the recordings), with the picks of section 15.1 on top. The only deviations are the keep list (orbs and faces, the dock, group clusters, the notch decisions) and the owner's picks. Screens 11 (a bot's chat with the details pane and an approval waiting), 12 (a room with the sidebar open and an approval) and 17 (a bot working through a multi-step task) show it. The normal session screen is the next discussion and is not covered here.

| Grok-Bot element | v7 element | Same / differs (why) |
|---|---|---|
| Frameless window, three floating controls, thin window glyphs | floating sidebar toggle, title pill, details button, thin glyphs | same; Share is not offered (boopis has no share meaning yet, 15) |
| Title pill: the bot's avatar and name; opens the details pane | the same, orb 24 | same (orb: keep list) |
| Search: a button at the top of the open sidebar, ctrl K | the clickable "Search ctrl K" hint in the chrome; ctrl K everywhere | differs: the owner's pick P2 (S5) |
| Rail: 54 tiles on 88, current 8%, status badge with a 2.5px ring | the same; compact 44 on 64 under 1200 px | same; the compact rail is the owner's pick 06 |
| Open sidebar: the main bot large at the top, then rows (avatar, name, activity line), groups as an avatar cluster with "@sender message" | the boopis bot large (64) at the top, rows of 36 orbs, name and activity, the room's row as its stack with "@nina ..." | same; the Sessions / Bots switch sits in the sidebar of the session view only (boopis's vocabulary); the rail's group cluster is a keep-list item |
| Needs-you in the sidebar: orange subtitle and dot ("Waiting for you: Approval needed") | amber subtitle and dot ("Needs you: approve a deploy") | same colour (the owner's pick 09 A); boopis's own wording |
| Transcript: a centred column, separators only on gaps, bubbles of 560, one thought per bubble, 6 apart | the same | same |
| Bot bubble 4% + specular, user bubble 18% white (solid ink in light) | the same | same |
| User bubble and send button in the bot's colour ("Accent: Bot color", as the live screens show) | the same in a specific bot's own chat (kai, nina...): your bubble and the send button take the bot's derived fill (18.1); ink in rooms and in the boopis bot's chat | same (the owner's decision, an approved exception to R-colour-8); everything else stays Iris |
| No per-message avatar in a 1:1 | none | same |
| Group: name above the bubble in the bot's colour, the avatar at the bubble's lower left, @mention chips with avatar and name in the bot's colour | the same (name 12 in the bot's colour, orb 20 in a 30 px gutter at the bubble's foot, mention chips) | same |
| A message to you | the "you" capsule and an amber wash | differs: a boopis owner decision (22 Nov), recoloured amber by pick 09 A; Grok has no equivalent |
| Activity line: the live mini avatar and one shimmering phrase; thinking turns the avatar into dots; who is replying in a room | the same (orb 16, shimmer 2.2 s, phrase held 800 ms); stacked orbs for who is replying | same (orb faces: keep list) |
| Acknowledge first, then work | the same in the content (the bot's first bubble says what it will do) | same |
| Tool rows: "Terminal · Ran 1 command", collapsed; expanding shows the reason, the command and "Manage settings" | the same row ("Terminal ran 2 commands", "Read 14 merged pull requests"), collapsed, a chevron; expanded it shows the steps or the command | same; no middle dot (R-copy-4) |
| Multi-step work: only the activity line and tool rows (no plan card) | the same tool row titled by the task ("Release 0.2.0 step 3 of 5") that expands to its step list (done, now, still to do, times); the activity line stays the one status | differs a little: the step list is Part A's "N steps" disclosure, drawn as Grok's expanded tool row; the live step has the pulse, not a second shimmer (R-calm-6) |
| Approval card: tool header, the question, one plain line naming the rule as a link, the command, Not now / Allow; collapses to one row after | the AskCard, approval variant: head (orb, "nina asks", "needs you"), the summary, "Rule: …" linked, Hold to allow once, Allow all this turn, Always allow, Deny (esc); collapses to a receipt row | differs: the owner's pick (the AskCard, 17.1) with the answers of `approval-surfaces.md`; hold to approve is an owner decision |
| Question card: A/B/C letter tiles and "Something else" | the same | same |
| File card: icon, name, size; Open and Save on hover | the same | same |
| Source citations: favicon and site name, underlined | the same | same |
| System line: "Created routine ⏲ name", centred | "Created routine Weekly changelog", centred chip | same |
| Message hover: react, reply, more | copy and more | differs: boopis has no reactions or threads; the trio becomes what exists |
| "NEW" unread separator | the same, in the accent | same |
| Details pane: 64 avatar, the name, Activity / Library, Upcoming (routines with switches), Computer, Voice | 64 orb, the name, Activity / Library, Upcoming, Work (model, spend against the cap, workspace) | same shape; the sections are boopis's data (Part A section 7: model, cap and worktree), shown only when they exist (R-calm-4) |
| Composer: a pill, +, mic, voice-or-send | the same, with the line underneath | differs: the owner's pick 07 C (the line and its toggles) |
| Empty state: the bot greets and asks a question card | the same (the bot's first message and a question card) | same |
| Dock | the black dock | differs: keep list (owner decision) |
| Notch / voice pill | the approved notch | differs: keep list (the notch decisions, now amber per 15.2) |

## 20. Session tab

Session is the hands-on harness, Bots the team that works on its own; one app, one kit. T3 Code's study sets what the Session tab contains (features, flows, states, content); its look is this design system, the same components as screens 11, 12 and 17: the sidebar with its Sessions / Bots switch, the title pill, bubbles, the status line (the model's logo, P4), tool rows, the AskCard, the mark (feedforward and blanks), cards, the details pane, the composer with its line, the dock. The walkthrough, screen by screen, with the logic from the session plan and its owner decisions and where boopis differs from T3 on purpose, is `SESSION-TAB.md`. Screens S1 to S20 are in the boards folder (`ds-v7/session/`, dark and light), with `session-sheet-1.jpg`, `session-sheet-2.jpg` and `session-master-sheet.jpg`.

**The owner's picks on the Session boards (23 Nov):**

| Board | Pick | What it means |
|---|---|---|
| S01 | B, four rows | the scale is four rows, each with its one-line meaning, in the launch card and Settings |
| S02 | B, Auto-accept edits | the default step for new sessions; configurable in Settings > Sessions; onboarding asks for it; a project without a trusted gate falls back to Supervised |
| S03 | A, sections | Needs you, Working, Pinned, Recent, Settled in the session list |
| S04 | A, segmented | This device / This project at the head of a settings page |
| S05 | B, everything, customizable | the composer's line shows how careful, branch, model and effort, context and cost by default; the **quick menu** (the on/off list) opens from the composer's + or a click on the line, turns items off per composer kind, and is the same list as Settings > General > Under the composer; under 900 px the branch and the context fold into the quick menu first |
| S06 | B, Enter queues | sending normally while a turn runs puts the message in the engine's queue; ctrl Enter steers; the placeholder reads "Queue a message, or ctrl Enter to steer" and the hint "Enter queues, ctrl Enter steers" |
| S07 | A, four fixed tabs | Diff, Files, Terminal, PR; a side chat joins while open |
| S08, S10, S11, S13 | approved | |
| S09 | approved, branded | the agent's messages and cards carry the model's brand: the provider's mark in a 22 px tile at the lower left of the last bubble of a run (the gutter, where a bot's orb sits in a room), and at the head of every agent card (tool rows, approvals, the AskCard); all agent-side blocks sit in that 30 px gutter |
| S12 | approved, DiffView fixed | the DiffView is one grid (a 36 px line-number gutter, a 16 px sign column, the code); the comment box starts on the code column; the card's padding is symmetric (12 px sides, no extra inset around the hunks) |

**Arranged as the Bots tab's boards** (folder `ds-v7/session-boards/`, with `contact-sheet.jpg`):

| Board | What it decides or shows | Recommended |
|---|---|---|
| S01 | the permission scale: A one segmented track, B four rows | B (picked) |
| S02 | the default step for new sessions: A Supervised, B Auto-accept edits, C Full access | B (picked) |
| S03 | the session inbox: A sections in the list, B filter chips | A |
| S04 | the settings scope: A segmented in the page head, B a select beside the title | A |
| S05 | the composer's line in a session: A how careful, branch, model, cost; B everything; C off | B (picked) |
| S06 | while it runs: A Enter steers (ctrl Enter queues), B Enter queues (ctrl Enter steers) | B (picked) |
| S07 | the right panel: A four fixed tabs, B opened surfaces only with + | A |
| S08 to S16 | component boards, each component in its states, dark and light, tagged new for approval: launch; the turn and approvals; work log, changed files, checkpoint; queue and steer; right panel, diff, terminal; commit; inbox; limits and lines; scope picker | |
| S17 to S40 | key screens with the recommended picks: empty tab, import, launch, running Supervised, blank waiting, steer and queue, finished turn, Diff, Files, Terminal, PR, side chat, commit, inbox, / commands, @ files and $ skills, settings changed, usage limits, after a restart, three errors, Settings > Sessions, the session's details | |

**New components for approval** (each in v7's language; specs in `SESSION-TAB.md`; section 21 merges most of them into the one kit: QueueStrip into Queue, SettingsLine and SteerLine into SystemLine, LimitNotice into Notice, ScopePicker into Segmented, InboxSections into SectionHead and ListRow, ReferenceChip into InlineChip, CheckpointBar into TurnFoot, WorkLog into Disclosure, Terminal into Well, LaunchCard retired): LaunchCard, PermissionScale, ToolRow with an inline approval, WorkLog, ChangedFilesCard, CheckpointBar, QueueStrip, SteerLine, RightPanel (tabs Diff, Files, Terminal, PR, Side chat), DiffView with an inline comment, ReferenceChip, Terminal, CommitDialog with a split primary action, InboxSections, SettingsLine, LimitNotice with the context tick, ScopePicker.

### 20.1 The new session (S41)

The owner kept the v7 layout of the new-session screen (title pill, search hint, details, the composer and its line, the dock, the sidebar) and asked for better content in its empty canvas. Board `S41-new-session.jpg` offers four brand marks; only the canvas changes between them.

| Option | The mark | Note |
|---|---|---|
| **A (the owner's pick, 23 Nov)** | the "oo" logomark: the wordmark's two eyes, large, with the logo's own idle (glance, blink), looking at the composer while you type, asleep with no model | calmest and most branded; says boopis, not who answers (the model's brand stays on the agent's messages and cards, S09) |
| B | the boopis orb, alive: idle, looks at the composer while you type, asleep with no model | most characterful; suggests boopis's bot does the work, which is the model's |
| C | the model's logo breathing in a tile (P4's breath); an empty dashed tile with no model | ties to P4 and the S09 brand; loses boopis's face |
| D (was the recommendation, not chosen) | the orb wearing the model: the boopis orb with the model's mark on its shoulder (the S09 gutter tile, 24 px); asleep and a + tile with no model | both facts at once: boopis is the place, the model answers; the tile is the S09 component |

What the canvas holds, the same in every option: the mark; a line in the boopis voice ("What's next for boopis?", plain text: no mark at rest, section 17); the **launch row** of quiet selectors (folder, worktree, model, effort, how careful; the last opens the four S01 rows); **Waiting on you**, the inbox row in its one-line variant; with no model, a kind inline action (the model selector reads "+ Choose a model" in the accent, and a Block offers Claude, ChatGPT, Gemini, More; never a red row); and above the composer the **Notice** (S15's component) for usage ("Approaching the weekly limit, 81% used, resets Wed 09:00 · Get more usage · ×"). The launch row and the composer's line are the same selector item: before a session starts the items sit in the canvas and the line under the composer names the keys ("Enter starts the session", "ctrl Enter starts it in the background"); when it starts they settle into the line (200 ms, `--ease-sharp`). No folder yet: "Add a folder to start" with Add a project and Import sessions under the same mark.

**The A mark, specified for the kit** (`<boopis-logo mark>`, the shipped element; numbers are its own constants, so the build uses the element and sets nothing by hand):

| Aspect | Spec |
|---|---|
| Size and colour | the symbol at a type size of 44 px (the eyes are as tall as an o at that size, about 32 px wide for the pair), `--text-strong`, centred in a 72 px box, 16 px above the greeting |
| Idle glance | the logo's calm idle director: a new gaze target every 1.8 to 2.6 s (uniform), yaw within ±0.255 rad and pitch within ±0.17 rad (85% of its cap, ±0.30 / ±0.20), a body roll within ±0.08; the eyes travel to it on the element's own easing; the pointer is not followed (no `look` attribute) |
| Blink | the orb's blink envelope, 155 ms, into its wide capsule (an eye may widen by at most 30%); the next blink 2.1 to 5.7 s after the last (uniform); 24% of blinks are doubled, the second 210 ms after the first |
| Looking at the composer | on the first keystroke in the composer, `look(0, -1)`: the eyes turn down to the composer (pitch −0.20 rad, the cap) and hold while typing continues; blinks go on; 1.2 s after the last keystroke, or when the composer empties, `look()` lets go and the idle director resumes; focus alone does not move them |
| No model | `state="sleeping"`: the bots' sleeping face (closed, drooping eyes, the slow sleep motion); no glances, no blinks; when a model is signed in, `morph('happy')` (380 ms), held 1.2 s, then idle |
| No folder | the same idle as ready |
| Reduced motion | the element's own handling: no blink, no travel; a state change cross-fades in 150 ms (`--dur-1`); looking at the composer is a single cross-fade to the down gaze and back |
| Leaving | when the session starts the canvas leaves with the launch row settling into the composer's line (200 ms, `--ease-sharp`); the mark fades out in 120 ms, it does not travel |

Screens with A: S17 (the new session, with the usage notice), S19 (the launch step: the permission selector open), S37 (no model yet, the mark asleep), S18 (import, over the no-project canvas) and S41-no-project. The other Session screens are approved (23 Nov).

### 20.2 Owner-found defects of 23 Nov, fixed systemically

- **S32**: "webapp-testing" wrapped and the row ran past its edge. Every menu row now uses `.nm` (never wraps or shrinks) and `.ds` (truncates); R-row-1; the QA `row` rule.
- **S36**: "Start it again" overflowed the 26 px line pill and broke the corner. The line pill with an action (`.sysline.act`) is 32 tall with the button on a 3 px inset (16 − 3 = 13); R-corner-10; the QA `concentric` rule.
- The concentric check found the same fault in 13 more places; all fixed by the Block (radius 22, padding 8, 28 px controls): tool rows, changed files, AskCards, approvals (the "Hold to approve" button is 28 in a Block), the queue (rows 18 on a 4 inset), the limit notice (now `.notice`), the composer's mode chips (26 → 28), the held strip, the dock's approval card, the search pill's kbd (a pill), the details pane's rows (14 px sides), and the rounder radii option C (menu 18, card 16, composer 22).

**Approved items this changes:** S09 and S20 (the tool row's "Waiting for you" capsule becomes a word; tool rows, AskCards and approvals are Blocks), S15 and S34 (the limit notice is the Notice), S17, S19 and S37 (replaced by S41's content with A, the owner's pick), S39 (Enter while it runs reads Queues, How careful reads Auto-accept edits, per S06 B and S02 B), S40 (How careful reads Auto-accept edits).

## 21. The kit

The owner, 23 Nov: one app, one kit, no redundancy between tabs; consistency throughout goes over any single approved board. This section is the inventory: every v7 component once, with its variants, states, tokens and the screens that use it. Where two components did the same job they are merged below; **a merge wins over an approved board**, and 21.3 lists what that changes. `docs/UI-COMPONENTS.md` becomes this table when the kit is built; LAB-v7.md is its lab plan.

**Inventory size:** 69 named components before (section 12's 6 live surfaces and 24 blocks, section 20's 17 Session components, and 22 more named only on boards: the mark, the blank, the InboxChip, the dock, the notch, the rail tile, the search hint, the segmented control, the select, the banner, the update notice, the brand tile, the badge, the stamp, the word, the quick menu, the bot row, the session row, the well, the routine line, the activity line, the reply's meta row); **42 after**, plus 5 patterns that are compositions, not components.

### 21.1 Foundations (apply to every component)

Tokens (`tokens.v7.json`); the three-step type and alpha hierarchy; R-corner-1 to 10 (section 8.2, strict since 23 Nov: a control in a corner has radius = outer − inset, equal insets, never past the edge); R-row-1 (rows are single-line); R-inline-1 (inline chips sit on the baseline); R-calm-1 to 7 (section 11); motion tokens; the mark primitive's behaviour (section 17). The lab checks each of these on every story (LAB-v7.md).

### 21.2 The components

| # | Component | Purpose | Variants | States | Tokens | Used on |
|---|---|---|---|---|---|---|
| 1 | **WindowChrome** | the floating chrome: title pill (opens details), search hint, details button, window controls | rail A 54/88, compact B 44/64 (under 1200 px) | default, hover, focus, title running (StatusLine inside) | `--bg-3`, `--line`, `--chrome-y`, 36/40 heights | every tab |
| 2 | **Page** | the ground and its 640 column, or a settings page | column, settings page (head: title + Segmented scope) | empty (EmptyState) | `--bg-2`, `--column` | Bots, Session, Settings, Store |
| 3 | **Pane** | the right-hand surface; one per view | details (356: bot details with Activity / Library, session details), tools (520, resizable: Diff, Files, Terminal, PR, + Side chat while open) | open, closed, overlay under 900 | `--bg-pane`, hairline, `--shadow-modal` overlay | Bots, Session |
| 4 | **Dialog** | a modal task | large (Settings: 900, nav 220), form (440 to 520: commit, import, new bot, confirm) | enter 200 ms, scrim, close 28 at 10 (a capsule, R-corner-9) | `--r-dialog` 20, `--bg-3`/`--bg-pane` | Settings, Session, Bots |
| 5 | **Menu** | every popover list | menu, quick menu (checks), palette (/ @ $), snooze, split-button menu, option menu (the four permission rows) | one open at a time, enter 100 ms from .98 | `--r-menu` 16, `--pad-menu` 6, rows `--r-field` 10 | all |
| 6 | **Card** | the settings card of Rows | settings, pane card (rows 14 across), danger zone (collapsed) | — | `--r-card` 14, padding 4/8 0, rows 16 across | Settings, Pane |
| 7 | **Block** | every inline surface that holds controls; the base of 8 to 12 | — | — | `--r-block` 22, `--pad-block` 8, 28 px controls on the 8 inset, text 4 more | Bots, Session |
| 8 | **ToolRow** (merged: Bots' tool rows + Session's ToolRow) | one tool call | edit, command, read, search | running (shimmer), done, failed (red word), waiting (an attached AskCard) | Block, mono 12 head, the model mark at its head | Bots, Session |
| 9 | **AskCard** (merged: AskCard + ChoiceCards + the ToolRow's inline approval) | everything that waits on the person's answer | standalone (bot approval, never expires), attached (inside a ToolRow: the approval answers), question (chips), choices (lettered option rows, 36, radius 14), lapsed blank (the guess) | asked, needs you (amber word), answered (collapses to one row), lapsed | Block, chips 28, rows 22 − 8 = 14 | Bots, Session, Notch |
| 10 | **FilesCard** | a turn's changed files | collapsed, open | — | Block, `.fl` rows 26 mono | Session |
| 11 | **Queue** (merged: QueueStrip + the room's "1 message waits" strip) | messages waiting to be sent, above the composer | list (the engine's numbered queue: edit, cancel, Send now), held (one row: "1 message waits until the discussion ends", Send now) | — | Block radius 22 on a 4 inset, rows 36 radius 18, buttons 28 on 4 | Session, Bots rooms |
| 12 | **Notice** (merged: LimitNotice + Toast + Banner + the update notice) | one line that tells the person something about the app, with up to two actions | placement: above the composer, in a page, floating (bottom centre, was the toast); tone: neutral, amber (limited, owes), accent (updated, info), red (failed) | enter 120 ms, dismiss (×) | a 44 pill, `--pad-block` 8, buttons 28 | all |
| 13 | **SystemLine** (merged: SettingsLine, the restart line, the engine-stopped line, SteerLine, the routine line, the hand-off row) | a centred line in the thread about the thread itself | info (settings changed, continued after a restart, a routine ran), steer (with the steering message as a small bubble), hand-off (two 16 orbs and a chevron), error with action (`.act`: 32 tall, the button on a 3 inset) | — | a pill, `--fill-2`, 26 (32 with an action), 12 | Bots, Session |
| 14 | **Bubble** | a message | user, agent, bot (derived fill in its own chat), with byline in a room, with the you wash | — | `--r-bubble` 18, padding 7 12, 15/22 | Bots, Session |
| 15 | **DiffView** | hunks of a change | stacked, split; with an inline comment | — | one grid 36 / 16 / code, comment on the code column, 12 sides | Session |
| 16 | **Well** (merged: the well + the Terminal) | mono text on the deepest surface | code (in a Block or a bubble), terminal (fills the tools pane, path and branch in its head) | — | `--bg-0`, `--r-field`, mono 12/18 | Bots, Session |
| 17 | **ListRow** (merged: the session row, the bot row, the Item row, the waiting rows) | one item in a list | session (44, two lines), bot (54, orb 36), item (60, a 40 mark, the action a 28 pill), compact (36, one line: S41's Waiting on you) | default, hover, current, needs you (amber badge), working (dot) | `--r-field` 10, `--current`, `--hover` | Bots, Session, Store, S41 |
| 18 | **SectionHead** (merged: InboxSections' heads + the bots sidebar's day heads + the settings section heading) | a heading over rows | with count, with disclosure | collapsed | 12 `--text-dim`, count mono 11 | all lists |
| 19 | **MenuRow** | a single-line row in a Menu | glyph + name, name + description (`.nm` / `.ds`), with kbd, danger | hover, focus | 32, padding 6 8, R-row-1 | all Menus |
| 20 | **OptionRow** | a two-line radio row | permission step, import pick | chosen (accent ring), hover | `--r-field`, ring 16 | Menus, Settings, S41 |
| 21 | **Button** (merged: the split commit button is a variant) | an action | secondary, primary, ghost, tint, danger, split (primary + menu) | hover, pressed, focus, disabled, hold-to (fill sweep) | 36 / 32 / 28, pills | all |
| 22 | **IconButton** | an action with a glyph | floating 36, tinted 28, ghost (window controls) | as Button | circles | all |
| 23 | **Segmented** (merged: ScopePicker, the Pane's tab bar, Activity / Library) | one of a few | inline, page head (scope), tab bar | chosen thumb, hover, focus | `--seg-on`, track `--fill-2`, nowrap | all |
| 24 | **SelectorItem** (merged: the composer line's items, S41's launch row, the settings select) | a quiet current value that opens a Menu | line (12, under the composer), launch (13, in the canvas), field (in a Row) | hover (6% fill), open | `--r-field`, `--text-dim` | Session, Bots, Settings |
| 25 | **Switch** | on or off | — | on (accent), off, focus, disabled | 32 × 20 | Settings, quick menu |
| 26 | **Field** | text input | text, search (a pill), multi-line | focus ring, error, disabled | 36, `--line-field` | Dialogs, Settings, palette |
| 27 | **Kbd** | a key | in text (radius 4), in a pill (a pill) | — | 20 tall | all |
| 28 | **Chip** | a compact choice | answer (in an AskCard), filter, mode (composer B) | chosen (inverted), hover | 28 pills | Bots, Session |
| 29 | **Tooltip** | a name and its keys | — | enter after 500 ms | `--r-tip` 6 | all |
| 30 | **InlineChip** (merged: ReferenceChip, mention, the you capsule, inline code, the model chip, a blank's countdown) | a chip in running text | mention (16 orb + name in the bot's colour), you (amber), reference (mono `path:line`), code, model (mark + name), countdown | — | R-inline-1 | Bots, Session, composer |
| 31 | **Mark** | the dashed underline primitive (section 17); shown at rest only for feedforward (the composer's text, a reply's guess) and blanks, never in headings or static text | feedforward, blank (opened, filled, waiting, lapsed), info label (hover and focus only) | shown, hover, open, chosen, owed | `--mark-*` | Bots, Session |
| 32 | **StatusWord** (merged: the stamp + the word) | a status said in words | neutral, amber (needs you), red (failed), ok | with a dot, with a pulse | 12 | Blocks, rows |
| 33 | **Badge** | a count or a short status at the end of a row | neutral, amber | — | 18 tall pill, 11 | ListRow only |
| 34 | **StatusLine** (merged: the bot activity line + the session status line) | what a job is doing now | bot (16 live orb), session (the model mark breathing), system (phrase alone) | working (shimmer), waiting (still), reduced motion | 2.2 s shimmer, 1.4 s breath | Bots, Session, title pill |
| 35 | **Avatar** (merged: the orb, the brand tile, OrbStack, the logomark) | who speaks, or whose place this is | orb (16 to 64, faces), brand tile (22, the model's mark), stack (overlap a third), logomark (S41 A: the oo eyes, 44) | idle, working, needs, sleeping | orb2 | all |
| 36 | **Disclosure** (merged: WorkLog) | a collapsed summary | steps ("Read 6 files"), work log ("Worked for 59s: ...") | open, closed | 13 `--text-dim`, chevron | Bots, Session |
| 37 | **TurnFoot** (merged: CheckpointBar + the reply's meta row) | under a finished reply: model, time, cost, and what can be done | bot (meta only), session (Undo, Edit from here, Fork) | hover reveals actions | mono 12, ghost 26 buttons | Bots, Session |
| 38 | **TimeSeparator** | a gap in time | — | — | 12 `--text-dim` | Bots, Session |
| 39 | **Composer** | the place to type | kinds: session, bot, room, dock, notch; with its line (items are SelectorItems; the quick menu is a Menu) | empty, typed, running (Enter queues), held | 44 pill, `--composer-pad` 8 | all |
| 40 | **Rail** | the bots' tiles | A 54/88, B 44/64 | current, needs you, working | `--r-tile` | Bots |
| 41 | **Dock** (v7 pass, 23 Nov: 21.4) | reaching your bots and their asks while you work hands-on; in the Sessions tab only, once you have a bot of your own | one component, three geometries: row (640 × 72), compact (380 × 48, a setting), open (640, its height fits the stack or a card) | needs you (amber flag and the ask pill), working, resting | `--r-slab` 30, the dark theme inside, content on an 8 inset (30 − 8 = 22, the Block) | Sessions |
| 42 | **Notch** | the notch's own surface (notch spec) | — | — | `--r-slab` 30 | system |
| — | **EmptyState** | one line and at most one action where content would be | — | — | — | all (counted in Page) |

**Patterns** (compositions of the above, documented, not new components): the Settings page; the new session's canvas (S41: the logomark, the greeting, SelectorItems, ListRow compact, Notice); the setup form (merged: LaunchCard + the new-bot form: Rows with SelectorItems and the four OptionRows, in a form Dialog for a bot, in the canvas for a session); the danger zone; the long-text editor.

### 21.3 Merges, and what they change on approved boards

| Merge | Into | What changes on screen |
|---|---|---|
| Bots' tool rows, Session's ToolRow | ToolRow | Bots' tool rows become Blocks (radius 22, padding 8) with the model mark at the head (screens 11, 12, 17) |
| ToolRow's inline approval, AskCard's approval, ChoiceCards | AskCard (attached, standalone, question, choices) | the question card's lettered options become 36 rows with radius 14 inside a Block (board 09's sample, screen 11); the inline approval is the attached AskCard: same chips, same amber word (S09, S20) |
| QueueStrip, the room's held strip | Queue | the room's "1 message waits" strip becomes a one-row Queue Block above the composer (board 07's room sample, screen 12 with a held message) |
| SettingsLine, restart, engine stopped, SteerLine, routine, hand-off | SystemLine | the hand-off row becomes a SystemLine pill with its two orbs (screen 12) |
| LimitNotice, Toast, Banner, update notice | Notice | the toast becomes the floating Notice, a 44 pill (board 03); the settings banner becomes an in-page Notice, accent tone (board 09, screen 14); S15 and S34 already moved |
| ScopePicker, the Pane's tabs, Activity / Library | Segmented | names only; no visual change |
| InboxSections, the bots sidebar heads, settings section heads | SectionHead | the bots sidebar's day heads take the count style (screen 12, 13) |
| Session status line, bot activity line | StatusLine | none (already one class; P4 applies) |
| ReferenceChip, mention, you, code, model chip, countdown | InlineChip | none (R-inline-1 already applied) |
| CommitDialog, form dialogs | Dialog (form) + Button (split) | none |
| LaunchCard, new-bot form | the setup pattern | LaunchCard retired; S19 now shows S41's launch row (done) |
| session row, bot row, Item row, waiting rows | ListRow | none |
| stamp, word | StatusWord | the tool row's "Waiting for you" capsule became a word (S09, S20; done) |
| CheckpointBar, the reply's meta row | TurnFoot | the bot reply's meta row takes TurnFoot's spacing (screen 10) |
| well, Terminal | Well | none |
| composer line items, launch row, settings select | SelectorItem | none |
| orb, brand tile, OrbStack | Avatar | none |

### 21.4 The dock, v7 (owner, 23 Nov)

**The owner's decisions:** the dock with the bots appears only in the **Sessions tab**, never in the Bots tab (there the bots live in the sidebar and rail); **"+ new bot" is removed** (new bots are made in the Bots tab); the dock gets a full pass for the kit. Boards and screens: `ds-v7/dock-boards/` (D01 to D03 with the picks, DK1 and DK2 components, K01 to K09 key screens dark and light, `contact-sheet.jpg`).

**What it is for now.** Reaching your bots and their asks while you work hands-on in a session: who is working, who needs you, answer an ask, say a word to a bot, and go back to the session. Everything else a bot has (its settings, routines, library, the full chat, new bots) is in the Bots tab, one click away.

**Inventory of today's dock** (`apps/desktop/ui/src/modules/dock/`, the lab's `dock/dock` stories, `docs/UI-COMPONENTS.md`), and what v7 does with each:

| Today | v7 |
|---|---|
| Rest: the row of 40 px orbs with "+" (normal mode) | **kept**, without "+": the row, orbs 40, gap 14, the slab 72 tall (DK1) |
| Hover: Grow on hover (magnification), a tooltip above the orb | kept: 52 / 46 / 40; the tooltip is **replaced** by the row's end slot naming the bot and its state in words (a tooltip would cover the composer's line 24 px above) |
| Focus, roving keys | kept: the Iris focus ring; arrows move along the row |
| The attention flag on an orb | kept: the amber dot (`--owe`) ringed in the slab's black; the state in words in the end slot |
| Expanded mode: the full roster (120 bots, scrolling, "All bots", the "New bot" row) | **removed** (the Bots tab's sidebar and rail are the roster); many bots: D01 |
| Minimal mode: a pill with a page's summary ("2 need you", "All clear", the run's time) | **replaced** by the compact geometry (D02 A+, a setting, off by default) |
| Pages: Bots, Run, Needs you, Scheduled, Context; the page nub; swiping with the sides fading | **the dock is one page**: Run and Context **removed** (the session shows them itself: the title pill, the status line, the composer's line, the details); Scheduled **removed** (routines are the Bots tab's); Needs you becomes the ask pill and the stack (D03); the nub and the edge fades remain only in D01 A or C |
| Arrange mode ("Dock pages": shown or hidden, move left or right, Done, Turn off the dock) | **removed** with the pages; turning the dock off stays in Settings > General ("Show the dock") |
| "Keep the dock centred in the window" | kept, in Settings > General: centred on the window, or on the session's column (K07) |
| An approval in the dock (hold to approve) | the **AskCard approval variant** (a Block): the bot's ask, its command in a Well, "Hold to allow once" (inverted chip with the hold sweep), "Always for staging", "Deny esc"; never expires |
| A bot's session in the dock (card: head, log, asks, composer, the strip of mini orbs to switch) | a **bot's card**: the head (28 orb, name, StatusWord, "Open in Bots", close), the log as Bubbles (your bubbles in the bot's derived fill, section 18.1), its AskCard, a bot Composer (44 pill); **the strip is removed**: the row stays under the card as the switcher, the open bot marked by the Iris dot |
| Bubbles and replies (the log's entries and your request bubbles) | Bubbles (R-bubble-1): the bot's on `--bubble-agent`, yours in the bot's fill with its text colour |
| An empty dock (no bots; or no bots and no session) | with no bot of your own (boopis alone does not count) the dock is **not drawn** in the Sessions tab, and the composer sits 24 px from the bottom (K06); the session part (Run, Context) no longer exists, so a session alone never draws it |
| Many bots | D01 B (picked): the ones that matter now, then "N more" to the Bots tab |
| The dock while a session runs | the row at rest under the composer; the slab rises over the session only to show the stack or a card, and the session's composer steps aside (fades out in 120 ms, focus in the dock) until Esc |
| Arrival and departure (the first bot raises it, the last takes it away) | kept; the slab's spring, unchanged |

**Removals (everything that duplicated the Bots tab or the session):** "+ new bot" in the row and the roster's "New bot" row; the expanded roster ("All bots", 120 bots scrolling); the Run page; the Context page; the Scheduled page (with Run now and Pause); the Needs-you page as a page; the page nub and paging (unless D01 A); Arrange mode and its "Dock pages" tiles; "Turn off the dock" inside the dock (Settings keeps it); minimal mode's run and context summaries; the card's strip of mini orbs; the orb tooltip; the dock in the Bots tab, in Settings over the Bots tab and in the Store (screens 11, 12, 14 and 17 lose it; screen 16 is now the Sessions tab with a bot's card).

**The owner's picks (23 Nov):** D01 **B** (the ones that matter now, then "N more" opening the Bots tab); D02 **A**, the full row at rest, **plus a compact idle version** (a setting, off by default); D03 **C** (the amber ask pill at the row's end, opening the stack). K01 and K02 approved. D01 C was dropped from the board once B was picked.

**One component (the owner, after D01 showed a different slab in every option: "something as egregious as that never goes to production").** Every board, component board and screen draws the dock through one function (`slab()` in `dockv7.js`, the kit's `Dock` when built) from one set of tokens (`tokens.v7.json` `dock.geometry`):

| Geometry | Width × height | Corner | Flares | Padding | Orbs | Gap |
|---|---|---|---|---|---|---|
| row | 640 × 72 | 30 (continuous) | 30 | 30 (= the corner: nothing sits in a corner zone) | 40 (hover 52, neighbours 46) | 14 |
| compact | 380 × 48 | 24 | 24 | 24 | 24 | 8 |
| open (stack, card) | 640 × its content + 72 | 30 | 30 | content on an 8 inset (30 − 8 = 22, the Block) | the row below, as in row | 14 |

The width is fixed, not fitted to the content: what changes between states is only the content, and the open slab's documented growth. The content is clipped to the slab's own path, so nothing (an edge fade, a grown orb) can paint outside its curve. The render QA's `same-component` rule fails any drift.

**Compact when idle** (Settings > General, "Compact dock when idle", off by default): after 10 s with nothing needing you, while you type or read, the row eases to compact (200 ms, `--ease-sharp`): the bots that matter at 24 px and the ask pill small. A hover, ctrl J or a new ask brings the row back the same way.

**Hidden until you have a bot of your own.** boopis alone does not count (the owner: "showing it with just the boopis bot there looks bland"). With no own bot there is no dock and the composer sits 24 px from the bottom (K06). **First appearance:** when the first own bot is created, the composer moves up to its 96 px place (200 ms, `--ease-sharp`), then the slab rises from below the window's edge (200 ms, `--ease-sharp`, the existing arrival spring) and the orbs pop in left to right (100 ms each, 40 ms apart, from scale .98); the new bot's orb blinks once as it lands. Reduced motion: the dock cross-fades in (150 ms). **If every own bot is deleted:** an open stack or card closes first, the slab sinks (200 ms) and the composer moves back down to 24 px; boopis stays in the Bots tab.

**The bots in the dock (ORBS.md, w31/bot-character):** the owner's decision (23 Nov, replacing the earlier "lively" note): **at idle the dock's bots hold the same fixed sideways three-quarter pose as the Bots tab's sidebar**; a hovered bot comes alive smoothly (turns face-on, blinks, idles) and settles back to the pose when the pointer leaves; a bot in a state (working, needs you) animates its state. The exact pose and the transitions land in ORBS.md section 23; until then the boards draw a provisional pose (yaw 32°, pitch 4°, one constant in the dock's source), and the stills follow section 23 when it lands. The main chat stays fully animated. Stills draw the dock at rest (the sweep rule). The sharp renderer (the canvas snapped to device pixels, drawn at its own size: no 2x render scaled down; C1 to C3, C6, C7, C9, C10); face-scale 1.25 (for every orb of 44 px and under, in the dock and everywhere); the dock row stays 40 px (ORBS.md keeps the dock at 40); a bot that posts blinks. The earlier plan to have dock orbs look at the composer while you type is superseded by the fixed pose. boopis is not special in the dock: it is one of your bots, ordered like the others (needs you, working, pinned, recent).

**Changes the kit made necessary (flagged):** the inside of the slab is the dark theme in both modes (`data-theme="dark"` on the dock's content), so its components use tokens instead of the hand-set `#f5f5f5` alphas (R-colour-1); content sits on the slab's 8 px inset, which makes Blocks inside it concentric with the slab's 30 px corners (R-corner-10); the slab grows to fit an open stack or card (its height follows its content, the path redrawn). The black, flush slab with its flares is unchanged.
