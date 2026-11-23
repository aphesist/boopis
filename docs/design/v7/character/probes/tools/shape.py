# silhouette and liveliness critic for rec.cjs frames. For every orb in every frame:
#  - notch: on a convex body (circle, squircle, soft, wide, tall, bean, drop, ghost, triangle, hexagon, diamond) the
#    body's blob must have no dent: the deepest point of (convex hull minus blob) must stay under 1.2 device px; a cut
#    eye at the rim shows as such a dent too, because the eyes are dark and fall outside the blob. Lobed bodies (cloud,
#    clover, flower, star) are measured against their own median dent, with a 1.5 px margin.
#  - edge: the blob must not touch its canvas's bounds (a straight cut).
#  - life: the mean frame-to-frame change inside each orb's canvas box, per half, so today and the proposal compare.
# usage: python3 -I shape.py <framesDir>
import sys, glob, json, numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import convex_hull_image
d = sys.argv[1]; R = json.load(open(d + '/rects.json')); k = R['dpr']; fs = sorted(glob.glob(d + '/*.jpg') + glob.glob(d + '/*.png'))
CONVEX = {'circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond'}
dents = {}; edge = []; life = {}; prev = None
for i, f in enumerate(fs):
    im = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    for j, r in enumerate(R['rects']):
        x0, y0, x1, y1 = [int(round(v * k)) for v in (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])]
        c = im[max(y0, 0):y1, max(x0, 0):x1]
        if c.size == 0: continue
        if prev is not None: life.setdefault(j, []).append(float(np.abs(c - prev[max(y0, 0):y1, max(x0, 0):x1]).mean()))
        bg = np.median(np.concatenate([c[0], c[-1], c[:, 0], c[:, -1]]), axis=0)
        m = np.abs(c - bg).sum(2) > 90
        lab, n = ndimage.label(m)
        if not n: continue
        sizes = ndimage.sum(m, lab, range(1, n + 1)); big = ndimage.binary_fill_holes(lab == (np.argmax(sizes) + 1))   # eyes inside are not dents; an eye cut at the rim is
        ys, xs = np.nonzero(big)
        if len(xs) < 30: continue
        if abs(xs.mean() - big.shape[1] / 2) < big.shape[1] * .2 and abs(ys.mean() - big.shape[0] / 2) < big.shape[0] * .2 and \
           (xs.min() == 0 or ys.min() == 0 or xs.max() == big.shape[1] - 1 or ys.max() == big.shape[0] - 1): edge.append((i, j))
        hull = convex_hull_image(big)
        gap = hull & ~big
        depth = float(ndimage.distance_transform_edt(gap).max()) if gap.any() else 0.0
        dents.setdefault(j, []).append((i, depth))
    prev = im
bad = []
for j, s in dents.items():
    r = R['rects'][j]; v = np.array([q for _, q in s]); med = float(np.median(v))
    lim = 1.2 * k / 2 + .6 if r['shape'] in CONVEX else med + 1.5 * k / 2
    # a convex body's eyes sit inside it; dents up to `lim` are anti-aliasing
    for (i, q) in s:
        if q > lim: bad.append((i, r['half'], r['bot'], r['shape'], r['size'], round(q, 2), round(lim, 2)))
print(len(fs), 'frames,', len(R['rects']), 'orbs')
for h in (0, 1):
    hb = [b for b in bad if b[1] == h]
    lv = [np.mean(life[j]) for j in life if R['rects'][j]['half'] == h]
    print('half %d (%s): dents %d, canvas-edge cuts %d, life (mean change per orb per frame) %.3f' % (h, 'today' if h == 0 else 'proposed', len(hb), sum(1 for e in edge if R['rects'][e[1]]['half'] == h), float(np.mean(lv)) if lv else 0))
    for b in hb[:12]: print('   dent frame %d half %d %s/%s %dpx depth %.2f > %.2f' % b)
