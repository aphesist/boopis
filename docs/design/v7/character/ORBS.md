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
| K01, the renderer | **The new renderer, with every clarity fix:** C1–C3, C6 and C7. Far turns are fixed in the geometry, G1–G3, not clamped. |
| The eyes | **`face-scale` 1.25** (C4). |
| Sizes | **Grok-Bot's: sidebar rows 28 px, the rail 36 px** (C5). |
| Motion | **One policy per surface.** The Bots sidebar, the rail and the dock hold one fixed sideways pose (§23) and animate in a state. A hovered bot comes alive and settles back. The chat is fully lively, more than today. All of this is under "Per-surface policy" below; T1 still applies everywhere. |
| K02 | **A: a 44 px main bot.** It appears only in the Bots tab, as the first entry of the bots list, below the Sessions and Bots switch. The Sessions tab shows no bot; there, the dock is the quick way to the bots. |

**How the notch was fixed.** The owner found a notched outline on the room header's square boopis.

The first fix clamped the turns (0.18 rad for the head, 0.7 for the eyes). It removed the notch and the life with it;
the owner saw that "today" was more alive, so the clamps are withdrawn.

The fix now is in the geometry, in three parts:

- **G1, convex bodies.** orb2 traces a turned extruded body by casting rays against discs and bitangents. On a far turn
  that misses parts of the outline and leaves dents and steps. A convex body is now drawn as the exact convex hull of
  its projected discs.
- **G2, the eyes stay on the face.** An eye group that a far turn carries past the outline slides back onto the
  visible face, so the clip never cuts it.
- **G3, the one remaining limit, per shape.** Lobed bodies (cloud, clover, flower, star) hold their eyes to 0.75 rad of
  turn and 0.3 of pitch. Past that, the far eye folds behind a lobe. Every convex body and the circle keep orb2's whole
  range: `lookAt` reaches 1.18 rad, rim peeks 1.26 and spins a full turn.

`anim-torture-before-after.mp4` takes all 15 shapes through that whole range and both spins, and is checked frame by
frame.

## §23. The fixed pose (the spec the other surfaces build on)

`DESIGN-SYSTEM.md` §23 points here. At rest, the dock, the Bots sidebar, the rail and the 44 px main bot hold every bot
in this one pose.

**Grok-Bot, measured.** The pose is taken from Grok-Bot's main bot. It holds one 3/4 pose in every capture where it
is at rest: all 33 of the 2880 px screens that show it, and
`avatar-states-zoom-sidebar.mp4` from 21 s to 40 s, with no blink and no drift. On `157-live-sidebar-expanded.png`
(DPR 2):

- the eye pair's centroid is +0.22 across and −0.21 down the body's box;
- the strokes lean 54.5°;
- the far eye is 0.60 of the near one's area.

Grok-Bot's other sidebar bots do not share one pose. Each holds the pose its last state ended in, front-facing or
turned (`156`, `162` and `185`), and its rest pose leans less (the flower: +0.11 across, −0.03 down). The owner's
policy is one fixed pose for every bot, so ours takes the main bot's pose for all.

**The pose.** These are orb2 reaction motion values, fitted in `probes/pose.html` and checked against the numbers
above.

| Parameter | Value | Note |
|---|---|---|
| `eyaw` | 0.50 rad | to the viewer's right |
| `epitch` | 0.45 rad | up; on lobed bodies G3 holds it to 0.30 |
| `eroll` | 0.55 rad | the strokes lean, as Grok-Bot's do |
| `bodyRoll` | 0.05 rad | |
| `w` | 1 | the pose fully replaces the rest gaze |

The head follows by orb2's own ratio (0.54), so the body turns 0.27 rad. The eyes are `pill`, or the bot's own eye
shape, at `face-scale` 1.25.

