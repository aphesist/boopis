# @boopis/ui: the component kit

Every piece of UI that more than one place draws is one component here, in one place, with typed variants that are the
design system's (`design/v6/design-system/DESIGN-SYSTEM.md` 1.1; rule IDs in `RULES.md`). The desktop app's modules,
its host screens, the theme panel and the UI lab draw only with it. The live catalogue is the **UI lab**
(`pnpm lab`, `lab.html`; `docs/UI-LAB.md`): a story per component and state, beside the v6 mock-up, checked against
the rules. The inventory of what was consolidated, and what is still known debt, is `docs/UI-COMPONENTS.md`.

## The package

- **Where.** `apps/desktop/ui/src/components/`, imported as `@boopis/ui` (a path alias in `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`). It is not a separate pnpm package: the UI has no pnpm workspace (one lockfile,
  installed offline and frozen in CI), and the parallel branches that edit these files keep their paths. Promoting the
  folder kept every path and the history; moving it to `packages/ui` would have added a workspace, a second lockfile
  entry and a rename under every open branch, for the same import name.
- **Entry.** `index.ts` is the one public entry: `ui` (factories that return wired elements, `ui.html.*` string
  templates, the behaviours) and named exports, plus `variants` (every component's variants, `variants.ts`). Nothing
  outside this folder imports a file inside it; `kit.guard.test.ts` fails if anything does.
- **Pure.** The kit imports nothing from the app: no module, no host, no data provider, no app state or settings. Its
  only outside imports are `core/dom`, `core/keys`, `core/log`, `core/bus` (it re-reads tokens on `hx:theme`),
  `styles/colour` (colour maths) and the vendored elements. Templates render from their options alone.
- **Styles.** `kit.css` is the kit's stylesheet: the design-system tokens from their one source (`styles/tokens.css`,
  generated into `tokens.json`; never copied) and the library CSS (`components.css`, `model-mark.css`, `progress.css`,
  `mod-view.css`). The app loads it first (`styles/index.ts`), then its modules' CSS, which only places kit components.
- **Build.** `pnpm kit` builds `dist-kit/boopis-ui.js` (an ES module: everything `index.ts` exports) and
  `dist-kit/boopis-ui.css`, for a page outside the app. It carries no fonts: the page loads them (`styles/fonts.ts`).

```ts
import { ui } from '@boopis/ui';
const tabs = ui.tabs({ label: 'Settings sections', value: 'general', tabs: [{ value: 'general', label: 'General' }, { value: 'keys', label: 'Keyboard' }] });
tabs.addEventListener('ui:change', (e) => show((e as CustomEvent<{ value: string }>).detail.value));
```

Two ways in, one markup: `ui.html.<name>(opts)` returns a string for code that builds `innerHTML`; `ui.<name>(opts)`
returns the element, already wired. `ui.hydrate(root)` wires every `[data-ui]` element of string-built markup once.
Events bubble and are cancelable where an action follows: `ui:change {value}`, `ui:select {value, item}`, `ui:commit`,
`ui:send {text}`.

## Components

Each row: what it is for, its variants (the options `variants.ts` lists for the lab), the rules it implements.

