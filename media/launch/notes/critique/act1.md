# Act 1 critique (B01 to B04, 0.000 to 9.600 s)

Renders reviewed: `renders/a1-1080.mp4` and `renders/a1-vertical.mp4` (576 frames each, 60 fps, rendered 22 Nov 23:06,
the cut the owner reviewed). Act 1's file time is film time, so frame `fN` is `N/60` s.

How it was checked: every frame of B01 at stride 1 to 2 around each move (orbs, line 2, dive), B02 to B04 at stride 1 to 4
with full-resolution crops at 100 to 200%, per-frame motion tracks (phase correlation and colour-mask centroids) for the
camera and the orbs, the S1 seam diffed against act 2's first frame, and the request bubble rendered from the real kit in
the product lab at the film's zoom. Crops are in `crops/`, relative to this file.

Tags: **TI** = theme-independent (fix in the revision), **DS** = dark-specific (will be replaced; listed so it doesn't come
back in light). L = landscape 16:9, V = vertical 9:16.

Counts: **8 blockers, 8 majors, 8 minors.**

---

## Blockers

### A1-01 · blocker · TI · double images on the orbs (the owner's bug)
- **When:** L and V. f44 to f58 (0.733 to 0.967 s) nina; f61 to f66 kai's body rim; f88 to f104 (1.467 to 1.733 s) kai and
  nina (the owner's frame is about f92); f120 to f134 (2.000 to 2.233 s) nina's left edge.
- **What:** a moving orb shows a sharp second copy (body edge and eyes) at about half opacity instead of a smooth blur, so
  kai has four eyes and nina's eyes read as two pairs.
- **Crop:** `crops/a1-01-orb-double-images.jpg`
- **Cause:** the renderer's shortcut. It renders the two shutter ends first and keeps only those two when fewer than 0.2% of
  sampled pixels change by more than 40 levels (`tools/lib/worker.mjs:46` `SLOW`, `:47-51` `changed()` sampling every 7th
  pixel, `:101-106`). A small orb moving 10 to 20 px across the shutter fails that test, so the frame is a 50/50 average of
  two sharp poses.
- **Fix:** remove the pixel-share shortcut. Decide samples from the page's own motion (`__film.samples`, or the maximum
  screen displacement of moving elements across the shutter) and always render every sub-frame when anything moves; or
  render no blur at all for slow character moves. Never average just two samples.

### A1-02 · blocker · TI · faint ghost of an older pose on orbs, including at rest
- **When:** L and V. kai f61 to f76 (1.017 to 1.267 s): a faint pair of pill eyes stays at the old gaze, up and left of the
  real eyes. moss at rest at f390 (6.500 s): a second faint pair of eyes above his eyes. The room's head stack at f530
  (8.833 s): kai's and moss's eyes are doubled.
- **What:** about 1/8-opacity ghosts of a pose the orb held a fraction of a second earlier. Unlike A1-01 they appear even
  when the orb has nearly stopped.
- **Crop:** `crops/a1-02-stale-pose-ghost.jpg`
- **Cause (verified):** two bugs combine. (1) The renderer seeks the shutter's last sample before its middle ones
  (`worker.mjs:103-106`: `times[0]`, `times[n-1]`, then `times[1..]`), so the second middle seek goes **backwards**.
  (2) Overlapping `to()` tweens write the same pose field: `glance()` runs on the character spring for about 0.65 s
  (`motion/orb-moves.ts:32-35`), and B01 starts a new glance before the last has ended (`acts/a1/b01.ts:88` at 0.62 s and
  `:92` at 0.98 s). The timeline has `overwrite: false` (`engine/film.ts:75`) and `tl.time()` (`film.ts:145`) renders
  children in reverse order when going backwards, so the earlier tween wins on that one sample. A GSAP-only reproduction of
  b01's two glances gives yaw 7.53 on the first middle sample against 12.1 on its neighbours. One stale sample in eight
  matches the measured ghost strength (about 15% in linear light).
- **Fix:** seek sub-samples in ascending time only (render `times` in order and compare ends afterwards if needed), and
  stop overlapping tweens from fighting: `overwrite: 'auto'`, or chained `fromTo` tweens whose start is the previous
  tween's value at that time. Then re-run the determinism check with a backward seek between samples.

### A1-03 · blocker · TI · the cursor strobes into a row of copies
- **When:** L (V the same). f459 to f461 (7.650 to 7.683 s) as it enters; f526 to f534 (8.767 to 8.900 s) on its way to the
  send button.
- **What:** the cursor is drawn as six to eight sharp arrows in a line (a saw-tooth) instead of one blurred cursor. It also
  crosses about 400 px in three frames, faster than the eye can track.
