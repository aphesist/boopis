# boopis launch film: the engine

A seekable page that draws the film with the real product kit (`@boopis/ui`, `apps/desktop/ui`), a renderer that turns
it into frame-exact video, and a craft checker that measures a render against the craft bible
(`SC/research/craft-bible.md`; `SC` is the team's shared folder, `FILM_SC` overrides its path).

```sh
cd media/launch
pnpm install                     # once (vite, gsap, flubber, playwright, the fonts)
pnpm dev                         # http://127.0.0.1:5280/index.html?scene=test  (the preview HUD)
pnpm build                       # dist/, what the renderer and the checker serve
pnpm typecheck
pnpm render -- --scene test --preview          # a fast check
pnpm qa -- SC/renders/test-landscape-1920x1080.mp4 --scene test
```

Chromium comes from the pre-installed Playwright; never run `playwright install`. ffmpeg is `/usr/bin/ffmpeg`.

| Path | What |
|---|---|
| `src/engine/` | the film runtime: `film.ts` (the clock: one paused GSAP timeline, renderers, `seek`), `stage.ts` (frame, layers), `kit.ts` (the product on stage, neutralised), `orb.ts` (orbs drawn from a pose), `logo.ts` (the mark's real geometry), `ground.ts` (ground, light, grain), `expose.ts` (`window.__film`), `hud.ts` (preview only) |
| `src/motion/` | the motion library (below); `beats.ts` reads the script's `beats.json` |
| `src/scenes/` | scenes; `index.ts` is the registry (`?scene=<name>`); `test.ts` is the engine's test scene, `kit-sheet.ts` a still sheet of the kit |
| `script/beats.json` | the committed snapshot of `SC/script/beats.json` (`pnpm beats:sync` refreshes it) |
| `tools/render.mjs`, `tools/lib/` | the renderer: workers, PNG decoding, motion blur, grain, ffmpeg |
| `tools/qa/` | the craft checker |
| `look/` | the art director's style frames (their own config; not part of this build) |

## Deterministic time (the rules every scene keeps)

The page exposes `window.__film = { duration, fps, width, height, seek(t), moving(t0, t1), samples(t0, t1), tweens(),
text(), fades(), cuts, marks, grain }`. `seek(t)` is async: it puts the timeline at `t`, runs every renderer, cancels
any Web Animation, waits for fonts and images and resolves after the paint.

- **All motion is one paused GSAP timeline (`film.tl`), seeked by time.** GSAP and every plugin are free from npm
  (MorphSVG, SplitText, CustomEase, Flip are in `node_modules/gsap`).
- What GSAP cannot set directly (an orb's pose, a morphing path, the camera, a carry, the grain) is drawn by a
  **renderer**: `film.onRender((t) => ...)`, a pure function of `t` (or of tweened proxy objects). Lower priorities
  run first: -10 decides what is shown, 0 draws, the camera follows.
- **Nothing time-based drives film motion:** no `Date.now`, `performance.now`, `setTimeout`, `requestAnimationFrame`
  loops, CSS transitions or keyframes (`engine/kit.ts` turns every one off with one stylesheet), and no `Math.random`
  (use `engine/rng.ts`, seeded).
- **The kit is neutralised:** `mount()` freezes every `<orb-avatar>` (`static`: orb2's loop never draws it again);
  the orb worker is never started (a film page never calls `setupOrbs()`, `startGlance()` or `ui.tooltip.enable()`).
- **Fonts are self-hosted** (`@fontsource`, Libre Franklin 400 to 700, IBM Plex Mono 400 and 500). Every face is
  loaded before the first frame, so no frame is drawn in a fallback face.
- **Determinism is measured:** the same frame renders the same pixels whatever was seeked before (forward, backward,
  from any worker's starting point); the finished film's frame hashes match across renders with different worker
  splits (see "Render").
- Build-time timeline rule: `film.finalize()` sweeps the timeline forward and back once, so every tween records its
  start values in time order. Prefer `fromTo` with explicit values; a `to()` is fine after that sweep.

## Mount a kit component in a page

The kit is imported from where it lives, never copied: `@boopis/ui` is an alias for
`apps/desktop/ui/src/components/index.ts`, and `@ui/...` for anything under `apps/desktop/ui/` (vendor files, tokens).
`src/engine/kit.ts` loads everything a page needs in one import: the product's tokens and kit CSS, the vendored
`<orb-avatar>` and `<boopis-logo>`, and the fonts (the Google Fonts `@import` in the product's `tokens.css` is stripped
by `vite.config.ts`, so a page never reaches the network).

```ts
import { mount, ui } from '../engine/kit';
import { FilmOrb } from '../engine/orb';
import { logoSVG, markGeometry } from '../engine/logo';
import { place, el } from '../engine/stage';

// 1. any kit factory, exactly as the app calls it, given the script's own content (never the app's mock data)
const composer = ui.composer({ placeholder: 'Message kai', chips: [] });
composer.setValue('plan the launch with nina');

// 2. at film scale: mount() wraps it in a box with CSS zoom (2.5 = the product's real size x 2.5). Text and corners are
//    laid out at that size, so they stay vectors (never a scaled bitmap). `width` is the real (unzoomed) width.
const box = mount(composer, { zoom: 2.5, width: 540 });

// 3. place the wrapper in 1080p px (centred on x, y by default; { anchor: 'topleft' } for a corner)
stage.layer('stage').appendChild(place(box, 960, 760));
```

- Zoom: the kit's text is 11 to 14 px at real size; the floor for text that must be read is **28 px at 1080p**, so a
  component whose words matter is mounted at 2.25x or more (14 px x 2.5 = 35 px). The checker reports every run
  under 28 px.
- A theme preset: `mount(c, { preset: 'graphite' })` (the product's `data-hx-preset`).
- Measure a mounted component (to carry it, to aim the camera at it) during the build, before the first seek: the
  camera has not transformed the layers yet, so `getBoundingClientRect()` gives world px (`boxOf(el, stage)`).
- **Content:** the app's mock data and README screenshots contain names that must never appear in the film. Give every
  component the script's own content (`SC/script/cast.md`): kai is Claude, nina ChatGPT, moss GitHub Copilot, vox
  SuperGrok; the room is "release".

`src/scenes/kit-sheet.ts` is a whole page of this (`?scene=kit`).

### Orbs and the mark

The kit's orb animates itself (a loop, springs integrated over frame time, random blinks). A **film orb**
(`engine/orb.ts`) is drawn from a **pose** instead: orb2's own geometry, asked of a detached, never-connected
`<orb-avatar>` through its `toSVG()` export, so the body outline and the eyes (projected on the body's hidden sphere)
are exactly the product's, and a pose is a pure function.

```ts
const kai = attach(film, new FilmOrb({ shape: 'circle', color: '#4fc9a8' }, 300, { eyes: 'pill', yaw: 6 }));
glance(film, kai, at, -10, 14);         // degrees, on the character spring
blink(film, kai, at);                   // orb2's 0.155 s blink on its own curve
eyes(film, kai, at, 'arc');             // orb2's own face morph to another eye shape
shape(film, kai, at, 'squircle');       // body morph;  colour(film, kai, at, '#f5a337'): an opaque fill change
life(film, kai, t0, t1, seed);          // a seeded idle life (glances every 1.8 to 2.6 s, blinks)
orbMark(film, kai, { mark: markGeometry(330), markColor: 'var(--text-strong)', toMark: { at, dur }, toOrb: { at, dur } });
```

The pose's numbers (`yaw`, `pitch`, `blink`, `eyesMix`, `shapeMix`, `colorMix`, `scale`, `squash`, `dx`, `dy`) can
also be tweened directly: `film.tl.to(kai.pose, { yaw: 12, ... })`. `size` is the kit's orb size (orb2 draws the
body at 0.96 of it). `markGeometry(width)` is the boopis mark's two eyes sampled from the logo's own `BoopisLogo.svg()`;
`logoSVG()` the mark or wordmark as one colour.

## Add a scene

1. Write `src/scenes/<name>.ts`:

   ```ts
   import type { Scene } from './types';
   import { ground } from '../engine/ground';
   import { camera, grid, beat, rise, setType, split, arrive } from '../motion';

   const scene: Scene = {
     config: { name: 'b03', duration: beat('B03').dur, fps: 60, bpm: 112.5 },
     build(film, stage) {
       const g = grid(film);
       ground(film, stage);                       // the script's ground: warm dark, brass pool, grain 2.5%
       const world = stage.layer('stage', 1);     // depth 1; 'ground' 0.25 is built in; 'front' 1.25 for cursors
       const cam = camera(film, stage);
       film.mark('B03', 0);                        // scene boundaries, for the checker
       // ... lay out (in 1080p px), then write the timeline: every landing on the grid
     }
   };
   export default scene;
   ```

2. Add one line to `src/scenes/index.ts`: `b03: () => import('./b03'),`.
3. `pnpm dev`, open `?scene=b03` (space plays, arrows step a frame, shift a second; `&t=1.2` opens at a time,
   `&variant=vertical` the 9:16 layout, `&nograin`).
4. Lay out both variants from one timeline: read `film.variant` (`'landscape'` 1920x1080 or `'vertical'` 1080x1920)
   and recompose (never crop), as `test.ts` does with its two `Layout`s.
5. Render a preview, look at the frames, run the checker (below).

A scene that is part of the whole film uses the script's absolute times (`beat('B03').start`); a scene rendered on
its own starts at 0 (subtract its beat's start).

## Timing helpers

`src/motion/time.ts` (the grid) and `src/motion/beats.ts` (the script):

```ts
const g = grid(film)              // film.bpm (112.5) and fps (60): 32 frames a beat, 128 a bar
g.beat(3)                         // the time of beat 3 (beats count from 0; 0.5 steps are half-beats)
g.bar(2, 1)                       // bar 2 (from 0), beat 1
g.f(24)                           // 24 frames, in seconds
g.beats(1.5)                      // a duration
g.land(g.beat(4), 30)             // the start of a 30-frame move that LANDS on beat 4 (landings sit on the grid)

beat('B03')                       // the script's beat: { start, end, dur, bar, words, picture, carry_out, sound, ... }
at('5.3')                         // 9.6: the script's bar.beat notation (1.1 = 0 s; '3.2.5' is a half-beat)
span('2.2-3.2.5')                 // [2.667, 5.067]
beatsIn('B05')                    // every beat's time inside B05
script.check()                    // beats whose start_s/end_s disagree with their bar strings (empty: clean)
FILM_DURATION                     // 46.933
```

`beats.ts` reads `beats.json` itself: the live file in the shared folder when it is there, else the committed snapshot
(`vite.config.ts` picks; `FILM_BEATS=<path>` forces one).

## The motion library (`src/motion`)

Curves and springs are the craft bible's part 3, exactly. Every ease returns exactly 0 and 1 at its ends and carries
its name for the checker.

| | |
|---|---|
| `arrive`, `travel`, `snap`, `depart` | the film's curves (expo-out, quint in-out, strong in-out, quart-in) |
| `ui`, `uiSpring` | the product's own `--ease` and `--spring`, for anything the real app animates |
| `linear` | constant motion that never starts or stops on screen only; such a tween says `data: { linear: true }` |
| `springEase('settle' \| 'camera' \| 'character')`, `springDuration`, `springAt`, `springStats` | closed-form springs (k 300/c 30, 170/26, 400/22); `character` only for orbs and the mark |
| `camera(film, stage)` | the 2.5D camera: `to({ x, y, zoom, roll }, { at, dur, ease })`, `drift(...)` (slow, no blur), `focus(depth, blurPerDepth)`, `project`/`unproject`, `stateAt(t)`. Zoom in log space; parallax by layer depth (zoom^d, travel x d). A `snap` move asks the renderer for 32 sub-frames |
| `carry(film, el, { from, to, at, dur, radius, fill })` | shared element (FLIP): one box morphs position, size, radius and fill from scene A's box to scene B's |
| `carryOrb(film, holder, orb, { from, to, at, dur, camera })` | the same for an orb; with `camera` the carry travels in screen space (a steady path on screen during a camera move) and is world-locked before and after |
| `morph`, `morphSplit`, `morphJoin` | SVG shape morphs (flubber): one into one, one into several, several into one |
| `orbMark` | the orb's body divides into the mark's two eyes (and joins back); one opaque shape at every frame |
| `wipe`, `iris`, `lids`, `focus` | clip reveals from an edge or a point, the blink transition (two opaque lids), the focus pull (T7) |
| `setType`, `split(el, 'line' \| 'word' \| 'char')`, `rise`, `soft`, `sink`, `typeOn`, `exit` | type per line, word or character behind masks (`rise` and `sink` move units inside their masks, no opacity); K1 (`soft`, `exit`), K2 (`typeOn`) |
| `cursor(film, layer, start)` | the oversized cursor: `move(x, y, { at, dur })` on a slight arc, `press(at)` (dips to 0.85, returns the frame the target reacts on) |
| `glance`, `blink`, `eyes`, `shape`, `colour`, `life`, `attach` | an orb's moves (above) |
| `fadeSmall(film, stage, el, { at, dur, y })` | the only opacity helper: it throws for an element over 10% of the frame or without movement |

**No helper produces a full-layer cross-fade.** Things change by shape, position, scale, mask or focus; opacity only
moves small units (a word, a character, a chip) together with movement. The checker fails any opacity tween on an
element over 10% of the frame, and any blended frame over 8% of the frame in the video.

## Render

`tools/render.mjs` (or `pnpm render -- ...`): it builds the page, serves `dist/` on loopback, and runs N Playwright
workers over contiguous frame ranges; each captures every frame as a lossless PNG (Chrome's fast encoder through CDP),
decodes it and pipes raw RGB into its own ffmpeg; the segments are joined without re-encoding and the frame count is
checked. No image sequence is ever written to disk.

```sh
node tools/render.mjs --scene test --preview                      # 960x540, 30 fps, no blur: judge rhythm
node tools/render.mjs --scene test                                # 1920x1080 60 fps, H.264 CRF 14, BT.709, 8 sub-frames at 180 deg
node tools/render.mjs --scene test --scale 2                      # 3840x2160 60 fps (deviceScaleFactor 2: same layout, crisp)
node tools/render.mjs --scene test --variant vertical             # 1080x1920
node tools/render.mjs --scene test --codec prores                 # ProRes 4444 master (.mov); --codec lossless: FFV1 RGB (.mkv), exact
node tools/render.mjs --scene test --from 3 --to 4.5              # a range in seconds (or --from-frame / --to-frame)
node tools/render.mjs --scene test --still 300                    # frame 300 to PNG (--at 5.0 for seconds; add --samples 1 for no blur)
node tools/render.mjs --scene test --audio mix.wav                # mux a wav (AAC 320k 48 kHz in mp4, 24-bit PCM in mov/mkv)
node tools/render.mjs --mux film.mp4 --audio mix.wav --out film-sound.mp4   # put a wav under an existing render
node tools/render.mjs --scene test --hashes h.json                # every frame's pixel md5 (determinism)
```

Output defaults to `SC/renders/<scene>-<variant>-<size>.<ext>`. Options: `--samples` (sub-frames, 1 turns blur off),
`--shutter` (degrees), `--crf`, `--fps`, `--workers` (default 4, one per core), `--no-build`, `--out`.

**Motion blur.** Each frame asks the page what moves under its shutter (`__film.samples`): nothing (one capture),
the default (8 sub-frames centred on the frame's time, averaged in linear light), or more where a tween asks
(`data: { samples: 32 }`; camera snaps do it themselves, so whips and zoom-throughs streak without stepping). A frame
whose shutter's two ends barely differ (a slow glance) keeps those two and skips the rest. Sub-frames never cross a
hard cut (`film.cut(t)`). Tag a slow drift `data: { blur: false }` (the camera's `drift()` does).

**Grain** is added by the renderer to each finished frame (the same seeded tiles the page draws in previews): a page
without grain captures about twice as fast, and the grain is never averaged by the motion blur.

Speeds (this machine: 4 cores, no GPU, 4 workers; the test scene, 448 frames of which most move):
see "Measured" at the end.

## The craft checker

```sh
node tools/qa/qa.mjs <video.mp4>                         # any video, the first trailer included
node tools/qa/qa.mjs <video.mp4> --scene test            # and the page it came from (exact DOM and timeline checks)
node tools/qa/qa.mjs --scene test --variant vertical     # page checks only
node tools/qa/qa.mjs <video.mp4> --scene test --json report.json
```

It exits 1 when a rule fails. On the video (the research's own methods, `research/measure`, `corpus.md`):

| check | method | rule |
|---|---|---|
| stillness | 12 fps steps on a 160x90 grey thumbnail; still when the mean luma change is under 0.6 | longest hold at most 1.5 s; still share reported (MG median 0.19) |
| dips to black | every frame at 160x90: pure black when 99% of pixels are at most 4 and none above 32; near black when 99% are at most 16 | none |
| full-frame cross-fades | over the pixels that differ between f(t-w) and f(t+w), f(t) = a f(t-w) + (1-a) f(t+w), a in [0.15, 0.85], residual under 0.3 (moves, morphs and motion blur leave a large one), w 3 to 12 frames at 30 fps, 3 frames or more; over 8% of the frame fails | none |
| hard cuts | ffmpeg scene score over 0.22 | reported |
| first words | a band of rows dense with letter edges (a heuristic for videos without a page) | by 1.5 s |
| totals | length; scene changes = cuts, dips and cross-fades merged within 0.5 s | reported |

On the page (`--scene`): text under 28 px at 1080p (every visible run, sampled 4 times a second, 1em measured through
every zoom and transform), the first claim (two legible words, in 1/30 s steps), linear and unspecified eases on any
tween, opacity tweens on elements over 10% of the frame, the content's own stillness (captured without grain or
codec), and the scene marks.

Calibration on the first trailer (`SC/trailer/boopis-trailer.mp4`) against the postmortem: see "Measured".

## What a scene animator must know

- One paused timeline; renderers are pure functions of time. Never read a clock, never use `Math.random`.
- Landings on the grid: `g.land(beat, frames)`. The script's times come from `beat('Bxx')`, never typed by hand.
- Define every camera move before a `carryOrb(..., { camera })` or a `cam.stateAt()` that reads it.
- A carried element lives in a world layer; across a camera move give it the camera so it travels in screen space.
- Two morphs of one path keep to their windows (the latest started draws); so do carries of one element.
- Opacity is for small units with movement only (`fadeSmall` enforces it). Big things morph, move, mask or defocus.
- Text that must be read: 28 px or more on screen. The checker measures what is drawn, through every zoom.
- Mounted kit components: their transitions are off; drive their visible state from the timeline (a renderer that
  sets the attribute the kit's CSS reads, as `test.ts` does for the composer's placeholder and send button).
- Fast moves: `snap` on the camera asks for 32 sub-frames; tag any other very fast tween `data: { samples: 24 }`.
- Before calling a scene done: a preview, a contact sheet of its frames, the checker on the render and the page.
