# The act seams: the contract between the four act animators

The film is one stage and one timeline (`src/scenes/film.ts`), built by four act builders in order:

| Act | Builder | Beats | Time (bar.beat) |
|---|---|---|---|
| A1 | `src/acts/a1.ts` | B01 to B04 | 0.000 to 9.600 (1.1 to 5.3) |
| A2 | `src/acts/a2.ts` | B05 to B08 | 9.600 to 20.000 (5.3 to 10.2.5) |
| A3 | `src/acts/a3.ts` | B09 to B13 | 20.000 to 32.000 (10.2.5 to 16.1) |
| A4 | `src/acts/a4.ts` | B14 to B19, end card (b) | 32.000 to 46.933 (16.1 to 23.1) |

**The rule.** At each seam the outgoing act lands its carry into the exact state below **on the seam's frame**, and
the incoming act starts from it. The state is the named key frame's composition (the art director's builder in
`look/src/scenes/`), laid out at world (0, 0) on the stage layer, with the camera **at rest**. The numbers live in
`src/acts/seams.ts` (`SEAMS`); both acts import them instead of typing them. Rects are `[x, y, w, h]` in 1080p px; a
kit component's on-screen radius is its kit radius times its zoom.

Shared rules at every seam:
- **Camera:** at rest, `{ x: 960, y: 540, zoom: 1, roll: 0 }` (9:16: `{ x: 540, y: 960 }`). The outgoing act's last
  camera move lands on the seam frame (on the camera spring or `travel`, never still for more than 1.5 s before it);
  the incoming act's first camera move starts on or after it. Nobody moves the camera across a seam in one tween.
- **Carry:** the outgoing act sets `ctx.carry.<handle>` (`src/acts/context.ts`) to the DOM it carries; the incoming act
  takes it with `await ctx.take('<handle>', build)`, where `build` makes the same state itself when the act is rendered
  alone (`?scene=a2`). The same element object crosses in the master, so there is no cut.
- **Nothing fades** at a seam, and nothing is still across it for more than 1.5 s counting both sides: the outgoing
  act's last motion and the incoming act's first are each within 0.75 s of the seam unless one of them carries a
  drift (`cam.drift`) through it.
- **Orbs** are film orbs (`ctx.carry.orbs`, by bot name: kai, nina, moss, vox); a pose that crosses a seam (eyes, gaze)
  is the outgoing act's last pose and the incoming act's first.
- **Seams are not hard cuts:** no `film.cut()` at a seam time (sub-frames blur across it). (Today's placeholder does
  cut there: it swaps key frames.)

## S1: A1 to A2 at 9.600 s (B04 to B05, bar 5.3)

- **Frame state:** B04's key frame. You sent "@kai is it ready to cut?" (You 14:02); the presence entry "kai thinking"
  has risen under it; the room composer holds its four member chips; the cursor rests just off the send button.
- **A1 lands:** the room assembled (head from B03's orbs, the composer risen, the line typed and lifted into the
  thread, the presence risen at `--dur-2`, 6 px) into exactly these rects on 9.600.
- **A2 starts:** kai's reply takes the presence entry's place, landing whole (blocks rise 6 px in turn); the camera
  follows the thread down on the camera spring (5 f lag) and the head leaves the top.

| handle (`ctx.carry.room.*`) | what | 16:9 rect | 9:16 rect | zoom | radius, fill |
|---|---|---|---|---|---|
| `group` | the room plate (`.plate--room`) | [40, -80, 1840, 1240] | [-40, 120, 1160, 1580] | | 30 |
| `head` | the head: stack, "release", members, actions | [130, 64, 1668, 288] | [60, 250, 962, 250] | 3 / 2.6 | |
| `thread` | your request and the presence entry | [130, 340, 1668, 359] | [60, 520, 962, 368] | 3 / 2.6 | |
| `presence` | "kai thinking" (orb 60 px at [130, 585]; 9:16 52 px at [60, 789]) | [130, 576, 1668, 123] | [60, 781, 962, 106] | 3 / 2.6 | |
| `composer` | the room composer, four member chips | [130, 740, 1668, 254] | [60, 1330, 962, 220] | 3 / 2.6 | 60 / 52, `--bg-3` |

