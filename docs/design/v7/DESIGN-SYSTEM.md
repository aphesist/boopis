# boopis design system v7 (proposal)

Status: **proposal for the owner**, 23 November 2026. Invariant 8: the owner designs the UI. Nothing in `apps/desktop/ui` changes until the owner picks the options in section 15; after the pick, this file replaces `design/v6/design-system/DESIGN-SYSTEM.md` as the source of truth and the kit is restyled from it.

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
| `--accent` | board 09 A (recommended): the switch on, the chosen option, progress. A fill, never text | `#116dd2` | `#1680f3` |
| `--accent-text` | links, the info banner | `#4d9bff` (6.6:1) | `#0b6dd3` (5.1:1) |
| `--accent-soft` | the info banner, text selection | accent 7% | accent 7% |
| `--focus` | the 2px focus ring | `#4d9bff` | `#0b6dd3` |
| `--red` | board 09 B (recommended): what the person owes (dots, stamps, the "you" capsule's ring), failed, a destructive confirm | `#cf2b35` | `#cf2b35` |
| `--red-text` | "needs you", "failed", error lines | `#ff6463` (6.5:1) | `#c4232f` (5.6:1) |
| `--warn` / `--warn-text` | a warning that is not owed (board 09 A would make it "needs you") | `#c8770c` / `#e28600` | `#c8770c` / `#b25e00` |
| `--ok` / `--ok-text` | online, connected, passed | `#0e9f5a` / `#00ba69` | `#0e9f5a` / `#087a43` |
| `--add` / `--del` | diff counts | `#00ba69` / `#ff6463` | `#087a43` / `#c4232f` |

**Bots' colours are data** (R-colour-8 kept): an orb's colour stays the orb's. Two named uses join the card ring: a bot's name above its bubble in a room, and its @mention chip, take the bot's colour (Grok 9.3). The boopis bot is the theme's ink (owner decision 1).

### 4.4 Contrast

The pairs table of v6 5.4 is rebuilt for two themes and the dock from these values (`build-tokens.mjs --report` after the pick). Measured now: ink on every surface 12.8 to 17.7:1; `--text-dim` 6.5 to 7.9:1 dark, 5.1 to 5.5:1 light; `--text-quiet` 4.9 to 5.7:1 dark, 3.5 to 3.7:1 light (hence placeholders only); `--mark-off` 3.2 to 3.4:1.

## 5. Theming

- **Theme:** Follow system, Light, Dark (Grok's three).
- **Accent:** Blue (default), Ink, or (owner's call on board 09) Brass. Grok's "Bot colour" accent is not offered: an orb's colour never becomes interface colour.
- **Size:** Default, Larger, Largest (owner decision: the web view's zoom).
- **Density:** compact, regular (Grok's), comfortable; moves `--row-h`, `--row-h-2`, `--ctl`, `--ctl-s` only.
- **Mods** keep their theme preview and readability guard (owner decisions), mapped onto v7's roles.

## 6. Typography

**Families** (board 01): **A Geist** (recommended: SIL OFL 1.1, already bundled as `@fontsource/geist`), B Inter (SIL OFL 1.1), C Figtree (SIL OFL 1.1). Mono is Geist Mono (SIL OFL 1.1) in every option. Licences are checked: all three families and Geist Mono are SIL OFL 1.1 (the files' own LICENSE texts are in the boards' `src/fonts/`). Grok's XVF is proprietary and is not used or shipped.

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
| Top chrome | no bar; a 56 px drag region; floating controls at y = 10: the sidebar toggle (36 circle) over the rail, the title pill centred on the column (orb 24 + name; opens the details pane), search and details (36 circles), thin window glyphs (board 05 A) | a 40 px frame bar with back, forward, the command field and toggles |
| Rail (sidebar collapsed) | 88 px, `--bg-1`, 54 px tiles (radius 12, orb 36, the current one 8%), the attention flag with a 2.5 px ring; groups as their cluster under a hairline; New bot, Store and Settings at the foot (board 06 A) | 56 px, orbs 24 on x = 28 |
| Sidebar (open) | 300 (resizable 88 to 400), `--bg-1`; the Sessions / Bots pill at the top; bot rows 54 (orb 36, name 14, activity 13 at `--text-dim`, gap 10, radius 12); "Groups" heading 12 `--text-dim`; you, Store, Settings at the foot | clamp(256, 15vw, 288) |
| Conversation | column 640 centred on the ground; bubbles up to 560; a time separator only on a gap ("Today 10:05", 12 `--text-dim`) | 720 column with a 112 call-number margin |
| Composer | centred, min(720, column + 80), 16 above the dock (board 07) | the column's width |
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
| a well in a conversation card | 18 | 8 | 10 |
| a piece in a settings card | 14 | 8 | 6 (the floor) |
| the orb in a rail tile | 12 | 9 | a circle |
| the notch's composer in its shape | 30 | 12 | 18 (= the bubble radius) |
| the send in the notch's composer | 18 | 6 | 12 |

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

- **Eyes on a Grok-style surface** (board 04): **B (recommended)** gives orb2's eyes the colour of the surface behind the orb (read on `hx:theme`, R-theme-5), so they read as cut out, as Grok's characters' are. On dark surfaces A and B look alike; on light surfaces and tiles B's eyes go white.
- **The boopis bot:** the `squircle` shape (the reserved `boop` shape when it ships), coloured with `--text-strong`, so it is light ink on dark, dark ink on light, and light on the black dock; its eyes are the ground. It reads as the logo given a body.
- **The activity line** (R-status-1): the working bot's 16 px orb, live, beside one phrase in `--text-dim` at 15, swept by the shimmer; in a room, the stacked orbs of everyone replying ("kai and moss are replying"). Thinking turns the orb to its dot-grid eyes (orb2's `thinking`).
- **The attention flag:** an 8 px `--red` dot with a 2.5 px ring of the surface, bottom-right of a tile; always with words in the row ("Needs you: approve a deploy") so colour is never the only cue (Grok gap 2).

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
| **Row** | settings: label 14, optional value 13 `--text-dim` (mono for numbers), control at the end, (i) after the label (board 08). List: 32 (sessions, menus) or 54 (bots, groups: orb 36, name 14, activity 13, radius 12; current 8%, hover 6%) |
| **List** | rows, virtualised; one tab stop, arrows move |
| **EmptyState** | one line (≤ 80 characters) in `--text-dim` and at most one action, where the content would be |
| **StatusLine** | board 08: C for a bot (live 16 orb + phrase + shimmer), A for the nameless agent and system jobs (the 8 px pulsing dot + phrase); an optional count in mono; one per job per view; live region, polite |
| **Disclosure** | "Read 6 files, ran 2 commands" with a chevron, 13 `--text-dim`; opens the step list (icon + verb + target, 13) |
| **Field** | 36, radius 10, transparent, `--line-field`; label 12 `--text-dim` above; "(Optional)" in `--text-quiet`; error below in `--red-text`; search is a pill at `--fill-2` |
| **Toolbar** | chips 28 at `--fill-2` (13), the active filter an inverted pill; segmented pills; a status line at the end |
| **ChoiceCards** | the question card: bubble surface, radius 18, question 15/600, options 36 tall with a 20 letter tile (radius 6, 6% fill), hover 6%, the chosen tile in the accent; "Something else" turns into a free answer; once answered the others collapse away |
| **PlanCard**, **ApprovalCard** | conversation cards (12.1); approval: tool head, the question, one plain sentence naming the rule, the exact command in a well, Deny (esc) and Hold to approve (1 s, owner decision); collapses to "Terminal, ran 1 command" |
| **OrbStack** | members overlapped by a third of an orb (owner decision): 24 in the title pill and rows, 16 in the activity line, the rail's cluster |
| **Composer** | board 07 B: a 44 pill (radius 22 as it grows), `--bg-3`, `--composer-line`, `--shadow-composer`; + (28, `--fill-2`) left; mic (28) then the voice button (28, inverted ink) that becomes send with text; a second line with mode chips (26: Governed, Smart, Mention) and the capacity in mono; a held message as a strip inside (owner decision); grows with a 300 ms spring |
| **Buttons** | pills: secondary (`--bg-3` + `--line`), primary (inverted ink), ghost (`--text-dim`), danger (red fill, confirms only); 36, 32 in cards, 28 small |
| **Icon buttons** | circles: 36 floating, 28 tinted, ghost for window controls |
| **Switch** | 32 x 20; on: accent with a white knob; off: 4% (light: a grey track and a raised white knob) |
| **Key chip** | 20 tall, 6% fill, radius 4, 12 `--text-dim` |
| **Tooltip** | `--bg-3`, radius 6, padding 4 6, 12; the name, then the keys |
| **Bubble** | R-bubble-1: radius 18, padding 7 12, 15/22; a bot's `--bubble-agent`, yours `--bubble-user`; 6 apart within a sender, 16 between; in a room a byline (16 orb + name in the bot's colour) above a sender's first bubble; mentions as chips (16 orb + name in the bot's colour); a message to you gets the red "you" capsule and a 7% red wash (owner decision) |
| **Time separator** | 12 `--text-dim`, centred, only after a gap |
| **Hand-off row** | centred, 13 `--text-dim`: two 16 orbs, a chevron, "kai handed the notes to nina" |
| **Item row** | 60 tall, a 40 mark (radius 12, `--bg-4`), name 14, one line 13 `--text-dim` (ellipsized), the action as a 28 tinted pill |
| **Danger zone / overflow** | board 08: the overflow (28 circle, `more` glyph) on panes; the collapsed "Danger zone" card at the end of a Settings page; a destructive item in red; confirms in a form dialog with a red pill |
| **Long-text editor** | board 08 B: a focused view over the work, the chrome kept (back, the title pill, Save), the text in mono 13/22 at the column's measure |

Every component ships with its states in the lab before a module uses it (R-comp-5); `docs/UI-COMPONENTS.md` becomes the registry.

## 13. Key screens

Rendered with the recommended options beside the boards (`ds-v7/10-` to `16-`, dark and light): the session chat, a bot's chat with the rail (the sidebar collapsed), a group room with the sidebar open, the session list open, Settings, the Store, and the dock opened on a bot's session. They are drawn from the kit's own tokens (`tokens.v7.css`), boopis's icon set, the real `<orb-avatar>` (orb2) and `<boopis-logo>`, and the kit's `squircle-path.ts` for the continuous corners. The app's own lab draws v6 components, so the v7 previews are standalone boards until the kit is restyled.

## 14. Accessibility

WCAG 2.2 AA stays the floor (R-a11y-1 to 8). What v7 adds or tightens because of Grok:
- readable secondary text at 66% / 68% (never Grok's 54% captions);
- text fields at 3:1 (`--line-field` 38% / 42%), where Grok's 22% fails;
- a visible 2 px focus ring in `--focus`, where Grok draws none;
- targets at least 28 (the composer's buttons), 32 for message actions (Grok gap 3);
- colour never the only cue: the attention flag always has words; the status shimmer never dims the phrase below 4.5:1 (its rest colour is `--text-dim`, the sweep only brightens); reduced motion stops it.

## 15. Options for the owner

Each board shows 2 or 3 options in dark and light at app scale. The recommended one is the default in `tokens.v7.json` and in the key screens.

| # | Choice | Options | Recommended |
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