**Per shape.** It is one set of numbers for every shape; nothing is tuned per shape. The table gives where the eyes
land, measured by `tools/posemeas.py` on `pose.html` at 64 px and DPR 2. "Across" and "down" are the eye pair's
centroid against the centre of the body's box, in box widths and heights.

| Shape | Across | Down | Far/near eye | Strokes |
|---|---|---|---|---|
| circle | +0.19 | −0.19 | 0.52 | 58° |
| squircle | +0.17 | −0.16 | 0.77 | 60° |
| soft | +0.21 | −0.18 | 0.65 | 60° |
| wide | +0.16 | −0.19 | 0.65 | 54° |
| tall | +0.20 | −0.20 | 0.61 | 61° |
| bean | +0.16 | −0.17 | 0.56 | 62° |
| drop | +0.15 | −0.08 | 0.47 | 53° |
| ghost | +0.21 | −0.18 | 0.59 | 58° |
| triangle | +0.13 | −0.11 | 0.53 | 51° |
| hexagon | +0.15 | −0.15 | 0.76 | 59° |
| diamond | +0.14 | −0.14 | 0.52 | 54° |
| cloud | +0.14 | −0.07 | 0.46 | 62° |
| clover | +0.14 | −0.08 | 0.67 | 57° |
| flower | +0.14 | −0.09 | 0.63 | 61° |
| star | +0.11 | −0.05 | 0.61 | 58° |
| *Grok-Bot circle* | *+0.22* | *−0.21* | *0.60* | *54.5°* |
| *Grok-Bot flower* | *+0.11* | *−0.03* | | |

Lobed bodies sit nearer the centre because G3 holds their pitch to 0.30 and G2 keeps the pair inside 0.84 of the
outline. Grok-Bot's flower does the same. Every eye is whole and inside the outline: the nearest edge of an eye is at
least 5 px (DPR 2) from the box at 64 px.

**How it is drawn.** It uses orb2's public API and needs no new renderer code. It is a hidden reaction:

```js
OrbAvatar.defineReaction('pose', {
  blink: false,
  face: (t, e, eye) => OrbAvatar.shapes.pairEyes(eye || 'pill'),
  motion: () => ({ eyaw: .5, epitch: .45, eroll: .55, bodyRoll: .05, w: 1 }),
});
```

The orb takes `reaction="pose" idle-motion="off" mode="drift"`:

- `mode` must not be `fixed`, which drops a reaction's motion (orb2 `:2802`).
- With the idle off and no blink, orb2's signature check skips the canvas on every frame. A dock or a sidebar at rest
  costs nothing.
- The badge, the unread dot and the status ring are unchanged.

The pose is the same at every size (28, 36, 40, 44) and under reduced motion.

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
| G1 | **A far turn dents a turned flat body.** For a squircle, hexagon, wide or tall body, orb2 casts 160 rays from the pole against the swept spine discs and the bitangents between them, keeping only bitangents that face outward (`buildBodyContour`, `:1832-1985`). On a far turn some are missed. The outline gets dents and steps along its edges and a bite out of the side the eyes sit on. Every body whose front outline is convex is convex in 3D, so its exact silhouette is the hull of its projected discs. orb2 already traces its convex solids this way (`solidOutline`, `:553`). The rounded corner a turned box shows at its top is real 3D and stays. | `probes/turn.html` (five shapes, 0–72° at 40 px) and `anim-torture-before-after.mp4` (15 shapes, the whole range). | orb2 `:429` (a `polyConvex` helper), `:519` (`convex` flag), `:1951` (hull branch before the ray cast) |
| G2 | **Eyes are cut at the rim.** On a far turn the eyes lead the head (the head turns 0.54 of the eye turn, `:2846`). They reach the rim and the body clip (`:2976`) halves them. | `probes/turn.html`, 55–72°. | orb2 `drawFaceCells` (`:2089-2130`): the group is projected first, and `keepOnFace` slides it toward the centre until every point is inside 0.93 of the outline (0.84 on a lobed body). The contour travels in `warp` (`:2978`). |
| G3 | **A lobed body folds its far eye.** On a cloud, clover, flower or star past about 0.75 rad, the far eye folds behind a lobe. | `probes/pose.html`, `turn.html` | orb2 `:2849`, `:2856-2857`: `_eyeCap` clamps the eye turn to ±0.75 rad and the pitch to ±0.3, on lobed bodies only |

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
- **G1–G3** As in the table above. `probes/gen-variants.cjs` holds each as a literal replacement of orb2's source.

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
- **The surfaces** (`modules/bots/list.ts`, `dock/orbs.ts`, `room.ts`, `chat/`): the per-surface policy below.

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
`capLook`; `liven`; `glance.lead`). The before and after are in `anim-room-before-after.mp4`.