- **Crop:** `crops/a1-03-cursor-strobe.jpg`
- **Cause:** 8 sub-frames (the default, `worker.mjs:94`) for a 60 to 100 px/f move: about 4 px between copies of a 2 px
  outline. The cursor's tweens don't ask for more samples (`data.samples`).
- **Fix:** slow the entry (script: arc in over 18 to 36 f) and give cursor moves enough samples for 1 to 2 px between
  copies (32 to 64), or draw its blur as one streak. The owner listed the cursor among the double images.

### A1-04 · blocker · TI · the dive into kai's eye is a stepped, ringed blur
- **When:** L and V. f141 to f149 (2.350 to 2.483 s).
- **What:** the zoom-through shows discrete copies of "Claude and GPT / Same group chat" (each letter doubled and tripled,
  f143 to f146), concentric rings on kai's body (f147 to f149), and his other eye smears into a dark wedge on the left of
  frame f148.
- **Crop:** `crops/a1-04-dive-stepped-blur.jpg`
- **Cause:** 32 samples (`acts/a1/b01.ts:149`, `samples: 32`) for an exponential zoom to a scale of several hundred, so in the
  last frames each sample is tens of pixels apart at the frame's edge. The eye window is a clip path recomputed per sample.
- **Fix:** sample by the zoom's rate (radius × log scale ratio per shutter, 1 to 2 px per sample, so 64+ in the last six
  frames), or add a true radial blur for the dive. Keep the second eye low-contrast or out of frame in the final frames.

### A1-05 · blocker · TI · the mention chip sits below the line (the owner's bug)
- **When:** L and V. The request bubble f558 to f575 (9.300 to 9.583 s); the composer while typing, f490 to f548
  (8.167 to 9.133 s).
- **What:** "kai" in the chip sits 15 px below the baseline of "is it ready to cut?", and the bubble's padding is uneven
  (about 45 px above the content, 30 px below at the film's 3.3x). The real product, rendered from the same markup at the
  same zoom, puts the chip and the text on one baseline (1 px apart).
- **Crop:** `crops/a1-05-mention-chip-vs-product.jpg` (film left, product lab render right, baselines drawn)
- **Cause (probable):** the film replaces the chip's `<orb-avatar>` with a film-orb SVG (`look/src/stage.ts:104-113`
  `sharpenOrbs`, then `engine/look.ts:86` `swapOrbs`). The chip is an `inline-flex` box placed by
  `vertical-align: -4px` (`apps/desktop/ui/src/components/components.css:727-731`), and its baseline comes from its first
  child, so a different orb element moves the whole chip. The storyboard's own key frame (`storyboard/board/b07.jpg`) shows
  the same drop, so the bug is in the look's builders, not in one act.
- **Fix:** when an orb is swapped, keep the kit orb's box: same display, size and vertical alignment (wrap the SVG in the
  element the kit measures), or give the chip an explicit text baseline. Add a check that renders each inline chip in the
  product lab and in the film at the same zoom and compares the baselines.

### A1-06 · blocker · TI · the room's plate and composer appear twice as the room assembles
- **When:** L f452 to f458 (7.533 to 7.633 s); V f480 (8.000 s).
- **What:** in 16:9 the room plate is drawn as two offset rectangles and the composer's placeholder stutters vertically. In
  9:16 the composer shows two rows of member chips and two mic and send buttons.
- **Crops:** `crops/a1-06-room-plate-double.jpg`, `crops/a1-06b-composer-double-vertical.jpg`
- **Cause:** A1-01's two-sample shortcut on the plate's scale-in and the composer's rise; in 9:16 the composer's height also
  snaps (A1-15) inside one shutter.
- **Fix:** A1-01's renderer fix; animate the composer's height instead of snapping it.

### A1-07 · blocker · TI · the lab marks slide through the cards' text
- **When:** L and V. f328 to f340 (5.467 to 5.667 s).
- **What:** each lab mark travels diagonally from the button's centre to the plan line and crosses the name and role
  that have already risen: the Claude mark runs over "kai" and "docs and changelog", the xAI mark over "vox" and
  "release notes". For a few frames the cards read as overlapping text.
- **Crop:** `crops/a1-07-mark-through-text.jpg`
- **Cause:** `acts/a1/b03.ts:120-129`: the mark's straight move from the button's logo box to the plan line overlaps in
  time with the text rising 4 f after the container.
- **Fix:** send the mark down the card's left gutter (under the orb's column) and then right into the plan line, on an
  arc that never enters the text column, or let it land before the name and role rise. It may also travel under the text
  layer with a mask, but never over it.

