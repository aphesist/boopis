"""The picture's timeline as the sound sees it: the grid, and every effect cue of the three cuts.

Every cue time comes from the approved script (SC/script/beats.json, script.md) and storyboard (storyboard.md) or the
cut-downs (cutdowns.md), on the film's grid: 112.5 BPM, 60 fps, 32 frames a beat, 128 a bar. A cue is placed on the
frame where the picture does the thing (a landing, a press bottoming out, a character becoming visible), so every
time below is a whole frame. When the animated picture lands somewhere else, change the frame here (one line) and
rebuild; the sync audit then measures the new mix against the new frames.

Conventions
- `at("12.1.5")` is the script's bar.beat notation (1.1 = 0 s); `F(n)` is frame n at 60 fps.
- `t` is the frame the sound belongs to: its onset, or for a move (air, the dive) its peak, or for the rollback its
  end. `lead` is how long the sound starts before `t`.
- Pan follows the element's place on screen, kept within +-0.3 so the mix folds to mono.
- Tiers: 1 the focal sound of the moment (the music ducks under it a little), 2 supporting, 3 texture.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

BPM = 112.5
FPS = 60
BEAT = 60.0 / BPM          # 0.5333 s = 32 frames
BAR = 4 * BEAT
FRAME = 1.0 / FPS
FILM = 22 * BAR            # 46.933 s
CUT15 = 7 * BAR            # 14.933 s
BUMPER = 6.0


def at(bb: str) -> float:
    """The script's bar.beat ('3.2.5' is bar 3, beat 2.5) as seconds."""
    p = bb.split(".")
    bar = int(p[0])
    beat = float(p[1] + ("." + p[2] if len(p) > 2 else "")) if len(p) > 1 else 1.0
    return ((bar - 1) * 4 + (beat - 1)) * BEAT


def F(frame: float) -> float:
    return frame / FPS


def frame_of(t: float) -> int:
    return int(round(t * FPS))


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


# the bots' notes: one pitch each, all from one chord (Fmaj9 with its upper structure A C E G)
KAI, NINA, MOSS, VOX = 69, 72, 76, 79     # A4, C5, E5, G5
NOTE = {"kai": KAI, "nina": NINA, "moss": MOSS, "vox": VOX}


@dataclass
class Cue:
    id: str
    t: float
    kind: str
    gain: float
    beat: str
    label: str
    src: str = ""
    p: dict = field(default_factory=dict)
    pan: float | str = 0.0
    sends: dict = field(default_factory=dict)
    tier: int = 2
    measure: str = "onset"       # onset | peak | end | span | texture
    lead: float = 0.0
    group: str = ""              # typing lines are grouped in the audit

    @property
    def frame(self) -> int:
        return frame_of(self.t)


# sends (dB into each space), by family
S_BOT = {"plate": -9.0, "hall": -15.0, "delay": -19.0}
S_UI = {"room": -14.0}
S_KEY = {"room": -17.0}
S_HIT = {"hall": -9.0}
S_BOOP = {"plate": -11.0, "hall": -15.0, "delay": -21.0}


def typing(cues: list, beat: str, start: float, text: str, cps: float, gain: float, pan: float, label: str,
           src: str, chip: tuple | None = None) -> None:
    """K2 typing (media/launch/src/motion/type.ts typeOn): character i starts at start + i/cps and is first visible on
    the next frame, where its key sounds. Spaces are keystrokes too (the script's end times count them), and sound
    as the space bar. `chip=(handle, bot)` adds the mention chip on the keystroke that completes the handle."""
    for i, ch in enumerate(text):
        T = start + i / cps
        f = math.floor(T * FPS + 1e-6) + 1
        cues.append(Cue(f"{beat.lower()}-key{i:02d}", F(f), "key_tick", gain + (1.5 if ch == " " else 0.0), beat,
                        f"key '{ch}'" if ch != " " else "key (space)", src,
                        {"seed": sum(map(ord, beat)) * 101 + i, "space": ch == " "},
                        pan, S_KEY, 3, group=label))
    if chip:
        handle, bot = chip
        i = text.index(handle) + len(handle) - 1
        f = math.floor((start + i / cps) * FPS + 1e-6) + 1
        cues.append(Cue(f"{beat.lower()}-chip-{bot}", F(f), "chip", -25.0, beat, f"mention chip {handle}", src,
                        {"m": NOTE[bot] + 12}, pan, {"plate": -12.0, "delay": -24.0}, 2))


