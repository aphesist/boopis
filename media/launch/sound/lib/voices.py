"""The voices: every instrument and every designed effect, synthesised. Each returns a mono array (or a stereo (2, n)
array where the voice carries its own motion), starting at its onset (sample 0 is the attack) and ending on a fade.

Music: pad, keys (an FM electric piano), sub bass, felt kick, soft hats.
Signatures: the bots' mallet notes, the boop (the orbs' eyes), the hold's rising tone.
Interface: key ticks, clicks, the send, mention chips, rows, ticks, the dock poke.
Moves: the dive, air, folds, the rollback, the streaming grains, low hits.
"""
from __future__ import annotations

import numpy as np

from .dsp import (SR, TAU, butter, drift, env_ahr, fade, hz, n_of, norm, pan, phase, pink, ramp_cos, rng, saw,
                  sat, sweep, white)


# ── music ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def pad_note(f: float, dur: float, attack: float = 0.6, release: float = 1.0, voices: int = 4, detune: float = 9.0,
             seed: int = 0) -> np.ndarray:
    """Detuned band-limited saws (spread across the stereo field) plus a sine body; the filter lives on the bus.
    `dur` is the held length; the release is added after it."""
    n = n_of(dur + release)
    r = rng(seed)
    out = np.zeros((2, n))
    for k in range(voices):
        c = detune * (2.0 * k / (voices - 1) - 1.0)
        wob = 1.0 + drift(n, seed * 31 + k, rate=0.3, depth=2.5) / 1200.0 * np.log(2)
        x = saw(f * 2 ** (c / 1200.0) * wob, n, r.random())
        p = 0.75 * (2.0 * k / (voices - 1) - 1.0)
        out += pan(x, p)
    out /= voices
    body = np.sin(phase(f, n, r.uniform(0, TAU))) * 0.35
    out += pan(body, 0.0)
    e = env_ahr(n, attack, max(0.0, dur - attack), release, shape=1.6)
    return out * e


def ep(f: float, dur: float = 2.5, vel: float = 0.6, seed: int = 0, release: float = 0.35) -> np.ndarray:
    """An FM electric piano (tine and bar): the modulation index follows the velocity and falls fast after the strike,
    so a soft note is round and a firm one barks a little. Lower notes ring longer."""
    n = n_of(dur + release)
    t = np.arange(n) / SR
    r = rng(seed)
    idx = (0.6 + 2.2 * vel) * np.exp(-t / 0.22) + 0.35 + 0.25 * vel
    mod = np.sin(phase(f * 1.0005, n, r.uniform(0, TAU)))
    car = np.sin(phase(f, n) + idx * mod)
    tine_f = min(f * 13.92, SR * 0.4)
    tine = 0.16 * vel * np.sin(phase(tine_f, n)) * np.exp(-t / 0.024)
    knock = 0.04 * vel * butter(white(n, seed), "bandpass", [400.0, 2000.0], 2) * np.exp(-t / 0.006)
    tau = 1.9 * (220.0 / f) ** 0.45
    amp = np.exp(-t / tau) * (1.0 - np.exp(-t / 0.0015))
    x = (car + tine) * amp + knock
    x = sat(x * (1.0 + vel), 1.0) / (1.0 + vel) * 1.4
    rel = np.ones(n)
    i = n_of(dur)
    rel[i:] = ramp_cos(n - i)[::-1]
    return fade(x * rel, 0.0, 0.01)


def sub_bass(f: float, dur: float, vel: float = 1.0, attack: float = 0.006, release: float = 0.05,
             seed: int = 0) -> np.ndarray:
    """A clean sub: a sine with soft 2nd and 3rd harmonics (so a phone speaker still hears the line), a touch of
    low-passed saw for definition, gently saturated."""
    n = n_of(dur + release)
    t = np.arange(n) / SR
    ph = phase(f, n, rng(seed).uniform(0, TAU))
    x = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    x += 0.10 * butter(saw(f, n), "lowpass", 420.0, 2)
    x *= np.exp(-t / 1.4)
    x = sat(x, 1.2)
    e = env_ahr(n, attack, max(0.0, dur - attack), release)
    return x * e * vel


