# smoothness of the transitions in a recorded clip (proposed half): for each moment, the peak per-frame change of the
# orbs and the largest step between consecutive frame changes (a pop shows as a step as big as the peak)
# usage: python3 -I trans.py <framesDir> t1 t2 ...
import sys, json, numpy as np
from PIL import Image
d = sys.argv[1]; R = json.load(open(d + '/rects.json')); rs = [r for r in R['rects'] if r['half'] == 1]
ts = [float(x) for x in sys.argv[2:]]; ser = {}; prev = None
need = sorted({i for t in ts for i in range(int(t / .032) - 4, int(t / .032) + 32)})
for i in range(need[0], need[-1] + 1):
    im = np.asarray(Image.open(f'{d}/{i:04d}.jpg').convert('L')).astype(np.int16)
    if prev is not None:
        ser[i] = max(np.abs(im[int(r['y'] * 2):int((r['y'] + r['h']) * 2), int(r['x'] * 2):int((r['x'] + r['w']) * 2)] - prev[int(r['y'] * 2):int((r['y'] + r['h']) * 2), int(r['x'] * 2):int((r['x'] + r['w']) * 2)]).mean() for r in rs)
    prev = im
for t in ts:
    i = int(t / .032); w = np.array([ser[j] for j in range(i - 3, i + 30) if j in ser])
    print(f't={t:5.1f}s  peak frame change {w.max():.2f}  largest step {np.abs(np.diff(w)).max():.2f}')