BOT_GAIN = 2.0  # the bots' notes sit this much over the per-cue values (which set the balance within the family)


def bot(cid, t, who, gain, beat, label, src, pan=0.0, tier=1, **kw) -> Cue:
    return Cue(cid, t, "mallet", gain + BOT_GAIN, beat, label, src, {"m": NOTE[who], **kw}, pan, S_BOT, tier)


# ── the master (46.93 s) ──────────────────────────────────────────────────────────────────────────────────────────

def film_cues() -> list[Cue]:
    c: list[Cue] = []
    A = c.append
    # B01 the hook
    A(bot("b01-kai", F(64), "kai", -13, "B01", "kai speaks to nina (call)", "B01 sound: kai's pluck at 1.3", -0.18))
    A(bot("b01-nina", F(96), "nina", -13, "B01", "nina answers (response)", "B01 sound: nina's at 1.4", 0.18))
    A(Cue("b01-dive", F(148), "dive", -19, "B01", "T2 zoom-through into kai's eye", "B01: whoosh peaking 2.47",
          {"dur": 0.40, "peak": 0.20}, 0.0, {"hall": -14.0}, 2, "peak", lead=0.20))
    A(Cue("b01-thump", F(160), "thump", -11, "B01", "swap lands on 2.2", "B01: soft low thump 2.667",
          {"f": hz(38)}, 0.0, {"hall": -12.0}, 1))
    # B02 the promise: four buttons settle out of the eye (U4, travel 24 f, 3 f stagger from 2.667)
    for k, (m, f) in enumerate(zip((81, 84, 86, 89), (184, 187, 190, 193))):
        A(Cue(f"b02-button{k + 1}", F(f), "wood", -24 + 0.5 * k, "B02", f"sign-in button {k + 1} settles",
              "B02: four soft wood ticks, rising", {"f": hz(m)}, 0.0, {"room": -12.0}, 2))
    # B03 the cast
    A(Cue("b03-morph", F(324), "air", -32, "B03", "T8 shells become cards (air)", "B03 5.067-5.6, travel 32 f",
          {"dur": 0.75, "peak": 0.33, "lo": 300.0, "hi": 2600.0}, 0.0, {"hall": -18.0}, 3, "peak", lead=0.33))
    for k, (who, f, p) in enumerate((("nina", 352, -0.06), ("moss", 360, 0.06), ("kai", 368, -0.06),
                                     ("vox", 376, 0.06))):
        A(bot(f"b03-eyes-{who}", F(f), who, -15 - 0.4 * k, "B03", f"{who}'s eyes open", "B03: 5.867-6.133 on "
              "sixteenths; four plucks, each bot's own note, together one chord", p))
    A(Cue("b03-vox-blink", F(384), "boop", -31, "B03", "vox blinks (the boop, small)", "B03: 6.4 vox blinks",
          {"m": 91, "size": 0.45}, 0.06, {"plate": -14.0}, 3))
    A(Cue("b03-flight", F(433), "air", -33, "B03", "T1 the orbs arc up-left into the stack",
          "B03 carry-out: travel 30 f, 3 f stagger, landing 4.3",
          {"dur": 0.55, "peak": 0.30, "lo": 400.0, "hi": 3000.0, "pan_from": 0.25, "pan_to": -0.25}, 0.0, {}, 3,
          "peak", lead=0.30))
    for k, (m, f) in enumerate(zip((77, 72, 69, 65), (448, 451, 454, 457))):
        A(Cue(f"b03-stack{k + 1}", F(f), "wood", -28, "B03", f"orb {k + 1} tucks into the head stack",
              "B03 carry-out: landing 4.3, 3 f stagger", {"f": hz(m), "decay": 0.016}, -0.2, {"room": -14.0}, 3))
    # B04 the room: you ask once
    A(Cue("b04-click", F(480), "click", -24, "B04", "cursor clicks the composer", "B04: clicks on 4.4 (8.0)",
          {}, 0.05, S_UI, 2))
    typing(c, "B04", 8.0, "@kai is it ready to cut?", 28, -31, 0.05, "typed: @kai is it ready to cut?",
           "B04: 8.0-8.9 K2 28 cps; '@kai' becomes a chip", chip=("@kai", "kai"))
    A(Cue("b04-send", F(544), "send", -17, "B04", "send (button .96)", "B04: 9.067 (5.2) send", {}, 0.05,
          S_UI, 1))
    A(Cue("b04-presence", F(556), "breath_tick", -27, "B04", "presence entry rises (kai thinking)",
          "B04: 9.067-9.6 rises at --dur-2 (lands 9.267)", {}, -0.05, S_UI, 3))
    # B05 they hand work on
    A(bot("b05-kai", F(576), "kai", -12, "B05", "kai's reply lands whole", "B05: 9.6 kai's note on the landing",
          -0.08))
    A(bot("b05-moss", F(640), "moss", -19, "B05", "moss joins the presence", "B05: 10.667 moss's note, quiet",
          -0.1, tier=2))
    A(bot("b05-nina", F(644), "nina", -19.5, "B05", "nina joins 60 ms later", "B05: nina's orb 60 ms later",
          -0.06, tier=2))
    # B06 they work it out
    A(bot("b06-nina", F(768), "nina", -12.5, "B06", "nina's reply lands", "B06: 12.8 (7.1)", -0.08))
    A(bot("b06-moss", F(832), "moss", -12.5, "B06", "moss's reply lands", "B06: 13.867 (7.3)", -0.08))
    A(Cue("b06-gather", F(832), "gather", -27, "B06", "the two gather into a live huddle",
          "B06: container resize --dur-3", {}, -0.08, S_UI, 3))
    A(bot("b06-kai", F(864), "kai", -12, "B06", "kai lands inside the huddle: the chord completes",
          "B06: together they complete the chord at 7.4", -0.08))
    A(bot("b06-chord-nina", F(864), "nina", -22, "B06", "the chord: nina rings again", "B06: chord at 7.4", -0.1,
          tier=3))
    A(bot("b06-chord-moss", F(864), "moss", -22.5, "B06", "the chord: moss rings again", "B06: chord at 7.4", -0.04,
          tier=3))
    # B07 the fold (the moment)
    typing(c, "B07", at("8.1"), "@nina stage it next", 28, -31, 0.05, "typed: @nina stage it next",
           "B07: 14.933 K2; '@nina' becomes a chip", chip=("@nina", "nina"))
    A(Cue("b07-send", F(960), "send", -24, "B07", "send", "B07: 16.0 (8.3) send", {}, 0.05, S_UI, 2))
    A(Cue("b07-hit", F(960), "low_hit", -8, "B07", "the first proof lands (low warm hit)",
          "B07: a low warm hit at 16.0", {"f": hz(29), "size": 0.8}, 0.0, S_HIT, 1))
    A(bot("b07-fall1", F(960), "nina", -13, "B07", "the huddle folds: fall, note 1", "B07: a soft two-note fall",
          0.0))
    A(Cue("b07-fold", F(960), "fold", -30, "B07", "body height to 0 (--dur-3)", "B07: disclosure closes",
          {"dur": 0.3}, 0.0, S_UI, 3))
    A(Cue("b07-fall2", F(978), "mallet", -11.5, "B07", "the fold lands: fall, note 2 (the root)",
          "B07: two-note fall; the fold ends at --dur-3 (300 ms)", {"m": 65}, 0.0, S_BOT, 1))
    # B08 to your own session
    A(Cue("b08-air", F(1088), "air", -31, "B08", "pull back to the whole window (air)",
          "B08: 17.867-18.4 pull back, 'air'", {"dur": 0.8, "peak": 0.3, "lo": 200.0, "hi": 1800.0}, 0.0,
          {"hall": -18.0}, 3, "peak", lead=0.3))
    A(Cue("b08-click", F(1152), "click", -24, "B08", "cursor clicks Session", "B08: clicks Session on 10.1",
          {}, -0.18, S_UI, 2))
    A(Cue("b08-thumb", F(1167), "thumb_tick", -27, "B08", "the pill's thumb lands",
          "B08: thumb slides --dur-slide (240 ms); soft tick as it lands", {}, -0.18, S_UI, 2))
    A(Cue("b08-governed", F(1170), "brass_step", -21, "B08", "the Governed chip arrives (the turn)",
          "B08: Governed chip arrives (T1, --dur-3)", {"m": 62}, 0.05, {"plate": -10.0, "hall": -15.0}, 2))
    # B09 the cheaper one tries first
    typing(c, "B09", 20.0, "fix the proration drift in src/billing", 30, -31, 0.05,
           "typed: fix the proration drift in src/billing", "B09: 20.0-21.3 K2 30 cps")
    A(Cue("b09-send", F(1280), "send", -17, "B09", "send", "B09: 21.333 (11.1) send", {}, 0.05, S_UI, 1))
    A(Cue("b09-row1", F(1296), "row_tick", -28, "B09", "step row rises", "B09: rows rise 21.6", {"f": 3136.0},
          0.0, S_UI, 3))
    A(Cue("b09-row2", F(1312), "row_tick", -28, "B09", "step row rises", "B09: rows rise 21.867", {"f": 3520.0},
          0.0, S_UI, 3))
    # B10 a failed test buys the next rung
    A(Cue("b10-failed", F(1376), "muted_note", -19, "B10", "npm test failed (quiet, as the product draws it)",
          "B10: a dull muted note on 'failed', no alarm", {"f": hz(62)}, 0.0, {"room": -12.0, "hall": -22.0}, 2))
    A(Cue("b10-row-rollback", F(1408), "row_tick", -28, "B10", "row: rolled back and escalated", "B10: 23.467",
          {"f": 2793.8}, 0.0, S_UI, 3))
    A(Cue("b10-rollback", F(1420), "rollback", -23, "B10", "invoice.ts folds back to its lines (12 f)",
          "B10: the strip folds back in 12 f", {"dur": 0.2}, 0.0, {"room": -12.0}, 2, "end", lead=0.2))
    A(Cue("b10-climb1", F(1424), "brass_step", -11, "B10", "the ladder's marker leaves Sol",
          "B10: rising two-note step on the climb (23.733)", {"m": 72}, 0.06, {"plate": -9.0, "hall": -15.0}, 1))
    A(Cue("b10-climb2", F(1440), "brass_step", -10, "B10", "the marker lands on Astra",
          "B10: the climb, travel 16 f", {"m": 77}, 0.1, {"plate": -9.0, "hall": -15.0}, 1))
    A(Cue("b10-row3", F(1440), "row_tick", -30, "B10", "row: rounded once per invoice", "B10: 24.0",
          {"f": 3136.0}, 0.0, S_UI, 3))
    A(Cue("b10-passed", F(1472), "bright_pluck", -9, "B10", "npm test passed", "B10: one bright pluck on 'passed'",
          {"m": 84}, 0.0, {"plate": -9.0, "delay": -16.0, "hall": -16.0}, 1))
    # B11 the breath
    A(Cue("b11-click", F(1568), "click", -26, "B11", "cursor clicks Bots", "B11: 26.133 (13.2)", {}, -0.18,
          S_UI, 2))
    A(Cue("b11-thumb", F(1583), "thumb_tick", -28, "B11", "the thumb slides back and lands", "B11: thumb lands",
          {}, -0.18, S_UI, 3))
    # B12 the whole team, from a terminal
    typing(c, "B12", 27.867, 'boopis run --group release "write the release notes"', 30, -31, -0.25,
           "typed: the boopis run command", "B12: 27.867 K2 30 cps")
    A(Cue("b12-enter", F(1792), "enter_key", -13, "B12", "Enter, on the downbeat: the drop",
          "B12: 29.867 (15.1) Enter is the drop", {}, -0.25, {"room": -12.0}, 1))
    # B13 the run, live in the open room: terminal and room share one sound (wide)
    A(bot("b13-kai", F(1808), "kai", -12, "B13", "kai's block and entry", "B13: 15.1.5", "wide"))
    A(bot("b13-vox", F(1840), "vox", -13, "B13", "vox's block and entry", "B13: 15.2.5", "wide"))
    A(bot("b13-kai2", F(1856), "kai", -12.5, "B13", "kai's block and entry", "B13: 15.3", "wide"))
    A(Cue("b13-gather", F(1856), "gather", -30, "B13", "vox and kai gather into a huddle", "B13: 15.3", {}, 0.25,
          S_UI, 3))
    A(Cue("b13-done", F(1872), "wood", -28, "B13", "the done line; the prompt returns", "B13: 15.3.5",
          {"f": hz(74), "decay": 0.014}, -0.25, S_UI, 3))
    # B14 same thread, from your other apps
    A(Cue("b14-poke", F(1984), "rubber_poke", -7, "B14", "click on nina's orb in the dock: the poke (boop)",
          "B14: 33.067 (16.3) the dock poke, a soft rubbery tick", {"m": NINA}, 0.0, S_BOOP, 1))
    A(Cue("b14-slab", F(1984), "slab_rise", -30, "B14", "the slab morphs up on its springs", "B14: 33.067",
          {}, 0.0, {"hall": -18.0}, 3, "texture"))
    A(Cue("b14-click", F(2020), "click", -25, "B14", "cursor clicks the other app's field", "B14: 33.4-33.67",
          {}, 0.25, S_UI, 2))
    typing(c, "B14", F(2020), "nina, go ahead with staging", 30, -32, 0.25, "typed: nina, go ahead with staging",
           "B14: 33.67-34.57 K2")
    A(Cue("b14-send", F(2080), "send", -18, "B14", "send from the other app", "B14: 34.667 (17.2) send", {}, 0.25,
          S_UI, 1))
    # B15 nothing ships until you hold
    A(Cue("b15-land", F(2080), "wood", -27, "B15", "the same message lands in boopis's dock",
          "B15: 34.667 the same frame, in both places", {"f": hz(81), "decay": 0.02}, -0.05, S_UI, 2))
    A(Cue("b15-stream-dock", F(2096), "grains", -31, "B15", "nina's reply streams (dock)",
          "B15: 34.933-35.6 soft granular texture", {"dur": 0.667, "center": hz(84), "seed": 1}, -0.05,
          {"plate": -14.0}, 3, "texture"))
    A(Cue("b15-stream-app", F(2096), "grains", -32, "B15", "the same words stream in the other app",
          "B15: in both places at once", {"dur": 0.667, "center": hz(84), "seed": 2}, 0.25, {"plate": -14.0}, 3,
          "texture"))
    A(Cue("b15-attention", F(2144), "attention", -13, "B15", "the approval card rises: needs you",
          "B15: 35.733 (17.4) one low attention tone, no alarm", {"f": hz(55)}, 0.0,
          {"plate": -12.0, "hall": -12.0}, 1))
    # B16 the hold
    A(Cue("b16-push", F(2235), "air", -35, "B16", "the camera pushes in on the hold button",
          "B16: 36.8-37.333", {"dur": 0.62, "peak": 0.45, "lo": 120.0, "hi": 900.0}, 0.0, {}, 3, "peak", lead=0.45))
    A(Cue("b16-press", F(2244), "press", -19, "B16", "the cursor presses Hold to approve",
          "B16: presses at 37.4 (18.3 + 4 f)", {}, 0.0, S_UI, 1))
    A(Cue("b16-tone", F(2244), "rising_tone", -15, "B16", "the hold: one tone rising for exactly 60 f",
          "B16: 37.4-38.4 silence but one tone rising for exactly 60 f", {"dur": 1.0}, 0.0,
          {"plate": -14.0, "hall": -17.0}, 1, "span"))
    A(Cue("b16-hit", F(2304), "low_hit", -8, "B16", "Approved: the full chord lands with a low hit",
          "B16: on 19.1 the full chord lands with a low hit", {"f": hz(29), "size": 1.3}, 0.0, {"hall": -8.0}, 1))
    # B17 the tagline
    A(Cue("b17-air", F(2384), "air", -34, "B17", "T7 focus pull (a breath)", "B17: 39.467-40.0",
          {"dur": 0.6, "peak": 0.27, "lo": 200.0, "hi": 1500.0}, 0.0, {"hall": -16.0}, 3, "peak", lead=0.27))
    for k, (who, f) in enumerate((("kai", 2368), ("nina", 2400), ("moss", 2432), ("vox", 2464))):
        c.append(Cue(f"b17-{who}", F(f), "mallet", -15 - 0.5 * k, "B17", f"{who}'s note restated",
                     "B17: the bots' four notes, restated slowly, one per beat", {"m": NOTE[who]}, 0.0,
                     {"plate": -8.0, "hall": -12.0, "delay": -17.0}, 2))
    # B18 the eyes become the wordmark
    A(Cue("b18-inhale", F(2552), "inhale", -33, "B18", "nina's body shrinks behind her eyes",
          "B18: 42.133-42.533", {"dur": 0.4}, 0.0, {"hall": -16.0}, 3, "texture", lead=0.4))
    A(Cue("b18-boop-left", F(2551), "boop", -10, "B18", "her eyes become the logo's ovals: boop (left o)",
          "B18: the logo's 0.38 s morph lands 42.513; the signature returns", {"m": KAI, "size": 1.2}, -0.06,
          S_BOOP, 1))
    A(Cue("b18-boop-right", F(2555), "boop", -10, "B18", "boop (right o)", "B18: the two o's",
          {"m": NINA, "size": 1.2}, 0.06, S_BOOP, 1))
    for k, (ltr, m, f, p) in enumerate((("b", 84, 2560, -0.15), ("p", 86, 2563, 0.04), ("i", 89, 2566, 0.10),
                                        ("s", 91, 2569, 0.15))):
        A(Cue(f"b18-tap-{ltr}", F(f), "letter_tap", -20 - 0.5 * k, "B18", f"letter '{ltr}' lands",
              "B18: 42.4-42.933 letters arrive, 48 ms stagger; the letters' soft wooden taps", {"f": hz(m)}, p,
              {"room": -12.0, "plate": -16.0}, 2))
    A(Cue("b18-tap-dot", F(2576), "letter_tap", -23, "B18", "the i's dot bounces", "B18: the i's dot, own bounce",
          {"f": hz(93)}, 0.10, {"room": -12.0, "plate": -16.0}, 2))
    # B19 the end card
    A(Cue("b19-blink", F(2784), "boop", -30, "B19", "the logo blinks once (tiny boop)",
          "B19: blink 46.4; a tiny tick on the blink", {"m": 89, "size": 0.4}, 0.0, {"plate": -14.0}, 2))
    return sorted(c, key=lambda q: q.t)