def kick(vel: float = 1.0, seed: int = 0) -> np.ndarray:
    """A round, felted kick: a sine falling 118 to 47 Hz, a soft second harmonic, a felt beater (low-passed, no
    click), gently saturated."""
    n = n_of(0.5)
    t = np.arange(n) / SR
    f = 47.0 + 71.0 * np.exp(-t / 0.026)
    ph = phase(f, n)
    body = np.sin(ph) * np.exp(-t / 0.20) * (1 - np.exp(-t / 0.0008))
    body += 0.10 * np.sin(2 * ph) * np.exp(-t / 0.06)
    felt = butter(white(n, 900 + seed), "lowpass", 1400.0, 2) * np.exp(-t / 0.0035) * 0.18
    x = sat(body + felt, 1.8)
    return fade(norm(x) * vel, 0.0, 0.03)


def hat(vel: float = 1.0, decay: float = 0.032, seed: int = 0) -> np.ndarray:
    """A soft hat: band-passed noise with a faint metallic ring, more breath than metal."""
    n = n_of(decay * 6 + 0.01)
    t = np.arange(n) / SR
    r = rng(seed)
    nz = butter(r.standard_normal(n), "bandpass", [6500.0, 13500.0], 2)
    ring = sum(np.sin(phase(fr * (1 + 0.002 * r.standard_normal()), n)) * w
               for fr, w in ((7890.0, 0.25), (9240.0, 0.2), (10580.0, 0.15)))
    x = (0.85 * nz / (np.std(nz) + 1e-9) + 0.25 * ring) * np.exp(-t / decay) * (1 - np.exp(-t / 0.0006))
    return fade(norm(x) * vel, 0.0, 0.004)


# ── signatures ────────────────────────────────────────────────────────────────────────────────────────────────────

def mallet(f: float, vel: float = 1.0, bright: float = 1.0, dur: float = 2.2, seed: int = 0) -> np.ndarray:
    """A bot's voice: a soft synth mallet (round fundamental, the bar's tuned overtone near 4x, a strike shimmer),
    with a tiny upward scoop at the attack, the 'boop' every bot shares."""
    n = n_of(dur)
    t = np.arange(n) / SR
    scoop = 1.0 - 0.012 * np.exp(-t / 0.011)
    ph = phase(f * scoop, n)
    tau = 0.62 * (440.0 / f) ** 0.4
    x = np.sin(ph) * np.exp(-t / tau)
    x += 0.10 * np.sin(2 * ph) * np.exp(-t / (tau * 0.35))
    x += 0.26 * bright * np.sin(3.99 * ph) * np.exp(-t / 0.085)
    if f * 9.92 < SR * 0.42:
        x += 0.07 * bright * np.sin(9.92 * ph) * np.exp(-t / 0.02)
    x += 0.10 * bright * butter(white(n, 77 + seed), "lowpass", 2400.0, 2) * np.exp(-t / 0.003)
    x *= 1.0 - np.exp(-t / 0.0011)
    return fade(norm(x) * vel, 0.0, 0.05)


def boop(f: float, size: float = 1.0, dur: float = 0.42, seed: int = 0) -> np.ndarray:
    """The signature: a soft rounded 'boop'. A lip puff, a vowel that scoops up a fourth into its pitch, a quick
    close. `size` < 1 makes it smaller (a blink), > 1 rounder (the wordmark)."""
    n = n_of(dur)
    t = np.arange(n) / SR
    fr = f * 2.0 ** ((-5.0 / 12.0) * np.exp(-t / (0.016 * size)))
    ph = phase(fr, n)
    x = np.sin(ph) + 0.16 * np.sin(2 * ph) * np.exp(-t / 0.05) + 0.04 * np.sin(3 * ph) * np.exp(-t / 0.03)
    close = 0.11 + 0.08 * size
    amp = (1 - np.exp(-t / 0.0035)) * np.exp(-t / (0.09 * size))
    amp *= np.where(t < close, 1.0, np.exp(-(t - close) / 0.025))
    lip = butter(white(n, 333 + seed), "lowpass", 900.0, 2) * np.exp(-t / 0.004) * 0.10
    x = x * amp + lip
    x = butter(x, "lowpass", 4200.0, 2)
    return fade(norm(x), 0.0, 0.03)


