# Orbs: clarity, motion, the main bot

This is not a redesign. The characters keep their shapes, colours and faces. The work answers three of the owner's
questions:

1. Why do our orbs look less clear than Grok-Bot's, and what is the exact fix?
2. Which animations do we already have, and where should we use them more?
3. How much bigger should boopis be at the top of the open sidebar?

Sources:

- orb2 is the owner's library. The source checked here is `aphesist/orb2` `orb-avatar.js` at 03d9094. Its
  `orb-avatar.min.js` is byte-identical to boopis's `apps/desktop/ui/vendor/orb-avatar.min.js`.
- boopis code was read at w29-integrate.
- Grok-Bot evidence is the package's `motion/` recordings and `screens/` captures. The screens are 2880 px wide, so
  they are DPR 2.

Every finding below was measured in Chromium (Playwright) on the real orb2 code.

## Decisions (owner, 23 November)

| Question | Decision |
|---|---|
| K01, the renderer | **The new renderer, with every clarity fix:** C1–C3, C6 and C7, plus C9 and C10, the turn limits found while fixing the clip defect below. |
| The eyes | **`face-scale` 1.25** (C4). |
| Sizes | **Grok-Bot's: sidebar rows 28 px, the rail 36 px** (C5). |
| Animation | **All of T1–T5, plus the "use more" plan** (part 2). |
| K02 | **A: a 44 px main bot.** It appears only in the Bots tab, as the first entry of the bots list, below the Sessions and Bots switch. The Sessions tab shows no bot; there, the dock is the quick way to the bots. |

**A defect, fixed.** The first proposed clip showed the room header's square boopis with a notched edge, and the
owner said that cannot happen. The cause is orb2's 3D turn, not the snapping. Every frame of the "today" side has it
too. `probes/turn.html` shows it:

- **Body.** Past about 0.2 rad of head turn, a flat body's projected outline kinks at its corner. Lively rim peeks
  turn the head up to 0.68 rad, and the sky gaze up to 0.51.
- **Eyes.** Past about 0.75 rad of eye turn, the body's clip cuts the eye cells in half.

C9 holds a non-circular head to 0.18 rad, and C10 holds the eyes to 0.7 rad. The proposed plan also makes the room
header calm instead of lively, because lively's spins and rim peeks are the turns that cannot draw cleanly. Both
clips were re-recorded and checked frame by frame; see the critic pass below.

| File | What it is |
|---|---|
| `K01-clarity.jpg` | Part 1, the clarity crops |
| `anim-idle-before-after.mp4`, `anim-alive-before-after.mp4` | Part 2, the motion clips |
| `K02-main-bot.jpg` | Part 3, the main-bot choice board |
| `probes/` | The probe pages that produced all of the above |

## 1. Clarity: why ours read less clearly

orb2 draws every orb on its own 2D canvas. There are two paths:

- **Main thread.** This is the vendored element patched by `orb-runtime.ts`.
- **Worker.** `orb-worker/`, ADR-0025, an OffscreenCanvas per orb. The page's proxy element owns the canvas box, and
  the worker draws with the same orb2 code.

Both paths share the faults below.

What I checked and ruled out in orb2: there is no `shadowBlur`, no `filter`, no gradients, and no
`imageSmoothing` change. The fills are flat. Colours are not the problem either. At rest, the pixel centres read back
the exact hex at DPR 2 in both builds:

| Look | Hex | Read back (RGB) |
|---|---|---|
| boopis | `#f5f5f5` | 245, 245, 245 |
| pink | `#f472b6` | 244, 114, 182 |
| ink | `#1c1c24` | 28, 28, 36 |

So vividness is not the difference. The geometry, the resampling and the size are.

