"""A grid of a clip's frames for the critic pass. python3 -I frames3.py clip.mp4 out.jpg f0:f1:step [crop x,y,w,h] [tile_w]"""
import subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
src, out, rng = sys.argv[1:4]
crop = [int(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 and sys.argv[4] != '-' else [0, 0, 1280, 800]
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 320
a, b, s = [int(v) for v in rng.split(':')]
x, y, w, h = crop
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', f'crop={w}:{h}:{x}:{y}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
idx = [i for i in range(a, min(b, len(fr)), s)]
th = round(tw * h / w); import os; cols = min(int(os.environ.get('COLS', 8)), len(idx)); rows = (len(idx) + cols - 1) // cols
F = ImageFont.load_default(size=11)
sheet = Image.new('RGB', (cols * (tw + 6) + 6, rows * (th + 20) + 6), (10, 10, 10)); d = ImageDraw.Draw(sheet)
for k, i in enumerate(idx):
    px, py = 6 + (k % cols) * (tw + 6), 6 + (k // cols) * (th + 20)
    sheet.paste(Image.fromarray(fr[i]).resize((tw, th), Image.LANCZOS), (px, py)); d.text((px, py + th + 3), f'f{i} {i / 60:.2f}s', fill=(160, 160, 160), font=F)
sheet.save(out, quality=86)
