# What was left of v6: the record of the phase 2 gate's main condition

The phase 2 gate is "no v6 left". This file was the inventory of every v6 module, component, CSS file, story and golden still in the
tree at the repass's step 9 (27 November 2026). Steps 2a and 2b (27 and 28 November, branch `w33/repass`) ported or deleted all of it.
**Nothing is left to port.** What follows is what went, step by step, and what was kept, with the reason. Paths are under
`apps/desktop/ui/`.

## The v6 namespace

`ui` and `html` (the v6 library's factories and templates, `components/index.ts`, `components/html.ts`) are gone. `@boopis/ui` is the
kit (`kit`, `kit.html`) and the engines it draws with, each a named export (`orb`, `orbHtml`, `modelMark`, `markHTML`, `markdown`,
`inlineCodeHTML`, `card`, `layer`, `popover`, `tooltip`, `squircle`, `scrollClass`, `scrollEdges`, `icon`, `announce`, `copyText`,
`esc`, `botState`, `stack`, `signinButton`, the item marks). The e2e build's `window.__hx` carries `card`, `squircle`, `popover` and
`tooltip` in place of `ui`. `components/kit.css` and `components/components.css` are gone; `styles/index.ts` loads the tokens, the
engines' sheets and the kit in order.

## Deleted at step 9, step 2a

As recorded at the time (REPASS.md, rows 9 and 2a): the item tile and publisher (`ui.itemMark`, `ui.publisher`), presence, the v6
group, send, stamp, capacity, pages and steps (step 9); the toast, the select and listbox, the tabs, the segmented, switch, chip, chip
group, field, input, section, settings row and head, ladder and list row, the v6 bot sheet, new-bot and new-group forms and group board
(step 2a). Each went with its CSS, stories, goldens and tests.

## Deleted at step 2b

| Part | What it was | Now | Stories and goldens that went |
|---|---|---|---|
| `mod-view.ts`, `mod-view.css`, `mod-tree.ts`, `mod-colors.ts`, `mod-svg.ts` (`ui.modView`, `html.mod`) | what a mod draws | the kit's **ModView** (`components/v7/mod-view/`: view and contract, behaviour, CSS, stories, tests; the tree, colour and sanitiser modules moved into its folder) | `cards/mod-view` |
| `progress.ts`, `progress.css`, `ui.measure`, `ui.legend` | dot progress and the context measure | ModView's part `ModProgress`: the composer line's ticks, filled in proportion or one travelling | `components/measure` |
| `ui.entry`, `html.request` | the v6 call-number entry and request | a mod's log line is the kit's **SystemLine**, a placed row a **ToolRow**; the theme card stands in the thread alone | `composer/entry`, `composer/request` |
| the band, the status line, the inline panes (`modules/mods/*`) | where a mod drew | conflict 32 decided: the band is the kit's **Queue** (`variant: 'mod'`, new) in the held or queued strip's slot; the status is a plain item of the composer's own line (no rise); a pane is a tab of the **Pane**'s tools after its fixed tabs (`fixed`, `extra`, new); notices the kit's Notice (2a) | `cards/mod-surfaces` re-taken |
| `ui.button`, `ui.iconButton`, `html.badge`, `html.code`, `ui.code`, `html.dot`, `html.model`, `html.keys`, `ui.empty`, `html.empty` | the v6 controls the host and the shell still called | the kit's Button, IconButton (ghost: the window's controls), Badge, InlineChip (code, model), StatusWord (dot), EmptyState | `components/button`, `icon-button`, `badge`, `code`, `dot`, `keys`, `key-combos`, `empty` |
| `signin-button.ts`, `.css` (`ui.signinButton`) | the labs' sign-in | the kit's **Button** led by the lab's mark (`signinButton`, `signin-marks.ts`; ADR-0040's marks unchanged) | `components/signin-button` |
| `host/notice.ts`'s v6 look | the startup notice | the kit's **Notice** in a page (red: one sentence and Retry), the code an InlineChip | `settings/startup-notice` re-taken |
| `tooltip.ts`'s `.ui-tip`, `html.tip`, `html.tipBody`, `kbd.ts` | the tooltip's look and the v6 key chips | the runtime draws the kit's **Tooltip** view (`tooltipInner`, with a state after the name, new) | `components/tooltip`, `popover` |
| `layer.ts`'s `.ui-pop` | the popover's look | the kit's popover surface (`.k7-pop`, the Menu's) | |
| `hold.ts`, `wire.ts` (`ui.hold`, `ui.hydrate`), `html.disclosure`, `html.scroll` | the v6 hold and its wiring | the kit's hold (Button `hold`) and Disclosure; nothing in the app used these | `components/hold`, `disclosure`, `scroll` |
| `logo.ts` | the empty state's mark | the kit's EmptyState draws no mark | |
| `variants.ts`, `lab/variant-drawers.ts` | the v6 variants the lab drew | the kit's own variants (`kitVariants`) | every `components/variants-*` (11 folders) |
| `components.css`, `kit.css` | the v6 library's CSS | its kept parts moved beside their owners (below); the rest went | |
| the lab's v6 aliases | v6 classes as kit roles (`.ui-btn` as Button, `.ui-menu` as Menu and the rest) | `tests/lab/v7.mjs`, `probe.js`, `check.mjs` read the kit's own selectors | |

