"""The mix: the effects bus (every cue, its spaces), the music under it, and the master.

The master is linear up to one gain curve: bus EQ on each stem, then a glue compressor, the loudness gain and a
look-ahead true-peak limiter, all computed on the sum and applied as one gain curve to each stem. So the delivered
stems (music, effects) sum to the master, and either can be remixed against the other.
"""
from __future__ import annotations

import zlib

import numpy as np
from scipy import ndimage

from .lib import voices as V
from .lib.dsp import (butter, compressor_gain, db, env_follow, eq, limiter_gain, make_ir, n_of, pan, pingpong,
                      reverb)
from .lib.meter import lufs, tp_db
from .timeline import BEAT, CUTS, Cue, hz

TARGET_LUFS = -14.0
MUSIC_TRIM = -4.0   # the score under the picture's sounds
CEILING_DBTP = -1.3


def _seed(c: Cue) -> int:
    return zlib.crc32(c.id.encode()) % 100000


def voice(c: Cue) -> np.ndarray:
    """The cue's sound, mono or stereo, sample 0 at its start (t - lead)."""
    p, k, s = c.p, c.kind, _seed(c)
    if k == "mallet":
        return V.mallet(hz(p["m"]), 1.0, p.get("bright", 1.0), seed=s)
    if k == "boop":
        return V.boop(hz(p["m"]), p.get("size", 1.0), seed=s)
    if k == "key_tick":
        return V.key_tick(p["seed"], p["space"])
    if k == "chip":
        return V.chip(hz(p["m"]))
    if k == "click":
        return V.click(seed=s)
    if k == "send":
        return V.send()
    if k == "press":
        return V.press()
    if k == "breath_tick":
        return V.breath_tick(s)
    if k == "row_tick":
        return V.row_tick(p.get("f", 3136.0), s)
    if k == "wood":
        return V.wood(p["f"], p.get("decay", 0.028), s)
    if k == "thumb_tick":
        return V.thumb_tick(s)
    if k == "letter_tap":
        return V.letter_tap(p["f"], s)
    if k == "rubber_poke":
        return V.rubber_poke(hz(p["m"]))
    if k == "slab_rise":
        return V.slab_rise()
    if k == "muted_note":
        return V.muted_note(p["f"])
    if k == "brass_step":
        return V.brass_step(hz(p["m"]))
    if k == "bright_pluck":
        return V.bright_pluck(hz(p["m"]))
    if k == "attention":
        return V.attention(p["f"])
    if k == "low_hit":
        return V.low_hit(p["f"], p.get("size", 1.0), s)
    if k == "thump":
        return V.thump(p["f"])
    if k == "enter_key":
        return V.enter_key()
    if k == "rising_tone":
        return V.rising_tone(p["dur"])
    if k == "dive":
        return V.dive(p["dur"], p["peak"], s)
    if k == "air":
        return V.air(p["dur"], p["peak"], p.get("lo", 250.0), p.get("hi", 2200.0), p.get("pan_from", 0.0),
                     p.get("pan_to", 0.0), s)
    if k == "fold":
        return V.fold(p["dur"], s)
    if k == "gather":
        return V.gather(s)
    if k == "rollback":
        return V.rollback(p["dur"])
    if k == "inhale":
        return V.inhale(p["dur"], s)
    if k == "grains":
        return V.grains(p["dur"], p["center"], seed=p.get("seed", 0))
    raise ValueError(k)


def _stereo(c: Cue, x: np.ndarray) -> np.ndarray:
    if x.ndim == 2:
        return x
    if c.pan == "wide":
        # one thread in two places: the note in the terminal (left) and in the room (right), decorrelated
        y = V.mallet(hz(c.p["m"] + 0.03), 1.0, c.p.get("bright", 1.0), seed=_seed(c) + 1) if c.kind == "mallet" else x
        y = y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))
        return pan(x, -0.32) * 0.75 + pan(y, 0.32) * 0.75
    return pan(x, float(c.pan))