### A1-08 · blocker · TI · the request strobes as it lifts into the thread
- **When:** L and V. f552 to f558 (9.200 to 9.300 s).
- **What:** "kai is it ready to cut?" breaks into two or three sharp copies as it rises from the composer into the bubble.
- **Crop:** `crops/a1-08-request-lift-strobe.jpg`
- **Cause:** A1-01 and A1-03 (too few samples for a 20 px/f move on fine text).
- **Fix:** the renderer fixes; the lift is a 20 f travel, so it needs about 16 to 32 samples.

## Majors

### A1-09 · major · TI · the cards' text strobes as they collapse
- **When:** L and V. f410 to f416 (6.833 to 6.933 s).
- **What:** "nina / deploys / ChatGPT subscription" slides left into the orb in discrete copies.
- **Crop:** `crops/a1-15-collapse-strobe.jpg`
- **Cause:** too few samples for the slide (as A1-03).
- **Fix:** more samples, or shorten the visible slide by masking earlier.

### A1-10 · major · TI · sign-in buttons without labels, then a wipe that slices letters
- **When:** L and V. Logo-only buttons f174 to f214 (2.900 to 3.567 s); labels wipe on f216 to f246 (3.600 to 4.100 s).
- **What:** for 0.7 s the four buttons are empty shells with a logo off-centre, a state the product never shows. The labels
  then appear behind a hard left-to-right clip edge that cuts letters in half ("Sign in with Cha", "Sign in with GitHu").
- **Crop:** `crops/a1-09-label-wipe.jpg`
- **Cause:** `acts/a1/b02.ts:42-45` (`clipPath: inset(0 100% 0 0)` to `inset(0)`, 12 f each, one per sixteenth, after the
  line lands).
- **Fix:** the buttons fan out complete (logo and label) as boarded. If the labels must arrive later, reveal whole
  characters with K2's soft leading edge, never a clip edge.

### A1-11 · major · TI · an empty frame after the dive
- **When:** L and V. f150 to f157 (2.500 to 2.617 s).
- **What:** once the eye fills the frame there are eight frames of dark ground with a speck in the middle; the buttons are
  a tiny stack and "Bring" only rises at f158. The craft bible's rule 2 is no empty frame between ideas.
- **Crop:** `crops/a1-11-empty-frame-after-dive.jpg`
- **Fix:** have the fan already well under way inside the eye when it fills the frame (start the buttons earlier or larger
  than 60%), and shorten the snap ease's slow tail, so the frame lands on readable buttons.

### A1-12 · major · TI · the orb stack lands against the headline
- **When:** L. f438 to f446 (7.300 to 7.433 s).
- **What:** the four orbs land at the top left touching "Make each one a bot in boopis", which is still on screen; nina and
  moss sit against the "M".
- **Crop:** `crops/a1-14-stack-crowds-headline.jpg`
- **Fix:** the line exits before the stack arrives (the script exits it 7.27 to 7.47 s) or the stack lands clear of it.

### A1-13 · major · TI · the room plate's edges show
- **When:** L f560 to f575 (9.333 to 9.583 s); V f560 to f575; L f520 to f540 (bottom band).
- **What:** dark vertical bands at x 0 to 40 and 1880 to 1920 frame the room like pillar-boxing; in 9:16 the plate's top and
  bottom edges show at about y 120 and y 1700. The board's room "bleeds three edges".
- **Crop:** `crops/a1-12-plate-edges.jpg`
- **Cause:** the room plate is sized to the key frame and the camera's last push (f550 to f573) shows its edges.
- **Fix:** make plates bleed at least 10% past the frame at every camera state of the act.

### A1-14 · major · TI · the send order is wrong
- **When:** L and V. f538 to f552 (8.967 to 9.200 s).
- **What:** the send button turns grey (disabled) at f544 while the typed line still sits in the composer until f552, and
  the press has no visible cursor dip or 0.96 squeeze. Response appears before the action.