| Surface | Today | Use more |
|---|---|---|
| Sidebar rows (20, to be 28) | Calm idle; looks on hover only. | The fixed pose, animating only in a state (per-surface policy). |
| Main bot, open sidebar | One more row. | 44 px, the first entry of the Bots list (part 3), in the fixed pose; animates in a state. |
| Rail (24, to be 36) | Calm idle. | The fixed pose, as the sidebar. |
| Room presence (40, lively) | Holds a look at the composer while you type (`room.ts:408`). Glances at a new message for 1.2 s (`room.ts:223`). | Lively, as today, drawn cleanly by G1–G3. |
| Room gutter (20) | Calm idle; nothing else. | Lively. The other members' orbs turn toward the speaker's new bubble for 1.2 s (`capLook`, k .45), look at the composer while you type, and the speaker speaks (`speaking`) as its bubble lands. |
| Dock (40) | Calm idle; looks at the pointer only in the row; listens and blinks on hover (`dock/input.ts:317-324`). | The fixed pose at rest; the hovered bot wakes lively; a state animates (per-surface policy). |
| 1:1 chat | The composer mic orb at 18 px, live (`composer.ts:343`). | The bot's title-pill orb glances at its own new bubble. |
| Details pane (28) | Calm idle in an orb button (`settings.ts:161`). | `gentleFollow` k .45, as the preview has. |
| New-bot dialog (128) | `gentleFollow` and `faceOn` (`new-bot.ts:46-60`). | Unchanged. Live picker tiles (optional). |
| Notch | Not in this tree's orb code. | n/a |

### Per-surface policy (owner, 23 November, binding)

This section replaces the calm "use more" rows above wherever they differ.

| Surface | At rest | In a state (working, thinking, replying, needs you) | Under the pointer |
|---|---|---|---|
| **Bots sidebar and rail** | The fixed pose (§23), held still: no idle, no float, no blink. | The state's own animation, then back to the pose. | The hovered bot wakes lively, as in the dock, and settles back when the pointer leaves. |
| **Dock** | The fixed pose, the same as the sidebar. | The same as the sidebar. | The hovered bot wakes: the lively idle, with 3D turns, face variety and its own glances. It settles back when the pointer leaves. |
| **Chat** (bot chat, rooms, the message gutter, the title pill) | `idle-motion="lively"` for every orb: rim peeks, head tilts, sky gaze, micro-saccades, eye micro-morphs and the whip-spin, drawn cleanly by G1–G3. | The state's animation, lively. | The looks of the "use more" plan: at the composer while you type, at the speaker's new bubble, `blink()` as a bubble lands. |

**The fixed pose** is specified in §23 above.

**Does Grok-Bot's sidebar wake on hover?** Partly, and the evidence is thin:

- No recording shows the pointer over a sidebar or rail bot, so the motion of a hover cannot be measured.
- One still does show a hovered bot. In `015-sidebar-item-hover-tooltip.png`, the rail's Grok-Bot is under the pointer,
  with its tooltip open, and it has left the 3/4 pose: it faces front with round eyes. The tooltip's own small icon is
  still in the 3/4 pose. On `013-menu-row-hover.png` the same rail bot, not hovered, is in the 3/4 pose.
