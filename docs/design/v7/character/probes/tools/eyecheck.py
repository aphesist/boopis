# Eye constraints on a recorded clip (rec.cjs frames, proposed half): for every orb and frame where both eyes are pills,
#  - width: each pill's foreshortened width against its front-on width (the orb's 95th-percentile width in the clip);
#    the floor is 0.55;
#  - gap: the clear distance between the two pills, against the front-on width; the floor is 0.5;
#  - margin: the clear distance from either pill to the outline, in device px; the floor is 1.5 px.
# usage: python3 -I eyecheck.py <framesDir> [half] [t0-t1 seconds]
import sys, glob, json, numpy as np
from PIL import Image
from scipy import ndimage
d = sys.argv[1]; half = int(sys.argv[2]) if len(sys.argv) > 2 else 1
rng = tuple(map(float, sys.argv[3].split('-'))) if len(sys.argv) > 3 else (0, 1e9)   # seconds: only frames in this window
R = json.load(open(d + '/rects.json')); k = R['dpr']; fs = sorted(glob.glob(d + '/*.jpg'))
rows = {}
for f in fs:
    i = int(f.split('/')[-1][:4])
    if not (rng[0] <= i * .032 < rng[1]): continue
    im = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    for j, r in enumerate(R['rects']):
        if r['half'] != half: continue
        x0, y0, x1, y1 = [int(round(v * k)) for v in (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])]
        c = im[y0:y1, x0:x1]; bg = np.median(np.concatenate([c[0], c[-1], c[:, 0], c[:, -1]]), axis=0)
        m = np.abs(c - bg).sum(2) > 90; lab, n = ndimage.label(m)
        if not n: continue
        sz = ndimage.sum(m, lab, range(1, n + 1)); body = lab == (np.argmax(sz) + 1); fill = ndimage.binary_fill_holes(body)
        eye = fill & ~body; el, ne = ndimage.label(eye)
        if ne < 2: rows.setdefault(j, []).append((i, None)); continue
        if ne > 3: continue   # a grid, bars or other many-cell face, not a pill pair
        es = ndimage.sum(eye, el, range(1, ne + 1)); o = np.argsort(es)[::-1][:2] + 1
        if es[o[1] - 1] < 6: rows.setdefault(j, []).append((i, None)); continue
        ws, ok = [], True
        for q in o:
            yy, xx = np.nonzero(el == q)
            if len(xx) < 6: ok = False; break
            w, v = np.linalg.eigh(np.cov(np.vstack([xx, yy]))); L, W = 4 * np.sqrt(w[1]), 4 * np.sqrt(max(w[0], 1e-6))
            if L / max(W, 1e-6) < 1.6: ok = False   # not a pill (round, square, arc or wide eyes of a state or an emote)
            ws.append(W)
        if not ok: continue
        gap = float(ndimage.distance_transform_edt(el != o[0])[el == o[1]].min())
        marg = float(ndimage.distance_transform_edt(fill)[eye].min())
        rows.setdefault(j, []).append((i, (min(ws), gap, marg)))
print('orb            frames  min width  frames<0.55  min gap  frames<0.5  min margin px  frames<1.5  merged/hidden')
tot = [0, 0, 0, 0]
for j, v in rows.items():
    r = R['rects'][j]; good = [x for _, x in v if x]; bad = sum(1 for _, x in v if x is None)
    if not good: continue
    ref = np.percentile([g[0] for g in good], 95)
    wr = [g[0] / ref for g in good]; gp = [g[1] / ref for g in good]; mg = [g[2] for g in good]
    a, b, c = sum(x < .55 for x in wr), sum(x < .5 for x in gp), sum(x < 1.5 for x in mg)
    tot = [tot[0] + a, tot[1] + b, tot[2] + c, tot[3] + bad]
    print(f"{(r['bot'] or r['shape'])[:12]:12s} {len(good):7d} {min(wr):10.2f} {a:12d} {min(gp):8.2f} {b:11d} {min(mg):14.1f} {c:11d} {bad:14d}")
print('TOTAL below floors: width %d, gap %d, margin %d; merged or hidden %d' % tuple(tot))
