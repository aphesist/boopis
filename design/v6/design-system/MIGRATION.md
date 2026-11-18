# Migrating the modules to the shared library

For the module agents. The design-system agent wrote `components/components.css` and `components/components.js`
(`HX.ui`) and did not touch any module file; each module moves itself, using this list. The system and the reasons
are in `DESIGN-SYSTEM.md`; the live reference is `design-system/index.html` (it renders the real library).

**The rule:** if a piece is in the inventory below, the module deletes its own version and calls the library. A
module keeps only what is genuinely its own (its layout, its data, its singletons). No module re-styles a `.ui-*`
class; if the library is missing a variant you need, ask for it instead of forking it.

## 0. Wiring (shell owner, once)

1. `index.html` load order becomes:
   `tokens.css`, `theme.js`, **`components/components.css`**, `shell.css`, `cards.css`, `session.css`, `bots.css`,
   `dock.css`; then `shell.js`, `data.js`, **`components/components.js`**, `cards.js`, `session.js`,
   `vendor/orb-avatar.min.js`, `bots.js`, `dock.js`. (`components.js` must come after `shell.js`, which defines `HX`,
   and before every module that calls `HX.ui`.)
2. Add `ui-root` to the app root (`<div class="hx ui-root" id="hx-app">`): selection, caret, scrollbars and the
   base focus ring then come from the library; delete the same four rules from `.hx` in `shell.css`.
3. Every `*.test.html` loads the same two files after `tokens.css`.
4. Promote the library tokens into `tokens.css` (then delete them from the top of `components.css`): `--dur-out`
   120ms, `--dur-slide` 240ms, `--dur-breathe` 1.8s, `--dur-hold` 1000ms, `--line-field`, `--ink-on-dock`,
   `--ink-on-dock-strong`, `--brass-base`, with the reduced-motion and `data-hx-theme="light"` lines that go with
   them. (`--brass-base` captures the accent on `:root` so the dock ground can re-derive `--brass` without a
   self-reference: `--brass: color-mix(… var(--brass) …)` on one element is a cycle and silently voids the accent and
   the focus ring.) **Done** (18 November 2026).
5. Apply the Bone contrast fixes in `tokens.css`: `--add: #356b43`, `--del: #a63d35`, `--red-text: #a82328`. Delete
   `--r-xl` (and its two modifier values) once nothing reads it. Run `node design-system/build-tokens.mjs --report`.
   **Done.**
6. Promote `--mark-off` (inactive non-text marks: page dots, ladder stations to come, empty option rings) into
   `tokens.css` after `--line-field`: `--mark-off: color-mix(in srgb, var(--text-quiet) 55%, var(--text-faint));`
   (3.3–4.2:1 on every surface of every preset). Then delete the `:root { --mark-off … }` line from `components.css`
   (keep the `--mark-off: var(--text-faint)` line under `[data-ground="dock"]`). Add to `theme.js PAIRS`:
   `['--mark-off', '--bg-1', 3, 'Inactive marks on the frame']`, `['--mark-off', '--bg-3', 3, 'Inactive marks on raised
   surfaces']` and `['--mark-off', '--bg-1', 3, 'Dock inactive marks on black', 'dock']`, with `'--mark-off': ['--text',
   '--bg-2']` in `DOCK_BLAME`. **Done.**
