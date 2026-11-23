# silhouette critic: for every orb in every frame, the body's largest blob must keep its convexity (solidity: area over
# convex-hull area) frame to frame, and must never touch the canvas's own bounds (a straight cut).
# usage: python3 -I shape.py <framesDir>   (frames and rects.json from rec.cjs)
import sys, glob, json, numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull
d = sys.argv[1]; R = json.load(open(d + '/rects.json')); k = R['dpr']; fs = sorted(glob.glob(d + '/*.png'))
series = {}; edge = []
for i, f in enumerate(fs):
    im = np.asarray(Image.open(f).convert('RGB')).astype(int)
    for j, r in enumerate(R['rects']):
        x0, y0, x1, y1 = [int(round(v * k)) for v in (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])]
        c = im[max(y0, 0):y1, max(x0, 0):x1]
        if c.size == 0: continue
        bg = np.median(np.concatenate([c[0], c[-1], c[:, 0], c[:, -1]]), axis=0)
        m = np.abs(c - bg).sum(2) > 60
        lab, n = ndimage.label(m)
        if not n: continue
        sizes = ndimage.sum(m, lab, range(1, n + 1)); big = lab == (np.argmax(sizes) + 1)
        big = ndimage.binary_fill_holes(big)
        ys, xs = np.nonzero(big)
        if len(xs) < 20: continue
        # the body's blob is 2/3 of the canvas at most: touching the canvas's bounds means a cut
        if xs.min() == 0 or ys.min() == 0 or xs.max() == big.shape[1] - 1 or ys.max() == big.shape[0] - 1:
            # neighbours on the page (a bubble, a slab) can touch the crop: only count it when the blob is the orb (centred)
            if abs(xs.mean() - big.shape[1] / 2) < big.shape[1] * .2 and abs(ys.mean() - big.shape[0] / 2) < big.shape[0] * .2: edge.append((i, j))
        pts = np.c_[xs, ys].astype(float)
        try: hull = ConvexHull(pts).volume
        except Exception: continue
        series.setdefault(j, []).append((i, len(xs) / max(hull, 1)))
bad = []
for j, s in series.items():
    v = np.array([q for _, q in s]); med = np.median(v); r = R['rects'][j]
    tol = .05 if r['size'] >= 40 else .08
    for (i, q) in s:
        if q < med - tol: bad.append((i, r['half'], r['bot'], r['size'], round(float(q), 3), round(float(med), 3)))
print(len(fs), 'frames,', len(R['rects']), 'orbs; notch suspects:', len(bad), '; canvas-edge cuts:', len(edge))
for b in bad[:40]: print('  notch frame %d half %d %s %dpx solidity %.3f (median %.3f)' % b)
for e in edge[:10]: print('  edge', e)

# the pose check: the turns that probes/turn.html shows to notch a flat body (head past 0.2 rad) or to cut the eyes at
# the rim (eyes past 0.75 rad), frame by frame, from the pose rec.cjs read off each orb
import os
if os.path.exists(d + '/poses.json'):
    P = json.load(open(d + '/poses.json')); out = {}
    for i, fr in enumerate(P):
        for j, (hy, hp, ey, ep, circ, spin) in enumerate(fr):
            r = R['rects'][j]
            why = []
            if not circ and not spin and max(abs(hy), abs(hp)) > .2: why.append('head %.2f/%.2f' % (hy, hp))
            if max(abs(ey), abs(ep)) > .75 and not spin: why.append('eyes %.2f/%.2f' % (ey, ep))
            if spin: why.append('spin')
            if why: out.setdefault((r['half'], r['bot'], r['size']), []).append((i, ', '.join(why)))
    for k, v in sorted(out.items()): print('  pose half %d %s %dpx: %d frames, first %s' % (k + (len(v), v[:3])))
    print('pose suspects, today half:', sum(len(v) for k, v in out.items() if k[0] == 0), ' proposed half:', sum(len(v) for k, v in out.items() if k[0] == 1))
