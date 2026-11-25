# python3 sbsheet.py : the contact sheet of ds-v7/session-boards (boards first, then each key screen dark | light)
import glob, os, re
from PIL import Image, ImageDraw, ImageFont
import sys
D = os.path.dirname(os.path.abspath(__file__)) + '/../' + (sys.argv[1] if len(sys.argv) > 1 else 'session-boards')
TITLE = sys.argv[2] if len(sys.argv) > 2 else 'boopis v7: the Session tab, boards S01-S16 and S41, key screens S17-S41 (dark | light)'
F = ImageFont.load_default(size=22); FH = ImageFont.load_default(size=40)
files = sorted(os.path.basename(f) for f in glob.glob(D + '/*.jpg') if not f.endswith('contact-sheet.jpg'))
boards = [f for f in files if not re.search(r'-(dark|light)\.jpg$', f) and not f.endswith('-board.jpg')]
screens = sorted({re.sub(r'-(dark|light)\.jpg$', '', f) for f in files if re.search(r'-(dark|light)\.jpg$', f)})
pad, W, cols = 40, 2400, 4
tw = (W - pad * (cols + 1)) // cols
tiles = []
for b in boards:
    im = Image.open(f'{D}/{b}'); th = min(int(im.height * tw / im.width), 900)
    tiles.append((b[:-4], [im.resize((tw, int(im.height * tw / im.width))).crop((0, 0, tw, th))]))
sw = (tw - 8) // 2
for s in screens:
    ims = [Image.open(f'{D}/{s}-{t}.jpg').resize((sw, int(sw * 900 / 1440))) for t in ('dark', 'light') if os.path.exists(f'{D}/{s}-{t}.jpg')]
    tiles.append((s, ims))
rows, cur = [], []
for t in tiles:
    cur.append(t)
    if len(cur) == cols: rows.append(cur); cur = []
if cur: rows.append(cur)
rh = [max(sum(i.height for i in t[1][:1]) for t in r) + 40 for r in rows]
H = 110 + sum(h + pad for h in rh)
sheet = Image.new('RGB', (W, H), (10, 10, 10)); d = ImageDraw.Draw(sheet)
d.text((pad, 34), TITLE, font=FH, fill=(240, 240, 240))
y = 110
for r, h in zip(rows, rh):
    for i, (name, ims) in enumerate(r):
        x = pad + i * (tw + pad); d.text((x, y), name, font=F, fill=(170, 170, 170))
        for k, im in enumerate(ims): sheet.paste(im, (x + k * (sw + 8) if len(ims) > 1 else x, y + 34))
    y += h + pad
sheet.save(D + '/contact-sheet.jpg', quality=82)
print(sheet.size, len(boards), 'boards', len(screens), 'screens')
