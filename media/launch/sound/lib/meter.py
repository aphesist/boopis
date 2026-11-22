"""Measurement: ITU-R BS.1770-4 loudness, true peak, 24-bit WAV I/O, and ffmpeg's own meters as the reference."""
from __future__ import annotations

import json
import re
import struct
import subprocess

import numpy as np
from scipy import signal

from .dsp import SR, true_peak

FFMPEG = "/usr/bin/ffmpeg"

# K-weighting at 48 kHz (BS.1770-4, table 1 and 2)
_K1 = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
       np.array([1.0, -1.69065929318241, 0.73248077421585]))
_K2 = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))


def _kw(x: np.ndarray) -> np.ndarray:
    return signal.lfilter(*_K2, signal.lfilter(*_K1, x, axis=-1), axis=-1)


def _blocks(x: np.ndarray, size: float, step: float) -> np.ndarray:
    """Mean square of K-weighted blocks, summed over channels."""
    y = _kw(x) ** 2
    s = y.sum(axis=0) if y.ndim == 2 else y
    n, b, h = len(s), int(size * SR), int(step * SR)
    if n < b:
        return np.array([s.mean()])
    c = np.concatenate([[0.0], np.cumsum(s)])
    starts = np.arange(0, n - b + 1, h)
    return (c[starts + b] - c[starts]) / b


def lufs(x: np.ndarray) -> float:
    """Integrated loudness (gated)."""
    z = _blocks(x, 0.4, 0.1)
    l = -0.691 + 10 * np.log10(z + 1e-20)
    g = z[l > -70]
    if len(g) == 0:
        return -np.inf
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = z[(l > -70) & (l > rel)]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def short_term(x: np.ndarray, step: float = 0.1) -> np.ndarray:
    return -0.691 + 10 * np.log10(_blocks(x, 3.0, step) + 1e-20)


def momentary(x: np.ndarray, step: float = 0.05) -> np.ndarray:
    return -0.691 + 10 * np.log10(_blocks(x, 0.4, step) + 1e-20)


def lra(x: np.ndarray) -> float:
    st = short_term(x)
    st = st[st > -70]
    if len(st) == 0:
        return 0.0
    rel = 10 * np.log10(np.mean(10 ** (st / 10))) - 20
    st = st[st > rel]
    return float(np.percentile(st, 95) - np.percentile(st, 10))


def tp_db(x: np.ndarray) -> float:
    return 20 * np.log10(true_peak(x) + 1e-12)


# ── WAV ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def write_wav24(path: str, x: np.ndarray, seed: int = 1) -> None:
    """Stereo 24-bit PCM with 1-LSB TPDF dither. No metadata chunks: nothing but the format and the samples."""
    if x.ndim == 1:
        x = np.stack([x, x])
    r = np.random.default_rng(seed)
    lsb = 1.0 / 8388608.0
    d = (r.random(x.shape) - r.random(x.shape)) * lsb
    q = np.clip(np.round((x + d) * 8388607.0), -8388608, 8388607).astype("<i4")
    inter = q.T.reshape(-1)
    raw = inter.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    ch, bits = x.shape[0], 24
    fmt = struct.pack("<HHIIHH", 1, ch, SR, SR * ch * bits // 8, ch * bits // 8, bits)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(raw)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt)
        f.write(b"data" + struct.pack("<I", len(raw)) + raw)


def read_audio(path: str, start: float | None = None, dur: float | None = None) -> np.ndarray:
    """Decode any audio (wav, or the audio stream of an mp4) with ffmpeg to float stereo at 48 kHz."""
    args = [FFMPEG, "-v", "error"]
    if start is not None:
        args += ["-ss", str(start)]
    args += ["-i", path]
    if dur is not None:
        args += ["-t", str(dur)]
    args += ["-map", "0:a:0", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64).reshape(-1, 2).T


def ffmpeg_loudness(path: str) -> dict:
    """ffmpeg's ebur128 (integrated, LRA, true peak) and loudnorm's measurement pass, for the report."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    s = p.stderr[p.stderr.rfind("Summary:"):]
    get = lambda pat: float(re.search(pat, s, re.S).group(1))
    out = {"ebur128_I": get(r"I:\s+(-?[\d.]+) LUFS"), "ebur128_LRA": get(r"LRA:\s+(-?[\d.]+) LU"),
           "ebur128_TP": get(r"Peak:\s+(-?[\d.]+) dBFS")}
    p = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af",
                        "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    j = json.loads(p.stderr[p.stderr.rfind("{"):p.stderr.rfind("}") + 1])
    out.update({"loudnorm_I": float(j["input_i"]), "loudnorm_TP": float(j["input_tp"]),
                "loudnorm_LRA": float(j["input_lra"]), "loudnorm_thresh": float(j["input_thresh"])})
    return out
