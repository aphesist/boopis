# The UI lab

The lab draws every component, card, surface and page of the desktop UI in its states, next to the approved v6
mock-up, and checks each state in every theme preset and width: geometry, concentric corners, overlay placement,
design tokens, native controls, scrollbars, brand words, accessibility, stability and screenshots. It is the instrument
the UI's fix agents use: find a broken state, fix it, run the area again until it is green.

The lab lives in `apps/desktop/ui`: `lab.html` and `src/lab/` (the gallery, the frame, the stories), `tests/lab/` (the
checker), `tests/lab-golden/` (the accepted screenshots). It is served by the dev server and built only into the e2e
build (`vite build --mode e2e`); the desktop app's production build has one input, `index.html`, and never contains it.

## Run it

```sh
cd apps/desktop/ui
pnpm lab                              # the dev server opens http://localhost:5173/lab.html
pnpm lab:check                        # every state, every preset, every width; writes lab-report/
pnpm lab:check --area composer        # one area: components, composer, shell, settings, bots, cards, dock, store
pnpm lab:check --story dock/dock --state "one bot"
pnpm lab:check --quick                # two presets (catalog, bone), one width (1440): the fast loop while fixing
pnpm lab:check --draw-only            # only that every state draws without an error
pnpm lab:check --update               # accept the screenshots as the new goldens
pnpm lab:check --strict               # exit 1 on any failure (CI blocks through tests/lab/gate.mjs: "What CI blocks on")
```

Other flags: `--presets catalog,bone`, `--widths 390,1440`, `--jobs 3`, `--dpr 1.6` (the owner's fractional scale as the device pixel ratio; add `--no-visual`, the goldens are at 1), `--no-visual`, `--no-axe`, `--no-stability`.
Area words also accept `conversation`, `sidebar`, `palette`, `menus`, `toasts`, `first-run`, `forms`, `mods`.

**The gallery.** The index on the left lists every story by kind (components, cards, surfaces, pages). A story shows
each state as a frame beside the v6 mock-up's counterpart (the design-system specimen's section, the mock's card
gallery or its whole app, loaded from `design/v6/`). The toolbar picks the theme preset, the width (390, 1200, 1440,
1920), the zoom (1x, or 1.6x for the owner's fractional scale, as CSS zoom in the frame), a forced pseudo-state (hover,
focus, pressed on every interactive element), reduced motion (the frame reports it to the app; the checker emulates it
for real) and whether the mock shows. The view is in the URL's hash, so a link opens the same thing. "open" on a state
opens its frame alone: `lab.html?frame=1&story=<id>&state=<name>&preset=<id>[&force=hover][&zoom=1.6][&reduced=1]`.

**Forced states.** The lab copies every CSS rule that styles `:hover`, `:focus-visible`, `:focus`, `:focus-within` or
`:active` into a stylesheet of its own with the pseudo-class replaced by an attribute (`data-lab-hover`,
`data-lab-focus`, `data-lab-active`), so a state can show hover and focus without a pointer, in the gallery and under
Playwright alike (`src/lab/force.ts`). Components need nothing for it. Shadow roots (orbs, the logo) stay at rest.

## The checks

`tests/lab/rules.mjs` lists each check with the rules of `design/v6/design-system/RULES.md` it verifies (its main rule
first); `tests/lab/probe.js` implements the in-page ones. The checks compare against the system's tokens as they
resolve in the page (`--scroll-size`, `--float-gap`, `--float-margin`, `--hit-min`, `--pad-*`, `--r-in-*`, `--fs-*`,
`--lh-*`), so a token change moves the check with it. The report ends with the **rule coverage**: which of RULES.md's
rules have a check and which do not.

