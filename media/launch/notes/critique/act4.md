# Act 4 critique (B14 to B19, 32.000 to 46.933 s)

Renders reviewed: `renders/a4-1080.mp4` and `renders/a4-vertical.mp4` (896 frames each, rendered 22 Nov 21:42 and 21:54,
before the latest act 3). The file's frame 0 is film time 32.000 s, so frame `fN` is `32.000 + N/60` s; both are given.

How it was checked: stride 4 to 6 through the act, stride 1 with full-resolution crops at each event (the glide, the dock
poke, the message, the stream, the approval card, the push, the hold, the smash cut, the focus pull, the tagline, the eyes
to wordmark, the end card's glance and blinks); a colour-mask track of nina through B17; the wordmark's size over B19; the
S3 seam diffed against act 3's last frame; key frames compared with the storyboard. Crops are in `crops/`, relative to this
file.

Tags: **TI** theme-independent, **DS** dark-specific. L = 16:9, V = 9:16.

Counts: **4 blockers, 5 majors, 6 minors.**

---

## Blockers

### A4-01 · blocker · TI · 9:16: the hold button is hidden behind the other app
- **When:** V f330 to f380 (37.500 to 38.333 s), the whole hold.
- **What:** in the close-up the nameless app's plate sits in front of the dock card and covers the lower half of "Hold to
  approve"; Deny is out of frame and "staging" is cut at the left. The film's escalation is half hidden in the 9:16 master.
- **Crop:** `crops/a4-03-hold-occluded-vertical.jpg`
- **Cause:** the vertical desk layout and z-order (`acts/a4/desk.ts`): the app plate is placed below the card and in front
  of it, and the push frames the button over the app's top edge.
- **Fix:** move the app out of the push's frame (or behind the card) for B16 in 9:16, and frame the button centred with Deny
  in view.

### A4-02 · blocker · TI · the glide to the dock is a strobed whip
- **When:** L and V. f17 to f26 (32.283 to 32.433 s), up to 90 px/f (measured).
- **What:** the terminal and the room tear into rows of copies and the orbs into striped streaks; it reads as a whip pan,
  not the script's glide on the camera spring.
- **Crop:** `crops/a4-01-glide-whip-strobe.jpg`
- **Fix:** a slower move (the camera spring over 27 f or more, under about 25 px/f), and the renderer's sample fix (act 1,
  A1-03) for whatever speed remains.

### A4-03 · blocker · TI · double images when plates resize and during the push
- **When:** L and V. f160 to f163 (34.667 to 34.717 s): the dock session's head "nina / deploys" and "You 14:09" double as the
  plate grows; f222 to f228 (35.700 to 35.800 s): every line of the session doubles as the approval card rises; f290 to
  f300 (36.833 to 37.000 s): the push into the hold button strobes ("until you hold", "nina wants to deploy to staging" in
  copies).
- **Crops:** `crops/a4-10-plate-resize-doubles.jpg`, `crops/a4-11-push-in-strobe.jpg`
- **Cause:** the renderer's two-sample shortcut and sample count (act 1, A1-01 and A1-03).
- **Fix:** the renderer fixes; re-check these three moments frame by frame after the re-render.

### A4-04 · blocker · TI · the wordmark's eyes blink with a grey double outline
- **When:** L and V. f801 to f805 (45.350 to 45.417 s) and f864 to f867 (46.400 to 46.450 s).
- **What:** as the logo's eyes close, each shows a second, grey outline, the last frames of the film before the loop.
- **Crop:** `crops/a4-06-endcard-blink-ghost.jpg`
- **Cause:** the two-sample shortcut (act 1, A1-01): only the eyes change, so the changed area is tiny.
- **Fix:** the renderer fix.

## Majors

### A4-05 · major · TI · seam S3: the terminal jumps 10 px at 32.000 s
- **When:** L. a3 f719 (31.983 s) to a4 f0 (32.000 s).
- **What:** the terminal plate (the left half of the frame) moves 10 px right between the last frame of act 3 and the first
  of act 4 (measured by phase correlation); the room is identical. Act 4 was rendered before act 3's last revision, so
  re-render and re-diff before judging; as rendered, it is a visible pop on the cut.
- **Crop:** `crops/a4-02-seam-s3-terminal-jump.jpg`
- **Fix:** take the terminal's world rect from `ctx.carry.desk` exactly as act 3 leaves it, and add the seam diff check
  (act 2, A2-01).

### A4-06 · major · TI · empty frames after the glide
- **When:** L and V. f28 to f60 (32.467 to 33.000 s).
- **What:** the glide lands on a dark field with a small app plate at the right and the dock at the bottom edge; the boopis
  window the dock belongs to is not in frame, so the dock floats.
- **Crop:** `crops/a4-09-empty-frames-after-glide.jpg`
- **Fix:** the script frames the lower half of the boopis window with its dock, and the app beside it; land there.

### A4-07 · major · TI · the headline sits at the top edge and nina's orb at the left edge
- **When:** L. f50 to f220 (32.833 to 35.667 s).
- **What:** "Same thread, from your other apps" has its cap tops about 30 px from the frame's top, outside title-safe
  (the board has it at about 87 px). The dock session bleeds off the left edge with nina's orb 8 px from it (the board keeps
  the session well inside).
