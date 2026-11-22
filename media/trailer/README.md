# The boopis trailer

A 102-second launch trailer, 1920x1080 at 60 fps (and a 1080x1920 cut), drawn by boopis's own components (the kit,
the card layer, the session's feedforward reader, `<orb-avatar>` and `<boopis-logo>`) and rendered frame by frame. The soundtrack is
synthesised from nothing by `score.py`. `research.md` is what each feature is and where it lives; `script.md` is the
beat sheet, word for word.

| File | What it is |
|---|---|
| `src/index.html`, `src/main.ts` | The page: the desktop UI's styles and fonts, the mock data provider (for the card layer), the vendored elements, the stage |
| `src/engine/` | `motion.ts` (the tokens' curves and the dock's critically damped spring, as functions of time), `stage.ts` (scenes, cues, kinetic type), `common.ts` (the bar grid, the bots, orbs, the pointer, sound cues), `app.ts` (the app window and the dock's slab) |
| `src/scenes/` | The eleven acts, one file each, in `index.ts` order |
| `src/cues.json` | The sound cues the scenes declare, written by `render.mjs --cues` and read by `score.py` |
| `render.mjs` | Builds the page with the desktop UI's Vite, serves it, drives Chromium on a virtual clock and pipes every frame into ffmpeg |
| `score.py` | The soundtrack (numpy and scipy): 100 BPM, D minor, every effect at its cue |
| `vite.config.mjs` | Aliases into `apps/desktop/ui` (`@boopis/ui`, `@ui`, `@vendor`, `@fontsource`) |

## Re-render

Once, the UI's dependencies: `(cd apps/desktop/ui && pnpm install --frozen-lockfile)`. Playwright and its Chromium
are the preinstalled ones (`NODE_PATH`); never `playwright install`. Then, from `media/trailer/` (`OUT` is any folder
outside the repository):

```sh
export TRAILER_OUT=$OUT/build                                     # where the page is built
node render.mjs --fps 10 --cues src/cues.json                     # 1. the sound cues, from the picture
python3 score.py src/cues.json $OUT/score.wav                     # 2. the soundtrack
node render.mjs --preview --audio $OUT/score.wav --out $OUT/preview.mp4   # 3. a 30 fps check (JPEG frames, a fast encode)
node render.mjs --no-build --audio $OUT/score.wav --out $OUT/boopis-trailer.mp4   # 4. the final, 1920x1080 at 60 fps
ffmpeg -i $OUT/boopis-trailer.mp4 -an -c:v copy $OUT/boopis-trailer-silent.mp4      # the silent version
node render.mjs --no-build --vertical --audio $OUT/score.wav --out $OUT/boopis-trailer-vertical.mp4   # the 1080x1920 cut
node render.mjs --no-build --stills 7.6,32.9,52.5,96.5 --outdir $OUT/stills          # style frames as PNGs
```

Options: `--from` and `--to` render a part (the page still runs every frame from 0, so the state is right),
`--fps`, `--scale`, `--crf` (default 14), `--format png|jpeg`.

**How it stays deterministic.** Before any page script runs, `render.mjs` replaces `performance.now`, `Date`,
`requestAnimationFrame`, the timers and `Math.random` (seeded) with a virtual clock, and pauses every Web Animation and
CSS transition and seeks it to the clock on each frame. Each frame is `frame(t)` (the scenes set their DOM from `t`),
then the clock advances to `t` (timers, then animation frames), then a screenshot. Frames go straight to ffmpeg's
stdin; nothing is written to disk. A full render takes about 9 minutes on four cores.

**The vertical cut.** `--vertical` opens the page at 1080x1920 with `?v=1`: each scene's 1920x1080 composition is drawn
at 0.65 in the middle band and its headlines move up into the top band, larger, shrunk to fit when a line is long
(`verticalPass` in `src/engine/stage.ts`); the end line goes to the bottom band.

**Brand.** boopis is the only product brand in it. The labs' marks appear only where a lab takes part (the sign-in
buttons, the ladder, the council, the bylines), from `apps/desktop/ui/src/vendor/model-icons/` and `signin-marks/` as
the app draws them, with their NOTICE files. Nothing that boopis is built from is named.