| Check | Rules | What fails |
|---|---|---|
| `errors` | | the state does not draw, or the console or the page reports an error |
| `geometry.contain` | R-corner-4, R-corner-8 | a shaped child (its box, rounded corners, hover fill and focus ring) reaches outside its shaped container's rounded rect or squircle path; a child cut by `overflow: hidden` is reported as cut |
| `geometry.center` | R-type-11 | an item of a control row (a flex row up to 64px tall) is more than 1px off the row's centre |
| `geometry.clip` | R-overflow-1 | text is cut without an ellipsis |
| `geometry.hscroll` | R-overflow-4, R-scroll-7, R-a11y-6 | the window, or a scroller that is not code, scrolls sideways |
| `geometry.overlap` | | text painted over other text: two visible text runs in different subtrees whose boxes meet, neither clipped away by an ancestor's overflow, with no opaque surface above the lower one (`document.elementsFromPoint` at the meeting). Tooltips, menus, popovers, toasts and the declared overlay are left out. The checker's own proof is `src/lab/overlap.test.ts` |
| `geometry.target` | R-a11y-2 | a target under 24 x 24 px whose 24px circle meets another target (WCAG 2.5.8) |
| `concentric` | R-corner-3, R-corner-5, R-corner-9, R-kbd-2 | a shape in a container's corner: unequal insets, a radius that is not outer − inset (floor 8) or a pill, in rest, hover, focus and pressed (section 8.2, 14.10) |
| `overlay` | R-float-1, R-float-3, R-elev-6, R-tip-2, R-tip-4, R-copy-7 | a tooltip, menu or popover covers its anchor, sits off the system's gap (8px on every side, R-float-1), leaves the window's 8px margin, is not aligned (tooltips centred, menus at the anchor's start inset 8, end or centre), opens above when it should open below, or covers the text field of its anchor's container |
| `tokens.computed` | R-colour-1, R-type-1, R-type-2, R-type-4, R-corner-1, R-copy-1 | a computed colour, background, border, outline, fill, shadow colour, font size or radius that is not a token of the active preset (resolved on the element's ground, so the dock's re-derived tokens count) |
| `tokens.spacing` | R-space-1, R-space-2 | padding or gap that is neither a `--sp-*` step, a `--pad-*` token nor a value of R-space-2's named exceptions |
| `tokens.static` | R-colour-1 | a literal colour, font size, radius or inline-style length in the UI's CSS and TS outside the token files (`tests/lab/static-scan.mjs`) |
| `inline-baseline` | | a chip set into running text (a mention, the person's "you" capsule, `@all`, a bot outside the room, the composer's model mention and feedforward marks, inline code, a path, the blank, an attachment chip) that is off its line: (a) its text's baseline more than 0.5 device px from the line's; (b) its box's centre more than 1 device px from the centre of the line's cap band (plus half the difference of the two cap heights, for a chip in a smaller type such as code); (c) the line box taller with it than with a stand-in as wide; (d) uneven room inside it, left against right (a leading orb: from the start against from the top and bottom) and over the cap height against under the baseline, more than 0.5 device px. The line and the chip's text are measured with zero-width inline-blocks one cap tall (`height: 1cap`) set in each, never from pixels or assumed font metrics, so a fallback font moves both alike. A chip alone in its block, or laid out by a flex or grid row, is not in running text. Its stories are `components/inline-chips` |
| `native` | R-native-1, R-native-3, R-field-4, R-select-1 | an unthemed native control: `select`, date, colour, range, file or number inputs, an engine-drawn checkbox or radio, `progress`, `meter` |
| `scrollbar` | R-scroll-1, -2, -3, -6, -8 | a scroller with no `::-webkit-scrollbar` rule (WebKitGTK ignores `scrollbar-width`), a bar wider than `--scroll-size`, a thumb that is not `--bg-4`, an inner scroller without `overscroll-behavior: contain`; and, in the source, any `scrollbar-width` or `scrollbar-color` |
| `brand` | R-copy-8 | rendered text, `aria-label`, `aria-description`, `title`, placeholder or tooltip names the engine (ADR-0031; any case). The exception, a plugin store item under its own name or publisher (`data-store-item`, `core/engine-words.ts`), is `BRAND_ALLOW` in `rules.mjs` |
| `copy` | R-copy-9, R-copy-6 | rendered text with `undefined`, `NaN`, `[object Object]`, a stack trace, an `hx.*` code or JSON (code and output wells excepted) |
| `roles` | R-colour-3, R-colour-4 | text in `--brass`; `--bg-0` on `--bg-0`, `--bg-3` on `--bg-3` |
| `axe` | R-a11y-1, R-a11y-3, R-a11y-8 | an axe-core violation (every rule but page landmarks) |
| `stability.render` | | the state drawn twice (a fresh cell, or a reload) has a different DOM structure |
| `stability.interact` | R-motion-5, R-motion-8 | while an interaction plays (with full motion), a node is removed and drawn again, an `<orb-avatar>` is taken out and put back or drawn anew (its canvas is empty until the worker paints it), an element goes invisible and comes back, or a box jumps away for a frame or two and comes back |
| `visual` | | the screenshot differs from its golden |

**The matrix.** Each state loads once at 1440 x 900 with reduced motion. For each preset (catalog, graphite, bone,
typewriter), at each width (390, 1200, 1440, 1920) the in-page checks run at rest; at 1440, and at 390 in the default
preset, `geometry.contain`, `concentric`, `tokens.computed` and `overlay` run again with every interactive element
forced to hover, then focus, then pressed; at 1440 axe runs and the screenshot is compared. A stage state whose cell is
wider than the window is not run at that width. Then the state is drawn again and its DOM compared; a state with
interactions loads once more with full motion and is sampled frame by frame while they play.

**Goldens.** `tests/lab-golden/<story>/` holds an eighth-scale screenshot per state and preset (`<state>@<preset>.png`,
each pixel the mean of an 8 x 8 block) and the full screenshot's SHA-1 (`hashes.json`). The same hash passes; otherwise
the screenshot is scaled the same way and pixel-diffed against the thumbnail (threshold 0.1, limit 0.5% of its
pixels). Full-resolution goldens for every state and preset would be about 75 MB, quarter-scale ones about 20; these
are about 5. A slip smaller than a block is the geometry checks' to catch; the thumbnail says where something moved. Orbs and canvases are hidden in screenshots (their idle
motion is random by design). Goldens are taken in the lab's own Chromium; another machine's font rasteriser can differ,
which shows as visual failures there and nowhere else. The lab never fetches a font: the Google Fonts stylesheet `tokens.css`
imports is served from `@fontsource` (`/__gfonts`), the faces the app bundles, so a page's load never waits on the network.

