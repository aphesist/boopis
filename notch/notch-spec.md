# boopis notch for macOS: design spec

For boopis 0.2.0. Design only: what each state is, how it behaves, what it reads. Nothing here touches the boopis repositories.

How to look at it:
- `prototype/index.html` is the interactive prototype. It works offline: open it in a browser, use the scene buttons and the option menus at the bottom right, ⌥Space or the backquote key to open the notch, ← → to switch bots, type to write, Esc to step back. Add `?display=ext` for a display without a notch, and `&live=1` for a minute of a working day.
- `stills/` holds one 2x still per state, `motion/` the 60 fps previews, `contact-sheet.jpg` every state on one page, `diagram/state-diagram.jpg` the states and transitions.
- `prototype/settings.html` is the boopis Settings page for the notch.

Built from: boopis's tokens (`tokens.css` copied unchanged) on the dock ground (`[data-ground="dock"]`), the kit's controls (button, hold, send, segmented, stamp, page dots, mention capsule, "you" capsule), boopis's icon set, boopis's mark, and orb2's own renderer (`vendor/orb-avatar.min.js`, the build boopis vendors). The owner's island round 4 sets the behaviour; grokbot-notch sets the interaction model (a pouch under the notch, ⌥Space, ← →, type to write).

---

## 1. Principles

