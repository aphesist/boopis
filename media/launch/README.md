# boopis launch film: the engine

A seekable page that draws the film with the real product kit (`@boopis/ui`, `apps/desktop/ui`), a renderer that turns
it into frame-exact video, and a craft checker that measures a render against the craft bible.

```sh
cd media/launch
pnpm install                     # once (vite, gsap, flubber, playwright, the fonts)
pnpm dev                         # http://127.0.0.1:5280/index.html?scene=kit  (the preview HUD)
pnpm build                       # dist/, what the renderer serves
pnpm typecheck
```

Chromium comes from the pre-installed Playwright; never run `playwright install`.

## Mount a kit component in a page

The kit is imported from where it lives, never copied: `@boopis/ui` is an alias for
`apps/desktop/ui/src/components/index.ts`, and `@ui/...` for anything under `apps/desktop/ui/` (vendor files, tokens).
`src/engine/kit.ts` loads everything a page needs in one import: the product's tokens and kit CSS, the vendored
`<orb-avatar>` and `<boopis-logo>`, and the fonts from `@fontsource` (self-hosted; the Google Fonts `@import` in the
product's `tokens.css` is stripped by `vite.config.ts`, so a page never reaches the network).

```ts
import { mount, ui } from './engine/kit';           // from a scene in src/scenes/
import { FilmOrb } from './engine/orb';
import { logoSVG, markGeometry } from './engine/logo';
import { place, el } from './engine/stage';

// 1. any kit factory, exactly as the app calls it
const composer = ui.composer({ placeholder: 'Describe the change', chips: [{ label: 'Smart', pressed: true }] });
composer.setValue('plan the billing migration with nina and kai');

// 2. at film scale: mount() wraps it in a box with CSS zoom (2.25 = the product's real size x 2.25). Text and corners
//    are laid out at that size, so they stay vectors (never a scaled bitmap). `width` is the real (unzoomed) width.
const box = mount(composer, { zoom: 2.25, width: 620 });

// 3. place the wrapper in 1080p px (centred on x, y by default; { anchor: 'topleft' } for a corner)
stage.layer('stage').appendChild(place(box, 960, 760));

// an orb: drawn from a pose, never from its own clock (see "Orbs" below)
const orb = new FilmOrb({ shape: 'circle', color: '#4fc9a8' }, 260, { eyes: 'pill', yaw: 10 });
film.onRender(() => orb.render());

// the mark or the wordmark, one colour, from the logo's own export
const mark = el('div', '', logoSVG({ mark: true, color: 'var(--text-strong)' }));
```

`src/scenes/kit-sheet.ts` is this example as a whole page (`?scene=kit`).

Rules that come with the kit on the film's stage (`engine/kit.ts`):
- `mount()` neutralises the component: every CSS transition and keyframe animation on the page is off (one stylesheet),
  Web Animations the kit starts from script are cancelled on every seek, and every `<orb-avatar>` is made `static`
  (its own frame loop never draws it again).
- The orb **worker** is never started: a film page never calls the kit's `setupOrbs()`, `startGlance()` or
  `ui.tooltip.enable()`. Nothing on the page runs on a timer.
- Zoom: the kit's text is 11 to 14 px at real size. The craft bible's floor is **28 px at 1080p** for text that must
  be read, so a component whose words matter is mounted at 2.25x or more (14 px x 2.25 = 31.5 px); the checker reports
  every run under 28 px (`qa --page`).
- A theme preset: `mount(c, { preset: 'graphite' })` (the product's `data-hx-preset`).
- Measure a mounted component (to carry it, to aim the camera at it) during the scene's build, before the first seek:
  the camera has not transformed the layers yet, so `getBoundingClientRect()` gives world px.

Style frames (`look/`) are the art director's, with their own config; they can import the same modules.