7. **Corners (owner rules, 18 November 2026; wireframe agent).** In `tokens.css`, replace the corner block in `:root`
   (`/* corners (default): small, like catalog cards */` and the five `--r-*` lines) with:

   ```css
     /* corners: continuous where the engine has corner-shape (the @supports block below), a round arc otherwise.
        Nested corners: inner = max(--r-floor, outer − gap) (DESIGN-SYSTEM.md §8) */
     --r-xs: 5px;                /* kbd, code chips, stamps */
     --r-s: 7px;                 /* buttons, rows, fields, chips, the segmented track, tooltips, wells */
     --r-m: 12px;                /* cards, composer, menus, popovers, toasts */
     --r-l: 16px;                /* where the ground meets the frame, the dock, dialogs, palette */
     --r-pill: 999px;            /* dots, the switch, anything inside a pill */
     --r-floor: 4px;             /* the smallest inner radius of a nested corner */
     --corner: round;            /* the corner shape; superellipse(1.8) where supported */
     --composer-pad: 6px;        /* the composer's actions sit this far from its edge */
   ```

   and replace the two corner modifier lines with:

   ```css
   :root[data-hx-corners="sharp"] { --r-xs: 2px; --r-s: 3px; --r-m: 6px; --r-l: 9px; --r-floor: 2px; }
   :root[data-hx-corners="round"] { --r-xs: 7px; --r-s: 11px; --r-m: 18px; --r-l: 22px; --r-floor: 6px; }
   @supports (corner-shape: superellipse(2)) {
     :root { --corner: superellipse(1.8); --r-xs: 7px; --r-s: 10px; --r-m: 16px; --r-l: 22px; --r-floor: 5px; }
     :root[data-hx-corners="sharp"] { --r-xs: 3px; --r-s: 5px; --r-m: 9px; --r-l: 13px; --r-floor: 3px; }
     :root[data-hx-corners="round"] { --r-xs: 10px; --r-s: 16px; --r-m: 26px; --r-l: 32px; --r-floor: 8px; }
   }
   ```

   Keep the `@supports` block after the two modifier lines (same specificity, so order decides). Then tell the
   design-system agent, who deletes the token lines at the top of `components.css` (the `:where(*)` corner-shape rule,
   the round list and `.ui-nest`/`.ui-fit` stay in the library). Run `node design-system/build-tokens.mjs`. **Done**
   (the library's copies are deleted; resolved values unchanged in the specimen and the shell, every preset).

## 1. Inventory: every duplicated piece and its one canonical design

| Piece | Where it is drawn today | How they differ | Canonical | Library |
|---|---|---|---|---|
| Hold to approve | `cards.js holdController` + `.cd-hold`; `dock.js holdBtn/holdStart/holdStop` + `.dk-hold`; `bots.js` fallback + `.bt-hold` | Dot field vs scaleX fill with a blend-mode label vs a 14% overlay on a bone button; 1000 / 650 / 1100ms; card stock vs bone at rest; dock has no Enter-twice path | Cards' version: card stock at rest, Bayer dot field fusing into bone, 1000ms, Space hold or Enter twice, announced | `HX.ui.hold()`, `HX.ui.html.hold()` + `HX.ui.hold.wire(btn)`, `ui:commit` |
| Approval (and every card) | `cards.js` (all kinds); `dock.js` needs-you rows (`.dk-wait-row`) and the bot card's ask (`.dk-ask`); `bots.js` fallback `.bt-card` | Three layouts, three button sets, different meta formats | The card layer: `<hx-card>` approval in inline, compact or mini, `ground: 'dock'` in the dock | `HX.ui.card(kind, data, {size, ground})` (= `HX.cards.create`) |
| Dock ink palette | `dock.css .dk` (25 `--dock-*` tokens, light switch on `data-hx-theme`); `cards.css hx-card[data-ground="dock"]` (`light-dark()`) | Two derivations of the same black ground | One scope that re-derives the usual roles | `data-ground="dock"` (components.css) |
| Buttons | `.ss-btn`, `.cd-btn`, `.bt-btn/.bt-primary/.bt-secondary`, `.dk-btn`, `.hxt-btn`, `.hx-stub-btn` | Hover 120 vs 150ms; disabled as colour, as `--bg-3`, as `--bg-4` or at .4 opacity; dock padding 12 vs 14; dock hover strengthens the line | Primary, secondary, ghost, small; disabled `--text-quiet` (primary on `--bg-4`); in 150 / out 120 | `HX.ui.button()`, `.ui-btn`, `.ui-btn--primary`, `--ghost`, `--s` |
| Icon buttons | `.hx-ib`, `.hx-wb`, `.ss-ib`, `.bt-iconbtn`, `.dk-icon-btn` | Dock has no press scale and rests on `--dock-dim`; hover only for fine pointers in one | 28px, 18px glyph, hover fine-pointer only, press .96, pressed = brass | `HX.ui.iconButton()`, `.ui-ib`, `--window`, `--s` |
| Send | `.ssc-send`, `.bt-send`, `.hx-stub-send` | Disabled .35 vs .4; bots' arrow is 1.8 stroke | Bone square, 16px glyph, .35 disabled, Stop while running | `HX.ui.html.send()`, `.ui-send` |
| Composer | `session.js createComposer` (`.ssc`); `bots.js buildComposer` (`.bt-composer`); `.hx-stub-composer` | contenteditable vs textarea; chips 26 vs 24px and quiet vs dim; feedforward only in session | Session's: contenteditable with feedforward, hint, chips slot, capacity, mic, send/stop | `HX.ui.composer()` |
| Toolbar chips | `.ssc-chip`, `.bt-chip` | Height, colour, the strike-through when off | 26px, `--text-dim`, pressed: `--text` + brass icon, off: struck through | `HX.ui.chip()`, `.ui-chip`, `--mono` |
| Option chips | `.bt-preset` | One module; brass ring when on | `--current` fill + brass inset line | `HX.ui.chipGroup()`, `.ui-chip--option` |
| Switch | `.hx-switch` (shell, reused by session and bots as `.ssr-switch`, `.bt-switch`); `.dk-toggle .dk-sw` (dock button) | Native input vs `button role="switch"` | Native checkbox `role="switch"` | `HX.ui.switch()`, `.ui-switch` |
| Segmented | `.hx-seg`, `.hx-rail__seg`, `.ssr-seg`, `.bt-seg` (twice), `.hx-choice` | `transform` vs `translate`; group vs radiogroup vs tablist; `.hx-choice` has no sliding thumb | Track, sliding thumb, tabs or radio, arrows move and select | `HX.ui.segmented({mode, size, vertical, fill})` |
| List rows | `.ssl-row`, `.bt-row`, `.hx-stub-item`, `.dk-roster-item` | Padding 0 4 0 12 vs 0 12 0 10; `aria-selected` options with buttons inside (invalid) vs buttons with a class for current | A button row in `li`, `aria-current`, actions as siblings, glyph on x = 28, label at x = 44 | `HX.ui.row()`, `HX.ui.group()`, `[data-ui="rows"]` |
| Group headings | `.ssl-head`, `.hx-stub-list h3`, `.hx-pal-group`, `.ssp-title`, `.hxt-group`, `.hx-set h3`, `.bt-suggest-h` | Same look written seven times | 12/500 quiet, chevron when collapsible | `.ui-group__head`, `.ui-menu__title`, `.ui-set__head` |
| Menus | `.hx-menu` (account), `.ssp` + `menu()` (session popovers), `.cd-opt` (card options) | Edge `--line` vs `--hair`; focus fill vs inset ring; checked square vs check | Frame, `--line` + pop shadow, focus = `--current` + inset brass ring, checked = brass check, typeahead | `HX.ui.menu.open()`, `.ui-menu`, `.ui-menu__item` |
| Popovers | `session.js pop`, `cards.js openBlank` | Two positioning and focus loops | One layer at a time, placed against its anchor, Esc returns focus, Tab loops | `HX.ui.popover.open()` |
| Tooltips | `shell.js showTip` + `.hx-tip`; `session.js tip` + `.ss-tip`; `dock.js showTip` + `.dk-tip` | Delays, paddings, kbd colour (fails 4.5:1), the dock's state line | The shell's behaviour (480ms, warm 700ms, instant on focus), one element, `data-tip-state` for a bot's state | `[data-tip]`, `data-kbd`, `data-tip-pos`, `data-tip-state`; `HX.ui.tooltip` |
| Toasts | `shell.js toast` + `.hx-toast`; `.ssl-toast` (inline Undo) | One with an action, one without | One toast with an optional ghost action | `HX.ui.toast(text, {action})` |
| Kbd | `:where(.hx kbd)`, `.ssp-kbd`, `.ss-tip kbd`, `.cd-opt__key` | `--text-quiet` vs `--text-dim`; padding 3 5 vs 0 4 | 18px chip, `--text-dim` | `HX.ui.keys('mod+K')`, `.ui-kbd` |
| Code chips | `.ss-code`, `.cd-code`, `.bt-code`, `.hx-answer code` | 12.5 vs 12px; padding 1 5 vs 0 6 vs 2 5 | 12px, padding 1 5, wraps with cloned background | `HX.ui.code()`, `HX.ui.html.inline()` |
| Stamps | `.ss-stamp`, `.cd-stamp`, `.hx-stamp` | Tracking on one | 20px, 0 7, mono 11/500, red line | `HX.ui.stamp()` |
| Status dots | `.ss-dot--*`, `.hx-dot`, `.bt-dot`, `.bt-run`, `.cd-dot`, `.cd-breath`, `.dk-wdot`, `.dk-att-dot`, `.dk-flag`, `.dk-card-state::before` | Two breathing animations; sizes 5, 6, 8 | 6px; run breathes (`--ease-io`, alternate); flag 8px with a surface ring | `HX.ui.dot(kind)` |
| Ladder | `.ssr-ladder/.ssr-rung`, `.cd-ladder`, `.cd-steps`, `.dk-ladder/.dk-tick`, `.dk-ladderx`, `.bt-ladder` | 3px ticks, 5, 7, 8/10 with a halo, 9px rings | Line (5px) and list (8px), brass station, no halo, brass never text | `HX.ui.ladder({variant: 'line'|'list'})` |
| Context and capacity | `.ssr-measure`, `.ssr-dots`, `.dk-segs` (bar), `.dk-meter` (bar), `.dk-cost-text`, `.ssc-spend`, `.bt-spend` | Dots vs bars; three spend styles | Dots (strip, grid, row) and the mono running total | `HX.ui.measure()`, `HX.ui.legend()`, `HX.ui.capacity()` |
| Page dots | `.dk-dots/.dk-dot` + indicator, `.cd-qdots` | Tablist vs image; same look | One component, interactive or still | `HX.ui.pages()` |
| Orbs | `cards.js orb()`, `dock.js makeOrb/miniOrb`, `bots.js orb()` | Render size, motion, eye colour for dark bodies, hover reaction | One wrapper, the same state map, light eyes on dark bodies | `HX.ui.orb(bot, {size, render, flag, motion, still})` |
| Bot states | `bots.js STATE_WORD/reactionFor`, `dock.js STATE_WORD/phrase/reactionOf` | "done" vs "finished a task", "working" vs "running a job"; done→happy vs paused→sleeping | One map | `HX.ui.states`, `HX.ui.botState(bot)`, `HX.ui.html.stateWord(bot)`, `HX.ui.botLabel(bot)` |
| Entry and call number | `.ss-entry/.ss-callno`, `.bt-entry/.bt-callno`, `.hx-entry/.hx-callno` | Same grid three times | One | `HX.ui.entry()`, `.ui-callno` |
| Request card | `.ss-request`, `.bt-request`, `.hx-request` | Same | One | `HX.ui.request()` |
| Steps disclosure | `.ss-work` + `.ss-steps` | One module | One | `HX.ui.disclosure()`, `HX.ui.steps()` |
| Blank mark | `.ss-blank/.ss-gap/.ss-stamp`, `.cd-blank` | 56px vs 7ch gap | The card layer's blank | `HX.ui.card('blank', …, {size: 'inline'})` |
| Panel and sections | `.ssr-panel/.ssr-head/.ssr-sec*`, `.bt-sheet/.bt-sh-*`, `.hx-stub-panel` | Two heads, two section rules | `.ui-panel` head, body, foot; disclosure sections | `.ui-panel`, `HX.ui.section()` |
| Fields | `.bt-field/.bt-input`, `.ssp-field`, `.cd-free`, `.hxt-select`, `.hxt-hex`, `.hxt-json`, `.ssl-title input` | `--line` outline (1.35:1), offsets 1 vs 2 | `--line-field`, ring on the field | `HX.ui.field()`, `.ui-input` |
| Settings rows | `.hx-set__row`, `.hxt-row`, `.bt-toggle`, `.bt-sh-sec`, `.dk-toggle` | Same pattern five ways | Label and hint left, control right, hairline | `HX.ui.setRow()`, `.ui-set__head` |
| Icons | `index.html` sprite, `session.js ICONS`, `bots.js ICON`, `dock.js ICON` | Three grids, strokes 1.35–1.93px rendered | One set, 1.5px non-scaling | `HX.ui.icon(name)` |
| Screen-reader text | `.ss-sr`, `.cd-sr`, `.dk-sr` | Three copies | One | `.ui-sr`; `HX.ui.announce(text)` |
| Concave corner | `.hx-corner`, `.bt-sheet::before`, `.hx-stub-dock::before/::after` | Same gradient three times | One helper | `.ui-concave[data-at]`; `.ui-slab` for a still dock |
| Empty state | `.ss-empty`, `.hx-stub-empty`, `.dk-empty`, `.bt-empty` | Same | One | `HX.ui.empty()` |

## 2. Shell (`index.html`, `shell.css`, `shell.js`)

Delete from `shell.css`, then call or use:

| Delete | Use instead |
|---|---|
| `:where(.hx :focus)`, `:where(.hx :focus-visible)`, `::selection`, `caret-color`, `scrollbar-*` on `.hx` | `ui-root` on `#hx-app` |
| `:where(.hx kbd)`, `.hx-keys-chips` | `HX.ui.html.keys()` (`.ui-kbd`, `.ui-keys`) |
| `.hx-ib`, `.hx-wb`, `.hx-ib--toggle .i-fill` | `HX.ui.html.iconButton({icon, label, keys, expanded, window})`; the sprite's `i-fill` becomes `.is-fill-on` |
| `.hx-seg`, `.hx-seg__thumb`, `.hx-seg__tab`, `.hx-rail__seg`, `.hx-rail__thumb`, `.hx-rail__tab`, `.hx-dot` | `HX.ui.segmented({label: 'View', options: [{value: 'session', label: 'Session', dot}, {value: 'bots', label: 'Bots', dot}], fill: true})` and the same with `vertical: true` and icons for the rail. Listen to `ui:change`; set the dot with `[data-show]` |
| `.hx-new` button styles | `HX.ui.button({label: 'New session', icon: 'plus', variant: 'ghost', keys: 'mod+shift+O', showKeys: true})` (the sidebar may keep its full-width placement rule) |
| `.hx-menu`, `.hx-menu__item`, checkbox `::before`, `.hx-menu__sep`, `openMenu()` | `HX.ui.menu.open(accountButton, items, {place: 'above'})` with `{label: 'Show the dock', role: 'menuitemcheckbox', checked, keys: 'mod+J'}` items; keep `.hx-menu__who` as a menu title row or a header above the items |
| `.hx-tip`, `showTip()`, `hideTip()`, the `pointerover/out` and `focusin` tooltip listeners, `#hx-tip` | `HX.ui.tooltip.enable()` (automatic when `#hx-tip` is gone); keep `data-tip`, `data-kbd`, `data-tip-pos` as they are |
| `.hx-toast`, `toast()` body | `HX.ui.toast(text, {action})`; keep `HX.toast` as a one-line wrapper and the `hx:toast` listener |
| `.hx-palette__box` surface rules | keep the palette as a shell singleton; its box takes `.ui-pop`'s surface tokens; `.hx-pal-row` becomes `.ui-row` at `--row-h` (34px is off-scale); `.hx-pal-group` becomes `.ui-group__head` |
| `.hx-dtab` | `HX.ui.segmented` is not right for dialog tabs; keep `.hx-dtab` but give it `--dur-1`, `--current` and `.ui-btn`'s press (it already matches) |
| `.hxt-preset` focus, `.hxt-select`, `.hxt-hex`, `.hxt-json`, `.hxt-btn`, `.hx-choice`, `.hx-switch`, `.hx-set h3`, `.hx-set__row` | `theme.js` renders `.ui-input`, `.ui-input--mono`, `.ui-btn`, `HX.ui.html.segmented({mode: 'radio', size: 's'})`, `.ui-switch`, `.ui-set__head`, `.ui-set__row` (theme.js is shell-owned) |
| `.hx-stamp`, `.hx-entry`, `.hx-callno`, `.hx-request`, `.hx-answer`, `.hx-stub-*` placeholders | `HX.ui.html.stamp/entry/request`, `.ui-prose`, `HX.ui.empty`, `.ui-slab` (the stubs are placeholders; render them with the library) |
| `.hx-corner--left/right` gradients | `.ui-concave[data-at="tl"|"tr"]` (keep the shell's positioning) |
| The SVG sprite in `index.html` | `HX.ui.icon(name)`; keep the φ path (it is in the library as `phi`) |

Keep: the frame, the title bar layout, the command field, the sidebars' geometry and axes, the views, the right
panel's slot and travel, the dock slot, the scrim, the palette and dialog as singletons, shortcuts, `HX.*` API.

Delete now (moved into the library): `.hx-rail__seg .ui-dot { position: absolute; top: 5px; right: 5px; }`. The library
places the attention dot on the corner of any vertical or icon-only segmented option.

`theme.js` (shell-owned) also needs: **fix `hexOf`/`compositeOf`** to read `color(srgb r g b / a)` (Finding F6); add the
pairs listed in DESIGN-SYSTEM.md 5.4 to `PAIRS`; render its rows with the library classes above.

## 3. Session (`session.css`, `session.js`)

| Delete | Use instead |
|---|---|
| `ICONS`, `icon()` | `HX.ui.icon(name)` (names: `chev` → `chevron`, `down` → `chevron-down`, `up` → `send`, `x` → `close`) |
| `.ss-ib`, `iconBtn()` | `HX.ui.iconButton({icon, label, keys})` |
| `.ss-btn`, `.ss-btn--primary`, `.ss-btn--s` | `HX.ui.button({label, variant, size})` |
| `.ss-sr` | `.ui-sr` |
| `.ss-dot--run/attn/here`, `ss-breathe` | `HX.ui.dot('run'|'attention'|'here')` |
| `.ss-code` | `HX.ui.code()` |
| `.ss-entry`, `.ss-callno`, `.ss-body`, `.ss-request` | `HX.ui.entry({kind, callno, steps, body})`, `HX.ui.request(text)` |
| `.ss-work`, `.ss-steps`, `.ss-step*` | `HX.ui.disclosure({label: '6 steps', controls})`, `HX.ui.steps(items, {id, hidden: true})` |
| `.ss-prose` | `.ui-prose` |
| `.ss-blank`, `.ss-gap`, `.ss-stamp`, the blank popover built in session.js (the `.ssp-field` "Or type an answer") | `HX.ui.card('blank', data, {size: 'inline'})`; the card layer owns the popover |
| `.ss-ship` | `HX.ui.card('ship', data)` |
| `createComposer()`, `.ssc`, `.ssc-*` (box, input, bar, chip, spend, send, hint, file, dw) | `HX.ui.composer({placeholder, value, spend, chips: [{label: 'Governed', icon: 'ladder', pressed}, {label: 'Smart', icon: 'spark', pressed}], hint, feedforward})`. Move the DECISIONS reading into `feedforward: (text) => [{text, kind, confirmed}]` and open its menu on `ui:decision` with `HX.ui.menu.open(e.detail.el, items, {place: 'above'})`. Keep `HX.composer.create` as a thin alias for one release |
| `.ssc-mic[aria-pressed="true"] { color: var(--red-text) }` | the library's pressed state (brass); recording is not owed (F9) |
| `pop` (popover singleton), `menu()`, `.ssp`, `.ssp-*` | `HX.ui.menu.open(anchor, items, {label, place, align})`, `HX.ui.popover.open(anchor, node)` |
| `tip` (fallback tooltip), `.ss-tip` | nothing: `HX.ui.tooltip` answers `[data-tip]` everywhere |
| `.ssl-head`, `.ssl-row`, `.ssl-glyph`, `.ssl-title`, `.ssl-meta`, `.ssl-acts`, `.ssl-rows`; the `role="listbox"`/`option` semantics | `HX.ui.group({label: project, collapsible: true, rows})` with `HX.ui.html.row({title, end: when, current, archived, lead: HX.ui.html.leadFor({running, attention, current}), acts})`. Rows become buttons with `aria-current`; rename and archive are sibling buttons (an option may not contain buttons) |
| `.ssl-toast` | `HX.ui.toast('Archived "' + title + '"', {action: {label: 'Undo', onClick}})` |
| `.ssr-head`, `.ssr-body`, `.ssr-panel` | `.ui-panel`, `.ui-panel__head`, `.ui-panel__title`, `.ui-panel__body` |
| `section()`, `.ssr-sec*` | `HX.ui.section({label, meta, open, body, name})`; flash with `data-flash` |
| `.ssr-measure`, `.ssr-dots`, `.ssr-sw` | `<button class="ui-measure-btn" data-tip="Context 38% used" data-kbd="mod+period">` + `HX.ui.html.measure({used, total, dots: 8})`; `HX.ui.measure({variant: 'grid', total, parts})` + `HX.ui.legend(parts)` |
| `.ssr-seg` | `HX.ui.segmented({mode: 'radio', fill: true, options: Governed, Ungoverned})` |
| `.ssr-ladder`, `.ssr-rung` (and its brass halo and brass `.ssr-when`) | `HX.ui.ladder({stations: G.ladder, current: G.current, variant: 'list', off: !G.governed})` |
| `.ssr-switch` | `HX.ui.switch({id, checked})` in `HX.ui.setRow({label, hint, for: id, control})` |
| `.ss-chev`, `.ss-n` | `HX.ui.icon('chevron')`; counts as `.ui-mono` with `--add` and `--del` |
| The " · " in environment values | split and set the parts apart with space (F22) |

Keep: the view, the scroller and its mask, the inline diff (`.ss-diff*`: session-only), the terminal well
(`.ssr-term`), the task list and file rows (or use `.ui-row` for files), the list's rename input (style it
`.ui-input`), `HX.session` API.

## 4. Bots (`bots.css`, `bots.js`)

| Delete | Use instead |
|---|---|
| `ICON` and its SVG helper | `HX.ui.icon(name)` |
| `.bt-iconbtn`, `.bt-btn`, `.bt-primary`, `.bt-secondary`, `.is-armed` (red) | `HX.ui.iconButton`, `HX.ui.button`; armed: `data-armed` and the label "Click again to archive" (F9) |
| `.bt-dot`, `.bt-run` (its own breathing) | `HX.ui.dot('attention')`, `HX.ui.dot('run')` |
| `.bt-field`, `.bt-input`, `select.bt-input`, `.bt-field-select`, `field()` | `HX.ui.field({id, label, hint, kind, value, mono})`; the small cap field `HX.ui.field({mono: true})` in `HX.ui.setRow` |
| `.bt-seg*`, `seg()`, the Colour/Shape/Eyes tabs | `HX.ui.segmented({mode: 'radio'|'tabs', options, value})` |
| `.bt-row*`, rail variant | `HX.ui.row({title: name, sub: role, end: HX.ui.html.stateWord(b), endTone, lead: HX.ui.html.orb(b, {size: 20, flag: true}), current})`; the rail keeps its own 40px row rule but uses `HX.ui.html.orb(b, {size: 24, flag: true})` |
| `STATE_WORD`, `BUSY`, `reactionFor` | `HX.ui.botState(b)` (`.word`, `.reaction`, `.busy`, `.attention`), `HX.ui.html.stateWord(b)` |
| `orb()` | `HX.ui.orb(b, {size, motion: 'lively' for the header, flag})`; keep the hover-listening behaviour on the wrapper |
| `.bt-entry`, `.bt-callno*`, `.bt-request`, `.bt-prose`, `.bt-code` | `HX.ui.entry({kind: 'bot'|'user', who: HX.ui.html.orb(b, {size: 20}) + name, callno: [time], body})`, `HX.ui.request`, `.ui-prose`, `HX.ui.code` |
| The approval fallback (`.bt-card*`, `.bt-hold*`, the hold in `bots.js` ~587) | `HX.ui.card('approval', data, {size: 'inline'})` only; no fallback (the card layer is always loaded) |
| `buildComposer()`, `.bt-composer*`, `.bt-ta`, `.bt-tools`, `.bt-chips`, `.bt-chip`, `.bt-spend`, `.bt-send` | `HX.ui.composer({placeholder: 'Message ' + b.name, chips: [{label: 'Governed', icon: 'ladder', pressed}, {label: 'Also on Slack', pressed: false}], spend, attach: true})`; delete the integration fix at the bottom of `shell.css` (`.bt-tools .bt-chips`), the library's chips slot already shrinks |
| `.bt-sheet` corner `::before`, `.bt-sh-head`, `.bt-sh-title`, `.bt-sh-body`, `.bt-sh-foot`, `.bt-sh-sec`, `.bt-sh-h`, `.bt-sh-hint` | `.ui-panel` (+ `.ui-concave[data-at="tl"]`), `.ui-panel__head` with a close `HX.ui.iconButton({icon: 'close', label: 'Close bot settings'})`, `.ui-panel__body`, `.ui-panel__foot`, `.ui-set__head`, `.ui-field__hint` |
| `.bt-ladder*` | `HX.ui.ladder({stations, current: 0, variant: 'list', label: 'Escalation ladder'})` (the starting station is current) |
| `.bt-presets`, `.bt-preset` | `HX.ui.chipGroup({label: 'Schedule', value, options})` |
| `.bt-toggle*`, `.bt-switch` | `HX.ui.setRow({label, hint, for, control: HX.ui.html.switch({id, checked, disabled})})` |
| `.bt-sugg` | keep (bots-only), but on `--bg-0` with `--hair` it is a card-like button; fine as is |

Keep: the presence header, the new-bot form and its stage, the name input (`.bt-name`, the one display field),
colour/shape/eye pickers (`.bt-opt`, `.bt-swatch`), the cron preview, `.bt-sugg`.

**Owner decision, orbs under reduced motion** (DESIGN-SYSTEM.md section 13): reduce, never freeze. `HX.ui.orb` now
leaves every orb over 16px live under reduced motion, sets `jelly=".12"` there, and marks it for `HX.ui.glance` (small
eye steps). Bots deletes: in `liven()`, the line that removes `static` from orbs over 16px and the line that sets
`jelly=".12"` under reduced motion (call `HX.ui.liven(o, {size})` there instead, or nothing for orbs made by
`HX.ui.orb`); the part of `lifeTick()` that keeps glances going under reduced motion (`HX.ui.glance` does it for every
live orb). Pass `still: true` for picker tiles (up to 28px) that should stay one frame, and `live: true` for an orb
that must animate even at 16px or under.

**The lead orb** (DESIGN-SYSTEM.md section 13). Bots deletes its local nudge: the `setInterval(…, 1800)` after
`orbButton()` (bots.js ~204–213: the blink-or-gaze step on the preview or the presence orb). Once, at start-up, use:

```js
HX.ui.glance.lead(
  () => (S.view === 'new' ? S.newPane && S.newPane.querySelector('.bt-stage orb-avatar') : S.presence),
  { skip: (o) => o._hover || o._held }
);
```

The library then gives that orb a blink (one in three) or a small gaze every 1.8s under reduced motion, keeps the
random steps off it and stops when the preference turns off. The step already waits while the pointer is on the orb;
instead of `skip`, `gentleFollow()` may set `data-glance-hold` on the orb while it holds or glances and remove it on
release.

## 5. Dock (`dock.css`, `dock.js`)

| Delete | Use instead |
|---|---|
| The whole `--dock-*` palette (`.dk { --dock-ink … --dock-seg-4 }` and its `:root[data-hx-theme="light"] .dk` twin) | `data-ground="dock"` on `.dk` (or its stage); read `--text`, `--text-dim`, `--text-quiet`, `--line`, `--hover`, `--selected`, `--brass`, `--red-text`… Keep `--dock-bg` for the path fill |
| `ICON`, `svg()` | `HX.ui.icon(name)` (`sliders`, `close`, `plus`, `stop`, `chevron-down`, `back`, `forward`) |
| `.dk-btn`, `.dk-btn.is-solid`, `.dk-icon-btn`, `.dk-linkbtn`, `.dk-tile-show` | `HX.ui.html.button({label, variant, size})`, `HX.ui.html.iconButton({icon, label})` |
| `holdBtn()`, `holdStart()`, `holdStop()`, `HOLD_MS`, `.dk-hold*` | `HX.ui.html.hold({ariaLabel: 'Hold to approve ' + title})` + `HX.ui.hold.wire(btn)`; listen to `ui:commit`. 1000ms |
| The needs-you rows' Deny / hold / Answer (`.dk-wait-row`, `.dk-wait-acts`), the expanded wait view (`.dk-waitx*`) and the bot card's ask (`.dk-ask*`) | `HX.ui.card(kind, data, {size: 'mini'|'compact', ground: 'dock'})`: minis in the normal view, a compact card in the expanded one. One approval design (F1) |
| `.dk-tip`, `showTip()`, `tipHTMLFor()` | `data-tip="nina, deploys" data-tip-state="needs you" data-tip-tone="attention"` on the orb button; `HX.ui.tooltip` draws it (above the dock: `data-tip-pos="top"`) |
| `.dk-dots`, `.dk-dot*`, `.dk-dot-ind`, `renderDots()` markup | `HX.ui.html.pages({interactive: true, current, pages: [{id, label, attention}]})`; keep the dock's own spring that slides the indicator if you want its travel, on the library's markup |
| `.dk-flag`, `.dk-wdot`, `.dk-att-dot`, `.dk-card-state::before` + `dk-breathe` | `HX.ui.dot('flag'|'attention'|'run', {size})` |
| `STATE_WORD`, `phrase()`, `reactionOf()`, `botLabel()` | `HX.ui.botState(b)`, `HX.ui.botLabel(b)` ("finished a task" and "running a job" go: F8) |
| `makeOrb()`, `miniOrb()`, `EYE_LIGHT`, `luminance()` | `HX.ui.orb(b, {size: 40, render: 80, flag: true})` and `HX.ui.html.orb(b, {size: 16, still: true})`; keep re-parenting live orbs between views (the library's wrapper is the element you move) |
| `.dk-roster*` | `HX.ui.row({title: name, sub: word, lead: HX.ui.html.orb(b, {size: 26, flag: true})})` in a 4-column grid |
| `.dk-ladder`, `.dk-tick`, `.dk-ladderx`, `.dk-tag` | `HX.ui.ladder({stations, current, ground: 'var(--dock-bg)'})` (line) in the normal view, `variant: 'list'` expanded; "running" goes in the row's rule column as text, not brass (F19) |
| `.dk-meter`, `.dk-cost-text`, `.dk-segs` + `--dock-seg-*`, `.dk-ctx-legend` | `HX.ui.capacity(spent, cap)`; `HX.ui.measure({variant: 'grid', total, parts, cols: 20})` + `HX.ui.legend(parts)` (dots, not bars: F18) |
| `.dk-toggle`, `.dk-sw` | `HX.ui.setRow` with `HX.ui.html.switch` (native checkbox) |
| `.dk-sr`, `announce()` live region | `.ui-sr`, `HX.ui.announce(text)` |
| `.dk-empty` | `HX.ui.empty({title, text})` scaled down, or `.ui-row` with a quiet sub line |

Keep: the slab path and its springs, the views and FLIP travel, magnification, wheel and keyboard paging, the arrange
(edit) view and its tiles, `hx:dock` events, the `--hx-center-x` binding.

**Owner decision, orb gestures** (DESIGN-SYSTEM.md section 13): single click pokes; double-click or Enter opens the
bot's chat in the Bots tab; a short press (press and hold) or Space opens the dock card. Today a double-click opens
the card (`case 'card'`: `e.detail === 2` falls through to `openCard()`); change it to `openBotInTab(id)`. Everything
else already matches. Hold to approve is 1 second (owner decision): drop `HOLD_MS = 650`.

**Reduced motion, orbs (Owner decision: reduce, never freeze).** Dock deletes: `rmGaze()`, its `gazeT` timer, the
`rmGaze()` call in `mount()` and the `gaze` clean-up in the reduced-motion listener; any `static` set on row, roster
or card orbs because of reduced motion. Use `HX.ui.orb(b, {size: 40, render: 80, flag: true})`, or keep `makeOrb()`
and call `HX.ui.liven(orb, {size: 40})` on it: either way the orb stays live, gets the lowered jelly while reduced
motion is on and joins the shared `HX.ui.glance` driver (up to three visible live orbs every 1.4–3s, cleared when the
preference turns off), for the bots tab and the dock together. Keep `static` only where `setOrbLife()` stills orbs on
a page that is not showing, and on the 10px minimal-pill and 16px schedule/arrange orbs.

**Dock ground contrast:** `--text-faint` inside `data-ground="dock"` is now ink 42% (3.3–3.6:1 on `#000`, was 32%,
2.3–2.5:1), so inactive page dots and ladder rings pass as non-text marks. Drop any local `--dock-faint` override.
The arrange view's tile dots (`.dk-tile-dot`, `.dk-tile-dot[data-off]`) may read `--mark-off` instead of
`--text-faint`; on the dock ground the two are the same colour, so nothing changes on screen.

## 6. Cards (`cards.css`, `cards.js`)

The card layer is the canonical card implementation (promoted, not rewritten). It moves into the library folder as
`components/cards.css` and `components/cards.js` once these swaps are done, and `HX.ui.card` already points at it.

| Delete | Use instead |
|---|---|
| `holdController()`, `BAYER`, `HOLDS`, `onTheme` for holds, `holdHTML()`, `.cd-hold*` | `HX.ui.html.hold({hintId: c.id + '-hint'})` + `HX.ui.hold.wire(btn, {announce: (t) => card._announce(t)})`; on `ui:commit` call `card._act('approve')`; on press set `card._setState('holding')` (listen for `pointerdown` or watch `data-state="holding"`); `show(progress)` stays available as `btn._hold.show(p)` |
| `.cd-btn`, `.cd-btn--primary`, `.cd-btn--sm` | `.ui-btn`, `.ui-btn--primary`, `.ui-btn--s` (the `btn()` helper builds `HX.ui.html.button({label, variant, size, action})`) |
| `hx-card[data-ground="dock"]` palette and `--cd-dock-ink`/`--cd-dock-brass` on `:root` | `data-ground="dock"` from the library; keep `--cd-surface: var(--surface)` and `--cd-well: var(--dock-bg)` under it |
| `.cd-stamp`, `.cd-dot`, `.cd-breath`, `.cd-code`, `.cd-sr` | `.ui-stamp`, `.ui-dot--attention`, `.ui-dot--run`, `.ui-code`, `.ui-sr` |
| `orb()` | `HX.ui.html.orb(bot, {size})`; keep setting `reaction` on state change (`teammate` and `schedule` kinds) |
| `.cd-ladder`, `.cd-steps` | `HX.ui.html.ladder({stations, current, ground: 'var(--cd-surface)'})` inline; `variant: 'list'` in the compact escalation |
| `.cd-qdots` | `HX.ui.html.pages({pages, current})` (still) |
| `.cd-opt:focus-visible` (fill only) | the menu item's focus: `--current` + `box-shadow: inset 0 0 0 2px var(--focus)` (A7) |
| `.cd-free` outline `--line` | `--line-field` |
| `.cd-opt__ring` and `.cd-week i` rings in `--text-faint` (2.0–2.4:1) | `--mark-off` (3:1 on every surface; F28) |
| `openBlank()` positioning, outside-press and Esc handling | `HX.ui.layer.open(trigger, popoverCard, {place: 'below'})` (the card brings its own surface; the layer places it, closes it on Esc or an outside press and returns focus) |

Keep: `<hx-card>`, the kinds, sizes, states, `_flipHeight` (the owner's height exception), the queue, the receipts, the
announcements, `hx:card-action` and `hx:card-state`.

## 7. Verifying a migrated module

1. Its `*.test.html` loads `components.css` and `components.js` and still passes its own checks.
2. `grep` finds none of the deleted selectors or functions in the module.
3. No literal colour in the module (`grep -E '#[0-9a-f]{3,6}|rgba?\('` returns only comments).
4. Open `design-system/index.html` beside the module: a button, row, chip, stamp, tooltip or card in the module looks
   and behaves like the specimen's in every preset (switch presets in both).
5. Keyboard: Tab through the module; every stop shows the brass ring; Esc closes what it opened and returns focus.
6. Run `node design-system/build-tokens.mjs --report` after any token change and check the pairs in DESIGN-SYSTEM.md
   5.4 still hold.

## 8. Corners and the talking composer (owner rules, 18 November 2026)

What changed in the library, already live for every module: every rounded corner is continuous where the engine has
`corner-shape` (`:where(*)` in `components.css`, zero specificity); the radius scale is re-tuned for it (section 0.7);
the library's own nestings fit (composer, menus, segmented, tooltip, toast, concave corners); the composer has a
compact layout with its actions in the corner, and a mic in every composer. What each module does:

**The contract**, for any module surface that holds others (DESIGN-SYSTEM.md §8.2): on the container,
`--r-outer: <its radius token>; --pad: <the inset of what sits in its corners>;` plus the class `ui-nest` (or the line
`--r-in: max(var(--r-floor), calc(var(--r-outer) - var(--pad))); border-radius: var(--r-outer);`); on the child in its
corner, the class `ui-fit` (or `border-radius: var(--r-in)`). The gap must be equal on both sides of the corner. A
circle or a pill adds `corner-shape: round` (or the class `ui-round`). No other radius is chosen by hand.

### Shell (`shell.css`, `shell.js`)

| Where | Edit |
|---|---|
| `shell.js KEYGROUPS`, composer group | Add the row `alt+V`: "Talk: a tap toggles listening, a hold talks while held" and `Esc` (while listening): "Stop listening" (KEYMAP.md §7) |
| `.hx-avatar`, `.hxt-flag`, `.hxt-contrast li.is-fail span:first-child::before`, `.hx-stub-rail i`, `.hx-stub-orb` | Add `corner-shape: round;` (they are circles) |
| `.hxt-swatch::-webkit-color-swatch`, `.hxt-swatch::-moz-color-swatch` | `border-radius: max(var(--r-floor), calc(var(--r-s) - 2px));` (it was already concentric; the floor keeps it from going square in Sharp) |
| `.hx-dialog__card` | Add `--r-outer: var(--r-l); --pad: 12px; --r-in: max(var(--r-floor), calc(var(--r-outer) - var(--pad)));` and `border-radius: var(--r-outer)` |
| `.hx-dialog__head` | `padding: 0 12px 0 20px;` (was `0 10px 0 20px`: the close button then sits 12px from the top and the right edge) |
| `.hx-dialog__head .ui-ib` | Add `border-radius: var(--r-in);` (the close button in the dialog's corner) |
| `.hx-palette__box` | Add `--r-outer: var(--r-l); --pad: 6px; --r-in: max(var(--r-floor), calc(var(--r-outer) - var(--pad)));` |
| `.hx-palette__list`, `.hx-pal-row` | `.hx-palette__list { padding: 4px 6px 6px; }` (was `4px 6px 8px`) and `.hx-pal-row { border-radius: var(--r-in); }` (the last row meets the box's bottom corners) |
| `.hxt-preset`, `.hx-goto`, `.hx-cmd`, `.hx-me`, `.hx-dtab` | Nothing: loose nestings, their own step |

### Session (`session.css`, `session.js`)

| Where | Edit |
|---|---|
| `.ssr-task-mark > i` | Add `corner-shape: round;` |
| The session composer | Nothing: it keeps the full layout and already had the mic. Its mocked dictation (`ui:dictate` sets the placeholder, then `c.mic.click()` after 2.2s) still works; the library now sets "Listening" and restores the placeholder itself, so the `data-placeholder` line in that handler can go |
| `.ss-diff`, `.ssr-term`, `.ssr-file`, turns | Nothing: loose (the right panel's sections are flush; its wells sit 12–20px in) |

### Bots (`bots.css`, `bots.js`)

| Where | Edit |
|---|---|
| `buildComposer()` | `UI().composer({ placeholder: 'Message', label: 'Message', attach: true, spend: {…}, bot: <the selected bot>, orbs: () => [S.presence] })` (drop `mic: true`, the mic is always there). Where the selected bot changes (the line that sets `data-placeholder` to `'Message ' + b.name`), also call `c.setBot(b)`. While you talk, the presence orb and every `.ui-orb[data-bot]` of that bot take the `listening` reaction; `gentleFollow` keeps working (the library restores the reaction only if it is still `listening`) |
| `.bt-swatch` | Add `corner-shape: round;` |
| `.bt-opt`, `.bt-sugg`, `.bt-p-sched`, the log's turns | Nothing: loose |

### Dock (`dock.css`, `dock.js`)

| Where | Edit |
|---|---|
| `composerFor(id)` | `ui().composer({ placeholder: 'Message ' + b.name, label: 'Message ' + b.name, attach: false, bot: b })`: drop `mic: false` (ignored now); with nothing but text it is compact on its own, its actions on the text's line, concentric with the box (F30) |
| The session head's orb (and the switcher's) | Give the `orb-avatar` `data-bot="<id>"` (or pass `orbs: () => [headOrb]` to the composer), so it listens while you talk to that bot |
| `.dk-composer .ui-composer__input` | Delete `min-height: 1.6em` (the library's compact layout sets it); keep `max-height: 120px` |
| `slabPath(w, h, g)` | `return HX.ui.shape.slab(w, h, g.R, g.Fw);` (the same corner CSS draws in this engine: continuous where `corner-shape` exists). `readRadius()` stays; under continuous corners `--r-l` is 22 |
| The minimised view (`.dk-v-min`, 28px high, 10px orbs) | `.dk-v-min { padding-inline: 9px; }` and `.dk-v-min .dk-pillbtn { border-radius: 14px 14px 0 0; corner-shape: round; }`; in min mode draw the path with `R = h / 2` and `HX.ui.shape.slab(w, h, R, F, { round: true })`: a pill's ends stay round, and the first and last orb sit on the centres of its end caps (pill in a pill) |
| `.dk-v-wait-norm`, `.dk-v-wait-exp` (a card at the top of the slab) | `padding-top: var(--sp-4)` (was 14px on the normal view: equal gaps) and `--r-outer: var(--r-l); --pad: var(--sp-4); --r-card: max(var(--r-floor), calc(var(--r-outer) - var(--pad)));` (6px by default: the card fits under the slab's 22px corner; needs the cards edit below) |
| `.dk-bot`, `.dk-add-ring-o`, `.dk-tile-glyph > i`, `.dk-tile-dot` | Add `corner-shape: round;` |
| The session view, the run, schedule and context views | Nothing: their surfaces sit mid-slab, loose; cards and the composer keep `--r-m` |

### Cards (`cards.css`)

| Where | Edit |
|---|---|
| `hx-card[data-size="compact"], hx-card[data-size="popover"]` | `--r-outer: var(--r-card, var(--r-m)); --pad: var(--sp-4); --r-in: max(var(--r-floor), calc(var(--r-outer) - var(--pad))); border-radius: var(--r-outer);` (a context, such as the dock's wait view, sets `--r-card`) |
| `.cd-queue__peek` | `border-radius: 0 0 var(--r-card, var(--r-m)) var(--r-card, var(--r-m));` (it is the card under, flush: the same radius) |
| `.cd-opt__ring`, `.cd-diffdots i`, `.cd-week i` | Add `corner-shape: round;` |
| `.cd-well` (the staging box), the foot's buttons, `.cd-opt`, `.cd-free`, `.cd-token`, `.cd-tile`, `.cd-mini` | Nothing: loose (14–16px from the card's edge), their own step, below the card's |

