"""A clip's frame strip from the MP4 itself: 16 frames evenly spaced over the clip, 8 to a row, each labelled with its time.
python3 -I strip2.py clip.mp4 out.jpg"""
import subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
W, H = 1280, 800
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
n = len(fr); idx = [round(i * (n - 1) / 15) for i in range(16)]
tw, th, pad = 240, 150, 12
F = ImageFont.load_default(size=11)
sheet = Image.new('RGB', (pad + 8 * (tw + pad), pad + 2 * (th + 22 + pad)), (10, 10, 10)); d = ImageDraw.Draw(sheet)
for k, i in enumerate(idx):
    x, y = pad + (k % 8) * (tw + pad), pad + (k // 8) * (th + 22 + pad)
    sheet.paste(Image.fromarray(fr[i]).resize((tw, th), Image.LANCZOS), (x, y))
    d.rectangle([x - 1, y - 1, x + tw, y + th], outline=(42, 42, 42))
    d.text((x, y + th + 5), f'{i / 60:.2f} s', fill=(154, 154, 154), font=F)
sheet.save(out, quality=88)