## Kept, with the reason

| Part | Why it stays |
|---|---|
| `orb.ts`, `orb.css` (was in `components.css`), `stack.ts`, `look.ts`, `shape.ts`, `bot-state.ts`, `orb-*` | the kit's engine for bots: Avatar, InlineChip, the dock and the rail draw orbs through it (owner decisions on the orbs in `look.ts`) |
| `model-mark.ts`, `model-mark.css`, `model-name.ts` | a model's mark: the kit's ToolRow, Bubble, InlineChip and menus draw it |
| `markdown.ts`, `md-view.ts`, `markdown.css` | content rendering (what a bot or an agent wrote); kit-only since 2b: its mentions, code, paths, links and images are the kit's InlineChips, its code well's controls the kit's ghost Button and IconButton |
| `squircle.ts`, `squircle-path.ts`, `corners.ts`, `corners.css` | the corner engine every component draws through (R-corner-1 to 10), the dock ground's roles and the app root's focus rules |
| `scroll.ts`, `scroll-edges.ts`, `scroll.css` | a behaviour every scroller uses (R-scroll-1 to 9) |
| `layer.ts`, `place.ts`, `tooltip.ts` | the placement engine and the one tooltip; their looks are the kit's |
| `card-registry.ts` (`card`) | the card host (`hx-card`); its forms draw the kit since 6d |
| `signin-marks.ts`, `signin-marks.css` | the labs' own marks (ADR-0040), drawn in the kit's Button and in the hub |
| `item-mark.ts`, `icons.ts`, `announce.ts`, `clipboard.ts`, `select-entries.ts` | data and behaviours, not looks |
| `styles/tokens.css` | the app's themes (the presets, Settings › Appearance, a mod's theme card); the kit draws on a v7 root with its own tokens. Its v6 name in its header is the theme engine's history, not a v6 component |
| the `ui-` class names of the kept engines (`ui-orb`, `ui-stack`, `ui-mm`, `ui-scroll`, `ui-md`, `ui-codeblock`, `ui-root`, `ui-sr`) | the engines' own classes, read by their CSS, the lab's probes and the smoke; renaming them is not a port |
| `components/model-mark`, `orb`, `stack`, `markdown`, `inline-chips` stories | the engines' specimens (coverage: `engine:<name>`) |

## Module CSS

`modules/mods/mods.css` holds placement only (the strip's slot, a pane's column, the theme card's width). `modules/shell/shell.css`
holds the shell's layout and placement; its v6 placeholders (the stub rail, panel, orb, dock) and the command field's narrow rules went,
and the go-to hint is the kit's Tooltip surface placed by it.
