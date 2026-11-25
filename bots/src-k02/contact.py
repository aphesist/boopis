import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/..'
F = ImageFont.truetype(D + '/src/fonts/geist-latin-500-normal.woff2', 22) if False else None
try:
    from PIL import ImageFont
    F = ImageFont.load_default(size=22); FB = ImageFont.load_default(size=34)
except Exception:
    F = FB = None
W = 2400; pad = 40
boards = sorted(glob.glob(D + '/0*.jpg'))
screens = ['10-session-chat', '11-bot-chat-rail', '12-group-room-sidebar-open', '13-session-sidebar-open', '14-settings', '15-store', '16-dock']
before = D + '/../grok-package/boopis-package/boopis-now/'
befores = [('02-session-empty.png', '10-session-chat'), ('05-bot-home.png', '11-bot-chat-rail'), ('08-settings-general.png', '14-settings'), ('11-store.png', '15-store')]
tiles = []
def thumb(p, w, h=None):
    im = Image.open(p).convert('RGB'); r = w / im.width; im = im.resize((w, int(im.height * r)), Image.LANCZOS)
    return im.crop((0, 0, w, h)) if h and im.height > h else im
rows = []
tw = (W - pad * 4) // 3
rows.append(('Option boards (each 2-3 options, dark and light, at app scale)', [(thumb(b, tw, int(tw * 0.75)), os.path.basename(b)) for b in boards], 3))
sw = (W - pad * 5) // 4
rows.append(('Key screens restyled with the proposal (recommended options)', [(thumb(f'{D}/{s}-{t}.jpg', sw), f'{s}-{t}.jpg') for s in screens for t in ("dark", "light")], 4))
rows.append(('Before (boopis 0.1.9, the owner\'s captures) and after (v7, dark)', [x for b, a in befores for x in ((thumb(before + b, sw, int(sw * 0.625)), 'before: ' + b), (thumb(f'{D}/{a}-dark.jpg', sw), 'after: ' + a + '-dark.jpg'))], 4))
H = 120
for title, items, cols in rows:
    H += 70
    for i in range(0, len(items), cols): H += max(t[0].height for t in items[i:i + cols]) + 46
sheet = Image.new('RGB', (W, H), (10, 10, 10)); d = ImageDraw.Draw(sheet)
d.text((pad, 36), 'boopis design system v7: the owner\'s contact sheet', fill=(255, 255, 255), font=FB)
y = 120
for title, items, cols in rows:
    d.text((pad, y + 20), title, fill=(230, 230, 230), font=F); y += 70
    w = (W - pad * (cols + 1)) // cols
    for i in range(0, len(items), cols):
        rh = 0
        for j, (im, name) in enumerate(items[i:i + cols]):
            x = pad + j * (w + pad); sheet.paste(im, (x, y)); d.text((x, y + im.height + 8), name, fill=(160, 160, 160), font=F); rh = max(rh, im.height)
        y += rh + 46
sheet.save(D + '/contact-sheet.jpg', quality=82)
print(sheet.size)
