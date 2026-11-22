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
| `src/engine/` | the film runtime: `film.ts` (the clock: one paused GSAP timeline, renderers, `seek`), `stage.ts` (frame, layers), `kit.ts` (the product on stage, neutralised; `mount()`), `orb.ts` (orbs drawn from a pose), `logo.ts` (the mark's real geometry), `look.ts` (the art director's look and key frames on the engine), `ground.ts` (the engine's default ground), `expose.ts` (`window.__film`), `hud.ts` (preview only) |
| `src/motion/` | the motion library (below); `beats.ts` reads the script's `beats.json` |
| `src/scenes/` | scenes; `index.ts` is the registry (`?scene=<name>`); `test.ts` is the engine's test scene, `board.ts` any storyboard key frame on the engine (`?scene=board&beat=b03`), `kit-sheet.ts` a still sheet of the kit |
| `script/beats.json` | the committed snapshot of `SC/script/beats.json` (`pnpm beats:sync` refreshes it) |
| `tools/render.mjs`, `tools/lib/` | the renderer: workers, PNG decoding, motion blur, grain, ffmpeg |
| `tools/qa/` | the craft checker |
| `look/` | the art director's look (`src/stage.ts`, `src/film.css`, `src/tokens.ts`), style frames and the storyboard's key-frame builders (`src/scenes/`, one per beat); `engine/look.ts` imports them as they are |

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

// 2. at film scale: mount() wraps it in a box with CSS zoom (default 2.6: the product's real size x 2.6). Text and
//    corners are laid out at that size, so they stay vectors (never a scaled bitmap). `width` is the real width.
const box = mount(composer, { width: 540 });

// 3. place the wrapper in 1080p px (centred on x, y by default; { anchor: 'topleft' } for a corner)
stage.layer('stage').appendChild(place(box, 960, 760));
```

- Zoom: the kit's text is 11 to 14 px at real size and the floor for text that must be read is **28 px at 1080p**. The
  default zoom is **2.6**, so the kit's smallest text, its 11 px mono meta, lands at 28.6 px (the art director's
  minimum wherever 11 px text is read). A smaller zoom is allowed for a component whose small text is not meant to be
  read, but the page then warns at load (`[film] mount(zoom 2.25): "14:02" is 24.8 px ...`, with the zoom that would
  fix it), the checker lists the warning, and its text check fails any visible run under 28 px on the page a render
  came from.
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

## The art director's look and key frames

The look (`look/src/stage.ts`, `look/src/film.css`, `look/src/tokens.ts`) and the storyboard's beat builders
(`look/src/scenes/`, one per beat, `SC/storyboard/storyboard.md`) are imported as they are by `src/engine/look.ts`;
scenes build on them rather than on a parallel version:

```ts
import { keyFrame, lookGround, swapOrbs, BOTS, ROOM } from '../engine/look';

lookGround(film, stage);                                  // the look's ground behind the camera (its grain, per frame)
const kf = await keyFrame(film, stage, 'b03', { x: 0 });  // the art director's builder draws B03's key frame into a
                                                          // 1920x1080 box (1080x1920 in the vertical variant) at x, y
const orbs = swapOrbs(film, kf);                          // its kit orbs become film orbs in the same look and place
blink(film, orbs.get('vox')!.orb, at);                    // ... and the timeline animates from the key frame
```

- `keyFrame` gives the builder the stage contract the look's own `frame()` gives it (a `.stage` box with its `.ground`,
  which stays hidden unless `ownGround`, because the film's ground lives behind the camera) and freezes its kit orbs.
- Two key frames can sit side by side in the world (`x: 1920`) for a camera move or a carry between them.
- `?scene=board&beat=b03` shows any key frame on the engine (`&variant=vertical`); `render.mjs --scene board --query
  beat=b16 --still 30` renders one; all twenty build on the engine.
- The look's stylesheets load only with the scenes that import `engine/look.ts` (they set `box-sizing` on everything,
  as the style frames have it). The engine's own default ground (`engine/ground.ts`, `--film-*` variables) is for
  scenes that do not use the look.

## The film skeleton: four acts on one timeline

`?scene=film` builds the whole 46.933 s film on one stage and one timeline by running four act builders in order on
one shared context (`src/acts/`): A1 `a1.ts` (B01 to B04, 0 to 9.600 s), A2 `a2.ts` (B05 to B08, to 20.000 s), A3
`a3.ts` (B09 to B13, to 32.000 s), A4 `a4.ts` (B14 to B19 with the owner's end card (b), to 46.933 s). The contract at
the three boundaries is **`SEAMS.md`** (its numbers in `src/acts/seams.ts`).

- An act is one builder per beat (`beats: { B05: ..., B06: ... }`) plus `seamIn` / `seamOut`. A beat builder writes
  at `ctx.win('B05')` times: in the master those are the script's absolute times (`beat('B05')`); in a cut-down the
  edit's own window for that beat, so the same builder serves both.
- The context (`src/acts/context.ts`): the camera (`ctx.cam`), the grid (`ctx.g`), the layers (`ctx.world`,
  `ctx.front`), the art director's key frames (`await ctx.keyFrame('b05')`, built once, hidden until shown), the
  carried elements (`ctx.carry`, taken with `ctx.take()`), and `ctx.showDuring(el, t0, t1)`.
- Today every beat is a **placeholder**: its key frame held for its window (`hold('B05')`). Replace one beat at a time.

**Preview an act:**

```sh
pnpm dev                                         # then http://127.0.0.1:5280/index.html?scene=a2
                                                 # (frame 0 is 9.600 s; the HUD shows clip and film time and bar.beat)
node tools/render.mjs --scene a2 --preview       # SC/renders/a2-landscape-960x540-preview.mp4
node tools/render.mjs --scene a2 --variant vertical --preview
node tools/render.mjs --scene film --preview --out SC/renders/animatic.mp4   # the whole film
node tools/render.mjs --scene a2 --from 2 --to 4                             # a range of the act (clip seconds)
node tools/qa/qa.mjs SC/renders/a2-landscape-1920x1080.mp4 --scene a2        # the checker, act alone
```

An act scene (`a1` to `a4`) runs only that act at the script's absolute times with its clip offset to the act's
start (`FilmConfig.offset`); its incoming seam state is built by the act itself (`seamIn` with `ctx.take`).
`?scene=cut15` and `?scene=bumper6` run the beat builders under the cut-downs' edits (`src/acts/edit.ts`, from
`SC/script/cutdowns.md`, end card (b), no address anywhere).

## Add a scene

1. Write `src/scenes/<name>.ts`:

   ```ts
   import type { Scene } from './types';
   import { lookGround, keyFrame } from '../engine/look';
   import { camera, grid, beat, rise, setType, split, arrive } from '../motion';

   const scene: Scene = {
     config: { name: 'b03', duration: beat('B03').dur, fps: 60, bpm: 112.5 },
     build(film, stage) {
       const g = grid(film);
       lookGround(film, stage);                   // the art director's ground (or ground(film, stage): the engine's)
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

**Grain** is added by the renderer to each finished frame, changing every frame: the look's own grain (mid-grey noise
in soft-light at 55%, generated from the look's seed exactly as `look/src/stage.ts` draws it) for scenes on the look,
the engine's white grain otherwise. A page without grain captures about twice as fast, and the grain is never averaged
by the motion blur. Previews show the page's own grain.

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

- Build each beat from the art director's key frame (`keyFrame(film, stage, 'b07')`), never a parallel drawing of it:
  its parts are real DOM (kit components, film lines, orbs once swapped) for the timeline to move.
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
- Engine limits: a 1080p60 render with blur runs at about 2.5 to 3 frames a second on this machine and 4K at about
  0.7, so work in previews and ranges. A key frame is static DOM: its kit orbs are frozen until swapped for film orbs
  (`swapOrbs`; reactions map to resting eye shapes, `engine/look.ts`), and a kit component's own transitions are off
  (drive its state from a renderer). One key-frame instance can be shown by one `showDuring` window. `cam.stateAt()`
  and `carryOrb(..., { camera })` read only the camera moves defined before them. A seam is never a `film.cut()`.

## Measured (22 November 2026, this machine: 4 cores, no GPU, Chromium 1243 headless shell)

**Determinism.** The test scene rendered twice at 1080p60 with motion blur, once on 4 workers and once on 3 (so every
worker started from a different frame): all 448 frames' pixel hashes identical. Seeking the same frames in reverse
order gives the same pixels, and so does seeking with or without the paint wait.

**Speed** (the test scene, 7.47 s, 448 frames; most frames move; the whip asks for 32 sub-frames):

| render | wall time | output | captures |
|---|---|---|---|
| preview, 960x540 30 fps, no blur | 11.6 s | 19 fps | 224 |
| 1920x1080 60 fps, 8 sub-frames at 180 deg, CRF 14 slow | 156 s | 2.9 fps | 1,634 (10.5 a second) |
| 1080x1920 60 fps, same | 169 s | 2.6 fps | 1,556 |
| 3840x2160 60 fps, same | 626 s | 0.72 fps | 1,586 (2.5 a second) |
| the animatic: the whole film, 960x540 30 fps, placeholders | 66 s | 21 fps | 1,408 |

One 1080p capture costs about 5 ms to seek, 86 ms to capture (Chrome's fast PNG) and 28 ms to decode; a frame where
nothing moves is one capture. Budget for the 46.9 s film with blur on 4 workers: roughly 15 to 25 minutes at
1080p60 and 60 to 75 at 4K60; render previews and ranges while working, the 4K master last.

**The checker on the first trailer** (`SC/trailer/boopis-trailer.mp4`), next to the postmortem:

| | checker | postmortem |
|---|---|---|
| length | 101.8 s | 101.8 s |
| still share | 0.647 | 0.65 |
| longest hold | 3.92 s (at 26.9 s) | 3.9 s |
| holds of 1 s or more | 22 | 22 |
| motion index | 1.056 | 1.06 |
| dips to pure black | 16 (2.47 s in all) | 15 (3.1 s in all, fades included) |
| dips through near black | 20 | "about 20" |
| full-frame cross-fades | 2: the ghosted eyes at 4.9 to 5.13 s (11% of the frame), a menu panel fading over the composer at 31.9 s (16%) | the eyes at 4.8 s |
| element fades (under 8%) | 17 (words fading grey to white, panels) | "fades everywhere" |
| first words | 7.33 s (heuristic, 6 fps) | 7.2 s |

The extra pure-black dip the checker finds is at 81.55 s, inside a dark stretch where a small element comes and goes.

**The checker on the test scene** (`SC/renders/test-landscape-1920x1080.mp4`, `test-vertical-1080x1920.mp4` and their
pages): every rule passes in both formats: no dip, no cross-fade, longest hold 0.83 s (9:16: 0.92 s), first words at
0.33 s, smallest text 37.8 px, no linear or unspecified ease, no large opacity tween. The still share warns (0.58;
9:16 0.55): typing, glances and slow camera moves change little of a dark frame on a 160x90 thumbnail; the film's
denser scenes should bring it toward the corpus's 0.19. The first version of the 9:16 layout held for 2.3 s after the
typing; the checker caught it and the camera now keeps leaning to the last frame.

**The animatic** (`SC/renders/animatic.mp4`, every beat its key frame held): fails stillness as expected (0.97 still,
3.1 s hold); no dip, no cross-fade, no text under 28 px.
