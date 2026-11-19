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
pnpm lab:check --area composer        # one area: components, composer, shell, settings, bots, cards, dock
pnpm lab:check --story dock/dock --state "one bot"
pnpm lab:check --quick                # two presets (catalog, bone), one width (1440): the fast loop while fixing
pnpm lab:check --draw-only            # only that every state draws without an error
pnpm lab:check --update               # accept the screenshots as the new goldens
pnpm lab:check --strict               # exit 1 on any failure (CI)
```

Other flags: `--presets catalog,bone`, `--widths 390,1440`, `--jobs 3`, `--no-visual`, `--no-axe`, `--no-stability`.
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

`tests/lab/rules.mjs` lists each check with the design-system section it enforces (and its rule ID from
`design/v6/design-system/RULES.md` once that file names one); `tests/lab/probe.js` implements the in-page ones.

| Check | What fails |
|---|---|
| `errors` | the state does not draw, or the console or the page reports an error |
| `geometry.contain` | a shaped child (its box, rounded corners, hover fill and focus ring) reaches outside its shaped container's rounded rect or squircle path; a child cut by `overflow: hidden` is reported as cut |
| `geometry.center` | an item of a control row (a flex row up to 64px tall) is more than 1px off the row's centre |
| `geometry.clip` | text is cut without an ellipsis |
| `geometry.hscroll` | the window, or a scroller that is not code, scrolls sideways |
| `geometry.target` | a target under 24 x 24 px whose 24px circle meets another target (WCAG 2.5.8) |
| `concentric` | a shape in a container's corner: unequal insets, a radius that is not outer − inset (floor 8) or a pill, in rest, hover, focus and pressed (section 8.2, 14.10) |
| `overlay` | a tooltip, menu or popover covers its anchor, sits off the system's gap (8px; 10px for a tooltip to the right), leaves the window's 8px margin, is not aligned (tooltips centred, menus at the anchor's start inset 8, end or centre), opens above when it should open below, or covers the text field of its anchor's container |
| `tokens.computed` | a computed colour, background, border, outline, fill, shadow colour, font size or radius that is not a token of the active preset (resolved on the element's ground, so the dock's re-derived tokens count) |
| `tokens.spacing` | padding or gap off the spacing scale. A **warning**: the system names some literal paddings itself |
| `tokens.static` | a literal colour, font size, radius or inline-style length in the UI's CSS and TS outside the token files (`tests/lab/static-scan.mjs`) |
| `native` | an unthemed native control: `select`, date, colour, range, file or number inputs, an engine-drawn checkbox or radio, `progress`, `meter` |
| `scrollbar` | a scroller with no `::-webkit-scrollbar` rule (WebKitGTK ignores `scrollbar-width`), a bar wider than 8px, or a thumb that is not `--bg-4` |
| `brand` | rendered text, `aria-label`, `aria-description`, `title`, placeholder or tooltip says "Hermes" (any case). The exception, a Hermes plugin store item under its own name or publisher, is `BRAND_ALLOW` in `rules.mjs` |
| `axe` | an axe-core violation (every rule but page landmarks) |
| `stability.render` | the state drawn twice (a fresh cell, or a reload) has a different DOM structure |
| `stability.interact` | while an interaction plays (with full motion), a node is removed and drawn again, an element goes invisible and comes back, or a box jumps away for a frame or two and comes back |
| `visual` | the screenshot differs from its golden |

**The matrix.** Each state loads once at 1440 x 900 with reduced motion. For each preset (catalog, graphite, bone,
typewriter), at each width (390, 1200, 1440, 1920) the in-page checks run at rest; at 1440, and at 390 in the default
preset, `geometry.contain`, `concentric`, `tokens.computed` and `overlay` run again with every interactive element
forced to hover, then focus, then pressed; at 1440 axe runs and the screenshot is compared. A stage state whose cell is
wider than the window is not run at that width. Then the state is drawn again and its DOM compared; a state with
interactions loads once more with full motion and is sampled frame by frame while they play.

**Goldens.** `tests/lab-golden/<story>/` holds a quarter-scale screenshot per state and preset (`<state>@<preset>.png`)
and the full screenshot's SHA-1 (`hashes.json`). The same hash passes; otherwise the screenshot is scaled the same way
and pixel-diffed against the thumbnail (threshold 0.1, limit 0.5% of its pixels). Full-resolution goldens for every
state and preset would be about 75 MB; these are about a tenth. Orbs and canvases are hidden in screenshots (their idle
motion is random by design). Goldens are taken in the lab's own Chromium; another machine's font rasteriser can differ,
which shows as visual failures there and nowhere else.

## Read the report

`lab-report/index.html` (gitignored; CI uploads it as the `lab-report` artifact): a table of failures by area and
check, then each area's failures by check. Every failure names the story and state, the element, the message, every
preset, width and forced state it showed in (`catalog/1440/hover`), a crop with the element outlined, the pixel
difference for a visual failure, and the v6 mock's counterpart. `lab-report/summary.json` has the same, for a script:
`failures`, `byArea`, `byCheck`, `byAreaCheck`, `findings[]`.

**Accept goldens** only for a change you meant: run `pnpm lab:check --update` (narrow it with `--area` or `--story`),
look at the thumbnails that changed in `git diff --stat tests/lab-golden`, and commit them with the change.

## Add a story or a state

Stories are data: `src/lab/stories/<area>/<thing>.stories.ts` exports a `Story` (or an array) as `default`
(`src/lab/types.ts`).

```ts
import { ui } from '../../kit';
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

- A **stage** state (`render`) draws library components on the stage: use the library's public API through
  `src/lab/kit.ts` (`ui`, `html`), never a module's internals, so the stories move with the library.
- An **app** state (`app: { provider, setup }`) boots the whole app on a provider (`src/lab/provider.ts`: the mock with
  fixtures, no bots, one, `120`, no sessions, or `replay: 'session'` for the live provider over recorded gateway
  frames) and drives it in `setup` (`c.hx.setState`, `c.hx.dock()`, `c.click`, `c.key`). `scope` says what the checks
  and the screenshot look at.
- Tag every state (`typical`, `empty`, `long`, `many`, `single`, `error`, `loading`, `disabled`, `expired`, `success`,
  `variant`, `size`, `rtl`, `owner`, `scroll`, `hover`, `focus`, `active`, `tooltip`, `open`).
- `force` forces a pseudo-state on part of the state; `overlay: { anchor, layer }` names an overlay that should be open
  (the overlay check reads it); `interact` lists interactions the stability check samples; `allow` excuses a check for
  that state, with the reason (the report shows it).
- Fixtures (`src/lab/fixtures.ts`) are real first: the v6 mock-up's card and form gallery data, the mock roster, the
  recorded frames; then the hard cases (long names, unbroken strings, many lines, right to left).

**The rule: every new component ships with stories.** The coverage gate (`src/lab/coverage.test.ts`, part of
`pnpm test`) fails when an export of `ui`, a card kind (or one of its states), a form kind, a surface, a mod surface or
a page has no story, or when a component or card story lacks a `typical` and a `long` state, an `empty` state where
emptiness applies, or an `error` state where failure applies. Exceptions go in `src/lab/coverage.ts`, each with its
reason.

**Add a check.** Add a row to `tests/lab/rules.mjs` (with the design-system rule ID it enforces), implement it in
`probe.js` (in-page: return `{ check, msg, el, rect }` findings) or in `check.mjs` (needs the browser), and list it in
this file. Findings group by area in the report and in `docs/UI-LAB-FINDINGS.md` without more work.
