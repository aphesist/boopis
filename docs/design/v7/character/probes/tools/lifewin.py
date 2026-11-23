# liveliness by time window: mean change per orb between kept frames (0.1 s apart), per half.
# usage: python3 -I lifewin.py <keepDir> name:start-end ...   (seconds after go)
import sys, glob, json, numpy as np
from PIL import Image
d = sys.argv[1]; R = json.load(open(d + '/rects.json')); k = R['dpr']
fs = sorted(glob.glob(d + '/*.jpg')); idx = [int(f.split('/')[-1][:4]) for f in fs]
W = [(w.split(':')[0], *map(float, w.split(':')[1].split('-'))) for w in sys.argv[2:]]
acc = {}
prev = None
for f, i in zip(fs, idx):
    im = np.asarray(Image.open(f).convert('RGB')).astype(np.int16); t = i * .032
    if prev is not None:
        for j, r in enumerate(R['rects']):
            x0, y0, x1, y1 = [int(round(v * k)) for v in (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])]
            ch = float(np.abs(im[y0:y1, x0:x1] - prev[y0:y1, x0:x1]).mean())
            for (n, a, b) in W:
                if a <= t < b: acc.setdefault((n, r['half']), []).append(ch)
    prev = im
for (n, a, b) in W:
    print('%-10s %4.1f-%4.1f s   today %.3f   proposed %.3f' % (n, a, b, np.mean(acc.get((n, 0), [0])), np.mean(acc.get((n, 1), [0]))))