## The v7 checks

LAB-v7 (`docs/design/v7/LAB-v7.md` on `w31/design-system-v7`) turns every defect class the owner found on the v7 boards into a
blocking check, before the v7 kit exists, so the kit (`w32/kit-v7`) is built against them. The in-page rules are ported from the
design's render QA (`docs/design/v7/render-qa.cjs`), the orb rules from the bots' character probes (`ORBS.md`, `probes/tools/rec.cjs`
and `edges.py` on `w31/bot-character`). Each check has its own id, so a v6 story's v7 exception never hides a v6 regression.

**The story interface.** A v7 check never names a class: it names kit components, and `tests/lab/v7.mjs` (`ROLES`) says which
elements are each one. Every component matches `[data-kit~="<Name>"]` on its root (`[data-kit-part~="<Name>"]` for a part: a
Segmented item, a dock's row, a diff row), which the v7 kit sets; until it is built, the list also names today's v6 class for the
same job (`.ui-btn` for Button, `.ui-menu__item` for MenuRow, ...), so the checks run now on every v6 story. kit-v7 deletes each v6
selector with the class it retires. The same file lists the kit's 42 components (`KIT_V7`), the merged names (`RETIRED`), the
accents of the contrast matrix and the surfaces where a bot is at rest.

| Check | LAB-v7 name | Rule | What fails | Where |
|---|---|---|---|---|
| `geometry.wrap` | geometry.wrap | R-row-1, R-type-11 | a Segmented item, Chip, Button, Badge, Kbd, SelectorItem, title pill, InlineChip, StatusWord, Tooltip, MenuRow or countdown on more than one line, or its text wider than its box without an ellipsis | `probe-v7.js` |
| `geometry.row` | geometry.row | R-row-1 | in a MenuRow, ListRow, OptionRow, Row, queue or file row: a text run on two lines (a two-line label is two elements), cut without an ellipsis, or past the row's padding edge | `probe-v7.js` |
| `geometry.escape` | geometry.contain (extended) | R-corner-4, R-overflow-1 | the visible part of an element, after its own clipping ancestors, outside its story cell, or outside the window (a fixed layer on both axes) | `probe-v7.js` |
| `geometry.padding` | geometry.padding | R-space-3 | Card, Block, ToolRow, FilesCard, AskCard, Queue, Notice, Menu, Tooltip, Chip, Button, Badge, Bubble, ListRow, OptionRow, Row: left padding not right, or top not bottom, within 0.5 px | `probe-v7.js` |
| `geometry.align` | geometry.align | R-space-4 | the rows of a Card, steps, queue, menu, file, diff and sidebar rows, the thread's agent-side blocks: left edges more than 0.5 px apart; a DiffView comment off the code column | `probe-v7.js` |
| `concentric.strict` | concentric (tightened) | R-corner-10 | a control in a container's corner zone: radius not outer − inset (floor 6), insets unequal by more than 0.5 px, or past the container's edge, measured after CSS zoom; a pill in a pill on equal insets passes. At rest only controls with a shell; under forced hover, focus and pressed, all | `probe-v7.js` |
| `inline-baseline` | inline-baseline | R-inline-1 | probe.js's check (above), its chips extended to the v7 InlineChip, Badge, Mark and countdown | `probe.js` |
| `mark.rest` | mark.rest | section 17 | a dashed underline at rest outside feedforward (the composer, a reply's guess), an AskCard or a blank; an info label's mark at rest | `probe-v7.js` |
| `sweep` | sweep | 9.2, P4 | in a still (reduced motion): a gradient clipped to text (a shimmer frozen mid-sweep) or a looping animation (a breath frozen mid-cycle); `[data-motion]` strips are exempt | `probe-v7.js` |
| `same-component` | same-component | 21, 21.4 | a dock without the one component's geometry (`data-dk`, `data-geom`, `data-pad`), a row or compact dock whose width is not its content plus twice the padding, or a dock, composer, title pill or AskCard drawn with another geometry than the one most renders share (compared across every state at the first preset and 1440) | `probe-v7.js`, `check.mjs` |
| `contrast.accent` | contrast | R-a11y-1, 18 | `--accent-text` and `--focus` under 4.5:1 on `--bg-1` or `--bg-3`, `--on-accent` on `--accent`, in every preset (and every accent of `ACCENTS`, once the theme exposes `__lab.accent(hex)`); or the theme does not define them. Reported against `src/styles/tokens.css` | `check.mjs`, `static-v7.mjs` |
| `kit.single` | kit.single | 21 | a merged name (QueueStrip, LimitNotice, Toast, Banner, ScopePicker, SettingsLine, SteerLine, CheckpointBar, ChoiceCards, LaunchCard, ReferenceChip) in the UI's source, in any spelling; a kit component without `src/lab/stories/kit/<name>.stories.ts` | `static-v7.mjs` |
| `tokens.loose` | the token check | R-space-1 | a literal padding, margin, gap or inset (px, rem; not 0 or the 1px hairline) in the UI's CSS outside the token files. Colours, font sizes and radii stay `tokens.static`'s | `static-v7.mjs` |
| `orb.rest` | orb flicker | 10, 21.4, ORBS G5 | a bot at rest (on the dock, the Bots sidebar or the rail, a rest reaction, not hovered, no attribute changed for 1.5 s) changes any canvas pixel between frames | `orbs.mjs` |
| `orb.edges` | edge checks | ORBS G6, G7 | on any orb: shimmer (edge pixels that step out and back while the shape holds), a lone flipping pixel, a canvas that jumps or refits. A-B-A inside real motion is reported, not blocking | `orbs.mjs` |

```sh
pnpm lab:check [--area dock]       # every check above but the orbs, in the whole matrix; lab-report/summary.json
pnpm lab:gate                      # what CI decides on that report (LAB_V7_BLOCKING=1 pnpm lab:gate: as it will once v7 blocks)
pnpm lab:orbs [--story dock/dock]  # the orb checks; lab-report-orbs/summary.json
node tests/lab/gate.mjs lab-report-orbs/summary.json
pnpm lab:static [--all]            # kit.single, tokens.loose and the accent tokens, from the source alone (seconds)
pnpm exec vitest run src/lab/v7-checks.test.ts   # the checks' own proof: each fires on its defect and passes its counterpart
```

**The orb run.** `pnpm lab:orbs` loads each state with full motion, the orbs on the main thread (`?orbs=main`, so their canvases
can be read) and Playwright's clock installed and paused, then reads 48 frames 32 ms apart (two orb updates each) from every orb's
own canvas, as the character probes do: exact pixels, no screenshot. Math.random is seeded; the frames still differ from run to run
by a pixel here and there.

**Fonts.** The lab draws only the bundled `@fontsource` faces: the stylesheet's Google Fonts URL is answered from them (`serve.mjs`),
and a request that still reaches Google is an `errors` finding, in `lab:check` and in `lab:orbs`.

**Report-only until the kit lands.** Today's v6 screens fail v7 rules by design, and the v7 kit replaces them, so the v7 checks
(every `rules.mjs` row with `v7: true`) are printed and counted by `tests/lab/gate.mjs` but fail CI only when `LAB_V7_BLOCKING` is
`1`. CI sets it to `"0"` in `.github/workflows/ci.yml`'s top-level `env`; **kit-v7 turns it to `"1"`** when its components have
replaced the v6 screens. While it is off, a v7 finding gets no crop in the report (a crop is a full-page screenshot, and the run
would spend its time on findings that do not block). Every other check but `visual` blocks as before.

**The kit's stories** (`src/lab/stories/kit/`, one per v7 component) draw on a v7 root (the frame's body, `data-ui="v7"`), and
`check.mjs` runs them in v7's two themes, `dark` and `light` (`--kit-presets`), not the v6 presets; their token checks read
`tokens.v7.css` too. `__lab.accent(hex)`, `__lab.corners('b' | 'c')` and `__lab.shadow('a' | 'b' | 'c')` set section 18's
customization. On a kit story `concentric.strict` replaces v6's `concentric` (LAB-v7 section 4: the tightened rule, floor 6).
**The app's v7 surfaces** (`src/lab/stories/v7/`: the chrome, the sidebar's head, foot and roster, the rail, a bot's chat and a room,
w33/shell-bots) boot the whole app in v7's two themes, as the kit's stories do, and scope their checks to the part that is on the kit.
`LAB_V7_BLOCKING: "kit"` (ci.yml) makes every v7 finding on a kit story, a `v7/` story or in `src/components/v7/` block, and keeps the v6 screens'
v7 findings reported.