def rising_tone(dur: float = 1.0, m0: float = 60.0, m1: float = 77.0) -> np.ndarray:
    """The hold: one tone that rises for exactly `dur` (60 frames), from C4 to F5, accelerating, its vibrato
    widening, swelling 9 dB; it stops dead at `dur`, where the release chord takes over. Stereo (two voices)."""
    n = n_of(dur)
    t = np.arange(n) / SR
    u = t / dur
    m = m0 + (m1 - m0) * u ** 1.55
    vib = (2.0 + 14.0 * u ** 2) / 100.0 * np.sin(TAU * np.cumsum(5.0 + 2.5 * u) / SR)
    out = []
    for cents in (-3.5, 3.5):
        f = hz(m + vib + cents / 100.0)
        ph = phase(f, n)
        out.append(np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph))
    x = np.stack(out)
    amp = 10 ** ((-9.0 + 9.0 * u ** 1.3) / 20.0) * (1 - np.exp(-t / 0.006))
    x = x * amp
    x[:, -n_of(0.0015):] *= ramp_cos(n_of(0.0015))[::-1]
    return x / np.max(np.abs(x))


# ── interface ─────────────────────────────────────────────────────────────────────────────────────────────────────

def key_tick(seed: int, space: bool = False) -> np.ndarray:
    """A soft key: a short thock body bending down, a filtered click, varied per key so a line never machine-guns."""
    r = rng(1000 + seed)
    n = n_of(0.07)
    t = np.arange(n) / SR
    f0 = (150.0 if space else r.uniform(205.0, 255.0))
    body = np.sin(phase(f0 * (1 + 0.5 * np.exp(-t / 0.004)), n)) * np.exp(-t / (0.016 if space else 0.010))
    click = butter(r.standard_normal(n), "bandpass", [r.uniform(2600, 3300), r.uniform(4800, 6200)], 2)
    click *= np.exp(-t / r.uniform(0.0016, 0.0026)) * (0.6 if space else 0.85)
    x = 0.65 * body + click / (np.std(click[:200]) + 1e-9) * 0.25
    x *= 1 - np.exp(-t / 0.0004)
    return fade(norm(x) * r.uniform(0.82, 1.0), 0.0, 0.01)


def enter_key() -> np.ndarray:
    """The terminal's Enter: a heavier thock, a low body, and the key's return a beat later, very soft."""
    n = n_of(0.22)
    t = np.arange(n) / SR
    body = np.sin(phase(118.0 * (1 + 0.7 * np.exp(-t / 0.005)), n)) * np.exp(-t / 0.035)
    click = butter(white(n, 4242), "bandpass", [2200.0, 5200.0], 2) * np.exp(-t / 0.0025)
    up = np.zeros(n)
    j = n_of(0.085)
    up[j:] = butter(white(n - j, 4243), "bandpass", [2500.0, 6000.0], 2) * np.exp(-t[: n - j] / 0.0015) * 0.25
    x = 0.8 * body + 0.35 * click / (np.std(click[:300]) + 1e-9) * 0.3 + up / (np.std(click[:300]) + 1e-9) * 0.1
    return fade(norm(x), 0.0, 0.02)


def click(f: float = 2300.0, body: float = 190.0, seed: int = 0) -> np.ndarray:
    """A cursor click: tonal rather than mechanical (a tiny damped tone, a soft body, a breath of noise)."""
    n = n_of(0.07)
    t = np.arange(n) / SR
    tone = np.sin(phase(f, n)) * np.exp(-t / 0.0045)
    b = np.sin(phase(body * (1 + 0.6 * np.exp(-t / 0.004)), n)) * np.exp(-t / 0.012) * 0.55
    nz = butter(white(n, 50 + seed), "bandpass", [1800.0, 6500.0], 2) * np.exp(-t / 0.0015) * 0.12
    x = (tone * 0.5 + b + nz) * (1 - np.exp(-t / 0.0004))
    return fade(norm(x), 0.0, 0.01)


