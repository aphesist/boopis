"""Revision 2's frame-by-frame check of a clip (60 fps).
Whole frame (at 640 x 400): flicker, a frame that differs from both neighbours while they agree (A-B-A); cuts, a single-frame
change much larger than the clip's motion.
A tracked region (--track x,y,w,h in the 1280 x 800 clip, optional --fg light|dark): the bright (or dark) shapes in it, the
speaker's eyes or a bot. Per frame: how many separate shapes (a double image shows up as more shapes than the subject has),
the centroid, and its jerk (the second difference of the centroid, px per frame squared): a stutter or a dropped frame is a
jerk spike; a smooth 60 fps move stays low.
An orb region (--orb x,y,w,h, any number, in the 1280 x 800 clip): the orb's silhouette, its pixels that differ from the
background with the eye holes filled. Per frame: its area and its convexity (area over its convex hull's area). An edge cut
by the canvas or a deformed silhouette shows as an area or convexity spike (one frame off while its neighbours agree), a
jump over 8% between two frames, or a convexity well under the clip's median.
With --eyes, a tracked region counts only eye-like shapes (150 px or more, about as tall as wide), for a region the speaker
travels through that also holds text: a double image of the speaker is then any frame with more than two.
Usage: python3 -I flicker2.py clip.mp4 [--track x,y,w,h] [--eyes] [--parts 2] [--fg light] [--orb x,y,w,h ...]"""
import subprocess, sys
import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull

args = sys.argv[1:]
path = args[0]
track = None; tw = (0, 10 ** 9); parts = 2; fg = 'light'; orbs = []; eyes = '--eyes' in args
for i, a in enumerate(args):
    if a == '--track':   # x,y,w,h[@from-to]; even: the chroma planes are halved
        r, _, win = args[i + 1].partition('@'); t0s, _, t1s = win.partition('-')
        track = [int(v) // 2 * 2 for v in r.split(',')]; tw = (int(t0s or 0), int(t1s or 10 ** 9))
    if a == '--parts': parts = int(args[i + 1])
    if a == '--fg': fg = args[i + 1]
    if a == '--orb':   # x,y,w,h[@from-to] (frames): the window in which that orb sits in that region
        r, _, win = args[i + 1].partition('@'); f0, _, f1 = win.partition('-')
        orbs.append([int(v) // 2 * 2 for v in r.split(',')] + [int(f0 or 0), int(f1 or 10 ** 9)])
W, H = 640, 400
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
f = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
d = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))
flick = []
for i in range(1, len(f) - 1):
    a, b = np.abs(f[i] - f[i - 1]).mean(), np.abs(f[i + 1] - f[i - 1]).mean()
    if a > 0.8 and b < a * 0.25:
        flick.append((i, round(float(a), 2), round(float(b), 2)))
cuts = [(i + 1, round(float(x), 2)) for i, x in enumerate(d) if x > 6]
line = f'{path.split("/")[-1]}: {len(f)} frames, mean change {d.mean():.2f}, max {d.max():.2f} at frame {int(d.argmax()) + 1}; flicker {flick or "none"}; cuts over 6 {cuts or "none"}'
if track:
    x, y, w, h = track
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={w}:{h}:{x}:{y}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    g = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)[tw[0]:tw[1]]
    bg = np.median(g[:, :4, :4])
    cs, ns, extra = [], [], []
    for i, fr in enumerate(g):
        m = (fr > bg + 60) if fg == 'light' else (fr < bg - 60)
        vis = (fr.max() > bg + 150) if fg == 'light' else (fr.min() < bg - 150)
        if not vis: ns.append(0); cs.append((np.nan, np.nan)); continue   # faded (a dip or an entry): not counted
        lab, n = ndimage.label(m)
        if n and eyes:
            # --eyes: only eye-like shapes count (150 px or more, about as tall as wide), so text, buttons and rules do not
            sl = ndimage.find_objects(lab); sizes = ndimage.sum(m, lab, range(1, n + 1))
            keep = [k + 1 for k, b in enumerate(sl) if sizes[k] >= 150 and 0.6 <= (b[0].stop - b[0].start) / max(1, b[1].stop - b[1].start) <= 2.5]
            n = len(keep); m = np.isin(lab, keep)
        elif n:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            n = int((sizes > 12).sum())
        ns.append(n)
        if n > parts: extra.append(i)
        ys, xs = np.nonzero(m)
        cs.append((xs.mean(), ys.mean()) if len(xs) and (not eyes or n == parts) else (np.nan, np.nan))   # --eyes: the pair only
    c = np.array(cs)
    v = np.diff(c, axis=0); j = np.abs(np.diff(v, axis=0))
    jm = np.array([np.nan if np.isnan(r).all() else np.nanmax(r) for r in j])
    order = np.argsort(-np.nan_to_num(jm))[:5]
    line += f'\n  track {track} frames {tw[0]}-{min(tw[1], tw[0] + len(g))}: shapes per frame {min(ns)}-{max(ns)} (expected <= {parts}); frames with more: {extra[:12] or "none"}; ' \
            f'max speed {np.nanmax(np.abs(v)):.2f} px/frame; jerk p99 {np.nanpercentile(jm, 99):.2f}, max {np.nanmax(jm):.2f} at frames {[int(k) + 1 for k in order]}'
for x, y, w, h, f0, f1 in orbs:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={w}:{h}:{x}:{y}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    g = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.int16)[f0:f1]
    bg = np.median(g[:, :3, :3].reshape(-1, 3), axis=0)
    A, C = [], []
    for fr in g:
        m = np.abs(fr - bg).max(axis=2) > 40
        m = ndimage.binary_opening(m, iterations=1)
        lab, n = ndimage.label(m)
        if n == 0: A.append(np.nan); C.append(np.nan); continue
        sizes = ndimage.sum(m, lab, range(1, n + 1)); k = int(np.argmax(sizes)) + 1
        body = ndimage.binary_fill_holes(lab == k)
        a = float(body.sum())
        if a < 60: A.append(np.nan); C.append(np.nan); continue
        edge = body & ~ndimage.binary_erosion(body)
        pts = np.argwhere(edge)
        try: hull = ConvexHull(pts).volume + len(pts) * 0.5
        except Exception: hull = a
        A.append(a); C.append(min(1.0, a / hull))
    A = np.array(A); C = np.array(C)
    spikes, jumps, dents = [], [], []
    med = np.nanmedian(C)
    for i in range(1, len(A) - 1):
        p, c, q = A[i - 1], A[i], A[i + 1]
        if np.isnan(p) or np.isnan(c) or np.isnan(q): continue
        if abs(c - p) / p > 0.04 and abs(c - q) / q > 0.04 and abs(p - q) / p < 0.015: spikes.append(i + f0)
        if abs(c - p) / p > 0.08: jumps.append(i + f0)
        if C[i] < med - 0.06 and C[i - 1] >= med - 0.03 and C[i + 1] >= med - 0.03: dents.append(i + f0)
    line += f'\n  orb [{x},{y},{w},{h}] frames {f0}-{min(f1, f0 + len(A))}: area {np.nanmin(A):.0f}-{np.nanmax(A):.0f} px, convexity median {med:.3f} min {np.nanmin(C):.3f}; ' \
            f'area spikes {spikes[:10] or "none"}; jumps over 8% {jumps[:10] or "none"}; dents {dents[:10] or "none"}'
print(line)