**Not yet in the matrix.** LAB-v7's axes beyond today's (dark and light, corners B and C, three accents, three densities) need the
v7 theme, which kit-v7 builds; until then the matrix is the v6 presets and widths. The contrast check already walks `ACCENTS` when
the theme exposes `__lab.accent`; kit-v7 adds the light and the dark accent once the owner names their values, and the theme,
corners and density hooks to `check.mjs`.

## What CI blocks on

The `lab` job runs `pnpm lab:check --jobs 2`, then `node tests/lab/gate.mjs`: it fails on any finding whose check is not `visual`,
except the v7 checks while `LAB_V7_BLOCKING` is not `1`. The `lab-orbs` job runs `pnpm lab:orbs --jobs 2` and the same gate on its
report (report-only until the switch is on). The `ui` job runs `src/lab/v7-checks.test.ts` with the unit tests, and the
inline-chips runs at DPR 2 and 1.6 through the gate.

## Read the report

`lab-report/index.html` (gitignored; CI uploads it as the `lab-report` artifact): a table of failures by area and
check, then each area's failures by check. Every failure names the story and state, the element, the message, every
preset, width and forced state it showed in (`catalog/1440/hover`), a crop with the element outlined, the pixel
difference for a visual failure, and the v6 mock's counterpart. `lab-report/summary.json` has the same, for a script:
`failures`, `byArea`, `byCheck`, `byAreaCheck`, `findings[]`, `rules` (coverage). `node tests/lab/findings.mjs` turns a
summary into `docs/UI-LAB-FINDINGS.md` (grouped by area and check, the same failure across states on one line).