| # | Cause | Proof (K01) | Where |
|---|---|---|---|
| C1 | **The canvas is resampled at every size.** orb2 makes the canvas 153.85 % of the box (`CANVAS_SCALE = 3.2/2.08`) and centres it with `translate(-50%,-50%)`. A 20 px orb gets a 30.77 px canvas at x = −5.38 px. Its 31 px bitmap is then scaled to 30.77 device px at a 0.62 px offset. Measured fractional offsets across the 10 app sizes: 0.08–0.94 px at DPR 1, 1.6 and 2, and never 0. | Columns 1 and 2. Edge width at DPR 1: 1.33 → 0.59 px (sidebar row 20), 1.40 → 0.80 px (rail 24), 1.10 → 0.65 px (44). DPR 2 gains less, because the resampling is finer: 1.23 → 0.56 px (row). | orb2 `orb-avatar.js:2276` (shadow CSS) and `:2616-2620` (`_fit`); boopis `components/orb-worker/host.ts:30-31` (`SHADOW_CSS`, the worker proxy's copy) |
| C2 | **The quality ladder lowers the backing store.** `LEVELS` caps dpr at 2, 1.5 and 1. After 45 slow frames (`govern`), every orb on a 2x screen is drawn at 1x and stretched 2:1. A CPU-painted WebKitGTK (no DMABUF; the worker's 2D context is forced to `willReadFrequently`, `shim.ts:34`) is where frames run slow, so that is where it steps. | Column 3. Edge width 2.27 px (row) and 2.30 px (44) at DPR 2, against 1.23 and 1.31 px. | orb2 `:2152` (`LEVELS`), `:2617` |
| C3 | **The dock draws its orbs at 2x and scales them down.** It uses `render: 80` for a 40 px orb and `render: size*2` for the minis. `.ui-orb[data-render]` then applies `transform: scale(.5)`, so the result is a 2:1 downsample at a half-pixel offset that snapping cannot reach. | Dock rows: the snapped build still lands at a 0.5 px offset. | boopis `modules/dock/views.ts:27, 29, 171`; `components/components.css:642` |
| C4 | **The eyes are small.** Eye area is 2.8–3.3 % of the body box, against Grok-Bot's 5.6 % (`avatar-eyes-track-pointer-large.mp4` at 1.6 s). Eye height is 21 % of the body against 27.5 %. At 20 px an eye is about 1.6 × 4 CSS px. orb2's existing `face-scale` attribute at 1.25 measures 4.9–5.1 % and 25 %, so no new code is needed. | The C4 strip at the foot of K01. | boopis `components/orb.ts:38-40` |
| C5 | **The orbs are smaller than Grok-Bot's.** Our sidebar row is 20 px against Grok-Bot's 28; the rail is 24 against 36. Size is the largest single difference. The v7 kit already uses 36 px rows and tiles. | Measured on `157-live-sidebar-expanded.png` and `010-chat-sidebar-compact.png`. | `modules/bots/list.ts:69, 132` |
| C6 | **Constant sub-pixel float.** orb2's float and breath (`.020/.026` body radii, 1.1 % scale, every frame) move a 20 px orb's edges by about 0.25 px all the time, so the anti-aliasing shimmers. Grok-Bot holds a pose completely still: `avatar-states-zoom-sidebar.mp4` is unchanged from 21 s to 40 s. | `anim-idle-before-after.mp4` | orb2 `:2924-2931` |
| C7 | **A DPR change never refits.** `_fit` runs only from the ResizeObserver and from `setLevel`, and a DPR change does not change the CSS width. A window moved to a 2x screen, or a zoom, keeps a 1x canvas. In the worker, the `env` message only sets `devicePixelRatio` (`worker.ts:210`). | Code path. | orb2 `:2154`, `:2196`; boopis `orb-worker/worker.ts:210`, `host.ts:141-142` |
| C9 | **A turned flat body notches.** The head turns by 0.54 of the eye turn (`hR`, `:2846`). Past about 0.2 rad, the outline of a squircle, hexagon or other extruded body kinks at a corner. Lively rim peeks (eye yaw 0.82–1.26 rad, `:2675`) and the sky gaze (pitch 0.62–0.94, `:2698`) reach 0.68 and 0.51 rad of head turn. | `probes/turn.html`: five shapes at a 0–72° gaze, stock against the variant. The kink is gone with the cap. | orb2 `:2850`, `:2859-2860`: hold the head target to ±0.18 rad unless the body is a circle (a sphere has no edge to kink). Spins add their own yaw after this and are unaffected. |
| C10 | **Eyes are cut at the rim.** Past about 0.75 rad, the eye cells reach the rim and the body clip (`:2976`) halves them. `lookAt` allows 1.18 rad (`:2819`) and rim peeks 1.26. Grok-Bot's eyes reach 0.18 of the body width at most and are never cut (LARGE 7.0–7.8 s). | `probes/turn.html`, 55–72°. | orb2 `:2849`, `:2856-2857`: hold the eye target to ±0.7 rad. |

### The fix list

`probes/gen-variants.cjs` applies C1–C3 to orb2 as literal one-line replacements. It writes
`probes/lib/orb-avatar.snap.js`, which is what the K01 "snapped" column uses.

**In orb2 (`orb-avatar.js`)**

- **`:2276`** Change the canvas CSS to `position:absolute;left:0;top:0;pointer-events:none`. The fractional %
  size and the `translate(-50%,-50%)` go.
- **`:2616-2620`** In `_fit`, compute `px = round(cssW * CANVAS_SCALE * devicePixelRatio)` with no ladder cap, then
  call a new `_snap()`. `_snap` sets the canvas CSS size to `px / dpr`. It places the canvas at
  `(round(hostLeft*dpr + b/2 - px/2) - hostLeft*dpr) / dpr`, where `b = cssW*dpr`, and the same for top, so every
  bitmap pixel lands on a device pixel. It returns early when the canvas has no `style`, as an OffscreenCanvas in the
  worker has none.
- **`:2152`** `LEVELS` keeps its stride and half-rate, but not its `dpr` (C2). Small canvases are cheap. The frame
  skip is what saves time.
- **`:2147`** Re-snap on the layout bump that already counts scroll and resize (`for (const o of live) o._snap()`).
  Add a `matchMedia('(resolution: …dppx)')` listener that refits every orb (C7).
- **`:2849-2860`, plus a new `_headCap(v)`** C9 and C10: the head target goes through `_headCap`, which clamps to
  ±0.18 rad when `!this._bodyTo.isCircle`, and the eye targets go through `clamp(…, -.7, .7)`. Both apply in the
  static branch and in the springs.

**In boopis**

- **`components/orb-worker/host.ts:30-31`** Make the same CSS change in `SHADOW_CSS`. `orb-worker.test.ts` reads
  the template from the vendored file, so it follows the orb2 change. The proxy places the canvas in its
  ResizeObserver callback (`:56`) with the same formula. The worker's `_fit` computes the same `px`, so both sides
  agree.
- **`components/orb-worker/worker.ts:210`** After `setDpr`, refit:
  `for (const o of orbs.values()) { o._fit(); o._sig = null; }`.
- **`components/orb-worker/host.ts:141`** Post `env` on a `matchMedia` resolution change too, not only on `resize`.
- **`modules/dock/views.ts:27, 29, 171`** Remove `render:` so the dock orbs draw at their own size. The
  `.ui-orb[data-render]` rule in `components/components.css:642` then has no users. The hover magnification
  (`scale(1.22)`/`1.33`, `dock.css:116, 187, 189`) is a transition and is acceptable while it moves.
- **`components/orb.ts:38-40`** (C4, decided) Write `face-scale="1.25"` for orbs of 44 px and under. This only
  scales the eyes the owner already has.
- **`modules/bots/list.ts:69, 132`** (C5, decided) Rows at 28 px and the rail at 36 px.
- **`modules/bots/room.ts:110`** The room presence orb goes from `motion: 'lively'` to calm (C9 and C10: lively's
  spins and rim peeks).

### WebKitGTK notes

- The worker forces `willReadFrequently` (`shim.ts:34`; the GPU 2D context in a worker crashes WebKitGTK 2.52.6).
  Raster is therefore on the CPU, and that is what makes the ladder (C2) step. With C2 fixed, a step costs frame
  rate, not sharpness.
- `orb-runtime.ts:142-167` explains the alternate-frame policy for CPU paint, and nothing in this fix list changes
  it.
- WebKit composites a fractionally scaled canvas with the same bilinear filter, so C1 applies there unchanged.

## 2. Animation review: Grok-Bot's states against ours

How the Grok-Bot side was measured: frame by frame at 30 fps with `probes/tools/track.py` (body box, eye centroid and eye
height per frame) on `avatar-eyes-track-pointer-large.mp4` (LARGE) and `avatar-states-zoom-sidebar.mp4` (ZOOM), plus
contact sheets of `avatar-shapes-idle-and-pointer.mp4`. The orb2 side is cited from the code.

| State | Grok-Bot (recording, time) | Ours today (code) | Gap | Improvement (parameters within orb2's model) |
|---|---|---|---|---|
| Blink | Eye height 39 → 27 → 7 → 30 → 39 px over 0.20–0.27 s, closing in about 0.1 s (LARGE 1.07–1.40 s, 3.13–3.43 s, 5.13–5.33 s, 7.27–7.47 s). Every 2.0–2.1 s in that clip. | 0.155 s, `sin^0.82` (`:2919`). Every 2.1–5.7 s, 24 % double (`:2766-2775`). | Ours is a flick, about 4–5 frames, and it can be missed at 20 px. | **T1** blink 0.20 s (`:2919`). |
| Idle, held pose | Holds a pose dead still: no drift, no float. The sidebar held one pose for 19 s (ZOOM 21–40 s). The large avatar rests face-on (eye dx ≈ 0, LARGE 0.9–2.6 s). | `idle-motion="calm"` everywhere (`orb.ts:39`). A new pose every 1.8–4.2 s with yaw ±0.38 rad around an 8° right rest gaze (`:2661-2664`, `:2646`). A constant micro-drift (`:2752-2754`), plus float and breath at every size (`:2924-2931`). | Ours never holds still and rests turned, so small orbs swim (C6). | **T2** calm glances and returns: a glance of ±0.20–0.42 rad for 0.7–1.5 s, then the rest pose for 1.6–3.8 s. **T3** calm micro-drift at ¼. **T4** no float or breath under 44 px. **T5** rest gaze `[0, .05]` (decided; Grok-Bot's sidebar rests turned, its large avatar faces front). |
| Glance | Eye offset moves 0.04 → 0 → −0.06 → +0.04 of the body width, each move in 0.33–0.5 s, ease-out (LARGE 0.53–0.87 s, 2.70–3.13 s, 3.67–4.00 s). | Eye spring k = 165, damping 19 (ζ ≈ 0.74, settles in about 0.3 s); head spring 68 / 11.5 (`:2848-2853`). | Timing matches. Ours wanders, theirs returns. | T2 covers it. The springs are unchanged. |
| Eyes track the pointer | Eyes reach dx −0.18 and dy −0.16 of the body (to the rim), easing in about 0.4 s and back in about 0.15 s, with a small lean (LARGE 6.70–7.13 s, return at 7.87–8.00 s). | `lookAt` clamps to ±1.18 rad (`:2823-2826`). boopis aims only on hover (`bots/orbs.ts:42-54`), the room presence and the new-bot preview (`gentleFollow`, ≤ 0.3·250 px, `bots/orbs.ts:108-120`), and the dock row (`dock/orbs.ts:30-40`). | Same mechanics. Ours is used on few surfaces. | Use it more (the plan below). No parameter change. |
| Scale pulse | Body 152 → 142 → 152 px (6.6 %) over about 0.9 s, ease-in-out, held about 1.2 s (LARGE 0–4.9 s). The cause is not visible in the clip. | Breath 1.1 % (`:2929`). Listening `s` is 1.4 % (`:1308`). | Theirs is a slow, held change; ours is a constant ripple. | No new pulse. T4 stops the ripple at small sizes. Out of scope: a held "lean in" scale. |
| Thinking, searching | Body shrinks to about 83 % and the eyes turn to sideways dots ("Looking that up now", ZOOM 5.0–6.0 s). | `thinking`: dots extra, eyes alternate pill and wide, looking up and sideways (`:1313-1327`). | Ours does not shrink. Its face change is richer. | None. orb2's state is already expressive. |
| Done, happy | `^ ^` arc eyes for about 2 s (ZOOM, around 6–8 s on the sheet). | `happy` and `done` use `F_ARC` with a hop and sparkle (`:1372-1381`). | Equivalent. | None. |
| Needs you | Waiting state with a warn dot. | `needs`: tall eyes, a hop every 2 s, a ring (`:1382-1386`). | Equivalent. | None. |
| Asleep | Rest eyes on the sleeping computer card. | `sleeping`: rest eyes, zzz, slow breath (`:1387-1391`). `alive` + `sleep-after` dozes by itself (`:2584-2597`), but boopis never sets `alive`. | Equivalent. | None. |
| Hover | No hover reaction in the recordings beyond tracking. | `listening` plus `lookAt` (`bots/orbs.ts:42-48`, `dock/orbs.ts:42`). | Ours does more. | Keep. |
| Picker | Live, wobbling shapes; a ring on hover (`new-bot-character-picker.mp4`). | Picker tiles are still at 28 px (`look-picker.ts:69`, `still: true`). The new-bot preview is live. | Ours is still. | Optional: live tiles. Calm idle at 28 px is cheap once T4 removes the float. |
| Entrance | Not captured. | `wake` emote (1.5 s); the jelly kick on a state change (`:2629-2632`). | n/a | n/a |

### Every animation orb2 already has

- Blink and double blink.
- The idle director, in calm and lively modes: rim peeks, head tilts, sky gaze, micro-saccades, eye micro-morphs and
  the whip-spin.
- Float and breath, and the jelly springs.
- `lookAt`, and the `follow`, `wander`, `drift` and `fixed` modes.
- Poke, which escalates to surprised, giggle or dizzy.
- `spin`, in turntable, tilt and reverse.
- 15 emotes, of which `doze` and `wake` are autonomous.
- 16 reactions.
- `sequence` and `morphEyes`.
- `alive`, with `idle-time`, `sleep-after` and `emotes`: autonomous emotes, dozing off and waking on pointer
  proximity.
- `face-scale`, `gaze`, `morph` and `jelly`.

Implemented but unused by boopis:

- `alive`, with its emotes, doze and wake.
- `follow` and `wander`.
- `idle-motion="lively"` everywhere except the room header (`room.ts:110`).
- `spin`.
- `sequence`.
- Emotes, except on double-click (`bots/orbs.ts:41`).
- `face-scale`.

### Where each surface uses them today, and the plan to use them more

Everything in the plan uses orb2's own calls and boopis's existing helpers (`gentleFollow` with `hold`, `glance` and
`capLook`; `liven`; `glance.lead`). The before and after are in `anim-alive-before-after.mp4`.

| Surface | Today | Use more |
|---|---|---|
| Sidebar rows (20) | Calm idle; looks on hover only. | When a bot posts, its row orb `blink()`s. Calm idle with T2–T4. |
| Main bot, open sidebar | One more row. | 44 px (part 3). It becomes `alive` with `emotes="curious winkswap slowblink"`, `idle-time` about 9–20 s and `sleep-after="0"`. It takes the glance lead under reduced motion, and `gentleFollow` to the composer while you type and to a new message. |
| Rail (24) | Calm idle. | Same as the rows. |
| Room presence (40, lively) | Holds a look at the composer while you type (`room.ts:408`). Glances at a new message for 1.2 s (`room.ts:223`). | The looks are unchanged. The idle becomes calm (with T2), because lively's spins and rim peeks notch the body (C9, C10). |
| Room gutter (20) | Nothing. | The other members' orbs turn toward the speaker's new bubble for 1.2 s (`capLook`, k .45). While you type they look at the composer. The speaker `blink()`s as its bubble lands. |
| Dock (40) | Looks at the pointer only when the pointer is in the row; blink on hover (`dock/input.ts:317-324`). | While you type in a room, its members' dock orbs hold a look at the composer (k .3). The bot that posts `blink()`s. |
| 1:1 chat | The composer mic orb at 18 px, live (`composer.ts:343`). | The bot's title-pill orb glances at its own new bubble. |
| Details pane (28) | Calm idle in an orb button (`settings.ts:161`). | `gentleFollow` k .45, as the preview has. |
| New-bot dialog (128) | `gentleFollow` and `faceOn` (`new-bot.ts:46-60`). | Unchanged. Live picker tiles (optional). |
| Notch | Not in this tree's orb code. | n/a |

### Calm, performance, reduced motion

- **At most one lead orb is `alive`.** A look is a quick action that `orb-runtime.ts` already runs at full rate for
  0.5 s and then returns to the alternate-frame policy.
- **Off-screen orbs stay paused** (orb2's IntersectionObserver; the worker's `vis`). The dock's `lifeOf` still stills
  the hidden pages.
- **T4 makes the calm budget cheaper.** An orb under 44 px with no float and a held pose passes orb2's signature
  check (`:2940-2941`), so it skips repaints between glances. On CPU-painted WebKitGTK, that is fewer dirty
  rectangles.
- **Under reduced motion nothing new moves.** `glance` and `lead` already give small eye steps. `alive` emotes there
  should use the existing `EMOTES_CALM` list, and orb2 already drops floating and head travel.

### Would need something new (out of scope, too big)

- A held "lean in" scale toward the pointer, as Grok-Bot's 6.6 % pulse: a new motion channel.
- Silhouette morphs into symbols for working states (Grok-Bot's pencil, radar, orbit): a new body system.
- Even-odd cut-out eyes as true holes: v7 already fakes them with `eye-color` set to the surface colour.
- Eyes that follow the text caret while you type: a new input-tracking source.

## 3. The main bot in the open sidebar

Grok-Bot's main bot is centred above the list with its name under it. Its body is 44 px, against 28 px rows and a
36 px rail. These were measured as 88 device px on `157-live-sidebar-expanded.png`, which is DPR 2.

**Decided: A, 44 px, the Bots tab only.** boopis is the first entry of the Bots tab's list, below the Sessions and
Bots switch, centred with its name under it, as Grok-Bot shows its main bot. The list's rows take Grok-Bot's 28 px.
The Sessions tab has nothing to do with bots, so it shows no bot; the dock under the session is the quick access to
them. The rail keeps its size. `K02-main-bot.jpg` shows A only.

Screens 11 (bot chat) and 12 (room) are the Bots tab, with no dock. Screen 13 is the Sessions sidebar, with no
boopis entry and with its dock. All were rendered in dark and light from the v7 source after the dock pass
(528a5dca). They are `K02-11-bot-chat-main44-{dark,light}.jpg`, `K02-12-room-main44-{dark,light}.jpg` and
`K02-13-session-{dark,light}.jpg` in the deliverables folder.

The render-source change is `k02-render.patch`, against `ds-v7/src`:

- In `sidebarOpen`, `main` replaces the boopis row with the `.sb-main` entry below the switch, and the row orbs are
  28 px.
- `.sb-main` is added to `kit.css`.
- `botChat` and `room` read `?main=`.

`qa.cjs --jobs jobs-k02.json` with all rules, sweep included, returned 7 pages and 0 findings.

## Critic pass

**Clips.** Both clips were re-recorded after the C9 and C10 fix: 315 frames for the alive clip and 240 for the idle
clip. They were captured at DPR 2 on Playwright's clock (one 1/30 s step per screenshot, seeded `Math.random`, the same
timeline in both halves) and encoded to 1280 × 800. Each frame was checked three ways:

- **`probes/tools/flicker.py`** looks for A-B-A flicker, and for an orb's pixel mass dipping for one frame (a canvas
  painted empty). Result: 0 suspect frames in either clip.
- **`probes/tools/shape.py`** is new. For every orb in every frame it measures the body's largest blob, its
  solidity (area over convex-hull area) against that orb's own median, and whether the blob touches the canvas's
  bounds (a straight cut). Result: 0 notches and 0 cuts.

  It also reads the pose each orb drew, using orb2's own `_hyaw`, `_hpitch`, `_eyaw` and `_epitch` fields, which
  `rec.cjs` writes to `poses.json`. It flags the turns that `probes/turn.html` shows to notch a flat body (head past
  0.2 rad) or to cut the eyes (past 0.75 rad), and spins.

  | Half | Alive clip | Idle clip |
  |---|---|---|
  | Today | 646 orb-frames | 429 orb-frames |
  | Proposed | 0 | 0 |

  The pose check is the stronger of the two tests. A slab's kink at 20–40 px moves solidity by less than its noise,
  which is why it was missed the first time.

By eye, contact sheets of every third frame were reviewed for the proposed half's orbs: the main bot, the room header,
the dock and the gutters. No notched, cut or deformed outline appears.

**Images.** K01 and the new K02 were viewed at full resolution: no double images and no clipped text.

## Probes

Serve `probes/` over HTTP (`python3 -m http.server`). The clip page uses same-origin iframes.

| Page | What it does |
|---|---|
| `clarity.html?lib=stock\|snap\|tuned&ladder=2&fs=1.25` | The K01 orbs at the app's sizes, still |
| `stage.html?scene=idle\|alive&lib=…&plan=today\|more` | One half of a clip; it drives the real orb2 build |
| `clip.html?scene=idle\|alive` | The 1280 × 800 before and after |
| `turn.html?lib=stock\|snap` | Five shapes turned 0–72° at 40 px, still: the C9 and C10 proof |
| `gen-variants.cjs` | Builds `lib/orb-avatar.snap.js` (C1–C3, C7–C10) and `lib/orb-avatar.tuned.js` (the same, plus T1–T5) from orb2's `orb-avatar.js`; it stops if a replaced line is not found. C8, the full outline stride, made no visible difference in `turn.html` and is optional. |
| `tools/rec.cjs`, `tools/shape.py`, `tools/flicker.py` | The deterministic recorder and the frame-by-frame checks |