def render_sfx(cut: str, length: float) -> dict:
    """Place every cue; returns the effects stem, the tier-1 copy (for ducking) and each cue's placed signal."""
    n = n_of(length)
    dry = np.zeros((2, n))
    tier1 = np.zeros((2, n))
    sends = {k: np.zeros((2, n)) for k in ("room", "plate", "hall", "delay")}
    placed = []
    for c in CUTS[cut]["cues"]():
        x = _stereo(c, voice(c)) * db(c.gain)
        i0 = n_of(c.t - c.lead)
        a, b = max(0, i0), min(n, i0 + x.shape[1])
        if b <= a:
            continue
        seg = x[:, a - i0:b - i0]
        dry[:, a:b] += seg
        if c.tier == 1:
            tier1[:, a:b] += seg
        for k, v in c.sends.items():
            sends[k][:, a:b] += seg * db(v)
        placed.append((c, i0, x))
    wet = (reverb(sends["room"], make_ir(0.42, seed=21, predelay=0.005, early=10, early_span=0.03))
           + reverb(sends["plate"], make_ir(1.6, seed=22, predelay=0.010, early=6, low_x=0.9, high_x=0.8))
           + reverb(sends["hall"], make_ir(3.0, seed=23, predelay=0.022, brightness=7500.0))
           + pingpong(sends["delay"], 0.75 * BEAT, fb=0.33, taps=6))
    return {"sfx": dry + wet, "dry": dry, "tier1": tier1, "placed": placed}


def duck_curve(tier1: np.ndarray, depth_db: float = 3.5, thresh_db: float = -36.0) -> np.ndarray:
    """The music leans back a little under the focal sound of each moment (fast in, 0.3 s out)."""
    e = 20 * np.log10(env_follow(tier1, 0.01) + 1e-9)
    amt = np.clip((e - thresh_db) / 14.0, 0.0, 1.0)
    amt = ndimage.maximum_filter1d(amt, size=n_of(0.12))
    amt = ndimage.uniform_filter1d(amt, size=n_of(0.18))
    return 10 ** (-depth_db * amt / 20)


def bus_eq(x: np.ndarray) -> np.ndarray:
    """Master EQ (linear, so it can be applied stem by stem): a 28 Hz high-pass (no headroom spent below hearing on
    a phone), a wide 1.5 dB dip at 450 Hz where the pad, the keys and the bots' fundamentals pile up,
    and a 2.5 dB shelf from 3.5 kHz for presence (nothing here plays the role a voice or a snare would)."""
    x = butter(x, "highpass", 28.0, 2)
    x = eq(x, "peak", 450.0, 0.8, -1.5)
    return eq(x, "highshelf", 3500.0, 0.6, 2.5)


def master(music: np.ndarray, sfx: np.ndarray, end_fade: float = 0.25) -> dict:
    """Glue, loudness, true-peak limit; one gain curve applied to both stems."""
    m, s = bus_eq(music), bus_eq(sfx)
    mix = m + s
    n = mix.shape[1]
    G = db(TARGET_LUFS - lufs(mix))
    glue = compressor_gain(mix * G, threshold_db=-17.0, ratio=1.8, attack=0.015, release=0.22)
    fade = np.ones(n)
    k = n_of(end_fade)
    fade[n - k:] = np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    j = n_of(0.003)   # frame 0: the chord is already sounding, but playback never starts on a click
    fade[:j] *= np.sin(np.linspace(0, np.pi / 2, j)) ** 2
    for _ in range(6):
        y = mix * G * glue * fade
        lim = limiter_gain(y, CEILING_DBTP)
        out = y * lim
        L = lufs(out)
        if abs(L - TARGET_LUFS) < 0.03:
            break
        G *= db(TARGET_LUFS - L)
    g = G * glue * fade * lim
    out = mix * g
    tp = tp_db(out)
    if tp > CEILING_DBTP + 0.02:   # the limiter's control rate can leave a sliver over; trim it
        g *= db(CEILING_DBTP - tp)
        out = mix * g
    return {"master": out, "music": m * g, "sfx": s * g, "gain": g, "glue": glue, "limiter": lim,
            "pre_limit_tp": tp_db(mix * G * glue * fade)}