- 015 is taken during onboarding, while the bot is asking a question, so the front face may be that state, not the
  hover.

So Grok-Bot at least turns to face you. The owner's policy goes further, with a lively wake under the pointer, in the
sidebar and the rail as in the dock.

**Which states animate in Grok-Bot's sidebar.** Measured with `probes/tools/sideact.py`. It reports each avatar's
frame change at 10 fps, in 0.5 s bins, on every recording that shows the sidebar or the rail.

| Recording | What animates | What holds still |
|---|---|---|
| `live-approval-request.mp4` | The bot that works and then waits for your approval animates for the whole 35 s. | The other four avatars, for all 35 s. |
| `live-approval-allow-then-done.mp4` | The same bot animates through allowed, working and done, all 14 s, still moving when the recording ends. | The other four. |
| `live-group-chat-bots-replying.mp4` | Each bot while it works or replies: row 4 from 0.5–28 s, row 3 from 1–20 s, and the main bot from 1–10 s and 52–60 s. | Each bot once its turn is over. The only other changes are the list reordering. |
| `live-thinking-working-steps.mp4` (the rail) | The rail bot animates for all 40 s while it works. | The rail's Grok-Bot. |
| `avatar-states-zoom-sidebar.mp4` | The state faces, up to 21 s. | The rest pose, from 21 s to 40 s: no blink and no drift. |
| `live-first-reply-streaming.mp4`, `live-new-bot-setup-working.mp4` | Nothing in the sidebar. | All of it. |

**The state table.** Every state Grok-Bot animates in its sidebar, and the orb2 reaction that plays it. The faces and
rhythms come from contact sheets of the same recordings at 1–2 fps.

| boopis state | Grok-Bot, measured | orb2 reaction | Animates | Ends |
|---|---|---|---|---|
| Thinking | Shrinks to about 70 % with dot eyes, then looks around. | `thinking` (sky gaze, dots) | Looping, as long as the state | Blends back to the pose |
| Working (tool) | Wide eyes and dot eyes, turned left and right, with one full turntable spin in 35 s. Motion every 0.5 s bin for the whole state. | `working` (or `compute`) | Looping | Blends back to the pose |
| Replying | Animates while the reply streams. | `speaking` | Looping | Blends back to the pose |
| Needs you | Repeats every **2.0 s** (the strongest self-match in the frame difference at 12–35 s). It alternates a squint (`> <`) with tall pills, with a small turn. | `needs`: tall eyes, a hop every 2.0 s, and the ring | Looping until you answer | Blends to the next state (working, after an allow) |
| Done | Happy `^ ^` arcs, still moving 3 s later, when the recording ends. | `done`: arcs, a hop every 2.4 s, and the sparkle | **3 s**, about one hop and a bit | Blends back to the pose |
| Error | Not seen in any recording. | `error` | As orb2 plays it, until it clears | Blends back to the pose |
| Idle, asleep | Hold still. | `pose`; asleep keeps the pose with `sleeping`'s rest eyes and no zzz | No | n/a |

When a state ends in Grok-Bot, the motion stops within one 0.5 s bin and the pose is held again. Ours blends back over
the same span.

**The transitions.** Every change is a reaction change, carried by orb2's own morph, so nothing pops. All values are
read from orb2 at 03d9094.

