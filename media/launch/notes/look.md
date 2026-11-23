# boopis launch film: the look

The film's visual world, derived from the boopis brand (design/v6: `DESIGN.md`, `tokens.css`, `brand/logo/README.md`,
`design-system/DESIGN-SYSTEM.md` v1.1), not a new one. Read with `research/craft-bible.md` (the motion and editing rules)
and `research/truth.md` (what may be shown). Where this file and the craft bible differ, this file says why; the brand
wins.

The look is code in the repo: `media/launch/look/` (its stylesheet `src/film.css`, the theme `src/theme.ts`, the beat
builders `src/scenes/`), and the engine loads the same files (`src/engine/kit.ts`, `look.ts`, `ground.ts`,
`src/film.css`), so every act is in this look without carrying a colour of its own. The light style frames are in
`storyboard/light/`, with the contact sheet `storyboard/light/light-sheet.jpg`. How to run them is at the end.

---

## What changed on 23 November 2026, and why

The owner moved the film to the light theme ("the white theme ... goes with more people", decisions.md 6). This file
replaced the dark look ("the reading room after hours") with the light one below. What stayed: the beats, the script,
the end card (b), the cast, the type, the motion, the 9:16 rules and every brand rule. What changed:

- **The product UI is in its own light theme, exactly:** the Bone preset ("Light" in the app's presets), applied by the
  app's own theme module (`themeApi.preset('bone')`), so the kit's light-only rules (the sign-in buttons' black marks,
  the dock's inks) are the product's. Nothing is re-coloured by the film.
- **The ground is lit paper, not a dark room:** the light falls on warm paper and lifts it to card stock; the corners
  fall to the paper's shadow. A light frame has no black to hide a weak gradient in, so the grain is wider.
- **Shadows are the product's light shadow ink** (Bone's `rgba(40, 34, 26, ...)`), softer than the dark film's black,
  because black on paper reads as dirt. Plates get a hairline all round instead of a top highlight (a highlight
  vanishes on light).
- **Depth haze goes the other way:** far things go paler and greyer, toward the paper, never darker (darkening a light
  UI makes grey mud).
- **The dock stays black** (the owner's decision: black in every theme). It is now the one dark mass in the film.

After the critic's review of acts 1 to 4 (critique/summary.md, L1 to L6), the frame rules tightened: film lines take
their size from one token at the script's sizes (section 3); plates bleed past the frame (section 2); everything
readable sits whole inside a safe box, 9:16 included, and 9:16 uses its whole band (section 7); B16 is framed inside the
card with Deny and the hold button whole; B17's back is the light desktop. The key frames are rebuilt to these rules, so
an act that starts from them inherits them.

---

## 0. The world in one paragraph

**The reading room by day.** boopis's brand is the library card catalog: typed cards, a brass label holder on the drawer
you have open, a red due-date stamp when something is owed. The film is that room in daylight: the table is the
catalog's warm paper, one soft light lifts it to the white of fresh card stock where the subject sits, and the corners
settle into the paper's own shadow. On the table sit the bots, the only saturated things in the room, and the product's
own surfaces in its light theme, redrawn large. Brass is still only "you are here" and red is still only "you owe
something", so when either appears on screen it means exactly what it means in the app. The one black thing is the
dock. Nothing is decoration: the light, the grain and the depth are the only atmosphere.

---

## 1. Palette

Every colour on screen is a `tokens.css` token of the **Bone** preset, a `color-mix()` of one (R-colour-7), a bot's own
orb colour (bot data, R-colour-1), or a lab's mark as the app's light theme draws it. **The film adds no new colour.**

| Role in the film | Token | Value | Where |
|---|---|---|---|
| Card stock: the lamp's centre, raised things | `--bg-3` | `#fffdf8` | the pool centre; your request bubble, the composer, cast cards, the hold button |
| The table: the lamp's mid tone, the room plate | `--bg-2` | `#f4f0e8` | the pool's middle, the conversation plate |
| The frame: windows, the other app, the lamp's falloff | `--bg-1` | `#ebe6dc` | the pool's edge, `.win`, `.app2`, the terminal's strip |
| The far corners | `--bg-1` 70% + `--bg-4` | about `#e7e1d6` | every frame's corners; never a flat white anywhere |
| The terminal and wells | `--bg-0` | `#fbf9f4` | the terminal's body, the window's search field |
| Ink, strong: claims, names, the wordmark | `--text-strong` | `#0f0e0c` | film lines, bot names, `<boopis-logo>` |
| Ink: body | `--text` | `#23201c` | UI prose |
| Secondary | `--text-dim` | `#4e483f` | a role under a name, the huddle line |
| Meta | `--text-quiet` | `#5c564c` | mono times, state words, the platform line |
| **You are here** | `--brass` | `#8a6a2c` | the caret after the accent word, the active ladder station, the click ring |
| The accent word's selection | `--brass-soft` | brass 14% | the one word a line that carries the claim |
| **You owe something** | `--red`, `--red-text` | `#cf3a3f`, `#a82328` | the attention flag, the "needs you" stamp, the red lamp; nothing else |
| The selected fill | `--selected` / `--text-on-light` | `#23201c` / `#f6f2ea` | the segmented thumb, the hold fill, the cursor's body and edge |
| The dock | `--dock-bg` | `#000` | the dock slab only (black in every theme), with the dock's own inks |
| Shadow ink | Bone's `--shadow-pop` colour | `rgba(40, 34, 26, a)` | every shadow in the film; never black |
| The bots | their own colours | mint `#4fc9a8` (kai), rose `#f23b5a` (nina), green `#2fd26a` (moss), violet `#6d5cf0` (vox) | orbs and the small discs that stand for them out of focus |
| The labs' marks | as the light theme draws them | Claude `#D97757`; ChatGPT, GitHub and xAI black | inside a film line and on a plan line (section 6) |

**Contrast** (WCAG, measured on the resolved tokens): film lines `--text-strong` 19:1 on card stock and 14.8:1 in the
darkest corner; the accent word inside its selection 14.3:1; meta `--text-quiet` 7.2:1 on card stock and 5.6:1 in the
corners; the brass caret 4.4:1 on the table (it is a 4 px bar beside type, not text); `--red-text` 7.0:1.

Film-only uses of existing tokens, each justified:

1. **The lamp is the paper, brighter; never a colour.** The craft bible asks for a brass-tinted pool; brass may not be a
   large fill (R-colour-3) and must keep its one meaning, and on a light ground a brass or any tinted pool muddies the
   paper. The light is card stock (`--bg-3`) at the centre falling through the table (`--bg-2`) and the frame
   (`--bg-1`) to the corners.
2. **The red lamp, once.** In the needs-you moment the light warms toward red under the bot that needs you, and only
   there: `--lamp-red`, red 22% into card stock, of which the pool's centre takes 28% (a rose warmth of about 6%). It is
   the stamp rule applied to light.
3. **The accent is the selection.** Brass is never text (R-colour-3), so the craft bible's "one word in the accent
   colour" is the product's own text selection, `--brass-soft`, with the brass caret after it (K5 for free).
4. **Depth haze.** Things two layers behind focus are out of the light's reach, and on paper that reads as paler and
   greyer, never darker: `--haze: brightness(1.1) saturate(.72)` with the blur. One layer out: `--focus-pull:
   brightness(1.04) saturate(.88)`. A far window: `--far-dim: brightness(1.04) saturate(.9)`. A value change, never an
   opacity.
5. **The escalation's cooler light.** From the session to the terminal (B10 to B14) the light cools from the warm card
   stock toward the frame's neutral paper, `--lamp-cool` (`--bg-0`): the script's "cooler white".

No gradient text, no glow, no colour behind a logo, no lens light.

---

## 2. Ground and depth

**The stage is lit, not painted.** One soft light, overhead and a little in front of the subject; the light falls on the
table (a radial pool) and gives every plate a contact with the table (its shadow). Every value is a token on `:root`
(`look/src/film.css`, under `:root[data-film-theme="light"]`), so a scene or an act picks the light by name:

| the lamp | token | centre tone (light) | used for |
|---|---|---|---|
| orbs are the subject | `--lamp-orbs` | card stock, `--bg-3` | B01, B02, B17, the end card |
| UI is the subject | `--lamp-ui` | card stock lowered by 28% of `--bg-1`, so the plates stay the brightest surface | B03 to B09 |
| the cooler light | `--lamp-cool` | card stock with 28% of `--bg-0` (neutral, less warm) | B10 to B14 |
| needs you | `--lamp-red`, `--lamp-red-close` | card stock with about 6% rose | B15, B16 |

The pool's ramp: centre, then 55% centre into `--bg-2` at 22%, `--bg-2` at 46%, `--bg-1` at 74%, the far corner tone at
100%. **On the light ground the pool's centre always takes only 28% of its tint into card stock**
(`:root[data-film-theme="light"] .ground`), so a tint written for the dark film (`var(--bg-4)`, the old cool mix) cannot
darken the light's centre. The pool drifts 2 to 4% of the frame width over ten seconds and moves its centre on scene
changes, travelling with the camera.

**Grain: yes, wider.** Monochrome, 1 px, seeded noise (two-sample triangular, ±60 levels around mid-grey) blended
`soft-light` at 55% (`look/src/theme.ts` `GRAIN`; the dark film used ±46). Soft-light barely moves values near white,
so the light frame needs the wider noise for the same visible texture: on the table (`--bg-2`) it moves a pixel about
1.5 code values up and 2.7 down, which breaks the 8-bit steps of the ground's gradients (no banding in the encode,
checked at 4K). The renderer adds it to every finished frame (`tools/lib/grain.mjs`, the look's grain), so it lives;
it lies over everything, orbs and UI included, at the same strength.

**Three layers, one camera** (craft bible 6):

| layer | what | parallax | focus |
|---|---|---|---|
| ground | the light and its falloff | 0.25 to 0.3x the camera | always soft |
| stage | the plates, the orbs, the claim | 1x | sharp when it is the subject |
| foreground | the cursor, a flag, a chip that floats | 1.2 to 1.4x | sharp, or 2 to 6 px blur when passing |

- **Depth of field:** one layer from focus, 10 px blur plus the focus pull (B17's desktop goes to 24 px with
  `--focus-pull`); two layers, 14 to 18 px plus the haze (the team behind nina uses 9 px so their glances still read).
- **Plates bleed.** A plate the camera is inside (the room, the session, the panel) runs 12% past every frame edge it
  meets (`bleedPlate()` in `look/src/scenes/parts.ts`), so no camera state of an act shows its edge as a band; an edge
  inside the frame is a deliberate one (B13's room beside the terminal, the session's panel at x 1300). An act that
  pushes or drifts further than 12% widens the plate, never shows its edge.
- **Plates** (the product's surfaces): radius 30 at film scale, a 1 px hairline all round (`--plate-ring: inset 0 0 0
  1px var(--hair)`), and Bone's `--shadow-pop` scaled to the film and softened: `--plate-shadow: 0 36px 90px rgba(40,
  34, 26, .13), 0 3px 9px rgba(40, 34, 26, .09)`. Cards: `--card-shadow: 0 24px 60px rgba(40, 34, 26, .11), 0 2px 6px
  rgba(40, 34, 26, .08)`. The dock slab: `--slab-shadow: 0 -16px 64px rgba(40, 34, 26, .16)`. Raised on raised is
  still banned (R-colour-4).
- **Orbs** cast a contact shadow on the table: an ellipse 0.78 of the orb's width by 0.13, 0.15 widths below it, in two
  layers so it reads as contact and not as a smudge: a core of `--contact` (`rgba(40, 34, 26, .30)`) falling to a
  penumbra of `--contact-soft` (`.09`) at 62% and to nothing at the edge. The gap under the orb is deliberate: orbs
  float, and the gap says so even in a still.
- UI faces the camera. A tilt (5 to 15 degrees) only while moving between states, never at rest on text.

---

## 3. Type

**The brand's two faces, nothing else.** Libre Franklin (400, 500, 600) for everything people read; IBM Plex Mono
(400, 500) for times, state words, model and lab names, and the platform line. **600 is the heaviest weight in the
film** (the wordmark's weight). Film lines are `--text-strong` on the light ground; secondary lines `--text-dim`, meta
`--text-quiet`.

**The film scale at 1080p.** Nothing is set under 28 px. The smallest text in the light style frames is 28 px (the
product's 11 px mono at 2.6x); `render.mjs --check` measures every frame.

**A film line's size is a token, never a number in a builder** (`look/src/film.css`, `filmLine()` takes no size):
`--film-line-size` 88 px and `--film-hook-size` 96 px in 16:9 (the script's 84 to 96, B01 at its 96), tracking
`--film-line-track` -1.5% (the script's). In 9:16 a line is 92 px and the hook 90: the cut-downs ask 104 to 110, but a
centred line must stay inside the 840 px between the platforms' rails, and the longest two-line breaks ("you already pay
for", "Claude and GPT" with its two marks) are that wide at 92 and 90. A line too long even so breaks into three by sense
("Same thread, / from your / other apps", as the 16:9 right column already sets it). An act that pushes the camera onto
a line keeps it at or under 96 px on screen (16:9).

| role | 16:9 size / leading | weight | tracking | 9:16 | use |
|---|---|---|---|---|---|
| hero word (K3) | 400 / 0.86 | 600 | -4.5% | 300 | one word, at most twice in the film |
| the hook | `--film-hook-size`, 96 / 1.06 | 600 | -1.5% | 90 | B01 |
| a film line | `--film-line-size`, 88 / 1.06 | 600 | -1.5% | 92 | every other film line |
| second line, a cast name | 52 / 1.16 | 500 (names 600) | -1.2% | 46 to 60 | the end card's tagline |
| label anchored to an object | 40 / 1.2 | 500 | -0.6% | 38 | roles under orbs, the platform line |
| UI text, product size times its scale | 28 to 58 | the product's | the product's | same | everything inside `.ui-film` |

- **Setting:** sentence case; "boopis" always lowercase, plain type inside a line, the wordmark only at the end; no full
  stop on a headline; line breaks by sense; `text-wrap: balance` on claims.
- **How a claim sits:** centred when it is the frame; aligned to the left edge of the UI it speaks for when they share
  a frame; a label within 24 to 80 px of its object.
- **The accent:** one word or phrase a line, held in the product's text selection (`--brass-soft`, cap height to
  descender) with the brass caret after it (Bone's brass, darker than the dark film's, so the caret holds on paper).
  It is the verb or the claim ("Same", "cheaper", "team"), never "boopis", never a lab's name.
- **Entrances** (craft bible 5): K1 for claims, K2 for anything typed in the product, K3 at most twice, K5 for the end
  line.

---

## 4. The orbs at hero scale

The bots are drawn with the product's own `<orb-avatar>` (orb2), at their final size; inside zoomed UI the film redraws
every orb at the zoomed size and zooms it back (`sharpenOrbs`). In the engine, `swapOrbs` replaces each with a film orb
in the orb's own box (its display, position and alignment as the kit's CSS computed them).

- **Against light:** the bodies are mid-saturated colours with crisp edges; no outline is added (the product draws
  none). Their eyes stay the product's dark ink; none of the four bodies is dark, so none takes light eyes (R-orb-7).
  The contact shadow, not an outline, separates them from the paper.
- **Sizes on screen:** 260 to 300 px as a cast, 360 beside UI, 540 for a close-up, 120 to 150 out of focus, and the
  product's own sizes times the UI scale inside the UI.
- **The cast is four** (`script/cast.md`): kai, a mint circle (docs and changelog, the room's lead, Claude); nina, a rose
  triangle (deploys, ChatGPT; her eyes become the wordmark); moss, a green squircle (flaky test hunter, GitHub
  Copilot); vox, a violet circle (release notes, SuperGrok). No other bot appears; the film never recolours an orb.
- **The eyes belong to the state** (R-orb-1): idle, listening, thinking, working, compute, speaking, happy and done,
  needs (plus the flag), asleep, picked for what the bot is doing in the story.
- **Glances carry the story:** 16 to 24 degrees of yaw makes two bots look at each other; never past 30.
- **The eyes are the film's atom:** the logo's eyes are the orbs' idle eyes, so nina's eyes become the wordmark's "oo"
  by a true morph. On the light end card the wordmark is `--text-strong`, near-black like the eye ink, so the morph
  keeps one ink all the way.
- **The needs-you red:** the bot keeps its own colour and turns to you; the product's attention flag sits at its top
  right, scaled with it, its ring a true cut through her body to the paper (a mask), so on a light ground the ring is
  the ground's own colour; the stamp says "needs you" beside her name; the light warms under her.

---

## 5. Rebuilding the UI for film

**Never record the UI; draw it with the product's own components, one at a time, large, in the product's light theme.**
Every frame mounts the real kit (`@boopis/ui`, `kit.css`, `bots.css`, `huddle.ts`, `dock.css`) inside a box with CSS
`zoom`. Only the strings are the film's. **Every piece of product UI keeps the product's layout exactly:** its
baselines, padding and alignment come from the product's CSS, and the film adds only placement and scale.

| component | kit call | film scale | frame |
|---|---|---|---|
| a room entry, mention chips inline | `ui.html.entry`, `.bt-to`, `ui.markdown.html` | 2.6 to 3x | B04 to B07, B13 |
| your request | `ui.html.entry` (user), `.ui-request` | 3x | B04 |
| the room's head | the product's `.bt-presence.bt-ghead` (its grid: the name on the margin's edge, over the entries' bodies) | 3x | B04 |
| presence | `ui.presence` (its clock drawn as a short bar) | 3x | B04, B05 |
| the huddle | `huddleEntry`, `huddleMessage` | 2.6 to 3x | B06, B13 |
| the composer | `ui.composer` (room placeholder and member chips; the session's Governed chip; the mic never pressed) | 2.6 to 3x | B04 to B10 |
| governance | `ui.html.section` with `ui.html.ladder` (list) | 2.6x | B10 |
| the dock session | the dock's own view (`dock/views.ts` markup, `dock.css`): its card head, log, ask and composer | 2.6x | B14, B15 (`b14-dock`, `b15-dock`) |
| the approval card | the card layer's markup (approval, compact, on the dock's ground) | 2.6x | B15 |
| hold to approve | `ui.html.hold`, its dot field in the product's own fx slot | 3.4x and the close-up | B15, B16 |

Rules for every rebuild:

- **One component per shot,** alone on the ground or with the plate it lives on.
- **The text floor sets the scale:** the product's smallest text is 11 px mono, so a component whose small text must be
  read is drawn at 2.6x or more; at 2x every line under 14 px becomes a bar.
- **Secondary lines become bars** (`--text` at 10%); avatars out of focus become discs; icons stay icons.
- **A product surface whose ground is the room's** (the room's head, whose ground is `--bg-2`) is clear in the film, so
  it does not show as a box on the lit plate: in the app it is invisible for the same reason.
- **The 9:16 column is a narrow window:** the product's own narrow rules apply there (`[data-margin="off"]`, and the
  head's buttons on a row of their own, the app's rule under 640 px), because the film's viewport is never narrow.
- **The product's motion is the truth;** the film moves the camera and type, never the product's own motion.
- **A window** is boopis's own (`--bg-1` frame, Linux and Windows controls); **the terminal** is a plain light plate
  (`--bg-0` body, a `--bg-1` strip, no title, no controls); **the other app** is a plain `--bg-1` plate with a message
  list and one field. Never macOS chrome.
- **Never on screen:** the app's mock content, a voice or mic moment, any statistic, feedforward, anything named after
  what boopis is built from or the owner's other work.

---

## 6. Brand marks

**The boopis logo** (`<boopis-logo>`): one colour, `--text-strong`, on an even field (the end card's light opens wide,
`--lamp-orbs` at 130% x 140%); the protection area is 0.28 of the type size; playful letters at the end card only; one
logo moves per screen.

**The end card is variant (b)** (decisions.md 2): the wordmark, "Your AI plans, on one team" as its own line well below
it (outside the protection area, 52 px, `--text`), and "For Linux, and early on Windows" (40 px, `--text-quiet`). No
address and no handle anywhere; the URL variant is gone from the look.

**The AI labs' marks:** in a film line and on a plan line, the labs' own files as the app's sign-in buttons draw them in
the light theme: Claude keeps `#D97757`, ChatGPT, GitHub and xAI are black (the kit's light-theme rule). Beside a
model's name inside the UI, the kit's mono model marks in the text's ink. Never recoloured, stretched or morphed.

---

## 7. The frame: safe areas, crops and 9:16

**What must be read sits inside the safe box, whole.** 16:9: x 60 to 1860, y 60 to 1020; a film line at the top of the
frame has its box at y 84 or lower (cap top about 100 px down, inside title safe). 9:16: x 60 to 960 (clear of the
platforms' right rail) and y 220 to 1640 (clear of their top and bottom chrome); a film line from y 240. No readable line
is ever cut by the frame's edge: a UI column that is wider than the frame takes the product's narrow layout or a
narrower measure (B13's room), and a conversation longer than its view is scrolled as the product scrolls it, its
leading entries leaving the view whole (B10, B13 in 9:16), never cut by an edge. Out-of-focus text behind a blur is not
read and may cross an edge. `render.mjs --check` fails a frame on any of this, and on an inline chip off the product's
baseline.

**9:16: recompose, never crop, and use the whole band.** The readable band is y 220 to 1640; its centre is y 930.

1. **The claim in the upper band** (from y 240, two lines, three at most), the subject below it.
2. **The frame's weight sits on the band's centre:** the subject's mass is centred within about 100 px of y 930, and the
   lowest thing that matters reaches y 1450 or lower, unless the frame is one centred object (the hold, the end card),
   which sits on y 930 itself.
3. **A short subject grows or moves down, never leaves the lower band empty:** orbs larger (360 where 16:9 has 260),
   the sign-in column at 2.6x centred on y 1150, the cast cards taller and lower, the composer pinned at the band's foot
   (its bottom about y 1620), the Governance section pinned at the foot under a session, the other app under the dock
   with its foot on y 1640.
4. **UI columns span the safe band**, x 60 to 960 (346 real px at 2.6x), in the product's narrow layout; the dock is 346
   wide; nothing that must be read reaches past x 960.
5. Orbs face each other across the width, never stacked; whips run vertically.

---

## 8. The motion feel, in words

Unchanged by the light theme: cards set down on felt (arrive), quint in-out for travel, snap with a 180 degree shutter
for the fast cuts, a critically damped camera, springs only in the characters, nothing cross-fades, overlap always.
Motion blur is smooth or off: a double image or a strobe is a hard failure (decisions.md 7).

---

## 9. The light style frames

Rendered by the look's own builders (the same ones the engine's acts load) at 3840 x 2160 (16:9) and 2160 x 3840
(9:16), in `storyboard/light/`; contact sheet `storyboard/light/light-sheet.jpg`.

| file | what it proves |
|---|---|
| `B01-thumbnail` | The thumbnail on paper: "Claude and GPT / Same group chat" in `--text-strong`, the marks as the light theme draws them, "Same" in the brass selection, kai and nina on the lit table with two-layer contact shadows. |
| `B01-thumbnail-9x16` | The same, recomposed for 9:16. |
| `B03-cast-cards` | The four plans as cast cards on card stock with the card shadow, each with its lab's mark and subscription in mono. |
| `B04-room-request` | The room in Bone: the product's head layout (name over the entries' bodies), your request with the mention chip on the text's line, kai thinking, the composer and its chips. |
| `B10-ladder` | Your session governed: the cooler light, the answer scrolled as the product scrolls it (your request has left the view, whole), the Governance section with the Sol and Astra ladder, "The cheaper one tries first", the composer pinned inside the safe box. |
| `B13-room-terminal` | The light terminal and the room side by side, the room in the product's narrow layout so every line is whole: the same run in both. |
| `B17-team` | nina in front, the light desktop behind at 24 px with the focus pull (paler, not darker; its black dock below the frame, so nothing dark blurs behind her), "Your AI plans, on one team". |
| `B19-end-card`, `B19-end-card-9x16` | The end card, variant (b), on an even field of card stock. |

---

## 10. Running the frames

From the repository root (the worktree):

```sh
apps/desktop/ui/node_modules/.bin/vite --config media/launch/look/vite.config.mjs          # browse: /board/<beat>.html
node media/launch/look/render.mjs --dir board --check                  # 1x, with the 28 px check
node media/launch/look/render.mjs --dir board --scale 2 --out <dir> b01 b01-vertical b03 b04 b10 b13 b17 b19b b19b-vertical
```

Add `?theme=dark` to a page to see the old dark look (the Card catalog preset) for comparison; nothing else may pick
it. In the engine, `node tools/render.mjs --scene board --query beat=b04 --still 0 --samples 1` renders a key frame
through the engine's camera, ground and film orbs.
