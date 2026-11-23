# frame-by-frame critic: A-B-A flicker (frame i+1 differs from i and i+2 while i ~ i+2), empty frames (an orb canvas cleared)
import sys, glob, numpy as np
from PIL import Image
fs = sorted(glob.glob(sys.argv[1] + "/*.png")); prev2 = prev = None; bad = []
def orbmass(a): return (np.abs(a - 14).sum(2) > 60).sum()
for i, f in enumerate(fs):
    a = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    if prev2 is not None:
        d1 = np.abs(a - prev).mean(); d2 = np.abs(prev - prev2).mean(); d02 = np.abs(a - prev2).mean()
        if d1 > 0.4 and d2 > 0.4 and d02 < 0.25 * min(d1, d2): bad.append((i - 1, 'A-B-A', round(d1, 2), round(d02, 2)))
        m0, m1, m2 = orbmass(prev2), orbmass(prev), orbmass(a)
        if m1 < 0.97 * min(m0, m2): bad.append((i - 1, 'mass dip', m0, m1, m2))
    prev2, prev = prev, a
print(len(fs), 'frames;', len(bad), 'suspect', bad[:20])