- **Crop:** `crops/a1-13-send-order.jpg`
- **Fix:** cursor dips to 0.85 for 4 f, the button squeezes to 0.96, and on the frame it bottoms out the text lifts; the
  button greys only once the field is empty (the product's order).

### A1-15 · major · TI · 9:16: the composer's height snaps on the first keystroke
- **When:** V f478 to f482 (7.967 to 8.033 s).
- **What:** the composer loses about 25 px of height in two frames when typing starts (and is drawn twice on f480, A1-06).
- **Crop:** `crops/a1-06b-composer-double-vertical.jpg`
- **Fix:** keep the composer's height constant from placeholder to typed text, or animate it at the product's own timing.

### A1-16 · major · TI · 9:16: the hook sits under the platform's right rail
- **When:** V f0 onwards, and B02 at f240 to f300.
- **What:** "Claude and GPT" runs to x 1011 (69 px from the edge), under the Reels/TikTok action rail; the orbs and lines
  fill the top 60% and the bottom third is empty.
- **Crop:** `crops/a1-17-vertical-hook-safe.jpg`
- **Fix:** keep type inside about x 60 to 960 for 9:16, and use the lower half (the orbs larger and lower, or the line
  across two lines at a larger size).

## Minors

### A1-17 · minor · TI · two lines visible at once at the B02 to B03 swap
- **When:** L. f306 to f309 (5.100 to 5.150 s).
- **What:** the old line at about 10% and the new "Make" are visible together, a small dissolve.
- **Crop:** `crops/a1-10-line-swap-overlap.jpg`
- **Fix:** finish the K1 exit before the K1 entry starts.

### A1-18 · minor · TI · the B03 headline fades out over the arriving room
- **When:** L. f444 to f450 (7.400 to 7.500 s).
- **What:** an opacity fade with almost no movement while the room's plate blurs in under it.
- **Fix:** K1 exit (y -16, blur, 12 f on depart), finished before the plate arrives.

### A1-19 · minor · TI · the speaking face flickers instead of speaking
- **When:** L and V. kai f75 to f78 (1.250 to 1.300 s); nina about f107 to f112.
- **What:** the eyes jump bars to circles to bars in four frames, which reads as a glitch at speed, not as orb2's speaking
  face.
- **Crop:** `crops/a1-16-speak-eye-flicker.jpg`
- **Cause:** `acts/a1/orbs.ts:33-36` (circle for 0.07 s between two bar states).
- **Fix:** use orb2's own speaking cadence (bars with moving heights, circles on its slow cycle), at least 6 to 8 f per
  state.

### A1-20 · minor · TI · the selection highlight has uneven padding
- **When:** L and V. "Same" from f68, "already" from f216, "bot" from f348.
- **What:** about 12 px of brass before the word and about 2 px after it before the caret.
- **Crop:** `crops/a1-18-selection-padding.jpg`
- **Fix:** equal padding on both sides, the caret outside the padding.

### A1-21 · minor · TI · the cast cards' right half is empty
- **When:** L. f340 to f410 (key frame f390, 6.5 s).
- **What:** each 950 px card holds its text in the left half; the right 45% of every card is blank.
- **Fix:** narrow the cards to their content (the script's 880 px or less) or set the plan line on the right.

### A1-22 · minor · TI · slow camera drift on resting text
- **When:** L. f520 to f540 (8.667 to 9.000 s): the room rises 0.2 to 0.4 px/f.
- **What:** drifts in the 0.3 to 1.5 px/f range make fine text shimmer as it resamples (craft bible 5 and 10).
- **Fix:** drift faster than 2 px/f with blur, or slower than 0.25 px/f, or snap resting text to whole pixels.

### A1-23 · minor · TI · 9:16: the cursor is cut by the frame edge
- **When:** V f560 to f575 (9.333 to 9.583 s).
- **What:** the cursor rests half outside the right edge after send.
- **Fix:** park it inside the frame.

### A1-24 · minor · DS · buttons and cards barely separate from the ground
- **When:** L and V, B02 and B03.
- **What:** the sign-in buttons' and cards' fill is within a few levels of the ground; only the hairline separates them.
- **Fix:** in the light theme, separate plates from the ground by value (6 to 8 L* steps) plus the edge, as the craft bible
  asks.

---

## The premium gap (act 1)

1. **Character animation, not pose tweens.** In the references the characters have weight: anticipation before a move,
   squash on contact, eyes that lag the body by a few frames, contact shadows that react. Here the orbs swap faces and slide
   on springs, and the speaking face is a flicker (A1-19). Give kai and nina a few hand-timed beats (a lean with
   follow-through, an eye lag, the shadow tightening on a hop) and one idle life that never freezes.
2. **One optical move for the dive.** `bolt-forge` and `ref1-hi27624` dive with a smooth, heavy blur and land on a full frame
   on the beat. This dive steps (A1-04) and lands on an empty frame (A1-11). Fix the samples, fill the eye with the next
   scene, and land the swap on 2.2.
3. **The product exact to the pixel.** The owner's bar starts here: the chip (A1-05) and the labels (A1-10) are the kind of
   detail the references never get wrong. Every product element on screen should be checked against the lab render at the
   same zoom before animation.
4. **Type with more air.** The film lines render at about 105 to 110 px and span 70 to 80% of the frame (B02, B03), above
   the script's 84 to 96 px. The references set shorter, smaller lines with generous space and one accent; set the lines to
   the spec and let the UI be the large thing.
5. **Hand-offs with overlap.** The B03 to B04 flight lands the orbs, then the room blurs and fades in around them, then the
   cursor arrives. Overlap these by 2 to 6 frames per part (the craft bible's U4 and part 3), with the room building out of
   the stack rather than fading up behind it.