- **Crop:** `crops/a4-07-headline-at-top-edge.jpg`
- **Fix:** match the board (`storyboard/board/b14.jpg`): the line at about 90 px from the top, the session inside the frame.

### A4-08 · major · TI · the dock's other orbs fade out without moving
- **When:** L and V. f63 to f68 (33.050 to 33.133 s).
- **What:** when nina's orb is clicked, kai, moss and vox dim to nothing in place while the slab grows; nina's poke squash
  is barely visible.
- **Crop:** `crops/a4-08-dock-orbs-fade.jpg`
- **Fix:** the product's dock morph: the other orbs are covered by the slab's outline as it rises (an opaque edge), or move
  with it; the poke squash on the character spring, large enough to read (about 10%).

### A4-09 · major · TI · nina freezes during the tagline
- **When:** L. f496 to f541 (40.267 to 41.017 s) and f571 to f596 (41.517 to 41.933 s).
- **What:** nina's body is identical to 0.1 px for 0.75 s, then one hop, then still again. The script has her keep her happy
  face and glance up at the line; the look asks for orbs that are calm and alive, never static.
- **Fix:** the idle float from B01 (a few px, out of phase), a glance up at the line as it lands, a blink.

## Minors

### A4-10 · minor · TI · the hold close-up is framed as boarded, with Deny cut and the cursor on the label
- **When:** L f304 to f380 (37.067 to 38.333 s).
- **What:** Deny and the field's text are cut by the left edge and drift further out; the cursor's arrow sits on
  "app|rove" for the whole hold; three nested dark slabs make hard edges under the button. All of it matches
  `storyboard/board/b16.jpg`, so it is a note for the revision.
- **Crop:** `crops/a4-04-hold-framing-cursor.jpg`
- **Fix:** centre the button with Deny whole, and park the cursor below the label's x-height after the press.

### A4-11 · minor · TI · the dot field swallows the label at close-up scale
- **When:** L f330 to f378 (37.500 to 38.300 s); V the same.
- **What:** the product's 3 px Bayer dither, magnified about 6x, becomes coarse 10 px dots; where the white dots meet the
  white label the words merge ("Hold t▒ approve").
- **Crop:** `crops/a4-05-dots-eat-label.jpg`
- **Fix:** at close-up, draw the dither on a finer grid (no more than about 1.5x the product's) or clip the label's inversion to
  the dot front, so the label stays readable through the fill.

### A4-12 · minor · TI · the letters' in-betweens read as other letters
- **When:** L and V. f629 to f635 (42.483 to 42.583 s).
- **What:** mid-hop the "b" squashes into an "h" and the "p" into an "n." ("h●●n.").
- **Crop:** `crops/a4-12-letters-inbetween.jpg`
- **Fix:** compare with the product's `<boopis-logo letters="play">` at 200 px; if it doesn't do this, cap the squash so each
  letter stays itself.

### A4-13 · minor · TI · nina's orb slides over her own name as it leaps out
- **When:** L. f458 to f462 (39.633 to 39.700 s).
- **What:** the growing orb passes over "nina / deploys" in the card's head.
- **Crop:** `crops/a4-13-orb-over-own-label.jpg`
- **Fix:** start the blur on the card before the orb crosses its label, or lift the orb on an arc away from the text.

### A4-14 · minor · TI · 9:16: the cursor types from below the field
- **When:** V f100 to f160 (33.667 to 34.667 s).
- **What:** the cursor rests below the other app's field while the message types into it.
- **Crop:** `crops/a4-14-vertical-endcard-and-dock.jpg` (left tile)
- **Fix:** the cursor clicks into the field and rests inside it, or leaves.

### A4-15 · minor · DS · black slabs on a dark ground
- **When:** L and V, B14 to B16.
- **What:** the dock session and the dock slab are pure black on the dark ground, so the frame becomes a stack of black
  rectangles; the red cast of B15 barely reads.
- **Fix:** in light, the dock keeps its own slab, and the plates are separated by value and shadow.

The end card itself (f700 to f895) is clean apart from A4-04: wordmark, tagline and platforms as decided (variant b), no
address, a drift of about 2.5% a second.

---

## The premium gap (act 4)

1. **The hold is the hero shot.** It is the film's escalation, yet the button is off-centre with its neighbour cut and the
   cursor on its label (A4-10), its dither eats the label (A4-11), and in 9:16 it is half hidden (A4-01). The references
   give their one big moment a centred, clean, slowly pushing frame where the product's own animation (the fill) is the only
   thing moving, timed to the rising tone.
2. **Camera moves with intent.** The glide (A4-02) and the push (A4-03) are fast and strobed; the references move the camera
   slowly in the second half of a film and save speed for one cut. Slow both, and land the glide on a full composition
   (A4-06).
3. **A living closer.** nina freezes under the tagline (A4-09). A small idle float, a glance up at the line and one blink
   make the beat feel like the character, not a sticker.
4. **The wordmark build checked frame by frame.** The letters' in-betweens (A4-12) and the end card's blinks (A4-04) are the
   last frames before the loop; they should be the cleanest frames in the film.
