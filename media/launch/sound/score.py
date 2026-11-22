"""The score: the music of the three cuts, written as data on the film's grid and rendered by the voices.

Key of F major, 112.5 BPM. The bots' notes (A4 kai, C5 nina, E5 moss, G5 vox) are the upper structure of Fmaj9, and
every chord the music passes through (F, Dm, Bb lydian, C sus and 6/9, Gm) holds them, so whenever a bot speaks the
room harmonises. F is "the team together": the fold, the drop and the release all resolve to it.

The master's shape, section by section (bar.beat):
  1.1   the hook: a warm open Fmaj9 already sounding at frame 0 (pad and electric piano, pre-rolled), kai and nina
  2.2   the promise: Dm9 under the thump, a low sustained bass; 3.1 Bb lydian, the pad lifts as the eyes open
  4.3   the room: the felt kick on 1 and 3, the clean sub walking in eighths, a soft off-beat pulse
  8.3   the fold: C9sus4 resolves to F on the fold's frame
  10.1  the turn at the governed beat: D minor, the bass insistent on its root, the hats enter on the off-beats;
        11.4 the bass stumbles for two eighths after the failed test, then climbs Gm, Bb, C with the ladder
  13.1  the breath: the band thins to pad and bass, the pad's filter opens slowly for two bars (the riser, without
        a riser); the last eighth before the drop is held empty
  15.1  the drop on Enter: four-on-the-floor felt kick, double-time hats, the bass doubles (a sub under a 16th
        pulse), the pulse on every off-beat
  17.4  everything falls away to a C pedal under the attention tone; the pedal stops on the press (37.4)
  19.1  the release: the full chord on the hold's completion; the tagline over its tail, Bb/F to F (amen)
  21.1  the music stops as the letters land; the electric piano's last chord rings out under the wordmark
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .lib.dsp import SR, TAU, butter, chorus, curve, db, eq, hz, make_ir, n_of, pan, place, reverb, sweep
from .lib.voices import ep, hat, kick, pad_note, sub_bass
from .timeline import BAR, BEAT, BUMPER, CUT15, FILM, F, at

PRE = 2.0  # seconds rendered before frame 0, so the hook's chord is already sounding
STOP = 0.008  # a stop's 30 ms release starts this much before its frame, so the music is heard stopped on it

PAD = {
    "F": [53, 57, 60, 64, 67],          # F3 A3 C4 E4 G4
    "Dm": [50, 53, 57, 60, 64],         # D3 F3 A3 C4 E4
    "Bb": [46, 53, 57, 60, 62],         # Bb2 F3 A3 C4 D4
    "Csus": [48, 55, 58, 62, 65],       # C3 G3 Bb3 D4 F4  (C9sus4)
    "C69": [48, 55, 57, 62, 64],        # C3 G3 A3 D4 E4
    "Gm": [43, 53, 57, 58, 62],         # G2 F3 A3 Bb3 D4  (Gm9)
    "BbF": [53, 57, 58, 62, 65],        # F3 A3 Bb3 D4 F4  (Bbmaj7/F)
    "Fbig": [41, 53, 57, 60, 64, 67, 72, 77],  # the release: F2 F3 A3 C4 E4 G4 C5 F5 (the hold tone ends on F5)
}
KEYS = {
    "Fopen": [41, 48, 55, 57, 64],      # F2 C3 G3 A3 E4: the warm open chord
    "F": [48, 53, 57, 64, 67],
    "Dm": [50, 53, 57, 60, 64],
    "Bb": [46, 53, 57, 60, 62],
    "Csus": [48, 53, 58, 62, 67],
    "C69": [48, 52, 57, 62, 67],
    "Gm": [43, 50, 53, 57, 58],
    "BbF": [41, 50, 53, 57, 58],
    "Fbig": [41, 48, 57, 64, 67, 72],
}


@dataclass
class Arr:
    length: float
    pads: list = field(default_factory=list)       # (t0, t1, chord, attack, release, level_db)
    keys: list = field(default_factory=list)       # (t, chord, vel, dur)
    stabs: list = field(default_factory=list)      # (t, chord, vel)  the soft pulse
    bass: list = field(default_factory=list)       # (t, midi, dur, vel, attack, release)
    pulse: list = field(default_factory=list)      # (t, midi, vel)  the drop's 16th bass
    kicks: list = field(default_factory=list)      # (t, vel)
    hats: list = field(default_factory=list)       # (t, vel, decay)
    fc: list = field(default_factory=list)         # pad low-pass cutoff (t, Hz)
    lfo: list = field(default_factory=lambda: [(0.0, 0.18)])  # pad filter breathing depth (t, depth)
    arc: list = field(default_factory=lambda: [(0.0, 0.0)])   # music level (t, dB)
    fade_end: tuple = (1e9, 1e9)
    markers: list = field(default_factory=list)    # music cues for the sync audit: (id, t, label, how)


def eighths(bar: int, notes: list, vel: float = 0.9, gate: float = 0.82) -> list:
    """A bar of walking eighths: on-beats firm, off-beats lighter, octave ghosts soft."""
    out = []
    root = next((n for n in notes if n is not None), 0)
    for k, m in enumerate(notes):
        if m is None:
            continue
        v = vel * (1.0 if k % 2 == 0 else 0.78) * (0.62 if m >= root + 12 else 1.0)
        out.append((at(f"{bar}.1") + k * BEAT / 2, m, gate * BEAT / 2, v, 0.006, 0.04))
    return out


def beats_between(a: str, b: str, step: float = 1.0, offset: float = 0.0, only: tuple | None = None) -> list:
    """Grid times from bar.beat a (inclusive) to b (exclusive) every `step` beats, optionally only on some beats."""
    t, end, out = at(a) + offset * BEAT, at(b), []
    while t < end - 1e-9:
        beat_in_bar = round(((t / BEAT) % 4) + 1, 4)
        if only is None or any(abs(beat_in_bar - o) < 1e-6 for o in only):
            out.append(t)
        t += step * BEAT
    return out


# ── the master ────────────────────────────────────────────────────────────────────────────────────────────────────

def film_arr() -> Arr:
    A = Arr(FILM)
    A.pads = [
        (-PRE, at("2.2"), "F", 1.0, 0.6, -1.0), (at("2.2"), at("3.1"), "Dm", 0.25, 0.6, -3.0),
        (at("3.1"), at("4.3"), "Bb", 0.4, 0.5, -3.0), (at("4.3"), at("6.1"), "F", 0.2, 0.5, -4.0),
        (at("6.1"), at("7.1"), "Dm", 0.25, 0.5, -4.0), (at("7.1"), at("8.1"), "Bb", 0.25, 0.5, -4.0),
        (at("8.1"), at("8.3"), "Csus", 0.2, 0.4, -4.0), (at("8.3"), at("10.1"), "F", 0.08, 0.5, -3.0),
        (at("10.1"), at("11.1"), "Dm", 0.12, 0.5, -5.0), (at("11.1"), at("12.1"), "Gm", 0.2, 0.5, -5.0),
        (at("12.1"), at("12.3"), "Bb", 0.15, 0.4, -5.0), (at("12.3"), at("13.1"), "C69", 0.12, 0.5, -4.0),
        (at("13.1"), at("14.1"), "Bb", 0.3, 0.6, -3.0), (at("14.1"), at("15.1") - BEAT / 2, "Csus", 0.3, 0.12, -2.0),
        (at("15.1"), at("16.1"), "F", 0.02, 0.4, -2.0), (at("16.1"), at("17.1"), "Dm", 0.08, 0.4, -2.0),
        (at("17.1"), at("17.4"), "Bb", 0.08, 0.35, -2.0),
        (at("19.1"), at("20.1"), "Fbig", 0.015, 0.6, -3.5), (at("20.1"), at("20.4"), "BbF", 0.3, 0.6, -3.0),
        (at("20.4"), at("21.1") - STOP, "F", 0.3, 0.03, -4.0),
    ]
    A.keys = [
        (-0.3, "Fopen", 0.55, 2.6), (at("2.2"), "Dm", 0.42, 1.6), (at("3.1"), "Bb", 0.40, 3.0),
        (at("4.3"), "F", 0.36, 1.0), (at("6.1"), "Dm", 0.33, 1.9), (at("7.1"), "Bb", 0.33, 1.9),
        (at("8.1"), "Csus", 0.33, 1.0), (at("8.3"), "F", 0.46, 2.0), (at("10.1"), "Dm", 0.42, 1.9),
        (at("11.1"), "Gm", 0.36, 1.5), (at("12.1"), "Bb", 0.38, 1.0), (at("12.3"), "C69", 0.42, 1.0),
        (at("13.1"), "Bb", 0.45, 2.1), (at("14.1"), "Csus", 0.38, 1.9),
        (at("15.1"), "F", 0.50, 1.9), (at("16.1"), "Dm", 0.45, 1.9), (at("17.1"), "Bb", 0.45, 1.5),
        (at("19.1"), "Fbig", 0.75, 2.1), (at("20.1"), "BbF", 0.45, 1.6), (at("20.4"), "Fopen", 0.50, 3.6),
    ]
    chord_at = lambda t: next((ch for t0, t1, ch, *_ in A.pads if t0 <= t < t1), "F")
    # the soft pulse: the and-of-2 and and-of-4 in the room; every off-beat in the drop
    for t in beats_between("4.3", "13.1", 1.0, 0.5, only=(2.5, 4.5)):
        A.stabs.append((t, chord_at(t), 0.22))
    for t in beats_between("15.1", "17.4", 1.0, 0.5):
        A.stabs.append((t, chord_at(t), 0.25))
    # bass: sustained under the promise and the cast, then walking eighths through the proofs
    A.bass = [(at("2.2"), 38, at("3.1") - at("2.2"), 0.55, 0.3, 0.4), (at("3.1"), 34, at("4.3") - at("3.1"), 0.55, 0.3, 0.2)]
    walk = {
        4: [None, None, None, None, 29, 41, 36, 40],
        5: [29, 41, 36, 29, 33, 36, 40, 37], 6: [38, 50, 45, 38, 41, 45, 36, 35],
        7: [34, 46, 41, 34, 38, 41, 34, 35], 8: [36, 48, 43, 36, 29, 41, 36, 40],
        9: [29, 41, 36, 29, 33, 36, 40, 37],
        10: [38, 38, 50, 38, 38, 50, 38, 30],          # the turn: insistent on D
        11: [31, 43, 31, 31, 38, 31, None, None],      # 11.4: the failed test; the bass stumbles for two eighths
        12: [34, 46, 41, 34, 36, 48, 43, 35],          # the climb: Bb, then C on 'passed'
    }
    for bar, notes in walk.items():
        A.bass += eighths(bar, notes)
    A.bass.append((at("13.1"), 34, BAR, 0.75, 0.15, 0.3))                       # the breath: one long Bb
    A.bass += eighths(14, [36, 48, 36, 48, 36, 48, 36, None], vel=0.7)        # building; the last eighth empty
    # the drop: the sub on every beat, a 16th pulse an octave up between (the bass doubles)
    roots = {15: (29, 41), 16: (38, 50), 17: (34, 46)}
    for t in beats_between("15.1", "17.4"):
        bar = int(t / BAR) + 1
        sub, hi = roots[bar]
        A.bass.append((t, sub, BEAT * 0.9, 0.8, 0.004, 0.05))
        for k, v in ((1, 0.45), (2, 0.75), (3, 0.5)):
            A.pulse.append((t + k * BEAT / 4, hi, v))
    A.bass.append((at("17.4"), 36, F(2244) - STOP - at("17.4"), 0.85, 0.35, 0.03))   # the pedal, cut on the press
    A.bass.append((at("19.1"), 29, at("21.1") - STOP - at("19.1"), 1.0, 0.004, 0.03))  # the release, to the stop
    A.kicks = [(t, 1.0) for t in beats_between("4.3", "13.1", 2.0)]
    A.kicks += [(t, 1.0) for t in beats_between("15.1", "17.4")]
    A.hats = [(t, 0.7, 0.045) for t in beats_between("10.1", "13.1", 1.0, 0.5)]
    for t in beats_between("15.1", "17.4", 0.25):
        pos = round((t / BEAT) % 1, 3) % 1.0
        A.hats.append((t, {0.0: 0.32, 0.25: 0.42, 0.5: 0.65, 0.75: 0.45}[pos], 0.05 if pos == 0.5 else 0.024))
    A.fc = [(0, 2250), (at("2.2"), 1950), (at("3.1"), 2250), (5.867, 2250), (6.1, 3900), (at("4.3"), 3150),
            (16.0, 3150), (16.1, 3750), (at("10.1"), 3600), (at("10.1") + 0.12, 1875), (at("12.1"), 1950),
            (at("12.1") + 0.15, 2550), (at("12.3"), 2700), (at("12.3") + 0.1, 3300), (at("13.1"), 3300),
            (at("13.1") + 0.08, 975), (at("15.1") - 0.02, 9750), (at("15.1"), 6300), (at("17.4"), 6300),
            (at("19.1"), 4800), (at("20.4"), 3600), (FILM, 3600)]
    A.lfo = [(0, 0.18), (at("13.1"), 0.18), (at("13.1") + 0.1, 0.0), (at("15.1"), 0.0), (at("15.1") + 0.1, 0.12),
             (FILM, 0.15)]
    A.arc = [(0, 0.0), (at("13.1"), -3.0), (at("15.1") - 0.3, 0.0), (at("15.1"), 1.5), (at("17.4"), 1.5), (at("19.1"), 0.5), (FILM, 0.5)]
    A.fade_end = (45.9, 46.85)
    A.markers = [
        ("m-groove", at("4.3"), "the room: the groove enters (felt kick, walking sub)", "onset"),
        ("m-fold", at("8.3"), "the fold resolves to F", "onset"),
        ("m-turn", at("10.1"), "the turn at the governed beat (D minor)", "onset"),
        ("m-drop", at("15.1"), "the drop on Enter", "onset"),
        ("m-fall", at("17.4"), "falls away to a bass pedal (a 0.35 s release, not a hit)", "fall"),
        ("m-pedal", F(2244), "the pedal stops on the press", "stop"),
        ("m-release", at("19.1"), "the release: the full chord", "onset"),
        ("m-stop", at("21.1"), "the music stops as the letters land", "stop"),
    ]
    return A


# ── the 15 s cut ──────────────────────────────────────────────────────────────────────────────────────────────────

def cut15_arr() -> Arr:
    A = Arr(CUT15)
    fold = at("5.1.5")   # 8.8
    A.pads = [
        (-PRE, at("2.2"), "F", 1.0, 0.6, -1.0), (at("2.2"), at("3.1"), "Dm", 0.25, 0.6, -3.0),
        (at("3.1"), at("4.1"), "Bb", 0.4, 0.5, -3.0), (at("4.1"), at("4.3"), "F", 0.15, 0.5, -4.0),
        (at("4.3"), fold, "C69", 0.15, 0.4, -4.0), (fold, at("6.1"), "F", 0.06, 0.5, -3.0),
        (at("6.1"), at("6.3"), "BbF", 0.3, 0.6, -3.0), (at("6.3"), at("6.4") - STOP, "F", 0.3, 0.03, -4.0),
    ]
    A.keys = [(-0.3, "Fopen", 0.55, 2.6), (at("2.2"), "Dm", 0.42, 1.6), (at("3.1"), "Bb", 0.40, 2.0),
              (at("4.1"), "F", 0.38, 1.0), (at("4.3"), "C69", 0.36, 1.4), (fold, "F", 0.46, 1.8),
              (at("6.1"), "BbF", 0.42, 1.0), (at("6.3"), "Fopen", 0.50, 2.4)]
    chord_at = lambda t: next((ch for t0, t1, ch, *_ in A.pads if t0 <= t < t1), "F")
    for t in beats_between("3.3", "6.1", 1.0, 0.5, only=(2.5, 4.5)):
        A.stabs.append((t, chord_at(t), 0.22))
    A.bass = [(at("2.2"), 38, at("3.1") - at("2.2"), 0.55, 0.3, 0.4), (at("3.1"), 34, at("3.3") - at("3.1"), 0.55, 0.3, 0.1)]
    A.bass += eighths(3, [None, None, None, None, 34, 46, 41, 28])
    A.bass += eighths(4, [29, 41, 36, 29, 36, 48, 43, 35])
    A.bass += [b for b in eighths(5, [36, 29, 41, 36, 29, 41, 36, 40])]
    A.bass.append((at("6.1"), 29, at("6.4") - STOP - at("6.1"), 0.8, 0.05, 0.03))
    A.kicks = [(t, 1.0) for t in beats_between("3.3", "6.1", 2.0)]
    A.fc = [(0, 2250), (at("2.2"), 1950), (4.133, 2250), (4.4, 3900), (at("3.3"), 3150), (fold, 3600),
            (at("6.1"), 2700), (at("6.3"), 4500), (CUT15, 4500)]
    A.lfo = [(0, 0.18), (at("6.1"), 0.18), (at("6.1") + 0.1, 0.0), (CUT15, 0.0)]
    A.fade_end = (13.7, 14.88)
    A.markers = [("m-groove", at("3.3"), "the room: the groove enters", "onset"),
                 ("m-fold", fold, "the fold resolves to F", "onset"),
                 ("m-stop", at("6.4"), "the music stops as the letters land", "stop")]
    return A


# ── the 6 s bumper ────────────────────────────────────────────────────────────────────────────────────────────────

def bumper_arr() -> Arr:
    A = Arr(BUMPER)
    A.pads = [(-PRE, at("2.1"), "F", 1.0, 0.6, -1.0), (at("2.1"), 2.4, "BbF", 0.2, 0.5, -3.0),
              (2.4, F(176) - STOP, "F", 0.2, 0.03, -3.0)]
    A.keys = [(-0.3, "Fopen", 0.55, 2.2), (at("2.1"), "BbF", 0.40, 0.4), (2.4, "Fopen", 0.50, 2.6)]
    A.bass = [(2.4, 29, F(176) - STOP - 2.4, 0.6, 0.08, 0.03)]
    A.fc = [(0, 2250), (2.4, 3900), (BUMPER, 3900)]
    A.lfo = [(0, 0.15), (BUMPER, 0.15)]
    A.fade_end = (5.0, 5.97)
    A.markers = [("m-stop", F(176), "the music stops as the letters land", "stop")]
    return A


ARRS = {"film": film_arr, "cut15": cut15_arr, "bumper": bumper_arr}


# ── rendering ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _duck(n: int, times: list, depth_db: float, release: float = 0.24, attack: float = 0.004) -> np.ndarray:
    """A sidechain gain curve from the kick: a fast dip, a curved recovery over `release`."""
    g = np.zeros(n)
    a, r = n_of(attack), n_of(release)
    shape = np.concatenate([np.linspace(0, 1, a, endpoint=False), (1 - np.linspace(0, 1, r)) ** 2])
    for t in times:
        i = n_of(t + PRE)
        j = min(n, i + len(shape))
        if j > i:
            g[i:j] = np.maximum(g[i:j], shape[: j - i])
    return 10 ** (-depth_db * g / 20)


def render(cut: str) -> dict:
    """Render a cut's music. Returns stereo stems (already cropped to the cut) and the parts for analysis."""
    A = ARRS[cut]()
    n = n_of(A.length + PRE)
    t_abs = np.arange(n) / SR - PRE
    # pad
    pad = np.zeros((2, n))
    for k, (t0, t1, ch, att, rel, lev) in enumerate(A.pads):
        for j, m in enumerate(PAD[ch]):
            x = pad_note(hz(m), max(0.05, t1 - t0), att, rel, voices=3, detune=9.0, seed=k * 17 + j)
            place(pad, x * 0.24, t0 + PRE, lev)
    fc = curve(n, A.fc, -PRE, log=True)
    depth = curve(n, A.lfo, -PRE)
    fc = fc * (1 + depth * np.sin(TAU * t_abs / (2 * BAR)))
    pad = sweep(pad, "lp", fc, q=0.85)
    pad = butter(pad, "highpass", 90.0, 2)
    pad = eq(pad, "peak", 420.0, 0.8, -4.5)
    pad = chorus(pad, 13.0, 2.0, (0.21, 0.27), 0.35, seed=3)
    # keys: the electric piano, and the soft pulse (short, darker)
    keys = np.zeros((2, n))
    for k, (t, ch, vel, dur) in enumerate(A.keys):
        for j, m in enumerate(KEYS[ch]):
            x = ep(hz(m), dur, vel * (0.92 + 0.08 * ((j * 7 + k) % 3)), seed=k * 13 + j)
            place(keys, x * 0.12, t + PRE + 0.004 * j)   # a slight roll, the hand is not a machine
    stabs = np.zeros((2, n))
    for k, (t, ch, vel) in enumerate(A.stabs):
        for j, m in enumerate(KEYS[ch][1:]):
            place(stabs, ep(hz(m + 12 if m < 55 else m), 0.17, vel, seed=500 + k * 7 + j, release=0.08) * 0.11, t + PRE)
    stabs = butter(stabs, "lowpass", 2600.0, 2)
    t_keys = np.arange(n) / SR
    trem = 0.22 * np.sin(TAU * 4.6 * t_keys)
    keys = chorus(keys + stabs, 9.0, 1.6, (0.33, 0.41), 0.3, seed=5)
    keys = np.stack([keys[0] * (1 + trem), keys[1] * (1 - trem)])
    keys = butter(keys, "highpass", 60.0, 2)   # the 1:1 FM sideband sits near DC
    keys = eq(eq(keys, "peak", 320.0, 1.0, -2.0), "peak", 520.0, 1.0, -2.5)
    # bass
    bass = np.zeros(n)
    for k, (t, m, dur, vel, att, rel) in enumerate(A.bass):
        x = sub_bass(hz(m), dur, vel, att, rel, seed=k)
        i = n_of(t + PRE)
        j = min(n, i + len(x))
        bass[i:j] += x[: j - i] * 0.42
    pulse = np.zeros(n)
    for k, (t, m, vel) in enumerate(A.pulse):
        x = sub_bass(hz(m), BEAT / 4 * 0.7, vel, 0.003, 0.03, seed=900 + k)
        i = n_of(t + PRE)
        j = min(n, i + len(x))
        pulse[i:j] += x[: j - i] * 0.16
    pulse = butter(pulse, "lowpass", 1800.0, 2)
    # drums
    kicks = np.zeros(n)
    for k, (t, vel) in enumerate(A.kicks):
        x = kick(vel, seed=k)
        i = n_of(t + PRE)
        j = min(n, i + len(x))
        kicks[i:j] += x[: j - i] * 0.5
    hats = np.zeros((2, n))
    for k, (t, vel, dec) in enumerate(A.hats):
        place(hats, pan(hat(vel, dec, seed=k), 0.15 + 0.05 * ((k % 3) - 1)), t + PRE, -5.0)
    # sidechain from the kick (deeper in the drop)
    kt = [t for t, _ in A.kicks]
    drop = [t for t in kt if t >= at("15.1")] if cut == "film" else []
    room = [t for t in kt if t not in drop]
    sc_pad = _duck(n, room, 4.5) * _duck(n, drop, 7.0)
    sc_keys = _duck(n, kt, 3.0)
    sc_bass = _duck(n, kt, 6.0, release=0.16)
    pad *= sc_pad
    keys *= sc_keys
    bass = (bass + pulse) * sc_bass
    # space
    hall = make_ir(2.9, seed=11, predelay=0.024, brightness=7000.0)
    plate = make_ir(1.5, seed=12, predelay=0.008, early=6, low_x=0.9, high_x=0.8, brightness=9000.0)
    room_ir = make_ir(0.45, seed=13, predelay=0.004, early=10, early_span=0.03)
    wet = (reverb(pad, hall) * db(-9.0) + reverb(keys, plate) * db(-10.0) + reverb(keys, hall) * db(-16.0)
           + reverb(hats, room_ir) * db(-12.0) + reverb(np.stack([kicks, kicks]), room_ir, hp=120.0) * db(-22.0))
    music = pad + keys + pan(bass, 0.0) + pan(kicks, 0.0) + hats + wet
    # arc and the end
    music *= 10 ** (curve(n, A.arc, -PRE) / 20)
    f0, f1 = A.fade_end
    music *= np.clip((f1 - t_abs) / max(1e-3, f1 - f0), 0.0, 1.0) ** 2
    crop = slice(n_of(PRE), n)
    parts = {"pad": pad[:, crop], "keys": keys[:, crop], "bass": bass[crop], "kick": kicks[crop], "hats": hats[:, crop]}
    return {"music": music[:, crop], "parts": parts, "arr": A}
