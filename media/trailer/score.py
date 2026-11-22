"""The trailer's soundtrack, synthesised from nothing: no samples, no loops, nothing recorded.

    python3 score.py src/cues.json score.wav

100 BPM (a bar is 2.4 s), D minor: a four-chord pad, sub bass, drums made of sine sweeps and filtered noise, and the
sound effects the picture asks for, read from the cue list the page wrote (render.mjs --cues), so picture and sound
share one clock. numpy and scipy only.
"""
import json
import sys
import wave

import numpy as np
from scipy import signal

SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def bar(n):
    return (n - 1) * BAR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(d * SR)) / SR


class Bus:
    def __init__(self, n):
        self.x = np.zeros((2, n))

    def add(self, at, sig, gain=1.0, pan=0.0):
        i = int(round(at * SR))
        if i >= self.x.shape[1] or len(sig) == 0:
            return
        if i < 0:
            sig = sig[-i:]
            i = 0
        n = min(len(sig), self.x.shape[1] - i)
        a = (pan + 1) * np.pi / 4
        self.x[0, i:i + n] += sig[:n] * gain * np.cos(a)
        self.x[1, i:i + n] += sig[:n] * gain * np.sin(a)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, min(f, SR / 2 - 100), 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, min(hi, SR / 2 - 100)], 'band', fs=SR, output='sos'), x)


def noise(d):
    return rng.standard_normal(int(d * SR))


def mixs(*xs):
    """sum signals of different lengths, padding the shorter ones with silence"""
    n = max(len(x) for x in xs)
    out = np.zeros(n)
    for x in xs:
        out[:len(x)] += x
    return out


def fade(x, a=0.004, r=0.01):
    n = len(x)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        x[:na] *= np.linspace(0, 1, na)
    if nr:
        x[-nr:] *= np.linspace(1, 0, nr)
    return x


# ───────── instruments ─────────
def saw_voice(f, d, harm=14, detune=(0.0, -0.11, 0.09)):
    t = tt(d)
    out = np.zeros_like(t)
    for c in detune:
        ff = f * 2 ** (c / 12)
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, harm + 1):
            if ff * k > 9000:
                break
            out += np.sin(2 * np.pi * ff * k * t + ph * k) / k
    return out / len(detune)


def pad_chord(notes, d, cutoff=1400, attack=0.8, release=1.4):
    t = tt(d + release)
    x = sum(saw_voice(midi(m), d + release) for m in notes) / len(notes)
    env = np.minimum(1, t / attack) * np.where(t < d, 1.0, np.exp(-(t - d) * 3.2 / release))
    return lp(x * env, cutoff, 2)


def kick(gain=1.0):
    t = tt(0.55)
    f = 44 + 110 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    click = lp(hp(noise(0.006), 1500), 7000) * np.exp(-tt(0.006) * 600) * 0.3
    body[:len(click)] += click
    return fade(body * gain, 0.0005, 0.02)


def clap():
    d = 0.35
    x = np.zeros(int(d * SR))
    for k, off in enumerate((0.0, 0.011, 0.022)):
        i = int(off * SR)
        m = len(x) - i
        b = bp(rng.standard_normal(m), 900, 5200) * np.exp(-np.arange(m) / SR * (40 if k < 2 else 16))
        x[i:] += b * (0.6 if k < 2 else 1.0)
    tone = np.sin(2 * np.pi * 200 * tt(d)) * np.exp(-tt(d) * 30) * 0.25
    return fade((x * 0.5 + tone), 0.0005, 0.03)


def hat(open_=False):
    d = 0.32 if open_ else 0.06
    x = hp(noise(d), 7500, 4) * np.exp(-tt(d) * (11 if open_ else 70))
    return fade(x * (0.35 if open_ else 0.3), 0.0005, 0.01)


def bass_note(m, d):
    t = tt(d + 0.2)
    f = midi(m)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * lp(saw_voice(f, d + 0.2, 8, (0.0,)), 600)
    env = np.minimum(1, t / 0.01) * np.where(t < d, np.exp(-t * 0.6), np.exp(-d * 0.6) * np.exp(-(t - d) * 18))
    return fade(x * env, 0.002, 0.03)


def pluck(m, d=0.9, bright=1.0):
    t = tt(d)
    f = midi(m)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 5) + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 9) * bright
         + 0.18 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 14) * bright)
    return fade(x, 0.002, 0.05)


