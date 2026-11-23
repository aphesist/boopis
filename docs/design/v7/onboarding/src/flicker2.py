"""Revision 2's frame-by-frame check of a clip (60 fps).
Whole frame (at 640 x 400): flicker, a frame that differs from both neighbours while they agree (A-B-A); cuts, a single-frame
change much larger than the clip's motion.
A tracked region (--track x,y,w,h in the 1280 x 800 clip, optional --fg light|dark): the bright (or dark) shapes in it, the
speaker's eyes or a bot. Per frame: how many separate shapes (a double image shows up as more shapes than the subject has),
the centroid, and its jerk (the second difference of the centroid, px per frame squared): a stutter or a dropped frame is a
jerk spike; a smooth 60 fps move stays low.
Usage: python3 -I flicker2.py clip.mp4 [--track x,y,w,h] [--parts 2] [--fg light]"""
import subprocess, sys
import numpy as np
from scipy import ndimage

args = sys.argv[1:]
path = args[0]
track = None; parts = 2; fg = 'light'
for i, a in enumerate(args):
    if a == '--track': track = [int(v) for v in args[i + 1].split(',')]
    if a == '--parts': parts = int(args[i + 1])
    if a == '--fg': fg = args[i + 1]
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
    g = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    bg = np.median(g[:, :4, :4])
    cs, ns, extra = [], [], []
    for i, fr in enumerate(g):
        m = (fr > bg + 60) if fg == 'light' else (fr < bg - 60)
        vis = (fr.max() > bg + 150) if fg == 'light' else (fr.min() < bg - 150)
        if not vis: ns.append(0); cs.append((np.nan, np.nan)); continue   # faded (a dip or an entry): not counted
        lab, n = ndimage.label(m)
        if n:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            n = int((sizes > 12).sum())
        ns.append(n)
        if n > parts: extra.append(i)
        ys, xs = np.nonzero(m)
        cs.append((xs.mean(), ys.mean()) if len(xs) else (np.nan, np.nan))
    c = np.array(cs)
    v = np.diff(c, axis=0); j = np.abs(np.diff(v, axis=0))
    jm = np.array([np.nan if np.isnan(r).all() else np.nanmax(r) for r in j])
    order = np.argsort(-np.nan_to_num(jm))[:5]
    line += f'\n  track {track}: shapes per frame {min(ns)}-{max(ns)} (expected <= {parts}); frames with more: {extra[:12] or "none"}; ' \
            f'max speed {np.nanmax(np.abs(v)):.2f} px/frame; jerk p99 {np.nanpercentile(jm, 99):.2f}, max {np.nanmax(jm):.2f} at frames {[int(k) + 1 for k in order]}'
print(line)
