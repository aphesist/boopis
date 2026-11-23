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

Numbers re-measured on the rebuilt key frames (light look, ec9ed6f5), 23 November 2026.

- **Frame state:** B09's key frame **before the request types**: your session at 2.6x, its thread empty, the composer
  empty with the Governed chip on, the session plate bleeding past the frame (16:9: its right edge at x 1300, the only
  edge in the frame). The right panel, its Governance section and the film line are not on screen yet.
- **A2 lands:** B08's pull back to the window (86% of the width), the cursor's click on Session in the tabs pill at
  +2.5 (the thumb slides at `--dur-slide` on `--spring`, the room slides 48 px left as the session slides in), the
  composer's morph (member chips fold away, Governed arrives, `--dur-3`), then the push into the session, landing the
  composer on its rect below on 20.000: the composer is the carried object, never redrawn.
- **A3 starts:** the request types into that composer (30 cps, no underlines); send at +2.5; the answer and the
  Governance section (it slides in from the right edge) follow.
- **The lamp on 20.000:** B09's own light, `--lamp-ui`, centred at 0.40, 0.50 of the frame and 0.90 x 0.96 of it
  (9:16: 0.50, 0.50, 0.90 x 0.96), on the look's ground. A3 starts from whatever the ground holds on 20.000 (it reads
  it from the timeline), so this is where A2 should leave it.

| handle (`ctx.carry.composer.*`) | what | 16:9 rect | 9:16 rect | zoom | radius, fill |
|---|---|---|---|---|---|
| `el` | the session composer, empty, Governed on | [80, 810, 1196, 220] | [60, 1400, 900, 220] (see note) | 2.6 | 52, `--bg-3` |
| `session` | the session plate (`.plate--room`, bled with `bleedPlate()`); the thread above the composer is empty | [-230, -130, 1530, 1340] | [-130, -230, 1340, 2380] | | 30 |

Note: B09's 9:16 key frame has no composer in view (its Governance section is pinned at the band's foot,
[60, 1349, 900, 291]). The 9:16 composer rect above follows look.md 7.3: the composer pinned at the band's foot (its
bottom about y 1620), across the safe column (x 60 to 960, 346 real px at 2.6x). After the send A3 lets it leave below
the band and slides the Governance section into its place.

## S3: A3 to A4 at 32.000 s (B13 to B14, bar 16.1)

Numbers re-measured on the rebuilt key frames (light look, ec9ed6f5), 23 November 2026.

- **Frame state:** B13's key frame: the run printed and done in the terminal ("-- done: the bots stopped handing off
  after 3 rounds", the prompt back), and the same messages landed in the open room beside it (16:9) or under it (9:16),
  vox's and kai's gathered into the live huddle "vox and kai worked it out, 2 messages". The room is the product's
  narrow layout (each call number folded above its message), scrolled to its end, so every line is whole in the frame.
- **A3 lands:** the widened framing of terminal and room, each block landing on a half-beat in both, the done line at
  +2.5; everything at rest on these rects by 32.000.
- **A4 starts:** holds half a beat, then from +0.5 the camera glides right and down to the dock and the nameless app
  on the camera spring; a click on nina's orb in the dock opens her session (the slab's outline morphs up on its
  springs, the orb travels to the session head). The dock and the app wait off-frame in the world; A4 owns where.
- **The lamp on 32.000:** `--lamp-cool`, centred at 0.50, 0.50 of the frame, 0.90 x 0.96 of it (both formats), on
  the look's ground (lookGround's box spans 1.8 frames: 50%, 50%, 50%, 53.33% of it).
- **Drawn until A4 lets go:** from 32.000 A3 draws its elements only while `desk.terminal` is visible (A4 hides the desk
  once its glide has taken it out of the frame); A3's root then stops drawing, so nothing of A3 outlives the desk.

| handle (`ctx.carry.desk.*`) | what | 16:9 rect | 9:16 rect | radius, fill |
|---|---|---|---|---|
| `terminal` | the terminal plate (`.term`, the look's 28 px mono) | [0, 110, 1040, 860] | [30, 230, 1020, 544] | 18, `--bg-0` |
| `window` | the open room's plate (`.plate--room`): 16:9 its left edge in the frame, bleeding top, right and bottom; 9:16 its top edge in the frame, bleeding the rest | [1060, -130, 1090, 1340] | [-130, 814, 1340, 1336] | 30 |
| (the room's log) | inside `window`: the narrow layout at 2.6x, scrolled to its end in a view from y 60 to 1020 (9:16: 854 to 1640) | x 1100, width 292 real (759 px) | x 60, width 346 real (900 px) | |
| `app`, `dock` | the nameless app and the dock: off-frame (16:9 right and below; 9:16 below) | A4's | A4's | |

`desk.window` sits in A3's window group (a plate whose CSS transform places it: at 32.000 a translation and scale 1):
read its rect with `getBoundingClientRect()`, not from its left and top.

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
