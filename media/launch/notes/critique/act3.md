# Act 3 critique (B09 to B13, 20.000 to 32.000 s)

Renders reviewed: `renders/a3-1080.mp4` and `renders/a3-vertical.mp4` (720 frames each, rendered 22 Nov 23:22 and
23:31). The file's frame 0 is film time 20.000 s, so frame `fN` is `20.000 + N/60` s; both are given.

How it was checked: stride 4 through the act, stride 1 to 2 with full-resolution crops at each event (typing, send and
lift, the panel, the rows, the failed test and the climb, the slow pull back, the Bots click, the terminal, Enter, the
run); per-frame motion tracks of the session and the terminal; the S3 seam diffed against act 4. Crops are in `crops/`,
relative to this file.

Tags: **TI** theme-independent, **DS** dark-specific. L = 16:9, V = 9:16.

Counts: **6 blockers, 8 majors, 4 minors.**

---

## Blockers

### A3-01 · blocker · TI · on send the request is doubled, then jumps 300 px
- **When:** L (V similar). f80 (21.333 s) and f81 (21.350 s).
- **What:** on the send frame the composer shows two overlapping copies of "fix the proration drift in src/billing"; on the
  next frame the text teleports from the field's left edge to the middle of the composer, and only then lifts. There is
  no visible press on the send button.
- **Crop:** `crops/a3-01-send-double-and-jump.jpg`
- **Cause:** (1) the typed characters hide and the request card shows at exactly `send` (`acts/a3/session.ts:116` and
  `:123`), which is a frame time, so the shutter's samples straddle the swap and average both states; it is not on a
  `film.cut`. (2) The card's start offset `reqLift` is measured at build (`session.ts:49-57`) and does not match where the
  typed text is at 21.333, after the camera drift and the composer's own movement.
- **Fix:** put instantaneous swaps on a `film.cut()` (or half a frame off the frame time); measure the lift's start from the
  typed text's actual position at `send`; show the press (0.96 for 4 f) before the text moves.

### A3-02 · blocker · TI · the lift and the Governance panel strobe
- **When:** L and V. f82 to f93 (21.367 to 21.550 s).
- **What:** the Governance section slides in as a stack of copies, and the request turns into a vertical barcode of copies
  as it rises (f89 to f92).