def send(f: float = 698.46) -> np.ndarray:
    """The send: a soft tonal 'tup' (F5), dropping into pitch, with a small click; a press bottoming out."""
    n = n_of(0.16)
    t = np.arange(n) / SR
    tone = np.sin(phase(f * (1 + 0.28 * np.exp(-t / 0.005)), n)) * np.exp(-t / 0.045)
    tone += 0.25 * np.sin(phase(2 * f, n)) * np.exp(-t / 0.015)
    c = click(2600.0, 210.0, 9)
    x = tone * (1 - np.exp(-t / 0.0007))
    x[: len(c)] += 0.55 * c
    return fade(norm(x), 0.0, 0.02)


def press(f: float = 523.25) -> np.ndarray:
    """The hold button bottoming out: deeper than a click, a soft cushioned 'thup'."""
    n = n_of(0.2)
    t = np.arange(n) / SR
    body = np.sin(phase(150.0 * (1 + 0.5 * np.exp(-t / 0.006)), n)) * np.exp(-t / 0.03)
    tone = 0.4 * np.sin(phase(f, n)) * np.exp(-t / 0.05)
    nz = butter(white(n, 61), "bandpass", [900.0, 4000.0], 2) * np.exp(-t / 0.002) * 0.15
    return fade(norm((body + tone + nz) * (1 - np.exp(-t / 0.0008))), 0.0, 0.02)


def chip(f: float) -> np.ndarray:
    """A mention chip forming: a tiny glassy FM tink, the mentioned bot's note an octave up."""
    n = n_of(0.5)
    t = np.arange(n) / SR
    idx = 1.8 * np.exp(-t / 0.02)
    x = np.sin(phase(f, n) + idx * np.sin(phase(f * 3.5, n))) * np.exp(-t / 0.11)
    x *= 1 - np.exp(-t / 0.0006)
    return fade(norm(butter(x, "lowpass", 9000.0, 2)), 0.0, 0.03)


def breath_tick(seed: int = 0) -> np.ndarray:
    """A presence entry rising: a soft breathy tick."""
    n = n_of(0.1)
    t = np.arange(n) / SR
    nz = butter(white(n, 70 + seed), "bandpass", [900.0, 4200.0], 2)
    x = nz / (np.std(nz) + 1e-9) * (1 - np.exp(-t / 0.002)) * np.exp(-t / 0.022) * 0.5
    x += 0.35 * np.sin(phase(1396.9, n)) * np.exp(-t / 0.018)
    return fade(norm(x), 0.0, 0.02)


def row_tick(f: float = 3136.0, seed: int = 0) -> np.ndarray:
    """A step row rising in the session: the smallest tick."""
    n = n_of(0.05)
    t = np.arange(n) / SR
    x = np.sin(phase(f, n)) * np.exp(-t / 0.006)
    x += butter(white(n, 80 + seed), "bandpass", [3500.0, 7500.0], 2) * np.exp(-t / 0.0012) * 4.0
    return fade(norm(x * (1 - np.exp(-t / 0.0003))), 0.0, 0.008)


def wood(f: float, decay: float = 0.028, seed: int = 0) -> np.ndarray:
    """A soft wood tick: a damped tone with the block's inharmonic partial and a tiny knock."""
    n = n_of(decay * 7)
    t = np.arange(n) / SR
    x = np.sin(phase(f * (1 + 0.04 * np.exp(-t / 0.003)), n)) * np.exp(-t / decay)
    x += 0.35 * np.sin(phase(f * 2.71, n)) * np.exp(-t / (decay * 0.3))
    x += butter(white(n, 90 + seed), "bandpass", [1500.0, 6000.0], 2) * np.exp(-t / 0.0012) * 2.0
    return fade(norm(x * (1 - np.exp(-t / 0.0004))), 0.0, 0.01)


