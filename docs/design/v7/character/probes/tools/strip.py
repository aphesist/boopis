# contact strip from kept frames: python3 -I strip.py <keepDir> <out.png> <x0,y0,x1,y1 in CSS px> <t0> <t1> <step s> [cols]
import sys, glob
from PIL import Image
d, out, box, t0, t1, st = sys.argv[1:7]; cols = int(sys.argv[7]) if len(sys.argv) > 7 else 6
x0, y0, x1, y1 = [int(v) * 2 for v in box.split(',')]
ts = []; t = float(t0)
while t <= float(t1) + 1e-6: ts.append(t); t += float(st)
ims = []
for t in ts:
    i = round(t * 30 / 3) * 3
    try: im = Image.open(f'{d}/{i:04d}.jpg').crop((x0, y0, x1, y1))
    except FileNotFoundError: continue
    ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
o = Image.new('RGB', (w * cols, h * rows), (60, 60, 60))
for k, im in enumerate(ims): o.paste(im, ((k % cols) * w, (k // cols) * h))
o.thumbnail((2000, 2000)); o.save(out); print(len(ims), o.size)
