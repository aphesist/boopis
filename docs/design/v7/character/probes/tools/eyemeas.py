# eye metrics on a pose.html grid still (DPR 2, 96 px cells, 10 per row) or on Grok's capture (--grok):
# per body: eye centroid offset (x, y in box fractions), eye length / body height, aspect, centre gap / width, tilt
import sys, numpy as np
from PIL import Image
from scipy import ndimage
def blobs(a):
    red = (a[..., 0] > 150) & (a[..., 1] < 120)
    lab, n = ndimage.label(red); out = []
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() < 300: continue
        out.append(m)
    return out
def meas(m):
    ys, xs = np.nonzero(m); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max(); bw, bh = x1 - x0 + 1, y1 - y0 + 1
    eye = ndimage.binary_fill_holes(m) & ~m; el, k = ndimage.label(eye)
    if k < 2: return None
    sz = ndimage.sum(eye, el, range(1, k + 1)); o = np.argsort(sz)[::-1][:2] + 1; info = []
    for j in o:
        yy, xx = np.nonzero(el == j); w, v = np.linalg.eigh(np.cov(np.vstack([xx, yy])))
        info.append((xx.mean(), yy.mean(), 4 * np.sqrt(w[1]), 4 * np.sqrt(max(w[0], 1e-6)), np.degrees(np.arctan2(v[1, 1], v[0, 1])) % 180))
    info.sort(); (lx, ly, lL, lW, la), (rx, ry, rL, rW, ra) = info
    return dict(x=((lx + rx) / 2 - (x0 + x1) / 2) / bw, y=((ly + ry) / 2 - (y0 + y1) / 2) / bh, L=(lL + rL) / 2 / bh, asp=(lL / lW + rL / rW) / 2, gap=(rx - lx) / bw, tilt=(la + ra) / 2, wr=min(lW, rW) / max(lW, rW), cx=(x0 + x1) / 2)
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
R = [r for r in (meas(m) for m in blobs(a)) if r]
for r in sorted(R, key=lambda r: r['cx']) if len(sys.argv) > 2 else R:
    print('  x %+.2f y %+.2f len %.2f asp %.1f gap %.2f tilt %3.0f far/near width %.2f' % (r['x'], r['y'], r['L'], r['asp'], r['gap'], r['tilt'], r['wr']))
k = ['x', 'y', 'L', 'asp', 'gap', 'tilt', 'wr']
print('MEAN', ' '.join('%s %.2f' % (q, np.mean([r[q] for r in R])) for q in k))
