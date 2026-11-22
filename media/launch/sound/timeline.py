"""The picture's timeline as the sound sees it: the grid, and every effect cue of the three cuts.

Acts 1 and 4 (B01 to B04, B14 to B19) are timed to the animation: the act builders (media/launch/src/acts/a1/*.ts,
a4/*.ts, the source of truth, frame-accurate through the grid helpers) checked frame by frame against their renders
(SC/renders/a1-1080.mp4, a4-1080.mp4). Each of those cues keeps the frame it had before (`was`) and says how its frame
was found (`check`), and the sync audit lists them. Acts 2 and 3 (B05 to B13) are still timed from the approved
script (SC/script/beats.json, script.md) and storyboard, until they are animated. The cut-downs' act 1 and act 4 beats
follow the same builders under the cut-downs' edits (src/acts/edit.ts), computed from the code.

Everything is on the film's grid: 112.5 BPM, 60 fps, 32 frames a beat, 128 a bar. A cue sits on the frame where the
picture does the thing: a press bottoming out, a landing (the frame a move reaches its end), or for anything that
starts from nothing on a frame (a character, a wipe, a blink, a face starting to move) the first frame where it is
visible, the next one. When a scene lands somewhere else, change the frame here (one line) and rebuild; the sync audit
then measures the new mix against the new frames.

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
    was: int | None = None       # re-timed to animated picture: the frame it had before
    check: str = ""              # how its frame was found: "code", "code + render", "render"

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


def first_visible(T: float) -> int:
    """The first frame on which something that starts at time T (from nothing, on its ease) shows."""
    return math.floor(T * FPS + 1e-6) + 1


TYPING_WAS: dict[str, tuple[int, int, int]] = {}   # a re-timed typed line: (keys, first frame, last frame) before


def keys(cues: list, beat: str, pairs: list, gain: float, pan: float, label: str, src: str, check: str,
         was: tuple[int, int, int] | None = None) -> None:
    """Typed keys at explicit times: [(start time, character, accent)], each sounding on its first visible frame;
    an accent (a word's first letter after a space the picture does not draw) sounds a little heavier."""
    for i, (T, ch, acc) in enumerate(pairs):
        space = ch == " " or acc
        cues.append(Cue(f"{beat.lower()}-key{i:02d}", F(first_visible(T)), "key_tick", gain + (1.5 if space else 0.0),
                        beat, f"key '{ch}'" if ch != " " else "key (space)", src,
                        {"seed": sum(map(ord, beat)) * 101 + i, "space": space}, pan, S_KEY, 3, group=label,
                        check=check))
    if was:
        TYPING_WAS[f"{beat}:{label}"] = was


def k2_pairs(start: float, text: str, cps: float, slot0: int = 0) -> list:
    """K2 as the act builders type into a composer: every character a slot of 1/cps, spaces included."""
    return [(start + (slot0 + i) / cps, ch, False) for i, ch in enumerate(text)]


def typeon_pairs(start: float, text: str, cps: float) -> list:
    """K2 as motion/type.ts typeOn types: the drawn characters only, i at start + i/cps (spaces take no time)."""
    out, i, word_start = [], 0, False
    for ch in text:
        if ch == " ":
            word_start = True
            continue
        out.append((start + i / cps, ch, word_start))
        i += 1
        word_start = False
    return out


def rt(c: Cue, was: int | None, check: str) -> Cue:
    """A cue re-timed to animated picture: the frame it had before, and how its new frame was found."""
    c.was, c.check = was, check
    return c


CODE, REND, RENDER = "code", "code + render", "render"


BOT_GAIN = 2.0  # the bots' notes sit this much over the per-cue values (which set the balance within the family)


def bot(cid, t, who, gain, beat, label, src, pan=0.0, tier=1, **kw) -> Cue:
    return Cue(cid, t, "mallet", gain + BOT_GAIN, beat, label, src, {"m": NOTE[who], **kw}, pan, S_BOT, tier)


# ── the master (46.93 s) ──────────────────────────────────────────────────────────────────────────────────────────

def film_cues() -> list[Cue]:
    c: list[Cue] = []
    A = c.append
    # ── act 1 (0 to 9.600 s), timed to the animation: src/acts/a1/b01.ts to b04.ts, checked on a1-1080.mp4 ──
    # B01: kai talks on beat 2, nina answers on beat 3 (speak(): the stretch and the speaking eyes start on the beat,
    # after a dip, and show the next frame); the dive is a 24 f snap into kai's eye
    A(rt(bot("b01-kai", F(65), "kai", -13, "B01", "kai speaks to nina (call)", "a1/b01.ts speak(kai) on beat 2",
             -0.18), 64, CODE))
    A(rt(bot("b01-nina", F(97), "nina", -13, "B01", "nina answers (response)", "a1/b01.ts speak(nina) on beat 3",
             0.18), 96, CODE))
    A(rt(Cue("b01-dive", F(148), "dive", -19, "B01", "T2: the dive into kai's eye (24 f snap)",
             "a1/b01.ts dive 2.267-2.667 on snap; render: the largest frame change is on 148",
             {"dur": 0.40, "peak": 0.20}, 0.0, {"hall": -14.0}, 2, "peak", lead=0.20), 148, REND))
    A(rt(Cue("b01-thump", F(155), "thump", -11, "B01", "the eye fills the frame: the dive lands",
             "render: the dive's motion ends on 155 (155 to 160 are still; the swap on 160 is invisible)",
             {"f": hz(38)}, 0.0, {"hall": -12.0}, 1), 160, RENDER))
    # B02: the four plans' labels wipe on down the column once the promise has landed, one a sixteenth
    for k, (m, f, plan) in enumerate(zip((81, 84, 86, 89), (217, 225, 233, 241), ("ChatGPT", "GitHub", "Claude", "xAI"))):
        A(rt(Cue(f"b02-plan{k + 1}", F(f), "wood", -24 + 0.5 * k, "B02", f"'Sign in with {plan}' wipes on",
                 "a1/b02.ts labels on beat 6.75 + i/4; render: 217, 225, 233, 241", {"f": hz(m)}, 0.0,
                 {"room": -12.0}, 2), (184, 187, 190, 193)[k], REND))
    # B03: shells to cards (T8), the eyes open on sixteenths, a bounce ripples down, vox blinks, the orbs fly (T1)
    A(rt(Cue("b03-morph", F(326), "air", -32, "B03", "T8: the shells become cards (air)",
             "a1/b03.ts four shells, travel 32 f, 4 f apart (304 to 348)",
             {"dur": 0.75, "peak": 0.367, "lo": 300.0, "hi": 2600.0}, 0.0, {"hall": -18.0}, 3, "peak", lead=0.367),
         324, CODE))
    for k, (who, f, p_) in enumerate((("nina", 353, -0.1), ("moss", 361, -0.1), ("kai", 369, -0.1),
                                      ("vox", 377, -0.1))):
        A(rt(bot(f"b03-eyes-{who}", F(f), who, -15 - 0.4 * k, "B03", f"{who}'s eyes open",
                 "a1/b03.ts wake on beat 11, 11.25, 11.5, 11.75 (shows the next frame)", p_), f - 1, CODE))
    for who, m, f in (("nina", 88, 385), ("moss", 86, 388), ("kai", 84, 391), ("vox", 81, 394)):
        A(rt(Cue(f"b03-ripple-{who}", F(f), "wood", -30, "B03", f"{who} bounces (the ripple down the column)",
                 "a1/b03.ts bounce at 6.4 + 3 f each; render: 385, 388, 391, 394", {"f": hz(m), "decay": 0.014},
                 -0.1, {"room": -14.0}, 3), None, REND))
    A(rt(Cue("b03-vox-blink", F(401), "boop", -31, "B03", "vox wakes last and blinks (the boop, small)",
             "a1/b03.ts blink(vox) on beat 12.5; render: 401", {"m": 91, "size": 0.45}, -0.1, {"plate": -14.0}, 3),
         384, REND))
    A(rt(Cue("b03-flight", F(437), "air", -33, "B03", "T1: the orbs arc up and left into the head stack",
             "a1/b03.ts flights 418 to 457, travel 30 f, 3 f apart",
             {"dur": 0.62, "peak": 0.317, "lo": 400.0, "hi": 3000.0, "pan_from": -0.05, "pan_to": -0.28}, 0.0, {}, 3,
             "peak", lead=0.317), 433, CODE))
    for k, (m, f) in enumerate(zip((77, 72, 69, 65), (448, 451, 454, 457))):
        A(rt(Cue(f"b03-stack{k + 1}", F(f), "wood", -28, "B03", f"{('kai', 'nina', 'moss', 'vox')[k]} lands in the stack",
                 "a1/b03.ts kai lands on beat 14, each 3 f after the one before", {"f": hz(m), "decay": 0.016}, -0.22,
                 {"room": -14.0}, 3), f, CODE))
    # B04: the cursor clicks the composer on beat 15, the line types (K2, 28 cps: "@kai", the chip, the rest from
    # slot 5), send on beat 17 (the button dips), your request lifts into the thread, kai's presence rises
    A(rt(Cue("b04-click", F(480), "click", -24, "B04", "the cursor clicks into the composer",
             "a1/b04.ts press bottoms out on beat 15", {}, 0.05, S_UI, 2), 480, CODE))
    keys(c, "B04", k2_pairs(8.0, "@kai", 28) + k2_pairs(8.0, " is it ready to cut?", 28, slot0=5), -31, 0.05,
         "typed: @kai is it ready to cut?", "a1/b04.ts K2 at 28 cps from beat 15", REND, was=(24, 481, 530))
    A(rt(Cue("b04-chip-kai", F(first_visible(8.0 + 4 / 28 + 2 / 60)), "chip", -25.0, "B04",
             "'@kai' folds into a mention chip", "a1/b04.ts chipAt = 4 slots + 2 f", {"m": KAI + 12}, 0.05,
             {"plate": -12.0, "delay": -24.0}, 2), 487, CODE))
    A(rt(Cue("b04-send", F(544), "send", -17, "B04", "send (the button dips to .96)", "a1/b04.ts press on beat 17",
             {}, 0.05, S_UI, 1), 544, CODE))
    A(rt(Cue("b04-presence", F(557), "breath_tick", -27, "B04", "kai's presence rises (thinking)",
             "a1/b04.ts presence 12 f after send, --dur-2 (shows the next frame)", {}, -0.05, S_UI, 3), 556, CODE))
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
    A(bot("b13-kai", F(1808), "kai", -10.5, "B13", "kai's block and entry", "B13: 15.1.5", "wide"))
    A(bot("b13-vox", F(1840), "vox", -11.5, "B13", "vox's block and entry", "B13: 15.2.5", "wide"))
    A(bot("b13-kai2", F(1856), "kai", -11, "B13", "kai's block and entry", "B13: 15.3", "wide"))
    A(Cue("b13-gather", F(1856), "gather", -30, "B13", "vox and kai gather into a huddle", "B13: 15.3", {}, 0.25,
          S_UI, 3))
    A(Cue("b13-done", F(1872), "wood", -28, "B13", "the done line; the prompt returns", "B13: 15.3.5",
          {"f": hz(74), "decay": 0.014}, -0.25, S_UI, 3))
    # ── act 4 (32.000 s to the end), timed to the animation: src/acts/a4/desk.ts and close.ts, checked on a4-1080.mp4 ──
    # B14: one click on nina's orb in the dock (16.3): the poke, the slab grows up on the dock's springs; the cursor
    # clicks the other app's field and the message types (typeOn: the drawn letters only, 30 cps from b(3.15))
    A(rt(Cue("b14-poke", F(1984), "rubber_poke", -5, "B14", "click on nina's orb in the dock: the poke (boop)",
             "a4/desk.ts press bottoms out on b(2)", {"m": NINA}, 0.0, S_BOOP, 1), 1984, CODE))
    A(rt(Cue("b14-slab", F(1984), "slab_rise", -30, "B14", "the slab grows up on the dock's springs",
             "a4/desk.ts open from the click", {}, 0.0, {"hall": -18.0}, 3, "texture"), 1984, CODE))
    A(rt(Cue("b14-click", F(2020), "click", -25, "B14", "the cursor clicks the other app's field",
             "a4/desk.ts press bottoms out on b(3.125)", {}, 0.25, S_UI, 2), 2020, CODE))
    keys(c, "B14", typeon_pairs(32.0 + 3.15 * BEAT, "nina, go ahead with staging", 30), -32, 0.25,
         "typed: nina, go ahead with staging", "a4/desk.ts typeOn at b(3.15), 30 cps", CODE, was=(27, 2021, 2073))
    # B15: on send (17.2: its time is 34.667, so the switch shows on 2081) the message is yours in both places; nina's
    # reply streams in both; her approval card rises on b(2)
    A(rt(Cue("b15-send", F(2081), "send", -18, "B15", "send: the field clears, the message leaves the other app",
             "a4/desk.ts the field clears on b(0) of B15 (34.667: shows on 2081)", {}, 0.25, S_UI, 1), 2080, CODE))
    A(rt(Cue("b15-land", F(2081), "wood", -27, "B15", "the same message lands in boopis's dock session",
             "a4/desk.ts both rows grow on b(0)", {"f": hz(81), "decay": 0.02}, -0.05, S_UI, 2), 2080, CODE))
    A(rt(Cue("b15-stream-dock", F(2097), "grains", -31, "B15", "nina's reply streams (dock)",
             "a4/desk.ts typeOn on b(0.5), 1.25 beats", {"dur": 0.6, "center": hz(84), "seed": 1}, -0.05,
             {"plate": -14.0}, 3, "texture"), 2096, CODE))
    A(rt(Cue("b15-stream-app", F(2097), "grains", -32, "B15", "the same words stream in the other app",
             "a4/desk.ts the same typeOn in the app", {"dur": 0.6, "center": hz(84), "seed": 2}, 0.25,
             {"plate": -14.0}, 3, "texture"), 2096, CODE))
    A(rt(Cue("b15-attention", F(2145), "attention", -13, "B15", "the approval card rises: needs you",
             "a4/desk.ts the card grows on b(2) (--dur-3), nina's face to wide", {"f": hz(55)}, 0.0,
             {"plate": -12.0, "hall": -12.0}, 1), 2144, CODE))
    # B16: the camera pushes in on its (critically damped) spring, the cursor presses at 37.4, 60 frames of fill,
    # the smash cut to "Approved" on 19.1
    A(rt(Cue("b16-push", F(2213), "air", -35, "B16", "the camera pushes in on the hold button",
             "render: the push moves from 2209 and is fastest on 2211 to 2215",
             {"dur": 0.6, "peak": 5 / 60, "lo": 120.0, "hi": 900.0}, 0.0, {}, 3, "peak", lead=5 / 60), 2235, RENDER))
    A(rt(Cue("b16-press", F(2244), "press", -19, "B16", "the cursor presses Hold to approve",
             "a4/desk.ts press bottoms out at 38.4 - 1 s", {}, 0.0, S_UI, 1), 2244, CODE))
    A(rt(Cue("b16-tone", F(2244), "rising_tone", -15, "B16", "the hold: one tone rising for exactly 60 f",
             "a4/desk.ts the fill runs exactly 60 frames from the press", {"dur": 1.0}, 0.0,
             {"plate": -14.0, "hall": -17.0}, 1, "span"), 2244, CODE))
    A(rt(Cue("b16-hit", F(2304), "low_hit", -8, "B16", "Approved: the full chord lands with a low hit",
             "a4/desk.ts film.cut on 19.1", {"f": hz(29), "size": 1.3}, 0.0, {"hall": -8.0}, 1), 2304, CODE))
    # B17: T7 (the focus pull, nina lifts off the head) from 39.467; she lands on 2400; mid-line a hop of joy
    A(rt(Cue("b17-air", F(2384), "air", -34, "B17", "T7: the focus pull (a breath)",
             "a4/close.ts focus pull 32 f on travel; render: peak change on 2384",
             {"dur": 0.6, "peak": 0.27, "lo": 200.0, "hi": 1500.0}, 0.0, {"hall": -16.0}, 3, "peak", lead=0.27),
         2384, REND))
    for who, f, was, what, src in (("kai", 2369, 2368, "nina lifts off the head: kai's note", "a4/close.ts lift from 39.467"),
                                   ("moss", 2400, 2432, "she lands in the lower third: moss's note", "a4/close.ts lift lands T0 + 32 f"),
                                   ("vox", 2432, 2464, "vox's note, on the beat under the tagline", "the bots' notes restated, one per beat"),
                                   ("nina", 2466, 2400, "nina's hop of joy: her own note", "a4/close.ts hop b(2.9), take-off 5 f later")):
        A(rt(Cue(f"b17-{who}", F(f), "mallet", -15 - {"kai": 0, "moss": 0.5, "vox": 1.0, "nina": 0.0}[who],
                 "B17", what, src, {"m": NOTE[who]}, 0.0, {"plate": -8.0, "hall": -12.0, "delay": -17.0}, 2), was, CODE))
    # B18: her body shrinks behind her eyes (0.45 s, depart), the eyes morph into the ovals (the logo's 0.38 s morph,
    # 0.4 here) and turn light; the letters play in from 42.4 (the logo's own springs and gravity, 48 ms apart)
    A(rt(Cue("b18-inhale", F(2555), "inhale", -33, "B18", "nina's body shrinks behind her eyes",
             "a4/logo.ts body away 0.45 s on depart", {"dur": 0.45}, 0.0, {"hall": -16.0}, 3, "texture", lead=0.45),
         2552, CODE))
    A(rt(Cue("b18-boop-left", F(2552), "boop", -10, "B18", "her eyes become the logo's ovals: boop (left o)",
             "a4/logo.ts the morph ends 42.533; render: the eyes still from 2556", {"m": KAI, "size": 1.2}, -0.06,
             S_BOOP, 1), 2551, REND))
    A(rt(Cue("b18-boop-right", F(2556), "boop", -10, "B18", "boop (right o): the body gone, the eyes still",
             "render: no change in the eyes from 2556", {"m": NINA, "size": 1.2}, 0.06, S_BOOP, 1), 2555, RENDER))
    for k, (ltr, m, f, was, p_) in enumerate((("b", 84, 2573, 2560, -0.15), ("p", 86, 2574, 2563, 0.04),
                                              ("i", 89, 2579, 2566, 0.10), ("s", 91, 2580, 2569, 0.15))):
        A(rt(Cue(f"b18-tap-{ltr}", F(f), "letter_tap", -20 - 0.5 * k, "B18", f"letter '{ltr}' lands",
                 "render: the letter's foot back on the baseline (a4/logo.ts playIn from 42.4, 48 ms apart)",
                 {"f": hz(m)}, p_, {"room": -12.0, "plate": -16.0}, 2), was, RENDER))
    A(rt(Cue("b18-tap-dot", F(2604), "letter_tap", -23, "B18", "the i's dot lands from its own bounce",
             "render: the tittle back on rest on 2604", {"f": hz(93)}, 0.10, {"room": -12.0, "plate": -16.0}, 2),
         2576, RENDER))
    # B19: the lines rise under the wordmark (silent: type); the live eyes glance with a blink, then blink once more
    A(rt(Cue("b19-glance-blink", F(2723), "boop", -32, "B19", "the eyes glance, with the blink a glance brings",
             "a4/close.ts eyeBlink at 21.3 + 3 beats + 2 f; render: 2723", {"m": 89, "size": 0.35}, 0.0,
             {"plate": -14.0}, 3), None, REND))
    A(rt(Cue("b19-blink", F(2785), "boop", -30, "B19", "the logo blinks once (tiny boop)",
             "a4/close.ts eyeBlink at 21.3 + 5 beats; render: 2785", {"m": 89, "size": 0.4}, 0.0, {"plate": -14.0},
             2), 2784, REND))
    return sorted(c, key=lambda q: q.t)


# ── the cut-downs: the act builders' clock under an edit (src/acts/edit.ts) ─────────────────────────────────────────

SCRIPT = {"B01": (0.0, 2.667), "B02": (2.667, 5.067), "B03": (5.067, 7.467), "B04": (7.467, 9.6)}  # beats.json


def tm(beat: str, win: tuple[float, float]):
    """An act 1 builder's clock (a1/util.ts tmap): a master time inside `beat`, played in an edit's window (snapped to
    a frame when the beat is re-timed); and the edit's speed against the master."""
    m0, m1 = SCRIPT[beat]
    k = (win[1] - win[0]) / (m1 - m0)
    return (lambda x: x + (win[0] - m0) if abs(k - 1) < 1e-9 else round((win[0] + (x - m0) * k) * FPS) / FPS), k


def arrive_frame(T: float) -> int:
    """The first frame on which a move that ends at time T has arrived."""
    return math.ceil(T * FPS - 1e-6)


# the wordmark's letters land after the logo's own physics (a4/logo.ts playIn): offsets from the letters' start, from
# the master's render (letters start 42.3997 s = frame 2543.98; b has landed on 2573, p 2574, i 2579, s 2580, the dot
# 2604, so each landing lies in the half frame before: the offsets take the middle of that frame)
LETTERS = [("b", 84, 2572.5 - 2543.98, -0.15), ("p", 86, 2573.5 - 2543.98, 0.04), ("i", 89, 2578.5 - 2543.98, 0.10),
           ("s", 91, 2579.5 - 2543.98, 0.15)]
DOT = 2603.5 - 2543.98


def wordmark_cues(A, cue_beat: str, pre: str, push: tuple[float, float], morph_at: float, morph: float, shrink: float,
                  letters_at: float, was: dict) -> None:
    """B18 in a cut-down (a4/close.ts): the push into nina, her body away behind her eyes, the eyes to the ovals, the
    letters playing in."""
    p0, p1 = push
    A(rt(Cue(f"{pre}-push", (p0 + p1) / 2, "air", -32, cue_beat, "the camera pushes into nina (travel)",
             "a4/close.ts cut-down push", {"dur": (p1 - p0) + 0.2, "peak": (p1 - p0) / 2, "lo": 150.0, "hi": 1400.0},
             0.0, {"hall": -18.0}, 3, "peak", lead=(p1 - p0) / 2), was.get("push"), CODE))
    A(rt(Cue(f"{pre}-inhale", F(arrive_frame(morph_at + shrink)), "inhale", -33, cue_beat,
             "her body shrinks behind her eyes", "a4/close.ts body away", {"dur": shrink}, 0.0, {"hall": -16.0}, 3,
             "texture", lead=shrink), was.get("inhale"), CODE))
    A(rt(Cue(f"{pre}-boop-left", F(arrive_frame(morph_at + morph)), "boop", -10, cue_beat,
             "her eyes become the logo's ovals: boop", "a4/close.ts the morph ends", {"m": KAI, "size": 1.2}, -0.06,
             S_BOOP, 1), was.get("boop-left"), CODE))
    A(rt(Cue(f"{pre}-boop-right", F(arrive_frame(morph_at + shrink)), "boop", -10, cue_beat,
             "boop (right o): the body gone", "a4/close.ts the body gone", {"m": NINA, "size": 1.2}, 0.06, S_BOOP, 1),
         was.get("boop-right"), CODE))
    lf = letters_at * FPS
    for k, (ltr, m, off, p_) in enumerate(LETTERS):
        A(rt(Cue(f"{pre}-tap-{ltr}", F(arrive_frame((lf + off) / FPS)), "letter_tap", -20 - 0.5 * k, cue_beat,
                 f"letter '{ltr}' lands", "a4/logo.ts playIn, the master's measured flight", {"f": hz(m)}, p_,
                 {"room": -12.0, "plate": -16.0}, 2), was.get(ltr), CODE))
    A(rt(Cue(f"{pre}-tap-dot", F(arrive_frame((lf + DOT) / FPS)), "letter_tap", -23, cue_beat, "the i's dot lands",
             "a4/logo.ts the tittle's bounce", {"f": hz(93)}, 0.10, {"room": -12.0, "plate": -16.0}, 2),
         was.get("dot"), CODE))


def endcard_cues(A, cue_beat: str, pre: str, win: tuple[float, float], bumper: bool, was: dict) -> None:
    """B19 in a cut-down (a4/close.ts): a glance with its blink at 42% of the window, and one blink (in the bumper,
    the cut lands on it)."""
    w0, w1 = win
    d = w1 - w0
    g_at = w0 + d * 0.42
    b2 = w1 - 0.0775 - 1 / 60 if bumper else w0 + d * 0.8
    A(rt(Cue(f"{pre}-glance-blink", F(first_visible(g_at + 2 / 60)), "boop", -32, cue_beat,
             "the eyes glance, with the blink a glance brings", "a4/close.ts eyeBlink at 42% + 2 f",
             {"m": 89, "size": 0.35}, 0.0, {"plate": -14.0}, 3), None, CODE))
    A(rt(Cue(f"{pre}-blink", F(first_visible(b2)), "boop", -30, cue_beat,
             "the logo blinks" + ("; the cut lands on it" if bumper else ""), "a4/close.ts eyeBlink",
             {"m": 89, "size": 0.4}, 0.0, {"plate": -14.0}, 2), was.get("blink"), CODE))


# ── the 15 s cut (14.933 s, 7 bars) ───────────────────────────────────────────────────────────────────────────────

def cut15_cues() -> list[Cue]:
    """cutdowns.md section 3, as src/acts/edit.ts plays it: C1 is B01; C2 runs B02 and B03 compressed; C3 is B04
    compressed and B05's reply; C4 the huddle and the fold (act 2, still timed from the cut-down's script); C5 is B18's
    cut-down move (push into nina in the folded stack); C6 the end card."""
    c: list[Cue] = []
    A = c.append
    # C1 = B01 unchanged
    A(rt(bot("c1-kai", F(65), "kai", -13, "C1", "kai speaks", "a1/b01.ts (C1 = B01)", -0.18), 64, CODE))
    A(rt(bot("c1-nina", F(97), "nina", -13, "C1", "nina answers", "a1/b01.ts (C1 = B01)", 0.18), 96, CODE))
    A(rt(Cue("c1-dive", F(148), "dive", -19, "C1", "the dive into kai's eye", "a1/b01.ts (C1 = B01)",
             {"dur": 0.40, "peak": 0.20}, 0.0, {"hall": -14.0}, 2, "peak", lead=0.20), 148, REND))
    A(rt(Cue("c1-thump", F(155), "thump", -11, "C1", "the eye fills the frame", "the master's render: 155",
             {"f": hz(38)}, 0.0, {"hall": -12.0}, 1), 160, RENDER))
    # C2 = B02 (2.667 to 3.467) and B03 (3.467 to 5.067), compressed
    t2, _ = tm("B02", (2.667, 3.467))
    for k, (m, plan) in enumerate(zip((81, 84, 86, 89), ("ChatGPT", "GitHub", "Claude", "xAI"))):
        f = first_visible(t2(BEAT * (6.75 + 0.25 * k)))
        A(rt(Cue(f"c2-plan{k + 1}", F(f), "wood", -24 + 0.5 * k, "C2", f"'Sign in with {plan}' wipes on",
                 "a1/b02.ts under the edit", {"f": hz(m)}, 0.0, {"room": -12.0}, 2), (184, 187, 190, 193)[k], CODE))
    t3, k3 = tm("B03", (3.467, 5.067))
    mid = arrive_frame(3.467 + (1.5 * 4 + 16) / 60 * k3)
    A(rt(Cue("c2-morph", F(mid), "air", -32, "C2", "the shells become cards (air)", "a1/b03.ts under the edit",
             {"dur": 0.55, "peak": (1.5 * 4 + 16) / 60 * k3, "lo": 300.0, "hi": 2600.0}, 0.0, {"hall": -18.0}, 3,
             "peak", lead=(1.5 * 4 + 16) / 60 * k3), 224, CODE))
    for j, who in enumerate(("nina", "moss", "kai", "vox")):
        f = first_visible(t3(BEAT * (11 + 0.25 * j)))
        A(rt(bot(f"c2-eyes-{who}", F(f), who, -15 - 0.4 * j, "C2", f"{who}'s eyes open", "a1/b03.ts under the edit",
                 -0.1), (248, 256, 264, 272)[j], CODE))
    for j, (who, m) in enumerate((("nina", 88), ("moss", 86), ("kai", 84), ("vox", 81))):
        f = first_visible(t3(6.4) + j * 3 / 60 * k3)
        A(rt(Cue(f"c2-ripple-{who}", F(f), "wood", -30, "C2", f"{who} bounces", "a1/b03.ts under the edit",
                 {"f": hz(m), "decay": 0.014}, -0.1, {"room": -14.0}, 3), None, CODE))
    A(rt(Cue("c2-vox-blink", F(first_visible(t3(BEAT * 12.5))), "boop", -31, "C2", "vox blinks (the boop, small)",
             "a1/b03.ts under the edit", {"m": 91, "size": 0.45}, -0.1, {"plate": -14.0}, 3), None, CODE))
    land0, fly, st = 5.067, 30 / 60 * k3, 3 / 60 * k3
    A(rt(Cue("c2-flight", F(arrive_frame(land0 - fly / 2 + 1.5 * st)), "air", -33, "C2",
             "the orbs fly into the room's head", "a1/b03.ts under the edit",
             {"dur": fly + 4 * st + 0.1, "peak": fly / 2 + 1.5 * st, "lo": 400.0, "hi": 3000.0, "pan_from": -0.05,
              "pan_to": -0.28}, 0.0, {}, 3, "peak", lead=fly / 2 + 1.5 * st), 292, CODE))
    for j, m in enumerate((77, 72, 69, 65)):
        f = int(math.floor((land0 + j * st) * FPS + 1e-6))
        A(rt(Cue(f"c2-stack{j + 1}", F(f), "wood", -28, "C2", f"{('kai', 'nina', 'moss', 'vox')[j]} lands in the stack",
                 "a1/b03.ts under the edit", {"f": hz(m), "decay": 0.016}, -0.22, {"room": -14.0}, 3),
             (304, 307, 310, 313)[j], CODE))
    # C3 = B04 compressed (5.067 to 6.4): the click, the line at 28/k cps, the chip, send, the presence
    t4, k4 = tm("B04", (5.067, 6.4))
    type_at, cps = t4(8.0), 28 / k4
    A(rt(Cue("c3-click", F(round(type_at * FPS)), "click", -24, "C3", "the cursor clicks into the composer",
             "a1/b04.ts under the edit", {}, 0.05, S_UI, 2), None, CODE))
    keys(c, "C3", k2_pairs(type_at, "@kai", cps) + k2_pairs(type_at, " is it ready to cut?", cps, slot0=5), -31, 0.05,
         "typed: @kai is it ready to cut?", f"a1/b04.ts under the edit ({cps:.1f} cps)", CODE, was=(24, 313, 362))
    A(rt(Cue("c3-chip-kai", F(first_visible(type_at + 4 / cps + 2 / 60)), "chip", -25.0, "C3",
             "'@kai' folds into a mention chip", "a1/b04.ts under the edit", {"m": KAI + 12}, 0.05,
             {"plate": -12.0, "delay": -24.0}, 2), 319, CODE))
    send = t4(BEAT * 17)
    A(rt(Cue("c3-send", F(round(send * FPS)), "send", -17, "C3", "send", "a1/b04.ts under the edit", {}, 0.05, S_UI,
             1), 368, CODE))
    A(rt(Cue("c3-presence", F(first_visible(send + 12 / 60 * k4)), "breath_tick", -27, "C3",
             "kai's presence rises", "a1/b04.ts under the edit", {}, -0.05, S_UI, 3), None, CODE))
    # C3 (B05) and C4 (B06, B07) are act 2: still timed from the cut-down's script
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
    # C5 = B18's cut-down move (10.667 to 12.8): push 0.55 s, a beat alone (0.3 s), the morph 0.36 s, letters 8 f on
    w0 = 10.667
    morph_at = w0 + 0.55 + 0.3
    wordmark_cues(A, "C5", "c5", (w0, w0 + 0.55), morph_at, 0.36, 0.41, morph_at + 8 / 60,
                  {"push": 684, "inhale": 728, "boop-left": 727, "boop-right": 731, "b": 736, "p": 739, "i": 742,
                   "s": 745, "dot": 752})
    # C6 = B19 (12.8 to 14.933)
    endcard_cues(A, "C6", "c6", (12.8, 14.933), False, {"blink": 864})
    return sorted(c, key=lambda q: q.t)


# ── the 6 s bumper ────────────────────────────────────────────────────────────────────────────────────────────────

def bumper_cues() -> list[Cue]:
    """cutdowns.md section 4, as src/acts/edit.ts plays it: B01 compressed into 2.133 s (no dive), B18's hook move
    (push into nina 0.45 s, the morph at once), the end card with the cut on the blink."""
    c: list[Cue] = []
    A = c.append
    t1, _ = tm("B01", (0.0, 2.133))
    A(rt(bot("d1-kai", F(first_visible(t1(BEAT * 2))), "kai", -13, "D1", "kai speaks", "a1/b01.ts under the edit",
             -0.18), 64, CODE))
    A(rt(bot("d1-nina", F(first_visible(t1(BEAT * 3))), "nina", -13, "D1", "nina answers", "a1/b01.ts under the edit",
             0.18), 96, CODE))
    w0 = 2.133
    wordmark_cues(A, "D2", "d2", (w0, w0 + 0.45), w0 + 0.45, 0.36, 0.41, w0 + 0.45 + 8 / 60,
                  {"push": 165, "inhale": 168, "boop-left": 167, "boop-right": 171, "b": 176, "p": 179, "i": 182,
                   "s": 185, "dot": 192})
    endcard_cues(A, "D3", "d3", (3.733, 6.0), True, {"blink": 352})
    return sorted(c, key=lambda q: q.t)


CUTS = {
    "film": {"length": FILM, "cues": film_cues},
    "cut15": {"length": CUT15, "cues": cut15_cues},
    "bumper": {"length": BUMPER, "cues": bumper_cues},
}