def bell(m, d=2.6, index=2.2, ratio=3.5):
    t = tt(d)
    f = midi(m)
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t * 3.5)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 2.2) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 4)
    return fade(x, 0.002, 0.2)


def blip(f0, f1, d=0.09):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * 40)
    return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28), 0.001, 0.01)


def tick(f=3200, d=0.012, g=1.0):
    x = bp(noise(d), f * 0.6, f * 1.6) * np.exp(-tt(d) * (5 / d))
    return fade(x * g, 0.0003, 0.002)


def whoosh(d=0.5, lo=400, hi=3000, rise=True):
    t = tt(d)
    x = noise(d)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    if rise:
        env = env * (0.4 + 0.6 * t / d)
    # a sweep: two bands crossfaded
    a = bp(x, lo, lo * 3) * (1 - t / d)
    b = bp(x, hi / 3, hi) * (t / d)
    y = (a + b) if rise else (b[::-1] + a[::-1])
    return fade(y * env, 0.005, 0.03)


def riser(d):
    t = tt(d)
    f = 180 * (1600 / 180) ** (t / d)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 2 * 0.35
    n = lp(hp(noise(d), 2500), 9000) * (t / d) ** 3 * 0.3
    return fade(tone + n, 0.05, 0.01)


def boom(d=1.6):
    t = tt(d)
    f = 38 + 60 * np.exp(-t * 12)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4)
    n = lp(noise(d), 900) * np.exp(-t * 9) * 0.35
    return fade(x + n, 0.001, 0.1)


def hold_rise(d=1.0):
    t = tt(d + 0.05)
    f = 330 * (3.0) ** np.clip(t / d, 0, 1)
    x = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR)) * (0.25 + 0.75 * np.clip(t / d, 0, 1))
    return fade(x * 0.5, 0.01, 0.04)


