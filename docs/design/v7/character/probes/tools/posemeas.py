"""Measures the fixed pose per shape on a pose.html still (DPR 2, 96 px cells, 10 per row): the eye-pair centroid in
the body's box, the far eye's area against the near one's, and the stroke angle."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

im = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(int)
names = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond',
         'cloud', 'clover', 'flower', 'star']
for i, n in enumerate(names):
    cx, cy = (i % 10) * 192, (i // 10) * 192
    a = im[cy:cy + 192, cx:cx + 192]
    body = a > 128
    ys, xs = np.nonzero(body)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    eye = ndimage.binary_fill_holes(body) & ~body
    lab, k = ndimage.label(eye)
    if k < 2:
        print(f'{n:9s} eyes found: {k}')
        continue
    sizes = ndimage.sum(eye, lab, range(1, k + 1))
    order = np.argsort(sizes)[::-1][:2] + 1
    ey, ex = np.nonzero(np.isin(lab, order))
    bw, bh = x1 - x0, y1 - y0
    ang = []
    for j in order:
        yy, xx = np.nonzero(lab == j)
        c = np.cov(np.vstack([xx, yy]))
        w, v = np.linalg.eigh(c)
        d = v[:, 1]
        ang.append(abs(np.degrees(np.arctan2(d[1], d[0]))) % 180)
    s = sorted(sizes)[::-1]
    print(f'{n:9s} centroid {(ex.mean() - (x0 + x1) / 2) / bw:+.2f} across {(ey.mean() - (y0 + y1) / 2) / bh:+.2f} down'
          f'  far/near {s[1] / s[0]:.2f}  strokes {np.mean(ang):.0f} deg  inside {int(ex.min()-x0)},{int(x1-ex.max())},{int(ey.min()-y0)} px')