# ── the 15 s cut (14.933 s, 7 bars) ───────────────────────────────────────────────────────────────────────────────

def cut15_cues() -> list[Cue]:
    """cutdowns.md section 3. C5 keeps the master's B18 choreography, shifted to settle on 7.1 (12.8): -1824 f."""
    c: list[Cue] = []
    A = c.append
    A(bot("c1-kai", F(64), "kai", -13, "C1", "kai speaks", "C1 = B01", -0.18))
    A(bot("c1-nina", F(96), "nina", -13, "C1", "nina answers", "C1 = B01", 0.18))
    A(Cue("c1-dive", F(148), "dive", -19, "C1", "zoom-through into kai's eye", "C1 = B01",
          {"dur": 0.40, "peak": 0.20}, 0.0, {"hall": -14.0}, 2, "peak", lead=0.20))
    A(Cue("c1-thump", F(160), "thump", -11, "C1", "swap lands", "C1 = B01", {"f": hz(38)}, 0.0, {"hall": -12.0}, 1))
    for k, (m, f) in enumerate(zip((81, 84, 86, 89), (184, 187, 190, 193))):
        A(Cue(f"c2-button{k + 1}", F(f), "wood", -24 + 0.5 * k, "C2", f"button {k + 1} settles",
              "C2: buttons fan out 2.667-3.07", {"f": hz(m)}, 0.0, {"room": -12.0}, 2))
    A(Cue("c2-morph", F(224), "air", -32, "C2", "buttons morph into cards", "C2: 3.47-4.0",
          {"dur": 0.6, "peak": 0.27, "lo": 300.0, "hi": 2600.0}, 0.0, {"hall": -18.0}, 3, "peak", lead=0.27))
    for k, (who, f, p) in enumerate((("nina", 248, -0.06), ("moss", 256, 0.06), ("kai", 264, -0.06),
                                     ("vox", 272, 0.06))):
        A(bot(f"c2-eyes-{who}", F(f), who, -15 - 0.4 * k, "C2", f"{who}'s eyes open", "C2: eyes open on sixteenths "
              "(4.13 to 4.4)", p))
    A(Cue("c2-flight", F(292), "air", -33, "C2", "orbs fly into the room's head", "C2: cards collapse 4.8-5.067",
          {"dur": 0.45, "peak": 0.25, "lo": 400.0, "hi": 3000.0, "pan_from": 0.25, "pan_to": -0.25}, 0.0, {}, 3,
          "peak", lead=0.25))
    for k, (m, f) in enumerate(zip((77, 72, 69, 65), (304, 307, 310, 313))):
        A(Cue(f"c2-stack{k + 1}", F(f), "wood", -28, "C2", f"orb {k + 1} tucks in", "C2: T1 into the head stack",
              {"f": hz(m), "decay": 0.016}, -0.2, {"room": -14.0}, 3))
    typing(c, "C3", 5.2, "@kai is it ready to cut?", 28, -31, 0.05, "typed: @kai is it ready to cut?",
           "C3: typed 5.2-6.1", chip=("@kai", "kai"))
    A(Cue("c3-send", F(368), "send", -17, "C3", "send", "C3: send 6.133", {}, 0.05, S_UI, 1))
    A(bot("c3-kai", F(384), "kai", -12, "C3", "kai's reply lands whole", "C3: 4.1 (6.4)", -0.08))
    A(bot("c4-nina", F(448), "nina", -12.5, "C4", "nina's message", "C4: 4.3", -0.08))
    A(bot("c4-moss", F(464), "moss", -12.5, "C4", "moss's message", "C4: 4.3.5", -0.08))
    A(Cue("c4-gather", F(464), "gather", -27, "C4", "they gather into the live huddle", "C4", {}, -0.08, S_UI, 3))
    A(bot("c4-kai", F(480), "kai", -12, "C4", "kai's lands: the chord", "C4: 4.4", -0.08))
    A(bot("c4-chord-nina", F(480), "nina", -22, "C4", "the chord: nina", "C4: 4.4", -0.1, tier=3))
    A(bot("c4-chord-moss", F(480), "moss", -22.5, "C4", "the chord: moss", "C4: 4.4", -0.04, tier=3))
    typing(c, "C4", 8.067, "@nina stage it next", 28, -31, 0.05, "typed: @nina stage it next", "C4: 8.07-8.7",
           chip=("@nina", "nina"))
    A(Cue("c4-send", F(528), "send", -24, "C4", "send", "C4: send 8.8", {}, 0.05, S_UI, 2))
    A(Cue("c4-hit", F(528), "low_hit", -8, "C4", "the huddle folds (low warm hit)", "C4: 8.8",
          {"f": hz(29), "size": 0.8}, 0.0, S_HIT, 1))
    A(bot("c4-fall1", F(528), "nina", -13, "C4", "fold: note 1", "C4: 8.8", 0.0))
    A(Cue("c4-fold", F(528), "fold", -30, "C4", "the fold", "C4: 8.8", {"dur": 0.3}, 0.0, S_UI, 3))
    A(Cue("c4-fall2", F(546), "mallet", -11.5, "C4", "fold lands: note 2", "C4: --dur-3 after 8.8", {"m": 65}, 0.0,
          S_BOT, 1))
    A(Cue("c5-push", F(684), "air", -32, "C5", "the camera pushes into nina's orb", "C5: 10.667-11.733",
          {"dur": 1.2, "peak": 0.73, "lo": 150.0, "hi": 1400.0}, 0.0, {"hall": -18.0}, 3, "peak", lead=0.73))
    A(Cue("c5-inhale", F(728), "inhale", -33, "C5", "her body shrinks behind her eyes", "C5 (= B18 - 1824 f)",
          {"dur": 0.4}, 0.0, {"hall": -16.0}, 3, "texture", lead=0.4))
    A(Cue("c5-boop-left", F(727), "boop", -10, "C5", "eyes become the logo's ovals: boop", "C5 (= B18 - 1824 f)",
          {"m": KAI, "size": 1.2}, -0.06, S_BOOP, 1))
    A(Cue("c5-boop-right", F(731), "boop", -10, "C5", "boop (right o)", "C5", {"m": NINA, "size": 1.2}, 0.06,
          S_BOOP, 1))
    for k, (ltr, m, f, p) in enumerate((("b", 84, 736, -0.15), ("p", 86, 739, 0.04), ("i", 89, 742, 0.10),
                                        ("s", 91, 745, 0.15))):
        A(Cue(f"c5-tap-{ltr}", F(f), "letter_tap", -20 - 0.5 * k, "C5", f"letter '{ltr}' lands", "C5: letters spring in",
              {"f": hz(m)}, p, {"room": -12.0, "plate": -16.0}, 2))
    A(Cue("c5-tap-dot", F(752), "letter_tap", -23, "C5", "the i's dot", "C5", {"f": hz(93)}, 0.10,
          {"room": -12.0, "plate": -16.0}, 2))
    A(Cue("c6-blink", F(864), "boop", -30, "C6", "the logo blinks (tiny boop)", "C6: one blink (7.4)",
          {"m": 89, "size": 0.4}, 0.0, {"plate": -14.0}, 2))
    return sorted(c, key=lambda q: q.t)


