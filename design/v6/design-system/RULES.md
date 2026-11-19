# boopis design rules: the index

One line per rule of `DESIGN-SYSTEM.md` (version 1.1). Each names its section, its status and the check that verifies it.
The UI lab turns the **machine** checks into automated tests; **by eye** rules are reviewed per screen. Generated from
`DESIGN-SYSTEM.md` and the check list of the version 1.1 pass; when a rule changes there, change its line here.

- **Status**: blank is what the mock-up already does; **Tightened** made an existing rule exact; **Approved** was proposed, then approved in the owner-delegated review of 19 November 2026; formerly needed the
  owner's approval: fix agents follow it as the default, and a check reports a breach as a warning until the owner rules.
- **How**: machine (a script can decide it: computed styles, DOM, geometry, pixels, the keyboard), by eye (a person
  decides), or both (a machine check catches most of it, a review the rest).
- **Tokens** the checks read are in `design/v6/tokens.css` (and the app's copy, `apps/desktop/ui/src/styles/tokens.css`);
  their values for every preset, corner and density setting are in `tokens.json`.


## 2. Voice and copy

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-copy-1](DESIGN-SYSTEM.md#2-voice-and-copy) | Interface text is in sentence case and the brand is lowercase (boopis); content keeps its own case; the Typewriter preset lowers interface labels only through `--ui-case` |  | machine | M: no `text-transform: uppercase\|capitalize` in any stylesheet; interface labels carry `text-transform: var(--ui-case)` |
| [R-copy-2](DESIGN-SYSTEM.md#2-voice-and-copy) | A button is a verb and its object (a bare verb where the card names the object) |  | machine | M: no button whose visible text is OK, Submit, Continue or Learn more (DOM walk of every view) |
| [R-copy-3](DESIGN-SYSTEM.md#2-voice-and-copy) | State words come from the one vocabulary of section 13, lowercase mono; stamps have three wordings only |  | machine | M: every rendered state word is in `HX.ui.states`; every stamp text is one of the three wordings |
| [R-copy-4](DESIGN-SYSTEM.md#2-voice-and-copy) | Banned in interface copy: all caps, middle-dot meta strings, em dashes, exclamation marks, arrows after links, "please", jokes, filler adjectives |  | machine | M: rendered interface text has no `·`, `—`, `!`, 'please' or an all-caps word of 3+ letters (content excluded) |
| [R-copy-5](DESIGN-SYSTEM.md#2-voice-and-copy) | Numbers carry their unit, sit in mono with tabular figures, and use a true minus (U+2212) for negatives and removed counts |  | machine | M: text matching a cost, time or count sits in a mono element with `tabular-nums`; no ASCII hyphen before a removed count |
| [R-copy-6](DESIGN-SYSTEM.md#2-voice-and-copy) | An error names the problem and the way out |  | both | E: error copy names the problem and the way out; M: no rendered `NaN`, `undefined`, `null` or placeholder digits |
| [R-copy-7](DESIGN-SYSTEM.md#2-voice-and-copy) | A tooltip repeats the control's accessible name, then its keys; nothing lives only in a tooltip |  | machine | M: a `[data-tip]` element's tip text equals its accessible name |
| [R-copy-8](DESIGN-SYSTEM.md#2-voice-and-copy) | boopis presents itself as its own product (owner decision, 19 November 2026; its row is added with the branding work): user-facing text never says "Hermes" |  | machine | M: no rendered interface text contains 'Hermes' outside plugin-store item names (DOM walk of every view, settings and first run) |
| [R-copy-9](DESIGN-SYSTEM.md#2-voice-and-copy) | A raw engine error never reaches the interface: no stack traces, error codes, JSON or messages written for developers |  | machine | M: no rendered text matches a stack trace, an error code (`hx.*`, `E[A-Z]+`), JSON braces or 'Traceback' |

## 4. Colour

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-colour-1](DESIGN-SYSTEM.md#4-colour) | Tokens only: no literal colour in a stylesheet, an inline style or a canvas outside `tokens.css` |  | machine | M: no hex, rgb(), hsl() or named colour in app CSS/inline styles outside tokens.css (allowlist: orb colour, model-menu brand fills, theme-card swatches) |
| [R-colour-2](DESIGN-SYSTEM.md#4-colour) | The stamp rule: `--red` and `--red-text` appear only on what the user owes (stamp, attention dot and flag, the blank's underline, a red trail in the palette, an attention state word) and on a form… |  | machine | M: computed colour/background/box-shadow equal to --red or --red-text only on the allowlisted selectors |
| [R-colour-3](DESIGN-SYSTEM.md#4-colour) | The you-are-here rule: `--brass` marks position and choice (focus ring, current dot, active rung, check, pressed glyph, caret, the selected option chip's line) |  | machine | M: no element with direct text whose computed colour is --brass; no brass background larger than 14 x 14 |
| [R-colour-4](DESIGN-SYSTEM.md#4-colour) | The layering rule: what the user wrote is raised (`--bg-3`), what the system set into the work is inset (`--bg-0`); the frame holds, the ground carries; never inset on inset, never raised on… |  | machine | M: no element painted --bg-0 whose nearest painted ancestor is --bg-0; none --bg-3 inside --bg-3 |
| [R-colour-5](DESIGN-SYSTEM.md#4-colour) | Colour is never the only cue: every red mark has a word, every brass mark has a shape |  | by eye | E: every red mark has a word and every brass mark a shape (review per screen) |
| [R-colour-6](DESIGN-SYSTEM.md#4-colour) | Every pair in 5.4 holds in all four presets and on the dock ground; a new pair a component creates is added to the table and to `theme.js PAIRS` |  | machine | M: the 5.4 pairs computed in all four presets and the dock ground (`build-tokens.mjs --report`, theme PAIRS test) |
| [R-colour-7](DESIGN-SYSTEM.md#4-colour) | A tint is `color-mix()` of a solid role; a theme chooses only solids, so every line and fill follows an override |  | machine | M: every translucent token in tokens.css is a `color-mix()` of a solid role |
| [R-colour-8](DESIGN-SYSTEM.md#4-colour) | An orb's colour belongs to the orb and never becomes interface colour |  | machine | M: an orb's colour value appears in no computed style outside `orb-avatar` and `hx-card[data-accent]` |

## 5. Theming contract

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-theme-1](DESIGN-SYSTEM.md#5-theming-contract) | A new colour token is derived from a solid role (preferred), or defined in all four presets; the build (`build-tokens.mjs`) reads each preset's block, so a token missing from one is a bug |  | machine | M: each preset block in tokens.css defines the same set of colour tokens (builder fails otherwise) |
| [R-theme-2](DESIGN-SYSTEM.md#5-theming-contract) | `--dock-bg` is `#000` in every theme and is offered nowhere (owner decision) |  | machine | M: `--dock-bg` computes to #000 in 4 presets x 3 modes, and is absent from theme JSON and the customizer |
| [R-theme-3](DESIGN-SYSTEM.md#5-theming-contract) | The only geometry the user moves is corners and density; every size that follows them reads its token (`--r-*`, `--r-in-*`, `--row-h`, `--ctl`), so both settings reach every component |  | machine | M: toggling corners and density changes every bound element's radius/height as its token predicts |
| [R-theme-4](DESIGN-SYSTEM.md#5-theming-contract) | `data-hx-theme="light"` is used only for what tokens cannot express; today that is `--ink-on-dock`, `--ink-on-dock-strong`, `--line-field` and the dock's brass mix |  | machine | M: selectors with `data-hx-theme` set only the listed tokens |
| [R-theme-5](DESIGN-SYSTEM.md#5-theming-contract) | A colour cached in JavaScript (a canvas, an orb attribute, the hold's fill) is read again on `hx:theme` |  | both | E/unit: canvas and cached colours re-read on `hx:theme` (unit tests per module) |
| [R-theme-6](DESIGN-SYSTEM.md#5-theming-contract) | A token that reads a role the dock ground re-derives is declared again on `[data-ground="dock"]`, because a custom property resolves where it is declared: `--scroll-thumb-color` declared on… | Tightened | machine | M: inside `[data-ground=dock]` `--scroll-thumb-color` equals the dock's `--bg-4` |

## 6. Typography

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-type-1](DESIGN-SYSTEM.md#6-typography) | Two families: `--sans` for interface and prose, `--mono` for code, paths, numbers, times, costs, model names, call numbers, state words, kbd and stamps |  | machine | M: every computed font-family resolves from --sans or --mono; numbers, paths, times in mono |
| [R-type-2](DESIGN-SYSTEM.md#6-typography) | Six sizes, only through `--fs-*` (11, 12, 13, 14, 16, 20) |  | machine | M: every computed font-size is 11, 12, 13, 14, 16 or 20px (logo excluded) |
| [R-type-3](DESIGN-SYSTEM.md#6-typography) | Three weights, by role: 600 only for titles (display, title, card title, panel and dialog titles); 500 for buttons, tabs and segmented options, chips, field labels, group headings and stamps; 400… | Approved | machine | M: computed font-weight in {400, 500, 600}; 600 only on title elements; menu items 400 |
| [R-type-4](DESIGN-SYSTEM.md#6-typography) | Line heights by role, through tokens: `--lh` 1.6 reading text and multi-line fields; `--lh-ui` 1.35 interface; `--lh-tight` 1.2 titles; `--lh-meta` 1.45 mono meta; `--lh-small` 1.5 hints,… | Tightened | machine | M: computed line-height ratio in {1, 1.2, 1.35, 1.45, 1.5, 1.6}; 1 only on fixed-height single-line controls |
| [R-type-5](DESIGN-SYSTEM.md#6-typography) | Case through `text-transform: var(--ui-case)` on interface labels only |  | machine | M: no uppercase/capitalize transform; content elements have `text-transform: none` |
| [R-type-6](DESIGN-SYSTEM.md#6-typography) | Every mono number that can change or line up uses `font-variant-numeric: tabular-nums` (`.ui-mono`) |  | machine | M: every `.ui-mono` and mono number has `font-variant-numeric: tabular-nums` |
| [R-type-7](DESIGN-SYSTEM.md#6-typography) | Code is 12 (`--fs-xs`) in chips and 11 (`--fs-2xs`) at 1.6 in wells, diffs and terminal output; never 12.5 or 13 (F10) |  | machine | M: inline code 12px, code in wells/diffs/output 11px at 1.6 |
| [R-type-8](DESIGN-SYSTEM.md#6-typography) | Tracking 0 for sans, `--track-mono` (−0.01em) for mono, 0 inside a key chip |  | machine | M: sans letter-spacing 0, mono -0.01em, `.ui-kbd` 0 |
| [R-type-9](DESIGN-SYSTEM.md#6-typography) | Prose and card titles wrap with `text-wrap: pretty`, headings with `balance`; overflow by kind is 7.1 |  | machine | M: prose and card titles `text-wrap: pretty`, headings `balance` |
| [R-type-10](DESIGN-SYSTEM.md#6-typography) | Prose stops at `--measure` (608); notes and hints at 42ch (settings), empty states at 46ch |  | machine | M: prose width <= 608px; hints <= 42ch, empty-state text <= 46ch |
| [R-type-11](DESIGN-SYSTEM.md#6-typography) | Text in a fixed-height control is centred by its box (flex centring and a line height of 1), never nudged with padding or a transform |  | machine | M: fixed-height controls centre text (align-items center, line-height 1), no vertical padding or translate on the label |
| [R-type-12](DESIGN-SYSTEM.md#6-typography) | Hierarchy is weight and colour before size: inside one surface one title, then the text roles step down (`--text-strong`, `--text`, `--text-dim`, `--text-quiet`); a larger size is only ever a title |  | by eye | E: one title per surface; text roles step down (review per screen) |

## 7. Space, density and layout

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-space-1](DESIGN-SYSTEM.md#7-space-density-and-layout) | Gaps and padding come from `--sp-*` (4, 8, 12, 16, 24, 32, 48) or the named exceptions of R-space-2 |  | machine | M: every computed gap/padding/margin is a --sp-* step, 2px in a toolbar, or a named exception of R-space-2 |
| [R-space-2](DESIGN-SYSTEM.md#7-space-density-and-layout) | The named exceptions, all component internals, from the library: card padding 14 16; request card 10 14; the composer's text 12 14 4 and its inset 6 (`--composer-pad`); a button 0 14 (small 0 10,… | Tightened | machine | M: the listed components measure exactly the listed paddings at regular density |
| [R-space-3](DESIGN-SYSTEM.md#7-space-density-and-layout) | Siblings are spaced by `gap` on their parent, never by margins on the children; a margin only separates a group from the next (`.ui-group + .ui-group`, a settings head's 20 above) |  | machine | M: no margin between flex/grid siblings except the listed group separators |
| [R-space-4](DESIGN-SYSTEM.md#7-space-density-and-layout) | Density moves only `--row-h`, `--row-h-2`, `--ctl` and `--ctl-s`; nothing else changes with it |  | machine | M: switching density changes only elements sized by the four tokens |
| [R-space-5](DESIGN-SYSTEM.md#7-space-density-and-layout) | Every control's height is one of `--ctl`, `--ctl-s`, `--row-h`, `--row-h-2`, or a named fixed height: chip `--ctl-s` − 2, option chip `--ctl` − 4, small segmented `--ctl` − 2, key chip 18, stamp… |  | machine | M: every interactive element's height is a control token or a listed fixed height |
| [R-layout-1](DESIGN-SYSTEM.md#7-space-density-and-layout) | Window breakpoints are 560 (the call-number margin collapses), 640, 900 and 1200 (both sidebars push; mod panes become tabs) | Approved | machine | M: media-query widths in app CSS are within {520, 560, 639/640, 760, 900, 1200} |
| [R-layout-2](DESIGN-SYSTEM.md#7-space-density-and-layout) | Widths that follow the window come only from the layout tokens (`--sb-w`, `--right-w`, `--col-w`, `--measure`, `--composer-w`) and the clamps above; a component never sizes itself in `vw` (the… |  | machine | M: no `vw` in component CSS outside the layout tokens |
| [R-layout-3](DESIGN-SYSTEM.md#7-space-density-and-layout) | The column, the composer and the dock ride the shell's centre line (`--hx-center-x` and friends); nothing computes its own centre |  | machine | M: column, composer and dock centres equal `--hx-center-x` within 1px at six viewports |
| [R-layout-4](DESIGN-SYSTEM.md#7-space-density-and-layout) | Distances from the window edge: the work keeps `--gutter` (16); floating surfaces `--float-margin` (8); side dialogs and sheets 12 |  | machine | M: content >= 16px, floating surfaces >= 8px, side dialogs and sheets 12px from the window edge |
| [R-layout-5](DESIGN-SYSTEM.md#7-space-density-and-layout) | A scroller that runs under the composer or the dock pads its end by their height (`--hx-dock-space` plus the composer) and sets the same `scroll-padding-bottom`, so the last line and a focused… |  | machine | M: scrolled to the end, the last line and any focused control sit above the composer and the dock |
| [R-layout-6](DESIGN-SYSTEM.md#7-space-density-and-layout) | Large windows have no app-wide maximum width; the extra width becomes margin around the work |  | machine | M: at 2880px wide the column stays 720 and centred |

## 7.1 Overflow and scrollbars

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-overflow-1](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | A one-line label (a row's title, a tab, a chip, a button, a menu label, the command field, a mini card) ends with an ellipsis and never wraps: `min-width: 0; overflow: hidden; text-overflow:… |  | machine | M: every one-line label with scrollWidth > clientWidth has `text-overflow: ellipsis` and `nowrap` |
| [R-overflow-2](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Descriptions clamp: two lines in lists and sheets (a bot's description), three in a card's quote |  | machine | M: line-clamp only on bot descriptions (2) and card quotes (3) |
| [R-overflow-3](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Prose, titles and messages wrap; paths, code and output wrap anywhere inside wells (`overflow-wrap: anywhere`); a code chip clones its background on each line |  | machine | M: buttons and labels `white-space: nowrap`; wells `overflow-wrap: anywhere` |
| [R-overflow-4](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Nothing scrolls sideways except code, diffs, terminal output, tables wider than their box (14.37) and tab strips |  | machine | M: document scrollWidth == clientWidth at 390, 720, 1440; overflow-x scroll only on the listed kinds |
| [R-scroll-1](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Scrollbars are drawn with `::-webkit-scrollbar` and its pseudo-elements, from the scrollbar tokens, and nothing in the app sets `scrollbar-width` or `scrollbar-color`, except `scrollbar-width:… | Tightened | machine | M: no computed `scrollbar-width` other than auto/none and no `scrollbar-color` other than auto; `::-webkit-scrollbar` width equals --scroll-size; screenshot in WebKitGTK and Chromium matches |
| [R-scroll-2](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Geometry: the bar's box is `--scroll-size` 10px; the thumb a capsule `--scroll-thumb` 4px wide, centred, 6px (`--scroll-thumb-active`) while hovered or dragged, never shorter than 32px… | Approved | machine | M: thumb 4px at rest, 6px hovered, min 32px, no buttons, transparent track (pixel probe) |
| [R-scroll-3](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | The thumb is `--scroll-thumb-color` (`--bg-4`, the mock-up's) at rest and `--scroll-thumb-color-active` (`--mark-off`, 3:1 like every non-text mark) while hovered or dragged | Approved | machine | M: thumb pixel equals --bg-4 at rest and --mark-off hovered |
| [R-scroll-4](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Bars are inset, never overlay: none of the three engines gives a styled overlay bar, so the bar takes its 10px at the scroller's end | Approved | machine | M: listed scrollers have `overflow-y: scroll`; end padding = side padding - 10px |
| [R-scroll-5](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Where a scroller's end meets a curved corner of its container (a dialog body's foot, a menu, a popover, the palette list, a sheet), the track is inset by that corner's radius… | Approved | machine | M: in a scroller ending at a rounded corner, the track's margin at that end >= the container's radius |
| [R-scroll-6](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Scrollbars appear only in the named scrollers: the conversation, the sidebar lists, the right panel's body, a dialog's or sheet's body (never the whole dialog: the head stays), the palette list, a… |  | machine | M: every element with scrollHeight > clientHeight and overflow auto/scroll matches the allowlist; no same-axis nesting |
| [R-scroll-7](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | A horizontal scroller is only code, a diff, terminal output, a wide table or a tab strip |  | machine | M: overflow-x scrollers are code/diff/output/table/tab strip; tab strips hide the bar and set `data-more` fade |
| [R-scroll-8](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Every inner scroller sets `overscroll-behavior: contain` |  | machine | M: inner scrollers `overscroll-behavior: contain`; a scroller without focusable children has tabindex 0 and a label |
| [R-scroll-9](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | Two edge cues only: the ground strip that fades in above the composer, and a tab strip's 28px fade |  | both | E: no scroll shadows; M: no box-shadow toggled by scroll position |

## 8. Shape

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-corner-1](DESIGN-SYSTEM.md#8-shape) | Radii come only from `--r-*`, `--r-outer`, `--r-in` or `--r-in-*`; the only literal is 0 |  | machine | M: every computed border-radius equals a --r-* / --r-in-* value at the current corners setting, or 0 |
| [R-corner-2](DESIGN-SYSTEM.md#8-shape) | The radius by kind of element | Tightened | machine | M: per selector, computed radius equals the table's token (sharp, default, round) |
| [R-corner-3](DESIGN-SYSTEM.md#8-shape) | Nested corners fit (owner decision): a piece within its container's radius of a corner takes `max(--r-floor, R − gap)`, through the container's `--r-in` or its `--r-in-*` token; where that would… |  | machine | M: for each child within R of a container corner, radius == max(floor, R - gap) +/-1 or a capsule |
| [R-corner-4](DESIGN-SYSTEM.md#8-shape) | A piece in a corner sits inside it: inset by the container's `--pad` from both edges, it never touches or crosses the container's edge or its curve |  | machine | M: a corner piece's rect is inset >= --pad from both edges of its container |
| [R-corner-5](DESIGN-SYSTEM.md#8-shape) | The edge band shares the corner: every piece on the same band as a corner piece (the same inset from that edge, for example a dialog head's tabs beside its close button) takes the corner piece's… | Approved | machine | M: pieces sharing a corner piece's band have its radius (dialog head tabs == close) |
| [R-corner-6](DESIGN-SYSTEM.md#8-shape) | Every corner is the drawn continuous corner (`HX.ui.squircle`, smoothing 0.6); no `corner-shape` anywhere; only leaf controls are clipped, a container is a frame (owner decisions, 8.1) |  | machine | M: no `corner-shape`; clip-path only on leaf controls; bound containers draw ::before/::after (existing smoke `corners`) |
| [R-corner-7](DESIGN-SYSTEM.md#8-shape) | Nothing paints a rectangle behind a rounded surface: the `<dialog>` element, wrappers and a scroller the same size as a rounded surface have no background, border or shadow of their own, and the… | Tightened | machine | M: `dialog` elements and same-size wrappers of rounded surfaces have transparent background, no border, no shadow; corner pixels outside the path equal the backdrop |
| [R-corner-8](DESIGN-SYSTEM.md#8-shape) | A piece flush with its container's edge (a card's foot, a queue's peek, a body's focus ring at a dialog's foot) takes the container's radius on the corners it shares and 0 on the others |  | machine | M: flush pieces have the container radius on shared corners and 0 elsewhere |
| [R-corner-9](DESIGN-SYSTEM.md#8-shape) | A piece whose inner radius would reach half its height is a capsule (`--r-pill`), drawn natively; a round piece in a pill stays a pill |  | machine | M: no element with radius between half its height and 999 except capsules drawn natively |

## 9. Elevation, hairlines and depth

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-line-1](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | The outline of a rounded thing is drawn inset (an inset 1px `box-shadow`, or `--sq-line` once bound), never a `border`, which does not follow the drawn corner |  | machine | M: no non-zero `border` on elements with radius > 0 (inputs excepted) |
| [R-line-2](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | Which line | Tightened | machine | M: per selector, the outline colour equals the table's token |
| [R-line-3](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | A line is one device pixel at rest (the squircle snaps, a native border snaps itself); 2px only for focus rings; dotted only under a blank; dashed only under feedforward words and answered blanks |  | machine | M: line widths 1 device px (2 for focus); dotted only on the blank, dashed only on feedforward/answered |
| [R-line-4](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | A head or foot rule spans its surface edge to edge; a divider between items stops at the content inset (settings rows inside the body's 20, menu separators 6 in); the last item has none |  | machine | M: last item of a divided list has no divider; head/foot rules span the surface width |
| [R-line-5](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | No double lines: a divider never meets an outline or another divider |  | machine | M: no divider adjacent (0px) to an outline or another divider |
| [R-elev-1](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | Depth is tone |  | machine | M: non-inset box-shadow only on the floating-surface allowlist |
| [R-elev-2](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | Five levels, each with its shadow token and its layer | Tightened | machine | M: each floating kind's shadow equals its --elev-* and its z-index its --z-* token |
| [R-elev-3](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | One shadow per surface, never coloured, never a glow, never a hard offset; a surface inside a floating one (a menu item, a card in a popover) has none |  | machine | M: no non-inset shadow inside a floating surface; no shadow with a colour other than the preset's shadow ink |
| [R-elev-4](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | A floating surface is opaque: the frame colour with `--line` (menus, popovers, the palette, dialogs) or raised with `--hair` (tooltips, toasts) |  | machine | M: floating surfaces have alpha 1 backgrounds and no backdrop-filter |
| [R-elev-5](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | `z-index` comes from `--z-*` |  | machine | M: every z-index is a --z-* value, or 1-3 inside an element with `isolation: isolate` |
| [R-elev-6](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | A modal dialog uses the top layer (`showModal`), above every `--z-*`; every layer opened from inside it (a menu, a popover, the tooltip) mounts inside the dialog, so it stays above it; a toast… | Approved | machine | M: with a modal dialog open, an opened menu/tooltip is a descendant of the dialog and hit-testable |
| [R-elev-7](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | One floating layer is open at a time; a tooltip may show over it; opening another closes the first |  | machine | M: opening a second menu closes the first (one `.ui-menu.is-in`) |
| [R-elev-8](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | One scrim at a time, only behind the palette, a modal dialog or an overlaying sidebar or panel |  | machine | M: at most one visible scrim; none behind the side dialog |

## 9.1 Surfaces on surfaces

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-stack-1](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | Each surface holds only the tones of the ladder (frame, ground, inset card, raised, floating); never inset on inset, never raised on raised | Tightened | machine | M: child/parent background pairs are in the table's allowed set |
| [R-stack-2](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | A card never holds a card: what a card holds is a well, a mini row, an option row, a field or a quote |  | machine | M: no `hx-card` inside an `hx-card` |
| [R-stack-3](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | Cards in a queue stack: the front card, then at most two peeks of their foot, 7px lower each, inset 12 and 24, at .9 and .55, no shadow | Tightened | machine | M: queue peeks: offsets 7px, insets 12/24, opacities .9/.55, no shadow, foot radius == card radius |
| [R-stack-4](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | A mini card behaves as a row (`--hover`, `--current`, one 30px line); a full card is never clickable as a whole: its actions are its buttons |  | machine | M: mini cards are buttons with row states; full cards have no click handler on the card element |
| [R-stack-5](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | A sheet sits beside the work (flush to the right edge under the title bar, a concave corner where it meets the frame); a dialog floats over a scrim; a popover floats by its anchor; a toast floats… |  | by eye | E: placement of sheets, dialogs, popovers and toasts (review per screen) |

## 10.2 Sizes, spacing and alignment

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-icon-1](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | One set, `HX.ui.icon(name)` |  | machine | M: every `svg` outside `.ui-icon`, model marks, `boopis-logo` and `orb-avatar` fails; no emoji in rendered text |
| [R-icon-2](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | One rendered stroke: 1.5px, round caps and joins, `vector-effect: non-scaling-stroke`, `currentColor` |  | machine | M: `.ui-icon` paths have non-scaling stroke 1.5, round caps and joins |
| [R-icon-3](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Six sizes, as tokens, and no other | Tightened | machine | M: every `.ui-icon` box is 10, 12, 14, 15, 16 or 18px, matching the table by context |
| [R-icon-4](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | An icon's size follows the text beside it, never the control's height alone: 16 beside 13 or 14, 15 beside 12 in chips and 13 in menus, 14 beside 12, 12 beside 11 mono |  | machine | M: icon size vs adjacent text size in the listed pairs |
| [R-icon-5](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Icon to label: `--ic-gap` (8) in buttons, menu items and rows; `--ic-gap-tight` (6) in capsules and controls of 26px and under (chips, files, segmented options) | Tightened | machine | M: icon-to-label gap is 8 or 6 by control height, or a named exception |
| [R-icon-6](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Alignment: an icon is centred in a square box of its own size; optical corrections are drawn into the glyph, never added per use (no margins or translates on an icon; a chevron only rotates) |  | machine | M: no margin or translate on `.ui-icon` (rotation allowed on chevrons); multi-line glyph box height == first line height |
| [R-icon-7](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Colour: `--icon` at rest, `--text-strong` on hover, `--icon-off` disabled, `--brass` pressed or checked, `--icon-quiet` for window controls |  | machine | M: icon colour per state equals the token; no red icon |
| [R-icon-8](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | When to use one: an icon alone only in an icon button, always with its tooltip and accessible name; in a text button only when the glyph is the action's own (send, fork, copy, play, the composer's… |  | both | E: decorative icons (review); M: icon-only buttons have aria-label and data-tip |
| [R-icon-9](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Chevrons: `chevron` (right) rotates 90° to open a disclosure; `chevron-down` marks a picker (a select, the model chip) and never rotates |  | machine | M: `chevron-down` never rotated; disclosure chevrons rotate 90deg when expanded |
| [R-icon-10](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | Every icon is `aria-hidden`; its control carries the name |  | machine | M: every `.ui-icon` is aria-hidden (model marks excepted) |

## 11. Motion

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-motion-1](DESIGN-SYSTEM.md#11-motion) | Durations and curves come only from the tokens; the only literal is the reduced-motion 1ms |  | machine | M: no literal duration or easing in app CSS/JS animations other than 1ms reduced motion |
| [R-motion-2](DESIGN-SYSTEM.md#11-motion) | What moves: `transform`, `translate`, `opacity`, colour, `clip-path` |  | machine | M: transition-property and animated properties are compositor-only (card height excepted) |
| [R-motion-3](DESIGN-SYSTEM.md#11-motion) | No curve passes its mark: every cubic-bezier keeps its y values within 0 to 1, every spring is critically damped |  | machine | M: every cubic-bezier y in [0, 1]; springs critically damped (unit) |
| [R-motion-4](DESIGN-SYSTEM.md#11-motion) | Timing by kind: hover in `--dur-1`, out `--dur-out`; press `--dur-press`; a thumb or page indicator `--dur-slide`; an entrance (menu, popover, toast, dialog) `--dur-2`, a fade with a 6px drop (a… | Tightened | machine | M: per kind, transition durations equal the tokens |
| [R-motion-5](DESIGN-SYSTEM.md#11-motion) | Motion runs at the display's rate (120 Hz and up): it is driven by time, never by frame counts; it composites (transform and opacity); a spring with a known end is a Web Animation sampled from its… | Tightened | machine | M: perf harness (`pnpm perf:webkit`): no layout reads in rAF, frame time budgets at 120 Hz |
| [R-motion-6](DESIGN-SYSTEM.md#11-motion) | Reduced motion: the durations become 1ms (the tokens do it), loops stop, travel and drops go, thumbs jump, colour and opacity still answer; orbs reduce and never freeze; the dock's size changes… |  | machine | M: with reduced motion emulated, no animation longer than 1ms except orbs and fades; no infinite animation except orbs |
| [R-motion-7](DESIGN-SYSTEM.md#11-motion) | The only loops: the running dot, the travelling dot of indeterminate progress, an orb's idle life, and a live logo on its own screen |  | machine | M: infinite animations only on the allowlist |
| [R-motion-8](DESIGN-SYSTEM.md#11-motion) | Focus rings never animate; no page-load choreography, no scroll reveals; an entrance only for something that just appeared because the state changed |  | machine | M: focus outlines have no transition; E: no load choreography |

## 13. Bots and orbs

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-orb-1](DESIGN-SYSTEM.md#13-bots-and-orbs) | Eyes follow the state only: a bot's look is its name, colour and shape |  | machine | M: no `orb-avatar` has an `eye-shape` attribute; no eyes control in the new-bot sheet |
| [R-orb-2](DESIGN-SYSTEM.md#13-bots-and-orbs) | Orb sizes come only from the table above (10, 16, 20, 24, 26, 40, 120) |  | machine | M: every orb's size is in {10, 16, 20, 24, 26, 40, 120} |
| [R-orb-3](DESIGN-SYSTEM.md#13-bots-and-orbs) | A bot always shows orb, name, role, schedule and state word, in that order, in the same places; in a list the orb centres on x = 28 |  | machine | M: bot rows render orb, name, role, schedule, state in DOM order; orb centre x = 28 |
| [R-orb-4](DESIGN-SYSTEM.md#13-bots-and-orbs) | Motion by size: `static` at 16 and under (or `still` picker tiles to 28), calm above, lively only in the bot's header; reduced motion reduces and never freezes (owner decision) |  | machine | M: idle-motion and static per size |
| [R-orb-5](DESIGN-SYSTEM.md#13-bots-and-orbs) | An orb is never clipped: its container is a frame (8.1), and its attention flag (8px with a 2px ring of the surface) has room outside the orb's box |  | machine | M: no clip-path/overflow hidden on an orb's ancestors within its box plus 10px |
| [R-orb-6](DESIGN-SYSTEM.md#13-bots-and-orbs) | An orb is not a control except in the dock; it is `aria-hidden` and its row or button carries the name |  | machine | M: orbs aria-hidden; holders named |
| [R-orb-7](DESIGN-SYSTEM.md#13-bots-and-orbs) | A dark body (luminance under .05) gets light eyes, `--ink-on-dock` |  | machine | M: orbs with luminance < .05 have `eye-color` --ink-on-dock |

## 14.3 Tabs pill (segmented control as tabs)

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-seg-1](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | Two to four options of equal width (the track is a grid of equal columns); more, or labels of very different length, become a select (14.32) |  | machine | M: 2-4 options; equal widths +/-1px |
| [R-seg-2](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | The track is `--bg-0` with `--hair`, inset 3 (`--pad-seg`), radius `--r-s`; the thumb and the options take `--r-in-seg` (9); the thumb slides by `transform` over `--dur-slide`; the selected label… |  | machine | M: track pad 3, radius --r-s; thumb radius --r-in-seg; thumb moves by transform |
| [R-seg-3](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | A segmented control on a container's edge band takes the band's radius for its track (`--r-outer: var(--r-in-dialog)` in a dialog head), and its thumb follows (`band − 3`) | Approved | machine | M: a segmented control in a band has track radius == band radius |
| [R-tab-1](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | Three tab looks, one per place, and nothing else is a tab: the segmented pill (view switches such as Session \| Bots, and radios of two to four values); text tabs in a dialog head (28px, 13/500… | Tightened | machine | M: elements with role=tab match one of the three looks |
| [R-tab-2](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | Tabs never wrap |  | machine | M: tab labels nowrap; overflowing strips scroll with hidden bar and fade |
| [R-tab-3](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | One tab stop; arrows move and select (Up and Down when vertical), Home and End; `aria-selected`; an attention dot beside an unselected label, and ", needs you" in its name |  | machine | M: one tab stop per tablist; arrows/Home/End move selection (keyboard script) |

## 14.4 List rows

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-row-1](DESIGN-SYSTEM.md#144-list-rows) | A row is `--row-h`, inset 8 in its list, radius `--r-s`; its lead column is 16 wide and centred on x = 28; its label starts at x = 44; its end slot holds mono meta, a state word or actions |  | machine | M: row height --row-h, inset 8, radius --r-s, lead centre x=28, label x=44 |
| [R-row-2](DESIGN-SYSTEM.md#144-list-rows) | States: hover `--hover`; current `--current` with `--text-strong` and `aria-current`; archived: quiet and struck through with `--line-strong`; actions replace the meta on hover and focus-within,… |  | machine | M: hover/current/archived styles equal the tokens; aria-current on the current row |
| [R-row-3](DESIGN-SYSTEM.md#144-list-rows) | The lead column is for state (a dot, an orb, the palette's kind glyph), never decoration |  | by eye | E: no decorative icons in rows |
| [R-row-4](DESIGN-SYSTEM.md#144-list-rows) | A two-line row is `--row-h-2` with a 12 quiet sub line; a list never has three-line rows |  | machine | M: two-line rows --row-h-2; no list item taller than --row-h-2 |

## 14.12 Dock

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-dock-1](DESIGN-SYSTEM.md#1412-dock) | The dock is `--dock-bg` black in every theme, flush to the bottom edge, `--r-l` top corners with `--r-l` concave flares, centred on the centre line with the composer; everything inside sits on… |  | machine | M: smoke 'the dock is #000' in 4 presets x 3 modes; centred on the centre line |
| [R-dock-2](DESIGN-SYSTEM.md#1412-dock) | The dock shows only what exists (owner decision, 19 November 2026; its row is added with the dock's presence work): its bots part when at least one bot exists, its session part once a session has… |  | machine | M: with no bots and no session, no dock element is rendered; each part appears only when its data exists |
| [R-dock-3](DESIGN-SYSTEM.md#1412-dock) | It rises in, grows and leaves with spring motion (critically damped, no overshoot, R-motion-3); under reduced motion size changes are instant and entrances fade (owner decisions) |  | machine | M: dock size animations are springs without overshoot; reduced motion instant |
| [R-dock-4](DESIGN-SYSTEM.md#1412-dock) | Its options and its minimise control appear only on hover or keyboard focus (`:hover`, `:focus-within`), never at rest (owner decision, 19 November 2026) |  | machine | M: options and minimise are hidden at rest and visible on :hover and :focus-within |
| [R-dock-5](DESIGN-SYSTEM.md#1412-dock) | The page indicator (the nub of page dots in the foot) shows only when there is more than one page (owner decision, 19 November 2026); the current page is a 14 × 4 brass pill, the others… |  | machine | M: page indicator absent with one page; present with two or more |
| [R-dock-6](DESIGN-SYSTEM.md#1412-dock) | One click or Enter on an orb opens the bot's session in the dock; the same orb, Esc or the close button returns; a double-click or mod+Enter opens the full chat (owner decision) |  | machine | M: click/Enter opens the session, dblclick/mod+Enter the full chat (smoke) |

## 14.13 Cards

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-card-1](DESIGN-SYSTEM.md#1413-cards) | A card is the drawer colour (`--bg-0`; the dock's `--surface` in the dock), `--r-m`, padding 14 16, up to 520 inline or 360 compact; what sits in its corners takes `--r-in-card` (8) |  | machine | M: card background, radius, padding and width as listed; corner pieces --r-in-card |
| [R-card-2](DESIGN-SYSTEM.md#1413-cards) | Its foot puts mono meta or a receipt at the start and the actions at the end, the primary action (or the hold) last |  | machine | M: in `.cd-foot`, the primary or hold is the last button |
| [R-card-3](DESIGN-SYSTEM.md#1413-cards) | Red is only its stamp; a decided card recedes (title and well to `--text-dim`, the foot a receipt) |  | machine | M: red only on the stamp; resolved cards' titles --text-dim |
| [R-card-4](DESIGN-SYSTEM.md#1413-cards) | Every state change animates its height (owner decision); cards stack as R-stack-3 and never nest (R-stack-2) |  | machine | M: smoke 'card height' animates; no nested cards |

## 14.14 Buttons

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-btn-1](DESIGN-SYSTEM.md#1414-buttons) | One primary per group: the action that moves the work forward |  | machine | M: at most one `.ui-btn--primary` per group/foot |
| [R-btn-2](DESIGN-SYSTEM.md#1414-buttons) | In a foot or a group, actions sit at the end; the primary (or the hold) is last, the way out first |  | machine | M: in a foot or group, the primary is the last button |
| [R-btn-3](DESIGN-SYSTEM.md#1414-buttons) | A destructive action is secondary, never red and never primary: the first press arms it (`--line-strong`, the label "Click again to archive"), the second commits |  | machine | M: no red on buttons; destructive actions arm (data-armed) before committing |
| [R-btn-4](DESIGN-SYSTEM.md#1414-buttons) | A text button's icon leads, `--ic-l` (16), `--ic-gap` from the label, and only when the glyph is the action's own (R-icon-8) |  | machine | M: a button's icon precedes its label, 16px, gap 8 |
| [R-btn-5](DESIGN-SYSTEM.md#1414-buttons) | A button hugs its label (padding 0 14, small 0 10, ghost 0 8, `flex: none`); it never stretches to its container, except the hold's 148 minimum |  | machine | M: buttons `flex: none` and width == content (hold >= 148) |
| [R-ib-1](DESIGN-SYSTEM.md#1414-buttons) | An icon button is a `--ctl-s` square with an 18 glyph, `--r-s` (or the corner's `--r-in-*` in a corner or on a band), always with an accessible name and a tooltip that shows its keys; small (24,… |  | machine | M: icon buttons --ctl-s square, 18 glyph, aria-label and data-tip with data-kbd where a key exists |
| [R-ib-2](DESIGN-SYSTEM.md#1414-buttons) | A toggle shows `aria-pressed` with a brass glyph, or `aria-expanded` with its filled half; never both |  | machine | M: no icon button with both aria-pressed and aria-expanded |

## 14.16 Switches

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-switch-1](DESIGN-SYSTEM.md#1416-switches) | A switch is for a setting that applies at once; an action or a mode that needs a confirmation is not a switch |  | by eye | E: switches only for settings that apply at once |
| [R-switch-2](DESIGN-SYSTEM.md#1416-switches) | It sits at the end of its settings row, the label and hint at the start, `<label for>` bound |  | machine | M: the switch is the last child of its row; label bound with `for` |
| [R-switch-3](DESIGN-SYSTEM.md#1416-switches) | No "on" or "off" text inside or beside it; the knob's place and the bone track say it |  | machine | M: no 'on'/'off' text in a switch row |

## 14.17 Chips

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-chip-1](DESIGN-SYSTEM.md#1417-chips) | A chip is a capsule; inside a container's band it takes the band's `--r-in-*`, which is a capsule at a chip's height too |  | machine | M: chip radius is a capsule |
| [R-chip-2](DESIGN-SYSTEM.md#1417-chips) | Heights and type: a toolbar chip is `--ctl-s` − 2 (26), 12/500 `--text-dim`, glyph `--ic-m`; an option chip `--ctl` − 4 with `--line`, checked `--current` with an inset brass line; a mono chip's… |  | machine | M: chip heights and type as listed |
| [R-chip-3](DESIGN-SYSTEM.md#1417-chips) | The strike through an unpressed label is only for the composer's mode toggles (Governed, Smart) |  | machine | M: line-through only on mode toggle chips |
| [R-kbd-1](DESIGN-SYSTEM.md#1417-chips) | A key chip is 18 tall and at least 18 wide, padding 0 4, mono 11 `--text-dim`, tracking 0; `--bg-3` with `--hair`, or `--bg-4` with no line on a raised surface (a tooltip, a toast); one chip per… | Tightened | machine | M: `.ui-kbd` 18px tall, min 18 wide, mono 11, gap 3; labels from HX.ui.keys |
| [R-kbd-2](DESIGN-SYSTEM.md#1417-chips) | A key chip at the end of a rounded container takes its --r-in (8 in a tooltip or a 26px field), at most a capsule; --r-xs in running text | Tightened | machine | M: a key chip inside a rounded container has radius min(container --r-in, 9) +/-1; in running text --r-xs |
| [R-kbd-3](DESIGN-SYSTEM.md#1417-chips) | Keys show in tooltips, at the end of menu items, in the palette's field (esc), on a button while hovered or focused, in the command field and in the keymap sheet |  | machine | M: `.ui-keys` aria-hidden; its control has aria-keyshortcuts |

## 14.19 Popovers

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-float-1](DESIGN-SYSTEM.md#1419-popovers) | A menu, a popover and a tooltip sit `--float-gap` (8) from their anchor and at least `--float-margin` (8) from the window edge, below the anchor unless it only fits above | Approved | machine | M: menu/popover/tooltip edge 8px from the anchor and >= 8px from the window edge |
| [R-float-2](DESIGN-SYSTEM.md#1419-popovers) | No arrows, beaks or tails on any floating surface |  | machine | M: no ::before/::after triangles on floating surfaces |
| [R-float-3](DESIGN-SYSTEM.md#1419-popovers) | A menu opens below its trigger, its start 8px before the trigger's (so the first item's label lines up with the trigger's), or end-aligned when the trigger ends a bar; only a tooltip is centred on… |  | machine | M: menu left == anchor left - 8 (or right-aligned at the end of a bar) |
| [R-float-4](DESIGN-SYSTEM.md#1419-popovers) | Sizes: menus 220 to 340 wide, popovers 360 (at most the window less 24), tooltips one line |  | machine | M: menu width 220-340; popover 360; height <= window - 16 |
| [R-float-5](DESIGN-SYSTEM.md#1419-popovers) | Opening moves focus in (a menu to its checked item or the first); Esc, an outside press and Tab close it and focus returns to the trigger; one at a time (R-elev-7) |  | machine | M: keyboard script: focus moves in, Esc/outside/Tab close, focus returns |
| [R-menu-1](DESIGN-SYSTEM.md#1419-popovers) | A menu item is at least `--row-h`, padding 6 8, radius `--r-in-menu` (16); a 16 glyph column, a 13/400 label (R-type-3), an optional 12 quiet description, keys or a stamp at the end |  | machine | M: menu item min height --row-h, padding 6 8, radius --r-in-menu, glyph column 16 |
| [R-menu-2](DESIGN-SYSTEM.md#1419-popovers) | Item states: hover `--hover`; keyboard focus `--current` with an inset 2px brass ring; checked a brass check, never a filled square; disabled `--text-quiet` |  | machine | M: item state styles equal the tokens; checked shows the check glyph |
| [R-menu-3](DESIGN-SYSTEM.md#1419-popovers) | A title is 12/500 quiet; a separator a hairline 6 in from each side; a foot note 12 quiet above a hairline |  | machine | M: titles 12/500 quiet; separators inset 6 |

## 14.22 Toasts

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-toast-1](DESIGN-SYSTEM.md#1422-toasts) | One line at the top of the work (`--chrome-h` + 12), centred on the centre line, raised with `--hair` and `--elev-3`, `--r-m`, `--ctl-s` + 12 tall; its action is a ghost button with… |  | machine | M: toast position, height, radius, shadow; action radius --r-in-toast |
| [R-toast-2](DESIGN-SYSTEM.md#1422-toasts) | It stays 3s (6s with an action) and waits while hovered or focused; one at a time (a mod's queue, 14.29) |  | machine | M: timeout 3s/6s, paused while hovered or focused |
| [R-toast-3](DESIGN-SYSTEM.md#1422-toasts) | A toast confirms what just happened |  | machine | M: no toast with error tone; no toast visible while a modal dialog is open |

## 14.23 Tooltips

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-tip-1](DESIGN-SYSTEM.md#1423-tooltips) | A tooltip is raised with `--hair` and `--elev-2`, `--r-s`, 12px, padding 4 8 (4 4 4 8 with keys); its keys take `--r-in-field` (R-kbd-2) |  | machine | M: tooltip background, line, shadow, radius, padding; keys radius --r-in-field |
| [R-tip-2](DESIGN-SYSTEM.md#1423-tooltips) | It shows below its anchor, above within 160px of the window's bottom, to the right in the rail; and it never covers the text you are typing: a tooltip for a control inside a container that holds a… | Approved | machine | M: a tooltip never intersects a focused text field or the container holding it |
| [R-tip-3](DESIGN-SYSTEM.md#1423-tooltips) | Timing: 480ms the first time, at once while warm (700ms after the last) and on keyboard focus; it hides on pointer down, focus out and Esc |  | machine | M: delays 480/0/0 by script |
| [R-tip-4](DESIGN-SYSTEM.md#1423-tooltips) | Its text is the control's accessible name, then an optional mono state, then the keys; one line, never interactive, never the only place for information; the platform's `title` tooltip is never… |  | machine | M: tooltip text == aria-label (+ keys); no `title` attributes |

## 14.24 Focus rings

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-focus-1](DESIGN-SYSTEM.md#1424-focus-rings) | Focus is a `--focus-w` (2px) `--focus` ring at `--focus-offset` (2px) outside the element, on `:focus-visible` only, with no transition |  | machine | M: :focus-visible outline 2px --focus offset 2px, transition none |
| [R-focus-2](DESIGN-SYSTEM.md#1424-focus-rings) | Inside a floating surface or a clipped track (menu items, option rows, segmented options) the ring is inset 2px, with the `--current` fill |  | machine | M: focus inside menus/tracks is inset 2px with --current |
| [R-focus-3](DESIGN-SYSTEM.md#1424-focus-rings) | On a drawn corner the ring follows the same continuous path, inside the edge (8.1) |  | machine | M: bound elements draw the ring on the path (pixel probe) |
| [R-focus-4](DESIGN-SYSTEM.md#1424-focus-rings) | A field shows the ring on its box (`:focus-within`), never on the bare input; the composer shows focus as `--line-field` and a brass caret |  | machine | M: fields show the ring on the box; the composer shows --line-field |
| [R-focus-5](DESIGN-SYSTEM.md#1424-focus-rings) | Focus never moves on hover; opening a layer moves it in; closing returns it to the trigger; a resolved card keeps it on its next sensible control |  | machine | M: keyboard script: hover never moves focus; layers return focus |
| [R-focus-6](DESIGN-SYSTEM.md#1424-focus-rings) | A focused control is never hidden (WCAG 2.4.11): scrollers keep `scroll-padding` for the composer, the dock and any fixed head (R-layout-5) |  | machine | M: tabbing through every view, each focused rect is fully visible (not under composer, dock, head, toast) |

## 14.25 Fields

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-field-1](DESIGN-SYSTEM.md#1425-fields) | A text field is at least `--ctl`, `--r-s`, `--bg-0` on the frame (`--bg-3` raised on the ground), an inset `--line-field`, 13 sans at `--lh` (mono 11 variant), padding 6 10, placeholder `--text-quiet` |  | machine | M: field height, radius, background, line, type, padding as listed |
| [R-field-2](DESIGN-SYSTEM.md#1425-fields) | Its label is above it (12/500 `--text-dim`, 6 above, bound with `for`); a hint or the error is below it (12/1.5, `aria-describedby`); the error replaces the hint, and only the message and the… |  | machine | M: label above with for; hint/error below with aria-describedby; error replaces hint |
| [R-field-3](DESIGN-SYSTEM.md#1425-fields) | States: hover line `--text-quiet`; focus the ring (R-focus-4); `aria-invalid` red line; disabled at `--disabled-alpha` (R-state-6) |  | machine | M: state styles equal the tokens |
| [R-field-4](DESIGN-SYSTEM.md#1425-fields) | A textarea grows with its text and has no resize grip (`resize: none`) |  | machine | M: textareas `resize: none` |

## 14.28 Empty states

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-empty-1](DESIGN-SYSTEM.md#1428-empty-states) | An empty state is centred in the space above the dock: the logo's mark 32 wide in `--text-faint`, a title 16/600, one or two sentences 13/1.6 `--text-dim` at 46ch, and the one action that fills it… |  | machine | M: empty states have the mark (32, --text-faint), a 16/600 title, text <= 46ch and one action |

## 14.30 Dialogs and sheets

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-dialog-1](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | A modal dialog is `min(600px, 100% − 32px)` × `min(680px, 100% − 64px)`, centred, the frame colour, `--r-l`, `--line` and `--elev-4` over `--scrim` |  | machine | M: dialog size, radius, colours, head 52, close at 12/12 with --r-in-dialog, body scrolls under a fixed head |
| [R-dialog-2](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | The wide sheet (the keymap) is `min(1000px, 100% − 32px)` × `min(720px, 100% − 48px)`, with the same head and body |  | machine | M: keymap sheet size as listed |
| [R-dialog-3](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | The side dialog (Appearance) is `min(420px, 100% − 24px)` wide and the window's height less 12 on each side, at the right edge, with no scrim, so its changes show on the app |  | machine | M: side dialog width, 12px insets, no visible backdrop |
| [R-dialog-4](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | A sheet inside a view (bot settings) is `--right-w`, the frame colour, flush right under the title bar with a concave top-left corner (`--r-l`), and has its own close button and Esc |  | machine | M: sheet width --right-w, flush right, concave corner |
| [R-dialog-5](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | Focus moves in (the first field, else the close button), Tab loops inside, Esc closes and focus returns to the opener; one modal at a time; a confirmation inside is an armed button (R-btn-3),… |  | machine | M: keyboard script: focus in, Tab loops, Esc returns focus; no nested modal |
| [R-dialog-6](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | Under 640 a dialog keeps 16 from the window's sides and drops its title, never its tabs |  | machine | M: at 390 the dialog keeps 16px sides, hides its title, keeps its tabs |

## 14.31 Search fields

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-search-1](DESIGN-SYSTEM.md#1431-search-fields) | Three search fields, one family |  | machine | M: command field and palette field geometry as listed |
| [R-search-2](DESIGN-SYSTEM.md#1431-search-fields) | The search glyph labels, it does not act: `--text-quiet`, like the placeholder, at the start |  | machine | M: the search glyph's colour == --text-quiet |
| [R-search-3](DESIGN-SYSTEM.md#1431-search-fields) | The leading glyph is centred in a square as tall as its field: its centre is half the field's height from the edge | Approved | machine | M: the glyph's centre is half the field's height from its start edge |
| [R-search-4](DESIGN-SYSTEM.md#1431-search-fields) | What ends a field (key chips while it is empty) sits `--pad-tip` (4) from the end of a 26 field and takes `--r-in-field` (R-kbd-2); in the palette's 48 field the esc key sits at the field's 12 end… |  | machine | M: trailing keys inset 4 in the command field with radius --r-in-field |
| [R-search-5](DESIGN-SYSTEM.md#1431-search-fields) | Matches are underlined in brass with the text `--text-strong`, never highlighted with a fill; no matches is a sentence that teaches ("No matches for … Try a session title, a bot's name or a command.") |  | machine | M: matches use underline in --brass and no background |

## 14.32 Selects and listboxes

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-select-1](DESIGN-SYSTEM.md#1432-selects-and-listboxes) | A select is a button drawn as a field (the `.ui-input` box, the value, a `chevron-down` at `--ic-xs` in `--icon` at the end) that opens a menu of `menuitemradio` items under it, start-aligned and… |  | machine | M: no `<select>` in the DOM; pickers are buttons with aria-haspopup opening menuitemradio items |
| [R-select-2](DESIGN-SYSTEM.md#1432-selects-and-listboxes) | Long lists (fonts, models) keep the menu's typeahead (a letter jumps, 14.18) and scroll inside past the window's height (R-float-4) |  | machine | M: typeahead moves focus; long menus scroll inside |
| [R-select-3](DESIGN-SYSTEM.md#1432-selects-and-listboxes) | Enter, Space and Alt+Down open it; Up and Down move; Enter picks; Esc closes with no change |  | machine | M: keyboard script; the button's name includes the value |
| [R-select-4](DESIGN-SYSTEM.md#1432-selects-and-listboxes) | A model picker shows each provider's mark in brand colour (owner decision, 10.1); every other picker is monochrome |  | machine | M: brand-coloured model marks only inside the model menu and its chip preview |

## 14.33 Checkboxes and radios

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-check-1](DESIGN-SYSTEM.md#1433-checkboxes-and-radios) | There is no square checkbox | Approved | machine | M: no square checkbox control in the DOM |
| [R-check-2](DESIGN-SYSTEM.md#1433-checkboxes-and-radios) | A radio is an option row's ring: empty in `--mark-off`, the chosen one filled brass (a shape change as well as a colour), the row `--current` while focused with the inset ring |  | machine | M: radio rings --mark-off empty, brass when checked |

## 14.34 Sliders

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-slider-1](DESIGN-SYSTEM.md#1434-sliders) | No slider track | Approved | machine | M: no `input[type=range]` and no bar-shaped slider |

## 14.35 Interactive states

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-state-1](DESIGN-SYSTEM.md#1435-interactive-states) | Every control draws exactly the states of the table above with those tokens; a state not in the table does not exist |  | machine | M: per control family, computed styles in each state equal the table |
| [R-state-2](DESIGN-SYSTEM.md#1435-interactive-states) | State lives in ARIA or data attributes, never in classes such as `.is-active` |  | machine | M: no state classes (`is-active`, `is-selected`, `active`, `selected`) in library markup |
| [R-state-3](DESIGN-SYSTEM.md#1435-interactive-states) | Hover styles apply only where a pointer hovers: every hover rule sits under `@media (hover: hover) and (pointer: fine)` | Approved | machine | M: every :hover rule is inside the pointer media query |
| [R-state-4](DESIGN-SYSTEM.md#1435-interactive-states) | Hover in over `--dur-1`, out over `--dur-out`, press over `--dur-press`; focus never transitions |  | machine | M: transition durations swap --dur-1 / --dur-out; focus has no transition |
| [R-state-5](DESIGN-SYSTEM.md#1435-interactive-states) | Three meanings, never mixed: `--current` is where you are (the current row, the active text tab, a focused menu item, the listening mic); the bone `--selected` fill is the chosen value or the… |  | machine | M: no element with both --current and --selected fills |
| [R-state-6](DESIGN-SYSTEM.md#1435-interactive-states) | Disabled: a control with text or an icon takes the role colours (`--text-quiet`, `--icon-off`); a control drawn in fills (send, switch, field) takes one opacity, `--disabled-alpha` (.45) | Approved | machine | M: disabled filled controls have opacity == --disabled-alpha |
| [R-state-7](DESIGN-SYSTEM.md#1435-interactive-states) | Busy shows `aria-busy` and the running dot or the Stop it became; never a spinner (R-load-1) |  | machine | M: busy regions set aria-busy; no rotating animation anywhere |

## 14.36 Loading, errors and unknown

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-load-1](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | No spinners and no shimmering skeletons |  | machine | M: no infinite rotate animation and no shimmer gradient |
| [R-load-2](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | A region waiting for its first data keeps its frame (its head, title and hairlines) and draws nothing in its body; if it is still empty after `--load-delay` (600ms), one quiet line appears there:… | Approved | machine | M: a loading region shows only its frame, then one line after 1.8s |
| [R-error-1](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | An error stays where it happened: a field shows it below the field, an action in its card (the error card), a view that cannot load in its empty state with the problem and the way out ("Could not… |  | machine | M: no toast or dialog carries an error; errors render in the field, card or view |
| [R-error-2](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | Only the message and a field's line are `--red-text` and `--red`; a failed gate or sign-in is the "failed" stamp |  | machine | M: red only on the error message and field line (R-colour-2) |
| [R-unknown-1](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | Unknown is shown as unknown: the word "unknown" where the value would be (mono quiet where the value would be mono), never a placeholder number, a dash or a guess (AGENTS invariant 5) |  | machine | M: unknown values render as the word 'unknown'; no '-', '--', '0' placeholders for missing data (fixtures with missing fields) |

## 14.37 Tables and data

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-table-1](DESIGN-SYSTEM.md#1437-tables-and-data) | Reference data is a two-column grid, as the keymap is (`shell.css .hx-keys`): the label at the start, the value at the end, 8 0 per line, a `--hair` between lines, none after the last |  | machine | M: reference grids: 8px vertical padding, hairline between, none after the last |
| [R-table-2](DESIGN-SYSTEM.md#1437-tables-and-data) | A table with more columns has no vertical rules and no zebra stripes; its header is 12/500 `--text-quiet` in sentence case; rows are `--row-h` with a `--hair` between; numbers are right-aligned… | Approved | machine | M: tables have no vertical borders or zebra; numbers right-aligned tabular |
| [R-data-1](DESIGN-SYSTEM.md#1437-tables-and-data) | Measures, progress and positions are dots, never bars (owner decision; 14.27) |  | machine | M: no progress/meter/bar elements; measures are dot rows |

## 14.38 Forms

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-form-1](DESIGN-SYSTEM.md#1438-forms) | A form is one card family (owner decision, `apps/desktop/AGENTS.md`): one renderer from the schema, every field a library field (14.25), one column, label above, hint or error below, the actions… |  | machine | M: form cards from the one renderer; fields are `.ui-field`; primary last |
| [R-form-2](DESIGN-SYSTEM.md#1438-forms) | Rhythm: 6 from a label to its field, 12 (`--sp-3`) between fields (`cards.css .cd-form`), 24 between groups, 48 before a new block (7) |  | machine | M: label-field gap 6, field-field 12 |
| [R-form-3](DESIGN-SYSTEM.md#1438-forms) | A secret field never shows the saved value again; it says where the value is kept |  | machine | M: a saved secret field never contains the value (unit `live-forms`) |

## 14.39 Native controls

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-native-1](DESIGN-SYSTEM.md#1439-native-controls) | Nothing the platform draws ever shows (decision of 19 November 2026): no `<select>` popup, no date, time or colour picker, no file button, no range, no number spin buttons, no search cancel… |  | machine | M: no `select`, `input[type=range\|date\|time\|color\|file\|number\|search]` in the DOM; inputs have `appearance: none`; no `title` attributes; no `resize` other than none |
| [R-native-2](DESIGN-SYSTEM.md#1439-native-controls) | Text inputs stay native elements drawn by `.ui-input`; they keep a native arc for their corner (an `<input>` cannot hold the `::after` that draws the line, 8.1), a brass caret and the… |  | machine | M: text inputs carry `.ui-input`, caret --brass |
| [R-native-3](DESIGN-SYSTEM.md#1439-native-controls) | The customizer's colour row is its swatch and hex field; the mock-up's `<input type="color">` is replaced by a swatch button that focuses the hex field (F42) |  | machine | M: no `input[type=color]` in the customizer |

## 15. Accessibility

| ID | Rule | Status | How | Check |
|---|---|---|---|---|
| [R-a11y-1](DESIGN-SYSTEM.md#15-accessibility) | WCAG 2.2 AA is the floor (the app's rule in `apps/desktop/AGENTS.md`; this section's audit was 2.1): zero axe violations in every preset at 1440, 720 and 390 | Tightened | machine | M: axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa) zero violations, 4 presets x 1440/720/390 |
| [R-a11y-2](DESIGN-SYSTEM.md#15-accessibility) | A pointer target is at least `--hit-min` (24 × 24), or a mark smaller than that gets a hit area of 24 around it (page dots, the context measure) |  | machine | M: every interactive element's hit box >= 24 x 24 |
| [R-a11y-3](DESIGN-SYSTEM.md#15-accessibility) | Label in name: an accessible name contains the visible text, in order; icon buttons are named; orbs and icons are hidden and their holder is named |  | machine | M: accessible name contains the visible text in order (axe label-content-name-mismatch) |
| [R-a11y-4](DESIGN-SYSTEM.md#15-accessibility) | Everything the pointer does, the keyboard does (`KEYMAP.md`); one tab stop per composite (lists, segmented controls, pages) |  | machine | M: the KEYMAP walk-through (smoke `keys`) |
| [R-a11y-5](DESIGN-SYSTEM.md#15-accessibility) | Focus is never hidden behind the composer, the dock, a fixed head or a toast (R-focus-6) |  | machine | M: same as R-focus-6 |
| [R-a11y-6](DESIGN-SYSTEM.md#15-accessibility) | Reflow: no horizontal scroll at 390 or 720 (200%) |  | machine | M: no horizontal overflow at 390 and 720 |
| [R-a11y-7](DESIGN-SYSTEM.md#15-accessibility) | State changes are announced politely (`role="status"`, `aria-live="polite"`); never assertive |  | machine | M: no aria-live=assertive; status changes in polite regions |
| [R-a11y-8](DESIGN-SYSTEM.md#15-accessibility) | Text 4.5:1, non-text marks and the focus ring 3:1 on every surface they sit on (R-colour-6) |  | machine | M: contrast of rendered text and marks against their composited background (axe color-contrast plus the pairs) |

## Totals

220 rules: 211 machine, 4 both, 5 by eye. The 18 formerly proposed rules were approved in review on 19 November 2026.

## Approved in review (19 November 2026)

Approved as written, except three amended: R-check-1 (a form's several-choice list shows its marks at rest), R-state-3 (what hover reveals also shows on focus and on a tap), R-load-2 (the quiet line after 600ms, `--load-delay`).


- **R-type-3** Three weights, by role: 600 only for titles (display, title, card title, panel and dialog titles); 500 for buttons, tabs and segmented options, chips, field labels, group headings and stamps; 400….
- **R-layout-1** Window breakpoints are 560 (the call-number margin collapses), 640, 900 and 1200 (both sidebars push; mod panes become tabs).
- **R-scroll-2** Geometry: the bar's box is `--scroll-size` 10px; the thumb a capsule `--scroll-thumb` 4px wide, centred, 6px (`--scroll-thumb-active`) while hovered or dragged, never shorter than 32px….
- **R-scroll-3** The thumb is `--scroll-thumb-color` (`--bg-4`, the mock-up's) at rest and `--scroll-thumb-color-active` (`--mark-off`, 3:1 like every non-text mark) while hovered or dragged.
- **R-scroll-4** Bars are inset, never overlay: none of the three engines gives a styled overlay bar, so the bar takes its 10px at the scroller's end.
- **R-scroll-5** Where a scroller's end meets a curved corner of its container (a dialog body's foot, a menu, a popover, the palette list, a sheet), the track is inset by that corner's radius….
- **R-corner-5** The edge band shares the corner: every piece on the same band as a corner piece (the same inset from that edge, for example a dialog head's tabs beside its close button) takes the corner piece's….
- **R-elev-6** A modal dialog uses the top layer (`showModal`), above every `--z-*`; every layer opened from inside it (a menu, a popover, the tooltip) mounts inside the dialog, so it stays above it; a toast….
- **R-seg-3** A segmented control on a container's edge band takes the band's radius for its track (`--r-outer: var(--r-in-dialog)` in a dialog head), and its thumb follows (`band − 3`).
- **R-float-1** A menu, a popover and a tooltip sit `--float-gap` (8) from their anchor and at least `--float-margin` (8) from the window edge, below the anchor unless it only fits above.
- **R-tip-2** It shows below its anchor, above within 160px of the window's bottom, to the right in the rail; and it never covers the text you are typing: a tooltip for a control inside a container that holds a….
- **R-search-3** The leading glyph is centred in a square as tall as its field: its centre is half the field's height from the edge.
- **R-check-1** There is no square checkbox.
- **R-slider-1** No slider track.
- **R-state-3** Hover styles apply only where a pointer hovers: every hover rule sits under `@media (hover: hover) and (pointer: fine)`.
- **R-state-6** Disabled: a control with text or an icon takes the role colours (`--text-quiet`, `--icon-off`); a control drawn in fills (send, switch, field) takes one opacity, `--disabled-alpha` (.45).
- **R-load-2** A region waiting for its first data keeps its frame (its head, title and hairlines) and draws nothing in its body; if it is still empty after `--load-delay` (600ms), one quiet line appears there:….
- **R-table-2** A table with more columns has no vertical rules and no zebra stripes; its header is 12/500 `--text-quiet` in sentence case; rows are `--row-h` with a `--hair` between; numbers are right-aligned….