| Change | What happens | Duration and easing |
|---|---|---|
| Pose to a state, a state to the pose, a state to another state | `_show` keeps the face being drawn and blends it into the new one. The motion target blends at the same time, and the springs carry the turn. | Face and motion: `morph`, 0.38 s, `easeMorph`. Eyes: a spring (k 165, damping 19, ζ 0.74), within 2 % in about 0.4 s. Head and body: a spring (k 68, damping 11.5, ζ 0.70), within 2 % in about 0.7 s. |
| Hover in, from the pose | `reaction="idle"` and `idle-motion="lively"`. The idle director's first lively target goes through the same springs, so the bot turns out of the pose. It does not jump. | 0.38 s face, about 0.7 s turn, then lively. |
| Hover out, back to the pose | `reaction="pose"`, `idle-motion="off"`, and `lookAt()` with no point clears the pointer target. `_show` blends from whatever face the idle wears now, an eye micro-morph included, back to the pills. | 0.38 s face, about 0.7 s turn. |
| Hover over a bot in a state | The state wins. Hover adds only a capped `lookAt` toward the pointer (`k` 0.3, at most 0.3 of 250 px), and the state keeps playing. | The eye spring, about 0.4 s. |
| A state starts under the pointer | The state takes over at once, with the same blend. | 0.38 s. |
| A state ends under the pointer | The bot goes to the lively hover idle, then to the pose when the pointer leaves. | 0.38 s each. |

A reaction change also gives the body one small jelly kick, 0.75 of `jelly`. At the default 0.55 that is one soft
wobble, which reads as the bot noticing. Under reduced motion boopis lowers `jelly` to 0.12
and orb2 holds the head. A hover then wakes the eyes only, with boopis's `glance` for the steps. The pose and the state
faces are the same.

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

## Critic pass (the per-surface policy and G1–G3)

**How the clips were made.** There are four clips, each 1280 × 800, today on the left and the proposal on the right.
Each was recorded at DPR 2 on Playwright's paused clock, so a frame is exactly 1/30 s and the timeline is the same in
both halves (`Math.random` is seeded). Every frame of every clip was checked:

- **`probes/tools/shape.py`** looks for dents and cuts. For every orb in every frame it finds the deepest point of
  the body's convex hull minus its blob; an eye cut at the rim shows up as a dent too. A convex body fails past 1.2
  device px. A lobed body fails past its own median plus 1.5 px. It also flags a blob that touches its canvas's
  bounds, which is a straight cut.
- **`probes/tools/flicker.py`** looks for A-B-A flicker, and for a one-frame dip in an orb's pixel mass (a canvas
  painted empty).
- **`probes/tools/lifewin.py`** measures liveliness: the mean change per orb between frames 0.1 s apart, by time
  window.

| Clip | Frames | Dents (today → proposed) | Cuts | Flicker | Life (today → proposed) |
|---|---|---|---|---|---|
| `anim-dock-before-after.mp4` (19 s) | 570 | 0 → 0 | 0 | 0 | at rest 0.96 → 0.003; hover sweep 1.31 → 1.11; states 1.00 → 0.36 |
| `anim-sidebar-before-after.mp4` (20 s) | 600 | 0 → 0 | 0 | 0 | at rest 1.29 → 0.005; states 1.29 → 0.41; hover 1.59 → 1.06 |
| `anim-room-before-after.mp4` (14 s) | 420 | 0 → 0 | 0 | 0 | **1.71 → 2.64** (+54 %); 4–9 s: 1.76 → 3.23 |
| `anim-torture-before-after.mp4` (13 s) | 390 | **313 → 0** on convex bodies | 0 | 0 | 1.74 → 1.78 |

The dock and sidebar figures are averages over every orb on screen. At rest the proposal is still by design.
In the hover windows, one bot at a time carries the whole figure; today's figure is every orb's calm drift and float
shimmer (C6) together.

**The torture test, by shape.** It turns all 15 shapes at 72 px through orb2's whole range: a look point swept round
a wide ellipse (`lookAt` reaches its 1.18 rad clamp), then a turntable spin and a tilt spin.

- **Convex bodies.** All 11 (circle, squircle, soft, wide, tall, bean, drop, ghost, triangle, hexagon, diamond) keep
  a clean outline in every frame. On kept frames the worst dent is 1.41 device px, on the squircle, against today's
  313 failing orb-frames. One unkept frame (70) measured 2.0 px. Re-recorded and viewed at 4×, it is the far eye lying
  one pixel inside the rim: the outline is whole, and the eye is inside it.