| Component | Purpose | Variants and props | Rules |
|---|---|---|---|
| `button` | an action | `variant: secondary, primary, ghost`; `size: m, s`; `icon`, `keys` + `showKeys`, `disabled`, `tip`, `action` | R-btn-1 to 5, R-state-1 to 7 |
| `iconButton` | a toolbar action with a tooltip | `size: s`; `window`; `pressed`, `expanded`, `haspopup`; `label` (required), `keys`, `tipPos` | R-ib-1, R-ib-2 |
| `send` | the composer's send and stop | `running`, `disabled` | §14.14 |
| `hold` | hold to approve (1 s) | `fill: dots, solid`; `label`, `ms` | §14.15 |
| `switch` | a setting that applies at once | `checked`, `disabled`, `id`, `label` | R-switch-1 to 3 |
| `segmented` | two to four exclusive options; the tabs pill | `mode: tabs, radio`; `size: s`; `vertical`; `fill`; `label` or `labelledby`; `controls`; `attrs` | R-seg-1 to 3, R-tab-1, R-tab-3 |
| `tabs` | text tabs naming sections (a dialog's head, the details panel's panes) | `scroll` (a strip that scrolls with a 28px fade, the open tab kept in view); `tabs: [{value, label, labelHTML, id, controls, ariaLabel, tip}]`, `value`, `label`; radius `--r-corner` of the band | R-tab-1 to 3, R-corner-5, R-scroll-7 |
| `chip`, `chipGroup` | a toolbar toggle or picker; option chips | `mono`, `option`, `pressed`, `haspopup`, `model` | R-chip-1 to 3 |
| `keys`, `kbd`, `combo` | key chips | `fit` (concentric with the control the chips sit in: tooltip, search field), `raised` (on a raised surface: `--bg-4`) | R-kbd-1 to 3 |
| `badge` | a quiet mark (the "made outside boopis" mark) | `tip`, `tipPos`, `focusable`, `describedBy` | §13 owner decision, R-chip-1 |
| `stamp`, `dot` | what is owed; state dots | `dot.kind: run, attention, here, flag`; `size: s` | §14.26 |
| `search` | the search field family | `size: s` (the title bar's 26px command field, a button), `m` (a search in a form), `l` (the palette's 48px head); `as: input, button`; `keys`, `textHTML`, `placeholder`, `attrs` | R-search-1 to 5, R-kbd-2 |
| `input`, `field` | the text control; with its label, hint and error | `mono`, `raised`, `rows` (a textarea); `field.kind: text, textarea, select, model`, `error` | R-field-1 to 4 |
| `select` | the themed select and listbox (`ui.listbox`) | `mono`, `raised`, `entries`, `labelId` | R-select-1 to 4, R-native-1 to 3 |
| `setRow`, `setHead`, `setSection` | a settings row (label, hint, control); a section and its heading | `hint`, `for` or `labelId`, `control` | §14.21, R-switch-2 |
| `row`, `group` | list rows; a project or archive group | `sub` (two lines), `current`, `archived`, `acts`; `group.collapsible`, `expanded` | R-row-1 to 4 |
| `section` | a collapsible panel section | `open`, `meta` | §14.11 |
| `scroll` (`scrollClass`) | every scroller: one bar | `axis: y, x, both`; `bare` (no bar); `inset: end, both` (the track stops short of a curved corner); `--stable` class (keeps its gutter) | R-scroll-1 to 9 |
| `menu`, `popover`, `layer` | floating surfaces | `menu.open(anchor, items, {label, place, align, multi, onSelect})`; items: `checked`, `keys`, `desc`, `model`, `stamp` | R-menu-1 to 3, R-float-1 to 5 |
| `tooltip` (`tip`, `tipBody`) | any `[data-tip]`; keys after the label | `data-kbd`, `data-tip-pos`, `data-tip-state` | R-tip-1 to 4, R-kbd-2 |
| `toast` | confirms what just happened | `action: {label, onClick}`, `ms` | R-toast-1 to 3 |
| `empty` | an empty state that teaches | `mark`, `action` | R-empty-1 |
| `ladder`, `measure`, `legend`, `capacity`, `pages`, `progressDots` | measures, positions and progress, all dots | `ladder.variant: line, list`; `measure.variant: strip, row, grid`; `pages.interactive` | R-data-1, §14.27 |
| `entry`, `steps`, `disclosure`, `blank`, `request` | the conversation's parts | `entry.kind: user, agent, bot, mod`; `steps[].kind` | §14.5 to 14.9 |
| `composer` | every composer (session, Bots tab, dock) | `running`; mic in each | §14.10 |
| `orb`, `modelMark`, `icon`, `logo` | bots, provider marks, icons, the mark | `orb.size`, `still`; `modelMark.color: mono, brand` | §10, §12, §13 |
| `child` | a task a session handed to another model: mark and name, goal, what it does now, how it ended; open and stop | `status: queued, running, done, failed, stopped`; `canOpen`, `canStop`; `time`, `now`, `tools`, `summary` | §8 containers, R-corner-3, R-state-* |
| `modView` | a mod's element tree, drawn with the kit | `limits`, `colors` | §14.29 |
| `squircle`, `shape` | continuous corners; nested corners fit | `frame`, `clip`, `surface` modes | R-corner-1 to 9 |

## Rules the kit keeps in one place

- **Corners.** One rule derives `--r-in`, `--r-corner`, `--corner-inset` and `--corner-ring` from a container's
  `--r-outer` and `--pad` (`corners.ts`; containers carry `.ui-nest` or are in the rule's list). A control in a corner is
  `.ui-corner`, a row on an edge `.ui-corners`; a tab on a dialog's head band takes `--r-corner`, a capsule like the
  close button (R-corner-5, R-dialog-1); a key chip at a field's end takes its `--r-in` (`--r-in-field`, R-kbd-2).
- **Placement.** Every tooltip, menu, popover and listbox is placed by `place.ts` (the 8px gap and margin,
  `data-tip-pos`, `data-overlay-avoid`, inside a modal dialog: R-float-1 to 5, R-elev-6).
- **Scrollbars.** `::-webkit-scrollbar` from the `--scroll-*` tokens, in WebKitGTK and Chromium alike (R-scroll-1 to
  3); `.ui-scroll--stable` (R-scroll-4) and `.ui-scroll--inset-*` (R-scroll-5) are each one rule in `components.css`.
- **Hover.** Every hover rule sits under `(hover: hover) and (pointer: fine)`; what hover reveals also shows on
  `:focus-within` (R-state-3).

## Adding or changing a component

1. Look here first (`docs/STANDARDS.md` section 9). Extend the component with a typed option before writing a second one.
2. Template in `html.ts` (or its own file, as `tabs.ts`, `search.ts`, `scroll.ts`, `kbd.ts`), CSS in `components.css`,
   behaviour in `wire.ts`, export from `index.ts`, its variants in `variants.ts`.
3. Cite the rule IDs in the comment above it. Where the design system does not decide, say so in
   `docs/UI-COMPONENTS.md` and keep the choice in one declaration.
4. Run `pnpm test` (the guard) and the lab on the component (`pnpm lab:check --area components`).
