# WebKitGTK perf harness

Frame times of the built UI in the engine Tauri really uses on Linux (WebKitGTK), next to Chromium for comparison.
Not in CI. Run from `apps/desktop/ui`:

```sh
pnpm perf:webkit                                   # every scenario, WebKitGTK as the owner runs it, WebKitGTK default, Chromium
pnpm perf:webkit -- --engines webkit-cpu --scenarios idle,dock-morph --repeat 3
pnpm perf:webkit -- --variants baseline,orbs-static,no-stage-clip   # one candidate cause off at a time
pnpm perf:webkit -- --engines chromium --scenarios resize --profile resize   # a CPU profile (top self time)
```

Results are printed and written to `test-results/perf/<label>.json`.

## Motion at the display's rate (ADR-0025)

STANDARDS section 6 makes the budget the display's rate: every frame under 8.3 ms on a 120 Hz panel, none over 16.7 ms.
Xvfb cannot run at 120 Hz (its WebKitGTK is on a 60 Hz timer), so the tables carry two kinds of number: frame intervals
(p50, p95, p99, max, the counts over 8.3 and over 16.7 ms; at 60 Hz every frame is over 8.3, so read that column against the
work below) and the work a frame costs.
- `busy/frm`: main-thread milliseconds per frame. Chromium reports its task time (CDP `TaskDuration`, with layout and style
  beside it). WebKitGTK reports none, so `--probe` runs a message-channel ping-pong whose gaps are the time a task held the
  main thread (script, style, layout and what a non-composited renderer paints). The probe perturbs the frame times:
  run it apart from the fps numbers (`--probe`), never in the same cell.
- `dock-morph-load`, `dock-pages-load`, `tab-switch-load`: the same scenarios with a synthetic 30 ms task every 200 ms
  (`__perf.loadMs`, `__perf.loadEvery`). rAF is on the main thread, so these intervals show the stall whatever drives the
  motion; what separates a compositor-driven animation is whether frames are still drawn. In Chromium the run traces viz's
  `DrawAndSwap` and reports `comp>25` (gaps over 25 ms inside an animation) and `compMax` (the longest gap). WebKitGTK offers
  no such trace; there the load scenario is read through the rAF columns only.
- `--query orbs=main` keeps the orbs on the main thread in a build that can draw them in a worker (`orbs=worker` insists).
  The `-- baseline (orbs worker|main ...)` line says which ran. `--dist DIR` serves an earlier build for the before column.
- A `linear()` easing runs on the compositor in WebKitGTK 2.54 and later and in Chromium, not in 2.44 to 2.52 (the harness
  box has 2.52.6): the dock samples springs into keyframes so it composites on both.

## What it needs

- `/usr/bin/python3.12` with the system PyGObject and `gir1.2-webkit2-4.1` (`gi` is built for the distribution's Python,
  not for whichever Python is first on `PATH`), `xvfb-run`, and Playwright's Chromium (already installed here).
- The e2e build (`vite build --mode e2e`), which the harness makes when `dist-e2e` is older than the sources. It serves the
  mock provider, so the app is the real one with its data replayed.

## How it measures

- Each cell is one fresh page (an ephemeral WebKit context, a new Chromium context), the app booted, then the scenarios in
  order. Before each, the page is put back to rest (session tab, dock open on Bots, pointer parked).
- Frame time is the `requestAnimationFrame` delta. The columns: p50, p95, max (ms), frames over 16.7 ms and over 33.4 ms
  (with 1 ms of timer jitter allowed), the frame rate, and `js/frame`: how much of a frame is script in rAF and
  ResizeObserver callbacks. A slow frame with little script is style, layout, paint or composite.
- `clears` is how many times a canvas had its width or height assigned (which empties it). `blank` is the number of frames in
  which an orb that should be drawn still owed a redraw after the orb loop had run: the flicker, counted.
  `qualityLog` in the JSON lists the steps of orb2's quality ladder.
- Chromium also reports layout and style-recalculation time per frame and how many of each a frame costs (CDP).

## The engines

| name | what it is |
|---|---|
| `webkit-cpu` | WebKitGTK with `WEBKIT_DISABLE_DMABUF_RENDERER=1`. This is how the owner runs it. In WebKitGTK 2.44 to 2.52 that switch makes the acceleration policy `never` (`webkit://gpu` says so): no GL, the CPU paints every frame. |
| `webkit` | WebKitGTK's default: GL compositing. Under Xvfb the GL is llvmpipe (software), with shared-memory buffers. |
| `webkit-shm` | `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`: GL kept, frames copied through shared memory. |
| `webkit-nocomp` | `WEBKIT_DISABLE_COMPOSITING_MODE=1`. |
| `chromium` | Playwright's Chromium, headless, SwiftShader. |

`--scale 2` (the default) gives the page a `devicePixelRatio` of 2 (`GDK_SCALE=2` for WebKitGTK), and the default window
is 1800x1125 CSS pixels: the owner's 2880x1800 panel at Hyprland scale 1.6, which GTK3 renders at 2x (3600x2250 buffer
pixels) and the compositor scales down.

## Reading the numbers