# ── the 6 s bumper ────────────────────────────────────────────────────────────────────────────────────────────────

def bumper_cues() -> list[Cue]:
    """cutdowns.md section 4. D2 is the master's B18 shifted by -2384 f (body shrink 2.4, settled 3.47)."""
    c: list[Cue] = []
    A = c.append
    A(bot("d1-kai", F(64), "kai", -13, "D1", "kai speaks", "D1: kai speaks (1.3)", -0.18))
    A(bot("d1-nina", F(96), "nina", -13, "D1", "nina answers", "D1: nina answers (1.4)", 0.18))
    A(Cue("d2-push", F(165), "air", -32, "D2", "the camera pushes into nina", "D2: 2.4-2.933",
          {"dur": 0.6, "peak": 0.35, "lo": 150.0, "hi": 1400.0}, 0.0, {"hall": -18.0}, 3, "peak", lead=0.35))
    A(Cue("d2-inhale", F(168), "inhale", -33, "D2", "her body shrinks behind her eyes", "D2: 2.4",
          {"dur": 0.4}, 0.0, {"hall": -16.0}, 3, "texture", lead=0.4))
    A(Cue("d2-boop-left", F(167), "boop", -10, "D2", "eyes become the logo's ovals: boop", "D2 (= B18 - 2384 f)",
          {"m": KAI, "size": 1.2}, -0.06, S_BOOP, 1))
    A(Cue("d2-boop-right", F(171), "boop", -10, "D2", "boop (right o)", "D2", {"m": NINA, "size": 1.2}, 0.06,
          S_BOOP, 1))
    for k, (ltr, m, f, p) in enumerate((("b", 84, 176, -0.15), ("p", 86, 179, 0.04), ("i", 89, 182, 0.10),
                                        ("s", 91, 185, 0.15))):
        A(Cue(f"d2-tap-{ltr}", F(f), "letter_tap", -20 - 0.5 * k, "D2", f"letter '{ltr}' lands",
              "D2: the letters spring in", {"f": hz(m)}, p, {"room": -12.0, "plate": -16.0}, 2))
    A(Cue("d2-tap-dot", F(192), "letter_tap", -23, "D2", "the i's dot", "D2", {"f": hz(93)}, 0.10,
          {"room": -12.0, "plate": -16.0}, 2))
    A(Cue("d3-blink", F(352), "boop", -30, "D3", "the logo blinks; the cut lands on it", "D3: the cut lands on the "
          "logo's blink (3.4)", {"m": 89, "size": 0.4}, 0.0, {"plate": -14.0}, 2))
    return sorted(c, key=lambda q: q.t)


CUTS = {
    "film": {"length": FILM, "cues": film_cues},
    "cut15": {"length": CUT15, "cues": cut15_cues},
    "bumper": {"length": BUMPER, "cues": bumper_cues},
}