- **Lobed bodies.** On cloud, clover, flower and star, the 82 flags are the bodies' own valleys deepening as they
  turn edge-on, not breaks. The median rule is too tight for them. Contact sheets of frames 138–150 at 200 px were
  checked by eye: at G3's 0.75 rad the far eye narrows to a sliver against the next lobe and is never cut. 0.75 rad is
  the largest clean turn for these four.

| Shape | Eye turn | Eye pitch | Spins |
|---|---|---|---|
| circle and the 10 other convex bodies | orb2's whole range (1.18 `lookAt`, 1.26 rim peeks) | whole range (sky gaze 0.94) | full |
| cloud, clover, flower, star | 0.75 rad (G3) | 0.30 rad (G3) | full |

**By eye, frame strips** (every 0.2–0.75 s, at 2×) were checked for each clip:

- **Dock.** At rest every bot holds the pose. Under the sweep, each bot wakes as the pointer reaches it and settles
  back within about 0.7 s of it leaving. kai works, and the pointer resting on kai changes only where it looks. kai
  then shows `done`'s arcs for 3 s and returns to the pose. nina needs you with the amber flag, then returns. No pop,
  no jump of the outline, no frame where a face is missing.
- **Sidebar.** The 44 px main bot and the 28 px rows hold the pose. kai works, then is done, then holds the pose.
  nina needs you, and when the pointer passes over her she keeps the state and only looks. The hover sweep wakes
  boopis, kai, moss and iris in turn.
- **Room.** Today, the presence orb is lively and the gutter is frozen. In the proposal, every orb is lively and orb2's
  emotes change the faces: grid eyes, round eyes, squints. They all look at the composer and at the new bubble.
  This is more life than today, as the owner asked, and the clamped version (C9 and C10) is gone.

**Images.** K02 and screens 11–13 were re-rendered with every sidebar and dock bot at the fixed pose. The v7 QA was
run with every rule, sweep and same-component included: 7 pages, 0 findings.

## Probes

Serve `probes/` over HTTP (`python3 -m http.server`). The clip page uses same-origin iframes.

| Page or tool | What it does |
|---|---|
| `clarity.html?lib=stock\|snap\|tuned&ladder=2&fs=1.25` | The K01 orbs at the app's sizes, still |
| `turn.html?lib=stock\|snap` | Five shapes turned 0–72° at 40 px, still: the G1 and G2 proof |
| `pose.html?grid=1` or `?y=&p=&r=&b=` | The fixed pose: a grid of candidates to measure against Grok-Bot, or all 15 shapes in one pose |
| `stage.html?scene=dock\|room\|sidebar\|torture&lib=…&plan=today\|more` | One half of a clip; it drives the real orb2 build |
| `clip.html?scene=…` | The 1280 × 800 before and after |
| `gen-variants.cjs` | Builds `lib/orb-avatar.snap.js` (C1–C3, C7, C8, G1–G3) and `lib/orb-avatar.tuned.js` (the same, plus T1–T5; T2–T4 touch only the calm idle, which no surface uses now) from orb2's `orb-avatar.js`. It stops if a replaced line is not found. C8, the full outline stride, made no visible difference in `turn.html` and is optional. |
| `tools/rec.cjs` | The recorder. The clock is paused, so a frame is exactly 1/30 s whatever a screenshot costs. |
| `tools/shape.py`, `tools/flicker.py`, `tools/lifewin.py` | The frame-by-frame checks (dents, canvas cuts, A-B-A, mass dips) and liveliness by time window |
| `tools/posemeas.py`, `tools/shoot-pose.cjs` | The §23 pose check: a still of `pose.html` and where every shape's eyes land |
| `tools/sideact.py`, `tools/track.py` | The Grok-Bot measurements: sidebar activity per avatar, and eyes and body per frame |