- **Crop:** `crops/a3-02-lift-and-panel-strobe.jpg`
- **Cause:** the renderer's sampling (act 1, A1-01 and A1-03): the request moves up to 150 px/f (measured) on 8 samples.
- **Fix:** the renderer fixes, and a slower lift (the script's 20 f travel, not a near-instant jump).

### A3-03 · blocker · TI · the whole session shifts mid-hold with embossed text
- **When:** L. f140 to f164 (22.333 to 22.733 s), peak 8 px/f at f150.
- **What:** while the line "The cheaper one tries first" lands, the session slides about 50 px left and every line of text
  shows a 2 to 3 px double (a light copy and a dark copy, like an emboss).
- **Crop:** `crops/a3-03-session-shift-emboss.jpg`
- **Cause:** the drift key `session.ts:168` (dx -50 between the camera settle and B10's start, on travel) rendered with the
  two-sample shortcut (act 1, A1-01).
- **Fix:** the renderer fix; and don't nudge the reading content while the line lands: keep the hold's drift to the craft
  bible's 1.5 to 3% a second.

### A3-04 · blocker · TI · Enter dissolves the window into an empty plate
- **When:** L and V. f598 to f610 (29.967 to 30.167 s).
- **What:** on the drop the window's content streaks (the orbs as rows of copies), then the right plate is empty for two to
  three frames (f604), then the room fades in. It is a dissolve with an empty frame between, at the act's loudest moment.
- **Crops:** `crops/a3-05-enter-dissolve.jpg`, `crops/a3-14-room-vanishes-on-enter.jpg`
- **Fix:** a real hand-off: the window scales forward on travel with its own content changing under the motion (the room
  is already open in it), rendered with enough samples; no empty plate, no fade.

### A3-05 · blocker · TI · the cursor strobes
- **When:** L. f342 to f346 (25.700 to 25.767 s) and f398 to f402 (26.633 to 26.700 s).
- **What:** the cursor is drawn as a row of arrows on its way to the tabs pill and back.
- **Crop:** `crops/a3-10-cursor-strobe.jpg`
- **Cause and fix:** as act 1, A1-03.

### A3-06 · blocker · TI · the "vox" mention chip sits below the line
- **When:** L f612 to f719 (30.200 to 31.983 s); V the same beat.
- **What:** in kai's room message the "vox" chip sits about 15 px below "draft them from the merged changes."
- **Crop:** `crops/a3-12-mention-chip-room.jpg`
- **Cause and fix:** as act 1, A1-05 (the orb swap inside `.ui-mention`).

## Majors

### A3-07 · major · TI · the room's text is cut by the right edge of the frame (as boarded)
- **When:** L f612 to f719 (30.200 to 31.983 s), and into act 4's first frames.
- **What:** "draft them from the merge", "vox and kai worked it out, 2 mess", "The draft is in CHANGELOG.md" and "Read it.
  Tightened the fixes sec" are cut off. The board (`storyboard/board/b13.jpg`) has the same crop, but at full resolution it
  reads as a framing mistake, not a bleed.
- **Crop:** `crops/a3-04-room-text-cut-right.jpg`
- **Fix:** fit the room column in the frame (a narrower measure or a slightly wider shot), or, since the script says the room
  reads by its orbs and names here, draw the room's bodies as bars so nothing readable is cut.

### A3-08 · major · TI · call numbers cut by the left edge, and a model name wrapped
- **When:** L f150 to f316 (22.500 to 25.267 s).
- **What:** after the shift (A3-03) "You / 14:06" reads "ou / 4:06" and "GPT-6.2 Sol" is cut at the frame's left edge for
  about 2.5 s. From f232 the escalated line reads "GPT-6.2" / "Astra" on two lines, with no arrow.
- **Crop:** `crops/a3-07-callno-clipped-and-wrapped.jpg`
- **Fix:** keep the call-number column at least 60 px inside the frame; check the second line against the product (the
  lab's call numbers keep "→ model" on one line) and give the column the width it needs at 2.6x.

### A3-09 · major · TI · the call number's second line slides out in copies
- **When:** L. f230 to f234 (23.833 to 23.900 s).
- **What:** "→ GPT-6.2 Astra" and "4 steps" appear as three stacked copies while the line opens.
- **Crop:** `crops/a3-08-callno-slide-strobe.jpg`
- **Cause and fix:** the renderer's sampling; give the 16 f height animation enough samples.

### A3-10 · major · TI · text turns into bars by slicing words at readable size
- **When:** L. f332 to f344 (25.533 to 25.733 s).
- **What:** as the pull back starts, each line is eaten from its start by a growing grey bar, so the screen shows half-words
  ("s in src/billing", "he proration helpers", "olled back", "stra") while the text is still 30 px tall.
- **Crop:** `crops/a3-06-text-to-bars-midword.jpg`
- **Fix:** as act 2, A2-05: change text to bars only below about 12 px on screen, whole runs at once, under the move's
  blur, or morph runs into bars.

### A3-11 · major · TI · the thread's scrolls start at full speed
- **When:** L. f209 (23.483 s): 0 to 11.7 px/f in one frame; f273 (24.550 s): 0 to 22.7 px/f in one frame.
- **What:** each new row makes the whole log jump into motion with no acceleration, then decelerate; the eye reads a jolt.
  (Measured with a frame-to-frame motion track of the session.)
- **Fix:** move the log on the camera spring (critically damped from rest starts at zero velocity) or on travel; the
  product's `--ease` is for UI elements, not a camera-sized scroll.

### A3-12 · major · mixed · the desk shot is a black void with the dock cut in half
- **When:** L f420 to f464 (27.000 to 27.733 s).
- **What:** (TI) the nameless app's plate overlaps the dock and covers half of vox's orb; the board keeps the app clear of
  the orbs. (DS) the terminal is an empty black rectangle and the window is dark grey on dark, so the shot reads as murk.
- **Crop:** `crops/a3-09-desk-composition.jpg`
- **Fix:** place the app so it overlaps the window's corner, not the dock; give the terminal its prompt and header as
  boarded; in light, separate the three plates by value and shadow.

### A3-13 · major · TI · the act opens on a nearly empty frame
- **When:** L f0 to f60 (20.000 to 21.000 s); V f0 to f80.
- **What:** a composer at the bottom left and two thirds of the frame empty plate, with a 40 px strip of ground at the left
  edge; in 9:16 about 85% of the frame is empty.
- **Crop:** `crops/a3-11-act-open-empty.jpg`
- **Fix:** frame the session (composer plus the empty thread's top and the panel's edge) so the composer is the subject
  in a full composition; plates bleed past the frame edges.

### A3-14 · major · TI · the terminal is mostly empty
- **When:** L f470 to f719 (27.833 to 31.983 s).
- **What:** the terminal fills the left 55% of the frame but holds one line of 30 px mono at its top left while typing; at
  the end its lower half is still empty.
- **Crop:** `crops/a3-13-terminal-dead-space.jpg`
- **Fix:** frame the terminal tighter (its text larger, 40 to 48 px mono), or give its plate the height of its content.

## Minors

### A3-15 · minor · TI · a sliver of the request lingers at the top edge
- **When:** L. f276 to f316 (24.600 to 25.267 s).
- **What:** the bottom of "fix the proration drift in src/billing" sits cut at the top edge for 40 frames.
- **Fix:** scroll it fully out, or keep it fully in.

### A3-16 · minor · TI · slow crawl on text while typing
- **When:** L. f21 to f31 and f50 to f62 (20.35 to 21.03 s): the session moves 0.4 to 1.3 px/f.
- **What:** drift in the shimmer band (craft bible 5).
- **Fix:** as act 1, A1-22.

### A3-17 · minor · TI · the terminal and the room plate nearly touch
- **When:** L. f612 to f719.
- **What:** a 22 px gutter between the terminal's right edge and the room plate makes a tangent edge.
- **Fix:** overlap them with depth, or open the gap.

### A3-18 · minor · DS · the right panel reads as a soft seam in the ground
- **When:** L. f0 to f330 (20.0 to 25.5 s), at x about 1290 to 1300.
- **What:** the panel's ground differs from the session's by a level or two, so its edge reads as a faint vertical band
  through the frame rather than as a panel.
- **Fix:** in light, separate the panel by value and its hairline, as the product does.

---

## The premium gap (act 3)

1. **One camera.** The act moves plates instead of a camera (`acts/a3/rig.ts`), and it shows: nudges during holds (A3-03),
   scrolls that jolt (A3-11), a push that leaves the call numbers out of frame (A3-08). The references read as one continuous
   operator; key one camera path with the camera spring and let the plates stay put.
2. **Make the climb the event.** The failed test buying the next rung is the act's idea, but the ladder marker moves 70 px in
   a small panel at the edge of frame. Push in to the ladder for the climb (or move the line next to it), with the call
   number's update in sync on the same frame.
3. **Depth in the breath.** The slow move should feel like a dolly through layers (`ref1-hi27624` file cards, `linear-loops`):
   parallax between terminal, window and app, depth of field, a light that changes. Here it is three flat dark rectangles.
4. **The terminal as a hero.** Large mono type filling the plate, K2 typing with a soft edge, a caret at rest; then the run
   printing in the terminal and landing in the room with a visible link between them (a highlight that travels across).
5. **No empty frames on the drop.** The Enter cut (A3-04) is where the music drops; it needs the cleanest, most physical move
   in the act, not a dissolve.