def thumb_tick(seed: int = 0) -> np.ndarray:
    """A pill's thumb landing: a wood tick, rounder."""
    return wood(1174.66, 0.02, seed)


def rubber_poke(f: float = 523.25) -> np.ndarray:
    """The dock poke: the orb squashes (a dip under the pitch) and boops back up, with a small low squish."""
    n = n_of(0.4)
    t = np.arange(n) / SR
    b = boop(f, 1.0, 0.4, seed=5)
    squish = np.sin(phase(f / 2 * (1 - 0.15 * np.exp(-t / 0.02)), n)) * np.exp(-t / 0.03) * 0.25
    return fade(norm(b[:n] + squish * (1 - np.exp(-t / 0.002))), 0.0, 0.03)


def slab_rise(dur: float = 0.32) -> np.ndarray:
    """The dock's slab growing up on its springs: a soft upward glide, mostly air, settling."""
    n = n_of(dur + 0.1)
    t = np.arange(n) / SR
    u = np.minimum(1.0, t / dur)
    f = 180.0 + 220.0 * (1 - np.exp(-u * 4))
    x = np.sin(phase(f, n)) * np.sin(np.pi * np.minimum(1, t / (dur + 0.1))) ** 2
    a = butter(pink(n, 21), "bandpass", [300.0, 2500.0], 2)
    x = 0.6 * x + 0.4 * a / (np.std(a) + 1e-9) * np.sin(np.pi * np.minimum(1, t / (dur + 0.1))) ** 3
    return fade(norm(x), 0.01, 0.03)


def letter_tap(f: float, seed: int = 0) -> np.ndarray:
    """A letter of the wordmark landing: a soft wooden tap, tuned."""
    return wood(f, 0.024, 300 + seed)


def muted_note(f: float = 293.66) -> np.ndarray:
    """The test failing, as quietly as the product draws it: a damped mallet note that droops a little."""
    n = n_of(0.35)
    t = np.arange(n) / SR
    fr = f * 2 ** ((-0.4 / 12) * (1 - np.exp(-t / 0.05)))
    ph = phase(fr, n)
    x = (np.sin(ph) + 0.25 * np.sin(2 * ph) * np.exp(-t / 0.02)) * np.exp(-t / 0.055)
    x += butter(white(n, 111), "lowpass", 700.0, 2) * np.exp(-t / 0.006) * 0.4
    x = butter(x * (1 - np.exp(-t / 0.0015)), "lowpass", 1400.0, 2)
    return fade(norm(x), 0.0, 0.03)


def brass_step(f: float) -> np.ndarray:
    """A rung of the ladder: a mallet with a soft FM brass glow (the index swells with the note, as brass does)."""
    n = n_of(0.9)
    t = np.arange(n) / SR
    amp = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.3)
    idx = 1.6 * amp
    br = np.sin(phase(f, n) + idx * np.sin(phase(f, n)))
    x = 0.55 * mallet(f, 1.0, 0.7, 0.9, seed=7)[:n] + 0.45 * br * amp
    return fade(norm(butter(x, "lowpass", 5000.0, 2)), 0.0, 0.05)


def bright_pluck(f: float) -> np.ndarray:
    """'passed': one bright pluck with an octave sparkle."""
    n = n_of(1.6)
    t = np.arange(n) / SR
    x = mallet(f, 1.0, 1.4, 1.6, seed=13)
    x += 0.22 * np.sin(phase(2 * f, n)) * np.exp(-t / 0.12) * (1 - np.exp(-t / 0.001))
    return fade(norm(x), 0.0, 0.05)


def attention(f: float = 196.0) -> np.ndarray:
    """Someone is waiting on you: one low warm tone with a slow wavering (two partials beating), not an alarm."""
    n = n_of(1.4)
    t = np.arange(n) / SR
    a = np.sin(phase(f, n)) + np.sin(phase(f * 1.0035, n))
    a += 0.35 * np.sin(phase(2 * f, n)) * np.exp(-t / 0.25)
    a += 0.3 * np.sin(phase(f / 2, n))
    idx = 0.8 * np.exp(-t / 0.08)
    a += 0.3 * np.sin(phase(f, n) + idx * np.sin(phase(f * 2, n)))
    amp = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.55)
    return fade(norm(butter(a * amp, "lowpass", 2500.0, 2)), 0.0, 0.1)