Xvfb has no GPU. Absolute numbers are for comparing builds with each other, not for predicting a machine. `webkit-cpu`
is the closest to the owner's path, because there the CPU paints too, but a laptop CPU, memory bandwidth and the
compositor's downscale are not Xvfb's. On a real GPU in the default path the GPU would raster and composite, so the
paint share of a slow frame would shrink and the script share would not.

`webkit-gpu.py` prints WebKitGTK's own `webkit://gpu` page as text (version, acceleration policy, buffer path, GL
renderer): `GDK_SCALE=2 xvfb-run -a -s "-screen 0 3600x2250x24" /usr/bin/python3.12 tests/perf/webkit-gpu.py`.
Try `WEBKIT_SHOW_FPS=1` on any run to have WebKit print its own compositor frame rate to stderr (it exists only when
the accelerated compositor runs, so it prints nothing under `webkit-cpu`).

## On a machine with a GPU (the owner's laptop)

Xvfb has no GPU, so the paths that matter on an NVIDIA laptop cannot be measured here. Run the same scenarios on the real
session, one WebKitGTK mode at a time, and send the printed table (or `test-results/perf/<label>.json`) back:

```sh
cd apps/desktop/ui && pnpm install && pnpm exec vite build --mode e2e          # Arch: python-gobject and webkit2gtk-4.1 provide gi
pnpm perf:webkit -- --display real --python /usr/bin/python --engines webkit-cpu,webkit,webkit-shm,webkit-nocomp \
  --scenarios idle,dock-magnify,dock-morph,resize --label laptop-modes
# the same on the NVIDIA GPU of a hybrid laptop (PRIME render offload), default WebKitGTK path:
pnpm perf:webkit -- --display real --python /usr/bin/python --engines webkit --scenarios idle,dock-magnify,dock-morph,resize \
  --env __NV_PRIME_RENDER_OFFLOAD=1,__GLX_VENDOR_LIBRARY_NAME=nvidia,__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json --label laptop-nvidia
```

`webkit-cpu` is `WEBKIT_DISABLE_DMABUF_RENDERER=1` (no GL: the CPU paints), `webkit` leaves WebKitGTK to choose,
`webkit-shm` is `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` (GL kept, frames copied through shared memory), `webkit-nocomp` is
`WEBKIT_DISABLE_COMPOSITING_MODE=1`. A window opens for each run and must stay visible while it runs. In the app itself,
Settings > General > Diagnostics > Measure frames records 5 s of frame times while you move along the dock, and Copy
report puts them in the report.

## A frame grab of the flicker

`webkit-runner.py --grab WxH+X+Y` records that screen region (device pixels) with ffmpeg `x11grab` while the scenarios run,
to `<out>.mkv`. A frame in which every orb of the dock row is gone shows as a drop in the count of non-dark pixels:

```sh
GDK_SCALE=2 WEBKIT_DISABLE_DMABUF_RENDERER=1 xvfb-run -a -s "-screen 0 3600x2250x24" /usr/bin/python3.12 tests/perf/webkit-runner.py \
  --url http://127.0.0.1:PORT/index.html --scenarios idle --scenarios-js tests/perf/scenarios.js --width 1800 --height 1125 \
  --grab 1400x190+1100+2060 --out /tmp/idle.json
```

`--dist DIR` on `run.mjs` serves a `dist-e2e` of an earlier commit with the same harness: build it in a worktree of that
commit (`vite build --mode e2e`) and compare.

## Variants (`variants.mjs`)

Each switches one candidate cause off after the app has booted, to price it: `orbs-hidden`, `orbs-static`, `orbs-dock-only`, `orbs-not-dock`,
`orbs-q0`, `orbs-q2`, `orbs-sync-q2`, `no-squircle-clip`, `no-stage-clip`, `no-dock-slab`, `no-box-shadow`, `no-mask`,
`no-transitions`, `no-dock`.

## Scenarios (`scenarios.js`)

`idle` (10 s, every orb live), `dock-morph`, `dock-magnify`, `dock-pages`, `dock-keys`, `dock-session`, `create-bot`,
`tab-switch`, `resize`, `idle-bots`. They drive the app through the e2e build's `window.__hx`.

## What it found (WebKitGTK 2.52.6, `webkit-cpu`, 1800x1125 at 2x)

- Frame cost with the CPU painting is about the area repainted, not the number of orbs: the dock's 11 orbs alone, or the
  sidebar's 14 alone, hold 60 fps; together they ran at 20, because past ten changed rectangles WebKit repaints their
  bounding box (`orbs-dock-only`, `orbs-not-dock`).
- orb2's quality ladder steps every few seconds and empties every canvas when it does; the next frame is painted before
  orb2 redraws, so the dock row is blank for two frames (the grab above).
- `getComputedStyle(...).getPropertyValue(...)` in the dock's frame (the slab path read the smoothing token every frame) and
  in its layout handlers was a quarter of a morph's script time (Chromium CPU profile, `--profile dock-morph`).
- A `mask-image` over the scrolling conversation, whose edge moves with the dock's lift, doubled the frame time of every
  dock morph (`no-mask`).
