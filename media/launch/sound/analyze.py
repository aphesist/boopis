"""Balance analysis used while mixing: loudness of each part per section, the focal-over-bed margin of every tier-1
cue, octave-band balance against a pink reference, phone-speaker and mono losses.

    python3 -m sound.analyze [film|cut15|bumper]
"""
from __future__ import annotations

import sys

import numpy as np

from .lib.dsp import SR, butter, n_of
from .lib.meter import lufs
from .timeline import at, CUTS

SECTIONS = {
    "film": [("hook B01", 0, at("2.2")), ("promise B02-03", at("2.2"), at("4.3")), ("room B04-07", at("4.3"), at("9.2.5")),
             ("window B08", at("9.2.5"), at("10.2.5")), ("session B09-10", at("10.2.5"), at("13.1")),
             ("breath B11-12", at("13.1"), at("15.1")), ("drop B13-15", at("15.1"), at("17.4")),
             ("approval B15-16", at("17.4"), at("19.1")), ("release B16-17", at("19.1"), at("20.4")),
             ("mark B18-19", at("20.4"), 46.93)],
    "cut15": [("hook", 0, at("2.2")), ("promise", at("2.2"), at("3.2.5")), ("room", at("3.2.5"), at("6.1")),
              ("mark", at("6.1"), 14.93)],
    "bumper": [("hook", 0, 2.4), ("mark", 2.4, 6.0)],
}


def seg_lufs(x, a, b):
    s = x[..., n_of(a):n_of(b)]
    return lufs(s) if s.shape[-1] > n_of(0.45) else float("nan")


def focal(placed, music, sfx_tier1_only=True):
    """For each tier-1 cue: its momentary loudness (400 ms from onset) over the music's in the same window."""
    rows = []
    for c, i0, x in placed:
        if c.tier != 1:
            continue
        i = max(0, n_of(c.t))
        e = np.abs(x).max(axis=0)
        w = int(np.clip(np.nonzero(e > 0.1 * e.max())[0][-1] - (i - i0), n_of(0.05), n_of(0.4)))
        cue = np.zeros((2, w))
        k = min(w, x.shape[1] - (i - i0)) if i >= i0 else 0
        if k > 0:
            cue[:, :k] = x[:, i - i0:i - i0 + k]
        bed = music[:, i:i + w]
        rows.append((c.id, lufs(cue), lufs(bed) if bed.shape[1] == w else float("nan")))
    return rows


def bands(x):
    mono = x.mean(axis=0)
    out = []
    for fc in (31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000):
        lo, hi = fc / np.sqrt(2), min(fc * np.sqrt(2), SR / 2 - 100)
        y = butter(mono, "bandpass", [lo, hi], 2)
        out.append((fc, 10 * np.log10(np.mean(y ** 2) + 1e-20)))
    return out


def report(cut, music, sfx, parts=None, placed=None, out=print):
    out(f"== {cut}")
    out(f"music {lufs(music):6.1f} LUFS   sfx {lufs(sfx):6.1f} LUFS   mix {lufs(music + sfx):6.1f} LUFS")
    hdr = f"{'section':18s} {'mix':>6s} {'music':>6s} {'sfx':>6s}"
    if parts:
        hdr += "".join(f" {k:>6s}" for k in parts)
    out(hdr)
    for name, a, b in SECTIONS[cut]:
        row = f"{name:18s} {seg_lufs(music + sfx, a, b):6.1f} {seg_lufs(music, a, b):6.1f} {seg_lufs(sfx, a, b):6.1f}"
        if parts:
            row += "".join(f" {seg_lufs(np.atleast_2d(p) if p.ndim == 2 else np.stack([p, p]) * np.sqrt(.5), a, b):6.1f}" for p in parts.values())
        out(row)
    mix = music + sfx
    b = bands(mix)
    ref = b[5][1]
    out("octave bands vs 1 kHz (a pink-ish mix falls about 3 dB an octave above 250 Hz):")
    out("  " + "  ".join(f"{int(fc) if fc >= 1 else fc}:{v - ref:+.1f}" for fc, v in b))
    ph = butter(butter(mix, "highpass", 230.0, 4), "lowpass", 9000.0, 2)
    out(f"phone-speaker loss {lufs(mix) - lufs(ph):.1f} dB   mono loss {lufs(mix) - lufs(np.stack([mix.mean(0)] * 2)):.1f} dB")
    if placed is not None:
        rows = focal(placed, music)
        d = [r[1] - r[2] for r in rows if np.isfinite(r[2])]
        out(f"tier-1 focal over bed: median {np.median(d):+.1f} dB, min {np.min(d):+.1f} dB")
        for r in rows:
            out(f"   {r[0]:22s} cue {r[1]:6.1f}  bed {r[2]:6.1f}  margin {r[1] - r[2]:+5.1f}")


if __name__ == "__main__":
    from . import mix as M, score
    cut = sys.argv[1] if len(sys.argv) > 1 else "film"
    r = score.render(cut)
    s = M.render_sfx(cut, CUTS[cut]["length"])
    music = r["music"] * M.duck_curve(s["tier1"]) * 10 ** (M.MUSIC_TRIM / 20)
    report(cut, music, s["sfx"], r["parts"], s["placed"])
