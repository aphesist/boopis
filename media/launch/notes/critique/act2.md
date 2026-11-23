# Act 2 critique (B05 to B08, 9.600 to 20.000 s)

Renders reviewed: `renders/a2-1080.mp4` (rendered 22 Nov 23:58) and `renders/a2-vertical.mp4` (23 Nov 00:43), 624
frames each. The file's frame 0 is film time 9.600 s, so frame `fN` is `9.600 + N/60` s; both are given.

How it was checked: stride 4 through the act with stride 1 to 2 and full-resolution crops at every event (kai's reply,
the line edit, nina's and moss's replies, the huddle gathering and its head line, typing, send, the fold, the pull back,
the tab change, the push into the composer); motion tracks of the thread; both seams diffed (S1 against act 1's last
frame, S2 against act 3's first). Crops are in `crops/`, relative to this file.

Tags: **TI** theme-independent, **DS** dark-specific. L = 16:9, V = 9:16.

Counts: **5 blockers, 5 majors, 4 minors.**

---

## Blockers

### A2-01 · blocker · TI · seam S1: the four head-stack faces pop at 9.600 s
- **When:** L (V the same construction). a1 f575 (9.583 s) to a2 f0 (9.600 s).
- **What:** on the act boundary every orb in the room's head stack changes face in one frame: kai from closed dashes to
  open pills, nina's, moss's and vox's eyes jump to a new gaze; the presence's running dot also jumps. In the joined film
  that is a one-frame twitch of the whole cast.
- **Crop:** `crops/a2-01-seam-s1-face-pop.jpg`
- **Cause:** act 2 rebuilds the stack orbs' poses at its start (`acts/a2/state.ts`, `a2.ts` `seamIn`) instead of
  continuing from the poses act 1 leaves at 9.600 (`acts/a1.ts` `seamOut` hands over the orbs, not their pose state).
- **Fix:** carry each orb's pose across the seam (read it at 9.600 from act 1's timeline and start act 2's tweens from it),
  and add a seam check: the last frame of act N and the first of act N+1 must match to within grain.

### A2-02 · blocker · TI · the huddle's head line scrambles word by word, then strobes away
- **When:** L and V. f302 to f314 (14.633 to 14.833 s).
- **What:** as kai joins, "nina and moss worked it out, 2 messages" turns into "nina, moss and kai worked it out, 3 messages"
  with every word sliding up or down on its own: words drop below the line, gaps open, the "2" rises like a superscript,
  "14:04" rolls through a clip. Before it settles, the thread scrolls up at about 30 px/f and every line doubles
  vertically (f309 to f314). The settled head line is never seen in this beat.
- **Crop:** `crops/a2-04-headline-word-scramble.jpg`
- **Cause:** the per-word edit of the head line (`acts/a2/beats.ts:299` onward, "the head line edits itself in place") and
  the scroll that follows it; the doubles are the renderer's two-sample shortcut and low sample count (act 1, A1-01 and
  A1-03).
- **Fix:** the product updates this line in place; do the same, or change only what changes ("and moss" to ", moss and kai",
  "2" to "3") as one masked swap carried by kai's orb arriving. Let it hold for at least 8 f before the scroll, and keep the
  scroll at or under 12 px/f on the camera spring.

### A2-03 · blocker · TI · kai's reply stutters out and leaves an empty room
- **When:** L and V. f190 to f200 (12.767 to 12.933 s).
- **What:** kai's reply scrolls up under the film line in sharp vertical copies, leaves a "14:02" stub for two frames, and
  then for three to four frames the thread is empty (only the presence orbs and the composer) before nina's reply lands.
