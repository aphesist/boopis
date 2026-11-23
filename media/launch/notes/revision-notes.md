# Revision notes for the animators (light theme pass)

Read decisions.md (points 6-8), the critic's SC/critique/actN.md and summary.md, and the art director's light look
(SC/storyboard/look.md, SC/storyboard/light/) before starting.

## Known cross-act issues
- Act 3: `.a3-sessionclip` (the composer, "fix the proration drift in src...") is set visible while its parent `.a3`
  is hidden, so in the joined `film` scene it draws from 0 s over acts 1 and 2 (16:9 at 80,790 w 1196; 9:16 at
  50,1330 w 936). Bound every element of an act to its own window.
- Act 4, 15 s cut: read nina's orb from `ctx.carry.orbs.nina` (face "wide"), which act 2 hands on in cuts without B08.
- Act 1: the "@kai" chip in the request bubble sits below the text line and the bubble padding is uneven (owner's
  frame images/129.png). Use the real kit capsule and bubble, measured against the product.
- Every act: the per-beat `film.motion(..., N)` workarounds for double images come out once the renderer's
  displacement-based sampling lands (motion lead).
- Act 3 still share 0.36 / 0.46 (9:16) and act 4 0.38: the camera was held dead still only to dodge the checker's
  slow-drift false positive, which the checker fix removes. Bring gentle, motivated motion back into the holds.

## Seams (unchanged)
9.600, 20.000, 32.000 s; handles in SEAMS.md; carry through ctx.take / ctx.carry.

## Order of work (23 Nov)
1. Engine first (motion lead): E1-E4 (sampling, ascending seeks, overlapping tweens, instant swaps), E5/E6 shared helpers
   (bars swap, K1 word-rise exit, K5 self-editing line), L4 orb character layer.
2. Look (art director): light theme done (b52340f4); now L1-L3, L5, L6, B17 back, B10 composer. Its list of act
   hard-codes is in its report (to be pasted into each animator's brief).
3. Checker: cross-fade drift fix, double-image detector, frame-edge text, act-join diff, out-of-span elements, chip
   baselines.
4. Then the four animators revise in light, each with: SC/critique/actN.md, summary.md, this file, the art director's
   hard-code list for their act, and the new engine helpers. Each act must pass the new checker rules and a second
   critic pass before the coordinator looks at it, then the owner.

## Art director's per-act fixes (light look b52340f4 + key frames ec9ed6f5)
Read look.md sections 2 (bleed) and 7 (safe box, crop rule, type token, 9:16 rule) first. Film lines take
--film-line-size (88 px, hook 96; 9:16 92/90); filmLine() takes no size; an act's camera push must keep a film line at
or under 96 px on screen (16:9). Safe box 16:9 x 60-1860, y 60-1020 (top line box at y >= 84); 9:16 x 60-960,
y 220-1640. Plates bleed via bleedPlate(). Builders place parts in stage pixels (inStage).

### Act 1
- a1/b03.ts:30-33 shell shadow rgba(0,0,0,.35) -> var(--plate-ring), var(--card-shadow).
- a1/util.ts:137,152 lamp fallback var(--bg-4)/rgb(46,43,39) -> var(--lamp-orbs).
- a1/b04.ts:114 the var(--bg-2) backing behind the head shows as a box -> transparent.
- a1/b01.ts:9,137-172 the eye dive relies on "the eye's dark interior becomes B02's ground"; in light B02 is paper and
  the eye near-black: rethink the portal so it never pops from black to light.
- a1/b03 builds its own shells at 880 px; the key frame cards are now 820.
- 9:16: hook at y 420/545, orbs 360 px centred on y 1200.
### Act 2
- a2/beats.ts:490 lip gradient rgba(0,0,0,.42); :514 back plates rgb(35,33,30) + rgba(0,0,0,.38) -> var(--bg-3),
  var(--card-shadow).
- a2/window.ts:133 window shadows rgba(0,0,0,.46/.40) -> var(--plate-shadow).
- a2/beats.ts:97,161 pass sizes 88/104 to filmLine: now ignored; use the token.
- 9:16 room column is x 60-960 (346 real px).
### Act 3
- a3/session.ts:20 dark hex for strong/dim text and brass-soft -> resolve the tokens.
- a3/desk.ts:173-174 tab inks #1a1815/#a59d90; a3/rig.ts:135,163,177 lamp tints -> --lamp-orbs/-cool/-ui;
  a3/rig.ts:157 + a3/desk.ts:215 lens brightness(.8) -> var(--focus-pull)/var(--haze).
- a3/build.ts:145-147 puts k10's log at log9's position: scroll the way the product does (fixes A3-08's crop).
- a3/build.ts:126-134 builds its own B13 room at width 560: take the narrow layout at 292 (as k13) or use k13's room
  (fixes A3-07).
- 9:16: Governance pinned at the foot.
- .a3-sessionclip drawn over acts 1-2 from 0 s; B13's room still drawn over the end card at 46 s.
### Act 4
- a4/util.ts:106-111 lamp table -> --lamp-* tokens; :130 cursor shadow -> var(--cursor-shadow).
- a4/close.ts:139 B17 darkens 12% -> the look's focus pull; B17's back is the light desktop, not the blurred black dock.
- a4/close.ts:76 contact shadow one stop -> the look's two stops.
- a4/desk.ts:80-100 move to b14-dock / b15-dock (16:9 slab at x 60, right column at x 1290).
- B14's line at y >= 84 (A4-07); the session stays inside the frame.
- B16 9:16: other app out of the push, button centred with Deny whole, cursor below the label (A4-01, A4-10).
- Read nina's orb from ctx.carry.orbs.nina in the 15 s cut.
### Shared motion helpers
- motion/cursor.ts:15 white arrow -> the look's dark arrow with a light edge (--selected / --text-on-light).
- motion/reveal.ts:57 T7 focus darkens with brightness(.9) -> the look's focus pull.