**Accept goldens** only for a change you meant: run `pnpm lab:check --update` (narrow it with `--area` or `--story`),
look at the thumbnails that changed in `git diff --stat tests/lab-golden`, and commit them with the change.

## Add a story or a state

Stories are data: `src/lab/stories/<area>/<thing>.stories.ts` exports a `Story` (or an array) as `default`
(`src/lab/types.ts`).

```ts
import { ui } from '@boopis/ui';
import { line, stage, forced } from '../../story';
import type { Story } from '../../types';

const typical = stage(['typical'], ({ root }) => { line(root, ui.button({ label: 'Deny' })); });
export default {
  id: 'components/button', title: 'Button', area: 'components', kind: 'component', covers: ['ui.button'],
  mock: { url: '/v6/design-system/index.html#c-buttons', crop: '#c-buttons' },
  states: {
    typical,
    ...forced(typical, '.ui-btn'),            // hover, focus, pressed
    long: stage(['long'], ({ root }) => { line(root, ui.button({ label: 'A label long enough to wrap twice' })); }, { width: 360 })
  }
} satisfies Story;
```

- A **stage** state (`render`) draws kit components on the stage: import the kit, `@boopis/ui` (`ui`, `html`), and use
  its public API (props and the variants it exports, `variants`), never a module's internals or hand-built kit markup
  (the kit's guard, `src/components/kit.guard.test.ts`, reads the lab too).
- An **app** state (`app: { provider, setup }`) boots the whole app on a provider (`src/lab/provider.ts`: the mock with
  fixtures, no bots, one, `120`, no sessions, or `replay: 'session'` for the live provider over recorded gateway
  frames) and drives it in `setup` (`c.hx.setState`, `c.hx.dock()`, `c.click`, `c.key`). `scope` says what the checks
  and the screenshot look at.
- Tag every state (`typical`, `empty`, `long`, `many`, `single`, `error`, `loading`, `disabled`, `expired`, `success`,
  `variant`, `size`, `rtl`, `owner`, `scroll`, `hover`, `focus`, `active`, `tooltip`, `open`).
- `force` forces a pseudo-state on part of the state; `overlay: { anchor, layer }` names an overlay that should be open
  (the overlay check reads it); `interact` lists interactions the stability check samples; `zoom` lays the state out as a web view's page zoom does (1/zoom of the window, the pixel ratio times zoom: the desktop's interface size); `allow` excuses a check for
  that state, with the reason (the report shows it). Give it `{ el, reason }` instead of a bare reason to excuse only the
  findings whose element description contains `el` (for axe, the target and the rule's id), so one element's excuse
  never silences the rest of the state. An excuse that holds in every state, because the rule itself leaves the element out, is
  not copied into stories: it is one entry of `STANDING_ALLOW` in `rules.mjs` (`{ check, el, reason }`), which `skip()` in
  `check.mjs` honours for any state. Today's only entry is the dock's page dots (`ui-pages__dot`, `geometry.target`: R-a11y-2
  names them, a 24 px wide hit area would cover the neighbour at the nub's 10 px pitch), wherever the dock is in the window.
- Fixtures (`src/lab/fixtures.ts`) are real first: the v6 mock-up's card and form gallery data, the mock roster, the
  recorded frames; then the hard cases (long names, unbroken strings, many lines, right to left).

**The rule: every new component ships with stories.** The coverage gate (`src/lab/coverage.test.ts`, part of
`pnpm test`) fails when an export of `ui`, a card kind (or one of its states), a form kind, a surface, a mod surface or
a page has no story, or when a component or card story lacks a `typical` and a `long` state, an `empty` state where
emptiness applies, or an `error` state where failure applies. Exceptions go in `src/lab/coverage.ts`, each with its
reason.

**Add a check.** Add a row to `tests/lab/rules.mjs` (its main rule ID, and the others in `ALSO`), implement it in
`probe.js` (in-page: return `{ check, msg, el, rect }` findings) or in `check.mjs` (needs the browser), and list it in
this file. Findings group by area in the report and in `docs/UI-LAB-FINDINGS.md` without more work.