Foreground: the cursor (48 px) with its tip at [1810, 956] (9:16 [1036, 1515]); A1 parks it, A2 takes it away
(leaves frame on `depart`) or uses it.

## S2: A2 to A3 at 20.000 s (B08 to B09, bar 10.2.5)

- **Frame state:** B09's key frame **before the request types**: your session at 2.6x, its thread empty, the composer
  empty with the Governed chip on. The right panel and the film line are not on screen yet.
- **A2 lands:** B08's pull back to the window (86% of the width), the cursor's click on Session in the tabs pill at
  +2.5 (the thumb slides at `--dur-slide` on `--spring`, the room slides 48 px left as the session slides in), the
  composer's morph (member chips fold away, Governed arrives, `--dur-3`), then the push into the session, landing the
  composer on its rect below on 20.000: the composer is the carried object, never redrawn.
- **A3 starts:** the request types into that composer (30 cps, no underlines); send at +2.5; the answer and the
  Governance section (it slides in from the right edge) follow.

| handle (`ctx.carry.composer.*`) | what | 16:9 rect | 9:16 rect | zoom | radius, fill |
|---|---|---|---|---|---|
| `el` | the session composer, empty, Governed on | [80, 790, 1196, 220] | [50, 1330, 936, 220] (see note) | 2.6 | 52, `--bg-3` |
| `session` | the session plate / column, empty | [40, -80, 1260, 1240] | [50, 600, 936, 464] | 2.6 | 30 |

Note: B09's 9:16 key frame has no composer in view. Until the art director boards it, the 9:16 composer rect above
(936 px wide under the column, its top at y 1330, inside the band) is the contract.

## S3: A3 to A4 at 32.000 s (B13 to B14, bar 16.1)

- **Frame state:** B13's key frame: the run printed and done in the terminal ("-- done: the bots stopped handing off
  after 3 rounds", the prompt back), and the same messages landed in the open room beside it, vox's and kai's
  gathered into the live huddle "vox and kai worked it out, 2 messages".
- **A3 lands:** the widened framing of terminal and room (B13 +0, travel 24 f), each block landing on a half-beat in
  both, the done line at +2.5; everything at rest on these rects by 32.000.
- **A4 starts:** holds half a beat, then from +0.5 the camera glides right and down to the dock and the nameless app
  on the camera spring; a click on nina's orb in the dock opens her session (the slab's outline morphs up on its
  springs, the orb travels to the session head). The dock and the app wait off-frame in the world; A4 owns where.

| handle (`ctx.carry.desk.*`) | what | 16:9 rect | 9:16 rect | radius, fill |
|---|---|---|---|---|
| `terminal` | the terminal plate (`.term`) | [-24, 110, 1004, 860] | [30, 230, 1020, 720] | 18, `--bg-0` |
| `window` | the open room (`.plate--room`), its thread at 2.6x | [1000, -60, 1000, 1200] | [30, 1000, 1100, 1000] | 30 |
| `app`, `dock` | the nameless app and the dock: off-frame (16:9 right and below; 9:16 below) | A4's | A4's | |

## What exists today (the placeholder)

Every beat is a placeholder: its key frame held for the beat's window (`src/acts/placeholder.ts`, `hold('B07')`), which
makes the animatic (`SC/renders/animatic.mp4`). The placeholder hands over the key-frame boxes as the handles above
(A1 sets `room.group` to B04's box, A3 sets `desk` to B13's). An act animator replaces a beat's `hold()` with its own
builder, one beat at a time, writing at `ctx.win('B07')` times, and replaces the handles with the real carried DOM.

## Cut-downs

The 15 s cut and the 6 s bumper (`?scene=cut15`, `?scene=bumper6`) run the same beat builders under their own edits
(`src/acts/edit.ts`, from `SC/script/cutdowns.md`, end card (b)): a builder that reads `ctx.win(id)` (and its `dur`)
instead of absolute times plays in a cut unchanged or compressed. Seams inside a cut are the cut's own (they follow
cutdowns.md's "carry out" column); the master's S1 to S3 do not apply there.