- **Crop:** `crops/a2-02-reply-exit-stutter-empty.jpg`
- **Fix:** keep kai's reply on screen until nina's lands above the presence (the script's order), move the thread with the
  camera spring and enough samples, and never leave the log empty.

### A2-04 · blocker · TI · mention chips sit below the line (the owner's bug, again)
- **When:** L and V. kai's reply "Almost. @moss ... @nina ..." f8 to f190 (9.733 to 12.767 s); your request "@nina stage it
  next" f392 to f500 (16.133 to 17.933 s).
- **What:** "moss", "nina" and the request's "nina" sit about 15 to 18 px below the text's baseline, the same fault the owner
  showed in act 1.
- **Crop:** `crops/a2-10-chip-low-stage-it-next.jpg` (product comparison: `crops/a1-05-mention-chip-vs-product.jpg`)
- **Cause:** the orb swap inside `.ui-mention` (see A1-05). The storyboard's `b07.jpg` has the same drop, so it comes from the
  look's builders.
- **Fix:** A1-05's fix, in the shared builder, so every act inherits it.

### A2-05 · blocker · TI · the request bubble is chopped in half, then words are sliced into bars
- **When:** L and V. f500 to f506 (17.933 to 18.033 s).
- **What:** at f500 the left half of "nina stage it next" (the chip and the bubble's rounded end) disappears in one frame,
  leaving a bubble with a hard vertical edge. Then every line turns into grey bars behind a clip that eats each word from
  its start ("■na, ■oss ■nd ■ai ■orked it out", "■tage it next"), so for three frames the screen is half-words.
- **Crop:** `crops/a2-06-bubble-chopped-bars-midword.jpg`
- **Cause:** the text-to-bars change is a per-run wipe (`acts/a2/bars.ts:71-107`, `clipPath: inset(...)`), and the chip is a
  separate run hidden on its own.
- **Fix:** swap text for bars only when the text is too small to read (under about 12 px on screen), during the pull-back's
  fast part with motion blur, whole runs at once; or morph each run's box into its bar (scaling, not clipping). The chip
  and its bubble change together.

## Majors

### A2-06 · major · TI · the self-editing line reads as broken type
- **When:** L and V. f152 to f176 (12.133 to 12.533 s).
- **What:** "They hand work to each other" becomes "They work it out" by words leaving upward through an invisible clip
  (letters sliced at the cap line), the brass selection sitting empty for about eight frames, "work" sliding left into it
  in doubled copies, and "it out" rising through another clip.
- **Crop:** `crops/a2-03-self-edit-line.jpg`
- **Fix:** the craft bible's K5: the selection highlights "hand" (8 f), the replacement types in with K2, the selection
  clears; or a K1 exit and entry with blur. Nothing is cut by an edge no object explains, and the selection is never empty.

### A2-07 · major · TI · the huddle gathers in a pile-up
- **When:** L and V. f256 to f272 (13.867 to 14.133 s).
- **What:** nina's message doubles, her call number floats alone, the composer drops off the bottom with blur and the orbs
  fly in, all within a few frames and with no order to follow.
- **Crop:** `crops/a2-08-huddle-gather-chaos.jpg`
- **Fix:** the product's container resize (`--dur-3` on `--ease`) with the composer staying put, and the parts offset 2 to 4 f
  in reading order (craft bible part 3); render with enough samples.

### A2-08 · major · TI · the session pane is empty after the tab change
- **When:** L. f568 to f596 (19.067 to 19.533 s).
- **What:** after Session is clicked the room slides away and the main pane is an empty dark rectangle with only the
  composer for about half a second.
- **Crop:** `crops/a2-07-empty-session-pane.jpg`
- **Fix:** the script slides the session in with its own content (the billing-api session, steps as bars), or the camera
  pushes into the composer on the click.

### A2-09 · major · TI · the pull back and the cursor strobe
- **When:** L. f510 to f514 (18.100 to 18.167 s) the orbs and bars streak in copies; f538 to f546 (18.567 to 18.700 s) the
  cursor smears into copies on its way to the tabs pill.
- **Crop:** `crops/a2-09-pullback-and-cursor-strobe.jpg`
- **Cause:** too few samples (act 1, A1-03).
- **Fix:** the renderer's sample fix; the cursor on an arc at the script's 18 to 36 f.

### A2-10 · major · TI · 9:16 leaves the bottom of the frame empty for the whole act
- **When:** V f48 to f480 (10.4 to 17.6 s).
- **What:** the room sits in the upper half; the lower 40% of the frame is ground. The fold (f408 to f480) is a small entry in
  the middle of a mostly empty frame.
- **Crop:** `crops/a2-05-fold-underframed.jpg` (right tile)
- **Fix:** recompose for 9:16 (the craft bible: UI in the middle band at a larger relative size); for the fold, push in
  further than in 16:9.

## Minors

### A2-11 · minor · TI · the fold is shown as boarded, but small for the film's first proof
- **When:** L f396 to f500 (16.200 to 17.933 s).
- **What:** the label reaches the specified 44 px line height, but the folded entry sits in the upper left with the lower 45%
  of the frame empty. This matches the approved board (`storyboard/board/b07.jpg`), so it is a note for the revision, not
  an animation error.
- **Crop:** `crops/a2-05-fold-underframed.jpg` (left tile)
- **Fix:** frame the folded entry in the central third and drift toward it, so the moment is the frame.

### A2-12 · minor · TI · presence lines fade without moving
- **When:** L and V. f192 to f200, f312 to f320.
- **What:** "moss is in the terminal, nina is reading a file" and its successors fade in and out in place.
- **Fix:** the product's own presence reveal (`--dur-2`, 6 px rise) and its exit (`--dur-out`, a shrink).

### A2-13 · minor · TI · the thread's scrolls peak hard
- **When:** L. f300 to f323 (14.600 to 14.983 s) the log accelerates to 30 px/f in five frames and stops over ten.
- **What:** a sharp velocity spike that the eye reads as a jolt, and that strobes with the current samples.
- **Fix:** the camera spring (critically damped, zero start velocity), at most about 12 px/f for reading content.

### A2-14 · minor · DS · the window at establishing scale is murky
- **When:** L f516 to f560 (18.200 to 18.933 s).
- **What:** dark bars on dark plates; nothing in the window reads, not even the shape of the tabs pill until it is clicked.
- **Fix:** in light, keep one element (the tabs pill) at full contrast and the rest quiet.

Seam S2 (a2 f623 against a3 f0) matches to within grain.

---

## The premium gap (act 2)

1. **The moment needs to be the frame.** `claude-meetings` and `cursor-origin` give the hero line a centred, drifting
   close-up and hold it. The fold here is correct but small and off to one side (A2-11); move it to the centre and let the
   light and the drift make it the shot.
2. **One camera, never an empty log.** The references follow a thread with one spring and secondary motion on each arrival.
   Here replies leave before others arrive (A2-03), the session is empty after the tab change (A2-08), and scrolls spike
   (A2-13). Choreograph the log so something always arrives as something leaves.
3. **Edits that read as edits.** `claude-whiteboards` rewrites its line with a selection, a named cursor and a type-on. The
   self-edit (A2-06) and the head line (A2-02) slice letters with invisible masks; a typed edit would read in half the time.
4. **Product motion as the product does it.** The huddle gathering, the head line update and the presence entries all have
   real product animations (`--dur-3`, `--ease`, `--dur-2`); using them exactly would also remove most of the pile-ups.
