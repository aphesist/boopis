# LAB-v7: the lab plan for the one kit

Status: plan, 23 November 2026. Nothing here is built yet. It extends the lab that exists (`apps/desktop/ui/src/lab`, `pnpm lab:check`, `docs/UI-LAB.md`) to the v7 kit (`DESIGN-SYSTEM.md` section 21): every component once, every variant and state as a story, the whole matrix through the checks, and CI blocking on everything but the pixel comparison.

## 1. What the lab proves

A component may ship in a module only when its stories pass every blocking check in the whole matrix (R-comp-5). The lab is where the owner's consistency rule ("consistency throughout the entire thing goes over my word") is enforced by a machine: one story per variant, the same checks on all of them, and a merge in section 21 shows up as one story replacing two.

## 2. Stories, per component

One story file per component under `src/lab/stories/kit/`, named as in section 21. Each lists its variants (rows) and states (columns). States marked * are forced (hover, focus, pressed) by the lab, not drawn by hand.

| # | Component | Variants (stories) | States |
|---|---|---|---|
| 1 | WindowChrome | rail A, compact B; title idle, title running; search hint, search pill | rest, hover*, focus* |
| 2 | Page | column, settings page with scope | content, empty, long names |
| 3 | Pane | details (bot: Activity, Library; session), tools (Diff, Files, Terminal, PR, Side chat) | open, overlay under 900, resized |
| 4 | Dialog | large (Settings), form: commit, import, new bot, confirm (danger) | enter, scrim, close focus*, error in a field |
| 5 | Menu | menu, quick menu, palette /, palette @, palette $, snooze, split-button menu, option menu (four rows) | open, a row hover*, a row focus*, long names (truncate), flipped near the bottom |
| 6 | Card | settings, pane card, danger zone | collapsed, open |
| 7 | Block | the bare surface with a 28 control in each corner (the corner rule's specimen) | rest, at each density |
| 8 | ToolRow | edit, command, read, search | running, done, failed, waiting (attached AskCard), long path (truncate) |
| 9 | AskCard | standalone (bot approval), attached, question, choices, lapsed blank | asked, needs you, answered (collapsed), lapsed, hold-to-allow in progress |
| 10 | FilesCard | 1 file, 12 files | collapsed, open |
| 11 | Queue | list (1, 3, 9 messages), held | rest, a row hover*, editing a row |
| 12 | Notice | above the composer, in a page, floating; neutral, amber, accent, red; 0, 1, 2 actions; with ×; long text (truncate) | enter, rest, dismiss focus* |
| 13 | SystemLine | info, steer, hand-off, error with action | rest, action hover*, action focus* |
| 14 | Bubble | user, agent, bot fill (light and dark derived), room byline, you wash, with inline chips | rest, long word, code |
| 15 | DiffView | stacked, split; with a comment | rest, comment focused |
| 16 | Well | code in a Block, code in a bubble, terminal | rest, long line (scrolls, code allowed) |
| 17 | ListRow | session, bot, item, compact | rest, hover*, current, needs you, working, long title |
| 18 | SectionHead | plain, with count, with disclosure | collapsed |
| 19 | MenuRow | glyph + name, name + description, with kbd, danger | hover*, focus*, long description |
| 20 | OptionRow | permission step, import pick | chosen, hover*, focus* |
| 21 | Button | secondary, primary, ghost, tint, danger, split; 36, 32, 28 | hover*, pressed*, focus*, disabled, hold-to at 50% |
| 22 | IconButton | 36, 28 tinted, ghost | hover*, pressed*, focus* |
| 23 | Segmented | inline 2, 3, 4; page head; tab bar | each chosen, hover*, focus* |
| 24 | SelectorItem | line, launch, field; with a mark, with ticks | hover*, open |
| 25 | Switch | — | on, off, focus*, disabled |
| 26 | Field | text, search pill, multi-line | focus*, error, disabled, placeholder |
| 27 | Kbd | in text, in a pill, in a MenuRow | — |
| 28 | Chip | answer, filter, mode | chosen, hover*, focus* |
| 29 | Tooltip | name, name + keys | shown |
| 30 | InlineChip | mention, you, reference, code, model, countdown; at 13, 14, 15 px text | rest, wrapping line |
| 31 | Mark | feedforward, blank opened, filled, waiting, lapsed, info label | shown, hover*, open, chosen, owed |
| 32 | StatusWord | neutral, amber, red, ok; with dot | pulse (motion story) |
| 33 | Badge | neutral, amber | — |
| 34 | StatusLine | bot, session, system | working, waiting, reduced motion |
| 35 | Avatar | orb 16 to 64, brand tile, stack, orb wearing the model | idle, working, needs, sleeping |
| 36 | Disclosure | steps, work log | open, closed |
| 37 | TurnFoot | bot, session | rest, hover* reveals actions |
| 38 | TimeSeparator | — | — |
| 39 | Composer | session, bot, room, dock, notch; with its line; quick menu open | empty, typed, multi-line, running (Enter queues), held, no model |
| 40 | Rail | A, B | current, needs you, working |
| 41 | Dock | — | needs you, working, sleeping |
| 42 | Notch | (notch spec stories) | — |
| — | EmptyState | per tab | — |

Patterns get one story each, composed only of kit components: the Settings page, the new session's canvas (S41: ready, no model, no folder, with the usage Notice, the permission menu open), the setup form (bot), the danger zone, the long-text editor.

## 3. The matrix

Every state runs in:

| Axis | Values | Notes |
|---|---|---|
| Theme | dark, light | the v6 presets retire (section 3) |
| Corners (theme customization) | B Standard, C Rounder | both must pass the corner rule |
| Accent | Iris (default), one light accent (yellow), one dark accent (navy) | the derived `--accent-text`, `--focus`, `--on-accent` must hold contrast |
| Width | 390, 900, 1200, 1440, 1920 | 1200 switches the rail to compact B; 900 overlays the Pane and folds the composer line |
| Density | compact, regular, comfortable | moves `--ctl`, `--ctl-s`, `--row-h`; `--pad-block` follows (`--r-block − --ctl-s / 2`), so the corner rule holds at all three |
| Motion | reduced (the static checks), full (stability.interact samples) | as today |
| Scale | DPR 1 (goldens), DPR 1.6 (the owner's scale, no visual) | as today |

Full matrix: 2 × 2 × 3 × 5 × 3 = 180 combinations per state at rest. The CI run takes the corners, accent and density axes at their defaults except on the corner-rule and contrast checks, which run every combination; a nightly job runs the full product.

## 4. The checks

The existing checks stay (`tests/lab/rules.mjs`): geometry.contain, geometry.center, geometry.clip, geometry.hscroll, geometry.overlap, geometry.target, concentric, overlay, tokens.computed, tokens.spacing, tokens.static, native, scrollbar, brand, copy, roles, axe, stability.render, stability.interact, visual. v7 changes and adds:

| Check | Rule | How | Severity |
|---|---|---|---|
| **concentric** (tightened) | R-corner-10 | a control in a container's corner zone (both insets under the container's radius, after CSS zoom): radius = outer − inset (floor 6, not 8), the two insets equal within 0.5 px, the control inside the container; a pill in a pill passes when the insets are equal; in rest, hover, focus and pressed; a control with no shell at rest is checked at hover | blocking |
| **inline-baseline** (from `w29/inline-baseline`) | R-inline-1 | every InlineChip and badge in running text: its text baseline equals the line's baseline within 0.5 device px (measured against the probe on the same line, before or after the chip), it is inline-level, it does not make the line taller | blocking |
| **geometry.wrap** (new, ported from the render QA) | R-row-1, R-type-11 | single-line controls (Segmented items, Chip, Button, Badge, Kbd, SelectorItem, the title pill, InlineChip, StatusWord, Tooltip, MenuRow, a blank's countdown) render on one line, and their text is not wider than their box unless it ends in an ellipsis | blocking |
| **geometry.row** (new, ported) | R-row-1 | in every MenuRow, ListRow, OptionRow, Row, queue row and file row: each text run is on one line (a two-line label is two elements, each on one line), and nothing visible runs past the row's padding edge; a description truncates with an ellipsis | blocking |
| **geometry.contain** (extended, ported "escape") | R-corner-4, R-overflow-1 | the visible part of any element (after its own clipping ancestors) stays inside its story cell and the window; a board half never shows the other half's content | blocking |
| **geometry.clip** (unchanged) | R-overflow-1 | text cut without an ellipsis | blocking |
| **geometry.padding** (new, ported) | R-space-3 | Card, Block, ToolRow, FilesCard, AskCard, Queue, Notice, Menu, Tooltip, Chip, Button, Badge, Bubble, ListRow, OptionRow, Row: left padding equals right and top equals bottom within 0.5 px; asymmetric insets are made with an inner element, never with uneven padding | blocking |
| **geometry.align** (new, ported) | R-space-4 | siblings that share an edge share it within 0.5 px: rows in a Card, steps in a list, queue rows, menu rows, file rows, DiffView rows, sidebar rows, and every agent-side block in the thread's 30 px gutter; a DiffView comment starts on the code column | blocking |
| **contrast** (axe plus the derived accent) | R-a11y-1, section 18 | axe's colour contrast, and the derived `--accent-text`, `--focus` and `--on-accent` at 4.5:1 for every accent in the matrix | blocking |
| **mark.rest** (new, ported) | section 17 | a mark (dashed underline) shown at rest only inside feedforward (the composer's text, a reply's guess), an AskCard or a blank; an info label's mark only on hover or focus; any other resting mark (a heading, static text) fails | blocking |
| **kit.single** (new, static) | section 21 | no component class outside the kit's 42 (and the patterns'); a story file per component; a merged name (QueueStrip, LimitNotice, Toast, Banner, ScopePicker, SettingsLine, SteerLine, CheckpointBar, ChoiceCards, LaunchCard, ReferenceChip) used anywhere fails | blocking |
| **visual** | — | pixel difference against `tests/lab-golden` at 1440, DPR 1, per theme and corners | reported, not blocking (as today) |

The render QA that found the 23 November defects (`docs/design/v7/render-qa.cjs`, run from the design scratch, rules `wrap`, `overflow`, `escape`, `clip`, `baseline`, `padding`, `align`, `row`, `concentric`, `mark`) is the reference implementation for the ported checks; its self-test page (`qa-selftest.html`: a wrapped Segmented item, a clipped chip, an unequal card padding, a button crossing a board half, clipped text, a raised "you" capsule, a wrapped menu name, a button overflowing a line pill, a button of the wrong radius, a button on unequal insets, a heading with a resting mark) becomes `src/lab/stories/kit/selftest.stories.ts`, and the lab's own test (as `overlap.test.ts` does for geometry.overlap) asserts each check fires on it.

## 5. Goldens

`tests/lab-golden/kit__<component>__<variant>__<state>__<theme>__<corners>.png` at 1440, DPR 1, reduced motion, regular density, Iris. Taken with `pnpm lab:check --update` on the lab's Chromium once the kit's stories pass every blocking check. The board images in `ds-v7/` are not goldens; they are the owner's references, and each story's golden is compared by eye with its board before it is accepted.

## 6. What CI blocks on

The `lab` job in `.github/workflows/ci.yml` keeps its shape (`pnpm lab:check --jobs 2`, then the summary filter). It fails on any finding whose check is not `visual`: every check in section 4, including the five ported from the render QA (geometry.wrap, geometry.row, the extended geometry.contain, geometry.padding, geometry.align), the tightened concentric, inline-baseline, contrast and kit.single. The screenshot comparison stays a report. A story that is missing for a kit component fails coverage (`coverage.test.ts`), as today.

## 7. Order of work (when the owner says build)

1. Tokens: `tokens.v7.json` into the token files; `--pad-block` derived; the v6 presets retired.
2. The checks: port the render QA rules into `probe.js` and `rules.mjs`, with the self-test story; tighten concentric (floor 6, zoom-aware, R-corner-10).
3. The kit, in dependency order: foundations, Button, IconButton, Kbd, Chip, Segmented, SelectorItem, Switch, Field, Tooltip, InlineChip, Mark, StatusWord, Badge, Avatar, StatusLine; then Card, Block, Menu, MenuRow, OptionRow, ListRow, SectionHead, Notice, SystemLine, Bubble, Well, Disclosure, TurnFoot, TimeSeparator; then ToolRow, AskCard, FilesCard, Queue, DiffView, Composer; then Page, Pane, Dialog, WindowChrome, Rail, Dock, Notch.
4. Each component lands with its stories passing the whole matrix; then the modules move to it, one tab at a time, and the merged names are deleted (kit.single goes green last).
