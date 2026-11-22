"""DSP building blocks for the launch film's sound.

numpy and scipy only, 48 kHz, float64, deterministic (every random source is seeded). Mono signals are 1-D arrays,
stereo signals are (2, n) arrays.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage, signal

SR = 48000
TAU = 2.0 * np.pi


# ── time and pitch ────────────────────────────────────────────────────────────────────────────────────────────────

def n_of(sec: float) -> int:
    return int(round(sec * SR))


def tt(dur: float) -> np.ndarray:
    return np.arange(n_of(dur)) / SR


def hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def db(x: float) -> float:
    return 10.0 ** (x / 20.0)


# ── oscillators ───────────────────────────────────────────────────────────────────────────────────────────────────

def phase(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    """Phase in radians of an oscillator whose frequency may glide (frequency is integrated, never multiplied by t)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    p = np.empty(n)
    p[0] = 0.0
    np.cumsum(f[:-1], out=p[1:])
    return phase0 + TAU * p / SR


def _polyblep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    y = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    y[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    x = (t[m] - 1.0) / dt[m]
    y[m] = x * x + x + x + 1.0
    return y


def saw(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    """Band-limited sawtooth (PolyBLEP)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = np.empty(n)
    ph[0] = 0.0
    np.cumsum(dt[:-1], out=ph[1:])
    ph = (ph + phase0) % 1.0
    return 2.0 * ph - 1.0 - _polyblep(ph, dt)


def white(n: int, seed: int) -> np.ndarray:
    return rng(seed).standard_normal(n)


def pink(n: int, seed: int) -> np.ndarray:
    w = np.fft.rfft(rng(seed).standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    f[0] = f[1]
    x = np.fft.irfft(w / np.sqrt(f), n)
    return x / (np.std(x) + 1e-12)


def drift(n: int, seed: int, rate: float = 0.25, depth: float = 1.0) -> np.ndarray:
    """A smooth seeded random wander in [-depth, depth] (analogue pitch drift, slow modulation)."""
    from scipy.interpolate import CubicSpline
    k = max(4, int(np.ceil(n / SR * rate)) + 3)
    pts = rng(seed).uniform(-1.0, 1.0, k)
    cs = CubicSpline(np.arange(k) * SR / rate, pts, bc_type="natural")
    return depth * np.clip(cs(np.arange(n)), -1.0, 1.0)


# ── envelopes ─────────────────────────────────────────────────────────────────────────────────────────────────────

def ramp_cos(n: int) -> np.ndarray:
    """0 to 1 raised-cosine ramp of n samples."""
    if n <= 0:
        return np.ones(0)
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / n)


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.004) -> np.ndarray:
    """Raised-cosine fades at both ends, so no voice ever starts or stops mid-wave."""
    x = np.array(x, dtype=float, copy=True)
    n = x.shape[-1]
    a, b = min(n, n_of(fin)), min(n, n_of(fout))
    if a > 0:
        x[..., :a] *= ramp_cos(a)
    if b > 0:
        x[..., n - b:] *= ramp_cos(b)[::-1]
    return x


def env_ahr(n: int, attack: float, hold: float, release: float, shape: float = 1.0) -> np.ndarray:
    """Attack (raised cosine), hold, release (raised cosine to the power `shape`), padded with zeros to n."""
    e = np.zeros(n)
    a, h, r = n_of(attack), n_of(hold), n_of(release)
    seg = np.concatenate([ramp_cos(a), np.ones(h), ramp_cos(r)[::-1] ** shape])[:n]
    e[: len(seg)] = seg
    return e


def curve(n: int, points, t0: float = 0.0, log: bool = False) -> np.ndarray:
    """A piecewise-linear automation curve sampled at SR from [(time_s, value), ...]; `log` interpolates in log."""
    ts = np.array([p[0] for p in points], dtype=float) - t0
    vs = np.array([p[1] for p in points], dtype=float)
    t = np.arange(n) / SR
    if log:
        return np.exp(np.interp(t, ts, np.log(vs)))
    return np.interp(t, ts, vs)


def norm(x: np.ndarray) -> np.ndarray:
    p = np.max(np.abs(x))
    return x / p if p > 0 else x


# ── filters ───────────────────────────────────────────────────────────────────────────────────────────────────────

def butter(x: np.ndarray, kind: str, fc, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, fc, kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def rbj(kind: str, fc: float, q: float = 0.7071, gain_db: float = 0.0):
    """Audio-EQ-cookbook biquad coefficients (b, a)."""
    fc = float(np.clip(fc, 10.0, SR * 0.49))
    w = TAU * fc / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / (2.0 * q)
    A = 10.0 ** (gain_db / 40.0)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == "bp":
        b = [al, 0.0, -al]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == "peak":
        b = [1 + al * A, -2 * cw, 1 - al * A]
        a = [1 + al / A, -2 * cw, 1 - al / A]
    elif kind == "lowshelf":
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
    elif kind == "highshelf":
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    b, a = np.array(b), np.array(a)
    return b / a[0], a / a[0]


def eq(x: np.ndarray, kind: str, fc: float, q: float = 0.7071, gain_db: float = 0.0) -> np.ndarray:
    b, a = rbj(kind, fc, q, gain_db)
    return signal.lfilter(b, a, x, axis=-1)


def sweep(x: np.ndarray, kind: str, fc: np.ndarray, q=0.7071, block: int = 64) -> np.ndarray:
    """A time-varying biquad (lp, hp or bp) whose cutoff follows `fc` (one value per sample); the filter state is
    carried across blocks, so a sweep never clicks."""
    if x.ndim == 2:
        return np.stack([sweep(c, kind, fc, q, block) for c in x])
    n = len(x)
    qs = np.broadcast_to(np.asarray(q, dtype=float), (n,))
    y = np.empty(n)
    zi = np.zeros(2)
    for s in range(0, n, block):
        m = min(s + block // 2, n - 1)
        b, a = rbj(kind, fc[m], qs[m])
        y[s:s + block], zi = signal.lfilter(b, a, x[s:s + block], zi=zi)
    return y


# ── space ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def pan(x: np.ndarray, p) -> np.ndarray:
    """Equal-power pan of a mono signal; p in [-1, 1] (scalar or per sample)."""
    th = (np.asarray(p, dtype=float) + 1.0) * np.pi / 4.0
    return np.stack([x * np.cos(th), x * np.sin(th)])


def make_ir(rt60: float, seed: int, predelay: float = 0.012, early: int = 14, early_span: float = 0.07,
            low_x: float = 1.2, high_x: float = 0.5, diffuse_in: float = 0.018, brightness: float = 9000.0) -> np.ndarray:
    """A synthetic stereo impulse response: sparse early reflections, then decorrelated noise decaying at a band-
    dependent rate (lows ring longer, highs die faster, as in a real room). Energy-normalised per channel."""
    n_tail = n_of(rt60 * 1.4 + early_span)
    t = np.arange(n_tail) / SR
    out = []
    for ch in range(2):
        r = rng(seed * 7 + ch)
        nz = r.standard_normal(n_tail)
        lo = butter(nz, "lowpass", 350.0, 2) * np.exp(-6.91 * t / (rt60 * low_x))
        mid = butter(nz, "bandpass", [350.0, 3500.0], 2) * np.exp(-6.91 * t / rt60)
        hi = butter(nz, "highpass", 3500.0, 2) * np.exp(-6.91 * t / (rt60 * high_x))
        tail = lo + mid + 0.7 * hi
        tail *= np.minimum(1.0, t / diffuse_in) ** 1.5
        er = np.zeros(n_tail)
        times = np.sort(r.uniform(0.004, early_span, early))
        for tk in times:
            i = n_of(tk)
            er[i] += r.choice([-1.0, 1.0]) * 2.2 * np.exp(-tk / 0.035) * (0.6 + 0.4 * r.random())
        er = butter(er, "lowpass", 6000.0, 1)
        ir = np.concatenate([np.zeros(n_of(predelay)), er + tail])
        ir = butter(ir, "lowpass", brightness, 1)
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(out)


def reverb(x: np.ndarray, ir: np.ndarray, hp: float = 240.0, lp: float = 9500.0) -> np.ndarray:
    """Convolve a stereo (or mono) send with a stereo IR; the send is band-limited first so the space never muds."""
    if x.ndim == 1:
        x = np.stack([x, x])
    s = butter(butter(x, "highpass", hp, 2), "lowpass", lp, 2)
    n = x.shape[1]
    return np.stack([signal.oaconvolve(s[c], ir[c])[:n] for c in range(2)])


def pingpong(x: np.ndarray, delay: float, fb: float = 0.35, taps: int = 6, lp: float = 3800.0,
             hp: float = 300.0) -> np.ndarray:
    """A ping-pong echo: repeats alternate sides, each one darker than the last."""
    mono = x.mean(axis=0) if x.ndim == 2 else x
    n = len(mono)
    d = n_of(delay)
    out = np.zeros((2, n))
    sig = butter(mono, "highpass", hp, 2)
    for k in range(1, taps + 1):
        sig = butter(sig, "lowpass", lp, 1) * fb
        if k * d >= n:
            break
        out[k % 2, k * d:] += sig[: n - k * d]
    return out


def chorus(x: np.ndarray, base_ms: float = 11.0, depth_ms: float = 2.4, rates=(0.29, 0.41), mix: float = 0.45,
           seed: int = 0) -> np.ndarray:
    """Two modulated delay lines, one per side: width and movement for keys and pads."""
    if x.ndim == 1:
        x = np.stack([x, x])
    n = x.shape[1]
    t = np.arange(n) / SR
    idx = np.arange(n, dtype=float)
    out = np.empty_like(x)
    ph = rng(seed).uniform(0, TAU, 2)
    for c in range(2):
        d = (base_ms + depth_ms * np.sin(TAU * rates[c] * t + ph[c])) * SR / 1000.0
        wet = np.interp(idx - d, idx, x[c], left=0.0)
        out[c] = (1.0 - mix) * x[c] + mix * wet
    return out


def sat(x: np.ndarray, drive: float = 1.5) -> np.ndarray:
    """Soft saturation (tanh), unity gain at low level."""
    return np.tanh(drive * x) / drive


def place(bus: np.ndarray, x: np.ndarray, t: float, gain_db: float = 0.0, offset: int = 0) -> None:
    """Add a signal (mono into both channels or stereo) into a stereo bus at time t (seconds), sample-accurate."""
    i = n_of(t) + offset
    g = db(gain_db)
    if x.ndim == 1:
        x = np.stack([x, x]) * np.sqrt(0.5)
    n = x.shape[1]
    a, b = max(0, i), min(bus.shape[1], i + n)
    if b <= a:
        return
    bus[:, a:b] += g * x[:, a - i:b - i]


# ── dynamics ──────────────────────────────────────────────────────────────────────────────────────────────────────

CTL = 16  # control-rate decimation for gain computers


def _control(req: np.ndarray, release: float, attack_blocks: int = 1) -> np.ndarray:
    """Smooth a per-sample required gain (<= 1) at control rate: instant attack (the look-ahead already ramps it),
    one-pole release; the result never exceeds the requirement at any sample."""
    n = len(req)
    nb = (n + CTL - 1) // CTL
    padded = np.concatenate([req, np.ones(nb * CTL - n)])
    c = padded.reshape(nb, CTL).min(axis=1)
    c = ndimage.minimum_filter1d(c, size=2 * attack_blocks + 1)
    a = np.exp(-CTL / (release * SR))
    g = np.empty(nb)
    prev = 1.0
    for k in range(nb):
        v = c[k]
        prev = v if v < prev else prev * a + (1.0 - a) * v
        g[k] = prev
    centers = np.arange(nb) * CTL + CTL / 2.0
    return np.interp(np.arange(n), centers, g)


def true_peak(x: np.ndarray, os: int = 4) -> float:
    up = signal.resample_poly(x, os, 1, axis=-1)
    return float(np.max(np.abs(up)))


def limiter_gain(x: np.ndarray, ceiling_db: float, lookahead: float = 0.004, release: float = 0.09,
                 os: int = 4) -> np.ndarray:
    """Gain curve of a look-ahead limiter on the oversampled (true) peak. Adds no delay: only the gain is shaped."""
    n = x.shape[-1]
    up = np.abs(signal.resample_poly(x, os, 1, axis=-1)).max(axis=0)
    up = np.concatenate([up, np.zeros(n * os - len(up))]) if len(up) < n * os else up[: n * os]
    pk = up.reshape(n, os).max(axis=1)
    ceil = db(ceiling_db)
    req = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    L = max(1, n_of(lookahead))
    req = ndimage.minimum_filter1d(req, size=2 * L + 1)
    req = ndimage.uniform_filter1d(req, size=L)
    req = np.minimum(req, ndimage.minimum_filter1d(np.minimum(1.0, ceil / np.maximum(pk, 1e-12)), size=3))
    return _control(req, release, attack_blocks=1)


def compressor_gain(x: np.ndarray, threshold_db: float, ratio: float, attack: float = 0.012, release: float = 0.18,
                    window: float = 0.012, knee_db: float = 6.0) -> np.ndarray:
    """A gentle RMS glue compressor's gain curve (feed-forward, soft knee)."""
    p = (x ** 2).mean(axis=0) if x.ndim == 2 else x ** 2
    w = max(1, n_of(window))
    rms_db = 10.0 * np.log10(np.maximum(ndimage.uniform_filter1d(p, size=w), 0.0) + 1e-12)
    over = rms_db - threshold_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    req = 10.0 ** (-gr / 20.0)
    # attack smoothing: a moving minimum then average over the attack time (look-ahead style, no delay)
    a = max(1, n_of(attack))
    req = ndimage.uniform_filter1d(ndimage.minimum_filter1d(req, size=a), size=a)
    return _control(req, release, attack_blocks=0)


def env_follow(x: np.ndarray, window: float = 0.005) -> np.ndarray:
    p = (x ** 2).mean(axis=0) if x.ndim == 2 else x ** 2
    return np.sqrt(np.maximum(ndimage.uniform_filter1d(p, size=max(1, n_of(window))), 0.0))