def low_hit(f: float = 43.65, size: float = 1.0, seed: int = 0) -> np.ndarray:
    """A low warm hit that reads on a phone: a falling sub with harmonics at 2x, 3x and 4x, and a soft body."""
    n = n_of(1.2 * size + 0.3)
    t = np.arange(n) / SR
    fr = f * (1 + 1.0 * np.exp(-t / 0.035))
    ph = phase(fr, n)
    x = np.sin(ph) * np.exp(-t / (0.42 * size))
    x += 0.55 * np.sin(2 * ph) * np.exp(-t / (0.16 * size)) + 0.25 * np.sin(3 * ph) * np.exp(-t / 0.09)
    x += 0.12 * np.sin(4 * ph) * np.exp(-t / 0.06)
    x += butter(white(n, 140 + seed), "lowpass", 480.0, 2) * np.exp(-t / 0.05) * 0.5
    x = sat(x * (1 - np.exp(-t / 0.001)), 1.4)
    return fade(norm(x), 0.0, 0.1)


def thump(f: float = 55.0) -> np.ndarray:
    """A soft low thump (a felt tom), for a cut landing."""
    return low_hit(f, 0.55, seed=3)


# ── moves ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def _decor_noise(n: int, seed: int, corr: float = 0.5) -> np.ndarray:
    c = pink(n, seed)
    return np.stack([corr * c + (1 - corr) * pink(n, seed + 1), corr * c + (1 - corr) * pink(n, seed + 2)])


def dive(dur: float = 0.4, peak: float = 0.2, seed: int = 0) -> np.ndarray:
    """The zoom-through into an eye: air rushing up a band-pass that sweeps up to the midpoint, a sung resonance
    inside it, then the eye's dark interior closing it off. Stereo, widening at the peak."""
    n = n_of(dur)
    t = np.arange(n) / SR
    u = np.where(t < peak, t / peak, 1.0)
    fc = np.where(t < peak, 320.0 * (3400.0 / 320.0) ** (u ** 1.3), 3400.0 * np.exp(-(t - peak) / 0.08))
    fc = np.maximum(fc, 260.0)
    nz = _decor_noise(n, 500 + seed, corr=0.35)
    x = sweep(nz, "bp", fc, q=1.1)
    tone = np.sin(phase(fc * 0.5, n)) * 0.25
    x = x / (np.std(x) + 1e-9) + np.stack([tone, tone])
    env = np.where(t < peak, (t / peak) ** 2.6, np.exp(-(t - peak) / 0.055))
    x = x * env
    return fade(x / np.max(np.abs(x)), 0.005, 0.02)


def air(dur: float, peak: float, lo: float = 250.0, hi: float = 2200.0, pan_from: float = 0.0, pan_to: float = 0.0,
        seed: int = 0) -> np.ndarray:
    """Soft moving air for a camera move or a morph: band-limited pink noise, wide, swelling to `peak` and away;
    panned from one side to the other when the move travels. Never a stock whoosh."""
    n = n_of(dur)
    t = np.arange(n) / SR
    nz = _decor_noise(n, 600 + seed, corr=0.6)
    x = butter(nz, "bandpass", [lo, hi], 2)
    x = x / (np.std(x) + 1e-9)
    env = np.where(t < peak, np.sin(0.5 * np.pi * t / peak) ** 2, np.cos(0.5 * np.pi * np.minimum(1, (t - peak) / max(1e-3, dur - peak))) ** 2)
    p = pan_from + (pan_to - pan_from) * np.clip(t / dur, 0, 1)
    th = (p + 1) * np.pi / 4
    x = np.stack([x[0] * np.cos(th) * np.sqrt(2), x[1] * np.sin(th) * np.sqrt(2)]) * env
    return fade(x / np.max(np.abs(x)), 0.003, 0.01)


