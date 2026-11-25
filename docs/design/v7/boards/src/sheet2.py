# python3 sheet2.py spec.json out.jpg : [{"base": "session/S1a-...", "title": "...", "can": "..."}]
import sys, json, textwrap, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/..'
spec = json.load(open(sys.argv[1])); out = sys.argv[2]; head = sys.argv[3] if len(sys.argv) > 3 else ''
F = ImageFont.load_default(size=22); FT = ImageFont.load_default(size=28); FH = ImageFont.load_default(size=40)
tw = 760; th = 475; pad = 40; W = pad * 3 + tw * 2
blocks = []
for it in spec:
    lines = textwrap.wrap(it['can'], 140)
    blocks.append((it, lines, 50 + th + 16 + 30 * len(lines) + 40))
H = 140 + sum(b[2] for b in blocks)
s = Image.new('RGB', (W, H), (10, 10, 10)); d = ImageDraw.Draw(s)
d.text((pad, 40), head, fill=(255, 255, 255), font=FH); y = 140
for it, lines, h in blocks:
    d.text((pad, y), it['title'], fill=(240, 240, 240), font=FT)
    for i, t in enumerate(('dark', 'light')):
        p = f"{D}/{it['base']}-{t}.jpg"
        if os.path.exists(p): s.paste(Image.open(p).convert('RGB').resize((tw, th), Image.LANCZOS), (pad + i * (tw + pad), y + 46))
    yy = y + 46 + th + 14
    for ln in lines: d.text((pad, yy), ln, fill=(170, 170, 170), font=F); yy += 30
    y += h
s.save(D + '/' + out, quality=82); print(s.size)
