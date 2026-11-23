# per-shape dent summary of the proposed half of a kept torture clip: python3 -I convexdents.py <keepDir>
import sys, json, glob, numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import convex_hull_image
d = sys.argv[1]; R = json.load(open(d + '/rects.json')); k = R['dpr']; out = {}
for f in sorted(glob.glob(d + '/*.jpg')):
    i = int(f[-8:-4]); im = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    for j, r in enumerate(R['rects']):
        if r['half'] != 1: continue
        x0, y0, x1, y1 = [int(round(v * k)) for v in (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])]
        c = im[y0:y1, x0:x1]; bg = np.median(np.concatenate([c[0], c[-1], c[:, 0], c[:, -1]]), axis=0)
        m = np.abs(c - bg).sum(2) > 90; lab, n = ndimage.label(m)
        s = ndimage.sum(m, lab, range(1, n + 1)); big = ndimage.binary_fill_holes(lab == (np.argmax(s) + 1))
        gap = convex_hull_image(big) & ~big; dep = float(ndimage.distance_transform_edt(gap).max()) if gap.any() else 0
        out.setdefault(r['shape'], []).append((dep, i))
for sh, v in out.items():
    a = np.array([x for x, _ in v]); print(f'{sh:9s} max {a.max():.2f} over 1.8: {(a > 1.8).sum()} worst {sorted(v)[-2:]}')
