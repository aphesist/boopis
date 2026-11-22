"""The sync audit: where every cue really is in the delivered mix, against the frame the picture gives it.

For each effect cue, two measurements:
- master: the cue's own waveform is found in the master by normalised cross-correlation (+-40 ms), and its attack
  is located inside that waveform (the first moment its 1 ms envelope reaches -15 dB of its peak; for a move its
  peak; for the rollback the click that ends it). So a delay anywhere in the chain (filters, limiter, gain) would
  show as an offset.
- stem: a blind onset detector on the effects stem (the steepest rise of the 2 ms log envelope within -25/+40 ms),
  which knows nothing about the cue but its window; skipped where another cue starts within 30 ms (the detector
  could lock onto the neighbour).
A hit passes when the master measurement is within one frame (16.7 ms) of its frame, and the stem detector, where it
can measure, agrees within a frame. Textures (streaming grains, the inhale) are listed but are not hits.

Music cues (the groove entering, the drop, the release, the stops) are measured on the music stem: onsets as the
steepest rise, stops as the first moment the level falls 1 dB under its level just before.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage, signal

from .lib.dsp import SR, n_of
from .timeline import FPS, FRAME, TYPING_WAS

TOL = FRAME  # 16.7 ms


def _env(x: np.ndarray, win: float) -> np.ndarray:
    p = x ** 2 if x.ndim == 1 else (x ** 2).sum(axis=0)
    return np.sqrt(np.maximum(ndimage.uniform_filter1d(p, size=max(1, n_of(win))), 0.0))


def intrinsic(x: np.ndarray, how: str) -> int:
    """Where, inside the cue's own waveform, its picture moment is (in samples from its first sample)."""
    e = _env(x, 0.001)
    if how in ("peak", "move"):
        return int(np.argmax(_env(x, 0.12 if how == "move" else 0.012)))
    if how == "end":
        d = e[n_of(0.001):] - e[:-n_of(0.001)]
        d[: len(d) // 2] = -np.inf          # the click that ends it, not the swell's first breath
        return int(np.argmax(d)) + n_of(0.0005)
    return int(np.nonzero(e >= 10 ** (-15 / 20) * e.max())[0][0])


def _band(x: np.ndarray) -> float | None:
    """A high-pass corner that keeps the cue's own spectrum and drops most of the bed under it (None for low cues)."""
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    cen = float(np.sum(f * spec) / (np.sum(spec) + 1e-20))
    return None if cen < 500 else float(min(2500.0, 0.4 * cen))


def _hp(x: np.ndarray, fc: float | None) -> np.ndarray:
    if fc is None:
        return x
    sos = signal.butter(4, fc, "highpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x)     # zero-phase: no lag bias


def xcorr_lag(a: np.ndarray, tpl: np.ndarray, i0: int, w: int = n_of(0.01)):
    """Lag (samples) of a long template inside a signal around i0 (used for whole-file alignment checks)."""
    L = len(tpl)
    seg = a[max(0, i0 - w): i0 + w + L]
    c = signal.correlate(seg, tpl, mode="valid")
    k = int(np.argmax(c))
    return k - (i0 - max(0, i0 - w)), float(c[k] / (np.sqrt(np.sum(seg[k:k + L] ** 2) * np.sum(tpl ** 2)) + 1e-20))


def blind_onset(x: np.ndarray, t: float, half: float = 0.016, fc: float | None = None, strict: bool = True):
    """The steepest rise of a signal's 1 ms envelope within +-`half` of t, in the cue's band. Knows nothing about the
    cue but its band and its window. Strict: no answer when two rises compete (the second within 1.5x of the best)
    or when the best sits on the window's edge (the true onset may lie outside)."""
    m = n_of(0.06)
    a0 = max(0, n_of(t - half) - m)
    seg = _hp(x[a0:n_of(t + half) + m], fc)
    e = _env(seg, 0.001)
    d1 = n_of(0.001)
    d = e[d1:] - e[:-d1]
    a, b = n_of(t - half) - a0, n_of(t + half) - a0
    w = d[a:b].copy()
    k = int(np.argmax(w))
    best = w[k]
    if strict:
        edge = n_of(0.001)
        w[max(0, k - n_of(0.004)):k + n_of(0.004)] = -np.inf
        if best <= 0 or k < edge or k > len(d[a:b]) - edge or (np.isfinite(w.max()) and best < 1.5 * w.max()):
            return None
    return (a0 + a + k + n_of(0.0005)) / SR


def audit_cues(placed: list, master: np.ndarray, sfx: np.ndarray, gain: np.ndarray) -> list[dict]:
    mono = master.sum(axis=0)
    smono = sfx.sum(axis=0)
    n = len(mono)
    rows = []
    for c, i0, x in placed:
        how = c.measure
        if how == "peak" and c.kind == "air":
            how = "move"
        # solo: the cue's own samples, through the master's own gain curve (the delivered chain), measured blind
        a, b = max(0, i0), min(n, i0 + x.shape[1])
        solo = np.zeros(x.shape[1])
        solo[a - i0:b - i0] = x[:, a - i0:b - i0].sum(axis=0) * gain[a:b]
        k_in = intrinsic(x, how if how in ("peak", "move", "end") else "onset")
        fc = _band(solo[max(0, k_in - n_of(0.01)): k_in + n_of(0.1)])
        row = {"id": c.id, "beat": c.beat, "label": c.label, "group": c.group, "kind": c.kind, "measure": how,
               "frame": c.frame, "t": c.t, "src": c.src, "tier": c.tier, "was": c.was, "check": c.check}
        if how in ("onset", "span"):
            # solo onset: the first moment the cue's 2 ms envelope reaches -12 dB of its attack's maximum (60 ms)
            e = _env(_hp(solo, fc), 0.002)
            att = e[: n_of(0.06)]
            row["solo"] = (i0 + int(np.nonzero(att >= 10 ** (-12 / 20) * att.max())[0][0])) / SR
            # a blind reading counts only where the cue stands 3 dB over everything else in its band (first 10 ms)
            w0, w1 = n_of(c.t - 0.002), n_of(c.t + 0.010)
            full = np.zeros(n)
            full[a:b] = solo[a - i0:b - i0]
            pad = n_of(0.05)
            lo, hi = max(0, w0 - pad), min(n, w1 + pad)
            cue_e = np.sum(_hp(full[lo:hi], fc)[w0 - lo:w1 - lo] ** 2)
            for key, sig in (("master", mono), ("stem", smono)):
                other = np.sum(_hp(sig[lo:hi] - full[lo:hi], fc)[w0 - lo:w1 - lo] ** 2)
                snr = 10 * np.log10((cue_e + 1e-20) / (other + 1e-20))
                row[key] = blind_onset(sig, c.t, fc=fc) if snr >= 3.0 else None
        else:
            row["solo"] = (i0 + intrinsic(np.stack([solo, solo]), how)) / SR
            row["master"] = row["stem"] = None
        meas = [row[k] for k in ("master", "stem", "solo") if row[k] is not None]
        errs = [(m - c.t) * 1000 for m in meas]
        row["err_ms"] = max(errs, key=abs)
        if how == "span":
            e1 = _env(x, 0.001)
            first = intrinsic(x, "onset")
            last = int(np.nonzero(e1 >= 10 ** (-20 / 20) * e1.max())[0][-1])
            row["end"] = (i0 + last) / SR
            row["dur_frames"] = (last - first) / SR * FPS
        hit = how not in ("texture", "move")
        ok = all(abs(e) <= TOL * 1000 + 1e-6 for e in errs)
        if how == "span":
            ok = ok and abs(row["dur_frames"] - c.p["dur"] * FPS) <= 1.0
        row["hit"] = hit
        row["ok"] = ok if hit else None
        rows.append(row)
    return sorted(rows, key=lambda r: (r["t"], r["id"]))


def chain_check(master: np.ndarray, music: np.ndarray, sfx: np.ndarray) -> dict:
    """The master is the stems' sum, sample for sample: the residual's level, and the alignment at a few points."""
    res = master - music - sfx
    rel = 10 * np.log10((np.mean(res ** 2) + 1e-30) / (np.mean(master ** 2) + 1e-30))
    lags = []
    s = (music + sfx).sum(axis=0)
    for p in np.array([0.15, 0.4, 0.6, 0.75]) * master.shape[1] / SR:
        lags.append(xcorr_lag(master.sum(axis=0), s[n_of(p):n_of(p + 0.5)], n_of(p))[0])
    return {"residual_db": float(rel), "lags": lags}


def audit_music(markers: list, music: np.ndarray, stopping: np.ndarray) -> list[dict]:
    """Onsets on the music stem: the first moment its 2 ms level rises 4 dB over the level just before. Stops and
    fall-aways on the parts that stop (pad and bass, dry, through the master's gain curve): the first moment their
    level falls 6 dB under the level just before (a release begins; a stop is a 30 ms release)."""
    rows = []
    for mid, t, label, how in markers:
        x = music if how == "onset" else stopping
        e = 20 * np.log10(_env(x, 0.002 if how == "onset" else 0.005) + 1e-9)
        ref = np.median(e[n_of(t - 0.06):n_of(t - 0.015)])
        a = n_of(t - 0.012)
        seg = e[a:n_of(t + 0.3)]
        idx = np.nonzero(seg > ref + 4.0)[0] if how == "onset" else np.nonzero(seg < ref - 6.0)[0]
        m = (a + (idx[0] if len(idx) else len(seg))) / SR
        err = (m - t) * 1000
        judged = how in ("onset", "stop")
        rows.append({"id": mid, "label": label, "measure": how, "frame": int(round(t * FPS)), "t": t, "master": m,
                     "err_ms": err, "ok": (abs(err) <= TOL * 1000 + 1e-6) if judged else None})
    return rows


def aac_offset(master: np.ndarray, decoded: np.ndarray, points=(5.0, 16.0, 30.0, 38.4)) -> list[int]:
    """Samples by which the decoded AAC lags the master (0 means the container's edit list compensates priming)."""
    out = []
    a, b = master.sum(axis=0), decoded.sum(axis=0)
    for p in points:
        i = n_of(p)
        if i + n_of(1.0) > min(len(a), len(b)):
            continue
        seg = a[i:i + n_of(0.5)]
        lag, _ = xcorr_lag(b, seg, i, n_of(0.01))
        out.append(lag)
    return out


def md_table(rows: list, music_rows: list, cut: str, length: float, chain: dict | None = None) -> str:
    hits = [r for r in rows if r["hit"]]
    passed = sum(1 for r in hits if r["ok"])
    worst = max(hits, key=lambda r: abs(r["err_ms"]))
    nm = sum(1 for r in hits if r["master"] is not None)
    lines = [f"## {cut}", "",
             f"**{passed} of {len(hits)} hits within one frame (16.7 ms) of their frame.** Worst: `{worst['id']}` at "
             f"{worst['err_ms']:+.1f} ms. {nm} of the {len(hits)} hits were also found blind in the master itself "
             f"(the others are masked there or crowded by a neighbour within a frame). Music cues: "
             f"{sum(1 for r in music_rows if r['ok'])} of {sum(1 for r in music_rows if r['ok'] is not None)}."]
    if chain:
        lines += ["", f"The master is the stems' sum: residual {chain['residual_db']:.0f} dB under the master (dither), "
                      f"alignment {chain['lags']} samples."]
    f = lambda v, t: "—" if v is None else f"{(v - t) * 1000:+.1f}"
    re = [r for r in rows if r.get("check")]
    if re:
        lines += ["", "### Re-timed to the animation (acts 1 and 4)", "",
                  "Old frame (timed from the script) against the frame the animated act gives the cue, with the cue's "
                  "measured error in the new master (the worst of the three measurements) and how its frame was found "
                  "(the act builder's code, its render, or both). Typed lines are one row each.", "",
                  "| cue | beat | event | was | now | shift (f) | error (ms) | found by |",
                  "|---|---|---|---:|---:|---:|---:|---|"]
        done = set()
        for r in re:
            if r["group"]:
                if r["group"] in done:
                    continue
                done.add(r["group"])
                g = [q for q in re if q["group"] == r["group"]]
                w = TYPING_WAS.get(f"{r['beat']}:{r['group']}")
                was = f"{w[0]} keys, {w[1]} to {w[2]}" if w else "—"
                worst = max(g, key=lambda q: abs(q["err_ms"]))["err_ms"]
                lines.append(f"| typing | {r['beat']} | {r['group']} | {was} | {len(g)} keys, {g[0]['frame']} to "
                             f"{g[-1]['frame']} | — | {worst:+.1f} | {r['check']} |")
                continue
            was = "new" if r["was"] is None else f"{r['was']} ({r['was'] / FPS:.3f} s)"
            shift = "—" if r["was"] is None else f"{r['frame'] - r['was']:+d}"
            err = f"{r['err_ms']:+.1f}" if r["hit"] else ("move, its peak" if r["measure"] == "move" else "texture")
            lines.append(f"| `{r['id']}` | {r['beat']} | {r['label']} | {was} | {r['frame']} ({r['t']:.3f} s) | "
                         f"{shift} | {err} | {r['check']} |")
    lines += ["", "### Every cue", ""]
    lines += ["", "| cue | beat | what the picture does | frame | time (s) | master (ms) | effects stem (ms) | "
              "solo through the chain (ms) | ok |", "|---|---|---|---:|---:|---:|---:|---:|:-:|"]
    for r in rows:
        what = r["label"] + (f" (ends {r['end']:.3f} s, {r['dur_frames']:.1f} f)" if "end" in r else "")
        what += {"peak": " · peak", "end": " · end", "texture": " · texture, not a hit",
                 "move": " · move (air), its peak, not a hit"}.get(r["measure"], "")
        ok = "—" if r["ok"] is None else ("yes" if r["ok"] else "**NO**")
        lines.append(f"| `{r['id']}` | {r['beat']} | {what} | {r['frame']} | {r['t']:.3f} | {f(r['master'], r['t'])} | "
                     f"{f(r['stem'], r['t'])} | {f(r['solo'], r['t'])} | {ok} |")
    lines += ["", "Music cues (measured on the music stem):", "",
              "| cue | what | frame | time (s) | measured (s) | error (ms) | ok |", "|---|---|---:|---:|---:|---:|:-:|"]
    for r in music_rows:
        lines.append(f"| `{r['id']}` | {r['label']} ({r['measure']}) | {r['frame']} | {r['t']:.3f} | "
                     f"{r['master']:.4f} | {r['err_ms']:+.1f} | {'—' if r['ok'] is None else ('yes' if r['ok'] else '**NO**')} |")
    return "\n".join(lines) + "\n"
