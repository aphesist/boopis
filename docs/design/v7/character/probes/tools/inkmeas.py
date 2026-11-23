# eye size and boldness on a still: per image (one body) or per pose.html grid cell
#   eyes (length, thickness) as fractions of the body's height, and ink = eye area / body area
# usage: python3 -I inkmeas.py img.png ...        (single body per image, Grok-Bot's crops)
#        python3 -I inkmeas.py --grid cells.png  (a pose.html grid at DPR 2, 96 px cells, 10 per row)
import sys, numpy as np
from PIL import Image
from scipy import ndimage
def meas(a):
    body = ((a[..., 0] > 150) & (a[..., 1] < 130)) | (a.sum(2) > 600)
    lab, k = ndimage.label(body)
    if not k: return None
    s = ndimage.sum(body, lab, range(1, k + 1)); m = lab == (np.argmax(s) + 1)
    ys, xs = np.nonzero(m); bh = np.ptp(ys) + 1; area = ndimage.binary_fill_holes(m).sum()
    e = ndimage.binary_fill_holes(m) & ~m; el, ne = ndimage.label(e)
    if not ne: return None
    es = ndimage.sum(e, el, range(1, ne + 1)); o = np.argsort(es)[::-1][:2] + 1; out = []
    for j in o:
        yy, xx = np.nonzero(el == j)
        if len(xx) < 4: continue
        w, v = np.linalg.eigh(np.cov(np.vstack([xx, yy]))); out.append((4 * np.sqrt(max(w[1], 0)) / bh, 4 * np.sqrt(max(w[0], 0)) / bh))
    return out, e.sum() / area
args = sys.argv[1:]
if args[0] == '--grid':
    a = np.asarray(Image.open(args[1]).convert('RGB')).astype(int); R = []
    for i in range(15):
        r = meas(a[(i // 10) * 192:(i // 10) * 192 + 192, (i % 10) * 192:(i % 10) * 192 + 192])
        if r and r[0]: R.append(r)
    L = np.mean([np.mean([e[0] for e in r[0]]) for r in R]); T = np.mean([np.mean([e[1] for e in r[0]]) for r in R]); I = np.mean([r[1] for r in R])
    print(f'{args[1].split("/")[-1]}: length {L:.3f}, thickness {T:.3f} of body h, ink {I:.3f}')
else:
    for f in args:
        r = meas(np.asarray(Image.open(f).convert('RGB')).astype(int))
        if r: print(f'{f.split("/")[-1]}: eyes (length, thickness) {[(round(x, 3), round(y, 3)) for x, y in r[0]]}, ink {r[1]:.3f}')
