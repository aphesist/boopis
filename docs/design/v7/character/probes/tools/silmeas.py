# Silhouette metrics per shape, ours (pose.html grid still, DPR 2, 96 px cells) against Grok-Bot's capture:
#  axis   the orientation of the silhouette's principal axis (degrees from horizontal, 0-180)
#  elong  the ratio of its principal extents (1 = round)
#  apex   the direction from the centroid to the farthest outline point (degrees, 0 = right, 90 = down)
#  skew   how far the area's centroid sits from the box centre (box fractions, x then y): the perspective's near side
# usage: python3 -I silmeas.py <ours.png> | python3 -I silmeas.py --grok
import sys, numpy as np
from PIL import Image
from scipy import ndimage
SH = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star']
G = {'circle': (72, 32, 52, 53), 'cloud': (163, 35, 55, 48), 'squircle': (248, 32, 58, 52), 'clover': (335, 26, 64, 64), 'flower': (160, 121, 56, 55), 'drop': (254, 122, 50, 55), 'wide': (338, 126, 58, 45), 'triangle': (436, 124, 57, 59), 'ghost': (163, 212, 56, 54), 'star': (246, 207, 62, 61), 'hexagon': (339, 211, 56, 53)}
def met(m):
    m = ndimage.binary_fill_holes(m); ys, xs = np.nonzero(m); cx, cy = xs.mean(), ys.mean()
    w, v = np.linalg.eigh(np.cov(np.vstack([xs, ys]))); ax = np.degrees(np.arctan2(v[1, 1], v[0, 1])) % 180
    el = np.sqrt(w[1] / max(w[0], 1e-9))
    edge = m & ~ndimage.binary_erosion(m); ey, ex = np.nonzero(edge); d = (ex - cx) ** 2 + (ey - cy) ** 2; k = np.argmax(d)
    ap = np.degrees(np.arctan2(ey[k] - cy, ex[k] - cx)) % 360
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    return ax, el, ap, (cx - (x0 + x1) / 2) / (x1 - x0 + 1), (cy - (y0 + y1) / 2) / (y1 - y0 + 1)
def body(a):
    red = (a[..., 0] > 150) & (a[..., 1] < 120); lab, n = ndimage.label(red)
    if not n: return None
    sz = ndimage.sum(red, lab, range(1, n + 1)); return lab == (np.argmax(sz) + 1)
g = np.asarray(Image.open(sys.argv[2] if len(sys.argv) > 2 else '/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/owner-grok-videos/grok-fixed-angle.png').convert('RGB')).astype(int)
o = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
print('shape       ours: axis elong apex  skew x,y      | Grok: axis elong apex  skew x,y')
for i, sh in enumerate(SH):
    m = body(o[(i // 10) * 192:(i // 10) * 192 + 192, (i % 10) * 192:(i % 10) * 192 + 192])
    if m is None: continue
    a = met(m); s = f'{sh:10s} {a[0]:5.0f} {a[1]:5.2f} {a[2]:5.0f} {a[3]:+.2f},{a[4]:+.2f}'
    if sh in G:
        x0, y0, w, h = G[sh]; gm = body(g[y0 - 4:y0 + h + 4, x0 - 4:x0 + w + 4]); b = met(gm)
        s += f'   | {b[0]:5.0f} {b[1]:5.2f} {b[2]:5.0f} {b[3]:+.2f},{b[4]:+.2f}'
    print(s)