# ───────── the score ─────────
def build(cue_file, out):
    meta = json.load(open(cue_file))
    dur = meta['duration']
    N = int((dur + 0.2) * SR)
    music, drums, fx, verb = Bus(N), Bus(N), Bus(N), Bus(N)
    kicks = []

    # chords, two bars each: Dm9, Bbmaj7, Fmaj9, Csus2
    CH = [([50, 57, 60, 64, 65], 38), ([46, 53, 57, 62], 34), ([53, 60, 64, 67, 69], 41), ([48, 55, 62, 64], 36)]
    def chord_at(n):
        return CH[((n - 1) // 2) % 4]

    # section map: bar -> (pad level, cutoff, kick pattern, clap, hats, bass)
    def sec(n):
        if n <= 3: return (0.0, 900, '', 0, '', 0)
        if n == 4: return (0.5, 1100, 'x', 0, '', 1)
        if n <= 8: return (0.55, 1300, 'x.x.', 0, '8', 1)
        if n <= 11: return (0.6, 1700, 'x.x.', 1, '8o', 1)
        if n <= 13: return (0.45, 700, 'x.x.', 0, '', 1)
        if n <= 15: return (0.55, 1600, 'x.x.', 1, '8', 1)
        if n == 16: return (0.4, 900, '', 0, '', 1)
        if n == 17: return (0.5, 1500, '..x.', 0, '', 1)
        if n == 18: return (0.5, 1500, 'x.x.', 1, '8', 1)
        if n <= 21: return (0.6, 2200, 'xxxx', 1, '16', 2)
        if n == 22: return (0.45, 900, '', 0, '', 0)
        if n <= 28: return (0.62, 2600, 'xxxx', 1, '16', 2)
        if n <= 31: return (0.5, 1500, 'x...', 0, '8', 1)
        if n <= 34: return (0.58, 2000, 'x.x.', 1, '8o', 2)
        if n <= 38: return (0.62, 2800, 'xxxx', 1, '16', 2)
        if n == 39: return (0.55, 2000, 'xxxx', 1, '16', 2)
        return (0.0, 1200, '', 0, '', 0)

    nbars = int(np.ceil(dur / BAR))
    # the pad, two bars at a time
    for n in range(1, nbars + 1, 2):
        lvl, cut, *_ = sec(n)
        lvl2 = sec(n + 1)[0]
        if max(lvl, lvl2) <= 0:
            continue
        notes, _ = chord_at(n)
        p = pad_chord(notes, 2 * BAR, cutoff=cut, attack=0.6 if n > 4 else 1.4, release=1.0)
        g = 0.16 * max(lvl, lvl2)
        music.add(bar(n), p, g, -0.15); music.add(bar(n) + 0.013, p, g, 0.15)
        verb.add(bar(n), p, g * 0.5)
    # bass, kick, clap, hats per bar
    for n in range(1, nbars + 1):
        lvl, cut, kp, cl, hh, bs = sec(n)
        t0 = bar(n)
        _, root = chord_at(n)
        if bs == 1:
            music.add(t0, bass_note(root, BAR * 0.92), 0.32)
        elif bs == 2:
            for k, off in enumerate((0, 1.5, 2, 3, 3.5)):
                music.add(t0 + off * BEAT, bass_note(root + (12 if k == 4 else 0), BEAT * (0.9 if off % 1 == 0 else 0.45)), 0.3)
        for b, c in enumerate(kp):
            if c == 'x':
                drums.add(t0 + b * BEAT, kick(), 0.62); kicks.append(t0 + b * BEAT)
        if cl:
            for b in (1, 3):
                c = clap(); drums.add(t0 + b * BEAT, c, 0.28, 0.05); verb.add(t0 + b * BEAT, c, 0.18)
        if hh:
            step_ = BEAT / (4 if hh == '16' else 2)
            for k in range(int(BAR / step_ + 0.5)):
                at = t0 + k * step_
                open_ = hh == '8o' and k % 2 == 1
                g = 0.55 if (k % 2 == 0) else 0.8
                drums.add(at, hat(open_), g * (0.7 if hh == '16' else 0.85), 0.3 if k % 2 else -0.2)
    # the drone and the sub pulse of the cold open
    d = bar(5) + 0.6
    t = tt(d)
    drone = (np.sin(2 * np.pi * midi(38) * t) * 0.6 + np.sin(2 * np.pi * midi(45) * t) * 0.35 + 0.15 * lp(saw_voice(midi(50), d, 10), 500)) \
        * np.minimum(1, t / 3.0) * np.where(t < bar(5), 1, np.exp(-(t - bar(5)) * 6))
    drone *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.25 * t)
    music.add(0, fade(drone, 0.01, 0.2), 0.32)
    for k in range(2, 8):
        music.add(k * 2 * BEAT - 1.2 + 1.2, fade(np.sin(2 * np.pi * 41 * tt(0.7)) * np.exp(-tt(0.7) * 5), 0.01, 0.05), 0.35)

    # ───────── effects from the picture ─────────
    PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84]
    stop_at = None
    for c in meta['cues']:
        k, at = c['kind'], c['at']
        n = int(c.get('n', 0) or 0)
        if k == 'tick':
            fx.add(at, tick(3400 if c.get('soft') else 2600, 0.014), 0.5 if c.get('soft') else 0.8)
        elif k == 'key':
            fx.add(at, mixs(tick(2200 + 900 * rng.random(), 0.01, 1.0), tick(5200, 0.004, 0.3)), 0.22 if not c.get('hard') else 0.55, rng.uniform(-0.15, 0.15))
        elif k == 'pen':
            fx.add(at, tick(4200, 0.008), 0.18, 0.2)
        elif k == 'type':
            fx.add(at, mixs(tick(1800, 0.016, 1.0), tick(4800, 0.005, 0.6)), 0.5, 0.1)
        elif k in ('click', 'select'):
            fx.add(at, tick(2400, 0.01), 0.7)
            if k == 'select':
                fx.add(at + 0.03, blip(990, 880, 0.08), 0.12); fx.add(at + 0.09, blip(1320, 1175, 0.1), 0.1)
        elif k == 'switch':
            fx.add(at, mixs(tick(2800, 0.008), 0.3 * blip(1500, 1300, 0.04)), 0.5, 0.15)
        elif k == 'thock':
            fx.add(at, mixs(blip(320, 180, 0.12) * 0.8, tick(1600, 0.012)), 0.5)
        elif k in ('swish', 'flip', 'menu', 'send', 'draw', 'morph'):
            dd = {'swish': 0.35, 'flip': 0.3, 'menu': 0.18, 'send': 0.28, 'draw': 0.8, 'morph': 0.55}[k]
            w = whoosh(dd, 500, 4000)
            fx.add(at - dd * 0.5, w, {'swish': 0.35, 'flip': 0.32, 'menu': 0.16, 'send': 0.25, 'draw': 0.18, 'morph': 0.22}[k], float(c.get('pan', 0)))
        elif k == 'whoosh':
            w = whoosh(0.7, 300, 5000)
            fx.add(at - 0.35, w, 0.4); verb.add(at - 0.35, w, 0.15)
        elif k == 'suck':
            dd = 0.5
            x = hp(noise(dd), 1200) * (tt(dd) / dd) ** 3
            fx.add(at, fade(x, 0.01, 0.005), 0.35)
        elif k == 'rewind':
            fx.add(at - 0.1, whoosh(0.4, 600, 3000, rise=False), 0.3)
        elif k in ('pop', 'blip', 'tone', 'note', 'accent'):
            m = PENTA[(n * 3 + int(at * 7)) % len(PENTA)] if k in ('pop', 'tone', 'note') else PENTA[n % len(PENTA)]
            if k == 'pop':
                fx.add(at, blip(midi(m) * 2, midi(m) * 1.5, 0.08), 0.18)
            elif k == 'blip':
                p = pluck(PENTA[[4, 6, 7, 9][n % 4]] + 0, 0.6); fx.add(at, p, 0.22); verb.add(at, p, 0.2)
            elif k == 'accent':
                p = pluck([69, 72, 74][n % 3], 0.5); fx.add(at, p, 0.22); verb.add(at, p, 0.12)
            else:
                p = pluck([74, 77, 81][n % 3], 1.2); fx.add(at, p, 0.18, (n - 1) * 0.3); verb.add(at, p, 0.25)
        elif k == 'pluck':
            p = pluck(PENTA[n % len(PENTA)], 0.9); fx.add(at, p, 0.2, -0.6 + 0.12 * n); verb.add(at, p, 0.2)
        elif k == 'sparkle' or k == 'shimmer':
            m = PENTA[(n * 5 + 3) % len(PENTA)] + 12
            b = bell(m, 1.2, 1.2, 2.0); fx.add(at, b, 0.05 if c.get('soft') else 0.06, rng.uniform(-0.7, 0.7)); verb.add(at, b, 0.08)
        elif k == 'alert':
            for j, m in enumerate((81, 77)):
                p = pluck(m, 0.4, 1.4); fx.add(at + j * 0.12, p, 0.22)
        elif k in ('chord', 'resolve', 'answer'):
            ns = {'chord': [69, 74, 77, 81], 'resolve': [65, 69, 72, 77], 'answer': [74, 81]}[k]
            for j, m in enumerate(ns):
                b = bell(m, 2.0, 1.0, 2.0); fx.add(at + j * 0.015, b, 0.08); verb.add(at, b, 0.12)
        elif k == 'handoff':
            for j, (m, pn) in enumerate(((74, -0.6), (79, 0.6))):
                p = pluck(m, 0.6); fx.add(at + j * 0.15, p, 0.22, pn)
        elif k == 'chime':
            ms = [86, 93] if c.get('big') else ([84, 91] if c.get('bright') else [81, 88])
            for j, m in enumerate(ms):
                b = bell(m, 3.0 if c.get('big') else 2.2); fx.add(at + j * 0.05, b, 0.12 if c.get('big') else 0.09, 0.1 * j); verb.add(at, b, 0.25)
        elif k == 'step-up':
            for j, m in enumerate((69, 76)):
                p = pluck(m, 0.6); fx.add(at + j * 0.1, p, 0.24); verb.add(at, p, 0.1)
        elif k == 'heavy':
            p = bass_note(38, 0.8); fx.add(at, p, 0.35)
        elif k in ('thud', 'cut'):
            x = mixs(blip(110, 45, 0.35) * 0.9, lp(noise(0.12), 500) * np.exp(-tt(0.12) * 30) * 0.4)
            fx.add(at, fade(x, 0.001, 0.05), 0.5 if k == 'thud' else 0.25)
        elif k in ('hit', 'impact'):
            b = boom(1.8 if k == 'impact' else 1.0)
            fx.add(at, b, 0.55 if k == 'impact' or c.get('low') else 0.45); verb.add(at, b, 0.2)
            if k == 'hit' and not c.get('low'):
                p = bell([62, 65, 69][n % 3] + 12, 1.5, 0.8, 2.0); fx.add(at, p, 0.08); verb.add(at, p, 0.1)
        elif k == 'riser':
            r = riser(float(c.get('len', 1.0))); fx.add(at, r, 0.22); verb.add(at, r, 0.1)
        elif k == 'board':
            L = float(c.get('len', 2.0))
            for j in range(int(L / (BEAT / 4))):
                fx.add(at + j * BEAT / 4 + rng.uniform(0, 0.02), tick(2000 + 2000 * rng.random(), 0.008), 0.18 + 0.12 * j / (L / (BEAT / 4)), rng.uniform(-0.8, 0.8))
        elif k == 'hold':
            h = hold_rise(float(c.get('len', 1.0))); fx.add(at, h, 0.2); verb.add(at, h, 0.15)
        elif k == 'arp':
            soft, quick = c.get('soft'), c.get('quick')
            seq = [62, 65, 69, 72, 74, 77, 81, 77, 74, 72, 69, 65] if not quick else [69, 74, 77, 81, 86]
            stp = BEAT / 4 if not soft else BEAT / 2
            for j, m in enumerate(seq if not soft else seq[:8]):
                p = pluck(m + 12, 0.5, 0.8); fx.add(at + j * stp, p, 0.08 if not soft else 0.07, 0.5 * np.sin(j)); verb.add(at + j * stp, p, 0.08)
        elif k == 'pad':
            p = pad_chord([53, 60, 64, 69], 2.6, 1600, 0.4, 1.0); fx.add(at, p, 0.12); verb.add(at, p, 0.1)
        elif k == 'drone' or k == 'open':
            if k == 'open':
                x = lp(saw_voice(midi(50), 2.4, 12), 2400) * np.sin(np.pi * np.clip(tt(2.4) / 2.4, 0, 1)) ** 2
                fx.add(at, x, 0.06); verb.add(at, x, 0.06)
        elif k == 'stop':
            stop_at = at
        elif k == 'boop':
            t = tt(0.45)
            f = 150 + 120 * (1 - np.exp(-t * 18))
            x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6) + 0.2 * np.sin(2 * np.pi * np.cumsum(2 * f) / SR) * np.exp(-t * 9)
            fx.add(at, fade(x, 0.003, 0.05), 0.5); verb.add(at, x, 0.15)
            p = pad_chord([50, 57, 62, 65, 69], 2.4 * 1.0, 1300, 0.3, 0.8); fx.add(at, p, 0.12); verb.add(at, p, 0.1)
        elif k == 'final':
            p = pad_chord([41, 53, 60, 64, 67, 69, 72], 4.4, 2200, 0.08, 1.4)
            fx.add(at, p, 0.2); verb.add(at, p, 0.18)
            fx.add(at, bass_note(29, 4.0), 0.3)
            for j, m in enumerate((77, 84, 88)):
                b = bell(m, 4.0, 1.1, 2.0); fx.add(at + j * 0.03, b, 0.08); verb.add(at, b, 0.2)
            fx.add(at, boom(2.2), 0.35)

    # the music stops dead at the eyes, and only the logo's sounds come after
    # the pad and the bass breathe under each kick (a side-chain)
    duck = np.ones(N)
    for k in kicks:
        i = int(k * SR); n = min(int(0.4 * SR), N - i)
        if n > 0:
            duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.32 * np.exp(-np.arange(n) / SR / 0.11))
    music.x *= duck
    if stop_at is not None:
        i = int(stop_at * SR)
        ramp = int(0.03 * SR)
        for b in (music, drums):
            b.x[:, i:i + ramp] *= np.linspace(1, 0, ramp)
            b.x[:, i + ramp:] = 0
        verb.x[:, i + int(0.4 * SR):int(bar(40) * SR)] *= 0.0

    # the hold drops the groove: bar 22 keeps only the pad (already in the section map) and the riser

    # a reverb: decaying stereo noise, convolved once
    ir_d = 2.6
    t = tt(ir_d)
    ir = np.stack([lp(noise(ir_d), 6000) * np.exp(-t * 2.6), lp(noise(ir_d), 6000) * np.exp(-t * 2.6)])
    ir[:, :int(0.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    wet = np.stack([signal.fftconvolve(verb.x[0], ir[0])[:N], signal.fftconvolve(verb.x[1], ir[1])[:N]])

    # side-chain: the pad and bass duck a little under each kick
    mix = music.x + drums.x + fx.x + wet * 0.55
    # gentle glue: a soft clip and a final limit to -1 dBFS
    mix = hp(mix, 28)
    peak = np.max(np.abs(mix)) + 1e-9
    mix = mix / peak * 1.25
    mix = np.tanh(mix) / np.tanh(1.25)
    mix *= 10 ** (-1 / 20)
    end = int(dur * SR)
    mix = mix[:, :end]
    tail = int(0.4 * SR)
    mix[:, -tail:] *= np.linspace(1, 0, tail) ** 1.5
    pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', out, f'{dur:.2f}s')


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
