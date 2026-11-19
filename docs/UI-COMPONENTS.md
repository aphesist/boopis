# UI components: inventory and consolidation

Every repeated UI pattern of the desktop app is one component of the kit, `@boopis/ui`
(`apps/desktop/ui/src/components/`, its README has each component's purpose, variants, props, rules and a snippet).
This file is the inventory behind it: for each pattern, every place it is drawn, how the copies differed, which
differences are intended variants and which were drift, and where it stands. Rule IDs are the design system's
(`design/v6/design-system/DESIGN-SYSTEM.md` 1.1, indexed in `RULES.md`); every rule cited here is approved, including
the 18 that were proposed (approved 19 November 2026, three amended). The live catalogue is the UI lab (`docs/UI-LAB.md`).

Status words: **one** (one kit component, every instance migrated, the per-screen copies and their CSS deleted);
**debt** (instances left, each named below and allowlisted in `kit.guard.test.ts`, which fails on a new copy and on an
allowlisted one that is gone); **other branch** (owned by a parallel branch; nothing redone here).

## The kit as a package

- **Decision: the existing `src/components` promoted, imported as `@boopis/ui`** (a path alias in `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`), not a new `packages/ui` workspace package. The UI is one pnpm project with
  one lockfile, installed offline and frozen in CI; a workspace would add a root `pnpm-workspace.yaml`, a lockfile
  change and a rename under every open branch for the same import name. The folder keeps its paths and history.
- **One entry** (`index.ts`): every component, its typed options and `variants` (`variants.ts`, the UI lab's axes).
- **Pure**: no import from `modules/`, `host/`, `data/`, the app's state, settings or registry. The colour maths the kit
  needed moved out of the theme runtime (which reads settings) into `styles/colour.ts`.
- **Tokens from the one source**: `kit.css` imports `styles/tokens.css` (generated into `tokens.json` by
  `pnpm tokens`), then the library CSS. The app loads `kit.css` first (`styles/index.ts`).
- **Build**: `pnpm kit` writes `dist-kit/boopis-ui.js` (ES module) and `dist-kit/boopis-ui.css` (gitignored).
- **Guard** (`src/components/kit.guard.test.ts`, run by `pnpm test`): the kit imports nothing from the app; nothing
  outside the kit imports `components/...` by path (54 files moved to `@boopis/ui`); no module re-implements a kit
  pattern (17 checks over module TS and CSS and `index.html`, with the allowlist below); every variant list names a
  template; the new templates render from their options alone.

### The v6 mock and the kit: not done, a decision for the owner

The mock (`design/v6/`) cannot load the built kit without changing how the owner designs in it, so it does not:

- it is plain HTML that loads classic scripts in order (`components/components.js` defines `window.HX.ui`, and every
  page script calls `HX.ui.*` synchronously); the kit is an ES module with a different entry (`ui`, `@boopis/ui`);
- the owner edits `design/v6/components/*.js` and `.css` directly and reloads, with no build; loading `dist-kit` would
  make the reference depend on a build of the app and turn edits in the mock into edits that the next build overwrites;
- `design/v6/` is the reference the port is compared against (`pnpm test:parity`); making it render the port would
  compare the port with itself, and `AGENTS.md` forbids editing it.

The alternative, if the owner wants the mock to show the real components: a small `design/v6/kit-bridge.js` that loads
`dist-kit/boopis-ui.js` as a module and assigns `window.HX.ui = ui`, used by a new `index.kit.html` beside the mock's
own `index.html`. That keeps the mock as it is and adds a second page that shows the kit. It needs the owner's word,
because the mock is the owner's.

## Before and after (the owner's named cases)

Screenshots, Chromium at deviceScaleFactor 2 and WebKitGTK 2.52 at GDK_SCALE 2 (Tauri's Linux engine), light (Bone) and
dark (Card catalog), in the scratchpad's `components/` folder: `before-*`, `after-*` and `compare-*`
(`compare-scrollbar-webkit-*`, `compare-scrollbar-chromium-*`, `compare-tabs-*`, `compare-search-titlebar-*`,
`compare-palette-*`, `compare-tooltip-keys-*`).

| Case | Before | After |
|---|---|---|
| Settings' scrollbar | WebKitGTK ignored `scrollbar-width: thin` and drew GTK's wide bar (the owner's screenshot); each scroller declared its own `overflow` and `scrollbar-*` | One scroll area (`.ui-scroll`) drawn with `::-webkit-scrollbar` from `--scroll-*` in every engine (R-scroll-1 to 3), stable gutters (R-scroll-4), the track kept off the dialog's curved foot (R-scroll-5) |
| Settings' tab pills | `.hx-dtab` at `--r-s` (12) beside a close button at `--r-in` (18) in the dialog's 30px corner band; a duplicate of `.mod-tab` | `ui.tabs`: a tab takes the band's `--r-corner` (the dialog card is a `.ui-nest` container at `--pad-dialog`), a capsule on a 28px tab, like the close button, now a `.ui-corner` (R-tab-1, R-corner-5, R-dialog-1, F38). Exact concentricity of a 28px control 12px from a 30px corner needs a 60px head or a 36px close: the owner's call |
| Search field and key chips | the title bar's field and the palette's field hand-built in `index.html` and `shell.css`; key chips at `--r-xs` in the field's 12px corner; chips drawn by four different pieces of code | `ui.search` (sizes s, m, l; R-search-1 to 5), its glyph in a 26px square (R-search-3); every chip from `ui.html.keys`, concentric with the field (`--r-in-field`, R-kbd-2) |

The visible change in the search field is small (chips from 6px to 8px corners, the glyph 4px further left); what
changed most is that it is now the kit's component, one markup for both fields and the shortcut sheet's filter.

## Inventory

### Buttons and icon buttons — one, with debt
- **Kit:** `button` (secondary, primary, ghost; m, s), `iconButton` (s, window), `send`, `hold`.
- **Instances:** every module's actions through `ui.button`/`ui.html.button` (bots settings, room, new bot, dock
  views, cards' feet and rules, right panel, models tab, Hermes source, connectors, diagnostics). Migrated here: the
  theme panel's Copy, Apply, Reset and per-colour Reset (hand-written `<button class="ui-btn">`), the first run's
  buttons (`el('button', {class: 'ui-btn'})`).
- **Drift found:** hand-built buttons with their own reset and states: `.hx-me` (account), `.hx-stub-orb`, `.bt-opt`,
  `.bt-p-sched`, `.bt-sugg`, `.dk-add`, `.dk-run-open`, `.dk-pillbtn`, `.hxt-swatch`, and row-like ones (below).
- **Corner controls** (the corners primitive, `components/corners.ts`, from `w12/corners`): the dialogs' close
  buttons, the mods band's and inline pane's chevrons and close, and a mod toast's dismiss set their radius by hand;
  they are `.ui-corner` now, in containers that carry `.ui-nest` (the dialogs, the palette, the mods band and inline
  pane) or are in the one container rule (the command field, the form cards). Every hand-written `--r-in` formula in
  the shell, mods and cards is gone. **Left:** the dock's `--r-card` (`dock.css`, the dock branch's) and the palette's
  last row (a 30px row cannot be concentric 6px from a 30px corner: the owner's call on row height or inset,
  `docs/UI-LAB-FINDINGS.md`). The toast's action and the terminal's copy were converted on `w12/corners`.
- **Debt (allowlisted):** the theme panel's "Import file" is a `<label class="ui-btn">` that opens the file chooser;
  the kit has no file button yet.

### Toggles and switches — one
- `switch` everywhere: Settings > General (Show the dock), Appearance (Grow bots on hover), Hermes source, bot settings,
  the dock's card, form cards, connectors. No checkbox anywhere (R-check-1): the form card's several-choice rows were
  a filled square, now the check glyph at rest in `--mark-off`, brass when chosen, with "Choose any" in the label.

### Segmented controls — one
- `segmented` for Session | Bots (pill and rail), Rail | Hide, Auto | Integrated | Dedicated, Governed | Ungoverned,
  Worktree | Sandbox, the theme panel's case, corners and density, the new bot's Colour | Shape tabs.
- **Drift fixed:** the theme panel built the control and then edited its markup with string replacement to add a name
  and a label; the shell swapped `aria-label` for `aria-labelledby` after building it. `segmented` takes `labelledby`
  and `attrs`. R-seg-3 (a control on a dialog's edge band) has no instance today.

### Tab bars — one
- `tabs`: Settings' sections (the dialog head, `--r-in-dialog`) and the details panel's mod panes (scrolling strip,
  `--r-s` on the flat panel head). The two were copies of each other (`.hx-dtab`, `.mod-tab`, identical CSS and two
  keyboard handlers); both deleted. The tabs pill stays `segmented({mode: 'tabs'})`: a different look by rule (R-tab-1).

### Text fields and search fields — one, with debt
- **Kit:** `field` (with label, hint, error), `input` (the bare control for a place with its own label), `select`
  (themed, `w11/ui-controls`), `search` (s: the title bar's command field; m: a search in a form; l: the palette's head).
- **Migrated:** the title bar's command field and the palette's field (from `index.html` and `shell.css`), the shortcut
  sheet's filter (now a search field, R-search-1), the bot settings' cap fields (the mock version wrote its value after
  an empty `value` attribute: fixed), the session rename, the theme panel's hex fields and JSON box.
- **Debt (allowlisted):** `cards/form.ts` renders its own `.ui-input` controls from the schema (one card family);
  the new bot's name field (`.bt-name`, an underlined title field) and the card's free answer (`.cd-free input`) keep
  their own look by design (§13, §14.13).

### Key chips — one
- `keys` (a spec), `kbd` (one literal chip), `combo`/`comboKbds` (the keymap's combinations). Instances: buttons
  (New session), menus, tooltips (`fit`, `raised`), the search fields (`fit`), the palette rows, the shortcut sheet and
  Settings > Keyboard, the go-to hint. Before, the library, `core/keys.ts` (`comboChips`), the go-to hint and the
  tooltip each wrote `<kbd class="ui-kbd">`; `core/keys` now only names keys (`comboLabels`).

### Chips and badges — one
- `chip` and `chipGroup` (toolbar chips, option chips, model chips), `stamp` (owed, red), `dot`, and the new `badge`
  (quiet outlined capsule, mono 11): the "made outside boopis" mark in the roster row and the room header, which the
  bots module drew with its own CSS. States are `ui.html.stateWord`.

### Settings rows and section headers — one, with debt
- `setRow`, and the new `setHead`/`setSection`: every settings heading was a hand-written
  `<h3 class="ui-set__head">` in a `<section class="hx-set">` (a class with no CSS) across the shell, the theme panel,
  the models, plan, Hermes-source and connectors tabs; the theme panel's choice rows were hand-built `.ui-set__row`s.
- **Section headers** share one look, 12/500 quiet in the interface case (R-type-3, R-menu-3): `ui-set__head`
  (settings, 20 above), `ui-group__head` (row groups; also the new bot's "Or start from one of these", the glance
  headings and the palette's groups), `ui-menu__title`, the keymap's group `h3`. Their spacing differs by place, as
  the design system sets it; they stay separate classes. **Debt:** `index.html`'s static Settings > General section
  keeps its hand-written rows (the page's own chrome, before the kit runs).

### Lists and rows — one, with debt
- `row` and `group` for the session list, the bots roster and Archived group, the dock roster. The palette's rows are
  `.ui-row` (Finding F10) built as listbox options.
- **Debt (allowlisted):** the diff file head (`.ss-diff-head`) and the panel's file row (`.ssr-file`) in
  `session.css`; the card layer's mini card, option row and token in `cards.css`; `.bt-routine`, `.bt-glance-row`,
  `.dk-sched-row`, `.ssr-task`. They have their own metrics today; the next step is a row variant for each.
- **Fixed:** Settings > Keyboard laid the keymap's groups in a two-column grid meant for bare `dt`/`dd` and drew each
  row's line twice; it now lists the groups as the shortcut sheet does.

### Dialogs and sheets — one look, shell-owned
- Settings, the shortcut sheet (`.hx-dialog`), the palette, the bot settings sheet (`.ui-panel` with a concave corner),
  popovers (`ui.popover`). R-dialog-1 to 6 hold. The dialog markup is the page's own (`index.html`); its body is a
  stable scroll area with the track inset at the foot.

### Menus, tooltips and popovers — one
- `menu.open` (account, model picker, composer, room, form pickers, right panel), `popover.open` (the blank), the
  delegated tooltip (`[data-tip]`). The tooltip's content was built twice (`html.tip` and `tooltip.ts`); both use
  `tipBody` now. **Other branch:** overlay placement is `w12/corners`'.

### Toasts — one
- `ui.toast` everywhere; a mod's toasts queue through `modules/mods/toasts.ts` with the kit's surface (R-toast-1 to 3).

### Empty states — one, with debt
- `empty` for the session view, the room, the dock and the failed-module notice. **Debt:** short inline notes have
  their own text styles: the palette's "No matches" (`.hx-pal-empty`, R-search-5), the shortcut filter's
  (`.hx-keys-empty`), the dock log's (`.dk-sess-empty`), the bots tab's empty glance (`.bt-empty`, placed in the
  margin). The design system names only the large empty state (R-empty-1); a "note" variant is the next step.

### Progress — one
- `progressDots`/`setProgress` (the first run, R-data-1), `measure`, `ladder`, `pages`, `capacity`. The cards' diff and
  week dots (`.cd-diffdots`, `.cd-week`) are the card layer's data marks, not progress.

### Scroll containers — one
- `.ui-scroll` with `x`, `both`, `bare`, `inset-end`, `inset-both`, `stable`: the conversation, the Bots room and new
  bot page, the sidebar lists, the palette's list, both dialogs' bodies, the right panel and bot settings, the dock's
  log, a mod's inline body, the mod pane tab strip (bare), diffs (x), the listbox, code wells (kit). Every module's
  `overflow`/`scrollbar-*` declarations are gone (R-scroll-6 to 8). The sidebar rail hides its bar so the orbs keep
  the x = 28 axis.

### Cards — card layer, with debt
- `hx-card` (the cards module) is the one card family (forms included). **Debt:** the bots module's confirm and review
  boxes (`.bt-confirm`, `.bt-review`) draw a native 1px border at `--r-m` rather than a card or well; the suggestion
  tiles (`.bt-sugg`), the theme presets (`.hxt-preset`) and the dock tiles (`.dk-tile`) are their own surfaces.

## Rules this work implements, and where each lives

| Rule | Where (one place) |
|---|---|
| R-scroll-1 to 3 | `components.css`, the scroll-area block, from `--scroll-*` |
| R-scroll-4 | `components.css` `.ui-scroll--stable` (one rule); ends give the gutter back through `--scroll-gutter` |
| R-scroll-5 | `components.css` `.ui-scroll--inset-end`, `--inset-both` |
| R-scroll-7, R-tab-2 | `.ui-tabs--scroll` (bare strip, 28px fade, open tab kept in view) |
| R-tab-1, R-corner-5, R-dialog-1 | `.ui-tab` `border-radius: var(--r-corner, var(--r-s))`; the dialog's close is a `.ui-corner` in a `.ui-nest` card (`--pad-dialog`) |
| R-search-1, 3, 4 | `.ui-search--s/--m/--l` |
| R-kbd-1 to 3 | `kbd.ts`, `.ui-keys--fit`, `.ui-keys--raised` |
| R-state-3 | every hover rule of `components.css` and `mod-view.css` under `(hover: hover) and (pointer: fine)` |
| R-check-1 | `cards/form.ts` several-choice rows, `.cd-opt__check`, "Choose any" |

R-load-2 (the waiting region's quiet line after `--load-delay`) has no instance in the app yet: there is no waiting
region to apply it to. R-seg-3 has no instance (no segmented control sits on a dialog's band).