1. **Idle is the Mac's own notch.** When every bot is idle, asleep or just done, nothing is drawn: no glyph, no dot, no pill. The notch appears only while a bot works, needs you or has failed (the owner's rule from round 4).
2. **One shape, grown out of the hardware.** Everything is one black path that starts as the hardware notch. It is the dock's slab (`slabPath`) turned upside down: concave flares out of the screen's top edge and continuous corners at the bottom, both `--r-l` (30) when open, a pill with round ends when collapsed, exactly as the dock and its minimised pill. It never appears beside the notch; it widens and deepens from it. The two share the black, the flare, the corner and the spring.
3. **One spring.** Width, height, corner and ear follow one critically damped spring (k 480, the dock's `K_SLAB`, about 300 ms to settle, no overshoot). Content fades in as the shape makes room for it; it never pops.
4. **Red only when you owe something.** An approval, a message addressed to you, a failed run. Red is a dot, a stamp, a word and the shape's own edge. Nothing else is red.
5. **Nothing invented.** Every word comes from the Local API or from what the notch saw itself (it records the tool steps of a turn it watched). No fake progress, no placeholder replies, no "from the notch" label: one thread.

---

## 2. Geometry

Points throughout (1 pt = 2 px on these displays). The notch's real size is read at runtime, never hard-coded.

| Display | Screen (default scaling) | Band height (menu bar) | Notch width |
|---|---|---|---|
| MacBook Pro 14" | 1512 × 982 | 32 | about 185 |
| MacBook Pro 16" | 1728 × 1117 | 32 | about 185 |
| MacBook Air 13" / 15" | 1470 × 956 / 1710 × 1107 | 32 | about 180 to 190 |
| Larger scaled resolutions | | up to about 37 to 38 | follows the panel |
| A display without a notch | any | menu bar, 24 | none: a black pill |

- **Band** = `NSScreen.safeAreaInsets.top` on a notch display, the menu bar's height on another. Everything in the band is centred on its height.
- **Notch rect** = the gap between `auxiliaryTopLeftArea` and `auxiliaryTopRightArea`. The prototype draws the 14" Pro: 185 × 32, bottom radius 10, ears 6.
- **Wings**: the band left and right of the notch, `(view width − notch width) / 2` each. Nothing is ever drawn over the notch itself.

| Shape | Width | Height | Corners and flares | Notes |
|---|---|---|---|---|
| Rest | the notch | the band | the hardware's | nothing drawn; the panel is ordered out |
| Wings, compact | notch + 2 × 40 | band | a pill: round ends, flares of half the band (the dock's minimised pill) | orb 20 (16 without a notch) at the round end, a number or two orbs at the other |
| Wings with words | notch + 2 × 112 | band | a pill, as above | orb and name left, the state words right |
| Hover card, cards, approval, offline, first run | 340 to 420 | content | `--r-l` (30), flares `--r-l` | the band is the byline |
| Stage, thread, rooms, room | 420 | content, the thread and room logs capped at 340 / 380 | `--r-l` (30), flares `--r-l` | the dock's |
| No notch, wings | 2 × 30 | 24 | a pill (12) | hung from the top centre |

The shape's radius and flare both come from `--r-l`, clamped as the dock's `slabCorner` clamps them (the radius at most half the height and half the width, the flare at most the height less the radius), so a 32 pt band is a pill and an open view is the slab. Only a pill is drawn with round ends; the smoothing eases from 0 to 0.6 as the shape leaves the pill, so a morph never steps.

### 2.1 Corners (DESIGN-SYSTEM.md section 8, exactly)

- **One family.** The shape and every surface inside it are the kit's continuous corner: `squircle-path.ts` (Figma's smoothing, ξ 0.6, a 36° arc between two cubics, running 1.6R along each edge), drawn as `squircle.ts` draws it. Containers are frames (the fill and the 1 pt line on a band inside the path, nothing clipped); a leaf whose content fills it (hold to approve) is clipped. A corner as round as half its element stays a native capsule or circle.
- **Concentric.** A piece within a container's radius of a corner takes `max(--r-floor, R − inset)` with the inset equal on both sides of that corner; a control too small to be that round moves in until its curve shares the corner's centre (`corners.ts`: inset = R − radius). Nested twice is concentric twice. The containers declare `--r-outer` and `--pad`; `--r-in`, `--r-corner` and `--corner-inset` are the kit's formulas (`CORNER_CSS`).

| Piece | Container | Inset (both sides) | Radius |
|---|---|---|---|
| Composer (thread, room, a card's reply field) | the shape, 30 | 12 (`--pad-dock`) | 18 = 30 − 12 (`--r-in-dock`) |
| Send, in that composer | the composer, 18 | 6 (`--composer-pad`) | 12 = 18 − 6 |
| A 28 pt button or hold in the shape's foot corner | the shape, 30 | 16 | 14, a capsule (30 − 14 = 16: the curves share a centre); the buttons on that band take it too (R-corner-5) |
| A 30 pt mini row at the shape's foot | the shape, 30 | 15 | 15, a capsule |
| Room rows, the red banner, held messages, the quick-action tiles | the shape, at its 12 pt gap | 12 from the sides | 18 (a row set into the dock's slab); 36 pt or shorter is a capsule (R-corner-9) |
| The approval card inside a thread | a kit card, `--r-m` 20, 12 in | 12 | its well and its foot's buttons 8 = 20 − 12 (`--r-in-card`) |
| The segmented thumb and options | the track, `--r-s` 12 | 3 (`--pad-seg`) | 9 (`--r-in-seg`) |
| The stage's composer (not in a corner) | none | | `--r-m`, which at 40 pt is a pill; its send a circle 6 in (the dock session's composer) |
| Wells, buttons, rows elsewhere | none | | their own step (R-corner-2): wells and buttons `--r-s`, your messages `--r-m` (the request card), code and keys `--r-xs`, avatars and dots `--r-pill` |

`tools/check-corners.js` runs the UI lab's `concentric` rule over all 59 scenes (equal insets, radius = outer − inset or a centred capsule, the kit's curve): 143 corner pieces, none failing. `corners-proof.png` overlays the paths at 4x.

Inside: side inset 16 for text. Type is the kit's: names in the band 13/600 (a row's), body 13 at `--lh` (the dock session's), meta 12, mono 11; the stage name is the one display size, 20/600.

---

## 3. Motion

| What | How | Time |
|---|---|---|
| Any shape change | one spring for width, height, radius and ears (k 480, critically damped) | about 300 ms, keeps its speed when retargeted mid-flight |
| Content in | fades in as the shape has room for it (`room²`), after 40 ms | 160 ms |
| Content out | fades before the shape shrinks under it | 120 ms |
| The hero orb | the current bot's orb travels between its places (wing → hover card → stage → thread header → card byline) on the same spring, scaling 20 ↔ 40 | with the shape |
| Switching bots | orb2's turntable spin (`spin('turntable')`, `reverse` going back); the body and colour change at 150 ms, while the face is turned away; the name, the line and the slot slide 26 pt the same way | 720 ms spin, 340 ms slide |
| A state word changing in place | cross-fade | 240 ms |
| Hold to approve | the kit's hold: a dot field gathers and fuses into bone; let go early and it drains back | 1000 ms (`--dur-hold`), drains in 500 |
| Attention edge (approval, a ping) | a 1 pt red edge on the shape's outline with a soft red glow; on arrival it flashes once (0 → 1 → 0.35 → 1) | 1.8 s, then steady |
| Card dwell | a reply, cron or error card | 6 s, held while the pointer is on it or you reply; a ping 12 s |
| Stack slivers (option 6, peek) | two narrower edges under the card, 6 pt apart | with the shape |
| Typing caret | brass, blinks 530 ms, solid while you type | |
| Streaming reply | words fade in per chunk; 0.2.0's finer streaming gives about one chunk every 70 ms | |

Reduced motion: the same states, cross-faded (the shape snaps, content fades); orbs reduce and never freeze (boopis's rule: blinks and eye morphs stay, the spin and hops go); the attention edge is simply on.

---

## 4. States

Each state lists its trigger, what it shows, layout, how it comes and goes, keys, pointer, data and edge cases. "Presence" is `bots.presence`; "stream" is `GET /v1/events`.

### 4.1 Off
- **Trigger**: Settings, Notch is off (the default until the owner turns it on), or the Mac has no boopis.
- **Shows**: nothing. The helper is not running.

### 4.2 First run
- **Trigger**: the moment Bots in the notch is turned on in boopis.
- **Shows**: once, a 380 card out of the notch: every bot's orb in a row, "Your bots live here now", one line on how it works (hover to look, click or ⌥Space to talk). It grows on the spring and leaves after 5 s or on any key. Still: `00-first-run-hello`.
- **macOS asks for**: nothing. See section 10.

### 4.3 Rest: the Mac's own notch
- **Trigger**: every bot `idle`, `sleeping` or `done` (a `done` presence never draws wings: the reply card says it, if cards are on).
- **Shows**: nothing. The panel is ordered out; only a global mouse-moved monitor and the stream stay alive (no frames rendered, no timers).
- **Pointer**: a click on the bare notch opens the stage. Hover does nothing at rest (the owner's rule; see open question 2).
- **Keys**: ⌥Space opens the stage on the bot you last talked to.
- **No notch**: nothing at the top centre; a click on the top 24 pt of the centre does nothing; ⌥Space opens the pill straight to the stage.
- Stills: `01-rest`, `01b-rest-external`, `01c-rest-just-done` (kai just finished: still nothing).

### 4.4 Wings (collapsed, a bot at work)
- **Trigger**: any bot `thinking`, `working`, `compute`, `speaking`, `listening`, `needs` or `error`.
- **Shows** (compact, the default):
  - Left wing: the lead bot's orb, 20 pt (needs you > failed > at work), live with its state's face. Option 4A puts a 14 pt badge (`--ic-s`, a 10 pt glyph) on its corner: the tool's glyph while it works (file, terminal, search, pen; a ring when rendering), three dots while it thinks or replies, a red dot when it needs you or failed.
  - Right wing, the first that applies: the number of approvals waiting, in red; up to two more busy bots as 15 pt still orbs; the lead's step count (`steps`); a breathing dot (`--dur-breathe`).
  - With an approval waiting, the shape's outline turns red and glows (section 3).
- **Wings with words** (option, and the notch's form of round 4's pill): orb and name left of the notch, "reading a file" (or "needs you" in red) right of it, other busy orbs after the words.
- **Enter / leave**: the shape widens out of the notch on the spring; the orb fades in as the wing has room for it. It leaves the same way when every bot is idle again; a bot finishing never makes it flash.
- **Pointer**: resting 120 ms on it opens the hover card; a click opens the stage on the lead bot.
- **Keys**: none of its own (⌥Space opens).
- **Data**: `GET /v1/presence` at start, then `bots.presence`; `GET /v1/approvals` and `approvals.changed` for the count; `GET /v1/bots` for the looks.
- **Edge cases**: many busy bots: two orbs then nothing more (the hover card lists them); a bot made outside boopis gets its default look; cron, room and kanban presence is coarse (`working` without a tool, no `steps`), so there is no badge and no count, only the breathing dot; the lead changes: the orb morphs to the new bot in place, no spin; menus of the frontmost app that reach the notch: compact wings cover 40 pt beside it, words cover 112 (section 6).
- Stills: `02`, `02b` (no notch), `03` (several), `04` (needs you), `05` (failed), `06`, `06b`, `06c` (with words, 4A and 4B).

### 4.5 Hover card
- **Trigger**: the pointer rests 120 ms on the wings. It leaves 280 ms after the pointer does.
- **Shows**: round 4's "working, hover the pill", grown out of the notch:
  - One bot at work: the band is the byline (orb and name left, "reading a file" right), then the turn's summary (`summary`), progress only when a tool reports it (0.2.0), and the steps the notch saw this turn: "Working 1:44", then each step in the past tense with its argument summary (0.2.0) and time, the running one in the present tense with a breathing dot. Foot: Open chat, Stop.
  - Several: the lead's byline and summary, then one mini row per other busy bot (orb with badge, name, what it does, time).
- **Does not take focus**: it is a glance; the frontmost app keeps the keyboard. A click on it opens the stage or the row's thread.
- **Data**: presence, plus the steps the notch recorded from presence transitions (`activity` and `activity_detail` changing within a turn). Past turns carry no tool rows (the conversation has none), so a turn the notch did not watch shows only its count.
- **Edge cases**: a kanban worker has no Stop (it cannot be stopped from the Local API: "stop it in boopis"); a long summary is cut on one line; no steps yet ("thinking"): the summary and Stop only.
- Stills: `07`, `07b`, `07c` (with 0.2.0 progress).

### 4.6 Stage: one bot at a time
- **Trigger**: a click on the wings or the bare notch, ⌥Space, the Bots tab.
- **Shows**: the band holds boopis's bots glyph (quick actions). Hung centred under the hardware notch, the kit's segmented control at size s in tabs mode, Bots | Rooms, with the kit's red dot on Rooms when a room message is for you (it is 126 pt wide; a wing beside the notch has about 110). Under it, the bot:
  - orb 40 (the dock session head's size; R-orb-2 allows 10, 16, 20, 24, 26, 40 and 120), name (20/600), one line: its role when idle; what it does when at work ("Reading a file · src/billing/prorate.ts" with 0.2.0's detail, else the summary); "Wants to run git push origin fix/webhook-retries" in red when it needs you; "Failed: …" in red.
  - The slot between ‹ and ›: idle, the last activity (clock, the bot's last words, "8 min ago", a click opens the thread); at work, the step count, the turn's time and Stop; listening, the voice wave; needs you, Deny and Hold to approve; failed, Open chat and Retry (0.2.0); typing, the field.
  - Page dots: the current bot a short brass pill, a bot that needs you a red dot; with more than nine bots, "6 of 14".
- **Enter**: the shape grows from the wings (or the notch) to 420; the orb flies from the wing to the centre and grows.
- **Keys**: ← → switch bots (the spin); any letter starts the field with that letter in it (grokbot's "just type"); ⏎ opens the thread; Tab goes to Rooms; Esc closes. The panel becomes key without activating boopis (a non-activating panel), so the frontmost app stays frontmost.
- **Pointer and trackpad**: ‹ ›; a horizontal two-finger swipe on the stage is one bot per gesture (debounced like the island); a click on the orb opens the thread; a click outside closes.
- **Data**: bots, presence, approvals, the last assistant message of `GET /v1/bots/<name>/conversation?session=latest` for the last activity.
- **Edge cases**: a long name or line is cut with an ellipsis; one bot: no dots, ‹ › hidden; no bots: "No bots yet. Make one in boopis." with Open boopis; the bot changes state while shown: the line cross-fades in place.
- Stills: `08` to `13`, `08b`, `45` (long names, 14 bots), `46` (reduced motion).

### 4.7 Quick actions (behind the bots glyph)
- **Shows**: three tiles over the stage, the band reading "kai · actions": New conversation (opens the field; the first message goes with `session: "new"`), Stop (only while it works), Open in boopis. Run now, Pause schedule and Logs from the island are left out: the Local API has no call for them.
- **Keys**: Esc returns to the stage. Still: `14`.

### 4.8 A bot's thread
- **Trigger**: a click on the stage orb, ⏎, sending from the stage, Open or Reply from a card.
- **Shows**: the band is the header (‹, the orb, the name; the state word or the model, the bots glyph). Under it, the thread the app shows (one thread), newest at the bottom, the top fading out (`--scroll-fade`):
  - your messages: option 1B by default here (a bubble on the right); 1A (the "you" row with the bubble under it) is one switch away;
  - the bot's replies as text, code in chips, `@user` as the "you" capsule;
  - a finished turn the notch watched: "› 6 steps · 1:12" above its reply;
  - the turn in progress: the live steps, then the presence row ("kai editing a file 0:38");
  - an approval for this bot inline (round 4's chat A), with Deny and Hold; once answered, a receipt line ("✓ Allowed once: git push origin fix/webhook-retries 14:54");
  - after a Stop: a quiet "Stopped · now".
- **Composer**: the kit's compact composer, concentric in the shape's corner. Enter sends, Shift+Enter a new line, the caret brass. The send button becomes Stop while the bot works and the field is empty.
- **Sending**: `POST /v1/bots/<name>/say {text, session: "latest"}`; the message comes back as a `conversation.message` and shows in the app too. The reply streams in: thinking, the steps (recorded from presence), then the words fading in per chunk.
- **A reply arriving while you type**: your draft and focus stay; the thread follows the reply only if you were at the bottom, else a "New reply ↓" capsule; Enter while the bot is still answering does not send (the Local API answers `409 bot_busy`): a quiet line says it is replying and ⌘. stops it (open question 3).
- **Keys**: Esc goes back to the stage (Esc in an empty field), ⌘. stops, ⌘↑ ⌘↓ scroll.
- **Data**: `GET /v1/bots/<name>/conversation?session=latest&limit=40`, then a second stream `GET /v1/events?conversations=1&bot=<name>` opened only while a thread is on screen (so the host copies words only then), `POST /v1/bots/<name>/say`, `POST /v1/bots/<name>/stop`.
- **Edge cases**: a message cut at 16 KiB shows "…" and Open in boopis; a very long reply scrolls inside the 340 pt log; no conversation yet (`404 no_conversation`): the bot's orb and "Talk to kai"; Hide words: every message drawn as its shape.
- Stills: `16`, `16b`, `17`, `18`, `19`, `20`, `21`, `22`, `42` (words hidden).

### 4.9 Rooms and a room
- **Rooms**: the Rooms tab lists each room (members' orbs, moving when they work), its last line or who is working, "• to you" when a message names you. ⏎ or a click opens it. Still `23`.
- **A room**: the band holds ‹ and the room's name, and on the right "1 at work" with Stop. The log as entries (option 1A by default in a room: many authors): each bot's orb, name, "to nina" or "to you", time, then its words with @names as mention capsules; boopis's own lines (a cancelled turn) quiet and centred; a "• new" divider where unseen lines start; who is at work as presence rows; held messages ("Held · sends when the room is free", each with its age); the composer ("Message the room, @ for one bot").
- **Saying**: `POST /v1/rooms/<id>/say {text}`; the answer is `sent` or `held`, and a held message joins the held list. Taking a held message back is done in boopis (the Local API has no call for it).
- **Stop**: `POST /v1/rooms/<id>/stop`; held messages go out once the room is free.
- **Ping highlight** (option 2): A "to you" in white; B with a veil behind the entry; C with a red dot until seen; A+C by default; and boopis's own (the red edge, glow and wash of `data-to-you`) as a fourth choice. Stills `24` to `24e`.
- **Data**: `GET /v1/rooms`, `GET /v1/rooms/<id>/log`, the stream with `rooms=1` (`room.line`, `room.state`, `room.held`), `mentions_you` on each line.
- **Edge cases**: a room with nothing said: its members' orbs and its name; 20 held messages (`409 hold_full`): the composer says so; a long room name is cut.

### 4.10 Approval ("needs you")
- **Trigger**: `approvals.changed` with `state: "pending"`. With Approvals open the notch on (default) and not in full screen, the notch grows into the card on its own, **without taking the keyboard**: typing in another app goes on there. Off, or in full screen: the wings show the red dot and count until you hover or press ⌥Space.
- **Shows**: card A: the band is the byline (the orb with the needs face and its red dot, the name; "• needs you" in red), "Run a command" with the model and tool, why (`description`), the command in a well (mono), "expires in 2:36" counting down (`timeout_s`), a quiet line ("Hold Space or ⏎ twice · This session and Always are answered in boopis": the Local API takes `once` and `deny` only), then the foot in the shape's corner: "expires in", Deny with its key chip (x) and Hold to approve, both capsules 16 from the edges (section 2.1). Held, the label reads "Keep holding" as the fill sweeps (the kit's). The shape's outline is red and glows.
- **Answering** (option 3): hold 1 s (default, boopis's rule), or tap Allow once, or hold only for risky commands (terminal pushes, deletes, database writes). Keys once the notch has focus (⌥Space): hold Space, or ⏎ twice; x denies. On answer: a receipt in place for 0.9 s ("✓ Allowed once"), the orb turns to working, then the next card or the wings.
- **Several** (option 6): peek (default): one card, two slivers under the shape, page dots in the foot, the current a brass pill and the waiting ones red; list: the others as mini rows under the card.
- **Answered elsewhere**: the row closes (`approvals.changed` settled): the card shows "Answered in boopis" for 0.9 s and leaves. A second answer gets `409 already_answered`, shown the same way.
- **Esc**: the card folds back to the wings, the red dot and count stay; nothing is denied by leaving.
- **Expired**: "Expired, nothing ran" for 2 s, then gone.
- **Data**: `GET /v1/approvals`, `approvals.changed`, `POST /v1/approvals/<id> {choice, execution_generation}`.
- **Edge cases**: a command of many lines: four lines, then a fade and "Show all"; a reply card queued behind an approval waits (approvals come first); approvals for the bot whose thread is open show inline there instead of as a card, and another bot's as a red banner at the top of the open view.
- Stills: `25`, `25b` (no notch), `26` (held 60 %), `27` (tap), `28`, `28b` (stacks), `29` (answered), `11`, `15`, `20`, `21`.

### 4.11 Cards: a reply, a ping, a scheduled run, a failure
- **Trigger**: `notifications.new`, with Cards on and not in full screen. Each grows out of the notch (or the wings) and leaves after 6 s (a ping 12 s); the pointer on it or a reply in progress holds it.
- **Kinds**:
  - reply: the byline (orb with the done face, name; "replied now"), the title, three lines of the body, Open and Reply. Reply turns the foot into a field in place (round 4's "Reply tapped") and sends with `say`.
  - ping (`kind: "mention"`, 0.2.0): the byline with "• to you" and the time, the shape's red edge, "In Launch room", the message with the "you" capsule, Open room and Reply (into the room).
  - cron (0.2.0's result text and next run): the title, the result, "◷ next run tomorrow 03:00", Open.
  - error: "• failed" in red, the last lines in a well in red text, Open and Retry, text only (boopis's icon set has no retry glyph; 0.2.0's `POST /v1/bots/<name>/retry`; until then "Ask to retry" says so in the chat, as round 4 does).
  - task (a kanban task finished): like reply, with the board's summary.
- **Style** (option 5): A grown out of the pill (default); B the body drawn as its chat entry with the reply field open; C one line (the band and one line under it) that opens to A on hover: the quiet setting.
- **Queue**: one card at a time; the count waiting shows as slivers and dots (peek) or mini rows (list).
- **Leave**: the content fades, then the shape folds back into the wings or the notch.
- **Data**: `notifications.new`; on start, `GET /v1/notifications?after=<last seen>` only to count what was missed (old cards are not replayed).
- Stills: `30` to `37b`, `44b` (light menu bar).

### 4.12 Stop
- Where: the stage slot, the hover card, the thread's send button (while the field is empty), quick actions, ⌘. anywhere in an open view, and the room's band.
- One press, no confirmation (a stop loses at most the turn in progress, which can be asked again). `POST /v1/bots/<name>/stop` or `/rooms/<id>/stop`. The orb turns idle at once, the steps fold, the thread shows "Stopped · now". `409 not_running`: nothing changes. Still `22`.

### 4.13 Voice
Out of scope for 0.2.0. The Local API has no audio path and the notch would need the microphone permission and a speech pipeline. The notch shows the `listening` face and the island's voice wave when boopis itself is listening (still `12`), and the stage's "tap the waves" becomes "just type": any letter opens the field. Voice can come later the island's way (local whisper, a voice per bot).

### 4.14 Offline
- **boopis isn't running** (the endpoint file exists, the connection is refused): at rest nothing; on a click, hover or ⌥Space, a 340 card: the boopis mark, "boopis isn't running", "Open it and your bots come back here.", Open boopis.
- **The Local API is off** (no endpoint file, or `403` after a rotate that never came back): "The Local API is off", one line on why, Open Settings in boopis.
- **boopis is starting** (the endpoint answers, the snapshots are empty or the engine is not ready): "boopis is starting", a breathing dot, no action.
- A rotated token or a `lagged` stream is handled silently: read the token file again, read the snapshots again, resume. Wings that were showing fade out after 10 s without a link.
- Stills `38`, `39`, `40`.

### 4.15 Settings (boopis, Settings, Notch)
See `stills/50-settings.jpg` and `prototype/settings.html`. Bots in the notch (on turns the Local API on); Shortcut (⌥Space); Beside the notch (While a bot works / Only when one needs you / Never); Wings (Compact / With words); Cards (Full, As the chat, Quiet: options 5A, 5B, 5C); Approvals open the notch; In full screen (Wings only / Hide); Hide words in screen recordings; Hide words; Display (The one with the notch / Main display / All); Sound for approvals (off). A status line: connected, how many bots and rooms, the address, "macOS permissions: none".

---

## 5. Interaction rules

**Focus**: the notch never steals the keyboard. Cards and approvals arrive without focus. The panel becomes key only on ⌥Space, a click inside it, or typing into it after a click; Esc at the top level gives the keyboard back to the app that had it.

**Keyboard**

| Key | Where | Does |
|---|---|---|
| ⌥Space | anywhere | open (the stage on the lead bot) or close |
| ← → | stage | previous, next bot (the spin) |
| any letter | stage | the field, with the letter in it |
| ⏎ | stage | the thread; in a field, send |
| Shift ⏎ | field | new line |
| Tab | stage, rooms | Bots ↔ Rooms |
| Esc | anywhere | one level back: field → stage, thread → stage, room → rooms, quick actions → stage, open → closed; on a card, dismiss (an approval stays pending) |
| ⌘. | open views | stop the bot or the room |
| Space (hold), ⏎ twice | approval, focused | approve once |
| x | approval, focused | deny |

**Pointer and trackpad**: hover 120 ms in, 280 ms out; a click on the notch or the wings opens; a click outside closes; two-finger swipe down on the notch opens, up closes; sideways on the stage switches bots, one per gesture; the scroll wheel scrolls the thread or room.

**Priority**: an approval > a ping > an error > a reply or cron card > the hover card > the wings. An open view (you went in) is never replaced by a card: approvals for the bot on screen show inline, others as a red banner at the top; notifications wait until you close it.

---

## 6. Options shared with round 4 (decide once for both)

Same letters as the island's round 4. Each can be switched in the prototype's option menus (or the address, `?card=C&stack=list`).

| # | Choice | Island round 4 recommends | Notch default | Where the notch changes the answer |
|---|---|---|---|---|
| 1 | Your messages: A "you" row, B bubble on the right | A in rooms, either 1:1 | B in a thread, A in a room | No change. At 420 pt, B saves a row per message in a 1:1 thread |
| 2 | Ping: A "to you" white, B + veil, C + red dot until seen | A+C | A+C, plus boopis's red edge offered as a fourth | The ping *card* carries the weight anyway (the shape's red edge, the "you" capsule), so the in-room highlight can stay quiet |
| 3 | Approval: tap, hold, hold for risky | hold for risky, or hold everywhere | hold everywhere | The top edge of the screen is the easiest place to click by accident (it stops the pointer), and cards arrive under it unasked. A 1 s hold is the guard a tap cannot be |
| 4 | Small orbs: A badge + words, B words only | A | A, compact wings: orb + badge, no words | The wings sit beside the hardware and over menu bar space: words need 112 pt a side, where the frontmost app's menus or status items can be. The badge carries the tool at 40 pt; the words come on hover. "Wings with words" is a setting for whoever has the room |
| 5 | Card: A grown, B chat entry, C mini row | A, with C as quiet | A, C as the "Quiet" setting | C can't be one line through the hardware notch: in the notch it is the byline in the band plus one line under it (still `32`) |
| 6 | Stack: peek or list | peek | peek | Slivers hang below the black shape; over a black full-screen band they disappear, so the page dots in the foot say the count too |

Kept from earlier rounds, carried into the notch: the orb spin and morph (switching bots), the stage-to-chat orb flight (the hero orb), idle "last activity", the listening wave, the working summary with Stop, quick actions behind the bots glyph.

---

## 7. Platform realities

- **No notch, external displays**: the same states as a black pill hung from the top centre, 24 pt band (the menu bar), a pill collapsed (12) and the same `--r-l` open. The band's centre stays empty there too, so the layout is the same on every display. Stills `01b`, `02b`, `08b`, `25b`, `30b`.
- **Several displays**: one panel per display that should show it (Settings, Display); cards and open views appear on the display with the pointer, the wings on each. Clamshell: the main display gets the pill.
- **Full screen**: the band around the notch is black, so the wings sit in black and read as content only (still `41`); cards and approvals wait (a red dot and the edge glow) until you hover or press ⌥Space. Setting: Wings only / Hide.
- **Auto-hidden menu bar**: on a notch display the band stays black; the wings still show. On another display the pill shows over the app's top edge only while a bot works.
- **Stage Manager, Spaces, Mission Control**: the panel joins all Spaces, is stationary, ignores the window cycle and is never in a stage.
- **Screen sharing and recording**: the panel asks macOS to stay out of captures (`sharingType = .none`); some capture paths ignore it, and there is no public way to know a share is on without asking for Screen Recording, which the notch does not. So Hide words is one click in Settings: names and states stay, words become their shape (still `42`).
- **Dark and light menu bars**: the notch is black in every case, like the hardware and the dock (still `44`, `44b`).
- **Increase contrast**: a hairline outline on the shape, stronger meta text and control outlines (still `43`).
- **Reduce motion**: section 3.
- **VoiceOver**: the panel is a labelled group; each state is announced politely ("kai, reading a file"), an approval assertively ("iris needs you: run git push origin fix/webhook-retries. Hold to approve, or deny."); the hold works as the kit's (⏎ twice). ⌥Space moves VoiceOver into the panel.
- **Dark-bodied orbs** (hex's default look is near black): a hairline rim so the silhouette reads on the black notch (a proposal: open question 4).

---

## 8. Sound and haptics

- **Haptic**: one, the trackpad's level-change tick when a hold completes. It confirms the commit under the finger. Nothing else.
- **Sound**: off by default; one optional quiet tick when an approval arrives (Settings, Sound for approvals). Replies, cards and switching bots make no sound.

---

## 9. Data: what each state reads and writes

Every endpoint is on `127.0.0.1`, with the bearer token from `<app data>/client-token`. 0.2.0 marks what the Local API gains in 0.2.0 (branch w30/local-api-0.2).

| State | Reads | Writes |
|---|---|---|
| All | `GET /v1/bots`, `GET /v1/presence`, `GET /v1/approvals`; one stream `GET /v1/events` (presence, approvals, notifications, `bots.changed`, `lagged`) | |
| Wings, hover | presence (`state`, `activity`, `summary`, `steps`, `source`, `at`); **0.2.0** `activity_detail` (the tool's argument summary), **0.2.0** `progress` | `POST /v1/bots/<name>/stop` |
| Stage | the above; the last message of `GET /v1/bots/<name>/conversation?session=latest` | `say` (with `session: "new"` from quick actions), `stop`, approval answers |
| Thread | `GET /v1/bots/<name>/conversation`, a second stream with `conversations=1&bot=<name>` while it is on screen; **0.2.0** finer streaming | `POST /v1/bots/<name>/say`, `stop` |
| Rooms, room | `GET /v1/rooms`, `GET /v1/rooms/<id>/log`, the stream with `rooms=1` (`room.line`, `room.state`, `room.held`), `mentions_you` | `POST /v1/rooms/<id>/say`, `POST /v1/rooms/<id>/stop` |
| Approval | approvals and `approvals.changed` | `POST /v1/approvals/<id> {choice: once \| deny, execution_generation}` |
| Cards | `notifications.new`; **0.2.0** `kind: "mention"` with `room_id`, `seq`, text; **0.2.0** cron result text and next run | `say` (reply), **0.2.0** `POST /v1/bots/<name>/retry` |

Not available, so not shown: tool rows of past turns (the notch shows only the steps it watched live); "This session" and "Always" grants (answered in boopis); taking a held room message back; Run now, Pause schedule and Logs (no call); the boopis window's open thread (the notch uses the engine's latest, which the app shares when it has it open); stopping a kanban worker.

---

## 10. Feasibility for the native build

### Options

| | A. Swift helper + a web view (recommended) | B. All native (SwiftUI) | C. A Tauri window inside boopis |
|---|---|---|---|
| What | a small `LSUIElement` app inside `boopis.app/Contents/Library/LoginItems`, an `NSPanel` at the notch hosting one `WKWebView` that renders these views | the same panel, every view in SwiftUI | a second window of the boopis app, made a panel with native calls |
| Orbs | orb2 itself (`orb-avatar.js`), exactly the app's | re-implemented, or played from recorded vectors as the island does (55 MB for 15 shapes, about 20 MB trimmed) | orb2 itself |
| Data | the Local API from Swift (`URLSession`, the SSE stream); the token never enters the web view | the Local API from Swift | the host's own state; the Local API is not needed |
| "boopis isn't running" | yes: the helper outlives the app | yes | no: the notch dies with the app |
| Cost | about 2 to 3k lines of Swift plus the web views shared with this prototype; one more signed binary | the most: a second UI in another stack and an orb port | the least code, but focus, levels and Spaces behaviour fight Tauri's window model |
| Risk | web view memory (about 40 to 60 MB while open; ordered out at rest) | drift from the app's look over time | stealing focus from the frontmost app; full-screen and Spaces bugs |

A web view cannot call the Local API itself: the endpoint refuses any request with an `Origin` or `Sec-Fetch-*` header (`403 browser_refused`). In A the Swift side makes the calls and passes JSON to the page through `WKScriptMessageHandler`, which also keeps the token out of the page.

### The panel (A and B)
- `NSPanel` with `.borderless` and `.nonactivatingPanel`, `level = .statusBar` (above the menu bar), `collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]`, transparent, no shadow, `becomesKeyOnlyIfNeeded`, `hidesOnDeactivate = false`.
- A fixed frame (about 480 × 640 pt) anchored at the notch; clicks outside the drawn shape pass through (`hitTest` against the shape's path, or `ignoresMouseEvents` toggled from a mouse monitor).
- Ordered out at rest. The shape's spring runs in the page (as here) or in Core Animation for B.

### macOS APIs and what each asks for

| Need | API | Permission |
|---|---|---|
| Notch size and place | `NSScreen.safeAreaInsets`, `auxiliaryTopLeftArea`, `auxiliaryTopRightArea`; `NSApplication.didChangeScreenParametersNotification` | none |
| The global shortcut | Carbon `RegisterEventHotKey` (as grokbot-notch does); not an event tap, which needs Accessibility | none |
| Hover at the notch while ordered out | `NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved)` (mouse events need no permission) | none |
| Swipes on the notch | the panel's own scroll events while ordered in | none |
| Out of screen captures | `NSWindow.sharingType = .none` (best effort) | none |
| Knowing a share is on | no public API without Screen Recording | not asked: Hide words instead |
| Full screen on the display | `NSWorkspace.activeSpaceDidChangeNotification` and window bounds from `CGWindowListCopyWindowInfo` (bounds need no permission) | none |
| Menu bar hidden | `NSMenu.menuBarVisible()`, `visibleFrame` against `frame` | none |
| Start with the Mac | `SMAppService.loginItem(identifier:)` (macOS 13+) | none (macOS posts "boopis added a login item") |
| Reduce motion, contrast | `NSWorkspace.shared.accessibilityDisplayShouldReduceMotion`, `…IncreaseContrast` | none |
| The hold's tick | `NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, …)` | none |
| VoiceOver | the web view's ARIA (A) or `NSAccessibility` (B); `NSAccessibility.post(… .announcementRequested)` for approvals | none |
| Voice (later) | `AVAudioEngine` | Microphone, not in 0.2.0 |

So 0.2.0 asks macOS for nothing. Turning the notch on in boopis turns on the Local API with one line of consent, registers the login item and starts the helper.

---

## 11. Open questions for the owner

1. **The shortcut.** ⌥Space (grokbot's) takes over typing a non-breaking space everywhere. Keep it, or use ⌃⌥Space?
2. **Hovering the bare notch at rest.** It does nothing now (your rule: idle is the Mac's own); a click or ⌥Space opens. Should a hover at rest also show a quiet strip of the bots' orbs?
3. **Writing while a bot replies.** The Local API refuses `say` into a conversation that is answering (`409 bot_busy`). Keep the send disabled with a note (now), or have the notch hold the message and send it when the turn ends (it would not show in the app until then)?
4. **Dark-bodied orbs.** On pure black, hex's near-black body disappears. The notch adds a hairline rim. Adopt it, and in the dock too?
5. **The stage's orb.** R-orb-2 has no size between 40 and 120, so the stage now uses 40, the dock session head's. Your island's stage uses 92. Keep 40, or add a stage size to the orb table?
6. **The six shared options** (section 6), decided once for the island and the notch: 1 B in threads, A in rooms; 2 A+C; 3 hold everywhere; 4 A with compact wings; 5 A, C as Quiet; 6 peek. Confirm or change.

---

## 12. Design-system audit (the corners pass)

The owner's correction ("maintain our design choices: the chatbox has a different visual corner radius than the notch itself") was measured, then every state was audited against the system. What was wrong, and what changed:

| Found | Rule | Fixed |
|---|---|---|
| The shape was my own curve (one cubic per corner, running 1.42R) with 8 pt quarter-circle ears | R-corner-6, 8.1, the dock's slab | The kit's `slabPath` geometry, turned upside down: continuous corners and flares, both `--r-l`; a pill with round ends when collapsed |
| Every nested surface (composer, send, buttons, hold, rows, wells, the segmented control, cards) was a plain circular CSS arc, another family | R-corner-6 | Each is bound to the kit's continuous path from its computed radius (frame mode; the hold clipped) |
| Shape radii 28, 26, 22 and 10 for cards, rows, the mini card and the wings | R-corner-1 | `--r-l` for every open shape; the wings a pill |
| The approval's buttons sat above a hint line, not in the corner | R-corner-3 | The foot is the last row, its controls capsules 16 in |
| The rows at the hover card's foot sat 12 in at radius 15 | R-corner-3 (a control too small moves in) | 15 in, so the curves share a centre |
| The approval's well had radius 0 (`--r-in` undefined there) | R-corner-1, R-corner-2 | `--r-s`; in the card inside a thread, the card's `--r-in` (8) |
| Your messages at 16; code at 4; the "you" avatar a 6 pt square | R-corner-1, R-corner-2 | The request card's `--r-m` and padding (10, 14); `--r-xs`; a circle (avatars are pills) |
| A segmented look-alike (22 pt, radii 11 and 9, 11 pt type) in the band | the kit's components as they are | The kit's segmented control, size s, hung under the notch |
| Deny's key chip a loose chip | R-kbd-2 | The kit's 18 pt key chip, concentric in the button's end corner |
| Reply and Retry icons drawn for the prototype | boopis's icon set only | Removed: text buttons |
| Orbs at 72, 22 and 15 | R-orb-2 | 40, 20 and 16 |
| Loose values: well padding 9, gaps 5, 7 and 10, line heights 1.5 and 1.55, fixed px type | tokens only | `--sp-*`, `--ic-gap-*`, `--lh*`, `--fs-*`; the kit's own numbers where a kit part has them (button 0 10, composer 6 and 14, request 10 14, stamp 0 7) |
| Focus rings had been dropped | R-focus-1 | The kit's 2 pt `--focus` ring, inside the segmented track |
| Bound surfaces inherited their container's fill | 8.1 (the zero-specificity reset) | `:where([data-sq-on])` resets `--sq-bg` and `--sq-line` |

Still outside the system, deliberately, for the owner: the tool badge on small orbs (round 4's option 4A; the kit has the attention flag only), the listening wave (the island's), the notch's own geometry (band, notch width, view widths, read or set per surface as the shell sets `--right-w`), and the hairline rim on dark-bodied orbs (open question 4).

## 13. Sources and what came from each

- **The Linux island (panacea-island)**: the stage (one bot, orb spin into the next, the line, the slot, page dots), the collapsed pill's lead rule (needs > at work), cards that grow out of the island and hold, reply in place, the room's entries, @name picker, held messages, quick actions behind the glyph, one spring (PkMorph), content that fades by the room it has, BotSlideText's slide and fade timings, BotWave and the listening envelope, the design language (black, greys, one red).
- **Island round 4**: the collapse rule, the hover working card with steps, tool badges on small orbs, tool steps with arguments that fold to "3 steps", the inline approval and receipts, the card styles A/B/C, the stack peek/list, ping highlights, the six options and their letters.
- **orb2**: the renderer, the state words and their faces, `spin('turntable' | 'reverse')`, shape and colour morphs (0.38 s), reduced-motion behaviour, the notch companion on its demo page (live page fetched: identical to the repo's `index.html`).
- **grokbot (YouTube, "Talk to them from your Mac notch", 5:48 to 8:16)**: the page, chapters and description were read; the video and its captions were blocked (YouTube answered 403 to the media and 429 to the captions), so the study used the chapter's storyboard frames (27 frames at 320 × 180) and grokbot-notch's README: a collapsed chin with the mark, name and wave; a U-shaped pouch on ⌥Space or a click; the character in a tile, name, last line; ‹ wave ›; tap the waves or just type; ← → cycle; Esc or a click outside closes; an NSPanel with a WKWebView and Carbon hotkeys. Its look was not copied.
- **boopis**: tokens, the dock ground, the dock's slab and spring (`K_SLAB` 480), the kit's controls, the hold (1 s, Bayer dots, ⏎ twice), the approval card's wording, bot state words ("running", "replying", "needs you", "failed", "asleep"), the mention and "you" capsules and `data-to-you` from w29/mentions, the Local API (w29-store and w29/rooms-api) and the 0.2.0 additions.