def fold(dur: float = 0.3, seed: int = 0) -> np.ndarray:
    """A container folding shut: a soft papery noise whose low-pass closes over the fold."""
    n = n_of(dur + 0.08)
    t = np.arange(n) / SR
    fc = 4200.0 * (600.0 / 4200.0) ** np.minimum(1.0, t / dur)
    x = sweep(_decor_noise(n, 700 + seed, 0.7), "lp", fc, q=0.8)
    env = (1 - np.exp(-t / 0.0025)) * np.where(t < dur, 1 - 0.6 * t / dur, 0.4 * np.exp(-(t - dur) / 0.03))
    x = x * env
    return fade(x / np.max(np.abs(x)), 0.002, 0.02)


def gather(seed: int = 0) -> np.ndarray:
    """Messages gathering into a huddle: a soft low 'fwmp' (a short glide down, a puff of air)."""
    n = n_of(0.32)
    t = np.arange(n) / SR
    x = np.sin(phase(320.0 * (180 / 320) ** np.minimum(1, t / 0.2), n)) * np.sin(np.pi * np.minimum(1, t / 0.32)) ** 2
    a = butter(pink(n, 800 + seed), "lowpass", 1200.0, 2)
    x = 0.6 * x + 0.4 * a / (np.std(a) + 1e-9) * np.exp(-t / 0.06) * (1 - np.exp(-t / 0.005))
    return fade(norm(x), 0.004, 0.03)


def rollback(dur: float = 0.2, f: float = 587.33) -> np.ndarray:
    """The file folding back to its original lines (12 frames): a reversed mallet swelling into a soft click that
    lands exactly at `dur`."""
    n = n_of(dur)
    m = mallet(f, 1.0, 0.8, 0.6, seed=19)[::-1]
    m = m[-n:] if len(m) >= n else np.concatenate([np.zeros(n - len(m)), m])
    t = np.arange(n) / SR
    m = m * (t / dur) ** 1.5
    nz = butter(pink(n, 901), "bandpass", [600.0, 3500.0], 2)
    nz = nz / (np.std(nz) + 1e-9) * (t / dur) ** 3 * 0.25
    c = click(1900.0, 230.0, 4)
    sw = m + nz
    x = np.concatenate([0.5 * sw / (np.max(np.abs(sw)) + 1e-9), np.zeros(len(c))])
    x[n:] += c
    return fade(x / np.max(np.abs(x)), 0.01, 0.01)


def inhale(dur: float = 0.4, seed: int = 0) -> np.ndarray:
    """A body shrinking away behind its eyes: a tiny reversed breath, rising to its end."""
    n = n_of(dur)
    t = np.arange(n) / SR
    fc = 400.0 * (3000.0 / 400.0) ** (t / dur)
    x = sweep(_decor_noise(n, 950 + seed, 0.7), "bp", fc, q=0.9)
    x = x * (t / dur) ** 2.2
    return fade(x / np.max(np.abs(x)), 0.01, 0.03)


def grains(dur: float, center: float = 1046.5, rate: float = 38.0, seed: int = 0) -> np.ndarray:
    """A reply streaming in: a quiet granular texture of tiny pentatonic grains around a bot's note."""
    n = n_of(dur + 0.05)
    out = np.zeros(n)
    r = rng(1200 + seed)
    steps = np.array([-5, -3, 0, 2, 4, 7, 9, 12])
    t = 0.0
    while t < dur:
        gl = r.uniform(0.006, 0.014)
        k = n_of(gl)
        f = center * 2 ** (r.choice(steps) / 12.0)
        w = np.hanning(k) * np.sin(phase(f, k))
        u = t / dur
        dens = min(1.0, u / 0.12) * min(1.0, (1 - u) / 0.15)
        i = n_of(t)
        out[i:i + k] += w[: max(0, min(k, n - i))] * r.uniform(0.4, 1.0) * dens
        t += r.exponential(1.0 / rate)
    return fade(norm(butter(out, "lowpass", 5000.0, 2)), 0.005, 0.02)
